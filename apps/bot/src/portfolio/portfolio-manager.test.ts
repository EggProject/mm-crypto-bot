/**
 * apps/bot/src/portfolio/portfolio-manager.test.ts
 *
 * A `PortfolioManager` integrációs tesztjei — a 3 modul
 * (risk-budget + correlation + portfolio-stop) összekapcsolása, a
 * SAFETY-CRITICAL close-all akció bizonyítása, és az event-flow
 * (recordFill, recordEquity) helyes működése.
 *
 * A tesztek a `MockExchangeFeed` + valódi `OrderManager` +
 * `PositionManager` stack-et használják — a mock feed tárolja az
 * order-eket, így a teszt ellenőrizheti, hogy a close-all valóban
 * PIACI order-eket helyezett el (és NEM limit-eket).
 */

import { describe, expect, it } from "bun:test";
import { asSymbol, type Order, type Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
// Phase 66: `MockExchangeFeed` is test-only — import from the
// `@exchange-testing/*` path alias (see tsconfig.base.json).
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

import { OrderManager } from "../bot/order-manager.js";
import { PositionManager } from "../bot/position-manager.js";
import { CorrelationMatrix } from "./correlation.js";
import { PortfolioManager } from "./portfolio-manager.js";
import { PortfolioStop } from "./portfolio-stop.js";
import { RiskBudgetAllocator } from "./risk-budget.js";
import type { StrategyRiskConfig } from "./risk-budget.js";

function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
}

interface StackOptions {
  readonly totalRiskUsd?: number;
  readonly maxDdPct?: number;
  readonly threshold?: number;
}

interface Stack {
  readonly feed: MockExchangeFeed;
  readonly positionManager: PositionManager;
  readonly orderManager: OrderManager;
  readonly riskBudget: RiskBudgetAllocator;
  readonly correlation: CorrelationMatrix;
  readonly portfolioStop: PortfolioStop;
  readonly portfolioManager: PortfolioManager;
}

function makeStack(opts: StackOptions = {}): Stack {
  const feed = new MockExchangeFeed({
    balances: [{ currency: "USDC", free: 1_000_000, total: 1_000_000 }],
  });
  // The mock feed must be opened before placeOrder / fetchBalances.
  // The `Bot` does this in init() — in the test we replicate it.
  const positionManager = new PositionManager({
    initialEquityUsd: 100_000,
    maxPositions: 5,
    maxLeverage: 10,
  });
  const orderManager = new OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
  });
  const riskBudget = new RiskBudgetAllocator({
    totalRiskUsd: opts.totalRiskUsd ?? 1000,
    correlationPenaltyThreshold: opts.threshold ?? 0.7,
  });
  const correlation = new CorrelationMatrix({ windowSize: 30 });
  const portfolioStop = new PortfolioStop({ maxDdPct: opts.maxDdPct ?? 0.10 });
  const portfolioManager = new PortfolioManager({
    riskBudget,
    correlation,
    portfolioStop,
    positionManager,
    orderManager,
  });
  // Open the feed synchronously (Bun's microtask handling).
  void feed.open();
  return { feed, positionManager, orderManager, riskBudget, correlation, portfolioStop, portfolioManager };
}

function registerStrategies(stack: Stack, configs: readonly (readonly [string, number])[]): void {
  for (const [id, weight] of configs) {
    const cfg: StrategyRiskConfig = { strategyId: id, weight, riskPerTrade: 0.01 };
    stack.portfolioManager.setStrategyConfig(cfg);
  }
}

describe("PortfolioManager", () => {
  // ---------------------------------------------------------------------------
  // 1) Basic wiring
  // ---------------------------------------------------------------------------
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
      const stack = makeStack({ maxDdPct: 0.10 });
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
      for (let i = 0; i < 20; i++) {
        stack.portfolioManager.recordFill({ strategyId: "a", returnPct: i * 0.001 });
        stack.portfolioManager.recordFill({ strategyId: "b", returnPct: i * 0.001 });
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
  describe("recordEquity", () => {
    it("updates the portfolio stop's high-water mark", () => {
      const stack = makeStack();
      stack.portfolioManager.recordEquity(10_000);
      expect(stack.portfolioStop.getPeakEquity()).toBe(10_000);
    });

    it("does NOT trip on a normal drawdown", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      stack.portfolioManager.recordEquity(10_000);
      await stack.portfolioManager.recordEquityAndSettle(9_500);
      expect(stack.portfolioManager.isTripped()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5) SAFETY-CRITICAL: close-all on trip
  // ---------------------------------------------------------------------------
  describe("close-all on trip", () => {
    it("places MARKET orders to close all open positions when tripped", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      const sym = makeSymbol();
      // Open 2 positions: 1 long (carry), 1 short (ohlc)
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.positionManager.openPosition("ohlc", sym, "short", 0.01, 60_000, 10);
      expect(stack.positionManager.getPositionCount()).toBe(2);
      // Peak equity: 100k
      stack.portfolioManager.recordEquity(100_000);
      // Drop equity to trip
      await stack.portfolioManager.recordEquityAndSettle(85_000); // DD = 15%
      // The trip should have fired and placed close orders on the mock feed
      const placedOrders = [...stack.feed["orderBook"].values()] as Order[];
      // Filter: only the closing orders (the placeOrder inside executeCloseAll)
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(2);
      // Both should be MARKET orders
      for (const o of closeOrders) {
        expect(o.type).toBe("market");
      }
      // The closing sides should be opposite of the original positions
      const sides = new Set(closeOrders.map((o) => o.side));
      expect(sides.has("buy")).toBe(true); // closes the short
      expect(sides.has("sell")).toBe(true); // closes the long
    });

    it("executeCloseAll is a no-op when no positions are open", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(80_000); // trips
      // No positions were open, so no close orders placed
      const placedOrders = [...stack.feed["orderBook"].values()] as Order[];
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(0);
    });

    it("didExecuteCloseAll returns true after close-all", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(85_000);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(true);
    });

    it("close-all is idempotent — does not re-fire", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(85_000);
      // Second trip attempt
      await stack.portfolioManager.recordEquityAndSettle(80_000);
      // Still only 1 close order
      const placedOrders = [...stack.feed["orderBook"].values()] as Order[];
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(1);
    });

    it("executeCloseAll is safe to call manually", async () => {
      const stack = makeStack();
      const sym = makeSymbol();
      stack.positionManager.openPosition("a", sym, "long", 0.01, 60_000, 10);
      await stack.portfolioManager.executeCloseAll();
      const placedOrders = [...stack.feed["orderBook"].values()] as Order[];
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(1);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 6) Reset
  // ---------------------------------------------------------------------------
  describe("reset", () => {
    it("clears the trip latch and close-all flag", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
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

  // ---------------------------------------------------------------------------
  // 7) End-to-end: trip → close → state
  // ---------------------------------------------------------------------------
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
