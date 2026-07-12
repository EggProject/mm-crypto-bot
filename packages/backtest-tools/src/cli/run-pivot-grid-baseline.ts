#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-pivot-grid-baseline.ts — Pivot Point Grid baseline
//
// Phase 15 Track D — Pivot Point Grid strategy baseline backtest (M15 / HTF=1d).
// Pivot Point Grid is a Phase 15 retail mean-reversion strategy: deterministic
// PP/S1/S2/R1/R2/R3 levels computed from the previous HTF (1d) candle, with
// M15 LTF entry. The strategy class lives in `@mm-crypto-bot/core` and is
// implemented by Phase 15 Track B (pivot-point-grid.ts).
//
// Phase 16 Track A — Added `--max-position-pct-equity` flag. The strategy-side
// notional cap scales signal `confidence` proportionally so the engine-side
// `positionSize.maxPositionPctEquity` constraint is enforced.
//
// Phase 16 Track C (integration) — Re-applied the flag after Track A merge.
// Earlier draft was lost during the merge; restored from backup.
//
// Használat:
//   bun run packages/backtest-tools/src/cli/run-pivot-grid-baseline.ts --symbol=BTC/USDT --timeframe=15m --output=backtest-results/phase15-pivot-grid-btc-15m.json
//   bun run packages/backtest-tools/src/cli/run-pivot-grid-baseline.ts --symbol=BTC/USDT --timeframe=15m --max-position-pct-equity=0.04 --output=backtest-results/phase16-pivot-grid-btc-15m-capped.json

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import { PivotPointGridStrategy, DEFAULT_PIVOT_GRID_CONFIG } from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly outputPath: string;
  readonly maxPositionPctEquity: number;
}

// A `parseArgs` exportálva van a 100% line-coverage tesztekhez.
export function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "15m";
  let initialEquity = 10_000;
  let outputPath = "backtest-results/phase15-pivot-grid-btc-15m.json";
  // Phase 16 Track A — Default 0.04 (the new DEFAULT_PIVOT_GRID_CONFIG.maxPositionPctEquity
  // = 0.04 from Track A). Override via --max-position-pct-equity=N where 0 < N <= 1.0.
  // (Note: 1.0 disables cap → legacy behavior. Values outside (0, 1] rejected.)
  let maxPositionPctEquity = 0.04;
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      // Phase 15 — Pivot Point Grid is M15.
      if (tf !== "15m") {
        throw new Error(`Pivot Grid baseline requires 15m timeframe, got: ${tf}`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    } else if (arg.startsWith("--max-position-pct-equity=")) {
      maxPositionPctEquity = Number(arg.slice("--max-position-pct-equity=".length));
      if (!Number.isFinite(maxPositionPctEquity) || maxPositionPctEquity <= 0 || maxPositionPctEquity > 1) {
        throw new Error(`--max-position-pct-equity must be in (0, 1]; got: ${maxPositionPctEquity}`);
      }
    }
  }
  return { symbol, timeframe, initialEquity, outputPath, maxPositionPctEquity };
}

// A `timeframesForPivotGrid` exportálva van a 100% line-coverage tesztekhez.
export function timeframesForPivotGrid(ltf: Timeframe): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
  if (ltf === "15m") return { htf: "1d", mtf: "4h", ltf: "15m" };
  throw new Error(`Pivot Point Grid baseline supports 15m only, got: ${ltf as string}`);
}

// bybit.eu SPOT 1:10 leverage cost model (matches Phase 14D baseline).
const COST_MODEL: CostModel = {
  takerFeeRate: 0.001, // 0.1% / side
  slippageRate: 0.0005, // 0.05% / side
  spreadRate: 0.0002, // 2 bps / side
  borrowRatePerHour: 0.0001, // 0.01%/h
  fundingRatePer8h: 0, // SPOT only
};

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesForPivotGrid(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;
  // Phase 16 Track A — pass the per-strategy notional cap to the strategy.
  // The strategy scales signal `confidence` so the engine-side position-
  // sizing layer respects `maxPositionPctEquity`. We merge the DEFAULT with
  // the CLI-supplied cap (defaults to 0.04) and override the cap field.
  const strategyConfig = {
    ...DEFAULT_PIVOT_GRID_CONFIG,
    maxPositionPctEquity: args.maxPositionPctEquity,
  };
  const strategy = new PivotPointGridStrategy(strategyConfig);

  // 2024-01-01 → today (matches Phase 14 baseline window).
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[pivot-grid] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[pivot-grid] timeframes: htf=${tf.htf} mtf=${tf.mtf} ltf=${tf.ltf}`);
  console.log(`[pivot-grid] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);
  console.log(`[pivot-grid] initial equity: $${args.initialEquity}`);
  console.log(`[pivot-grid] max-position-pct-equity (strategy-side cap, default 0.04): ${args.maxPositionPctEquity}`);

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
      maxDrawdown: 0.5, // disable kill-switch for diagnostic
      maxPositionPctEquity: 0.2,
      minPositionPctEquity: 0.01,
    },
    strategy,
  });

  // Report (matches run-baseline.ts CLI envelope for downstream REPORT.md parsing).
  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn = result.totalReturn > 0 ? (Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1) : 0;
  const wins = result.trades.filter((t) => t.pnlUsd > 0);
  const losses = result.trades.filter((t) => t.pnlUsd < 0);
  const winRate = result.trades.length > 0 ? wins.length / result.trades.length : 0;

  console.log(`\n=== RESULTS pivot-grid ${args.symbol} ${args.timeframe} (cap=${args.maxPositionPctEquity}) ===`);
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

  // JSON output — matches Phase 14 baseline envelope (args, monthlyReturn, totalMonths, result).
  const fs = await import("node:fs/promises");
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(
    resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath),
    JSON.stringify(
      {
        args,
        strategy: "pivot-grid",
        timeframe: tf,
        strategyConfig: { maxPositionPctEquity: args.maxPositionPctEquity },
        monthlyReturn,
        totalMonths,
        result,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n[pivot-grid] Saved: ${args.outputPath}`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error("[pivot-grid] FATAL:", err);
    process.exit(1);
  });
}
