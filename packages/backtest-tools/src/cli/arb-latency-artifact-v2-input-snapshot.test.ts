import { describe, expect, it } from "vitest";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  ArbLatencyArtifactV2InputSnapshotError,
  snapshotArbLatencyArtifactV2Input,
  type ArbLatencyArtifactV2InputSnapshotErrorCode,
} from "./arb-latency-artifact-v2-input-snapshot.js";
import type { ArbLatencyArtifactV2Input } from "./arb-latency-artifact-v2-validation.js";
import { fixtureArtifactInput } from "./arb-latency-artifact-v2.test-support.js";

function expectFailure(
  action: () => unknown,
  code: ArbLatencyArtifactV2InputSnapshotErrorCode,
): ArbLatencyArtifactV2InputSnapshotError {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArbLatencyArtifactV2InputSnapshotError);
    if (error instanceof ArbLatencyArtifactV2InputSnapshotError) {
      expect(error.code).toBe(code);
      return error;
    }
  }
  throw new TypeError(`Expected input snapshot error ${code}.`);
}

function sourceInput(): ArbLatencyArtifactV2Input {
  const input = fixtureArtifactInput();
  return {
    ...input,
    numericSource: { ...input.numericSource },
    latencyStatsA: { ...input.latencyStatsA },
    latencyStatsB: { ...input.latencyStatsB },
    opportunitySummary: { ...input.opportunitySummary },
    deploymentReadiness: { ...input.deploymentReadiness },
  };
}

function replaceOwnValue(target: object, property: string, value: unknown): void {
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function removeOwnValue(target: object, property: string): void {
  if (!Reflect.deleteProperty(target, property)) {
    throw new TypeError(`Unable to remove ${property}.`);
  }
}

function expectFrozenSnapshot(snapshot: ReturnType<typeof snapshotArbLatencyArtifactV2Input>): void {
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.numericSource)).toBe(true);
  expect(Object.isFrozen(snapshot.latencyStatsA)).toBe(true);
  expect(Object.isFrozen(snapshot.opportunitySummary)).toBe(true);
  expect(Object.isFrozen(snapshot.deploymentReadiness)).toBe(true);
  expect(Object.isFrozen(snapshot.collection)).toBe(true);
  expect(Object.isFrozen(snapshot.collection.samples)).toBe(true);
  expect(Object.isFrozen(snapshot.collection.opportunities)).toBe(true);
  expect(Object.isFrozen(snapshot.opportunities)).toBe(true);
}

describe("arb latency artifact v2 input snapshot", () => {
  it("captures an immutable, structurally compatible deep snapshot", () => {
    const input = sourceInput();
    const inputStats = input.latencyStatsA;
    const inputSummary = input.opportunitySummary;
    const snapshot = snapshotArbLatencyArtifactV2Input(input);

    expect(snapshot).toMatchObject({
      ccxtVersion: "4.5.75",
      exchangeA: "binance",
      exchangeB: "bybit",
      symbol: "BTC/USDT",
    });
    expect(snapshot.latencyStatsA).not.toBe(inputStats);
    expect(snapshot.opportunitySummary).not.toBe(inputSummary);
    expect(snapshot.opportunitySummary.profitableRate).not.toBe(input.opportunitySummary.profitableRate);
    expectFrozenSnapshot(snapshot);
  });

  it("does not retain top-level or nested mutable source values", () => {
    const input = sourceInput();
    const numericSource = input.numericSource;
    const stats = input.latencyStatsA;
    const summary = input.opportunitySummary;
    const readiness = input.deploymentReadiness;
    const snapshot = snapshotArbLatencyArtifactV2Input(input);

    replaceOwnValue(input, "symbol", "ETH/USDT");
    replaceOwnValue(input, "generatedAtUtc", "2027-01-01T00:00:00.000Z");
    replaceOwnValue(numericSource, "durationMs", "1");
    replaceOwnValue(stats, "rttCount", 999);
    replaceOwnValue(summary, "totalSamples", 999n);
    replaceOwnValue(readiness, "reasoning", "changed");

    expect(snapshot.symbol).toBe("BTC/USDT");
    expect(snapshot.generatedAtUtc).toBe("2026-08-24T12:34:56.789Z");
    expect(snapshot.numericSource.durationMs).toBe("30000");
    expect(snapshot.latencyStatsA.rttCount).toBe(3);
    expect(snapshot.opportunitySummary.totalSamples).toBe(1n);
    expect(snapshot.deploymentReadiness.reasoning).not.toBe("changed");
  });

  it("uses only own data descriptors and contains proxy failures", () => {
    const input = sourceInput();
    let getterCalls = 0;
    Object.defineProperty(input, "symbol", {
      configurable: true,
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("private symbol");
      },
    });
    const accessorFailure = expectFailure(() => snapshotArbLatencyArtifactV2Input(input), "INPUT_SHAPE");
    expect(getterCalls).toBe(0);
    expect(accessorFailure.message).not.toContain("private symbol");

    const reflectionCause = new Error("private proxy state");
    const proxy = new Proxy(sourceInput(), {
      ownKeys(): never {
        throw reflectionCause;
      },
    });
    const proxyFailure = expectFailure(() => snapshotArbLatencyArtifactV2Input(proxy), "INPUT_SHAPE");
    expect(proxyFailure.cause).toBeInstanceOf(Error);
    expect(proxyFailure.message).not.toContain("private proxy state");
  });

  it("rejects missing, extra, accessor, and proxy fields in every nested record area", () => {
    const missingInput = sourceInput();
    removeOwnValue(missingInput, "symbol");
    expectFailure(() => snapshotArbLatencyArtifactV2Input(missingInput), "INPUT_SHAPE");

    const extraNumeric = sourceInput();
    const numericSource = extraNumeric.numericSource;
    replaceOwnValue(numericSource, "extra", "unexpected");
    expectFailure(() => snapshotArbLatencyArtifactV2Input(extraNumeric), "NUMERIC_SOURCE_SHAPE");

    const missingStats = sourceInput();
    const stats = missingStats.latencyStatsA;
    removeOwnValue(stats, "rttCount");
    expectFailure(() => snapshotArbLatencyArtifactV2Input(missingStats), "LATENCY_STATS_SHAPE");

    const accessorSummary = sourceInput();
    const summary = accessorSummary.opportunitySummary;
    Object.defineProperty(summary, "totalSamples", {
      configurable: true,
      enumerable: true,
      get(): never {
        throw new Error("private summary");
      },
    });
    expectFailure(() => snapshotArbLatencyArtifactV2Input(accessorSummary), "OPPORTUNITY_SUMMARY_SHAPE");

    const proxiedReadiness = sourceInput();
    const readiness = proxiedReadiness.deploymentReadiness;
    replaceOwnValue(proxiedReadiness, "deploymentReadiness", new Proxy(readiness, { ownKeys: () => [] }));
    expectFailure(() => snapshotArbLatencyArtifactV2Input(proxiedReadiness), "DEPLOYMENT_READINESS_SHAPE");
  });

  it("rejects invalid scalar types, unsupported IDs, and invalid verdicts", () => {
    const wrongString = sourceInput();
    replaceOwnValue(wrongString, "generatedAtUtc", 1);
    expectFailure(() => snapshotArbLatencyArtifactV2Input(wrongString), "INPUT_SHAPE");

    const wrongBoolean = sourceInput();
    replaceOwnValue(wrongBoolean, "measureReconnect", "true");
    expectFailure(() => snapshotArbLatencyArtifactV2Input(wrongBoolean), "INPUT_SHAPE");

    const wrongBigint = sourceInput();
    replaceOwnValue(wrongBigint, "latencySampleCount", 1);
    expectFailure(() => snapshotArbLatencyArtifactV2Input(wrongBigint), "INPUT_SHAPE");

    const unsupportedExchange = sourceInput();
    replaceOwnValue(unsupportedExchange, "exchangeA", "unsupported");
    expectFailure(() => snapshotArbLatencyArtifactV2Input(unsupportedExchange), "INPUT_SHAPE");

    const wrongStat = sourceInput();
    const stats = wrongStat.latencyStatsB;
    replaceOwnValue(stats, "rttP95Ms", "not-a-number");
    expectFailure(() => snapshotArbLatencyArtifactV2Input(wrongStat), "LATENCY_STATS_SHAPE");

    const wrongNumeric = sourceInput();
    const numeric = wrongNumeric.numericSource;
    replaceOwnValue(numeric, "minSpreadBps", 0);
    expectFailure(() => snapshotArbLatencyArtifactV2Input(wrongNumeric), "NUMERIC_SOURCE_SHAPE");

    const wrongSummary = sourceInput();
    const summary = wrongSummary.opportunitySummary;
    replaceOwnValue(summary, "profitableRate", "not-rational");
    expectFailure(() => snapshotArbLatencyArtifactV2Input(wrongSummary), "OPPORTUNITY_SUMMARY_SHAPE");

    const wrongReadiness = sourceInput();
    const readiness = wrongReadiness.deploymentReadiness;
    replaceOwnValue(readiness, "verdict", "UNKNOWN");
    expectFailure(() => snapshotArbLatencyArtifactV2Input(wrongReadiness), "DEPLOYMENT_READINESS_SHAPE");

    const wrongReadinessBoolean = sourceInput();
    replaceOwnValue(wrongReadinessBoolean.deploymentReadiness, "sub100msFeasible", "false");
    expectFailure(
      () => snapshotArbLatencyArtifactV2Input(wrongReadinessBoolean),
      "DEPLOYMENT_READINESS_SHAPE",
    );

    const wrongMarket = sourceInput();
    replaceOwnValue(wrongMarket, "collection", {
      samples: [],
      opportunities: [],
      observedDurationNs: 1n,
      unexpected: true,
    });
    expectFailure(() => snapshotArbLatencyArtifactV2Input(wrongMarket), "INPUT_SHAPE");
  });

  it("clones rational values and composes independent market lists", () => {
    const input = sourceInput();
    const sourceRate = input.opportunitySummary.profitableRate;
    const sourceOpportunities = [...input.opportunities];
    replaceOwnValue(input, "opportunities", sourceOpportunities);
    const snapshot = snapshotArbLatencyArtifactV2Input(input);

    sourceOpportunities.push({
      timestamp: 1,
      exchangeA: { id: "binance", bid: ExactRational.from("1"), ask: ExactRational.from("2") },
      exchangeB: { id: "bybit", bid: ExactRational.from("1"), ask: ExactRational.from("2") },
      crossSpreadBps: ExactRational.from(0n),
      profitableAfterLatency: false,
      theoreticalPnlUsd: ExactRational.from(0n),
    });

    expect(snapshot.opportunitySummary.profitableRate).not.toBe(sourceRate);
    expect(snapshot.opportunitySummary.profitableRate.equals(sourceRate)).toBe(true);
    expect(snapshot.opportunities).toHaveLength(1);
    expect(snapshot.collection.samples).toHaveLength(1);
    expect(snapshot.collection.opportunities).toHaveLength(1);
  });
});
