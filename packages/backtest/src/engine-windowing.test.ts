import { describe, expect, it } from "bun:test";

import type { Strategy, StrategyContext, StrategySignal } from "@mm-crypto-bot/core";
import type { Candle, Timeframe } from "@mm-crypto-bot/shared/types";

import { runBacktest } from "./engine.js";
import type { BacktestOptions, CostModel, ExchangeFeed } from "./types.js";

const HOUR = 60 * 60 * 1000;

const ZERO_COST: CostModel = {
  takerFeeRate: 0,
  slippageRate: 0,
  spreadRate: 0,
  borrowRatePerHour: 0,
  fundingRatePer8h: 0,
};

const COSTLY_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.001,
  spreadRate: 0.002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0.008,
};

const POSITION_SIZE = {
  riskPerTrade: 0.01,
  kellyFraction: 0.25,
  maxDrawdown: 0.5,
  maxPositionPctEquity: 0.2,
  minPositionPctEquity: 0.01,
};

function candle(hour: number, close: number): Candle {
  return { timestamp: hour * HOUR, open: close, high: close, low: close, close, volume: 1 };
}

class Feed implements ExchangeFeed {
  public requestedSince: number | undefined;
  constructor(private readonly candles: readonly Candle[]) {}

  async fetchOHLCV(
    _symbol: string,
    _timeframe: Timeframe,
    options: { readonly since?: number; readonly limit?: number },
  ): Promise<readonly Candle[]> {
    this.requestedSince = options.since;
    // Deliberately ignore since: the engine, rather than an individual feed,
    // owns the backtest-window invariant.
    return this.candles;
  }
}

class RecordingStrategy implements Strategy {
  readonly name = "recording";
  readonly timeframes = ["1h"] as const;
  readonly seen: { timestamp: number; htfClose: number | undefined; mtfClose: number | undefined }[] = [];

  onCandle(ctx: StrategyContext): StrategySignal | null {
    this.seen.push({
      timestamp: ctx.candle.timestamp,
      htfClose: ctx.mtfState.htf.close,
      mtfClose: ctx.mtfState.mtf.close,
    });
    return null;
  }

  warmup(): number {
    return 0;
  }
}

class OpenOnceStrategy implements Strategy {
  readonly name = "open-once";
  readonly timeframes = ["1h"] as const;
  private opened = false;
  constructor(
    private readonly stopLoss: number,
    private readonly takeProfit: number,
  ) {}

  onCandle(_ctx: StrategyContext): StrategySignal | null {
    if (this.opened) return null;
    this.opened = true;
    return {
      side: "buy",
      confidence: 1,
      reason: "test",
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
    };
  }

  warmup(): number {
    return 0;
  }
}

function options(
  feed: ExchangeFeed,
  strategy: Strategy,
  startHour: number,
  endHour: number,
): BacktestOptions {
  return {
    symbol: "BTC/USDT",
    htfTimeframe: "4h",
    mtfTimeframe: "4h",
    ltfTimeframe: "1h",
    startTime: new Date(startHour * HOUR),
    endTime: new Date(endHour * HOUR),
    initialEquityUsd: 10_000,
    feed,
    costModel: ZERO_COST,
    positionSize: POSITION_SIZE,
    strategy,
  };
}

describe("runBacktest window and closed-candle invariants", () => {
  it("enforces the documented [startTime, endTime) candle-open window even when a feed returns extra data", async () => {
    const feed = new Feed([candle(1, 101), candle(2, 102), candle(3, 103), candle(4, 104)]);
    const strategy = new RecordingStrategy();

    await runBacktest(options(feed, strategy, 2, 4));

    expect(feed.requestedSince).toBe(2 * HOUR);
    expect(strategy.seen.map((item) => item.timestamp)).toEqual([2 * HOUR, 3 * HOUR]);
  });

  it("does not use a final candle that would close after a non-grid-aligned endTime", async () => {
    const feed = new Feed([candle(2, 102), candle(3, 103)]);
    const strategy = new RecordingStrategy();

    await runBacktest(options(feed, strategy, 2, 3.5));

    expect(strategy.seen.map((item) => item.timestamp)).toEqual([2 * HOUR]);
  });

  it("does not expose a 4h candle before its fourth 1h constituent has closed", async () => {
    const feed = new Feed([0, 1, 2, 3, 4, 5, 6, 7].map((hour) => candle(hour, 100 + hour)));
    const strategy = new RecordingStrategy();

    await runBacktest(options(feed, strategy, 0, 8));

    expect(strategy.seen.map((item) => item.htfClose)).toEqual([
      undefined,
      undefined,
      undefined,
      103,
      103,
      103,
      103,
      107,
    ]);
    expect(strategy.seen.map((item) => item.mtfClose)).toEqual([
      undefined,
      undefined,
      undefined,
      103,
      103,
      103,
      103,
      107,
    ]);
  });

  it("never exposes an incomplete terminal 4h bucket", async () => {
    const feed = new Feed([0, 1, 2, 3, 4, 5].map((hour) => candle(hour, 100 + hour)));
    const strategy = new RecordingStrategy();

    await runBacktest(options(feed, strategy, 0, 6));

    expect(strategy.seen.map((item) => item.htfClose)).toEqual([
      undefined,
      undefined,
      undefined,
      103,
      103,
      103,
    ]);
  });

  it("rejects context timeframes that are not whole LTF multiples", async () => {
    const feed = new Feed([candle(0, 100), candle(4, 104)]);
    const strategy = new RecordingStrategy();

    await expect(
      runBacktest({
        ...options(feed, strategy, 0, 8),
        ltfTimeframe: "4h",
        htfTimeframe: "1h",
        mtfTimeframe: "4h",
      }),
    ).rejects.toThrow("HTF and MTF timeframes must be whole multiples of the LTF timeframe");
  });

  it("does not aggregate a bucket with duplicate candles standing in for a missing interval", async () => {
    // Four records alone are insufficient evidence for a closed 4h candle:
    // this has two 03:00 records and no 02:00 record.  Treating it as a
    // complete HTF candle would leak a malformed close into the strategy.
    const feed = new Feed([candle(0, 100), candle(1, 101), candle(3, 103), candle(3, 104)]);
    const strategy = new RecordingStrategy();

    await runBacktest(options(feed, strategy, 0, 4));

    expect(strategy.seen).toHaveLength(4);
    expect(strategy.seen.map((item) => item.htfClose)).toEqual([undefined, undefined, undefined, undefined]);
    expect(strategy.seen.map((item) => item.mtfClose)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("writes terminal end-of-data realized P&L to one final equity point", async () => {
    const feed = new Feed([candle(0, 100), candle(1, 110)]);
    const result = await runBacktest(options(feed, new OpenOnceStrategy(90, 1_000), 0, 2));

    expect(result.trades[0]!.exitReason).toBe("end_of_data");
    expect(result.equityCurve).toEqual([
      { timestamp: 0, equity: 10_000 },
      { timestamp: HOUR, equity: 10_000 },
      { timestamp: 2 * HOUR, equity: 10_100 },
    ]);
    expect(result.totalReturn).toBe(0.01);
    expect(new Set(result.equityCurve.map((point) => point.timestamp)).size).toBe(result.equityCurve.length);
  });

  it("replaces the kill-switch mark with realized liquidation cash", async () => {
    const feed = new Feed([candle(0, 100), candle(1, 90)]);
    const result = await runBacktest({
      ...options(feed, new OpenOnceStrategy(1, 1_000), 0, 2),
      positionSize: { ...POSITION_SIZE, riskPerTrade: 0.5, maxDrawdown: 0.01 },
    });

    expect(result.killSwitchTriggered).toBe(true);
    expect(result.trades[0]!.exitReason).toBe("kill_switch");
    expect(result.equityCurve[result.equityCurve.length - 1]).toEqual({ timestamp: 2 * HOUR, equity: 9_800 });
    expect(result.totalReturn).toBe(-0.02);
    expect(new Set(result.equityCurve.map((point) => point.timestamp)).size).toBe(result.equityCurve.length);
  });

  it("end-of-data liquidation realizes fee, slippage, spread, borrow and funding costs into metrics", async () => {
    const candles = Array.from({ length: 9 }, (_, hour) => candle(hour, hour === 8 ? 110 : 100));
    const result = await runBacktest({
      ...options(new Feed(candles), new OpenOnceStrategy(90, 1_000), 0, 9),
      costModel: COSTLY_MODEL,
    });

    const trade = result.trades[0]!;
    const notional = 1_000;
    const entryPrice = 100 * (1 + COSTLY_MODEL.spreadRate / 2) * (1 + COSTLY_MODEL.slippageRate);
    const exitPrice = 110 * (1 - COSTLY_MODEL.spreadRate / 2) * (1 - COSTLY_MODEL.slippageRate);
    const grossPnl = (exitPrice - entryPrice) * (notional / entryPrice);
    const tradingFees = notional * COSTLY_MODEL.takerFeeRate * 2;
    const borrowCost = notional * COSTLY_MODEL.borrowRatePerHour * 8;
    const fundingCost = notional * (COSTLY_MODEL.fundingRatePer8h ?? 0) * (8 / 8);
    const totalCosts = tradingFees + borrowCost + fundingCost;
    const expectedPnl = grossPnl - totalCosts;

    expect(trade.exitReason).toBe("end_of_data");
    expect(trade.entryPrice).toBeCloseTo(entryPrice, 8);
    expect(trade.exitPrice).toBeCloseTo(exitPrice, 8);
    expect(trade.feesUsd).toBeCloseTo(totalCosts, 10);
    expect(trade.pnlUsd).toBeCloseTo(expectedPnl, 10);
    expect(result.equityCurve.at(-1)).toEqual({ timestamp: 9 * HOUR, equity: 10_000 + trade.pnlUsd });
    expect(result.totalReturn).toBeCloseTo(trade.pnlUsd / 10_000, 12);
    expect(new Set(result.equityCurve.map((point) => point.timestamp)).size).toBe(result.equityCurve.length);
  });

  it("kill-switch liquidation realizes every modeled cost into the final equity and return", async () => {
    const candles = Array.from({ length: 9 }, (_, hour) => candle(hour, hour === 8 ? 90 : 100));
    const result = await runBacktest({
      ...options(new Feed(candles), new OpenOnceStrategy(1, 1_000), 0, 9),
      costModel: COSTLY_MODEL,
      positionSize: { ...POSITION_SIZE, riskPerTrade: 0.5, maxDrawdown: 0.01 },
    });

    const trade = result.trades[0]!;
    const notional = 2_000;
    const entryPrice = 100 * (1 + COSTLY_MODEL.spreadRate / 2) * (1 + COSTLY_MODEL.slippageRate);
    const exitPrice = 90 * (1 - COSTLY_MODEL.spreadRate / 2) * (1 - COSTLY_MODEL.slippageRate);
    const grossPnl = (exitPrice - entryPrice) * (notional / entryPrice);
    const tradingFees = notional * COSTLY_MODEL.takerFeeRate * 2;
    const borrowCost = notional * COSTLY_MODEL.borrowRatePerHour * 8;
    const fundingCost = notional * (COSTLY_MODEL.fundingRatePer8h ?? 0) * (8 / 8);
    const totalCosts = tradingFees + borrowCost + fundingCost;
    const expectedPnl = grossPnl - totalCosts;

    expect(result.killSwitchTriggered).toBe(true);
    expect(trade.exitReason).toBe("kill_switch");
    expect(trade.entryPrice).toBeCloseTo(entryPrice, 8);
    expect(trade.exitPrice).toBeCloseTo(exitPrice, 8);
    expect(trade.feesUsd).toBeCloseTo(totalCosts, 10);
    expect(trade.pnlUsd).toBeCloseTo(expectedPnl, 10);
    expect(result.equityCurve.at(-1)).toEqual({ timestamp: 9 * HOUR, equity: 10_000 + trade.pnlUsd });
    expect(result.totalReturn).toBeCloseTo(trade.pnlUsd / 10_000, 12);
    expect(new Set(result.equityCurve.map((point) => point.timestamp)).size).toBe(result.equityCurve.length);
  });
});
