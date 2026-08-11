/**
 * apps/bot/src/bot/strategy-runner.test.ts
 *
 * A `StrategyRunner` és a `defaultSizingFn` unit tesztjei.
 */

import { describe, expect, it } from "bun:test";
import {
  asSymbol,
  type ClientOrderId,
  type Execution,
  type FeedEvent,
  type FeedListener,
  type Ohlcv,
  type Order,
  type OrderRequest,
  type Symbol as ExchangeSymbol,
  type Ticker,
  type Timeframe,
} from "@mm-crypto-bot/exchange";
// Phase 66: `MockExchangeFeed` is test-only — import from the
// `@exchange-testing/*` path alias (see tsconfig.base.json).
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import type {
  StrategyPlugin,
  PositionManagementContext,
  PositionUpdate,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "@mm-crypto-bot/core";

import { OrderManager } from "./order-manager.js";
import { PositionManager } from "./position-manager.js";
import { StrategyRunner, defaultSizingFn, runnerStatsToState } from "./strategy-runner.js";
import { createStrategyInstances } from "../config/strategy-registry.js";
import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";
import { RiskManager } from "../risk/risk-manager.js";
import type { PortfolioManager } from "../portfolio/portfolio-manager.js";

function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
}

class FailTakeProfitFeed extends MockExchangeFeed {
  public override async placeOrder(req: OrderRequest) {
    if (req.protectiveKind === "take_profit") throw new Error("injected TP conditional failure");
    return super.placeOrder(req);
  }
}

class FailFirstProtectionCancelFeed extends MockExchangeFeed {
  private failed = false;

  public override async cancelOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    if (!this.failed && (clientOrderId.includes("stop_loss") || clientOrderId.includes("take_profit"))) {
      this.failed = true;
      throw new Error("injected protection cancel failure");
    }
    return super.cancelOrder(clientOrderId, symbol);
  }
}

/** A live acknowledgement with a deterministic terminal/partial outcome. */
class TrailingCloseOutcomeFeed extends MockExchangeFeed {
  public constructor(private readonly outcome: "canceled" | "partial" | "throw") { super(); }

  public override async placeOrder(req: OrderRequest) {
    if (this.outcome === "throw" && req.reduceOnly === true) throw new Error("injected trailing close failure");
    const order = await super.placeOrder(req);
    if (req.reduceOnly !== true) return order;
    if (this.outcome === "canceled") return { ...order, status: "canceled" as const };
    return { ...order, status: "closed" as const, filled: order.amount / 2, average: req.price ?? 95 };
  }
}

/**
 * Adds the authenticated private streams absent from MockExchangeFeed.  These
 * callbacks deliberately run through OrderManager.startLifecycle(), keeping
 * the tests on the same normalized production event boundary as CCXT feeds.
 */
function attachPrivateLifecycle(feed: MockExchangeFeed): {
  readonly emitOrder: (order: Order) => void;
  readonly emitExecution: (execution: Execution) => void;
} {
  let orderListener: FeedListener | undefined;
  let executionListener: FeedListener | undefined;
  Object.assign(feed, {
    subscribeOrderUpdates: async (listener: FeedListener) => { orderListener = listener; return 9_001; },
    subscribeExecutions: async (listener: FeedListener) => { executionListener = listener; return 9_002; },
  });
  return {
    emitOrder: (order) => orderListener?.({ kind: "order", payload: order } as FeedEvent),
    emitExecution: (execution) => executionListener?.({ kind: "execution", payload: execution } as FeedEvent),
  };
}

async function flushPrivateLifecycle(): Promise<void> {
  // Order lifecycle listeners are intentionally fire-and-forget at the feed
  // boundary.  Yield twice so the per-symbol serializer and any conditional
  // protection placement it awaits have both run.
  await Promise.resolve();
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  await Promise.resolve();
}

/**
 * `FixedSignalStrategy` — a `Strategy` interface minimális implementációja,
 * ami minden `onCandle` hívásra egy fix jelet ad vissza.
 */
class FixedSignalStrategy implements Strategy {
  readonly name = "fixed-signal";
  readonly timeframes = ["15m"] as const;
  private readonly _signal: StrategySignal;
  public onCandleCallCount = 0;

  public constructor(signal: StrategySignal) {
    this._signal = signal;
  }

  public onCandle(_ctx: StrategyContext): StrategySignal {
    this.onCandleCallCount++;
    return this._signal;
  }

  public warmup(): number {
    return 0;
  }
}

/**
 * `ForceExitStrategy` — a `Strategy` interface implementációja, ami
 * minden `onCandle` hívásra egy fix signalt ad, ÉS minden
 * `onOpenPositionUpdate` hívásra `forceExit: true`-t. A Phase 67
 * position-check + `onOpenPositionUpdate` wire-up tesztelésére.
 */
class ForceExitStrategy implements Strategy {
  readonly name = "force-exit-strategy";
  readonly timeframes = ["15m"] as const;
  private readonly _signal: StrategySignal;
  public onCandleCallCount = 0;
  public onOpenPositionUpdateCallCount = 0;

  public constructor(signal: StrategySignal) {
    this._signal = signal;
  }

  public onCandle(_ctx: StrategyContext): StrategySignal {
    this.onCandleCallCount++;
    return this._signal;
  }

  public onOpenPositionUpdate(_ctx: PositionManagementContext): PositionUpdate {
    this.onOpenPositionUpdateCallCount++;
    return { forceExit: true, reason: "trend_reversal" };
  }

  public warmup(): number {
    return 0;
  }
}

/** Minimal lifecycle probe for the Bot-owned plugin SignalBus wiring. */
class LifecyclePlugin {
  public subscribeCalls = 0;
  public barCalls = 0;
  public disposeCalls = 0;
  public lastClose: number | null = null;

  public subscribe(_bus: { emit(signal: unknown): void }): void {
    this.subscribeCalls += 1;
  }

  public onBar(bar: { readonly close: number }): void {
    this.barCalls += 1;
    this.lastClose = bar.close;
  }

  public reset(): void {
    void 0;
  }

  public validateConfig(): { readonly ok: true; readonly value: undefined } {
    return { ok: true, value: undefined };
  }

  public dispose(): void {
    this.disposeCalls += 1;
  }

  public readonly metadata = {
    name: "lifecycle-probe",
    version: "1.0.0",
    edgeClass: "risk" as const,
    capitalRequirement: 0,
    maxLeverage: 1,
    description: "test probe",
    dependencies: [],
  };
}

class RiskActionPlugin extends LifecyclePlugin {
  public constructor(private readonly source: string, private readonly once = false) { super(); }
  private bus: { emit(signal: unknown): void } | null = null;
  private emitted = false;
  public override subscribe(bus: { emit(signal: unknown): void }): void {
    super.subscribe(bus);
    this.bus = bus;
  }
  public override onBar(bar: { readonly close: number }): void {
    super.onBar(bar);
    if (this.once && this.emitted) return;
    this.emitted = true;
    this.bus?.emit({
      kind: "risk", varDaily95: 0, correlationPenalty: 0, drawdownLimit: 0,
      source: this.source, breach: true, reason: "test-breach",
    });
  }
}

function pushTickerTick(feed: MockExchangeFeed, symbol: ExchangeSymbol, last: number): void {
  const ticker: Ticker = {
    symbol,
    timestamp: Date.now(),
    bid: last - 1,
    ask: last + 1,
    last,
    baseVolume: 100,
    quoteVolume: 100 * last,
  };
  feed.pushEvent({ kind: "ticker", payload: ticker });
}

function pushOhlcvTick(feed: MockExchangeFeed, symbol: ExchangeSymbol, timeframe: Timeframe, candle: Ohlcv): void {
  feed.pushEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe, candle },
  });
}

describe("StrategyRunner", () => {

  it("uses min(global max leverage, strategy request) for the booked position", async () => {
    for (const [globalMax, requested, expected] of [[1, 10, 1], [10, 1, 1]] as const) {
      const feed = new MockExchangeFeed();
      await feed.open();
      const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: globalMax });
      const om = new OrderManager({
        feed, getPositionContext: () => pm.getPositionContext(), paperMode: true,
        leverage: { maxLeverage: globalMax, tolerance: 1e-6, warnOnApproach: 0.95 },
      });
      const strategy = new FixedSignalStrategy({ side: "buy", confidence: 1, reason: "leverage", stopLoss: 0, takeProfit: 0 });
      const runner = new StrategyRunner({
        instances: new Map([["lev" as const, { kind: "strategy" as const, name: "lev" as const, instance: strategy }]]),
        orderManager: om, positionManager: pm, sizingFn: () => 1, enabledSymbols: ["BTC/USDC"], maxLeverage: globalMax,
        strategyPolicies: new Map([["lev" as const, { leverage: requested }]]),
      });
      await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] } });
      expect(pm.getPosition("lev", makeSymbol(), "long")?.leverage).toBe(expected);
      runner.dispose();
    }
  });

  it("routes one enabled plugin breach through portfolio gates; pause and disabled attribution block it", async () => {
    const run = async (source: string, paused: boolean): Promise<number> => {
      const feed = new MockExchangeFeed();
      await feed.open();
      const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
      const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
      const plugin = new RiskActionPlugin(source);
      let actions = 0;
      const portfolio = {
        executeCloseAll: async () => { actions++; return { closed: [], unresolved: [], cancelledOrders: [] }; },
        isTripped: () => false,
      };
      const runner = new StrategyRunner({
        instances: new Map([["risk-plugin" as const, { kind: "plugin" as const, name: "risk-plugin" as const, instance: plugin as unknown as StrategyPlugin }]]),
        orderManager: om, positionManager: pm, sizingFn: () => 0, enabledSymbols: ["BTC/USDC"],
        portfolioManager: portfolio as unknown as PortfolioManager,
      });
      if (paused) runner.pause();
      await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] } });
      await Promise.resolve();
      runner.dispose();
      return actions;
    };
    expect(await run("risk-probe:BTC/USDC", false)).toBe(1);
    expect(await run("risk-probe:BTC/USDC", true)).toBe(0);
    expect(await run("risk-probe:ETH/USDC", false)).toBe(0);
  });

  it("latches a real plugin breach before a signal strategy can enter and requires explicit resume", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext(), paperMode: true });
    const plugin = new RiskActionPlugin("risk-probe:BTC/USDC", true);
    const strategy = new FixedSignalStrategy({ side: "buy", confidence: 1, reason: "must-be-gated", stopLoss: 0, takeProfit: 0 });
    let emergencyCalls = 0;
    let releaseEmergency: (() => void) | undefined;
    const unresolvedEmergency = new Promise<void>((resolve) => { releaseEmergency = resolve; });
    const runner = new StrategyRunner({
      instances: new Map([
        ["risk-plugin" as const, { kind: "plugin" as const, name: "risk-plugin" as const, instance: plugin as unknown as StrategyPlugin }],
        ["signal-strategy" as const, { kind: "strategy" as const, name: "signal-strategy" as const, instance: strategy }],
      ]),
      orderManager: om, positionManager: pm, sizingFn: () => 1, enabledSymbols: ["BTC/USDC"],
      onEmergency: () => { emergencyCalls++; return unresolvedEmergency; },
    });
    const candle = (timestamp: number): FeedEvent => ({
      kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [timestamp, 100, 101, 99, 100, 1] },
    });
    await runner.onFeedEvent(candle(1));
    expect(emergencyCalls).toBe(1);
    expect(runner.isPaused()).toBe(true);
    expect(om.getCounters().placed).toBe(0);
    await runner.onFeedEvent(candle(2));
    expect(om.getCounters().placed).toBe(0);
    releaseEmergency?.();
    await Promise.resolve();
    expect(runner.isPaused()).toBe(true);
    runner.resume(); // explicit operator-safe reset boundary
    await runner.onFeedEvent(candle(3));
    expect(om.getCounters().placed).toBe(1);
    runner.dispose();
  });
  // ---------------------------------------------------------------------------
  // 1) defaultSizingFn computes qty correctly
  // ---------------------------------------------------------------------------
  it("defaultSizingFn returns equity * riskPerTrade / price", () => {
    const qty = defaultSizingFn({
      signal: { side: "buy", confidence: 1, reason: "test", stopLoss: 0, takeProfit: 0 },
      symbol: makeSymbol(),
      referencePrice: 60_000,
      equityUsd: 10_000,
      riskPerTrade: 0.01,
    });
    // 10_000 * 0.01 / 60_000 = 0.001666...
    expect(qty).toBeCloseTo(0.00166, 4);
  });

  // ---------------------------------------------------------------------------
  // 2) defaultSizingFn returns 0 for invalid price
  // ---------------------------------------------------------------------------
  it("defaultSizingFn returns 0 for invalid price", () => {
    const qty = defaultSizingFn({
      signal: { side: "buy", confidence: 1, reason: "test", stopLoss: 0, takeProfit: 0 },
      symbol: makeSymbol(),
      referencePrice: 0,
      equityUsd: 10_000,
      riskPerTrade: 0.01,
    });
    expect(qty).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 3) onFeedEvent processes ticker events
  // ---------------------------------------------------------------------------
  it("onFeedEvent processes ticker events", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
      paperMode: true,
    });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    // Subscribe to the feed so pushEvent delivers.
    await feed.subscribeTicker(makeSymbol(), (event) => {
      void runner.onFeedEvent(event);
    });
    pushTickerTick(feed, makeSymbol(), 60_000);
    pushTickerTick(feed, makeSymbol(), 61_000);
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });
    const stats = runner.getStats();
    expect(stats.ticksProcessed).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // 4) ohlcv event triggers strategy and places an order
  // ---------------------------------------------------------------------------
  it("ohlcv event triggers strategy.onCandle and places order", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
      paperMode: true,
    });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    const stats = runner.getStats();
    expect(stats.totalSignals).toBe(1);
    expect(pm.getPositionCount()).toBe(1);
  });

  it("does not book an open live create-order acknowledgement as a fill", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({ side: "buy", confidence: 1, reason: "ack", stopLoss: 0, takeProfit: 0 });
    const runner = new StrategyRunner({
      instances: new Map([["ack" as const, { kind: "strategy" as const, name: "ack" as const, instance: strategy }]]),
      orderManager: om, positionManager: pm, sizingFn: defaultSizingFn, enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] } });
    expect(om.getInFlightCount()).toBe(1);
    expect(pm.getPositionCount()).toBe(0);
  });

  it("serializes simultaneous same-symbol bars and retains an unfilled entry idempotency gate", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({ side: "buy", confidence: 1, reason: "race", stopLoss: 0, takeProfit: 0 });
    const runner = new StrategyRunner({
      instances: new Map([["race" as const, { kind: "strategy" as const, name: "race" as const, instance: strategy }]]),
      orderManager: om, positionManager: pm, sizingFn: () => 1, enabledSymbols: ["BTC/USDC"],
    });
    const event = (timestamp: number): FeedEvent => ({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [timestamp, 100, 101, 99, 100, 1] } });
    await Promise.all([runner.onFeedEvent(event(1)), runner.onFeedEvent(event(2))]);
    expect(om.getCounters().placed).toBe(1);
    expect(pm.getPositionCount()).toBe(0);
  });

  it("reconciles a late partial then terminal fill exactly once from cumulative exchange state", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({ side: "buy", confidence: 1, reason: "late", stopLoss: 0, takeProfit: 0 });
    const runner = new StrategyRunner({
      instances: new Map([["late" as const, { kind: "strategy" as const, name: "late" as const, instance: strategy }]]),
      orderManager: om, positionManager: pm, sizingFn: () => 2, enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] } });
    const id = om.getInFlightOrderIds()[0]!;
    feed.setOrderStatus(id, { filled: 1, average: 101, status: "open" });
    await runner.onFeedEvent({ kind: "ticker", payload: { symbol: makeSymbol(), timestamp: 2, bid: 100, ask: 102, last: 101, baseVolume: 1, quoteVolume: 101 } });
    await runner.onFeedEvent({ kind: "ticker", payload: { symbol: makeSymbol(), timestamp: 3, bid: 100, ask: 102, last: 101, baseVolume: 1, quoteVolume: 101 } });
    expect(pm.getPosition("late", makeSymbol(), "long")?.quantity).toBe(1);
    feed.setOrderStatus(id, { filled: 2, average: 102, status: "closed" });
    await runner.onFeedEvent({ kind: "ticker", payload: { symbol: makeSymbol(), timestamp: 4, bid: 101, ask: 103, last: 102, baseVolume: 1, quoteVolume: 102 } });
    expect(pm.getPosition("late", makeSymbol(), "long")?.quantity).toBe(2);
    expect(om.getInFlightCount()).toBe(0);
  });

  it("replaces native TP/SL with one total-exposure pair after partial fills and resizes after an exit", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({ side: "buy", confidence: 1, reason: "native", stopLoss: 90, takeProfit: 110 });
    const runner = new StrategyRunner({
      instances: new Map([["native" as const, { kind: "strategy" as const, name: "native" as const, instance: strategy }]]),
      orderManager: om, positionManager: pm, sizingFn: () => 2, enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] } });
    const entryId = om.getInFlightOrderIds()[0]!;
    feed.setOrderStatus(entryId, { filled: 1, average: 100, status: "open" });
    await runner.onFeedEvent({ kind: "ticker", payload: { symbol: makeSymbol(), timestamp: 2, bid: 99, ask: 101, last: 100, baseVolume: 1, quoteVolume: 100 } });
    const firstProtectionIds = om.getInFlightOrderIds().filter((id) => id !== entryId);
    expect(firstProtectionIds).toHaveLength(2);
    feed.setOrderStatus(entryId, { filled: 2, average: 100, status: "closed" });
    await runner.onFeedEvent({ kind: "ticker", payload: { symbol: makeSymbol(), timestamp: 3, bid: 99, ask: 101, last: 100, baseVolume: 1, quoteVolume: 100 } });
    // Bybit cancel ACK is asynchronous: no replacement is authoritative yet.
    expect(om.getInFlightOrderIds().filter((id) => id !== entryId)).toHaveLength(0);
    for (const old of firstProtectionIds) expect(feed.getOrder(old)?.status).toBe("canceled");
    for (const old of firstProtectionIds) {
      (om as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }).handleLifecycleFeedEvent({
        kind: "order", payload: feed.getOrder(old)!,
      });
    }
    await flushPrivateLifecycle();
    const replacementProtectionIds = om.getInFlightOrderIds().filter((id) => id !== entryId);
    expect(replacementProtectionIds).toHaveLength(2);

    const triggered = replacementProtectionIds[0]!;
    const sibling = replacementProtectionIds[1]!;
    feed.setOrderStatus(triggered, { filled: 1, average: 90, status: "closed" });
    await runner.onFeedEvent({ kind: "ticker", payload: { symbol: makeSymbol(), timestamp: 4, bid: 89, ask: 91, last: 90, baseVolume: 1, quoteVolume: 90 } });
    expect(feed.getOrder(sibling)?.status).toBe("canceled");
    expect(pm.getPosition("native", makeSymbol(), "long")?.quantity).toBe(1);
    expect(om.getInFlightOrderIds()).toHaveLength(0);
    (om as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }).handleLifecycleFeedEvent({
      kind: "order", payload: feed.getOrder(sibling)!,
    });
    await flushPrivateLifecycle();
    const residualProtectionIds = om.getInFlightOrderIds();
    expect(residualProtectionIds).toHaveLength(2);
    for (const id of residualProtectionIds) expect(feed.getOrder(id)?.amount).toBe(1);
  });

  it("cancels a partly-created native protection and submits a reduce-only fail-safe close", async () => {
    const feed = new FailTakeProfitFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({ side: "buy", confidence: 1, reason: "failsafe", stopLoss: 90, takeProfit: 110 });
    const runner = new StrategyRunner({
      instances: new Map([["failsafe" as const, { kind: "strategy" as const, name: "failsafe" as const, instance: strategy }]]),
      orderManager: om, positionManager: pm, sizingFn: () => 1, enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] } });
    const entryId = om.getInFlightOrderIds()[0]!;
    feed.setOrderStatus(entryId, { filled: 1, average: 100, status: "closed" });
    await runner.onFeedEvent({ kind: "ticker", payload: { symbol: makeSymbol(), timestamp: 2, bid: 99, ask: 101, last: 100, baseVolume: 1, quoteVolume: 100 } });
    let orders = [...feed["orderBook"].values()];
    expect(orders.find((order) => order.clientOrderId.includes("stop_loss"))?.status).toBe("canceled");
    expect(orders.find((order) => order.clientOrderId.includes("protection-failsafe"))).toBeUndefined();
    const canceledProtection = orders.find((order) => order.clientOrderId.includes("stop_loss"))!;
    (om as unknown as { handleLifecycleFeedEvent(event: FeedEvent): void }).handleLifecycleFeedEvent({ kind: "order", payload: canceledProtection });
    await flushPrivateLifecycle();
    orders = [...feed["orderBook"].values()];
    expect(orders.find((order) => order.clientOrderId.includes("protection-failsafe"))?.side).toBe("sell");
  });

  it("paper SL/TP closes through reduce-only bookkeeping; stop wins same-bar ambiguity and gap policy is conservative", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({
      feed, getPositionContext: () => pm.getPositionContext(), paperMode: true,
      getReduciblePosition: (symbol) => {
        const position = pm.getPositions().find((item) => item.symbol === symbol);
        return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
      },
    });
    const strategy = new FixedSignalStrategy({ side: "buy", confidence: 1, reason: "protected", stopLoss: 90, takeProfit: 110 });
    const runner = new StrategyRunner({
      instances: new Map([["protected" as const, { kind: "strategy" as const, name: "protected" as const, instance: strategy }]]),
      orderManager: om, positionManager: pm, sizingFn: () => 1, enabledSymbols: ["BTC/USDC"],
    });
    await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] } });
    await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [2, 95, 111, 89, 100, 1] } });
    expect(pm.getPositionCount()).toBe(0);
    expect(pm.getClosedTrades().at(-1)?.exitPrice).toBe(90);
  });

  it("keeps MTF histories separate and decides only on the configured LTF", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    let context: StrategyContext | undefined;
    const strategy: Strategy = {
      name: "mtf", timeframes: ["1d", "4h", "15m"], warmup: () => 0,
      onCandle: (ctx) => { context = ctx; return null; },
    };
    const runner = new StrategyRunner({
      instances: new Map([["mtf" as const, { kind: "strategy" as const, name: "mtf" as const, instance: strategy }]]),
      orderManager: om, positionManager: pm, sizingFn: defaultSizingFn, enabledSymbols: ["BTC/USDC"],
    });
    for (let i = 0; i < 20; i++) {
      await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "1d", candle: [i, 10 + i, 20 + i, 5 + i, 15 + i, 1] } });
    }
    for (let i = 0; i < 15; i++) {
      await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [100 + i, 100, 105 + i, 95 - i, 100 + i, 1] } });
    }
    expect(context?.timeframe).toBe("15m");
    expect(context?.mtfState.htf.donchianUpper).toBe(39);
    expect(context?.mtfState.htf.donchianLower).toBe(5);
    expect(context?.mtfState.ltf.atr).toBeGreaterThan(0);
    expect(context?.mtfState.mtf.close).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 5) Disabled symbols are skipped
  // ---------------------------------------------------------------------------
  it("skips ohlcv events for symbols not in enabledSymbols", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
    });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["ETH/USDC"], // BTC not enabled
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    const stats = runner.getStats();
    expect(stats.totalSignals).toBe(0);
  });

  it("pause gates an in-flight feed event before it can emit an order", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext(), paperMode: true });
    const strategy = new FixedSignalStrategy({
      side: "buy", confidence: 1, reason: "pause-test", stopLoss: 0, takeProfit: 0,
    });
    const runner = new StrategyRunner({
      instances: new Map([
        ["fixed-signal" as const, { kind: "strategy" as const, name: "fixed-signal" as const, instance: strategy as unknown as Strategy }],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    runner.pause();
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: makeSymbol(), timeframe: "15m", candle: [Date.now(), 100, 101, 99, 100, 1] },
    });
    expect(strategy.onCandleCallCount).toBe(0);
    expect(pm.getPositionCount()).toBe(0);
    expect(runner.getStats().totalSignals).toBe(0);

    runner.resume();
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: makeSymbol(), timeframe: "15m", candle: [Date.now(), 100, 101, 99, 100, 1] },
    });
    expect(pm.getPositionCount()).toBe(1);
  });

  it("starts enabled plugins, drives each bar, and disposes subscriptions once", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext(), paperMode: true });
    const plugin = new LifecyclePlugin();
    const runner = new StrategyRunner({
      instances: new Map([
        ["lifecycle-plugin" as const, {
          kind: "plugin" as const,
          name: "lifecycle-plugin" as const,
          instance: plugin as unknown as StrategyPlugin,
        }],
      ]),
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    expect(plugin.subscribeCalls).toBe(1);
    await runner.onFeedEvent({
      kind: "ohlcv",
      payload: { symbol: makeSymbol(), timeframe: "15m", candle: [123, 100, 105, 99, 103, 7] },
    });
    expect(plugin.barCalls).toBe(1);
    expect(plugin.lastClose).toBe(103);
    runner.dispose();
    runner.dispose();
    expect(plugin.disposeCalls).toBe(1);
  });

  it("rolls back already-started plugins when a later subscription rejects", () => {
    const feed = new MockExchangeFeed();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext(), paperMode: true });
    const started = new LifecyclePlugin();
    const rejecting = new LifecyclePlugin();
    rejecting.subscribe = () => { throw new Error("plugin rejected startup"); };

    expect(() => new StrategyRunner({
      instances: new Map([
        ["started" as const, { kind: "plugin" as const, name: "started" as const, instance: started as unknown as StrategyPlugin }],
        ["rejecting" as const, { kind: "plugin" as const, name: "rejecting" as const, instance: rejecting as unknown as StrategyPlugin }],
      ]),
      orderManager: om, positionManager: pm, sizingFn: () => 0, enabledSymbols: ["BTC/USDC"],
    })).toThrow("plugin rejected startup");
    expect(started.subscribeCalls).toBe(1);
    expect(started.disposeCalls).toBe(1);
  });

  it("books private executions once, preserves execution price, and releases the terminal entry gate", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const lifecycle = attachPrivateLifecycle(feed);
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    let opened = 0;
    const strategy: Strategy = {
      name: "private-entry", timeframes: ["15m"], warmup: () => 0,
      onCandle: () => ({ side: "buy", confidence: 1, reason: "private", stopLoss: 0, takeProfit: 0 }),
      onPositionOpened: () => { opened++; },
    };
    const runner = new StrategyRunner({
      instances: new Map([["private-entry" as const, { kind: "strategy" as const, name: "private-entry" as const, instance: strategy }]]),
      orderManager: om, positionManager: pm, sizingFn: () => 2, enabledSymbols: ["BTC/USDC"],
    });
    await om.startLifecycle();
    await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] } });
    const entry = om.getInFlightOrderIds()[0]!;
    const initial = feed.getOrder(entry)!;
    const execution = (executionId: string, quantity: number, price: number): Execution => ({
      executionId, clientOrderId: entry, exchangeOrderId: initial.exchangeId, symbol: makeSymbol(), side: "buy",
      quantity, price, fee: 0, feeCurrency: "USDC", timestamp: Date.now(),
    });
    lifecycle.emitExecution(execution("late-first", 1, 101));
    lifecycle.emitExecution(execution("late-first", 1, 101)); // duplicate execution id
    lifecycle.emitExecution(execution("earlier-second", 1, 99)); // out-of-order id, valid second fill
    await flushPrivateLifecycle();

    const position = pm.getPosition("private-entry", makeSymbol(), "long");
    expect(position?.quantity).toBe(2);
    expect(position?.entryPrice).toBe(100);
    expect(opened).toBe(1);
    expect(om.getInFlightCount()).toBe(0);

    // Terminal private evidence removes the idempotency gate, so a later bar
    // can create a new intent after this position has been independently closed.
    pm.closePosition("private-entry", makeSymbol(), 100);
    await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [2, 100, 101, 99, 100, 1] } });
    expect(om.getCounters().placed).toBe(2);
    runner.dispose();
    await om.stopLifecycle();
  });

  it("uses private protection lifecycle updates to cancel siblings and resize residual protection", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const lifecycle = attachPrivateLifecycle(feed);
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({ side: "buy", confidence: 1, reason: "private-protection", stopLoss: 90, takeProfit: 110 });
    const runner = new StrategyRunner({
      instances: new Map([["private-protection" as const, { kind: "strategy" as const, name: "private-protection" as const, instance: strategy }]]),
      orderManager: om, positionManager: pm, sizingFn: () => 2, enabledSymbols: ["BTC/USDC"],
    });
    await om.startLifecycle();
    await runner.onFeedEvent({ kind: "ohlcv", payload: { symbol: makeSymbol(), timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] } });
    const entryId = om.getInFlightOrderIds()[0]!;
    const entry = feed.getOrder(entryId)!;
    lifecycle.emitExecution({
      executionId: "entry-full", clientOrderId: entryId, exchangeOrderId: entry.exchangeId, symbol: makeSymbol(), side: "buy",
      quantity: 2, price: 100, fee: 0, feeCurrency: "USDC", timestamp: Date.now(),
    });
    await flushPrivateLifecycle();
    const protectionIds = om.getInFlightOrderIds();
    expect(protectionIds).toHaveLength(2);

    // A terminal zero-fill cancellation cleans up a stale native leg without
    // affecting exposure; the sibling remains eligible to execute.
    const canceledId = protectionIds[0]!;
    lifecycle.emitOrder({ ...feed.getOrder(canceledId)!, status: "canceled", filled: 0 });
    await flushPrivateLifecycle();

    const triggeredId = protectionIds[1]!;
    const triggered = feed.getOrder(triggeredId)!;
    lifecycle.emitExecution({
      executionId: "partial-stop", clientOrderId: triggeredId, exchangeOrderId: triggered.exchangeId, symbol: makeSymbol(), side: triggered.side,
      quantity: 1, price: 90, fee: 0, feeCurrency: "USDC", timestamp: Date.now(),
    });
    await flushPrivateLifecycle();
    expect(pm.getPosition("private-protection", makeSymbol(), "long")?.quantity).toBe(1);
    expect(om.getInFlightOrderIds()).toHaveLength(0);
    lifecycle.emitOrder({ ...feed.getOrder(triggeredId)!, status: "canceled", filled: 1, average: 90 });
    await flushPrivateLifecycle();
    const replacements = om.getInFlightOrderIds();
    expect(replacements).toHaveLength(2);
    for (const id of replacements) expect(feed.getOrder(id)?.amount).toBe(1);
    runner.dispose();
    await om.stopLifecycle();
  });

  it("serializes delayed cancel/fill races for spot and contracts without over-closing", async () => {
    for (const isSpot of [true, false]) {
      const symbol = makeSymbol();
      const feed = new MockExchangeFeed({ marketMeta: new Map([[symbol, {
        symbol, base: "BTC", quote: "USDC", amountPrecision: 4, pricePrecision: 2,
        minAmount: 0.0001, minCost: 1, isSpot,
      }]]) });
      await feed.open();
      const lifecycle = attachPrivateLifecycle(feed);
      const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
      const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
      const runner = new StrategyRunner({ instances: new Map(), orderManager: om, positionManager: pm, sizingFn: () => 0, enabledSymbols: [String(symbol)] });
      await om.startLifecycle();
      pm.openPosition("serialized", symbol, "long", 1, 100, 1);
      const signal = { side: "buy" as const, confidence: 1, reason: "serialized", stopLoss: 90, takeProfit: 110 };
      const install = (runner["installProtections"] as (input: {
        strategy: "serialized"; symbol: ExchangeSymbol; side: "long"; quantity: number; leverage: number;
        signal: StrategySignal; referencePrice: number;
      }) => Promise<void>).bind(runner);
      const input = { strategy: "serialized" as const, symbol, side: "long" as const, quantity: 1, leverage: 1, signal, referencePrice: 100 };
      await install(input);
      const retired = om.getInFlightOrderIds();
      expect(retired).toHaveLength(2);

      // Replacement request only sends cancel requests. The old pair remains
      // authoritative until both private terminal updates arrive.
      await install(input);
      expect([...feed["orderBook"].values()]).toHaveLength(2);
      lifecycle.emitOrder(feed.getOrder(retired[0]!)!);
      await flushPrivateLifecycle();
      expect([...feed["orderBook"].values()]).toHaveLength(2);
      lifecycle.emitOrder(feed.getOrder(retired[1]!)!);
      await flushPrivateLifecycle();
      let replacement = om.getInFlightOrderIds();
      expect(replacement).toHaveLength(2);
      for (const id of replacement) expect(feed.getOrder(id)?.amount).toBe(1);

      // Cancel-before-fill: a late retired-leg execution still reduces the
      // authoritative exposure and cancels the entire replacement pair.
      const late = feed.getOrder(retired[0]!)!;
      lifecycle.emitExecution({
        executionId: `late-${String(isSpot)}`, clientOrderId: late.clientOrderId, exchangeOrderId: late.exchangeId,
        symbol, side: "sell", quantity: 0.4, price: 90, fee: 0, feeCurrency: "USDC", timestamp: Date.now(),
      });
      await flushPrivateLifecycle();
      expect(pm.getPosition("serialized", symbol, "long")?.quantity).toBeCloseTo(0.6);
      for (const id of replacement) lifecycle.emitOrder(feed.getOrder(id)!);
      await flushPrivateLifecycle();
      replacement = om.getInFlightOrderIds();
      expect(replacement).toHaveLength(2);
      for (const id of replacement) expect(feed.getOrder(id)?.amount).toBeCloseTo(0.6);

      // A second late sibling fill is clipped to remaining exposure. Once the
      // new siblings prove canceled, zero exposure never rebuilds zero-level protection.
      const lateSibling = feed.getOrder(retired[1]!)!;
      lifecycle.emitExecution({
        executionId: `late-flat-${String(isSpot)}`, clientOrderId: lateSibling.clientOrderId, exchangeOrderId: lateSibling.exchangeId,
        symbol, side: "sell", quantity: 0.8, price: 110, fee: 0, feeCurrency: "USDC", timestamp: Date.now(),
      });
      await flushPrivateLifecycle();
      expect(pm.getPositionCount()).toBe(0);
      for (const id of replacement) lifecycle.emitOrder(feed.getOrder(id)!);
      await flushPrivateLifecycle();
      expect(om.getInFlightOrderIds()).toHaveLength(0);
      runner.dispose();
      await om.stopLifecycle();
    }
  });

  it("keeps a failed protection cancel authoritative and retries before replacing", async () => {
    const feed = new FailFirstProtectionCancelFeed();
    await feed.open();
    const lifecycle = attachPrivateLifecycle(feed);
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const runner = new StrategyRunner({ instances: new Map(), orderManager: om, positionManager: pm, sizingFn: () => 0, enabledSymbols: [String(makeSymbol())] });
    await om.startLifecycle();
    pm.openPosition("cancel-retry", makeSymbol(), "long", 1, 100, 1);
    const install = (runner["installProtections"] as (input: {
      strategy: "cancel-retry"; symbol: ExchangeSymbol; side: "long"; quantity: number; leverage: number;
      signal: StrategySignal; referencePrice: number;
    }) => Promise<void>).bind(runner);
    const input = {
      strategy: "cancel-retry" as const, symbol: makeSymbol(), side: "long" as const, quantity: 1, leverage: 1,
      signal: { side: "buy" as const, confidence: 1, reason: "cancel-retry", stopLoss: 90, takeProfit: 110 }, referencePrice: 100,
    };
    await install(input);
    const originalIds = om.getInFlightOrderIds();
    await install(input);
    const terminal = originalIds.map((id) => feed.getOrder(id)!).find((order) => order.status === "canceled")!;
    lifecycle.emitOrder(terminal);
    await flushPrivateLifecycle();
    expect([...feed["orderBook"].values()]).toHaveLength(2);
    await install(input); // retries the failed old leg
    const retriedId = originalIds.find((id) => id !== terminal.clientOrderId)!;
    lifecycle.emitOrder(feed.getOrder(retriedId)!);
    await flushPrivateLifecycle();
    expect([...feed["orderBook"].values()]).toHaveLength(4);
    expect(om.getInFlightOrderIds()).toHaveLength(2);
    runner.dispose();
    await om.stopLifecycle();
  });

  it("routes a trailing-stop callback through one reduce-only private close and disarms after its fill", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const lifecycle = attachPrivateLifecycle(feed);
    const rm = new RiskManager({
      trailingStop: { enabled: true, atrPeriod: 2, atrMultiplier: 1, side: "both" },
      kelly: { enabled: false, fraction: 0.25, windowSize: 5, minTrades: 1, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: false, maxDdPct: 0.2, initialEquity: 10_000 },
    });
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    pm.setRiskManager(rm);
    const om = new OrderManager({
      feed, getPositionContext: () => pm.getPositionContext(),
      getReduciblePosition: (symbol) => {
        const position = pm.getPositions().find((item) => item.symbol === symbol);
        return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
      },
    });
    const runner = new StrategyRunner({ instances: new Map(), orderManager: om, positionManager: pm, sizingFn: () => 0, enabledSymbols: ["BTC/USDC"], riskManager: rm });
    await om.startLifecycle();
    const position = pm.openPosition("trail", makeSymbol(), "long", 1, 100, 1);
    rm.onTick({ positionId: position.id, side: "long", currentPrice: 105, atr: 1 });
    rm.onTick({ positionId: position.id, side: "long", currentPrice: 103, atr: 1 });
    await flushPrivateLifecycle();
    const closeId = om.getInFlightOrderIds()[0]!;
    const close = feed.getOrder(closeId)!;
    expect(close.side).toBe("sell");
    lifecycle.emitExecution({
      executionId: "trail-close", clientOrderId: closeId, exchangeOrderId: close.exchangeId, symbol: makeSymbol(), side: "sell",
      quantity: 1, price: 103, fee: 0, feeCurrency: "USDC", timestamp: Date.now(),
    });
    await flushPrivateLifecycle();
    expect(pm.getPositionCount()).toBe(0);
    expect(rm.getSnapshot().trailingStops).toHaveLength(0);
    runner.dispose();
    await om.stopLifecycle();
  });

  it("makes terminal and failed trailing closes retryable without discarding remaining exposure", async () => {
    for (const outcome of ["canceled", "partial", "throw"] as const) {
      const feed = new TrailingCloseOutcomeFeed(outcome);
      await feed.open();
      const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
      const om = new OrderManager({
        feed, getPositionContext: () => pm.getPositionContext(),
        getReduciblePosition: (symbol) => {
          const position = pm.getPositions().find((item) => item.symbol === symbol);
          return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
        },
      });
      const runner = new StrategyRunner({ instances: new Map(), orderManager: om, positionManager: pm, sizingFn: () => 0, enabledSymbols: ["BTC/USDC"] });
      const position = pm.openPosition("retry", makeSymbol(), "long", 1, 100, 1);
      const requestClose = (positionId: string, closePrice: number, reason: string) =>
        (runner["requestTrailingStopClose"] as (id: string, price: number, why: string) => Promise<void>)(positionId, closePrice, reason);
      await requestClose(position.id, 95, outcome);
      const afterFirst = pm.getPosition("retry", makeSymbol(), "long");
      expect(afterFirst?.quantity).toBe(outcome === "partial" ? 0.5 : 1);
      await requestClose(position.id, 94, `${outcome}-retry`);
      expect(om.getCounters().placed).toBe(outcome === "throw" ? 0 : 2);
      runner.dispose();
    }
  });

  // ---------------------------------------------------------------------------
  // 6) getActiveStrategyNames returns strategy names
  // ---------------------------------------------------------------------------
  it("getActiveStrategyNames returns the strategy names", () => {
    const feed = new MockExchangeFeed();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext(), paperMode: true });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.5,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["a" as const, { kind: "strategy" as const, name: "a" as const, instance: strategy as unknown as Strategy }],
      ["b" as const, { kind: "strategy" as const, name: "b" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    expect(runner.getActiveStrategyNames()).toEqual(["a", "b"]);
  });

  // ---------------------------------------------------------------------------
  // 7) Wire with createStrategyInstances (default config, no funding source)
  // ---------------------------------------------------------------------------
  it("works with createStrategyInstances for the default config (without dydx)", () => {
    const config: BotConfig = {
      ...DEFAULT_BOT_CONFIG,
      strategies: {
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    };
    const instances = createStrategyInstances(config);
    expect(instances.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 8) runnerStatsToState — currently a no-op pass-through
  // ---------------------------------------------------------------------------
  it("runnerStatsToState passes the state through unchanged", () => {
    const state = {
      version: 1 as const,
      savedAt: 0,
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    const stats = {
      activeStrategies: [],
      totalSignalsEmitted: 0,
      totalSignalsSuppressed: 0,
      lastSignalTime: null,
    };
    const result = runnerStatsToState(stats, state);
    // Pass-through semantics: same shape, same counter reference.
    expect(result).toEqual(state);
    expect(result.counters).toBe(state.counters);
  });

  // ---------------------------------------------------------------------------
  // 9) setRiskManager / riskManager wiring — Phase 37 Track 1
  // ---------------------------------------------------------------------------
  it("setRiskManager attaches and detaches the risk manager", () => {
    const feed = new MockExchangeFeed();
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext(), paperMode: true });
    const runner = new StrategyRunner({
      instances: new Map(),
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    const rm = new RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: true, fraction: 0.25, windowSize: 50, minTrades: 5, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: false, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    runner.setRiskManager(rm);
    runner.setRiskManager(null);
    runner.setRiskManager(rm);
    // No-op: detaching and re-attaching is supported.
  });

  it("riskManager overrides sizing when set", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 100_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext(), paperMode: true });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["fixed-signal" as const, { kind: "strategy" as const, name: "fixed-signal" as const, instance: strategy as unknown as Strategy }],
    ]);
    const symbol = makeSymbol();
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    const rm = new RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: true, fraction: 0.25, windowSize: 50, minTrades: 5, fallbackFraction: 0.02, maxFraction: 0.1 },
      drawdownScaler: { enabled: false, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    runner.setRiskManager(rm);
    await feed.subscribeOhlcv(symbol, "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_000, 100];
    pushOhlcvTick(feed, symbol, "15m", candle);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    // RiskManager path → fallback 0.02 (cold-start, no trades yet)
    // → quantity = 0.02 × 100_000 / 60_000 ≈ 0.0333
    const pos = pm.getPosition("fixed-signal", symbol, "long");
    expect(pos).toBeDefined();
    expect(pos?.quantity).toBeCloseTo(0.0333, 4);
  });

  it("drawdown scaler kill region blocks new orders when riskManager is set", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({ initialEquityUsd: 100_000, maxPositions: 3, maxLeverage: 10 });
    const om = new OrderManager({ feed, getPositionContext: () => pm.getPositionContext() });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 1,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["fixed-signal" as const, { kind: "strategy" as const, name: "fixed-signal" as const, instance: strategy as unknown as Strategy }],
    ]);
    const symbol = makeSymbol();
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    const rm = new RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: false, fraction: 0.25, windowSize: 50, minTrades: 5, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: true, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    // Pre-warm equity to a kill-region value
    rm.onEquityUpdate(7_000); // -30% from 10k = 150% of 20% → kill
    runner.setRiskManager(rm);
    await feed.subscribeOhlcv(symbol, "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_000, 100];
    pushOhlcvTick(feed, symbol, "15m", candle);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
    // Drawdown scaler in kill region → 0 size → no position
    expect(pm.getPositionCount()).toBe(0);
  });

  // ===========================================================================
  // Phase 67 — position-skip + onOpenPositionUpdate force-exit
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 10) ohlcv with existing position on SAME side does NOT open a new position
  //     (the "donchian_pivot_composition never-closes" bug fix)
  // ---------------------------------------------------------------------------
  it("Phase 67: ohlcv with existing same-side position does NOT open a new one", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
      paperMode: true,
    });
    // Pre-populate a long position for (test-strategy, BTC/USDC).
    pm.openPosition("test-strategy", makeSymbol(), "long", 0.1, 60_000, 1);
    expect(pm.getPositionCount()).toBe(1);

    const strategy = new FixedSignalStrategy({
      side: "buy", // same side as the existing long → should be SKIPPED
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });

    // Send 3 OHLCV ticks with buy signals. The existing long should
    // stay unchanged — NO new positions should be opened, NO entry
    // price averaging should occur.
    for (let i = 0; i < 3; i++) {
      const candle: Ohlcv = [Date.now() + i * 1000, 60_000, 60_500, 59_500, 60_200, 100];
      pushOhlcvTick(feed, makeSymbol(), "15m", candle);
      await new Promise<void>((r) => {
        setTimeout(r, 20);
      });
    }

    // Position count is STILL 1 (no new position opened).
    expect(pm.getPositionCount()).toBe(1);
    // The existing long is unchanged (entry price still 60_000).
    const pos = pm.getPosition("test-strategy", makeSymbol(), "long");
    expect(pos?.entryPrice).toBe(60_000);
    expect(pos?.quantity).toBeCloseTo(0.1, 8);
    // `onCandle` is STILL called every tick (state freshness).
    expect(strategy.onCandleCallCount).toBe(3);
    // `totalSignals` is 0 because the new-signal path was gated.
    // (FixedSignalStrategy always returns a signal, but the runner
    // never reached `handleSignal`.)
    expect(runner.getStats().totalSignals).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 11) ohlcv with existing position on OPPOSITE side does NOT open a new one
  //     (close-on-opposite-signal is OUT of Phase 67 scope; the existing
  //     position stays open until SL/TP/trailing-stop/portfolio-stop closes it)
  // ---------------------------------------------------------------------------
  it("Phase 67: ohlcv with existing opposite-side position does NOT open a new one", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
      paperMode: true,
    });
    // Pre-populate a long position.
    pm.openPosition("test-strategy", makeSymbol(), "long", 0.1, 60_000, 1);
    expect(pm.getPositionCount()).toBe(1);

    const strategy = new FixedSignalStrategy({
      side: "sell", // opposite side as the existing long
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });

    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });

    // Position count is STILL 1 (no new short position opened).
    expect(pm.getPositionCount()).toBe(1);
    // The long is still open.
    const pos = pm.getPosition("test-strategy", makeSymbol(), "long");
    expect(pos).toBeDefined();
    // No new short.
    const shortPos = pm.getPosition("test-strategy", makeSymbol(), "short");
    expect(shortPos).toBeUndefined();
    // `onCandle` was called once.
    expect(strategy.onCandleCallCount).toBe(1);
    // `totalSignals` is 0 (gated).
    expect(runner.getStats().totalSignals).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 12) onOpenPositionUpdate forceExit: true closes the position
  // ---------------------------------------------------------------------------
  it("Phase 67: onOpenPositionUpdate forceExit closes the open position", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
      paperMode: true,
    });
    // Pre-populate a long position.
    pm.openPosition("test-strategy", makeSymbol(), "long", 0.1, 60_000, 1);
    expect(pm.getPositionCount()).toBe(1);

    const strategy = new ForceExitStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["test-strategy" as const, { kind: "strategy" as const, name: "test-strategy" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });

    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });

    // The position was force-closed by the strategy.
    expect(pm.getPositionCount()).toBe(0);
    // onOpenPositionUpdate was called once.
    expect(strategy.onOpenPositionUpdateCallCount).toBe(1);
    // onCandle was also called once.
    expect(strategy.onCandleCallCount).toBe(1);
    // The closed trade is recorded.
    const closed = pm.getClosedTrades();
    expect(closed.length).toBe(1);
    expect(closed[0]?.side).toBe("long");
  });

  // ---------------------------------------------------------------------------
  // 13) Phase 67 regression: getActiveStrategyNames + getStats work after fix
  // ---------------------------------------------------------------------------
  it("Phase 67: getActiveStrategyNames and getStats still work with position-skip", async () => {
    const feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 100_000, total: 100_000 }],
    });
    await feed.open();
    const pm = new PositionManager({
      initialEquityUsd: 100_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const om = new OrderManager({
      feed,
      getPositionContext: () => pm.getPositionContext(),
      paperMode: true,
    });
    const strategy = new FixedSignalStrategy({
      side: "buy",
      confidence: 0.8,
      reason: "test",
      stopLoss: 0,
      takeProfit: 0,
    });
    const instances = new Map([
      ["a" as const, { kind: "strategy" as const, name: "a" as const, instance: strategy as unknown as Strategy }],
      ["b" as const, { kind: "strategy" as const, name: "b" as const, instance: strategy as unknown as Strategy }],
    ]);
    const runner = new StrategyRunner({
      instances,
      orderManager: om,
      positionManager: pm,
      sizingFn: defaultSizingFn,
      enabledSymbols: ["BTC/USDC"],
    });
    expect(runner.getActiveStrategyNames()).toEqual(["a", "b"]);

    // Run a tick; verify stats are sensible.
    await feed.subscribeOhlcv(makeSymbol(), "15m", (event) => {
      void runner.onFeedEvent(event);
    });
    const candle: Ohlcv = [Date.now(), 60_000, 60_500, 59_500, 60_200, 100];
    pushOhlcvTick(feed, makeSymbol(), "15m", candle);
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });

    const stats = runner.getStats();
    expect(stats.ticksProcessed).toBe(1);
    expect(stats.totalSignals).toBe(2); // a + b both fired
    expect(stats.activeStrategies).toEqual(["a", "b"]);
    // Two DIFFERENT strategies, same symbol — each gets its own
    // position (position-skip is per (strategy, symbol), not per
    // symbol). 2 positions opened, both at entry 60_200.
    expect(pm.getPositionCount()).toBe(2);
  });
});
