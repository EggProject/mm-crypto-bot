import * as support from "../../../src/bot/strategy-runner.test-support.js";
import { StrategyNativeProtectionController } from "../../../src/bot/strategy-runner-native-protection-controller.js";

import { assertCondition, quietLogger } from "./runtime-driver-core.js";
import { makePortfolioStack } from "./runtime-driver-portfolio-fixtures.js";

function ticker(): support.FeedEvent {
  return {
    kind: "ticker",
    payload: {
      symbol: support.makeSymbol(),
      timestamp: 2,
      bid: 99,
      ask: 101,
      last: 100,
      baseVolume: 1,
      quoteVolume: 100,
    },
  };
}

function noOperation(): void {
  return;
}

class FilledFallbackFeed extends support.MockExchangeFeed {
  public override async placeOrder(request: support.OrderRequest): Promise<support.Order> {
    const order = await super.placeOrder(request);
    if (request.reduceOnly !== true) return order;
    return {
      ...order,
      status: "closed",
      filled: request.amount,
      average: undefined,
      price: undefined,
      updateTimestamp: undefined,
    };
  }
}

async function verifyDirectFailsafeClose(): Promise<void> {
  const feed = new support.FailTakeProfitFeed();
  await feed.open();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const strategy = new support.FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "e2e-protection-failsafe",
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
  await runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  const entryId = support.requireDefined(orders.getInFlightOrderIds().at(0), "expected native entry");
  feed.setOrderStatus(entryId, { filled: 1, average: 100, status: "closed" });
  await runner.onFeedEvent(ticker());
  const stopLoss = support.requireDefined(
    support.copyOrders(feed.orderBook).find((order) => order.clientOrderId.includes("stop_loss")),
    "expected partially-created stop-loss protection",
  );
  assertCondition(stopLoss.status === "canceled", "partial native protection did not begin cancellation");
  assertCondition(
    support.copyOrders(feed.orderBook).every((order) => !order.clientOrderId.includes("protection-failsafe")),
    "fail-safe close ran before the partial protection received terminal evidence",
  );
  lifecycle.emitOrder(stopLoss);
  await support.flushPrivateLifecycle();
  const failSafe = support.requireDefined(
    support.copyOrders(feed.orderBook).find((order) => order.clientOrderId.includes("protection-failsafe")),
    "expected a fail-safe close after terminal partial protection evidence",
  );
  assertCondition(
    failSafe.side === "sell",
    "failed native protection did not issue a reduce-only long close",
  );
  runner.dispose();
  await orders.stopLifecycle();
}

async function verifyPortfolioManagedFailsafeClose(): Promise<void> {
  const stack = await makePortfolioStack();
  try {
    const position = stack.positionManager.openPosition(
      "donchian_pivot_composition",
      support.makeSymbol(),
      "long",
      1,
      100,
      1,
    );
    const controller = new StrategyNativeProtectionController({
      orderManager: stack.orderManager,
      positionManager: stack.positionManager,
      portfolioManager: stack.portfolioManager,
      logger: quietLogger,
      findOpenPosition: (strategy, symbol) =>
        stack.positionManager.getPositions().find((candidate) => {
          return candidate.strategy === strategy && candidate.symbol === symbol;
        }),
      protectionKey: (strategy, symbol) => `${strategy}:${symbol}`,
      latestPriceFor: () => 100,
      recordPendingRiskClose: (positionId, clientOrderId) => {
        void positionId;
        void clientOrderId;
      },
      setPaperProtection: (key, protection) => {
        void key;
        void protection;
      },
    });
    await controller.failSafeClose({
      strategy: "donchian_pivot_composition",
      symbol: support.makeSymbol(),
      side: "long",
      quantity: position.quantity,
      leverage: position.leverage,
      signal: { side: "buy", confidence: 1, reason: "portfolio-failsafe", stopLoss: 0, takeProfit: 0 },
      referencePrice: position.currentPrice,
    });
    assertCondition(
      stack.orderManager.getCounters().placed === 1,
      "portfolio-managed fail-safe did not request a close order",
    );
    const remainingPosition = stack.positionManager.getPosition(
      "donchian_pivot_composition",
      support.makeSymbol(),
      "long",
    );
    if (remainingPosition !== undefined) {
      stack.positionManager.reconcileVenueAbsent(remainingPosition.id);
    }
    await controller.failSafeClose({
      strategy: "donchian_pivot_composition",
      symbol: support.makeSymbol(),
      side: "long",
      quantity: position.quantity,
      leverage: position.leverage,
      signal: { side: "buy", confidence: 1, reason: "portfolio-failsafe-repeat", stopLoss: 0, takeProfit: 0 },
      referencePrice: position.currentPrice,
    });
    assertCondition(
      stack.orderManager.getCounters().placed === 1,
      "fail-safe retried after the authoritative position was absent",
    );
  } finally {
    await stack.feed.close();
  }
}

async function verifyDirectFilledFailsafeClose(): Promise<void> {
  const feed = new support.TrailingCloseOutcomeFeed("partial");
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const symbol = support.makeSymbol();
  positions.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
  const controller = new StrategyNativeProtectionController({
    orderManager: orders,
    positionManager: positions,
    portfolioManager: undefined,
    logger: quietLogger,
    findOpenPosition: (strategy, candidateSymbol) =>
      positions
        .getPositions()
        .find((candidate) => candidate.strategy === strategy && candidate.symbol === candidateSymbol),
    protectionKey: (strategy, candidateSymbol) => `${strategy}:${candidateSymbol}`,
    latestPriceFor: () => 100,
    recordPendingRiskClose: () => {
      throw new Error("filled fail-safe close was incorrectly left pending");
    },
    setPaperProtection: noOperation,
  });
  await controller.failSafeClose({
    strategy: "donchian_pivot_composition",
    symbol,
    side: "long",
    quantity: 1,
    leverage: 1,
    signal: { side: "buy", confidence: 1, reason: "filled-failsafe", stopLoss: 0, takeProfit: 0 },
    referencePrice: 100,
  });
  assertCondition(
    positions.getPosition("donchian_pivot_composition", symbol, "long")?.quantity === 0.5,
    "filled direct fail-safe close did not record the authoritative partial fill",
  );
  assertCondition(orders.getCounters().placed === 1, "filled direct fail-safe close did not place one order");
}

async function verifyShortFailsafeUsesReferencePriceAndClockFallback(): Promise<void> {
  const feed = new FilledFallbackFeed();
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const symbol = support.makeSymbol();
  positions.openPosition("donchian_pivot_composition", symbol, "short", 1, 100, 1);
  const controller = new StrategyNativeProtectionController({
    orderManager: orders,
    positionManager: positions,
    portfolioManager: undefined,
    logger: quietLogger,
    findOpenPosition: (strategy, candidateSymbol) =>
      positions
        .getPositions()
        .find((candidate) => candidate.strategy === strategy && candidate.symbol === candidateSymbol),
    protectionKey: (strategy, candidateSymbol) => `${strategy}:${candidateSymbol}`,
    latestPriceFor: () => 100,
    recordPendingRiskClose: noOperation,
    setPaperProtection: noOperation,
  });
  const before = Date.now();
  await controller.failSafeClose({
    strategy: "donchian_pivot_composition",
    symbol,
    side: "short",
    quantity: 1,
    leverage: 1,
    signal: { side: "sell", confidence: 1, reason: "short-filled-failsafe", stopLoss: 0, takeProfit: 0 },
    referencePrice: 97,
  });
  const trade = positions.getClosedTrades().at(-1);
  assertCondition(
    positions.getPositionCount() === 0 && trade?.exitPrice === 97 && trade.closedAt >= before,
    "short fail-safe did not close at the reference-price and clock fallbacks",
  );
  assertCondition(
    support.copyOrders(feed.orderBook).at(-1)?.side === "buy",
    "short fail-safe did not submit a reduce-only buy close",
  );
}

export async function runNativeProtectionFailsafe(): Promise<void> {
  await verifyDirectFailsafeClose();
  await verifyPortfolioManagedFailsafeClose();
  await verifyDirectFilledFailsafeClose();
  await verifyShortFailsafeUsesReferencePriceAndClockFallback();
}
