import type { LatencyStats } from "@mm-crypto-bot/exchange";
import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  assessExactDeploymentReadiness,
  calculateExactDirectionalArbSpreads,
  calculateExactOpportunityPnlUsd,
  summarizeExactOpportunities,
  type ExactExchangeQuote,
  type ExactSpreadOpportunity,
} from "./arb-latency-exact-calculations.js";
import type {
  ExactArbLatencyCollection,
  ExactArbLatencySpreadSample,
} from "./arb-latency-exact-collector.js";
import type { ArbLatencyArtifactV2Input } from "./arb-latency-artifact-v2.js";

export const EXACT_ZERO = ExactRational.from(0n);

export function fixtureLatencyStats(
  exchangeId: "binance" | "bybit",
  overrides: Partial<LatencyStats> = {},
): LatencyStats {
  return {
    exchangeId,
    rttCount: 3,
    rttMinMs: 5,
    rttMaxMs: 15,
    rttMedianMs: 10,
    rttP95Ms: 15,
    rttP99Ms: 15,
    rttSuccessRate: 1,
    gapCount: 2,
    gapMinMs: 1,
    gapMaxMs: 3,
    gapMedianMs: 2,
    gapP95Ms: 3,
    gapP99Ms: 3,
    reconnectCount: 1,
    reconnectMinMs: 4,
    reconnectMaxMs: 4,
    reconnectMedianMs: 4,
    reconnectP95Ms: 4,
    ...overrides,
  };
}

function fixtureSpreadSample(): ExactArbLatencySpreadSample {
  const exchangeA: ExactExchangeQuote = Object.freeze({
    id: "binance",
    bid: ExactRational.from("110.25"),
    ask: ExactRational.from("111.5"),
  });
  const exchangeB: ExactExchangeQuote = Object.freeze({
    id: "bybit",
    bid: ExactRational.from("100.125"),
    ask: ExactRational.from("101.25"),
  });
  const directionalSpreads = calculateExactDirectionalArbSpreads(exchangeA, exchangeB);
  return Object.freeze({
    timestamp: 1_725_000_000_000,
    exchangeA,
    exchangeB,
    ...directionalSpreads,
  });
}

function fixtureLatencyStatSampleCount(latencyStats: LatencyStats): bigint {
  const categoryCounts = [latencyStats.rttCount, latencyStats.gapCount, latencyStats.reconnectCount];
  if (categoryCounts.some((count) => !Number.isSafeInteger(count))) {
    return 0n;
  }
  return categoryCounts.reduce((total, count) => total + BigInt(count), 0n);
}

export function fixtureArtifactInput(
  overrides: Partial<ArbLatencyArtifactV2Input> = {},
): ArbLatencyArtifactV2Input {
  const latencyStatsA = overrides.latencyStatsA ?? fixtureLatencyStats("binance");
  const latencyStatsB = overrides.latencyStatsB ?? fixtureLatencyStats("bybit");
  const latencySampleCount =
    fixtureLatencyStatSampleCount(latencyStatsA) + fixtureLatencyStatSampleCount(latencyStatsB);
  const sample = fixtureSpreadSample();
  const observedDurationNs = 1_000_000_000n;
  const tradeNotionalUsd = ExactRational.from("1000.01");
  const expectedPnl = calculateExactOpportunityPnlUsd(sample.maximumSpreadBps, tradeNotionalUsd, 80n);
  const recomputedOpportunity: ExactSpreadOpportunity = Object.freeze({
    timestamp: sample.timestamp,
    exchangeA: sample.exchangeA,
    exchangeB: sample.exchangeB,
    crossSpreadBps: sample.maximumSpreadBps,
    profitableAfterLatency: expectedPnl.compare(EXACT_ZERO) > 0,
    theoreticalPnlUsd: expectedPnl,
  });
  const provisionalOpportunity: ExactSpreadOpportunity = Object.freeze({
    ...recomputedOpportunity,
    profitableAfterLatency: false,
    theoreticalPnlUsd: EXACT_ZERO,
  });
  const opportunities = Object.freeze([recomputedOpportunity]);
  const opportunitySummary = summarizeExactOpportunities(opportunities);
  const deploymentReadiness = assessExactDeploymentReadiness(
    latencyStatsA,
    latencyStatsB,
    opportunitySummary,
    observedDurationNs,
  );
  const collection: ExactArbLatencyCollection = Object.freeze({
    samples: Object.freeze([sample]),
    opportunities: Object.freeze([provisionalOpportunity]),
    observedDurationNs,
  });
  return {
    exchangeA: "binance",
    exchangeB: "bybit",
    symbol: "BTC/USDT",
    measureReconnect: true,
    numericSource: Object.freeze({
      minSpreadBps: "0",
      rttIntervalMs: "500",
      tradeNotionalUsd: "1000.01",
      durationMs: "30000",
    }),
    latencyStatsA,
    latencyStatsB,
    collection,
    opportunities,
    opportunitySummary,
    deploymentReadiness,
    observedDurationNs,
    generatedAtUtc: "2026-08-24T12:34:56.789Z",
    ccxtVersion: "4.5.75",
    latencySampleCount,
    ...overrides,
  };
}

export function requireFixtureEntry<T>(entries: readonly T[], description: string): T {
  const firstEntry = entries.at(0);
  if (firstEntry === undefined) {
    throw new Error(`Expected ${description} fixture entry.`);
  }
  return firstEntry;
}

export function reflectedValue(target: object, property: PropertyKey, receiver: unknown): unknown {
  const value: unknown = Reflect.get(target, property, receiver);
  return value;
}
