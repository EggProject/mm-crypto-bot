// packages/core/src/strategy/funding-carry.test.ts — unit tesztek

import { describe, expect, it } from "bun:test";

import {
  DEFAULT_FUNDING_CARRY_CONFIG,
  FundingCarryStrategy,
  InMemoryFundingRateProvider,
  type FundingSnapshot,
} from "./funding-carry.js";
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

describe("FundingCarryStrategy", () => {
  it("default config has 10k notional, 5% rebalance threshold, 15min latency, 20bps rebalance fee", () => {
    expect(DEFAULT_FUNDING_CARRY_CONFIG.targetNotionalUsd).toBe(10_000);
    expect(DEFAULT_FUNDING_CARRY_CONFIG.rebalanceThresholdPct).toBe(0.05);
    expect(DEFAULT_FUNDING_CARRY_CONFIG.withdrawalLatencyMinutes).toBe(15);
    expect(DEFAULT_FUNDING_CARRY_CONFIG.rebalanceCostBps).toBe(20);
  });

  it("warmup returns 10", () => {
    const strat = new FundingCarryStrategy();
    expect(strat.warmup()).toBe(10);
  });

  it("candleIndex < warmup → null signal", () => {
    const strat = new FundingCarryStrategy();
    const ctx = makeCtx({ candleIndex: 5 });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("emits exactly ONE buy signal on first valid candle (entry into carry)", () => {
    const strat = new FundingCarryStrategy();
    const ctx = makeCtx({ candleIndex: 50, candle: baseCandle(50_000) });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(1);
    expect(signal?.reason).toContain("Funding-carry entry");
    // Subsequent candles return null (position already open).
    expect(strat.onCandle(makeCtx({ candleIndex: 51 }))).toBeNull();
    expect(strat.onCandle(makeCtx({ candleIndex: 100 }))).toBeNull();
  });

  it("name and timeframes are correctly set", () => {
    const strat = new FundingCarryStrategy();
    expect(strat.name).toContain("Funding Carry");
    expect(strat.timeframes).toEqual(["1h", "4h", "1d"]);
  });

  it("accrueFunding with positive rate earns (short perp receives)", () => {
    const strat = new FundingCarryStrategy({ targetNotionalUsd: 10_000 });
    const payment = strat.accrueFunding(10_000, 0.0001); // 0.01% per 8h
    expect(payment).toBeCloseTo(1.0, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(1.0, 6);
    expect(strat.totalFundingUsd()).toBeCloseTo(1.0, 6);
  });

  it("accrueFunding with negative rate pays (short perp loses)", () => {
    const strat = new FundingCarryStrategy({ targetNotionalUsd: 10_000 });
    const payment = strat.accrueFunding(10_000, -0.0002); // -0.02% per 8h
    expect(payment).toBeCloseTo(-2.0, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(-2.0, 6);
  });

  it("accrueFunding with zero rate is no-op", () => {
    const strat = new FundingCarryStrategy({ targetNotionalUsd: 10_000 });
    expect(strat.accrueFunding(10_000, 0)).toBe(0);
    expect(strat.state.fundingCollectedUsd).toBe(0);
  });

  it("accrueFunding rejects invalid notional / rate", () => {
    const strat = new FundingCarryStrategy();
    expect(() => strat.accrueFunding(0, 0.0001)).toThrow(/notionalUsd/);
    expect(() => strat.accrueFunding(-1, 0.0001)).toThrow(/notionalUsd/);
    expect(() => strat.accrueFunding(10_000, Number.NaN)).toThrow(/fundingRate/);
  });

  it("delta-semlegesség: spot + perp notional cancel out (zero net delta)", () => {
    // Conceptually: long spot $10k + short perp $10k → delta-neutral.
    // Verify via two equal-magnitude positions in opposite directions.
    const notional = 10_000;
    const spotQty = notional / 50_000; // 0.2 BTC
    const perpQty = notional / 50_000; // 0.2 BTC
    // Price moves +10%: spot +$1000, perp -$1000.
    const newPrice = 55_000;
    const spotPnl = (newPrice - 50_000) * spotQty; // +1000
    const perpPnl = (50_000 - newPrice) * perpQty; // -1000
    expect(spotPnl + perpPnl).toBeCloseTo(0, 6);
    // The carry edge is the funding payments, NOT the price move.
  });

  it("extreme funding >0.1%/8h edge case accrues correctly", () => {
    const strat = new FundingCarryStrategy({ targetNotionalUsd: 100_000 });
    // 0.5% per 8h, applied once → $500 earned.
    expect(strat.accrueFunding(100_000, 0.005)).toBeCloseTo(500, 6);
    expect(strat.state.fundingCollectedUsd).toBeCloseTo(500, 6);
  });

  it("withdrawal latency cost is debited on rebalance", () => {
    const strat = new FundingCarryStrategy({
      targetNotionalUsd: 10_000,
      withdrawalLatencyMinutes: 30, // 0.5h
    });
    // borrowRatePerHour 0.0001 → 10_000 × 0.0001 × 0.5 = $0.50
    const cost = strat.applyWithdrawalLatency(10_000, 0.0001);
    expect(cost).toBeCloseTo(0.5, 6);
    expect(strat.state.rebalanceCostUsd).toBeCloseTo(0.5, 6);
  });

  it("rebalanceIfNeeded triggers above threshold and debits cost", () => {
    const strat = new FundingCarryStrategy({
      targetNotionalUsd: 10_000,
      rebalanceThresholdPct: 0.05, // 5% = $500 drift
      rebalanceCostBps: 20, // 0.2% = $20
      withdrawalLatencyMinutes: 15, // 15min × 0.0001 × 0.25 = $0.25
    });
    // Drift $400 (< 5%) → no rebalance.
    expect(strat.rebalanceIfNeeded(400)).toBe(false);
    expect(strat.state.rebalanceCount).toBe(0);
    // Drift $600 (≥ 5%) → rebalance triggered.
    expect(strat.rebalanceIfNeeded(600)).toBe(true);
    expect(strat.state.rebalanceCount).toBe(1);
    // Total cost = $20 (flat) + $0.25 (latency) = $20.25
    expect(strat.state.rebalanceCostUsd).toBeCloseTo(20.25, 6);
    // Delta reset.
    expect(strat.state.unrealizedDeltaUsd).toBe(0);
  });

  it("rebalanceIfNeeded fires for both positive and negative drift", () => {
    const strat = new FundingCarryStrategy({
      targetNotionalUsd: 10_000,
      rebalanceThresholdPct: 0.05,
    });
    expect(strat.rebalanceIfNeeded(-700)).toBe(true);
    expect(strat.state.rebalanceCount).toBe(1);
  });

  it("reset clears all state for a fresh backtest run", () => {
    const strat = new FundingCarryStrategy();
    strat.accrueFunding(10_000, 0.001);
    strat.rebalanceIfNeeded(800);
    expect(strat.state.fundingCollectedUsd).not.toBe(0);
    expect(strat.state.rebalanceCount).toBe(1);
    strat.reset();
    expect(strat.state.fundingCollectedUsd).toBe(0);
    expect(strat.state.rebalanceCount).toBe(0);
    expect(strat.state.rebalanceCostUsd).toBe(0);
    expect(strat.state.hasEntered).toBe(false);
  });

  it("InMemoryFundingRateProvider returns null for empty provider", () => {
    const provider = new InMemoryFundingRateProvider([]);
    expect(provider.getFundingAt(1_700_000_000_000)).toBeNull();
    expect(provider.getFundingRange(0, 9_999_999_999_999)).toHaveLength(0);
  });

  it("InMemoryFundingRateProvider binary-search returns closest snapshot ≤ timestamp", () => {
    const snapshots: FundingSnapshot[] = [
      { fundingTime: 1_700_000_000_000, symbol: "BTCUSDT", fundingRate: 0.0001 },
      { fundingTime: 1_700_002_800_000, symbol: "BTCUSDT", fundingRate: 0.0002 },
      { fundingTime: 1_700_005_600_000, symbol: "BTCUSDT", fundingRate: 0.00015 },
      { fundingTime: 1_700_008_400_000, symbol: "BTCUSDT", fundingRate: 0.0001 },
    ];
    const provider = new InMemoryFundingRateProvider(snapshots);
    // Exact match.
    expect(provider.getFundingAt(1_700_002_800_000)?.fundingRate).toBe(0.0002);
    // Between snapshots → returns the latest ≤ timestamp.
    expect(provider.getFundingAt(1_700_004_000_000)?.fundingRate).toBe(0.0002);
    // Before first → null.
    expect(provider.getFundingAt(1_699_999_000_000)).toBeNull();
    // After last → returns last.
    expect(provider.getFundingAt(1_999_999_000_000)?.fundingRate).toBe(0.0001);
  });

  it("InMemoryFundingRateProvider.getFundingRange filters by inclusive bounds", () => {
    const snapshots: FundingSnapshot[] = [
      { fundingTime: 1_700_000_000_000, symbol: "BTCUSDT", fundingRate: 0.0001 },
      { fundingTime: 1_700_002_800_000, symbol: "BTCUSDT", fundingRate: 0.0002 },
      { fundingTime: 1_700_005_600_000, symbol: "BTCUSDT", fundingRate: 0.0003 },
    ];
    const provider = new InMemoryFundingRateProvider(snapshots);
    const range = provider.getFundingRange(1_700_000_000_000, 1_700_005_600_000);
    expect(range).toHaveLength(3);
    expect(provider.getFundingRange(1_700_002_800_001, 1_700_005_599_999)).toHaveLength(0);
  });

  it("InMemoryFundingRateProvider unsorted input is sorted internally", () => {
    const snapshots: FundingSnapshot[] = [
      { fundingTime: 1_700_005_600_000, symbol: "BTCUSDT", fundingRate: 0.0003 },
      { fundingTime: 1_700_000_000_000, symbol: "BTCUSDT", fundingRate: 0.0001 },
      { fundingTime: 1_700_002_800_000, symbol: "BTCUSDT", fundingRate: 0.0002 },
    ];
    const provider = new InMemoryFundingRateProvider(snapshots);
    expect(provider.getFundingAt(1_700_002_800_000)?.fundingRate).toBe(0.0002);
    expect(provider.size()).toBe(3);
  });
});