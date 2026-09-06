import { describe, expect, it } from "vitest";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  ArbLatencyArtifactMarketSnapshotError,
  snapshotExactArbLatencyCollection,
  snapshotExactArbLatencyMarketSnapshot,
  snapshotExactArbLatencySpreadSample,
  snapshotExactExchangeQuote,
  snapshotExactSpreadOpportunity,
  snapshotExactSpreadOpportunityList,
  type ArbLatencyArtifactMarketSnapshotErrorCode,
} from "./arb-latency-artifact-v2-market-snapshot.js";
import { MAXIMUM_EXACT_ARB_LATENCY_SAMPLES } from "./arb-latency-exact-collector.js";

function expectFailure(
  action: () => unknown,
  code: ArbLatencyArtifactMarketSnapshotErrorCode,
): ArbLatencyArtifactMarketSnapshotError {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArbLatencyArtifactMarketSnapshotError);
    if (error instanceof ArbLatencyArtifactMarketSnapshotError) {
      expect(error.code).toBe(code);
      return error;
    }
  }
  throw new TypeError(`Expected market snapshot failure with ${code}.`);
}

function quote(): Record<string, unknown> {
  return {
    id: "binance",
    bid: ExactRational.from("100.25"),
    ask: ExactRational.from("100.5"),
  };
}

function secondQuote(): Record<string, unknown> {
  return {
    id: "bybit",
    bid: ExactRational.from("99.75"),
    ask: ExactRational.from("100"),
  };
}

function sample(): Record<string, unknown> {
  return {
    timestamp: 1_725_000_000_000,
    exchangeA: quote(),
    exchangeB: secondQuote(),
    aSellBBuySpreadBps: ExactRational.from("25"),
    bSellABuySpreadBps: ExactRational.from("-50"),
    maximumSpreadBps: ExactRational.from("25"),
  };
}

function opportunity(): Record<string, unknown> {
  return {
    timestamp: 1_725_000_000_000,
    exchangeA: quote(),
    exchangeB: secondQuote(),
    crossSpreadBps: ExactRational.from("25"),
    profitableAfterLatency: true,
    theoreticalPnlUsd: ExactRational.from("2.5"),
  };
}

function collection(): Record<string, unknown> {
  return {
    samples: [sample()],
    opportunities: [opportunity()],
    observedDurationNs: 1_000_000_000n,
  };
}

function exactBoundEntries<T>(entry: T): T[] {
  return Array.from({ length: MAXIMUM_EXACT_ARB_LATENCY_SAMPLES }, () => entry);
}

function oversizedDescriptorGuard<T>(entries: T[]): {
  readonly input: T[];
  readonly readEntryDescriptorCount: () => number;
  readonly readOwnKeysCount: () => number;
} {
  let entryDescriptorCount = 0;
  let ownKeysCount = 0;
  const input = new Proxy(entries, {
    getOwnPropertyDescriptor(target, property) {
      if (property !== "length") entryDescriptorCount += 1;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    ownKeys(target) {
      ownKeysCount += 1;
      return Reflect.ownKeys(target);
    },
  });
  return {
    input,
    readEntryDescriptorCount: () => entryDescriptorCount,
    readOwnKeysCount: () => ownKeysCount,
  };
}

function expectFrozenDeepMarketValues(value: ReturnType<typeof snapshotExactArbLatencyCollection>): void {
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.isFrozen(value.samples)).toBe(true);
  expect(Object.isFrozen(value.opportunities)).toBe(true);
  const firstSample = value.samples.at(0);
  const firstOpportunity = value.opportunities.at(0);
  if (firstSample === undefined || firstOpportunity === undefined) {
    throw new TypeError("Expected fixture market entries.");
  }
  expect(Object.isFrozen(firstSample)).toBe(true);
  expect(Object.isFrozen(firstSample.exchangeA)).toBe(true);
  expect(Object.isFrozen(firstOpportunity)).toBe(true);
  expect(Object.isFrozen(firstOpportunity.exchangeB)).toBe(true);
}

describe("arb latency artifact v2 market snapshot", () => {
  it("creates fully independent frozen snapshots of market collection structures", () => {
    const firstSourceSample = sample();
    const firstSourceOpportunity = opportunity();
    const input = {
      samples: [firstSourceSample],
      opportunities: [firstSourceOpportunity],
      observedDurationNs: 1_000_000_000n,
    };
    const snapshot = snapshotExactArbLatencyCollection(input);
    input.samples[0] = sample();
    input.opportunities[0] = opportunity();
    input.observedDurationNs = 2n;

    expect(snapshot.observedDurationNs).toBe(1_000_000_000n);
    expect(snapshot.samples).toHaveLength(1);
    expect(snapshot.opportunities).toHaveLength(1);
    expect(snapshot.samples[0]).not.toBe(firstSourceSample);
    expect(snapshot.opportunities[0]).not.toBe(firstSourceOpportunity);
    const firstSample = snapshot.samples.at(0);
    const firstOpportunity = snapshot.opportunities.at(0);
    if (firstSample === undefined || firstOpportunity === undefined) {
      throw new TypeError("Expected snapshotted entries.");
    }
    expect(firstSample.exchangeA.bid.equals(ExactRational.from("100.25"))).toBe(true);
    expect(firstOpportunity.theoreticalPnlUsd.equals(ExactRational.from("2.5"))).toBe(true);
    expectFrozenDeepMarketValues(snapshot);
  });

  it("clones every rational and provides an independent recomputed opportunity list boundary", () => {
    const sourceQuote = quote();
    const quoteSnapshot = snapshotExactExchangeQuote(sourceQuote);
    const sourceBid = sourceQuote["bid"];
    if (!(sourceBid instanceof ExactRational)) throw new TypeError("Expected exact source bid.");
    expect(quoteSnapshot.bid).not.toBe(sourceBid);
    expect(quoteSnapshot.bid.equals(sourceBid)).toBe(true);

    const sourceOpportunities = [opportunity()];
    const combined = snapshotExactArbLatencyMarketSnapshot(collection(), sourceOpportunities);
    sourceOpportunities[0] = opportunity();
    expect(combined.collection).not.toBe(sourceOpportunities);
    expect(combined.opportunities).toHaveLength(1);
    expect(Object.isFrozen(combined)).toBe(true);
    expect(Object.isFrozen(combined.opportunities)).toBe(true);
  });

  it("never executes getters and contains proxy reflection failures as typed causes", () => {
    let getterCalls = 0;
    const accessorQuote = Object.defineProperty(
      { bid: ExactRational.from("1"), ask: ExactRational.from("2") },
      "id",
      {
        enumerable: true,
        get(): never {
          getterCalls += 1;
          throw new Error("private exchange value");
        },
      },
    );
    const accessorFailure = expectFailure(() => snapshotExactExchangeQuote(accessorQuote), "QUOTE_SHAPE");
    expect(getterCalls).toBe(0);
    expect(accessorFailure.message).not.toContain("private exchange value");
    expect(accessorFailure.cause).toBeInstanceOf(Error);

    const reflectionCause = new Error("private proxy value");
    const proxy = new Proxy(quote(), {
      ownKeys(): never {
        throw reflectionCause;
      },
    });
    const proxyFailure = expectFailure(() => snapshotExactExchangeQuote(proxy), "QUOTE_SHAPE");
    expect(proxyFailure.cause).toBeInstanceOf(Error);
    expect(proxyFailure.message).not.toContain("private proxy value");
  });

  it("takes a stable array and descriptor snapshot before later source mutation", () => {
    const source = [opportunity()];
    const list = snapshotExactSpreadOpportunityList(source);
    source.push(opportunity());
    source[0] = opportunity();
    expect(list).toHaveLength(1);
    expect(Object.isFrozen(list)).toBe(true);

    const descriptorSource = sample();
    const proxy = new Proxy(descriptorSource, {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === "timestamp" && descriptor !== undefined) {
          target["timestamp"] = 1;
        }
        return descriptor;
      },
    });
    const stable = snapshotExactArbLatencySpreadSample(proxy);
    expect(stable.timestamp).toBe(1_725_000_000_000);
  });

  it("rejects invalid quote scalar, identifier, closed-schema, and rational cases", () => {
    for (const invalidId of ["unsupported", 1, undefined]) {
      const input = quote();
      input["id"] = invalidId;
      expectFailure(() => snapshotExactExchangeQuote(input), "QUOTE_SHAPE");
    }
    const invalidBid = quote();
    invalidBid["bid"] = "100";
    expectFailure(() => snapshotExactExchangeQuote(invalidBid), "QUOTE_SHAPE");
    const invalidAsk = quote();
    invalidAsk["ask"] = "100";
    expectFailure(() => snapshotExactExchangeQuote(invalidAsk), "QUOTE_SHAPE");
    const missing = quote();
    delete missing["ask"];
    expectFailure(() => snapshotExactExchangeQuote(missing), "QUOTE_SHAPE");
    expectFailure(() => snapshotExactExchangeQuote({ ...quote(), extra: true }), "QUOTE_SHAPE");
    expectFailure(() => snapshotExactExchangeQuote([]), "QUOTE_SHAPE");
  });

  it("rejects invalid sample timestamps, nested quotes, exact scalars, and closed schema", () => {
    for (const invalidTimestamp of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      const input = sample();
      input["timestamp"] = invalidTimestamp;
      expectFailure(() => snapshotExactArbLatencySpreadSample(input), "SAMPLE_SHAPE");
    }
    const invalidASpread = sample();
    invalidASpread["aSellBBuySpreadBps"] = 1;
    expectFailure(() => snapshotExactArbLatencySpreadSample(invalidASpread), "SAMPLE_SHAPE");
    const invalidBSpread = sample();
    invalidBSpread["bSellABuySpreadBps"] = 1;
    expectFailure(() => snapshotExactArbLatencySpreadSample(invalidBSpread), "SAMPLE_SHAPE");
    const invalidMaximumSpread = sample();
    invalidMaximumSpread["maximumSpreadBps"] = 1;
    expectFailure(() => snapshotExactArbLatencySpreadSample(invalidMaximumSpread), "SAMPLE_SHAPE");
    const nested = sample();
    nested["exchangeA"] = { ...quote(), extra: "x" };
    expectFailure(() => snapshotExactArbLatencySpreadSample(nested), "QUOTE_SHAPE");
    expectFailure(() => snapshotExactArbLatencySpreadSample({ ...sample(), extra: false }), "SAMPLE_SHAPE");
    expectFailure(() => snapshotExactArbLatencySpreadSample({}), "SAMPLE_SHAPE");
  });

  it("rejects invalid opportunity timestamps, flags, exact values, and closed schema", () => {
    const invalidTimestamp = opportunity();
    invalidTimestamp["timestamp"] = NaN;
    expectFailure(() => snapshotExactSpreadOpportunity(invalidTimestamp), "OPPORTUNITY_SHAPE");
    for (const invalidFlag of [0, "true", undefined]) {
      const input = opportunity();
      input["profitableAfterLatency"] = invalidFlag;
      expectFailure(() => snapshotExactSpreadOpportunity(input), "OPPORTUNITY_SHAPE");
    }
    const invalidCrossSpread = opportunity();
    invalidCrossSpread["crossSpreadBps"] = false;
    expectFailure(() => snapshotExactSpreadOpportunity(invalidCrossSpread), "OPPORTUNITY_SHAPE");
    const invalidPnl = opportunity();
    invalidPnl["theoreticalPnlUsd"] = false;
    expectFailure(() => snapshotExactSpreadOpportunity(invalidPnl), "OPPORTUNITY_SHAPE");
    const missing = opportunity();
    delete missing["exchangeB"];
    expectFailure(() => snapshotExactSpreadOpportunity(missing), "OPPORTUNITY_SHAPE");
    expectFailure(
      () => snapshotExactSpreadOpportunity({ ...opportunity(), extra: false }),
      "OPPORTUNITY_SHAPE",
    );
  });

  it("rejects non-dense, accessor, and malformed collection arrays and scalar fields", () => {
    const sparse: unknown[] = [];
    sparse[1] = opportunity();
    expectFailure(() => snapshotExactSpreadOpportunityList(sparse), "OPPORTUNITY_SHAPE");
    const accessorArray = [opportunity()];
    Object.defineProperty(accessorArray, "0", {
      configurable: true,
      enumerable: true,
      get(): never {
        throw new Error("private entry");
      },
    });
    expectFailure(() => snapshotExactSpreadOpportunityList(accessorArray), "OPPORTUNITY_SHAPE");

    for (const invalidDuration of ["1", 1]) {
      const input = collection();
      input["observedDurationNs"] = invalidDuration;
      expectFailure(() => snapshotExactArbLatencyCollection(input), "COLLECTION_SHAPE");
    }
    const malformedSamples = collection();
    malformedSamples["samples"] = {};
    expectFailure(() => snapshotExactArbLatencyCollection(malformedSamples), "SAMPLE_SHAPE");
    const malformedOpportunities = collection();
    malformedOpportunities["opportunities"] = ["not-an-opportunity"];
    expectFailure(() => snapshotExactArbLatencyCollection(malformedOpportunities), "OPPORTUNITY_SHAPE");
    expectFailure(
      () => snapshotExactArbLatencyCollection({ ...collection(), extra: true }),
      "COLLECTION_SHAPE",
    );
  });

  it("bounds every market array before inspecting oversized entry descriptors and accepts its exact limit", () => {
    const exactOpportunities = exactBoundEntries(opportunity());
    expect(snapshotExactSpreadOpportunityList(exactOpportunities)).toHaveLength(
      MAXIMUM_EXACT_ARB_LATENCY_SAMPLES,
    );

    const oversizedEntries = exactBoundEntries(opportunity());
    oversizedEntries.push(opportunity());
    const oversizedSamples = oversizedDescriptorGuard(oversizedEntries);
    expectFailure(
      () =>
        snapshotExactArbLatencyCollection({
          samples: oversizedSamples.input,
          opportunities: [],
          observedDurationNs: 1n,
        }),
      "SAMPLE_SHAPE",
    );
    expect(oversizedSamples.readOwnKeysCount()).toBe(0);
    expect(oversizedSamples.readEntryDescriptorCount()).toBe(0);

    const oversizedOpportunities = oversizedDescriptorGuard(oversizedEntries);
    expectFailure(
      () =>
        snapshotExactArbLatencyCollection({
          samples: [],
          opportunities: oversizedOpportunities.input,
          observedDurationNs: 1n,
        }),
      "OPPORTUNITY_SHAPE",
    );
    expect(oversizedOpportunities.readOwnKeysCount()).toBe(0);
    expect(oversizedOpportunities.readEntryDescriptorCount()).toBe(0);

    const oversizedRecomputed = oversizedDescriptorGuard(oversizedEntries);
    expectFailure(() => snapshotExactSpreadOpportunityList(oversizedRecomputed.input), "OPPORTUNITY_SHAPE");
    expect(oversizedRecomputed.readOwnKeysCount()).toBe(0);
    expect(oversizedRecomputed.readEntryDescriptorCount()).toBe(0);
  });
});
