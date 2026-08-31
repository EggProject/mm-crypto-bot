import ccxt from "ccxt";

import type { BybitEuClient } from "./bybit-eu-client.js";
import type {
  RawBalancesPayload,
  RawOhlcvPayload,
  RawOrderBookPayload,
  RawOrderPayload,
  RawPositionPayload,
  RawTickerPayload,
  RawTradePayload,
} from "./bybit-eu-raw-payloads.js";
import type { SpotMarginAuthorizationOptions } from "./bybit-eu-order-service.js";

export function officialBybitEuUrlMap(): Record<string, unknown> {
  return {
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
}

export function neverResolvingPromise<T>(): Promise<T> {
  return new Promise<T>(() => {
    // This fixture represents a stream that the test cancels before it emits.
  });
}

type CcxtConstructor = new (...arguments_: readonly unknown[]) => object;

export interface BybitEuConstructorCapture {
  readonly calls: () => number;
  readonly client: () => object | undefined;
  readonly options: () => unknown;
  readonly urls: () => unknown;
}

export function withCapturedBybitEuConstructor<T>(callback: (capture: BybitEuConstructorCapture) => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(ccxt.pro, "bybiteu");
  if (descriptor === undefined || !("value" in descriptor) || !isCcxtConstructor(descriptor.value)) {
    throw new Error("CCXT Pro Bybit EU constructor is unavailable");
  }
  const originalConstructor = descriptor.value;
  let client: object | undefined;
  let constructorCalls = 0;
  let options: unknown;
  let urls: unknown;
  const trackedConstructor = new Proxy(originalConstructor, {
    construct(target, arguments_, newTarget) {
      const constructedValue: unknown = Reflect.construct(target, arguments_, newTarget);
      if (!isObject(constructedValue)) throw new Error("CCXT Pro Bybit EU constructor returned a non-object");
      const constructedClient = constructedValue;
      const firstArgument: unknown = arguments_[0];
      const observedUrls: unknown = Reflect.get(constructedClient, "urls");
      constructorCalls += 1;
      client = constructedClient;
      options = firstArgument;
      urls = observedUrls;
      return constructedClient;
    },
  });
  if (!Reflect.defineProperty(ccxt.pro, "bybiteu", { ...descriptor, value: trackedConstructor })) {
    throw new Error("CCXT Pro Bybit EU constructor cannot be captured");
  }

  try {
    return callback({
      calls: () => constructorCalls,
      client: () => client,
      options: () => options,
      urls: () => urls,
    });
  } finally {
    Reflect.defineProperty(ccxt.pro, "bybiteu", descriptor);
  }
}

function isCcxtConstructor(value: unknown): value is CcxtConstructor {
  return typeof value === "function";
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

export function makeFakeExchange(overrides: Partial<BybitEuClient> = {}): BybitEuClient {
  const base: BybitEuClient = {
    urls: officialBybitEuUrlMap(),
    markets: {
      "BTC/USDC": {
        id: "BTCUSDC",
        base: "BTC",
        quote: "USDC",
        precision: { amount: 4, price: 2 },
        limits: { amount: { min: 0.0001 }, cost: { min: 1 } },
      },
    },
    market: (_symbol) => ({
      id: "BTCUSDC",
      base: "BTC",
      quote: "USDC",
      spot: true,
      precision: { amount: 4, price: 2 },
      limits: { amount: { min: 0.0001 }, cost: { min: 1 } },
    }),
    loadMarkets: () => Promise.resolve(base.markets),
    watchTicker: (_symbol) => neverResolvingPromise<RawTickerPayload>(),
    watchOrderBook: (_symbol, _limit) => neverResolvingPromise<RawOrderBookPayload>(),
    watchTrades: (_symbol) => neverResolvingPromise<readonly RawTradePayload[]>(),
    watchOHLCV: (_symbol, _timeframe, _since, _limit) => neverResolvingPromise<readonly RawOhlcvPayload[]>(),
    watchOrders: () => neverResolvingPromise<readonly RawOrderPayload[]>(),
    watchMyTrades: () => neverResolvingPromise<readonly RawTradePayload[]>(),
    unWatchOrders: () => Promise.resolve(),
    unWatchMyTrades: () => Promise.resolve(),
    fetchTicker: (_symbol) =>
      Promise.resolve({
        symbol: "BTC/USDC",
        timestamp: Date.now(),
        bid: 59_999,
        ask: 60_001,
        last: 60_000,
        baseVolume: 0,
        quoteVolume: 0,
      }),
    fetchOrderBook: (_symbol, _limit) =>
      Promise.resolve({
        symbol: "BTC/USDC",
        timestamp: Date.now(),
        nonce: 0,
        bids: [[59_999, 1]],
        asks: [[60_001, 1]],
      }),
    fetchTrades: (_symbol) => Promise.resolve([]),
    fetchBalance: () =>
      Promise.resolve<RawBalancesPayload>({
        USDC: { free: 10_000, total: 10_000 },
        info: {},
      }),
    has: { fetchPositions: false },
    fetchPositions: (_symbols) => Promise.resolve<readonly RawPositionPayload[]>([]),
    fetchOHLCV: (_symbol, _timeframe, _since, _limit) => Promise.resolve<readonly RawOhlcvPayload[]>([]),
    createOrder: (_symbol, type, side, amount, price, _parameters) =>
      Promise.resolve<RawOrderPayload>({
        id: `mock-${String(Date.now())}`,
        clientOrderId: "test-order",
        symbol: "BTC/USDC",
        type,
        side,
        amount,
        price,
        status: "open",
        filled: 0,
        timestamp: Date.now(),
      }),
    cancelOrder: (_id, _symbol, parameters) =>
      Promise.resolve<RawOrderPayload>({
        id: "mock",
        clientOrderId: optionalString(parameters["orderLinkId"]),
        symbol: "BTC/USDC",
        status: "canceled",
      }),
    fetchOrder: (_id, _symbol, parameters) =>
      Promise.resolve<RawOrderPayload>({
        id: "mock",
        clientOrderId: optionalString(parameters["orderLinkId"]),
        symbol: "BTC/USDC",
        status: "open",
      }),
    fetchOpenOrders: (_symbol) => Promise.resolve<readonly RawOrderPayload[]>([]),
    close: () => Promise.resolve(),
  };
  return { ...base, ...overrides };
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const spotMarginAuthorization: SpotMarginAuthorizationOptions = {
  maximumAgeMs: 5000,
  clock: { nowUtcMs: () => 1_700_000_000_000 },
  client: {
    getSpotMarginState: () =>
      Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10" } }),
    setSpotMarginLeverage: () => Promise.resolve({ retCode: 0, result: {} }),
    getBorrowQuota: () =>
      Promise.resolve({
        retCode: 0,
        result: {
          symbol: "BTCUSDC",
          side: "Buy",
          maxTradeQty: "1",
          maxTradeAmount: "100",
          spotMaxTradeQty: "0.1",
          spotMaxTradeAmount: "10",
          borrowCoin: "USDC",
        },
      }),
  },
};

export type { BybitEuClient } from "./bybit-eu-client.js";
