import * as support from "../../../src/bot/strategy-runner.test-support.js";
import { makeClientOrderId } from "@mm-crypto-bot/exchange";
import type { Execution, FeedEvent, FeedListener, Order } from "@mm-crypto-bot/exchange";
import { RecordingLogger } from "@logging-testing";
import type { OrderIntent } from "../../../src/bot/order-manager.js";
import { OrderLifecycleController } from "../../../src/bot/order-manager-lifecycle.js";
import {
  assertCondition,
  expectAsyncFailure as rejects,
  expectFailure,
  NoPositionsFeed,
} from "./runtime-driver-core.js";
const buySignal = { side: "buy" as const, confidence: 1, reason: "e", stopLoss: 0, takeProfit: 0 };
const passiveCounters = { placed: 0, filled: 0, cancelled: 0, rejected: 0 };
const executionDefaults = { quantity: 1, price: 100, fee: 0, feeCurrency: "USDC" as const, timestamp: 1 };
function stringFailure(message: string): Promise<never> {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- E2E verifies public normalization of string exchange failures.
  return Promise.reject(message);
}
class OpenOrdersFailureFeed extends support.MockExchangeFeed {
  private attempts = 0;
  public override async fetchOpenOrders(): Promise<readonly []> {
    await Promise.resolve();
    if (this.attempts++ === 0) throw new Error("open-order query denied");
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E verifies public normalization of string exchange failures.
    throw "open-order string denied";
  }
}
class AuthoritativeFailureFeed extends support.MockExchangeFeed {
  private tickerAttempts = 0;
  private rejectPlacement = false;
  public rejectNextPlacement(): void {
    this.rejectPlacement = true;
  }
  public override placeOrder(request: Parameters<support.MockExchangeFeed["placeOrder"]>[0]): Promise<Order> {
    const failure = this.rejectPlacement ? new Error("capacity release failure") : undefined;
    this.rejectPlacement = false;
    return failure === undefined ? super.placeOrder(request) : Promise.reject(failure);
  }
  public override async cancelOrder(): Promise<never> {
    await Promise.resolve();
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E verifies public normalization of string exchange failures.
    throw "cancel snapshot denied";
  }
  public override fetchPositions() {
    return stringFailure("position snapshot denied");
  }
  public override fetchBalances() {
    return Promise.reject(new Error("balance snapshot denied"));
  }
  public override fetchMarketMeta() {
    return stringFailure("market metadata denied");
  }
  public override fetchTickerSnapshot(): Promise<never> {
    return this.tickerAttempts++ === 0
      ? Promise.reject(new Error("ticker snapshot denied"))
      : stringFailure("ticker snapshot string denied");
  }
}
type ManagerOptions = ConstructorParameters<typeof support.OrderManager>[0];
type OpenManagerOptions = Omit<ManagerOptions, "getPositionContext"> &
  Partial<Pick<ManagerOptions, "getPositionContext">>;
const defaultPositionContext = () => ({ equityUsd: 10_000, positions: [] });
async function openManager(options: OpenManagerOptions) {
  await options.feed.open();
  return new support.OrderManager({ getPositionContext: defaultPositionContext, ...options });
}
function marketOrderIntent(s: ReturnType<typeof support.makeSymbol>, o: Partial<OrderIntent> = {}) {
  return { signal: buySignal, symbol: s, amount: 1, referencePrice: 100, type: "market" as const, ...o };
}
function execution(order: Order, executionId: string, overrides: Partial<Execution> = {}): Execution {
  return { ...order, executionId, exchangeOrderId: order.exchangeId, ...executionDefaults, ...overrides };
}
async function verifyKnownOrderCapacity(symbol: ReturnType<typeof support.makeSymbol>): Promise<void> {
  const feed = new support.MockExchangeFeed();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const manager = await openManager({ feed });
  const ids: string[] = [];
  manager.onLifecycle((event) => {
    if (event.kind === "execution") ids.push(event.execution.executionId);
  });
  await manager.startLifecycle();
  const active = await manager.placeOrder(
    marketOrderIntent(symbol, { clientOrderIdHint: "e2e-retained-active" }),
  );
  const cancelRace = await manager.placeOrder(
    marketOrderIntent(symbol, { clientOrderIdHint: "e2e-retained-cancel-race" }),
  );
  await manager.cancelOrder(cancelRace.clientOrderId, symbol);
  for (let index = 0; index < 4999; index++) {
    const order = await manager.placeOrder(
      marketOrderIntent(symbol, { clientOrderIdHint: `e2e-known-order-${String(index)}` }),
    );
    lifecycle.emitOrder({ ...order, status: "closed", filled: 1, average: 100 });
  }
  lifecycle.emitExecution(execution(active, "e2e-active-retention-proof"));
  lifecycle.emitExecution(execution(cancelRace, "e2e-cancel-race-retention-proof"));
  await support.flushPrivateLifecycle();
  assertCondition(
    ids.includes("e2e-active-retention-proof") && ids.includes("e2e-cancel-race-retention-proof"),
    "known-order eviction did not retain active and cancel-race bookkeeping",
  );
  await manager.stopLifecycle();
  const cleanupFeed = new support.MockExchangeFeed();
  const cleanupLifecycle = support.attachPrivateLifecycle(cleanupFeed);
  const cleanupManager = await openManager({ feed: cleanupFeed });
  const cleanupEvents: string[] = [];
  cleanupManager.onLifecycle((event) => {
    if (event.kind === "execution") cleanupEvents.push(event.execution.executionId);
  });
  await cleanupManager.startLifecycle();
  const historical = await cleanupManager.placeOrder(
    marketOrderIntent(symbol, { clientOrderIdHint: "e2e-retired-execution-proof" }),
  );
  cleanupLifecycle.emitExecution(execution(historical, "e2e-retired-execution-proof"));
  for (let index = 0; index < 5000; index++) {
    const order = await cleanupManager.placeOrder(
      marketOrderIntent(symbol, { clientOrderIdHint: `e2e-cleanup-history-${String(index)}` }),
    );
    await cleanupManager.cancelOrder(order.clientOrderId, symbol);
  }
  cleanupFeed.setOrderStatus(historical.clientOrderId, { status: "closed", filled: 1, average: 100 });
  const r = await cleanupManager.reconcileOrder(historical.clientOrderId, symbol);
  assertCondition(r.order.status === "closed" && r.deltaFilled === 1, "evicted reconciliation");
  const reusedId = await cleanupManager.placeOrder(
    marketOrderIntent(symbol, { clientOrderIdHint: "e2e-reused-execution-proof" }),
  );
  cleanupLifecycle.emitExecution(execution(reusedId, "e2e-retired-execution-proof"));
  await support.flushPrivateLifecycle();
  assertCondition(
    cleanupEvents.filter((executionId) => executionId === "e2e-retired-execution-proof").length === 2,
    "historical eviction did not retire its execution-id proof",
  );
  await cleanupManager.stopLifecycle();
}
async function verifyExecutionDedupCapacity(symbol: ReturnType<typeof support.makeSymbol>): Promise<void> {
  const feed = new support.MockExchangeFeed();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const manager = await openManager({
    feed,
    getPositionContext: () => ({ equityUsd: 100_000, positions: [] }),
  });
  const order = await manager.placeOrder(marketOrderIntent(symbol, { amount: 5001 }));
  let executionEvents = 0;
  manager.onLifecycle((event) => {
    if (event.kind === "execution") executionEvents++;
  });
  await manager.startLifecycle();
  for (let index = 0; index < 5000; index++) {
    lifecycle.emitExecution(execution(order, `e2e-dedup-capacity-${String(index)}`, { timestamp: index }));
  }
  lifecycle.emitExecution(execution(order, "e2e-dedup-capacity-0"));
  let overflow: unknown;
  try {
    lifecycle.emitExecution(execution(order, "e2e-dedup-overflow", { timestamp: 5000 }));
  } catch (error) {
    overflow = error;
  }
  assertCondition(
    overflow instanceof Error &&
      executionEvents === 5000 &&
      overflow.message === "[order-manager] execution deduplication capacity exhausted",
    "execution deduplication did not suppress retained duplicates and fail closed at capacity",
  );
  await manager.stopLifecycle();
}
async function verifyActivePlacementCapacity(symbol: ReturnType<typeof support.makeSymbol>): Promise<void> {
  const feed = new AuthoritativeFailureFeed();
  const manager = await openManager({ feed });
  for (let index = 0; index < 4999; index++)
    await manager.placeOrder(marketOrderIntent(symbol, { clientOrderIdHint: `e2e-active-${String(index)}` }));
  feed.rejectNextPlacement();
  await rejects(() => manager.placeOrder(marketOrderIntent(symbol)), "capacity release");
  await manager.placeOrder(marketOrderIntent(symbol, { clientOrderIdHint: "e2e-active-5000" }));
  await rejects(() => manager.placeOrder(marketOrderIntent(symbol)), "active capacity");
  const openOrders = await manager.getOpenOrders(symbol);
  const direct = new OrderLifecycleController(feed, new RecordingLogger(), passiveCounters);
  for (const order of openOrders) direct.trackPlaced(order);
  const id = makeClientOrderId("e2e-direct-track-overflow");
  const o = await feed.placeOrder({ clientOrderId: id, symbol, side: "buy", type: "market", amount: 1 });
  expectFailure(direct.trackPlaced.bind(direct, o), "direct active capacity");
  const hasReachedCapacity =
    manager.getInFlightCount() === 5000 && openOrders.length === 5000 && direct.getInFlightCount() === 5000;
  assertCondition(hasReachedCapacity, "active capacity reached the feed");
}
export async function runOrderManagerBoundaries(): Promise<void> {
  const symbol = support.makeSymbol();
  const feed = new support.MockExchangeFeed();
  const manager = await openManager({ feed });
  const order = await manager.placeOrder(marketOrderIntent(symbol));
  assertCondition(order.status === "open", "new live order was not acknowledged open");
  assertCondition(order.clientOrderId.length > 0, "new order has no stable client order id");
  const openOrders = await manager.getOpenOrders(symbol);
  assertCondition(openOrders.length === 1, "open-order boundary lost the acknowledged order");
  const canceled = await manager.cancelOrder(order.clientOrderId, symbol);
  assertCondition(canceled.status === "canceled", "cancel boundary did not return terminal status");
  assertCondition(manager.getInFlightCount() === 0, "canceled order remained in flight");
  await rejects(() => manager.placeOrder(marketOrderIntent(symbol, { amount: 0 })), "zero amount");
  await rejects(() => manager.placeOrder(marketOrderIntent(symbol, { referencePrice: 0 })), "zero price");
  await rejects(
    () => manager.placeOrder({ signal: buySignal, symbol, amount: 1, referencePrice: 100, type: "limit" }),
    "limit without price",
  );
  const limitOrder = await manager.placeOrder(marketOrderIntent(symbol, { type: "limit", limitPrice: 99 }));
  assertCondition(limitOrder.price === 99, "valid limit order did not retain its limit price");
  await rejects(
    () => manager.placeOrder(marketOrderIntent(symbol, { protectiveKind: "stop_loss", triggerPrice: 0 })),
    "protective order without trigger price",
  );
  await rejects(
    () => manager.placeOrder(marketOrderIntent(symbol, { protectiveKind: "stop_loss" })),
    "protective order with missing trigger price",
  );
  await rejects(
    () => manager.placeOrder(marketOrderIntent(symbol, { protectiveKind: "stop_loss", triggerPrice: NaN })),
    "protective order with non-finite trigger price",
  );
  await rejects(
    () => manager.placeOrder(marketOrderIntent(symbol, { leverage: 11 })),
    "leverage above configured maximum",
  );
  const capFeed = new support.MockExchangeFeed();
  const capManager = await openManager({
    feed: capFeed,
    getPositionContext: () => ({
      equityUsd: 10_000,
      positions: [{ symbol, source: "e2e", effectiveNotionalUsd: 99_999 }],
    }),
  });
  await rejects(() => capManager.placeOrder(marketOrderIntent(symbol)), "aggregate leverage breach");
  assertCondition(capManager.getCounters().rejected === 1, "leverage rejection was not counted");
  const reduceFeed = new support.MockExchangeFeed();
  const reduceManager = await openManager({
    feed: reduceFeed,
    getPositionContext: () => ({
      equityUsd: 10_000,
      positions: [{ symbol, source: "e2e", effectiveNotionalUsd: 100_000 }],
    }),
    getReduciblePosition: () => ({ side: "long", quantity: 1 }),
  });
  const reduceOrder = await reduceManager.placeOrder(
    marketOrderIntent(symbol, {
      signal: { ...buySignal, side: "sell", reason: "e2e-reduce" },
      referencePrice: 100_000,
      reduceOnly: true,
    }),
  );
  assertCondition(
    reduceOrder.status === "open",
    "matching reduce-only order was rejected at the exposure cap",
  );
  await rejects(
    () => reduceManager.placeOrder(marketOrderIntent(symbol, { referencePrice: 100_000, reduceOnly: true })),
    "side-mismatched reduce-only order",
  );
  const unavailableOpenOrdersFeed = new OpenOrdersFailureFeed();
  const unavailableOpenOrdersManager = await openManager({ feed: unavailableOpenOrdersFeed });
  await rejects(() => unavailableOpenOrdersManager.getOpenOrders(symbol), "unavailable open-order query");
  await rejects(() => unavailableOpenOrdersManager.getOpenOrders(symbol), "string open-order query");
  const paperFeed = new support.MockExchangeFeed();
  const paperManager = await openManager({ feed: paperFeed, paperMode: true });
  const paperPositions = await paperManager.getAuthoritativePositions([symbol]);
  assertCondition(paperPositions.length === 0, "paper order manager queried authoritative positions");
  const paperOrder = await paperManager.placeOrder(marketOrderIntent(symbol));
  const exchangeOrderId = support.requireDefined(paperOrder.exchangeId, "paper order id");
  const cancelledPaperOrders = await paperManager.cancelTrackedOrders();
  assertCondition(cancelledPaperOrders.length === 0, "terminal paper order was cancelled redundantly");
  assertCondition(paperManager.getInFlightCount() === 0, "terminal paper order remained active");
  let orderListener: FeedListener | undefined;
  let executionListener: FeedListener | undefined;
  Object.assign(feed, {
    subscribeOrderUpdates: (listener: FeedListener) => {
      orderListener = listener;
      return Promise.resolve(9001);
    },
    subscribeExecutions: (listener: FeedListener) => {
      executionListener = listener;
      return Promise.resolve(9002);
    },
  });
  const lifecycle = {
    emitOrder: (updated: Order) => orderListener?.({ kind: "order", payload: updated }),
    emitExecution: (execution: Execution) => executionListener?.({ kind: "execution", payload: execution }),
  };
  const lifecycleEvents: Execution[] = [];
  const states = new Map<string, readonly [number, number | undefined, number]>();
  const orderEvents: { readonly clientOrderId: string; readonly deltaFilled: number }[] = [];
  manager.onLifecycle((event) => {
    if (event.kind === "execution") {
      lifecycleEvents.push(event.execution);
      states.set(event.execution.executionId, [event.order.filled, event.order.average, event.deltaFilled]);
    } else orderEvents.push({ clientOrderId: event.order.clientOrderId, deltaFilled: event.deltaFilled });
  });
  await manager.startLifecycle();
  await manager.startLifecycle();
  const market = { symbol, timestamp: 1 };
  const marketEvents: readonly FeedEvent[] = [
    { kind: "ticker", payload: { ...market, bid: 99, ask: 101, last: 100, baseVolume: 1, quoteVolume: 100 } },
    {
      kind: "orderbook",
      payload: {
        ...market,
        nonce: 1,
        bids: [{ price: 99, amount: 1 }],
        asks: [{ price: 101, amount: 1 }],
      },
    },
    {
      kind: "trade",
      payload: { ...market, id: "e2e-market-feed-trade", price: 100, amount: 1, takerSide: "buy" },
    },
    { kind: "ohlcv", payload: { symbol, timeframe: "1m", candle: [1, 100, 101, 99, 100, 1] } },
  ];
  for (const marketEvent of marketEvents) executionListener?.(marketEvent);
  await support.flushPrivateLifecycle();
  assertCondition(
    lifecycleEvents.length === 0,
    "market feed event was not an observable order-lifecycle no-op",
  );
  assertCondition(
    manager.getInFlightOrderIds().includes(limitOrder.clientOrderId),
    "market feed event changed tracked order state",
  );
  lifecycle.emitExecution(
    execution(paperOrder, "e2e-unknown-exchange-order", {
      clientOrderId: undefined,
      exchangeOrderId,
      price: 99,
    }),
  );
  await support.flushPrivateLifecycle();
  assertCondition(
    lifecycleEvents.every((event) => event.executionId !== "e2e-unknown-exchange-order"),
    "execution with an unknown exchange order id was not ignored",
  );
  lifecycle.emitExecution(
    execution(paperOrder, "e2e-missing-order-identifiers", {
      clientOrderId: undefined,
      exchangeOrderId: undefined,
      price: 99,
    }),
  );
  await support.flushPrivateLifecycle();
  assertCondition(
    lifecycleEvents.every((event) => event.executionId !== "e2e-missing-order-identifiers"),
    "execution without both order identifiers was not ignored",
  );
  manager.recordFill(limitOrder.clientOrderId, {
    ...limitOrder,
    exchangeId: exchangeOrderId,
    filled: 0.4,
    average: 99,
  });
  lifecycle.emitExecution(
    execution(limitOrder, "e2e-exchange-id-resolution", {
      clientOrderId: undefined,
      exchangeOrderId,
      quantity: 0.2,
      price: 99,
    }),
  );
  await support.flushPrivateLifecycle();
  const resolvedExecution = lifecycleEvents.at(0);
  assertCondition(
    resolvedExecution?.executionId === "e2e-exchange-id-resolution",
    "known exchange order id did not resolve an execution without a client id",
  );
  lifecycle.emitExecution(
    execution(limitOrder, "e2e-client-id-resolution", {
      exchangeOrderId: undefined,
      quantity: 0.8,
      price: 100,
      timestamp: 2,
    }),
  );
  await support.flushPrivateLifecycle();
  const recoveredExecution = states.get("e2e-client-id-resolution");
  assertCondition(
    recoveredExecution?.[0] === 1 && recoveredExecution[1] === 99.6 && recoveredExecution[2] === 0.6,
    "execution replay after snapshot recovery did not preserve tracked weighted fill state",
  );
  const lifecycleOrder = await manager.placeOrder(
    marketOrderIntent(symbol, { clientOrderIdHint: "e2e-order-snapshot" }),
  );
  lifecycle.emitOrder({ ...lifecycleOrder, filled: 0.4, average: 99, updateTimestamp: 3 });
  lifecycle.emitOrder({
    ...lifecycleOrder,
    filled: 1,
    average: 100,
    status: "closed",
    updateTimestamp: 4,
  });
  await support.flushPrivateLifecycle();
  assertCondition(
    orderEvents.some(
      (event) => event.clientOrderId === lifecycleOrder.clientOrderId && event.deltaFilled === 0.4,
    ),
    "partial order snapshot did not report its newly filled quantity",
  );
  const cancelRaceOrder = await manager.placeOrder(
    marketOrderIntent(symbol, { clientOrderIdHint: "e2e-cancel-race" }),
  );
  await manager.cancelOrder(cancelRaceOrder.clientOrderId, symbol);
  lifecycle.emitOrder({ ...cancelRaceOrder, updateTimestamp: 5 });
  lifecycle.emitOrder({ ...cancelRaceOrder, status: "canceled", updateTimestamp: 6 });
  lifecycle.emitOrder({ ...cancelRaceOrder, updateTimestamp: 7 });
  const foreignFeed = new support.MockExchangeFeed();
  const foreignManager = await openManager({ feed: foreignFeed });
  const foreignOrder = await foreignManager.placeOrder(
    marketOrderIntent(symbol, { clientOrderIdHint: "e2e-foreign-order" }),
  );
  lifecycle.emitOrder(foreignOrder);
  lifecycle.emitExecution(
    execution(foreignOrder, "e2e-untracked-client-order", { exchangeOrderId: undefined, timestamp: 7 }),
  );
  await support.flushPrivateLifecycle();
  assertCondition(
    lifecycleEvents.every((event) => event.executionId !== "e2e-untracked-client-order") &&
      orderEvents.every((event) => event.clientOrderId !== foreignOrder.clientOrderId) &&
      !manager.getInFlightOrderIds().includes(foreignOrder.clientOrderId),
    "foreign lifecycle",
  );
  const inFlightBeforeForeignFill = manager.getInFlightCount();
  manager.recordFill(foreignOrder.clientOrderId, {
    ...foreignOrder,
    status: "closed",
    filled: 1,
    average: 100,
  });
  assertCondition(manager.getInFlightCount() === inFlightBeforeForeignFill, "foreign fill tracking");
  await manager.stopLifecycle();
  const reconciledFeed = new support.MockExchangeFeed();
  const reconciledManager = await openManager({ feed: reconciledFeed });
  const reconciledClosed = await reconciledManager.placeOrder(
    marketOrderIntent(symbol, { clientOrderIdHint: "e2e-reconcile-closed" }),
  );
  reconciledFeed.setOrderStatus(reconciledClosed.clientOrderId, {
    status: "closed",
    filled: 1,
    average: 100,
  });
  const closedReconciliation = await reconciledManager.reconcileOrder(reconciledClosed.clientOrderId, symbol);
  assertCondition(
    closedReconciliation.order.status === "closed" && closedReconciliation.deltaFilled === 1,
    "closed reconciliation did not retain its exact fill delta",
  );
  const reconciledCanceled = await reconciledManager.placeOrder(
    marketOrderIntent(symbol, { clientOrderIdHint: "e2e-reconcile-canceled" }),
  );
  reconciledFeed.setOrderStatus(reconciledCanceled.clientOrderId, { status: "canceled" });
  const canceledReconciliation = await reconciledManager.reconcileOrder(
    reconciledCanceled.clientOrderId,
    symbol,
  );
  assertCondition(
    canceledReconciliation.order.status === "canceled",
    "canceled reconciliation did not retain terminal state",
  );
  assertCondition(
    reconciledManager.getCounters().filled === 1 && reconciledManager.getCounters().cancelled === 1,
    "reconciliation counters did not record both terminal outcomes",
  );
  await verifyKnownOrderCapacity(symbol);
  await verifyExecutionDedupCapacity(symbol);
  await verifyActivePlacementCapacity(symbol);
  const noPositionsFeed = new NoPositionsFeed();
  await noPositionsFeed.open();
  const noPositionsManager = new support.OrderManager({
    feed: noPositionsFeed,
    getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
  });
  await rejects(
    () => noPositionsManager.getAuthoritativePositions([symbol]),
    "absent authoritative position endpoint",
  );
  const failureFeed = new AuthoritativeFailureFeed();
  await failureFeed.open();
  const failureManager = new support.OrderManager({
    feed: failureFeed,
    getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
  });
  for (const [label, action] of [
    ["authoritative position endpoint failure", () => failureManager.getAuthoritativePositions([symbol])],
    ["authoritative balance endpoint failure", () => failureManager.getAuthoritativeBalances()],
    ["market metadata endpoint failure", () => failureManager.getMarketMeta(symbol)],
    ["ticker snapshot endpoint failure", () => failureManager.getTickerSnapshot(symbol)],
    ["ticker snapshot string endpoint failure", () => failureManager.getTickerSnapshot(symbol)],
  ] as const) {
    await rejects(action, label);
  }
  const failedCancellationOrder = await failureManager.placeOrder(marketOrderIntent(symbol));
  const cancellationResults = await failureManager.cancelTrackedOrders();
  assertCondition(
    cancellationResults[0]?.error ===
      `OrderManagerError: [order-manager] cancelOrder failed for ${failedCancellationOrder.clientOrderId} on ${symbol}: cancel snapshot denied`,
    "tracked cancellation failure did not retain its canonical Error diagnostic",
  );
}
