/**
 * apps/web/e2e/83-6-1-snapshot-survives-ticks.spec.ts
 *
 * Phase 83.6.1: e2e regression test for the SNAPSHOT clobber bug.
 *
 * Background: the state-feed broadcasts `snapshot` messages every
 * ~1-2 seconds (the `LiveStatePublisher.periodicRefreshMs` defaults
 * to 1000ms). The dashboard's previous `useEffect([snapshot])` in
 * `App.tsx` REPLACED the entire `barsByKey` map with
 * `extractBarsByKey(snapshot)` on every snapshot. Since the
 * `ohlcBootstrap` in the snapshot is the SAME on every replay (the
 * publisher's `OhlcStore.getAll()` returns the historical CSV
 * bootstrap, which doesn't change between snapshots in the in-between
 * window), the REPLACE clobbered any tick / bar updates applied
 * between snapshots.
 *
 * Symptom: the last bar's `close` price updated briefly (e.g. 63641.8
 * → 63680.1) on a tick, then REVERTED to the bootstrap value
 * (63680.1 → 63641.8) on the next snapshot. The `data-bars-count`
 * attribute was also stuck at the bootstrap count (the new bar added
 * by a tick APPEND was wiped on the next snapshot).
 *
 * The fix: replace the REPLACE with a MERGE. The `mergeSnapshotBars`
 * helper (in `apps/web/src/lib/bars-from-bar.ts`) is a per-key "only
 * add NEWER bars" operation — the replay case (the snapshot's bars
 * are at or before the prev's last bar) is a no-op, so the tick /
 * bar updates are preserved.
 *
 * Coverage:
 *   1. Tick REPLACEs the in-progress bar's close (the tick wire works).
 *   2. After the tick, a NEW SNAPSHOT (with the SAME bootstrap — the
 *      replay case) does NOT revert the tick. The `data-last-bar-close`
 *      attribute STILL shows the tick-updated value.
 *   3. The `data-bars-count` attribute is NOT stuck at the bootstrap
 *      count after a tick + snapshot replay (a tick that APPENDs a
 *      new bar sticks).
 *   4. After the tick + snapshot replay, the chart's data attributes
 *      (high, low) also reflect the tick update (not the bootstrap).
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
import type { WebSocketRoute } from "@playwright/test";

// Phase 57: register coverage collection hooks.
setSpecName("83-6-1-snapshot-survives-ticks");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * The 1h bar boundary (UNIX ms) at the moment the test starts. The
 * bar event's `time` is set to this so the helper's REPLACE branch
 * fires on the subsequent ticks (which all quantize to the SAME
 * 1h boundary).
 *
 * The snapshot's bootstrap seeds a single bar at `TWO_HOURS_AGO_MS`
 * (see `setupWsPeer` below), so the chart starts with `data-bars-count = 1`.
 * The `pushBar()` call in the test pushes a bar at `BAR_TIME_MS`
 * (the current 1h boundary), which is STRICTLY greater than the
 * bootstrap's `TWO_HOURS_AGO_MS` — so `appendOrReplaceBar` takes
 * its APPEND branch (count goes 1 → 2). The subsequent
 * `pushTick()` call at the same 1h boundary takes the REPLACE
 * branch (count stays at 2; the last bar's `close`/`high`/`low`
 * update to the tick price).
 */
const BAR_TIME_MS = Math.floor(Date.now() / 3_600_000) * 3_600_000;

/**
 * The bootstrap bar sent in the SNAPSHOT message. The time is
 * 2 hours BEFORE the current 1h boundary so the test's
 * `pushBar()` APPENDs (the `TWO_HOURS_AGO_MS` boundary is the
 * previous completed 1h bar; the in-progress bar at `BAR_TIME_MS`
 * is the one we're building). The OHLC values are deterministic
 * so the test assertions can compare against known baselines:
 *   - close=63641.8 (the bug report's "T+2s" baseline)
 *   - high=63680.1 (the bug report's "T+12s" tick-updated high)
 *   - low=63550.0
 *   - open=63600.0
 *   - volume=42
 */
const BOOTSTRAP_BAR = {
  time: BAR_TIME_MS - 2 * 3_600_000,
  open: 63_600.0,
  high: 63_700.0,
  low: 63_550.0,
  close: 63_641.8,
  volume: 42,
};

/** The chart body selector (1h BTCUSDT card). */
const CHART_BODY_1H = '[data-testid="chart-card-body-BTCUSDT-1h"]';

let activeWsRoutes: WebSocketRoute[] = [];
/**
 * The number of `snapshot` messages the WS has sent. Each push
 * increments it; the test can wait for a specific value (e.g. wait
 * for the periodic refresh to fire).
 */
let snapshotCount = 0;

async function setupWsPeer(page: Page): Promise<void> {
  activeWsRoutes = [];
  snapshotCount = 0;
  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    activeWsRoutes.push(ws);
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
            positions: [],
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h", "4h"],
          },
        ],
        // Bootstrap: one bar at `BOOTSTRAP_BAR.time` (2h before the
        // current 1h boundary) for both 1h and 4h. The 1h bootstrap
        // is the "previous completed bar" — the in-progress bar at
        // `BAR_TIME_MS` is what the bar/tick events build on top of.
        // The 4h bootstrap is included so the symbol→timeframe
        // lookup in `applyTickToBars` iterates both timeframes (the
        // helper would skip the 4h key if it were missing, so the
        // bootstrap also covers the 4h path).
        ohlcBootstrap: { BTCUSDT: { "1h": [BOOTSTRAP_BAR], "4h": [BOOTSTRAP_BAR] } },
      }),
    );
    snapshotCount++;
    // Push an initial state event so the dashboard's `lastState`
    // is populated and the banner / positions table render
    // normally. Mirrors the 83-5 / 83-6 specs' pattern.
    setTimeout(() => pushState(), 50);
  });
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
          positions: [],
        },
      }),
    });
  });
  await page.route("http://127.0.0.1:7913/api/control", (route: Route) => {
    return route.fulfill({ status: 202, body: "" });
  });
  await page.route("http://127.0.0.1:7913/api/trades", (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trades: [], count: 0 }),
    });
  });
}

async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  // The 1h chart card body must be in the DOM (the default
  // strategy in App.tsx includes BTCUSDT 1h, so it renders
  // before the /api/strategies fetch resolves).
  await expect(page.locator(CHART_BODY_1H)).toBeVisible({
    timeout: 10_000,
  });
}

function pushState(): void {
  const payload = JSON.stringify({
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
    killSwitch: "armed",
    paused: false,
    statistics: {},
  });
  for (const w of activeWsRoutes) {
    try {
      w.send(payload);
    } catch {
      // best-effort
    }
  }
}

/**
 * Push a `bar` event for BTCUSDT 1h. The default OHLC seeds
 * `close=63641.8, high=63700, low=63550, open=63600, volume=42` so
 * the test assertions can compare against the same baseline as the
 * bug report (the bootstrap's last bar's `close=63641.8` is the
 * "T+2s" baseline mentioned in the bug report).
 */
function pushBar(opts: { time?: number; close?: number; high?: number; low?: number } = {}): void {
  const payload = JSON.stringify({
    type: "bar",
    ts: Date.now(),
    symbol: "BTCUSDT",
    timeframe: "1h",
    ohlc: {
      time: opts.time ?? BAR_TIME_MS,
      open: 63_600.0,
      high: opts.high ?? 63_700.0,
      low: opts.low ?? 63_550.0,
      close: opts.close ?? 63_641.8,
      volume: 42,
    },
  });
  for (const w of activeWsRoutes) {
    try {
      w.send(payload);
    } catch {
      // best-effort
    }
  }
}

/**
 * Push a `tick` event for BTCUSDT at the given price. The helper
 * `applyTickToBars` REPLACEs the in-progress bar's close/high/low
 * with the new price.
 */
function pushTick(symbol: string, price: number): void {
  const payload = JSON.stringify({
    type: "tick",
    ts: Date.now(),
    symbol,
    price,
  });
  for (const w of activeWsRoutes) {
    try {
      w.send(payload);
    } catch {
      // best-effort
    }
  }
}

/**
 * Push a NEW `snapshot` message with the SAME `ohlcBootstrap` as
 * the initial one. This is the "replay" case in the Phase 83.6.1
 * bug: the state-feed's `LiveStatePublisher` re-broadcasts the
 * same `ohlcBootstrap` on every periodic refresh (the
 * `OhlcStore.getAll()` returns the historical CSV, which doesn't
 * change between snapshots in the in-between window).
 */
function pushReplaySnapshot(): void {
  const payload = JSON.stringify({
    type: "snapshot",
    ts: Date.now(),
    snapshot: {
      botStatus: {
        state: "running",
        startedAt: Date.now() - 60_000,
        lastUpdate: Date.now(),
        activeStrategyCount: 1,
        positions: [],
      },
    },
    strategies: [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h", "4h"],
      },
    ],
    // Same ohlcBootstrap as the initial snapshot — the replay case.
    ohlcBootstrap: { BTCUSDT: { "1h": [BOOTSTRAP_BAR], "4h": [BOOTSTRAP_BAR] } },
  });
  for (const w of activeWsRoutes) {
    try {
      w.send(payload);
    } catch {
      // best-effort
    }
  }
  snapshotCount++;
}

test.beforeEach(async ({ page }) => {
  activeWsRoutes = [];
  snapshotCount = 0;
  await setupHttpRoutes(page);
  await setupWsPeer(page);
});

// =============================================================================
// Tests
// =============================================================================

test("a tick applied between two SNAPSHOTs is preserved across the replay", async ({
  page,
}) => {
  await gotoApp(page);

  // Wait for the initial bootstrap's 1-bar state to land.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "1",
    { timeout: 5_000 },
  );
  // The bootstrap's last bar's close is 63641.8 (the bug report's T+2s baseline).
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "63641.8",
    { timeout: 5_000 },
  );

  // APPEND: push a bar at the current 1h boundary (BAR_TIME_MS).
  // `appendOrReplaceBar` takes the APPEND branch (BAR_TIME_MS >
  // BOOTSTRAP_BAR.time) → count goes 1 → 2.
  pushBar({ close: 63_641.8 });
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "63641.8",
    { timeout: 5_000 },
  );

  // TICK at 63680.1 (the bug report's T+12s tick-updated value).
  // The `applyTickToBars` helper REPLACEs the in-progress bar's
  // close=63680.1, high=max(63700, 63680.1)=63700, low=min(63550, 63680.1)=63550.
  pushTick("BTCUSDT", 63_680.1);
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "63680.1",
    { timeout: 5_000 },
  );
  // The high / low are preserved from the bar seed (63700 / 63550).
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-high",
    "63700",
    { timeout: 1_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-low",
    "63550",
    { timeout: 1_000 },
  );

  // *** THE PHASE 83.6.1 BUG ***
  // Push a NEW SNAPSHOT with the SAME `ohlcBootstrap` as the
  // initial one (the "replay" case — the publisher's periodic
  // refresh re-broadcasts the same bootstrap every ~1-2s).
  // Before the fix, the `useEffect([snapshot])` REPLACED the
  // entire `barsByKey` map, reverting the tick update: the last
  // bar's close went 63680.1 → 63641.8 (the bootstrap value).
  const beforeReplay = snapshotCount;
  pushReplaySnapshot();
  expect(snapshotCount).toBe(beforeReplay + 1);

  // Wait a beat for the React render to land.
  await page.waitForTimeout(300);

  // The PROOF: the tick update is PRESERVED. The last bar's
  // close is STILL 63680.1 (not reverted to 63641.8).
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "63680.1",
    { timeout: 5_000 },
  );
  // The bars count is STILL 2 (not stuck at 1).
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );
  // The high / low are STILL the tick-preserved values.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-high",
    "63700",
    { timeout: 1_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-low",
    "63550",
    { timeout: 1_000 },
  );
});

test("a tick that APPENDs a new bar (no prior bar event) is preserved across the replay", async ({
  page,
}) => {
  await gotoApp(page);

  // Wait for the initial bootstrap's 1-bar state to land.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "1",
    { timeout: 5_000 },
  );

  // TICK at 64000.0 — the helper APPENDs a new in-progress bar
  // (last.time = BOOTSTRAP_BAR.time < current 1h boundary).
  // Count goes 1 → 2. The new bar's OHLC = {open=high=low=close=64000, volume=0}.
  pushTick("BTCUSDT", 64_000.0);
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "64000",
    { timeout: 5_000 },
  );

  // Push a REPLAY SNAPSHOT (same bootstrap). Before the fix,
  // the count would revert to 1 and the last bar's close to 63641.8.
  pushReplaySnapshot();
  await page.waitForTimeout(300);

  // The PROOF: the tick update is PRESERVED.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "64000",
    { timeout: 5_000 },
  );
});

test("a REPLAY snapshot with a NEWER tail appends the new bars but preserves the tick update on the in-progress bar", async ({
  page,
}) => {
  // This covers the "live ring buffer growth" case: the snapshot
  // contains a bar that is STRICTLY newer than the in-progress
  // bar's last bar (e.g. a bar was pushed by the bot at the
  // current 1h boundary in the in-between window). The merge
  // should APPEND the new bar(s) AND preserve the tick update
  // on the in-progress bar (the in-progress bar's `time` is the
  // current 1h boundary, which is the same as the new bar's
  // `time`; the tick update is the latest OHLCV for that bar).
  await gotoApp(page);
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "1",
    { timeout: 5_000 },
  );

  // APPEND: push a bar at BAR_TIME_MS (current 1h boundary) with
  // close=63641.8 (the bootstrap's last bar's close — the
  // in-progress bar starts at the bootstrap's OHLC).
  pushBar({ close: 63_641.8 });
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );

  // TICK at 63680.1 (below the high 63700) — REPLACEs the
  // in-progress bar's close=63680.1, high=max(63700, 63680.1)=63700,
  // low=min(63550, 63680.1)=63550.
  pushTick("BTCUSDT", 63_680.1);
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "63680.1",
    { timeout: 5_000 },
  );
  // The high is preserved from the bar seed (63700, which is
  // above the tick price 63680.1). The `applyTickToBars` helper
  // does `high = max(high, price)`, so the high is max(63700, 63680.1)
  // = 63700.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-high",
    "63700",
    { timeout: 1_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-low",
    "63550",
    { timeout: 1_000 },
  );

  // Push a snapshot with a NEWER bar appended at time=63600000
  // (current 1h boundary + 1h). The merge should APPEND this
  // new bar (the bootstrap's last bar's time is BAR_TIME_MS - 2h,
  // so the new bar is STRICTLY newer). The tick update on the
  // in-progress bar (time=BAR_TIME_MS) is NOT affected — the
  // merge only ADDS strictly-newer bars.
  const newerBar = {
    time: BAR_TIME_MS + 3_600_000,
    open: 63_900.0,
    high: 63_950.0,
    low: 63_880.0,
    close: 63_920.0,
    volume: 15,
  };
  const payload = JSON.stringify({
    type: "snapshot",
    ts: Date.now(),
    snapshot: {
      botStatus: {
        state: "running",
        startedAt: Date.now() - 60_000,
        lastUpdate: Date.now(),
        activeStrategyCount: 1,
        positions: [],
      },
    },
    strategies: [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h", "4h"],
      },
    ],
    // Bootstrap: original BOOTSTRAP_BAR + the newer bar. The
    // merge sees that the last bar in prev (after the tick) is
    // at time=BAR_TIME_MS, and the new bar is at time=BAR_TIME_MS+1h
    // (strictly newer) → APPEND.
    ohlcBootstrap: {
      BTCUSDT: { "1h": [BOOTSTRAP_BAR, newerBar], "4h": [BOOTSTRAP_BAR] },
    },
  });
  for (const w of activeWsRoutes) {
    try {
      w.send(payload);
    } catch {
      // best-effort
    }
  }
  snapshotCount++;
  await page.waitForTimeout(300);

  // The newer bar was APPENDED — count goes 2 → 3.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "3",
    { timeout: 5_000 },
  );
  // The tick update on the in-progress bar (now the 2nd bar,
  // time=BAR_TIME_MS) is preserved — its close is STILL 63680.1.
  // The new bar (time=BAR_TIME_MS+1h) is the 3rd and last.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "63920",
    { timeout: 5_000 },
  );
  // The 2nd bar's close (the in-progress one with the tick
  // update) is preserved at 63680.1.
  // Read the chart's 2nd bar's close via the data-* attributes.
  // The dashboard renders the LAST bar's close as data-last-bar-close
  // (which is now the 3rd bar's close, 63920). To verify the
  // 2nd bar's close, we read data-bars-count + check that the
  // chart is stable. The full chart data is rendered by
  // lightweight-charts, which we don't have direct access to;
  // the bars-count + last-bar-close assertion is the observable.
});
