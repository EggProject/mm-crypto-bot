import { describe, expect, it } from "vitest";

import {
  ArbLatencyArtifactV2Error,
  buildArbLatencyArtifactV2,
  type ArbLatencyArtifactV2ErrorCode,
} from "./arb-latency-artifact-v2.js";
import { ArbLatencyArtifactV2InputSnapshotError } from "./arb-latency-artifact-v2-input-snapshot.js";
import {
  assessExactDeploymentReadiness,
  summarizeExactOpportunities,
} from "./arb-latency-exact-calculations.js";
import {
  serializeCollection,
  serializeConfig,
  serializeDeploymentReadiness,
  serializeOpportunitySummary,
  validateArbLatencyArtifactV2Input,
} from "./arb-latency-artifact-v2-validation.js";
import {
  fixtureArtifactInput,
  fixtureLatencyStats,
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

function expectSnapshotBoundaryFailure(action: () => unknown): ArbLatencyArtifactV2Error {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArbLatencyArtifactV2Error);
    if (error instanceof ArbLatencyArtifactV2Error) {
      expect(error.cause).toBeInstanceOf(ArbLatencyArtifactV2InputSnapshotError);
      return error;
    }
  }
  throw new Error("Expected artifact input snapshot failure.");
}

function inputWithVersion(ccxtVersion: string) {
  return fixtureArtifactInput({ ccxtVersion });
}

describe("arb latency artifact v2 validation exports", () => {
  it("accepts canonical SemVer prerelease and build identifiers", () => {
    const input = inputWithVersion("4.5.75-rc.1+bybit-2026");
    const validated = validateArbLatencyArtifactV2Input(input);
    expect(validated.runnerObservedDurationNs).toBe("1000000000");
    expect(serializeConfig(input, validated).durationMs).toBe("30000");
    expect(serializeCollection(input, validated).samples).toHaveLength(1);
    expect(serializeOpportunitySummary(input.opportunitySummary).totalSamples).toBe("1");
    expect(serializeDeploymentReadiness(input.deploymentReadiness).verdict).toBe("PASS");
    expect(buildArbLatencyArtifactV2(inputWithVersion("4.5.75-alpha-beta")).metadata.ccxtVersion).toBe(
      "4.5.75-alpha-beta",
    );
    expect(buildArbLatencyArtifactV2(inputWithVersion("4.5.75-x-y-z.--")).metadata.ccxtVersion).toBe(
      "4.5.75-x-y-z.--",
    );
    expect(buildArbLatencyArtifactV2(inputWithVersion("0.0.0+---")).metadata.ccxtVersion).toBe("0.0.0+---");
    expect(buildArbLatencyArtifactV2(inputWithVersion("4.5.75+A")).metadata.ccxtVersion).toBe("4.5.75+A");
  });

  it("rejects noncanonical SemVer forms and invalid exact configuration ports", () => {
    for (const version of ["4.5.75+", "4.5.75-alpha.", "4.5.75-01", "4.5.75+a!"]) {
      expectFailure(() => buildArbLatencyArtifactV2(inputWithVersion(version)), "INVALID_VERSION");
    }
    const invalidSymbol = fixtureArtifactInput({ symbol: "btc/USDT" });
    expectFailure(() => buildArbLatencyArtifactV2(invalidSymbol), "INVALID_CONFIG");
    const paddedDecimal = fixtureArtifactInput({
      numericSource: Object.freeze({
        ...fixtureArtifactInput().numericSource,
        minSpreadBps: "0.0",
      }),
    });
    expectFailure(() => buildArbLatencyArtifactV2(paddedDecimal), "INVALID_CONFIG");
    const invalidGeneratedAt = fixtureArtifactInput();
    Reflect.set(invalidGeneratedAt, "generatedAtUtc", 1);
    expectFailure(() => buildArbLatencyArtifactV2(invalidGeneratedAt), "INVALID_CONFIG");
    const invalidVersionPort = fixtureArtifactInput();
    Reflect.set(invalidVersionPort, "ccxtVersion", 1);
    expectFailure(() => buildArbLatencyArtifactV2(invalidVersionPort), "INVALID_CONFIG");
    const invalidSymbolPort = fixtureArtifactInput();
    Reflect.set(invalidSymbolPort, "symbol", 1);
    expectFailure(() => buildArbLatencyArtifactV2(invalidSymbolPort), "INVALID_CONFIG");
    expectFailure(() => buildArbLatencyArtifactV2(fixtureArtifactInput({ symbol: "BTC" })), "INVALID_CONFIG");
  });

  it("rejects invalid sample max spread, sample timestamp, and quote values at serialization", () => {
    const source = fixtureArtifactInput();
    const sample = { ...requireFixtureEntry(source.collection.samples, "sample") };
    Reflect.set(sample, "maximumSpreadBps", undefined);
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({
          ...source,
          collection: Object.freeze({ ...source.collection, samples: Object.freeze([sample]) }),
        }),
      "INVALID_CONFIG",
    );

    const emptySummary = summarizeExactOpportunities([]);
    const sourceWithNoOpportunities = fixtureArtifactInput({
      numericSource: Object.freeze({ ...fixtureArtifactInput().numericSource, minSpreadBps: "1000000" }),
      opportunities: Object.freeze([]),
      collection: Object.freeze({
        ...fixtureArtifactInput().collection,
        opportunities: Object.freeze([]),
      }),
      opportunitySummary: emptySummary,
      deploymentReadiness: assessExactDeploymentReadiness(
        fixtureArtifactInput().latencyStatsA,
        fixtureArtifactInput().latencyStatsB,
        emptySummary,
        1_000_000_000n,
      ),
    });
    const alteredSample = { ...requireFixtureEntry(sourceWithNoOpportunities.collection.samples, "sample") };
    Reflect.set(alteredSample, "timestamp", "not-a-timestamp");
    expectFailure(
      () =>
        buildArbLatencyArtifactV2({
          ...sourceWithNoOpportunities,
          collection: Object.freeze({
            ...sourceWithNoOpportunities.collection,
            samples: Object.freeze([alteredSample]),
          }),
        }),
      "INVALID_CONFIG",
    );
  });

  it("serializes an independently validated empty collection as immutable exact DTOs", () => {
    const source = fixtureArtifactInput();
    const emptySummary = summarizeExactOpportunities([]);
    const latencyStatsA = fixtureLatencyStats("binance", {
      rttCount: 0,
      gapCount: 0,
      reconnectCount: 0,
    });
    const latencyStatsB = fixtureLatencyStats("bybit", {
      rttCount: 0,
      gapCount: 0,
      reconnectCount: 0,
    });
    const empty = fixtureArtifactInput({
      numericSource: Object.freeze({ ...source.numericSource, minSpreadBps: "1000000" }),
      collection: Object.freeze({
        samples: Object.freeze([]),
        opportunities: Object.freeze([]),
        observedDurationNs: 1n,
      }),
      opportunities: Object.freeze([]),
      opportunitySummary: emptySummary,
      observedDurationNs: 1n,
      latencySampleCount: 0n,
      latencyStatsA,
      latencyStatsB,
      deploymentReadiness: assessExactDeploymentReadiness(latencyStatsA, latencyStatsB, emptySummary, 1n),
    });
    const validated = validateArbLatencyArtifactV2Input(empty);
    const collection = serializeCollection(empty, validated);
    expect(collection).toEqual({ observedDurationNs: "1", samples: [], opportunities: [] });
    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.samples)).toBe(true);
    expect(Object.isFrozen(collection.opportunities)).toBe(true);
  });

  it("rejects non-schema, symbol, and accessor latency-stat properties without serializing them", () => {
    const source = fixtureArtifactInput();
    for (const fieldName of ["apiKey", "toJSON"]) {
      const stats = { ...source.latencyStatsA };
      Object.defineProperty(stats, fieldName, { enumerable: true, value: "secret" });
      expectFailure(() => buildArbLatencyArtifactV2({ ...source, latencyStatsA: stats }), "INVALID_CONFIG");
    }
    const symbolStats = { ...source.latencyStatsA };
    Object.defineProperty(symbolStats, Symbol("opaque"), { enumerable: true, value: "secret" });
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...source, latencyStatsA: symbolStats }),
      "INVALID_CONFIG",
    );
    let wasGetterRead = false;
    const accessorStats = { ...source.latencyStatsA };
    Object.defineProperty(accessorStats, "rttCount", {
      enumerable: true,
      get: (): number => {
        wasGetterRead = true;
        return 3;
      },
    });
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...source, latencyStatsA: accessorStats }),
      "INVALID_CONFIG",
    );
    expect(wasGetterRead).toBe(false);
    const unreadableStats = new Proxy(
      { ...source.latencyStatsA },
      {
        ownKeys: (): ArrayLike<string | symbol> => {
          throw new Error("descriptor read blocked");
        },
      },
    );
    expectFailure(
      () => buildArbLatencyArtifactV2({ ...source, latencyStatsA: unreadableStats }),
      "INVALID_CONFIG",
    );
  });

  it("copies every allowlisted latency-stat field into a frozen DTO", () => {
    const artifact = buildArbLatencyArtifactV2(fixtureArtifactInput());
    expect(artifact.exchanges.exchangeA).toEqual(fixtureArtifactInput().latencyStatsA);
    expect(Object.isFrozen(artifact.exchanges.exchangeA)).toBe(true);
    expect(Object.hasOwn(artifact.exchanges.exchangeA, "toJSON")).toBe(false);
  });

  it("maps an unexpected directional-calculation failure to the artifact boundary", () => {
    const source = fixtureArtifactInput();
    Reflect.set(source.latencyStatsA, "rttP95Ms", 1.5);
    expectFailure(() => buildArbLatencyArtifactV2(source), "INCONSISTENT_COLLECTION");
  });

  it("defends its serialization boundary after prior validation", () => {
    const source = fixtureArtifactInput();
    const validated = validateArbLatencyArtifactV2Input(source);
    const sample = { ...requireFixtureEntry(source.collection.samples, "sample") };
    Reflect.set(sample, "aSellBBuySpreadBps", undefined);
    expectFailure(
      () =>
        serializeCollection(
          {
            ...source,
            collection: Object.freeze({ ...source.collection, samples: Object.freeze([sample]) }),
          },
          validated,
        ),
      "INCONSISTENT_COLLECTION",
    );
    const sampleWithWrongId = {
      ...requireFixtureEntry(source.collection.samples, "sample"),
      exchangeA: { ...requireFixtureEntry(source.collection.samples, "sample").exchangeA },
    };
    Reflect.set(sampleWithWrongId.exchangeA, "id", "bybit");
    expectFailure(
      () =>
        serializeCollection(
          {
            ...source,
            collection: Object.freeze({ ...source.collection, samples: Object.freeze([sampleWithWrongId]) }),
          },
          validated,
        ),
      "INCONSISTENT_COLLECTION",
    );
  });

  it("rejects malformed direct snapshot-shaped timestamps before serialization", () => {
    const wrongGeneratedAt = fixtureArtifactInput();
    Reflect.set(wrongGeneratedAt, "generatedAtUtc", 1);
    expectFailure(() => validateArbLatencyArtifactV2Input(wrongGeneratedAt), "INVALID_TIMESTAMP");
    const wrongVersion = fixtureArtifactInput();
    Reflect.set(wrongVersion, "ccxtVersion", 1);
    expectFailure(() => validateArbLatencyArtifactV2Input(wrongVersion), "INVALID_VERSION");
    const wrongSymbol = fixtureArtifactInput();
    Reflect.set(wrongSymbol, "symbol", 1);
    expectFailure(() => validateArbLatencyArtifactV2Input(wrongSymbol), "INVALID_CONFIG");

    const source = fixtureArtifactInput();
    const summary = summarizeExactOpportunities([]);
    const invalidSample = { ...requireFixtureEntry(source.collection.samples, "sample"), timestamp: -1 };
    const noOpportunities = Object.freeze([]);
    const invalidTimestamp = fixtureArtifactInput({
      numericSource: Object.freeze({ ...source.numericSource, minSpreadBps: "1000000" }),
      collection: Object.freeze({
        ...source.collection,
        samples: Object.freeze([invalidSample]),
        opportunities: noOpportunities,
      }),
      opportunities: noOpportunities,
      opportunitySummary: summary,
      deploymentReadiness: assessExactDeploymentReadiness(
        source.latencyStatsA,
        source.latencyStatsB,
        summary,
        source.observedDurationNs,
      ),
    });
    const validated = validateArbLatencyArtifactV2Input(invalidTimestamp);
    expectFailure(() => serializeCollection(invalidTimestamp, validated), "INCONSISTENT_COLLECTION");
  });

  it("captures the top-level descriptor boundary exactly once", () => {
    const source = fixtureArtifactInput();
    let ownKeyReads = 0;
    let descriptorReads = 0;
    const observedInput = new Proxy(source, {
      ownKeys: (target) => {
        ownKeyReads += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor: (target, property) => {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    const artifact = buildArbLatencyArtifactV2(observedInput);

    expect(ownKeyReads).toBe(1);
    expect(descriptorReads).toBe(Reflect.ownKeys(source).length);
    expect(artifact.configuration.symbol).toBe("BTC/USDT");
  });

  it("rejects accessors and non-schema keys before invoking or serializing them", () => {
    const source = fixtureArtifactInput();
    const topLevelGetter = { ...source };
    let topLevelGetterReads = 0;
    Object.defineProperty(topLevelGetter, "symbol", {
      configurable: true,
      enumerable: true,
      get: (): string => {
        topLevelGetterReads += 1;
        return topLevelGetterReads === 1 ? "BTC/USDT" : "ETH/USDT";
      },
    });
    const getterFailure = expectSnapshotBoundaryFailure(() => buildArbLatencyArtifactV2(topLevelGetter));
    expect(topLevelGetterReads).toBe(0);
    expect(getterFailure.message).not.toContain("BTC/USDT");

    const numericAccessor = { ...source.numericSource };
    let numericGetterReads = 0;
    Object.defineProperty(numericAccessor, "durationMs", {
      configurable: true,
      enumerable: true,
      get: (): string => {
        numericGetterReads += 1;
        return "30000";
      },
    });
    expectSnapshotBoundaryFailure(() =>
      buildArbLatencyArtifactV2({ ...source, numericSource: numericAccessor }),
    );
    expect(numericGetterReads).toBe(0);

    for (const key of ["toJSON", "secret"] as const) {
      const hostile = { ...source };
      Object.defineProperty(hostile, key, {
        configurable: true,
        enumerable: true,
        value:
          key === "toJSON"
            ? (): never => {
                throw new Error("secret hook");
              }
            : "secret-value",
      });
      const failure = expectSnapshotBoundaryFailure(() => buildArbLatencyArtifactV2(hostile));
      expect(failure.message).not.toContain("secret");
    }
    const symbolHostile = { ...source };
    Object.defineProperty(symbolHostile, Symbol("secret"), { enumerable: true, value: "secret-value" });
    expectSnapshotBoundaryFailure(() => buildArbLatencyArtifactV2(symbolHostile));
  });

  it("retains first captured safe values when proxies mutate samples or opportunities", () => {
    const source = fixtureArtifactInput();
    const originalSample = requireFixtureEntry(source.collection.samples, "sample");
    const mutableSample = { ...originalSample };
    const alteredSample = Object.freeze({ ...originalSample, timestamp: 0 });
    const observedSample = new Proxy(mutableSample, {
      getOwnPropertyDescriptor: (target, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === "maximumSpreadBps") Reflect.set(target, "timestamp", alteredSample.timestamp);
        return descriptor;
      },
    });
    const originalOpportunity = requireFixtureEntry(source.opportunities, "opportunity");
    const alteredOpportunity = Object.freeze({ ...originalOpportunity, timestamp: 0 });
    const observedOpportunities = new Proxy([...source.opportunities], {
      getOwnPropertyDescriptor: (target, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === "0") Reflect.set(target, 0, alteredOpportunity);
        return descriptor;
      },
    });
    const artifact = buildArbLatencyArtifactV2({
      ...source,
      collection: Object.freeze({ ...source.collection, samples: Object.freeze([observedSample]) }),
      opportunities: observedOpportunities,
    });

    expect(requireFixtureEntry(artifact.collection.samples, "serialized sample").timestamp).toBe(
      originalSample.timestamp,
    );
    expect(requireFixtureEntry(artifact.collection.opportunities, "serialized opportunity").timestamp).toBe(
      originalOpportunity.timestamp,
    );
  });
});
