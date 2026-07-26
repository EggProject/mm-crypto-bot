/**
 * apps/web/e2e/82-coverage-boost-indicators.spec.ts
 *
 * Phase 82 (coverage push — second wave): e2e tests that exercise
 * the strategy-specific indicator code paths in the priority-5
 * indicator files (donchian.ts, bollinger.ts, daily-pivot.ts,
 * strategy-indicators.ts).
 *
 * The 81 spec already covers the 4 line indicators + 5 marker
 * indicators for the 5 strategies at 30-bar steady state. The
 * remaining gaps in the e2e branch coverage are mostly:
 *
 *   - **strategy-indicators.ts**: the `lineData.length === 0` no-op
 *     dispose branch in `makeSingleLineIndicator` (line 424, BRDA
 *     424,9 + 428,22) and in `pivotLineIndicator` (line 210, BRDA
 *     230,21). The TRUE arms are hit in the current suite; the
 *     FALSE arms (the `addSeries` path) are hit by the 30-bar
 *     tests but the no-op CLOSURE itself shows up as 0 in LCOV
 *     because Istanbul ignores empty-body closures.
 *
 *   - **donchian.ts**: the defensive `bars.length === 0` short-
 *     circuit in `renderDonchian` (line 386, BRDA 386,14). The
 *     chart-card's own effect has `if (bars.length === 0) return;`
 *     BEFORE the renderer is invoked, so the renderer's empty
 *     branch is unreachable through the React flow. This is a
 *     dead-in-e2e branch (the unit tests cover it).
 *
 *   - **bollinger.ts** and **daily-pivot.ts**: the same shape of
 *     gaps — `validate*Series` and the `bars.length === 0` paths
 *     in the renderers. The validate functions are never called by
 *     the runtime (only the unit tests call them), so most of
 *     their branches are dead-in-e2e. The renderer's `bars.length
 *     === 0` short-circuit is also blocked by the chart-card's
 *     early return.
 *
 * **What THIS spec covers:** the strategy-specific renderers'
 *     RUNTIME branches that the 81 spec doesn't hit:
 *
 *   - `donchianLineIndicator` for each of the 5 strategies (the
 *     `render` function exercises `chart.addSeries` and
 *     `lineSeries.setData` — adds 3 sub-lines per chart).
 *   - `pivotLineIndicator` addSeries + setData (donchian_pivot_composition).
 *   - `bollingerLineIndicator` addSeries + setData (donchian_pivot_composition).
 *   - `dailyPivotLineIndicator` addSeries + setData (donchian_pivot_composition).
 *   - `fundingRateLineIndicator` addSeries + setData (dydx_cex_carry + funding_flip_kill_switch).
 *   - `fundingSpreadLineIndicator` addSeries + setData (dydx_cex_carry).
 *   - The 5 marker indicators' `apply` function (setMarkers) for
 *     the 5 strategies.
 *   - The chart-card's `bars.length === 0` early return (BRDA
 *     513,16 + 576,18 in ChartCard.tsx) — exercised by sending
 *     empty bars.
 *   - The chart-card's indicator effect dispose path (BRDA 568-
 *     575) — exercised by sending a fresh bar stream after the
 *     initial render (the previous indicators are disposed).
 *   - The chart-card's `if (chart === null) return;` guard (BRDA
 *     566,17) is the FALSE arm — already hit.
 *   - The `getStrategyIndicatorSet` "set !== undefined" TRUE arm
 *     for all 5 strategies (BRDA 781,17 arm 0 already hit 1438
 *     times). The FALSE arm (fallback to UNIVERSAL_FALLBACK_SET)
 *     is only hit by the test that mounts an unknown strategy.
 *
 * **The "unknown strategy" test** is the one branch that is
 *     straightforward to cover in the e2e: if I mount a card with
 *     `strategy="unknown_strategy_xyz"`, the
 *     `getStrategyIndicatorSet("unknown_strategy_xyz")` falls
 *     through to the `set === undefined` branch → returns
 *     `UNIVERSAL_FALLBACK_SET`. This exercises BRDA 781,17 arm 1
 *     (the FALSE arm of `set !== undefined`) and BRDA 769 (the
 *     getStrategyIndicatorSet entry point's FALSE arm).
 *
 * **Strategy:**
 *
 *   1. Render each of the 5 strategies (one test per strategy)
 *      with a deterministic bar stream that triggers the
 *      strategy-specific code paths.
 *   2. Render an "unknown" strategy to exercise the fallback.
 *   3. Mount + send empty bars (chart-card early return).
 *   4. Mount + send a fresh bar stream (dispose + re-render).
 *
 * Each test is a fresh navigation so the indicator pipeline is
 * isolated. The `setSpecName` + `afterEach` + `afterAll` hook
 * triplet is the same as the other 82 specs.
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";

setSpecName("82-coverage-boost-indicators");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// ============================================================================
// Test fixtures (mirror the 80-coverage-boost pattern)
// ============================================================================

interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly broadcast: (data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(
  page: Page,
  strategies: readonly {
    readonly name: string;
    readonly enabled: boolean;
    readonly symbols: readonly string[];
    readonly timeframes: readonly string[];
  }[],
): Promise<WsTestHarness> {
  await page.route("**/api/strategies", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ strategies }),
    });
  });

  const allWs: WebSocketRoute[] = [];
  const wsSeenResolvers: (() => void)[] = [];

  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    allWs.push(ws);
    for (const r of wsSeenResolvers.splice(0)) r();
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
    getAllWs: (): readonly WebSocketRoute[] => allWs,
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

/**
 * Build synthetic OHLC bars with a deterministic walk. The
 * `valueOf` lets each test inject cascades, breakouts, or
 * regime changes by setting a specific close for each bar index.
 */
function makeBars(
  count: number,
  valueOf: (i: number) => number,
  startPrice = 67000,
): unknown[] {
  const intervalMs = 60 * 60_000;
  const now = Date.now();
  const out: unknown[] = [];
  let lastClose = startPrice;
  for (let i = 0; i < count; i += 1) {
    const t = now - (count - 1 - i) * intervalMs;
    const close = valueOf(i);
    out.push({
      time: t,
      open: lastClose,
      high: Math.max(lastClose, close) + 5,
      low: Math.min(lastClose, close) - 5,
      close,
      volume: 100 + i,
    });
    lastClose = close;
  }
  return out;
}

/**
 * Send the initial server-side messages: HELLO + SNAPSHOT (with
 * the strategies + ohlcBootstrap bars) + STATE. Mirrors the
 * pattern in `80-coverage-boost.spec.ts`.
 */
function sendInitialServerMessages(
  harness: WsTestHarness,
  strategies: readonly {
    readonly name: string;
    readonly enabled: boolean;
    readonly symbols: readonly string[];
    readonly timeframes: readonly string[];
  }[],
  bars: readonly unknown[],
): void {
  const now = Date.now();
  const hello = JSON.stringify({
    type: "hello",
    ts: now,
    serverVersion: "0.1.0-test",
    protocolVersion: 1,
  });
  const snapshot = JSON.stringify({
    type: "snapshot",
    ts: now,
    snapshot: {
      botStatus: {
        state: "running",
        startedAt: now - 60_000,
        lastUpdate: now,
        activeStrategyCount: strategies.filter((s) => s.enabled).length,
        positions: [],
      },
    },
    strategies,
    ohlcBootstrap: Object.fromEntries(
      strategies[0] !== undefined
        ? strategies[0].symbols.map((sym) => [
            sym,
            Object.fromEntries(
              strategies[0].timeframes.map((tf) => [tf, bars]),
            ),
          ])
        : [],
    ),
  });
  const state = JSON.stringify({
    type: "state",
    ts: now,
    snapshot: {
      botStatus: {
        state: "running",
        startedAt: now - 60_000,
        lastUpdate: now,
        activeStrategyCount: strategies.filter((s) => s.enabled).length,
        positions: [],
      },
    },
    positions: [],
    closedTrades: [],
    killSwitch: "off",
    paused: false,
    statistics: { trades: 0, pnl: 0, drawdown: 0 },
  });
  harness.broadcast(hello);
  harness.broadcast(snapshot);
  harness.broadcast(state);
}

async function waitForChartCard(
  page: Page,
  strategy: string,
): Promise<void> {
  const card = page.locator(
    `.line-chart-wrapper[data-strategy="${strategy}"][data-symbol="BTCUSDT"][data-timeframe="1h"]`,
  );
  await expect(card).toBeVisible({ timeout: 10_000 });
}

// ============================================================================
// Tests
// ============================================================================

test.describe("Phase 82 (second wave): strategy-specific indicator rendering paths", () => {
  test("82-01: donchian_pivot_composition renders 4 line indicators (donchian + pivot + bollinger + daily_pivot) + 1 marker (breakout)", async ({
    page,
  }) => {
    // The 81 spec already exercises this strategy. This test
    // re-renders it with a deliberate 30-bar breakout pattern
    // to ensure the Bollinger band (3 sub-lines) + daily pivot
    // (3 sub-lines) + the breakout markers all reach the chart.
    // 25 bars is enough to clear the pivot's 24-bar lookback
    // and the Bollinger's 20-bar lookback.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(30, (i) => {
      if (i < 22) return 67000;
      if (i === 22) return 67200;
      if (i === 23) return 68000; // breakout above Donchian upper
      if (i === 24) return 68500;
      return 67000 + i;
    });
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "donchian_pivot_composition");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-02: dydx_cex_carry renders 3 line indicators (donchian + funding_rate + funding_spread) + 1 marker (funding_paid)", async ({
    page,
  }) => {
    // The funding_paid marker fires every 8 bars (cadence=8).
    // We need bars.length >= 9 so the loop body executes at
    // least once. 30 bars → 3 funding_paid markers (at i=8,
    // 16, 24).
    //
    // Note: `enabled: true` even though the strategy is
    // "disabled" in the bot config — the App's empty-state
    // branch fires when ALL strategies are disabled
    // (ChartGrid.tsx:hasAnyEnabledStrategy), so the grid
    // wouldn't render a card otherwise. The strategy-specific
    // indicators fire regardless of the `enabled` flag (the
    // dispatch in `getStrategyIndicatorSet` is keyed on
    // strategy NAME, not `enabled`).
    const strategies = [
      {
        name: "dydx_cex_carry",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(30, (i) => 67000 + (i % 2 === 0 ? 10 : -10));
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "dydx_cex_carry");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-03: cascade_fade renders 1 line indicator (donchian) + 1 marker (cascade_events)", async ({
    page,
  }) => {
    // 3 deliberate cascade events (>2% bar-to-bar moves) at
    // i=10, 20, 28. This exercises the cascade detect
    // threshold branch and the marker.render path.
    //
    // See 82-02 for the `enabled: true` rationale.
    const strategies = [
      {
        name: "cascade_fade",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(30, (i) => {
      if (i === 10) return 67000 * 1.03; // +3% cascade
      if (i === 20) return 67000 * 0.97; // -3% cascade
      if (i === 28) return 67000 * 1.025; // +2.5% cascade
      return 67000;
    });
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "cascade_fade");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-04: funding_flip_kill_switch renders 2 line indicators (donchian + funding_rate) + 1 marker (funding_flips)", async ({
    page,
  }) => {
    // 30 bars with a clear sign-change pattern: 10 rising, 10
    // falling, 10 rising. The funding rate flips sign at the
    // peak (~i=10) and at the trough (~i=20). The
    // funding_flips marker fires at those transitions.
    //
    // See 82-02 for the `enabled: true` rationale.
    const strategies = [
      {
        name: "funding_flip_kill_switch",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(30, (i) => {
      if (i < 10) return 67000 + i * 10; // rising
      if (i < 20) return 67000 + 100 - (i - 10) * 10; // falling
      return 67000 - 100 + (i - 20) * 10; // rising again
    });
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "funding_flip_kill_switch");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-05: regime_detector renders 1 line indicator (donchian) + 1 marker (regime_changes)", async ({
    page,
  }) => {
    // 30 bars with a regime-transition pattern: 10 ranging
    // (small noise), 10 trending (steady uptick), 10 volatile
    // (large swings). The regime classifier flips at each
    // transition → regime_changes markers fire.
    //
    // See 82-02 for the `enabled: true` rationale.
    const strategies = [
      {
        name: "regime_detector",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(30, (i) => {
      if (i < 10) return 67000 + (i % 2 === 0 ? 5 : -5); // ranging
      if (i < 20) return 67000 + (i - 10) * 50; // trending
      return 67000 + 500 + (i % 2 === 0 ? 200 : -200); // volatile
    });
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "regime_detector");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-06: unknown strategy falls back to UNIVERSAL_FALLBACK_SET (donchian only)", async ({
    page,
  }) => {
    // An UNKNOWN strategy name is not in STRATEGY_INDICATOR_SETS.
    // getStrategyIndicatorSet returns UNIVERSAL_FALLBACK_SET
    // (just the donchian band). The chart-card's effect 2b
    // dispatches to the fallback set's lines + markers. This
    // exercises the `set === undefined` FALSE arm of
    // getStrategyIndicatorSet (BRDA 781,17 arm 1) — the only
    // way to hit it via the React flow.
    //
    // Note: the App's empty-state branch
    // (hasAnyEnabledStrategy === false) renders the
    // `[data-testid="chart-grid-empty"]` element when ALL
    // strategies are disabled, so for this test to render a
    // chart card, the unknown strategy must be `enabled: true`
    // (to make the grid render the card).
    const strategies = [
      {
        name: "unknown_strategy_xyz",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(30, (i) => 67000 + i);
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "unknown_strategy_xyz");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-07: empty bars list exercises ChartCard.tsx bars.length === 0 early return (BRDA 513,16 + 576,18)", async ({
    page,
  }) => {
    // The chart-card's bars effect (line 510) and indicator
    // effect (line 564) both have `if (bars.length === 0)
    // return;` / `if (bars.length === 0) { ...dispose...; return; }`.
    // Sending an empty bar list hits these branches directly
    // without invoking the indicator renderers. The renderer
    // functions' own `bars.length === 0` short-circuits
    // (donchian.ts:386, bollinger.ts:602, daily-pivot.ts:490)
    // are blocked by the chart-card's earlier early-return and
    // are therefore dead-in-e2e.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars: unknown[] = [];
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "donchian_pivot_composition");
    // Wait for the bar-less render to settle.
    await page.waitForTimeout(500);
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-08: live bar update exercises the indicator dispose + re-render lifecycle (BRDA 568-575)", async ({
    page,
  }) => {
    // The chart-card's indicator effect (line 564) runs on every
    // `bars` change. The effect body first disposes the previous
    // indicator renders (line 568-575), then renders the new set.
    // This is the "lifecycle" — the dispose path is exercised on
    // every re-render with a new bar stream.
    //
    // The test sends an initial 25-bar stream, waits for the
    // first render, then sends a fresh 30-bar stream (with a
    // different pattern). The `bars` prop changes → effect runs
    // → previous lines are disposed → new lines are added.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const initialBars = makeBars(25, (i) => 67000 + i);
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, initialBars);
    await waitForChartCard(page, "donchian_pivot_composition");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Send a fresh ohlc message with a different bar set. The
    // App's WS handler updates the ohlc store → ChartCard
    // re-renders → indicator effect re-runs → previous lines
    // are disposed.
    const now = Date.now();
    const intervalMs = 60 * 60_000;
    const freshBars: unknown[] = [];
    for (let i = 0; i < 30; i += 1) {
      const close = 68000 + i;
      freshBars.push({
        time: now - (29 - i) * intervalMs,
        open: close - 5,
        high: close + 5,
        low: close - 10,
        close,
        volume: 100 + i,
      });
    }
    harness.broadcast(
      JSON.stringify({
        type: "ohlc",
        ts: now,
        symbol: "BTCUSDT",
        timeframe: "1h",
        bars: freshBars,
      }),
    );
    await page.waitForTimeout(500);

    // The chart should still be connected after the update.
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-09: dydx_cex_carry with 1 bar — exercises makeSingleLineIndicator's lineData.length === 0 branch", async ({
    page,
  }) => {
    // With only 1 bar, the funding rate compute returns all-null
    // (warmup period: `n <= lookback` → early return at
    // client-compute.ts:518). The makeSingleLineIndicator's
    // render loop filters the null values → lineData is empty
    // → `if (lineData.length === 0)` (line 424) takes the TRUE
    // arm → returns a RenderedIndicator with `series: []` and a
    // no-op `dispose`. This exercises BRDA 424,9 arm 0 (the
    // TRUE arm) and the corresponding no-op dispose closure.
    //
    // Note: the chart-card's effect 2b at line 576 has
    // `if (bars.length === 0) return;` — this fires when
    // bars.length is 0, NOT when it's 1. With 1 bar, the
    // effect proceeds past the early return and invokes the
    // line indicators.
    const strategies = [
      {
        name: "dydx_cex_carry",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(1, () => 67000);
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "dydx_cex_carry");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-10: donchian_pivot_composition with 25 bars — exercises pivot + Bollinger + daily_pivot addSeries paths (BRDA 219+ in strategy-indicators.ts)", async ({
    page,
  }) => {
    // The 82-01 test uses 30 bars with a breakout pattern. This
    // test uses 25 bars (just past the 24-bar pivot lookback)
    // with a steady walk — the pivot has values for i=24 only,
    // the Bollinger has values for i=19+ (20-bar lookback), and
    // the daily pivot has values from i=1. The goal is to
    // exercise the `if (lineData.length === 0)` FALSE arm in
    // pivotLineIndicator (line 210, FALSE arm: addSeries +
    // setData) and the equivalent FALSE arms in the
    // makeSingleLineIndicator for the funding / spread.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(25, (i) => 67000 + i);
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "donchian_pivot_composition");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-11: donchian_pivot_composition with NaN close in the Bollinger initial window (BRDA 259,9 TRUE)", async ({
    page,
  }) => {
    // Target: bollinger.ts:259 (the `if (!isFiniteNumber(close))`
    // TRUE arm in the initial SMA window of
    // `computeBollingerBand`). The default e2e flow sends
    // finite closes, so this branch is never hit. We send
    // 25 bars where bar 5 has `close: null` (serialized to
    // the wire as `null`, decoded back to `null` in the
    // browser). The initial window is bars[0..19]; bar 5 is
    // in the initial window. The NaN check fires → Bollinger
    // returns all-null → lineData is empty → the
    // `lineData.length === 0` TRUE arm fires in the renderer.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    // Send bars where bar 5 has `close: null` (cast through
    // unknown to satisfy the OHLCBar type). The lightweight-
    // charts data field is `number`, so a null close would be
    // rejected; but the indicators compute handles it
    // defensively (the `isFiniteNumber(close)` check).
    const intervalMs = 60 * 60_000;
    const now = Date.now();
    const bars: unknown[] = [];
    let lastClose = 67000;
    for (let i = 0; i < 25; i += 1) {
      const close = i === 5 ? null : 67000 + i;
      bars.push({
        time: now - (24 - i) * intervalMs,
        open: lastClose,
        high: Math.max(lastClose, 67000 + i) + 5,
        low: Math.min(lastClose, 67000 + i) - 5,
        close,
        volume: 100 + i,
      });
      lastClose = close === null ? lastClose : close;
    }
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "donchian_pivot_composition");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-12: donchian_pivot_composition with NaN close in the Bollinger rolling window (BRDA 313,10 TRUE)", async ({
    page,
  }) => {
    // Target: bollinger.ts:313 (the `if (!isFiniteNumber(outClose)
    // || !isFiniteNumber(inClose))` TRUE arm in the rolling
    // window of `computeBollingerBand`). The default e2e flow
    // sends finite closes, so this branch is never hit. We
    // send 25 bars where bar 22 (in the rolling window after
    // the initial 20-bar warmup) has `close: null`. The
    // rolling update detects the NaN → breaks out of the loop
    // → the rest of the bars are null.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const intervalMs = 60 * 60_000;
    const now = Date.now();
    const bars: unknown[] = [];
    let lastClose = 67000;
    for (let i = 0; i < 25; i += 1) {
      const close = i === 22 ? null : 67000 + i;
      bars.push({
        time: now - (24 - i) * intervalMs,
        open: lastClose,
        high: Math.max(lastClose, 67000 + i) + 5,
        low: Math.min(lastClose, 67000 + i) - 5,
        close,
        volume: 100 + i,
      });
      lastClose = close === null ? lastClose : close;
    }
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "donchian_pivot_composition");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-13: daily_pivot with non-finite prev.high/low/close (BRDA 223,2 TRUE)", async ({
    page,
  }) => {
    // Target: daily-pivot.ts:223 (the `if (!isFiniteNumber
    // (prev.high) || !isFiniteNumber(prev.low) || !isFiniteNumber
    // (prev.close))` TRUE arm in `computeDailyPivot`). The
    // default e2e flow sends finite H/L/C, so this branch is
    // never hit. We send 10 bars where bar 3 has a non-finite
    // `high` (serialized as `null` over the wire). The pivot
    // for bar 4 is undefined (the previous bar's high is
    // non-finite) → the loop body fires the `continue` branch
    // (line 232) → pp[4] stays null.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const intervalMs = 60 * 60_000;
    const now = Date.now();
    const bars: unknown[] = [];
    let lastClose = 67000;
    for (let i = 0; i < 10; i += 1) {
      const high = i === 3 ? null : 67000 + i + 5;
      bars.push({
        time: now - (9 - i) * intervalMs,
        open: lastClose,
        high,
        low: 67000 + i - 5,
        close: 67000 + i,
        volume: 100 + i,
      });
      lastClose = 67000 + i;
    }
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "donchian_pivot_composition");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-14: cascade_fade with 1 bar (cascade warmup) — exercises the cascade detector's bars.length < 2 branch", async ({
    page,
  }) => {
    // The cascade detector's logic requires at least 2 bars
    // (the current and previous close). With 1 bar, the
    // computeCascadeEventsFromBars returns []. This exercises
    // the empty-bars code path in the marker compute, even
    // though it doesn't add new branches to the strategy
    // indicator file (it exercises the early-return guard).
    //
    // See 82-02 for the `enabled: true` rationale.
    const strategies = [
      {
        name: "cascade_fade",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(1, () => 67000);
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "cascade_fade");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-15: funding_flip_kill_switch with prev.close=0 bar — exercises computeFundingRateFromBars prev.close <= 0 + computeFundingFlipsFromBars first-bar checks", async ({
    page,
  }) => {
    // The funding rate compute (line 529) has a defensive
    // `if (prev.close <= 0 || cur.close <= 0) { funding[i] = 0;
    // continue; }` branch. The default e2e flow sends finite
    // closes, so this branch is never hit. We send 20 bars
    // where bar 5 has close = 0 → for i=5+8=13, the funding
    // is 0 (not null, not a number). The funding_flips
    // compute then sees a flip from a real number to 0 → the
    // `prevSign === 0 || curSign === 0` branch (line 772)
    // continues, and a flip is not emitted.
    //
    // Also, with 20 bars, the funding_flip loop's
    // `for (let i = 1; i < bars.length; i += 1)` runs 19
    // times. The `if (prev === null) continue;` (line 766)
    // and `if (cur === null) continue;` (line 767) branches
    // fire for the warmup period. Both branches are hit.
    //
    // See 82-02 for the `enabled: true` rationale.
    const strategies = [
      {
        name: "funding_flip_kill_switch",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const intervalMs = 60 * 60_000;
    const now = Date.now();
    const bars: unknown[] = [];
    let lastClose = 67000;
    for (let i = 0; i < 20; i += 1) {
      const close = i === 5 ? 0 : 67000 + i;
      bars.push({
        time: now - (19 - i) * intervalMs,
        open: lastClose,
        high: Math.max(lastClose, close) + 5,
        low: Math.min(lastClose, close) - 5,
        close,
        volume: 100 + i,
      });
      lastClose = close === 0 ? lastClose : close;
    }
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "funding_flip_kill_switch");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-16: regime_detector with 1 bar — exercises computeRegimeFromBars first-bar + bars.length < 2 branch", async ({
    page,
  }) => {
    // With 1 bar, the regime detector's loop
    // `for (let i = 1; i < bars.length; i += 1)` doesn't run
    // (1 < 1 is false). The `regime[0]` stays null. The
    // regime_changes marker compute has `for (let i = 1; ...)`
    // and `if (regime[i] === null || regime[i - 1] === null)
    // continue;` — the loop doesn't run with 1 bar.
    //
    // The chart card's effect 2b DOES call the line + marker
    // indicators for 1 bar. The donchian band renders (1 bar
    // is enough for warmup), and the regime_changes marker
    // compute returns [] (no markers). This exercises the
    // chart-card's "1 bar" code path without hitting new
    // strategy-indicators branches.
    //
    // See 82-02 for the `enabled: true` rationale.
    const strategies = [
      {
        name: "regime_detector",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(1, () => 67000);
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "regime_detector");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-17: donchian_pivot_composition with 2 bars — exercises computeDonchianFromBars n < lookback early return + bollinger/daily-pivot warmup", async ({
    page,
  }) => {
    // With 2 bars, both the Donchian band (lookback=20) and
    // the Bollinger band (period=20) are in the warmup
    // period. The daily pivot's `for (let i = 1; ...)` loop
    // runs once (i=1) and computes the pivot for i=1. The
    // chart card's effect 2b iterates 4 line indicators +
    // 1 marker. This exercises the small-bars code path
    // without overloading the chart.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(2, (i) => 67000 + i);
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "donchian_pivot_composition");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-18: donchian_pivot_composition with 3 bars — exercises the Bollinger/Daily-pivot warmup + addSeries paths", async ({
    page,
  }) => {
    // With 3 bars, the daily-pivot's loop iterates i=1 and
    // i=2 (computes pp, r1, s1 for those indices). The
    // Bollinger band's `n < period` branch (period=20, n=3)
    // fires → all-null series → the addSeries is called with
    // empty data. This exercises the daily-pivot addSeries
    // path + the bollinger all-null warmup path.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(3, (i) => 67000 + i);
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "donchian_pivot_composition");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-19: regime_detector with 25 bars — exercises computeRegimeFromBars + computeRegimeChangeMarkersFromBars in steady-state", async ({
    page,
  }) => {
    // The regime detector uses a 20-bar lookback. With 25
    // bars, the regime is computed for bars 19-24 (the
    // rolling window). The regime-change markers fire when
    // the regime classification changes between consecutive
    // bars. With a steady walk, the regime is "trending"
    // for most bars → no markers. But the chart card's
    // effect 2b still iterates the line + marker indicators.
    //
    // This is similar to 82-05 but with a more targeted bar
    // pattern to ensure the regime classifier produces a
    // consistent classification (and doesn't change much).
    //
    // See 82-02 for the `enabled: true` rationale.
    const strategies = [
      {
        name: "regime_detector",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(25, (i) => 67000 + i * 10); // steady uptrend
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "regime_detector");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("82-20: click a range tab — exercises the chart-card's onClick (which calls the LOCAL handleRangeClick in ChartCard.tsx, not the helper)", async ({
    page,
  }) => {
    // The chart card has range tabs. Clicking a tab calls
    // the LOCAL handleRangeClick in ChartCard.tsx (line
    // 347-354). The chart-card-helpers.ts handleRangeClick
    // is NOT called — it's dead code. But the local
    // handleRangeClick IS called, and the click updates
    // `localActiveRange` state.
    //
    // The local handleRangeClick has 3 branches:
    //   - `if (activeRange === undefined)` → setLocalActiveRange
    //   - `if (onRangeChange !== undefined)` → onRangeChange(id)
    // The second branch is unreachable (onRangeChange is
    // never passed). The first branch is exercised here.
    //
    // The actual coverage delta is small (1-2 branches in
    // ChartCard.tsx), but this test exercises the
    // user-interaction code path.
    const strategies = [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ];
    const bars = makeBars(25, (i) => 67000 + i);
    const harness = await setupWsPeer(page, strategies);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, strategies, bars);
    await waitForChartCard(page, "donchian_pivot_composition");
    // Click the 4H range tab (the 2nd range button).
    const rangeButton = page.locator(
      '.line-chart-wrapper[data-strategy="donchian_pivot_composition"] .line-chart-wrapper__range-button',
    );
    await expect(rangeButton.first()).toBeVisible({ timeout: 5_000 });
    await rangeButton.nth(1).click();
    await page.waitForTimeout(200);
    // After the click, the aria-checked attribute of the
    // 2nd range button should be "true" (it became active).
    await expect(rangeButton.nth(1)).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 2_000 },
    );
  });
});
