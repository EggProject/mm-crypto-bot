import type { SizingSignal } from "../types.js";

import type { VolTargetSizingConfig } from "./vol-target-sizing-plugin-config.js";

export interface SymbolVolState {
  readonly returns: number[];
  lastClose: number;
  seeded: boolean;
  realizedDailyVol: number | null;
  lastTimestampMs: number | null;
}

export interface VolTargetSizingPluginState {
  symbolState: Map<string, SymbolVolState>;
  signalsReceived: number;
  signalsEmitted: number;
  breachDrops: number;
  symbolDropCount: number;
  barsProcessed: number;
  volClampCount: number;
  notionalClampCount: number;
}

export function createVolTargetSizingPluginState(): VolTargetSizingPluginState {
  return {
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

export function resetVolTargetSizingPluginState(state: VolTargetSizingPluginState): void {
  state.symbolState.clear();
  state.signalsReceived = 0;
  state.signalsEmitted = 0;
  state.breachDrops = 0;
  state.symbolDropCount = 0;
  state.barsProcessed = 0;
  state.volClampCount = 0;
  state.notionalClampCount = 0;
}

export function recordVolTargetClose(
  state: VolTargetSizingPluginState,
  config: VolTargetSizingConfig,
  symbol: string,
  close: number,
  timestampMs?: number,
): void {
  if (!Number.isFinite(close) || close <= 0) return;
  const symbolState = state.symbolState.get(symbol);
  if (symbolState === undefined) {
    state.symbolState.set(symbol, {
      returns: [],
      lastClose: close,
      seeded: true,
      realizedDailyVol: null,
      lastTimestampMs: timestampMs ?? 0,
    });
    return;
  }
  const timestamp = timestampMs ?? (symbolState.lastTimestampMs ?? -1) + 1;
  if (symbolState.lastTimestampMs !== null && timestamp <= symbolState.lastTimestampMs) return;
  symbolState.lastTimestampMs = timestamp;
  if (!symbolState.seeded) {
    symbolState.lastClose = close;
    symbolState.seeded = true;
    return;
  }
  const logReturn = Math.log(close / symbolState.lastClose);
  symbolState.lastClose = close;
  if (!Number.isFinite(logReturn)) return;
  symbolState.returns.push(logReturn);
  if (symbolState.returns.length > config.volWindowDays) {
    symbolState.returns.splice(0, symbolState.returns.length - config.volWindowDays);
  }
  if (symbolState.returns.length >= 2) {
    symbolState.realizedDailyVol = sampleStandardDeviation(symbolState.returns);
  }
}

export function currentVolTargetMultiplier(
  state: VolTargetSizingPluginState,
  config: VolTargetSizingConfig,
  symbol: string,
): number | null {
  const symbolState = state.symbolState.get(symbol);
  if (
    symbolState?.realizedDailyVol === null ||
    symbolState?.realizedDailyVol === undefined ||
    symbolState.realizedDailyVol <= 0
  ) {
    return null;
  }
  return computeVolTargetMultiplier(
    symbolState.realizedDailyVol,
    config.targetDailyVol,
    config.minVolMultiplier,
    config.maxVolMultiplier,
  );
}

export function clampVolTargetValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function inferVolTargetSymbol(signal: SizingSignal): string | null {
  if (signal.symbol !== undefined) return signal.symbol;
  const separatorIndex = signal.source.indexOf(":");
  if (separatorIndex === -1 || separatorIndex === signal.source.length - 1) return null;
  return signal.source.slice(separatorIndex + 1);
}

function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / values.length;
  let squaredDifferenceSum = 0;
  for (const value of values) squaredDifferenceSum += (value - mean) ** 2;
  return Math.sqrt(squaredDifferenceSum / (values.length - 1));
}

function computeVolTargetMultiplier(
  realizedDailyVol: number,
  targetDailyVol: number,
  minVolMultiplier: number,
  maxVolMultiplier: number,
): number {
  if (!Number.isFinite(realizedDailyVol) || realizedDailyVol <= 0) return maxVolMultiplier;
  if (!Number.isFinite(targetDailyVol) || targetDailyVol <= 0) return maxVolMultiplier;
  return clampVolTargetValue(targetDailyVol / realizedDailyVol, minVolMultiplier, maxVolMultiplier);
}
