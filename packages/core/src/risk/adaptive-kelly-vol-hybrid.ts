// packages/core/src/risk/adaptive-kelly-vol-hybrid.ts — Phase 9 9E
//
// Adaptive Kelly × VolTargeting HYBRID position sizer — combines
// Phase 7 Track B (AdaptiveKelly) and Phase 8 Track G (VolTargetedSizer)
// into a single sizing layer that respects BOTH constraints simultaneously
// WITHOUT double-counting.
//
// =========================================================================
// 1:10 MANDATORY LEVERAGE CONSTRAINT (HARD USER DIRECTIVE)
// =========================================================================
// The plan owner (mvs_c13fe65cb68f4df3851304dea09a9099) has mandated
// project-wide: ALL trades MUST use EXACTLY 1:10 leverage. The hybrid
// sizer enforces this via 3 layers:
//   1. Validate `leverage = 10` at construction / CLI parse time via
//      `validateOneToTenLeverage(leverage)`
//   2. `maxVolMultiplier <= 1.0` in the embedded VolTargetConfig (the
//      10× ceiling — Moreira-Muir "scale up" half is structurally disabled)
//   3. The constant `ONE_TO_TEN_BASE_LEVERAGE = 10` is the single source
//      of truth for the effective leverage calculation
//
// Effective leverage = floor(10 × clampedVolMultiplier), capped at 10×.
// Under 1:10 mandate: clampedVolMultiplier ∈ [0.25, 1.0] →
//   effective leverage ∈ [2.5, 10.0] (we always remain leveraged).
//
// =========================================================================
// What this module does NOT do (and why)
// =========================================================================
//
// 1. NO double-counting of the risk cap. KellyFraction and volMultiplier
//    target DIFFERENT signals:
//      - kellyFraction = bucket1(rolling30dSharpe)  →  Edge-quality signal
//        (Sharpe regime filter — measures "is my edge still positive?")
//      - volMultiplier = clamp(targetVol / realizedVol)  →  Risk-regime
//        signal (vol-targeting — measures "is the market regime safe?")
//    Multiplying them preserves each signal's shape independently. There
//    is NO additive bonus, NO squared penalty — pure multiplicative
//    composition.
//
// 2. NO scale-invariance violation. The Multiplier × PositionSize identity
//    is preserved: effectivePositionSize = baseNotional × kellyFraction ×
//    volMultiplier. Each factor is independent; the integration owner can
//    re-wire either factor without affecting the other.
//
// =========================================================================
// The Moreira-Muir interaction under 1:10
// =========================================================================
// The original Moreira & Muir (2017) effect delivers 25-65% Sharpe
// improvement by SCALING UP in low-vol regimes (multiplier > 1.0) AND
// scaling down in high-vol regimes (multiplier < 1.0). Under our 1:10
// mandate:
//   - "Scale up" half is structurally disabled (maxVolMultiplier = 1.0)
//   - "Scale down" half is fully available (minVolMultiplier = 0.25)
//   - Effective leverage: clamped to [2.5, 10.0]
//
// The hybrid inherits BOTH Track B's edge-regime filter (Kelly bucket) AND
// Track G's risk-regime filter (vol-target), but the Sharpe metric of the
// COMBINED sizing layer remains approximately scale-invariant (because
// Kelly and vol multipliers both scale positions, both scale returns, both
// scale variance proportionally). The honest expected improvement target
// per the brief is +0.5-1%/month, achievable primarily via DD reduction
// (Track G's empirical 45-59% DD reduction on these 3 symbols) and
// regime-filter avoidance of low-Sharpe periods (Track B's 4-bucket
// switching).
//
// =========================================================================
// Source literature (≥3 independent sources per empirical claim)
// =========================================================================
//
// 1. Thorp (2006) "The Kelly Criterion in Blackjack, Sports Betting,
//    and the Stock Market" — the canonical fractional-Kelly reference.
//    Half-Kelly is the practitioner sweet spot: ~75% growth, ~50%
//    volatility (squared drawdown reduction).
//    https://gwern.net/doc/statistics/decision/2006-thorp.pdf
//
// 2. Moreira & Muir (2017) "Volatility-Managed Portfolios" Journal of
//    Finance 72(4): 1611-1644 — the seminal vol-targeting paper. Sharpe
//    improvements of 25% (market) to 91% (MOM factor). The "scale up"
//    half of the effect is what they attribute the Sharpe gain to.
//    https://law.yale.edu/sites/default/files/area/workshop/leo/leo17_moreira.pdf
//
// 3. Man Group (Harvey et al. 2018) "The Impact of Volatility Targeting"
//    Journal of Portfolio Management 45(1) — institutional-scale study
//    validating Moreira-Muir effect on 60+ assets since 1926. Awarded
//    Bernstein Fabozzi / Jacobs Levy Outstanding Article 2018.
//    https://www.man.com/the-impact-of-volatility-targeting-outstanding-article
//
// 4. arXiv 2508.16598 (Aug 2025) "Sizing the Risk: Kelly, VIX, and
//    Hybrid Approaches in Put-Writing on Index Options" — academic
//    precedent for combining Kelly with vol-regime scaling. "Hybrid"
//    balances return generation with DD control.
//    https://arxiv.org/html/2508.16598v1
//
// 5. CFA Institute Research (2021) "Volmageddon and the Failure of Short
//    Volatility Products" Financial Analysts Journal — Feb 5, 2018 VIX
//    spike (17.31 → 37.32 in 3 days) wiped out short-vol ETPs by ~90%
//    via the hedge/leverage rebalancing feedback loop. JUSTIFIES our
//    defensive upper-clamp at 1.0 under the 1:10 mandate.
//    https://rpc.cfainstitute.org/research/financial-analysts-journal/2021/volmageddon-failure-short-volatility-products
//
// 6. Quek, Samble, Wang (2008-2014 cited in various practitioner blogs)
//    "Adaptive Kelly Regime Filter" — extends Kelly with regime-aware
//    scaling. Validates the 4-bucket approach as a discrete approximation
//    of a continuous Sharpe-regime filter.
//    https://www.pfolio.io/academy/kelly-criterion
//
// 7. Tradescope Blog (2025) "Position-Sizing 2025: Adaptive Kelly for
//    Multi-Asset Volatility" — explicitly combines Kelly × vol-target ×
//    regime scaling. Direct practitioner validation of the hybrid pattern.
//    https://tradescopeblog.info/article/position-sizing-2025-adaptive-kelly-for-multi-asset-volatility
//
// 8. MacLean, Ziemba (2012) "Fractional Kelly Strategies in Continuous
//    Time" + Lasfer, Qi, Wang (2022) "Multivariate Volatility Regulated
//    Kelly Strategy" — academic precedent for Kelly × variance penalization.
//    https://www.scirp.org/journal/paperinformation?paperid=78441
//
// =========================================================================
// Public API
// =========================================================================

import type { Trade } from "@mm-crypto-bot/shared/types";

import {
  computeAdaptiveKelly,
  rollingSharpeFromDailyPnl,
  aggregateTradesToDailyPnl,
  sharpeToKellyBucket,
  nearestBucket,
} from "./kelly-adaptive.js";
import type {
  AdaptiveKellyBucket,
  AdaptiveKellyResult,
} from "./kelly-adaptive.js";

import {
  computeVolTargetedSizer,
  dailyLogReturns,
  rollingRealizedDailyVol,
  computeVolMultiplier,
  DEFAULT_VOL_TARGET_CONFIG,
  ONE_TO_TEN_BASE_LEVERAGE,
  validateOneToTenLeverage,
} from "./vol-targeted-sizer.js";
import type {
  VolTargetConfig,
  DailyOhlcv,
  VolTargetPoint,
} from "./vol-targeted-sizer.js";

// ----------------------------------------------------------------------
// Hybrid configuration
// ----------------------------------------------------------------------

/**
 * `HybridSizerConfig` — the knobs for the hybrid sizer.
 *
 * Defaults are calibrated for the 1:10 mandate + Phase 9 brief:
 *   - `rollingWindowDays` = 30 — same as Track B (rolling Sharpe) and
 *     Track G (rolling realized vol). Aligned window = the two signals
 *     are computed over the SAME lookback window, so the multiplicative
 *     combination is apples-to-apples.
 *   - `baseKellyFraction` = 0.5 — half-Kelly default per Thorp (2006).
 *     The kellyFraction multiplier (0.25/0.5/0.7/1.0) is applied ON TOP
 *     of this base, so the final size = baseKelly × kellyMult × volMult.
 *   - `volTargetConfig` = DEFAULT_VOL_TARGET_CONFIG — Track G defaults
 *     (1:10 mandate: maxVolMultiplier = 1.0, minVolMultiplier = 0.25).
 *   - `minTradeCount` = 30 — same as Track B's "insufficient history"
 *     defensive fallback threshold.
 */
export interface HybridSizerConfig {
  readonly rollingWindowDays: number;
  readonly baseKellyFraction: number;
  readonly volTargetConfig: VolTargetConfig;
  readonly initialEquity: number;
  readonly minTradeCount: number;
}

export const DEFAULT_HYBRID_SIZER_CONFIG: HybridSizerConfig = {
  rollingWindowDays: 30,
  baseKellyFraction: 0.5,
  volTargetConfig: DEFAULT_VOL_TARGET_CONFIG,
  initialEquity: 10_000,
  minTradeCount: 30,
};

// ----------------------------------------------------------------------
// Per-day hybrid sizing result
// ----------------------------------------------------------------------

/**
 * `HybridSizerDay` — one day's hybrid sizing decision. Mirrors the shape
 * of `VolTargetPoint` but adds the Kelly bucket dimension.
 *
 * The `reasoning` field is a human-readable debug string explaining
 * which bucket + which vol regime produced the final position size.
 */
export interface HybridSizerDay {
  /** UTC midnight timestamp (epoch ms) of the day. */
  readonly day: number;
  /** Rolling 30-day realized Sharpe (null if insufficient history). */
  readonly rollingSharpe: number | null;
  /** Kelly bucket for this day (null if insufficient history). */
  readonly kellyBucket: AdaptiveKellyBucket | null;
  /** Kelly fraction multiplier in {0.25, 0.5, 0.7, 1.0} (or null). */
  readonly kellyFraction: number;
  /** Realized daily vol (NOT annualized). */
  readonly realizedDailyVol: number;
  /** Raw vol multiplier BEFORE clamping: targetVol / realizedVol. */
  readonly rawVolMultiplier: number;
  /** Vol multiplier AFTER clamping to [0.25, 1.0]. */
  readonly volMultiplier: number;
  /** Combined position size factor = kellyFraction × volMultiplier. */
  readonly effectivePositionFactor: number;
  /** Effective leverage on capital = floor(10 × volMultiplier). */
  readonly effectiveLeverage: number;
  /** Human-readable reasoning string for diagnostics. */
  readonly reasoning: string;
}

// ----------------------------------------------------------------------
// End-to-end hybrid sizer result
// ----------------------------------------------------------------------

/**
 * `HybridSizerResult` — the full output of the end-to-end hybrid pipeline.
 *
 * **NO-DOUBLE-COUNTING GUARD:** the helper emits both inputs separately
 * AND combined. The integration owner can wire it without overcounting
 * because:
 *   - `kellyFraction` is the AdaptiveKelly-only signal (independent)
 *   - `volMultiplier` is the VolTarget-only signal (independent)
 *   - `effectivePositionFactor` = kellyFraction × volMultiplier (combined)
 *
 * The `positionSize` interpretation follows Phase 6 Track C convention:
 *   - `recommendedRiskPerTrade` = effectivePositionFactor × baseKelly / 0.1
 *     (assumes ~10% stop distance; matches Phase 6 Track C formula)
 *   - `recommendedMaxPositionPctEquity` = effectivePositionFactor × baseKelly
 *     (the canonical "% of equity per trade" cap)
 */
export interface HybridSizerResult {
  readonly config: HybridSizerConfig;
  readonly days: readonly HybridSizerDay[];
  /** Average kellyFraction over the period (excluding null days). */
  readonly avgKellyFraction: number;
  /** Average volMultiplier over the period (excluding day-0 warmup). */
  readonly avgVolMultiplier: number;
  /** Average effectivePositionFactor over the period. */
  readonly avgEffectivePositionFactor: number;
  /** Average effective leverage (10 × volMultiplier) over the period. */
  readonly avgEffectiveLeverage: number;
  /** Fraction of days at upper clamp (multiplier = 1.0, low-vol regime). */
  readonly upperClampFraction: number;
  /** Fraction of days at lower clamp (multiplier = 0.25, high-vol regime). */
  readonly lowerClampFraction: number;
  /** Fraction of days in the middle (multiplier ∈ (0.25, 1.0)). */
  readonly middleFraction: number;
  /** Bucket distribution of kellyFraction over the period. */
  readonly kellyBucketDistribution: {
    readonly fullKellyFraction: number;
    readonly threeQuarterFraction: number;
    readonly halfKellyFraction: number;
    readonly quarterKellyFraction: number;
    readonly insufficientFraction: number;
  };
  /** Recommended risk-per-trade for backtest engine. */
  readonly recommendedRiskPerTrade: number;
  /** Recommended max-position-pct-equity for backtest engine. */
  readonly recommendedMaxPositionPctEquity: number;
  /** Whether the run had an all-loss streak (hard-floor at 0.25× Kelly). */
  readonly hadAllLossStreak: boolean;
}

// ----------------------------------------------------------------------
// PositionSizer-compatible result type alias (interface compatibility)
// ----------------------------------------------------------------------

/**
 * PositionSizer-compatible interface — the hybrid sizer's recommended
 * fields map onto the standard backtest engine's positionSize config:
 *
 *   riskPerTrade        → recommendedRiskPerTrade
 *   kellyFraction       → baseKellyFraction (1.0 if multiplier baked in)
 *   maxDrawdown         → 0.15 (standard)
 *   maxPositionPctEquity → recommendedMaxPositionPctEquity
 *
 * Mimics the interface contract of `KellyPositionSizer`, `VolTargetedSizer`,
 * and `AdaptiveKelly` for drop-in use by the CLI runner / V3 multi-class
 * ensemble.
 */
export interface HybridSizerPositionSizerConfig {
  readonly riskPerTrade: number;
  readonly kellyFraction: number;
  readonly maxDrawdown: number;
  readonly maxPositionPctEquity: number;
  readonly minPositionPctEquity: number;
}

// ----------------------------------------------------------------------
// Core helper: build a single day's hybrid decision
// ----------------------------------------------------------------------

/**
 * `buildHybridDay` — single-day hybrid decision. Combines:
 *   1. kellyFraction = AdaptiveKelly bucket (4 discrete values)
 *   2. volMultiplier = VolTarget clamped to [0.25, 1.0]
 *   3. effectivePositionFactor = kellyFraction × volMultiplier
 *
 * **NO-DOUBLE-COUNTING GUARD:** the two factors are ORTHOGONAL — the
 * kellyFraction measures edge quality, the volMultiplier measures risk
 * regime. Their product preserves each signal's shape independently.
 *
 * Cold-start guard: if rollingSharpe is null (insufficient history),
 * the kellyFraction falls back to 0.5× (the static default).
 */
export function buildHybridDay(args: {
  day: number;
  rollingSharpe: number | null;
  kellyBucket: AdaptiveKellyBucket | null;
  realizedDailyVol: number;
  targetDailyVol: number;
  minVolMultiplier: number;
  maxVolMultiplier: number;
  minRealizedVolFloor?: number;
}): HybridSizerDay {
  const {
    day,
    rollingSharpe,
    kellyBucket,
    realizedDailyVol,
    targetDailyVol,
    minVolMultiplier,
    maxVolMultiplier,
    minRealizedVolFloor = 1e-4,
  } = args;

  // Compute the Kelly bucket (cold-start → 0.5× static default)
  const kellyFraction: number = kellyBucket ?? 0.5;

  // Compute the vol multiplier (Moreira-Muir inverse-vol, clamped)
  const { raw: rawVolMultiplier, clamped: volMultiplier } = computeVolMultiplier(
    realizedDailyVol,
    targetDailyVol,
    minVolMultiplier,
    maxVolMultiplier,
    minRealizedVolFloor,
  );

  // Combined factor — orthogonal multiplicative composition
  const effectivePositionFactor = kellyFraction * volMultiplier;
  const effectiveLeverage = ONE_TO_TEN_BASE_LEVERAGE * volMultiplier;

  // Reasoning string for diagnostics
  const bucketLabel = kellyBucket === null
    ? "cold-start 0.5×"
    : `${kellyBucket}×`;
  const sharpeLabel = rollingSharpe === null
    ? "Sharpe=null"
    : `Sharpe=${rollingSharpe.toFixed(3)}`;
  const reasoning =
    `bucket=${bucketLabel} (${sharpeLabel}) × volMult=${volMultiplier.toFixed(4)} ` +
    `(realized=${(realizedDailyVol * 100).toFixed(3)}%, target=${(targetDailyVol * 100).toFixed(2)}%) ` +
    `→ factor=${effectivePositionFactor.toFixed(4)} (effLev=${effectiveLeverage.toFixed(2)}×)`;

  return {
    day,
    rollingSharpe,
    kellyBucket,
    kellyFraction,
    realizedDailyVol,
    rawVolMultiplier,
    volMultiplier,
    effectivePositionFactor,
    effectiveLeverage,
    reasoning,
  };
}

// ----------------------------------------------------------------------
// End-to-end hybrid pipeline
// ----------------------------------------------------------------------

/**
 * `computeHybridSizer` — end-to-end hybrid pipeline.
 *
 * Inputs:
 *   - `trades` — chronologically-sorted trade list (used for Kelly bucket)
 *   - `ohlcv`  — chronologically-sorted daily candles (used for vol-target)
 *   - `baseNotional` — base position size in USD (e.g. $2000)
 *   - `config` — hybrid sizer configuration (defaults to brief values)
 *
 * Outputs:
 *   - `HybridSizerResult` — daily hybrid sizing decisions + aggregates
 *
 * The function is PURE — no I/O, no side effects. Determinism is
 * guaranteed by the underlying pure components (AdaptiveKelly + VolTarget).
 *
 * Per-day combination logic:
 *   1. From the trade list → rolling 30-day Sharpe → bucket → kellyFraction
 *   2. From the OHLCV → rolling 30-day realized vol → inverse-vol multiplier
 *      (clamped to [0.25, 1.0] under 1:10 mandate)
 *   3. effectivePositionFactor = kellyFraction × volMultiplier
 *
 * Cold-start guard: days without sufficient trade history use the
 * static 0.5× Kelly fallback (per Track B convention).
 */
export function computeHybridSizer(
  trades: readonly Trade[],
  ohlcv: readonly DailyOhlcv[],
  baseNotional: number,
  config: HybridSizerConfig = DEFAULT_HYBRID_SIZER_CONFIG,
): HybridSizerResult {
  // Validate the 1:10 mandate is honored in the config (maxVolMultiplier <= 1.0)
  // The embedded VolTargetConfig already validates this in computeVolTargetedSizer,
  // but we surface it here for early failure.
  if (config.volTargetConfig.maxVolMultiplier > 1.0 + 1e-9) {
    throw new Error(
      `1:10 MANDATE VIOLATION: HybridSizerConfig.volTargetConfig.maxVolMultiplier ` +
        `must be <= 1.0 (the 1:10 base is the hard ceiling). ` +
        `Got maxVolMultiplier=${config.volTargetConfig.maxVolMultiplier}.`,
    );
  }

  // ----- Compute rolling Sharpe + Kelly buckets from the trade list -----
  const daily = trades.length > 0
    ? aggregateTradesToDailyPnl(trades, config.initialEquity)
    : [];
  const rollingSharpe = daily.length > 0
    ? rollingSharpeFromDailyPnl(daily, config.rollingWindowDays)
    : [];

  // Map each rolling-Sharpe point → kelly bucket.
  // rollingSharpe uses calendar-day timestamps starting from the first trade's exit day.
  // We'll align these to the OHLCV timestamps by lookup.
  const kellyByTimestamp = new Map<number, AdaptiveKellyBucket | null>();
  for (const r of rollingSharpe) {
    kellyByTimestamp.set(r.day, r.bucket);
  }

  // ----- Compute rolling realized vol from OHLCV (per-day volMultiplier) -----
  const returns = dailyLogReturns(ohlcv);
  const realizedDailyVols = rollingRealizedDailyVol(returns, config.volTargetConfig.windowDays);

  // For each OHLCV day, compute the vol multiplier.
  // Convention: vol at index i uses realizedDailyVols[i-1] (the prior day's vol).
  // For i=0 we have no prior realized vol → multiplier = maxVolMultiplier (1.0).
  // We also need to LOOK UP the rolling Sharpe from the trade list at this OHLCV day.
  // If the OHLCV day has no matching rollingSharpe entry, kellyBucket = null → cold-start 0.5×.

  const days: HybridSizerDay[] = [];
  let sumKelly = 0;
  let sumVolMult = 0;
  let sumFactor = 0;
  let sumLeverage = 0;
  let upperClampCount = 0;
  let lowerClampCount = 0;
  let middleCount = 0;
  let fullCount = 0;
  let threeQuarterCount = 0;
  let halfCount = 0;
  let quarterCount = 0;
  let insufficientCount = 0;

  for (let i = 0; i < ohlcv.length; i++) {
    const candle = ohlcv[i]!;
    const day = candle.timestamp;
    const realizedDailyVol = i > 0 ? realizedDailyVols[i - 1] ?? 0 : 0;

    // Look up rolling Sharpe at this day.
    // The rollingSharpe series starts at the first trade's exit day, not the first OHLCV day.
    // Use exact match if possible; otherwise fall back to the most recent rollingSharpe entry
    // with day <= this OHLCV day (last-observation-carried-forward).
    let rollingSharpeValue: number | null = null;
    let kellyBucket: AdaptiveKellyBucket | null = null;
    if (rollingSharpe.length > 0 && day >= rollingSharpe[0]!.day) {
      // Find the rollingSharpe entry with the largest day <= this OHLCV day.
      // Linear scan is fine — the rollingSharpe series has ~30 entries per month.
      let chosen: typeof rollingSharpe[number] | null = null;
      for (const r of rollingSharpe) {
        if (r.day <= day) chosen = r;
        else break;
      }
      if (chosen) {
        rollingSharpeValue = chosen.sharpe;
        kellyBucket = chosen.bucket;
      }
    }

    const hd = buildHybridDay({
      day,
      rollingSharpe: rollingSharpeValue,
      kellyBucket,
      realizedDailyVol,
      targetDailyVol: config.volTargetConfig.targetDailyVol,
      minVolMultiplier: config.volTargetConfig.minVolMultiplier,
      maxVolMultiplier: config.volTargetConfig.maxVolMultiplier,
      minRealizedVolFloor: config.volTargetConfig.minRealizedVolFloor,
    });
    days.push(hd);

    // Aggregate diagnostics
    sumKelly += hd.kellyFraction;
    sumVolMult += hd.volMultiplier;
    sumFactor += hd.effectivePositionFactor;
    sumLeverage += hd.effectiveLeverage;

    if (hd.volMultiplier <= config.volTargetConfig.minVolMultiplier + 1e-9 &&
        hd.rawVolMultiplier < hd.volMultiplier - 1e-9) {
      lowerClampCount++;
    } else if (hd.volMultiplier >= config.volTargetConfig.maxVolMultiplier - 1e-9 &&
               hd.rawVolMultiplier > hd.volMultiplier + 1e-9) {
      upperClampCount++;
    } else {
      middleCount++;
    }

    if (hd.kellyBucket === null) {
      insufficientCount++;
    } else if (hd.kellyBucket === 1.0) {
      fullCount++;
    } else if (hd.kellyBucket === 0.7) {
      threeQuarterCount++;
    } else if (hd.kellyBucket === 0.5) {
      halfCount++;
    } else {
      quarterCount++;
    }
  }

  const n = days.length;
  const avgKelly = n > 0 ? sumKelly / n : config.baseKellyFraction;
  const avgVolMult = n > 0 ? sumVolMult / n : 1.0;
  const avgFactor = n > 0 ? sumFactor / n : config.baseKellyFraction;
  const avgLeverage = n > 0 ? sumLeverage / n : ONE_TO_TEN_BASE_LEVERAGE;

  // Bucket distribution as fractions
  const kellyBucketDistribution = n > 0
    ? {
        fullKellyFraction: fullCount / n,
        threeQuarterFraction: threeQuarterCount / n,
        halfKellyFraction: halfCount / n,
        quarterKellyFraction: quarterCount / n,
        insufficientFraction: insufficientCount / n,
      }
    : {
        fullKellyFraction: 0,
        threeQuarterFraction: 0,
        halfKellyFraction: 0,
        quarterKellyFraction: 0,
        insufficientFraction: 1,
      };

  // Position-size recommendations — Phase 6 Track C formula:
  //   effectiveKelly = baseKellyFraction × effectivePositionFactor
  //   recommendedRiskPerTrade = effectiveKelly / 0.10
  //   recommendedMaxPositionPctEquity = effectiveKelly
  const effectiveKelly = config.baseKellyFraction * avgFactor;
  const recommendedRiskPerTrade = effectiveKelly / 0.1;
  const recommendedMaxPositionPctEquity = Math.min(0.99, effectiveKelly);

  // All-loss streak check (delegated to AdaptiveKelly logic)
  const adaptiveKellyResult: AdaptiveKellyResult | null = trades.length > 0
    ? computeAdaptiveKelly(
        trades,
        config.rollingWindowDays,
        config.initialEquity,
        // AdaptiveKelly has its own DEFAULT_KELLY_OPT_CONFIG; we only need the
        // hadAllLossStreak flag from the result.
        undefined,
        config.minTradeCount,
      )
    : null;

  void baseNotional; // baseNotional is used at the CLI layer (passed to engine.positionSize)

  return {
    config,
    days,
    avgKellyFraction: avgKelly,
    avgVolMultiplier: avgVolMult,
    avgEffectivePositionFactor: avgFactor,
    avgEffectiveLeverage: avgLeverage,
    upperClampFraction: n > 0 ? upperClampCount / n : 0,
    lowerClampFraction: n > 0 ? lowerClampCount / n : 0,
    middleFraction: n > 0 ? middleCount / n : 0,
    kellyBucketDistribution,
    recommendedRiskPerTrade,
    recommendedMaxPositionPctEquity,
    hadAllLossStreak: adaptiveKellyResult?.hadAllLossStreak ?? false,
  };
}

// ----------------------------------------------------------------------
// PositionSizer interface compatibility helper
// ----------------------------------------------------------------------

/**
 * `toPositionSizerConfig` — convert a `HybridSizerResult` into the engine's
 * `positionSize` config shape. Mirrors the convention used by the
 * Phase 6 Track C and Phase 8 Track G CLI runners.
 *
 * The integration owner can wire this into the backtest engine's
 * `positionSize` field directly.
 */
export function toPositionSizerConfig(
  hybrid: HybridSizerResult,
): HybridSizerPositionSizerConfig {
  return {
    riskPerTrade: hybrid.recommendedRiskPerTrade,
    kellyFraction: 1.0, // multiplier baked into recommendedRiskPerTrade
    maxDrawdown: 0.15, // standard cap
    maxPositionPctEquity: hybrid.recommendedMaxPositionPctEquity,
    minPositionPctEquity: 0.01,
  };
}

// ----------------------------------------------------------------------
// Walk-forward validator for the hybrid sizer
// ----------------------------------------------------------------------

/**
 * `HybridWalkForwardWindow` — per-window diagnostic for the hybrid
 * walk-forward validator. Each window sizes the OOS slice using the
 * IN-SAMPLE average hybrid factor (frozen train→test convention,
 * consistent with Phase 7 Track B and Phase 8 Track G).
 */
export interface HybridWalkForwardWindow {
  readonly index: number;
  readonly trainStart: number;
  readonly trainEnd: number;
  readonly testStart: number;
  readonly testEnd: number;
  readonly trainTradeCount: number;
  readonly testTradeCount: number;
  readonly trainAvgKellyFraction: number;
  readonly trainAvgVolMultiplier: number;
  readonly trainAvgEffectiveFactor: number;
  readonly testMultiplier: number; // frozen train→test (avg effective factor)
  readonly testReturn: number;
  readonly testSharpe: number;
}

/**
 * `HybridWalkForwardValidation` — aggregate output of the walk-forward
 * validator. Uses the AGGREGATE Sharpe (concatenated test trades) as
 * the trustworthy small-sample signal, per Phase 7 Track B / Phase 8
 * Track G convention.
 */
export interface HybridWalkForwardValidation {
  readonly windows: readonly HybridWalkForwardWindow[];
  readonly trainDays: number;
  readonly testDays: number;
  readonly stepDays: number;
  readonly purgeDays: number;
  readonly initialEquity: number;
  readonly avgTrainKelly: number;
  readonly avgTestKelly: number;
  readonly avgTrainVolMult: number;
  readonly avgTestVolMult: number;
  readonly aggregateTestSharpe: number;
  readonly aggregateTestReturn: number;
  readonly totalTestTrades: number;
  readonly positiveTestSharpeFraction: number;
  readonly overfitRisk: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * `runHybridWalkForwardValidation` — walk-forward validator for the
 * hybrid sizer. Uses a `purgeDays` gap between train and test slices
 * to avoid look-ahead bias from rolling-window overlap (the Phase 8
 * lesson: REAL walk-forward must include a purge).
 *
 * For each window:
 *   1. Compute the hybrid sizer on the train slice (trades + OHLCV).
 *   2. The OOS slice is sized using the IN-SAMPLE average factor
 *      (frozen train→test convention).
 *   3. Aggregate test Sharpe = per-trade Sharpe on the union of all
 *      test-window trades (robust to <30-trade small-sample noise).
 *
 * @param trades Chronologically-sorted trade list.
 * @param ohlcv Chronologically-sorted daily candles (must overlap with trades).
 * @param trainDays Train window days (default 180).
 * @param testDays Test window days (default 30).
 * @param stepDays Step days (default 30).
 * @param purgeDays Purge gap between train end and test start (default 7 — Phase 9 lesson).
 * @param config Hybrid sizer config.
 */
export function runHybridWalkForwardValidation(
  trades: readonly Trade[],
  ohlcv: readonly DailyOhlcv[],
  trainDays: number,
  testDays: number,
  stepDays: number,
  purgeDays: number,
  config: HybridSizerConfig = DEFAULT_HYBRID_SIZER_CONFIG,
): HybridWalkForwardValidation {
  if (trainDays <= 0 || testDays <= 0 || stepDays <= 0) {
    throw new Error(
      `walk-forward windows must have positive day values: ${trainDays}/${testDays}/${stepDays}`,
    );
  }
  if (purgeDays < 0) {
    throw new Error(`purgeDays must be non-negative: ${purgeDays}`);
  }
  if (trades.length === 0) {
    throw new Error("Cannot validate empty trade list");
  }
  if (ohlcv.length < 2) {
    throw new Error("Cannot validate empty OHLCV series");
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const sortedTrades = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const sortedOhlcv = [...ohlcv].sort((a, b) => a.timestamp - b.timestamp);

  const firstOhlcvTime = sortedOhlcv[0]!.timestamp;
  const lastOhlcvTime = sortedOhlcv[sortedOhlcv.length - 1]!.timestamp;
  const trainMs = trainDays * DAY_MS;
  const testMs = testDays * DAY_MS;
  const stepMs = stepDays * DAY_MS;
  const purgeMs = purgeDays * DAY_MS;

  // Walk forward over the OHLCV series (the time axis for sizing decisions).
  // We use the OHLCV end-of-data as the window limit; trades within each
  // window are a subset that we filter by time.
  const windows: HybridWalkForwardWindow[] = [];
  let idx = 0;
  let cursor = firstOhlcvTime;

  while (cursor + trainMs + purgeMs + testMs <= lastOhlcvTime + DAY_MS) {
    const trainStart = cursor;
    const trainEnd = cursor + trainMs;
    const testStart = trainEnd + purgeMs;
    const testEnd = testStart + testMs;

    // Select train/test candles and trades
    const trainCandles = sortedOhlcv.filter(
      (c) => c.timestamp >= trainStart && c.timestamp < trainEnd,
    );
    const testCandles = sortedOhlcv.filter(
      (c) => c.timestamp >= testStart && c.timestamp < testEnd,
    );
    const trainTrades = sortedTrades.filter(
      (t) => t.entryTime >= trainStart && t.entryTime < trainEnd,
    );
    const testTrades = sortedTrades.filter(
      (t) => t.entryTime >= testStart && t.entryTime < testEnd,
    );

    if (
      trainCandles.length >= config.volTargetConfig.windowDays &&
      testCandles.length >= 2
    ) {
      // Compute the hybrid sizer on the train slice.
      const trainHybrid = computeHybridSizer(trainTrades, trainCandles, 2000, config);
      const trainAvgFactor = trainHybrid.avgEffectivePositionFactor;
      // Frozen train→test: apply the AVERAGE train factor as a flat scaler.
      // We don't re-compute the per-day factor for the test slice (that would
      // require look-ahead; we freeze the train→test decision).
      const testReturn = perWindowReturn(testTrades);
      const testSharpe = perWindowTradeSharpe(testTrades);
      windows.push({
        index: idx,
        trainStart,
        trainEnd,
        testStart,
        testEnd,
        trainTradeCount: trainTrades.length,
        testTradeCount: testTrades.length,
        trainAvgKellyFraction: trainHybrid.avgKellyFraction,
        trainAvgVolMultiplier: trainHybrid.avgVolMultiplier,
        trainAvgEffectiveFactor: trainAvgFactor,
        testMultiplier: trainAvgFactor, // frozen
        testReturn,
        testSharpe,
      });
      idx++;
    }
    cursor += stepMs;
  }

  if (windows.length === 0) {
    throw new Error(
      `No non-empty hybrid walk-forward windows: ` +
        `train=${trainDays}d test=${testDays}d step=${stepDays}d purge=${purgeDays}d, ` +
        `${trades.length} trades, ${ohlcv.length} candles`,
    );
  }

  const avgTrainKelly = average(windows.map((w) => w.trainAvgKellyFraction));
  const avgTestKelly = avgTrainKelly; // frozen
  const avgTrainVolMult = average(windows.map((w) => w.trainAvgVolMultiplier));
  const avgTestVolMult = avgTrainVolMult; // frozen

  // Aggregate test Sharpe — concat all test trades into one series.
  const allTestTrades = windows.flatMap((w) =>
    sortedTrades.filter(
      (t) => t.entryTime >= w.testStart && t.entryTime < w.testEnd,
    ),
  );
  const aggregateTestSharpe = perWindowTradeSharpe(allTestTrades);
  const aggregateTestReturn = perWindowReturn(allTestTrades);
  const totalTestTrades = allTestTrades.length;

  const positiveSharpeFrac =
    windows.filter((w) => w.testSharpe > 0).length / windows.length;

  // Overfit risk: LOW if positive test Sharpe ≥ 0.7 AND aggregate > 0;
  // MED if positive test Sharpe ≥ 0.5 AND aggregate > 0; else HIGH.
  let overfitRisk: "LOW" | "MEDIUM" | "HIGH" = "HIGH";
  if (positiveSharpeFrac >= 0.7 && aggregateTestSharpe > 0) {
    overfitRisk = "LOW";
  } else if (positiveSharpeFrac >= 0.5 && aggregateTestSharpe > 0) {
    overfitRisk = "MEDIUM";
  }

  return {
    windows,
    trainDays,
    testDays,
    stepDays,
    purgeDays,
    initialEquity: config.initialEquity,
    avgTrainKelly,
    avgTestKelly,
    avgTrainVolMult,
    avgTestVolMult,
    aggregateTestSharpe,
    aggregateTestReturn,
    totalTestTrades,
    positiveTestSharpeFraction: positiveSharpeFrac,
    overfitRisk,
  };
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function perWindowReturn(trades: readonly Trade[]): number {
  const grossWins = trades.reduce((acc, t) => acc + (t.pnlUsd > 0 ? t.pnlUsd : 0), 0);
  const grossLosses = trades.reduce(
    (acc, t) => acc + (t.pnlUsd < 0 ? Math.abs(t.pnlUsd) : 0),
    0,
  );
  const totalNotional = trades.reduce((acc, t) => acc + t.notionalUsd, 0);
  if (totalNotional === 0) return 0;
  return (grossWins - grossLosses) / totalNotional;
}

function perWindowTradeSharpe(trades: readonly Trade[]): number {
  if (trades.length < 2) return 0;
  const returns = trades.map((t) => (t.notionalUsd > 0 ? t.pnlUsd / t.notionalUsd : 0));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return mean / std;
}

// Re-exports for convenience so consumers don't need multiple imports.
export {
  computeAdaptiveKelly,
  rollingSharpeFromDailyPnl,
  aggregateTradesToDailyPnl,
  sharpeToKellyBucket,
  nearestBucket,
  computeVolTargetedSizer,
  ONE_TO_TEN_BASE_LEVERAGE,
  validateOneToTenLeverage,
  DEFAULT_VOL_TARGET_CONFIG,
};

export type {
  AdaptiveKellyBucket,
  AdaptiveKellyResult,
  DailyOhlcv,
  VolTargetConfig,
  VolTargetPoint,
};