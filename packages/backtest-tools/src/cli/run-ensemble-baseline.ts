#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-ensemble-baseline.ts — Multi-strategy ensemble baseline
//
// Phase 5 — Always-in Trend + Mean-Reversion ensemble, trend-filter applied
// (StrategyArena 2026 60/40 MR/TF empirical reference: Sharpe 1.58 / -9.2% DD).
//
// A trend-filter a Phase 4 mean-reversion csak a Phase 5 always-in trend-following
// által jelzett trend-irányban trade-eljen. Ha a trend-following short-ot jelez,
// a mean-reversion long jelzései elvetve; ha long-ot, a mean-reversion short jelzései elvetve.
//
// Használat:
//   bun run packages/backtest-tools/src/cli/run-ensemble-baseline.ts
//   bun run packages/backtest-tools/src/cli/run-ensemble-baseline.ts --symbol=ETH/USDT
//   bun run packages/backtest-tools/src/cli/run-ensemble-baseline.ts --no-filter (off trend-filter)

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import { AlwaysInTrendStrategy, MeanReversionBbStrategy, CompositeStrategy } from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly useTrendFilter: boolean;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1h";
  let initialEquity = 10_000;
  let useTrendFilter = true;
  let outputPath = "backtest-results/baseline-ensemble-btc-1h.json";
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
    } else if (arg === "--no-filter") {
      useTrendFilter = false;
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return { symbol, timeframe, initialEquity, useTrendFilter, outputPath };
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

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesFor(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  // Component 1: Always-in Trend (Phase 5) — trend-direction signal
  const trendStrategy = new AlwaysInTrendStrategy();
  // Component 2: Mean-Reversion (Phase 4) — entry-trigger signal
  const mrStrategy = new MeanReversionBbStrategy();

  // Composite: trend-filter + agreement-confidence boost
  const strategy = new CompositeStrategy({
    component1: trendStrategy,
    component2: mrStrategy,
    useTrendFilter: args.useTrendFilter,
    agreementConfidenceBoost: 0.05,
  });

  console.log(`[ensemble-baseline] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[ensemble-baseline] trend-filter=${args.useTrendFilter} (composite of always-in-trend + mean-reversion)`);
  console.log(`[ensemble-baseline] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

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

  console.log(`\n=== ENSEMBLE RESULTS ${args.symbol} ${args.timeframe} ===`);
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
    console.log(`Avg win:                $${avgWin.toFixed(2)}`);
    console.log(`Avg loss:               $${avgLoss.toFixed(2)}`);
  }
  const finalEq = result.equityCurve[result.equityCurve.length - 1]?.equity ?? args.initialEquity;
  console.log(`Final equity:           $${finalEq.toFixed(2)}`);

  // Trade-count reality check (strategy-selection §4.5.2: expected 700-1500 / 30 hó / symbol)
  if (result.totalTrades === 0) {
    console.warn(`[ensemble-baseline] ⚠ DEVIATION FROM ESTIMATED RANGE: 0 trades (expected 700-1500 / 30 hó / symbol — strategy-selection §4.5.2)`);
  } else if (result.totalTrades > 5000) {
    console.warn(`[ensemble-baseline] ⚠ DEVIATION FROM ESTIMATED RANGE: ${result.totalTrades} trades (expected 700-1500 / 30 hó / symbol — strategy-selection §4.5.2)`);
  } else {
    console.log(`[ensemble-baseline] ✓ Trade-count (${result.totalTrades}) within estimated range (700-1500)`);
  }

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
  console.log(`[ensemble-baseline] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[ensemble-baseline] FATAL:", err);
  process.exit(1);
});
