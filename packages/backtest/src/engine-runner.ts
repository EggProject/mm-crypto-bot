import { computeIndicators, createStrategy } from "@mm-crypto-bot/core";
import type { MtfState, Strategy, StrategySignal } from "@mm-crypto-bot/core";
import { TIMEFRAME_MS, makeSymbol } from "@mm-crypto-bot/shared/types";
import type { Candle, ExitReason, Trade } from "@mm-crypto-bot/shared/types";

import { applySlippage, applySpread, entryCost } from "./cost-model.js";
import {
  HistoricalIndicatorCursor,
  precomputeHistoricalIndicatorTimeline,
  type IndicatorConfig,
} from "./engine-indicators.js";
import { calculateUnrealizedPnl, checkExit, closePosition, type OpenPosition } from "./engine-position.js";
import { aggregateCompleteToTimeframe } from "./engine-timeframes.js";
import { computeMetrics } from "./metrics.js";
import { positionNotionalUsd } from "./position-size.js";
import type { BacktestOptions, BacktestResult, EquityPoint } from "./types.js";

const PRICE_PRECISION = 2;

export async function runBacktest(options: BacktestOptions): Promise<BacktestResult> {
  return new BacktestRunner(options).run();
}

class BacktestRunner {
  private readonly strategy: Strategy;
  private readonly symbol: ReturnType<typeof makeSymbol>;
  private readonly equityCurve: EquityPoint[];
  private readonly trades: Trade[] = [];
  private equity: number;
  private peakEquity: number;
  private openPosition: OpenPosition | undefined;
  private entryBarIndex = -1;
  private killSwitchTriggered = false;

  public constructor(private readonly options: BacktestOptions) {
    validateOptions(options);
    this.strategy = options.strategy ?? createStrategy();
    this.symbol = makeSymbol(options.symbol);
    this.equity = options.initialEquityUsd;
    this.peakEquity = options.initialEquityUsd;
    this.equityCurve = [{ timestamp: options.startTime.getTime(), equity: options.initialEquityUsd }];
  }

  private async loadLtfCandles(ltfMs: number): Promise<readonly Candle[]> {
    const requestedCandles = await this.options.feed.fetchOHLCV(
      this.options.symbol,
      this.options.ltfTimeframe,
      {
        since: this.options.startTime.getTime(),
        limit: Number.MAX_SAFE_INTEGER,
      },
    );
    const eligibleCandles = requestedCandles.filter(
      (candle) =>
        candle.timestamp >= this.options.startTime.getTime() &&
        candle.timestamp + ltfMs <= this.options.endTime.getTime(),
    );
    const sortedCandles = sortCandlesByTimestamp(eligibleCandles);
    if (sortedCandles.length === 0) {
      throw new Error("No candles in the requested period");
    }
    return sortedCandles;
  }

  private createIndicatorCursor(
    htfCandles: readonly Candle[],
    mtfCandles: readonly Candle[],
    ltfCandles: readonly Candle[],
    config: IndicatorConfig,
    htfMs: number,
    mtfMs: number,
  ): HistoricalIndicatorCursor | undefined {
    if (this.options.historicalIndicatorMode === "legacy") {
      return undefined;
    }
    return new HistoricalIndicatorCursor(
      precomputeHistoricalIndicatorTimeline(htfCandles, mtfCandles, ltfCandles, config),
      htfCandles,
      mtfCandles,
      htfMs,
      mtfMs,
    );
  }

  private indicatorsForCandle(
    cursor: HistoricalIndicatorCursor | undefined,
    htfCandles: readonly Candle[],
    mtfCandles: readonly Candle[],
    ltfCandles: readonly Candle[],
    config: IndicatorConfig,
    htfMs: number,
    mtfMs: number,
    decisionTime: number,
    index: number,
  ): MtfState {
    if (cursor !== undefined) {
      return cursor.stateAt(decisionTime, index);
    }
    return computeIndicators(
      htfCandles.filter((candle) => candle.timestamp + htfMs <= decisionTime),
      mtfCandles.filter((candle) => candle.timestamp + mtfMs <= decisionTime),
      ltfCandles.slice(0, index + 1),
      config,
    );
  }

  private processOpenPosition(candle: Candle, indicators: MtfState, candleIndex: number): void {
    const position = this.openPosition;
    if (position === undefined) {
      return;
    }

    const exit = checkExit(position, candle, this.options.costModel);
    if (exit?.reason !== undefined) {
      this.settlePosition(position, candle, exit);
      return;
    }

    this.strategy.onCandleObserved?.(this.createStrategyContext(candle, indicators, candleIndex));
    const update = this.strategy.onOpenPositionUpdate?.({
      openPosition: {
        side: position.side,
        entryTime: position.entryTime,
        entryPrice: position.entryPrice,
        quantity: position.quantity,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        holdingBars: candleIndex - this.entryBarIndex,
      },
      candle,
      candleIndex,
      mtfState: indicators,
      pricePrecision: PRICE_PRECISION,
    });
    this.applyPositionUpdate(candle, update);
  }

  private applyPositionUpdate(
    candle: Candle,
    update: ReturnType<NonNullable<Strategy["onOpenPositionUpdate"]>> | undefined,
  ): void {
    const currentPosition = this.openPosition;
    if (currentPosition === undefined) {
      return;
    }
    if (update?.newStopLoss !== undefined) {
      this.openPosition = { ...currentPosition, stopLoss: update.newStopLoss };
    }
    if (update?.newTakeProfit !== undefined) {
      this.openPosition = { ...currentPosition, takeProfit: update.newTakeProfit };
    }
    if (update?.forceExit === true) {
      const positionToClose = this.openPosition;
      if (positionToClose === undefined) {
        throw new Error("A forced exit requires an open position.");
      }
      const reason: ExitReason = update.reason ?? "trailing_stop";
      this.settlePosition(positionToClose, candle, { reason, exitPrice: update.exitPrice ?? candle.close });
    }
  }

  private openPositionFromSignal(
    candle: Candle,
    indicators: MtfState,
    candleIndex: number,
    decisionTime: number,
  ): void {
    if (this.openPosition !== undefined || this.killSwitchTriggered) {
      return;
    }
    const result: unknown = this.strategy.onCandle(
      this.createStrategyContext(candle, indicators, candleIndex),
    );
    if (result === null) {
      return;
    }
    if (!isStrategySignal(result)) {
      throw new Error("Strategy.onCandle must return a StrategySignal or null.");
    }
    const signal = result;

    const notional = this.positionNotional(signal, candle.close, decisionTime);
    const entryPrice = applySlippage(
      applySpread(candle.close, signal.side, this.options.costModel.spreadRate),
      signal.side,
      this.options.costModel.slippageRate,
    );
    this.openPosition = {
      symbol: this.symbol,
      side: signal.side,
      entryTime: candle.timestamp,
      entryPrice,
      quantity: notional / entryPrice,
      notionalUsd: notional,
      marginNotional: notional,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      entryFee: entryCost(notional, this.options.costModel),
      entryReason: signal.reason,
    };
    this.entryBarIndex = candleIndex;
    this.strategy.onPositionOpened?.({
      side: signal.side,
      entryTime: candle.timestamp,
      entryPrice,
      quantity: notional / entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      holdingBars: 0,
    });
  }

  private positionNotional(signal: StrategySignal, price: number, timestamp: number): number {
    const confidence = clampConfidence(signal.confidence);
    const riskPerTrade = this.options.positionSize.riskPerTrade * confidence;
    const notional = positionNotionalUsd(this.equity, price, signal.stopLoss, {
      ...this.options.positionSize,
      riskPerTrade,
    });
    this.options.onPositionSized?.({ timestamp, signal, equityUsd: this.equity, notionalUsd: notional });
    return notional;
  }

  private settlePosition(
    position: OpenPosition,
    candle: Candle,
    exit: { readonly reason: ExitReason; readonly exitPrice: number },
  ): void {
    const trade = closePosition(position, candle, exit, this.options.costModel);
    this.trades.push(trade);
    this.equity += trade.pnlUsd;
    this.openPosition = undefined;
    this.strategy.onPositionClosed?.(exit.reason);
  }

  private markEquity(candle: Candle, decisionTime: number): void {
    const unrealizedPnl =
      this.openPosition === undefined
        ? 0
        : calculateUnrealizedPnl(this.openPosition, candle, this.options.costModel);
    const currentEquity = this.equity + unrealizedPnl;
    recordEquityPoint(this.equityCurve, decisionTime, currentEquity);
    this.peakEquity = Math.max(this.peakEquity, currentEquity);
  }

  private triggerKillSwitch(candle: Candle, decisionTime: number): boolean {
    const currentEquity = this.equityCurve.at(-1)?.equity;
    if (currentEquity === undefined) {
      throw new Error("The equity curve must contain the current candle mark.");
    }
    const drawdown = (this.peakEquity - currentEquity) / this.peakEquity;
    if (drawdown < this.options.positionSize.maxDrawdown) {
      return false;
    }

    this.killSwitchTriggered = true;
    const position = this.openPosition;
    if (position !== undefined) {
      this.settlePosition(position, candle, { reason: "kill_switch", exitPrice: candle.close });
      recordEquityPoint(this.equityCurve, decisionTime, this.equity);
    }
    return true;
  }

  private closeTerminalPosition(ltfCandles: readonly Candle[], ltfMs: number): void {
    const position = this.openPosition;
    if (position === undefined) {
      return;
    }
    const lastCandle = ltfCandles.at(-1);
    if (lastCandle === undefined) {
      throw new Error("A non-empty backtest requires a terminal candle.");
    }
    this.settlePosition(position, lastCandle, { reason: "end_of_data", exitPrice: lastCandle.close });
    recordEquityPoint(this.equityCurve, lastCandle.timestamp + ltfMs, this.equity);
  }

  private createResult(ltfMs: number): BacktestResult {
    const periodsPerYear = (365 * 24 * 60 * 60 * 1000) / ltfMs;
    const metrics = computeMetrics(
      this.trades,
      this.equityCurve,
      this.options.startTime.getTime(),
      this.options.endTime.getTime(),
      periodsPerYear,
    );
    return {
      totalReturn: metrics.totalReturnPct,
      annualizedReturn: metrics.annualizedReturnPct,
      sharpeRatio: metrics.sharpeRatio,
      sortinoRatio: metrics.sortinoRatio,
      maxDrawdown: metrics.maxDrawdownPct,
      profitFactor: metrics.profitFactor,
      winRate: metrics.winRatePct,
      totalTrades: metrics.totalTrades,
      trades: this.trades,
      equityCurve: this.equityCurve,
      killSwitchTriggered: this.killSwitchTriggered,
      startTime: this.options.startTime.getTime(),
      endTime: this.options.endTime.getTime(),
    };
  }

  private createStrategyContext(candle: Candle, indicators: MtfState, candleIndex: number) {
    return {
      symbol: this.symbol,
      timeframe: this.options.ltfTimeframe,
      candleIndex,
      candle,
      mtfState: indicators,
      pricePrecision: PRICE_PRECISION,
    };
  }

  public async run(): Promise<BacktestResult> {
    const ltfMs = TIMEFRAME_MS[this.options.ltfTimeframe];
    const ltfCandles = await this.loadLtfCandles(ltfMs);
    const htfMs = TIMEFRAME_MS[this.options.htfTimeframe];
    const mtfMs = TIMEFRAME_MS[this.options.mtfTimeframe];
    const htfCandles = aggregateCompleteToTimeframe(ltfCandles, ltfMs, htfMs);
    const mtfCandles = aggregateCompleteToTimeframe(ltfCandles, ltfMs, mtfMs);
    const indicatorConfig = createIndicatorConfig(this.options);
    const cursor = this.createIndicatorCursor(
      htfCandles,
      mtfCandles,
      ltfCandles,
      indicatorConfig,
      htfMs,
      mtfMs,
    );

    for (const [index, candle] of ltfCandles.entries()) {
      const decisionTime = candle.timestamp + ltfMs;
      const indicators = this.indicatorsForCandle(
        cursor,
        htfCandles,
        mtfCandles,
        ltfCandles,
        indicatorConfig,
        htfMs,
        mtfMs,
        decisionTime,
        index,
      );
      this.processOpenPosition(candle, indicators, index);
      this.openPositionFromSignal(candle, indicators, index, decisionTime);
      this.markEquity(candle, decisionTime);
      if (this.triggerKillSwitch(candle, decisionTime)) {
        break;
      }
    }

    this.closeTerminalPosition(ltfCandles, ltfMs);
    return this.createResult(ltfMs);
  }
}

function validateOptions(options: BacktestOptions): void {
  if (options.startTime.getTime() >= options.endTime.getTime()) {
    throw new Error("startTime must be before endTime");
  }
  if (options.initialEquityUsd <= 0) {
    throw new Error("initialEquityUsd must be positive");
  }
}

function createIndicatorConfig(options: BacktestOptions): IndicatorConfig {
  return {
    htfDonchianPeriod: options.htfDonchianPeriod ?? 20,
    mtfDonchianPeriod: 20,
    htfSupertrendPeriod: 10,
    htfSupertrendMultiplier: 3,
    htfEmaFast: 50,
    htfEmaSlow: 200,
    htfAdxPeriod: 14,
    mtfBbPeriod: 20,
    mtfBbStddev: 2,
    mtfAdxPeriod: 14,
    mtfRsiPeriod: 14,
    ltfRsiPeriod: 14,
    ltfVolumeMaPeriod: 20,
    ltfAtrPeriod: 14,
  };
}

function clampConfidence(confidence: number): number {
  return Math.min(Math.max(confidence, 0), 1);
}

function isStrategySignal(value: unknown): value is StrategySignal {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value["side"] === "buy" || value["side"] === "sell") &&
    typeof value["confidence"] === "number" &&
    typeof value["reason"] === "string" &&
    typeof value["stopLoss"] === "number" &&
    typeof value["takeProfit"] === "number"
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordEquityPoint(equityCurve: EquityPoint[], timestamp: number, equity: number): void {
  const latestPoint = equityCurve.at(-1);
  if (latestPoint?.timestamp === timestamp) {
    equityCurve.pop();
    equityCurve.push({ timestamp, equity });
    return;
  }
  equityCurve.push({ timestamp, equity });
}

function sortCandlesByTimestamp(candles: readonly Candle[]): readonly Candle[] {
  if (candles.length < 2) {
    return [...candles];
  }
  const midpoint = Math.floor(candles.length / 2);
  return mergeCandlesByTimestamp(
    sortCandlesByTimestamp(candles.slice(0, midpoint)),
    sortCandlesByTimestamp(candles.slice(midpoint)),
  );
}

function mergeCandlesByTimestamp(
  leftCandles: readonly Candle[],
  rightCandles: readonly Candle[],
): readonly Candle[] {
  const sortedCandles: Candle[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftCandles.length && rightIndex < rightCandles.length) {
    const leftCandle = leftCandles.at(leftIndex);
    const rightCandle = rightCandles.at(rightIndex);
    if (leftCandle === undefined || rightCandle === undefined) {
      throw new Error("Merge indices must refer to existing candles.");
    }
    if (leftCandle.timestamp <= rightCandle.timestamp) {
      sortedCandles.push(leftCandle);
      leftIndex += 1;
    } else {
      sortedCandles.push(rightCandle);
      rightIndex += 1;
    }
  }
  return [...sortedCandles, ...leftCandles.slice(leftIndex), ...rightCandles.slice(rightIndex)];
}
