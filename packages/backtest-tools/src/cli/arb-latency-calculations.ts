import { round2, type LatencyStats, type SupportedExchangeId } from "@mm-crypto-bot/exchange";

export interface SpreadOpportunity {
  readonly timestamp: number;
  readonly exchangeA: { readonly id: SupportedExchangeId; readonly bid: number; readonly ask: number };
  readonly exchangeB: { readonly id: SupportedExchangeId; readonly bid: number; readonly ask: number };
  readonly crossSpreadBps: number;
  readonly profitableAfterLatency: boolean;
  readonly theoreticalPnlUsd: number;
}

export function estimateArbLatencyMs(statsA: LatencyStats, statsB: LatencyStats): number {
  const rttA = Number.isFinite(statsA.rttP95Ms) ? statsA.rttP95Ms : statsA.rttMedianMs;
  const rttB = Number.isFinite(statsB.rttP95Ms) ? statsB.rttP95Ms : statsB.rttMedianMs;
  return (Number.isFinite(rttA) ? rttA : 200) + (Number.isFinite(rttB) ? rttB : 200) + 50;
}

export function summarizeOpportunities(opportunities: readonly SpreadOpportunity[]) {
  const profitable = opportunities.filter((opportunity) => opportunity.profitableAfterLatency);
  const spreadsBps = opportunities.map((opportunity) => opportunity.crossSpreadBps);
  return {
    totalSamples: opportunities.length,
    profitableCount: profitable.length,
    profitableRate: opportunities.length > 0 ? profitable.length / opportunities.length : NaN,
    medianSpreadBps: round2(sortMedian(spreadsBps)),
    maxSpreadBps: spreadsBps.length > 0 ? round2(Math.max(...spreadsBps)) : NaN,
    totalTheoreticalPnlUsd: round2(
      profitable.reduce((accumulator, opportunity) => accumulator + opportunity.theoreticalPnlUsd, 0),
    ),
    averagePnlPerOpportunityUsd:
      profitable.length > 0
        ? round2(
            profitable.reduce((accumulator, opportunity) => accumulator + opportunity.theoreticalPnlUsd, 0) /
              profitable.length,
          )
        : NaN,
  };
}

export function assessDeploymentReadiness(
  statsA: LatencyStats,
  statsB: LatencyStats,
  opportunitySummary: {
    readonly profitableRate: number;
    readonly medianSpreadBps: number;
    readonly totalTheoreticalPnlUsd: number;
    readonly profitableCount: number;
    readonly totalSamples: number;
  },
): {
  readonly verdict: "PASS" | "PARTIAL" | "FAIL";
  readonly reasoning: string;
  readonly sub100msFeasible: boolean;
  readonly profitableOpportunitiesPerHour: number;
  readonly monthlyPnlEstimateUsd: number;
} {
  const arbLatencyMs = estimateArbLatencyMs(statsA, statsB);
  const isSub100msFeasible = arbLatencyMs < 100;
  const measurementDurationMs = 30_000;
  const opportunitiesPerHour = (opportunitySummary.profitableRate / measurementDurationMs) * 3_600_000;
  const averagePnlPerOpportunityUsd =
    opportunitySummary.profitableRate > 0
      ? opportunitySummary.totalTheoreticalPnlUsd / Math.max(1, opportunitySummary.profitableCount)
      : 0;
  const monthlyPnlEstimateUsd = opportunitiesPerHour * 24 * 30 * Math.max(averagePnlPerOpportunityUsd, 0);

  if (isSub100msFeasible && opportunitiesPerHour >= 10 && monthlyPnlEstimateUsd > 1000) {
    return {
      verdict: "PASS",
      reasoning: `Sub-100ms arb latency (${String(round2(arbLatencyMs))}ms p95 round-trip), elegendő spread opportunity (${String(round2(opportunitiesPerHour))}/óra), pozitív havi PnL becslés ($${String(round2(monthlyPnlEstimateUsd))}).`,
      sub100msFeasible: isSub100msFeasible,
      profitableOpportunitiesPerHour: round2(opportunitiesPerHour),
      monthlyPnlEstimateUsd: round2(monthlyPnlEstimateUsd),
    };
  }
  if (isSub100msFeasible && opportunitiesPerHour >= 1) {
    return {
      verdict: "PARTIAL",
      reasoning: `Sub-100ms latency megvan (${String(round2(arbLatencyMs))}ms), DE a spread opportunity rate alacsony (${String(round2(opportunitiesPerHour))}/óra). Phase 7+-ban nagyobb volume vagy más spread threshold szükséges.`,
      sub100msFeasible: isSub100msFeasible,
      profitableOpportunitiesPerHour: round2(opportunitiesPerHour),
      monthlyPnlEstimateUsd: round2(monthlyPnlEstimateUsd),
    };
  }
  return {
    verdict: "FAIL",
    reasoning: isSub100msFeasible
      ? `A spread opportunity rate közel nulla (${String(round2(opportunitiesPerHour))}/óra), a két exchange árai túl szinkronban mozognak a jelenlegi piaci körülmények között.`
      : `Az arb round-trip latency (${String(round2(arbLatencyMs))}ms) meghaladja a sub-100ms threshold-ot. Phase 7+ infra upgrade szükséges (co-location, dedicated WS endpoint).`,
    sub100msFeasible: isSub100msFeasible,
    profitableOpportunitiesPerHour: round2(opportunitiesPerHour),
    monthlyPnlEstimateUsd: round2(monthlyPnlEstimateUsd),
  };
}

export function roundStatsForJson(stats: LatencyStats): Record<string, unknown> {
  const jsonNull: unknown = JSON.parse("null");
  return Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [
      key,
      typeof value === "number" && !Number.isFinite(value)
        ? jsonNull
        : typeof value === "number"
          ? round2(value)
          : value,
    ]),
  );
}

function sortMedian(values: readonly number[]): number {
  const sorted: number[] = [];
  for (const value of values) {
    const insertionIndex = sorted.findIndex((candidate) => value < candidate);
    if (insertionIndex === -1) sorted.push(value);
    else sorted.splice(insertionIndex, 0, value);
  }
  const middle = Math.floor(sorted.length / 2);
  let oddMedian = NaN;
  for (const [index, value] of sorted.entries()) {
    if (index === middle) oddMedian = value;
  }
  return sorted.length % 2 === 0
    ? ((sorted.at(middle - 1) ?? NaN) + (sorted.at(middle) ?? NaN)) / 2
    : oddMedian;
}
