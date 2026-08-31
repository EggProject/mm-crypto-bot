import type { Balances, Dictionary, Market, OHLCV, Order, OrderBook, Position, Ticker, Trade } from "ccxt";

export function mockMarkets(): Dictionary<Market> {
  return {};
}

export function mockTicker(symbol: string): Ticker {
  return {
    symbol,
    info: {},
    timestamp: 1,
    datetime: "1970-01-01T00:00:00.000Z",
    high: 1,
    low: 1,
    bid: 1,
    bidVolume: 1,
    ask: 1,
    askVolume: 1,
    vwap: 1,
    open: 1,
    close: 1,
    last: 1,
    previousClose: 1,
    change: 0,
    percentage: 0,
    average: 1,
    quoteVolume: 1,
    baseVolume: 1,
    indexPrice: 1,
    markPrice: 1,
  };
}

export function tickerWith(symbol: string, overrides: Readonly<Partial<Ticker>>): Ticker {
  return { ...mockTicker(symbol), ...overrides };
}

export function mockOrderBook(symbol: string): OrderBook {
  const orderBook: OrderBook = {
    symbol,
    asks: [],
    bids: [],
    datetime: "1970-01-01T00:00:00.000Z",
    timestamp: 1,
    nonce: 1,
    copy: () => mockOrderBook(symbol),
  };
  Object.defineProperty(orderBook, "copy", { enumerable: false });
  return orderBook;
}

export function orderBookWith(symbol: string, overrides: Readonly<Partial<OrderBook>>): OrderBook {
  return {
    ...mockOrderBook(symbol),
    ...overrides,
  };
}

export function mockTrades(): Trade[] {
  return [];
}

export function mockOhlcvs(): OHLCV[] {
  return [];
}

export function mockBalances(): Balances {
  return { info: { free: 0, used: 0, total: 0 } };
}

export function mockOrder(symbol: string): Order {
  return {
    id: "order-1",
    clientOrderId: "client-order-1",
    datetime: "1970-01-01T00:00:00.000Z",
    timestamp: 1,
    lastTradeTimestamp: 1,
    status: "open",
    symbol,
    type: "limit",
    side: "buy",
    price: 1,
    amount: 1,
    filled: 0,
    remaining: 1,
    cost: 1,
    trades: [],
    fee: undefined,
    reduceOnly: false,
    postOnly: false,
    info: {},
  };
}

export function orderWith(symbol: string, overrides: Readonly<Partial<Order>>): Order {
  return { ...mockOrder(symbol), ...overrides };
}

export function mockOrders(symbol: string): Order[] {
  return [mockOrder(symbol)];
}

export function mockPositions(): Position[] {
  return [];
}
