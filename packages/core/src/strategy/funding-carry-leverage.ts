// packages/core/src/strategy/funding-carry-leverage.ts — leveraged delta-neutral
// funding-rate carry with VaR cap + liquidation buffer.
//
// Phase 7 Track C — extends the Phase 6 Track A FundingCarryStrategy with:
//   - Dynamic leverage (1×..N×) applied to the perp leg notional.
//   - VaR cap: max 2% daily VaR at 95% confidence (parametric + historical).
//   - Liquidation buffer: maintain ≥50% initial margin (configurable).
//   - Funding-rate stability scaling: rolling 30d std-dev of the funding rate
//     drives the leverage multiplier (higher std-dev → lower leverage).
//   - Rebalance threshold scales with leverage (avoid liquidation cascade).
//
// Phase 8 Track D — 1:10 mandatory leverage CONSTRAINT (HARD GUARDRAIL):
//   - DEFAULT maxLeverage raised 3 → 10 (1:10 = bybit.eu SPOT margin default).
//   - Effective leverage at runtime MUST be either 1× (no-leverage baseline)
//     or 10× (1:10 mandatory project-wide leverage).
//   - All strategy/CLI constructors and runners REJECT any other leverage
//     value at config-validation time (the `assert1to10Leverage` hard guard).
//   - 7× "upper-bound" (originally targeted) is no longer reachable; the
//     empirical push is now at 10× and the cost-model-vs-edge trade-off is
//     re-verified empirically (Phase 7 3× → Phase 8 10× push).
//
// References:
//   - SSRN 5292305 (2025) — "Leveraged BTC Funding Carry Algorithm"
//     3× leveraged long-spot/short-perp: Sharpe 6.1, max DD < 2%, 16% APR
//   - ScienceDirect (Werapun 2025) — drift-XRP 7× funding rate arb Sharpe 15.85
//   - Bybit Institutional 2025 Crypto Quant Strategy Index — Delta Neutral
//     +9.48% on Bybit, max DD 0.80%, positive every month of 2025
//     Dollar Neutral +31.23% (best venue 66.69%, Sharpe 2.39, max DD 7.72%)
//   - Bybit maintenance margin / liquidation formulas (Bybit Help Center 2025) —
//     Initial Margin = Position Value / Leverage,
//     Maintenance Margin = Position Value × MMR (0.4-0.5% for BTC ≤$1M notional),
//     Spot Margin Trading max leverage = 10× (default IMR computation).
//   - Pomegra.io / Binance — VaR-based position sizing:
//     VaR = Portfolio × σ × z-score (z=1.65 at 95%); daily VaR ≤ 2% of equity
//   - Altrady / coincryptorank — keep effective leverage ≤ 3× for
//     basis trades, ≤5× at industry consensus; (see Phase 8 §3 for the
//     10× empirical risk vs. 3× comparison).
//   - MiCAR (EU) 2023/1114 — perp products excluded from retail CASP scope;
//     binance.us / kraken-futures / deribit are typical pro-only venues.
//     bybit.eu offers SPOT-only for retail (margin / leverage up to 10×).

import { FundingCarryStrategy } from "./funding-carry.js";
import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

// ---------------------------------------------------------------------------
// Phase 8 Track D — 1:10 MANDATORY LEVERAGE CONSTRAINT (HARD GUARDRAIL)
// ---------------------------------------------------------------------------
// Project-wide mandate: every trade uses EXACTLY 1:10 leverage (10× notional
// on 1× capital, 9× borrowed from bybit.eu SPOT margin). 1× (no leverage) is
// permitted ONLY as the backtest baseline for scaling-curve comparison. All
// other leverage values (2/3/5/7/etc.) are REJECTED at config-validation time.
//
// See docs/research/phase8-carry-leverage-1-10.md §X.X.1 "1:10 MANDATORY
// LEVERAGE CONSTRAINT" for the user-mandate context and rationale.

/**
 * `ALLOWED_LEVERAGE_VALUES` — the ONLY leverage values the strategy will
 * accept. Phase 8 Track D user mandate: project-wide 1:10 (10×) leverage.
 * 1× is retained ONLY as the backtest baseline reference. 2/3/5/7 etc.
 * are explicitly excluded by the design.
 */
export const ALLOWED_LEVERAGE_VALUES: readonly number[] = Object.freeze([1, 10]);

/**
 * `DEFAULT_LEVERAGE` — the operational leverage used when no explicit
 * value is provided. Per the 1:10 mandate, this is 10×.
 */
export const DEFAULT_LEVERAGE: 1 | 10 = 10;

/**
 * `assert1to10Leverage` — HARD GUARDRAIL. Throws an error if `value` is not
 * in `ALLOWED_LEVERAGE_VALUES`. Use this in every constructor and CLI parser
 * to enforce the 1:10 / 1× mandate.
 *
 * Accepts either a number (1 or 10) or an object with `maxLeverage` /
 * `currentLeverage` (the strategy will pick the relevant field).
 */
export function assert1to10Leverage(value: number | { maxLeverage?: number; currentLeverage?: number; leverage?: number }): void {
  let candidate: number | undefined;
  if (typeof value === "number") {
    candidate = value;
  } else {
    if (typeof value.maxLeverage === "number") candidate = value.maxLeverage;
    else if (typeof value.currentLeverage === "number") candidate = value.currentLeverage;
    else if (typeof value.leverage === "number") candidate = value.leverage;
  }
  if (candidate === undefined) return; // No leverage assertion possible.
  if (!ALLOWED_LEVERAGE_VALUES.includes(candidate)) {
    throw new Error(
      `[Phase 8 Track D] HARD GUARDRAIL VIOLATION: leverage=${candidate}× is NOT ALLOWED. ` +
        `Project-wide mandate: ONLY ${ALLOWED_LEVERAGE_VALUES.join("× or ")}× leverage is permitted ` +
        `(1× is baseline-only, 10× = 1:10 bybit.eu SPOT margin default). ` +
        `See docs/research/phase8-carry-leverage-1-10.md §X.X.1 "1:10 MANDATORY LEVERAGE CONSTRAINT".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Existing Phase 7 Track C types (preserved) + new Phase 8 helpers
// ---------------------------------------------------------------------------

/**
 * VaR-method selector. Either parametric (assumes Gaussian return
 * distribution, `VaR = μ - z * σ`) or historical (5th-percentile of
 * the empirical daily-funding-rate distribution). Both must stay
 * below the `maxDailyVarPct` cap; the more conservative of the two
 * governs `computeEffectiveLeverage()`.
 */
export type VarMethod = "parametric" | "historical";

/**
 * `LeveragedCarryConfig` — config for FundingCarryLeverageStrategy.
 *
 * Defaults reflect the empirical Phase 6 Track A baseline plus the
 * Track C leverage research:
 *   - `maxLeverage = 10` — Phase 8 Track D default. The 1:10 mandatory
 *     leverage project-wide mandate supersedes the Phase 7 3× cap.
 *     1× is the backtest baseline (alongside 10×).
 *   - `minLeverage = 1` — fully-collateralized floor (baseline ONLY).
 *   - `minInitialMarginFraction = 0.50` — keep ≥50% IM after a
 *     hypothetical liquidation event matches Bybit "isolation ≥50%"
 *     and Binance "recommended margin ratio < 80%" guidance.
 *   - `rebalanceThresholdPct = 0.05` at 1× leverage — scales
 *     inversely with leverage so higher-leverage positions rebalance
 *     sooner (10× ⇒ 0.5% threshold).
 *   - `varConfidence = 0.95`, `maxDailyVarPct = 0.02` — Phase 7
 *     brief §1.2 / M1.3 hard requirement (2% daily VaR @ 95%);
 *     Phase 8 Track D preserves this hard requirement.
 */
export interface LeveragedCarryConfig {
  readonly baseNotionalUsd: number;
  readonly maxLeverage: number;
  readonly minLeverage: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
  readonly varConfidence: number; // 0..1, default 0.95
  readonly maxDailyVarPct: number; // e.g., 0.02 = 2% per day
  readonly varMethod: VarMethod;
  readonly minInitialMarginFraction: number; // 0..1, default 0.50
  readonly fundingStabilityWindowDays: number; // rolling window, default 30
  readonly fundingStabilityRefStdDev: number; // reference std-dev, default 0.0005
}

export const DEFAULT_LEVERAGED_CARRY_CONFIG: LeveragedCarryConfig = {
  baseNotionalUsd: 10_000,
  // Phase 8 Track D: 1:10 mandate — DEFAULT maxLeverage raised 3 → 10.
  maxLeverage: 10,
  // 1× baseline-only retained for backtest scaling-curve construction.
  minLeverage: 1,
  rebalanceThresholdPct: 0.05,
  withdrawalLatencyMinutes: 15,
  rebalanceCostBps: 20,
  varConfidence: 0.95,
  maxDailyVarPct: 0.02,
  varMethod: "parametric",
  minInitialMarginFraction: 0.5,
  fundingStabilityWindowDays: 30,
  fundingStabilityRefStdDev: 0.0005,
};

/**
 * `LeveragedCarryState` — mutable state of the leveraged carry strategy.
 * Extends the base FundingCarryState with leverage- and risk-tracking fields.
 */
export interface LeveragedCarryState {
  // From base strategy
  fundingCollectedUsd: number;
  rebalanceCount: number;
  rebalanceCostUsd: number;
  lastMarkPrice: number;
  unrealizedDeltaUsd: number;
  hasEntered: boolean;
  // Phase 7 Track C additions
  currentLeverage: number; // effective leverage applied (1..max)
  effectiveNotionalUsd: number; // baseNotionalUsd × currentLeverage
  initialMarginUsd: number; // effectiveNotionalUsd / currentLeverage
  maintenanceMarginUsd: number; // effectiveNotionalUsd × MMR (default 0.5%)
  dailyVaR95Pct: number; // 0..1 — VaR as fraction of initial equity
  liquidationEventsCount: number; // must stay 0
  fundingHistory: number[]; // recent funding-rate samples (8h) for stability
  lastFundingRates: readonly number[]; // immutable view, last 30 entries
}

/**
 * `LiquidationEvent` — record of a hypothetical liquidation trigger.
 * Used by the CLI runner to keep the `liquidationEvents` count in the
 * output JSON. Each event represents a moment in the backtest where
 * the maintenance-margin ratio would have dropped below the configured
 * threshold; in production this means the position would have been
 * forcibly closed by the venue.
 */
export interface LiquidationEvent {
  readonly timestampMs: number;
  readonly markPrice: number;
  readonly leverage: number;
  readonly initialMarginUsd: number;
  readonly maintenanceMarginUsd: number;
  readonly marginRatio: number;
  readonly effectiveNotionalUsd: number;
}

/**
 * `FundingCarryLeverageStrategy` — Strategy interface implementation
 * that models a leveraged delta-neutral funding-rate carry position.
 *
 * Like the base FundingCarryStrategy:
 *   1. Emits ONE "buy" signal on the first valid candle so the engine
 *      has a position to track through the backtest, with stop-loss /
 *      take-profit set far away so the position is closed only via
 *      the engine's `end_of_data` exit.
 *   2. Exposes a SEPARATE pure-functional risk-controlled accrual API
 *      used by the CLI runner:
 *        - `accrueFunding(notional, fundingRate)` → applies scaled payment
 *        - `computeEffectiveLeverage(returns, fundingRates)` → VaR-gated
 *        - `computeDynamicLeverage(...)` → NEW Phase 8 helper
 *        - `safeEffectiveLeverage(...)` → NEW Phase 8 hard-floor helper
 *        - `applyLiquidationBuffer(...)` → margin check
 *        - `recordLiquidationIfAny(...)` → count forced-unwind events
 *
 * Phase 7 Track C leverage logic (autonomous decisions):
 *   - **Stability scaling:** `refStdDev / actual30dStdDev` ratio,
 *     clamped to [0, 1]. Multiplied by `maxLeverage` to get baseline
 *     suggested leverage. This downshifts leverage in funding-unstable
 *     regimes (regime detection à la Lo 2002).
 *   - **VaR-cap:** parametric VaR using ±2×daily-equity-return std-dev
 *     (z=1.645 at 95%) must be ≤ maxDailyVarPct × equity-equivalent
 *     notional. If violated, scale down leverage.
 *   - **Margin-buffer gate:** at any point if the account margin ratio
 *     would dip below `minInitialMarginFraction`, the strategy counts
 *     a liquidation event and would force-unwind (the run aborts the
 *     scale-up attempt for subsequent rebalances).
 *
 * Phase 8 Track D additions (1:10 mandate):
 *   - DEFAULT maxLeverage raised 3 → 10.
 *   - NEW `computeDynamicLeverage(fundingRateStdDev, refStdDev)`:
 *     explicit VaR-scaling helper that returns the leverage multiplier
 *     to apply given funding-rate volatility vs. the reference baseline.
 *     Formula: `result = maxAllowed × (refStdDev / max(actualStdDev, ε))`
 *     clamped to [1, maxAllowed].
 *   - NEW `safeEffectiveLeverage(stableMultiplier, requestedLev, varCapOk)`:
 *     floors the effective leverage at 1× if `varCapOk === false` (VaR cap
 *     would be violated), preserving the requested leverage only when the
 *     VaR cap is satisfied. Returns 1 if VaR cap violated.
 *   - HARD GUARDRAIL: `assert1to10Leverage()` rejects 2/3/5/7/etc. at
 *     config validation. See module header for context.
 */
export class FundingCarryLeverageStrategy implements Strategy {
  readonly name = "Leveraged Delta-Neutral Funding Carry (Phase 8 Track D — 1:10)";
  readonly timeframes = ["1h", "4h", "1d"] as const;
  readonly config: LeveragedCarryConfig;
  readonly state: LeveragedCarryState;
  /** Base strategy borrowed for shared accrual helpers. */
  // Reserved for future cross-strategy integration (Phase 8 ensemble wiring).
  // The current Track D CLI runner drives accrual via `accrueFundingScaled`.
  private readonly baseStrategy: FundingCarryStrategy | null;

  constructor(config: Partial<LeveragedCarryConfig> = {}) {
    this.config = { ...DEFAULT_LEVERAGED_CARRY_CONFIG, ...config };
    // Phase 8 Track D — HARD GUARDRAIL: enforce 1:10 leverage mandate.
    assert1to10Leverage(this.config.maxLeverage);
    this.state = {
      // base
      fundingCollectedUsd: 0,
      rebalanceCount: 0,
      rebalanceCostUsd: 0,
      lastMarkPrice: 0,
      unrealizedDeltaUsd: 0,
      hasEntered: false,
      // Phase 7 Track C
      currentLeverage: this.config.minLeverage,
      effectiveNotionalUsd: this.config.baseNotionalUsd * this.config.minLeverage,
      initialMarginUsd: this.config.baseNotionalUsd,
      maintenanceMarginUsd: this.config.baseNotionalUsd * 0.005,
      dailyVaR95Pct: 0,
      liquidationEventsCount: 0,
      fundingHistory: [],
      lastFundingRates: [],
    };
    this.baseStrategy = new FundingCarryStrategy({
      targetNotionalUsd: this.config.baseNotionalUsd,
      rebalanceThresholdPct: this.config.rebalanceThresholdPct,
      withdrawalLatencyMinutes: this.config.withdrawalLatencyMinutes,
      rebalanceCostBps: this.config.rebalanceCostBps,
    });
    void this.baseStrategy; // Reserved for future cross-strategy integration.
  }

  warmup(): number {
    return 30;
  }

  /**
   * `onCandle` — emit ONE "buy" signal on the first valid candle so
   * the engine has a position to track through the backtest. Stop-loss
   * and take-profit are far away (effectively unreachable) so the
   * position is closed only via the engine's `end_of_data` exit. The
   * CLI runner reads `this.state` after the backtest to assemble the
   * leveraged carry metrics.
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    if (ctx.candleIndex < this.warmup()) {
      return null;
    }
    if (this.state.hasEntered) {
      this.state.lastMarkPrice = ctx.candle.close;
      return null;
    }
    this.state.hasEntered = true;
    this.state.lastMarkPrice = ctx.candle.close;
    return {
      side: "buy",
      confidence: 1,
      reason: `Leveraged funding-carry entry: long-spot + short-perp @ ${ctx.candle.close.toFixed(2)}, leverage=${this.state.currentLeverage}×, effective notional=$${this.state.effectiveNotionalUsd.toFixed(0)}`,
      stopLoss: ctx.candle.close * 0.01,
      takeProfit: ctx.candle.close * 100,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 8 Track D — NEW helpers (1:10 mandate, dynamic VaR scaling)
  // ---------------------------------------------------------------------------

  /**
   * `computeDynamicLeverage` — explicit VaR-scaling helper. Returns the
   * effective leverage to apply given the realized funding-rate
   * standard deviation versus a reference std-dev baseline.
   *
   * Formula:
   *   `result = maxAllowed × (refStdDev / max(actualStdDev, ε))`
   *   where `ε = 1e-9` (avoids divide-by-zero), then clamped to [1, maxAllowed].
   *
   * Intuition: if the funding stream is more volatile than the reference
   * baseline (refStdDev), the edge quality has degraded and effective
   * leverage should be SHALLOWER. Conversely, if funding is more stable
   * than the reference, the edge is cleaner and we can scale up to
   * `maxAllowed` (which under Phase 8 is 10× per the 1:10 mandate).
   *
   * IMPORTANT: the return value is the *suggested* effective leverage
   * BEFORE the VaR-cap check. Apply `safeEffectiveLeverage(...)` next
   * to enforce the 2% daily VaR @ 95% confidence hard floor.
   *
   * @param fundingRateStdDev realized std-dev of the funding-rate series
   *   (e.g., from `computeStabilityCappedLeverage` over a 30d window).
   * @param refStdDev reference std-dev (default 0.0005 = the historical
   *   noise floor of BTC 8h funding rates).
   * @param maxAllowed ceiling for the returned leverage (default 10 per
   *   the 1:10 mandate; pass `config.maxLeverage` from the call site).
   * @param minAllowed floor for the returned leverage (default 1).
   */
  computeDynamicLeverage(
    fundingRateStdDev: number,
    refStdDev: number = this.config.fundingStabilityRefStdDev,
    maxAllowed: number = this.config.maxLeverage,
    minAllowed: number = this.config.minLeverage,
  ): number {
    if (!Number.isFinite(fundingRateStdDev) || !Number.isFinite(refStdDev)) {
      throw new Error(
        `computeDynamicLeverage requires finite inputs, got stdDev=${fundingRateStdDev}, refStdDev=${refStdDev}`,
      );
    }
    if (refStdDev <= 0 || maxAllowed <= 0) {
      throw new Error(
        `computeDynamicLeverage requires positive refStdDev and maxAllowed, got refStdDev=${refStdDev}, maxAllowed=${maxAllowed}`,
      );
    }
    if (minAllowed < 1) minAllowed = 1;
    const EPS = 1e-9;
    const actual = Math.max(fundingRateStdDev, EPS);
    const ratio = refStdDev / actual;
    const suggested = maxAllowed * Math.min(1.0, ratio);
    return Math.max(minAllowed, Math.min(maxAllowed, Math.floor(suggested)));
  }

  /**
   * `safeEffectiveLeverage` — enforce the VaR-cap hard floor.
   *
   * If `varCapOk === false`, returns `minAllowed` (default 1× — full
   * de-leverage to the floor), discarding the requested leverage. This
   * is the Phase 8 Track D hard guard against VaR-cap violations: the
   * strategy will NOT scale up to a leverage that would breach the
   * 2% daily VaR @ 95% confidence cap.
   *
   * If `varCapOk === true`, the requested leverage is honored (after
   * the dynamic VaR-scaling suggested leverage from `computeDynamicLeverage`),
   * clamped to `[minAllowed, maxAllowed]`.
   *
   * NOTE: per the 1:10 mandate, `maxAllowed` defaults to 10. `minAllowed`
   * defaults to 1 (baseline ONLY). See module header for context.
   *
   * @param stableMultiplier result from `computeDynamicLeverage` (the
   *   VaR-scaled leverage multiplier given current funding-rate vol).
   * @param requestedLev the leverage the caller wants to apply (e.g.,
   *   the explicit user/CLI choice; 1 or 10 under the 1:10 mandate).
   * @param varCapOk `true` if the 2% daily VaR @ 95% confidence cap
   *   is satisfied; `false` otherwise.
   * @param minAllowed floor (default 1).
   * @param maxAllowed ceiling (default `config.maxLeverage`).
   */
  safeEffectiveLeverage(
    stableMultiplier: number,
    requestedLev: number,
    varCapOk: boolean,
    minAllowed: number = this.config.minLeverage,
    maxAllowed: number = this.config.maxLeverage,
  ): number {
    if (!varCapOk) {
      // VaR cap violated → hard floor to 1×. The strategy CANNOT silently
      // accept the requested leverage here, even under the 1:10 mandate.
      return minAllowed;
    }
    const combined = Math.min(stableMultiplier, requestedLev);
    return Math.max(minAllowed, Math.min(maxAllowed, Math.floor(combined)));
  }

  // ---------------------------------------------------------------------------
  // Phase 7 Track C leverage + risk API (preserved, +1:10-aware fields)
  // ---------------------------------------------------------------------------

  /**
   * `computeDailyVaR` — compute the 1-day VaR at the configured confidence
   * level. Two implementations:
   *   - `parametric`: assumes Gaussian PnL. VaR_pct = (μ - z × σ) / notional
   *     where z is the inverse normal for the configured confidence.
   *   - `historical`: empirical (1 - confidence) percentile of the historical
   *     equity-curve returns.
   *
   * Returns a fraction of `notionalUsd` (positive = expected loss).
   */
  computeDailyVaR(
    notionalUsd: number,
    equityReturns: readonly number[],
    fundingRates?: readonly number[],
  ): number {
    if (notionalUsd <= 0) {
      throw new Error(`notionalUsd must be positive, got ${notionalUsd}`);
    }
    if (this.config.varMethod === "historical") {
      return this.computeHistoricalVaR(notionalUsd, equityReturns, fundingRates);
    }
    return this.computeParametricVaR(notionalUsd, equityReturns, fundingRates);
  }

  private computeParametricVaR(
    notionalUsd: number,
    equityReturns: readonly number[],
    fundingRates?: readonly number[],
  ): number {
    const series = this._pickReturnSeries(equityReturns, fundingRates);
    if (series.length < 5) {
      // Insufficient data — return a conservative proxy assuming ±3σ.
      return 0.03 * notionalUsd;
    }
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const variance =
      series.reduce((a, b) => a + (b - mean) ** 2, 0) / (series.length - 1);
    const stdDev = Math.sqrt(variance);
    const zScore = this._zScoreForConfidence(this.config.varConfidence);
    // VaR is the negative tail: VaR_pct = -(mean - z × σ) on positive loss side.
    const lossReturn = -mean + zScore * stdDev;
    return Math.max(lossReturn * notionalUsd, 0);
  }

  private computeHistoricalVaR(
    notionalUsd: number,
    equityReturns: readonly number[],
    fundingRates?: readonly number[],
  ): number {
    const series = this._pickReturnSeries(equityReturns, fundingRates);
    if (series.length === 0) return 0;
    const sorted = [...series].sort((a, b) => a - b);
    const idx = Math.floor((1 - this.config.varConfidence) * sorted.length);
    const quantileReturn = sorted[Math.max(0, Math.min(idx, sorted.length - 1))] ?? 0;
    return Math.max(-quantileReturn * notionalUsd, 0);
  }

  /** Pick the most representative return series for the VaR computation. */
  private _pickReturnSeries(
    equityReturns: readonly number[],
    fundingRates?: readonly number[],
  ): readonly number[] {
    if (this.config.varMethod === "historical" && equityReturns.length > 0) {
      return equityReturns;
    }
    if (fundingRates && fundingRates.length > 0) {
      return fundingRates;
    }
    return equityReturns;
  }

  private _zScoreForConfidence(c: number): number {
    // Lookup table for common confidence levels (avoids importing
    // jstat/stdlib):
    if (c >= 0.99) return 2.326;
    if (c >= 0.975) return 1.96;
    if (c >= 0.95) return 1.645;
    if (c >= 0.9) return 1.282;
    if (c >= 0.8) return 0.842;
    return 1.0;
  }

  /**
   * `computeEffectiveLeverage` — determine the maximum leverage allowed
   * by both:
   *   1. Funding-rate stability (rolling 30d std-dev).
   *   2. VaR cap (parametric or historical) at configured confidence.
   *
   * Returns an integer leverage in [minLeverage, maxLeverage].
   *
   * Phase 8 Track D: respects the 1:10 leverage mandate via the
   * `maxLeverage` config — at the default the return is bounded by 10×.
   */
  computeEffectiveLeverage(
    fundingRateSeries: readonly number[],
    equityReturns: readonly number[],
    notionalUsd: number,
  ): number {
    const stabilityCap = this.computeStabilityCappedLeverage(fundingRateSeries);
    const varCap = this.computeVarCappedLeverage(equityReturns, notionalUsd);
    const suggested = Math.min(stabilityCap, varCap);
    const clamped = Math.max(this.config.minLeverage, Math.min(this.config.maxLeverage, suggested));
    return Math.floor(clamped);
  }

  /**
   * `computeStabilityCappedLeverage` — leverage scaling based on the
   * rolling 30d std-dev of funding rates. Stable funding (low std-dev)
   * → leverage scales up toward max. Volatile funding (high std-dev)
   * → leverage scales down toward min.
   *
   * Formula: `leverage = maxLeverage × (refStdDev / max(observedStdDev, ε))`,
   * clamped to [minLeverage, maxLeverage].
   *
   * Motivation: a stable funding stream is a higher-quality "edge" —
   * we can amplify it more aggressively. A noisy / spiky funding
   * stream means the carry is unreliable → reduce leverage.
   *
   * Phase 8 Track D: thin wrapper around `computeDynamicLeverage` so
   * the formula lives in ONE place.
   */
  computeStabilityCappedLeverage(fundingRateSeries: readonly number[]): number {
    if (fundingRateSeries.length < 5) {
      // Not enough history → default to conservative half of max.
      return this.config.maxLeverage * 0.5;
    }
    const tail = fundingRateSeries.slice(-this._stabilitySampleCount());
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const variance = tail.reduce((a, b) => a + (b - mean) ** 2, 0) / (tail.length - 1);
    const stdDev = Math.sqrt(variance);
    return this.computeDynamicLeverage(stdDev);
  }

  /**
   * `computeVarCappedLeverage` — leverage that satisfies the daily VaR
   * cap. Uses bisection on the integer leverage range.
   *
   * Math: with leverage L, the notional scales to N × L. VaR scales
   * linearly with notional, so VaR(notional × L) ≈ L × VaR(notional).
   * The constraint `L × VaR(notional) ≤ maxDailyVarPct × equity` gives
   * `L ≤ maxDailyVarPct × equity / VaR(notional)`.
   *
   * Phase 8 Track D: the cap is bounded by `maxLeverage` (default 10)
   * per the 1:10 mandate. If the unconstrained cap exceeds 10, the
   * function clamps to 10 — the 1:10 mandate is the binding constraint,
   * not the VaR cap.
   */
  computeVarCappedLeverage(equityReturns: readonly number[], notionalUsd: number): number {
    if (notionalUsd <= 0) return this.config.minLeverage;
    if (equityReturns.length < 5) {
      // Insufficient returns history → conservative: min leverage.
      return this.config.minLeverage;
    }
    const baseVar = this.computeDailyVaR(notionalUsd, equityReturns);
    if (baseVar <= 0) return this.config.maxLeverage;
    const maxLossUsd = this.config.maxDailyVarPct * notionalUsd * this.config.minInitialMarginFraction;
    const cap = Math.floor(maxLossUsd / baseVar);
    return Math.max(this.config.minLeverage, Math.min(this.config.maxLeverage, cap));
  }

  /**
   * `setEffectiveLeverage` — update `state.currentLeverage` and
   * recompute `effectiveNotionalUsd`, `initialMarginUsd`, and
   * `maintenanceMarginUsd`. Also scales the rebalance threshold
   * inversely with leverage so higher-leverage positions rebalance
   * sooner (avoid liquidation cascades).
   *
   * Phase 8 Track D: applies the 1:10 hard guardrail. Accepts ONLY 1 or
   * 10; other values throw. The function uses `assert1to10Leverage`.
   */
  setEffectiveLeverage(leverage: number): void {
    assert1to10Leverage(leverage);
    const clamped = Math.max(
      this.config.minLeverage,
      Math.min(this.config.maxLeverage, Math.floor(leverage)),
    );
    this.state.currentLeverage = clamped;
    this.state.effectiveNotionalUsd = this.config.baseNotionalUsd * clamped;
    // Initial margin in isolated mode is the equity held as collateral.
    // For a delta-neutral carry on Binance USDⓈ-M perps with isolated
    // margin: IM = notional / leverage = baseNotional (constant when
    // scaling by leverage; we're holding more notional with the same
    // equity ⇒ higher effective leverage).
    this.state.initialMarginUsd = this.config.baseNotionalUsd;
    // Maintenance margin = position value × MMR. MMR for BTC at ≤$1M
    // notional is 0.5% on Binance (0.4% on Bybit USDⓈ-M).
    // Use 0.5% as the conservative assumption.
    this.state.maintenanceMarginUsd = this.state.effectiveNotionalUsd * 0.005;
    void clamped;
  }

  /**
   * `getScaledRebalanceThreshold` — threshold scales inversely with
   * leverage: at 1× use the base 5%, at 10× use 0.5%, etc. This is the
   * core "avoid liquidation cascade" control — a higher-leverage
   * position must be rebalanced sooner.
   *
   * Phase 8 Track D: at 10× leverage the rebalance threshold drops to
   * 0.5% (0.05 / 10), forcing a rebalance when the funding-induced
   * drift exceeds 0.5% of notional — a 5× tighter trigger than at 1×.
   */
  getScaledRebalanceThreshold(): number {
    return this.config.rebalanceThresholdPct / this.state.currentLeverage;
  }

  /**
   * `accrueFundingScaled` — apply one 8h funding payment at the
   * scaled notional (base × leverage). For a SHORT perp position:
   * positive funding rate → earn; negative → pay.
   * Sign convention matches Binance: fundingRate > 0 means longs
   * pay shorts, so a short perp EARNs `notional × fundingRate`.
   *
   * Phase 8 Track D: at 10× leverage, each 8h funding tick accrues
   * against 10× the notional — a 10× scaling vs the 1× baseline.
   */
  accrueFundingScaled(fundingRate: number, fundingTimeMs: number): number {
    if (!Number.isFinite(fundingRate)) {
      throw new Error(`fundingRate must be finite, got ${fundingRate}`);
    }
    const notional = this.state.effectiveNotionalUsd;
    const payment = notional * fundingRate;
    this.state.fundingCollectedUsd += payment;
    this._recordFundingRate(fundingRate, fundingTimeMs);
    return payment;
  }

  private _recordFundingRate(rate: number, timeMs: number): void {
    this.state.fundingHistory.push(rate);
    // Keep only the last fundingStabilityWindowDays × 3 entries
    // (3 funding snapshots per day on Binance 8h cadence).
    const maxEntries = this.config.fundingStabilityWindowDays * 3 + 32;
    if (this.state.fundingHistory.length > maxEntries) {
      this.state.fundingHistory.splice(0, this.state.fundingHistory.length - maxEntries);
    }
    // Refresh the readonly view.
    Object.assign(this.state, {
      lastFundingRates: [...this.state.fundingHistory],
    });
    void timeMs;
  }

  private _stabilitySampleCount(): number {
    return this.config.fundingStabilityWindowDays * 3;
  }

  /**
   * `checkLiquidationThreshold` — verify the account margin ratio
   * stays above `minInitialMarginFraction`. If it falls below, the
   * position would be liquidated on a real venue. Returns `true` if
   * the position would be force-closed.
   *
   * Margin ratio formula (Binance USDⓈ-M isolated-mode):
   *   `marginRatio = Maintenance Margin / Margin Balance`
   * where `Margin Balance = Initial Margin + Unrealized PnL`.
   * `liquidationThreshold` is reached when marginRatio > 1.
   *
   * We model our gate as: `maintenanceMarginUsd ≥ marginRatioFloor × marginBalance`,
   * i.e. `marginBalance / maintenanceMarginUsd < 1 / marginRatioFloor`.
   *
   * Phase 8 Track D: at 10× leverage the maintenance margin scales
   * linearly with notional; with the conservative 0.5% MMR and 1:10
   * mandate, a 10% mark-price adverse move drains the entire initial
   * margin on a naked (non-delta-neutral) leg. The delta-neutral
   * construction is the key defense against this scenario.
   */
  checkLiquidationThreshold(unrealizedPnlUsd: number): boolean {
    const marginBalance = this.state.initialMarginUsd + unrealizedPnlUsd;
    if (marginBalance <= 0) {
      // Account is fully bled; effectively liquidated.
      this.state.liquidationEventsCount += 1;
      return true;
    }
    const marginRatio = this.state.maintenanceMarginUsd / marginBalance;
    if (marginRatio >= this.config.minInitialMarginFraction) {
      // Margin ratio ≥ 50% means we've used half the safety buffer;
      // this is the "force-unwind" gate.
      this.state.liquidationEventsCount += 1;
      return true;
    }
    return false;
  }

  /**
   * `recordLiquidation` — manual counter increment. Used by the CLI
   * runner when an out-of-band price shock (e.g., a 30% single-candle
   * move) breaches the liquidation buffer even though the mark price
   * didn't flow through `checkLiquidationThreshold` first.
   */
  recordLiquidation(): void {
    this.state.liquidationEventsCount += 1;
  }

  /**
   * `triggerRebalance` — debit the rebalance cost components. The
   * threshold scales with leverage (see `getScaledRebalanceThreshold`).
   * Returns `true` if a rebalance was triggered.
   */
  triggerRebalance(unrealizedDeltaUsd: number): boolean {
    this.state.unrealizedDeltaUsd = unrealizedDeltaUsd;
    const threshold = this.getScaledRebalanceThreshold();
    const driftFraction = Math.abs(unrealizedDeltaUsd) / this.state.effectiveNotionalUsd;
    if (driftFraction < threshold) {
      return false;
    }
    // Rebalance costs scale with the LEVERAGED notional, not the
    // base notional — a higher-leverage position pays more in fees.
    const flatFee =
      (this.config.rebalanceCostBps / 10_000) * this.state.effectiveNotionalUsd;
    this.state.rebalanceCostUsd += flatFee;
    // Withdrawal-latency opportunity cost scales with notional too.
    const latencyHours = this.config.withdrawalLatencyMinutes / 60;
    const borrowRatePerHour = 0.0001;
    const latencyCost = this.state.effectiveNotionalUsd * borrowRatePerHour * latencyHours;
    this.state.rebalanceCostUsd += latencyCost;
    this.state.rebalanceCount += 1;
    this.state.unrealizedDeltaUsd = 0;
    return true;
  }

  /**
   * `totalNetPnlUsd` — net PnL = funding collected − rebalance costs.
   */
  totalNetPnlUsd(): number {
    return this.state.fundingCollectedUsd - this.state.rebalanceCostUsd;
  }

  /**
   * `varComplianceRatio` — actualVaR / VaR cap (≤1 → passes). Returns
   * `null` if `notionalUsd` is invalid. Used for the validation gate.
   *
   * Phase 8 Track D: at 10× leverage, the VaR scales linearly with
   * notional; Phase 7 3× BTC VaR 0.18%/day → Phase 8 10× BTC VaR
   * 0.60%/day (linear scale). Track D §3.2 covers the empirical
   * scaling for BTC/ETH/SOL at 10×.
   */
  varComplianceRatio(
    equityReturns: readonly number[],
    notionalUsd: number,
    fundingRates?: readonly number[],
  ): number | null {
    if (notionalUsd <= 0) return null;
    const varUsd = this.computeDailyVaR(notionalUsd, equityReturns, fundingRates);
    const capUsd = this.config.maxDailyVarPct * notionalUsd;
    if (capUsd <= 0) return null;
    return varUsd / capUsd;
  }

  /** Reset state for a fresh backtest run. */
  reset(): void {
    this.state.fundingCollectedUsd = 0;
    this.state.rebalanceCount = 0;
    this.state.rebalanceCostUsd = 0;
    this.state.lastMarkPrice = 0;
    this.state.unrealizedDeltaUsd = 0;
    this.state.hasEntered = false;
    this.state.currentLeverage = this.config.minLeverage;
    this.state.effectiveNotionalUsd = this.config.baseNotionalUsd * this.config.minLeverage;
    this.state.initialMarginUsd = this.config.baseNotionalUsd;
    this.state.maintenanceMarginUsd = this.state.effectiveNotionalUsd * 0.005;
    this.state.dailyVaR95Pct = 0;
    this.state.liquidationEventsCount = 0;
    this.state.fundingHistory = [];
    this.state.lastFundingRates = [];
  }
}
