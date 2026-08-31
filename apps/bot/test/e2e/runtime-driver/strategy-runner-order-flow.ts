import * as support from "../../../src/bot/strategy-runner.test-support.js";
import { OrderManager } from "../../../src/bot/order-manager.js";
import type { SizingFn as StrategySizingFunction } from "../../../src/bot/strategy-runner.types.js";
import type { ExchangeOrderId, Order, OrderRequest } from "@mm-crypto-bot/exchange";

import { assertCondition, RecordingLogger } from "./runtime-driver-core.js";

class ExchangeIdFeed extends support.MockExchangeFeed {
  public constructor(private readonly injectedExchangeId: ExchangeOrderId) {
    super();
  }

  public override async placeOrder(request: OrderRequest) {
    const order = await super.placeOrder(request);
    this.setOrderStatus(order.clientOrderId, { exchangeId: this.injectedExchangeId });
    return { ...order, exchangeId: this.injectedExchangeId };
  }
}

function ticker(timestamp: number, last: number): support.FeedEvent {
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

async function makeStack(
  isPaperMode: boolean,
  sizingFunction: StrategySizingFunction = () => 1,
): Promise<{
  readonly feed: support.MockExchangeFeed;
  readonly orders: support.OrderManager;
  readonly positions: support.PositionManager;
  readonly runner: support.StrategyRunner;
}> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({
    feed,
    getPositionContext: () => positions.getPositionContext(),
    paperMode: isPaperMode,
  });
  const strategy = new support.FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "e2e-order-flow",
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
    sizingFn: sizingFunction,
    enabledSymbols: ["BTC/USDC"],
  });
  return { feed, orders, positions, runner };
}

async function verifySizingAndPaperFeedFlow(): Promise<void> {
  const quantity = support.defaultSizingFunction({
    signal: { side: "buy", confidence: 1, reason: "e2e-sizing", stopLoss: 0, takeProfit: 0 },
    symbol: support.makeSymbol(),
    referencePrice: 60_000,
    equityUsd: 10_000,
    riskPerTrade: 0.01,
  });
  assertCondition(quantity > 0.001 && quantity < 0.002, "valid sizing did not produce the expected quantity");
  assertCondition(
    support.defaultSizingFunction({
      signal: { side: "buy", confidence: 1, reason: "e2e-zero-price", stopLoss: 0, takeProfit: 0 },
      symbol: support.makeSymbol(),
      referencePrice: 0,
      equityUsd: 10_000,
      riskPerTrade: 0.01,
    }) === 0,
    "zero reference price must not produce an order quantity",
  );

  const { feed, positions, runner } = await makeStack(true, support.defaultSizingFunction);
  await feed.subscribeTicker(support.makeSymbol(), (event) => void runner.onFeedEvent(event));
  support.pushTickerTick(feed, support.makeSymbol(), 60_000);
  support.pushTickerTick(feed, support.makeSymbol(), 60_001);
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assertCondition(runner.getStats().ticksProcessed === 2, "ticker events were not processed");

  await runner.onFeedEvent({
    kind: "ohlcv",
    payload: { symbol: support.makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
  });
  assertCondition(positions.getPositionCount() === 1, "paper candle entry did not book a position");
  runner.dispose();
}

async function verifyOpenAcknowledgementAndSerializer(): Promise<void> {
  const stack = await makeStack(false);
  await stack.orders.startLifecycle();
  await stack.runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  assertCondition(stack.orders.getInFlightCount() === 1, "live acknowledgement did not remain in flight");
  assertCondition(stack.positions.getPositionCount() === 0, "open acknowledgement must not book a fill");
  const acknowledgedOrderId = support.requireDefined(
    stack.orders.getInFlightOrderIds().at(0),
    "expected acknowledged lifecycle order",
  );
  const canceled = await stack.orders.cancelOrder(acknowledgedOrderId, support.makeSymbol());
  assertCondition(canceled.status === "canceled", "lifecycle cancellation did not return a terminal order");
  assertCondition(stack.orders.getInFlightCount() === 0, "canceled lifecycle order remained in flight");
  stack.runner.dispose();
  await stack.orders.stopLifecycle();

  const serialized = await makeStack(false);
  await Promise.all([
    serialized.runner.onFeedEvent(support.makeOhlcvFeedEvent(1)),
    serialized.runner.onFeedEvent(support.makeOhlcvFeedEvent(2)),
  ]);
  assertCondition(
    serialized.orders.getCounters().placed === 1,
    "same-symbol bars bypassed entry idempotency",
  );
  serialized.runner.dispose();
}

async function verifyCumulativeLiveFills(): Promise<void> {
  const stack = await makeStack(false, () => 2);
  await stack.runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  const id = support.requireDefined(stack.orders.getInFlightOrderIds().at(0), "expected live entry order");
  stack.feed.setOrderStatus(id, { filled: 1, average: 101, status: "open" });
  await stack.runner.onFeedEvent(ticker(2, 101));
  await stack.runner.onFeedEvent(ticker(3, 101));
  assertCondition(
    stack.positions.getPosition("donchian_pivot_composition", support.makeSymbol(), "long")?.quantity === 1,
    "duplicate ticker applied the partial fill more than once",
  );
  stack.feed.setOrderStatus(id, { filled: 2, average: 102, status: "closed" });
  await stack.runner.onFeedEvent(ticker(4, 102));
  assertCondition(
    stack.positions.getPosition("donchian_pivot_composition", support.makeSymbol(), "long")?.quantity === 2,
    "terminal cumulative fill was not reconciled",
  );
  assertCondition(stack.orders.getInFlightCount() === 0, "terminal entry remained in flight");
  stack.runner.dispose();
}

async function verifyNativeProtectionReplacement(): Promise<void> {
  const stack = await makeStack(false, () => 2);
  const lifecycle = support.attachPrivateLifecycle(stack.feed);
  await stack.orders.startLifecycle();
  await stack.runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  const entryId = support.requireDefined(stack.orders.getInFlightOrderIds().at(0), "expected entry order");
  stack.feed.setOrderStatus(entryId, { filled: 1, average: 100, status: "open" });
  await stack.runner.onFeedEvent(ticker(2, 100));
  const firstProtectionIds = stack.orders.getInFlightOrderIds().filter((id) => id !== entryId);
  assertCondition(firstProtectionIds.length === 2, "partial fill did not install both native protections");

  stack.feed.setOrderStatus(entryId, { filled: 2, average: 100, status: "closed" });
  await stack.runner.onFeedEvent(ticker(3, 100));
  assertCondition(
    stack.orders.getInFlightOrderIds().filter((id) => id !== entryId).length === 0,
    "old protections remained active",
  );
  for (const id of firstProtectionIds) {
    lifecycle.emitOrder(
      support.requireDefined(stack.feed.getOrder(id), "expected canceled native protection"),
    );
  }
  await support.flushPrivateLifecycle();
  const replacementIds = stack.orders.getInFlightOrderIds();
  assertCondition(replacementIds.length === 2, "terminal fill did not replace native protections");

  const triggeredId = support.requireDefined(replacementIds.at(0), "expected native protection");
  const siblingId = support.requireDefined(replacementIds.at(1), "expected sibling native protection");
  stack.feed.setOrderStatus(triggeredId, { filled: 1, average: 90, status: "closed" });
  await stack.runner.onFeedEvent(ticker(4, 90));
  assertCondition(
    stack.feed.getOrder(siblingId)?.status === "canceled",
    "filled protection did not cancel sibling",
  );
  lifecycle.emitOrder(
    support.requireDefined(stack.feed.getOrder(siblingId), "expected canceled sibling protection"),
  );
  await support.flushPrivateLifecycle();
  assertCondition(
    stack.orders.getInFlightOrderIds().length === 2,
    "residual position did not receive resized protections",
  );
  stack.runner.dispose();
  await stack.orders.stopLifecycle();
}

async function verifyExistingPositionGatesAndForceExit(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 100_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({
    feed,
    getPositionContext: () => positions.getPositionContext(),
    paperMode: true,
  });
  positions.openPosition("donchian_pivot_composition", support.makeSymbol(), "long", 0.1, 60_000, 1);
  const sameSide = new support.FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "e2e-existing-same-side",
    stopLoss: 0,
    takeProfit: 0,
  });
  const sameSideRunner = new support.StrategyRunner({
    instances: support.strategyInstances([
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: sameSide },
      ],
    ]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: support.defaultSizingFunction,
    enabledSymbols: ["BTC/USDC"],
  });
  await sameSideRunner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  assertCondition(positions.getPositionCount() === 1, "same-side signal opened a duplicate position");
  assertCondition(sameSide.onCandleCallCount === 0, "same-side exposure did not gate the signal");
  assertCondition(sameSide.observedCallCount === 1, "same-side exposure skipped observation");
  sameSideRunner.dispose();

  const opposite = new support.FixedSignalStrategy({
    side: "sell",
    confidence: 1,
    reason: "e2e-existing-opposite-side",
    stopLoss: 0,
    takeProfit: 0,
  });
  const oppositeRunner = new support.StrategyRunner({
    instances: support.strategyInstances([
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: opposite },
      ],
    ]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: support.defaultSizingFunction,
    enabledSymbols: ["BTC/USDC"],
  });
  await oppositeRunner.onFeedEvent(support.makeOhlcvFeedEvent(2));
  assertCondition(positions.getPositionCount() === 1, "opposite-side signal opened concurrent exposure");
  assertCondition(opposite.onCandleCallCount === 0, "opposite-side exposure did not gate the signal");
  oppositeRunner.dispose();

  const forceExit = new support.ForceExitStrategy({
    side: "buy",
    confidence: 1,
    reason: "e2e-force-exit",
    stopLoss: 0,
    takeProfit: 0,
  });
  const forceExitRunner = new support.StrategyRunner({
    instances: support.strategyInstances([
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: forceExit },
      ],
    ]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: support.defaultSizingFunction,
    enabledSymbols: ["BTC/USDC"],
  });
  await forceExitRunner.onFeedEvent(support.makeOhlcvFeedEvent(3));
  assertCondition(positions.getPositionCount() === 0, "force-exit update did not close exposure");
  assertCondition(
    forceExit.onOpenPositionUpdateCallCount === 1,
    "strategy did not receive its position update",
  );
  assertCondition(positions.getClosedTrades().length === 1, "force exit did not record the closed trade");
  forceExitRunner.dispose();
}

async function verifyPrivateExecutionIdempotency(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  let opened = 0;
  const strategy: support.Strategy = {
    name: "e2e-private-execution",
    timeframes: ["15m"],
    warmup: () => 0,
    onCandle: () => ({ side: "buy", confidence: 1, reason: "e2e-private", stopLoss: 0, takeProfit: 0 }),
    onPositionOpened: () => {
      opened += 1;
    },
  };
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([
      [
        "donchian_pivot_composition",
        { kind: "strategy", name: "donchian_pivot_composition", instance: strategy },
      ],
    ]),
    orderManager: orders,
    positionManager: positions,
    sizingFn: () => 2,
    enabledSymbols: ["BTC/USDC"],
  });
  await orders.startLifecycle();
  await runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  const entryId = support.requireDefined(orders.getInFlightOrderIds().at(0), "expected private entry");
  const entry = support.requireDefined(feed.getOrder(entryId), "expected private entry payload");
  const execution = (executionId: string, quantity: number, price: number): support.Execution => ({
    executionId,
    clientOrderId: entryId,
    exchangeOrderId: entry.exchangeId,
    symbol: support.makeSymbol(),
    side: "buy",
    quantity,
    price,
    fee: 0,
    feeCurrency: "USDC",
    timestamp: 1,
  });
  lifecycle.emitExecution(execution("e2e-late-first", 1, 101));
  lifecycle.emitExecution(execution("e2e-late-first", 1, 101));
  lifecycle.emitExecution(execution("e2e-earlier-second", 1, 99));
  await support.flushPrivateLifecycle();
  const position = positions.getPosition("donchian_pivot_composition", support.makeSymbol(), "long");
  assertCondition(position?.quantity === 2, "private executions were not booked exactly once");
  assertCondition(position.entryPrice === 100, "private execution prices were not averaged exactly");
  assertCondition(opened === 1, "private entry lifecycle notified more than once");
  assertCondition(orders.getInFlightCount() === 0, "terminal private entry remained in flight");
  positions.closePosition("donchian_pivot_composition", support.makeSymbol(), 100);
  await runner.onFeedEvent(support.makeOhlcvFeedEvent(2));
  assertCondition(
    orders.getCounters().placed === 2,
    "terminal private evidence did not release the next intent",
  );
  runner.dispose();
  await orders.stopLifecycle();
}

async function verifyLifecycleRecoveryAndRetention(): Promise<void> {
  const absentFeed = new support.MockExchangeFeed();
  await absentFeed.open();
  const absentManager = new OrderManager({
    feed: absentFeed,
    getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    logger: new RecordingLogger(),
  });
  await absentManager.startLifecycle();
  await absentManager.stopLifecycle();

  const paperFeed = new support.MockExchangeFeed();
  await paperFeed.open();
  const paperLifecycle = support.attachPrivateLifecycle(paperFeed);
  const paperManager = new OrderManager({
    feed: paperFeed,
    getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    paperMode: true,
    logger: new RecordingLogger(),
  });
  let paperEvents = 0;
  paperManager.onLifecycle(() => {
    paperEvents += 1;
  });
  await paperManager.startLifecycle();
  const paperOrder = await paperManager.placeOrder({
    signal: { side: "buy", confidence: 1, reason: "e2e-paper-lifecycle", stopLoss: 0, takeProfit: 0 },
    symbol: support.makeSymbol(),
    amount: 1,
    referencePrice: 100,
    type: "market",
  });
  paperLifecycle.emitOrder(paperOrder);
  assertCondition(paperEvents === 0, "paper manager subscribed to private lifecycle streams");

  const exchangeId = support.requireDefined(paperOrder.exchangeId, "paper order did not have an exchange id");
  const feed = new ExchangeIdFeed(exchangeId);
  await feed.open();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const logger = new RecordingLogger();
  const manager = new OrderManager({
    feed,
    getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
    logger,
  });
  const events: { readonly kind: string; readonly delta: number }[] = [];
  manager.onLifecycle((event) => {
    events.push({ kind: event.kind, delta: event.deltaFilled });
  });
  for (const failure of [new Error("listener error"), "listener string"] as const) {
    manager.onLifecycle(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E verifies public Error and string listener isolation.
      throw failure;
    });
  }
  await manager.startLifecycle();
  const order = await manager.placeOrder({
    signal: { side: "buy", confidence: 1, reason: "e2e-lifecycle-recovery", stopLoss: 0, takeProfit: 0 },
    symbol: support.makeSymbol(),
    amount: 1,
    referencePrice: 100,
    type: "market",
  });
  feed.setOrderStatus(order.clientOrderId, { filled: 1, average: 100, status: "open" });
  const recovered = await manager.reconcileOrder(order.clientOrderId, support.makeSymbol());
  assertCondition(recovered.deltaFilled === 1, "order snapshot did not recover the cumulative fill");
  lifecycle.emitExecution({
    executionId: "e2e-recovered-execution",
    clientOrderId: order.clientOrderId,
    exchangeOrderId: order.exchangeId,
    symbol: support.makeSymbol(),
    side: "buy",
    quantity: 1,
    price: 100,
    fee: 0,
    feeCurrency: "USDC",
    timestamp: 2,
  });
  await support.flushPrivateLifecycle();
  assertCondition(
    events.some((event) => event.kind === "execution" && event.delta === 0),
    "execution did not avoid duplicating a recovered fill",
  );
  assertCondition(
    logger.entries.filter((entry) => entry.message === "order.lifecycle.listener.failed").length === 2,
    "Error and string lifecycle listener failures were not logged",
  );

  await manager.cancelOrder(order.clientOrderId, support.makeSymbol());
  const canceled = support.requireDefined(
    feed.getOrder(order.clientOrderId),
    "expected canceled recovery order",
  );
  lifecycle.emitOrder({ ...canceled, status: "open" });
  lifecycle.emitOrder(canceled);
  await support.flushPrivateLifecycle();
  assertCondition(manager.getInFlightCount() === 0, "cancel race restored a terminal order in flight");

  const retained: Order[] = [];
  const retentionIndexes = Array.from({ length: 1001 }, (_, current) => current);
  for (const index of retentionIndexes) {
    retained.push(
      await manager.placeOrder({
        signal: { side: "buy", confidence: 1, reason: "e2e-cancel-retention", stopLoss: 0, takeProfit: 0 },
        symbol: support.makeSymbol(),
        amount: 1,
        referencePrice: 100 + index,
        type: "market",
      }),
    );
  }
  for (const tracked of retained) await manager.cancelOrder(tracked.clientOrderId, tracked.symbol);
  const oldest = support.requireDefined(retained.at(0), "expected retained cancellation order");
  lifecycle.emitOrder({ ...oldest, status: "open" });
  await support.flushPrivateLifecycle();
  assertCondition(
    manager.getInFlightOrderIds().includes(oldest.clientOrderId),
    "bounded cancellation race retention did not evict the oldest terminal order",
  );
  await manager.stopLifecycle();
}

export async function runStrategyRunnerOrderFlow(): Promise<void> {
  await verifySizingAndPaperFeedFlow();
  await verifyOpenAcknowledgementAndSerializer();
  await verifyCumulativeLiveFills();
  await verifyNativeProtectionReplacement();
  await verifyExistingPositionGatesAndForceExit();
  await verifyPrivateExecutionIdempotency();
  await verifyLifecycleRecoveryAndRetention();
}
