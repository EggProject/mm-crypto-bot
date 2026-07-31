/**
 * apps/web/e2e/83-6-tick-realtime.spec.ts
 *
 * Phase 83.6: e2e regression test for the WS `tick` event →
 * chart-card in-progress bar update data flow.
 *
 * Background: the bot's `subscribeTicker` callback now publishes
 * `tick` events to the state-feed (apps/bot/src/bot/bot.ts:704-728,
 * Phase 83.6). The dashboard's `useWebSocket()` hook exposes them via
 * `lastTick` (batched through `RealtimeBatcher`, see
 * `apps/web/src/ws-client.ts:572-587`). The new
 * `applyTickToBars` helper (apps/web/src/lib/bars-from-tick.ts)
 * consumes the tick and updates the in-progress bar's
 * close/high/low in real-time. This spec exercises the full chain
 * end-to-end with MSW.
 *
 * Coverage:
 *   1. After seeding a `bar`, a `tick` REPLACEs the last bar's
 *      `close` (within the same bar time window).
 *   2. A `tick` price above the existing `high` REPLACEs the last
 *      bar's `high`.
 *   3. A `tick` price below the existing `low` REPLACEs the last
 *      bar's `low`.
 *   4. A `tick` for a symbol not in `symbolsAndTimeframes` is a
 *      no-op (no chart mutation).
 *   5. After seeding a `bar` with a time in the past, a `tick`
 *      APPENDs a new in-progress bar (the helper's APPEND branch).
 *   6. A malformed tick (null / non-finite price) is a no-op.
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
import type { WebSocketRoute } from "@playwright/test";

// Phase 57: register coverage collection hooks.
setSpecName("83-6-tick-realtime");

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
 * The `pushBar()` call in the REPLACE tests pushes a bar at
 * `BAR_TIME_MS` (the current 1h boundary), which is STRICTLY greater
 * than the bootstrap's `TWO_HOURS_AGO_MS` — so `appendOrReplaceBar`
 * takes its APPEND branch (count goes 1 → 2). The subsequent
 * `pushTick()` call at the same 1h boundary takes the REPLACE
 * branch (count stays at 2; the last bar's `close`/`high`/`low`
 * update to the tick price). The APPEND test skips the bar push
 * and lets the first `pushTick()` APPEND the new in-progress bar
 * directly (count 1 → 2).
 */
const BAR_TIME_MS = Math.floor(Date.now() / 3_600_000) * 3_600_000;

/**
 * The bootstrap bar sent in the SNAPSHOT message. The time is
 * 2 hours BEFORE the current 1h boundary so the REPLACE tests'
 * `pushBar()` APPENDs (the `TWO_HOURS_AGO_MS` boundary is the
 * previous completed 1h bar; the in-progress bar at `BAR_TIME_MS`
 * is the one we're building). The OHLC values are deterministic
 * so the test assertions can compare against known baselines.
 */
const BOOTSTRAP_BAR = {
  time: BAR_TIME_MS - 2 * 3_600_000,
  open: 100,
  high: 110,
  low: 90,
  close: 100,
  volume: 5,
};

/** The chart body selector (1h BTCUSDT card). */
const CHART_BODY_1H = '[data-testid="chart-card-body-BTCUSDT-1h"]';

let activeWsRoutes: WebSocketRoute[] = [];

async function setupWsPeer(page: Page): Promise<void> {
  activeWsRoutes = [];
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
    // Push an initial state event so the dashboard's `lastState`
    // is populated and the banner / positions table render
    // normally. Mirrors the 83-5 spec's pattern.
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
 * `close=100, high=110, low=90, open=100, volume=5` so the
 * REPLACE-branch assertions have known-good baselines.
 */
function pushBar(opts: { time?: number; close?: number; high?: number; low?: number } = {}): void {
  const payload = JSON.stringify({
    type: "bar",
    ts: Date.now(),
    symbol: "BTCUSDT",
    timeframe: "1h",
    ohlc: {
      time: opts.time ?? BAR_TIME_MS,
      open: 100,
      high: opts.high ?? 110,
      low: opts.low ?? 90,
      close: opts.close ?? 100,
      volume: 5,
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
 * Push a `tick` event. The default `symbol` is "BTCUSDT" (the
 * one the strategy renders); tests that exercise the
 * symbol-not-in-strategies branch pass a different `symbol`.
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

test.beforeEach(async ({ page }) => {
  activeWsRoutes = [];
  await setupHttpRoutes(page);
  await setupWsPeer(page);
});

// =============================================================================
// Tests
// =============================================================================

test("a tick REPLACEs the in-progress bar's close (within the same bar time)", async ({
  page,
}) => {
  await gotoApp(page);
  // The SNAPSHOT's bootstrap seeds the chart with 1 bar (at
  // `BOOTSTRAP_BAR.time`, i.e. 2h before the current 1h boundary).
  // Wait for the initial 1-bar state to land.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "1",
    { timeout: 5_000 },
  );

  // Seed: one bar at the current 1h boundary with close=100.
  // `appendOrReplaceBar` takes its APPEND branch
  // (BAR_TIME_MS > BOOTSTRAP_BAR.time) → count goes 1 → 2.
  pushBar({ close: 100 });
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "100",
    { timeout: 5_000 },
  );
  // The seeded high/low are preserved on the chart card.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-high",
    "110",
    { timeout: 5_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-low",
    "90",
    { timeout: 5_000 },
  );

  // First tick: price 105. The helper REPLACEs the last bar
  // (close=105, high=max(110,105)=110, low=min(90,105)=90).
  pushTick("BTCUSDT", 105);
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "105",
    { timeout: 5_000 },
  );
  // High / low unchanged.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-high",
    "110",
    { timeout: 1_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-low",
    "90",
    { timeout: 1_000 },
  );
  // Bars count stays at 2 (REPLACE, not APPEND).
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 1_000 },
  );
});

test("a tick above the existing high REPLACEs the last bar's high", async ({
  page,
}) => {
  await gotoApp(page);
  // Wait for the bootstrap's 1-bar state to land.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "1",
    { timeout: 5_000 },
  );
  // APPEND: push bar at BAR_TIME_MS (current 1h), count goes 1 → 2.
  pushBar({ close: 100, high: 110, low: 90 });
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );

  // Tick at 120 — above high (110). The REPLACE branch updates
  // high=120 and close=120.
  pushTick("BTCUSDT", 120);
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-high",
    "120",
    { timeout: 5_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "120",
    { timeout: 5_000 },
  );
  // Low unchanged.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-low",
    "90",
    { timeout: 1_000 },
  );
});

test("a tick below the existing low REPLACEs the last bar's low", async ({
  page,
}) => {
  await gotoApp(page);
  // Wait for the bootstrap's 1-bar state to land.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "1",
    { timeout: 5_000 },
  );
  // APPEND: push bar at BAR_TIME_MS, count goes 1 → 2.
  pushBar({ close: 100, high: 110, low: 90 });
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );

  // First bump the high to 120 (so we can verify it's preserved
  // across the subsequent low update).
  pushTick("BTCUSDT", 120);
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-high",
    "120",
    { timeout: 5_000 },
  );

  // Tick at 80 — below low (90). The REPLACE branch updates
  // low=80 and close=80; high preserved at 120.
  pushTick("BTCUSDT", 80);
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-low",
    "80",
    { timeout: 5_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "80",
    { timeout: 5_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-high",
    "120",
    { timeout: 1_000 },
  );
});

test("a tick for a symbol NOT in the strategy does not mutate the chart", async ({
  page,
}) => {
  await gotoApp(page);
  // Wait for the bootstrap's 1-bar state to land.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "1",
    { timeout: 5_000 },
  );
  // APPEND: push bar at BAR_TIME_MS, count goes 1 → 2.
  pushBar({ close: 100 });
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );
  const beforeClose = await page
    .locator(CHART_BODY_1H)
    .getAttribute("data-last-bar-close");

  // ETHUSDT is NOT in the strategy's `symbols` list. The
  // `applyTickToBars` helper's branch 3 returns barsByKey
  // unchanged.
  pushTick("ETHUSDT", 999);
  // Give the React render a beat to land (it should NOT).
  await page.waitForTimeout(500);
  const afterClose = await page
    .locator(CHART_BODY_1H)
    .getAttribute("data-last-bar-close");
  const afterCount = await page
    .locator(CHART_BODY_1H)
    .getAttribute("data-bars-count");
  expect(afterClose).toBe(beforeClose);
  expect(afterCount).toBe("2");
});

test("a tick APPENDs a new in-progress bar when the bar time is in the past", async ({
  page,
}) => {
  await gotoApp(page);
  // The SNAPSHOT's bootstrap seeds the chart with 1 bar at
  // `BOOTSTRAP_BAR.time` (2h before the current 1h boundary). The
  // bootstrap's `time` is BEFORE the tick's computed bar time
  // (current 1h), so the first tick APPENDs the new in-progress
  // bar (count 1 → 2). This is the APPEND branch of `applyTickToBars`.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "1",
    { timeout: 5_000 },
  );

  // First (and only) tick at "now" → helper computes the current
  // 1h boundary as barTime. last.time (2h ago, the bootstrap) <
  // barTime → APPEND branch.
  pushTick("BTCUSDT", 200);
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );
  // The new bar's OHLC = price (open=high=low=close=200, volume=0).
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-close",
    "200",
    { timeout: 5_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-high",
    "200",
    { timeout: 1_000 },
  );
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-last-bar-low",
    "200",
    { timeout: 1_000 },
  );
});

test("a malformed tick (non-finite price) does not mutate the chart", async ({
  page,
}) => {
  await gotoApp(page);
  // Wait for the bootstrap's 1-bar state to land.
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "1",
    { timeout: 5_000 },
  );
  // APPEND: push bar at BAR_TIME_MS, count goes 1 → 2.
  pushBar({ close: 100 });
  await expect(page.locator(CHART_BODY_1H)).toHaveAttribute(
    "data-bars-count",
    "2",
    { timeout: 5_000 },
  );
  const before = await page
    .locator(CHART_BODY_1H)
    .getAttribute("data-last-bar-close");

  // Push a tick with price=NaN. The helper's branch 2 (defensive
  // price check) returns barsByKey unchanged.
  const payload = JSON.stringify({
    type: "tick",
    ts: Date.now(),
    symbol: "BTCUSDT",
    price: null,
  });
  for (const w of activeWsRoutes) {
    try {
      w.send(payload);
    } catch {
      // best-effort
    }
  }
  await page.waitForTimeout(500);
  const after = await page
    .locator(CHART_BODY_1H)
    .getAttribute("data-last-bar-close");
  expect(after).toBe(before);
});
