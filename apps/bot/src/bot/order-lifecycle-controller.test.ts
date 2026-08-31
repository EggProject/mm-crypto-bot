import { describe, expect, it } from "vitest";

import { makeClientOrderId, type FeedListener, type Order } from "@mm-crypto-bot/exchange";
import { RecordingLogger } from "@logging-testing";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

import { OrderLifecycleController } from "./order-manager-lifecycle.js";
import { OrderManager, makeSignal, makeSymbol } from "./order-manager.test-support.js";

interface LifecycleHarness {
  readonly controller: OrderLifecycleController;
  readonly counters: { placed: number; filled: number; cancelled: number; rejected: number };
  readonly feed: MockExchangeFeed;
  readonly logger: RecordingLogger;
}

async function createHarness(): Promise<LifecycleHarness> {
  const feed = new MockExchangeFeed();
  await feed.open();
  const logger = new RecordingLogger();
  const counters = { placed: 0, filled: 0, cancelled: 0, rejected: 0 };
  return { controller: new OrderLifecycleController(feed, logger, counters), counters, feed, logger };
}

async function createOrder(feed: MockExchangeFeed, clientOrderIdHint = "lifecycle"): Promise<Order> {
  const manager = new OrderManager({
    feed,
    getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
  });
  return manager.placeOrder({
    signal: makeSignal(),
    symbol: makeSymbol(),
    amount: 2,
    referencePrice: 100,
    type: "market",
    clientOrderIdHint,
  });
}

describe("OrderLifecycleController", () => {
  it("handles start, stop, tracked fills, and unknown feed events", async () => {
    const { controller, counters, feed } = await createHarness();
    const order = await createOrder(feed);

    await controller.start((event) => {
      controller.processFeedEvent(event);
    });
    await controller.start((event) => {
      controller.processFeedEvent(event);
    });
    controller.processFeedEvent({ kind: "order", payload: order });
    controller.recordFill(order.clientOrderId, { ...order, filled: 1, average: 100 });
    expect(controller.getInFlightCount()).toBe(0);
    controller.trackPlaced(order);
    expect(controller.getInFlightOrderIds()).toEqual([order.clientOrderId]);
    expect(controller.getCancellableOrders(new Set([order.clientOrderId]))).toEqual([]);
    controller.recordFill(order.clientOrderId, { ...order, status: "closed", filled: 2, average: 100 });
    expect(controller.getInFlightCount()).toBe(0);
    expect(counters.filled).toBe(1);
    controller.recordFill(order.clientOrderId, { ...order, status: "canceled", filled: 2 });
    await controller.stop();
    await controller.stop();
  });

  it("subscribes to both private streams once and emits correlated updates", async () => {
    const { controller, feed } = await createHarness();
    const order = await createOrder(feed);
    const events: string[] = [];
    let orderListener: FeedListener | undefined;
    let executionListener: FeedListener | undefined;
    const unsubscribed: number[] = [];
    Object.assign(feed, {
      subscribeOrderUpdates: (listener: FeedListener) => {
        orderListener = listener;
        return Promise.resolve(1);
      },
      subscribeExecutions: (listener: FeedListener) => {
        executionListener = listener;
        return Promise.resolve(2);
      },
      unsubscribe: (id: number) => {
        unsubscribed.push(id);
        return Promise.resolve();
      },
    });
    controller.onLifecycle((event) => {
      events.push(`${event.kind}:${String(event.deltaFilled)}`);
    });
    controller.trackPlaced(order);

    await controller.start((event) => {
      controller.processFeedEvent(event);
    });
    await controller.start((event) => {
      controller.processFeedEvent(event);
    });
    orderListener?.({ kind: "order", payload: { ...order, filled: 1, average: 100, status: "open" } });
    executionListener?.({
      kind: "execution",
      payload: {
        executionId: "exchange-id-resolution",
        clientOrderId: undefined,
        exchangeOrderId: order.exchangeId,
        symbol: order.symbol,
        side: order.side,
        quantity: 1,
        price: 101,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 2,
      },
    });
    executionListener?.({
      kind: "execution",
      payload: {
        executionId: "exchange-id-resolution",
        clientOrderId: undefined,
        exchangeOrderId: order.exchangeId,
        symbol: order.symbol,
        side: order.side,
        quantity: 1,
        price: 101,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 2,
      },
    });
    expect(events).toEqual(["order:1", "execution:0"]);
    await controller.stop();
    expect(unsubscribed).toEqual([1, 2]);
  });

  it("preserves cancel races, terminal snapshots, and failing listeners", async () => {
    const { controller, counters, feed, logger } = await createHarness();
    const order = await createOrder(feed);
    controller.onLifecycle(() => {
      throw new Error("listener failure");
    });
    controller.onLifecycle(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- Unit test verifies public normalization of a hostile listener callback.
      throw "listener string failure";
    });
    controller.trackPlaced(order);
    controller.trackCancellation(order.clientOrderId);
    controller.processFeedEvent({ kind: "order", payload: { ...order, status: "open" } });
    expect(controller.getInFlightCount()).toBe(0);
    controller.processFeedEvent({ kind: "order", payload: { ...order, status: "canceled" } });
    feed.setOrderStatus(order.clientOrderId, { status: "closed", filled: 2, average: 100 });
    const reconciled = await controller.reconcileOrder(order.clientOrderId, order.symbol);
    expect(reconciled.deltaFilled).toBe(2);
    expect(reconciled.order.status).toBe("closed");
    expect(counters.filled).toBe(1);
    expect(logger.getCalls()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "order.lifecycle.listener.failed",
          fields: { error: "listener failure" },
        }),
        expect.objectContaining({
          event: "order.lifecycle.listener.failed",
          fields: { error: "listener string failure" },
        }),
      ]),
    );
  });

  it("ignores unresolvable executions and counts a cancelled reconciliation", async () => {
    const { controller, counters, feed } = await createHarness();
    const known = await createOrder(feed, "known");
    const unknown = await createOrder(feed, "unknown");
    controller.trackPlaced(known);
    controller.trackCancellation(unknown.clientOrderId);
    controller.processFeedEvent({
      kind: "execution",
      payload: {
        executionId: "without-order-identity",
        clientOrderId: undefined,
        exchangeOrderId: undefined,
        symbol: known.symbol,
        side: known.side,
        quantity: 1,
        price: 100,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 1,
      },
    });
    controller.processFeedEvent({
      kind: "execution",
      payload: {
        executionId: "unknown-exchange-order",
        clientOrderId: undefined,
        exchangeOrderId: unknown.exchangeId,
        symbol: unknown.symbol,
        side: unknown.side,
        quantity: 1,
        price: 100,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 3,
      },
    });
    controller.processFeedEvent({
      kind: "execution",
      payload: {
        executionId: "unknown-client-order",
        clientOrderId: unknown.clientOrderId,
        exchangeOrderId: unknown.exchangeId,
        symbol: unknown.symbol,
        side: unknown.side,
        quantity: 1,
        price: 100,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 2,
      },
    });
    feed.setOrderStatus(known.clientOrderId, { status: "canceled", filled: 0 });
    const reconciled = await controller.reconcileOrder(known.clientOrderId, known.symbol);
    expect(reconciled.order.status).toBe("canceled");
    expect(counters.cancelled).toBe(1);
  });

  it("fails closed at bounded execution deduplication capacity without forgetting an active duplicate", async () => {
    const { controller, feed } = await createHarness();
    const seed = await createOrder(feed, "deduplication-capacity");
    const order = { ...seed, amount: 5001 };
    controller.trackPlaced(order);
    const lifecycleEvents: Order[] = [];
    controller.onLifecycle((event) => {
      if (event.kind === "execution") lifecycleEvents.push(event.order);
    });
    for (let sequence = 0; sequence < 5000; sequence++) {
      controller.processFeedEvent({
        kind: "execution",
        payload: {
          executionId: `deduplication-${String(sequence)}`,
          clientOrderId: order.clientOrderId,
          exchangeOrderId: order.exchangeId,
          symbol: order.symbol,
          side: order.side,
          quantity: 1,
          price: 100,
          fee: 0,
          feeCurrency: "USDC",
          timestamp: sequence,
        },
      });
    }
    controller.processFeedEvent({
      kind: "execution",
      payload: {
        executionId: "deduplication-0",
        clientOrderId: order.clientOrderId,
        exchangeOrderId: order.exchangeId,
        symbol: order.symbol,
        side: order.side,
        quantity: 1,
        price: 100,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 5000,
      },
    });
    expect(lifecycleEvents).toHaveLength(5000);
    expect(lifecycleEvents.at(-1)).toMatchObject({ filled: 5000, average: 100 });
    expect(() => {
      controller.processFeedEvent({
        kind: "execution",
        payload: {
          executionId: "deduplication-overflow",
          clientOrderId: order.clientOrderId,
          exchangeOrderId: order.exchangeId,
          symbol: order.symbol,
          side: order.side,
          quantity: 1,
          price: 100,
          fee: 0,
          feeCurrency: "USDC",
          timestamp: 5001,
        },
      });
    }).toThrow("execution deduplication capacity exhausted");
  });

  it("bounds remembered and cancellation-race orders", async () => {
    const { controller, feed } = await createHarness();
    const orders: Order[] = [];
    let overflow: Order | undefined;
    for (let sequence = 0; sequence < 5001; sequence++) {
      const order = await feed.placeOrder({
        clientOrderId: makeClientOrderId(`bounded-${String(sequence)}`),
        symbol: makeSymbol(),
        side: "buy",
        type: "market",
        amount: 1,
      });
      if (sequence < 5000) orders.push(order);
      else overflow = order;
    }
    for (const order of orders) controller.trackPlaced(order);
    expect(overflow).toBeDefined();
    if (overflow === undefined) throw new Error("expected direct tracking overflow order");
    expect(() => {
      controller.trackPlaced(overflow);
    }).toThrow("active order capacity exhausted");
    for (const order of orders.slice(0, 1001)) controller.trackCancellation(order.clientOrderId);

    expect(controller.getInFlightCount()).toBe(3999);
  });
});
