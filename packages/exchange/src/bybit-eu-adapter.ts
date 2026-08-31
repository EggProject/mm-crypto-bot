import ccxt, { type Exchange as CcxtExchange } from "ccxt";

import type { ExchangeFeed, WatchOptions } from "@mm-crypto-bot/shared";

/**
 * Minimal CCXT surface used by the generic Bybit EU adapter.
 */
export interface BybitEuAdapterClient {
  cancelOrder: CcxtExchange["cancelOrder"];
  createOrder: CcxtExchange["createOrder"];
  fetchBalance: CcxtExchange["fetchBalance"];
  fetchOHLCV: CcxtExchange["fetchOHLCV"];
  fetchOrderBook: CcxtExchange["fetchOrderBook"];
  fetchTicker: CcxtExchange["fetchTicker"];
  fetchTrades: CcxtExchange["fetchTrades"];
  loadMarkets: CcxtExchange["loadMarkets"];
  watchBalance: CcxtExchange["watchBalance"];
  watchOHLCV: CcxtExchange["watchOHLCV"];
  watchOrderBook: CcxtExchange["watchOrderBook"];
  watchOrders: CcxtExchange["watchOrders"];
  watchPositions: CcxtExchange["watchPositions"];
  watchTicker: CcxtExchange["watchTicker"];
  watchTrades: CcxtExchange["watchTrades"];
}

export interface BybitEuAdapterOptions {
  readonly apiKey?: string;
  readonly exchange?: BybitEuAdapterClient;
  readonly rateLimitMs?: number;
  readonly secret?: string;
}

/**
 * Delegates generic exchange feed operations to a configured Bybit EU client.
 */
export class BybitEuAdapter implements ExchangeFeed {
  private readonly exchange: BybitEuAdapterClient;
  readonly id = "bybiteu";
  readonly name = "Bybit EU";

  constructor(options: BybitEuAdapterOptions = {}) {
    if (options.exchange !== undefined) {
      this.exchange = options.exchange;
      return;
    }
    this.exchange = new ccxt.pro.bybiteu({
      enableRateLimit: true,
      rateLimit: options.rateLimitMs ?? 100,
      ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
      ...(options.secret !== undefined && { secret: options.secret }),
    });
  }

  async loadMarkets(isReload?: boolean) {
    return this.exchange.loadMarkets(isReload);
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
    parameters?: Record<string, unknown>,
  ) {
    return this.exchange.createOrder(symbol, type, side, amount, price, parameters);
  }

  async cancelOrder(id: string, symbol?: string) {
    return this.exchange.cancelOrder(id, symbol);
  }

  async watchOrderBook(symbol: string, limit: number, _options: WatchOptions = {}) {
    return this.exchange.watchOrderBook(symbol, limit);
  }

  async watchTicker(symbol: string, _options: WatchOptions = {}) {
    return this.exchange.watchTicker(symbol);
  }

  async watchTrades(symbol: string, options: WatchOptions = {}) {
    return this.exchange.watchTrades(symbol, options.since, options.limit);
  }

  async watchOHLCV(symbol: string, timeframe: string, options: WatchOptions = {}) {
    return this.exchange.watchOHLCV(symbol, timeframe, options.since, options.limit);
  }

  async watchOrders(symbol: string, options: WatchOptions = {}) {
    return this.exchange.watchOrders(symbol, options.since, options.limit);
  }

  async watchBalance(_options: WatchOptions = {}) {
    return this.exchange.watchBalance();
  }

  async watchPositions(symbols?: string[], _options: WatchOptions = {}) {
    return this.exchange.watchPositions(symbols);
  }

  close(): void {
    /*
     * This adapter owns no independent transport lifecycle.
     */
  }
}
