import type {
  RawBalancesPayload,
  RawMarketPayload,
  RawOrderBookPayload,
  RawOrderPayload,
  RawPositionPayload,
  RawTickerPayload,
  RawTradePayload,
} from "./bybit-eu-raw-payloads.js";
import type {
  Balance,
  ExchangeOrderId,
  ExchangePosition,
  Execution,
  MarketMeta,
  Order,
  OrderRequest,
  OrderStatus,
  Symbol,
  Ticker,
  Trade,
  OrderBook,
} from "./types.js";

export function normalizeTicker(raw: RawTickerPayload, symbol: Symbol): Ticker {
  return {
    symbol,
    timestamp: raw.timestamp ?? Date.now(),
    bid: raw.bid ?? 0,
    ask: raw.ask ?? 0,
    last: raw.last ?? 0,
    baseVolume: raw.baseVolume ?? 0,
    quoteVolume: raw.quoteVolume ?? 0,
  };
}

export function normalizeOrderBook(raw: RawOrderBookPayload, symbol: Symbol): OrderBook {
  return {
    symbol,
    timestamp: raw.timestamp ?? Date.now(),
    nonce: raw.nonce ?? 0,
    bids: raw.bids.map(([price, amount]) => ({ price: price ?? 0, amount: amount ?? 0 })),
    asks: raw.asks.map(([price, amount]) => ({ price: price ?? 0, amount: amount ?? 0 })),
  };
}

export function normalizeTrade(raw: RawTradePayload, symbol: Symbol): Trade {
  return {
    id: raw.id ?? "",
    symbol,
    timestamp: raw.timestamp ?? Date.now(),
    price: raw.price ?? 0,
    amount: raw.amount ?? 0,
    takerSide: raw.side === "sell" ? "sell" : "buy",
  };
}

export function normalizeMarketMeta(raw: RawMarketPayload, symbol: Symbol): MarketMeta {
  const amountPrecision = typeof raw.precision.amount === "number" ? raw.precision.amount : 0;
  const pricePrecision = typeof raw.precision.price === "number" ? raw.precision.price : 0;
  const amountLimits = raw.limits.amount;
  const costLimits = raw.limits.cost;
  const minAmount = amountLimits !== undefined && typeof amountLimits.min === "number" ? amountLimits.min : 0;
  const minCost = costLimits !== undefined && typeof costLimits.min === "number" ? costLimits.min : 0;
  return {
    symbol,
    base: raw.base,
    quote: raw.quote,
    amountPrecision,
    pricePrecision,
    minAmount,
    minCost,
    ...(raw.spot !== undefined && { isSpot: raw.spot }),
  };
}

export function normalizeBalances(raw: RawBalancesPayload): readonly Balance[] {
  const balances: Balance[] = [];
  for (const [currency, entry] of Object.entries(raw)) {
    if (
      entry === undefined ||
      typeof entry !== "object" ||
      currency === "info" ||
      currency === "timestamp" ||
      currency === "datetime"
    )
      continue;
    balances.push({ currency, free: entry.free ?? 0, total: entry.total ?? 0 });
  }
  return balances;
}

export function normalizePosition(raw: RawPositionPayload): ExchangePosition | undefined {
  if (raw.symbol === undefined || raw.side === undefined || raw.contracts === undefined) return undefined;
  const side = raw.side === "short" ? "short" : "long";
  return {
    symbol: raw.symbol as Symbol,
    side,
    quantity: raw.contracts,
    entryPrice: raw.entryPrice,
    markPrice: raw.markPrice,
    unrealizedPnl: raw.unrealizedPnl,
    updateTimestamp: raw.lastUpdateTimestamp,
  };
}

export function normalizeExecution(raw: RawTradePayload): Execution | undefined {
  if (
    raw.id === undefined ||
    raw.symbol === undefined ||
    raw.side === undefined ||
    raw.amount === undefined ||
    raw.price === undefined
  ) {
    return undefined;
  }
  return {
    executionId: raw.id,
    clientOrderId: undefined,
    exchangeOrderId: raw.order as ExchangeOrderId | undefined,
    symbol: raw.symbol as Symbol,
    side: raw.side === "sell" ? "sell" : "buy",
    quantity: raw.amount,
    price: raw.price,
    fee: raw.fee?.cost ?? 0,
    feeCurrency: raw.fee?.currency,
    timestamp: raw.timestamp ?? Date.now(),
  };
}

export function normalizeOrder(raw: RawOrderPayload, request: OrderRequest | undefined): Order {
  const side = raw.side === "sell" ? "sell" : "buy";
  const type = raw.type === "limit" ? "limit" : "market";
  return {
    clientOrderId: (raw.clientOrderId ?? request?.clientOrderId ?? "") as Order["clientOrderId"],
    exchangeId: raw.id === undefined || raw.id.length === 0 ? undefined : (raw.id as ExchangeOrderId),
    symbol: (raw.symbol ?? request?.symbol ?? "UNKNOWN") as Symbol,
    side,
    type,
    amount: raw.amount ?? request?.amount ?? 0,
    price: raw.price ?? request?.price,
    status: normalizeOrderStatus(raw.status),
    filled: raw.filled ?? 0,
    average: raw.average,
    submitTimestamp: raw.timestamp ?? Date.now(),
    updateTimestamp: raw.lastUpdateTimestamp,
  };
}

function normalizeOrderStatus(value: string | undefined): OrderStatus {
  if (value === "closed" || value === "filled") return "closed";
  if (value === "canceled" || value === "cancelled") return "canceled";
  return "open";
}
