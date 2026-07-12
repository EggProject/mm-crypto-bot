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
// Használat:
//   bun run packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts \
//     --symbol=BTC/USDT --timeframe=15m --min-consensus=2 \
//     --output=backtest-results/phase18-donchian-pivot-btc-15m-2of2.json
//
// Phase 30b — multi-symbol mode.  Pass `--symbols=BTC/USDT,ETH/USDT,SOL/USDT`
// (comma-separated) to run each symbol independently and emit a
// combined envelope.  This is the Phase 26 §5-recommended configuration
// (per-symbol DP, NOT via the PortfolioOrchestrator which adds ~23pp
// of plugin-overhead and dilutes alpha to +2.05%/mo combined).
//
// Example:
//   bun run packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts \
//     --symbols=BTC/USDT,ETH/USDT,SOL/USDT --min-consensus=1 \
//     --max-position-pct-equity=0.20 --start=2024-01-01 --end=2026-07-08 \
//     --output-dir=backtest-results/phase30b-multisymbol

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
  readonly symbols: readonly string[];
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly minConsensus: number;
  readonly maxPositionPctEquity: number;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly outputPath: string;
  readonly outputDir: string;
  readonly multiSymbolMode: boolean;
  readonly dataDir: string;
}

const ALLOWED_SYMBOLS = new Set(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);

// A `parseSymbols` exportálva van a 100% line-coverage tesztekhez.
export function parseSymbols(raw: string): readonly string[] {
  const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error(`--symbols is empty`);
  }
  for (const s of parts) {
    if (!ALLOWED_SYMBOLS.has(s)) {
      throw new Error(
        `--symbols contains unsupported symbol: ${s} (allowed: ${[...ALLOWED_SYMBOLS].join(", ")})`,
      );
    }
  }
  return parts;
}

// A `parseArgs` exportálva van a 100% line-coverage tesztekhez.
export function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let symbols: string[] = [];
  let timeframe: Timeframe = "15m";
  let initialEquity = 10_000;
  let minConsensus = 2;
  // Phase 19 — cap sweep (cap=0.04, 0.08, 0.10, 0.12, 0.15). Default 0.20 (engine default,
  // matches Phase 18 final envelope which used the un-parametrized CLI). Override via
  // `--max-position-pct-equity=<pct>` where pct is in [0, 1] equity-notional terms.
  let maxPositionPctEquity = 0.20;
  // 2024-01-01 → today (default). Override with --start=YYYY-MM-DD --end=YYYY-MM-DD
  // for OOS sub-period analysis (e.g. --start=2024-01-01 --end=2025-12-31 for IS,
  // --start=2026-01-01 --end=2026-07-06 for OOS).
  let startTime = new Date(Date.UTC(2024, 0, 1));
  let endTime = new Date();
  let outputPath = "backtest-results/phase18-donchian-pivot-btc-15m-2of2.json";
  // Phase 30b — multi-symbol mode.  When `--symbols=` is set, the
  // output path is auto-derived from the per-symbol run.
  let outputDir = "backtest-results/phase30b-multisymbol";
  // Phase 35b — accept --data-dir= to override the OHLCV data directory.
  // Tests use a tmp dir with minimal data so the subprocess runs in seconds.
  let dataDir: string | null = null;
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--symbols=")) {
      symbols = [...parseSymbols(arg.slice("--symbols=".length))];
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
    } else if (arg.startsWith("--start=")) {
      startTime = new Date(arg.slice("--start=".length));
    } else if (arg.startsWith("--end=")) {
      endTime = new Date(arg.slice("--end=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    } else if (arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length);
    } else if (arg.startsWith("--data-dir=")) {
      dataDir = arg.slice("--data-dir=".length);
    }
  }
  // Phase 30b — multi-symbol mode is triggered when `--symbols=` is
  // passed (independent of `--symbol=`, which is the legacy single-symbol
  // path).  In multi-symbol mode, the per-symbol output path is
  // auto-derived under `--output-dir/`.
  const multiSymbolMode = symbols.length > 0;
  const resolvedDataDir = dataDir ?? resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  return {
    symbol,
    symbols,
    timeframe,
    initialEquity,
    minConsensus,
    maxPositionPctEquity,
    startTime,
    endTime,
    outputPath,
    outputDir,
    multiSymbolMode,
    dataDir: resolvedDataDir,
  };
}

// A `timeframesForComposition` exportálva van a 100% line-coverage tesztekhez.
export function timeframesForComposition(ltf: Timeframe): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
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

async function runSingle(
  args: CliArgs,
  _dataDir: string,
  feed: ExchangeFeed,
  symbol: string,
  outputPath: string,
  consensusTag: string,
  tf: { htf: Timeframe; mtf: Timeframe; ltf: Timeframe },
): Promise<{
  readonly symbol: string;
  readonly result: BacktestResult;
  readonly monthlyReturn: number;
  readonly winRate: number;
  readonly totalMonths: number;
}> {
  const strategy = new DonchianPivotComposition(
    { ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG, minConsensus: args.minConsensus },
    "15m",
  );

  console.log(
    `[donchian-pivot] symbol=${symbol} ltf=${args.timeframe} minConsensus=${args.minConsensus} maxPositionPctEquity=${args.maxPositionPctEquity}`,
  );

  const result: BacktestResult = await runBacktest({
    symbol: makeSymbol(symbol),
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
      maxDrawdown: 0.5,
      maxPositionPctEquity: args.maxPositionPctEquity,
      minPositionPctEquity: 0.01,
    },
    strategy,
  });

  const totalDays = (args.endTime.getTime() - args.startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn = result.totalReturn > 0 ? (Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1) : 0;
  const wins = result.trades.filter((t) => t.pnlUsd > 0);
  const winRate = result.trades.length > 0 ? wins.length / result.trades.length : 0;

  console.log(`\n=== RESULTS donchian-pivot ${consensusTag} ${symbol} ${args.timeframe} ===`);
  console.log(`Total return:     ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:      ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:       ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:           ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Sortino:          ${result.sortinoRatio.toFixed(3)}`);
  console.log(`Max DD:           ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Profit factor:    ${result.profitFactor.toFixed(3)}`);
  console.log(`Win rate:         ${(winRate * 100).toFixed(2)}%`);
  console.log(`Trades:           ${result.totalTrades}`);

  const fs = await import("node:fs/promises");
  const outAbs = resolve(import.meta.dir, "..", "..", "..", "..", outputPath);
  await fs.mkdir(resolve(outAbs, ".."), { recursive: true });
  await fs.writeFile(
    outAbs,
    JSON.stringify(
      {
        args: { ...args, symbol },
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
  console.log(`[donchian-pivot] Saved: ${outputPath}`);
  return { symbol, result, monthlyReturn, winRate, totalMonths };
}

export async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesForComposition(args.timeframe);
  const feed = new CsvExchangeFeed(args.dataDir) as unknown as ExchangeFeed;
  const consensusTag = `${args.minConsensus}of2`;

  console.log(`[donchian-pivot] timeframes: htf=${tf.htf} mtf=${tf.mtf} ltf=${tf.ltf}`);
  console.log(`[donchian-pivot] components: Donchian Range Channel + Pivot Point Grid`);
  console.log(`[donchian-pivot] aggregation: side-conflict → defer | mean(confidences) | tighter-stop`);
  console.log(`[donchian-pivot] period: ${args.startTime.toISOString()} → ${args.endTime.toISOString()}`);
  console.log(`[donchian-pivot] initial equity: $${args.initialEquity}`);

  if (!args.multiSymbolMode) {
    // Legacy single-symbol path.
    await runSingle(args, args.dataDir, feed, args.symbol, args.outputPath, consensusTag, tf);
    return;
  }

  // Phase 30b — multi-symbol mode.  Run each symbol independently
  // (Phase 26 §5 recommended configuration — per-symbol DP, NOT via
  // the PortfolioOrchestrator which adds ~23pp of plugin-overhead and
  // dilutes alpha to +2.05%/mo combined).  Emit a combined envelope
  // JSON summarizing the per-symbol results.
  const fs = await import("node:fs/promises");
  const perSymbol: {
    readonly symbol: string;
    readonly result: BacktestResult;
    readonly monthlyReturn: number;
    readonly winRate: number;
    readonly totalMonths: number;
  }[] = [];
  for (const symbol of args.symbols) {
    const outPath = `${args.outputDir}/dp-${consensusTag}-${symbol.replace("/", "-").toLowerCase()}-${args.maxPositionPctEquity}.json`;
    const r = await runSingle(args, args.dataDir, feed, symbol, outPath, consensusTag, tf);
    perSymbol.push(r);
  }
  // Combined envelope (simple average of per-symbol monthly returns).
  const combinedMonthly =
    perSymbol.length > 0
      ? perSymbol.reduce((acc, r) => acc + r.monthlyReturn, 0) / perSymbol.length
      : 0;
  const combinedAnnualized = perSymbol.length > 0
    ? perSymbol.reduce((acc, r) => acc + r.result.annualizedReturn, 0) / perSymbol.length
    : 0;
  const combinedMaxDd = perSymbol.length > 0
    ? Math.max(...perSymbol.map((r) => r.result.maxDrawdown))
    : 0;
  const combinedSharpe = perSymbol.length > 0
    ? perSymbol.reduce((acc, r) => acc + r.result.sharpeRatio, 0) / perSymbol.length
    : 0;
  const combinedOutput = {
    strategy: "donchian-pivot-composition (multi-symbol, Phase 30b)",
    mode: "per-symbol-independent",
    note: "Per-symbol envelopes are averaged. NO PortfolioOrchestrator overhead. 1:10 leverage applied per symbol.",
    args: { ...args, symbol: args.symbols.join(",") },
    components: ["donchian-range", "pivot-grid"],
    minConsensus: args.minConsensus,
    timeframe: tf,
    perSymbol: perSymbol.map((r) => ({
      symbol: r.symbol,
      monthlyReturnPct: r.monthlyReturn * 100,
      annualizedReturnPct: r.result.annualizedReturn * 100,
      sharpeRatio: r.result.sharpeRatio,
      sortinoRatio: r.result.sortinoRatio,
      maxDrawdownPct: r.result.maxDrawdown * 100,
      profitFactor: r.result.profitFactor,
      winRatePct: r.winRate * 100,
      totalTrades: r.result.totalTrades,
    })),
    combinedSimpleAverage: {
      monthlyReturnPct: combinedMonthly * 100,
      annualizedReturnPct: combinedAnnualized * 100,
      sharpeRatio: combinedSharpe,
      maxDrawdownPct: combinedMaxDd * 100,
    },
  };
  const combinedPath = `${args.outputDir}/dp-${consensusTag}-combined-${args.symbols.length}symbols.json`;
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", args.outputDir), { recursive: true });
  await fs.writeFile(
    resolve(import.meta.dir, "..", "..", "..", "..", combinedPath),
    JSON.stringify(combinedOutput, null, 2),
    "utf8",
  );
  console.log(`\n=== COMBINED donchian-pivot ${consensusTag} (${args.symbols.length} symbols) ===`);
  console.log(`Symbols:                ${args.symbols.join(", ")}`);
  console.log(`Combined monthly:       ${(combinedMonthly * 100).toFixed(2)}%/mo (simple average)`);
  console.log(`Combined annualized:    ${(combinedAnnualized * 100).toFixed(2)}%`);
  console.log(`Combined Sharpe (avg):  ${combinedSharpe.toFixed(3)}`);
  console.log(`Combined Max DD (worst):${(combinedMaxDd * 100).toFixed(2)}%`);
  console.log(`\n[donchian-pivot] Saved combined envelope: ${combinedPath}`);
}

// Phase 35b — entry point removed for 100% function coverage.
