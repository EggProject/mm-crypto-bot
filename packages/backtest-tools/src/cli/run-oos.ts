#!/usr/bin/env bun
// scripts/run-oos.ts — walk-forward out-of-sample validáció a Binance adatokon.
//
// ÜGYNÖK #6 (data + backtest) — Phase 3.
// A MTF-TKC stratégiát walk-forward séma szerint futtatja (12 hónap IS /
// 3 hónap OOS / 1 hónapos görgetés), és kiírja az IS/OOS Sharpe-arányt.
//
// Használat:
//   bun scripts/run-oos.ts                       # BTC/USDT 1h, default WF
//   bun scripts/run-oos.ts --symbol=ETH/USDT --timeframe=4h
//   bun scripts/run-oos.ts --in=180 --oos=90 --step=30

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import {
  runBacktest,
  runWalkForward,
  type BacktestResult,
  type CostModel,
  type WalkForwardConfig,
} from "@mm-crypto-bot/backtest";
import { MtfTrendConfluenceStrategy } from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly outputPath: string;
  readonly inSampleDays: number;
  readonly outOfSampleDays: number;
  readonly stepDays: number;
  readonly startTime: Date;
  readonly endTime: Date;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1h";
  let initialEquity = 10_000;
  let outputPath = "backtest-results/oos.json";
  let inSampleDays = 365;
  let outOfSampleDays = 90;
  let stepDays = 30;
  let startTime = new Date(Date.UTC(2024, 0, 1));
  let endTime = new Date();
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
    } else if (arg.startsWith("--in=")) {
      inSampleDays = Number(arg.slice("--in=".length));
    } else if (arg.startsWith("--oos=")) {
      outOfSampleDays = Number(arg.slice("--oos=".length));
    } else if (arg.startsWith("--step=")) {
      stepDays = Number(arg.slice("--step=".length));
    } else if (arg.startsWith("--start=")) {
      startTime = new Date(arg.slice("--start=".length));
    } else if (arg.startsWith("--end=")) {
      endTime = new Date(arg.slice("--end=".length));
    }
  }
  return {
    symbol,
    timeframe,
    initialEquity,
    outputPath,
    inSampleDays,
    outOfSampleDays,
    stepDays,
    startTime,
    endTime,
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

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesFor(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  console.log(`[oos] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(
    `[oos] walk-forward: IS=${args.inSampleDays}d, OOS=${args.outOfSampleDays}d, step=${args.stepDays}d`,
  );
  console.log(`[oos] period: ${args.startTime.toISOString()} → ${args.endTime.toISOString()}`);

  const wf: WalkForwardConfig = {
    inSampleDays: args.inSampleDays,
    outOfSampleDays: args.outOfSampleDays,
    stepDays: args.stepDays,
  };

  // A walk-forward a teljes baseOptions-on dolgozik.
  // A runBacktest belsőleg hozza létre a feed-en a HTF/MTF candle-eket.
  const wfResult = await runWalkForward(
    {
      symbol: makeSymbol(args.symbol),
      htfTimeframe: tf.htf,
      mtfTimeframe: tf.mtf,
      ltfTimeframe: tf.ltf,
      startTime: args.startTime,
      endTime: args.endTime,
      initialEquityUsd: args.initialEquity,
      feed,
      costModel: COST_MODEL,
      positionSize: {
        riskPerTrade: 0.01,
        kellyFraction: 0.25,
        maxDrawdown: 0.5, // disable kill-switch for diagnostics
        maxPositionPctEquity: 0.2,
        minPositionPctEquity: 0.01,
      },
      strategy: new MtfTrendConfluenceStrategy(),
    },
    wf,
  );

  console.log(
    `\n[oos] ${wfResult.windowCount} ablak futott le.\n` +
      `  Avg IS Sharpe:  ${wfResult.avgIsSharpe.toFixed(3)}\n` +
      `  Avg OOS Sharpe: ${wfResult.avgOosSharpe.toFixed(3)}\n` +
      `  OOS/IS arány:   ${wfResult.oosIsSharpeRatio.toFixed(3)}\n` +
      `  (min küszöb: 0.60 — ha alatta, a stratégia túl-fit a historikus adatra)`,
  );

  // Ablak-szintű összefoglaló.
  console.log(`\n[oos] Ablakok:`);
  for (let i = 0; i < wfResult.oosResults.length; i++) {
    const is = wfResult.isResults[i];
    const oos = wfResult.oosResults[i];
    if (is !== undefined && oos !== undefined) {
      console.log(
        `  #${i + 1}: IS=${is.sharpeRatio.toFixed(3)} (${is.totalTrades} trades, ` +
          `${(is.totalReturn * 100).toFixed(1)}%), ` +
          `OOS=${oos.sharpeRatio.toFixed(3)} (${oos.totalTrades} trades, ` +
          `${(oos.totalReturn * 100).toFixed(1)}%)`,
      );
    }
  }

  // Save JSON
  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  const summary: Record<string, unknown> = {
    args,
    walkForward: wf,
    avgIsSharpe: wfResult.avgIsSharpe,
    avgOosSharpe: wfResult.avgOosSharpe,
    oosIsSharpeRatio: wfResult.oosIsSharpeRatio,
    windowCount: wfResult.windowCount,
    isWindowSummaries: wfResult.isResults.map((r: BacktestResult) => ({
      totalReturn: r.totalReturn,
      sharpeRatio: r.sharpeRatio,
      sortinoRatio: r.sortinoRatio,
      maxDrawdown: r.maxDrawdown,
      winRate: r.winRate,
      totalTrades: r.totalTrades,
      profitFactor: r.profitFactor,
      killSwitchTriggered: r.killSwitchTriggered,
      startTime: r.startTime,
      endTime: r.endTime,
    })),
    oosWindowSummaries: wfResult.oosResults.map((r: BacktestResult) => ({
      totalReturn: r.totalReturn,
      sharpeRatio: r.sharpeRatio,
      sortinoRatio: r.sortinoRatio,
      maxDrawdown: r.maxDrawdown,
      winRate: r.winRate,
      totalTrades: r.totalTrades,
      profitFactor: r.profitFactor,
      killSwitchTriggered: r.killSwitchTriggered,
      startTime: r.startTime,
      endTime: r.endTime,
    })),
  };
  await fs.writeFile(absOutput, JSON.stringify(summary, null, 2), "utf8");
  console.log(`\n[oos] Saved → ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[oos] FATAL:", err);
  process.exit(1);
});
