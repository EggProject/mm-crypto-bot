// packages/backtest/src/oos.test.ts — a walk-forward OOS validáció unit-tesztek
//
// A tesztekben a CCXT `fetchOHLCV` mockolva van. Az OOS validáció a
// `runBacktest` motorra épül, tehát az integrációs tesztek itt is
// hasznosak.
//
// Specifikáció: docs/research/selected-strategy.md §8.1.

import { describe, expect, it } from "bun:test";

import type { Candle, Timeframe } from "@mm-crypto-bot/shared/types";

import type { BacktestOptions, CostModel, ExchangeFeed, WalkForwardConfig } from "./types.js";

import { runWalkForward, computeOosIsRatio } from "./oos.js";
import type { Strategy, StrategyContext, StrategySignal } from "@mm-crypto-bot/core";

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
};

function mkCandle(timestamp: number, price: number): Candle {
  return {
    timestamp,
    open: price,
    high: price * 1.01,
    low: price * 0.99,
    close: price,
    volume: 1000,
  };
}

class MockFeed implements ExchangeFeed {
  constructor(private readonly candles: readonly Candle[]) {}
  async fetchOHLCV(
    _symbol: string,
    _timeframe: Timeframe,
    _options: { readonly since?: number; readonly limit?: number },
  ): Promise<readonly Candle[]> {
    return this.candles;
  }
}

class NullStrategy implements Strategy {
  readonly name = "null";
  readonly timeframes = ["1h"] as const;
  onCandle(_ctx: StrategyContext): StrategySignal | null {
    return null;
  }
  warmup(): number {
    return 0;
  }
}

const POSITION_SIZE = {
  riskPerTrade: 0.01,
  kellyFraction: 0.25,
  maxDrawdown: 0.15,
  maxPositionPctEquity: 0.2,
  minPositionPctEquity: 0.01,
};

describe("runWalkForward", () => {
  it("pozitív day-értékeket vár", async () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 1000; i++) {
      candles.push(mkCandle(i * 60 * 60 * 1000, 100 + i));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(1000 * 60 * 60 * 1000),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new NullStrategy(),
    };
    const wf: WalkForwardConfig = {
      inSampleDays: 0,
      outOfSampleDays: 1,
      stepDays: 1,
    };
    await expect(runWalkForward(opts, wf)).rejects.toThrow();
  });

  it("kis periódusra: nincs elég window", async () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 100; i++) {
      candles.push(mkCandle(i * 60 * 60 * 1000, 100 + i));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(100 * 60 * 60 * 1000),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new NullStrategy(),
    };
    const wf: WalkForwardConfig = {
      inSampleDays: 30,
      outOfSampleDays: 7,
      stepDays: 1,
    };
    await expect(runWalkForward(opts, wf)).rejects.toThrow();
  });

  it("sikeresen futtatja a walk-forward ablakokat", async () => {
    // 30 nap candle, 24 candle/nap, összesen 720 candle.
    const candles: Candle[] = [];
    for (let i = 0; i < 30 * 24; i++) {
      candles.push(mkCandle(i * 60 * 60 * 1000, 100 + i));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(30 * 24 * 60 * 60 * 1000),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new NullStrategy(),
    };
    const wf: WalkForwardConfig = {
      inSampleDays: 10,
      outOfSampleDays: 5,
      stepDays: 5,
    };
    const result = await runWalkForward(opts, wf);
    // A 30 napos tartományba 10+5+5+5+5 = 30 nap fér bele (3 ablak, 5 lépésenként).
    expect(result.windowCount).toBeGreaterThan(0);
    expect(result.avgIsSharpe).toBe(0);
    expect(result.avgOosSharpe).toBe(0);
    expect(result.oosIsSharpeRatio).toBe(0);
  });
});

describe("computeOosIsRatio", () => {
  it("ha az IS Sharpe > 0, kiszámítja az arányt", () => {
    expect(computeOosIsRatio(2, 1)).toBe(2);
  });

  it("ha az IS Sharpe = 0, 0-t ad vissza (NaN elkerülése)", () => {
    expect(computeOosIsRatio(1, 0)).toBe(0);
  });

  it("ha az IS Sharpe < 0, 0-t ad vissza (NaN elkerülése)", () => {
    expect(computeOosIsRatio(1, -1)).toBe(0);
  });
});
