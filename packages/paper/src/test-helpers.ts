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
  readonly id: string;
  readonly name: string;
  private readonly opts: Required<Omit<MockFeedOptions, "tickerError" | "networkErrorMessage">> & {
    readonly tickerError: ((symbol: string) => Error) | null;
    readonly networkErrorMessage: string | null;
  };
  /** A belső ticker-állapot (test-only, debuggoláshoz). */
  public lastFetchedSymbol: string | null = null;

  constructor(options: MockFeedOptions = {}) {
    this.id = options.id ?? "mock";
    this.name = options.name ?? "Mock Exchange";
    this.opts = {
      id: options.id ?? "mock",
      name: options.name ?? "Mock Exchange",
      ticker: options.ticker ?? defaultMockTicker("BTC/USDT"),
      tickerResolver: options.tickerResolver ?? ((sym: string) => defaultMockTicker(sym)),
      watchTickerImpl:
        options.watchTickerImpl ??
        ((): Promise<Ticker> =>
          // A default watchTicker soha nem resolve-ol — a queue-based mock
          // implementációk ezt a default-ot írják felül, ha a teszt ticker-t vár.
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          new Promise<Ticker>(() => {})),
      tickerSeq: options.tickerSeq ?? Date.now(),
      tickerError: options.tickerError ?? null,
      networkErrorMessage: options.networkErrorMessage ?? null,
    };
  }

  // A mock metódusok `async` kulcsszóval vannak jelölve, de a törzsük
  // egyszerűen `throw`-ol — az `async` szükséges, hogy a return type
  // Promise legyen, és a throw Promise.reject-re konvertálódjon.
  // Az ESLint `require-await` szabálya alól kivételt kap az osztály.
  /* eslint-disable @typescript-eslint/require-await */
  async loadMarkets(_reload?: boolean): Promise<Record<string, Market>> {
    throw new Error("MockExchangeFeed.loadMarkets not implemented");
  }

  async fetchTicker(symbol: string): Promise<Ticker> {
    this.lastFetchedSymbol = symbol;
    if (this.opts.tickerError !== null) {
      throw this.opts.tickerError(symbol);
    }
    if (symbol === "NETWORK_ERROR" && this.opts.networkErrorMessage !== null) {
      throw new Error(this.opts.networkErrorMessage);
    }
    const t = this.opts.tickerResolver(symbol);
    return t;
  }

  async fetchOrderBook(_symbol: string, _limit?: number): Promise<OrderBook> {
    throw new Error("MockExchangeFeed.fetchOrderBook not implemented");
  }

  async fetchTrades(_symbol: string, _since?: number, _limit?: number): Promise<CcxtTrade[]> {
    throw new Error("MockExchangeFeed.fetchTrades not implemented");
  }

  async fetchOHLCV(
    _symbol: string,
    _timeframe: string,
    _since?: number,
    _limit?: number,
  ): Promise<OHLCV[]> {
    throw new Error("MockExchangeFeed.fetchOHLCV not implemented");
  }

  async watchOrderBook(
    _symbol: string,
    _limit: number,
    _opts?: WatchOptions,
  ): Promise<OrderBook> {
    throw new Error("MockExchangeFeed.watchOrderBook not implemented");
  }

  async watchTicker(symbol: string, _opts?: WatchOptions): Promise<Ticker> {
    return this.opts.watchTickerImpl(symbol);
  }

  async watchTrades(_symbol: string, _opts?: WatchOptions): Promise<CcxtTrade[]> {
    throw new Error("MockExchangeFeed.watchTrades not implemented");
  }

  async watchOHLCV(
    _symbol: string,
    _timeframe: string,
    _opts?: WatchOptions,
  ): Promise<OHLCV[]> {
    throw new Error("MockExchangeFeed.watchOHLCV not implemented");
  }

  async watchOrders(_symbol: string, _opts?: WatchOptions): Promise<Order[]> {
    throw new Error("MockExchangeFeed.watchOrders not implemented");
  }

  async watchBalance(_opts?: WatchOptions): Promise<Balances> {
    throw new Error("MockExchangeFeed.watchBalance not implemented");
  }

  async watchPositions(
    _symbols?: readonly string[],
    _opts?: WatchOptions,
  ): Promise<unknown[]> {
    throw new Error("MockExchangeFeed.watchPositions not implemented");
  }

  async fetchBalance(): Promise<Balances> {
    throw new Error("MockExchangeFeed.fetchBalance not implemented");
  }

  async createOrder(
    _symbol: string,
    _type: "market" | "limit",
    _side: "buy" | "sell",
    _amount: number,
    _price?: number,
    _params?: Record<string, unknown>,
  ): Promise<Order> {
    throw new Error("MockExchangeFeed.createOrder not implemented");
  }

  async cancelOrder(_id: string, _symbol?: string): Promise<Order> {
    throw new Error("MockExchangeFeed.cancelOrder not implemented");
  }
  /* eslint-enable @typescript-eslint/require-await */
}
