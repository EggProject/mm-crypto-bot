import { RecordingLogger } from "@logging-testing";

import type { OrderLifecycleEvent } from "../../../src/bot/order-manager.js";
import { StrategyPluginRiskController } from "../../../src/bot/strategy-runner-plugin-risk-controller.js";
import * as support from "../../../src/bot/strategy-runner.test-support.js";

import { assertCondition } from "./runtime-driver-core.js";
import { makePortfolioStack } from "./runtime-driver-portfolio-fixtures.js";

type RunnerInstances = ConstructorParameters<typeof support.StrategyRunner>[0]["instances"];

interface DirectControllerStack {
  readonly controller: StrategyPluginRiskController;
  readonly feed: support.MockExchangeFeed;
  readonly logger: RecordingLogger;
  readonly orders: support.OrderManager;
  readonly pauses: () => number;
  readonly positions: support.PositionManager;
  readonly strategyClosures: readonly string[];
}

class DeferredTrailingCloseFeed extends support.MockExchangeFeed {
  private readonly releasePlacement = Promise.withResolvers<undefined>();

  public release(): void {
    this.releasePlacement.resolve();
  }

  public override async placeOrder(
    ...arguments_: Parameters<support.MockExchangeFeed["placeOrder"]>
  ): Promise<support.Order> {
    const [request] = arguments_;
    if (request.reduceOnly) await this.releasePlacement.promise;
    return super.placeOrder(...arguments_);
  }
}

class ReconciliationFailureFeed extends support.MockExchangeFeed {
  public override fetchOrder(
    ..._arguments: Parameters<support.MockExchangeFeed["fetchOrder"]>
  ): Promise<never> {
    return Promise.reject(new Error("e2e reconciliation transport failure"));
  }
}

async function createDirectControllerStack(
  options: {
    readonly feed?: support.MockExchangeFeed;
    readonly instances?: RunnerInstances;
    readonly riskManager?: support.RiskManager;
    readonly onEmergency?: (reason: string) => undefined | Promise<undefined>;
  } = {},
): Promise<DirectControllerStack> {
  const feed = options.feed ?? new support.MockExchangeFeed();
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
  const logger = new RecordingLogger();
  const strategyClosures: string[] = [];
  let pauseCount = 0;
  const controller = new StrategyPluginRiskController({
    instances: options.instances ?? support.strategyInstances([]),
    orderManager: orders,
    positionManager: positions,
    enabledSymbols: new Set([support.makeSymbol()]),
    logger,
    isOrderEmissionBlocked: () => false,
    pause: () => {
      pauseCount += 1;
    },
    getRiskManager: () => options.riskManager,
    getPortfolioManager: () => {
      return;
    },
    getOnEmergency: () => options.onEmergency,
    latestPriceFor: () => 103,
    notifyStrategyClosed: (strategy) => {
      strategyClosures.push(strategy);
    },
  });
  return {
    controller,
    feed,
    logger,
    orders,
    pauses: () => pauseCount,
    positions,
    strategyClosures,
  };
}

async function disposeDirectControllerStack(stack: DirectControllerStack): Promise<void> {
  stack.controller.dispose();
  await stack.feed.close();
}

async function requestTrackedTrailingClose(
  stack: DirectControllerStack,
  strategy: string,
): Promise<{ readonly clientOrderId: support.ClientOrderId; readonly positionId: string }> {
  const position = stack.positions.openPosition(strategy, support.makeSymbol(), "long", 1, 100, 1);
  await stack.controller.requestTrailingStopClose(position.id, 90, "trailing_stop");
  return {
    clientOrderId: support.requireDefined(
      stack.orders.getInFlightOrderIds().at(0),
      "expected a tracked trailing-close order",
    ),
    positionId: position.id,
  };
}

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

async function createDirectTrailingStack(feed: support.MockExchangeFeed): Promise<{
  readonly riskManager: support.RiskManager;
  readonly positions: support.PositionManager;
  readonly orders: support.OrderManager;
  readonly runner: support.StrategyRunner;
}> {
  await feed.open();
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
    riskManager,
    sizingFn: () => 0,
    enabledSymbols: ["BTC/USDC"],
  });
  return { riskManager, positions, orders, runner };
}

function triggerLongTrailingClose(riskManager: support.RiskManager, positionId: string): void {
  riskManager.onTick({ positionId, side: "long", currentPrice: 105, atr: 1 });
  riskManager.onTick({ positionId, side: "long", currentPrice: 103, atr: 1 });
}

async function tick(runner: support.StrategyRunner, timestamp: number): Promise<void> {
  await runner.onFeedEvent({
    kind: "ticker",
    payload: {
      symbol: support.makeSymbol(),
      timestamp,
      bid: 102,
      ask: 104,
      last: 103,
      baseVolume: 1,
      quoteVolume: 103,
    },
  });
}

async function verifyDirectTrailingReconciliation(): Promise<void> {
  const feed = new support.MockExchangeFeed();
  const stack = await createDirectTrailingStack(feed);
  try {
    const position = stack.positions.openPosition("direct", support.makeSymbol(), "long", 1, 100, 1);
    triggerLongTrailingClose(stack.riskManager, position.id);
    await support.flushPrivateLifecycle();
    const closeId = support.requireDefined(
      stack.orders.getInFlightOrderIds().at(0),
      "expected direct trailing close",
    );
    await tick(stack.runner, 1);
    assertCondition(stack.positions.getPositionCount() === 1, "open trailing close changed exposure");
    feed.setOrderStatus(closeId, { status: "closed", filled: 1, average: 103 });
    await tick(stack.runner, 2);
    assertCondition(
      stack.positions.getPositionCount() === 0,
      "reconciled trailing close did not flatten exposure",
    );
    assertCondition(
      stack.riskManager.getSnapshot().trailingStops.length === 0,
      "reconciled trailing close remained armed",
    );
  } finally {
    stack.runner.dispose();
    await feed.close();
  }
}

async function verifyBlockedAndRetryableDirectCloses(): Promise<void> {
  const blockedFeed = new support.MockExchangeFeed();
  const blocked = await createDirectTrailingStack(blockedFeed);
  try {
    const position = blocked.positions.openPosition("blocked", support.makeSymbol(), "long", 1, 100, 1);
    blocked.runner.pause();
    triggerLongTrailingClose(blocked.riskManager, position.id);
    await support.flushPrivateLifecycle();
    assertCondition(blocked.orders.getCounters().placed === 0, "paused runner emitted a trailing close");
  } finally {
    blocked.runner.dispose();
    await blockedFeed.close();
  }

  for (const outcome of ["canceled", "partial", "throw"] as const) {
    const feed = new support.TrailingCloseOutcomeFeed(outcome);
    const stack = await createDirectTrailingStack(feed);
    try {
      const position = stack.positions.openPosition(outcome, support.makeSymbol(), "long", 1, 100, 1);
      triggerLongTrailingClose(stack.riskManager, position.id);
      await support.flushPrivateLifecycle();
      const expectedQuantity = outcome === "partial" ? 0.5 : 1;
      assertCondition(
        stack.positions.getPosition(outcome, support.makeSymbol(), "long")?.quantity === expectedQuantity,
        `${outcome} trailing close changed exposure incorrectly`,
      );
      stack.riskManager.onTick({ positionId: position.id, side: "long", currentPrice: 110, atr: 1 });
      stack.riskManager.onTick({ positionId: position.id, side: "long", currentPrice: 107, atr: 1 });
      await support.flushPrivateLifecycle();
      const expectedPlacements = outcome === "throw" ? 0 : 2;
      assertCondition(
        stack.orders.getCounters().placed === expectedPlacements,
        `${outcome} trailing close was not retryable`,
      );
    } finally {
      stack.runner.dispose();
      await feed.close();
    }
  }
}

async function verifyPortfolioTrailingClose(): Promise<void> {
  const portfolio = await makePortfolioStack({ paperMode: true });
  const riskManager = createRiskManager();
  portfolio.positionManager.setRiskManager(riskManager);
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([]),
    orderManager: portfolio.orderManager,
    positionManager: portfolio.positionManager,
    portfolioManager: portfolio.portfolioManager,
    riskManager,
    sizingFn: () => 0,
    enabledSymbols: ["BTC/USDC"],
  });
  try {
    const position = portfolio.positionManager.openPosition(
      "portfolio",
      support.makeSymbol(),
      "long",
      1,
      100,
      1,
    );
    triggerLongTrailingClose(riskManager, position.id);
    await Promise.resolve();
    await Promise.resolve();
    assertCondition(
      portfolio.positionManager.getPositionCount() === 0,
      "portfolio trailing close did not use the portfolio close lifecycle",
    );
    assertCondition(
      riskManager.getSnapshot().trailingStops.length === 0,
      "portfolio trailing close remained armed after settlement",
    );
  } finally {
    runner.dispose();
    await portfolio.feed.close();
  }
}

async function verifyConcurrentEmergencySingleFlight(): Promise<void> {
  const emergency = Promise.withResolvers<undefined>();
  let emergencyCalls = 0;
  const getEmergencyCalls = (): number => emergencyCalls;
  const stack = await createDirectControllerStack({
    instances: support.strategyInstances([
      [
        "regime_detector",
        {
          kind: "plugin",
          name: "regime_detector",
          instance: new support.RiskActionPlugin("portfolio-risk"),
        },
      ],
    ]),
    onEmergency: () => {
      emergencyCalls += 1;
      return emergency.promise;
    },
  });
  try {
    stack.controller.start();
    const bar = { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 };
    await stack.controller.processPlugins(support.makeSymbol(), "15m", bar);
    await stack.controller.processPlugins(support.makeSymbol(), "15m", bar);
    assertCondition(stack.pauses() === 1, "concurrent plugin breaches paused more than once");
    assertCondition(
      getEmergencyCalls() === 1,
      "concurrent plugin breaches started more than one emergency close",
    );
    emergency.resolve();
    await Promise.resolve();
    await stack.controller.processPlugins(support.makeSymbol(), "15m", bar);
    assertCondition(getEmergencyCalls() === 2, "settled emergency close did not admit a later breach");
  } finally {
    await disposeDirectControllerStack(stack);
  }
}

async function verifyPendingAndMissingTrailingCloseReconciliation(): Promise<void> {
  const delayedFeed = new DeferredTrailingCloseFeed();
  const delayed = await createDirectControllerStack({ feed: delayedFeed });
  try {
    await delayed.controller.requestTrailingStopClose("missing-position", 90, "trailing_stop");
    assertCondition(delayed.orders.getCounters().placed === 0, "missing position emitted a trailing close");
    const position = delayed.positions.openPosition("delayed", support.makeSymbol(), "long", 1, 100, 1);
    const closeRequest = delayed.controller.requestTrailingStopClose(position.id, 90, "trailing_stop");
    await Promise.resolve();
    await delayed.controller.reconcileRiskCloses(support.makeSymbol());
    assertCondition(
      delayed.orders.getCounters().placed === 0,
      "unacknowledged close was reconciled before its ACK",
    );
    delayedFeed.release();
    await closeRequest;
    assertCondition(delayed.orders.getCounters().placed === 1, "released trailing close was not placed");
  } finally {
    await disposeDirectControllerStack(delayed);
  }

  const riskManager = createRiskManager();
  const missing = await createDirectControllerStack({ riskManager });
  try {
    const tracked = await requestTrackedTrailingClose(missing, "disappeared");
    riskManager.armTrailingStop(tracked.positionId, "long", 100, 1);
    assertCondition(
      riskManager.getSnapshot().trailingStops.length === 1,
      "missing-position test did not arm a trail",
    );
    missing.positions.recordFill({
      strategy: "disappeared",
      symbol: support.makeSymbol(),
      side: "short",
      quantity: 1,
      price: 99,
      leverage: 1,
      timestamp: 1,
    });
    await missing.controller.reconcileRiskCloses(support.makeSymbol());
    assertCondition(
      missing.positions.getPositionCount() === 0,
      "external fill did not remove the tracked position",
    );
    assertCondition(
      riskManager.getSnapshot().trailingStops.length === 0,
      "missing position left its trailing state armed",
    );
  } finally {
    await disposeDirectControllerStack(missing);
  }
}

async function verifyTerminalAndForeignTrailingLifecycle(): Promise<void> {
  const terminal = await createDirectControllerStack();
  try {
    const reconciled = await requestTrackedTrailingClose(terminal, "reconciled-terminal");
    terminal.feed.setOrderStatus(reconciled.clientOrderId, { status: "canceled" });
    await terminal.controller.reconcileRiskCloses(support.makeSymbol());
    assertCondition(
      terminal.positions.getPositionCount() === 1,
      "reconciled canceled close unexpectedly changed exposure",
    );
    const tracked = await requestTrackedTrailingClose(terminal, "terminal");
    const order = support.requireDefined(
      terminal.feed.getOrder(tracked.clientOrderId),
      "expected terminal close order",
    );
    const unrelated = await terminal.orders.placeOrder({
      signal: { side: "buy", confidence: 1, reason: "unrelated-lifecycle", stopLoss: 0, takeProfit: 0 },
      symbol: support.makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "market",
      reduceOnly: false,
      strategy: "unrelated",
      leverage: 1,
    });
    assertCondition(
      !terminal.controller.applyRiskCloseLifecycle({ kind: "order", order: unrelated, deltaFilled: 0 }),
      "foreign order lifecycle was mistaken for a pending trailing close",
    );
    const terminalEvent: OrderLifecycleEvent = {
      kind: "order",
      order: { ...order, status: "canceled" },
      deltaFilled: 0,
    };
    assertCondition(
      terminal.controller.applyRiskCloseLifecycle(terminalEvent),
      "tracked terminal close was not handled by the lifecycle boundary",
    );
    assertCondition(
      terminal.positions.getPositionCount() === 2,
      "canceled close unexpectedly changed exposure",
    );
    assertCondition(
      !terminal.controller.applyRiskCloseLifecycle(terminalEvent),
      "terminal lifecycle did not release the pending close state",
    );
  } finally {
    await disposeDirectControllerStack(terminal);
  }
}

async function verifySymbolScopedAndFailedReconciliation(): Promise<void> {
  const scoped = await createDirectControllerStack();
  try {
    await requestTrackedTrailingClose(scoped, "symbol-scoped");
    await scoped.controller.reconcileRiskCloses(support.asSymbol("ETH/USDC"));
    assertCondition(
      scoped.positions.getPositionCount() === 1,
      "foreign ticker reconciliation changed BTC exposure",
    );
  } finally {
    await disposeDirectControllerStack(scoped);
  }

  const failed = await createDirectControllerStack({ feed: new ReconciliationFailureFeed() });
  try {
    await requestTrackedTrailingClose(failed, "reconciliation-failure");
    await failed.controller.reconcileRiskCloses(support.makeSymbol());
    assertCondition(
      failed.logger
        .getCalls()
        .some(
          (call) => call.event === "strategy.trailingstop.reconciliation.failed" && call.level === "warn",
        ),
      "reconciliation transport error was not logged through the public logger",
    );
    assertCondition(failed.positions.getPositionCount() === 1, "failed reconciliation changed exposure");
  } finally {
    await disposeDirectControllerStack(failed);
  }
}

export async function runStrategyRunnerPluginRiskCoverageLifecycle(): Promise<void> {
  await verifyDirectTrailingReconciliation();
  await verifyBlockedAndRetryableDirectCloses();
  await verifyPortfolioTrailingClose();
  await verifyConcurrentEmergencySingleFlight();
  await verifyPendingAndMissingTrailingCloseReconciliation();
  await verifyTerminalAndForeignTrailingLifecycle();
  await verifySymbolScopedAndFailedReconciliation();
}
