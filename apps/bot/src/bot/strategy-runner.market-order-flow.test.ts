import { describe, expect, it } from "bun:test";

import * as testSupport from "./strategy-runner.test-support.js";

describe("StrategyRunner", () => {
  it("defaultSizingFn returns equity * riskPerTrade / price", () => {
    const qty = testSupport.defaultSizingFunction({
      signal: { side: "buy", confidence: 1, reason: "test", stopLoss: 0, takeProfit: 0 },
      symbol: testSupport.makeSymbol(),
      referencePrice: 60_000,
      equityUsd: 10_000,
      riskPerTrade: 0.01,
    });
    // 10_000 * 0.01 / 60_000 = 0.001666...
    expect(qty).toBeCloseTo(0.00166, 4);
  });

  // ---------------------------------------------------------------------------
  // 2) defaultSizingFn returns 0 for invalid price
  // ---------------------------------------------------------------------------
  it("defaultSizingFn returns 0 for invalid price", () => {
    const qty = testSupport.defaultSizingFunction({
      signal: { side: "buy", confidence: 1, reason: "test", stopLoss: 0, takeProfit: 0 },
      symbol: testSupport.makeSymbol(),
      referencePrice: 0,
      equityUsd: 10_000,
      riskPerTrade: 0.01,
    });
    expect(qty).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 3) onFeedEvent processes ticker events
  // ---------------------------------------------------------------------------
  it("onFeedEvent processes ticker events", async () => {
    const feed = new testSupport.MockExchangeFeed();
    await feed.open();
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
      paperMode: true,
    });
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = testSupport.strategyInstances([
      [
        "donchian_pivot_composition",
        {
          kind: "strategy" as const,
          name: "donchian_pivot_composition",
          instance: strategy,
        },
      ],
    ]);
    const runner = new testSupport.StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    // Subscribe to the feed so pushEvent delivers.
    await feed.subscribeTicker(testSupport.makeSymbol(), (event) => {
      void runner.onFeedEvent(event);
    });
    testSupport.pushTickerTick(feed, testSupport.makeSymbol(), 60_000);
    testSupport.pushTickerTick(feed, testSupport.makeSymbol(), 61_000);
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });
    const stats = runner.getStats();
    expect(stats.ticksProcessed).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // 4) ohlcv event triggers strategy and places an order
  // ---------------------------------------------------------------------------
  it("ohlcv event triggers strategy.onCandle and places order", async () => {
    const feed = new testSupport.MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
      paperMode: true,
    });
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = testSupport.strategyInstances([
      [
        "donchian_pivot_composition",
        {
          kind: "strategy" as const,
          name: "donchian_pivot_composition",
          instance: strategy,
        },
      ],
    ]);
    const runner = new testSupport.StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    await feed.subscribeOhlcv(testSupport.makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: testSupport.Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    testSupport.pushOhlcvTick(feed, testSupport.makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    const stats = runner.getStats();
    expect(stats.totalSignals).toBe(1);
    expect(pm.getPositionCount()).toBe(1);
  });

  it("does not book an open live create-order acknowledgement as a fill", async () => {
    const feed = new testSupport.MockExchangeFeed();
    await feed.open();
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    await om.startLifecycle();
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "ack",
      stopLoss: 0,
      takeProfit: 0,
    });
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        [
          "donchian_pivot_composition",
          { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
    });
    expect(om.getInFlightCount()).toBe(1);
    expect(pm.getPositionCount()).toBe(0);
  });

  it("serializes simultaneous same-symbol bars and retains an unfilled entry idempotency gate", async () => {
    const feed = new testSupport.MockExchangeFeed();
    await feed.open();
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "race",
      stopLoss: 0,
      takeProfit: 0,
    });
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        [
          "donchian_pivot_composition",
          { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: () => 1,
      enabledSymbols: ["BTC/USDC"],
    });
    await Promise.all([
      runner.onFeedEvent(testSupport.makeOhlcvFeedEvent(1)),
      runner.onFeedEvent(testSupport.makeOhlcvFeedEvent(2)),
    ]);
    expect(om.getCounters().placed).toBe(1);
    expect(pm.getPositionCount()).toBe(0);
  });

  it("reconciles a late partial then terminal fill exactly once from cumulative exchange state", async () => {
    const feed = new testSupport.MockExchangeFeed();
    await feed.open();
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "late",
      stopLoss: 0,
      takeProfit: 0,
    });
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        [
          "donchian_pivot_composition",
          { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: () => 2,
      enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
    });
    const id = testSupport.requireDefined(om.getInFlightOrderIds().at(0), "expected in-flight order id");
    feed.setOrderStatus(id, { filled: 1, average: 101, status: "open" });
    await runner.onFeedEvent({
      kind: "ticker",
      payload: {
        symbol: testSupport.makeSymbol(),
        timestamp: 2,
        bid: 100,
        ask: 102,
        last: 101,
        baseVolume: 1,
        quoteVolume: 101,
      },
    });
    await runner.onFeedEvent({
      kind: "ticker",
      payload: {
        symbol: testSupport.makeSymbol(),
        timestamp: 3,
        bid: 100,
        ask: 102,
        last: 101,
        baseVolume: 1,
        quoteVolume: 101,
      },
    });
    expect(pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long")?.quantity).toBe(1);
    feed.setOrderStatus(id, { filled: 2, average: 102, status: "closed" });
    await runner.onFeedEvent({
      kind: "ticker",
      payload: {
        symbol: testSupport.makeSymbol(),
        timestamp: 4,
        bid: 101,
        ask: 103,
        last: 102,
        baseVolume: 1,
        quoteVolume: 102,
      },
    });
    expect(pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long")?.quantity).toBe(2);
    expect(om.getInFlightCount()).toBe(0);
  });

  it("replaces native TP/SL with one total-exposure pair after partial fills and resizes after an exit", async () => {
    const feed = new testSupport.MockExchangeFeed();
    await feed.open();
    const lifecycle = testSupport.attachPrivateLifecycle(feed);
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    await om.startLifecycle();
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "native",
      stopLoss: 90,
      takeProfit: 110,
    });
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        [
          "donchian_pivot_composition",
          { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: () => 2,
      enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
    });
    const entryId = testSupport.requireDefined(om.getInFlightOrderIds().at(0), "expected entry order id");
    feed.setOrderStatus(entryId, { filled: 1, average: 100, status: "open" });
    await runner.onFeedEvent({
      kind: "ticker",
      payload: {
        symbol: testSupport.makeSymbol(),
        timestamp: 2,
        bid: 99,
        ask: 101,
        last: 100,
        baseVolume: 1,
        quoteVolume: 100,
      },
    });
    const firstProtectionIds = om.getInFlightOrderIds().filter((id) => id !== entryId);
    expect(firstProtectionIds).toHaveLength(2);
    feed.setOrderStatus(entryId, { filled: 2, average: 100, status: "closed" });
    await runner.onFeedEvent({
      kind: "ticker",
      payload: {
        symbol: testSupport.makeSymbol(),
        timestamp: 3,
        bid: 99,
        ask: 101,
        last: 100,
        baseVolume: 1,
        quoteVolume: 100,
      },
    });
    // Bybit cancel ACK is asynchronous: no replacement is authoritative yet.
    expect(om.getInFlightOrderIds().filter((id) => id !== entryId)).toHaveLength(0);
    for (const old of firstProtectionIds) expect(feed.getOrder(old)?.status).toBe("canceled");
    for (const old of firstProtectionIds) {
      lifecycle.emitOrder(
        testSupport.requireDefined(feed.getOrder(old), "expected canceled protection order"),
      );
    }
    await testSupport.flushPrivateLifecycle();
    const replacementProtectionIds = om.getInFlightOrderIds().filter((id) => id !== entryId);
    expect(replacementProtectionIds).toHaveLength(2);

    const triggered = testSupport.requireDefined(
      replacementProtectionIds.at(0),
      "expected triggered protection id",
    );
    const sibling = testSupport.requireDefined(
      replacementProtectionIds.at(1),
      "expected sibling protection id",
    );
    feed.setOrderStatus(triggered, { filled: 1, average: 90, status: "closed" });
    await runner.onFeedEvent({
      kind: "ticker",
      payload: {
        symbol: testSupport.makeSymbol(),
        timestamp: 4,
        bid: 89,
        ask: 91,
        last: 90,
        baseVolume: 1,
        quoteVolume: 90,
      },
    });
    expect(feed.getOrder(sibling)?.status).toBe("canceled");
    expect(pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long")?.quantity).toBe(1);
    expect(om.getInFlightOrderIds()).toHaveLength(0);
    lifecycle.emitOrder(
      testSupport.requireDefined(feed.getOrder(sibling), "expected sibling protection order"),
    );
    await testSupport.flushPrivateLifecycle();
    const residualProtectionIds = om.getInFlightOrderIds();
    expect(residualProtectionIds).toHaveLength(2);
    for (const id of residualProtectionIds) expect(feed.getOrder(id)?.amount).toBe(1);
    await om.stopLifecycle();
  });

  it("cancels a partly-created native protection and submits a reduce-only fail-safe close", async () => {
    const feed = new testSupport.FailTakeProfitFeed();
    await feed.open();
    const lifecycle = testSupport.attachPrivateLifecycle(feed);
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    await om.startLifecycle();
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "failsafe",
      stopLoss: 90,
      takeProfit: 110,
    });
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        [
          "donchian_pivot_composition",
          { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: () => 1,
      enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
    });
    const entryId = testSupport.requireDefined(om.getInFlightOrderIds().at(0), "expected entry order id");
    feed.setOrderStatus(entryId, { filled: 1, average: 100, status: "closed" });
    await runner.onFeedEvent({
      kind: "ticker",
      payload: {
        symbol: testSupport.makeSymbol(),
        timestamp: 2,
        bid: 99,
        ask: 101,
        last: 100,
        baseVolume: 1,
        quoteVolume: 100,
      },
    });
    let orders = testSupport.copyOrders(feed.orderBook);
    expect(orders.find((order) => order.clientOrderId.includes("stop_loss"))?.status).toBe("canceled");
    expect(orders.find((order) => order.clientOrderId.includes("protection-failsafe"))).toBeUndefined();
    const canceledProtection = testSupport.requireDefined(
      orders.find((order) => order.clientOrderId.includes("stop_loss")),
      "expected canceled stop-loss protection",
    );
    lifecycle.emitOrder(canceledProtection);
    await testSupport.flushPrivateLifecycle();
    orders = testSupport.copyOrders(feed.orderBook);
    expect(orders.find((order) => order.clientOrderId.includes("protection-failsafe"))?.side).toBe("sell");
    await om.stopLifecycle();
  });
});
