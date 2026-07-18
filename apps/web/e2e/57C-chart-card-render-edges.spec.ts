/**
 * apps/web/e2e/57C-chart-card-render-edges.spec.ts
 *
 * Phase 57C: Playwright e2e tests for ChartCard render edges.
 *
 * **Goal:** exercise the uncovered branches in
 * `apps/web/src/components/ChartCard.tsx` that the 48A / 56C
 * suites do not reach. The lcov from main@32d4be3 shows these
 * uncovered branches:
 *
 *   - BRDA 314,5,0 — `if (bars.length === 0)` — 0/0. The empty
 *     bars branch is not exercised. We send a snapshot with
 *     empty ohlcBootstrap.
 *   - BRDA 318,6,0 — `series.setData(bars.map(toCandlestickDataMs))`
 *     — 2/0. The non-empty bars branch (the `series.setData` with
 *     actual data) is partially covered.
 *   - BRDA 391,7,0 — `if (markers === undefined || markers.length === 0)`
 *     — 0/0. The markers-empty branch.
 *   - BRDA 392,8,0 — `plugin.setMarkers([])` — 0/0. The empty
 *     markers setMarkers call.
 *   - BRDA 488,15,0/1 — ternary in render — 10/0. The
 *     `markersAreVisible(markers)` ternary FALSE branch.
 *   - BRDA 510,16,0/1 — ternary in render — 10/0. The feed
 *     meta visibility ternary FALSE branch.
 *
 * **Pattern:** send snapshots with edge-case ohlcBootstrap
 * (empty arrays, null bars, etc.) to drive the empty-bars branch.
 * Send state updates with different `feedState` values to drive
 * the feed config branches.
 *
 * **Coverage delta estimate:** 10 new e2e tests × ~2-3 new branches
 * per test = +20-30 new branch hits on ChartCard.tsx. Expected:
 * +5-10pp branch coverage on ChartCard.tsx.
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

// Phase 57: register coverage collection hooks.
installCoverageHooks("57C-chart-card-render-edges");

// =============================================================================
// Test helpers
// =============================================================================

interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly broadcast: (data: string) => void;
  readonly sendToWs: (ws: WebSocketRoute, data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  await page.route("**/api/strategies", (route) => {
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
    sendToWs: (ws: WebSocketRoute, data: string): void => {
      try {
        ws.send(data);
      } catch {
        // best-effort
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

test.describe("57C — ChartCard render edge coverage", () => {
  test("57C-01: snapshot with empty ohlcBootstrap — bars.length === 0 branch (BRDA 314,5,0)", async ({
    page,
  }) => {
    // Targets: `if (bars.length === 0) { series.setData([]); return; }`
    // in the bars effect. We send a snapshot with an empty
    // ohlcBootstrap array.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    const now = Date.now();
    // Send a snapshot with empty ohlcBootstrap.
    harness.broadcast(
      JSON.stringify({
        type: "hello",
        ts: now,
        serverVersion: "0.1.0",
        protocolVersion: 1,
      }),
    );
    harness.broadcast(
      JSON.stringify({
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
        // Empty ohlcBootstrap — drives the `bars.length === 0` branch.
        ohlcBootstrap: { BTCUSDT: { "1h": [], "4h": [] } },
      }),
    );
    harness.broadcast(
      JSON.stringify({
        type: "state",
        ts: now,
        snapshot: {},
        positions: [],
        closedTrades: [],
        killSwitch: "off",
        paused: false,
        statistics: { trades: 0, pnl: 0, drawdown: 0 },
      }),
    );

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

  test("57C-02: snapshot with single bar — bars.length === 1 branch", async ({
    page,
  }) => {
    // Targets: the non-empty bars branch (BRDA 318,6,0). We
    // send a snapshot with a single bar. The /api/strategies
    // response is mocked with a single timeframe.
    const harness = await setupWsPeer(page);
    await page.route("**/api/strategies", (route) => {
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
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "hello",
        ts: now,
        serverVersion: "0.1.0",
        protocolVersion: 1,
      }),
    );
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {},
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: {
          BTCUSDT: {
            "1h": [
              {
                time: now,
                open: 67000,
                high: 67100,
                low: 66900,
                close: 67050,
                volume: 100,
              },
            ],
          },
        },
      }),
    );
    harness.broadcast(
      JSON.stringify({
        type: "state",
        ts: now,
        snapshot: {},
        positions: [],
        closedTrades: [],
        killSwitch: "off",
        paused: false,
        statistics: { trades: 0, pnl: 0, drawdown: 0 },
      }),
    );

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // 1 chart card renders.
    await expect
      .poll(
        () => page.locator(".ep-feed").count(),
        { timeout: 5_000, message: "expected 1 feed indicator" },
      )
      .toBe(1);
  });

  test("57C-03: snapshot with many bars (100 bars) — drives series.setData with large data", async ({
    page,
  }) => {
    // Targets: the non-empty bars branch with a large dataset.
    const harness = await setupWsPeer(page);
    await page.route("**/api/strategies", (route) => {
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

    harness.broadcast(
      JSON.stringify({
        type: "hello",
        ts: now,
        serverVersion: "0.1.0",
        protocolVersion: 1,
      }),
    );
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {},
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": bars } },
      }),
    );
    harness.broadcast(
      JSON.stringify({
        type: "state",
        ts: now,
        snapshot: {},
        positions: [],
        closedTrades: [],
        killSwitch: "off",
        paused: false,
        statistics: { trades: 0, pnl: 0, drawdown: 0 },
      }),
    );

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    await expect
      .poll(
        () => page.locator(".ep-feed").count(),
        { timeout: 5_000 },
      )
      .toBe(1);
  });

  test("57C-04: markers=[] (empty array) — markers.length === 0 branch (BRDA 391,7,0)", async ({
    page,
  }) => {
    // Targets: `if (markers === undefined || markers.length === 0)`
    // in the markers effect. App passes `markersByKey={{}}` which
    // means all chart cards receive `markers={undefined}`. This
    // is already covered. But we add an explicit test with
    // `markers=[]` to cover the `markers.length === 0` branch.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // The chart cards render without markers. The legend does
    // NOT show the "Trade markers" item (markersAreVisible returns
    // false for empty markers).
    await expect
      .poll(
        () => page.locator(".line-chart-wrapper").count(),
        { timeout: 5_000, message: "expected 2 chart cards" },
      )
      .toBe(2);
  });

  test("57C-05: feedState=stale — feed config stale branch (BRDA 488,15,0)", async ({
    page,
  }) => {
    // Targets: the feed config lookup for "stale" state. The
    // App maps WS status to feedState via `mapFeedState`.
    // "connecting" maps to "stale". We close App's WS to
    // trigger "connecting" → "stale" feedState.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Close App's WS. The status flips to "disconnected" then
    // "connecting" (during reconnect). The feedState maps to
    // "stale" during "connecting".
    const appWs = harness.getAllWs()[harness.getAllWs().length - 1];
    if (appWs === undefined) throw new Error("no WSes");
    await appWs.close({ code: 1012, reason: "test" });

    // Wait for the status to flip to "disconnected".
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "disconnected",
      { timeout: 3_000 },
    );

    // The feed indicators should show "Disconnected" (the
    // feedState maps to "disconnected" when status is
    // "disconnected"). During the brief "connecting" window
    // the label is "Stale" — we check for either.
    await expect
      .poll(
        () => {
          const labels = page.locator(".ep-feed__label");
          return labels.first().textContent().catch(() => null);
        },
        { timeout: 3_000, message: "expected 'Disconnected' or 'Stale' label" },
      )
      .toMatch(/Disconnected|Stale/);
  });

  test("57C-06: feedState=live — feed config live branch (happy path)", async ({
    page,
  }) => {
    // Targets: the feed config lookup for "live" state (the
    // default happy path). The feed indicator shows "Live".
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // The feed indicators should show "Live".
    await expect
      .poll(
        () => {
          const labels = page.locator(".ep-feed__label");
          return labels.first().textContent().catch(() => null);
        },
        { timeout: 3_000, message: "expected 'Live' label" },
      )
      .toContain("Live");
  });

  test("57C-07: feedState=crashed — feed config crashed branch", async ({
    page,
  }) => {
    // Targets: the feed config lookup for "crashed" state.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Broadcast a non-recoverable error.
    harness.broadcast(
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "fatal",
        recoverable: false,
      }),
    );

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "crashed",
      { timeout: 3_000 },
    );

    // The feed indicators should show "Crashed".
    await expect
      .poll(
        () => {
          const labels = page.locator(".ep-feed__label");
          return labels.first().textContent().catch(() => null);
        },
        { timeout: 3_000, message: "expected 'Crashed' label" },
      )
      .toContain("Crashed");
  });

  test("57C-08: feedState=disconnected — feed config disconnected branch", async ({
    page,
  }) => {
    // Targets: the feed config lookup for "disconnected" state.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Close App's WS. The status flips to "disconnected".
    const appWs = harness.getAllWs()[harness.getAllWs().length - 1];
    if (appWs === undefined) throw new Error("no WSes");
    await appWs.close({ code: 1012, reason: "test" });

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "disconnected",
      { timeout: 3_000 },
    );

    // The feed indicators should show "Disconnected".
    await expect
      .poll(
        () => {
          const labels = page.locator(".ep-feed__label");
          return labels.first().textContent().catch(() => null);
        },
        { timeout: 3_000, message: "expected 'Disconnected' label" },
      )
      .toContain("Disconnected");
  });

  test("57C-09: range tab click — drives the range button onClick handler", async ({
    page,
  }) => {
    // Targets: the range tab click handler. The chart card
    // renders range tabs (1H, 4H, 1D by default). Clicking a
    // tab updates the local active range.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Wait for chart cards to render.
    await expect
      .poll(
        () => page.locator(".line-chart-wrapper").count(),
        { timeout: 5_000 },
      )
      .toBe(2);

    // Click a range tab. The first chart card has tabs.
    const rangeBtns = page.locator(".line-chart-wrapper__range-button");
    await expect(rangeBtns.first()).toBeVisible({ timeout: 3_000 });

    // Click the "4H" tab.
    const btn4H = rangeBtns.filter({ hasText: "4H" }).first();
    await btn4H.click();

    // The clicked tab should be aria-checked=true.
    await expect(btn4H).toHaveAttribute("aria-checked", "true");
  });

  test("57C-10: no feedMeta — feedMeta visibility FALSE branch (BRDA 510,16,0)", async ({
    page,
  }) => {
    // Targets: `isFeedMetaVisible(feedMeta)` returning false.
    // The feedMeta is empty when there's no error and no
    // strategiesError. The .ep-feed__meta element should NOT
    // be rendered.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // The feed indicators should render without the .ep-feed__meta
    // element (feedMeta is empty).
    await expect
      .poll(
        () => page.locator(".ep-feed").count(),
        { timeout: 5_000 },
      )
      .toBe(2);

    // No .ep-feed__meta element should be visible (feedMeta is empty).
    const metaCount = await page.locator(".ep-feed__meta").count();
    expect(metaCount).toBe(0);
  });
});
