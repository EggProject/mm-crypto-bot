import { describe, expect, it } from "bun:test";

import * as testSupport from "./strategy-runner.test-support.js";

function hasObservationsForSymbol(
  value: object,
): value is { readonly observationsForSymbol: (symbol: string) => number } {
  return "observationsForSymbol" in value && typeof value.observationsForSymbol === "function";
}

class StaleFundingSource extends testSupport.ManualFundingSource {
  public override lastTickAgeMs(): number {
    return 6 * 60 * 1000;
  }
}

describe("StrategyRunner", () => {
  it("paper SL/TP closes through reduce-only bookkeeping; stop wins same-bar ambiguity and gap policy is conservative", async () => {
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
      getReduciblePosition: (symbol) => {
        const position = pm.getPositions().find((item) => item.symbol === symbol);
        return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
      },
    });
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "protected",
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
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [2, 95, 111, 89, 100, 1] },
    });
    expect(pm.getPositionCount()).toBe(0);
    expect(pm.getClosedTrades().at(-1)?.exitPrice).toBe(90);
  });

  it("keeps MTF histories separate and decides only on the configured LTF", async () => {
    const feed = new testSupport.MockExchangeFeed();
    await feed.open();
    const pm = new testSupport.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new testSupport.OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    let context: testSupport.StrategyContext | undefined;
    const strategy: testSupport.Strategy = {
      name: "mtf",
      timeframes: ["1d", "4h", "15m"],
      warmup: () => 0,
      onCandle: (context_) => {
        context = context_;
        return;
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
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    for (let index = 0; index < 20; index++) {
      await runner.onFeedEvent({
        kind: "ohlcv",
        payload: {
          symbol: testSupport.makeSymbol(),
          timeframe: "1d",
          candle: [index, 10 + index, 20 + index, 5 + index, 15 + index, 1],
        },
      });
    }
    for (let index = 0; index < 15; index++) {
      await runner.onFeedEvent({
        kind: "ohlcv",
        payload: {
          symbol: testSupport.makeSymbol(),
          timeframe: "15m",
          candle: [100 + index, 100, 105 + index, 95 - index, 100 + index, 1],
        },
      });
    }
    expect(context?.timeframe).toBe("15m");
    expect(context?.mtfState.htf.donchianUpper).toBe(39);
    expect(context?.mtfState.htf.donchianLower).toBe(5);
    expect(context?.mtfState.htf.adx).toBeDefined();
    expect(context?.mtfState.htf.adx).toBeGreaterThan(25);
    expect(context?.mtfState.ltf.atr).toBeGreaterThan(0);
    expect(context?.mtfState.mtf.close).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 5) Disabled symbols are skipped
  // ---------------------------------------------------------------------------
  it("skips ohlcv events for symbols not in enabledSymbols", async () => {
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
      enabledSymbols: ["ETH/USDC"], // BTC not enabled
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
    expect(stats.totalSignals).toBe(0);
  });

  it("pause gates an in-flight feed event before it can emit an order", async () => {
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
      confidence: 1,
      reason: "pause-test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        [
          "donchian_pivot_composition",
          {
            kind: "strategy" as const,
            name: "donchian_pivot_composition",
            instance: strategy,
          },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    runner.pause();
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: {
        symbol: testSupport.makeSymbol(),
        timeframe: "15m",
        candle: [Date.now(), 100, 101, 99, 100, 1],
      },
    });
    expect(strategy.onCandleCallCount).toBe(0);
    expect(pm.getPositionCount()).toBe(0);
    expect(runner.getStats().totalSignals).toBe(0);

    runner.resume();
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: {
        symbol: testSupport.makeSymbol(),
        timeframe: "15m",
        candle: [Date.now(), 100, 101, 99, 100, 1],
      },
    });
    expect(pm.getPositionCount()).toBe(1);
  });

  it("starts enabled plugins, drives each bar, and disposes subscriptions once", async () => {
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
    const plugin = new testSupport.LifecyclePlugin();
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        [
          "regime_detector",
          {
            kind: "plugin" as const,
            name: "regime_detector",
            instance: plugin,
          },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    expect(plugin.subscribeCalls).toBe(1);
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [123, 100, 105, 99, 103, 7] },
    });
    expect(plugin.barCalls).toBe(1);
    expect(plugin.lastClose).toBe(103);
    runner.dispose();
    runner.dispose();
    expect(plugin.disposeCalls).toBe(1);
  });

  it("feeds only daily closes into the enabled Regime detector for the configured quote symbol", async () => {
    const config: testSupport.BotConfig = {
      ...testSupport.DEFAULT_BOT_CONFIG,
      symbols: { enabled: ["BTC/USDC"] },
      strategies: {
        ...testSupport.DEFAULT_BOT_CONFIG.strategies,
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: true },
      },
    };
    const instances = testSupport.createStrategyInstances(config);
    const entry = instances.get("regime_detector");
    expect(entry?.kind).toBe("plugin");
    if (entry?.kind !== "plugin") return;
    if (!hasObservationsForSymbol(entry.instance))
      throw new Error("Regime detector observations are unavailable");
    const regime = entry.instance;
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
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: testSupport.defaultSizingFunction,
      enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "1d", candle: [1, 100, 101, 99, 100, 1] },
    });
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [2, 100, 102, 99, 101, 1] },
    });
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "1d", candle: [3, 101, 103, 100, 102, 1] },
    });
    expect(regime.observationsForSymbol("BTC/USDC")).toBe(1);
    runner.dispose();
  });

  it("applies the latest per-symbol Regime sizeModifier before order placement", async () => {
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
    const plugin = new testSupport.RegimeSizingPlugin();
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "regime-sized",
      stopLoss: 90,
      takeProfit: 110,
    });
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        [
          "regime_detector" as const,
          {
            kind: "plugin" as const,
            name: "regime_detector" as const,
            instance: plugin,
          },
        ],
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
    expect(
      pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long")?.quantity,
    ).toBeCloseTo(0.4, 8);
    runner.dispose();
  });

  it("owns the dYdX funding subscription and executes a kill-switch exit for an open carry", async () => {
    const fundingSource = new StaleFundingSource();
    const strategy = new testSupport.DydxCexCarryStrategy({ fundingSource });
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
      instances: testSupport.strategyInstances([
        [
          "dydx_cex_carry",
          {
            kind: "strategy" as const,
            name: "dydx_cex_carry" as const,
            instance: strategy,
          },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: () => 1,
      enabledSymbols: ["BTC/USDC"],
    });
    expect(fundingSource.subscribeCalls).toBe(1);
    strategy.recordBybitEuLiquidity("BTC-USD", 1_000_000, 1000);
    fundingSource.fire(1000);
    expect(strategy.state.fundingPeriods).toBe(0);
    expect(strategy.state.killSwitchVerdicts["indexer-stale"].engaged).toBe(true);

    pm.openPosition("dydx_cex_carry", testSupport.makeSymbol(), "long", 1, 100, 1);
    strategy.onPositionOpened({
      side: "buy",
      entryTime: 1,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 99,
      takeProfit: 10_000,
      holdingBars: 0,
    });
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "1d", candle: [2000, 100, 101, 99, 100, 1] },
    });
    expect(pm.getPositionCount()).toBe(0);
    expect(strategy.state.hasEntered).toBe(false);

    runner.dispose();
    expect(fundingSource.closeCalls).toBe(1);
    fundingSource.fire(3000);
    expect(strategy.state.fundingPeriods).toBe(0);
  });
});
