import type { FundingSnapshot } from "@mm-crypto-bot/core";
import { canonicalizeExternalDecimal, ExactRational } from "@mm-crypto-bot/numeric";

import type { DydxHourlyFunding } from "../data/tardis-dydx-funding.js";

const ZERO = ExactRational.from("0");
const EIGHT = ExactRational.from("8");
const TEN_THOUSAND = ExactRational.from("10000");
const DRIFT_SENSITIVITY = ExactRational.from("0.01");
const REBALANCE_THRESHOLD = ExactRational.from("0.05");
const COMPRESSION_THRESHOLD = ExactRational.from("0.0005");

interface CarryPoint {
  readonly timestamp: number;
  readonly equity: ExactRational;
  readonly fundingAccruedUsd: ExactRational;
  readonly dydx8hEquivRate: ExactRational | undefined;
  readonly cex8hRate: ExactRational | undefined;
  readonly divergence: ExactRational | undefined;
}

export interface CarryResult {
  readonly totalReturn: ExactRational;
  readonly annualizedReturn: undefined;
  readonly monthlyCarry: undefined;
  readonly averageDivergence: ExactRational;
  readonly medianRebalanceHours: ExactRational;
  readonly maxDrawdown: ExactRational;
  readonly sharpeRatio: undefined;
  readonly winRate: ExactRational;
  readonly fundingCollectedUsd: ExactRational;
  readonly rebalanceCount: number;
  readonly rebalanceCostUsd: ExactRational;
  readonly fundingPeriods: number;
  readonly avgDydx8hEquiv: ExactRational;
  readonly avgCex8h: ExactRational;
  readonly medianDydx8hEquiv: ExactRational;
  readonly medianCex8h: ExactRational;
  readonly meanReversionHalfLifeHours: undefined;
  readonly killSwitch7DayCompressionTriggered: boolean;
  readonly compressedDivergenceDays: number;
  readonly dataSufficientDays: number;
  readonly equityCurve: readonly CarryPoint[];
  readonly startTime: number;
  readonly endTime: number;
}

interface FundingEvent {
  readonly timestamp: number;
  readonly dydxRate: ExactRational | undefined;
  readonly cexRate: ExactRational | undefined;
}

interface DayBucket {
  readonly date: string;
  totalCarryUsd: ExactRational;
  readonly divergenceSamples: ExactRational[];
  dydxObsCount: number;
}

function configExact(value: string, name: string): ExactRational {
  try {
    const canonical = canonicalizeExternalDecimal(value);
    const parsed = ExactRational.from(canonical);
    if (parsed.compare(ZERO) <= 0) throw new Error(`${name} must be a canonical positive decimal`);
    return parsed;
  } catch {
    throw new Error(`${name} must be a canonical positive decimal`);
  }
}

function average(values: readonly ExactRational[]): ExactRational {
  if (values.length === 0) return ZERO;
  let total = ZERO;
  for (const value of values) total = total.add(value);
  return total.divide(ExactRational.from(String(values.length)));
}

function orderedExact(values: readonly ExactRational[]): readonly ExactRational[] {
  const ordered: ExactRational[] = [];
  for (const value of values) {
    const insertionIndex = ordered.findIndex((candidate) => candidate.compare(value) > 0);
    if (insertionIndex === -1) ordered.push(value);
    else ordered.splice(insertionIndex, 0, value);
  }
  return ordered;
}

function median(values: readonly ExactRational[]): ExactRational {
  if (values.length === 0) return ZERO;
  const sorted = orderedExact(values);
  const rightIndex = Math.floor(sorted.length / 2);
  let previous = ZERO;
  let right = ZERO;
  for (const [index, value] of sorted.entries()) {
    if (index === rightIndex - 1) previous = value;
    if (index === rightIndex) right = value;
  }
  return sorted.length % 2 === 0 ? previous.add(right).divide(ExactRational.from("2")) : right;
}

function orderedFunding<T extends { readonly fundingTime: number }>(values: readonly T[]): readonly T[] {
  const ordered: T[] = [];
  for (const value of values) {
    const insertionIndex = ordered.findIndex((candidate) => candidate.fundingTime > value.fundingTime);
    if (insertionIndex === -1) ordered.push(value);
    else ordered.splice(insertionIndex, 0, value);
  }
  return ordered;
}

function fundingEvents(
  dydxHourly: readonly DydxHourlyFunding[],
  cex8h: readonly FundingSnapshot[],
): readonly FundingEvent[] {
  const dydx = orderedFunding(dydxHourly);
  const cex = orderedFunding(cex8h);
  const events: FundingEvent[] = [];
  let dydxIndex = 0;
  let cexIndex = 0;
  while (dydxIndex < dydx.length || cexIndex < cex.length) {
    const dydxSnapshot = dydx.at(dydxIndex);
    const cexSnapshot = cex.at(cexIndex);
    const dydxTime = dydxSnapshot?.fundingTime ?? Infinity;
    const cexTime = cexSnapshot?.fundingTime ?? Infinity;
    if (dydxTime <= cexTime) {
      events.push({
        timestamp: dydxTime,
        dydxRate: dydxSnapshot?.fundingRate,
        cexRate: cexTime === dydxTime ? cexSnapshot?.fundingRate : undefined,
      });
      dydxIndex += 1;
      if (cexTime === dydxTime) cexIndex += 1;
    } else {
      events.push({ timestamp: cexTime, dydxRate: undefined, cexRate: cexSnapshot?.fundingRate });
      cexIndex += 1;
    }
  }
  return events;
}

export function simulateDydxVsCexCarry(options: {
  readonly dydxHourly: readonly DydxHourlyFunding[];
  readonly cex8h: readonly FundingSnapshot[];
  readonly startTime: number;
  readonly endTime: number;
  readonly initialEquity: string;
  readonly targetNotionalUsd: string;
  readonly rebalanceCostBps: string;
  readonly withdrawalLatencyMinutes: string;
  readonly normalizedMetricsAllowed?: boolean;
}): CarryResult {
  if (options.normalizedMetricsAllowed === false)
    throw new Error("Normalized carry metrics require sufficient dYdX coverage");
  const initialEquity = configExact(options.initialEquity, "initialEquity");
  const notional = configExact(options.targetNotionalUsd, "targetNotionalUsd");
  const rebalanceBps = configExact(options.rebalanceCostBps, "rebalanceCostBps");
  const latencyMinutes = configExact(options.withdrawalLatencyMinutes, "withdrawalLatencyMinutes");
  let fundingCollectedUsd = ZERO;
  let rebalanceCostUsd = ZERO;
  let cumulativeFundingUsd = ZERO;
  let rebalanceCount = 0;
  let fundingPeriods = 0;
  let wins = 0;
  let losses = 0;
  let peak = initialEquity;
  let maxDrawdown = ZERO;
  const equityCurve: CarryPoint[] = [];
  const divergenceSeries: ExactRational[] = [];
  const dydxRates: ExactRational[] = [];
  const cexRates: ExactRational[] = [];
  const days = new Map<string, DayBucket>();
  for (const event of fundingEvents(options.dydxHourly, options.cex8h)) {
    let eventFundingUsd = ZERO;
    if (event.dydxRate !== undefined) {
      const payment = notional.multiply(event.dydxRate).negate();
      fundingCollectedUsd = fundingCollectedUsd.add(payment);
      cumulativeFundingUsd = cumulativeFundingUsd.add(payment);
      eventFundingUsd = eventFundingUsd.add(payment);
      fundingPeriods += 1;
      dydxRates.push(event.dydxRate);
      if (payment.isNegative()) losses += 1;
      else wins += 1;
    }
    if (event.cexRate !== undefined) {
      const payment = notional.multiply(event.cexRate);
      fundingCollectedUsd = fundingCollectedUsd.add(payment);
      cumulativeFundingUsd = cumulativeFundingUsd.add(payment);
      eventFundingUsd = eventFundingUsd.add(payment);
      fundingPeriods += 1;
      cexRates.push(event.cexRate);
      if (payment.isNegative()) losses += 1;
      else wins += 1;
    }
    const dydx8hEquivRate = event.dydxRate?.multiply(EIGHT);
    const divergence =
      dydx8hEquivRate === undefined || event.cexRate === undefined
        ? undefined
        : dydx8hEquivRate.subtract(event.cexRate);
    if (divergence !== undefined) divergenceSeries.push(divergence);
    if (
      cumulativeFundingUsd.multiply(DRIFT_SENSITIVITY).abs().divide(notional).compare(REBALANCE_THRESHOLD) >=
      0
    ) {
      const fee = rebalanceBps.divide(TEN_THOUSAND).multiply(notional);
      const latencyCost = notional
        .multiply(ExactRational.from("0.0001"))
        .multiply(latencyMinutes.divide(ExactRational.from("60")));
      rebalanceCostUsd = rebalanceCostUsd.add(fee).add(latencyCost);
      cumulativeFundingUsd = ZERO;
      rebalanceCount += 1;
    }
    const date = new Date(event.timestamp).toISOString().slice(0, 10);
    const day = days.get(date) ?? { date, totalCarryUsd: ZERO, divergenceSamples: [], dydxObsCount: 0 };
    day.totalCarryUsd = day.totalCarryUsd.add(eventFundingUsd);
    if (event.dydxRate !== undefined) day.dydxObsCount += 1;
    if (divergence !== undefined) day.divergenceSamples.push(divergence);
    days.set(date, day);
    const equity = initialEquity.add(fundingCollectedUsd).subtract(rebalanceCostUsd);
    if (equity.compare(peak) > 0) peak = equity;
    const drawdown = peak.subtract(equity).divide(peak);
    if (drawdown.compare(maxDrawdown) > 0) maxDrawdown = drawdown;
    equityCurve.push({
      timestamp: event.timestamp,
      equity,
      fundingAccruedUsd: fundingCollectedUsd,
      dydx8hEquivRate,
      cex8hRate: event.cexRate,
      divergence,
    });
  }
  const buckets: DayBucket[] = [];
  days.forEach((bucket) => {
    buckets.push(bucket);
  });
  const compressed = buckets.map(
    (day) =>
      day.dydxObsCount > 0 &&
      day.divergenceSamples.length > 0 &&
      median(day.divergenceSamples).abs().compare(COMPRESSION_THRESHOLD) < 0,
  );
  let currentRun = 0;
  let longestRun = 0;
  let compressedDays = 0;
  for (const isValue of compressed) {
    if (isValue) {
      currentRun += 1;
      compressedDays += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else currentRun = 0;
  }
  const gaps: ExactRational[] = [];
  let previousBucket: DayBucket | undefined;
  for (const bucket of buckets) {
    if (previousBucket !== undefined) {
      const elapsedHours = (Date.parse(bucket.date) - Date.parse(previousBucket.date)) / 3_600_000;
      gaps.push(ExactRational.from(String(elapsedHours)));
    }
    previousBucket = bucket;
  }
  const dydx8h = dydxRates.map((rate) => rate.multiply(EIGHT));
  return {
    totalReturn: fundingCollectedUsd.subtract(rebalanceCostUsd).divide(initialEquity),
    annualizedReturn: undefined,
    monthlyCarry: undefined,
    averageDivergence: average(divergenceSeries),
    medianRebalanceHours: median(gaps),
    maxDrawdown,
    sharpeRatio: undefined,
    winRate:
      wins + losses === 0
        ? ZERO
        : ExactRational.from(String(wins)).divide(ExactRational.from(String(wins + losses))),
    fundingCollectedUsd,
    rebalanceCount,
    rebalanceCostUsd,
    fundingPeriods,
    avgDydx8hEquiv: average(dydx8h),
    avgCex8h: average(cexRates),
    medianDydx8hEquiv: median(dydx8h),
    medianCex8h: median(cexRates),
    meanReversionHalfLifeHours: undefined,
    killSwitch7DayCompressionTriggered: longestRun >= 7,
    compressedDivergenceDays: compressedDays,
    dataSufficientDays: buckets.filter((day) => day.dydxObsCount > 0).length,
    equityCurve,
    startTime: options.startTime,
    endTime: options.endTime,
  };
}
