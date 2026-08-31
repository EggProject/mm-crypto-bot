import type { Position } from "./leverage-invariant.js";

export interface PortfolioVaRStatistics {
  readonly dailyVaR95Pct: number;
  readonly dailyVaR95Usd: number;
  readonly observations: number;
}

export interface CorrelationStatistics {
  readonly sources: readonly string[];
  readonly matrix: readonly (readonly number[])[];
  readonly timestamp: number;
  readonly observationCount: number;
}

export interface AggregateDrawdownStatistics {
  readonly peakEquityUsd: number;
  readonly currentEquityUsd: number;
  readonly drawdownPct: number;
  readonly drawdownUsd: number;
  readonly maxDrawdownPct: number;
  readonly isAtLimit: boolean;
  readonly timestamp: number;
}

export interface ExposureStatistics {
  readonly totalNotionalUsd: number;
  readonly perSymbol: ReadonlyMap<string, number>;
  readonly perSymbolFraction: ReadonlyMap<string, number>;
  readonly overThresholdSymbols: readonly string[];
}

export function calculatePortfolioVaR(
  perSourceReturns: ReadonlyMap<string, readonly number[]>,
  perSourceTimestamps: ReadonlyMap<string, readonly number[]>,
  confidence: number,
  capital: number,
): PortfolioVaRStatistics | undefined {
  if (perSourceReturns.size === 0) return undefined;
  const aggregateReturns = buildAlignedAggregateReturns(perSourceReturns, perSourceTimestamps);
  if (aggregateReturns.length < 2) return undefined;
  const mean = aggregateReturns.reduce((total, value) => total + value, 0) / aggregateReturns.length;
  const variance =
    aggregateReturns.reduce((total, value) => total + (value - mean) * (value - mean), 0) /
    (aggregateReturns.length - 1);
  const standardDeviation = Math.sqrt(variance);
  const dailyVaR95Pct = -(mean - normalQuantile(confidence) * standardDeviation);
  return {
    dailyVaR95Pct,
    dailyVaR95Usd: dailyVaR95Pct * capital,
    observations: aggregateReturns.length,
  };
}

export function calculateCrossStrategyCorrelation(
  perSourceReturns: ReadonlyMap<string, readonly number[]>,
  perSourceTimestamps: ReadonlyMap<string, readonly number[]>,
): CorrelationStatistics | undefined {
  const sources = sortUnique(collectValues(perSourceReturns.keys()), compareUniqueStrings);
  if (sources.length < 2) return undefined;
  let commonTimestamps: Set<number> | undefined;
  for (const source of sources) {
    const timestamps = new Set(getSeries(perSourceTimestamps, source, "timestamps"));
    if (commonTimestamps === undefined) {
      commonTimestamps = timestamps;
      continue;
    }
    const intersection = new Set<number>();
    for (const timestamp of commonTimestamps) {
      if (timestamps.has(timestamp)) intersection.add(timestamp);
    }
    commonTimestamps = intersection;
  }
  if (commonTimestamps === undefined || commonTimestamps.size < 2) return undefined;
  const sortedTimestamps = sortUnique(collectValues(commonTimestamps.values()), compareUniqueNumbers);
  const alignedReturns = sources.map((source) =>
    alignSourceReturns(perSourceReturns, perSourceTimestamps, source, sortedTimestamps),
  );
  const matrix = calculateCorrelationMatrix(alignedReturns);
  let timestamp = 0;
  for (const sortedTimestamp of sortedTimestamps) timestamp = sortedTimestamp;
  return { sources, matrix, timestamp, observationCount: sortedTimestamps.length };
}

export function calculateAggregateDrawdown(
  equityCurve: readonly number[],
  equityTimestamps: readonly number[],
  maximumAggregateDrawdownPct: number,
): AggregateDrawdownStatistics | undefined {
  if (equityCurve.length === 0) return undefined;
  let peakEquityUsd = -Infinity;
  let maxDrawdownPct = 0;
  let currentEquityUsd = 0;
  let timestamp = 0;
  for (const [index, equityUsd] of equityCurve.entries()) {
    const observedTimestamp = equityTimestamps.at(index);
    if (observedTimestamp === undefined) throw new Error("Missing equity timestamp.");
    peakEquityUsd = Math.max(peakEquityUsd, equityUsd);
    const drawdownPct = peakEquityUsd > 0 ? (peakEquityUsd - equityUsd) / peakEquityUsd : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    currentEquityUsd = equityUsd;
    timestamp = observedTimestamp;
  }
  const drawdownPct = peakEquityUsd > 0 ? (peakEquityUsd - currentEquityUsd) / peakEquityUsd : 0;
  return {
    peakEquityUsd,
    currentEquityUsd,
    drawdownPct,
    drawdownUsd: peakEquityUsd - currentEquityUsd,
    maxDrawdownPct,
    isAtLimit: drawdownPct >= maximumAggregateDrawdownPct,
    timestamp,
  };
}

export function calculateExposureBySymbol(
  positions: readonly Position[],
  concentrationThresholdPct: number,
): ExposureStatistics {
  const perSymbol = new Map<string, number>();
  let totalNotionalUsd = 0;
  for (const position of positions) {
    const absoluteNotionalUsd = Math.abs(position.effectiveNotionalUsd);
    perSymbol.set(position.symbol, (perSymbol.get(position.symbol) ?? 0) + absoluteNotionalUsd);
    totalNotionalUsd += absoluteNotionalUsd;
  }
  const perSymbolFraction = new Map<string, number>();
  const overThresholdSymbols: string[] = [];
  for (const [symbol, notionalUsd] of perSymbol) {
    const fraction = totalNotionalUsd > 0 ? notionalUsd / totalNotionalUsd : 0;
    perSymbolFraction.set(symbol, fraction);
    if (fraction > concentrationThresholdPct) overThresholdSymbols.push(symbol);
  }
  return { totalNotionalUsd, perSymbol, perSymbolFraction, overThresholdSymbols };
}

export function resolveConservativePositionNotional(positions: readonly Position[], symbol: string): number {
  let minimumAbsoluteNotional = Infinity;
  let hasPosition = false;
  let sign = 1;
  for (const position of positions) {
    if (position.symbol !== symbol) continue;
    const absoluteNotionalUsd = Math.abs(position.effectiveNotionalUsd);
    if (absoluteNotionalUsd < minimumAbsoluteNotional) {
      minimumAbsoluteNotional = absoluteNotionalUsd;
      sign = position.effectiveNotionalUsd >= 0 ? 1 : -1;
    }
    hasPosition = true;
  }
  return hasPosition ? sign * minimumAbsoluteNotional : 0;
}

function buildAlignedAggregateReturns(
  perSourceReturns: ReadonlyMap<string, readonly number[]>,
  perSourceTimestamps: ReadonlyMap<string, readonly number[]>,
): number[] {
  const sources = collectValues(perSourceReturns.keys());
  const timestamps = new Set<number>();
  for (const source of sources) {
    for (const timestamp of getSeries(perSourceTimestamps, source, "timestamps")) timestamps.add(timestamp);
  }
  return sortUnique(collectValues(timestamps.values()), compareUniqueNumbers).map((timestamp) =>
    calculateAggregateReturnAtTimestamp(perSourceReturns, perSourceTimestamps, sources, timestamp),
  );
}

function calculateAggregateReturnAtTimestamp(
  perSourceReturns: ReadonlyMap<string, readonly number[]>,
  perSourceTimestamps: ReadonlyMap<string, readonly number[]>,
  sources: readonly string[],
  timestamp: number,
): number {
  let total = 0;
  for (const source of sources) {
    const sourceTimestamps = getSeries(perSourceTimestamps, source, "timestamps");
    const index = sourceTimestamps.indexOf(timestamp);
    if (index === -1) continue;
    const value = getSeries(perSourceReturns, source, "returns").at(index);
    if (value === undefined)
      throw new Error(`Missing return for source=${source} timestamp=${String(timestamp)}`);
    total += value;
  }
  return total;
}

function alignSourceReturns(
  perSourceReturns: ReadonlyMap<string, readonly number[]>,
  perSourceTimestamps: ReadonlyMap<string, readonly number[]>,
  source: string,
  timestamps: readonly number[],
): DataView {
  const sourceTimestamps = getSeries(perSourceTimestamps, source, "timestamps");
  const sourceReturns = getSeries(perSourceReturns, source, "returns");
  const alignedReturns = new DataView(new ArrayBuffer(timestamps.length * Float64Array.BYTES_PER_ELEMENT));
  for (const [index, timestamp] of timestamps.entries()) {
    const sourceIndex = sourceTimestamps.indexOf(timestamp);
    const value = sourceReturns.at(sourceIndex);
    if (value === undefined)
      throw new Error(`Missing return for source=${source} timestamp=${String(timestamp)}`);
    alignedReturns.setFloat64(index * Float64Array.BYTES_PER_ELEMENT, value, true);
  }
  return alignedReturns;
}

function calculateCorrelationMatrix(alignedReturns: readonly DataView[]): number[][] {
  return alignedReturns.map((rowReturns, row) =>
    alignedReturns.map((columnReturns, column) => (row === column ? 1 : pearson(rowReturns, columnReturns))),
  );
}

function getSeries(
  seriesBySource: ReadonlyMap<string, readonly number[]>,
  source: string,
  seriesKind: "returns" | "timestamps",
): readonly number[] {
  const series = seriesBySource.get(source);
  if (series === undefined) throw new Error(`Missing ${seriesKind} series for source=${source}`);
  return series;
}

function collectValues<Value>(iterator: Iterable<Value>): Value[] {
  return [...iterator];
}

/**
 * Orders snapshots formed from unique Map keys or Set values.
 */
function sortUnique<Value>(
  values: readonly Value[],
  compareUniqueValues: (left: Value, right: Value) => number,
): Value[] {
  if (values.length < 2) return [...values];
  const middle = Math.floor(values.length / 2);
  return mergeUnique(
    sortUnique(values.slice(0, middle), compareUniqueValues),
    sortUnique(values.slice(middle), compareUniqueValues),
    compareUniqueValues,
  );
}

function mergeUnique<Value>(
  left: readonly Value[],
  right: readonly Value[],
  compareUniqueValues: (left: Value, right: Value) => number,
): Value[] {
  const ordered: Value[] = [];
  const leftValues = left.values();
  const rightValues = right.values();
  let nextLeft = leftValues.next();
  let nextRight = rightValues.next();
  while (!nextLeft.done && !nextRight.done) {
    if (compareUniqueValues(nextLeft.value, nextRight.value) < 0) {
      ordered.push(nextLeft.value);
      nextLeft = leftValues.next();
    } else {
      ordered.push(nextRight.value);
      nextRight = rightValues.next();
    }
  }
  while (!nextLeft.done) {
    ordered.push(nextLeft.value);
    nextLeft = leftValues.next();
  }
  while (!nextRight.done) {
    ordered.push(nextRight.value);
    nextRight = rightValues.next();
  }
  return ordered;
}

function compareUniqueStrings(left: string, right: string): number {
  return left < right ? -1 : 1;
}

function compareUniqueNumbers(left: number, right: number): number {
  return left < right ? -1 : 1;
}

function pearson(left: DataView, right: DataView): number {
  const observations = left.byteLength / Float64Array.BYTES_PER_ELEMENT;
  let leftSum = 0;
  let rightSum = 0;
  for (let byteOffset = 0; byteOffset < left.byteLength; byteOffset += Float64Array.BYTES_PER_ELEMENT) {
    leftSum += left.getFloat64(byteOffset, true);
    rightSum += right.getFloat64(byteOffset, true);
  }
  const leftMean = leftSum / observations;
  const rightMean = rightSum / observations;
  let numerator = 0;
  let leftSquaredDeviation = 0;
  let rightSquaredDeviation = 0;
  for (let byteOffset = 0; byteOffset < left.byteLength; byteOffset += Float64Array.BYTES_PER_ELEMENT) {
    const leftValue = left.getFloat64(byteOffset, true);
    const rightValue = right.getFloat64(byteOffset, true);
    const leftDeviation = leftValue - leftMean;
    const rightDeviation = rightValue - rightMean;
    numerator += leftDeviation * rightDeviation;
    leftSquaredDeviation += leftDeviation * leftDeviation;
    rightSquaredDeviation += rightDeviation * rightDeviation;
  }
  const denominator = Math.sqrt(leftSquaredDeviation * rightSquaredDeviation);
  return denominator === 0 ? 0 : numerator / denominator;
}

function normalQuantile(probability: number): number {
  if (probability <= 0 || probability >= 1)
    throw new RangeError(`p must be in (0, 1), got ${String(probability)}`);
  const lowerTailThreshold = 0.02425;
  if (probability < lowerTailThreshold) {
    const root = Math.sqrt(-2 * Math.log(probability));
    return (
      evaluatePolynomial(
        [
          -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
          4.374664141464968, 2.938163982698783,
        ],
        root,
      ) /
      evaluatePolynomial(
        [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416, 1],
        root,
      )
    );
  }
  const upperTailThreshold = 1 - lowerTailThreshold;
  if (probability <= upperTailThreshold) {
    const centeredProbability = probability - 0.5;
    const squaredProbability = centeredProbability * centeredProbability;
    return (
      (evaluatePolynomial(
        [
          -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
          -3.066479806614716e1, 2.506628277459239,
        ],
        squaredProbability,
      ) *
        centeredProbability) /
      evaluatePolynomial(
        [
          -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
          -1.328068155288572e1, 1,
        ],
        squaredProbability,
      )
    );
  }
  const root = Math.sqrt(-2 * Math.log(1 - probability));
  return (
    -evaluatePolynomial(
      [
        -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
        4.374664141464968, 2.938163982698783,
      ],
      root,
    ) /
    evaluatePolynomial(
      [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416, 1],
      root,
    )
  );
}

function evaluatePolynomial(coefficients: readonly number[], value: number): number {
  let result = 0;
  for (const coefficient of coefficients) result = result * value + coefficient;
  return result;
}
