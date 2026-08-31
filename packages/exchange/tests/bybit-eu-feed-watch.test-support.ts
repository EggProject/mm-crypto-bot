import { expect } from "vitest";

import type { BybitEuClient } from "../src/bybit-eu-client.js";
import { BybitEuFeed } from "../src/bybit-eu-feed.js";
import type {
  RawBalancesPayload,
  RawMarketPayload,
  RawOhlcvPayload,
  RawOrderBookPayload,
  RawOrderPayload,
  RawPositionPayload,
  RawTickerPayload,
  RawTradePayload,
} from "../src/bybit-eu-raw-payloads.js";
import { asSymbol } from "../src/symbols.js";
import type { FeedEvent } from "../src/types.js";

export const BTC_USDC = asSymbol("BTC/USDC");
export const ETH_USDC = asSymbol("ETH/USDC");

const BYBIT_EU_URLS: Record<string, unknown> = {
  api: {
    spot: "https://api.bybit.eu",
    futures: "https://api.bybit.eu",
    v2: "https://api.bybit.eu",
    public: "https://api.bybit.eu",
    private: "https://api.bybit.eu",
    ws: {
      public: {
        spot: "wss://stream.bybit.eu/v5/public/spot",
        inverse: "wss://stream.bybit.eu/v5/public/inverse",
        option: "wss://stream.bybit.eu/v5/public/option",
        linear: "wss://stream.bybit.eu/v5/public/linear",
      },
      private: {
        spot: {
          unified: "wss://stream.bybit.eu/v5/private",
          nonUnified: "wss://stream.bybit.eu/spot/private/v3",
        },
        contract: "wss://stream.bybit.eu/v5/private",
        usdc: "wss://stream.bybit.eu/trade/option/usdc/private/v1",
        trade: "wss://stream.bybit.eu/v5/trade",
      },
    },
  },
};

const COMPLETED = Promise.resolve();

type WatchKind = "ticker" | "orderbook" | "trades" | "ohlcv" | "orders" | "executions";
type ReleaseArguments =
  | readonly ["ticker", RawTickerPayload]
  | readonly ["orderbook", RawOrderBookPayload]
  | readonly ["trades", readonly RawTradePayload[]]
  | readonly ["ohlcv", readonly RawOhlcvPayload[]]
  | readonly ["orders", readonly RawOrderPayload[]]
  | readonly ["executions", readonly RawTradePayload[]];
type ClientCall =
  | { readonly kind: "createOrder"; readonly args: Parameters<BybitEuClient["createOrder"]> }
  | { readonly kind: "cancelOrder"; readonly args: Parameters<BybitEuClient["cancelOrder"]> }
  | { readonly kind: "fetchOrder"; readonly args: Parameters<BybitEuClient["fetchOrder"]> }
  | {
      readonly kind: "spotMarginBorrowCheck";
      readonly args: Parameters<NonNullable<BybitEuClient["privateGetV5OrderSpotBorrowCheck"]>>;
    }
  | { readonly kind: "spotMarginTradeState"; readonly args: readonly [] }
  | { readonly kind: "unWatchOrders"; readonly args: readonly [] }
  | { readonly kind: "unWatchMyTrades"; readonly args: readonly [] };

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function defer<Value>(): Deferred<Value> {
  const { promise, resolve } = Promise.withResolvers<Value>();
  return { promise, resolve };
}

const SPOT_MARGIN_MARKET: RawMarketPayload = {
  base: "BTC",
  id: "BTCUSDC",
  limits: { amount: { min: 0.0001 }, cost: { min: 1 } },
  precision: { amount: 6, price: 2 },
  quote: "USDC",
  spot: true,
};

export class WatchFixtureClient implements BybitEuClient {
  private marketsState: Readonly<Record<string, RawMarketPayload | undefined>> = {
    [BTC_USDC]: SPOT_MARGIN_MARKET,
  };
  private readonly tickerDeferreds: Deferred<RawTickerPayload>[] = [];
  private readonly orderBookDeferreds: Deferred<RawOrderBookPayload>[] = [];
  private readonly tradesDeferreds: Deferred<readonly RawTradePayload[]>[] = [];
  private readonly ohlcvDeferreds: Deferred<readonly RawOhlcvPayload[]>[] = [];
  private readonly ordersDeferreds: Deferred<readonly RawOrderPayload[]>[] = [];
  private readonly executionsDeferreds: Deferred<readonly RawTradePayload[]>[] = [];
  private watchTickerHandler: (symbol: string) => Promise<RawTickerPayload> = (_symbol) =>
    enqueue(this.tickerDeferreds);
  readonly calls: ClientCall[] = [];
  readonly has = { unWatchMyTrades: true, unWatchOrders: true };
  readonly urls: Record<string, unknown> = structuredClone(BYBIT_EU_URLS);

  get markets(): Readonly<Record<string, RawMarketPayload | undefined>> {
    return this.marketsState;
  }

  setMarkets(markets: Readonly<Record<string, RawMarketPayload | undefined>>): void {
    this.marketsState = markets;
  }

  setWatchTicker(handler: (symbol: string) => Promise<RawTickerPayload>): void {
    this.watchTickerHandler = handler;
  }

  release(...[kind, value]: ReleaseArguments): Promise<void> {
    switch (kind) {
      case "ticker": {
        releaseNext(this.tickerDeferreds, value, kind);
        return COMPLETED;
      }
      case "orderbook": {
        releaseNext(this.orderBookDeferreds, value, kind);
        return COMPLETED;
      }
      case "trades": {
        releaseNext(this.tradesDeferreds, value, kind);
        return COMPLETED;
      }
      case "ohlcv": {
        releaseNext(this.ohlcvDeferreds, value, kind);
        return COMPLETED;
      }
      case "orders": {
        releaseNext(this.ordersDeferreds, value, kind);
        return COMPLETED;
      }
      case "executions": {
        releaseNext(this.executionsDeferreds, value, kind);
        return COMPLETED;
      }
    }
  }

  cancelOrder(...arguments_: Parameters<BybitEuClient["cancelOrder"]>): Promise<RawOrderPayload> {
    this.calls.push({ kind: "cancelOrder", args: arguments_ });
    return Promise.resolve({
      amount: 1,
      clientOrderId: orderLinkId(arguments_[2]),
      filled: 0,
      id: "x",
      price: 100,
      side: "buy",
      status: "canceled",
      timestamp: 1,
      type: "limit",
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  createOrder(...arguments_: Parameters<BybitEuClient["createOrder"]>): Promise<RawOrderPayload> {
    this.calls.push({ kind: "createOrder", args: arguments_ });
    return Promise.resolve({
      amount: arguments_[3],
      clientOrderId: orderLinkId(arguments_[5]) ?? "c1",
      filled: 0,
      id: "order-1",
      price: arguments_[4],
      side: arguments_[2],
      status: "open",
      timestamp: 1234,
      type: arguments_[1],
    });
  }

  fetchBalance(): Promise<RawBalancesPayload> {
    return Promise.resolve({
      BTC: { free: 0.5, total: 0.5 },
      USDC: { free: 1000, total: 1000 },
    });
  }

  fetchOHLCV(): Promise<readonly RawOhlcvPayload[]> {
    return Promise.resolve([]);
  }

  fetchOpenOrders(symbol: string): Promise<readonly RawOrderPayload[]> {
    return Promise.resolve([
      {
        amount: 1,
        clientOrderId: "c1",
        filled: 0,
        id: "x",
        price: 100,
        side: "buy",
        status: "open",
        symbol,
        timestamp: 1,
        type: "limit",
      },
    ]);
  }

  fetchOrder(...arguments_: Parameters<BybitEuClient["fetchOrder"]>): Promise<RawOrderPayload> {
    this.calls.push({ kind: "fetchOrder", args: arguments_ });
    return Promise.resolve({
      amount: 1,
      clientOrderId: orderLinkId(arguments_[2]),
      filled: 0,
      id: "x",
      price: 100,
      side: "buy",
      status: "open",
      timestamp: 1,
      type: "limit",
    });
  }

  fetchOrderBook(): Promise<RawOrderBookPayload> {
    return Promise.resolve({ asks: [[50_100, 2]], bids: [[50_000, 1]], nonce: 2, timestamp: 1 });
  }

  fetchPositions(): Promise<readonly RawPositionPayload[]> {
    return Promise.resolve([]);
  }

  fetchTicker(): Promise<RawTickerPayload> {
    return Promise.resolve({
      ask: 50_100,
      baseVolume: 10,
      bid: 50_000,
      last: 50_050,
      quoteVolume: 500_000,
      timestamp: 12_345,
    });
  }

  fetchTrades(): Promise<readonly RawTradePayload[]> {
    return Promise.resolve([]);
  }

  loadMarkets(): Promise<Readonly<Record<string, RawMarketPayload | undefined>>> {
    return Promise.resolve(this.marketsState);
  }

  market(): RawMarketPayload {
    return SPOT_MARGIN_MARKET;
  }

  privateGetV5OrderSpotBorrowCheck(parameters: Readonly<Record<string, string>>): Promise<unknown> {
    this.calls.push({ kind: "spotMarginBorrowCheck", args: [parameters] });
    return Promise.resolve({
      retCode: 0,
      result: {
        borrowCoin: "USDC",
        maxTradeAmount: "1",
        maxTradeQty: "1",
        side: parameters["side"],
        spotMaxTradeAmount: "1",
        spotMaxTradeQty: "1",
        symbol: parameters["symbol"],
      },
    });
  }

  privateGetV5SpotMarginTradeState(): Promise<unknown> {
    this.calls.push({ kind: "spotMarginTradeState", args: [] });
    return Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10" } });
  }

  unWatchMyTrades(): Promise<void> {
    this.calls.push({ kind: "unWatchMyTrades", args: [] });
    return Promise.resolve();
  }

  unWatchOrders(): Promise<void> {
    this.calls.push({ kind: "unWatchOrders", args: [] });
    return Promise.resolve();
  }

  watchMyTrades(): Promise<readonly RawTradePayload[]> {
    return enqueue(this.executionsDeferreds);
  }

  watchOHLCV(): Promise<readonly RawOhlcvPayload[]> {
    return enqueue(this.ohlcvDeferreds);
  }

  watchOrderBook(): Promise<RawOrderBookPayload> {
    return enqueue(this.orderBookDeferreds);
  }

  watchOrders(): Promise<readonly RawOrderPayload[]> {
    return enqueue(this.ordersDeferreds);
  }

  watchTicker(symbol: string): Promise<RawTickerPayload> {
    return this.watchTickerHandler(symbol);
  }

  watchTrades(): Promise<readonly RawTradePayload[]> {
    return enqueue(this.tradesDeferreds);
  }
}

function enqueue<Value>(deferreds: Deferred<Value>[]): Promise<Value> {
  const next = defer<Value>();
  deferreds.push(next);
  return next.promise;
}

function releaseNext<Value>(deferreds: Deferred<Value>[], value: Value, kind: WatchKind): void {
  const next = deferreds.shift();
  if (next === undefined) throw new Error(`No pending watch for kind=${kind}`);
  next.resolve(value);
}

function orderLinkId(parameters: Readonly<Record<string, unknown>>): string | undefined {
  const value = parameters["orderLinkId"];
  return typeof value === "string" ? value : undefined;
}

export function findCall<Kind extends ClientCall["kind"]>(
  calls: readonly ClientCall[],
  kind: Kind,
): Extract<ClientCall, { readonly kind: Kind }> {
  const call = calls.find(
    (candidate): candidate is Extract<ClientCall, { readonly kind: Kind }> => candidate.kind === kind,
  );
  if (call === undefined) throw new Error(`Expected ${kind} client call`);
  return call;
}

export function makeFeed(exchange: BybitEuClient): BybitEuFeed {
  return new BybitEuFeed({
    apiKey: "k",
    exchange,
    rateLimitMs: 100,
    secret: "s",
    spotMarginAuthorization: { clock: { nowUtcMs: () => 1_700_000_000_000 }, maximumAgeMs: 1000 },
  });
}

export function ignoreFeedEvent(event: FeedEvent): void {
  void event;
}

export async function releaseAndComplete(
  feed: BybitEuFeed,
  subscriptionId: number,
  release: () => Promise<void>,
): Promise<void> {
  const completion = feed.waitForSubscription(subscriptionId);
  await release();
  await feed.unsubscribe(subscriptionId);
  await expect(completion).resolves.toBeUndefined();
}
