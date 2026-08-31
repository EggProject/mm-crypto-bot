// packages/core/src/signal-center/monolith-wrappers/composite-plugin.ts
// — Phase 13 Track A
//
// ===========================================================================
// CompositePlugin — wraps `CompositeStrategy` (composite)
// ===========================================================================
//
// The wrapper:
//   - holds a `CompositeStrategy` instance
//   - declares `maxAggregateEffectiveLeverage: 10` (aggregate effective-exposure hard guardrail)
//   - asserts the aggregate effective-exposure limit at 3 layers (constructor +
//     subscribe + per-emit) — see "Three-layer enforcement" memory rule
//   - on every bar, builds a minimal `StrategyContext` from the bar and
//     delegates `onCandle(ctx)` to the underlying strategy
//   - translates the underlying `StrategySignal` into typed Signal events
//     (DirectionSignal + SizingSignal) on the SignalBus
//
// Plugin invariants (aggregate effective-exposure hard guardrail — defense-in-depth, 3 layers):
//   - Layer 1 (constructor): `metadata.maxAggregateEffectiveLeverage === 10` asserted at
//     construction; throws on leverage ∉ {1, 10}.
//   - Layer 2 (subscribe): `assertAggregateEffectiveExposureLimit` runs at subscribe
//     time as a structural sanity check.
//   - Layer 3 (per-emit): every emitted SizingSignal has
//     `notional ≤ baseNotionalUsd × 10` (clamped to ceiling if
//     necessary); the clamp increments `leverageClampCount`.

import {
  CompositeStrategy,
  type CompositeStrategyConfig,
  DEFAULT_COMPOSITE_CONFIG,
} from "../../strategy/composite.js";
import {
  DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  assertAggregateEffectiveExposureLimit,
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  type AggregateEffectiveExposureLimit,
} from "../../risk/leverage-invariant.js";
import type { SignalBus } from "../signal-bus.js";
import type { StrategyPlugin, StrategyPluginMetadata } from "../strategy-registry.js";
import {
  type Bar,
  type ConfigError,
  type DirectionSignal,
  type PluginState,
  type Result,
  type SizingSignal,
  err as errorResult,
  ok,
} from "../types.js";
import type { Strategy, StrategyContext, StrategySignal } from "../../types.js";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

/**
 * `CompositePluginConfig` — configuration for the wrapper. Includes the
 * underlying strategy's knobs plus SCv1 envelope settings
 * (baseNotionalUsd, leverage).
 */
export interface CompositePluginConfig {
  /**
   * Base notional in USD (1× equity). Default 10_000.
   */
  readonly baseNotionalUsd: number;
  /**
   * HARD CONSTRAINT: 1 or 10. Default 10 (aggregate effective-exposure limit).
   */
  readonly leverage: 1 | 10;
  /**
   * Pass-through to the underlying strategy. Optional — defaults to underlying defaults.
   */
  readonly strategy?: Partial<CompositeStrategyConfig>;
  /**
   * Instrument/timeframe are mandatory; the wrapper never guesses them.
   */
  readonly symbol?: string;
  readonly timeframe?: Timeframe;
  /**
   * Aggregate effective-exposure configuration used by Layers 2 and 3.
   */
  readonly leverageInvariant: AggregateEffectiveExposureLimit;
}

export type CompositePluginInput = Omit<Partial<CompositePluginConfig>, "leverage"> & {
  readonly leverage?: number;
};

export const DEFAULT_COMPOSITE_PLUGIN_CONFIG: Omit<CompositePluginConfig, "strategy"> = {
  baseNotionalUsd: 10_000,
  leverage: 10, // aggregate effective-exposure hard guardrail
  leverageInvariant: DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
};

/**
 * `CompositePluginState` — per-plugin mutable state held across `onBar` calls.
 */
export interface CompositePluginState {
  /**
   * Number of DirectionSignals emitted since reset.
   */
  directionSignalCount: number;
  /**
   * Number of SizingSignals emitted since reset.
   */
  sizingSignalCount: number;
  /**
   * Number of emits that required aggregate effective-exposure clamping.
   */
  leverageClampCount: number;
  /**
   * Last emitted DirectionSignal — used for telemetry and tests.
   */
  lastDirectionSignal: DirectionSignal | undefined;
  /**
   * Last emitted SizingSignal — used for telemetry and tests.
   */
  lastSizingSignal: SizingSignal | undefined;
  /**
   * Most recent underlying strategy signal; undefined means no signal.
   */
  lastUnderlyingSignal: StrategySignal | undefined;
}

type ResettableStrategy = Strategy & { readonly reset: () => void };

function isResettableStrategy(strategy: Strategy): strategy is ResettableStrategy {
  return "reset" in strategy && typeof strategy.reset === "function";
}

function isAbsentConfig(config: unknown): config is undefined | null {
  return config === undefined || Object.prototype.toString.call(config) === "[object Null]";
}

function describeUnknown(value: unknown): string {
  if (value === undefined) return "undefined";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (typeof value === "symbol") return value.description ?? "symbol";
  if (typeof value === "function") return value.name;
  return Object.prototype.toString.call(value);
}

export class CompositePlugin implements StrategyPlugin {
  /**
   * Underlying monolith strategy.
   */
  private readonly underlying: CompositeStrategy;
  /**
   * Reset-capable components validated at construction.
   */
  private readonly components: readonly [ResettableStrategy, ResettableStrategy];
  /**
   * Stored bus reference set in subscribe.
   */
  private bus: SignalBus | undefined;
  /**
   * Layer 2 subscribe assertion counter.
   */
  private layer2AssertionCount = 0;
  /**
   * Layer 3 per-emit assertion counter.
   */
  private layer3AssertionCount = 0;
  /**
   * Number of bars processed since construction.
   */
  private barCount = 0;
  /**
   * Monotonic candle index incremented per onBar.
   */
  private candleIndex = 0;
  readonly metadata: StrategyPluginMetadata = {
    name: "composite-v1",
    version: "1.0.0",
    edgeClass: "mixed",
    capitalRequirement: 10_000,
    maxAggregateEffectiveLeverage: DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE, // aggregate effective-exposure hard guardrail
    description:
      "Phase 13 Track A wrapper around CompositeStrategy. " +
      "Hides the monolith strategy behind the Signal Center. Emits " +
      "DirectionSignal (long/short/flat) + SizingSignal on entry. " +
      "Respects the aggregate effective-exposure limit via 3-layer defense.",
    dependencies: [],
  };

  readonly config: CompositePluginConfig;
  readonly state: CompositePluginState;

  constructor(config: CompositePluginInput = {}) {
    // LAYER 1 — constructor check on metadata.maxAggregateEffectiveLeverage.
    if (this.metadata.maxAggregateEffectiveLeverage !== DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE) {
      throw new Error(
        `[CompositePlugin] aggregate effective-exposure hard guardrail VIOLATION: metadata.maxAggregateEffectiveLeverage=${String(this.metadata.maxAggregateEffectiveLeverage)} but the project-wide aggregate effective-exposure limit requires 10.`,
      );
    }
    const leverage = config.leverage ?? DEFAULT_COMPOSITE_PLUGIN_CONFIG.leverage;
    if (leverage !== 1 && leverage !== 10) {
      throw new Error(
        `[CompositePlugin] aggregate effective-exposure hard guardrail VIOLATION: leverage=${String(leverage)} is NOT ALLOWED. Only 1 (baseline) or 10 (1:10 mandatory) are accepted.`,
      );
    }
    const merged: CompositePluginConfig = {
      ...DEFAULT_COMPOSITE_PLUGIN_CONFIG,
      ...config,
      leverage,
    };
    if (!Number.isFinite(merged.baseNotionalUsd) || merged.baseNotionalUsd <= 0) {
      throw new Error(
        `[CompositePlugin] baseNotionalUsd must be positive finite, got ${String(merged.baseNotionalUsd)}`,
      );
    }
    if (!merged.strategy?.component1 || !merged.strategy.component2) {
      throw new Error("[CompositePlugin] strategy.component1 and strategy.component2 are required");
    }
    if (typeof merged.symbol !== "string" || merged.symbol.length === 0) {
      throw new Error("[CompositePlugin] symbol is required; implicit BTC attribution is forbidden");
    }
    if (merged.timeframe === undefined) {
      throw new Error("[CompositePlugin] timeframe is required; implicit 1h context is forbidden");
    }
    const component1 = merged.strategy.component1;
    const component2 = merged.strategy.component2;
    if (!isResettableStrategy(component1) || !isResettableStrategy(component2)) {
      const componentWithoutReset = isResettableStrategy(component1) ? component2 : component1;
      throw new TypeError(
        `[CompositePlugin] component "${componentWithoutReset.name}" lacks reset(); fresh-run lifecycle cannot be guaranteed`,
      );
    }
    this.config = merged;
    this.components = [component1, component2];
    const strategyConfig: CompositeStrategyConfig = {
      ...DEFAULT_COMPOSITE_CONFIG,
      ...merged.strategy,
      component1,
      component2,
    };
    this.underlying = new CompositeStrategy(strategyConfig);
    this.state = this._mkState();
  }

  // -------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------

  private _mkState(): CompositePluginState {
    return {
      directionSignalCount: 0,
      sizingSignalCount: 0,
      leverageClampCount: 0,
      lastDirectionSignal: undefined,
      lastSizingSignal: undefined,
      lastUnderlyingSignal: undefined,
    };
  }

  private _buildContext(bar: Bar): StrategyContext {
    return {
      symbol: makeSymbol(this._requireSymbol()),
      timeframe: this._requireTimeframe(),
      candleIndex: this.candleIndex,
      candle: {
        timestamp: bar.timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      },
      mtfState: {
        ltf: {},
        mtf: {},
        htf: {},
      },
      pricePrecision: 2,
    };
  }

  private _emitFromSignal(signal: StrategySignal | undefined, timestampMs: number): void {
    if (!this.bus) return;
    if (signal === undefined) {
      this._emitDirection("flat", 0, timestampMs);
      return;
    }
    const side: "long" | "short" = signal.side === "buy" ? "long" : "short";
    const strength = Math.max(0, Math.min(1, signal.confidence));
    this._emitDirection(side, strength, timestampMs);
    if (signal.side === "buy") {
      this._emitSizing(strength, timestampMs);
    }
  }

  private _emitDirection(side: "long" | "short" | "flat", strength: number, timestampMs: number): void {
    if (!this.bus) return;
    const signal: DirectionSignal = {
      kind: "direction",
      side,
      strength: Math.max(0, Math.min(1, strength)),
      source: this.metadata.name,
      symbol: this._requireSymbol(),
      timestampMs,
    };
    this.state.lastDirectionSignal = signal;
    this.state.directionSignalCount += 1;
    this.bus.emit(signal);
  }

  private _emitSizing(strength: number, timestampMs: number): void {
    if (!this.bus) return;
    const kellyFraction = Math.max(0, Math.min(1, strength));
    const volMultiplier = 1;
    let notional = this.config.baseNotionalUsd * this.config.leverage * kellyFraction * volMultiplier;
    try {
      assertAggregateEffectiveExposureLimit(
        notional,
        this.config.baseNotionalUsd,
        this.config.leverageInvariant,
      );
      this.layer3AssertionCount += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[CompositePlugin] LAYER 3 BREACH on sizing emit: ${message}`, { cause: error });
    }
    const maxNotional = this.effectiveMaxNotionalUsd();
    if (notional > maxNotional) {
      notional = maxNotional;
      this.state.leverageClampCount += 1;
    }
    try {
      assertAggregateEffectiveExposureLimit(
        notional,
        this.config.baseNotionalUsd,
        this.config.leverageInvariant,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[CompositePlugin] LAYER 3 BREACH post-clamp: ${message}`, { cause: error });
    }
    const signal: SizingSignal = {
      kind: "sizing",
      kellyFraction,
      volMultiplier,
      notional,
      source: this.metadata.name,
      symbol: this._requireSymbol(),
      timestampMs,
    };
    this.state.lastSizingSignal = signal;
    this.state.sizingSignalCount += 1;
    this.bus.emit(signal);
  }

  private _requireSymbol(): string {
    const { symbol } = this.config;
    if (symbol === undefined) {
      throw new Error("[CompositePlugin] symbol is required");
    }
    return symbol;
  }

  private _requireTimeframe(): Timeframe {
    const { timeframe } = this.config;
    if (timeframe === undefined) {
      throw new Error("[CompositePlugin] timeframe is required");
    }
    return timeframe;
  }

  // -------------------------------------------------------------------------
  // StrategyPlugin interface
  // -------------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this.bus = bus;
    // LAYER 2 — subscribe-time structural sanity check.
    try {
      assertAggregateEffectiveExposureLimit(
        this.config.baseNotionalUsd * this.config.leverage,
        this.config.baseNotionalUsd,
        this.config.leverageInvariant,
      );
      this.layer2AssertionCount += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[CompositePlugin] LAYER 2 BREACH on subscribe: ${message}`, { cause: error });
    }
  }

  onBar(bar: Bar, _state: PluginState): void {
    this.barCount += 1;
    this.candleIndex += 1;
    const context = this._buildContext(bar);
    const signal = this.underlying.onCandle(context);
    this.state.lastUnderlyingSignal = signal;
    this._emitFromSignal(signal, bar.timestamp);
  }

  validateConfig(config: unknown): Result<void, ConfigError> {
    if (isAbsentConfig(config)) return ok(undefined);
    if (typeof config !== "object") {
      return errorResult({
        pluginName: this.metadata.name,
        field: "config",
        message: `config must be an object, got ${typeof config}`,
      });
    }
    const leverage = "leverage" in config ? config.leverage : undefined;
    if (leverage !== undefined && leverage !== 1 && leverage !== 10) {
      return errorResult({
        pluginName: this.metadata.name,
        field: "leverage",
        message: `[aggregate effective-exposure hard guardrail] leverage must be 1 or 10. Got ${describeUnknown(leverage)}.`,
        value: leverage,
      });
    }
    const baseNotionalUsd = "baseNotionalUsd" in config ? config.baseNotionalUsd : undefined;
    if (
      baseNotionalUsd !== undefined &&
      (typeof baseNotionalUsd !== "number" || !Number.isFinite(baseNotionalUsd) || baseNotionalUsd <= 0)
    ) {
      return errorResult({
        pluginName: this.metadata.name,
        field: "baseNotionalUsd",
        message: `baseNotionalUsd must be positive finite, got ${describeUnknown(baseNotionalUsd)}`,
        value: baseNotionalUsd,
      });
    }
    return ok(undefined);
  }

  reset(): void {
    for (const component of this.components) {
      component.reset();
    }
    this.state.directionSignalCount = 0;
    this.state.sizingSignalCount = 0;
    this.state.leverageClampCount = 0;
    this.state.lastDirectionSignal = undefined;
    this.state.lastSizingSignal = undefined;
    this.state.lastUnderlyingSignal = undefined;
    this.layer2AssertionCount = 0;
    this.layer3AssertionCount = 0;
    this.barCount = 0;
    this.candleIndex = 0;
  }

  dispose(): void {
    this.bus = undefined;
  }

  // -------------------------------------------------------------------------
  // Public introspection
  // -------------------------------------------------------------------------

  effectiveLeverage(): 1 | 10 {
    return this.config.leverage;
  }

  effectiveNotionalUsd(): number {
    return this.config.baseNotionalUsd * this.config.leverage;
  }

  effectiveMaxNotionalUsd(): number {
    return this.config.baseNotionalUsd * DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE;
  }

  layer2AssertionCountForTest(): number {
    return this.layer2AssertionCount;
  }

  layer3AssertionCountForTest(): number {
    return this.layer3AssertionCount;
  }

  barCountForTest(): number {
    return this.barCount;
  }

  /**
   * `emitSizingForTest` — test-only escape hatch to invoke the Layer 3
   * sizing emit path with a synthetic strength value.
   */
  emitSizingForTest(strength: number, timestampMs: number): void {
    this._emitSizing(strength, timestampMs);
  }
}

/**
 * `createCompositePlugin` — convenience factory.
 */
export function createCompositePlugin(config?: CompositePluginInput): CompositePlugin {
  return new CompositePlugin(config);
}
