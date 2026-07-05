// packages/core/src/signal-center/monolith-wrappers/mtf-trend-confluence-plugin.ts
// — Phase 13 Track A
//
// ===========================================================================
// MtfTrendConfluencePlugin — wraps `MtfTrendConfluenceStrategy` (mtf-trend-confluence)
// ===========================================================================
//
// The wrapper:
//   - holds a `MtfTrendConfluenceStrategy` instance
//   - declares `maxLeverage: 10` (1:10 HARD GUARDRAIL)
//   - asserts the 1:10 leverage invariant at 3 layers (constructor +
//     subscribe + per-emit) — see "Three-layer enforcement" memory rule
//   - on every bar, builds a minimal `StrategyContext` from the bar and
//     delegates `onCandle(ctx)` to the underlying strategy
//   - translates the underlying `StrategySignal` into typed Signal events
//     (DirectionSignal + SizingSignal) on the SignalBus
//
// Plugin invariants (1:10 HARD GUARDRAIL — defense-in-depth, 3 layers):
//   - Layer 1 (constructor): `metadata.maxLeverage === 10` asserted at
//     construction; throws on leverage ∉ {1, 10}.
//   - Layer 2 (subscribe): `assertLeverageInvariant` runs at subscribe
//     time as a structural sanity check.
//   - Layer 3 (per-emit): every emitted SizingSignal has
//     `notional ≤ baseNotionalUsd × 10` (clamped to ceiling if
//     necessary); the clamp increments `leverageClampCount`.

import { MtfTrendConfluenceStrategy } from "../../strategy/mtf-trend-confluence.js";
import { type MtfTrendConfluenceConfig, DEFAULT_MTF_CONFIG } from "../../types.js";
import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
  DEFAULT_LEVERAGE_INVARIANT_CONFIG,
  type LeverageInvariantConfig,
} from "../../risk/leverage-invariant.js";
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
  type SizingSignal,
  err,
  ok,
} from "../types.js";
import type {
  StrategyContext,
  StrategySignal,
} from "../../types.js";

/**
 * `MtfTrendConfluencePluginConfig` — configuration for the wrapper. Includes the
 * underlying strategy's knobs plus SCv1 envelope settings
 * (baseNotionalUsd, leverage).
 */
export interface MtfTrendConfluencePluginConfig {
  /** Base notional in USD (1× equity). Default 10_000. */
  readonly baseNotionalUsd: number;
  /** HARD CONSTRAINT: 1 or 10. Default 10 (1:10 mandate). */
  readonly leverage: 1 | 10;
  /** Pass-through to the underlying strategy. Optional — defaults to underlying defaults. */
  readonly strategy?: Partial<MtfTrendConfluenceConfig>;
  /** Leverage invariant config (Layer 2/3 reference). Default 1:10. */
  readonly leverageInvariant: LeverageInvariantConfig;
}

export const DEFAULT_MTF_TREND_CONFLUENCE_PLUGIN_CONFIG: Omit<
  MtfTrendConfluencePluginConfig,
  "strategy"
> = {
  baseNotionalUsd: 10_000,
  leverage: 10, // 1:10 HARD GUARDRAIL
  leverageInvariant: DEFAULT_LEVERAGE_INVARIANT_CONFIG,
};

/**
 * `MtfTrendConfluencePluginState` — per-plugin mutable state held across `onBar` calls.
 */
export interface MtfTrendConfluencePluginState {
  /** Number of DirectionSignals emitted since reset. */
  directionSignalCount: number;
  /** Number of SizingSignals emitted since reset. */
  sizingSignalCount: number;
  /** Hard guardrail: any emit that tried to exceed 1:10 leverage. */
  leverageClampCount: number;
  /** Last emitted DirectionSignal — used for telemetry + tests. */
  lastDirectionSignal: DirectionSignal | null;
  /** Last emitted SizingSignal — used for telemetry + tests. */
  lastSizingSignal: SizingSignal | null;
  /** Most recent underlying strategy signal (null = no signal). */
  lastUnderlyingSignal: StrategySignal | null;
}

export class MtfTrendConfluencePlugin implements StrategyPlugin {
  readonly metadata: StrategyPluginMetadata = {
    name: "mtf-trend-confluence-v1",
    version: "1.0.0",
    edgeClass: "directional",
    capitalRequirement: 10_000,
    maxLeverage: ONE_TO_TEN_LEVERAGE, // 1:10 HARD GUARDRAIL
    description:
      "Phase 13 Track A wrapper around MtfTrendConfluenceStrategy. " +
      "Hides the monolith strategy behind the Signal Center. Emits " +
      "DirectionSignal (long/short/flat) + SizingSignal on entry. " +
      "Respects the 1:10 leverage mandate via 3-layer defense.",
    dependencies: [],
  };

  readonly config: MtfTrendConfluencePluginConfig;
  readonly state: MtfTrendConfluencePluginState;
  /** Underlying monolith strategy. */
  private readonly underlying: MtfTrendConfluenceStrategy;
  /** Stored bus reference (set in subscribe). */
  private bus: SignalBus | null = null;
  /** Layer 2 subscribe assertion counter. */
  private layer2AssertionCount = 0;
  /** Layer 3 per-emit assertion counter. */
  private layer3AssertionCount = 0;
  /** Number of bars processed since construction. */
  private barCount = 0;
  /** Monotonic candle index (incremented per onBar). */
  private candleIndex = 0;

  constructor(config: Partial<MtfTrendConfluencePluginConfig> = {}) {
    const merged: MtfTrendConfluencePluginConfig = {
      ...DEFAULT_MTF_TREND_CONFLUENCE_PLUGIN_CONFIG,
      ...config,
    };
    // LAYER 1 — constructor check on metadata.maxLeverage.
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[MtfTrendConfluencePlugin] 1:10 HARD GUARDRAIL VIOLATION: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }
    // LAYER 1 — constructor check on leverage value.
    if (merged.leverage !== (1 as 1 | 10) && merged.leverage !== (10 as 1 | 10)) {
      throw new Error(
        `[MtfTrendConfluencePlugin] 1:10 HARD GUARDRAIL VIOLATION: leverage=${String(merged.leverage)} is NOT ALLOWED. Only 1 (baseline) or 10 (1:10 mandatory) are accepted.`,
      );
    }
    if (
      !Number.isFinite(merged.baseNotionalUsd) ||
      merged.baseNotionalUsd <= 0
    ) {
      throw new Error(
        `[MtfTrendConfluencePlugin] baseNotionalUsd must be positive finite, got ${String(merged.baseNotionalUsd)}`,
      );
    }
    this.config = merged;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    this.underlying = new MtfTrendConfluenceStrategy({ ...DEFAULT_MTF_CONFIG, ...merged.strategy } as unknown as MtfTrendConfluenceConfig);
    this.state = this._mkState();
  }

  // -------------------------------------------------------------------------
  // StrategyPlugin interface
  // -------------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this.bus = bus;
    // LAYER 2 — subscribe-time structural sanity check.
    try {
      assertLeverageInvariant(
        this.config.baseNotionalUsd * this.config.leverage,
        this.config.baseNotionalUsd,
        this.config.leverageInvariant,
      );
      this.layer2AssertionCount += 1;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[MtfTrendConfluencePlugin] LAYER 2 BREACH on subscribe: ${msg}`,
        { cause: e },
      );
    }
  }

  onBar(bar: Bar, _state: PluginState): void {
    this.barCount += 1;
    this.candleIndex += 1;
    const ctx = this._buildContext(bar);
    let signal: StrategySignal | null = null;
    try {
      signal = this.underlying.onCandle(ctx);
    } catch (e: unknown) {
      void e;
    }
    this.state.lastUnderlyingSignal = signal;
    this._emitFromSignal(signal, bar.timestamp);
  }

  validateConfig(config: unknown): Result<void, ConfigError> {
    if (config === null || config === undefined) return ok(undefined);
    if (typeof config !== "object") {
      return err({
        pluginName: this.metadata.name,
        field: "config",
        message: `config must be an object, got ${typeof config}`,
      });
    }
    const c = config as Partial<MtfTrendConfluencePluginConfig>;
    if (
      c.leverage !== undefined &&
      c.leverage !== 1 &&
      c.leverage !== (10 as 1 | 10)
    ) {
      return err({
        pluginName: this.metadata.name,
        field: "leverage",
        message:
          `[1:10 HARD GUARDRAIL] leverage must be 1 or 10. Got ${String(c.leverage)}.`,
        value: c.leverage,
      });
    }
    if (
      c.baseNotionalUsd !== undefined &&
      (!Number.isFinite(c.baseNotionalUsd) || c.baseNotionalUsd <= 0)
    ) {
      return err({
        pluginName: this.metadata.name,
        field: "baseNotionalUsd",
        message: `baseNotionalUsd must be positive finite, got ${String(c.baseNotionalUsd)}`,
        value: c.baseNotionalUsd,
      });
    }
    return ok(undefined);
  }

  reset(): void {
    this.state.directionSignalCount = 0;
    this.state.sizingSignalCount = 0;
    this.state.leverageClampCount = 0;
    this.state.lastDirectionSignal = null;
    this.state.lastSizingSignal = null;
    this.state.lastUnderlyingSignal = null;
    this.layer2AssertionCount = 0;
    this.layer3AssertionCount = 0;
    this.barCount = 0;
    this.candleIndex = 0;
  }

  dispose(): void {
    this.bus = null;
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
    return this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
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

  // -------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------

  private _mkState(): MtfTrendConfluencePluginState {
    return {
      directionSignalCount: 0,
      sizingSignalCount: 0,
      leverageClampCount: 0,
      lastDirectionSignal: null,
      lastSizingSignal: null,
      lastUnderlyingSignal: null,
    };
  }

  private _buildContext(bar: Bar): StrategyContext {
    return {
      symbol: "BTC/USDT" as unknown as StrategyContext["symbol"],
      timeframe: "1h",
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

  private _emitFromSignal(
    signal: StrategySignal | null,
    timestampMs: number,
  ): void {
    if (!this.bus) return;
    if (signal === null) {
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

  private _emitDirection(
    side: "long" | "short" | "flat",
    strength: number,
    timestampMs: number,
  ): void {
    if (!this.bus) return;
    const signal: DirectionSignal = {
      kind: "direction",
      side,
      strength: Math.max(0, Math.min(1, strength)),
      source: this.metadata.name,
      timestampMs,
    };
    this.state.lastDirectionSignal = signal;
    this.state.directionSignalCount += 1;
    this.bus.emit(signal);
  }

  private _emitSizing(strength: number, timestampMs: number): void {
    if (!this.bus) return;
    const kellyFraction = Math.max(0, Math.min(1, strength));
    const volMultiplier = 1.0;
    let notional =
      this.config.baseNotionalUsd *
      this.config.leverage *
      kellyFraction *
      volMultiplier;
    try {
      assertLeverageInvariant(
        notional,
        this.config.baseNotionalUsd,
        this.config.leverageInvariant,
      );
      this.layer3AssertionCount += 1;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[MtfTrendConfluencePlugin] LAYER 3 BREACH on sizing emit: ${msg}`,
        { cause: e },
      );
    }
    const maxNotional = this.effectiveMaxNotionalUsd();
    if (notional > maxNotional) {
      notional = maxNotional;
      this.state.leverageClampCount += 1;
    }
    try {
      assertLeverageInvariant(
        notional,
        this.config.baseNotionalUsd,
        this.config.leverageInvariant,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[MtfTrendConfluencePlugin] LAYER 3 BREACH post-clamp: ${msg}`,
        { cause: e },
      );
    }
    const signal: SizingSignal = {
      kind: "sizing",
      kellyFraction,
      volMultiplier,
      notional,
      source: this.metadata.name,
      timestampMs,
    };
    this.state.lastSizingSignal = signal;
    this.state.sizingSignalCount += 1;
    this.bus.emit(signal);
  }
}

/**
 * `createMtfTrendConfluencePlugin` — convenience factory.
 */
export function createMtfTrendConfluencePlugin(
  config?: Partial<MtfTrendConfluencePluginConfig>,
): MtfTrendConfluencePlugin {
  return new MtfTrendConfluencePlugin(config);
}
