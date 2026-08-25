import type {
  Balance,
  ClientOrderId,
  ExchangeFeed,
  ExchangePosition,
  FeedListener,
  MarketMeta,
  Ohlcv,
  Order,
  OrderBook,
  OrderRequest,
  OrderStatus,
  SubscriptionId,
  Symbol as ExchangeSymbol,
  Ticker,
  Timeframe,
} from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/shared";

import type { Bot } from "../../../src/bot/bot.js";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import type { BotConfig } from "../../../src/config/schema.js";

import { RuntimeExchangeFeedFixture } from "./runtime-driver-exchange-fixture.js";

export interface RecordedOrder {
  readonly symbol: string;
  readonly side: OrderRequest["side"];
  readonly type: OrderRequest["type"];
}

const recordedOrderEntries: RecordedOrder[] = [];

export class MockExchangeFeed extends RuntimeExchangeFeedFixture {
  public override async placeOrder(request: OrderRequest): Promise<Order> {
    recordedOrderEntries.push({ symbol: request.symbol, side: request.side, type: request.type });
    return super.placeOrder(request);
  }
}

export function recordedOrders(): readonly RecordedOrder[] {
  return [...recordedOrderEntries];
}

export function clearRecordedOrders(): void {
  recordedOrderEntries.length = 0;
}

const discardLog = (): void => {
  // E2E fixture logging is intentionally discarded.
};

export const quietLogger: Logger = {
  debug: discardLog,
  info: discardLog,
  warn: discardLog,
  error: discardLog,
};

export function withoutLogger<T extends { readonly logger: unknown }>(value: T): Omit<T, "logger"> {
  const { logger, ...remaining } = value;
  void logger;
  return remaining;
}

export function assertCondition(isConditionMet: boolean, message: string): asserts isConditionMet {
  if (!isConditionMet) throw new Error(message);
}

function failWithUnknown(failure: unknown): never {
  throw failure;
}

export async function waitForCondition(
  isConditionMet: () => boolean,
  label: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isConditionMet()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(5);
  }
}

export function expectFailure(action: () => unknown, label: string): void {
  let hasFailed = false;
  try {
    action();
  } catch {
    hasFailed = true;
  }
  assertCondition(hasFailed, `${label} did not fail`);
}

export async function expectAsyncFailure(action: () => Promise<unknown>, label: string): Promise<void> {
  let hasFailed = false;
  try {
    await action();
  } catch {
    hasFailed = true;
  }
  assertCondition(hasFailed, `${label} did not fail`);
}

export interface RecordedLogEntry {
  readonly level: string;
  readonly message: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export class RecordingLogger implements Logger {
  private readonly recordedEntries: RecordedLogEntry[] = [];

  private record(level: string, message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.recordedEntries.push(meta === undefined ? { level, message } : { level, message, meta });
  }

  public get entries(): readonly RecordedLogEntry[] {
    return [...this.recordedEntries];
  }

  public debug(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.record("debug", message, meta);
  }

  public info(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.record("info", message, meta);
  }

  public warn(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.record("warn", message, meta);
  }

  public error(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.record("error", message, meta);
  }
}

export class FailingOhlcvFeed extends MockExchangeFeed {
  public override async subscribeOhlcv(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    if (timeframe === "4h") throw new Error("4h subscription failed");
    if (timeframe === "15m") return failWithUnknown("15m subscription failed");
    return super.subscribeOhlcv(symbol, timeframe, listener);
  }
}

export class BlockingTickerFeed extends MockExchangeFeed {
  private release: (() => void) | undefined;
  public tickerSubscriptionStarted = false;

  public override async subscribeTicker(
    symbol: ExchangeSymbol,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    this.tickerSubscriptionStarted = true;
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    void symbol;
    void listener;
    return 30_000;
  }

  public releaseTickerSubscription(): void {
    this.release?.();
  }
}

export class CleanupFailureFeed extends MockExchangeFeed {
  private nextPrivateId = 20_000;

  public constructor(
    private readonly lifecycleFailure: unknown,
    private readonly closeFailure: unknown,
  ) {
    super({ balances: [{ currency: "USDC", free: 10_000, total: 10_000 }] });
  }

  public subscribeOrderUpdates(_listener: FeedListener): Promise<SubscriptionId> {
    return Promise.resolve(this.nextPrivateId++);
  }

  public subscribeExecutions(_listener: FeedListener): Promise<SubscriptionId> {
    return Promise.resolve(this.nextPrivateId++);
  }

  public override async unsubscribe(id: SubscriptionId): Promise<void> {
    if (id >= 20_000) {
      await Promise.resolve();
      return failWithUnknown(this.lifecycleFailure);
    }
    await super.unsubscribe(id);
  }

  public override async close(): Promise<void> {
    await Promise.resolve();
    return failWithUnknown(this.closeFailure);
  }
}

export class AllUnsubscribeFailureFeed extends MockExchangeFeed {
  public override unsubscribe(_id: SubscriptionId): Promise<void> {
    return Promise.reject(new Error("scripted public unsubscribe failure"));
  }
}

export class ReconciliationFeed extends MockExchangeFeed {
  public balanceCalls = 0;
  public positionCalls = 0;
  public tickerCalls = 0;

  public constructor(
    private readonly initialBalances: readonly Balance[],
    private readonly reconciledBalances: readonly Balance[] | Error | string,
    options: ConstructorParameters<typeof MockExchangeFeed>[0] = {},
  ) {
    super({ ...options, balances: initialBalances });
  }

  public override async fetchBalances(): Promise<readonly Balance[]> {
    this.balanceCalls += 1;
    await Promise.resolve();
    if (this.balanceCalls === 1) return this.initialBalances;
    if (this.reconciledBalances instanceof Error || typeof this.reconciledBalances === "string") {
      return failWithUnknown(this.reconciledBalances);
    }
    return this.reconciledBalances;
  }

  public override fetchPositions(symbols?: readonly ExchangeSymbol[]): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    return super.fetchPositions(symbols);
  }

  public override fetchTickerSnapshot(symbol: ExchangeSymbol): Promise<Ticker> {
    this.tickerCalls += 1;
    return super.fetchTickerSnapshot(symbol);
  }
}

export class PositionFaultReconciliationFeed extends ReconciliationFeed {
  public constructor(
    private readonly positionFailure: unknown,
    balances: readonly Balance[],
  ) {
    super(balances, balances);
  }

  public override async fetchPositions(): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    await Promise.resolve();
    return failWithUnknown(this.positionFailure);
  }
}

export class SlowReconciliationFeed extends MockExchangeFeed {
  public balanceCalls = 0;

  public constructor() {
    super({ balances: [{ currency: "USDC", free: 1000, total: 1000 }] });
  }

  public override async fetchBalances(): Promise<readonly Balance[]> {
    this.balanceCalls += 1;
    if (this.balanceCalls > 1) await Bun.sleep(30);
    return [{ currency: "USDC", free: 1000, total: 1000 }];
  }
}

export class SequencedBalanceFeed extends MockExchangeFeed {
  private readonly reconciled: readonly number[];
  public balanceCalls = 0;

  public constructor(values: readonly number[]) {
    const initial = values[0] ?? 1000;
    super({ balances: [{ currency: "USDC", free: initial, total: initial }] });
    this.reconciled = [...values];
  }

  public override fetchBalances(): Promise<readonly Balance[]> {
    const value = this.reconciled[Math.min(this.balanceCalls, this.reconciled.length - 1)] ?? 1000;
    this.balanceCalls += 1;
    return Promise.resolve([{ currency: "USDC", free: value, total: value }]);
  }
}

export class NoPositionsFeed implements ExchangeFeed {
  private readonly delegate = new MockExchangeFeed({
    balances: [{ currency: "USDC", free: 1000, total: 1000 }],
  });
  public readonly exchangeId = "scripted-no-positions";
  public readonly statusOf = (status: string): OrderStatus => this.delegate.statusOf(status);

  public open(): Promise<void> {
    return this.delegate.open();
  }
  public subscribeTicker(symbol: ExchangeSymbol, listener: FeedListener): Promise<SubscriptionId> {
    return this.delegate.subscribeTicker(symbol, listener);
  }
  public subscribeOrderBook(
    symbol: ExchangeSymbol,
    limit: number,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    return this.delegate.subscribeOrderBook(symbol, limit, listener);
  }
  public subscribeTrades(symbol: ExchangeSymbol, listener: FeedListener): Promise<SubscriptionId> {
    return this.delegate.subscribeTrades(symbol, listener);
  }
  public subscribeOhlcv(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    return this.delegate.subscribeOhlcv(symbol, timeframe, listener);
  }
  public unsubscribe(id: SubscriptionId): Promise<void> {
    return this.delegate.unsubscribe(id);
  }
  public fetchTickerSnapshot(symbol: ExchangeSymbol): Promise<Ticker> {
    return this.delegate.fetchTickerSnapshot(symbol);
  }
  public fetchOrderBookSnapshot(symbol: ExchangeSymbol, limit: number): Promise<OrderBook> {
    return this.delegate.fetchOrderBookSnapshot(symbol, limit);
  }
  public fetchOHLCV(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    since: number | undefined,
    limit: number,
  ): Promise<readonly Ohlcv[]> {
    return this.delegate.fetchOHLCV(symbol, timeframe, since, limit);
  }
  public fetchMarketMeta(symbol: ExchangeSymbol): Promise<MarketMeta> {
    return this.delegate.fetchMarketMeta(symbol);
  }
  public fetchBalances(): Promise<readonly Balance[]> {
    return this.delegate.fetchBalances();
  }
  public placeOrder(request: OrderRequest): Promise<Order> {
    return this.delegate.placeOrder(request);
  }
  public cancelOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    return this.delegate.cancelOrder(clientOrderId, symbol);
  }
  public fetchOrder(clientOrderId: ClientOrderId, symbol: ExchangeSymbol): Promise<Order> {
    return this.delegate.fetchOrder(clientOrderId, symbol);
  }
  public fetchOpenOrders(symbol: ExchangeSymbol): Promise<readonly Order[]> {
    return this.delegate.fetchOpenOrders(symbol);
  }
  public close(): Promise<void> {
    return this.delegate.close();
  }
  public subscriptionCount(): number {
    return this.delegate.subscriptionCount();
  }
}

export function botConfigFor(stateFile: string): BotConfig {
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

export async function startBotThenStop(bot: Bot, feed: MockExchangeFeed): Promise<void> {
  const running = bot.start();
  await waitForCondition(() => feed.subscriptionCount() > 0, "bot subscription");
  await bot.stop();
  await running;
}
