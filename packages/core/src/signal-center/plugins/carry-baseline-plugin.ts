// packages/core/src/signal-center/plugins/carry-baseline-plugin.ts —
// Phase 10G Track A reference plugin.
//
// ===========================================================================
// REFERENCE PLUGIN — CarryBaselinePlugin
// ===========================================================================
//
// Purpose
// -------
// CarryBaselinePlugin is the FIRST drop-in plugin for the Signal Center
// architecture. It wraps the existing Phase 8 Track E
// `FundingCarryTimingStrategy` + Phase 9 9D `FundingFlipKillSwitchStrategy`
// and exposes their logic as SignalBus events.
//
// Why this plugin?
// ----------------
// Phase 1-9 produced the carry logic as standalone strategies
// (funding-carry-leverage, funding-carry-timing, funding-flip-kill-switch)
// composed additively into V4. To prove the SignalBus + Registry works
// end-to-end, we need ONE reference plugin that emits CarrySignals and
// SizingSignals. The reference plugin:
//   1. Demonstrates the StrategyPlugin interface contract.
//   2. Validates the 1:10 leverage invariant at the plugin level.
//   3. Emits CarrySignals when funding regime transitions.
//   4. Emits SizingSignals based on adaptive Kelly × vol-target hybrid.
//   5. Runs identically in backtest mode (deterministic) and live mode.
//
// 1:10 leverage invariant
// -----------------------
// This plugin's effective leverage MUST stay ≤ 10. We enforce this at:
//   1. **Constructor**: `maxLeverage: 10` in metadata. The registry's
//      `validatePluginMetadata` would reject a higher value.
//   2. **Per-emit check**: `emitSizingSignal` clamps
//      `notional ≤ baseNotionalUsd × 10`. Any value above this is
//      reduced to the ceiling BEFORE emit (hard guardrail).
//   3. **Per-emit check on volMultiplier**: clamped to [0, 1] (the
//      Phase 8 Track G 1:10 mandate: volMultiplier cannot exceed 1.0
//      because the 1:10 ceiling blocks the "scale up" half of
//      Moreira-Muir 2017).
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
  ALLOWED_TIMING_LEVERAGE,
  FundingCarryTimingStrategy,
  validateTimingLeverage,
  type RollingWindowStats,
} from "../../strategy/funding-carry-timing.js";
import type { FundingSnapshot } from "../../strategy/funding-carry.js";
import { assert1to10Leverage } from "../../strategy/funding-carry-leverage.js";
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
  err,
  isCarry,
  ok,
} from "../types.js";

// ---------------------------------------------------------------------------
// CarryBaselinePluginConfig — plugin configuration
// ---------------------------------------------------------------------------

/**
 * `CarryBaselinePluginConfig` — configuration for the CarryBaselinePlugin.
 *
 * Mirrors `FundingCarryTimingConfig` for the carry layer (Phase 8
 * Track E) plus a small set of signal-center-specific knobs.
 */
export interface CarryBaselinePluginConfig {
  /** Base notional in USD. Default 10_000. */
  readonly baseNotionalUsd: number;
  /** HARD CONSTRAINT: 1 or 10. Default 10 (1:10 mandate). */
  readonly timingLeverage: 1 | 10;
  /** Rolling funding-rate window length in days. Default 30. */
  readonly windowDays: number;
  /** Entry percentile (top-quartile regime). Default 0.75. */
  readonly entryPercentile: number;
  /** Exit percentile (below-median regime). Default 0.50. */
  readonly exitPercentile: number;
  /** Cooldown between entries (hours). Default 72. */
  readonly cooldownHours: number;
  /** Rebalance threshold as fraction of effective notional. Default 0.05. */
  readonly rebalanceThresholdPct: number;
  /** Withdrawal latency (minutes). Default 15. */
  readonly withdrawalLatencyMinutes: number;
  /** Rebalance flat fee (bps). Default 20. */
  readonly rebalanceCostBps: number;
  /**
   * Kelly cap (0..1). Default 0.5 (half-Kelly) — the empirical
   * Phase 7 Track B adaptive Kelly middle bucket.
   */
  readonly kellyCap: number;
  /**
   * Vol-target ceiling for volMultiplier. Default 1.0 (the 1:10
   * mandate caps Moreira-Muir's "scale up" half at 1.0).
   */
  readonly volTargetMax: number;
}

export const DEFAULT_CARRY_BASELINE_PLUGIN_CONFIG: CarryBaselinePluginConfig = {
  baseNotionalUsd: 10_000,
  timingLeverage: 10, // 1:10 mandate default
  windowDays: 30,
  entryPercentile: 0.75,
  exitPercentile: 0.5,
  cooldownHours: 72,
  rebalanceThresholdPct: 0.05,
  withdrawalLatencyMinutes: 15,
  rebalanceCostBps: 20,
  kellyCap: 0.5,
  volTargetMax: 1.0,
};

// ---------------------------------------------------------------------------
// CarryBaselinePluginState — per-plugin mutable state
// ---------------------------------------------------------------------------

/**
 * `CarryBaselinePluginState` — mutable state held by the plugin across
 * `onBar` calls. Includes the carry strategy's state (for diagnostics)
 * plus the plugin's own signal-emission bookkeeping.
 */
export interface CarryBaselinePluginState {
  /** Trailing funding-rate history (8h snapshots, most-recent last). */
  fundingHistory: number[];
  /** Latest rolling-window stats from the underlying timing strategy. */
  lastRollingStats: RollingWindowStats;
  /** Current carry regime classification (high / neutral / flip). */
  currentRegime: "high" | "neutral" | "flip";
  /** Is the plugin currently holding the carry position? */
  isInCarry: boolean;
  /** Timestamp (ms) of the most recent entry, or null. */
  lastEntryTimeMs: number | null;
  /** Timestamp (ms) of the most recent exit, or null. */
  lastExitTimeMs: number | null;
  /** Number of entry signals emitted. */
  entryCount: number;
  /** Number of exit signals emitted. */
  exitCount: number;
  /** Total funding collected (USD) since reset. */
  fundingCollectedUsd: number;
  /** Last emitted sizing signal — used for telemetry and tests. */
  lastSizingSignal: SizingSignal | null;
  /** Last emitted carry signal — used for telemetry and tests. */
  lastCarrySignal: CarrySignal | null;
  /** Number of CarrySignals emitted since reset. */
  carrySignalCount: number;
  /** Number of SizingSignals emitted since reset. */
  sizingSignalCount: number;
  /** Hard guardrail: any emit that tried to exceed 1:10 leverage. */
  leverageClampCount: number;
}

// ---------------------------------------------------------------------------
// CarryBaselinePlugin — the reference plugin
// ---------------------------------------------------------------------------

/**
 * `CarryBaselinePlugin` — the FIRST drop-in plugin for the Signal
 * Center. Wraps the Phase 8 Track E `FundingCarryTimingStrategy` and
 * emits CarrySignals + SizingSignals on the SignalBus.
 *
 * Lifecycle:
 *   1. Construct with `new CarryBaselinePlugin({ ... })`.
 *   2. Validate via `plugin.validateConfig(...)`.
 *   3. Wire to bus via `plugin.subscribe(bus)`.
 *   4. Drive per-bar via `plugin.onBar(bar, state)`.
 *   5. Reset between backtest runs via `plugin.reset()`.
 *   6. Dispose (release bus subscriptions) via `plugin.dispose()`.
 *
 * Plugin invariant (1:10 HARD GUARDRAIL):
 *   - `metadata.maxLeverage === 10`.
 *   - Every emitted SizingSignal has `notional ≤ baseNotionalUsd × 10`.
 *   - The constructor's `assert1to10Leverage` throws on `timingLeverage`
 *     outside {1, 10}.
 *   - `validateConfig` rejects `timingLeverage` outside {1, 10}.
 */
export class CarryBaselinePlugin implements StrategyPlugin {
  readonly metadata: StrategyPluginMetadata = {
    name: "carry-baseline",
    version: "1.0.0",
    edgeClass: "mixed", // emits BOTH CarrySignals and SizingSignals
    capitalRequirement: 10_000,
    maxLeverage: 10, // 1:10 HARD GUARDRAIL
    description:
      "Phase 10G reference plugin — wraps Phase 8 Track E FundingCarryTiming. " +
      "Emits CarrySignals on regime transitions + SizingSignals based on " +
      "half-Kelly × vol-target hybrid. Respects 1:10 leverage mandate.",
    dependencies: [],
  };

  readonly config: CarryBaselinePluginConfig;
  readonly state: CarryBaselinePluginState;

  /** Underlying carry timing strategy (Phase 8 Track E). */
  private readonly carry: FundingCarryTimingStrategy;

  /** Stored bus reference (set in subscribe). */
  private bus: SignalBus | null = null;
  /** Unsubscribe handles for our own self-subscriptions (none currently). */
  private readonly unsubscribers: (() => void)[] = [];

  constructor(config: Partial<CarryBaselinePluginConfig> = {}) {
    const merged: CarryBaselinePluginConfig = {
      ...DEFAULT_CARRY_BASELINE_PLUGIN_CONFIG,
      ...config,
    };
    // 1:10 HARD GUARDRAIL — defense in depth.
    validateTimingLeverage(merged.timingLeverage);
    assert1to10Leverage(merged.timingLeverage);
    this.config = merged;
    this.carry = new FundingCarryTimingStrategy({
      baseNotionalUsd: merged.baseNotionalUsd,
      timingLeverage: merged.timingLeverage,
      windowDays: merged.windowDays,
      entryPercentile: merged.entryPercentile,
      exitPercentile: merged.exitPercentile,
      cooldownHours: merged.cooldownHours,
      rebalanceThresholdPct: merged.rebalanceThresholdPct,
      withdrawalLatencyMinutes: merged.withdrawalLatencyMinutes,
      rebalanceCostBps: merged.rebalanceCostBps,
    });
    this.state = this.mkState();
  }

  // -------------------------------------------------------------------------
  // StrategyPlugin interface
  // -------------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this.bus = bus;
    // We don't subscribe to any bus kinds ourselves — we PRODUCE
    // signals but don't consume them. Phase 10G Track B risk engine
    // will subscribe to our CarrySignals + SizingSignals for portfolio
    // risk aggregation.
  }

  onBar(_bar: Bar, _state: PluginState): void {
    // The reference plugin is a CARRY plugin — its primary input is
    // the 8h funding-rate snapshot, not the bar. The bar is provided
    // here for interface compliance and for future plugins that want
    // to condition carry on price action.
    //
    // Funding-rate updates are injected via `recordFundingSnapshot()`
    // which is called by the central runner (or by the test harness).
    // The plugin does NOT poll funding on its own — this preserves
    // the bus's deterministic emit ordering (subscribers can control
    // when funding events fire).
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
    const c = config as Partial<CarryBaselinePluginConfig>;
    if (c.timingLeverage !== undefined) {
      if (!ALLOWED_TIMING_LEVERAGE.includes(c.timingLeverage)) {
        return err({
          pluginName: this.metadata.name,
          field: "timingLeverage",
          message:
            `[1:10 HARD GUARDRAIL] timingLeverage must be 1 or 10. ` +
            `Got ${String(c.timingLeverage)}.`,
          value: c.timingLeverage,
        });
      }
    }
    if (c.baseNotionalUsd !== undefined && (!Number.isFinite(c.baseNotionalUsd) || c.baseNotionalUsd <= 0)) {
      return err({
        pluginName: this.metadata.name,
        field: "baseNotionalUsd",
        message: `baseNotionalUsd must be a positive finite number, got ${c.baseNotionalUsd}`,
        value: c.baseNotionalUsd,
      });
    }
    if (c.kellyCap !== undefined && (c.kellyCap < 0 || c.kellyCap > 1)) {
      return err({
        pluginName: this.metadata.name,
        field: "kellyCap",
        message: `kellyCap must be in [0, 1], got ${c.kellyCap}`,
        value: c.kellyCap,
      });
    }
    if (c.volTargetMax !== undefined && (c.volTargetMax < 0 || c.volTargetMax > 1)) {
      return err({
        pluginName: this.metadata.name,
        field: "volTargetMax",
        message: `volTargetMax must be in [0, 1] (1:10 mandate ceiling), got ${c.volTargetMax}`,
        value: c.volTargetMax,
      });
    }
    return ok(undefined);
  }

  reset(): void {
    this.carry.reset();
    this.state.fundingHistory = [];
    this.state.lastRollingStats = this._emptyStats();
    this.state.currentRegime = "neutral";
    this.state.isInCarry = false;
    this.state.lastEntryTimeMs = null;
    this.state.lastExitTimeMs = null;
    this.state.entryCount = 0;
    this.state.exitCount = 0;
    this.state.fundingCollectedUsd = 0;
    this.state.lastSizingSignal = null;
    this.state.lastCarrySignal = null;
    this.state.carrySignalCount = 0;
    this.state.sizingSignalCount = 0;
    this.state.leverageClampCount = 0;
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
   * `recordFundingSnapshot` — drive the carry strategy with a new
   * funding-rate snapshot. The central runner calls this at each 8h
   * funding tick. The plugin will:
   *
   *   1. Append to rolling-window stats.
   *   2. Classify the new regime (high / neutral / flip).
   *   3. Evaluate timing (enter / exit / hold).
   *   4. Emit a CarrySignal on every snapshot.
   *   5. On regime transition, emit a SizingSignal.
   *   6. Update internal state.
   *
   * Returns the regime classification.
   */
  recordFundingSnapshot(snap: FundingSnapshot): "high" | "neutral" | "flip" {
    if (!this.bus) {
      throw new Error(
        "CarryBaselinePlugin.recordFundingSnapshot: bus not wired. " +
          "Call plugin.subscribe(bus) before recordFundingSnapshot.",
      );
    }
    // Append to local history (mirror of carry.state.fundingHistory).
    this.state.fundingHistory.push(snap.fundingRate);
    const maxEntries = this.config.windowDays * 3 + 8;
    if (this.state.fundingHistory.length > maxEntries) {
      this.state.fundingHistory.splice(
        0,
        this.state.fundingHistory.length - maxEntries,
      );
    }
    // Drive the underlying carry strategy.
    const stats = this.carry.recordFundingSample(snap.fundingRate, snap.fundingTime);
    this.state.lastRollingStats = stats;
    // Classify regime from current stats + funding rate.
    const regime = this._classifyRegime(snap.fundingRate, stats);
    const prevRegime = this.state.currentRegime;
    this.state.currentRegime = regime;

    // Emit CarrySignal on every snapshot (telemetry consumers want
    // every funding tick for graph rendering). This is also the
    // discriminant that subscribes the bus-wide pattern.
    const carrySig: CarrySignal = {
      kind: "carry",
      fundingRate: snap.fundingRate,
      regime,
      source: this.metadata.name,
      timestampMs: snap.fundingTime,
    };
    this.state.lastCarrySignal = carrySig;
    this.state.carrySignalCount += 1;
    this.bus.emit(carrySig);

    // Decide entry/exit.
    const decision = this.carry.evaluateTiming(snap.fundingRate, snap.fundingTime);
    if (decision === "enter" && !this.state.isInCarry) {
      this.carry._enterCarry(snap.fundingTime);
      this.state.isInCarry = true;
      this.state.lastEntryTimeMs = snap.fundingTime;
      this.state.entryCount += 1;
    } else if (decision === "exit" && this.state.isInCarry) {
      this.carry._exitCarry(snap.fundingTime);
      this.state.isInCarry = false;
      this.state.lastExitTimeMs = snap.fundingTime;
      this.state.exitCount += 1;
    }

    // Accrue funding if in carry (delta-neutral carry at scaled notional).
    if (this.state.isInCarry) {
      this.carry.accrueFundingOnSnapshot(snap);
      this.state.fundingCollectedUsd = this.carry.state.fundingCollectedUsd;
    }

    // Emit SizingSignal on regime TRANSITIONS (high↔neutral↔flip) and
    // on every entry/exit. Conservative: a sizing signal is small but
    // useful for portfolio risk aggregation.
    const regimeChanged = regime !== prevRegime;
    const enterExit = decision !== "hold";
    if (regimeChanged || enterExit) {
      this._emitSizingSignal(snap.fundingTime);
    }

    return regime;
  }

  /**
   * `classifyRegime` — pure-functional classifier exposed for tests.
   * Maps a (fundingRate, rollingStats) pair to a regime.
   *
   * Rules:
   *   - `high`   — current rate > p75 AND positive.
   *   - `flip`   — current rate < median AND negative-dominance (rate < 0).
   *   - `neutral`— otherwise (rate near median, no clear signal).
   */
  classifyRegime(currentRate: number, stats: RollingWindowStats): "high" | "neutral" | "flip" {
    return this._classifyRegime(currentRate, stats);
  }

  /**
   * `effectiveLeverage` — current effective leverage (1× baseline or
   * 1:10 = 10×). ALWAYS ∈ {1, 10}. Used by telemetry + tests.
   */
  effectiveLeverage(): 1 | 10 {
    return this.config.timingLeverage;
  }

  /**
   * `effectiveNotionalUsd` — current effective notional in USD.
   * ALWAYS ≤ baseNotionalUsd × 10 (the 1:10 mandate ceiling).
   */
  effectiveNotionalUsd(): number {
    return this.config.baseNotionalUsd * this.config.timingLeverage;
  }

  // -------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------

  private mkState(): CarryBaselinePluginState {
    return {
      fundingHistory: [],
      lastRollingStats: this._emptyStats(),
      currentRegime: "neutral",
      isInCarry: false,
      lastEntryTimeMs: null,
      lastExitTimeMs: null,
      entryCount: 0,
      exitCount: 0,
      fundingCollectedUsd: 0,
      lastSizingSignal: null,
      lastCarrySignal: null,
      carrySignalCount: 0,
      sizingSignalCount: 0,
      leverageClampCount: 0,
    };
  }

  private _emptyStats(): RollingWindowStats {
    return {
      count: 0,
      median: 0,
      mean: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      p25: 0,
      p75: 0,
      p90: 0,
    };
  }

  /**
   * `_classifyRegime` — internal classifier. Mirrors `classifyRegime`
   * for use inside the plugin.
   */
  private _classifyRegime(
    currentRate: number,
    stats: RollingWindowStats,
  ): "high" | "neutral" | "flip" {
    if (stats.count < 30) return "neutral"; // insufficient history
    if (currentRate > stats.p75 && currentRate > 0) return "high";
    if (currentRate < stats.median && currentRate < 0) return "flip";
    return "neutral";
  }

  /**
   * `_emitSizingSignal` — compute + emit a SizingSignal with hard
   * guardrails:
   *
   *   - `kellyFraction` ∈ [0, kellyCap] (default kellyCap = 0.5).
   *   - `volMultiplier` ∈ [0, volTargetMax] (default 1.0 — the 1:10
   *     mandate caps Moreira-Muir scale-up at 1.0).
   *   - `notional` = baseNotionalUsd × leverage × kelly × volMultiplier.
   *     Hard-clamped to ≤ baseNotionalUsd × 10 (the 1:10 ceiling).
   *
   * If the computed notional WOULD exceed the 1:10 ceiling, it's
   * clamped and `state.leverageClampCount` is incremented.
   */
  private _emitSizingSignal(timestampMs: number): void {
    if (!this.bus) return;
    // Kelly multiplier proxy: 0.5 in 'neutral', up to kellyCap in 'high',
    // down to ~0 in 'flip'.
    let kellyFraction: number;
    switch (this.state.currentRegime) {
      case "high":
        kellyFraction = this.config.kellyCap;
        break;
      case "flip":
        kellyFraction = 0;
        break;
      case "neutral":
      default:
        kellyFraction = this.config.kellyCap * 0.5;
        break;
    }
    // Vol multiplier proxy: 1.0 in 'neutral' (low-vol carry), 0.5 in
    // 'high' (defensive on vol spikes around funding events), 0.25 in
    // 'flip' (severe regime — minimal exposure).
    let volMultiplier: number;
    switch (this.state.currentRegime) {
      case "high":
        volMultiplier = 0.5;
        break;
      case "flip":
        volMultiplier = 0.25;
        break;
      case "neutral":
      default:
        volMultiplier = 1.0;
        break;
    }
    // Hard ceiling clamp.
    volMultiplier = Math.max(0, Math.min(this.config.volTargetMax, volMultiplier));
    kellyFraction = Math.max(0, Math.min(1, kellyFraction));

    const baseNotional = this.config.baseNotionalUsd;
    const maxNotional = baseNotional * this.config.timingLeverage; // 1:10 ceiling
    const computedNotional = baseNotional * this.config.timingLeverage * kellyFraction * volMultiplier;
    let notional = computedNotional;
    if (notional > maxNotional) {
      notional = maxNotional;
      this.state.leverageClampCount += 1;
    }
    const sizing: SizingSignal = {
      kind: "sizing",
      kellyFraction,
      volMultiplier,
      notional,
      source: this.metadata.name,
      timestampMs,
    };
    this.state.lastSizingSignal = sizing;
    this.state.sizingSignalCount += 1;
    this.bus.emit(sizing);
  }
}

// ---------------------------------------------------------------------------
// Helper: narrow CarrySignal from a generic Signal (re-exported for callers)
// ---------------------------------------------------------------------------

/**
 * `extractCarrySignal` — pull a CarrySignal out of a generic Signal
 * event. Returns null if the event is not a CarrySignal.
 *
 * This is a convenience wrapper around `isCarry` for callers that
 * only care about CarrySignals.
 */
export function extractCarrySignal(s: unknown): CarrySignal | null {
  if (typeof s !== "object" || s === null) return null;
  const obj = s as { kind?: unknown };
  if (obj.kind !== "carry") return null;
  if (isCarry(s as never)) {
    return s as CarrySignal;
  }
  return null;
}