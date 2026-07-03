#!/usr/bin/env bun
// scripts/run-sweep.ts — MTF-TKC paraméter sweep a Binance adatokon.
//
// ÜGYNÖK #6 (data + backtest) — Phase 2 második lépése.
// A baseline MTF-TKC stratégiát több risk-per-trade / Kelly / maxDD
// kombinációval futtatja, és egy CSV-t ír ki az eredményekről.
// A legjobb Sharpe-hoz tartozó kombináció lesz az "ajánlott" baseline.
//
// Használat:
//   bun scripts/run-sweep.ts                       # BTC/USDT 1h, default kombinációk
//   bun scripts/run-sweep.ts --symbol=ETH/USDT --timeframe=4h
//   bun scripts/run-sweep.ts --output=backtest-results/sweep-eth-4h.csv

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel, type PositionSizeConfig } from "@mm-crypto-bot/backtest";
import { MtfTrendConfluenceStrategy } from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly outputPath: string;
  readonly startTime: Date;
  readonly endTime: Date;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1h";
  let initialEquity = 10_000;
  let outputPath = "backtest-results/sweep.csv";
  const now = new Date();
  let startTime = new Date(Date.UTC(2024, 0, 1));
  let endTime = now;
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
    } else if (arg.startsWith("--start=")) {
      startTime = new Date(arg.slice("--start=".length));
    } else if (arg.startsWith("--end=")) {
      endTime = new Date(arg.slice("--end=".length));
    }
  }
  return { symbol, timeframe, initialEquity, outputPath, startTime, endTime };
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

// Default sweep grid: 18 kombináció.
const RISK_GRID = [0.005, 0.01, 0.02];
const KELLY_GRID = [0.25, 0.5];
const DD_GRID = [0.15, 0.30, 0.50];

interface SweepRow {
  readonly symbol: string;
  readonly timeframe: string;
  readonly riskPerTrade: number;
  readonly kellyFraction: number;
  readonly maxDrawdown: number;
  readonly totalReturn: number;
  readonly monthlyReturn: number;
  readonly annualizedReturn: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly maxDrawdownPct: number;
  readonly profitFactor: number;
  readonly winRate: number;
  readonly totalTrades: number;
  readonly killSwitchTriggered: boolean;
  readonly elapsedMs: number;
}

function csvLine(row: SweepRow): string {
  return [
    row.symbol,
    row.timeframe,
    row.riskPerTrade,
    row.kellyFraction,
    row.maxDrawdown,
    row.totalReturn.toFixed(6),
    row.monthlyReturn.toFixed(6),
    row.annualizedReturn.toFixed(6),
    row.sharpeRatio.toFixed(6),
    row.sortinoRatio.toFixed(6),
    row.maxDrawdownPct.toFixed(6),
    row.profitFactor.toFixed(6),
    row.winRate.toFixed(6),
    row.totalTrades,
    row.killSwitchTriggered ? "1" : "0",
    row.elapsedMs,
  ].join(",");
}

async function runOne(
  feed: ExchangeFeed,
  symbol: string,
  tf: ReturnType<typeof timeframesFor>,
  ps: PositionSizeConfig,
  startTime: Date,
  endTime: Date,
  initialEquity: number,
): Promise<{ result: BacktestResult; elapsedMs: number }> {
  const t0 = Date.now();
  const result = await runBacktest({
    symbol: makeSymbol(symbol),
    htfTimeframe: tf.htf,
    mtfTimeframe: tf.mtf,
    ltfTimeframe: tf.ltf,
    startTime,
    endTime,
    initialEquityUsd: initialEquity,
    feed,
    costModel: COST_MODEL,
    positionSize: ps,
    strategy: new MtfTrendConfluenceStrategy(),
  });
  return { result, elapsedMs: Date.now() - t0 };
}

function monthlyReturn(totalReturn: number, startMs: number, endMs: number): number {
  const days = (endMs - startMs) / (1000 * 60 * 60 * 24);
  const months = days / 30.44;
  if (months <= 0 || totalReturn <= -1) return -1;
  return Math.pow(1 + totalReturn, 1 / months) - 1;
}

function analyzeTrades(result: BacktestResult): { winRate: number; wins: number; losses: number } {
  const wins = result.trades.filter((t) => t.pnlUsd > 0).length;
  const losses = result.trades.filter((t) => t.pnlUsd < 0).length;
  const total = result.trades.length;
  return { winRate: total > 0 ? wins / total : 0, wins, losses };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesFor(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  console.log(`[sweep] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[sweep] period: ${args.startTime.toISOString()} → ${args.endTime.toISOString()}`);
  console.log(
    `[sweep] grid: ${RISK_GRID.length}×${KELLY_GRID.length}×${DD_GRID.length} = ` +
      `${RISK_GRID.length * KELLY_GRID.length * DD_GRID.length} combos`,
  );

  const rows: SweepRow[] = [];
  let combo = 0;
  const totalCombos = RISK_GRID.length * KELLY_GRID.length * DD_GRID.length;

  for (const risk of RISK_GRID) {
    for (const kelly of KELLY_GRID) {
      for (const dd of DD_GRID) {
        combo++;
        const ps: PositionSizeConfig = {
          riskPerTrade: risk,
          kellyFraction: kelly,
          maxDrawdown: dd,
          maxPositionPctEquity: 0.2,
          minPositionPctEquity: 0.01,
        };
        const { result, elapsedMs } = await runOne(
          feed,
          args.symbol,
          tf,
          ps,
          args.startTime,
          args.endTime,
          args.initialEquity,
        );
        const win = analyzeTrades(result);
        const mret = monthlyReturn(result.totalReturn, args.startTime.getTime(), args.endTime.getTime());
        const row: SweepRow = {
          symbol: args.symbol,
          timeframe: args.timeframe,
          riskPerTrade: risk,
          kellyFraction: kelly,
          maxDrawdown: dd,
          totalReturn: result.totalReturn,
          monthlyReturn: mret,
          annualizedReturn: result.annualizedReturn,
          sharpeRatio: result.sharpeRatio,
          sortinoRatio: result.sortinoRatio,
          maxDrawdownPct: result.maxDrawdown,
          profitFactor: result.profitFactor,
          winRate: win.winRate,
          totalTrades: result.totalTrades,
          killSwitchTriggered: result.killSwitchTriggered,
          elapsedMs,
        };
        rows.push(row);
        console.log(
          `[${combo}/${totalCombos}] risk=${risk} kelly=${kelly} dd=${dd} → ` +
            `totRet=${(result.totalReturn * 100).toFixed(2)}% ` +
            `monthly=${(mret * 100).toFixed(2)}% ` +
            `sharpe=${result.sharpeRatio.toFixed(3)} ` +
            `maxDD=${(result.maxDrawdown * 100).toFixed(2)}% ` +
            `trades=${result.totalTrades} ` +
            `winRate=${(win.winRate * 100).toFixed(1)}% ` +
            `${elapsedMs}ms`,
        );
      }
    }
  }

  // Sort by monthlyReturn desc.
  rows.sort((a, b) => b.monthlyReturn - a.monthlyReturn);

  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  const header = [
    "symbol",
    "timeframe",
    "riskPerTrade",
    "kellyFraction",
    "maxDrawdown",
    "totalReturn",
    "monthlyReturn",
    "annualizedReturn",
    "sharpeRatio",
    "sortinoRatio",
    "maxDrawdownPct",
    "profitFactor",
    "winRate",
    "totalTrades",
    "killSwitchTriggered",
    "elapsedMs",
  ].join(",");
  const lines = [header, ...rows.map(csvLine)];
  await fs.writeFile(absOutput, lines.join("\n") + "\n", "utf8");

  const best = rows[0];
  if (best !== undefined) {
    console.log(
      `\n[sweep] BEST: risk=${best.riskPerTrade} kelly=${best.kellyFraction} dd=${best.maxDrawdown} → ` +
        `monthly=${(best.monthlyReturn * 100).toFixed(2)}%, sharpe=${best.sharpeRatio.toFixed(3)}, ` +
        `totalTrades=${best.totalTrades}, killSwitch=${best.killSwitchTriggered ? "yes" : "no"}`,
    );
  }
  console.log(`[sweep] Saved ${rows.length} rows → ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[sweep] FATAL:", err);
  process.exit(1);
});
