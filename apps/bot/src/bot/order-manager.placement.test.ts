import { describe, expect, it } from "vitest";

import type { Order, OrderRequest } from "@mm-crypto-bot/exchange";
import { SelectedLeverage } from "@mm-crypto-bot/numeric";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import { RecordingLogger } from "@logging-testing";

import { OrderManager as RuntimeOrderManager, OrderManagerError } from "./order-manager.js";
import { OrderManager, makePosition, makeSignal, makeSymbol } from "./order-manager.test-support.js";

class RecordingOrderFeed extends MockExchangeFeed {
  public readonly submittedRequests: OrderRequest[] = [];

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    this.submittedRequests.push(request);
    return super.placeOrder(request);
  }
}

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
    expect(order.symbol).toBe(makeSymbol());
    expect(order.side).toBe("buy");
    expect(order.amount).toBe(0.01);
    expect(order.status).toBe("open");
  });

  it("sets the immutable selected 10x value independently from effective risk leverage", async () => {
    const feed = new RecordingOrderFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });

    await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
      leverage: 1,
    });

    expect(feed.submittedRequests).toHaveLength(1);
    expect(feed.submittedRequests[0]?.selectedSpotMarginLeverage).toBe(SelectedLeverage.initialBaseline);
  });

  it("keeps the default paper receipt fully filled without submitting to the feed", async () => {
    const feed = new RecordingOrderFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      paperMode: true,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });

    const order = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
    });

    expect(order).toMatchObject({ status: "closed", filled: 0.01, average: 60_000 });
    expect(feed.submittedRequests).toEqual([]);
    expect(manager.getCounters()).toEqual({ placed: 1, filled: 1, cancelled: 0, rejected: 0 });
    expect(manager.getInFlightCount()).toBe(0);
  });

  it("returns an unfilled paper receipt without retaining capacity or fill counters", async () => {
    const feed = new RecordingOrderFeed();
    await feed.open();
    const inputs: Parameters<
      NonNullable<ConstructorParameters<typeof RuntimeOrderManager>[0]["paperOrderSimulator"]>
    >[0][] = [];
    const manager = new OrderManager({
      feed,
      paperMode: true,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
      paperOrderSimulator: (input) => {
        inputs.push(input);
        return "unfilled";
      },
    });

    const first = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
    });
    const second = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
    });

    expect(first).toMatchObject({ status: "canceled", filled: 0 });
    expect(second).toMatchObject({ status: "canceled", filled: 0 });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ intent: { amount: 0.01 }, placedCount: 0 });
    expect(inputs[1]).toMatchObject({ intent: { amount: 0.01 }, placedCount: 1 });
    expect(manager.getCounters()).toEqual({ placed: 2, filled: 0, cancelled: 0, rejected: 0 });
    expect(manager.getInFlightCount()).toBe(0);
    expect(feed.submittedRequests).toEqual([]);
  });

  it("rejects a failing paper simulator without placing or retaining a reservation", async () => {
    const feed = new RecordingOrderFeed();
    const logger = new RecordingLogger();
    const failure = new Error("scripted paper simulator failure");
    await feed.open();
    const manager = new RuntimeOrderManager({
      feed,
      paperMode: true,
      logger,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
      paperOrderSimulator: () => {
        throw failure;
      },
    });

    await expect(
      manager.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 0.01,
        referencePrice: 60_000,
        type: "market",
      }),
    ).rejects.toThrow("): Error: scripted paper simulator failure");
    expect(manager.getCounters()).toEqual({ placed: 0, filled: 0, cancelled: 0, rejected: 1 });
    expect(manager.getInFlightCount()).toBe(0);
    expect(feed.submittedRequests).toEqual([]);
    const simulatorFailure = logger.getCalls().find((call) => call.event === "order.paper.simulator.failed");
    expect(simulatorFailure).toMatchObject({
      fields: { error: "Error: scripted paper simulator failure" },
      level: "error",
    });
  });

  it("rejects paper simulators outside paper mode", () => {
    const feed = new RecordingOrderFeed();
    expect(
      () =>
        new RuntimeOrderManager({
          feed,
          getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
          paperOrderSimulator: () => "unfilled",
        }),
    ).toThrow("[order-manager] paper order simulator is only permitted in paper mode.");
  });

  it("accepts a live entry with protective intent; native conditionals are created only after a fill", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const om = new OrderManager({ feed, getPositionContext: () => ({ equityUsd: 10_000, positions: [] }) });
    await expect(
      om.placeOrder({
        signal: { ...makeSignal(), stopLoss: 50_000, takeProfit: 70_000 },
        symbol: makeSymbol(),
        amount: 0.01,
        referencePrice: 60_000,
        type: "market",
      }),
    ).resolves.toMatchObject({ status: "open" });
    expect(om.getInFlightCount()).toBe(1);
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
  it("cancelOrder removes an order from the in-flight set", async () => {
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
  it("getCounters reports placed and rejected orders", async () => {
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

  it("forwards a positive limit price in a valid limit order", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });

    await expect(
      manager.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 0.01,
        referencePrice: 60_000,
        type: "limit",
        limitPrice: 59_000,
      }),
    ).resolves.toMatchObject({ type: "limit", price: 59_000 });
  });

  it("rejects a non-finite limit price before it reaches the feed", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const symbol = makeSymbol();

    await expect(
      manager.placeOrder({
        signal: makeSignal(),
        symbol,
        amount: 0.01,
        referencePrice: 60_000,
        type: "limit",
        limitPrice: NaN,
      }),
    ).rejects.toThrow("limit order requires positive limitPrice");
    expect(await feed.fetchOpenOrders(symbol)).toEqual([]);
  });

  it("rejects a protective order without a positive trigger price", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    await expect(
      manager.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 0.01,
        referencePrice: 60_000,
        type: "market",
        protectiveKind: "stop_loss",
        triggerPrice: 0,
      }),
    ).rejects.toThrow("requires a positive triggerPrice");
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
    expect(order.clientOrderId.length).toBeGreaterThan(0);
    expect(order.clientOrderId.startsWith("test-hint-")).toBe(true);
  });
});
