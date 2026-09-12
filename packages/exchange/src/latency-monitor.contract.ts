/**
 * Public contracts and configuration for latency monitoring.
 */

export type SupportedExchangeId = "binance" | "bybit" | "kucoin" | "bybiteu";

export const SUPPORTED_EXCHANGE_IDS: readonly SupportedExchangeId[] = [
  "binance",
  "bybit",
  "kucoin",
  "bybiteu",
];
const supportedExchangeIdValues: readonly string[] = SUPPORTED_EXCHANGE_IDS;

export function isSupportedExchangeId(value: string): value is SupportedExchangeId {
  return supportedExchangeIdValues.includes(value);
}

export interface RttSample {
  readonly exchangeId: SupportedExchangeId;
  readonly timestamp: number;
  readonly rttMs: number;
  readonly method: "rest" | "ws-ping";
  readonly success: boolean;
}

export interface MessageGapSample {
  readonly exchangeId: SupportedExchangeId;
  readonly timestamp: number;
  readonly gapMs: number;
  readonly previousTimestamp: number | undefined;
}

export interface ReconnectSample {
  readonly exchangeId: SupportedExchangeId;
  readonly timestamp: number;
  readonly reconnectMs: number;
  readonly disconnectAt: number;
}

export type LatencySample = RttSample | MessageGapSample | ReconnectSample;

export interface LatencyStats {
  readonly exchangeId: SupportedExchangeId;
  readonly rttCount: number;
  readonly rttMinMs: number;
  readonly rttMaxMs: number;
  readonly rttMedianMs: number;
  readonly rttP95Ms: number;
  readonly rttP99Ms: number;
  readonly rttSuccessRate: number;
  readonly gapCount: number;
  readonly gapMinMs: number;
  readonly gapMaxMs: number;
  readonly gapMedianMs: number;
  readonly gapP95Ms: number;
  readonly gapP99Ms: number;
  readonly reconnectCount: number;
  readonly reconnectMinMs: number;
  readonly reconnectMaxMs: number;
  readonly reconnectMedianMs: number;
  readonly reconnectP95Ms: number;
}

export interface LatencyMonitorConfig {
  readonly exchangeIds: readonly SupportedExchangeId[];
  readonly symbol?: string;
  readonly durationMs?: number;
  readonly rttIntervalMs?: number;
  readonly wsMessageBudget?: number;
  readonly measureReconnect?: boolean;
  readonly forcedDisconnectAtMs?: number;
}

export interface LatencyMonitorDefaults {
  readonly symbol: string;
  readonly durationMs: number;
  readonly rttIntervalMs: number;
  readonly wsMessageBudget: number;
  readonly measureReconnect: boolean;
  readonly forcedDisconnectAtMs: number;
}

/**
 * Wall-clock dependency used by latency-monitor lifecycle measurements.
 *
 * Production uses the system clock and timer; callers may provide another
 * implementation when the surrounding runtime supplies its own scheduler.
 */
export interface LatencyMonitorTimePort {
  readonly now: () => number;
  readonly wait: (milliseconds: number) => Promise<void>;
}

export const DEFAULT_LATENCY_MONITOR_CONFIG: LatencyMonitorDefaults = Object.freeze({
  symbol: "BTC/USDT",
  durationMs: 30_000,
  rttIntervalMs: 500,
  wsMessageBudget: 1000,
  measureReconnect: true,
  forcedDisconnectAtMs: 15_000,
});

export interface LatencyMonitorResult {
  readonly config: Required<Omit<LatencyMonitorConfig, "exchangeIds">> & {
    readonly exchangeIds: readonly SupportedExchangeId[];
  };
  readonly startedAt: number;
  readonly endedAt: number;
  readonly statsByExchange: Readonly<Record<SupportedExchangeId, LatencyStats>>;
  readonly samples: readonly LatencySample[];
}
