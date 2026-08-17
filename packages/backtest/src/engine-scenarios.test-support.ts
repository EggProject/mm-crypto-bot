import type {
  OpenPositionSnapshot,
  PositionManagementContext,
  PositionUpdate,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "@mm-crypto-bot/core";
import type { Candle, Timeframe } from "@mm-crypto-bot/shared/types";

import type { BacktestOptions, CostModel, ExchangeFeed, PositionSizeConfig } from "./types.js";

export const HOUR_MS = 60 * 60 * 1000;

export const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
};

export const POSITION_SIZE: PositionSizeConfig = {
  riskPerTrade: 0.01,
  kellyFraction: 0.25,
  maxDrawdown: 0.15,
  maxPositionPctEquity: 0.2,
  minPositionPctEquity: 0.01,
};

export function makeCandle(
  timestamp: number,
  price: number,
  options?: Readonly<{ high?: number; low?: number; volume?: number }>,
): Candle {
  return {
    timestamp,
    open: price,
    high: options?.high ?? price * 1.01,
    low: options?.low ?? price * 0.99,
    close: price,
    volume: options?.volume ?? 1000,
  };
}

export function requireLast<T>(values: readonly T[], description: string): T {
  const value = values.at(-1);
  if (value === undefined) {
    throw new Error(`Expected a final ${description}.`);
  }
  return value;
}

export function requireFirst<T>(values: readonly T[], description: string): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error(`Expected a first ${description}.`);
  }
  return value;
}

export function noSignal(): null {
  // eslint-disable-next-line unicorn/no-null -- The Strategy contract represents an intentionally absent signal with null.
  return null;
}

export class ScenarioFeed implements ExchangeFeed {
  public constructor(private readonly candles: readonly Candle[]) {}

  fetchOHLCV(
    _symbol: string,
    _timeframe: Timeframe,
    _options: Readonly<{ since?: number; limit?: number }>,
  ): Promise<readonly Candle[]> {
    return Promise.resolve(this.candles);
  }
}

export class NullStrategy implements Strategy {
  public readonly name = "null";
  public readonly timeframes = ["1h"] as const;

  onCandle(_context: StrategyContext): StrategySignal | null {
    return noSignal();
  }

  warmup(): number {
    return 0;
  }
}

export class SingleSignalStrategy implements Strategy {
  private tradeCounter = 0;

  public readonly name = "mock";
  public readonly timeframes = ["1h"] as const;

  public constructor(
    private readonly side: "buy" | "sell" = "buy",
    private readonly maxTrades = 100,
    private readonly stopLossOffset = 10,
    private readonly takeProfitOffset = 30,
  ) {}

  onCandle(context: StrategyContext): StrategySignal | null {
    if (this.tradeCounter >= this.maxTrades) {
      return noSignal();
    }
    this.tradeCounter += 1;
    const price = context.candle.close;
    return {
      side: this.side,
      confidence: 1,
      reason: "mock",
      stopLoss: this.side === "buy" ? price - this.stopLossOffset : price + this.stopLossOffset,
      takeProfit: this.side === "buy" ? price + this.takeProfitOffset : price - this.takeProfitOffset,
    };
  }

  warmup(): number {
    return 0;
  }
}

export class CallbackStrategy implements Strategy {
  private fired = false;

  public readonly name = "callback-mock";
  public readonly timeframes = ["1h"] as const;
  public updateReturn: PositionUpdate | null = noSignal();
  public openedCount = 0;
  public closedCount = 0;
  public updateCount = 0;
  public lastExitReason: string | undefined;

  public constructor(
    public stopFraction = 0.9,
    public takeProfitFraction = 1.3,
  ) {}

  onCandle(context: StrategyContext): StrategySignal | null {
    if (this.fired) {
      return noSignal();
    }
    this.fired = true;
    const price = context.candle.close;
    return {
      side: "buy",
      confidence: 1,
      reason: "callback-mock",
      stopLoss: price * this.stopFraction,
      takeProfit: price * this.takeProfitFraction,
    };
  }

  warmup(): number {
    return 0;
  }

  onPositionOpened(_snapshot: OpenPositionSnapshot): void {
    this.openedCount += 1;
  }

  onPositionClosed(reason: string): void {
    this.closedCount += 1;
    this.lastExitReason = reason;
  }

  onOpenPositionUpdate(_context: PositionManagementContext): PositionUpdate | null {
    this.updateCount += 1;
    return this.updateReturn;
  }
}

export function makeBacktestOptions(
  candles: readonly Candle[],
  strategy: Strategy | undefined,
  overrides?: Readonly<Partial<BacktestOptions>>,
): BacktestOptions {
  return {
    symbol: "BTC/USDC",
    htfTimeframe: "1d",
    mtfTimeframe: "4h",
    ltfTimeframe: "1h",
    startTime: new Date(0),
    endTime: new Date(requireLast(candles, "candle").timestamp),
    initialEquityUsd: 10_000,
    feed: new ScenarioFeed(candles),
    costModel: COST_MODEL,
    positionSize: POSITION_SIZE,
    ...(strategy !== undefined && { strategy }),
    ...overrides,
  };
}
