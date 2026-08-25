import {
  asSymbol,
  type Balance,
  type ExchangePosition,
  type Execution,
  type MarketMeta,
  type Order,
  type Symbol as ExchangeSymbol,
} from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/shared";

import { OrderManager } from "../../../src/bot/order-manager.js";
import { PositionManager } from "../../../src/bot/position-manager.js";
import { CorrelationMatrix } from "../../../src/portfolio/correlation.js";
import { PortfolioManager } from "../../../src/portfolio/portfolio-manager.js";
import { PortfolioStop } from "../../../src/portfolio/portfolio-stop.js";
import { RiskBudgetAllocator } from "../../../src/portfolio/risk-budget.js";

import { MockExchangeFeed, quietLogger } from "./runtime-driver-core.js";

export function makePortfolioSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC");
}

export function makePortfolioMarketMeta(isSpot: boolean, minCost = 1): MarketMeta {
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

export function makeRemotePosition(side: "long" | "short" = "long", quantity = 0.01): ExchangePosition {
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

export function firstOrder(orders: readonly Order[], label: string): Order {
  const order = orders[0];
  if (order === undefined) throw new Error(`${label}: expected an order`);
  return order;
}

export class SequencedFillFeed extends MockExchangeFeed {
  public readonly placedOrders: Order[] = [];

  public constructor(
    private readonly fillFractions: number[],
    options: ConstructorParameters<typeof MockExchangeFeed>[0],
  ) {
    super(options);
  }

  public override async placeOrder(request: Parameters<MockExchangeFeed["placeOrder"]>[0]): Promise<Order> {
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

export class FailOnceCancelFeed extends MockExchangeFeed {
  private failNextCancel = true;

  public override async cancelOrder(
    clientOrderId: Parameters<MockExchangeFeed["cancelOrder"]>[0],
    symbol: Parameters<MockExchangeFeed["cancelOrder"]>[1],
  ): Promise<Order> {
    if (this.failNextCancel) {
      this.failNextCancel = false;
      throw new Error("injected cancel failure");
    }
    return super.cancelOrder(clientOrderId, symbol);
  }
}

export class AutoFlattenFeed extends MockExchangeFeed {
  public readonly placedOrders: Order[] = [];

  public override async placeOrder(request: Parameters<MockExchangeFeed["placeOrder"]>[0]): Promise<Order> {
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

export class ImmediateFillFeed extends MockExchangeFeed {
  public constructor(private readonly pricing: "average" | "price" | "position") {
    super();
  }

  public override async placeOrder(request: Parameters<MockExchangeFeed["placeOrder"]>[0]): Promise<Order> {
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

export interface PortfolioStackOptions {
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

export interface PortfolioStack {
  readonly feed: MockExchangeFeed;
  readonly positionManager: PositionManager;
  readonly orderManager: OrderManager;
  readonly correlation: CorrelationMatrix;
  readonly portfolioStop: PortfolioStop;
  readonly portfolioManager: PortfolioManager;
}

export async function makePortfolioStack(options: PortfolioStackOptions = {}): Promise<PortfolioStack> {
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

export function registerPortfolioStrategies(
  stack: PortfolioStack,
  configs: readonly (readonly [string, number])[],
): void {
  for (const [strategyId, weight] of configs) {
    stack.portfolioManager.setStrategyConfig({ strategyId, weight, riskPerTrade: 0.01 });
  }
}

export function makeExecution(order: Order, id: string, quantity: number, price = 59_900): Execution {
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
