import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  PortfolioRiskEngine,
  type CorrelationMatrix,
  type RiskSnapshot,
  type SizingSignal,
} from "./portfolio-risk-engine.js";

const DAY_MS = 86_400_000;
const BASE_CAPITAL_USD = 10_000;
const FIVE_INDICES = Array.from({ length: 5 }, (_, value) => value);
const TEN_INDICES = Array.from({ length: 10 }, (_, value) => value);
const TWENTY_INDICES = Array.from({ length: 20 }, (_, value) => value);
const THIRTY_INDICES = Array.from({ length: 30 }, (_, value) => value);
const HUNDRED_INDICES = Array.from({ length: 100 }, (_, value) => value);

function makeSizing(
  source: string,
  symbol: string,
  effectiveNotionalUsd: number,
  timestamp: number,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runSnapshot(): RiskSnapshot {
  const engine = new PortfolioRiskEngine();
  engine.submitSignal(makeSizing("A", "BTC/USDT", 50_000, DAY_MS));
  engine.submitSignal(makeSizing("B", "ETH/USDT", 50_000, DAY_MS * 2));
  for (const index of THIRTY_INDICES) {
    engine.recordSourceReturn("A", DAY_MS * (index + 1), 0.01 * Math.sin(index));
    engine.recordSourceReturn("B", DAY_MS * (index + 1), 0.02 * Math.cos(index));
  }
  engine.recordEquitySnapshot(DAY_MS, BASE_CAPITAL_USD);
  engine.recordEquitySnapshot(DAY_MS * 2, 10_100);
  return engine.snapshot(BASE_CAPITAL_USD);
}

function comparableSnapshot(snapshot: RiskSnapshot): RiskSnapshot {
  return {
    ...snapshot,
    timestamp: 0,
    exposure: { ...snapshot.exposure, timestamp: 0 },
    leverageInvariantFires: snapshot.leverageInvariantFires.map((fire) => ({ ...fire, timestamp: 0 })),
  };
}

describe("PortfolioRiskEngine — portfolioVaR", () => {
  test("no observations → returns null", () => {
    expect(new PortfolioRiskEngine().portfolioVaR(BASE_CAPITAL_USD)).toBeUndefined();
  });

  test("fewer than 2 observations → returns null", () => {
    const engine = new PortfolioRiskEngine();
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    expect(engine.portfolioVaR(BASE_CAPITAL_USD)).toBeUndefined();
  });

  test("20 returns with mean 0.001, std 0.02 → VaR ≈ 0.032 (3.2%)", () => {
    const engine = new PortfolioRiskEngine();
    for (const index of TWENTY_INDICES) {
      engine.recordSourceReturn("A", DAY_MS * (index + 1), 0.001 + 0.02 * Math.sin(index));
    }
    const variable95Result = engine.portfolioVaR(BASE_CAPITAL_USD);
    expect(variable95Result).toBeDefined();
    const variable95 = requireValue(variable95Result, "portfolio VaR");
    expect(variable95.dailyVaR95Pct).toBeGreaterThan(0);
    expect(variable95.dailyVaR95Usd).toBeGreaterThan(0);
    expect(variable95.method).toBe("parametric");
    expect(variable95.observations).toBe(20);
  });

  test("zero-variance series → VaR = 0 (no risk)", () => {
    const engine = new PortfolioRiskEngine();
    for (const index of TEN_INDICES) {
      engine.recordSourceReturn("A", DAY_MS * (index + 1), 0.001);
    }
    const variable95Result = engine.portfolioVaR(BASE_CAPITAL_USD);
    expect(variable95Result).toBeDefined();
    expect(requireValue(variable95Result, "zero-variance VaR").dailyVaR95Pct).toBeLessThanOrEqual(0);
  });

  test("VaR in USD = VaR in pct × capital", () => {
    const engine = new PortfolioRiskEngine();
    for (const index of THIRTY_INDICES) {
      engine.recordSourceReturn("A", DAY_MS * (index + 1), 0.005 * (index % 2 === 0 ? 1 : -1));
    }
    const variable95Result = engine.portfolioVaR(BASE_CAPITAL_USD);
    expect(variable95Result).toBeDefined();
    const variable95 = requireValue(variable95Result, "portfolio VaR");
    expect(variable95.dailyVaR95Usd).toBeCloseTo(variable95.dailyVaR95Pct * BASE_CAPITAL_USD, 4);
  });
});

describe("PortfolioRiskEngine — crossStrategyCorrelation", () => {
  test("fewer than 2 sources → returns null", () => {
    const engine = new PortfolioRiskEngine();
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    expect(engine.crossStrategyCorrelation()).toBeUndefined();
  });

  test("2 sources with 5+ observations → returns matrix", () => {
    const engine = new PortfolioRiskEngine();
    for (const index of TEN_INDICES) {
      engine.recordSourceReturn("A", DAY_MS * (index + 1), 0.01);
      engine.recordSourceReturn("B", DAY_MS * (index + 1), 0.02);
    }
    const correlationResult = engine.crossStrategyCorrelation();
    expect(correlationResult).toBeDefined();
    const correlation = requireValue(correlationResult, "correlation");
    expect(correlation.sources).toHaveLength(2);
    expect(correlation.matrix).toHaveLength(2);
    expect(matrixValue(correlation.matrix, 0, 0)).toBeCloseTo(1, 6);
    expect(matrixValue(correlation.matrix, 1, 1)).toBeCloseTo(1, 6);
    expect(matrixValue(correlation.matrix, 0, 1)).toBeCloseTo(matrixValue(correlation.matrix, 1, 0), 6);
  });

  test("perfectly correlated series → off-diagonal = 1", () => {
    const engine = new PortfolioRiskEngine();
    const series = [0.01, -0.02, 0.03, -0.01, 0.005];
    for (const [index, returnPct] of series.entries()) {
      engine.recordSourceReturn("A", DAY_MS * (index + 1), returnPct);
      engine.recordSourceReturn("B", DAY_MS * (index + 1), returnPct);
    }
    const correlation = requireValue(engine.crossStrategyCorrelation(), "correlation");
    expect(matrixValue(correlation.matrix, 0, 1)).toBeCloseTo(1, 4);
  });

  test("anti-correlated series → off-diagonal = -1", () => {
    const engine = new PortfolioRiskEngine();
    const series = [0.01, -0.02, 0.03, -0.01, 0.005];
    for (const [index, returnPct] of series.entries()) {
      engine.recordSourceReturn("A", DAY_MS * (index + 1), returnPct);
      engine.recordSourceReturn("B", DAY_MS * (index + 1), -returnPct);
    }
    const correlation = requireValue(engine.crossStrategyCorrelation(), "correlation");
    expect(matrixValue(correlation.matrix, 0, 1)).toBeCloseTo(-1, 4);
  });

  test("rolling window truncates to correlationWindowDays", () => {
    const engine = new PortfolioRiskEngine({
      ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
      correlationWindowDays: 5,
    });
    for (const index of TWENTY_INDICES) {
      engine.recordSourceReturn("A", DAY_MS * (index + 1), 0.01);
      engine.recordSourceReturn("B", DAY_MS * (index + 1), 0.01);
    }
    expect(engine.getPerSourceObservationCounts().get("A")).toBe(5);
  });

  test("insufficient common observations → returns null", () => {
    const engine = new PortfolioRiskEngine();
    for (const timestamp of [1, 2, 3, 4, 5]) engine.recordSourceReturn("A", DAY_MS * timestamp, 0.01);
    for (const timestamp of [10, 11, 12, 13, 14]) engine.recordSourceReturn("B", DAY_MS * timestamp, 0.02);
    expect(engine.crossStrategyCorrelation()).toBeUndefined();
  });
});

describe("PortfolioRiskEngine — aggregateDrawdown", () => {
  test("no equity snapshots → returns null", () => {
    expect(new PortfolioRiskEngine().aggregateDrawdown()).toBeUndefined();
  });

  test("monotonically increasing equity → DD = 0", () => {
    const engine = new PortfolioRiskEngine();
    for (const index of TEN_INDICES) {
      engine.recordEquitySnapshot(DAY_MS * (index + 1), BASE_CAPITAL_USD + index * 100);
    }
    const drawdownResult = engine.aggregateDrawdown();
    expect(drawdownResult).toBeDefined();
    const drawdown = requireValue(drawdownResult, "drawdown");
    expect(drawdown.drawdownPct).toBeCloseTo(0, 6);
    expect(drawdown.maxDrawdownPct).toBe(0);
    expect(drawdown.isAtLimit).toBe(false);
  });

  test("equity rises then falls → DD > 0", () => {
    const engine = new PortfolioRiskEngine();
    const equity = [10_000, 11_000, 12_000, 11_000, 10_000, 9500, 10_500];
    for (const [index, equityUsd] of equity.entries())
      engine.recordEquitySnapshot(DAY_MS * (index + 1), equityUsd);
    const drawdown = requireValue(engine.aggregateDrawdown(), "drawdown");
    expect(drawdown.peakEquityUsd).toBe(12_000);
    expect(drawdown.currentEquityUsd).toBe(10_500);
    expect(drawdown.drawdownPct).toBeCloseTo(0.125, 4);
    expect(drawdown.maxDrawdownPct).toBeCloseTo(0.2083, 3);
  });

  test("DD exceeds threshold → isAtLimit = true", () => {
    const engine = new PortfolioRiskEngine({
      ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
      maxAggregateDrawdownPct: 0.2,
    });
    engine.recordEquitySnapshot(DAY_MS, BASE_CAPITAL_USD);
    engine.recordEquitySnapshot(DAY_MS * 2, 7500);
    expect(requireValue(engine.aggregateDrawdown(), "drawdown").isAtLimit).toBe(true);
  });
});

describe("PortfolioRiskEngine — exposureBySymbol", () => {
  test("empty positions → total = 0, no over-threshold", () => {
    const exposure = new PortfolioRiskEngine().exposureBySymbol();
    expect(exposure.totalNotionalUsd).toBe(0);
    expect(exposure.overThresholdSymbols).toHaveLength(0);
  });

  test("3 symbols equal weight → all under 40% threshold", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 30_000, DAY_MS));
    engine.submitSignal(makeSizing("A", "ETH/USDT", 30_000, DAY_MS));
    engine.submitSignal(makeSizing("A", "SOL/USDT", 30_000, DAY_MS));
    const exposure = engine.exposureBySymbol();
    expect(exposure.totalNotionalUsd).toBe(90_000);
    expect(requireValue(exposure.perSymbolFraction.get("BTC/USDT"), "BTC concentration")).toBeCloseTo(
      1 / 3,
      4,
    );
    expect(exposure.overThresholdSymbols).toHaveLength(0);
  });

  test("single symbol dominates → over threshold", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 80_000, DAY_MS));
    engine.submitSignal(makeSizing("A", "ETH/USDT", 20_000, DAY_MS));
    const exposure = engine.exposureBySymbol();
    expect(requireValue(exposure.perSymbolFraction.get("BTC/USDT"), "BTC concentration")).toBeCloseTo(0.8, 4);
    expect(exposure.overThresholdSymbols).toContain("BTC/USDT");
  });

  test("long + short on same symbol → counts GROSS exposure", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("directional", "BTC/USDT", 50_000, DAY_MS));
    engine.submitSignal(makeSizing("funding-carry", "BTC/USDT", -50_000, DAY_MS));
    expect(requireValue(engine.exposureBySymbol().perSymbol.get("BTC/USDT"), "BTC gross exposure")).toBe(
      100_000,
    );
  });
});

describe("PortfolioRiskEngine — snapshot", () => {
  test("snapshot is serializable (JSON-roundtrip safe)", async () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 30_000, DAY_MS));
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    engine.recordEquitySnapshot(DAY_MS, BASE_CAPITAL_USD);
    const serialized = JSON.stringify(engine.snapshot(BASE_CAPITAL_USD));
    const parsed: unknown = await new Response(serialized).json();
    if (!isRecord(parsed)) throw new Error("Expected serialized snapshot to be an object.");
    expect(parsed["numStrategies"]).toBe(1);
    expect(parsed["numSignalsSubmitted"]).toBe(1);
    expect(parsed["positions"]).toHaveLength(1);
  });

  test("snapshot includes all sub-metrics", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 30_000, DAY_MS));
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    engine.recordSourceReturn("A", DAY_MS * 2, 0.02);
    engine.recordSourceReturn("B", DAY_MS, 0.02);
    engine.recordSourceReturn("B", DAY_MS * 2, 0.01);
    engine.recordEquitySnapshot(DAY_MS, BASE_CAPITAL_USD);
    engine.recordEquitySnapshot(DAY_MS * 2, 10_100);
    const snapshot = engine.snapshot(BASE_CAPITAL_USD);
    expect(snapshot.lastVaR).toBeDefined();
    expect(snapshot.lastCorrelation).toBeDefined();
    expect(snapshot.exposure).toBeDefined();
    expect(snapshot.drawdown).toBeDefined();
    expect(snapshot.aggregateLeverage).toBe(3);
  });
});

describe("PortfolioRiskEngine — determinism", () => {
  test("identical input → identical output across multiple runs", () => {
    expect(comparableSnapshot(runSnapshot())).toEqual(comparableSnapshot(runSnapshot()));
  });
});

describe("PortfolioRiskEngine — edge cases", () => {
  test("0 strategies → snapshot OK, VaR null, correlation null", () => {
    const snapshot = new PortfolioRiskEngine().snapshot(BASE_CAPITAL_USD);
    expect(snapshot.numStrategies).toBe(0);
    expect(snapshot.lastVaR).toBeUndefined();
    expect(snapshot.lastCorrelation).toBeUndefined();
    expect(snapshot.positions).toHaveLength(0);
  });

  test("1 strategy → VaR OK, correlation null (need ≥2)", () => {
    const engine = new PortfolioRiskEngine();
    for (const index of TEN_INDICES) {
      engine.recordSourceReturn("A", DAY_MS * (index + 1), 0.01);
    }
    expect(engine.portfolioVaR(BASE_CAPITAL_USD)).toBeDefined();
    expect(engine.crossStrategyCorrelation()).toBeUndefined();
  });

  test("100 strategies → correlation matrix is 100×100", () => {
    const engine = new PortfolioRiskEngine();
    for (const sourceIndex of HUNDRED_INDICES) {
      const source = `S${String(sourceIndex)}`;
      for (const returnIndex of TEN_INDICES) {
        engine.recordSourceReturn(
          source,
          DAY_MS * (returnIndex + 1),
          0.001 * Math.sin(sourceIndex + returnIndex),
        );
      }
    }
    const correlationResult = engine.crossStrategyCorrelation();
    expect(correlationResult).toBeDefined();
    const correlation = requireValue(correlationResult, "correlation");
    expect(correlation.sources).toHaveLength(100);
    expect(correlation.matrix).toHaveLength(100);
    expect(requireValue(correlation.matrix.at(0), "first correlation row")).toHaveLength(100);
    for (const sourceIndex of HUNDRED_INDICES) {
      expect(matrixValue(correlation.matrix, sourceIndex, sourceIndex)).toBe(1);
    }
  });

  test("clear() resets all state", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 50_000, DAY_MS));
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    engine.recordEquitySnapshot(DAY_MS, BASE_CAPITAL_USD);
    engine.clear();
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.snapshot(BASE_CAPITAL_USD).numSignalsSubmitted).toBe(0);
    expect(engine.crossStrategyCorrelation()).toBeUndefined();
    expect(engine.aggregateDrawdown()).toBeUndefined();
  });
});

describe("PortfolioRiskEngine — type contracts", () => {
  test("CorrelationMatrix is symmetric for 2 sources", () => {
    const engine = new PortfolioRiskEngine();
    for (const index of FIVE_INDICES) {
      engine.recordSourceReturn("A", DAY_MS * (index + 1), 0.01);
      engine.recordSourceReturn("B", DAY_MS * (index + 1), 0.02);
    }
    const correlationResult = engine.crossStrategyCorrelation();
    expect(correlationResult).toBeDefined();
    const correlation: CorrelationMatrix = requireValue(correlationResult, "correlation");
    expect(matrixValue(correlation.matrix, 0, 1)).toBeCloseTo(matrixValue(correlation.matrix, 1, 0), 6);
  });
});

describe("PortfolioRiskEngine — getEmittedRiskSignals", () => {
  test("returns empty array on a fresh engine", () => {
    expect(new PortfolioRiskEngine().getEmittedRiskSignals()).toEqual([]);
  });

  test("returns a copy (not a reference) of the internal emitted list", () => {
    const engine = new PortfolioRiskEngine();
    const beforeEmission = engine.getEmittedRiskSignals();
    engine.submitSignal({ kind: "risk", source: "test", reason: "coverage probe", timestamp: DAY_MS });
    expect(beforeEmission).toHaveLength(0);
    expect(engine.getEmittedRiskSignals()).toHaveLength(1);
  });
});

describe("PortfolioRiskEngine — source return validation", () => {
  test("non-finite return rejects with the public Error contract", () => {
    const engine = new PortfolioRiskEngine();
    let thrown: unknown;

    try {
      engine.recordSourceReturn("strategy-A", DAY_MS, NaN);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) throw new Error("Expected source-return validation to throw an Error.");
    expect(thrown.constructor).toBe(Error);
    expect(thrown.message).toContain("returnPct must be a finite number");
  });

  test("rejects invalid public numeric inputs and rethrows unexpected guard errors", () => {
    expect(
      () => new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, maxAggregateDrawdownPct: 0 }),
    ).toThrow(/maxAggregateDrawdownPct/);

    const engine = new PortfolioRiskEngine();
    expect(() => {
      engine.recordSourceReturn("strategy-A", 0, 0.01);
    }).toThrow(/timestamp/);
    expect(() => {
      engine.recordEquitySnapshot(DAY_MS, 0);
    }).toThrow(/equityUsd/);
    expect(() => engine.portfolioVaR(0)).toThrow(/capital/);

    engine.submitSignal(makeSizing("strategy-A", "BTC/USDT", 10_000, DAY_MS));
    expect(() => engine.leverageInvariantGuard(NaN)).toThrow(TypeError);
  });
});
