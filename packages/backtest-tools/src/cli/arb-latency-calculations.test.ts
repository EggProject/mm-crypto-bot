import { describe, expect, it } from "bun:test";

import type { LatencyStats } from "@mm-crypto-bot/exchange";

import {
  assessDeploymentReadiness,
  estimateArbLatencyMs,
  roundStatsForJson,
  summarizeOpportunities,
  type SpreadOpportunity,
} from "./arb-latency-calculations.js";

function latencyStats(overrides: Readonly<Partial<LatencyStats>> = {}): LatencyStats {
  return {
    exchangeId: "binance",
    rttCount: 3,
    rttMinMs: 10,
    rttMaxMs: 30,
    rttMedianMs: 20,
    rttP95Ms: 20,
    rttP99Ms: 30,
    rttSuccessRate: 1,
    gapCount: 2,
    gapMinMs: 10,
    gapMaxMs: 20,
    gapMedianMs: 15,
    gapP95Ms: 20,
    gapP99Ms: 20,
    reconnectCount: 1,
    reconnectMinMs: 20,
    reconnectMaxMs: 30,
    reconnectMedianMs: 25,
    reconnectP95Ms: 30,
    ...overrides,
  };
}

const opportunities: readonly [SpreadOpportunity, SpreadOpportunity, SpreadOpportunity] = [
  {
    timestamp: 1,
    exchangeA: { id: "binance", bid: 100, ask: 101 },
    exchangeB: { id: "bybit", bid: 99, ask: 100 },
    crossSpreadBps: 5,
    profitableAfterLatency: false,
    theoreticalPnlUsd: 0,
  },
  {
    timestamp: 2,
    exchangeA: { id: "binance", bid: 101, ask: 102 },
    exchangeB: { id: "bybit", bid: 100, ask: 101 },
    crossSpreadBps: 15,
    profitableAfterLatency: true,
    theoreticalPnlUsd: 2.5,
  },
  {
    timestamp: 3,
    exchangeA: { id: "binance", bid: 102, ask: 103 },
    exchangeB: { id: "bybit", bid: 101, ask: 102 },
    crossSpreadBps: 25,
    profitableAfterLatency: true,
    theoreticalPnlUsd: 3.5,
  },
];

describe("arb latency calculation extraction parity", () => {
  it("preserves exact opportunity summary values", () => {
    expect(summarizeOpportunities(opportunities)).toEqual({
      totalSamples: 3,
      profitableCount: 2,
      profitableRate: 2 / 3,
      medianSpreadBps: 15,
      maxSpreadBps: 25,
      totalTheoreticalPnlUsd: 6,
      averagePnlPerOpportunityUsd: 3,
    });
  });

  it("preserves readiness verdict boundaries and the p95 latency formula", () => {
    const fastA = latencyStats({ rttP95Ms: 20 });
    const fastB = latencyStats({ exchangeId: "bybit", rttP95Ms: 20 });
    expect(estimateArbLatencyMs(fastA, fastB)).toBe(90);
    expect(
      assessDeploymentReadiness(fastA, fastB, {
        profitableRate: 0.1,
        medianSpreadBps: 15,
        totalTheoreticalPnlUsd: 100,
        profitableCount: 30,
        totalSamples: 30,
      }).verdict,
    ).toBe("PASS");
    expect(
      assessDeploymentReadiness(fastA, fastB, {
        profitableRate: 0.01,
        medianSpreadBps: 15,
        totalTheoreticalPnlUsd: 10,
        profitableCount: 1,
        totalSamples: 1,
      }).verdict,
    ).toBe("PARTIAL");
    expect(
      assessDeploymentReadiness(latencyStats({ rttP95Ms: 30 }), fastB, {
        profitableRate: 0.001,
        medianSpreadBps: 15,
        totalTheoreticalPnlUsd: 100,
        profitableCount: 30,
        totalSamples: 30,
      }).verdict,
    ).toBe("FAIL");
  });

  it("preserves JSON-safe rounding of finite and non-finite statistics", () => {
    const rounded = roundStatsForJson(latencyStats({ rttP95Ms: 12.345, gapP99Ms: NaN }));
    expect(rounded).toMatchObject({ rttP95Ms: 12.35 });
    expect(Reflect.get(rounded, "gapP99Ms")).toBeNull();
  });

  it("preserves median, fallback, empty-summary, and fail-readiness boundaries", () => {
    expect(
      summarizeOpportunities([
        { ...opportunities[2], crossSpreadBps: 25 },
        { ...opportunities[0], crossSpreadBps: 5 },
      ]),
    ).toMatchObject({ medianSpreadBps: 15, profitableCount: 1 });
    expect(summarizeOpportunities([])).toMatchObject({
      profitableRate: NaN,
      medianSpreadBps: NaN,
      maxSpreadBps: NaN,
      averagePnlPerOpportunityUsd: NaN,
    });
    expect(summarizeOpportunities([{ ...opportunities[0], profitableAfterLatency: false }])).toMatchObject({
      averagePnlPerOpportunityUsd: NaN,
    });

    const fallbackA = latencyStats({ rttP95Ms: NaN, rttMedianMs: NaN });
    const fallbackB = latencyStats({ exchangeId: "bybit", rttP95Ms: NaN, rttMedianMs: 40 });
    expect(estimateArbLatencyMs(fallbackA, fallbackB)).toBe(290);
    expect(estimateArbLatencyMs(fallbackA, { ...fallbackB, rttMedianMs: NaN })).toBe(450);
    expect(
      assessDeploymentReadiness(latencyStats(), latencyStats({ exchangeId: "bybit" }), {
        profitableRate: 0.0001,
        medianSpreadBps: 15,
        totalTheoreticalPnlUsd: 100,
        profitableCount: 1,
        totalSamples: 1,
      }).verdict,
    ).toBe("FAIL");
    expect(
      assessDeploymentReadiness(latencyStats(), latencyStats({ exchangeId: "bybit" }), {
        profitableRate: 0,
        medianSpreadBps: 0,
        totalTheoreticalPnlUsd: 0,
        profitableCount: 0,
        totalSamples: 0,
      }).verdict,
    ).toBe("FAIL");
  });
});
