/**
 * packages/shared/src/types.ts
 *
 * Közös típus-definíciók a teljes monorepo-ban.
 *
 * KÉT FORRÁSBÓL MERGED:
 *   I) Strategy-backtest branch-ből (Phase 3, portolva erre a PR-ra):
 *      - `Brand`, `Result`, `Side`, `Timeframe`, `Candle`, `Symbol`,
 *        `TIMEFRAME_MS`, `Trade`, `ExitReason` — domain típusok a
 *        stratégia-motor és a backtest engine számára (ccxt-független).
 *   II) Main-ből (Phase 1 scaffold):
 *      - `ExchangeFeed`, `WatchOptions`, `asExchangeFeed`,
 *        `PositionSnapshot`, `FillRecord`, `SignalAction`, `TradingSignal`
 *        — ccxt-alapú típusok a trading driver-ek (paper, live, exchange)
 *        számára.
 *
 * A két halmaz NEM ütközik (különböző nevek); együtt élnek, mert a
 * backtest engine outputja (`Trade`) és a paper-trader outputja
 * (`FillRecord`) más-más absztrakciós szint — nincs értelme egy
 * típussá összevonni őket.
 */

// ============================================================================
// I) STRATEGY + BACKTEST DOMAIN TÍPUSOK (strategy-backtest branch-ből)
// ============================================================================

/**
 `Brand<T, K>` — "opaque type" minta. Egy típust egy másikkal kompatibilissé tesz
 anélkül, hogy az értéke konvertálható lenne. Például egy `UserId` nem
 keveredik össze egy `Symbol`-lal, még ha mindkettő `string` is.
*/
export type Brand<T, K extends string> = T & { readonly __brand: K };

/**
 `Result<T, E>` — Rust-stílusú eredmény-típus. A hibakezelés explicit,
 típus-szinten kifejezhető, kikerüli a `throw` használatát.
*/
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 `Side` — a kereskedés iránya (long vagy short). A `@mm-crypto-bot/core` stratégia-motor
 és a `@mm-crypto-bot/backtest` motor is ezt a típust használja.
*/
export type Side = "buy" | "sell";

/**
 `Timeframe` — a chart idősíkjainak kanonikus halmaza. A kiválasztott stratégia
 (MTF-Trend-Konfluencia) három szintet használ: HTF (1d), MTF (4h), LTF (1h).
 Lásd: docs/research/selected-strategy.md §1.
*/
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/**
 `Candle` — egyetlen OHLCV gyertya. A CCXT `fetchOHLCV` formátumát
 egészíti ki az OHLC mezőkkel, hogy az indikátor-számítások ne
 kényszerüljenek a nyers [ts, o, h, l, c, v] tuple feldolgozására.

 A `timestamp` epoch milliszekundumban van tárolva (CCXT-kompatibilis),
 a `closeTime` opcionális (ha a CCXT nem adja, `timestamp + tf_ms`).
*/
export interface Candle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 `Symbol` — branded string, hogy ne keveredjen össze más stringekkel.
 A kiválasztott stratégia három eszközt kezel: BTC/USDC, ETH/USDC, SOL/USDC.
*/
export type Symbol = Brand<string, "Symbol">;

export function makeSymbol(value: string): Symbol {
  return value as Symbol;
}

/**
 `TimeframeMs` — az egyes timeframe-ök hossza milliszekundumban. A
 backtest motor az equity-görbe időbélyegéhez és a funding-kamat
 számításhoz használja.
*/
export const TIMEFRAME_MS: Readonly<Record<Timeframe, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/**
 `Trade` — egyetlen lezárt kereskedés. A backtest a `trades` tömbben
 tárolja az összes executed trade-et, ebből számítja a Sharpe-t,
 a profit factort, a win rate-et, stb.
*/
export interface Trade {
  readonly symbol: Symbol;
  readonly side: Side;
  readonly entryTime: number;
  readonly entryPrice: number;
  readonly exitTime: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly notionalUsd: number;
  readonly pnlUsd: number;
  readonly pnlPct: number;
  readonly feesUsd: number;
  readonly exitReason: ExitReason;
}

export type ExitReason =
  | "stop_loss"
  | "take_profit"
  | "trailing_stop"
  | "trend_reversal"
  | "time_exit"
  | "kill_switch"
  | "end_of_data";

// ============================================================================
// II) TRADING DRIVER TÍPUSOK (main-ből, CCXT-alapú)
// ============================================================================

import type { Exchange, Ticker, OrderBook, Trade as CcxtTrade, OHLCV, Balances, Order, Market } from "ccxt";

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
  fetchTrades(symbol: string, since?: number, limit?: number): Promise<CcxtTrade[]>;
  fetchOHLCV(symbol: string, timeframe: string, since?: number, limit?: number): Promise<OHLCV[]>;

  // CCXT Pro WebSocket stream-ek (a watch* metodusok opcionalisak —
  // egy paper-emulator visszaadhat egy soha-nem-resolve Promise-t is,
  // mert a feed nem valos ideju).
  watchOrderBook?(symbol: string, limit: number, opts?: WatchOptions): Promise<OrderBook>;
  watchTicker?(symbol: string, opts?: WatchOptions): Promise<Ticker>;
  watchTrades?(symbol: string, opts?: WatchOptions): Promise<CcxtTrade[]>;
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