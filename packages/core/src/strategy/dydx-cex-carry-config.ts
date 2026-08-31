import type { FundingSnapshot } from "./funding-snapshot.js";
import type { KillSwitchConfig } from "./dydx-cex-carry-kill-switches.js";
import { ExactRational } from "@mm-crypto-bot/numeric";

export type CarryMarket = "BTC-USD";
export type CarryDirection = "dydx-long-cex-short";
export type PreconditionId = "live-divergence" | "chain-incident-clear" | "no-recent-governance";
export interface PreconditionConfig {
  readonly liveDivergenceWindowDays: number;
  readonly chainOperationalMinHours: number;
  readonly governanceQuietDays: number;
}
export interface PreconditionEntry {
  readonly satisfied: boolean;
  readonly firstSatisfiedMs: number | undefined;
  readonly lastVerifiedMs: number | undefined;
}
export type PreconditionsState = Readonly<Record<PreconditionId, PreconditionEntry>>;
export interface TickDensityEntry {
  readonly day: string;
  readonly dydxCount: number;
  readonly cexCount: number;
}
export interface TickDensityState {
  readonly days: readonly TickDensityEntry[];
  readonly totalTicksLast7d: number;
}
export interface DydxFundingSource {
  lastTickAgeMs(market: CarryMarket, nowMs: number): number | undefined;
  lastChainBlockHeight(market: CarryMarket): number | undefined;
  lastChainBlockTs(market: CarryMarket): number | undefined;
  bybitEuSpotDepthUsd(market: CarryMarket, nowMs: number): number | undefined;
  subscribe(
    market: CarryMarket,
    onTick: (snapshots: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void,
  ): { readonly close: () => void };
  health(): { readonly lastTickMs: number | undefined; readonly chainBlockHeight: number | undefined };
}
export interface LatencySource {
  observeRoundTripMs(nowMs: number): number | undefined;
  readonly pair: string;
}
export interface DydxCexCarryConfig {
  readonly market: CarryMarket;
  readonly direction: CarryDirection;
  readonly notionalPerLegUsd: ExactRational;
  readonly capFraction: number;
  readonly fundingSource: DydxFundingSource;
  readonly killSwitch: KillSwitchConfig;
  readonly precondition: PreconditionConfig;
  readonly latencyArbThresholdMs: number;
  readonly latencySource: LatencySource | undefined;
}
export const DEFAULT_CARRY_MARKET: CarryMarket = "BTC-USD";
export const DEFAULT_CARRY_DIRECTION: CarryDirection = "dydx-long-cex-short";
export const DEFAULT_PRECONDITION_CONFIG: PreconditionConfig = Object.freeze({
  liveDivergenceWindowDays: 7,
  chainOperationalMinHours: 72,
  governanceQuietDays: 14,
});

type UnknownRecord = Readonly<Record<string, unknown>>;
type UnknownFunction = (...arguments_: readonly unknown[]) => unknown;

export function createDydxCexCarryConfig(
  input: unknown,
  defaults: Omit<DydxCexCarryConfig, "fundingSource">,
): DydxCexCarryConfig {
  const config = requireRecord(input, "config");
  rejectUnexpectedKeys(config, [
    "market",
    "direction",
    "notionalPerLegUsd",
    "capFraction",
    "fundingSource",
    "killSwitch",
    "precondition",
    "latencyArbThresholdMs",
    "latencySource",
  ]);
  const killSwitchOverrides = optionalRecord(readField(config, "killSwitch"), "killSwitch");
  const preconditionOverrides = optionalRecord(readField(config, "precondition"), "precondition");
  return Object.freeze({
    market: validateMarket(valueOrDefault(config, "market", defaults.market)),
    direction: validateDirection(valueOrDefault(config, "direction", defaults.direction)),
    notionalPerLegUsd: requirePositiveExact(
      valueOrDefault(config, "notionalPerLegUsd", defaults.notionalPerLegUsd),
      "notionalPerLegUsd",
    ),
    capFraction: validateCapFraction(valueOrDefault(config, "capFraction", defaults.capFraction)),
    fundingSource: validateFundingSource(readField(config, "fundingSource")),
    killSwitch: validateKillSwitchConfig(mergeRecord(defaults.killSwitch, killSwitchOverrides)),
    precondition: validatePreconditionConfig(mergeRecord(defaults.precondition, preconditionOverrides)),
    latencyArbThresholdMs: validateLatencyThreshold(
      valueOrDefault(config, "latencyArbThresholdMs", defaults.latencyArbThresholdMs),
    ),
    latencySource: validateLatencySource(valueOrDefault(config, "latencySource", defaults.latencySource)),
  });
}
function validateMarket(value: unknown): CarryMarket {
  if (value === "BTC-USD") return value;
  throw new Error(`[DydxCexCarryStrategy] market=${formatUnsupportedMarket(value)} is unsupported.`);
}
function validateDirection(value: unknown): CarryDirection {
  if (value === "dydx-long-cex-short") return value;
  throw new Error("[DydxCexCarryStrategy] direction must be dydx-long-cex-short.");
}
function validateCapFraction(value: unknown): number {
  const n = requirePositiveFinite(value, "capFraction");
  if (n > 0.5)
    throw new Error(`[DydxCexCarryStrategy] capFraction must be in (0, 0.5], got ${String(value)}`);
  return n;
}
function requirePositiveExact(value: unknown, name: string): ExactRational {
  const rational = exactConfigValue(value);
  if (rational.isZero() || rational.isNegative())
    throw new Error(`[DydxCexCarryStrategy] ${name} must be positive.`);
  return rational;
}
function requireNonNegativeExact(value: unknown, name: string): ExactRational {
  const rational = exactConfigValue(value);
  if (rational.isNegative()) throw new Error(`[DydxCexCarryStrategy] ${name} must be non-negative.`);
  return rational;
}
function exactConfigValue(value: unknown): ExactRational {
  if (value instanceof ExactRational) {
    value.toSnapshot();
    return value;
  }
  return ExactRational.from(value);
}
function validateLatencyThreshold(value: unknown): number {
  return requirePositiveFinite(value, "latencyArbThresholdMs");
}
function validateKillSwitchConfig(value: UnknownRecord): KillSwitchConfig {
  rejectUnexpectedKeys(value, [
    "indexerStaleMs",
    "chainNonFinalizedMs",
    "compressionThreshold",
    "bybitEuMinDepthUsd",
    "sparseDataMinTicksPer7d",
  ]);
  return Object.freeze({
    indexerStaleMs: requirePositiveFinite(readField(value, "indexerStaleMs"), "killSwitch.indexerStaleMs"),
    chainNonFinalizedMs: requirePositiveFinite(
      readField(value, "chainNonFinalizedMs"),
      "killSwitch.chainNonFinalizedMs",
    ),
    compressionThreshold: requireNonNegativeExact(
      readField(value, "compressionThreshold"),
      "killSwitch.compressionThreshold",
    ),
    bybitEuMinDepthUsd: requirePositiveFinite(
      readField(value, "bybitEuMinDepthUsd"),
      "killSwitch.bybitEuMinDepthUsd",
    ),
    sparseDataMinTicksPer7d: requirePositiveInteger(
      readField(value, "sparseDataMinTicksPer7d"),
      "killSwitch.sparseDataMinTicksPer7d",
    ),
  });
}
function validatePreconditionConfig(value: UnknownRecord): PreconditionConfig {
  rejectUnexpectedKeys(value, [
    "liveDivergenceWindowDays",
    "chainOperationalMinHours",
    "governanceQuietDays",
  ]);
  return Object.freeze({
    liveDivergenceWindowDays: requirePositiveFinite(
      readField(value, "liveDivergenceWindowDays"),
      "precondition.liveDivergenceWindowDays",
    ),
    chainOperationalMinHours: requirePositiveFinite(
      readField(value, "chainOperationalMinHours"),
      "precondition.chainOperationalMinHours",
    ),
    governanceQuietDays: requirePositiveFinite(
      readField(value, "governanceQuietDays"),
      "precondition.governanceQuietDays",
    ),
  });
}
function validateFundingSource(value: unknown): DydxFundingSource {
  const source = requireRecord(value, "fundingSource");
  const lastTickAgeMs = requireFunction(source, "lastTickAgeMs", "fundingSource");
  const lastChainBlockHeight = requireFunction(source, "lastChainBlockHeight", "fundingSource");
  const lastChainBlockTs = requireFunction(source, "lastChainBlockTs", "fundingSource");
  const bybitEuSpotDepthUsd = requireFunction(source, "bybitEuSpotDepthUsd", "fundingSource");
  const subscribe = requireFunction(source, "subscribe", "fundingSource");
  const health = requireFunction(source, "health", "fundingSource");
  return Object.freeze({
    lastTickAgeMs: (market: CarryMarket, nowMs: number) =>
      finiteResult(lastTickAgeMs.call(source, market, nowMs)),
    lastChainBlockHeight: (market: CarryMarket) => finiteResult(lastChainBlockHeight.call(source, market)),
    lastChainBlockTs: (market: CarryMarket) => finiteResult(lastChainBlockTs.call(source, market)),
    bybitEuSpotDepthUsd: (market: CarryMarket, nowMs: number) =>
      finiteResult(bybitEuSpotDepthUsd.call(source, market, nowMs)),
    subscribe: (
      market: CarryMarket,
      onTick: (snapshots: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void,
    ) => validateSubscription(subscribe.call(source, market, onTick)),
    health: () => validateHealth(health.call(source)),
  });
}
function validateLatencySource(value: unknown): LatencySource | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "object" && Object(value) !== value) return undefined;
  const source = requireRecord(value, "latencySource");
  const pair = readField(source, "pair");
  if (typeof pair !== "string" || pair.length === 0)
    throw new Error("[DydxCexCarryStrategy] latencySource.pair must be a non-empty string.");
  const observeRoundTripMs = requireFunction(source, "observeRoundTripMs", "latencySource");
  return Object.freeze({
    pair,
    observeRoundTripMs: (nowMs: number) => finiteResult(observeRoundTripMs.call(source, nowMs)),
  });
}
function validateSubscription(value: unknown): { readonly close: () => void } {
  const subscription = requireRecord(value, "fundingSource.subscribe result");
  const close = requireFunction(subscription, "close", "fundingSource.subscribe result");
  return Object.freeze({ close: () => void close.call(subscription) });
}
function validateHealth(value: unknown): {
  readonly lastTickMs: number | undefined;
  readonly chainBlockHeight: number | undefined;
} {
  const health = requireRecord(value, "fundingSource.health result");
  return Object.freeze({
    lastTickMs: finiteResult(readField(health, "lastTickMs")),
    chainBlockHeight: finiteResult(readField(health, "chainBlockHeight")),
  });
}
function finiteResult(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function requireRecord(value: unknown, name: string): UnknownRecord {
  if (!isRecord(value)) throw new Error(`[DydxCexCarryStrategy] ${name} must be an object.`);
  return value;
}
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalRecord(value: unknown, name: string): UnknownRecord {
  return value === undefined ? {} : requireRecord(value, name);
}
function requireFunction(record: UnknownRecord, key: string, name: string): UnknownFunction {
  const value = readPrototypeFunction(record, key);
  if (value === undefined) throw new Error(`[DydxCexCarryStrategy] ${name}.${key} must be a function.`);
  return value;
}
function isUnknownFunction(value: unknown): value is UnknownFunction {
  return typeof value === "function";
}
function mergeRecord(defaults: object, overrides: UnknownRecord): UnknownRecord {
  return { ...defaults, ...overrides };
}
function valueOrDefault(record: UnknownRecord, key: string, fallback: unknown): unknown {
  return Object.hasOwn(record, key) ? readField(record, key) : fallback;
}
function readField(record: UnknownRecord, key: string): unknown {
  for (const [entryKey, value] of Object.entries(record)) if (entryKey === key) return value;
  return undefined;
}
function readPrototypeFunction(record: UnknownRecord, key: string): UnknownFunction | undefined {
  let current: object | undefined = record;
  while (current !== undefined) {
    const descriptors = Object.entries(Object.getOwnPropertyDescriptors(current));
    for (const [entryKey, descriptor] of descriptors) {
      if (entryKey === key && isUnknownFunction(descriptor.value)) return descriptor.value;
    }
    const prototype: unknown = Object.getPrototypeOf(current);
    current = prototype instanceof Object ? prototype : undefined;
  }
  return undefined;
}
function rejectUnexpectedKeys(record: UnknownRecord, allowed: readonly string[]): void {
  for (const key of Object.keys(record))
    if (!allowed.includes(key)) throw new Error(`[DydxCexCarryStrategy] unsupported config field: ${key}.`);
}
function requirePositiveFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(`[DydxCexCarryStrategy] ${name} must be positive finite, got ${String(value)}`);
  return value;
}
function requirePositiveInteger(value: unknown, name: string): number {
  const n = requirePositiveFinite(value, name);
  if (!Number.isSafeInteger(n)) throw new Error(`[DydxCexCarryStrategy] ${name} must be an integer.`);
  return n;
}
function formatUnsupportedMarket(market: unknown): string {
  return typeof market === "string" ? market : "non-string";
}
