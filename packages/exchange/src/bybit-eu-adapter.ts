/**
 * packages/exchange/src/bybit-eu-adapter.ts
 *
 * Bybit.eu specifikus CCXT Pro adapter.
 *
 * A CCXT Pro beepitett bybit implementaciojat wrap-eli:
 *   - rate-limit konfiguracio (100 ms / 10 req/sec)
 *   - tipusos facade a packages/shared ExchangeFeed interface-re
 *   - sandbox/demo helper (bybit.eu-n jelenleg nincs sandbox)
 *
 * A CCXT Pro automatikusan kezeli a reconnect-et es az exponential
 * backoff-ot - ezt a wrapper nem irja felul.
 * Lasd: stack-findings.md 7. fejezet es https://docs.ccxt.com/docs/pro-manual
 */

import ccxt, { type Exchange } from "ccxt";
import type { ExchangeFeed, WatchOptions } from "@mm-crypto-bot/shared";

export interface BybitEuAdapterOptions {
  readonly apiKey?: string;
  readonly secret?: string;
  readonly rateLimitMs?: number;
  readonly sandbox?: boolean;
}

/**
 * A bybit.eu exchange ID a CCXT-ben: bybiteu.
 * Lasd: docs/research/stack-findings.md 1.1
 */
export class BybitEuAdapter implements ExchangeFeed {
  readonly id = "bybiteu";
  readonly name = "Bybit EU";
  private readonly exchange: Exchange;
  private readonly options: BybitEuAdapterOptions;

  constructor(options: BybitEuAdapterOptions = {}) {
    this.options = options;
    const exchangeOptions: Record<string, unknown> = {
      enableRateLimit: true,
      rateLimit: options.rateLimitMs ?? 100,
    };
    if (options.apiKey !== undefined) exchangeOptions["apiKey"] = options.apiKey;
    if (options.secret !== undefined) exchangeOptions["secret"] = options.secret;
    // `options` a CCXT-nek van átadva a fenti exchangeOptions-on keresztül;
    // a this.options mező a későbbi bővítésekhez (pl. demo trading kapcsoló).
    void this.options;
    this.exchange = new ccxt.bybiteu(exchangeOptions);

    if (options.sandbox === true) {
      this.exchange.setSandboxMode(true);
    }
  }

  get ccxtExchange(): Exchange {
    return this.exchange;
  }

  async loadMarkets(reload?: boolean) {
    return this.exchange.loadMarkets(reload);
  }

  async fetchTicker(symbol: string) {
    return this.exchange.fetchTicker(symbol);
  }

  async fetchOrderBook(symbol: string, limit?: number) {
    return this.exchange.fetchOrderBook(symbol, limit);
  }

  async fetchTrades(symbol: string, since?: number, limit?: number) {
    return this.exchange.fetchTrades(symbol, since, limit);
  }

  async fetchOHLCV(symbol: string, timeframe: string, since?: number, limit?: number) {
    return this.exchange.fetchOHLCV(symbol, timeframe, since, limit);
  }

  async fetchBalance() {
    return this.exchange.fetchBalance();
  }

  async createOrder(
    symbol: string,
    type: "market" | "limit",
    side: "buy" | "sell",
    amount: number,
    price?: number,
    params?: Record<string, unknown>,
  ) {
    return this.exchange.createOrder(symbol, type, side, amount, price, params);
  }

  async cancelOrder(id: string, symbol?: string) {
    return this.exchange.cancelOrder(id, symbol);
  }

  async watchOrderBook(symbol: string, limit: number, _opts: WatchOptions = {}) {
    return this.exchange.watchOrderBook(symbol, limit);
  }

  async watchTicker(symbol: string, _opts: WatchOptions = {}) {
    return this.exchange.watchTicker(symbol);
  }

  async watchTrades(symbol: string, opts: WatchOptions = {}) {
    return this.exchange.watchTrades(symbol, opts.since, opts.limit);
  }

  async watchOHLCV(symbol: string, timeframe: string, opts: WatchOptions = {}) {
    return this.exchange.watchOHLCV(symbol, timeframe, opts.since, opts.limit);
  }

  async watchOrders(symbol: string, opts: WatchOptions = {}) {
    return this.exchange.watchOrders(symbol, opts.since, opts.limit);
  }

  async watchBalance(_opts: WatchOptions = {}) {
    return this.exchange.watchBalance();
  }

  async watchPositions(symbols?: string[], _opts: WatchOptions = {}) {
    if (symbols === undefined) {
      return this.exchange.watchPositions(undefined);
    }
    return this.exchange.watchPositions(symbols);
  }

  close(): void {
    // A CCXT Pro watch ciklusok a consumer kilepesevel leallnak.
  }
}