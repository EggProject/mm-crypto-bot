import { describe, expect, it } from "vitest";

import type { LatencyStats } from "@mm-crypto-bot/exchange";
import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  ArbLatencyCalculationError,
  assessExactDeploymentReadiness,
  calculateExactDirectionalArbSpreads,
  calculateExactOpportunityPnlUsd,
  estimateExactArbLatencyMs,
  isExactOpportunityProfitable,
  summarizeExactOpportunities,
  type ExactOpportunitySummary,
  type ExactExchangeQuote,
  type ExactSpreadOpportunity,
} from "./arb-latency-exact-calculations.js";

function exact(value: string | bigint): ExactRational {
  return ExactRational.from(value);
}

function exchangeQuote(id: "binance" | "bybit", bid: string, ask: string): ExactExchangeQuote {
  return { id, bid: exact(bid), ask: exact(ask) };
}

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

function opportunity(
  timestamp: number,
  crossSpreadBps: string,
  theoreticalPnlUsd: string,
  isProfitableAfterLatency: boolean,
): ExactSpreadOpportunity {
  return {
    timestamp,
    exchangeA: { id: "binance", bid: exact("100"), ask: exact("101") },
    exchangeB: { id: "bybit", bid: exact("99"), ask: exact("100") },
    crossSpreadBps: exact(crossSpreadBps),
    profitableAfterLatency: isProfitableAfterLatency,
    theoreticalPnlUsd: exact(theoreticalPnlUsd),
  };
}

function profitableSummary(
  opportunityCount: number,
  pnlPerOpportunityUsd: ExactRational,
): ExactOpportunitySummary {
  const opportunities = Array.from({ length: opportunityCount }, (_, index) => ({
    ...opportunity(index, "10", "1", true),
    theoreticalPnlUsd: pnlPerOpportunityUsd,
  }));
  return summarizeExactOpportunities(opportunities);
}

function expectExact(value: ExactRational, numerator: string, denominator = "1"): void {
  expect(value.toSnapshot()).toEqual({ schema: "exact-rational@1", numerator, denominator });
}

function expectCalculationError(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArbLatencyCalculationError);
    if (error instanceof ArbLatencyCalculationError) {
      expect(error.code).toBe(code);
      return;
    }
  }

  throw new Error(`Expected ArbLatencyCalculationError with code ${code}.`);
}

function unauthenticExactRational(): ExactRational {
  return new Proxy(exact("1"), {});
}

type OpportunityRationalField = "crossSpreadBps" | "theoreticalPnlUsd";
type SummaryRationalField =
  | "profitableRate"
  | "medianSpreadBps"
  | "maxSpreadBps"
  | "totalTheoreticalPnlUsd"
  | "averagePnlPerOpportunityUsd";

describe("exact arb latency calculations", () => {
  it("calculates immutable directional spreads with the established asymmetric denominator", () => {
    const directionalSpreads = calculateExactDirectionalArbSpreads(
      exchangeQuote("binance", "110", "111"),
      exchangeQuote("bybit", "100", "101"),
    );
    expectExact(directionalSpreads.aSellBBuySpreadBps, "180000", "211");
    expectExact(directionalSpreads.bSellABuySpreadBps, "-220000", "211");
    expect(directionalSpreads.maximumSpreadBps).toBe(directionalSpreads.aSellBBuySpreadBps);
    expect(Object.isFrozen(directionalSpreads)).toBe(true);

    const bSellABuyMaximum = calculateExactDirectionalArbSpreads(
      exchangeQuote("binance", "100", "101"),
      exchangeQuote("bybit", "103", "104"),
    );
    expectExact(bSellABuyMaximum.aSellBBuySpreadBps, "-20000", "51");
    expectExact(bSellABuyMaximum.bSellABuySpreadBps, "10000", "51");
    expect(bSellABuyMaximum.maximumSpreadBps).toBe(bSellABuyMaximum.bSellABuySpreadBps);

    const negativeTie = calculateExactDirectionalArbSpreads(
      exchangeQuote("binance", "100", "101"),
      exchangeQuote("bybit", "99", "102"),
    );
    expectExact(negativeTie.aSellBBuySpreadBps, "-20000", "101");
    expectExact(negativeTie.bSellABuySpreadBps, "-20000", "101");
    expect(negativeTie.maximumSpreadBps).toBe(negativeTie.aSellBBuySpreadBps);
  });

  it("rejects duplicate, non-exact, nonpositive, and crossed exchange quotes", () => {
    const exchangeA = exchangeQuote("binance", "100", "101");
    const exchangeB = exchangeQuote("bybit", "99", "100");
    expect(() =>
      calculateExactDirectionalArbSpreads(exchangeA, exchangeQuote("binance", "99", "100")),
    ).toThrow(ArbLatencyCalculationError);

    const invalidQuoteCases: readonly (readonly [ExactExchangeQuote, ExactExchangeQuote])[] = [
      [exchangeQuote("binance", "0", "101"), exchangeB],
      [exchangeQuote("binance", "100", "0"), exchangeB],
      [exchangeQuote("binance", "-1", "101"), exchangeB],
      [exchangeQuote("binance", "100", "-1"), exchangeB],
      [exchangeA, exchangeQuote("bybit", "0", "100")],
      [exchangeA, exchangeQuote("bybit", "99", "0")],
      [exchangeA, exchangeQuote("bybit", "-1", "100")],
      [exchangeA, exchangeQuote("bybit", "99", "-1")],
      [exchangeQuote("binance", "102", "101"), exchangeB],
      [exchangeA, exchangeQuote("bybit", "101", "100")],
    ];
    for (const [invalidExchangeA, invalidExchangeB] of invalidQuoteCases) {
      try {
        calculateExactDirectionalArbSpreads(invalidExchangeA, invalidExchangeB);
        throw new Error("Expected invalid exchange quote rejection.");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ArbLatencyCalculationError);
        if (error instanceof ArbLatencyCalculationError) {
          expect(error.code).toBe("INVALID_EXCHANGE_QUOTE");
        }
      }
    }

    const invalidRuntimeQuote = exchangeQuote("binance", "100", "101");
    expect(Reflect.set(invalidRuntimeQuote, "bid", "100")).toBe(true);
    expect(() => calculateExactDirectionalArbSpreads(invalidRuntimeQuote, exchangeB)).toThrow(
      ArbLatencyCalculationError,
    );
  });

  it("calculates opportunity PnL and derives profitability from its exact strictly-positive result", () => {
    const pnl = calculateExactOpportunityPnlUsd(exact("11.5"), exact("1000"), 90n);
    expectExact(pnl, "221", "100");
    expectExact(calculateExactOpportunityPnlUsd(exact("0"), exact("1000"), 90n), "-9", "100");
    const breakEvenSpreadBps = ExactRational.fromParts(9n, 20n);
    expect(isExactOpportunityProfitable(ExactRational.fromParts(4499n, 10_000n), exact("1000"), 90n)).toBe(
      false,
    );
    expect(isExactOpportunityProfitable(breakEvenSpreadBps, exact("1000"), 90n)).toBe(false);
    expect(isExactOpportunityProfitable(ExactRational.fromParts(4501n, 10_000n), exact("1000"), 90n)).toBe(
      true,
    );
    expect(() => calculateExactOpportunityPnlUsd(exact("1"), exact("1"), -1n)).toThrow(
      ArbLatencyCalculationError,
    );
    expect(() => isExactOpportunityProfitable(exact("1"), exact("1"), -1n)).toThrow(
      ArbLatencyCalculationError,
    );
    expect(() => calculateExactOpportunityPnlUsd(exact("1"), exact("0"), 1n)).toThrow(
      ArbLatencyCalculationError,
    );
    expect(() => isExactOpportunityProfitable(exact("1"), exact("-1"), 1n)).toThrow(
      ArbLatencyCalculationError,
    );
  });

  it("maps unauthentic exact rational JavaScript-boundary inputs to typed calculation errors", () => {
    const malformedValue: unknown = Object.freeze({});
    const exchangeA = exchangeQuote("binance", "100", "101");
    expect(Reflect.set(exchangeA, "bid", unauthenticExactRational())).toBe(true);
    expectCalculationError(
      () => calculateExactDirectionalArbSpreads(exchangeA, exchangeQuote("bybit", "99", "100")),
      "INVALID_EXACT_RATIONAL",
    );

    expectCalculationError(
      () => Reflect.apply(calculateExactOpportunityPnlUsd, undefined, [malformedValue, exact("1000"), 1n]),
      "INVALID_EXACT_RATIONAL",
    );
    expectCalculationError(
      () => Reflect.apply(calculateExactOpportunityPnlUsd, undefined, [exact("1"), malformedValue, 1n]),
      "INVALID_EXACT_RATIONAL",
    );

    const opportunityRationalFields: readonly OpportunityRationalField[] = [
      "crossSpreadBps",
      "theoreticalPnlUsd",
    ];
    for (const opportunityField of opportunityRationalFields) {
      const malformedOpportunity = opportunity(1, "1", "1", true);
      expect(Reflect.set(malformedOpportunity, opportunityField, unauthenticExactRational())).toBe(true);
      expectCalculationError(
        () => summarizeExactOpportunities([malformedOpportunity]),
        "INVALID_EXACT_RATIONAL",
      );
    }

    const summaryRationalFields: readonly SummaryRationalField[] = [
      "profitableRate",
      "medianSpreadBps",
      "maxSpreadBps",
      "totalTheoreticalPnlUsd",
      "averagePnlPerOpportunityUsd",
    ];
    for (const summaryField of summaryRationalFields) {
      const malformedSummary = { ...profitableSummary(1, exact("1")) };
      expect(Reflect.set(malformedSummary, summaryField, unauthenticExactRational())).toBe(true);
      expectCalculationError(
        () =>
          assessExactDeploymentReadiness(
            latencyStats(),
            latencyStats({ exchangeId: "bybit" }),
            malformedSummary,
            3_600_000_000_000n,
          ),
        "INVALID_EXACT_RATIONAL",
      );
    }
  });

  it("uses only valid P95 latency values and preserves the 99/100ms boundary", () => {
    const fastA = latencyStats({ rttP95Ms: 24, rttMedianMs: NaN });
    const fastB = latencyStats({ exchangeId: "bybit", rttP95Ms: 25, rttMedianMs: NaN });
    expect(estimateExactArbLatencyMs(fastA, fastB)).toBe(99n);
    expect(estimateExactArbLatencyMs(latencyStats({ rttP95Ms: 25 }), fastB)).toBe(100n);

    for (const invalidP95 of [NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => estimateExactArbLatencyMs(latencyStats({ rttP95Ms: invalidP95 }), fastB)).toThrow(
        ArbLatencyCalculationError,
      );
    }
  });

  it("summarizes exact values, empty inputs, and odd and even medians", () => {
    const summary = summarizeExactOpportunities([
      opportunity(1, "5", "-1", false),
      opportunity(2, "15", "1", true),
      opportunity(3, "25", "3", true),
    ]);
    expect(summary.totalSamples).toBe(3n);
    expect(summary.profitableCount).toBe(2n);
    expectExact(summary.profitableRate, "2", "3");
    expectExact(summary.medianSpreadBps, "15");
    expectExact(summary.maxSpreadBps, "25");
    expectExact(summary.totalTheoreticalPnlUsd, "4");
    expectExact(summary.averagePnlPerOpportunityUsd, "2");

    const evenSummary = summarizeExactOpportunities([
      opportunity(4, "20", "0", false),
      opportunity(5, "4", "0", false),
    ]);
    expectExact(evenSummary.medianSpreadBps, "12");
    expectExact(evenSummary.maxSpreadBps, "20");

    const emptySummary = summarizeExactOpportunities([]);
    expect(emptySummary.totalSamples).toBe(0n);
    expect(emptySummary.profitableCount).toBe(0n);
    expectExact(emptySummary.profitableRate, "0");
    expectExact(emptySummary.medianSpreadBps, "0");
    expectExact(emptySummary.maxSpreadBps, "0");
    expectExact(emptySummary.totalTheoreticalPnlUsd, "0");
    expectExact(emptySummary.averagePnlPerOpportunityUsd, "0");
  });

  it("rejects inconsistent opportunity states and unsafe timestamps", () => {
    expect(() => summarizeExactOpportunities([opportunity(1, "1", "0", true)])).toThrow(
      ArbLatencyCalculationError,
    );
    expect(() => summarizeExactOpportunities([opportunity(1, "1", "1", false)])).toThrow(
      ArbLatencyCalculationError,
    );
    expect(() => summarizeExactOpportunities([opportunity(1.5, "1", "0", false)])).toThrow(
      ArbLatencyCalculationError,
    );
  });

  it("uses the actual observed duration and exact PASS/PARTIAL/FAIL boundaries", () => {
    const fastA = latencyStats({ rttP95Ms: 24 });
    const fastB = latencyStats({ exchangeId: "bybit", rttP95Ms: 25 });
    const sixtySecondReadiness = assessExactDeploymentReadiness(
      fastA,
      fastB,
      profitableSummary(1, exact("3")),
      60_000_000_000n,
    );
    expect(sixtySecondReadiness.verdict).toBe("PASS");
    expectExact(sixtySecondReadiness.profitableOpportunitiesPerHour, "60");
    expectExact(sixtySecondReadiness.monthlyPnlEstimateUsd, "129600");
    expect(sixtySecondReadiness.reasoning).toBe(
      "latencyMs=99; profitableOpportunitiesPerHour=60; monthlyPnlEstimateUsd=129600.",
    );

    const monthlyExactlyOneThousand = assessExactDeploymentReadiness(
      fastA,
      fastB,
      profitableSummary(10, ExactRational.fromParts(5n, 36n)),
      3_600_000_000_000n,
    );
    expect(monthlyExactlyOneThousand.verdict).toBe("PARTIAL");
    expectExact(monthlyExactlyOneThousand.profitableOpportunitiesPerHour, "10");
    expectExact(monthlyExactlyOneThousand.monthlyPnlEstimateUsd, "1000");

    const monthlyAboveOneThousand = assessExactDeploymentReadiness(
      fastA,
      fastB,
      profitableSummary(10, ExactRational.fromParts(1n, 7n)),
      3_600_000_000_000n,
    );
    expect(monthlyAboveOneThousand.verdict).toBe("PASS");

    const onePerHour = assessExactDeploymentReadiness(
      fastA,
      fastB,
      profitableSummary(1, exact("1")),
      3_600_000_000_000n,
    );
    expect(onePerHour.verdict).toBe("PARTIAL");
    expectExact(onePerHour.profitableOpportunitiesPerHour, "1");

    const latencyAtOneHundredMs = assessExactDeploymentReadiness(
      latencyStats({ rttP95Ms: 25 }),
      fastB,
      profitableSummary(10, exact("1")),
      3_600_000_000_000n,
    );
    expect(latencyAtOneHundredMs.verdict).toBe("FAIL");
  });

  it("retains exact snapshots and rejects corrupted readiness summaries", () => {
    const source = exact("-7.25");
    const roundTripped = ExactRational.fromSnapshot(source.toSnapshot());
    expect(roundTripped.equals(source)).toBe(true);

    expect(() =>
      assessExactDeploymentReadiness(
        latencyStats(),
        latencyStats({ exchangeId: "bybit" }),
        summarizeExactOpportunities([]),
        0n,
      ),
    ).toThrow(ArbLatencyCalculationError);
    const emptyReadiness = assessExactDeploymentReadiness(
      latencyStats(),
      latencyStats({ exchangeId: "bybit" }),
      summarizeExactOpportunities([]),
      1n,
    );
    expect(emptyReadiness.verdict).toBe("FAIL");
    expectExact(emptyReadiness.averagePnlPerOpportunityUsd, "0");

    const allUnprofitableReadiness = assessExactDeploymentReadiness(
      latencyStats({ rttP95Ms: 24 }),
      latencyStats({ exchangeId: "bybit", rttP95Ms: 25 }),
      summarizeExactOpportunities([opportunity(1, "10", "0", false), opportunity(2, "20", "-1", false)]),
      3_600_000_000_000n,
    );
    expect(allUnprofitableReadiness.verdict).toBe("FAIL");
    expectExact(allUnprofitableReadiness.profitableOpportunitiesPerHour, "0");

    const validSummary = profitableSummary(1, exact("1"));
    const emptySummary = summarizeExactOpportunities([]);
    const corruptedSummaries: readonly ExactOpportunitySummary[] = [
      { ...emptySummary, profitableCount: 10n },
      { ...emptySummary, totalSamples: -1n },
      { ...validSummary, profitableCount: -1n },
      { ...validSummary, profitableRate: exact("0") },
      { ...validSummary, averagePnlPerOpportunityUsd: exact("0") },
      { ...emptySummary, totalTheoreticalPnlUsd: exact("1") },
      { ...emptySummary, medianSpreadBps: exact("1") },
      { ...validSummary, totalTheoreticalPnlUsd: exact("-1"), averagePnlPerOpportunityUsd: exact("-1") },
    ];
    for (const corruptedSummary of corruptedSummaries) {
      expect(() =>
        assessExactDeploymentReadiness(
          latencyStats({ rttP95Ms: 24 }),
          latencyStats({ exchangeId: "bybit", rttP95Ms: 25 }),
          corruptedSummary,
          3_600_000_000_000n,
        ),
      ).toThrow(ArbLatencyCalculationError);
    }
  });
});
