/**
 * apps/web/e2e/trade-history.spec.ts
 *
 * Phase 82 (item 4 — user mandate 2026-07-27 12:17):
 * e2e test for the dashboard's trade history table.
 *
 * The test uses the same `page.route` + `page.routeWebSocket` pattern
 * as `69-status-panel.spec.ts` to intercept HTTP + WS traffic. The
 * new `/api/trades` endpoint is mocked via `page.route("...api/trades")`,
 * returning the trade list configured per test.
 *
 * Coverage:
 *   1. Empty state — "No closed trades yet" message when no trades.
 *   2. With closed trades — the table renders rows with the
 *      expected columns and P&L coloring.
 *   3. With open + closed trades — the table merges both,
 *      sorted by most-recent first, and labels `status` correctly.
 *   4. With only open positions — the table renders open rows with
 *      `exit price` / `exit time` as `—`.
 *
 * The HTTP endpoint path is asserted via `page.on("request")` —
 * confirms the dashboard actually hits `/api/trades` (and not
 * some other endpoint).
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";

// Phase 57: register coverage collection hooks.
setSpecName("trade-history");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// =============================================================================
// Test state
// =============================================================================

/** Trade history served by the mocked `/api/trades` endpoint. */
const tradeHistory: {
  trades: {
    id: string;
    strategy: string;
    symbol: string;
    side: "buy" | "sell";
    entryPrice: number;
    entryTime: number;
    exitPrice: number | null;
    exitTime: number | null;
    quantity: number;
    leverage: number;
    pnl: number;
    pnlPct: number;
    duration: number;
    status: "open" | "closed";
  }[];
  count: number;
} = {
  trades: [],
  count: 0,
};

/** Whether the dashboard hit the `/api/trades` endpoint. */
let tradesRequestsSeen = 0;

// =============================================================================
// Test helpers
// =============================================================================

interface WsTestHarness {
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  const wsSeenResolvers: (() => void)[] = [];
  let wsCount = 0;

  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    wsCount += 1;
    for (const r of wsSeenResolvers.splice(0)) r();
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
  });

  return {
    waitForWsCount: async (n: number, timeoutMs = 5_000): Promise<void> => {
      if (wsCount >= n) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        wsSeenResolvers.push(() => {
          if (wsCount >= n) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    },
  };
}

async function setupHttpRoutes(page: Page): Promise<void> {
  // Standard endpoints (strategies / status / ohlc / health / control)
  // — return minimal valid responses so the App.tsx render path doesn't
  // bail out on missing data.
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
  // The actual SUT endpoint — record the request count + serve the
  // configured trade history.
  await page.route("http://127.0.0.1:7913/api/trades", (route: Route) => {
    tradesRequestsSeen += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tradeHistory),
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
  // The trade history section must be in the DOM (heading visible).
  await expect(page.locator('[data-testid="trades"] h2')).toBeVisible({
    timeout: 5_000,
  });
}

test.beforeEach(async ({ page }) => {
  // Reset the per-test state.
  tradeHistory.trades = [];
  tradeHistory.count = 0;
  tradesRequestsSeen = 0;
  await setupHttpRoutes(page);
  await setupWsPeer(page);
});

// =============================================================================
// Tests
// =============================================================================

test("renders the empty state when there are no trades", async ({ page }) => {
  // tradeHistory.trades is already [] (beforeEach reset).
  await gotoApp(page);
  // The empty-state message should be visible.
  await expect(page.locator('[data-testid="trades-empty"]')).toBeVisible({
    timeout: 10_000,
  });
  // The full table should NOT be rendered.
  await expect(page.locator('[data-testid="trades-table"]')).toHaveCount(0);
  // The dashboard must have hit /api/trades.
  expect(tradesRequestsSeen).toBeGreaterThanOrEqual(1);
});

test("renders a table with one closed trade row", async ({ page }) => {
  const closedAt = Date.now() - 3_600_000; // 1h ago
  const openedAt = closedAt - 60 * 60_000; // 2h ago
  tradeHistory.trades = [
    {
      id: "t-1",
      strategy: "donchian_pivot_composition",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      entryTime: openedAt,
      exitPrice: 61000,
      exitTime: closedAt,
      quantity: 0.01,
      leverage: 5,
      pnl: 5,
      pnlPct: 0.83,
      duration: 3_600_000,
      status: "closed",
    },
  ];
  tradeHistory.count = 1;
  await gotoApp(page);
  // The table should be visible.
  const table = page.locator('[data-testid="trades-table"]');
  await expect(table).toBeVisible({ timeout: 10_000 });
  // One row.
  await expect(page.locator('[data-testid="trades-row"]')).toHaveCount(1);
  // The row's data-status should be "closed".
  const row = page.locator('[data-testid="trades-row"]').first();
  await expect(row).toHaveAttribute("data-status", "closed");
  // Sanity: the row contains the strategy name and symbol.
  await expect(row).toContainText("donchian_pivot_composition");
  await expect(row).toContainText("BTC/USDC");
  // P&L cell has the positive-pnl class.
  await expect(row.locator(".ep-trades__pnl--pos")).toHaveCount(2); // USD + %
});

test("renders a table with one open position (no exit price / time)", async ({ page }) => {
  const openedAt = Date.now() - 60_000; // 1 min ago
  tradeHistory.trades = [
    {
      id: "p-1",
      strategy: "donchian_pivot_composition",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      entryTime: openedAt,
      exitPrice: null,
      exitTime: null,
      quantity: 0.01,
      leverage: 5,
      pnl: 1,
      pnlPct: 0.17,
      duration: 60_000,
      status: "open",
    },
  ];
  tradeHistory.count = 1;
  await gotoApp(page);
  const row = page.locator('[data-testid="trades-row"]').first();
  await expect(row).toHaveAttribute("data-status", "open");
  // The exit price / exit time cells should be "—".
  const cells = await row.locator("td").allTextContents();
  // Order matches the column header: Strategy, Symbol, Side, Entry,
  // Entry time, Exit, Exit time, P&L (USD), P&L (%), Duration, Status.
  expect(cells[5]).toBe("—"); // Exit price
  expect(cells[6]).toBe("—"); // Exit time
  expect(cells[10]).toBe("open"); // Status
});

test("merges open + closed trades, sorted by most-recent first", async ({ page }) => {
  const now = Date.now();
  tradeHistory.trades = [
    {
      id: "old-closed",
      strategy: "donchian",
      symbol: "ETH/USDC",
      side: "sell",
      entryPrice: 3000,
      entryTime: now - 7_200_000,
      exitPrice: 2900,
      exitTime: now - 7_200_000,
      quantity: 0.5,
      leverage: 3,
      pnl: 50,
      pnlPct: 5,
      duration: 0,
      status: "closed",
    },
    {
      id: "open",
      strategy: "donchian",
      symbol: "SOL/USDC",
      side: "buy",
      entryPrice: 100,
      entryTime: now - 60_000,
      exitPrice: null,
      exitTime: null,
      quantity: 1,
      leverage: 5,
      pnl: 5,
      pnlPct: 5,
      duration: 60_000,
      status: "open",
    },
    {
      id: "new-closed",
      strategy: "donchian",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      entryTime: now - 600_000,
      exitPrice: 61000,
      exitTime: now - 600_000,
      quantity: 0.01,
      leverage: 5,
      pnl: 5,
      pnlPct: 0.83,
      duration: 0,
      status: "closed",
    },
  ];
  tradeHistory.count = 3;
  await gotoApp(page);
  const rows = page.locator('[data-testid="trades-row"]');
  await expect(rows).toHaveCount(3, { timeout: 10_000 });
  // Most-recent first: open (60s ago) > new-closed (10m ago) > old-closed (2h ago)
  await expect(rows.nth(0)).toHaveAttribute("data-status", "open");
  await expect(rows.nth(1)).toHaveAttribute("data-status", "closed");
  await expect(rows.nth(2)).toHaveAttribute("data-status", "closed");
  // Row 0 is the SOL/USDC open position.
  await expect(rows.nth(0)).toContainText("SOL/USDC");
  // Row 1 is the BTC/USDC new-closed trade.
  await expect(rows.nth(1)).toContainText("BTC/USDC");
  // Row 2 is the ETH/USDC old-closed trade.
  await expect(rows.nth(2)).toContainText("ETH/USDC");
});

test("applies the negative-PnL class for a losing trade", async ({ page }) => {
  tradeHistory.trades = [
    {
      id: "loser",
      strategy: "donchian",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      entryTime: Date.now() - 3_600_000,
      exitPrice: 59000,
      exitTime: Date.now() - 1_800_000,
      quantity: 0.01,
      leverage: 5,
      pnl: -5,
      pnlPct: -0.83,
      duration: 1_800_000,
      status: "closed",
    },
  ];
  tradeHistory.count = 1;
  await gotoApp(page);
  const row = page.locator('[data-testid="trades-row"]').first();
  await expect(row.locator(".ep-trades__pnl--neg")).toHaveCount(2);
});
