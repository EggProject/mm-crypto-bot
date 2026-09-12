/**
 * Unit-level public helper characterization for latency monitoring.
 */

import { describe, expect, it } from "vitest";
import ccxt, { type Dictionary, type Exchange, type Market, type OrderBook, type Ticker } from "ccxt";

import {
  LatencyMonitor,
  SUPPORTED_EXCHANGE_IDS,
  aggregateStats,
  isSupportedExchangeId,
  percentile,
  round2,
  type LatencySample,
  type LatencyMonitorTimePort,
} from "./latency-monitor.js";

class ScriptedTimePort implements LatencyMonitorTimePort {
  private monotonicTimestamp = 0;
  private utcTimestamp = 0;

  readonly utcNow = (): number => this.utcTimestamp++;

  readonly monotonicNow = (): number => this.monotonicTimestamp++;

  readonly wait = (_milliseconds: number): Promise<void> => Promise.resolve();
}

class AdvancingTimePort implements LatencyMonitorTimePort {
  private timestamp = 0;

  readonly utcNow = (): number => this.timestamp;

  readonly monotonicNow = (): number => this.timestamp;

  readonly wait = (milliseconds: number): Promise<void> => {
    this.timestamp += Math.max(0, milliseconds);
    return Promise.resolve();
  };
}

class LifecycleTimePort implements LatencyMonitorTimePort {
  private fallbackMonotonicTimestamp = 0;
  private monotonicIndex = 0;
  private utcIndex = 0;
  readonly waits: number[] = [];

  readonly utcNow = (): number =>
    this.utcReadings[Math.min(this.utcIndex++, this.utcReadings.length - 1)] ?? 0;

  readonly monotonicNow = (): number => {
    const reading = this.monotonicReadings[this.monotonicIndex++];
    return reading ?? this.fallbackMonotonicTimestamp++;
  };

  readonly wait = (milliseconds: number): Promise<void> => {
    this.waits.push(milliseconds);
    return Promise.resolve();
  };

  constructor(
    private readonly utcReadings: readonly number[],
    private readonly monotonicReadings: readonly number[] = [],
  ) {}
}

class ReceiverTimePort implements LatencyMonitorTimePort {
  private monotonicTimestamp = 0;
  private utcTimestamp = 0;

  utcNow(): number {
    return this.utcTimestamp++;
  }

  monotonicNow(): number {
    return this.monotonicTimestamp++;
  }

  wait(_milliseconds: number): Promise<void> {
    return Promise.resolve();
  }
}

class DefaultConfigMonitor extends LatencyMonitor {
  override createExchange(): Exchange {
    return new DefaultConfigExchange();
  }
}

class DefaultConfigExchange extends ccxt.pro.binance {
  override fetchTicker(): Promise<Ticker> {
    return Promise.resolve({
      symbol: "BTC/USDT",
      info: {},
      timestamp: 1,
      datetime: undefined,
      high: undefined,
      low: undefined,
      bid: undefined,
      bidVolume: undefined,
      ask: undefined,
      askVolume: undefined,
      vwap: undefined,
      open: undefined,
      close: undefined,
      last: undefined,
      previousClose: undefined,
      change: undefined,
      percentage: undefined,
      average: undefined,
      quoteVolume: undefined,
      baseVolume: undefined,
      indexPrice: undefined,
      markPrice: undefined,
    });
  }

  override close(): Promise<void> {
    return Promise.resolve();
  }
}

class RecoveringExchange extends ccxt.pro.binance {
  private tickerRequests = 0;
  private orderBookRequests = 0;

  override fetchTicker(): Promise<Ticker> {
    this.tickerRequests += 1;
    if (this.tickerRequests === 1) return Promise.reject(new Error("ticker temporarily unavailable"));
    return Promise.resolve(ticker());
  }

  override watchOrderBook(): Promise<OrderBook> {
    this.orderBookRequests += 1;
    if (this.orderBookRequests === 1) return Promise.resolve(orderBook(1));
    if (this.orderBookRequests === 3) throw new Error("order book temporarily unavailable");
    return orderBook(this.orderBookRequests);
  }

  override loadMarkets(): Promise<Dictionary<Market>> {
    return Promise.reject(new Error("reconnect market refresh unavailable"));
  }

  override close(): Promise<void> {
    return Promise.reject(new Error("already closed"));
  }
}

class RecoveringMonitor extends LatencyMonitor {
  readonly exchange: RecoveringExchange;

  constructor(time: LatencyMonitorTimePort) {
    super(time);
    this.exchange = new RecoveringExchange();
  }

  override createExchange(): Exchange {
    return this.exchange;
  }
}

class ImmediateMonitor extends LatencyMonitor {
  override createExchange(): Exchange {
    return new DefaultConfigExchange();
  }
}

function ticker(): Ticker {
  return {
    symbol: "BTC/USDT",
    info: {},
    timestamp: 1,
    datetime: undefined,
    high: undefined,
    low: undefined,
    bid: undefined,
    bidVolume: undefined,
    ask: undefined,
    askVolume: undefined,
    vwap: undefined,
    open: undefined,
    close: undefined,
    last: undefined,
    previousClose: undefined,
    change: undefined,
    percentage: undefined,
    average: undefined,
    quoteVolume: undefined,
    baseVolume: undefined,
    indexPrice: undefined,
    markPrice: undefined,
  };
}

function orderBook(timestamp: number): OrderBook {
  return {
    asks: [],
    bids: [],
    datetime: undefined,
    timestamp,
    nonce: undefined,
    symbol: "BTC/USDT",
    copy: () => orderBook(timestamp),
  };
}

describe("latency-monitor pure public helpers", () => {
  it("retains canonical identifiers and rejects a near miss", () => {
    expect(SUPPORTED_EXCHANGE_IDS).toEqual(["binance", "bybit", "kucoin", "bybiteu"]);
    expect(isSupportedExchangeId("bybiteu")).toBe(true);
    expect(isSupportedExchangeId("bybit-eu")).toBe(false);
  });

  it("keeps nearest-rank aggregation and JSON rounding behavior", () => {
    const samples: readonly LatencySample[] = [
      { exchangeId: "binance", timestamp: 1, rttMs: 3, method: "rest", success: true },
      { exchangeId: "binance", timestamp: 2, rttMs: 8, method: "rest", success: false },
      { exchangeId: "binance", timestamp: 3, gapMs: 5, previousTimestamp: 1 },
    ];

    expect(percentile([1, 3, 5, 7], 95)).toBe(7);
    expect(aggregateStats("binance", samples).rttSuccessRate).toBe(0.5);
    expect(round2(4.567)).toBe(4.57);
  });

  it("applies omitted monitor configuration defaults without opening an external connection", async () => {
    const result = await new DefaultConfigMonitor(new AdvancingTimePort()).measureExchange("binance", {
      exchangeIds: ["binance"],
      durationMs: 0,
    });

    expect(result.samples).toEqual([]);
    expect(result.stats.rttCount).toBe(0);
  });

  it("keeps zero-argument construction on the system time adapter", () => {
    expect(new DefaultConfigMonitor()).toBeInstanceOf(LatencyMonitor);
  });

  it("preserves a method-based monotonic time port receiver through the public lifecycle", async () => {
    const result = await new DefaultConfigMonitor(new ReceiverTimePort()).start({
      exchangeIds: ["binance"],
      durationMs: 100,
      rttIntervalMs: Infinity,
      wsMessageBudget: 0,
      measureReconnect: false,
    });

    expect(result.statsByExchange.binance.rttCount).toBeGreaterThan(0);
  });

  it("never passes a negative wait to the public lifecycle after its RTT deadline expires", async () => {
    const time = new LifecycleTimePort([0], [0, 1, 2, 3, 4, 11, 12, 13, 14]);

    await new DefaultConfigMonitor(time).start({
      exchangeIds: ["binance"],
      durationMs: 10,
      rttIntervalMs: 100,
      wsMessageBudget: 0,
      measureReconnect: false,
    });

    expect(time.waits).toEqual([0]);
  });

  it("keeps elapsed lifecycle measurements monotonic when UTC wall time moves backward", async () => {
    const result = await new RecoveringMonitor(new LifecycleTimePort([1000, 10])).start({
      exchangeIds: ["binance"],
      durationMs: 350,
      rttIntervalMs: Infinity,
      wsMessageBudget: 3,
      measureReconnect: true,
      forcedDisconnectAtMs: 1,
    });

    expect(result.startedAt).toBe(1000);
    expect(result.endedAt).toBe(10);
    expect(result.statsByExchange.binance.rttMinMs).toBeGreaterThanOrEqual(0);
    expect(result.statsByExchange.binance.gapMinMs).toBeGreaterThanOrEqual(0);
    expect(result.statsByExchange.binance.reconnectMinMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps elapsed lifecycle measurements monotonic when UTC wall time moves forward", async () => {
    const result = await new RecoveringMonitor(new LifecycleTimePort([10, 1000])).start({
      exchangeIds: ["binance"],
      durationMs: 350,
      rttIntervalMs: Infinity,
      wsMessageBudget: 3,
      measureReconnect: true,
      forcedDisconnectAtMs: 1,
    });

    expect(result.startedAt).toBe(10);
    expect(result.endedAt).toBe(1000);
    expect(result.statsByExchange.binance.rttMinMs).toBeGreaterThanOrEqual(0);
    expect(result.statsByExchange.binance.gapMinMs).toBeGreaterThanOrEqual(0);
    expect(result.statsByExchange.binance.reconnectMinMs).toBeGreaterThanOrEqual(0);
  });

  it("fails closed when a public lifecycle reads an invalid monotonic value", async () => {
    await expect(
      new DefaultConfigMonitor(new LifecycleTimePort([1000], [NaN])).start({
        exchangeIds: ["binance"],
        durationMs: 100,
        wsMessageBudget: 0,
        measureReconnect: false,
      }),
    ).rejects.toThrow("Érvénytelen monotón időérték.");
  });

  it("fails closed when a public lifecycle reads a negative monotonic value", async () => {
    await expect(
      new DefaultConfigMonitor(new LifecycleTimePort([1000], [-1])).start({
        exchangeIds: ["binance"],
        durationMs: 100,
        wsMessageBudget: 0,
        measureReconnect: false,
      }),
    ).rejects.toThrow("Érvénytelen monotón időérték.");
  });

  it("fails closed when a public lifecycle reads a backward monotonic value", async () => {
    await expect(
      new DefaultConfigMonitor(new LifecycleTimePort([1000], [10, 9])).start({
        exchangeIds: ["binance"],
        durationMs: 100,
        wsMessageBudget: 0,
        measureReconnect: false,
      }),
    ).rejects.toThrow("Érvénytelen monotón időérték.");
  });

  it("uses the default duration until a public abort stops the deterministic measurement", async () => {
    const monitor = new DefaultConfigMonitor(new ScriptedTimePort());
    const measurement = monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      rttIntervalMs: 1,
      wsMessageBudget: 0,
      measureReconnect: false,
    });

    await monitor.abort();
    const result = await measurement;
    expect(result.stats.rttCount).toBeGreaterThanOrEqual(1);
  });

  it("waits only for the remaining duration when the configured RTT interval is longer", async () => {
    const result = await new DefaultConfigMonitor(new AdvancingTimePort()).measureExchange("binance", {
      exchangeIds: ["binance"],
      durationMs: 100,
      rttIntervalMs: Infinity,
      wsMessageBudget: 0,
      measureReconnect: false,
    });

    expect(result.stats.rttCount).toBe(1);
  });

  it("records recoverable REST, websocket, reconnect, and cleanup failures through the public lifecycle", async () => {
    const time = new ScriptedTimePort();
    const result = await new RecoveringMonitor(time).measureExchange("binance", {
      exchangeIds: ["binance"],
      durationMs: 350,
      rttIntervalMs: Infinity,
      wsMessageBudget: 3,
      measureReconnect: true,
      forcedDisconnectAtMs: 1,
    });

    expect(result.stats.rttCount).toBeGreaterThan(1);
    expect(result.stats.rttSuccessRate).toBeLessThan(1);
    expect(result.stats.gapCount).toBe(2);
    expect(result.stats.reconnectCount).toBe(1);
  });

  it("allows abort before a measurement and starts the next measurement uncancelled", async () => {
    const monitor = new ImmediateMonitor(new ScriptedTimePort());

    await expect(monitor.abort()).resolves.toBeUndefined();
    const result = await monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      durationMs: 20,
      rttIntervalMs: 0,
      wsMessageBudget: 0,
      measureReconnect: false,
    });

    expect(result.stats.rttCount).toBeGreaterThanOrEqual(1);
  });
});
