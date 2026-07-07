#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-funding-rate-carry-composition.ts —
// Phase 22 Track B — Funding-rate carry composition runner.
//
// ===========================================================================
// PHASE 22 TRACK B — FUNDING-RATE CARRY COMPOSITION CLI RUNNER
// ===========================================================================
//
// Wraps Phase 22 Track A `FundingRateCarryComposition` (Donchian + Pivot +
// Funding-Rate Carry, 3-source consensus) in a CLI that produces a
// backtest JSON mirroring the Phase 18-19 Donchian+Pivot runner shape.
//
// This is a NEW runner — it does NOT modify the existing
// `run-donchian-pivot-composition.ts` (Phase 19 #1 baseline runner, which
// must remain bit-identical). Track B owns its own runner because the
// composition is a strict superset of the DP composition and would
// silently no-op if added as a flag to the existing runner (Phase 20 #1
// lesson: parse-and-print ≠ engage).
//
// Why a NEW runner, not a flag on the existing one?
// --------------------------------------------------
// Phase 20 #1 (PR #49) was rejected because the `--use-per-trade-kelly`
// flag was parsed and printed but the underlying runner never read it
// — silent no-op. Track B MUST demonstrate NOT-silent-no-op by having a
// dedicated runner where the funding-rate ON path is structurally
// different from the OFF path (different strategy class, different
// initialization, different signal emit). Adding a flag to the existing
// runner would invite the same parse-and-print failure mode.
//
// CLI flags
// ---------
//   --symbol=BTC/USDT|ETH/USDT|SOL/USDT     (required, default BTC/USDT)
//   --timeframe=15m                          (required, must be 15m for now)
//   --min-consensus=1|2                      (default 1, Phase 19 #1 1-of-2 mode)
//   --max-position-pct-equity=0.04|...|0.15  (default 0.12, Phase 19 #1 primary)
//   --enable-funding-rate-carry=true|false   (default false)
//   --funding-rate-mode=2of3|1of3            (default 2of3 STRICT)
//   --funding-rate-csv-path=<path>           (required when enable-funding-rate-carry=true)
//   --output=<path>                          (required, where to write JSON)
//
// NOT-silent-no-op defense
// ------------------------
// When `--enable-funding-rate-carry=true`, the runner prints the funding-
// rate distribution (`funding-rate carry engaged; mode=<2of3|1of3>;
// bars=<N>; funding-distribution=positive:X%, negative:Y%, neutral:Z%`)
// BEFORE invoking `runBacktest`. This is the Phase 20 #1 lesson applied:
// the user can grep stdout to verify the carry is actually loaded.
//
// Hard-error semantics
// --------------------
// `--enable-funding-rate-carry=true` WITHOUT `--funding-rate-csv-path`
// → throws (NOT silent no-op).
// `--enable-funding-rate-carry=true` WITH non-existent CSV file → throws.
//
// Default path (`--enable-funding-rate-carry=false`)
// --------------------------------------------------
// Builds the wrapped `DonchianPivotComposition` (no feed). This is the
// Phase 19 #1 baseline path — bit-identical to the existing
// `run-donchian-pivot-composition.ts` runner for `--min-consensus=1`.
//
// References:
//   - packages/core/src/strategy/funding-rate-carry-composition.ts (Track A)
//   - packages/backtest-tools/src/data/csv-funding-rate-feed.ts (Track A)
//   - packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts (Phase 19 #1 baseline)
//   - docs/research/PHASE-20-21-ARCHIVE.md §6 (NOT-silent-no-op defense)
//   - docs/research/phase22-scope-plan.md (Phase 22 architecture)

import { resolve } from "node:path";
import { stat } from "node:fs/promises";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { CsvFundingRateFeed } from "../data/csv-funding-rate-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import {
  DonchianPivotComposition,
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
  FundingRateCarryComposition,
  type ConsensusMode,
} from "@mm-crypto-bot/core";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

// ---------------------------------------------------------------------------
// CLI arg types + parsing
// ---------------------------------------------------------------------------

/**
 * `CliArgs` — strongly-typed CLI arg shape after parsing.
 *
 * `enableFundingRateCarry` gates whether the funding-rate-carry composition
 * path is engaged. When false, the runner uses the bare
 * `DonchianPivotComposition` (Phase 19 #1 baseline path).
 */
export interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly minConsensus: number;
  readonly maxPositionPctEquity: number;
  readonly enableFundingRateCarry: boolean;
  readonly fundingRateMode: ConsensusMode;
  readonly fundingRateCsvPath: string | null;
  readonly outputPath: string;
}

/**
 * `parseArgs` — minimal CLI parser. Throws on:
 *   - invalid `--min-consensus` (must be 1 or 2)
 *   - invalid `--max-position-pct-equity` (must be in (0, 0.5])
 *   - invalid `--enable-funding-rate-carry` (must be "true" or "false")
 *   - invalid `--funding-rate-mode` (must be "2of3" or "1of3")
 *
 * Does NOT enforce the funding-rate CSV path / existence — that is the
 * responsibility of `main()` after parsing (so error messages can be more
 * diagnostic and the parser stays single-purpose).
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv;
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "15m";
  let initialEquity = 10_000;
  let minConsensus = 1;
  // Phase 19 #1 primary cap. Override via `--max-position-pct-equity=<pct>`.
  let maxPositionPctEquity = 0.12;
  let enableFundingRateCarry = false;
  let fundingRateMode: ConsensusMode = "2of3";
  let fundingRateCsvPath: string | null = null;
  let outputPath = "backtest-results/phase22-funding-rate-carry-btc-15m.json";
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      if (tf !== "15m") {
        throw new Error(`funding-rate-carry composition requires 15m timeframe, got: ${tf}`);
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
    } else if (arg.startsWith("--enable-funding-rate-carry=")) {
      const v = arg.slice("--enable-funding-rate-carry=".length);
      if (v !== "true" && v !== "false") {
        throw new Error(`--enable-funding-rate-carry must be "true" or "false", got: ${v}`);
      }
      enableFundingRateCarry = v === "true";
    } else if (arg.startsWith("--funding-rate-mode=")) {
      const v = arg.slice("--funding-rate-mode=".length);
      if (v !== "2of3" && v !== "1of3") {
        throw new Error(`--funding-rate-mode must be "2of3" or "1of3", got: ${v}`);
      }
      fundingRateMode = v;
    } else if (arg.startsWith("--funding-rate-csv-path=")) {
      fundingRateCsvPath = arg.slice("--funding-rate-csv-path=".length);
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return {
    symbol,
    timeframe,
    initialEquity,
    minConsensus,
    maxPositionPctEquity,
    enableFundingRateCarry,
    fundingRateMode,
    fundingRateCsvPath,
    outputPath,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `symbolToFileSymbol` — convert CCXT-style `BTC/USDT` to Binance-style
 * `BTCUSDT`. The CSV files use the Binance convention (no slash).
 *
 * Phase 22 scope: only `XXX/USDT` symbols are mapped. The mapping is
 * `replace("/", "")` + uppercase, e.g. `BTC/USDT` → `BTCUSDT`.
 */
function symbolToFileSymbol(ccxtSymbol: string): string {
  const upper = ccxtSymbol.toUpperCase();
  if (!upper.includes("/")) {
    return upper;
  }
  return upper.replace("/", "");
}

/**
 * `timeframesForComposition` — fixed mapping. Both Donchian+Pivot and
 * FundingRateCarry compositions are M15-native. Future-proofing for M5
 * is out of scope for Phase 22.
 */
function timeframesForComposition(ltf: Timeframe): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
  if (ltf === "15m") return { htf: "1d", mtf: "4h", ltf: "15m" };
  throw new Error(`funding-rate-carry composition supports 15m only, got: ${ltf as string}`);
}

/**
 * `computeFundingRateDistribution` — scan the loaded feed's entries and
 * bucket them by sign (positive / negative / neutral). Used for the
 * NOT-silent-no-op defense line printed BEFORE the backtest runs.
 *
 * The neutral bucket is `|fundingRate| ≤ 0.0001` (matches the composition
 * default threshold — at exactly 1 bp the carry abstains).
 */
function computeFundingRateDistribution(
  feed: CsvFundingRateFeed,
  threshold: number,
): { readonly positive: number; readonly negative: number; readonly neutral: number; readonly total: number } {
  const history = feed.getFundingRateHistory(0, Number.MAX_SAFE_INTEGER);
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  for (const entry of history) {
    if (Math.abs(entry.fundingRate) <= threshold) neutral += 1;
    else if (entry.fundingRate > 0) positive += 1;
    else negative += 1;
  }
  return { positive, negative, neutral, total: history.length };
}

/**
 * `assertCsvExists` — defensive check BEFORE invoking
 * `CsvFundingRateFeed.load`. The load function already throws on missing
 * files, but the message is "ENOENT" which is less helpful than our
 * CLI-context error. We pre-check to give the user a clear pointer to
 * which file is missing and the rationale (NOT-silent-no-op defense).
 */
async function assertCsvExists(csvPath: string): Promise<void> {
  const resolved = resolve(csvPath);
  try {
    const s = await stat(resolved);
    if (!s.isFile()) {
      throw new Error(
        `--funding-rate-csv-path '${resolved}' exists but is not a regular file (NOT-silent-no-op defense)`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("NOT-silent-no-op")) {
      throw err;
    }
    // ENOENT or other fs error — wrap with CLI context. Preserve the
    // original error via `cause` (typescript-eslint
    // `preserve-caught-error` + ES2022 Error.cause convention).
    const originalMessage = err instanceof Error ? err.message : String(err);
    throw new Error(
      `--funding-rate-csv-path '${resolved}' does not exist or is unreadable: ${originalMessage} (Phase 20 NOT-silent-no-op defense)`,
      { cause: err },
    );
  }
}

/**
 * `buildComposition` — the central factory. Branches on
 * `args.enableFundingRateCarry` to construct the wrapped
 * `DonchianPivotComposition` (off) or the superset
 * `FundingRateCarryComposition` (on). The returned strategy is an
 * instance of `Strategy` — duck typing for `runBacktest()`.
 *
 * NOT-silent-no-op: when the carry is on, prints the funding-rate
 * distribution line BEFORE returning (Phase 20 #1 defense).
 */
async function buildComposition(args: CliArgs): Promise<{
  readonly strategy: DonchianPivotComposition | FundingRateCarryComposition;
  readonly strategyKind: "donchian-pivot" | "funding-rate-carry";
}> {
  if (!args.enableFundingRateCarry) {
    console.log(`[funding-rate-carry] OFF — bare Donchian+Pivot composition (Phase 19 #1 baseline path)`);
    const strategy = new DonchianPivotComposition(
      { ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG, minConsensus: args.minConsensus },
      "15m",
    );
    return { strategy, strategyKind: "donchian-pivot" };
  }

  // Funding-rate-carry ON path — Phase 20 NOT-silent-no-op defense.
  if (args.fundingRateCsvPath === null || args.fundingRateCsvPath === "") {
    throw new Error(
      "--enable-funding-rate-carry=true requires --funding-rate-csv-path=<path> (Phase 20 NOT-silent-no-op defense)",
    );
  }
  await assertCsvExists(args.fundingRateCsvPath);

  const fileSymbol = symbolToFileSymbol(args.symbol);
  const feed = await CsvFundingRateFeed.load({
    csvPath: args.fundingRateCsvPath,
    symbol: fileSymbol,
  });
  const dist = computeFundingRateDistribution(feed, 0.0001);
  const pct = (n: number): string => (dist.total === 0 ? "0.0" : ((100 * n) / dist.total).toFixed(1));
  // Phase 20 #1 lesson — print the effective settings + observable side
  // effects BEFORE running the backtest. The user can grep stdout for
  // "funding-rate carry engaged" to confirm the carry is engaged.
  console.log(
    `funding-rate carry engaged; mode=${args.fundingRateMode}; bars=${dist.total}; ` +
      `funding-distribution=positive:${pct(dist.positive)}%, negative:${pct(dist.negative)}%, neutral:${pct(dist.neutral)}%`,
  );
  console.log(
    `[funding-rate-carry] ON — Donchian+Pivot+FundingRateCarry composition, feed symbol=${fileSymbol}, csv=${args.fundingRateCsvPath}`,
  );

  const strategy = new FundingRateCarryComposition(
    {
      donchianPivotConfig: {
        ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
        minConsensus: args.minConsensus,
      },
      fundingRateFeed: feed,
      consensusMode: args.fundingRateMode,
      fundingRateThreshold: 0.0001,
      hysteresisBars: 2,
      warmupCarryBars: 1,
    },
    "15m",
  );
  return { strategy, strategyKind: "funding-rate-carry" };
}

// ---------------------------------------------------------------------------
// Backtest + report
// ---------------------------------------------------------------------------

// bybit.eu SPOT 1:10 leverage cost model — matches Phase 17 fixed engine baseline.
const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

/**
 * `runOnce` — execute a single backtest. Exported for integration tests.
 */
export async function runOnce(args: CliArgs): Promise<{
  readonly result: BacktestResult;
  readonly monthlyReturn: number;
  readonly totalMonths: number;
  readonly strategyKind: "donchian-pivot" | "funding-rate-carry";
}> {
  const tf = timeframesForComposition(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;
  const { strategy, strategyKind } = await buildComposition(args);

  // 2024-01-01 → today (matches Phase 18-19 runner).
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(
    `[funding-rate-carry] symbol=${args.symbol} ltf=${args.timeframe} minConsensus=${args.minConsensus} maxPositionPctEquity=${args.maxPositionPctEquity}`,
  );
  console.log(`[funding-rate-carry] timeframes: htf=${tf.htf} mtf=${tf.mtf} ltf=${tf.ltf}`);
  console.log(`[funding-rate-carry] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);
  console.log(`[funding-rate-carry] initial equity: $${args.initialEquity}`);

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

  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn = result.totalReturn > 0 ? Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1 : 0;
  return { result, monthlyReturn, totalMonths, strategyKind };
}

/**
 * `printReport` — print a human-readable summary to stdout. Exported for
 * integration tests (which capture stdout via `Bun.spawn`).
 */
export function printReport(
  args: CliArgs,
  result: BacktestResult,
  monthlyReturn: number,
  totalMonths: number,
  strategyKind: "donchian-pivot" | "funding-rate-carry",
): void {
  const wins = result.trades.filter((t) => t.pnlUsd > 0);
  const losses = result.trades.filter((t) => t.pnlUsd < 0);
  const winRate = result.trades.length > 0 ? wins.length / result.trades.length : 0;
  const carryTag = args.enableFundingRateCarry ? `+carry ${args.fundingRateMode}` : "no-carry";
  console.log(
    `\n=== RESULTS funding-rate-carry ${carryTag} ${args.symbol} ${args.timeframe} strategy=${strategyKind} ===`,
  );
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
}

/**
 * `main` — CLI entry point. Orchestrates parseArgs → runOnce →
 * printReport → write JSON. NOT exported (CLI-only).
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { result, monthlyReturn, totalMonths, strategyKind } = await runOnce(args);
  printReport(args, result, monthlyReturn, totalMonths, strategyKind);

  const fs = await import("node:fs/promises");
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(
    resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath),
    JSON.stringify(
      {
        args,
        strategy: "funding-rate-carry-composition",
        components: args.enableFundingRateCarry
          ? ["donchian-range", "pivot-grid", "funding-rate-carry"]
          : ["donchian-range", "pivot-grid"],
        strategyKind,
        fundingRateMode: args.enableFundingRateCarry ? args.fundingRateMode : null,
        fundingRateCsvPath: args.enableFundingRateCarry ? args.fundingRateCsvPath : null,
        timeframe: timeframesForComposition(args.timeframe),
        monthlyReturn,
        totalMonths,
        result,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n[funding-rate-carry] Saved: ${args.outputPath}`);
}

main().catch((err: unknown) => {
  console.error("[funding-rate-carry] FATAL:", err);
  process.exit(1);
});