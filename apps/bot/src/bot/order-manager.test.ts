import { describe, expect, it } from "vitest";

import { type Execution, type FeedListener } from "@mm-crypto-bot/exchange";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

import { OrderManager, makeSignal, makeSymbol } from "./order-manager.test-support.js";

describe("OrderManager", () => {
  it("blocks stale new exposure before feed while permitting reduce-only closure", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    let isFresh = false;
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
      liveAuthority: {
        assertEntryAllowed: () => {
          if (!isFresh) throw new Error("stale authority");
        },
      },
    });
    const intent = {
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "market" as const,
    };
    await expect(manager.placeOrder(intent)).rejects.toThrow("live authority rejected");
    const openOrders = await feed.fetchOpenOrders(intent.symbol);
    expect(openOrders.length).toBe(0);
    await expect(manager.placeOrder({ ...intent, reduceOnly: true })).resolves.toBeDefined();
    isFresh = true;
    await expect(manager.placeOrder(intent)).resolves.toBeDefined();
  });
  it("stops lifecycle notifications after the returned unsubscribe function runs", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    let orderListener: FeedListener | undefined;
    Object.assign(feed, {
      subscribeOrderUpdates: (listener: FeedListener) => {
        orderListener = listener;
        return Promise.resolve(701);
      },
    });
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    let notifications = 0;
    const unsubscribe = manager.onLifecycle(() => {
      notifications += 1;
    });
    await manager.startLifecycle();
    const first = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "market",
    });
    orderListener?.({
      kind: "order",
      payload: { ...first, status: "closed", filled: 1, average: 100 },
    });
    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
    const notificationsAtUnsubscribe = notifications;
    const second = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "market",
    });
    orderListener?.({
      kind: "order",
      payload: { ...second, status: "closed", filled: 1, average: 100 },
    });
    expect(notifications).toBe(notificationsAtUnsubscribe);
    await manager.stopLifecycle();
  });

  it("enforces effective leveraged exposure before the feed boundary", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const globalOne = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
      aggregateExposureLimit: { maxAggregateEffectiveLeverage: 1, tolerance: 0, warnOnApproach: 0.95 },
    });
    await expect(
      globalOne.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 1,
        referencePrice: 20_000,
        type: "market",
        leverage: 10,
      }),
    ).rejects.toThrow("invalid effective leverage");
    const rejectedOrderOpenOrders = await feed.fetchOpenOrders(makeSymbol());
    expect(rejectedOrderOpenOrders.length).toBe(0);

    const globalTen = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
      aggregateExposureLimit: { maxAggregateEffectiveLeverage: 10, tolerance: 0, warnOnApproach: 0.95 },
    });
    await expect(
      globalTen.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 1,
        referencePrice: 20_000,
        type: "market",
        leverage: 1,
      }),
    ).resolves.toBeDefined();
  });

  it("deduplicates private executions and resolves a Filled/cancel race without a ticker", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    let orderListener: FeedListener | undefined;
    let executionListener: FeedListener | undefined;
    let unsubscribed = 0;
    const originalUnsubscribe = feed.unsubscribe.bind(feed);
    Object.assign(feed, {
      subscribeOrderUpdates: (listener: FeedListener) => {
        orderListener = listener;
        return Promise.resolve(901);
      },
      subscribeExecutions: (listener: FeedListener) => {
        executionListener = listener;
        return Promise.resolve(902);
      },
      unsubscribe: async (id: number) => {
        unsubscribed++;
        await originalUnsubscribe(id);
      },
    });
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const deltas: number[] = [];
    manager.onLifecycle((event) => {
      if (event.deltaFilled > 0) deltas.push(event.deltaFilled);
    });
    await manager.startLifecycle();
    const order = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 2,
      referencePrice: 100,
      type: "market",
    });
    const execution = (id: string, quantity: number, price: number): Execution => ({
      executionId: id,
      clientOrderId: order.clientOrderId,
      exchangeOrderId: order.exchangeId,
      symbol: makeSymbol(),
      side: "buy",
      quantity,
      price,
      fee: 0.01,
      feeCurrency: "USDC",
      timestamp: Date.now(),
    });
    executionListener?.({ kind: "execution", payload: execution("exec-2", 1, 101) });
    executionListener?.({ kind: "execution", payload: execution("exec-2", 1, 101) }); // duplicate
    executionListener?.({ kind: "execution", payload: execution("exec-1", 1, 99) }); // out of order
    orderListener?.({
      kind: "order",
      payload: { ...order, status: "canceled", filled: 2, average: 100 },
    });
    expect(deltas).toEqual([1, 1]);
    expect(manager.getInFlightCount()).toBe(0);
    await manager.stopLifecycle();
    expect(unsubscribed).toBe(2);
  });

  it("cross-correlates order snapshots and executions in either arrival order without double booking", async () => {
    for (const isOrderFirst of [true, false]) {
      const feed = new MockExchangeFeed();
      await feed.open();
      let orderListener: FeedListener | undefined;
      let executionListener: FeedListener | undefined;
      Object.assign(feed, {
        subscribeOrderUpdates: (listener: FeedListener) => {
          orderListener = listener;
          return Promise.resolve(1);
        },
        subscribeExecutions: (listener: FeedListener) => {
          executionListener = listener;
          return Promise.resolve(2);
        },
      });
      const manager = new OrderManager({
        feed,
        getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
      });
      const deltas: number[] = [];
      manager.onLifecycle((event) => {
        if (event.deltaFilled > 0) deltas.push(event.deltaFilled);
      });
      await manager.startLifecycle();
      const order = await manager.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 2,
        referencePrice: 100,
        type: "market",
      });
      const snapshot = { ...order, status: "open" as const, filled: 1, average: 100 };
      const firstExecution: Execution = {
        executionId: `first-${String(isOrderFirst)}`,
        clientOrderId: order.clientOrderId,
        exchangeOrderId: order.exchangeId,
        symbol: makeSymbol(),
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0.01,
        feeCurrency: "USDC",
        timestamp: 1,
      };
      if (isOrderFirst) {
        orderListener?.({ kind: "order", payload: snapshot });
        executionListener?.({ kind: "execution", payload: firstExecution });
      } else {
        executionListener?.({ kind: "execution", payload: firstExecution });
        orderListener?.({ kind: "order", payload: snapshot });
      }
      executionListener?.({
        kind: "execution",
        payload: {
          ...firstExecution,
          executionId: `second-${String(isOrderFirst)}`,
          quantity: 1,
          price: 102,
          timestamp: 2,
        },
      });
      orderListener?.({ kind: "order", payload: { ...order, status: "closed", filled: 2, average: 101 } });
      orderListener?.({ kind: "order", payload: { ...order, status: "closed", filled: 2, average: 101 } });
      expect(deltas.reduce((sum, value) => sum + value, 0)).toBe(2);
      expect(manager.getInFlightCount()).toBe(0);
      await manager.stopLifecycle();
    }
  });

  it("uses a terminal REST snapshot as restart recovery and absorbs later execution replay", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    let executionListener: FeedListener | undefined;
    Object.assign(feed, {
      subscribeExecutions: (listener: FeedListener) => {
        executionListener = listener;
        return Promise.resolve(2);
      },
    });
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const lifecycleDeltas: number[] = [];
    manager.onLifecycle((event) => {
      lifecycleDeltas.push(event.deltaFilled);
    });
    await manager.startLifecycle();
    const order = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 2,
      referencePrice: 100,
      type: "market",
    });
    feed.setOrderStatus(order.clientOrderId, { status: "closed", filled: 2, average: 101 });
    const recovered = await manager.reconcileOrder(order.clientOrderId, makeSymbol());
    expect(recovered.deltaFilled).toBe(2);
    for (const [executionId, price] of [
      ["replay-a", 100],
      ["replay-b", 102],
    ] as const) {
      executionListener?.({
        kind: "execution",
        payload: {
          executionId,
          clientOrderId: order.clientOrderId,
          exchangeOrderId: order.exchangeId,
          symbol: makeSymbol(),
          side: "buy",
          quantity: 1,
          price,
          fee: 0.01,
          feeCurrency: "USDC",
          timestamp: Date.now(),
        },
      });
    }
    expect(lifecycleDeltas.reduce((sum, value) => sum + value, 0)).toBe(0);
    await manager.stopLifecycle();
  });

  it("allows a matching reduce-only close at the exposure cap but rejects a side mismatch", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const context = {
      equityUsd: 10_000,
      positions: [{ symbol: "BTC/USDC", source: "s", effectiveNotionalUsd: 100_000 }],
    };
    const manager = new OrderManager({
      feed,
      getPositionContext: () => context,
      getReduciblePosition: () => ({ side: "long", quantity: 1 }),
    });
    await expect(
      manager.placeOrder({
        signal: { side: "sell", confidence: 1, reason: "close", stopLoss: 0, takeProfit: 0 },
        symbol: makeSymbol(),
        amount: 1,
        referencePrice: 100_000,
        type: "market",
        reduceOnly: true,
      }),
    ).resolves.toBeDefined();
    await expect(
      manager.placeOrder({
        signal: { side: "buy", confidence: 1, reason: "bad-close", stopLoss: 0, takeProfit: 0 },
        symbol: makeSymbol(),
        amount: 1,
        referencePrice: 100_000,
        type: "market",
        reduceOnly: true,
      }),
    ).rejects.toThrow("invalid reduce-only");
  });
});
