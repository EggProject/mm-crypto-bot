import { describe, expect, it } from "bun:test";

import * as testSupport from "./strategy-runner.test-support.js";
import { createNativeProtectionHarness } from "./strategy-runner.controller.test-support.js";

describe("StrategyRunner", () => {
  it("rolls back already-started plugins when a later subscription rejects", () => {
    const feed = new testSupport.MockExchangeFeed();
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
    const started = new testSupport.LifecyclePlugin();
    const rejecting = new testSupport.LifecyclePlugin();
    rejecting.subscribe = () => {
      throw new Error("plugin rejected startup");
    };

    expect(
      () =>
        new testSupport.StrategyRunner({
          instances: testSupport.strategyInstances([
            [
              "regime_detector",
              {
                kind: "plugin" as const,
                name: "regime_detector",
                instance: started,
              },
            ],
            [
              "funding_flip_kill_switch",
              {
                kind: "plugin" as const,
                name: "funding_flip_kill_switch",
                instance: rejecting,
              },
            ],
          ]),
          orderManager: om,
          positionManager: pm,
          sizingFn: () => 0,
          enabledSymbols: ["BTC/USDC"],
        }),
    ).toThrow("plugin rejected startup");
    expect(started.subscribeCalls).toBe(1);
    expect(started.disposeCalls).toBe(1);
  });

  it("books private executions once, preserves execution price, and releases the terminal entry gate", async () => {
    const feed = new testSupport.MockExchangeFeed();
    await feed.open();
    const lifecycle = testSupport.attachPrivateLifecycle(feed);
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    let opened = 0;
    const strategy: testSupport.Strategy = {
      name: "private-entry",
      timeframes: ["15m"],
      warmup: () => 0,
      onCandle: () => ({ side: "buy", confidence: 1, reason: "private", stopLoss: 0, takeProfit: 0 }),
      onPositionOpened: () => {
        opened++;
      },
    };
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
    await om.startLifecycle();
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
    });
    const entry = testSupport.requireDefined(om.getInFlightOrderIds().at(0), "expected entry order id");
    const initial = testSupport.requireDefined(feed.getOrder(entry), "expected entry order");
    const execution = (executionId: string, quantity: number, price: number): testSupport.Execution => ({
      executionId,
      clientOrderId: entry,
      exchangeOrderId: initial.exchangeId,
      symbol: testSupport.makeSymbol(),
      side: "buy",
      quantity,
      price,
      fee: 0,
      feeCurrency: "USDC",
      timestamp: Date.now(),
    });
    lifecycle.emitExecution(execution("late-first", 1, 101));
    lifecycle.emitExecution(execution("late-first", 1, 101)); // duplicate execution id
    lifecycle.emitExecution(execution("earlier-second", 1, 99)); // out-of-order id, valid second fill
    await testSupport.flushPrivateLifecycle();

    const position = pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long");
    expect(position?.quantity).toBe(2);
    expect(position?.entryPrice).toBe(100);
    expect(opened).toBe(1);
    expect(om.getInFlightCount()).toBe(0);

    // Terminal private evidence removes the idempotency gate, so a later bar
    // can create a new intent after this position has been independently closed.
    pm.closePosition("donchian_pivot_composition", testSupport.makeSymbol(), 100);
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [2, 100, 101, 99, 100, 1] },
    });
    expect(om.getCounters().placed).toBe(2);
    runner.dispose();
    await om.stopLifecycle();
  });

  it("uses private protection lifecycle updates to cancel siblings and resize residual protection", async () => {
    const feed = new testSupport.MockExchangeFeed();
    await feed.open();
    const lifecycle = testSupport.attachPrivateLifecycle(feed);
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "private-protection",
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
    await om.startLifecycle();
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
    });
    const entryId = testSupport.requireDefined(om.getInFlightOrderIds().at(0), "expected entry order id");
    const entry = testSupport.requireDefined(feed.getOrder(entryId), "expected entry order");
    lifecycle.emitExecution({
      executionId: "entry-full",
      clientOrderId: entryId,
      exchangeOrderId: entry.exchangeId,
      symbol: testSupport.makeSymbol(),
      side: "buy",
      quantity: 2,
      price: 100,
      fee: 0,
      feeCurrency: "USDC",
      timestamp: Date.now(),
    });
    await testSupport.flushPrivateLifecycle();
    const protectionIds = om.getInFlightOrderIds();
    expect(protectionIds).toHaveLength(2);

    // A terminal zero-fill cancellation cleans up a stale native leg without
    // affecting exposure; the sibling remains eligible to execute.
    const canceledId = testSupport.requireDefined(protectionIds.at(0), "expected canceled protection id");
    lifecycle.emitOrder({
      ...testSupport.requireDefined(feed.getOrder(canceledId), "expected canceled protection"),
      status: "canceled",
      filled: 0,
    });
    await testSupport.flushPrivateLifecycle();

    const triggeredId = testSupport.requireDefined(protectionIds.at(1), "expected triggered protection id");
    const triggered = testSupport.requireDefined(feed.getOrder(triggeredId), "expected triggered protection");
    lifecycle.emitExecution({
      executionId: "partial-stop",
      clientOrderId: triggeredId,
      exchangeOrderId: triggered.exchangeId,
      symbol: testSupport.makeSymbol(),
      side: triggered.side,
      quantity: 1,
      price: 90,
      fee: 0,
      feeCurrency: "USDC",
      timestamp: Date.now(),
    });
    await testSupport.flushPrivateLifecycle();
    expect(pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long")?.quantity).toBe(1);
    expect(om.getInFlightOrderIds()).toHaveLength(0);
    lifecycle.emitOrder({
      ...testSupport.requireDefined(feed.getOrder(triggeredId), "expected triggered protection"),
      status: "canceled",
      filled: 1,
      average: 90,
    });
    await testSupport.flushPrivateLifecycle();
    const replacements = om.getInFlightOrderIds();
    expect(replacements).toHaveLength(2);
    for (const id of replacements) expect(feed.getOrder(id)?.amount).toBe(1);
    runner.dispose();
    await om.stopLifecycle();
  });

  it("serializes delayed cancel/fill races for spot and contracts without over-closing", async () => {
    for (const isSpot of [true, false]) {
      const symbol = testSupport.makeSymbol();
      const feed = new testSupport.MockExchangeFeed({
        marketMeta: new Map([
          [
            symbol,
            {
              symbol,
              base: "BTC",
              quote: "USDC",
              amountPrecision: 4,
              pricePrecision: 2,
              minAmount: 0.0001,
              minCost: 1,
              isSpot,
            },
          ],
        ]),
      });
      await feed.open();
      const lifecycle = testSupport.attachPrivateLifecycle(feed);
      const pm = new testSupport.PositionManager({
        initialEquityUsd: 10_000,
        maxPositions: 3,
        maxLeverage: 10,
      });
      const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
      const runner = new testSupport.StrategyRunner({
        instances: testSupport.strategyInstances([]),
        orderManager: om,
        positionManager: pm,
        sizingFn: () => 0,
        enabledSymbols: [symbol],
      });
      await om.startLifecycle();
      pm.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
      const signal = {
        side: "buy" as const,
        confidence: 1,
        reason: "serialized",
        stopLoss: 90,
        takeProfit: 110,
      };
      const nativeProtections = createNativeProtectionHarness(om, pm);
      const install = nativeProtections.install;
      const input = {
        strategy: "donchian_pivot_composition" as const,
        symbol,
        side: "long" as const,
        quantity: 1,
        leverage: 1,
        signal,
        referencePrice: 100,
      };
      await install(input);
      const retired = om.getInFlightOrderIds();
      expect(retired).toHaveLength(2);

      // Replacement request only sends cancel requests. The old pair remains
      // authoritative until both private terminal updates arrive.
      await install(input);
      expect(testSupport.copyOrders(feed.orderBook)).toHaveLength(2);
      const firstRetiredId = testSupport.requireDefined(retired.at(0), "expected retired order id");
      const firstRetiredOrder = testSupport.requireDefined(
        feed.getOrder(firstRetiredId),
        "expected retired order",
      );
      lifecycle.emitOrder(firstRetiredOrder);
      await testSupport.flushPrivateLifecycle();
      await nativeProtections.settleTerminal(input.strategy, symbol, firstRetiredId);
      expect(testSupport.copyOrders(feed.orderBook)).toHaveLength(2);
      const secondRetiredId = testSupport.requireDefined(retired.at(1), "expected retired sibling id");
      const secondRetiredOrder = testSupport.requireDefined(
        feed.getOrder(secondRetiredId),
        "expected retired sibling",
      );
      lifecycle.emitOrder(secondRetiredOrder);
      await testSupport.flushPrivateLifecycle();
      await nativeProtections.settleTerminal(input.strategy, symbol, secondRetiredId);
      let replacement = om.getInFlightOrderIds();
      expect(replacement).toHaveLength(2);
      for (const id of replacement) expect(feed.getOrder(id)?.amount).toBe(1);

      // Cancel-before-fill: a late retired-leg execution still reduces the
      // authoritative exposure and cancels the entire replacement pair.
      const late = firstRetiredOrder;
      lifecycle.emitExecution({
        executionId: `late-${String(isSpot)}`,
        clientOrderId: late.clientOrderId,
        exchangeOrderId: late.exchangeId,
        symbol,
        side: "sell",
        quantity: 0.4,
        price: 90,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: Date.now(),
      });
      await testSupport.flushPrivateLifecycle();
      pm.recordFill({
        strategy: input.strategy,
        symbol,
        side: "short",
        quantity: 0.4,
        price: 90,
        leverage: 1,
        timestamp: Date.now(),
      });
      expect(pm.getPosition("donchian_pivot_composition", symbol, "long")?.quantity).toBeCloseTo(0.6);
      await install(input);
      for (const id of replacement) {
        lifecycle.emitOrder(testSupport.requireDefined(feed.getOrder(id), "expected replacement order"));
        await nativeProtections.settleTerminal(input.strategy, symbol, id);
      }
      await testSupport.flushPrivateLifecycle();
      replacement = om.getInFlightOrderIds();
      expect(replacement).toHaveLength(2);
      for (const id of replacement) expect(feed.getOrder(id)?.amount).toBeCloseTo(0.6);

      // A second late sibling fill is clipped to remaining exposure. Once the
      // new siblings prove canceled, zero exposure never rebuilds zero-level protection.
      const lateSibling = secondRetiredOrder;
      lifecycle.emitExecution({
        executionId: `late-flat-${String(isSpot)}`,
        clientOrderId: lateSibling.clientOrderId,
        exchangeOrderId: lateSibling.exchangeId,
        symbol,
        side: "sell",
        quantity: 0.6,
        price: 110,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: Date.now(),
      });
      await testSupport.flushPrivateLifecycle();
      pm.recordFill({
        strategy: input.strategy,
        symbol,
        side: "short",
        quantity: 0.6,
        price: 110,
        leverage: 1,
        timestamp: Date.now(),
      });
      expect(pm.getPositionCount()).toBe(0);
      await install(input);
      for (const id of replacement) {
        lifecycle.emitOrder(testSupport.requireDefined(feed.getOrder(id), "expected replacement order"));
        await nativeProtections.settleTerminal(input.strategy, symbol, id);
      }
      await testSupport.flushPrivateLifecycle();
      for (const id of om.getInFlightOrderIds()) await om.cancelOrder(id, symbol);
      expect(om.getInFlightOrderIds()).toHaveLength(0);
      runner.dispose();
      await om.stopLifecycle();
    }
  });

  it("keeps a failed protection cancel authoritative and retries before replacing", async () => {
    const feed = new testSupport.FailFirstProtectionCancelFeed();
    await feed.open();
    const lifecycle = testSupport.attachPrivateLifecycle(feed);
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([]),
      orderManager: om,
      positionManager: pm,
      sizingFn: () => 0,
      enabledSymbols: [testSupport.makeSymbol()],
    });
    await om.startLifecycle();
    pm.openPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long", 1, 100, 1);
    const nativeProtections = createNativeProtectionHarness(om, pm);
    const install = nativeProtections.install;
    const input = {
      strategy: "donchian_pivot_composition" as const,
      symbol: testSupport.makeSymbol(),
      side: "long" as const,
      quantity: 1,
      leverage: 1,
      signal: { side: "buy" as const, confidence: 1, reason: "cancel-retry", stopLoss: 90, takeProfit: 110 },
      referencePrice: 100,
    };
    await install(input);
    const originalIds = om.getInFlightOrderIds();
    await install(input);
    const terminal = testSupport.requireDefined(
      originalIds
        .map((id) => testSupport.requireDefined(feed.getOrder(id), "expected original protection order"))
        .find((order) => order.status === "canceled"),
      "expected canceled protection order",
    );
    lifecycle.emitOrder(terminal);
    await testSupport.flushPrivateLifecycle();
    await nativeProtections.settleTerminal(input.strategy, input.symbol, terminal.clientOrderId);
    expect(testSupport.copyOrders(feed.orderBook)).toHaveLength(2);
    await install(input); // retries the failed old leg
    const retriedId = testSupport.requireDefined(
      originalIds.find((id) => id !== terminal.clientOrderId),
      "expected retried protection id",
    );
    lifecycle.emitOrder(testSupport.requireDefined(feed.getOrder(retriedId), "expected retried protection"));
    await testSupport.flushPrivateLifecycle();
    await nativeProtections.settleTerminal(input.strategy, input.symbol, retriedId);
    expect(testSupport.copyOrders(feed.orderBook)).toHaveLength(4);
    expect(om.getInFlightOrderIds()).toHaveLength(2);
    runner.dispose();
    await om.stopLifecycle();
  });
});
