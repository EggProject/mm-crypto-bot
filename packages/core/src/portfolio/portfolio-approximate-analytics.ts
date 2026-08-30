import {
  correlationMatrix,
  correlatedPairs,
  requirePortfolioInvariant,
} from "./portfolio-orchestrator-market-data.js";

export interface ApproximatePortfolioAnalytics {
  readonly correlationMatrix: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly correlationThresholdExceeded: boolean;
  readonly estimatedVaRPct: number;
}

export function calculateApproximatePortfolioAnalytics(input: {
  readonly correlationThreshold: number;
  readonly portfolioEquity: number;
  readonly returnsBySymbol: ReadonlyMap<string, readonly number[]>;
  readonly symbols: readonly string[];
  readonly totalNotionalUsd: number;
}): ApproximatePortfolioAnalytics {
  const correlations = correlationMatrix(input.symbols, input.returnsBySymbol);
  const matrix = Object.freeze(
    Object.fromEntries(
      [...correlations].map(([symbol, values]) => [symbol, Object.freeze(Object.fromEntries(values))]),
    ),
  );
  const estimatedVaRPct =
    (input.totalNotionalUsd / input.portfolioEquity) *
    dailyDeviation(input.symbols, input.returnsBySymbol) *
    1.645;
  return Object.freeze({
    correlationMatrix: matrix,
    correlationThresholdExceeded:
      correlatedPairs(input.symbols, correlations, input.correlationThreshold).length > 0,
    estimatedVaRPct,
  });
}

export function copyImmutableApproximatePortfolioAnalytics(
  analytics: ApproximatePortfolioAnalytics,
): ApproximatePortfolioAnalytics {
  const frozenMatrixEntries = Object.entries(analytics.correlationMatrix).map(
    ([symbol, values]) => [symbol, Object.freeze({ ...values })] as const,
  );
  return Object.freeze({
    ...analytics,
    correlationMatrix: Object.freeze(
      Object.fromEntries<Readonly<Record<string, number>>>(frozenMatrixEntries),
    ),
  });
}

function dailyDeviation(
  symbols: readonly string[],
  returnsBySymbol: ReadonlyMap<string, readonly number[]>,
): number {
  const observations = symbols.flatMap((symbol) =>
    requirePortfolioInvariant(returnsBySymbol.get(symbol), `missing returns for ${symbol}`),
  );
  if (observations.length < 2) return 0;
  const mean = observations.reduce((total, value) => total + value, 0) / observations.length;
  return Math.sqrt(
    observations.reduce((total, value) => total + (value - mean) ** 2, 0) / (observations.length - 1),
  );
}
