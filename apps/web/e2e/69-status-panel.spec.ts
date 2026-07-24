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
} = {
  state: "stopped",
  startedAt: 0,
  activeStrategyCount: 1,
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
} {
  return {
    state: botState.state,
    startedAt: botState.startedAt,
    lastUpdate: Date.now(),
    activeStrategyCount: botState.activeStrategyCount,
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
