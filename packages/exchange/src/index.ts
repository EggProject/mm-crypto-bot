// packages/exchange/src/index.ts — a `@mm/exchange` csomag belépési pontja
//
// FELADAT: Aggregálja a `feed`, `factory`, `bybitEuFeed`, `symbols`
// és `types` modulok összes publikus API-ját, hogy a fogyasztók
// (paper engine, backtest, TUI) egyetlen `import { ... } from "@mm/exchange"`
// sorral hozzáférjenek mindenhez.
//
// A factory (`createExchangeClient`) a `factory.ts`-ből jön — ez a fő
// belépési pont az alkalmazáskód számára. A típusok a `types.ts`-ból,
// az implementációk a `bybitEuFeed.ts`-ból származnak.
//
// === PHASE 66 ENFORCEMENT ===
//   A `MockExchangeFeed` class, a `createMockFeed` factory, a
//   `MockFeedOptions` / `MockExchangeFeedOptions` típusok, valamint a
//   `defaultTicker` / `defaultOrderBook` / `defaultMarketMeta` helper
//   függvények NEM exportálódnak a public surface-en. A mock feed a
//   `__testing__/mockFeed.ts`-ban van, és CSAK a tesztek importálhatják
//   közvetlenül (lásd a felhasználói mandátumot: "csak a test hasznalhatja
//   a mock feed -et!").

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

// ⚠️  TEST-ONLY: `MockExchangeFeed` and the `createMockFeed` factory
//    are NOT exported from this public surface. Tests must import the
//    class directly from `"./__testing__/mockFeed.js"`. Production
//    code (bot, web, TUI) cannot reach the mock feed via
//    `@mm-crypto-bot/exchange`.

export {
  readExchangeCredentials,
  detectExchangeEnv,
  createExchangeClient,
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

// === Phase 37 Track 3 — OHLC stream (live trade → OHLC bar aggregation) ===

export {
  alignToTimeframe,
  barsToCandles,
  barsToOhlcv,
  DEFAULT_OHLC_STREAM_CONFIG,
  OhlcStream,
  RingBuffer,
} from "./ohlc-stream.js";
export type {
  OhlcBar,
  OhlcStreamBarEvent,
  OhlcStreamConfig,
  OhlcStreamErrorEvent,
} from "./ohlc-stream.js";
