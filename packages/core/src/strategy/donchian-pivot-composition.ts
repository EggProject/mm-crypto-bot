// packages/core/src/strategy/donchian-pivot-composition.ts — Phase 18 Track B
// Donchian + Pivot 2-component composition.
//
// ===========================================================================
// DONCHIAN + PIVOT 2-COMPONENT COMPOSITION
// ===========================================================================
//
// Purpose
// -------
// Phase 18 Track B's lesson from Phase 15 §10: the 4-strategy
// `SimpleRetailEnsemble` dilutes signal quality because it fires every
// sub-strategy on every candle. Phase 16 `RegimeRoutedEnsemble` added
// ADX-based regime routing, but still includes the noisy M5 BB Squeeze
// and Keltner Grid components (proven net-destructive on ETH/SOL in
// Phase 15). This composition ISOLATES the two best M15-native
// mean-reversion sub-strategies — Donchian Range Channel and Pivot Point
// Grid — and emits only when a configurable `minConsensus` of sub-strategies
// agree.
//
// Why these two sub-strategies?
// ------------------------------
//   - Both are M15-native (no M5 aggregation dilution — the issue that
//     broke Phase 15 BB Squeeze / Keltner Grid composition on ETH/SOL).
//   - Both are mean-reversion family, but the ORTHOGONAL signal sources
//     capture different regimes:
//       * Donchian Range Channel = 1d Donchian(20) range extremes
//         (low-frequency, high-quality, ADX 25 trend filter).
//       * Pivot Point Grid      = previous-day Fibonacci pivot bands
//         (higher-frequency, mean-reversion stack at S2/R2 + S1/R1).
//   - Phase 15 empirical envelopes: BTC Donchian +13.35%/mo, Pivot uncapped
//     +60.07%/mo (Phase 15 §5+§3). The two are 0.5-0.6 correlated but
//     their disagreement is informative (different regime windows).
//
// Aggregation logic (per Phase 18 Track B brief):
//
//   - Run both sub-strategies via `sub.onCandle(ctx)`.
//   - Count `fired = number of non-null signals`.
//   - If `fired < minConsensus` → return null (no signal).
//   - If `fired >= minConsensus` AND all fired signals agree on side → emit
//     consensus signal with the merged fields described below.
//   - If `fired >= minConsensus` AND fired signals DISAGREE on side → return
//     null (defer; the composition does NOT take contradictory positions).
//
//   Default `minConsensus = 2` (both must fire). Override to 1 if both
//   fire-rates prove too low (e.g. ADX trend regime suppresses Donchian
//   while Pivot still fires at S2/R2 — the rare regime where 1-of-2 lifts
//   trade count without adding low-quality signals).
//
// Consensus signal fields (when fired >= minConsensus AND all agree):
//
//   - `side`        = the agreed side (both sub-strategies are
//                      mean-reversion; conflict → defer).
//   - `confidence`  = arithmetic mean of sub-strategy confidences
//                      (e.g. 0.5 + 0.7 = 0.6 mean).
//   - `stopLoss`    = the TIGHTER of the two sub-strategy stops — for
//                      LONG: max(stops) (closer to entry = higher number);
//                      for SHORT: min(stops) (closer to entry = lower
//                      number). Both sub-strategies are mean-reversion so
//                      their stops should be on the same side of entry
//                      (both below for long, both above for short).
//   - `takeProfit`  = the AVERAGE of the two sub-strategy take-profits
//                      (Pivot targets PP, Donchian targets the opposite
//                      Donchian rail — averaging these gives a mid-point
//                      that is well-defined and in the same direction as
//                      entry).
//   - `reason`      = `[DonchianPivot] consensus=N/2 winner=... | <sub reason>`
//                      where `winner` is the sub-strategy with higher
//                      confidence (for downstream debug).
//
//   The emitted signal's `confidence` already incorporates Pivot Grid's
//   Phase 16 `maxPositionPctEquity` productionization cap (the Pivot
//   sub-strategy scales its raw confidence by `capScale` before the
//   composition reads it), so the composition's `mean(confidences)` is
//   already at the engine's per-trade cap.
//
// Sizing (1:10) is engine-side — this strategy only emits signals.
//
// References:
//   - Phase 15 §5 (Donchian Range Channel), §3 (Pivot Point Grid),
//     §10 (ensemble dilution lesson).
//   - Phase 16 Track A `maxPositionPctEquity` cap pattern — Pivot's
//     cap-scaled confidence is honored through the composition's mean.

import type { Timeframe } from "@mm-crypto-bot/shared/types";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";
import {
  DonchianRangeChannelStrategy,
  type DonchianRangeChannelConfig,
  DEFAULT_DONCHIAN_RANGE_CONFIG,
} from "./donchian-range-channel.js";
import {
  PivotPointGridStrategy,
  type PivotPointGridConfig,
  DEFAULT_PIVOT_GRID_CONFIG,
} from "./pivot-point-grid.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * `DonchianPivotCompositionConfig` — per-sub-strategy partial configuration
 * plus the `minConsensus` threshold that controls when the composition
 * emits a signal.
 *
 * `minConsensus` is the minimum number of sub-strategies that must fire
 * (non-null) for the composition to emit. Range: 1..2. Default 2 (both
 * sub-strategies must fire). Override to 1 if both fire-rates prove too
 * low (the rare regime where ADX suppresses Donchian while Pivot still
 * fires at S2/R2 — 1-of-2 lifts trade count without adding low-quality
 * signals).
 */
export interface DonchianPivotCompositionConfig {
  /**
   * Minimum number of sub-strategies that must fire for the composition
   * to emit. Default 2 (both must fire). Range: 1..2.
   */
  readonly minConsensus: number;
  /** Per-sub-strategy partial config — Donchian Range Channel overrides. */
  readonly donchianRange: Partial<DonchianRangeChannelConfig>;
  /** Per-sub-strategy partial config — Pivot Point Grid overrides. */
  readonly pivotGrid: Partial<PivotPointGridConfig>;
}

/**
 * `DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG` — `minConsensus = 2` (both
 * sub-strategies must fire) with empty-partial sub-configs. Each
 * sub-strategy receives `{}` and applies its own DEFAULT_*_CONFIG.
 *
 * Exported for CLI runner convenience and tests.
 */
export const DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG: DonchianPivotCompositionConfig = {
  minConsensus: 2,
  donchianRange: {},
  pivotGrid: {},
};

/**
 * `DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF` — the default LTF for the
 * composition. M15 is selected because both sub-strategies are M15-native
 * (no M5 aggregation dilution). The engine's `aggregateToTimeframe`
 * produces M15 OHLCV from M5 source candles — the composition's M15
 * signals fire on the same engine-aggregated candles as the sub-strategies
 * in their standalone baselines.
 */
export const DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF: Timeframe = "15m";

// ---------------------------------------------------------------------------
// Strategy implementation
// ---------------------------------------------------------------------------

/**
 * `DonchianPivotComposition` — Phase 18 Track B composite Strategy.
 *
 * Composes only the two best M15-native mean-reversion sub-strategies
 * (Donchian Range Channel + Pivot Point Grid) with a configurable
 * `minConsensus` threshold. This composition is the second of two Phase
 * 18 candidates that test "regime-routed, not consensus-at-N" composition
 * (Phase 18 §2 motivation; Phase 15 §10 lesson).
 *
 * Sub-strategies are exposed (public `readonly` fields) so the CLI runner
 * can read per-strategy state for the REPORT's regime correlation analysis.
 */
export class DonchianPivotComposition implements Strategy {
  readonly name =
    "Donchian + Pivot Composition (Phase 18 — 2-component M15-native mean-reversion)";
  readonly timeframes: readonly Timeframe[];
  readonly config: DonchianPivotCompositionConfig;
  readonly donchianRange: DonchianRangeChannelStrategy;
  readonly pivotGrid: PivotPointGridStrategy;

  /**
   * Constructor.
   *
   * @param config Per-sub-strategy partial configuration + `minConsensus`.
   *                Defaults to `DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG`.
   * @param ltf    The LTF the composition runs on. Defaults to
   *                `DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF` (M15) since
   *                both sub-strategies are M15-native.
   */
  constructor(
    config: Partial<DonchianPivotCompositionConfig> = {},
    ltf: Timeframe = DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF,
  ) {
    // Resolve the config — fill in defaults for any field the caller omitted.
    // `minConsensus` is REQUIRED at the type level (no `undefined`), so we
    // default it to 2 when the caller does not provide the config object.
    const resolved: DonchianPivotCompositionConfig = {
      minConsensus:
        config.minConsensus ?? DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG.minConsensus,
      donchianRange: { ...DEFAULT_DONCHIAN_RANGE_CONFIG, ...(config.donchianRange ?? {}) },
      pivotGrid: { ...DEFAULT_PIVOT_GRID_CONFIG, ...(config.pivotGrid ?? {}) },
    };
    // Validate `minConsensus` is in the supported range (1..2). Anything
    // outside this range is undefined behavior (we only have 2 sub-strategies).
    if (!Number.isInteger(resolved.minConsensus) || resolved.minConsensus < 1 || resolved.minConsensus > 2) {
      throw new RangeError(
        `DonchianPivotComposition: minConsensus must be an integer in [1, 2], got ${resolved.minConsensus}`,
      );
    }
    this.config = resolved;
    this.donchianRange = new DonchianRangeChannelStrategy(resolved.donchianRange);
    this.pivotGrid = new PivotPointGridStrategy(resolved.pivotGrid);
    // The `timeframes` field is the union of the engine's expected frames
    // for the LTF choice — the same convention as `SimpleRetailEnsemble`
    // and `RegimeRoutedEnsemble`.
    this.timeframes = ["1d", "4h", ltf] as const;
  }

  /**
   * `warmup` — the composition must be warm before any signal. The warmup
   * is the MAX of the 2 sub-strategy warmups (each sub-strategy is a
   * self-contained Strategy with its own indicator init). Pivot Grid
   * requires 100 LTF candles (1 day of M15 + buffer for the first HTF
   * commit); Donchian Range requires 30 LTF candles. The composition's
   * warmup is 100.
   */
  warmup(): number {
    return Math.max(this.donchianRange.warmup(), this.pivotGrid.warmup());
  }

  /**
   * `onCandle` — runs both sub-strategies on the LTF candle and applies
   * the consensus (or solo) aggregation logic.
   *
   * Pipeline:
   *   1. Run both sub-strategies via `sub.onCandle(ctx)`.
   *   2. Count non-null signals (`firedCount`).
   *   3. If `firedCount < minConsensus` → return null.
   *   4. If fired signals disagree on side → return null (defer).
   *   5. Compute the consensus signal:
   *        side        = agreed side
   *        confidence  = mean of sub-strategy confidences
   *        stopLoss    = tighter stop (max for long, min for short)
   *        takeProfit  = mean of sub-strategy take-profits
   *        reason      = `[DonchianPivot] consensus=N/2 winner=... | <reason>`
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    // Step 1 — Run both sub-strategies on the same ctx.
    const donchianSig = this.donchianRange.onCandle(ctx);
    const pivotSig = this.pivotGrid.onCandle(ctx);

    // Step 2 — Build the list of non-null signals (in canonical order:
    // Donchian first, Pivot second — preserves deterministic iteration
    // for debug + tests).
    const fired: { readonly name: string; readonly signal: StrategySignal }[] = [];
    if (donchianSig !== null) {
      fired.push({ name: "donchian-range", signal: donchianSig });
    }
    if (pivotSig !== null) {
      fired.push({ name: "pivot-grid", signal: pivotSig });
    }

    // Step 3 — Consensus gate.
    if (fired.length < this.config.minConsensus) {
      return null;
    }

    // Step 4 — Side-conflict gate. Both sub-strategies are mean-reversion
    // family, but they may disagree on side when the candle closes near
    // a Pivot band on one side and a Donchian rail on the other (e.g.
    // close ≤ S2 → Pivot says buy, close ≥ DonchianUpper → Donchian
    // says sell). When they disagree, defer (the composition does NOT
    // take contradictory positions).
    const sides = new Set(fired.map((entry) => entry.signal.side));
    if (sides.size > 1) {
      return null;
    }

    // Step 5 — Compute the consensus signal. At this point all fired
    // signals agree on side AND `fired.length >= minConsensus`. The
    // canonical sub-strategy is the one with the highest confidence
    // (Pivot's confidence is already Phase 16 cap-scaled).
    const sorted = [...fired].sort((a, b) => b.signal.confidence - a.signal.confidence);
    const winner = sorted[0]!;
    const side = winner.signal.side;
    const meanConfidence =
      fired.reduce((sum, entry) => sum + entry.signal.confidence, 0) / fired.length;
    const meanTakeProfit =
      fired.reduce((sum, entry) => sum + entry.signal.takeProfit, 0) / fired.length;
    // Tighter stop wins — for LONG (stop below entry), tighter = higher
    // stopLoss number (closer to entry). For SHORT (stop above entry),
    // tighter = lower stopLoss number. Use `min` for short, `max` for long.
    const stopLosses = fired.map((entry) => entry.signal.stopLoss);
    const tighterStop =
      side === "buy" ? Math.max(...stopLosses) : Math.min(...stopLosses);

    // Round take-profit to pricePrecision. The composition does not own
    // pricePrecision (it lives on `ctx`), so we forward it through
    // `ctx.pricePrecision`. `stopLoss` is already rounded by each
    // sub-strategy via `roundTo` (Donchian uses `roundTo` for SL/TP;
    // Pivot uses `roundTo` for SL/TP).
    const takeProfit = Number(meanTakeProfit.toFixed(ctx.pricePrecision));

    return {
      side,
      confidence: meanConfidence,
      reason: `[DonchianPivot] consensus=${fired.length}/2 winner=${winner.name} (conf=${winner.signal.confidence.toFixed(2)}) | ${winner.signal.reason}`,
      stopLoss: tighterStop,
      takeProfit,
    };
  }
}
