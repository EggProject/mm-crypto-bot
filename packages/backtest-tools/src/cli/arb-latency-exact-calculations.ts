import { ExactRational, type ExactRationalSnapshot } from "@mm-crypto-bot/numeric";

import type { LatencyStats, SupportedExchangeId } from "@mm-crypto-bot/exchange";

export type ArbLatencyCalculationErrorCode =
  | "DUPLICATE_EXCHANGE_ID"
  | "INCONSISTENT_OPPORTUNITY"
  | "INCONSISTENT_SUMMARY"
  | "INVALID_EXCHANGE_QUOTE"
  | "INVALID_LATENCY_P95"
  | "INVALID_NOTIONAL_USD"
  | "INVALID_OBSERVED_DURATION"
  | "INVALID_TIMESTAMP";

export class ArbLatencyCalculationError extends Error {
  public constructor(
    public readonly code: ArbLatencyCalculationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArbLatencyCalculationError";
  }
}

export interface ExactExchangeQuote {
  readonly id: SupportedExchangeId;
  readonly bid: ExactRational;
  readonly ask: ExactRational;
}

export interface ExactSpreadOpportunity {
  readonly timestamp: number;
  readonly exchangeA: ExactExchangeQuote;
  readonly exchangeB: ExactExchangeQuote;
  readonly crossSpreadBps: ExactRational;
  readonly profitableAfterLatency: boolean;
  readonly theoreticalPnlUsd: ExactRational;
}

export interface ExactOpportunitySummary {
  readonly totalSamples: bigint;
  readonly profitableCount: bigint;
  readonly profitableRate: ExactRational;
  readonly medianSpreadBps: ExactRational;
  readonly maxSpreadBps: ExactRational;
  readonly totalTheoreticalPnlUsd: ExactRational;
  readonly averagePnlPerOpportunityUsd: ExactRational;
}

export interface ExactDeploymentReadiness {
  readonly verdict: "PASS" | "PARTIAL" | "FAIL";
  readonly reasoning: string;
  readonly arbLatencyMs: bigint;
  readonly sub100msFeasible: boolean;
  readonly profitableOpportunitiesPerHour: ExactRational;
  readonly averagePnlPerOpportunityUsd: ExactRational;
  readonly monthlyPnlEstimateUsd: ExactRational;
}

export interface ExactDirectionalArbSpreads {
  readonly aSellBBuySpreadBps: ExactRational;
  readonly bSellABuySpreadBps: ExactRational;
  readonly maximumSpreadBps: ExactRational;
}

const EXACT_ZERO = ExactRational.from(0n);
const EXACT_ONE = ExactRational.from(1n);
const BPS_PER_UNIT = ExactRational.from(10_000n);
const MILLISECONDS_PER_SECOND = ExactRational.from(1000n);
const LATENCY_OVERHEAD_MS = 50n;
const HOURS_PER_MONTH = ExactRational.from(720n);
const NANOSECONDS_PER_HOUR = ExactRational.from(3_600_000_000_000n);
const LATENCY_COST_RATE_PER_SECOND = ExactRational.from("0.001");
const SUB_100_MS_THRESHOLD = 100n;
const PASS_OPPORTUNITIES_PER_HOUR = ExactRational.from(10n);
const PARTIAL_OPPORTUNITIES_PER_HOUR = EXACT_ONE;
const PASS_MONTHLY_PNL_USD = ExactRational.from(1000n);

function requireSafeNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ArbLatencyCalculationError(
      "INVALID_LATENCY_P95",
      `${fieldName} must be a finite, nonnegative safe integer millisecond value.`,
    );
  }
}

function requirePositiveDuration(durationNs: bigint): void {
  if (durationNs <= 0n) {
    throw new ArbLatencyCalculationError(
      "INVALID_OBSERVED_DURATION",
      "observedDurationNs must be a positive monotonic duration in nanoseconds.",
    );
  }
}

function requirePositiveNotionalUsd(notionalUsd: ExactRational): void {
  if (notionalUsd.compare(EXACT_ZERO) <= 0) {
    throw new ArbLatencyCalculationError("INVALID_NOTIONAL_USD", "notionalUsd must be strictly positive.");
  }
}

function requireValidExactExchangeQuote(exchangeQuote: ExactExchangeQuote, quoteName: string): void {
  if (!(exchangeQuote.bid instanceof ExactRational) || !(exchangeQuote.ask instanceof ExactRational)) {
    throw new ArbLatencyCalculationError(
      "INVALID_EXCHANGE_QUOTE",
      `${quoteName} bid and ask must be ExactRational values.`,
    );
  }

  if (exchangeQuote.bid.compare(EXACT_ZERO) <= 0 || exchangeQuote.ask.compare(EXACT_ZERO) <= 0) {
    throw new ArbLatencyCalculationError(
      "INVALID_EXCHANGE_QUOTE",
      `${quoteName} bid and ask must both be strictly positive.`,
    );
  }

  if (exchangeQuote.bid.compare(exchangeQuote.ask) > 0) {
    throw new ArbLatencyCalculationError("INVALID_EXCHANGE_QUOTE", `${quoteName} bid must not exceed ask.`);
  }
}

function requireOpportunityConsistency(opportunity: ExactSpreadOpportunity): void {
  if (!Number.isSafeInteger(opportunity.timestamp)) {
    throw new ArbLatencyCalculationError(
      "INVALID_TIMESTAMP",
      "Opportunity timestamp must be a safe integer epoch value.",
    );
  }

  const isPnlPositive = opportunity.theoreticalPnlUsd.compare(EXACT_ZERO) > 0;
  if (opportunity.profitableAfterLatency !== isPnlPositive) {
    throw new ArbLatencyCalculationError(
      "INCONSISTENT_OPPORTUNITY",
      "Opportunity profitability must exactly match a positive theoretical PnL.",
    );
  }
}

function findExactInsertionIndex(sortedValues: readonly ExactRational[], value: ExactRational): number {
  for (const [index, candidate] of sortedValues.entries()) {
    if (value.compare(candidate) < 0) {
      return index;
    }
  }
  return sortedValues.length;
}

function exactMedian(values: readonly ExactRational[]): ExactRational {
  if (values.length === 0) {
    return EXACT_ZERO;
  }

  const sorted: ExactRational[] = [];
  for (const value of values) {
    const insertionIndex = findExactInsertionIndex(sorted, value);
    sorted.splice(insertionIndex, 0, value);
  }
  const middleIndex = Math.floor(sorted.length / 2);
  let lowerMiddle = EXACT_ZERO;
  let upperMiddle = EXACT_ZERO;
  for (const [index, value] of sorted.entries()) {
    if (index === middleIndex) {
      upperMiddle = value;
    }
    if (index === middleIndex - 1) {
      lowerMiddle = value;
    }
  }

  return sorted.length % 2 === 1 ? upperMiddle : lowerMiddle.add(upperMiddle).divide(ExactRational.from(2n));
}

function exactMaximum(values: readonly ExactRational[]): ExactRational {
  let maximum = EXACT_ZERO;
  let isFirstValue = true;
  for (const value of values) {
    if (!isFirstValue && value.compare(maximum) <= 0) {
      continue;
    }
    maximum = value;
    isFirstValue = false;
  }
  return maximum;
}

function exactText(value: ExactRational): string {
  const snapshot: ExactRationalSnapshot = value.toSnapshot();
  return snapshot.denominator === "1" ? snapshot.numerator : `${snapshot.numerator}/${snapshot.denominator}`;
}

function requireConsistentOpportunitySummary(opportunitySummary: ExactOpportunitySummary): void {
  if (opportunitySummary.totalSamples < 0n) {
    throw new ArbLatencyCalculationError("INCONSISTENT_SUMMARY", "totalSamples must be nonnegative.");
  }
  if (opportunitySummary.profitableCount < 0n) {
    throw new ArbLatencyCalculationError("INCONSISTENT_SUMMARY", "profitableCount must be nonnegative.");
  }
  if (opportunitySummary.profitableCount > opportunitySummary.totalSamples) {
    throw new ArbLatencyCalculationError(
      "INCONSISTENT_SUMMARY",
      "profitableCount must not exceed totalSamples.",
    );
  }

  const expectedProfitableRate =
    opportunitySummary.totalSamples === 0n
      ? EXACT_ZERO
      : ExactRational.from(opportunitySummary.profitableCount).divide(
          ExactRational.from(opportunitySummary.totalSamples),
        );
  if (!opportunitySummary.profitableRate.equals(expectedProfitableRate)) {
    throw new ArbLatencyCalculationError(
      "INCONSISTENT_SUMMARY",
      "profitableRate must exactly equal profitableCount divided by totalSamples.",
    );
  }

  const expectedAveragePnlPerOpportunityUsd =
    opportunitySummary.profitableCount === 0n
      ? EXACT_ZERO
      : opportunitySummary.totalTheoreticalPnlUsd.divide(
          ExactRational.from(opportunitySummary.profitableCount),
        );
  if (!opportunitySummary.averagePnlPerOpportunityUsd.equals(expectedAveragePnlPerOpportunityUsd)) {
    throw new ArbLatencyCalculationError(
      "INCONSISTENT_SUMMARY",
      "averagePnlPerOpportunityUsd must exactly equal total PnL divided by profitableCount.",
    );
  }

  if (opportunitySummary.profitableCount === 0n) {
    if (!opportunitySummary.totalTheoreticalPnlUsd.isZero()) {
      throw new ArbLatencyCalculationError(
        "INCONSISTENT_SUMMARY",
        "totalTheoreticalPnlUsd must be zero when profitableCount is zero.",
      );
    }
    if (
      opportunitySummary.totalSamples === 0n &&
      (!opportunitySummary.medianSpreadBps.isZero() || !opportunitySummary.maxSpreadBps.isZero())
    ) {
      throw new ArbLatencyCalculationError(
        "INCONSISTENT_SUMMARY",
        "Empty summaries must have zero medianSpreadBps and maxSpreadBps.",
      );
    }
    return;
  }

  if (opportunitySummary.totalTheoreticalPnlUsd.compare(EXACT_ZERO) <= 0) {
    throw new ArbLatencyCalculationError(
      "INCONSISTENT_SUMMARY",
      "totalTheoreticalPnlUsd must be strictly positive when profitableCount is positive.",
    );
  }
}

export function estimateExactArbLatencyMs(statsA: LatencyStats, statsB: LatencyStats): bigint {
  requireSafeNonNegativeInteger(statsA.rttP95Ms, "statsA.rttP95Ms");
  requireSafeNonNegativeInteger(statsB.rttP95Ms, "statsB.rttP95Ms");
  return BigInt(statsA.rttP95Ms) + BigInt(statsB.rttP95Ms) + LATENCY_OVERHEAD_MS;
}

/**
 * Calculates both directional cross-exchange spreads with the established asymmetric denominator.
 */
export function calculateExactDirectionalArbSpreads(
  exchangeA: ExactExchangeQuote,
  exchangeB: ExactExchangeQuote,
): ExactDirectionalArbSpreads {
  if (exchangeA.id === exchangeB.id) {
    throw new ArbLatencyCalculationError(
      "DUPLICATE_EXCHANGE_ID",
      "Directional arbitrage spreads require distinct exchange identifiers.",
    );
  }
  requireValidExactExchangeQuote(exchangeA, "exchangeA");
  requireValidExactExchangeQuote(exchangeB, "exchangeB");

  const establishedDenominator = exchangeA.bid.add(exchangeB.ask).divide(ExactRational.from(2n));
  const aSellBBuySpreadBps = exchangeA.bid
    .subtract(exchangeB.ask)
    .divide(establishedDenominator)
    .multiply(BPS_PER_UNIT);
  const bSellABuySpreadBps = exchangeB.bid
    .subtract(exchangeA.ask)
    .divide(establishedDenominator)
    .multiply(BPS_PER_UNIT);

  return Object.freeze({
    aSellBBuySpreadBps,
    bSellABuySpreadBps,
    maximumSpreadBps:
      aSellBBuySpreadBps.compare(bSellABuySpreadBps) >= 0 ? aSellBBuySpreadBps : bSellABuySpreadBps,
  });
}

export function calculateExactOpportunityPnlUsd(
  spreadBps: ExactRational,
  notionalUsd: ExactRational,
  latencyMs: bigint,
): ExactRational {
  if (latencyMs < 0n) {
    throw new ArbLatencyCalculationError("INVALID_LATENCY_P95", "latencyMs must be nonnegative.");
  }
  requirePositiveNotionalUsd(notionalUsd);

  const grossPnlUsd = spreadBps.divide(BPS_PER_UNIT).multiply(notionalUsd).multiply(ExactRational.from(2n));
  const latencyCostUsd = ExactRational.from(latencyMs)
    .divide(MILLISECONDS_PER_SECOND)
    .multiply(LATENCY_COST_RATE_PER_SECOND)
    .multiply(notionalUsd);
  return grossPnlUsd.subtract(latencyCostUsd);
}

export function isExactOpportunityProfitable(
  spreadBps: ExactRational,
  notionalUsd: ExactRational,
  latencyMs: bigint,
): boolean {
  return calculateExactOpportunityPnlUsd(spreadBps, notionalUsd, latencyMs).compare(EXACT_ZERO) > 0;
}

export function summarizeExactOpportunities(
  opportunities: readonly ExactSpreadOpportunity[],
): ExactOpportunitySummary {
  let profitableCount = 0n;
  let totalTheoreticalPnlUsd = EXACT_ZERO;
  const spreadsBps: ExactRational[] = [];

  for (const opportunity of opportunities) {
    requireOpportunityConsistency(opportunity);
    spreadsBps.push(opportunity.crossSpreadBps);
    if (opportunity.profitableAfterLatency) {
      profitableCount += 1n;
      totalTheoreticalPnlUsd = totalTheoreticalPnlUsd.add(opportunity.theoreticalPnlUsd);
    }
  }

  const totalSamples = BigInt(opportunities.length);
  return Object.freeze({
    totalSamples,
    profitableCount,
    profitableRate:
      totalSamples === 0n
        ? EXACT_ZERO
        : ExactRational.from(profitableCount).divide(ExactRational.from(totalSamples)),
    medianSpreadBps: exactMedian(spreadsBps),
    maxSpreadBps: exactMaximum(spreadsBps),
    totalTheoreticalPnlUsd,
    averagePnlPerOpportunityUsd:
      profitableCount === 0n
        ? EXACT_ZERO
        : totalTheoreticalPnlUsd.divide(ExactRational.from(profitableCount)),
  });
}

export function assessExactDeploymentReadiness(
  statsA: LatencyStats,
  statsB: LatencyStats,
  opportunitySummary: ExactOpportunitySummary,
  observedDurationNs: bigint,
): ExactDeploymentReadiness {
  requirePositiveDuration(observedDurationNs);
  requireConsistentOpportunitySummary(opportunitySummary);
  const arbLatencyMs = estimateExactArbLatencyMs(statsA, statsB);
  const profitableOpportunitiesPerHour = ExactRational.from(opportunitySummary.profitableCount)
    .multiply(NANOSECONDS_PER_HOUR)
    .divide(ExactRational.from(observedDurationNs));
  const averagePnlPerOpportunityUsd =
    opportunitySummary.profitableCount === 0n
      ? EXACT_ZERO
      : opportunitySummary.totalTheoreticalPnlUsd.divide(
          ExactRational.from(opportunitySummary.profitableCount),
        );
  const monthlyPnlEstimateUsd = profitableOpportunitiesPerHour
    .multiply(HOURS_PER_MONTH)
    .multiply(averagePnlPerOpportunityUsd);
  const isSub100msFeasible = arbLatencyMs < SUB_100_MS_THRESHOLD;
  const verdict =
    isSub100msFeasible &&
    profitableOpportunitiesPerHour.compare(PASS_OPPORTUNITIES_PER_HOUR) >= 0 &&
    monthlyPnlEstimateUsd.compare(PASS_MONTHLY_PNL_USD) > 0
      ? "PASS"
      : isSub100msFeasible && profitableOpportunitiesPerHour.compare(PARTIAL_OPPORTUNITIES_PER_HOUR) >= 0
        ? "PARTIAL"
        : "FAIL";

  return Object.freeze({
    verdict,
    reasoning: `latencyMs=${arbLatencyMs.toString()}; profitableOpportunitiesPerHour=${exactText(profitableOpportunitiesPerHour)}; monthlyPnlEstimateUsd=${exactText(monthlyPnlEstimateUsd)}.`,
    arbLatencyMs,
    sub100msFeasible: isSub100msFeasible,
    profitableOpportunitiesPerHour,
    averagePnlPerOpportunityUsd,
    monthlyPnlEstimateUsd,
  });
}
