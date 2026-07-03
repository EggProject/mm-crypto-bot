#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-alwaysin-baseline.ts — Always-in Trend baseline
//
// Phase 5 — Always-in Trend-Following stratégia baseline backtest.
// Az engine-bug fix a Phase 4 PR #10 merge után a main-en van (a236069).
// A baseline a Phase 1-3 OHLCV adatokon fut (BTC/ETH/SOL × 1h/4h/1d, 2024-01 → 2026-07).
//
// Használat:
//   bun run packages/backtest-tools/src/cli/run-alwaysin-baseline.ts
//   bun run packages/backtest-tools/src/cli/run-alwaysin-baseline.ts --symbol=ETH/USDT --timeframe=4h
//   bun run packages/backtest-tools/src/cli/run-alwaysin-baseline.ts --stop=2.0 --tp=15.0

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import { AlwaysInTrendStrategy, DEFAULT_ALWAYSIN_CONFIG } from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly stopAtrMultiplier: number;
  readonly tpAtrMultiplier: number;
  readonly minEmaGapPct: number;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1h";
  let initialEquity = 10_000;
  let stopAtrMultiplier = DEFAULT_ALWAYSIN_CONFIG.stopAtrMultiplier;
  let tpAtrMultiplier = DEFAULT_ALWAYSIN_CONFIG.tpAtrMultiplier;
  let minEmaGapPct = DEFAULT_ALWAYSIN_CONFIG.minEmaGapPct;
  let outputPath = "backtest-results/baseline-alwaysin-btc-1h.json";
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
    } else if (arg.startsWith("--stop=")) {
      stopAtrMultiplier = Number(arg.slice("--stop=".length));
    } else if (arg.startsWith("--tp=")) {
      tpAtrMultiplier = Number(arg.slice("--tp=".length));
    } else if (arg.startsWith("--min-gap=")) {
      minEmaGapPct = Number(arg.slice("--min-gap=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return { symbol, timeframe, initialEquity, stopAtrMultiplier, tpAtrMultiplier, minEmaGapPct, outputPath };
}

function timeframesFor(ltf: Timeframe): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
  if (ltf === "1h") return { htf: "1d", mtf: "4h", ltf: "1h" };
  if (ltf === "4h") return { htf: "1d", mtf: "4h", ltf: "4h" };
  if (ltf === "1d") return { htf: "1d", mtf: "4h", ltf: "1d" };
  throw new Error(`Unsupported ltf: ${ltf}`);
}

// bybit.eu SPOT 1:10 cost-model (azonos a Phase 1-3 / Phase 4 baseline-okkal)
const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesFor(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  const strategy = new AlwaysInTrendStrategy({
    stopAtrMultiplier: args.stopAtrMultiplier,
    tpAtrMultiplier: args.tpAtrMultiplier,
    minEmaGapPct: args.minEmaGapPct,
  });

  console.log(`[alwaysin-baseline] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[alwaysin-baseline] stop=${args.stopAtrMultiplier}×ATR, tp=${args.tpAtrMultiplier}×ATR, minEmaGap=${args.minEmaGapPct}`);
  console.log(`[alwaysin-baseline] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

  const t0 = Date.now();
  const result: BacktestResult = await runBacktest({
    symbol: makeSymbol(args.symbol),
    htfTimeframe: tf.htf,
    mtfTimeframe: tf.mtf,
    ltfTimeframe: tf.ltf,
    startTime,
    endTime,
    initialEquityUsd: args.initialEquity,
    feed,
    costModel: COST_MODEL,
    positionSize: {
      riskPerTrade: 0.01,
      kellyFraction: 0.25,
      maxDrawdown: 0.5,
      maxPositionPctEquity: 0.2,
      minPositionPctEquity: 0.01,
    },
    strategy,
  });
  const elapsedMs = Date.now() - t0;

  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn =
    result.totalReturn > 0 && totalMonths > 0 ? Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1 : 0;
  const wins = result.trades.filter((t) => t.pnlUsd > 0);
  const losses = result.trades.filter((t) => t.pnlUsd < 0);
  const winRate = result.trades.length > 0 ? wins.length / result.trades.length : 0;

  console.log(`\n=== ALWAYS-IN TREND RESULTS ${args.symbol} ${args.timeframe} ===`);
  console.log(`Elapsed:                ${elapsedMs}ms`);
  console.log(`Total return:           ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:            ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
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
    const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.pnlUsd, 0) / losses.length : 0;
    const bestTrade = Math.max(...result.trades.map((t) => t.pnlUsd));
    const worstTrade = Math.min(...result.trades.map((t) => t.pnlUsd));
    console.log(`Avg win:                $${avgWin.toFixed(2)}`);
    console.log(`Avg loss:               $${avgLoss.toFixed(2)}`);
    console.log(`Best trade:             $${bestTrade.toFixed(2)}`);
    console.log(`Worst trade:            $${worstTrade.toFixed(2)}`);
  }
  const finalEq = result.equityCurve[result.equityCurve.length - 1]?.equity ?? args.initialEquity;
  console.log(`Final equity:           $${finalEq.toFixed(2)}`);

  // JSON output
  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(
    absOutput,
    JSON.stringify(
      {
        args,
        totalMonths,
        monthlyReturn,
        result,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[alwaysin-baseline] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[alwaysin-baseline] FATAL:", err);
  process.exit(1);
});
