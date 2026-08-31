import { describe, expect, it } from "bun:test";

import { makeStack, registerStrategies } from "./portfolio-manager.test-support.js";

describe("PortfolioManager", () => {
  describe("recordFill", () => {
    it("appends to correlation stream", () => {
      const stack = makeStack();
      stack.portfolioManager.recordFill({ strategyId: "a", returnPct: 0.01 });
      expect(stack.correlation.getSampleCount("a")).toBe(1);
    });

    it("triggers a budget re-compute (new correlation → new penalty)", () => {
      const stack = makeStack({ totalRiskUsd: 1000, threshold: 0.5 });
      registerStrategies(stack, [
        ["a", 0.5],
        ["b", 0.5],
      ]);
      // No correlation yet → both get 500
      expect(stack.portfolioManager.getBudgetFor("a")).toBeCloseTo(500, 5);
      // Build high correlation via 20 identical pairs
      for (let index = 0; index < 20; index++) {
        stack.portfolioManager.recordFill({ strategyId: "a", returnPct: index * 0.001 });
        stack.portfolioManager.recordFill({ strategyId: "b", returnPct: index * 0.001 });
      }
      // Now correlation is ~1, threshold 0.5 → penalty 1 → budget 0
      const aBudget = stack.portfolioManager.getBudgetFor("a");
      const bBudget = stack.portfolioManager.getBudgetFor("b");
      expect(aBudget).toBeLessThan(500);
      expect(bBudget).toBeLessThan(500);
    });
  });

  // ---------------------------------------------------------------------------
  // 4) recordEquity updates the per-strategy contribution
  // ---------------------------------------------------------------------------
});
