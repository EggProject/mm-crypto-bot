/**
 * apps/web/src/lib/__tests__/bars-from-bar.test.ts
 *
 * Phase 83.5 (Bug 1 — OHLCV not refreshing): unit tests for the
 * `appendOrReplaceBar` helper that drives the `useEffect([lastBar])`
 * bar-append logic in `App.tsx`.
 *
 * The helper is PURE (no React, no DOM, no I/O) and is exercised
 * here across all 5 branches:
 *   1. `lastBar` is null (defensive no-op)
 *   2. `lastBar` is not a well-formed object (defensive no-op)
 *   3. `barsByKey` has no entry for the key → no-op (the bar is
 *      dropped; next SNAPSHOT will re-seed)
 *   4. Same `time` as the last bar → REPLACE the last bar in place
 *   5. STRICTLY greater `time` → APPEND
 *   6. STRICTLY lesser `time` (out-of-order) → no-op (stale; next
 *      SNAPSHOT will reconcile)
 *
 * Branch coverage intent mirrors `markers-from-trades.test.ts`.
 */

import { describe, expect, it } from "bun:test";

import { appendOrReplaceBar } from "../bars-from-bar.js";
import type { OHLCBar } from "../ohlc-bridge.js";

// =============================================================================
// Test fixtures
// =============================================================================

const KEY = "BTC/USDC|1h";

/** A 3-bar bootstrap, time-ascending. */
const BOOTSTRAP_3_BARS: Readonly<Record<string, readonly OHLCBar[]>> = {
  [KEY]: [
    { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    { time: 2000, open: 105, high: 115, low: 95, close: 110, volume: 2 },
    { time: 3000, open: 110, high: 120, low: 100, close: 115, volume: 3 },
  ],
};

/** A 1-bar bootstrap for the "missing key" branch. */
const BOOTSTRAP_1_BAR: Readonly<Record<string, readonly OHLCBar[]>> = {
  [KEY]: [
    { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
  ],
};

// =============================================================================
// appendOrReplaceBar
// =============================================================================

describe("appendOrReplaceBar", () => {
  it("returns noop when lastBar is null", () => {
    const result = appendOrReplaceBar(BOOTSTRAP_3_BARS, null);
    expect(result.kind).toBe("noop");
    expect(result.next).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns noop when lastBar is a primitive (defensive)", () => {
    const result1 = appendOrReplaceBar(BOOTSTRAP_3_BARS, "bar");
    const result2 = appendOrReplaceBar(BOOTSTRAP_3_BARS, 42);
    const result3 = appendOrReplaceBar(BOOTSTRAP_3_BARS, true);
    expect(result1.kind).toBe("noop");
    expect(result2.kind).toBe("noop");
    expect(result3.kind).toBe("noop");
  });

  it("returns noop when lastBar is missing required string fields (symbol/timeframe)", () => {
    const r1 = appendOrReplaceBar(BOOTSTRAP_3_BARS, { timeframe: "1h", ohlc: { time: 4000, open: 1, high: 2, low: 0, close: 1, volume: 1 } });
    const r2 = appendOrReplaceBar(BOOTSTRAP_3_BARS, { symbol: "BTC/USDC", ohlc: { time: 4000, open: 1, high: 2, low: 0, close: 1, volume: 1 } });
    expect(r1.kind).toBe("noop");
    expect(r2.kind).toBe("noop");
  });

  it("returns noop when ohlc is missing or non-object", () => {
    const r1 = appendOrReplaceBar(BOOTSTRAP_3_BARS, { symbol: "BTC/USDC", timeframe: "1h", ohlc: null });
    const r2 = appendOrReplaceBar(BOOTSTRAP_3_BARS, { symbol: "BTC/USDC", timeframe: "1h" });
    expect(r1.kind).toBe("noop");
    expect(r2.kind).toBe("noop");
  });

  it("returns noop when ohlc has non-finite numeric fields", () => {
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: NaN, open: 1, high: 2, low: 0, close: 1, volume: 1 },
    });
    expect(r.kind).toBe("noop");
  });

  it("returns noop when the (symbol, timeframe) key is not in barsByKey (bar arrived before snapshot)", () => {
    const r = appendOrReplaceBar({}, {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    });
    expect(r.kind).toBe("noop");
    expect(r.next).toEqual({});
  });

  it("returns noop when the (symbol, timeframe) key has an empty bar array", () => {
    const r = appendOrReplaceBar({ [KEY]: [] }, {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    });
    expect(r.kind).toBe("noop");
  });

  it("appends a new bar when its time is strictly greater than the last bar's time", () => {
    const newBar = {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 4000, open: 115, high: 125, low: 105, close: 120, volume: 4 },
    };
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, newBar);
    expect(r.kind).toBe("append");
    // eslint-disable-next-line security/detect-object-injection
    const next = r.next[KEY];
    expect(next).toHaveLength(4);
    expect(next?.[3]).toEqual({
      time: 4000,
      open: 115,
      high: 125,
      low: 105,
      close: 120,
      volume: 4,
    });
    // The previous bars are preserved.
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[0]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[0]);
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[1]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[1]);
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[2]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[2]);
  });

  it("replaces the last bar in place when the new bar shares the same time (live OHLCV update)", () => {
    const updatedBar = {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 3000, open: 200, high: 210, low: 190, close: 205, volume: 99 },
    };
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, updatedBar);
    expect(r.kind).toBe("replace");
    // eslint-disable-next-line security/detect-object-injection
    const next = r.next[KEY];
    // The length MUST stay at 3 (no new bar appended; the same-time bar
    // is an in-place OHLCV update for the in-progress bar).
    expect(next).toHaveLength(3);
    expect(next?.[2]).toEqual({
      time: 3000,
      open: 200,
      high: 210,
      low: 190,
      close: 205,
      volume: 99,
    });
    // The previous bars are unchanged.
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[0]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[0]);
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[1]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[1]);
  });

  it("returns noop for an out-of-order bar (time LESS than the last bar — stale WS delivery)", () => {
    const staleBar = {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 2000, open: 99, high: 99, low: 99, close: 99, volume: 0 },
    };
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, staleBar);
    expect(r.kind).toBe("noop");
    // The previous barsByKey is returned unchanged (reference identity).
    expect(r.next).toBe(BOOTSTRAP_3_BARS);
  });

  it("preserves reference inequality between input and output (React setState identity gate)", () => {
    // The "append" branch produces a new barsByKey object (immutable
    // update) so React's `setBarsByKey` triggers a re-render.
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 4000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    });
    expect(r.next).not.toBe(BOOTSTRAP_3_BARS);
    // The replaced key is a new array (not the same reference).
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY]).not.toBe(BOOTSTRAP_3_BARS[KEY]);
  });

  it("handles a 1-bar bootstrap (the first live bar should append or replace without crashing)", () => {
    const sameTimeBar = {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 1000, open: 200, high: 210, low: 190, close: 205, volume: 99 },
    };
    const r = appendOrReplaceBar(BOOTSTRAP_1_BAR, sameTimeBar);
    expect(r.kind).toBe("replace");
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY]).toHaveLength(1);
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY]?.[0]?.close).toBe(205);
  });
});
