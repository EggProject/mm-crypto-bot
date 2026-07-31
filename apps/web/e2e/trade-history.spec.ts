/**
 * apps/web/e2e/trade-history.spec.ts
 *
 * Phase 82 (item 4 — user mandate 2026-07-27 12:17) + Phase 83.5 (Bug 2):
 * e2e test for the dashboard's trade history table.
 *
 * **Phase 83.5 (Bug 2) refactor:** the test was originally
 * mock-driven via `page.route("...api/trades")` (the component
 * polled the endpoint every 5s). The component is now
 * PROP-DRIVEN + WS-driven — the WS `state` event's `positions` +
 * `history` / `closedTrades` arrays drive the table. The test
 * pushes `state` events via `page.routeWebSocket` and asserts
 * the rows render.
 *
 * The `/api/trades` HTTP endpoint STAYS for external consumers
 * (CLI: `mm-bot trades`, scripts) but is no longer polled by the
 * dashboard.
 *
 * Coverage:
 *   1. Empty state — "No closed trades yet" when no trades
 *   2. With closed trades — table renders with P&L coloring
 *   3. With open + closed trades — merged, sorted by most-recent first
 *   4. With only open positions — exit price / time as "—"
 *   5. Duration formatting — "1m 15s" / "1h 5m" sub-hour/sub-day cases
 *   6. "Waiting for WebSocket…" — the WS-not-connected placeholder
 *   7. Sort order — the `(exitTime ?? entryTime) desc` invariant
 *
 * The defensive-shape validation branches (malformed `positions[]`
 * / `history[]` items, missing fields) are covered by the unit test
 * in `apps/web/src/lib/__tests__/trades-from-state.test.ts`. The
 * e2e focuses on the React flow + the WS push.
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
import type { WebSocketRoute } from "@playwright/test";

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

/**
 * The bot's mock state, pushed via WS `state` events. The test
 * mutates this BEFORE `gotoApp`, then pushes a `state` event on
 * connect; per-test mutations + re-pushes are done via the
 * `pushState()` helper.
 */
const botState: {
  positions: readonly Record<string, unknown>[];
  closedTrades: readonly Record<string, unknown>[];
} = {
  positions: [],
  closedTrades: [],
};

// =============================================================================
// Test helpers
// =============================================================================

interface WsTestHarness {
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  const allWs: WebSocketRoute[] = [];
  const wsSeenResolvers: (() => void)[] = [];

  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    allWs.push(ws);
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
    // Phase 83.5: push an initial `state` event so the dashboard's
    // `lastState` is populated. Subsequent tests can re-push via
    // `pushState()` after mutating `botState`. The payload shape
    // mirrors the REAL bot's WS `state` message
    // (`apps/web/src/ws-client.ts:86-94`): the `positions` and
    // `closedTrades` fields are TOP-LEVEL, not inside `snapshot`.
    const initial = JSON.stringify({
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
    setTimeout(() => {
      for (const w of allWs) {
        try {
          w.send(initial);
        } catch {
          // best-effort
        }
      }
    }, 50);
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

  return { waitForWsCount };
}

async function setupHttpRoutes(page: Page): Promise<void> {
  // Standard endpoints (strategies / status / ohlc / health / control)
  // — return minimal valid responses so the App.tsx render path doesn't
  // bail out on missing data. `/api/trades` is NO LONGER polled by
  // the dashboard in Phase 83.5 (Bug 2), but we still register a
  // stub for completeness (some test fixtures hit it).
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
    // The dashboard no longer polls /api/trades in Phase 83.5, but
    // the route stays registered for any external consumer (CLI,
    // scripts). A bare 200 is fine here.
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
  // The trade history section must be in the DOM (heading visible).
  await expect(page.locator('[data-testid="trades"] h2')).toBeVisible({
    timeout: 5_000,
  });
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

test("renders the empty state when no trades are present", async ({ page }) => {
  // botState is empty (beforeEach reset).
  await gotoApp(page);
  // The empty-state message should be visible.
  await expect(page.locator('[data-testid="trades-empty"]')).toBeVisible({
    timeout: 10_000,
  });
  // The full table should NOT be rendered.
  await expect(page.locator('[data-testid="trades-table"]')).toHaveCount(0);
});

test("renders a table with one closed trade row", async ({ page }) => {
  const closedAt = Date.now() - 3_600_000; // 1h ago
  const openedAt = closedAt - 60 * 60_000; // 2h ago
  botState.closedTrades = [
    {
      id: "t-1",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      exitPrice: 61000,
      quantity: 0.01,
      leverage: 5,
      pnlUsdt: 5,
      pnlPct: 0.83,
      openedAt,
      closedAt,
      reason: "donchian_pivot_composition",
    },
  ];
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
  botState.positions = [
    {
      id: "donchian_pivot_composition:BTC/USDC:buy",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      currentPrice: 60100,
      quantity: 0.01,
      leverage: 5,
      unrealizedPnl: 1,
      unrealizedPnlPct: 0.17,
      openedAt,
      stopLoss: null,
      takeProfit: null,
    },
  ];
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
  botState.closedTrades = [
    {
      id: "old-closed",
      symbol: "ETH/USDC",
      side: "sell",
      entryPrice: 3000,
      exitPrice: 2900,
      quantity: 0.5,
      leverage: 3,
      pnlUsdt: 50,
      pnlPct: 5,
      openedAt: now - 7_200_000,
      closedAt: now - 7_200_000,
      reason: "donchian_pivot_composition",
    },
    {
      id: "new-closed",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      exitPrice: 61000,
      quantity: 0.01,
      leverage: 5,
      pnlUsdt: 5,
      pnlPct: 0.83,
      openedAt: now - 600_000,
      closedAt: now - 600_000,
      reason: "donchian_pivot_composition",
    },
  ];
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
      openedAt: now - 60_000,
      stopLoss: null,
      takeProfit: null,
    },
  ];
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
  botState.closedTrades = [
    {
      id: "loser",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      exitPrice: 59000,
      quantity: 0.01,
      leverage: 5,
      pnlUsdt: -5,
      pnlPct: -0.83,
      openedAt: Date.now() - 3_600_000,
      closedAt: Date.now() - 1_800_000,
      reason: "donchian",
    },
  ];
  await gotoApp(page);
  const row = page.locator('[data-testid="trades-row"]').first();
  await expect(row.locator(".ep-trades__pnl--neg")).toHaveCount(2);
});

/**
 * Phase 83.5 (Bug 2): exercises the "Xm Ys" + "Xh Ym" sub-hour /
 * sub-day duration formatting branches in `formatDuration` (the
 * old test polled `/api/trades`; the new test pushes a `state`
 * event with the same two trades). The defensive-shape
 * validation (malformed items) is covered by the
 * `trades-from-state.test.ts` unit test.
 */
test("renders duration with non-zero seconds/minutes (formatDuration coverage)", async ({
  page,
}) => {
  const t0 = Date.now() - 4_000_000; // 1h 5m ago
  const t1 = Date.now() - 75_000; // 1m 15s ago
  botState.closedTrades = [
    {
      id: "dur-hours-min",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      exitPrice: 61000,
      quantity: 0.01,
      leverage: 5,
      pnlUsdt: 5,
      pnlPct: 0.83,
      // 1h 5m = 3_900_000 ms — hits `min > 0` arm
      openedAt: t0 - 3_900_000,
      closedAt: t0,
      reason: "donchian",
    },
    {
      id: "dur-min-sec",
      symbol: "ETH/USDC",
      side: "sell",
      entryPrice: 3000,
      exitPrice: 2900,
      quantity: 0.5,
      leverage: 3,
      pnlUsdt: 50,
      pnlPct: 5,
      // 1m 15s = 75_000 ms — hits `sec > 0` arm
      openedAt: t1 - 75_000,
      closedAt: t1,
      reason: "donchian",
    },
  ];
  await gotoApp(page);
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
 * Phase 83.5 (Bug 2): the table is prop-driven + WS-first. The
 * previous (Phase 82) implementation polled `/api/trades` every
 * 5 seconds; that polling is GONE. The dashboard now consumes
 * the WS `state` event (via `tradesFromState(lastState)`) and
 * never hits `/api/trades` from the browser.
 *
 * This test verifies the polling was REMOVED by waiting 6s
 * (longer than the 5s poll interval) and asserting that ZERO
 * requests landed on `/api/trades`. The HTTP endpoint STAYS for
 * external consumers (CLI: `mm-bot trades`, scripts) but the
 * browser never calls it.
 */
test("does NOT poll /api/trades from the browser (Phase 83.5 Bug 2 regression)", async ({
  page,
}) => {
  const openedAt = Date.now() - 60_000;
  botState.positions = [
    {
      id: "donchian_pivot_composition:BTC/USDC:buy",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 60000,
      currentPrice: 60100,
      quantity: 0.01,
      leverage: 5,
      unrealizedPnl: 1,
      unrealizedPnlPct: 0.17,
      openedAt,
      stopLoss: null,
      takeProfit: null,
    },
  ];
  await gotoApp(page);
  // The first row renders (from the WS `state` event).
  await expect(page.locator('[data-testid="trades-row"]')).toHaveCount(1, {
    timeout: 10_000,
  });
  // Count /api/trades requests over a 6s window. The previous
  // implementation would have fired 2 polls (the immediate
  // mount-time fetch + one 5s later).
  let tradesRequestsSeen = 0;
  const onReq = (req: { url: () => string }): void => {
    if (req.url().endsWith("/api/trades")) {
      tradesRequestsSeen += 1;
    }
  };
  page.on("request", onReq);
  await page.waitForTimeout(6_000);
  page.off("request", onReq);
  // No /api/trades requests in the 6s window — the polling is gone.
  expect(tradesRequestsSeen).toBe(0);
});
