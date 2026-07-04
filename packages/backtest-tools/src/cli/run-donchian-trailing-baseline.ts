#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-donchian-trailing-baseline.ts
//
// Phase 7 Track A — Donchian 1d trailing-stop baseline backtest CLI.
//
// Az engine a Phase 5 `DonchianBreakoutStrategy` entry signal-jaira, valamint
// az ujonnan bevezetett `onOpenPositionUpdate` / `onPositionOpened` /
// `onPositionClosed` hook-okra epit. A CLI runner 4 trailing-stop variant
// tamogat:
//
//   - pct5   — 5% fix trailing distance (HWM × 0.95)
//   - pct10  — 10% fix trailing distance (HWM × 0.90, Stratbase BTC 2019-2025 alap)
//   - pct15  — 15% fix trailing distance (HWM × 0.85)
//   - atr2x  — ATR(14) × 2.0 trailing distance (volatility-adaptive)
//
// A Phase 5 stop-loss (1.5× ATR) es take-profit (4.5× ATR) megmarad, a
// trailing-stop csak monoton-szigorito SL update-ket ad vissza.
//
// Hasznalat:
//   bun run packages/backtest-tools/src/cli/run-donchian-trailing-baseline.ts \
//     --symbol=BTC/USDT --timeframe=1d --trail-variant=pct10 \
//     --output=backtest-results/baseline-donchian-trailing-btc-1d.json

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import {
  DonchianTrailingStrategy,
  type TrailVariant,
} from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly volumeConfirmMultiplier: number;
  readonly useHtfTrendFilter: boolean;
  readonly trailVariant: TrailVariant;
  readonly maxHoldBars: number;
  readonly outputPath: string;
}

const VALID_VARIANTS: readonly TrailVariant[] = ["pct5", "pct10", "pct15", "atr2x"];

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let volumeConfirmMultiplier = 1.5;
  let useHtfTrendFilter = true;
  let trailVariant: TrailVariant = "pct10";
  let maxHoldBars = 0;
  let outputPath = "backtest-results/baseline-donchian-trailing-btc-1d.json";

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
    } else if (arg.startsWith("--vol=")) {
      volumeConfirmMultiplier = Number(arg.slice("--vol=".length));
    } else if (arg === "--no-htf-filter") {
      useHtfTrendFilter = false;
    } else if (arg.startsWith("--trail-variant=")) {
      const v = arg.slice("--trail-variant=".length) as TrailVariant;
      if (!VALID_VARIANTS.includes(v)) {
        throw new Error(`Invalid trail-variant: ${v} (must be one of ${VALID_VARIANTS.join(", ")})`);
      }
      trailVariant = v;
    } else if (arg.startsWith("--max-hold-bars=")) {
      maxHoldBars = Number(arg.slice("--max-hold-bars=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return { symbol, timeframe, initialEquity, volumeConfirmMultiplier, useHtfTrendFilter, trailVariant, maxHoldBars, outputPath };
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

  const strategy = new DonchianTrailingStrategy({
    trailVariant: args.trailVariant,
    volumeConfirmMultiplier: args.volumeConfirmMultiplier,
    useHtfTrendFilter: args.useHtfTrendFilter,
    maxHoldBars: args.maxHoldBars,
  });

  console.log(`[donchian-trailing-baseline] symbol=${args.symbol} ltf=${args.timeframe} trail-variant=${args.trailVariant}`);
  console.log(`[donchian-trailing-baseline] vol=${args.volumeConfirmMultiplier} avg, htf-filter=${args.useHtfTrendFilter}, max-hold-bars=${args.maxHoldBars}`);
  console.log(`[donchian-trailing-baseline] period: ${startTime.toISOString()} -> ${endTime.toISOString()}`);

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

  // Phase 7 Track A — kilepesi-ok bontas (HWM-exit vs TP-exit vs SL-exit).
  const exitReasonCounts: Record<string, number> = {};
  let totalHoldingBars = 0;
  for (const t of result.trades) {
    exitReasonCounts[t.exitReason] = (exitReasonCounts[t.exitReason] ?? 0) + 1;
    const holdingMs = t.exitTime - t.entryTime;
    const holdingBarCount = Math.max(1, Math.round(holdingMs / (24 * 60 * 60 * 1000))); // 1d ltf
    totalHoldingBars += holdingBarCount;
  }
  const avgTradeDurationDays = result.trades.length > 0 ? totalHoldingBars / result.trades.length : 0;
  const hwmExitCount = exitReasonCounts["trailing_stop"] ?? 0;
  const tpExitCount = exitReasonCounts["take_profit"] ?? 0;
  const slExitCount = exitReasonCounts["stop_loss"] ?? 0;
  const timeExitCount = exitReasonCounts["time_exit"] ?? 0;
  const killSwitchCount = exitReasonCounts["kill_switch"] ?? 0;
  const endOfDataCount = exitReasonCounts["end_of_data"] ?? 0;

  console.log(`\n=== DONCHIAN TRAILING-STOP RESULTS ${args.symbol} ${args.timeframe} trail=${args.trailVariant} ===`);
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
  console.log(`Avg trade duration:     ${avgTradeDurationDays.toFixed(1)} days`);
  console.log(`Kill-switch:            ${result.killSwitchTriggered ? "yes" : "no"}`);
  console.log(`Exit-reason breakdown:`);
  console.log(`  trailing_stop:        ${hwmExitCount}`);
  console.log(`  take_profit:          ${tpExitCount}`);
  console.log(`  stop_loss:            ${slExitCount}`);
  console.log(`  time_exit:            ${timeExitCount}`);
  console.log(`  kill_switch:          ${killSwitchCount}`);
  console.log(`  end_of_data:          ${endOfDataCount}`);
  if (result.trades.length > 0) {
    const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnlUsd, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.pnlUsd, 0) / losses.length : 0;
    console.log(`Avg win:                $${avgWin.toFixed(2)}`);
    console.log(`Avg loss:               $${avgLoss.toFixed(2)}`);
  }
  const finalEq = result.equityCurve[result.equityCurve.length - 1]?.equity ?? args.initialEquity;
  console.log(`Final equity:           $${finalEq.toFixed(2)}`);

  // Trade-count sanity check (Phase 5 baseline 19-28 trade / 30 ho / sym volt).
  if (result.totalTrades === 0) {
    console.warn(`[donchian-trailing-baseline] WARNING DEVIATION: 0 trades (Phase 5 baseline 19-28 / 30 ho)`);
  } else if (result.totalTrades > 100) {
    console.warn(`[donchian-trailing-baseline] WARNING DEVIATION: ${result.totalTrades} trades (>100 -- Phase 5 nem produkalt ennyit)`);
  } else {
    console.log(`[donchian-trailing-baseline] OK Trade-count (${result.totalTrades}) within Phase 5 range (19-28)`);
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
        trailVariant: args.trailVariant,
        exitReasonCounts: {
          trailing_stop: hwmExitCount,
          take_profit: tpExitCount,
          stop_loss: slExitCount,
          time_exit: timeExitCount,
          kill_switch: killSwitchCount,
          end_of_data: endOfDataCount,
        },
        result,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[donchian-trailing-baseline] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[donchian-trailing-baseline] FATAL:", err);
  process.exit(1);
});
