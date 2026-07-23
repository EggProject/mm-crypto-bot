// packages/exchange/src/__testing__/mockFeed.ts — TEST-ONLY `MockExchangeFeed`
//
// ⚠️  TEST-ONLY. Production code MUST NOT import or instantiate this class.
//    The `__testing__/` directory name signals the test-only contract to
//    reviewers; this file is also excluded from the public package export
//    in `index.ts` and from `createExchangeClient`'s surface API.
//
// FELADAT: A unit tesztek számára egy előre programozott
// `ExchangeFeed` implementáció. A mock feed:
//   - Tetszőleges `FeedEvent` sorozatot tud "lejátszani" a `pushEvent` metódussal
//   - A `subscribe*` hívásra azonnal visszaad egy `SubscriptionId`-t
//   - A `fetch*` metódusok a memóriában tárolt snapshot-ot adják vissza
//   - A `placeOrder` / `cancelOrder` szintén a memóriában tárolt order-könyvben dolgozik
//
// A cél: a paper engine 100%-os unit teszt lefedettsége anélkül, hogy
// valódi CCXT vagy valódi hálózati kapcsolat kellene.
//
// === PHASE 66 ENFORCEMENT ===
//   Per user mandate "csak a test hasznalhatja a mock feed -et!", this
//   file was moved from `packages/exchange/src/mockFeed.ts` to
//   `packages/exchange/src/__testing__/mockFeed.ts` and removed from
//   the public package surface (`index.ts`, `factory.ts`). The Bot's
//   exchange-feed wire-up (apps/bot/src/bot/bot.ts) no longer falls
//   back to `new MockExchangeFeed()` when `exchange.id === "mock"` —
//   it throws with a clear error pointing at the test-only path.

/* eslint-disable @typescript-eslint/require-await -- Az `ExchangeFeed` interfész Promise-alapú, de egyes metódusok szinkron belső state-ből dolgoznak. */

import type { ExchangeFeed, FeedListener, SubscriptionId } from "../feed.js";
import type {
  Balance,
  ClientOrderId,
  ExchangeOrderId,
  FeedEvent,
  MarketMeta,
  Order,
  OrderBook,
  OrderRequest,
  OrderStatus,
  Symbol,
  Ticker,
  Timeframe,
} from "../types.js";

/** A mock feed belső subscription-nyilvántartása. */
interface MockSubscription {
  readonly id: SubscriptionId;
  readonly kind: "ticker" | "orderbook" | "trade" | "ohlcv";
  readonly symbol: Symbol;
  readonly timeframe: Timeframe | undefined;
  readonly listener: FeedListener;
}

/**
 * `MockExchangeFeedOptions` — a mock feed konfigurációja.
 *
 * - `balances` — induló egyenleg (alap: 10 000 USDC).
 * - `tickerSnapshot` / `orderBookSnapshot` / `marketMeta` — explicit
 *   értékek a `fetch*` metódusokhoz. Ha nincs megadva, a mock feed
 *   egy alapértelmezett "BTC/USDC @ 60 000" értéket ad vissza.
 */
export interface MockExchangeFeedOptions {
  readonly balances?: readonly Balance[];
  readonly tickerSnapshot?: ReadonlyMap<Symbol, Ticker>;
  readonly orderBookSnapshot?: ReadonlyMap<Symbol, OrderBook>;
  readonly marketMeta?: ReadonlyMap<Symbol, MarketMeta>;
  readonly exchangeId?: string;
}

/**
 * `MockExchangeFeed` — a `ExchangeFeed` interfész memóriabeli implementációja.
 * Nem hálózatkezelő — minden adatot a konstruktorban kapott vagy a
 * `pushEvent` / `setTicker` metódusokkal beállított state-ből olvas.
 */
export class MockExchangeFeed implements ExchangeFeed {
  readonly exchangeId: string;
  private readonly subs = new Map<SubscriptionId, MockSubscription>();
  private nextId: SubscriptionId = 1;
  private opened = false;
  private readonly balances: Balance[];
  private readonly tickerSnapshots: Map<Symbol, Ticker>;
  private readonly orderBookSnapshots: Map<Symbol, OrderBook>;
  private readonly marketMetaMap: Map<Symbol, MarketMeta>;
  private readonly orderBook = new Map<ClientOrderId, Order>();

  constructor(opts: MockExchangeFeedOptions = {}) {
    this.exchangeId = opts.exchangeId ?? "mock";
    this.balances = [...(opts.balances ?? [{ currency: "USDC", free: 10_000, total: 10_000 }])];
    this.tickerSnapshots = new Map<Symbol, Ticker>();
    this.orderBookSnapshots = new Map<Symbol, OrderBook>();
    this.marketMetaMap = new Map<Symbol, MarketMeta>();
    // A ReadonlyMap-ból átmásoljuk a bejegyzéseket, hogy később
    // a `setTicker` / `setBalance` metódusokkal bővíthető legyen.
    if (opts.tickerSnapshot !== undefined) {
      for (const [k, v] of opts.tickerSnapshot) this.tickerSnapshots.set(k, v);
    }
    if (opts.orderBookSnapshot !== undefined) {
      for (const [k, v] of opts.orderBookSnapshot) this.orderBookSnapshots.set(k, v);
    }
    if (opts.marketMeta !== undefined) {
      for (const [k, v] of opts.marketMeta) this.marketMetaMap.set(k, v);
    }
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.subs.clear();
    this.opened = false;
  }

  async subscribeTicker(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    return this.addSub("ticker", symbol, undefined, listener);
  }

  async subscribeOrderBook(symbol: Symbol, _limit: number, listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    return this.addSub("orderbook", symbol, undefined, listener);
  }

  async subscribeTrades(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    // Note: the FeedEvent discriminant is "trade" (singular) per types.ts;
    // the subscription kind here matches the event kind for routing.
    return this.addSub("trade", symbol, undefined, listener);
  }

  async subscribeOhlcv(symbol: Symbol, timeframe: Timeframe, listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    return this.addSub("ohlcv", symbol, timeframe, listener);
  }

  async unsubscribe(id: SubscriptionId): Promise<void> {
    this.subs.delete(id);
  }

  async fetchTickerSnapshot(symbol: Symbol): Promise<Ticker> {
    this.assertOpen();
    const existing = this.tickerSnapshots.get(symbol);
    if (existing !== undefined) return existing;
    // Ha nincs explicit snapshot, generálunk egy default-ot a tesztek kedvéért.
    return defaultTicker(symbol);
  }

  async fetchOrderBookSnapshot(symbol: Symbol, _limit: number): Promise<OrderBook> {
    this.assertOpen();
    const existing = this.orderBookSnapshots.get(symbol);
    if (existing !== undefined) return existing;
    return defaultOrderBook(symbol);
  }

  async fetchMarketMeta(symbol: Symbol): Promise<MarketMeta> {
    this.assertOpen();
    const existing = this.marketMetaMap.get(symbol);
    if (existing !== undefined) return existing;
    return defaultMarketMeta(symbol);
  }

  async fetchBalances(): Promise<readonly Balance[]> {
    this.assertOpen();
    return [...this.balances];
  }

  async placeOrder(req: OrderRequest): Promise<Order> {
    this.assertOpen();
    if (req.type === "limit" && req.price === undefined) {
      throw new Error(`MockFeed: limit order-hez kötelező a price: ${req.clientOrderId}`);
    }
    const order: Order = {
      clientOrderId: req.clientOrderId,
      exchangeId: `mock-${req.clientOrderId}` as unknown as ExchangeOrderId,
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      amount: req.amount,
      price: req.price,
      status: "open",
      filled: 0,
      average: undefined,
      submitTimestamp: Date.now(),
      updateTimestamp: Date.now(),
    };
    this.orderBook.set(req.clientOrderId, order);
    return order;
  }

  async cancelOrder(clientOrderId: ClientOrderId, _symbol: Symbol): Promise<Order> {
    this.assertOpen();
    const order = this.orderBook.get(clientOrderId);
    if (order === undefined) {
      throw new Error(`MockFeed: ismeretlen order: ${clientOrderId}`);
    }
    const canceled: Order = { ...order, status: "canceled", updateTimestamp: Date.now() };
    this.orderBook.set(clientOrderId, canceled);
    return canceled;
  }

  async fetchOrder(clientOrderId: ClientOrderId, _symbol: Symbol): Promise<Order> {
    this.assertOpen();
    const order = this.orderBook.get(clientOrderId);
    if (order === undefined) {
      throw new Error(`MockFeed: ismeretlen order: ${clientOrderId}`);
    }
    return order;
  }

  async fetchOpenOrders(_symbol: Symbol): Promise<readonly Order[]> {
    this.assertOpen();
    return [...this.orderBook.values()].filter((o) => o.status === "open");
  }

  statusOf(s: string): OrderStatus {
    if (s === "open" || s === "closed" || s === "canceled") return s;
    if (s === "filled") return "closed";
    return "open";
  }

  // === Mock-specifikus metódusok (tesztek számára) ===

  /**
   * `pushEvent` — egy `FeedEvent`-et küldünk minden subscriber-nek, akinek
   * a `kind` és `symbol` egyezik. A OHLCV subscription-öknél a `timeframe`
   * is egyezzen.
   */
  pushEvent(event: FeedEvent): void {
    for (const sub of this.subs.values()) {
      if (sub.kind !== event.kind) continue;
      if (sub.symbol !== event.payload.symbol) continue;
      if (sub.kind === "ohlcv" && event.kind === "ohlcv") {
        if (sub.timeframe !== event.payload.timeframe) continue;
      }
      sub.listener(event);
    }
  }

  /** `setTicker` — beállítja a `fetchTickerSnapshot` által visszaadott értéket. */
  setTicker(symbol: Symbol, ticker: Ticker): void {
    this.tickerSnapshots.set(symbol, ticker);
  }

  /** `setBalance` — beállítja egy currency egyenlegét. */
  setBalance(currency: string, free: number, total: number): void {
    const idx = this.balances.findIndex((b) => b.currency === currency);
    if (idx === -1) {
      this.balances.push({ currency, free, total });
    } else {
      // eslint-disable-next-line security/detect-object-injection -- internal array, idx from findIndex
      this.balances[idx] = { currency, free, total };
    }
  }

  /** `getOrder` — visszaadja egy order aktuális állapotát (tesztek számára). */
  getOrder(clientOrderId: ClientOrderId): Order | undefined {
    return this.orderBook.get(clientOrderId);
  }

  /** `setOrderStatus` — kívülről állítjuk be az order státuszt (pl. fill szimuláció). */
  setOrderStatus(clientOrderId: ClientOrderId, patch: Partial<Order>): void {
    const order = this.orderBook.get(clientOrderId);
    if (order === undefined) return;
    this.orderBook.set(clientOrderId, { ...order, ...patch, updateTimestamp: Date.now() });
  }

  /** `subscriptionCount` — hány aktív subscription van (tesztek számára). */
  subscriptionCount(): number {
    return this.subs.size;
  }

  private addSub(kind: MockSubscription["kind"], symbol: Symbol, timeframe: Timeframe | undefined, listener: FeedListener): SubscriptionId {
    const id = this.nextId++;
    this.subs.set(id, { id, kind, symbol, timeframe, listener });
    return id;
  }

  private assertOpen(): void {
    if (!this.opened) {
      throw new Error("MockFeed: a feed még nincs megnyitva (hívd open()-t előbb)");
    }
  }
}

/** `defaultTicker` — a tesztek default ticker-e (BTC/USDC @ 60 000). */
export function defaultTicker(symbol: Symbol): Ticker {
  const defaults: Readonly<Record<string, number>> = {
    "BTC/USDC": 60_000,
    "ETH/USDC": 3_000,
    "SOL/USDC": 150,
  };
  // eslint-disable-next-line security/detect-object-injection -- internal map, symbol brand type
  const last = defaults[symbol] ?? 100;
  return {
    symbol,
    timestamp: 0,
    bid: last - 1,
    ask: last + 1,
    last,
    baseVolume: 0,
    quoteVolume: 0,
  };
}

/** `defaultOrderBook` — 1 szintű teszt-orderbook. */
export function defaultOrderBook(symbol: Symbol): OrderBook {
  const t = defaultTicker(symbol);
  return {
    symbol,
    timestamp: 0,
    nonce: 0,
    bids: [{ price: t.bid, amount: 1 }],
    asks: [{ price: t.ask, amount: 1 }],
  };
}

/** `defaultMarketMeta` — alap precision és limit adatok. */
export function defaultMarketMeta(symbol: Symbol): MarketMeta {
  const slashIndex = symbol.indexOf("/");
  const base = slashIndex === -1 ? "UNKNOWN" : symbol.slice(0, slashIndex);
  const quote = slashIndex === -1 ? "USDC" : symbol.slice(slashIndex + 1);
  return {
    symbol,
    base,
    quote,
    amountPrecision: 4,
    pricePrecision: 2,
    minAmount: 0.0001,
    minCost: 1,
  };
}
