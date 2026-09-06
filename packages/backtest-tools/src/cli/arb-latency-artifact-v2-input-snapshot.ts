import { isSupportedExchangeId, type LatencyStats, type SupportedExchangeId } from "@mm-crypto-bot/exchange";
import type { ExactRational } from "@mm-crypto-bot/numeric";

import type { ExactDeploymentReadiness, ExactOpportunitySummary } from "./arb-latency-exact-calculations.js";
import type {
  ArbLatencyArtifactV2Input,
  ArbLatencyArtifactV2NumericSource,
} from "./arb-latency-artifact-v2-validation.js";
import {
  snapshotExactArbLatencyMarketSnapshot,
  type ExactArbLatencyMarketSnapshot,
} from "./arb-latency-artifact-v2-market-snapshot.js";
import {
  readClosedArtifactRecord,
  snapshotArtifactExactRational,
} from "./arb-latency-artifact-v2-snapshot-primitives.js";

export type ArbLatencyArtifactV2InputSnapshotErrorCode =
  | "DEPLOYMENT_READINESS_SHAPE"
  | "INPUT_SHAPE"
  | "LATENCY_STATS_SHAPE"
  | "NUMERIC_SOURCE_SHAPE"
  | "OPPORTUNITY_SUMMARY_SHAPE";

export class ArbLatencyArtifactV2InputSnapshotError extends Error {
  public constructor(
    public readonly code: ArbLatencyArtifactV2InputSnapshotErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArbLatencyArtifactV2InputSnapshotError";
  }
}

export type ExactArbLatencyArtifactV2InputSnapshot = Readonly<ArbLatencyArtifactV2Input>;

const INPUT_FIELDS = [
  "ccxtVersion",
  "collection",
  "deploymentReadiness",
  "exchangeA",
  "exchangeB",
  "generatedAtUtc",
  "latencySampleCount",
  "latencyStatsA",
  "latencyStatsB",
  "measureReconnect",
  "numericSource",
  "observedDurationNs",
  "opportunities",
  "opportunitySummary",
  "symbol",
] as const;
const NUMERIC_SOURCE_FIELDS = ["durationMs", "minSpreadBps", "rttIntervalMs", "tradeNotionalUsd"] as const;
const LATENCY_STATS_FIELDS = [
  "exchangeId",
  "rttCount",
  "rttMinMs",
  "rttMaxMs",
  "rttMedianMs",
  "rttP95Ms",
  "rttP99Ms",
  "rttSuccessRate",
  "gapCount",
  "gapMinMs",
  "gapMaxMs",
  "gapMedianMs",
  "gapP95Ms",
  "gapP99Ms",
  "reconnectCount",
  "reconnectMinMs",
  "reconnectMaxMs",
  "reconnectMedianMs",
  "reconnectP95Ms",
] as const;
const OPPORTUNITY_SUMMARY_FIELDS = [
  "totalSamples",
  "profitableCount",
  "profitableRate",
  "medianSpreadBps",
  "maxSpreadBps",
  "totalTheoreticalPnlUsd",
  "averagePnlPerOpportunityUsd",
] as const;
const DEPLOYMENT_READINESS_FIELDS = [
  "verdict",
  "reasoning",
  "arbLatencyMs",
  "sub100msFeasible",
  "profitableOpportunitiesPerHour",
  "averagePnlPerOpportunityUsd",
  "monthlyPnlEstimateUsd",
] as const;

function fail(code: ArbLatencyArtifactV2InputSnapshotErrorCode, message: string, cause?: unknown): never {
  throw new ArbLatencyArtifactV2InputSnapshotError(code, message, cause);
}

function snapshotFailure(
  code: ArbLatencyArtifactV2InputSnapshotErrorCode,
  message: string,
  error: unknown,
): never {
  if (error instanceof ArbLatencyArtifactV2InputSnapshotError) throw error;
  return fail(code, message, error);
}

function requireString(value: unknown, code: ArbLatencyArtifactV2InputSnapshotErrorCode): string {
  if (typeof value !== "string") fail(code, "Artifact string field is invalid.");
  return value;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number") fail("LATENCY_STATS_SHAPE", "Latency statistics field is not a number.");
  return value;
}

function requireBigint(value: unknown, code: ArbLatencyArtifactV2InputSnapshotErrorCode): bigint {
  if (typeof value !== "bigint") fail(code, "Artifact bigint field is invalid.");
  return value;
}

function requireExchangeId(
  value: unknown,
  code: ArbLatencyArtifactV2InputSnapshotErrorCode,
): SupportedExchangeId {
  if (typeof value !== "string" || !isSupportedExchangeId(value)) {
    fail(code, "Artifact exchange identifier is unsupported.");
  }
  return value;
}

function snapshotRational(
  value: unknown,
  label: string,
  code: ArbLatencyArtifactV2InputSnapshotErrorCode,
): ExactRational {
  try {
    return snapshotArtifactExactRational(value, label);
  } catch (error: unknown) {
    return snapshotFailure(code, "Artifact exact value is invalid.", error);
  }
}

function snapshotLatencyStats(input: unknown, label: string): LatencyStats {
  try {
    const stats = readClosedArtifactRecord(input, LATENCY_STATS_FIELDS, label);
    return Object.freeze({
      exchangeId: requireExchangeId(stats["exchangeId"], "LATENCY_STATS_SHAPE"),
      rttCount: requireNumber(stats["rttCount"]),
      rttMinMs: requireNumber(stats["rttMinMs"]),
      rttMaxMs: requireNumber(stats["rttMaxMs"]),
      rttMedianMs: requireNumber(stats["rttMedianMs"]),
      rttP95Ms: requireNumber(stats["rttP95Ms"]),
      rttP99Ms: requireNumber(stats["rttP99Ms"]),
      rttSuccessRate: requireNumber(stats["rttSuccessRate"]),
      gapCount: requireNumber(stats["gapCount"]),
      gapMinMs: requireNumber(stats["gapMinMs"]),
      gapMaxMs: requireNumber(stats["gapMaxMs"]),
      gapMedianMs: requireNumber(stats["gapMedianMs"]),
      gapP95Ms: requireNumber(stats["gapP95Ms"]),
      gapP99Ms: requireNumber(stats["gapP99Ms"]),
      reconnectCount: requireNumber(stats["reconnectCount"]),
      reconnectMinMs: requireNumber(stats["reconnectMinMs"]),
      reconnectMaxMs: requireNumber(stats["reconnectMaxMs"]),
      reconnectMedianMs: requireNumber(stats["reconnectMedianMs"]),
      reconnectP95Ms: requireNumber(stats["reconnectP95Ms"]),
    });
  } catch (error: unknown) {
    return snapshotFailure("LATENCY_STATS_SHAPE", "Artifact latency statistics are invalid.", error);
  }
}

function snapshotNumericSource(input: unknown): ArbLatencyArtifactV2NumericSource {
  try {
    const source = readClosedArtifactRecord(input, NUMERIC_SOURCE_FIELDS, "numericSource");
    return Object.freeze({
      durationMs: requireString(source["durationMs"], "NUMERIC_SOURCE_SHAPE"),
      minSpreadBps: requireString(source["minSpreadBps"], "NUMERIC_SOURCE_SHAPE"),
      rttIntervalMs: requireString(source["rttIntervalMs"], "NUMERIC_SOURCE_SHAPE"),
      tradeNotionalUsd: requireString(source["tradeNotionalUsd"], "NUMERIC_SOURCE_SHAPE"),
    });
  } catch (error: unknown) {
    return snapshotFailure("NUMERIC_SOURCE_SHAPE", "Artifact numeric source is invalid.", error);
  }
}

function snapshotOpportunitySummary(input: unknown): ExactOpportunitySummary {
  try {
    const summary = readClosedArtifactRecord(input, OPPORTUNITY_SUMMARY_FIELDS, "opportunitySummary");
    return Object.freeze({
      totalSamples: requireBigint(summary["totalSamples"], "OPPORTUNITY_SUMMARY_SHAPE"),
      profitableCount: requireBigint(summary["profitableCount"], "OPPORTUNITY_SUMMARY_SHAPE"),
      profitableRate: snapshotRational(
        summary["profitableRate"],
        "opportunitySummary.profitableRate",
        "OPPORTUNITY_SUMMARY_SHAPE",
      ),
      medianSpreadBps: snapshotRational(
        summary["medianSpreadBps"],
        "opportunitySummary.medianSpreadBps",
        "OPPORTUNITY_SUMMARY_SHAPE",
      ),
      maxSpreadBps: snapshotRational(
        summary["maxSpreadBps"],
        "opportunitySummary.maxSpreadBps",
        "OPPORTUNITY_SUMMARY_SHAPE",
      ),
      totalTheoreticalPnlUsd: snapshotRational(
        summary["totalTheoreticalPnlUsd"],
        "opportunitySummary.totalTheoreticalPnlUsd",
        "OPPORTUNITY_SUMMARY_SHAPE",
      ),
      averagePnlPerOpportunityUsd: snapshotRational(
        summary["averagePnlPerOpportunityUsd"],
        "opportunitySummary.averagePnlPerOpportunityUsd",
        "OPPORTUNITY_SUMMARY_SHAPE",
      ),
    });
  } catch (error: unknown) {
    return snapshotFailure("OPPORTUNITY_SUMMARY_SHAPE", "Artifact opportunity summary is invalid.", error);
  }
}

function snapshotDeploymentReadiness(input: unknown): ExactDeploymentReadiness {
  try {
    const readiness = readClosedArtifactRecord(input, DEPLOYMENT_READINESS_FIELDS, "deploymentReadiness");
    const verdict = readiness["verdict"];
    const sub100msFeasible = readiness["sub100msFeasible"];
    if (verdict !== "PASS" && verdict !== "PARTIAL" && verdict !== "FAIL") {
      fail("DEPLOYMENT_READINESS_SHAPE", "Artifact readiness verdict is invalid.");
    }
    if (!isBoolean(sub100msFeasible)) {
      fail("DEPLOYMENT_READINESS_SHAPE", "Artifact boolean field is invalid.");
    }
    return Object.freeze({
      verdict,
      reasoning: requireString(readiness["reasoning"], "DEPLOYMENT_READINESS_SHAPE"),
      arbLatencyMs: requireBigint(readiness["arbLatencyMs"], "DEPLOYMENT_READINESS_SHAPE"),
      sub100msFeasible,
      profitableOpportunitiesPerHour: snapshotRational(
        readiness["profitableOpportunitiesPerHour"],
        "deploymentReadiness.profitableOpportunitiesPerHour",
        "DEPLOYMENT_READINESS_SHAPE",
      ),
      averagePnlPerOpportunityUsd: snapshotRational(
        readiness["averagePnlPerOpportunityUsd"],
        "deploymentReadiness.averagePnlPerOpportunityUsd",
        "DEPLOYMENT_READINESS_SHAPE",
      ),
      monthlyPnlEstimateUsd: snapshotRational(
        readiness["monthlyPnlEstimateUsd"],
        "deploymentReadiness.monthlyPnlEstimateUsd",
        "DEPLOYMENT_READINESS_SHAPE",
      ),
    });
  } catch (error: unknown) {
    return snapshotFailure("DEPLOYMENT_READINESS_SHAPE", "Artifact deployment readiness is invalid.", error);
  }
}

function snapshotMarket(collection: unknown, opportunities: unknown): ExactArbLatencyMarketSnapshot {
  try {
    return snapshotExactArbLatencyMarketSnapshot(collection, opportunities);
  } catch (error: unknown) {
    return snapshotFailure("INPUT_SHAPE", "Artifact market values are invalid.", error);
  }
}

/**
 * Captures an immutable, descriptor-only input boundary before artifact validation.
 */
export function snapshotArbLatencyArtifactV2Input(input: unknown): ExactArbLatencyArtifactV2InputSnapshot {
  try {
    const source = readClosedArtifactRecord(input, INPUT_FIELDS, "artifactInput");
    const market = snapshotMarket(source["collection"], source["opportunities"]);
    const measureReconnect = source["measureReconnect"];
    if (!isBoolean(measureReconnect)) fail("INPUT_SHAPE", "Artifact boolean field is invalid.");
    return Object.freeze({
      ccxtVersion: requireString(source["ccxtVersion"], "INPUT_SHAPE"),
      collection: market.collection,
      deploymentReadiness: snapshotDeploymentReadiness(source["deploymentReadiness"]),
      exchangeA: requireExchangeId(source["exchangeA"], "INPUT_SHAPE"),
      exchangeB: requireExchangeId(source["exchangeB"], "INPUT_SHAPE"),
      generatedAtUtc: requireString(source["generatedAtUtc"], "INPUT_SHAPE"),
      latencySampleCount: requireBigint(source["latencySampleCount"], "INPUT_SHAPE"),
      latencyStatsA: snapshotLatencyStats(source["latencyStatsA"], "latencyStatsA"),
      latencyStatsB: snapshotLatencyStats(source["latencyStatsB"], "latencyStatsB"),
      measureReconnect,
      numericSource: snapshotNumericSource(source["numericSource"]),
      observedDurationNs: requireBigint(source["observedDurationNs"], "INPUT_SHAPE"),
      opportunities: market.opportunities,
      opportunitySummary: snapshotOpportunitySummary(source["opportunitySummary"]),
      symbol: requireString(source["symbol"], "INPUT_SHAPE"),
    });
  } catch (error: unknown) {
    return snapshotFailure("INPUT_SHAPE", "Artifact input is invalid.", error);
  }
}
