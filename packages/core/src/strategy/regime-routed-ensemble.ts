// packages/core/src/strategy/regime-routed-ensemble.ts — Phase 16 Track B
// Regime-Routed Ensemble — ADX-routed composition of the 4 Phase 15 retail
// range/grid/breakout strategies.
//
// Phase 15 Track D's `SimpleRetailEnsemble` fired ALL FOUR sub-strategies on
// every LTF candle regardless of regime, which produced only +4.73%/mo BTC
// (vs. +13-90%/mo for the individual components). The Phase 16 brief's
// hypothesis: the consensus-at-mixed-timeframe composition dilutes signal
// quality because mean-reversion strategies (Pivot Grid, Donchian Range)
// and trend-following strategies (BB Squeeze, Keltner Grid) are
// REGIME-CONDITIONAL — a range-edge should NOT fire in a trending market
// and a breakout-edge should NOT fire in a quiet range.
//
// Regime routing (Wilder 1978 "New Concepts in Technical Trading Systems"):
//
//   regime    ADX(14)         eligible sub-strategies      family
//   range     adx < 20        Pivot Grid + Donchian Range  mean-reversion
//   trend     adx >= 20       BB Squeeze + Keltner Grid    breakout
//
// Aggregation logic (per Phase 16 brief, generalized in Phase 18 Track A):
//
//   - 0 eligible signals                       → return null
//   - < minConsensus eligible signals          → return null (insufficient fire)
//   - ≥ minConsensus eligible signals, conflicting sides
//                                               → return null (defer, conflict)
//   - ≥ minConsensus eligible signals, single side
//                                               → emit highest-confidence winner
//                                                 with reason tagged
//                                                 `[RegimeEnsemble] regime=<regime> consensus=N/2 winner=<sub>`
//                                                 where N = fired.length
//
//   Phase 16 used a hard-coded "2-of-2" tag (consensus=2/2 reason string),
//   but the actual logic was 1-or-2 fire same-side (solo + consensus branches).
//   Phase 18 Track A introduces a configurable `minConsensus` (default 2 =
//   strict 2-of-2, empirically validated to lift BTC from kill-switch to
//   +4.11%/mo). With minConsensus=1 the original solo + consensus behavior
//   is preserved (research only; reproduces the Phase 17 dilution cascade).
//   The conflict-defer rule (different sides → null) is unchanged.
//
// When `mtfState.htf.adx` is `undefined`/`null` the regime cannot be
// determined → return null. This is the same "missing regime signal → defer"
// pattern that `DonchianRangeChannelStrategy` uses internally for its own
// trend filter, hoisted one level up to the ensemble routing layer.
//
// Sizing (1:10) is engine-side — this strategy only emits signals.
//
// References:
//   - Phase 16 scope plan: .mavis/notes/phase16-scope-plan.md §"Track B"
//   - Phase 15 Track D reference: simple-retail-ensemble.ts
//   - Wilder, J. W. (1978) "New Concepts in Technical Trading Systems" —
//     ADX 20/25 trend-strength convention.

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
 * `RegimeRoutedEnsembleConfig` — per-sub-strategy partial configuration
 * plus the ADX threshold that separates "range" from "trend" regimes.
 *
 * `adxRangeThreshold` is the upper bound of the range regime (exclusive):
 *   `adx < adxRangeThreshold` → range regime (mean-reversion eligible)
 *   `adx >= adxRangeThreshold` → trend regime (breakout eligible)
 *
 * Default 20 follows Wilder (1978) §3 — ADX 20 is the conventional
 * transition between "no trend" and "trend present". The Donchian Range
 * Channel uses ADX 25 for ITS OWN internal trend filter; the ensemble's
 * regime routing uses the more conservative 20 threshold (broader trend
 * zone, narrower range zone — i.e. when in doubt, route to breakouts).
 */
export interface RegimeRoutedEnsembleConfig {
  /** ADX upper bound of the range regime (exclusive). Default 20 (Wilder 1978). */
  readonly adxRangeThreshold: number;
  /**
   * Minimum number of same-side eligible sub-strategy signals required to emit.
   *
   * Default `minConsensus=2` (strict 2-of-2) was determined empirically in
   * Phase 18 Track A to lift BTC from the Phase 17 kill-switch (0%/mo) to
   * +4.11%/mo on the fixed engine. Override to 1 for solo-fire mode (research
   * only; reproduces the Phase 17 dilution cascade where a single 26.96%
   * win-rate entry drags equity into the 50% DD kill-switch).
   *
   * Values > the eligible sub-strategy count in a given regime effectively
   * silence that regime (no signal can ever satisfy the threshold).
   */
  readonly minConsensus: number;
  /** Per-sub-strategy partial config — overrides merge over each strategy's DEFAULT_*. */
  readonly pivotGrid: Partial<PivotPointGridConfig>;
  readonly bbSqueeze: Partial<BollingerSqueezeConfig>;
  readonly donchianRange: Partial<DonchianRangeChannelConfig>;
  readonly keltnerGrid: Partial<KeltnerGridConfig>;
}

/**
 * `DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG` — empty-partial sub-configs
 * (each sub-strategy uses its own DEFAULT_*_CONFIG when no override is
 * supplied), the ADX threshold default of 20, and the Phase 18 Track A
 * `minConsensus=2` default (strict 2-of-2 — empirically validated to lift
 * BTC from the Phase 17 kill-switch to a viable positive envelope).
 *
 * Exported for CLI runner convenience and tests.
 */
export const DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG: RegimeRoutedEnsembleConfig = {
  adxRangeThreshold: 20,
  minConsensus: 2,
  pivotGrid: {},
  bbSqueeze: {},
  donchianRange: {},
  keltnerGrid: {},
};

/**
 * `REGIME_ROUTED_ENSEMBLE_DEFAULT_LTF` — the default LTF for the regime
 * ensemble. M15 is selected because 2 of 4 sub-strategies (Pivot Grid +
 * Donchian Range) are natively M15 strategies. BB Squeeze and Keltner
 * Grid (both M5) receive M15-aggregated candles — the engine aggregates
 * LTF → HTF/MTF in `aggregateToTimeframe`, so the higher-frequency
 * strategies still receive a valid 15m OHLCV context.
 */
export const REGIME_ROUTED_ENSEMBLE_DEFAULT_LTF: Timeframe = "15m";

// ---------------------------------------------------------------------------
// Strategy implementation
// ---------------------------------------------------------------------------

/**
 * `RegimeRoutedEnsemble` — Phase 16 Track B composite Strategy.
 *
 * Reads `mtfState.htf.adx` once per candle and routes the call to the
 * regime-appropriate sub-strategy pair. This is structurally different
 * from `SimpleRetailEnsemble` (which always fires all 4 sub-strategies)
 * — the regime gate is the WHOLE POINT of the Phase 16 brief.
 *
 * Sub-strategies are exposed (public `readonly` fields) so the CLI runner
 * can read per-strategy state for the REPORT's regime correlation analysis.
 */
export class RegimeRoutedEnsemble implements Strategy {
  readonly name = "Regime-Routed Ensemble (Phase 16 — ADX-routed Pivot/Donchian + BB/Keltner)";
  readonly timeframes: readonly Timeframe[];
  readonly config: RegimeRoutedEnsembleConfig;
  readonly pivotGrid: PivotPointGridStrategy;
  readonly bbSqueeze: BollingerRangeSqueezeStrategy;
  readonly donchianRange: DonchianRangeChannelStrategy;
  readonly keltnerGrid: KeltnerGridStrategy;

  /**
   * Constructor.
   *
   * @param config Per-sub-strategy partial configuration + the ADX threshold.
   *                Defaults to `DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG`.
   * @param ltf    The LTF the ensemble runs on. Defaults to
   *                `REGIME_ROUTED_ENSEMBLE_DEFAULT_LTF` (M15) since 2 of 4
   *                sub-strategies are M15.
   */
  constructor(
    config: Partial<RegimeRoutedEnsembleConfig> = {},
    ltf: Timeframe = REGIME_ROUTED_ENSEMBLE_DEFAULT_LTF,
  ) {
    // Resolve the config — fill in defaults for any field the caller omitted.
    const resolved: RegimeRoutedEnsembleConfig = {
      adxRangeThreshold:
        config.adxRangeThreshold ?? DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG.adxRangeThreshold,
      minConsensus: config.minConsensus ?? DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG.minConsensus,
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
    // The `timeframes` field is the union of the engine's expected frames
    // for the LTF choice — the same convention as `SimpleRetailEnsemble`.
    this.timeframes = ["1d", "4h", ltf] as const;
  }

  /**
   * `warmup` — the ensemble must be warm before any signal. The warmup is
   * the MAX of all 4 sub-strategy warmups (each sub-strategy is a
   * self-contained Strategy with its own indicator init).
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
   * `onCandle` — reads the HTF ADX, picks the regime-appropriate sub-strategy
   * pair, runs them, and applies the consensus/solo/conflict aggregation
   * logic.
   *
   * Pipeline:
   *   1. Read `mtfState.htf.adx`. If `undefined` or `null` → return null
   *      (regime unknown).
   *   2. Compare against `config.adxRangeThreshold`:
   *        adx <  threshold → range regime (Pivot Grid + Donchian Range)
   *        adx >= threshold → trend regime (BB Squeeze + Keltner Grid)
   *   3. Run the two eligible sub-strategies on the same `ctx`.
   *   4. Apply aggregation:
   *        0 signals                          → null
   *        < minConsensus signals (any side)   → null (insufficient fire)
   *        ≥ minConsensus signals, conflict   → null (defer)
   *        ≥ minConsensus signals, same side  → highest-confidence signal with
   *                                            reason tagged
   *                                            `[RegimeEnsemble] regime=<r> consensus=N/2 winner=<sub>`
   *                                            where N = fired.length
   *
   * With the default `minConsensus=2` (strict 2-of-2), only when both
   * sub-strategies in the active regime agree on side is a signal emitted.
   * Solo fires are silenced (this is the Phase 18 Track A empirical fix —
   * silences the 26.96% win-rate solo diluter that was dragging BTC into
   * the 50% DD kill-switch). Override `minConsensus=1` for solo-fire mode
   * (research only; reproduces the Phase 17 dilution cascade).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    // Step 1 — Regime detection.
    const adx = ctx.mtfState.htf.adx;
    if (adx === undefined) {
      return null;
    }
    const isRangeRegime = adx < this.config.adxRangeThreshold;
    const regime = isRangeRegime ? "range" : "trend";

    // Step 2 — Sub-strategy filtering by regime.
    // Range regime fires only mean-reversion strategies (Pivot + Donchian).
    // Trend regime fires only breakout strategies (BB Squeeze + Keltner).
    const fired: { readonly name: string; readonly signal: StrategySignal }[] = [];
    if (isRangeRegime) {
      const pivotSig = this.pivotGrid.onCandle(ctx);
      if (pivotSig !== null) {
        fired.push({ name: "pivot-grid", signal: pivotSig });
      }
      const donchianSig = this.donchianRange.onCandle(ctx);
      if (donchianSig !== null) {
        fired.push({ name: "donchian-range", signal: donchianSig });
      }
    } else {
      const bbSig = this.bbSqueeze.onCandle(ctx);
      if (bbSig !== null) {
        fired.push({ name: "bb-squeeze", signal: bbSig });
      }
      const keltnerSig = this.keltnerGrid.onCandle(ctx);
      if (keltnerSig !== null) {
        fired.push({ name: "keltner-grid", signal: keltnerSig });
      }
    }

    // Step 3 — No eligible signals fire.
    if (fired.length === 0) {
      return null;
    }

    // Step 4 — Insufficient fire: fewer same-direction signals than
    // minConsensus. Phase 18 Track A: with default minConsensus=1, this
    // branch is dead (fired.length is always >= 1 after the Step 3 check);
    // it is reachable when minConsensus >= 2.
    if (fired.length < this.config.minConsensus) {
      return null;
    }

    // Step 5 — Conflict detection: different sides → defer.
    const sides = new Set(fired.map((entry) => entry.signal.side));
    if (sides.size > 1) {
      return null;
    }

    // Step 6 — Sufficient same-direction signals → emit highest-confidence.
    const sorted = [...fired].sort((a, b) => b.signal.confidence - a.signal.confidence);
    const winner = sorted[0]!;
    return {
      ...winner.signal,
      reason: `[RegimeEnsemble] regime=${regime} consensus=${fired.length}/2 winner=${winner.name} (conf=${winner.signal.confidence.toFixed(2)}) | ${winner.signal.reason}`,
    };
  }
}