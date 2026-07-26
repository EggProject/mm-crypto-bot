/**
 * apps/web/e2e/76-all-strategies-on-charts.spec.ts
 *
 * Phase 76: e2e tests for the "show ALL strategies on the chart"
 * user mandate ("minden strategiat a chartokon meg kell jeleniteni").
 *
 * **The bug:** before Phase 76, the `ChartGrid` filtered strategies
 * by `enabled === true`, so a config that listed 3 strategies
 * (donchian_pivot_composition + dydx_cex_carry + cascade_fade) but
 * enabled only 1 rendered 1 strategy × 9 (symbol, tf) cards = 9
 * cards, instead of 3 strategies × 9 (symbol, tf) = 27 cards.
 *
 * **The fix:** the prior `if (!strat.enabled) continue;` filter in
 * `ChartGrid.tsx` is REMOVED. The chart now renders one card per
 * (strategy, symbol, tf) regardless of `enabled`. The `enabled`
 * flag is preserved on the descriptor and forwarded to the
 * `ChartCard`, which adds a "(disabled)" suffix to the chrome
 * title for visual clarity.
 *
 * **What these tests assert:**
 *   1. With 3 strategies (1 enabled, 2 disabled), the grid renders
 *      3 × 3 (symbol, tf) = 27 cards.
 *   2. The enabled strategy's title has NO "(disabled)" suffix.
 *   3. The disabled strategies' titles DO have "(disabled)" suffix.
 *   4. The `data-strategy-enabled` attribute is "true" / "false"
 *      matching the descriptor's flag.
 *
 * **Test isolation:** these tests use `page.route` (no live bot)
 * to serve a deterministic /api/strategies response with mixed
 * `enabled` flags. They do NOT touch the live bot on 7913.
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
// Phase 57: register coverage collection hooks.
setSpecName("76-all-strategies-on-charts");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});
// =============================================================================
// Test helpers
// =============================================================================

/**
 * `THREE_STRATEGIES_MIXED` — 3 strategies, 1 enabled + 2 disabled.
 * Matches the user-described config: donchian_pivot_composition
 * (the only one actually running in the backtest-verified paper
 * config) + dydx_cex_carry + cascade_fade (configured but not
 * running because bybit.eu is spot-only).
 */
const THREE_STRATEGIES_MIXED = [
  {
    name: "donchian_pivot_composition",
    enabled: true,
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    timeframes: ["1h", "4h", "1d"],
  },
  {
    name: "dydx_cex_carry",
    enabled: false,
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    timeframes: ["1h", "4h", "1d"],
  },
  {
    name: "cascade_fade",
    enabled: false,
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    timeframes: ["1h", "4h", "1d"],
  },
] as const;

async function setupHttpRoutes(
  page: Page,
  strategies: readonly {
    readonly name: string;
    readonly enabled: boolean;
    readonly symbols: readonly string[];
    readonly timeframes: readonly string[];
  }[],
): Promise<void> {
  await page.route("http://127.0.0.1:7913/api/strategies", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ strategies }),
    });
  });
  // /api/ohlc — empty (cards render the loading state).
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
  await page.route("http://127.0.0.1:7913/api/status", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        botStatus: {
          state: "running",
          startedAt: Date.now() - 60_000,
          lastUpdate: Date.now(),
          activeStrategyCount: strategies.filter((s) => s.enabled).length,
        },
      }),
    });
  });
  await page.route("http://127.0.0.1:7913/api/control", (route: Route) => {
    return route.fulfill({ status: 202, body: "" });
  });
}

async function setupWsPeer(
  page: Page,
  strategies: readonly {
    readonly name: string;
    readonly enabled: boolean;
    readonly symbols: readonly string[];
    readonly timeframes: readonly string[];
  }[],
): Promise<void> {
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
            state: "running",
            startedAt: Date.now() - 60_000,
            lastUpdate: Date.now(),
            activeStrategyCount: strategies.filter((s) => s.enabled).length,
          },
        },
        strategies,
        ohlcBootstrap: Object.fromEntries(
          ["BTCUSDT", "ETHUSDT", "SOLUSDT"].map((sym) => [
            sym,
            Object.fromEntries(["1h", "4h", "1d"].map((tf) => [tf, []])),
          ]),
        ),
      }),
    );
  });
}

async function gotoApp(
  page: Page,
  strategies: readonly {
    readonly name: string;
    readonly enabled: boolean;
    readonly symbols: readonly string[];
    readonly timeframes: readonly string[];
  }[],
): Promise<void> {
  await setupHttpRoutes(page, strategies);
  await setupWsPeer(page, strategies);
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  // PHASE 80: when ZERO strategies are enabled, the ChartGrid renders
  // `<div data-testid="chart-grid-empty">` (the "No charts configured"
  // message) INSTEAD of `<div data-testid="chart-grid">`. The previous
  // assertion `expect(chart-grid).toBeVisible()` would fail on that
  // path even though the page rendered correctly. We now wait for
  // EITHER the populated grid OR the empty-state placeholder, so the
  // helper works for both "with strategies" and "all-disabled" cases.
  // This is the same shape as the production code's
  // `hasAnyEnabledStrategy` branch in `apps/web/src/components/ChartGrid.tsx:347`.
  await expect(
    page
      .locator('[data-testid="chart-grid"], [data-testid="chart-grid-empty"]')
      .first(),
  ).toBeVisible();
}

// =============================================================================
// Test suite
// =============================================================================

test.describe("Phase 76: show ALL strategies on the chart", () => {
  test("with 3 strategies (1 enabled + 2 disabled), 27 cards render", async ({ page }) => {
    await gotoApp(page, THREE_STRATEGIES_MIXED);
    // 3 strategies × 3 symbols × 3 timeframes = 27 cards.
    const cards = page.locator(".line-chart-wrapper");
    await expect(cards).toHaveCount(27);
  });

  test("the enabled strategy's title has NO '(disabled)' suffix", async ({ page }) => {
    await gotoApp(page, THREE_STRATEGIES_MIXED);
    const enabledTitle = page
      .locator(".line-chart-wrapper[data-strategy='donchian_pivot_composition']")
      .first()
      .locator(".line-chart-wrapper__title");
    await expect(enabledTitle).toHaveText("donchian_pivot_composition");
    await expect(enabledTitle).not.toContainText("(disabled)");
  });

  test("the disabled strategies' titles DO have '(disabled)' suffix", async ({ page }) => {
    await gotoApp(page, THREE_STRATEGIES_MIXED);
    // dydx_cex_carry is disabled
    const dydxTitle = page
      .locator(".line-chart-wrapper[data-strategy='dydx_cex_carry']")
      .first()
      .locator(".line-chart-wrapper__title");
    await expect(dydxTitle).toContainText("dydx_cex_carry");
    await expect(dydxTitle).toContainText("(disabled)");
    // cascade_fade is disabled
    const cascadeTitle = page
      .locator(".line-chart-wrapper[data-strategy='cascade_fade']")
      .first()
      .locator(".line-chart-wrapper__title");
    await expect(cascadeTitle).toContainText("cascade_fade");
    await expect(cascadeTitle).toContainText("(disabled)");
  });

  test("data-strategy-enabled attribute reflects the enabled flag", async ({ page }) => {
    await gotoApp(page, THREE_STRATEGIES_MIXED);
    // The wrapping .ep-chart-card carries data-strategy-enabled
    // (the inner .line-chart-wrapper always says data-strategy).
    const enabledCard = page
      .locator(".ep-chart-card[data-strategy='donchian_pivot_composition']")
      .first();
    await expect(enabledCard).toHaveAttribute("data-strategy-enabled", "true");
    const dydxCard = page
      .locator(".ep-chart-card[data-strategy='dydx_cex_carry']")
      .first();
    await expect(dydxCard).toHaveAttribute("data-strategy-enabled", "false");
    const cascadeCard = page
      .locator(".ep-chart-card[data-strategy='cascade_fade']")
      .first();
    await expect(cascadeCard).toHaveAttribute("data-strategy-enabled", "false");
  });

  test("with ALL 3 strategies enabled, no '(disabled)' suffix anywhere", async ({ page }) => {
    const allEnabled = THREE_STRATEGIES_MIXED.map((s) => ({ ...s, enabled: true }));
    await gotoApp(page, allEnabled);
    // Wait for the /api/strategies fetch to update the grid from the
    // 1-strategy default to the 3-strategy mocked response. Otherwise
    // the test races the React re-render and sees the default 2 cards.
    await expect(page.locator(".line-chart-wrapper")).toHaveCount(27);
    const titles = page.locator(".line-chart-wrapper__title");
    const count = await titles.count();
    expect(count).toBe(27);
    for (let i = 0; i < count; i++) {
      await expect(titles.nth(i)).not.toContainText("(disabled)");
    }
  });

  test("with ZERO enabled strategies, the grid shows the empty state", async ({ page }) => {
    const allDisabled = THREE_STRATEGIES_MIXED.map((s) => ({ ...s, enabled: false }));
    await gotoApp(page, allDisabled);
    // The empty-state branch fires when hasAnyEnabledStrategy is false,
    // so the user sees the "No charts configured" message instead of
    // 27 cards all marked (disabled).
    await expect(page.locator('[data-testid="chart-grid-empty"]')).toBeVisible();
  });
});
