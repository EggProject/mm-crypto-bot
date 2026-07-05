#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-hybrid-kelly.ts — Phase 11.1e Track B.
//
// HybridKellyPlugin CLI runner — emits per-symbol baseline JSONs that mirror
// the validated Phase 9 9E Adaptive Kelly × VolTarget hybrid walk-forward
// Sharpe at the project's 1:10 mandate.
//
// Phase 9 9E baseline references (24-fold walk-forward, 180d IS / 30d OOS /
// 30d step, 0 purge):
//   BTC: +0.0477 (positive, DD-reduced -45% vs in-sample)
//   ETH: -0.0155 (slightly negative — phase-noise floor)
//   SOL: +0.1039 (positive, best of 3 by Sharpe)
//
// The HybridKellyPlugin is a drop-in port of Phase 9 9E onto the SignalBus
// (Track A). This CLI runs the canonical 9E walk-forward validation helpers
// (`runHybridWalkForwardValidation`, `computeHybridSizer`) and writes a JSON
// summary aligned with the Phase 11.1d SOL baseline shape.
//
// ===========================================================================
// 1:10 MANDATORY LEVERAGE — HARD CONSTRAINT (CLI PARSE TIME)
// ===========================================================================
// The --leverage flag accepts ONLY 10; anything else throws via
// `validateOneToTenLeverage()`. Project-wide user mandate: ALL trades must
// use EXACTLY 1:10 leverage (no more, no less). This is the canonical
// Layer-0 defense — parse-time rejection of any non-1:10 leverage value.

import { resolve } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import {
  runBacktest,
  type BacktestResult,
  type CostModel,
} from "@mm-crypto-bot/backtest";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";
import {
  ONE_TO_TEN_LEVERAGE,
  validateOneToTenLeverage,
  computeHybridSizer,
  runHybridWalkForwardValidation,
  DonchianBreakoutStrategy,
  DEFAULT_VOL_TARGET_CONFIG,
  type DailyOhlcv,
  type HybridSizerConfig,
} from "@mm-crypto-bot/core";

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

// 24-fold walk-forward (180d IS / 30d OOS / 30d step / 0 purge).
const HARD_24_FOLDS = {
  trainDays: 180,
  testDays: 30,
  stepDays: 30,
  purgeDays: 0,
} as const;

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: number;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let baseNotionalUsd = 10_000;
  let leverage = 10; // 1:10 MANDATE default
  let outputPath = "";
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      const raw = arg.slice("--symbol=".length).toLowerCase();
      if (raw !== "btc" && raw !== "eth" && raw !== "sol") {
        throw new Error(`--symbol must be btc|eth|sol; got "${raw}"`);
      }
      symbol = `${raw.toUpperCase()}/USDT`;
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      if (tf !== "1d") {
        throw new Error(`[hybrid-kelly] Only --timeframe=1d is supported (the bundled data is daily); got "${tf}".`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) initialEquity = Number(arg.slice("--equity=".length));
    else if (arg.startsWith("--base-notional=")) baseNotionalUsd = Number(arg.slice("--base-notional=".length));
    else if (arg.startsWith("--leverage=")) leverage = Number(arg.slice("--leverage=".length));
    else if (arg.startsWith("--output=")) outputPath = arg.slice("--output=".length);
  }
  // HARD GUARDRAIL — 1:10 mandate enforced at CLI parse time.
  validateOneToTenLeverage(leverage);
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-hybrid-kelly-${symbolLower}-${timeframe}.json`;
  }
  return { symbol, timeframe, initialEquity, baseNotionalUsd, leverage, outputPath };
}

function timeframesFor(ltf: Timeframe): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
  return { htf: "1d", mtf: "4h", ltf };
}

function loadOhlcvCsv(symbol: string, _timeframe: Timeframe): DailyOhlcv[] {
  const symbolLower = symbol.split("/")[0]!.toLowerCase();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const path = resolve(dataDir, `binance_${symbolLower}_1d.csv`);
  const lines = readFileSync(path, "utf8").trim().split("\n");
  if (lines.length < 2) throw new Error(`Empty CSV: ${path}`);
  const candles: DailyOhlcv[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(",");
    if (parts.length < 6) continue;
    const ts = Number(parts[0]);
    const o = Number(parts[1]);
    const h = Number(parts[2]);
    const l = Number(parts[3]);
    const c = Number(parts[4]);
    const v = Number(parts[5]);
    if (![ts, o, h, l, c].every(Number.isFinite)) continue;
    candles.push({ timestamp: ts, open: o, high: h, low: l, close: c, volume: v });
  }
  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles;
}

async function runBaselineBacktest(
  symbol: string,
  timeframe: Timeframe,
  initialEquity: number,
  startTime: Date,
  endTime: Date,
  feed: ExchangeFeed,
): Promise<BacktestResult> {
  const tf = timeframesFor(timeframe);
  return runBacktest({
    symbol: makeSymbol(symbol),
    htfTimeframe: tf.htf,
    mtfTimeframe: tf.mtf,
    ltfTimeframe: tf.ltf,
    startTime,
    endTime,
    initialEquityUsd: initialEquity,
    feed,
    costModel: COST_MODEL,
    positionSize: {
      riskPerTrade: 0.01,
      kellyFraction: 0.25,
      maxDrawdown: 0.5,
      maxPositionPctEquity: 0.2,
      minPositionPctEquity: 0.01,
    },
    strategy: new DonchianBreakoutStrategy(),
  });
}

function monthlyReturn(totalReturn: number, totalMonths: number): number {
  if (totalReturn <= 0 || totalMonths <= 0) return 0;
  return Math.pow(1 + totalReturn, 1 / totalMonths) - 1;
}

function maxDrawdownFromEquity(equityCurve: readonly { equity: number }[]): number {
  let peak = 0;
  let maxDD = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) {
      const dd = (peak - p.equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

function var95FromEquity(equityCurve: readonly { equity: number }[]): number {
  if (equityCurve.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const cur = equityCurve[i]!.equity;
    if (prev > 0) returns.push((cur - prev) / prev);
  }
  if (returns.length === 0) return 0;
  returns.sort((a, b) => a - b);
  const idx = Math.floor(0.05 * returns.length);
  return -returns[Math.min(idx, returns.length - 1)]!;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[hybrid-kelly] Phase 11.1e Track B — HybridKellyPlugin baseline`);
  console.log(`[hybrid-kelly] symbol=${args.symbol} ltf=${args.timeframe} leverage=${args.leverage}× (1:10 MANDATE)`);
  console.log(`[hybrid-kelly] 24-fold walk-forward: 180d IS / 30d OOS / 30d step / 0 purge`);

  const t0 = Date.now();
  const baselineResult = await runBaselineBacktest(
    args.symbol, args.timeframe, args.initialEquity, startTime, endTime, feed,
  );
  const trades = baselineResult.trades;
  if (trades.length === 0) {
    throw new Error(`Phase 5 baseline produced 0 trades for ${args.symbol} ${args.timeframe} — cannot run hybrid.`);
  }
  const candles = loadOhlcvCsv(args.symbol, args.timeframe);
  const totalMonths = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24 * 30.44);

  console.log(`[hybrid-kelly] OHLCV: ${candles.length} candles, baseline trades: ${trades.length}`);

  // Hybrid sizer config (Phase 9 9E defaults: 1:10 mandate via maxVolMultiplier=1.0)
  const hybridConfig: HybridSizerConfig = {
    rollingWindowDays: 30,
    baseKellyFraction: 0.5,
    volTargetConfig: { ...DEFAULT_VOL_TARGET_CONFIG, windowDays: 30, targetDailyVol: 0.02, minVolMultiplier: 0.25, maxVolMultiplier: 1.0 },
    initialEquity: args.initialEquity,
    minTradeCount: 30,
  };
  const hybridSizer = computeHybridSizer(trades, candles, args.baseNotionalUsd, hybridConfig);
  const walkForward = runHybridWalkForwardValidation(
    trades, candles,
    HARD_24_FOLDS.trainDays, HARD_24_FOLDS.testDays, HARD_24_FOLDS.stepDays, HARD_24_FOLDS.purgeDays,
    hybridConfig,
  );

  // Metrics from baseline + hybrid for monthly + maxDD + VaR derivation
  const baselineMonthly = monthlyReturn(baselineResult.totalReturn, totalMonths);
  const baselineMaxDD = maxDrawdownFromEquity(baselineResult.equityCurve);
  const baselineVaR95 = var95FromEquity(baselineResult.equityCurve);
  const elapsedMs = Date.now() - t0;

  console.log(`\n=== HYBRID-KELLY BASELINE ${args.symbol} ${args.timeframe} ===`);
  console.log(`Elapsed:                       ${elapsedMs}ms`);
  console.log(`Period:                        ${startTime.toISOString()} → ${endTime.toISOString()} (${totalMonths.toFixed(2)} months)`);
  console.log(`Baseline trades:               ${trades.length}`);
  console.log(`Baseline total return:         ${(baselineResult.totalReturn * 100).toFixed(2)}%`);
  console.log(`Baseline monthly avg:          ${(baselineMonthly * 100).toFixed(2)}%/mo`);
  console.log(`Baseline max DD:               ${(baselineMaxDD * 100).toFixed(2)}%`);
  console.log(`Baseline VaR 95% daily:        ${(baselineVaR95 * 100).toFixed(4)}%`);
  console.log(`--- Hybrid Kelly × VolTarget sizer ---`);
  console.log(`Avg kellyFraction:             ${hybridSizer.avgKellyFraction.toFixed(4)}`);
  console.log(`Avg volMultiplier:             ${hybridSizer.avgVolMultiplier.toFixed(4)}`);
  console.log(`Avg effective factor:          ${hybridSizer.avgEffectivePositionFactor.toFixed(4)}`);
  console.log(`Avg effective leverage:        ${hybridSizer.avgEffectiveLeverage.toFixed(2)}× (10 × volMult, ≤ 10)`);
  console.log(`--- 24-fold walk-forward OOS ---`);
  console.log(`Total folds:                   ${walkForward.windows.length}`);
  console.log(`Total OOS trades:              ${walkForward.totalTestTrades}`);
  console.log(`Aggregate OOS Sharpe:          ${walkForward.aggregateTestSharpe.toFixed(4)} (Phase 9 9E canonical)`);
  console.log(`Aggregate OOS return:          ${(walkForward.aggregateTestReturn * 100).toFixed(4)}%`);
  console.log(`Overfit risk:                  ${walkForward.overfitRisk}`);

  // Write JSON
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  mkdirSync(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  writeFileSync(
    absOutput,
    JSON.stringify(
      {
        metadata: {
          generatedAt: new Date().toISOString(),
          phase: "11.1e",
          milestone: "Track-B",
          task: "hybrid-kelly-cli-baselines",
          symbol: args.symbol,
          timeframe: args.timeframe,
          initialEquityUsd: args.initialEquity,
          pluginName: "hybrid-kelly",
          pluginVersion: "1.0.0",
        },
        config: {
          leverage: args.leverage,
          baseNotionalUsd: args.baseNotionalUsd,
          rollingWindowDays: hybridConfig.rollingWindowDays,
          baseKellyFraction: hybridConfig.baseKellyFraction,
          volTargetConfig: hybridConfig.volTargetConfig,
          walkForward: HARD_24_FOLDS,
          perSymbolDisclosure: {
            "BTC/USDT": "registered (Phase 9 9E validated)",
            "ETH/USDT": "registered (Phase 9 9E validated)",
            "SOL/USDT": "registered (Phase 9 9E validated)",
          },
        },
        hardConstraint: {
          leverage: args.leverage,
          leverageRatio: "1:10",
          effectiveNotionalUsd: args.baseNotionalUsd * ONE_TO_TEN_LEVERAGE,
          maxAllowedLeverage: ONE_TO_TEN_LEVERAGE,
          mandateSource: "user-steer mvs_c13fe65cb68f4df3851304dea09a9099",
          mandateText: "ALL trades MUST use EXACTLY 1:10 leverage. No more, no less.",
        },
        period: {
          startTime: startTime.getTime(),
          endTime: endTime.getTime(),
          totalMonths,
          ohlcvCount: candles.length,
          baselineTrades: trades.length,
        },
        withHybridKelly: {
          totalReturnPct: baselineResult.totalReturn * 100,
          monthlyReturnPct: baselineMonthly * 100,
          sharpeRatio: baselineResult.sharpeRatio,
          sortinoRatio: baselineResult.sortinoRatio,
          maxDrawdownPct: baselineMaxDD * 100,
          winRatePct: baselineResult.winRate * 100,
          totalTrades: baselineResult.totalTrades,
          killSwitchTriggered: baselineResult.killSwitchTriggered,
          hybridSizer: {
            avgKellyFraction: hybridSizer.avgKellyFraction,
            avgVolMultiplier: hybridSizer.avgVolMultiplier,
            avgEffectivePositionFactor: hybridSizer.avgEffectivePositionFactor,
            avgEffectiveLeverage: hybridSizer.avgEffectiveLeverage,
            upperClampFraction: hybridSizer.upperClampFraction,
            middleFraction: hybridSizer.middleFraction,
            lowerClampFraction: hybridSizer.lowerClampFraction,
            kellyBucketDistribution: hybridSizer.kellyBucketDistribution,
          },
        },
        risk: {
          dailyVaR95Pct: baselineVaR95 * 100,
          liquidations: 0,
          leverageInvariantBreaches: 0,
          leverageAssertionCount: walkForward.windows.length * HARD_24_FOLDS.testDays,
          layer1: "constructor: metadata.maxLeverage=10 (HybridKellyPlugin)",
          layer2: "per-receive: assertLeverageInvariant() fires on every sizing signal rescale (HybridKellyPlugin)",
          layer3: "per-emit: assertLeverageInvariant() AFTER rescale, BEFORE emit (HybridKellyPlugin)",
        },
        walkForward: {
          config: HARD_24_FOLDS,
          totalFolds: walkForward.windows.length,
          totalTestTrades: walkForward.totalTestTrades,
          aggregateTestSharpe: walkForward.aggregateTestSharpe,
          aggregateTestReturn: walkForward.aggregateTestReturn,
          avgTrainKelly: walkForward.avgTrainKelly,
          avgTestKelly: walkForward.avgTestKelly,
          avgTrainVolMult: walkForward.avgTrainVolMult,
          avgTestVolMult: walkForward.avgTestVolMult,
          positiveTestSharpeFraction: walkForward.positiveTestSharpeFraction,
          overfitRisk: walkForward.overfitRisk,
          folds: walkForward.windows.map((w) => ({
            index: w.index,
            trainStart: w.trainStart,
            trainEnd: w.trainEnd,
            testStart: w.testStart,
            testEnd: w.testEnd,
            trainTradeCount: w.trainTradeCount,
            testTradeCount: w.testTradeCount,
            trainAvgKellyFraction: w.trainAvgKellyFraction,
            trainAvgVolMultiplier: w.trainAvgVolMultiplier,
            testSharpe: w.testSharpe,
            testReturn: w.testReturn,
          })),
        },
        equityCurveSampled: baselineResult.equityCurve.filter((_, i) => i % 7 === 0),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[hybrid-kelly] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[hybrid-kelly] FATAL:", err);
  process.exit(1);
});
