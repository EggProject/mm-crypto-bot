/**
 * apps/web/e2e/69-status-panel.spec.ts
 *
 * Phase 69: e2e tests for the new dashboard status panel +
 * ControlBar HTTP wiring.
 *
 * **Strategy:** the tests use Playwright's `page.route` /
 * `page.routeWebSocket` to intercept all HTTP + WS traffic on the
 * TEST side. This is more reliable than relying on the MSW
 * browser worker (which has its own state, separate from the test
 * runner's process).
 *
 * The dashboard's full flow is exercised:
 *
 *   1. **Status banner renders** — the dashboard shows a banner
 *      below the topbar with the bot's high-level state
 *      (RUNNING / PAUSED / STOPPED).
 *
 *   2. **Status banner updates on bot state change** — when the
 *      user clicks the Start button (which calls POST /api/control),
 *      the test-side `/api/control` handler mutates the bot state
 *      and the next /api/status poll returns the new state. The
 *      banner updates accordingly.
 *
 *   3. **ControlBar button enable/disable** — the Start button is
 *      enabled when the bot is "stopped"; the Stop / Pause / Kill
 *      Switch buttons are enabled when the bot is "running"; the
 *      Resume button is enabled when the bot is "paused".
 *
 *   4. **ControlBar HTTP fetch** — the click handler calls
 *      `POST /api/control` (not the WS CONTROL message). The test
 *      captures the request via `page.on("request", ...)` so we
 *      can assert on the exact payload.
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";
import type { WebSocketRoute } from "@playwright/test";

// Phase 57: register coverage collection hooks.
installCoverageHooks("69-status-panel");

// =============================================================================
// Test state
// =============================================================================

/** The bot's mock state, shared across the test. */
const botState: {
  state: "running" | "paused" | "stopped";
  startedAt: number;
  activeStrategyCount: number;
  /**
   * Phase 71: a bot `positionManager.getPositions()` pillanatképe —
   * a `buildStatusBannerText` ezt használja a "N open position(s)"
   * suffix generálásához. Az e2e teszt dinamikusan állítja (a
   * pozíció-nyitás / zárás szimulációjához).
   */
  openPositionCount: number;
} = {
  state: "stopped",
  startedAt: 0,
  activeStrategyCount: 1,
  openPositionCount: 0,
};

const CONTROL_REQUESTS: { command: string; paused?: boolean; confirm?: boolean }[] = [];

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
        snapshot: { botStatus: currentBotStatus() },
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

function currentBotStatus(): {
  state: "running" | "paused" | "stopped";
  startedAt: number;
  lastUpdate: number;
  activeStrategyCount: number;
  positions: readonly { id: string; symbol: string; side: "buy" | "sell"; entryPrice: number; currentPrice: number; quantity: number; leverage: number; unrealizedPnl: number; unrealizedPnlPct: number; openedAt: number }[];
} {
  // Phase 71: a `positions` tömb `openPositionCount` alapján generálódik
  // (az e2e tesztnek nincs szüksége a pozíciók részletes adataira —
  // a `buildStatusBannerText` csak a `length`-et olvassa). A `mapPosition`
  // formátumot utánozzuk, hogy a `extractBotStatus` helyesen parse-olja.
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

async function setupHttpRoutes(page: Page): Promise<void> {
  // /api/strategies — serve a fixed 1-strategy list.
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
  // /api/ohlc — empty.
  await page.route("http://127.0.0.1:7913/api/ohlc", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ bars: [] }),
    });
  });
  // /api/health — OK.
  await page.route("http://127.0.0.1:7913/api/health", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, stateFeedConnected: true, hasSnapshot: true }),
    });
  });
  // /api/status — serve the current botState.
  await page.route("http://127.0.0.1:7913/api/status", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ botStatus: currentBotStatus() }),
    });
  });
  // /api/control — record the request + update botState.
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
  // The status banner should be present.
  await expect(page.locator('[data-testid="bot-status-banner"]')).toBeVisible({
    timeout: 5_000,
  });
}

test.beforeEach(async ({ page }) => {
  // Reset the test-side state.
  botState.state = "stopped";
  botState.startedAt = 0;
  botState.activeStrategyCount = 1;
  botState.openPositionCount = 0;
  CONTROL_REQUESTS.length = 0;
  // Install HTTP routes FIRST (so the dashboard's first /api/strategies
  // and /api/status fetches hit the mocks). The WS peer is set up
  // separately to give the test access to the WS handles.
  await setupHttpRoutes(page);
  await setupWsPeer(page);
});

// =============================================================================
// Status banner
// =============================================================================

test.describe("Phase 69: status banner", () => {
  test("renders the banner with the 'stopped' state on first paint", async ({
    page,
  }) => {
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-bot-state", "stopped");
    await expect(banner).toContainText("Bot: STOPPED");
  });

  test("updates the banner to 'running' after clicking Start", async ({
    page,
  }) => {
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toHaveAttribute("data-bot-state", "stopped");

    const startBtn = page.locator('[data-testid="control-bar-start"]');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // The /api/control handler flips the state immediately; the
    // next /api/status poll (or the 5s timer) picks up the new
    // state. We click and wait for the banner to flip.
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 10_000,
    });
    await expect(banner).toContainText("Bot: RUNNING");
  });

  test("updates the banner to 'paused' after clicking Pause", async ({
    page,
  }) => {
    // Pre-set the bot state to "running" via the test-side state.
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 10_000,
    });

    const pauseBtn = page.locator('[data-testid="control-bar-pause"]');
    await expect(pauseBtn).toBeEnabled();
    await pauseBtn.click();

    await expect(banner).toHaveAttribute("data-bot-state", "paused", {
      timeout: 10_000,
    });
    await expect(banner).toContainText("Bot: PAUSED");
  });

  test("includes the active strategy count in the banner", async ({
    page,
  }) => {
    botState.activeStrategyCount = 3;
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toContainText("3 active strategies");
  });

  // Phase 71: a banner "X open position(s)" suffix-ot is mutat, ha a
  // botnak van nyitott pozíciója. A "0 open positions" NEM jelenik meg
  // (a `buildStatusBannerText` a `> 0` check-et használja). Az 1
  // pozíció singularis, a 2+ pluralis.
  test("does NOT include 'open position' text when no positions are open (Phase 71)", async ({
    page,
  }) => {
    botState.openPositionCount = 0;
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toContainText("Bot: RUNNING");
    await expect(banner).not.toContainText("open position");
  });

  test("includes '1 open position' (singular) when 1 position is open (Phase 71)", async ({
    page,
  }) => {
    botState.openPositionCount = 1;
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toContainText("Bot: RUNNING");
    await expect(banner).toContainText("1 open position");
    // Singular (not plural)
    await expect(banner).not.toContainText("1 open positions");
  });

  test("includes 'N open positions' (plural) when >1 positions are open (Phase 71)", async ({
    page,
  }) => {
    botState.openPositionCount = 3;
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toContainText("Bot: RUNNING");
    await expect(banner).toContainText("3 open positions");
  });
});

// =============================================================================
// Phase 71: extractBotStatus defensive branches
// =============================================================================
//
// A `extractBotStatus` helper a WS /api/status válasz `botStatus` mezőjét
// parse-olja. A helper defensive validációt tartalmaz (Phase 71 — a
// positions tömböt is validálja). Ezek a branch-ek az e2e coverage gate
// miatt szükségesek: ha a bot state üzenet HIÁNYOS vagy SÉRÜLT
// positions tömböt tartalmaz, a dashboard nem crashelhet.
//
// A Phase 69 unit-tesztek (`apps/web/src/lib/__tests__/bot-status.test.ts`)
// EZEKET A BRANCH-EKET 100%-ban lefedik — az itteni e2e tesztek csak
// a "happy path" e2e coverage-t növelik.

test.describe("Phase 71: extractBotStatus defensive branches (e2e)", () => {
  test("handles a botStatus WITHOUT the positions field (Phase 69 backward-compat)", async ({
    page,
  }) => {
    // A teszt side botState NEM tartalmazza a positions tömböt.
    // A botState viszont a currentBotStatus()-on át kerül a /api/status
    // és a WS snapshot message-be — ehhez a teszthez saját WS peer-t
    // és HTTP route-ot állítunk be, ami a positions mező nélküli
    // botStatus-t küldi.
    const wsHarness = await setupWsPeer(page);
    await page.route("http://127.0.0.1:7913/api/strategies", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategies: [] }),
      }),
    );
    await page.route("http://127.0.0.1:7913/api/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          botStatus: {
            state: "running",
            startedAt: Date.now(),
            lastUpdate: Date.now(),
            activeStrategyCount: 1,
            // NINCS `positions` mező — a Phase 69 szerverek nem küldték.
          },
        }),
      }),
    );
    await page.goto("/");
    // Várunk, amíg a WS csatlakozik + a dashboard megjelenik.
    await wsHarness.waitForWsCount(1, 10_000);
    await expect(
      page.locator('[data-testid="bot-status-banner"]'),
    ).toContainText("Bot: RUNNING", { timeout: 10_000 });
  });

  test("handles a botStatus with positions that have an invalid side (defensive)", async ({
    page,
  }) => {
    // A botState-ban 1 pozíció van, de a side "long" (a "buy/sell"
    // helyett). Az extractBotStatus eldobja a pozíciót (a többi
    // pozíció megmarad), és a banner `positions.length === 0`-t mutat.
    const wsHarness = await setupWsPeer(page);
    await page.route("http://127.0.0.1:7913/api/strategies", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategies: [] }),
      }),
    );
    await page.route("http://127.0.0.1:7913/api/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          botStatus: {
            state: "running",
            startedAt: Date.now(),
            lastUpdate: Date.now(),
            activeStrategyCount: 1,
            positions: [
              {
                id: "invalid-side",
                symbol: "BTCUSDT",
                side: "long", // INVALID — a "buy/sell" helyett
                entryPrice: 60_000,
                currentPrice: 60_100,
                quantity: 0.01,
                leverage: 5,
                unrealizedPnl: 1,
                unrealizedPnlPct: 1.67,
                openedAt: 1000,
              },
            ],
          },
        }),
      }),
    );
    await page.goto("/");
    await wsHarness.waitForWsCount(1, 10_000);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    // Az invalid side miatt a pozíció eldobódik — a banner NEM
    // tartalmazza az "open position" szöveget.
    await expect(banner).not.toContainText("open position");
  });

  test("handles a botStatus with positions that have missing fields (defensive)", async ({
    page,
  }) => {
    // A botState 2 pozíciót tartalmaz — az 1. invalid (hiányzó mezők),
    // a 2. valid. A banner CSAK a valid pozíciót mutatja.
    const wsHarness = await setupWsPeer(page);
    await page.route("http://127.0.0.1:7913/api/strategies", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategies: [] }),
      }),
    );
    await page.route("http://127.0.0.1:7913/api/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          botStatus: {
            state: "running",
            startedAt: Date.now(),
            lastUpdate: Date.now(),
            activeStrategyCount: 1,
            positions: [
              { id: "invalid-missing-fields" }, // INVALID — minden mező hiányzik
              {
                id: "valid",
                symbol: "BTCUSDT",
                side: "buy",
                entryPrice: 60_000,
                currentPrice: 60_100,
                quantity: 0.01,
                leverage: 5,
                unrealizedPnl: 1,
                unrealizedPnlPct: 1.67,
                openedAt: 1000,
              },
            ],
          },
        }),
      }),
    );
    await page.goto("/");
    await wsHarness.waitForWsCount(1, 10_000);
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    // A valid pozíció megmarad — 1 open position.
    await expect(banner).toContainText("1 open position");
  });
});

// =============================================================================
// ControlBar enable/disable
// =============================================================================

test.describe("Phase 69: ControlBar button enable/disable", () => {
  test("'stopped' state: Start is enabled, all others are disabled", async ({
    page,
  }) => {
    await gotoApp(page);
    const startBtn = page.locator('[data-testid="control-bar-start"]');
    const stopBtn = page.locator('[data-testid="control-bar-stop"]');
    const pauseBtn = page.locator('[data-testid="control-bar-pause"]');
    const resumeBtn = page.locator('[data-testid="control-bar-resume"]');
    const killBtn = page.locator('[data-testid="control-bar-kill-switch"]');

    await expect(startBtn).toBeEnabled();
    await expect(stopBtn).toBeDisabled();
    await expect(pauseBtn).toBeDisabled();
    await expect(resumeBtn).toBeDisabled();
    await expect(killBtn).toBeDisabled();
  });

  test("'running' state: Start is disabled, Stop/Pause/Kill are enabled", async ({
    page,
  }) => {
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    await expect(
      page.locator('[data-testid="bot-status-banner"]'),
    ).toHaveAttribute("data-bot-state", "running", { timeout: 10_000 });

    const startBtn = page.locator('[data-testid="control-bar-start"]');
    const stopBtn = page.locator('[data-testid="control-bar-stop"]');
    const pauseBtn = page.locator('[data-testid="control-bar-pause"]');
    const resumeBtn = page.locator('[data-testid="control-bar-resume"]');
    const killBtn = page.locator('[data-testid="control-bar-kill-switch"]');

    await expect(startBtn).toBeDisabled();
    await expect(stopBtn).toBeEnabled();
    await expect(pauseBtn).toBeEnabled();
    await expect(resumeBtn).toBeDisabled();
    await expect(killBtn).toBeEnabled();
  });

  test("'paused' state: Resume + Kill are enabled, others are disabled", async ({
    page,
  }) => {
    botState.state = "paused";
    await gotoApp(page);
    await expect(
      page.locator('[data-testid="bot-status-banner"]'),
    ).toHaveAttribute("data-bot-state", "paused", { timeout: 10_000 });

    const startBtn = page.locator('[data-testid="control-bar-start"]');
    const stopBtn = page.locator('[data-testid="control-bar-stop"]');
    const pauseBtn = page.locator('[data-testid="control-bar-pause"]');
    const resumeBtn = page.locator('[data-testid="control-bar-resume"]');
    const killBtn = page.locator('[data-testid="control-bar-kill-switch"]');

    await expect(startBtn).toBeDisabled();
    await expect(stopBtn).toBeDisabled();
    await expect(pauseBtn).toBeDisabled();
    await expect(resumeBtn).toBeEnabled();
    await expect(killBtn).toBeEnabled();
  });
});

// =============================================================================
// ControlBar HTTP fetch wiring
// =============================================================================

test.describe("Phase 69: ControlBar HTTP fetch", () => {
  test("clicking Start sends POST /api/control with { command: 'start' }", async ({
    page,
  }) => {
    await gotoApp(page);
    const startBtn = page.locator('[data-testid="control-bar-start"]');
    await startBtn.click();
    await page.waitForTimeout(100);
    expect(CONTROL_REQUESTS.length).toBe(1);
    expect(CONTROL_REQUESTS[0]?.command).toBe("start");
  });

  test("clicking Stop sends POST /api/control with { command: 'stop' }", async ({
    page,
  }) => {
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    await expect(
      page.locator('[data-testid="bot-status-banner"]'),
    ).toHaveAttribute("data-bot-state", "running", { timeout: 10_000 });

    const stopBtn = page.locator('[data-testid="control-bar-stop"]');
    await stopBtn.click();
    await page.waitForTimeout(100);
    expect(CONTROL_REQUESTS.length).toBe(1);
    expect(CONTROL_REQUESTS[0]?.command).toBe("stop");
  });

  test("clicking Pause sends POST /api/control with paused: true", async ({
    page,
  }) => {
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    await expect(
      page.locator('[data-testid="bot-status-banner"]'),
    ).toHaveAttribute("data-bot-state", "running", { timeout: 10_000 });

    const pauseBtn = page.locator('[data-testid="control-bar-pause"]');
    await pauseBtn.click();
    await page.waitForTimeout(100);
    expect(CONTROL_REQUESTS.length).toBe(1);
    expect(CONTROL_REQUESTS[0]?.command).toBe("pause");
    expect(CONTROL_REQUESTS[0]?.paused).toBe(true);
  });

  test("clicking Resume sends POST /api/control with paused: false", async ({
    page,
  }) => {
    botState.state = "paused";
    await gotoApp(page);
    await expect(
      page.locator('[data-testid="bot-status-banner"]'),
    ).toHaveAttribute("data-bot-state", "paused", { timeout: 10_000 });

    const resumeBtn = page.locator('[data-testid="control-bar-resume"]');
    await resumeBtn.click();
    await page.waitForTimeout(100);
    expect(CONTROL_REQUESTS.length).toBe(1);
    expect(CONTROL_REQUESTS[0]?.command).toBe("pause");
    expect(CONTROL_REQUESTS[0]?.paused).toBe(false);
  });

  test("clicking Kill Switch with confirm=true sends the right payload", async ({
    page,
  }) => {
    botState.state = "running";
    botState.startedAt = Date.now();
    await gotoApp(page);
    await expect(
      page.locator('[data-testid="bot-status-banner"]'),
    ).toHaveAttribute("data-bot-state", "running", { timeout: 10_000 });

    page.on("dialog", (d) => {
      void d.accept();
    });

    const killBtn = page.locator('[data-testid="control-bar-kill-switch"]');
    await killBtn.click();
    await page.waitForTimeout(100);
    expect(CONTROL_REQUESTS.length).toBe(1);
    expect(CONTROL_REQUESTS[0]?.command).toBe("kill_switch");
    expect(CONTROL_REQUESTS[0]?.confirm).toBe(true);
  });
});
