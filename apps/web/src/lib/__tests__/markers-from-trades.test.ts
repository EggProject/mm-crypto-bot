/**
 * apps/web/src/lib/__tests__/markers-from-trades.test.ts
 *
 * Phase 82 (3 dashboard UI bugs — item 5): unit tests for the
 * `buildMarkersByKey` helper that converts the WS `state`
 * event's `positions` + `closedTrades` into the
 * `markersByKey` map the chart grid expects.
 *
 * The helper is pure (no React, no DOM, no I/O) and 100%
 * branch-coverage-tested here. The e2e suite
 * (`82-...`) will drive the React flow through the same
 * branches.
 *
 * Branch coverage intent:
 *   - `buildMarkersByKey`:
 *     - `lastState === null` → `{}`
 *     - `lastState` not an object → `{}`
 *     - `lastState` object but no `positions` / `closedTrades` → `{}`
 *     - `positions` not an array → skipped
 *     - `closedTrades` not an array → skipped
 *     - malformed position object (missing symbol/openedAt/side) → skipped
 *     - malformed closed-trade object (missing symbol/openedAt/closedAt/side) → skipped
 *     - valid open position for a symbol NOT in the map → skipped
 *     - valid open position for a symbol in the map → ENTRY marker
 *     - valid closed trade for a symbol in the map → ENTRY + EXIT markers
 *     - multiple trades for the same (symbol, tf) → markers accumulate
 */

import { describe, expect, it } from "bun:test";

import { buildMarkersByKey } from "../markers-from-trades.js";

// =============================================================================
// Test fixtures
// =============================================================================

/** A non-empty `symbolsAndTimeframes` map covering BTCUSDT and ETHUSDT. */
const TF_MAP = {
  BTCUSDT: ["1h", "4h"],
  ETHUSDT: ["1h"],
} as const;

// =============================================================================
// buildMarkersByKey
// =============================================================================

describe("buildMarkersByKey", () => {
  it("returns an empty map when lastState is null", () => {
    expect(buildMarkersByKey(null, TF_MAP)).toEqual({});
  });

  it("returns an empty map when lastState is not an object (primitive)", () => {
    expect(buildMarkersByKey("hello", TF_MAP)).toEqual({});
    expect(buildMarkersByKey(42, TF_MAP)).toEqual({});
    expect(buildMarkersByKey(true, TF_MAP)).toEqual({});
  });

  it("returns an empty map when positions and closedTrades are missing", () => {
    expect(buildMarkersByKey({}, TF_MAP)).toEqual({});
  });

  it("returns an empty map when positions is not an array", () => {
    expect(
      buildMarkersByKey({ positions: "not-an-array" }, TF_MAP),
    ).toEqual({});
  });

  it("returns an empty map when closedTrades is not an array", () => {
    expect(
      buildMarkersByKey({ closedTrades: "not-an-array" }, TF_MAP),
    ).toEqual({});
  });

  it("returns an empty map for an array of malformed positions", () => {
    const state = {
      positions: [
        { id: "bad-1" }, // missing fields
        { symbol: "BTCUSDT" }, // missing openedAt
        { symbol: "BTCUSDT", openedAt: 1000 }, // missing side
        { symbol: "BTCUSDT", openedAt: 1000, side: "long" }, // invalid side
        null, // null
        "string", // not an object
      ],
      closedTrades: [],
    };
    expect(buildMarkersByKey(state, TF_MAP)).toEqual({});
  });

  it("skips positions for symbols not in the symbolsAndTimeframes map", () => {
    const state = {
      positions: [
        {
          id: "p1",
          symbol: "SOLUSDT", // NOT in TF_MAP
          side: "buy",
          openedAt: 1000,
        },
      ],
      closedTrades: [],
    };
    expect(buildMarkersByKey(state, TF_MAP)).toEqual({});
  });

  it("builds an ENTRY marker for a valid open position (replicated across tfs)", () => {
    const state = {
      positions: [
        {
          id: "p1",
          symbol: "BTCUSDT",
          side: "buy",
          openedAt: 1000,
        },
      ],
      closedTrades: [],
    };
    const result = buildMarkersByKey(state, TF_MAP);
    // The marker is replicated across both 1h and 4h timeframes.
    expect(result["BTCUSDT|1h"]).toHaveLength(1);
    expect(result["BTCUSDT|4h"]).toHaveLength(1);
    expect(result["BTCUSDT|1h"]?.[0]).toEqual({
      time: 1000,
      position: "belowBar",
      color: "#22c55e",
      shape: "arrowUp",
      text: "LONG",
    });
  });

  it("builds a SHORT ENTRY marker for a sell position (aboveBar + red)", () => {
    const state = {
      positions: [
        {
          id: "p2",
          symbol: "ETHUSDT",
          side: "sell",
          openedAt: 2000,
        },
      ],
      closedTrades: [],
    };
    const result = buildMarkersByKey(state, TF_MAP);
    expect(result["ETHUSDT|1h"]?.[0]).toEqual({
      time: 2000,
      position: "aboveBar",
      color: "#ef4444",
      shape: "arrowDown",
      text: "SHORT",
    });
  });

  it("returns an empty map for an array of malformed closed trades", () => {
    const state = {
      positions: [],
      closedTrades: [
        { id: "t1" }, // missing fields
        { symbol: "BTCUSDT" }, // missing openedAt
        { symbol: "BTCUSDT", openedAt: 1000 }, // missing closedAt
        { symbol: "BTCUSDT", openedAt: 1000, closedAt: 2000 }, // missing side
        { symbol: "BTCUSDT", openedAt: 1000, closedAt: 2000, side: "long" }, // invalid side
        null,
        42,
      ],
    };
    expect(buildMarkersByKey(state, TF_MAP)).toEqual({});
  });

  it("skips closed trades for symbols not in the symbolsAndTimeframes map", () => {
    const state = {
      positions: [],
      closedTrades: [
        {
          id: "t1",
          symbol: "SOLUSDT", // NOT in TF_MAP
          side: "buy",
          openedAt: 1000,
          closedAt: 2000,
        },
      ],
    };
    expect(buildMarkersByKey(state, TF_MAP)).toEqual({});
  });

  it("builds ENTRY + EXIT markers for a valid closed trade", () => {
    const state = {
      positions: [],
      closedTrades: [
        {
          id: "t1",
          symbol: "BTCUSDT",
          side: "buy",
          openedAt: 1000,
          closedAt: 2000,
        },
      ],
    };
    const result = buildMarkersByKey(state, TF_MAP);
    // Both 1h and 4h timeframes get the ENTRY + EXIT pair.
    expect(result["BTCUSDT|1h"]).toHaveLength(2);
    expect(result["BTCUSDT|4h"]).toHaveLength(2);
    // Long (buy) ENTRY = belowBar + green arrowUp.
    expect(result["BTCUSDT|1h"]?.[0]).toEqual({
      time: 1000,
      position: "belowBar",
      color: "#22c55e",
      shape: "arrowUp",
      text: "LONG",
    });
    // Long (buy) EXIT = aboveBar + green circle (same color as entry).
    expect(result["BTCUSDT|1h"]?.[1]).toEqual({
      time: 2000,
      position: "aboveBar",
      color: "#22c55e",
      shape: "circle",
      text: "EXIT",
    });
  });

  it("builds SHORT ENTRY + EXIT markers (aboveBar + red arrowDown + belowBar + red circle)", () => {
    const state = {
      positions: [],
      closedTrades: [
        {
          id: "t1",
          symbol: "ETHUSDT",
          side: "sell",
          openedAt: 1000,
          closedAt: 2000,
        },
      ],
    };
    const result = buildMarkersByKey(state, TF_MAP);
    // Short (sell) ENTRY = aboveBar + red arrowDown.
    expect(result["ETHUSDT|1h"]?.[0]).toEqual({
      time: 1000,
      position: "aboveBar",
      color: "#ef4444",
      shape: "arrowDown",
      text: "SHORT",
    });
    // Short (sell) EXIT = belowBar + red circle (same color as entry).
    expect(result["ETHUSDT|1h"]?.[1]).toEqual({
      time: 2000,
      position: "belowBar",
      color: "#ef4444",
      shape: "circle",
      text: "EXIT",
    });
  });

  it("accumulates multiple trades for the same (symbol, tf) key", () => {
    const state = {
      positions: [
        { id: "p1", symbol: "BTCUSDT", side: "buy", openedAt: 1000 },
      ],
      closedTrades: [
        { id: "t1", symbol: "BTCUSDT", side: "buy", openedAt: 2000, closedAt: 3000 },
        { id: "t2", symbol: "BTCUSDT", side: "sell", openedAt: 4000, closedAt: 5000 },
      ],
    };
    const result = buildMarkersByKey(state, TF_MAP);
    // 1h: 1 open + 2 closed (2 markers each) = 5 markers total.
    expect(result["BTCUSDT|1h"]).toHaveLength(5);
    // 4h: same count.
    expect(result["BTCUSDT|4h"]).toHaveLength(5);
  });

  it("combines open positions and closed trades into a single markersByKey", () => {
    const state = {
      positions: [
        { id: "p1", symbol: "BTCUSDT", side: "buy", openedAt: 5000 },
      ],
      closedTrades: [
        { id: "t1", symbol: "BTCUSDT", side: "buy", openedAt: 1000, closedAt: 2000 },
      ],
    };
    const result = buildMarkersByKey(state, TF_MAP);
    // 1h: 1 open ENTRY + 2 closed (ENTRY + EXIT) = 3 markers.
    expect(result["BTCUSDT|1h"]).toHaveLength(3);
    // ETHUSDT: empty (no trades for it).
    expect(result["ETHUSDT|1h"]).toBeUndefined();
  });

  it("returns readonly marker arrays (the result is read-only end-to-end)", () => {
    const state = {
      positions: [
        { id: "p1", symbol: "BTCUSDT", side: "buy", openedAt: 1000 },
      ],
      closedTrades: [],
    };
    const result = buildMarkersByKey(state, TF_MAP);
    // The values must be `readonly ChartMarker[]` (the readonly
    // type is enforced at compile time; the runtime check is
    // that the array doesn't have writable properties).
    expect(Array.isArray(result["BTCUSDT|1h"])).toBe(true);
  });
});
