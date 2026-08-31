import ccxt from "ccxt";

import {
  CcxtBybitEuClientAdapter,
  guardBybitEuClientOrigins,
  type BybitEuClient,
} from "./bybit-eu-client.js";
import {
  normalizeBalances,
  normalizeMarketMeta,
  normalizeOrderBook,
  normalizePosition,
  normalizeTicker,
} from "./bybit-eu-normalizers.js";
import { BybitEuOrderService, type SpotMarginAuthorizationOptions } from "./bybit-eu-order-service.js";
import { BybitEuSubscriptionManager } from "./bybit-eu-subscription-manager.js";
import { ExchangeFeedError, type ExchangeFeed, type FeedListener, type SubscriptionId } from "./feed.js";
import { isSupportedSymbol } from "./symbols.js";
import type {
  Balance,
  ClientOrderId,
  ExchangePosition,
  MarketMeta,
  Ohlcv,
  Order,
  OrderBook,
  OrderRequest,
  OrderStatus,
  Symbol,
  Ticker,
  Timeframe,
} from "./types.js";

export interface BybitEuFeedOptions {
  readonly apiKey: string;
  readonly secret: string;
  readonly rateLimitMs: number;
  readonly timeoutMs?: number;
  readonly spotMarginAuthorization?: SpotMarginAuthorizationOptions;
  readonly exchange?: BybitEuClient;
}

const BYBIT_EU_REST_ORIGIN = "https://api.bybit.eu";
const BYBIT_EU_WEBSOCKET_ORIGIN = "wss://stream.bybit.eu";

interface OriginMap {
  readonly [key: string]: OriginMap | string;
}

const BYBIT_EU_API_URL_MAP: OriginMap = {
  spot: BYBIT_EU_REST_ORIGIN,
  futures: BYBIT_EU_REST_ORIGIN,
  v2: BYBIT_EU_REST_ORIGIN,
  public: BYBIT_EU_REST_ORIGIN,
  private: BYBIT_EU_REST_ORIGIN,
  ws: {
    public: {
      spot: `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/public/spot`,
      inverse: `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/public/inverse`,
      option: `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/public/option`,
      linear: `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/public/linear`,
    },
    private: {
      spot: {
        unified: `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/private`,
        nonUnified: `${BYBIT_EU_WEBSOCKET_ORIGIN}/spot/private/v3`,
      },
      contract: `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/private`,
      usdc: `${BYBIT_EU_WEBSOCKET_ORIGIN}/trade/option/usdc/private/v1`,
      trade: `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/trade`,
    },
  },
};

export class BybitEuFeed implements ExchangeFeed {
  readonly #client: BybitEuClient;
  readonly #spotMarginAuthorization: SpotMarginAuthorizationOptions | undefined;
  #serviceClient: BybitEuClient | undefined;
  #orders: BybitEuOrderService | undefined;
  #subscriptions: BybitEuSubscriptionManager | undefined;
  #opened = false;
  readonly exchangeId = "bybiteu";

  constructor(options: BybitEuFeedOptions) {
    assertApprovedBybitEuConfig(options);
    let client: BybitEuClient;
    if (options.exchange === undefined) {
      const rawClient = new ccxt.pro.bybiteu({
        apiKey: options.apiKey,
        secret: options.secret,
        enableRateLimit: true,
        rateLimit: options.rateLimitMs,
        ...(options.timeoutMs !== undefined && { timeout: options.timeoutMs }),
        options: { defaultType: "spot" },
      });
      client = new CcxtBybitEuClientAdapter(rawClient);
      lockBybitEuOrigins(client);
    } else {
      client = options.exchange;
    }
    assertApprovedBybitEuClientOrigins(client);
    this.#client = guardBybitEuClientOrigins(client, () => {
      assertApprovedBybitEuClientOrigins(client);
    });
    this.#spotMarginAuthorization = options.spotMarginAuthorization;
  }

  private assertOpen(): void {
    if (!this.#opened) throw new ExchangeFeedError("Exchange feed is not open", undefined);
  }

  private assertOriginAdmission(): void {
    assertApprovedBybitEuClientOrigins(this.#client);
  }

  get #services(): { orders: BybitEuOrderService; subscriptions: BybitEuSubscriptionManager } {
    if (
      this.#serviceClient !== this.#client ||
      this.#orders === undefined ||
      this.#subscriptions === undefined
    ) {
      this.#serviceClient = this.#client;
      this.#orders = new BybitEuOrderService(this.#client, this.#spotMarginAuthorization);
      this.#subscriptions = new BybitEuSubscriptionManager(this.#client);
    }
    return { orders: this.#orders, subscriptions: this.#subscriptions };
  }

  private assertReady(symbol: Symbol): void {
    this.assertOpen();
    this.assertOriginAdmission();
    if (!isSupportedSymbol(symbol))
      throw new ExchangeFeedError(`Unsupported symbol: ${String(symbol)}`, undefined);
  }

  async open(): Promise<void> {
    this.assertOriginAdmission();
    if (this.#opened) return;
    await this.#client.loadMarkets();
    this.#opened = true;
  }

  async close(): Promise<void> {
    this.assertOriginAdmission();
    this.#services.subscriptions.close();
    this.#opened = false;
    await this.#client.close();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- The public async contract converts readiness failures to rejected promises.
  async subscribeTicker(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId> {
    this.assertReady(symbol);
    return this.#services.subscriptions.subscribeTicker(symbol, listener);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- The public async contract converts readiness failures to rejected promises.
  async subscribeOrderBook(symbol: Symbol, limit: number, listener: FeedListener): Promise<SubscriptionId> {
    this.assertReady(symbol);
    return this.#services.subscriptions.subscribeOrderBook(symbol, limit, listener);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- The public async contract converts readiness failures to rejected promises.
  async subscribeTrades(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId> {
    this.assertReady(symbol);
    return this.#services.subscriptions.subscribeTrades(symbol, listener);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- The public async contract converts readiness failures to rejected promises.
  async subscribeOhlcv(
    symbol: Symbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    this.assertReady(symbol);
    return this.#services.subscriptions.subscribeOhlcv(symbol, timeframe, listener);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- The public async contract converts readiness failures to rejected promises.
  async subscribeOrderUpdates(listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    this.assertOriginAdmission();
    return this.#services.subscriptions.subscribeOrders(listener);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- The public async contract converts readiness failures to rejected promises.
  async subscribeExecutions(listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    this.assertOriginAdmission();
    return this.#services.subscriptions.subscribeExecutions(listener);
  }

  async unsubscribe(id: SubscriptionId): Promise<void> {
    this.assertOriginAdmission();
    await this.#services.subscriptions.unsubscribe(id);
  }

  waitForSubscription(id: SubscriptionId): Promise<void> {
    this.assertOriginAdmission();
    return this.#services.subscriptions.waitForSubscription(id);
  }

  async fetchTickerSnapshot(symbol: Symbol): Promise<Ticker> {
    this.assertReady(symbol);
    return normalizeTicker(await this.#client.fetchTicker(symbol), symbol);
  }

  async fetchOrderBookSnapshot(symbol: Symbol, limit: number): Promise<OrderBook> {
    this.assertReady(symbol);
    return normalizeOrderBook(await this.#client.fetchOrderBook(symbol, limit), symbol);
  }

  async fetchOHLCV(
    symbol: Symbol,
    timeframe: Timeframe,
    since: number | undefined,
    limit: number,
  ): Promise<readonly Ohlcv[]> {
    this.assertReady(symbol);
    return toOhlcvs(await this.#client.fetchOHLCV(symbol, timeframe, since, limit));
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- The public async contract converts lookup failures to rejected promises.
  async fetchMarketMeta(symbol: Symbol): Promise<MarketMeta> {
    this.assertOpen();
    this.assertOriginAdmission();
    const market = Reflect.get(this.#client.markets, symbol);
    if (market === undefined) throw new ExchangeFeedError(`Unknown market: ${symbol}`, undefined);
    return normalizeMarketMeta(market, symbol);
  }

  async fetchBalances(): Promise<readonly Balance[]> {
    this.assertOpen();
    this.assertOriginAdmission();
    return normalizeBalances(await this.#client.fetchBalance());
  }

  async fetchPositions(symbols?: readonly Symbol[]): Promise<readonly ExchangePosition[]> {
    this.assertOpen();
    this.assertOriginAdmission();
    if (this.#client.has["fetchPositions"] !== true) {
      throw new ExchangeFeedError("The configured Bybit category does not support fetchPositions", undefined);
    }
    const rawPositions = await this.#client.fetchPositions(symbols === undefined ? undefined : [...symbols]);
    return rawPositions
      .map((position) => normalizePosition(position))
      .filter((position): position is ExchangePosition => position !== undefined);
  }

  async placeOrder(request: OrderRequest): Promise<Order> {
    this.assertOpen();
    this.assertOriginAdmission();
    return this.#services.orders.place(request);
  }

  async cancelOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    this.assertReady(symbol);
    return this.#services.orders.cancel(clientOrderId, symbol);
  }

  async fetchOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    this.assertReady(symbol);
    return this.#services.orders.fetch(clientOrderId, symbol);
  }

  async fetchOpenOrders(symbol: Symbol): Promise<readonly Order[]> {
    this.assertReady(symbol);
    return this.#services.orders.fetchOpen(symbol);
  }

  statusOf(value: string): OrderStatus {
    if (["open", "closed", "canceled"].includes(value)) return value as OrderStatus;
    return value === "filled" ? "closed" : "open";
  }
}

function lockBybitEuOrigins(client: BybitEuClient): void {
  const api = requiredRecord(requiredRecord(client.urls, "CCXT URL map")["api"], "CCXT API URL map");
  api["spot"] = BYBIT_EU_REST_ORIGIN;
  api["futures"] = BYBIT_EU_REST_ORIGIN;
  api["v2"] = BYBIT_EU_REST_ORIGIN;
  api["public"] = BYBIT_EU_REST_ORIGIN;
  api["private"] = BYBIT_EU_REST_ORIGIN;
  const websocketUrls = requiredRecord(api["ws"], "CCXT WebSocket URL map");
  const publicUrls = requiredRecord(websocketUrls["public"], "CCXT public WebSocket URL map");
  const privateUrls = requiredRecord(websocketUrls["private"], "CCXT private WebSocket URL map");
  publicUrls["spot"] = `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/public/spot`;
  publicUrls["inverse"] = `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/public/inverse`;
  publicUrls["option"] = `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/public/option`;
  publicUrls["linear"] = `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/public/linear`;
  const spotUrls = requiredRecord(privateUrls["spot"], "CCXT private Spot WebSocket URL map");
  spotUrls["unified"] = `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/private`;
  spotUrls["nonUnified"] = `${BYBIT_EU_WEBSOCKET_ORIGIN}/spot/private/v3`;
  privateUrls["contract"] = `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/private`;
  privateUrls["usdc"] = `${BYBIT_EU_WEBSOCKET_ORIGIN}/trade/option/usdc/private/v1`;
  privateUrls["trade"] = `${BYBIT_EU_WEBSOCKET_ORIGIN}/v5/trade`;
}

function assertApprovedBybitEuClientOrigins(client: BybitEuClient): void {
  try {
    const urls = requiredRecord(client.urls, "Bybit EU client URL map");
    assertExactOriginMap(Reflect.get(urls, "api"), BYBIT_EU_API_URL_MAP, "Bybit EU API URL map");
  } catch (error) {
    if (error instanceof ExchangeFeedError) throw error;
    throw new ExchangeFeedError("Bybit EU client URL map is unavailable or malformed", error);
  }
}

function assertExactOriginMap(actual: unknown, expected: OriginMap, label: string): void {
  const actualMap = requiredRecord(actual, label);
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actualMap);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => !Object.hasOwn(expected, key)) ||
    expectedKeys.some((key) => !Object.hasOwn(actualMap, key))
  ) {
    throw new ExchangeFeedError(`${label} is incomplete or contains unapproved endpoints`, undefined);
  }
  for (const key of expectedKeys) {
    const expectedValue = Reflect.get(expected, key);
    const actualValue = Reflect.get(actualMap, key);
    if (typeof expectedValue === "string") {
      if (actualValue !== expectedValue) {
        throw new ExchangeFeedError(`${label} has an unapproved endpoint at ${key}`, undefined);
      }
    } else {
      assertExactOriginMap(actualValue, requiredOriginMap(expectedValue, label), `${label}.${key}`);
    }
  }
}

function requiredOriginMap(value: unknown, label: string): OriginMap {
  if (isOriginMap(value)) return value;
  throw new ExchangeFeedError(`${label} is unavailable or malformed`, undefined);
}

function isOriginMap(value: unknown): value is OriginMap {
  const map = recordOrUndefined(value);
  return (
    map !== undefined && Object.values(map).every((entry) => typeof entry === "string" || isOriginMap(entry))
  );
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = recordOrUndefined(value);
  if (record === undefined) throw new ExchangeFeedError(`${label} is unavailable or malformed`, undefined);
  return record;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assertApprovedBybitEuConfig(options: object): void {
  const prohibitedFields = ["endpoint", "wsEndpoint", "sandbox"] as const;
  for (const field of prohibitedFields) {
    if (Reflect.get(options, field) !== undefined) {
      throw new ExchangeFeedError(
        `Bybit EU production configuration does not permit ${field} overrides`,
        undefined,
      );
    }
  }
}

function toOhlcvs(value: readonly unknown[]): readonly Ohlcv[] {
  return value.map((candle) => {
    if (!isOhlcv(candle)) throw new ExchangeFeedError("CCXT returned malformed OHLCV data", undefined);
    return candle;
  });
}

function isOhlcv(value: unknown): value is Ohlcv {
  return (
    Array.isArray(value) && value.length >= 6 && value.slice(0, 6).every((part) => typeof part === "number")
  );
}
