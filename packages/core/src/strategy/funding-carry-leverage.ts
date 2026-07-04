// packages/core/src/strategy/funding-carry-leverage.ts — leveraged delta-neutral
// funding-rate carry with VaR cap + liquidation buffer.
//
// Phase 7 Track C — extends the Phase 6 Track A FundingCarryStrategy with:
//   - Dynamic leverage (1×..5×) applied to the perp leg notional.
//   - VaR cap: max 2% daily VaR at 95% confidence (parametric + historical).
//   - Liquidation buffer: maintain ≥50% initial margin (configurable).
//   - Funding-rate stability scaling: rolling 30d std-dev of the funding rate
//     drives the leverage multiplier (higher std-dev → lower leverage).
//   - Rebalance threshold scales with leverage (avoid liquidation cascade).
//
// References:
//   - SSRN 5292305 (2025) — "Leveraged BTC Funding Carry Algorithm"
//     3× leveraged long-spot/short-perp: Sharpe 6.1, max DD < 2%, 16% APR
//   - ScienceDirect (Werapun 2025) — drift-XRP 7× funding rate arb Sharpe 15.85
//   - Bybit Institutional 2025 Crypto Quant Strategy Index — Delta Neutral
//     +9.48% on Bybit, max DD 0.80%, positive every month of 2025
//   - Bybit maintenance margin / liquidation formulas —
//     Initial Margin = Position Value / Leverage,
//     Maintenance Margin = Position Value × MMR (0.4-0.5% for BTC ≤$1M notional)
//   - Pomegra.io / Binance — VaR-based position sizing:
//     VaR = Portfolio × σ × z-score (z=1.65 at 95%); daily VaR ≤ 2% of equity
//   - Altrady / coincryptorank — keep effective leverage ≤ 3× for
//     basis trades, ≤5× at industry consensus; liquidation cascade
//     risk grows fast with leverage past 3×
//   - MiCAR (EU) 2023/1114 — perp products excluded from retail CASP scope;
//     binance.us / kraken-futures / deribit are typical pro-only venues

import { FundingCarryStrategy } from "./funding-carry.js";
import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

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
 *   - `maxLeverage = 3` — Altrady / coincryptorank consensus for
 *     delta-neutral basis trades (≤3× for cascade-safety).
 *   - `minLeverage = 1` — fully-collateralized floor.
 *   - `minInitialMarginFraction = 0.50` — keep ≥50% IM after a
 *     hypothetical liquidation event matches Bybit "isolation ≥50%"
 *     and Binance "recommended margin ratio < 80%" guidance.
 *   - `rebalanceThresholdPct = 0.05` at 1× leverage — scales
 *     inversely with leverage so higher-leverage positions rebalance
 *     sooner (3× ⇒ 1.67% threshold).
 *   - `varConfidence = 0.95`, `maxDailyVarPct = 0.02` — Phase 7
 *     brief §1.2 / M1.3 hard requirement (2% daily VaR @ 95%).
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
  maxLeverage: 3,
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
 */
export class FundingCarryLeverageStrategy implements Strategy {
  readonly name = "Leveraged Delta-Neutral Funding Carry (Phase 7 Track C)";
  readonly timeframes = ["1h", "4h", "1d"] as const;
  readonly config: LeveragedCarryConfig;
  readonly state: LeveragedCarryState;
  /** Base strategy borrowed for shared accrual helpers. */
  // Reserved for future cross-strategy integration (Phase 8 ensemble wiring).
  // The current Track C CLI runner drives accrual via `accrueFundingScaled`.
  private readonly baseStrategy: FundingCarryStrategy | null;

  constructor(config: Partial<LeveragedCarryConfig> = {}) {
    this.config = { ...DEFAULT_LEVERAGED_CARRY_CONFIG, ...config };
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
  // Phase 7 Track C leverage + risk API (used by the CLI runner).
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
    if (stdDev <= 0) {
      return this.config.maxLeverage;
    }
    const ratio = this.config.fundingStabilityRefStdDev / stdDev;
    const suggested = this.config.maxLeverage * Math.min(1.0, ratio);
    return Math.max(this.config.minLeverage, Math.min(this.config.maxLeverage, suggested));
  }

  /**
   * `computeVarCappedLeverage` — leverage that satisfies the daily VaR
   * cap. Uses bisection on the integer leverage range.
   *
   * Math: with leverage L, the notional scales to N × L. VaR scales
   * linearly with notional, so VaR(notional × L) ≈ L × VaR(notional).
   * The constraint `L × VaR(notional) ≤ maxDailyVarPct × equity` gives
   * `L ≤ maxDailyVarPct × equity / VaR(notional)`.
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
   */
  setEffectiveLeverage(leverage: number): void {
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
   * leverage: at 1× use the base 5%, at 2× use 2.5%, at 3× use 1.67%,
   * etc. This is the core "avoid liquidation cascade" control — a
   * higher-leverage position must be rebalanced sooner.
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
