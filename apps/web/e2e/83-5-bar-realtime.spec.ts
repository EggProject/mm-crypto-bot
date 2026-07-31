/**
 * apps/web/e2e/83-5-bar-realtime.spec.ts
 *
 * Phase 83.5 (Bug 1 — OHLCV not refreshing): e2e regression test
 * for the WS `bar` event → chart bars data flow.
 *
 * Background: previously `App.tsx` destructured `lastBar` from
 * `useWebSocket()` and built `barsByKey` as a `useMemo([snapshot])`.
 * Since `snapshot` is set ONCE on mount (the initial SNAPSHOT
 * message), the chart's bar stream was FROZEN on the bootstrap
 * data — every subsequent `bar` event was dropped.
 *
 * The fix: destructure `lastBar`, convert `barsByKey` to
 * `useState` + 2 `useEffects` (snapshot seeds, lastBar appends
 * or replaces). The `data-bars-count` attribute on the chart
 * card body is the e2e observable for the bar stream.
 *
 * Coverage:
 *   1. Snapshot seed — `data-bars-count === 1` from the SNAPSHOT
 *      bootstrap (1 bar per the fixture).
 *   2. New bar at a NEW time — `data-bars-count` grows by 1.
 *   3. New bar at the SAME time — `data-bars-count` STAYS at the
 *      same value (the in-place REPLACE branch).
 *   4. Three bar pushes in sequence produce the expected
 *      count trajectory: 1 → 2 → 2 (replace) → 3 (append).
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
import type { WebSocketRoute } from "@playwright/test";

// Phase 57: register coverage collection hooks.
setSpecName("83-5-bar-realtime");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// =============================================================================
// Test state + fixtures
// =============================================================================

const BASE_TIME = 1_700_000_000_000; // 2023-11-14T22:13:20Z — a fixed time so the assertions are deterministic.

/** The bootstrap bar sent in the SNAPSHOT message. */
const BOOTSTRAP_BAR = {
  time: BASE_TIME,
  open: 60_000,
  high: 60_500,
  low: 59_500,
  close: 60_200,
  volume: 100,
};

/**
 * The `bar` event payload shape. The fixture uses BTCUSDT (matches
 * the SNAPSHOT's symbol) so the chart-card body selector
 * `chart-card-body-BTCUSDT-1h` is the SUT.
 */
interface BarEvent {
  readonly type: "bar";
  readonly ts: number;
  readonly symbol: string;
  readonly timeframe: string;
  readonly ohlc: {
    readonly time: number;
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume: number;
  };
}

/** Build a `bar` event at a relative time offset (in seconds). */
function barEvent(timeOffsetSec: number, close: number): BarEvent {
  return {
    type: "bar",
    ts: Date.now(),
    symbol: "BTCUSDT",
    timeframe: "1h",
    ohlc: {
      time: BASE_TIME + timeOffsetSec * 1000,
      open: close - 50,
      high: close + 100,
      low: close - 200,
      close,
      volume: 50,
    },
  };
}

// =============================================================================
// WS + HTTP setup
// =============================================================================

/**
 * Module-level handle to the open WebSocketRoute(s) so the tests
 * can push bar events. Initialized in `beforeEach` (a new WS route
 * per test), cleared in `afterEach`.
 */
let activeWsRoutes: WebSocketRoute[] = [];
let pendingBroadcast: (() => void) | null = null;

async function setupWsPeer(page: Page): Promise<void> {
  activeWsRoutes = [];
  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    activeWsRoutes.push(ws);
    if (pendingBroadcast) {
      const r = pendingBroadcast;
      pendingBroadcast = null;
      r();
    }
    ws.send(
      JSON.stringify({
        type: "hello",
        ts: Date.now(),
        serverVersion: "0.1.0-test",
        protocolVersion: 1,
      }),
    );
    // SNAPSHOT with a 1-bar bootstrap for BTCUSDT 1h.
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
        ohlcBootstrap: {
          BTCUSDT: { "1h": [BOOTSTRAP_BAR], "4h": [] },
        },
      }),
    );
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
  // Wait for the chart card body to mount.
  await expect(
    page.locator('[data-testid="chart-card-body-BTCUSDT-1h"]'),
  ).toBeVisible({ timeout: 10_000 });
}

/** Push a `bar` event to every open WS (mirrors the real state-feed's broadcast). */
function pushBar(bar: BarEvent): void {
  const payload = JSON.stringify(bar);
  for (const w of activeWsRoutes) {
    try {
      w.send(payload);
    } catch {
      // best-effort
    }
  }
}

test.beforeEach(async ({ page }) => {
  await setupHttpRoutes(page);
  await setupWsPeer(page);
});

// =============================================================================
// Tests
// =============================================================================

test("the snapshot seed sets the chart's initial bar count", async ({ page }) => {
  await gotoApp(page);
  // The snapshot carries 1 bar for BTCUSDT 1h.
  await expect(
    page.locator('[data-testid="chart-card-body-BTCUSDT-1h"]'),
  ).toHaveAttribute("data-bars-count", "1", { timeout: 5_000 });
});

test("a WS bar event with a NEW time grows the chart's bar count by 1 (append branch)", async ({
  page,
}) => {
  await gotoApp(page);
  const card = page.locator('[data-testid="chart-card-body-BTCUSDT-1h"]');
  await expect(card).toHaveAttribute("data-bars-count", "1", { timeout: 5_000 });

  // Push a bar at a STRICTLY GREATER time (+1h).
  pushBar(barEvent(3_600, 60_500));
  await expect(card).toHaveAttribute("data-bars-count", "2", { timeout: 5_000 });
});

test("a WS bar event with the SAME time replaces the last bar in place (replace branch, no count change)", async ({
  page,
}) => {
  await gotoApp(page);
  const card = page.locator('[data-testid="chart-card-body-BTCUSDT-1h"]');
  await expect(card).toHaveAttribute("data-bars-count", "1", { timeout: 5_000 });

  // Push a bar at the SAME time as the bootstrap bar — this is the
  // in-progress OHLCV update path. The last bar's `close` is
  // updated in place, the count STAYS at 1.
  pushBar({
    ...barEvent(0, 61_000),
    ohlc: { ...barEvent(0, 61_000).ohlc, time: BASE_TIME }, // explicit same-time
  });
  await expect(card).toHaveAttribute("data-bars-count", "1", { timeout: 5_000 });
});

test("the bar stream updates the count in the right order: 1 → 2 (append) → 2 (replace) → 3 (append)", async ({
  page,
}) => {
  await gotoApp(page);
  const card = page.locator('[data-testid="chart-card-body-BTCUSDT-1h"]');
  // Initial: 1 bar (the bootstrap).
  await expect(card).toHaveAttribute("data-bars-count", "1", { timeout: 5_000 });

  // Push 1: a new bar at a new time → 2 bars.
  pushBar(barEvent(3_600, 60_500));
  await expect(card).toHaveAttribute("data-bars-count", "2", { timeout: 5_000 });

  // Push 2: a new bar at the SAME time as the last bar → STAYS at 2 (replace).
  pushBar(barEvent(3_600, 60_700));
  await expect(card).toHaveAttribute("data-bars-count", "2", { timeout: 5_000 });

  // Push 3: a new bar at a NEW time → 3 bars.
  pushBar(barEvent(7_200, 61_000));
  await expect(card).toHaveAttribute("data-bars-count", "3", { timeout: 5_000 });
});
