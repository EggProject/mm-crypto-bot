import type {
  Balance,
  ClientOrderId,
  ExchangeFeed,
  ExchangePosition,
  FeedEvent,
  FeedListener,
  MarketMeta,
  Ohlcv,
  Order,
  OrderBook,
  OrderRequest,
  OrderStatus,
  Symbol as ExchangeSymbol,
  Ticker,
  Timeframe,
} from "@mm-crypto-bot/exchange";

interface Subscription {
  readonly id: number;
  readonly kind: "ticker" | "orderbook" | "trade" | "ohlcv";
  readonly symbol: ExchangeSymbol;
  readonly timeframe: Timeframe | undefined;
  readonly listener: FeedListener;
}

export interface MockExchangeFeedOptions {
  readonly balances?: readonly Balance[];
  readonly tickerSnapshot?: ReadonlyMap<ExchangeSymbol, Ticker>;
  readonly orderBookSnapshot?: ReadonlyMap<ExchangeSymbol, OrderBook>;
  readonly marketMeta?: ReadonlyMap<ExchangeSymbol, MarketMeta>;
  readonly ohlcvSnapshot?: ReadonlyMap<string, readonly Ohlcv[]>;
  readonly exchangeId?: string;
  readonly positions?: readonly ExchangePosition[];
}

export class MockExchangeFeed implements ExchangeFeed {
  private readonly subscriptions = new Map<number, Subscription>();
  private balances: Balance[];
  private readonly tickerSnapshots = new Map<ExchangeSymbol, Ticker>();
  private readonly orderBookSnapshots = new Map<ExchangeSymbol, OrderBook>();
  private readonly marketMeta = new Map<ExchangeSymbol, MarketMeta>();
  private readonly ohlcvSnapshots = new Map<string, readonly Ohlcv[]>();
  private positions: ExchangePosition[];
  private nextSubscriptionId = 1;
  private opened = false;
  public readonly exchangeId: string;
  public readonly orderBook = new Map<ClientOrderId, Order>();
  public readonly statusOf = (status: string): OrderStatus => {
    if (status === "open") return "open";
    if (status === "closed" || status === "filled") return "closed";
    return status === "canceled" ? "canceled" : "open";
  };

  public constructor(options: MockExchangeFeedOptions = {}) {
    this.exchangeId = options.exchangeId ?? "strategy-runner-test";
    this.balances = [...(options.balances ?? [{ currency: "USDC", free: 10_000, total: 10_000 }])];
    this.positions = [...(options.positions ?? [])];
    this.copyEntries(options.tickerSnapshot, this.tickerSnapshots);
    this.copyEntries(options.orderBookSnapshot, this.orderBookSnapshots);
    this.copyEntries(options.marketMeta, this.marketMeta);
    this.copyEntries(options.ohlcvSnapshot, this.ohlcvSnapshots);
  }

  private copyEntries<K, V>(source: ReadonlyMap<K, V> | undefined, target: Map<K, V>): void {
    if (source === undefined) return;
    for (const [key, value] of source) target.set(key, value);
  }

  private subscribe(
    kind: Subscription["kind"],
    symbol: ExchangeSymbol,
    timeframe: Timeframe | undefined,
    listener: FeedListener,
  ): number {
    this.assertOpen();
    const id = this.nextSubscriptionId++;
    this.subscriptions.set(id, { id, kind, symbol, timeframe, listener });
    return id;
  }

  private requireOrder(clientOrderId: ClientOrderId): Order {
    const order = this.orderBook.get(clientOrderId);
    if (order === undefined) throw new Error(`unknown test order: ${clientOrderId}`);
    return order;
  }

  private assertOpen(): void {
    if (!this.opened) throw new Error("test feed is not open");
  }

  private defaultTicker(symbol: ExchangeSymbol): Ticker {
    return { symbol, timestamp: 0, bid: 59_999, ask: 60_001, last: 60_000, baseVolume: 0, quoteVolume: 0 };
  }

  private defaultOrderBook(symbol: ExchangeSymbol): OrderBook {
    const ticker = this.defaultTicker(symbol);
    return {
      symbol,
      timestamp: 0,
      nonce: 0,
      bids: [{ price: ticker.bid, amount: 1 }],
      asks: [{ price: ticker.ask, amount: 1 }],
    };
  }

  private defaultMarketMeta(symbol: ExchangeSymbol): MarketMeta {
    const [base = "UNKNOWN", quote = "USDC"] = symbol.split("/", 2);
    return {
      symbol,
      base,
      quote,
      amountPrecision: 4,
      pricePrecision: 2,
      minAmount: 0.0001,
      minCost: 1,
      isSpot: true,
    };
  }

  private defaultOhlcv(symbol: ExchangeSymbol): readonly Ohlcv[] {
    return [[0, 60_000, 60_001, 59_999, this.defaultTicker(symbol).last, 1]];
  }

  public open(): Promise<void> {
    this.opened = true;
    return Promise.resolve();
  }

  public close(): Promise<void> {
    this.subscriptions.clear();
    this.opened = false;
    return Promise.resolve();
  }

  public subscribeTicker(symbol: ExchangeSymbol, listener: FeedListener): Promise<number> {
    return Promise.resolve(this.subscribe("ticker", symbol, undefined, listener));
  }

  public subscribeOrderBook(symbol: ExchangeSymbol, _limit: number, listener: FeedListener): Promise<number> {
    return Promise.resolve(this.subscribe("orderbook", symbol, undefined, listener));
  }

  public subscribeTrades(symbol: ExchangeSymbol, listener: FeedListener): Promise<number> {
    return Promise.resolve(this.subscribe("trade", symbol, undefined, listener));
  }

  public subscribeOhlcv(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<number> {
    return Promise.resolve(this.subscribe("ohlcv", symbol, timeframe, listener));
  }

  public unsubscribe(id: number): Promise<void> {
    this.subscriptions.delete(id);
    return Promise.resolve();
  }

  public fetchTickerSnapshot(symbol: ExchangeSymbol): Promise<Ticker> {
    this.assertOpen();
    return Promise.resolve(this.tickerSnapshots.get(symbol) ?? this.defaultTicker(symbol));
  }

  public fetchOrderBookSnapshot(symbol: ExchangeSymbol, _limit: number): Promise<OrderBook> {
    this.assertOpen();
    return Promise.resolve(this.orderBookSnapshots.get(symbol) ?? this.defaultOrderBook(symbol));
  }

  public fetchOHLCV(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    since: number | undefined,
    limit: number,
  ): Promise<readonly Ohlcv[]> {
    this.assertOpen();
    const history = this.ohlcvSnapshots.get(`${symbol}::${timeframe}`) ?? this.defaultOhlcv(symbol);
    const filtered = since === undefined ? history : history.filter((candle) => candle[0] >= since);
    return Promise.resolve(filtered.slice(-limit));
  }

  public fetchMarketMeta(symbol: ExchangeSymbol): Promise<MarketMeta> {
    this.assertOpen();
    return Promise.resolve(this.marketMeta.get(symbol) ?? this.defaultMarketMeta(symbol));
  }

  public fetchBalances(): Promise<readonly Balance[]> {
    this.assertOpen();
    const balances: Balance[] = [];
    for (const balance of this.balances) balances.push(balance);
    return Promise.resolve(balances);
  }

  public fetchPositions(symbols?: readonly ExchangeSymbol[]): Promise<readonly ExchangePosition[]> {
    this.assertOpen();
    const positions: ExchangePosition[] = [];
    for (const position of this.positions) {
      if (symbols === undefined || symbols.includes(position.symbol)) positions.push(position);
    }
    return Promise.resolve(positions);
  }

  public placeOrder(request: OrderRequest): Promise<Order> {
    this.assertOpen();
    if (request.type === "limit" && request.price === undefined) {
      throw new Error(`test feed requires a limit price: ${request.clientOrderId}`);
    }
    const submittedAt = Date.now();
    const order: Order = {
      clientOrderId: request.clientOrderId,
      exchangeId: undefined,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      amount: request.amount,
      price: request.price,
      status: "open",
      filled: 0,
      average: undefined,
      submitTimestamp: submittedAt,
      updateTimestamp: submittedAt,
    };
    this.orderBook.set(request.clientOrderId, order);
    return Promise.resolve(order);
  }

  public cancelOrder(clientOrderId: ClientOrderId, _symbol: ExchangeSymbol): Promise<Order> {
    this.assertOpen();
    const order = this.requireOrder(clientOrderId);
    const cancelled = { ...order, status: "canceled" as const, updateTimestamp: Date.now() };
    this.orderBook.set(clientOrderId, cancelled);
    return Promise.resolve(cancelled);
  }

  public fetchOrder(clientOrderId: ClientOrderId, _symbol: ExchangeSymbol): Promise<Order> {
    this.assertOpen();
    return Promise.resolve(this.requireOrder(clientOrderId));
  }

  public fetchOpenOrders(_symbol: ExchangeSymbol): Promise<readonly Order[]> {
    this.assertOpen();
    const openOrders: Order[] = [];
    for (const order of this.orderBook.values()) {
      if (order.status === "open") openOrders.push(order);
    }
    return Promise.resolve(openOrders);
  }

  public pushEvent(event: FeedEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.kind !== event.kind || subscription.symbol !== event.payload.symbol) continue;
      if (
        subscription.kind === "ohlcv" &&
        event.kind === "ohlcv" &&
        subscription.timeframe !== event.payload.timeframe
      )
        continue;
      subscription.listener(event);
    }
  }

  public setTicker(symbol: ExchangeSymbol, ticker: Ticker): void {
    this.tickerSnapshots.set(symbol, ticker);
  }

  public setOhlcv(symbol: ExchangeSymbol, timeframe: Timeframe, history: readonly Ohlcv[]): void {
    this.ohlcvSnapshots.set(`${symbol}::${timeframe}`, history);
  }

  public setBalance(currency: string, free: number, total: number): void {
    const index = this.balances.findIndex((balance) => balance.currency === currency);
    if (index === -1) this.balances.push({ currency, free, total });
    else {
      this.balances = this.balances.map((balance, balanceIndex) =>
        balanceIndex === index ? { currency, free, total } : balance,
      );
    }
  }

  public setPositions(positions: readonly ExchangePosition[]): void {
    this.positions = [...positions];
  }

  public getOrder(clientOrderId: ClientOrderId): Order | undefined {
    return this.orderBook.get(clientOrderId);
  }

  public setOrderStatus(clientOrderId: ClientOrderId, patch: Partial<Order>): void {
    const order = this.orderBook.get(clientOrderId);
    if (order !== undefined)
      this.orderBook.set(clientOrderId, { ...order, ...patch, updateTimestamp: Date.now() });
  }

  public subscriptionCount(): number {
    return this.subscriptions.size;
  }
}
