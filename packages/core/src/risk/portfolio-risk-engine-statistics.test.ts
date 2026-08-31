import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  PortfolioRiskEngine,
  type CorrelationMatrix,
  type SizingSignal,
} from "./portfolio-risk-engine.js";
import {
  calculateAggregateDrawdown,
  calculateCrossStrategyCorrelation,
  calculatePortfolioVaR,
} from "./portfolio-risk-engine-statistics.js";

const DAY_MS = 86_400_000;

function makeSizing(
  source: string,
  symbol: string,
  effectiveNotionalUsd: number,
  timestamp = DAY_MS,
): SizingSignal {
  return { kind: "sizing", source, symbol, effectiveNotionalUsd, leverage: 10, timestamp };
}

function requireValue<Value>(value: Value | undefined, subject: string): Value {
  if (value === undefined) throw new Error(`Expected ${subject} to be defined.`);
  return value;
}

function matrixValue(matrix: readonly (readonly number[])[], row: number, column: number): number {
  const value = matrix.at(row)?.at(column);
  if (value === undefined) throw new Error(`Missing matrix value at ${String(row)},${String(column)}.`);
  return value;
}

describe("PortfolioRiskEngine statistics public seam", () => {
  test("aggregates source returns by observed timestamp for portfolio VaR", () => {
    const engine = new PortfolioRiskEngine();
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    engine.recordSourceReturn("A", DAY_MS * 2, -0.02);
    engine.recordSourceReturn("B", DAY_MS, 0.03);
    engine.recordSourceReturn("B", DAY_MS * 3, -0.01);

    const portfolioVaR = requireValue(engine.portfolioVaR(10_000), "portfolio VaR");

    expect(portfolioVaR.observations).toBe(3);
    expect(portfolioVaR.dailyVaR95Usd).toBe(portfolioVaR.dailyVaR95Pct * 10_000);
  });

  test("calculates finite VaR at both normal-quantile tails through the public engine seam", () => {
    for (const confidence of [0.01, 0.99]) {
      const engine = new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, confidence });
      for (const [index, returnPct] of [0.01, -0.02, 0.015, -0.01].entries()) {
        engine.recordSourceReturn("tail-strategy", DAY_MS * (index + 1), returnPct);
      }

      const portfolioVaR = requireValue(engine.portfolioVaR(10_000), "tail portfolio VaR");

      expect(Number.isFinite(portfolioVaR.dailyVaR95Pct)).toBe(true);
      expect(Number.isFinite(portfolioVaR.dailyVaR95Usd)).toBe(true);
      expect(portfolioVaR.dailyVaR95Usd).toBeCloseTo(portfolioVaR.dailyVaR95Pct * 10_000, 12);
    }
  });

  test("returns undefined without enough observations", () => {
    const engine = new PortfolioRiskEngine();
    expect(engine.portfolioVaR(10_000)).toBeUndefined();
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    expect(engine.portfolioVaR(10_000)).toBeUndefined();
  });

  test("builds a symmetric correlation matrix from common source observations", () => {
    const engine = new PortfolioRiskEngine();
    for (const [index, returnPct] of [0.01, -0.02, 0.03].entries()) {
      const timestamp = DAY_MS * (index + 1);
      engine.recordSourceReturn("B", timestamp, returnPct);
      engine.recordSourceReturn("A", timestamp, returnPct);
    }

    const correlation = requireValue(engine.crossStrategyCorrelation(), "correlation");

    expect(correlation.sources).toEqual(["A", "B"]);
    expect(correlation.observationCount).toBe(3);
    expect(matrixValue(correlation.matrix, 0, 1)).toBeCloseTo(1, 6);
    expect(matrixValue(correlation.matrix, 1, 0)).toBeCloseTo(1, 6);
  });

  test("uses deterministic code-unit source ordering for matrix row and column indexes", () => {
    const engine = new PortfolioRiskEngine();
    const returns = [0.01, -0.02, 0.03];
    for (const [index, returnPct] of returns.entries()) {
      const timestamp = DAY_MS * (index + 1);
      engine.recordSourceReturn("A", timestamp, returnPct);
      engine.recordSourceReturn("B", timestamp, returnPct);
      engine.recordSourceReturn("a", timestamp, -returnPct);
    }

    const correlation = requireValue(engine.crossStrategyCorrelation(), "mixed-case correlation");

    expect(correlation.sources).toEqual(["A", "B", "a"]);
    expect(matrixValue(correlation.matrix, 0, 1)).toBeCloseTo(1, 6);
    expect(matrixValue(correlation.matrix, 0, 2)).toBeCloseTo(-1, 6);
  });

  test("orders distinct timestamps before building correlation rows", () => {
    const engine = new PortfolioRiskEngine();
    const observations: readonly (readonly [number, number])[] = [
      [DAY_MS * 3, 0.03],
      [DAY_MS * 2, -0.02],
      [DAY_MS, 0.01],
    ];
    for (const [timestamp, returnPct] of observations) {
      engine.recordSourceReturn("A", timestamp, returnPct);
      engine.recordSourceReturn("B", timestamp, returnPct);
    }

    const correlation = requireValue(engine.crossStrategyCorrelation(), "timestamp-ordered correlation");

    expect(correlation.timestamp).toBe(DAY_MS * 3);
    expect(matrixValue(correlation.matrix, 0, 1)).toBeCloseTo(1, 6);
  });

  test("returns undefined without enough sources or common observations", () => {
    const engine = new PortfolioRiskEngine();
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    expect(engine.crossStrategyCorrelation()).toBeUndefined();
    for (const index of [1, 2, 3, 4, 5]) {
      engine.recordSourceReturn("A", DAY_MS * index, 0.01);
      engine.recordSourceReturn("B", DAY_MS * (index + 10), 0.02);
    }
    expect(engine.crossStrategyCorrelation()).toBeUndefined();
  });

  test("retains inverse Pearson correlation and rolling bounds", () => {
    const engine = new PortfolioRiskEngine({
      ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
      correlationWindowDays: 5,
    });
    for (const [index, returnPct] of [0.01, -0.02, 0.03, -0.01, 0.005, 0.02].entries()) {
      const timestamp = DAY_MS * (index + 1);
      engine.recordSourceReturn("A", timestamp, returnPct);
      engine.recordSourceReturn("B", timestamp, -returnPct);
    }
    const correlation: CorrelationMatrix = requireValue(engine.crossStrategyCorrelation(), "correlation");
    expect(engine.getPerSourceObservationCounts().get("A")).toBe(5);
    expect(matrixValue(correlation.matrix, 0, 1)).toBeCloseTo(-1, 4);
  });

  test("computes running aggregate drawdown", () => {
    const engine = new PortfolioRiskEngine({
      ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
      maxAggregateDrawdownPct: 0.2,
    });
    for (const [index, equityUsd] of [10_000, 12_000, 9000].entries()) {
      engine.recordEquitySnapshot(DAY_MS * (index + 1), equityUsd);
    }

    const drawdown = requireValue(engine.aggregateDrawdown(), "drawdown");

    expect(drawdown).toMatchObject({
      peakEquityUsd: 12_000,
      currentEquityUsd: 9000,
      drawdownUsd: 3000,
      isAtLimit: true,
    });
    expect(drawdown.drawdownPct).toBeCloseTo(0.25, 6);
  });

  test("returns undefined drawdown without equity", () => {
    expect(new PortfolioRiskEngine().aggregateDrawdown()).toBeUndefined();
  });

  test("uses gross per-symbol exposure and conservative signed conflict resolution", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("directional", "BTC/USDT", 50_000));
    engine.submitSignal(makeSizing("carry", "BTC/USDT", -40_000));
    engine.submitSignal(makeSizing("hedge", "ETH/USDT", 10_000));

    const exposure = engine.exposureBySymbol();

    expect(exposure.totalNotionalUsd).toBe(100_000);
    expect(exposure.perSymbol.get("BTC/USDT")).toBe(90_000);
    expect(exposure.perSymbolFraction.get("BTC/USDT")).toBeCloseTo(0.9, 6);
    expect(exposure.overThresholdSymbols).toEqual(["BTC/USDT"]);
    expect(engine.resolvePositionConflict("BTC/USDT")).toBe(-40_000);
  });

  test("reports a zero-notional symbol as zero concentration", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("zero", "BTC/USDT", 0));

    expect(engine.exposureBySymbol().perSymbolFraction.get("BTC/USDT")).toBe(0);
  });

  test("preserves statistics boundary guards for malformed public inputs", () => {
    expect(calculateAggregateDrawdown([0], [DAY_MS], 0.2)?.drawdownPct).toBe(0);
    expect(() => calculateAggregateDrawdown([10_000], [], 0.2)).toThrow(/Missing equity timestamp/);

    const timestamps = new Map([["A", [DAY_MS, DAY_MS * 2]]]);
    expect(() => calculatePortfolioVaR(new Map([["A", [0.01]]]), timestamps, 0.95, 10_000)).toThrow(
      /Missing return/,
    );
    expect(() => calculatePortfolioVaR(new Map([["A", [0.01, -0.02]]]), timestamps, 1, 10_000)).toThrow(
      RangeError,
    );

    const returns = new Map([
      ["A", [0.01]],
      ["B", [0.01, -0.02]],
    ]);
    const alignedTimestamps = new Map([
      ["A", [DAY_MS, DAY_MS * 2]],
      ["B", [DAY_MS, DAY_MS * 2]],
    ]);
    expect(() => calculateCrossStrategyCorrelation(returns, alignedTimestamps)).toThrow(/Missing return/);
    expect(() => calculateCrossStrategyCorrelation(returns, new Map([["B", [DAY_MS, DAY_MS * 2]]]))).toThrow(
      /Missing timestamps series/,
    );
  });
});
