#!/usr/bin/env bun
// scripts/run-baseline.ts — Baseline MTF-TKC backtest futtatása a Binance adatokon.
//
// Ez a script az ÜGYNÖK #6 Phase 2 első lépése: a meglévő backtest
// motort és a MTF-Trend-Konfluencia stratégiát futtatja a letöltött
// Binance OHLCV adatokon, és kiírja az eredményeket.
//
// Használat:
//   bun scripts/run-baseline.ts
//   bun scripts/run-baseline.ts --symbol=ETH/USDT
//   bun scripts/run-baseline.ts --symbol=BTC/USDT --timeframe=4h

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import { MtfTrendConfluenceStrategy } from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1h";
  let initialEquity = 10_000;
  let outputPath = "backtest-results/baseline.json";
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
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return { symbol, timeframe, initialEquity, outputPath };
}

// Map LTF to MTF and HTF: defaults chosen per the MTF-TKC spec.
function timeframesFor(ltf: Timeframe): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
  if (ltf === "1h") return { htf: "1d", mtf: "4h", ltf: "1h" };
  if (ltf === "4h") return { htf: "1d", mtf: "4h", ltf: "4h" };
  if (ltf === "1d") return { htf: "1d", mtf: "4h", ltf: "1d" };
  throw new Error(`Unsupported ltf: ${ltf}`);
}

// bybit.eu SPOT 1:10 leverage cost model (from selected-strategy.md §9).
const COST_MODEL: CostModel = {
  takerFeeRate: 0.001, // 0.1% / side
  slippageRate: 0.0005, // 0.05% / side
  spreadRate: 0.0002, // 2 bps / side
  borrowRatePerHour: 0.0001, // 0.01%/h = 7.2%/hó
  fundingRatePer8h: 0, // SPOT only — no funding
};

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesFor(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;
  const strategy = new MtfTrendConfluenceStrategy();

  // 2024-01-01 → today
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[baseline] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[baseline] timeframes: htf=${tf.htf} mtf=${tf.mtf} ltf=${tf.ltf}`);
  console.log(`[baseline] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);
  console.log(`[baseline] initial equity: $${args.initialEquity}`);

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
      maxDrawdown: 0.5, // Disable kill-switch for diagnostic run; we want to see full curve
      maxPositionPctEquity: 0.2,
      minPositionPctEquity: 0.01,
    },
    strategy,
  });

  // Report
  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn = result.totalReturn > 0 ? (Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1) : 0;
  const wins = result.trades.filter((t) => t.pnlUsd > 0);
  const losses = result.trades.filter((t) => t.pnlUsd < 0);
  const winRate = result.trades.length > 0 ? wins.length / result.trades.length : 0;

  console.log(`\n=== RESULTS ${args.symbol} ${args.timeframe} ===`);
  console.log(`Total return:     ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:      ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:       ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:           ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Sortino:          ${result.sortinoRatio.toFixed(3)}`);
  console.log(`Max DD:           ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Profit factor:    ${result.profitFactor.toFixed(3)}`);
  console.log(`Win rate:         ${(winRate * 100).toFixed(2)}%`);
  console.log(`Trades:           ${result.totalTrades}`);
  console.log(`Kill-switch:      ${result.killSwitchTriggered ? "yes" : "no"}`);
  console.log(`First equity:     $${result.equityCurve[0]?.equity.toFixed(2) ?? "?"}`);
  console.log(`Last equity:      $${result.equityCurve[result.equityCurve.length - 1]?.equity.toFixed(2) ?? "?"}`);

  if (result.trades.length > 0) {
    const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnlUsd, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.pnlUsd, 0) / losses.length : 0;
    const bestTrade = Math.max(...result.trades.map((t) => t.pnlUsd));
    const worstTrade = Math.min(...result.trades.map((t) => t.pnlUsd));
    console.log(`Avg win:          $${avgWin.toFixed(2)}`);
    console.log(`Avg loss:         $${avgLoss.toFixed(2)}`);
    console.log(`Best trade:       $${bestTrade.toFixed(2)}`);
    console.log(`Worst trade:      $${worstTrade.toFixed(2)}`);
  }

  // Write JSON
  const fs = await import("node:fs/promises");
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(
    resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath),
    JSON.stringify(
      {
        args,
        monthlyReturn,
        totalMonths,
        result,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n[baseline] Saved: ${args.outputPath}`);
}

main().catch((err: unknown) => {
  console.error("[baseline] FATAL:", err);
  process.exit(1);
});