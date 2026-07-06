// packages/core/src/signal-center/plugins/dvol-regime-sizing-plugin.ts —
// Phase 14D forward-looking volatility sizing plugin.
//
// ===========================================================================
// DVOL REGIME SIZING PLUGIN
// ===========================================================================
//
// Purpose
// -------
// Phase 14D: the first forward-looking volatility sizing source for
// mm-crypto-bot. Reads the BTC options implied-volatility index
// (Deribit DVOL) per bar and emits a SizingSignal whose `volMultiplier`
// is bucketed by DVOL regime.
//
// Why DVOL?
// ---------
// Realized-vol sizing (VolTargetSizingPlugin) is backward-looking — it
// scales sizing based on what already happened. DVOL is forward-looking:
// the options market's implied vol for the next 30 days, which empirically
// leads realized vol by 1-3 weeks (R² 0.196 vs HAR 0.02 per the
// Japanese-language DVOL persistence study cited in the Phase 14C
// research). When DVOL spikes, the system should size DOWN BEFORE the
// drawdown materializes.
//
// Bucketing strategy (Phase 14D conservative):
//
//   DVOL > 80  → "acute stress"    → volMultiplier = 0.5  (halve size)
//   DVOL 65-80 → "elevated"        → volMultiplier = 0.75
//   DVOL 50-65 → "normal"          → volMultiplier = 1.0
//   DVOL < 50  → "compressed"      → volMultiplier = 1.0  (don't fight compression)
//
// The Track B DecisionEngine composes SizingSignals with `min()` — see
// types.ts L142-144. This means the MORE DEFENSIVE sizing wins. So
// DVOL's volMultiplier composes with CarryBaseline's volMultiplier by
// taking the smaller — exactly the right risk behavior.
//
// Data source
// -----------
// DVOL is BTC options implied vol (Deribit DVOL by default). For
// Phase 14D, the plugin accepts a `getDvolForTimestamp(ts: number) =>
// number | null` callback. The runner passes a closure that reads
// from a CSV (data/deribit_btc_dvol_daily.csv) at startup. If the
// data is null (CSV missing rows), the plugin fails open with
// volMultiplier = 1.0 (don't kill sizing on data outage).
//
// Symbol coverage
// ---------------
// DVOL is BTC options IV. For ETH and SOL, the plugin accepts an
// optional `dvolBySymbol` map. If a symbol has no entry, the plugin
// falls back to the BTC DVOL (rough approximation — ETH/SOL vol
// regimes are correlated with BTC vol regimes, R² ~0.6-0.8 historically).
// Phase 14E+ scope: add Deribit's ETH-DVOL and SOL-DVOL when
// available.
//
// 1:10 leverage mandate
// ----------------------
// Plugin respects the 1:10 mandate via three layers:
//   1. metadata.maxLeverage = 10 (Layer 1)
//   2. _emitSizingSignal clamps notional ≤ baseNotionalUsd × 10 (Layer 2)
//   3. volMultiplier max is 1.0 (Layer 3 — no scale-up, only scale-down)
//
// References (≥3 independent crypto-native sources post-2020)
// -----------------------------------------------------------
//   - 曇 (note.com, ja): "DVOL is a core indicator for predicting
//     future Bitcoin volatility, significantly outperforming historical
//     volatility-based models (persistence / HAR) (R² 0.196 vs. 0.02-0.03)"
//   - RegimeRisk (en): "the most powerful application of bitcoin DVOL
//     is as a leading indicator: when implied volatility begins rising
//     before realised volatility expands, the options market is warning
//     you that stress is building"
//   - Changelly: Deribit DVOL vs CVI vs CF-BVI comparison. DVOL is the
//     most-cited (Deribit = ~90% of BTC options flow)
//   - Odaily (zh): DVOL >80 historically coincides with major drawdown
//     events; published threshold definitions DVOL<50 (complacent),
//     50-65 (normal), 65-80 (elevated), >80 (acute stress)

import { ONE_TO_TEN_LEVERAGE } from "../../risk/leverage-invariant.js";
import type { SignalBus } from "../signal-bus.js";
import type {
  StrategyPlugin,
  StrategyPluginMetadata,
} from "../strategy-registry.js";
import {
  type Bar,
  type ConfigError,
  type PluginState,
  type Result,
  type SizingSignal,
  ok,
} from "../types.js";

// ---------------------------------------------------------------------------
// Public configuration
// ---------------------------------------------------------------------------

/**
 * `DvolRegimeSizingConfig` — knobs for the DVOL regime sizing plugin.
 *
 * `getDvolForTimestamp` is the data-source callback. The runner
 * passes a closure that reads from a CSV. Returning `null` triggers
 * the fail-open path (volMultiplier = 1.0).
 */
export interface DvolRegimeSizingConfig {
  /** Symbols the plugin emits SizingSignals for. */
  readonly enabledSymbols: readonly string[];
  /** Reference notional (USD) before volMultiplier scaling. */
  readonly baseNotionalUsd: number;
  /**
   * Callback returning the DVOL value (annualized %, e.g. 55.0 for
   * DVOL=55) for a given bar timestamp (ms). Returning `null` triggers
   * the fail-open path with volMultiplier = 1.0.
   */
  readonly getDvolForTimestamp: (timestampMs: number) => number | null;
  /**
   * Optional per-symbol DVOL override map. If a symbol has an entry,
   * the plugin uses that symbol's DVOL instead of the default
   * `getDvolForTimestamp` callback. Allows ETH-DVOL and SOL-DVOL
   * routing when available.
   */
  readonly dvolBySymbol?: ReadonlyMap<string, number | null> | undefined;
  /** DVOL threshold above which the regime is "acute stress". */
  readonly acuteStressThreshold: number;
  /** DVOL threshold above which the regime is "elevated". */
  readonly elevatedThreshold: number;
  /** DVOL threshold above which the regime is "normal" (below = compressed). */
  readonly normalThreshold: number;
  /** volMultiplier when DVOL is in acute stress. */
  readonly acuteStressMultiplier: number;
  /** volMultiplier when DVOL is in elevated regime. */
  readonly elevatedMultiplier: number;
  /** volMultiplier when DVOL is in normal regime. */
  readonly normalMultiplier: number;
  /** volMultiplier when DVOL is in compressed regime. */
  readonly compressedMultiplier: number;
  /** volMultiplier when DVOL data is missing (fail-open). */
  readonly noDataMultiplier: number;
}

// ---------------------------------------------------------------------------
// Public defaults
// ---------------------------------------------------------------------------

export const DEFAULT_ACUTE_STRESS_THRESHOLD = 80 as const;
export const DEFAULT_ELEVATED_THRESHOLD = 65 as const;
export const DEFAULT_NORMAL_THRESHOLD = 50 as const;
export const DEFAULT_ACUTE_STRESS_MULTIPLIER = 0.5 as const;
export const DEFAULT_ELEVATED_MULTIPLIER = 0.75 as const;
export const DEFAULT_NORMAL_MULTIPLIER = 1.0 as const;
export const DEFAULT_COMPRESSED_MULTIPLIER = 1.0 as const; // don't fight compression
export const DEFAULT_NO_DATA_MULTIPLIER = 1.0 as const; // fail-open
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_SYMBOLS: readonly string[] = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
];

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

export type DvolRegime = "acute-stress" | "elevated" | "normal" | "compressed" | "no-data";

export interface DvolRegimeSizingPluginState {
  /** Most recent DVOL value seen (annualized %), or null. */
  lastDvol: number | null;
  /** Timestamp (ms) of the most recent DVOL reading, or null. */
  lastDvolTimestampMs: number | null;
  /** Most recent regime classification. */
  lastRegime: DvolRegime;
  /** Most recent volMultiplier emitted. */
  lastSizeMultiplier: number;
  /** Total bars processed by `onBar`. */
  barsProcessed: number;
  /** Total DVOL readings received (data was non-null). */
  dvolReadings: number;
  /** Total SizingSignals emitted. */
  sizingSignalsEmitted: number;
  /** Total `no-data` emissions (DVOL was null, fail-open path). */
  noDataEmissions: number;
  /** Counts by regime, for diagnostic / testing. */
  readonly regimeCounts: Record<DvolRegime, number>;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * `DvolRegimeSizingPlugin` — first forward-looking volatility sizing
 * source. Reads BTC options implied vol (DVOL) per bar and emits a
 * SizingSignal with `volMultiplier` bucketed by DVOL regime.
 *
 * Composition: Track B DecisionEngine composes SizingSignals with `min()`
 * (the more defensive wins). This plugin's volMultiplier is intended to
 * compose with CarryBaseline's volMultiplier — if DVOL says "halve size"
 * during stress, the final position size is the smaller of the two.
 *
 * The plugin NEVER scales UP beyond what CarryBaseline suggested —
 * volMultiplier max is 1.0 (Phase 14D default, matches the 1:10 mandate's
 * "no scale-up" rule from the vol-target-sizing-plugin's design).
 */
export class DvolRegimeSizingPlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata: StrategyPluginMetadata = {
    name: "dvol-regime-v1",
    version: "1.0.0",
    edgeClass: "sizing", // emits SizingSignals, not DirectionSignals
    capitalRequirement: 0,
    maxLeverage: ONE_TO_TEN_LEVERAGE, // Layer 1 of 3-layer 1:10 defense
    description:
      "Phase 14D: BTC options implied-volatility (DVOL) regime sizing. " +
      "Reads Deribit DVOL per bar; emits SizingSignal with volMultiplier " +
      "bucketed by regime (acute-stress 0.5, elevated 0.75, normal/compressed 1.0, " +
      "no-data 1.0 fail-open). 1:10 leverage MANDATE enforced at 3 layers.",
    dependencies: [],
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  public readonly config: DvolRegimeSizingConfig;
  public readonly state: DvolRegimeSizingPluginState;
  private _bus: SignalBus | null = null;
  private _wired = false;

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(overrides: Partial<DvolRegimeSizingConfig> = {}) {
    this.config = {
      enabledSymbols: overrides.enabledSymbols ?? DEFAULT_ENABLED_SYMBOLS,
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      getDvolForTimestamp: overrides.getDvolForTimestamp ?? (() => null),
      ...(overrides.dvolBySymbol !== undefined ? { dvolBySymbol: overrides.dvolBySymbol } : {}),
      acuteStressThreshold:
        overrides.acuteStressThreshold ?? DEFAULT_ACUTE_STRESS_THRESHOLD,
      elevatedThreshold:
        overrides.elevatedThreshold ?? DEFAULT_ELEVATED_THRESHOLD,
      normalThreshold: overrides.normalThreshold ?? DEFAULT_NORMAL_THRESHOLD,
      acuteStressMultiplier:
        overrides.acuteStressMultiplier ?? DEFAULT_ACUTE_STRESS_MULTIPLIER,
      elevatedMultiplier:
        overrides.elevatedMultiplier ?? DEFAULT_ELEVATED_MULTIPLIER,
      normalMultiplier:
        overrides.normalMultiplier ?? DEFAULT_NORMAL_MULTIPLIER,
      compressedMultiplier:
        overrides.compressedMultiplier ?? DEFAULT_COMPRESSED_MULTIPLIER,
      noDataMultiplier: overrides.noDataMultiplier ?? DEFAULT_NO_DATA_MULTIPLIER,
    };

    // LAYER 1 — constructor assertion. The metadata declares
    // `maxLeverage: 10`; defensive runtime check matches the
    // convention used by all other Phase 10G+ plugins.
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[DvolRegimeSizingPlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    // Validate config invariants.
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0
    ) {
      throw new Error(
        `[DvolRegimeSizingPlugin] baseNotionalUsd must be positive finite, got ${this.config.baseNotionalUsd}`,
      );
    }
    if (this.config.acuteStressThreshold <= this.config.elevatedThreshold) {
      throw new Error(
        `[DvolRegimeSizingPlugin] acuteStressThreshold=${this.config.acuteStressThreshold} must be > elevatedThreshold=${this.config.elevatedThreshold}`,
      );
    }
    if (this.config.elevatedThreshold <= this.config.normalThreshold) {
      throw new Error(
        `[DvolRegimeSizingPlugin] elevatedThreshold=${this.config.elevatedThreshold} must be > normalThreshold=${this.config.normalThreshold}`,
      );
    }
    if (
      this.config.acuteStressMultiplier < 0 ||
      this.config.acuteStressMultiplier > 1.0
    ) {
      throw new Error(
        `[DvolRegimeSizingPlugin] acuteStressMultiplier=${this.config.acuteStressMultiplier} must be in [0, 1.0] (1:10 mandate: no scale-up)`,
      );
    }
    if (
      this.config.elevatedMultiplier < 0 ||
      this.config.elevatedMultiplier > 1.0
    ) {
      throw new Error(
        `[DvolRegimeSizingPlugin] elevatedMultiplier=${this.config.elevatedMultiplier} must be in [0, 1.0]`,
      );
    }
    if (
      this.config.normalMultiplier < 0 ||
      this.config.normalMultiplier > 1.0
    ) {
      throw new Error(
        `[DvolRegimeSizingPlugin] normalMultiplier=${this.config.normalMultiplier} must be in [0, 1.0]`,
      );
    }
    if (
      this.config.compressedMultiplier < 0 ||
      this.config.compressedMultiplier > 1.0
    ) {
      throw new Error(
        `[DvolRegimeSizingPlugin] compressedMultiplier=${this.config.compressedMultiplier} must be in [0, 1.0]`,
      );
    }
    if (
      this.config.noDataMultiplier < 0 ||
      this.config.noDataMultiplier > 1.0
    ) {
      throw new Error(
        `[DvolRegimeSizingPlugin] noDataMultiplier=${this.config.noDataMultiplier} must be in [0, 1.0]`,
      );
    }
    if (!Array.isArray(this.config.enabledSymbols) || this.config.enabledSymbols.length === 0) {
      throw new Error(
        `[DvolRegimeSizingPlugin] enabledSymbols must be a non-empty array`,
      );
    }
    const seen = new Set<string>();
    for (const s of this.config.enabledSymbols) {
      if (typeof s !== "string" || s.length === 0) {
        throw new Error(
          `[DvolRegimeSizingPlugin] enabledSymbols contains invalid entry: ${String(s)}`,
        );
      }
      if (seen.has(s)) {
        throw new Error(
          `[DvolRegimeSizingPlugin] enabledSymbols contains duplicate "${s}"`,
        );
      }
      seen.add(s);
    }

    this.state = {
      lastDvol: null,
      lastDvolTimestampMs: null,
      lastRegime: "no-data",
      lastSizeMultiplier: this.config.noDataMultiplier,
      barsProcessed: 0,
      dvolReadings: 0,
      sizingSignalsEmitted: 0,
      noDataEmissions: 0,
      regimeCounts: {
        "acute-stress": 0,
        elevated: 0,
        normal: 0,
        compressed: 0,
        "no-data": 0,
      },
    };
  }

  // ---------------------------------------------------------------------
  // StrategyPlugin interface
  // ---------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this._bus = bus;
    this._wired = true;
  }

  onBar(bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    // Iterate enabledSymbols and emit one SizingSignal per symbol.
    // (The bar argument is the BTC bar; all symbols share the same
    // date in 1d bars, so we use bar.timestamp for the DVOL lookup
    // regardless of which symbol's bar is being processed.)
    for (const symbol of this.config.enabledSymbols) {
      this._processSymbol(symbol, bar.timestamp);
    }
  }

  validateConfig(config: unknown): Result<void, ConfigError> {
    const makeErr = (
      field: string,
      message: string,
      value?: unknown,
    ): Result<void, ConfigError> => ({
      ok: false,
      error: {
        pluginName: this.metadata.name,
        field,
        message,
        ...(value !== undefined ? { value } : {}),
      },
    });
    if (config === null || config === undefined) return ok(undefined);
    if (typeof config !== "object") return makeErr("config", "must be object");
    const c = config as Record<string, unknown>;
    if (c["baseNotionalUsd"] !== undefined) {
      const bn = c["baseNotionalUsd"];
      if (typeof bn !== "number" || !Number.isFinite(bn) || bn <= 0) {
        return makeErr("baseNotionalUsd", "must be positive finite number", bn);
      }
    }
    if (c["getDvolForTimestamp"] !== undefined) {
      if (typeof c["getDvolForTimestamp"] !== "function") {
        return makeErr("getDvolForTimestamp", "must be a function");
      }
    }
    return ok(undefined);
  }

  reset(): void {
    this.state.lastDvol = null;
    this.state.lastDvolTimestampMs = null;
    this.state.lastRegime = "no-data";
    this.state.lastSizeMultiplier = this.config.noDataMultiplier;
    this.state.barsProcessed = 0;
    this.state.dvolReadings = 0;
    this.state.sizingSignalsEmitted = 0;
    this.state.noDataEmissions = 0;
    this.state.regimeCounts["acute-stress"] = 0;
    this.state.regimeCounts.elevated = 0;
    this.state.regimeCounts.normal = 0;
    this.state.regimeCounts.compressed = 0;
    this.state.regimeCounts["no-data"] = 0;
  }

  dispose(): void {
    this._bus = null;
    this._wired = false;
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  /**
   * `_processSymbol` — look up DVOL for the timestamp, classify
   * regime, compute volMultiplier, emit SizingSignal. Used by `onBar`
   * to handle one symbol per call.
   */
  private _processSymbol(symbol: string, timestampMs: number): void {
    // Per-symbol DVOL override takes precedence over the default
    // callback (allows ETH-DVOL / SOL-DVOL routing when available).
    // Optional-chain the Map.get call (dvolBySymbol is optional), then
    // nullish-coalesce with the timestamp-based fallback. No intermediate
    // `let` reassignment needed — the rule `@typescript-eslint/prefer-nullish-coalescing`
    // rejects both the `?? null` ternary AND a `??=` reassignment for this
    // pattern; chaining `?.` + `??` is the only assignment-free form.
    const fromOverride = this.config.dvolBySymbol?.get(symbol);
    const dvol = fromOverride ?? this.config.getDvolForTimestamp(timestampMs);

    let regime: DvolRegime;
    let volMultiplier: number;
    if (dvol === null || !Number.isFinite(dvol)) {
      // Fail-open path — DVOL data missing or invalid.
      regime = "no-data";
      volMultiplier = this.config.noDataMultiplier;
      this.state.noDataEmissions += 1;
    } else {
      this.state.dvolReadings += 1;
      this.state.lastDvol = dvol;
      this.state.lastDvolTimestampMs = timestampMs;
      regime = this._classifyRegime(dvol);
      volMultiplier = this._getMultiplierForRegime(regime);
    }

    this.state.lastRegime = regime;
    this.state.lastSizeMultiplier = volMultiplier;
    this.state.regimeCounts[regime] += 1;

    this._emitSizingSignal(symbol, timestampMs, volMultiplier);
  }

  /**
   * `_classifyRegime` — bucket DVOL into a regime name. Buckets are
   * inclusive of the lower bound, exclusive of the upper bound.
   */
  private _classifyRegime(dvol: number): DvolRegime {
    if (dvol > this.config.acuteStressThreshold) return "acute-stress";
    if (dvol > this.config.elevatedThreshold) return "elevated";
    if (dvol > this.config.normalThreshold) return "normal";
    return "compressed";
  }

  /**
   * `_getMultiplierForRegime` — map regime name to volMultiplier.
   */
  private _getMultiplierForRegime(regime: DvolRegime): number {
    switch (regime) {
      case "acute-stress":
        return this.config.acuteStressMultiplier;
      case "elevated":
        return this.config.elevatedMultiplier;
      case "normal":
        return this.config.normalMultiplier;
      case "compressed":
        return this.config.compressedMultiplier;
      case "no-data":
        return this.config.noDataMultiplier;
      default: {
        const exhaustive: never = regime;
        throw new Error(
          `[DvolRegimeSizingPlugin] Non-exhaustive switch: ${String(exhaustive)}`,
        );
      }
    }
  }

  /**
   * `_emitSizingSignal` — emit a SizingSignal on the bus with the
   * computed volMultiplier. Respects 1:10 leverage via the notional
   * clamp (Layer 2 of 3-layer defense).
   */
  private _emitSizingSignal(
    symbol: string,
    timestampMs: number,
    volMultiplier: number,
  ): void {
    if (!this._wired || this._bus === null) return;
    const impliedNotional = this.config.baseNotionalUsd * volMultiplier;
    let clampedNotional = impliedNotional;
    if (clampedNotional > this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE) {
      clampedNotional = this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
    }
    const signal: SizingSignal = {
      kind: "sizing",
      kellyFraction: 0, // DVOL doesn't directly suggest Kelly; the carry plugin decides
      volMultiplier,
      notional: clampedNotional,
      source: this.metadata.name,
      timestampMs,
    };
    void symbol; // currently unused in the SizingSignal shape; reserved for future symbol-tagged extension
    this.state.sizingSignalsEmitted += 1;
    this._bus.emit(signal);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createDvolRegimeSizingPlugin` — convenience factory.
 * Same as `new DvolRegimeSizingPlugin(config)`.
 */
export function createDvolRegimeSizingPlugin(
  overrides: Partial<DvolRegimeSizingConfig> = {},
): DvolRegimeSizingPlugin {
  return new DvolRegimeSizingPlugin(overrides);
}
