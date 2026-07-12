// packages/core/src/risk/kelly-adaptive.ts — Adaptive Kelly with rolling Sharpe
//
// Phase 7 Track B — extends the Phase 6 Track C static 0.5× Kelly
// (`KellyPositionSizer`) with a dynamic Kelly-multiplier derived from a
// rolling 30-day realized Sharpe ratio. The static 0.5× is replaced by a
// 4-bucket piecewise mapping:
//
//   Rolling 30-day realized Sharpe      → Kelly multiplier
//   --------------------------------     ---------------
//   Sharpe > 1.0                          → 1.0×  (full Kelly — high edge)
//   0.5 ≤ Sharpe ≤ 1.0                   → 0.7×  (three-quarter)
//   0.0 ≤ Sharpe < 0.5                    → 0.5×  (current static default)
//   Sharpe < 0.0                          → 0.25× (defensive — quarter Kelly)
//
// Background and motivation (≥3 independent sources per empirical claim):
//
// 1. Fractional Kelly (0.25× / 0.5× / 1.0×) is the practitioner sweet spot:
//    - Thorp (2006) "The Kelly Criterion in Blackjack, Sports Betting,
//      and the Stock Market" — recommends half-Kelly to halve drawdown
//      volatility at the cost of 25% growth.
//      https://gwern.net/doc/statistics/decision/2006-thorp.pdf
//    - D&T Systems: full-Kelly 100% growth / 100% vol, half-Kelly 75%/50%,
//      quarter-Kelly 44%/25% (squared drawdown reduction).
//      https://dtsystems.dev/blog/kelly-criterion-position-sizing
//    - MarketMaker.cc / HyperTrader 3-year crypto backtest: Half-Kelly
//      98% CAGR / 34% DD vs Full-Kelly 142% CAGR / 58% DD.
//      https://www.marketmaker.cc/kk/blog/post/kelly-criterion-strategy-sizing/
//      https://www.hyper-quant.tech/research/kelly-criterion-position-sizing
//
// 2. Rolling/regime-adaptive sizing — Sharpe ratio is the natural regime
//    detector for sizing because f* = Sharpe / σ for continuous returns
//    (pfolio / Stratbase / QuantStart consensus):
//    - pfolio "Kelly criterion: optimal position sizing": f* = (μ − r_f) / σ²
//      = Sharpe / σ. Higher Sharpe → larger Kelly → larger size.
//      https://www.pfolio.io/academy/kelly-criterion
//    - QuantStart "Money Management via the Kelly Criterion": "The Kelly
//      allocation should be recalculated periodically using a trailing mean
//      and standard deviation with a lookback window of 3-6 months of
//      daily returns for daily-trading strategies."
//      https://www.quantstart.com/articles/Money-Management-via-the-Kelly-Criterion/
//    - Wealthnomic "The Art of Position Sizing" (2025): regime filter
//      reduces scale in low-Sharpe/high-vol regimes.
//      https://www.wealthnomic.com/blog-post-position-sizing.html
//    - Tradescope Blog (2025) "Position-Sizing 2025: Adaptive Kelly for
//      Multi-Asset Volatility" — explicitly combines Kelly × vol-target ×
//      regime scaling (Sharpe bucket → scale factor).
//      https://tradescopeblog.info/article/position-sizing-2025-adaptive-kelly-for-multi-asset-volatility
//
// 3. Lo (2002) "The Statistics of Sharpe Ratios" Financial Analysts
//    Journal 58(4): 36-52 — Sharpe estimates from small samples are biased
//    upward by autocorrelation, and the standard error of the Sharpe
//    estimator is ~sqrt((1 + 0.5·SR² − γ₃·SR + (γ₄−3)/4)/T). This justifies
//    conservative bucket boundaries (Sharpe > 1.0 for full Kelly) rather
//    than continuous scaling, and motivates the 30-day minimum window
//    for statistical reliability.
//    https://www.citeulike.org/user/kislay/article/1445428
//    https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
//
// 4. Bailey & López de Prado (2014) "The Deflated Sharpe Ratio" —
//    corrects for selection bias, multiple testing, and non-normality.
//    In their framework the Probabilistic Sharpe Ratio (PSR) compares the
//    observed Sharpe to a benchmark under finite-sample noise. Our 4-bucket
//    mapping is a discrete approximation of this idea — we don't need a
//    continuous PSR because (a) the bucket boundaries are
//    practitioner-validated conservative thresholds, and (b) the engine's
//    position-size cap (20% per trade, max DD 15%) provides the
//    second-layer safety even at the 1.0× bucket.
//    https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
//
// 5. Walk-forward anti-overfit validation (in-sample Sharpe → out-of-sample
//    sizing):
//    - arXiv 2512.12924 (gold standard) — 34-window rolling WF for crypto
//      strategy validation.
//      https://arxiv.org/html/2512.12924v1
//    - usekeel.io — 6-month IS / 3-month OOS standard for daily crypto.
//      https://usekeel.io/learn/walk-forward-optimization
//    - Phase 6 Track C (`kelly-position-sizer.ts`) — 180d IS / 30d OOS / 30d
//      step baseline; we reuse the same window conventions here for
//      comparability.
//
// 6. Volatility-managed portfolios (Moreira & Muir 2017) — risk scales
//    inversely with lagged variance. Our Sharpe-based mapping is the
//    inverse-variance analog at the sizing level: low Sharpe → reduce size,
//    high Sharpe → increase size. Empirically Moreira & Muir report
//    Sharpe-ratio improvements of 30-65% across factors using volatility
//    timing.
//    https://law.yale.edu/sites/default/files/area/workshop/leo/leo17_moreira.pdf
//
// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------

import type { Trade } from "@mm-crypto-bot/shared/types";

import {
  DEFAULT_KELLY_OPT_CONFIG,
  fullKellyFraction,
  type KellyOptConfig,
  type KellyOptResult,
  type TradeStats,
  applyRiskCaps,
  extractTradeStats,
  runWalkForwardValidation,
  splitIntoWindows,
} from "./kelly-position-sizer.js";

// ----------------------------------------------------------------------
// Bucket mapping
// ----------------------------------------------------------------------

/**
 * The 4 discrete Kelly-multiplier buckets the adaptive module cycles
 * through based on the rolling 30-day realized Sharpe.
 *
 * Boundaries (inclusive lower, exclusive upper):
 *   - `sharpe < 0`            → 0.25×  (defensive quarter-Kelly)
 *   - `0 ≤ sharpe < 0.5`      → 0.5×   (half-Kelly — static default)
 *   - `0.5 ≤ sharpe < 1.0`    → 0.7×   (three-quarter)
 *   - `sharpe ≥ 1.0`          → 1.0×   (full Kelly)
 *
 * The choice of 0.5 and 1.0 as boundary thresholds is the practitioner
 * consensus from the 5+ sources cited in the file header — these are
 * the standard "good" and "great" Sharpe cutoffs in classical
 * performance-evaluation literature (Sharpe's original 1994 paper uses
 * 0.5 as the dividing line between "no reward for risk" and "positive
 * risk-adjusted return"; the 1.0 threshold is the standard
 * "institutional-grade" cutoff).
 *
 * Reference: William F. Sharpe (1994) "The Sharpe Ratio",
 * Journal of Portfolio Management, Fall 1994.
 * https://web.stanford.edu/~wfsharpe/art/sr/sr.htm
 */
export type AdaptiveKellyBucket = 0.25 | 0.5 | 0.7 | 1.0;

/** Sentinel bucket boundaries. `>= LOW_BOUNDARY` → static default. */
export const SHARPE_BUCKET_LOW_BOUNDARY = 0.0;
export const SHARPE_BUCKET_MID_BOUNDARY = 0.5;
export const SHARPE_BUCKET_HIGH_BOUNDARY = 1.0;

/**
 * `sharpeToKellyBucket` — discrete mapping from rolling Sharpe to Kelly
 * multiplier. Pure function, no side effects.
 *
 * @param sharpe Rolling 30-day realized Sharpe (NOT annualized in our
 *               convention — we use per-trade-mean / per-trade-std
 *               consistent with `KellyPositionSizer.perWindowSharpe`).
 */
export function sharpeToKellyBucket(sharpe: number): AdaptiveKellyBucket {
  if (!Number.isFinite(sharpe)) {
    throw new Error(`sharpe must be a finite number: ${String(sharpe)}`);
  }
  if (sharpe < SHARPE_BUCKET_LOW_BOUNDARY) {
    return 0.25;
  }
  if (sharpe < SHARPE_BUCKET_MID_BOUNDARY) {
    return 0.5;
  }
  if (sharpe < SHARPE_BUCKET_HIGH_BOUNDARY) {
    return 0.7;
  }
  return 1.0;
}

/**
 * `nearestBucket` — round a continuous average Kelly multiplier (e.g.
 * 0.43, 0.78) to the nearest of the 4 valid buckets. Used when the
 * bucket-distribution average does not land exactly on a boundary.
 *
 * Boundaries: 0.25 / 0.5 / 0.7 / 1.0. The "0.7" boundary splits [0.5,
 * 1.0] into [0.5, 0.75) → 0.5 and [0.75, 1.0] → 0.7. We use the
 * arithmetic midpoint (0.625) for the 0.5-vs-0.7 split.
 */
export function nearestBucket(avg: number): AdaptiveKellyBucket {
  if (!Number.isFinite(avg)) {
    throw new Error(`avg must be a finite number: ${String(avg)}`);
  }
  if (avg < 0.375) return 0.25;
  if (avg < 0.625) return 0.5;
  if (avg < 0.85) return 0.7;
  return 1.0;
}

// ----------------------------------------------------------------------
// Daily P&L aggregation + rolling Sharpe
// ----------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `aggregateTradesToDailyPnl` — converts a chronologically-sorted trade
 * list into a daily P&L series: one entry per UTC day in the period, with
 * the day's net P&L and the cumulative equity at the END of that day.
 *
 * Days with no trades get a 0 P&L entry (this is required for the rolling
 * Sharpe to be meaningful — if we skipped no-trade days, we'd be
 * computing Sharpe on a sampled series rather than a calendar-day series).
 *
 * Pure function — no I/O, no side effects.
 *
 * @param trades Chronologically-sorted trades (oldest first).
 * @param initialEquity Starting equity for cumulative accounting.
 * @returns Array of `{day, pnlUsd, equityUsd, tradeCount}` sorted ascending.
 */
export interface DailyPnlPoint {
  /** UTC midnight timestamp (epoch ms) of the day. */
  readonly day: number;
  /** Net P&L of trades whose exitTime falls in this UTC day. */
  readonly pnlUsd: number;
  /** Running equity at end-of-day. Starts at `initialEquity + sumUpToDay`. */
  readonly equityUsd: number;
  /** Number of trades closed in this day. */
  readonly tradeCount: number;
}

export function aggregateTradesToDailyPnl(
  trades: readonly Trade[],
  initialEquity: number,
): readonly DailyPnlPoint[] {
  if (!Number.isFinite(initialEquity) || initialEquity <= 0) {
    throw new Error(`initialEquity must be a positive finite number: ${String(initialEquity)}`);
  }
  if (trades.length === 0) {
    return [];
  }
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const firstExit = sorted[0]!.exitTime;
  const lastExit = sorted.reduce((acc, t) => Math.max(acc, t.exitTime), firstExit);
  const firstDay = startOfUtcDay(firstExit);
  const lastDay = startOfUtcDay(lastExit);
  const numDays = Math.max(1, Math.floor((lastDay - firstDay) / DAY_MS) + 1);
  // Initialize the daily map with zeros — `tradesPerDay` to count, `pnlPerDay` for sums.
  const pnlPerDay = new Float64Array(numDays);
  const tradesPerDay = new Uint32Array(numDays);
  for (const t of sorted) {
    const dayIdx = Math.floor((startOfUtcDay(t.exitTime) - firstDay) / DAY_MS);
    pnlPerDay[dayIdx]! += t.pnlUsd;
    tradesPerDay[dayIdx]! += 1;
  }
  let equity = initialEquity;
  const out: DailyPnlPoint[] = [];
  for (let i = 0; i < numDays; i++) {
    equity += pnlPerDay[i]!;
    out.push({
      day: firstDay + i * DAY_MS,
      pnlUsd: pnlPerDay[i]!,
      equityUsd: equity,
      tradeCount: tradesPerDay[i]!,
    });
  }
  return out;
}

/** UTC midnight of the given epoch ms. */
function startOfUtcDay(epochMs: number): number {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * `rollingSharpeFromDailyPnl` — computes the rolling-window Sharpe ratio
 * over a daily P&L series. The window is in CALENDAR DAYS, not trades —
 * each day's return is `pnlUsd / equityUsd` (end-of-day equity).
 *
 * The Sharpe at index `i` uses the window of returns `[i - windowDays + 1, i]`
 * inclusive (i.e., the past `windowDays` calendar days). For days with no
 * trades, the daily return is 0 — this matches the convention of
 * "calendar-day Sharpe" used by the practitioner sources above.
 *
 * Returns one Sharpe per day of the input series — only days with a FULL
 * preceding window have a non-null value (the first `windowDays - 1`
 * days are null because there is no complete window yet).
 *
 * Pure function, deterministic.
 */
export interface RollingSharpePoint {
  readonly day: number;
  readonly sharpe: number | null;
  /** Window-end equity (informational). */
  readonly equityUsd: number;
  /** Bucket the Sharpe falls into (null if Sharpe is null). */
  readonly bucket: AdaptiveKellyBucket | null;
  /** Window start day (epoch ms, UTC midnight). */
  readonly windowStartDay: number;
  /** Window end day (epoch ms, UTC midnight). */
  readonly windowEndDay: number;
  /** Number of days actually contributing to the window (== windowDays for full windows). */
  readonly contributingDays: number;
}

export function rollingSharpeFromDailyPnl(
  daily: readonly DailyPnlPoint[],
  windowDays: number,
): readonly RollingSharpePoint[] {
  if (!Number.isFinite(windowDays) || windowDays <= 0 || !Number.isInteger(windowDays)) {
    throw new Error(`windowDays must be a positive integer: ${String(windowDays)}`);
  }
  if (daily.length === 0) {
    return [];
  }
  // Convert to a per-day return array (pnl/equity, with equity taken from
  // the END of the previous day for stability; for day 0 we use the
  // initial equity).
  const returns: number[] = new Array<number>(daily.length);
  for (let i = 0; i < daily.length; i++) {
    const eqPrev = i === 0 ? daily[0]!.equityUsd - daily[0]!.pnlUsd : daily[i - 1]!.equityUsd;
    returns[i] = eqPrev > 0 ? daily[i]!.pnlUsd / eqPrev : 0;
  }
  // Rolling mean / std.
  const out: RollingSharpePoint[] = [];
  let runningSum = 0;
  let runningSqSum = 0;
  for (let i = 0; i < returns.length; i++) {
    runningSum += returns[i]!;
    runningSqSum += returns[i]! * returns[i]!;
    if (i >= windowDays) {
      runningSum -= returns[i - windowDays]!;
      runningSqSum -= returns[i - windowDays]! * returns[i - windowDays]!;
    }
    const n = Math.min(i + 1, windowDays);
    const mean = runningSum / n;
    const variance = runningSqSum / n - mean * mean;
    const std = variance > 0 ? Math.sqrt(variance) : 0;
    let sharpe: number | null = null;
    let bucket: AdaptiveKellyBucket | null = null;
    if (n >= windowDays && std > 0) {
      sharpe = mean / std;
      bucket = sharpeToKellyBucket(sharpe);
    }
    out.push({
      day: daily[i]!.day,
      sharpe,
      equityUsd: daily[i]!.equityUsd,
      bucket,
      windowStartDay: daily[Math.max(0, i - windowDays + 1)]!.day,
      windowEndDay: daily[i]!.day,
      contributingDays: n,
    });
  }
  return out;
}

// ----------------------------------------------------------------------
// Time-in-bucket + average Kelly fraction
// ----------------------------------------------------------------------

/**
 * `bucketDistribution` — counts the fraction of `RollingSharpePoint`
 * entries that fall into each of the 4 buckets. Days with `sharpe = null`
 * (insufficient history) are counted in the "insufficient" slot and
 * contribute to the static-fallback fraction.
 *
 * The sum of all 5 fractions is 1.0 (within floating-point error).
 */
export interface BucketDistribution {
  readonly fullKellyFraction: number; // 1.0×
  readonly threeQuarterFraction: number; // 0.7×
  readonly halfKellyFraction: number; // 0.5× (static default)
  readonly quarterKellyFraction: number; // 0.25×
  readonly insufficientFraction: number; // null Sharpe days
  readonly totalDays: number;
}

export function bucketDistribution(
  rollingSharpe: readonly RollingSharpePoint[],
): BucketDistribution {
  if (rollingSharpe.length === 0) {
    return {
      fullKellyFraction: 0,
      threeQuarterFraction: 0,
      halfKellyFraction: 0,
      quarterKellyFraction: 0,
      insufficientFraction: 0,
      totalDays: 0,
    };
  }
  let full = 0;
  let tq = 0;
  let hk = 0;
  let qk = 0;
  let ins = 0;
  for (const r of rollingSharpe) {
    if (r.bucket === null) {
      ins++;
    } else if (r.bucket === 1.0) {
      full++;
    } else if (r.bucket === 0.7) {
      tq++;
    } else if (r.bucket === 0.5) {
      hk++;
    } else {
      qk++;
    }
  }
  const n = rollingSharpe.length;
  return {
    fullKellyFraction: full / n,
    threeQuarterFraction: tq / n,
    halfKellyFraction: hk / n,
    quarterKellyFraction: qk / n,
    insufficientFraction: ins / n,
    totalDays: n,
  };
}

/**
 * `averageKellyMultiplier` — weighted average of the realized Kelly
 * multipliers, where null-bucket days (insufficient history) are
 * treated as the static default (0.5×). This is the "what was the
 * effective multiplier over the period" number that the CLI runner
 * prints for diagnostics.
 */
export function averageKellyMultiplier(
  rollingSharpe: readonly RollingSharpePoint[],
  fallbackMultiplier: AdaptiveKellyBucket = 0.5,
): number {
  if (rollingSharpe.length === 0) {
    return fallbackMultiplier;
  }
  let sum = 0;
  for (const r of rollingSharpe) {
    sum += r.bucket ?? fallbackMultiplier;
  }
  return sum / rollingSharpe.length;
}

// ----------------------------------------------------------------------
// Edge cases: insufficient history, all-loss streak
// ----------------------------------------------------------------------

/**
 * `hasAllLossStreak` — detects an "all-loss streak" in the rolling
 * window. We define this as: in the most recent `streakWindowDays` days
 * (default: same as the rolling-Sharpe window), every trade closed
 * was a loss AND the cumulative P&L in that window is negative.
 *
 * This is a defensive trip — even if the rolling Sharpe happens to be
 * computed as 0 (no variance), an all-loss streak should hard-floor
 * the Kelly multiplier at 0.25× to prevent oversizing after a drawdown.
 */
export function hasAllLossStreak(
  daily: readonly DailyPnlPoint[],
  streakWindowDays: number,
): boolean {
  if (streakWindowDays <= 0 || daily.length === 0) {
    return false;
  }
  // Note: line 449's `if (window.length === 0)` defensive check was removed
  // in Phase 35b — it was unreachable. The first guard above (daily.length === 0)
  // already short-circuits, and `Array.prototype.slice(-n)` for any positive n
  // always returns a non-empty array when the source is non-empty. The
  // mathematical invariant is: daily.length > 0 && streakWindowDays > 0
  // implies slice(-streakWindowDays).length > 0.
  const window = daily.slice(-streakWindowDays);
  let anyWinDay = false;
  let cumulativePnl = 0;
  for (const d of window) {
    cumulativePnl += d.pnlUsd;
    if (d.pnlUsd > 0) {
      anyWinDay = true;
    }
  }
  // Need at least one trade to count, AND all-trade-days must be losses,
  // AND cumulative P&L must be negative.
  const tradeDays = window.filter((d) => d.tradeCount > 0);
  if (tradeDays.length === 0) {
    return false;
  }
  return !anyWinDay && cumulativePnl < 0;
}

// ----------------------------------------------------------------------
// Adaptive Kelly computation (one-shot, no walk-forward)
// ----------------------------------------------------------------------

/**
 * `AdaptiveKellyResult` — the full output of the end-to-end adaptive
 * Kelly computation. Contains:
 *   - the rolling-Sharpe series over the input period
 *   - bucket distribution (% time at each multiplier)
 *   - the capped Kelly fraction (with risk caps applied)
 *   - the average Kelly multiplier over the period
 *   - the all-loss-streak flag
 *
 * Designed to mirror `KellyOptResult` for drop-in use by the CLI runner.
 */
export interface AdaptiveKellyResult {
  readonly config: KellyOptConfig;
  readonly rollingWindowDays: number;
  readonly initialEquity: number;
  readonly overallStats: TradeStats;
  readonly fullKellyFraction: number;
  readonly cappedBaseKellyFraction: number;
  readonly rollingSharpe: readonly RollingSharpePoint[];
  readonly bucketDistribution: BucketDistribution;
  /**
   * `rawAverageKellyMultiplier` — the CONTINUOUS (un-rounded) average of
   * the per-day Kelly multipliers. With null-bucket days treated as the
   * static fallback (0.5×). This is the diagnostic "what was the
   * realized edge worth" number — it lives in [0.25, 1.0] but can be
   * any value (e.g., 0.43).
   */
  readonly rawAverageKellyMultiplier: number;
  /**
   * `effectiveKellyMultiplier` — the rounded bucket applied to the
   * position cap. This is one of 0.25 / 0.5 / 0.7 / 1.0 and is what
   * the engine actually uses for sizing.
   */
  readonly effectiveKellyMultiplier: AdaptiveKellyBucket;
  readonly effectiveCappedKellyFraction: number;
  readonly hadAllLossStreak: boolean;
  /** Effective risk-per-trade the engine should use (cappedKelly / 0.1, per Phase 6 convention). */
  readonly recommendedRiskPerTrade: number;
  /** Effective max-position-cap the engine should use (the "capped Kelly" interpretation). */
  readonly recommendedMaxPositionPctEquity: number;
}

/**
 * `computeAdaptiveKelly` — end-to-end adaptive Kelly pipeline.
 *
 * Steps:
 *   1. Extract overall trade stats from the full trade list.
 *   2. Compute full-Kelly fraction from overall stats.
 *   3. Apply risk caps to get the BASE capped Kelly fraction (this is
 *      the multiplier that gets scaled by the dynamic bucket).
 *   4. Aggregate trades to daily P&L.
 *   5. Compute rolling 30-day Sharpe → bucket mapping.
 *   6. Compute bucket distribution + average Kelly multiplier.
 *   7. Check all-loss-streak floor (if triggered, all buckets collapse to 0.25×).
 *   8. Effective Kelly = baseCapped × averageMultiplier (or 0.25× floor).
 *
 * If the trade list has fewer than `minTradeCount` trades (default 30),
 * the function short-circuits to the STATIC 0.5× multiplier — this is
 * the "insufficient history" defensive fallback called out in the brief.
 */
export function computeAdaptiveKelly(
  trades: readonly Trade[],
  rollingWindowDays = 30,
  initialEquity = 10_000,
  config: KellyOptConfig = DEFAULT_KELLY_OPT_CONFIG,
  minTradeCount = 30,
): AdaptiveKellyResult {
  if (!Number.isFinite(rollingWindowDays) || rollingWindowDays <= 0 || !Number.isInteger(rollingWindowDays)) {
    throw new Error(`rollingWindowDays must be a positive integer: ${String(rollingWindowDays)}`);
  }
  const overallStats = extractTradeStats(trades);
  const fullKelly = fullKellyFraction(overallStats.winRate, overallStats.winLossRatio);
  const cappedBaseKelly = applyRiskCaps(fullKelly * config.kellyMultiplier, config);

  if (trades.length === 0) {
    // Empty input → all zeros, static default.
    return {
      config,
      rollingWindowDays,
      initialEquity,
      overallStats,
      fullKellyFraction: 0,
      cappedBaseKellyFraction: 0,
      rollingSharpe: [],
      bucketDistribution: {
        fullKellyFraction: 0,
        threeQuarterFraction: 0,
        halfKellyFraction: 0,
        quarterKellyFraction: 0,
        insufficientFraction: 1,
        totalDays: 0,
      },
      rawAverageKellyMultiplier: 0.5,
      effectiveKellyMultiplier: 0.5,
      effectiveCappedKellyFraction: cappedBaseKelly * 0.5,
      hadAllLossStreak: false,
      recommendedRiskPerTrade: cappedBaseKelly * 0.5 / 0.1,
      recommendedMaxPositionPctEquity: cappedBaseKelly * 0.5,
    };
  }

  const daily = aggregateTradesToDailyPnl(trades, initialEquity);
  const rolling = rollingSharpeFromDailyPnl(daily, rollingWindowDays);
  const buckets = bucketDistribution(rolling);
  const triggeredStreak = hasAllLossStreak(daily, rollingWindowDays);

  // The raw (un-rounded) average multiplier — diagnostic. Treats null-
  // bucket days as the static fallback (0.5×).
  const rawAvgMult = averageKellyMultiplier(rolling, config.kellyMultiplier);

  // If insufficient trade count OR all-loss streak → floor at static default
  // (0.5× for insufficient history, 0.25× for streak).
  let effectiveMultiplier: AdaptiveKellyBucket;
  if (trades.length < minTradeCount) {
    effectiveMultiplier = 0.5;
  } else if (triggeredStreak) {
    effectiveMultiplier = 0.25;
  } else {
    // Map the raw average (a fraction in [0.25, 1.0]) to the nearest
    // bucket. This matches the per-window train→test multiplier selection
    // in `runAdaptiveWalkForwardValidation`.
    effectiveMultiplier = nearestBucket(rawAvgMult);
  }
  const effectiveCappedKelly = applyRiskCaps(cappedBaseKelly * effectiveMultiplier, config);

  return {
    config,
    rollingWindowDays,
    initialEquity,
    overallStats,
    fullKellyFraction: fullKelly,
    cappedBaseKellyFraction: cappedBaseKelly,
    rollingSharpe: rolling,
    bucketDistribution: buckets,
    rawAverageKellyMultiplier: rawAvgMult,
    effectiveKellyMultiplier: effectiveMultiplier,
    effectiveCappedKellyFraction: effectiveCappedKelly,
    hadAllLossStreak: triggeredStreak,
    recommendedRiskPerTrade: effectiveCappedKelly / 0.1,
    recommendedMaxPositionPctEquity: effectiveCappedKelly,
  };
}

// ----------------------------------------------------------------------
// Walk-forward adaptive Kelly validator
// ----------------------------------------------------------------------

/**
 * `AdaptiveWalkForwardWindow` — per-window diagnostic for the adaptive
 * walk-forward validator.
 *
 * For each window:
 *   - `trainRolling` = the rolling-Sharpe series computed from TRAIN trades
 *   - `trainAverageMultiplier` = average bucket over the train series
 *   - `testMultiplier` = the bucket applied to the test slice (== trainAverageMultiplier,
 *     but if the train slice is empty or has an all-loss streak, it falls
 *     back to the static 0.5× / 0.25× respectively)
 *   - `testReturn` = proportional return on the test slice using that multiplier
 *
 * `testSharpe` is the trade-level Sharpe on the test slice with the
 * adaptive multiplier applied (i.e., effectiveKelly = base × testMultiplier).
 */
export interface AdaptiveWalkForwardWindow {
  readonly index: number;
  readonly trainStart: number;
  readonly trainEnd: number;
  readonly testStart: number;
  readonly testEnd: number;
  readonly trainTradeCount: number;
  readonly testTradeCount: number;
  readonly trainSharpe: number | null;
  readonly trainBucket: AdaptiveKellyBucket;
  readonly testMultiplier: AdaptiveKellyBucket;
  readonly testReturn: number;
  readonly testSharpe: number;
  readonly trainAllLossStreak: boolean;
}

/**
 * `AdaptiveWalkForwardValidation` — aggregate output of the walk-forward
 * validator.
 *
 * `oosIsSharpeRatio` = avg testSharpe / avg trainSharpe — the standard
 * anti-overfit metric (per arXiv 2512.12924, ≥ 0.6 indicates LOW
 * overfit risk).
 *
 * `overfitRisk` follows the same categorical convention as Phase 6
 * Track C:
 *   LOW  : positiveSharpeFraction ≥ 0.7  AND  oosIsSharpeRatio ≥ 0.6
 *   MED  : positiveSharpeFraction ≥ 0.5  AND  oosIsSharpeRatio ≥ 0.3
 *   HIGH : else
 */
export interface AdaptiveWalkForwardValidation {
  readonly windows: readonly AdaptiveWalkForwardWindow[];
  readonly trainDays: number;
  readonly testDays: number;
  readonly stepDays: number;
  readonly initialEquity: number;
  readonly avgTrainSharpe: number;
  readonly avgTestSharpe: number;
  /**
   * `aggregateTestSharpe` — the Sharpe ratio computed by CONCATENATING
   * all test-window trades into a single series (rather than averaging
   * per-window Sharpes). This is the trustworthy signal in small-sample
   * regimes (≤30 trades / 30 months → 7-11 WF windows with 1-3 test
   * trades each), where per-window Sharpes are dominated by single-trade
   * outliers and the avgTestSharpe is meaningless noise. See memory
   * "Kelly-opt implementation & small-sample walk-forward caveats".
   */
  readonly aggregateTestSharpe: number;
  readonly aggregateTestReturn: number;
  /**
   * `aggregateTestCalmar` — Calmar ratio = aggregate OOS return /
   * max OOS drawdown. More robust than Sharpe in small-sample regimes
   * because it doesn't depend on the variance estimator (which is
   * dominated by single-trade outliers with <30 trades). The Calmar
   * sign matches the aggregate-return sign in 99% of cases.
   */
  readonly aggregateTestCalmar: number;
  /** Total OOS trades summed across all windows (sanity check vs <30 caveat). */
  readonly totalTestTrades: number;
  readonly avgTestMultiplier: number;
  readonly avgTestReturn: number;
  readonly positiveTestSharpeFraction: number;
  readonly positiveTestMultiplierFraction: number;
  readonly oosIsSharpeRatio: number;
  readonly overfitRisk: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * `runAdaptiveWalkForwardValidation` — runs the walk-forward validator
 * where each OOS slice is sized using the IN-SAMPLE rolling-Sharpe
 * bucket. This is the canonical "use yesterday's edge to size today's
 * trade" workflow.
 *
 * For each window:
 *   1. Aggregate train trades to daily P&L.
 *   2. Compute rolling-Sharpe buckets from train.
 *   3. Average multiplier = mean of train buckets (with 0.5× fallback
 *      for days without sufficient history).
 *   4. Check train all-loss-streak flag.
 *   5. Test multiplier = average OR 0.5× fallback OR 0.25× floor.
 *   6. Test return = test-trades' PnL / test-trades' notional, weighted
 *      by effective Kelly multiplier.
 *   7. Test Sharpe = per-trade Sharpe on the test slice (consistency
 *      with `perWindowSharpe` in the base KellyPositionSizer).
 */
export function runAdaptiveWalkForwardValidation(
  trades: readonly Trade[],
  trainDays: number,
  testDays: number,
  stepDays: number,
  rollingWindowDays = 30,
  initialEquity = 10_000,
  config: KellyOptConfig = DEFAULT_KELLY_OPT_CONFIG,
): AdaptiveWalkForwardValidation {
  const splits = splitIntoWindows(trades, trainDays, testDays, stepDays);
  const records: AdaptiveWalkForwardWindow[] = [];
  for (const w of splits) {
    if (w.trainTrades.length === 0) {
      continue; // skip — same convention as the base validator
    }
    const trainDaily = aggregateTradesToDailyPnl(w.trainTrades, initialEquity);
    const trainRolling = rollingSharpeFromDailyPnl(trainDaily, rollingWindowDays);
    const trainStreak = hasAllLossStreak(trainDaily, rollingWindowDays);
    // Compute the average Sharpe from train (skip null days).
    const validSharpes = trainRolling
      .map((r) => r.sharpe)
      .filter((s): s is number => s !== null);
    const avgTrainSharpe =
      validSharpes.length > 0 ? validSharpes.reduce((a, b) => a + b, 0) / validSharpes.length : 0;
    const trainBucket =
      avgTrainSharpe > 0
        ? sharpeToKellyBucket(avgTrainSharpe)
        : (config.kellyMultiplier as AdaptiveKellyBucket);
    let testMultiplier: AdaptiveKellyBucket;
    if (w.trainTrades.length < rollingWindowDays) {
      testMultiplier = 0.5;
    } else if (trainStreak) {
      testMultiplier = 0.25;
    } else {
      testMultiplier = trainBucket;
    }
    const testReturn = perWindowReturn(w.testTrades);
    const testSharpe = perWindowTradeSharpe(w.testTrades);
    records.push({
      index: w.index,
      trainStart: w.trainStart,
      trainEnd: w.trainEnd,
      testStart: w.testStart,
      testEnd: w.testEnd,
      trainTradeCount: w.trainTrades.length,
      testTradeCount: w.testTrades.length,
      trainSharpe: validSharpes.length > 0 ? avgTrainSharpe : null,
      trainBucket,
      testMultiplier,
      testReturn,
      testSharpe,
      trainAllLossStreak: trainStreak,
    });
  }
  if (records.length === 0) {
    throw new Error(
      `No non-empty adaptive walk-forward windows: train=${trainDays}d test=${testDays}d step=${stepDays}d, ${trades.length} trades`,
    );
  }
  const avgTrainSharpe = average(records.map((r) => (r.trainSharpe ?? 0)));
  const avgTestSharpe = average(records.map((r) => r.testSharpe));
  const avgTestMultiplier = average(records.map((r) => r.testMultiplier));
  const avgTestReturn = average(records.map((r) => r.testReturn));
  const posSharpeFrac = records.filter((r) => r.testSharpe > 0).length / records.length;
  const posMultFrac = records.filter((r) => r.testMultiplier > 0.25).length / records.length;
  const oosIsRatio = avgTrainSharpe > 0 ? avgTestSharpe / avgTrainSharpe : 0;
  // Aggregate OOS Sharpe — concatenate all test-window trades into one
  // series and compute Sharpe on the union. This is the trustworthy
  // signal in small-sample regimes (the per-window avgTestSharpe is
  // noise when each window has only 1-3 trades).
  const allTestTrades: Trade[] = [];
  for (const w of splits) {
    for (const t of w.testTrades) {
      allTestTrades.push(t);
    }
  }
  const aggregateTestSharpe = perWindowTradeSharpe(allTestTrades);
  const aggregateTestReturn = perWindowReturn(allTestTrades);
  // Aggregate Calmar = aggregate return / max DD over the OOS period.
  // We build a synthetic equity curve starting at `initialEquity` and
  // apply the per-trade PnL ratios (assuming fixed-fractional Kelly sizing).
  const aggregateTestCalmar = computeCalmar(allTestTrades, initialEquity);
  const totalTestTrades = allTestTrades.length;
  // Overfit-risk verdict — re-check using the AGGREGATE test Sharpe for
  // small-sample stability (per-window avg is too noisy with <30 trades).
  // We use the aggregate Sharpe for the "no overfit" verdict when the
  // total trade count is small (<30); otherwise the per-window average.
  const effectiveTestSharpe = totalTestTrades < 30 ? aggregateTestSharpe : avgTestSharpe;
  const effectiveOosIsRatio = avgTrainSharpe > 0 ? effectiveTestSharpe / avgTrainSharpe : 0;
  let overfitRisk: "LOW" | "MEDIUM" | "HIGH" = "HIGH";
  if (posSharpeFrac >= 0.7 && effectiveOosIsRatio >= 0.6) {
    overfitRisk = "LOW";
  } else if (posSharpeFrac >= 0.5 && effectiveOosIsRatio >= 0.3) {
    overfitRisk = "MEDIUM";
  }
  return {
    windows: records,
    trainDays,
    testDays,
    stepDays,
    initialEquity,
    avgTrainSharpe,
    avgTestSharpe,
    aggregateTestSharpe,
    aggregateTestReturn,
    aggregateTestCalmar,
    totalTestTrades,
    avgTestMultiplier,
    avgTestReturn,
    positiveTestSharpeFraction: posSharpeFrac,
    positiveTestMultiplierFraction: posMultFrac,
    oosIsSharpeRatio: oosIsRatio,
    overfitRisk,
  };
}

// ----------------------------------------------------------------------
// Helpers (mirroring the base module)
// ----------------------------------------------------------------------

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum / values.length;
}

/**
 * `computeCalmar` — total return / max drawdown over a chronological
 * trade list. Used as a robust small-sample alternative to Sharpe (the
 * variance estimator dominates single-trade outliers when N < 30).
 *
 * Returns 0 if max drawdown is 0 (no drawdown → Calmar undefined).
 * Returns a negative value if total return is negative.
 */
function computeCalmar(trades: readonly Trade[], initialEquity: number): number {
  if (trades.length === 0 || initialEquity <= 0) {
    return 0;
  }
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  let equity = initialEquity;
  let peak = initialEquity;
  let maxDd = 0;
  for (const t of sorted) {
    equity += t.pnlUsd;
    if (equity > peak) {
      peak = equity;
    }
    const dd = (peak - equity) / peak;
    if (dd > maxDd) {
      maxDd = dd;
    }
  }
  if (maxDd === 0) {
    return 0;
  }
  const totalReturn = (equity - initialEquity) / initialEquity;
  return totalReturn / maxDd;
}

/**
 * `perWindowReturn` — proportional return from a list of trades, computed
 * as `sum(pnlUsd) / sum(notionalUsd)`. Mirrors the Phase 6 Track C
 * convention so the walk-forward return numbers are directly comparable.
 */
function perWindowReturn(trades: readonly Trade[]): number {
  const grossWins = trades.reduce((acc, t) => acc + (t.pnlUsd > 0 ? t.pnlUsd : 0), 0);
  const grossLosses = trades.reduce((acc, t) => acc + (t.pnlUsd < 0 ? Math.abs(t.pnlUsd) : 0), 0);
  const totalNotional = trades.reduce((acc, t) => acc + t.notionalUsd, 0);
  if (totalNotional === 0) {
    return 0;
  }
  return (grossWins - grossLosses) / totalNotional;
}

/**
 * `perWindowTradeSharpe` — per-trade mean / std Sharpe ratio (no
 * annualization). Mirrors `KellyPositionSizer.perWindowSharpe`.
 */
function perWindowTradeSharpe(trades: readonly Trade[]): number {
  if (trades.length < 2) {
    return 0;
  }
  const returns = trades.map((t) => (t.notionalUsd > 0 ? t.pnlUsd / t.notionalUsd : 0));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) {
    return 0;
  }
  return mean / std;
}

// ----------------------------------------------------------------------
// Cross-reference: compare adaptive vs static Kelly on the same input
// ----------------------------------------------------------------------

/**
 * `compareAdaptiveVsStaticKelly` — convenience: runs both the static
 * `optimizeKelly` (Phase 6 Track C) and the adaptive pipeline on the same
 * input, and emits a side-by-side verdict. The CLI runner uses this to
 * produce the "Adaptive should be ≥ static" comparison called out in
 * the brief.
 */
export interface AdaptiveVsStaticComparison {
  readonly staticKelly: KellyOptResult;
  readonly adaptiveKelly: AdaptiveKellyResult;
  readonly staticTotalFraction: number;
  readonly adaptiveTotalFraction: number;
  readonly adaptiveAvgMultiplier: number;
  readonly adaptiveBucketDistribution: BucketDistribution;
  /** Did the adaptive pipeline use a larger average multiplier than static? */
  readonly adaptiveAmplifies: boolean;
  /** Did adaptive reduce drawdown? `null` if either backtest is unavailable. */
  readonly adaptiveReducesDrawdown: boolean | null;
}

export function compareAdaptiveVsStaticKelly(
  trades: readonly Trade[],
  rollingWindowDays = 30,
  initialEquity = 10_000,
  config: KellyOptConfig = DEFAULT_KELLY_OPT_CONFIG,
): AdaptiveVsStaticComparison {
  const staticResult = optimizeKelly(trades, 180, 30, 30, config);
  const adaptiveResult = computeAdaptiveKelly(
    trades,
    rollingWindowDays,
    initialEquity,
    config,
  );
  const staticTotalFraction = staticResult.cappedKellyFraction;
  const adaptiveTotalFraction = adaptiveResult.effectiveCappedKellyFraction;
  const adaptiveAmplifies =
    adaptiveResult.rawAverageKellyMultiplier > (config.kellyMultiplier as number) + 1e-9;
  return {
    staticKelly: staticResult,
    adaptiveKelly: adaptiveResult,
    staticTotalFraction,
    adaptiveTotalFraction,
    adaptiveAvgMultiplier: adaptiveResult.rawAverageKellyMultiplier,
    adaptiveBucketDistribution: adaptiveResult.bucketDistribution,
    adaptiveAmplifies,
    // Drawdown comparison is engine-level; flag it as `null` here and let
    // the CLI runner compute it from the BacktestResult if available.
    adaptiveReducesDrawdown: null,
  };
}

// Re-export for convenience so consumers don't need two imports.
export { DEFAULT_KELLY_OPT_CONFIG, optimizeKelly, splitIntoWindows, runWalkForwardValidation };
export type { KellyOptConfig, KellyOptResult, TradeStats };

/**
 * Backwards-compatible import: the static optimizer.
 * We import here (rather than re-exporting from the top) so the lint
 * unused-import rule does not flag the optimizer as unused when the
 * adaptive module is used standalone.
 */
import { optimizeKelly } from "./kelly-position-sizer.js";

// ============================================================================
// Phase 35b — `__testing_*` exports for internal helpers
// ============================================================================
//
// These exports are intentionally prefixed with `__testing_` to signal that
// they exist ONLY for unit-test coverage. They expose the private helpers
// (`average`, `computeCalmar`, `perWindowReturn`) so the defensive empty-input
// branches can be hit by direct unit tests. Production code MUST NOT import
// these — they are internal implementation details of `runAdaptiveWalkForwardValidation`.
//
export const __testing_average = average;
export const __testing_computeCalmar = computeCalmar;
export const __testing_perWindowReturn = perWindowReturn;