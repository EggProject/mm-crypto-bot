import { describe, expect, it } from "bun:test";

import { makeStack, registerStrategies } from "./portfolio-manager.test-support.js";

describe("PortfolioManager", () => {
  describe("basic wiring", () => {
    it("constructs and wires the trip action to executeCloseAll", () => {
      const stack = makeStack();
      expect(stack.portfolioManager.isTripped()).toBe(false);
      expect(stack.portfolioManager.getPerStrategyBudget().size).toBe(0);
    });

    it("exposes per-strategy budget from the risk allocator", () => {
      const stack = makeStack({ totalRiskUsd: 1000 });
      registerStrategies(stack, [
        ["carry", 0.5],
        ["ohlc", 0.5],
      ]);
      const budget = stack.portfolioManager.getPerStrategyBudget();
      expect(budget.size).toBe(2);
      expect(budget.get("carry")).toBeCloseTo(500, 5);
      expect(budget.get("ohlc")).toBeCloseTo(500, 5);
    });

    it("getBudgetFor returns 0 for unknown strategy", () => {
      const stack = makeStack();
      expect(stack.portfolioManager.getBudgetFor("unknown")).toBe(0);
    });

    it("exposes correlation matrix from the correlation module", () => {
      const stack = makeStack();
      stack.correlation.recordFill("a", 0.01);
      stack.correlation.recordFill("a", 0.02);
      stack.correlation.recordFill("b", 0.02);
      stack.correlation.recordFill("b", 0.01);
      const snap = stack.portfolioManager.getCorrelationMatrix();
      expect(snap.sampleCounts.get("a")).toBe(2);
      expect(snap.sampleCounts.get("b")).toBe(2);
    });

    it("exposes portfolio stop state", () => {
      const stack = makeStack({ maxDdPct: 0.1 });
      stack.portfolioManager.recordEquity(10_000);
      const state = stack.portfolioManager.getStopState();
      expect(state.peakEquityUsd).toBe(10_000);
      expect(state.drawdownPct).toBe(0);
      expect(state.tripped).toBe(false);
    });

    it("getPortfolioState returns the aggregated state", () => {
      const stack = makeStack();
      registerStrategies(stack, [["a", 1]]);
      const portfolio = stack.portfolioManager.getPortfolioState();
      expect(portfolio.isTripped).toBe(false);
      expect(portfolio.perStrategyBudgetUsd.size).toBe(1);
      expect(portfolio.budgetBreakdowns.size).toBe(1);
      expect(portfolio.strategyRiskConfigs.size).toBe(1);
      expect(portfolio.correlation.windowSize).toBe(30);
    });
  });

  // ---------------------------------------------------------------------------
  // 2) Strategy config management
  // ---------------------------------------------------------------------------
});
