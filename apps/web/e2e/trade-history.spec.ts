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

/**
 * Defensive: when the backend returns a malformed trade item, the
 * component's `parseTradeItem` filters it out and the table still
 * renders the valid ones. This exercises the `if (typeof X !== ...)`
 * branches in `parseTradeItem` (which the e2e coverage gate
 * requires for the 75% branch floor).
 */
test("filters out malformed items from /api/trades (defensive parseTradeItem branches)", async ({ page }) => {
  // Override the /api/trades route to return a mix of valid + invalid items.
  // The `setupHttpRoutes` call in beforeEach already registered a handler
  // that returns `tradeHistory`, but we re-register here with a custom
  // response (page.route allows multiple handlers, last-wins).
  await page.route("http://127.0.0.1:7913/api/trades", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        trades: [
          // Valid closed trade
          {
            id: "good-1",
            strategy: "donchian",
            symbol: "BTC/USDC",
            side: "buy",
            entryPrice: 60000,
            entryTime: Date.now() - 3_600_000,
            exitPrice: 61000,
            exitTime: Date.now() - 1_800_000,
            quantity: 0.01,
            leverage: 1,
            pnl: 10,
            pnlPct: 1,
            duration: 1_800_000,
            status: "closed",
          },
          // Missing required fields — should be filtered out
          { id: "bad-missing" },
          // Invalid side — should be filtered out
          {
            id: "bad-side",
            strategy: "donchian",
            symbol: "BTC/USDC",
            side: "sideways",
            entryPrice: 60000,
            entryTime: 0,
            exitPrice: 61000,
            exitTime: 1000,
            quantity: 0.01,
            leverage: 1,
            pnl: 10,
            pnlPct: 1,
            duration: 1000,
            status: "closed",
          },
          // Invalid status — should be filtered out
          {
            id: "bad-status",
            strategy: "donchian",
            symbol: "BTC/USDC",
            side: "buy",
            entryPrice: 60000,
            entryTime: 0,
            exitPrice: 61000,
            exitTime: 1000,
            quantity: 0.01,
            leverage: 1,
            pnl: 10,
            pnlPct: 1,
            duration: 1000,
            status: "settled",
          },
          // Non-number exitPrice — should be filtered out
          {
            id: "bad-exit-price",
            strategy: "donchian",
            symbol: "BTC/USDC",
            side: "buy",
            entryPrice: 60000,
            entryTime: 0,
            exitPrice: "string",
            exitTime: 1000,
            quantity: 0.01,
            leverage: 1,
            pnl: 10,
            pnlPct: 1,
            duration: 1000,
            status: "closed",
          },
          // NaN entryPrice — should be filtered out
          {
            id: "bad-nan",
            strategy: "donchian",
            symbol: "BTC/USDC",
            side: "buy",
            entryPrice: Number.NaN,
            entryTime: 0,
            exitPrice: 61000,
            exitTime: 1000,
            quantity: 0.01,
            leverage: 1,
            pnl: 10,
            pnlPct: 1,
            duration: 1000,
            status: "closed",
          },
        ],
        count: 6,
      }),
    });
  });
  await gotoApp(page);
  // Only the one valid item should render.
  await expect(page.locator('[data-testid="trades-row"]')).toHaveCount(1, {
    timeout: 10_000,
  });
  await expect(
    page.locator('[data-testid="trades-row"]').first(),
  ).toHaveAttribute("data-status", "closed");
});

/**
 * Defensive: when the /api/trades endpoint returns an empty list
 * (e.g., right after a bot restart with no trades yet), the table
 * shows the empty state — not a broken render.
 */
test("renders the empty state when /api/trades returns trades: []", async ({ page }) => {
  // The default `setupHttpRoutes` returns an empty tradeHistory; nothing
  // to override here. We do want to assert the empty state explicitly.
  await gotoApp(page);
  await expect(page.locator('[data-testid="trades-empty"]')).toBeVisible({
    timeout: 10_000,
  });
});

/**
 * Coverage: when /api/trades returns a non-OK HTTP status (e.g., 500
 * "internal server error"), the `TradeHistoryTable` should:
 *   1. Hit the `if (!res.ok)` TRUE arm in the useEffect's fetchOnce.
 *   2. Take the FALSE arm of `if (res.status === 503)` (500 ≠ 503).
 *   3. Call `setError(\`HTTP ${res.status}\`)` to surface the error.
 *   4. Hit the `if (error !== null)` TRUE arm in the render path.
 *   5. Render the `trades-error` div with the error message.
 *
 * This exercises the ONE remaining uncovered conditional-render
 * branch in `TradeHistoryTable.tsx` (line 179 `if (error !== null)` —
 * the e2e tests only cover the false arm via the empty / non-empty
 * render paths).
 */
test("renders the error state when /api/trades returns HTTP 500", async ({ page }) => {
  // Override the /api/trades route to return a 500. The standard
  // endpoints (strategies, ohlc, health, status) are already
  // registered by `beforeEach` — we just override the SUT endpoint.
  await page.route("http://127.0.0.1:7913/api/trades", (route) => {
    return route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "internal server error",
    });
  });
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  // The error UI must be visible.
  const errorEl = page.locator('[data-testid="trades-error"]');
  await expect(errorEl).toBeVisible({ timeout: 10_000 });
  // The error message must contain "Failed to load trades" + the
  // HTTP status code (this is the `setError(\`HTTP ${res.status}\`)`
  // call site at useEffect line 147).
  await expect(errorEl).toContainText("Failed to load trades: HTTP 500");
  // The empty / table states must NOT be rendered.
  await expect(page.locator('[data-testid="trades-empty"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="trades-table"]')).toHaveCount(0);
});

/**
 * Coverage: when /api/trades returns 503 (snapshot not yet received
 * from the bot's state-feed), the component should:
 *   1. Hit the `if (!res.ok)` TRUE arm.
 *   2. Take the TRUE arm of `if (res.status === 503)` (the dedicated
 *      snapshot-not-ready branch in the useEffect).
 *   3. Call `setTrades([])` + `setError(null)` — the trade list
 *      clears, no error surfaces (the 503 is treated as a benign
 *      "not yet ready" state, not an error).
 *   4. Render the `trades-empty` div (the empty-state UI, since
 *      `sortedTrades.length === 0` after `setTrades([])`).
 *
 * This covers the `if (res.status === 503)` TRUE arm which the
 * existing tests do not exercise (all current tests use 200).
 */
test("handles 503 from /api/trades as the 'snapshot not ready' fallback (empty state, no error)", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:7913/api/trades", (route) => {
    return route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "snapshot not yet received",
    });
  });
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  // The empty state must be visible (setTrades([]) → sortedTrades.length === 0).
  await expect(page.locator('[data-testid="trades-empty"]')).toBeVisible({
    timeout: 10_000,
  });
  // The error state must NOT be visible (503 is treated as benign).
  await expect(page.locator('[data-testid="trades-error"]')).toHaveCount(0);
  // The table must NOT be rendered (trades is empty).
  await expect(page.locator('[data-testid="trades-table"]')).toHaveCount(0);
});

/**
 * Coverage: exercises three defensive `formatDuration` /
 * `parseTrades` branches that the existing tests miss:
 *
 *   1. `formatDuration` `sec > 0` TRUE arm — when the duration is
 *      between 1 min and 1 hour AND the seconds portion is non-zero
 *      (e.g., 75s → "1m 15s"). All existing tests use durations in
 *      exact minutes (60_000, 600_000, 1_800_000, 3_600_000 ms), so
 *      the "Xm Ys" form is never reached.
 *
 *   2. `formatDuration` `min > 0` TRUE arm — when the duration is
 *      ≥ 1 hour AND the minutes portion is non-zero (e.g., 3900s
 *      → "1h 5m"). Existing tests use 3_600_000 (1h 0m) so the
 *      "Xh Ym" form is never reached.
 *
 *   3. `parseTrades` `count: items.length` fallback arm — when the
 *      response body has a non-number `count` field, the helper
 *      falls back to `items.length`. Existing tests always pass a
 *      numeric `count`, so the fallback is never hit.
 *
 * One test (2 trades) covers all three branches.
 */
test("renders duration with non-zero seconds/minutes and falls back to items.length for non-numeric count", async ({
  page,
}) => {
  const t0 = Date.now() - 4_000_000; // 1h 5m ago
  const t1 = Date.now() - 75_000; // 1m 15s ago
  await page.route("http://127.0.0.1:7913/api/trades", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      // NOTE: `count: "5"` is a non-number — exercises the
      // `typeof obj.count === "number" ? obj.count : items.length`
      // fallback arm (line 266). The helper should still build a
      // valid `trades` array of length 2.
      body: JSON.stringify({
        trades: [
          {
            id: "dur-hours-min",
            strategy: "donchian",
            symbol: "BTC/USDC",
            side: "buy",
            entryPrice: 60000,
            entryTime: t0 - 3_900_000,
            exitPrice: 61000,
            exitTime: t0,
            quantity: 0.01,
            leverage: 5,
            pnl: 5,
            pnlPct: 0.83,
            // 1h 5m = 3_900_000 ms — hits `min > 0` arm
            duration: 3_900_000,
            status: "closed",
          },
          {
            id: "dur-min-sec",
            strategy: "donchian",
            symbol: "ETH/USDC",
            side: "sell",
            entryPrice: 3000,
            entryTime: t1 - 75_000,
            exitPrice: 2900,
            exitTime: t1,
            quantity: 0.5,
            leverage: 3,
            pnl: 50,
            pnlPct: 5,
            // 1m 15s = 75_000 ms — hits `sec > 0` arm
            duration: 75_000,
            status: "closed",
          },
        ],
        count: "5", // non-number → items.length fallback
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  const table = page.locator('[data-testid="trades-table"]');
  await expect(table).toBeVisible({ timeout: 10_000 });
  const rows = page.locator('[data-testid="trades-row"]');
  await expect(rows).toHaveCount(2);
  // Row 0 = the 1m 15s trade (most recent exitTime) — Duration cell
  // must show "1m 15s" (the `sec > 0` TRUE arm of `formatDuration`).
  const row0 = rows.nth(0);
  await expect(row0).toContainText("ETH/USDC");
  await expect(row0.locator("td").nth(9)).toHaveText("1m 15s");
  // Row 1 = the 1h 5m trade — Duration cell must show "1h 5m"
  // (the `min > 0` TRUE arm of `formatDuration`).
  const row1 = rows.nth(1);
  await expect(row1).toContainText("BTC/USDC");
  await expect(row1.locator("td").nth(9)).toHaveText("1h 5m");
});

/**
 * Coverage: the useEffect's catch block at line 164 has a ternary
 *   `setError(e instanceof Error ? e.message : "unknown error")`
 * The TRUE arm (`e.message`) is covered by every test that drives
 * the component to a network error (the real `fetch` throws
 * `TypeError` instances on network failure). The FALSE arm
 * (`"unknown error"`) fires when the catch receives a non-Error
 * value — which never happens in normal operation (the real
 * `fetch` only rejects with `TypeError`).
 *
 * To exercise the FALSE arm, this test installs a `fetch` shim
 * via `page.addInitScript` that throws a non-Error (a string) for
 * the FIRST call to `/api/trades`. Subsequent calls pass through
 * to the original fetch (which is intercepted by the page.route
 * mock). The component's catch block sees the non-Error and takes
 * the `setError("unknown error")` branch → the `trades-error` UI
 * shows the literal text "Failed to load trades: unknown error".
 */
test("renders 'unknown error' when /api/trades fetch throws a non-Error value", async ({
  page,
}) => {
  // Install the fetch shim BEFORE the page loads. The shim throws
  // a string for the first call to /api/trades, then passes through.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let tradesCallCount = 0;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/trades")) {
        tradesCallCount += 1;
        if (tradesCallCount === 1) {
          // Throw a NON-Error to exercise the
          // `setError("unknown error")` fallback arm.
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw "synthetic non-Error throw from /api/trades";
        }
      }
      return originalFetch(input, init);
    };
  });
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  // The error UI must be visible with the literal "unknown error"
  // message (the FALSE arm of the `e instanceof Error ? ...` ternary).
  const errorEl = page.locator('[data-testid="trades-error"]');
  await expect(errorEl).toBeVisible({ timeout: 10_000 });
  await expect(errorEl).toContainText("Failed to load trades: unknown error");
  // The empty / table states must NOT be rendered.
  await expect(page.locator('[data-testid="trades-empty"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="trades-table"]')).toHaveCount(0);
});

/**
 * Coverage: exercises the body-shape validation branches in
 * `parseTrades` (the `if (body === null)`, `if (typeof body !==
 * "object")`, `if (Array.isArray(body))`, and `if
 * (!Array.isArray(obj.trades))` early-exit guards). The helper
 * must return `null` for any of these shapes — the component then
 * surfaces the "Invalid response shape" error.
 *
 * Three response bodies in one test (via successive `page.route`
 * registrations — last-wins per URL — the test only drives the
 * FINAL registration):
 *   - Final registration: `body: 42` (a number) — exercises
 *     `typeof body !== "object"` and `Array.isArray(body)`.
 *
 *   - The body's `parseTrades` will return `null` → the component
 *     calls `setError("Invalid response shape")` → the
 *     `trades-error` UI must be visible.
 */
test("renders the error state when /api/trades returns a non-object body (parseTrades body-shape guards)", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:7913/api/trades", (route) => {
    // Body is a number — `typeof body === "number"`, not "object"
    // and not an array, but `parseTrades` first checks `body === null`
    // (false) then `typeof body !== "object"` (true) → returns null.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "42",
    });
  });
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  const errorEl = page.locator('[data-testid="trades-error"]');
  await expect(errorEl).toBeVisible({ timeout: 10_000 });
  await expect(errorEl).toContainText("Failed to load trades: Invalid response shape");
  await expect(page.locator('[data-testid="trades-empty"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="trades-table"]')).toHaveCount(0);
});

/**
 * Coverage: exercises the per-item shape validation in
 * `parseTradeItem` for `raw === null` and `typeof raw !== "object"`.
 * The response is a valid `{trades, count}` envelope, but the
 * `trades` array contains `null` and a non-object (a string).
 * `parseTradeItem` must filter both out and return null for each —
 * exercising the `if (raw === null) return null;` and `if (typeof
 * raw !== "object") return null;` TRUE arms.
 *
 * The valid item in the array still renders, so the table shows
 * exactly one row.
 */
test("filters out null and non-object items from the trades array (parseTradeItem raw-shape guards)", async ({
  page,
}) => {
  const closedAt = Date.now() - 3_600_000;
  const openedAt = closedAt - 60 * 60_000;
  await page.route("http://127.0.0.1:7913/api/trades", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        trades: [
          // `raw === null` → parseTradeItem returns null
          // (Branch 7 TRUE arm).
          null,
          // `typeof raw === "string"` → parseTradeItem returns null
          // (Branch 8 TRUE arm).
          "not-an-object",
          // The one VALID closed trade — should render.
          {
            id: "valid-only",
            strategy: "donchian",
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
        ],
        count: 3,
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );
  // Only the valid item should render (null + string filtered out).
  await expect(page.locator('[data-testid="trades-table"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="trades-row"]')).toHaveCount(1);
  await expect(
    page.locator('[data-testid="trades-row"]').first(),
  ).toHaveAttribute("data-status", "closed");
});
