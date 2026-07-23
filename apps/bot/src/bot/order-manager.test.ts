/**
 * apps/bot/src/bot/order-manager.test.ts
 *
 * Az `OrderManager` unit tesztjei — a L2 leverage check + place/cancel
 * flow mock feed-del.
 */

import { describe, expect, it } from "bun:test";

import { asSymbol, type Order, type Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
// Phase 66: `MockExchangeFeed` is test-only — import from the
// `@exchange-testing/*` path alias (see tsconfig.base.json).
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import type { Position as LeveragePosition, StrategySignal } from "@mm-crypto-bot/core";

import { OrderManager, OrderManagerError } from "./order-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(side: "buy" | "sell" = "buy"): StrategySignal {
  return {
    side,
    confidence: 0.8,
    reason: "unit-test",
    stopLoss: 50_000,
    takeProfit: 70_000,
  };
}

function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
}

function makePosition(symbol: string, source: string, notional: number): LeveragePosition {
  return { symbol, source, effectiveNotionalUsd: notional };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrderManager", () => {
  // ---------------------------------------------------------------------------
  // 1) Basic placeOrder → feed.placeOrder is called
  // ---------------------------------------------------------------------------
  it("placeOrder calls feed.placeOrder with the correct OrderRequest", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const equity = 10_000;
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({
        equityUsd: equity,
        positions: [],
      }),
    });
    const signal = makeSignal("buy");
    const order = await om.placeOrder({
      signal,
      symbol: makeSymbol(),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
    });
    expect(order).toBeDefined();
    expect(order.symbol).toBe("BTC/USDC");
    expect(order.side).toBe("buy");
    expect(order.amount).toBe(0.01);
    expect(order.status).toBe("open");
  });

  // ---------------------------------------------------------------------------
  // 2) L2 leverage check: 1:10 mandate enforced before placeOrder
  // ---------------------------------------------------------------------------
  it("rejects order that would breach 1:10 leverage (L2)", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const equity = 10_000;
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({
        equityUsd: equity,
        // 95k notional existing + 6k new = 101k > 100k = 10× equity
        positions: [makePosition("BTC/USDC", "strategy-a", 95_000)],
      }),
    });
    const signal = makeSignal("buy");
    // 6k notional on 10k equity would push aggregate to 10.1× (over 10× cap).
    await expect(
      om.placeOrder({
        signal,
        symbol: makeSymbol(),
        amount: 0.1, // 0.1 × 60_000 = 6_000
        referencePrice: 60_000,
        type: "market",
      }),
    ).rejects.toThrow(OrderManagerError);
  });

  // ---------------------------------------------------------------------------
  // 3) L2 allows order at exactly 10× cap (no false-positive)
  // ---------------------------------------------------------------------------
  it("allows order that is exactly at 1:10 cap (no false-positive)", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const equity = 10_000;
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({
        equityUsd: equity,
        positions: [makePosition("BTC/USDC", "strategy-a", 99_000)],
      }),
    });
    const signal = makeSignal("buy");
    // 1k notional on 10k equity → total 100k = 10× cap (allowed).
    const order = await om.placeOrder({
      signal,
      symbol: makeSymbol(),
      amount: 1 / 60_000, // 0.00001666... × 60_000 = 1
      referencePrice: 60_000,
      type: "market",
    });
    expect(order.status).toBe("open");
  });

  // ---------------------------------------------------------------------------
  // 4) cancelOrder wraps feed.cancelOrder and removes from in-flight
  // ---------------------------------------------------------------------------
  it("cancelOrder removes order from in-flight tracking", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const order = await om.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
    });
    expect(om.getInFlightCount()).toBe(1);
    const cancelled = await om.cancelOrder(order.clientOrderId, order.symbol);
    expect(cancelled.status).toBe("canceled");
    expect(om.getInFlightCount()).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 5) getOpenOrders wraps feed.fetchOpenOrders
  // ---------------------------------------------------------------------------
  it("getOpenOrders returns feed.fetchOpenOrders", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    await om.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
    });
    const opens = await om.getOpenOrders(makeSymbol());
    expect(opens.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 6) getCounters increments placed/rejected correctly
  // ---------------------------------------------------------------------------
  it("getCounters tracks placed and rejected", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({
        equityUsd: 10_000,
        positions: [makePosition("BTC/USDC", "strategy-a", 99_999)], // too close
      }),
    });
    const countersBefore = om.getCounters();
    expect(countersBefore.placed).toBe(0);
    expect(countersBefore.rejected).toBe(0);
    // Reject: 99_999 + 0.1 × 60_000 = 105_999 > 100_000 cap
    await expect(
      om.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 0.1,
        referencePrice: 60_000,
        type: "market",
      }),
    ).rejects.toThrow(OrderManagerError);
    const countersAfter = om.getCounters();
    expect(countersAfter.rejected).toBe(1);
    expect(countersAfter.placed).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 7) recordFill updates in-flight cache
  // ---------------------------------------------------------------------------
  it("recordFill updates the in-flight order", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const order = await om.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
    });
    const filled: Order = {
      ...order,
      status: "closed",
      filled: 0.01,
      average: 60_000,
    };
    om.recordFill(order.clientOrderId, filled);
    // After fill, in-flight count is 0 (closed orders are removed).
    expect(om.getInFlightCount()).toBe(0);
    // counters.filled should be 1
    expect(om.getCounters().filled).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 8) Limit order requires limitPrice
  // ---------------------------------------------------------------------------
  it("limit order without limitPrice throws OrderManagerError", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    await expect(
      om.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 0.01,
        referencePrice: 60_000,
        type: "limit",
      }),
    ).rejects.toThrow(OrderManagerError);
  });

  // ---------------------------------------------------------------------------
  // 9) Invalid amount/price throws
  // ---------------------------------------------------------------------------
  it("invalid amount or price throws OrderManagerError", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    await expect(
      om.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 0,
        referencePrice: 60_000,
        type: "market",
      }),
    ).rejects.toThrow(OrderManagerError);
    await expect(
      om.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 0.01,
        referencePrice: 0,
        type: "market",
      }),
    ).rejects.toThrow(OrderManagerError);
  });

  // ---------------------------------------------------------------------------
  // 10) clientOrderId is generated
  // ---------------------------------------------------------------------------
  it("placeOrder generates a non-empty clientOrderId", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const om = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const order = await om.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
      clientOrderIdHint: "test-hint",
    });
    expect(order.clientOrderId).toBeDefined();
    expect(String(order.clientOrderId).length).toBeGreaterThan(0);
    expect(String(order.clientOrderId).startsWith("test-hint-")).toBe(true);
  });
});
