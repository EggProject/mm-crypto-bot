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
} from "./latency-monitor.js";

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

  override async watchOrderBook(): Promise<OrderBook> {
    this.orderBookRequests += 1;
    if (this.orderBookRequests === 1) {
      await wait(5);
      return orderBook(1);
    }
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
  readonly exchange = new RecoveringExchange();

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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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
    const result = await new DefaultConfigMonitor().measureExchange("binance", {
      exchangeIds: ["binance"],
      durationMs: 0,
    });

    expect(result.samples).toEqual([]);
    expect(result.stats.rttCount).toBe(0);
  });

  it("uses the default duration until a public abort stops the deterministic measurement", async () => {
    const monitor = new DefaultConfigMonitor();
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
    const result = await new DefaultConfigMonitor().measureExchange("binance", {
      exchangeIds: ["binance"],
      durationMs: 100,
      rttIntervalMs: Infinity,
      wsMessageBudget: 0,
      measureReconnect: false,
    });

    expect(result.stats.rttCount).toBe(1);
  });

  it("records recoverable REST, websocket, reconnect, and cleanup failures through the public lifecycle", async () => {
    const result = await new RecoveringMonitor().measureExchange("binance", {
      exchangeIds: ["binance"],
      durationMs: 350,
      rttIntervalMs: Infinity,
      wsMessageBudget: 3,
      measureReconnect: true,
      forcedDisconnectAtMs: 1,
    });

    expect(result.stats.rttCount).toBe(1);
    expect(result.stats.rttSuccessRate).toBe(0);
    expect(result.stats.gapCount).toBe(2);
    expect(result.stats.reconnectCount).toBe(1);
  });

  it("allows abort before a measurement and starts the next measurement uncancelled", async () => {
    const monitor = new ImmediateMonitor();

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
