import { describe, expect, it } from "vitest";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  assessExactDeploymentReadiness,
  summarizeExactOpportunities,
  type ExactDeploymentReadiness,
  type ExactExchangeQuote,
  type ExactOpportunitySummary,
  type ExactSpreadOpportunity,
} from "./arb-latency-exact-calculations.js";
import {
  ArbLatencyArtifactV2Error,
  buildArbLatencyArtifactV2,
  type ArbLatencyArtifactV2,
  type ArbLatencyArtifactV2ErrorCode,
} from "./arb-latency-artifact-v2.js";
import {
  EXACT_ZERO,
  fixtureArtifactInput,
  fixtureLatencyStats,
  reflectedValue,
  requireFixtureEntry,
} from "./arb-latency-artifact-v2.test-support.js";

function expectFailure(action: () => unknown, code: ArbLatencyArtifactV2ErrorCode): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArbLatencyArtifactV2Error);
    if (error instanceof ArbLatencyArtifactV2Error) expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected artifact builder to fail with ${code}.`);
}

function expectSnapshot(value: unknown): void {
  expect(value).toEqual(expect.objectContaining({ schema: "exact-rational@1" }));
  expect(value).toEqual(ExactRational.fromSnapshot(value).toSnapshot());
}

function expectFinancialSnapshots(artifact: ArbLatencyArtifactV2): void {
  const sample = requireFixtureEntry(artifact.collection.samples, "artifact sample");
  const opportunity = requireFixtureEntry(artifact.collection.opportunities, "artifact opportunity");
  expectSnapshot(artifact.configuration.minSpreadBps);
  expectSnapshot(artifact.configuration.tradeNotionalUsd);
  expectSnapshot(sample.exchangeA.bid);
  expectSnapshot(sample.exchangeA.ask);
  expectSnapshot(sample.exchangeB.bid);
  expectSnapshot(sample.exchangeB.ask);
  expectSnapshot(sample.aSellBBuySpreadBps);
  expectSnapshot(sample.bSellABuySpreadBps);
  expectSnapshot(sample.maximumSpreadBps);
  expectSnapshot(opportunity.crossSpreadBps);
  expectSnapshot(opportunity.theoreticalPnlUsd);
  expectSnapshot(artifact.opportunitySummary.profitableRate);
  expectSnapshot(artifact.opportunitySummary.medianSpreadBps);
  expectSnapshot(artifact.opportunitySummary.maxSpreadBps);
  expectSnapshot(artifact.opportunitySummary.totalTheoreticalPnlUsd);
  expectSnapshot(artifact.opportunitySummary.averagePnlPerOpportunityUsd);
  expectSnapshot(artifact.deploymentReadiness.profitableOpportunitiesPerHour);
  expectSnapshot(artifact.deploymentReadiness.averagePnlPerOpportunityUsd);
  expectSnapshot(artifact.deploymentReadiness.monthlyPnlEstimateUsd);
}

describe("arb latency artifact v2", () => {
  it("serializes exact fractions, all opportunities, and canonical bigint fields without JSON bigint values", () => {
    const source = fixtureArtifactInput();
    const artifact = buildArbLatencyArtifactV2(
      fixtureArtifactInput({
        collection: Object.freeze({ ...source.collection, observedDurationNs: 500_000_000n }),
      }),
    );
    expect(artifact.schema).toBe("arb-latency-artifact@2");
    expect(artifact.collection.opportunities).toHaveLength(1);
    expect(artifact.collection.opportunities[0]?.crossSpreadBps).toEqual({
      schema: "exact-rational@1",
      numerator: "40000",
      denominator: "47",
    });
    expect(artifact.metadata.runnerObservedDurationNs).toBe("1000000000");
    expect(artifact.collection.observedDurationNs).toBe("500000000");
    expect(artifact.metadata.latencySampleCount).toBe("12");
    expect(artifact.deploymentReadiness.arbLatencyMs).toBe("80");
    expectFinancialSnapshots(artifact);
    const json = JSON.stringify(artifact);
    expect(json).not.toContain("arb-latency-artifact@1");
    expect(JSON.parse(json)).toEqual(artifact);
  });

  it("builds a frozen empty artifact and preserves nonfinancial latency precision", () => {
    const emptySummary: ExactOpportunitySummary = summarizeExactOpportunities([]);
    const latencyStatsA = fixtureLatencyStats("binance", {
      rttCount: 0,
      rttMedianMs: 10.125,
      gapCount: 0,
      reconnectCount: 0,
    });
    const latencyStatsB = fixtureLatencyStats("bybit", {
      rttCount: 0,
      rttMedianMs: 20.875,
      gapCount: 0,
      reconnectCount: 0,
    });
    const readiness: ExactDeploymentReadiness = assessExactDeploymentReadiness(
      latencyStatsA,
      latencyStatsB,
      emptySummary,
      1n,
    );
    const emptySamples = Object.freeze([]);
    const emptyOpportunities = Object.freeze([]);
    const emptyCollection = Object.freeze({
      samples: emptySamples,
      opportunities: emptyOpportunities,
      observedDurationNs: 1n,
    });
    const artifact = buildArbLatencyArtifactV2(
      fixtureArtifactInput({
        latencyStatsA,
        latencyStatsB,
        collection: emptyCollection,
        opportunities: emptyOpportunities,
        opportunitySummary: emptySummary,
        deploymentReadiness: readiness,
        observedDurationNs: 1n,
        latencySampleCount: 0n,
      }),
    );
    expect(artifact.collection.samples).toEqual([]);
    expect(artifact.collection.opportunities).toEqual([]);
    expect(artifact.exchanges.exchangeA.rttMedianMs).toBe(10.125);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.metadata)).toBe(true);
    expect(Object.isFrozen(artifact.collection.samples)).toBe(true);
    expect(Object.isFrozen(artifact.collection.opportunities)).toBe(true);
    expect(Object.isFrozen(artifact.exchanges.exchangeA)).toBe(true);
  });

  it("fails closed for invalid configuration, timestamp, version, duration, count, and statistics", () => {
    expectFailure(
      () =>
        buildArbLatencyArtifactV2(
          fixtureArtifactInput({
            numericSource: Object.freeze({
              minSpreadBps: "-1",
              rttIntervalMs: "500",
              tradeNotionalUsd: "1",
              durationMs: "1",
            }),
          }),
        ),
      "INVALID_CONFIG",
    );
    expectFailure(
      () => buildArbLatencyArtifactV2(fixtureArtifactInput({ generatedAtUtc: "2026-08-24T12:34:56Z" })),
      "INVALID_TIMESTAMP",
    );
    expectFailure(
      () => buildArbLatencyArtifactV2(fixtureArtifactInput({ ccxtVersion: "4.5" })),
      "INVALID_VERSION",
    );
    expectFailure(
      () => buildArbLatencyArtifactV2(fixtureArtifactInput({ observedDurationNs: 0n })),
      "INVALID_DURATION",
    );
    expectFailure(
      () => buildArbLatencyArtifactV2(fixtureArtifactInput({ latencySampleCount: -1n })),
      "INVALID_DURATION",
    );
    expectFailure(
      () =>
        buildArbLatencyArtifactV2(
          fixtureArtifactInput({ latencyStatsA: fixtureLatencyStats("binance", { rttCount: NaN }) }),
        ),
      "INVALID_LATENCY_STATS",
    );
  });

  it("rejects malformed stable ports and nonfinite or inconsistent latency telemetry", () => {
    const invalidExchange = fixtureArtifactInput();
    Reflect.set(invalidExchange, "exchangeA", "invalid");
    expectFailure(() => buildArbLatencyArtifactV2(invalidExchange), "INVALID_CONFIG");
    const invalidReconnect = fixtureArtifactInput();
    Reflect.set(invalidReconnect, "measureReconnect", 1);
    expectFailure(() => buildArbLatencyArtifactV2(invalidReconnect), "INVALID_CONFIG");
    const invalidSource = fixtureArtifactInput();
    const numericSource = { ...invalidSource.numericSource };
    Reflect.set(numericSource, "durationMs", "001");
    expectFailure(() => buildArbLatencyArtifactV2({ ...invalidSource, numericSource }), "INVALID_CONFIG");
    const excessiveSource = fixtureArtifactInput();
    const excessiveNumericSource = { ...excessiveSource.numericSource };
    Reflect.set(excessiveNumericSource, "rttIntervalMs", "9007199254740992");
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...excessiveSource, numericSource: excessiveNumericSource }),
      "INVALID_CONFIG",
    );
    const invalidStats = fixtureArtifactInput();
    Reflect.set(invalidStats.latencyStatsA, "rttSuccessRate", Infinity);
    expectFailure(() => buildArbLatencyArtifactV2(invalidStats), "INVALID_LATENCY_STATS");
    const negativeMeasurement = fixtureArtifactInput();
    Reflect.set(negativeMeasurement.latencyStatsA, "gapMinMs", -1);
    expectFailure(() => buildArbLatencyArtifactV2(negativeMeasurement), "INVALID_LATENCY_STATS");
    const mismatchedStats = fixtureArtifactInput({ latencyStatsA: fixtureLatencyStats("bybit") });
    expectFailure(() => buildArbLatencyArtifactV2(mismatchedStats), "INVALID_LATENCY_STATS");
    const wrongDurationSource = fixtureArtifactInput();
    const wrongDuration = fixtureArtifactInput({
      collection: Object.freeze({ ...wrongDurationSource.collection, observedDurationNs: 2_000_000_000n }),
    });
    expectFailure(() => buildArbLatencyArtifactV2(wrongDuration), "INCONSISTENT_COLLECTION");
    const malformedFinancialSource = fixtureArtifactInput();
    const malformedNumericSource = { ...malformedFinancialSource.numericSource };
    Reflect.set(malformedNumericSource, "minSpreadBps", "not-a-number");
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...malformedFinancialSource, numericSource: malformedNumericSource }),
      "INVALID_CONFIG",
    );
    const zeroNotional = fixtureArtifactInput();
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({
          ...zeroNotional,
          numericSource: Object.freeze({ ...zeroNotional.numericSource, tradeNotionalUsd: "0" }),
        }),
      "INVALID_CONFIG",
    );
  });

  it("rejects inconsistent collection, latency recomputation, summary, and readiness", () => {
    const source = fixtureArtifactInput();
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({
          ...source,
          collection: Object.freeze({ ...source.collection, opportunities: Object.freeze([]) }),
        }),
      "INCONSISTENT_COLLECTION",
    );
    const alteredOpportunity = Object.freeze({
      ...requireFixtureEntry(source.opportunities, "recomputed opportunity"),
      theoreticalPnlUsd: EXACT_ZERO,
      profitableAfterLatency: false,
    });
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...source, opportunities: Object.freeze([alteredOpportunity]) }),
      "INCONSISTENT_OPPORTUNITY",
    );
    const alteredSummary = Object.freeze({ ...source.opportunitySummary, profitableCount: 0n });
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...source, opportunitySummary: alteredSummary }),
      "INCONSISTENT_SUMMARY",
    );
    const alteredReadiness: ExactDeploymentReadiness = Object.freeze({
      ...source.deploymentReadiness,
      reasoning: "tampered",
    });
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...source, deploymentReadiness: alteredReadiness }),
      "INCONSISTENT_READINESS",
    );
  });

  it("rejects invalid sample and provisional opportunity details without converting them", () => {
    const source = fixtureArtifactInput();
    const recomputedOpportunity = requireFixtureEntry(source.opportunities, "recomputed opportunity");
    const provisionalOpportunity = requireFixtureEntry(
      source.collection.opportunities,
      "provisional opportunity",
    );
    const sample = requireFixtureEntry(source.collection.samples, "spread sample");
    const changedOpportunity = Object.freeze({
      ...recomputedOpportunity,
      timestamp: recomputedOpportunity.timestamp + 1,
    });
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...source, opportunities: Object.freeze([changedOpportunity]) }),
      "INCONSISTENT_OPPORTUNITY",
    );
    const provisional = Object.freeze({
      ...provisionalOpportunity,
      theoreticalPnlUsd: ExactRational.from(1n),
    });
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({
          ...source,
          collection: Object.freeze({ ...source.collection, opportunities: Object.freeze([provisional]) }),
        }),
      "INCONSISTENT_OPPORTUNITY",
    );
    const mismatchedQuote: ExactExchangeQuote = Object.freeze({
      ...sample.exchangeA,
      id: "bybit",
    });
    const mismatchedSample = Object.freeze({ ...sample, exchangeA: mismatchedQuote });
    const mismatchedCollected = Object.freeze({
      ...provisionalOpportunity,
      exchangeA: mismatchedQuote,
    });
    const mismatchedRecomputed = Object.freeze({ ...recomputedOpportunity, exchangeA: mismatchedQuote });
    const summary = summarizeExactOpportunities([mismatchedRecomputed]);
    const readiness = assessExactDeploymentReadiness(
      source.latencyStatsA,
      source.latencyStatsB,
      summary,
      source.observedDurationNs,
    );
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({
          ...source,
          collection: Object.freeze({
            ...source.collection,
            samples: Object.freeze([mismatchedSample]),
            opportunities: Object.freeze([mismatchedCollected]),
          }),
          opportunities: Object.freeze([mismatchedRecomputed]),
          opportunitySummary: summary,
          deploymentReadiness: readiness,
        }),
      "INCONSISTENT_COLLECTION",
    );
  });

  it("fails closed when an exact collection field is replaced by an untrusted value", () => {
    const source = fixtureArtifactInput();
    const sample = { ...requireFixtureEntry(source.collection.samples, "spread sample") };
    Reflect.set(sample, "aSellBBuySpreadBps", undefined);
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({
          ...source,
          collection: Object.freeze({ ...source.collection, samples: Object.freeze([sample]) }),
        }),
      "INVALID_CONFIG",
    );
  });

  it("rejects an unsafe exact rational and an unsafe sample timestamp", () => {
    const invalidRational = fixtureArtifactInput();
    const alteredOpportunity = {
      ...requireFixtureEntry(invalidRational.opportunities, "recomputed opportunity"),
    };
    Reflect.set(alteredOpportunity, "crossSpreadBps", undefined);
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({ ...invalidRational, opportunities: Object.freeze([alteredOpportunity]) }),
      "INVALID_CONFIG",
    );
    const source = fixtureArtifactInput();
    const emptySummary = summarizeExactOpportunities([]);
    const emptyReadiness = assessExactDeploymentReadiness(
      source.latencyStatsA,
      source.latencyStatsB,
      emptySummary,
      source.observedDurationNs,
    );
    const unsafeTimestampSample = { ...requireFixtureEntry(source.collection.samples, "spread sample") };
    Reflect.set(unsafeTimestampSample, "timestamp", -1);
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({
          ...source,
          numericSource: Object.freeze({ ...source.numericSource, minSpreadBps: "1000000" }),
          collection: Object.freeze({
            ...source.collection,
            samples: Object.freeze([unsafeTimestampSample]),
            opportunities: Object.freeze([]),
          }),
          opportunities: Object.freeze([]),
          opportunitySummary: emptySummary,
          deploymentReadiness: emptyReadiness,
        }),
      "INVALID_CONFIG",
    );
  });

  it("uses a stable snapshot when collection arrays alter later iteration access", () => {
    const source = fixtureArtifactInput();
    const repeatedOpportunities = new Proxy(source.opportunities, {
      get: (target, property, receiver): unknown => {
        if (property === "entries") {
          return function* entries(): IterableIterator<readonly [number, ExactSpreadOpportunity]> {
            yield [0, requireFixtureEntry(target, "opportunity")];
            throw new Error("untrusted iteration");
          };
        }
        return reflectedValue(target, property, receiver);
      },
    });
    const repeatedProvisional = new Proxy(source.collection.opportunities, {
      get: (target, property, receiver): unknown => {
        if (property === "at") {
          return (): never => {
            throw new Error("untrusted index access");
          };
        }
        return reflectedValue(target, property, receiver);
      },
    });
    const artifact = buildArbLatencyArtifactV2({
      ...source,
      opportunities: repeatedOpportunities,
      collection: Object.freeze({ ...source.collection, opportunities: repeatedProvisional }),
    });
    expect(artifact.collection.opportunities).toHaveLength(1);
    expect(artifact.opportunitySummary.totalSamples).toBe("1");
  });
});
