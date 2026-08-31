import {
  isSupportedSymbol,
  type FeedEvent,
  type Ohlcv,
  type Symbol as ExchangeSymbol,
} from "@mm-crypto-bot/exchange";
import type { Strategy, StrategyContext, StrategySignal } from "@mm-crypto-bot/core";
import { adx, lastAdx } from "@mm-crypto-bot/core";
import { makeSymbol, type Candle } from "@mm-crypto-bot/shared";
import type { Logger } from "@mm-crypto-bot/logging";

import type { StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import type { PortfolioManager } from "../portfolio/index.js";
import type { PositionManager, PositionSnapshot } from "./position-manager.js";
import type { StrategyRuntimePolicy } from "./strategy-runner.types.js";

class StrategyContextSymbolError extends Error {
  public constructor(symbol: string) {
    super(`Unsupported strategy context symbol: ${symbol}`);
    this.name = "StrategyContextSymbolError";
  }
}

function toStrategyContextSymbol(symbol: ExchangeSymbol): StrategyContext["symbol"] {
  if (!isSupportedSymbol(symbol)) throw new StrategyContextSymbolError(symbol);
  return makeSymbol(symbol);
}

interface StrategyContextFrames {
  readonly htf: StrategyContext["timeframe"];
  readonly mtf: StrategyContext["timeframe"];
  readonly ltf: StrategyContext["timeframe"];
}

function resolveStrategyContextFrames(
  timeframes: readonly StrategyContext["timeframe"][],
): StrategyContextFrames | undefined {
  const [htf, ...laterFrames] = timeframes;
  if (htf === undefined) return undefined;
  const [mtf = htf, ...ltfCandidates] = laterFrames;
  const ltf = ltfCandidates.at(-1) ?? mtf;
  return { htf, mtf: ltfCandidates.length > 0 ? mtf : ltf, ltf };
}

export interface StrategyMarketEventControllerOptions {
  readonly instances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  readonly positionManager: PositionManager;
  readonly enabledSymbols: ReadonlySet<ExchangeSymbol>;
  readonly strategyPolicies: ReadonlyMap<StrategyName, StrategyRuntimePolicy>;
  readonly logger: Logger;
  readonly isOrderEmissionBlocked: () => boolean;
  readonly reconcilePendingOrders: (symbol: ExchangeSymbol) => Promise<void>;
  readonly reconcileRiskCloses: (symbol: ExchangeSymbol) => Promise<void>;
  readonly processPlugins: (symbol: ExchangeSymbol, timeframe: string, bar: Candle) => Promise<void>;
  readonly findOpenPosition: (
    strategyName: StrategyName,
    symbol: ExchangeSymbol,
  ) => PositionSnapshot | undefined;
  readonly enforceProtection: (
    strategyName: StrategyName,
    strategy: Strategy,
    position: PositionSnapshot,
    candle: Ohlcv,
  ) => Promise<boolean>;
  readonly getPortfolioManager: () => PortfolioManager | undefined;
  readonly requestTrailingStopClose: (
    positionId: string,
    closePrice: number,
    reason: string,
  ) => Promise<void>;
  readonly handleSignal: (
    strategyName: StrategyName,
    strategy: Strategy,
    signal: StrategySignal,
    symbol: ExchangeSymbol,
    referencePrice: number,
    policy: StrategyRuntimePolicy | undefined,
  ) => Promise<void>;
}

/**
 * Owns symbol-local prices, closed bars, contexts, and serialized feed work.
 */
export class StrategyMarketEventController {
  private readonly latestPrice = new Map<ExchangeSymbol, number>();
  private readonly bars = new Map<string, readonly Candle[]>();
  private ticksProcessed = 0;

  private readonly processOpenPositionUpdate = async (
    strategy: Strategy,
    existingPosition: PositionSnapshot,
    context: StrategyContext,
    candle: Ohlcv,
  ): Promise<boolean> => {
    if (strategy.onOpenPositionUpdate === undefined) return false;
    const update = strategy.onOpenPositionUpdate({
      openPosition: {
        side: existingPosition.side === "long" ? "buy" : "sell",
        entryTime: existingPosition.openedAt,
        entryPrice: existingPosition.entryPrice,
        quantity: existingPosition.quantity,
        stopLoss: 0,
        takeProfit: 0,
        holdingBars: 0,
      },
      candle: this.toCandle(candle),
      candleIndex: this.ticksProcessed,
      mtfState: context.mtfState,
      pricePrecision: 2,
    });
    if (update?.forceExit !== true) return false;
    const reason = update.reason ?? "force_exit";
    const portfolioManager = this.options.getPortfolioManager();
    if (portfolioManager !== undefined) {
      const isClosed = await portfolioManager.requestPositionClose(existingPosition, reason);
      if (isClosed) strategy.onPositionClosed?.(reason);
      return true;
    }
    await this.options.requestTrailingStopClose(existingPosition.id, update.exitPrice ?? candle[4], reason);
    return true;
  };

  public constructor(private readonly options: StrategyMarketEventControllerOptions) {}

  private recordClosedBar(symbol: ExchangeSymbol, timeframe: string, candle: Candle): void {
    const key = this.barKey(symbol, timeframe);
    const current = this.bars.get(key) ?? [];
    if (current.at(-1)?.timestamp === candle.timestamp) return;
    this.bars.set(key, [...current, candle].slice(-256));
  }

  private makeContext(
    exchangeSymbol: ExchangeSymbol,
    strategySymbol: StrategyContext["symbol"],
    timeframe: StrategyContext["timeframe"],
    candle: Ohlcv,
    frames: StrategyContextFrames,
  ): StrategyContext {
    return {
      symbol: strategySymbol,
      timeframe,
      candleIndex: this.ticksProcessed,
      candle: this.toCandle(candle),
      mtfState: {
        htf: this.indicators(exchangeSymbol, frames.htf),
        mtf: this.indicators(exchangeSymbol, frames.mtf),
        ltf: this.indicators(exchangeSymbol, frames.ltf),
      },
      pricePrecision: 2,
    };
  }

  private indicators(symbol: ExchangeSymbol, timeframe: string): StrategyContext["mtfState"]["ltf"] {
    const bars = this.bars.get(this.barKey(symbol, timeframe)) ?? [];
    const last = bars.at(-1);
    if (last === undefined) return {};
    const state: {
      close?: number;
      candleIndex?: number;
      donchianUpper?: number;
      donchianLower?: number;
      atr?: number;
      adx?: number;
    } = { close: last.close, candleIndex: bars.length };
    if (bars.length >= 20) {
      const window = bars.slice(-20);
      state.donchianUpper = Math.max(...window.map((bar) => bar.high));
      state.donchianLower = Math.min(...window.map((bar) => bar.low));
    }
    if (bars.length >= 15) {
      const window = bars.slice(-15);
      const tr = window.flatMap((previous, index) =>
        window
          .slice(index + 1, index + 2)
          .map((bar) =>
            Math.max(
              bar.high - bar.low,
              Math.abs(bar.high - previous.close),
              Math.abs(bar.low - previous.close),
            ),
          ),
      );
      state.atr = tr.reduce((sum, value) => sum + value, 0) / tr.length;
    }
    const adxValue = lastAdx(adx(bars, 14));
    if (adxValue !== undefined) state.adx = adxValue;
    return state;
  }

  private barKey(symbol: ExchangeSymbol, timeframe: string): string {
    return `${symbol}\u{0}${timeframe}`;
  }

  private toCandle(ohlcv: Ohlcv): Candle {
    return {
      timestamp: ohlcv[0],
      open: ohlcv[1],
      high: ohlcv[2],
      low: ohlcv[3],
      close: ohlcv[4],
      volume: ohlcv[5],
    };
  }

  public getLatestPrice(symbol: ExchangeSymbol): number | undefined {
    return this.latestPrice.get(symbol);
  }

  public getTicksProcessed(): number {
    return this.ticksProcessed;
  }

  public async onFeedEventSerial(event: FeedEvent): Promise<void> {
    if (this.options.isOrderEmissionBlocked()) {
      this.options.logger.debug("strategy.feed.event.paused", { kind: event.kind });
      return;
    }
    if (event.kind === "ticker") {
      const ticker = event.payload;
      if (!this.options.enabledSymbols.has(ticker.symbol)) return;
      toStrategyContextSymbol(ticker.symbol);
      this.ticksProcessed++;
      this.latestPrice.set(ticker.symbol, ticker.last);
      this.options.positionManager.updateMarketPrice(ticker.symbol, ticker.last);
      await this.options.reconcilePendingOrders(ticker.symbol);
      await this.options.reconcileRiskCloses(ticker.symbol);
      return;
    }
    if (event.kind !== "ohlcv") {
      if (!this.options.enabledSymbols.has(event.payload.symbol)) return;
      toStrategyContextSymbol(event.payload.symbol);
      this.ticksProcessed++;
      return;
    }
    const { symbol, timeframe, candle } = event.payload;
    if (!this.options.enabledSymbols.has(symbol)) return;
    const strategySymbol = toStrategyContextSymbol(symbol);
    this.ticksProcessed++;
    this.latestPrice.set(symbol, candle[4]);
    this.options.positionManager.updateMarketPrice(symbol, candle[4]);
    const closedCandle = this.toCandle(candle);
    this.recordClosedBar(symbol, timeframe, closedCandle);
    await this.options.processPlugins(symbol, timeframe, closedCandle);
    if (this.options.isOrderEmissionBlocked()) return;
    for (const instance of this.options.instances.values()) {
      if (instance.kind !== "strategy") continue;
      const strategyName = instance.name;
      const strategy = instance.instance;
      const policy = this.options.strategyPolicies.get(strategyName);
      if (policy?.symbols !== undefined && !policy.symbols.includes(symbol)) continue;
      const frames = resolveStrategyContextFrames(strategy.timeframes);
      if (timeframe !== frames?.ltf) continue;
      const context = this.makeContext(symbol, strategySymbol, timeframe, candle, frames);
      try {
        const existingPosition = this.options.findOpenPosition(strategyName, symbol);
        if (existingPosition !== undefined) {
          if (await this.options.enforceProtection(strategyName, strategy, existingPosition, candle))
            continue;
          strategy.onCandleObserved?.(context);
          if (await this.processOpenPositionUpdate(strategy, existingPosition, context, candle)) continue;
          this.options.logger.debug("strategy.signal.position.open", {
            strategy: strategyName,
            symbol,
            existingSide: existingPosition.side,
          });
          continue;
        }
        const signal = strategy.onCandle(context);
        if (signal !== undefined) {
          await this.options.handleSignal(strategyName, strategy, signal, symbol, candle[4], policy);
        }
      } catch (error) {
        this.options.logger.error("strategy.candle.handler.failed", {
          strategy: instance.name,
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
