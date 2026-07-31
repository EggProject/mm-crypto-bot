/**
 * apps/web/src/lib/__tests__/trades-from-state.test.ts
 *
 * Phase 83.5 (Bug 2 — TradeHistoryTable polling): unit tests for
 * the `tradesFromState` helper that converts the WS `state` event's
 * `positions` (open) + `history` / `closedTrades` (closed) arrays
 * into the `TradeHistoryItem[]` the dashboard's table renders.
 *
 * The helper is PURE (no React, no DOM, no I/O) and is exercised
 * here across all branches:
 *  - `lastState === null` → `[]`
 *  - `lastState` not an object → `[]`
 *  - `lastState` object with no `snapshot` / `positions` / `closedTrades` / `history` → `[]`
 *  - `positions` not an array → `[]`
 *  - `history` not an array → `[]`
 *  - malformed open position object → dropped
 *  - malformed closed trade object → dropped
 *  - valid open position → TradeHistoryItem with `status: "open"`, null exit fields
 *  - valid closed trade → TradeHistoryItem with `status: "closed"`, full pnl
 *  - mixed (open + closed) → both, sorted by (exitTime ?? entryTime) desc
 *  - strategy extraction (open from `id` prefix, closed from `reason`)
 *  - top-level `state.positions` + `state.closedTrades` layout
 *  - `state.snapshot.positions` + `state.snapshot.history` layout
 */

import { describe, expect, it } from "bun:test";

import { tradesFromState } from "../trades-from-state.js";

// =============================================================================
// Fixtures
// =============================================================================

const T0 = 1_000_000_000_000 as const;

const VALID_OPEN_POSITION = {
  id: "donchian_pivot_composition:BTC/USDC:buy",
  symbol: "BTC/USDC",
  side: "buy" as const,
  entryPrice: 60_000,
  quantity: 0.01,
  leverage: 5,
  unrealizedPnl: 12.5,
  unrealizedPnlPct: 2.1,
  openedAt: T0,
};

const VALID_CLOSED_TRADE = {
  id: "t-1",
  symbol: "ETH/USDC",
  side: "sell" as const,
  entryPrice: 3_000,
  exitPrice: 2_950,
  quantity: 0.1,
  leverage: 3,
  pnlUsdt: -5,
  pnlPct: -1.67,
  openedAt: T0,
  closedAt: T0 + 60_000,
  reason: "donchian_pivot_composition",
};

// =============================================================================
// tradesFromState
// =============================================================================

describe("tradesFromState", () => {
  it("returns an empty array when lastState is null", () => {
    expect(tradesFromState(null)).toEqual([]);
  });

  it("returns an empty array when lastState is a primitive", () => {
    expect(tradesFromState("hello")).toEqual([]);
    expect(tradesFromState(42)).toEqual([]);
    expect(tradesFromState(true)).toEqual([]);
  });

  it("returns an empty array when lastState has no positions/history fields", () => {
    expect(tradesFromState({})).toEqual([]);
    expect(tradesFromState({ foo: "bar" })).toEqual([]);
  });

  it("returns an empty array when positions is not an array", () => {
    const state = {
      snapshot: { positions: "not-an-array", history: [] },
    };
    expect(tradesFromState(state)).toEqual([]);
  });

  it("returns an empty array when history is not an array", () => {
    const state = {
      snapshot: { positions: [], history: "not-an-array" },
    };
    expect(tradesFromState(state)).toEqual([]);
  });

  it("converts a valid open position to a TradeHistoryItem with status 'open'", () => {
    // The position's `openedAt` must be a RECENT timestamp — the
    // helper computes `duration = now - openedAt`, so a hardcoded
    // year-2001 timestamp would produce a 24-year duration.
    const openPosition = { ...VALID_OPEN_POSITION, openedAt: Date.now() - 60_000 };
    const result = tradesFromState({
      snapshot: { positions: [openPosition], history: [] },
    });
    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item).toBeDefined();
    expect(item?.status).toBe("open");
    expect(item?.symbol).toBe("BTC/USDC");
    expect(item?.side).toBe("buy");
    expect(item?.entryPrice).toBe(60_000);
    expect(item?.entryTime).toBe(openPosition.openedAt);
    expect(item?.exitPrice).toBeNull();
    expect(item?.exitTime).toBeNull();
    expect(item?.quantity).toBe(0.01);
    expect(item?.leverage).toBe(5);
    expect(item?.pnl).toBe(12.5);
    expect(item?.pnlPct).toBe(2.1);
    // The duration is `now - openedAt` — must be roughly 60_000ms
    // (the position was opened 60 seconds ago).
    expect(item?.duration).toBeGreaterThanOrEqual(60_000);
    expect(item?.duration).toBeLessThan(61_000);
    // Strategy extracted from `id` prefix.
    expect(item?.strategy).toBe("donchian_pivot_composition");
  });

  it("converts a valid closed trade to a TradeHistoryItem with status 'closed'", () => {
    const result = tradesFromState({
      snapshot: { positions: [], history: [VALID_CLOSED_TRADE] },
    });
    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item).toBeDefined();
    expect(item?.status).toBe("closed");
    expect(item?.symbol).toBe("ETH/USDC");
    expect(item?.side).toBe("sell");
    expect(item?.entryPrice).toBe(3_000);
    expect(item?.exitPrice).toBe(2_950);
    expect(item?.entryTime).toBe(T0);
    expect(item?.exitTime).toBe(T0 + 60_000);
    expect(item?.quantity).toBe(0.1);
    expect(item?.leverage).toBe(3);
    expect(item?.pnl).toBe(-5);
    expect(item?.pnlPct).toBe(-1.67);
    expect(item?.duration).toBe(60_000);
    // Strategy extracted from `reason`.
    expect(item?.strategy).toBe("donchian_pivot_composition");
  });

  it("sorts mixed trades by (exitTime ?? entryTime) desc", () => {
    const olderClosed = {
      ...VALID_CLOSED_TRADE,
      id: "t-old",
      closedAt: T0 - 120_000,
      openedAt: T0 - 180_000,
    };
    const newerClosed = {
      ...VALID_CLOSED_TRADE,
      id: "t-new",
      closedAt: T0 - 30_000,
      openedAt: T0 - 90_000,
    };
    const openPosition = {
      ...VALID_OPEN_POSITION,
      id: "open:now",
      openedAt: T0 - 5_000, // Most recent — should be first.
    };
    const result = tradesFromState({
      snapshot: {
        positions: [openPosition],
        history: [olderClosed, newerClosed],
      },
    });
    expect(result).toHaveLength(3);
    // The open position's effective timestamp is `openedAt` (no
    // exitTime). The newest is `openPosition` (T0-5s), then
    // `newerClosed` (T0-30s), then `olderClosed` (T0-120s).
    expect(result[0]?.id).toBe("open:now");
    expect(result[1]?.id).toBe("t-new");
    expect(result[2]?.id).toBe("t-old");
  });

  it("uses the top-level state.positions / state.closedTrades layout (the markers path)", () => {
    // The WS `state` message also carries `positions` + `closedTrades`
    // as TOP-LEVEL fields (the same data the markers helper reads).
    // The trades helper should accept BOTH layouts.
    const result = tradesFromState({
      positions: [VALID_OPEN_POSITION],
      closedTrades: [VALID_CLOSED_TRADE],
    });
    expect(result).toHaveLength(2);
    expect(result.some((t) => t.status === "open")).toBe(true);
    expect(result.some((t) => t.status === "closed")).toBe(true);
  });

  it("prefers state.closedTrades over state.snapshot.history (and the former wins even when empty)", () => {
    // If the top-level `closedTrades` is set (even to `[]`), it
    // OVERRIDES the snapshot's `history` — this matches the
    // markers helper's behavior (read from the top-level field
    // that the bot publishes).
    const result = tradesFromState({
      closedTrades: [VALID_CLOSED_TRADE],
      snapshot: { history: [] },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("t-1");
  });

  it("falls back to 'unknown' for an open position whose id has no ':' separator", () => {
    const result = tradesFromState({
      snapshot: {
        positions: [{ ...VALID_OPEN_POSITION, id: "no-colon-id" }],
        history: [],
      },
    });
    expect(result[0]?.strategy).toBe("unknown");
  });

  it("falls back to 'unknown' for a closed trade with empty/missing reason", () => {
    const result = tradesFromState({
      snapshot: {
        positions: [],
        history: [{ ...VALID_CLOSED_TRADE, reason: "" }],
      },
    });
    expect(result[0]?.strategy).toBe("unknown");
  });

  it("drops malformed open positions (missing required fields) without throwing", () => {
    const result = tradesFromState({
      snapshot: {
        positions: [
          { id: "p1" }, // missing fields
          { symbol: "BTC/USDC" }, // missing id
          { id: "p2", symbol: "BTC/USDC" }, // missing side
          { id: "p3", symbol: "BTC/USDC", side: "long" }, // invalid side
          { id: "p4", symbol: "BTC/USDC", side: "buy" }, // missing entryPrice
          { id: "p5", symbol: "BTC/USDC", side: "buy", entryPrice: NaN }, // NaN
          null,
          "string",
          VALID_OPEN_POSITION, // the ONE valid one
        ],
        history: [],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("donchian_pivot_composition:BTC/USDC:buy");
  });

  it("drops malformed closed trades (missing required fields) without throwing", () => {
    const result = tradesFromState({
      snapshot: {
        positions: [],
        history: [
          { id: "t1" }, // missing fields
          { symbol: "BTC/USDC" }, // missing id
          { id: "t2", symbol: "BTC/USDC" }, // missing side
          { id: "t3", symbol: "BTC/USDC", side: "buy" }, // missing entryPrice
          { id: "t4", symbol: "BTC/USDC", side: "buy", entryPrice: 100 }, // missing exitPrice
          VALID_CLOSED_TRADE, // the ONE valid one
        ],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("t-1");
  });

  it("returns an empty array for an all-malformed input set", () => {
    const result = tradesFromState({
      snapshot: {
        positions: [null, "string", 42, { id: "bad" }],
        history: [undefined, { id: "bad" }],
      },
    });
    expect(result).toEqual([]);
  });

  it("computes a positive duration for an open position (now - openedAt, clamped to >= 0)", () => {
    const result = tradesFromState({
      snapshot: {
        positions: [{ ...VALID_OPEN_POSITION, openedAt: Date.now() - 30_000 }],
        history: [],
      },
    });
    expect(result[0]?.duration).toBeGreaterThanOrEqual(30_000);
    expect(result[0]?.duration).toBeLessThan(31_000);
  });

  it("clamps a negative duration for a closed trade to 0 (defensive)", () => {
    // A closed trade whose `closedAt < openedAt` is logically
    // nonsensical, but the helper MUST NOT produce a negative
    // duration (the dashboard's `formatDuration` would show a
    // confusing "—" or "0s").
    const result = tradesFromState({
      snapshot: {
        positions: [],
        history: [
          {
            ...VALID_CLOSED_TRADE,
            openedAt: T0,
            closedAt: T0 - 1_000, // negative duration
          },
        ],
      },
    });
    expect(result[0]?.duration).toBe(0);
  });
});
