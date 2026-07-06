// packages/core/src/strategy/simple-retail-ensemble.ts — Simple Retail Ensemble
//
// Phase 15 Track D — Composes the 4 Phase 15 retail range/grid/breakout
// strategies into a single ensemble that emits signals only when sub-strategies
// AGREE (or one fires alone).
//
// Components (4 mid-frequency retail strategies — all mean-reversion / range
// family):
//   1. PivotPointGridStrategy (Track B, M15) — pivot-anchored mean-reversion grid
//      using daily PP/S1/S2/R1/R2/R3 levels.
//   2. BollingerRangeSqueezeStrategy (Track B, M5) — bbWidth squeeze detection
//      + breakout expansion trade.
//   3. DonchianRangeChannelStrategy (Track C, M15) — pure range channel:
//      buy at DonchianLower, sell at DonchianUpper (skip if ADX > 25).
//   4. KeltnerGridStrategy (Track C, M5) — volatility-adaptive Keltner-channel
//      grid (EMA20 ± 1.5×ATR, 5 grid levels).
//
// Aggregation logic (per Phase 15 brief):
//
//   - On each LTF candle, run all 4 sub-strategies (sub.onCandle(ctx)).
//   - If 0 signals fire → ensemble returns null (no signal).
//   - If all fired signals agree on direction (all "buy" or all "sell") →
//     emit the HIGHEST-CONFIDENCE signal, with reason tagged
//     `[Ensemble] consensus=N/4`.
//   - If signals conflict (e.g., both "buy" and "sell" fire) → emit null
//     (defer; the ensemble does NOT take contradictory positions).
//   - If only ONE sub-strategy fires → emit that signal with reason tagged
//     `[Ensemble] solo=<strategy-name>` (the strategy does not require
//     unanimity — a single high-conviction signal is actionable).
//
// The LTF parameter selects the ensemble's native timeframe. Pivot and
// Donchian are M15 strategies, BB Squeeze and Keltner Grid are M5 strategies.
// When LTF = M15, BB Squeeze and Keltner Grid receive M15-aggregated candles
// (the engine aggregates LTF → HTF/MTF in `aggregateToTimeframe`); this is
// acceptable for the ensemble-level diagnostic backtest since each sub-strategy
// still receives a valid 15m OHLCV context. When LTF = M5, Pivot and Donchian
// receive M5 candles — they may produce fewer signals (M5 is noisier), but
// the path is supported for testability.
//
// References:
//   - Phase 15 scope plan: docs/.mavis/notes/phase15-scope-plan.md §"Track D"
//   - Phase 5 Composite (composite.ts) — 2-component precedent for trend
//     filtering + agreement boost.
//   - Phase 6 MultiClassEnsemble (multi-class-ensemble.ts) — 4-component
//     precedent with state-tracking. Note: this ensemble is simpler and uses
//     the Phase 15 brief's consensus/solo vocabulary.

import type { Timeframe } from "@mm-crypto-bot/shared/types";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";
import {
  PivotPointGridStrategy,
  type PivotPointGridConfig,
  DEFAULT_PIVOT_GRID_CONFIG,
} from "./pivot-point-grid.js";
import {
  BollingerRangeSqueezeStrategy,
  type BollingerSqueezeConfig,
  DEFAULT_BB_SQUEEZE_CONFIG,
} from "./bollinger-range-squeeze.js";
import {
  DonchianRangeChannelStrategy,
  type DonchianRangeChannelConfig,
  DEFAULT_DONCHIAN_RANGE_CONFIG,
} from "./donchian-range-channel.js";
import {
  KeltnerGridStrategy,
  type KeltnerGridConfig,
  DEFAULT_KELTNER_GRID_CONFIG,
} from "./keltner-grid.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * `SimpleRetailEnsembleConfig` — per-sub-strategy partial configuration. Each
 * sub-strategy has its own config blob (in the @mm-crypto-bot/core` strategy's
 * own naming convention) — the ensemble constructs each sub-strategy from its
 * respective partial config.
 *
 * Defaults are applied per-component (the ensemble uses each strategy's
 * `DEFAULT_*` constant when no override is supplied).
 */
export interface SimpleRetailEnsembleConfig {
  readonly pivotGrid: Partial<PivotPointGridConfig>;
  readonly bbSqueeze: Partial<BollingerSqueezeConfig>;
  readonly donchianRange: Partial<DonchianRangeChannelConfig>;
  readonly keltnerGrid: Partial<KeltnerGridConfig>;
}

/**
 * `DEFAULT_SIMPLE_RETAIL_ENSEMBLE_CONFIG` — empty-partial defaults. Each
 * sub-strategy receives `{}` and applies its own DEFAULT_*_* constant.
 *
 * Exported for CLI runner convenience and tests.
 */
export const DEFAULT_SIMPLE_RETAIL_ENSEMBLE_CONFIG: SimpleRetailEnsembleConfig = {
  pivotGrid: {},
  bbSqueeze: {},
  donchianRange: {},
  keltnerGrid: {},
};

/**
 * `ENSEMBLE_DEFAULT_LTF` — the default LTF for the simple retail ensemble.
 * M15 is selected because 2 of 4 strategies (Pivot Grid + Donchian Range) are
 * natively M15 strategies. BB Squeeze and Keltner Grid operate on aggregated
 * M15 candles (acceptable for the ensemble-level diagnostic — see file-level
 * JSDoc above).
 */
export const ENSEMBLE_DEFAULT_LTF: Timeframe = "15m";

// ---------------------------------------------------------------------------
// Strategy implementation
// ---------------------------------------------------------------------------

/**
 * `SimpleRetailEnsemble` — Phase 15 Track D composite Strategy. Composes
 * Pivot Grid + BB Squeeze + Donchian Range + Keltner Grid.
 *
 * The ensemble is INTENTIONALLY simple — the Phase 15 brief specifies
 * consensus-or-solo aggregation, not the trend-filter + agreement boost
 * mechanics of Phase 5 Composite or the multi-edge state-tracking of
 * Phase 6 MultiClassEnsemble. This is a DIAGNOSTIC tool to measure Phase 15
 * range-strategy composition (the Phase 16+ portfolio variant may layer in
 * the Phase 7-11.1 signal center for sizing + risk overlays).
 *
 * The `name` and `timeframes` fields must satisfy the Strategy interface.
 *
 * Sub-strategies are exposed (public `readonly` fields) so the CLI runner
 * can read per-strategy state for the REPORT's regime correlation analysis.
 */
export class SimpleRetailEnsemble implements Strategy {
  readonly name =
    "Simple Retail Ensemble (Phase 15 — Pivot + BB Squeeze + Donchian Range + Keltner Grid)";
  readonly timeframes: readonly Timeframe[];
  readonly config: SimpleRetailEnsembleConfig;
  readonly pivotGrid: PivotPointGridStrategy;
  readonly bbSqueeze: BollingerRangeSqueezeStrategy;
  readonly donchianRange: DonchianRangeChannelStrategy;
  readonly keltnerGrid: KeltnerGridStrategy;

  /**
   * Constructor.
   *
   * @param config Per-sub-strategy partial configuration. Each sub-strategy
   *                uses its own DEFAULT_*_* constant when no override is
   *                supplied. Defaults to `DEFAULT_SIMPLE_RETAIL_ENSEMBLE_CONFIG`.
   * @param ltf    The LTF the ensemble runs on. Defaults to `ENSEMBLE_DEFAULT_LTF`
   *                (M15) since 2 of 4 sub-strategies are M15.
   */
  constructor(
    config: Partial<SimpleRetailEnsembleConfig> = {},
    ltf: Timeframe = ENSEMBLE_DEFAULT_LTF,
  ) {
    // Resolve the config — support per-sub-strategy partial overrides by
    // filling in defaults for any field the caller omitted.
    const resolved: SimpleRetailEnsembleConfig = {
      pivotGrid: { ...DEFAULT_PIVOT_GRID_CONFIG, ...(config.pivotGrid ?? {}) },
      bbSqueeze: { ...DEFAULT_BB_SQUEEZE_CONFIG, ...(config.bbSqueeze ?? {}) },
      donchianRange: { ...DEFAULT_DONCHIAN_RANGE_CONFIG, ...(config.donchianRange ?? {}) },
      keltnerGrid: { ...DEFAULT_KELTNER_GRID_CONFIG, ...(config.keltnerGrid ?? {}) },
    };
    this.config = resolved;
    this.pivotGrid = new PivotPointGridStrategy(resolved.pivotGrid);
    this.bbSqueeze = new BollingerRangeSqueezeStrategy(resolved.bbSqueeze);
    this.donchianRange = new DonchianRangeChannelStrategy(resolved.donchianRange);
    this.keltnerGrid = new KeltnerGridStrategy(resolved.keltnerGrid);
    // The ensemble is MTF-agnostic at the type level — each sub-strategy
    // owns its own HTF/MTF/LTF config. The `timeframes` field is computed
    // from the LTF argument (it's the only timeframe the engine explicitly
    // passes on `onCandle`).
    this.timeframes = ["1d", "4h", ltf] as const;
  }

  /**
   * `warmup` — the ensemble must be warm before any signal. The warmup is
   * the MAX of all 4 sub-strategy warmups (each sub-strategy is a
   * self-contained Strategy with its own indicator init). Returns the same
   * value to the backtest engine which checks `candleIndex >= warmup()`.
   */
  warmup(): number {
    return Math.max(
      this.pivotGrid.warmup(),
      this.bbSqueeze.warmup(),
      this.donchianRange.warmup(),
      this.keltnerGrid.warmup(),
    );
  }

  /**
   * `onCandle` — runs all 4 sub-strategies on the LTF candle and applies
   * the consensus/solo aggregation logic.
   *
   * Pipeline:
   *   1. Run all 4 sub-strategies via `sub.onCandle(ctx)`.
   *   2. Filter to non-null signals only.
   *   3. If 0 fire → return null.
   *   4. Determine the dominant side: long vs short.
   *      - If both long and short signals fire → conflict → return null.
   *   5. If 1 signal fires → return that signal with reason
   *      `[Ensemble] solo=<strategy-name>`.
   *   6. If N ≥ 2 signals agree on the same side → return the highest-confidence
   *      signal with reason tagged `[Ensemble] consensus=N/4 | sub-strategies=...`.
   *
   * Stop-loss / take-profit: the highest-confidence signal wins; the engine
   * applies its own cost-model + SL/TP evaluation. The ensemble does not
   * average or blend SL/TP across strategies (would require a sizing layer
   * not in scope for Phase 15 Track D).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    // Step 1 — Run all 4 sub-strategies on the same ctx.
    const pivotSig = this.pivotGrid.onCandle(ctx);
    const bbSig = this.bbSqueeze.onCandle(ctx);
    const donchianSig = this.donchianRange.onCandle(ctx);
    const keltnerSig = this.keltnerGrid.onCandle(ctx);
    const signals: readonly { readonly name: string; readonly signal: StrategySignal | null }[] = [
      { name: "pivot-grid", signal: pivotSig },
      { name: "bb-squeeze", signal: bbSig },
      { name: "donchian-range", signal: donchianSig },
      { name: "keltner-grid", signal: keltnerSig },
    ];

    // Step 2 — Filter non-null signals.
    const fired = signals.filter((entry): entry is { readonly name: string; readonly signal: StrategySignal } =>
      entry.signal !== null,
    );

    // Step 3 — No signal fires.
    if (fired.length === 0) {
      return null;
    }

    // Step 4 — Conflict detection: both long and short signals fire → defer.
    const hasLong = fired.some((entry) => entry.signal.side === "buy");
    const hasShort = fired.some((entry) => entry.signal.side === "sell");
    if (hasLong && hasShort) {
      return null;
    }

    // Step 5 — Single signal → emit directly with solo tag.
    if (fired.length === 1) {
      const only = fired[0]!;
      return {
        ...only.signal,
        reason: `[Ensemble] solo=${only.name} | ${only.signal.reason}`,
      };
    }

    // Step 6 — Multi-signal consensus → emit highest-confidence signal.
    const sorted = [...fired].sort((a, b) => b.signal.confidence - a.signal.confidence);
    const winner = sorted[0]!;
    const strategyNames = fired.map((entry) => entry.name).sort().join(",");
    return {
      ...winner.signal,
      reason: `[Ensemble] consensus=${fired.length}/4 | sub-strategies=${strategyNames} | winner=${winner.name} (conf=${winner.signal.confidence.toFixed(2)}) | ${winner.signal.reason}`,
    };
  }
}
