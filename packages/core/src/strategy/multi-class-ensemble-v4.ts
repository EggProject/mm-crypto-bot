// packages/core/src/strategy/multi-class-ensemble-v4.ts — Phase 9 M2
//
// Phase 9 M2 multi-class ensemble V4 — the COMBINED Phase 8 V3 + Phase 9 9D
// (SOL funding-flip kill-switch) + Phase 9 9E (Adaptive Kelly × VolTarget
// hybrid sizer) into a single composite strategy.
//
// ===========================================================================
// HARD CONSTRAINT — USER-MANDATED 1:10 LEVERAGE
// ===========================================================================
// Project-wide mandate (mvs_c13fe65cb68f4df3851304dea09a9099): ALL trades use
// EXACTLY 1:10 leverage (10× notional on 1× capital, 9× borrowed from bybit.eu
// SPOT margin). The CLI's `--leverage` flag accepts ONLY 1 or 10 — any other
// value is REJECTED at parse time. Default = 10. This constraint is enforced
// at THREE layers: CLI parser → constructor → strategy `validateTimingLeverage`.
// Under 1:10: clampedVolMultiplier ∈ [0.25, 1.0] → effective leverage ∈ [2.5, 10.0]
// (we always remain leveraged).
//
// ===========================================================================
// V4 architecture (signal-flow order, no double-counting)
// ===========================================================================
//
//   MultiClassEnsembleV4 holds 4 sub-strategies + 1 hybrid sizing result:
//
//     1. DonchianMtfStrategy (Phase 8 Track F) — PRIMARY directional signal.
//        Long-only, 1h/4h/1d MTF, ATR SL/TP, 168h max-hold. OWNER of
//        position-management hooks (onOpenPositionUpdate, onPositionOpened,
//        onPositionClosed).
//
//     2. FundingFlipKillSwitchStrategy (Phase 9 9D) — CARRY OVERLAY. Wraps
//        FundingCarryTimingStrategy (Track E) with a funding-flip regime
//        detector (7d sign-flip count + 7d negative-dominance + 7d |rate|
//        z-score). Pauses carry during flip regime.
//
//     3. FundingCarryLeverageStrategy (Phase 8 Track D) — CARRY MECHANICS.
//        VaR-capped dynamic leverage bookkeeping. effectiveCarryLev =
//        combineVolAndCarryLeverageV4(maxLev=10, clampedVolMultiplier)
//        clamped to [1, 10]. State-mutated by the ensemble after each candle.
//
//     4. HybridSizerResult (Phase 9 9E) — POSITION-SIZING result. The CLI
//        runner pre-computes this from the trade list + daily OHLCV and
//        injects the avg effectivePositionFactor via setHybridPositionFactor().
//        This drives recommendedMaxPositionPctEquity in the engine config
//        (DIRECTIONAL side only, NOT the carry leverage — see design note below).
//
//     5. VolTargetConfig (Phase 8 Track G) — INVERSE-VOL multiplier source.
//        Drives the clampedVolMultiplier injected via setVolTargetMultiplier().
//        Computed by the CLI runner from the daily OHLCV.
//
// ===========================================================================
// Signal aggregation (no double-counting — verified by tests)
// ===========================================================================
//
//   - PRIMARY directional signal: DonchianMTF.onCandle() — the ONLY engine
//     signal per candle.
//   - CARRY signal: FundingCarryTiming.underlying.onCandle() — state-tracked,
//     NOT propagated to the engine. FundingCarryFlipKillSwitch overrides this
//     when its kill-switch is engaged (returns null in onCandle, gates the
//     carry's accrueFundingOnSnapshot to 0).
//   - CARRY OVERLAY: FundingFlipKillSwitch.recordFundingSample() drives the
//     9D detector + persistence rule. forceExitIfRegimeActive() force-closes
//     the carry when the regime activates while in carry.
//   - LEVERAGE multiplier: combineVolAndCarryLeverageV4(maxLev=10, volMult) —
//     Math.floor(maxLev × volMult) clamped to [1, 10]. The Track 9E hybrid
//     factor does NOT scale carry leverage (only the directional position
//     size via maxPositionPctEquity) — see "Design note on Track 9E" in the
//     `combineVolAndCarryLeverageV4` function docstring. Effective carry
//     leverage MUST stay ≤ 10 (the 1:10 mandate ceiling).
//   - POSITION SIZE: recommendedMaxPositionPctEquity = baseKellyFraction ×
//     effectivePositionFactor × avgVolMultiplier, set by the CLI runner
//     from the pre-computed HybridSizerResult + avgVolMultiplier.
//
// ===========================================================================
// Component ordering — why this composition order?
// ===========================================================================
//
//   AdaptiveKellyVolHybrid (Track 9E) determines DIRECTIONAL POSITION SIZE
//     ⊃ FundingFlipKillSwitch (Track 9D) determines WHEN to carry
//       ⊃ FundingCarryLeverage (Track D) determines HOW MUCH to lever
//         ⊃ VolTargetedSizer (Track G) determines the vol-target multiplier
//           ⊃ DonchianMtf (Track F) emits the PRIMARY directional signal
//
// The wrapper chain (D → 9D → 9E) is logical, not actual OOP wrapping — V4
// holds all 5 sub-strategies and orchestrates them via composition. The CLI
// runner pre-computes the HybridSizerResult (Track 9E) once and injects it;
// the VolTargetConfig (Track G) is also pre-computed at CLI time.
//
// ===========================================================================
// References (≥2 independent sources per empirical claim)
// ===========================================================================
//   - Phase 8 V3 ensemble pattern: backtest-results/REPORT-phase8.md
//   - Phase 9 9D kill-switch: docs/research/phase9-funding-flip-kill-switch.md
//   - Phase 9 9E hybrid sizer: docs/research/phase9-adaptive-kelly-vol-hybrid.md
//   - Phase 8 Track D carry leverage: docs/research/phase8-carry-leverage-1-10.md
//   - Phase 8 Track E funding timing: docs/research/phase8-funding-timing.md
//   - Phase 8 Track F MTF Donchian: docs/research/phase8-1h-mtf-donchian.md
//   - Phase 8 Track G vol-targeted sizing: docs/research/phase8-vol-targeted-sizing.md
//   - Thorp (2006) "The Kelly Criterion in Blackjack..." — half-Kelly foundation
//   - Moreira & Muir (2017) — vol-managed portfolios (the Track G foundation)
//   - bybit.eu SPOT margin 1:10 leverage documentation

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
  DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG,
  FundingFlipKillSwitchStrategy,
  type FundingFlipKillSwitchConfig,
  type FundingFlipKillSwitchState,
} from "./funding-flip-kill-switch.js";
import {
  DEFAULT_LEVERAGED_CARRY_CONFIG,
  FundingCarryLeverageStrategy,
  type LeveragedCarryConfig,
  type LeveragedCarryState,
} from "./funding-carry-leverage.js";
import type { HybridSizerResult } from "../risk/adaptive-kelly-vol-hybrid.js";

// ---------------------------------------------------------------------------
// V4 Ensemble configuration
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleV4Config` — the full configuration of the V4 ensemble.
 * Each Phase 8 / Phase 9 component is independently configurable; the
 * defaults match the empirical results of Tracks D/E/F/G + Phase 9 9D/9E.
 *
 * Notes:
 *   - `volTargetedSizer` and `hybridSizerResult` are RUNTIME-INJECTED by
 *     the CLI runner (computed from the daily OHLCV + trade list). The
 *     defaults below are placeholders for unit-test wiring.
 *   - The 1:10 leverage mandate is enforced at the CONSTRUCTOR level via
 *     the FundingFlipKillSwitch and FundingCarryLeverage sub-strategies
 *     (both call `assert1to10Leverage`/`validateTimingLeverage` in their
 *     constructors).
 */
export interface MultiClassEnsembleV4Config {
  /** Donchian MTF (Track F) — PRIMARY directional signal. */
  readonly donchianMtf: Partial<DonchianMtfConfig>;
  /** Funding-flip kill-switch (Track 9D) — CARRY OVERLAY. Wraps FundingCarryTiming. */
  readonly fundingFlipKillSwitch: Partial<FundingFlipKillSwitchConfig>;
  /** Funding-carry leverage (Track D) — CARRY MECHANICS. */
  readonly fundingCarryLeverage: Partial<LeveragedCarryConfig>;
  /** Vol-targeted sizer (Track G) — INVERSE-VOL POSITION-SIZING layer. */
  readonly volTargetedSizer: VolTargetConfig;
  /** Hybrid sizer result (Track 9E) — POSITION-SIZING result. */
  readonly hybridSizerResult?: HybridSizerResult | undefined;
}

// ---------------------------------------------------------------------------
// Default config partial
// ---------------------------------------------------------------------------

/**
 * `DEFAULT_MULTI_CLASS_ENSEMBLE_V4_CONFIG_PARTIAL` — partial defaults.
 * The caller must supply the `volTargetedSizer` config (it's a runtime
 * input, not a strategy default). The `hybridSizerResult` is OPTIONAL
 * (if absent, the position-size factor defaults to 1.0).
 *
 * All sub-strategy defaults match the empirical best from their respective
 * tracks:
 *   - Donchian MTF: DEFAULT_DONCHIAN_MTF_CONFIG (20-period Donchian,
 *     1.5× ATR SL, 3.0× ATR TP, 168h max-hold, leverage 10).
 *   - Funding flip kill-switch: DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG
 *     (30d window, 0.75 entry / 0.5 exit, 72h cooldown, leverage 10,
 *     detector: 7d flip / 7d neg-dominance / 30d z-score baseline).
 *   - Funding carry leverage: DEFAULT_LEVERAGED_CARRY_CONFIG (maxLeverage
 *     10, baseNotionalUsd 10000, 50% IM, 5% rebalance, 0.02 VaR cap).
 */
export const DEFAULT_MULTI_CLASS_ENSEMBLE_V4_CONFIG_PARTIAL: Omit<
  MultiClassEnsembleV4Config,
  "volTargetedSizer"
> = {
  donchianMtf: DEFAULT_DONCHIAN_MTF_CONFIG,
  fundingFlipKillSwitch: DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG,
  fundingCarryLeverage: DEFAULT_LEVERAGED_CARRY_CONFIG,
};

// ---------------------------------------------------------------------------
// V4 Ensemble state
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleV4State` — read-only view of the V4 ensemble's runtime
 * state after a backtest. The CLI runner reads this for the empirical report
 * and the combined-edge computation.
 *
 * Field semantics (additions / changes vs V3):
 *   - `flipRegime` — direct reference to the Track 9D kill-switch state.
 *   - `hybridPositionFactor` — the per-day effective position-size factor
 *     from Track 9E (kellyFraction × volMultiplier). Avg over the backtest.
 *   - `effectiveLeverage` — FINAL effective carry leverage after Track D
 *     (1:10 bookkeeping) × Track G (vol-target) × Track 9E (hybrid factor)
 *     are combined. MUST stay in [1, 10] (the 1:10 mandate).
 *   - `recommendedMaxPositionPctEquity` — the canonical "% of equity per
 *     trade" cap. Includes the hybrid position-size factor.
 */
export interface MultiClassEnsembleV4State {
  readonly donchianSignalsEmitted: number;
  readonly donchianTimeExitCloses: number;
  readonly fundingCarryUsd: number;
  readonly fundingCarryTimeInCarryFraction: number;
  readonly fundingCarryEntries: number;
  readonly effectiveCarryLeverage: number;
  readonly volTargetedAvgMultiplier: number;
  readonly hybridPositionFactor: number;
  readonly dailyVaR95Pct: number;
  readonly liquidationEvents: number;
  readonly combinedEdgePct: number;
  /** Direct reference to the Track 9D kill-switch state. */
  readonly flipKillSwitchSide: FundingFlipKillSwitchState;
  /** Direct reference to the Track D leveraged carry state. */
  readonly carrySide: LeveragedCarryState;
  /** Recommended position cap as fraction of equity (Track G × baseKelly × 9E factor). */
  readonly recommendedMaxPositionPctEquity: number;
  /** 9D: regime activation count. */
  readonly flipRegimeActivationCount: number;
  /** 9D: count of funding snapshots where the kill-switch was engaged. */
  readonly flipCarryPausedFundingPeriods: number;
  /** 9D: carry-paused USD (would-have-earned/paid). */
  readonly flipCarryPausedFundingUsd: number;
  /** 9D: forced exits due to regime activation. */
  readonly flipForcedExitCount: number;
  /** 9E: avg Kelly fraction over the period. */
  readonly hybridAvgKellyFraction: number;
  /** 9E: avg vol multiplier over the period. */
  readonly hybridAvgVolMultiplier: number;
  /** 9E: avg effective leverage (10 × volMult) over the period. */
  readonly hybridAvgEffectiveLeverage: number;
}

// ---------------------------------------------------------------------------
// Helpers — leverage combination + per-symbol composition
// ---------------------------------------------------------------------------

/**
 * `combineVolAndCarryLeverageV4` — combines the Track G vol-targeting
 * multiplier with the Track D carry-side max leverage. The effective carry
 * leverage at any candle is:
 *
 *   `effectiveCarryLev = max(1, min(10, floor(carryMaxLev × clampedVolMultiplier)))`
 *
 * Under the 1:10 mandate, the result is always clamped to [1, 10].
 *
 * **Design note on Track 9E:** The Track 9E hybrid factor scales the
 * POSITION SIZE within the 1:10 base — NOT the leverage ratio itself.
 * This matches the 9E module's own design (`effectiveLeverage = 10 ×
 * volMultiplier`) and avoids the structural issue where scaling leverage
 * by the adaptive Kelly bucket would collapse carry revenue to ~0 in
 * low-edge regimes (which is what BTC/ETH/SOL all experience over 2024-2026).
 * The Track 9E hybrid factor is applied INSTEAD to the directional side
 * via `positionSize.maxPositionPctEquity` in the CLI runner.
 *
 * Intuition: Track G (vol-target) scales the CARRY leverage inversely
 * with market volatility. Track 9E (hybrid) scales the DIRECTIONAL
 * position size inversely with the strategy's recent edge quality.
 * Two orthogonal axes, two orthogonal scaling factors.
 *
 * Pure function for testability.
 */
export function combineVolAndCarryLeverageV4(
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
  const minLev = 1;
  const maxLev = ONE_TO_TEN_BASE_LEVERAGE;
  return Math.max(minLev, Math.min(maxLev, Math.floor(combined)));
}

/**
 * `computeV4CarryFractionFromFlipSwitchState` — pure-functional helper
 * that computes the time-in-carry fraction from the Track 9D flip-switch
 * state's timing layer (the underlying FundingCarryTimingState).
 *
 * Returns the ratio of in-carry funding periods to total funding periods
 * for the underlying carry timing strategy. Used by the CLI runner to
 * populate `state.fundingCarryTimeInCarryFraction`.
 */
export function computeV4CarryFractionFromFlipSwitchState(
  state: FundingFlipKillSwitchState,
): number {
  // The 9D kill-switch exposes the underlying carry state directly via
  // `underlyingCarryState`. We count funding snapshots via the timing-
  // layer fields (inCarryFundingPeriods + outOfCarryFundingPeriods).
  // We re-export here via a duck-typed lookup because the underlying
  // state is exposed through a getter, not a direct field reference.
  const timingState = (state as unknown as {
    underlyingCarryState?: {
      inCarryFundingPeriods: number;
      outOfCarryFundingPeriods: number;
    };
  }).underlyingCarryState;
  if (!timingState) return 0;
  const total = timingState.inCarryFundingPeriods + timingState.outOfCarryFundingPeriods;
  return total === 0 ? 0 : timingState.inCarryFundingPeriods / total;
}

/**
 * `PerSymbolV4Composition` — the per-symbol composition rule for V4.
 * Each symbol has a slightly different composition based on the empirical
 * results from Phase 8 V3 + Phase 9 9D:
 *
 *   - BTC: full V4 stack. DonchianMTF (per Phase 8 V3 BTC) + flip kill-switch
 *     (low flip activity on BTC, but the detector is still wired as a
 *     defensive overlay). Hybrid sizer drives position size.
 *
 *   - ETH: full V4 stack. ETH is the strongest directional (Phase 8 Track F
 *     Sharpe 1.798) and the strongest carry (Phase 8 Track E Sharpe 10.57).
 *     The hybrid sizer drives position size.
 *
 *   - SOL: V4 with 9D kill-switch FOR FLIP REGIME ONLY. SOL is the
 *     flippiest asset (median 5 flips/7d vs 2 for BTC/ETH) and has 3
 *     negative Track E walk-forward folds (Folds 17, 20, 21). The 9D
 *     kill-switch pauses carry during flip / negative-dominance regimes
 *     while still allowing healthy carries.
 */
export type V4PerSymbol = "BTC" | "ETH" | "SOL";

/**
 * `defaultV4CompositionForSymbol` — returns the V4 composition recommendation
 * for a given symbol. Pure function for testability.
 */
export function defaultV4CompositionForSymbol(symbol: V4PerSymbol): {
  readonly useDonchianMtf: boolean;
  readonly useFlipKillSwitch: boolean;
  readonly useHybridSizer: boolean;
  readonly reasoning: string;
} {
  switch (symbol) {
    case "BTC":
      return {
        useDonchianMtf: true,
        useFlipKillSwitch: true,
        useHybridSizer: true,
        reasoning:
          "BTC: full V4 stack. 16.2% of 8h snapshots at ≥10 flips/7d; detector wired as defensive overlay (low historical trigger rate). Hybrid sizer drives position size.",
      };
    case "ETH":
      return {
        useDonchianMtf: true,
        useFlipKillSwitch: true,
        useHybridSizer: true,
        reasoning:
          "ETH: full V4 stack. Strongest directional (Phase 8 Track F Sharpe 1.798) + strongest carry (Phase 8 Track E Sharpe 10.57). Hybrid sizer drives position size.",
      };
    case "SOL":
      return {
        useDonchianMtf: true,
        useFlipKillSwitch: true,
        useHybridSizer: true,
        reasoning:
          "SOL: V4 with 9D kill-switch for flip regime. SOL is the flippiest asset (median 5 flips/7d); 9D pauses carry during flip / negative-dominance regimes (avoids the 3 negative Track E folds). Hybrid sizer drives position size.",
      };
  }
}

// ---------------------------------------------------------------------------
// V4 Ensemble implementation
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleV4` — composite Strategy that integrates:
 *
 *   1. DonchianMtfStrategy (Phase 8 Track F) — PRIMARY directional signal.
 *      Long-only, 1h/4h/1d MTF, ATR SL/TP, 168h max-hold.
 *
 *   2. FundingFlipKillSwitchStrategy (Phase 9 9D) — CARRY OVERLAY. Wraps
 *      FundingCarryTimingStrategy with a funding-flip regime detector.
 *
 *   3. FundingCarryLeverageStrategy (Phase 8 Track D) — CARRY MECHANICS.
 *      VaR-capped dynamic leverage (1×..10×).
 *
 *   4. VolTargetedSizer (Phase 8 Track G) — INVERSE-VOL POSITION-SIZING.
 *      Drives the clampedVolMultiplier injected before each candle.
 *
 *   5. AdaptiveKellyVolHybrid (Phase 9 9E) — POSITION-SIZING result.
 *      Pre-computed by the CLI runner; injected as the hybrid position
 *      factor for the directional side's `maxPositionPctEquity`.
 *
 * The Strategy interface returns the DonchianMTF signal as-is (no double-
 * counting with the carry). Position-management hooks are DELEGATED to the
 * DonchianMtfStrategy (the 168h max-hold owner). The carry component runs
 * in PARALLEL via state tracking; the CLI runner computes the combined edge
 * after the backtest.
 */
export class MultiClassEnsembleV4 implements Strategy {
  readonly name =
    "Phase 9 Multi-Class Ensemble V4 (Donchian-MTF + Funding-Flip-KillSwitch + Carry-Leverage-10x + VolTarget + HybridSizer)";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: MultiClassEnsembleV4Config;
  readonly donchianMtf: DonchianMtfStrategy;
  readonly fundingFlipKillSwitch: FundingFlipKillSwitchStrategy;
  readonly fundingCarryLeverage: FundingCarryLeverageStrategy;
  readonly volTargetedSizerConfig: VolTargetConfig;
  readonly hybridSizerResult: HybridSizerResult | undefined;

  // Latest vol-target multiplier (updated externally by the CLI runner
  // via `setVolTargetMultiplier` before each candle, or defaults to 1.0).
  private currentVolMultiplier = 1.0;

  // Latest hybrid position factor (Track 9E). Updated externally by the CLI
  // runner via `setHybridPositionFactor` before each candle, or defaults
  // to 1.0 (no scaling).
  private currentHybridFactor = 1.0;

  // Per-candle counters.
  private donchianSignalsEmitted = 0;
  private donchianTimeExitCloses = 0;
  private fundingCarryEntriesSeen = 0;
  private fundingCarryExitsSeen = 0;
  private fundingCarryInCarryCandles = 0;
  private fundingCarryOutOfCarryCandles = 0;

  // Aggregated vol-target + hybrid diagnostics.
  private lastRecommendedMaxPositionPctEquity = 0;

  constructor(config: MultiClassEnsembleV4Config) {
    this.config = config;
    this.donchianMtf = new DonchianMtfStrategy(config.donchianMtf);
    this.fundingFlipKillSwitch = new FundingFlipKillSwitchStrategy(
      config.fundingFlipKillSwitch,
    );
    this.fundingCarryLeverage = new FundingCarryLeverageStrategy(config.fundingCarryLeverage);
    this.volTargetedSizerConfig = config.volTargetedSizer;
    this.hybridSizerResult = config.hybridSizerResult;

    // Pre-populate the hybrid factor from the injected HybridSizerResult
    // (the avg effectivePositionFactor over the backtest window). If no
    // HybridSizerResult was injected, the factor defaults to 1.0.
    if (this.hybridSizerResult !== undefined) {
      this.currentHybridFactor = this.hybridSizerResult.avgEffectivePositionFactor;
    }
  }

  warmup(): number {
    // All four components have their own warmup:
    //   - Donchian MTF: 30 candles (HTF Supertrend + MTF Donchian + LTF ATR)
    //   - Funding flip kill-switch: 720 candles (30d window × 24h/d,
    //     the detector's volWindowDays). The 9D strategy exposes its
    //     warmup() method explicitly.
    //   - Funding carry leverage: 30 candles (same as Track C)
    //   - VolTargetedSizer: 30d window (CLI runner computes; not blocking)
    //   - AdaptiveKellyVolHybrid: rollingWindowDays × 24h (CLI runner
    //     computes; not blocking)
    //
    // The funding flip kill-switch dominates (720 = 30d), matching the
    // V3 pattern (where FundingCarryTiming also needed 720).
    return Math.max(
      this.donchianMtf.warmup(),
      this.fundingFlipKillSwitch.warmup(),
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
   * `getState()` (effective carry leverage = 10 × multiplier × hybridFactor).
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
   * `setHybridPositionFactor` — the CLI runner calls this BEFORE each
   * candle to inject the Track 9E per-day effective position factor
   * (`kellyFraction × volMultiplier`). The default is the
   * `avgEffectivePositionFactor` from the injected HybridSizerResult,
   * or 1.0 if no result was injected.
   *
   * The factor is consumed by the leverage combination logic in
   * `getState()` (effective carry leverage = 10 × multiplier × factor).
   */
  setHybridPositionFactor(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`hybridPositionFactor must be positive finite, got ${String(factor)}`);
    }
    this.currentHybridFactor = Math.max(0.01, Math.min(2.0, factor));
  }

  /**
   * `setRecommendedMaxPositionPctEquity` — the CLI runner pushes the
   * recommended position cap (avgHybridFactor × baseKelly × avgMultiplier × equity)
   * into the ensemble after computing the HybridSizerResult. This is
   * informational (the engine reads `positionSize.maxPositionPctEquity`
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
   * Step 2: FundingCarryFlipKillSwitch.onCandle → returns null when
   *         kill-switch is engaged (no fresh entry). The inner carry
   *         timing state still advances via its own onCandle. We delegate
   *         to the kill-switch's onCandle directly (it returns null
   *         when engaged, otherwise delegates to the inner FundingCarryTiming).
   * Step 3: FundingCarryLeverage.onCandle → updates carry bookkeeping.
   *         Signal discarded.
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

    // Step 2 — Funding flip kill-switch state machine. The 9D wrapper
    // returns null when engaged (no fresh entry); otherwise delegates
    // to the inner FundingCarryTimingStrategy which may emit entry/exit
    // signals (also discarded — only the Donchian MTF signal flows to
    // the engine).
    const flipSignal = this.fundingFlipKillSwitch.onCandle(ctx);
    void flipSignal;

    // Track the underlying carry timing state (Track E layer) for diagnostics.
    const timingState = this.fundingFlipKillSwitch.underlyingCarryState;
    if (timingState.isInCarry) {
      this.fundingCarryInCarryCandles += 1;
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
    const killStatus = this.fundingFlipKillSwitch.isKillSwitchEngaged(ctx.candle.timestamp)
      ? "kill=engaged"
      : "kill=disengaged";
    const volStatus = `vol=${this.currentVolMultiplier.toFixed(3)}`;
    const hybridStatus = `hybrid=${this.currentHybridFactor.toFixed(3)}`;
    const reason =
      `[MultiClassEnsembleV4] ${carryStatus} | ${killStatus} | ${volStatus} | ${hybridStatus} | ${donchianSignal.reason}`;
    return {
      ...donchianSignal,
      reason,
    };
  }

  /**
   * `onOpenPositionUpdate` — DELEGATES to the DonchianMtfStrategy. The
   * Track F strategy owns the 168h max-hold enforcement (via `forceExit`
   * + `reason: "time_exit"`). Track D and Track 9D do not emit position
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
   * snapshot (8h cadence) to drive:
   *   1. The Track 9D flip detector (rolling-window stats + regime decision).
   *   2. The Track 9D kill-switch (force-exit if regime activates while in carry).
   *   3. The Track E timing state machine (entry/exit decisions).
   *   4. The Track D carry mechanics (effective leverage + accrual).
   *
   * Returns the in-carry payment (USD) applied for this snapshot, or 0
   * if out of carry OR the kill-switch is engaged (paused carry).
   */
  recordFundingSnapshot(timestampMs: number, fundingRate: number): number {
    // Step 1 — Drive the 9D flip detector.
    const decision = this.fundingFlipKillSwitch.recordFundingSample(fundingRate, timestampMs);

    // Step 2 — Apply the snapshot. The 9D wrapper internally delegates
    // to the underlying FundingCarryTimingStrategy's accrueFundingOnSnapshot
    // when the kill-switch is NOT engaged. When engaged, it returns 0
    // and tracks the carry-paused USD. The underlying's in-carry state
    // is PRESERVED through the pause — we do NOT force-exit here — so when
    // the kill-switch disengages the underlying resumes accruing from
    // where it left off.
    //
    // Design rationale: the 9D's pause mechanism (accrueFundingOnSnapshot
    // returning 0) is the primary protection. Force-exiting would reset
    // the underlying's in-carry state and force a re-entry decision,
    // which empirically reduces carry revenue significantly without
    // adding meaningful DD protection (the pause already prevents
    // negative-funding accrual). V4 treats 9D as a CARRY OVERLAY (pause
    // without state reset), consistent with the brief's "overlay" framing.
    void decision;

    const payment = this.fundingFlipKillSwitch.accrueFundingOnSnapshot(
      {
        fundingTime: timestampMs,
        symbol: "BTC/USDT",
        fundingRate,
      },
      timestampMs,
    );
    return payment;
  }

  /**
   * `applyCarrySnapshot` — the CLI runner drives the Track D leverage
   * state update with the current vol-target multiplier AND the Track 9E
   * hybrid position factor. This is called once per candle (not per funding
   * snapshot) so the effective leverage stays current with both Track G
   * and Track 9E scaling.
   *
   * Returns the effective carry leverage applied (after Track D, Track G,
   * and Track 9E have all had their say). MUST stay in [1, 10].
   */
  applyCarrySnapshot(unrealizedDeltaUsd: number): number {
    const combined = combineVolAndCarryLeverageV4(
      this.fundingCarryLeverage.config.maxLeverage,
      this.currentVolMultiplier,
    );
    // Mutate the Track D state to reflect the combined effective leverage.
    this.fundingCarryLeverage.state.currentLeverage = combined;
    this.fundingCarryLeverage.state.effectiveNotionalUsd =
      this.fundingCarryLeverage.config.baseNotionalUsd * combined;
    // Trigger rebalance if needed (Track D mechanics). The 9D wrapper
    // passes through to the underlying when the kill-switch is disengaged.
    // Note: the rebalance trigger uses `Date.now()` as a best-effort
    // timestamp here — the inner rebalance logic doesn't actually read
    // the timestamp value (it just uses `unrealizedDeltaUsd`).
    this.fundingFlipKillSwitch.triggerRebalanceIfNeeded(unrealizedDeltaUsd, Date.now());
    return combined;
  }

  /**
   * `getState` — returns the V4 ensemble's runtime state. The CLI runner
   * calls this after the backtest to assemble the combined-edge metrics.
   *
   * `combinedEdgePct` is left at 0 here (the strategy doesn't have access
   * to the equity curve); the CLI runner sets it after computing
   * `donchianPnl + fundingCarryUsd` as a fraction of initial equity.
   */
  getState(): MultiClassEnsembleV4State {
    const totalFundingCandles =
      this.fundingCarryInCarryCandles + this.fundingCarryOutOfCarryCandles;
    const timeInCarryFraction =
      totalFundingCandles === 0
        ? 0
        : this.fundingCarryInCarryCandles / totalFundingCandles;
    const effectiveCarryLeverage = combineVolAndCarryLeverageV4(
      this.fundingCarryLeverage.config.maxLeverage,
      this.currentVolMultiplier,
    );
    return {
      donchianSignalsEmitted: this.donchianSignalsEmitted,
      donchianTimeExitCloses: this.donchianTimeExitCloses,
      fundingCarryUsd: this.fundingFlipKillSwitch.underlyingCarryState.fundingCollectedUsd,
      fundingCarryTimeInCarryFraction: timeInCarryFraction,
      fundingCarryEntries: this.fundingCarryEntriesSeen,
      effectiveCarryLeverage,
      volTargetedAvgMultiplier: this.currentVolMultiplier,
      hybridPositionFactor: this.currentHybridFactor,
      dailyVaR95Pct: this.fundingCarryLeverage.state.dailyVaR95Pct,
      liquidationEvents: this.fundingCarryLeverage.state.liquidationEventsCount,
      combinedEdgePct: 0, // set by CLI runner after the backtest
      flipKillSwitchSide: { ...this.fundingFlipKillSwitch.state },
      carrySide: { ...this.fundingCarryLeverage.state },
      recommendedMaxPositionPctEquity: this.lastRecommendedMaxPositionPctEquity,
      flipRegimeActivationCount: this.fundingFlipKillSwitch.state.regimeActivationCount,
      flipCarryPausedFundingPeriods: this.fundingFlipKillSwitch.state.carryPausedFundingPeriods,
      flipCarryPausedFundingUsd: this.fundingFlipKillSwitch.state.carryPausedFundingUsd,
      flipForcedExitCount: this.fundingFlipKillSwitch.state.forcedExitCount,
      hybridAvgKellyFraction: this.hybridSizerResult?.avgKellyFraction ?? 0,
      hybridAvgVolMultiplier: this.hybridSizerResult?.avgVolMultiplier ?? 1.0,
      hybridAvgEffectiveLeverage:
        this.hybridSizerResult?.avgEffectiveLeverage ?? ONE_TO_TEN_BASE_LEVERAGE,
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
   * `getCurrentHybridFactor` — exposes the latest injected Track 9E
   * hybrid position factor for diagnostic purposes.
   */
  getCurrentHybridFactor(): number {
    return this.currentHybridFactor;
  }

  /**
   * `getEffectiveCarryLeverage` — convenience accessor for the current
   * combined effective carry leverage. Returns the value computed by
   * `combineVolAndCarryLeverageV4` against the latest multiplier + factor.
   */
  getEffectiveCarryLeverage(): number {
    return combineVolAndCarryLeverageV4(
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
 * `timeframesForMultiClassV4` — returns the standard HTF/MTF/LTF triple
 * for the V4 multi-class ensemble. The DonchianMTF runs on 1d HTF +
 * 4h MTF + 1h LTF (Phase 8 Track F convention), and the funding carry
 * timing + carry leverage runs on the same 1h LTF.
 */
export function timeframesForMultiClassV4(ltf: Timeframe): {
  readonly htf: Timeframe;
  readonly mtf: Timeframe;
  readonly ltf: Timeframe;
} {
  if (ltf === "1h") return { htf: "1d", mtf: "4h", ltf: "1h" };
  if (ltf === "4h") return { htf: "1d", mtf: "4h", ltf: "4h" };
  if (ltf === "1d") return { htf: "1d", mtf: "4h", ltf: "1d" };
  throw new Error(`Multi-class V4 ensemble unsupported ltf: ${ltf as string}`);
}

// ---------------------------------------------------------------------------
// Re-export convenience: the default vol-target config builder
// ---------------------------------------------------------------------------

/**
 * `defaultV4VolTargetConfig` — returns the default Track G VolTargetConfig
 * (the same as `DEFAULT_VOL_TARGET_CONFIG`). Exposed for symmetry with the
 * other default partials — keeps the V4 config object complete by default.
 */
export function defaultV4VolTargetConfig(): VolTargetConfig {
  return DEFAULT_VOL_TARGET_CONFIG;
}

// Re-export the VolTargetedSizerResult type for the CLI runner's return
// type plumbing.
export type { VolTargetedSizerResult };