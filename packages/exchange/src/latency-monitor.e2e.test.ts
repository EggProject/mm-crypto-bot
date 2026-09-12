/**
 * Consumer-level lifecycle coverage for latency monitoring.
 */

import { describe, expect, it } from "vitest";
import ccxt, { type Dictionary, type Exchange, type Market, type OrderBook, type Ticker } from "ccxt";

import {
  LatencyMonitor,
  SUPPORTED_EXCHANGE_IDS,
  aggregateStats,
  isSupportedExchangeId,
  median,
  percentile,
  round2,
  type LatencyMonitorConfig,
  type LatencyMonitorTimePort,
  type LatencySample,
  type SupportedExchangeId,
} from "./latency-monitor.js";

type ExchangeScenario = "recovering" | "stable";

class DeterministicTimePort {
  private monotonicTimestamp = 0;
  private utcTimestamp = 0;

  readonly utcNow = (): number => this.utcTimestamp++;

  readonly monotonicNow = (): number => this.monotonicTimestamp++;

  readonly wait = (_milliseconds: number): Promise<void> => Promise.resolve();

  constructor(initialTimestamp = 0) {
    this.utcTimestamp = initialTimestamp;
  }
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

class ScenarioExchange extends ccxt.pro.binance {
  private tickerRequests = 0;
  private orderBookRequests = 0;

  constructor(private readonly scenario: ExchangeScenario) {
    super();
  }

  override fetchTicker(): Promise<Ticker> {
    this.tickerRequests += 1;
    if (this.scenario === "recovering" && this.tickerRequests === 1)
      return Promise.reject(new Error("ticker temporarily unavailable"));
    return Promise.resolve(ticker());
  }

  override watchOrderBook(): Promise<OrderBook> {
    this.orderBookRequests += 1;
    if (this.scenario === "recovering" && this.orderBookRequests === 1) return Promise.resolve(orderBook(1));
    if (this.scenario === "recovering" && this.orderBookRequests === 3)
      return Promise.reject(new Error("order book temporarily unavailable"));
    return Promise.resolve(orderBook(this.orderBookRequests));
  }

  override loadMarkets(): Promise<Dictionary<Market>> {
    if (this.scenario === "recovering")
      return Promise.reject(new Error("reconnect market refresh unavailable"));
    return Promise.resolve({});
  }

  override close(): Promise<void> {
    if (this.scenario === "recovering") return Promise.reject(new Error("already closed"));
    return Promise.resolve();
  }
}

class ScenarioMonitor extends LatencyMonitor {
  constructor(
    private readonly exchange: ScenarioExchange,
    time?: LatencyMonitorTimePort,
  ) {
    super(time);
  }

  override createExchange(): Exchange {
    return this.exchange;
  }
}

class RejectingMonitor extends LatencyMonitor {
  override measureExchange(exchangeId: SupportedExchangeId, config: LatencyMonitorConfig) {
    return Promise.reject(
      new Error(`${exchangeId} unavailable for ${config.symbol ?? "the default symbol"}`),
    );
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

describe("LatencyMonitor consumer contract", () => {
  it("exposes only the supported identifiers and factory implementations", () => {
    expect(SUPPORTED_EXCHANGE_IDS).toEqual(["binance", "bybit", "kucoin", "bybiteu"]);
    expect(isSupportedExchangeId("bybiteu")).toBe(true);
    expect(isSupportedExchangeId("bybit-eu")).toBe(false);

    const monitor = new LatencyMonitor();
    for (const exchangeId of SUPPORTED_EXCHANGE_IDS) {
      const exchange = monitor.createExchange(exchangeId);
      expect(typeof exchange.fetchTicker).toBe("function");
      expect(typeof exchange.watchOrderBook).toBe("function");
    }
    const createExchange = monitor.createExchange.bind(monitor);
    expect(() => {
      Reflect.apply(createExchange, undefined, ["unknown"]);
    }).toThrow(/Ismeretlen exchange/);
  });

  it("preserves nearest-rank, aggregation, empty, and rounding consumer results", () => {
    const samples: readonly LatencySample[] = [
      { exchangeId: "binance", timestamp: 1, rttMs: 100, method: "rest", success: true },
      { exchangeId: "binance", timestamp: 2, rttMs: 200, method: "rest", success: false },
      { exchangeId: "binance", timestamp: 3, gapMs: 50, previousTimestamp: 1 },
      { exchangeId: "binance", timestamp: 4, gapMs: 150, previousTimestamp: 3 },
      { exchangeId: "binance", timestamp: 5, reconnectMs: 500, disconnectAt: 4 },
    ];

    expect(Number.isNaN(percentile([], 95))).toBe(true);
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([3, 1, 2], 100)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
    expect(round2(1.235)).toBe(1.24);
    expect(round2(Infinity)).toBe(Infinity);

    const stats = aggregateStats("binance", samples);
    expect(stats.rttSuccessRate).toBe(0.5);
    expect(stats.gapMedianMs).toBe(50);
    expect(stats.reconnectP95Ms).toBe(500);

    const empty = aggregateStats("binance", []);
    expect(Number.isNaN(empty.rttMinMs)).toBe(true);
    expect(Number.isNaN(empty.gapMedianMs)).toBe(true);
    expect(Number.isNaN(empty.reconnectP95Ms)).toBe(true);
  });

  it("returns canonical default configuration without opening an external connection", async () => {
    const result = await new ScenarioMonitor(
      new ScenarioExchange("stable"),
      new DeterministicTimePort(),
    ).measureExchange("binance", { exchangeIds: ["binance"], durationMs: 0 });

    expect(result.samples).toEqual([]);
    expect(result.stats.rttCount).toBe(0);
  });

  it("retains zero-argument construction with the system time adapter", () => {
    expect(new ScenarioMonitor(new ScenarioExchange("stable"))).toBeInstanceOf(LatencyMonitor);
  });

  it("preserves a method-based monotonic time port receiver through the consumer lifecycle", async () => {
    const result = await new ScenarioMonitor(new ScenarioExchange("stable"), new ReceiverTimePort()).start({
      exchangeIds: ["binance"],
      durationMs: 100,
      rttIntervalMs: Infinity,
      wsMessageBudget: 0,
      measureReconnect: false,
    });

    expect(result.statsByExchange.binance.rttCount).toBeGreaterThan(0);
  });

  it("never passes a negative wait to a consumer lifecycle after its RTT deadline expires", async () => {
    const time = new LifecycleTimePort([0], [0, 1, 2, 3, 4, 11, 12, 13, 14]);

    await new ScenarioMonitor(new ScenarioExchange("stable"), time).start({
      exchangeIds: ["binance"],
      durationMs: 10,
      rttIntervalMs: 100,
      wsMessageBudget: 0,
      measureReconnect: false,
    });

    expect(time.waits).toEqual([0]);
  });

  it("keeps consumer lifecycle elapsed measurements monotonic when UTC wall time moves backward", async () => {
    const result = await new ScenarioMonitor(
      new ScenarioExchange("recovering"),
      new LifecycleTimePort([1000, 10]),
    ).start({
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

  it("keeps consumer lifecycle elapsed measurements monotonic when UTC wall time moves forward", async () => {
    const result = await new ScenarioMonitor(
      new ScenarioExchange("recovering"),
      new LifecycleTimePort([10, 1000]),
    ).start({
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

  it("fails closed for a consumer lifecycle with an invalid monotonic value", async () => {
    await expect(
      new ScenarioMonitor(new ScenarioExchange("stable"), new LifecycleTimePort([1000], [NaN])).start({
        exchangeIds: ["binance"],
        durationMs: 100,
        wsMessageBudget: 0,
        measureReconnect: false,
      }),
    ).rejects.toThrow("Érvénytelen monotón időérték.");
  });

  it("fails closed for a consumer lifecycle with a negative monotonic value", async () => {
    await expect(
      new ScenarioMonitor(new ScenarioExchange("stable"), new LifecycleTimePort([1000], [-1])).start({
        exchangeIds: ["binance"],
        durationMs: 100,
        wsMessageBudget: 0,
        measureReconnect: false,
      }),
    ).rejects.toThrow("Érvénytelen monotón időérték.");
  });

  it("fails closed for a consumer lifecycle with a backward monotonic value", async () => {
    await expect(
      new ScenarioMonitor(new ScenarioExchange("stable"), new LifecycleTimePort([1000], [10, 9])).start({
        exchangeIds: ["binance"],
        durationMs: 100,
        wsMessageBudget: 0,
        measureReconnect: false,
      }),
    ).rejects.toThrow("Érvénytelen monotón időérték.");
  });

  it("returns all selected empty exchange results in configured order when their measurements reject", async () => {
    const result = await new RejectingMonitor(new DeterministicTimePort()).start({
      exchangeIds: SUPPORTED_EXCHANGE_IDS,
    });

    expect(Object.keys(result.statsByExchange)).toEqual(["binance", "bybit", "kucoin", "bybiteu"]);
    expect(result.samples).toEqual([]);
    expect(Number.isNaN(result.statsByExchange.bybiteu.rttP99Ms)).toBe(true);
  });

  it("uses an injected wall clock for the public start result", async () => {
    const result = await new RejectingMonitor(new DeterministicTimePort(100)).start({
      exchangeIds: ["binance"],
    });

    expect(result.startedAt).toBe(100);
    expect(result.endedAt).toBe(101);
  });

  it("collects a successful configured REST and message-gap lifecycle without external I/O", async () => {
    const result = await new ScenarioMonitor(
      new ScenarioExchange("stable"),
      new DeterministicTimePort(),
    ).start({
      exchangeIds: ["binance"],
      symbol: "ETH/USDT",
      durationMs: 100,
      rttIntervalMs: 0,
      wsMessageBudget: 3,
      measureReconnect: false,
      forcedDisconnectAtMs: 0,
    });

    expect(result.config).toEqual({
      exchangeIds: ["binance"],
      symbol: "ETH/USDT",
      durationMs: 100,
      rttIntervalMs: 0,
      wsMessageBudget: 3,
      measureReconnect: false,
      forcedDisconnectAtMs: 0,
    });
    expect(result.statsByExchange.binance.rttSuccessRate).toBe(1);
    expect(result.statsByExchange.binance.gapCount).toBe(2);
  });

  it("keeps recoverable REST, websocket, reconnect, refresh, and cleanup failures observable in lifecycle statistics", async () => {
    const result = await new ScenarioMonitor(
      new ScenarioExchange("recovering"),
      new DeterministicTimePort(),
    ).measureExchange("binance", {
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

  it("allows abort before and during a public measurement without leaving the next measurement cancelled", async () => {
    const monitor = new ScenarioMonitor(new ScenarioExchange("stable"), new DeterministicTimePort());

    await expect(monitor.abort()).resolves.toBeUndefined();
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
});
