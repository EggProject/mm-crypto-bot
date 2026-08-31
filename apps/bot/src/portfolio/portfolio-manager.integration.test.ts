import { describe, expect, it } from "bun:test";

import { makeSymbol, makeStack } from "./portfolio-manager.test-support.js";

describe("PortfolioManager", () => {
  describe("end-to-end integration", () => {
    it("isTripped() is observable from the strategy-runner perspective", async () => {
      const stack = makeStack({ maxDdPct: 0.05 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      // Simulate a 6% drawdown
      stack.portfolioManager.recordEquity(100_000);
      expect(stack.portfolioManager.isTripped()).toBe(false);
      await stack.portfolioManager.recordEquityAndSettle(94_000);
      expect(stack.portfolioManager.isTripped()).toBe(true);
    });

    it("getPortfolioState reports tripped state", async () => {
      const stack = makeStack({ maxDdPct: 0.05 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(90_000);
      const state = stack.portfolioManager.getPortfolioState();
      expect(state.isTripped).toBe(true);
      expect(state.stopState.tripped).toBe(true);
      expect(state.stopState.trippedAt).not.toBeNull();
    });
  });
});
