// packages/core/src/risk/vol-targeted-sizer.test.ts — unit tests
//
// ≥10 unit tests covering:
//   1. Rolling realized vol computation correctness
//   2. Multiplier clamping (high-vol clamps to 0.25, low-vol clamps to 1.0)
//   3. 1:10 MANDATE enforcement (maxVolMultiplier validation, validateOneToTenLeverage)
//   4. Default target-vol behavior
//   5. Edge cases: zero-vol day, single-day window, all-zero returns
//   6. Determinism: same input → same output
//   7. Annualization conversion
//   8. End-to-end pipeline (computeVolTargetedSizer)

import { describe, expect, it } from "bun:test";

import {
  computeVolMultiplier,
  computeVolTargetedSizer,
  dailyLogReturns,
  DEFAULT_VOL_TARGET_CONFIG,
  ONE_TO_TEN_BASE_LEVERAGE,
  rollingRealizedDailyVol,
  runVolTargetWalkForwardValidation,
  validateOneToTenLeverage,
  type DailyOhlcv,
  type VolTargetConfig,
} from "./vol-targeted-sizer.js";

// ----------------------------------------------------------------------
// Test helpers
// ----------------------------------------------------------------------

const DAY_MS: number = 24 * 60 * 60 * 1000;

function mkCandle(daysAgo: number, close: number, dailyReturn = 0): DailyOhlcv {
  // Construct a candle with the given close, with high/low/open adjusted
  // around it for a sensible OHLCV. The return is informational only —
  // we feed close prices directly to `dailyLogReturns`.
  return {
    timestamp: 1_700_000_000_000 + daysAgo * DAY_MS,
    open: close * (1 - dailyReturn / 2),
    high: close * (1 + Math.abs(dailyReturn) / 2 + 0.005),
    low: close * (1 - Math.abs(dailyReturn) / 2 - 0.005),
    close,
    volume: 1000,
  };
}

/** Build a constant-return series of N days with the given daily return. */
function mkConstReturnSeries(n: number, dailyReturn: number): DailyOhlcv[] {
  const candles: DailyOhlcv[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    close = close * (1 + dailyReturn);
    candles.push(mkCandle(i, close, dailyReturn));
  }
  return candles;
}

/** Build a constant-volatility series (alternating ±sigma% returns). */
function mkVolSeries(n: number, dailyVol: number): DailyOhlcv[] {
  const candles: DailyOhlcv[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    // Alternating sign so the mean return is 0 (pure vol).
    const sign = i % 2 === 0 ? 1 : -1;
    close = close * (1 + sign * dailyVol);
    candles.push(mkCandle(i, close, sign * dailyVol));
  }
  return candles;
}

// ----------------------------------------------------------------------
// validateOneToTenLeverage — HARD 1:10 MANDATE
// ----------------------------------------------------------------------

describe("validateOneToTenLeverage", () => {
  it("accepts leverage=10 (the 1:10 mandate)", () => {
    expect(() => validateOneToTenLeverage(10)).not.toThrow();
  });

  it("rejects leverage=3 (Phase 7 default — SUPERSEDED by 1:10)", () => {
    expect(() => validateOneToTenLeverage(3)).toThrow(/1:10 MANDATE VIOLATION/);
  });

  it("rejects leverage=5 and leverage=7 (other rejected per user)", () => {
    expect(() => validateOneToTenLeverage(5)).toThrow(/1:10 MANDATE VIOLATION/);
    expect(() => validateOneToTenLeverage(7)).toThrow(/1:10 MANDATE VIOLATION/);
  });

  it("rejects leverage=1 (no leverage — user said 'not less either')", () => {
    expect(() => validateOneToTenLeverage(1)).toThrow(/1:10 MANDATE VIOLATION/);
  });

  it("rejects leverage=11 (above 1:10 — user said 'no more')", () => {
    expect(() => validateOneToTenLeverage(11)).toThrow(/1:10 MANDATE VIOLATION/);
  });

it("rejects NaN and Infinity", () => {
    expect(() => validateOneToTenLeverage(Number.NaN)).toThrow(/1:10 MANDATE/i);
    expect(() => validateOneToTenLeverage(Number.POSITIVE_INFINITY)).toThrow(/1:10 MANDATE/i);
  });
});

// ----------------------------------------------------------------------
// dailyLogReturns
// ----------------------------------------------------------------------

describe("dailyLogReturns", () => {
  it("returns empty array for < 2 candles", () => {
    expect(dailyLogReturns([])).toEqual([]);
    expect(dailyLogReturns([mkCandle(0, 100)])).toEqual([]);
  });

  it("matches ln(close_t / close_{t-1}) on a known series", () => {
    // 100 → 110 → 121 → 133.1 (10% per day compound)
    const candles = [mkCandle(0, 100), mkCandle(1, 110), mkCandle(2, 121), mkCandle(3, 133.1)];
    const returns = dailyLogReturns(candles);
    expect(returns.length).toBe(3);
    // ln(110/100) ≈ 0.0953
    expect(returns[0]).toBeCloseTo(Math.log(110 / 100), 10);
    expect(returns[1]).toBeCloseTo(Math.log(121 / 110), 10);
    expect(returns[2]).toBeCloseTo(Math.log(133.1 / 121), 10);
  });

  it("produces 0 returns for a constant-price series", () => {
    const candles = [mkCandle(0, 100), mkCandle(1, 100), mkCandle(2, 100), mkCandle(3, 100)];
    const returns = dailyLogReturns(candles);
    expect(returns.length).toBe(3);
    for (const r of returns) {
      expect(r).toBeCloseTo(0, 10);
    }
  });

  it("skips non-positive prices (defensive — split/adjustment events)", () => {
    // Place the bad-price candle at the START so the downstream chain
    // remains valid; the function skips returns involving that candle.
    const candles = [
      { ...mkCandle(0, 0), close: 0, open: 0, high: 0, low: 0 }, // defensive skip
      mkCandle(1, 100),
      mkCandle(2, 110),
      mkCandle(3, 121),
    ];
    const returns = dailyLogReturns(candles);
    // 4 candles → 3 returns normally; 1 skipped because prev=0 → expect 2.
    expect(returns.length).toBe(2);
    // And the first return (between the bad candle and the next) is skipped.
    expect(returns[0]).toBeCloseTo(Math.log(110 / 100), 10);
  });

  it("is deterministic (same input → same output)", () => {
    const candles = mkConstReturnSeries(30, 0.005);
    const a = dailyLogReturns(candles);
    const b = dailyLogReturns(candles);
    expect(a).toEqual(b);
  });
});

// ----------------------------------------------------------------------
// rollingRealizedDailyVol
// ----------------------------------------------------------------------

describe("rollingRealizedDailyVol", () => {
  it("returns std=0 for a single observation (n < 2)", () => {
    expect(rollingRealizedDailyVol([0.01], 5)).toEqual([0]);
  });

  it("matches sample std dev for known series", () => {
    // 10 daily returns of known values → sample std = sqrt(Σ(x-μ)²/(n-1))
    const returns = [0.01, -0.01, 0.02, -0.02, 0.015, -0.015, 0.01, -0.01, 0.005, -0.005];
    const window = 5;
    const out = rollingRealizedDailyVol(returns, window);
    expect(out.length).toBe(returns.length);
    // After the first 5, the rolling std should be the sample std of the
    // window's contents. Compute it manually for the window [0.01, -0.01, 0.02, -0.02, 0.015]:
    const windowReturns = returns.slice(0, 5);
    const mean = windowReturns.reduce((a, b) => a + b, 0) / 5;
    const variance =
      windowReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / 4; // sample std = n-1
    const expectedStd = Math.sqrt(variance);
    expect(out[4]).toBeCloseTo(expectedStd, 10);
  });

  it("throws on non-positive windowDays", () => {
    expect(() => rollingRealizedDailyVol([0.01, 0.02], 0)).toThrow();
    expect(() => rollingRealizedDailyVol([0.01, 0.02], -1)).toThrow();
    expect(() => rollingRealizedDailyVol([0.01, 0.02], 1.5)).toThrow();
  });

  it("returns empty array for empty input returns", () => {
    const out = rollingRealizedDailyVol([], 5);
    expect(out).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// computeVolMultiplier
// ----------------------------------------------------------------------

describe("computeVolMultiplier", () => {
  it("returns raw = target/realized when in [min, max]", () => {
    const r = computeVolMultiplier(0.02, 0.02, 0.25, 1.0);
    expect(r.raw).toBeCloseTo(1.0, 10);
    expect(r.clamped).toBeCloseTo(1.0, 10);
  });

  it("clamps high-vol (low multiplier) to 0.25 floor (defensive)", () => {
    // target 2%, realized 10% → raw 0.2 → below 0.25 floor → clamped to 0.25
    const r = computeVolMultiplier(0.10, 0.02, 0.25, 1.0);
    expect(r.raw).toBeCloseTo(0.2, 10);
    expect(r.clamped).toBeCloseTo(0.25, 10);
  });

  it("clamps low-vol (high multiplier) to 1.0 ceiling (1:10 MANDATE)", () => {
    // target 2%, realized 1% → raw 2.0 → above 1.0 ceiling → clamped to 1.0
    const r = computeVolMultiplier(0.01, 0.02, 0.25, 1.0);
    expect(r.raw).toBeCloseTo(2.0, 10);
    expect(r.clamped).toBeCloseTo(1.0, 10);
  });

  it("returns maxVolMultiplier for zero realized vol (defensive fallback)", () => {
    const r = computeVolMultiplier(0, 0.02, 0.25, 1.0);
    expect(r.raw).toBe(1.0);
    expect(r.clamped).toBe(1.0);
  });

  it("returns maxVolMultiplier for below-floor realized vol", () => {
    const r = computeVolMultiplier(1e-6, 0.02, 0.25, 1.0, 1e-4);
    expect(r.raw).toBe(1.0);
    expect(r.clamped).toBe(1.0);
  });

  it("throws on invalid bounds", () => {
    expect(() => computeVolMultiplier(0.02, 0.02, 0, 1.0)).toThrow();
    expect(() => computeVolMultiplier(0.02, 0.02, 1.0, 0.25)).toThrow();
    expect(() => computeVolMultiplier(0.02, 0, 0.25, 1.0)).toThrow();
  });

  it("throws on negative realizedDailyVol", () => {
    expect(() => computeVolMultiplier(-0.01, 0.02, 0.25, 1.0)).toThrow(/non-negative finite/);
  });

  it("throws on NaN targetDailyVol", () => {
    expect(() => computeVolMultiplier(0.02, Number.NaN, 0.25, 1.0)).toThrow(/positive finite/);
  });

  it("throws on non-finite minVolMultiplier", () => {
    expect(() => computeVolMultiplier(0.02, 0.02, Number.POSITIVE_INFINITY, 1.0)).toThrow();
  });

  it("throws on non-finite maxVolMultiplier", () => {
    expect(() => computeVolMultiplier(0.02, 0.02, 0.25, Number.NaN)).toThrow();
  });

  it("throws on minVolMultiplier <= 0", () => {
    expect(() => computeVolMultiplier(0.02, 0.02, -0.1, 1.0)).toThrow();
  });

  it("throws on minVolMultiplier > maxVolMultiplier", () => {
    expect(() => computeVolMultiplier(0.02, 0.02, 1.5, 1.0)).toThrow();
  });
});

// ----------------------------------------------------------------------
// computeVolTargetedSizer — end-to-end pipeline
// ----------------------------------------------------------------------

describe("computeVolTargetedSizer", () => {
  it("throws on non-positive baseNotional", () => {
    const candles = mkConstReturnSeries(60, 0.005);
    expect(() => computeVolTargetedSizer(candles, 0)).toThrow(/positive finite/);
    expect(() => computeVolTargetedSizer(candles, -1000)).toThrow(/positive finite/);
    expect(() => computeVolTargetedSizer(candles, Number.NaN)).toThrow(/positive finite/);
  });

  it("runs end-to-end on a 60-day series and emits one point per day", () => {
    const candles = mkConstReturnSeries(60, 0.005);
    const result = computeVolTargetedSizer(candles, 2000);
    expect(result.dailySeries.length).toBe(60);
    expect(result.config).toEqual(DEFAULT_VOL_TARGET_CONFIG);
    expect(result.effectiveBaseLeverage).toBe(ONE_TO_TEN_BASE_LEVERAGE);
  });

  it("effective leverage stays in [2.5, 10] across the series (1:10 mandate)", () => {
    const candles = mkConstReturnSeries(120, 0.01);
    const result = computeVolTargetedSizer(candles, 2000);
    for (const p of result.dailySeries) {
      expect(p.effectiveLeverage).toBeGreaterThanOrEqual(2.5 - 1e-9);
      expect(p.effectiveLeverage).toBeLessThanOrEqual(10.0 + 1e-9);
    }
  });

  it("throws when maxVolMultiplier > 1.0 (1:10 mandate violation)", () => {
    const candles = mkConstReturnSeries(60, 0.005);
    const badConfig: VolTargetConfig = { ...DEFAULT_VOL_TARGET_CONFIG, maxVolMultiplier: 2.0 };
    expect(() => computeVolTargetedSizer(candles, 2000, badConfig)).toThrow(/1:10 MANDATE/);
  });

  it("the first day has realizedVol=0 → multiplier = maxVolMultiplier (defensive)", () => {
    const candles = mkConstReturnSeries(60, 0.005);
    const result = computeVolTargetedSizer(candles, 2000);
    const firstPoint = result.dailySeries[0]!;
    expect(firstPoint.realizedDailyVol).toBe(0);
    expect(firstPoint.clampedVolMultiplier).toBe(1.0);
    expect(firstPoint.effectiveLeverage).toBe(10);
  });

  it("lowerClampFraction > 0 when realized vol consistently above target", () => {
    // 10% daily vol vs 2% target → raw = 0.2 → clamped to 0.25 floor.
    const candles = mkVolSeries(120, 0.10);
    const result = computeVolTargetedSizer(candles, 2000);
    expect(result.lowerClampFraction).toBeGreaterThan(0);
    // After the first 2 warmup days (realizedVol=0 -> max=1.0), the average
    // settles close to 0.25 (the floor). Exact: (2 * 1.0 + 118 * 0.25)/120 = 0.2625.
    expect(result.avgVolMultiplier).toBeGreaterThan(0.25);
    expect(result.avgVolMultiplier).toBeLessThan(0.30);
  });

  it("upperClampFraction > 0 when realized vol consistently below target", () => {
    // 0.5% daily vol vs 2% target → raw ≈ 4 → clamped to 1.0 ceiling.
    const candles = mkVolSeries(120, 0.005);
    const result = computeVolTargetedSizer(candles, 2000);
    expect(result.upperClampFraction).toBeGreaterThan(0);
    // avg over the series = (first 30 days at upper clamp 1.0) + (rest also at upper clamp 1.0)
    expect(result.avgVolMultiplier).toBeCloseTo(1.0, 2);
  });

  it("avgVolMultiplier is roughly target/realized in the middle regime", () => {
    // 3% daily vol vs 2% target → raw = 0.667 → in middle band (0.25, 1.0)
    const candles = mkVolSeries(120, 0.03);
    const result = computeVolTargetedSizer(candles, 2000);
    // Skip day 0 (no prior realized vol → max).
    const inWindow = result.dailySeries.slice(30); // after warmup
    expect(inWindow.length).toBe(90);
    for (const p of inWindow) {
      expect(p.clampedVolMultiplier).toBeGreaterThan(0.25);
      expect(p.clampedVolMultiplier).toBeLessThan(1.0);
    }
  });

  it("is deterministic (same input → same output)", () => {
    const candles = mkConstReturnSeries(60, 0.005);
    const a = computeVolTargetedSizer(candles, 2000);
    const b = computeVolTargetedSizer(candles, 2000);
    expect(a.avgVolMultiplier).toBe(b.avgVolMultiplier);
    expect(a.lowerClampFraction).toBe(b.lowerClampFraction);
    expect(a.upperClampFraction).toBe(b.upperClampFraction);
  });

  it("avgRealizedAnnualizedVol = avgRealizedDailyVol × √365", () => {
    const candles = mkVolSeries(120, 0.03);
    const result = computeVolTargetedSizer(candles, 2000);
    expect(result.avgRealizedAnnualizedVol).toBeCloseTo(
      result.avgRealizedDailyVol * Math.sqrt(365),
      8,
    );
  });

  it("sums of clamp fractions + middle fraction = 1.0 (full coverage)", () => {
    const candles = mkVolSeries(120, 0.03);
    const result = computeVolTargetedSizer(candles, 2000);
    const total =
      result.lowerClampFraction + result.upperClampFraction + result.middleFraction;
    expect(total).toBeCloseTo(1.0, 6);
  });
});

// ----------------------------------------------------------------------
// runVolTargetWalkForwardValidation
// ----------------------------------------------------------------------

describe("runVolTargetWalkForwardValidation", () => {
  it("throws when trainDays/testDays/stepDays are non-positive", () => {
    const candles = mkConstReturnSeries(730, 0.003);
    expect(() => runVolTargetWalkForwardValidation(candles, 0, 30, 30)).toThrow(/positive day values/);
    expect(() => runVolTargetWalkForwardValidation(candles, 180, -1, 30)).toThrow(/positive day values/);
    expect(() => runVolTargetWalkForwardValidation(candles, 180, 30, 0)).toThrow(/positive day values/);
  });

  it("produces non-empty windows for a sufficiently long series", () => {
    // 2 years of daily candles ≈ 730 days → fits multiple 180/30 windows.
    const candles = mkConstReturnSeries(730, 0.003);
    const wf = runVolTargetWalkForwardValidation(candles, 180, 30, 30);
    expect(wf.windows.length).toBeGreaterThan(0);
    for (const w of wf.windows) {
      expect(w.trainAvgMultiplier).toBeGreaterThan(0);
      expect(w.testAvgMultiplier).toBe(w.trainAvgMultiplier); // frozen
      expect(w.testEnd).toBeGreaterThan(w.testStart);
      expect(w.trainEnd).toBe(w.testStart);
    }
  });

  it("throws on empty input", () => {
    expect(() => runVolTargetWalkForwardValidation([], 30, 7, 7)).toThrow();
  });

  it("throws when no non-empty windows fit", () => {
    const candles = mkConstReturnSeries(30, 0.005);
    expect(() => runVolTargetWalkForwardValidation(candles, 30, 7, 7)).toThrow();
  });

  it("frozen train→test multiplier: trainAvg == testAvg per window", () => {
    const candles = mkVolSeries(730, 0.02);
    const wf = runVolTargetWalkForwardValidation(candles, 180, 30, 30);
    for (const w of wf.windows) {
      expect(w.trainAvgMultiplier).toBe(w.testAvgMultiplier);
    }
  });
});

// ----------------------------------------------------------------------
// ONE_TO_TEN_BASE_LEVERAGE constant
// ----------------------------------------------------------------------

describe("ONE_TO_TEN_BASE_LEVERAGE", () => {
  it("is exactly 10 (the 1:10 mandate)", () => {
    expect(ONE_TO_TEN_BASE_LEVERAGE).toBe(10);
  });
});

// ----------------------------------------------------------------------
// DEFAULT_VOL_TARGET_CONFIG — sanity
// ----------------------------------------------------------------------

describe("DEFAULT_VOL_TARGET_CONFIG", () => {
  it("maxVolMultiplier = 1.0 (1:10 MANDATE: cannot lever up above base)", () => {
    expect(DEFAULT_VOL_TARGET_CONFIG.maxVolMultiplier).toBe(1.0);
  });

  it("minVolMultiplier = 0.25 (defensive floor for 1:10 × 0.25 = 2.5× effective)", () => {
    expect(DEFAULT_VOL_TARGET_CONFIG.minVolMultiplier).toBe(0.25);
  });

  it("targetDailyVol = 0.02 (2% daily ≈ 38% annualized, matching brief)", () => {
    expect(DEFAULT_VOL_TARGET_CONFIG.targetDailyVol).toBe(0.02);
  });

  it("annualizationFactor = √365 for crypto (BTC Oak convention)", () => {
    expect(DEFAULT_VOL_TARGET_CONFIG.annualizationFactor).toBeCloseTo(Math.sqrt(365), 10);
  });
});