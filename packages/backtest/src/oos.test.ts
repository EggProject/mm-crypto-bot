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
  fetchOHLCV(
    _symbol: string,
    _timeframe: Timeframe,
    _options: { readonly since?: number; readonly limit?: number },
  ): Promise<readonly Candle[]> {
    return Promise.resolve(this.candles);
  }
}

class NullStrategy implements Strategy {
  readonly name = "null";
  readonly timeframes = ["1h"] as const;
  onCandle(_context: StrategyContext): StrategySignal | null {
    // eslint-disable-next-line unicorn/no-null -- Strategy's public no-signal contract requires null.
    return null;
  }
  warmup(): number {
    return 0;
  }
}

class StatefulProbeStrategy implements Strategy {
  readonly name = "stateful-probe";
  readonly timeframes = ["1h"] as const;
  calls = 0;

  onCandle(_context: StrategyContext): StrategySignal | null {
    this.calls += 1;
    // eslint-disable-next-line unicorn/no-null -- Strategy's public no-signal contract requires null.
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

async function expectWalkForwardFailure(operation: () => Promise<unknown>): Promise<void> {
  let receivedError: unknown;
  try {
    await operation();
  } catch (error: unknown) {
    receivedError = error;
  }
  expect(receivedError).toBeInstanceOf(Error);
}

function requireFirst<T>(items: readonly T[], label: string): T {
  const item = items.at(0);
  if (item === undefined) {
    throw new Error(`Expected ${label} to contain an item.`);
  }
  return item;
}

describe("runWalkForward", () => {
  it("pozitív day-értékeket vár", async () => {
    const candles: Candle[] = [];
    for (let index = 0; index < 1000; index++) {
      candles.push(mkCandle(index * 60 * 60 * 1000, 100 + index));
    }
    const feed = new MockFeed(candles);
    const options: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(1000 * 60 * 60 * 1000),
      initialEquityUsd: 10_000,
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
    await expectWalkForwardFailure(() => runWalkForward(options, wf));
  });

  it("kis periódusra: nincs elég window", async () => {
    const candles: Candle[] = [];
    for (let index = 0; index < 100; index++) {
      candles.push(mkCandle(index * 60 * 60 * 1000, 100 + index));
    }
    const feed = new MockFeed(candles);
    const options: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(100 * 60 * 60 * 1000),
      initialEquityUsd: 10_000,
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
    await expectWalkForwardFailure(() => runWalkForward(options, wf));
  });

  it("sikeresen futtatja a walk-forward ablakokat", async () => {
    // 30 nap candle, 24 candle/nap, összesen 720 candle.
    const candles: Candle[] = [];
    for (let index = 0; index < 30 * 24; index++) {
      candles.push(mkCandle(index * 60 * 60 * 1000, 100 + index));
    }
    const feed = new MockFeed(candles);
    const options: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(30 * 24 * 60 * 60 * 1000),
      initialEquityUsd: 10_000,
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
    const result = await runWalkForward(options, wf);
    // A 30 napos tartományba 10+5+5+5+5 = 30 nap fér bele (3 ablak, 5 lépésenként).
    expect(result.windowCount).toBeGreaterThan(0);
    expect(result.avgIsSharpe).toBe(0);
    expect(result.avgOosSharpe).toBe(0);
    expect(result.oosIsSharpeRatio).toBe(0);
  });

  it("az egymás melletti IS/OOS ablakok határgyertyái diszjunktak és együtt lefedik a teljes tartományt", async () => {
    const hourMs = 60 * 60 * 1000;
    const candles = Array.from({ length: 48 }, (_, hour) => mkCandle(hour * hourMs, 100));
    const options: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(48 * hourMs),
      initialEquityUsd: 10_000,
      feed: new MockFeed(candles),
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new NullStrategy(),
    };

    const result = await runWalkForward(options, {
      inSampleDays: 1,
      outOfSampleDays: 1,
      stepDays: 1,
    });

    expect(result.windowCount).toBe(1);
    const inSampleCandleOpenTimestamps = requireFirst(result.isResults, "in-sample results")
      .equityCurve.slice(1)
      .map((point) => point.timestamp - hourMs);
    const oosCandleOpenTimestamps = requireFirst(result.oosResults, "out-of-sample results")
      .equityCurve.slice(1)
      .map((point) => point.timestamp - hourMs);
    expect(inSampleCandleOpenTimestamps).toEqual(Array.from({ length: 24 }, (_, hour) => hour * hourMs));
    expect(oosCandleOpenTimestamps).toEqual(Array.from({ length: 24 }, (_, hour) => (24 + hour) * hourMs));
    expect(
      inSampleCandleOpenTimestamps.filter((timestamp) => oosCandleOpenTimestamps.includes(timestamp)),
    ).toEqual([]);
    expect([...inSampleCandleOpenTimestamps, ...oosCandleOpenTimestamps]).toEqual(
      candles.map((item) => item.timestamp),
    );
  });

  it("strategy factoryval minden IS és OOS futás friss stratégiapéldányt kap", async () => {
    const hourMs = 60 * 60 * 1000;
    const candles = Array.from({ length: 72 }, (_, hour) => mkCandle(hour * hourMs, 100));
    const instances: StatefulProbeStrategy[] = [];
    const createStrategy = (): StatefulProbeStrategy => {
      const strategy = new StatefulProbeStrategy();
      instances.push(strategy);
      return strategy;
    };
    const options: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(72 * hourMs),
      initialEquityUsd: 10_000,
      feed: new MockFeed(candles),
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      // The base strategy instance intentionally differs from the factory output. The
      // factory must override it without mutating the caller's base options.
      strategy: new NullStrategy(),
    };

    const result = await runWalkForward(
      options,
      {
        inSampleDays: 1,
        outOfSampleDays: 1,
        stepDays: 1,
      },
      createStrategy,
    );

    expect(result.windowCount).toBe(2);
    expect(instances).toHaveLength(4);
    expect(new Set(instances).size).toBe(4);
    expect(instances.map((strategy) => strategy.calls)).toEqual([24, 24, 24, 24]);
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
