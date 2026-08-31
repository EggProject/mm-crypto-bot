import type { OrderIntent, OrderLifecycleEvent } from "../../../src/bot/order-manager.js";
import type { StrategyOrderLifecycleControllerOptions } from "../../../src/bot/strategy-runner-order-lifecycle-controller.js";
import { StrategyOrderLifecycleController } from "../../../src/bot/strategy-runner-order-lifecycle-controller.js";
import type { PortfolioManager } from "../../../src/portfolio/portfolio-manager.js";
import {
  asSymbol,
  type ClientOrderId,
  type Order,
  type Symbol as ExchangeSymbol,
} from "@mm-crypto-bot/exchange";
import type { StrategySignal } from "@mm-crypto-bot/core";
import * as support from "../../../src/bot/strategy-runner.test-support.js";

import { assertCondition, MockExchangeFeed, quietLogger, RecordingLogger } from "./runtime-driver-core.js";
import {
  ImmediateFillFeed,
  makePortfolioStack,
  registerPortfolioStrategies,
} from "./runtime-driver-portfolio-fixtures.js";

const strategyName = "donchian_pivot_composition" as const;
const signal = {
  side: "buy" as const,
  confidence: 1,
  reason: "order-lifecycle-boundary",
  stopLoss: 0,
  takeProfit: 0,
};

function signalFor(side: StrategySignal["side"]): StrategySignal {
  return { ...signal, side };
}

type ControllerOverrides = Partial<
  Pick<
    StrategyOrderLifecycleControllerOptions,
    "getRiskManager" | "installProtections" | "latestPriceFor" | "logger" | "reconcileNativeProtections"
  >
>;

class PositionOpenedStrategy extends support.FixedSignalStrategy {
  public readonly opened: { readonly quantity: number; readonly entryPrice: number }[] = [];

  public onPositionOpened(position: { readonly quantity: number; readonly entryPrice: number }): void {
    this.opened.push({ quantity: position.quantity, entryPrice: position.entryPrice });
  }
}

class RejectingPlacementOrderManager extends support.OrderManager {
  public constructor(
    options: ConstructorParameters<typeof support.OrderManager>[0],
    private readonly failure: Error | string,
  ) {
    super(options);
  }

  public override async placeOrder(_intent: OrderIntent): Promise<Order> {
    await Promise.resolve();
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- The public exchange port may reject with a non-Error value.
    throw this.failure;
  }
}

class RejectingReconciliationOrderManager extends support.OrderManager {
  public constructor(
    options: ConstructorParameters<typeof support.OrderManager>[0],
    private readonly failure: Error | string,
  ) {
    super(options);
  }

  public override async reconcileOrder(
    _clientOrderId: ClientOrderId,
    _symbol: ExchangeSymbol,
  ): Promise<{ readonly order: Order; readonly deltaFilled: number }> {
    await Promise.resolve();
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- The public exchange port may reject with a non-Error value.
    throw this.failure;
  }
}

class UndefinedTimestampFeed extends MockExchangeFeed {
  public override async fetchOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    const order = await super.fetchOrder(clientOrderId, symbol);
    return { ...order, updateTimestamp: undefined };
  }
}

function makeController(
  positionManager: support.PositionManager,
  orderManager: support.OrderManager,
  sizingFunction: StrategyOrderLifecycleControllerOptions["sizingFn"],
  getRegimeSizeModifier: (symbol: ReturnType<typeof support.makeSymbol>) => number,
  portfolioManager?: PortfolioManager,
  isOrderEmissionBlocked: () => boolean = () => false,
  overrides: ControllerOverrides = {},
): StrategyOrderLifecycleController {
  const options: StrategyOrderLifecycleControllerOptions = {
    orderManager,
    positionManager,
    sizingFn: sizingFunction,
    riskPerTrade: 0.01,
    maxLeverage: 10,
    logger: quietLogger,
    isOrderEmissionBlocked,
    getRiskManager: () => void 0,
    getPortfolioManager: () => portfolioManager,
    getRegimeSizeModifier,
    protectionKey: (strategy, symbol) => `${strategy}:${symbol}`,
    latestPriceFor: () => 100,
    installProtections: () => Promise.resolve(),
    reconcileNativeProtections: () => Promise.resolve(),
  };
  return new StrategyOrderLifecycleController({ ...options, ...overrides });
}

async function makeDirectStack(
  feed: MockExchangeFeed = new MockExchangeFeed(),
  orderManagerFor?: (feed: MockExchangeFeed, positions: support.PositionManager) => support.OrderManager,
): Promise<{
  readonly feed: MockExchangeFeed;
  readonly positions: support.PositionManager;
  readonly orders: support.OrderManager;
}> {
  await feed.open();
  const positions = new support.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orders =
    orderManagerFor?.(feed, positions) ??
    new support.OrderManager({ feed, getPositionContext: () => positions.getPositionContext() });
  return { feed, positions, orders };
}

async function handleSignal(
  controller: StrategyOrderLifecycleController,
  strategy: support.FixedSignalStrategy,
  policy?: Parameters<StrategyOrderLifecycleController["handleSignal"]>[5],
  orderSignal: StrategySignal = signal,
): Promise<void> {
  await controller.handleSignal(strategyName, strategy, orderSignal, support.makeSymbol(), 100, policy);
}

async function verifyAdmissionGuards(): Promise<void> {
  const direct = await makeDirectStack();
  try {
    const one = () => 1;
    for (const [sizing, regime] of [
      [() => 0, one],
      [one, () => 0],
    ] as const) {
      await handleSignal(
        makeController(direct.positions, direct.orders, sizing, regime),
        new support.FixedSignalStrategy(signal),
      );
    }
    assertCondition(direct.orders.getCounters().placed === 0, "zero sizing or regime emitted an order");
    direct.positions.openPosition(strategyName, support.makeSymbol(), "long", 1, 100, 1);
    const controller = makeController(direct.positions, direct.orders, one, one);
    await handleSignal(controller, new support.FixedSignalStrategy(signal), { maxPositions: 1 });
    assertCondition(direct.orders.getCounters().placed === 0, "max-position guard emitted an order");
    await handleSignal(controller, new support.FixedSignalStrategy(signal), { maxPositions: 2 });
    const initiallyBlocked = makeController(direct.positions, direct.orders, one, one, undefined, () => true);
    await handleSignal(initiallyBlocked, new support.FixedSignalStrategy(signal));
    let isBlockedAfterSizing = false;
    const blockedBeforePlacement = makeController(
      direct.positions,
      direct.orders,
      () => {
        isBlockedAfterSizing = true;
        return 1;
      },
      one,
      undefined,
      () => isBlockedAfterSizing,
    );
    await handleSignal(blockedBeforePlacement, new support.FixedSignalStrategy(signal));
    assertCondition(
      direct.orders.getCounters().placed === 1 &&
        initiallyBlocked.getTotalSignals() === 0 &&
        blockedBeforePlacement.getTotalSignals() === 1,
      "pre- and post-sizing pause guards did not preserve signal accounting",
    );
  } finally {
    await direct.feed.close();
  }

  const portfolio = await makePortfolioStack();
  try {
    const controller = makeController(
      portfolio.positionManager,
      portfolio.orderManager,
      () => 1,
      () => 1,
      portfolio.portfolioManager,
    );
    await handleSignal(controller, new support.FixedSignalStrategy(signal));
    portfolio.portfolioStop.forceTrip("e2e-controller-trip");
    const tripped = makeController(
      portfolio.positionManager,
      portfolio.orderManager,
      () => 1,
      () => 1,
      portfolio.portfolioManager,
    );
    await handleSignal(tripped, new support.FixedSignalStrategy(signal));
    assertCondition(
      tripped.getTotalSignals() === 1 &&
        portfolio.orderManager.getCounters().placed === 0 &&
        controller.getTotalSignals() === 1,
      "zero-budget or tripped portfolio admitted an entry order",
    );
  } finally {
    await portfolio.feed.close();
  }
}

async function verifyRiskBudgetedPaperFillAndCallback(): Promise<void> {
  const logger = new RecordingLogger();
  const portfolio = await makePortfolioStack({ paperMode: true, totalRiskUsd: 100, logger });
  try {
    registerPortfolioStrategies(portfolio, [[strategyName, 1]]);
    const installed: Parameters<StrategyOrderLifecycleControllerOptions["installProtections"]>[0][] = [];
    const strategy = new PositionOpenedStrategy(signal);
    const riskManager = new support.RiskManager({
      trailingStop: { enabled: false, atrPeriod: 2, atrMultiplier: 1, side: "both" },
      kelly: {
        enabled: false,
        fraction: 0.25,
        windowSize: 5,
        minTrades: 1,
        fallbackFraction: 0.02,
        maxFraction: 0.1,
      },
      drawdownScaler: { enabled: true, maxDdPct: 0.2, initialEquity: 100_000 },
    });
    const controller = makeController(
      portfolio.positionManager,
      portfolio.orderManager,
      () => 0,
      () => 1,
      portfolio.portfolioManager,
      () => false,
      {
        logger,
        getRiskManager: () => riskManager,
        installProtections: (input) => {
          installed.push(input);
          return Promise.resolve();
        },
      },
    );
    await controller.handleSignal(strategyName, strategy, signal, support.makeSymbol(), 100, undefined);
    assertCondition(
      portfolio.orderManager.getCounters().placed === 1 &&
        portfolio.positionManager.getPosition(strategyName, support.makeSymbol(), "long")?.quantity === 1,
      "RiskManager sizing and portfolio budget did not place the capped paper fill",
    );
    assertCondition(
      installed.at(0)?.quantity === 1 && strategy.opened.at(0)?.entryPrice === 100,
      "paper fill did not install protections and notify the strategy with the fill price",
    );
    assertCondition(
      logger.entries.some((entry) => entry.message === "strategy.order.budget.reduced"),
      "budget cap did not emit the observable reduction log",
    );
    const withinBudget = makeController(
      portfolio.positionManager,
      portfolio.orderManager,
      () => 0.5,
      () => 1,
      portfolio.portfolioManager,
    );
    await handleSignal(withinBudget, new support.FixedSignalStrategy(signal));
    riskManager.onEquityUpdate(10_000);
    await handleSignal(controller, new support.FixedSignalStrategy(signal));
    assertCondition(
      portfolio.orderManager.getCounters().placed === 2,
      "within-budget or zero-risk-fraction handling changed the placed order count",
    );
  } finally {
    await portfolio.feed.close();
  }
}

async function verifyImmediateFillFallbackPermutations(): Promise<void> {
  const scenarios: readonly {
    readonly pricing: "average" | "price" | "position";
    readonly side: "buy" | "sell";
  }[] = [
    { pricing: "average", side: "buy" },
    { pricing: "price", side: "buy" },
    { pricing: "position", side: "sell" },
  ];
  for (const scenario of scenarios) {
    const stack = await makeDirectStack(new ImmediateFillFeed(scenario.pricing));
    try {
      const one = () => 1;
      const strategy = new PositionOpenedStrategy(signalFor(scenario.side));
      const controller = makeController(stack.positions, stack.orders, one, one);
      await handleSignal(controller, strategy, undefined, signalFor(scenario.side));
      assertCondition(
        stack.positions.getPosition(
          strategyName,
          support.makeSymbol(),
          scenario.side === "buy" ? "long" : "short",
        )?.quantity === 1 && strategy.opened.length === 1,
        "immediate fill fallback did not preserve the observable position and callback",
      );
    } finally {
      await stack.feed.close();
    }
  }
}

function executionLifecycleEvent(order: Order, deltaFilled: number, price: number): OrderLifecycleEvent {
  return {
    kind: "execution",
    order,
    deltaFilled,
    execution: {
      executionId: `order-lifecycle-execution-${String(deltaFilled)}`,
      clientOrderId: order.clientOrderId,
      exchangeOrderId: order.exchangeId,
      symbol: order.symbol,
      side: order.side,
      quantity: deltaFilled,
      price,
      fee: 0,
      feeCurrency: "USDC",
      timestamp: 2,
    },
  };
}

async function verifyPartialReconciliationAndExecutionPricing(): Promise<void> {
  const reconciliation = await makeDirectStack(new UndefinedTimestampFeed());
  try {
    const installed: Parameters<StrategyOrderLifecycleControllerOptions["installProtections"]>[0][] = [];
    const strategy = new PositionOpenedStrategy(signal);
    let hasLatestPrice = true;
    const controller = makeController(
      reconciliation.positions,
      reconciliation.orders,
      () => 1,
      () => 1,
      undefined,
      () => false,
      {
        latestPriceFor: () => (hasLatestPrice ? 99 : undefined),
        installProtections: (input) => {
          installed.push(input);
          return Promise.resolve();
        },
      },
    );
    await controller.handleSignal(strategyName, strategy, signal, support.makeSymbol(), 100, undefined);
    const orderId = support.requireDefined(
      reconciliation.orders.getInFlightOrderIds().at(0),
      "missing pending order",
    );
    await controller.reconcilePendingOrders(asSymbol("ETH/USDC"));
    reconciliation.feed.setOrderStatus(orderId, { filled: 0.5, status: "open" });
    await controller.reconcilePendingOrders(support.makeSymbol());
    hasLatestPrice = false;
    reconciliation.feed.setOrderStatus(orderId, { filled: 1, status: "closed" });
    await controller.reconcilePendingOrders(support.makeSymbol());
    assertCondition(
      reconciliation.positions.getPosition(strategyName, support.makeSymbol(), "long")?.quantity === 1 &&
        installed.length === 2 &&
        strategy.opened.length === 1,
      "partial reconciliation did not apply each fill while notifying the strategy once",
    );
  } finally {
    await reconciliation.feed.close();
  }

  const lifecycle = await makeDirectStack();
  try {
    const lifecycleSignal = signalFor("sell");
    const strategy = new PositionOpenedStrategy(lifecycleSignal);
    const controller = makeController(
      lifecycle.positions,
      lifecycle.orders,
      () => 1,
      () => 1,
      undefined,
      () => false,
      {
        latestPriceFor: () => void 0,
        installProtections: () => Promise.resolve(),
      },
    );
    await handleSignal(controller, strategy, undefined, lifecycleSignal);
    const orderId = support.requireDefined(
      lifecycle.orders.getInFlightOrderIds().at(0),
      "missing lifecycle order",
    );
    const openOrder = support.requireDefined(
      lifecycle.feed.getOrder(orderId),
      "missing lifecycle order payload",
    );
    const unrelated = await lifecycle.orders.placeOrder({
      signal: lifecycleSignal,
      symbol: support.makeSymbol(),
      amount: 1,
      referencePrice: 100,
      type: "market",
      clientOrderIdHint: "untracked-lifecycle",
    });
    const isIgnored = await controller.applyPendingOrderLifecycle({
      kind: "order",
      order: unrelated,
      deltaFilled: 0,
    });
    const partial: Order = {
      ...openOrder,
      average: undefined,
      price: undefined,
      filled: 0.5,
      status: "open",
    };
    const isAccepted = await controller.applyPendingOrderLifecycle({
      kind: "order",
      order: partial,
      deltaFilled: 0,
    });
    await controller.applyPendingOrderLifecycle(executionLifecycleEvent(partial, 0.5, 101));
    const terminal: Order = { ...partial, filled: 1, status: "closed", updateTimestamp: undefined };
    await controller.applyPendingOrderLifecycle({ kind: "order", order: terminal, deltaFilled: 0.5 });
    assertCondition(
      !isIgnored &&
        isAccepted &&
        lifecycle.positions.getPosition(strategyName, support.makeSymbol(), "short")?.entryPrice === 50.5 &&
        strategy.opened.length === 1,
      "execution and lifecycle price fallbacks did not preserve the public partial-fill state transition",
    );
  } finally {
    await lifecycle.feed.close();
  }
}

async function verifyFailureCase(
  isReconcile: boolean,
  logMessage: string,
  failure: Error | string,
): Promise<void> {
  const logger = new RecordingLogger();
  const stack = await makeDirectStack(new MockExchangeFeed(), (feed, positions) => {
    const options = { feed, getPositionContext: () => positions.getPositionContext() };
    return isReconcile
      ? new RejectingReconciliationOrderManager(options, failure)
      : new RejectingPlacementOrderManager(options, failure);
  });
  try {
    const controller = makeController(
      stack.positions,
      stack.orders,
      () => 1,
      () => 1,
      undefined,
      undefined,
      { logger },
    );
    await handleSignal(controller, new support.FixedSignalStrategy(signal));
    if (isReconcile) {
      await controller.reconcilePendingOrders(support.makeSymbol());
    }
    assertCondition(
      logger.entries.some((entry) => entry.message === logMessage),
      `${logMessage} was not logged`,
    );
  } finally {
    await stack.feed.close();
  }
}

async function verifyPlacementAndReconciliationFailures(): Promise<void> {
  for (const [isReconcile, logMessage] of [
    [false, "strategy.order.place.failed"],
    [true, "strategy.order.pending.reconciliation.failed"],
  ] as const) {
    for (const failure of [new Error("injected failure"), "injected string failure"]) {
      await verifyFailureCase(isReconcile, logMessage, failure);
    }
  }
}

export async function runStrategyRunnerOrderLifecycleBoundaries(): Promise<void> {
  await verifyAdmissionGuards();
  await verifyRiskBudgetedPaperFillAndCallback();
  await verifyImmediateFillFallbackPermutations();
  await verifyPartialReconciliationAndExecutionPricing();
  await verifyPlacementAndReconciliationFailures();
}
