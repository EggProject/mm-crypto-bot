#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-kelly-adaptive.ts — Phase 7 Track B
// Adaptive Kelly with rolling Sharpe CLI runner.
//
// Mimics the Phase 6 Track C `run-kelly-opt.ts` pattern but emits an
// ADAPTIVE Kelly backtest: rolling 30-day realized Sharpe drives the
// per-trade Kelly multiplier (1.0× / 0.7× / 0.5× / 0.25× buckets).
//
// The CLI runs:
//   PHASE 1 — Baseline backtest (0.25× Kelly, same as Phase 5)
//             produces the trade-list.
//   PHASE 2 — Adaptive Kelly computation on the trade-list.
//             - aggregates to daily P&L
//             - computes rolling 30-day Sharpe
//             - maps Sharpe → bucket → multiplier
//             - bucket distribution + time-in-bucket metrics
//   PHASE 3 — Walk-forward OOS validation (180d IS / 30d OOS / 30d step)
//             using the IN-SAMPLE rolling-Sharpe bucket to size the OOS slice.
//   PHASE 4 — Adaptive-Kelly backtest with the recommended position cap.
//             Re-runs the Donchian backtest with the effective Kelly
//             multiplier from PHASE 2, and compares to the static 0.5× Kelly
//             reference.
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-kelly-adaptive.ts
//   bun run packages/backtest-tools/src/cli/run-kelly-adaptive.ts --symbol=BTC/USDT --timeframe=1d
//   bun run packages/backtest-tools/src/cli/run-kelly-adaptive.ts --rolling-window-days=30 --output=...
//   bun run packages/backtest-tools/src/cli/run-kelly-adaptive.ts --baseline-only   # PHASE 1 only

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";
import {
  compareAdaptiveVsStaticKelly,
  runAdaptiveWalkForwardValidation,
  type AdaptiveKellyResult,
  type AdaptiveWalkForwardValidation,
} from "@mm-crypto-bot/core";
import { DonchianBreakoutStrategy } from "@mm-crypto-bot/core";

// ----------------------------------------------------------------------
// Argument parsing
// ----------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly rollingWindowDays: number;
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
  let rollingWindowDays = 30;
  let wfTrainDays = 180;
  let wfTestDays = 30;
  let wfStepDays = 30;
  let baselineOnly = false;
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
    } else if (arg.startsWith("--rolling-window-days=")) {
      rollingWindowDays = Number(arg.slice("--rolling-window-days=".length));
      if (!Number.isInteger(rollingWindowDays) || rollingWindowDays <= 0) {
        throw new Error(`--rolling-window-days must be a positive integer: ${rollingWindowDays}`);
      }
    } else if (arg.startsWith("--wf-train=")) {
      wfTrainDays = Number(arg.slice("--wf-train=".length));
    } else if (arg.startsWith("--wf-test=")) {
      wfTestDays = Number(arg.slice("--wf-test=".length));
    } else if (arg.startsWith("--wf-step=")) {
      wfStepDays = Number(arg.slice("--wf-step=".length));
    } else if (arg === "--baseline-only") {
      baselineOnly = true;
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-kelly-adaptive-${symbolLower}-${timeframe}.json`;
  }
  return {
    symbol,
    timeframe,
    initialEquity,
    rollingWindowDays,
    wfTrainDays,
    wfTestDays,
    wfStepDays,
    baselineOnly,
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
// Phase 1 — baseline backtest (Phase 5 / Phase 6 default 0.25× Kelly)
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
// Phase 4 — adaptive-Kelly backtest (effective Kelly from PHASE 2)
// ----------------------------------------------------------------------

async function runAdaptiveKellyBacktest(
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
      // Same engine-level interpretation as Phase 6 Track C — riskPerTrade
      // scales the base 1% risk by the effective capped Kelly fraction,
      // divided by the assumed ~10% stop distance. The
      // maxPositionPctEquity is the canonical "% of equity per trade" cap
      // (= effective capped Kelly fraction).
      riskPerTrade: recommendedRiskPerTrade,
      kellyFraction: 1.0, // multiplier already baked into cappedKelly
      maxDrawdown: 0.15,
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
  console.log(`[kelly-adaptive] ${label}`);
  console.log(`[kelly-adaptive] symbol=${args.symbol} ltf=${args.timeframe}`);
  if (!args.baselineOnly) {
    console.log(`[kelly-adaptive] rolling-window-days=${args.rollingWindowDays} (default 30)`);
    console.log(
      `[kelly-adaptive] walk-forward: train=${args.wfTrainDays}d test=${args.wfTestDays}d step=${args.wfStepDays}d`,
    );
  }
}

function printResults(
  label: string,
  symbol: string,
  timeframe: string,
  elapsedMs: number,
  totalMonths: number,
  result: BacktestResult,
): void {
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

function printAdaptiveKelly(adaptiveKelly: AdaptiveKellyResult): void {
  console.log(`\n=== ADAPTIVE KELLY OPTIMIZATION ===`);
  console.log(`Overall stats:`);
  console.log(
    `  Trades:          ${adaptiveKelly.overallStats.total} (wins=${adaptiveKelly.overallStats.wins}, losses=${adaptiveKelly.overallStats.losses})`,
  );
  console.log(`  Win rate:        ${(adaptiveKelly.overallStats.winRate * 100).toFixed(2)}%`);
  console.log(`  Avg win:         $${adaptiveKelly.overallStats.avgWinUsd.toFixed(2)}`);
  console.log(`  Avg loss:        $${adaptiveKelly.overallStats.avgLossUsd.toFixed(2)}`);
  console.log(`  W-L ratio:       ${adaptiveKelly.overallStats.winLossRatio.toFixed(3)}`);
  console.log(`  Profit factor:   ${adaptiveKelly.overallStats.profitFactor.toFixed(3)}`);
  console.log(`Kelly fractions:`);
  console.log(`  Full Kelly:      ${(adaptiveKelly.fullKellyFraction * 100).toFixed(2)}%`);
  console.log(`  Capped base:     ${(adaptiveKelly.cappedBaseKellyFraction * 100).toFixed(2)}%`);
  console.log(
    `  Raw avg multiplier:  ${(adaptiveKelly.rawAverageKellyMultiplier * 100).toFixed(2)}% (continuous, diagnostic)`,
  );
  console.log(
    `  Effective multiplier: ${(adaptiveKelly.effectiveKellyMultiplier * 100).toFixed(0)}% (rounded bucket — what the engine uses)`,
  );
  console.log(
    `  Effective Kelly: ${(adaptiveKelly.effectiveCappedKellyFraction * 100).toFixed(4)}% (capped × avg multiplier)`,
  );
  console.log(
    `  → effective risk/trade: ${(adaptiveKelly.recommendedRiskPerTrade * 100).toFixed(4)}%`,
  );
  console.log(`All-loss streak:        ${adaptiveKelly.hadAllLossStreak ? "yes (hard-floor 0.25×)" : "no"}`);
  console.log(`Bucket distribution (% time at each multiplier):`);
  console.log(
    `  1.0× (Sharpe > 1.0):   ${(adaptiveKelly.bucketDistribution.fullKellyFraction * 100).toFixed(1)}%`,
  );
  console.log(
    `  0.7× (0.5-1.0):        ${(adaptiveKelly.bucketDistribution.threeQuarterFraction * 100).toFixed(1)}%`,
  );
  console.log(
    `  0.5× (0.0-0.5):        ${(adaptiveKelly.bucketDistribution.halfKellyFraction * 100).toFixed(1)}%`,
  );
  console.log(
    `  0.25× (Sharpe < 0):    ${(adaptiveKelly.bucketDistribution.quarterKellyFraction * 100).toFixed(1)}%`,
  );
  console.log(
    `  insufficient (<${adaptiveKelly.rollingWindowDays}d):    ${(adaptiveKelly.bucketDistribution.insufficientFraction * 100).toFixed(1)}%`,
  );
}

function printAdaptiveWalkForward(wf: AdaptiveWalkForwardValidation): void {
  console.log(`\n=== WALK-FORWARD (OOS) VALIDATION ===`);
  console.log(`Windows:                ${wf.windows.length}`);
  console.log(`  Total OOS trades:     ${wf.totalTestTrades}`);
  console.log(`  Avg train Sharpe:     ${wf.avgTrainSharpe.toFixed(3)}`);
  console.log(`  Avg test Sharpe:      ${wf.avgTestSharpe.toFixed(3)} (avg of per-window Sharpes)`);
  console.log(
    `  Aggregate test Sharpe: ${wf.aggregateTestSharpe.toFixed(3)} (union of all test trades — robust to small-sample noise)`,
  );
  console.log(`  Aggregate test return: ${(wf.aggregateTestReturn * 100).toFixed(4)}%`);
  console.log(
    `  Aggregate test Calmar: ${wf.aggregateTestCalmar.toFixed(3)} (return / max DD — robust to <30-trade regimes)`,
  );
  console.log(`  OOS/IS Sharpe ratio:  ${wf.oosIsSharpeRatio.toFixed(3)}`);
  console.log(`  Avg test multiplier:  ${(wf.avgTestMultiplier * 100).toFixed(2)}%`);
  console.log(`  Avg test return:      ${(wf.avgTestReturn * 100).toFixed(4)}%`);
  console.log(
    `  Positive test Sharpe: ${(wf.positiveTestSharpeFraction * 100).toFixed(1)}% of windows`,
  );
  console.log(`  Overfit risk:         ${wf.overfitRisk}`);
  if (wf.totalTestTrades < 30) {
    console.log(
      `  NOTE: <30 OOS trades → avg-of-windows Sharpe is dominated by single-trade outliers; aggregate is the trustworthy signal`,
    );
  }
}

function printComparison(
  baseline: { result: BacktestResult; totalMonths: number },
  adaptiveResult: { result: BacktestResult; totalMonths: number },
  staticKellyFraction: number,
  adaptiveKellyFraction: number,
  avgMultiplier: number,
): void {
  const baseM = monthlyReturn(baseline.result.totalReturn, baseline.totalMonths);
  const optM = monthlyReturn(adaptiveResult.result.totalReturn, adaptiveResult.totalMonths);
  console.log(`\n=== COMPARISON ===`);
  console.log(
    `Metric                Phase 5 baseline (0.25×)   Adaptive-Kelly (avg ${(avgMultiplier * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Capped Kelly frac    ${(staticKellyFraction * 100).toFixed(2)}%              ${(adaptiveKellyFraction * 100).toFixed(2)}%`,
  );
  console.log(
    `  Total return        ${(baseline.result.totalReturn * 100).toFixed(2)}%                  ${(adaptiveResult.result.totalReturn * 100).toFixed(2)}%`,
  );
  console.log(
    `  Monthly avg         ${(baseM * 100).toFixed(2)}%/mo                ${(optM * 100).toFixed(2)}%/mo`,
  );
  console.log(
    `  Sharpe              ${baseline.result.sharpeRatio.toFixed(3)}                    ${adaptiveResult.result.sharpeRatio.toFixed(3)}`,
  );
  console.log(
    `  Max DD              ${(baseline.result.maxDrawdown * 100).toFixed(2)}%                   ${(adaptiveResult.result.maxDrawdown * 100).toFixed(2)}%`,
  );
  console.log(
    `  Win rate            ${(baseline.result.winRate * 100).toFixed(2)}%                   ${(adaptiveResult.result.winRate * 100).toFixed(2)}%`,
  );
  console.log(
    `  Trades              ${baseline.result.totalTrades}                     ${adaptiveResult.result.totalTrades}`,
  );
  if (optM > baseM) {
    console.log(`  ✓ Adaptive Kelly IMPROVES monthly avg by ${((optM / baseM - 1) * 100).toFixed(0)}%`);
  } else if (optM > 0 && baseM > 0) {
    console.log(`  ~ Adaptive Kelly monthly avg = ${(optM * 100).toFixed(2)}%/mo (vs Phase 5 ${(baseM * 100).toFixed(2)}%/mo)`);
  } else {
    console.log(`  ✗ Adaptive Kelly does NOT improve monthly avg (Phase 5 = ${(baseM * 100).toFixed(2)}%/mo)`);
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

  printHeader("Phase 7 Track B — Adaptive Kelly with rolling Sharpe", args);
  console.log(`[kelly-adaptive] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

  // -------------------- PHASE 1 — baseline backtest --------------------
  const t0 = Date.now();
  const baselineResult = await runBaselineBacktest(
    args.symbol,
    args.timeframe,
    args.initialEquity,
    startTime,
    endTime,
    feed,
  );
  const elapsedBaseline = Date.now() - t0;
  const totalMonths =
    (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24) / 30.44;

  printResults(
    "PHASE 1 — Phase 5/6 baseline (0.25× Kelly)",
    args.symbol,
    args.timeframe,
    elapsedBaseline,
    totalMonths,
    baselineResult,
  );

  if (args.baselineOnly) {
    await writeOutput(args, {
      phase: "baseline",
      args,
      totalMonths,
      baselineResult,
    });
    return;
  }

  // -------------------- PHASE 2 — adaptive Kelly computation --------------------
  const trades = baselineResult.trades;
  console.log(`\n[kelly-adaptive] PHASE 2 — Adaptive Kelly computation on ${trades.length} trades from baseline`);
  if (trades.length === 0) {
    throw new Error(
      `Phase 1 baseline produced 0 trades — cannot run adaptive Kelly on empty stream. ` +
        `This combination (${args.symbol} ${args.timeframe}) doesn't have an edge.`,
    );
  }

  const comparison = compareAdaptiveVsStaticKelly(
    trades,
    args.rollingWindowDays,
    args.initialEquity,
  );
  const adaptiveKelly = comparison.adaptiveKelly;
  printAdaptiveKelly(adaptiveKelly);

  // -------------------- PHASE 3 — walk-forward OOS --------------------
  console.log(`\n[kelly-adaptive] PHASE 3 — Walk-forward validation (IS Sharpe → OOS bucket)`);
  const wf = runAdaptiveWalkForwardValidation(
    trades,
    args.wfTrainDays,
    args.wfTestDays,
    args.wfStepDays,
    args.rollingWindowDays,
    args.initialEquity,
  );
  printAdaptiveWalkForward(wf);

  // -------------------- PHASE 4 — adaptive-Kelly backtest --------------------
  console.log(`\n[kelly-adaptive] PHASE 4 — Re-running Donchian ${args.timeframe} backtest with adaptive Kelly sizing`);
  const t1 = Date.now();
  const adaptiveBacktest = await runAdaptiveKellyBacktest(
    args.symbol,
    args.timeframe,
    args.initialEquity,
    startTime,
    endTime,
    feed,
    adaptiveKelly.recommendedRiskPerTrade,
    adaptiveKelly.recommendedMaxPositionPctEquity,
  );
  const elapsedAdaptive = Date.now() - t1;

  printResults(
    `PHASE 4 — Adaptive Kelly (raw avg ${(adaptiveKelly.rawAverageKellyMultiplier * 100).toFixed(0)}%, effective ${(adaptiveKelly.effectiveKellyMultiplier * 100).toFixed(0)}% ×, capped)`,
    args.symbol,
    args.timeframe,
    elapsedAdaptive,
    totalMonths,
    adaptiveBacktest,
  );

  printComparison(
    { result: baselineResult, totalMonths },
    { result: adaptiveBacktest, totalMonths },
    comparison.staticTotalFraction,
    adaptiveKelly.effectiveCappedKellyFraction,
    adaptiveKelly.rawAverageKellyMultiplier,
  );

  await writeOutput(args, {
    phase: "kelly-adaptive",
    args,
    totalMonths,
    monthlyReturn: monthlyReturn(adaptiveBacktest.totalReturn, totalMonths),
    baseline: { result: baselineResult, totalMonths },
    adaptive: { result: adaptiveBacktest, totalMonths },
    comparison,
    walkForward: wf,
  });
  console.log(`[kelly-adaptive] Saved: ${resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath)}`);
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
  readonly adaptive?: { readonly result: BacktestResult; readonly totalMonths: number };
  readonly comparison?: ReturnType<typeof compareAdaptiveVsStaticKelly>;
  readonly walkForward?: AdaptiveWalkForwardValidation;
}

async function writeOutput(args: CliArgs, output: SummaryOutput): Promise<void> {
  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), {
    recursive: true,
  });
  await fs.writeFile(absOutput, JSON.stringify(output, null, 2), "utf8");
  console.log(`[kelly-adaptive] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[kelly-adaptive] FATAL:", err);
  process.exit(1);
});