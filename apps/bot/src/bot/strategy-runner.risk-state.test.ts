import { describe, expect, it } from "bun:test";

import * as testSupport from "./strategy-runner.test-support.js";
import { requestTrailingStopClose } from "./strategy-runner.controller.test-support.js";

describe("StrategyRunner", () => {
  it("routes a trailing-stop callback through one reduce-only private close and disarms after its fill", async () => {
    const feed = new testSupport.MockExchangeFeed();
    await feed.open();
    const lifecycle = testSupport.attachPrivateLifecycle(feed);
    const rm = new testSupport.RiskManager({
      trailingStop: { enabled: true, atrPeriod: 2, atrMultiplier: 1, side: "both" },
      kelly: {
        enabled: false,
        fraction: 0.25,
        windowSize: 5,
        minTrades: 1,
        fallbackFraction: 0.01,
        maxFraction: 0.1,
      },
      drawdownScaler: { enabled: false, maxDdPct: 0.2, initialEquity: 10_000 },
    });
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.setRiskManager(rm);
    const om = new testSupport.OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
      getReduciblePosition: (symbol) => {
        const position = pm.getPositions().find((item) => item.symbol === symbol);
        return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
      },
    });
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([]),
      orderManager: om,
      positionManager: pm,
      sizingFn: () => 0,
      enabledSymbols: ["BTC/USDC"],
      riskManager: rm,
    });
    await om.startLifecycle();
    const position = pm.openPosition("trail", testSupport.makeSymbol(), "long", 1, 100, 1);
    rm.onTick({ positionId: position.id, side: "long", currentPrice: 105, atr: 1 });
    rm.onTick({ positionId: position.id, side: "long", currentPrice: 103, atr: 1 });
    await testSupport.flushPrivateLifecycle();
    const closeId = testSupport.requireDefined(om.getInFlightOrderIds().at(0), "expected close order id");
    const close = testSupport.requireDefined(feed.getOrder(closeId), "expected close order");
    expect(close.side).toBe("sell");
    lifecycle.emitExecution({
      executionId: "trail-close",
      clientOrderId: closeId,
      exchangeOrderId: close.exchangeId,
      symbol: testSupport.makeSymbol(),
      side: "sell",
      quantity: 1,
      price: 103,
      fee: 0,
      feeCurrency: "USDC",
      timestamp: Date.now(),
    });
    await testSupport.flushPrivateLifecycle();
    expect(pm.getPositionCount()).toBe(0);
    expect(rm.getSnapshot().trailingStops).toHaveLength(0);
    runner.dispose();
    await om.stopLifecycle();
  });

  it("makes terminal and failed trailing closes retryable without discarding remaining exposure", async () => {
    for (const outcome of ["canceled", "partial", "throw"] as const) {
      const feed = new testSupport.TrailingCloseOutcomeFeed(outcome);
      await feed.open();
      const pm = new testSupport.PositionManager({
        initialEquityUsd: 10_000,
        maxPositions: 3,
        maxLeverage: 10,
      });
      const om = new testSupport.OrderManager({
        feed,
        getPositionContext: () => pm.getPositionContext(),
        getReduciblePosition: (symbol) => {
          const position = pm.getPositions().find((item) => item.symbol === symbol);
          return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
        },
      });
      const runner = new testSupport.StrategyRunner({
        instances: testSupport.strategyInstances([]),
        orderManager: om,
        positionManager: pm,
        sizingFn: () => 0,
        enabledSymbols: ["BTC/USDC"],
      });
      const position = pm.openPosition("retry", testSupport.makeSymbol(), "long", 1, 100, 1);
      const requestClose = (positionId: string, closePrice: number, reason: string) =>
        requestTrailingStopClose({ orderManager: om, positionManager: pm }, positionId, closePrice, reason);
      await requestClose(position.id, 95, outcome);
      const afterFirst = pm.getPosition("retry", testSupport.makeSymbol(), "long");
      expect(afterFirst?.quantity).toBe(outcome === "partial" ? 0.5 : 1);
      await requestClose(position.id, 94, `${outcome}-retry`);
      expect(om.getCounters().placed).toBe(outcome === "throw" ? 0 : 2);
      runner.dispose();
    }
  });

  // ---------------------------------------------------------------------------
  // 6) getActiveStrategyNames returns strategy names
  // ---------------------------------------------------------------------------
  it("getActiveStrategyNames returns the strategy names", () => {
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
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 0.5,
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
  });

  // ---------------------------------------------------------------------------
  // 7) Wire with testSupport.createStrategyInstances (default config, no funding source)
  // ---------------------------------------------------------------------------
  it("works with createStrategyInstances for the default config (without dydx)", () => {
    const config: testSupport.BotConfig = {
      ...testSupport.DEFAULT_BOT_CONFIG,
      strategies: {
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    };
    const instances = testSupport.createStrategyInstances(config);
    expect(instances.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 8) testSupport.runnerStatsToState — currently a no-op pass-through
  // ---------------------------------------------------------------------------
  it("runnerStatsToState passes the state through unchanged", () => {
    const state = {
      version: 1 as const,
      savedAt: 0,
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    const stats = {
      activeStrategies: [],
      totalSignals: 0,
      // eslint-disable-next-line unicorn/no-null -- serialized runner statistics use null when no signal exists.
      lastSignalAt: null,
      // eslint-disable-next-line unicorn/no-null -- serialized runner statistics use null when no signal exists.
      lastSignalStrategy: null,
      ticksProcessed: 0,
    };
    const result = testSupport.runnerStatsToState(stats, state);
    // Pass-through semantics: same shape, same counter reference.
    expect(result).toEqual(state);
    expect(result.counters).toBe(state.counters);
  });

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  it("setRiskManager attaches and detaches the risk manager", () => {
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
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([]),
      orderManager: om,
      positionManager: pm,
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    const rm = new testSupport.RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3, side: "both" },
      kelly: {
        enabled: true,
        fraction: 0.25,
        windowSize: 50,
        minTrades: 5,
        fallbackFraction: 0.01,
        maxFraction: 0.1,
      },
      drawdownScaler: { enabled: false, maxDdPct: 0.2, initialEquity: 10_000 },
    });
    runner.setRiskManager(rm);
    // eslint-disable-next-line unicorn/no-null -- public detach API accepts null as an explicit absence value.
    runner.setRiskManager(null);
    runner.setRiskManager(rm);
    // No-op: detaching and re-attaching is supported.
  });

  it("riskManager overrides sizing when set", async () => {
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
      confidence: 1,
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
    const symbol = testSupport.makeSymbol();
    const runner = new testSupport.StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    const rm = new testSupport.RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3, side: "both" },
      kelly: {
        enabled: true,
        fraction: 0.25,
        windowSize: 50,
        minTrades: 5,
        fallbackFraction: 0.02,
        maxFraction: 0.1,
      },
      drawdownScaler: { enabled: false, maxDdPct: 0.2, initialEquity: 10_000 },
    });
    runner.setRiskManager(rm);
    await feed.subscribeOhlcv(symbol, "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: testSupport.Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_000, 100];
    testSupport.pushOhlcvTick(feed, symbol, "15m", candle);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    // testSupport.RiskManager path → fallback 0.02 (cold-start, no trades yet)
    // → quantity = 0.02 × 100_000 / 60_000 ≈ 0.0333
    const pos = pm.getPosition("donchian_pivot_composition", symbol, "long");
    expect(pos).toBeDefined();
    expect(pos?.quantity).toBeCloseTo(0.0333, 4);
  });

  it("drawdown scaler kill region blocks new orders when riskManager is set", async () => {
    const feed = new testSupport.MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
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
    const symbol = testSupport.makeSymbol();
    const runner = new testSupport.StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    const rm = new testSupport.RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3, side: "both" },
      kelly: {
        enabled: false,
        fraction: 0.25,
        windowSize: 50,
        minTrades: 5,
        fallbackFraction: 0.01,
        maxFraction: 0.1,
      },
      drawdownScaler: { enabled: true, maxDdPct: 0.2, initialEquity: 10_000 },
    });
    // Pre-warm equity to a kill-region value
    rm.onEquityUpdate(7000); // -30% from 10k = 150% of 20% → kill
    runner.setRiskManager(rm);
    await feed.subscribeOhlcv(symbol, "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: testSupport.Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_000, 100];
    testSupport.pushOhlcvTick(feed, symbol, "15m", candle);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    // Drawdown scaler in kill region → 0 size → no position
    expect(pm.getPositionCount()).toBe(0);
  });

  // ===========================================================================
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 10) ohlcv with existing position on SAME side does NOT open a new position
  //     (the "donchian_pivot_composition never-closes" bug fix)
  // ---------------------------------------------------------------------------
});
