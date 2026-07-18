/**
 * apps/web/e2e/58B-chart-card-coverage.spec.ts
 *
 * Phase 58B: Additional e2e tests for the uncovered branches in
 * `apps/web/src/components/ChartCard.tsx` (per the Phase 58
 * coverage report).
 *
 * **Targeted branches (per lcov BRDA):**
 *   - BRDA 301 — `isActiveRange(r.id, effectiveActiveRange)` in
 *     the range tab render. The TRUE arm (range is active) and
 *     FALSE arm (range is not active).
 *   - BRDA 304 — `if (activeRange === undefined) setLocalActiveRange(id);`
 *     in `handleRangeClick`. The TRUE arm (no parent override)
 *     and FALSE arm (parent controls the active range).
 *   - BRDA 314 — `if (bars.length === 0) { series.setData([]); return; }`
 *     in the bars effect. The TRUE arm (empty bars) and FALSE
 *     arm (non-empty bars → setData with mapped data).
 *   - BRDA 412 — `if (activeRange === undefined)` in
 *     `handleRangeClick`. The TRUE arm (local state) and FALSE
 *     arm (parent-controlled).
 *   - BRDA 488 — `markersAreVisible(markers)` in the legend
 *     render. The FALSE arm (no markers → no "Trade markers"
 *     legend item).
 *   - BRDA 510 — `isFeedMetaVisible(feedMeta)` in the feed
 *     indicator render. The FALSE arm (empty feedMeta → no
 *     meta span).
 *
 * **Pattern:** drive the React flow through specific paths
 * to exercise the branches:
 *   - Range tab click toggles the active range
 *   - Snapshot with many bars exercises the non-empty bars
 *     branch
 *   - Empty feedMeta (no errors) exercises the FALSE arm of
 *     `isFeedMetaVisible`
 *   - No markers (markers={undefined}) exercises the FALSE
 *     arm of `markersAreVisible`
 *
 * **Coverage delta estimate:** 5 new e2e tests × ~2 new
 * branches per test = +8-10 new branch hits on ChartCard.tsx.
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

// Phase 58B: register coverage collection hooks.
installCoverageHooks("58B-chart-card-coverage");

// =============================================================================
// Test helpers
// =============================================================================

interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly broadcast: (data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(
  page: Page,
  strategiesResponse?: string,
): Promise<WsTestHarness> {
  const responseRef: { current: string } = {
    current:
      strategiesResponse ??
      JSON.stringify({
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h", "4h"],
          },
        ],
      }),
  };

  await page.route("**/api/strategies", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: responseRef.current,
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

function makeBootstrap(symbol: string, tf: string, now: number): unknown[] {
  void symbol;
  const intervalMs = tf === "1h" ? 60 * 60_000 : 4 * 60 * 60_000;
  const out: unknown[] = [];
  let price = 67000;
  for (let i = 0; i < 20; i += 1) {
    const t = now - (19 - i) * intervalMs;
    const open = price;
    const delta = ((i * 7 + 3) % 11) - 5;
    price = Math.max(1, price + delta * 10);
    const close = price;
    out.push({
      time: t,
      open,
      high: Math.max(open, close) + 5,
      low: Math.min(open, close) - 5,
      close,
      volume: 100 + i,
    });
  }
  return out;
}

function sendInitialServerMessages(harness: WsTestHarness): void {
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
    snapshot: {},
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
        "1h": makeBootstrap("BTCUSDT", "1h", now),
        "4h": makeBootstrap("BTCUSDT", "4h", now),
      },
    },
  });
  const state = JSON.stringify({
    type: "state",
    ts: now,
    snapshot: {},
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

async function gotoAppBare(page: Page): Promise<void> {
  await page.goto("/");
}

// =============================================================================
// Tests
// =============================================================================

test.describe("58B — ChartCard.tsx branch coverage", () => {
  test("58B-C01: range tab click toggles active range (BRDA 301 TRUE/FALSE, 304, 412)", async ({
    page,
  }) => {
    // Targets: BRDA 301 (the `isActiveRange` ternary in the
    // range tab render — both arms) AND BRDA 304/412
    // (the `if (activeRange === undefined)` check in
    // `handleRangeClick`). The chart card renders 3 range
    // tabs (1H, 4H, 1D) by default. The first tab is active
    // initially; clicking a different tab toggles the active
    // range.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Wait for the chart cards to render.
    await expect
      .poll(
        () => page.locator(".line-chart-wrapper").count(),
        { timeout: 5_000, message: "expected 2 chart cards" },
      )
      .toBe(2);

    // The first chart card has range tabs.
    const firstCard = page.locator(".line-chart-wrapper").first();
    const rangeBtns = firstCard.locator(".line-chart-wrapper__range-button");
    await expect(rangeBtns.first()).toBeVisible({ timeout: 3_000 });

    // The first tab (1H) is active initially.
    const firstTab = rangeBtns.nth(0);
    const secondTab = rangeBtns.nth(1);
    await expect(firstTab).toHaveAttribute("aria-checked", "true");
    await expect(secondTab).toHaveAttribute("aria-checked", "false");

    // Click the second tab (4H). The active range toggles.
    await secondTab.click();

    // The second tab is now active, the first is not.
    await expect(secondTab).toHaveAttribute("aria-checked", "true");
    await expect(firstTab).toHaveAttribute("aria-checked", "false");

    // Click the first tab again. The active range toggles back.
    await firstTab.click();
    await expect(firstTab).toHaveAttribute("aria-checked", "true");
    await expect(secondTab).toHaveAttribute("aria-checked", "false");
  });

  test("58B-C02: snapshot with many bars (100+) — non-empty bars branch (BRDA 314 FALSE, 318 TRUE)", async ({
    page,
  }) => {
    // Targets: BRDA 314 FALSE arm (bars.length > 0 → don't return
    // early) AND BRDA 318 (the `series.setData(bars.map(...))`
    // call). Sending a snapshot with 100+ bars exercises the
    // non-empty bars path.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    const now = Date.now();
    const bars: unknown[] = [];
    let price = 67000;
    for (let i = 0; i < 100; i += 1) {
      const t = now - (99 - i) * 60 * 60_000;
      const open = price;
      const delta = ((i * 7 + 3) % 11) - 5;
      price = Math.max(1, price + delta * 10);
      const close = price;
      bars.push({
        time: t,
        open,
        high: Math.max(open, close) + 5,
        low: Math.min(open, close) - 5,
        close,
        volume: 100 + i,
      });
    }

    const hello = JSON.stringify({
      type: "hello",
      ts: now,
      serverVersion: "0.1.0",
      protocolVersion: 1,
    });
    const snapshot = JSON.stringify({
      type: "snapshot",
      ts: now,
      snapshot: {},
      strategies: [
        {
          name: "donchian_pivot_composition",
          enabled: true,
          symbols: ["BTCUSDT"],
          timeframes: ["1h", "4h"],
        },
      ],
      ohlcBootstrap: {
        BTCUSDT: { "1h": bars, "4h": bars },
      },
    });
    const state = JSON.stringify({
      type: "state",
      ts: now,
      snapshot: {},
      positions: [],
      closedTrades: [],
      killSwitch: "off",
      paused: false,
      statistics: { trades: 0, pnl: 0, drawdown: 0 },
    });
    harness.broadcast(hello);
    harness.broadcast(snapshot);
    harness.broadcast(state);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // 2 chart cards render with 100 bars each.
    await expect
      .poll(
        () => page.locator(".ep-feed").count(),
        { timeout: 5_000, message: "expected 2 feed indicators" },
      )
      .toBe(2);
  });

  test("58B-C03: empty feedMeta — isFeedMetaVisible FALSE arm (BRDA 510 FALSE)", async ({
    page,
  }) => {
    // Targets: BRDA 510 FALSE arm (`isFeedMetaVisible(feedMeta)`
    // returns false when feedMeta is empty). The `.ep-feed__meta`
    // element should NOT be rendered when there's no error and
    // no strategiesError.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Wait for the chart cards to render.
    await expect
      .poll(
        () => page.locator(".ep-feed").count(),
        { timeout: 5_000, message: "expected 2 feed indicators" },
      )
      .toBe(2);

    // No `.ep-feed__meta` element should be visible (feedMeta is empty).
    const metaCount = await page.locator(".ep-feed__meta").count();
    expect(metaCount).toBe(0);
  });

  test("58B-C04: no markers — markersAreVisible FALSE arm (BRDA 488 FALSE)", async ({
    page,
  }) => {
    // Targets: BRDA 488 FALSE arm (`markersAreVisible(markers)`
    // returns false when markers is undefined or empty). The
    // "Trade markers" legend item should NOT be rendered.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Wait for the chart cards to render.
    await expect
      .poll(
        () => page.locator(".line-chart-wrapper").count(),
        { timeout: 5_000, message: "expected 2 chart cards" },
      )
      .toBe(2);

    // No "Trade markers" legend item (markers are undefined).
    const tradeMarkersLegendCount = await page
      .locator(".line-chart-wrapper__legend-item:has-text('Trade markers')")
      .count();
    expect(tradeMarkersLegendCount).toBe(0);
  });

  test("58B-C05: snapshot with empty ohlcBootstrap — bars.length === 0 branch (BRDA 314 TRUE)", async ({
    page,
  }) => {
    // Targets: BRDA 314 TRUE arm (bars.length === 0 → call
    // `series.setData([])` and return early). Sending a snapshot
    // with empty ohlcBootstrap arrays exercises this branch.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    const now = Date.now();
    const hello = JSON.stringify({
      type: "hello",
      ts: now,
      serverVersion: "0.1.0",
      protocolVersion: 1,
    });
    // Send a snapshot with empty ohlcBootstrap arrays.
    const snapshot = JSON.stringify({
      type: "snapshot",
      ts: now,
      snapshot: {},
      strategies: [
        {
          name: "donchian_pivot_composition",
          enabled: true,
          symbols: ["BTCUSDT"],
          timeframes: ["1h", "4h"],
        },
      ],
      // Empty ohlcBootstrap arrays — exercises the bars.length === 0
      // branch in the ChartCard's bars effect.
      ohlcBootstrap: { BTCUSDT: { "1h": [], "4h": [] } },
    });
    const state = JSON.stringify({
      type: "state",
      ts: now,
      snapshot: {},
      positions: [],
      closedTrades: [],
      killSwitch: "off",
      paused: false,
      statistics: { trades: 0, pnl: 0, drawdown: 0 },
    });
    harness.broadcast(hello);
    harness.broadcast(snapshot);
    harness.broadcast(state);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // The chart cards render with empty data. The chart grid
    // should have 2 feed indicators (1 symbol × 2 timeframes).
    await expect
      .poll(
        () => page.locator(".ep-feed").count(),
        { timeout: 5_000, message: "expected 2 feed indicators" },
      )
      .toBe(2);
  });
});
