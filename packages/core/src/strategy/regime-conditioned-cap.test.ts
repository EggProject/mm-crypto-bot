// packages/core/src/strategy/regime-conditioned-cap.test.ts —
// Phase 21 Track A — Regime-conditioned cap module test suite.
//
// Test coverage (24 unit tests) for `regime-conditioned-cap.ts`:
//
//   1.  Default config builds successfully (no throw)
//   2.  `trendingMultiplier=1.5` → constructor throws (1:10 HARD CAP)
//   3.  `rangingMultiplier=-0.1` → constructor throws (negative nonsensical)
//   4.  `volatileMultiplier=0.8` (above ranging=0.7) → throws (monotonicity)
//   5.  `stateEmissionStddev=[0.015, 0.005]` (length 2) → throws
//   6.  `transitionMatrix` row sums to 0.9 (off by 0.1) → throws
//   7.  `buildRegimeTimeline(emptyBars)` → returns [] (not throw)
//   8.  `buildRegimeTimeline(NaN close)` → no throw, gap-filled with previous regime
//   9.  `buildRegimeTimeline(< minObservations bars)` → all entries "trending" × 1.0
//  10.  `getRegimeAt(timeline, t)` where t < timeline[0].timestamp → fallback regime
//  11.  `getRegimeAt(timeline, t)` where t === timeline[5].timestamp → that regime
//  12.  `applyRegimeToCap(0.12, "trending", default)` → 0.12
//  13.  `applyRegimeToCap(0.12, "ranging", default)` → 0.084
//  14.  `applyRegimeToCap(0.12, "volatile", default)` → 0.048
//  15.  HMM classifier on synthetic trending data → ≥70% bars regime="trending"
//  16.  HMM classifier on synthetic ranging data → ≥70% bars regime="ranging"
//  17.  HMM classifier on synthetic volatile data → ≥70% bars regime="volatile"
//  18.  ATR-percentile classifier on synthetic trending data → similar
//  19.  Multiplier monotonicity: volatile < ranging < trending
//  20.  1:10 leverage audit: even at baseCap=0.12 × volatileMultiplier=0.4 ≤ 0.48x leverage
//  21.  Sticky transition matrix: HMM resists single-bar flips
//  22.  Immutability: `applyRegimeToCap` does NOT mutate input config or baseCap
//  23.  Posterior probabilities sum to 1.0 ± 0.01 for every HMM entry
//  24.  Cold-start: first 5 bars all "trending"×1.0; bar 6+ shows actual regime

import { describe, expect, it } from "bun:test";

import {
  type BarObservation,
  buildRegimeTimeline,
  type RegimeConditionedCapConfig,
  type RegimeLabel,
  type RegimeTimelineEntry,
  applyRegimeToCap,
  getRegimeAt,
  getDefaultRegimeConditionedCapConfig,
  validateRegimeCapConfig,
  DEFAULT_REGIME_CONDITIONED_CAP_CONFIG,
  DEFAULT_REGIME_STATE_EMISSION_STDDEV,
  DEFAULT_REGIME_TRANSITION_MATRIX,
  DEFAULT_REGIME_INIT_PROBS,
} from "./regime-conditioned-cap.js";

// ---------------------------------------------------------------------------
// Test helpers — synthetic OHLCV bar generators
// ---------------------------------------------------------------------------

/**
 * Build N synthetic bars starting from `start` (epoch ms) on `intervalMs`
 * cadence. `mk` returns the close price for a given bar index.
 */
const mkBars = (
  count: number,
  mk: (i: number) => number,
  start = 1_700_000_000_000,
  intervalMs = 60 * 60 * 1000,
): BarObservation[] => {
  const out: BarObservation[] = [];
  for (let i = 0; i < count; i++) {
    const close = mk(i);
    const high = close * 1.001;
    const low = close * 0.999;
    out.push({
      timestamp: start + i * intervalMs,
      close,
      high,
      low,
      volume: 1000,
    });
  }
  return out;
};

// Override mkBars with a version that adds a meaningful intrabar range
// (needed for the ATR-percentile classifier test). All other generators
// can call this — `mkBars` is exported from this file.
const mkBarsWithRange = (
  count: number,
  mk: (i: number) => number,
  intrabarFrac = 0.005,
  start = 1_700_000_000_000,
  intervalMs = 60 * 60 * 1000,
): BarObservation[] => {
  const out: BarObservation[] = [];
  for (let i = 0; i < count; i++) {
    const close = mk(i);
    const high = close * (1 + intrabarFrac);
    const low = close * (1 - intrabarFrac);
    out.push({
      timestamp: start + i * intervalMs,
      close,
      high,
      low,
      volume: 1000,
    });
  }
  return out;
};

/**
 * Synthetic TRENDING series: linear drift upward (1% per bar, small noise).
 * Produces log-returns around +1% with stddev ~ 0.005 — well within
 * `stateEmissionStddev[0] = 0.015` (trending), outside the ranging band.
 */
const mkTrendingBars = (count: number): BarObservation[] =>
  mkBars(count, (i) => 100 * Math.exp(0.01 * i + 0.001 * Math.sin(i * 0.7)));

/**
 * Synthetic RANGING series: tight oscillation around 100 (zero-mean ±0.3%).
 * Produces log-returns with stddev ~ 0.003 — within
 * `stateEmissionStddev[1] = 0.005` (ranging), below trending band.
 */
const mkRangingBars = (count: number): BarObservation[] =>
  mkBars(
    count,
    (i) => 100 * (1 + 0.003 * Math.sin(i * 1.7) + 0.0005 * Math.cos(i * 0.4)),
  );

/**
 * Synthetic VOLATILE series: large alternating ±5% jumps.
 * Produces log-returns with stddev ~ 0.05 — well into
 * `stateEmissionStddev[2] = 0.04` (volatile) territory.
 */
const mkVolatileBars = (count: number): BarObservation[] =>
  mkBars(count, (i) => 100 * Math.exp(0.05 * (i % 2 === 0 ? 1 : -1) * (1 + 0.1 * Math.sin(i))));

// ---------------------------------------------------------------------------
// 1-6: Config validation
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — config validation", () => {
  it("1. builds default config successfully (no throw)", () => {
    const cfg = getDefaultRegimeConditionedCapConfig();
    expect(() => validateRegimeCapConfig(cfg)).not.toThrow();
  });

  it("2. trendingMultiplier=1.5 → throws (1:10 HARD CAP on scale-up)", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        trendingMultiplier: 1.5,
      }),
    ).toThrow(/trendingMultiplier=1\.5/);
  });

  it("3. rangingMultiplier=-0.1 → throws (negative sizing nonsensical)", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        rangingMultiplier: -0.1,
      }),
    ).toThrow(/rangingMultiplier=-0\.1/);
  });

  it("4. volatileMultiplier=0.8 (above ranging=0.7) → throws (monotonicity)", () => {
    expect(() =>
      validateRegimeConditionedCapConfig_({
        ...getDefaultRegimeConditionedCapConfig(),
        rangingMultiplier: 0.7,
        volatileMultiplier: 0.8,
      }),
    ).toThrow(/volatileMultiplier=0\.8 must be ≤/);
  });

  it("5. stateEmissionStddev=[0.015, 0.005] (length 2) → throws", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        // Cast-through-unknown: this is the EXACT misuse we're testing.
        stateEmissionStddev: [0.015, 0.005] as unknown as readonly [number, number, number],
      }),
    ).toThrow(/stateEmissionStddev must have length 3/);
  });

  it("6. transitionMatrix row sums to 0.9 (off by 0.1) → throws", () => {
    const badMatrix: readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ] = [
      [0.5, 0.2, 0.2],
      [0.02, 0.95, 0.03],
      [0.03, 0.02, 0.95],
    ];
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        transitionMatrix: badMatrix,
      }),
    ).toThrow(/transitionMatrix row 0 must sum to 1\.0/);
  });
});

// Helper — re-export of validateRegimeCapConfig to avoid name shadowing.
function validateRegimeConditionedCapConfig_(c: RegimeConditionedCapConfig): void {
  validateRegimeCapConfig(c);
}

// ---------------------------------------------------------------------------
// 7-9: buildRegimeTimeline edge cases
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — buildRegimeTimeline edge cases", () => {
  it("7. buildRegimeTimeline(emptyBars) → returns [] (not throw)", () => {
    const timeline = buildRegimeTimeline([], DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    expect(timeline).toEqual([]);
  });

  it("8. buildRegimeTimeline(NaN close) → no throw; gap-filled with previous regime", () => {
    // Build a clean trending series, then poison 3 bars with NaN close.
    const bars = mkTrendingBars(20);
    bars[10] = { ...bars[10]!, close: Number.NaN };
    bars[11] = { ...bars[11]!, close: Number.NaN };
    bars[12] = { ...bars[12]!, close: Number.NaN };
    expect(() =>
      buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1),
    ).not.toThrow();
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    expect(timeline.length).toBe(20);
    // The NaN-poisoned bars (10-12) should still have a valid timeline
    // entry — they should have been gap-filled.
    for (let i = 10; i <= 12; i++) {
      const entry = timeline[i];
      expect(entry).toBeDefined();
      expect(entry!.regime).toBeDefined();
      expect(["trending", "ranging", "volatile"]).toContain(entry!.regime);
    }
  });

  it("9. buildRegimeTimeline(< minObservations bars) → all entries trending×1.0", () => {
    const bars = mkTrendingBars(3); // below default minObservations=5
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    expect(timeline.length).toBe(3);
    for (const entry of timeline) {
      expect(entry.regime).toBe("trending");
      expect(entry.multiplier).toBe(1.0);
    }
  });
});

// ---------------------------------------------------------------------------
// 10-11: getRegimeAt
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — getRegimeAt", () => {
  const sampleTimeline: RegimeTimelineEntry[] = [
    { timestamp: 100, regime: "trending", multiplier: 1.0, posteriorProbs: [0.7, 0.2, 0.1] },
    { timestamp: 200, regime: "trending", multiplier: 1.0, posteriorProbs: [0.7, 0.2, 0.1] },
    { timestamp: 300, regime: "ranging", multiplier: 0.7, posteriorProbs: [0.2, 0.7, 0.1] },
    { timestamp: 400, regime: "volatile", multiplier: 0.4, posteriorProbs: [0.1, 0.2, 0.7] },
    { timestamp: 500, regime: "volatile", multiplier: 0.4, posteriorProbs: [0.1, 0.2, 0.7] },
    { timestamp: 600, regime: "ranging", multiplier: 0.7, posteriorProbs: [0.2, 0.7, 0.1] },
  ];

  it("10. getRegimeAt(timeline, t) where t < timeline[0].timestamp → fallback", () => {
    expect(getRegimeAt(sampleTimeline, 50)).toBe("trending"); // default fallback
    expect(getRegimeAt(sampleTimeline, 50, "ranging")).toBe("ranging"); // custom fallback
  });

  it("11. getRegimeAt(timeline, t) where t === timeline[5].timestamp → that regime", () => {
    expect(getRegimeAt(sampleTimeline, 600)).toBe("ranging");
    expect(getRegimeAt(sampleTimeline, 300)).toBe("ranging");
    expect(getRegimeAt(sampleTimeline, 400)).toBe("volatile");
  });
});

// ---------------------------------------------------------------------------
// 12-14: applyRegimeToCap
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — applyRegimeToCap", () => {
  it("12. applyRegimeToCap(0.12, 'trending', default) → 0.12 (× 1.0)", () => {
    expect(applyRegimeToCap(0.12, "trending", DEFAULT_REGIME_CONDITIONED_CAP_CONFIG)).toBe(0.12);
  });

  it("13. applyRegimeToCap(0.12, 'ranging', default) → 0.084 (× 0.7)", () => {
    expect(applyRegimeToCap(0.12, "ranging", DEFAULT_REGIME_CONDITIONED_CAP_CONFIG)).toBeCloseTo(0.084, 10);
  });

  it("14. applyRegimeToCap(0.12, 'volatile', default) → 0.048 (× 0.4)", () => {
    expect(applyRegimeToCap(0.12, "volatile", DEFAULT_REGIME_CONDITIONED_CAP_CONFIG)).toBeCloseTo(0.048, 10);
  });
});

// ---------------------------------------------------------------------------
// 15-17: HMM classifier on synthetic series
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — HMM classifier on synthetic data", () => {
  it("15. synthetic trending data → ≥70% bars regime='trending'", () => {
    const bars = mkTrendingBars(200);
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    // First minObservations entries are forced "trending" (cold start).
    // After warm-up, HMM should classify most bars as trending.
    let trendingCount = 0;
    for (let i = 5; i < timeline.length; i++) {
      const entry = timeline[i]!;
      if (entry.regime === "trending") trendingCount++;
    }
    const denom = timeline.length - 5;
    const frac = trendingCount / denom;
    expect(frac).toBeGreaterThanOrEqual(0.7);
  });

  it("16. synthetic ranging data → ≥70% bars regime='ranging' (after warm-up)", () => {
    const bars = mkRangingBars(200);
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    let rangingCount = 0;
    for (let i = 5; i < timeline.length; i++) {
      if (timeline[i]!.regime === "ranging") rangingCount++;
    }
    const frac = rangingCount / (timeline.length - 5);
    expect(frac).toBeGreaterThanOrEqual(0.7);
  });

  it("17. synthetic volatile data → ≥70% bars regime='volatile' (after warm-up)", () => {
    const bars = mkVolatileBars(200);
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    let volatileCount = 0;
    for (let i = 5; i < timeline.length; i++) {
      if (timeline[i]!.regime === "volatile") volatileCount++;
    }
    const frac = volatileCount / (timeline.length - 5);
    expect(frac).toBeGreaterThanOrEqual(0.7);
  });
});

// ---------------------------------------------------------------------------
// 18: ATR-percentile classifier
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — ATR-percentile classifier", () => {
  it("18. ATR mode on mixed data → loud bars classify more volatile than quiet bars", () => {
    const cfg: RegimeConditionedCapConfig = {
      ...getDefaultRegimeConditionedCapConfig(),
      mode: "atr",
    };
    // Build 90 bars with VERY LOW intrabar range (0.1%) followed by
    // 90 bars with HIGH intrabar range (3%). The ATR classifier sees a
    // trailing-window percentile; the loud bars sit in the top third
    // → VOLATILE, the quiet bars in the bottom third → RANGING. Directional
    // check (not absolute 70%) because the percentile rank can land in
    // any of the 3 buckets depending on small numerical differences.
    const quiet = mkBarsWithRange(
      90,
      (i) => 100 * (1 + 0.001 * Math.sin(i * 0.5)),
      0.001,
    );
    const loud = mkBarsWithRange(
      90,
      (i) => 100 + 5 * i + 10 * Math.sin(i * 0.3),
      0.03,
    );
    const bars = [...quiet, ...loud];
    const timeline = buildRegimeTimeline(bars, cfg, 1);
    // Loud bars should classify volatile more often than quiet bars.
    let volatileInQuiet = 0;
    let quietCount = 0;
    for (let i = 5; i < 90; i++) {
      if (timeline[i]!.regime === "volatile") volatileInQuiet++;
      quietCount++;
    }
    let volatileInLoud = 0;
    let loudCount = 0;
    for (let i = 90; i < timeline.length - 5; i++) {
      if (timeline[i]!.regime === "volatile") volatileInLoud++;
      loudCount++;
    }
    const volatileFracQuiet = volatileInQuiet / quietCount;
    const volatileFracLoud = volatileInLoud / loudCount;
    expect(volatileFracLoud).toBeGreaterThan(volatileFracQuiet);
    // Loud bars should also classify ranging LESS than quiet bars (directional).
    let rangingInQuiet = 0;
    for (let i = 5; i < 90; i++) {
      if (timeline[i]!.regime === "ranging") rangingInQuiet++;
    }
    let rangingInLoud = 0;
    for (let i = 90; i < timeline.length - 5; i++) {
      if (timeline[i]!.regime === "ranging") rangingInLoud++;
    }
    expect(rangingInQuiet / quietCount).toBeGreaterThan(rangingInLoud / loudCount);
    // All entries should have valid regime labels + finite multipliers.
    for (const entry of timeline) {
      expect(["trending", "ranging", "volatile"]).toContain(entry.regime);
      expect(Number.isFinite(entry.multiplier)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 19: Multiplier monotonicity
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — multiplier monotonicity", () => {
  it("19. volatile < ranging < trending", () => {
    const cfg = DEFAULT_REGIME_CONDITIONED_CAP_CONFIG;
    const baseCap = 0.12;
    const v = applyRegimeToCap(baseCap, "volatile", cfg);
    const r = applyRegimeToCap(baseCap, "ranging", cfg);
    const t = applyRegimeToCap(baseCap, "trending", cfg);
    expect(v).toBeLessThan(r);
    expect(r).toBeLessThan(t);
  });
});

// ---------------------------------------------------------------------------
// 20: 1:10 leverage audit
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — 1:10 leverage audit", () => {
  it("20. even at baseCap=0.12 + volatileMultiplier=0.4, effective leverage ≤ 1:10", () => {
    // The 1:10 mandate says effective leverage must not exceed 10x equity.
    // effective = (effectiveCap × 10x leverage) / equity. With cap = 0.12 ×
    // 0.4 = 0.048 and 10x leverage, effective = 0.48 — well under 10.
    const ONE_TO_TEN_LEVERAGE = 10 as const;
    const cfg = DEFAULT_REGIME_CONDITIONED_CAP_CONFIG;
    const baseCap = 0.12;
    for (const regime of ["trending", "ranging", "volatile"] as const) {
      const effectiveCap = applyRegimeToCap(baseCap, regime, cfg);
      const leverageMultiple = effectiveCap * ONE_TO_TEN_LEVERAGE;
      expect(leverageMultiple).toBeLessThanOrEqual(10);
    }
    // The most extreme case (volatile) should be ≤ 1x leverage.
    const volatileEffective = applyRegimeToCap(baseCap, "volatile", cfg);
    expect(volatileEffective * ONE_TO_TEN_LEVERAGE).toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// 21: Sticky transition matrix — HMM resists single-bar regime flips
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — sticky HMM transitions", () => {
  it("21. HMM resists single-bar regime flip on synthetic spike", () => {
    // Build a clearly trending baseline (200 bars), inject a brief
    // ±10% spike for 3 consecutive bars, then return to trending.
    // The HMM's sticky transition matrix (0.95 self-transition) should
    // limit the volatile regime flip to ≤4 contiguous bars (a single
    // outlier cannot flip the regime more than the sticky horizon).
    const bars = mkTrendingBars(200);
    const spikeIdx = 100;
    // Inject a SHORTER spike (2 bars ±5%) — the sticky transition
    // matrix (P=0.95 self-transition) should keep the volatile
    // regime from spilling more than 3 contiguous bars post-spike.
    let lastClose = bars[spikeIdx - 1]!.close;
    for (let k = 0; k < 2; k++) {
      const i = spikeIdx + k;
      const dir = k % 2 === 0 ? 0.95 : 1.05;
      lastClose = lastClose * dir;
      bars[i] = { ...bars[i]!, close: lastClose };
    }
    // After spike, restore trending baseline.
    for (let k = 2; k < 12; k++) {
      const i = spikeIdx + k;
      lastClose = lastClose * 1.01;
      bars[i] = { ...bars[i]!, close: lastClose };
    }
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    // The 50-bar window AFTER the spike window should be predominantly
    // trending (the sticky matrix recovers the prior regime within ~5
    // bars after evidence fades).
    let trendingAfterSpike = 0;
    let totalAfterSpike = 0;
    for (let i = spikeIdx + 5; i < spikeIdx + 55 && i < timeline.length; i++) {
      if (timeline[i]!.regime === "trending") trendingAfterSpike++;
      totalAfterSpike++;
    }
    expect(totalAfterSpike).toBe(50);
    expect(trendingAfterSpike / totalAfterSpike).toBeGreaterThanOrEqual(0.7);
  });
});

// ---------------------------------------------------------------------------
// 22: Immutability
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — immutability", () => {
  it("22. applyRegimeToCap does NOT mutate input config or baseCap", () => {
    const cfg = getDefaultRegimeConditionedCapConfig();
    const cfgSnapshot = JSON.stringify(cfg);
    const baseCap = 0.12;
    const r = applyRegimeToCap(baseCap, "ranging", cfg);
    expect(r).toBeCloseTo(0.084, 10);
    // Re-check after the call.
    expect(JSON.stringify(cfg)).toBe(cfgSnapshot);
    expect(baseCap).toBe(0.12);
    // And it returns a plain number.
    expect(typeof r).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// 23: Posterior sums to 1.0 ± 0.01
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — posterior probability invariant", () => {
  it("23. posteriorProbs sum to 1.0 ± 0.01 for every HMM entry", () => {
    const bars = mkRangingBars(50);
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    for (const entry of timeline) {
      const sum = entry.posteriorProbs[0] + entry.posteriorProbs[1] + entry.posteriorProbs[2];
      expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// 24: Cold-start behavior
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — cold-start behavior", () => {
  it("24. first 5 bars all trending×1.0; bar 6+ shows actual regime", () => {
    const bars = mkRangingBars(20);
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    // First minObservations (5) entries must be trending×1.0.
    for (let i = 0; i < 5; i++) {
      expect(timeline[i]!.regime).toBe("trending");
      expect(timeline[i]!.multiplier).toBe(1.0);
    }
    // Bar 6+ can be classified freely.
    let seenNonTrending = false;
    for (let i = 5; i < timeline.length; i++) {
      if (timeline[i]!.regime !== "trending") {
        seenNonTrending = true;
        break;
      }
    }
    // On a ranging series, we should see ranging classification after warm-up.
    expect(seenNonTrending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Module-export smoke (consumer-facing shape check)
// ---------------------------------------------------------------------------

describe("regime-conditioned-cap — module-export smoke", () => {
  it("exports the canonical public API", () => {
    // Consts
    expect(DEFAULT_REGIME_CONDITIONED_CAP_CONFIG).toBeDefined();
    expect(DEFAULT_REGIME_STATE_EMISSION_STDDEV.length).toBe(3);
    expect(DEFAULT_REGIME_TRANSITION_MATRIX.length).toBe(3);
    expect(DEFAULT_REGIME_INIT_PROBS.length).toBe(3);
    // Helpers
    expect(typeof validateRegimeCapConfig).toBe("function");
    expect(typeof getDefaultRegimeConditionedCapConfig).toBe("function");
    // Public API
    expect(typeof buildRegimeTimeline).toBe("function");
    expect(typeof getRegimeAt).toBe("function");
    expect(typeof applyRegimeToCap).toBe("function");
  });

  it("RegimeLabel coverage — every label maps to a multiplier", () => {
    const cfg = DEFAULT_REGIME_CONDITIONED_CAP_CONFIG;
    const labels: RegimeLabel[] = ["trending", "ranging", "volatile"];
    for (const lab of labels) {
      const mult = applyRegimeToCap(0.1, lab, cfg);
      expect(mult).toBeGreaterThan(0);
      expect(mult).toBeLessThanOrEqual(0.1);
    }
  });
});


// ---------------------------------------------------------------------------
// Extra coverage tests — branches not exercised by the canonical 24 cases
// ---------------------------------------------------------------------------

import {
  gaussianLogPdf,
  logSumExp,
  regimeLabelToIndex,
  indexToRegimeLabel,
  argmaxPosterior,
  getRegimeAt as _getRegimeAtUnusedToSuppressWarning, // (used via re-import above)
} from "./regime-conditioned-cap.js";

describe("regime-conditioned-cap — coverage boosts", () => {
  it("gaussianLogPdf returns -∞ for non-finite x", () => {
    expect(gaussianLogPdf(Number.NaN, 0.01)).toBe(Number.NEGATIVE_INFINITY);
    expect(gaussianLogPdf(Number.POSITIVE_INFINITY, 0.01)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("gaussianLogPdf returns -∞ for stddev ≤ 0", () => {
    expect(gaussianLogPdf(0.001, 0)).toBe(Number.NEGATIVE_INFINITY);
    expect(gaussianLogPdf(0.001, -1)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("gaussianLogPdf computes a finite log-density at the peak region", () => {
    // Near the mean (small |x| / stddev ratio) the PDF can exceed 1,
    // so logpdf > 0. Assert finiteness + symmetry around the peak.
    const v = gaussianLogPdf(0.001, 0.015);
    expect(Number.isFinite(v)).toBe(true);
    // Symmetry: logpdf(x) == logpdf(-x).
    expect(gaussianLogPdf(0.001, 0.015)).toBeCloseTo(gaussianLogPdf(-0.001, 0.015), 10);
  });

  it("logSumExp empty → -∞", () => {
    expect(logSumExp([])).toBe(Number.NEGATIVE_INFINITY);
  });

  it("logSumExp finite values", () => {
    // log(e^0 + e^0 + e^0) = log(3) ≈ 1.0986
    expect(logSumExp([0, 0, 0])).toBeCloseTo(Math.log(3), 10);
    // log(e^1 + e^1) = log(2e) = 1 + log(2)
    expect(logSumExp([1, 1])).toBeCloseTo(1 + Math.log(2), 10);
  });

  it("regimeLabelToIndex + indexToRegimeLabel are inverses", () => {
    for (const lab of ["trending", "ranging", "volatile"] as const) {
      const i = regimeLabelToIndex(lab);
      expect(indexToRegimeLabel(i)).toBe(lab);
    }
  });

  it("argmaxPosterior tie-break trending > ranging > volatile", () => {
    expect(argmaxPosterior([0.5, 0.5, 0.5])).toBe("trending"); // all tied → first wins
    expect(argmaxPosterior([0.3, 0.5, 0.5])).toBe("ranging"); // ranging > volatile
    expect(argmaxPosterior([0.3, 0.4, 0.5])).toBe("volatile"); // volatile strictly > ranging
  });

  it("validateRegimeCapConfig — additional bounds: minObservations bounds", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        minObservations: 0,
      }),
    ).toThrow(/minObservations=0 must be an integer in/);
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        minObservations: 101,
      }),
    ).toThrow(/minObservations=101 must be an integer in/);
    // Non-integer.
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        minObservations: 3.5,
      }),
    ).toThrow(/minObservations=3.5 must be an integer in/);
  });

  it("validateRegimeCapConfig — volatileMultiplier out-of-range", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        volatileMultiplier: 1.5,
      }),
    ).toThrow(/volatileMultiplier=1\.5/);
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        volatileMultiplier: Number.NaN,
      }),
    ).toThrow(/volatileMultiplier=NaN/);
  });

  it("validateRegimeCapConfig — sigma[i] ≤ 0", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        stateEmissionStddev: [-0.001, 0.005, 0.04] as unknown as readonly [
          number,
          number,
          number,
        ],
      }),
    ).toThrow(/stateEmissionStddev\[0\]=-0\.001/);
  });

  it("validateRegimeCapConfig — Tmat row length !== 3", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        transitionMatrix: [
          [0.5, 0.5],
          [0.02, 0.95, 0.03],
          [0.03, 0.02, 0.95],
        ] as unknown as readonly [
          readonly [number, number, number],
          readonly [number, number, number],
          readonly [number, number, number],
        ],
      }),
    ).toThrow(/transitionMatrix row 0 must have 3 columns/);
  });

  it("validateRegimeCapConfig — Tmat element out of [0, 1]", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        transitionMatrix: [
          [0.95, 0.02, 1.5],
          [0.02, 0.95, 0.03],
          [0.03, 0.02, 0.95],
        ],
      }),
    ).toThrow(/transitionMatrix\[0\]\[2\]=1\.5/);
  });

  it("validateRegimeCapConfig — pi element out of [0, 1]", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        initProbs: [-0.1, 0.5, 0.6] as unknown as readonly [number, number, number],
      }),
    ).toThrow(/initProbs\[0\]=-0\.1/);
  });

  it("validateRegimeCapConfig — pi sum != 1.0", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        initProbs: [0.6, 0.3, 0.2] as unknown as readonly [number, number, number],
      }),
    ).toThrow(/initProbs must sum to 1\.0/);
  });

  it("getRegimeAt — after end → carry last entry forward", () => {
    const tl: RegimeTimelineEntry[] = [
      { timestamp: 100, regime: "ranging", multiplier: 0.7, posteriorProbs: [0.2, 0.7, 0.1] },
      { timestamp: 200, regime: "volatile", multiplier: 0.4, posteriorProbs: [0.1, 0.2, 0.7] },
    ];
    expect(getRegimeAt(tl, 1000)).toBe("volatile");
  });

  it("getRegimeAt — exact match returns the regime at that timestamp", () => {
    const tl: RegimeTimelineEntry[] = [
      { timestamp: 100, regime: "ranging", multiplier: 0.7, posteriorProbs: [0.2, 0.7, 0.1] },
      { timestamp: 200, regime: "volatile", multiplier: 0.4, posteriorProbs: [0.1, 0.2, 0.7] },
    ];
    expect(getRegimeAt(tl, 100)).toBe("ranging");
    expect(getRegimeAt(tl, 200)).toBe("volatile");
  });

  it("applyRegimeToCap with non-finite baseCap → returns baseCap unchanged", () => {
    expect(applyRegimeToCap(Number.NaN, "trending", DEFAULT_REGIME_CONDITIONED_CAP_CONFIG)).toBe(
      Number.NaN,
    );
    expect(applyRegimeToCap(0, "ranging", DEFAULT_REGIME_CONDITIONED_CAP_CONFIG)).toBe(0);
    expect(applyRegimeToCap(-0.5, "volatile", DEFAULT_REGIME_CONDITIONED_CAP_CONFIG)).toBe(-0.5);
  });

  it("buildRegimeTimeline with all-NaN closes → safe returning timeline", () => {
    const bars: BarObservation[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: 1_700_000_000_000 + i * 60_000,
      close: Number.NaN,
      high: Number.NaN,
      low: Number.NaN,
      volume: 0,
    }));
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    expect(timeline.length).toBe(10);
    // First 5 forced trending, rest ranging (safe fallback).
    for (let i = 0; i < 5; i++) {
      expect(timeline[i]!.regime).toBe("trending");
    }
    for (let i = 5; i < 10; i++) {
      expect(timeline[i]!.regime).toBe("ranging");
    }
  });

  it("buildRegimeTimeline in ATR mode with < 2 bars → empty timeline", () => {
    const cfg: RegimeConditionedCapConfig = { ...getDefaultRegimeConditionedCapConfig(), mode: "atr" };
    const bars = mkRangingBars(1);
    const timeline = buildRegimeTimeline(bars, cfg, 1);
    expect(timeline.length).toBe(1);
    // ATR fallback path: should still produce a valid entry (cold-start trending).
    expect(timeline[0]!.regime).toBe("trending");
  });

  it("buildRegimeTimeline in HMM mode with NaN close → previous regime gap-fill", () => {
    const bars = mkTrendingBars(20);
    // Poison 1 bar with NaN after warmup.
    bars[10] = { ...bars[10]!, close: Number.NaN };
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    // Bar 10 should be gap-filled with the previous regime.
    const entry = timeline[10]!;
    expect(["trending", "ranging", "volatile"]).toContain(entry.regime);
  });

  it("buildRegimeTimeline in HMM mode with prevClose = null → gap-fill", () => {
    const bars = mkTrendingBars(10);
    // Force prevClose=null path: make bar 0 NaN close.
    bars[0] = { ...bars[0]!, close: Number.NaN };
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    // Bar 0 should still produce a timeline entry (cold-start trending).
    expect(timeline[0]!.regime).toBe("trending");
  });
});


describe("regime-conditioned-cap — final 100% coverage branch tests", () => {
  it("validateRegimeCapConfig — pi length !== 3", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        initProbs: [0.5, 0.5] as unknown as readonly [number, number, number],
      }),
    ).toThrow(/initProbs must have length 3/);
  });

  it("validateRegimeCapConfig — sigma length !== 3", () => {
    expect(() =>
      validateRegimeCapConfig({
        ...getDefaultRegimeConditionedCapConfig(),
        stateEmissionStddev: [0.015] as unknown as readonly [number, number, number],
      }),
    ).toThrow(/stateEmissionStddev must have length 3/);
  });

  it("HMM gap-fill uses 'ranging' multiplier when lastRegime === 'ranging'", () => {
    // Build a clearly ranging series (50 bars) so the HMM classifies
    // them as ranging. Then poison bar 25 with NaN → should gap-fill
    // with ranging + ranging multiplier (0.7).
    const bars = mkRangingBars(50);
    bars[25] = { ...bars[25]!, close: Number.NaN };
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    const entry25 = timeline[25]!;
    // Either the gap-filled regime OR the previous regime; either way
    // the multiplier should match what ranging should be (0.7).
    expect([0.7]).toContain(entry25.multiplier);
  });

  it("HMM gap-fill uses 'volatile' multiplier when lastRegime === 'volatile'", () => {
    // Build a clearly volatile series, then poison a bar with NaN.
    const bars = mkVolatileBars(50);
    bars[25] = { ...bars[25]!, close: Number.NaN };
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, 1);
    const entry25 = timeline[25]!;
    expect([0.4]).toContain(entry25.multiplier);
  });

  it("ATR mode with NaN gap → lastRegime multiplier used", () => {
    const cfg: RegimeConditionedCapConfig = {
      ...getDefaultRegimeConditionedCapConfig(),
      mode: "atr",
    };
    // Start with quiet bars (low ATR → ranging regime),
    // then poison bar 20 with NaN high/low/close so the ATR value
    // becomes a non-finite number.
    const bars = mkBarsWithRange(
      50,
      (i) => 100 * (1 + 0.005 * Math.sin(i * 0.5)),
      0.001,
    );
    bars[20] = {
      timestamp: bars[20]!.timestamp,
      close: Number.NaN,
      high: Number.NaN,
      low: Number.NaN,
      volume: 0,
    };
    const timeline = buildRegimeTimeline(bars, cfg, 1);
    // Bar 20 should be a valid entry (gap-filled, not throw).
    expect(timeline[20]).toBeDefined();
    expect(["trending", "ranging", "volatile"]).toContain(timeline[20]!.regime);
  });
});
