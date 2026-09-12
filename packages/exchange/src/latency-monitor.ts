/**
 * CCXT lifecycle facade for REST and WebSocket latency monitoring.
 */

import ccxt, { type Exchange as CcxtExchange } from "ccxt";
import { performance } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";

import {
  DEFAULT_LATENCY_MONITOR_CONFIG,
  type LatencyMonitorConfig,
  type LatencyMonitorDefaults,
  type LatencyMonitorResult,
  type LatencySample,
  type LatencyStats,
  type LatencyMonitorTimePort,
  type RttSample,
  type SupportedExchangeId,
} from "./latency-monitor.contract.js";
import { aggregateStats } from "./latency-monitor-statistics.js";

export {
  SUPPORTED_EXCHANGE_IDS,
  isSupportedExchangeId,
  type LatencyMonitorConfig,
  type LatencyMonitorResult,
  type LatencyMonitorTimePort,
  type LatencySample,
  type LatencyStats,
  type MessageGapSample,
  type ReconnectSample,
  type RttSample,
  type SupportedExchangeId,
} from "./latency-monitor.contract.js";
export { aggregateStats, median, percentile, round2 } from "./latency-monitor-statistics.js";

const DEFAULT_TIME_PORT: LatencyMonitorTimePort = Object.freeze({
  utcNow: Date.now,
  monotonicNow: performance.now.bind(performance),
  wait,
});

const INVALID_MONOTONIC_TIME_ERROR = "Érvénytelen monotón időérték.";

class InvalidMonotonicTimeError extends Error {
  constructor() {
    super(INVALID_MONOTONIC_TIME_ERROR);
  }
}

class MonotonicClock {
  private previous: number | undefined;

  constructor(private readonly source: Pick<LatencyMonitorTimePort, "monotonicNow">) {}

  read(): number {
    const current = this.source.monotonicNow();
    if (!Number.isFinite(current) || current < 0 || (this.previous !== undefined && current < this.previous))
      throw new InvalidMonotonicTimeError();
    this.previous = current;
    return current;
  }
}

class StatsByExchangeAccumulator implements Record<SupportedExchangeId, LatencyStats> {
  declare binance: LatencyStats;
  declare bybit: LatencyStats;
  declare kucoin: LatencyStats;
  declare bybiteu: LatencyStats;

  set(exchangeId: SupportedExchangeId, stats: LatencyStats): void {
    switch (exchangeId) {
      case "binance": {
        this.binance = stats;
        break;
      }
      case "bybit": {
        this.bybit = stats;
        break;
      }
      case "kucoin": {
        this.kucoin = stats;
        break;
      }
      case "bybiteu": {
        this.bybiteu = stats;
        break;
      }
    }
  }

  snapshot(): Record<SupportedExchangeId, LatencyStats> {
    return Object.assign({}, this);
  }
}

interface ExchangeMeasurement {
  readonly exchangeId: SupportedExchangeId;
  readonly result: { readonly samples: LatencySample[]; readonly stats: LatencyStats };
}

function createCcxtExchange(exchangeId: string, options: Record<string, unknown>): CcxtExchange {
  switch (exchangeId) {
    case "binance": {
      return new ccxt.pro.binance(options);
    }
    case "bybit": {
      return new ccxt.pro.bybit(options);
    }
    case "kucoin": {
      return new ccxt.pro.kucoin(options);
    }
    case "bybiteu": {
      return new ccxt.pro.bybiteu(options);
    }
    default: {
      throw new Error(`Ismeretlen exchange ID (pro): ${exchangeId}`);
    }
  }
}

export class LatencyMonitor {
  private readonly defaultConfig: LatencyMonitorDefaults = DEFAULT_LATENCY_MONITOR_CONFIG;
  private readonly time: LatencyMonitorTimePort;
  private cancelled = false;
  private activeExchange: CcxtExchange | undefined;

  constructor(time: LatencyMonitorTimePort = DEFAULT_TIME_PORT) {
    this.time = time;
  }

  private async measureOrEmpty(
    exchangeId: SupportedExchangeId,
    config: LatencyMonitorConfig,
  ): Promise<{ samples: LatencySample[]; stats: LatencyStats }> {
    try {
      return await this.measureExchange(exchangeId, config);
    } catch (error) {
      if (error instanceof InvalidMonotonicTimeError) throw error;
      return { samples: [], stats: emptyStats(exchangeId) };
    }
  }

  private async measureRtt(
    exchange: CcxtExchange,
    exchangeId: SupportedExchangeId,
    symbol: string,
    durationMs: number,
    rttIntervalMs: number,
    clock: MonotonicClock,
  ): Promise<RttSample[]> {
    const samples: RttSample[] = [];
    const endTime = clock.read() + durationMs;
    while (clock.read() < endTime && !this.cancelled) {
      const timestamp = this.time.utcNow();
      const startedAt = clock.read();
      let isSuccessful: boolean;
      try {
        await exchange.fetchTicker(symbol);
        isSuccessful = true;
      } catch {
        isSuccessful = false;
      }
      samples.push({
        exchangeId,
        timestamp,
        rttMs: clock.read() - startedAt,
        method: "rest",
        success: isSuccessful,
      });
      const remaining = startedAt + rttIntervalMs - clock.read();
      if (remaining > 0) {
        const untilDeadline = endTime - clock.read();
        const delay = Math.max(0, Math.min(remaining, untilDeadline));
        await this.time.wait(delay);
      }
    }
    return samples;
  }

  private async measureMessageGap(
    exchange: CcxtExchange,
    exchangeId: SupportedExchangeId,
    symbol: string,
    durationMs: number,
    wsMessageBudget: number,
    forcedDisconnectAtMs: number,
    clock: MonotonicClock,
  ): Promise<LatencySample[]> {
    const samples: LatencySample[] = [];
    let lastMessageAt: { readonly monotonic: number; readonly utc: number } | undefined;
    let reconnectStartAt: { readonly monotonic: number; readonly utc: number } | undefined;
    let messagesSinceConnect = 0;
    const startTime = clock.read();
    const endTime = startTime + durationMs;
    while (clock.read() < endTime && messagesSinceConnect < wsMessageBudget && !this.cancelled) {
      const currentTime = clock.read();
      const shouldReconnect =
        reconnectStartAt === undefined &&
        forcedDisconnectAtMs !== Infinity &&
        currentTime - startTime >= forcedDisconnectAtMs;
      if (shouldReconnect) {
        reconnectStartAt = { monotonic: currentTime, utc: this.time.utcNow() };
        await closeQuietly(exchange);
        await this.time.wait(200);
        try {
          await exchange.loadMarkets();
        } catch {
          // The first later message measures the failed reconnect window.
        }
        continue;
      }
      try {
        await exchange.watchOrderBook(symbol, 50);
        const timestamp = this.time.utcNow();
        const monotonicTimestamp = clock.read();
        messagesSinceConnect += 1;
        if (lastMessageAt !== undefined)
          samples.push({
            exchangeId,
            timestamp,
            gapMs: monotonicTimestamp - lastMessageAt.monotonic,
            previousTimestamp: lastMessageAt.utc,
          });
        lastMessageAt = { monotonic: monotonicTimestamp, utc: timestamp };
        if (reconnectStartAt !== undefined && samples.every((sample) => !("reconnectMs" in sample)))
          samples.push({
            exchangeId,
            timestamp,
            reconnectMs: monotonicTimestamp - reconnectStartAt.monotonic,
            disconnectAt: reconnectStartAt.utc,
          });
      } catch {
        await this.time.wait(50);
      }
    }
    await closeQuietly(exchange);
    return samples;
  }

  async abort(): Promise<void> {
    this.cancelled = true;
    if (this.activeExchange !== undefined) {
      await closeQuietly(this.activeExchange);
    }
  }

  createExchange(exchangeId: SupportedExchangeId): CcxtExchange {
    return createCcxtExchange(exchangeId, {
      enableRateLimit: true,
      rateLimit: 100,
      options: { defaultType: "spot" },
    });
  }

  async measureExchange(
    exchangeId: SupportedExchangeId,
    config: LatencyMonitorConfig,
  ): Promise<{ samples: LatencySample[]; stats: LatencyStats }> {
    const symbol = config.symbol ?? this.defaultConfig.symbol;
    const durationMs = config.durationMs ?? this.defaultConfig.durationMs;
    const rttIntervalMs = config.rttIntervalMs ?? this.defaultConfig.rttIntervalMs;
    const wsMessageBudget = config.wsMessageBudget ?? this.defaultConfig.wsMessageBudget;
    const shouldMeasureReconnect = config.measureReconnect ?? this.defaultConfig.measureReconnect;
    const forcedDisconnectAtMs = config.forcedDisconnectAtMs ?? this.defaultConfig.forcedDisconnectAtMs;
    const samples: LatencySample[] = [];
    const exchange = this.createExchange(exchangeId);
    const clock = new MonotonicClock(this.time);
    this.activeExchange = exchange;
    this.cancelled = false;

    try {
      const rttPromise = (async (): Promise<void> => {
        samples.push(
          ...(await this.measureRtt(exchange, exchangeId, symbol, durationMs, rttIntervalMs, clock)),
        );
      })();
      const gapPromise = (async (): Promise<void> => {
        samples.push(
          ...(await this.measureMessageGap(
            exchange,
            exchangeId,
            symbol,
            durationMs,
            wsMessageBudget,
            shouldMeasureReconnect ? forcedDisconnectAtMs : Infinity,
            clock,
          )),
        );
      })();
      await Promise.all([rttPromise, gapPromise]);
    } finally {
      this.activeExchange = undefined;
      await closeQuietly(exchange);
    }

    return { samples, stats: aggregateStats(exchangeId, samples) };
  }

  async start(config: LatencyMonitorConfig): Promise<LatencyMonitorResult> {
    const startedAt = this.time.utcNow();
    const exchangeIds = config.exchangeIds;
    const effectiveConfig = {
      symbol: config.symbol ?? this.defaultConfig.symbol,
      durationMs: config.durationMs ?? this.defaultConfig.durationMs,
      rttIntervalMs: config.rttIntervalMs ?? this.defaultConfig.rttIntervalMs,
      wsMessageBudget: config.wsMessageBudget ?? this.defaultConfig.wsMessageBudget,
      measureReconnect: config.measureReconnect ?? this.defaultConfig.measureReconnect,
      forcedDisconnectAtMs: config.forcedDisconnectAtMs ?? this.defaultConfig.forcedDisconnectAtMs,
    };
    const perExchangeResults: readonly ExchangeMeasurement[] = await Promise.all(
      exchangeIds.map(async (exchangeId): Promise<ExchangeMeasurement> => ({
        exchangeId,
        result: await this.measureOrEmpty(exchangeId, config),
      })),
    );
    const statsByExchange = new StatsByExchangeAccumulator();
    const allSamples: LatencySample[] = [];
    for (const { exchangeId, result } of perExchangeResults) {
      statsByExchange.set(exchangeId, result.stats);
      allSamples.push(...result.samples);
    }
    return {
      config: { ...effectiveConfig, exchangeIds },
      startedAt,
      endedAt: this.time.utcNow(),
      statsByExchange: statsByExchange.snapshot(),
      samples: allSamples,
    };
  }
}

function emptyStats(exchangeId: SupportedExchangeId): LatencyStats {
  return {
    exchangeId,
    rttCount: 0,
    rttMinMs: NaN,
    rttMaxMs: NaN,
    rttMedianMs: NaN,
    rttP95Ms: NaN,
    rttP99Ms: NaN,
    rttSuccessRate: NaN,
    gapCount: 0,
    gapMinMs: NaN,
    gapMaxMs: NaN,
    gapMedianMs: NaN,
    gapP95Ms: NaN,
    gapP99Ms: NaN,
    reconnectCount: 0,
    reconnectMinMs: NaN,
    reconnectMaxMs: NaN,
    reconnectMedianMs: NaN,
    reconnectP95Ms: NaN,
  };
}

async function closeQuietly(exchange: CcxtExchange): Promise<void> {
  try {
    await exchange.close();
  } catch {
    // Cleanup remains best effort because a connection may already be closed.
  }
}
