import {
  type Balance,
  type ClientOrderId,
  type ExchangeFeed,
  type ExchangePosition,
  type FeedListener,
  type MarketMeta,
  type Ohlcv,
  type Order,
  type OrderBook,
  type OrderRequest,
  type OrderStatus,
  type SubscriptionId,
  type Symbol as ExchangeSymbol,
  type Ticker,
  type Timeframe,
} from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/logging";
import { RuntimeExchangeFeedFixture as BaseMockExchangeFeed } from "./runtime-driver-exchange-fixture.js";
const placeOrderLedger: {
  readonly symbol: string;
  readonly side: OrderRequest["side"];
  readonly type: OrderRequest["type"];
}[] = [];

class MockExchangeFeed extends BaseMockExchangeFeed {
  public override async placeOrder(request: OrderRequest): Promise<Order> {
    placeOrderLedger.push({ symbol: request.symbol, side: request.side, type: request.type });
    return super.placeOrder(request);
  }
}

function withoutLogger<T extends { readonly logger: unknown }>(value: T): Omit<T, "logger"> {
  const { logger, ...remaining } = value;
  void logger;
  return remaining;
}

// eslint-disable-next-line unicorn/consistent-boolean-name -- The E2E fixture preserves the asserted protocol behavior.
function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// eslint-disable-next-line unicorn/consistent-boolean-name -- The E2E fixture preserves the asserted protocol behavior.
async function waitForCondition(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(5);
  }
}

function expectFailure(action: () => unknown, label: string): void {
  let isFailed = false;
  try {
    action();
  } catch {
    isFailed = true;
  }
  assertCondition(isFailed, `${label} did not fail`);
}

async function expectAsyncFailure(action: () => Promise<unknown>, label: string): Promise<void> {
  let isFailed = false;
  try {
    await action();
  } catch {
    isFailed = true;
  }
  assertCondition(isFailed, `${label} did not fail`);
}

class RecordingLogger implements Logger {
  public readonly entries: {
    readonly level: string;
    readonly message: string;
    readonly meta?: Readonly<Record<string, unknown>>;
  }[] = [];

  private record(level: string, message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.entries.push(meta === undefined ? { level, message } : { level, message, meta });
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
  public critical(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.record("critical", message, meta);
  }
}

const quietLogger: Logger = new RecordingLogger();

class FailingOhlcvFeed extends MockExchangeFeed {
  public override async subscribeOhlcv(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    if (timeframe === "4h") throw new Error("4h subscription failed");
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fault injection verifies normalization of non-Error failures.
    if (timeframe === "15m") throw "15m subscription failed";
    return super.subscribeOhlcv(symbol, timeframe, listener);
  }
}

class BlockingTickerFeed extends MockExchangeFeed {
  // eslint-disable-next-line unicorn/no-null -- The E2E boundary preserves the explicit null contract under test.
  private release: (() => void) | null = null;
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

class CleanupFailureFeed extends MockExchangeFeed {
  private nextPrivateId = 20_000;

  public constructor(
    private readonly lifecycleFailure: unknown,
    private readonly closeFailure: unknown,
  ) {
    super({ balances: [{ currency: "USDC", free: 10_000, total: 10_000 }] });
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
  public async subscribeOrderUpdates(_listener: FeedListener): Promise<SubscriptionId> {
    return this.nextPrivateId++;
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
  public async subscribeExecutions(_listener: FeedListener): Promise<SubscriptionId> {
    return this.nextPrivateId++;
  }

  public override async unsubscribe(id: SubscriptionId): Promise<void> {
    if (id >= 20_000) throw this.lifecycleFailure;
    await super.unsubscribe(id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
  public override async close(): Promise<void> {
    throw this.closeFailure;
  }
}

class AllUnsubscribeFailureFeed extends MockExchangeFeed {
  // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
  public override async unsubscribe(_id: SubscriptionId): Promise<void> {
    throw new Error("scripted public unsubscribe failure");
  }
}

class ReconciliationFeed extends MockExchangeFeed {
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

  // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
  public override async fetchBalances(): Promise<readonly Balance[]> {
    this.balanceCalls += 1;
    if (this.balanceCalls === 1) return this.initialBalances;
    if (this.reconciledBalances instanceof Error || typeof this.reconciledBalances === "string") {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fault injection verifies normalization of non-Error failures.
      throw this.reconciledBalances;
    }
    return this.reconciledBalances;
  }

  public override async fetchPositions(
    symbols?: readonly ExchangeSymbol[],
  ): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    return super.fetchPositions(symbols);
  }

  public override async fetchTickerSnapshot(symbol: ExchangeSymbol): Promise<Ticker> {
    this.tickerCalls += 1;
    return super.fetchTickerSnapshot(symbol);
  }
}

class PositionFaultReconciliationFeed extends ReconciliationFeed {
  public constructor(
    private readonly positionFailure: unknown,
    balances: readonly Balance[],
  ) {
    super(balances, balances);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
  public override async fetchPositions(): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    throw this.positionFailure;
  }
}

class SlowReconciliationFeed extends MockExchangeFeed {
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

class SequencedBalanceFeed extends MockExchangeFeed {
  private readonly reconciled: number[];
  public balanceCalls = 0;

  public constructor(values: readonly number[]) {
    const initial = values[0] ?? 1000;
    super({ balances: [{ currency: "USDC", free: initial, total: initial }] });
    this.reconciled = [...values];
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- This test double implements an asynchronous production port synchronously.
  public override async fetchBalances(): Promise<readonly Balance[]> {
    const value = this.reconciled[Math.min(this.balanceCalls, this.reconciled.length - 1)] ?? 1000;
    this.balanceCalls += 1;
    return [{ currency: "USDC", free: value, total: value }];
  }
}

class NoPositionsFeed implements ExchangeFeed {
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

export {
  MockExchangeFeed,
  quietLogger,
  withoutLogger,
  assertCondition,
  waitForCondition,
  expectFailure,
  expectAsyncFailure,
  RecordingLogger,
  FailingOhlcvFeed,
  BlockingTickerFeed,
  CleanupFailureFeed,
  AllUnsubscribeFailureFeed,
  ReconciliationFeed,
  PositionFaultReconciliationFeed,
  SlowReconciliationFeed,
  SequencedBalanceFeed,
  NoPositionsFeed,
  placeOrderLedger,
};
