// packages/core/src/strategy/multi-class-ensemble-v3.ts — Phase 8 multi-class ensemble V3
//
// Phase 8 M2 — a Phase 7 V2 multi-class ensemble V3, ami a Phase 8 négy
// alpha track-jét integrálja egyetlen kompozit stratágiába:
//
//   1. DonchianMtfStrategy (Phase 8 Track F) — a PRIMARY directional
//      signal. 1h entry trigger, 4h trend filter, 1d supertrend megerősítés,
//      long-only, ATR-alapú SL/TP, 168h max-hold (onOpenPositionUpdate).
//
//   2. FundingCarryTimingStrategy (Phase 8 Track E) — a DELTA-NEUTRAL
//      carry timing gate. Rolling 30d statisztikák a funding rate-en,
//      belépés ha rate > p75, kilépés ha rate < median. 72h cooldown.
//      Replaces Phase 7 V2 always-on carry (Track C).
//
//   3. FundingCarryLeverageStrategy (Phase 8 Track D) — a CARRY MECHANICS
//      layer. computeDynamicLeverage() VaR-scaling, max 10× (1:10 mandate).
//      A carry oldali effective leverage-ot szolgáltatja a VolTargetedSizer
//      által skálázott multiplierrel kombinálva.
//
//   4. VolTargetedSizer (Phase 8 Track G) — a POSITION-SIZING layer.
//      Moreira-Muir inverse-vol szabály: position size scales inversely
//      with lagged realized volatility. A 1:10 base leverage-et a
//      volMultiplier-en keresztül skálázza 2.5×..10× közé.
//
// Signal-aggregáció (kritikus — no double-counting):
//
//   - PRIMARY directional signal: DonchianMtfStrategy.onCandle() — ez
//     megy vissza az engine-nek StrategySignal-ként.
//   - CARRY signal: FundingCarryTimingStrategy.onCandle() — ez CSAK az
//     állapotot frissíti (in/out carry); a carry PnL a FundingCarryStrategy
//     state-jében accumulálódik, NEM a directional engine trade-listában.
//   - LEVERAGE multiplier: a VolTargetedSizer naponta számítja a
//     clampedVolMultiplier-t (avgVolMultiplier a teljes window-ra). Ez
//     szorozza a carry base notional-ját (carry oldalon) ÉS hatással van
//     a BacktestOptions.positionSize.maxPositionPctEquity-re (directional
//     oldalon, a CLI runner állítja be a backtest előtt).
//   - POSITION SIZE: VolTargetedSizer által ajánlott riskPerTrade × Kelly
//     base (CLI runner küldi a BacktestOptions.positionSize-be).
//
// A pozíció-menedzsment hook-ok (onOpenPositionUpdate / onPositionOpened /
// onPositionClosed) DELEGÁLVA a DonchianMtfStrategy-hoz, mert az
// implementálja a 168h max-hold enforcement-et (ami felülírja az engine
// 72h profit-only time_exit-jét).
//
// Carry oldali pozíció-menedzsment: a FundingCarryTimingStrategy saját
// state-jében kezeli a belépés/kilépés/küszöb állapotokat (onCandle-en
// keresztül), nem a Strategy hook-okon keresztül.
//
// References (≥2 independent source / empirical claim):
//   - Phase 7 V2 ensemble pattern: docs/research/REPORT-phase7.md §3-5
//   - Phase 6 M2 multi-class ensemble pattern: docs/research/REPORT-phase6.md
//   - Phase 8 Track D carry leverage: docs/research/phase8-carry-leverage-1-10.md
//   - Phase 8 Track E funding timing: docs/research/phase8-funding-timing.md
//   - Phase 8 Track F MTF Donchian: docs/research/phase8-1h-mtf-donchian.md
//   - Phase 8 Track G vol-targeted sizing: docs/research/phase8-vol-targeted-sizing.md
//   - Moreira & Muir (2017) "Volatility-Managed Portfolios" — inverse-vol
//     sizing: https://law.yale.edu/sites/default/files/area/workshop/leo/leo17_moreira.pdf
//   - Harvey et al. (2018) "The Impact of Volatility Targeting" — Man Group
//     institutional 60+ asset study: https://www.man.com/the-impact-of-volatility-targeting-outstanding-article
//   - bybit.eu SPOT margin 1:10 leverage: https://www.bybit.eu/en/help-center/sptMargin
//
// Specifikáció: docs/research/phase8-strategy-brief.md §1.3 M2.

import type { Timeframe } from "@mm-crypto-bot/shared/types";

import type {
  OpenPositionSnapshot,
  PositionManagementContext,
  PositionUpdate,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "../types.js";
import {
  DEFAULT_VOL_TARGET_CONFIG,
  ONE_TO_TEN_BASE_LEVERAGE,
  type VolTargetConfig,
  type VolTargetedSizerResult,
} from "../risk/vol-targeted-sizer.js";
import {
  DEFAULT_DONCHIAN_MTF_CONFIG,
  DonchianMtfStrategy,
  type DonchianMtfConfig,
} from "./donchian-mtf.js";
import {
  DEFAULT_FUNDING_CARRY_TIMING_CONFIG,
  FundingCarryTimingStrategy,
  type FundingCarryTimingConfig,
  type FundingCarryTimingState,
} from "./funding-carry-timing.js";
import {
  DEFAULT_LEVERAGED_CARRY_CONFIG,
  FundingCarryLeverageStrategy,
  type LeveragedCarryConfig,
  type LeveragedCarryState,
} from "./funding-carry-leverage.js";

// ---------------------------------------------------------------------------
// Re-exports — V2 helpers (kept for backward compat / drop-in usage)
// ---------------------------------------------------------------------------

export { DEFAULT_LATENCY_GATE_DISABLED, createLatencyGate } from "./multi-class-ensemble.js";

export type { LatencyGate, LatencySnapshot } from "./multi-class-ensemble.js";

// ---------------------------------------------------------------------------
// V3 Ensemble configuration
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleV3Config` — the full configuration of the V3 ensemble.
 * Each Phase 8 component is independently configurable; the defaults match
 * the empirical results of Tracks D/E/F/G.
 *
 * The volTargetedSizer config drives BOTH the carry-side leverage scaling
 * AND the directional-side risk-per-trade (via the CLI runner's pre-backtest
 * config wiring).
 */
export interface MultiClassEnsembleV3Config {
  /** Donchian MTF (Track F) — PRIMARY directional signal. */
  readonly donchianMtf: Partial<DonchianMtfConfig>;
  /** Funding-carry timing (Track E) — REGIME TIMING gate for the carry. */
  readonly fundingCarryTiming: Partial<FundingCarryTimingConfig>;
  /** Funding-carry leverage (Track D) — CARRY MECHANICS layer. */
  readonly fundingCarryLeverage: Partial<LeveragedCarryConfig>;
  /** Vol-targeted sizer (Track G) — INVERSE-VOL POSITION SIZING. */
  readonly volTargetedSizer: VolTargetConfig;
}

// ---------------------------------------------------------------------------
// Default config partial
// ---------------------------------------------------------------------------

/**
 * `DEFAULT_MULTI_CLASS_ENSEMBLE_V3_CONFIG_PARTIAL` — partial defaults.
 * The caller must supply the `volTargetedSizer` config (it's a runtime
 * input, not a strategy default).
 *
 * All sub-strategy defaults match the empirical best from their respective
 * tracks:
 *   - Donchian MTF: DEFAULT_DONCHIAN_MTF_CONFIG (20-period Donchian,
 *     1.5× ATR SL, 3.0× ATR TP, 168h max-hold, leverage 10).
 *   - Funding carry timing: DEFAULT_FUNDING_CARRY_TIMING_CONFIG (30d
 *     window, 0.75 entry / 0.5 exit, 72h cooldown, leverage 10).
 *   - Funding carry leverage: DEFAULT_LEVERAGED_CARRY_CONFIG (maxLeverage
 *     10, baseNotionalUsd 10000, 50% IM, 5% rebalance, 0.02 VaR cap).
 */
export const DEFAULT_MULTI_CLASS_ENSEMBLE_V3_CONFIG_PARTIAL: Omit<
  MultiClassEnsembleV3Config,
  "volTargetedSizer"
> = {
  donchianMtf: DEFAULT_DONCHIAN_MTF_CONFIG,
  fundingCarryTiming: DEFAULT_FUNDING_CARRY_TIMING_CONFIG,
  fundingCarryLeverage: DEFAULT_LEVERAGED_CARRY_CONFIG,
};

// ---------------------------------------------------------------------------
// V3 Ensemble state
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleV3State` — read-only view of the V3 ensemble's
 * runtime state after a backtest. The CLI runner reads this for the
 * empirical report and the combined-edge computation.
 *
 * Field semantics:
 *   - `donchianSignalsEmitted` — number of MTF Donchian signals produced.
 *   - `donchianTimeExitCloses` — number of closes triggered by the 168h
 *     max-hold (vs. the engine's default 72h profit-only time_exit).
 *   - `fundingCarryUsd` — total funding collected by the carry component
 *     while in carry (post-regime timing, post-leverage scaling).
 *   - `fundingCarryTimeInCarryFraction` — fraction of candles where the
 *     carry was ACTIVE (between entry and exit). Track E regime filter
 *     reduces this from the always-on 100% to ~26%.
 *   - `fundingCarryEntries` — count of carry entries (regime-filtered).
 *   - `effectiveCarryLeverage` — FINAL effective carry leverage after
 *     dynamic VaR-scaling (Track D) and vol-targeting (Track G) are
 *     combined. Must be in [1, 10] (1:10 mandate).
 *   - `volTargetedAvgMultiplier` — Track G avg clamped vol multiplier
 *     across the backtest window. 1.0 = always at ceiling (1:10 max),
 *     <1.0 = avg scale-down via vol-targeting.
 *   - `dailyVaR95Pct` — FINAL daily VaR (95% confidence) as a fraction
 *     of equity. Must stay ≤ 2% per Phase 7/8 hard requirement.
 *   - `liquidationEvents` — count of hypothetical liquidation events.
 *     Must stay 0 per the brief.
 *   - `combinedEdgePct` — the COMBINED edge (Donchian trade PnL +
 *     fundingCarryUsd) as a percentage of initial equity. Computed by
 *     the CLI runner after the backtest.
 *   - `carrySide` — direct reference to the Track D leveraged carry state.
 *   - `timingSide` — direct reference to the Track E timing state.
 */
export interface MultiClassEnsembleV3State {
  readonly donchianSignalsEmitted: number;
  readonly donchianTimeExitCloses: number;
  readonly fundingCarryUsd: number;
  readonly fundingCarryTimeInCarryFraction: number;
  readonly fundingCarryEntries: number;
  readonly effectiveCarryLeverage: number;
  readonly volTargetedAvgMultiplier: number;
  readonly dailyVaR95Pct: number;
  readonly liquidationEvents: number;
  readonly combinedEdgePct: number;
  /** Direct reference to the Track D leveraged carry state. */
  readonly carrySide: LeveragedCarryState;
  /** Direct reference to the Track E timing state. */
  readonly timingSide: FundingCarryTimingState;
  /** Recommended position cap as fraction of equity (Track G × baseKelly). */
  readonly recommendedMaxPositionPctEquity: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `combineVolAndCarryLeverage` — combines the Track G vol-targeting
 * multiplier with the Track D carry-side max leverage (10×). The
 * effective carry leverage at any candle is:
 *
 *   `effectiveCarryLev = carryMaxLev × clampedVolMultiplier`
 *
 * where `clampedVolMultiplier` is in [0.25, 1.0] (Track G clamp, 1:10
 * mandate ceiling at 1.0). The result is then clamped to `[1, 10]`.
 *
 * Intuition: Track G scales the SIZE of the 1:10 base position; Track D's
 * VaR-based scaling adds further leverage reduction when funding-rate
 * vol is high. The MIN of the two is applied — defensive layering.
 *
 * Pure function for testability.
 */
export function combineVolAndCarryLeverage(
  carryMaxLeverage: number,
  clampedVolMultiplier: number,
): number {
  if (!Number.isFinite(carryMaxLeverage) || carryMaxLeverage <= 0) {
    throw new Error(`carryMaxLeverage must be positive finite: ${String(carryMaxLeverage)}`);
  }
  if (!Number.isFinite(clampedVolMultiplier) || clampedVolMultiplier <= 0) {
    throw new Error(`clampedVolMultiplier must be positive finite: ${String(clampedVolMultiplier)}`);
  }
  const combined = carryMaxLeverage * clampedVolMultiplier;
  // Clamp to [1, 10] — the 1:10 mandate ceiling.
  const minLev = 1;
  const maxLev = ONE_TO_TEN_BASE_LEVERAGE;
  return Math.max(minLev, Math.min(maxLev, Math.floor(combined)));
}

/**
 * `computeV3CarryFractionFromTimingState` — pure-functional helper that
 * computes the time-in-carry fraction from a timing state (the carry
 * periods / total periods). The Track E strategy tracks both
 * `inCarryFundingPeriods` and `outOfCarryFundingPeriods`, so the fraction
 * is the ratio of in-carry periods to the sum.
 *
 * Used by the CLI runner to populate
 * `state.fundingCarryTimeInCarryFraction`.
 */
export function computeV3CarryFractionFromTimingState(
  state: FundingCarryTimingState,
): number {
  const total = state.inCarryFundingPeriods + state.outOfCarryFundingPeriods;
  return total === 0 ? 0 : state.inCarryFundingPeriods / total;
}

// ---------------------------------------------------------------------------
// V3 Ensemble implementation
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleV3` — composite Strategy that integrates:
 *
 *   1. DonchianMtfStrategy (Phase 8 Track F) — PRIMARY directional signal.
 *      Long-only, 1h/4h/1d MTF, ATR SL/TP, 168h max-hold.
 *
 *   2. FundingCarryTimingStrategy (Phase 8 Track E) — REGIME TIMING gate
 *      for the carry. Tracks funding rate percentiles; emits entry/exit
 *      signals that are state-tracked but do NOT generate engine signals.
 *
 *   3. FundingCarryLeverageStrategy (Phase 8 Track D) — CARRY MECHANICS.
 *      VaR-capped dynamic leverage (1×..10×).
 *
 *   4. VolTargetedSizer (Phase 8 Track G) — INVERSE-VOL POSITION-SIZING
 *      layer. Scales the carry-side effective leverage inversely with
 *      lagged realized volatility. Also informs the CLI runner for the
 *      directional-side `maxPositionPctEquity`.
 *
 * The Strategy interface returns the DonchianMTF signal as-is (no double-
 * counting with the carry). The position-management hooks are DELEGATED to
 * the DonchianMtfStrategy (the 168h max-hold owner). The carry component
 * runs in PARALLEL via state tracking; the CLI runner computes the
 * combined edge after the backtest.
 */
export class MultiClassEnsembleV3 implements Strategy {
  readonly name =
    "Phase 8 Multi-Class Ensemble V3 (Donchian-MTF + Funding-Carry-Timing + Carry-Leverage-10x + VolTargeted)";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: MultiClassEnsembleV3Config;
  readonly donchianMtf: DonchianMtfStrategy;
  readonly fundingCarryTiming: FundingCarryTimingStrategy;
  readonly fundingCarryLeverage: FundingCarryLeverageStrategy;
  readonly volTargetedSizerConfig: VolTargetConfig;

  // Latest vol-target multiplier (updated externally by the CLI runner
  // via `setVolTargetMultiplier` before each candle, or defaults to 1.0).
  private currentVolMultiplier = 1.0;

  // Per-candle counters.
  private donchianSignalsEmitted = 0;
  private donchianTimeExitCloses = 0;
  private fundingCarryEntriesSeen = 0;
  private fundingCarryExitsSeen = 0;
  private fundingCarryInCarryCandles = 0;
  private fundingCarryOutOfCarryCandles = 0;

  // Aggregated vol-target diagnostics (the CLI runner computes these
  // after the backtest from the full OHLCV; here we just track the
  // scalar `recommendedMaxPositionPctEquity` that flows to the engine).
  private lastRecommendedMaxPositionPctEquity = 0;

  constructor(config: MultiClassEnsembleV3Config) {
    this.config = config;
    this.donchianMtf = new DonchianMtfStrategy(config.donchianMtf);
    this.fundingCarryTiming = new FundingCarryTimingStrategy(config.fundingCarryTiming);
    this.fundingCarryLeverage = new FundingCarryLeverageStrategy(config.fundingCarryLeverage);
    this.volTargetedSizerConfig = config.volTargetedSizer;
  }

  warmup(): number {
    // All four components have their own warmup:
    //   - Donchian MTF: 30 candles (HTF Supertrend + MTF Donchian + LTF ATR)
    //   - Funding carry timing: 30 * 24 = 720 candles (30d window @ 1h)
    //   - Funding carry leverage: 30 candles (same as Track C)
    //   - VolTargetedSizer: 30d window (CLI runner computes; not blocking)
    //
    // The funding carry timing dominates (720 = 30d), matching the Phase 7
    // V2's pattern.
    return Math.max(
      this.donchianMtf.warmup(),
      this.fundingCarryTiming.warmup(),
      this.fundingCarryLeverage.warmup(),
    );
  }

  /**
   * `setVolTargetMultiplier` — the CLI runner calls this BEFORE each
   * candle to inject the Track G vol-target multiplier for that candle.
   * The default 1.0 (no scaling) is used when the runner does not wire
   * this up.
   *
   * The multiplier is consumed by the leverage combination logic in
   * `getState()` (effective carry leverage = 10 × multiplier).
   */
  setVolTargetMultiplier(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`volTargetMultiplier must be positive finite, got ${String(multiplier)}`);
    }
    this.currentVolMultiplier = Math.max(
      this.volTargetedSizerConfig.minVolMultiplier,
      Math.min(this.volTargetedSizerConfig.maxVolMultiplier, multiplier),
    );
  }

  /**
   * `setRecommendedMaxPositionPctEquity` — the CLI runner pushes the
   * Track G recommended position cap (avgMultiplier × baseKelly × equity)
   * into the ensemble after running `computeVolTargetedSizer`. This is
   * informational (the engine reads positionSize.maxPositionPctEquity
   * from BacktestOptions, NOT from the strategy), but we store it on the
   * state for the empirical report.
   */
  setRecommendedMaxPositionPctEquity(pctEquity: number): void {
    if (!Number.isFinite(pctEquity) || pctEquity < 0) {
      throw new Error(`pctEquity must be non-negative finite, got ${String(pctEquity)}`);
    }
    this.lastRecommendedMaxPositionPctEquity = pctEquity;
  }

  /**
   * `onCandle` — runs every LTF candle when NO position is open.
   *
   * Step 1: Donchian MTF signal → this is the PRIMARY output (the carry
   *         contributes via state, not signals).
   * Step 2: FundingCarryTiming.onCandle → updates the in/out carry state
   *         via the regime-filter timing. Signal is discarded (the carry
   *         PnL accrues externally).
   * Step 3: FundingCarryLeverage.onCandle → updates carry bookkeeping
   *         (effective leverage, VaR, liquidation buffer). Signal
   *         discarded.
   * Step 4: Return the DonchianMTF signal (with ensemble reason tag).
   *
   * No double-counting: only ONE engine signal per candle (from the
   * Donchian MTF). The carry components run in parallel via state.
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    // Step 1 — Donchian MTF signal (the PRIMARY directional output).
    const donchianSignal = this.donchianMtf.onCandle(ctx);
    if (donchianSignal !== null) {
      this.donchianSignalsEmitted += 1;
    }

    // Step 2 — Funding carry timing state machine (regime-filter gate).
    // The signal is discarded; we only track the state transitions.
    const timingSignal = this.fundingCarryTiming.onCandle(ctx);
    void timingSignal;
    const timingState = this.fundingCarryTiming.state;
    if (timingState.isInCarry) {
      this.fundingCarryInCarryCandles += 1;
      // Track entry count (state.entryCount is monotonic — diff against last seen).
      const newEntries = timingState.entryCount - this.fundingCarryEntriesSeen;
      if (newEntries > 0) {
        this.fundingCarryEntriesSeen = timingState.entryCount;
      }
    } else {
      this.fundingCarryOutOfCarryCandles += 1;
      const newExits = timingState.exitCount - this.fundingCarryExitsSeen;
      if (newExits > 0) {
        this.fundingCarryExitsSeen = timingState.exitCount;
      }
    }

    // Step 3 — Funding carry leverage (carry-side bookkeeping).
    // The Track D strategy emits a one-shot "buy" signal on the first
    // valid candle for the engine; we discard it (the engine is already
    // running the directional backtest via the Donchian MTF signal).
    const carrySignal = this.fundingCarryLeverage.onCandle(ctx);
    void carrySignal;

    // Step 4 — Return the Donchian MTF signal (with ensemble reason tag).
    if (donchianSignal === null) {
      return null;
    }
    const carryStatus = timingState.isInCarry ? "carry=active" : "carry=paused";
    const volStatus = `vol=${this.currentVolMultiplier.toFixed(3)}`;
    const reason = `[MultiClassEnsembleV3] ${carryStatus} | ${volStatus} | ${donchianSignal.reason}`;
    return {
      ...donchianSignal,
      reason,
    };
  }

  /**
   * `onOpenPositionUpdate` — DELEGATES to the DonchianMtfStrategy. The
   * Track F strategy owns the 168h max-hold enforcement (via `forceExit`
   * + `reason: "time_exit"`). Track D and Track E do not emit position
   * updates (they manage state internally); the carry-side VaR/liquidation
   * bookkeeping is updated by `applyCarrySnapshot()` below.
   *
   * If the engine returns a `forceExit: true` with `reason: "time_exit"`,
   * we increment the `donchianTimeExitCloses` counter for the empirical
   * report.
   */
  onOpenPositionUpdate(ctx: PositionManagementContext): PositionUpdate | null {
    const update = this.donchianMtf.onOpenPositionUpdate(ctx);
    if (update !== null && update.forceExit === true && update.reason === "time_exit") {
      this.donchianTimeExitCloses += 1;
    }
    return update;
  }

  /**
   * `onPositionOpened` — DELEGATES to the DonchianMtfStrategy. The Track
   * F strategy resets its HWM/position-tracking state on entry.
   */
  onPositionOpened(snapshot: OpenPositionSnapshot): void {
    this.donchianMtf.onPositionOpened(snapshot);
  }

  /**
   * `onPositionClosed` — DELEGATES to the DonchianMtfStrategy. The Track
   * F strategy clears its HWM/position-tracking state on close.
   */
  onPositionClosed(reason: string): void {
    this.donchianMtf.onPositionClosed(reason);
  }

  /**
   * `recordFundingSnapshot` — the CLI runner calls this at each funding
   * snapshot (8h cadence) to drive the Track E timing state machine
   * (rolling-window stats + entry/exit decisions) and the Track D carry
   * mechanics (effective leverage update + VaR check).
   *
   * Returns the in-carry payment (USD) applied for this snapshot, or 0
   * if out of carry.
   */
  recordFundingSnapshot(timestampMs: number, fundingRate: number): number {
    // Update the Track E timing state with the new funding sample.
    this.fundingCarryTiming.recordFundingSample(fundingRate, timestampMs);
    // Apply the snapshot to the underlying carry (this is where the
    // actual funding accrual happens; gated by timingState.isInCarry).
    const payment = this.fundingCarryTiming.accrueFundingOnSnapshot({
      fundingTime: timestampMs,
      symbol: "BTC/USDT",
      fundingRate,
    });
    return payment;
  }

  /**
   * `applyCarrySnapshot` — the CLI runner drives the Track D leverage
   * state update with the current vol-target multiplier. This is called
   * once per candle (not per funding snapshot) so the effective leverage
   * stays current with the Track G scaling.
   *
   * Returns the effective carry leverage applied (after both Track D
   * and Track G have had their say).
   */
  applyCarrySnapshot(unrealizedDeltaUsd: number): number {
    const combined = combineVolAndCarryLeverage(
      this.fundingCarryLeverage.config.maxLeverage,
      this.currentVolMultiplier,
    );
    // Mutate the Track D state to reflect the combined effective leverage.
    this.fundingCarryLeverage.state.currentLeverage = combined;
    this.fundingCarryLeverage.state.effectiveNotionalUsd =
      this.fundingCarryLeverage.config.baseNotionalUsd * combined;
    // Trigger rebalance if needed (Track D mechanics).
    this.fundingCarryTiming.triggerRebalanceIfNeeded(unrealizedDeltaUsd);
    return combined;
  }

  /**
   * `getState` — returns the V3 ensemble's runtime state. The CLI runner
   * calls this after the backtest to assemble the combined-edge metrics.
   *
   * `combinedEdgePct` is left at 0 here (the strategy doesn't have access
   * to the equity curve); the CLI runner sets it after computing
   * `donchianPnl + fundingCarryUsd` as a fraction of initial equity.
   */
  getState(): MultiClassEnsembleV3State {
    const totalFundingCandles =
      this.fundingCarryInCarryCandles + this.fundingCarryOutOfCarryCandles;
    const timeInCarryFraction =
      totalFundingCandles === 0
        ? 0
        : this.fundingCarryInCarryCandles / totalFundingCandles;
    const effectiveCarryLeverage = combineVolAndCarryLeverage(
      this.fundingCarryLeverage.config.maxLeverage,
      this.currentVolMultiplier,
    );
    return {
      donchianSignalsEmitted: this.donchianSignalsEmitted,
      donchianTimeExitCloses: this.donchianTimeExitCloses,
      fundingCarryUsd: this.fundingCarryTiming.state.fundingCollectedUsd,
      fundingCarryTimeInCarryFraction: timeInCarryFraction,
      fundingCarryEntries: this.fundingCarryEntriesSeen,
      effectiveCarryLeverage,
      volTargetedAvgMultiplier: this.currentVolMultiplier,
      dailyVaR95Pct: this.fundingCarryLeverage.state.dailyVaR95Pct,
      liquidationEvents: this.fundingCarryLeverage.state.liquidationEventsCount,
      combinedEdgePct: 0, // set by CLI runner after the backtest
      carrySide: { ...this.fundingCarryLeverage.state },
      timingSide: { ...this.fundingCarryTiming.state },
      recommendedMaxPositionPctEquity: this.lastRecommendedMaxPositionPctEquity,
    };
  }

  /**
   * `getCurrentVolMultiplier` — exposes the latest injected vol-target
   * multiplier for diagnostic purposes (CLI runner uses
   * `computeVolTargetedSizer` to compute the per-day multiplier, then
   * calls `setVolTargetMultiplier` before each candle).
   */
  getCurrentVolMultiplier(): number {
    return this.currentVolMultiplier;
  }

  /**
   * `getEffectiveCarryLeverage` — convenience accessor for the current
   * combined effective carry leverage. Returns the value computed by
   * `combineVolAndCarryLeverage` against the latest multiplier.
   */
  getEffectiveCarryLeverage(): number {
    return combineVolAndCarryLeverage(
      this.fundingCarryLeverage.config.maxLeverage,
      this.currentVolMultiplier,
    );
  }

  /**
   * `getVolTargetConfig` — exposes the VolTargetConfig for diagnostic
   * access from the CLI runner.
   */
  getVolTargetConfig(): VolTargetConfig {
    return this.volTargetedSizerConfig;
  }
}

// ---------------------------------------------------------------------------
// Timeframe helpers
// ---------------------------------------------------------------------------

/**
 * `timeframesForMultiClassV3` — returns the standard HTF/MTF/LTF triple
 * for the V3 multi-class ensemble. The DonchianMTF runs on 1d HTF +
 * 4h MTF + 1h LTF (Phase 8 Track F convention), and the funding carry
 * timing + carry leverage runs on the same 1h LTF.
 */
export function timeframesForMultiClassV3(ltf: Timeframe): {
  readonly htf: Timeframe;
  readonly mtf: Timeframe;
  readonly ltf: Timeframe;
} {
  if (ltf === "1h") return { htf: "1d", mtf: "4h", ltf: "1h" };
  if (ltf === "4h") return { htf: "1d", mtf: "4h", ltf: "4h" };
  if (ltf === "1d") return { htf: "1d", mtf: "4h", ltf: "1d" };
  throw new Error(`Multi-class V3 ensemble unsupported ltf: ${ltf as string}`);
}

// ---------------------------------------------------------------------------
// Re-export convenience: the default vol-target config builder
// ---------------------------------------------------------------------------

/**
 * `defaultV3VolTargetConfig` — returns the default Track G VolTargetConfig
 * (the same as `DEFAULT_VOL_TARGET_CONFIG`). Exposed for symmetry with the
 * other default partials — keeps the V3 config object complete by default.
 */
export function defaultV3VolTargetConfig(): VolTargetConfig {
  return DEFAULT_VOL_TARGET_CONFIG;
}

// Re-export the VolTargetedSizerResult type for the CLI runner's return
// type plumbing.
export type { VolTargetedSizerResult };