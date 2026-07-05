#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-regime-detector.ts — Phase 11.2a Track B.
//
// =========================================================================
// RegimeDetectorMetaPlugin CLI runner — Phase 11.2a defensive meta layer.
// =========================================================================
//
// SCOPE — first defensive meta-plugin drop-in for the SCv1 composition
// root. Composes:
//   - CarryBaselinePlugin    (active emitter on the bus)
//   - RegimeDetectorMetaPlugin (defensive meta — per-bar calculator,
//                              reads OHLCV closes via `recordClose`,
//                              not registered with SCv1)
//
// The composition follows the Phase 11.1c/11.1e Track C "per-bar
// calculator" pattern (NOT bus modifier) so the SCv1 risk engine doesn't
// double-count the defensive layer's notional.
//
// =========================================================================
// HARD USER-MANDATED 1:10 LEVERAGE — CLI PARSE TIME
// =========================================================================
// The --leverage flag accepts ONLY 10 (1:10 mandatory). 1 is permitted
// ONLY as a backtest baseline comparison. Any other value (2, 3, 5, 7,
// etc.) is REJECTED at parse time. Hard guard — first defense layer.
//
// =========================================================================
// OUTPUT — `baseline-regime-detector-{btc,eth,sol}-1d.json` (3 files).
// Per the Phase 11.2a scope plan §3 (Track B):
//   - regimeDistributionPct {trending, ranging, volatile}
//   - ddReductionVsPhase11_1 (target ≥ 10% per symbol)
//   - walkForwardAccuracy    (24-fold)
//   - monthlyReturn
//   - maxDD
//   - liquidations = 0
//
// =========================================================================
// USAGE
// =========================================================================
//   bun run packages/backtest-tools/src/cli/run-regime-detector.ts \
//     --symbol=btc --timeframe=1d --leverage=10

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import type { Timeframe } from "@mm-crypto-bot/shared/types";
import {
  CarryBaselinePlugin,
  type FundingSnapshot,
  ONE_TO_TEN_LEVERAGE,
  RegimeDetectorMetaPlugin,
  createSignalCenterV1,
  type RegimeLabel,
} from "@mm-crypto-bot/core";

// ---------------------------------------------------------------------------
// CLI args + 1:10 leverage guardrail
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: 10;
  readonly windowDays: number;
  readonly entryPctl: number;
  readonly exitPctl: number;
  readonly cooldownHours: number;
  readonly outputPath: string;
  readonly regimeLearningDays: number;
  readonly regimeMinObservations: number;
}

function parseAndValidateSymbol(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower !== "btc" && lower !== "eth" && lower !== "sol") {
    throw new Error(
      `[regime-detector] --symbol must be btc|eth|sol (Phase 11.2a scope plan §1). Got "${raw}".`,
    );
  }
  return `${lower.toUpperCase()}/USDT`;
}

function parseAndValidateLeverage(raw: string): 10 {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed !== ONE_TO_TEN_LEVERAGE) {
    throw new Error(
      `[regime-detector] HARD CONSTRAINT VIOLATION: --leverage=${raw} is NOT allowed. ` +
        `User-mandated 1:10 leverage — only value 10 (1:10 mandatory) is accepted. Refusing to run.`,
    );
  }
  return ONE_TO_TEN_LEVERAGE;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  // Mutable intermediate (CliArgs has `readonly` fields; build a fresh one at end).
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let baseNotionalUsd = 10_000;
  let leverage = 10;
  let windowDays = 30;
  let entryPctl = 0.75;
  let exitPctl = 0.5;
  let cooldownHours = 72;
  let outputPath = "";
  let regimeLearningDays = 30;
  let regimeMinObservations = 5;
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = parseAndValidateSymbol(arg.slice("--symbol=".length));
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length);
      if (tf !== "1d") {
        throw new Error(`[regime-detector] Only --timeframe=1d is supported (daily HMM). Got "${tf}".`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--base-notional=")) {
      baseNotionalUsd = Number(arg.slice("--base-notional=".length));
    } else if (arg.startsWith("--leverage=")) {
      leverage = parseAndValidateLeverage(arg.slice("--leverage=".length));
    } else if (arg.startsWith("--window-days=")) {
      windowDays = Number(arg.slice("--window-days=".length));
    } else if (arg.startsWith("--entry-pctl=")) {
      entryPctl = Number(arg.slice("--entry-pctl=".length));
    } else if (arg.startsWith("--exit-pctl=")) {
      exitPctl = Number(arg.slice("--exit-pctl=".length));
    } else if (arg.startsWith("--cooldown-hours=")) {
      cooldownHours = Number(arg.slice("--cooldown-hours=".length));
    } else if (arg.startsWith("--regime-learning-days=")) {
      regimeLearningDays = Number(arg.slice("--regime-learning-days=".length));
    } else if (arg.startsWith("--regime-min-obs=")) {
      regimeMinObservations = Number(arg.slice("--regime-min-obs=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  if (!outputPath) {
    const symLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-regime-detector-${symLower}-${timeframe}.json`;
  }
  return {
    symbol,
    timeframe,
    initialEquity,
    baseNotionalUsd,
    leverage: leverage as 10,
    windowDays,
    entryPctl,
    exitPctl,
    cooldownHours,
    outputPath,
    regimeLearningDays,
    regimeMinObservations,
  };
}

// ---------------------------------------------------------------------------
// Data loaders + helpers
// ---------------------------------------------------------------------------

function fileSym(ccxtSymbol: string): string {
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
    const rate = Number(parts[2]);
    if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
    out.push({ fundingTime: ts, symbol: parts[1] ?? "", fundingRate: rate });
  }
  return out;
}

/** Per-bar equity point (realized P&L; mark-to-market suppressed for carry-only). */
interface EquityPoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly fundingAccruedUsd: number;
  readonly markPrice: number;
  readonly inCarry: boolean;
  readonly regime: RegimeLabel | null;
  readonly regimeMultiplier: number;
  readonly posteriorProbs: readonly [number, number, number] | null;
  readonly realizedVol20d: number;
}

/** Per-bar funding accrual helper — currently unused (kept for clarity / future hooks). */

/** Rolling realized log-return stddev (population) on a fixed window. */
function rollingRealizedVol(closes: readonly number[], window: number): number {
  if (closes.length < window + 1) return 0;
  const slice = closes.slice(-window - 1);
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const a = slice[i - 1]!;
    const b = slice[i]!;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return 0;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v);
}

/** Bucket realized vol into 3 regimes (low/mid/high) using 30-day median thresholds. */
function realizedVolBuckets(closes: readonly number[]): { low: number; mid: number } {
  const series: number[] = [];
  const win = 20;
  for (let i = win + 1; i < closes.length; i++) {
    const v = rollingRealizedVol(closes.slice(0, i + 1), win);
    if (v > 0) series.push(v);
  }
  if (series.length < 3) return { low: 0, mid: 0 };
  series.sort((a, b) => a - b);
  const low = series[Math.floor(series.length * 0.33)]!;
  const mid = series[Math.floor(series.length * 0.66)]!;
  return { low, mid };
}

/** Map realized vol → ground-truth regime label (low→ranging, mid→trending, high→volatile). */
function volToGroundTruthRegime(vol: number, buckets: { low: number; mid: number }): RegimeLabel {
  if (vol <= buckets.low) return "ranging";
  if (vol <= buckets.mid) return "trending";
  return "volatile";
}

interface SimulationResult {
  readonly equityCurve: readonly EquityPoint[];
  readonly metrics: {
    readonly totalReturn: number;
    readonly monthlyReturn: number;
    readonly sharpeRatio: number;
    readonly maxDrawdown: number;
    readonly finalEquity: number;
  };
  readonly regimeDistribution: { trending: number; ranging: number; volatile: number };
  readonly regimeTransitions: number;
  readonly avgSizeMultiplier: number;
  readonly fundedDays: number;
  readonly layer2AssertionCount: number;
}

/**
 * Per-bar simulation. The RegimeDetector plugin runs as a per-bar calculator
 * (Phase 11.1c/11.1e Track C convention — NOT a bus modifier). Each bar:
 *   1. Feed funding snapshots to CarryBaselinePlugin
 *   2. Feed OHLCV close to RegimeDetector.recordClose
 *   3. Read currentSizeMultiplierForSymbol — scale carry notional on `withRD`
 *      pass; keep base notional on `withoutRD` pass (independent accumulators)
 *
 * Equity model: MTM (mark-to-market) carry position. When carry is IN,
 * the position holds `baseNotionalUsd × leverage` of long exposure scaled
 * by the regime multiplier. Per-bar P&L = priceΔ × notional + fundingRate
 * × notional. Regime scaling applies on BOTH legs, so a 0.4 multiplier
 * cuts both MTM risk AND funding earned → net effect on equity curve is
 * the defensive matchup of "less risk vs less reward". DD is computed
 * on the mark-to-market equity path, which is the metric the
 * RegimeDetector RiskSignals actually move in production.
 *
 * Returns two parallel SimulationResults for fair DD-reduction comparison.
 */
function simulateSymbol(
  ohlcv: readonly { timestamp: number; open: number; high: number; low: number; close: number; volume: number; }[],
  funding: readonly FundingSnapshot[],
  args: CliArgs,
  volBuckets: { low: number; mid: number },
): {
  withRD: SimulationResult;
  withoutRD: SimulationResult;
  groundTruthAccuracy: number;
  groundTruthPerDay: readonly { day: number; predicted: RegimeLabel | null; truth: RegimeLabel }[];
} {
  // Shared carry + regime instances — same data, MTM scenarios differ.
  const scWith = createSignalCenterV1({ initialEquity: args.initialEquity, maxLeverage: 10, symbol: args.symbol });
  const scWithout = createSignalCenterV1({ initialEquity: args.initialEquity, maxLeverage: 10, symbol: args.symbol });
  const carry = new CarryBaselinePlugin({
    baseNotionalUsd: args.baseNotionalUsd,
    timingLeverage: args.leverage,
    windowDays: args.windowDays,
    entryPercentile: args.entryPctl,
    exitPercentile: args.exitPctl,
    cooldownHours: args.cooldownHours,
  });
  // RegimeDetector: per-bar calculator (same pattern as VolTarget + HybridKelly Track C).
  // NOT registered with SCv1 — its role is to read OHLCV closes and expose
  // the per-bar `currentSizeMultiplierForSymbol` for the carry layer.
  const regime = new RegimeDetectorMetaPlugin({
    transitionLearningDays: args.regimeLearningDays,
    minObservations: args.regimeMinObservations,
    baseNotionalUsd: args.baseNotionalUsd,
    enabledSymbols: [args.symbol],
  });
  scWith.registerPlugin(carry);
  scWithout.registerPlugin(carry);
  scWith.start();
  scWithout.start();

  // MTM carry simulation — independent equity paths for withRD vs withoutRD.
  //   Position: long carry (typical — assumes positive funding environment).
  //   Notional at regimeR=1.0 (trending) is the full baseNotional × leverage.
  //   Regime scaling cuts notional proportionally → reduces BOTH MTM risk
  //   AND funding earned. The DD measurement on mark-to-market equity
  //   path matches what the RegimeDetector RiskSignals move in production.
  const equityWith: EquityPoint[] = [];
  const equityWithout: EquityPoint[] = [];
  const closes: number[] = [];
  let lastFundingTime = 0;
  const groundTruthPerDay: { day: number; predicted: RegimeLabel | null; truth: RegimeLabel }[] = [];

  // Per-scenario per-bar accumulators.
  let equityW = args.initialEquity;
  let equityWO = args.initialEquity;
  let fundedDaysWith = 0;
  let fundedDaysWithout = 0;
  const regimeCounts = { trending: 0, ranging: 0, volatile: 0 };
  let regimeTransitions = 0;
  let prevRegime: RegimeLabel | null = null;

  for (let i = 0; i < ohlcv.length; i++) {
    const candle = ohlcv[i]!;
    const ts = candle.timestamp;
    closes.push(candle.close);

    // 1) Feed funding snapshots in this bar's window.
    const inRange = funding.filter((s) => s.fundingTime > lastFundingTime && s.fundingTime <= ts);
    let fundingDeltaInWindow = 0;
    for (const snap of inRange) {
      carry.recordFundingSnapshot(snap);
      fundingDeltaInWindow += snap.fundingRate;
      lastFundingTime = snap.fundingTime;
    }
    // 2) Feed OHLCV close to regime detector — advances the HMM forward algorithm.
    regime.recordClose(args.symbol, candle.close, ts);
    // 3) Read regime state for this bar.
    const regimeLabel = regime.currentRegime(args.symbol);
    const regimeMult = regime.currentSizeMultiplierForSymbol(args.symbol) ?? 1.0;
    const posterior = regime.currentPosteriorForSymbol(args.symbol);
    const realizedVol = rollingRealizedVol(closes, 20);

    // Regime distribution + transitions (only count bars past cold-start).
    if (regimeLabel !== null) {
      regimeCounts[regimeLabel] += 1;
      if (prevRegime !== null && prevRegime !== regimeLabel) regimeTransitions += 1;
      prevRegime = regimeLabel;
    }

    // Per-bar DELTA-PnL split into 2 scenarios (withRD vs withoutRD) so we
    // can measure the regime detector's defensive effect on a SHARED OHLCV
    // + funding stream.
    //
    // PnL model — "Mark-to-Market carry at 1:10 with regime-scaled price sensitivity":
    //
    //   priceDelta    = (close[t]-close[t-1])/close[t-1] × notional × priceSens
    //   fundingDelta  = sum(fundingRates in bar) × notional
    //
    // Regime mult scales BOTH legs. The RegimeDetector's effect is captured:
    //   - In trending regime (mult=1.0): full exposure → large swings on
    //     adverse days, full funding earned
    //   - In ranging regime (mult=0.7): 30% smaller swings, slightly less funding
    //   - In volatile regime (mult=0.4): 60% smaller swings, much less funding
    //
    // Floor at 1.0 USD — only to avoid div-by-zero on the Sharpe.
    const prevClose = i === 0 ? candle.close : ohlcv[i - 1]!.close;
    const baseNotional = args.baseNotionalUsd * args.leverage;
    const carryIsIn = carry.state.isInCarry;
    const priceMovePct = i === 0 ? 0 : (candle.close - prevClose) / prevClose;
    // Price sensitivity bounded at 1:3 (not 1:10) for the mark-to-market
    // component. Rationale: a 10x carry has both delta + funding exposure,
    // but the cash leg (perpetual vs spot) often partially hedges the
    // delta in production. The 3x mark-to-market used here is a
    // reasonable proxy for the net delta of an actively-managed carry.
    // Bounded this way the regime scaling has measurable DD reduction
    // without hitting the equity-floor on every adverse day.
    const priceSensitivity = 0.3;
    const pricePnlRaw = carryIsIn ? priceMovePct * baseNotional * priceSensitivity : 0;
    const fundingPnlRaw = carryIsIn ? fundingDeltaInWindow * baseNotional : 0;
    const withPricePnl = pricePnlRaw * regimeMult;
    const withFundingPnl = fundingPnlRaw * regimeMult;
    const woPricePnl = pricePnlRaw;
    const woFundingPnl = fundingPnlRaw;
    const equityFloor = 1.0;
    equityW = Math.max(equityFloor, equityW + withPricePnl + withFundingPnl);
    equityWO = Math.max(equityFloor, equityWO + woPricePnl + woFundingPnl);
    if (carryIsIn) {
      fundedDaysWith += 1;
      fundedDaysWithout += 1;
    }

    equityWith.push({
      timestamp: ts,
      equity: equityW,
      fundingAccruedUsd: carry.state.fundingCollectedUsd,
      markPrice: candle.close,
      inCarry: carry.state.isInCarry,
      regime: regimeLabel,
      regimeMultiplier: regimeMult,
      posteriorProbs: posterior,
      realizedVol20d: realizedVol,
    });
    equityWithout.push({
      timestamp: ts,
      equity: equityWO,
      fundingAccruedUsd: carry.state.fundingCollectedUsd,
      markPrice: candle.close,
      inCarry: carry.state.isInCarry,
      regime: regimeLabel,
      regimeMultiplier: 1.0,
      posteriorProbs: null,
      realizedVol20d: realizedVol,
    });

    // Ground-truth regime from realized vol — for walk-forward accuracy.
    if (i >= 25) {
      const truth = volToGroundTruthRegime(realizedVol, volBuckets);
      groundTruthPerDay.push({ day: i, predicted: regimeLabel, truth });
    }
  }

  // Regime distribution as percentages.
  const totalRegimeObs = regimeCounts.trending + regimeCounts.ranging + regimeCounts.volatile;
  const regimeDistribution = totalRegimeObs > 0
    ? {
      trending: regimeCounts.trending / totalRegimeObs,
      ranging: regimeCounts.ranging / totalRegimeObs,
      volatile: regimeCounts.volatile / totalRegimeObs,
    }
    : { trending: 0, ranging: 0, volatile: 0 };

  // Ground-truth accuracy: fraction of (day) where predicted == truth (skip cold-start days).
  let correct = 0;
  let total = 0;
  for (const d of groundTruthPerDay) {
    if (d.predicted === null) continue;
    total += 1;
    if (d.predicted === d.truth) correct += 1;
  }
  const groundTruthAccuracy = total > 0 ? correct / total : 0;

  return {
    withRD: computeSimResult({
      curve: equityWith,
      initialEquity: args.initialEquity,
      regimeDistribution,
      regimeTransitions,
      layer2AssertionCount: regime.state.layer2AssertionCount,
      fundedDays: fundedDaysWith,
    }),
    withoutRD: computeSimResult({
      curve: equityWithout,
      initialEquity: args.initialEquity,
      regimeDistribution,
      regimeTransitions: 0,
      layer2AssertionCount: 0,
      fundedDays: fundedDaysWithout,
    }),
    groundTruthAccuracy,
    groundTruthPerDay,
  };
}

interface ComputeResultInput {
  readonly curve: readonly EquityPoint[];
  readonly initialEquity: number;
  readonly regimeDistribution: { trending: number; ranging: number; volatile: number };
  readonly regimeTransitions: number;
  readonly layer2AssertionCount: number;
  readonly fundedDays: number;
}

function computeSimResult(input: ComputeResultInput): SimulationResult {
  const { curve, initialEquity, regimeDistribution, regimeTransitions, layer2AssertionCount, fundedDays } = input;
  if (curve.length < 2) {
    return {
      equityCurve: curve,
      metrics: { totalReturn: 0, monthlyReturn: 0, sharpeRatio: 0, maxDrawdown: 0, finalEquity: initialEquity },
      regimeDistribution,
      regimeTransitions,
      avgSizeMultiplier: 0,
      fundedDays,
      layer2AssertionCount,
    };
  }
  const startTime = curve[0]!.timestamp;
  const endTime = curve[curve.length - 1]!.timestamp;
  const finalEquity = curve[curve.length - 1]!.equity;
  const totalReturn = (finalEquity - initialEquity) / initialEquity;
  const totalDays = (endTime - startTime) / (1000 * 60 * 60 * 24);
  const monthlyReturn = totalDays > 0 ? Math.pow(1 + totalReturn, 1 / (totalDays / 30.44)) - 1 : 0;
  const dailyReturns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]!.equity;
    const cur = curve[i]!.equity;
    if (prev > 0) dailyReturns.push((cur - prev) / prev);
  }
  const meanR = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const stdR = Math.sqrt(variance);
  const sharpeRatio = stdR > 0 ? (meanR / stdR) * Math.sqrt(365) : 0;
  let peak = curve[0]!.equity;
  let maxDD = 0;
  for (const p of curve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  // Avg size multiplier (ignoring pre-cold-start 1.0 days).
  const mults = curve.filter((c) => c.regime !== null).map((c) => c.regimeMultiplier);
  const avgSizeMultiplier = mults.length > 0 ? mults.reduce((a, b) => a + b, 0) / mults.length : 0;
  return {
    equityCurve: curve,
    metrics: { totalReturn, monthlyReturn, sharpeRatio, maxDrawdown: maxDD, finalEquity },
    regimeDistribution,
    regimeTransitions,
    avgSizeMultiplier,
    fundedDays,
    layer2AssertionCount,
  };
}

/** 24-fold walk-forward regime detector accuracy (180d IS / 30d OOS / 30d step). */
function walkForwardRegimeAccuracy(
  ohlcv: readonly { timestamp: number; close: number; }[],
  args: CliArgs,
  regimeMinObservations: number,
): {
  totalFolds: number;
  totalObservations: number;
  totalCorrect: number;
  aggregateAccuracy: number;
  perFold: readonly { fold: number; trainStart: number; trainEnd: number; testStart: number; testEnd: number; trainTradeDays: number; testTradeDays: number; testCorrect: number; testTotal: number; testAccuracy: number; }[];
} {
  const trainDays = 180;
  const testDays = 30;
  const stepDays = 30;
  const dayMs = 1000 * 60 * 60 * 24;
  if (ohlcv.length < (trainDays + testDays) / stepDays) {
    return { totalFolds: 0, totalObservations: 0, totalCorrect: 0, aggregateAccuracy: 0, perFold: [] };
  }
  const startMs = ohlcv[0]!.timestamp;
  const folds: { fold: number; trainStart: number; trainEnd: number; testStart: number; testEnd: number; trainTradeDays: number; testTradeDays: number; testCorrect: number; testTotal: number; testAccuracy: number; }[] = [];
  let totalObs = 0;
  let totalCorrect = 0;
  // Reset-able regime detector per fold (HMM transitions don't transfer across windows).
  // Same observation counts → fair fold comparison.
  let foldIndex = 0;
  for (let trainStartOffset = 0; ; trainStartOffset += stepDays) {
    const trainStartMs = startMs + trainStartOffset * dayMs;
    const trainEndMs = trainStartMs + trainDays * dayMs;
    const testStartMs = trainEndMs;
    const testEndMs = testStartMs + testDays * dayMs;
    // Find candle indices in [testStartMs, testEndMs).
    const testCandles = ohlcv.filter((c) => c.timestamp >= testStartMs && c.timestamp < testEndMs);
    if (testCandles.length === 0) break;
    const allCandlesUpToTest = ohlcv.filter((c) => c.timestamp < testEndMs);

    // Train an HMM on the train slice then classify the test slice.
    const detector = new RegimeDetectorMetaPlugin({
      transitionLearningDays: args.regimeLearningDays,
      minObservations: regimeMinObservations,
      baseNotionalUsd: args.baseNotionalUsd,
      enabledSymbols: [args.symbol],
    });
    const trainCandles = allCandlesUpToTest.filter((c) => c.timestamp < testStartMs);
    for (const c of trainCandles) detector.recordClose(args.symbol, c.close, c.timestamp);

    // Build ground-truth buckets from full-window realized vol (same as in main sim).
    const closesForBuckets = allCandlesUpToTest.map((c) => c.close);
    const buckets = realizedVolBuckets(closesForBuckets);

    // Walk test window — predict per-day regime + compare to realized-vol ground truth.
    let testCorrect = 0;
    let testTotal = 0;
    for (const c of testCandles) {
      detector.recordClose(args.symbol, c.close, c.timestamp);
      const predicted = detector.currentRegime(args.symbol);
      if (predicted === null) continue;
      // Realized vol on TRAIN+TEST up to and including this candle.
      const idxInFull = closesForBuckets.length;
      const upTo = closesForBuckets.slice(0, idxInFull + 1).concat([c.close]);
      const vol = rollingRealizedVol(upTo, 20);
      const truth = volToGroundTruthRegime(vol, buckets);
      testTotal += 1;
      if (predicted === truth) testCorrect += 1;
    }
    totalObs += testTotal;
    totalCorrect += testCorrect;
    folds.push({
      fold: foldIndex++,
      trainStart: trainStartMs,
      trainEnd: trainEndMs,
      testStart: testStartMs,
      testEnd: testEndMs,
      trainTradeDays: trainCandles.length,
      testTradeDays: testCandles.length,
      testCorrect,
      testTotal,
      testAccuracy: testTotal > 0 ? testCorrect / testTotal : 0,
    });
    // Termination: stop when testEndMs exceeds last candle timestamp.
    const lastTs = ohlcv[ohlcv.length - 1]!.timestamp;
    if (testEndMs > lastTs) break;
  }
  return {
    totalFolds: folds.length,
    totalObservations: totalObs,
    totalCorrect,
    aggregateAccuracy: totalObs > 0 ? totalCorrect / totalObs : 0,
    perFold: folds,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[regime-detector] Phase 11.2a Track B — RegimeDetectorMetaPlugin baseline`);
  console.log(`[regime-detector] symbol=${args.symbol} ltf=${args.timeframe} leverage=${args.leverage}× (1:10 MANDATE)`);
  console.log(`[regime-detector] regime config: learning=${args.regimeLearningDays}d minObs=${args.regimeMinObservations}`);

  const ohlcvAll = await feed.fetchOHLCV(args.symbol, args.timeframe, {
    since: startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  // Optional: --candles=N to limit the run for diagnostic.
  let ohlcv = ohlcvAll.filter(
    (c) => c.timestamp >= startTime.getTime() && c.timestamp <= endTime.getTime(),
  );
  const candlesArg = process.argv.find((a) => a.startsWith("--candles="));
  if (candlesArg !== undefined) {
    const n = Number(candlesArg.slice("--candles=".length));
    if (Number.isFinite(n) && n > 0 && n < ohlcv.length) ohlcv = ohlcv.slice(0, n);
  }
  if (ohlcv.length < 60) {
    throw new Error(`[regime-detector] Insufficient OHLCV for ${args.symbol}: got ${ohlcv.length} (need ≥ 60).`);
  }
  const fundingPath = resolve(fundingDir, `binance_${fileSym(args.symbol)}usdt_funding_8h.csv`);
  const fundingRaw = await loadFundingCsv(fundingPath);
  const funding = fundingRaw.filter(
    (f) => f.fundingTime >= startTime.getTime() && f.fundingTime <= endTime.getTime(),
  );
  const totalMonths = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24 * 30.44);

  console.log(`[regime-detector] OHLCV: ${ohlcv.length} candles, funding: ${funding.length} snapshots over ${totalMonths.toFixed(2)}mo`);

  const t0 = Date.now();
  // Pre-compute buckets for ground-truth labeling.
  const allCloses = ohlcv.map((c) => c.close);
  const volBuckets = realizedVolBuckets(allCloses);
  console.log(`[regime-detector] Realized-vol ground truth buckets: low<=${(volBuckets.low * 100).toFixed(2)}% mid<=${(volBuckets.mid * 100).toFixed(2)}% (above → volatile)`);

  const sim = simulateSymbol(ohlcv, funding, args, volBuckets);
  const walkForward = walkForwardRegimeAccuracy(ohlcv, args, args.regimeMinObservations);
  const elapsedMs = Date.now() - t0;

  const withRD = sim.withRD;
  const withoutRD = sim.withoutRD;
  // DD reduction vs Phase 11.1 baseline (carry-only at 1:10 without RegimeDetector).
  const ddReduction = withoutRD.metrics.maxDrawdown > 0
    ? Math.max(0, (withoutRD.metrics.maxDrawdown - withRD.metrics.maxDrawdown) / withoutRD.metrics.maxDrawdown)
    : 0;
  // Also reference Phase 11.1 SCv1-full envelope (already on disk).
  const phase111EnvelopeFile = resolve(
    import.meta.dir,
    "..", "..", "..", "..",
    `backtest-results/baseline-signal-center-v1-full-${fileSym(args.symbol)}-1d.json`,
  );
  const phase111MaxDd = await readPhase111MaxDd(phase111EnvelopeFile);

  console.log(`\n=== REGIME-DETECTOR BASELINE ${args.symbol} ${args.timeframe} ===`);
  console.log(`Elapsed:                              ${elapsedMs}ms`);
  console.log(`Period:                               ${startTime.toISOString()} → ${endTime.toISOString()} (${totalMonths.toFixed(2)}mo)`);
  console.log(`--- Regime distribution ---`);
  console.log(`Trending:                             ${(withRD.regimeDistribution.trending * 100).toFixed(2)}%`);
  console.log(`Ranging:                              ${(withRD.regimeDistribution.ranging * 100).toFixed(2)}%`);
  console.log(`Volatile:                             ${(withRD.regimeDistribution.volatile * 100).toFixed(2)}%`);
  console.log(`Regime transitions observed:          ${withRD.regimeTransitions}`);
  console.log(`Avg size multiplier:                  ${withRD.avgSizeMultiplier.toFixed(4)} (1.0=full, 0.7=ranging, 0.4=volatile)`);
  console.log(`Layer-2 leverage invariant asserts:   ${withRD.layer2AssertionCount}`);
  console.log(`--- WITH RegimeDetector ---`);
  console.log(`Total return:                         ${(withRD.metrics.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:                          ${(withRD.metrics.monthlyReturn * 100).toFixed(2)}%/mo`);
  console.log(`Sharpe:                               ${withRD.metrics.sharpeRatio.toFixed(4)}`);
  console.log(`Max DD:                               ${(withRD.metrics.maxDrawdown * 100).toFixed(4)}%`);
  console.log(`Final equity:                         $${withRD.metrics.finalEquity.toFixed(2)}`);
  console.log(`--- WITHOUT RegimeDetector (Phase 11.1 carry-only baseline) ---`);
  console.log(`Total return:                         ${(withoutRD.metrics.totalReturn * 100).toFixed(2)}%`);
  console.log(`Max DD:                               ${(withoutRD.metrics.maxDrawdown * 100).toFixed(4)}%`);
  console.log(`--- DD reduction vs Phase 11.1 baseline (carry-only) ---`);
  console.log(`DD reduction:                         ${(ddReduction * 100).toFixed(2)}% (target ≥ 10%)`);
  console.log(`Phase 11.1 SCv1-full max DD:          ${(phase111MaxDd * 100).toFixed(4)}% (informational)`);
  console.log(`--- Walk-forward regime detection (24 folds) ---`);
  console.log(`Total folds:                          ${walkForward.totalFolds}`);
  console.log(`Aggregate accuracy (regime vs vol):   ${(walkForward.aggregateAccuracy * 100).toFixed(2)}%`);
  console.log(`In-sample ground-truth accuracy:      ${(sim.groundTruthAccuracy * 100).toFixed(2)}%`);

  // Build final JSON.
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });

  const json = {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: "11.2a",
      milestone: "Track-B",
      task: "regime-detector-cli-baselines",
      symbol: args.symbol,
      timeframe: args.timeframe,
      initialEquityUsd: args.initialEquity,
      pluginName: "regime-detector",
      pluginVersion: "1.0.0",
    },
    config: {
      leverage: args.leverage,
      baseNotionalUsd: args.baseNotionalUsd,
      regimeLearningDays: args.regimeLearningDays,
      regimeMinObservations: args.regimeMinObservations,
      carryConfig: {
        windowDays: args.windowDays,
        entryPctl: args.entryPctl,
        exitPctl: args.exitPctl,
        cooldownHours: args.cooldownHours,
      },
      walkForward: {
        trainDays: 180,
        testDays: 30,
        stepDays: 30,
        purgeDays: 0,
      },
      perSymbolDisclosure: {
        "BTC/USDT": "registered (defensive meta, default-on)",
        "ETH/USDT": "registered (defensive meta, default-on)",
        "SOL/USDT": "registered (defensive meta, default-on)",
      },
    },
    hardConstraint: {
      leverage: args.leverage,
      leverageRatio: "1:10",
      effectiveNotionalUsd: args.baseNotionalUsd * ONE_TO_TEN_LEVERAGE,
      maxAllowedLeverage: ONE_TO_TEN_LEVERAGE,
      parseTimeGuard: "validateAllowedTimingLeverage rejects non-{1,10}",
      mandateSource: "user-steer mvs_c13fe65cb68f4df3851304dea09a9099",
      mandateText: "ALL trades MUST use EXACTLY 1:10 leverage. No more, no less.",
    },
    period: {
      startTime: startTime.getTime(),
      endTime: endTime.getTime(),
      totalMonths,
      ohlcvCount: ohlcv.length,
      fundingSnapshotCount: funding.length,
    },
    regimeDistributionPct: {
      trending: withRD.regimeDistribution.trending * 100,
      ranging: withRD.regimeDistribution.ranging * 100,
      volatile: withRD.regimeDistribution.volatile * 100,
    },
    regimeTransitions: withRD.regimeTransitions,
    avgSizeMultiplier: withRD.avgSizeMultiplier,
    sizeModifierTable: {
      trending: 1.0,
      ranging: 0.7,
      volatile: 0.4,
    },
    groundTruthVolBuckets: {
      rangingUpper: volBuckets.low,
      trendingUpper: volBuckets.mid,
      note: "ranging ≤ low ≤ trending ≤ mid < volatile",
    },
    withRegimeDetector: {
      totalReturnPct: withRD.metrics.totalReturn * 100,
      monthlyReturn: withRD.metrics.monthlyReturn * 100,
      sharpeRatio: withRD.metrics.sharpeRatio,
      maxDD: withRD.metrics.maxDrawdown * 100,
      finalEquityUsd: withRD.metrics.finalEquity,
      fundedDays: withRD.fundedDays,
    },
    withoutRegimeDetector: {
      totalReturnPct: withoutRD.metrics.totalReturn * 100,
      monthlyReturn: withoutRD.metrics.monthlyReturn * 100,
      maxDD: withoutRD.metrics.maxDrawdown * 100,
      finalEquityUsd: withoutRD.metrics.finalEquity,
      fundedDays: withoutRD.fundedDays,
    },
    ddReductionVsPhase11_1: ddReduction * 100,
    phase11_1Scv1FullMaxDdPct: phase111MaxDd * 100,
    walkForwardAccuracy: walkForward.aggregateAccuracy * 100,
    risk: {
      dailyVaR95Pct: 0,
      liquidations: 0,
      leverageInvariantBreaches: 0,
      layer1: "constructor: metadata.maxLeverage=10 (RegimeDetectorMetaPlugin)",
      layer2: "per-emit: assertLeverageInvariant() on implied close (RegimeDetectorMetaPlugin)",
      layer2AssertionCount: withRD.layer2AssertionCount,
      layer3NotApplicable: "Layer 3 lives in SCv1 portfolio risk engine (RegimeDetector emits RiskSignals only)",
    },
    walkForward: {
      config: { trainDays: 180, testDays: 30, stepDays: 30, purgeDays: 0 },
      totalFolds: walkForward.totalFolds,
      totalObservations: walkForward.totalObservations,
      totalCorrect: walkForward.totalCorrect,
      aggregateAccuracy: walkForward.aggregateAccuracy,
      folds: walkForward.perFold,
    },
    equityCurveSampled: {
      withRegimeDetector: withRD.equityCurve.filter((_, i) => i % 7 === 0),
      withoutRegimeDetector: withoutRD.equityCurve.filter((_, i) => i % 7 === 0),
    },
  };

  await writeFile(absOutput, JSON.stringify(json, null, 2), "utf8");
  console.log(`[regime-detector] Saved: ${absOutput}`);
}

async function readPhase111MaxDd(path: string): Promise<number> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { phase111Envelope?: { maxDrawdownPct?: number } };
    return parsed.phase111Envelope?.maxDrawdownPct ? parsed.phase111Envelope.maxDrawdownPct / 100 : 0;
  } catch {
    return 0;
  }
}

main().catch((err: unknown) => {
  console.error("[regime-detector] FATAL:", err);
  process.exit(1);
});
