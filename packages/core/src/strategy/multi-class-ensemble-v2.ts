// packages/core/src/strategy/multi-class-ensemble-v2.ts — Phase 7 multi-class ensemble V2
//
// Phase 7 M2 — A Phase 6 M2 multi-class ensemble V2, ami a Phase 7 három
// amplifikációs track-ját integrálja:
//
//   1. DonchianTrailingStrategy (Phase 7 Track A) — a BASE trend-following
//      edge trailing-stop-pal kiegészítve. A HWM-alapú trailing-stop a
//      Phase 5 ATR-based SL/TP FÖLÉ rakódik (override-ok csak monoton
//      tightening értelemben).
//
//   2. FundingCarryLeverageStrategy (Phase 7 Track C) — delta-neutral
//      carry parallel, 1×..3× dynamic leverage, VaR cap (2% daily @ 95%),
//      liquidation buffer. A carry contribution NEM megy keresztül a
//      directional engine-n, hanem a FundingCarryLeverageStrategy.state
//      mezőben trackelődik. A CLI runner a backtest után olvassa ki.
//
//   3. CrossExchangeArbLatency gate (Phase 6 Track B, unchanged) —
//      INFORMATIONAL gate, ami a carry komponenst pause-eli ha a
//      cross-exchange latency túllépi a trade-ablak méretét.
//
//   4. AdaptiveKelly (Phase 7 Track B) — POSITION-SIZING. A rolling 30-day
//      realized Sharpe-ből 4-bucket mapping (0.25× / 0.5× / 0.7× / 1.0×).
//      A CLI runner az `AdaptiveKellyResult.recommendedMaxPositionPctEquity`
//      értéket a `BacktestOptions.positionSize.maxPositionPctEquity`-be
//      küldi a backtest indítása előtt.
//
// Signal-aggregáció (kritikus — no double-counting, Phase 6 M2 mintát
// követve):
//
//   - Az ensemble PRIMARY signal-ja a Donchian signál (a carry NEM ad
//     directional jelet az engine-nek).
//   - A latency gate NEM változtatja meg a Donchian signált; CSAK a
//     carry komponenst pause-eli.
//   - A Kelly multiplier a signal.confidence értékét NEM módosítja; a
//     sizing kívül történik, a BacktestOptions.positionSize-en keresztül.
//   - A trailing-stop hook-ok (onOpenPositionUpdate, onPositionOpened,
//     onPositionClosed) DELEGÁLVA a DonchianTrailingStrategy-hoz.
//
// References (≥2 independent source / empirical claim):
//   - Phase 5 C Donchian 1d: docs/research/REPORT-phase5.md §4.2
//   - Phase 6 M2 ensemble pattern: docs/research/REPORT-phase6.md §3-5
//   - Phase 7 Track A trailing-stop: docs/research/phase7-trailing-stop.md
//   - Phase 7 Track B adaptive Kelly: docs/research/phase7-adaptive-kelly.md
//   - Phase 7 Track C carry leverage: docs/research/phase7-carry-leverage.md
//   - Bailey & López de Prado (2014) "The Deflated Sharpe Ratio" —
//     multi-bucket Sharpe mapping rationale
//     https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
//   - Moreira & Muir (2017) "Volatility-Managed Portfolios" — risk scales
//     inversely with lagged variance; our adaptive Kelly is the
//     sizing-level analog (low Sharpe → reduce size)
//     https://law.yale.edu/sites/default/files/area/workshop/leo/leo17_moreira.pdf
//   - Bybit Institutional 2025 Crypto Quant Strategy Index — leveraged
//     delta-neutral +9.48% with 0.80% max DD (Phase 7 Track C reference)
//   - Stratbase BTC trailing-stop 2019-2025 — ATR 2.5× +10% fixed %
//     trailing gives 320% return, -25% DD (Phase 7 Track A reference)
//     https://stratbase.ai/en/blog/trailing-stop-strategies-compared
//
// Specifikáció: docs/research/phase7-strategy-brief.md §1.3 M2.

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
  DonchianTrailingStrategy,
  DEFAULT_DONCHIAN_TRAILING_CONFIG,
  type DonchianTrailingConfig,
} from "./donchian-trailing.js";
import type { LatencyGate } from "./multi-class-ensemble.js";
import {
  FundingCarryLeverageStrategy,
  DEFAULT_LEVERAGED_CARRY_CONFIG,
  type LeveragedCarryConfig,
  type LeveragedCarryState,
} from "./funding-carry-leverage.js";

// ---------------------------------------------------------------------------
// Re-exports — Phase 6 M2 latency gate + Kelly base types
// ---------------------------------------------------------------------------

export {
  createLatencyGate,
  DEFAULT_KELLY_OPT_AGGREGATE,
  DEFAULT_LATENCY_GATE_DISABLED,
  DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
} from "./multi-class-ensemble.js";

export type { LatencyGate, LatencySnapshot, KellyOptAggregate } from "./multi-class-ensemble.js";

// ---------------------------------------------------------------------------
// Adaptive Kelly aggregate (Phase 7 Track B — replaces static 0.5× default)
// ---------------------------------------------------------------------------

/**
 * `AdaptiveKellyAggregate` — the Phase 7 Track B adaptive Kelly integration
 * (replaces Phase 6 Track C's static `KellyOptAggregate`). The ensemble
 * reads:
 *   - `effectiveMultiplier` — the per-period rounded bucket (0.25 / 0.5 /
 *     0.7 / 1.0) to apply to the `maxPositionPctEquity`.
 *   - `recommendedMaxPositionPctEquity` — the per-period recommended cap.
 *   - `bucketDistribution` — the % time spent in each of the 4 buckets
 *     (informational, for the CLI runner report).
 *   - `hadAllLossStreak` — defensive trip flag (if true, the CLI runner
 *     hard-floors at 0.25×).
 *
 * The CLI runner sets `BacktestOptions.positionSize.maxPositionPctEquity`
 * to `recommendedMaxPositionPctEquity` before kicking off the backtest.
 * The 4-bucket mapping is from `sharpeToKellyBucket()` in
 * `kelly-adaptive.ts` — see docs/research/phase7-adaptive-kelly.md §3.1
 * for the bucket boundary rationale.
 */
export interface AdaptiveKellyAggregate {
  /** Per-period rounded bucket to apply (0.25 / 0.5 / 0.7 / 1.0). */
  readonly effectiveMultiplier: 0.25 | 0.5 | 0.7 | 1.0;
  /** Recommended position cap as fraction of equity (pre-backtest input). */
  readonly recommendedMaxPositionPctEquity: number;
  /** Bucket distribution over the historical window (informational). */
  readonly bucketDistribution: {
    readonly fullKellyFraction: number;
    readonly threeQuarterFraction: number;
    readonly halfKellyFraction: number;
    readonly quarterKellyFraction: number;
    readonly insufficientFraction: number;
    readonly totalDays: number;
  };
  /** True if the rolling window triggered the all-loss-streak hard floor. */
  readonly hadAllLossStreak: boolean;
}

/**
 * `DEFAULT_ADAPTIVE_KELLY_AGGREGATE` — Phase 7 Track B default: 0.5×
 * static fallback (matches Phase 6 Track C's static default), 20% max
 * position (Phase 5+6 baseline). Used when the adaptive Kelly has not
 * been computed yet (cold-start) or when the trade list has fewer than
 * 30 trades (`computeAdaptiveKelly` short-circuits to 0.5× in that case).
 */
export const DEFAULT_ADAPTIVE_KELLY_AGGREGATE: AdaptiveKellyAggregate = {
  effectiveMultiplier: 0.5,
  recommendedMaxPositionPctEquity: 0.2,
  bucketDistribution: {
    fullKellyFraction: 0,
    threeQuarterFraction: 0,
    halfKellyFraction: 0,
    quarterKellyFraction: 0,
    insufficientFraction: 1,
    totalDays: 0,
  },
  hadAllLossStreak: false,
};

// ---------------------------------------------------------------------------
// V2 Ensemble configuration
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleV2Config` — the full configuration of the V2 ensemble.
 * Each Phase 7 component is independently configurable; the defaults
 * match the empirical results of Tracks A/B/C.
 */
export interface MultiClassEnsembleV2Config {
  /** Donchian trailing-stop (Track A). */
  readonly donchianTrailing: Partial<DonchianTrailingConfig>;
  /** Funding-carry with leverage (Track C). */
  readonly fundingCarryLeverage: Partial<LeveragedCarryConfig>;
  /** The latency gate (Phase 6 Track B). Pass `DEFAULT_LATENCY_GATE_DISABLED` to bypass. */
  readonly latencyGate: LatencyGate;
  /** Adaptive Kelly aggregate (Track B). */
  readonly adaptiveKelly: AdaptiveKellyAggregate;
}

/**
 * `DEFAULT_MULTI_CLASS_ENSEMBLE_V2_CONFIG_PARTIAL` — partial defaults.
 * The `latencyGate` and `adaptiveKelly` must be supplied by the caller
 * (they are runtime inputs, not strategy defaults).
 */
export const DEFAULT_MULTI_CLASS_ENSEMBLE_V2_CONFIG_PARTIAL: Omit<
  MultiClassEnsembleV2Config,
  "latencyGate" | "adaptiveKelly"
> = {
  donchianTrailing: DEFAULT_DONCHIAN_TRAILING_CONFIG,
  fundingCarryLeverage: DEFAULT_LEVERAGED_CARRY_CONFIG,
};

// ---------------------------------------------------------------------------
// V2 Ensemble state
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleV2State` — read-only view of the V2 ensemble's
 * runtime state after a backtest. The CLI runner reads this for the
 * empirical report and the combined-edge computation.
 *
 * `donchianSignalsEmitted` — number of Donchian signals produced during
 * the backtest.
 *
 * `trailingStopExits` — number of exits triggered by the Phase 7 Track A
 * trailing-stop (vs the Phase 5 ATR-based SL/TP). A non-zero value
 * indicates the trailing-stop actively contributed.
 *
 * `fundingCarryUsd` — total funding collected by the leveraged carry
 * component (sum of all 8h funding payments × effective leverage, while
 * the latency gate was OPEN).
 *
 * `effectiveLeverage` — the FINAL (end-of-backtest) effective leverage
 * applied by the Track C strategy. Useful for diagnosing whether the
 * VaR cap or funding-stability gate scaled leverage down.
 *
 * `dailyVaR95Pct` — the FINAL daily VaR (95% confidence) as a fraction
 * of equity. Must stay ≤ 2% per Phase 7 brief §1.2 M1.3 hard requirement.
 *
 * `liquidationEvents` — count of hypothetical liquidation events during
 * the backtest. Must stay 0 per the brief.
 *
 * `latencyGateActiveFraction` — fraction of candles where the latency
 * gate allowed the carry (0 = always paused, 1 = always open).
 *
 * `effectiveKellyMultiplier` — the rounded bucket applied to the
 * position cap (0.25 / 0.5 / 0.7 / 1.0).
 *
 * `combinedEdgePct` — the COMBINED edge (Donchian trade PnL + leveraged
 * carry funding) as a percentage of initial equity. Computed by the CLI
 * runner after the backtest from the trade list + carry state.
 */
export interface MultiClassEnsembleV2State {
  readonly donchianSignalsEmitted: number;
  readonly donchianSignalsAcceptedByFilter: number;
  readonly trailingStopExits: number;
  readonly fundingCarryUsd: number;
  readonly fundingCarryPausedCandles: number;
  readonly fundingCarryActiveCandles: number;
  readonly latencyGateActiveFraction: number;
  readonly effectiveLeverage: number;
  readonly dailyVaR95Pct: number;
  readonly liquidationEvents: number;
  readonly effectiveKellyMultiplier: 0.25 | 0.5 | 0.7 | 1.0;
  readonly combinedEdgePct: number;
  /** Direct reference to the leveraged carry state (for CLI runner access). */
  readonly fundingCarryState: LeveragedCarryState;
  /** Whether the all-loss-streak hard floor was triggered. */
  readonly hadAllLossStreak: boolean;
}

// ---------------------------------------------------------------------------
// V2 Ensemble implementation
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleV2` — composite Strategy that integrates:
 *   1. DonchianTrailingStrategy (Phase 7 Track A) — directional primary
 *      signal + per-bar position management (HWM-based trailing-stop).
 *   2. FundingCarryLeverageStrategy (Phase 7 Track C) — delta-neutral
 *      parallel, leveraged, VaR-capped, with liquidation buffer.
 *   3. LatencyGate (Phase 6 Track B) — gates the carry.
 *   4. AdaptiveKelly (Phase 7 Track B) — informs position-sizing; applied
 *      externally via `BacktestOptions.positionSize.maxPositionPctEquity`.
 *
 * The Strategy interface returns the Donchian signal as-is (no double-
 * counting with the carry; the carry contributes through state, not
 * signals). The position-management hooks are DELEGATED to the
 * DonchianTrailingStrategy (the ensemble is a thin wrapper).
 *
 * The latency gate does NOT change the Donchian signal — it ONLY gates
 * the carry component. This is intentional and consistent with Phase 6
 * M2 — a paused carry does not mean a paused trend trade.
 */
export class MultiClassEnsembleV2 implements Strategy {
  readonly name =
    "Phase 7 Multi-Class Ensemble V2 (Donchian-Trailing + Adaptive-Kelly + Leveraged-Carry + Latency-Gate)";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: MultiClassEnsembleV2Config;
  readonly donchian: DonchianTrailingStrategy;
  readonly fundingCarry: FundingCarryLeverageStrategy;
  readonly latencyGate: LatencyGate;
  readonly adaptiveKelly: AdaptiveKellyAggregate;

  // Per-candle counters.
  private donchianSignalsEmitted = 0;
  private donchianSignalsAcceptedByFilter = 0;
  private trailingStopExits = 0;
  private fundingCarryPausedCandles = 0;
  private fundingCarryActiveCandles = 0;

  constructor(config: MultiClassEnsembleV2Config) {
    this.config = config;
    this.donchian = new DonchianTrailingStrategy(config.donchianTrailing);
    this.fundingCarry = new FundingCarryLeverageStrategy(config.fundingCarryLeverage);
    this.latencyGate = config.latencyGate;
    this.adaptiveKelly = config.adaptiveKelly;
  }

  warmup(): number {
    // Both the Donchian-trailing and the funding-carry-leverage must be
    // warm before any signal can be produced. The Donchian warmup
    // dominates (30 candles) — the funding-carry needs 30 for stability
    // history, same window.
    return Math.max(this.donchian.warmup(), this.fundingCarry.warmup());
  }

  /**
   * `onCandle` — runs every LTF candle when NO position is open.
   *
   * Step 1: Donchian-trailing signal → this is the PRIMARY output.
   * Step 2: Latency gate consultation. If OPEN, the carry component's
   *         `onCandle` is invoked. If CLOSED, the carry is paused for
   *         this candle.
   * Step 3: Return the Donchian signal (or null).
   *
   * Critically: the carry component NEVER overrides or modifies the
   * Donchian signal. The two edges are independent and combined only at
   * the portfolio level (CLI runner reads `state.fundingCarryUsd` after
   * the backtest).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    // Step 1 — Donchian-trailing signal (delegates to Phase 5 Donchian + Track A trailing config).
    const donchianSignal = this.donchian.onCandle(ctx);

    if (donchianSignal !== null) {
      this.donchianSignalsEmitted += 1;
      this.donchianSignalsAcceptedByFilter += 1;
    }

    // Step 2 — Latency gate + carry component (with leverage).
    if (this.latencyGate.isCarryAllowed()) {
      this.fundingCarryActiveCandles += 1;
      // Invoke the leveraged carry strategy. Its `onCandle` returns a
      // one-shot "buy" signal on the first valid candle; subsequent calls
      // return null but maintain the carry state (funding accrual + VaR
      // check + leverage recompute).
      const carrySignal = this.fundingCarry.onCandle(ctx);
      void carrySignal; // suppress unused-var lint; carry captured in state
    } else {
      this.fundingCarryPausedCandles += 1;
      // Gate CLOSED — do NOT invoke the carry component.
    }

    // Step 3 — Return the Donchian signal (with an ensemble reason tag).
    if (donchianSignal === null) {
      return null;
    }
    const carryStatus = this.latencyGate.isCarryAllowed() ? "carry=active" : "carry=paused";
    const kellyStatus = `kelly=${this.adaptiveKelly.effectiveMultiplier}×`;
    return {
      ...donchianSignal,
      reason: `[MultiClassEnsembleV2] ${carryStatus} | ${kellyStatus} | ${donchianSignal.reason}`,
    };
  }

  /**
   * `onOpenPositionUpdate` — DELEGATES to the DonchianTrailingStrategy's
   * HWM-based trailing-stop engine. If the engine returns a
   * `forceExit: true` with `reason: "trailing_stop"`, we increment the
   * `trailingStopExits` counter for the empirical report.
   */
  onOpenPositionUpdate(ctx: PositionManagementContext): PositionUpdate | null {
    const update = this.donchian.onOpenPositionUpdate(ctx);
    if (update !== null && update.forceExit === true) {
      this.trailingStopExits += 1;
    }
    return update;
  }

  /**
   * `onPositionOpened` — DELEGATES to the DonchianTrailingStrategy. The
   * trailing-stop engine resets its HWM and holding-state to the entry
   * price.
   */
  onPositionOpened(snapshot: OpenPositionSnapshot): void {
    this.donchian.onPositionOpened(snapshot);
  }

  /**
   * `onPositionClosed` — DELEGATES to the DonchianTrailingStrategy. The
   * trailing-stop engine resets its HWM and holding-state to null.
   */
  onPositionClosed(reason: string): void {
    this.donchian.onPositionClosed(reason);
  }

  /**
   * `getState` — returns the V2 ensemble's runtime state. The CLI runner
   * calls this after the backtest to assemble the combined-edge metrics.
   *
   * `combinedEdgePct` is left at 0 here (the strategy doesn't have
   * access to the equity curve); the CLI runner sets it after computing
   * `donchianPnl + fundingCarryUsd` as a fraction of initial equity.
   */
  getState(): MultiClassEnsembleV2State {
    const totalCarryCandles = this.fundingCarryActiveCandles + this.fundingCarryPausedCandles;
    const latencyGateActiveFraction =
      totalCarryCandles === 0 ? 0 : this.fundingCarryActiveCandles / totalCarryCandles;
    return {
      donchianSignalsEmitted: this.donchianSignalsEmitted,
      donchianSignalsAcceptedByFilter: this.donchianSignalsAcceptedByFilter,
      trailingStopExits: this.trailingStopExits,
      fundingCarryUsd: this.fundingCarry.state.fundingCollectedUsd,
      fundingCarryPausedCandles: this.fundingCarryPausedCandles,
      fundingCarryActiveCandles: this.fundingCarryActiveCandles,
      latencyGateActiveFraction,
      effectiveLeverage: this.fundingCarry.state.currentLeverage,
      dailyVaR95Pct: this.fundingCarry.state.dailyVaR95Pct,
      liquidationEvents: this.fundingCarry.state.liquidationEventsCount,
      effectiveKellyMultiplier: this.adaptiveKelly.effectiveMultiplier,
      combinedEdgePct: 0, // set by CLI runner after the backtest
      fundingCarryState: { ...this.fundingCarry.state },
      hadAllLossStreak: this.adaptiveKelly.hadAllLossStreak,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `timeframesForMultiClassV2` — returns the standard HTF/MTF/LTF triple
 * for the V2 multi-class ensemble. The Donchian-trailing runs on 1d HTF
 * + 4h MTF + 1h LTF (Phase 5 convention), and the leveraged carry runs
 * on the same 1h LTF.
 */
export function timeframesForMultiClassV2(ltf: Timeframe): {
  readonly htf: Timeframe;
  readonly mtf: Timeframe;
  readonly ltf: Timeframe;
} {
  if (ltf === "1h") return { htf: "1d", mtf: "4h", ltf: "1h" };
  if (ltf === "4h") return { htf: "1d", mtf: "4h", ltf: "4h" };
  if (ltf === "1d") return { htf: "1d", mtf: "4h", ltf: "1d" };
  throw new Error(`Multi-class V2 ensemble unsupported ltf: ${ltf as string}`);
}
