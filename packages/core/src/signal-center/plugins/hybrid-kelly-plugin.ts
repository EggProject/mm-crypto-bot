// packages/core/src/signal-center/plugins/hybrid-kelly-plugin.ts —
// Phase 11.1e Track A — HybridKellyPlugin.
//
// ===========================================================================
// HybridKellyPlugin — CARRY-SIDE ADAPTIVE SIZING (Phase 9 9E port)
// ===========================================================================
//
// Purpose
// -------
// HybridKellyPlugin is the FOURTH and FINAL Phase 11+ drop-in plugin for
// the Signal Center architecture. It wraps the validated Phase 9 9E
// `adaptive-kelly-vol-hybrid` (Adaptive Kelly × VolTarget hybrid) and
// exposes it as an in-flight MODIFIER on the SignalBus. The plugin
// observes upstream CarrySignals (funding-rate state) and SizingSignals
// (carry baseline's recommended sizing) and rescales them with a
// funding-Sharpe-based Kelly bucket × realized-vol multiplier.
//
// Why this plugin?
// ----------------
// Phase 9 9E validated the hybrid formula on BTC/ETH/SOL walk-forward
// OOS:
//   - BTC OOS Sharpe +0.0477 (+1006 bps vs Track B, +358 bps vs Track G,
//     DD reduced -45% vs in-sample)
//   - ETH OOS Sharpe -0.0155 (+261 bps vs B, +4 vs G, DD -51%)
//   - SOL OOS Sharpe +0.1039 (+1325 bps vs B, +1130 vs G, DD -11.7%)
// The plugin ports 9E into the SignalBus as a drop-in: no central-runner
// surgery, just `plugin = new HybridKellyPlugin(); registry.register(plugin)`.
//
// The 1:10 leverage mandate is enforced via the multiplicative
// composition: `my_factor = my_kelly × my_vol ∈ [0.0625, 1.0]`. We NEVER
// scale UP (factor > 1.0) — the upstream's recommendation is the ceiling.
// All four Phase 11.1 plugins (11.1b DirectionalMTF + 11.1d SOLFlipKill
// + 11.1c VolTargetSizing + 11.1e HybridKelly) compose into the SCv1
// portfolio without breaching the 1:10 mandate.
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
// Per-symbol disclosure (Phase 11.1e scope plan §1):
//   - BTC/USDT: REGISTERED (default-on, Phase 9 9E validated)
//   - ETH/USDT: REGISTERED (default-on, Phase 9 9E validated)
//   - SOL/USDT: REGISTERED (default-on, Phase 9 9E validated)
//
// What this plugin does NOT do:
//   - Does NOT emit CarrySignals or DirectionSignals (defensive modifier only).
//   - Does NOT generate alpha — it rescales existing sizing decisions.
//   - Does NOT extend the 1:10 leverage ceiling (caps at 1.0).
//
// References (≥3 independent sources on hybrid sizing):
//   - Thorp (2006) "The Kelly Criterion in Blackjack, Sports Betting,
//     and the Stock Market" — fractional Kelly sweet spot (half-Kelly).
//     https://gwern.net/doc/statistics/decision/2006-thorp.pdf
//   - Moreira & Muir (2017) "Volatility-Managed Portfolios" Journal of
//     Finance 72(4): 1611-1644 — the seminal vol-targeting paper.
//     https://law.yale.edu/sites/default/files/area/workshop/leo/leo17_moreira.pdf
//   - MacLean, Ziemba (2012) "Fractional Kelly Strategies in Continuous
//     Time" + Lasfer, Qi, Wang (2022) "Multivariate Volatility Regulated
//     Kelly Strategy" — academic precedent for Kelly × variance penalization.
//     https://www.scirp.org/journal/paperinformation?paperid=78441
//   - arXiv 2508.16598 (Aug 2025) "Sizing the Risk: Kelly, VIX, and
//     Hybrid Approaches in Put-Writing on Index Options" — academic
//     precedent for combining Kelly with vol-regime scaling.
//     https://arxiv.org/html/2508.16598v1
//   - Phase 9 9E source (this project's empirical validation): see
//     `packages/core/src/risk/adaptive-kelly-vol-hybrid.ts` for the
//     full per-symbol walk-forward validation at 1:10 leverage.

import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../../risk/leverage-invariant.js";
import { computeVolMultiplier } from "../../risk/vol-targeted-sizer.js";
import {
  sharpeToKellyBucket,
  type AdaptiveKellyBucket,
} from "../../risk/kelly-adaptive.js";

// Re-export so test suite + downstream consumers can import from one place.
export { ONE_TO_TEN_LEVERAGE };

import type { SignalBus } from "../signal-bus.js";
import type {
  StrategyPlugin,
  StrategyPluginMetadata,
} from "../strategy-registry.js";
import {
  type Bar,
  type CarrySignal,
  type ConfigError,
  type PluginState,
  type Result,
  type SizingSignal,
  isCarry,
  isSizing,
} from "../types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `HybridKellyConfig` — public, overridable configuration for
 * `HybridKellyPlugin`. Defaults match Phase 9 9E + the 1:10 mandate.
 */
export interface HybridKellyConfig {
  /**
   * HARD CAP on the Kelly fraction multiplier. Default 1.0 (the 1:10
   * mandate forbids Kelly > 1.0 = full Kelly at this base). MUST be
   * ≤ 1.0.
   */
  readonly kellyCap: number;
  /**
   * HARD CAP on the vol multiplier. Default 1.0 (the 1:10 mandate
   * caps Moreira-Muir's "scale up" half at 1.0). MUST be ≤ 1.0.
   */
  readonly maxVolMultiplier: number;
  /**
   * Defensive floor on the vol multiplier. Default 0.25
   * (1:10 × 0.25 = 2.5× effective minimum leverage).
   */
  readonly minVolMultiplier: number;
  /**
   * Target daily volatility as a fraction (0.02 = 2%). Used by the
   * Moreira-Muir vol-targeting computation. Allowed range: [0.005, 0.05].
   */
  readonly targetDailyVol: number;
  /**
   * Rolling window for realized-vol computation, in DAYS of bars
   * (default 30 — matches Phase 8 Track G / Phase 9 9E).
   */
  readonly volWindowDays: number;
  /**
   * Rolling window for funding-rate Sharpe computation, in DAYS
   * (default 30 — matches Phase 9 9E). The funding-rate history is
   * the plugin's "edge quality" signal — a higher funding-Sharpe
   * means the carry is producing reliable positive returns.
   */
  readonly fundingSharpeWindowDays: number;
  /**
   * Base notional in USD for the 1:10 cap validation. Incoming
   * SizingSignals are validated against `baseNotionalUsd × 10`.
   * Default: 10_000.
   */
  readonly baseNotionalUsd: number;
  /**
   * Per-symbol enable list. Phase 11.1e scope plan §1: BTC + ETH +
   * SOL all default-on. The hybrid is symbol-agnostic by construction.
   */
  readonly enabledSymbols: readonly string[];
}

// ---------------------------------------------------------------------------
// Defaults + bounds
// ---------------------------------------------------------------------------

export const DEFAULT_KELLY_CAP = 1.0 as const; // HARD CAP — 1:10 mandate
export const DEFAULT_MAX_VOL_MULTIPLIER = 1.0 as const; // HARD CAP — 1:10 mandate
export const DEFAULT_MIN_VOL_MULTIPLIER = 0.25 as const;
export const DEFAULT_TARGET_DAILY_VOL = 0.02 as const;
export const DEFAULT_VOL_WINDOW_DAYS = 30 as const;
export const DEFAULT_FUNDING_SHARPE_WINDOW_DAYS = 30 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_SYMBOLS: readonly string[] = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
];

export const MIN_TARGET_DAILY_VOL = 0.005 as const;
export const MAX_TARGET_DAILY_VOL = 0.05 as const;
export const MIN_VOL_WINDOW_DAYS = 7 as const;
export const MAX_VOL_WINDOW_DAYS = 90 as const;
export const MIN_FUNDING_SHARPE_WINDOW_DAYS = 7 as const;
export const MAX_FUNDING_SHARPE_WINDOW_DAYS = 90 as const;

// ---------------------------------------------------------------------------
// Per-symbol rolling-window state
// ---------------------------------------------------------------------------

interface SymbolState {
  /** FIFO buffer of 8h funding-rate samples (most-recent last). */
  readonly fundingSamples: number[];
  /** FIFO buffer of close prices for realized-vol computation. */
  readonly closes: number[];
  /** Last funding-rate used to detect carry-regime freshness. */
  lastFundingRate: number;
  /** Latest computed funding-rate Sharpe (null until ≥2 samples). */
  fundingSharpe: number | null;
  /** Kelly bucket for this symbol based on funding-Sharpe. */
  kellyBucket: AdaptiveKellyBucket;
  /** Latest realized daily vol (stddev of log returns). null until ≥2 returns. */
  realizedDailyVol: number | null;
  /** Latest vol multiplier (clamped to [minVolMult, maxVolMult]). null until data. */
  volMultiplier: number | null;
  /** Sharpe observations count (for cold-start guard). */
  fundingSharpeObservations: number;
}

// ---------------------------------------------------------------------------
// Mutable plugin state
// ---------------------------------------------------------------------------

export interface HybridKellyPluginState {
  /** Per-symbol rolling-window state. Keyed by symbol. */
  readonly symbolState: Map<string, SymbolState>;
  /** Count of CarrySignals intercepted since construction. */
  fundingSamplesReceived: number;
  /** Count of SizingSignals intercepted since construction. */
  sizingSignalsReceived: number;
  /** Count of SizingSignals re-emitted (after rescale). */
  sizingSignalsEmitted: number;
  /** Count of SizingSignals dropped due to leverage-breach assertions. */
  leverageBreachDrops: number;
  /** Count of SizingSignals dropped because the symbol is not enabled. */
  symbolDropCount: number;
  /** Count of bars processed since construction. */
  barsProcessed: number;
  /** Count of clamp events where new kellyFraction was clamped at kellyCap. */
  kellyClampCount: number;
  /** Count of clamp events where new volMultiplier was clamped at maxVolMult. */
  volClampCount: number;
  /** Count of clamp events where rescaled notional was clamped at baseNotional × 10. */
  notionalClampCount: number;
  /** Count of Layer 2 leverage-invariant assertions (BEFORE rescale). */
  layer2AssertionCount: number;
  /** Count of Layer 3 leverage-invariant assertions (AFTER rescale, BEFORE emit). */
  layer3AssertionCount: number;
  /** Last Kelly bucket computed (for diagnostics + tests). */
  lastKellyBucket: AdaptiveKellyBucket | null;
  /** Last vol multiplier computed (for diagnostics + tests). */
  lastVolMultiplier: number | null;
  /** Last emitted SizingSignal (for diagnostics + tests). */
  lastSizingSignal: SizingSignal | null;
  /** Last observed funding rate, per symbol (for diagnostics). */
  lastFundingRatePerSymbol: Map<string, number>;
}

// ---------------------------------------------------------------------------
// HybridKellyPlugin
// ---------------------------------------------------------------------------

/**
 * `HybridKellyPlugin` — carry-side adaptive sizing modifier that
 * intercepts SizingSignals on the SignalBus and rescales them by the
 * multiplicative composition of:
 *
 *   1. **Adaptive Kelly bucket** — derived from the funding-rate
 *      rolling Sharpe (4-bucket mapping: 0.25 / 0.5 / 0.7 / 1.0). The
 *      funding-Sharpe acts as the plugin's "edge quality" signal —
 *      a positive funding-Sharpe means the carry is producing reliable
 *      positive returns, justifying higher Kelly allocation. A negative
 *      funding-Sharpe forces the defensive quarter-Kelly bucket.
 *
 *   2. **Moreira-Muir vol multiplier** — inverse-vol scaling based on
 *      rolling 30d realized vol (Moreira-Muir 2017). Clamped to
 *      [minVolMultiplier, maxVolMultiplier=1.0] under the 1:10 mandate.
 *
 * Combined factor: `my_factor = kelly_bucket × vol_multiplier` ∈
 * [0.0625, 1.0] under default bounds. The final notional is
 * `upstream.notional × (my_factor / upstream_factor)` where
 * `upstream_factor = upstream.kellyFraction × upstream.volMultiplier`.
 *
 * The plugin NEVER scales UP beyond the upstream's notional — both the
 * Kelly bucket (≤ 1.0) and the vol multiplier (≤ 1.0) are ≤ 1.0, so the
 * product is ≤ 1.0. This guarantees the 1:10 mandate is maintained by
 * construction (assuming the upstream respects it; Layer 2 + Layer 3
 * assertions catch any upstream breach).
 *
 * Lifecycle:
 *   1. `new HybridKellyPlugin({ ... })`.
 *   2. `plugin.validateConfig(...)` — boot-time audit.
 *   3. `plugin.subscribe(bus)` — wire carry + sizing subscribers.
 *   4. `plugin.recordFundingSample(symbol, rate, ts)` — feed funding-rate history.
 *   5. `plugin.recordClose(symbol, close)` — feed OHLCV for realized vol.
 *   6. `plugin.onBar(bar, state)` — per-bar tick (mostly a no-op for OHLCV-driven plugin).
 *   7. `plugin.reset()` / `plugin.dispose()` — backtest lifecycle.
 */
export class HybridKellyPlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata: StrategyPluginMetadata = {
    name: "hybrid-kelly-v1",
    version: "1.0.0",
    edgeClass: "sizing",
    capitalRequirement: 0,
    maxLeverage: ONE_TO_TEN_LEVERAGE, // Layer 1 of 3-layer 1:10 defense
    description:
      "Phase 11.1e FOURTH/FINAL drop-in plugin — carry-side adaptive sizing. " +
      "Wraps Phase 9 9E Adaptive Kelly × VolTarget hybrid. Funding-Sharpe-based " +
      "Kelly bucket (0.25/0.5/0.7/1.0) × Moreira-Muir vol multiplier " +
      "(clamped to [0.25, 1.0] under 1:10 mandate). BTC/ETH/SOL default-on.",
    dependencies: [],
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  public readonly config: HybridKellyConfig;
  public readonly state: HybridKellyPluginState;
  /** Captured bus reference for emit. Set in subscribe(). */
  private _bus: SignalBus | null = null;
  /** Unsubscribe handle for the carry subscriber. */
  private _unsubCarry: (() => void) | null = null;
  /** Unsubscribe handle for the sizing subscriber. */
  private _unsubSizing: (() => void) | null = null;
  /** Whether subscribe() has been called. */
  private _wired = false;

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(overrides: Partial<HybridKellyConfig> = {}) {
    this.config = {
      kellyCap: overrides.kellyCap ?? DEFAULT_KELLY_CAP,
      maxVolMultiplier: overrides.maxVolMultiplier ?? DEFAULT_MAX_VOL_MULTIPLIER,
      minVolMultiplier: overrides.minVolMultiplier ?? DEFAULT_MIN_VOL_MULTIPLIER,
      targetDailyVol: overrides.targetDailyVol ?? DEFAULT_TARGET_DAILY_VOL,
      volWindowDays: overrides.volWindowDays ?? DEFAULT_VOL_WINDOW_DAYS,
      fundingSharpeWindowDays:
        overrides.fundingSharpeWindowDays ?? DEFAULT_FUNDING_SHARPE_WINDOW_DAYS,
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      enabledSymbols: overrides.enabledSymbols ?? DEFAULT_ENABLED_SYMBOLS,
    };

    // LAYER 1 — constructor assertion. Defense in depth — the
    // metadata is statically typed as `maxLeverage: 10`, so this
    // comparison is always true at runtime. We keep it as a runtime
    // safety check (the registry also enforces this).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[HybridKellyPlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    // Hard config validation — defense in depth. validateConfig()
    // does the non-throwing audit; constructor throws on hard
    // failures so bad configs fail fast.
    if (this.config.kellyCap > 1.0) {
      throw new Error(
        `[HybridKellyPlugin] kellyCap=${this.config.kellyCap} exceeds 1.0 (the 1:10 mandate hard cap).`,
      );
    }
    if (this.config.maxVolMultiplier > 1.0) {
      throw new Error(
        `[HybridKellyPlugin] maxVolMultiplier=${this.config.maxVolMultiplier} exceeds 1.0 (the 1:10 mandate hard cap).`,
      );
    }
    if (
      this.config.targetDailyVol < MIN_TARGET_DAILY_VOL ||
      this.config.targetDailyVol > MAX_TARGET_DAILY_VOL
    ) {
      throw new Error(
        `[HybridKellyPlugin] targetDailyVol=${this.config.targetDailyVol} outside allowed range [${MIN_TARGET_DAILY_VOL}, ${MAX_TARGET_DAILY_VOL}].`,
      );
    }
    if (
      !Number.isInteger(this.config.volWindowDays) ||
      this.config.volWindowDays < MIN_VOL_WINDOW_DAYS ||
      this.config.volWindowDays > MAX_VOL_WINDOW_DAYS
    ) {
      throw new Error(
        `[HybridKellyPlugin] volWindowDays=${this.config.volWindowDays} must be an integer in [${MIN_VOL_WINDOW_DAYS}, ${MAX_VOL_WINDOW_DAYS}].`,
      );
    }
    if (
      !Number.isInteger(this.config.fundingSharpeWindowDays) ||
      this.config.fundingSharpeWindowDays < MIN_FUNDING_SHARPE_WINDOW_DAYS ||
      this.config.fundingSharpeWindowDays > MAX_FUNDING_SHARPE_WINDOW_DAYS
    ) {
      throw new Error(
        `[HybridKellyPlugin] fundingSharpeWindowDays=${this.config.fundingSharpeWindowDays} must be an integer in [${MIN_FUNDING_SHARPE_WINDOW_DAYS}, ${MAX_FUNDING_SHARPE_WINDOW_DAYS}].`,
      );
    }
    if (this.config.baseNotionalUsd <= 0) {
      throw new Error(
        `[HybridKellyPlugin] baseNotionalUsd=${this.config.baseNotionalUsd} must be > 0.`,
      );
    }
    if (this.config.minVolMultiplier <= 0 || this.config.minVolMultiplier > this.config.maxVolMultiplier) {
      throw new Error(
        `[HybridKellyPlugin] minVolMultiplier=${this.config.minVolMultiplier} must be in (0, maxVolMultiplier=${this.config.maxVolMultiplier}].`,
      );
    }

    this.state = {
      symbolState: new Map<string, SymbolState>(),
      fundingSamplesReceived: 0,
      sizingSignalsReceived: 0,
      sizingSignalsEmitted: 0,
      leverageBreachDrops: 0,
      symbolDropCount: 0,
      barsProcessed: 0,
      kellyClampCount: 0,
      volClampCount: 0,
      notionalClampCount: 0,
      layer2AssertionCount: 0,
      layer3AssertionCount: 0,
      lastKellyBucket: null,
      lastVolMultiplier: null,
      lastSizingSignal: null,
      lastFundingRatePerSymbol: new Map<string, number>(),
    };
  }

  // ---------------------------------------------------------------------
  // subscribe — wire SignalBus handlers
  // ---------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this._bus = bus;
    // Subscribe to CarrySignals — these carry the funding-rate samples
    // needed for the funding-Sharpe-based Kelly bucket. The bus
    // subscriber is the canonical injection path: the central runner
    // emits CarrySignals from funding-rate ticks (or replayed history).
    this._unsubCarry = bus.subscribe("carry", (s) => {
      if (!isCarry(s)) return;
      this._onCarrySignal(s);
    });
    // Subscribe to SizingSignals — these are the upstream recommendations
    // we rescale. We skip signals we ourselves emitted (re-entrancy
    // guard) and signals from non-enabled symbols.
    this._unsubSizing = bus.subscribe("sizing", (s) => {
      if (!isSizing(s)) return;
      if (s.source === this.metadata.name) return; // re-entrancy guard
      this._onSizingSignal(s);
    });
    this._wired = true;
  }

  // ---------------------------------------------------------------------
  // onBar — per-bar tick (no-op for OHLCV-driven plugin; recordClose is
  // the canonical injection path)
  // ---------------------------------------------------------------------

  onBar(_bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    // OHLCV-driven plugin: realized vol updates happen via
    // `recordClose(symbol, close)` (called by the central runner once
    // per bar per symbol). `onBar` is a no-op here.
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
    // kellyCap: HARD CAP at 1.0
    if (c["kellyCap"] !== undefined) {
      if (typeof c["kellyCap"] !== "number" || !Number.isFinite(c["kellyCap"])) {
        return makeErr("kellyCap", "must be a finite number", c["kellyCap"]);
      }
      if (c["kellyCap"] > 1.0) {
        return makeErr(
          "kellyCap",
          `HARD CAP at 1.0 (1:10 mandate); got ${String(c["kellyCap"])}`,
          c["kellyCap"],
        );
      }
      if (c["kellyCap"] <= 0) {
        return makeErr("kellyCap", "must be > 0", c["kellyCap"]);
      }
    }
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
          `HARD CAP at 1.0 (1:10 mandate); got ${String(c["maxVolMultiplier"])}`,
          c["maxVolMultiplier"],
        );
      }
      if (c["maxVolMultiplier"] <= 0) {
        return makeErr("maxVolMultiplier", "must be > 0", c["maxVolMultiplier"]);
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
      if (c["minVolMultiplier"] <= 0) {
        return makeErr("minVolMultiplier", "must be > 0", c["minVolMultiplier"]);
      }
      if (c["maxVolMultiplier"] !== undefined &&
          typeof c["maxVolMultiplier"] === "number" &&
          c["minVolMultiplier"] > c["maxVolMultiplier"]) {
        return makeErr(
          "minVolMultiplier",
          `must be ≤ maxVolMultiplier (${String(c["maxVolMultiplier"])})`,
          c["minVolMultiplier"],
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
    if (c["fundingSharpeWindowDays"] !== undefined) {
      if (typeof c["fundingSharpeWindowDays"] !== "number" || !Number.isFinite(c["fundingSharpeWindowDays"])) {
        return makeErr(
          "fundingSharpeWindowDays",
          "must be a finite number",
          c["fundingSharpeWindowDays"],
        );
      }
      if (
        c["fundingSharpeWindowDays"] < MIN_FUNDING_SHARPE_WINDOW_DAYS ||
        c["fundingSharpeWindowDays"] > MAX_FUNDING_SHARPE_WINDOW_DAYS ||
        !Number.isInteger(c["fundingSharpeWindowDays"])
      ) {
        return makeErr(
          "fundingSharpeWindowDays",
          `must be an integer in [${MIN_FUNDING_SHARPE_WINDOW_DAYS}, ${MAX_FUNDING_SHARPE_WINDOW_DAYS}]`,
          c["fundingSharpeWindowDays"],
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
        return makeErr("baseNotionalUsd", "must be > 0", c["baseNotionalUsd"]);
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
    this.state.fundingSamplesReceived = 0;
    this.state.sizingSignalsReceived = 0;
    this.state.sizingSignalsEmitted = 0;
    this.state.leverageBreachDrops = 0;
    this.state.symbolDropCount = 0;
    this.state.barsProcessed = 0;
    this.state.kellyClampCount = 0;
    this.state.volClampCount = 0;
    this.state.notionalClampCount = 0;
    this.state.layer2AssertionCount = 0;
    this.state.layer3AssertionCount = 0;
    this.state.lastKellyBucket = null;
    this.state.lastVolMultiplier = null;
    this.state.lastSizingSignal = null;
    this.state.lastFundingRatePerSymbol.clear();
  }

  // ---------------------------------------------------------------------
  // dispose — release SignalBus subscriptions
  // ---------------------------------------------------------------------

  dispose(): void {
    if (this._unsubCarry) {
      try {
        this._unsubCarry();
      } catch {
        // defensive — unsubscriber throws are swallowed
      }
      this._unsubCarry = null;
    }
    if (this._unsubSizing) {
      try {
        this._unsubSizing();
      } catch {
        // defensive — unsubscriber throws are swallowed
      }
      this._unsubSizing = null;
    }
    this._bus = null;
    this._wired = false;
  }

  // ---------------------------------------------------------------------
  // Public helpers — used by central runner + tests
  // ---------------------------------------------------------------------

  /**
   * `recordFundingSample` — feed a single 8h funding-rate snapshot
   * for a given symbol. The canonical injection path for the
   * funding-Sharpe-based Kelly bucket computation. Called by the
   * central runner once per funding tick (or by tests directly).
   *
   * Per-symbol enable filter is applied here: samples for non-enabled
   * symbols are silently dropped.
   */
  recordFundingSample(symbol: string, fundingRate: number, timestampMs: number): void {
    if (!Number.isFinite(fundingRate)) {
      throw new Error(
        `HybridKellyPlugin.recordFundingSample: fundingRate must be finite, got ${fundingRate}`,
      );
    }
    if (!Number.isFinite(timestampMs) || timestampMs < 0) {
      throw new Error(
        `HybridKellyPlugin.recordFundingSample: timestampMs must be a non-negative finite number, got ${timestampMs}`,
      );
    }
    if (!this.config.enabledSymbols.includes(symbol)) {
      return; // non-enabled symbol — silently drop
    }
    this.state.fundingSamplesReceived += 1;

    const ss = this._getOrCreateSymbolState(symbol);
    ss.fundingSamples.push(fundingRate);
    ss.lastFundingRate = fundingRate;
    this.state.lastFundingRatePerSymbol.set(symbol, fundingRate);

    // Trim to funding window (8h cadence → 3 samples/day; window of
    // fundingSharpeWindowDays days = 3 × windowDays samples).
    const maxSamples = this.config.fundingSharpeWindowDays * 3;
    if (ss.fundingSamples.length > maxSamples) {
      ss.fundingSamples.splice(0, ss.fundingSamples.length - maxSamples);
    }

    // Recompute funding-Sharpe → Kelly bucket.
    if (ss.fundingSamples.length >= 2) {
      const sharpe = this._computeFundingSharpe(ss.fundingSamples);
      ss.fundingSharpe = sharpe;
      ss.kellyBucket = sharpeToKellyBucket(sharpe);
      ss.fundingSharpeObservations += 1;
      this.state.lastKellyBucket = ss.kellyBucket;
    }
  }

  /**
   * `recordClose` — feed a single (symbol, close) observation into the
   * rolling window. Called by the central runner once per bar per
   * symbol. Standard Phase 11.1e integration entry point for
   * per-symbol realized-vol computation.
   *
   * Per-symbol enable filter is applied here: samples for non-enabled
   * symbols are silently dropped.
   */
  recordClose(symbol: string, close: number): void {
    if (!Number.isFinite(close) || close <= 0) return;
    if (!this.config.enabledSymbols.includes(symbol)) return;

    const ss = this._getOrCreateSymbolState(symbol);
    ss.closes.push(close);

    // Trim to volWindowDays (rolling 30d default).
    if (ss.closes.length > this.config.volWindowDays + 1) {
      ss.closes.splice(0, ss.closes.length - (this.config.volWindowDays + 1));
    }

    // Recompute log returns + rolling realized vol.
    if (ss.closes.length >= 3) {
      const returns: number[] = [];
      for (let i = 1; i < ss.closes.length; i++) {
        const prev = ss.closes[i - 1]!;
        const cur = ss.closes[i]!;
        if (prev > 0 && cur > 0) {
          returns.push(Math.log(cur / prev));
        }
      }
      if (returns.length >= 2) {
        ss.realizedDailyVol = this._stddev(returns);
        const { clamped } = computeVolMultiplier(
          ss.realizedDailyVol,
          this.config.targetDailyVol,
          this.config.minVolMultiplier,
          this.config.maxVolMultiplier,
        );
        ss.volMultiplier = clamped;
        this.state.lastVolMultiplier = clamped;
      }
    }
  }

  /**
   * `isSymbolEnabled` — returns true if `symbol` is in
   * `config.enabledSymbols`.
   */
  isSymbolEnabled(symbol: string): boolean {
    return this.config.enabledSymbols.includes(symbol);
  }

  /**
   * `currentKellyBucketForSymbol` — returns the latest computed Kelly
   * bucket for `symbol`, or `null` if insufficient funding history.
   */
  currentKellyBucketForSymbol(symbol: string): AdaptiveKellyBucket | null {
    const ss = this.state.symbolState.get(symbol);
    if (!ss || ss.fundingSamples.length < 2) return null;
    return ss.kellyBucket;
  }

  /**
   * `currentVolMultiplierForSymbol` — returns the latest computed vol
   * multiplier for `symbol`, or `null` if insufficient OHLCV history.
   */
  currentVolMultiplierForSymbol(symbol: string): number | null {
    const ss = this.state.symbolState.get(symbol);
    if (!ss?.volMultiplier) return null;
    return ss.volMultiplier;
  }

  /**
   * `currentFundingSharpeForSymbol` — returns the latest funding-rate
   * rolling Sharpe for `symbol`, or `null` if insufficient funding
   * history.
   */
  currentFundingSharpeForSymbol(symbol: string): number | null {
    const ss = this.state.symbolState.get(symbol);
    return ss?.fundingSharpe ?? null;
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
   */
  assertLeverageInvariantForTesting(notional: number): void {
    assertLeverageInvariant(notional, this.config.baseNotionalUsd);
  }

  /**
   * `kellyFractionForSymbol` — pure helper. Maps the funding-Sharpe
   * bucket to a Kelly fraction multiplier in {0.25, 0.5, 0.7, 1.0}.
   * Exposed for tests + diagnostics.
   */
  kellyFractionForSymbol(symbol: string): AdaptiveKellyBucket | null {
    return this.currentKellyBucketForSymbol(symbol);
  }

  // ---------------------------------------------------------------------
  // Internal — handlers
  // ---------------------------------------------------------------------

  /**
   * `_onCarrySignal` — feed a CarrySignal's funding rate into the
   * per-symbol funding history. Note: CarrySignal as currently
   * defined does NOT carry an explicit symbol field; for multi-symbol
   * carry signals, the central runner routes them per-symbol via
   * `recordFundingSample`. The bus subscriber broadcasts to all
   * enabled symbols as a fallback (intentionally conservative — for
   * backtest determinism, the central runner should use
   * `recordFundingSample(symbol, rate, ts)` for per-symbol routing).
   */
  private _onCarrySignal(s: CarrySignal): void {
    const ts = s.timestampMs ?? Date.now();
    // CarrySignal doesn't carry a symbol — broadcast to all enabled
    // symbols as a fallback. The central runner should use
    // `recordFundingSample(symbol, rate, ts)` for per-symbol routing.
    for (const sym of this.config.enabledSymbols) {
      this.recordFundingSample(sym, s.fundingRate, ts);
    }
  }

  /**
   * `_onSizingSignal` — intercept an upstream SizingSignal, rescale it
   * using the plugin's funding-Sharpe Kelly bucket × vol multiplier,
   * assert the 1:10 invariant (Layer 3), and re-emit.
   */
  private _onSizingSignal(original: SizingSignal): void {
    this.state.sizingSignalsReceived += 1;

    // Per-symbol enable check (skip non-enabled symbols).
    const inferredSymbol = inferSymbol(original);
    if (inferredSymbol !== null && !this.isSymbolEnabled(inferredSymbol)) {
      this.state.symbolDropCount += 1;
      return;
    }

    // LAYER 2 — assert the upstream signal respects 1:10 BEFORE rescaling.
    try {
      this.assertLeverageInvariantForTesting(original.notional);
      this.state.layer2AssertionCount += 1;
    } catch {
      this.state.leverageBreachDrops += 1;
      throw new Error(
        `[HybridKellyPlugin] LAYER 2 BREACH: incoming SizingSignal from ${original.source} has notional=${original.notional} > baseNotionalUsd × ${ONE_TO_TEN_LEVERAGE}.`,
      );
    }

    // Compute the plugin's hybrid factor.
    const myKelly = this._effectiveKellyForSymbol(inferredSymbol);
    const myVolMult = this._effectiveVolMultiplierForSymbol(inferredSymbol);

    // Multiply upstream's signals with the plugin's factors. Both
    // factors are ≤ 1.0 (kellyCap and maxVolMultiplier hard caps), so
    // the product is ≤ 1.0 — never scale UP.
    const newKellyFraction = clamp(original.kellyFraction * myKelly, 0, this.config.kellyCap);
    const newVolMultiplier = clamp(
      original.volMultiplier * myVolMult,
      this.config.minVolMultiplier,
      this.config.maxVolMultiplier,
    );
    if (newKellyFraction < original.kellyFraction * myKelly) {
      this.state.kellyClampCount += 1;
    }
    if (newVolMultiplier < original.volMultiplier * myVolMult) {
      this.state.volClampCount += 1;
    }

    // Compute the new notional. We derive it from upstream's notional
    // by scaling down by the ratio of plugin-factor to upstream-factor:
    //   new_notional = upstream.notional × (new_kelly / upstream_kelly) ×
    //                                       (new_volMult / upstream_volMult)
    // If upstream.kelly or upstream.volMult is 0, fall back to
    // direct multiplication (defensive — should not occur for upstream
    // signals that respect the 1:10 contract).
    const upstreamKelly = Math.max(original.kellyFraction, 1e-9);
    const upstreamVol = Math.max(original.volMultiplier, 1e-9);
    let newNotional =
      original.notional * (newKellyFraction / upstreamKelly) * (newVolMultiplier / upstreamVol);

    // Hard cap at base × 10. Layer 3 will assert this, but we clamp
    // first so the assertion doesn't throw on benign rounding.
    const maxNotional = this.effectiveMaxNotionalUsd();
    if (newNotional > maxNotional) {
      newNotional = maxNotional;
      this.state.notionalClampCount += 1;
    }
    if (newNotional < 0) {
      // Defensive — upstream.notional could theoretically be negative
      // (short-side). We preserve sign but clamp magnitude.
      newNotional = -Math.min(Math.abs(newNotional), maxNotional);
    }

    const rescaled: SizingSignal = {
      kind: "sizing",
      kellyFraction: newKellyFraction,
      volMultiplier: newVolMultiplier,
      notional: newNotional,
      source: this.metadata.name,
      ...(original.timestampMs !== undefined
        ? { timestampMs: original.timestampMs }
        : {}),
    };

    // LAYER 3 — assert the rescaled signal still respects 1:10 BEFORE emit.
    try {
      this.assertLeverageInvariantForTesting(Math.abs(rescaled.notional));
      this.state.layer3AssertionCount += 1;
    } catch {
      this.state.leverageBreachDrops += 1;
      throw new Error(
        `[HybridKellyPlugin] LAYER 3 BREACH: rescaled notional=${rescaled.notional} > baseNotionalUsd × ${ONE_TO_TEN_LEVERAGE}.`,
      );
    }

    this.state.lastSizingSignal = rescaled;
    if (this._bus && this._wired) {
      this._bus.emit(rescaled);
      this.state.sizingSignalsEmitted += 1;
    }
  }

  // ---------------------------------------------------------------------
  // Internal — helpers
  // ---------------------------------------------------------------------

  private _getOrCreateSymbolState(symbol: string): SymbolState {
    let ss = this.state.symbolState.get(symbol);
    if (!ss) {
      ss = {
        fundingSamples: [],
        closes: [],
        lastFundingRate: 0,
        fundingSharpe: null,
        kellyBucket: 0.5, // cold-start default — half-Kelly (Phase 9 9E convention)
        realizedDailyVol: null,
        volMultiplier: null,
        fundingSharpeObservations: 0,
      };
      this.state.symbolState.set(symbol, ss);
    }
    return ss;
  }

  /**
   * `_effectiveKellyForSymbol` — returns the Kelly bucket fraction
   * for `symbol`, falling back to the cold-start default (0.5×) when
   * insufficient funding history.
   */
  private _effectiveKellyForSymbol(symbol: string | null): AdaptiveKellyBucket {
    if (symbol === null) return 0.5;
    const bucket = this.currentKellyBucketForSymbol(symbol);
    return bucket ?? 0.5;
  }

  /**
   * `_effectiveVolMultiplierForSymbol` — returns the vol multiplier
   * for `symbol`, falling back to `maxVolMultiplier` (1.0 — the
   * "size conservatively" default per Phase 8 Track G convention)
   * when insufficient OHLCV history.
   */
  private _effectiveVolMultiplierForSymbol(symbol: string | null): number {
    if (symbol === null) return this.config.maxVolMultiplier;
    const m = this.currentVolMultiplierForSymbol(symbol);
    return m ?? this.config.maxVolMultiplier;
  }

  /**
   * `_computeFundingSharpe` — per-trade mean / std of the funding-rate
   * samples in `samples`. Returns `0` if fewer than 2 samples (no
   * signal yet — neutral bucket).
   */
  private _computeFundingSharpe(samples: readonly number[]): number {
    if (samples.length < 2) return 0;
    const n = samples.length;
    let sum = 0;
    for (const s of samples) sum += s;
    const mean = sum / n;
    let sqSum = 0;
    for (const s of samples) sqSum += (s - mean) ** 2;
    const variance = sqSum / (n - 1);
    const std = variance > 0 ? Math.sqrt(variance) : 0;
    if (std === 0) return 0;
    return mean / std;
  }

  /**
   * `_stddev` — sample standard deviation (n-1 denominator).
   */
  private _stddev(values: readonly number[]): number {
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
}

// ---------------------------------------------------------------------------
// Module-level helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * `clamp` — numeric clamp to `[min, max]`. Handles NaN by returning
 * `min` (defensive).
 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * `inferSymbol` — extract a symbol identifier from a SizingSignal's
 * `source` field. Convention: `<plugin-name>:<symbol>` (e.g.,
 * `carry-baseline:BTC/USDT`). If no separator, returns null (treat
 * as wildcard — plugin still applies its hybrid factor to a
 * generic-sizing upstream).
 */
export function inferSymbol(signal: SizingSignal): string | null {
  const src = signal.source;
  const idx = src.indexOf(":");
  if (idx < 0 || idx === src.length - 1) return null;
  return src.slice(idx + 1);
}

// ---------------------------------------------------------------------------
// Factory + re-exports
// ---------------------------------------------------------------------------

/**
 * `createHybridKellyPlugin` — factory. Mirrors the convention of
 * `createVolTargetSizingPlugin` / `createCarryBaselinePlugin`.
 */
export function createHybridKellyPlugin(
  overrides: Partial<HybridKellyConfig> = {},
): HybridKellyPlugin {
  return new HybridKellyPlugin(overrides);
}

/**
 * `extractSizingSignal` — narrow `unknown` to `SizingSignal` using
 * the `isSizing` type guard. Re-exported for test convenience.
 */
export function extractSizingSignal(s: unknown): SizingSignal | null {
  if (s === null || s === undefined) return null;
  if (typeof s !== "object") return null;
  return isSizing(s as Parameters<typeof isSizing>[0]) ? (s as SizingSignal) : null;
}