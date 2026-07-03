/**
 * packages/shared/src/types.ts
 *
 * Közös típus-definíciók a teljes monorepo-ban. Itt csak olyan típusokat
 * tárolunk, amelyeket több package is használ (core, exchange, paper,
 * backtest, apps).
 *
 * A típusok a ccxt saját típus-rendszerére épülnek — nem definiálunk
 * újradefiniált union típusokat OHLCV/retrade/stb. adatokra, hanem a
 * `ccxt.Exchange`-ből származó típusokat használjuk.
 */

import type { Exchange, Ticker, OrderBook, Trade, OHLCV, Balances, Order, Market } from "ccxt";

/**
 * Az ExchangeFeed interface egy generikus kontrakt, amelyet minden
 * exchange-specifikus adapter (bybit.eu, később binance, okx) megvalósít.
 *
 * A ccxt saját `Exchange` típusát használjuk, de csak a metódusainak egy
 * részhalmazát tesszük kötelezővé — így a paper-emulátor és a backtest
 * engine ugyanazon az interface-en dolgozhat, mint egy valódi exchange.
 */
export interface ExchangeFeed {
  readonly id: string;
  readonly name: string;

  // Publikus piaci adatok
  loadMarkets(reload?: boolean): Promise<Record<string, Market>>;
  fetchTicker(symbol: string): Promise<Ticker>;
  fetchOrderBook(symbol: string, limit?: number): Promise<OrderBook>;
  fetchTrades(symbol: string, since?: number, limit?: number): Promise<Trade[]>;
  fetchOHLCV(symbol: string, timeframe: string, since?: number, limit?: number): Promise<OHLCV[]>;

  // CCXT Pro WebSocket stream-ek (a watch* metodusok opcionalisak —
  // egy paper-emulator visszaadhat egy soha-nem-resolve Promise-t is,
  // mert a feed nem valos ideju).
  watchOrderBook?(symbol: string, limit: number, opts?: WatchOptions): Promise<OrderBook>;
  watchTicker?(symbol: string, opts?: WatchOptions): Promise<Ticker>;
  watchTrades?(symbol: string, opts?: WatchOptions): Promise<Trade[]>;
  watchOHLCV?(symbol: string, timeframe: string, opts?: WatchOptions): Promise<OHLCV[]>;
  watchOrders?(symbol: string, opts?: WatchOptions): Promise<Order[]>;
  watchBalance?(opts?: WatchOptions): Promise<Balances>;
  watchPositions?(symbols?: readonly string[], opts?: WatchOptions): Promise<unknown[]>;

  // Privat (auth szukseges)
  fetchBalance(): Promise<Balances>;
  createOrder(
    symbol: string,
    type: "market" | "limit",
    side: "buy" | "sell",
    amount: number,
    price?: number,
    params?: Record<string, unknown>,
  ): Promise<Order>;
  cancelOrder(id: string, symbol?: string): Promise<Order>;
}

/**
 * A ccxt tényleges `Exchange` osztálya implementálja az ExchangeFeed
 * interface-t (az `extends` típus-kompatibilitás automatikus, mert a
 * ccxt metódus-szignatúrái szigorúbbak vagy egyenértékűek).
 *
 * Ezzel a type assertion-nel a bybit/binance/okx példányok közvetlenül
 * átadhatók az ExchangeFeed-et váró kódoknak.
 */
export function asExchangeFeed(exchange: Exchange): ExchangeFeed {
  return exchange as unknown as ExchangeFeed;
}

/**
 * Watch flag wrapper a CCXT Pro streaming metódusokhoz.
 *
 * A CCXT Pro `watch*` metódusai `since`, `limit`, `params` opcionális
 * paramétereket fogadnak — ezt egy wrapper típussal tesszük típus-biztosabbá.
 */
export interface WatchOptions {
  readonly since?: number;
  readonly limit?: number;
  readonly params?: Record<string, unknown>;
}

/**
 * Aktuális pozíció snapshot. A paper-emulátor és a backtest engine
 * ugyanazt a típust használja.
 */
export interface PositionSnapshot {
  readonly symbol: string;
  readonly side: "long" | "short" | "flat";
  readonly amount: number;
  readonly avgEntryPrice: number;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
  readonly openedAt: number;
  readonly leverage: number;
}

/**
 * Trade-fill rekord. A backtest és a paper-emulátor is ilyeneket ír ki.
 */
export interface FillRecord {
  readonly id: string;
  readonly orderId: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly price: number;
  readonly amount: number;
  readonly fee: number;
  readonly feeCurrency: string;
  readonly timestamp: number;
  readonly mode: "live" | "paper" | "backtest";
}

/**
 * Trading signal — a core engine outputja. Az exchange / paper / backtest
 * driver-ek ezt kapják bemenetként.
 */
export type SignalAction = "buy" | "sell" | "hold" | "close";

export interface TradingSignal {
  readonly symbol: string;
  readonly action: SignalAction;
  readonly confidence: number; // 0..1
  readonly reason: string;
  readonly generatedAt: number;
  readonly suggestedAmount?: number;
  readonly suggestedPrice?: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
}