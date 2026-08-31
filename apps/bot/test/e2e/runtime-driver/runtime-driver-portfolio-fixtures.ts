import {
  asSymbol,
  type Balance,
  type ClientOrderId,
  type ExchangePosition,
  type Execution,
  type FeedEvent,
  type FeedListener,
  type MarketMeta,
  type Order,
  type OrderRequest,
  type SubscriptionId,
  type Symbol as ExchangeSymbol,
  type Ticker,
} from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/logging";
import type { Bot } from "../../../src/bot/bot.js";

import { OrderManager } from "../../../src/bot/order-manager.js";
import { PositionManager } from "../../../src/bot/position-manager.js";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import type { BotConfig } from "../../../src/config/schema.js";
import { PortfolioStop } from "../../../src/portfolio/portfolio-stop.js";
import { CorrelationMatrix } from "../../../src/portfolio/correlation.js";
import { PortfolioManager } from "../../../src/portfolio/portfolio-manager.js";
import { RiskBudgetAllocator } from "../../../src/portfolio/risk-budget.js";

import { MockExchangeFeed, quietLogger, waitForCondition } from "./runtime-driver-core.js";

function botConfigFor(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
    exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "mock" },
    symbols: { enabled: ["BTC/USDC"] },
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
    telemetry: {
      ...DEFAULT_BOT_CONFIG.telemetry,
      log_dir: `${stateFile}.logs`,
      metrics_interval_sec: 60,
    },
  };
}

async function startBotThenStop(bot: Bot, feed: MockExchangeFeed): Promise<void> {
  const running = bot.start();
  await waitForCondition(() => feed.subscriptionCount() > 0, "bot subscription");
  await bot.stop();
  await running;
}

function makePortfolioSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC");
}

function makePortfolioMarketMeta(isSpot: boolean, minCost = 1): MarketMeta {
  const symbol = makePortfolioSymbol();
  return {
    symbol,
    base: "BTC",
    quote: "USDC",
    amountPrecision: 4,
    pricePrecision: 2,
    minAmount: 0.0001,
    minCost,
    isSpot,
  };
}

function makeRemotePosition(side: "long" | "short" = "long", quantity = 0.01): ExchangePosition {
  return {
    symbol: makePortfolioSymbol(),
    side,
    quantity,
    entryPrice: 60_000,
    markPrice: 59_900,
    unrealizedPnl: -1,
    updateTimestamp: 1,
  };
}

function firstOrder(orders: readonly Order[], label: string): Order {
  const order = orders[0];
  if (order === undefined) throw new Error(`${label}: expected an order`);
  return order;
}

class SequencedFillFeed extends MockExchangeFeed {
  public readonly placedOrders: Order[] = [];

  public constructor(
    private readonly fillFractions: number[],
    options: ConstructorParameters<typeof MockExchangeFeed>[0],
  ) {
    super(options);
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    const filled = request.amount * (this.fillFractions.shift() ?? 1);
    this.setOrderStatus(order.clientOrderId, {
      status: "closed",
      filled,
      average: request.price,
    });
    const closed = this.getOrder(order.clientOrderId) ?? order;
    this.placedOrders.push(closed);
    return closed;
  }
}

class FailOnceCancelFeed extends MockExchangeFeed {
  private failNextCancel = true;

  public override async cancelOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    if (this.failNextCancel) {
      this.failNextCancel = false;
      throw new Error("injected cancel failure");
    }
    return super.cancelOrder(clientOrderId, symbol);
  }
}

class FaultFeed extends MockExchangeFeed {
  public readonly marketMetaFailures: unknown[] = [];
  public readonly positionFailures: unknown[] = [];
  public readonly balanceFailures: unknown[] = [];
  public readonly placeFailures: unknown[] = [];
  public readonly orderFailures: unknown[] = [];
  public readonly tickerFailures: unknown[] = [];
  public positionFailureOnCall: { readonly call: number; readonly failure: unknown } | undefined;
  public balanceFailureOnCall: { readonly call: number; readonly failure: unknown } | undefined;
  public readonly placedOrders: Order[] = [];
  // eslint-disable-next-line unicorn/consistent-class-member-order -- The E2E fixture preserves the asserted protocol behavior.
  private positionCalls = 0;
  private balanceCalls = 0;

  private throwNext(failures: unknown[]): void {
    if (failures.length > 0) throw failures.shift();
  }

  public override async fetchMarketMeta(symbol: ExchangeSymbol): Promise<MarketMeta> {
    this.throwNext(this.marketMetaFailures);
    return super.fetchMarketMeta(symbol);
  }

  public override async fetchPositions(
    symbols?: readonly ExchangeSymbol[],
  ): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    if (this.positionFailureOnCall?.call === this.positionCalls) throw this.positionFailureOnCall.failure;
    this.throwNext(this.positionFailures);
    return super.fetchPositions(symbols);
  }

  public override async fetchBalances(): Promise<readonly Balance[]> {
    this.balanceCalls += 1;
    if (this.balanceFailureOnCall?.call === this.balanceCalls) throw this.balanceFailureOnCall.failure;
    this.throwNext(this.balanceFailures);
    return super.fetchBalances();
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    this.throwNext(this.placeFailures);
    const order = await super.placeOrder(request);
    this.placedOrders.push(order);
    return order;
  }

  public override async fetchOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    this.throwNext(this.orderFailures);
    return super.fetchOrder(clientOrderId, symbol);
  }

  public override async fetchTickerSnapshot(symbol: ExchangeSymbol): Promise<Ticker> {
    this.throwNext(this.tickerFailures);
    return super.fetchTickerSnapshot(symbol);
  }
}

class LifecycleFeed extends MockExchangeFeed {
  private readonly lifecycleListeners = new Map<SubscriptionId, FeedListener>();
  private nextLifecycleId = 10_000;
  public readonly placedOrders: Order[] = [];

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    this.placedOrders.push(order);
    return order;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
  public async subscribeOrderUpdates(listener: FeedListener): Promise<SubscriptionId> {
    return this.addLifecycleListener(listener);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
  public async subscribeExecutions(listener: FeedListener): Promise<SubscriptionId> {
    return this.addLifecycleListener(listener);
  }

  public override async unsubscribe(id: SubscriptionId): Promise<void> {
    if (!this.lifecycleListeners.delete(id)) await super.unsubscribe(id);
  }

  public emitLifecycle(event: FeedEvent): void {
    for (const listener of this.lifecycleListeners.values()) listener(event);
  }

  // eslint-disable-next-line unicorn/consistent-class-member-order -- The E2E fixture preserves the asserted protocol behavior.
  private addLifecycleListener(listener: FeedListener): SubscriptionId {
    const id = this.nextLifecycleId;
    this.nextLifecycleId += 1;
    this.lifecycleListeners.set(id, listener);
    return id;
  }
}

class FailOnceLifecycleFeed extends LifecycleFeed {
  private failNextCancel = true;

  public override async cancelOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    if (this.failNextCancel) {
      this.failNextCancel = false;
      throw new Error("injected lifecycle cancel failure");
    }
    return super.cancelOrder(clientOrderId, symbol);
  }
}

class AutoFlattenFeed extends MockExchangeFeed {
  public readonly placedOrders: Order[] = [];

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    const closed: Order = {
      ...order,
      status: "closed",
      filled: request.amount,
      average: request.price,
    };
    this.setOrderStatus(order.clientOrderId, closed);
    this.placedOrders.push(closed);
    if (request.side === "sell") {
      this.setPositions([]);
      this.setBalance("BTC", 0, 0);
    }
    return this.getOrder(order.clientOrderId) ?? closed;
  }
}

class ImmediateFillFeed extends MockExchangeFeed {
  public constructor(private readonly pricing: "average" | "price" | "position") {
    super();
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    return {
      ...order,
      status: "closed",
      filled: request.amount,
      average: this.pricing === "average" ? request.price : undefined,
      price: this.pricing === "price" ? request.price : undefined,
      updateTimestamp: undefined,
    };
  }
}

interface PortfolioStackOptions {
  readonly totalRiskUsd?: number;
  readonly maxDdPct?: number;
  readonly threshold?: number;
  readonly requireAuthoritativeEmergencyState?: boolean;
  readonly configuredSymbols?: readonly string[];
  readonly balances?: readonly Balance[];
  readonly positions?: readonly ExchangePosition[];
  readonly marketMeta?: ReadonlyMap<ExchangeSymbol, MarketMeta>;
  readonly feed?: MockExchangeFeed;
  readonly logger?: Logger;
  readonly terminalCloseEvidenceLimit?: number;
  readonly paperMode?: boolean;
}

interface PortfolioStack {
  readonly feed: MockExchangeFeed;
  readonly positionManager: PositionManager;
  readonly orderManager: OrderManager;
  readonly correlation: CorrelationMatrix;
  readonly portfolioStop: PortfolioStop;
  readonly portfolioManager: PortfolioManager;
}

async function makePortfolioStack(options: PortfolioStackOptions = {}): Promise<PortfolioStack> {
  const feed =
    options.feed ??
    new MockExchangeFeed({
      balances: options.balances ?? [{ currency: "USDC", free: 1_000_000, total: 1_000_000 }],
      ...(options.positions !== undefined && { positions: options.positions }),
      ...(options.marketMeta !== undefined && { marketMeta: options.marketMeta }),
    });
  await feed.open();
  const positionManager = new PositionManager({
    initialEquityUsd: 100_000,
    maxPositions: 8,
    maxLeverage: 10,
    logger: quietLogger,
  });
  const orderManager = new OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
    paperMode: options.paperMode ?? false,
    logger: quietLogger,
  });
  const riskBudget = new RiskBudgetAllocator({
    totalRiskUsd: options.totalRiskUsd ?? 1000,
    correlationPenaltyThreshold: options.threshold ?? 0.7,
    logger: quietLogger,
  });
  const correlation = new CorrelationMatrix({ windowSize: 30, logger: quietLogger });
  const portfolioStop = new PortfolioStop({ maxDdPct: options.maxDdPct ?? 0.1, logger: quietLogger });
  const portfolioManager = new PortfolioManager({
    riskBudget,
    correlation,
    portfolioStop,
    positionManager,
    orderManager,
    ...(options.requireAuthoritativeEmergencyState !== undefined && {
      requireAuthoritativeEmergencyState: options.requireAuthoritativeEmergencyState,
    }),
    ...(options.configuredSymbols !== undefined && { configuredSymbols: options.configuredSymbols }),
    logger: options.logger ?? quietLogger,
    ...(options.terminalCloseEvidenceLimit !== undefined && {
      terminalCloseEvidenceLimit: options.terminalCloseEvidenceLimit,
    }),
  });
  return { feed, positionManager, orderManager, correlation, portfolioStop, portfolioManager };
}

function registerPortfolioStrategies(
  stack: PortfolioStack,
  configs: readonly (readonly [string, number])[],
): void {
  for (const [strategyId, weight] of configs) {
    stack.portfolioManager.setStrategyConfig({ strategyId, weight, riskPerTrade: 0.01 });
  }
}

function makeExecution(order: Order, id: string, quantity: number, price = 59_900): Execution {
  return {
    executionId: id,
    clientOrderId: order.clientOrderId,
    exchangeOrderId: order.exchangeId,
    symbol: order.symbol,
    side: order.side,
    quantity,
    price,
    fee: 0,
    feeCurrency: "USDC",
    timestamp: 1,
  };
}

export {
  botConfigFor,
  startBotThenStop,
  makePortfolioSymbol,
  makePortfolioMarketMeta,
  makeRemotePosition,
  firstOrder,
  SequencedFillFeed,
  FailOnceCancelFeed,
  FaultFeed,
  LifecycleFeed,
  FailOnceLifecycleFeed,
  AutoFlattenFeed,
  ImmediateFillFeed,
  makePortfolioStack,
  registerPortfolioStrategies,
  makeExecution,
};
