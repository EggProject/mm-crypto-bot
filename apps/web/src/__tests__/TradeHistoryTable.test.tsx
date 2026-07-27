/**
 * apps/web/src/__tests__/TradeHistoryTable.test.tsx
 *
 * Phase 82 (item 4 — user mandate 2026-07-27 12:17): unit tests for
 * the trade history table.
 *
 * Mirrors the `ControlBar.test.tsx` structural-test approach:
 *   - `mock.module` stubs `useWebSocket` (the TradeHistoryTable
 *     doesn't use it, but the mock keeps the test self-contained).
 *   - We use `React.createElement(TradeHistoryTable)` for the
 *     structural smoke test (the element is built, not rendered).
 *   - We DO call `TradeHistoryTable()` directly... NOPE — the
 *     component uses `useState`, which requires a real React
 *     renderer. bun:test doesn't ship one (the codebase defers
 *     full-render tests to the e2e + CT suites). So we only
 *     assert the function is exported + the React element is
 *     buildable.
 *
 * The `parseTrades` helper (extracted as a pure function) gets a
 * 100% branch-sweep — it's the meat of the shape validation logic.
 *
 * The "table renders rows" branch is covered by the e2e test
 * (`e2e/trade-history.spec.ts`).
 */

import { describe, expect, it, mock } from "bun:test";

mock.module("../ws-client.js", () => ({
  useWebSocket: (): {
    status: "connected";
    snapshot: null;
    lastState: null;
    lastError: null;
    send: () => void;
  } => ({
    status: "connected",
    snapshot: null,
    lastState: null,
    lastError: null,
    send: (): void => {
      // no-op: smoke test only verifies structural shape
    },
  }),
}));

import React from "react";
import {
  parseTrades,
  TradeHistoryTable,
} from "../components/TradeHistoryTable.js";

interface JsxElement {
  readonly type: string | React.ElementType;
  readonly props: Record<string, unknown>;
}

function isJsxElement(value: unknown): value is JsxElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value
  );
}

describe("TradeHistoryTable", () => {
  it("is exported as a function", () => {
    expect(typeof TradeHistoryTable).toBe("function");
  });

  it("can be wrapped in a React element with no props", () => {
    // `React.createElement` doesn't invoke the component body — it
    // just builds the element tree. So this is a structural test,
    // not a render test. The full render (incl. `useState` and
    // the empty-state branch) is exercised in the e2e suite
    // (`e2e/trade-history.spec.ts`).
    const el = React.createElement(TradeHistoryTable);
    expect(isJsxElement(el)).toBe(true);
    if (!isJsxElement(el)) return;
    expect(typeof el.type).toBe("function");
  });
});

describe("parseTrades", () => {
  it("returns null for null input", () => {
    expect(parseTrades(null)).toBeNull();
  });

  it("returns null for a primitive input", () => {
    expect(parseTrades(42)).toBeNull();
    expect(parseTrades("hello")).toBeNull();
    expect(parseTrades(true)).toBeNull();
  });

  it("returns null for an array input", () => {
    expect(parseTrades([])).toBeNull();
    expect(parseTrades([1, 2, 3])).toBeNull();
  });

  it("returns null when the 'trades' key is missing", () => {
    expect(parseTrades({})).toBeNull();
    expect(parseTrades({ count: 0 })).toBeNull();
  });

  it("returns null when 'trades' is not an array", () => {
    expect(parseTrades({ trades: "nope" })).toBeNull();
    expect(parseTrades({ trades: null })).toBeNull();
    expect(parseTrades({ trades: 42 })).toBeNull();
  });

  it("returns { trades: [], count: 0 } for an empty trades list", () => {
    const result = parseTrades({ trades: [], count: 0 });
    expect(result).not.toBeNull();
    expect(result!.trades).toEqual([]);
    expect(result!.count).toBe(0);
  });

  it("parses a valid closed-trade item", () => {
    const body = {
      trades: [
        {
          id: "t-1",
          strategy: "donchian_pivot_composition",
          symbol: "BTC/USDC",
          side: "buy",
          entryPrice: 60000,
          entryTime: 1_700_000_000_000,
          exitPrice: 61000,
          exitTime: 1_700_003_600_000,
          quantity: 0.01,
          leverage: 5,
          pnl: 5,
          pnlPct: 0.83,
          duration: 3_600_000,
          status: "closed",
        },
      ],
      count: 1,
    };
    const result = parseTrades(body);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.trades.length).toBe(1);
    const t = result!.trades[0]!;
    expect(t.id).toBe("t-1");
    expect(t.strategy).toBe("donchian_pivot_composition");
    expect(t.symbol).toBe("BTC/USDC");
    expect(t.side).toBe("buy");
    expect(t.entryPrice).toBe(60000);
    expect(t.exitPrice).toBe(61000);
    expect(t.exitTime).toBe(1_700_003_600_000);
    expect(t.pnl).toBe(5);
    expect(t.pnlPct).toBe(0.83);
    expect(t.duration).toBe(3_600_000);
    expect(t.status).toBe("closed");
  });

  it("parses a valid open-trade item (exitPrice: null, exitTime: null)", () => {
    const body = {
      trades: [
        {
          id: "p-1",
          strategy: "donchian_pivot_composition",
          symbol: "BTC/USDC",
          side: "buy",
          entryPrice: 60000,
          entryTime: 1_700_000_000_000,
          exitPrice: null,
          exitTime: null,
          quantity: 0.01,
          leverage: 5,
          pnl: 1,
          pnlPct: 0.17,
          duration: 60_000,
          status: "open",
        },
      ],
      count: 1,
    };
    const result = parseTrades(body);
    expect(result).not.toBeNull();
    const t = result!.trades[0]!;
    expect(t.exitPrice).toBeNull();
    expect(t.exitTime).toBeNull();
    expect(t.status).toBe("open");
  });

  it("skips malformed items (defensive: missing required fields)", () => {
    const body = {
      trades: [
        // Missing required fields — should be filtered out
        { id: "bad-1" },
        // Valid item
        {
          id: "good-1",
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
          status: "closed",
        },
        // Invalid side
        {
          id: "bad-2",
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
        // Invalid status
        {
          id: "bad-3",
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
        // exitPrice must be null or number
        {
          id: "bad-4",
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
        // Non-finite number
        {
          id: "bad-5",
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
    };
    const result = parseTrades(body);
    expect(result).not.toBeNull();
    // Only the valid item survives the defensive filter
    expect(result!.trades.length).toBe(1);
    expect(result!.trades[0]!.id).toBe("good-1");
  });

  it("derives count from items.length when count is missing or non-number", () => {
    const body = {
      trades: [
        {
          id: "t-1",
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
          status: "closed",
        },
        {
          id: "t-2",
          strategy: "donchian",
          symbol: "BTC/USDC",
          side: "sell",
          entryPrice: 60000,
          entryTime: 0,
          exitPrice: 59000,
          exitTime: 1000,
          quantity: 0.01,
          leverage: 1,
          pnl: 10,
          pnlPct: 1,
          duration: 1000,
          status: "closed",
        },
      ],
      // count is missing
    };
    const result = parseTrades(body);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
  });

  it("rejects items where the 'id' is empty", () => {
    const body = {
      trades: [
        {
          id: "",
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
          status: "closed",
        },
      ],
      count: 1,
    };
    const result = parseTrades(body);
    expect(result).not.toBeNull();
    expect(result!.trades.length).toBe(0);
  });

  it("rejects items where the 'symbol' is empty", () => {
    const body = {
      trades: [
        {
          id: "t-1",
          strategy: "donchian",
          symbol: "",
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
          status: "closed",
        },
      ],
      count: 1,
    };
    const result = parseTrades(body);
    expect(result).not.toBeNull();
    expect(result!.trades.length).toBe(0);
  });
});
