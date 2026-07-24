/**
 * apps/web/e2e/69-chart-grid-vertical.spec.ts
 *
 * Phase 69: e2e tests for the vertical ChartGrid layout.
 *
 * The dashboard renders 9 charts (3 symbols × 3 timeframes) in a
 * single column, each full-width and ~420px tall. The previous
 * layout was a 3×3 grid (auto-fit + minmax(360px)).
 *
 * **Strategy:** the test uses `page.route` to serve a 3-symbol
 * × 3-timeframe strategies list, then asserts on the rendered
 * grid layout (flex column, 9 cards, each >= 400px tall).
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

// Phase 57: register coverage collection hooks.
installCoverageHooks("69-chart-grid-vertical");

// =============================================================================
// Test helpers
// =============================================================================

async function setupHttpRoutes(page: Page): Promise<void> {
  // /api/strategies — 3 strategies × 3 symbols × 3 timeframes = 9 cards.
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
  // /api/ohlc — empty (the chart cards render the loading state).
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
  // /api/status — stopped bot.
  await page.route("http://127.0.0.1:7913/api/status", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        botStatus: {
          state: "stopped",
          startedAt: 0,
          lastUpdate: Date.now(),
          activeStrategyCount: 1,
        },
      }),
    });
  });
  // /api/control — 202 Accepted.
  await page.route("http://127.0.0.1:7913/api/control", (route: Route) => {
    return route.fulfill({ status: 202, body: "" });
  });
}

async function setupWsPeer(page: Page): Promise<void> {
  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
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
            state: "stopped",
            startedAt: 0,
            lastUpdate: Date.now(),
            activeStrategyCount: 1,
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
  await setupHttpRoutes(page);
  await setupWsPeer(page);
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  await expect(page.locator('[data-testid="chart-grid"]')).toBeVisible();
}

// =============================================================================
// Vertical layout
// =============================================================================

test.describe("Phase 69: ChartGrid vertical layout", () => {
  test("the grid is a vertical flex column", async ({ page }) => {
    await gotoApp(page);
    const grid = page.locator('[data-testid="chart-grid"]');
    const display = await grid.evaluate(
      (el) => window.getComputedStyle(el).display,
    );
    const flexDir = await grid.evaluate(
      (el) => window.getComputedStyle(el).flexDirection,
    );
    expect(display).toBe("flex");
    expect(flexDir).toBe("column");
  });

  test("each chart card is at least 400px tall (Phase 69 spec)", async ({
    page,
  }) => {
    await gotoApp(page);
    const cards = page.locator(".ep-chart-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const minHeight = await cards
        .nth(i)
        .evaluate((el) => window.getComputedStyle(el).minHeight);
      const px = parseFloat(minHeight);
      expect(px).toBeGreaterThanOrEqual(400);
    }
  });

  test("9 charts render (3 symbols × 3 timeframes)", async ({ page }) => {
    await gotoApp(page);
    // 1 strategy × 3 symbols × 3 timeframes = 9 cards.
    const cards = page.locator(".ep-chart-card");
    await expect(cards).toHaveCount(9);
  });

  test("the grid is a single column (cards stack vertically)", async ({
    page,
  }) => {
    await gotoApp(page);
    // The Phase 69 layout is `display: flex; flex-direction: column;`.
    // The first 2 cards should have approximately the same left-edge
    // x-coordinate (they're stacked vertically, not horizontally).
    const cards = page.locator(".ep-chart-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(1);
    const firstBox = await cards.first().boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    if (firstBox !== null && secondBox !== null) {
      // The first card's right edge should be near the second card's
      // right edge (same column width, not split into 3 columns).
      const widthDelta = Math.abs(firstBox.width - secondBox.width);
      expect(widthDelta).toBeLessThan(2);
      // The second card should be BELOW the first (not next to it).
      expect(secondBox.y).toBeGreaterThan(firstBox.y);
    }
  });
});
