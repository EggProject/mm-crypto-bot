// packages/core/src/strategy/funding-carry-timing.test.ts — unit tests
//
// Phase 8 Track E — funding-rate timing strategy with 1:10 mandatory leverage.
//
// Test coverage (≥10):
//   1. validateTimingLeverage accepts 1, rejects 2/3/4/5/7/100/0/-1
//   2. computeEffectiveNotional scales base by leverage (1× vs 10×)
//   3. Default config has timingLeverage=10 (1:10 mandatory)
//   4. Constructor rejects invalid leverage values via HARD GUARDRAIL
//   5. computePercentile: linear interpolation correctness on small arrays
//   6. computeRollingStats: median/mean/std/p75 correct on synthetic data
//   7. evaluateTiming: 'enter' when currentRate > p75, 'hold' otherwise
//   8. evaluateTiming: 'exit' when currentRate < median, strict <
//   9. evaluateTiming: cooldown enforcement (72h minimum between entries)
//  10. evaluateTiming: insufficient history (count < 30) → 'hold'
//  11. evaluateTiming: exactly at threshold (strict > / strict <)
//  12. recordFundingSample: window trims to windowDays × 3 + 8 entries
//  13. accrueFundingOnSnapshot: only applies when inCarry; tracks periods
//  14. accrueFundingOnSnapshot: 10× scaling on payment
//  15. Strategy interface: onCandle emits buy on first valid candle
//  16. Strategy interface: onCandle emits sell when exit conditions met
//  17. Determinism: same input sequence → same output sequence
//  18. reset() clears all state including funding history
//  19. Wrapping logic: delegates accrual to underlying FundingCarryStrategy
//  20. Negative funding edge case: in-carry + negative rate = payment, tracked
//  21. triggerRebalanceIfNeeded: scales rebalance cost by 10× at 1:10

import { describe, expect, it } from "bun:test";

import {
  ALLOWED_TIMING_LEVERAGE,
  computeEffectiveNotional,
  computePercentile,
  computeRollingStats,
  DEFAULT_FUNDING_CARRY_TIMING_CONFIG,
  FundingCarryTimingStrategy,
  validateTimingLeverage,
  type AllowedTimingLeverage,
} from "./funding-carry-timing.js";
import type { StrategyContext } from "../types.js";

const baseCandle = (close: number, volume = 1000) => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume,
});

const makeCtx = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
  symbol: "BTC/USDT" as never,
  timeframe: "1h",
  candleIndex: 800, // > 30d × 24h warmup
  candle: baseCandle(50_000),
  mtfState: { htf: {}, mtf: {}, ltf: {} },
  pricePrecision: 2,
  ...overrides,
});

const makeFundingSnap = (rate: number, timeMs: number) => ({
  fundingTime: timeMs,
  symbol: "BTCUSDT",
  fundingRate: rate,
});

// Helper: build a 30d+ stable-positive funding history (90+ samples).
const stablePositiveHistory = (rate = 0.0001, n = 90): number[] =>
  Array.from({ length: n }, () => rate);

const makeStratWithHistory = (
  rates: readonly number[],
  overrides: Partial<ConstructorParameters<typeof FundingCarryTimingStrategy>[0]> = {},
): FundingCarryTimingStrategy => {
  const strat = new FundingCarryTimingStrategy(overrides);
  for (const r of rates) strat.recordFundingSample(r, 0);
  return strat;
};

describe("FundingCarryTimingStrategy — 1:10 HARD CONSTRAINT validator", () => {
  it("ALLOWED_TIMING_LEVERAGE is exactly [1, 10]", () => {
    expect(ALLOWED_TIMING_LEVERAGE).toEqual([1, 10]);
  });

  it("validateTimingLeverage accepts 1 and 10, rejects 2/3/4/5/7/100/0/-1", () => {
    expect(() => validateTimingLeverage(1)).not.toThrow();
    expect(() => validateTimingLeverage(10)).not.toThrow();
    // validateTimingLeverage accepts `number` at the type level (the
    // assertion narrows it). Runtime rejection is the actual contract.
    expect(() => validateTimingLeverage(2)).toThrow(/HARD CONSTRAINT VIOLATION/);
    expect(() => validateTimingLeverage(3)).toThrow(/HARD CONSTRAINT VIOLATION/);
    expect(() => validateTimingLeverage(4)).toThrow(/HARD CONSTRAINT VIOLATION/);
    expect(() => validateTimingLeverage(5)).toThrow(/HARD CONSTRAINT VIOLATION/);
    expect(() => validateTimingLeverage(7)).toThrow(/HARD CONSTRAINT VIOLATION/);
    expect(() => validateTimingLeverage(100)).toThrow(/HARD CONSTRAINT VIOLATION/);
    expect(() => validateTimingLeverage(0)).toThrow(/HARD CONSTRAINT VIOLATION/);
    expect(() => validateTimingLeverage(-1)).toThrow(/HARD CONSTRAINT VIOLATION/);
    expect(() => validateTimingLeverage(1.5)).toThrow(/HARD CONSTRAINT VIOLATION/);
  });

  it("computeEffectiveNotional: $10k base × 1× = $10k, × 10× = $100k", () => {
    expect(computeEffectiveNotional(10_000, 1)).toBe(10_000);
    expect(computeEffectiveNotional(10_000, 10)).toBe(100_000);
  });

  it("DEFAULT_FUNDING_CARRY_TIMING_CONFIG: timingLeverage = 10 (1:10 mandatory)", () => {
    expect(DEFAULT_FUNDING_CARRY_TIMING_CONFIG.timingLeverage).toBe(10);
    expect(DEFAULT_FUNDING_CARRY_TIMING_CONFIG.windowDays).toBe(30);
    expect(DEFAULT_FUNDING_CARRY_TIMING_CONFIG.entryPercentile).toBe(0.75);
    expect(DEFAULT_FUNDING_CARRY_TIMING_CONFIG.exitPercentile).toBe(0.5);
    expect(DEFAULT_FUNDING_CARRY_TIMING_CONFIG.cooldownHours).toBe(72);
  });

  it("Constructor: rejects invalid leverage via HARD GUARDRAIL", () => {
    // @ts-expect-error — testing runtime rejection of 3 (only 1 or 10 allowed)
    expect(() => new FundingCarryTimingStrategy({ timingLeverage: 3 })).toThrow(
      /HARD CONSTRAINT VIOLATION/,
    );
    // @ts-expect-error — testing runtime rejection of 5 (only 1 or 10 allowed)
    expect(() => new FundingCarryTimingStrategy({ timingLeverage: 5 })).toThrow(
      /HARD CONSTRAINT VIOLATION/,
    );
    // @ts-expect-error — testing runtime rejection of 7 (only 1 or 10 allowed)
    expect(() => new FundingCarryTimingStrategy({ timingLeverage: 7 })).toThrow(
      /HARD CONSTRAINT VIOLATION/,
    );
  });

  it("Constructor: timingLeverage=10 sets effectiveNotionalUsd = base × 10", () => {
    const strat = new FundingCarryTimingStrategy({ baseNotionalUsd: 10_000 });
    expect(strat.effectiveNotionalUsd).toBe(100_000);
    expect(strat.config.timingLeverage).toBe(10);
  });

  it("Constructor: timingLeverage=1 sets effectiveNotionalUsd = base × 1", () => {
    const strat = new FundingCarryTimingStrategy({ baseNotionalUsd: 10_000, timingLeverage: 1 });
    expect(strat.effectiveNotionalUsd).toBe(10_000);
    expect(strat.config.timingLeverage).toBe(1);
  });
});

describe("FundingCarryTimingStrategy — rolling-window statistics", () => {
  it("computePercentile: linear interpolation on [0..100] exact values", () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(computePercentile(sorted, 0)).toBe(1);
    expect(computePercentile(sorted, 50)).toBe(3); // exact middle
    expect(computePercentile(sorted, 100)).toBe(5);
    expect(computePercentile(sorted, 25)).toBe(2);
    expect(computePercentile(sorted, 75)).toBe(4);
  });

  it("computePercentile: interpolation between samples on 9-element array", () => {
    const sorted = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // 10 elements
    // 75th percentile: idx = 0.75 * 9 = 6.75 → interpolated
    // sorted[6]=6, sorted[7]=7 → 6 * 0.25 + 7 * 0.75 = 6.75
    expect(computePercentile(sorted, 75)).toBeCloseTo(6.75, 9);
  });

  it("computePercentile: empty array returns 0", () => {
    expect(computePercentile([], 50)).toBe(0);
    expect(computePercentile([], 0)).toBe(0);
    expect(computePercentile([], 100)).toBe(0);
  });

  it("computeRollingStats: median/mean/std/p75 on synthetic 90-sample array", () => {
    // 90 samples alternating between 0.0001 and 0.0003 → mean=0.0002,
    // median=0.0002, p75=0.0003, p25=0.0001, std small.
    const samples: number[] = [];
    for (let i = 0; i < 90; i++) samples.push(i % 2 === 0 ? 0.0001 : 0.0003);
    const stats = computeRollingStats(samples);
    expect(stats.count).toBe(90);
    expect(stats.mean).toBeCloseTo(0.0002, 7);
    expect(stats.median).toBeCloseTo(0.0002, 7);
    expect(stats.p75).toBeCloseTo(0.0003, 7);
    expect(stats.p25).toBeCloseTo(0.0001, 7);
    expect(stats.min).toBe(0.0001);
    expect(stats.max).toBe(0.0003);
    expect(stats.stdDev).toBeGreaterThan(0);
  });

  it("computeRollingStats: all-zero funding → median/p75 = 0, std = 0", () => {
    const stats = computeRollingStats(stablePositiveHistory(0, 90));
    expect(stats.median).toBe(0);
    expect(stats.p75).toBe(0);
    expect(stats.stdDev).toBe(0);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
  });

  it("computeRollingStats: empty input → all fields 0", () => {
    const stats = computeRollingStats([]);
    expect(stats.count).toBe(0);
    expect(stats.median).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.stdDev).toBe(0);
  });

  it("recordFundingSample: window trims to windowDays × 3 + 8 entries", () => {
    const strat = new FundingCarryTimingStrategy({ windowDays: 30 });
    for (let i = 0; i < 200; i++) {
      strat.recordFundingSample(0.0001, i * 8 * 60 * 60 * 1000);
    }
    // Should keep only last 30*3 + 8 = 98 entries.
    expect(strat.state.fundingHistory.length).toBe(98);
    expect(strat.state.lastStats.count).toBe(98);
  });

  it("recordFundingSample: non-finite input throws", () => {
    const strat = new FundingCarryTimingStrategy();
    expect(() => strat.recordFundingSample(NaN, 0)).toThrow();
    expect(() => strat.recordFundingSample(Infinity, 0)).toThrow();
  });

  it("getCurrentStats: returns rolling stats without adding a new sample", () => {
    const strat = makeStratWithHistory(stablePositiveHistory(0.0001, 90));
    const before = strat.state.lastStats;
    const fetched = strat.getCurrentStats();
    expect(fetched).toEqual(before);
    expect(fetched.count).toBe(90);
  });
});

describe("FundingCarryTimingStrategy — entry/exit decision logic", () => {
  it("evaluateTiming: insufficient history (< 30 samples) → 'hold'", () => {
    const strat = new FundingCarryTimingStrategy();
    for (let i = 0; i < 29; i++) strat.recordFundingSample(0.0001, 0);
    expect(strat.state.lastStats.count).toBe(29);
    // Even if rate is sky-high, insufficient history → no decision.
    expect(strat.evaluateTiming(1, 0)).toBe("hold");
  });

  it("evaluateTiming: out-of-carry + currentRate > p75 → 'enter'", () => {
    // 90 samples at 0.0001 → p75 = 0.0001. Need rate strictly > 0.0001.
    const strat = makeStratWithHistory(stablePositiveHistory(0.0001, 90));
    expect(strat.state.isInCarry).toBe(false);
    expect(strat.evaluateTiming(0.00011, 1000)).toBe("enter");
  });

  it("evaluateTiming: out-of-carry + currentRate = p75 → 'hold' (strict >)", () => {
    const strat = makeStratWithHistory(stablePositiveHistory(0.0001, 90));
    // p75 = 0.0001 exactly; currentRate = p75 → strict > fails → hold.
    expect(strat.evaluateTiming(0.0001, 1000)).toBe("hold");
  });

  it("evaluateTiming: out-of-carry + currentRate < p75 → 'hold'", () => {
    const strat = makeStratWithHistory(stablePositiveHistory(0.0001, 90));
    expect(strat.evaluateTiming(0.00005, 1000)).toBe("hold");
  });

  it("evaluateTiming: cooldown 72h enforced between consecutive entries", () => {
    const strat = makeStratWithHistory(stablePositiveHistory(0.0001, 90));
    // First entry at t=1000.
    expect(strat.evaluateTiming(0.0002, 1000)).toBe("enter");
    strat._enterCarry(1000);
    // Exit immediately to test re-entry cooldown.
    strat._exitCarry(2000);
    // Re-entry at t=1000+24h = 87400000 ms → cooldown (72h = 259200000 ms) NOT met.
    expect(strat.evaluateTiming(0.0002, 1000 + 24 * 3600_000)).toBe("hold");
    // Re-entry at t=1000+73h → cooldown met.
    expect(strat.evaluateTiming(0.0002, 1000 + 73 * 3600_000)).toBe("enter");
  });

  it("evaluateTiming: in-carry + currentRate < median → 'exit'", () => {
    // Build history with median 0.0002 (alternating 0.0001/0.0003),
    // then jump to a low rate.
    const samples: number[] = [];
    for (let i = 0; i < 90; i++) samples.push(i % 2 === 0 ? 0.0001 : 0.0003);
    const strat = makeStratWithHistory(samples);
    strat._enterCarry(0);
    expect(strat.state.isInCarry).toBe(true);
    // Current rate = 0.00005 → below median (0.0002) → exit.
    expect(strat.evaluateTiming(0.00005, 1000)).toBe("exit");
  });

  it("evaluateTiming: in-carry + currentRate = median → 'hold' (strict <)", () => {
    const samples: number[] = [];
    for (let i = 0; i < 90; i++) samples.push(i % 2 === 0 ? 0.0001 : 0.0003);
    const strat = makeStratWithHistory(samples);
    strat._enterCarry(0);
    // median = 0.0002 exactly. currentRate = median → strict < fails.
    expect(strat.evaluateTiming(0.0002, 1000)).toBe("hold");
  });

  it("evaluateTiming: in-carry + currentRate > median → 'hold'", () => {
    const samples: number[] = [];
    for (let i = 0; i < 90; i++) samples.push(i % 2 === 0 ? 0.0001 : 0.0003);
    const strat = makeStratWithHistory(samples);
    strat._enterCarry(0);
    expect(strat.evaluateTiming(0.0003, 1000)).toBe("hold");
  });

  it("evaluateTiming: in-carry + negative rate → 'exit' (negative < median)", () => {
    const strat = makeStratWithHistory(stablePositiveHistory(0.0001, 90));
    strat._enterCarry(0);
    expect(strat.evaluateTiming(-0.0001, 1000)).toBe("exit");
  });

  it("evaluateTiming: non-finite rate throws", () => {
    const strat = makeStratWithHistory(stablePositiveHistory(0.0001, 90));
    expect(() => strat.evaluateTiming(NaN, 0)).toThrow();
    expect(() => strat.evaluateTiming(Infinity, 0)).toThrow();
  });
});

describe("FundingCarryTimingStrategy — wrapping + accrual", () => {
  it("accrueFundingOnSnapshot: applies payment at 10× notional when in carry", () => {
    const strat = new FundingCarryTimingStrategy({ baseNotionalUsd: 10_000 });
    strat._enterCarry(0);
    const snap = makeFundingSnap(0.0001, 1_700_000_000_000);
    const payment = strat.accrueFundingOnSnapshot(snap);
    // 10× notional = $100k × 0.0001 = $10
    expect(payment).toBeCloseTo(10, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(10, 6);
    expect(strat.state.inCarryFundingPeriods).toBe(1);
    expect(strat.state.outOfCarryFundingPeriods).toBe(0);
  });

  it("accrueFundingOnSnapshot: applies payment at 1× notional when leverage=1", () => {
    const strat = new FundingCarryTimingStrategy({
      baseNotionalUsd: 10_000,
      timingLeverage: 1,
    });
    strat._enterCarry(0);
    const snap = makeFundingSnap(0.0001, 1_700_000_000_000);
    const payment = strat.accrueFundingOnSnapshot(snap);
    // 1× notional = $10k × 0.0001 = $1
    expect(payment).toBeCloseTo(1, 6);
  });

  it("accrueFundingOnSnapshot: out-of-carry → no funding applied, period counted", () => {
    const strat = new FundingCarryTimingStrategy();
    expect(strat.state.isInCarry).toBe(false);
    const snap = makeFundingSnap(0.0001, 1_700_000_000_000);
    const payment = strat.accrueFundingOnSnapshot(snap);
    expect(payment).toBeCloseTo(0, 6); // not added to state.fundingCollectedUsd
    expect(strat.state.fundingCollectedUsd).toBe(0);
    expect(strat.state.outOfCarryFundingPeriods).toBe(1);
    expect(strat.state.inCarryFundingPeriods).toBe(0);
  });

  it("accrueFundingOnSnapshot: in-carry + negative rate → payment (loss), tracked separately", () => {
    const strat = new FundingCarryTimingStrategy();
    strat._enterCarry(0);
    const snap = makeFundingSnap(-0.0001, 1_700_000_000_000);
    const payment = strat.accrueFundingOnSnapshot(snap);
    // Negative rate → payment < 0 → strategy pays funding.
    expect(payment).toBeLessThan(0);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(payment, 6);
    expect(strat.state.negativeFundingPaidUsd).toBeCloseTo(payment, 6);
  });

  it("Wrapping: delegates accrual to underlying FundingCarryStrategy state", () => {
    const strat = new FundingCarryTimingStrategy({ baseNotionalUsd: 10_000 });
    strat._enterCarry(0);
    strat.accrueFundingOnSnapshot(makeFundingSnap(0.0001, 1_700_000_000_000));
    // Underlying carry is the single source of truth — accrual happens at
    // the SCALED (1:10) notional = $100k × 0.0001 = $10. The timing layer
    // mirrors this value into state.fundingCollectedUsd for the CLI runner.
    expect(strat.underlyingCarryState.fundingCollectedUsd).toBeCloseTo(10, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(10, 6);
    // They should be equal — no double-counting.
    expect(strat.state.fundingCollectedUsd).toBe(strat.underlyingCarryState.fundingCollectedUsd);
  });

  it("triggerRebalanceIfNeeded: scales rebalance cost by 10× at 1:10", () => {
    const strat = new FundingCarryTimingStrategy({ baseNotionalUsd: 10_000 });
    strat._enterCarry(0);
    // 5% drift on effective notional ($100k) = $5k delta.
    const triggered = strat.triggerRebalanceIfNeeded(5_000);
    expect(triggered).toBe(true);
    // Flat fee: 20 bps × $100k = $200.
    expect(strat.underlyingCarryState.rebalanceCostUsd).toBeGreaterThan(200);
  });

  it("triggerRebalanceIfNeeded: below threshold → no rebalance", () => {
    const strat = new FundingCarryTimingStrategy({ baseNotionalUsd: 10_000 });
    strat._enterCarry(0);
    // 1% drift on $100k = $1k, below 5% threshold → no rebalance.
    expect(strat.triggerRebalanceIfNeeded(1_000)).toBe(false);
    expect(strat.underlyingCarryState.rebalanceCount).toBe(0);
  });
});

describe("FundingCarryTimingStrategy — Strategy interface", () => {
  it("onCandle: before warmup → null", () => {
    const strat = new FundingCarryTimingStrategy();
    expect(strat.onCandle(makeCtx({ candleIndex: 100 }))).toBeNull(); // < 720
  });

  it("onCandle: first valid candle after warmup → buy signal at 1:10", () => {
    const strat = new FundingCarryTimingStrategy();
    // Seed history to pass insufficient-history gate inside evaluateTiming.
    for (let i = 0; i < 90; i++) strat.recordFundingSample(0.0001, i * 8 * 3600_000);
    const sig = strat.onCandle(makeCtx({ candleIndex: 800, candle: baseCandle(50_000) }));
    expect(sig).not.toBeNull();
    expect(sig?.side).toBe("buy");
    expect(sig?.confidence).toBe(1);
    expect(sig?.reason).toContain("1:10 leverage");
    expect(sig?.reason).toContain("effective notional=$100000");
    expect(strat.state.hasEntered).toBe(true);
    expect(strat.state.entryCount).toBe(1);
  });

  it("onCandle: subsequent candles while holding → null (or sell if exit triggered)", () => {
    const strat = new FundingCarryTimingStrategy();
    for (let i = 0; i < 90; i++) strat.recordFundingSample(0.0001, i * 8 * 3600_000);
    const first = strat.onCandle(makeCtx({ candleIndex: 800 }));
    expect(first?.side).toBe("buy");
    // Next candle — still in carry, no exit condition met.
    const second = strat.onCandle(makeCtx({ candleIndex: 801 }));
    expect(second).toBeNull();
  });

  it("onCandle: emit sell signal when exit conditions met (rate < median)", () => {
    // Build history with median ~0.0002, then jump to low rate.
    const samples: number[] = [];
    for (let i = 0; i < 90; i++) samples.push(i % 2 === 0 ? 0.0001 : 0.0003);
    const strat = new FundingCarryTimingStrategy();
    for (const r of samples) strat.recordFundingSample(r, 0);
    // First candle → enter.
    const enter = strat.onCandle(makeCtx({ candleIndex: 800 }));
    expect(enter?.side).toBe("buy");
    // Add a very low funding rate that should trigger exit.
    strat.recordFundingSample(-0.0001, 1);
    const exit = strat.onCandle(makeCtx({ candleIndex: 801 }));
    expect(exit?.side).toBe("sell");
    expect(strat.state.exitCount).toBe(1);
  });
});

describe("FundingCarryTimingStrategy — determinism + reset", () => {
  it("Determinism: same input sequence → same output sequence", () => {
    const strat1 = new FundingCarryTimingStrategy({ baseNotionalUsd: 10_000 });
    const strat2 = new FundingCarryTimingStrategy({ baseNotionalUsd: 10_000 });
    const rates = stablePositiveHistory(0.0001, 90);
    for (const r of rates) {
      strat1.recordFundingSample(r, 0);
      strat2.recordFundingSample(r, 0);
    }
    expect(strat1.state.lastStats).toEqual(strat2.state.lastStats);
    expect(strat1.evaluateTiming(0.0002, 1000)).toBe(strat2.evaluateTiming(0.0002, 1000));
    strat1._enterCarry(1000);
    strat2._enterCarry(1000);
    strat1.accrueFundingOnSnapshot(makeFundingSnap(0.0001, 2000));
    strat2.accrueFundingOnSnapshot(makeFundingSnap(0.0001, 2000));
    expect(strat1.state.fundingCollectedUsd).toBe(strat2.state.fundingCollectedUsd);
  });

  it("reset() clears all state including funding history and entry counts", () => {
    const strat = new FundingCarryTimingStrategy();
    for (let i = 0; i < 90; i++) strat.recordFundingSample(0.0001, 0);
    strat._enterCarry(1000);
    strat.accrueFundingOnSnapshot(makeFundingSnap(0.0001, 2000));
    expect(strat.state.fundingCollectedUsd).not.toBe(0);
    strat.reset();
    expect(strat.state.fundingHistory).toEqual([]);
    expect(strat.state.isInCarry).toBe(false);
    expect(strat.state.entryCount).toBe(0);
    expect(strat.state.exitCount).toBe(0);
    expect(strat.state.fundingCollectedUsd).toBe(0);
    expect(strat.state.inCarryFundingPeriods).toBe(0);
    expect(strat.state.hasEntered).toBe(false);
    expect(strat.underlyingCarryState.fundingCollectedUsd).toBe(0);
  });
});

describe("FundingCarryTimingStrategy — type safety", () => {
  it("AllowedTimingLeverage is the union 1 | 10", () => {
    const a: AllowedTimingLeverage = 1;
    const b: AllowedTimingLeverage = 10;
    expect(a).toBe(1);
    expect(b).toBe(10);
  });
});
