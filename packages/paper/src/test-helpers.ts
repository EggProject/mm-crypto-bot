/**
 * packages/paper/src/test-helpers.ts
 *
 * Test-segédletek a PaperTrader egységtesztjeihez.
 * A `MockExchangeFeed` egy minimális CCXT-szerű implementáció, ami
 * a `ExchangeFeed` interfész minden metódusát megvalósítja (még az
 * opcionális `watchTicker`-t is) — így a PaperTrader teljes kódútvonala
 * tesztelhető.
 */
import type { Balances, OrderBook, Ticker, OHLCV, Order, Market, Trade as CcxtTrade } from "ccxt";
import type { ExchangeFeed, WatchOptions } from "@mm-crypto-bot/shared";

/**
 * A mock feed opciói.
 */
export interface MockFeedOptions {
  readonly id?: string;
  readonly name?: string;
  readonly ticker?: Ticker;
  readonly tickerResolver?: (symbol: string) => Ticker;
  readonly watchTickerImpl?: (symbol: string) => Promise<Ticker>;
  readonly tickerError?: (symbol: string) => Error;
  readonly tickerSeq?: number;
  readonly networkErrorMessage?: string;
  readonly queuedWatchTickerErrors?: readonly Error[];
}

interface ResolvedMockFeedOptions {
  readonly ticker: Ticker;
  readonly tickerResolver: (symbol: string) => Ticker;
  readonly watchTickerImpl: (symbol: string) => Promise<Ticker>;
  readonly tickerSeq: number;
  readonly tickerError: ((symbol: string) => Error) | undefined;
  readonly networkErrorMessage: string | undefined;
  readonly queuedWatchTickerErrors: Error[];
}

/**
 * A mock feed `ticker` típusú alapértéke — a `last`, `bid`, `ask`
 * mind 100 USDT-re van állítva, így a tesztek könnyen ellenőrizhetők.
 */
export function defaultMockTicker(symbol: string, overrides: Partial<Ticker> = {}): Ticker {
  return {
    symbol,
    timestamp: Date.now(),
    datetime: new Date().toISOString(),
    high: 110,
    low: 90,
    bid: 100,
    bidVolume: 1,
    ask: 101,
    askVolume: 1,
    vwap: 100,
    open: 100,
    close: 100,
    last: 100,
    previousClose: 100,
    change: 0,
    percentage: 0,
    average: 100,
    baseVolume: 1,
    quoteVolume: 100,
    indexPrice: 100,
    markPrice: 100,
    info: {},
    ...overrides,
  };
}

/**
 * `MockExchangeFeed` — minimális CCXT-szerű `ExchangeFeed` implementáció.
 *
 * Csak azokat a metódusokat valósítja meg, amelyeket a PaperTrader
 * ténylegesen hív: `fetchTicker`, `watchTicker`. A többi metódus
 * `throw new Error("not implemented")` — de ezeket a tesztek NEM hívják.
 */
export class MockExchangeFeed implements ExchangeFeed {
  private static unsupported<T>(method: string): Promise<T> {
    return Promise.reject(new Error(`MockExchangeFeed.${method} not implemented`));
  }

  private readonly options: ResolvedMockFeedOptions;
  readonly id: string;
  readonly name: string;
  /**
  A belső ticker-állapot (test-only, debuggoláshoz).
  */
  public lastFetchedSymbol: string | undefined;
  public readonly watchTickerCalls: string[] = [];

  constructor(options: MockFeedOptions = {}) {
    this.id = options.id ?? "mock";
    this.name = options.name ?? "Mock Exchange";
    this.options = {
      ticker: options.ticker ?? defaultMockTicker("BTC/USDT"),
      tickerResolver: options.tickerResolver ?? ((sym: string) => defaultMockTicker(sym)),
      watchTickerImpl:
        options.watchTickerImpl ??
        ((): Promise<Ticker> => {
          // A default watchTicker soha nem resolve-ol — a queue-based mock
          // implementációk ezt a default-ot írják felül, ha a teszt ticker-t vár.
          return new Promise<Ticker>((resolve) => {
            void resolve;
          });
        }),
      tickerSeq: options.tickerSeq ?? Date.now(),
      tickerError: options.tickerError,
      networkErrorMessage: options.networkErrorMessage,
      queuedWatchTickerErrors: [...(options.queuedWatchTickerErrors ?? [])],
    };
  }

  loadMarkets(_isReload?: boolean): Promise<Record<string, Market>> {
    return MockExchangeFeed.unsupported("loadMarkets");
  }

  fetchTicker(symbol: string): Promise<Ticker> {
    this.lastFetchedSymbol = symbol;
    if (this.options.tickerError !== undefined) {
      return Promise.reject(this.options.tickerError(symbol));
    }
    if (symbol === "NETWORK_ERROR" && this.options.networkErrorMessage !== undefined) {
      return Promise.reject(new Error(this.options.networkErrorMessage));
    }
    return Promise.resolve(this.options.tickerResolver(symbol));
  }

  fetchOrderBook(_symbol: string, _limit?: number): Promise<OrderBook> {
    return MockExchangeFeed.unsupported("fetchOrderBook");
  }

  fetchTrades(_symbol: string, _since?: number, _limit?: number): Promise<CcxtTrade[]> {
    return MockExchangeFeed.unsupported("fetchTrades");
  }

  fetchOHLCV(_symbol: string, _timeframe: string, _since?: number, _limit?: number): Promise<OHLCV[]> {
    return MockExchangeFeed.unsupported("fetchOHLCV");
  }

  watchOrderBook(_symbol: string, _limit: number, _options?: WatchOptions): Promise<OrderBook> {
    return MockExchangeFeed.unsupported("watchOrderBook");
  }

  watchTrades(_symbol: string, _options?: WatchOptions): Promise<CcxtTrade[]> {
    return MockExchangeFeed.unsupported("watchTrades");
  }

  watchOHLCV(_symbol: string, _timeframe: string, _options?: WatchOptions): Promise<OHLCV[]> {
    return MockExchangeFeed.unsupported("watchOHLCV");
  }

  watchOrders(_symbol: string, _options?: WatchOptions): Promise<Order[]> {
    return MockExchangeFeed.unsupported("watchOrders");
  }

  watchBalance(_options?: WatchOptions): Promise<Balances> {
    return MockExchangeFeed.unsupported("watchBalance");
  }

  watchPositions(_symbols?: readonly string[], _options?: WatchOptions): Promise<unknown[]> {
    return MockExchangeFeed.unsupported("watchPositions");
  }

  fetchBalance(): Promise<Balances> {
    return MockExchangeFeed.unsupported("fetchBalance");
  }

  createOrder(
    _symbol: string,
    _type: "market" | "limit",
    _side: "buy" | "sell",
    _amount: number,
    _price?: number,
    _parameters?: Record<string, unknown>,
  ): Promise<Order> {
    return MockExchangeFeed.unsupported("createOrder");
  }

  cancelOrder(_id: string, _symbol?: string): Promise<Order> {
    return MockExchangeFeed.unsupported("cancelOrder");
  }

  watchTicker(symbol: string, _options?: WatchOptions): Promise<Ticker> {
    this.watchTickerCalls.push(symbol);
    const queuedError = this.options.queuedWatchTickerErrors.shift();
    if (queuedError !== undefined) {
      return Promise.reject(queuedError);
    }
    return this.options.watchTickerImpl(symbol);
  }
}
