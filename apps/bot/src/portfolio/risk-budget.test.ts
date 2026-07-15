/**
 * apps/bot/src/portfolio/risk-budget.test.ts
 *
 * A `RiskBudgetAllocator` unit tesztjei — weight allokáció, korreláció
 * penalty, edge case-ek (1 stratégia, nincs provider, threshold = 1, stb.).
 */

import { describe, expect, it } from "bun:test";

import {
  RiskBudgetAllocator,
  RISK_BUDGET_HARD_CAPS,
  type StrategyRiskConfig,
} from "./risk-budget.js";

function makeConfigs(entries: readonly (readonly [string, number, number])[]): Map<string, StrategyRiskConfig> {
  const map = new Map<string, StrategyRiskConfig>();
  for (const [id, weight, riskPerTrade] of entries) {
    map.set(id, { strategyId: id, weight, riskPerTrade });
  }
  return map;
}

function makeMatrix(rows: readonly (readonly [string, readonly (readonly [string, number])[]])[]): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const matrix = new Map<string, ReadonlyMap<string, number>>();
  for (const [id, cells] of rows) {
    const row = new Map<string, number>();
    for (const [otherId, corr] of cells) {
      row.set(otherId, corr);
    }
    matrix.set(id, row);
  }
  return matrix;
}

describe("RiskBudgetAllocator", () => {
  // ---------------------------------------------------------------------------
  // 1) Constructor validation
  // ---------------------------------------------------------------------------
  describe("constructor", () => {
    it("accepts valid totalRiskUsd", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100 });
      expect(alloc.getTotalRiskUsd()).toBe(100);
      expect(alloc.getCorrelationPenaltyThreshold()).toBe(0.7);
    });

    it("accepts custom threshold", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 0.5 });
      expect(alloc.getCorrelationPenaltyThreshold()).toBe(0.5);
    });

    it("rejects zero/negative totalRiskUsd", () => {
      expect(() => new RiskBudgetAllocator({ totalRiskUsd: 0 })).toThrow(RangeError);
      expect(() => new RiskBudgetAllocator({ totalRiskUsd: -1 })).toThrow(RangeError);
    });

    it("rejects non-finite totalRiskUsd", () => {
      expect(() => new RiskBudgetAllocator({ totalRiskUsd: Number.NaN })).toThrow(RangeError);
      expect(() => new RiskBudgetAllocator({ totalRiskUsd: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    });

    it("rejects totalRiskUsd above hard cap", () => {
      expect(() => new RiskBudgetAllocator({ totalRiskUsd: RISK_BUDGET_HARD_CAPS.totalRiskUsdMax + 1 })).toThrow(RangeError);
    });

    it("accepts totalRiskUsd at the hard cap", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: RISK_BUDGET_HARD_CAPS.totalRiskUsdMax });
      expect(alloc.getTotalRiskUsd()).toBe(RISK_BUDGET_HARD_CAPS.totalRiskUsdMax);
    });

    it("rejects threshold outside [0..1]", () => {
      expect(() => new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: -0.1 })).toThrow(RangeError);
      expect(() => new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 1.1 })).toThrow(RangeError);
    });
  });

  // ---------------------------------------------------------------------------
  // 2) Weight allocation
  // ---------------------------------------------------------------------------
  describe("weight allocation", () => {
    it("returns empty map for empty configs", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100 });
      const result = alloc.computeBudgets(new Map());
      expect(result.size).toBe(0);
    });

    it("allocates total_risk × weight when weights sum to 1", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100 });
      const configs = makeConfigs([
        ["carry-a", 0.5, 0.01],
        ["carry-b", 0.3, 0.01],
        ["ohlc", 0.2, 0.01],
      ]);
      const result = alloc.computeBudgets(configs);
      expect(result.size).toBe(3);
      // 100 × 0.5 = 50, no correlation penalty
      expect(result.get("carry-a")?.finalBudgetUsd).toBeCloseTo(50, 5);
      expect(result.get("carry-b")?.finalBudgetUsd).toBeCloseTo(30, 5);
      expect(result.get("ohlc")?.finalBudgetUsd).toBeCloseTo(20, 5);
    });

    it("normalizes weights that don't sum to 1", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100 });
      // Weights sum to 3, so normalized = weight/3
      const configs = makeConfigs([
        ["a", 2, 0.01],
        ["b", 1, 0.01],
      ]);
      const result = alloc.computeBudgets(configs);
      // a: 100 × 2/3 = 66.667, b: 100 × 1/3 = 33.333
      expect(result.get("a")?.finalBudgetUsd).toBeCloseTo(66.6667, 3);
      expect(result.get("b")?.finalBudgetUsd).toBeCloseTo(33.3333, 3);
    });

    it("exposes weight and raw budget in breakdown", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 200 });
      // Two strategies so weight is normalized to 0.4 / 0.5 = 0.8 of the
      // remaining budget. The `a` strategy keeps 0.4 out of 0.5 total weight.
      const configs = makeConfigs([
        ["a", 0.4, 0.01],
        ["b", 0.1, 0.01],
      ]);
      const result = alloc.computeBudgets(configs);
      const b = result.get("a");
      // a's share of the budget = 0.4 / (0.4 + 0.1) = 0.8
      expect(b?.weight).toBeCloseTo(0.8, 5);
      // raw budget = 200 * 0.8 = 160
      expect(b?.rawBudgetUsd).toBeCloseTo(160, 5);
      // no correlation → final = raw
      expect(b?.finalBudgetUsd).toBeCloseTo(160, 5);
    });
  });

  // ---------------------------------------------------------------------------
  // 3) Correlation penalty
  // ---------------------------------------------------------------------------
  describe("correlation penalty", () => {
    it("applies no penalty when max correlation < threshold", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 0.7 });
      const configs = makeConfigs([
        ["a", 0.5, 0.01],
        ["b", 0.5, 0.01],
      ]);
      const matrix = makeMatrix([
        ["a", [["a", 1], ["b", 0.6]]],
        ["b", [["a", 0.6], ["b", 1]]],
      ]);
      const result = alloc.computeBudgets(configs, () => matrix);
      // corr 0.6 < threshold 0.7 → no penalty
      expect(result.get("a")?.penalty).toBe(0);
      expect(result.get("b")?.penalty).toBe(0);
      expect(result.get("a")?.finalBudgetUsd).toBeCloseTo(50, 5);
      expect(result.get("b")?.finalBudgetUsd).toBeCloseTo(50, 5);
    });

    it("applies linear penalty when max correlation >= threshold", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 0.7 });
      const configs = makeConfigs([
        ["a", 0.5, 0.01],
        ["b", 0.5, 0.01],
      ]);
      const matrix = makeMatrix([
        ["a", [["a", 1], ["b", 0.9]]],
        ["b", [["a", 0.9], ["b", 1]]],
      ]);
      const result = alloc.computeBudgets(configs, () => matrix);
      // penalty = (0.9 - 0.7) / (1 - 0.7) = 0.2/0.3 = 0.6667
      expect(result.get("a")?.penalty).toBeCloseTo(0.6667, 3);
      expect(result.get("b")?.penalty).toBeCloseTo(0.6667, 3);
      // final = 50 * (1 - 0.6667) = 50 * 0.3333 = 16.6667
      expect(result.get("a")?.finalBudgetUsd).toBeCloseTo(16.6667, 3);
      expect(result.get("b")?.finalBudgetUsd).toBeCloseTo(16.6667, 3);
    });

    it("penalty = 1 at correlation = 1", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 0.7 });
      const configs = makeConfigs([
        ["a", 0.5, 0.01],
        ["b", 0.5, 0.01],
      ]);
      const matrix = makeMatrix([
        ["a", [["a", 1], ["b", 1]]],
        ["b", [["a", 1], ["b", 1]]],
      ]);
      const result = alloc.computeBudgets(configs, () => matrix);
      // (1 - 0.7) / (1 - 0.7) = 1
      expect(result.get("a")?.penalty).toBeCloseTo(1, 5);
      expect(result.get("b")?.penalty).toBeCloseTo(1, 5);
      // final = 50 * 0 = 0
      expect(result.get("a")?.finalBudgetUsd).toBe(0);
      expect(result.get("b")?.finalBudgetUsd).toBe(0);
    });

    it("uses absolute correlation (negative correlation also penalizes)", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 0.7 });
      const configs = makeConfigs([
        ["a", 0.5, 0.01],
        ["b", 0.5, 0.01],
      ]);
      const matrix = makeMatrix([
        ["a", [["a", 1], ["b", -0.9]]],
        ["b", [["a", -0.9], ["b", 1]]],
      ]);
      const result = alloc.computeBudgets(configs, () => matrix);
      // |−0.9| = 0.9 → penalty = 0.6667
      expect(result.get("a")?.penalty).toBeCloseTo(0.6667, 3);
    });

    it("penalty is 0 when threshold = 1 (no correlation reaches the cap)", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 1 });
      const configs = makeConfigs([
        ["a", 0.5, 0.01],
        ["b", 0.5, 0.01],
      ]);
      const matrix = makeMatrix([
        ["a", [["a", 1], ["b", 0.99]]],
        ["b", [["a", 0.99], ["b", 1]]],
      ]);
      const result = alloc.computeBudgets(configs, () => matrix);
      // threshold=1 → (1-1) is 0, span guard returns penalty=0
      expect(result.get("a")?.penalty).toBe(0);
      expect(result.get("b")?.penalty).toBe(0);
    });

    it("max correlation is taken across all other strategies", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 0.5 });
      const configs = makeConfigs([
        ["a", 0.33, 0.01],
        ["b", 0.33, 0.01],
        ["c", 0.34, 0.01],
      ]);
      // a-b corr = 0.3, a-c corr = 0.8 → max for a is 0.8
      const matrix = makeMatrix([
        ["a", [["a", 1], ["b", 0.3], ["c", 0.8]]],
        ["b", [["a", 0.3], ["b", 1], ["c", 0.4]]],
        ["c", [["a", 0.8], ["b", 0.4], ["c", 1]]],
      ]);
      const result = alloc.computeBudgets(configs, () => matrix);
      expect(result.get("a")?.maxCorrelation).toBeCloseTo(0.8, 5);
      expect(result.get("a")?.penalty).toBeCloseTo(0.6, 5); // (0.8-0.5)/0.5
      expect(result.get("b")?.maxCorrelation).toBeCloseTo(0.4, 5);
      expect(result.get("b")?.penalty).toBe(0);
      expect(result.get("c")?.maxCorrelation).toBeCloseTo(0.8, 5);
    });
  });

  // ---------------------------------------------------------------------------
  // 4) Edge cases
  // ---------------------------------------------------------------------------
  describe("edge cases", () => {
    it("single strategy gets full budget (no correlation)", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100 });
      const configs = makeConfigs([["only", 1, 0.01]]);
      const matrix = makeMatrix([["only", [["only", 1]]]]);
      const result = alloc.computeBudgets(configs, () => matrix);
      expect(result.get("only")?.maxCorrelation).toBe(0);
      expect(result.get("only")?.finalBudgetUsd).toBeCloseTo(100, 5);
    });

    it("no correlation provider → penalty is 0 for all", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 0.5 });
      const configs = makeConfigs([
        ["a", 0.5, 0.01],
        ["b", 0.5, 0.01],
      ]);
      const result = alloc.computeBudgets(configs);
      expect(result.get("a")?.penalty).toBe(0);
      expect(result.get("b")?.penalty).toBe(0);
      expect(result.get("a")?.maxCorrelation).toBe(0);
    });

    it("non-finite correlation in matrix is treated as 0", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 0.5 });
      const configs = makeConfigs([
        ["a", 0.5, 0.01],
        ["b", 0.5, 0.01],
      ]);
      const matrix = makeMatrix([
        ["a", [["a", 1], ["b", Number.NaN]]],
        ["b", [["a", Number.NaN], ["b", 1]]],
      ]);
      const result = alloc.computeBudgets(configs, () => matrix);
      // NaN is filtered out → maxCorrelation = 0
      expect(result.get("a")?.maxCorrelation).toBe(0);
      expect(result.get("a")?.penalty).toBe(0);
    });

    it("missing own row in matrix → no correlation", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold: 0.5 });
      const configs = makeConfigs([
        ["a", 0.5, 0.01],
        ["b", 0.5, 0.01],
      ]);
      // a has no row at all
      const matrix = makeMatrix([
        ["b", [["a", 0.9], ["b", 1]]],
      ]);
      const result = alloc.computeBudgets(configs, () => matrix);
      expect(result.get("a")?.maxCorrelation).toBe(0);
    });

    it("computeBudgets is pure (does not mutate inputs)", () => {
      const alloc = new RiskBudgetAllocator({ totalRiskUsd: 100 });
      const configs = makeConfigs([["a", 0.5, 0.01], ["b", 0.5, 0.01]]);
      const matrix = makeMatrix([
        ["a", [["a", 1], ["b", 0.9]]],
        ["b", [["a", 0.9], ["b", 1]]],
      ]);
      const resultA = alloc.computeBudgets(configs, () => matrix);
      const resultB = alloc.computeBudgets(configs, () => matrix);
      expect(resultA.get("a")?.finalBudgetUsd).toBe(resultB.get("a")?.finalBudgetUsd);
      expect(configs.size).toBe(2);
      expect(matrix.size).toBe(2);
    });
  });
});
