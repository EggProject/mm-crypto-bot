import {
  asSymbol as runtimeAsSymbol,
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
import {
  ok,
  type Bar,
  type CarryMarket,
  type ConfigError,
  type DydxFundingSource,
  type FundingSnapshot,
  type PluginState,
  type PositionManagementContext,
  type PositionUpdate,
  type Result,
  type SignalBus,
  type Strategy,
  type StrategyContext,
  type StrategyPlugin,
  type StrategySignal,
} from "@mm-crypto-bot/core";
import { ExactRational } from "@mm-crypto-bot/numeric";
import { RecordingLogger } from "@logging-testing";

import { MockExchangeFeed } from "./strategy-runner.exchange-feed.test-support.js";
import { OrderManager as RuntimeOrderManager } from "./order-manager.js";
import { PositionManager as RuntimePositionManager } from "./position-manager.js";
import { StrategyRunner as RuntimeStrategyRunner } from "./strategy-runner.js";
import type { StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import { RiskManager as RuntimeRiskManager } from "../risk/risk-manager.js";

export class OrderManager extends RuntimeOrderManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeOrderManager>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}
export class PositionManager extends RuntimePositionManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimePositionManager>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}
export class StrategyRunner extends RuntimeStrategyRunner {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeStrategyRunner>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}
export class RiskManager extends RuntimeRiskManager {
  public constructor(...arguments_: ConstructorParameters<typeof RuntimeRiskManager>) {
    const [options] = arguments_;
    super({ ...options, logger: new RecordingLogger() });
  }
}
export function makeSymbol(): ExchangeSymbol {
  return runtimeAsSymbol("BTC/USDC");
}

export function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export function copyOrders(orderBook: ReadonlyMap<ClientOrderId, Order>): Order[] {
  const copiedOrders: Order[] = [];
  orderBook.forEach((order) => {
    copiedOrders.push(order);
  });
  return copiedOrders;
}

export class FailTakeProfitFeed extends MockExchangeFeed {
  public override async placeOrder(request: OrderRequest) {
    if (request.protectiveKind === "take_profit") throw new Error("injected TP conditional failure");
    return super.placeOrder(request);
  }
}

export class ManualFundingSource implements DydxFundingSource {
  private listener:
    ((snap: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void) | undefined;
  subscribeCalls = 0;
  closeCalls = 0;
  subscribe(
    _market: CarryMarket,
    listener: (snap: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void,
  ): { readonly close: () => void } {
    this.subscribeCalls += 1;
    this.listener = listener;
    return {
      close: () => {
        this.closeCalls += 1;
        this.listener = undefined;
      },
    };
  }
  fire(timestampMs: number): void {
    this.listener?.({
      dydx: {
        symbol: "BTC-USD",
        fundingTime: timestampMs,
        fundingRate: ExactRational.from("-0.001"),
        markPrice: ExactRational.from("100"),
      },
      cex: {
        symbol: "BTC-USD",
        fundingTime: timestampMs,
        fundingRate: ExactRational.from("0.001"),
        markPrice: ExactRational.from("100"),
      },
    });
  }
  lastTickAgeMs(_market: CarryMarket, _nowMs: number): number | undefined {
    return 0;
  }
  lastChainBlockHeight(_market: CarryMarket): number | undefined {
    return 1;
  }
  lastChainBlockTs(_market: CarryMarket): number | undefined {
    return Date.now();
  }
  bybitEuSpotDepthUsd(_market: CarryMarket, _nowMs: number): number | undefined {
    return 1_000_000;
  }
  health(): { readonly lastTickMs: number | undefined; readonly chainBlockHeight: number | undefined } {
    return { lastTickMs: Date.now(), chainBlockHeight: 1 };
  }
}

export class FailFirstProtectionCancelFeed extends MockExchangeFeed {
  private failed = false;

  public override async cancelOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    if (!this.failed && (clientOrderId.includes("stop_loss") || clientOrderId.includes("take_profit"))) {
      this.failed = true;
      throw new Error("injected protection cancel failure");
    }
    return super.cancelOrder(clientOrderId, symbol);
  }
}

/**
A live acknowledgement with a deterministic terminal/partial outcome.
*/
export class TrailingCloseOutcomeFeed extends MockExchangeFeed {
  public constructor(private readonly outcome: "canceled" | "partial" | "throw") {
    super();
  }

  public override async placeOrder(request: OrderRequest) {
    if (this.outcome === "throw" && request.reduceOnly === true)
      throw new Error("injected trailing close failure");
    const order = await super.placeOrder(request);
    if (request.reduceOnly !== true) return order;
    if (this.outcome === "canceled") return { ...order, status: "canceled" as const };
    return { ...order, status: "closed" as const, filled: order.amount / 2, average: request.price ?? 95 };
  }
}

/**
 * Adds the authenticated private streams absent from MockExchangeFeed.  These
 * callbacks deliberately run through OrderManager.startLifecycle(), keeping
 * the tests on the same normalized production event boundary as CCXT feeds.
 */
export function attachPrivateLifecycle(feed: MockExchangeFeed): {
  readonly emitOrder: (order: Order) => void;
  readonly emitExecution: (execution: Execution) => void;
} {
  let orderListener: FeedListener | undefined;
  let executionListener: FeedListener | undefined;
  Object.assign(feed, {
    subscribeOrderUpdates: (listener: FeedListener) => {
      orderListener = listener;
      return Promise.resolve(9001);
    },
    subscribeExecutions: (listener: FeedListener) => {
      executionListener = listener;
      return Promise.resolve(9002);
    },
  });
  return {
    emitOrder: (order) => orderListener?.({ kind: "order", payload: order }),
    emitExecution: (execution) => executionListener?.({ kind: "execution", payload: execution }),
  };
}

export async function flushPrivateLifecycle(): Promise<void> {
  // Order lifecycle listeners are intentionally fire-and-forget at the feed
  // boundary.  Yield twice so the per-symbol serializer and any conditional
  // protection placement it awaits have both run.
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await Promise.resolve();
}

export class FixedSignalStrategy implements Strategy {
  private readonly _signal: StrategySignal;
  readonly name = "fixed-signal";
  readonly timeframes = ["15m"] as const;
  public onCandleCallCount = 0;
  public observedCallCount = 0;

  public constructor(signal: StrategySignal) {
    this._signal = signal;
  }

  public onCandle(_context: StrategyContext): StrategySignal {
    this.onCandleCallCount++;
    return this._signal;
  }

  public onCandleObserved(_context: StrategyContext): void {
    this.observedCallCount++;
  }

  public warmup(): number {
    return 0;
  }
}

export class ForceExitStrategy implements Strategy {
  private readonly _signal: StrategySignal;
  readonly name = "force-exit-strategy";
  readonly timeframes = ["15m"] as const;
  public onCandleCallCount = 0;
  public onOpenPositionUpdateCallCount = 0;
  public observedCallCount = 0;

  public constructor(signal: StrategySignal) {
    this._signal = signal;
  }

  public onCandle(_context: StrategyContext): StrategySignal {
    this.onCandleCallCount++;
    return this._signal;
  }

  public onOpenPositionUpdate(_context: PositionManagementContext): PositionUpdate {
    this.onOpenPositionUpdateCallCount++;
    return { forceExit: true, reason: "trend_reversal" };
  }

  public onCandleObserved(_context: StrategyContext): void {
    this.observedCallCount++;
  }

  public warmup(): number {
    return 0;
  }
}

/**
Minimal lifecycle probe for the Bot-owned plugin SignalBus wiring.
*/
export class LifecyclePlugin implements StrategyPlugin {
  public subscribeCalls = 0;
  public barCalls = 0;
  public disposeCalls = 0;
  public lastClose: number | undefined;

  public readonly metadata: StrategyPlugin["metadata"] = {
    name: "lifecycle-probe",
    version: "1.0.0",
    edgeClass: "risk" as const,
    capitalRequirement: 0,
    maxAggregateEffectiveLeverage: 1,
    description: "test probe",
    dependencies: [],
  };

  public subscribe(_bus: SignalBus): void {
    this.subscribeCalls += 1;
  }

  public onBar(bar: Bar, _state: PluginState): void {
    this.barCalls += 1;
    this.lastClose = bar.close;
  }

  public reset(): void {
    void 0;
  }

  public validateConfig(_config: unknown): Result<void, ConfigError> {
    return ok(undefined);
  }

  public dispose(): void {
    this.disposeCalls += 1;
  }
}

export class RiskActionPlugin extends LifecyclePlugin {
  private bus: SignalBus | undefined;
  private emitted = false;
  public constructor(
    private readonly source: string,
    private readonly isOnce = false,
  ) {
    super();
  }
  public override subscribe(bus: SignalBus): void {
    super.subscribe(bus);
    this.bus = bus;
  }
  public override onBar(bar: Bar, state: PluginState): void {
    super.onBar(bar, state);
    if (this.isOnce && this.emitted) return;
    this.emitted = true;
    this.bus?.emit({
      kind: "risk",
      varDaily95: 0,
      correlationPenalty: 0,
      drawdownLimit: 0,
      source: this.source,
      breach: true,
      reason: "test-breach",
    });
  }
}

export class AsyncRiskActionPlugin implements StrategyPlugin {
  private bus: SignalBus | undefined;
  public completed = false;

  public readonly metadata: StrategyPlugin["metadata"] = {
    name: "async-risk-probe",
    version: "1.0.0",
    edgeClass: "risk" as const,
    capitalRequirement: 0,
    maxAggregateEffectiveLeverage: 1,
    onBarMode: "async" as const,
  };

  public subscribe(bus: SignalBus): void {
    this.bus = bus;
  }

  public async onBar(_bar: Bar, _state: PluginState): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    this.completed = true;
    this.bus?.emit({
      kind: "risk",
      varDaily95: 0,
      correlationPenalty: 0,
      drawdownLimit: 0,
      source: "async-risk-probe:BTC/USDC",
      breach: true,
      reason: "async-test-breach",
    });
  }

  public reset(): void {
    this.completed = false;
  }
  public validateConfig(_config: unknown): Result<void, ConfigError> {
    return ok(undefined);
  }
  public dispose(): void {
    this.bus = undefined;
  }
}

export class RegimeSizingPlugin extends LifecyclePlugin {
  private bus: SignalBus | undefined;
  public override subscribe(bus: SignalBus): void {
    super.subscribe(bus);
    this.bus = bus;
  }
  public override onBar(bar: Bar, state: PluginState): void {
    super.onBar(bar, state);
    this.bus?.emit({
      kind: "risk",
      varDaily95: 0,
      correlationPenalty: 0,
      drawdownLimit: 0.4,
      source: "regime-detector-v1:BTC/USDC",
      timestampMs: bar.timestamp,
      breach: false,
      reason: "regime-volatile",
      sizeModifier: 0.4,
    });
  }
}

export function pushTickerTick(feed: MockExchangeFeed, symbol: ExchangeSymbol, last: number): void {
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

export function pushOhlcvTick(
  feed: MockExchangeFeed,
  symbol: ExchangeSymbol,
  timeframe: Timeframe,
  candle: Ohlcv,
): void {
  feed.pushEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe, candle },
  });
}

export function makeOhlcvFeedEvent(timestamp: number): FeedEvent {
  return {
    kind: "ohlcv",
    payload: { symbol: makeSymbol(), timeframe: "15m", candle: [timestamp, 100, 101, 99, 100, 1] },
  };
}

export function strategyInstances(
  entries: readonly (readonly [StrategyName, BotStrategyInstance])[],
): ReadonlyMap<StrategyName, BotStrategyInstance> {
  return new Map(entries);
}

export async function executeRiskPluginScenario(source: string, isPaused: boolean): Promise<number> {
  const feed = new MockExchangeFeed();
  await feed.open();
  const positionManager = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
  const orderManager = new OrderManager({
    feed,
    getPositionContext: () => positionManager.getPositionContext(),
  });
  const plugin = new RiskActionPlugin(source);
  let actions = 0;
  const pluginName: StrategyName = "donchian_pivot_composition";
  const instances: ReadonlyMap<StrategyName, BotStrategyInstance> = new Map([
    [pluginName, { kind: "plugin", name: pluginName, instance: plugin }],
  ]);
  const runner = new StrategyRunner({
    instances,
    orderManager,
    positionManager,
    sizingFn: () => 0,
    enabledSymbols: ["BTC/USDC"],
    onEmergency: () => {
      actions += 1;
    },
  });
  if (isPaused) runner.pause();
  await runner.onFeedEvent(makeOhlcvFeedEvent(1));
  await Promise.resolve();
  runner.dispose();
  return actions;
}
export { asSymbol } from "@mm-crypto-bot/exchange";
export { MockExchangeFeed } from "./strategy-runner.exchange-feed.test-support.js";
export { DydxCexCarryStrategy, newKillSwitchVerdicts } from "@mm-crypto-bot/core";
export { defaultSizingFn as defaultSizingFunction, runnerStatsToState } from "./strategy-runner.js";
export { createStrategyInstances } from "../config/strategy-registry.js";
export { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
export type {
  ClientOrderId,
  Execution,
  FeedEvent,
  FeedListener,
  Ohlcv,
  Order,
  OrderRequest,
  Symbol as ExchangeSymbol,
  Ticker,
  Timeframe,
} from "@mm-crypto-bot/exchange";
export type {
  CarryMarket,
  DydxFundingSource,
  FundingSnapshot,
  StrategyPlugin,
  PositionManagementContext,
  PositionUpdate,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "@mm-crypto-bot/core";
export type { BotConfig } from "../config/schema.js";
export type { PortfolioManager } from "../portfolio/portfolio-manager.js";
