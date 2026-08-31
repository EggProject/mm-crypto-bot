import { describe, expect, it } from "bun:test";

import * as testSupport from "./strategy-runner.test-support.js";

describe("StrategyRunner", () => {
  it("does not open a second position for an existing same-side position", async () => {
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
    // Pre-populate a long position for (test-strategy, BTC/USDC).
    pm.openPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long", 0.1, 60_000, 1);
    expect(pm.getPositionCount()).toBe(1);

    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy", // same side as the existing long → should be SKIPPED
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

    // Send 3 OHLCV ticks with buy signals. The existing long should
    // stay unchanged — NO new positions should be opened, NO entry
    // price averaging should occur.
    for (let index = 0; index < 3; index++) {
      const candle: testSupport.Ohlcv = [Date.now() + index * 1000, 60_000, 60_500, 59_500, 60_200, 100];
      testSupport.pushOhlcvTick(feed, testSupport.makeSymbol(), "15m", candle);
      await new Promise<void>((r) => {
        setTimeout(r, 20);
      });
    }

    // Position count is STILL 1 (no new position opened).
    expect(pm.getPositionCount()).toBe(1);
    // The existing long is unchanged (entry price still 60_000).
    const pos = pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long");
    expect(pos?.entryPrice).toBe(60_000);
    expect(pos?.quantity).toBeCloseTo(0.1, 8);
    expect(strategy.onCandleCallCount).toBe(0);
    expect(strategy.observedCallCount).toBe(3);
    // `totalSignals` is 0 because the new-signal path was gated.
    // (testSupport.FixedSignalStrategy always returns a signal, but the runner
    // never reached `handleSignal`.)
    expect(runner.getStats().totalSignals).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 11) ohlcv with existing position on OPPOSITE side does NOT open a new one
  //     position stays open until SL/TP/trailing-stop/portfolio-stop closes it)
  // ---------------------------------------------------------------------------
  it("does not open an opposite-side position while exposure exists", async () => {
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
    // Pre-populate a long position.
    pm.openPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long", 0.1, 60_000, 1);
    expect(pm.getPositionCount()).toBe(1);

    const strategy = new testSupport.FixedSignalStrategy({
      side: "sell", // opposite side as the existing long
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

    // Position count is STILL 1 (no new short position opened).
    expect(pm.getPositionCount()).toBe(1);
    // The long is still open.
    const pos = pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long");
    expect(pos).toBeDefined();
    // No new short.
    const shortPos = pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "short");
    expect(shortPos).toBeUndefined();
    expect(strategy.onCandleCallCount).toBe(0);
    expect(strategy.observedCallCount).toBe(1);
    // `totalSignals` is 0 (gated).
    expect(runner.getStats().totalSignals).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 12) onOpenPositionUpdate forceExit: true closes the position
  // ---------------------------------------------------------------------------
  it("closes an open position when a strategy requests force exit", async () => {
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
    // Pre-populate a long position.
    pm.openPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long", 0.1, 60_000, 1);
    expect(pm.getPositionCount()).toBe(1);

    const strategy = new testSupport.ForceExitStrategy({
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

    // The position was force-closed by the strategy.
    expect(pm.getPositionCount()).toBe(0);
    // onOpenPositionUpdate was called once.
    expect(strategy.onOpenPositionUpdateCallCount).toBe(1);
    expect(strategy.onCandleCallCount).toBe(0);
    expect(strategy.observedCallCount).toBe(1);
    // The closed trade is recorded.
    const closed = pm.getClosedTrades();
    expect(closed.length).toBe(1);
    expect(closed[0]?.side).toBe("long");
  });

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  it("reports active strategies and statistics when entry is skipped", async () => {
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
      [
        "cascade_fade",
        {
          kind: "strategy" as const,
          name: "cascade_fade",
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
    expect(runner.getActiveStrategyNames()).toEqual(["donchian_pivot_composition", "cascade_fade"]);

    // Run a tick; verify stats are sensible.
    await feed.subscribeOhlcv(testSupport.makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: testSupport.Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    testSupport.pushOhlcvTick(feed, testSupport.makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });

    const stats = runner.getStats();
    expect(stats.ticksProcessed).toBe(1);
    expect(stats.totalSignals).toBe(2); // a + b both fired
    expect(stats.activeStrategies).toEqual(["donchian_pivot_composition", "cascade_fade"]);
    // Two DIFFERENT strategies, same symbol — each gets its own
    // position (position-skip is per (strategy, symbol), not per
    // symbol). 2 positions opened, both at entry 60_200.
    expect(pm.getPositionCount()).toBe(2);
  });
});
