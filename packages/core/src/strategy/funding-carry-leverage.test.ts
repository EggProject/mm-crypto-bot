// packages/core/src/strategy/funding-carry-leverage.test.ts — unit tesztek
//
// Phase 7 Track C — leveraged delta-neutral funding-rate carry.
// Phase 8 Track D — 1:10 mandatory leverage CONSTRAINT + new helpers.
//
// Test coverage (≥25):
//
// PHASE 7 (preserved, adapted to maxLeverage=10 default):
//   1.  Default config sanity — maxLeverage now 10 (1:10 mandate)
//   2.  warmup returns 30 (longer than base — needs stability window)
//   3.  onCandle emits ONE buy signal on first valid candle
//   4.  Initial leverage defaults to minLeverage (1×), margin state correct
//   5.  setEffectiveLeverage scales notional + margin (at 10×)
//   6.  setEffectiveLeverage clamps out-of-range values
//   7.  getScaledRebalanceThreshold scales inversely with leverage (1× / 10×)
//   8.  accrueFundingScaled earns at scaled notional (positive rate)
//   9.  accrueFundingScaled with negative rate pays at scaled notional
//  10.  accrueFundingScaled rejects NaN / Infinity
//  11.  computeDailyVaR parametric: stable zero-variance returns → 0 VaR
//  12.  computeDailyVaR parametric: 1% std-dev → bounded VaR @95%
//  13.  computeDailyVaR historical: 5th percentile of empirical series
//  14.  computeDailyVaR rejects invalid notional
//  15.  computeStabilityCappedLeverage downshifts when funding volatile
//  16.  computeStabilityCappedLeverage returns 0.5× max when history insufficient
//  17.  computeVarCappedLeverage returns min leverage when VaR cap exceeded
//  18.  checkLiquidationThreshold catches margin breach (margin ratio ≥ 50%)
//  19.  checkLiquidationThreshold does NOT trigger when margin healthy
//  20.  triggerRebalance at scaled leverage debits scaled cost
//  21.  triggerRebalance suppresses when drift below scaled threshold
//  22.  varComplianceRatio ≤ 1 ⇒ VaR-cap pass; > 1 ⇒ fail
//  23.  Funding-rate history windowing keeps last N entries
//  24.  reset() clears all state including leverage history
//  25.  Funding rate spike edge case accrues correctly at 10× notional
//  26.  LiquidationEvent shape conforms to interface
//
// PHASE 8 (NEW — 1:10 mandate + dynamic VaR helpers):
//  27.  ALLOWED_LEVERAGE_VALUES is exactly [1, 10]
//  28.  DEFAULT_LEVERAGE is 10
//  29.  assert1to10Leverage accepts 1 and 10, rejects 2/3/5/7
//  30.  Constructor HARD GUARDRAIL rejects maxLeverage=3 (Phase 7 default)
//  31.  setEffectiveLeverage HARD GUARDRAIL rejects 5/7/etc.
//  32.  computeDynamicLeverage returns maxAllowed when funding is at or below reference std-dev
//  33.  computeDynamicLeverage scales down when funding is volatile
//  34.  computeDynamicLeverage enforces positive inputs (throws on bad inputs)
//  35.  safeEffectiveLeverage floors at 1× when VaR cap violated (varCapOk=false)
//  36.  safeEffectiveLeverage honors requested leverage when VaR cap passes
//  37.  safeEffectiveLeverage clamps requested leverage to [min, max]
//  38.  10× efficiency ratio vs 1× baseline ≈ 10× on stable funding (linear scaling test)

import { describe, expect, it } from "bun:test";

import {
  ALLOWED_LEVERAGE_VALUES,
  assert1to10Leverage,
  DEFAULT_LEVERAGE,
  DEFAULT_LEVERAGED_CARRY_CONFIG,
  FundingCarryLeverageStrategy,
  type LiquidationEvent,
} from "./funding-carry-leverage.js";
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
  candleIndex: 50,
  candle: baseCandle(100),
  mtfState: { htf: {}, mtf: {}, ltf: {} },
  pricePrecision: 2,
  ...overrides,
});

const stableZeroSeries = (n: number): number[] => Array.from({ length: n }, () => 0.0001);
const zeroReturns = (n: number): number[] => Array.from({ length: n }, () => 0);

describe("FundingCarryLeverageStrategy", () => {
  it("default config: max leverage 10 (1:10 mandate), min 1, VaR 95%, VaR cap 2%, IM 50%", () => {
    // Phase 8 Track D — DEFAULT maxLeverage raised 3 → 10 per the 1:10 mandate.
    expect(DEFAULT_LEVERAGED_CARRY_CONFIG.maxLeverage).toBe(10);
    expect(DEFAULT_LEVERAGED_CARRY_CONFIG.minLeverage).toBe(1);
    expect(DEFAULT_LEVERAGED_CARRY_CONFIG.varConfidence).toBe(0.95);
    expect(DEFAULT_LEVERAGED_CARRY_CONFIG.maxDailyVarPct).toBe(0.02);
    expect(DEFAULT_LEVERAGED_CARRY_CONFIG.minInitialMarginFraction).toBe(0.5);
    expect(DEFAULT_LEVERAGED_CARRY_CONFIG.varMethod).toBe("parametric");
  });

  it("warmup returns 30 (covers 30d stability window)", () => {
    const strat = new FundingCarryLeverageStrategy();
    expect(strat.warmup()).toBe(30);
  });

  it("onCandle emits exactly ONE buy signal on first valid candle", () => {
    const strat = new FundingCarryLeverageStrategy();
    // First candle before warmup → null.
    expect(strat.onCandle(makeCtx({ candleIndex: 5 }))).toBeNull();
    // After warmup → one signal.
    const sig = strat.onCandle(makeCtx({ candleIndex: 50, candle: baseCandle(50_000) }));
    expect(sig).not.toBeNull();
    expect(sig?.side).toBe("buy");
    expect(sig?.confidence).toBe(1);
    expect(sig?.reason).toContain("Leveraged funding-carry entry");
    expect(sig?.reason).toContain("leverage=1×"); // default 1× at entry
    // Subsequent → null (already entered).
    expect(strat.onCandle(makeCtx({ candleIndex: 100 }))).toBeNull();
    expect(strat.onCandle(makeCtx({ candleIndex: 200 }))).toBeNull();
  });

  it("initial state: leverage=1×, notional=base, maintenance margin=0.5%", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    expect(strat.state.currentLeverage).toBe(1);
    expect(strat.state.effectiveNotionalUsd).toBe(10_000);
    expect(strat.state.initialMarginUsd).toBe(10_000);
    expect(strat.state.maintenanceMarginUsd).toBeCloseTo(50.0, 6); // 0.5% × 10k
    expect(strat.state.liquidationEventsCount).toBe(0);
  });

  it("setEffectiveLeverage(10) → 10× notional, scaled IM/MM (1:10 mandate)", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    strat.setEffectiveLeverage(10);
    expect(strat.state.currentLeverage).toBe(10);
    expect(strat.state.effectiveNotionalUsd).toBe(100_000);
    expect(strat.state.initialMarginUsd).toBe(10_000); // IM stays = base (constant)
    expect(strat.state.maintenanceMarginUsd).toBeCloseTo(500.0, 6); // 0.5% × 100k
  });

  it("setEffectiveLeverage accepts only 1× or 10× (1:10 hard guardrail)", () => {
    // Phase 8 Track D — out-of-range is now a HARD rejection (throws),
    // not a silent clamp (which would be a footgun under the 1:10 mandate).
    const strat = new FundingCarryLeverageStrategy();
    // Floor and ceiling within valid range (1 and 10 only):
    expect(() => strat.setEffectiveLeverage(1)).not.toThrow();
    expect(strat.state.currentLeverage).toBe(1);
    expect(() => strat.setEffectiveLeverage(10)).not.toThrow();
    expect(strat.state.currentLeverage).toBe(10);
    // Anything else throws:
    expect(() => strat.setEffectiveLeverage(99)).toThrow(/HARD GUARDRAIL/);
    expect(() => strat.setEffectiveLeverage(0.5)).toThrow(/HARD GUARDRAIL/);
    expect(() => strat.setEffectiveLeverage(-5)).toThrow(/HARD GUARDRAIL/);
    expect(() => strat.setEffectiveLeverage(2)).toThrow(/HARD GUARDRAIL/);
    expect(() => strat.setEffectiveLeverage(3)).toThrow(/HARD GUARDRAIL/);
    expect(() => strat.setEffectiveLeverage(5)).toThrow(/HARD GUARDRAIL/);
    expect(() => strat.setEffectiveLeverage(7)).toThrow(/HARD GUARDRAIL/);
  });

  it("getScaledRebalanceThreshold scales inversely with leverage (1× / 10×)", () => {
    const strat = new FundingCarryLeverageStrategy({
      rebalanceThresholdPct: 0.06,
      baseNotionalUsd: 10_000,
    });
    strat.setEffectiveLeverage(1);
    expect(strat.getScaledRebalanceThreshold()).toBeCloseTo(0.06, 6);
    strat.setEffectiveLeverage(10);
    // 0.06 / 10 = 0.006 (0.6%) — tighter trigger at 10× to avoid cascade.
    expect(strat.getScaledRebalanceThreshold()).toBeCloseTo(0.006, 6);
  });

  it("accrueFundingScaled earns at scaled notional (positive rate)", () => {
    const strat = new FundingCarryLeverageStrategy({
      baseNotionalUsd: 10_000,
      maxLeverage: 10,
    });
    strat.setEffectiveLeverage(10);
    // 0.01% per 8h on $100k notional = $10.
    const payment = strat.accrueFundingScaled(0.0001, 1_700_000_000_000);
    expect(payment).toBeCloseTo(10.0, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(10.0, 6);
  });

  it("accrueFundingScaled with negative rate pays at scaled notional", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    strat.setEffectiveLeverage(10);
    // -0.05% per 8h on $100k notional = -$50.
    const payment = strat.accrueFundingScaled(-0.0005, 1_700_000_000_000);
    expect(payment).toBeCloseTo(-50.0, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(-50.0, 6);
  });

  it("accrueFundingScaled rejects NaN / Infinity", () => {
    const strat = new FundingCarryLeverageStrategy();
    strat.setEffectiveLeverage(1);
    expect(() => strat.accrueFundingScaled(NaN, 1)).toThrow(/fundingRate/);
    expect(() => strat.accrueFundingScaled(Infinity, 1)).toThrow(/fundingRate/);
  });

  it("computeDailyVaR parametric: stable zero-variance returns → 0 VaR", () => {
    const strat = new FundingCarryLeverageStrategy();
    strat.setEffectiveLeverage(10);
    const returns = stableZeroSeries(100); // mean 0, var 0
    const varValue = strat.computeDailyVaR(100_000, returns);
    expect(varValue).toBe(0);
  });

  it("computeDailyVaR parametric: 1% std-dev → bounded VaR @95% on $10k", () => {
    const strat = new FundingCarryLeverageStrategy({
      varMethod: "parametric",
      varConfidence: 0.95,
    });
    strat.setEffectiveLeverage(1);
    // Synthesize returns with mean 0.001, std-dev 0.01.
    const series = Array.from({ length: 1000 }, (_, i) =>
      ((i % 17) - 8) * 0.00125,
    );
    const varValue = strat.computeDailyVaR(10_000, series);
    // z=1.645, σ≈0.01, → VaR = 1.645 * 0.01 * 10000 ≈ $164.5 (loss magnitude)
    expect(varValue).toBeGreaterThan(80);
    expect(varValue).toBeLessThan(300);
  });

  it("computeDailyVaR historical: 5th percentile of empirical series", () => {
    const strat = new FundingCarryLeverageStrategy({
      varMethod: "historical",
      varConfidence: 0.95,
    });
    strat.setEffectiveLeverage(1);
    // The historical VaR is the (1 - confidence) percentile of the
    // sorted loss series. With 95% confidence and 40 samples, that's
    // index floor(0.05 × 40) = 2. We construct a series where the
    // 5%-worst return is around -0.005 (one of the left-tail points).
    const series = [
      -0.012, -0.009, -0.005, -0.002, 0.001,
      0.002, -0.001, 0.003, 0.004, -0.003,
    ];
    // Pad with bigger positive returns so the 5th percentile is on the
    // left-tail (-0.005), not on the padded floor.
    while (series.length < 40) series.push(0.01);
    const varValue = strat.computeDailyVaR(10_000, series);
    // 5th percentile ≈ -0.005 → VaR = 0.005 × 10000 ≈ $50.
    expect(varValue).toBeGreaterThan(20);
    expect(varValue).toBeLessThan(200);
  });

  it("computeDailyVaR rejects invalid notional", () => {
    const strat = new FundingCarryLeverageStrategy();
    expect(() => strat.computeDailyVaR(0, [0.001])).toThrow(/notionalUsd/);
    expect(() => strat.computeDailyVaR(-100, [0.001])).toThrow(/notionalUsd/);
  });

  it("computeStabilityCappedLeverage downshifts when funding volatile", () => {
    const strat = new FundingCarryLeverageStrategy({
      maxLeverage: 10,
      minLeverage: 1,
      fundingStabilityRefStdDev: 0.0005,
    });
    // Stable series (all 0.0001) → low std-dev → high leverage.
    const stable = stableZeroSeries(100);
    // Volatile series (alternating ±0.005) → high std-dev → low leverage.
    const volatile = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? 0.005 : -0.005,
    );
    const stableCap = strat.computeStabilityCappedLeverage(stable);
    const volatileCap = strat.computeStabilityCappedLeverage(volatile);
    expect(stableCap).toBeGreaterThanOrEqual(volatileCap);
    expect(volatileCap).toBeLessThanOrEqual(strat.config.maxLeverage);
  });

  it("computeStabilityCappedLeverage returns 0.5× max when history insufficient", () => {
    // At maxLeverage=10, 0.5× = 5.
    const strat = new FundingCarryLeverageStrategy({ maxLeverage: 10 });
    const cap = strat.computeStabilityCappedLeverage([0.0001, 0.0002]); // only 2 samples
    expect(cap).toBeCloseTo(5.0, 6);
  });

  it("computeVarCappedLeverage returns min leverage when VaR cap exceeded", () => {
    const strat = new FundingCarryLeverageStrategy({ maxLeverage: 10 });
    strat.setEffectiveLeverage(1);
    // Wild returns → VaR at 10k notional ≫ 2% × 10k × 0.5 = $100 ⇒ cap = 0 → floor at 1.
    const wild = Array.from({ length: 100 }, (_, i) =>
      Math.sin(i * 1.7) * 0.05 + 0.001,
    );
    const cap = strat.computeVarCappedLeverage(wild, 10_000);
    expect(cap).toBe(1);
  });

  it("checkLiquidationThreshold catches margin breach (margin ratio ≥ 50%)", () => {
    const strat = new FundingCarryLeverageStrategy({
      baseNotionalUsd: 10_000,
      maxLeverage: 10,
      minInitialMarginFraction: 0.5,
    });
    strat.setEffectiveLeverage(10);
    // Initial: IM=$10k, MM = 0.5% × $100k = $500.
    // If unrealized PnL = -$9.0k, margin balance = $1.0k, margin ratio = 500/1000 = 0.5 ⇒ breach.
    const breach = strat.checkLiquidationThreshold(-9_000);
    expect(breach).toBe(true);
    expect(strat.state.liquidationEventsCount).toBe(1);
  });

  it("checkLiquidationThreshold does NOT trigger when margin healthy", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    strat.setEffectiveLeverage(10);
    // MM = $500, IM = $10k. Unrealized PnL -$500 ⇒ margin balance $9.5k ⇒ ratio 0.053 < 0.5 ⇒ OK.
    expect(strat.checkLiquidationThreshold(-500)).toBe(false);
    expect(strat.state.liquidationEventsCount).toBe(0);
  });

  it("triggerRebalance at 10× leverage debits 10× the base flat-fee", () => {
    const strat = new FundingCarryLeverageStrategy({
      baseNotionalUsd: 10_000,
      rebalanceThresholdPct: 0.05,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
      maxLeverage: 10,
    });
    strat.setEffectiveLeverage(10);
    // Effective notional = $100k, base drift threshold scaled to 0.005 at 10×.
    // Drift $600 against $100k = 0.006 → above 0.005 → rebalance.
    expect(strat.triggerRebalance(600)).toBe(true);
    // Flat fee = 20bps × $100k = $200 (instead of $20 at 1×).
    // Plus latency cost ≈ 0.0001 × 0.25h × $100k = $2.50.
    // Total ≈ $202.50.
    expect(strat.state.rebalanceCostUsd).toBeGreaterThanOrEqual(200);
    expect(strat.state.rebalanceCostUsd).toBeLessThanOrEqual(210);
  });

  it("triggerRebalance suppresses when drift below scaled threshold", () => {
    const strat = new FundingCarryLeverageStrategy({
      baseNotionalUsd: 10_000,
      rebalanceThresholdPct: 0.05,
    });
    strat.setEffectiveLeverage(10);
    expect(strat.triggerRebalance(100)).toBe(false); // 0.001 < 0.005
    expect(strat.state.rebalanceCount).toBe(0);
  });

  it("varComplianceRatio ≤ 1 ⇒ VaR cap passes", () => {
    const strat = new FundingCarryLeverageStrategy({
      varMethod: "parametric",
      varConfidence: 0.95,
      maxDailyVarPct: 0.02,
    });
    strat.setEffectiveLeverage(10);
    const stable = zeroReturns(60); // σ≈0
    const ratio = strat.varComplianceRatio(stable, 100_000);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeLessThanOrEqual(1);
  });

  it("varComplianceRatio > 1 ⇒ VaR cap VIOLATES (rejected)", () => {
    const strat = new FundingCarryLeverageStrategy({
      varMethod: "parametric",
      varConfidence: 0.95,
      maxDailyVarPct: 0.001, // super-tight cap to force violation
    });
    strat.setEffectiveLeverage(10);
    const wild = Array.from({ length: 100 }, (_, i) =>
      ((i % 7) - 3) * 0.01,
    );
    const ratio = strat.varComplianceRatio(wild, 100_000);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(1);
  });

  it("funding-rate history is windowed (keeps last fundingStabilityWindowDays × 3)", () => {
    const strat = new FundingCarryLeverageStrategy({
      baseNotionalUsd: 10_000,
      fundingStabilityWindowDays: 30,
      minLeverage: 1,
      maxLeverage: 1,
    });
    // Feed 200 funding rates.
    for (let i = 0; i < 200; i++) {
      strat.accrueFundingScaled(0.0001, 1_700_000_000_000 + i * 28_800_000);
    }
    // Window = 30×3 + 32 = 122; we recorded 200, so the oldest 78 are dropped.
    expect(strat.state.fundingHistory.length).toBeLessThanOrEqual(122);
    expect(strat.state.fundingHistory.length).toBeGreaterThan(100);
  });

  it("reset() clears leverage history + metrics", () => {
    const strat = new FundingCarryLeverageStrategy();
    strat.setEffectiveLeverage(10);
    strat.accrueFundingScaled(0.0001, 1_700_000_000_000);
    strat.triggerRebalance(2_000);
    strat.recordLiquidation();
    expect(strat.state.fundingCollectedUsd).not.toBe(0);
    expect(strat.state.liquidationEventsCount).toBe(1);
    strat.reset();
    expect(strat.state.fundingCollectedUsd).toBe(0);
    expect(strat.state.rebalanceCount).toBe(0);
    expect(strat.state.currentLeverage).toBe(1);
    expect(strat.state.liquidationEventsCount).toBe(0);
    expect(strat.state.fundingHistory).toHaveLength(0);
  });

  it("extreme funding-rate spike (5% per 8h) accrues correctly at 10× notional", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    strat.setEffectiveLeverage(10);
    // 0.05 per 8h on $100k → $5,000 earned at once. (Extreme regime.)
    const payment = strat.accrueFundingScaled(0.05, 1_700_000_000_000);
    expect(payment).toBeCloseTo(5_000, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(5_000, 6);
  });

  it("LiquidationEvent shape conforms to interface", () => {
    const ev: LiquidationEvent = {
      timestampMs: 1_700_000_000_000,
      markPrice: 50_000,
      leverage: 10,
      initialMarginUsd: 10_000,
      maintenanceMarginUsd: 500,
      marginRatio: 0.5,
      effectiveNotionalUsd: 100_000,
    };
    expect(ev.leverage).toBe(10);
    expect(ev.maintenanceMarginUsd).toBeLessThan(ev.initialMarginUsd);
  });

  // -------------------------------------------------------------------------
  // Phase 8 Track D — 1:10 MANDATORY + dynamic VaR helpers
  // -------------------------------------------------------------------------

  it("ALLOWED_LEVERAGE_VALUES is exactly [1, 10]", () => {
    expect(ALLOWED_LEVERAGE_VALUES).toEqual([1, 10]);
    expect(ALLOWED_LEVERAGE_VALUES.length).toBe(2);
    // Confirm frozen (compile-time invariant): must not be re-assignable.
    expect(Object.isFrozen(ALLOWED_LEVERAGE_VALUES)).toBe(true);
  });

  it("DEFAULT_LEVERAGE is 10 (1:10 mandate)", () => {
    expect(DEFAULT_LEVERAGE).toBe(10);
  });

  it("assert1to10Leverage accepts 1 and 10, rejects 2/3/5/7", () => {
    expect(() => assert1to10Leverage(1)).not.toThrow();
    expect(() => assert1to10Leverage(10)).not.toThrow();
    expect(() => assert1to10Leverage(2)).toThrow(/HARD GUARDRAIL/);
    expect(() => assert1to10Leverage(3)).toThrow(/HARD GUARDRAIL/);
    expect(() => assert1to10Leverage(5)).toThrow(/HARD GUARDRAIL/);
    expect(() => assert1to10Leverage(7)).toThrow(/HARD GUARDRAIL/);
    expect(() => assert1to10Leverage(50)).toThrow(/HARD GUARDRAIL/);
  });

  it("assert1to10Leverage accepts object form with maxLeverage/currentLeverage/leverage", () => {
    expect(() => assert1to10Leverage({ maxLeverage: 10 })).not.toThrow();
    expect(() => assert1to10Leverage({ currentLeverage: 1 })).not.toThrow();
    expect(() => assert1to10Leverage({ leverage: 10 })).not.toThrow();
    expect(() => assert1to10Leverage({ maxLeverage: 5 })).toThrow(/HARD GUARDRAIL/);
  });

  it("Constructor HARD GUARDRAIL rejects maxLeverage=3 (Phase 7 default)", () => {
    // The constructor's user-override of maxLeverage=3 must throw.
    expect(
      () => new FundingCarryLeverageStrategy({ maxLeverage: 3 }),
    ).toThrow(/HARD GUARDRAIL/);
    expect(
      () => new FundingCarryLeverageStrategy({ maxLeverage: 5 }),
    ).toThrow(/HARD GUARDRAIL/);
    expect(
      () => new FundingCarryLeverageStrategy({ maxLeverage: 7 }),
    ).toThrow(/HARD GUARDRAIL/);
    // Explicitly allowed:
    expect(
      () => new FundingCarryLeverageStrategy({ maxLeverage: 1 }),
    ).not.toThrow();
    expect(
      () => new FundingCarryLeverageStrategy({ maxLeverage: 10 }),
    ).not.toThrow();
  });

  it("setEffectiveLeverage HARD GUARDRAIL rejects 5/7/etc.", () => {
    const strat = new FundingCarryLeverageStrategy();
    expect(() => strat.setEffectiveLeverage(5)).toThrow(/HARD GUARDRAIL/);
    expect(() => strat.setEffectiveLeverage(7)).toThrow(/HARD GUARDRAIL/);
    expect(() => strat.setEffectiveLeverage(3)).toThrow(/HARD GUARDRAIL/);
    expect(() => strat.setEffectiveLeverage(2)).toThrow(/HARD GUARDRAIL/);
    // 1 and 10 are allowed:
    expect(() => strat.setEffectiveLeverage(1)).not.toThrow();
    expect(() => strat.setEffectiveLeverage(10)).not.toThrow();
    expect(strat.state.currentLeverage).toBe(10);
  });

  it("computeDynamicLeverage returns maxAllowed when funding is at or below reference std-dev", () => {
    // At ref std-dev or below, the ratio is ≥ 1, so the result is maxAllowed.
    const strat = new FundingCarryLeverageStrategy({ fundingStabilityRefStdDev: 0.0005 });
    // Equal to reference → maxAllowed (10×) by the cap.
    expect(strat.computeDynamicLeverage(0.0005)).toBe(10);
    // Below reference → still maxAllowed (capped at 1.0).
    expect(strat.computeDynamicLeverage(0.0001)).toBe(10);
  });

  it("computeDynamicLeverage scales down when funding is volatile", () => {
    const strat = new FundingCarryLeverageStrategy({ fundingStabilityRefStdDev: 0.0005 });
    // Volatile 10× the reference → ratio 0.1 → suggested 1.0 → clamped to 1.
    expect(strat.computeDynamicLeverage(0.005)).toBe(1);
    // Volatile 2× the reference → ratio 0.5 → suggested 5.0 → floor 5.
    expect(strat.computeDynamicLeverage(0.001)).toBe(5);
  });

  it("computeDynamicLeverage enforces positive inputs (throws on bad inputs)", () => {
    const strat = new FundingCarryLeverageStrategy();
    expect(() => strat.computeDynamicLeverage(NaN)).toThrow(/finite/);
    expect(() => strat.computeDynamicLeverage(Infinity)).toThrow(/finite/);
    expect(() => strat.computeDynamicLeverage(0.0001, 0)).toThrow(/positive/);
    expect(() => strat.computeDynamicLeverage(0.0001, -0.0005)).toThrow(/positive/);
  });

  it("safeEffectiveLeverage floors at 1× when VaR cap violated (varCapOk=false)", () => {
    const strat = new FundingCarryLeverageStrategy();
    // Even though requested is 10×, if VaR cap is violated, returns 1×.
    expect(strat.safeEffectiveLeverage(10, 10, false)).toBe(1);
    expect(strat.safeEffectiveLeverage(5, 10, false)).toBe(1);
    // varCapOk=false always returns the floor (1×) regardless of inputs.
    expect(strat.safeEffectiveLeverage(3, 3, false, 1, 10)).toBe(1);
  });

  it("safeEffectiveLeverage honors requested leverage when VaR cap passes", () => {
    const strat = new FundingCarryLeverageStrategy();
    // With VaR cap passing: requested 10× is honored (clamped to max=10).
    expect(strat.safeEffectiveLeverage(10, 10, true)).toBe(10);
    // Stable multiplier caps it lower (5) → result is min(5, 10) = 5.
    expect(strat.safeEffectiveLeverage(5, 10, true)).toBe(5);
    // Requested 1× when VaR passes → result is min(10, 1) = 1.
    expect(strat.safeEffectiveLeverage(10, 1, true)).toBe(1);
  });

  it("safeEffectiveLeverage clamps requested leverage to [min, max]", () => {
    const strat = new FundingCarryLeverageStrategy();
    // minAllowed=1, maxAllowed=10 → 99 clamped to 10.
    expect(strat.safeEffectiveLeverage(99, 99, true, 1, 10)).toBe(10);
    // 0.5 → clamp up to 1.
    expect(strat.safeEffectiveLeverage(0.5, 0.5, true, 1, 10)).toBe(1);
    // Negative → clamp up to 1.
    expect(strat.safeEffectiveLeverage(-5, -5, true, 1, 10)).toBe(1);
  });

  it("10× efficiency ratio vs 1× baseline ≈ 10× on stable funding (linear scaling)", () => {
    // Edge case: at 1× and at 10× with the same funding stream, the
    // funding collected scales linearly — a sanity check on the
    // "100% efficiency" claim for stable, deterministic carry.
    const stableFunding = 0.0001; // 0.01% per 8h
    const baseNotional = 10_000;

    const strat1x = new FundingCarryLeverageStrategy({ baseNotionalUsd: baseNotional });
    strat1x.setEffectiveLeverage(1);

    const strat10x = new FundingCarryLeverageStrategy({ baseNotionalUsd: baseNotional });
    strat10x.setEffectiveLeverage(10);

    for (let i = 0; i < 100; i++) {
      strat10x.accrueFundingScaled(stableFunding, 1 + i * 28_800_000);
      strat1x.accrueFundingScaled(stableFunding, 1 + i * 28_800_000);
    }
    const ratio = strat10x.state.fundingCollectedUsd / strat1x.state.fundingCollectedUsd;
    expect(ratio).toBeCloseTo(10.0, 4); // 100% linear scaling at stable funding.
  });

  it("computeEffectiveLeverage respects the 1:10 mandate (caps at 10×)", () => {
    // Stable funding + stable returns → suggests 10× → capped at 10 (1:10).
    const strat = new FundingCarryLeverageStrategy({ maxLeverage: 10 });
    const stableFunding = stableZeroSeries(60);
    const stableReturns = zeroReturns(60);
    const lev = strat.computeEffectiveLeverage(stableFunding, stableReturns, 10_000);
    expect(lev).toBe(10);
    // Wild returns → cap = 0 → floor at 1.
    const wildReturns = Array.from({ length: 60 }, (_, i) =>
      Math.sin(i * 2.3) * 0.07 + 0.001,
    );
    const levFloor = strat.computeEffectiveLeverage(stableFunding, wildReturns, 10_000);
    expect(levFloor).toBe(1);
  });

  it("totalNetPnlUsd = funding collected - rebalance costs", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    strat.setEffectiveLeverage(10);
    strat.accrueFundingScaled(0.0001, 1_700_000_000_000); // +$10
    strat.triggerRebalance(1_000); // cost ~$20
    const net = strat.totalNetPnlUsd();
    const expected = strat.state.fundingCollectedUsd - strat.state.rebalanceCostUsd;
    expect(net).toBeCloseTo(expected, 6);
    expect(net).toBeLessThan(0); // costs > funding initially
  });
});
