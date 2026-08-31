/**
 * Public API for the exchange package. Test-only feed helpers are intentionally not exported.
 */

export type {
  Balance,
  ClientOrderId,
  ExchangeOrderId,
  ExchangePosition,
  Execution,
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
  ProtectiveOrderKind,
  Symbol,
  SpotMarginOrderIntent,
  SpotMarginRequiredCapacity,
  Ticker,
  Timeframe,
  Trade,
} from "./types.js";

export type { ExchangeFeed, FeedListener, SubscriptionId } from "./feed.js";
export { ExchangeFeedError } from "./feed.js";
export { ClientOrderIdError, makeClientOrderId } from "./client-order-id.js";

export {
  SUPPORTED_SYMBOLS,
  isSupportedSymbol,
  asSymbol,
  symbolOf,
  baseCurrencyOf,
  quoteCurrencyOf,
  InvalidSymbolError,
} from "./symbols.js";

export { BybitEuFeed, type BybitEuFeedOptions } from "./bybit-eu-feed.js";
export { BybitEuClientError, CcxtBybitEuClientAdapter } from "./bybit-eu-client.js";
export type { BybitEuClient } from "./bybit-eu-client.js";
export type { BybitEuAdapterClient, BybitEuAdapterOptions } from "./bybit-eu-adapter.js";
export type {
  RawBalanceEntryPayload,
  RawBalancesPayload,
  RawMarketLimitPayload,
  RawMarketLimitsPayload,
  RawMarketPayload,
  RawMarketPrecisionPayload,
  RawOhlcvPayload,
  RawOrderBookLevel,
  RawOrderBookPayload,
  RawOrderPayload,
  RawPositionPayload,
  RawTickerPayload,
  RawTradeFeePayload,
  RawTradePayload,
} from "./bybit-eu-raw-payloads.js";

export {
  normalizeTicker,
  normalizeOrderBook,
  normalizeTrade,
  normalizeMarketMeta,
  normalizeBalances,
  normalizeExecution,
  normalizeOrder,
} from "./bybit-eu-normalizers.js";

export {
  BYBIT_EU_SPOT_MARGIN_VENUE,
  REQUIRED_SPOT_MARGIN_MODE,
  SpotMarginAuthorizationError,
  SpotMarginAuthorizer,
} from "./spot-margin-authorization.js";
export type {
  SpotMarginAuthorizationClient,
  SpotMarginAuthorizationEvidence,
  SpotMarginActivationEvidence,
  SpotMarginAuthorizationRequest,
  SpotMarginBorrowCapacity,
  SpotMarginClock,
} from "./spot-margin-authorization.js";

export {
  readExchangeCredentials,
  detectExchangeEnvironment,
  createExchangeClient,
  MissingCredentialsError,
  type ExchangeCredentials,
  type ExchangeEnvironment,
} from "./factory.js";

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

export {
  alignToTimeframe,
  barsToCandles,
  barsToOhlcv,
  DEFAULT_OHLC_STREAM_CONFIG,
  OhlcStream,
  RingBuffer,
} from "./ohlc-stream.js";
export type { OhlcBar, OhlcStreamBarEvent, OhlcStreamConfig, OhlcStreamErrorEvent } from "./ohlc-stream.js";
