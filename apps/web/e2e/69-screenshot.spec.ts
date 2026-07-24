/**
 * apps/web/e2e/69-screenshot.spec.ts
 *
 * Phase 69: take a final dashboard screenshot showing the 3
 * user-facing improvements:
 *
 *   1. Vertical chart grid (9 charts in a single column)
 *   2. Bot status banner (RUNNING / STOPPED / PAUSED)
 *   3. Working Start/Stop/Pause/Resume/Kill Switch buttons
 *
 * The screenshot is saved to `coverage/playwright/screenshots/phase-69.png`
 * AND copied to `.mavis/notes/phase-69-dashboard.png` (the
 * user-facing artifact for the PR body).
 *
 * **Setup:** uses `page.route` to serve 3 symbols × 3 timeframes
 * (9 cards) + a WS peer for the state feed. The bot starts
 * "stopped", the user clicks "Start", the banner flips to
 * "running", and we screenshot the dashboard.
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

installCoverageHooks("69-screenshot");

// `import.meta.dir` is bun-specific; Playwright runs the spec in
// Node ESM, where we need the `fileURLToPath(import.meta.url)`
// dance. The spec lives at `apps/web/e2e/69-screenshot.spec.ts`,
// so two `..`s take us to `apps/web/`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APPS_WEB = resolve(__dirname, "..");
const SCREENSHOT_DIR = resolve(APPS_WEB, "coverage/playwright/screenshots");
const SCREENSHOT_PATH = resolve(SCREENSHOT_DIR, "phase-69.png");
const NOTES_DIR = resolve(APPS_WEB, "../../.mavis/notes");
const NOTES_SCREENSHOT_PATH = resolve(NOTES_DIR, "phase-69-dashboard.png");

interface BotState {
  state: "running" | "paused" | "stopped";
  startedAt: number;
  activeStrategyCount: number;
}

const botState: BotState = {
  state: "stopped",
  startedAt: 0,
  activeStrategyCount: 3,
};

async function setupRoutes(page: Page): Promise<void> {
  // /api/strategies — 3 symbols × 3 timeframes = 9 cards.
  await page.route("http://127.0.0.1:7913/api/strategies", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
            timeframes: ["1h", "4h", "1d"],
          },
        ],
      }),
    });
  });
  // /api/ohlc — empty (the chart cards render empty bars).
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
      body: JSON.stringify({
        ok: true,
        stateFeedConnected: true,
        hasSnapshot: true,
      }),
    });
  });
  // /api/status — serve the current bot state.
  await page.route("http://127.0.0.1:7913/api/status", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        botStatus: {
          state: botState.state,
          startedAt: botState.startedAt,
          lastUpdate: Date.now(),
          activeStrategyCount: botState.activeStrategyCount,
        },
      }),
    });
  });
  // /api/control — update the bot state.
  await page.route("http://127.0.0.1:7913/api/control", async (route: Route) => {
    const body = (await route.request().postDataJSON()) as {
      command: string;
    };
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
  // WS peer — drive the dashboard to "connected".
  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws: WebSocketRoute) => {
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
        snapshot: {
          botStatus: {
            state: botState.state,
            startedAt: botState.startedAt,
            lastUpdate: Date.now(),
            activeStrategyCount: botState.activeStrategyCount,
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
            timeframes: ["1h", "4h", "1d"],
          },
        ],
        ohlcBootstrap: {
          BTCUSDT: { "1h": [], "4h": [], "1d": [] },
          ETHUSDT: { "1h": [], "4h": [], "1d": [] },
          SOLUSDT: { "1h": [], "4h": [], "1d": [] },
        },
      }),
    );
  });
}

async function gotoApp(page: Page): Promise<void> {
  await setupRoutes(page);
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  await expect(page.locator('[data-testid="chart-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="bot-status-banner"]')).toBeVisible();
}

test.describe("Phase 69: deployment screenshot", () => {
  test("9 vertical charts + status banner + working buttons", async ({
    page,
  }) => {
    await gotoApp(page);

    // 1) Verify 9 chart cards rendered.
    const cards = page.locator(".ep-chart-card");
    await expect(cards).toHaveCount(9);

    // 2) Verify the grid is a single column.
    const grid = page.locator('[data-testid="chart-grid"]');
    const display = await grid.evaluate(
      (el) => window.getComputedStyle(el).display,
    );
    const flexDir = await grid.evaluate(
      (el) => window.getComputedStyle(el).flexDirection,
    );
    expect(display).toBe("flex");
    expect(flexDir).toBe("column");

    // 3) Verify the status banner is present + showing the initial
    //    "stopped" state.
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-bot-state", "stopped");
    await expect(banner).toContainText("Bot: STOPPED");

    // 4) Verify the ControlBar is present with the 5 buttons.
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

    // 5) Click Start — the banner should flip to "running" and
    //    the buttons should re-enable accordingly.
    await startBtn.click();
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 10_000,
    });
    await expect(startBtn).toBeDisabled();
    await expect(stopBtn).toBeEnabled();
    await expect(pauseBtn).toBeEnabled();
    await expect(resumeBtn).toBeDisabled();
    await expect(killBtn).toBeEnabled();

    // 6) Take the full-page screenshot. Save to the standard
    //    coverage/screenshots path AND copy to the user-facing
    //    .mavis/notes/ path.
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    expect(existsSync(SCREENSHOT_PATH)).toBe(true);

    // Copy to the user-facing notes path.
    mkdirSync(NOTES_DIR, { recursive: true });
    copyFileSync(SCREENSHOT_PATH, NOTES_SCREENSHOT_PATH);
    expect(existsSync(NOTES_SCREENSHOT_PATH)).toBe(true);
  });
});
