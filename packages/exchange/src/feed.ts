// packages/exchange/src/feed.ts — `ExchangeFeed` absztrakt interfész
//
// FELADAT: A paper engine a CCXT Pro-val SOHA nem közvetlenül kommunikál —
// ezen az interfészen keresztül beszélget. Ez két dolgot biztosít:
//   1. A paper engine tesztelhető mock feed-del (lásd `mockFeed.ts`).
//   2. Ha később a CCXT Pro API-t leváltjuk (pl. saját Rust sidecar), a
//      paper engine kódjához nem kell hozzányúlni.
//
// Az interfész PUSH-alapú: a fogyasztó `subscribe()`-tel feliratkozik
// egy callback-re, és minden új tick-nél megkapja a normalizált
// `FeedEvent`-et. A `Symbol` típus brandelt, így a `subscribe` hívásnál
// a fordító ellenőrzi, hogy a feed által támogatott symbol-t kérünk-e.
//
// Az `unsubscribe` visszaadja a feliratkozás azonosítóját, amivel a
// fogyasztó később leiratkozhat. Erre azért van szükség, mert a CCXT Pro
// `watch*` metódusai stateful-ak (egyszerre több symbol-t is lehet
// figyelni), és a leiratkozás explicit kell legyen a memóriakezelés
// szempontjából.
//
// A `close` metódus az egész feed-et állítja le (a CCXT WS connection
// lezárása). A `placeOrder` / `cancelOrder` metódusok a CCXT Pro REST
// oldalát használják (a WS trade-channel csak notify, order placement-re
// a REST endpoint kell).

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
} from "./types.js";

/** A `subscribe` visszatérési értéke — ezzel tud a fogyasztó leiratkozni. */
export type SubscriptionId = number;

/** A `subscribe` callback-jének típusa. */
export type FeedListener = (event: FeedEvent) => void;

/**
 * `ExchangeFeed` — az exchange feed absztrakt interfésze.
 * A CCXT Pro alapú `BybitEuFeed` és a tesztekben használt `MockExchangeFeed`
 * IS implementálja. A paper engine kizárólag ezen az interfészen keresztül
 * éri el a feedet.
 */
export interface ExchangeFeed {
  /** Az exchange azonosítója (pl. "bybiteu" vagy "mock"). */
  readonly exchangeId: string;

  /** A feed megnyitása / CCXT WS kapcsolat felépítése. */
  open(): Promise<void>;

  /**
   * Feliratkozás ticker stream-re egy adott symbol-ra. A CCXT Pro
   * `watchTicker(symbol)` hívásnak felel meg. A `limit` a top N szint
   * (csak order book-nál releváns).
   */
  subscribeTicker(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId>;

  /** Feliratkozás order book delta stream-re (CCXT Pro `watchOrderBook`). */
  subscribeOrderBook(symbol: Symbol, limit: number, listener: FeedListener): Promise<SubscriptionId>;

  /** Feliratkazás trade stream-re (CCXT Pro `watchTrades`). */
  subscribeTrades(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId>;

  /** Feliratkozás OHLCV (candle) stream-re (CCXT Pro `watchOHLCV`). */
  subscribeOhlcv(symbol: Symbol, timeframe: Timeframe, listener: FeedListener): Promise<SubscriptionId>;

  /** Leiratkozás egy korábbi `subscribe*` hívásról. */
  unsubscribe(id: SubscriptionId): Promise<void>;

  /**
   * REST snapshot lekérése ticker-ről (CCXT Pro `fetchTicker`).
   * A bootstrap során használjuk, hogy a paper engine a subscribe előtt
   * tudja a referenciakamatot.
   */
  fetchTickerSnapshot(symbol: Symbol): Promise<Ticker>;

  /** REST snapshot az order book-ról (CCXT Pro `fetchOrderBook`). */
  fetchOrderBookSnapshot(symbol: Symbol, limit: number): Promise<OrderBook>;

  /** Piaci metaadatok (precision, min amounts) — CCXT Pro `loadMarkets`. */
  fetchMarketMeta(symbol: Symbol): Promise<MarketMeta>;

  /** Saját számla-egyenleg lekérése (CCXT Pro `fetchBalance`). */
  fetchBalances(): Promise<readonly Balance[]>;

  /** Order placement — CCXT Pro `createOrder`. */
  placeOrder(req: OrderRequest): Promise<Order>;

  /** Order cancellation — CCXT Pro `cancelOrder` (id vagy clientOrderId). */
  cancelOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order>;

  /** Egy konkrét order állapotának lekérdezése — CCXT Pro `fetchOrder`. */
  fetchOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order>;

  /** Open order-ek listája egy symbol-ra — CCXT Pro `fetchOpenOrders`. */
  fetchOpenOrders(symbol: Symbol): Promise<readonly Order[]>;

  /** Az egész feed lezárása (CCXT WS connection close + cleanup). */
  close(): Promise<void>;

  /**
   * `OrderStatus` típus export — a `Result.fold` és társai számára, hogy
   * ne kelljen külön importálni a types.ts-ból.
   */
  readonly statusOf: (s: string) => OrderStatus;
}

/** Re-export a kényelem kedvéért. */
export type { Balance, ClientOrderId, ExchangeOrderId, FeedEvent, MarketMeta, Order, OrderRequest, OrderStatus, Symbol, Timeframe };

/** `placeOrder` CCXT error típusok — a feed wrapper dobhatja ezeket. */
export class ExchangeFeedError extends Error {
  constructor(
    message: string,
    public override readonly cause: unknown,
  ) {
    super(message);
    this.name = "ExchangeFeedError";
  }
}
