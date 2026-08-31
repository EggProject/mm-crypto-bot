import * as support from "../../../src/bot/strategy-runner.test-support.js";
import { requestTrailingStopClose } from "../../../src/bot/strategy-runner.controller.test-support.js";

import { assertCondition } from "./runtime-driver-core.js";

function createRiskManager(): support.RiskManager {
  return new support.RiskManager({
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
}

async function verifyTrailingStopPrivateLifecycle(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const riskManager = createRiskManager();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  positions.setRiskManager(riskManager);
  const orders = new support.OrderManager({
    feed,
    getPositionContext: () => positions.getPositionContext(),
    getReduciblePosition: (symbol) => {
      const position = positions.getPositions().find((candidate) => candidate.symbol === symbol);
      return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
    },
  });
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: () => 0,
    enabledSymbols: ["BTC/USDC"],
    riskManager,
  });
  await orders.startLifecycle();
  const position = positions.openPosition("trail", support.makeSymbol(), "long", 1, 100, 1);
  riskManager.onTick({ positionId: position.id, side: "long", currentPrice: 105, atr: 1 });
  riskManager.onTick({ positionId: position.id, side: "long", currentPrice: 103, atr: 1 });
  await support.flushPrivateLifecycle();
  const closeId = support.requireDefined(orders.getInFlightOrderIds().at(0), "expected trailing close order");
  const close = support.requireDefined(feed.getOrder(closeId), "expected trailing close payload");
  assertCondition(close.side === "sell", "trailing close did not reduce a long position");
  lifecycle.emitExecution({
    executionId: "e2e-trailing-close",
    clientOrderId: closeId,
    exchangeOrderId: close.exchangeId,
    symbol: support.makeSymbol(),
    side: "sell",
    quantity: 1,
    price: 103,
    fee: 0,
    feeCurrency: "USDC",
    timestamp: Date.now(),
  });
  await support.flushPrivateLifecycle();
  assertCondition(positions.getPositionCount() === 0, "trailing close fill did not flatten exposure");
  assertCondition(
    riskManager.getSnapshot().trailingStops.length === 0,
    "filled trailing close remained armed",
  );
  runner.dispose();
  await orders.stopLifecycle();
}

async function verifyShortTrailingStopPrivateLifecycle(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const riskManager = createRiskManager();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  positions.setRiskManager(riskManager);
  const orders = new support.OrderManager({
    feed,
    getPositionContext: () => positions.getPositionContext(),
    getReduciblePosition: () => ({ side: "short", quantity: 1 }),
  });
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: () => 0,
    enabledSymbols: ["BTC/USDC"],
    riskManager,
  });
  await orders.startLifecycle();
  const position = positions.openPosition("short-trail", support.makeSymbol(), "short", 1, 100, 1);
  riskManager.onTick({ positionId: position.id, side: "short", currentPrice: 95, atr: 1 });
  riskManager.onTick({ positionId: position.id, side: "short", currentPrice: 97, atr: 1 });
  await support.flushPrivateLifecycle();
  const closeId = support.requireDefined(orders.getInFlightOrderIds().at(0), "expected short trailing close");
  const close = support.requireDefined(feed.getOrder(closeId), "expected short trailing close payload");
  assertCondition(close.side === "buy", "trailing close did not reduce a short position");
  lifecycle.emitExecution({
    executionId: "e2e-short-trailing-close",
    clientOrderId: closeId,
    exchangeOrderId: close.exchangeId,
    symbol: support.makeSymbol(),
    side: "buy",
    quantity: 1,
    price: 97,
    fee: 0,
    feeCurrency: "USDC",
    timestamp: Date.now(),
  });
  await support.flushPrivateLifecycle();
  assertCondition(positions.getPositionCount() === 0, "short trailing close fill did not flatten exposure");
  runner.dispose();
  await orders.stopLifecycle();
}

async function verifyTrailingCloseRetries(): Promise<void> {
  for (const outcome of ["canceled", "partial", "throw"] as const) {
    const feed = new support.TrailingCloseOutcomeFeed(outcome);
    await feed.open();
    const positions = new support.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const orders = new support.OrderManager({
      feed,
      getPositionContext: () => positions.getPositionContext(),
      getReduciblePosition: (symbol) => {
        const position = positions.getPositions().find((candidate) => candidate.symbol === symbol);
        return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
      },
    });
    const position = positions.openPosition("retry", support.makeSymbol(), "long", 1, 100, 1);
    await requestTrailingStopClose(
      { orderManager: orders, positionManager: positions },
      position.id,
      95,
      outcome,
    );
    const firstQuantity = positions.getPosition("retry", support.makeSymbol(), "long")?.quantity;
    assertCondition(
      firstQuantity === (outcome === "partial" ? 0.5 : 1),
      `${outcome} close changed exposure incorrectly`,
    );
    await requestTrailingStopClose(
      { orderManager: orders, positionManager: positions },
      position.id,
      94,
      `${outcome}-retry`,
    );
    assertCondition(
      orders.getCounters().placed === (outcome === "throw" ? 0 : 2),
      `${outcome} close was not retried consistently`,
    );
  }
}

export async function runStrategyRunnerRiskLifecycle(): Promise<void> {
  await verifyTrailingStopPrivateLifecycle();
  await verifyShortTrailingStopPrivateLifecycle();
  await verifyTrailingCloseRetries();
}
