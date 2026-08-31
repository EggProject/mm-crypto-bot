import { describe, expect, it } from "vitest";

import { type Execution, type FeedListener, type Order, type OrderRequest } from "@mm-crypto-bot/exchange";
import { SelectedLeverage } from "@mm-crypto-bot/numeric";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import { RecordingLogger } from "@logging-testing";

import { OrderManager as RuntimeOrderManager } from "./order-manager.js";
import { OrderLifecycleController } from "./order-manager-lifecycle.js";
import { parsePaperOrderSimulationOutcome } from "./order-manager-placement.js";
import { OrderManager, makeSignal, makeSymbol } from "./order-manager.test-support.js";

class PlacementLedgerFeed extends MockExchangeFeed {
  private deferNext = false;
  private deferredFailure: Error | undefined;
  private releaseDeferredPlacement: (() => void) | undefined;
  public readonly submittedRequests: OrderRequest[] = [];

  public deferPlacement(failure?: Error): void {
    this.deferNext = true;
    this.deferredFailure = failure;
  }

  public releasePlacement(): void {
    this.releaseDeferredPlacement?.();
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    this.submittedRequests.push(request);
    const deferredFailure = this.deferredFailure;
    this.deferredFailure = undefined;
    if (this.deferNext) {
      this.deferNext = false;
      await new Promise<void>((resolve) => {
        this.releaseDeferredPlacement = resolve;
      });
    }
    if (deferredFailure !== undefined) throw deferredFailure;
    return super.placeOrder(request);
  }
}

class ConcurrentPlacementFeed extends MockExchangeFeed {
  private holdPlacements = true;
  private readonly held: {
    readonly request: OrderRequest;
    readonly deferred: ReturnType<typeof Promise.withResolvers<Order>>;
  }[] = [];
  public readonly submittedRequests: OrderRequest[] = [];

  public override placeOrder(request: OrderRequest): Promise<Order> {
    this.submittedRequests.push(request);
    if (!this.holdPlacements) return super.placeOrder(request);
    const deferred = Promise.withResolvers<Order>();
    this.held.push({ request, deferred });
    return deferred.promise;
  }

  public releaseHeldPlacements(): void {
    this.holdPlacements = false;
    const held = [...this.held];
    this.held.length = 0;
    for (const { request, deferred } of held) {
      void super.placeOrder(request).then(deferred.resolve).catch(deferred.reject);
    }
  }

  public rejectHeldPlacements(error: Error): void {
    this.holdPlacements = false;
    const held = [...this.held];
    this.held.length = 0;
    for (const { deferred } of held) deferred.reject(error);
  }
}

async function placeCapacityOrder(manager: RuntimeOrderManager): Promise<Order> {
  return manager.placeOrder({
    signal: makeSignal(),
    symbol: makeSymbol(),
    amount: 1,
    referencePrice: 100,
    type: "market",
  });
}

describe("OrderManager retained lifecycle evidence", () => {
  it("ignores market-data events at the private lifecycle controller boundary", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const counters = { placed: 0, filled: 0, cancelled: 0, rejected: 0 };
    const controller = new OrderLifecycleController(feed, new RecordingLogger(), counters);

    controller.processFeedEvent({ kind: "ticker", payload: await feed.fetchTickerSnapshot(makeSymbol()) });

    expect(controller.getInFlightCount()).toBe(0);
    expect(counters).toEqual({ placed: 0, filled: 0, cancelled: 0, rejected: 0 });
  });

  it("issues unique client and exchange IDs for concurrent delayed placements", async () => {
    const feed = new ConcurrentPlacementFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const pending = [placeCapacityOrder(manager), placeCapacityOrder(manager)];

    expect(new Set(feed.submittedRequests.map((request) => request.clientOrderId)).size).toBe(2);
    expect(
      feed.submittedRequests.every(
        (request) => request.selectedSpotMarginLeverage === SelectedLeverage.initialBaseline,
      ),
    ).toBe(true);
    feed.releaseHeldPlacements();
    const orders = await Promise.all(pending);
    expect(new Set(orders.map((order) => order.exchangeId)).size).toBe(2);

    const paperManager = new OrderManager({
      feed: new MockExchangeFeed(),
      paperMode: true,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const paperOrders = await Promise.all([
      placeCapacityOrder(paperManager),
      placeCapacityOrder(paperManager),
    ]);
    expect(new Set(paperOrders.map((order) => order.clientOrderId)).size).toBe(2);
    expect(new Set(paperOrders.map((order) => order.exchangeId)).size).toBe(2);
  });

  it("reserves all concurrent capacity, rejects the next request, then releases failed reservations", async () => {
    const feed = new ConcurrentPlacementFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const pending = Array.from({ length: 5000 }, () => placeCapacityOrder(manager));

    const issuedClientOrderIds = new Set(feed.submittedRequests.map((request) => request.clientOrderId));
    expect(issuedClientOrderIds.size).toBe(5000);
    expect(
      feed.submittedRequests.every(
        (request) => request.selectedSpotMarginLeverage === SelectedLeverage.initialBaseline,
      ),
    ).toBe(true);
    await expect(placeCapacityOrder(manager)).rejects.toThrow(
      "[order-manager] active order capacity exhausted",
    );
    expect(feed.submittedRequests).toHaveLength(5000);

    feed.rejectHeldPlacements(new Error("deferred exchange failure"));
    await expect(Promise.all(pending)).rejects.toThrow("deferred exchange failure");
    const recovered = await placeCapacityOrder(manager);
    expect(issuedClientOrderIds.has(recovered.clientOrderId)).toBe(false);
  });

  it("treats an invalid JavaScript simulator result as a rejected paper placement", async () => {
    const feed = new MockExchangeFeed();
    const logger = new RecordingLogger();
    const manager = new RuntimeOrderManager({
      feed,
      logger,
      paperMode: true,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
      paperOrderSimulator: () => parsePaperOrderSimulationOutcome(JSON.parse('"invalid"')),
    });

    await expect(placeCapacityOrder(manager)).rejects.toThrow("paper order simulator failed");
    expect(manager.getCounters()).toEqual({ placed: 0, filled: 0, cancelled: 0, rejected: 1 });
    expect(manager.getInFlightCount()).toBe(0);
    expect(logger.getCalls()).toContainEqual(
      expect.objectContaining({ event: "order.paper.simulator.failed", level: "error" }),
    );
  });

  it("rejects the 5001st active placement before the feed submission boundary", async () => {
    const feed = new PlacementLedgerFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    for (let index = 0; index < 5000; index++) await placeCapacityOrder(manager);

    await expect(placeCapacityOrder(manager)).rejects.toThrow(
      "[order-manager] active order capacity exhausted",
    );

    expect(feed.submittedRequests).toHaveLength(5000);
    expect(manager.getInFlightCount()).toBe(5000);
    expect(manager.getCounters()).toMatchObject({ placed: 5000, rejected: 1 });
  });

  it("does not oversubscribe capacity while a placement awaits the feed", async () => {
    const feed = new PlacementLedgerFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    for (let index = 0; index < 4999; index++) await placeCapacityOrder(manager);
    const submissionFailure = new Error("deferred exchange failure");
    feed.deferPlacement(submissionFailure);

    const pending = placeCapacityOrder(manager);
    expect(feed.submittedRequests).toHaveLength(5000);
    await expect(placeCapacityOrder(manager)).rejects.toThrow(
      "[order-manager] active order capacity exhausted",
    );
    expect(feed.submittedRequests).toHaveLength(5000);

    feed.releasePlacement();
    await expect(pending).rejects.toMatchObject({ cause: submissionFailure });
    await expect(placeCapacityOrder(manager)).resolves.toMatchObject({ status: "open" });
    expect(manager.getInFlightCount()).toBe(5000);
  });

  it("retains active fill bookkeeping when historical order retention reaches capacity", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    let executionListener: FeedListener | undefined;
    Object.assign(feed, {
      subscribeExecutions: (listener: FeedListener) => {
        executionListener = listener;
        return Promise.resolve(1);
      },
    });
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const lifecycleEvents: { readonly order: Order; readonly deltaFilled: number }[] = [];
    manager.onLifecycle((event) => {
      if (event.kind === "execution")
        lifecycleEvents.push({ order: event.order, deltaFilled: event.deltaFilled });
    });
    await manager.startLifecycle();
    const active = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 2,
      referencePrice: 100,
      type: "market",
      clientOrderIdHint: "retained-active",
    });
    for (let index = 0; index < 5000; index++) {
      const historical = await manager.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 1,
        referencePrice: 100,
        type: "market",
        clientOrderIdHint: `retained-history-${String(index)}`,
      });
      await manager.cancelOrder(historical.clientOrderId, historical.symbol);
    }
    const execution: Execution = {
      executionId: "retained-active-fill",
      clientOrderId: active.clientOrderId,
      exchangeOrderId: active.exchangeId,
      symbol: active.symbol,
      side: active.side,
      quantity: 1,
      price: 100,
      fee: 0,
      feeCurrency: "USDC",
      timestamp: 1,
    };
    executionListener?.({ kind: "execution", payload: execution });
    expect(lifecycleEvents).toMatchObject([
      { order: { clientOrderId: active.clientOrderId, filled: 1, average: 100 }, deltaFilled: 1 },
    ]);
    await manager.stopLifecycle();
  });

  it("releases terminal execution evidence when retained history evicts the order", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    let executionListener: FeedListener | undefined;
    Object.assign(feed, {
      subscribeExecutions: (listener: FeedListener) => {
        executionListener = listener;
        return Promise.resolve(1);
      },
    });
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 1_000_000, positions: [] }),
    });
    let mostRecentActiveFill: Order | undefined;
    manager.onLifecycle((event) => {
      if (event.kind === "execution") mostRecentActiveFill = event.order;
    });
    await manager.startLifecycle();
    if (executionListener === undefined) throw new Error("expected execution subscription");

    const terminalHistoricalOrder = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 2,
      referencePrice: 100,
      type: "market",
    });
    executionListener({
      kind: "execution",
      payload: {
        executionId: "evicted-terminal-execution",
        clientOrderId: terminalHistoricalOrder.clientOrderId,
        exchangeOrderId: terminalHistoricalOrder.exchangeId,
        symbol: terminalHistoricalOrder.symbol,
        side: terminalHistoricalOrder.side,
        quantity: 2,
        price: 100,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 1,
      },
    });
    expect(manager.getInFlightCount()).toBe(0);

    for (let index = 0; index < 5000; index++) {
      const historicalOrder = await manager.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 1,
        referencePrice: 100,
        type: "market",
        clientOrderIdHint: `retention-history-${String(index)}`,
      });
      await manager.cancelOrder(historicalOrder.clientOrderId, historicalOrder.symbol);
    }

    const activeOrder = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 2,
      referencePrice: 100,
      type: "market",
    });
    executionListener({
      kind: "execution",
      payload: {
        executionId: "active-after-terminal-history-eviction",
        clientOrderId: activeOrder.clientOrderId,
        exchangeOrderId: activeOrder.exchangeId,
        symbol: activeOrder.symbol,
        side: activeOrder.side,
        quantity: 1,
        price: 100,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 2,
      },
    });

    expect(mostRecentActiveFill).toMatchObject({ clientOrderId: activeOrder.clientOrderId, filled: 1 });
    await manager.stopLifecycle();
  });

  it("evicts the oldest cancellation race evidence while preserving newer terminal-race evidence", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    let orderListener: FeedListener | undefined;
    Object.assign(feed, {
      subscribeOrderUpdates: (listener: FeedListener) => {
        orderListener = listener;
        return Promise.resolve(1);
      },
    });
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const lifecycleOrders: Order[] = [];
    manager.onLifecycle((event) => {
      lifecycleOrders.push(event.order);
    });
    await manager.startLifecycle();

    const orders: Order[] = [];
    for (let index = 0; index <= 5000; index++) {
      const order = await manager.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 1,
        referencePrice: 100,
        type: "market",
        clientOrderIdHint: `retained-${String(index)}`,
      });
      orders.push(order);
      await manager.cancelOrder(order.clientOrderId, order.symbol);
    }
    const oldest = orders.at(0);
    const nextOldest = orders.at(1);
    const newest = orders.at(-1);
    expect(oldest).toBeDefined();
    expect(nextOldest).toBeDefined();
    expect(newest).toBeDefined();

    if (oldest === undefined || nextOldest === undefined || newest === undefined)
      throw new Error("expected retained lifecycle orders");
    orderListener?.({ kind: "order", payload: { ...oldest, status: "open" } });
    orderListener?.({ kind: "order", payload: { ...nextOldest, status: "open" } });
    orderListener?.({ kind: "order", payload: { ...newest, status: "open" } });

    expect(lifecycleOrders).toEqual([
      { ...nextOldest, status: "open", filled: 0, average: undefined },
      { ...newest, status: "open", filled: 0, average: undefined },
    ]);
    expect(manager.getInFlightCount()).toBe(1);
    await manager.stopLifecycle();
  });
});
