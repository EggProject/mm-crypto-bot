/**
 * apps/web/e2e/84-coverage-boost-disabled-indicators.spec.ts
 *
 * Phase 82 (PR #221 coverage push — fourth wave): e2e tests that
 * exercise the strategy-specific marker indicator branches that
 * require DISABLED strategies (the marker indicators are gated
 * behind `!enabled` in ChartCard.tsx Effect 2b).
 *
 * **The gap (from the most recent CI run, branch coverage 73.35%):**
 *
 * The 5 worst files in the e2e lane are:
 *   - donchian.ts          (48.38% branches, 16 missing)
 *   - bollinger.ts         (58.33% branches, 20 missing)
 *   - daily-pivot.ts       (60.00% branches, 18 missing)
 *   - client-compute.ts    (58.33% branches, 50 missing)
 *   - strategy-indicators.ts (61.53% branches, 10 missing)
 *
 * Many of the client-compute.ts missing branches are in the
 * marker indicator compute functions:
 *   - `computeCascadeEventsFromBars` (lines 669, 675, 682, 708, 709)
 *   - `computeFundingFlipsFromBars` (lines 751, 752, 766-778)
 *   - `computeRegimeFromBars` (lines 859, 868, 888, 901, 907, 946)
 *   - `computeRegimeChangeMarkersFromBars` (lines 970, 972, 996)
 *
 * These are ONLY called when the strategy is DISABLED
 * (ChartCard.tsx Effect 2b gates markers behind `!enabled`).
 * The existing 82-coverage-boost-indicators tests use
 * `enabled: true` for the "disabled" strategies (to avoid the
 * empty-state branch), so the marker indicators are skipped.
 *
 * **Strategy:** set up a mixed-enable configuration (1 enabled
 * strategy to keep the grid rendering + 1 disabled strategy to
 * actually exercise its marker indicators), and send specific
 * bar patterns to hit the missing branches.
 *
 * **Test setup (mirrors 81-disabled-strategy-indicators but
 * with mixed enable/disable to keep the grid populated):**
 *   - donchian_pivot_composition: enabled
 *   - cascade_fade: disabled (markers run)
 *   - funding_flip_kill_switch: disabled (markers run)
 *   - regime_detector: disabled (markers run)
 *
 * **Target branches (per test):**
 *   84-01: cascade_fade with 1 bar → `if (bars.length < 2) return markers;` TRUE arm
 *   84-02: cascade_fade with prev.close=0 → `if (prev.close <= 0) continue;` TRUE arm
 *   84-03: cascade_fade with steady bars → `if (absMove < thresholdPct) continue;` TRUE arm
 *   84-04: cascade_fade with small 1.5% cascade → `if (severity > 0.5)` FALSE arm
 *   84-05: funding_flip_kill_switch with EPS-range bars → `if (Math.abs(prev) < EPS && Math.abs(cur) < EPS) continue;` TRUE arm
 *   84-06: regime_detector with 1 bar → `if (n < lookback)` TRUE arm in computeRegimeFromBars
 *   84-07: regime_detector with 25 bars trending → `if (gap > GAP_THRESHOLD)` TRUE arm
 *   84-08: funding_spread with prev.close=0 → `if (... <= 0)` TRUE arm in computeFundingSpreadFromBars
 *   84-09: dydx_cex_carry with 1 bar → `if (n <= lookback)` TRUE arm in computeFundingRateFromBars
 *   84-10: dydx_cex_carry with 1 bar → `if (n <= lookback)` TRUE arm in computeFundingSpreadFromBars
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";

setSpecName("84-coverage-boost-disabled-indicators");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// ============================================================================
// Test fixtures
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

test.describe("Phase 82 (fourth wave): disabled-strategy marker indicator branches", () => {
  // The mixed setup: 1 enabled + 4 disabled strategies. The
  // grid renders all 5 cards. The 4 disabled strategies' marker
  // indicators ARE applied (gated behind !enabled).
  const MIXED_STRATEGIES = [
    { name: "donchian_pivot_composition", enabled: true, symbols: ["BTCUSDT"], timeframes: ["1h"] },
    { name: "dydx_cex_carry", enabled: false, symbols: ["BTCUSDT"], timeframes: ["1h"] },
    { name: "cascade_fade", enabled: false, symbols: ["BTCUSDT"], timeframes: ["1h"] },
    { name: "funding_flip_kill_switch", enabled: false, symbols: ["BTCUSDT"], timeframes: ["1h"] },
    { name: "regime_detector", enabled: false, symbols: ["BTCUSDT"], timeframes: ["1h"] },
  ] as const;

  test("84-01: cascade_fade disabled with 1 bar — exercises the bars.length < 2 branch", async ({
    page,
  }) => {
    // With 1 bar, computeCascadeEventsFromBars returns []
    // immediately via `if (bars.length < 2) return markers;`.
    // This branch is only reachable for DISABLED cascade_fade
    // (the marker indicators are gated behind !enabled).
    const bars = makeBars(1, () => 67000);
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "cascade_fade");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("84-02: cascade_fade disabled with prev.close=0 bar — exercises the prev.close <= 0 continue branch", async ({
    page,
  }) => {
    // Bar 5 has close=0. At i=6, prev=bar[5] (close=0) →
    // `if (prev.close <= 0) continue;` TRUE arm fires.
    const intervalMs = 60 * 60_000;
    const now = Date.now();
    const bars: unknown[] = [];
    let lastClose = 67000;
    for (let i = 0; i < 15; i += 1) {
      const close = i === 5 ? 0 : 67000 + i;
      bars.push({
        time: now - (14 - i) * intervalMs,
        open: lastClose,
        high: Math.max(lastClose, close) + 5,
        low: Math.min(lastClose, close) - 5,
        close,
        volume: 100 + i,
      });
      lastClose = close === 0 ? lastClose : close;
    }
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "cascade_fade");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("84-03: cascade_fade disabled with steady bars — exercises the absMove < thresholdPct continue branch (all bars)", async ({
    page,
  }) => {
    // All bars have small <2% moves → every loop iteration
    // hits the `if (absMove < thresholdPct) continue;` TRUE
    // arm. The cascade marker compute never emits a marker.
    const intervalMs = 60 * 60_000;
    const now = Date.now();
    const bars: unknown[] = [];
    let lastClose = 67000;
    for (let i = 0; i < 15; i += 1) {
      const close = 67000 + (i % 2 === 0 ? 5 : -5); // tiny noise
      bars.push({
        time: now - (14 - i) * intervalMs,
        open: lastClose,
        high: Math.max(lastClose, close) + 5,
        low: Math.min(lastClose, close) - 5,
        close,
        volume: 100 + i,
      });
      lastClose = close;
    }
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "cascade_fade");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("84-04: cascade_fade disabled with 1.5% cascade — exercises the severity > 0.5 FALSE arm", async ({
    page,
  }) => {
    // 1.5% move < 2% threshold → no cascade emitted
    // (line 682 continue). 3% move → severity = 0.5 → circle
    // (line 708 FALSE arm). We send a 2.5% move → severity
    // = min(1, 2.5/6) = 0.42 → circle (FALSE arm of line
    // 708). Then a 1% move → continue (line 682 TRUE arm).
    const intervalMs = 60 * 60_000;
    const now = Date.now();
    const bars: unknown[] = [];
    let lastClose = 67000;
    for (let i = 0; i < 15; i += 1) {
      let close: number;
      if (i === 5) close = lastClose * 1.025; // +2.5% → severity 0.42
      else if (i === 10) close = lastClose * 1.01; // +1% → continue
      else close = 67000 + i;
      bars.push({
        time: now - (14 - i) * intervalMs,
        open: lastClose,
        high: Math.max(lastClose, close) + 5,
        low: Math.min(lastClose, close) - 5,
        close,
        volume: 100 + i,
      });
      lastClose = close;
    }
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "cascade_fade");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("84-05: funding_flip_kill_switch disabled with EPS-range bars — exercises the no-real-flip branch", async ({
    page,
  }) => {
    // Bars oscillate by ±0.5 over 20 bars. The funding rate
    // (log return over 8 bars) is around 0.0001 — well below
    // EPS=0.0005. The `if (Math.abs(prev) < EPS && Math.abs
    // (cur) < EPS) continue;` TRUE arm fires.
    const intervalMs = 60 * 60_000;
    const now = Date.now();
    const bars: unknown[] = [];
    let lastClose = 67000;
    for (let i = 0; i < 20; i += 1) {
      const close = 67000 + (i % 2 === 0 ? 0 : 0.5);
      bars.push({
        time: now - (19 - i) * intervalMs,
        open: lastClose,
        high: Math.max(lastClose, close) + 5,
        low: Math.min(lastClose, close) - 5,
        close,
        volume: 100 + i,
      });
      lastClose = close;
    }
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "funding_flip_kill_switch");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("84-06: regime_detector disabled with 1 bar — exercises the n < lookback branch in computeRegimeFromBars", async ({
    page,
  }) => {
    // With 1 bar, computeRegimeFromBars returns early at
    // `if (n < lookback) return out;` (line 859 / source
    // 859). Only reachable for DISABLED regime_detector.
    const bars = makeBars(1, () => 67000);
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "regime_detector");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("84-07: regime_detector disabled with 25 bars trending — exercises the gap > GAP_THRESHOLD branch", async ({
    page,
  }) => {
    // Steady uptrend from 67000 to 67024 over 25 bars. At
    // i=24, the rolling mean is ~67110, std is small, but
    // the gap (abs(close - mean) / std) is large because
    // close = 67024 is far from the rolling mean. The
    // `if (gap > GAP_THRESHOLD) out[i] = "trending"` arm
    // fires.
    const bars = makeBars(25, (i) => 67000 + i * 10);
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "regime_detector");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("84-08: dydx_cex_carry disabled with prev.close=0 bar — exercises the spread compute's <=0 branch", async ({
    page,
  }) => {
    // The dydx_cex_carry strategy uses funding_spread
    // (line indicator, always called). Bar 5 has close=0.
    // At i=13 (lookback=8), the spread compute sees
    // prevFast or curFast <= 0 → `if (... <= 0) spread[i] =
    // 0; continue;` TRUE arm fires.
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
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "dydx_cex_carry");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("84-09: dydx_cex_carry disabled with 1 bar — exercises the n <= lookback branch in computeFundingRateFromBars", async ({
    page,
  }) => {
    // With 1 bar, computeFundingRateFromBars returns early
    // at `if (n <= lookback) return { funding };` (line 510).
    // The line indicator is always called regardless of
    // `enabled`, so this fires for both enabled and disabled.
    const bars = makeBars(1, () => 67000);
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "dydx_cex_carry");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("84-10: dydx_cex_carry disabled with 1 bar — exercises the n <= lookback branch in computeFundingSpreadFromBars", async ({
    page,
  }) => {
    // With 1 bar, computeFundingSpreadFromBars returns
    // early at `if (n <= lookback) return { spread };`
    // (line 573).
    const bars = makeBars(1, () => 67000);
    const harness = await setupWsPeer(page, MIXED_STRATEGIES);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, MIXED_STRATEGIES, bars);
    await waitForChartCard(page, "dydx_cex_carry");
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });
});
