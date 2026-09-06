import { isSupportedExchangeId, type SupportedExchangeId } from "@mm-crypto-bot/exchange";
import type { ExactRational } from "@mm-crypto-bot/numeric";

import type { ExactExchangeQuote, ExactSpreadOpportunity } from "./arb-latency-exact-calculations.js";
import type {
  ExactArbLatencyCollection,
  ExactArbLatencySpreadSample,
} from "./arb-latency-exact-collector.js";
import { MAXIMUM_EXACT_ARB_LATENCY_SAMPLES } from "./arb-latency-exact-collector.js";
import {
  readClosedArtifactArray,
  readClosedArtifactRecord,
  snapshotArtifactExactRational,
} from "./arb-latency-artifact-v2-snapshot-primitives.js";

export type ArbLatencyArtifactMarketSnapshotErrorCode =
  "COLLECTION_SHAPE" | "OPPORTUNITY_SHAPE" | "QUOTE_SHAPE" | "SAMPLE_SHAPE";

export class ArbLatencyArtifactMarketSnapshotError extends Error {
  public constructor(
    public readonly code: ArbLatencyArtifactMarketSnapshotErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArbLatencyArtifactMarketSnapshotError";
  }
}

export interface ExactArbLatencyMarketSnapshot {
  readonly collection: ExactArbLatencyCollection;
  readonly opportunities: readonly ExactSpreadOpportunity[];
}

function fail(code: ArbLatencyArtifactMarketSnapshotErrorCode, message: string, cause?: unknown): never {
  throw new ArbLatencyArtifactMarketSnapshotError(code, message, cause);
}

function snapshotFailure(
  code: ArbLatencyArtifactMarketSnapshotErrorCode,
  message: string,
  error: unknown,
): never {
  if (error instanceof ArbLatencyArtifactMarketSnapshotError) throw error;
  return fail(code, message, error);
}

function requireSupportedExchangeId(
  value: unknown,
  code: ArbLatencyArtifactMarketSnapshotErrorCode,
): SupportedExchangeId {
  if (typeof value !== "string" || !isSupportedExchangeId(value)) {
    fail(code, "Artifact exchange identifier is unsupported.");
  }
  return value;
}

function requireTimestamp(value: unknown, code: ArbLatencyArtifactMarketSnapshotErrorCode): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(code, "Artifact timestamp must be a nonnegative safe integer.");
  }
  return value;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function requireBigint(value: unknown, code: ArbLatencyArtifactMarketSnapshotErrorCode): bigint {
  if (typeof value !== "bigint") {
    fail(code, "Artifact observed duration must be bigint.");
  }
  return value;
}

function snapshotRational(
  value: unknown,
  label: string,
  code: ArbLatencyArtifactMarketSnapshotErrorCode,
): ExactRational {
  try {
    return snapshotArtifactExactRational(value, label);
  } catch (error: unknown) {
    return snapshotFailure(code, "Artifact exact value is invalid.", error);
  }
}

function snapshotQuote(value: unknown, label: string): ExactExchangeQuote {
  try {
    const record = readClosedArtifactRecord(value, ["id", "bid", "ask"], label);
    const id = requireSupportedExchangeId(record["id"], "QUOTE_SHAPE");
    const bid = snapshotRational(record["bid"], `${label}.bid`, "QUOTE_SHAPE");
    const ask = snapshotRational(record["ask"], `${label}.ask`, "QUOTE_SHAPE");
    return Object.freeze({ id, bid, ask });
  } catch (error: unknown) {
    return snapshotFailure("QUOTE_SHAPE", "Artifact exchange quote is invalid.", error);
  }
}

function snapshotSample(value: unknown, label: string): ExactArbLatencySpreadSample {
  try {
    const record = readClosedArtifactRecord(
      value,
      ["timestamp", "exchangeA", "exchangeB", "aSellBBuySpreadBps", "bSellABuySpreadBps", "maximumSpreadBps"],
      label,
    );
    const timestamp = requireTimestamp(record["timestamp"], "SAMPLE_SHAPE");
    const exchangeA = snapshotQuote(record["exchangeA"], `${label}.exchangeA`);
    const exchangeB = snapshotQuote(record["exchangeB"], `${label}.exchangeB`);
    const aSellBBuySpreadBps = snapshotRational(
      record["aSellBBuySpreadBps"],
      `${label}.aSellBBuySpreadBps`,
      "SAMPLE_SHAPE",
    );
    const bSellABuySpreadBps = snapshotRational(
      record["bSellABuySpreadBps"],
      `${label}.bSellABuySpreadBps`,
      "SAMPLE_SHAPE",
    );
    const maximumSpreadBps = snapshotRational(
      record["maximumSpreadBps"],
      `${label}.maximumSpreadBps`,
      "SAMPLE_SHAPE",
    );
    return Object.freeze({
      timestamp,
      exchangeA,
      exchangeB,
      aSellBBuySpreadBps,
      bSellABuySpreadBps,
      maximumSpreadBps,
    });
  } catch (error: unknown) {
    return snapshotFailure("SAMPLE_SHAPE", "Artifact market sample is invalid.", error);
  }
}

function snapshotOpportunity(value: unknown, label: string): ExactSpreadOpportunity {
  try {
    const record = readClosedArtifactRecord(
      value,
      [
        "timestamp",
        "exchangeA",
        "exchangeB",
        "crossSpreadBps",
        "profitableAfterLatency",
        "theoreticalPnlUsd",
      ],
      label,
    );
    const timestamp = requireTimestamp(record["timestamp"], "OPPORTUNITY_SHAPE");
    const exchangeA = snapshotQuote(record["exchangeA"], `${label}.exchangeA`);
    const exchangeB = snapshotQuote(record["exchangeB"], `${label}.exchangeB`);
    const crossSpreadBps = snapshotRational(
      record["crossSpreadBps"],
      `${label}.crossSpreadBps`,
      "OPPORTUNITY_SHAPE",
    );
    const profitabilityFlag = record["profitableAfterLatency"];
    if (!isBoolean(profitabilityFlag)) {
      fail("OPPORTUNITY_SHAPE", "Artifact profitability flag must be boolean.");
    }
    const isProfitableAfterLatency = profitabilityFlag;
    const theoreticalPnlUsd = snapshotRational(
      record["theoreticalPnlUsd"],
      `${label}.theoreticalPnlUsd`,
      "OPPORTUNITY_SHAPE",
    );
    return Object.freeze({
      timestamp,
      exchangeA,
      exchangeB,
      crossSpreadBps,
      profitableAfterLatency: isProfitableAfterLatency,
      theoreticalPnlUsd,
    });
  } catch (error: unknown) {
    return snapshotFailure("OPPORTUNITY_SHAPE", "Artifact market opportunity is invalid.", error);
  }
}

function snapshotList<T>(
  input: unknown,
  label: string,
  code: ArbLatencyArtifactMarketSnapshotErrorCode,
  snapshotEntry: (value: unknown, label: string) => T,
): readonly T[] {
  try {
    const entries = readClosedArtifactArray(input, label, MAXIMUM_EXACT_ARB_LATENCY_SAMPLES);
    const snapshot = Array.from(entries, (entry, index) =>
      snapshotEntry(entry, `${label}[${String(index)}]`),
    );
    return Object.freeze(snapshot);
  } catch (error: unknown) {
    return snapshotFailure(code, "Artifact market collection array is invalid.", error);
  }
}

export function snapshotExactExchangeQuote(input: unknown, label = "quote"): ExactExchangeQuote {
  return snapshotQuote(input, label);
}

export function snapshotExactArbLatencySpreadSample(
  input: unknown,
  label = "sample",
): ExactArbLatencySpreadSample {
  return snapshotSample(input, label);
}

export function snapshotExactSpreadOpportunity(
  input: unknown,
  label = "opportunity",
): ExactSpreadOpportunity {
  return snapshotOpportunity(input, label);
}

export function snapshotExactSpreadOpportunityList(
  input: unknown,
  label = "opportunities",
): readonly ExactSpreadOpportunity[] {
  return snapshotList(input, label, "OPPORTUNITY_SHAPE", snapshotOpportunity);
}

export function snapshotExactArbLatencyCollection(
  input: unknown,
  label = "collection",
): ExactArbLatencyCollection {
  try {
    const record = readClosedArtifactRecord(input, ["samples", "opportunities", "observedDurationNs"], label);
    const samples = snapshotList(record["samples"], `${label}.samples`, "SAMPLE_SHAPE", snapshotSample);
    const opportunities = snapshotExactSpreadOpportunityList(
      record["opportunities"],
      `${label}.opportunities`,
    );
    const observedDurationNs = requireBigint(record["observedDurationNs"], "COLLECTION_SHAPE");
    return Object.freeze({ samples, opportunities, observedDurationNs });
  } catch (error: unknown) {
    return snapshotFailure("COLLECTION_SHAPE", "Artifact market collection is invalid.", error);
  }
}

export function snapshotExactArbLatencyMarketSnapshot(
  collection: unknown,
  opportunities: unknown,
): ExactArbLatencyMarketSnapshot {
  return Object.freeze({
    collection: snapshotExactArbLatencyCollection(collection),
    opportunities: snapshotExactSpreadOpportunityList(opportunities),
  });
}
