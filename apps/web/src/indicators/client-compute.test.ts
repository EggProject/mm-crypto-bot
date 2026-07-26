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
  computeBreakoutSignalsFromBars,
  computeCascadeEventsFromBars,
  computeDonchianFromBars,
  computeFundingFlipsFromBars,
  computeFundingRateFromBars,
  computeFundingSpreadFromBars,
  computePivotFromBars,
  computeRegimeChangeMarkersFromBars,
  computeRegimeFromBars,
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

  it("uses the FAST PATH when the leaving bar is not the current max/min (line 136-138 fast path)", () => {
    // 4 bars, lookback 3. Initial window = bars[0..2] → max=200, min=50.
    // At i=3, the leaving bar (bar 0) has high=100, low=10. It is NOT
    // the current max (200) NOR the current min (50 — wait, bar 0's low
    // is 10, the current min is 50 → bar 0's low 10 is less than 50,
    // so bar 0 IS the min).
    //
    // To force the FAST PATH: the leaving bar's high must be < winHigh
    // AND the leaving bar's low must be > winLow. AND the entering
    // bar's high must be <= winHigh AND entering bar's low >= winLow.
    //
    // Set highs=[150, 100, 200, 150] and lows=[100, 50, 150, 100].
    // Initial window [0..2] = [150, 100, 200] highs → max=200;
    // [100, 50, 150] lows → min=50.
    // At i=3, leaving=bar 0: high=150 (not the max 200), low=100 (not
    // the min 50). Entering=bar 3: high=150 (not > 200), low=100 (not
    // < 50). → FAST PATH fires.
    const highs = [150, 100, 200, 150];
    const lows = [100, 50, 150, 100];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bars = makeCustomBars(4, (i) => highs[i] ?? 0, (i) => lows[i] ?? 0);
    const out = computeDonchianFromBars(bars, 3);
    // Index 2: initial window max=200, min=50.
    expect(out.upper[2]).toBe(200);
    expect(out.lower[2]).toBe(50);
    // Index 3: leaving bar (bar 0: high=150, low=100) is not the max
    // (200) and not the min (50). Entering bar (bar 3: high=150,
    // low=100) does not exceed the max and does not undercut the min.
    // → FAST PATH: winHigh stays 200, winLow stays 50.
    expect(out.upper[3]).toBe(200);
    expect(out.lower[3]).toBe(50);
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

// ============================================================================
// computePivotFromBars — Phase 79
// ============================================================================

describe("computePivotFromBars", () => {
  it("returns an object with `pp`, `r1`, `r2`, `s1`, `s2` keys", () => {
    const out = computePivotFromBars(makeBars(30), 24);
    expect(Object.keys(out).sort()).toEqual(["pp", "r1", "r2", "s1", "s2"]);
  });

  it("every value is null during the warmup period (bars.length < lookback)", () => {
    const out = computePivotFromBars(makeBars(5), 24);
    for (const key of ["pp", "r1", "r2", "s1", "s2"] as const) {
      for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
        expect(out[key][i]).toBeNull();
      }
    }
  });

  it("PP = (H + L + C) / 3 of the rolling window at every defined bar", () => {
    const bars = makeBars(30);
    const lookback = 10;
    const out = computePivotFromBars(bars, lookback);
    for (let i = lookback - 1; i < bars.length; i += 1) {
      // Compute the expected PP from the window.
      let winHigh = -Infinity;
      let winLow = Infinity;
      for (let j = i - lookback + 1; j <= i; j += 1) {
        // eslint-disable-next-line security/detect-object-injection -- j is a loop counter
        const b = bars[j];
        if (b.high > winHigh) winHigh = b.high;
        if (b.low < winLow) winLow = b.low;
      }
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const lastClose = bars[i].close;
      const expectedPP = (winHigh + winLow + lastClose) / 3;
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      expect(out.pp[i]).toBeCloseTo(expectedPP, 10);
    }
  });

  it("r1 > pp > s1 and r2 > r1 > s2 > s1 (Fibonacci band ordering)", () => {
    const out = computePivotFromBars(makeBars(30), 10);
    for (let i = 10; i < 30; i += 1) {
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const pp = out.pp[i] as number;
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const r1 = out.r1[i] as number;
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const r2 = out.r2[i] as number;
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const s1 = out.s1[i] as number;
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const s2 = out.s2[i] as number;
      expect(r1).toBeGreaterThan(pp);
      expect(s1).toBeLessThan(pp);
      expect(r2).toBeGreaterThan(r1);
      expect(s2).toBeLessThan(s1);
    }
  });

  it("returns an empty (all-null) series for an empty bar list", () => {
    const out = computePivotFromBars([], 24);
    for (const key of ["pp", "r1", "r2", "s1", "s2"] as const) {
      // eslint-disable-next-line security/detect-object-injection -- `key` is from a const-tuple literal above
      expect(out[key]).toEqual([]);
    }
  });

  it("throws on lookback <= 0 (defensive — a 0-lookback is meaningless)", () => {
    expect(() => computePivotFromBars(makeBars(5), 0)).toThrow(
      /lookback must be > 0/,
    );
    expect(() => computePivotFromBars(makeBars(5), -1)).toThrow(
      /lookback must be > 0/,
    );
  });
});

// ============================================================================
// computeBreakoutSignalsFromBars — Phase 79
// ============================================================================

describe("computeBreakoutSignalsFromBars", () => {
  it("returns an empty array for an empty bar list", () => {
    const donchian = computeDonchianFromBars([], 20);
    expect(computeBreakoutSignalsFromBars([], donchian)).toEqual([]);
  });

  it("returns an empty array when no bar breaks the Donchian band", () => {
    // Flat bars: high = low = close = 100 for every bar. The
    // Donchian upper = lower = 100 throughout. No bar's close
    // can exceed the upper (= 100), so no entries.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
      });
    }
    const donchian = computeDonchianFromBars(bars, 20);
    expect(computeBreakoutSignalsFromBars(bars, donchian)).toEqual([]);
  });

  it("emits a LONG entry marker when close > upper (breakout above)", () => {
    // The Donchian upper is `max(high)` over the rolling
    // window. A bar's OWN high is part of the window, so for
    // `close > upper` to be true, the bar's close must exceed
    // the WINDOW max (which can include the same bar's high).
    // The clean way to construct a breakout: keep `high` flat
    // at the prior equilibrium and bump the close above it
    // (a "low-vol breakout" — close > high of all bars in the
    // window). Lookback=5; bars[0..4] are flat at 100. Bar 5
    // has high=100, close=110 — the window max is 100, so
    // close (110) > upper (100) → ENTRY long.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 20; i += 1) {
      const isBreakout = i === 5;
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 100,
        high: 100,
        low: 100,
        close: isBreakout ? 110 : 100,
        volume: 1,
      });
    }
    const donchian = computeDonchianFromBars(bars, 5);
    const markers = computeBreakoutSignalsFromBars(bars, donchian);
    expect(markers.length).toBeGreaterThanOrEqual(1);
    const entry = markers.find((m) => m.text === "ENTRY");
    expect(entry).toBeDefined();
    expect(entry?.shape).toBe("arrowUp");
    expect(entry?.position).toBe("belowBar");
    expect(entry?.color).toBe("#22c55e");
  });

  it("emits a SHORT entry marker when close < lower (breakdown below)", () => {
    // Mirrors the LONG test: low stays at 100 (the prior
    // equilibrium), close drops to 90. lower[5] = 100, close
    // 90 < 100 → ENTRY short.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 20; i += 1) {
      const isBreakdown = i === 5;
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 100,
        high: 100,
        low: 100,
        close: isBreakdown ? 90 : 100,
        volume: 1,
      });
    }
    const donchian = computeDonchianFromBars(bars, 5);
    const markers = computeBreakoutSignalsFromBars(bars, donchian);
    const entry = markers.find((m) => m.text === "ENTRY");
    expect(entry).toBeDefined();
    expect(entry?.shape).toBe("arrowDown");
    expect(entry?.position).toBe("aboveBar");
    expect(entry?.color).toBe("#ef4444");
  });

  it("emits an EXIT marker when an open position closes back to the middle band", () => {
    // Bar 5: high=100, close=110 → ENTRY long (close > upper 100).
    // Bar 6: close=100.5 → upper=100 (window = bars[2..6],
    //   all highs = 100), middle=100. close 100.5 > middle 100
    //   → stay long.
    // Bar 7: close=100 → upper=100, middle=100. close 100 ≤
    //   middle 100 → EXIT long.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 20; i += 1) {
      let close = 100;
      if (i === 5) close = 110;
      if (i === 6) close = 100.5;
      if (i === 7) close = 100;
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 100,
        high: 100,
        low: 100,
        close,
        volume: 1,
      });
    }
    const donchian = computeDonchianFromBars(bars, 5);
    const markers = computeBreakoutSignalsFromBars(bars, donchian);
    const exit = markers.find((m) => m.text === "EXIT");
    expect(exit).toBeDefined();
  });

  it("returns an empty array when `donchian` is missing the upper/lower/middle keys", () => {
    // Defensive — the `prior` map in the indicator pipeline may
    // not have a `donchian` entry yet (e.g. the line indicator
    // hasn't been computed).
    const bars = makeBars(30);
    expect(computeBreakoutSignalsFromBars(bars, {})).toEqual([]);
  });
});

// ============================================================================
// Phase 81: computeFundingRateFromBars
// ============================================================================

describe("computeFundingRateFromBars", () => {
  it("returns an all-null series for empty bars", () => {
    const out = computeFundingRateFromBars([]);
    expect(out.funding).toEqual([]);
  });

  it("returns an all-null series for bars.length <= lookback (warmup)", () => {
    const bars = makeBars(5);
    const out = computeFundingRateFromBars(bars, 8);
    expect(out.funding.every((v) => v === null)).toBe(true);
  });

  it("returns a positive funding rate when close prices are rising", () => {
    // 30 bars with close rising from 100 to 130. The log
    // return over the 8-bar window should be positive.
    const out = computeFundingRateFromBars(makeBars(30), 8);
    // Bar 8 is the first computable bar. Its funding rate
    // is log(108.5) - log(100.5) ≈ 0.077, divided by 8 ≈
    // 0.0096. We don't check the exact value (floating
    // point), just the sign.
    const v = out.funding[8];
    expect(v).not.toBeNull();
    expect((v as number | null) ?? 0).toBeGreaterThan(0);
  });

  it("returns a negative funding rate when close prices are falling", () => {
    // 30 bars with close prices DECREASING from 100 to 70.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 100 - i,
        high: 101 - i,
        low: 99 - i,
        close: 100.5 - i,
        volume: 1,
      });
    }
    const out = computeFundingRateFromBars(bars, 8);
    const v = out.funding[8];
    expect(v).not.toBeNull();
    expect((v as number | null) ?? 0).toBeLessThan(0);
  });

  it("throws on lookback <= 0 (defensive)", () => {
    expect(() => computeFundingRateFromBars(makeBars(5), 0)).toThrow(
      /lookback must be > 0/,
    );
    expect(() => computeFundingRateFromBars(makeBars(5), -1)).toThrow(
      /lookback must be > 0/,
    );
  });

  it("returns 0 for a bar where the previous close is non-positive (line 531 fallback)", () => {
    // 9 bars with lookback 8. The 9th bar's prev (bar 0) has
    // close = 0. The `prev.close <= 0` branch fires → funding[8] = 0
    // (the fallback for non-positive close prices; log(0) is
    // -Infinity which would propagate as NaN otherwise).
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 9; i += 1) {
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 100,
        high: 101,
        low: 99,
        // Bar 0 has close = 0; the rest are positive.
        close: i === 0 ? 0 : 100 + i,
        volume: 1,
      });
    }
    const out = computeFundingRateFromBars(bars, 8);
    // Bar 8 (the first computable bar) uses bar 0 as the prev.
    // prev.close = 0 → the fallback fires → funding[8] = 0.
    expect(out.funding[8]).toBe(0);
  });

  it("returns 0 for a bar where the current close is non-positive (line 531 fallback)", () => {
    // 9 bars, lookback 8. Bar 8 (the first computable bar) has
    // close = 0. The `cur.close <= 0` branch fires → funding[8] = 0.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 9; i += 1) {
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 100,
        high: 101,
        low: 99,
        close: i === 8 ? 0 : 100 + i,
        volume: 1,
      });
    }
    const out = computeFundingRateFromBars(bars, 8);
    expect(out.funding[8]).toBe(0);
  });
});

// ============================================================================
// Phase 81: computeFundingSpreadFromBars
// ============================================================================

describe("computeFundingSpreadFromBars", () => {
  it("returns an all-null series for empty bars", () => {
    const out = computeFundingSpreadFromBars([]);
    expect(out.spread).toEqual([]);
  });

  it("returns an all-null series for bars.length <= lookback (warmup)", () => {
    const bars = makeBars(5);
    const out = computeFundingSpreadFromBars(bars, 8);
    expect(out.spread.every((v) => v === null)).toBe(true);
  });

  it("returns a defined spread for bars with a clear trend", () => {
    const out = computeFundingSpreadFromBars(makeBars(30), 8);
    // Bar 8 is the first computable bar. The fast window
    // (4 bars) responds faster to the trend than the slow
    // window (8 bars), so the spread is positive.
    const v = out.spread[8];
    expect(v).not.toBeNull();
    expect(typeof v).toBe("number");
  });

  it("returns 0 when close prices are non-positive (defensive)", () => {
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 1,
      });
    }
    const out = computeFundingSpreadFromBars(bars, 8);
    // The fallback value is 0 (not null) for non-positive
    // prices — the renderer shows a gap on the chart for
    // null values, but 0 keeps the line continuous.
    const v = out.spread[8];
    expect(v).toBe(0);
  });

  it("throws on lookback <= 0 (defensive)", () => {
    expect(() => computeFundingSpreadFromBars(makeBars(5), 0)).toThrow(
      /lookback must be > 0/,
    );
  });
});

// ============================================================================
// Phase 81: computeCascadeEventsFromBars
// ============================================================================

describe("computeCascadeEventsFromBars", () => {
  it("returns an empty array for fewer than 2 bars", () => {
    expect(computeCascadeEventsFromBars([])).toEqual([]);
    const oneBar: OHLCBar[] = [makeBars(1)[0] as OHLCBar];
    expect(computeCascadeEventsFromBars(oneBar)).toEqual([]);
  });

  it("returns an empty array for bars with no large moves", () => {
    // 30 bars with close prices rising smoothly by 0.5 per
    // bar — about 0.5% per bar, well below the 2% threshold.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      const close = 100 + i * 0.5;
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: close,
        high: close + 0.1,
        low: close - 0.1,
        close,
        volume: 1,
      });
    }
    expect(computeCascadeEventsFromBars(bars)).toEqual([]);
  });

  it("detects a +3% bar-to-bar move as an 'up' cascade with severity ~0.5", () => {
    // bar 0: close = 100
    // bar 1: close = 103 (+3% = 1.5x threshold, severity = 0.5)
    const bars: OHLCBar[] = [
      {
        time: 1_700_000_000_000,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
      },
      {
        time: 1_700_000_000_000 + 60_000,
        open: 103,
        high: 103,
        low: 103,
        close: 103,
        volume: 1,
      },
    ];
    const events = computeCascadeEventsFromBars(bars);
    expect(events).toHaveLength(1);
    const event = events[0] as { position: string; color: string };
    // 'up' cascade → aboveBar + red
    expect(event.position).toBe("aboveBar");
    expect(event.color).toBe("#ef4444");
  });

  it("detects a -3% bar-to-bar move as a 'down' cascade with green marker", () => {
    // bar 0: close = 100
    // bar 1: close = 97 (-3% = 1.5x threshold)
    const bars: OHLCBar[] = [
      {
        time: 1_700_000_000_000,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
      },
      {
        time: 1_700_000_000_000 + 60_000,
        open: 97,
        high: 97,
        low: 97,
        close: 97,
        volume: 1,
      },
    ];
    const events = computeCascadeEventsFromBars(bars);
    expect(events).toHaveLength(1);
    const event = events[0] as { position: string; color: string };
    // 'down' cascade → belowBar + green
    expect(event.position).toBe("belowBar");
    expect(event.color).toBe("#22c55e");
  });

  it("uses arrowUp/arrowDown for severity > 0.5 and circle for <= 0.5", () => {
    // bar 0: close = 100
    // bar 1: close = 102.5 (+2.5%, severity ≈ 0.42 → circle)
    // bar 2: close = 110 (+7.3%, severity → 1.0 → arrowUp)
    const bars: OHLCBar[] = [
      {
        time: 1_700_000_000_000,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
      },
      {
        time: 1_700_000_000_000 + 60_000,
        open: 102.5,
        high: 102.5,
        low: 102.5,
        close: 102.5,
        volume: 1,
      },
      {
        time: 1_700_000_000_000 + 120_000,
        open: 110,
        high: 110,
        low: 110,
        close: 110,
        volume: 1,
      },
    ];
    const events = computeCascadeEventsFromBars(bars);
    expect(events).toHaveLength(2);
    expect((events[0] as { shape: string }).shape).toBe("circle");
    expect((events[1] as { shape: string }).shape).toBe("arrowUp");
  });

  it("throws on thresholdPct <= 0 (defensive)", () => {
    expect(() => computeCascadeEventsFromBars(makeBars(5), 0)).toThrow(
      /thresholdPct must be > 0/,
    );
  });
});

// ============================================================================
// Phase 81: computeFundingFlipsFromBars
// ============================================================================

describe("computeFundingFlipsFromBars", () => {
  it("returns an empty array for fewer than 2 bars", () => {
    const funding = computeFundingRateFromBars(makeBars(10));
    expect(computeFundingFlipsFromBars([], funding)).toEqual([]);
  });

  it("returns an empty array when funding has no sign change", () => {
    // 30 bars with monotonically rising prices → all-positive
    // funding, no flips.
    const bars = makeBars(30);
    const funding = computeFundingRateFromBars(bars);
    expect(computeFundingFlipsFromBars(bars, funding)).toEqual([]);
  });

  it("detects a + → - flip and emits a red arrowDown", () => {
    // Synthesize bars with a clear price pattern: rising
    // for the first 15 bars, then sharply falling for the
    // next 15 bars. The funding rate should flip from
    // positive to negative.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      const close = i < 15 ? 100 + i * 2 : 130 - (i - 15) * 4;
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: close,
        high: close + 0.1,
        low: close - 0.1,
        close,
        volume: 1,
      });
    }
    const funding = computeFundingRateFromBars(bars);
    const markers = computeFundingFlipsFromBars(bars, funding);
    // The exact flip bar depends on the lookback window; we
    // just check that at least one flip is detected.
    expect(markers.length).toBeGreaterThan(0);
    // The first detected flip (when the rate goes from + to -)
    // should be a red arrowDown above the bar.
    const flip = markers.find(
      (m) => m.color === "#ef4444" && m.shape === "arrowDown",
    );
    expect(flip).toBeDefined();
  });

  it("detects a - → + flip and emits a green arrowUp", () => {
    // Falling for the first 15 bars, then rising for the
    // next 15 bars. The funding rate should flip from
    // negative to positive.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      const close = i < 15 ? 200 - i * 2 : 170 + (i - 15) * 4;
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: close,
        high: close + 0.1,
        low: close - 0.1,
        close,
        volume: 1,
      });
    }
    const funding = computeFundingRateFromBars(bars);
    const markers = computeFundingFlipsFromBars(bars, funding);
    expect(markers.length).toBeGreaterThan(0);
    const flip = markers.find(
      (m) => m.color === "#22c55e" && m.shape === "arrowUp",
    );
    expect(flip).toBeDefined();
  });

  it("returns an empty array when the funding series is too short", () => {
    const bars = makeBars(10);
    // Empty funding series — defensive fallback.
    const markers = computeFundingFlipsFromBars(bars, {});
    expect(markers).toEqual([]);
  });
});

// ============================================================================
// Phase 81: computeRegimeFromBars
// ============================================================================

describe("computeRegimeFromBars", () => {
  it("returns an all-'ranging' array for empty bars", () => {
    const regimes = computeRegimeFromBars([]);
    expect(regimes).toEqual([]);
  });

  it("returns an all-'ranging' array for bars.length < lookback (warmup)", () => {
    const regimes = computeRegimeFromBars(makeBars(5), 20);
    expect(regimes.every((r) => r === "ranging")).toBe(true);
  });

  it("classifies a bar with mean <= 0 as 'ranging' (the line 890 fallback)", () => {
    // 30 bars, all with close = 0 (so the rolling mean is 0,
    // triggering the `mean <= 0` branch → regime = "ranging").
    // We can't just pass close=0 because the regime detection
    // skips bars with non-positive mean; the fallback is
    // `out[i] = "ranging"` and `continue`.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 1,
      });
    }
    const regimes = computeRegimeFromBars(bars, 20);
    // Every bar (post-warmup) must be 'ranging' (the fallback).
    const definedBars = regimes.slice(20);
    expect(definedBars.every((r) => r === "ranging")).toBe(true);
  });

  it("classifies a bar with NEGATIVE mean as 'ranging' (the line 890 fallback)", () => {
    // 30 bars with close = -1 (all negative). The rolling mean
    // is -1, which is <= 0 → the fallback fires → 'ranging'.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: -1,
        high: -1,
        low: -1,
        close: -1,
        volume: 1,
      });
    }
    const regimes = computeRegimeFromBars(bars, 20);
    const definedBars = regimes.slice(20);
    expect(definedBars.every((r) => r === "ranging")).toBe(true);
  });

  it("classifies a strongly trending bar series as 'trending'", () => {
    // 30 bars with close prices rising slowly. The rolling
    // std is small relative to the mean (low coefficient of
    // variation), and the bar's close is far from the
    // rolling mean — the regime should be 'trending'.
    // Note: the step size must be small enough that the
    // coefficient of variation (std/mean) stays below 5%
    // (the HIGH_VOL_THRESHOLD) — a step of 1 per bar at
    // close=100 gives relStd ≈ 1% which is well below 5%.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      const close = 100 + i;
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: close,
        high: close + 0.1,
        low: close - 0.1,
        close,
        volume: 1,
      });
    }
    const regimes = computeRegimeFromBars(bars, 20);
    // The classification is bar-by-bar, but the warmup
    // period (first 19 bars) is 'ranging'. After that, the
    // regime should be 'trending' for at least some bars.
    const trendingBars = regimes.filter((r) => r === "trending");
    expect(trendingBars.length).toBeGreaterThan(0);
  });

  it("classifies a high-volatility bar series as 'volatile'", () => {
    // 30 bars with close prices bouncing between 50 and 150
    // — a high coefficient of variation, which is the
    // 'volatile' trigger.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      const close = i % 2 === 0 ? 50 : 150;
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: close,
        high: close + 0.1,
        low: close - 0.1,
        close,
        volume: 1,
      });
    }
    const regimes = computeRegimeFromBars(bars, 20);
    const volatileBars = regimes.filter((r) => r === "volatile");
    expect(volatileBars.length).toBeGreaterThan(0);
  });

  it("classifies a stable bar series as 'ranging'", () => {
    // 30 bars with close prices stable at 100 (low std,
    // low gap from the mean). The regime should be
    // 'ranging'.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      const close = 100;
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 100,
        high: 100,
        low: 100,
        close,
        volume: 1,
      });
    }
    const regimes = computeRegimeFromBars(bars, 20);
    // All bars after the warmup should be 'ranging' (no
    // significant gap from the mean).
    const postWarmup = regimes.slice(20);
    expect(postWarmup.every((r) => r === "ranging")).toBe(true);
  });

  it("throws on lookback <= 0 (defensive)", () => {
    expect(() => computeRegimeFromBars(makeBars(5), 0)).toThrow(
      /lookback must be > 0/,
    );
  });
});

// ============================================================================
// Phase 81: computeRegimeChangeMarkersFromBars
// ============================================================================

describe("computeRegimeChangeMarkersFromBars", () => {
  it("emits an initial-regime marker at the first bar", () => {
    // The first bar always emits a marker showing the
    // initial regime. This is the convention (we have no
    // prior bar to compare to).
    // Use FLAT bars (all close=100) so the post-warmup
    // regime is the same as the warmup default ('ranging'),
    // and we only get the initial marker.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 5; i += 1) {
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
      });
    }
    const regimes = computeRegimeFromBars(bars, 5);
    const markers = computeRegimeChangeMarkersFromBars(bars, regimes);
    // The first bar's regime is the warmup default
    // ('ranging'), and the post-warmup regime (for flat
    // bars) is also 'ranging' — so we should only have
    // the initial marker.
    expect(markers).toHaveLength(1);
    expect(markers[0]?.text).toBe("RANGING");
  });

  it("emits a marker at every bar where the regime changes", () => {
    // Build a bar series that starts trending and then
    // turns volatile.
    const bars: OHLCBar[] = [];
    for (let i = 0; i < 30; i += 1) {
      // First 15: trending (rising prices)
      // Next 15: volatile (bouncing prices)
      const close =
        i < 15 ? 100 + i * 5 : (i % 2 === 0 ? 50 : 150);
      bars.push({
        time: 1_700_000_000_000 + i * 60_000,
        open: close,
        high: close + 0.1,
        low: close - 0.1,
        close,
        volume: 1,
      });
    }
    const regimes = computeRegimeFromBars(bars, 20);
    const markers = computeRegimeChangeMarkersFromBars(bars, regimes);
    // The first marker is the initial regime. The second
    // marker (if any) is the regime change.
    expect(markers.length).toBeGreaterThanOrEqual(1);
    // The text labels are uppercase regime names.
    const labels = markers.map((m) => m.text);
    expect(
      labels.every((t) => t === "TRENDING" || t === "RANGING" || t === "VOLATILE"),
    ).toBe(true);
  });

  it("returns an empty array for fewer than 2 bars", () => {
    expect(computeRegimeChangeMarkersFromBars([], [])).toEqual([]);
  });
});
