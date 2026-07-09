// packages/core/src/signal-center/plugins/sol-flip-kill-switch-plugin.ts —
// Phase 11.1d Track A.
//
// ===========================================================================
// DEFENSIVE PLUGIN — SOLFlipKillSwitchPlugin
// ===========================================================================
//
// Purpose
// -------
// SOLFlipKillSwitchPlugin is the SECOND drop-in plugin for the Phase 11+
// Signal Center architecture. It wraps the validated Phase 9 9D
// `FundingFlipKillSwitchStrategy` (SOL funding-flip regime detector +
// persistence filter) and exposes its risk verdict as a typed
// `RiskSignal` on the SignalBus.
//
// Why this plugin?
// ----------------
// Phase 8 Track E (`FundingCarryTiming`) empirically produced 3 negative
// SOL walk-forward OOS folds (Folds 17/20/21, Q1-Q2 2026 funding-flip
// regime). Phase 9 9D validated that a 7d sign-flip + 1.5σ extreme +
// 5d persistence kill-switch reduces SOL drawdown by -53% (DD -59% →
// -27%) WITHOUT measurable monthly PnL cost. The plugin ports 9D to the
// SCv1 architecture as a defensive drop-in.
//
// Per-symbol disclosure (Phase 11.1d scope plan §1):
//   - BTC/USDT: NOT registered (marginal — funding rarely flips on BTC)
//   - ETH/USDT: NOT registered (marginal — same as BTC)
//   - SOL/USDT: REGISTERED (DD reduction expected, no PnL lift)
//
// What this plugin does NOT do:
//   - Does NOT emit SizingSignals (defensive plugin, no alpha source)
//   - Does NOT enter/exit positions (that's the carry plugin's job)
//   - Does NOT extend the 1:10 leverage ceiling (inherits from carry)
//
// What this plugin DOES:
//   - Subscribes to bus 'carry' signals to monitor funding rates
//   - Maintains a trailing funding-rate history
//   - Runs the Phase 9 9D flip-regime detector + persistence filter
//   - Emits a RiskSignal when kill-switch engages (breach: true)
//   - Emits a RiskSignal when kill-switch disengages (breach: false)
//
// 1:10 leverage invariant (2-layer defense — defensive plugin emits
// RiskSignals ONLY, NOT SizingSignals):
//   1. **Constructor** (Layer 1) — `metadata.maxLeverage = 10`. The
//      registry's `validatePluginMetadata` rejects a higher value at
//      boot. Defense in depth: even though a defensive plugin doesn't
//      size, declaring maxLeverage keeps the invariant uniformly
//      enforced across all plugins.
//   2. **Per-emit** (Layer 2) — when the plugin emits a RiskSignal
//      with a `closeNotionalUsd` instruction, the implied close
//      notional is asserted via `assertLeverageInvariant(closeNotionalUsd,
//      baseNotionalUsd)` BEFORE emit. Any violation throws
//      `LeverageBreachError`. This is the "defensive per-emit guard":
//      even if metadata is bypassed, the per-emit assertion catches
//      it.
//   3. **Per-bar guard** (Layer 3) — N/A for defensive plugins. Layer
//      3 in the SCv1 architecture is the portfolio risk engine's
//      `leverageInvariantGuard` (Phase 10G Track B). Defensive plugins
//      emit RiskSignals but don't SIZE positions, so Layer 3 doesn't
//      apply at this layer.
//
// References (≥3 independent sources on plugin-architecture for quant):
//   - Martin Fowler "Plugin" pattern (PEAA, 2002) — explicit plugin
//     interface, runtime registration, lifecycle hooks.
//   - QuantConnect Lean Engine `Alpha` + `Universe Selection` plugins —
//     the canonical reference for drop-in strategy components in
//     quant frameworks.
//   - NautilusTrader `Strategy` + `Actor` lifecycle (2023) — modern
//     Rust/Python plugin pattern with on_bar / on_quote_tick hooks.

import {
  ALLOWED_KILL_SWITCH_LEVERAGE,
  computeFlipDetectorMetrics,
  DEFAULT_FLIP_DETECTOR_CONFIG,
  evaluateRegime,
  type FlipDetectorConfig,
  type FlipDetectorMetrics,
  type RegimeDecision,
} from "../../strategy/funding-flip-kill-switch.js";
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
  type RiskSignal,
  err,
  isCarry,
  ok,
} from "../types.js";
import { assertLeverageInvariant } from "../../risk/leverage-invariant.js";

// ---------------------------------------------------------------------------
// SOLFlipKillSwitchPluginConfig — plugin configuration
// ---------------------------------------------------------------------------

/**
 * `SOLFlipKillSwitchPluginConfig` — configuration for the SOLFlipKillSwitchPlugin.
 *
 * Mirrors the Phase 9 9D detector config (signFlipWindowDays,
 * extremeSigmaThreshold, persistenceDays) plus signal-center-specific
 * knobs (enabledSymbols for per-symbol disclosure, baseNotionalUsd
 * for the 1:10 leverage invariant guard).
 */
export interface SOLFlipKillSwitchPluginConfig {
  /**
   * Per-symbol enable flags. The plugin only processes funding-rate
   * samples whose symbol is in this list. Phase 11.1d scope plan §1:
   *   - BTC/USDT: NOT enabled (marginal flip events, no benefit)
   *   - ETH/USDT: NOT enabled (same as BTC)
   *   - SOL/USDT: enabled (DD reduction, Phase 9 9D validated)
   *
   * Default: `["SOL/USDT"]`.
   */
  readonly enabledSymbols: readonly string[];
  /**
   * Sign-flip window length in DAYS. The detector counts sign-flips
   * over the trailing `signFlipWindowDays * 3` snapshots (8h cadence
   * → 3 snapshots/day). Default: 7 (Phase 9 9D validated).
   */
  readonly signFlipWindowDays: number;
  /**
   * Extreme-regime threshold in σ (standard deviations). The detector
   * flags the regime as "extreme" when the trailing 7d |rate| mean
   * exceeds `baselineAbsRateMean + extremeSigmaThreshold ×
   * baselineAbsRateStdDev` over a 30d baseline window. Default: 1.5
   * (Phase 9 9D validated).
   */
  readonly extremeSigmaThreshold: number;
  /**
   * Persistence window length in DAYS. Once the kill-switch is armed
   * by a fresh regime signal, it stays engaged for `persistenceDays`
   * after the LAST regime-active snapshot. Anti-whipsaw: prevents
   * alternating "carry on" / "carry off" within a flip regime.
   * Default: 5 (Phase 9 9D validated).
   */
  readonly persistenceDays: number;
  /**
   * Detector rolling-vol window in DAYS. Used as the baseline for the
   * z-score extreme-regime check. Default: 30 (matches Track E's
   * window).
   */
  readonly volWindowDays: number;
  /**
   * Base notional in USD. Used for the Layer 2 leverage invariant
   * guard: when the plugin emits a `closeNotionalUsd` instruction, it
   * asserts the implied close notional respects
   * `baseNotionalUsd × maxLeverage`. Default: 10_000.
   */
  readonly baseNotionalUsd: number;
  /**
   * Per-funding-snapshot max notional in USD. The Layer 2 guard
   * computes `closeNotionalUsd = min(baseNotionalUsd × timingLeverage,
   * maxCloseNotionalUsd)`. Default: 100_000 (1:10 ceiling on 10k base).
   */
  readonly maxCloseNotionalUsd: number;
  /**
   * `timingLeverage` — 1 or 10. Used by the Layer 2 guard to compute
   * the implied close notional. Default: 10 (1:10 mandate).
   */
  readonly timingLeverage: 1 | 10;
  /**
   * When `true`, the plugin emits a RiskSignal with `closeNotionalUsd`
   * each time the kill-switch engages/disengages. When `false`, only
   * the bare breach/reason signal is emitted (no position-size hint).
   * Default: `true`.
   */
  readonly emitCloseInstruction: boolean;
}

export const DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG: SOLFlipKillSwitchPluginConfig = {
  enabledSymbols: ["SOL/USDT"], // Phase 9 9D validated SOL only
  signFlipWindowDays: 7, // Phase 9 9D default
  extremeSigmaThreshold: 1.5, // Phase 9 9D default
  persistenceDays: 5, // Phase 9 9D default
  volWindowDays: 30, // Phase 9 9D default
  baseNotionalUsd: 10_000, // 1:10 mandate default
  maxCloseNotionalUsd: 100_000, // baseNotional × 10 ceiling
  timingLeverage: 10, // 1:10 mandate default
  emitCloseInstruction: true,
};

// ---------------------------------------------------------------------------
// SOLFlipKillSwitchPluginState — per-plugin mutable state
// ---------------------------------------------------------------------------

/**
 * `SOLFlipKillSwitchPluginState` — mutable state held by the plugin
 * across `recordFundingSample` calls. Mirrors the relevant subset of
 * `FundingFlipKillSwitchState` plus plugin-level signal-emission
 * bookkeeping.
 */
export interface SOLFlipKillSwitchPluginState {
  /** Trailing funding-rate history (raw 8h samples, most-recent last). */
  fundingHistory: number[];
  /** Latest detector metrics snapshot. */
  lastMetrics: FlipDetectorMetrics;
  /** Latest regime decision. */
  lastRegime: RegimeDecision;
  /** True if the kill-switch is currently engaged. */
  killSwitchEngaged: boolean;
  /** Timestamp (ms) of the most recent detector signal that armed the regime. */
  lastRegimeSignalMs: number | null;
  /** Timestamp (ms) until which the kill-switch stays engaged. */
  killSwitchUntilMs: number | null;
  /** Number of funding snapshots during which the kill-switch was engaged. */
  carryPausedFundingPeriods: number;
  /** Number of distinct regime activations (transitions calm → active). */
  regimeActivationCount: number;
  /** Number of distinct regime deactivations (transitions active → calm). */
  regimeDeactivationCount: number;
  /** Number of funding-flip regime signals emitted (flipCount >= threshold). */
  flipRegimeSignalCount: number;
  /** Number of negative-dominance signals emitted. */
  negativeDominanceSignalCount: number;
  /** Number of extreme-regime signals emitted (z-score >= threshold). */
  extremeRegimeSignalCount: number;
  /** Number of RiskSignals emitted since reset. */
  riskSignalCount: number;
  /** Number of RiskSignals with breach: true. */
  riskSignalBreachCount: number;
  /** Number of Layer 2 leverage-invariant assertions that fired (defensive). */
  leverageAssertionCount: number;
  /** Last emitted RiskSignal — used for telemetry + tests. */
  lastRiskSignal: RiskSignal | null;
  /** Per-symbol funding history keyed by symbol. */
  perSymbolFundingHistory: Map<string, number[]>;
}

// ---------------------------------------------------------------------------
// SOLFlipKillSwitchPlugin — the defensive plugin
// ---------------------------------------------------------------------------

/**
 * `SOLFlipKillSwitchPlugin` — the SECOND drop-in plugin for the Phase
 * 11+ Signal Center. Defensive ONLY: emits RiskSignals, NOT
 * SizingSignals. Wraps the Phase 9 9D SOL funding-flip kill-switch
 * detector.
 *
 * Lifecycle (per `StrategyPlugin` contract):
 *   1. `new SOLFlipKillSwitchPlugin({ ... })`.
 *   2. `plugin.validateConfig(...)` — boot-time audit (non-throwing).
 *   3. `plugin.subscribe(bus)` — wire `bus.subscribe('carry', handler)`.
 *   4. `plugin.onBar(bar, state)` — per-bar tick (mostly no-op for
 *      funding-driven plugin; checks persistence window expiry).
 *   5. `plugin.recordFundingSample(symbol, rate, ts)` — direct funding
 *      injection (used by central runner AND tests).
 *   6. `plugin.reset()` / `plugin.dispose()` — backtest lifecycle.
 *
 * Plugin invariant (1:10 HARD GUARDRAIL — defensive plugin, 2-layer):
 *   - `metadata.maxLeverage === 10` (Layer 1, declared).
 *   - Every RiskSignal with `closeNotionalUsd` is asserted via
 *     `assertLeverageInvariant(closeNotionalUsd, baseNotionalUsd)`
 *     BEFORE emit (Layer 2, per-emit).
 *   - Defensive plugin does NOT emit SizingSignals, so Layer 3 (per-bar
 *     portfolio guard) is N/A at this layer.
 *
 * Determinism: all emission logic is pure-functional given the
 * funding-rate history. Two runs with the same input sequence produce
 * the same signal sequence.
 */
export class SOLFlipKillSwitchPlugin implements StrategyPlugin {
  readonly metadata: StrategyPluginMetadata = {
    name: "sol-flip-kill-switch",
    version: "1.0.0",
    edgeClass: "risk", // emits RiskSignals only
    capitalRequirement: 0, // defensive plugin, no capital needed
    maxLeverage: 10, // 1:10 HARD GUARDRAIL — Layer 1 defense
    description:
      "Phase 11.1d defensive drop-in plugin — wraps Phase 9 9D SOL " +
      "funding-flip kill-switch detector (7d sign-flip + 1.5σ extreme + " +
      "5d persistence). Emits RiskSignals ONLY when kill-switch engages. " +
      "SOL/USDT enabled (BTC/ETH NOT registered, marginal flip events).",
    dependencies: [],
  };

  readonly config: SOLFlipKillSwitchPluginConfig;
  readonly state: SOLFlipKillSwitchPluginState;

  /** Stored bus reference (set in subscribe). */
  private bus: SignalBus | null = null;
  /** Unsubscribe handles for our own self-subscriptions. */
  private readonly unsubscribers: (() => void)[] = [];

  /** Detector config (derived from plugin config). */
  private readonly detectorConfig: FlipDetectorConfig;

  /** Internal Phase 9 9D reference config (used to derive detector config). */
  private static readonly _phase9RefConfig: Partial<FlipDetectorConfig> = {};

  constructor(config: Partial<SOLFlipKillSwitchPluginConfig> = {}) {
    const merged: SOLFlipKillSwitchPluginConfig = {
      ...DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
      ...config,
    };
    // 1:10 HARD GUARDRAIL — Layer 1 sanity check.
    if (!ALLOWED_KILL_SWITCH_LEVERAGE.includes(merged.timingLeverage)) {
      throw new Error(
        `[1:10 HARD GUARDRAIL] timingLeverage must be 1 or 10. ` +
          `Got ${merged.timingLeverage}.`,
      );
    }
    // Constructor-time validation — defense in depth. validateConfig
    // does the non-throwing audit; this enforces invariants BEFORE the
    // plugin is registered.
    SOLFlipKillSwitchPlugin.assertConfigInvariants(merged);
    this.config = merged;
    this.detectorConfig = {
      flipWindowDays: merged.signFlipWindowDays,
      flipThreshold: DEFAULT_FLIP_DETECTOR_CONFIG.flipThreshold, // Phase 9 9D default
      negativeDominanceThreshold: DEFAULT_FLIP_DETECTOR_CONFIG.negativeDominanceThreshold,
      persistenceDays: merged.persistenceDays,
      extremeZscoreThreshold: merged.extremeSigmaThreshold,
      volWindowDays: merged.volWindowDays,
    };
    this.state = this.mkState();
    // Reference the static ref config so linter doesn't complain.
    void SOLFlipKillSwitchPlugin._phase9RefConfig;
  }

  // -------------------------------------------------------------------------
  // StrategyPlugin interface
  // -------------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this.bus = bus;
    // Subscribe to carry signals to monitor funding rates from upstream
    // plugins (e.g., CarryBaselinePlugin). Each CarrySignal carries a
    // `fundingRate` field; the plugin feeds it to the flip detector.
    //
    // NOTE: CarrySignal doesn't carry a `symbol` field directly (the
    // symbol is lost at emission time — see CarryBaselinePlugin).
    // Per-symbol filtering happens at the `recordFundingSample(symbol,
    // ...)` API level, which is the canonical injection path used by
    // the central runner. The bus subscriber is a fallback / monitoring
    // path that assumes the central runner routes per-symbol signals.
    const unsub = bus.subscribe("carry", (s) => {
      if (!isCarry(s)) return;
      // Use timestampMs if present; otherwise treat as 'now'. For
      // backtest determinism, the central runner is expected to
      // provide timestampMs on every signal.
      const ts = s.timestampMs ?? Date.now();
      // We don't know the symbol from the carry signal alone; we
      // record against each enabled symbol. This is intentionally
      // conservative — the central runner should use
      // `recordFundingSample(symbol, rate, ts)` for per-symbol routing.
      for (const sym of this.config.enabledSymbols) {
        this.recordFundingSample(sym, s.fundingRate, ts);
      }
    });
    this.unsubscribers.push(unsub);
  }

  onBar(_bar: Bar, _state: PluginState): void {
    // Funding-driven plugin — the detector advances via
    // `recordFundingSample(symbol, rate, ts)` which is called either by
    // the bus subscriber (see `subscribe`) or directly by the central
    // runner. `onBar` is a no-op here.
    //
    // We do NOT increment a per-bar counter because the plugin's
    // state-machine (kill-switch engagement) is funding-driven, not
    // bar-driven. Persisting state across bars is handled by
    // `state.killSwitchUntilMs`.
  }

  validateConfig(config: unknown): Result<void, ConfigError> {
    if (config === undefined || config === null) {
      return ok(undefined); // no override → use defaults
    }
    if (typeof config !== "object") {
      return err({
        pluginName: this.metadata.name,
        field: "config",
        message: `config must be an object, got ${typeof config}`,
      });
    }
    const c = config as Partial<SOLFlipKillSwitchPluginConfig>;
    const invariant = SOLFlipKillSwitchPlugin.checkConfigInvariants(c);
    if (invariant !== null) {
      return err({
        pluginName: this.metadata.name,
        field: invariant.field,
        message: invariant.message,
        value: invariant.value,
      });
    }
    return ok(undefined);
  }

  /**
   * `checkConfigInvariants` — static helper that returns `null` if
   * the partial config is valid, or `{ field, message, value }` if
   * the first invalid invariant is found. Used by both the
   * constructor (throws) and `validateConfig` (non-throwing).
   *
   * Order matches the order of fields in the brief's validation list.
   */
  private static checkConfigInvariants(
    c: Partial<SOLFlipKillSwitchPluginConfig>,
  ): { field: string; message: string; value: unknown } | null {
    if (c.signFlipWindowDays !== undefined) {
      if (!Number.isFinite(c.signFlipWindowDays) || c.signFlipWindowDays < 1) {
        return {
          field: "signFlipWindowDays",
          message: `signFlipWindowDays must be >= 1, got ${c.signFlipWindowDays}`,
          value: c.signFlipWindowDays,
        };
      }
    }
    if (c.extremeSigmaThreshold !== undefined) {
      if (!Number.isFinite(c.extremeSigmaThreshold) || c.extremeSigmaThreshold < 0) {
        return {
          field: "extremeSigmaThreshold",
          message: `extremeSigmaThreshold must be >= 0, got ${c.extremeSigmaThreshold}`,
          value: c.extremeSigmaThreshold,
        };
      }
    }
    if (c.persistenceDays !== undefined) {
      if (!Number.isFinite(c.persistenceDays) || c.persistenceDays < 0) {
        return {
          field: "persistenceDays",
          message: `persistenceDays must be >= 0, got ${c.persistenceDays}`,
          value: c.persistenceDays,
        };
      }
    }
    if (c.volWindowDays !== undefined) {
      if (!Number.isFinite(c.volWindowDays) || c.volWindowDays < 1) {
        return {
          field: "volWindowDays",
          message: `volWindowDays must be >= 1, got ${c.volWindowDays}`,
          value: c.volWindowDays,
        };
      }
    }
    if (c.baseNotionalUsd !== undefined) {
      if (!Number.isFinite(c.baseNotionalUsd) || c.baseNotionalUsd <= 0) {
        return {
          field: "baseNotionalUsd",
          message: `baseNotionalUsd must be positive finite, got ${c.baseNotionalUsd}`,
          value: c.baseNotionalUsd,
        };
      }
    }
    if (c.maxCloseNotionalUsd !== undefined) {
      if (
        !Number.isFinite(c.maxCloseNotionalUsd) ||
        c.maxCloseNotionalUsd <= 0
      ) {
        return {
          field: "maxCloseNotionalUsd",
          message: `maxCloseNotionalUsd must be positive finite, got ${c.maxCloseNotionalUsd}`,
          value: c.maxCloseNotionalUsd,
        };
      }
    }
    if (c.timingLeverage !== undefined) {
      if (!ALLOWED_KILL_SWITCH_LEVERAGE.includes(c.timingLeverage)) {
        return {
          field: "timingLeverage",
          message:
            `[1:10 HARD GUARDRAIL] timingLeverage must be 1 or 10. ` +
            `Got ${String(c.timingLeverage)}.`,
          value: c.timingLeverage,
        };
      }
    }
    if (c.enabledSymbols !== undefined) {
      if (!Array.isArray(c.enabledSymbols)) {
        return {
          field: "enabledSymbols",
          message: `enabledSymbols must be an array of strings, got ${typeof c.enabledSymbols}`,
          value: c.enabledSymbols,
        };
      }
      for (const sym of c.enabledSymbols) {
        if (typeof sym !== "string" || sym.length === 0) {
          return {
            field: "enabledSymbols",
            message: `enabledSymbols must contain non-empty strings, got ${String(sym)}`,
            value: sym as unknown,
          };
        }
      }
    }
    return null;
  }

  /**
   * `assertConfigInvariants` — throws if the config fails any
   * invariant check. Used at construction time for defense in depth.
   */
  private static assertConfigInvariants(
    c: SOLFlipKillSwitchPluginConfig,
  ): void {
    // For the full config, check every invariant (no undefined fields).
    const invalid = SOLFlipKillSwitchPlugin.checkConfigInvariants(c);
    if (invalid !== null) {
      throw new Error(
        `[SOLFlipKillSwitchPlugin] ${invalid.field}: ${invalid.message}`,
      );
    }
    // Additional check: maxCloseNotionalUsd must be ≤ baseNotionalUsd ×
    // maxLeverage (10x ceiling — the 1:10 mandate). The effective
    // close notional is min(baseNotional × timingLeverage, maxCloseNotionalUsd),
    // and we must ensure the maxCloseNotionalUsd ceiling itself
    // respects the project-wide 1:10 mandate.
    const maxAllowedClose = c.baseNotionalUsd * 10; // 1:10 mandate ceiling
    if (c.maxCloseNotionalUsd > maxAllowedClose * 1.0001) {
      throw new Error(
        `[1:10 HARD GUARDRAIL] maxCloseNotionalUsd (${c.maxCloseNotionalUsd}) ` +
          `must be ≤ baseNotionalUsd × 10 (${maxAllowedClose}, the 1:10 mandate ceiling).`,
      );
    }
  }

  reset(): void {
    this.state.fundingHistory = [];
    this.state.lastMetrics = {
      flipCount: 0,
      negativeDominance: 0,
      absRateMean: 0,
      absRateStdDev: 0,
      baselineAbsRateMean: 0,
      baselineAbsRateStdDev: 0,
      zscore: 0,
      windowSize: 0,
      baselineWindowSize: 0,
    };
    this.state.lastRegime = {
      regimeActive: false,
      flipRegime: false,
      negativeDominanceRegime: false,
      extremeRegime: false,
      reason: "reset",
    };
    this.state.killSwitchEngaged = false;
    this.state.lastRegimeSignalMs = null;
    this.state.killSwitchUntilMs = null;
    this.state.carryPausedFundingPeriods = 0;
    this.state.regimeActivationCount = 0;
    this.state.regimeDeactivationCount = 0;
    this.state.flipRegimeSignalCount = 0;
    this.state.negativeDominanceSignalCount = 0;
    this.state.extremeRegimeSignalCount = 0;
    this.state.riskSignalCount = 0;
    this.state.riskSignalBreachCount = 0;
    this.state.leverageAssertionCount = 0;
    this.state.lastRiskSignal = null;
    this.state.perSymbolFundingHistory = new Map();
  }

  dispose(): void {
    for (const u of this.unsubscribers) {
      try {
        u();
      } catch (e: unknown) {
        void e;
      }
    }
    this.unsubscribers.length = 0;
    this.bus = null;
  }

  // -------------------------------------------------------------------------
  // Public API (for central runner + tests)
  // -------------------------------------------------------------------------

  /**
   * `recordFundingSample` — drive the flip detector with a new
   * 8h funding-rate snapshot for a given symbol. Per-symbol enable
   * filter is applied here: samples for non-enabled symbols are
   * silently dropped (no state mutation).
   *
   * Algorithm mirrors Phase 9 9D `FundingFlipKillSwitchStrategy.recordFundingSample`:
   *   1. Validate `fundingRate` is finite.
   *   2. Append to per-symbol funding history (trimmed to volWindowDays × 3 + 8).
   *   3. Compute flip-detector metrics + regime decision.
   *   4. Update state (metrics, regime, kill-switch engagement).
   *   5. If a transition occurred (calm→active or active→calm), emit
   *      a RiskSignal via the bus (with Layer 2 leverage assertion).
   *
   * Returns the regime decision (always non-null).
   */
  recordFundingSample(symbol: string, fundingRate: number, timestampMs: number): RegimeDecision {
    if (!Number.isFinite(fundingRate)) {
      throw new Error(
        `SOLFlipKillSwitchPlugin.recordFundingSample: fundingRate must be finite, got ${fundingRate}`,
      );
    }
    if (!Number.isFinite(timestampMs) || timestampMs < 0) {
      throw new Error(
        `SOLFlipKillSwitchPlugin.recordFundingSample: timestampMs must be a non-negative finite number, got ${timestampMs}`,
      );
    }
    // Per-symbol enable filter (Phase 11.1d §1 per-symbol disclosure).
    if (!this.config.enabledSymbols.includes(symbol)) {
      // Non-enabled symbol — return current regime without mutation.
      return this.state.lastRegime;
    }

    // Update per-symbol funding history.
    let symbolHistory = this.state.perSymbolFundingHistory.get(symbol);
    if (!symbolHistory) {
      symbolHistory = [];
      this.state.perSymbolFundingHistory.set(symbol, symbolHistory);
    }
    symbolHistory.push(fundingRate);
    const maxEntries = this.detectorConfig.volWindowDays * 3 + 8;
    if (symbolHistory.length > maxEntries) {
      symbolHistory.splice(0, symbolHistory.length - maxEntries);
    }

    // Also maintain a flat fundingHistory (most-recent across all enabled symbols).
    this.state.fundingHistory.push(fundingRate);
    if (this.state.fundingHistory.length > maxEntries) {
      this.state.fundingHistory.splice(0, this.state.fundingHistory.length - maxEntries);
    }

    // Compute metrics + regime decision.
    const metrics = computeFlipDetectorMetrics(symbolHistory, this.detectorConfig);
    const decision = evaluateRegime(metrics, this.detectorConfig);
    this.state.lastMetrics = metrics;
    this.state.lastRegime = decision;

    // Track per-regime signal counts.
    if (decision.flipRegime) this.state.flipRegimeSignalCount += 1;
    if (decision.negativeDominanceRegime) this.state.negativeDominanceSignalCount += 1;
    if (decision.extremeRegime) this.state.extremeRegimeSignalCount += 1;

    // Persistence logic (mirrors Phase 9 9D FundingFlipKillSwitchStrategy).
    const persistenceMs = this.detectorConfig.persistenceDays * 24 * 60 * 60 * 1000;
    const wasEngaged = this.state.killSwitchEngaged;

    // Determine whether the current snapshot contributes a FRESH
    // regime signal (anti-whipsaw: persistence extends only on fresh
    // signals, not on stale trailing-window data).
    const isFreshFlippy = this._isFreshFlippySignal(symbolHistory);
    const isFreshNegative = fundingRate < 0;
    const isFreshExtreme =
      metrics.zscore >= this.detectorConfig.extremeZscoreThreshold;
    const isFreshRegimeSignal =
      (decision.flipRegime && isFreshFlippy) ||
      (decision.negativeDominanceRegime && isFreshNegative) ||
      (decision.extremeRegime && isFreshExtreme);

    if (isFreshRegimeSignal) {
      this.state.lastRegimeSignalMs = timestampMs;
      const newUntil = timestampMs + persistenceMs;
      if (
        this.state.killSwitchUntilMs === null ||
        newUntil > this.state.killSwitchUntilMs
      ) {
        this.state.killSwitchUntilMs = newUntil;
      }
      this.state.killSwitchEngaged = true;
    } else if (
      this.state.killSwitchUntilMs !== null &&
      timestampMs >= this.state.killSwitchUntilMs
    ) {
      this.state.killSwitchEngaged = false;
    }

    const isEngaged = this.state.killSwitchEngaged;
    if (wasEngaged && !isEngaged) {
      this.state.regimeDeactivationCount += 1;
    } else if (!wasEngaged && isEngaged) {
      this.state.regimeActivationCount += 1;
      this.state.carryPausedFundingPeriods += 1;
    } else if (isEngaged) {
      this.state.carryPausedFundingPeriods += 1;
    }

    // Emit RiskSignal on transitions (engaged→disengaged AND
    // disengaged→engaged) AND on each fresh regime signal within the
    // persistence window. The downstream consumer decides what to do
    // with breach: true / breach: false.
    if (isFreshRegimeSignal || (!wasEngaged && isEngaged) || (wasEngaged && !isEngaged)) {
      this._emitRiskSignal(timestampMs, isEngaged, decision);
    }

    return decision;
  }

  /**
   * `currentRegime` — read-only accessor for the latest regime
   * decision. Used by tests + central runner diagnostics.
   */
  currentRegime(): RegimeDecision {
    return this.state.lastRegime;
  }

  /**
   * `isKillSwitchEngaged` — read-only accessor for the current
   * kill-switch state at a given timestamp. Returns `false` if the
   * persistence window has expired.
   */
  isKillSwitchEngaged(timestampMs: number): boolean {
    if (this.state.killSwitchUntilMs === null) return false;
    return timestampMs < this.state.killSwitchUntilMs;
  }

  /**
   * `enabledSymbols` — read-only accessor for the per-symbol enable
   * list. Used by tests + central runner.
   */
  enabledSymbolsList(): readonly string[] {
    return this.config.enabledSymbols;
  }

  // -------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------

  private mkState(): SOLFlipKillSwitchPluginState {
    return {
      fundingHistory: [],
      lastMetrics: {
        flipCount: 0,
        negativeDominance: 0,
        absRateMean: 0,
        absRateStdDev: 0,
        baselineAbsRateMean: 0,
        baselineAbsRateStdDev: 0,
        zscore: 0,
        windowSize: 0,
        baselineWindowSize: 0,
      },
      lastRegime: {
        regimeActive: false,
        flipRegime: false,
        negativeDominanceRegime: false,
        extremeRegime: false,
        reason: "init",
      },
      killSwitchEngaged: false,
      lastRegimeSignalMs: null,
      killSwitchUntilMs: null,
      carryPausedFundingPeriods: 0,
      regimeActivationCount: 0,
      regimeDeactivationCount: 0,
      flipRegimeSignalCount: 0,
      negativeDominanceSignalCount: 0,
      extremeRegimeSignalCount: 0,
      riskSignalCount: 0,
      riskSignalBreachCount: 0,
      leverageAssertionCount: 0,
      lastRiskSignal: null,
      perSymbolFundingHistory: new Map(),
    };
  }

  /**
   * `_isFreshFlippySignal` — the CURRENT snapshot has a sign flip
   * with the PREVIOUS snapshot for the given symbol's history. Pure
   * functional helper (no state mutation).
   */
  private _isFreshFlippySignal(history: readonly number[]): boolean {
    if (history.length < 2) return false;
    const prev = history[history.length - 2]!;
    const cur = history[history.length - 1]!;
    if (prev === 0 || cur === 0) return false;
    return (prev > 0) !== (cur > 0);
  }

  /**
   * `_emitRiskSignal` — compose + emit a RiskSignal. Layer 2
   * 1:10 leverage invariant: if `closeNotionalUsd` is included,
   * assert it respects the 1:10 cap BEFORE emit. The assertion
   * count is incremented on every successful assertion (even when
   * `emitCloseInstruction` is false, the assertion is still run for
   * the configured `maxCloseNotionalUsd` as a sanity check).
   *
   * The reason field is derived from the regime decision:
   *   - flipRegime → "funding-flip"
   *   - extremeRegime → "extreme-regime"
   *   - negativeDominanceRegime → "negative-dominance"
   *   - calm → "regime-cleared" (kill-switch disengagement)
   */
  private _emitRiskSignal(
    timestampMs: number,
    isEngaged: boolean,
    decision: RegimeDecision,
  ): void {
    // Layer 2 — compute the implied close notional and assert it.
    const impliedCloseNotional = Math.min(
      this.config.baseNotionalUsd * this.config.timingLeverage,
      this.config.maxCloseNotionalUsd,
    );
    // Always assert (defensive — even if emitCloseInstruction is
    // false, we sanity-check the configured cap).
    assertLeverageInvariant(impliedCloseNotional, this.config.baseNotionalUsd);
    this.state.leverageAssertionCount += 1;

    const reason = this._reasonFromDecision(decision, isEngaged);
    const breach = isEngaged;
    // Conditional closeNotionalUsd — must use object spread to satisfy
    // `exactOptionalPropertyTypes: true` (omit the field entirely
    // when emitCloseInstruction is false, never assign undefined).
    const closeNotionalField = this.config.emitCloseInstruction
      ? { closeNotionalUsd: impliedCloseNotional }
      : {};
    const riskSig: RiskSignal = {
      kind: "risk",
      varDaily95: 0, // defensive plugin doesn't compute VaR
      correlationPenalty: 0,
      drawdownLimit: isEngaged ? 0 : 1.0, // 0 = force-close, 1.0 = no drawdown limit
      source: this.metadata.name,
      timestampMs,
      breach,
      reason,
      ...closeNotionalField,
    };

    this.state.lastRiskSignal = riskSig;
    this.state.riskSignalCount += 1;
    if (breach) this.state.riskSignalBreachCount += 1;

    if (this.bus) {
      this.bus.emit(riskSig);
    }
  }

  /**
   * `_reasonFromDecision` — derive the human-readable reason string
   * from the regime decision. Priority order matches Phase 9 9D's
   * `evaluateRegime` reason logic.
   */
  private _reasonFromDecision(decision: RegimeDecision, isEngaged: boolean): string {
    if (!isEngaged) return "regime-cleared";
    if (decision.flipRegime) return "funding-flip";
    if (decision.extremeRegime) return "extreme-regime";
    if (decision.negativeDominanceRegime) return "negative-dominance";
    return "kill-switch-engaged";
  }
}