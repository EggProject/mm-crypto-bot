import { describe, expect, it } from "bun:test";

import { makeStack } from "./portfolio-manager.test-support.js";

describe("PortfolioManager", () => {
  describe("strategy config", () => {
    it("setStrategyConfig registers a strategy", () => {
      const stack = makeStack();
      stack.portfolioManager.setStrategyConfig({ strategyId: "x", weight: 0.3, riskPerTrade: 0.01 });
      expect(stack.portfolioManager.getStrategyConfigs().size).toBe(1);
    });

    it("setStrategyConfig overwrites an existing entry", () => {
      const stack = makeStack();
      stack.portfolioManager.setStrategyConfig({ strategyId: "x", weight: 0.3, riskPerTrade: 0.01 });
      stack.portfolioManager.setStrategyConfig({ strategyId: "x", weight: 0.7, riskPerTrade: 0.01 });
      const cfgs = stack.portfolioManager.getStrategyConfigs();
      expect(cfgs.size).toBe(1);
      expect(cfgs.get("x")?.weight).toBe(0.7);
    });

    it("removeStrategyConfig removes and forgets correlation", () => {
      const stack = makeStack();
      stack.portfolioManager.setStrategyConfig({ strategyId: "x", weight: 0.5, riskPerTrade: 0.01 });
      stack.correlation.recordFill("x", 0.01);
      expect(stack.correlation.getSampleCount("x")).toBe(1);
      stack.portfolioManager.removeStrategyConfig("x");
      expect(stack.portfolioManager.getStrategyConfigs().size).toBe(0);
      expect(stack.correlation.getSampleCount("x")).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3) recordFill updates correlation + re-computes budgets
  // ---------------------------------------------------------------------------
});
