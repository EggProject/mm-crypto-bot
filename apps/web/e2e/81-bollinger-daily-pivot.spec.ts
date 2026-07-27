/**
 * apps/web/e2e/81-bollinger-daily-pivot.spec.ts
 *
 * Phase 81: e2e tests for the new Bollinger band + daily pivot
 * indicators on the `donchian_pivot_composition` strategy chart.
 *
 * **User mandate:** "boilenger szallagot vagy asszeru dolgot
 * latok de peldaul napi pivot szint, es a tobbi strategianal is
 * biztos hogy jopar dolgot lehetne meg jelolni akar chart rajzol
 * vagy indicator formajaban" — the user wants a PROPER Bollinger
 * band (not the Donchian band that was previously the closest
 * approximation) AND a DAILY pivot (not the rolling Fibonacci
 * pivot from Phase 79).
 *
 * **What these tests assert:**
 *   1. The chart card mounts with a candle series + the
 *      strategy-specific indicator set (4 line indicators:
 *      Donchian band + rolling pivot + Bollinger band + daily
 *      pivot = 10 line series; plus the candle series = 11
 *      total chart series).
 *   2. The RenderedIndicator.name list in indicatorRefs (the
 *      ChartCard's useRef holding the rendered indicators) has
 *      the 4 expected entries: donchian-..., pivot-...,
 *      bollinger-..., daily_pivot-...
 *   3. The chart card renders without runtime error when bars
 *      with a strong price walk are sent.
 *   4. The Bollinger band produces 3 line series (upper/middle/lower).
 *   5. The daily pivot produces 3 line series (pp/r1/s1).
 *
 * **Test isolation:** these tests use `page.route` + `routeWebSocket`
 * (no live bot) to serve deterministic /api/strategies + WS
 * SNAPSHOT responses with bars. They do NOT touch the live
 * bot on 7913.
 *
 * **The "did Bollinger / daily-pivot render" assertion:** the
 * lightweight-charts v5 library uses a canvas to render the
 * series, so the test cannot query the canvas pixels directly.
 * Instead, we walk the React fiber tree to find the ChartCard
 * component's `indicatorRefs.current` — a RenderedIndicator[]
 * that the ChartCard updates every time the bar stream changes.
 * Each RenderedIndicator has a name field of the form
 * `<indicator>-<timeframe>-<strategy>` (e.g. `bollinger-1h-
 * donchian_pivot_composition`). Counting the names + their
 * `series` array lengths tells us EXACTLY which indicators
 * the React flow rendered. This is the same pattern the 58E
 * spec uses to inspect imperative-class instances via the
 * fiber tree (the React 18+ internals are stable across
 * versions).
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
// Phase 57: register coverage collection hooks.
setSpecName("81-bollinger-daily-pivot");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// =============================================================================
// Test fixtures
// =============================================================================

interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly broadcast: (data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  await page.route("**/api/strategies", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
      }),
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

async function gotoAppBare(page: Page): Promise<void> {
  await page.goto("/");
}

/**
 * Build synthetic OHLC bars with a deterministic walk.
 *
 * The default pattern is a gentle oscillation; the tests can
 * override `priceOf` to inject breakouts / breakdowns. The
 * Bollinger band needs >= period (default 20) bars to produce
 * any non-null values, so the tests send 30+ bars by default.
 */
function makeBars(
  count: number,
  options: {
    readonly intervalMs?: number;
    readonly priceOf?: (i: number) => number;
    readonly startPrice?: number;
  } = {
    intervalMs: undefined,
    priceOf: undefined,
    startPrice: undefined,
  },
): unknown[] {
  const intervalMs: number = options.intervalMs ?? 60 * 60_000;
  const startPrice: number = options.startPrice ?? 67000;
  const defaultPriceOf = (i: number): number => startPrice + i;
  const priceOf: (i: number) => number = options.priceOf ?? defaultPriceOf;
  const now = Date.now();
  const out: unknown[] = [];
  let lastClose = startPrice;
  for (let i = 0; i < count; i += 1) {
    const t = now - (count - 1 - i) * intervalMs;
    const open = lastClose;
    const targetClose = priceOf(i);
    const close = targetClose;
    out.push({
      time: t,
      open,
      high: Math.max(open, close) + 5,
      low: Math.min(open, close) - 5,
      close,
      volume: 100 + i,
    });
    lastClose = close;
  }
  return out;
}

/**
 * Send the initial server-side messages: HELLO + SNAPSHOT + STATE.
 */
function sendInitialServerMessages(
  harness: WsTestHarness,
  options: { readonly bars?: readonly unknown[] } = {},
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
        activeStrategyCount: 1,
        positions: [],
      },
    },
    strategies: [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ],
    ohlcBootstrap: {
      BTCUSDT: { "1h": options.bars ?? [] },
    },
  });
  const state = JSON.stringify({
    type: "state",
    ts: now,
    snapshot: {
      botStatus: {
        state: "running",
        startedAt: now - 60_000,
        lastUpdate: now,
        activeStrategyCount: 1,
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

// =============================================================================
// React fiber walker: find the ChartCard's indicatorRefs.current
// =============================================================================

/**
 * `readIndicatorDescriptors(page)` — walk the React fiber tree
 * to find the ChartCard component's `indicatorRefs.current` and
 * return a descriptor for every RenderedIndicator in the array.
 *
 * The fiber walk pattern is documented in 58E-ws-client-imperative-
 * branches.spec.ts: the root DOM element has a __reactContainer$xxx
 * key (React 18+ internals), the container has a stateNode.current
 * (the root fiber), and the fiber tree is linked via child /
 * sibling. Each fiber with hooks has a memoizedState linked
 * list. A `useRef<readonly RenderedIndicator[]>([])` hook stores
 * the ref OBJECT in memoizedState; the ref's current is the
 * rendered-indicators array.
 *
 * **Duck-typing:** the ChartCard has TWO useRef arrays
 * (`indicatorRefs.current` = `RenderedIndicator[]`,
 * `markerDisposersRef.current` = `(() => void)[]`). The walk
 * filters by the SHAPE of the first element: the indicator
 * array has objects with a string name property, the marker
 * array has functions. We collect only refs whose first element
 * is an object with a string name property.
 *
 * Returns an array of { name, seriesCount } per indicator. The
 * `series` field is a non-serializable ISeriesApi<"Line">[]
 * (a lightweight-charts instance with circular refs + canvas
 * bindings), so we only return the COUNT.
 */
async function readIndicatorDescriptors(
  page: Page,
): Promise<readonly { readonly name: string; readonly seriesCount: number }[]> {
  return page.evaluate(`
    (function() {
      function isIndicatorRef(refObj) {
        if (refObj == null || typeof refObj !== 'object') return false;
        if (!('current' in refObj)) return false;
        if (!Array.isArray(refObj.current)) return false;
        if (refObj.current.length === 0) return true;
        var first = refObj.current[0];
        return (
          first != null &&
          typeof first === 'object' &&
          typeof first.name === 'string'
        );
      }
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
      var stack = [rootFiber];
      var found = null;
      var safety = 0;
      while (stack.length > 0 && found === null) {
        if (++safety > 100000) throw new Error('fiber walk exceeded 100k');
        var f = stack.pop();
        if (f == null) continue;
        var hook = f.memoizedState;
        var hookSafety = 0;
        while (hook != null && found === null) {
          if (++hookSafety > 50) break;
          var refObj = hook.memoizedState;
          if (isIndicatorRef(refObj)) {
            found = refObj.current.map(function(ri) {
              if (ri == null) return null;
              if (typeof ri.name !== 'string') return null;
              return {
                name: ri.name,
                seriesCount: Array.isArray(ri.series) ? ri.series.length : 0,
              };
            }).filter(function(x) { return x !== null; });
            break;
          }
          hook = hook.next;
        }
        if (f.child != null) stack.push(f.child);
        if (f.sibling != null) stack.push(f.sibling);
      }
      if (found === null) return [];
      return found;
    })()
  `) as Promise<
    readonly { readonly name: string; readonly seriesCount: number }[]
  >;
}

/**
 * Poll `readIndicatorDescriptors` until the expected set of
 * indicator names is populated. The bar effect runs before
 * the indicator effect, so the chart's candle series mounts
 * a tick before the strategy-specific indicators do. A short
 * poll (200ms cadence, 10s total) absorbs the gap.
 */
async function pollIndicatorDescriptors(
  page: Page,
  expectedNames: readonly string[],
  timeoutMs = 10_000,
): Promise<readonly { readonly name: string; readonly seriesCount: number }[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const descriptors = await readIndicatorDescriptors(page);
    const names = descriptors.map((d) => d.name);
    if (
      names.length >= expectedNames.length &&
      expectedNames.every((expected) => names.includes(expected))
    ) {
      return descriptors;
    }
    await page.waitForTimeout(200);
  }
  return readIndicatorDescriptors(page);
}

// =============================================================================
// Tests
// =============================================================================

test.describe("Phase 81: Bollinger band + daily pivot indicators on the chart", () => {
  test("81-01: the strategy-specific indicator set renders 4 line indicators (Donchian + rolling pivot + Bollinger + daily pivot)", async ({
    page,
  }) => {
    // The user mandate: add the Bollinger band + daily pivot to
    // the donchian_pivot_composition strategy. The Phase 79
    // set had 2 line indicators (Donchian + rolling pivot);
    // Phase 81 adds 2 more (Bollinger + daily pivot) for a
    // total of 4. The chart's indicatorRefs.current array
    // holds 4 RenderedIndicator entries after the bar stream
    // arrives.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    // Send 30 bars (> Donchian lookback of 20, > Bollinger
    // period of 20, > daily pivot minimum of 2). A gentle
    // walk keeps the bands well-defined.
    const bars = makeBars(30, { startPrice: 67000 });
    sendInitialServerMessages(harness, { bars });

    // Wait for the chart card to mount.
    const card = page.locator(
      '.ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]',
    );
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Poll the indicator descriptors until all 4 expected
    // names are present.
    const expectedNames = [
      "donchian-1h-donchian_pivot_composition",
      "pivot-1h-donchian_pivot_composition",
      "bollinger-1h-donchian_pivot_composition",
      "daily_pivot-1h-donchian_pivot_composition",
    ];
    const descriptors = await pollIndicatorDescriptors(page, expectedNames);
    // The chart card has exactly 4 strategy-specific line
    // indicators (the 2 from Phase 79 + the 2 new in Phase 81).
    expect(descriptors.length).toBe(4);
    const names = descriptors.map((d) => d.name);
    for (const expected of expectedNames) {
      expect(names).toContain(expected);
    }
  });

  test("81-02: the Bollinger band produces 3 line series (upper / middle / lower)", async ({
    page,
  }) => {
    // The chart's RenderedIndicator.series is a
    // readonly ISeriesApi<"Line">[] — one per Bollinger
    // sub-series. We verify the COUNT of series on the
    // Bollinger indicator is 3 (upper, middle, lower).
    // The fiber walk also exposes the series array, but
    // series instances are non-serializable; we count via
    // the array length, which is just a number.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    const bars = makeBars(30, { startPrice: 67000 });
    sendInitialServerMessages(harness, { bars });

    const card = page.locator(
      '.ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]',
    );
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Poll for the Bollinger indicator descriptor.
    const descriptors = await pollIndicatorDescriptors(page, [
      "bollinger-1h-donchian_pivot_composition",
    ]);
    const bollinger = descriptors.find(
      (d) => d.name === "bollinger-1h-donchian_pivot_composition",
    );
    expect(bollinger).toBeDefined();
    expect(bollinger?.seriesCount).toBe(3);
  });

  test("81-03: the daily pivot produces 0 line series (renders as 3 price lines on the candle series instead)", async ({
    page,
  }) => {
    // Phase 82 chart redesign: the daily-pivot renderer was
    // rewritten to use `candleSeries.createPriceLine()` for
    // the most recent day's PP / R1 / S1 (3 horizontal price
    // lines on the candle series) instead of three LineSeries
    // (a per-bar stair-step history). The descriptor still
    // surfaces in `indicatorRefs.current` but the line-series
    // count is now 0; the 3 price lines are attached to the
    // candle series, not to the indicators array.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    const bars = makeBars(30, { startPrice: 67000 });
    sendInitialServerMessages(harness, { bars });

    const card = page.locator(
      '.ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]',
    );
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Poll for the daily pivot descriptor.
    const descriptors = await pollIndicatorDescriptors(page, [
      "daily_pivot-1h-donchian_pivot_composition",
    ]);
    const dailyPivot = descriptors.find(
      (d) => d.name === "daily_pivot-1h-donchian_pivot_composition",
    );
    expect(dailyPivot).toBeDefined();
    expect(dailyPivot?.seriesCount).toBe(0);
  });

  test("81-04: the total line series count on the strategy chart is 7 (3 + 1 + 3 + 0)", async ({
    page,
  }) => {
    // Sanity: Donchian band = 3, rolling pivot = 1, Bollinger
    // band = 3, daily pivot = 0 (Phase 82 redesign — daily
    // pivot now renders as 3 price lines on the candle series
    // rather than 3 line series). Total = 7 line series on the
    // chart for the donchian_pivot_composition strategy. The
    // 3 daily-pivot price lines (PP / R1 / S1) are tracked
    // separately on the candle series, not in this sum.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    const bars = makeBars(30, { startPrice: 67000 });
    sendInitialServerMessages(harness, { bars });

    const card = page.locator(
      '.ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]',
    );
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Poll for all 4 descriptors and sum the series counts.
    const descriptors = await pollIndicatorDescriptors(page, [
      "donchian-1h-donchian_pivot_composition",
      "pivot-1h-donchian_pivot_composition",
      "bollinger-1h-donchian_pivot_composition",
      "daily_pivot-1h-donchian_pivot_composition",
    ]);
    const totalSeries = descriptors.reduce(
      (sum, d) => sum + d.seriesCount,
      0,
    );
    expect(totalSeries).toBe(7);
  });

  test("81-05: empty bars cause the chart to render without runtime error and clear the indicator lines", async ({
    page,
  }) => {
    // The user mandate is for the strategy to show the new
    // indicators; we also verify the empty-bars branch of
    // computeBollingerBand / computeDailyPivot (which is
    // shared with the Donchian path): empty bars → no line
    // series, no error. The card mounts but the indicator list
    // is empty.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, { bars: [] });

    const card = page.locator(
      '.ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]',
    );
    await expect(card).toBeVisible({ timeout: 10_000 });
    // The app's status dot is "connected" — the snapshot was
    // accepted. The chart card has the correct strategy id.
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });
});
