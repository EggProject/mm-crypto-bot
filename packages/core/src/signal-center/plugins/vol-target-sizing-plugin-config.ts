import type { ConfigError, Result } from "../types.js";

export interface VolTargetSizingConfig {
  readonly targetDailyVol: number;
  readonly volWindowDays: number;
  readonly maxVolMultiplier: number;
  readonly minVolMultiplier: number;
  readonly baseNotionalUsd: number;
  readonly enabledSymbols: readonly string[];
}

export const DEFAULT_TARGET_DAILY_VOL = 0.02 as const;
export const DEFAULT_VOL_WINDOW_DAYS = 30 as const;
export const DEFAULT_MAX_VOL_MULTIPLIER = 1 as const;
export const DEFAULT_MIN_VOL_MULTIPLIER = 0.25 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_SYMBOLS: readonly string[] = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];

export const MIN_TARGET_DAILY_VOL = 0.005 as const;
export const MAX_TARGET_DAILY_VOL = 0.05 as const;
export const MIN_VOL_WINDOW_DAYS = 7 as const;
export const MAX_VOL_WINDOW_DAYS = 90 as const;
export const MIN_MIN_VOL_MULTIPLIER = 0.1 as const;
export const MAX_MIN_VOL_MULTIPLIER = 0.5 as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createVolTargetSizingConfig(
  overrides: Partial<VolTargetSizingConfig>,
): VolTargetSizingConfig {
  return {
    targetDailyVol: overrides.targetDailyVol ?? DEFAULT_TARGET_DAILY_VOL,
    volWindowDays: overrides.volWindowDays ?? DEFAULT_VOL_WINDOW_DAYS,
    maxVolMultiplier: overrides.maxVolMultiplier ?? DEFAULT_MAX_VOL_MULTIPLIER,
    minVolMultiplier: overrides.minVolMultiplier ?? DEFAULT_MIN_VOL_MULTIPLIER,
    baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
    enabledSymbols: overrides.enabledSymbols ?? DEFAULT_ENABLED_SYMBOLS,
  };
}

export function assertVolTargetSizingConfig(config: VolTargetSizingConfig): void {
  if (config.maxVolMultiplier > 1) {
    throw new Error(
      `[VolTargetSizingPlugin] maxVolMultiplier=${String(config.maxVolMultiplier)} exceeds 1.0 (the aggregate effective-exposure limit hard cap).`,
    );
  }
  if (config.targetDailyVol < MIN_TARGET_DAILY_VOL || config.targetDailyVol > MAX_TARGET_DAILY_VOL) {
    throw new Error(
      `[VolTargetSizingPlugin] targetDailyVol=${String(config.targetDailyVol)} outside allowed range [${String(MIN_TARGET_DAILY_VOL)}, ${String(MAX_TARGET_DAILY_VOL)}].`,
    );
  }
  if (
    !Number.isSafeInteger(config.volWindowDays) ||
    config.volWindowDays < MIN_VOL_WINDOW_DAYS ||
    config.volWindowDays > MAX_VOL_WINDOW_DAYS
  ) {
    throw new Error(
      `[VolTargetSizingPlugin] volWindowDays=${String(config.volWindowDays)} must be an integer in [${String(MIN_VOL_WINDOW_DAYS)}, ${String(MAX_VOL_WINDOW_DAYS)}].`,
    );
  }
  if (config.baseNotionalUsd <= 0) {
    throw new Error(`[VolTargetSizingPlugin] baseNotionalUsd=${String(config.baseNotionalUsd)} must be > 0.`);
  }
}

export function validateVolTargetSizingConfig(
  pluginName: string,
  config: unknown,
): Result<void, ConfigError> {
  if (config === null || config === undefined) return { ok: true, value: undefined };
  const makeError = (field: string, message: string, value: unknown): Result<void, ConfigError> => ({
    ok: false,
    error: { pluginName, field, message, value },
  });
  if (!isRecord(config)) return makeError("config", "must be an object or null/undefined", config);

  const maxVolMultiplier = config["maxVolMultiplier"];
  if (maxVolMultiplier !== undefined) {
    if (typeof maxVolMultiplier !== "number" || !Number.isFinite(maxVolMultiplier)) {
      return makeError("maxVolMultiplier", "must be a finite number", maxVolMultiplier);
    }
    if (maxVolMultiplier > 1) {
      return makeError(
        "maxVolMultiplier",
        `HARD CAP at 1.0 (aggregate effective-exposure limit); got ${String(maxVolMultiplier)}`,
        maxVolMultiplier,
      );
    }
    if (maxVolMultiplier <= 0) return makeError("maxVolMultiplier", "must be > 0", maxVolMultiplier);
  }

  const targetDailyVol = config["targetDailyVol"];
  if (targetDailyVol !== undefined) {
    if (typeof targetDailyVol !== "number" || !Number.isFinite(targetDailyVol)) {
      return makeError("targetDailyVol", "must be a finite number", targetDailyVol);
    }
    if (targetDailyVol < MIN_TARGET_DAILY_VOL || targetDailyVol > MAX_TARGET_DAILY_VOL) {
      return makeError(
        "targetDailyVol",
        `must be in [${String(MIN_TARGET_DAILY_VOL)}, ${String(MAX_TARGET_DAILY_VOL)}]`,
        targetDailyVol,
      );
    }
  }

  const volWindowDays = config["volWindowDays"];
  if (volWindowDays !== undefined) {
    if (typeof volWindowDays !== "number" || !Number.isFinite(volWindowDays)) {
      return makeError("volWindowDays", "must be a finite number", volWindowDays);
    }
    if (
      volWindowDays < MIN_VOL_WINDOW_DAYS ||
      volWindowDays > MAX_VOL_WINDOW_DAYS ||
      !Number.isSafeInteger(volWindowDays)
    ) {
      return makeError(
        "volWindowDays",
        `must be an integer in [${String(MIN_VOL_WINDOW_DAYS)}, ${String(MAX_VOL_WINDOW_DAYS)}]`,
        volWindowDays,
      );
    }
  }

  const minVolMultiplier = config["minVolMultiplier"];
  if (minVolMultiplier !== undefined) {
    if (typeof minVolMultiplier !== "number" || !Number.isFinite(minVolMultiplier)) {
      return makeError("minVolMultiplier", "must be a finite number", minVolMultiplier);
    }
    if (minVolMultiplier < MIN_MIN_VOL_MULTIPLIER || minVolMultiplier > MAX_MIN_VOL_MULTIPLIER) {
      return makeError(
        "minVolMultiplier",
        `must be in [${String(MIN_MIN_VOL_MULTIPLIER)}, ${String(MAX_MIN_VOL_MULTIPLIER)}]`,
        minVolMultiplier,
      );
    }
  }

  const baseNotionalUsd = config["baseNotionalUsd"];
  if (baseNotionalUsd !== undefined) {
    if (typeof baseNotionalUsd !== "number" || !Number.isFinite(baseNotionalUsd)) {
      return makeError("baseNotionalUsd", "must be a finite number", baseNotionalUsd);
    }
    if (baseNotionalUsd <= 0) return makeError("baseNotionalUsd", "must be > 0", baseNotionalUsd);
  }

  const enabledSymbols = config["enabledSymbols"];
  if (enabledSymbols !== undefined) {
    if (!Array.isArray(enabledSymbols)) {
      return makeError("enabledSymbols", "must be an array of strings", enabledSymbols);
    }
    for (const symbol of enabledSymbols) {
      if (typeof symbol !== "string" || symbol.length === 0) {
        return makeError("enabledSymbols", "each entry must be a non-empty string", symbol);
      }
    }
  }
  return { ok: true, value: undefined };
}
