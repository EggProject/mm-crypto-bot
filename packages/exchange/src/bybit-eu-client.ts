import type {
  RawBalancesPayload,
  RawMarketPayload,
  RawOhlcvPayload,
  RawOrderBookLevel,
  RawOrderBookPayload,
  RawOrderPayload,
  RawPositionPayload,
  RawTickerPayload,
  RawTradeFeePayload,
  RawTradePayload,
} from "./bybit-eu-raw-payloads.js";
import { ExchangeFeedError } from "./feed.js";

export class BybitEuClientError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "BybitEuClientError";
  }
}

export class BybitEuOriginAdmissionError extends ExchangeFeedError {
  constructor(cause: unknown) {
    super("Bybit EU client origin admission failed", cause);
    this.name = "BybitEuOriginAdmissionError";
  }
}

export interface BybitEuClient {
  readonly has: Readonly<Record<string, boolean | "emulated" | undefined>>;
  readonly markets: Readonly<Record<string, RawMarketPayload | undefined>>;
  readonly urls: Record<string, unknown>;
  cancelOrder(
    id: string | undefined,
    symbol: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<RawOrderPayload>;
  close(): Promise<void>;
  createOrder(
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price: number | undefined,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<RawOrderPayload>;
  fetchBalance(): Promise<RawBalancesPayload>;
  fetchOHLCV(
    symbol: string,
    timeframe: string,
    since: number | undefined,
    limit: number,
  ): Promise<readonly RawOhlcvPayload[]>;
  fetchOpenOrders(symbol: string): Promise<readonly RawOrderPayload[]>;
  fetchOrder(
    id: string | undefined,
    symbol: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<RawOrderPayload>;
  fetchOrderBook(symbol: string, limit: number): Promise<RawOrderBookPayload>;
  fetchPositions(symbols: readonly string[] | undefined): Promise<readonly RawPositionPayload[]>;
  fetchTicker(symbol: string): Promise<RawTickerPayload>;
  fetchTrades(symbol: string): Promise<readonly RawTradePayload[]>;
  loadMarkets(): Promise<Readonly<Record<string, RawMarketPayload | undefined>>>;
  market(symbol: string): RawMarketPayload;
  readonly privateGetV5OrderSpotBorrowCheck?:
    ((parameters: Readonly<Record<string, string>>) => Promise<unknown>) | undefined;
  readonly privateGetV5SpotMarginTradeState?: (() => Promise<unknown>) | undefined;
  readonly privatePostV5SpotMarginTradeSetLeverage?:
    ((parameters: Readonly<{ leverage: string }>) => Promise<unknown>) | undefined;
  unWatchMyTrades(): Promise<void>;
  unWatchOrders(): Promise<void>;
  watchMyTrades(): Promise<readonly RawTradePayload[]>;
  watchOHLCV(
    symbol: string,
    timeframe: string,
    since: number | undefined,
    limit: number | undefined,
  ): Promise<readonly RawOhlcvPayload[]>;
  watchOrderBook(symbol: string, limit: number): Promise<RawOrderBookPayload>;
  watchOrders(): Promise<readonly RawOrderPayload[]>;
  watchTicker(symbol: string): Promise<RawTickerPayload>;
  watchTrades(symbol: string): Promise<readonly RawTradePayload[]>;
}

type ExternalClient = Record<string, unknown>;
type ExternalMethod = (...arguments_: readonly unknown[]) => unknown;
type OriginAdmission = () => void;

export function guardBybitEuClientOrigins(
  client: BybitEuClient,
  assertOriginAdmission: OriginAdmission,
): BybitEuClient {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (!isExternalMethod(value)) return value;
      return (...arguments_: readonly unknown[]): unknown => {
        try {
          assertOriginAdmission();
        } catch (error) {
          throw new BybitEuOriginAdmissionError(error);
        }
        return Reflect.apply(value, target, arguments_);
      };
    },
  });
}

/**
 * Validates the live-feed port at the CCXT boundary. The generated CCXT client
 * stays opaque; only raw payload fields consumed by this package cross it.
 */
export class CcxtBybitEuClientAdapter implements BybitEuClient {
  readonly #exchange: ExternalClient;

  constructor(exchange: unknown) {
    this.#exchange = requiredRecord(exchange, "CCXT bybiteu client");
  }

  get has(): Readonly<Record<string, boolean | "emulated" | undefined>> {
    const source = requiredRecord(Reflect.get(this.#exchange, "has"), "CCXT capability map");
    const capabilities: Record<string, boolean | undefined> = {};
    for (const [name, value] of Object.entries(source)) {
      if (typeof value === "boolean") Reflect.set(capabilities, name, value);
    }
    return capabilities;
  }

  get markets(): Readonly<Record<string, RawMarketPayload | undefined>> {
    const source = requiredRecord(Reflect.get(this.#exchange, "markets"), "CCXT market map");
    const markets: Record<string, RawMarketPayload | undefined> = {};
    for (const [symbol, value] of Object.entries(source)) Reflect.set(markets, symbol, rawMarket(value));
    return markets;
  }

  get urls(): Record<string, unknown> {
    return requiredRecord(Reflect.get(this.#exchange, "urls"), "CCXT URL map");
  }

  async cancelOrder(
    id: string | undefined,
    symbol: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<RawOrderPayload> {
    return rawOrder(await this.call("cancelOrder", [id, symbol, parameters]));
  }

  async close(): Promise<void> {
    await this.call("close", []);
  }

  async createOrder(
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price: number | undefined,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<RawOrderPayload> {
    return rawOrder(await this.call("createOrder", [symbol, type, side, amount, price, parameters]));
  }

  async fetchBalance(): Promise<RawBalancesPayload> {
    return rawBalances(await this.call("fetchBalance", []));
  }

  async fetchOHLCV(
    symbol: string,
    timeframe: string,
    since: number | undefined,
    limit: number,
  ): Promise<readonly RawOhlcvPayload[]> {
    return rawOhlcvs(await this.call("fetchOHLCV", [symbol, timeframe, since, limit]));
  }

  async fetchOpenOrders(symbol: string): Promise<readonly RawOrderPayload[]> {
    return rawOrders(await this.call("fetchOpenOrders", [symbol]));
  }

  async fetchOrder(
    id: string | undefined,
    symbol: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<RawOrderPayload> {
    return rawOrder(await this.call("fetchOrder", [id, symbol, parameters]));
  }

  async fetchOrderBook(symbol: string, limit: number): Promise<RawOrderBookPayload> {
    return rawOrderBook(await this.call("fetchOrderBook", [symbol, limit]));
  }

  async fetchPositions(symbols: readonly string[] | undefined): Promise<readonly RawPositionPayload[]> {
    return rawPositions(await this.call("fetchPositions", [symbols]));
  }

  async fetchTicker(symbol: string): Promise<RawTickerPayload> {
    return rawTicker(await this.call("fetchTicker", [symbol]));
  }

  async fetchTrades(symbol: string): Promise<readonly RawTradePayload[]> {
    return rawTrades(await this.call("fetchTrades", [symbol]));
  }

  async loadMarkets(): Promise<Readonly<Record<string, RawMarketPayload | undefined>>> {
    await this.call("loadMarkets", []);
    return this.markets;
  }

  market(symbol: string): RawMarketPayload {
    return rawMarket(this.callSynchronously("market", [symbol]));
  }

  async privateGetV5OrderSpotBorrowCheck(parameters: Readonly<Record<string, string>>): Promise<unknown> {
    return this.call("privateGetV5OrderSpotBorrowCheck", [parameters]);
  }

  async privateGetV5SpotMarginTradeState(): Promise<unknown> {
    return this.call("privateGetV5SpotMarginTradeState", []);
  }

  async privatePostV5SpotMarginTradeSetLeverage(
    parameters: Readonly<{ leverage: string }>,
  ): Promise<unknown> {
    return this.call("privatePostV5SpotMarginTradeSetLeverage", [parameters]);
  }

  async unWatchMyTrades(): Promise<void> {
    await this.call("unWatchMyTrades", []);
  }

  async unWatchOrders(): Promise<void> {
    await this.call("unWatchOrders", []);
  }

  async watchMyTrades(): Promise<readonly RawTradePayload[]> {
    return rawTrades(await this.call("watchMyTrades", []));
  }

  async watchOHLCV(
    symbol: string,
    timeframe: string,
    since: number | undefined,
    limit: number | undefined,
  ): Promise<readonly RawOhlcvPayload[]> {
    return rawOhlcvs(await this.call("watchOHLCV", [symbol, timeframe, since, limit]));
  }

  async watchOrderBook(symbol: string, limit: number): Promise<RawOrderBookPayload> {
    return rawOrderBook(await this.call("watchOrderBook", [symbol, limit]));
  }

  async watchOrders(): Promise<readonly RawOrderPayload[]> {
    return rawOrders(await this.call("watchOrders", []));
  }

  async watchTicker(symbol: string): Promise<RawTickerPayload> {
    return rawTicker(await this.call("watchTicker", [symbol]));
  }

  async watchTrades(symbol: string): Promise<readonly RawTradePayload[]> {
    return rawTrades(await this.call("watchTrades", [symbol]));
  }

  // eslint-disable-next-line unicorn/consistent-class-member-order -- Calls stay beside the guarded external invocation.
  private async call(name: string, arguments_: readonly unknown[]): Promise<unknown> {
    return await this.callSynchronously(name, arguments_);
  }

  private callSynchronously(name: string, arguments_: readonly unknown[]): unknown {
    const method = Reflect.get(this.#exchange, name);
    if (!isExternalMethod(method))
      throw new BybitEuClientError(`CCXT method is unavailable: ${name}`, undefined);
    return Reflect.apply(method, this.#exchange, arguments_);
  }
}

function requiredRecord(value: unknown, label: string): ExternalClient {
  if (isRecord(value)) return value;
  throw new BybitEuClientError(`${label} is unavailable or malformed`, undefined);
}

function rawTicker(value: unknown): RawTickerPayload {
  return rawNumbers(requiredRecord(value, "CCXT ticker"), [
    "ask",
    "baseVolume",
    "bid",
    "last",
    "quoteVolume",
    "timestamp",
  ]);
}

function rawOrderBook(value: unknown): RawOrderBookPayload {
  const source = requiredRecord(value, "CCXT order book");
  return {
    asks: rawOrderBookLevels(source["asks"], "asks"),
    bids: rawOrderBookLevels(source["bids"], "bids"),
    ...rawNumbers(source, ["nonce", "timestamp"]),
  };
}

function rawOrderBookLevels(value: unknown, label: string): readonly RawOrderBookLevel[] {
  if (!Array.isArray(value)) throw new BybitEuClientError(`CCXT order book ${label} is malformed`, undefined);
  return value.map((level) => {
    if (!Array.isArray(level) || typeof level[0] !== "number" || typeof level[1] !== "number") {
      throw new BybitEuClientError(`CCXT order book ${label} level is malformed`, undefined);
    }
    return [level[0], level[1]];
  });
}

function rawTrades(value: unknown): readonly RawTradePayload[] {
  if (!Array.isArray(value)) throw new BybitEuClientError("CCXT trades are malformed", undefined);
  return value.map((trade) => rawTrade(trade));
}

function rawTrade(value: unknown): RawTradePayload {
  const source = requiredRecord(value, "CCXT trade");
  return {
    ...rawNumbers(source, ["amount", "price", "timestamp"]),
    ...rawStrings(source, ["id", "order", "side", "symbol"]),
    ...(source["fee"] !== undefined && { fee: rawTradeFee(source["fee"]) }),
  };
}

function rawTradeFee(value: unknown): RawTradeFeePayload {
  const source = requiredRecord(value, "CCXT trade fee");
  return { ...rawNumbers(source, ["cost"]), ...rawStrings(source, ["currency"]) };
}

function rawOhlcvs(value: unknown): readonly RawOhlcvPayload[] {
  if (!Array.isArray(value)) throw new BybitEuClientError("CCXT OHLCV data is malformed", undefined);
  return value.map((candle) => rawOhlcv(candle));
}

function rawOhlcv(value: unknown): RawOhlcvPayload {
  if (!Array.isArray(value) || value.length < 6 || !value.slice(0, 6).every(isNumber)) {
    throw new BybitEuClientError("CCXT OHLCV candle is malformed", undefined);
  }
  return [value[0], value[1], value[2], value[3], value[4], value[5]];
}

function rawBalances(value: unknown): RawBalancesPayload {
  const source = requiredRecord(value, "CCXT balances");
  const balances: Record<string, RawBalancesPayload[string]> = {};
  for (const [currency, entry] of Object.entries(source)) {
    if (typeof entry === "number" || typeof entry === "string") Reflect.set(balances, currency, entry);
    else if (isRecord(entry)) Reflect.set(balances, currency, rawNumbers(entry, ["free", "total"]));
  }
  return balances;
}

function rawPositions(value: unknown): readonly RawPositionPayload[] {
  if (!Array.isArray(value)) throw new BybitEuClientError("CCXT positions are malformed", undefined);
  return value.map((position) => rawPosition(position));
}

function rawPosition(value: unknown): RawPositionPayload {
  const source = requiredRecord(value, "CCXT position");
  return {
    ...rawNumbers(source, ["contracts", "entryPrice", "lastUpdateTimestamp", "markPrice", "unrealizedPnl"]),
    ...rawStrings(source, ["side", "symbol"]),
  };
}

function rawOrders(value: unknown): readonly RawOrderPayload[] {
  if (!Array.isArray(value)) throw new BybitEuClientError("CCXT orders are malformed", undefined);
  return value.map((order) => rawOrder(order));
}

function rawOrder(value: unknown): RawOrderPayload {
  const source = requiredRecord(value, "CCXT order");
  return {
    ...rawNumbers(source, ["amount", "average", "filled", "lastUpdateTimestamp", "price", "timestamp"]),
    ...rawStrings(source, ["clientOrderId", "id", "side", "status", "symbol", "type"]),
  };
}

function rawMarket(value: unknown): RawMarketPayload {
  const source = requiredRecord(value, "CCXT market");
  const precision = requiredRecord(source["precision"], "CCXT market precision");
  const limits = requiredRecord(source["limits"], "CCXT market limits");
  return {
    base: requiredString(source["base"], "CCXT market base"),
    quote: requiredString(source["quote"], "CCXT market quote"),
    ...rawStrings(source, ["id"]),
    ...rawBooleans(source, ["spot"]),
    precision: rawNumbers(precision, ["amount", "price"]),
    limits: {
      ...(limits["amount"] !== undefined && { amount: rawMarketLimit(limits["amount"]) }),
      ...(limits["cost"] !== undefined && { cost: rawMarketLimit(limits["cost"]) }),
    },
  };
}

function rawMarketLimit(value: unknown): { readonly min?: number | undefined } {
  return rawNumbers(requiredRecord(value, "CCXT market limit"), ["min"]);
}

function rawNumbers(source: ExternalClient, names: readonly string[]): Record<string, number | undefined> {
  const result: Record<string, number | undefined> = {};
  for (const name of names) {
    const value = Reflect.get(source, name);
    if (value !== undefined && typeof value !== "number")
      throw new BybitEuClientError(`CCXT field is malformed: ${name}`, undefined);
    if (value !== undefined) Reflect.set(result, name, value);
  }
  return result;
}

function rawStrings(source: ExternalClient, names: readonly string[]): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const name of names) {
    const value = Reflect.get(source, name);
    if (value !== undefined && typeof value !== "string")
      throw new BybitEuClientError(`CCXT field is malformed: ${name}`, undefined);
    if (value !== undefined) Reflect.set(result, name, value);
  }
  return result;
}

function rawBooleans(source: ExternalClient, names: readonly string[]): Record<string, boolean | undefined> {
  const result: Record<string, boolean | undefined> = {};
  for (const name of names) {
    const value = Reflect.get(source, name);
    if (value !== undefined && typeof value !== "boolean")
      throw new BybitEuClientError(`CCXT field is malformed: ${name}`, undefined);
    if (value !== undefined) Reflect.set(result, name, value);
  }
  return result;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  throw new BybitEuClientError(`${label} is malformed`, undefined);
}

function isRecord(value: unknown): value is ExternalClient {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExternalMethod(value: unknown): value is ExternalMethod {
  return typeof value === "function";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}
