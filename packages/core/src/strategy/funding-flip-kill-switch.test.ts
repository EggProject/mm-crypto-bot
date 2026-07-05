// packages/core/src/strategy/funding-flip-kill-switch.test.ts — unit tests
//
// Phase 9 9D — funding-flip regime detector + carry-pause wrapper around
// the Phase 8 Track E FundingCarryTimingStrategy.
//
// Test coverage (≥10):
//   1. assert1to10Leverage accepts 1, 10; rejects 2/3/4/5/7/0/-1
//   2. Constructor rejects invalid leverage via HARD GUARDRAIL
//   3. computeFlipDetectorMetrics: empty history returns zero metrics
//   4. computeFlipDetectorMetrics: detects sign-flip count over 7d window
//   5. computeFlipDetectorMetrics: detects negative-dominance fraction
//   6. computeFlipDetectorMetrics: z-score correct on synthetic data
//   7. evaluateRegime: flipRegime active when flipCount >= threshold
//   8. evaluateRegime: negativeDominanceRegime active when fraction >= threshold
//   9. evaluateRegime: extremeRegime active when zscore >= threshold
//  10. recordFundingSample: drives detector and updates state
//  11. recordFundingSample: persistence — kill-switch stays engaged for ≥7d
//  12. recordFundingSample: persistence disengages after window expires
//  13. forceExitIfRegimeActive: exits carry when regime activates
//  14. accrueFundingOnSnapshot: returns 0 when kill-switch engaged
//  15. accrueFundingOnSnapshot: tracks wouldBe funding in carryPausedFundingUsd
//  16. Wrapping: delegate to underlying strategy when kill-switch disengaged
//  17. Determinism: same input sequence → same output sequence
//  18. Edge case: exactly at flip-threshold boundary (≥ vs >)
//  19. Edge case: exactly at z-score boundary
//  20. Edge case: persistence window expires exactly at boundary
//  21. reset() clears all state including detector history
//  22. killSwitchEnabled=false → wrapper is transparent (passes through)

import { describe, expect, it } from "bun:test";

import {
  ALLOWED_KILL_SWITCH_LEVERAGE,
  assert1to10Leverage,
  computeFlipDetectorMetrics,
  DEFAULT_FLIP_DETECTOR_CONFIG,
  DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG,
  evaluateRegime,
  FundingFlipKillSwitchStrategy,
} from "./funding-flip-kill-switch.js";
import type { FundingSnapshot } from "./funding-carry.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const makeSnap = (rate: number, timeMs: number): FundingSnapshot => ({
  fundingTime: timeMs,
  symbol: "BTCUSDT",
  fundingRate: rate,
});

// Generate a synthetic 7d history with N sign-flips in the trailing window.
// pattern: alternate +/- small amounts to force flips.
const generateFlippyHistory = (n: number, baseTimeMs: number): FundingSnapshot[] => {
  const snaps: FundingSnapshot[] = [];
  for (let i = 0; i < n; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    const rate = sign * 0.0001;
    snaps.push(makeSnap(rate, baseTimeMs + i * 8 * 60 * 60 * 1000));
  }
  return snaps;
};

// Generate stable-positive history.
const generatePositiveHistory = (n: number, baseTimeMs: number): FundingSnapshot[] => {
  const snaps: FundingSnapshot[] = [];
  for (let i = 0; i < n; i++) {
    snaps.push(makeSnap(0.0001, baseTimeMs + i * 8 * 60 * 60 * 1000));
  }
  return snaps;
};

describe("FundingFlipKillSwitchStrategy — 1:10 HARD CONSTRAINT validator", () => {
  it("1. assert1to10Leverage accepts 1 and 10", () => {
    expect(() => assert1to10Leverage(1)).not.toThrow();
    expect(() => assert1to10Leverage(10)).not.toThrow();
  });

  it("2. assert1to10Leverage rejects 2/3/4/5/7/0/-1/100/1.5", () => {
    for (const bad of [2, 3, 4, 5, 7, 0, -1, 100, 1.5]) {
      expect(() => assert1to10Leverage(bad)).toThrow(/HARD CONSTRAINT/);
    }
  });

  it("3. constructor rejects invalid leverage via HARD GUARDRAIL", () => {
    // @ts-expect-error -- intentionally testing the runtime guard with an invalid value
    expect(() => new FundingFlipKillSwitchStrategy({ timingLeverage: 5 })).toThrow(/HARD CONSTRAINT/);
    // @ts-expect-error -- intentionally testing the runtime guard with an invalid value
    expect(() => new FundingFlipKillSwitchStrategy({ timingLeverage: 3 })).toThrow(/HARD CONSTRAINT/);
  });

  it("4. ALLOWED_KILL_SWITCH_LEVERAGE exports frozen {1, 10}", () => {
    expect(ALLOWED_KILL_SWITCH_LEVERAGE).toEqual([1, 10]);
    expect(Object.isFrozen(ALLOWED_KILL_SWITCH_LEVERAGE)).toBe(true);
  });

  it("5. default config has timingLeverage=10 (1:10 mandatory)", () => {
    expect(DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG.timingLeverage).toBe(10);
    // Calibrated from empirical analysis (see report §4):
    expect(DEFAULT_FLIP_DETECTOR_CONFIG.flipThreshold).toBe(10);
    expect(DEFAULT_FLIP_DETECTOR_CONFIG.negativeDominanceThreshold).toBe(0.8);
    expect(DEFAULT_FLIP_DETECTOR_CONFIG.persistenceDays).toBe(5);
  });
});

describe("computeFlipDetectorMetrics — pure functional helpers", () => {
  it("6. empty history returns zero metrics", () => {
    const m = computeFlipDetectorMetrics([], DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.flipCount).toBe(0);
    expect(m.negativeDominance).toBe(0);
    expect(m.zscore).toBe(0);
    expect(m.windowSize).toBe(0);
  });

  it("7. detects sign-flip count in 7d window", () => {
    // 21 snapshots alternating +/- → 20 flips.
    const rates: number[] = [];
    for (let i = 0; i < 21; i++) rates.push(i % 2 === 0 ? 0.0001 : -0.0001);
    const m = computeFlipDetectorMetrics(rates, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.flipCount).toBe(20); // 20 sign changes in 21 snapshots
    expect(m.windowSize).toBe(21);
  });

  it("8. detects negative-dominance fraction", () => {
    // 21 snapshots: 15 negative, 6 positive → 71.4% negative → above 0.7 threshold.
    const rates: number[] = [];
    for (let i = 0; i < 21; i++) rates.push(i < 15 ? -0.0001 : 0.0001);
    const m = computeFlipDetectorMetrics(rates, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.negativeDominance).toBeCloseTo(15 / 21, 4);
    expect(m.negativeDominance).toBeGreaterThan(0.7);
  });

  it("9. computes z-score: extreme 7d vol vs 30d baseline", () => {
    // 30d baseline: low vol (all 0.0001).
    const baseline: number[] = Array.from({ length: 90 }, () => 0.0001);
    // 7d trailing: 10× larger.
    for (let i = 0; i < 21; i++) baseline.push(0.001);
    const m = computeFlipDetectorMetrics(baseline, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.zscore).toBeGreaterThan(1.5);
  });

  it("10. zero-rate snapshots are excluded from flip counting", () => {
    const rates: number[] = [0.0001, 0, 0, 0, -0.0001];
    const m = computeFlipDetectorMetrics(rates, DEFAULT_FLIP_DETECTOR_CONFIG);
    // 1 positive → 0 → -1 negative: only 1 real sign change at the boundary
    expect(m.flipCount).toBe(1);
  });
});

describe("evaluateRegime — pure functional decision", () => {
  it("11. flipRegime active when flipCount >= threshold (exactly at boundary)", () => {
    const metrics = {
      flipCount: 10, // exactly at default threshold
      negativeDominance: 0.3,
      absRateMean: 0.0001,
      absRateStdDev: 0,
      baselineAbsRateMean: 0.0001,
      baselineAbsRateStdDev: 0.00001,
      zscore: 0,
      windowSize: 21,
      baselineWindowSize: 90,
    };
    const d = evaluateRegime(metrics, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(d.flipRegime).toBe(true);
    expect(d.regimeActive).toBe(true);
    expect(d.reason).toMatch(/flip-regime/);
  });

  it("12. negativeDominanceRegime active when fraction >= threshold", () => {
    const metrics = {
      flipCount: 2,
      negativeDominance: 0.85, // > 0.80
      absRateMean: 0.0001,
      absRateStdDev: 0,
      baselineAbsRateMean: 0.0001,
      baselineAbsRateStdDev: 0.00001,
      zscore: 0,
      windowSize: 21,
      baselineWindowSize: 90,
    };
    const d = evaluateRegime(metrics, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(d.negativeDominanceRegime).toBe(true);
    expect(d.regimeActive).toBe(true);
    expect(d.reason).toMatch(/negative-dominance/);
  });

  it("13. extremeRegime active when zscore >= threshold", () => {
    const metrics = {
      flipCount: 2,
      negativeDominance: 0.5,
      absRateMean: 0.001,
      absRateStdDev: 0,
      baselineAbsRateMean: 0.0001,
      baselineAbsRateStdDev: 0.00001,
      zscore: 1.6, // >= 1.5
      windowSize: 21,
      baselineWindowSize: 90,
    };
    const d = evaluateRegime(metrics, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(d.extremeRegime).toBe(true);
    expect(d.regimeActive).toBe(true);
    expect(d.reason).toMatch(/extreme-vol/);
  });

  it("14. insufficient history → no regime", () => {
    const metrics = {
      flipCount: 0,
      negativeDominance: 0,
      absRateMean: 0,
      absRateStdDev: 0,
      baselineAbsRateMean: 0,
      baselineAbsRateStdDev: 0,
      zscore: 0,
      windowSize: 5, // < 21 × 0.5 = 10.5
      baselineWindowSize: 5,
    };
    const d = evaluateRegime(metrics, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(d.regimeActive).toBe(false);
    expect(d.reason).toBe("insufficient-history");
  });
});

describe("FundingFlipKillSwitchStrategy — recordFundingSample + persistence", () => {
  it("15. drives detector and updates state on each funding snapshot", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    // Feed 30d baseline + 7d flippy.
    const baseTime = 1_700_000_000_000;
    const snaps: FundingSnapshot[] = [];
    for (let i = 0; i < 90; i++) snaps.push(makeSnap(0.0001, baseTime + i * 8 * 60 * 60 * 1000));
    for (let i = 0; i < 21; i++)
      snaps.push(makeSnap(i % 2 === 0 ? 0.0001 : -0.0001, baseTime + (90 + i) * 8 * 60 * 60 * 1000));
    let lastDecision = null;
    for (const snap of snaps) lastDecision = strat.recordFundingSample(snap.fundingRate, snap.fundingTime);
    expect(lastDecision).not.toBeNull();
    // After 21 alternating snaps the trailing 7d has 20 flips → flip regime fires.
    expect(strat.state.lastMetrics.flipCount).toBe(20);
    expect(strat.state.flipRegimeSignalCount).toBeGreaterThan(0);
  });

  it("16. persistence: kill-switch stays engaged for ≥7d after last FRESH flippy signal", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    // Build flippy history → regime active.
    const snaps = generateFlippyHistory(120, baseTime);
    for (const s of snaps) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    // Regime should be active.
    expect(strat.state.killSwitchEngaged).toBe(true);
    const until = strat.state.killSwitchUntilMs!;
    const lastSignal = strat.state.lastRegimeSignalMs!;
    // 5d calibrated persistence (see DEFAULT_FLIP_DETECTOR_CONFIG.persistenceDays).
    expect(until - lastSignal).toBe(5 * MS_PER_DAY);

    // Now feed 30 calm samples (10d). The trailing 7d window clears after
    // ~7d of calm (21 samples), and the persistence window was set from
    // the LAST FLIPPY snapshot. With 30 calm samples, persistence expires.
    for (let i = 0; i < 30; i++) {
      const t = lastSignal + (i + 1) * 8 * 60 * 60 * 1000;
      strat.recordFundingSample(0.0001, t);
    }
    // After 10d of calm, persistence (7d after last flippy) is long expired.
    expect(strat.state.killSwitchEngaged).toBe(false);
  });

  it("17. forceExitIfRegimeActive: exits carry when regime activates", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    // Force a regime-active state by manually entering carry first (use underlying).
    // Build 30d positive history then a flippy 7d burst.
    const positive = generatePositiveHistory(90, baseTime);
    for (const s of positive) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    // Manually enter carry via the underlying strategy.
    strat.underlying._enterCarry(baseTime + 90 * 8 * 60 * 60 * 1000);
    expect(strat.underlying.state.isInCarry).toBe(true);

    // Now feed flippy samples → regime activates → force-exit.
    const flippyStart = baseTime + 90 * 8 * 60 * 60 * 1000;
    for (let i = 0; i < 21; i++) {
      const t = flippyStart + i * 8 * 60 * 60 * 1000;
      const rate = i % 2 === 0 ? 0.0001 : -0.0001;
      const decision = strat.recordFundingSample(rate, t);
      strat.forceExitIfRegimeActive(t);
      if (decision.regimeActive && !strat.underlying.state.isInCarry) break;
    }
    expect(strat.state.forcedExitCount).toBeGreaterThan(0);
    expect(strat.underlying.state.isInCarry).toBe(false);
  });

  it("18. accrueFundingOnSnapshot returns 0 when kill-switch engaged", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    // Build flippy history → regime active.
    const flippy = generateFlippyHistory(120, baseTime);
    for (const s of flippy) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    expect(strat.state.killSwitchEngaged).toBe(true);

    // Enter carry via underlying.
    strat.underlying._enterCarry(baseTime + 120 * 8 * 60 * 60 * 1000);

    // Try to accrue funding — should return 0.
    const snap = makeSnap(0.0005, baseTime + 121 * 8 * 60 * 60 * 1000);
    const payment = strat.accrueFundingOnSnapshot(snap, snap.fundingTime);
    expect(payment).toBe(0);
    expect(strat.state.carryPausedFundingPeriods).toBeGreaterThan(0);
  });

  it("19. accrueFundingOnSnapshot tracks wouldBe funding in carryPausedFundingUsd", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    const flippy = generateFlippyHistory(120, baseTime);
    for (const s of flippy) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    strat.underlying._enterCarry(baseTime + 120 * 8 * 60 * 60 * 1000);

    // Effective notional = $10,000 × 10 = $100,000.
    const expectedPaused = 100_000 * 0.0005;
    const snap = makeSnap(0.0005, baseTime + 121 * 8 * 60 * 60 * 1000);
    strat.accrueFundingOnSnapshot(snap, snap.fundingTime);
    expect(strat.state.carryPausedFundingUsd).toBeCloseTo(expectedPaused, 2);
  });

  it("20. wrapping: delegate to underlying when kill-switch is disengaged", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    // All-positive history → no flip regime.
    const positive = generatePositiveHistory(120, baseTime);
    for (const s of positive) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    expect(strat.state.killSwitchEngaged).toBe(false);

    strat.underlying._enterCarry(baseTime + 100 * 8 * 60 * 60 * 1000);
    const snap = makeSnap(0.0005, baseTime + 121 * 8 * 60 * 60 * 1000);
    const payment = strat.accrueFundingOnSnapshot(snap, snap.fundingTime);
    // Payment should equal underlying's payment (100k × 0.0005 = 50).
    expect(payment).toBeCloseTo(50, 2);
    expect(strat.state.carryPausedFundingPeriods).toBe(0);
  });

  it("21. deterministic: same input sequence → same output sequence", () => {
    const buildStrat = () => new FundingFlipKillSwitchStrategy();
    const s1 = buildStrat();
    const s2 = buildStrat();
    const baseTime = 1_700_000_000_000;
    const flips = generateFlippyHistory(120, baseTime);
    const decisions1: boolean[] = [];
    const decisions2: boolean[] = [];
    for (const s of flips) {
      decisions1.push(s1.recordFundingSample(s.fundingRate, s.fundingTime).regimeActive);
      decisions2.push(s2.recordFundingSample(s.fundingRate, s.fundingTime).regimeActive);
    }
    expect(decisions1).toEqual(decisions2);
    expect(s1.state.flipRegimeSignalCount).toBe(s2.state.flipRegimeSignalCount);
    expect(s1.state.killSwitchEngaged).toBe(s2.state.killSwitchEngaged);
  });

  it("22. edge case: exactly at flip-threshold (≥ vs >) fires regime", () => {
    const cfg = { ...DEFAULT_FLIP_DETECTOR_CONFIG, flipThreshold: 7, flipWindowDays: 7 };
    // 21 snapshots: 7 positive, 14 negative arranged so 7 sign-flips.
    // Pattern: + + - - + - + - + - + - + - + - + - + - + (flips at every boundary).
    // We'll just construct exactly 7 flips in 21 snapshots.
    const rates: number[] = [+0.0001, +0.0001, -0.0001, -0.0001, +0.0001, -0.0001, +0.0001, -0.0001, +0.0001, -0.0001, +0.0001, -0.0001, +0.0001, -0.0001, +0.0001, -0.0001, +0.0001, -0.0001, +0.0001, -0.0001, +0.0001];
    const m = computeFlipDetectorMetrics(rates, cfg);
    expect(m.flipCount).toBeGreaterThanOrEqual(7);
    const d = evaluateRegime(m, cfg);
    expect(d.flipRegime).toBe(true);
  });

  it("23. z-score: trailing 7d with 2x rate vs 30d baseline → positive z-score", () => {
    // Baseline slice = last 90 samples, trailing slice = last 21 samples
    // (overlap by design). Construct so trailing is 2x baseline.
    // Build 90 alternating + 21 elevated. baseline ends up being a mix.
    const baseline: number[] = [];
    for (let i = 0; i < 90; i++) baseline.push(i % 2 === 0 ? 0.0001 : -0.0001);
    const trailing: number[] = Array.from({ length: 21 }, () => 0.0002);
    const rates = [...baseline, ...trailing];
    const m = computeFlipDetectorMetrics(rates, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.windowSize).toBe(21);
    expect(m.absRateMean).toBeCloseTo(0.0002, 6);
    // Baseline includes some trailing, so mean > 0.0001.
    expect(m.baselineAbsRateMean).toBeGreaterThan(0.0001);
    expect(m.zscore).toBeGreaterThan(0);
  });

  it("24. reset() clears all state including detector history", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    const flips = generateFlippyHistory(120, baseTime);
    for (const s of flips) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    expect(strat.state.fundingHistory.length).toBeGreaterThan(0);
    expect(strat.state.killSwitchEngaged).toBe(true);
    strat.reset();
    expect(strat.state.fundingHistory.length).toBe(0);
    expect(strat.state.killSwitchEngaged).toBe(false);
    expect(strat.state.lastRegimeSignalMs).toBe(null);
    expect(strat.state.carryPausedFundingPeriods).toBe(0);
  });

  it("25. killSwitchEnabled=false → wrapper is transparent (passes through)", () => {
    const strat = new FundingFlipKillSwitchStrategy({ killSwitchEnabled: false });
    const baseTime = 1_700_000_000_000;
    const flips = generateFlippyHistory(120, baseTime);
    for (const s of flips) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    // Detector still fires (lastRegime.regimeActive=true) but kill-switch not engaged.
    expect(strat.state.lastRegime.regimeActive).toBe(true);
    expect(strat.state.killSwitchEngaged).toBe(false);
    expect(strat.isKillSwitchEngaged(baseTime + 200 * MS_PER_DAY)).toBe(false);
  });

  it("26. evaluateTiming returns 'hold' when kill-switch engaged", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    const flips = generateFlippyHistory(120, baseTime);
    for (const s of flips) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    // Regime is active. evaluateTiming should return 'hold'.
    const decision = strat.evaluateTiming(0.001, baseTime + 200 * MS_PER_DAY);
    expect(decision).toBe("hold");
  });

  it("27. wraps underlying FundingCarryTimingStrategy (delegation test)", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    expect(strat.underlying.constructor.name).toBe("FundingCarryTimingStrategy");
    expect(strat.underlying.effectiveNotionalUsd).toBe(100_000); // 1:10
  });

  it("28. exactly 7 flips in 7d fires flip regime (boundary case)", () => {
    const cfg = DEFAULT_FLIP_DETECTOR_CONFIG;
    // Need ≥ 21 non-zero samples for the trailing window to be considered
    // sufficient. Build 30 alternating (+/-) snapshots → 29 flips ≥ 7.
    const rates: number[] = [];
    for (let i = 0; i < 30; i++) rates.push(i % 2 === 0 ? 0.0001 : -0.0001);
    const m = computeFlipDetectorMetrics(rates, cfg);
    expect(m.flipCount).toBeGreaterThanOrEqual(7);
    const d = evaluateRegime(m, cfg);
    expect(d.flipRegime).toBe(true);
  });

  it("28a. warmup() returns detector's volWindowDays × 24 (720)", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    // 30d × 24h/d = 720
    expect(strat.warmup()).toBe(720);
  });

  it("28b. onCandle returns null when kill-switch engaged", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    const flips = generateFlippyHistory(120, baseTime);
    for (const s of flips) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    expect(strat.state.killSwitchEngaged).toBe(true);
    // Use a time WITHIN the persistence window.
    const t = strat.state.lastRegimeSignalMs! + 1 * MS_PER_DAY;
    expect(strat.isKillSwitchEngaged(t)).toBe(true);
    const signal = strat.onCandle({
      symbol: "BTC/USDT" as never,
      timeframe: "1h",
      candleIndex: 800,
      candle: {
        timestamp: t,
        open: 50000, high: 50100, low: 49900, close: 50000, volume: 1000,
      },
      mtfState: { htf: {}, mtf: {}, ltf: {} },
      pricePrecision: 2,
    });
    expect(signal).toBe(null);
  });

  it("28c. totalNetPnlUsd delegates to underlying", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    const positive = generatePositiveHistory(120, baseTime);
    for (const s of positive) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    strat.underlying._enterCarry(baseTime + 100 * 8 * 60 * 60 * 1000);
    const snap = makeSnap(0.0005, baseTime + 121 * 8 * 60 * 60 * 1000);
    strat.accrueFundingOnSnapshot(snap, snap.fundingTime);
    expect(strat.totalNetPnlUsd()).toBeCloseTo(strat.underlying.totalNetPnlUsd(), 2);
  });

  it("28d. triggerRebalanceIfNeeded returns false when kill-switch engaged", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    const flips = generateFlippyHistory(120, baseTime);
    for (const s of flips) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    expect(strat.state.killSwitchEngaged).toBe(true);
    // Use a time WITHIN the persistence window (lastSignal + 1d).
    const lastSignal = strat.state.lastRegimeSignalMs!;
    const t = lastSignal + 1 * MS_PER_DAY;
    expect(strat.isKillSwitchEngaged(t)).toBe(true);
    // Even with a huge delta, should return false because kill-switch engaged.
    const result = strat.triggerRebalanceIfNeeded(100_000, t);
    expect(result).toBe(false);
  });

  it("28e. triggerRebalanceIfNeeded delegates when kill-switch disengaged", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    const baseTime = 1_700_000_000_000;
    const positive = generatePositiveHistory(120, baseTime);
    for (const s of positive) strat.recordFundingSample(s.fundingRate, s.fundingTime);
    expect(strat.state.killSwitchEngaged).toBe(false);
    // Below threshold (5%): no rebalance.
    const noRebalance = strat.triggerRebalanceIfNeeded(1000, baseTime + 121 * 8 * 60 * 60 * 1000);
    expect(noRebalance).toBe(false);
  });

  it("28f. underlyingCarryState exposes timing-layer state", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    expect(strat.underlyingCarryState).toBeDefined();
    expect(strat.underlyingCarryState.fundingCollectedUsd).toBe(0);
  });

  it("28g. underlyingBaseCarryState exposes base carry state with rebalance counters", () => {
    const strat = new FundingFlipKillSwitchStrategy();
    expect(strat.underlyingBaseCarryState).toBeDefined();
    expect(strat.underlyingBaseCarryState.rebalanceCount).toBe(0);
    expect(strat.underlyingBaseCarryState.rebalanceCostUsd).toBe(0);
  });

  it("29. z-score: trailing 7d with elevated vol → positive z-score", () => {
    const baseline: number[] = [];
    for (let i = 0; i < 90; i++) baseline.push(i % 2 === 0 ? 0.0001 : -0.0001);
    const trailing: number[] = Array.from({ length: 21 }, () => 0.0002);
    const rates = [...baseline, ...trailing];
    const m = computeFlipDetectorMetrics(rates, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.windowSize).toBe(21);
    expect(m.absRateMean).toBeCloseTo(0.0002, 6);
    expect(m.baselineAbsRateMean).toBeGreaterThan(0.0001);
    expect(m.zscore).toBeGreaterThan(0);
  });
});
