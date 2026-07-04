// packages/exchange/src/index.ts — a `@mm/exchange` csomag belépési pontja
//
// FELADAT: Aggregálja a `feed`, `factory`, `bybitEuFeed`, `mockFeed`,
// `symbols` és `types` modulok összes publikus API-ját, hogy a fogyasztók
// (paper engine, backtest, TUI) egyetlen `import { ... } from "@mm/exchange"`
// sorral hozzáférjenek mindenhez.
//
// A factory-k (`createExchangeClient`, `createMockFeed`) a `factory.ts`-
// ből jönnek — ezek a fő belépési pontok az alkalmazáskód számára.
// A típusok a `types.ts`-ból, az implementációk a `bybitEuFeed.ts` /
// `mockFeed.ts`-ből származnak.

export type {
  Balance,
  ClientOrderId,
  ExchangeOrderId,
  FeedEvent,
  MarketMeta,
  Ohlcv,
  Order,
  OrderBook,
  OrderBookLevel,
  OrderRequest,
  OrderSide,
  OrderStatus,
  OrderType,
  Symbol,
  Ticker,
  Timeframe,
  Trade,
} from "./types.js";

export type { ExchangeFeed, FeedListener, SubscriptionId } from "./feed.js";
export { ExchangeFeedError } from "./feed.js";

export { SUPPORTED_SYMBOLS, isSupportedSymbol, asSymbol, symbolOf, baseCurrencyOf, quoteCurrencyOf, InvalidSymbolError } from "./symbols.js";

export { BybitEuFeed, type BybitEuFeedOptions, normalizeTicker, normalizeOrderBook, normalizeTrade, normalizeMarketMeta, normalizeBalances, normalizeOrder } from "./bybitEuFeed.js";

export { MockExchangeFeed, defaultTicker, defaultOrderBook, defaultMarketMeta, type MockExchangeFeedOptions } from "./mockFeed.js";

export {
  readExchangeCredentials,
  detectExchangeEnv,
  createExchangeClient,
  createMockFeed,
  MissingCredentialsError,
  type ExchangeCredentials,
  type ExchangeEnv,
} from "./factory.js";

// === Phase 6 Track B — latency monitor (cross-exchange arb deployment readiness) ===

export {
  LatencyMonitor,
  SUPPORTED_EXCHANGE_IDS,
  isSupportedExchangeId,
  aggregateStats,
  median,
  percentile,
  round2,
} from "./latency-monitor.js";
export type {
  LatencyMonitorConfig,
  LatencyMonitorResult,
  LatencySample,
  LatencyStats,
  MessageGapSample,
  ReconnectSample,
  RttSample,
  SupportedExchangeId,
} from "./latency-monitor.js";
