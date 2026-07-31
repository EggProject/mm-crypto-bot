/**
 * apps/web/e2e/83-5-trades-realtime.spec.ts
 *
 * Phase 83.5 (Bug 2 — TradeHistoryTable polling): e2e regression
 * test for the WS `state` event → TradeHistoryTable data flow.
 *
 * Background: previously `TradeHistoryTable` polled
 * `GET /api/trades` every 5 seconds. The user mandate is to use
 * the WebSocket for ALL real-time data — no polling. The WS
 * `state` event already carries `positions` (open) + `history`
 * (closed); the new prop-driven component consumes these via
 * the pure `tradesFromState(lastState)` helper.
 *
 * Coverage:
 *   1. Empty state — "No closed trades yet" before any state
 *   2. State push with 1 open + 0 closed → 1 row, status "open"
 *   3. State push with 0 open + 1 closed → 1 row, status "closed"
 *   4. State push with mixed → 2 rows, sorted by (exitTime ?? entryTime) desc
 *   5. State push with 2 closed → 2 rows (in-place update, no
 *      row duplication when the same `id` re-arrives with new
 *      data)
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
import type { WebSocketRoute } from "@playwright/test";

// Phase 57: register coverage collection hooks.
setSpecName("83-5-trades-realtime");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// =============================================================================
// Test state + fixtures
// =============================================================================

/**
 * The bot's mock state, pushed via WS `state` events. The test
 * mutates this BEFORE pushing via `pushState()`.
 */
const botState: {
  positions: readonly Record<string, unknown>[];
  closedTrades: readonly Record<string, unknown>[];
} = {
  positions: [],
  closedTrades: [],
};

// =============================================================================
// WS + HTTP setup
// =============================================================================

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
        ohlcBootstrap: { BTCUSDT: { "1h": [], "4h": [] } },
      }),
    );
    // Push the initial state so the dashboard's `lastState` is
    // populated. Tests can re-push via `pushState()` after
    // mutating `botState`.
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
    // The dashboard no longer polls /api/trades (Phase 83.5 Bug 2
    // fix). The route is registered for any external consumer.
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
  // The trade history section must be in the DOM.
  await expect(page.locator('[data-testid="trades"] h2')).toBeVisible({
    timeout: 5_000,
  });
}

/**
 * Push a `state` event with the current `botState`. The payload
 * shape mirrors the REAL bot's WS `state` message (see
 * `apps/web/src/ws-client.ts:86-94`): the `positions` and
 * `closedTrades` fields live at the TOP LEVEL (not inside the
 * `snapshot`). The dashboard's `tradesFromState(lastState)` helper
 * reads these top-level fields first.
 */
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
    positions: botState.positions,
    closedTrades: botState.closedTrades,
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

test.beforeEach(async ({ page }) => {
  // Reset the per-test state.
  botState.positions = [];
  botState.closedTrades = [];
  await setupHttpRoutes(page);
  await setupWsPeer(page);
});

// =============================================================================
// Tests
// =============================================================================

test("renders the empty state when no trades are present in the state event", async ({
  page,
}) => {
  await gotoApp(page);
  await expect(page.locator('[data-testid="trades-empty"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="trades-table"]')).toHaveCount(0);
});

test("a state push with 1 open + 0 closed trades renders 1 row with status 'open'", async ({
  page,
}) => {
  botState.positions = [
    {
      id: "donchian_pivot_composition:BTC/USDC:buy",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60_000,
      currentPrice: 60_100,
      quantity: 0.01,
      leverage: 5,
      unrealizedPnl: 1,
      unrealizedPnlPct: 0.17,
      openedAt: Date.now() - 60_000,
      stopLoss: null,
      takeProfit: null,
    },
  ];
  await gotoApp(page);
  // The initial state push (setTimeout in setupWsPeer) carries
  // the open position; the table renders 1 row.
  await expect(page.locator('[data-testid="trades-row"]')).toHaveCount(1, {
    timeout: 10_000,
  });
  await expect(
    page.locator('[data-testid="trades-row"]').first(),
  ).toHaveAttribute("data-status", "open");
});

test("a state push with 0 open + 1 closed trades renders 1 row with status 'closed'", async ({
  page,
}) => {
  botState.closedTrades = [
    {
      id: "t-1",
      symbol: "ETH/USDC",
      side: "sell",
      entryPrice: 3_000,
      exitPrice: 2_900,
      quantity: 0.5,
      leverage: 3,
      pnlUsdt: 50,
      pnlPct: 5,
      openedAt: Date.now() - 7_200_000,
      closedAt: Date.now() - 3_600_000,
      reason: "donchian_pivot_composition",
    },
  ];
  await gotoApp(page);
  await expect(page.locator('[data-testid="trades-row"]')).toHaveCount(1, {
    timeout: 10_000,
  });
  await expect(
    page.locator('[data-testid="trades-row"]').first(),
  ).toHaveAttribute("data-status", "closed");
});

test("a state push with mixed (open + closed) renders rows in (exitTime ?? entryTime) desc order", async ({
  page,
}) => {
  const now = Date.now();
  botState.positions = [
    {
      id: "donchian_pivot_composition:SOL/USDC:buy",
      symbol: "SOL/USDC",
      side: "buy",
      entryPrice: 100,
      currentPrice: 105,
      quantity: 1,
      leverage: 5,
      unrealizedPnl: 5,
      unrealizedPnlPct: 5,
      openedAt: now - 30_000, // Most recent — should be first.
      stopLoss: null,
      takeProfit: null,
    },
  ];
  botState.closedTrades = [
    {
      id: "old-closed",
      symbol: "ETH/USDC",
      side: "sell",
      entryPrice: 3_000,
      exitPrice: 2_900,
      quantity: 0.5,
      leverage: 3,
      pnlUsdt: 50,
      pnlPct: 5,
      openedAt: now - 7_200_000,
      closedAt: now - 7_200_000,
      reason: "donchian_pivot_composition",
    },
  ];
  await gotoApp(page);
  const rows = page.locator('[data-testid="trades-row"]');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });
  // Most-recent first: the open position (30s ago) is row 0, the
  // closed trade (2h ago) is row 1.
  await expect(rows.nth(0)).toHaveAttribute("data-status", "open");
  await expect(rows.nth(0)).toContainText("SOL/USDC");
  await expect(rows.nth(1)).toHaveAttribute("data-status", "closed");
  await expect(rows.nth(1)).toContainText("ETH/USDC");
});

test("a subsequent state push with the SAME id updates the row in place (no row duplication)", async ({
  page,
}) => {
  // Initial state: 1 closed trade.
  botState.closedTrades = [
    {
      id: "t-1",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60_000,
      exitPrice: 60_500,
      quantity: 0.01,
      leverage: 5,
      pnlUsdt: 5,
      pnlPct: 0.83,
      openedAt: Date.now() - 3_600_000,
      closedAt: Date.now() - 60_000,
      reason: "donchian_pivot_composition",
    },
  ];
  await gotoApp(page);
  await expect(page.locator('[data-testid="trades-row"]')).toHaveCount(1, {
    timeout: 10_000,
  });

  // Re-push a state event with the SAME trade id but a DIFFERENT
  // pnl (e.g. the bot re-broadcasts the trade with a corrected
  // PnL). The row count MUST stay at 1 (no duplication).
  botState.closedTrades = [
    {
      id: "t-1", // SAME id
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60_000,
      exitPrice: 61_000, // NEW exit price
      quantity: 0.01,
      leverage: 5,
      pnlUsdt: 10, // NEW pnl
      pnlPct: 1.67, // NEW pnlPct
      openedAt: Date.now() - 3_600_000,
      closedAt: Date.now() - 60_000,
      reason: "donchian_pivot_composition",
    },
  ];
  pushState();
  // Still 1 row, no duplication.
  await expect(page.locator('[data-testid="trades-row"]')).toHaveCount(1, {
    timeout: 5_000,
  });
});
