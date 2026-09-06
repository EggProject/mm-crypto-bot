import { isSupportedExchangeId, type LatencyStats, type SupportedExchangeId } from "@mm-crypto-bot/exchange";
import {
  canonicalizeExternalDecimal,
  ExactRational,
  type ExactRationalSnapshot,
} from "@mm-crypto-bot/numeric";

import {
  assessExactDeploymentReadiness,
  estimateExactArbLatencyMs,
  summarizeExactOpportunities,
  type ExactDeploymentReadiness,
  type ExactExchangeQuote,
  type ExactOpportunitySummary,
  type ExactSpreadOpportunity,
} from "./arb-latency-exact-calculations.js";
import {
  ArbLatencyArtifactConsistencyError,
  requireExactArtifactConsistency,
} from "./arb-latency-artifact-v2-consistency.js";
import type {
  ExactArbLatencyCollection,
  ExactArbLatencySpreadSample,
} from "./arb-latency-exact-collector.js";
import type { ExactArbLatencyArtifactV2InputSnapshot } from "./arb-latency-artifact-v2-input-snapshot.js";

const MAXIMUM_SAFE_INTEGER_AS_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
// prettier-ignore
export type ArbLatencyArtifactV2ErrorCode = "INCONSISTENT_COLLECTION" | "INCONSISTENT_OPPORTUNITY" | "INCONSISTENT_READINESS" | "INCONSISTENT_SUMMARY" | "INVALID_CONFIG" | "INVALID_DURATION" | "INVALID_LATENCY_STATS" | "INVALID_TIMESTAMP" | "INVALID_VERSION";

export class ArbLatencyArtifactV2Error extends Error {
  public constructor(
    public readonly code: ArbLatencyArtifactV2ErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArbLatencyArtifactV2Error";
  }
}

export interface ArbLatencyArtifactV2NumericSource {
  readonly durationMs: string;
  readonly minSpreadBps: string;
  readonly rttIntervalMs: string;
  readonly tradeNotionalUsd: string;
}

export interface ArbLatencyArtifactV2Input {
  readonly ccxtVersion: string;
  readonly collection: ExactArbLatencyCollection;
  readonly deploymentReadiness: ExactDeploymentReadiness;
  readonly exchangeA: SupportedExchangeId;
  readonly exchangeB: SupportedExchangeId;
  readonly generatedAtUtc: string;
  readonly latencySampleCount: bigint;
  readonly latencyStatsA: LatencyStats;
  readonly latencyStatsB: LatencyStats;
  readonly measureReconnect: boolean;
  readonly numericSource: ArbLatencyArtifactV2NumericSource;
  readonly observedDurationNs: bigint;
  readonly opportunities: readonly ExactSpreadOpportunity[];
  readonly opportunitySummary: ExactOpportunitySummary;
  readonly symbol: string;
}

export type SerializedLatencyStats = Readonly<LatencyStats>;
// prettier-ignore
export interface SerializedQuote { readonly ask: ExactRationalSnapshot; readonly bid: ExactRationalSnapshot; readonly id: string; }
// prettier-ignore
export interface SerializedSample { readonly aSellBBuySpreadBps: ExactRationalSnapshot; readonly bSellABuySpreadBps: ExactRationalSnapshot; readonly exchangeA: SerializedQuote; readonly exchangeB: SerializedQuote; readonly maximumSpreadBps: ExactRationalSnapshot; readonly timestamp: number; }
// prettier-ignore
export interface SerializedOpportunity { readonly crossSpreadBps: ExactRationalSnapshot; readonly exchangeA: SerializedQuote; readonly exchangeB: SerializedQuote; readonly profitableAfterLatency: boolean; readonly theoreticalPnlUsd: ExactRationalSnapshot; readonly timestamp: number; }
// prettier-ignore
export interface ValidatedArtifactInput { readonly collectionObservedDurationNs: string; readonly durationMs: string; readonly latencySampleCount: string; readonly minSpreadBps: ExactRational; readonly rttIntervalMs: string; readonly runnerObservedDurationNs: string; readonly statsA: SerializedLatencyStats; readonly statsB: SerializedLatencyStats; readonly tradeNotionalUsd: ExactRational; }

function fail(code: ArbLatencyArtifactV2ErrorCode, message: string, cause?: unknown): never {
  throw new ArbLatencyArtifactV2Error(code, message, cause);
}

function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function hasEveryCharacter(value: string, isCharacterAccepted: (character: string) => boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!isCharacterAccepted(value.charAt(index))) return false;
  }
  return true;
}

function isCanonicalNonnegativeInteger(value: string): boolean {
  if (value === "0") return true;
  if (value.length === 0 || value.startsWith("0")) return false;
  return hasEveryCharacter(value, (character) => isAsciiDigit(character));
}

function isSemverCharacter(character: string): boolean {
  return (
    isAsciiDigit(character) ||
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    character === "-"
  );
}

function isValidSemverIdentifiers(value: string, isPrerelease: boolean): boolean {
  for (const identifier of value.split(".")) {
    if (
      identifier.length === 0 ||
      !hasEveryCharacter(identifier, (character) => isSemverCharacter(character))
    ) {
      return false;
    }
    const isOnlyDigits = hasEveryCharacter(identifier, (character) => isAsciiDigit(character));
    if (isPrerelease && isOnlyDigits && !isCanonicalNonnegativeInteger(identifier)) return false;
  }
  return true;
}

function isCanonicalVersion(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const buildParts = value.split("+");
  if (
    buildParts.length > 2 ||
    buildParts[0] === undefined ||
    buildParts[0].length === 0 ||
    (buildParts[1] !== undefined && !isValidSemverIdentifiers(buildParts[1], false))
  ) {
    return false;
  }
  const prereleaseParts = buildParts[0].split("-");
  if (
    prereleaseParts.length > 2 ||
    prereleaseParts[0] === undefined ||
    (prereleaseParts[1] !== undefined && !isValidSemverIdentifiers(prereleaseParts[1], true))
  ) {
    return false;
  }
  const core = prereleaseParts[0].split(".");
  return core.length === 3 && core.every((identifier) => isCanonicalNonnegativeInteger(identifier));
}

function snapshot(value: ExactRational): ExactRationalSnapshot {
  if (!(value instanceof ExactRational)) fail("INCONSISTENT_COLLECTION", "Expected exact rational.");
  return Object.freeze({ ...value.toSnapshot() });
}

function isEqualRational(left: ExactRational, right: ExactRational): boolean {
  const leftSnapshot = snapshot(left);
  const rightSnapshot = snapshot(right);
  return (
    leftSnapshot.numerator === rightSnapshot.numerator &&
    leftSnapshot.denominator === rightSnapshot.denominator
  );
}

function canonicalDecimal(source: unknown, isZeroAllowed: boolean): ExactRational {
  try {
    const canonical = canonicalizeExternalDecimal(source);
    if (source !== canonical) fail("INVALID_CONFIG", "Financial source must be canonical.");
    const value = ExactRational.from(canonical);
    if (value.isNegative() || (!isZeroAllowed && value.isZero())) {
      fail("INVALID_CONFIG", "Financial source must be nonnegative or positive as required.");
    }
    return value;
  } catch (error: unknown) {
    if (error instanceof ArbLatencyArtifactV2Error) throw error;
    return fail("INVALID_CONFIG", "Financial source must be canonical.", error);
  }
}

function positiveSafeInteger(source: unknown): string {
  if (
    typeof source !== "string" ||
    source === "0" ||
    !isCanonicalNonnegativeInteger(source) ||
    BigInt(source) > MAXIMUM_SAFE_INTEGER_AS_BIGINT
  ) {
    fail("INVALID_CONFIG", "Duration source must be a positive safe canonical integer.");
  }
  return source;
}

function canonicalDuration(value: unknown, isPositive: boolean): string {
  if (typeof value !== "bigint" || (isPositive ? value <= 0n : value < 0n)) {
    fail("INVALID_DURATION", "Duration or count is invalid.");
  }
  return value.toString();
}

function serializeLatencySampleCount(
  latencySampleCount: unknown,
  statsA: SerializedLatencyStats,
  statsB: SerializedLatencyStats,
): string {
  const serialized = canonicalDuration(latencySampleCount, false);
  const expected =
    BigInt(statsA.rttCount) +
    BigInt(statsA.gapCount) +
    BigInt(statsA.reconnectCount) +
    BigInt(statsB.rttCount) +
    BigInt(statsB.gapCount) +
    BigInt(statsB.reconnectCount);
  if (latencySampleCount !== expected) {
    fail("INCONSISTENT_COLLECTION", "latencySampleCount must equal all collected latency categories.");
  }
  return serialized;
}

function isCanonicalSymbol(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator !== value.lastIndexOf("/")) return false;
  return [value.slice(0, separator), value.slice(separator + 1)].every(
    (part) =>
      part.length > 0 &&
      hasEveryCharacter(
        part,
        (character) => isAsciiDigit(character) || (character >= "A" && character <= "Z"),
      ),
  );
}

function requireConfig(input: ExactArbLatencyArtifactV2InputSnapshot): void {
  if (
    !isSupportedExchangeId(input.exchangeA) ||
    !isSupportedExchangeId(input.exchangeB) ||
    input.exchangeA === input.exchangeB ||
    !isCanonicalSymbol(input.symbol) ||
    typeof input.measureReconnect !== "boolean"
  ) {
    fail("INVALID_CONFIG", "Artifact configuration is invalid.");
  }
  if (!isCanonicalVersion(input.ccxtVersion))
    fail("INVALID_VERSION", "ccxtVersion must be canonical semantic version.");
  if (typeof input.generatedAtUtc !== "string")
    fail("INVALID_TIMESTAMP", "generatedAtUtc must be canonical UTC.");
  const timestamp = new Date(input.generatedAtUtc);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== input.generatedAtUtc) {
    fail("INVALID_TIMESTAMP", "generatedAtUtc must be canonical UTC.");
  }
}

function serializeStats(value: LatencyStats, expected: SupportedExchangeId): SerializedLatencyStats {
  const stats = value;
  if (stats.exchangeId !== expected) fail("INVALID_LATENCY_STATS", "Latency statistics exchange differs.");
  const counts = [stats.rttCount, stats.gapCount, stats.reconnectCount];
  const measures = [
    stats.rttMinMs,
    stats.rttMaxMs,
    stats.rttMedianMs,
    stats.rttP95Ms,
    stats.rttP99Ms,
    stats.gapMinMs,
    stats.gapMaxMs,
    stats.gapMedianMs,
    stats.gapP95Ms,
    stats.gapP99Ms,
    stats.reconnectMinMs,
    stats.reconnectMaxMs,
    stats.reconnectMedianMs,
    stats.reconnectP95Ms,
  ];
  if (
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    measures.some((measure) => !Number.isFinite(measure) || measure < 0) ||
    !Number.isFinite(stats.rttSuccessRate) ||
    stats.rttSuccessRate < 0 ||
    stats.rttSuccessRate > 1
  )
    fail("INVALID_LATENCY_STATS", "Latency statistics must be finite and safe.");
  return Object.freeze({ ...stats });
}

function requireTimestamp(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("INCONSISTENT_COLLECTION", "Sample timestamp is invalid.");
  }
}

function serializeQuote(value: ExactExchangeQuote, expected: SupportedExchangeId): SerializedQuote {
  if (value.id !== expected) fail("INCONSISTENT_COLLECTION", "Quote exchange differs.");
  return Object.freeze({ id: value.id, bid: snapshot(value.bid), ask: snapshot(value.ask) });
}

function requireOpportunities(
  input: ExactArbLatencyArtifactV2InputSnapshot,
  minSpreadBps: ExactRational,
  tradeNotionalUsd: ExactRational,
): void {
  try {
    requireExactArtifactConsistency({
      exchangeA: input.exchangeA,
      exchangeB: input.exchangeB,
      samples: input.collection.samples,
      collectionOpportunities: input.collection.opportunities,
      opportunities: input.opportunities,
      minSpreadBps,
      tradeNotionalUsd,
      latencyMs: estimateExactArbLatencyMs(input.latencyStatsA, input.latencyStatsB),
    });
  } catch (error: unknown) {
    if (error instanceof ArbLatencyArtifactConsistencyError) fail(error.code, error.message, error);
    fail("INCONSISTENT_COLLECTION", "Artifact consistency validation failed.", error);
  }
  const summary = summarizeExactOpportunities(input.opportunities);
  if (
    input.opportunitySummary.totalSamples !== summary.totalSamples ||
    input.opportunitySummary.profitableCount !== summary.profitableCount ||
    !isEqualRational(input.opportunitySummary.profitableRate, summary.profitableRate) ||
    !isEqualRational(input.opportunitySummary.medianSpreadBps, summary.medianSpreadBps) ||
    !isEqualRational(input.opportunitySummary.maxSpreadBps, summary.maxSpreadBps) ||
    !isEqualRational(input.opportunitySummary.totalTheoreticalPnlUsd, summary.totalTheoreticalPnlUsd) ||
    !isEqualRational(
      input.opportunitySummary.averagePnlPerOpportunityUsd,
      summary.averagePnlPerOpportunityUsd,
    )
  )
    fail("INCONSISTENT_SUMMARY", "Summary is not exact.");
  const readiness = assessExactDeploymentReadiness(
    input.latencyStatsA,
    input.latencyStatsB,
    input.opportunitySummary,
    input.observedDurationNs,
  );
  if (
    input.deploymentReadiness.verdict !== readiness.verdict ||
    input.deploymentReadiness.reasoning !== readiness.reasoning ||
    input.deploymentReadiness.arbLatencyMs !== readiness.arbLatencyMs ||
    input.deploymentReadiness.sub100msFeasible !== readiness.sub100msFeasible ||
    !isEqualRational(
      input.deploymentReadiness.profitableOpportunitiesPerHour,
      readiness.profitableOpportunitiesPerHour,
    ) ||
    !isEqualRational(
      input.deploymentReadiness.averagePnlPerOpportunityUsd,
      readiness.averagePnlPerOpportunityUsd,
    ) ||
    !isEqualRational(input.deploymentReadiness.monthlyPnlEstimateUsd, readiness.monthlyPnlEstimateUsd)
  )
    fail("INCONSISTENT_READINESS", "Readiness is not exact.");
}

export function validateArbLatencyArtifactV2Input(
  input: ExactArbLatencyArtifactV2InputSnapshot,
): ValidatedArtifactInput {
  requireConfig(input);
  const runnerObservedDurationNs = canonicalDuration(input.observedDurationNs, true);
  const collectionObservedDurationNs = canonicalDuration(input.collection.observedDurationNs, true);
  if (input.collection.observedDurationNs > input.observedDurationNs) {
    fail("INCONSISTENT_COLLECTION", "Collection duration cannot exceed runner duration.");
  }
  const minSpreadBps = canonicalDecimal(input.numericSource.minSpreadBps, true);
  const tradeNotionalUsd = canonicalDecimal(input.numericSource.tradeNotionalUsd, false);
  const statsA = serializeStats(input.latencyStatsA, input.exchangeA);
  const statsB = serializeStats(input.latencyStatsB, input.exchangeB);
  requireOpportunities(input, minSpreadBps, tradeNotionalUsd);
  return Object.freeze({
    minSpreadBps,
    tradeNotionalUsd,
    durationMs: positiveSafeInteger(input.numericSource.durationMs),
    rttIntervalMs: positiveSafeInteger(input.numericSource.rttIntervalMs),
    runnerObservedDurationNs,
    collectionObservedDurationNs,
    latencySampleCount: serializeLatencySampleCount(input.latencySampleCount, statsA, statsB),
    statsA,
    statsB,
  });
}

export function serializeConfig(
  input: ExactArbLatencyArtifactV2InputSnapshot,
  validated: ValidatedArtifactInput,
) {
  return Object.freeze({
    exchangeA: input.exchangeA,
    exchangeB: input.exchangeB,
    symbol: input.symbol,
    measureReconnect: input.measureReconnect,
    minSpreadBps: snapshot(validated.minSpreadBps),
    tradeNotionalUsd: snapshot(validated.tradeNotionalUsd),
    durationMs: validated.durationMs,
    rttIntervalMs: validated.rttIntervalMs,
  });
}

function serializeSample(
  sample: ExactArbLatencySpreadSample,
  exchangeA: SupportedExchangeId,
  exchangeB: SupportedExchangeId,
): SerializedSample {
  requireTimestamp(sample.timestamp);
  return Object.freeze({
    timestamp: sample.timestamp,
    exchangeA: serializeQuote(sample.exchangeA, exchangeA),
    exchangeB: serializeQuote(sample.exchangeB, exchangeB),
    aSellBBuySpreadBps: snapshot(sample.aSellBBuySpreadBps),
    bSellABuySpreadBps: snapshot(sample.bSellABuySpreadBps),
    maximumSpreadBps: snapshot(sample.maximumSpreadBps),
  });
}

function serializeOpportunity(
  opportunity: ExactSpreadOpportunity,
  exchangeA: SupportedExchangeId,
  exchangeB: SupportedExchangeId,
): SerializedOpportunity {
  requireTimestamp(opportunity.timestamp);
  return Object.freeze({
    timestamp: opportunity.timestamp,
    exchangeA: serializeQuote(opportunity.exchangeA, exchangeA),
    exchangeB: serializeQuote(opportunity.exchangeB, exchangeB),
    crossSpreadBps: snapshot(opportunity.crossSpreadBps),
    profitableAfterLatency: opportunity.profitableAfterLatency,
    theoreticalPnlUsd: snapshot(opportunity.theoreticalPnlUsd),
  });
}

export function serializeCollection(
  input: ExactArbLatencyArtifactV2InputSnapshot,
  validated: ValidatedArtifactInput,
) {
  return Object.freeze({
    observedDurationNs: validated.collectionObservedDurationNs,
    samples: Object.freeze(
      input.collection.samples.map((sample) => serializeSample(sample, input.exchangeA, input.exchangeB)),
    ),
    opportunities: Object.freeze(
      input.opportunities.map((opportunity) =>
        serializeOpportunity(opportunity, input.exchangeA, input.exchangeB),
      ),
    ),
  });
}

export function serializeOpportunitySummary(summary: ExactOpportunitySummary) {
  return Object.freeze({
    totalSamples: summary.totalSamples.toString(),
    profitableCount: summary.profitableCount.toString(),
    profitableRate: snapshot(summary.profitableRate),
    medianSpreadBps: snapshot(summary.medianSpreadBps),
    maxSpreadBps: snapshot(summary.maxSpreadBps),
    totalTheoreticalPnlUsd: snapshot(summary.totalTheoreticalPnlUsd),
    averagePnlPerOpportunityUsd: snapshot(summary.averagePnlPerOpportunityUsd),
  });
}

export function serializeDeploymentReadiness(readiness: ExactDeploymentReadiness) {
  return Object.freeze({
    verdict: readiness.verdict,
    reasoning: readiness.reasoning,
    arbLatencyMs: readiness.arbLatencyMs.toString(),
    sub100msFeasible: readiness.sub100msFeasible,
    profitableOpportunitiesPerHour: snapshot(readiness.profitableOpportunitiesPerHour),
    averagePnlPerOpportunityUsd: snapshot(readiness.averagePnlPerOpportunityUsd),
    monthlyPnlEstimateUsd: snapshot(readiness.monthlyPnlEstimateUsd),
  });
}
