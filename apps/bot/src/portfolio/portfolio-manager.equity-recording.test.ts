import { describe, expect, it } from "bun:test";

import { makeStack } from "./portfolio-manager.test-support.js";

describe("PortfolioManager", () => {
  describe("recordEquity", () => {
    it("updates the portfolio stop's high-water mark", () => {
      const stack = makeStack();
      stack.portfolioManager.recordEquity(10_000);
      expect(stack.portfolioStop.getPeakEquity()).toBe(10_000);
    });

    it("does NOT trip on a normal drawdown", async () => {
      const stack = makeStack({ maxDdPct: 0.1 });
      stack.portfolioManager.recordEquity(10_000);
      await stack.portfolioManager.recordEquityAndSettle(9500);
      expect(stack.portfolioManager.isTripped()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5) SAFETY-CRITICAL: close-all on trip
  // ---------------------------------------------------------------------------
});
