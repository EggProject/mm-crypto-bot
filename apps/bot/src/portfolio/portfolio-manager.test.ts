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

import { describe, expect, it } from "bun:test";
import { asSymbol, type Balance, type ClientOrderId, type ExchangePosition, type Execution, type FeedEvent, type FeedListener, type MarketMeta, type Order, type OrderRequest, type SubscriptionId, type Symbol as ExchangeSymbol, type Ticker } from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/shared";
// Phase 66: `MockExchangeFeed` is test-only — import from the
// `@exchange-testing/*` path alias (see tsconfig.base.json).
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

import { OrderManager } from "../bot/order-manager.js";
import { PositionManager } from "../bot/position-manager.js";
import { CorrelationMatrix } from "./correlation.js";
import { PortfolioManager } from "./portfolio-manager.js";
import { PortfolioStop } from "./portfolio-stop.js";
import { RiskBudgetAllocator } from "./risk-budget.js";
import type { StrategyRiskConfig } from "./risk-budget.js";

function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
}

function makeMarketMeta(isSpot: boolean, minCost = 1): MarketMeta {
  const symbol = makeSymbol();
  return { symbol, base: "BTC", quote: "USDC", amountPrecision: 4, pricePrecision: 2, minAmount: 0.0001, minCost, isSpot };
}

function makeRemotePosition(side: "long" | "short" = "long", quantity = 0.01): ExchangePosition {
  return { symbol: makeSymbol(), side, quantity, entryPrice: 60_000, markPrice: 59_900, unrealizedPnl: -1, updateTimestamp: Date.now() };
}

function requirePlacedOrder(orders: readonly Order[]): Order {
  const order = orders[0];
  if (order === undefined) throw new Error("expected a placed order");
  return order;
}

class SequencedFillFeed extends MockExchangeFeed {
  public constructor(private readonly fillFractions: number[], opts: ConstructorParameters<typeof MockExchangeFeed>[0]) {
    super(opts);
  }

  public override async placeOrder(req: OrderRequest): Promise<Order> {
    const order = await super.placeOrder(req);
    const fraction = this.fillFractions.shift() ?? 1;
    const filled = req.amount * fraction;
    this.setOrderStatus(order.clientOrderId, { status: "closed", filled, average: req.price });
    return this.getOrder(order.clientOrderId)!;
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
  public marketMetaFailures: unknown[] = [];
  public positionFailures: unknown[] = [];
  public balanceFailures: unknown[] = [];
  public placeFailures: unknown[] = [];
  public orderFailures: unknown[] = [];
  public tickerFailures: unknown[] = [];
  public positionFailureOnCall: { readonly call: number; readonly failure: unknown } | undefined;
  public balanceFailureOnCall: { readonly call: number; readonly failure: unknown } | undefined;
  public readonly placedOrders: Order[] = [];
  private positionCalls = 0;
  private balanceCalls = 0;

  private throwNext(failures: unknown[]): void {
    if (failures.length > 0) throw failures.shift();
  }

  public override async fetchMarketMeta(symbol: ExchangeSymbol): Promise<MarketMeta> {
    this.throwNext(this.marketMetaFailures);
    return super.fetchMarketMeta(symbol);
  }

  public override async fetchPositions(symbols?: readonly ExchangeSymbol[]): Promise<readonly ExchangePosition[]> {
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

  public async subscribeOrderUpdates(listener: FeedListener): Promise<SubscriptionId> {
    return this.addLifecycleListener(listener);
  }

  public async subscribeExecutions(listener: FeedListener): Promise<SubscriptionId> {
    return this.addLifecycleListener(listener);
  }

  public override async unsubscribe(id: SubscriptionId): Promise<void> {
    if (!this.lifecycleListeners.delete(id)) await super.unsubscribe(id);
  }

  public emitLifecycle(event: FeedEvent): void {
    for (const listener of this.lifecycleListeners.values()) listener(event);
  }

  private addLifecycleListener(listener: FeedListener): SubscriptionId {
    const id = this.nextLifecycleId as unknown as SubscriptionId;
    this.nextLifecycleId += 1;
    this.lifecycleListeners.set(id, listener);
    return id;
  }
}

class AutoFlattenFeed extends MockExchangeFeed {
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

class ImmediateFillFeed extends MockExchangeFeed {
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

interface StackOptions {
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

interface Stack {
  readonly feed: MockExchangeFeed;
  readonly positionManager: PositionManager;
  readonly orderManager: OrderManager;
  readonly riskBudget: RiskBudgetAllocator;
  readonly correlation: CorrelationMatrix;
  readonly portfolioStop: PortfolioStop;
  readonly portfolioManager: PortfolioManager;
}

function makeStack(opts: StackOptions = {}): Stack {
  const feed = opts.feed ?? new MockExchangeFeed({
    balances: opts.balances ?? [{ currency: "USDC", free: 1_000_000, total: 1_000_000 }],
    positions: opts.positions,
    marketMeta: opts.marketMeta,
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
    totalRiskUsd: opts.totalRiskUsd ?? 1000,
    correlationPenaltyThreshold: opts.threshold ?? 0.7,
  });
  const correlation = new CorrelationMatrix({ windowSize: 30 });
  const portfolioStop = new PortfolioStop({ maxDdPct: opts.maxDdPct ?? 0.10 });
  const portfolioManager = new PortfolioManager({
    riskBudget,
    correlation,
    portfolioStop,
    positionManager,
    orderManager,
    requireAuthoritativeEmergencyState: opts.requireAuthoritativeEmergencyState,
    configuredSymbols: opts.configuredSymbols,
    logger: opts.logger,
    terminalCloseEvidenceLimit: opts.terminalCloseEvidenceLimit,
  });
  // Open the feed synchronously (Bun's microtask handling).
  void feed.open();
  return { feed, positionManager, orderManager, riskBudget, correlation, portfolioStop, portfolioManager };
}

function registerStrategies(stack: Stack, configs: readonly (readonly [string, number])[]): void {
  for (const [id, weight] of configs) {
    const cfg: StrategyRiskConfig = { strategyId: id, weight, riskPerTrade: 0.01 };
    stack.portfolioManager.setStrategyConfig(cfg);
  }
}

describe("PortfolioManager", () => {
  // ---------------------------------------------------------------------------
  // 1) Basic wiring
  // ---------------------------------------------------------------------------
  describe("basic wiring", () => {
    it("constructs and wires the trip action to executeCloseAll", () => {
      const stack = makeStack();
      expect(stack.portfolioManager.isTripped()).toBe(false);
      expect(stack.portfolioManager.getPerStrategyBudget().size).toBe(0);
    });

    it("exposes per-strategy budget from the risk allocator", () => {
      const stack = makeStack({ totalRiskUsd: 1000 });
      registerStrategies(stack, [
        ["carry", 0.5],
        ["ohlc", 0.5],
      ]);
      const budget = stack.portfolioManager.getPerStrategyBudget();
      expect(budget.size).toBe(2);
      expect(budget.get("carry")).toBeCloseTo(500, 5);
      expect(budget.get("ohlc")).toBeCloseTo(500, 5);
    });

    it("getBudgetFor returns 0 for unknown strategy", () => {
      const stack = makeStack();
      expect(stack.portfolioManager.getBudgetFor("unknown")).toBe(0);
    });

    it("exposes correlation matrix from the correlation module", () => {
      const stack = makeStack();
      stack.correlation.recordFill("a", 0.01);
      stack.correlation.recordFill("a", 0.02);
      stack.correlation.recordFill("b", 0.02);
      stack.correlation.recordFill("b", 0.01);
      const snap = stack.portfolioManager.getCorrelationMatrix();
      expect(snap.sampleCounts.get("a")).toBe(2);
      expect(snap.sampleCounts.get("b")).toBe(2);
    });

    it("exposes portfolio stop state", () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      stack.portfolioManager.recordEquity(10_000);
      const state = stack.portfolioManager.getStopState();
      expect(state.peakEquityUsd).toBe(10_000);
      expect(state.drawdownPct).toBe(0);
      expect(state.tripped).toBe(false);
    });

    it("getPortfolioState returns the aggregated state", () => {
      const stack = makeStack();
      registerStrategies(stack, [["a", 1]]);
      const portfolio = stack.portfolioManager.getPortfolioState();
      expect(portfolio.isTripped).toBe(false);
      expect(portfolio.perStrategyBudgetUsd.size).toBe(1);
      expect(portfolio.budgetBreakdowns.size).toBe(1);
      expect(portfolio.strategyRiskConfigs.size).toBe(1);
      expect(portfolio.correlation.windowSize).toBe(30);
    });
  });

  // ---------------------------------------------------------------------------
  // 2) Strategy config management
  // ---------------------------------------------------------------------------
  describe("strategy config", () => {
    it("setStrategyConfig registers a strategy", () => {
      const stack = makeStack();
      stack.portfolioManager.setStrategyConfig({ strategyId: "x", weight: 0.3, riskPerTrade: 0.01 });
      expect(stack.portfolioManager.getStrategyConfigs().size).toBe(1);
    });

    it("setStrategyConfig overwrites an existing entry", () => {
      const stack = makeStack();
      stack.portfolioManager.setStrategyConfig({ strategyId: "x", weight: 0.3, riskPerTrade: 0.01 });
      stack.portfolioManager.setStrategyConfig({ strategyId: "x", weight: 0.7, riskPerTrade: 0.01 });
      const cfgs = stack.portfolioManager.getStrategyConfigs();
      expect(cfgs.size).toBe(1);
      expect(cfgs.get("x")?.weight).toBe(0.7);
    });

    it("removeStrategyConfig removes and forgets correlation", () => {
      const stack = makeStack();
      stack.portfolioManager.setStrategyConfig({ strategyId: "x", weight: 0.5, riskPerTrade: 0.01 });
      stack.correlation.recordFill("x", 0.01);
      expect(stack.correlation.getSampleCount("x")).toBe(1);
      stack.portfolioManager.removeStrategyConfig("x");
      expect(stack.portfolioManager.getStrategyConfigs().size).toBe(0);
      expect(stack.correlation.getSampleCount("x")).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3) recordFill updates correlation + re-computes budgets
  // ---------------------------------------------------------------------------
  describe("recordFill", () => {
    it("appends to correlation stream", () => {
      const stack = makeStack();
      stack.portfolioManager.recordFill({ strategyId: "a", returnPct: 0.01 });
      expect(stack.correlation.getSampleCount("a")).toBe(1);
    });

    it("triggers a budget re-compute (new correlation → new penalty)", () => {
      const stack = makeStack({ totalRiskUsd: 1000, threshold: 0.5 });
      registerStrategies(stack, [
        ["a", 0.5],
        ["b", 0.5],
      ]);
      // No correlation yet → both get 500
      expect(stack.portfolioManager.getBudgetFor("a")).toBeCloseTo(500, 5);
      // Build high correlation via 20 identical pairs
      for (let i = 0; i < 20; i++) {
        stack.portfolioManager.recordFill({ strategyId: "a", returnPct: i * 0.001 });
        stack.portfolioManager.recordFill({ strategyId: "b", returnPct: i * 0.001 });
      }
      // Now correlation is ~1, threshold 0.5 → penalty 1 → budget 0
      const aBudget = stack.portfolioManager.getBudgetFor("a");
      const bBudget = stack.portfolioManager.getBudgetFor("b");
      expect(aBudget).toBeLessThan(500);
      expect(bBudget).toBeLessThan(500);
    });
  });

  // ---------------------------------------------------------------------------
  // 4) recordEquity updates the per-strategy contribution
  // ---------------------------------------------------------------------------
  describe("recordEquity", () => {
    it("updates the portfolio stop's high-water mark", () => {
      const stack = makeStack();
      stack.portfolioManager.recordEquity(10_000);
      expect(stack.portfolioStop.getPeakEquity()).toBe(10_000);
    });

    it("does NOT trip on a normal drawdown", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      stack.portfolioManager.recordEquity(10_000);
      await stack.portfolioManager.recordEquityAndSettle(9_500);
      expect(stack.portfolioManager.isTripped()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5) SAFETY-CRITICAL: close-all on trip
  // ---------------------------------------------------------------------------
  describe("close-all on trip", () => {
    it("journals one delayed close through partial and final private executions without ticker retries", async () => {
      const stack = makeStack();
      const symbol = makeSymbol();
      stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);
      const first = await stack.portfolioManager.executeCloseAll();
      expect(first.unresolved).toContain("carry/BTC/USDC/long");
      const close = [...stack.feed["orderBook"].values()].find((order: Order) => order.clientOrderId.startsWith("pf-stop-"))!;
      const dispatch = (execution: Execution): void => {
        (stack.orderManager as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void })
          .handleLifecycleFeedEvent({ kind: "execution", payload: execution });
      };
      const makeExecution = (id: string, quantity: number): Execution => ({
        executionId: id, clientOrderId: close.clientOrderId, exchangeOrderId: close.exchangeId,
        symbol, side: "sell", quantity, price: 59_900, fee: 0.01, feeCurrency: "USDC", timestamp: Date.now(),
      });
      dispatch(makeExecution("close-partial", 0.004));
      dispatch(makeExecution("close-partial", 0.004)); // duplicate is ignored
      expect(stack.positionManager.getPositions()[0]?.quantity).toBeCloseTo(0.006);
      dispatch(makeExecution("close-final", 0.006));
      expect(stack.positionManager.getPositionCount()).toBe(0);
      const settled = await stack.portfolioManager.executeCloseAll();
      expect(settled.unresolved).toHaveLength(0);
      expect([...stack.feed["orderBook"].values()].filter((order: Order) => order.clientOrderId.startsWith("pf-stop-"))).toHaveLength(1);
    });

    it("deduplicates repeated close intents and retries only the remainder after terminal cancel", async () => {
      const stack = makeStack();
      const symbol = makeSymbol();
      const position = stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);
      expect(await stack.portfolioManager.requestPositionClose(position, "trailing-stop")).toBe(false);
      expect(await stack.portfolioManager.requestPositionClose(position, "trailing-stop")).toBe(false);
      let closes = [...stack.feed["orderBook"].values()].filter((order: Order) => order.clientOrderId.startsWith("pf-stop-"));
      expect(closes).toHaveLength(1);
      stack.feed.setOrderStatus(closes[0]!.clientOrderId, { status: "canceled", filled: 0 });
      expect(await stack.portfolioManager.requestPositionClose(position, "trailing-stop-retry")).toBe(false);
      closes = [...stack.feed["orderBook"].values()].filter((order: Order) => order.clientOrderId.startsWith("pf-stop-"));
      expect(closes).toHaveLength(2);
      expect(closes[1]?.amount).toBe(0.01);

      // A late execution for the terminal-canceled first order is still
      // attributed, and the replacement is canceled before retrying only the remainder.
      (stack.orderManager as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }).handleLifecycleFeedEvent({
        kind: "execution",
        payload: {
          executionId: "late-after-cancel", clientOrderId: closes[0]!.clientOrderId, exchangeOrderId: closes[0]!.exchangeId,
          symbol, side: "sell", quantity: 0.004, price: 59_900, fee: 0.01, feeCurrency: "USDC", timestamp: Date.now(),
        },
      });
      await Promise.resolve();
      expect(stack.positionManager.getPositions()[0]?.quantity).toBeCloseTo(0.006);
      expect(stack.feed.getOrder(closes[1]!.clientOrderId)?.status).toBe("canceled");
      expect(await stack.portfolioManager.requestPositionClose(stack.positionManager.getPositions()[0]!, "late-fill-retry")).toBe(false);
      closes = [...stack.feed["orderBook"].values()].filter((order: Order) => order.clientOrderId.startsWith("pf-stop-"));
      expect(closes).toHaveLength(3);
      expect(closes[2]?.amount).toBeCloseTo(0.006);
    });

    it("records a late terminal fill and reports when its replacement cancel fails", async () => {
      const errors: { readonly msg: string; readonly meta?: Readonly<Record<string, unknown>> }[] = [];
      const logger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (msg, meta) => { errors.push({ msg, meta }); },
      };
      const feed = new FailOnceCancelFeed();
      const stack = makeStack({ feed, logger });
      await feed.open();
      const symbol = makeSymbol();
      const position = stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);

      await stack.portfolioManager.requestPositionClose(position, "trailing-stop");
      let closes = [...feed["orderBook"].values()].filter((order: Order) => order.clientOrderId.startsWith("pf-stop-"));
      feed.setOrderStatus(closes[0]!.clientOrderId, { status: "canceled", filled: 0 });
      await stack.portfolioManager.requestPositionClose(position, "trailing-stop-retry");
      closes = [...feed["orderBook"].values()].filter((order: Order) => order.clientOrderId.startsWith("pf-stop-"));
      const replacement = closes[1]!;

      (stack.orderManager as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }).handleLifecycleFeedEvent({
        kind: "execution",
        payload: {
          executionId: "late-cancel-failure", clientOrderId: closes[0]!.clientOrderId, exchangeOrderId: closes[0]!.exchangeId,
          symbol, side: "sell", quantity: 0.004, price: 59_900, fee: 0.01, feeCurrency: "USDC", timestamp: Date.now(),
        },
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(stack.positionManager.getPositions()[0]?.quantity).toBeCloseTo(0.006);
      expect(feed.getOrder(replacement.clientOrderId)?.status).toBe("open");
      expect(errors).toEqual([{
        msg: "[portfolio-manager] late terminal fill replacement cancel failed",
        meta: {
          key: `local:${position.id}`,
          clientOrderId: replacement.clientOrderId,
          error: `[order-manager] cancelOrder failed for ${replacement.clientOrderId} on ${String(symbol)}: injected cancel failure`,
        },
      }]);
    });

    it("quarantines a stale local position absent from the authoritative venue without placing a close", async () => {
      const stack = makeStack({ requireAuthoritativeEmergencyState: true });
      stack.positionManager.openPosition("carry", makeSymbol(), "long", 0.01, 60_000, 10);
      const report = await stack.portfolioManager.executeCloseAll();
      expect(report.closed).toHaveLength(0);
      expect(report.unresolved).toHaveLength(0);
      expect(stack.positionManager.getPositionCount()).toBe(0);
      expect(stack.orderManager.getInFlightCount()).toBe(0);
    });

    it("submits a balance-derived sell for venue-only spot inventory", async () => {
      const stack = makeStack({
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: ["BTC/USDC"],
        balances: [
          { currency: "USDC", free: 1_000_000, total: 1_000_000 },
          { currency: "BTC", free: 0.02, total: 0.02 },
        ],
      });
      const report = await stack.portfolioManager.executeCloseAll();
      const order = [...stack.feed["orderBook"].values()].find((candidate: Order) => candidate.clientOrderId.startsWith("venue-spot-emergency"));
      expect(order?.side).toBe("sell");
      expect(order?.amount).toBe(0.02);
      expect(report.unresolved).toContain("venue/BTC/USDC/spot");
    });

    it("uses the venue derivative side and size for exposure missing locally", async () => {
      const symbol = makeSymbol();
      const stack = makeStack({
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [String(symbol)],
        positions: [{ symbol, side: "long", quantity: 0.03, entryPrice: 60_000, markPrice: 59_900, unrealizedPnl: -3, updateTimestamp: Date.now() }],
        marketMeta: new Map([[symbol, { symbol, base: "BTC", quote: "USDC", amountPrecision: 4, pricePrecision: 2, minAmount: 0.0001, minCost: 1, isSpot: false }]]),
      });
      await stack.portfolioManager.executeCloseAll();
      const order = [...stack.feed["orderBook"].values()].find((candidate: Order) => candidate.clientOrderId.startsWith("venue-emergency"));
      expect(order?.side).toBe("sell");
      expect(order?.amount).toBe(0.03);
    });

    it("journals venue-only spot and derivative closes across repeated emergency heartbeats", async () => {
      const symbol = makeSymbol();
      for (const kind of ["spot", "derivative"] as const) {
        const meta: MarketMeta = {
          symbol, base: "BTC", quote: "USDC", amountPrecision: 4, pricePrecision: 2,
          minAmount: 0.0001, minCost: 1, isSpot: kind === "spot",
        };
        const feed = new MockExchangeFeed({
          balances: kind === "spot"
            ? [{ currency: "USDC", free: 1_000_000, total: 1_000_000 }, { currency: "BTC", free: 0.02, total: 0.02 }]
            : [{ currency: "USDC", free: 1_000_000, total: 1_000_000 }],
          positions: kind === "derivative"
            ? [{ symbol, side: "long", quantity: 0.02, entryPrice: 60_000, markPrice: 59_900, unrealizedPnl: -2, updateTimestamp: Date.now() }]
            : [],
          marketMeta: new Map([[symbol, meta]]),
        });
        const stack = makeStack({ requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)], feed });
        const first = await stack.portfolioManager.executeCloseAll();
        expect(first.unresolved).toContain("authoritative venue exposure remains open");
        expect(first.unresolved).toContain(kind === "spot" ? "venue/BTC/USDC/spot" : "venue/BTC/USDC/long");
        await stack.portfolioManager.executeCloseAll();
        let closes = [...feed["orderBook"].values()].filter((order: Order) => order.side === "sell");
        expect(closes).toHaveLength(1);
        const close = closes[0]!;
        const dispatch = (id: string, quantity: number): void => {
          (stack.orderManager as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }).handleLifecycleFeedEvent({
            kind: "execution",
            payload: {
              executionId: `${kind}-${id}`, clientOrderId: close.clientOrderId, exchangeOrderId: close.exchangeId,
              symbol, side: "sell", quantity, price: 59_900, fee: 0.01, feeCurrency: "USDC", timestamp: Date.now(),
            },
          });
        };
        dispatch("partial", 0.01);
        if (kind === "spot") feed.setBalance("BTC", 0.01, 0.01);
        else feed.setPositions([{ symbol, side: "long", quantity: 0.01, entryPrice: 60_000, markPrice: 59_900, unrealizedPnl: -1, updateTimestamp: Date.now() }]);
        await stack.portfolioManager.executeCloseAll();
        closes = [...feed["orderBook"].values()].filter((order: Order) => order.side === "sell");
        expect(closes).toHaveLength(1);
        dispatch("final", 0.01);
        if (kind === "spot") feed.setBalance("BTC", 0, 0);
        else feed.setPositions([]);
        const settled = await stack.portfolioManager.executeCloseAll();
        expect(settled.unresolved).toHaveLength(0);
        expect([...feed["orderBook"].values()].filter((order: Order) => order.side === "sell")).toHaveLength(1);
      }
    });

    it("keeps a partial spot close retryable without treating the remainder as venue-only inventory", async () => {
      const symbol = makeSymbol();
      const feed = new SequencedFillFeed([0.5, 1], {
        balances: [{ currency: "USDC", free: 1_000_000, total: 1_000_000 }, { currency: "BTC", free: 0.02, total: 0.02 }],
      });
      const stack = makeStack({ requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)], feed });
      stack.positionManager.openPosition("carry", symbol, "long", 0.02, 60_000, 10);

      const first = await stack.portfolioManager.executeCloseAll();
      const firstCloses = [...feed["orderBook"].values()].filter((order: Order) => order.clientOrderId.startsWith("pf-stop-"));
      expect(first.unresolved).toContain("carry/BTC/USDC/long");
      expect(firstCloses).toHaveLength(1);
      expect(firstCloses[0]?.amount).toBe(0.02);
      expect(stack.positionManager.getPositions()[0]?.quantity).toBe(0.01);

      feed.setBalance("BTC", 0.01, 0.01);
      const second = await stack.portfolioManager.executeCloseAll();
      expect(second.unresolved).toContain("authoritative venue exposure remains open");
      expect(stack.positionManager.getPositionCount()).toBe(0);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);

      feed.setBalance("BTC", 0, 0);
      const settled = await stack.portfolioManager.executeCloseAll();
      expect(settled.unresolved).toHaveLength(0);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(true);
    });

    it("does not latch close-all after a cancellation failure and retries it", async () => {
      const feed = new FailOnceCancelFeed();
      const stack = makeStack({ feed });
      await feed.open();
      await stack.orderManager.placeOrder({
        signal: { side: "buy", confidence: 1, reason: "pending-entry", stopLoss: 0, takeProfit: 0 },
        symbol: makeSymbol(), amount: 0.01, referencePrice: 60_000, type: "market",
      });

      const first = await stack.portfolioManager.executeCloseAll();
      expect(first.unresolved[0]).toContain("cancel");
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);

      const second = await stack.portfolioManager.executeCloseAll();
      expect(second.unresolved).toHaveLength(0);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(true);
    });
    it("places MARKET orders to close all open positions when tripped", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      const sym = makeSymbol();
      // Open 2 positions: 1 long (carry), 1 short (ohlc)
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.positionManager.openPosition("ohlc", sym, "short", 0.01, 60_000, 10);
      expect(stack.positionManager.getPositionCount()).toBe(2);
      // Peak equity: 100k
      stack.portfolioManager.recordEquity(100_000);
      // Drop equity to trip
      await stack.portfolioManager.recordEquityAndSettle(85_000); // DD = 15%
      // The trip should have fired and placed close orders on the mock feed
      const placedOrders = [...stack.feed["orderBook"].values()] as Order[];
      // Filter: only the closing orders (the placeOrder inside executeCloseAll)
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(2);
      // Both should be MARKET orders
      for (const o of closeOrders) {
        expect(o.type).toBe("market");
      }
      // The closing sides should be opposite of the original positions
      const sides = new Set(closeOrders.map((o) => o.side));
      expect(sides.has("buy")).toBe(true); // closes the short
      expect(sides.has("sell")).toBe(true); // closes the long
    });

    it("executeCloseAll is a no-op when no positions are open", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(80_000); // trips
      // No positions were open, so no close orders placed
      const placedOrders = [...stack.feed["orderBook"].values()] as Order[];
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(0);
    });

    it("does not latch close-all after unfilled acknowledgements", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(85_000);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);
    });

    it("close-all is idempotent — does not re-fire", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(85_000);
      // Second trip attempt
      await stack.portfolioManager.recordEquityAndSettle(80_000);
      // Still only 1 close order
      const placedOrders = [...stack.feed["orderBook"].values()] as Order[];
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(1);
    });

    it("executeCloseAll is safe to call manually", async () => {
      const stack = makeStack();
      const sym = makeSymbol();
      stack.positionManager.openPosition("a", sym, "long", 0.01, 60_000, 10);
      await stack.portfolioManager.executeCloseAll();
      const placedOrders = [...stack.feed["orderBook"].values()] as Order[];
      const closeOrders = placedOrders.filter((o) => o.clientOrderId.startsWith("pf-stop-"));
      expect(closeOrders.length).toBe(1);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);
    });

    it("validates the terminal evidence bound", () => {
      expect(() => makeStack({ terminalCloseEvidenceLimit: 0 })).toThrow(RangeError);
      expect(() => makeStack({ terminalCloseEvidenceLimit: 1.5 })).toThrow(RangeError);
    });

    it("reports Error and non-Error authoritative metadata, position, and balance failures", async () => {
      for (const failure of [new Error("authority Error"), "authority string"] as const) {
        const metaFeed = new FaultFeed({ positions: [] });
        metaFeed.marketMetaFailures.push(failure);
        const metaStack = makeStack({ feed: metaFeed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(makeSymbol())] });
        expect((await metaStack.portfolioManager.executeCloseAll()).unresolved.join(" ")).toContain(
          typeof failure === "string" ? failure : failure.message,
        );

        const positionFeed = new FaultFeed({ positions: [], marketMeta: new Map([[makeSymbol(), makeMarketMeta(false)]]) });
        positionFeed.positionFailures.push(failure);
        const positionStack = makeStack({ feed: positionFeed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(makeSymbol())] });
        positionStack.positionManager.openPosition("unavailable", makeSymbol(), "long", 0.01, 60_000, 10);
        expect((await positionStack.portfolioManager.executeCloseAll()).unresolved.join(" ")).toContain("derivative position unavailable");

        const balanceFeed = new FaultFeed({ positions: [] });
        balanceFeed.balanceFailures.push(failure);
        const balanceStack = makeStack({ feed: balanceFeed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(makeSymbol())] });
        expect((await balanceStack.portfolioManager.executeCloseAll()).unresolved.join(" ")).toContain(
          typeof failure === "string" ? failure : failure.message,
        );
      }
    });

    it("reports Error and non-Error failures from authoritative flat verification", async () => {
      for (const failure of [new Error("verification Error"), "verification string"] as const) {
        const feed = new FaultFeed({ positions: [] });
        feed.positionFailureOnCall = { call: 2, failure };
        feed.balanceFailureOnCall = { call: 2, failure };
        const stack = makeStack({ feed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(makeSymbol())] });
        const report = await stack.portfolioManager.executeCloseAll();
        expect(report.unresolved.join(" ")).toContain("authoritative position verification");
        expect(report.unresolved.join(" ")).toContain("authoritative balance verification");
      }
    });

    it("reconciles invalid, unavailable, and stale local authoritative positions", async () => {
      const symbol = makeSymbol();
      const spotMeta = new Map([[symbol, makeMarketMeta(true)]]);

      const invalidSpot = makeStack({
        feed: new FaultFeed({ positions: [], balances: [{ currency: "BTC", free: 0.01, total: 0.01 }], marketMeta: spotMeta }),
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [String(symbol)],
      });
      invalidSpot.positionManager.openPosition("spot", symbol, "short", 0.01, 60_000, 10);
      expect((await invalidSpot.portfolioManager.executeCloseAll()).unresolved.join(" ")).toContain("invalid local spot short removed");

      const unavailableSpotFeed = new FaultFeed({ positions: [], marketMeta: spotMeta });
      unavailableSpotFeed.balanceFailures.push("balances unavailable");
      const unavailableSpot = makeStack({ feed: unavailableSpotFeed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)] });
      unavailableSpot.positionManager.openPosition("spot", symbol, "long", 0.01, 60_000, 10);
      expect((await unavailableSpot.portfolioManager.executeCloseAll()).unresolved.join(" ")).toContain("spot inventory unavailable");

      const staleDerivative = makeStack({
        feed: new FaultFeed({ positions: [], marketMeta: new Map([[symbol, makeMarketMeta(false)]]) }),
        requireAuthoritativeEmergencyState: true,
        configuredSymbols: [String(symbol)],
      });
      staleDerivative.positionManager.openPosition("derivative", symbol, "long", 0.01, 60_000, 10);
      await staleDerivative.portfolioManager.executeCloseAll();
      expect(staleDerivative.positionManager.getPositionCount()).toBe(0);
    });

    it("completes an immediately filled authoritative derivative close", async () => {
      const symbol = makeSymbol();
      const feed = new AutoFlattenFeed({ positions: [makeRemotePosition()], marketMeta: new Map([[symbol, makeMarketMeta(false)]]) });
      const stack = makeStack({ feed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)] });
      stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);
      const report = await stack.portfolioManager.executeCloseAll();
      expect(report.unresolved).toHaveLength(0);
      expect(report.closed).toContain("carry/BTC/USDC/long");
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(true);
    });

    it("settles a local close through REST reconciliation and current-price fallback", async () => {
      const feed = new FaultFeed();
      const stack = makeStack({ feed });
      const position = stack.positionManager.openPosition("carry", makeSymbol(), "long", 0.01, 60_000, 10);
      expect(await stack.portfolioManager.requestPositionClose(position, "manual")).toBe(false);
      const order = requirePlacedOrder(feed.placedOrders);
      feed.setOrderStatus(order.clientOrderId, { status: "closed", filled: 0.01, average: undefined, price: undefined, updateTimestamp: undefined });
      expect(await stack.portfolioManager.requestPositionClose(position, "manual-reconcile")).toBe(true);
      expect(stack.positionManager.getPositionCount()).toBe(0);
    });

    it("settles immediately filled local closes across public price fallbacks", async () => {
      for (const pricing of ["average", "price", "position"] as const) {
        const feed = new ImmediateFillFeed(pricing);
        const stack = makeStack({ feed });
        const side = pricing === "average" ? "short" : "long";
        const position = stack.positionManager.openPosition(pricing, makeSymbol(), side, 0.01, 60_000, 10);
        expect(await stack.portfolioManager.requestPositionClose(position, pricing)).toBe(true);
        expect(stack.positionManager.getPositionCount()).toBe(0);
      }
    });

    it("reports both closed and unresolved local results in one retryable close-all", async () => {
      const feed = new SequencedFillFeed([1, 0], {});
      const stack = makeStack({ feed });
      stack.positionManager.openPosition("closed", makeSymbol(), "long", 0.01, 60_000, 10);
      stack.positionManager.openPosition("unresolved", makeSymbol(), "short", 0.01, 60_000, 10);
      const report = await stack.portfolioManager.executeCloseAll();
      expect(report.closed).toContain("closed/BTC/USDC");
      expect(report.unresolved).toContain("unresolved/BTC/USDC/short");
    });

    it("keeps pending and new local closes retryable after Error and non-Error feed failures", async () => {
      for (const failure of [new Error("close Error"), "close string"] as const) {
        const reconcileFeed = new FaultFeed();
        const reconcileStack = makeStack({ feed: reconcileFeed });
        const pending = reconcileStack.positionManager.openPosition("carry", makeSymbol(), "long", 0.01, 60_000, 10);
        expect(await reconcileStack.portfolioManager.requestPositionClose(pending, "first")).toBe(false);
        reconcileFeed.orderFailures.push(failure);
        expect(await reconcileStack.portfolioManager.requestPositionClose(pending, "retry")).toBe(false);

        const placeFeed = new FaultFeed();
        placeFeed.placeFailures.push(failure);
        const placeStack = makeStack({ feed: placeFeed });
        const fresh = placeStack.positionManager.openPosition("carry", makeSymbol(), "long", 0.01, 60_000, 10);
        expect(await placeStack.portfolioManager.requestPositionClose(fresh, "first")).toBe(false);
      }
    });

    it("derives authoritative spot and derivative close keys and reports metadata failures", async () => {
      const symbol = makeSymbol();
      for (const isSpot of [true, false]) {
        const stack = makeStack({
          feed: new FaultFeed({ positions: [], marketMeta: new Map([[symbol, makeMarketMeta(isSpot)]]) }),
          requireAuthoritativeEmergencyState: true,
          configuredSymbols: [String(symbol)],
        });
        const position = stack.positionManager.openPosition(isSpot ? "spot" : "derivative", symbol, "long", 0.01, 60_000, 10);
        expect(await stack.portfolioManager.requestPositionClose(position, "manual")).toBe(false);
      }
      for (const failure of [new Error("metadata Error"), "metadata string"] as const) {
        const feed = new FaultFeed();
        feed.marketMetaFailures.push(failure);
        const stack = makeStack({ feed, requireAuthoritativeEmergencyState: true });
        const position = stack.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10);
        expect(await stack.portfolioManager.requestPositionClose(position, "manual")).toBe(false);
      }
    });

    it("books public private-lifecycle executions for long, short, missing, and exhausted attribution", async () => {
      const symbol = makeSymbol();
      const feed = new LifecycleFeed();
      const stack = makeStack({ feed, terminalCloseEvidenceLimit: 1 });
      await stack.orderManager.startLifecycle();

      for (const side of ["long", "short"] as const) {
        const position = stack.positionManager.openPosition(side, symbol, side, 0.01, 60_000, 10);
        expect(await stack.portfolioManager.requestPositionClose(position, `close-${side}`)).toBe(false);
        const order = feed.placedOrders.at(-1);
        if (order === undefined) throw new Error("expected lifecycle close order");
        feed.emitLifecycle({
          kind: "execution",
          payload: {
            executionId: `execution-${side}`,
            clientOrderId: order.clientOrderId,
            exchangeOrderId: order.exchangeId,
            symbol,
            side: order.side,
            quantity: 0.01,
            price: 59_900,
            fee: 0,
            feeCurrency: "USDC",
            timestamp: Date.now(),
          },
        });
        expect(stack.positionManager.getPositions().some((item) => item.id === position.id)).toBe(false);
        feed.emitLifecycle({
          kind: "execution",
          payload: {
            executionId: `execution-${side}-duplicate-terminal`, clientOrderId: order.clientOrderId, exchangeOrderId: order.exchangeId,
            symbol, side: order.side, quantity: 0.01, price: 59_900, fee: 0, feeCurrency: "USDC", timestamp: Date.now(),
          },
        });
      }

      const missing = stack.positionManager.openPosition("missing", symbol, "long", 0.01, 60_000, 10);
      await stack.portfolioManager.requestPositionClose(missing, "missing");
      const missingOrder = feed.placedOrders.at(-1);
      if (missingOrder === undefined) throw new Error("expected missing-position close order");
      stack.positionManager.reconcileVenueAbsent(missing.id);
      feed.emitLifecycle({
        kind: "execution",
        payload: {
          executionId: "execution-missing", clientOrderId: missingOrder.clientOrderId, exchangeOrderId: missingOrder.exchangeId,
          symbol, side: "sell", quantity: 0.01, price: 59_900, fee: 0, feeCurrency: "USDC", timestamp: Date.now(),
        },
      });

      const orderPosition = stack.positionManager.openPosition("order-event", symbol, "long", 0.01, 60_000, 10);
      await stack.portfolioManager.requestPositionClose(orderPosition, "order-event");
      const orderUpdate = feed.placedOrders.at(-1);
      if (orderUpdate === undefined) throw new Error("expected order-update close order");
      feed.emitLifecycle({ kind: "order", payload: { ...orderUpdate, status: "closed", filled: 0.01, average: 59_900, updateTimestamp: undefined } });
      expect(stack.positionManager.getPositions().some((item) => item.id === orderPosition.id)).toBe(false);

      const lateOrderPosition = stack.positionManager.openPosition("late-order-event", symbol, "long", 0.01, 60_000, 10);
      await stack.portfolioManager.requestPositionClose(lateOrderPosition, "late-order-event");
      const canceledOrder = feed.placedOrders.at(-1);
      if (canceledOrder === undefined) throw new Error("expected canceled lifecycle close order");
      feed.emitLifecycle({ kind: "order", payload: { ...canceledOrder, status: "canceled", filled: 0 } });
      await stack.portfolioManager.requestPositionClose(lateOrderPosition, "late-order-event-retry");
      const replacementOrder = feed.placedOrders.at(-1);
      if (replacementOrder === undefined) throw new Error("expected replacement lifecycle close order");
      feed.emitLifecycle({
        kind: "order",
        payload: { ...canceledOrder, status: "closed", filled: 0.004, average: 59_850, updateTimestamp: undefined },
      });
      await Promise.resolve();
      expect(stack.positionManager.getPositions().find((item) => item.id === lateOrderPosition.id)?.quantity).toBeCloseTo(0.006);
      expect(feed.getOrder(replacementOrder.clientOrderId)?.status).toBe("canceled");
      await stack.orderManager.stopLifecycle();
    });

    it("matches all authoritative derivative predicates and stops attribution after quantity exhaustion", async () => {
      const symbol = makeSymbol();
      const other = asSymbol("ETH/USDC") as unknown as ExchangeSymbol;
      const feed = new LifecycleFeed({
        positions: [
          { ...makeRemotePosition(), symbol: other },
          makeRemotePosition("short"),
          makeRemotePosition("long", 0),
          makeRemotePosition("long", 0.01),
        ],
        marketMeta: new Map([[symbol, makeMarketMeta(false)], [other, { ...makeMarketMeta(false), symbol: other, base: "ETH" }]]),
      });
      const stack = makeStack({ feed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol), String(other)] });
      await stack.orderManager.startLifecycle();
      stack.positionManager.openPosition("first", symbol, "long", 0.01, 60_000, 10);
      stack.positionManager.openPosition("second", symbol, "long", 0.01, 60_000, 10);
      await stack.portfolioManager.executeCloseAll();
      const btcClose = feed.placedOrders.find((order) => order.symbol === symbol && order.side === "sell");
      if (btcClose === undefined) throw new Error("expected authoritative BTC close");
      feed.emitLifecycle({
        kind: "execution",
        payload: {
          executionId: "authoritative-exhaustion", clientOrderId: btcClose.clientOrderId, exchangeOrderId: btcClose.exchangeId,
          symbol, side: "sell", quantity: 0.01, price: 59_900, fee: 0, feeCurrency: "USDC", timestamp: Date.now(),
        },
      });
      expect(stack.positionManager.getPositionCount()).toBe(1);
      await stack.orderManager.stopLifecycle();
    });

    it("handles derivative and spot venue-close edge outcomes without changing policy", async () => {
      const symbol = makeSymbol();
      const noPrice = new FaultFeed({
        positions: [{ ...makeRemotePosition(), entryPrice: undefined, markPrice: undefined }],
        marketMeta: new Map([[symbol, makeMarketMeta(false)]]),
      });
      const noPriceStack = makeStack({ feed: noPrice, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)] });
      expect((await noPriceStack.portfolioManager.executeCloseAll()).unresolved).toContain("venue/BTC/USDC/long");

      const shortFeed = new FaultFeed({ positions: [makeRemotePosition("short")], marketMeta: new Map([[symbol, makeMarketMeta(false)]]) });
      const shortStack = makeStack({ feed: shortFeed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)] });
      await shortStack.portfolioManager.executeCloseAll();
      expect(requirePlacedOrder(shortFeed.placedOrders).side).toBe("buy");

      for (const failure of [new Error("venue Error"), "venue string"] as const) {
        const derivativeFeed = new FaultFeed({ positions: [makeRemotePosition()], marketMeta: new Map([[symbol, makeMarketMeta(false)]]) });
        derivativeFeed.placeFailures.push(failure);
        const derivative = makeStack({ feed: derivativeFeed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)] });
        expect((await derivative.portfolioManager.executeCloseAll()).unresolved).toContain("venue/BTC/USDC/long");

        const spotFeed = new FaultFeed({
          positions: [],
          balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
          marketMeta: new Map([[symbol, makeMarketMeta(true)]]),
        });
        spotFeed.placeFailures.push(failure);
        const spot = makeStack({ feed: spotFeed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)] });
        expect((await spot.portfolioManager.executeCloseAll()).unresolved).toContain("venue/BTC/USDC/spot");
      }

      const fallbackTickerFeed = new FaultFeed({
        positions: [], balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
        marketMeta: new Map([[symbol, makeMarketMeta(true)]]),
      });
      fallbackTickerFeed.setTicker(symbol, { symbol, timestamp: 1, bid: 0, ask: 60_001, last: 60_000 });
      const fallbackTicker = makeStack({ feed: fallbackTickerFeed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)] });
      await fallbackTicker.portfolioManager.executeCloseAll();
      expect(fallbackTickerFeed.placedOrders).toHaveLength(1);

      const tooSmallFeed = new FaultFeed({
        positions: [], balances: [{ currency: "BTC", free: 0.0001, total: 0.0001 }],
        marketMeta: new Map([[symbol, makeMarketMeta(true, 1_000_000)]]),
      });
      const tooSmall = makeStack({ feed: tooSmallFeed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)] });
      await tooSmall.portfolioManager.executeCloseAll();
      expect(tooSmallFeed.placedOrders).toHaveLength(0);
    });

    it("handles terminal and unavailable pending authoritative closes", async () => {
      const symbol = makeSymbol();
      const meta = new Map([[symbol, makeMarketMeta(false)]]);
      for (const mode of ["terminal", "unavailable"] as const) {
        const feed = new FaultFeed({ positions: [makeRemotePosition()], marketMeta: meta });
        const stack = makeStack({ feed, requireAuthoritativeEmergencyState: true, configuredSymbols: [String(symbol)] });
        await stack.portfolioManager.executeCloseAll();
        const order = requirePlacedOrder(feed.placedOrders);
        if (mode === "terminal") feed.setOrderStatus(order.clientOrderId, { status: "canceled" });
        else feed.orderFailures.push("pending unavailable");
        await expect(stack.portfolioManager.executeCloseAll()).resolves.toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 6) Reset
  // ---------------------------------------------------------------------------
  describe("reset", () => {
    it("clears the trip latch and close-all flag", async () => {
      const stack = makeStack({ maxDdPct: 0.10 });
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(80_000);
      expect(stack.portfolioManager.isTripped()).toBe(true);
      stack.portfolioManager.reset();
      expect(stack.portfolioManager.isTripped()).toBe(false);
      expect(stack.portfolioManager.didExecuteCloseAll()).toBe(false);
    });

    it("clears correlation streams", () => {
      const stack = makeStack();
      stack.portfolioManager.recordFill({ strategyId: "a", returnPct: 0.01 });
      stack.portfolioManager.reset();
      expect(stack.correlation.getSampleCount("a")).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 7) End-to-end: trip → close → state
  // ---------------------------------------------------------------------------
  describe("end-to-end integration", () => {
    it("isTripped() is observable from the strategy-runner perspective", async () => {
      const stack = makeStack({ maxDdPct: 0.05 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      // Simulate a 6% drawdown
      stack.portfolioManager.recordEquity(100_000);
      expect(stack.portfolioManager.isTripped()).toBe(false);
      await stack.portfolioManager.recordEquityAndSettle(94_000);
      expect(stack.portfolioManager.isTripped()).toBe(true);
    });

    it("getPortfolioState reports tripped state", async () => {
      const stack = makeStack({ maxDdPct: 0.05 });
      const sym = makeSymbol();
      stack.positionManager.openPosition("carry", sym, "long", 0.01, 60_000, 10);
      stack.portfolioManager.recordEquity(100_000);
      await stack.portfolioManager.recordEquityAndSettle(90_000);
      const state = stack.portfolioManager.getPortfolioState();
      expect(state.isTripped).toBe(true);
      expect(state.stopState.tripped).toBe(true);
      expect(state.stopState.trippedAt).not.toBeNull();
    });
  });
});
