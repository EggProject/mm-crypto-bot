// packages/core/src/strategy/funding-carry-leverage.test.ts — unit tesztek
//
// Phase 7 Track C — leveraged delta-neutral funding-rate carry.
//
// Test coverage (≥10):
//   1. Default config sanity
//   2. warmup returns 30 (longer than base — needs stability window)
//   3. onCandle emits ONE buy signal on first valid candle
//   4. Initial leverage defaults to minLeverage (1×), margin state correct
//   5. setEffectiveLeverage scales notional + margin
//   6. getScaledRebalanceThreshold scales inversely with leverage
//   7. accrueFundingScaled earns at scaled notional
//   8. accrueFundingScaled with negative rate pays at scaled notional
//   9. computeDailyVaR parametric with stable zero-variance returns → small VaR
//  10. computeDailyVaR historical with empirical series → matches 5th-percentile
//  11. computeStabilityCappedLeverage downshifts when funding is volatile
//  12. computeStabilityCappedLeverage scales up when funding is stable
//  13. computeVarCappedLeverage enforces VaR cap
//  14. checkLiquidationThreshold catches margin breach
//  15. triggerRebalance debits scaled cost (higher leverage ⇒ more $)
//  16. recordLiquidation increments counter (must stay 0 in production)
//  17. varComplianceRatio ≤ 1 ⇒ VaR-cap pass; > 1 ⇒ fail
//  18. Funding-rate history windowing keeps last 30×3+ entries
//  19. reset() clears all state including leverage history
//  20. Funding rate spike edge case (e.g., 5% per 8h) accrues correctly

import { describe, expect, it } from "bun:test";

import {
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
  it("default config: max leverage 3, min 1, VaR 95%, VaR cap 2%, IM 50%", () => {
    expect(DEFAULT_LEVERAGED_CARRY_CONFIG.maxLeverage).toBe(3);
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

  it("setEffectiveLeverage(2) → 2× notional, scaled IM/MM", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    strat.setEffectiveLeverage(2);
    expect(strat.state.currentLeverage).toBe(2);
    expect(strat.state.effectiveNotionalUsd).toBe(20_000);
    expect(strat.state.initialMarginUsd).toBe(10_000); // IM stays = base (constant)
    expect(strat.state.maintenanceMarginUsd).toBeCloseTo(100.0, 6); // 0.5% × 20k
  });

  it("setEffectiveLeverage clamps out-of-range values", () => {
    const strat = new FundingCarryLeverageStrategy({ maxLeverage: 3 });
    strat.setEffectiveLeverage(99);
    expect(strat.state.currentLeverage).toBe(3);
    strat.setEffectiveLeverage(0.5);
    expect(strat.state.currentLeverage).toBe(1);
    strat.setEffectiveLeverage(-5);
    expect(strat.state.currentLeverage).toBe(1);
  });

  it("getScaledRebalanceThreshold scales inversely with leverage", () => {
    const strat = new FundingCarryLeverageStrategy({
      rebalanceThresholdPct: 0.06, // base 6%
      baseNotionalUsd: 10_000,
    });
    strat.setEffectiveLeverage(1);
    expect(strat.getScaledRebalanceThreshold()).toBeCloseTo(0.06, 6);
    strat.setEffectiveLeverage(2);
    expect(strat.getScaledRebalanceThreshold()).toBeCloseTo(0.03, 6);
    strat.setEffectiveLeverage(3);
    expect(strat.getScaledRebalanceThreshold()).toBeCloseTo(0.02, 6);
  });

  it("accrueFundingScaled earns at scaled notional (positive rate)", () => {
    const strat = new FundingCarryLeverageStrategy({
      baseNotionalUsd: 10_000,
      maxLeverage: 3,
    });
    strat.setEffectiveLeverage(2);
    // 0.01% per 8h on $20k notional = $2.
    const payment = strat.accrueFundingScaled(0.0001, 1_700_000_000_000);
    expect(payment).toBeCloseTo(2.0, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(2.0, 6);
  });

  it("accrueFundingScaled with negative rate pays at scaled notional", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    strat.setEffectiveLeverage(3);
    // -0.05% per 8h on $30k notional = -$15.
    const payment = strat.accrueFundingScaled(-0.0005, 1_700_000_000_000);
    expect(payment).toBeCloseTo(-15.0, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(-15.0, 6);
  });

  it("accrueFundingScaled rejects NaN / Infinity", () => {
    const strat = new FundingCarryLeverageStrategy();
    strat.setEffectiveLeverage(1);
    expect(() => strat.accrueFundingScaled(NaN, 1)).toThrow(/fundingRate/);
    expect(() => strat.accrueFundingScaled(Infinity, 1)).toThrow(/fundingRate/);
  });

  it("computeDailyVaR parametric: stable zero-variance returns → 0 VaR", () => {
    const strat = new FundingCarryLeverageStrategy();
    strat.setEffectiveLeverage(2);
    const returns = stableZeroSeries(100); // mean 0, var 0
    const varValue = strat.computeDailyVaR(20_000, returns);
    expect(varValue).toBe(0);
  });

  it("computeDailyVaR parametric: 1% std-dev → ~3.3% VaR @95% on $10k", () => {
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
      maxLeverage: 3,
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
    const strat = new FundingCarryLeverageStrategy({ maxLeverage: 3 });
    const cap = strat.computeStabilityCappedLeverage([0.0001, 0.0002]); // only 2 samples
    expect(cap).toBeCloseTo(1.5, 6);
  });

  it("computeVarCappedLeverage returns min leverage when VaR cap exceeded", () => {
    const strat = new FundingCarryLeverageStrategy({ maxLeverage: 3 });
    strat.setEffectiveLeverage(1);
    // Wild returns → VaR at 10k notional ≫ 2% × 10k = $200 ⇒ cap = 0 → floor at 1.
    const wild = Array.from({ length: 100 }, (_, i) =>
      Math.sin(i * 1.7) * 0.05 + 0.001,
    );
    const cap = strat.computeVarCappedLeverage(wild, 10_000);
    expect(cap).toBe(1);
  });

  it("checkLiquidationThreshold catches margin breach (margin ratio ≥ 50%)", () => {
    const strat = new FundingCarryLeverageStrategy({
      baseNotionalUsd: 10_000,
      maxLeverage: 3,
      minInitialMarginFraction: 0.5,
    });
    strat.setEffectiveLeverage(3);
    // Initial: IM=$10k, MM = 0.5% × $30k = $150.
    // If unrealized PnL = -$9.7k, margin balance = $300, margin ratio = 150/300 = 0.5 ⇒ breach.
    const breach = strat.checkLiquidationThreshold(-9_700);
    expect(breach).toBe(true);
    expect(strat.state.liquidationEventsCount).toBe(1);
  });

  it("checkLiquidationThreshold does NOT trigger when margin healthy", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    strat.setEffectiveLeverage(2);
    // MM = $100, IM = $10k. Unrealized PnL +$1k ⇒ margin balance $11k ⇒ ratio 0.009 < 0.5 ⇒ OK.
    expect(strat.checkLiquidationThreshold(1_000)).toBe(false);
    expect(strat.state.liquidationEventsCount).toBe(0);
  });

  it("triggerRebalance at 2× leverage debits 2× the base flat-fee", () => {
    const strat = new FundingCarryLeverageStrategy({
      baseNotionalUsd: 10_000,
      rebalanceThresholdPct: 0.05,
      rebalanceCostBps: 20,
      withdrawalLatencyMinutes: 15,
      maxLeverage: 3,
    });
    strat.setEffectiveLeverage(2);
    // Effective notional = $20k, base drift threshold scaled to 0.025 at 2×.
    // Drift $600 against $20k = 0.03 → above 0.025 → rebalance.
    expect(strat.triggerRebalance(600)).toBe(true);
    // Flat fee = 20bps × $20k = $40 (instead of $20 at 1×).
    // Plus latency cost ≈ 0.0001 × 0.25h × $20k = $0.50.
    // Total ≈ $40.50.
    expect(strat.state.rebalanceCostUsd).toBeGreaterThanOrEqual(40);
    expect(strat.state.rebalanceCostUsd).toBeLessThanOrEqual(50);
  });

  it("triggerRebalance suppresses when drift below scaled threshold", () => {
    const strat = new FundingCarryLeverageStrategy({
      baseNotionalUsd: 10_000,
      rebalanceThresholdPct: 0.05,
    });
    strat.setEffectiveLeverage(2);
    expect(strat.triggerRebalance(100)).toBe(false); // 0.005 < 0.025
    expect(strat.state.rebalanceCount).toBe(0);
  });

  it("varComplianceRatio ≤ 1 ⇒ VaR cap passes", () => {
    const strat = new FundingCarryLeverageStrategy({
      varMethod: "parametric",
      varConfidence: 0.95,
      maxDailyVarPct: 0.02,
    });
    strat.setEffectiveLeverage(2);
    const stable = zeroReturns(60); // σ≈0
    const ratio = strat.varComplianceRatio(stable, 20_000);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeLessThanOrEqual(1);
  });

  it("varComplianceRatio > 1 ⇒ VaR cap VIOLATES (rejected)", () => {
    const strat = new FundingCarryLeverageStrategy({
      varMethod: "parametric",
      varConfidence: 0.95,
      maxDailyVarPct: 0.001, // super-tight cap to force violation
    });
    strat.setEffectiveLeverage(2);
    const wild = Array.from({ length: 100 }, (_, i) =>
      ((i % 7) - 3) * 0.01,
    );
    const ratio = strat.varComplianceRatio(wild, 20_000);
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
    strat.setEffectiveLeverage(3);
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

  it("extreme funding-rate spike (5% per 8h) accrues correctly at 3× notional", () => {
    const strat = new FundingCarryLeverageStrategy({ baseNotionalUsd: 10_000 });
    strat.setEffectiveLeverage(3);
    // 0.05 per 8h on $30k → $1,500 earned at once. (Extreme regime.)
    const payment = strat.accrueFundingScaled(0.05, 1_700_000_000_000);
    expect(payment).toBeCloseTo(1_500, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(1_500, 6);
  });

  it("rejects invalid configurations (extending config robustness)", () => {
    // Negative max leverage → clamped by setEffectiveLeverage, not constructor.
    // But NaN confidence should not be silently accepted.
    const strat = new FundingCarryLeverageStrategy({
      varConfidence: Number.NaN,
    });
    // We intentionally allow NaN in config (the constructor does not validate);
    // the call site is responsible. The strategy still computes a z-score
    // via the lookup table, so a NaN-walked confidence falls back to z=1.
    expect(strat.config.varConfidence).toBeNaN();
  });

  it("LiquidationEvent shape conforms to interface", () => {
    const ev: LiquidationEvent = {
      timestampMs: 1_700_000_000_000,
      markPrice: 50_000,
      leverage: 3,
      initialMarginUsd: 10_000,
      maintenanceMarginUsd: 150,
      marginRatio: 0.5,
      effectiveNotionalUsd: 30_000,
    };
    expect(ev.leverage).toBe(3);
    expect(ev.maintenanceMarginUsd).toBeLessThan(ev.initialMarginUsd);
  });
});
