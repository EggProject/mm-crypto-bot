#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-funding-flip-kill-switch.ts —
// Phase 9 9D funding-flip regime detector + carry-pause wrapper around
// the Phase 8 Track E FundingCarryTimingStrategy.
//
// ===========================================================================
// HARD CONSTRAINT — USER-MANDATED 1:10 LEVERAGE (mvs_c13fe65cb68f4df3851304dea09a9099)
// ===========================================================================
//
// All trades use EXACTLY 1:10 leverage (10× notional on 1× capital).
// The CLI's --leverage flag accepts ONLY 1 or 10 — any other value
// (2, 3, 4, 5, 7, etc.) is REJECTED at parse time. Default = 10.
//
// This SUPERSEDES any prior track guidance:
//   - Phase 7 Track C "3× leverage default" → OVERRIDDEN
//   - Altrady / coincryptorank "≤3× for basis" → OVERRIDDEN
//   - Phase 8 Track E original "NO leverage amplification" → OVERRIDDEN
//
// ===========================================================================
//
// Algorithm — funding-flip kill-switch + Track E timing + 1:10 leverage:
//   1. Open long-spot + short-perp at startPrice with 1:10 notional.
//   2. Every 8h funding snapshot: append to rolling 30d window (Track E
//      timing) AND drive the flip detector. The detector checks:
//      - flip regime: ≥ 7 sign-flips in trailing 7d
//      - negative dominance: ≥ 70% of trailing 7d are negative
//      - extreme vol: trailing 7d |rate| z-score ≥ 1.5σ vs trailing 30d
//   3. When ANY regime is "fresh" (current snapshot contributes to regime),
//      extend the persistence window by 7d (persistenceDays).
//   4. While the kill-switch is engaged (regime active OR persistence
//      window open): skip funding accrual entirely. If in carry, force-exit.
//   5. Outside regime: Track E timing filter applies — enter when rate > p75,
//      exit when rate < median, 72h cooldown.
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-funding-flip-kill-switch.ts \
//     --symbol=SOL/USDT --timeframe=1h \
//     --output=backtest-results/baseline-funding-flip-kill-switch-sol-1h.json \
//     --leverage=10 --flip-threshold=7 --extreme-zscore=1.5 --persistence-days=7

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import {
  FundingFlipKillSwitchStrategy,
  DEFAULT_FLIP_DETECTOR_CONFIG,
  DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG,
  type FundingFlipKillSwitchConfig,
} from "@mm-crypto-bot/core";
import type { AllowedTimingLeverage, FundingSnapshot } from "@mm-crypto-bot/core";
import { validateTimingLeverage } from "@mm-crypto-bot/core";
import type { Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: AllowedTimingLeverage;
  readonly flipThreshold: number;
  readonly extremeZscore: number;
  readonly persistenceDays: number;
  readonly negativeDominanceThreshold: number;
  readonly outputPath: string;
  readonly walkForward: boolean;
  readonly wfIsDays: number;
  readonly wfOosDays: number;
  readonly wfStepDays: number;
  readonly wfPurgeDays: number;
}

// ===========================================================================
// HARD CONSTRAINT VALIDATOR — 1:10 MANDATORY LEVERAGE
// ===========================================================================

/**
 * `parseAndValidateLeverage` — strict CLI parser for the --leverage flag.
 * Rejects any value other than 1 or 10. Same as Track E / Track D — see
 * §X.1 of docs/research/phase9-funding-flip-kill-switch.md for the
 * rationale and project-wide mandate.
 *
 * @throws Error if `raw` cannot be parsed or is not in {1, 10}.
 */
function parseAndValidateLeverage(raw: string): AllowedTimingLeverage {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `[FUNDING-FLIP-KILL-SWITCH] HARD CONSTRAINT VIOLATION: --leverage=${raw} is not a valid integer. ` +
        `User-mandated 1:10 leverage — only values 1 or 10 are accepted. Refusing to run.`,
    );
  }
  if (parsed !== 1 && parsed !== 10) {
    throw new Error(
      `[FUNDING-FLIP-KILL-SWITCH] HARD CONSTRAINT VIOLATION: --leverage=${parsed} is NOT allowed. ` +
        `User-mandated 1:10 leverage — only values 1 (baseline) or 10 (1:10 mandatory) are accepted. ` +
        `Refusing to run.`,
    );
  }
  return parsed;
}

/**
 * `parseArgs` — extract CLI args with HARD GUARDRAIL enforcement.
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1h";
  let initialEquity = 10_000;
  let baseNotionalUsd = 10_000;
  let leverage: AllowedTimingLeverage = 10;
  let flipThreshold = DEFAULT_FLIP_DETECTOR_CONFIG.flipThreshold;
  let extremeZscore = DEFAULT_FLIP_DETECTOR_CONFIG.extremeZscoreThreshold;
  let persistenceDays = DEFAULT_FLIP_DETECTOR_CONFIG.persistenceDays;
  let negativeDominanceThreshold = DEFAULT_FLIP_DETECTOR_CONFIG.negativeDominanceThreshold;
  let outputPath = "backtest-results/baseline-funding-flip-kill-switch-btc-1h.json";
  let walkForward = false;
  let wfIsDays = 180;
  let wfOosDays = 30;
  let wfStepDays = 30;
  let wfPurgeDays = 7;

  for (const arg of args) {
    if (arg.startsWith("--symbol=")) symbol = arg.slice("--symbol=".length);
    else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`Invalid timeframe: ${tf}`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) initialEquity = Number(arg.slice("--equity=".length));
    else if (arg.startsWith("--notional=")) baseNotionalUsd = Number(arg.slice("--notional=".length));
    else if (arg.startsWith("--leverage=")) leverage = parseAndValidateLeverage(arg.slice("--leverage=".length));
    else if (arg.startsWith("--flip-threshold=")) flipThreshold = Number(arg.slice("--flip-threshold=".length));
    else if (arg.startsWith("--extreme-zscore=")) extremeZscore = Number(arg.slice("--extreme-zscore=".length));
    else if (arg.startsWith("--persistence-days=")) persistenceDays = Number(arg.slice("--persistence-days=".length));
    else if (arg.startsWith("--neg-dom-threshold=")) negativeDominanceThreshold = Number(arg.slice("--neg-dom-threshold=".length));
    else if (arg.startsWith("--output=")) outputPath = arg.slice("--output=".length);
    else if (arg === "--walk-forward") walkForward = true;
    else if (arg.startsWith("--wf-is-days=")) wfIsDays = Number(arg.slice("--wf-is-days=".length));
    else if (arg.startsWith("--wf-oos-days=")) wfOosDays = Number(arg.slice("--wf-oos-days=".length));
    else if (arg.startsWith("--wf-step-days=")) wfStepDays = Number(arg.slice("--wf-step-days=".length));
    else if (arg.startsWith("--wf-purge-days=")) wfPurgeDays = Number(arg.slice("--wf-purge-days=".length));
  }

  return {
    symbol,
    timeframe,
    initialEquity,
    baseNotionalUsd,
    leverage,
    flipThreshold,
    extremeZscore,
    persistenceDays,
    negativeDominanceThreshold,
    outputPath,
    walkForward,
    wfIsDays,
    wfOosDays,
    wfStepDays,
    wfPurgeDays,
  };
}

function symbolToFileSymbol(ccxtSymbol: string): string {
  return ccxtSymbol.split("/")[0]!.toLowerCase();
}

async function loadFundingCsv(path: string): Promise<readonly FundingSnapshot[]> {
  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n");
  const out: FundingSnapshot[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === "") continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const ts = Number(parts[0]);
    const sym = parts[1] ?? "";
    const rate = Number(parts[2]);
    if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
    out.push({ fundingTime: ts, symbol: sym, fundingRate: rate });
  }
  return out;
}

interface FlipPoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly fundingAccruedUsd: number;
  readonly markPrice: number;
  readonly inCarry: boolean;
  readonly carryPaused: boolean;
  readonly fundingRate8h: number;
  readonly flipCount: number;
  readonly negativeDominance: number;
  readonly zscore: number;
  readonly regimeActive: boolean;
}

interface FlipResult {
  readonly totalReturn: number;
  readonly annualizedReturn: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly maxDrawdown: number;
  readonly profitFactor: number;
  readonly winRate: number;
  readonly totalTrades: number;
  readonly entryCount: number;
  readonly exitCount: number;
  readonly forcedExitCount: number;
  readonly timeInCarryPct: number;
  readonly timeKillSwitchEngagedPct: number;
  readonly avgHoldDurationHours: number;
  readonly fundingCollectedUsd: number;
  readonly carryPausedFundingUsd: number;
  readonly carryPausedFundingPeriods: number;
  readonly flipRegimeSignalCount: number;
  readonly negativeDominanceSignalCount: number;
  readonly extremeRegimeSignalCount: number;
  readonly regimeActivationCount: number;
  readonly regimeDeactivationCount: number;
  readonly rebalanceCount: number;
  readonly rebalanceCostUsd: number;
  readonly fundingPeriods: number;
  readonly positiveFundingPeriods: number;
  readonly negativeFundingPeriods: number;
  readonly avgFundingRate8h: number;
  readonly equityCurve: readonly FlipPoint[];
  readonly startTime: number;
  readonly endTime: number;
}

/**
 * `simulateFlipKillSwitch` — the core simulation loop. Identical
 * structure to Track E's `simulateTimingCarry` but:
 *   - Uses `FundingFlipKillSwitchStrategy` (wraps Track E)
 *   - Drives the flip detector at each funding snapshot
 *   - Skips funding accrual when kill-switch engaged
 *   - Tracks regime days + carry-paused days as additional metrics
 */
function simulateFlipKillSwitch(opts: {
  readonly ohlcv: readonly { timestamp: number; close: number }[];
  readonly funding: readonly FundingSnapshot[];
  readonly startTime: number;
  readonly endTime: number;
  readonly initialEquity: number;
  readonly config: FundingFlipKillSwitchConfig;
}): FlipResult {
  const strategy = new FundingFlipKillSwitchStrategy(opts.config);
  // Defense in depth — re-assert the 1:10 hard guardrail at the runner
  // boundary in case the config object was constructed elsewhere.
  validateTimingLeverage(strategy.config.timingLeverage);

  if (opts.ohlcv.length === 0) {
    throw new Error("No OHLCV candles in the requested period");
  }

  const equityCurve: FlipPoint[] = [];
  let lastFundingTime = 0;
  let fundingPeriods = 0;
  let positiveFundingPeriods = 0;
  let negativeFundingPeriods = 0;
  let fundingSum = 0;
  let inCarryCandles = 0;
  let killSwitchEngagedCandles = 0;
  let totalCandles = 0;
  let inCarryEnterTime = 0;
  const holdDurations: number[] = [];
  let lastFundingRate = 0;

  for (const candle of opts.ohlcv) {
    const range = opts.funding.filter(
      (s) => s.fundingTime > lastFundingTime && s.fundingTime <= candle.timestamp,
    );
    for (const snap of range) {
      // Drive the flip detector FIRST (before timing decision so the
      // detector sees the new sample).
      strategy.recordFundingSample(snap.fundingRate, snap.fundingTime);
      // CRITICAL: also push to the underlying strategy's funding history
      // so its rolling-window stats reflect the new snapshot. The wrapper
      // maintains its own history for the detector; the underlying has
      // its own history for the timing filter.
      strategy.underlying.recordFundingSample(snap.fundingRate, snap.fundingTime);
      // Force-exit from carry if regime just activated.
      strategy.forceExitIfRegimeActive(snap.fundingTime);
      // Accrue funding (skip if kill-switch engaged).
      strategy.accrueFundingOnSnapshot(snap, snap.fundingTime);

      fundingPeriods += 1;
      fundingSum += snap.fundingRate;
      lastFundingRate = snap.fundingRate;
      if (snap.fundingRate > 0) positiveFundingPeriods += 1;
      else if (snap.fundingRate < 0) negativeFundingPeriods += 1;

      // Track out-of-carry funding periods.
      if (!strategy.underlying.state.isInCarry) {
        strategy.underlying.state.outOfCarryFundingPeriods += 1;
      }

      // Evaluate Track E timing (will return 'hold' if kill-switch engaged).
      const decision = strategy.evaluateTiming(snap.fundingRate, snap.fundingTime);
      if (decision === "enter" && !strategy.underlying.state.isInCarry) {
        strategy.underlying._enterCarry(snap.fundingTime);
        inCarryEnterTime = snap.fundingTime;
      } else if (decision === "exit" && strategy.underlying.state.isInCarry) {
        strategy.underlying._exitCarry(snap.fundingTime);
        holdDurations.push(snap.fundingTime - inCarryEnterTime);
      }
      lastFundingTime = snap.fundingTime;
    }

    totalCandles += 1;
    if (strategy.underlying.state.isInCarry) inCarryCandles += 1;
    if (strategy.isKillSwitchEngaged(candle.timestamp)) killSwitchEngagedCandles += 1;

    const equity = opts.initialEquity + strategy.totalNetPnlUsd();
    // initialEquity referenced in mark-to-market above; tracked in equityCurve.
    void opts.initialEquity;

    equityCurve.push({
      timestamp: candle.timestamp,
      equity,
      fundingAccruedUsd: strategy.underlying.state.fundingCollectedUsd,
      markPrice: candle.close,
      inCarry: strategy.underlying.state.isInCarry,
      carryPaused: strategy.isKillSwitchEngaged(candle.timestamp),
      fundingRate8h: lastFundingRate,
      flipCount: strategy.state.lastMetrics.flipCount,
      negativeDominance: strategy.state.lastMetrics.negativeDominance,
      zscore: strategy.state.lastMetrics.zscore,
      regimeActive: strategy.state.lastRegime.regimeActive,
    });
  }

  if (strategy.underlying.state.isInCarry && inCarryEnterTime > 0) {
    holdDurations.push(opts.endTime - inCarryEnterTime);
  }

  // Metrics (mirror Track E).
  const totalReturn =
    (equityCurve[equityCurve.length - 1]!.equity - opts.initialEquity) / opts.initialEquity;
  const elapsedDays = (opts.endTime - opts.startTime) / (1000 * 60 * 60 * 24);
  const years = elapsedDays / 365.25;
  const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const cur = equityCurve[i]!.equity;
    if (prev > 0) returns.push((cur - prev) / prev);
  }
  const meanR = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1 ? returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (returns.length - 1) : 0;
  const stdR = Math.sqrt(variance);
  const periodsPerYear = 24 * 365;
  const sharpeRatio = stdR > 0 ? (meanR / stdR) * Math.sqrt(periodsPerYear) : 0;
  const downside = returns.filter((r) => r < 0);
  const downStd =
    downside.length > 1
      ? Math.sqrt(downside.reduce((a, b) => a + b ** 2, 0) / (downside.length - 1))
      : 0;
  const sortinoRatio = downStd > 0 ? (meanR / downStd) * Math.sqrt(periodsPerYear) : 0;

  let peak = equityCurve[0]?.equity ?? opts.initialEquity;
  let maxDd = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const wins = strategy.underlying.state.fundingCollectedUsd >= 0 ? 1 : 0;
  const losses = strategy.underlying.state.fundingCollectedUsd < 0 ? 1 : 0;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;

  const avgHoldHours =
    holdDurations.length > 0
      ? holdDurations.reduce((a, b) => a + b, 0) / holdDurations.length / (1000 * 60 * 60)
      : 0;

  return {
    totalReturn,
    annualizedReturn,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: maxDd,
    profitFactor: strategy.underlying.state.fundingCollectedUsd,
    winRate,
    totalTrades: strategy.underlying.state.entryCount + strategy.underlying.state.exitCount,
    entryCount: strategy.underlying.state.entryCount,
    exitCount: strategy.underlying.state.exitCount,
    forcedExitCount: strategy.state.forcedExitCount,
    timeInCarryPct: totalCandles > 0 ? inCarryCandles / totalCandles : 0,
    timeKillSwitchEngagedPct: totalCandles > 0 ? killSwitchEngagedCandles / totalCandles : 0,
    avgHoldDurationHours: avgHoldHours,
    fundingCollectedUsd: strategy.underlying.state.fundingCollectedUsd,
    carryPausedFundingUsd: strategy.state.carryPausedFundingUsd,
    carryPausedFundingPeriods: strategy.state.carryPausedFundingPeriods,
    flipRegimeSignalCount: strategy.state.flipRegimeSignalCount,
    negativeDominanceSignalCount: strategy.state.negativeDominanceSignalCount,
    extremeRegimeSignalCount: strategy.state.extremeRegimeSignalCount,
    regimeActivationCount: strategy.state.regimeActivationCount,
    regimeDeactivationCount: strategy.state.regimeDeactivationCount,
    rebalanceCount: strategy.underlyingBaseCarryState.rebalanceCount,
    rebalanceCostUsd: strategy.underlyingBaseCarryState.rebalanceCostUsd,
    fundingPeriods,
    positiveFundingPeriods,
    negativeFundingPeriods,
    avgFundingRate8h: fundingPeriods > 0 ? fundingSum / fundingPeriods : 0,
    equityCurve,
    startTime: opts.startTime,
    endTime: opts.endTime,
  };
}

// ===========================================================================
// WALK-FORWARD VALIDATION
// ===========================================================================

interface WalkForwardFold {
  readonly foldIndex: number;
  readonly oosStartMs: number;
  readonly oosEndMs: number;
  readonly oosStartIso: string;
  readonly oosEndIso: string;
  readonly oosHours: number;
  readonly oosReturn: number;
  readonly oosSharpe: number;
  readonly oosMaxDD: number;
  readonly oosInCarryPct: number;
  readonly oosCarryPausedPct: number;
  readonly oosFundingCapturedUsd: number;
}

interface WalkForwardResult {
  readonly config: {
    readonly isDays: number;
    readonly oosDays: number;
    readonly stepDays: number;
    readonly purgeDays: number;
    readonly leverage: AllowedTimingLeverage;
    readonly leverageRatio: string;
  };
  readonly aggregate: {
    readonly totalFolds: number;
    readonly aggregateOOSSharpe: number;
    readonly aggregateOOSReturn: number;
    readonly aggregateOOSMaxDD: number;
    readonly aggregateOOSHours: number;
    readonly meanFoldSharpe: number;
    readonly stdFoldSharpe: number;
    readonly minFoldSharpe: number;
    readonly maxFoldSharpe: number;
    readonly positiveFolds: number;
  };
  readonly folds: readonly WalkForwardFold[];
}

function computeWalkForward(
  equityCurve: readonly FlipPoint[],
  startTimeMs: number,
  endTimeMs: number,
  leverage: AllowedTimingLeverage,
  isDays: number,
  oosDays: number,
  stepDays: number,
  purgeDays: number,
): WalkForwardResult {
  const dayMs = 86_400_000;
  const folds: WalkForwardFold[] = [];
  let oosStartMs = startTimeMs + (isDays + purgeDays) * dayMs;
  let foldIdx = 0;
  for (;;) {
    const oosEndMs = oosStartMs + oosDays * dayMs;
    if (oosEndMs > endTimeMs) break;
    const oosPoints = equityCurve.filter(
      (p) => p.timestamp >= oosStartMs && p.timestamp < oosEndMs,
    );
    if (oosPoints.length >= 2) {
      const oosReturn =
        (oosPoints[oosPoints.length - 1]!.equity - oosPoints[0]!.equity) /
        oosPoints[0]!.equity;
      const oosReturns: number[] = [];
      for (let i = 1; i < oosPoints.length; i++) {
        const prev = oosPoints[i - 1]!.equity;
        const cur = oosPoints[i]!.equity;
        if (prev > 0) oosReturns.push((cur - prev) / prev);
      }
      const meanR =
        oosReturns.length > 0
          ? oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length
          : 0;
      const variance =
        oosReturns.length > 1
          ? oosReturns.reduce((a, b) => a + (b - meanR) ** 2, 0) /
            (oosReturns.length - 1)
          : 0;
      const stdR = Math.sqrt(variance);
      const oosSharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(24 * 365) : 0;
      let peak = oosPoints[0]!.equity;
      let oosMaxDD = 0;
      for (const p of oosPoints) {
        if (p.equity > peak) peak = p.equity;
        const dd = (peak - p.equity) / peak;
        if (dd > oosMaxDD) oosMaxDD = dd;
      }
      const inCarry = oosPoints.filter((p) => p.inCarry).length;
      const paused = oosPoints.filter((p) => p.carryPaused).length;
      const oosFundingDelta =
        oosPoints[oosPoints.length - 1]!.fundingAccruedUsd -
        oosPoints[0]!.fundingAccruedUsd;
      folds.push({
        foldIndex: foldIdx,
        oosStartMs,
        oosEndMs,
        oosStartIso: new Date(oosStartMs).toISOString(),
        oosEndIso: new Date(oosEndMs).toISOString(),
        oosHours: oosPoints.length,
        oosReturn,
        oosSharpe,
        oosMaxDD,
        oosInCarryPct: inCarry / oosPoints.length,
        oosCarryPausedPct: paused / oosPoints.length,
        oosFundingCapturedUsd: oosFundingDelta,
      });
    }
    oosStartMs += stepDays * dayMs;
    foldIdx++;
  }

  // Continuous OOS stitching (mirror Track E).
  const continuousOosPoints: { timestamp: number; equity: number }[] = [];
  for (const fold of folds) {
    const oosPoints = equityCurve.filter(
      (p) => p.timestamp >= fold.oosStartMs && p.timestamp < fold.oosEndMs,
    );
    if (continuousOosPoints.length === 0) {
      for (const p of oosPoints) {
        continuousOosPoints.push({ timestamp: p.timestamp, equity: p.equity });
      }
    } else {
      const lastEquity = continuousOosPoints[continuousOosPoints.length - 1]!.equity;
      const firstFoldEquity = oosPoints[0]!.equity;
      const shift = lastEquity - firstFoldEquity;
      for (const p of oosPoints) {
        continuousOosPoints.push({ timestamp: p.timestamp, equity: p.equity + shift });
      }
    }
  }

  const aggReturns: number[] = [];
  for (let i = 1; i < continuousOosPoints.length; i++) {
    const prev = continuousOosPoints[i - 1]!.equity;
    const cur = continuousOosPoints[i]!.equity;
    if (prev > 0) aggReturns.push((cur - prev) / prev);
  }
  const aggMeanR =
    aggReturns.length > 0 ? aggReturns.reduce((a, b) => a + b, 0) / aggReturns.length : 0;
  const aggVariance =
    aggReturns.length > 1
      ? aggReturns.reduce((a, b) => a + (b - aggMeanR) ** 2, 0) /
        (aggReturns.length - 1)
      : 0;
  const aggStdR = Math.sqrt(aggVariance);
  const aggSharpe = aggStdR > 0 ? (aggMeanR / aggStdR) * Math.sqrt(24 * 365) : 0;
  const aggReturn =
    continuousOosPoints.length > 0
      ? (continuousOosPoints[continuousOosPoints.length - 1]!.equity -
          continuousOosPoints[0]!.equity) /
        continuousOosPoints[0]!.equity
      : 0;
  let aggPeak = continuousOosPoints[0]?.equity ?? 0;
  let aggMaxDD = 0;
  for (const p of continuousOosPoints) {
    if (p.equity > aggPeak) aggPeak = p.equity;
    const dd = (aggPeak - p.equity) / aggPeak;
    if (dd > aggMaxDD) aggMaxDD = dd;
  }

  const foldSharpes = folds.map((f) => f.oosSharpe).filter((s) => Number.isFinite(s));
  const meanFoldSharpe =
    foldSharpes.length > 0 ? foldSharpes.reduce((a, b) => a + b, 0) / foldSharpes.length : 0;
  const stdFoldSharpe =
    foldSharpes.length > 1
      ? Math.sqrt(
          foldSharpes.reduce((a, b) => a + (b - meanFoldSharpe) ** 2, 0) /
            (foldSharpes.length - 1),
        )
      : 0;
  const minFoldSharpe = foldSharpes.length > 0 ? Math.min(...foldSharpes) : 0;
  const maxFoldSharpe = foldSharpes.length > 0 ? Math.max(...foldSharpes) : 0;
  const positiveFolds = foldSharpes.filter((s) => s > 0).length;

  return {
    config: {
      isDays,
      oosDays,
      stepDays,
      purgeDays,
      leverage,
      leverageRatio: `1:${leverage}`,
    },
    aggregate: {
      totalFolds: folds.length,
      aggregateOOSSharpe: aggSharpe,
      aggregateOOSReturn: aggReturn,
      aggregateOOSMaxDD: aggMaxDD,
      aggregateOOSHours: continuousOosPoints.length,
      meanFoldSharpe,
      stdFoldSharpe,
      minFoldSharpe,
      maxFoldSharpe,
      positiveFolds,
    },
    folds,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[funding-flip-kill-switch] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[funding-flip-kill-switch] HARD CONSTRAINT: leverage = ${args.leverage} (1:${args.leverage})`);
  console.log(`[funding-flip-kill-switch] effectiveNotional = $${(args.baseNotionalUsd * args.leverage).toFixed(0)}`);
  console.log(`[funding-flip-kill-switch] detector: flipN≥${args.flipThreshold} | negDom≥${(args.negativeDominanceThreshold * 100).toFixed(0)}% | z≥${args.extremeZscore}σ | persist=${args.persistenceDays}d`);
  console.log(`[funding-flip-kill-switch] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

  const ohlcvAll = await feed.fetchOHLCV(args.symbol, args.timeframe, {
    since: startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  const ohlcv = ohlcvAll.filter(
    (c) => c.timestamp >= startTime.getTime() && c.timestamp <= endTime.getTime(),
  );
  if (ohlcv.length === 0) {
    throw new Error(`No OHLCV candles for ${args.symbol} ${args.timeframe}`);
  }

  const fileSym = symbolToFileSymbol(args.symbol);
  const fundingPath = resolve(fundingDir, `binance_${fileSym}usdt_funding_8h.csv`);
  const fundingRaw = await loadFundingCsv(fundingPath);
  const funding = fundingRaw.filter(
    (f) => f.fundingTime >= startTime.getTime() && f.fundingTime <= endTime.getTime(),
  );
  console.log(
    `[funding-flip-kill-switch] OHLCV: ${ohlcv.length}, funding snaps: ${funding.length} (total CSV: ${fundingRaw.length})`,
  );

  if (funding.length === 0) {
    console.warn(`[funding-flip-kill-switch] ⚠ No funding snapshots in window.`);
  }

  const config: FundingFlipKillSwitchConfig = {
    ...DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG,
    baseNotionalUsd: args.baseNotionalUsd,
    timingLeverage: args.leverage,
    detector: {
      ...DEFAULT_FLIP_DETECTOR_CONFIG,
      flipThreshold: args.flipThreshold,
      negativeDominanceThreshold: args.negativeDominanceThreshold,
      extremeZscoreThreshold: args.extremeZscore,
      persistenceDays: args.persistenceDays,
    },
    killSwitchEnabled: true,
  };

  const t0 = Date.now();
  const result = simulateFlipKillSwitch({
    ohlcv,
    funding,
    startTime: startTime.getTime(),
    endTime: endTime.getTime(),
    initialEquity: args.initialEquity,
    config,
  });
  const elapsedMs = Date.now() - t0;

  let walkForwardResult: WalkForwardResult | null = null;
  if (args.walkForward) {
    console.log(
      `[funding-flip-kill-switch] Running walk-forward: ${args.wfIsDays}d IS / ${args.wfOosDays}d OOS / ${args.wfStepDays}d step / ${args.wfPurgeDays}d purge`,
    );
    walkForwardResult = computeWalkForward(
      result.equityCurve,
      startTime.getTime(),
      endTime.getTime(),
      args.leverage,
      args.wfIsDays,
      args.wfOosDays,
      args.wfStepDays,
      args.wfPurgeDays,
    );
    const a = walkForwardResult.aggregate;
    console.log(`\n=== WALK-FORWARD RESULTS (${a.totalFolds} folds) ===`);
    console.log(`Aggregate OOS Sharpe:    ${a.aggregateOOSSharpe.toFixed(3)}`);
    console.log(`Aggregate OOS Return:    ${(a.aggregateOOSReturn * 100).toFixed(2)}%`);
    console.log(`Aggregate OOS Max DD:    ${(a.aggregateOOSMaxDD * 100).toFixed(4)}%`);
    console.log(`Per-fold Sharpe mean:    ${a.meanFoldSharpe.toFixed(3)}`);
    console.log(`Per-fold Sharpe std-dev: ${a.stdFoldSharpe.toFixed(3)}`);
    console.log(`Per-fold Sharpe min/max: ${a.minFoldSharpe.toFixed(3)} / ${a.maxFoldSharpe.toFixed(3)}`);
    console.log(`Positive folds (Sharpe>0): ${a.positiveFolds} / ${a.totalFolds}`);
  }

  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn =
    result.totalReturn > 0 && totalMonths > 0
      ? Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1
      : 0;

  console.log(`\n=== FUNDING-FLIP-KILL-SWITCH RESULTS ${args.symbol} ${args.timeframe} ===`);
  console.log(`HARD CONSTRAINT: leverage=${args.leverage}× (1:${args.leverage} mandatory)`);
  console.log(`Elapsed:                ${elapsedMs}ms`);
  console.log(`Total return:           ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:            ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:             ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:                 ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Sortino:                ${result.sortinoRatio.toFixed(3)}`);
  console.log(`Max DD:                 ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`--- KILL-SWITCH SPECIFIC ---`);
  console.log(`Time-in-carry:          ${(result.timeInCarryPct * 100).toFixed(2)}%`);
  console.log(`Time kill-switch on:    ${(result.timeKillSwitchEngagedPct * 100).toFixed(2)}%`);
  console.log(`Entry count:            ${result.entryCount}`);
  console.log(`Exit count:             ${result.exitCount}`);
  console.log(`Forced exits (regime):  ${result.forcedExitCount}`);
  console.log(`Carry paused periods:   ${result.carryPausedFundingPeriods}`);
  console.log(`Carry paused income:    $${result.carryPausedFundingUsd.toFixed(2)}`);
  console.log(`Regime activations:     ${result.regimeActivationCount}`);
  console.log(`Regime deactivations:   ${result.regimeDeactivationCount}`);
  console.log(`Flip regime signals:    ${result.flipRegimeSignalCount}`);
  console.log(`Neg-dom signals:        ${result.negativeDominanceSignalCount}`);
  console.log(`Extreme-vol signals:    ${result.extremeRegimeSignalCount}`);
  console.log(`--- TIMING-SPECIFIC ---`);
  console.log(`Funding collected:      $${result.fundingCollectedUsd.toFixed(2)}`);
  console.log(`Funding periods:        ${result.fundingPeriods}`);
  console.log(`Positive funding snaps: ${result.positiveFundingPeriods}`);
  console.log(`Negative funding snaps: ${result.negativeFundingPeriods}`);
  console.log(`Avg funding 8h:         ${(result.avgFundingRate8h * 100).toFixed(4)}%`);

  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(
    resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"),
    { recursive: true },
  );
  await fs.writeFile(
    absOutput,
    JSON.stringify(
      {
        args,
        hardConstraint: {
          leverage: args.leverage,
          leverageRatio: `1:${args.leverage}`,
          effectiveNotionalUsd: args.baseNotionalUsd * args.leverage,
          mandateSource: "user-steer mvs_c13fe65cb68f4df3851304dea09a9099",
          mandateText:
            "ALL trades MUST use EXACTLY 1:10 leverage. No more, no less.",
        },
        detectorConfig: config.detector,
        totalMonths,
        monthlyReturn,
        result: {
          totalReturn: result.totalReturn,
          annualizedReturn: result.annualizedReturn,
          sharpeRatio: result.sharpeRatio,
          sortinoRatio: result.sortinoRatio,
          maxDrawdown: result.maxDrawdown,
          profitFactor: result.profitFactor,
          winRate: result.winRate,
          totalTrades: result.totalTrades,
          entryCount: result.entryCount,
          exitCount: result.exitCount,
          forcedExitCount: result.forcedExitCount,
          timeInCarryPct: result.timeInCarryPct,
          timeKillSwitchEngagedPct: result.timeKillSwitchEngagedPct,
          avgHoldDurationHours: result.avgHoldDurationHours,
          fundingCollectedUsd: result.fundingCollectedUsd,
          carryPausedFundingUsd: result.carryPausedFundingUsd,
          carryPausedFundingPeriods: result.carryPausedFundingPeriods,
          flipRegimeSignalCount: result.flipRegimeSignalCount,
          negativeDominanceSignalCount: result.negativeDominanceSignalCount,
          extremeRegimeSignalCount: result.extremeRegimeSignalCount,
          regimeActivationCount: result.regimeActivationCount,
          regimeDeactivationCount: result.regimeDeactivationCount,
          rebalanceCount: result.rebalanceCount,
          rebalanceCostUsd: result.rebalanceCostUsd,
          fundingPeriods: result.fundingPeriods,
          positiveFundingPeriods: result.positiveFundingPeriods,
          negativeFundingPeriods: result.negativeFundingPeriods,
          avgFundingRate8h: result.avgFundingRate8h,
          startTime: result.startTime,
          endTime: result.endTime,
        },
        equityCurveSampled: result.equityCurve.filter((_, i) => i % 24 === 0),
        walkForward: walkForwardResult,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[funding-flip-kill-switch] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[funding-flip-kill-switch] FATAL:", err);
  process.exit(1);
});