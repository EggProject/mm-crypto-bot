#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-kelly-opt.ts — Kelly-optimized
// position-sizing Donchian 1d edge baseline (Phase 6 Track C).
//
// Phase 6 Track C — A Phase 5 C Donchian 1d pozitív edge-ének Kelly-fraction
// optimalizálása. A pipeline két fázisban fut:
//
//   PHASE 1 — Baseline backtest 0.25× Kelly (Phase 5 default)
//             A trade-listából kinyerjük a win-rate / W-L ratio statisztikát.
//   PHASE 2 — Walk-forward Kelly fraction optimalizáció
//             6 hónap IS / 1 hónap OOS / 1 hó görgetéssel validáljuk,
//             hogy a Kelly fraction nem overfit-e.
//   PHASE 3 — Kelly-optimized backtest (0.25× / 0.5× / 1.0×)
//             A trade-list Kelly statisztikájából származtatott position-
//             sizinggal újrafuttatjuk a Donchian 1d backtestet, és az
//             eredményt összehasonlítjuk a Phase 5 baseline-nal.
//
// Használat:
//   bun run packages/backtest-tools/src/cli/run-kelly-opt.ts
//   bun run packages/backtest-tools/src/cli/run-kelly-opt.ts --symbol=BTC/USDT --timeframe=1d
//   bun run packages/backtest-tools/src/cli/run-kelly-opt.ts --kelly-fraction=0.5 --output=...json
//   bun run packages/backtest-tools/src/cli/run-kelly-opt.ts --baseline-only   # PHASE 1 only (smaller JSON)

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import {
  DonchianBreakoutStrategy,
  optimizeKelly,
  type KellyFraction,
  type KellyOptResult,

  type WalkForwardValidation,
} from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

// ----------------------------------------------------------------------
// Argument parsing
// ----------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly kellyFraction: KellyFraction;
  readonly baselineOnly: boolean;
  readonly wfTrainDays: number;
  readonly wfTestDays: number;
  readonly wfStepDays: number;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let kellyFraction: KellyFraction = 0.5;
  let baselineOnly = false;
  let wfTrainDays = 180;
  let wfTestDays = 30;
  let wfStepDays = 30;
  let outputPath = "";
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`Invalid timeframe: ${tf}`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--kelly-fraction=")) {
      const kf = Number(arg.slice("--kelly-fraction=".length));
      if (kf !== 0.25 && kf !== 0.5 && kf !== 1.0) {
        throw new Error(`--kelly-fraction must be 0.25 / 0.5 / 1.0: ${kf}`);
      }
      kellyFraction = kf;
    } else if (arg === "--baseline-only") {
      baselineOnly = true;
    } else if (arg.startsWith("--wf-train=")) {
      wfTrainDays = Number(arg.slice("--wf-train=".length));
    } else if (arg.startsWith("--wf-test=")) {
      wfTestDays = Number(arg.slice("--wf-test=".length));
    } else if (arg.startsWith("--wf-step=")) {
      wfStepDays = Number(arg.slice("--wf-step=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    // Default filename: baseline-kelly-opt-{symbol}-{timeframe}.json
    // For sensitivity analysis at other fractions, use --kelly-fraction to vary.
    outputPath = `backtest-results/baseline-kelly-opt-${symbolLower}-${timeframe}.json`;
  }
  return {
    symbol,
    timeframe,
    initialEquity,
    kellyFraction,
    baselineOnly,
    wfTrainDays,
    wfTestDays,
    wfStepDays,
    outputPath,
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

// ----------------------------------------------------------------------
// Phase 1 — baseline backtest (Phase 5 0.25× Kelly)
// ----------------------------------------------------------------------

async function runBaselineBacktest(
  symbol: string,
  timeframe: Timeframe,
  initialEquity: number,
  startTime: Date,
  endTime: Date,
  feed: ExchangeFeed,
): Promise<BacktestResult> {
  const tf = timeframesFor(timeframe);
  const strategy = new DonchianBreakoutStrategy();
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
      // Phase 5 baseline: riskPerTrade=0.01, kellyFraction=0.25, maxDrawdown=0.5
      // (maxDrawdown disabled for diagnostics — same as Phase 5).
      riskPerTrade: 0.01,
      kellyFraction: 0.25,
      maxDrawdown: 0.5,
      maxPositionPctEquity: 0.2,
      minPositionPctEquity: 0.01,
    },
    strategy,
  });
}

// ----------------------------------------------------------------------
// Phase 3 — Kelly-opt backtest
// ----------------------------------------------------------------------

async function runKellyOptBacktest(
  symbol: string,
  timeframe: Timeframe,
  initialEquity: number,
  startTime: Date,
  endTime: Date,
  feed: ExchangeFeed,
  recommendedRiskPerTrade: number,
  recommendedMaxPositionPctEquity: number,
): Promise<BacktestResult> {
  const tf = timeframesFor(timeframe);
  const strategy = new DonchianBreakoutStrategy();
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
      // The Kelly-opt recommendedRiskPerTrade scales the base 1% risk
      // by the capped Kelly fraction divided by an assumed ~10% stop
      // distance — so position = equity * riskPerTrade / 0.10 ≈ equity *
      // cappedKelly (the canonical Kelly "% of equity per trade"
      // interpretation).
      //
      // The `maxPositionPctEquity` is the canonical "% of equity per
      // trade" cap, which is the engine-side equivalent of the Kelly
      // fraction (the engine clamps notional to this cap).
      riskPerTrade: recommendedRiskPerTrade,
      kellyFraction: 1.0, // multiplier is already baked into cappedKelly
      maxDrawdown: 0.15, // 15% kill-switch (matches DEFAULT_KELLY_OPT_CONFIG)
      maxPositionPctEquity: recommendedMaxPositionPctEquity,
      minPositionPctEquity: 0.01,
    },
    strategy,
  });
}

// ----------------------------------------------------------------------
// Output helpers
// ----------------------------------------------------------------------

function monthlyReturn(totalReturn: number, totalMonths: number): number {
  if (totalReturn <= 0 || totalMonths <= 0) {
    return 0;
  }
  return Math.pow(1 + totalReturn, 1 / totalMonths) - 1;
}

function printHeader(label: string, args: CliArgs): void {
  console.log(`[kelly-opt] ${label}`);
  console.log(`[kelly-opt] symbol=${args.symbol} ltf=${args.timeframe}`);
  if (!args.baselineOnly) {
    console.log(`[kelly-opt] kelly-fraction=${args.kellyFraction} (default 0.5 = half-Kelly)`);
    console.log(
      `[kelly-opt] walk-forward: train=${args.wfTrainDays}d test=${args.wfTestDays}d step=${args.wfStepDays}d`,
    );
  }
}

function printResults(label: string, symbol: string, timeframe: string, elapsedMs: number, totalMonths: number, result: BacktestResult): void {
  const wins = result.trades.filter((t) => t.pnlUsd > 0);
  const losses = result.trades.filter((t) => t.pnlUsd < 0);
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
  if (result.trades.length > 0) {
    const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnlUsd, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + Math.abs(t.pnlUsd), 0) / losses.length : 0;
    console.log(`Avg win:                $${avgWin.toFixed(2)}`);
    console.log(`Avg loss:               $${avgLoss.toFixed(2)}`);
  }
  const finalEq = result.equityCurve[result.equityCurve.length - 1]?.equity ?? 0;
  console.log(`Final equity:           $${finalEq.toFixed(2)}`);
}

function printKellyOpt(kellyOpt: KellyOptResult): void {
  console.log(`\n=== KELLY OPTIMIZATION ===`);
  console.log(`Overall stats:`);
  console.log(`  Trades:          ${kellyOpt.overallStats.total} (wins=${kellyOpt.overallStats.wins}, losses=${kellyOpt.overallStats.losses})`);
  console.log(`  Win rate:        ${(kellyOpt.overallStats.winRate * 100).toFixed(2)}%`);
  console.log(`  Avg win:         $${kellyOpt.overallStats.avgWinUsd.toFixed(2)}`);
  console.log(`  Avg loss:        $${kellyOpt.overallStats.avgLossUsd.toFixed(2)}`);
  console.log(`  W-L ratio:       ${kellyOpt.overallStats.winLossRatio.toFixed(3)}`);
  console.log(`  Profit factor:   ${kellyOpt.overallStats.profitFactor.toFixed(3)}`);
  console.log(`Kelly fractions:`);
  console.log(`  Full Kelly:      ${(kellyOpt.fullKellyFraction * 100).toFixed(2)}%`);
  console.log(`  Fractional (${kellyOpt.config.kellyMultiplier}×): ${(kellyOpt.fractionalKellyFraction * 100).toFixed(2)}%`);
  console.log(`  Capped:          ${(kellyOpt.cappedKellyFraction * 100).toFixed(2)}% (cap=${kellyOpt.config.maxPositionPctEquity})`);
  console.log(`  → effective risk/trade: ${(kellyOpt.recommendedRiskPerTrade * 100).toFixed(4)}%`);
  console.log(`Walk-forward (OOS validation):`);
  console.log(`  Windows:         ${kellyOpt.walkForward.windows.length}`);
  console.log(`  Avg train Kelly: ${(kellyOpt.walkForward.avgTrainKellyFraction * 100).toFixed(2)}%`);
  console.log(`  Positive-test-Kelly fraction: ${(kellyOpt.walkForward.positiveTestKellyFraction * 100).toFixed(1)}%`);
  console.log(`  Avg train Sharpe: ${kellyOpt.walkForward.avgTrainSharpe.toFixed(3)}`);
  console.log(`  Avg test Sharpe:  ${kellyOpt.walkForward.avgTestSharpe.toFixed(3)}`);
  console.log(`  OOS/IS ratio:     ${kellyOpt.walkForward.oosIsReturnRatio.toFixed(3)}`);
  console.log(`  Overfit risk:     ${kellyOpt.walkForward.overfitRisk}`);
}

function printComparison(
  baseline: { result: BacktestResult; totalMonths: number },
  kellyOptResult: { result: BacktestResult; totalMonths: number },
): void {
  const baseM = monthlyReturn(baseline.result.totalReturn, baseline.totalMonths);
  const optM = monthlyReturn(kellyOptResult.result.totalReturn, kellyOptResult.totalMonths);
  console.log(`\n=== COMPARISON ===`);
  console.log(`Metric                Phase 5 baseline    Kelly-opt (${kellyOptResult.result.sharpeRatio.toFixed(2)} Sharpe)`);
  console.log(`  Total return        ${(baseline.result.totalReturn * 100).toFixed(2)}%             ${(kellyOptResult.result.totalReturn * 100).toFixed(2)}%`);
  console.log(`  Monthly avg         ${(baseM * 100).toFixed(2)}%/mo          ${(optM * 100).toFixed(2)}%/mo`);
  console.log(`  Sharpe              ${baseline.result.sharpeRatio.toFixed(3)}            ${kellyOptResult.result.sharpeRatio.toFixed(3)}`);
  console.log(`  Max DD              ${(baseline.result.maxDrawdown * 100).toFixed(2)}%            ${(kellyOptResult.result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`  Win rate            ${(baseline.result.winRate * 100).toFixed(2)}%            ${(kellyOptResult.result.winRate * 100).toFixed(2)}%`);
  console.log(`  Trades              ${baseline.result.totalTrades}              ${kellyOptResult.result.totalTrades}`);
  if (optM > baseM) {
    console.log(`  ✓ Kelly-opt IMPROVES monthly avg by ${((optM / baseM - 1) * 100).toFixed(0)}%`);
  } else if (optM > 0 && baseM > 0) {
    console.log(`  ~ Kelly-opt monthly avg = ${(optM * 100).toFixed(2)}%/mo (vs Phase 5 ${(baseM * 100).toFixed(2)}%/mo)`);
  } else {
    console.log(`  ✗ Kelly-opt does NOT improve monthly avg (Phase 5 = ${(baseM * 100).toFixed(2)}%/mo)`);
  }
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  printHeader("Phase 6 Track C — Kelly-opt position sizing Donchian 1d edge", args);
  console.log(`[kelly-opt] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

  // -------------------- PHASE 1 — baseline backtest --------------------
  const t0 = Date.now();
  const baselineResult = await runBaselineBacktest(args.symbol, args.timeframe, args.initialEquity, startTime, endTime, feed);
  const elapsedBaseline = Date.now() - t0;
  const totalMonths =
    (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24) / 30.44;

  printResults("PHASE 1 — Phase 5 baseline (0.25× Kelly)", args.symbol, args.timeframe, elapsedBaseline, totalMonths, baselineResult);

  if (args.baselineOnly) {
    await writeOutput(args, { phase: "baseline", baselineResult, baselineTotalMonths: totalMonths, args });
    return;
  }

  // -------------------- PHASE 2 — walk-forward Kelly + stats --------------------
  const trades = baselineResult.trades;
  console.log(`\n[kelly-opt] PHASE 2 — Walk-forward validation on ${trades.length} trades from baseline`);
  if (trades.length === 0) {
    throw new Error(
      `Phase 1 baseline produced 0 trades — cannot run Kelly-opt on empty stream. ` +
        `This combination (${args.symbol} ${args.timeframe}) doesn't have an edge.`,
    );
  }

  const kellyOpt: KellyOptResult = optimizeKelly(trades, args.wfTrainDays, args.wfTestDays, args.wfStepDays, {
    maxPositionPctEquity: 0.2,
    maxDrawdown: 0.15,
    kellyMultiplier: args.kellyFraction,
    minWinLossRatio: 0.5,
  });
  printKellyOpt(kellyOpt);

  // -------------------- PHASE 3 — Kelly-opt backtest --------------------
  console.log(`\n[kelly-opt] PHASE 3 — Re-running Donchian ${args.timeframe} backtest with recommended risk/trade`);
  const t1 = Date.now();
  const kellyOptBacktest = await runKellyOptBacktest(
    args.symbol,
    args.timeframe,
    args.initialEquity,
    startTime,
    endTime,
    feed,
    kellyOpt.recommendedRiskPerTrade,
    kellyOpt.recommendedMaxPositionPctEquity,
  );
  const elapsedKellyOpt = Date.now() - t1;

  printResults(
    `PHASE 3 — Kelly-opt (${args.kellyFraction}× Kelly, capped)`,
    args.symbol,
    args.timeframe,
    elapsedKellyOpt,
    totalMonths,
    kellyOptBacktest,
  );

  printComparison(
    { result: baselineResult, totalMonths },
    { result: kellyOptBacktest, totalMonths },
  );

  await writeOutput(args, {
    phase: "kelly-opt",
    args,
    totalMonths,
    monthlyReturn: monthlyReturn(kellyOptBacktest.totalReturn, totalMonths),
    baseline: { result: baselineResult, totalMonths: baselineResult.totalReturn === 0 ? 0 : totalMonths },
    kellyOpt: { result: kellyOptBacktest, totalMonths },
    kellyOptStats: kellyOpt,
  });
  console.log(`[kelly-opt] Saved: ${resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath)}`);
}

// ----------------------------------------------------------------------
// JSON output
// ----------------------------------------------------------------------

interface SummaryOutput {
  readonly phase: string;
  readonly args?: CliArgs;
  readonly totalMonths?: number;
  readonly monthlyReturn?: number;
  readonly baseline?: { readonly result: BacktestResult; readonly totalMonths: number };
  readonly baselineResult?: BacktestResult;
  readonly baselineTotalMonths?: number;
  readonly kellyOpt?: { readonly result: BacktestResult; readonly totalMonths: number };
  readonly kellyOptStats?: KellyOptResult;
  readonly walkForward?: WalkForwardValidation;
}

async function writeOutput(args: CliArgs, output: SummaryOutput): Promise<void> {
  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(absOutput, JSON.stringify(output, null, 2), "utf8");
  console.log(`[kelly-opt] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[kelly-opt] FATAL:", err);
  process.exit(1);
});
