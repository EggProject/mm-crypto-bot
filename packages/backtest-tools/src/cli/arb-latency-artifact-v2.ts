import type { ExactRationalSnapshot } from "@mm-crypto-bot/numeric";
import {
  ArbLatencyArtifactV2Error,
  serializeCollection,
  serializeConfig,
  serializeDeploymentReadiness,
  serializeOpportunitySummary,
  validateArbLatencyArtifactV2Input,
  type SerializedLatencyStats,
  type SerializedOpportunity,
  type SerializedSample,
} from "./arb-latency-artifact-v2-validation.js";
import {
  snapshotArbLatencyArtifactV2Input,
  type ExactArbLatencyArtifactV2InputSnapshot,
} from "./arb-latency-artifact-v2-input-snapshot.js";

export { ArbLatencyArtifactV2Error } from "./arb-latency-artifact-v2-validation.js";
export type {
  ArbLatencyArtifactV2ErrorCode,
  ArbLatencyArtifactV2Input,
  ArbLatencyArtifactV2NumericSource,
  SerializedLatencyStats,
} from "./arb-latency-artifact-v2-validation.js";

export interface ArbLatencyArtifactV2 {
  readonly schema: "arb-latency-artifact@2";
  readonly metadata: Readonly<{
    readonly generatedAtUtc: string;
    readonly ccxtVersion: string;
    readonly runnerObservedDurationNs: string;
    readonly latencySampleCount: string;
  }>;
  readonly configuration: Readonly<{
    readonly exchangeA: string;
    readonly exchangeB: string;
    readonly symbol: string;
    readonly measureReconnect: boolean;
    readonly minSpreadBps: ExactRationalSnapshot;
    readonly tradeNotionalUsd: ExactRationalSnapshot;
    readonly durationMs: string;
    readonly rttIntervalMs: string;
  }>;
  readonly exchanges: Readonly<{
    readonly exchangeA: SerializedLatencyStats;
    readonly exchangeB: SerializedLatencyStats;
  }>;
  readonly collection: Readonly<{
    readonly observedDurationNs: string;
    readonly samples: readonly SerializedSample[];
    readonly opportunities: readonly SerializedOpportunity[];
  }>;
  readonly opportunitySummary: Readonly<{
    readonly totalSamples: string;
    readonly profitableCount: string;
    readonly profitableRate: ExactRationalSnapshot;
    readonly medianSpreadBps: ExactRationalSnapshot;
    readonly maxSpreadBps: ExactRationalSnapshot;
    readonly totalTheoreticalPnlUsd: ExactRationalSnapshot;
    readonly averagePnlPerOpportunityUsd: ExactRationalSnapshot;
  }>;
  readonly deploymentReadiness: Readonly<{
    readonly verdict: "PASS" | "PARTIAL" | "FAIL";
    readonly reasoning: string;
    readonly arbLatencyMs: string;
    readonly sub100msFeasible: boolean;
    readonly profitableOpportunitiesPerHour: ExactRationalSnapshot;
    readonly averagePnlPerOpportunityUsd: ExactRationalSnapshot;
    readonly monthlyPnlEstimateUsd: ExactRationalSnapshot;
  }>;
}

/**
Builds the complete immutable v2 artifact; output-path policy is intentionally outside this DTO.
*/
export function buildArbLatencyArtifactV2(input: unknown): ArbLatencyArtifactV2 {
  let snapshot: ExactArbLatencyArtifactV2InputSnapshot;
  try {
    snapshot = snapshotArbLatencyArtifactV2Input(input);
  } catch (error: unknown) {
    throw new ArbLatencyArtifactV2Error("INVALID_CONFIG", "Artifact input snapshot is invalid.", error);
  }
  const validated = validateArbLatencyArtifactV2Input(snapshot);
  const collection = serializeCollection(snapshot, validated);
  return Object.freeze({
    schema: "arb-latency-artifact@2",
    metadata: Object.freeze({
      generatedAtUtc: snapshot.generatedAtUtc,
      ccxtVersion: snapshot.ccxtVersion,
      runnerObservedDurationNs: validated.runnerObservedDurationNs,
      latencySampleCount: validated.latencySampleCount,
    }),
    configuration: serializeConfig(snapshot, validated),
    exchanges: Object.freeze({ exchangeA: validated.statsA, exchangeB: validated.statsB }),
    collection,
    opportunitySummary: serializeOpportunitySummary(snapshot.opportunitySummary),
    deploymentReadiness: serializeDeploymentReadiness(snapshot.deploymentReadiness),
  });
}
