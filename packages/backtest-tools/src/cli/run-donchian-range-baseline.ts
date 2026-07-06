#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-donchian-range-baseline.ts — Donchian Range Channel baseline
//
// Phase 15 Track D — Donchian Range Channel strategy baseline backtest (M15).
// Pure range strategy: long when close ≤ DonchianLower(20), short when close ≥
// DonchianUpper(20). Skips trades when ADX > 25 (trending regime). Strategy
// class lives in `@mm-crypto-bot/core` and is implemented by Track C.
//
// Használat:
//   bun run packages/backtest-tools/src/cli/run-donchian-range-baseline.ts --symbol=BTC/USDT --timeframe=15m --output=backtest-results/phase15-donchian-range-btc-15m.json

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import { DonchianRangeChannelStrategy, DEFAULT_DONCHIAN_RANGE_CONFIG } from "@mm-crypto-bot/core";
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
  let timeframe: Timeframe = "15m";
  let initialEquity = 10_000;
  let outputPath = "backtest-results/phase15-donchian-range-btc-15m.json";
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      // Phase 15 — Donchian Range runs on M15.
      if (tf !== "15m") {
        throw new Error(`Donchian Range baseline requires 15m timeframe, got: ${tf}`);
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

// Donchian Range Channel timeline — HTF=1d (trending regime filter), MTF=4h, LTF=15m.
function timeframesForDonchianRange(ltf: Timeframe): {
  htf: Timeframe;
  mtf: Timeframe;
  ltf: Timeframe;
} {
  if (ltf === "15m") return { htf: "1d", mtf: "4h", ltf: "15m" };
  throw new Error(`Donchian Range baseline supports 15m only, got: ${ltf as string}`);
}

// bybit.eu SPOT 1:10 leverage cost model.
const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesForDonchianRange(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;
  const strategy = new DonchianRangeChannelStrategy(DEFAULT_DONCHIAN_RANGE_CONFIG);

  // 2024-01-01 → today.
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[donchian-range] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[donchian-range] timeframes: htf=${tf.htf} mtf=${tf.mtf} ltf=${tf.ltf}`);
  console.log(`[donchian-range] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);
  console.log(`[donchian-range] initial equity: $${args.initialEquity}`);

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

  // Report envelope.
  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn = result.totalReturn > 0 ? (Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1) : 0;
  const wins = result.trades.filter((t) => t.pnlUsd > 0);
  const losses = result.trades.filter((t) => t.pnlUsd < 0);
  const winRate = result.trades.length > 0 ? wins.length / result.trades.length : 0;

  console.log(`\n=== RESULTS donchian-range ${args.symbol} ${args.timeframe} ===`);
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

  const fs = await import("node:fs/promises");
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(
    resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath),
    JSON.stringify(
      {
        args,
        strategy: "donchian-range",
        timeframe: tf,
        monthlyReturn,
        totalMonths,
        result,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n[donchian-range] Saved: ${args.outputPath}`);
}

main().catch((err: unknown) => {
  console.error("[donchian-range] FATAL:", err);
  process.exit(1);
});
