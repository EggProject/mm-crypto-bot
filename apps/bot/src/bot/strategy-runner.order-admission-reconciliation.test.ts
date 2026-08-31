import { describe, expect, it } from "vitest";

import {
  type ClientOrderId,
  type ExchangeFeed,
  type Execution,
  type FeedListener,
  type Order,
  type SubscriptionId,
} from "@mm-crypto-bot/exchange";
import { RecordingLogger } from "@logging-testing";
import { MockExchangeFeed as ExchangeMockFeed } from "@exchange-testing/mockFeed.js";

import { CorrelationMatrix } from "../portfolio/correlation.js";
import { PortfolioManager } from "../portfolio/portfolio-manager.js";
import { PortfolioStop } from "../portfolio/portfolio-stop.js";
import { RiskBudgetAllocator } from "../portfolio/risk-budget.js";
import type { OrderIntent } from "./order-manager.js";
import * as testSupport from "./strategy-runner.test-support.js";

const strategyName = "donchian_pivot_composition" as const;
const symbol = testSupport.makeSymbol();

interface OrderInspectableFeed extends ExchangeFeed {
  getOrder(clientOrderId: ClientOrderId): Order | undefined;
  setOrderStatus(clientOrderId: ClientOrderId, patch: Partial<Order>): void;
}

class PrivateLifecycleFeed extends ExchangeMockFeed {
  private orderListener: FeedListener | undefined;
  private executionListener: FeedListener | undefined;

  public subscribeOrderUpdates(listener: FeedListener): Promise<SubscriptionId> {
    this.orderListener = listener;
    return Promise.resolve(9001);
  }

  public subscribeExecutions(listener: FeedListener): Promise<SubscriptionId> {
    this.executionListener = listener;
    return Promise.resolve(9002);
  }

  public override async unsubscribe(id: SubscriptionId): Promise<void> {
    await super.unsubscribe(id);
    if (id === 9001) this.orderListener = undefined;
    else if (id === 9002) this.executionListener = undefined;
  }

  public emitOrder(order: Order): void {
    this.orderListener?.({ kind: "order", payload: order });
  }

  public emitExecution(execution: Execution): void {
    this.executionListener?.({ kind: "execution", payload: execution });
  }
}

class CapturingOrderManager extends testSupport.OrderManager {
  public readonly placedIntents: OrderIntent[] = [];

  public override async placeOrder(intent: OrderIntent): Promise<Order> {
    this.placedIntents.push(intent);
    return super.placeOrder(intent);
  }
}

function createPortfolioManager(
  orderManager: testSupport.OrderManager,
  positionManager: testSupport.PositionManager,
): PortfolioManager {
  const logger = new RecordingLogger();
  return new PortfolioManager({
    riskBudget: new RiskBudgetAllocator({ totalRiskUsd: 50, logger }),
    correlation: new CorrelationMatrix({ logger }),
    portfolioStop: new PortfolioStop({ maxDdPct: 0.1, logger }),
    positionManager,
    orderManager,
    logger: new RecordingLogger(),
  });
}

function createLiveRunner(
  feed: OrderInspectableFeed,
  options: {
    readonly portfolioManager?: PortfolioManager;
    readonly sizingAmount?: number;
  } = {},
): {
  readonly orderManager: CapturingOrderManager;
  readonly positionManager: testSupport.PositionManager;
  readonly runner: testSupport.StrategyRunner;
} {
  const positionManager = new testSupport.PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
  });
  const orderManager = new CapturingOrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
  });
  const strategy = new testSupport.FixedSignalStrategy({
    side: "buy",
    confidence: 1,
    reason: "order-admission-reconciliation",
    stopLoss: 0,
    takeProfit: 0,
  });
  const runner = new testSupport.StrategyRunner({
    instances: testSupport.strategyInstances([
      [strategyName, { kind: "strategy", name: strategyName, instance: strategy }],
    ]),
    orderManager,
    positionManager,
    sizingFn: () => options.sizingAmount ?? 1,
    enabledSymbols: [symbol],
    maxLeverage: 10,
    ...(options.portfolioManager !== undefined && { portfolioManager: options.portfolioManager }),
  });
  return { orderManager, positionManager, runner };
}

function candle(timestamp: number): Parameters<testSupport.StrategyRunner["onFeedEvent"]>[0] {
  return {
    kind: "ohlcv",
    payload: { symbol, timeframe: "15m", candle: [timestamp, 100, 101, 99, 100, 1] },
  };
}

function ticker(timestamp: number): Parameters<testSupport.StrategyRunner["onFeedEvent"]>[0] {
  return {
    kind: "ticker",
    payload: {
      symbol,
      timestamp,
      bid: 99,
      ask: 101,
      last: 100,
      baseVolume: 1,
      quoteVolume: 100,
    },
  };
}

function requireOrder(feed: OrderInspectableFeed, clientOrderId: ClientOrderId): Order {
  const order = feed.getOrder(clientOrderId);
  if (order === undefined) throw new Error("expected submitted order");
  return order;
}

describe("StrategyRunner order admission and reconciliation", () => {
  it("scales an admissible entry to the configured portfolio budget and blocks a missing budget", async () => {
    const cappedFeed = new testSupport.MockExchangeFeed();
    const zeroBudgetFeed = new testSupport.MockExchangeFeed();
    let cappedStack: ReturnType<typeof createLiveRunner> | undefined;
    let cappedRunner: testSupport.StrategyRunner | undefined;
    let zeroBudgetStack: ReturnType<typeof createLiveRunner> | undefined;
    let zeroBudgetRunner: testSupport.StrategyRunner | undefined;
    try {
      await cappedFeed.open();
      cappedStack = createLiveRunner(cappedFeed);
      const cappedPortfolio = createPortfolioManager(cappedStack.orderManager, cappedStack.positionManager);
      cappedPortfolio.setStrategyConfig({ strategyId: strategyName, weight: 1, riskPerTrade: 0.01 });
      cappedRunner = new testSupport.StrategyRunner({
        instances: testSupport.strategyInstances([
          [
            strategyName,
            {
              kind: "strategy",
              name: strategyName,
              instance: new testSupport.FixedSignalStrategy({
                side: "buy",
                confidence: 1,
                reason: "budget-cap",
                stopLoss: 0,
                takeProfit: 0,
              }),
            },
          ],
        ]),
        orderManager: cappedStack.orderManager,
        positionManager: cappedStack.positionManager,
        sizingFn: () => 1,
        enabledSymbols: [symbol],
        maxLeverage: 10,
        portfolioManager: cappedPortfolio,
      });
      await cappedRunner.onFeedEvent(candle(1));
      const cappedId = cappedStack.orderManager.getInFlightOrderIds().at(0);
      if (cappedId === undefined) throw new Error("expected budget-capped order");
      expect(requireOrder(cappedFeed, cappedId).amount).toBe(0.5);
      expect(cappedStack.orderManager.placedIntents.at(0)?.leverage).toBe(10);

      await zeroBudgetFeed.open();
      zeroBudgetStack = createLiveRunner(zeroBudgetFeed);
      const zeroBudgetPortfolio = createPortfolioManager(
        zeroBudgetStack.orderManager,
        zeroBudgetStack.positionManager,
      );
      zeroBudgetRunner = new testSupport.StrategyRunner({
        instances: testSupport.strategyInstances([
          [
            strategyName,
            {
              kind: "strategy",
              name: strategyName,
              instance: new testSupport.FixedSignalStrategy({
                side: "buy",
                confidence: 1,
                reason: "zero-budget",
                stopLoss: 0,
                takeProfit: 0,
              }),
            },
          ],
        ]),
        orderManager: zeroBudgetStack.orderManager,
        positionManager: zeroBudgetStack.positionManager,
        sizingFn: () => 1,
        enabledSymbols: [symbol],
        maxLeverage: 10,
        portfolioManager: zeroBudgetPortfolio,
      });
      await zeroBudgetRunner.onFeedEvent(candle(2));
      expect(zeroBudgetStack.orderManager.getCounters().placed).toBe(0);
      expect(zeroBudgetRunner.getStats().totalSignals).toBe(1);
    } finally {
      cappedRunner?.dispose();
      cappedStack?.runner.dispose();
      zeroBudgetRunner?.dispose();
      zeroBudgetStack?.runner.dispose();
      await cappedStack?.orderManager.stopLifecycle();
      await zeroBudgetStack?.orderManager.stopLifecycle();
      await cappedFeed.close();
      await zeroBudgetFeed.close();
    }
  });

  it("rejects a signal after the public portfolio stop latches", async () => {
    const feed = new testSupport.MockExchangeFeed();
    let stack: ReturnType<typeof createLiveRunner> | undefined;
    let runner: testSupport.StrategyRunner | undefined;
    try {
      await feed.open();
      stack = createLiveRunner(feed);
      const portfolio = createPortfolioManager(stack.orderManager, stack.positionManager);
      portfolio.recordEquity(100);
      portfolio.recordEquity(80);
      runner = new testSupport.StrategyRunner({
        instances: testSupport.strategyInstances([
          [
            strategyName,
            {
              kind: "strategy",
              name: strategyName,
              instance: new testSupport.FixedSignalStrategy({
                side: "buy",
                confidence: 1,
                reason: "portfolio-stop",
                stopLoss: 0,
                takeProfit: 0,
              }),
            },
          ],
        ]),
        orderManager: stack.orderManager,
        positionManager: stack.positionManager,
        sizingFn: () => 1,
        enabledSymbols: [symbol],
        maxLeverage: 10,
        portfolioManager: portfolio,
      });
      await runner.onFeedEvent(candle(3));
      expect(portfolio.isTripped()).toBe(true);
      expect(stack.orderManager.getCounters().placed).toBe(0);
      expect(runner.getStats().totalSignals).toBe(1);
    } finally {
      runner?.dispose();
      stack?.runner.dispose();
      await stack?.orderManager.stopLifecycle();
      await feed.close();
    }
  });

  it("reconciles cumulative REST evidence through partial and canceled entry states", async () => {
    const feed = new testSupport.MockExchangeFeed();
    let stack: ReturnType<typeof createLiveRunner> | undefined;
    try {
      await feed.open();
      stack = createLiveRunner(feed);
      await stack.runner.onFeedEvent(candle(4));
      const clientOrderId = stack.orderManager.getInFlightOrderIds().at(0);
      if (clientOrderId === undefined) throw new Error("expected open entry");
      expect(stack.orderManager.placedIntents.at(0)?.leverage).toBe(10);
      feed.setOrderStatus(clientOrderId, { status: "open", filled: 0.5, average: 101 });
      await stack.runner.onFeedEvent(ticker(5));
      expect(stack.positionManager.getPosition(strategyName, symbol, "long")?.quantity).toBe(0.5);
      expect(stack.orderManager.getInFlightCount()).toBe(1);

      feed.setOrderStatus(clientOrderId, { status: "canceled", filled: 0.5, average: 101 });
      await stack.runner.onFeedEvent(ticker(6));
      expect(stack.positionManager.getPosition(strategyName, symbol, "long")?.quantity).toBe(0.5);
      expect(stack.orderManager.getInFlightCount()).toBe(0);
    } finally {
      stack?.runner.dispose();
      await stack?.orderManager.stopLifecycle();
      await feed.close();
    }
  });

  it("correlates private execution by exchange identifier, ignores unknown evidence, and settles terminal order evidence", async () => {
    const feed = new PrivateLifecycleFeed();
    let stack: ReturnType<typeof createLiveRunner> | undefined;
    try {
      await feed.open();
      stack = createLiveRunner(feed);
      await stack.orderManager.startLifecycle();
      await stack.runner.onFeedEvent(candle(7));
      const clientOrderId = stack.orderManager.getInFlightOrderIds().at(0);
      if (clientOrderId === undefined) throw new Error("expected identified entry");
      expect(stack.orderManager.placedIntents.at(0)?.leverage).toBe(10);
      const openOrder = requireOrder(feed, clientOrderId);
      if (openOrder.exchangeId === undefined) throw new Error("expected exchange identifier");

      const unknownExecution: Execution = {
        executionId: "unknown-entry",
        clientOrderId: undefined,
        exchangeOrderId: undefined,
        symbol,
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 8,
      };
      feed.emitExecution(unknownExecution);
      feed.emitOrder({ ...openOrder, status: "open", filled: 0, updateTimestamp: 8 });
      await testSupport.flushPrivateLifecycle();
      expect(stack.positionManager.getPositionCount()).toBe(0);

      const partialExecution: Execution = {
        executionId: "exchange-correlated-entry",
        clientOrderId: undefined,
        exchangeOrderId: openOrder.exchangeId,
        symbol,
        side: "buy",
        quantity: 0.5,
        price: 101,
        fee: 0,
        feeCurrency: "USDC",
        timestamp: 9,
      };
      feed.emitExecution(partialExecution);
      await testSupport.flushPrivateLifecycle();
      expect(stack.positionManager.getPosition(strategyName, symbol, "long")?.quantity).toBe(0.5);

      feed.emitOrder({ ...openOrder, status: "closed", filled: 1, average: 102, updateTimestamp: 10 });
      await testSupport.flushPrivateLifecycle();
      expect(stack.positionManager.getPosition(strategyName, symbol, "long")?.quantity).toBe(1);
      expect(stack.orderManager.getInFlightCount()).toBe(0);
    } finally {
      stack?.runner.dispose();
      await stack?.orderManager.stopLifecycle();
      await feed.close();
    }
  });
});
