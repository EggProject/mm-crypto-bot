#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  applySlippage,
  applySpread,
  checkExit,
  closePosition,
  computeMetrics,
  entryCost,
  positionNotionalUsd,
  type BacktestMetrics,
  type BacktestResult,
  type CostModel,
  type EquityPoint,
  type OpenPosition,
  type PositionSizeConfig,
} from "@mm-crypto-bot/backtest";
import {
  DEFAULT_OHLC_TREND_CONFIG,
  OhlcTrendStrategy,
  type OhlcTrendConfig,
} from "@mm-crypto-bot/core";
import { makeSymbol, TIMEFRAME_MS, type Candle, type Timeframe, type Trade } from "@mm-crypto-bot/shared/types";

import { CsvExchangeFeed } from "../data/csv-feed.js";

export interface OhlcTrendCliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly initialEquity: number;
  readonly outputPath: string;
  readonly dataDir: string;
  readonly strategyConfig: OhlcTrendConfig;
  readonly costModel: CostModel;
  readonly positionSize: PositionSizeConfig;
}

const DEFAULT_COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

const DEFAULT_POSITION_SIZE: PositionSizeConfig = {
  riskPerTrade: 0.01,
  kellyFraction: 0.25,
  maxDrawdown: 0.5,
  maxPositionPctEquity: 0.2,
  minPositionPctEquity: 0.01,
};

function positiveNumber(flag: string, raw: string, allowZero = false): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${flag} must be ${allowZero ? "non-negative" : "positive"}, got: ${raw}`);
  }
  return value;
}

function positiveInteger(flag: string, raw: string): number {
  const value = positiveNumber(flag, raw);
  if (!Number.isInteger(value)) throw new Error(`${flag} must be an integer, got: ${raw}`);
  return value;
}

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): OhlcTrendCliArgs {
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = DEFAULT_OHLC_TREND_CONFIG.timeframe;
  let startTime = new Date(Date.UTC(2024, 0, 1));
  let endTime = new Date();
  let initialEquity = 10_000;
  let outputPath = "backtest-results/ohlc-trend-btc-1h.json";
  let dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  let strategyConfig: OhlcTrendConfig = { ...DEFAULT_OHLC_TREND_CONFIG };
  let costModel: CostModel = { ...DEFAULT_COST_MODEL };
  let positionSize: PositionSizeConfig = { ...DEFAULT_POSITION_SIZE };

  for (const arg of argv) {
    const [flag, raw = ""] = arg.split("=", 2);
    switch (flag) {
      case "--symbol": symbol = raw; break;
      case "--timeframe": {
        if (!(raw in TIMEFRAME_MS)) throw new Error(`Unsupported --timeframe: ${raw}`);
        timeframe = raw as Timeframe;
        strategyConfig = { ...strategyConfig, timeframe };
        break;
      }
      case "--start": startTime = new Date(raw); break;
      case "--end": endTime = new Date(raw); break;
      case "--equity": initialEquity = positiveNumber(flag, raw); break;
      case "--output": outputPath = raw; break;
      case "--data-dir": dataDir = resolve(raw); break;
      case "--fast-ema": strategyConfig = { ...strategyConfig, fastEma: positiveInteger(flag, raw) }; break;
      case "--slow-ema": strategyConfig = { ...strategyConfig, slowEma: positiveInteger(flag, raw) }; break;
      case "--rsi-period": strategyConfig = { ...strategyConfig, rsiPeriod: positiveInteger(flag, raw) }; break;
      case "--atr-period": strategyConfig = { ...strategyConfig, atrPeriod: positiveInteger(flag, raw) }; break;
      case "--atr-stop-multiplier": strategyConfig = { ...strategyConfig, atrStopMultiplier: positiveNumber(flag, raw) }; break;
      case "--reward-to-risk": strategyConfig = { ...strategyConfig, rewardToRisk: positiveNumber(flag, raw) }; break;
      case "--cross-lookback": strategyConfig = { ...strategyConfig, crossLookback: positiveInteger(flag, raw) }; break;
      case "--taker-fee": costModel = { ...costModel, takerFeeRate: positiveNumber(flag, raw, true) }; break;
      case "--slippage": costModel = { ...costModel, slippageRate: positiveNumber(flag, raw, true) }; break;
      case "--spread": costModel = { ...costModel, spreadRate: positiveNumber(flag, raw, true) }; break;
      case "--borrow-per-hour": costModel = { ...costModel, borrowRatePerHour: positiveNumber(flag, raw, true) }; break;
      case "--risk-per-trade": positionSize = { ...positionSize, riskPerTrade: positiveNumber(flag, raw) }; break;
      case "--max-position-pct-equity": positionSize = { ...positionSize, maxPositionPctEquity: positiveNumber(flag, raw) }; break;
      case "--min-position-pct-equity": positionSize = { ...positionSize, minPositionPctEquity: positiveNumber(flag, raw, true) }; break;
      case "--max-drawdown": positionSize = { ...positionSize, maxDrawdown: positiveNumber(flag, raw) }; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || startTime >= endTime) {
    throw new Error("--start and --end must define a valid increasing interval");
  }
  if (strategyConfig.fastEma >= strategyConfig.slowEma) {
    throw new Error("--fast-ema must be smaller than --slow-ema");
  }
  if (positionSize.maxPositionPctEquity > 1 || positionSize.minPositionPctEquity > positionSize.maxPositionPctEquity) {
    throw new Error("position-size fractions must satisfy 0 <= min <= max <= 1");
  }
  if (positionSize.riskPerTrade > 1 || positionSize.maxDrawdown > 1) {
    throw new Error("--risk-per-trade and --max-drawdown must be <= 1");
  }

  return {
    symbol,
    timeframe,
    startTime,
    endTime,
    initialEquity,
    outputPath,
    dataDir,
    strategyConfig: { ...strategyConfig, timeframe },
    costModel,
    positionSize,
  };
}

function recordEquity(curve: EquityPoint[], timestamp: number, equity: number): void {
  if (curve[curve.length - 1]?.timestamp === timestamp) curve[curve.length - 1] = { timestamp, equity };
  else curve.push({ timestamp, equity });
}

/** Geometrically normalize a full-period return without clipping losses to zero. */
export function calculateMonthlyReturn(totalReturn: number, totalMonths: number): number {
  const terminalGrowth = 1 + totalReturn;
  if (terminalGrowth <= 0) return -1;
  return Math.pow(terminalGrowth, 1 / totalMonths) - 1;
}

export function runOhlcTrendReplay(
  candles: readonly Candle[],
  args: OhlcTrendCliArgs,
): { readonly result: BacktestResult; readonly metrics: BacktestMetrics } {
  if (candles.length <= args.strategyConfig.slowEma) {
    throw new Error(`Not enough real OHLCV candles: need > ${args.strategyConfig.slowEma}, got ${candles.length}`);
  }

  const strategy = new OhlcTrendStrategy(args.strategyConfig);
  const timeframeMs = strategy.requiredTimeframeMs();
  const ordered = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [{ timestamp: args.startTime.getTime(), equity: args.initialEquity }];
  let cashEquity = args.initialEquity;
  let peakEquity = cashEquity;
  let position: OpenPosition | null = null;
  let lastConsumedSignalTime = -1;
  let killSwitchTriggered = false;

  for (let index = 0; index < ordered.length; index++) {
    const candle = ordered[index]!;
    const decisionTime = candle.timestamp + timeframeMs;

    if (position !== null) {
      const exit = checkExit(position, candle, args.costModel);
      if (exit !== null) {
        const trade = closePosition(position, candle, exit, args.costModel);
        trades.push(trade);
        cashEquity += trade.pnlUsd;
        position = null;
      }
    }

    const signal = strategy.onBars(ordered.slice(0, index + 1));
    if (signal !== null && signal.timestamp > lastConsumedSignalTime) {
      lastConsumedSignalTime = signal.timestamp;
      if (position === null) {
        const entryPrice = applySlippage(
          applySpread(candle.close, signal.side, args.costModel.spreadRate),
          signal.side,
          args.costModel.slippageRate,
        );
        const notionalUsd = positionNotionalUsd(
          cashEquity,
          entryPrice,
          signal.stopLoss,
          args.positionSize,
        );
        position = {
          symbol: makeSymbol(args.symbol),
          side: signal.side,
          entryTime: candle.timestamp,
          entryPrice,
          quantity: notionalUsd / entryPrice,
          notionalUsd,
          marginNotional: notionalUsd,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          entryFee: entryCost(notionalUsd, args.costModel),
          entryReason: signal.reason,
        };
      }
    }

    let markedEquity = cashEquity;
    if (position !== null) {
      const provisional = closePosition(
        position,
        candle,
        { reason: "end_of_data", exitPrice: candle.close },
        args.costModel,
      );
      markedEquity += provisional.pnlUsd;
    }
    recordEquity(equityCurve, decisionTime, markedEquity);
    peakEquity = Math.max(peakEquity, markedEquity);
    if ((peakEquity - markedEquity) / peakEquity >= args.positionSize.maxDrawdown) {
      killSwitchTriggered = true;
      if (position !== null) {
        const trade = closePosition(
          position,
          candle,
          { reason: "kill_switch", exitPrice: candle.close },
          args.costModel,
        );
        trades.push(trade);
        cashEquity += trade.pnlUsd;
        position = null;
        recordEquity(equityCurve, decisionTime, cashEquity);
      }
      break;
    }
  }

  if (position !== null) {
    const last = ordered[ordered.length - 1]!;
    const trade = closePosition(position, last, { reason: "end_of_data", exitPrice: last.close }, args.costModel);
    trades.push(trade);
    cashEquity += trade.pnlUsd;
    recordEquity(equityCurve, last.timestamp + timeframeMs, cashEquity);
  }

  const periodsPerYear = (365 * 24 * 60 * 60 * 1000) / timeframeMs;
  const metrics = computeMetrics(
    trades,
    equityCurve,
    args.startTime.getTime(),
    args.endTime.getTime(),
    periodsPerYear,
  );
  const result: BacktestResult = {
    totalReturn: metrics.totalReturnPct,
    annualizedReturn: metrics.annualizedReturnPct,
    sharpeRatio: metrics.sharpeRatio,
    sortinoRatio: metrics.sortinoRatio,
    maxDrawdown: metrics.maxDrawdownPct,
    profitFactor: metrics.profitFactor,
    winRate: metrics.winRatePct,
    totalTrades: metrics.totalTrades,
    trades,
    equityCurve,
    killSwitchTriggered,
    startTime: args.startTime.getTime(),
    endTime: args.endTime.getTime(),
  };
  return { result, metrics };
}

export async function main(): Promise<void> {
  const args = parseArgs();
  const feed = new CsvExchangeFeed(args.dataDir);
  const timeframeMs = TIMEFRAME_MS[args.timeframe];
  const candles = (await feed.fetchOHLCV(args.symbol, args.timeframe, {
    since: args.startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  })).filter((c) => c.timestamp >= args.startTime.getTime() && c.timestamp + timeframeMs <= args.endTime.getTime());
  const { result, metrics } = runOhlcTrendReplay(candles, args);
  const totalMonths = (args.endTime.getTime() - args.startTime.getTime()) / (30.44 * 24 * 60 * 60 * 1000);
  const monthlyReturn = calculateMonthlyReturn(result.totalReturn, totalMonths);

  const fileSymbol = args.symbol.split("/")[0]?.toLowerCase() ?? "unknown";
  const output = {
    args,
    strategy: "ohlc-trend",
    strategyConfig: args.strategyConfig,
    costModel: args.costModel,
    positionSize: args.positionSize,
    data: {
      sourceKind: "downloaded_csv",
      synthetic: false,
      path: resolve(args.dataDir, `binance_${fileSymbol}_${args.timeframe}.csv`),
      candleCount: candles.length,
      firstCandleTime: candles[0]?.timestamp ?? null,
      lastCandleTime: candles[candles.length - 1]?.timestamp ?? null,
    },
    monthlyReturn,
    totalMonths,
    result,
    metrics,
    generatedAt: new Date().toISOString(),
  };

  const absOutput = resolve(process.cwd(), args.outputPath);
  await mkdir(resolve(absOutput, ".."), { recursive: true });
  await writeFile(absOutput, JSON.stringify(output, null, 2), "utf8");
  console.log(`[ohlc-trend] real CSV candles=${candles.length} trades=${result.totalTrades}`);
  console.log(`[ohlc-trend] return=${(result.totalReturn * 100).toFixed(2)}% maxDD=${(result.maxDrawdown * 100).toFixed(2)}% Sharpe=${result.sharpeRatio.toFixed(3)}`);
  console.log(`[ohlc-trend] Saved: ${absOutput}`);
}

export function handleFatal(error: unknown): void {
  console.error("[ohlc-trend] FATAL:", error);
  process.exitCode = 1;
}

if (import.meta.main) {
  main().catch(handleFatal);
}
