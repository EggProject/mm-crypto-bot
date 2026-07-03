// packages/exchange/src/types.ts — a `@mm/exchange` típus-definíciói
//
// FELADAT: A CCXT Pro adatszerkezeteit (Ticker, OrderBook, Trade, OHLCV)
// szűkítjük és normalizáljuk, hogy a felsőbb rétegek (paper engine,
// backtest, TUI) NE a CCXT típusait használják közvetlenül.
//
// MIÉRT fontos ez:
//   1. A CCXT típusai instabilak (minden minor verzióban változhatnak).
//   2. A `Num` típus `number | undefined` — a mi kódunk NEM akarja minden
//      sorban a `?? 0` fallbacket megírni.
//   3. A `Watch*` visszatérési típusok Promise<...>[] egyetlen tick-et
//      adnak vissza; nekünk célszerű saját observer/interfész típusokkal
//      dolgozni (push-alapú stream).
//
// A `Branded` típusokkal a string-union-öket ("BTC/USDT") típus-szinten
// is megkülönböztetjük — így a fordító fog szólni, ha pl. számot adunk
// át symbol helyett.

import type { Brand } from "@mm-crypto-bot/shared";

/** `Symbol` — branded string, pl. "BTC/USDT". Megakadályozza a keveredést más string-ekkel. */
export type Symbol = Brand<string, "ExchangeSymbol">;

/** `ClientOrderId` — branded string, a mi általunk generált egyedi order ID. */
export type ClientOrderId = Brand<string, "ClientOrderId">;

/** `ExchangeOrderId` — a tőzsde által visszaadott order ID (CCXT `Order.id`). */
export type ExchangeOrderId = Brand<string, "ExchangeOrderId">;

/**
 * `Ticker` — a CCXT Ticker-ből normalizált, kötelezően kitöltött mezőkkel.
 * Az `undefined` mezőket kizárjuk — ha a CCXT nem adja vissza, akkor a mi
 * kódunk NEM akarja a `?? 0` fallbacket mindenhol megismételni.
 */
export interface Ticker {
  readonly symbol: Symbol;
  readonly timestamp: number;
  readonly bid: number;
  readonly ask: number;
  readonly last: number;
  readonly baseVolume: number;
  readonly quoteVolume: number;
}

/**
 * `OrderBookLevel` — egyetlen (price, amount) szint az order book-ban.
 */
export interface OrderBookLevel {
  readonly price: number;
  readonly amount: number;
}

/**
 * `OrderBook` — normalizált order book snapshot / delta.
 * A CCXT mindkettőt ugyanazzal a típussal adja vissza; nálunk a `nonce`
 * jelzi a szekvencia-számot (sequence drift detekcióhoz, lásd
 * `docs/research/stack-findings.md` §7.3).
 */
export interface OrderBook {
  readonly symbol: Symbol;
  readonly timestamp: number;
  readonly nonce: number;
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
}

/**
 * `Trade` — normalizált trade tick. A `takerSide` mindig "buy" vagy "sell"
 * (a CCXT `side` néha `undefined` lehet — nálunk kötelező).
 */
export interface Trade {
  readonly id: string;
  readonly symbol: Symbol;
  readonly timestamp: number;
  readonly price: number;
  readonly amount: number;
  readonly takerSide: "buy" | "sell";
}

/**
 * `Ohlcv` — egyetlen OHLCV (candle) adat.
 * CCXT formátum: `[timestamp, open, high, low, close, volume]`.
 * Mi tuple-öt használunk (könnyű illeszkedés a CCXT watchOHLCV-vel).
 */
export type Ohlcv = readonly [timestamp: number, open: number, high: number, low: number, close: number, volume: number];

/**
 * `Timeframe` — a CCXT timeframe string, de csak az általunk támogatott
 * halmazra szűrve (HTF=1d, MTF=4h, LTF=1h a kiválasztott stratégia alapján,
 * lásd `docs/research/selected-strategy.md`).
 */
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/**
 * `Balance` — normalizált számla-egyenleg.
 * Csak a `free` (szabadon felhasználható) és a `total` mezőket tároljuk;
 * a `used` = `total - free` kiszámítható.
 */
export interface Balance {
  readonly currency: string;
  readonly free: number;
  readonly total: number;
}

/**
 * `OrderType` — a támogatott order-típusok a paper engine-ben.
 * A CCXT Pro támogatja a `stop_market`, `stop_limit` típusokat is, de a
 * paper engine csak a leggyakoribb kettővel dolgozik (limit + market).
 * A TP/SL-t külön `attachedTpSl` opcióval kezeljük (CCXT Pro natívan
 * támogatja a `createOrder` params.takeProfitPrice / stopLossPrice-szel).
 */
export type OrderType = "market" | "limit";

/**
 * `OrderSide` — long/short irány.
 */
export type OrderSide = "buy" | "sell";

/**
 * `OrderStatus` — az order életciklus-állapota. A CCXT Pro `Order.status`
 * mezője néha `undefined` — nálunk mindig definiált.
 */
export type OrderStatus = "open" | "closed" | "canceled";

/**
 * `OrderRequest` — egy új order paraméterei.
 * A paper engine és a CCXT Pro implementáció is ezt a típust fogadja.
 */
export interface OrderRequest {
  readonly clientOrderId: ClientOrderId;
  readonly symbol: Symbol;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly amount: number;
  /** Limit price (kötelező ha type === "limit", market-nél figyelmen kívül hagyva). */
  readonly price?: number;
  /**
   * Take-profit trigger ár (opcionális). Ha meg van adva, a pozíció záróárát
   * a rendszer automatikusan figyeli és TP-nél zárja (paper módban saját
   * fill-motor, live módban a CCXT Pro `createOrder` params.takeProfitPrice).
   */
  readonly takeProfitPrice?: number;
  /**
   * Stop-loss trigger ár (opcionális). Hasonló a take-profit-hoz, de
   * ellenkező irányú zárást jelent.
   */
  readonly stopLossPrice?: number;
}

/**
 * `Order` — egy létező order állapota. A `submitTimestamp` a saját
 * belső óránk (Date.now()), a `updateTimestamp` a CCXT-től kapott
 * `lastUpdateTimestamp` mező.
 */
export interface Order {
  readonly clientOrderId: ClientOrderId;
  readonly exchangeId: ExchangeOrderId | undefined;
  readonly symbol: Symbol;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly amount: number;
  readonly price: number | undefined;
  readonly status: OrderStatus;
  readonly filled: number;
  readonly average: number | undefined;
  readonly submitTimestamp: number;
  readonly updateTimestamp: number | undefined;
}

/**
 * `MarketMeta` — egy adott symbol piaci metaadatai (precision, limits).
 * A CCXT `Market` típusából csak a legszükségesebbeket emeljük ki.
 */
export interface MarketMeta {
  readonly symbol: Symbol;
  readonly base: string;
  readonly quote: string;
  readonly amountPrecision: number;
  readonly pricePrecision: number;
  readonly minAmount: number;
  readonly minCost: number;
}

/**
 * `FeedEvent` — a `subscribe` callback-jének átadott univerzális payload.
 * A `kind` discrimináns alapján a consumer a `payload` típusát szűkítheti.
 */
export type FeedEvent =
  | { readonly kind: "ticker"; readonly payload: Ticker }
  | { readonly kind: "orderbook"; readonly payload: OrderBook }
  | { readonly kind: "trade"; readonly payload: Trade }
  | { readonly kind: "ohlcv"; readonly payload: { readonly symbol: Symbol; readonly timeframe: Timeframe; readonly candle: Ohlcv } };
