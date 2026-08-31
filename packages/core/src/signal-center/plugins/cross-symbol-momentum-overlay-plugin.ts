import {
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  assertAggregateEffectiveExposureLimit,
} from "../../risk/leverage-invariant.js";

import type { SignalBus } from "../signal-bus.js";
import type { StrategyPlugin, StrategyPluginMetadata } from "../strategy-registry.js";
import {
  type Bar,
  type ConfigError,
  type DirectionSignal,
  type PluginState,
  type Result,
  ok,
} from "../types.js";

export interface CrossSymbolMomentumOverlayConfig {
  readonly lookbackDays: number;
  readonly momentumThreshold: number;
  readonly baseNotionalUsd: number;
  readonly enabledSymbols: readonly string[];
}

export const DEFAULT_LOOKBACK_DAYS = 20 as const;
export const DEFAULT_MOMENTUM_THRESHOLD = 0.05 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_SYMBOLS: readonly string[] = ["BTC/USDT", "ETH/USDT"];

export const MIN_LOOKBACK_DAYS = 2 as const;
export const MAX_LOOKBACK_DAYS = 365 as const;
export const MIN_MOMENTUM_THRESHOLD = 0.001 as const;
export const MAX_MOMENTUM_THRESHOLD = 1 as const;
export const MAX_BASE_NOTIONAL_USD = 100_000_000 as const;
export const MOMENTUM_NORMALIZER = 0.1 as const;

interface SymbolPriceState {
  closes: number[];
  lastTimestampMs: number | null;
}

export type OverlayPosition = "long" | "flat";

export interface CrossSymbolMomentumOverlayPluginState {
  readonly symbolState: Map<string, SymbolPriceState>;
  lastMomentum: number | null;
  position: OverlayPosition;
  lastStrength: number;
  barsProcessed: number;
  recordClosesProcessed: number;
  longEmissions: number;
  flatEmissions: number;
  directionSignalsEmitted: number;
  layer2AssertionCount: number;
  leverageClampCount: number;
  malformedCloseDrops: number;
  nonLeadClosesReceived: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && Boolean(value) && !Array.isArray(value);
}

export function computeMomentum(latest: number, lookback: number): number | null {
  if (!Number.isFinite(latest) || !Number.isFinite(lookback)) return null;
  if (latest <= 0 || lookback <= 0) return null;
  return latest / lookback - 1;
}

export function clampStrengthFromMomentum(absMomentum: number): number {
  if (Number.isNaN(absMomentum) || absMomentum <= 0) return 0;
  return Math.min(absMomentum / MOMENTUM_NORMALIZER, 1);
}

export class CrossSymbolMomentumOverlayPlugin implements StrategyPlugin {
  private readonly _busesBySymbol: Map<string, SignalBus> = new Map<string, SignalBus>();
  private _wired = false;
  public readonly metadata: StrategyPluginMetadata = {
    name: "cross-symbol-momentum-overlay-v1",
    version: "1.0.0",
    edgeClass: "directional",
    capitalRequirement: 10_000,
    maxAggregateEffectiveLeverage: DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT.maxAggregateEffectiveLeverage,
    description:
      "BTC-driven " +
      "momentum overlay (default 20d). When BTC momentum > +threshold, " +
      "all enabled symbols go LONG; when < -threshold, all go FLAT. " +
      "Deadzone [-threshold, +threshold] emits no signal. Aggregate effective-exposure " +
      "limit is checked at construction and emission.",
    dependencies: [],
  };

  public readonly config: CrossSymbolMomentumOverlayConfig;
  public readonly state: CrossSymbolMomentumOverlayPluginState;
  /**
   * Per-symbol signal bus subscriptions. Phase 14A wiring: the plugin
   * can emit on multiple buses (one per enabledSymbol) so that each
   * symbol's DecisionEngine sees the lead-symbol's momentum signal.
   *
   * Backward-compat: `subscribe(bus)` wraps the bus under the
   * `enabledSymbols[0]` (lead) key. New code should prefer
   * `subscribeBuses(map)`.
   */
  constructor(overrides: Partial<CrossSymbolMomentumOverlayConfig> = {}) {
    this.config = {
      lookbackDays: overrides.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
      momentumThreshold: overrides.momentumThreshold ?? DEFAULT_MOMENTUM_THRESHOLD,
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      enabledSymbols: overrides.enabledSymbols ?? DEFAULT_ENABLED_SYMBOLS,
    };

    if (
      this.metadata.maxAggregateEffectiveLeverage !==
      DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT.maxAggregateEffectiveLeverage
    ) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] aggregate effective-exposure limit metadata does not match the configured default.`,
      );
    }

    if (
      !Number.isSafeInteger(this.config.lookbackDays) ||
      this.config.lookbackDays < MIN_LOOKBACK_DAYS ||
      this.config.lookbackDays > MAX_LOOKBACK_DAYS
    ) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] lookbackDays=${String(this.config.lookbackDays)} must be an integer in [${String(MIN_LOOKBACK_DAYS)}, ${String(MAX_LOOKBACK_DAYS)}].`,
      );
    }
    if (
      !Number.isFinite(this.config.momentumThreshold) ||
      this.config.momentumThreshold < MIN_MOMENTUM_THRESHOLD ||
      this.config.momentumThreshold > MAX_MOMENTUM_THRESHOLD
    ) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] momentumThreshold=${String(this.config.momentumThreshold)} must be a finite number in [${String(MIN_MOMENTUM_THRESHOLD)}, ${String(MAX_MOMENTUM_THRESHOLD)}].`,
      );
    }
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0 ||
      this.config.baseNotionalUsd > MAX_BASE_NOTIONAL_USD
    ) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] baseNotionalUsd=${String(this.config.baseNotionalUsd)} must be a finite number in (0, ${String(MAX_BASE_NOTIONAL_USD)}].`,
      );
    }
    if (!Array.isArray(this.config.enabledSymbols) || this.config.enabledSymbols.length === 0) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] enabledSymbols must be a non-empty array of non-empty strings.`,
      );
    }
    const seen = new Set<string>();
    for (const [index, s] of this.config.enabledSymbols.entries()) {
      if (typeof s !== "string" || s.length === 0) {
        throw new Error(
          `[CrossSymbolMomentumOverlayPlugin] enabledSymbols[${String(index)}] must be a non-empty string.`,
        );
      }
      if (seen.has(s)) {
        throw new Error(`[CrossSymbolMomentumOverlayPlugin] enabledSymbols contains duplicate "${s}".`);
      }
      seen.add(s);
    }

    this.state = {
      symbolState: new Map<string, SymbolPriceState>(),
      lastMomentum: null,
      position: "flat",
      lastStrength: 0,
      barsProcessed: 0,
      recordClosesProcessed: 0,
      longEmissions: 0,
      flatEmissions: 0,
      directionSignalsEmitted: 0,
      layer2AssertionCount: 0,
      leverageClampCount: 0,
      malformedCloseDrops: 0,
      nonLeadClosesReceived: 0,
    };
  }

  private _buildDirectionSignal(
    symbol: string,
    side: "long" | "short" | "flat",
    strength: number,
    timestampMs: number | undefined,
  ): DirectionSignal {
    const impliedNotional = this.config.baseNotionalUsd * strength;
    let clampedNotional = impliedNotional;
    const maximumNotional =
      this.config.baseNotionalUsd * DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT.maxAggregateEffectiveLeverage;
    if (clampedNotional > maximumNotional) {
      clampedNotional = maximumNotional;
      this.state.leverageClampCount += 1;
    }
    try {
      assertAggregateEffectiveExposureLimit(clampedNotional, this.config.baseNotionalUsd);
      this.state.layer2AssertionCount += 1;
    } catch (error_: unknown) {
      const message = error_ instanceof Error ? error_.message : String(error_);
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] aggregate effective-exposure limit breach: impliedNotional=${String(clampedNotional)}: ${message}`,
        { cause: error_ },
      );
    }

    const tsField = timestampMs === undefined ? {} : { timestampMs };
    const signal: DirectionSignal = {
      kind: "direction",
      side,
      strength,
      source: this.metadata.name,
      symbol,
      ...tsField,
    };
    this.state.directionSignalsEmitted += 1;
    if (this._wired) {
      const bus = this._busesBySymbol.get(symbol);
      if (bus !== undefined) bus.emit(signal);
    }
    return signal;
  }

  private _assertInitialState(): void {
    void this.state.symbolState;
    if (this.config.enabledSymbols.length === 0) {
      throw new Error(`[CrossSymbolMomentumOverlayPlugin] LAYER 2 BREACH: enabledSymbols is empty.`);
    }
    if (!Number.isFinite(this.config.baseNotionalUsd) || this.config.baseNotionalUsd <= 0) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] LAYER 2 BREACH: baseNotionalUsd=${String(this.config.baseNotionalUsd)} invalid.`,
      );
    }
  }

  private _getOrCreateSymbolState(symbol: string): SymbolPriceState {
    const existing = this.state.symbolState.get(symbol);
    if (existing !== undefined) {
      return existing;
    }
    const symbolState: SymbolPriceState = { closes: [], lastTimestampMs: null };
    this.state.symbolState.set(symbol, symbolState);
    return symbolState;
  }

  effectiveMaxNotionalUsd(): number {
    return (
      this.config.baseNotionalUsd * DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT.maxAggregateEffectiveLeverage
    );
  }

  enabledSymbolsList(): readonly string[] {
    return this.config.enabledSymbols;
  }

  lastMomentumValue(): number | null {
    return this.state.lastMomentum;
  }

  currentPosition(): OverlayPosition {
    return this.state.position;
  }

  leadSymbol(): string {
    const leadSymbol = this.config.enabledSymbols.at(0);
    if (leadSymbol === undefined) {
      throw new Error("[CrossSymbolMomentumOverlayPlugin] enabledSymbols must not be empty.");
    }
    return leadSymbol;
  }

  recordClose(symbol: string, close: number, timestampMs?: number): readonly DirectionSignal[] {
    const emitted: DirectionSignal[] = [];
    if (!Number.isFinite(close) || close <= 0) {
      this.state.malformedCloseDrops += 1;
      return emitted;
    }
    this.state.recordClosesProcessed += 1;
    const leadSymbol = this.leadSymbol();
    const symbolState = this._getOrCreateSymbolState(symbol);
    const previousTimestamp = symbolState.lastTimestampMs ?? undefined;
    const effectiveTimestamp = timestampMs ?? (previousTimestamp ?? -1) + 1;
    if (previousTimestamp !== undefined && effectiveTimestamp <= previousTimestamp) return emitted;
    symbolState.lastTimestampMs = effectiveTimestamp;
    symbolState.closes.push(close);
    const maximumObservations = this.config.lookbackDays + 1;
    if (symbolState.closes.length > maximumObservations) {
      symbolState.closes.splice(0, symbolState.closes.length - maximumObservations);
    }
    if (symbol !== leadSymbol) {
      this.state.nonLeadClosesReceived += 1;
      return emitted;
    }
    if (symbolState.closes.length < this.config.lookbackDays + 1) return emitted;
    const oldestIndex = symbolState.closes.length - 1 - this.config.lookbackDays;
    const oldest = symbolState.closes.at(oldestIndex);
    const latest = symbolState.closes.at(-1);
    if (oldest === undefined || latest === undefined) return emitted;
    const rawMomentum = computeMomentum(latest, oldest);
    const momentum = rawMomentum ?? undefined;
    if (momentum === undefined) return emitted;
    this.state.lastMomentum = momentum;
    const strength = clampStrengthFromMomentum(Math.abs(momentum));
    if (Math.abs(momentum) <= this.config.momentumThreshold) return emitted;
    const targetSide: OverlayPosition = momentum > 0 ? "long" : "flat";
    if (this.state.position === targetSide) return emitted;
    this.state.position = targetSide;
    this.state.lastStrength = strength;
    if (targetSide === "long") this.state.longEmissions += 1;
    else this.state.flatEmissions += 1;
    for (const enabledSymbol of this.config.enabledSymbols) {
      emitted.push(this._buildDirectionSignal(enabledSymbol, targetSide, strength, timestampMs));
    }
    return emitted;
  }

  wiredBuses(): ReadonlyMap<string, SignalBus> {
    return new Map(this._busesBySymbol);
  }

  dispose(): void {
    this._busesBySymbol.clear();
    this._wired = false;
  }

  reset(): void {
    this.state.symbolState.clear();
    this.state.lastMomentum = null;
    this.state.position = "flat";
    this.state.lastStrength = 0;
    this.state.barsProcessed = 0;
    this.state.recordClosesProcessed = 0;
    this.state.longEmissions = 0;
    this.state.flatEmissions = 0;
    this.state.directionSignalsEmitted = 0;
    this.state.layer2AssertionCount = 0;
    this.state.leverageClampCount = 0;
    this.state.malformedCloseDrops = 0;
    this.state.nonLeadClosesReceived = 0;
  }

  validateConfig(config: unknown): Result<void, ConfigError> {
    if (config === undefined || (typeof config === "object" && !config)) return ok(undefined);
    const makeError = (field: string, message: string, value?: unknown): Result<void, ConfigError> => ({
      ok: false,
      error: {
        pluginName: this.metadata.name,
        field,
        message,
        ...(value !== undefined && { value }),
      },
    });
    if (!isRecord(config)) return makeError("config", "must be an object or null/undefined", config);
    const c = config;
    if (c["lookbackDays"] !== undefined) {
      const lookbackDays = c["lookbackDays"];
      if (
        typeof lookbackDays !== "number" ||
        !Number.isSafeInteger(lookbackDays) ||
        lookbackDays < MIN_LOOKBACK_DAYS ||
        lookbackDays > MAX_LOOKBACK_DAYS
      ) {
        return makeError(
          "lookbackDays",
          `must be an integer in [${String(MIN_LOOKBACK_DAYS)}, ${String(MAX_LOOKBACK_DAYS)}]`,
          lookbackDays,
        );
      }
    }
    if (c["momentumThreshold"] !== undefined) {
      const momentumThreshold = c["momentumThreshold"];
      if (
        typeof momentumThreshold !== "number" ||
        !Number.isFinite(momentumThreshold) ||
        momentumThreshold < MIN_MOMENTUM_THRESHOLD ||
        momentumThreshold > MAX_MOMENTUM_THRESHOLD
      ) {
        return makeError(
          "momentumThreshold",
          `must be a finite number in [${String(MIN_MOMENTUM_THRESHOLD)}, ${String(MAX_MOMENTUM_THRESHOLD)}]`,
          momentumThreshold,
        );
      }
    }
    if (c["baseNotionalUsd"] !== undefined) {
      const baseNotionalUsd = c["baseNotionalUsd"];
      if (
        typeof baseNotionalUsd !== "number" ||
        !Number.isFinite(baseNotionalUsd) ||
        baseNotionalUsd <= 0 ||
        baseNotionalUsd > MAX_BASE_NOTIONAL_USD
      ) {
        return makeError(
          "baseNotionalUsd",
          `must be a finite number in (0, ${String(MAX_BASE_NOTIONAL_USD)}]`,
          baseNotionalUsd,
        );
      }
    }
    if (c["enabledSymbols"] !== undefined) {
      const enabledSymbols = c["enabledSymbols"];
      if (!Array.isArray(enabledSymbols) || enabledSymbols.length === 0) {
        return makeError("enabledSymbols", "must be a non-empty array of non-empty strings", enabledSymbols);
      }
      const seen = new Set<string>();
      for (const [index, value] of enabledSymbols.entries()) {
        if (typeof value !== "string" || value.length === 0) {
          return makeError("enabledSymbols", `entry ${String(index)} must be a non-empty string`, value);
        }
        if (seen.has(value)) return makeError("enabledSymbols", `duplicate symbol "${value}"`, value);
        seen.add(value);
      }
    }
    return ok(undefined);
  }

  onBar(_bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
  }

  subscribeBuses(busesBySymbol: ReadonlyMap<string, SignalBus>): void {
    this._assertInitialState();
    if (busesBySymbol.size === 0) {
      throw new Error("[CrossSymbolMomentumOverlayPlugin] subscribeBuses requires at least one entry.");
    }
    for (const [symbol, bus] of busesBySymbol) {
      this._busesBySymbol.set(symbol, bus);
    }
    this._wired = true;
  }

  subscribe(bus: SignalBus): void {
    this._assertInitialState();
    this._busesBySymbol.set(this.leadSymbol(), bus);
    this._wired = true;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCrossSymbolMomentumOverlayPlugin(
  overrides: Partial<CrossSymbolMomentumOverlayConfig> = {},
): CrossSymbolMomentumOverlayPlugin {
  return new CrossSymbolMomentumOverlayPlugin(overrides);
}

export { DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT } from "../../risk/leverage-invariant.js";
