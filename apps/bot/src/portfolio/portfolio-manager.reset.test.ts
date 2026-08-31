import { describe, expect, it } from "bun:test";

import { makeStack } from "./portfolio-manager.test-support.js";

describe("PortfolioManager", () => {
  describe("reset", () => {
    it("clears the trip latch and close-all flag", async () => {
      const stack = makeStack({ maxDdPct: 0.1 });
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(80_000);
      expect(stack.portfolioManager.isTripped()).toBe(true);
      stack.portfolioManager.reset();
      expect(stack.portfolioManager.isTripped()).toBe(false);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);
    });

    it("clears correlation streams", () => {
      const stack = makeStack();
      stack.portfolioManager.recordFill({ strategyId: "a", returnPct: 0.01 });
      stack.portfolioManager.reset();
      expect(stack.correlation.getSampleCount("a")).toBe(0);
    });
  });
});
