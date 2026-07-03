/**
 * packages/exchange/src/factory.ts
 *
 * Exchange adapter factory - a konfiguracioban megadott exchange-ID
 * alapjan letrehozza a megfelelo adaptert.
 *
 * Jelenleg csak a bybit.eu tamogatott; kesobb binance es okx adapterek
 * is drop-in behuzhatok ugyanebbe a factory-ba.
 */

import { BybitEuAdapter, type BybitEuAdapterOptions } from "./bybit-eu-adapter.js";
import type { ExchangeFeed } from "@mm-crypto-bot/shared";

export type SupportedExchange = "bybiteu" | "binance" | "okx";

export interface CreateExchangeOptions {
  readonly exchange: SupportedExchange;
  readonly apiKey?: string;
  readonly secret?: string;
  readonly sandbox?: boolean;
  readonly rateLimitMs?: number;
}

export function createExchangeAdapter(opts: CreateExchangeOptions): ExchangeFeed {
  switch (opts.exchange) {
    case "bybiteu": {
      const adapterOpts: BybitEuAdapterOptions = {
        ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        ...(opts.secret !== undefined ? { secret: opts.secret } : {}),
        ...(opts.sandbox !== undefined ? { sandbox: opts.sandbox } : {}),
        ...(opts.rateLimitMs !== undefined ? { rateLimitMs: opts.rateLimitMs } : {}),
      };
      return new BybitEuAdapter(adapterOpts);
    }
    case "binance":
    case "okx":
      throw new Error(
        `Exchange '${opts.exchange}' adapter meg nincs implementalva. ` +
          `TODO: packages/exchange/src/${opts.exchange}-adapter.ts`,
      );
    default: {
      const _exhaustive: never = opts.exchange;
      throw new Error(`Ismeretlen exchange: ${String(_exhaustive)}`);
    }
  }
}