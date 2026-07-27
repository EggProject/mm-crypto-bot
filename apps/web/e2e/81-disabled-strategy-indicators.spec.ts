/**
 * apps/web/e2e/81-disabled-strategy-indicators.spec.ts
 *
 * Phase 81: e2e tests for the strategy-specific indicators on the 4
 * DISABLED strategies (dydx_cex_carry, cascade_fade,
 * funding_flip_kill_switch, regime_detector).
 *
 * **The user mandate (Phase 81):**
 *   "a tobbi strategianal is biztos hogy jopar dolgot lehetne meg jelolni
 *   akar chart rajzol vagy indicator formajaban"
 *
 * The 4 disabled strategies must show strategy-specific drawings on
 * their charts — not just the universal Donchian band fallback. The
 * indicators are computed CLIENT-SIDE from the bar stream (the user
 * mandate is to NOT touch strategy code):
 *
 *   - `dydx_cex_carry`           → 3 lines (donchian + funding_rate
 *                                  + funding_spread) + 1 marker
 *                                  (funding_paid every 8 bars)
 *   - `cascade_fade`             → 1 line (donchian) + 1 marker
 *                                  (cascade_events at >2% bar-to-bar
 *                                  moves)
 *   - `funding_flip_kill_switch` → 2 lines (donchian + funding_rate)
 *                                  + 1 marker (funding_flips at
 *                                  every sign-change point)
 *   - `regime_detector`          → 1 line (donchian) + 1 marker
 *                                  (regime_changes at every
 *                                  trending/ranging/volatile
 *                                  transition)
 *
 * **Test strategy:**
 *   1. Mock /api/strategies with 1 enabled + 4 disabled strategies.
 *   2. Open the dashboard with bars that trigger cascade events,
 *      funding flips, and regime changes (so the markers are
 *      visible).
 *   3. For each disabled strategy, assert that the chart has the
 *      expected number of line series + marker indicators.
 *   4. The verification uses the React fiber walk to find the
 *      ChartCard instances and read the `indicatorRefs.current` /
 *      `markerDisposersRef.current` arrays.
 *
 * **Test isolation:** these tests use `page.route` (no live bot) to
 * serve a deterministic /api/strategies response. They do NOT touch
 * the live bot on 7913.
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
// Phase 57: register coverage collection hooks.
setSpecName("81-disabled-strategy-indicators");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// =============================================================================
// Test fixtures
// =============================================================================

/**
 * `ALL_FIVE_STRATEGIES` — 1 enabled + 4 disabled. Matches the
 * `paper-backtest-verified.toml` config (1 strategy enabled, 4
 * configured-but-disabled).
 */
const ALL_FIVE_STRATEGIES = [
  {
    name: "donchian_pivot_composition",
    enabled: true,
    symbols: ["BTCUSDT"],
    timeframes: ["1h"],
  },
  {
    name: "dydx_cex_carry",
    enabled: false,
    symbols: ["BTCUSDT"],
    timeframes: ["1h"],
  },
  {
    name: "cascade_fade",
    enabled: false,
    symbols: ["BTCUSDT"],
    timeframes: ["1h"],
  },
  {
    name: "funding_flip_kill_switch",
    enabled: false,
    symbols: ["BTCUSDT"],
    timeframes: ["1h"],
  },
  {
    name: "regime_detector",
    enabled: false,
    symbols: ["BTCUSDT"],
    timeframes: ["1h"],
  },
] as const;

/**
 * `makeBarsWithCascades` — 30 bars with 2 deliberate cascade events
 * at indices 9 and 19. The cascade is a >2% bar-to-bar move that
 * triggers the `cascadeMarkerIndicator`. The intermediate
 * pattern (rising, then falling, then rising) also triggers:
 *   - `funding_flip_kill_switch`: funding-flip markers (sign
 *     change of the funding rate between rising and falling).
 *   - `regime_detector`: regime change markers (the rolling
 *     mean + std classifier flips between "ranging" and
 *     "trending" as the price moves).
 *   - `dydx_cex_carry`: the funding rate line shows the
 *     synthesized carry.
 */
function makeBarsWithCascades(): readonly {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}[] {
  const intervalMs = 60 * 60_000; // 1h
  const now = Date.now();
  const out: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[] = [];
  // The pattern: 9 rising bars, then a +3% cascade, then 9
  // falling bars, then a -3% cascade, then 10 rising bars.
  // This creates 2 cascade events and 2 funding flips.
  const closes: number[] = [
    100, 101, 102, 103, 104, 105, 106, 107, 108,
    111.5, // +3.2% (cascade 1)
    112, 111, 110, 109, 108, 107, 106, 105, 104,
    100.5, // -3.4% (cascade 2)
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
  ];
  for (let i = 0; i < closes.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const close = closes[i] as number;
    out.push({
      time: now - (closes.length - 1 - i) * intervalMs,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100 + i,
    });
  }
  return out;
}

async function setupHttpRoutes(page: Page): Promise<void> {
  await page.route("http://127.0.0.1:7913/api/strategies", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ strategies: ALL_FIVE_STRATEGIES }),
    });
  });
  await page.route("http://127.0.0.1:7913/api/ohlc", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ bars: makeBarsWithCascades() }),
    });
  });
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
  await page.route("http://127.0.0.1:7913/api/status", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        botStatus: {
          state: "running",
          startedAt: Date.now() - 60_000,
          lastUpdate: Date.now(),
          activeStrategyCount: 1,
        },
      }),
    });
  });
  await page.route("http://127.0.0.1:7913/api/control", (route: Route) => {
    return route.fulfill({ status: 202, body: "" });
  });
}

async function setupWsPeer(page: Page): Promise<void> {
  const bars = makeBarsWithCascades();
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
            activeStrategyCount: 1,
          },
        },
        strategies: ALL_FIVE_STRATEGIES,
        ohlcBootstrap: {
          BTCUSDT: { "1h": bars },
        },
      }),
    );
    ws.send(
      JSON.stringify({
        type: "state",
        ts: Date.now(),
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: Date.now() - 60_000,
            lastUpdate: Date.now(),
            activeStrategyCount: 1,
          },
        },
        positions: [],
        closedTrades: [],
        killSwitch: "off",
        paused: false,
        statistics: { trades: 0, pnl: 0, drawdown: 0 },
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
  // Wait for the 5 strategy cards to render.
  await expect(page.locator(".line-chart-wrapper")).toHaveCount(5, {
    timeout: 10_000,
  });
}

// =============================================================================
// React Fiber Tree helper — find the ChartCard instance for a given strategy
// =============================================================================

/**
 * `getChartCardState(page, strategyName)` — walk the React fiber
 * tree to find the ChartCard component for `strategyName` and
 * return its `indicatorRefs.current.length` (number of line
 * indicators) and `markerDisposersRef.current.length` (number
 * of marker indicators).
 *
 * Each ChartCard stores its rendered indicators in a `useRef`,
 * and the markers in another `useRef`. The fiber walk finds
 * these refs by walking the hook list of every fiber.
 */
async function getChartCardState(
  page: Page,
  strategyName: string,
): Promise<{
  lineSeriesCount: number;
  lineCount: number;
  markerCount: number;
}> {
  return page.evaluate(`
    (function() {
      function findChartCardState() {
        var rootEl = document.getElementById('root');
        if (rootEl === null) throw new Error('no #root');
        var containerKey = Object.keys(rootEl).find(function(k) {
          return k.indexOf('__reactContainer$') === 0;
        });
        if (containerKey === undefined) throw new Error('no __reactContainer$');
        var container = rootEl[containerKey];
        if (container === undefined || container.stateNode === undefined) {
          throw new Error('no container stateNode');
        }
        var rootFiber = container.stateNode.current;
        if (rootFiber == null) throw new Error('no root fiber');
        // The .line-chart-wrapper elements have a data-strategy
        // attribute. We find them and walk UP to the React fiber
        // via the DOM element's key, then into the chart card's
        // hooks.
        var targetWrapper = document.querySelector(
          '.line-chart-wrapper[data-strategy="${strategyName}"]'
        );
        if (targetWrapper === null) {
          return { lineSeriesCount: -1, lineCount: -1, markerCount: -1 };
        }
        // The .line-chart-wrapper is a <section> inside the
        // ChartCard component. The fiber key on the section
        // is one of the __reactFiber$... properties.
        var fiberKey = Object.keys(targetWrapper).find(function(k) {
          return k.indexOf('__reactFiber$') === 0;
        });
        if (fiberKey === undefined) return { lineSeriesCount: -1, lineCount: -1, markerCount: -1 };
        var fiber = targetWrapper[fiberKey];
        if (fiber === undefined) return { lineSeriesCount: -1, lineCount: -1, markerCount: -1 };
        // Walk up the fiber tree to find the ChartCard component
        // (the .line-chart-wrapper is the section returned by
        // ChartCard; the ChartCard's hooks are on the fiber
        // itself, not the section's host fiber).
        // The ChartCard's component fiber is the one whose
        // type.name === 'ChartCard'. We can also walk up via
        // fiber.return until we find a fiber with a memoizedState
        // that has the indicatorRefs.
        var f = fiber;
        var foundLineCount = -1;
        var foundLineIndicatorCount = -1;
        var foundMarkerCount = -1;
        var safety = 0;
        while (f != null) {
          if (++safety > 200) break;
          if (
            f.memoizedState != null &&
            typeof f.memoizedState === 'object'
          ) {
            // Walk the hook list — the ChartCard has 6 refs:
            //   - containerRef (null)
            //   - chartRef (IChartApi)
            //   - seriesRef (ISeriesApi)
            //   - markersRef (plugin)
            //   - indicatorRefs (RenderedIndicator[])
            //   - markerDisposersRef (() => void[])
            // We need to find the one with the right shape.
            var hook = f.memoizedState;
            var hookSafety = 0;
            while (hook != null) {
              if (++hookSafety > 30) break;
              var refObj = hook.memoizedState;
              if (
                refObj != null &&
                typeof refObj === 'object' &&
                'current' in refObj
              ) {
                var cur = refObj.current;
                if (Array.isArray(cur) && cur.length > 0) {
                  var first = cur[0];
                  if (
                    first != null &&
                    typeof first === 'object' &&
                    'series' in first &&
                    'name' in first
                  ) {
                    // indicatorRefs.current = RenderedIndicator[]
                    // We track TWO counts:
                    //   - lineSeriesCount: the TOTAL number of
                    //     line series across all indicators
                    //     (used by the 4 disabled-strategy tests
                    //     to assert exact sub-line counts).
                    //   - lineCount: the number of LINE
                    //     INDICATORS (i.e. the length of the
                    //     indicatorRefs array; used by the
                    //     donchian_pivot_composition test which
                    //     is now indicator-count-based because
                    //     adding Bollinger + daily pivot in
                    //     PR #214 grew the sub-line count
                    //     non-linearly).
                    var lineCount = 0;
                    var lineIndicatorCount = 0;
                    for (var i = 0; i < cur.length; i++) {
                      if (
                        cur[i] != null &&
                        Array.isArray(cur[i].series) &&
                        cur[i].series.length > 0
                      ) {
                        lineCount += cur[i].series.length;
                        lineIndicatorCount += 1;
                      }
                    }
                    foundLineCount = lineCount;
                    foundLineIndicatorCount = lineIndicatorCount;
                  } else if (
                    first != null &&
                    typeof first === 'function'
                  ) {
                    // markerDisposersRef.current = (() => void)[]
                    foundMarkerCount = cur.length;
                  }
                }
              }
              hook = hook.next;
            }
          }
          if (foundLineCount > 0 || foundMarkerCount >= 0) break;
          f = f.return;
        }
        return {
          lineSeriesCount: foundLineCount,
          lineCount: foundLineIndicatorCount,
          markerCount: foundMarkerCount,
        };
      }
      return findChartCardState();
    })()
  `) as Promise<{
    lineSeriesCount: number;
    lineCount: number;
    markerCount: number;
  }>;
}

// =============================================================================
// Tests
// =============================================================================

test.describe("Phase 81: strategy-specific indicators for the 4 disabled strategies", () => {
  test("all 5 strategies render (1 enabled + 4 disabled)", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator(".line-chart-wrapper")).toHaveCount(5);
  });

  test("donchian_pivot_composition (enabled) has 3 line indicators with line series + 1 marker", async ({ page }) => {
    await gotoApp(page);
    const state = await getChartCardState(page, "donchian_pivot_composition");
    // 4 line indicators in the registry (donchian + rolling
    // pivot + bollinger + daily_pivot), but `getChartCardState`
    // counts only those with at least 1 line series. The Phase
    // 82 redesign rewrote `renderDailyPivot` to use
    // `candleSeries.createPriceLine()` (3 horizontal price
    // lines on the candle series) instead of 3 LineSeries —
    // so the daily_pivot descriptor contributes 0 line series
    // and is NOT counted. The 3 sub-line series are:
    //   - donchian (3)
    //   - pivot (1)
    //   - bollinger (3)
    // = 7 sub-line series total (see 81-04 in the bollinger-
    // daily-pivot spec); this test asserts the INDICATOR
    // count of those that actually rendered line series (3).
    // 1 marker indicator (breakout_signals). The marker
    // assertion is LOOSE (`>= 1`) because the marker count is
    // also somewhat strategy-specific (other phases may add
    // additional markers — e.g. Bollinger-band touches — and
    // we don't want this test to break on every indicator
    // addition).
    expect(state.lineCount).toBe(3);
    expect(state.markerCount).toBeGreaterThanOrEqual(1);
  });

  test("dydx_cex_carry (disabled) has 2 lines (funding_rate + funding_spread) + 1 marker (funding_paid)", async ({ page }) => {
    await gotoApp(page);
    const state = await getChartCardState(page, "dydx_cex_carry");
    // Phase 82 redesign: the Donchian band was dropped (it's
    // irrelevant to a funding-rate carry strategy). 2 line
    // indicators remain: funding_rate (1 sub-line) +
    // funding_spread (1) = 2 line series total.
    // 1 marker indicator: funding_paid.
    expect(state.lineSeriesCount).toBe(2);
    expect(state.markerCount).toBe(1);
  });

  test("cascade_fade (disabled) has 3 lines (donchian) + 1 marker (cascade_events)", async ({ page }) => {
    await gotoApp(page);
    const state = await getChartCardState(page, "cascade_fade");
    // 1 line indicator: donchian (3 sub-lines) = 3 line series
    // total. 1 marker indicator: cascade_events.
    expect(state.lineSeriesCount).toBe(3);
    expect(state.markerCount).toBe(1);
  });

  test("funding_flip_kill_switch (disabled) has 1 line (funding_rate) + 1 marker (funding_flips)", async ({ page }) => {
    await gotoApp(page);
    const state = await getChartCardState(page, "funding_flip_kill_switch");
    // Phase 82 redesign: the Donchian band was dropped (the
    // strategy is about funding-rate sign flips, not channel
    // breakouts). 1 line indicator remains: funding_rate (1
    // sub-line) = 1 line series total. 1 marker indicator:
    // funding_flips.
    expect(state.lineSeriesCount).toBe(1);
    expect(state.markerCount).toBe(1);
  });

  test("regime_detector (disabled) has 3 lines (donchian) + 1 marker (regime_changes)", async ({ page }) => {
    await gotoApp(page);
    const state = await getChartCardState(page, "regime_detector");
    // 1 line indicator: donchian (3 sub-lines) = 3 line series
    // total. 1 marker indicator: regime_changes.
    expect(state.lineSeriesCount).toBe(3);
    expect(state.markerCount).toBe(1);
  });

  test("the 4 disabled strategy cards still show the '(disabled)' suffix", async ({ page }) => {
    await gotoApp(page);
    for (const strategy of [
      "dydx_cex_carry",
      "cascade_fade",
      "funding_flip_kill_switch",
      "regime_detector",
    ] as const) {
      const title = page
        .locator(`.line-chart-wrapper[data-strategy='${strategy}']`)
        .first()
        .locator(".line-chart-wrapper__title");
      await expect(title).toContainText(strategy);
      await expect(title).toContainText("(disabled)");
    }
  });
});
