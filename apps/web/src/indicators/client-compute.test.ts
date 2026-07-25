/**
 * apps/web/src/indicators/client-compute.test.ts
 *
 * Phase 78: bun:test unit tests for the client-side Donchian band
 * computation. The 100% line + branch coverage target applies to
 * `client-compute.ts`; the chart-card integration is covered by
 * the existing e2e suite (`e2e/57C-chart-card-render-edges.spec.ts`
 * + the 58B/58C chart-card-coverage specs).
 *
 * The tests are pure: no React, no DOM, no lightweight-charts. The
 * function under test takes OHLC bars and returns the
 * `IndicatorSeries` shape that the existing `renderDonchian`
 * already consumes — the focus is the math, not the renderer.
 */

import { describe, expect, it } from "bun:test";

import {
  DEFAULT_DONCHIAN_LOOKBACK,
  computeDonchianFromBars,
} from "./client-compute.js";
import type { OHLCBar } from "../lib/ohlc-bridge.js";

// ============================================================================
// Test fixtures
// ============================================================================

/**
 * Build a count-bar OHLC sequence at 1-minute spacing.
 *
 * The bars have:
 *   - open  = 100 + i
 *   - high  = 101 + i
 *   - low   = 99 + i
 *   - close = 100.5 + i
 *
 * The monotonic design makes the assertions trivial: at any window
 * `[i, i + lookback)`, the `upper` is `max(high) = 101 + i + lookback - 1`
 * and the `lower` is `min(low) = 99 + i`.
 */
function makeBars(count: number): readonly OHLCBar[] {
  const out: OHLCBar[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      time: 1_700_000_000_000 + i * 60_000,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1,
    });
  }
  return out;
}

/**
 * Build a count-bar OHLC sequence with a custom `(high, low)` pair
 * per bar. Used to construct non-monotonic bar streams (so the
 * rolling-window tests can verify the extremum-tracking math).
 */
function makeCustomBars(
  count: number,
  highAt: (i: number) => number,
  lowAt: (i: number) => number,
): readonly OHLCBar[] {
  const out: OHLCBar[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      time: 1_700_000_000_000 + i * 60_000,
      open: 100,
      high: highAt(i),
      low: lowAt(i),
      close: 100,
      volume: 1,
    });
  }
  return out;
}

// ============================================================================
// DEFAULT_DONCHIAN_LOOKBACK
// ============================================================================

describe("DEFAULT_DONCHIAN_LOOKBACK", () => {
  it("is 20 (the canonical Donchian period)", () => {
    expect(DEFAULT_DONCHIAN_LOOKBACK).toBe(20);
  });
});

// ============================================================================
// computeDonchianFromBars — warmup
// ============================================================================

describe("computeDonchianFromBars (warmup)", () => {
  it("returns all-null series for empty bars", () => {
    const out = computeDonchianFromBars(makeBars(0), 5);
    expect(out.upper).toEqual([]);
    expect(out.middle).toEqual([]);
    expect(out.lower).toEqual([]);
  });

  it("returns all-null series when bars.length < lookback", () => {
    // 3 bars with lookback 5 → no window fills → all null
    const out = computeDonchianFromBars(makeBars(3), 5);
    expect(out.upper).toEqual([null, null, null]);
    expect(out.middle).toEqual([null, null, null]);
    expect(out.lower).toEqual([null, null, null]);
  });

  it("throws when lookback <= 0", () => {
    expect(() => computeDonchianFromBars(makeBars(5), 0)).toThrow(
      /lookback must be > 0/,
    );
    expect(() => computeDonchianFromBars(makeBars(5), -1)).toThrow(
      /lookback must be > 0/,
    );
  });

  it("uses the default lookback (20) when no argument is passed", () => {
    // 25 bars: first 19 are warmup (null), index 19..24 are valid
    const out = computeDonchianFromBars(makeBars(25));
    expect(out.upper[0]).toBeNull();
    expect(out.upper[18]).toBeNull();
    // Index 19 = the 20th bar; window = bars[0..19]; max(high) = 101+19
    expect(out.upper[19]).toBe(101 + 19);
    // Index 20: window = bars[1..20] (slide); max(high) = 101+20
    expect(out.upper[20]).toBe(101 + 20);
    // Index 24: window = bars[5..24]; max(high) = 101+24
    expect(out.upper[24]).toBe(101 + 24);
  });
});

// ============================================================================
// computeDonchianFromBars — basic math (monotonic bars)
// ============================================================================

describe("computeDonchianFromBars (math)", () => {
  it("computes upper = max(high), lower = min(low) over the window", () => {
    // 5 bars, lookback 3. At index 2 (the 3rd bar), window = bars[0..2]
    // high = 101, 102, 103 → max = 103
    // low  = 99, 100, 101 → min = 99
    // middle = (103 + 99) / 2 = 101
    const out = computeDonchianFromBars(makeBars(5), 3);
    expect(out.upper[2]).toBe(103);
    expect(out.lower[2]).toBe(99);
    expect(out.middle[2]).toBe(101);

    // Index 3: window = bars[1..3], high max = 104, low min = 100
    expect(out.upper[3]).toBe(104);
    expect(out.lower[3]).toBe(100);
    expect(out.middle[3]).toBe(102);

    // Index 4: window = bars[2..4], high max = 105, low min = 101
    expect(out.upper[4]).toBe(105);
    expect(out.lower[4]).toBe(101);
    expect(out.middle[4]).toBe(103);
  });

  it("returns arrays of length bars.length", () => {
    const out = computeDonchianFromBars(makeBars(7), 3);
    expect(out.upper.length).toBe(7);
    expect(out.middle.length).toBe(7);
    expect(out.lower.length).toBe(7);
  });
});

// ============================================================================
// computeDonchianFromBars — rolling-window extremum tracking
// ============================================================================

describe("computeDonchianFromBars (rolling window)", () => {
  it("tracks the rolling high when the entering bar exceeds the current max", () => {
    // Bar 0: high=100, Bar 1: high=200, Bar 2: high=150
    // At index 2 (lookback 3): window = [100, 200, 150] → max = 200
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bars = makeCustomBars(3, (i) => [100, 200, 150][i] ?? 100, () => 0);
    const out = computeDonchianFromBars(bars, 3);
    expect(out.upper[2]).toBe(200);
  });

  it("recomputes the window when the leaving bar is the current max", () => {
    // 4 bars with lookback 3. At index 3 (the 4th bar), the window
    // slides from bars[0..2] to bars[1..3]. The leaving bar (bar 0,
    // high=300) is the current max → recompute; new max = 250.
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bars = makeCustomBars(4, (i) => [300, 100, 200, 250][i] ?? 100, () => 0);
    const out = computeDonchianFromBars(bars, 3);
    // Index 2 (the last bar of the initial window) — no slide yet.
    expect(out.upper[2]).toBe(300);
    // Index 3: window = [100, 200, 250] after slide; max = 250.
    expect(out.upper[3]).toBe(250);
  });

  it("recomputes the window when the leaving bar is the current min", () => {
    // 4 bars with lookback 3. At index 3, the leaving bar (bar 0,
    // low=-50) is the current min → recompute; new min = 10.
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bars = makeCustomBars(4, () => 100, (i) => [-50, 10, 20, 30][i] ?? 0);
    const out = computeDonchianFromBars(bars, 3);
    // Index 2: initial window [-50, 10, 20] → min = -50.
    expect(out.lower[2]).toBe(-50);
    // Index 3: window [10, 20, 30] after slide; min = 10.
    expect(out.lower[3]).toBe(10);
  });

  it("keeps the max when neither the entering nor leaving bar changes the extremum", () => {
    // Bar 0..2 all have high=100. The max stays at 100.
    const bars = makeCustomBars(3, () => 100, () => 0);
    const out = computeDonchianFromBars(bars, 3);
    expect(out.upper[2]).toBe(100);
  });

  it("handles a long rolling window with non-monotonic data", () => {
    // 10 bars; high values: [5, 9, 2, 7, 1, 8, 3, 6, 0, 4], lookback 4
    const highs = [5, 9, 2, 7, 1, 8, 3, 6, 0, 4];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bars = makeCustomBars(10, (i) => highs[i] ?? 0, () => 0);
    const out = computeDonchianFromBars(bars, 4);

    // Index 3: window = bars[0..3] = [5, 9, 2, 7] → max = 9
    expect(out.upper[3]).toBe(9);
    // Index 4: window = bars[1..4] = [9, 2, 7, 1] → max = 9 (leaving=5, entering=1)
    expect(out.upper[4]).toBe(9);
    // Index 5: window = bars[2..5] = [2, 7, 1, 8] → max = 8 (leaving=9, entering=8)
    expect(out.upper[5]).toBe(8);
    // Index 6: window = bars[3..6] = [7, 1, 8, 3] → max = 8 (leaving=2, entering=3)
    expect(out.upper[6]).toBe(8);
    // Index 7: window = bars[4..7] = [1, 8, 3, 6] → max = 8 (leaving=7, entering=6)
    expect(out.upper[7]).toBe(8);
    // Index 8: window = bars[5..8] = [8, 3, 6, 0] → max = 8 (leaving=1, entering=0)
    expect(out.upper[8]).toBe(8);
    // Index 9: window = bars[6..9] = [3, 6, 0, 4] → max = 6 (leaving=8, entering=4)
    expect(out.upper[9]).toBe(6);
  });
});

// ============================================================================
// computeDonchianFromBars — returns IndicatorSeries shape
// ============================================================================

describe("computeDonchianFromBars (output shape)", () => {
  it("returns an object with `upper`, `middle`, `lower` keys", () => {
    const out = computeDonchianFromBars(makeBars(5), 3);
    expect(Object.keys(out).sort()).toEqual(["lower", "middle", "upper"]);
  });

  it("middle is the average of upper and lower at every bar", () => {
    const out = computeDonchianFromBars(makeBars(10), 3);
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const u = out.upper[i];
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const l = out.lower[i];
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const m = out.middle[i];
      if (u === null || l === null || m === null) {
        // Warmup — all three should be null together.
        expect(u).toBeNull();
        expect(l).toBeNull();
        expect(m).toBeNull();
      } else {
        expect(m).toBe((u + l) / 2);
      }
    }
  });
});
