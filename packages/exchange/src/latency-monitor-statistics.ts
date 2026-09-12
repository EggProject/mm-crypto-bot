/**
 * Pure aggregation helpers for latency samples.
 */

import type {
  LatencySample,
  LatencyStats,
  MessageGapSample,
  ReconnectSample,
  RttSample,
  SupportedExchangeId,
} from "./latency-monitor.contract.js";

const sortNumbers: (this: number[], compareFunction: (first: number, second: number) => number) => number[] =
  Array.prototype.sort;

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return NaN;
  if (percentileValue <= 0) return Math.min(...values);
  if (percentileValue >= 100) return Math.max(...values);
  const sorted = sortNumbers.call([...values], (first, second) => first - second);
  const rank = Math.max(1, Math.ceil((percentileValue / 100) * sorted.length));
  const index = Math.min(sorted.length - 1, rank - 1);
  let result = NaN;
  for (const [valueIndex, value] of sorted.entries()) {
    if (valueIndex === index) {
      result = value;
      break;
    }
  }
  return result;
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

export function aggregateStats(
  exchangeId: SupportedExchangeId,
  samples: readonly LatencySample[],
): LatencyStats {
  const rttSamples = samples.filter((sample): sample is RttSample => "rttMs" in sample);
  const gapSamples = samples.filter((sample): sample is MessageGapSample => "gapMs" in sample);
  const reconnectSamples = samples.filter((sample): sample is ReconnectSample => "reconnectMs" in sample);
  const rtts = rttSamples.map((sample) => sample.rttMs);
  const gaps = gapSamples.map((sample) => sample.gapMs);
  const reconnects = reconnectSamples.map((sample) => sample.reconnectMs);
  const successes = rttSamples.filter((sample) => sample.success).length;

  return {
    exchangeId,
    rttCount: rttSamples.length,
    rttMinMs: rtts.length > 0 ? Math.min(...rtts) : NaN,
    rttMaxMs: rtts.length > 0 ? Math.max(...rtts) : NaN,
    rttMedianMs: median(rtts),
    rttP95Ms: percentile(rtts, 95),
    rttP99Ms: percentile(rtts, 99),
    rttSuccessRate: rttSamples.length > 0 ? successes / rttSamples.length : NaN,
    gapCount: gapSamples.length,
    gapMinMs: gaps.length > 0 ? Math.min(...gaps) : NaN,
    gapMaxMs: gaps.length > 0 ? Math.max(...gaps) : NaN,
    gapMedianMs: median(gaps),
    gapP95Ms: percentile(gaps, 95),
    gapP99Ms: percentile(gaps, 99),
    reconnectCount: reconnectSamples.length,
    reconnectMinMs: reconnects.length > 0 ? Math.min(...reconnects) : NaN,
    reconnectMaxMs: reconnects.length > 0 ? Math.max(...reconnects) : NaN,
    reconnectMedianMs: median(reconnects),
    reconnectP95Ms: percentile(reconnects, 95),
  };
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 100) / 100;
}
