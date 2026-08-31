import { describe, expect, it } from "bun:test";

import * as testSupport from "./strategy-runner.test-support.js";

describe("StrategyRunner", () => {
  it("uses min(global max leverage, strategy request) for the booked position", async () => {
    for (const [globalMax, requested, expected] of [
      [1, 10, 1],
      [10, 1, 1],
    ] as const) {
      const feed = new testSupport.MockExchangeFeed();
      await feed.open();
      const pm = new testSupport.PositionManager({
        initialEquityUsd: 10_000,
        maxPositions: 3,
        maxLeverage: globalMax,
      });
      const om = new testSupport.OrderManager({
        feed,
        getPositionContext: () => pm.getPositionContext(),
        paperMode: true,
        aggregateExposureLimit: {
          maxAggregateEffectiveLeverage: globalMax,
          tolerance: 0,
          warnOnApproach: 0.95,
        },
      });
      const strategy = new testSupport.FixedSignalStrategy({
        side: "buy",
        confidence: 1,
        reason: "leverage",
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
        maxLeverage: globalMax,
        strategyPolicies: new Map([["donchian_pivot_composition", { leverage: requested }]]),
      });
      await runner.onFeedEvent({
        kind: "ohlcv",
        payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
      });
      expect(pm.getPosition("donchian_pivot_composition", testSupport.makeSymbol(), "long")?.leverage).toBe(
        expected,
      );
      runner.dispose();
    }
  });

  it("routes one enabled plugin breach through portfolio gates; pause and disabled attribution block it", async () => {
    expect(await testSupport.executeRiskPluginScenario("risk-probe:BTC/USDC", false)).toBe(1);
    expect(await testSupport.executeRiskPluginScenario("risk-probe:BTC/USDC", true)).toBe(0);
    expect(await testSupport.executeRiskPluginScenario("risk-probe:ETH/USDC", false)).toBe(0);
  });

  it("latches a real plugin breach before a signal strategy can enter and requires explicit resume", async () => {
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
    const plugin = new testSupport.RiskActionPlugin("risk-probe:BTC/USDC", true);
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "must-be-gated",
      stopLoss: 0,
      takeProfit: 0,
    });
    let emergencyCalls = 0;
    const { promise: unresolvedEmergency, resolve: releaseEmergency } = Promise.withResolvers<undefined>();
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
        [
          "donchian_pivot_composition",
          { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: () => 1,
      enabledSymbols: ["BTC/USDC"],
      onEmergency: () => {
        emergencyCalls++;
        return unresolvedEmergency;
      },
    });
    await runner.onFeedEvent(testSupport.makeOhlcvFeedEvent(1));
    expect(emergencyCalls).toBe(1);
    expect(runner.isPaused()).toBe(true);
    expect(om.getCounters().placed).toBe(0);
    await runner.onFeedEvent(testSupport.makeOhlcvFeedEvent(2));
    expect(om.getCounters().placed).toBe(0);
    releaseEmergency(undefined);
    await Promise.resolve();
    expect(runner.isPaused()).toBe(true);
    runner.resume(); // explicit operator-safe reset boundary
    await runner.onFeedEvent(testSupport.makeOhlcvFeedEvent(3));
    expect(om.getCounters().placed).toBe(1);
    runner.dispose();
  });

  it("awaits async plugin work and drains its risk signal before strategy entry", async () => {
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
    const plugin = new testSupport.AsyncRiskActionPlugin();
    const strategy = new testSupport.FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "must-wait-for-plugin",
      stopLoss: 0,
      takeProfit: 0,
    });
    let emergencyCalls = 0;
    const runner = new testSupport.StrategyRunner({
      instances: testSupport.strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
        [
          "donchian_pivot_composition",
          { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
        ],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: () => 1,
      enabledSymbols: ["BTC/USDC"],
      onEmergency: () => {
        emergencyCalls += 1;
      },
    });

    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: testSupport.makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
    });

    expect(plugin.completed).toBe(true);
    expect(emergencyCalls).toBe(1);
    expect(strategy.onCandleCallCount).toBe(0);
    expect(pm.getPositionCount()).toBe(0);
    runner.dispose();
  });
  // ---------------------------------------------------------------------------
  // 1) defaultSizingFn computes qty correctly
  // ---------------------------------------------------------------------------
});
