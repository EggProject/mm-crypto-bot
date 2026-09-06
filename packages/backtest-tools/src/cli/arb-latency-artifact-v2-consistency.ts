import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  calculateExactDirectionalArbSpreads,
  calculateExactOpportunityPnlUsd,
  type ExactExchangeQuote,
  type ExactSpreadOpportunity,
} from "./arb-latency-exact-calculations.js";
import type { ExactArbLatencySpreadSample } from "./arb-latency-exact-collector.js";
import type { SupportedExchangeId } from "@mm-crypto-bot/exchange";

export type ArbLatencyArtifactConsistencyErrorCode = "INCONSISTENT_COLLECTION" | "INCONSISTENT_OPPORTUNITY";

export class ArbLatencyArtifactConsistencyError extends Error {
  public constructor(
    public readonly code: ArbLatencyArtifactConsistencyErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArbLatencyArtifactConsistencyError";
  }
}

export interface ExactArtifactConsistencyInput {
  readonly collectionOpportunities: readonly ExactSpreadOpportunity[];
  readonly exchangeA: SupportedExchangeId;
  readonly exchangeB: SupportedExchangeId;
  readonly latencyMs: bigint;
  readonly minSpreadBps: ExactRational;
  readonly opportunities: readonly ExactSpreadOpportunity[];
  readonly samples: readonly ExactArbLatencySpreadSample[];
  readonly tradeNotionalUsd: ExactRational;
}

function fail(code: ArbLatencyArtifactConsistencyErrorCode, message: string, cause?: unknown): never {
  throw new ArbLatencyArtifactConsistencyError(code, message, cause);
}

function isEqualExactRational(left: ExactRational, right: ExactRational): boolean {
  if (!(left instanceof ExactRational) || !(right instanceof ExactRational)) {
    fail("INCONSISTENT_COLLECTION", "Expected exact rational value.");
  }
  return left.equals(right);
}

function requireSampleQuote(
  quote: ExactExchangeQuote,
  expectedExchange: SupportedExchangeId,
): ExactExchangeQuote {
  if (quote.id !== expectedExchange) {
    fail("INCONSISTENT_COLLECTION", "Sample quote exchange differs from configured exchange.");
  }
  return quote;
}

function isEqualQuote(left: ExactExchangeQuote, right: ExactExchangeQuote): boolean {
  return (
    left.id === right.id &&
    isEqualExactRational(left.bid, right.bid) &&
    isEqualExactRational(left.ask, right.ask)
  );
}

function isNotExactlyFalse(value: unknown): boolean {
  return value !== false;
}

function requireSampleConsistency(
  sample: ExactArbLatencySpreadSample,
  exchangeA: SupportedExchangeId,
  exchangeB: SupportedExchangeId,
): void {
  const sampleExchangeA = requireSampleQuote(sample.exchangeA, exchangeA);
  const sampleExchangeB = requireSampleQuote(sample.exchangeB, exchangeB);
  try {
    const expected = calculateExactDirectionalArbSpreads(sampleExchangeA, sampleExchangeB);
    if (
      !isEqualExactRational(sample.aSellBBuySpreadBps, expected.aSellBBuySpreadBps) ||
      !isEqualExactRational(sample.bSellABuySpreadBps, expected.bSellABuySpreadBps) ||
      !isEqualExactRational(sample.maximumSpreadBps, expected.maximumSpreadBps)
    ) {
      fail("INCONSISTENT_COLLECTION", "Sample directional spreads are not exact quote derivatives.");
    }
  } catch (error: unknown) {
    if (error instanceof ArbLatencyArtifactConsistencyError) throw error;
    fail("INCONSISTENT_COLLECTION", "Sample quote is invalid.", error);
  }
}

function requireOpportunityQuoteConsistency(
  opportunity: ExactSpreadOpportunity,
  sample: ExactArbLatencySpreadSample,
): void {
  if (
    opportunity.timestamp !== sample.timestamp ||
    !isEqualQuote(opportunity.exchangeA, sample.exchangeA) ||
    !isEqualQuote(opportunity.exchangeB, sample.exchangeB) ||
    !isEqualExactRational(opportunity.crossSpreadBps, sample.maximumSpreadBps)
  ) {
    fail("INCONSISTENT_OPPORTUNITY", "Opportunity does not exactly match its source sample.");
  }
}

export function requireExactArtifactConsistency(input: ExactArtifactConsistencyInput): void {
  const candidates: ExactArbLatencySpreadSample[] = [];
  for (const sample of input.samples) {
    requireSampleConsistency(sample, input.exchangeA, input.exchangeB);
    if (sample.maximumSpreadBps.compare(input.minSpreadBps) >= 0) candidates.push(sample);
  }
  if (
    candidates.length !== input.collectionOpportunities.length ||
    candidates.length !== input.opportunities.length
  ) {
    fail("INCONSISTENT_COLLECTION", "Every qualifying opportunity must be retained.");
  }
  for (const [index, opportunity] of input.opportunities.entries()) {
    const sample = candidates.at(index);
    const provisional = input.collectionOpportunities.at(index);
    if (sample === undefined || provisional === undefined) {
      fail("INCONSISTENT_OPPORTUNITY", "Opportunity collection is inconsistent.");
    }
    requireOpportunityQuoteConsistency(provisional, sample);
    requireOpportunityQuoteConsistency(opportunity, sample);
    if (isNotExactlyFalse(provisional.profitableAfterLatency) || !provisional.theoreticalPnlUsd.isZero()) {
      fail("INCONSISTENT_OPPORTUNITY", "Provisional opportunity must remain zero and unprofitable.");
    }
    const expectedPnl = calculateExactOpportunityPnlUsd(
      opportunity.crossSpreadBps,
      input.tradeNotionalUsd,
      input.latencyMs,
    );
    if (
      !isEqualExactRational(opportunity.theoreticalPnlUsd, expectedPnl) ||
      opportunity.profitableAfterLatency !== expectedPnl.compare(ExactRational.from(0n)) > 0
    ) {
      fail("INCONSISTENT_OPPORTUNITY", "Opportunity was not latency-recomputed.");
    }
  }
}
