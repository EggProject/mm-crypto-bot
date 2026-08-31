import type { Bar, PluginState, SignalBus } from "@mm-crypto-bot/core";
import { RecordingLogger } from "@logging-testing";

import type { OrderLifecycleEvent } from "../../../src/bot/order-manager.js";
import { StrategyPluginRiskController } from "../../../src/bot/strategy-runner-plugin-risk-controller.js";
import * as support from "../../../src/bot/strategy-runner.test-support.js";

import { assertCondition } from "./runtime-driver-core.js";

interface DirectRiskStack {
  readonly controller: StrategyPluginRiskController;
  readonly feed: support.MockExchangeFeed;
  readonly logger: RecordingLogger;
  readonly orders: support.OrderManager;
  readonly positions: support.PositionManager;
}

function noOperation(): void {
  return;
}

const unavailable = undefined;

async function createDirectRiskStack(
  feed: support.MockExchangeFeed = new support.MockExchangeFeed(),
  latestPrice?: number,
  OrderManagerConstructor: typeof support.OrderManager = support.OrderManager,
): Promise<DirectRiskStack> {
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders = new OrderManagerConstructor({
    feed,
    getPositionContext: () => positions.getPositionContext(),
    getReduciblePosition: (symbol) => {
      const position = positions.getPositions().find((candidate) => candidate.symbol === symbol);
      return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
    },
  });
  const logger = new RecordingLogger();
  const controller = new StrategyPluginRiskController({
    instances: support.strategyInstances([]),
    orderManager: orders,
    positionManager: positions,
    enabledSymbols: new Set([support.makeSymbol()]),
    logger,
    isOrderEmissionBlocked: () => false,
    pause: noOperation,
    getRiskManager: () => unavailable,
    getPortfolioManager: () => unavailable,
    getOnEmergency: () => unavailable,
    latestPriceFor: () => latestPrice,
    notifyStrategyClosed: noOperation,
  });
  return { controller, feed, logger, orders, positions };
}

async function disposeDirectRiskStack(stack: DirectRiskStack): Promise<void> {
  stack.controller.dispose();
  await stack.feed.close();
}

async function withDirectRiskStack(
  createStack: () => Promise<DirectRiskStack>,
  verify: (stack: DirectRiskStack) => Promise<void>,
): Promise<void> {
  const stack = await createStack();
  try {
    await verify(stack);
  } finally {
    await disposeDirectRiskStack(stack);
  }
}

async function requestTrackedClose(
  stack: DirectRiskStack,
  strategy: string,
  side: "long" | "short" = "long",
): Promise<{ readonly order: support.Order }> {
  const position = stack.positions.openPosition(strategy, support.makeSymbol(), side, 1, 100, 1);
  await stack.controller.requestTrailingStopClose(position.id, 90, "trailing_stop");
  return {
    order: support.requireDefined(
      support.copyOrders(stack.feed.orderBook).at(0),
      "expected trailing-close payload",
    ),
  };
}

class StringPlacementFailureOrderManager extends support.OrderManager {
  public override placeOrder(
    ..._arguments: Parameters<support.OrderManager["placeOrder"]>
  ): Promise<support.Order> {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- E2E verifies the controller's String(error) port boundary.
    return Promise.reject("e2e trailing close string rejection");
  }
}

class SettledTrailingCloseFeed extends support.MockExchangeFeed {
  public constructor(private readonly priceKind: "average" | "price" | "fallback") {
    super();
  }

  public override async placeOrder(
    ...arguments_: Parameters<support.MockExchangeFeed["placeOrder"]>
  ): Promise<support.Order> {
    const [request] = arguments_;
    const order = await super.placeOrder(...arguments_);
    if (!request.reduceOnly) return order;
    return {
      ...order,
      status: "closed",
      filled: request.amount,
      average: this.priceKind === "average" ? 89 : undefined,
      price: this.priceKind === "price" ? 88 : undefined,
      updateTimestamp: this.priceKind === "average" ? 1 : undefined,
    };
  }
}

class StringReconciliationFailureOrderManager extends support.OrderManager {
  public override reconcileOrder(
    ..._arguments: Parameters<support.OrderManager["reconcileOrder"]>
  ): Promise<Awaited<ReturnType<support.OrderManager["reconcileOrder"]>>> {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- E2E verifies the controller's String(error) port boundary.
    return Promise.reject("e2e reconciliation string rejection");
  }
}

class TimestamplessReconcileFeed extends support.MockExchangeFeed {
  public override async fetchOrder(
    ...arguments_: Parameters<support.MockExchangeFeed["fetchOrder"]>
  ): Promise<support.Order> {
    return { ...(await super.fetchOrder(...arguments_)), updateTimestamp: undefined };
  }
}

async function makePaperRunner(
  plugin: support.StrategyPlugin,
  onEmergency?: ConstructorParameters<typeof support.StrategyRunner>[0]["onEmergency"],
): Promise<{
  readonly orderManager: support.OrderManager;
  readonly positionManager: support.PositionManager;
  readonly runner: support.StrategyRunner;
}> {
  const feed = new support.MockExchangeFeed();
  await feed.open();
  const positionManager = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orderManager = new support.OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
    paperMode: true,
  });
  const runner = new support.StrategyRunner({
    instances: support.strategyInstances([
      ["regime_detector", { kind: "plugin", name: "regime_detector", instance: plugin }],
      [
        "donchian_pivot_composition",
        {
          kind: "strategy",
          name: "donchian_pivot_composition",
          instance: new support.FixedSignalStrategy({
            side: "buy",
            confidence: 1,
            reason: "e2e-plugin-risk",
            stopLoss: 0,
            takeProfit: 0,
          }),
        },
      ],
    ]),
    orderManager,
    positionManager,
    sizingFn: () => 1,
    enabledSymbols: ["BTC/USDC"],
    ...(onEmergency !== undefined && { onEmergency }),
  });
  return { orderManager, positionManager, runner };
}

class NonBreachRiskPlugin extends support.LifecyclePlugin {
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
      source: "non-breach-risk:BTC/USDC",
      breach: false,
      reason: "e2e informational risk signal",
    });
  }
}

class RepeatedRiskActionPlugin extends support.LifecyclePlugin {
  private signalBus: SignalBus | undefined;

  public override subscribe(signalBus: SignalBus): void {
    super.subscribe(signalBus);
    this.signalBus = signalBus;
  }

  public override onBar(bar: Bar, state: PluginState): void {
    super.onBar(bar, state);
    for (const reason of ["first", "second"]) {
      this.signalBus?.emit({
        kind: "risk",
        varDaily95: 0,
        correlationPenalty: 0,
        drawdownLimit: 0,
        source: "risk-probe:BTC/USDC",
        breach: true,
        reason,
      });
    }
  }
}

async function verifyEmergencyAttribution(): Promise<void> {
  assertCondition(
    (await support.executeRiskPluginScenario("risk-probe:BTC/USDC", false)) === 1,
    "enabled risk breach did not invoke the emergency boundary",
  );
  assertCondition(
    (await support.executeRiskPluginScenario("risk-probe:BTC/USDC", true)) === 0,
    "paused runner processed a risk breach",
  );
  assertCondition(
    (await support.executeRiskPluginScenario("risk-probe:ETH/USDC", false)) === 0,
    "disabled symbol risk breach invoked the emergency boundary",
  );
}

async function verifyRiskLatchAndExplicitResume(): Promise<void> {
  const plugin = new support.RiskActionPlugin("risk-probe:BTC/USDC", true);
  let emergencyCalls = 0;
  const stack = await makePaperRunner(plugin, () => {
    emergencyCalls += 1;
  });
  await stack.runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  assertCondition(emergencyCalls === 1, "plugin breach did not invoke emergency callback");
  assertCondition(stack.runner.isPaused(), "plugin breach did not pause the runner");
  assertCondition(stack.orderManager.getCounters().placed === 0, "plugin breach allowed an entry");
  await stack.runner.onFeedEvent(support.makeOhlcvFeedEvent(2));
  assertCondition(stack.orderManager.getCounters().placed === 0, "latched pause allowed another entry");
  stack.runner.resume();
  await stack.runner.onFeedEvent(support.makeOhlcvFeedEvent(3));
  assertCondition(stack.orderManager.getCounters().placed === 1, "explicit resume did not release entries");
  stack.runner.dispose();
}

async function verifyAsyncPluginDraining(): Promise<void> {
  const plugin = new support.AsyncRiskActionPlugin();
  let emergencyCalls = 0;
  const stack = await makePaperRunner(plugin, () => {
    emergencyCalls += 1;
  });
  await stack.runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  assertCondition(plugin.completed, "runner did not await the async plugin");
  assertCondition(emergencyCalls === 1, "async risk signal did not invoke emergency callback");
  assertCondition(
    stack.positionManager.getPositionCount() === 0,
    "async risk signal allowed a position entry",
  );
  stack.runner.dispose();
}

async function verifyInformationalAndSingleFlightRiskSignals(): Promise<void> {
  let informationalEmergencies = 0;
  const informational = await makePaperRunner(new NonBreachRiskPlugin(), () => {
    informationalEmergencies += 1;
  });
  await informational.runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  assertCondition(!informational.runner.isPaused(), "non-breach risk signal paused the runner");
  assertCondition(informationalEmergencies === 0, "non-breach risk signal invoked emergency handling");
  informational.runner.dispose();

  let emergencies = 0;
  const { promise: emergencyClosed, resolve: releaseEmergency } = Promise.withResolvers<undefined>();
  const repeated = await makePaperRunner(new RepeatedRiskActionPlugin(), () => {
    emergencies += 1;
    return emergencyClosed;
  });
  await repeated.runner.onFeedEvent(support.makeOhlcvFeedEvent(2));
  assertCondition(repeated.runner.isPaused(), "risk breach did not pause the runner");
  assertCondition(emergencies === 1, "repeated risk signals started more than one emergency close");
  releaseEmergency(undefined);
  await emergencyClosed;
  repeated.runner.dispose();
}

async function verifyUnwiredEmergencyBoundary(): Promise<void> {
  const stack = await makePaperRunner(new support.RiskActionPlugin("risk-probe:BTC/USDC", true));
  await stack.runner.onFeedEvent(support.makeOhlcvFeedEvent(1));
  assertCondition(!stack.runner.isPaused(), "missing emergency boundary unexpectedly paused the runner");
  assertCondition(
    stack.positionManager.getPositionCount() === 1,
    "missing emergency boundary changed the ordinary paper strategy lifecycle",
  );
  stack.runner.dispose();
}

async function verifyDirectTrailingFaultPath(): Promise<void> {
  const rejected = await createDirectRiskStack(
    new support.MockExchangeFeed(),
    undefined,
    StringPlacementFailureOrderManager,
  );
  try {
    const position = rejected.positions.openPosition(
      "string-rejection",
      support.makeSymbol(),
      "long",
      1,
      100,
      1,
    );
    await rejected.controller.requestTrailingStopClose(position.id, 90, "trailing_stop");
    assertCondition(rejected.positions.getPositionCount() === 1, "rejected close changed exposure");
    assertCondition(
      rejected.logger
        .getCalls()
        .some((call) => call.event === "strategy.trailingstop.close.failed" && call.level === "error"),
      "string close rejection was not logged",
    );
  } finally {
    await disposeDirectRiskStack(rejected);
  }
}

async function verifyDirectTrailingPricePaths(): Promise<void> {
  for (const [side, priceKind] of [
    ["long", "average"],
    ["short", "price"],
    ["long", "fallback"],
  ] as const) {
    await withDirectRiskStack(
      () => createDirectRiskStack(new SettledTrailingCloseFeed(priceKind)),
      async (stack) => {
        await requestTrackedClose(stack, `settled-${side}-${priceKind}`, side);
        assertCondition(
          stack.positions.getPositionCount() === 0,
          `${priceKind} ${side} close did not settle`,
        );
      },
    );
  }
}

async function verifyReconciledTrailingPricePaths(): Promise<void> {
  for (const [side, kind, latestPrice] of [
    ["long", "average", 103],
    ["short", "price", 103],
    ["long", "latest", 87],
    ["long", "position", undefined],
  ] as const) {
    await withDirectRiskStack(
      () => createDirectRiskStack(new TimestamplessReconcileFeed(), latestPrice),
      async (stack) => {
        const tracked = await requestTrackedClose(stack, `reconciled-${side}-${kind}`, side);
        stack.feed.setOrderStatus(tracked.order.clientOrderId, {
          status: "closed",
          filled: 1,
          average: kind === "average" ? 89 : undefined,
          price: kind === "price" ? 88 : undefined,
        });
        await stack.controller.reconcileRiskCloses(support.makeSymbol());
        assertCondition(stack.positions.getPositionCount() === 0, `${kind} reconciliation did not settle`);
      },
    );
  }
}

async function verifyOrderLifecyclePriceAndStatePaths(): Promise<void> {
  for (const [kind, average, price] of [
    ["average", 89, undefined],
    ["price", undefined, 88],
    ["position", undefined, undefined],
  ] as const) {
    await withDirectRiskStack(
      () => createDirectRiskStack(),
      async (stack) => {
        const tracked = await requestTrackedClose(stack, `lifecycle-${kind}`);
        const event: OrderLifecycleEvent = {
          kind: "order",
          order: {
            ...tracked.order,
            status: "closed",
            filled: 1,
            average,
            price,
            updateTimestamp: undefined,
          },
          deltaFilled: 1,
        };
        assertCondition(stack.controller.applyRiskCloseLifecycle(event), `${kind} lifecycle was not handled`);
        assertCondition(stack.positions.getPositionCount() === 0, `${kind} lifecycle did not close exposure`);
      },
    );
  }

  const open = await createDirectRiskStack();
  try {
    const tracked = await requestTrackedClose(open, "open-lifecycle");
    assertCondition(
      open.controller.applyRiskCloseLifecycle({ kind: "order", order: tracked.order, deltaFilled: 0 }),
      "open lifecycle was not recognized",
    );
    assertCondition(open.positions.getPositionCount() === 1, "open lifecycle changed exposure");
  } finally {
    await disposeDirectRiskStack(open);
  }

  const disappeared = await createDirectRiskStack();
  try {
    const tracked = await requestTrackedClose(disappeared, "disappeared-lifecycle");
    disappeared.positions.recordFill({
      strategy: "disappeared-lifecycle",
      symbol: support.makeSymbol(),
      side: "short",
      quantity: 1,
      price: 99,
      leverage: 1,
      timestamp: 1,
    });
    assertCondition(
      disappeared.controller.applyRiskCloseLifecycle({ kind: "order", order: tracked.order, deltaFilled: 0 }),
      "disappeared lifecycle was not handled",
    );
  } finally {
    await disposeDirectRiskStack(disappeared);
  }

  const reconciliationFailure = await createDirectRiskStack(
    new support.MockExchangeFeed(),
    undefined,
    StringReconciliationFailureOrderManager,
  );
  try {
    const position = reconciliationFailure.positions.openPosition(
      "string-reconcile",
      support.makeSymbol(),
      "long",
      1,
      100,
      1,
    );
    const order = await reconciliationFailure.orders.placeOrder({
      signal: { side: "sell", confidence: 1, reason: "trailing_stop", stopLoss: 0, takeProfit: 0 },
      symbol: support.makeSymbol(),
      amount: 1,
      referencePrice: 90,
      type: "market",
      reduceOnly: true,
      strategy: "string-reconcile",
      leverage: 1,
    });
    reconciliationFailure.controller.recordPendingRiskClose(position.id, order.clientOrderId);
    await reconciliationFailure.controller.reconcileRiskCloses(support.makeSymbol());
    assertCondition(
      reconciliationFailure.logger
        .getCalls()
        .some(
          (call) => call.event === "strategy.trailingstop.reconciliation.failed" && call.level === "warn",
        ),
      "string reconciliation rejection was not logged",
    );
  } finally {
    await disposeDirectRiskStack(reconciliationFailure);
  }
}

export async function runStrategyRunnerPluginRisk(): Promise<void> {
  await verifyEmergencyAttribution();
  await verifyRiskLatchAndExplicitResume();
  await verifyAsyncPluginDraining();
  await verifyInformationalAndSingleFlightRiskSignals();
  await verifyUnwiredEmergencyBoundary();
  await verifyDirectTrailingFaultPath();
  await verifyDirectTrailingPricePaths();
  await verifyReconciledTrailingPricePaths();
  await verifyOrderLifecyclePriceAndStatePaths();
}
