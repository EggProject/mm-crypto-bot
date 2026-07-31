/**
 * apps/web/src/lib/__tests__/bars-from-tick.test.ts
 *
 * Phase 83.6: unit tests for the `applyTickToBars` helper that drives
 * the `useEffect([lastTick])` in-progress bar update logic in
 * `App.tsx`.
 *
 * The helper is PURE (no React, no DOM, no I/O) and is exercised here
 * across all branches:
 *   1. `tick` is null (defensive no-op)
 *   2. `tick.price` is negative / non-finite (defensive no-op)
 *   3. `tick.symbol` is not in `symbolsAndTimeframes` (no-op)
 *   4. The (symbol, timeframe) key is missing in `barsByKey` (no-op;
 *      the `bar` event at the next boundary will seed it)
 *   5. APPEND — `last.time < computed barTime` (fresh in-progress bar)
 *   6. REPLACE high — `last.time === barTime`, `price > high`
 *   7. REPLACE low — `last.time === barTime`, `price < low`
 *   8. STALE — `last.time > barTime` (clock skew / out-of-order)
 *
 * Test-time strategy: every test calls `applyTickToBars` with an
 * explicit `nowMs` so the helper's quantized bar-time is
 * deterministic. The bar's `time` in the bootstrap is set to the
 * SAME 1h boundary as `nowMs` (for REPLACE tests), the PREVIOUS
 * boundary (for APPEND tests), or the NEXT boundary (for STALE
 * tests).
 *
 * Branch coverage intent mirrors `bars-from-bar.test.ts`.
 */

import { describe, expect, it } from "bun:test";

import { applyTickToBars } from "../bars-from-tick.js";
import type { OHLCBar } from "../ohlc-bridge.js";

// =============================================================================
// Test fixtures — time is fully controlled via `nowMs`
// =============================================================================

const KEY = "BTC/USDC|1h";

/**
 * A fixed "now" used across the tests. 1h-aligned so the helper's
 * quantization lands on the same value. 2024-09-01 00:00:00 UTC =
 * 1_725_148_800_000 ms; we use a value safely in the past so the
 * tests don't depend on the wall clock.
 */
const NOW_MS = 1_725_148_800_000;
/** The 1h boundary NOW_MS quantizes to (helper's computed bar time). */
const BAR_TIME_MS = Math.floor(NOW_MS / 3_600_000) * 3_600_000;
/** One hour before BAR_TIME_MS. */
const PREV_BAR_TIME_MS = BAR_TIME_MS - 3_600_000;

/** A 3-bar bootstrap, time-ascending, ending at BAR_TIME_MS. */
const BOOTSTRAP_3_BARS: Readonly<Record<string, readonly OHLCBar[]>> = {
  [KEY]: [
    // The first 2 bars are at earlier boundaries; the last bar is at
    // the SAME 1h boundary that NOW_MS quantizes to (so the REPLACE
    // tests land in the same bar).
    { time: PREV_BAR_TIME_MS - 3_600_000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    { time: PREV_BAR_TIME_MS, open: 105, high: 115, low: 95, close: 110, volume: 2 },
    { time: BAR_TIME_MS, open: 110, high: 120, low: 100, close: 115, volume: 3 },
  ],
};

const SYMBOLS_AND_TIMEFRAMES = {
  "BTC/USDC": ["1h", "4h"] as readonly string[],
};

const SYMBOLS_AND_TIMEFRAMES_4H_ONLY = {
  "BTC/USDC": ["4h"] as readonly string[],
};

// =============================================================================
// applyTickToBars
// =============================================================================

describe("applyTickToBars", () => {
  it("returns the same barsByKey reference when tick is null (defensive)", () => {
    const r = applyTickToBars(BOOTSTRAP_3_BARS, null, SYMBOLS_AND_TIMEFRAMES, NOW_MS);
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns the same barsByKey reference when tick is undefined (defensive)", () => {
    const r = applyTickToBars(BOOTSTRAP_3_BARS, undefined, SYMBOLS_AND_TIMEFRAMES, NOW_MS);
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns the same barsByKey reference when tick is a primitive (defensive)", () => {
    const r1 = applyTickToBars(BOOTSTRAP_3_BARS, "tick", SYMBOLS_AND_TIMEFRAMES, NOW_MS);
    const r2 = applyTickToBars(BOOTSTRAP_3_BARS, 42, SYMBOLS_AND_TIMEFRAMES, NOW_MS);
    const r3 = applyTickToBars(BOOTSTRAP_3_BARS, true, SYMBOLS_AND_TIMEFRAMES, NOW_MS);
    expect(r1).toBe(BOOTSTRAP_3_BARS);
    expect(r2).toBe(BOOTSTRAP_3_BARS);
    expect(r3).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns the same barsByKey reference when tick has a negative price (defensive)", () => {
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "BTC/USDC", price: -1, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns the same barsByKey reference when tick has a non-finite price (defensive)", () => {
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "BTC/USDC", price: Number.NaN, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns the same barsByKey reference when tick has no price field (defensive)", () => {
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "BTC/USDC", ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns the same barsByKey reference when tick has no symbol field (defensive)", () => {
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { price: 200, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns the same barsByKey reference when tick's symbol is not in symbolsAndTimeframes", () => {
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "ETH/USDC", price: 200, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns the same barsByKey reference when the (symbol, timeframe) key is missing (no snapshot seed yet)", () => {
    const r = applyTickToBars(
      {},
      { symbol: "BTC/USDC", price: 200, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    expect(r).toEqual({});
  });

  it("appends a new in-progress bar when the tick's boundary is strictly after the last bar's time", () => {
    // To force the APPEND branch, set the bar's time to a previous
    // 1h boundary and the tick's nowMs to a later 1h boundary.
    const pastBootstrap: Readonly<Record<string, readonly OHLCBar[]>> = {
      [KEY]: [
        { time: PREV_BAR_TIME_MS, open: 110, high: 120, low: 100, close: 115, volume: 3 },
      ],
    };
    const r = applyTickToBars(
      pastBootstrap,
      { symbol: "BTC/USDC", price: 200, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    // New map reference (mutation happened).
    expect(r).not.toBe(pastBootstrap);
    // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString, not user input
    const bars = r[KEY];
    expect(bars).toBeDefined();
    expect(bars).toHaveLength(2);
    const last = bars[bars.length - 1];
    // The new bar's time is the 1h boundary NOW_MS quantizes to.
    expect(last.time).toBe(BAR_TIME_MS);
    // OHLC all = price (the first tick of the new bar seeds open=high=low=close).
    expect(last.open).toBe(200);
    expect(last.high).toBe(200);
    expect(last.low).toBe(200);
    expect(last.close).toBe(200);
    // Volume is 0 — tick payload has no volume. The next `bar` event
    // reconciles it.
    expect(last.volume).toBe(0);
  });

  it("replaces the last bar's high when the tick price exceeds the existing high (same time)", () => {
    // The last bar in the bootstrap has time BAR_TIME_MS (a 1h
    // boundary). nowMs quantizes to the SAME boundary → REPLACE.
    // Price 150 > high 120.
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "BTC/USDC", price: 150, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    expect(r).not.toBe(BOOTSTRAP_3_BARS);
    // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString, not user input
    const bars = r[KEY];
    expect(bars).toHaveLength(3); // same count, last bar replaced
    const last = bars[bars.length - 1];
    expect(last.time).toBe(BAR_TIME_MS);
    // High updated to the tick price.
    expect(last.high).toBe(150);
    // Close updated to the tick price.
    expect(last.close).toBe(150);
    // Low unchanged.
    expect(last.low).toBe(100);
    // Open + volume preserved from the previous bar.
    expect(last.open).toBe(110);
    expect(last.volume).toBe(3);
  });

  it("replaces the last bar's low when the tick price is below the existing low (same time)", () => {
    // Price 80 < low 100. High unchanged.
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "BTC/USDC", price: 80, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString, not user input
    const bars = r[KEY];
    expect(bars).toHaveLength(3);
    const last = bars[bars.length - 1];
    expect(last.time).toBe(BAR_TIME_MS);
    // Low updated to the tick price.
    expect(last.low).toBe(80);
    // Close updated to the tick price.
    expect(last.close).toBe(80);
    // High unchanged.
    expect(last.high).toBe(120);
    // Open + volume preserved.
    expect(last.open).toBe(110);
    expect(last.volume).toBe(3);
  });

  it("does not change high/low when the tick price is within the existing range (same time)", () => {
    // Price 110 is between low (100) and high (120). No-op for high/low,
    // but close still updates.
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "BTC/USDC", price: 110, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString, not user input
    const bars = r[KEY];
    const last = bars[bars.length - 1];
    expect(last.high).toBe(120);
    expect(last.low).toBe(100);
    expect(last.close).toBe(110);
  });

  it("returns the same barsByKey reference for a stale tick (nowMs quantizes to BEFORE the last bar's time)", () => {
    // nowMs in the PREVIOUS hour. The helper's computed bar time is
    // PREV_BAR_TIME_MS, but the bootstrap's last bar is at
    // BAR_TIME_MS (> PREV_BAR_TIME_MS) → stale branch.
    const staleNow = PREV_BAR_TIME_MS + 60_000; // 1 minute into the previous hour
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "BTC/USDC", price: 200, ts: staleNow },
      SYMBOLS_AND_TIMEFRAMES,
      staleNow,
    );
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns the same barsByKey reference when the symbol's timeframe list is empty", () => {
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "BTC/USDC", price: 200, ts: NOW_MS },
      { "BTC/USDC": [] as readonly string[] },
      NOW_MS,
    );
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("skips unknown timeframes (no entry in TIMEFRAME_TO_PERIOD_SEC) but still processes known ones", () => {
    // Mix a known ("1h") with an unknown ("99x") timeframe. The
    // unknown one is silently skipped; the known one APPENDs.
    const pastBootstrap: Readonly<Record<string, readonly OHLCBar[]>> = {
      [KEY]: [
        { time: PREV_BAR_TIME_MS, open: 110, high: 120, low: 100, close: 115, volume: 3 },
      ],
    };
    const symbolsWithUnknown = {
      "BTC/USDC": ["99x", "1h"] as readonly string[],
    };
    const r = applyTickToBars(
      pastBootstrap,
      { symbol: "BTC/USDC", price: 200, ts: NOW_MS },
      symbolsWithUnknown,
      NOW_MS,
    );
    // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString, not user input
    const bars = r[KEY];
    expect(bars).toHaveLength(2); // APPENDed (1h branch)
    const last = bars[bars.length - 1];
    expect(last.time).toBe(BAR_TIME_MS);
    expect(last.close).toBe(200);
  });

  it("returns the same barsByKey reference when the symbol is in symbolsAndTimeframes but the key is in 4h-only with no 4h data", () => {
    // symbolsAndTimeframes has "4h" only; the bootstrap has no
    // "4h" key. The tick's "4h" branch is a no-op (missing key).
    const r = applyTickToBars(
      BOOTSTRAP_3_BARS,
      { symbol: "BTC/USDC", price: 200, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES_4H_ONLY,
      NOW_MS,
    );
    expect(r).toBe(BOOTSTRAP_3_BARS);
  });

  it("does not mutate the input barsByKey when mutating (immutability)", () => {
    // Sanity check: the helper must return a new reference (not
    // mutate the input) when it APPENDs / REPLACEs.
    const pastBootstrap: Readonly<Record<string, readonly OHLCBar[]>> = {
      [KEY]: [
        { time: PREV_BAR_TIME_MS, open: 110, high: 120, low: 100, close: 115, volume: 3 },
      ],
    };
    // eslint-disable-next-line security/detect-object-injection -- key is a test constant, not user input
    const originalBars = pastBootstrap[KEY];
    const r = applyTickToBars(
      pastBootstrap,
      { symbol: "BTC/USDC", price: 200, ts: NOW_MS },
      SYMBOLS_AND_TIMEFRAMES,
      NOW_MS,
    );
    // The original map's 1h key still has 1 bar.
    // eslint-disable-next-line security/detect-object-injection -- key is a test constant, not user input
    expect(pastBootstrap[KEY]).toHaveLength(1);
    // The original last bar's close is still 115 (unchanged).
    expect(originalBars[originalBars.length - 1].close).toBe(115);
    // The new map has 2 bars.
    // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString, not user input
    expect(r[KEY]).toHaveLength(2);
  });
});
