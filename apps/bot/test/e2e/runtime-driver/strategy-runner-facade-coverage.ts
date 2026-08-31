import type { BotState } from "../../../src/bot/state-store.js";
import * as support from "../../../src/bot/strategy-runner.test-support.js";

import { assertCondition, expectFailure } from "./runtime-driver-core.js";

function createPositionManager(): support.PositionManager {
  return new support.PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
}

function ticker(timestamp: number, last = 100): support.FeedEvent {
  return {
    kind: "ticker",
    payload: {
      symbol: support.makeSymbol(),
      timestamp,
      bid: last - 1,
      ask: last + 1,
      last,
      baseVolume: 1,
      quoteVolume: last,
    },
  };
}

function riskManager(): support.RiskManager {
  return new support.RiskManager({
    trailingStop: { enabled: false, atrPeriod: 2, atrMultiplier: 1, side: "both" },
    kelly: {
      enabled: true,
      fraction: 0.25,
      windowSize: 5,
      minTrades: 1,
      fallbackFraction: 0.02,
      maxFraction: 0.1,
    },
    drawdownScaler: { enabled: false, maxDdPct: 0.2, initialEquity: 10_000 },
  });
}

function emptyState(): BotState {
  return {
    version: 1,
    savedAt: 1,
    equityUsd: 10_000,
    initialEquityUsd: 10_000,
    realizedPnlUsd: 0,
    positions: [],
    closedTrades: [],
    inFlightOrderIds: [],
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
  };
}

class CloseAwareForceExitStrategy extends support.ForceExitStrategy {
  public readonly closeReasons: string[] = [];

  public onPositionClosed(reason: string): void {
    this.closeReasons.push(reason);
  }
}

class CloseAwareSignalStrategy extends support.FixedSignalStrategy {
  public readonly closeReasons: string[] = [];

  public onPositionClosed(reason: string): void {
    this.closeReasons.push(reason);
  }
}

async function verifyConstructorAndPublicFacadeContracts(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positions = createPositionManager();
  const orders = new support.OrderManager({
    feed,
    getPositionContext: () => positions.getPositionContext(),
    paperMode: true,
  });
  const options = {
    instances: support.strategyInstances([]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: () => 0,
    enabledSymbols: ["BTC/USDC"],
  };
  expectFailure(
    () => new support.StrategyRunner({ ...options, maxLeverage: 0 }),
    "zero max leverage must fail closed",
  );
  expectFailure(
    () =>
      new support.StrategyRunner({
        ...options,
        strategyPolicies: new Map([["donchian_pivot_composition", { leverage: NaN }]]),
      }),
    "non-finite strategy leverage must fail closed",
  );

  const strategy = new support.FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "facade-statistics",
    stopLoss: 0,
    takeProfit: 0,
  });
  const runner = new support.StrategyRunner({
    ...options,
    instances: support.strategyInstances([
      [
        "regime_detector",
        { kind: "plugin", name: "regime_detector", instance: new support.LifecyclePlugin() },
      ],
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
      ],
    ]),
  });
  assertCondition(
    runner.getActiveStrategyNames().join(",") === "regime_detector,donchian_pivot_composition",
    "runner did not expose all active instance names",
  );
  await runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  const statistics = runner.getStats();
  assertCondition(statistics.totalSignals === 1, "runner did not record the public signal statistic");
  assertCondition(statistics.lastSignalStrategy === "donchian_pivot_composition", "signal strategy was lost");
  assertCondition(statistics.lastSignalAt !== null, "signal time was not recorded");
  assertCondition(statistics.ticksProcessed === 1, "runner did not record processed event count");
  const state = emptyState();
  const projectedState = support.runnerStatsToState(statistics, state);
  assertCondition(projectedState.counters === state.counters, "runner state projection changed counters");
  assertCondition(
    support.defaultSizingFunction({
      signal: { side: "buy", confidence: 1, reason: "facade-sizing", stopLoss: 0, takeProfit: 0 },
      symbol: support.makeSymbol(),
      referencePrice: 100,
      equityUsd: 10_000,
      riskPerTrade: 0.01,
    }) === 1,
    "default sizing did not calculate the positive quantity",
  );
  assertCondition(
    support.defaultSizingFunction({
      signal: { side: "buy", confidence: 1, reason: "facade-zero-sizing", stopLoss: 0, takeProfit: 0 },
      symbol: support.makeSymbol(),
      referencePrice: 0,
      equityUsd: 10_000,
      riskPerTrade: 0.01,
    }) === 0,
    "default sizing did not reject a zero reference price",
  );
  runner.setRiskManager(riskManager());
  // eslint-disable-next-line unicorn/no-null -- The public detach operation takes null explicitly.
  runner.setRiskManager(null);
  runner.pause();
  runner.dispose();
  runner.dispose();
  runner.resume();
  assertCondition(runner.isPaused(), "disposed runner resumed after cleanup");
  await runner.onFeedEvent(support.makeOhlcvFeedEvent(2));
  assertCondition(strategy.onCandleCallCount === 1, "disposed runner processed another strategy event");
}

async function verifyNativeProtectionLifecycleThroughRunner(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const positions = createPositionManager();
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const strategy = new support.FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "facade-native-protection",
    stopLoss: 90,
    takeProfit: 110,
  });
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
      ],
    ]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  await orders.startLifecycle();
  try {
    await runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
    const entryId = support.requireDefined(orders.getInFlightOrderIds().at(0), "missing native entry");
    feed.setOrderStatus(entryId, { status: "closed", filled: 1 });
    await runner.onFeedEvent(ticker(2));
    assertCondition(
      positions.getPositionCount() === 1,
      "filled entry was not booked before protection setup",
    );
    assertCondition(
      positions.getPosition("donchian_pivot_composition", support.makeSymbol(), "long")?.entryPrice === 100,
      "entry reconciliation did not use the current ticker price when the order had no fill price",
    );
    const protectionIds = orders.getInFlightOrderIds();
    assertCondition(protectionIds.length === 2, "runner did not install the native protective pair");

    const firstId = support.requireDefined(protectionIds.at(0), "missing first protective leg");
    const first = support.requireDefined(feed.getOrder(firstId), "missing first protective order");
    feed.setOrderStatus(first.clientOrderId, { filled: 1, status: "closed" });
    await runner.onFeedEvent(ticker(3, 90));
    assertCondition(
      positions.getPositionCount() === 0 && positions.getClosedTrades().at(-1)?.exitPrice === 90,
      "native protection reconciliation did not flatten exposure at the current ticker price",
    );

    const siblingId = support.requireDefined(protectionIds.at(1), "missing sibling protective leg");
    const sibling = support.requireDefined(feed.getOrder(siblingId), "missing sibling protective order");
    assertCondition(
      sibling.status === "canceled",
      "filled protective leg did not request sibling cancellation",
    );
    lifecycle.emitOrder(sibling);
    await support.flushPrivateLifecycle();
    positions.openPosition("cascade_fade", support.makeSymbol(), "long", 2, 101, 1);
    lifecycle.emitExecution({
      executionId: "facade-protection-late-fill-without-position",
      clientOrderId: sibling.clientOrderId,
      exchangeOrderId: sibling.exchangeId,
      symbol: sibling.symbol,
      side: sibling.side,
      quantity: 1,
      price: 110,
      fee: 0,
      feeCurrency: "USDC",
      timestamp: 4,
    });
    await support.flushPrivateLifecycle();
    assertCondition(
      positions.getPosition("cascade_fade", support.makeSymbol(), "long")?.quantity === 2 &&
        positions.getClosedTrades().length === 1 &&
        orders.getInFlightOrderIds().length === 0,
      "late protective evidence changed an unrelated attributed position or fabricated the retired one",
    );
  } finally {
    runner.dispose();
    await orders.stopLifecycle();
  }
}

async function verifyRiskCloseReconciliationUsesTickerFallback(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positions = createPositionManager();
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const strategy = new CloseAwareForceExitStrategy({
    side: "buy",
    confidence: 1,
    reason: "facade-risk-close",
    stopLoss: 0,
    takeProfit: 0,
  });
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
      ],
    ]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  try {
    positions.openPosition("donchian_pivot_composition", support.makeSymbol(), "long", 1, 100, 1);
    await runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
    const closeId = support.requireDefined(
      orders.getInFlightOrderIds().at(0),
      "missing trailing close order",
    );
    feed.setOrderStatus(closeId, { filled: 1, status: "closed" });
    await runner.onFeedEvent(ticker(2));
    assertCondition(
      positions.getPositionCount() === 0 && positions.getClosedTrades().at(-1)?.exitPrice === 100,
      "risk-close reconciliation did not apply the current ticker price without an order fill price",
    );
    assertCondition(
      strategy.closeReasons.join(",") === "risk_close",
      "risk-close reconciliation did not notify the strategy callback",
    );
  } finally {
    runner.dispose();
  }
}

async function verifyNativeExecutionLifecycleForShortPosition(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const positions = createPositionManager();
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const strategy = new CloseAwareSignalStrategy({
    side: "sell",
    confidence: 1,
    reason: "facade-short-native-execution",
    stopLoss: 110,
    takeProfit: 90,
  });
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([
      ["cascade_fade", { kind: "strategy", name: "cascade_fade", instance: strategy }],
    ]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  await orders.startLifecycle();
  try {
    await runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
    const entryId = support.requireDefined(orders.getInFlightOrderIds().at(0), "missing short native entry");
    feed.setOrderStatus(entryId, { status: "closed", filled: 1, average: 100 });
    await runner.onFeedEvent(ticker(2, 100));
    const protectionId = support.requireDefined(
      orders.getInFlightOrderIds().at(0),
      "missing short native protection",
    );
    const protection = support.requireDefined(
      feed.getOrder(protectionId),
      "missing short protection payload",
    );
    lifecycle.emitExecution({
      executionId: "facade-short-native-partial-execution",
      clientOrderId: protection.clientOrderId,
      exchangeOrderId: protection.exchangeId,
      symbol: protection.symbol,
      side: protection.side,
      quantity: 0.5,
      price: 90,
      fee: 0,
      feeCurrency: "USDC",
      timestamp: 3,
    });
    await support.flushPrivateLifecycle();
    assertCondition(
      positions.getPosition("cascade_fade", support.makeSymbol(), "short")?.quantity === 0.5,
      "short native execution lifecycle did not apply the authoritative partial close",
    );
    assertCondition(
      support.copyOrders(feed.orderBook).some((order) => order.status === "canceled"),
      "short native execution lifecycle did not cancel the sibling after a partial fill",
    );
  } finally {
    runner.dispose();
    await orders.stopLifecycle();
  }
}

async function verifyNativeLongOrderLifecycleFallbacks(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const positions = createPositionManager();
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const strategy = new CloseAwareSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "facade-long-native-order",
    stopLoss: 90,
    takeProfit: 110,
  });
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
      ],
    ]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
  });
  await orders.startLifecycle();
  try {
    await runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
    const entryId = support.requireDefined(orders.getInFlightOrderIds().at(0), "missing long native entry");
    feed.setOrderStatus(entryId, { status: "closed", filled: 1, average: 100 });
    await runner.onFeedEvent(ticker(2, 100));
    const protectionId = support.requireDefined(
      orders.getInFlightOrderIds().at(0),
      "missing long native protection",
    );
    const protection = support.requireDefined(feed.getOrder(protectionId), "missing long protection payload");
    const before = Date.now();
    lifecycle.emitOrder({
      ...protection,
      status: "closed",
      filled: 1,
      average: undefined,
      price: undefined,
      updateTimestamp: undefined,
    });
    await support.flushPrivateLifecycle();
    const closed = positions.getClosedTrades().at(-1);
    assertCondition(
      positions.getPositionCount() === 0 && closed?.exitPrice === 100 && closed.closedAt >= before,
      "long native order lifecycle did not use latest-price and clock fallbacks",
    );
    assertCondition(
      strategy.closeReasons.length === 1,
      "long native terminal lifecycle did not notify the strategy callback",
    );
    lifecycle.emitExecution({
      executionId: "facade-long-native-late-execution-without-position",
      clientOrderId: protection.clientOrderId,
      exchangeOrderId: protection.exchangeId,
      symbol: protection.symbol,
      side: protection.side,
      quantity: 1,
      price: 90,
      fee: 0,
      feeCurrency: "USDC",
      timestamp: 4,
    });
    await support.flushPrivateLifecycle();
    assertCondition(
      positions.getPositionCount() === 0,
      "late native execution changed the already-closed strategy position",
    );
  } finally {
    runner.dispose();
    await orders.stopLifecycle();
  }
}

export async function runStrategyRunnerFacadeCoverage(): Promise<void> {
  await verifyConstructorAndPublicFacadeContracts();
  await verifyNativeProtectionLifecycleThroughRunner();
  await verifyRiskCloseReconciliationUsesTickerFallback();
  await verifyNativeExecutionLifecycleForShortPosition();
  await verifyNativeLongOrderLifecycleFallbacks();
}
