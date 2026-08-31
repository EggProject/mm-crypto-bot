import { describe, expect, it } from "vitest";

import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

import { OrderManager, makeSignal, makeSymbol } from "./order-manager.test-support.js";

describe("OrderManager fault boundaries", () => {
  it("wraps exchange query failures with the original cause", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const seededManager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const seededOrder = await seededManager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "market",
    });
    const failure = new Error("exchange unavailable");
    Object.assign(feed, {
      cancelOrder: () => Promise.reject(failure),
      fetchBalances: () => Promise.reject(failure),
      fetchMarketMeta: () => Promise.reject(failure),
      fetchOpenOrders: () => Promise.reject(failure),
      fetchOrder: () => Promise.reject(failure),
      fetchPositions: () => Promise.reject(failure),
      fetchTickerSnapshot: () => Promise.reject(failure),
      placeOrder: () => Promise.reject(failure),
    });
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });

    await expect(manager.cancelOrder(seededOrder.clientOrderId, makeSymbol())).rejects.toMatchObject({
      cause: failure,
    });
    await expect(manager.getAuthoritativeBalances()).rejects.toMatchObject({ cause: failure });
    await expect(manager.getMarketMeta(makeSymbol())).rejects.toMatchObject({ cause: failure });
    await expect(manager.getOpenOrders(makeSymbol())).rejects.toMatchObject({ cause: failure });
    await expect(manager.reconcileOrder(seededOrder.clientOrderId, makeSymbol())).rejects.toMatchObject({
      cause: failure,
    });
    await expect(manager.getAuthoritativePositions()).rejects.toMatchObject({ cause: failure });
    await expect(manager.getTickerSnapshot(makeSymbol())).rejects.toMatchObject({ cause: failure });
    await expect(
      manager.placeOrder({
        signal: makeSignal(),
        symbol: makeSymbol(),
        amount: 1,
        referencePrice: 100,
        type: "market",
      }),
    ).rejects.toMatchObject({ cause: failure });
    expect(manager.getCounters().rejected).toBe(1);
  });

  it("uses paper orders and bypasses authoritative position access", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      paperMode: true,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });

    const order = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "limit",
      limitPrice: 99,
      protectiveKind: "stop_loss",
      triggerPrice: 90,
    });
    expect(order.status).toBe("closed");
    expect(manager.isPaperMode()).toBe(true);
    expect(await manager.getAuthoritativePositions()).toEqual([]);
    await manager.startLifecycle();
    await manager.stopLifecycle();
  });

  it("fails closed when the exchange lacks authoritative positions", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    Object.assign(feed, { fetchPositions: undefined });
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });

    await expect(manager.getAuthoritativePositions([makeSymbol()])).rejects.toThrow(
      "does not expose authoritative positions",
    );
  });

  it("cancels tracked open orders and returns individual cancellation failures", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const manager = new OrderManager({
      feed,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    });
    const first = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "market",
    });
    const second = await manager.placeOrder({
      signal: makeSignal(),
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "market",
    });
    const originalCancel = feed.cancelOrder.bind(feed);
    Object.assign(feed, {
      cancelOrder: (clientOrderId: typeof first.clientOrderId, symbol: typeof first.symbol) =>
        clientOrderId === second.clientOrderId
          ? Promise.reject(new Error("cancel failed"))
          : originalCancel(clientOrderId, symbol),
    });

    const result = await manager.cancelTrackedOrders(new Set([first.clientOrderId]));
    expect(result).toHaveLength(1);
    const [failure] = result;
    expect(failure).toBeDefined();
    expect(failure?.clientOrderId).toBe(second.clientOrderId);
    expect(failure?.symbol).toBe(second.symbol);
    expect(failure?.error).toContain("cancel failed");
    expect(manager.getInFlightOrderIds()).toEqual([first.clientOrderId, second.clientOrderId]);
  });
});
