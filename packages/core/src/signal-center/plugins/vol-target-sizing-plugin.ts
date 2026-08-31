import {
  DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  assertAggregateEffectiveExposureLimit,
} from "../../risk/leverage-invariant.js";
import type { SignalBus } from "../signal-bus.js";
import type { Bar, ConfigError, PluginState, Result, SizingSignal } from "../types.js";
import { isSizing } from "../types.js";
import type { StrategyPlugin } from "../strategy-registry.js";

import {
  assertVolTargetSizingConfig,
  createVolTargetSizingConfig,
  validateVolTargetSizingConfig,
} from "./vol-target-sizing-plugin-config.js";
import type { VolTargetSizingConfig } from "./vol-target-sizing-plugin-config.js";
import {
  clampVolTargetValue,
  createVolTargetSizingPluginState,
  currentVolTargetMultiplier,
  inferVolTargetSymbol,
  recordVolTargetClose,
  resetVolTargetSizingPluginState,
} from "./vol-target-sizing-plugin-volatility.js";
import type { VolTargetSizingPluginState } from "./vol-target-sizing-plugin-volatility.js";

export {
  DEFAULT_BASE_NOTIONAL_USD,
  DEFAULT_ENABLED_SYMBOLS,
  DEFAULT_MAX_VOL_MULTIPLIER,
  DEFAULT_MIN_VOL_MULTIPLIER,
  DEFAULT_TARGET_DAILY_VOL,
  DEFAULT_VOL_WINDOW_DAYS,
  MAX_MIN_VOL_MULTIPLIER,
  MAX_TARGET_DAILY_VOL,
  MAX_VOL_WINDOW_DAYS,
  MIN_MIN_VOL_MULTIPLIER,
  MIN_TARGET_DAILY_VOL,
  MIN_VOL_WINDOW_DAYS,
} from "./vol-target-sizing-plugin-config.js";
export type { VolTargetSizingConfig } from "./vol-target-sizing-plugin-config.js";
export type { VolTargetSizingPluginState } from "./vol-target-sizing-plugin-volatility.js";

export class VolTargetSizingPlugin implements StrategyPlugin {
  private bus: SignalBus | undefined;
  private unsubscribeSizing: (() => void) | undefined;
  private wired = false;

  public readonly metadata = {
    name: "vol-target-sizing-v1",
    version: "1.0.0",
    edgeClass: "sizing" as const,
    capitalRequirement: 0,
    maxAggregateEffectiveLeverage: DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  };

  public readonly config: VolTargetSizingConfig;
  public readonly state: VolTargetSizingPluginState;

  constructor(overrides: Partial<VolTargetSizingConfig> = {}) {
    this.config = createVolTargetSizingConfig(overrides);
    assertVolTargetSizingConfig(this.config);
    this.state = createVolTargetSizingPluginState();
  }

  private onSizingSignal(original: SizingSignal): void {
    if (original.transformedBy?.includes(this.metadata.name) === true) return;
    this.state.signalsReceived += 1;

    const inferredSymbol = inferVolTargetSymbol(original);
    if (inferredSymbol !== null && !this.isSymbolEnabled(inferredSymbol)) {
      this.state.symbolDropCount += 1;
      return;
    }

    try {
      this.assertAggregateEffectiveExposureLimitForTesting(original.notional);
    } catch {
      this.state.breachDrops += 1;
      throw new Error(
        `[VolTargetSizingPlugin] LAYER 2 BREACH: incoming SizingSignal from ${original.source} has notional=${String(original.notional)} > baseNotionalUsd × ${String(DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE)}.`,
      );
    }

    let multiplier = 1;
    if (inferredSymbol !== null) {
      const currentMultiplier = this.currentMultiplierForSymbol(inferredSymbol);
      if (currentMultiplier !== null) multiplier = currentMultiplier;
    }
    multiplier = clampVolTargetValue(multiplier, this.config.minVolMultiplier, this.config.maxVolMultiplier);

    const unboundedVolMultiplier = original.volMultiplier * multiplier;
    const newVolMultiplier = clampVolTargetValue(
      unboundedVolMultiplier,
      this.config.minVolMultiplier,
      this.config.maxVolMultiplier,
    );
    if (newVolMultiplier < unboundedVolMultiplier) this.state.volClampCount += 1;

    let newNotional = original.notional * multiplier;
    const maximumNotional = this.effectiveMaxNotionalUsd();
    if (newNotional > maximumNotional) {
      newNotional = maximumNotional;
      this.state.notionalClampCount += 1;
    }

    const rescaled: SizingSignal = {
      kind: "sizing",
      kellyFraction: original.kellyFraction,
      volMultiplier: newVolMultiplier,
      notional: newNotional,
      source: this.metadata.name,
      ...(original.symbol !== undefined && { symbol: original.symbol }),
      transformedBy: [...(original.transformedBy ?? []), this.metadata.name],
      ...(original.timestampMs !== undefined && { timestampMs: original.timestampMs }),
    };

    try {
      this.assertAggregateEffectiveExposureLimitForTesting(rescaled.notional);
    } catch {
      this.state.breachDrops += 1;
      throw new Error(
        `[VolTargetSizingPlugin] LAYER 3 BREACH: rescaled notional=${String(rescaled.notional)} > baseNotionalUsd × ${String(DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE)}.`,
      );
    }

    if (this.bus !== undefined && this.wired) {
      this.bus.emit(rescaled);
      this.state.signalsEmitted += 1;
    }
  }

  subscribe(bus: SignalBus): void {
    this.bus = bus;
    this.unsubscribeSizing = bus.subscribe("sizing", (signal) => {
      if (!isSizing(signal)) return;
      this.onSizingSignal(signal);
    });
    this.wired = true;
  }

  onBar(bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    void bar;
  }

  recordClose(symbol: string, close: number, timestampMs?: number): void {
    recordVolTargetClose(this.state, this.config, symbol, close, timestampMs);
  }

  validateConfig(config: unknown): Result<void, ConfigError> {
    return validateVolTargetSizingConfig(this.metadata.name, config);
  }

  reset(): void {
    resetVolTargetSizingPluginState(this.state);
  }

  dispose(): void {
    if (this.unsubscribeSizing !== undefined) {
      this.unsubscribeSizing();
      this.unsubscribeSizing = undefined;
    }
    this.bus = undefined;
    this.wired = false;
  }

  isSymbolEnabled(symbol: string): boolean {
    return this.config.enabledSymbols.includes(symbol);
  }

  currentMultiplierForSymbol(symbol: string): number | null {
    return currentVolTargetMultiplier(this.state, this.config, symbol);
  }

  effectiveMaxNotionalUsd(): number {
    return this.config.baseNotionalUsd * DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE;
  }

  assertAggregateEffectiveExposureLimitForTesting(notional: number): void {
    assertAggregateEffectiveExposureLimit(notional, this.config.baseNotionalUsd);
  }
}

export function createVolTargetSizingPlugin(
  overrides: Partial<VolTargetSizingConfig> = {},
): VolTargetSizingPlugin {
  return new VolTargetSizingPlugin(overrides);
}

export function extractSizingSignal(value: unknown): SizingSignal | null {
  return isUnknownSizingSignal(value) ? value : null;
}

function isUnknownSizingSignal(value: unknown): value is SizingSignal {
  return isRecord(value) && value["kind"] === "sizing";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE } from "../../risk/leverage-invariant.js";
