import { describe, expect, it } from "vitest";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  ArbLatencyArtifactV2Error,
  buildArbLatencyArtifactV2,
  type ArbLatencyArtifactV2ErrorCode,
} from "./arb-latency-artifact-v2.js";
import {
  assessExactDeploymentReadiness,
  summarizeExactOpportunities,
} from "./arb-latency-exact-calculations.js";
import {
  ArbLatencyArtifactConsistencyError,
  requireExactArtifactConsistency,
} from "./arb-latency-artifact-v2-consistency.js";
import type { ExactArbLatencySpreadSample } from "./arb-latency-exact-collector.js";
import {
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
  throw new Error(`Expected ${code}.`);
}

function artifactWithSample(sample: ExactArbLatencySpreadSample) {
  const source = fixtureArtifactInput();
  return {
    ...source,
    collection: Object.freeze({ ...source.collection, samples: Object.freeze([sample]) }),
  };
}

function zeroLatencyStats(exchangeId: "binance" | "bybit") {
  return fixtureLatencyStats(exchangeId, {
    rttCount: 0,
    rttMinMs: 0,
    rttMaxMs: 0,
    rttMedianMs: 0,
    rttP95Ms: 0,
    rttP99Ms: 0,
    rttSuccessRate: 0,
    gapCount: 0,
    gapMinMs: 0,
    gapMaxMs: 0,
    gapMedianMs: 0,
    gapP95Ms: 0,
    gapP99Ms: 0,
    reconnectCount: 0,
    reconnectMinMs: 0,
    reconnectMaxMs: 0,
    reconnectMedianMs: 0,
    reconnectP95Ms: 0,
  });
}

describe("arb latency artifact v2 exact consistency", () => {
  it("rejects mutated quote identities, quote values, and directional spread derivatives", () => {
    const source = fixtureArtifactInput();
    const sample = requireFixtureEntry(source.collection.samples, "sample");
    const wrongIdSample = Object.freeze({
      ...sample,
      exchangeA: Object.freeze({ ...sample.exchangeA, id: "bybit" }),
    });
    expectFailure(
      () => buildArbLatencyArtifactV2(artifactWithSample(wrongIdSample)),
      "INCONSISTENT_COLLECTION",
    );
    const crossedQuoteSample = Object.freeze({
      ...sample,
      exchangeA: Object.freeze({ ...sample.exchangeA, ask: ExactRational.from(1n) }),
    });
    expectFailure(
      () => buildArbLatencyArtifactV2(artifactWithSample(crossedQuoteSample)),
      "INCONSISTENT_COLLECTION",
    );
    const changedSamples = [
      Object.freeze({ ...sample, aSellBBuySpreadBps: ExactRational.from(0n) }),
      Object.freeze({ ...sample, bSellABuySpreadBps: ExactRational.from(0n) }),
      Object.freeze({ ...sample, maximumSpreadBps: ExactRational.from(0n) }),
    ];
    for (const changedSample of changedSamples) {
      expectFailure(
        () => buildArbLatencyArtifactV2(artifactWithSample(changedSample)),
        "INCONSISTENT_COLLECTION",
      );
    }
  });

  it("rejects provisional and recomputed opportunity quotes that do not exactly match their sample", () => {
    const source = fixtureArtifactInput();
    const opportunity = requireFixtureEntry(source.opportunities, "opportunity");
    const changedOpportunity = Object.freeze({
      ...opportunity,
      exchangeB: Object.freeze({ ...opportunity.exchangeB, bid: ExactRational.from(99n) }),
    });
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...source, opportunities: Object.freeze([changedOpportunity]) }),
      "INCONSISTENT_OPPORTUNITY",
    );
    const provisional = requireFixtureEntry(source.collection.opportunities, "provisional opportunity");
    const changedProvisional = Object.freeze({
      ...provisional,
      exchangeA: Object.freeze({ ...provisional.exchangeA, ask: ExactRational.from(112n) }),
    });
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({
          ...source,
          collection: Object.freeze({
            ...source.collection,
            opportunities: Object.freeze([changedProvisional]),
          }),
        }),
      "INCONSISTENT_OPPORTUNITY",
    );
  });

  it("requires a literal false provisional profitability flag", () => {
    const source = fixtureArtifactInput();
    const provisional = requireFixtureEntry(source.collection.opportunities, "provisional opportunity");
    const nullValue: unknown = JSON.parse("null");
    for (const invalidValue of [0, "", nullValue]) {
      const alteredProvisional = { ...provisional };
      Reflect.set(alteredProvisional, "profitableAfterLatency", invalidValue);
      expectFailure(
        () =>
          buildArbLatencyArtifactV2({
            ...source,
            collection: Object.freeze({
              ...source.collection,
              opportunities: Object.freeze([alteredProvisional]),
            }),
          }),
        "INVALID_CONFIG",
      );
    }
  });

  it("derives latency sample counts and permits a valid all-zero telemetry count", () => {
    const source = fixtureArtifactInput({ latencySampleCount: 0n });
    expectFailure(() => buildArbLatencyArtifactV2(source), "INCONSISTENT_COLLECTION");
    const latencyStatsA = zeroLatencyStats("binance");
    const latencyStatsB = zeroLatencyStats("bybit");
    const summary = summarizeExactOpportunities([]);
    const emptySamples = Object.freeze([]);
    const emptyOpportunities = Object.freeze([]);
    const collection = Object.freeze({
      samples: emptySamples,
      opportunities: emptyOpportunities,
      observedDurationNs: 1n,
    });
    const zeroCountSource = fixtureArtifactInput();
    const numericSource = Object.freeze({ ...zeroCountSource.numericSource, minSpreadBps: "1000000" });
    const zeroCountArtifact = buildArbLatencyArtifactV2(
      fixtureArtifactInput({
        latencyStatsA,
        latencyStatsB,
        collection,
        opportunities: emptyOpportunities,
        opportunitySummary: summary,
        deploymentReadiness: assessExactDeploymentReadiness(latencyStatsA, latencyStatsB, summary, 1n),
        observedDurationNs: 1n,
        latencySampleCount: 0n,
        numericSource,
      }),
    );
    expect(zeroCountArtifact.metadata.latencySampleCount).toBe("0");

    const maximumSafeCount = Number.MAX_SAFE_INTEGER;
    const largeStatsA = fixtureLatencyStats("binance", {
      rttCount: maximumSafeCount,
      gapCount: maximumSafeCount,
      reconnectCount: maximumSafeCount,
    });
    const largeStatsB = fixtureLatencyStats("bybit", {
      rttCount: maximumSafeCount,
      gapCount: maximumSafeCount,
      reconnectCount: maximumSafeCount,
    });
    const exactCount = BigInt(maximumSafeCount) * 6n;
    const roundedNumberCount = BigInt(
      maximumSafeCount +
        maximumSafeCount +
        maximumSafeCount +
        maximumSafeCount +
        maximumSafeCount +
        maximumSafeCount,
    );
    const largeCountInput = fixtureArtifactInput({
      latencyStatsA: largeStatsA,
      latencyStatsB: largeStatsB,
      collection,
      opportunities: emptyOpportunities,
      opportunitySummary: summary,
      deploymentReadiness: assessExactDeploymentReadiness(largeStatsA, largeStatsB, summary, 1n),
      observedDurationNs: 1n,
      latencySampleCount: roundedNumberCount,
      numericSource,
    });
    expectFailure(() => buildArbLatencyArtifactV2(largeCountInput), "INCONSISTENT_COLLECTION");
    const exactCountArtifact = buildArbLatencyArtifactV2({
      ...largeCountInput,
      latencySampleCount: exactCount,
    });
    expect(exactCountArtifact.metadata.latencySampleCount).toBe(exactCount.toString());
  });

  it("rejects direct consistency calls with invalid exact values or absent indexed opportunities", () => {
    const source = fixtureArtifactInput();
    const sample = requireFixtureEntry(source.collection.samples, "sample");
    const invalidSample = { ...sample };
    Reflect.set(invalidSample, "aSellBBuySpreadBps", undefined);
    expect(() => {
      requireExactArtifactConsistency({
        exchangeA: source.exchangeA,
        exchangeB: source.exchangeB,
        samples: Object.freeze([invalidSample]),
        collectionOpportunities: source.collection.opportunities,
        opportunities: source.opportunities,
        minSpreadBps: ExactRational.from(0n),
        tradeNotionalUsd: ExactRational.from("1000.01"),
        latencyMs: 80n,
      });
    }).toThrow(ArbLatencyArtifactConsistencyError);

    const deferredIndex = new Proxy(source.opportunities, {
      get: (target, property, receiver): unknown => {
        if (property === "entries") {
          return function* entries(): IterableIterator<
            readonly [number, (typeof source.opportunities)[number]]
          > {
            const opportunity = requireFixtureEntry(target, "opportunity");
            yield [1, opportunity];
          };
        }
        return reflectedValue(target, property, receiver);
      },
    });
    expect(() => {
      requireExactArtifactConsistency({
        exchangeA: source.exchangeA,
        exchangeB: source.exchangeB,
        samples: source.collection.samples,
        collectionOpportunities: source.collection.opportunities,
        opportunities: deferredIndex,
        minSpreadBps: ExactRational.from(0n),
        tradeNotionalUsd: ExactRational.from("1000.01"),
        latencyMs: 80n,
      });
    }).toThrow(ArbLatencyArtifactConsistencyError);
  });
});
