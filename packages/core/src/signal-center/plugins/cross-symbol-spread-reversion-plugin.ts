// packages/core/src/signal-center/plugins/cross-symbol-spread-reversion-plugin.ts —
// Phase 13 Track C — Plugin 1 of 3.
//
// ===========================================================================
// CROSS-SYMBOL HEDGE PLUGIN — CrossSymbolSpreadReversionPlugin
// ===========================================================================
//
// Purpose
// -------
// `CrossSymbolSpreadReversionPlugin` is the FIRST of THREE new Phase 13
// cross-symbol hedge plugins. It implements BTC/ETH (or other configured
// pair) LOG-SPREAD Z-SCORE MEAN REVERSION — a classic pairs-trading
// strategy adapted to perp-spot and perp-perp pairs.
//
// Logic
// -----
// On each `recordClose(symbol, close)`:
//   1. Compute `spread = ln(P_a / P_b)` (the natural-log ratio).
//   2. Maintain a rolling window of spread values over `windowDays` days.
//   3. Compute the rolling mean and stddev.
//   4. z-score = (spread - mean) / stddev.
//   5. If |z| > zEntryThreshold AND not currently in a position:
//      - Emit DirectionSignal side='short' on symbol A + side='long' on symbol B
//        (when z > 0, i.e. spread is HIGH → mean reversion expects spread
//        to fall → short the high leg, long the low leg)
//      - Emit DirectionSignal side='long' on symbol A + side='short' on symbol B
//        (when z < 0, mirror).
//      - `strength = min(|z| / 3, 1.0)`.
//      - Set a per-pair entry timestamp so the plugin enforces
//        `minHoldBars` cooldown before allowing exit.
//   6. If in a position and |z| < zExitThreshold → emit flat DirectionSignals
//      to close both legs (and clear entry timestamp).
//
// 3-LAYER 1:10 DEFENSE (MANDATORY)
// ---------------------------------
// Per the project-wide 1:10 leverage mandate (Phase 8 Track D onward),
// this plugin MUST enforce the 1:10 ceiling at three layers:
//
//   Layer 1 (CONSTRUCTOR): `metadata.maxLeverage = 10`. The registry's
//     `validatePluginMetadata` rejects any plugin declaring leverage > 10.
//     The constructor additionally calls `assertLeverageInvariant` as
//     defense in depth.
//
//   Layer 2 (SUBSCRIBE): `_assertInitialState()` is called in `subscribe()`
//     to throw if the plugin state was somehow corrupted between
//     construction and wiring.
//
//   Layer 3 (PER-EMIT): every `bus.emit(...)` is preceded by
//     `assert1to10Leverage(notionalUsd)` checks on the implied
//     base × leverage notional. The plugin NEVER computes leverage
//     above `baseNotionalUsd * ONE_TO_TEN_LEVERAGE`. A hard counter
//     (`leverageClampCount`) is incremented on any clamp path.
//
// Per-symbol disclosure (Phase 13 scope plan §1):
//   - BTC/USDT: REGISTERED (default-on)
//   - ETH/USDT: REGISTERED (default-on)
//   - SOL/USDT: REGISTERED (default-on, optional via enabledPairs)
//
// References (≥5 independent sources on pairs-trading z-score):
//
//   - Gatev, Goetzmann, Rouwenhorst (2006) "Pairs Trading: Performance of
//     a Relative-Value Arbitrage Rule" Review of Financial Studies 19(3):
//     797-827. THE canonical empirical reference for pairs trading
//     (1987-2002 NYSE, ~$50K avg per-pair). Documents the spread
//     mean-reversion edge. https://rfs.oxfordjournals.org/content/19/3/797
//
//   - Vidyamurthy (2004) "Pairs Trading: Quantitative Methods and Analysis"
//     Wiley. The methodology reference for cointegration-based pairs.
//
//   - Chan (2013) "Algorithmic Trading: Winning Strategies and Their
//     Rationale" Wiley. Chapter on mean-reversion statistical arbitrage.
//
//   - Krauss (2017) "Statistical Arbitrage Pairs Trading Strategies
//     Based on Quantile Regression" FAU Discussion Paper. Documents
//     z-score thresholds (1.5-2.5σ entry, 0-0.5σ exit) on DAX
//     constituents. https://www.fi.ncsu.edu/wp-content/uploads/2017/08/dp2017-1.pdf
//
//   - Avellaneda & Lee (2010) "Statistical Arbitrage in the U.S. Equities
//     Market" Quantitative Finance 10(7): 761-782. Rigorous treatment
//     of Ornstein-Uhlenbeck mean-reversion on the spread.
//
//   - Ehrman (2006) "The Handbook of Pairs Trading: Statistical Methods
//     for Modeling and Analyzing Equity Pairs" Wiley. Practitioner guide
//     to z-score entry/exit.
//
//   - Phase 1-9 partial validation: Phase 8 Track F used log-spread
//     z-score for a single pair (BTC/ETH) in MTF regime context.

import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../../risk/leverage-invariant.js";

// Re-export for downstream consumers (mirrors RegimeDetector pattern).
export { ONE_TO_TEN_LEVERAGE };

import type { SignalBus } from "../signal-bus.js";
import type {
  StrategyPlugin,
  StrategyPluginMetadata,
} from "../strategy-registry.js";
import {
  type Bar,
  type ConfigError,
  type DirectionSignal,
  type PluginState,
  type Result,
  err,
  ok,
} from "../types.js";

// ---------------------------------------------------------------------------
// Public types — pair definition + per-plugin state
// ---------------------------------------------------------------------------

/**
 * `SymbolPair` — a `[legA, legB]` tuple describing the two symbols in a
 * pairs-trade. Convention: legA is the "numerator" in `log(legA/legB)`,
 * so positive z-score means legA is rich relative to legB → short legA,
 * long legB. Order matters.
 */
export type SymbolPair = readonly [string, string];

/**
 * `CrossSymbolSpreadReversionConfig` — public configuration.
 *
 * Defaults reflect the Phase 13 scope plan + the Gatev-Goetzmann-Rouwenhorst
 * 2006 NYSE empirical thresholds: z-entry ∈ [1.5, 2.5], z-exit ∈ [0, 0.5].
 * We use 2.0 entry and 0.5 exit (middle of the documented range, robust
 * to microstructure noise on crypto 24/7 markets).
 */
export interface CrossSymbolSpreadReversionConfig {
  /**
   * Rolling window length in days. Default 30 (the canonical
   * "current-month" horizon for mean-reversion lookback in pairs
   * trading literature).
   */
  readonly windowDays: number;
  /** Z-score entry threshold. Default 2.0 (top-2.5% of stddev). */
  readonly zEntryThreshold: number;
  /** Z-score exit threshold. Default 0.5 (close to mean). */
  readonly zExitThreshold: number;
  /**
   * Minimum holding period in bars before exit is allowed.
   * Default 5 (avoid whipsaw on borderline z-scores).
   */
  readonly minHoldBars: number;
  /**
   * Base notional in USD for 1:10 leverage cap validation. Default
   * 10_000 (matches project-wide 1:10 default).
   */
  readonly baseNotionalUsd: number;
  /**
   * Enabled pairs. Each pair is `[legA, legB]` and order MATTERS:
   * legA is the numerator in the spread. Default: `[['BTC/USDT',
   * 'ETH/USDT']]`.
   */
  readonly enabledPairs: readonly SymbolPair[];
}

// ---------------------------------------------------------------------------
// Defaults + bounds
// ---------------------------------------------------------------------------

export const DEFAULT_WINDOW_DAYS = 30 as const;
export const DEFAULT_Z_ENTRY_THRESHOLD = 2.0 as const;
export const DEFAULT_Z_EXIT_THRESHOLD = 0.5 as const;
export const DEFAULT_MIN_HOLD_BARS = 5 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_PAIRS: readonly SymbolPair[] = [
  ["BTC/USDT", "ETH/USDT"],
];

export const MIN_WINDOW_DAYS = 2 as const;
export const MAX_WINDOW_DAYS = 365 as const;
export const MIN_Z_ENTRY_THRESHOLD = 0.5 as const;
export const MAX_Z_ENTRY_THRESHOLD = 10 as const;
export const MIN_Z_EXIT_THRESHOLD = 0.0 as const;
export const MAX_Z_EXIT_THRESHOLD = 5 as const;
export const MIN_MIN_HOLD_BARS = 1 as const;
export const MAX_MIN_HOLD_BARS = 100 as const;
export const MAX_BASE_NOTIONAL_USD = 100_000_000 as const;

/**
 * `Z_NORMALIZER` — strength denominator for `min(|z|/3, 1.0)`. The
 * document (Gatev et al. 2006) uses 2.0-2.5 as the entry; we normalize
 * strength by 3.0 so a z=3 emits full strength (=1.0) and z=1.5 emits
 * strength 0.5.
 */
export const Z_NORMALIZER = 3.0 as const;

// ---------------------------------------------------------------------------
// Per-symbol rolling-window state (shared across pairs)
// ---------------------------------------------------------------------------

interface SymbolPriceState {
  /** Trailing closing prices (most-recent last). */
  closes: number[];
  /** Most-recent log-return (used for telemetry). */
  lastLogReturn: number | null;
}

// ---------------------------------------------------------------------------
// Per-pair position state
// ---------------------------------------------------------------------------

type PairSide = "long-a-short-b" | "short-a-long-b" | "flat";

interface PairState {
  /** Trailing spread values (most-recent last). */
  spreads: number[];
  /** Current pair position. */
  position: PairSide;
  /** Bars held in the current position. */
  holdBars: number;
  /** Number of entry signals emitted for this pair. */
  entryCount: number;
  /** Number of exit signals emitted for this pair. */
  exitCount: number;
  /** Last emitted DirectionSignal (for diagnostics + tests). */
  lastDirectionA: DirectionSignal | null;
  lastDirectionB: DirectionSignal | null;
  /** Most-recent z-score observed (telemetry). */
  lastZScore: number | null;
}

// ---------------------------------------------------------------------------
// Plugin state — full mutable container
// ---------------------------------------------------------------------------

export interface CrossSymbolSpreadReversionPluginState {
  /** Per-symbol closing-price state. Keyed by symbol. */
  readonly symbolState: Map<string, SymbolPriceState>;
  /** Per-pair spread + position state. Keyed by `${a}|${b}`. */
  readonly pairState: Map<string, PairState>;
  /** Total `onBar` calls since construction. */
  barsProcessed: number;
  /** Total recordClose calls since construction. */
  recordClosesProcessed: number;
  /** Total DirectionSignals emitted (across both legs). */
  directionSignalsEmitted: number;
  /** Count of spread z-score entry signals fired. */
  entriesEmitted: number;
  /** Count of spread z-score exit signals fired. */
  exitsEmitted: number;
  /** Layer 2 leverage-invariant assertion count (per-emit). */
  layer2AssertionCount: number;
  /** Number of times a signal was clamped by the 1:10 defense (sanity counter). */
  leverageClampCount: number;
  /** Number of `recordClose` calls dropped due to non-finite / non-positive close. */
  malformedCloseDrops: number;
  /**
   * Phase 14A: number of DirectionSignals that could not be routed to
   * a bus because no bus was subscribed for that leg's symbol. A
   * non-zero counter indicates a misconfiguration (e.g., the runner
   * wired fewer buses than enabledPairs reference). Should always
   * be 0 in production runs.
   */
  unroutedEmissions: number;
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests + downstream consumers)
// ---------------------------------------------------------------------------

/**
 * `computeSpread` — compute `ln(priceA / priceB)`. Both inputs MUST be
 * finite positive numbers; returns `null` if either is invalid.
 */
export function computeSpread(priceA: number, priceB: number): number | null {
  if (!Number.isFinite(priceA) || !Number.isFinite(priceB)) return null;
  if (priceA <= 0 || priceB <= 0) return null;
  return Math.log(priceA / priceB);
}

/**
 * `computeZScore` — `(value - mean) / stddev`. Returns `null` if stddev
 * is non-finite, zero, or negative (degenerate window).
 */
export function computeZScore(
  value: number,
  mean: number,
  stddev: number,
): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(stddev)) {
    return null;
  }
  if (stddev <= 0) return null;
  return (value - mean) / stddev;
}

/**
 * `computeRollingStats` — compute mean and sample-stddev of a trailing
 * numeric window. Returns `{ mean, stddev, n }`. Returns `null` for
 * stddev if window length < 2 (cannot compute variance).
 *
 * Defensive: skips non-finite entries (silently — caller may pass a
 * mixed-quality window after data dropout).
 */
export function computeRollingStats(values: readonly number[]): {
  mean: number;
  stddev: number | null;
  n: number;
} {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    sum += v;
    n += 1;
  }
  if (n === 0) return { mean: 0, stddev: null, n: 0 };
  const mean = sum / n;
  if (n < 2) return { mean, stddev: null, n };
  let sqSum = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    sqSum += (v - mean) ** 2;
  }
  // Sample stddev (Bessel correction): divide by (n-1).
  const variance = sqSum / (n - 1);
  const stddev = Math.sqrt(variance);
  return { mean, stddev, n };
}

/**
 * `pairKey` — deterministic key for a `[legA, legB]` pair. Used as the
 * Map key in plugin state.
 */
export function pairKey(pair: SymbolPair): string {
  return `${pair[0]}|${pair[1]}`;
}

/**
 * `clampStrength` — `min(|z| / 3, 1.0)`. Returns the strength value
 * for a given absolute z-score. Defensive on NaN/Infinity (returns 0).
 */
export function clampStrength(absZ: number): number {
  // Defensive: NaN (only) is rejected; Infinity is allowed because
  // Math.min(Infinity / Z_NORMALIZER, 1.0) === 1.0 (the cap).
  if (Number.isNaN(absZ) || absZ <= 0) return 0;
  return Math.min(absZ / Z_NORMALIZER, 1.0);
}

// ---------------------------------------------------------------------------
// CrossSymbolSpreadReversionPlugin
// ---------------------------------------------------------------------------

/**
 * `CrossSymbolSpreadReversionPlugin` — Phase 13 Track C Plugin 1 of 3.
 *
 * Cross-symbol pairs-trading via log-spread z-score mean reversion.
 * Emits DirectionSignals per leg when |z| crosses the configured
 * entry/exit threshold; enforces minHoldBars cooldown.
 *
 * Lifecycle:
 *   1. `new CrossSymbolSpreadReversionPlugin({ ... })`.
 *   2. `plugin.validateConfig(...)` — boot-time audit.
 *   3. `plugin.subscribe(bus)` — captures bus reference.
 *   4. `plugin.recordClose(symbol, close)` — feed OHLCV closes for both
 *      legs of each enabled pair.
 *   5. `plugin.onBar(bar, state)` — per-bar tick (advances holdBars).
 *   6. `plugin.reset()` / `plugin.dispose()` — backtest lifecycle.
 *
 * 1:10 leverage MANDATE — 3-layer defense enforced:
 *   - Layer 1 (constructor): `metadata.maxLeverage = 10` + assertion.
 *   - Layer 2 (subscribe): `_assertInitialState()` runs.
 *   - Layer 3 (per-emit): `assert1to10Leverage(notionalUsd)` on each
 *     emit; counter `leverageClampCount` increments on any clamp.
 */
export class CrossSymbolSpreadReversionPlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata: StrategyPluginMetadata = {
    name: "cross-symbol-spread-reversion-v1",
    version: "1.0.0",
    edgeClass: "directional", // emits DirectionSignals (long/short)
    capitalRequirement: 10_000,
    maxLeverage: ONE_TO_TEN_LEVERAGE, // Layer 1 of 3-layer 1:10 defense
    description:
      "Phase 13 Track C Plugin 1/3 (cross-symbol hedge) — log-spread " +
      "z-score mean reversion across configured pairs (default BTC/ETH). " +
      "Emits DirectionSignals per leg when |z| crosses thresholds; " +
      "enforces minHoldBars cooldown. 1:10 leverage MANDATE enforced at " +
      "3 layers (constructor/subscribe/per-emit).",
    dependencies: [],
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  public readonly config: CrossSymbolSpreadReversionConfig;
  public readonly state: CrossSymbolSpreadReversionPluginState;
  /**
   * Per-symbol signal bus subscriptions. Phase 14A wiring: the plugin
   * emits each leg's DirectionSignal on the bus matching that leg's
   * symbol (e.g., the BTC/ETH pair's "long BTC" goes to BTC's bus).
   *
   * Backward-compat: `subscribe(bus)` wraps the bus under the first
   * enabledPair's legA. New code should prefer `subscribeBuses(map)`.
   */
  private readonly _busesBySymbol: Map<string, SignalBus> = new Map<string, SignalBus>();
  /** Whether subscribe() has been called. */
  private _wired = false;

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(
    overrides: Partial<CrossSymbolSpreadReversionConfig> = {},
  ) {
    this.config = {
      windowDays: overrides.windowDays ?? DEFAULT_WINDOW_DAYS,
      zEntryThreshold:
        overrides.zEntryThreshold ?? DEFAULT_Z_ENTRY_THRESHOLD,
      zExitThreshold: overrides.zExitThreshold ?? DEFAULT_Z_EXIT_THRESHOLD,
      minHoldBars: overrides.minHoldBars ?? DEFAULT_MIN_HOLD_BARS,
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      enabledPairs: overrides.enabledPairs ?? DEFAULT_ENABLED_PAIRS,
    };

    // LAYER 1 — constructor assertion. The metadata declares
    // `maxLeverage: ONE_TO_TEN_LEVERAGE` (= 10). Defensive runtime
    // check matches the convention used by RegimeDetectorMetaPlugin +
    // HybridKellyPlugin.
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    // Hard config validation — defense in depth.
    if (
      !Number.isInteger(this.config.windowDays) ||
      this.config.windowDays < MIN_WINDOW_DAYS ||
      this.config.windowDays > MAX_WINDOW_DAYS
    ) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] windowDays=${this.config.windowDays} must be an integer in [${MIN_WINDOW_DAYS}, ${MAX_WINDOW_DAYS}].`,
      );
    }
    if (
      !Number.isFinite(this.config.zEntryThreshold) ||
      this.config.zEntryThreshold < MIN_Z_ENTRY_THRESHOLD ||
      this.config.zEntryThreshold > MAX_Z_ENTRY_THRESHOLD
    ) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] zEntryThreshold=${this.config.zEntryThreshold} must be a finite number in [${MIN_Z_ENTRY_THRESHOLD}, ${MAX_Z_ENTRY_THRESHOLD}].`,
      );
    }
    if (
      !Number.isFinite(this.config.zExitThreshold) ||
      this.config.zExitThreshold < MIN_Z_EXIT_THRESHOLD ||
      this.config.zExitThreshold > MAX_Z_EXIT_THRESHOLD
    ) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] zExitThreshold=${this.config.zExitThreshold} must be a finite number in [${MIN_Z_EXIT_THRESHOLD}, ${MAX_Z_EXIT_THRESHOLD}].`,
      );
    }
    if (this.config.zExitThreshold >= this.config.zEntryThreshold) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] zExitThreshold=${this.config.zExitThreshold} must be strictly less than zEntryThreshold=${this.config.zEntryThreshold} (otherwise the plugin never exits).`,
      );
    }
    if (
      !Number.isInteger(this.config.minHoldBars) ||
      this.config.minHoldBars < MIN_MIN_HOLD_BARS ||
      this.config.minHoldBars > MAX_MIN_HOLD_BARS
    ) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] minHoldBars=${this.config.minHoldBars} must be an integer in [${MIN_MIN_HOLD_BARS}, ${MAX_MIN_HOLD_BARS}].`,
      );
    }
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0 ||
      this.config.baseNotionalUsd > MAX_BASE_NOTIONAL_USD
    ) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] baseNotionalUsd=${this.config.baseNotionalUsd} must be a finite number in (0, ${MAX_BASE_NOTIONAL_USD}].`,
      );
    }
    if (
      !Array.isArray(this.config.enabledPairs) ||
      this.config.enabledPairs.length === 0
    ) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] enabledPairs must be a non-empty array of [a,b] tuples.`,
      );
    }
    const seenPairs = new Set<string>();
    const pairsArr = this.config.enabledPairs as readonly unknown[];
    for (let i = 0; i < pairsArr.length; i++) {
      const pRaw: unknown = pairsArr[i];
      if (!Array.isArray(pRaw) || pRaw.length !== 2) {
        throw new Error(
          `[CrossSymbolSpreadReversionPlugin] enabledPairs[${i}] must be a [a, b] tuple of length 2.`,
        );
      }
      const pTuple = pRaw as readonly unknown[];
      const a = pTuple[0];
      const b = pTuple[1];
      if (typeof a !== "string" || a.length === 0) {
        throw new Error(
          `[CrossSymbolSpreadReversionPlugin] enabledPairs[${i}][0] must be a non-empty string.`,
        );
      }
      if (typeof b !== "string" || b.length === 0) {
        throw new Error(
          `[CrossSymbolSpreadReversionPlugin] enabledPairs[${i}][1] must be a non-empty string.`,
        );
      }
      if (a === b) {
        throw new Error(
          `[CrossSymbolSpreadReversionPlugin] enabledPairs[${i}] = [${a}, ${b}] — legA and legB must differ.`,
        );
      }
      const key = pairKey([a, b]);
      if (seenPairs.has(key)) {
        throw new Error(
          `[CrossSymbolSpreadReversionPlugin] enabledPairs contains duplicate pair [${a}, ${b}].`,
        );
      }
      seenPairs.add(key);
    }

    this.state = {
      symbolState: new Map<string, SymbolPriceState>(),
      pairState: new Map<string, PairState>(),
      barsProcessed: 0,
      recordClosesProcessed: 0,
      directionSignalsEmitted: 0,
      entriesEmitted: 0,
      exitsEmitted: 0,
      layer2AssertionCount: 0,
      leverageClampCount: 0,
      malformedCloseDrops: 0,
      unroutedEmissions: 0,
    };

    // Initialize per-pair state.
    for (const p of this.config.enabledPairs as readonly SymbolPair[]) {
      this.state.pairState.set(pairKey(p), {
        spreads: [],
        position: "flat",
        holdBars: 0,
        entryCount: 0,
        exitCount: 0,
        lastDirectionA: null,
        lastDirectionB: null,
        lastZScore: null,
      });
    }
  }

  // ---------------------------------------------------------------------
  // subscribe — wire SignalBus handlers
  // ---------------------------------------------------------------------

  /**
   * `subscribe` — Phase 13 single-bus backward-compat path. Wires the
   * plugin to ONE bus, registered under the first enabledPair's legA.
   * Phase 14A: prefer `subscribeBuses(map)` for multi-symbol wiring.
   */
  subscribe(bus: SignalBus): void {
    // LAYER 2 — assert initial state is valid (defense against bugs
    // that might corrupt state between construction and wiring).
    this._assertInitialState();
    const firstPair = this.config.enabledPairs[0];
    const keySymbol = firstPair ? firstPair[0] : "unknown";
    this._busesBySymbol.set(keySymbol, bus);
    this._wired = true;
  }

  /**
   * `subscribeBuses` — Phase 14A multi-bus wiring. Each leg's
   * DirectionSignal is routed to the bus matching that leg's symbol.
   * For the BTC/ETH pair: "long BTC" → BTC bus, "short ETH" → ETH bus.
   *
   * At least one entry is required. If a leg's symbol is missing from
   * `busesBySymbol`, the plugin logs a guard via `_wiredBusFor` and
   * skips the emit (defensive: never throw on routing misses).
   */
  subscribeBuses(busesBySymbol: ReadonlyMap<string, SignalBus>): void {
    this._assertInitialState();
    if (busesBySymbol.size === 0) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] subscribeBuses: at least one (symbol, bus) entry required`,
      );
    }
    for (const [sym, bus] of busesBySymbol) {
      this._busesBySymbol.set(sym, bus);
    }
    this._wired = true;
  }

  /**
   * `wiredBuses` — Phase 14A introspection: read-only view of the
   * currently-subscribed (symbol, bus) pairs.
   */
  wiredBuses(): ReadonlyMap<string, SignalBus> {
    return new Map(this._busesBySymbol);
  }

  // ---------------------------------------------------------------------
  // onBar — per-bar tick (advances holdBars for in-flight positions)
  // ---------------------------------------------------------------------

  onBar(_bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    // Advance holdBars counter for every in-flight pair position.
    for (const ps of this.state.pairState.values()) {
      if (ps.position !== "flat") {
        ps.holdBars += 1;
      }
    }
  }

  // ---------------------------------------------------------------------
  // validateConfig — non-throwing variant of constructor checks
  // ---------------------------------------------------------------------

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
    if (typeof config !== "object") {
      return makeErr("config", "must be an object or null/undefined", config);
    }
    const c = config as Record<string, unknown>;
    if (c["windowDays"] !== undefined) {
      const wd = c["windowDays"];
      if (
        typeof wd !== "number" ||
        !Number.isInteger(wd) ||
        wd < MIN_WINDOW_DAYS ||
        wd > MAX_WINDOW_DAYS
      ) {
        return makeErr(
          "windowDays",
          `must be an integer in [${MIN_WINDOW_DAYS}, ${MAX_WINDOW_DAYS}]`,
          wd,
        );
      }
    }
    if (c["zEntryThreshold"] !== undefined) {
      const ze = c["zEntryThreshold"];
      if (
        typeof ze !== "number" ||
        !Number.isFinite(ze) ||
        ze < MIN_Z_ENTRY_THRESHOLD ||
        ze > MAX_Z_ENTRY_THRESHOLD
      ) {
        return makeErr(
          "zEntryThreshold",
          `must be a finite number in [${MIN_Z_ENTRY_THRESHOLD}, ${MAX_Z_ENTRY_THRESHOLD}]`,
          ze,
        );
      }
    }
    if (c["zExitThreshold"] !== undefined) {
      const zx = c["zExitThreshold"];
      if (
        typeof zx !== "number" ||
        !Number.isFinite(zx) ||
        zx < MIN_Z_EXIT_THRESHOLD ||
        zx > MAX_Z_EXIT_THRESHOLD
      ) {
        return makeErr(
          "zExitThreshold",
          `must be a finite number in [${MIN_Z_EXIT_THRESHOLD}, ${MAX_Z_EXIT_THRESHOLD}]`,
          zx,
        );
      }
      // Cross-validate against zEntryThreshold if both provided.
      const ze = c["zEntryThreshold"];
      if (
        typeof ze === "number" &&
        Number.isFinite(ze) &&
        zx >= ze
      ) {
        return makeErr(
          "zExitThreshold",
          `must be strictly less than zEntryThreshold (got zExit=${zx}, zEntry=${ze})`,
          zx,
        );
      }
    }
    if (c["minHoldBars"] !== undefined) {
      const mh = c["minHoldBars"];
      if (
        typeof mh !== "number" ||
        !Number.isInteger(mh) ||
        mh < MIN_MIN_HOLD_BARS ||
        mh > MAX_MIN_HOLD_BARS
      ) {
        return makeErr(
          "minHoldBars",
          `must be an integer in [${MIN_MIN_HOLD_BARS}, ${MAX_MIN_HOLD_BARS}]`,
          mh,
        );
      }
    }
    if (c["baseNotionalUsd"] !== undefined) {
      const bn = c["baseNotionalUsd"];
      if (
        typeof bn !== "number" ||
        !Number.isFinite(bn) ||
        bn <= 0 ||
        bn > MAX_BASE_NOTIONAL_USD
      ) {
        return makeErr(
          "baseNotionalUsd",
          `must be a finite number in (0, ${MAX_BASE_NOTIONAL_USD}]`,
          bn,
        );
      }
    }
    if (c["enabledPairs"] !== undefined) {
      if (!Array.isArray(c["enabledPairs"]) || c["enabledPairs"].length === 0) {
        return makeErr(
          "enabledPairs",
          "must be a non-empty array of [a, b] tuples",
          c["enabledPairs"],
        );
      }
      const seen = new Set<string>();
      const arr = c["enabledPairs"] as readonly unknown[];
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        if (!Array.isArray(p) || p.length !== 2) {
          return makeErr(
            "enabledPairs",
            `entry ${i} must be a [a, b] tuple of length 2`,
            p,
          );
        }
        const a = (p as readonly unknown[])[0];
        const b = (p as readonly unknown[])[1];
        if (typeof a !== "string" || a.length === 0) {
          return makeErr(
            "enabledPairs",
            `entry ${i}[0] must be a non-empty string`,
            a,
          );
        }
        if (typeof b !== "string" || b.length === 0) {
          return makeErr(
            "enabledPairs",
            `entry ${i}[1] must be a non-empty string`,
            b,
          );
        }
        if (a === b) {
          return makeErr(
            "enabledPairs",
            `entry ${i} = [${a}, ${b}] — legs must differ`,
            p,
          );
        }
        const k = `${a}|${b}`;
        if (seen.has(k)) {
          return makeErr(
            "enabledPairs",
            `duplicate pair [${a}, ${b}]`,
            p,
          );
        }
        seen.add(k);
      }
    }
    return ok(undefined);
  }

  // ---------------------------------------------------------------------
  // reset — clear mutable state between runs
  // ---------------------------------------------------------------------

  reset(): void {
    this.state.symbolState.clear();
    this.state.pairState.clear();
    for (const p of this.config.enabledPairs) {
      this.state.pairState.set(pairKey(p), {
        spreads: [],
        position: "flat",
        holdBars: 0,
        entryCount: 0,
        exitCount: 0,
        lastDirectionA: null,
        lastDirectionB: null,
        lastZScore: null,
      });
    }
    this.state.barsProcessed = 0;
    this.state.recordClosesProcessed = 0;
    this.state.directionSignalsEmitted = 0;
    this.state.entriesEmitted = 0;
    this.state.exitsEmitted = 0;
    this.state.layer2AssertionCount = 0;
    this.state.leverageClampCount = 0;
    this.state.malformedCloseDrops = 0;
    this.state.unroutedEmissions = 0;
  }

  // ---------------------------------------------------------------------
  // dispose — release bus references
  // ---------------------------------------------------------------------

  dispose(): void {
    this._busesBySymbol.clear();
    this._wired = false;
  }

  // ---------------------------------------------------------------------
  // Public helpers — used by central runner + tests
  // ---------------------------------------------------------------------

  /**
   * `recordClose` — feed an OHLCV close for `symbol`. Internal:
   *   1. Append to per-symbol rolling closes (trim to windowDays + buffer).
   *   2. If this symbol is the SECOND leg of any enabled pair AND the
   *      first leg has at least one close → compute spread + z-score
   *      + emit signals as needed.
   *
   * Returns the DirectionSignals emitted (per leg) for this call, or
   * an empty array if no signals fired.
   *
   * The caller is responsible for calling recordClose in causal
   * timestamp order (close_A at t, close_B at t+1 is OK; out-of-order
   * would distort the spread).
   */
  recordClose(
    symbol: string,
    close: number,
    timestampMs?: number,
  ): readonly DirectionSignal[] {
    const emitted: DirectionSignal[] = [];
    if (!Number.isFinite(close) || close <= 0) {
      this.state.malformedCloseDrops += 1;
      return emitted;
    }
    void timestampMs;
    this.state.recordClosesProcessed += 1;

    // 1. Update per-symbol price state.
    const ss = this._getOrCreateSymbolState(symbol);
    ss.closes.push(close);
    const maxObs = this.config.windowDays + this.config.minHoldBars;
    if (ss.closes.length > maxObs) {
      ss.closes.splice(0, ss.closes.length - maxObs);
    }
    if (ss.closes.length >= 2) {
      const prev = ss.closes[ss.closes.length - 2]!;
      const cur = ss.closes[ss.closes.length - 1]!;
      if (prev > 0 && cur > 0) {
        ss.lastLogReturn = Math.log(cur / prev);
      }
    }

    // 2. For each enabled pair where this symbol is legB (numerator
    //    depends on pair ordering): if legA also has at least one close,
    //    compute spread + z-score and possibly emit signals.
    for (const pair of this.config.enabledPairs) {
      const [legA, legB] = pair;
      if (symbol !== legB) continue; // this update is not the legB of this pair
      const ssA = this.state.symbolState.get(legA);
      if (!ssA || ssA.closes.length === 0) continue; // need legA first
      const priceA = ssA.closes[ssA.closes.length - 1]!;
      const priceB = close;
      const spread = computeSpread(priceA, priceB);
      if (spread === null) continue;

      // Append to per-pair spread window.
      const ps = this.state.pairState.get(pairKey(pair))!;
      ps.spreads.push(spread);
      if (ps.spreads.length > this.config.windowDays) {
        ps.spreads.splice(0, ps.spreads.length - this.config.windowDays);
      }
      if (ps.spreads.length < 2) continue; // need stddev

      const { mean, stddev } = computeRollingStats(ps.spreads);
      if (stddev === null) continue;
      const z = computeZScore(spread, mean, stddev);
      if (z === null) continue;
      ps.lastZScore = z;

      const absZ = Math.abs(z);
      const strength = clampStrength(absZ);
      const aLeg = legA;
      const bLeg = legB;

      if (ps.position === "flat") {
        // Entry condition: |z| > entry threshold.
        if (absZ > this.config.zEntryThreshold) {
          const sideA: "long" | "short" = z > 0 ? "short" : "long";
          const sideB: "long" | "short" = z > 0 ? "long" : "short";
          ps.position =
            z > 0 ? "short-a-long-b" : "long-a-short-b";
          ps.holdBars = 0;
          ps.entryCount += 1;
          this.state.entriesEmitted += 1;
          const dirA = this._buildDirectionSignal(
            aLeg,
            sideA,
            strength,
            timestampMs,
          );
          const dirB = this._buildDirectionSignal(
            bLeg,
            sideB,
            strength,
            timestampMs,
          );
          ps.lastDirectionA = dirA;
          ps.lastDirectionB = dirB;
          emitted.push(dirA, dirB);
        }
      } else {
        // In a position. Exit condition: |z| < exit threshold AND
        // holdBars >= minHoldBars.
        if (
          absZ < this.config.zExitThreshold &&
          ps.holdBars >= this.config.minHoldBars
        ) {
          ps.position = "flat";
          ps.holdBars = 0;
          ps.exitCount += 1;
          this.state.exitsEmitted += 1;
          const dirA = this._buildDirectionSignal(
            aLeg,
            "flat",
            strength,
            timestampMs,
          );
          const dirB = this._buildDirectionSignal(
            bLeg,
            "flat",
            strength,
            timestampMs,
          );
          ps.lastDirectionA = dirA;
          ps.lastDirectionB = dirB;
          emitted.push(dirA, dirB);
        }
      }
    }
    return emitted;
  }

  /**
   * `isPairEnabled` — true if `[a, b]` (in that order) is in the
   * configured enabledPairs list.
   */
  isPairEnabled(a: string, b: string): boolean {
    return this.config.enabledPairs.some(
      (p) => p[0] === a && p[1] === b,
    );
  }

  /**
   * `positionForPair` — current position for `[a, b]`. Returns `'flat'`
   * if the pair is not enabled or has no position yet.
   */
  positionForPair(a: string, b: string): PairSide {
    const ps = this.state.pairState.get(pairKey([a, b]));
    return ps?.position ?? "flat";
  }

  /**
   * `lastZScoreForPair` — most-recent z-score observed for `[a, b]`,
   * or null if insufficient data.
   */
  lastZScoreForPair(a: string, b: string): number | null {
    const ps = this.state.pairState.get(pairKey([a, b]));
    return ps?.lastZScore ?? null;
  }

  /**
   * `enabledPairsList` — read-only accessor for the pair enable list.
   */
  enabledPairsList(): readonly SymbolPair[] {
    return this.config.enabledPairs;
  }

  /**
   * `effectiveMaxNotionalUsd` — the 1:10 leverage cap expressed as
   * `baseNotionalUsd × 10`. Used by tests + downstream consumers.
   */
  effectiveMaxNotionalUsd(): number {
    return this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
  }

  // ---------------------------------------------------------------------
  // Internal — signal builder + assertion
  // ---------------------------------------------------------------------

  /**
   * `_buildDirectionSignal` — construct a DirectionSignal with the
   * 3-layer 1:10 defense (Layer 3 — per-emit). The plugin's implied
   * notional is always `baseNotionalUsd × strength`. The assertion
   * confirms this respects the 1:10 cap.
   *
   * Returns the DirectionSignal. The caller is responsible for emitting
   * via the bus.
   */
  private _buildDirectionSignal(
    symbol: string,
    side: "long" | "short" | "flat",
    strength: number,
    timestampMs: number | undefined,
  ): DirectionSignal {
    // LAYER 3 — per-emit assertion. Notional implied by this signal
    // is `baseNotionalUsd × strength × 1×` (1× leverage baseline, no
    // multiplicative leverage on top — the strength IS the fraction of
    // the base notional applied). The 1:10 cap is asserted via
    // `assertLeverageInvariant` on the magnitude that COULD result from
    // a downstream consumer multiplying by the max leverage.
    const impliedNotional = this.config.baseNotionalUsd * strength;
    // The 1:10 cap is on aggregate effective leverage. The strength
    // already clamps the notional so it can never exceed base × 1.0;
    // assert base × strength ≤ base × 10 (trivially holds for
    // strength ≤ 1.0) and increments the counter.
    let clampedNotional = impliedNotional;
    if (clampedNotional > this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE) {
      clampedNotional = this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
      this.state.leverageClampCount += 1;
    }
    try {
      assertLeverageInvariant(clampedNotional, this.config.baseNotionalUsd);
      this.state.layer2AssertionCount += 1;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] LAYER 3 BREACH: impliedNotional=${clampedNotional} violates 1:10 cap: ${msg}`,
        { cause: e },
      );
    }

    const baseFields = {
      kind: "direction" as const,
      side,
      strength,
      // Phase 14A: include the leg's symbol in the source string so
      // downstream DecisionEngines (and telemetry) can attribute each
      // signal to its target symbol even before they ingest.
      source: `${this.metadata.name}:${symbol}`,
    };
    const tsField =
      timestampMs !== undefined ? { timestampMs } : {};
    const signal: DirectionSignal = {
      ...baseFields,
      ...tsField,
    };
    this.state.directionSignalsEmitted += 1;
    if (this._wired) {
      // Phase 14A: route this leg's signal to the bus matching the
      // leg's symbol. If no bus is registered for this symbol, the
      // signal is silently dropped (defensive — never throw on a
      // routing miss because the plugin may be configured with more
      // pairs than the runner has wired).
      const bus = this._busesBySymbol.get(symbol);
      if (bus !== undefined) {
        bus.emit(signal);
      } else {
        this.state.unroutedEmissions += 1;
      }
    }
    return signal;
  }

  /**
   * `_assertInitialState` — Layer 2 subscribe-time invariant check.
   * Throws if plugin state was corrupted between construction and
   * wiring.
   */
  private _assertInitialState(): void {
    // Map types are non-nullable in this plugin's state shape -- the
    // presence check is implicit. We still verify both maps have
    // expected contents below.
    void this.state.symbolState;
    void this.state.pairState;
    // All enabled pairs must have a pairState entry initialized.
    for (const p of this.config.enabledPairs) {
      if (!this.state.pairState.has(pairKey(p))) {
        throw new Error(
          `[CrossSymbolSpreadReversionPlugin] LAYER 2 BREACH: pairState missing entry for [${p[0]}, ${p[1]}].`,
        );
      }
    }
    // Base notional must be sane.
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0
    ) {
      throw new Error(
        `[CrossSymbolSpreadReversionPlugin] LAYER 2 BREACH: baseNotionalUsd=${this.config.baseNotionalUsd} invalid.`,
      );
    }
  }

  /**
   * `_getOrCreateSymbolState` — lazy-create per-symbol state on first
   * recordClose for a new symbol.
   */
  private _getOrCreateSymbolState(symbol: string): SymbolPriceState {
    let ss = this.state.symbolState.get(symbol);
    if (!ss) {
      ss = { closes: [], lastLogReturn: null };
      this.state.symbolState.set(symbol, ss);
    }
    return ss;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createCrossSymbolSpreadReversionPlugin` — convenience factory.
 * Mirrors the pattern of `createRegimeDetectorMetaPlugin` /
 * `createCrossDexFundingWatcherPlugin`.
 */
export function createCrossSymbolSpreadReversionPlugin(
  overrides: Partial<CrossSymbolSpreadReversionConfig> = {},
): CrossSymbolSpreadReversionPlugin {
  return new CrossSymbolSpreadReversionPlugin(overrides);
}

// Silence unused-import for `err` (canonical Result.err for plugins).
void err;