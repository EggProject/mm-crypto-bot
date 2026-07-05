#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-multi-class-baseline-v4.ts —
// Phase 9 M2 V4 multi-class ensemble baseline CLI runner.
//
// ===========================================================================
// 1:10 MANDATORY LEVERAGE CONSTRAINT (HARD USER DIRECTIVE)
// ===========================================================================
// Project-wide mandate: every trade uses EXACTLY 1:10 leverage (10× notional
// on 1× capital, 9× borrowed from bybit.eu SPOT margin). 1× is permitted
// ONLY as the backtest baseline for scaling-curve comparison. All other
// leverage values (2/3/5/7/etc.) are REJECTED at parse time.
//
// V4 Ensemble architecture (Phase 9 M2 = V3 + 9D + 9E):
//   1. DonchianMtfStrategy (Phase 8 Track F) — PRIMARY directional signal.
//      Long-only, 3-tier MTF, 1h/4h/1d, 1.5× ATR SL / 3.0× ATR TP, 168h max-hold.
//   2. FundingFlipKillSwitchStrategy (Phase 9 9D) — CARRY OVERLAY. Wraps
//      FundingCarryTimingStrategy (Track E) with a funding-flip regime
//      detector (7d sign-flip + 7d negative-dominance + 7d |rate| z-score).
//   3. FundingCarryLeverageStrategy (Phase 8 Track D) — CARRY MECHANICS
//      (VaR-capped dynamic leverage, 1×..10× range, 1:10 mandate default).
//   4. VolTargetedSizer (Phase 8 Track G) — INVERSE-VOL POSITION SIZING.
//      Multiplier ∈ [0.25, 1.0] under 1:10 mandate (Moreira-Muir "scale up"
//      half is structurally disabled).
//   5. AdaptiveKellyVolHybrid (Phase 9 9E) — POSITION SIZING. Pre-computed
//      from the trade list + daily OHLCV; effectivePositionFactor =
//      kellyFraction × volMultiplier. Drives recommendedMaxPositionPctEquity.
//
// No double-counting:
//   - The engine sees ONE signal per candle (the MTF signal from Track F).
//   - The carry side accrues funding externally (driven by FundingFlipKillSwitch
//     state machine + recordFundingSnapshot calls).
//   - The effective carry leverage is Track D max × Track G multiplier ×
//     Track 9E hybrid factor (defensive MIN, all clamped to [1, 10]).
//
// CLI flow (3 phases):
//   PHASE 1 — Baseline DonchianMTF backtest (0.5× static Kelly) produces
//             the trade list + equity curve.
//   PHASE 2 — Compute HybridSizerResult from baseline trades + daily OHLCV
//             (Adaptive Kelly bucket × VolTarget multiplier).
//   PHASE 3 — Final V4 backtest with hybrid sizing injected via
//             setHybridPositionFactor() before each candle.
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v4.ts
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v4.ts --symbol=BTC/USDT --ltf-timeframe=1h --timeframe=1d
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v4.ts --output=backtest-results/baseline-multi-class-v4-btc-1d.json
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v4.ts --leverage=10 --vol-target=0.02 --entry-pctl=0.75
//
// References:
//   - backtest-results/REPORT-phase8.md (V3 reference architecture)
//   - docs/research/phase9-funding-flip-kill-switch.md (Track 9D)
//   - docs/research/phase9-adaptive-kelly-vol-hybrid.md (Track 9E)

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
  computeHybridSizer,
  computeVolTargetedSizer,
  DEFAULT_VOL_TARGET_CONFIG,
  MultiClassEnsembleV4,
  type DailyOhlcv,
  type HybridSizerConfig,
  type HybridSizerResult,
  type MultiClassEnsembleV4Config,
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
  readonly baseKellyFraction: number;
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
      `[V4-MULTI-CLASS] HARD CONSTRAINT VIOLATION: --leverage=${raw} is not a valid integer. ` +
        `User-mandated 1:10 leverage — only values 1 or 10 are accepted. Refusing to run.`,
    );
  }
  if (parsed !== 1 && parsed !== 10) {
    throw new Error(
      `[V4-MULTI-CLASS] HARD CONSTRAINT VIOLATION: --leverage=${parsed} is NOT allowed. ` +
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
  let baseKellyFraction = 0.5;
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
    } else if (arg.startsWith("--base-kelly=")) {
      baseKellyFraction = Number(arg.slice("--base-kelly=".length));
    } else if (arg.startsWith("--data-dir=")) {
      dataDir = arg.slice("--data-dir=".length);
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-multi-class-v4-${symbolLower}-${timeframe}.json`;
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
    baseKellyFraction,
    dataDir,
    outputPath,
  };
}

// ---------------------------------------------------------------------------
// OHLCV loader (for vol-target + hybrid sizer computation)
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
 * given symbol. Used to compute the Track G vol-target multiplier series
 * and the Track 9E hybrid sizer.
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
  const byTs = new Map<number, number>();
  for (const point of result.dailySeries) {
    byTs.set(point.day, point.clampedVolMultiplier);
  }
  const DAY_MS = 86_400_000;
  const lookup = (tsMs: number): number => {
    const dayTs = Math.floor(tsMs / DAY_MS) * DAY_MS;
    return byTs.get(dayTs) ?? 1.0;
  };
  return { lookup, series: [...result.dailySeries] };
}

/**
 * `buildHybridFactorLookup` — pre-compute the per-day Track 9E hybrid
 * factor from the HybridSizerResult, exposed as a lookup by timestamp.
 */
function buildHybridFactorLookup(
  hybrid: HybridSizerResult,
): (tsMs: number) => number {
  const byTs = new Map<number, number>();
  for (const day of hybrid.days) {
    byTs.set(day.day, day.effectivePositionFactor);
  }
  const DAY_MS = 86_400_000;
  return (tsMs: number): number => {
    const dayTs = Math.floor(tsMs / DAY_MS) * DAY_MS;
    return byTs.get(dayTs) ?? hybrid.avgEffectivePositionFactor;
  };
}

// ---------------------------------------------------------------------------
// V4 wrapper strategy (injects vol-target + hybrid factor)
// ---------------------------------------------------------------------------

/**
 * `V4InjectingStrategy` — a thin wrapper around the V4 ensemble that
 * injects the Track G vol-target multiplier AND the Track 9E hybrid
 * position factor BEFORE each candle call. The wrapper is a Strategy
 * itself so the engine can use it as a drop-in for `runBacktest`.
 */
class V4InjectingStrategy implements Strategy {
  readonly name: string;
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly ensemble: MultiClassEnsembleV4;
  private readonly volTargetLookup: (tsMs: number) => number;
  private readonly hybridFactorLookup: (tsMs: number) => number;

  constructor(
    ensemble: MultiClassEnsembleV4,
    volTargetLookup: (tsMs: number) => number,
    hybridFactorLookup: (tsMs: number) => number,
  ) {
    this.ensemble = ensemble;
    this.volTargetLookup = volTargetLookup;
    this.hybridFactorLookup = hybridFactorLookup;
    this.name = `V4Injecting(${ensemble.name})`;
  }

  warmup(): number {
    return this.ensemble.warmup();
  }

  onCandle(ctx: StrategyContext) {
    const mult = this.volTargetLookup(ctx.candle.timestamp);
    this.ensemble.setVolTargetMultiplier(mult);
    const factor = this.hybridFactorLookup(ctx.candle.timestamp);
    this.ensemble.setHybridPositionFactor(factor);
    return this.ensemble.onCandle(ctx);
  }

  onOpenPositionUpdate(ctx: unknown) {
    return this.ensemble.onOpenPositionUpdate(
      ctx as Parameters<MultiClassEnsembleV4["onOpenPositionUpdate"]>[0],
    );
  }

  onPositionOpened(snap: unknown) {
    this.ensemble.onPositionOpened(
      snap as Parameters<MultiClassEnsembleV4["onPositionOpened"]>[0],
    );
  }

  onPositionClosed(reason: string) {
    this.ensemble.onPositionClosed(reason);
  }
}

// ---------------------------------------------------------------------------
// Parallel carry simulation (with 9D kill-switch + 9E vol-target)
// ---------------------------------------------------------------------------

/**
 * `simulateFundingCarryWithFlipSwitch` — drive the V4 ensemble's
 * FundingFlipKillSwitch + inner FundingCarryTiming state machine against
 * the funding CSV. Returns the cumulative funding collected and
 * kill-switch diagnostics.
 *
 * The 9D wrapper applies the funding-flip regime detector automatically;
 * when the regime activates while in carry, the wrapper force-exits and
 * returns 0 for the carry payment.
 */
function simulateFundingCarryWithFlipSwitch(
  ensemble: MultiClassEnsembleV4,
  fundingSnapshots: readonly FundingSnapshotCsv[],
  startTimeMs: number,
  endTimeMs: number,
): {
  fundingCollectedUsd: number;
  fundingSnapshotsApplied: number;
  fundingSnapshotsSkipped: number;
  fundingPayments: readonly { timestamp: number; payment: number }[];
  carryPausedFundingPeriods: number;
  carryPausedFundingUsd: number;
  forcedExitCount: number;
  regimeActivationCount: number;
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
    fundingCollectedUsd = ensemble.fundingFlipKillSwitch.underlyingCarryState.fundingCollectedUsd;
  }
  return {
    fundingCollectedUsd,
    fundingSnapshotsApplied: applied,
    fundingSnapshotsSkipped: skipped,
    fundingPayments,
    carryPausedFundingPeriods: ensemble.fundingFlipKillSwitch.state.carryPausedFundingPeriods,
    carryPausedFundingUsd: ensemble.fundingFlipKillSwitch.state.carryPausedFundingUsd,
    forcedExitCount: ensemble.fundingFlipKillSwitch.state.forcedExitCount,
    regimeActivationCount: ensemble.fundingFlipKillSwitch.state.regimeActivationCount,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  console.log(`[V4-MULTI-CLASS] Phase 9 M2 V4 baseline — symbol=${args.symbol} timeframe=${args.timeframe}`);
  console.log(`[V4-MULTI-CLASS] 1:10 MANDATORY LEVERAGE: ${args.leverage}×`);

  // 1) Load OHLCV feed.
  const dataDirAbs = resolve(import.meta.dir, "..", "..", "..", "..", args.dataDir);
  const feed = new CsvExchangeFeed(dataDirAbs) as unknown as ExchangeFeed;

  // 2) Load daily OHLCV for vol-target series + hybrid sizer.
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

  // 5) Compute Track G aggregated stats for the report.
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

  // 6) Build the V4 ensemble config (without hybrid result — we'll fill it in PHASE 2).
  const initialConfig: MultiClassEnsembleV4Config = {
    donchianMtf: {
      leverage: args.leverage,
    },
    fundingFlipKillSwitch: {
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

  // 7) PHASE 1 — Baseline DonchianMTF backtest (0.5× static Kelly) to
  //    produce the trade list + equity curve for the hybrid sizer.
  console.log(`[V4-MULTI-CLASS] PHASE 1 — baseline DonchianMTF backtest (0.5× static Kelly)`);
  const baselineEnsemble = new MultiClassEnsembleV4(initialConfig);
  const baselineWrapper = new V4InjectingStrategy(
    baselineEnsemble,
    volTargetLookup,
    // Baseline uses 1.0 hybrid factor (no Kelly scaling)
    () => 1.0,
  );

  const costModel: CostModel = {
    takerFeeRate: 0.001,
    slippageRate: 0.0005,
    spreadRate: 0.0002,
    borrowRatePerHour: 0.0001,
    fundingRatePer8h: 0,
  };
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date(Date.UTC(2026, 6, 1)); // through mid-2026
  const avgMult = volTargetSummary.avgVolMultiplier;
  const baselineRecommendedMaxPos = 0.2 * avgMult;

  const baselineResult: BacktestResult = await runBacktest({
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
      riskPerTrade: 0.01 * avgMult,
      kellyFraction: 0.5, // static Kelly for baseline
      maxDrawdown: 0.5,
      maxPositionPctEquity: baselineRecommendedMaxPos,
      minPositionPctEquity: 0.01,
    },
    strategy: baselineWrapper,
  });
  const baselineTrades = baselineResult.trades;
  console.log(
    `[V4-MULTI-CLASS] PHASE 1 done — ${baselineTrades.length} trades, return=${(baselineResult.totalReturn * 100).toFixed(2)}%`,
  );

  if (baselineTrades.length === 0) {
    throw new Error(
      `[V4-MULTI-CLASS] Baseline produced 0 trades — cannot compute hybrid sizer. ` +
        `This combination (${args.symbol} ${args.timeframe}) doesn't have an edge.`,
    );
  }

  // 8) PHASE 2 — Compute the HybridSizerResult from baseline trades + daily OHLCV.
  console.log(`[V4-MULTI-CLASS] PHASE 2 — Adaptive Kelly × VolTarget hybrid sizer`);
  const hybridConfig: HybridSizerConfig = {
    rollingWindowDays: 30,
    baseKellyFraction: args.baseKellyFraction,
    volTargetConfig: volTargetConfig,
    initialEquity: args.initialEquity,
    minTradeCount: 30,
  };
  const hybridSizer = computeHybridSizer(
    baselineTrades,
    dailyOhlcv.map((r) => ({
      timestamp: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    })),
    args.baseNotionalUsd,
    hybridConfig,
  );
  console.log(
    `[V4-MULTI-CLASS] PHASE 2 done — avgKelly=${hybridSizer.avgKellyFraction.toFixed(4)}, ` +
      `avgVolMult=${hybridSizer.avgVolMultiplier.toFixed(4)}, avgFactor=${hybridSizer.avgEffectivePositionFactor.toFixed(4)}, ` +
      `avgEffLev=${hybridSizer.avgEffectiveLeverage.toFixed(2)}×`,
  );

  // 9) PHASE 3 — Final V4 backtest with hybrid sizing injected.
  console.log(`[V4-MULTI-CLASS] PHASE 3 — final V4 backtest (hybrid sizing + 9D kill-switch + 9E vol)`);
  const finalConfig: MultiClassEnsembleV4Config = {
    ...initialConfig,
    hybridSizerResult: hybridSizer,
  };
  const finalEnsemble = new MultiClassEnsembleV4(finalConfig);
  const hybridFactorLookup = buildHybridFactorLookup(hybridSizer);
  const finalWrapper = new V4InjectingStrategy(
    finalEnsemble,
    volTargetLookup,
    hybridFactorLookup,
  );

  // Use the hybrid sizer's recommended max position + baseKelly for the engine.
  const recommendedMaxPositionPctEquity = Math.min(
    0.99,
    args.baseKellyFraction * hybridSizer.avgEffectivePositionFactor,
  );
  finalEnsemble.setRecommendedMaxPositionPctEquity(recommendedMaxPositionPctEquity);

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
      riskPerTrade: 0.01 * avgMult * hybridSizer.avgEffectivePositionFactor,
      kellyFraction: hybridSizer.avgKellyFraction,
      maxDrawdown: 0.5,
      maxPositionPctEquity: recommendedMaxPositionPctEquity,
      minPositionPctEquity: 0.01,
    },
    strategy: finalWrapper,
  });

  // 10) Run parallel carry simulation on the funding CSV.
  const carrySim = simulateFundingCarryWithFlipSwitch(
    finalEnsemble,
    fundingSnapshots,
    startTime.getTime(),
    endTime.getTime(),
  );

  // 11) Compute combined edge.
  const directionalPnlUsd = result.totalReturn * args.initialEquity;
  const carryPnlUsd = carrySim.fundingCollectedUsd;
  const totalPnlUsd = directionalPnlUsd + carryPnlUsd;
  const totalReturnPct = (totalPnlUsd / args.initialEquity) * 100;
  const totalMonths = 30;
  const monthlyReturnPct = totalReturnPct / totalMonths;
  const annualizedReturnPct = (totalReturnPct / 30) * 12;
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
  const finalState = finalEnsemble.getState();

  // 15) Verify the 1:10 leverage mandate (max effective leverage ≤ 10).
  if (finalState.effectiveCarryLeverage > 10) {
    throw new Error(
      `[V4-MULTI-CLASS] 1:10 MANDATE VIOLATION: effectiveCarryLeverage=${finalState.effectiveCarryLeverage} > 10. ` +
        `Refusing to write output.`,
    );
  }

  // 16) Write output JSON.
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: 9,
      milestone: "M2",
      track: "V4-multi-class-ensemble",
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
      baseKellyFraction: args.baseKellyFraction,
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
    hybridSizer: {
      config: hybridConfig,
      avgKellyFraction: hybridSizer.avgKellyFraction,
      avgVolMultiplier: hybridSizer.avgVolMultiplier,
      avgEffectivePositionFactor: hybridSizer.avgEffectivePositionFactor,
      avgEffectiveLeverage: hybridSizer.avgEffectiveLeverage,
      upperClampFraction: hybridSizer.upperClampFraction,
      lowerClampFraction: hybridSizer.lowerClampFraction,
      middleFraction: hybridSizer.middleFraction,
      kellyBucketDistribution: hybridSizer.kellyBucketDistribution,
      recommendedRiskPerTrade: hybridSizer.recommendedRiskPerTrade,
      recommendedMaxPositionPctEquity: hybridSizer.recommendedMaxPositionPctEquity,
      hadAllLossStreak: hybridSizer.hadAllLossStreak,
      baselineTradeCount: baselineTrades.length,
    },
    ensembleState: {
      ...finalState,
      fundingCarryUsd: carryPnlUsd,
      fundingCarryEntries: finalState.fundingCarryEntries,
      fundingCarryTimeInCarryFraction: finalState.fundingCarryTimeInCarryFraction,
    },
    flipKillSwitch: {
      regimeActivationCount: finalState.flipRegimeActivationCount,
      forcedExitCount: finalState.flipForcedExitCount,
      carryPausedFundingPeriods: finalState.flipCarryPausedFundingPeriods,
      carryPausedFundingUsd: finalState.flipCarryPausedFundingUsd,
      flipRegimeSignalCount: finalEnsemble.fundingFlipKillSwitch.state.flipRegimeSignalCount,
      negativeDominanceSignalCount:
        finalEnsemble.fundingFlipKillSwitch.state.negativeDominanceSignalCount,
      extremeRegimeSignalCount: finalEnsemble.fundingFlipKillSwitch.state.extremeRegimeSignalCount,
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
    hybridAvgFactor: Number(hybridSizer.avgEffectivePositionFactor.toFixed(4)),
    hybridAvgEffLev: Number(hybridSizer.avgEffectiveLeverage.toFixed(2)),
    hybridAvgKelly: Number(hybridSizer.avgKellyFraction.toFixed(4)),
    timeInCarryFraction: Number(finalState.fundingCarryTimeInCarryFraction.toFixed(4)),
    donchianSignalsEmitted: finalState.donchianSignalsEmitted,
    donchianTimeExitCloses: finalState.donchianTimeExitCloses,
    carryEntries: finalState.fundingCarryEntries,
    fundingSnapshotsApplied: carrySim.fundingSnapshotsApplied,
    fundingSnapshotsSkipped: carrySim.fundingSnapshotsSkipped,
    carryPausedFundingPeriods: carrySim.carryPausedFundingPeriods,
    carryPausedFundingUsd: Number(carrySim.carryPausedFundingUsd.toFixed(2)),
    forcedExitCount: carrySim.forcedExitCount,
    regimeActivationCount: carrySim.regimeActivationCount,
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