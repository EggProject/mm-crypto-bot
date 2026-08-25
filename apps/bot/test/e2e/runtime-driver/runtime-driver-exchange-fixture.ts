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
  SubscriptionId,
  Symbol,
  Ticker,
  Timeframe,
} from "@mm-crypto-bot/exchange";

type RuntimeSubscriptionKind = "ticker" | "orderbook" | "trade" | "ohlcv";

interface RuntimeSubscription {
  readonly kind: RuntimeSubscriptionKind;
  readonly symbol: Symbol;
  readonly timeframe: Timeframe | undefined;
  readonly listener: FeedListener;
}

export interface RuntimeExchangeFeedFixtureOptions {
  readonly balances?: readonly Balance[];
  readonly tickerSnapshot?: ReadonlyMap<Symbol, Ticker>;
  readonly orderBookSnapshot?: ReadonlyMap<Symbol, OrderBook>;
  readonly marketMeta?: ReadonlyMap<Symbol, MarketMeta>;
  readonly ohlcvSnapshot?: ReadonlyMap<string, readonly Ohlcv[]>;
  readonly exchangeId?: string;
  readonly positions?: readonly ExchangePosition[];
}

export class RuntimeExchangeFeedFixture implements ExchangeFeed {
  private readonly subscriptions = new Map<SubscriptionId, RuntimeSubscription>();
  private balances: Balance[];
  private readonly tickerSnapshots: Map<Symbol, Ticker>;
  private readonly orderBookSnapshots: Map<Symbol, OrderBook>;
  private readonly marketMetaSnapshots: Map<Symbol, MarketMeta>;
  private readonly ohlcvSnapshots: Map<string, readonly Ohlcv[]>;
  private readonly orders = new Map<ClientOrderId, Order>();
  private positions: ExchangePosition[];
  private nextSubscriptionId: SubscriptionId = 1;
  private isOpen = false;
  public readonly exchangeId: string;
  public readonly statusOf = (status: string): OrderStatus => {
    switch (status) {
      case "open":
      case "closed":
      case "canceled": {
        return status;
      }
      case "filled": {
        return "closed";
      }
      default: {
        return "open";
      }
    }
  };

  public constructor(options: RuntimeExchangeFeedFixtureOptions = {}) {
    this.exchangeId = options.exchangeId ?? "mock";
    this.balances = [...(options.balances ?? [{ currency: "USDC", free: 10_000, total: 10_000 }])];
    this.tickerSnapshots = new Map(options.tickerSnapshot);
    this.orderBookSnapshots = new Map(options.orderBookSnapshot);
    this.marketMetaSnapshots = new Map(options.marketMeta);
    this.ohlcvSnapshots = new Map(options.ohlcvSnapshot);
    this.positions = [...(options.positions ?? [])];
  }

  private addSubscription(
    kind: RuntimeSubscriptionKind,
    symbol: Symbol,
    timeframe: Timeframe | undefined,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    this.requireOpen();
    const id = this.nextSubscriptionId;
    this.nextSubscriptionId += 1;
    this.subscriptions.set(id, { kind, symbol, timeframe, listener });
    return Promise.resolve(id);
  }

  private requireOpen(): void {
    if (!this.isOpen) throw new Error("E2E exchange fixture is not open");
  }

  public open(): Promise<void> {
    this.isOpen = true;
    return Promise.resolve();
  }

  public close(): Promise<void> {
    this.subscriptions.clear();
    this.isOpen = false;
    return Promise.resolve();
  }

  public subscribeTicker(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId> {
    return this.addSubscription("ticker", symbol, undefined, listener);
  }

  public subscribeOrderBook(symbol: Symbol, _limit: number, listener: FeedListener): Promise<SubscriptionId> {
    return this.addSubscription("orderbook", symbol, undefined, listener);
  }

  public subscribeTrades(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId> {
    return this.addSubscription("trade", symbol, undefined, listener);
  }

  public subscribeOhlcv(
    symbol: Symbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    return this.addSubscription("ohlcv", symbol, timeframe, listener);
  }

  public unsubscribe(id: SubscriptionId): Promise<void> {
    this.subscriptions.delete(id);
    return Promise.resolve();
  }

  public fetchTickerSnapshot(symbol: Symbol): Promise<Ticker> {
    this.requireOpen();
    return Promise.resolve(this.tickerSnapshots.get(symbol) ?? defaultTicker(symbol));
  }

  public fetchOrderBookSnapshot(symbol: Symbol, _limit: number): Promise<OrderBook> {
    this.requireOpen();
    return Promise.resolve(this.orderBookSnapshots.get(symbol) ?? defaultOrderBook(symbol));
  }

  public fetchOHLCV(
    symbol: Symbol,
    timeframe: Timeframe,
    since: number | undefined,
    limit: number,
  ): Promise<readonly Ohlcv[]> {
    this.requireOpen();
    const candles =
      this.ohlcvSnapshots.get(`${symbol}::${timeframe}`) ?? defaultOhlcvHistory(symbol, timeframe);
    const afterSince = since === undefined ? candles : candles.filter((candle) => candle[0] >= since);
    return Promise.resolve(afterSince.slice(-limit));
  }

  public fetchMarketMeta(symbol: Symbol): Promise<MarketMeta> {
    this.requireOpen();
    return Promise.resolve(this.marketMetaSnapshots.get(symbol) ?? defaultMarketMeta(symbol));
  }

  public fetchBalances(): Promise<readonly Balance[]> {
    this.requireOpen();
    return Promise.resolve([...this.balances]);
  }

  public fetchPositions(symbols?: readonly Symbol[]): Promise<readonly ExchangePosition[]> {
    this.requireOpen();
    return Promise.resolve(
      symbols === undefined
        ? [...this.positions]
        : this.positions.filter(({ symbol }) => symbols.includes(symbol)),
    );
  }

  public placeOrder(request: OrderRequest): Promise<Order> {
    this.requireOpen();
    if (request.type === "limit" && request.price === undefined) {
      return Promise.reject(new Error(`limit order requires a price: ${request.clientOrderId}`));
    }
    const timestamp = Date.now();
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
      submitTimestamp: timestamp,
      updateTimestamp: timestamp,
    };
    this.orders.set(request.clientOrderId, order);
    return Promise.resolve(order);
  }

  public cancelOrder(clientOrderId: ClientOrderId, _symbol: Symbol): Promise<Order> {
    this.requireOpen();
    const order = this.orders.get(clientOrderId);
    if (order === undefined) return Promise.reject(new Error(`unknown order: ${clientOrderId}`));
    const cancelled: Order = { ...order, status: "canceled", updateTimestamp: Date.now() };
    this.orders.set(clientOrderId, cancelled);
    return Promise.resolve(cancelled);
  }

  public fetchOrder(clientOrderId: ClientOrderId, _symbol: Symbol): Promise<Order> {
    this.requireOpen();
    const order = this.orders.get(clientOrderId);
    return order === undefined
      ? Promise.reject(new Error(`unknown order: ${clientOrderId}`))
      : Promise.resolve(order);
  }

  public fetchOpenOrders(_symbol: Symbol): Promise<readonly Order[]> {
    this.requireOpen();
    const openOrders: Order[] = [];
    for (const order of this.orders.values()) {
      if (order.status === "open") openOrders.push(order);
    }
    return Promise.resolve(openOrders);
  }

  public pushEvent(event: FeedEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.kind !== event.kind || subscription.symbol !== event.payload.symbol) continue;
      if (event.kind === "ohlcv" && subscription.timeframe !== event.payload.timeframe) continue;
      subscription.listener(event);
    }
  }

  public setTicker(symbol: Symbol, ticker: Ticker): void {
    this.tickerSnapshots.set(symbol, ticker);
  }

  public setOhlcv(symbol: Symbol, timeframe: Timeframe, candles: readonly Ohlcv[]): void {
    this.ohlcvSnapshots.set(`${symbol}::${timeframe}`, candles);
  }

  public setBalance(currency: string, free: number, total: number): void {
    const index = this.balances.findIndex((balance) => balance.currency === currency);
    if (index === -1) this.balances.push({ currency, free, total });
    else
      this.balances = this.balances.map((balance) =>
        balance.currency === currency ? { currency, free, total } : balance,
      );
  }

  public setPositions(positions: readonly ExchangePosition[]): void {
    this.positions = [...positions];
  }

  public getOrder(clientOrderId: ClientOrderId): Order | undefined {
    return this.orders.get(clientOrderId);
  }

  public setOrderStatus(clientOrderId: ClientOrderId, patch: Partial<Order>): void {
    const order = this.orders.get(clientOrderId);
    if (order !== undefined)
      this.orders.set(clientOrderId, { ...order, ...patch, updateTimestamp: Date.now() });
  }

  public subscriptionCount(): number {
    return this.subscriptions.size;
  }
}

function defaultTicker(symbol: Symbol): Ticker {
  const last = defaultLastPrice(symbol);
  return { symbol, timestamp: 0, bid: last - 1, ask: last + 1, last, baseVolume: 0, quoteVolume: 0 };
}

function defaultOrderBook(symbol: Symbol): OrderBook {
  const ticker = defaultTicker(symbol);
  return {
    symbol,
    timestamp: 0,
    nonce: 0,
    bids: [{ price: ticker.bid, amount: 1 }],
    asks: [{ price: ticker.ask, amount: 1 }],
  };
}

function defaultMarketMeta(symbol: Symbol): MarketMeta {
  const slashIndex = symbol.indexOf("/");
  return {
    symbol,
    base: slashIndex === -1 ? "UNKNOWN" : symbol.slice(0, slashIndex),
    quote: slashIndex === -1 ? "USDC" : symbol.slice(slashIndex + 1),
    amountPrecision: 4,
    pricePrecision: 2,
    minAmount: 0.0001,
    minCost: 1,
    isSpot: true,
  };
}

function defaultOhlcvHistory(symbol: Symbol, timeframe: Timeframe): readonly Ohlcv[] {
  const timeframeMs = timeframeDuration(timeframe);
  const latestTimestamp = Date.now() - (Date.now() % timeframeMs);
  const basePrice = defaultLastPrice(symbol);
  const candles: Ohlcv[] = [];
  for (let offset = 49; offset >= 0; offset -= 1) {
    const timestamp = latestTimestamp - offset * timeframeMs;
    const seed = Math.trunc(timestamp / timeframeMs);
    const open = basePrice + (((seed * 31) % 100) - 50) * (basePrice * 0.001);
    const close = open + (((seed * 17) % 100) - 50) * (basePrice * 0.001);
    candles.push([timestamp, open, Math.max(open, close), Math.min(open, close), close, 1]);
  }
  return candles;
}

function defaultLastPrice(symbol: Symbol): number {
  switch (symbol) {
    case "BTC/USDC": {
      return 60_000;
    }
    case "ETH/USDC": {
      return 3000;
    }
    case "SOL/USDC": {
      return 150;
    }
    default: {
      return 100;
    }
  }
}

function timeframeDuration(timeframe: Timeframe): number {
  switch (timeframe) {
    case "1m": {
      return 60_000;
    }
    case "5m": {
      return 300_000;
    }
    case "15m": {
      return 900_000;
    }
    case "1h": {
      return 3_600_000;
    }
    case "4h": {
      return 14_400_000;
    }
    case "1d": {
      return 86_400_000;
    }
  }
}
