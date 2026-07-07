#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts —
// Phase 18 Track B Donchian + Pivot 2-component composition runner.
//
// Wraps Donchian Range Channel + Pivot Point Grid into a single ensemble
// (DonchianPivotComposition) and backtests it on BTC/ETH/SOL M15. The
// `minConsensus` parameter controls how many sub-strategies must fire
// (1 = either fires, 2 = both must fire). Both modes are useful for
// the Phase 18 envelope study.
//
// ===========================================================================
// Phase 20 Track B — Per-Trade Hybrid-Kelly CLI surface (forward-compat)
// ===========================================================================
// This CLI now accepts the Phase 20 #1 `--use-per-trade-kelly` flag (default
// `false`). The actual wire-up lives in `signal-center-v1.ts` (Track B's
// primary deliverable). This CLI uses `runBacktest` directly (not SCv1),
// so the flag is currently a no-op for the runBacktest path — the runBacktest
// position-size chain does not have a per-trade Hybrid-Kelly chokepoint.
// A future Track will plumb SCv1 through this CLI runner.
//
// The flag is parsed and validated for forward-compat:
//   --use-per-trade-kelly=true|false   (default false)
//   --hybrid-kelly-cap=<0..1>          (default 0.5; throws if > 1.0)
//   --hybrid-kelly-history-days=<int>  (default 30; throws if < 1)
//
// When `use-per-trade-kelly=true`, the CLI prints a one-shot notice that
// the flag is a no-op for this runner (full integration is a follow-up).
// The bit-identical-to-Phase-19 baseline (default `false`) is preserved.
//
// Használat:
//   bun run packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts \
//     --symbol=BTC/USDT --timeframe=15m --min-consensus=2 \
//     --output=backtest-results/phase18-donchian-pivot-btc-15m-2of2.json

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import {
  DonchianPivotComposition,
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
} from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly minConsensus: number;
  readonly maxPositionPctEquity: number;
  readonly outputPath: string;
  /**
   * Phase 20 Track B — opt-in flag for the Per-Trade Hybrid-Kelly
   * drop-in. Default `false` (bit-identical to Phase 19 baseline).
   * Currently a no-op for this CLI's runBacktest path — see module
   * docstring. Future Track will plumb SCv1 through this runner.
   */
  readonly usePerTradeHybridKelly: boolean;
  /**
   * Phase 20 Track B — Per-Trade Hybrid-Kelly cap in [0, 1.0].
   * Default 0.5 (Phase 9 9E `baseKellyFraction`). Validated > 1.0
   * throws (1:10 mandate preservation).
   */
  readonly hybridKellyCap: number;
  /**
   * Phase 20 Track B — rolling history window in days.
   * Default 30 (Phase 9 9E `fundingSharpeWindowDays`). Validated < 1
   * throws.
   */
  readonly hybridKellyHistoryDays: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "15m";
  let initialEquity = 10_000;
  let minConsensus = 2;
  // Phase 19 — cap sweep (cap=0.04, 0.08, 0.10, 0.12, 0.15). Default 0.20 (engine default,
  // matches Phase 18 final envelope which used the un-parametrized CLI). Override via
  // `--max-position-pct-equity=<pct>` where pct is in [0, 1] equity-notional terms.
  let maxPositionPctEquity = 0.20;
  let outputPath = "backtest-results/phase18-donchian-pivot-btc-15m-2of2.json";
  // Phase 20 Track B — Per-Trade Hybrid-Kelly opt-in flags (default-off = Phase 19 baseline).
  let usePerTradeHybridKelly = false;
  let hybridKellyCap = 0.5;
  let hybridKellyHistoryDays = 30;
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      // Phase 18 Track B — composition runs on M15 by default.
      if (tf !== "15m") {
        throw new Error(`Donchian+Pivot composition requires 15m timeframe, got: ${tf}`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--min-consensus=")) {
      const v = Number(arg.slice("--min-consensus=".length));
      if (!Number.isInteger(v) || v < 1 || v > 2) {
        throw new Error(`--min-consensus must be 1 or 2, got: ${v}`);
      }
      minConsensus = v;
    } else if (arg.startsWith("--max-position-pct-equity=")) {
      const v = Number(arg.slice("--max-position-pct-equity=".length));
      if (!Number.isFinite(v) || v <= 0 || v > 0.5) {
        throw new Error(
          `--max-position-pct-equity must be in (0, 0.5] (engine permits up to 50% equity notional at 1:10 leverage), got: ${v}`,
        );
      }
      maxPositionPctEquity = v;
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    } else if (arg.startsWith("--use-per-trade-kelly=")) {
      // Phase 20 Track B — opt-in flag for Per-Trade Hybrid-Kelly.
      // Accepts true|false (case-insensitive). Anything else throws.
      const v = arg.slice("--use-per-trade-kelly=".length).toLowerCase();
      if (v === "true") usePerTradeHybridKelly = true;
      else if (v === "false") usePerTradeHybridKelly = false;
      else throw new Error(`--use-per-trade-kelly must be 'true' or 'false', got: ${v}`);
    } else if (arg.startsWith("--hybrid-kelly-cap=")) {
      // Phase 20 Track B — Per-Trade Hybrid-Kelly cap. Must be in (0, 1.0].
      // 1.10 mandate preservation: cap > 1.0 throws (see
      // `validateHybridKellyConfig` in `sizing/per-trade-hybrid-kelly.ts`).
      const v = Number(arg.slice("--hybrid-kelly-cap=".length));
      if (!Number.isFinite(v) || v <= 0 || v > 1.0) {
        throw new Error(
          `--hybrid-kelly-cap must be in (0, 1.0] (1:10 mandate hard cap), got: ${v}`,
        );
      }
      hybridKellyCap = v;
    } else if (arg.startsWith("--hybrid-kelly-history-days=")) {
      // Phase 20 Track B — Per-Trade Hybrid-Kelly history window.
      // Must be integer ≥ 1.
      const v = Number(arg.slice("--hybrid-kelly-history-days=".length));
      if (!Number.isInteger(v) || v < 1) {
        throw new Error(`--hybrid-kelly-history-days must be an integer >= 1, got: ${v}`);
      }
      hybridKellyHistoryDays = v;
    }
  }
  return {
    symbol,
    timeframe,
    initialEquity,
    minConsensus,
    maxPositionPctEquity,
    outputPath,
    usePerTradeHybridKelly,
    hybridKellyCap,
    hybridKellyHistoryDays,
  };
}

// Donchian+Pivot composition timeline — HTF=1d, MTF=4h, LTF=15m.
function timeframesForComposition(ltf: Timeframe): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
  if (ltf === "15m") return { htf: "1d", mtf: "4h", ltf: "15m" };
  throw new Error(`Donchian+Pivot composition supports 15m only, got: ${ltf as string}`);
}

// bybit.eu SPOT 1:10 leverage cost model (matches Phase 17 fixed engine baseline).
const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesForComposition(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;
  // DonchianPivotComposition takes a partial config (minConsensus + per-sub-strategy
  // overrides) and an LTF (defaults to M15). We pass `minConsensus` from CLI.
  const strategy = new DonchianPivotComposition(
    { ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG, minConsensus: args.minConsensus },
    "15m",
  );

  // 2024-01-01 → today.
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  const consensusTag = `${args.minConsensus}of2`;
  console.log(
    `[donchian-pivot] symbol=${args.symbol} ltf=${args.timeframe} minConsensus=${args.minConsensus} maxPositionPctEquity=${args.maxPositionPctEquity}`,
  );
  console.log(`[donchian-pivot] timeframes: htf=${tf.htf} mtf=${tf.mtf} ltf=${tf.ltf}`);
  console.log(`[donchian-pivot] components: Donchian Range Channel + Pivot Point Grid`);
  console.log(`[donchian-pivot] aggregation: side-conflict → defer | mean(confidences) | tighter-stop`);
  console.log(`[donchian-pivot] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);
  console.log(`[donchian-pivot] initial equity: $${args.initialEquity}`);
  // Phase 20 Track B — Per-Trade Hybrid-Kelly CLI surface (forward-compat).
  // When the opt-in flag is true, this CLI does NOT plumb SCv1 through
  // runBacktest (would require a major refactor that violates the
  // "DO NOT modify the engine position-size chain" constraint). Print
  // a one-shot notice so users aren't confused by an apparently
  // ineffective flag. The actual wire-up lives in signal-center-v1.ts
  // and is exercised via the unit tests in signal-center-v1.test.ts.
  if (args.usePerTradeHybridKelly) {
    console.log(
      `[donchian-pivot] NOTE: --use-per-trade-kelly=true is a forward-compat surface for this CLI. ` +
        `The current runner uses runBacktest directly (not SignalCenterV1), so the per-trade Hybrid-Kelly ` +
        `override does NOT engage here. Wire-up lives in signal-center-v1.ts (ingestSignal chokepoint); ` +
        `full SCv1 integration for this runner is a follow-up Track. ` +
        `Effective settings: hybridKellyCap=${args.hybridKellyCap} historyWindowDays=${args.hybridKellyHistoryDays} ` +
        `(parsed and validated, not applied to runBacktest positionSize chain).`,
    );
  }

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
      maxPositionPctEquity: args.maxPositionPctEquity,
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

  console.log(`\n=== RESULTS donchian-pivot ${consensusTag} ${args.symbol} ${args.timeframe} ===`);
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
        strategy: "donchian-pivot-composition",
        components: ["donchian-range", "pivot-grid"],
        minConsensus: args.minConsensus,
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
  console.log(`\n[donchian-pivot] Saved: ${args.outputPath}`);
}

main().catch((err: unknown) => {
  console.error("[donchian-pivot] FATAL:", err);
  process.exit(1);
});
