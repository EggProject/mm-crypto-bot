import * as support from "../../../src/bot/strategy-runner.test-support.js";
import { createNativeProtectionHarness } from "../../../src/bot/strategy-runner.controller.test-support.js";
import { StrategyNativeProtectionController } from "../../../src/bot/strategy-runner-native-protection-controller.js";
import { RecordingLogger } from "@logging-testing";
import type { Logger } from "@mm-crypto-bot/logging";

import { assertCondition, quietLogger } from "./runtime-driver-core.js";

function noOperation(): void {
  return;
}

function absentLatestPrice(): number | undefined {
  return;
}

function controllerFor(
  orders: support.OrderManager,
  positions: support.PositionManager,
  logger: Logger = quietLogger,
  latestPriceFor: () => number | undefined = () => 100,
): StrategyNativeProtectionController {
  return new StrategyNativeProtectionController({
    orderManager: orders,
    positionManager: positions,
    portfolioManager: undefined,
    logger,
    findOpenPosition: (strategy, symbol) =>
      positions
        .getPositions()
        .find((position) => position.strategy === strategy && position.symbol === symbol),
    protectionKey: (strategy, symbol) => `${strategy}:${symbol}`,
    latestPriceFor,
    recordPendingRiskClose: noOperation,
    setPaperProtection: noOperation,
  });
}

class ReconciliationFaultFeed extends support.MockExchangeFeed {
  public constructor(private readonly failure: Error | string) {
    super();
  }

  public override fetchOrder(): Promise<support.Order> {
    const deferred = Promise.withResolvers<support.Order>();
    deferred.reject(this.failure);
    return deferred.promise;
  }
}

class SparseReconciliationFeed extends support.MockExchangeFeed {
  public override async fetchOrder(
    clientOrderId: support.ClientOrderId,
    symbol: support.ExchangeSymbol,
  ): Promise<support.Order> {
    const order = await super.fetchOrder(clientOrderId, symbol);
    return { ...order, average: undefined, price: undefined, updateTimestamp: undefined };
  }
}

export async function runNativeProtectionRetry(): Promise<void> {
  const feed = new support.FailFirstProtectionCancelFeed();
  await feed.open();
  const lifecycle = support.attachPrivateLifecycle(feed);
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  await orders.startLifecycle();
  const symbol = support.makeSymbol();
  positions.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
  const protection = createNativeProtectionHarness(orders, positions);
  const input = {
    strategy: "donchian_pivot_composition" as const,
    symbol,
    side: "long" as const,
    quantity: 1,
    leverage: 1,
    signal: {
      side: "buy" as const,
      confidence: 1,
      reason: "e2e-protection-retry",
      stopLoss: 90,
      takeProfit: 110,
    },
    referencePrice: 100,
  };
  await protection.install(input);
  const originalIds = orders.getInFlightOrderIds();
  assertCondition(originalIds.length === 2, "initial native protection pair was not installed");
  await protection.install(input);
  const canceled = support.requireDefined(
    originalIds
      .map((id) => support.requireDefined(feed.getOrder(id), "expected original native protection"))
      .find((order) => order.status === "canceled"),
    "expected one canceled native protection",
  );
  lifecycle.emitOrder(canceled);
  await support.flushPrivateLifecycle();
  await protection.settleTerminal(input.strategy, symbol, canceled.clientOrderId);
  assertCondition(feed.orderBook.size === 2, "failed sibling cancellation created a replacement too early");
  await protection.install(input);
  const retriedId = support.requireDefined(
    originalIds.find((id) => id !== canceled.clientOrderId),
    "expected retried native protection",
  );
  lifecycle.emitOrder(
    support.requireDefined(feed.getOrder(retriedId), "expected retried native protection payload"),
  );
  await support.flushPrivateLifecycle();
  await protection.settleTerminal(input.strategy, symbol, retriedId);
  assertCondition(
    support.copyOrders(feed.orderBook).length === 4,
    "retry did not install a replacement pair after authoritative terminal evidence",
  );
  assertCondition(
    orders.getInFlightOrderIds().length === 2,
    "only the replacement protection pair should remain active",
  );
  await orders.stopLifecycle();
  await runNativeProtectionReconciliationBoundaries();
  await runShortNativeProtectionReconciliation();
  await runSparseAndLateNativeReconciliation();
  await runSparseNativeReconciliationAtPositionPrice();
  await runNativeProtectionRetention();
}

async function runNativeProtectionReconciliationBoundaries(): Promise<void> {
  const differentSymbolFeed = new support.MockExchangeFeed();
  await differentSymbolFeed.open();
  const differentSymbolPositions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const differentSymbolOrders = new support.OrderManager({
    feed: differentSymbolFeed,
    getPositionContext: () => differentSymbolPositions.getPositionContext(),
  });
  const differentSymbolController = controllerFor(differentSymbolOrders, differentSymbolPositions);
  const symbol = support.makeSymbol();
  differentSymbolPositions.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
  await differentSymbolController.installProtections({
    strategy: "donchian_pivot_composition",
    symbol,
    side: "long",
    quantity: 1,
    leverage: 1,
    signal: { side: "buy", confidence: 1, reason: "e2e-different-symbol", stopLoss: 90, takeProfit: 110 },
    referencePrice: 100,
  });
  await differentSymbolController.reconcileNativeProtections(support.asSymbol("ETH/USDC"));
  assertCondition(
    differentSymbolController.getGroup("donchian_pivot_composition:BTC/USDC")?.active.size === 2,
    "reconciliation changed protections owned by another symbol",
  );
  const lateOrderId = support.requireDefined(
    differentSymbolOrders.getInFlightOrderIds().at(0),
    "expected an authoritative native protection for late reconciliation",
  );
  const latePosition = support.requireDefined(
    differentSymbolPositions.getPositions().at(0),
    "expected an authoritative position before venue reconciliation",
  );
  differentSymbolPositions.reconcileVenueAbsent(latePosition.id);
  differentSymbolFeed.setOrderStatus(lateOrderId, { status: "closed", filled: 1, average: 90 });
  await differentSymbolController.reconcileNativeProtections(symbol);
  assertCondition(
    differentSymbolPositions.getPositionCount() === 0,
    "late native reconciliation recreated an authoritatively absent position",
  );
  const retainedGroup = support.requireDefined(
    differentSymbolController.getGroup("donchian_pivot_composition:BTC/USDC"),
    "expected remaining native group after one terminal late leg",
  );
  const placementsBeforeAbsentPair = differentSymbolOrders.getCounters().placed;
  await differentSymbolController.createProtectionPair(retainedGroup, {
    strategy: "donchian_pivot_composition",
    symbol,
    side: "long",
    quantity: 1,
    leverage: 1,
    signal: { side: "buy", confidence: 1, reason: "e2e-absent-pair", stopLoss: 90, takeProfit: 110 },
    referencePrice: 100,
  });
  assertCondition(
    differentSymbolOrders.getCounters().placed === placementsBeforeAbsentPair,
    "native pair creation placed an order without an authoritative position",
  );

  for (const failure of [
    new Error("injected reconciliation error"),
    "injected reconciliation string",
  ] as const) {
    const feed = new ReconciliationFaultFeed(failure);
    await feed.open();
    const positions = new support.PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const orders = new support.OrderManager({
      feed,
      getPositionContext: () => positions.getPositionContext(),
    });
    const logger = new RecordingLogger();
    const controller = controllerFor(orders, positions, logger);
    positions.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
    await controller.installProtections({
      strategy: "donchian_pivot_composition",
      symbol,
      side: "long",
      quantity: 1,
      leverage: 1,
      signal: {
        side: "buy",
        confidence: 1,
        reason: "e2e-reconciliation-fault",
        stopLoss: 90,
        takeProfit: 110,
      },
      referencePrice: 100,
    });
    await controller.reconcileNativeProtections(symbol);
    assertCondition(
      controller.getGroup("donchian_pivot_composition:BTC/USDC")?.active.size === 2,
      "reconciliation fault retired a still-authoritative native protection",
    );
    assertCondition(
      logger.getCalls().some((call) => call.event === "strategy.protection.reconciliation.failed"),
      "reconciliation fault was not recorded",
    );
    const logged = logger
      .getCalls()
      .find((call) => call.event === "strategy.protection.reconciliation.failed")?.fields?.["error"];
    assertCondition(
      typeof logged === "string" &&
        logged.startsWith("[order-manager] reconcile fetchOrder failed") &&
        logged.endsWith(failure instanceof Error ? failure.message : failure),
      "normalized reconciliation error log changed its public message",
    );
  }
}

async function runShortNativeProtectionReconciliation(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const controller = controllerFor(orders, positions);
  const symbol = support.makeSymbol();
  positions.openPosition("cascade_fade", symbol, "short", 1, 100, 1);
  await controller.installProtections({
    strategy: "cascade_fade",
    symbol,
    side: "short",
    quantity: 1,
    leverage: 1,
    signal: {
      side: "sell",
      confidence: 1,
      reason: "e2e-short-reconciliation",
      stopLoss: 110,
      takeProfit: 90,
    },
    referencePrice: 100,
  });
  const id = support.requireDefined(orders.getInFlightOrderIds().at(0), "expected short native protection");
  feed.setOrderStatus(id, { status: "closed", filled: 0.5 });
  await controller.reconcileNativeProtections(symbol);
  assertCondition(
    positions.getPosition("cascade_fade", symbol, "short")?.quantity === 0.5,
    "short native reconciliation did not book the authoritative partial buy close",
  );
  assertCondition(
    support.copyOrders(feed.orderBook).some((order) => order.status === "canceled"),
    "short native reconciliation did not cancel the sibling protection",
  );
}

async function runSparseAndLateNativeReconciliation(): Promise<void> {
  const feed = new SparseReconciliationFeed();
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const controller = controllerFor(orders, positions);
  const symbol = support.makeSymbol();
  positions.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
  await controller.installProtections({
    strategy: "donchian_pivot_composition",
    symbol,
    side: "long",
    quantity: 1,
    leverage: 1,
    signal: {
      side: "buy",
      confidence: 1,
      reason: "e2e-sparse-reconciliation",
      stopLoss: 90,
      takeProfit: 110,
    },
    referencePrice: 100,
  });
  const ids = orders.getInFlightOrderIds();
  const filledId = support.requireDefined(ids.at(0), "expected sparse-filled native protection");
  const siblingId = support.requireDefined(ids.at(1), "expected sparse sibling native protection");
  const before = Date.now();
  feed.setOrderStatus(filledId, { status: "closed", filled: 1 });
  await controller.reconcileNativeProtections(symbol);
  const closed = positions.getClosedTrades().at(-1);
  assertCondition(
    positions.getPositionCount() === 0 && closed?.exitPrice === 100 && closed.closedAt >= before,
    "sparse native reconciliation did not use public latest-price and clock fallbacks",
  );
  const terminalGroup = support.requireDefined(
    controller.getGroup("donchian_pivot_composition:BTC/USDC"),
    "expected a pending native sibling group",
  );
  controller.retireProtectionLeg(terminalGroup, siblingId);
  await controller.settleProtectionGroup(terminalGroup);
  assertCondition(
    controller.getGroup("donchian_pivot_composition:BTC/USDC") === undefined,
    "terminal native protection group was not retired",
  );
  feed.setOrderStatus(siblingId, { status: "closed", filled: 1 });
  await controller.reconcileNativeProtections(symbol);
  assertCondition(
    positions.getPositionCount() === 0,
    "late cancel-fill evidence rebuilt a retired native protection position",
  );
}

async function runSparseNativeReconciliationAtPositionPrice(): Promise<void> {
  const feed = new SparseReconciliationFeed();
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const controller = controllerFor(orders, positions, quietLogger, absentLatestPrice);
  const symbol = support.makeSymbol();
  positions.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
  await controller.installProtections({
    strategy: "donchian_pivot_composition",
    symbol,
    side: "long",
    quantity: 1,
    leverage: 1,
    signal: { side: "buy", confidence: 1, reason: "e2e-position-price", stopLoss: 90, takeProfit: 110 },
    referencePrice: 100,
  });
  const filledId = support.requireDefined(orders.getInFlightOrderIds().at(0), "expected sparse protection");
  feed.setOrderStatus(filledId, { status: "closed", filled: 1 });
  await controller.reconcileNativeProtections(symbol);
  assertCondition(
    positions.getPositionCount() === 0 && positions.getClosedTrades().at(-1)?.exitPrice === 100,
    "sparse native reconciliation did not retain the authoritative position price",
  );
}

export async function runNativeProtectionRetention(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  const controller = controllerFor(orders, positions);
  const symbol = support.makeSymbol();
  positions.openPosition("donchian_pivot_composition", symbol, "long", 1, 100, 1);
  const input = {
    strategy: "donchian_pivot_composition" as const,
    symbol,
    side: "long" as const,
    quantity: 1,
    leverage: 1,
    signal: { side: "buy" as const, confidence: 1, reason: "e2e-retention", stopLoss: 90, takeProfit: 110 },
    referencePrice: 100,
  };
  await controller.installProtections(input);
  const initialGroup = controller.getGroup("donchian_pivot_composition:BTC/USDC");
  if (initialGroup === undefined) throw new Error("expected installed native protection group");
  for (const id of initialGroup.active) controller.retireProtectionLeg(initialGroup, id);
  await controller.installProtections(input);
  assertCondition(
    controller.getGroup("donchian_pivot_composition:BTC/USDC")?.active.size === 2,
    "retired empty group did not settle a replacement pair",
  );

  let firstRetiredId: ReturnType<typeof orders.getInFlightOrderIds>[number] | undefined;
  let latestRetiredId: ReturnType<typeof orders.getInFlightOrderIds>[number] | undefined;
  const retentionCycles = Array.from({ length: 501 });
  for (const cycle of retentionCycles.keys()) {
    const group = controller.getGroup("donchian_pivot_composition:BTC/USDC");
    if (group === undefined) throw new Error("expected native protection group for retention cycle");
    const ids = [...group.active];
    const first = ids.at(0);
    const last = ids.at(-1);
    if (first === undefined || last === undefined) throw new Error("expected native protection pair");
    firstRetiredId ??= first;
    latestRetiredId = last;
    controller.retireProtectionLeg(group, first);
    controller.retireProtectionLeg(group, last);
    await controller.settleProtectionGroup(group);
    if (cycle < 500) await controller.installProtections(input);
  }
  if (firstRetiredId === undefined || latestRetiredId === undefined) throw new Error("expected retired ids");
  assertCondition(
    controller.getNativeProtection(firstRetiredId) === undefined,
    "bounded superseded metadata did not evict the oldest protection",
  );
  assertCondition(
    controller.getNativeProtection(latestRetiredId) !== undefined,
    "bounded superseded metadata evicted the newest protection",
  );
}
