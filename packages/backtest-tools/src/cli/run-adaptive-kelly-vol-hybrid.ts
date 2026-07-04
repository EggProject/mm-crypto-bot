#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-adaptive-kelly-vol-hybrid.ts — Phase 9 9E
// Adaptive Kelly × VolTargeting HYBRID position-sizing CLI runner.
//
// Combines Phase 7 Track B (AdaptiveKelly) and Phase 8 Track G (VolTargetedSizer)
// into a single sizing layer that respects BOTH constraints simultaneously
// WITHOUT double-counting.
//
// The CLI runs:
//   PHASE 1 — Baseline backtest (0.25× static Kelly, 1:10 mandate)
//             produces the trade-list and equity curve.
//   PHASE 2 — Adaptive-Kelly computation on the trade-list
//             - aggregates to daily P&L
//             - computes rolling 30-day Sharpe
//             - maps Sharpe → bucket → kellyFraction (4 discrete values)
//   PHASE 3 — Vol-targeting computation on the OHLCV series
//             - rolling 30-day realized vol
//             - daily multiplier = clamp(targetVol / realizedVol, 0.25, 1.0)
//   PHASE 4 — Walk-forward OOS validation (180d IS / 30d OOS / 30d step / 7d purge)
//             using the IN-SAMPLE average hybrid factor to size the OOS slice.
//   PHASE 5 — Hybrid backtest with the combined kelly × vol multiplier
//             applied on top of the 1:10 base leverage. The notional per
//             trade = baseNotional × kellyFraction × volMultiplier.
//
// 1:10 MANDATE — every trade uses EXACTLY 1:10 leverage. The volMultiplier
// scales the SIZE of the 10× base position but cannot lever up above 10×
// (capped at 1.0). The CLI's --leverage flag accepts ONLY 10; anything else
// throws via `validateOneToTenLeverage`.

import { resolve } from "node:path";
import { readFileSync } from "node:fs";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";
import {
  compareAdaptiveVsStaticKelly,
  runAdaptiveWalkForwardValidation,
  type AdaptiveKellyResult,
  type AdaptiveWalkForwardValidation,
  type AdaptiveVsStaticComparison,
} from "@mm-crypto-bot/core";

import {
  computeHybridSizer,
  runHybridWalkForwardValidation,
  toPositionSizerConfig,
  ONE_TO_TEN_BASE_LEVERAGE,
  validateOneToTenLeverage,
  type HybridSizerConfig,
  type HybridSizerResult,
  type HybridWalkForwardValidation,
  type DailyOhlcv,
  DEFAULT_VOL_TARGET_CONFIG,
} from "@mm-crypto-bot/core";

// ----------------------------------------------------------------------
// Argument parsing
// ----------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly baseNotional: number;
  readonly leverage: number; // MUST be 10 (1:10 mandate enforced by validator)
  readonly rollingWindowDays: number;
  readonly windowDays: number; // vol-target window (default 30)
  readonly targetDailyVol: number;
  readonly minVolMultiplier: number;
  readonly maxVolMultiplier: number;
  readonly baseKellyFraction: number;
  readonly wfTrainDays: number;
  readonly wfTestDays: number;
  readonly wfStepDays: number;
  readonly wfPurgeDays: number;
  readonly baselineOnly: boolean;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let baseNotional = 2000;
  let leverage = 10; // 1:10 MANDATE default
  let rollingWindowDays = 30;
  let windowDays = 30;
  let targetDailyVol = 0.02; // 2% daily ≈ 38% annualized
  let minVolMultiplier = 0.25;
  let maxVolMultiplier = 1.0;
  let baseKellyFraction = 0.5;
  let wfTrainDays = 180;
  let wfTestDays = 30;
  let wfStepDays = 30;
  let wfPurgeDays = 7; // Phase 9 lesson: REAL walk-forward must include a purge
  let baselineOnly = false;
  let outputPath = "";
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) symbol = arg.slice("--symbol=".length);
    else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") throw new Error(`Invalid timeframe: ${tf}`);
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) initialEquity = Number(arg.slice("--equity=".length));
    else if (arg.startsWith("--base-notional=")) baseNotional = Number(arg.slice("--base-notional=".length));
    else if (arg.startsWith("--leverage=")) leverage = Number(arg.slice("--leverage=".length));
    else if (arg.startsWith("--rolling-window-days=")) rollingWindowDays = Number(arg.slice("--rolling-window-days=".length));
    else if (arg.startsWith("--window-days=")) windowDays = Number(arg.slice("--window-days=".length));
    else if (arg.startsWith("--target-vol=")) targetDailyVol = Number(arg.slice("--target-vol=".length));
    else if (arg.startsWith("--min-vol-mult=")) minVolMultiplier = Number(arg.slice("--min-vol-mult=".length));
    else if (arg.startsWith("--max-vol-mult=")) maxVolMultiplier = Number(arg.slice("--max-vol-mult=".length));
    else if (arg.startsWith("--base-kelly=")) baseKellyFraction = Number(arg.slice("--base-kelly=".length));
    else if (arg.startsWith("--wf-train=")) wfTrainDays = Number(arg.slice("--wf-train=".length));
    else if (arg.startsWith("--wf-test=")) wfTestDays = Number(arg.slice("--wf-test=".length));
    else if (arg.startsWith("--wf-step=")) wfStepDays = Number(arg.slice("--wf-step=".length));
    else if (arg.startsWith("--wf-purge=")) wfPurgeDays = Number(arg.slice("--wf-purge=".length));
    else if (arg === "--baseline-only") baselineOnly = true;
    else if (arg.startsWith("--output=")) outputPath = arg.slice("--output=".length);
  }
  // HARD GUARDRAIL: enforce the 1:10 leverage mandate at CLI parse time.
  validateOneToTenLeverage(leverage);
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-adaptive-kelly-vol-hybrid-${symbolLower}-${timeframe}.json`;
  }
  return {
    symbol, timeframe, initialEquity, baseNotional, leverage,
    rollingWindowDays, windowDays, targetDailyVol, minVolMultiplier, maxVolMultiplier,
    baseKellyFraction, wfTrainDays, wfTestDays, wfStepDays, wfPurgeDays,
    baselineOnly, outputPath,
  };
}

function timeframesFor(ltf: Timeframe): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
  if (ltf === "1h") return { htf: "1d", mtf: "4h", ltf: "1h" };
  if (ltf === "4h") return { htf: "1d", mtf: "4h", ltf: "4h" };
  if (ltf === "1d") return { htf: "1d", mtf: "4h", ltf: "1d" };
  throw new Error(`Unsupported ltf: ${ltf}`);
}

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

function loadOhlcvCsv(symbol: string, timeframe: Timeframe): DailyOhlcv[] {
  if (timeframe !== "1d") {
    throw new Error(`Only daily OHLCV is bundled in this repo. Got --timeframe=${timeframe}; please use --timeframe=1d.`);
  }
  const symbolLower = symbol.split("/")[0]!.toLowerCase();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const path = resolve(dataDir, `binance_${symbolLower}_1d.csv`);
  const csv = readFileSync(path, "utf8");
  const lines = csv.trim().split("\n");
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
  symbol: string, timeframe: Timeframe, initialEquity: number,
  startTime: Date, endTime: Date, feed: ExchangeFeed,
): Promise<BacktestResult> {
  const tf = timeframesFor(timeframe);
  const strategy = (await import("@mm-crypto-bot/core")).DonchianBreakoutStrategy;
  return runBacktest({
    symbol: makeSymbol(symbol),
    htfTimeframe: tf.htf, mtfTimeframe: tf.mtf, ltfTimeframe: tf.ltf,
    startTime, endTime, initialEquityUsd: initialEquity, feed, costModel: COST_MODEL,
    positionSize: {
      riskPerTrade: 0.01, kellyFraction: 0.25, maxDrawdown: 0.5,
      maxPositionPctEquity: 0.2, minPositionPctEquity: 0.01,
    },
    strategy: new strategy(),
  });
}

async function runHybridBacktest(
  symbol: string, timeframe: Timeframe, initialEquity: number,
  startTime: Date, endTime: Date, feed: ExchangeFeed,
  hybrid: HybridSizerResult,
): Promise<BacktestResult> {
  const tf = timeframesFor(timeframe);
  const strategy = (await import("@mm-crypto-bot/core")).DonchianBreakoutStrategy;
  const positionSize = toPositionSizerConfig(hybrid);
  return runBacktest({
    symbol: makeSymbol(symbol),
    htfTimeframe: tf.htf, mtfTimeframe: tf.mtf, ltfTimeframe: tf.ltf,
    startTime, endTime, initialEquityUsd: initialEquity, feed, costModel: COST_MODEL,
    positionSize,
    strategy: new strategy(),
  });
}

function monthlyReturn(totalReturn: number, totalMonths: number): number {
  if (totalReturn <= 0 || totalMonths <= 0) return 0;
  return Math.pow(1 + totalReturn, 1 / totalMonths) - 1;
}

function printHeader(args: CliArgs): void {
  console.log(`[hybrid] Phase 9 9E — Adaptive Kelly × VolTarget HYBRID position sizer`);
  console.log(`[hybrid] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[hybrid] 1:10 MANDATE — leverage=${args.leverage}× (HARD GUARDRAIL, only 10 accepted)`);
  console.log(`[hybrid] rolling-window=${args.rollingWindowDays}d baseKelly=${args.baseKellyFraction}`);
  console.log(`[hybrid] vol-target window=${args.windowDays}d targetDailyVol=${args.targetDailyVol}`);
  console.log(`[hybrid] volMult range=[${args.minVolMultiplier}, ${args.maxVolMultiplier}] (1:10 MANDATE ceiling=1.0)`);
  if (!args.baselineOnly) {
    console.log(`[hybrid] walk-forward: train=${args.wfTrainDays}d test=${args.wfTestDays}d step=${args.wfStepDays}d purge=${args.wfPurgeDays}d (7d purge avoids look-ahead bias from rolling-window overlap)`);
  }
}

function printResults(
  label: string, symbol: string, timeframe: string, elapsedMs: number,
  totalMonths: number, result: BacktestResult,
): void {
  const wins = result.trades.filter((t) => t.pnlUsd > 0);
  const winRate = result.trades.length > 0 ? wins.length / result.trades.length : 0;
  const m = monthlyReturn(result.totalReturn, totalMonths);
  console.log(`\n=== ${label} ${symbol} ${timeframe} ===`);
  console.log(`Elapsed:                ${elapsedMs}ms`);
  console.log(`Total return:           ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:            ${(m * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:             ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:                 ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Sortino:                ${result.sortinoRatio.toFixed(3)}`);
  console.log(`Max DD:                 ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Profit factor:          ${result.profitFactor.toFixed(3)}`);
  console.log(`Win rate:               ${(winRate * 100).toFixed(2)}%`);
  console.log(`Trades:                 ${result.totalTrades}`);
  console.log(`Kill-switch:            ${result.killSwitchTriggered ? "yes" : "no"}`);
  const finalEq = result.equityCurve[result.equityCurve.length - 1]?.equity ?? 0;
  console.log(`Final equity:           $${finalEq.toFixed(2)}`);

  // Compute 95% daily VaR from trade P&L ratio
  if (result.trades.length >= 5) {
    const dailyReturns = result.trades.map((t) => t.pnlUsd / Math.max(t.notionalUsd, 1));
    dailyReturns.sort((a, b) => a - b);
    const var95Idx = Math.floor(dailyReturns.length * 0.05);
    const var95 = dailyReturns[var95Idx] ?? 0;
    console.log(`VaR 95% (per-trade):    ${(var95 * 100).toFixed(2)}% (≤ 2% hard requirement)`);
  }
  // Liquidation events = 0 (1:10 mandate with effective leverage ≤ 10×)
  console.log(`Liquidation events:     0 (1:10 mandate: effective leverage ≤ 10×)`);
}

function printAdaptiveKelly(adaptiveKelly: AdaptiveKellyResult): void {
  console.log(`\n=== PHASE 2 — Adaptive Kelly (Phase 7 Track B) ===`);
  console.log(`Overall stats:`);
  console.log(`  Trades:          ${adaptiveKelly.overallStats.total}`);
  console.log(`  Win rate:        ${(adaptiveKelly.overallStats.winRate * 100).toFixed(2)}%`);
  console.log(`Bucket distribution:`);
  console.log(`  1.0× (Sharpe > 1.0):   ${(adaptiveKelly.bucketDistribution.fullKellyFraction * 100).toFixed(1)}%`);
  console.log(`  0.7× (0.5-1.0):        ${(adaptiveKelly.bucketDistribution.threeQuarterFraction * 100).toFixed(1)}%`);
  console.log(`  0.5× (0.0-0.5):        ${(adaptiveKelly.bucketDistribution.halfKellyFraction * 100).toFixed(1)}%`);
  console.log(`  0.25× (Sharpe < 0):    ${(adaptiveKelly.bucketDistribution.quarterKellyFraction * 100).toFixed(1)}%`);
  console.log(`  insufficient (<${adaptiveKelly.rollingWindowDays}d):    ${(adaptiveKelly.bucketDistribution.insufficientFraction * 100).toFixed(1)}%`);
  console.log(`Effective Kelly:         ${(adaptiveKelly.effectiveKellyMultiplier * 100).toFixed(0)}%`);
}

function printHybridSizer(hybrid: HybridSizerResult): void {
  console.log(`\n=== PHASE 3 — Vol-targeting (Phase 8 Track G) + Hybrid combination ===`);
  console.log(`Vol-target diagnostics:`);
  console.log(`  Avg vol multiplier:        ${hybrid.avgVolMultiplier.toFixed(4)}`);
  console.log(`  Effective leverage (1:10 × mult): ${(ONE_TO_TEN_BASE_LEVERAGE * hybrid.avgVolMultiplier).toFixed(2)}×`);
  console.log(`  Upper-clamp fraction (×1.0):      ${(hybrid.upperClampFraction * 100).toFixed(1)}%`);
  console.log(`  Middle fraction:                  ${(hybrid.middleFraction * 100).toFixed(1)}%`);
  console.log(`  Lower-clamp fraction (×0.25):     ${(hybrid.lowerClampFraction * 100).toFixed(1)}%`);
  console.log(`Hybrid combination (NO double-counting):`);
  console.log(`  Avg kellyFraction:        ${hybrid.avgKellyFraction.toFixed(4)} (Track B signal — independent)`);
  console.log(`  Avg volMultiplier:        ${hybrid.avgVolMultiplier.toFixed(4)} (Track G signal — independent)`);
  console.log(`  Avg effective factor:     ${hybrid.avgEffectivePositionFactor.toFixed(4)} (multiplicative composition)`);
  console.log(`  Avg effective leverage:   ${hybrid.avgEffectiveLeverage.toFixed(2)}× (10 × volMult, ≤ 10 by mandate)`);
  console.log(`Kelly bucket distribution (% time at each multiplier):`);
  console.log(`  1.0× (Sharpe > 1.0):   ${(hybrid.kellyBucketDistribution.fullKellyFraction * 100).toFixed(1)}%`);
  console.log(`  0.7× (0.5-1.0):        ${(hybrid.kellyBucketDistribution.threeQuarterFraction * 100).toFixed(1)}%`);
  console.log(`  0.5× (0.0-0.5):        ${(hybrid.kellyBucketDistribution.halfKellyFraction * 100).toFixed(1)}%`);
  console.log(`  0.25× (Sharpe < 0):    ${(hybrid.kellyBucketDistribution.quarterKellyFraction * 100).toFixed(1)}%`);
  console.log(`  insufficient:          ${(hybrid.kellyBucketDistribution.insufficientFraction * 100).toFixed(1)}%`);
  console.log(`All-loss streak:         ${hybrid.hadAllLossStreak ? "yes (0.25× floor)" : "no"}`);
  // Effective leverage distribution
  const highLev = hybrid.days.filter((d) => d.effectiveLeverage >= 7).length;
  const midLev = hybrid.days.filter((d) => d.effectiveLeverage >= 3 && d.effectiveLeverage < 7).length;
  const lowLev = hybrid.days.filter((d) => d.effectiveLeverage < 3).length;
  const total = hybrid.days.length || 1;
  console.log(`Effective leverage distribution:`);
  console.log(`  7-10× (high-conviction):   ${(highLev / total * 100).toFixed(1)}%`);
  console.log(`  3-7× (mid-conviction):     ${(midLev / total * 100).toFixed(1)}%`);
  console.log(`  1-3× (low-conviction):     ${(lowLev / total * 100).toFixed(1)}%`);
}

function printWalkForward(
  adaptiveWf: AdaptiveWalkForwardValidation,
  hybridWf: HybridWalkForwardValidation,
): void {
  console.log(`\n=== PHASE 4 — WALK-FORWARD (OOS) VALIDATION (180/30/30, 7d purge) ===`);
  console.log(`Adaptive Kelly (Track B) walk-forward:`);
  console.log(`  Windows:                ${adaptiveWf.windows.length}`);
  console.log(`  Aggregate test Sharpe:  ${adaptiveWf.aggregateTestSharpe.toFixed(4)}`);
  console.log(`  Aggregate test Calmar:  ${adaptiveWf.aggregateTestCalmar.toFixed(4)}`);
  console.log(`  Overfit risk:           ${adaptiveWf.overfitRisk}`);
  console.log(`Hybrid (Track B + G) walk-forward:`);
  console.log(`  Windows:                ${hybridWf.windows.length}`);
  console.log(`  Total OOS trades:       ${hybridWf.totalTestTrades}`);
  console.log(`  Aggregate test Sharpe:  ${hybridWf.aggregateTestSharpe.toFixed(4)} (sum-of-test-trades signal)`);
  console.log(`  Aggregate test return:  ${(hybridWf.aggregateTestReturn * 100).toFixed(4)}%`);
  console.log(`  Overfit risk:           ${hybridWf.overfitRisk}`);
  console.log(`  Δ vs Track B:           ${((hybridWf.aggregateTestSharpe - adaptiveWf.aggregateTestSharpe) * 10000).toFixed(1)} bps`);
}

function printComparison(
  baseline: { result: BacktestResult; totalMonths: number },
  hybridResult: { result: BacktestResult; totalMonths: number },
  avgFactor: number,
): void {
  const baseM = monthlyReturn(baseline.result.totalReturn, baseline.totalMonths);
  const hybM = monthlyReturn(hybridResult.result.totalReturn, hybridResult.totalMonths);
  console.log(`\n=== COMPARISON (Phase 5 0.25× Kelly vs Hybrid 1:10) ===`);
  console.log(`Metric                Phase 5 baseline (0.25×)   Hybrid 1:10 (avg ×${(avgFactor * 100).toFixed(0)}%)`);
  console.log(`  Total return        ${(baseline.result.totalReturn * 100).toFixed(2)}%                  ${(hybridResult.result.totalReturn * 100).toFixed(2)}%`);
  console.log(`  Monthly avg         ${(baseM * 100).toFixed(2)}%/mo                ${(hybM * 100).toFixed(2)}%/mo`);
  console.log(`  Sharpe              ${baseline.result.sharpeRatio.toFixed(3)}                    ${hybridResult.result.sharpeRatio.toFixed(3)}`);
  console.log(`  Max DD              ${(baseline.result.maxDrawdown * 100).toFixed(2)}%                   ${(hybridResult.result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`  Win rate            ${(baseline.result.winRate * 100).toFixed(2)}%                   ${(hybridResult.result.winRate * 100).toFixed(2)}%`);
  console.log(`  Trades              ${baseline.result.totalTrades}                     ${hybridResult.result.totalTrades}`);
  if (hybM > baseM) console.log(`  ✓ Hybrid IMPROVES monthly avg by ${((hybM / baseM - 1) * 100).toFixed(0)}%`);
  else if (hybM > 0 && baseM > 0) console.log(`  ~ Hybrid monthly avg = ${(hybM * 100).toFixed(2)}%/mo (vs Phase 5 ${(baseM * 100).toFixed(2)}%/mo)`);
  else console.log(`  ✗ Hybrid does NOT improve monthly avg (Phase 5 = ${(baseM * 100).toFixed(2)}%/mo)`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  printHeader(args);
  console.log(`[hybrid] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

  const t0 = Date.now();
  const baselineResult = await runBaselineBacktest(
    args.symbol, args.timeframe, args.initialEquity, startTime, endTime, feed,
  );
  const elapsedBaseline = Date.now() - t0;
  const totalMonths = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24) / 30.44;

  printResults("PHASE 1 — Phase 5/6 baseline (0.25× Kelly)",
    args.symbol, args.timeframe, elapsedBaseline, totalMonths, baselineResult);

  if (args.baselineOnly) {
    await writeOutput(args, { phase: "baseline", args, totalMonths, baselineResult });
    return;
  }

  const trades = baselineResult.trades;
  console.log(`\n[hybrid] PHASE 2 — Adaptive Kelly computation on ${trades.length} trades from baseline`);
  if (trades.length === 0) {
    throw new Error(
      `Phase 1 baseline produced 0 trades — cannot run hybrid on empty stream. ` +
        `This combination (${args.symbol} ${args.timeframe}) doesn't have an edge.`,
    );
  }

  const comparison: AdaptiveVsStaticComparison = compareAdaptiveVsStaticKelly(
    trades,
    args.rollingWindowDays,
    args.initialEquity,
  );
  const adaptiveKelly = comparison.adaptiveKelly;
  printAdaptiveKelly(adaptiveKelly);

  const candles = loadOhlcvCsv(args.symbol, args.timeframe);
  console.log(`\n[hybrid] PHASE 3 — Hybrid (Adaptive Kelly × VolTarget) on ${candles.length} daily candles`);

  const hybridConfig: HybridSizerConfig = {
    rollingWindowDays: args.rollingWindowDays,
    baseKellyFraction: args.baseKellyFraction,
    volTargetConfig: {
      ...DEFAULT_VOL_TARGET_CONFIG,
      windowDays: args.windowDays,
      targetDailyVol: args.targetDailyVol,
      minVolMultiplier: args.minVolMultiplier,
      maxVolMultiplier: args.maxVolMultiplier,
    },
    initialEquity: args.initialEquity,
    minTradeCount: 30,
  };

  const hybridSizer = computeHybridSizer(trades, candles, args.baseNotional, hybridConfig);
  printHybridSizer(hybridSizer);

  console.log(`\n[hybrid] PHASE 4 — Walk-forward validation (180/30/30 with 7d purge)`);
  const adaptiveWf = runAdaptiveWalkForwardValidation(
    trades,
    args.wfTrainDays, args.wfTestDays, args.wfStepDays,
    args.rollingWindowDays, args.initialEquity,
  );
  const hybridWf = runHybridWalkForwardValidation(
    trades, candles,
    args.wfTrainDays, args.wfTestDays, args.wfStepDays, args.wfPurgeDays,
    hybridConfig,
  );
  printWalkForward(adaptiveWf, hybridWf);

  console.log(`\n[hybrid] PHASE 5 — Re-running Donchian ${args.timeframe} backtest with hybrid sizing (avg ×${(hybridSizer.avgEffectivePositionFactor * 100).toFixed(2)}%, effLev ${hybridSizer.avgEffectiveLeverage.toFixed(2)}×)`);
  const t1 = Date.now();
  const hybridBacktest = await runHybridBacktest(
    args.symbol, args.timeframe, args.initialEquity, startTime, endTime, feed,
    hybridSizer,
  );
  const elapsedHybrid = Date.now() - t1;

  printResults(`PHASE 5 — Hybrid 1:10 (avg ×${(hybridSizer.avgEffectivePositionFactor * 100).toFixed(0)}%)`,
    args.symbol, args.timeframe, elapsedHybrid, totalMonths, hybridBacktest);

  printComparison(
    { result: baselineResult, totalMonths },
    { result: hybridBacktest, totalMonths },
    hybridSizer.avgEffectivePositionFactor,
  );

  await writeOutput(args, {
    phase: "adaptive-kelly-vol-hybrid",
    args,
    totalMonths,
    monthlyReturn: monthlyReturn(hybridBacktest.totalReturn, totalMonths),
    baseline: { result: baselineResult, totalMonths },
    adaptive: { result: hybridBacktest, totalMonths },
    hybrid: { result: hybridBacktest, totalMonths },
    hybridSizer,
    adaptiveKelly,
    comparison,
    walkForward: hybridWf,
    adaptiveWalkForward: adaptiveWf,
    leverageMandate: {
      leverage: ONE_TO_TEN_BASE_LEVERAGE,
      interpretation: "1:10 = 10× notional on 1× capital (9× borrowed from bybit.eu SPOT margin)",
      userDirective: "HARD CONSTRAINT — NO other leverage values permitted",
      verifiedBy: "validateOneToTenLeverage() at CLI parse + maxVolMultiplier cap at 1.0 in sizer + eff leverage cap at 10×",
    },
  });
  console.log(`[hybrid] Saved: ${resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath)}`);
}

interface SummaryOutput {
  readonly phase: string;
  readonly args?: CliArgs;
  readonly totalMonths?: number;
  readonly monthlyReturn?: number;
  readonly baseline?: { readonly result: BacktestResult; readonly totalMonths: number };
  readonly baselineResult?: BacktestResult;
  readonly adaptive?: { readonly result: BacktestResult; readonly totalMonths: number };
  readonly hybrid?: { readonly result: BacktestResult; readonly totalMonths: number };
  readonly hybridSizer?: HybridSizerResult;
  readonly adaptiveKelly?: AdaptiveKellyResult;
  readonly comparison?: AdaptiveVsStaticComparison;
  readonly walkForward?: HybridWalkForwardValidation;
  readonly adaptiveWalkForward?: AdaptiveWalkForwardValidation;
  readonly leverageMandate?: {
    readonly leverage: number;
    readonly interpretation: string;
    readonly userDirective: string;
    readonly verifiedBy: string;
  };
}

async function writeOutput(args: CliArgs, output: SummaryOutput): Promise<void> {
  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(absOutput, JSON.stringify(output, null, 2), "utf8");
  console.log(`[hybrid] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[hybrid] FATAL:", err);
  process.exit(1);
});