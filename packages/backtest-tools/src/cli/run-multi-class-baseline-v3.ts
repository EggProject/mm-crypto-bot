#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-multi-class-baseline-v3.ts —
// Phase 8 M2 V3 multi-class ensemble baseline CLI runner.
//
// ===========================================================================
// 1:10 MANDATORY LEVERAGE CONSTRAINT (HARD USER DIRECTIVE)
// ===========================================================================
// Project-wide mandate: every trade uses EXACTLY 1:10 leverage (10× notional
// on 1× capital, 9× borrowed from bybit.eu SPOT margin). 1× is permitted
// ONLY as the backtest baseline for scaling-curve comparison. All other
// leverage values (2/3/5/7/etc.) are REJECTED at parse time.
//
// V3 Ensemble architecture:
//   1. DonchianMtfStrategy (Track F) — PRIMARY directional signal (long-only,
//      3-tier MTF, 1h/4h/1d, 1.5× ATR SL / 3.0× ATR TP, 168h max-hold).
//   2. FundingCarryTimingStrategy (Track E) — REGIME TIMING gate (rolling
//      30d funding-rate stats, entry > p75, exit < median, 72h cooldown).
//   3. FundingCarryLeverageStrategy (Track D) — CARRY MECHANICS (VaR-capped
//      dynamic leverage, 1×..10× range, 1:10 mandate default).
//   4. VolTargetedSizer (Track G) — INVERSE-VOL POSITION SIZING (Moreira-Muir
//      rule, 30d window, target 2% daily, [0.25, 1.0] clamp on multiplier).
//
// No double-counting:
//   - The engine sees ONE signal per candle (the MTF signal from Track F).
//   - The carry side accrues funding externally (driven by FundingCarryTiming
//     state machine + recordFundingSnapshot calls).
//   - The effective carry leverage is Track D max × Track G multiplier
//     (defensive MIN).
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v3.ts
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v3.ts --symbol=BTC/USDT --ltf-timeframe=1h --timeframe=1d
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v3.ts --output=backtest-results/baseline-multi-class-v3-btc-1d.json
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v3.ts --leverage=10 --vol-target=0.02 --entry-pctl=0.75
//
// References:
//   - docs/research/REPORT-phase7.md (V2 reference architecture)
//   - docs/research/phase8-carry-leverage-1-10.md (Track D)
//   - docs/research/phase8-funding-timing.md (Track E)
//   - docs/research/phase8-1h-mtf-donchian.md (Track F)
//   - docs/research/phase8-vol-targeted-sizing.md (Track G)

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import {
  runBacktest,
  type BacktestResult,
  type CostModel,
} from "@mm-crypto-bot/backtest";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";
import {
  computeVolTargetedSizer,
  DEFAULT_VOL_TARGET_CONFIG,
  MultiClassEnsembleV3,
  type DailyOhlcv,
  type MultiClassEnsembleV3Config,
  type Strategy,
  type StrategyContext,
  type VolTargetConfig,
  type VolTargetPoint,
} from "@mm-crypto-bot/core";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly ltfTimeframe: Timeframe;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly leverage: 1 | 10;
  readonly volTarget: number;
  readonly entryPctl: number;
  readonly exitPctl: number;
  readonly windowDays: number;
  readonly cooldownHours: number;
  readonly baseNotionalUsd: number;
  readonly dataDir: string;
  readonly outputPath: string;
}

/**
 * `parseAndValidateLeverage` — HARD GUARDRAIL. The user has mandated
 * project-wide 1:10 leverage. Accept only 1 (baseline) or 10 (1:10).
 */
function parseAndValidateLeverage(raw: string): 1 | 10 {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `[V3-MULTI-CLASS] HARD CONSTRAINT VIOLATION: --leverage=${raw} is not a valid integer. ` +
        `User-mandated 1:10 leverage — only values 1 or 10 are accepted. Refusing to run.`,
    );
  }
  if (parsed !== 1 && parsed !== 10) {
    throw new Error(
      `[V3-MULTI-CLASS] HARD CONSTRAINT VIOLATION: --leverage=${parsed} is NOT allowed. ` +
        `User-mandated 1:10 leverage — only values 1 (baseline) or 10 (1:10 mandatory) are accepted. ` +
        `Refusing to run.`,
    );
  }
  return parsed;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let ltfTimeframe: Timeframe = "1h";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let leverage: 1 | 10 = 10; // 1:10 DEFAULT (user-mandated)
  let volTarget = 0.02;
  let entryPctl = 0.75;
  let exitPctl = 0.5;
  let windowDays = 30;
  let cooldownHours = 72;
  let baseNotionalUsd = 10_000;
  let dataDir = "data/ohlcv";
  let outputPath = "";
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--ltf-timeframe=")) {
      const tf = arg.slice("--ltf-timeframe=".length) as Timeframe;
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`Invalid ltf-timeframe: ${tf}`);
      }
      ltfTimeframe = tf;
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`Invalid timeframe: ${tf}`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--leverage=")) {
      leverage = parseAndValidateLeverage(arg.slice("--leverage=".length));
    } else if (arg.startsWith("--vol-target=")) {
      volTarget = Number(arg.slice("--vol-target=".length));
    } else if (arg.startsWith("--entry-pctl=")) {
      entryPctl = Number(arg.slice("--entry-pctl=".length));
    } else if (arg.startsWith("--exit-pctl=")) {
      exitPctl = Number(arg.slice("--exit-pctl=".length));
    } else if (arg.startsWith("--window-days=")) {
      windowDays = Number(arg.slice("--window-days=".length));
    } else if (arg.startsWith("--cooldown-hours=")) {
      cooldownHours = Number(arg.slice("--cooldown-hours=".length));
    } else if (arg.startsWith("--notional=")) {
      baseNotionalUsd = Number(arg.slice("--notional=".length));
    } else if (arg.startsWith("--data-dir=")) {
      dataDir = arg.slice("--data-dir=".length);
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-multi-class-v3-${symbolLower}-${timeframe}.json`;
  }
  return {
    symbol,
    ltfTimeframe,
    timeframe,
    initialEquity,
    leverage,
    volTarget,
    entryPctl,
    exitPctl,
    windowDays,
    cooldownHours,
    baseNotionalUsd,
    dataDir,
    outputPath,
  };
}

// ---------------------------------------------------------------------------
// OHLCV loader (for vol-target computation)
// ---------------------------------------------------------------------------

interface DailyOhlcvRow {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * `loadDailyOhlcvCsv` — read a daily OHLCV CSV from data/ohlcv/ for the
 * given symbol. Used to compute the Track G vol-target multiplier series.
 */
async function loadDailyOhlcvCsv(
  dataDir: string,
  symbol: string,
): Promise<readonly DailyOhlcvRow[]> {
  const symLower = symbol.split("/")[0]!.toLowerCase();
  const path = resolve(dataDir, `binance_${symLower}_1d.csv`);
  const raw = await readFile(path, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: DailyOhlcvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const parts = line.split(",");
    const ts = Number(parts[0]);
    const open = Number(parts[1]);
    const high = Number(parts[2]);
    const low = Number(parts[3]);
    const close = Number(parts[4]);
    const volume = Number(parts[5]);
    if (
      !Number.isFinite(ts) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }
    out.push({ timestamp: ts, open, high, low, close, volume });
  }
  return out;
}

/**
 * `buildVolTargetConfig` — construct the VolTargetConfig with the
 * user-specified target daily vol. The window, clamps, and annualization
 * factor come from DEFAULT_VOL_TARGET_CONFIG (Track G defaults).
 */
function buildVolTargetConfig(targetDailyVol: number): VolTargetConfig {
  return {
    ...DEFAULT_VOL_TARGET_CONFIG,
    targetDailyVol,
  };
}

// ---------------------------------------------------------------------------
// Funding CSV loader
// ---------------------------------------------------------------------------

interface FundingSnapshotCsv {
  readonly timestamp: number;
  readonly symbol: string;
  readonly fundingRate: number;
}

/**
 * `loadFundingCsv` — read the historical funding-rate CSV.
 * Format: `timestamp,symbol,fundingRate` (matches Track E's CLI runner).
 */
async function loadFundingCsv(
  dataDir: string,
  symbol: string,
): Promise<readonly FundingSnapshotCsv[]> {
  const symLower = symbol.split("/")[0]!.toLowerCase();
  const path = resolve(dataDir, "..", "funding", `binance_${symLower}usdt_funding_8h.csv`);
  const raw = await readFile(path, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: FundingSnapshotCsv[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const parts = line.split(",");
    const ts = Number(parts[0]);
    const sym = parts[1] ?? symbol;
    const rate = Number(parts[2]);
    if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
    out.push({ timestamp: ts, symbol: sym, fundingRate: rate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vol-target multiplier series lookup
// ---------------------------------------------------------------------------

/**
 * `buildVolTargetLookup` — pre-compute the daily vol-target multiplier
 * series for the backtest window, then expose a `lookupByTimestamp()`
 * function for the runBacktest loop to use.
 *
 * Returns the multiplier, defaulting to 1.0 (no scaling) for dates
 * outside the multiplier series window.
 */
function buildVolTargetLookup(
  dailyOhlcv: readonly DailyOhlcvRow[],
  volTargetConfig: VolTargetConfig,
  baseNotionalUsd: number,
): { readonly lookup: (tsMs: number) => number; readonly series: VolTargetPoint[] } {
  const ohlcv: DailyOhlcv[] = dailyOhlcv.map((r) => ({
    timestamp: r.timestamp,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
  const result = computeVolTargetedSizer(ohlcv, baseNotionalUsd, volTargetConfig);
  // Index the dailySeries by timestamp for O(1) lookup.
  const byTs = new Map<number, number>();
  for (const point of result.dailySeries) {
    byTs.set(point.day, point.clampedVolMultiplier);
  }
  const DAY_MS = 86_400_000;
  const lookup = (tsMs: number): number => {
    // Snap to UTC midnight.
    const dayTs = Math.floor(tsMs / DAY_MS) * DAY_MS;
    return byTs.get(dayTs) ?? 1.0;
  };
  return { lookup, series: [...result.dailySeries] };
}

// ---------------------------------------------------------------------------
// Multiplier-injection wrapper strategy
// ---------------------------------------------------------------------------

/**
 * `VolTargetInjectingStrategy` — a thin wrapper around the V3 ensemble
 * that injects the Track G vol-target multiplier BEFORE each candle
 * call. The wrapper is a Strategy itself so the engine can use it as a
 * drop-in for `runBacktest({ strategy: ... })`.
 *
 * All other Strategy methods are delegated to the wrapped ensemble.
 */
class VolTargetInjectingStrategy implements Strategy {
  readonly name: string;
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly ensemble: MultiClassEnsembleV3;
  private readonly volTargetLookup: (tsMs: number) => number;

  constructor(
    ensemble: MultiClassEnsembleV3,
    volTargetLookup: (tsMs: number) => number,
  ) {
    this.ensemble = ensemble;
    this.volTargetLookup = volTargetLookup;
    this.name = `VolTargetInjecting(${ensemble.name})`;
  }

  warmup(): number {
    return this.ensemble.warmup();
  }

  onCandle(ctx: StrategyContext) {
    // Inject the multiplier for this candle's timestamp BEFORE the
    // ensemble's onCandle runs.
    const mult = this.volTargetLookup(ctx.candle.timestamp);
    this.ensemble.setVolTargetMultiplier(mult);
    return this.ensemble.onCandle(ctx);
  }

  onOpenPositionUpdate(ctx: unknown) {
    return this.ensemble.onOpenPositionUpdate(
      ctx as Parameters<MultiClassEnsembleV3["onOpenPositionUpdate"]>[0],
    );
  }

  onPositionOpened(snap: unknown) {
    this.ensemble.onPositionOpened(
      snap as Parameters<MultiClassEnsembleV3["onPositionOpened"]>[0],
    );
  }

  onPositionClosed(reason: string) {
    this.ensemble.onPositionClosed(reason);
  }
}

// ---------------------------------------------------------------------------
// Parallel carry simulation
// ---------------------------------------------------------------------------

/**
 * `simulateFundingCarryTiming` — drive the V3 ensemble's FundingCarryTiming
 * state machine against the funding CSV. Returns the cumulative funding
 * collected and timing-state metadata.
 *
 * This is run IN PARALLEL with the directional backtest (the directional
 * backtest drives the V3 ensemble's `onCandle` for MTF signals, but the
 * CLI also drives `recordFundingSnapshot` here for the carry state).
 *
 * Note: the engine's runBacktest also calls `ensemble.onCandle()` for
 * each candle. That call invokes the FundingCarryTiming's onCandle too,
 * which means the timing state advances via the candle loop as well.
 * For funding-period bookkeeping, however, we explicitly call
 * `recordFundingSnapshot()` here to make sure every 8h funding point
 * is captured (the engine only calls `onCandle` per LTF candle).
 */
function simulateFundingCarryTiming(
  ensemble: MultiClassEnsembleV3,
  fundingSnapshots: readonly FundingSnapshotCsv[],
  startTimeMs: number,
  endTimeMs: number,
): {
  fundingCollectedUsd: number;
  fundingSnapshotsApplied: number;
  fundingSnapshotsSkipped: number;
  fundingPayments: readonly { timestamp: number; payment: number }[];
} {
  const fundingPayments: { timestamp: number; payment: number }[] = [];
  let fundingCollectedUsd = 0;
  let applied = 0;
  let skipped = 0;
  for (const snap of fundingSnapshots) {
    if (snap.timestamp < startTimeMs || snap.timestamp > endTimeMs) continue;
    const payment = ensemble.recordFundingSnapshot(snap.timestamp, snap.fundingRate);
    fundingPayments.push({ timestamp: snap.timestamp, payment });
    if (payment !== 0) applied++;
    else skipped++;
    fundingCollectedUsd = ensemble.fundingCarryTiming.state.fundingCollectedUsd;
  }
  return {
    fundingCollectedUsd,
    fundingSnapshotsApplied: applied,
    fundingSnapshotsSkipped: skipped,
    fundingPayments,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  // 1) Load OHLCV feed.
  const dataDirAbs = resolve(import.meta.dir, "..", "..", "..", "..", args.dataDir);
  const feed = new CsvExchangeFeed(dataDirAbs) as unknown as ExchangeFeed;

  // 2) Load daily OHLCV for vol-target series.
  const dailyOhlcv = await loadDailyOhlcvCsv(dataDirAbs, args.symbol);

  // 3) Load funding CSV for parallel carry simulation.
  const fundingSnapshots = await loadFundingCsv(dataDirAbs, args.symbol);

  // 4) Build the vol-target config + lookup.
  const volTargetConfig = buildVolTargetConfig(args.volTarget);
  const { lookup: volTargetLookup, series: volTargetSeries } = buildVolTargetLookup(
    dailyOhlcv,
    volTargetConfig,
    args.baseNotionalUsd,
  );

  // 5) Compute Track G aggregated stats (avgMultiplier, etc.) for the report.
  const volTargetSummary = computeVolTargetedSizer(
    dailyOhlcv.map((r) => ({
      timestamp: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    })),
    args.baseNotionalUsd,
    volTargetConfig,
  );

  // 6) Build the V3 ensemble config.
  const config: MultiClassEnsembleV3Config = {
    donchianMtf: {
      leverage: args.leverage,
    },
    fundingCarryTiming: {
      baseNotionalUsd: args.baseNotionalUsd,
      timingLeverage: args.leverage,
      windowDays: args.windowDays,
      entryPercentile: args.entryPctl,
      exitPercentile: args.exitPctl,
      cooldownHours: args.cooldownHours,
    },
    fundingCarryLeverage: {
      baseNotionalUsd: args.baseNotionalUsd,
      maxLeverage: args.leverage,
      minLeverage: 1,
    },
    volTargetedSizer: volTargetConfig,
  };

  // 7) Wrap the ensemble for vol-target injection.
  const ensemble = new MultiClassEnsembleV3(config);
  const wrapperStrategy = new VolTargetInjectingStrategy(ensemble, volTargetLookup);

  // 8) Compute the recommended risk-per-trade from vol-target avg multiplier.
  const avgMult = volTargetSummary.avgVolMultiplier;
  const recommendedMaxPositionPctEquity = 0.2 * avgMult; // 20% × avg multiplier
  ensemble.setRecommendedMaxPositionPctEquity(recommendedMaxPositionPctEquity);

  // 9) Run directional backtest with the V3 wrapper.
  const costModel: CostModel = {
    takerFeeRate: 0.001,
    slippageRate: 0.0005,
    spreadRate: 0.0002,
    borrowRatePerHour: 0.0001,
    fundingRatePer8h: 0,
  };
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date(Date.UTC(2026, 6, 1)); // through mid-2026
  const result: BacktestResult = await runBacktest({
    symbol: makeSymbol(args.symbol),
    htfTimeframe: "1d",
    mtfTimeframe: "4h",
    ltfTimeframe: args.ltfTimeframe,
    startTime,
    endTime,
    initialEquityUsd: args.initialEquity,
    feed,
    costModel,
    positionSize: {
      riskPerTrade: 0.01 * avgMult, // 1% × avg multiplier (Track G scaled)
      kellyFraction: avgMult,
      maxDrawdown: 0.5,
      maxPositionPctEquity: recommendedMaxPositionPctEquity,
      minPositionPctEquity: 0.01,
    },
    strategy: wrapperStrategy,
  });

  // 10) Run parallel carry simulation on the funding CSV.
  const carrySim = simulateFundingCarryTiming(
    ensemble,
    fundingSnapshots,
    startTime.getTime(),
    endTime.getTime(),
  );

  // 11) Compute combined edge.
  const directionalPnlUsd = result.totalReturn * args.initialEquity;
  const carryPnlUsd = carrySim.fundingCollectedUsd;
  const totalPnlUsd = directionalPnlUsd + carryPnlUsd;
  const totalReturnPct = (totalPnlUsd / args.initialEquity) * 100;
  // 30 months in our 2024-01 → 2026-07 backtest window.
  const totalMonths = 30;
  const monthlyReturnPct = totalReturnPct / totalMonths;
  const annualizedReturnPct = (totalReturnPct / 30) * 12; // approximation
  const annualizedSharpe = result.sharpeRatio * Math.sqrt(252);

  // 12) Trade-by-exit-reason breakdown.
  const tradesByReason: Record<string, number> = {};
  for (const t of result.trades) {
    const reason: string = t.exitReason;
    tradesByReason[reason] = (tradesByReason[reason] ?? 0) + 1;
  }

  // 13) Build carry-component % contribution.
  const carryComponentPct = totalPnlUsd === 0 ? 0 : (carryPnlUsd / totalPnlUsd) * 100;

  // 14) Final ensemble state (after carry sim).
  const finalState = ensemble.getState();

  // 15) Write output JSON.
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: 8,
      milestone: "M2",
      track: "V3-multi-class-ensemble",
      symbol: args.symbol,
      ltfTimeframe: args.ltfTimeframe,
      timeframe: args.timeframe,
      initialEquityUsd: args.initialEquity,
    },
    config: {
      leverage: args.leverage,
      volTarget: args.volTarget,
      entryPctl: args.entryPctl,
      exitPctl: args.exitPctl,
      windowDays: args.windowDays,
      cooldownHours: args.cooldownHours,
      baseNotionalUsd: args.baseNotionalUsd,
      maxDailyVarPct: 0.02,
      varConfidence: 0.95,
    },
    result: {
      trades: result.trades.length,
      totalPnlUsd: directionalPnlUsd,
      totalReturnPct: result.totalReturn * 100,
      maxDrawdownPct: result.maxDrawdown * 100,
      sharpeRatio: result.sharpeRatio,
      winRate: result.winRate,
      totalTrades: result.totalTrades,
      killSwitchTriggered: result.killSwitchTriggered,
    },
    tradesByReason,
    volTargetedSizer: {
      config: volTargetConfig,
      avgMultiplier: volTargetSummary.avgVolMultiplier,
      avgRealizedDailyVol: volTargetSummary.avgRealizedDailyVol,
      avgRealizedAnnualizedVol: volTargetSummary.avgRealizedAnnualizedVol,
      lowerClampFraction: volTargetSummary.lowerClampFraction,
      upperClampFraction: volTargetSummary.upperClampFraction,
      middleFraction: volTargetSummary.middleFraction,
      totalDays: volTargetSummary.dailySeries.length,
      recommendedMaxPositionPctEquity,
    },
    ensembleState: {
      ...finalState,
      fundingCarryUsd: carryPnlUsd,
      fundingCarryEntries: finalState.fundingCarryEntries,
      fundingCarryTimeInCarryFraction: finalState.fundingCarryTimeInCarryFraction,
    },
    carryContribution: {
      fundingCollectedUsd: carryPnlUsd,
      fundingSnapshotsApplied: carrySim.fundingSnapshotsApplied,
      fundingSnapshotsSkipped: carrySim.fundingSnapshotsSkipped,
      effectiveCarryLeverage: finalState.effectiveCarryLeverage,
      avgFundingRate8h: fundingSnapshots.length === 0
        ? 0
        : fundingSnapshots.reduce((acc, s) => acc + s.fundingRate, 0) / fundingSnapshots.length,
    },
    combinedEdge: {
      totalPnlUsd,
      directionalPnlUsd,
      carryPnlUsd,
      totalReturnPct,
      monthlyReturnPct,
      sharpe: annualizedSharpe,
      maxDrawdownPct: result.maxDrawdown * 100,
      annualizedReturnPct,
      carryComponentPct,
    },
    volTargetSeries: {
      firstFew: volTargetSeries.slice(0, 5).map((p) => ({
        day: p.day,
        realizedDailyVol: p.realizedDailyVol,
        clampedVolMultiplier: p.clampedVolMultiplier,
      })),
      lastFew: volTargetSeries.slice(-5).map((p) => ({
        day: p.day,
        realizedDailyVol: p.realizedDailyVol,
        clampedVolMultiplier: p.clampedVolMultiplier,
      })),
    },
  };

  await Bun.write(args.outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({
    symbol: args.symbol,
    timeframe: args.timeframe,
    trades: result.trades.length,
    directionalPnlUsd: Number(directionalPnlUsd.toFixed(2)),
    carryPnlUsd: Number(carryPnlUsd.toFixed(2)),
    totalReturnPct: Number(totalReturnPct.toFixed(3)),
    monthlyReturnPct: Number(monthlyReturnPct.toFixed(3)),
    sharpe: Number(annualizedSharpe.toFixed(3)),
    maxDdPct: Number((result.maxDrawdown * 100).toFixed(3)),
    avgVolMultiplier: Number(volTargetSummary.avgVolMultiplier.toFixed(4)),
    effectiveCarryLeverage: finalState.effectiveCarryLeverage,
    timeInCarryFraction: Number(finalState.fundingCarryTimeInCarryFraction.toFixed(4)),
    donchianSignalsEmitted: finalState.donchianSignalsEmitted,
    donchianTimeExitCloses: finalState.donchianTimeExitCloses,
    carryEntries: finalState.fundingCarryEntries,
    fundingSnapshotsApplied: carrySim.fundingSnapshotsApplied,
    fundingSnapshotsSkipped: carrySim.fundingSnapshotsSkipped,
    carryComponentPct: Number(carryComponentPct.toFixed(2)),
    dailyVaR95Pct: Number(finalState.dailyVaR95Pct.toFixed(4)),
    liquidationEvents: finalState.liquidationEvents,
  }, null, 2));
  console.log(`Wrote: ${args.outputPath}`);
}

main().catch((err: unknown) => {
  console.error("FATAL:", err);
  process.exit(1);
});