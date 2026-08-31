import type { TickDensityState } from "./dydx-cex-carry-config.js";
import { ExactRational } from "@mm-crypto-bot/numeric";
import type { LatencyGate, LatencySnapshot } from "./multi-class-ensemble.js";
import type {
  BybitDepthState,
  DydxCexCarrySnapshot,
  DydxCexCarryState,
  LatencyState,
} from "./dydx-cex-carry.js";

export function nextCompressedDivergenceState(
  previousDay: string | undefined,
  wasCurrentDayCompressed: boolean,
  currentStreak: number,
  day: string,
  isCompressedNow: boolean,
): { readonly day: string; readonly currentDayCompressed: boolean; readonly streak: number } {
  if (previousDay === day)
    return { day, currentDayCompressed: wasCurrentDayCompressed || isCompressedNow, streak: currentStreak };
  if (previousDay === undefined) return { day, currentDayCompressed: isCompressedNow, streak: currentStreak };
  return {
    day,
    currentDayCompressed: isCompressedNow,
    streak: wasCurrentDayCompressed ? currentStreak + 1 : 0,
  };
}

export function restoreSnapshot(snapshot: unknown): DydxCexCarryState {
  const value = record(snapshot, "snapshot");
  rejectKeys(value, [
    "version",
    "fundingCollectedUsd",
    "rebalanceCount",
    "rebalanceCostUsd",
    "fundingPeriods",
    "lastMarkPrice",
    "hasEntered",
    "killSwitchVerdicts",
    "preconditions",
    "tickDensity",
    "compressedDayStreak",
    "firstTickMs",
    "firstChainBlockMs",
    "lastDivergenceDay",
    "currentDayCompressed",
    "latency",
    "bybitDepth",
  ]);
  if (readField(value, "version") !== 1)
    throw new Error("[DydxCexCarryStrategy] snapshot.version must be 1.");
  return {
    fundingCollectedUsd: rational(readField(value, "fundingCollectedUsd"), "snapshot.fundingCollectedUsd"),
    rebalanceCount: natural(readField(value, "rebalanceCount"), "snapshot.rebalanceCount"),
    rebalanceCostUsd: rational(readField(value, "rebalanceCostUsd"), "snapshot.rebalanceCostUsd"),
    fundingPeriods: natural(readField(value, "fundingPeriods"), "snapshot.fundingPeriods"),
    lastMarkPrice: optionalRational(readField(value, "lastMarkPrice"), "snapshot.lastMarkPrice"),
    hasEntered: isBoolean(readField(value, "hasEntered"), "snapshot.hasEntered"),
    killSwitchVerdicts: verdicts(readField(value, "killSwitchVerdicts")),
    preconditions: preconditions(readField(value, "preconditions")),
    tickDensity: density(readField(value, "tickDensity")),
    compressedDayStreak: natural(readField(value, "compressedDayStreak"), "snapshot.compressedDayStreak"),
    firstTickMs: optionalNonnegative(readField(value, "firstTickMs"), "snapshot.firstTickMs"),
    firstChainBlockMs: optionalNonnegative(
      readField(value, "firstChainBlockMs"),
      "snapshot.firstChainBlockMs",
    ),
    lastDivergenceDay: optionalString(readField(value, "lastDivergenceDay"), "snapshot.lastDivergenceDay"),
    currentDayCompressed: isBoolean(
      readField(value, "currentDayCompressed"),
      "snapshot.currentDayCompressed",
    ),
    latency: latency(readField(value, "latency")),
    bybitDepth: bybitDepth(readField(value, "bybitDepth")),
  };
}

export function serializeCarryState(state: DydxCexCarryState): DydxCexCarrySnapshot {
  const safe = frozenStateSnapshot(state);
  return Object.freeze({
    ...safe,
    version: 1,
    fundingCollectedUsd: safe.fundingCollectedUsd.toSnapshot(),
    rebalanceCostUsd: safe.rebalanceCostUsd.toSnapshot(),
    lastMarkPrice: safe.lastMarkPrice?.toSnapshot(),
  });
}

export function frozenStateSnapshot(state: DydxCexCarryState): Readonly<DydxCexCarryState> {
  const verdicts = Object.freeze({
    "indexer-stale": Object.freeze({ ...state.killSwitchVerdicts["indexer-stale"] }),
    "chain-non-finalized": Object.freeze({ ...state.killSwitchVerdicts["chain-non-finalized"] }),
    "divergence-7d-compression": Object.freeze({ ...state.killSwitchVerdicts["divergence-7d-compression"] }),
    "bybit-eu-spot-thin": Object.freeze({ ...state.killSwitchVerdicts["bybit-eu-spot-thin"] }),
  });
  const preconditions = Object.freeze({
    "live-divergence": Object.freeze({ ...state.preconditions["live-divergence"] }),
    "chain-incident-clear": Object.freeze({ ...state.preconditions["chain-incident-clear"] }),
    "no-recent-governance": Object.freeze({ ...state.preconditions["no-recent-governance"] }),
  });
  const tickDensity = Object.freeze({
    days: Object.freeze(state.tickDensity.days.map((entry) => Object.freeze({ ...entry }))),
    totalTicksLast7d: state.tickDensity.totalTicksLast7d,
  });
  return Object.freeze({
    ...state,
    killSwitchVerdicts: verdicts,
    preconditions,
    tickDensity,
    latency: Object.freeze({ ...state.latency }),
    bybitDepth: Object.freeze({ ...state.bybitDepth }),
  });
}

export function validateLatencySnapshot(value: unknown): LatencySnapshot | undefined {
  const snapshot = recordOrUndefined(value);
  if (snapshot === undefined) return undefined;
  const pair = readField(snapshot, "pair");
  const sourceJsonPath = readField(snapshot, "sourceJsonPath");
  const roundTripMsMax = readField(snapshot, "roundTripMsMax");
  if (
    typeof pair !== "string" ||
    typeof sourceJsonPath !== "string" ||
    typeof roundTripMsMax !== "number" ||
    !Number.isFinite(roundTripMsMax) ||
    roundTripMsMax < 0
  )
    return undefined;
  if (pair.length === 0) return undefined;
  return Object.freeze({
    pair,
    sourceJsonPath,
    roundTripMsMax,
  });
}

export function failedLatencyGate(): LatencyGate {
  return Object.freeze({
    snapshot: Object.freeze({
      pair: "invalid-latency",
      sourceJsonPath: "invalid",
      roundTripMsMax: Infinity,
    }),
    arbThresholdMs: -Infinity,
    isCarryAllowed: () => false,
  });
}

function latency(value: unknown): LatencyState {
  const input = record(value, "snapshot.latency");
  const status = readField(input, "status");
  if (status === "unobserved") {
    rejectKeys(input, ["status"]);
    return Object.freeze({ status });
  }
  if (status === "invalid") {
    rejectKeys(input, ["status", "observedAtMs"]);
    return Object.freeze({
      status,
      observedAtMs: nonnegative(readField(input, "observedAtMs"), "snapshot.latency.observedAtMs"),
    });
  }
  if (status === "valid") {
    rejectKeys(input, ["status", "roundTripMs", "observedAtMs"]);
    return Object.freeze({
      status,
      roundTripMs: nonnegative(readField(input, "roundTripMs"), "snapshot.latency.roundTripMs"),
      observedAtMs: nonnegative(readField(input, "observedAtMs"), "snapshot.latency.observedAtMs"),
    });
  }
  throw new Error("[DydxCexCarryStrategy] snapshot.latency.status is unsupported.");
}
function bybitDepth(value: unknown): BybitDepthState {
  const input = record(value, "snapshot.bybitDepth");
  const status = readField(input, "status");
  if (status === "unobserved") {
    rejectKeys(input, ["status"]);
    return Object.freeze({ status });
  }
  if (status === "invalid") {
    rejectKeys(input, ["status", "observedAtMs"]);
    return Object.freeze({
      status,
      observedAtMs: nonnegative(readField(input, "observedAtMs"), "snapshot.bybitDepth.observedAtMs"),
    });
  }
  if (status === "valid") {
    rejectKeys(input, ["status", "depthUsd", "observedAtMs"]);
    return Object.freeze({
      status,
      depthUsd: nonnegative(readField(input, "depthUsd"), "snapshot.bybitDepth.depthUsd"),
      observedAtMs: nonnegative(readField(input, "observedAtMs"), "snapshot.bybitDepth.observedAtMs"),
    });
  }
  throw new Error("[DydxCexCarryStrategy] snapshot.bybitDepth.status is unsupported.");
}

function verdicts(value: unknown): DydxCexCarryState["killSwitchVerdicts"] {
  const verdicts = record(value, "snapshot.killSwitchVerdicts");
  rejectKeys(verdicts, [
    "indexer-stale",
    "chain-non-finalized",
    "divergence-7d-compression",
    "bybit-eu-spot-thin",
  ]);
  return Object.freeze({
    "indexer-stale": verdict(verdicts["indexer-stale"], "indexer-stale"),
    "chain-non-finalized": verdict(verdicts["chain-non-finalized"], "chain-non-finalized"),
    "divergence-7d-compression": verdict(verdicts["divergence-7d-compression"], "divergence-7d-compression"),
    "bybit-eu-spot-thin": verdict(verdicts["bybit-eu-spot-thin"], "bybit-eu-spot-thin"),
  });
}
function verdict(value: unknown, name: string) {
  const entry = record(value, `snapshot.killSwitchVerdicts.${name}`);
  rejectKeys(entry, ["engaged", "reason"]);
  return Object.freeze({
    engaged: isBoolean(readField(entry, "engaged"), `snapshot.killSwitchVerdicts.${name}.engaged`),
    reason: string(readField(entry, "reason"), `snapshot.killSwitchVerdicts.${name}.reason`),
  });
}
function preconditions(value: unknown): DydxCexCarryState["preconditions"] {
  const input = record(value, "snapshot.preconditions");
  rejectKeys(input, ["live-divergence", "chain-incident-clear", "no-recent-governance"]);
  return Object.freeze({
    "live-divergence": precondition(input["live-divergence"], "live-divergence"),
    "chain-incident-clear": precondition(input["chain-incident-clear"], "chain-incident-clear"),
    "no-recent-governance": precondition(input["no-recent-governance"], "no-recent-governance"),
  });
}
function precondition(value: unknown, name: string) {
  const entry = record(value, `snapshot.preconditions.${name}`);
  rejectKeys(entry, ["satisfied", "firstSatisfiedMs", "lastVerifiedMs"]);
  return Object.freeze({
    satisfied: isBoolean(readField(entry, "satisfied"), `snapshot.preconditions.${name}.satisfied`),
    firstSatisfiedMs: optionalNonnegative(
      readField(entry, "firstSatisfiedMs"),
      `snapshot.preconditions.${name}.firstSatisfiedMs`,
    ),
    lastVerifiedMs: optionalNonnegative(
      readField(entry, "lastVerifiedMs"),
      `snapshot.preconditions.${name}.lastVerifiedMs`,
    ),
  });
}
function density(value: unknown): TickDensityState {
  const input = record(value, "snapshot.tickDensity");
  rejectKeys(input, ["days", "totalTicksLast7d"]);
  const days = readField(input, "days");
  if (!Array.isArray(days))
    throw new Error("[DydxCexCarryStrategy] snapshot.tickDensity.days must be an array.");
  return Object.freeze({
    days: Object.freeze(days.map((entry) => densityEntry(entry))),
    totalTicksLast7d: natural(readField(input, "totalTicksLast7d"), "snapshot.tickDensity.totalTicksLast7d"),
  });
}
function densityEntry(value: unknown) {
  const entry = record(value, "snapshot.tickDensity.days entry");
  rejectKeys(entry, ["day", "dydxCount", "cexCount"]);
  return Object.freeze({
    day: string(readField(entry, "day"), "snapshot.tickDensity.days.day"),
    dydxCount: natural(readField(entry, "dydxCount"), "snapshot.tickDensity.days.dydxCount"),
    cexCount: natural(readField(entry, "cexCount"), "snapshot.tickDensity.days.cexCount"),
  });
}
function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`[DydxCexCarryStrategy] ${name} must be an object.`);
  return value;
}
function recordOrUndefined(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readField(record: Readonly<Record<string, unknown>>, key: string): unknown {
  for (const [entryKey, value] of Object.entries(record)) if (entryKey === key) return value;
  return undefined;
}
function rejectKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`[DydxCexCarryStrategy] snapshot has unsupported field: ${key}.`);
}
function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`[DydxCexCarryStrategy] ${name} must be finite.`);
  return value;
}
function rational(value: unknown, name: string): ExactRational {
  try {
    return ExactRational.fromSnapshot(value);
  } catch {
    throw new Error(`[DydxCexCarryStrategy] ${name} must be an exact rational snapshot.`);
  }
}
function optionalRational(value: unknown, name: string): ExactRational | undefined {
  if (value === undefined) return undefined;
  const parsed = rational(value, name);
  if (parsed.isNegative()) throw new Error(`[DydxCexCarryStrategy] ${name} must be non-negative.`);
  return parsed;
}
function nonnegative(value: unknown, name: string): number {
  const number = finite(value, name);
  if (number < 0) throw new Error(`[DydxCexCarryStrategy] ${name} must be non-negative.`);
  return number;
}
function natural(value: unknown, name: string): number {
  const number = nonnegative(value, name);
  if (!Number.isSafeInteger(number)) throw new Error(`[DydxCexCarryStrategy] ${name} must be an integer.`);
  return number;
}
function optionalNonnegative(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : nonnegative(value, name);
}
function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : string(value, name);
}
function isBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`[DydxCexCarryStrategy] ${name} must be boolean.`);
  return value;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`[DydxCexCarryStrategy] ${name} must be string.`);
  return value;
}
