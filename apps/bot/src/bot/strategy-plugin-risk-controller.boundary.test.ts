import { describe, expect, it } from "vitest";

import type { SignalBus } from "@mm-crypto-bot/core";
import type { Bar, PluginState } from "@mm-crypto-bot/core";
import { RecordingLogger } from "@logging-testing";

import type { OrderLifecycleEvent } from "./order-manager.js";
import { StrategyPluginRiskController } from "./strategy-runner-plugin-risk-controller.js";
import {
  MockExchangeFeed,
  OrderManager,
  PositionManager,
  RegimeSizingPlugin,
  RiskActionPlugin,
  makeSymbol,
  strategyInstances,
} from "./strategy-runner.test-support.js";

const unavailable = undefined;

function noOperation(): void {
  return;
}

class CallCounter {
  public count = 0;
  public readonly increment = (): void => {
    this.count += 1;
  };
}

class EmergencyProbe {
  public readonly reasons: string[] = [];
  public readonly completion = Promise.withResolvers<undefined>();
  public readonly onEmergency = (reason: string): Promise<undefined> => {
    this.reasons.push(reason);
    return this.completion.promise;
  };
}

class InformationalRiskPlugin extends RiskActionPlugin {
  private signalBus: SignalBus | undefined;

  public override subscribe(signalBus: SignalBus): void {
    super.subscribe(signalBus);
    this.signalBus = signalBus;
  }

  public override onBar(bar: Bar, state: PluginState): void {
    super.onBar(bar, state);
    this.signalBus?.emit({
      kind: "risk",
      varDaily95: 0,
      correlationPenalty: 0,
      drawdownLimit: 0,
      source: "informational-risk",
      breach: false,
      reason: "within limits",
    });
  }
}

class DailyRegimePlugin extends RegimeSizingPlugin {
  public readonly recordedCloses: {
    readonly symbol: string;
    readonly close: number;
    readonly timestamp: number;
  }[] = [];

  public recordClose(symbol: string, close: number, timestamp: number): void {
    this.recordedCloses.push({ symbol, close, timestamp });
  }
}

async function createDependencies() {
  const feed = new MockExchangeFeed();
  await feed.open();
  const positionManager = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
  const orderManager = new OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
  });
  return { feed, orderManager, positionManager };
}

describe("StrategyPluginRiskController plugin boundaries", () => {
  it("applies a valid enabled regime modifier and disposes the plugin subscription", async () => {
    const { orderManager, positionManager } = await createDependencies();
    const plugin = new RegimeSizingPlugin();
    const controller = new StrategyPluginRiskController({
      instances: strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
      ]),
      orderManager,
      positionManager,
      enabledSymbols: new Set([makeSymbol()]),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => false,
      pause: () => void 0,
      getRiskManager: () => unavailable,
      getPortfolioManager: () => unavailable,
      getOnEmergency: () => unavailable,
      latestPriceFor: () => unavailable,
      notifyStrategyClosed: () => void 0,
    });

    controller.start();
    await controller.processPlugins(makeSymbol(), "15m", {
      timestamp: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });

    expect(controller.getRegimeSizeModifier(makeSymbol())).toBe(0.4);
    controller.dispose();
    expect(plugin.disposeCalls).toBe(1);
  });

  it("ignores a breach attributed to a disabled symbol without pausing or emergency work", async () => {
    const { orderManager, positionManager } = await createDependencies();
    const plugin = new RiskActionPlugin("risk-probe:ETH/USDC", true);
    let pauses = 0;
    let emergencies = 0;
    const controller = new StrategyPluginRiskController({
      instances: strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
      ]),
      orderManager,
      positionManager,
      enabledSymbols: new Set([makeSymbol()]),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => false,
      pause: () => {
        pauses += 1;
      },
      getRiskManager: () => unavailable,
      getPortfolioManager: () => unavailable,
      getOnEmergency: () => {
        emergencies += 1;
      },
      latestPriceFor: () => unavailable,
      notifyStrategyClosed: () => void 0,
    });

    controller.start();
    await controller.processPlugins(makeSymbol(), "15m", {
      timestamp: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });

    expect(pauses).toBe(0);
    expect(emergencies).toBe(0);
  });

  it("coalesces in-progress unscoped emergency callbacks and accepts the next breach after settlement", async () => {
    const { orderManager, positionManager } = await createDependencies();
    const plugin = new RiskActionPlugin("portfolio-risk");
    const emergency = new EmergencyProbe();
    const controller = new StrategyPluginRiskController({
      instances: strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
      ]),
      orderManager,
      positionManager,
      enabledSymbols: new Set([makeSymbol()]),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => false,
      pause: noOperation,
      getRiskManager: () => unavailable,
      getPortfolioManager: () => unavailable,
      getOnEmergency: () => emergency.onEmergency,
      latestPriceFor: () => unavailable,
      notifyStrategyClosed: noOperation,
    });

    controller.start();
    const bar = { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 };
    await controller.processPlugins(makeSymbol(), "15m", bar);
    await controller.processPlugins(makeSymbol(), "15m", bar);
    expect(emergency.reasons).toEqual(["plugin-risk: portfolio-risk"]);

    emergency.completion.resolve(unavailable);
    await Promise.resolve();
    await controller.processPlugins(makeSymbol(), "15m", bar);
    expect(emergency.reasons).toEqual(["plugin-risk: portfolio-risk", "plugin-risk: portfolio-risk"]);
    controller.dispose();
  });

  it("does not act on blocked or non-breaching plugin risk events", async () => {
    const { orderManager, positionManager } = await createDependencies();
    const blocked = new RiskActionPlugin("portfolio-risk", true);
    const informational = new InformationalRiskPlugin("portfolio-risk", true);
    const emergencies = new CallCounter();
    const controller = new StrategyPluginRiskController({
      instances: strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: blocked }],
        [
          "funding_flip_kill_switch",
          { kind: "plugin", name: "funding_flip_kill_switch", instance: informational },
        ],
      ]),
      orderManager,
      positionManager,
      enabledSymbols: new Set([makeSymbol()]),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => true,
      pause: noOperation,
      getRiskManager: () => unavailable,
      getPortfolioManager: () => unavailable,
      getOnEmergency: () => emergencies.increment,
      latestPriceFor: () => unavailable,
      notifyStrategyClosed: noOperation,
    });

    controller.start();
    await controller.processPlugins(makeSymbol(), "15m", {
      timestamp: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });
    expect(emergencies.count).toBe(0);
    controller.dispose();

    const unblockedController = new StrategyPluginRiskController({
      instances: strategyInstances([
        [
          "funding_flip_kill_switch",
          { kind: "plugin", name: "funding_flip_kill_switch", instance: informational },
        ],
      ]),
      orderManager,
      positionManager,
      enabledSymbols: new Set([makeSymbol()]),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => false,
      pause: noOperation,
      getRiskManager: () => unavailable,
      getPortfolioManager: () => unavailable,
      getOnEmergency: () => unavailable,
      latestPriceFor: () => unavailable,
      notifyStrategyClosed: noOperation,
    });
    unblockedController.start();
    await unblockedController.processPlugins(makeSymbol(), "15m", {
      timestamp: 2,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });
    expect(emergencies.count).toBe(0);
    unblockedController.dispose();
  });

  it("fails closed for invalid regime sizing and records an enabled daily regime close", async () => {
    const invalidDependencies = await createDependencies();
    const invalidPlugin = new RiskActionPlugin("regime-detector-v1:BTC/USDC", true);
    const pauses = new CallCounter();
    const invalidController = new StrategyPluginRiskController({
      instances: strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: invalidPlugin }],
      ]),
      ...invalidDependencies,
      enabledSymbols: new Set([makeSymbol()]),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => false,
      pause: pauses.increment,
      getRiskManager: () => unavailable,
      getPortfolioManager: () => unavailable,
      getOnEmergency: () => unavailable,
      latestPriceFor: () => unavailable,
      notifyStrategyClosed: noOperation,
    });
    invalidController.start();
    await invalidController.processPlugins(makeSymbol(), "15m", {
      timestamp: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });
    expect(pauses.count).toBe(1);
    invalidController.dispose();

    const dailyDependencies = await createDependencies();
    const dailyPlugin = new DailyRegimePlugin();
    const dailyController = new StrategyPluginRiskController({
      instances: strategyInstances([
        ["regime_detector", { kind: "plugin", name: "regime_detector", instance: dailyPlugin }],
      ]),
      ...dailyDependencies,
      enabledSymbols: new Set([makeSymbol()]),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => false,
      pause: noOperation,
      getRiskManager: () => unavailable,
      getPortfolioManager: () => unavailable,
      getOnEmergency: () => unavailable,
      latestPriceFor: () => unavailable,
      notifyStrategyClosed: noOperation,
    });
    dailyController.start();
    await dailyController.processPlugins(makeSymbol(), "1d", {
      timestamp: 2,
      open: 100,
      high: 101,
      low: 99,
      close: 101,
      volume: 2,
    });
    expect(dailyPlugin.recordedCloses).toEqual([{ symbol: "BTC/USDC", close: 101, timestamp: 2 }]);
    dailyController.dispose();
  });

  it("applies an execution lifecycle update once for a tracked trailing close", async () => {
    const { orderManager, positionManager } = await createDependencies();
    const position = positionManager.openPosition("trailing", makeSymbol(), "long", 1, 100, 1);
    const order = await orderManager.placeOrder({
      signal: { side: "sell", confidence: 1, reason: "trailing-stop", stopLoss: 0, takeProfit: 0 },
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 90,
      type: "market",
      reduceOnly: true,
      strategy: "trailing",
      leverage: 1,
    });
    const closedStrategies: string[] = [];
    const controller = new StrategyPluginRiskController({
      instances: strategyInstances([]),
      orderManager,
      positionManager,
      enabledSymbols: new Set([makeSymbol()]),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => false,
      pause: noOperation,
      getRiskManager: () => unavailable,
      getPortfolioManager: () => unavailable,
      getOnEmergency: () => unavailable,
      latestPriceFor: () => unavailable,
      notifyStrategyClosed: (strategyName) => {
        closedStrategies.push(strategyName);
      },
    });
    controller.recordPendingRiskClose(position.id, order.clientOrderId);
    const partialEvent: OrderLifecycleEvent = {
      kind: "execution",
      order: { ...order, status: "open", filled: 0.5, average: 89, updateTimestamp: 2 },
      execution: {
        executionId: "trailing-execution",
        clientOrderId: order.clientOrderId,
        exchangeOrderId: order.exchangeId,
        symbol: order.symbol,
        side: "sell",
        quantity: 0.5,
        price: 89,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 2,
      },
      deltaFilled: 0.5,
    };

    expect(controller.applyRiskCloseLifecycle(partialEvent)).toBe(true);
    expect(positionManager.getPosition("trailing", makeSymbol(), "long")?.quantity).toBe(0.5);
    const terminalEvent: OrderLifecycleEvent = {
      ...partialEvent,
      order: { ...partialEvent.order, status: "closed", filled: 1, updateTimestamp: 3 },
      execution: { ...partialEvent.execution, executionId: "trailing-terminal", quantity: 0.5, timestamp: 3 },
      deltaFilled: 0.5,
    };
    expect(controller.applyRiskCloseLifecycle(terminalEvent)).toBe(true);
    expect(positionManager.getPositions()).toHaveLength(0);
    expect(closedStrategies).toEqual(["trailing"]);
    expect(controller.applyRiskCloseLifecycle(terminalEvent)).toBe(false);
  });

  it("reconciles a terminal trailing close and clears a stale pending position", async () => {
    const { feed, orderManager, positionManager } = await createDependencies();
    const position = positionManager.openPosition("trailing", makeSymbol(), "long", 1, 100, 1);
    const order = await orderManager.placeOrder({
      signal: { side: "sell", confidence: 1, reason: "trailing-stop", stopLoss: 0, takeProfit: 0 },
      symbol: makeSymbol(),
      amount: 1,
      referencePrice: 90,
      type: "market",
      reduceOnly: true,
      strategy: "trailing",
      leverage: 1,
    });
    const closedStrategies: string[] = [];
    const controller = new StrategyPluginRiskController({
      instances: strategyInstances([]),
      orderManager,
      positionManager,
      enabledSymbols: new Set([makeSymbol()]),
      logger: new RecordingLogger(),
      isOrderEmissionBlocked: () => false,
      pause: noOperation,
      getRiskManager: () => unavailable,
      getPortfolioManager: () => unavailable,
      getOnEmergency: () => unavailable,
      latestPriceFor: () => unavailable,
      notifyStrategyClosed: (strategyName) => {
        closedStrategies.push(strategyName);
      },
    });
    controller.recordPendingRiskClose(position.id, order.clientOrderId);
    feed.setOrderStatus(order.clientOrderId, { filled: 0.5, average: 88, status: "open" });

    await controller.reconcileRiskCloses(makeSymbol());
    expect(positionManager.getPosition("trailing", makeSymbol(), "long")?.quantity).toBe(0.5);
    feed.setOrderStatus(order.clientOrderId, { filled: 1, average: 88, status: "closed" });
    await controller.reconcileRiskCloses(makeSymbol());
    expect(positionManager.getPositions()).toHaveLength(0);
    expect(closedStrategies).toEqual(["trailing"]);

    controller.recordPendingRiskClose("missing-position", order.clientOrderId);
    await controller.reconcileRiskCloses(makeSymbol());
  });
});
