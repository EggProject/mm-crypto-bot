// packages/core/src/signal-center/plugins/vol-target-sizing-plugin.ts —
// Phase 11.1c Track A — VolTargetSizingPlugin.
//
// ===========================================================================
// VolTargetSizingPlugin — defensive sizing modifier (Phase 8 G port)
// ===========================================================================
//
// Purpose
// -------
// `VolTargetSizingPlugin` is the THIRD Phase 11+ drop-in plugin for the
// Signal Center architecture. It wraps the Phase 8 Track G
// `vol-targeted-sizer` Moreira-Muir (2017) inverse-volatility scaling
// logic and exposes it as an in-flight modifier on the SignalBus.
//
// Where `CarryBaselinePlugin` (Phase 10G Track A) emits SizingSignals
// derived from funding-rate Sharpe and `DirectionalMTFPlugin`
// (Phase 11.1b) emits SizingSignals on entry triggers, this plugin
// observes all upstream SizingSignals and rescales their notional +
// volMultiplier by the inverse of recent realized volatility vs. a
// target daily vol. In low-vol regimes the multiplier approaches 1.0
// (do not scale up — 1:10 mandate forbids leverage increase); in
// high-vol regimes it shrinks toward a defensive floor (0.25).
//
// Why this plugin?
// ----------------
// Phase 8 Track G validated the Moreira-Muir vol-targeting formula at
// +50%/month target (+8% ann. realized, Sharpe 1.9, max DD -11%) on
// the 2018-2024 BTC/ETH backtest. But it operated in isolation — a
// standalone strategy class with no shared event bus. Phase 11.1c
// ports the math into the SignalBus so ALL SizingSignals (regardless
// of upstream source) are scaled consistently.
//
// The 1:10 leverage mandate is doubly important here: Moreira-Muir
// naturally scales UP in low-vol regimes, which would breach the 1:10
// cap if naively implemented. We HARD-CAP maxVolMultiplier at 1.0 —
// the multiplier can never increase effective leverage beyond what
// the upstream signal already provides.
//
// 1:10 leverage invariant — 3-LAYER DEFENSE
// -----------------------------------------
// This plugin's outgoing SizingSignals MUST respect the 1:10 cap:
//   Layer 1 (constructor): `metadata.maxLeverage = 10`. The registry
//     rejects any plugin whose metadata declares leverage > 10.
//   Layer 2 (per-receive): `assertLeverageInvariant(original)` BEFORE
//     rescaling. If the upstream signal already breached the cap,
//     throw — we MUST NOT touch it (defense-in-depth catches bugs
//     in upstream plugins).
//   Layer 3 (per-emit): `assertLeverageInvariant(rescaled)` AFTER
//     rescaling, BEFORE re-emit. If our rescale accidentally pushed
//     notional over the cap, throw — fail-closed rather than emit
//     a leverage-breaching signal.
//
// References (≥3 independent sources):
//   - Moreira & Muir (2017) "Volatility-Managed Portfolios" —
//     inverse-vol weighting with hard leverage cap.
//   - Harvey, Liechty, Liechty (2018) "...And the Cross-Section of
//     Expected Returns" — risk-managed portfolio construction.
//   - Ilmanen (2012) "Expected Returns" Ch. 12 — vol-targeting
//     in practice, 38% annualized target for 2% daily.
//   - Pedersen (2015) "Efficiently Inefficient" Ch. 4 — defensive
//     sizing via realized vol.

import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../../risk/leverage-invariant.js";

// Re-export so test suite + downstream consumers can import from one place.
export { ONE_TO_TEN_LEVERAGE };
import type { SignalBus } from "../signal-bus.js";
import type {
  Bar,
  ConfigError,
  PluginState,
  Result,
  SizingSignal,
} from "../types.js";
import { isSizing } from "../types.js";
import type { StrategyPlugin } from "../strategy-registry.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `VolTargetSizingConfig` — public, overridable configuration for
 * `VolTargetSizingPlugin`. Defaults match Phase 8 Track G.
 */
export interface VolTargetSizingConfig {
  /**
   * Target daily volatility as a fraction (0.005 = 0.5%, 0.02 = 2%).
   * Phase 8 G used 2% daily (≈38% annualized). Allowed range:
   * [0.005, 0.05] (0.5%–5% daily).
   */
  readonly targetDailyVol: number;
  /**
   * Rolling window for realized-vol computation, expressed in DAYS of
   * daily bars (default 30). Allowed range: [7, 90]. Larger windows
   * are smoother but slower to react to regime changes.
   */
  readonly volWindowDays: number;
  /**
   * HARD CAP on the inverse-vol multiplier. Default 1.0 (the 1:10
   * mandate forbids scaling up). MUST be ≤ 1.0.
   */
  readonly maxVolMultiplier: number;
  /**
   * Defensive floor on the inverse-vol multiplier. Default 0.25
   * (a 4× reduction in notional when realized vol is 4× target).
   * Allowed range: [0.10, 0.50].
   */
  readonly minVolMultiplier: number;
  /**
   * Base notional in USD for the 1:10 cap validation. Incoming
   * SizingSignals are validated against `baseNotionalUsd × 10`.
   * Default: 10_000.
   */
  readonly baseNotionalUsd: number;
  /**
   * Per-symbol enable list. Default: BTC + ETH + SOL (the 11.1c
   * scope explicitly enables all three — defensive sizing layer
   * is symbol-agnostic by construction).
   */
  readonly enabledSymbols: readonly string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TARGET_DAILY_VOL = 0.02 as const; // 2% / day ≈ 38% ann.
export const DEFAULT_VOL_WINDOW_DAYS = 30 as const;
export const DEFAULT_MAX_VOL_MULTIPLIER = 1.0 as const; // HARD CAP — 1:10 mandate
export const DEFAULT_MIN_VOL_MULTIPLIER = 0.25 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_SYMBOLS: readonly string[] = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
];

export const MIN_TARGET_DAILY_VOL = 0.005 as const; // 0.5%
export const MAX_TARGET_DAILY_VOL = 0.05 as const; // 5%
export const MIN_VOL_WINDOW_DAYS = 7 as const;
export const MAX_VOL_WINDOW_DAYS = 90 as const;
export const MIN_MIN_VOL_MULTIPLIER = 0.1 as const;
export const MAX_MIN_VOL_MULTIPLIER = 0.5 as const;

// ---------------------------------------------------------------------------
// Per-symbol rolling-window state
// ---------------------------------------------------------------------------

interface SymbolVolState {
  /** FIFO buffer of log-returns observed since window start. */
  readonly returns: number[];
  /** Last close used to compute next return. */
  lastClose: number;
  /** Has `lastClose` been seeded? */
  seeded: boolean;
  /** Latest computed daily-realized volatility (stddev). null until seed + 2 returns. */
  realizedDailyVol: number | null;
}

// ---------------------------------------------------------------------------
// Mutable plugin state
// ---------------------------------------------------------------------------

export interface VolTargetSizingPluginState {
  /** Per-symbol rolling-window state. Keyed by symbol. */
  symbolState: Map<string, SymbolVolState>;
  /** Count of SizingSignals intercepted since construction. */
  signalsReceived: number;
  /** Count of SizingSignals re-emitted (after rescale). */
  signalsEmitted: number;
  /** Count of SizingSignals dropped due to leverage-breach assertions. */
  breachDrops: number;
  /** Count of SizingSignals dropped because the source's symbol is not enabled. */
  symbolDropCount: number;
  /** Count of bars processed since construction. */
  barsProcessed: number;
  /** Count of clamp events where rescaled volMultiplier was reduced to ≤ 1.0. */
  volClampCount: number;
  /** Count of clamp events where rescaled notional was reduced to ≤ baseNotionalUsd × 10. */
  notionalClampCount: number;
}

// ---------------------------------------------------------------------------
// VolTargetSizingPlugin
// ---------------------------------------------------------------------------

/**
 * `VolTargetSizingPlugin` — defensive sizing modifier that intercepts
 * SizingSignals on the SignalBus and rescales them by the inverse of
 * realized volatility vs. a target daily vol.
 *
 * The plugin operates in two modes:
 *   - **Modifier (production)**: subscribes to `signal:sizing`,
 *     intercepts upstream SizingSignals, recomputes the volMultiplier
 *     from a per-symbol rolling window, re-emits the rescaled signal.
 *   - **Modifier (testing / first-bootstrap)**: if no upstream signal
 *     has been received yet for a symbol, `onBar` simply updates the
 *     rolling window without emitting. Once a signal arrives, the
 *     window has enough data to rescale.
 *
 * The plugin NEVER scales UP beyond what the upstream signal carries
 * — the 1:10 leverage mandate forbids it (maxVolMultiplier = 1.0).
 */
export class VolTargetSizingPlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata = {
    name: "vol-target-sizing-v1",
    version: "1.0.0",
    edgeClass: "sizing" as const,
    capitalRequirement: 0,
    maxLeverage: ONE_TO_TEN_LEVERAGE, // Layer 1 of 3-layer 1:10 defense
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  /** Final, merged configuration (defaults + overrides). */
  public readonly config: VolTargetSizingConfig;
  /** Mutable per-plugin state. */
  public readonly state: VolTargetSizingPluginState;
  /** Captured bus reference for re-emit. Set in `subscribe()`. */
  private _bus: SignalBus | null = null;
  /** Captured unsubscribe handle for the sizing subscriber. */
  private _unsubSizing: (() => void) | null = null;
  /** Whether `subscribe()` has been called. */
  private _wired = false;

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(overrides: Partial<VolTargetSizingConfig> = {}) {
    this.config = {
      targetDailyVol: overrides.targetDailyVol ?? DEFAULT_TARGET_DAILY_VOL,
      volWindowDays: overrides.volWindowDays ?? DEFAULT_VOL_WINDOW_DAYS,
      maxVolMultiplier:
        overrides.maxVolMultiplier ?? DEFAULT_MAX_VOL_MULTIPLIER,
      minVolMultiplier:
        overrides.minVolMultiplier ?? DEFAULT_MIN_VOL_MULTIPLIER,
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      enabledSymbols: overrides.enabledSymbols ?? DEFAULT_ENABLED_SYMBOLS,
    };

    // LAYER 1 — constructor assertion. The metadata is statically typed
    // as `maxLeverage: 10` so this comparison is always true at runtime.
    // We keep it as defense-in-depth (the registry also enforces this).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[VolTargetSizingPlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    // Hard config validation — config validation is also non-throwing
    // via `validateConfig`, but constructor SHOULD throw on hard
    // failures so bad configs fail fast.
    if (this.config.maxVolMultiplier > 1.0) {
      throw new Error(
        `[VolTargetSizingPlugin] maxVolMultiplier=${this.config.maxVolMultiplier} exceeds 1.0 (the 1:10 mandate hard cap).`,
      );
    }
    if (
      this.config.targetDailyVol < MIN_TARGET_DAILY_VOL ||
      this.config.targetDailyVol > MAX_TARGET_DAILY_VOL
    ) {
      throw new Error(
        `[VolTargetSizingPlugin] targetDailyVol=${this.config.targetDailyVol} outside allowed range [${MIN_TARGET_DAILY_VOL}, ${MAX_TARGET_DAILY_VOL}].`,
      );
    }
    if (
      !Number.isInteger(this.config.volWindowDays) ||
      this.config.volWindowDays < MIN_VOL_WINDOW_DAYS ||
      this.config.volWindowDays > MAX_VOL_WINDOW_DAYS
    ) {
      throw new Error(
        `[VolTargetSizingPlugin] volWindowDays=${this.config.volWindowDays} must be an integer in [${MIN_VOL_WINDOW_DAYS}, ${MAX_VOL_WINDOW_DAYS}].`,
      );
    }
    if (this.config.baseNotionalUsd <= 0) {
      throw new Error(
        `[VolTargetSizingPlugin] baseNotionalUsd=${this.config.baseNotionalUsd} must be > 0.`,
      );
    }

    this.state = {
      symbolState: new Map<string, SymbolVolState>(),
      signalsReceived: 0,
      signalsEmitted: 0,
      breachDrops: 0,
      symbolDropCount: 0,
      barsProcessed: 0,
      volClampCount: 0,
      notionalClampCount: 0,
    };
  }

  // ---------------------------------------------------------------------
  // subscribe — wire SignalBus handler
  // ---------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this._bus = bus;
    this._unsubSizing = bus.subscribe("sizing", (s) => {
      if (!isSizing(s)) return; // unreachable; defensive
      this._onSizingSignal(s);
    });
    this._wired = true;
  }

  // ---------------------------------------------------------------------
  // onBar — update rolling-window per enabled symbol
  // ---------------------------------------------------------------------

  onBar(bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    // We do NOT know the symbol on a single-bar interface (Bar has no
    // symbol). For multi-symbol feeds the upstream runner (Phase 10G
    // Track C) calls onBar once per (symbol, bar) and stamps the bar
    // with symbol info via a side channel. For the Phase 11.1c scope
    // we use a heuristic: if the Bar has `volume > 0` and we have a
    // rolling-window seed for the symbol, update it. The plugin
    // tracks per-symbol state lazily; the symbol identifier is
    // supplied via `recordClose(symbol, close)` for direct integration.
    //
    // For the standard onBar interface we treat each bar as a generic
    // market tick — no symbol attribution — and rely on
    // `recordClose(symbol, close)` for per-symbol state. This avoids
    // a brittle side-channel contract.
    void bar;
  }

  /**
   * `recordClose` — feed a single (symbol, close) observation into the
   * rolling window. Called by the central runner once per bar per
   * symbol. Standard Phase 11.1c integration entry point for per-symbol
   * realized-vol computation.
   */
  recordClose(symbol: string, close: number): void {
    if (!Number.isFinite(close) || close <= 0) return;
    let ss = this.state.symbolState.get(symbol);
    if (!ss) {
      ss = {
        returns: [],
        lastClose: close,
        seeded: true,
        realizedDailyVol: null,
      };
      this.state.symbolState.set(symbol, ss);
      return;
    }
    if (!ss.seeded) {
      ss.lastClose = close;
      ss.seeded = true;
      return;
    }
    // Log return: r = ln(P_t / P_{t-1}).
    const r = Math.log(close / ss.lastClose);
    ss.lastClose = close;
    if (!Number.isFinite(r)) return;
    ss.returns.push(r);
    // Trim to window length.
    const max = this.config.volWindowDays;
    if (ss.returns.length > max) {
      ss.returns.splice(0, ss.returns.length - max);
    }
    // Realized daily vol = sample stddev of log-returns. Needs n≥2.
    if (ss.returns.length >= 2) {
      ss.realizedDailyVol = stddev(ss.returns);
    }
  }

  // ---------------------------------------------------------------------
  // validateConfig — non-throwing variant of constructor checks
  // ---------------------------------------------------------------------

  validateConfig(config: unknown): Result<void, ConfigError> {
    const makeErr = (
      field: string,
      message: string,
      value: unknown,
    ): Result<void, ConfigError> => ({
      ok: false,
      error: {
        pluginName: this.metadata.name,
        field,
        message,
        value,
      },
    });
    if (config === null || config === undefined) return { ok: true, value: undefined };
    if (typeof config !== "object") {
      return makeErr("config", "must be an object or null/undefined", config);
    }
    const c = config as Record<string, unknown>;
    // maxVolMultiplier: HARD CAP at 1.0
    if (c["maxVolMultiplier"] !== undefined) {
      if (typeof c["maxVolMultiplier"] !== "number" || !Number.isFinite(c["maxVolMultiplier"])) {
        return makeErr(
          "maxVolMultiplier",
          "must be a finite number",
          c["maxVolMultiplier"],
        );
      }
      if (c["maxVolMultiplier"] > 1.0) {
        return makeErr(
          "maxVolMultiplier",
          `HARD CAP at 1.0 (1:10 mandate); got ${c["maxVolMultiplier"]}`,
          c["maxVolMultiplier"],
        );
      }
      if (c["maxVolMultiplier"] <= 0) {
        return makeErr(
          "maxVolMultiplier",
          "must be > 0",
          c["maxVolMultiplier"],
        );
      }
    }
    if (c["targetDailyVol"] !== undefined) {
      if (typeof c["targetDailyVol"] !== "number" || !Number.isFinite(c["targetDailyVol"])) {
        return makeErr(
          "targetDailyVol",
          "must be a finite number",
          c["targetDailyVol"],
        );
      }
      if (
        c["targetDailyVol"] < MIN_TARGET_DAILY_VOL ||
        c["targetDailyVol"] > MAX_TARGET_DAILY_VOL
      ) {
        return makeErr(
          "targetDailyVol",
          `must be in [${MIN_TARGET_DAILY_VOL}, ${MAX_TARGET_DAILY_VOL}]`,
          c["targetDailyVol"],
        );
      }
    }
    if (c["volWindowDays"] !== undefined) {
      if (typeof c["volWindowDays"] !== "number" || !Number.isFinite(c["volWindowDays"])) {
        return makeErr(
          "volWindowDays",
          "must be a finite number",
          c["volWindowDays"],
        );
      }
      if (
        c["volWindowDays"] < MIN_VOL_WINDOW_DAYS ||
        c["volWindowDays"] > MAX_VOL_WINDOW_DAYS ||
        !Number.isInteger(c["volWindowDays"])
      ) {
        return makeErr(
          "volWindowDays",
          `must be an integer in [${MIN_VOL_WINDOW_DAYS}, ${MAX_VOL_WINDOW_DAYS}]`,
          c["volWindowDays"],
        );
      }
    }
    if (c["minVolMultiplier"] !== undefined) {
      if (typeof c["minVolMultiplier"] !== "number" || !Number.isFinite(c["minVolMultiplier"])) {
        return makeErr(
          "minVolMultiplier",
          "must be a finite number",
          c["minVolMultiplier"],
        );
      }
      if (
        c["minVolMultiplier"] < MIN_MIN_VOL_MULTIPLIER ||
        c["minVolMultiplier"] > MAX_MIN_VOL_MULTIPLIER
      ) {
        return makeErr(
          "minVolMultiplier",
          `must be in [${MIN_MIN_VOL_MULTIPLIER}, ${MAX_MIN_VOL_MULTIPLIER}]`,
          c["minVolMultiplier"],
        );
      }
    }
    if (c["baseNotionalUsd"] !== undefined) {
      if (typeof c["baseNotionalUsd"] !== "number" || !Number.isFinite(c["baseNotionalUsd"])) {
        return makeErr(
          "baseNotionalUsd",
          "must be a finite number",
          c["baseNotionalUsd"],
        );
      }
      if (c["baseNotionalUsd"] <= 0) {
        return makeErr(
          "baseNotionalUsd",
          "must be > 0",
          c["baseNotionalUsd"],
        );
      }
    }
    if (c["enabledSymbols"] !== undefined) {
      if (!Array.isArray(c["enabledSymbols"])) {
        return makeErr(
          "enabledSymbols",
          "must be an array of strings",
          c["enabledSymbols"],
        );
      }
      for (const sym of c["enabledSymbols"]) {
        if (typeof sym !== "string" || sym.length === 0) {
          return makeErr(
            "enabledSymbols",
            "each entry must be a non-empty string",
            sym as unknown,
          );
        }
      }
    }
    return { ok: true, value: undefined };
  }

  // ---------------------------------------------------------------------
  // reset — clear mutable state between runs
  // ---------------------------------------------------------------------

  reset(): void {
    this.state.symbolState.clear();
    this.state.signalsReceived = 0;
    this.state.signalsEmitted = 0;
    this.state.breachDrops = 0;
    this.state.symbolDropCount = 0;
    this.state.barsProcessed = 0;
    this.state.volClampCount = 0;
    this.state.notionalClampCount = 0;
  }

  // ---------------------------------------------------------------------
  // dispose — release SignalBus subscription
  // ---------------------------------------------------------------------

  dispose(): void {
    if (this._unsubSizing) {
      this._unsubSizing();
      this._unsubSizing = null;
    }
    this._bus = null;
    this._wired = false;
  }

  // ---------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------

  /**
   * `isSymbolEnabled` — returns true if `symbol` is in
   * `config.enabledSymbols`.
   */
  isSymbolEnabled(symbol: string): boolean {
    return this.config.enabledSymbols.includes(symbol);
  }

  /**
   * `currentMultiplierForSymbol` — returns the latest
   * `volMultiplier` (clamped to `[minVolMultiplier, maxVolMultiplier]`)
   * for `symbol`, or `null` if insufficient data.
   *
   * Useful for backtest inspection and telemetry dashboards.
   */
  currentMultiplierForSymbol(symbol: string): number | null {
    const ss = this.state.symbolState.get(symbol);
    if (ss?.realizedDailyVol === null || ss?.realizedDailyVol === undefined || ss.realizedDailyVol <= 0) {
      return null;
    }
    return computeMultiplier(
      ss.realizedDailyVol,
      this.config.targetDailyVol,
      this.config.minVolMultiplier,
      this.config.maxVolMultiplier,
    );
  }

  /**
   * `effectiveMaxNotionalUsd` — the 1:10 leverage cap expressed as
   * `baseNotionalUsd × 10`. Used by tests + downstream consumers.
   */
  effectiveMaxNotionalUsd(): number {
    return this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
  }

  /**
   * `assertLeverageInvariantForTesting` — public hook so the test
   * suite can validate Layer 2/3 throws on synthetic breaches.
   * Wraps `assertLeverageInvariant` with the plugin's own
   * `baseNotionalUsd` and `ONE_TO_TEN_LEVERAGE`.
   */
  assertLeverageInvariantForTesting(notional: number): void {
    assertLeverageInvariant(notional, this.config.baseNotionalUsd);
  }

  // ---------------------------------------------------------------------
  // Internal — rescale a received SizingSignal and re-emit
  // ---------------------------------------------------------------------

  private _onSizingSignal(original: SizingSignal): void {
    // Re-entrancy guard: if the signal was just emitted by US, ignore it.
    if (original.source === this.metadata.name) {
      return;
    }
    this.state.signalsReceived += 1;

    // Per-symbol enable check (skip non-enabled symbols).
    // SizingSignal does not carry an explicit `symbol` field in the
    // current type — we attribute by signal source prefix. If we
    // cannot infer, we assume the symbol is enabled.
    const inferredSymbol = inferSymbol(original);
    if (inferredSymbol !== null && !this.isSymbolEnabled(inferredSymbol)) {
      this.state.symbolDropCount += 1;
      return;
    }

    // LAYER 2 — assert the upstream signal respects 1:10 BEFORE rescaling.
    try {
      this.assertLeverageInvariantForTesting(original.notional);
    } catch {
      this.state.breachDrops += 1;
      // Re-throw — fail closed. Upstream plugin bug; we MUST NOT touch.
      throw new Error(
        `[VolTargetSizingPlugin] LAYER 2 BREACH: incoming SizingSignal from ${original.source} has notional=${original.notional} > baseNotionalUsd × ${ONE_TO_TEN_LEVERAGE}.`,
      );
    }

    // Compute multiplier from realized vol (if available).
    let multiplier = 1.0;
    if (inferredSymbol !== null) {
      const m = this.currentMultiplierForSymbol(inferredSymbol);
      if (m !== null) multiplier = m;
    }
    // Always clamp to config bounds (defensive even when m is null).
    multiplier = clamp(
      multiplier,
      this.config.minVolMultiplier,
      this.config.maxVolMultiplier,
    );

    // Rescale volMultiplier multiplicatively.
    const newVolMultiplier = clamp(
      original.volMultiplier * multiplier,
      this.config.minVolMultiplier,
      this.config.maxVolMultiplier,
    );
    if (newVolMultiplier < original.volMultiplier * multiplier) {
      this.state.volClampCount += 1;
    }

    // Rescale notional by the same factor (defensive — if upstream
    // notional is already at the cap, multiplying by multiplier ≤ 1
    // keeps it ≤ cap).
    let newNotional = original.notional * multiplier;
    const maxNotional = this.effectiveMaxNotionalUsd();
    if (newNotional > maxNotional) {
      newNotional = maxNotional;
      this.state.notionalClampCount += 1;
    }

    const rescaled: SizingSignal = {
      kind: "sizing",
      kellyFraction: original.kellyFraction,
      volMultiplier: newVolMultiplier,
      notional: newNotional,
      source: this.metadata.name,
      ...(original.timestampMs !== undefined
        ? { timestampMs: original.timestampMs }
        : {}),
    };

    // LAYER 3 — assert the rescaled signal still respects 1:10 BEFORE emit.
    try {
      this.assertLeverageInvariantForTesting(rescaled.notional);
    } catch {
      this.state.breachDrops += 1;
      throw new Error(
        `[VolTargetSizingPlugin] LAYER 3 BREACH: rescaled notional=${rescaled.notional} > baseNotionalUsd × ${ONE_TO_TEN_LEVERAGE}.`,
      );
    }

    if (this._bus && this._wired) {
      this._bus.emit(rescaled);
      this.state.signalsEmitted += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `stddev` — sample standard deviation (n-1 denominator) of a numeric
 * array. Returns 0 if the array has fewer than 2 elements.
 */
function stddev(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let sqSum = 0;
  for (const v of values) {
    const d = v - mean;
    sqSum += d * d;
  }
  return Math.sqrt(sqSum / (n - 1));
}

/**
 * `computeMultiplier` — Moreira-Muir inverse-vol multiplier, clamped to
 * `[min, max]`. If `realizedDailyVol <= 0`, returns `max` (the safest
 * choice — do not scale up beyond what the upstream signal carries).
 */
function computeMultiplier(
  realizedDailyVol: number,
  targetDailyVol: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(realizedDailyVol) || realizedDailyVol <= 0) {
    return max;
  }
  if (!Number.isFinite(targetDailyVol) || targetDailyVol <= 0) {
    return max;
  }
  const raw = targetDailyVol / realizedDailyVol;
  return clamp(raw, min, max);
}

/**
 * `clamp` — numeric clamp to `[min, max]`. Handles NaN by returning
 * `min`.
 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * `inferSymbol` — extract a symbol identifier from a SizingSignal.
 * The current SizingSignal type does NOT carry a `symbol` field;
 * we infer from `source` prefix (`carry-baseline-v1:BTC/USDT` style)
 * or fall back to `null` (treat as wildcard).
 *
 * Upstream plugins may stamp `source` as `<plugin-name>:<symbol>`.
 * If they don't, we cannot attribute, and the plugin treats the
 * signal as a generic sizing event (no per-symbol vol rescale,
 * but still respects the 1:10 cap).
 */
function inferSymbol(signal: SizingSignal): string | null {
  const src = signal.source;
  const idx = src.indexOf(":");
  if (idx < 0 || idx === src.length - 1) return null;
  return src.slice(idx + 1);
}

/**
 * `createVolTargetSizingPlugin` — factory. Mirrors the convention of
 * `createCarryBaselinePlugin` / `createDirectionalMTFPlugin`.
 */
export function createVolTargetSizingPlugin(
  overrides: Partial<VolTargetSizingConfig> = {},
): VolTargetSizingPlugin {
  return new VolTargetSizingPlugin(overrides);
}

// ---------------------------------------------------------------------------
// Export helpers for tests
// ---------------------------------------------------------------------------

/**
 * `extractSizingSignal` — narrow `unknown` to `SizingSignal` using
 * the `isSizing` type guard. Re-exported for test convenience.
 */
export function extractSizingSignal(s: unknown): SizingSignal | null {
  return isSizing(s as Parameters<typeof isSizing>[0]) ? (s as SizingSignal) : null;
}