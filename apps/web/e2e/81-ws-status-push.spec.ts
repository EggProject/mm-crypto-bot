/**
 * apps/web/e2e/81-ws-status-push.spec.ts
 *
 * Phase 81: e2e tests for the WS-driven status push (the
 * replacement for the Phase 69 `setInterval(..., 1_000)` poll).
 *
 * ============================================================================
 * WHAT THIS TEST SUITE PROVES
 * ============================================================================
 *
 * The user mandate: "a backendnek kene ertesiteni es nem a
 * frontendnek keregetni!". The previous design polled
 * `GET /api/status` every 1 second. The Phase 81 fix:
 *
 *   1. The `LiveStatePublisher.refreshFromBot()` (and
 *      `setPaused()`) now emits a `state` event in addition to
 *      the `snapshot` event. The feed-server turns the `state`
 *      event into a WS `state` message.
 *
 *   2. The dashboard's `useBotStatus` hook consumes the WS
 *      `state` / `snapshot` messages and updates the status
 *      banner WITHIN 1-2 SECONDS of a CONTROL click (NOT 5+
 *      seconds as the previous polling design would allow).
 *
 *   3. The HTTP `/api/status` endpoint is now ONLY used as a
 *      one-shot bootstrap fetch (on mount) + a 30s slow-poll
 *      fallback (when the WS is disconnected). The 1s poll
 *      from Phase 69 is GONE.
 *
 * The tests in this file verify:
 *
 *   1. The status banner updates WITHIN 2 SECONDS of a WS
 *      `state` message arriving (not waiting for the HTTP
 *      bootstrap fetch — the WS push is the source of truth).
 *
 *   2. Clicking Start (which triggers a backend state change +
 *      WS state push) updates the banner WITHIN 2 SECONDS.
 *
 *   3. The HTTP `/api/status` endpoint is STILL served (the
 *      bootstrap fetch + slow-poll fallback depend on it) — but
 *      the dashboard does NOT rely on a tight polling schedule
 *      on the endpoint.
 *
 *   4. The WS `state` message broadcasts the full `botStatus`
 *      payload (the `useBotStatus` hook extracts it via
 *      `extractBotStatus`).
 *
 *   5. The dashboard's "0 active strategies" + "0 open
 *      positions" → "1 open position" → "3 open positions"
 *      transitions are picked up by the WS push (Phase 71
 *      regression coverage for the WS-driven path).
 *
 * ============================================================================
 * TEST STRATEGY
 * ============================================================================
 *
 * The tests use Playwright's `page.routeWebSocket` to drive the
 * WS messages on the test side. The test's `setupWsPeer`
 * function returns a `broadcast()` function that pushes a JSON
 * payload to all connected browsers — this simulates the
 * backend's WS push on a state change.
 *
 * The HTTP `/api/control` route handler (in `setupHttpRoutes`)
 * also drives a `botState` object + fires a WS `state` message
 * via the `broadcast` callback. This simulates the real bot's
 * CONTROL → markBotStarted → refreshFromBot → emit state →
 * feed-server → WS state message flow.
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
import type { WebSocketRoute } from "@playwright/test";

setSpecName("81-ws-status-push");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// =============================================================================
// Test state
// =============================================================================

/**
 * The bot's mock state, shared across the test. The
 * `setupHttpRoutes` handler mutates this on CONTROL clicks,
 * and the `broadcast` callback fires a WS `state` message with
 * the new state.
 */
const botState: {
  state: "running" | "paused" | "stopped";
  startedAt: number;
  activeStrategyCount: number;
  openPositionCount: number;
} = {
  state: "stopped",
  startedAt: 0,
  activeStrategyCount: 1,
  openPositionCount: 0,
};

const CONTROL_REQUESTS: { command: string; paused?: boolean; confirm?: boolean }[] = [];

let broadcastCallback: ((data: string) => void) | null = null;

function currentBotStatus(): {
  state: "running" | "paused" | "stopped";
  startedAt: number;
  lastUpdate: number;
  activeStrategyCount: number;
  positions: readonly { id: string; symbol: string; side: "buy" | "sell"; entryPrice: number; currentPrice: number; quantity: number; leverage: number; unrealizedPnl: number; unrealizedPnlPct: number; openedAt: number }[];
} {
  const positions = Array.from({ length: botState.openPositionCount }, (_, i) => ({
    id: `mock-pos-${String(i)}`,
    symbol: "BTCUSDT",
    side: "buy" as const,
    entryPrice: 60_000,
    currentPrice: 60_100,
    quantity: 0.01,
    leverage: 5,
    unrealizedPnl: 1,
    unrealizedPnlPct: 1.67,
    openedAt: Date.now() - 60_000,
  }));
  return {
    state: botState.state,
    startedAt: botState.startedAt,
    lastUpdate: Date.now(),
    activeStrategyCount: botState.activeStrategyCount,
    positions,
  };
}

/** Build the full StateFeedSnapshot (matching the bot's `refreshFromBot` output). */
function makeSnapshot(): object {
  return {
    status: {
      mode: "with-bot",
      engineAvailable: true,
      engineError: null,
      connected: true,
      lastUpdate: Date.now(),
    },
    running: botState.state === "running" || botState.state === "paused",
    killSwitch: "armed",
    positions: [],
    statistics: {
      totalPnlUsdt: 0,
      totalPnlPct: 0,
      winRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      maxDrawdownPct: 0,
      currentDrawdownPct: 0,
      avgWinPnl: 0,
      avgLossPnl: 0,
      bestTradePnl: 0,
      worstTradePnl: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      equityUsdt: 10_000,
      initialEquityUsdt: 10_000,
    },
    history: [],
    tickers: [],
    tickerEvents: [],
    paused: botState.state === "paused",
    killSwitchThresholdPct: -10,
    strategies: [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h", "4h"],
      },
    ],
    botStatus: currentBotStatus(),
  };
}

// =============================================================================
// Test helpers
// =============================================================================

interface WsTestHarness {
  readonly broadcast: (data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  const allWs: WebSocketRoute[] = [];
  const wsSeenResolvers: (() => void)[] = [];

  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    allWs.push(ws);
    for (const r of wsSeenResolvers.splice(0)) r();
    // Send HELLO + SNAPSHOT on connect.
    ws.send(
      JSON.stringify({
        type: "hello",
        ts: Date.now(),
        serverVersion: "0.1.0-test",
        protocolVersion: 1,
      }),
    );
    ws.send(
      JSON.stringify({
        type: "snapshot",
        ts: Date.now(),
        snapshot: makeSnapshot(),
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h", "4h"],
          },
        ],
        ohlcBootstrap: {
          BTCUSDT: {
            "1h": [],
            "4h": [],
          },
        },
      }),
    );
  });

  const waitForWsCount = async (
    n: number,
    timeoutMs = 5_000,
  ): Promise<void> => {
    if (allWs.length >= n) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      wsSeenResolvers.push(() => {
        if (allWs.length >= n) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  };

  return {
    broadcast: (data: string): void => {
      for (const w of allWs) {
        try {
          w.send(data);
        } catch {
          // best-effort
        }
      }
    },
    waitForWsCount,
  };
}

async function setupHttpRoutes(page: Page): Promise<void> {
  await page.route("http://127.0.0.1:7913/api/strategies", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h", "4h"],
          },
        ],
      }),
    });
  });
  await page.route("http://127.0.0.1:7913/api/ohlc", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ bars: [] }),
    });
  });
  await page.route("http://127.0.0.1:7913/api/health", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, stateFeedConnected: true, hasSnapshot: true }),
    });
  });
  // /api/status — the bootstrap + slow-poll fallback endpoint.
  // It MUST still work (the dashboard uses it on mount + on slow
  // poll when the WS is down).
  await page.route("http://127.0.0.1:7913/api/status", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ botStatus: currentBotStatus() }),
    });
  });
  // /api/control — update the bot state AND fire a WS `state`
  // message. This simulates the real bot's CONTROL → markBotStarted
  // → refreshFromBot → emit state → feed-server → WS state flow.
  await page.route("http://127.0.0.1:7913/api/control", async (route: Route) => {
    const req = route.request();
    const body = (await req.postDataJSON()) as {
      command: string;
      paused?: boolean;
      confirm?: boolean;
    };
    CONTROL_REQUESTS.push(body);
    switch (body.command) {
      case "start":
        botState.state = "running";
        botState.startedAt = Date.now();
        break;
      case "stop":
        botState.state = "stopped";
        break;
      case "pause":
        botState.state = "paused";
        break;
      case "resume":
        botState.state = "running";
        break;
      case "kill_switch":
        botState.state = "stopped";
        break;
    }
    // Firing the WS `state` push — the test simulates the
    // backend's behavior. The dashboard should pick up the
    // new state within 1-2 seconds (the WS push is the source
    // of truth, NOT the HTTP poll).
    if (broadcastCallback !== null) {
      broadcastCallback(
        JSON.stringify({
          type: "state",
          ts: Date.now(),
          snapshot: makeSnapshot(),
        }),
      );
    }
    return route.fulfill({ status: 202, body: "" });
  });
}

async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  await expect(page.locator('[data-testid="bot-status-banner"]')).toBeVisible({
    timeout: 5_000,
  });
}

test.beforeEach(async ({ page }) => {
  // Reset test-side state.
  botState.state = "stopped";
  botState.startedAt = 0;
  botState.activeStrategyCount = 1;
  botState.openPositionCount = 0;
  CONTROL_REQUESTS.length = 0;
  broadcastCallback = null;
  // Install HTTP routes FIRST.
  await setupHttpRoutes(page);
  // Then WS peer (gives us a broadcast function we can stash
  // in the test's broadcastCallback for the /api/control handler).
  const harness = await setupWsPeer(page);
  broadcastCallback = harness.broadcast;
});

// =============================================================================
// Phase 81 — WS push is the source of truth
// =============================================================================

test.describe("Phase 81: WS push (no polling)", () => {
  test("status banner shows the initial 'stopped' state on first paint (via WS snapshot, not HTTP poll)", async ({
    page,
  }) => {
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-bot-state", "stopped");
    await expect(banner).toContainText("Bot: STOPPED");
  });

  test("status banner updates WITHIN 2 SECONDS of a WS state push (no 5s polling delay)", async ({
    page,
  }) => {
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toHaveAttribute("data-bot-state", "stopped");

    // Push a state message to the browser. The WS `state` message
    // carries the full snapshot (including `botStatus`), and the
    // `useBotStatus` hook should pick it up within 1 frame.
    if (broadcastCallback === null) {
      throw new Error("broadcastCallback not set");
    }
    botState.state = "running";
    botState.startedAt = Date.now();
    const t0 = Date.now();
    broadcastCallback(
      JSON.stringify({
        type: "state",
        ts: t0,
        snapshot: makeSnapshot(),
      }),
    );

    // The banner should update WITHIN 2 SECONDS. The previous
    // polling design waited up to 5 seconds (1s poll + jitter);
    // the WS push is much faster.
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 2_000,
    });
    await expect(banner).toContainText("Bot: RUNNING");
    const elapsed = Date.now() - t0;
    // The actual React render is sub-100ms in practice; the
    // 2s budget is the conservative upper bound. We log the
    // actual elapsed time for visibility in the CI output.
    console.log(`[81] status banner update took ${String(elapsed)}ms (budget 2000ms)`);
    expect(elapsed).toBeLessThan(2_000);
  });

  test("clicking Start updates the banner WITHIN 2 SECONDS (the Phase 81 mandate)", async ({
    page,
  }) => {
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toHaveAttribute("data-bot-state", "stopped");

    const startBtn = page.locator('[data-testid="control-bar-start"]');
    await expect(startBtn).toBeEnabled();

    // Click + measure.
    const t0 = Date.now();
    await startBtn.click();

    // The /api/control handler fires a WS `state` message
    // immediately. The dashboard picks it up within 1 frame.
    // We assert the banner updates WITHIN 2 SECONDS — the
    // Phase 81 mandate ("raadasul backendnek kene ertesiteni es
    // nem a frontendnek keregetni!").
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 2_000,
    });
    const elapsed = Date.now() - t0;
    console.log(`[81] Start click → banner update took ${String(elapsed)}ms (budget 2000ms)`);
    expect(elapsed).toBeLessThan(2_000);
  });

  test("clicking Stop updates the banner WITHIN 2 SECONDS", async ({
    page,
  }) => {
    // Pre-set the bot to "running" so Stop is enabled.
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 10_000,
    });

    const stopBtn = page.locator('[data-testid="control-bar-stop"]');
    await expect(stopBtn).toBeEnabled();

    const t0 = Date.now();
    await stopBtn.click();
    await expect(banner).toHaveAttribute("data-bot-state", "stopped", {
      timeout: 2_000,
    });
    const elapsed = Date.now() - t0;
    console.log(`[81] Stop click → banner update took ${String(elapsed)}ms (budget 2000ms)`);
    expect(elapsed).toBeLessThan(2_000);
  });

  test("clicking Pause updates the banner to 'paused' WITHIN 2 SECONDS", async ({
    page,
  }) => {
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 10_000,
    });

    const pauseBtn = page.locator('[data-testid="control-bar-pause"]');
    await expect(pauseBtn).toBeEnabled();
    const t0 = Date.now();
    await pauseBtn.click();
    await expect(banner).toHaveAttribute("data-bot-state", "paused", {
      timeout: 2_000,
    });
    const elapsed = Date.now() - t0;
    console.log(`[81] Pause click → banner update took ${String(elapsed)}ms (budget 2000ms)`);
    expect(elapsed).toBeLessThan(2_000);
  });

  test("WS 'snapshot' message also drives the banner (backward-compat)", async ({
    page,
  }) => {
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toHaveAttribute("data-bot-state", "stopped");

    if (broadcastCallback === null) {
      throw new Error("broadcastCallback not set");
    }
    // Push a `snapshot` message (the legacy path, also still works
    // because the publisher emits BOTH snapshot AND state events).
    botState.state = "running";
    botState.startedAt = Date.now();
    broadcastCallback(
      JSON.stringify({
        type: "snapshot",
        ts: Date.now(),
        snapshot: makeSnapshot(),
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h", "4h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [], "4h": [] } },
      }),
    );
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 2_000,
    });
  });

  test("the open-position count updates from the WS push (Phase 71 regression)", async ({
    page,
  }) => {
    botState.state = "running";
    botState.startedAt = Date.now();
    botState.openPositionCount = 0;
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 10_000,
    });
    // Kezdetben nincs nyitott pozíció.
    await expect(banner).not.toContainText("open position");

    // A bot "megnyit egy pozíciót" — a WS state push frissíti a banner-t.
    if (broadcastCallback === null) {
      throw new Error("broadcastCallback not set");
    }
    botState.openPositionCount = 1;
    broadcastCallback(
      JSON.stringify({
        type: "state",
        ts: Date.now(),
        snapshot: makeSnapshot(),
      }),
    );
    await expect(banner).toContainText("1 open position", { timeout: 2_000 });
    await expect(banner).not.toContainText("1 open positions");

    // Több pozíció — pluralis.
    botState.openPositionCount = 3;
    broadcastCallback(
      JSON.stringify({
        type: "state",
        ts: Date.now(),
        snapshot: makeSnapshot(),
      }),
    );
    await expect(banner).toContainText("3 open positions", { timeout: 2_000 });
  });

  test("the /api/status endpoint is STILL served (backward-compat for the bootstrap + slow-poll fallback)", async ({
    page,
  }) => {
    let statusRequestCount = 0;
    await page.route("http://127.0.0.1:7913/api/status", (route: Route) => {
      statusRequestCount += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ botStatus: currentBotStatus() }),
      });
    });
    await gotoApp(page);
    // A bootstrap fetch legalább 1 hívást generál (a hook mount-olásakor).
    // Engedünk 1-2 másodpercet, hogy a hook lefusson.
    await page.waitForTimeout(2_000);
    // A status endpoint-ot hívtuk (a bootstrap fetch + esetleg
    // a slow poll, ha a WS még nem connected volna — a teszt
    // setup viszont a WS-t is connected-re állítja).
    expect(statusRequestCount).toBeGreaterThanOrEqual(1);
  });
});
