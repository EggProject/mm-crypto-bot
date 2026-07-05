#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-vol-targeted-baseline.ts — Phase 8 Track G
// Volatility-targeted position sizing CLI runner.
//
// Mimics run-kelly-adaptive.ts but emits a VOL-TARGETED Kelly backtest:
// rolling 30-day realized vol drives the per-day multiplier on top of the
// 1:10 base leverage (the user's HARD mandate).
//
// The CLI runs:
//   PHASE 1 — Baseline backtest (0.25× static Kelly on 1:10 base, fixed sizing)
//             produces the trade-list and equity curve.
//   PHASE 2 — Vol-targeting computation on the daily OHLCV series
//             - rolling 30-day realized vol (sample std of log returns)
//             - daily multiplier = clamp(targetVol / realizedVol, 0.25, 1.0)
//             - time-in-bucket (% at lower/middle/upper clamp)
//             - average multiplier, avg realized vol
//   PHASE 3 — Walk-forward OOS validation (180d IS / 30d OOS / 30d step)
//             using the IN-SAMPLE average multiplier to size the OOS slice.
//   PHASE 4 — Vol-targeted backtest with the volMultiplier scaler
//             applied on top of the 1:10 base leverage. The notional per
//             trade = baseNotional × volMultiplier (no Kelly).
//
// 1:10 MANDATE — every trade uses EXACTLY 1:10 leverage (10× notional on 1×
// capital). The volMultiplier scales the SIZE of the 10× position but cannot
// lever up above 10× (capped at 1.0). The CLI's --leverage flag accepts ONLY
// 10 — anything else throws.

import { resolve } from "node:path";
import { readFileSync } from "node:fs";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";
import {
  computeVolTargetedSizer,
  DonchianBreakoutStrategy,
  ONE_TO_TEN_BASE_LEVERAGE,
  runVolTargetWalkForwardValidation,
  validateOneToTenLeverage,
  type DailyOhlcv,
  type VolTargetConfig,
  type VolTargetedSizerResult,
  type VolTargetWalkForwardValidation,
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
  readonly windowDays: number;
  readonly targetDailyVol: number;
  readonly minVolMultiplier: number;
  readonly maxVolMultiplier: number;
  readonly baseKellyFraction: number;
  readonly wfTrainDays: number;
  readonly wfTestDays: number;
  readonly wfStepDays: number;
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
  let windowDays = 30;
  let targetDailyVol = 0.02; // 2% daily ≈ 38% annualized
  let minVolMultiplier = 0.25;
  let maxVolMultiplier = 1.0;
  let baseKellyFraction = 0.5;
  let wfTrainDays = 180;
  let wfTestDays = 30;
  let wfStepDays = 30;
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
    else if (arg.startsWith("--window-days=")) windowDays = Number(arg.slice("--window-days=".length));
    else if (arg.startsWith("--target-vol=")) targetDailyVol = Number(arg.slice("--target-vol=".length));
    else if (arg.startsWith("--min-vol-mult=")) minVolMultiplier = Number(arg.slice("--min-vol-mult=".length));
    else if (arg.startsWith("--max-vol-mult=")) maxVolMultiplier = Number(arg.slice("--max-vol-mult=".length));
    else if (arg.startsWith("--base-kelly=")) baseKellyFraction = Number(arg.slice("--base-kelly=".length));
    else if (arg.startsWith("--wf-train=")) wfTrainDays = Number(arg.slice("--wf-train=".length));
    else if (arg.startsWith("--wf-test=")) wfTestDays = Number(arg.slice("--wf-test=".length));
    else if (arg.startsWith("--wf-step=")) wfStepDays = Number(arg.slice("--wf-step=".length));
    else if (arg === "--baseline-only") baselineOnly = true;
    else if (arg.startsWith("--output=")) outputPath = arg.slice("--output=".length);
  }
  // HARD GUARDRAIL: enforce the 1:10 leverage mandate at CLI parse time.
  validateOneToTenLeverage(leverage);
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-vol-targeted-${symbolLower}-${timeframe}.json`;
  }
  return {
    symbol, timeframe, initialEquity, baseNotional, leverage,
    windowDays, targetDailyVol, minVolMultiplier, maxVolMultiplier,
    baseKellyFraction, wfTrainDays, wfTestDays, wfStepDays,
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
  const strategy = new DonchianBreakoutStrategy();
  return runBacktest({
    symbol: makeSymbol(symbol),
    htfTimeframe: tf.htf, mtfTimeframe: tf.mtf, ltfTimeframe: tf.ltf,
    startTime, endTime, initialEquityUsd: initialEquity, feed, costModel: COST_MODEL,
    positionSize: {
      riskPerTrade: 0.01, kellyFraction: 0.25, maxDrawdown: 0.5,
      maxPositionPctEquity: 0.2, minPositionPctEquity: 0.01,
    },
    strategy,
  });
}

async function runVolTargetedBacktest(
  symbol: string, timeframe: Timeframe, initialEquity: number,
  startTime: Date, endTime: Date, feed: ExchangeFeed,
  avgVolMultiplier: number, baseKellyFraction: number, baseNotional: number,
): Promise<BacktestResult> {
  const tf = timeframesFor(timeframe);
  const strategy = new DonchianBreakoutStrategy();
  const effectiveCap = Math.min(0.99, baseKellyFraction * avgVolMultiplier * 0.2);
  const effectiveRiskPerTrade = effectiveCap / 0.1;
  void baseNotional;
  return runBacktest({
    symbol: makeSymbol(symbol),
    htfTimeframe: tf.htf, mtfTimeframe: tf.mtf, ltfTimeframe: tf.ltf,
    startTime, endTime, initialEquityUsd: initialEquity, feed, costModel: COST_MODEL,
    positionSize: {
      riskPerTrade: effectiveRiskPerTrade,
      kellyFraction: 1.0,
      maxDrawdown: 0.15,
      maxPositionPctEquity: effectiveCap,
      minPositionPctEquity: 0.01,
    },
    strategy,
  });
}

function monthlyReturn(totalReturn: number, totalMonths: number): number {
  if (totalReturn <= 0 || totalMonths <= 0) return 0;
  return Math.pow(1 + totalReturn, 1 / totalMonths) - 1;
}

function printHeader(args: CliArgs): void {
  console.log(`[vol-targeted] Phase 8 Track G — Volatility-targeted position sizing`);
  console.log(`[vol-targeted] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[vol-targeted] 1:10 MANDATE — leverage=${args.leverage}× (HARD GUARDRAIL, only 10 accepted)`);
  console.log(`[vol-targeted] window=${args.windowDays}d targetDailyVol=${args.targetDailyVol} (annualized=${(args.targetDailyVol * Math.sqrt(365) * 100).toFixed(2)}%)`);
  console.log(`[vol-targeted] volMult range=[${args.minVolMultiplier}, ${args.maxVolMultiplier}] baseKelly=${args.baseKellyFraction}`);
  if (!args.baselineOnly) {
    console.log(`[vol-targeted] walk-forward: train=${args.wfTrainDays}d test=${args.wfTestDays}d step=${args.wfStepDays}d`);
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
}

function printVolTarget(sizer: VolTargetedSizerResult): void {
  console.log(`\n=== VOL-TARGETED SIZER (1:10 mandate, volMultiplier cap [0.25, 1.0]) ===`);
  console.log(`Realized vol diagnostics:`);
  console.log(`  Avg realized daily vol:    ${(sizer.avgRealizedDailyVol * 100).toFixed(4)}%`);
  console.log(`  Avg realized ann. vol:     ${(sizer.avgRealizedAnnualizedVol * 100).toFixed(2)}%`);
  console.log(`  Target daily vol:          ${(sizer.config.targetDailyVol * 100).toFixed(2)}%`);
  console.log(`  Target annualized vol:     ${(sizer.config.targetDailyVol * sizer.config.annualizationFactor * 100).toFixed(2)}%`);
  console.log(`Vol-multiplier distribution:`);
  console.log(`  Avg vol multiplier:        ${sizer.avgVolMultiplier.toFixed(4)}`);
  console.log(`  Effective leverage (1:10 × mult): ${(ONE_TO_TEN_BASE_LEVERAGE * sizer.avgVolMultiplier).toFixed(2)}×`);
  console.log(`  Upper-clamp fraction (×1.0, low-vol regime): ${(sizer.upperClampFraction * 100).toFixed(1)}%`);
  console.log(`  Middle fraction (×0.25..×1.0, normal regime): ${(sizer.middleFraction * 100).toFixed(1)}%`);
  console.log(`  Lower-clamp fraction (×0.25, high-vol regime): ${(sizer.lowerClampFraction * 100).toFixed(1)}%`);
  console.log(`  Time-in-bucket sum check:   ${(sizer.upperClampFraction + sizer.middleFraction + sizer.lowerClampFraction).toFixed(4)} (must ≈ 1.0)`);
}

function printWalkForward(wf: VolTargetWalkForwardValidation): void {
  console.log(`\n=== WALK-FORWARD (OOS) VALIDATION ===`);
  console.log(`Windows:                ${wf.windows.length}`);
  console.log(`  Total OOS days:       ${wf.totalTestDays.toFixed(0)}`);
  console.log(`  Avg train multiplier: ${wf.avgTrainMultiplier.toFixed(4)}`);
  console.log(`  Avg test multiplier:  ${wf.avgTestMultiplier.toFixed(4)} (frozen train→test)`);
  console.log(`  Aggregate test return: ${(wf.aggregateTestReturn * 100).toFixed(4)}%`);
  console.log(`  Aggregate test Sharpe: ${wf.aggregateTestSharpe.toFixed(4)} (sum-of-test-trades signal)`);
  console.log(`  OOS/IS ratio:          ${wf.oosIsRatio.toFixed(4)}`);
  console.log(`  Overfit risk:          ${wf.overfitRisk}`);
}

function printComparison(
  baseline: { result: BacktestResult; totalMonths: number },
  volResult: { result: BacktestResult; totalMonths: number },
  avgMultiplier: number,
): void {
  const baseM = monthlyReturn(baseline.result.totalReturn, baseline.totalMonths);
  const volM = monthlyReturn(volResult.result.totalReturn, volResult.totalMonths);
  console.log(`\n=== COMPARISON (Phase 5 0.25× Kelly vs Vol-targeted 1:10) ===`);
  console.log(`Metric                Phase 5 baseline (0.25×)   Vol-targeted 1:10 (avg ×${(avgMultiplier * 100).toFixed(0)}%)`);
  console.log(`  Total return        ${(baseline.result.totalReturn * 100).toFixed(2)}%                  ${(volResult.result.totalReturn * 100).toFixed(2)}%`);
  console.log(`  Monthly avg         ${(baseM * 100).toFixed(2)}%/mo                ${(volM * 100).toFixed(2)}%/mo`);
  console.log(`  Sharpe              ${baseline.result.sharpeRatio.toFixed(3)}                    ${volResult.result.sharpeRatio.toFixed(3)}`);
  console.log(`  Max DD              ${(baseline.result.maxDrawdown * 100).toFixed(2)}%                   ${(volResult.result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`  Win rate            ${(baseline.result.winRate * 100).toFixed(2)}%                   ${(volResult.result.winRate * 100).toFixed(2)}%`);
  console.log(`  Trades              ${baseline.result.totalTrades}                     ${volResult.result.totalTrades}`);
  if (volM > baseM) console.log(`  ✓ Vol-targeted IMPROVES monthly avg by ${((volM / baseM - 1) * 100).toFixed(0)}%`);
  else if (volM > 0 && baseM > 0) console.log(`  ~ Vol-targeted monthly avg = ${(volM * 100).toFixed(2)}%/mo (vs Phase 5 ${(baseM * 100).toFixed(2)}%/mo)`);
  else console.log(`  ✗ Vol-targeted does NOT improve monthly avg (Phase 5 = ${(baseM * 100).toFixed(2)}%/mo)`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  printHeader(args);
  console.log(`[vol-targeted] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

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

  const candles = loadOhlcvCsv(args.symbol, args.timeframe);
  console.log(`\n[vol-targeted] PHASE 2 — Vol-targeting on ${candles.length} daily candles`);
  const volConfig: VolTargetConfig = {
    windowDays: args.windowDays,
    targetDailyVol: args.targetDailyVol,
    minVolMultiplier: args.minVolMultiplier,
    maxVolMultiplier: args.maxVolMultiplier,
    annualizationFactor: Math.sqrt(365),
    minRealizedVolFloor: 1e-4,
  };
  const volSizer = computeVolTargetedSizer(candles, args.baseNotional, volConfig);
  printVolTarget(volSizer);

  console.log(`\n[vol-targeted] PHASE 3 — Walk-forward validation (IS vol → OOS multiplier)`);
  const wf = runVolTargetWalkForwardValidation(
    candles, args.wfTrainDays, args.wfTestDays, args.wfStepDays, volConfig,
  );
  printWalkForward(wf);

  console.log(`\n[vol-targeted] PHASE 4 — Re-running Donchian ${args.timeframe} backtest with 1:10 + avgVolMultiplier (${(volSizer.avgVolMultiplier * 100).toFixed(2)}%) × baseKelly (${(args.baseKellyFraction * 100).toFixed(0)}%)`);
  const t1 = Date.now();
  const volBacktest = await runVolTargetedBacktest(
    args.symbol, args.timeframe, args.initialEquity, startTime, endTime, feed,
    volSizer.avgVolMultiplier, args.baseKellyFraction, args.baseNotional,
  );
  const elapsedVol = Date.now() - t1;

  printResults(`PHASE 4 — Vol-targeted 1:10 (avg ×${(volSizer.avgVolMultiplier * 100).toFixed(0)}%)`,
    args.symbol, args.timeframe, elapsedVol, totalMonths, volBacktest);

  printComparison(
    { result: baselineResult, totalMonths },
    { result: volBacktest, totalMonths },
    volSizer.avgVolMultiplier,
  );

  await writeOutput(args, {
    phase: "vol-targeted",
    args,
    totalMonths,
    monthlyReturn: monthlyReturn(volBacktest.totalReturn, totalMonths),
    baseline: { result: baselineResult, totalMonths },
    volTargeted: { result: volBacktest, totalMonths },
    volSizer,
    walkForward: wf,
    leverageMandate: {
      leverage: ONE_TO_TEN_BASE_LEVERAGE,
      interpretation: "1:10 = 10× notional on 1× capital (9× borrowed from bybit.eu SPOT margin)",
      userDirective: "HARD CONSTRAINT — NO other leverage values permitted",
      verifiedBy: "validateOneToTenLeverage() at CLI parse + maxVolMultiplier cap at 1.0 in sizer",
    },
  });
  console.log(`[vol-targeted] Saved: ${resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath)}`);
}

interface SummaryOutput {
  readonly phase: string;
  readonly args?: CliArgs;
  readonly totalMonths?: number;
  readonly monthlyReturn?: number;
  readonly baseline?: { readonly result: BacktestResult; readonly totalMonths: number };
  readonly baselineResult?: BacktestResult;
  readonly volTargeted?: { readonly result: BacktestResult; readonly totalMonths: number };
  readonly volSizer?: VolTargetedSizerResult;
  readonly walkForward?: VolTargetWalkForwardValidation;
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
  console.log(`[vol-targeted] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[vol-targeted] FATAL:", err);
  process.exit(1);
});
