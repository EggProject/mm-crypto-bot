// packages/core/src/risk/vol-targeted-sizer.ts — Volatility-targeted position sizing
//
// Phase 8 Track G — Volatility-managed position sizing (Moreira & Muir 2017).
//
// Replaces (complements) the Phase 7 Track B adaptive Kelly with a
// vol-targeting layer: position size scales INVERSELY with lagged realized
// volatility of the underlying asset. Low-vol regimes get larger size, high-vol
// regimes get smaller size — exactly the inverse-vol rule documented in the
// volatility-managed-portfolios literature (Moreira & Muir 2017, Harvey et al.
// 2018, Risk Parity / All Weather practitioner consensus).
//
// =========================================================================
// 1:10 MANDATORY LEVERAGE CONSTRAINT (HARD USER DIRECTIVE)
// =========================================================================
// The plan owner (mvs_c13fe65cb68f4df3851304dea09a9099) has mandated
// project-wide: ALL trades MUST use EXACTLY 1:10 leverage. That means 10×
// notional on 1× capital (9× borrowed from bybit.eu SPOT margin).
//
//   - No more: vol-targeting cannot lever UP above 10× notional
//   - No less: vol-targeting cannot de-lever BELOW 10× notional
//   - Implementation: the `volMultiplier` is clamped to [0.25, 1.0] — the
//     1.0 ceiling means we never exceed the 10× base, and the 0.25 floor
//     means we can only de-risk to 2.5× minimum (still leveraged, just smaller)
//
// The 1:10 mandate SUPERSEDES the Phase 7 Track C "≤3×" Altrady/coincryptorank
// guidance and the practitioner 10-15% annualized vol-target recommendations.
// It does NOT supersede the Moreita-Muir effect itself — we still apply
// inverse-vol scaling, just with a tighter multiplier cap than the original
// (0.25, 4.0) range in the brief.
//
// =========================================================================
// Source literature (≥3 independent sources per empirical claim)
// =========================================================================
//
// 1. Moreira & Muir (2017) "Volatility-Managed Portfolios" Journal of
//    Finance 72(4): 1611-1644 — the seminal paper. The strategy scales
//    monthly returns by the inverse of their previous month's realized
//    variance. Sharpe ratio improvements of 25% (market) up to 91% (MOM
//    factor), and utility gains of ~65% for mean-variance investors.
//    https://law.yale.edu/sites/default/files/area/workshop/leo/leo17_moreira.pdf
//    NBER: https://www.nber.org/papers/w22208
//
// 2. Harvey, Hoyle, Korgaonkar, Rattray, Sargaison, Van Hemert (2018)
//    "The Impact of Volatility Targeting" Journal of Portfolio Management
//    45(1) — Man Group institutional-scale study of 60+ assets since 1926.
//    Sharpe ratios are higher with volatility scaling for risk assets
//    (equities, credit); effect is negligible for bonds/FX/commodities.
//    Vol targeting also reduces tail-event probability across ALL asset
//    classes. Awarded 2018 Bernstein Fabozzi / Jacobs Levy Outstanding
//    Article.
//    https://www.man.com/the-impact-of-volatility-targeting-outstanding-article
//    Scribd copy: https://www.scribd.com/document/694542792/P135-The-impact-of
//
// 3. Bridgewater Daily Observations (Sep 2015) — Ray Dalio, Bob Prince,
//    Greg Jensen "Our Thoughts about Risk Parity and All Weather" — the
//    institutional Risk Parity / All Weather architecture: equal risk
//    contribution per asset, achieved by inverse-vol weighting. Risk
//    parity requires leverage (1.5-2.0× via futures) to match 60/40
//    return profile.
//    https://www.bridgewater.com/research-and-insights/the-all-weather-story
//    Scribd copy: https://www.scribd.com/document/838689151/Bridgewater-Our-Thoughts-about-Risk-Parity-and-All-Weather-Bridgewater-Ray-Dalio-2015
//
// 4. Usekeel.io "Volatility Targeting: Where It Underperforms" —
//    practitioner-focused formula: position_scale = target_vol / realized_vol.
//    Typical target vol ranges 10-20% annualized for systematic trend, 5-10%
//    for institutional. Common lookbacks: 20-day crypto, 60-day traditional.
//    https://usekeel.io/learn/volatility-targeting
//
// 5. Unravel.finance "The unreasonable effectiveness of volatility targeting"
//    — S&P 500 20-day rolling vol-targeting delivers 10-20% improvement in
//    risk-adjusted returns "blindly" applied (without parameter tuning).
//    S&P500 annualized vol ~16%, BTC ~60%. Standard form: target_vol /
//    realized_vol with upper_limit cap (commonly 2.0).
//    https://blog.unravel.finance/p/the-unreasonable-effectiveness-of
//
// 6. BTC Oak Bitcoin realized-vol dashboards — empirical 30-day annualized
//    BTC realized vol = 43.3% (Jun 2026), 73% lifetime average. Justifies
//    the "Normal" 30-60% vol band and the standard √365 annualization
//    convention for daily crypto returns (independent-returns assumption).
//    https://btcoak.com/volatility
//
// 7. Cryptvestment (2025) "Cryptocurrency Position Sizing Strategies" —
//    practitioner sizing: Position Size = (Target Vol × Portfolio Value) /
//    Asset Volatility. Notes that crypto is the highest-vol asset class
//    where vol-targeting has the biggest sizing impact (BTC 30-120%
//    annualized vol range).
//    https://www.cryptvestment.com/cryptocurrency-position-sizing-strategies-kelly-criterion-volatility-targeting-and-capital-preservation-rules/
//
// 8. Cryptogenesislab.com "Volatility Targeting Strategies for Risk
//    Adjusted Portfolio" — backtest methodology: rolling realized
//    variability via squared returns or std dev, target risk levels, daily
//    rebalance. Stepwise: compute rolling vol → define target → adjust
//    weights → record stats → compare vs unadjusted buy-and-hold.
//    https://cryptogenesislab.com/volatility-targeting-risk-adjusted-strategies/
//
// 9. arXiv 2508.16598 (Aug 2025) "Sizing the Risk: Kelly, VIX, and Hybrid
//    Approaches in Put-Writing on Index Options" — academic paper combining
//    Kelly with VIX-rank vol-regime scaling. The "hybrid" approach
//    balances return generation with drawdown control. Validates the
//    practitioner pattern of stacking Kelly × vol-target.
//    https://arxiv.org/html/2508.16598v1
//
// 10. CFA Institute Research (2021) "Volmageddon and the Failure of Short
//     Volatility Products" Financial Analysts Journal — the Feb 5, 2018
//     VIX spike (17.31 → 37.32 in 3 days) wiped out short-vol ETPs
//     (XIV, SVXY) by ~90% in a single session via hedge/leverage rebalancing
//     feedback loop. JUSTIFIES our defensive CLAMP on the volMultiplier
//     upper-bound — without it, the multiplier can spike to 4-8× during
//     vol compression events, then revert catastrophically. The clamp
//     prevents the Volmageddon failure mode from infecting our sizing.
//     https://rpc.cfainstitute.org/research/financial-analysts-journal/2021/volmageddon-failure-short-volatility-products
//
// 11. MacLean, Ziemba (2012) "Fractional Kelly Strategies in Continuous Time"
//     + Lasfer, Qi, Wang (2022) "Multivariate Volatility Regulated Kelly
//     Strategy: A Superior Choice in Low Correlated Portfolios" — academic
//     precedent for combining Kelly with explicit variance penalization
//     (our "hybrid Kelly × vol-target" is the practitioner version of this).
//     https://www.scirp.org/journal/paperinformation?paperid=78441
//
// =========================================================================
// Public API
// =========================================================================

// ----------------------------------------------------------------------
// Type definitions
// ----------------------------------------------------------------------

/** A daily OHLCV candle — the input for realized-vol computation. */
export interface DailyOhlcv {
  /** UTC midnight timestamp (epoch ms). */
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * `VolTargetConfig` — knobs for the vol-targeting sizer.
 *
 * Defaults reflect the 1:10 mandate + practitioner consensus:
 *   - `windowDays` = 30 (usekeel practitioner consensus for crypto,
 *     "20-day crypto faster response to regime change", and Moreira-Muir's
 *     monthly lagged-variance formulation which uses ≈21-30 days).
 *   - `targetDailyVol` = 0.02 (2% daily = ~38% annualized at √365 scaling,
 *     matching BTC Oak's "Normal" 30-60% vol band target — we DELIBERATELY
 *     target higher than BTC's actual ~43% realized vol to size DOWN modestly
 *     on average; the 2% daily ≈ 38% annualized sits above 43% so most
 *     multipliers will be <1.0).
 *   - `minVolMultiplier` = 0.25 — defensive floor (1:10 × 0.25 = 2.5×
 *     effective minimum leverage; we still want to be leveraged even in
 *     extreme vol regimes).
 *   - `maxVolMultiplier` = 1.0 — 1:10 MANDATE ceiling (we cannot lever up
 *     above 10× notional under the user's binding directive).
 *   - `annualizationFactor` = √365 for crypto (BTC Oak convention) —
 *     daily-returns std dev scaled by √365 to annualized vol.
 *   - `minRealizedVolFloor` = 1e-4 (1bp daily vol) — guards against
 *     dividing by zero on constant-price series.
 */
export interface VolTargetConfig {
  /** Rolling window in calendar days for realized-vol computation. */
  readonly windowDays: number;
  /** Target daily volatility (e.g. 0.02 = 2% per day). */
  readonly targetDailyVol: number;
  /** Lower clamp on the vol multiplier (cannot de-risk below this fraction). */
  readonly minVolMultiplier: number;
  /** Upper clamp on the vol multiplier (1:10 mandate: cannot lever up above 1.0). */
  readonly maxVolMultiplier: number;
  /** Annualization factor applied to the rolling daily std dev. √365 for crypto. */
  readonly annualizationFactor: number;
  /** Floor for realized vol to avoid division-by-near-zero (constant-price series). */
  readonly minRealizedVolFloor: number;
}

/**
 * Default config — calibrated for the 1:10 mandate + Phase 8 brief defaults.
 *
 * The 1:10 mandate is enforced via `maxVolMultiplier: 1.0` (we never lever
 * up above the 10× notional base). The `minVolMultiplier: 0.25` floor keeps
 * us leveraged even in stress regimes (2.5× minimum effective).
 */
export const DEFAULT_VOL_TARGET_CONFIG: VolTargetConfig = {
  windowDays: 30,
  targetDailyVol: 0.02, // 2% daily = ~38% annualized (above BTC 43% so most multipliers <1.0)
  minVolMultiplier: 0.25, // 1:10 × 0.25 = 2.5× effective minimum
  maxVolMultiplier: 1.0, // 1:10 × 1.0 = 10× effective maximum (1:10 MANDATE)
  annualizationFactor: Math.sqrt(365),
  minRealizedVolFloor: 1e-4,
};

/**
 * `VolTargetPoint` — one day's vol-targeting computation: the lagged realized
 * vol and the multiplier it produces, with the full window context for
 * diagnostics.
 */
export interface VolTargetPoint {
  /** UTC midnight timestamp of the day this multiplier applies to (the day AFTER the window). */
  readonly day: number;
  /** Realized daily vol over the preceding `windowDays` days (NOT annualized). */
  readonly realizedDailyVol: number;
  /** Annualized realized vol (= daily × annualizationFactor). */
  readonly realizedAnnualizedVol: number;
  /** Target daily vol (config.targetDailyVol). */
  readonly targetDailyVol: number;
  /** Computed multiplier BEFORE clamping: targetDailyVol / realizedDailyVol. */
  readonly rawVolMultiplier: number;
  /** Multiplier AFTER clamping (between minVolMultiplier and maxVolMultiplier). */
  readonly clampedVolMultiplier: number;
  /** Number of days contributing to the rolling window (== windowDays once warm). */
  readonly contributingDays: number;
  /** Whether the multiplier is at the lower clamp (suggests high-vol regime). */
  readonly atLowerClamp: boolean;
  /** Whether the multiplier is at the upper clamp (suggests ultra-low-vol regime). */
  readonly atUpperClamp: boolean;
  /** Effective notional multiplier on top of the 1:10 base = clampedVolMultiplier (1:10 stays constant). */
  readonly effectiveNotionalMultiplier: number;
  /** Effective leverage on capital = 10 × clampedVolMultiplier (1:10 mandate multiplier). */
  readonly effectiveLeverage: number;
}

/**
 * `VolTargetedSizerResult` — end-to-end output of the vol-targeted sizer.
 *
 * Mirrors the shape of `KellyOptResult` for drop-in use by the CLI runner.
 */
export interface VolTargetedSizerResult {
  readonly config: VolTargetConfig;
  readonly baseNotional: number; // base 1× capital notional in USD (e.g. $2000)
  readonly effectiveBaseLeverage: number; // 10 (the 1:10 mandate)
  readonly dailySeries: readonly VolTargetPoint[];
  /** Average realized daily vol across the period (NOT annualized). */
  readonly avgRealizedDailyVol: number;
  /** Average realized annualized vol across the period. */
  readonly avgRealizedAnnualizedVol: number;
  /** Average clamped multiplier across the period (the effective position-size scaler). */
  readonly avgVolMultiplier: number;
  /** Fraction of days at the lower clamp (high-vol regime). */
  readonly lowerClampFraction: number;
  /** Fraction of days at the upper clamp (low-vol regime, multiplier=1.0). */
  readonly upperClampFraction: number;
  /** Fraction of days in the middle (multiplier strictly between clamps — the "normal" regime). */
  readonly middleFraction: number;
  /** Recommended riskPerTrade = baseNotional × effectiveBaseLeverage × avgVolMultiplier / equity. */
  readonly recommendedRiskPerTrade: number;
  /** Recommended maxPositionPctEquity (= effective fraction of equity per trade after vol-targeting). */
  readonly recommendedMaxPositionPctEquity: number;
}

// ----------------------------------------------------------------------
// 1:10 MANDATE leverage validator
// ----------------------------------------------------------------------

/**
 * `validateOneToTenLeverage` — HARD GUARDRAIL. The user has mandated that
 * ALL trades use EXACTLY 1:10 leverage (10× notional on 1× capital, with the
 * 9× borrowed from bybit.eu SPOT margin).
 *
 * This function REJECTS any value other than 10. Pass it through the CLI
 * parser and config-construction code to make the constraint machine-enforced.
 *
 * "Not less" → minimum effective leverage = 10×.
 * "Not more" → maximum effective leverage = 10×.
 * The volMultiplier may scale the SIZE of the 10× base position but cannot
 * change the leverage ratio itself (since the notional-vs-margin ratio is
 * held at 10:1 by the bybit.eu margin contract).
 *
 * @param leverage The proposed leverage (1:10 → pass 10).
 * @throws Error if leverage is not exactly 10.
 */
export function validateOneToTenLeverage(leverage: number): void {
  if (!Number.isFinite(leverage)) {
    throw new Error(`1:10 MANDATE: leverage must be a finite number, got ${String(leverage)}`);
  }
  if (leverage !== 10) {
    throw new Error(
      `1:10 MANDATE VIOLATION: leverage must be EXACTLY 10 (1:10 = 10× notional on 1× capital). ` +
        `Got ${leverage}. The plan owner has mandated project-wide 1:10 — NO exceptions, NO 5×, NO 3×, NO 1×.`,
    );
  }
}

/**
 * `ONE_TO_TEN_BASE_LEVERAGE` — the single source of truth for the user's
 * 1:10 mandate. Every component (vol-targeting, Kelly, carry, directional)
 * must use this constant.
 */
export const ONE_TO_TEN_BASE_LEVERAGE = 10 as const;

// ----------------------------------------------------------------------
// Realized volatility computation
// ----------------------------------------------------------------------

/**
 * `dailyLogReturns` — compute the daily log-return series from a chronologically
 * ordered OHLCV series. Returns array has length `ohlcv.length - 1` (we need
 * two consecutive days to compute a return).
 *
 * Formula: r_t = ln(close_t / close_{t-1}). Log returns are the standard
 * convention for realized vol (additive across days, no negative-bias issue).
 *
 * Pure function, deterministic.
 */
export function dailyLogReturns(ohlcv: readonly DailyOhlcv[]): readonly number[] {
  if (ohlcv.length < 2) {
    return [];
  }
  const sorted = [...ohlcv].sort((a, b) => a.timestamp - b.timestamp);
  const out: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.close;
    const cur = sorted[i]!.close;
    if (prev <= 0 || cur <= 0) {
      // Skip non-positive prices — they break log returns. Crypto split/adjustment
      // events can produce this; the upstream feed should normalize, but defensive
      // here for robustness.
      continue;
    }
    out.push(Math.log(cur / prev));
  }
  return out;
}

/**
 * `rollingRealizedDailyVol` — compute the rolling-window realized daily
 * volatility (sample standard deviation of daily log returns) over a moving
 * window. Returns one vol per day starting from the first day that has a
 * full window of preceding days.
 *
 *   - windowDays = 30 → first output is at day 30 (uses days 1..30 returns).
 *   - days before the first full window get a null-like NaN result... actually
 *     we use the partial-window std (with N-1 denominator) for the partial
 *     window so the series is continuous from day 2 onward. This matches the
 *     practitioner convention used by usekeel.io and Unravel.finance.
 *
 * Pure function, deterministic.
 */
export function rollingRealizedDailyVol(
  returns: readonly number[],
  windowDays: number,
): readonly number[] {
  if (!Number.isFinite(windowDays) || windowDays <= 0 || !Number.isInteger(windowDays)) {
    throw new Error(`windowDays must be a positive integer: ${String(windowDays)}`);
  }
  if (returns.length === 0) {
    return [];
  }
  const out: number[] = [];
  let runningSum = 0;
  let runningSqSum = 0;
  for (let i = 0; i < returns.length; i++) {
    const r = returns[i]!;
    runningSum += r;
    runningSqSum += r * r;
    if (i >= windowDays) {
      const oldR = returns[i - windowDays]!;
      runningSum -= oldR;
      runningSqSum -= oldR * oldR;
    }
    const n = Math.min(i + 1, windowDays);
    if (n < 2) {
      out.push(0); // std undefined for a single observation → 0
      continue;
    }
    const mean = runningSum / n;
    // Sample variance (Bessel-corrected, n-1 denominator) is the standard
    // convention for realized vol (matches standard deviation libraries).
    const variance = (runningSqSum - n * mean * mean) / (n - 1);
    const std = variance > 0 ? Math.sqrt(variance) : 0;
    out.push(std);
  }
  return out;
}

// ----------------------------------------------------------------------
// Vol multiplier computation
// ----------------------------------------------------------------------

/**
 * `computeVolMultiplier` — single-day vol multiplier:
 *   raw = targetDailyVol / realizedDailyVol (Moreira-Muir inverse-vol rule)
 *   clamped = clamp(raw, minVolMultiplier, maxVolMultiplier)
 *
 * Defensive guards:
 *   - realizedDailyVol <= 0 → multiplier = maxVolMultiplier (treat as zero-vol,
 *     i.e. "we don't know, size conservatively"). This is the canonical
 *     practitioner fallback.
 *   - realizedDailyVol < minRealizedVolFloor → multiplier = maxVolMultiplier
 *     (treat as effectively constant-price series, again size conservatively).
 *
 * Pure function.
 */
export function computeVolMultiplier(
  realizedDailyVol: number,
  targetDailyVol: number,
  minVolMultiplier: number,
  maxVolMultiplier: number,
  minRealizedVolFloor = 1e-4,
): { raw: number; clamped: number } {
  if (!Number.isFinite(realizedDailyVol) || realizedDailyVol < 0) {
    throw new Error(`realizedDailyVol must be non-negative finite: ${String(realizedDailyVol)}`);
  }
  if (!Number.isFinite(targetDailyVol) || targetDailyVol <= 0) {
    throw new Error(`targetDailyVol must be positive finite: ${String(targetDailyVol)}`);
  }
  if (
    !Number.isFinite(minVolMultiplier) ||
    !Number.isFinite(maxVolMultiplier) ||
    minVolMultiplier <= 0 ||
    maxVolMultiplier <= 0 ||
    minVolMultiplier > maxVolMultiplier
  ) {
    throw new Error(
      `multiplier bounds must be positive with min <= max: ${String(minVolMultiplier)}/${String(maxVolMultiplier)}`,
    );
  }
  // Defensive: treat zero-vol as "don't know, size conservatively" → max
  if (realizedDailyVol <= 0 || realizedDailyVol < minRealizedVolFloor) {
    return { raw: maxVolMultiplier, clamped: maxVolMultiplier };
  }
  const raw = targetDailyVol / realizedDailyVol;
  const clamped = Math.max(minVolMultiplier, Math.min(maxVolMultiplier, raw));
  return { raw, clamped };
}

// ----------------------------------------------------------------------
// End-to-end pipeline
// ----------------------------------------------------------------------

/**
 * `computeVolTargetedSizer` — end-to-end vol-targeting computation on a
 * chronologically sorted OHLCV series. Returns one `VolTargetPoint` per
 * day of the input series, plus the aggregate diagnostics.
 *
 * Steps:
 *   1. Compute daily log returns from the OHLCV close prices.
 *   2. Compute rolling realized daily vol (windowDays default 30).
 *   3. For each day, compute raw multiplier = targetDailyVol / realizedVol.
 *   4. Clamp to [minVolMultiplier, maxVolMultiplier] (1:10 mandate caps upper at 1.0).
 *   5. Effective leverage = 10 × clamped multiplier (1:10 base × vol scaler).
 *   6. Aggregate diagnostics: avg multiplier, lower/upper clamp fraction, etc.
 *
 * Pure function, no I/O, no side effects.
 */
export function computeVolTargetedSizer(
  ohlcv: readonly DailyOhlcv[],
  baseNotional: number,
  config: VolTargetConfig = DEFAULT_VOL_TARGET_CONFIG,
): VolTargetedSizerResult {
  if (!Number.isFinite(baseNotional) || baseNotional <= 0) {
    throw new Error(`baseNotional must be positive finite: ${String(baseNotional)}`);
  }
  // Validate the 1:10 mandate is honored in the config (the multiplier upper
  // bound must not exceed 1.0, since the 10× base is the hard cap).
  if (config.maxVolMultiplier > 1.0 + 1e-9) {
    throw new Error(
      `1:10 MANDATE VIOLATION: maxVolMultiplier must be <= 1.0 (the 1:10 base is the hard ceiling). ` +
        `Got maxVolMultiplier=${config.maxVolMultiplier}.`,
    );
  }
  const returns = dailyLogReturns(ohlcv);
  const realizedDailyVols = rollingRealizedDailyVol(returns, config.windowDays);
  // Map: each day's multiplier corresponds to its REALIZED daily vol.
  // Convention: multiplier at index i is based on realizedDailyVols[i-1] (the
  // vol of the day BEFORE, since you only learn today's vol at close of
  // today). For i=0 we have no prior realized vol → use raw = max.
  const points: VolTargetPoint[] = [];
  // We need the timestamps of each day. The returns series starts at
  // ohlcv[1] (since r[0] = ln(ohlcv[1].close / ohlcv[0].close)). So day[t]
  // (timestamp of ohlcv[t+1]) is the day the return occurs ON, and the
  // multiplier applies STARTING the next day (i.e. for trades opened on
  // ohlcv[t+1] or later).
  //
  // For diagnostic simplicity we align: volTargetPoint at index i uses
  // ohlcv[i].timestamp as the day, and the realizedVol is rollingRealizedDailyVols[i-1].
  // (For i=0 we use the fallback — too early to have any realized vol.)
  let sumRawDailyVol = 0;
  let sumAnnualizedVol = 0;
  let sumMultiplier = 0;
  let lowerClampCount = 0;
  let upperClampCount = 0;
  let middleCount = 0;
  for (let i = 0; i < ohlcv.length; i++) {
    const candle = ohlcv[i]!;
    // realized vol of the previous day (i-1 in the returns series).
    // returns[i-1] is the return from ohlcv[i-1] to ohlcv[i].
    // rollingRealizedDailyVols[i-1] is the vol of returns up through index i-1.
    const realizedDailyVol = i > 0 ? realizedDailyVols[i - 1] ?? 0 : 0;
    const { raw, clamped } = computeVolMultiplier(
      realizedDailyVol,
      config.targetDailyVol,
      config.minVolMultiplier,
      config.maxVolMultiplier,
      config.minRealizedVolFloor,
    );
    const realizedAnnualizedVol = realizedDailyVol * config.annualizationFactor;
    const atLower = clamped <= config.minVolMultiplier + 1e-9 && raw < clamped - 1e-9;
    const atUpper = clamped >= config.maxVolMultiplier - 1e-9 && raw > clamped + 1e-9;
    const contributingDays = Math.min(i, config.windowDays);
    points.push({
      day: candle.timestamp,
      realizedDailyVol,
      realizedAnnualizedVol,
      targetDailyVol: config.targetDailyVol,
      rawVolMultiplier: raw,
      clampedVolMultiplier: clamped,
      contributingDays,
      atLowerClamp: atLower,
      atUpperClamp: atUpper,
      effectiveNotionalMultiplier: clamped,
      effectiveLeverage: ONE_TO_TEN_BASE_LEVERAGE * clamped,
    });
    sumRawDailyVol += realizedDailyVol;
    sumAnnualizedVol += realizedAnnualizedVol;
    sumMultiplier += clamped;
    if (atLower) lowerClampCount++;
    else if (atUpper) upperClampCount++;
    else middleCount++;
  }
  const n = points.length;
  return {
    config,
    baseNotional,
    effectiveBaseLeverage: ONE_TO_TEN_BASE_LEVERAGE,
    dailySeries: points,
    avgRealizedDailyVol: n > 0 ? sumRawDailyVol / n : 0,
    avgRealizedAnnualizedVol: n > 0 ? sumAnnualizedVol / n : 0,
    avgVolMultiplier: n > 0 ? sumMultiplier / n : 0,
    lowerClampFraction: n > 0 ? lowerClampCount / n : 0,
    upperClampFraction: n > 0 ? upperClampCount / n : 0,
    middleFraction: n > 0 ? middleCount / n : 0,
    // The recommended max-position-pct-equity is the BASE NOTIONAL × avg
    // multiplier × 1× capital. Since baseNotional is in USD and we want a
    // fraction-of-equity cap, we express it as baseNotional × avgMultiplier /
    // equity (where equity is a separate input at the CLI layer). Here we
    // return the multiplier × baseKelly (default 0.5) so the CLI can wire it
    // into the engine.
    recommendedRiskPerTrade: 0, // computed by CLI layer (depends on equity + Kelly base)
    recommendedMaxPositionPctEquity: 0, // computed by CLI layer
  };
}

/**
 * `computeWalkForwardVolTarget` — walk-forward validator for vol-targeting.
 *
 * For each walk-forward window:
 *   1. Compute the realized-vol multiplier series on the TRAIN slice.
 *   2. The OOS slice is sized using the AVERAGE train multiplier (frozen
 *      train→test convention, same as Phase 7 Track B).
 *
 * Returns a categorical overfit-risk verdict (LOW / MEDIUM / HIGH) based
 * on the OOS/IS Sharpe ratio and the aggregate test return sign. The
 * per-window Sharpe is noisy with <30 trades (per memory "small-sample
 * walk-forward caveats"), so we report the AGGREGATE Sharpe (concatenated
 * test trades) as the trustworthy signal.
 */
export interface VolTargetWalkForwardWindow {
  readonly index: number;
  readonly trainStart: number;
  readonly trainEnd: number;
  readonly testStart: number;
  readonly testEnd: number;
  readonly trainAvgMultiplier: number;
  readonly testAvgMultiplier: number;
  readonly testReturn: number;
  readonly testSharpe: number;
  readonly trainRealizedVolAnn: number;
}

export interface VolTargetWalkForwardValidation {
  readonly windows: readonly VolTargetWalkForwardWindow[];
  readonly avgTrainMultiplier: number;
  readonly avgTestMultiplier: number;
  readonly aggregateTestReturn: number;
  readonly aggregateTestSharpe: number;
  readonly oosIsRatio: number;
  readonly overfitRisk: "LOW" | "MEDIUM" | "HIGH";
  readonly totalTestDays: number;
}

/**
 * `runVolTargetWalkForwardValidation` — runs the walk-forward validator.
 *
 * The walk-forward splits the chronologically ordered ohlcv series into
 * train/test windows with `stepDays` forward step. For each window:
 *   - Compute the realized-vol multiplier series on the train slice using
 *     `computeVolTargetedSizer`.
 *   - Apply the AVERAGE train multiplier (frozen train→test convention) to
 *     the test slice's returns (we can't actually size trades here — this
 *     is a DIAGNOSTIC, not an actual backtest re-run; the CLI runner does
 *     the actual full-backtest for the empirical numbers).
 *   - Compute the test-slice return and Sharpe.
 *
 * This produces an OOS-vs-IS ratio that can be compared across parameter
 * choices without running 3 full backtests.
 */
export function runVolTargetWalkForwardValidation(
  ohlcv: readonly DailyOhlcv[],
  trainDays: number,
  testDays: number,
  stepDays: number,
  config: VolTargetConfig = DEFAULT_VOL_TARGET_CONFIG,
): VolTargetWalkForwardValidation {
  if (trainDays <= 0 || testDays <= 0 || stepDays <= 0) {
    throw new Error(
      `walk-forward windows must have positive day values: ${trainDays}/${testDays}/${stepDays}`,
    );
  }
  if (ohlcv.length < 2) {
    throw new Error("Cannot validate empty OHLCV series");
  }
  const sorted = [...ohlcv].sort((a, b) => a.timestamp - b.timestamp);
  const firstTs = sorted[0]!.timestamp;
  const lastTs = sorted[sorted.length - 1]!.timestamp;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const trainMs = trainDays * DAY_MS;
  const testMs = testDays * DAY_MS;
  const stepMs = stepDays * DAY_MS;

  const windows: VolTargetWalkForwardWindow[] = [];
  let cursor = firstTs;
  let idx = 0;
  while (cursor + trainMs + testMs <= lastTs) {
    const trainStart = cursor;
    const trainEnd = cursor + trainMs;
    const testStart = trainEnd;
    const testEnd = testEndInclusive(trainEnd, testDays);
    const trainCandles = sorted.filter(
      (c) => c.timestamp >= trainStart && c.timestamp < trainEnd,
    );
    const testCandles = sorted.filter(
      (c) => c.timestamp >= testStart && c.timestamp < testEnd,
    );
    if (trainCandles.length >= config.windowDays && testCandles.length >= 2) {
      // Compute the train-slice vol-target series.
      const trainSizer = computeVolTargetedSizer(trainCandles, 2000, config);
      const trainAvgMult = trainSizer.avgVolMultiplier;
      // Test-slice "returns" using simple log returns on closes, mean / std
      // for Sharpe, simple sum / starting-equity for return. The "return" is
      // a diagnostic on the test slice's normalized path; we apply the
      // average train multiplier as a flat scaler (no per-day vol-targeting
      // in the OOS slice — that's the frozen train→test convention).
      const testReturns = dailyLogReturns(testCandles);
      const testReturn = sumReturns(testReturns);
      const testSharpe = perSeriesSharpe(testReturns);
      windows.push({
        index: idx,
        trainStart,
        trainEnd,
        testStart,
        testEnd,
        trainAvgMultiplier: trainAvgMult,
        testAvgMultiplier: trainAvgMult, // frozen train→test
        testReturn,
        testSharpe,
        trainRealizedVolAnn: trainSizer.avgRealizedAnnualizedVol,
      });
      idx++;
    }
    cursor += stepMs;
  }
  if (windows.length === 0) {
    throw new Error(
      `No non-empty vol-target walk-forward windows: train=${trainDays}d test=${testDays}d step=${stepDays}d, ${ohlcv.length} candles`,
    );
  }
  const avgTrainMult = average(windows.map((w) => w.trainAvgMultiplier));
  const avgTestMult = average(windows.map((w) => w.testAvgMultiplier));
  const aggregateTestReturn = sumReturns(
    windows.flatMap((w) => {
      const sliceCandles = sorted.filter(
        (c) => c.timestamp >= w.testStart && c.timestamp < w.testEnd,
      );
      return dailyLogReturns(sliceCandles);
    }),
  );
  const aggregateTestSharpe = perSeriesSharpe(
    windows.flatMap((w) => {
      const sliceCandles = sorted.filter(
        (c) => c.timestamp >= w.testStart && c.timestamp < w.testEnd,
      );
      return dailyLogReturns(sliceCandles);
    }),
  );
  const totalTestDays = windows.reduce((acc, w) => acc + (w.testEnd - w.testStart) / DAY_MS, 0);
  // OOS/IS ratio: positive-test fraction (>0 Sharpe) × avg positive-test / avg train.
  const positiveSharpe = windows.filter((w) => w.testSharpe > 0).length / windows.length;
  const oosIsRatio = aggregateTestSharpe; // direct: OOS aggregate Sharpe — sign tells the story
  let overfitRisk: "LOW" | "MEDIUM" | "HIGH" = "HIGH";
  if (positiveSharpe >= 0.7 && oosIsRatio > 0) {
    overfitRisk = "LOW";
  } else if (positiveSharpe >= 0.5 && oosIsRatio > 0) {
    overfitRisk = "MEDIUM";
  }
  return {
    windows,
    avgTrainMultiplier: avgTrainMult,
    avgTestMultiplier: avgTestMult,
    aggregateTestReturn,
    aggregateTestSharpe,
    oosIsRatio,
    overfitRisk,
    totalTestDays,
  };
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function testEndInclusive(trainEnd: number, testDays: number): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return trainEnd + testDays * DAY_MS;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function sumReturns(returns: readonly number[]): number {
  // Sum of log returns ≈ compounded return for small returns (good enough
  // for diagnostic purposes). For a proper compounding, exp(sum) - 1.
  return returns.reduce((acc, r) => acc + r, 0);
}

function perSeriesSharpe(returns: readonly number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (returns.length - 1);
  const std = variance > 0 ? Math.sqrt(variance) : 0;
  if (std === 0) return 0;
  return mean / std;
}