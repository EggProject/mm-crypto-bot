/**
 * apps/bot/src/portfolio/portfolio-manager.test.ts
 *
 * A `PortfolioManager` integrációs tesztjei — a 3 modul
 * (risk-budget + correlation + portfolio-stop) összekapcsolása, a
 * SAFETY-CRITICAL close-all akció bizonyítása, és az event-flow
 * (recordFill, recordEquity) helyes működése.
 *
 * A tesztek a `MockExchangeFeed` + valódi `OrderManager` +
 * `PositionManager` stack-et használják — a mock feed tárolja az
 * order-eket, így a teszt ellenőrizheti, hogy a close-all valóban
 * PIACI order-eket helyezett el (és NEM limit-eket).
 */

import {
  asSymbol,
  type Balance,
  type ClientOrderId,
  type ExchangePosition,
  type FeedEvent,
  type FeedListener,
  type MarketMeta,
  type Order,
  type OrderRequest,
  type SubscriptionId,
  type Symbol as ExchangeSymbol,
  type Ticker,
} from "@mm-crypto-bot/exchange";
import { RecordingLogger } from "@logging-testing";
import type { Logger } from "@mm-crypto-bot/logging";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

export { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
export { asSymbol } from "@mm-crypto-bot/exchange";
export type { Execution, FeedEvent, MarketMeta } from "@mm-crypto-bot/exchange";
export type { Logger } from "@mm-crypto-bot/logging";

import { OrderManager as RuntimeOrderManager } from "../bot/order-manager.js";
import { PositionManager as RuntimePositionManager } from "../bot/position-manager.js";
import { CorrelationMatrix as RuntimeCorrelationMatrix } from "./correlation.js";
import { PortfolioManager as RuntimePortfolioManager } from "./portfolio-manager.js";
import { PortfolioStop as RuntimePortfolioStop } from "./portfolio-stop.js";
import { RiskBudgetAllocator as RuntimeRiskBudgetAllocator } from "./risk-budget.js";
import type { StrategyRiskConfig } from "./risk-budget.js";

export class OrderManager extends RuntimeOrderManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeOrderManager>) {
    const [options] = arguments_;
    super({ ...options, logger: options.logger ?? new RecordingLogger() });
  }
}

export class PositionManager extends RuntimePositionManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimePositionManager>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}

export class CorrelationMatrix extends RuntimeCorrelationMatrix {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeCorrelationMatrix>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}

export class PortfolioManager extends RuntimePortfolioManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimePortfolioManager>) {
    const [options] = arguments_;
    super({ ...options, logger: options.logger ?? new RecordingLogger() });
  }
}

export class PortfolioStop extends RuntimePortfolioStop {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimePortfolioStop>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}

export class RiskBudgetAllocator extends RuntimeRiskBudgetAllocator {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeRiskBudgetAllocator>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}

export function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC");
}

export function makeMarketMeta(isSpot: boolean, minCost = 1): MarketMeta {
  const symbol = makeSymbol();
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

export function makeRemotePosition(side: "long" | "short" = "long", quantity = 0.01): ExchangePosition {
  return {
    symbol: makeSymbol(),
    side,
    quantity,
    entryPrice: 60_000,
    markPrice: 59_900,
    unrealizedPnl: -1,
    updateTimestamp: Date.now(),
  };
}

export function requirePlacedOrder(orders: readonly Order[]): Order {
  const order = orders[0];
  if (order === undefined) throw new Error("expected a placed order");
  return order;
}

export function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export function isOrder(value: unknown): value is Order {
  if (typeof value !== "object" || value === null) return false;
  return (
    "clientOrderId" in value &&
    "exchangeId" in value &&
    "symbol" in value &&
    "side" in value &&
    "type" in value &&
    "status" in value &&
    "amount" in value &&
    "filled" in value &&
    "submitTimestamp" in value
  );
}

export function readOrderBook(feed: MockExchangeFeed): Order[] {
  const candidate = Reflect.get(feed, "orderBook") as unknown;
  if (!(candidate instanceof Map)) throw new Error("expected test feed order book");
  const copiedOrders: Order[] = [];
  candidate.forEach((order) => {
    if (!isOrder(order)) throw new Error("expected order record in test feed");
    copiedOrders.push(order);
  });
  return copiedOrders;
}

export function findOrder(
  orders: readonly Order[],
  isMatchingOrder: (order: Order) => boolean,
  message: string,
): Order {
  return requireDefined(
    orders.find((order) => isMatchingOrder(order)),
    message,
  );
}

export class SequencedFillFeed extends MockExchangeFeed {
  public constructor(
    private readonly fillFractions: number[],
    options: ConstructorParameters<typeof MockExchangeFeed>[0],
  ) {
    super(options);
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    const fraction = this.fillFractions.shift() ?? 1;
    const filled = request.amount * fraction;
    this.setOrderStatus(order.clientOrderId, { status: "closed", filled, average: request.price });
    return requireDefined(this.getOrder(order.clientOrderId), "expected sequenced order");
  }
}

export class FailOnceCancelFeed extends MockExchangeFeed {
  private failNextCancel = true;

  public override async cancelOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    if (this.failNextCancel) {
      this.failNextCancel = false;
      throw new Error("injected cancel failure");
    }
    return super.cancelOrder(clientOrderId, symbol);
  }
}

export class FaultFeed extends MockExchangeFeed {
  private positionCalls = 0;
  private balanceCalls = 0;
  public marketMetaFailures: unknown[] = [];
  public positionFailures: unknown[] = [];
  public balanceFailures: unknown[] = [];
  public placeFailures: unknown[] = [];
  public orderFailures: unknown[] = [];
  public tickerFailures: unknown[] = [];
  public positionFailureOnCall: { readonly call: number; readonly failure: unknown } | undefined;
  public balanceFailureOnCall: { readonly call: number; readonly failure: unknown } | undefined;
  public readonly placedOrders: Order[] = [];

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

export class LifecycleFeed extends MockExchangeFeed {
  private readonly lifecycleListeners = new Map<SubscriptionId, FeedListener>();
  private nextLifecycleId = 10_000;
  public readonly placedOrders: Order[] = [];

  private addLifecycleListener(listener: FeedListener): SubscriptionId {
    const id = this.nextLifecycleId;
    this.nextLifecycleId += 1;
    this.lifecycleListeners.set(id, listener);
    return id;
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    this.placedOrders.push(order);
    return order;
  }

  public subscribeOrderUpdates(listener: FeedListener): Promise<SubscriptionId> {
    return Promise.resolve(this.addLifecycleListener(listener));
  }

  public subscribeExecutions(listener: FeedListener): Promise<SubscriptionId> {
    return Promise.resolve(this.addLifecycleListener(listener));
  }

  public override async unsubscribe(id: SubscriptionId): Promise<void> {
    if (!this.lifecycleListeners.delete(id)) await super.unsubscribe(id);
  }

  public emitLifecycle(event: FeedEvent): void {
    for (const listener of this.lifecycleListeners.values()) listener(event);
  }
}

export class AutoFlattenFeed extends MockExchangeFeed {
  public readonly placedOrders: Order[] = [];

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    const closed = { ...order, status: "closed" as const, filled: request.amount, average: request.price };
    this.setOrderStatus(order.clientOrderId, closed);
    this.placedOrders.push(closed);
    if (request.side === "sell") {
      this.setPositions([]);
      this.setBalance("BTC", 0, 0);
    }
    return this.getOrder(order.clientOrderId) ?? closed;
  }
}

export class ImmediateFillFeed extends MockExchangeFeed {
  public constructor(private readonly pricing: "average" | "price" | "position") {
    super();
  }

  public override async placeOrder(request: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(request);
    const closed: Order = {
      ...order,
      status: "closed",
      filled: request.amount,
      average: this.pricing === "average" ? request.price : undefined,
      price: this.pricing === "price" ? request.price : undefined,
      updateTimestamp: undefined,
    };
    return closed;
  }
}

export interface StackOptions {
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
}

export interface Stack {
  readonly feed: MockExchangeFeed;
  readonly positionManager: PositionManager;
  readonly orderManager: OrderManager;
  readonly riskBudget: RiskBudgetAllocator;
  readonly correlation: CorrelationMatrix;
  readonly portfolioStop: PortfolioStop;
  readonly portfolioManager: PortfolioManager;
}

export function makeStack(options: StackOptions = {}): Stack {
  const feed =
    options.feed ??
    new MockExchangeFeed({
      balances: options.balances ?? [{ currency: "USDC", free: 1_000_000, total: 1_000_000 }],
      ...(options.positions !== undefined && { positions: options.positions }),
      ...(options.marketMeta !== undefined && { marketMeta: options.marketMeta }),
    });
  // The mock feed must be opened before placeOrder / fetchBalances.
  // The `Bot` does this in init() — in the test we replicate it.
  const positionManager = new PositionManager({
    initialEquityUsd: 100_000,
    maxPositions: 5,
    maxLeverage: 10,
  });
  const orderManager = new OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
  });
  const riskBudget = new RiskBudgetAllocator({
    totalRiskUsd: options.totalRiskUsd ?? 1000,
    correlationPenaltyThreshold: options.threshold ?? 0.7,
  });
  const correlation = new CorrelationMatrix({ windowSize: 30 });
  const portfolioStop = new PortfolioStop({ maxDdPct: options.maxDdPct ?? 0.1 });
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
    ...(options.logger !== undefined && { logger: options.logger }),
    ...(options.terminalCloseEvidenceLimit !== undefined && {
      terminalCloseEvidenceLimit: options.terminalCloseEvidenceLimit,
    }),
  });
  // Open the feed synchronously (Bun's microtask handling).
  void feed.open();
  return { feed, positionManager, orderManager, riskBudget, correlation, portfolioStop, portfolioManager };
}

export function registerStrategies(stack: Stack, configs: readonly (readonly [string, number])[]): void {
  for (const [id, weight] of configs) {
    const config: StrategyRiskConfig = { strategyId: id, weight, riskPerTrade: 0.01 };
    stack.portfolioManager.setStrategyConfig(config);
  }
}
