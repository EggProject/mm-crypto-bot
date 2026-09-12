/**
 * Public API and pure-helper tests for LatencyMonitor.
 */

import { describe, expect, it } from "vitest";

import {
  LatencyMonitor,
  SUPPORTED_EXCHANGE_IDS,
  aggregateStats,
  isSupportedExchangeId,
  median,
  percentile,
  round2,
  type LatencyMonitorConfig,
  type LatencySample,
  type SupportedExchangeId,
} from "./latency-monitor.js";

// === Pure-function tests (statistical helpers) ===

describe("percentile", () => {
  it("returns NaN on empty input", () => {
    expect(Number.isNaN(percentile([], 95))).toBe(true);
  });

  it("returns the only value for single-element input", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 5)).toBe(42);
  });

  it("uses nearest-rank for p95 over a 100-sample distribution", () => {
    // 1..100 → p95 = 95 (nearest-rank)
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(values, 95)).toBe(95);
    // p50 = 50 (median)
    expect(percentile(values, 50)).toBe(50);
    // p99 = 99
    expect(percentile(values, 99)).toBe(99);
  });

  it("clamps p<=0 to min and p>=100 to max", () => {
    const values = [1, 2, 3, 4, 5];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, -10)).toBe(1);
    expect(percentile(values, 100)).toBe(5);
    expect(percentile(values, 200)).toBe(5);
  });

  it("does not mutate input array (defensive copy)", () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("median", () => {
  it("returns p50 of the distribution", () => {
    expect(median([10, 20, 30, 40, 50])).toBe(30);
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe("isSupportedExchangeId", () => {
  it("accepts all canonical IDs", () => {
    for (const id of SUPPORTED_EXCHANGE_IDS) {
      expect(isSupportedExchangeId(id)).toBe(true);
    }
  });

  it("rejects unknown IDs", () => {
    expect(isSupportedExchangeId("coinbase")).toBe(false);
    expect(isSupportedExchangeId("")).toBe(false);
    expect(isSupportedExchangeId("Binance")).toBe(false);
  });
});

describe("round2", () => {
  it("rounds to 2 decimals", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
    expect(round2(0)).toBe(0);
  });

  it("preserves NaN and Infinity", () => {
    expect(Number.isNaN(round2(NaN))).toBe(true);
    expect(round2(Infinity)).toBe(Infinity);
  });
});

// === aggregateStats tests ===

describe("aggregateStats", () => {
  it("classifies samples by type and aggregates correctly", () => {
    const samples: LatencySample[] = [
      { exchangeId: "binance", timestamp: 1, rttMs: 100, method: "rest", success: true },
      { exchangeId: "binance", timestamp: 2, rttMs: 200, method: "rest", success: true },
      { exchangeId: "binance", timestamp: 3, rttMs: 300, method: "rest", success: false },
      { exchangeId: "binance", timestamp: 4, gapMs: 50, previousTimestamp: 3 },
      { exchangeId: "binance", timestamp: 5, gapMs: 150, previousTimestamp: 4 },
      {
        exchangeId: "binance",
        timestamp: 6,
        reconnectMs: 500,
        disconnectAt: 5,
      },
    ];

    const stats = aggregateStats("binance", samples);
    expect(stats.rttCount).toBe(3);
    expect(stats.rttMinMs).toBe(100);
    expect(stats.rttMaxMs).toBe(300);
    expect(stats.rttMedianMs).toBe(200);
    expect(stats.rttSuccessRate).toBeCloseTo(2 / 3, 5);

    expect(stats.gapCount).toBe(2);
    expect(stats.gapMinMs).toBe(50);
    expect(stats.gapMaxMs).toBe(150);
    expect(stats.gapMedianMs).toBe(50);

    expect(stats.reconnectCount).toBe(1);
    expect(stats.reconnectMaxMs).toBe(500);
    expect(stats.reconnectMinMs).toBe(500);
  });

  it("returns NaN for empty sample sets", () => {
    const stats = aggregateStats("binance", []);
    expect(stats.rttCount).toBe(0);
    expect(Number.isNaN(stats.rttMinMs)).toBe(true);
    expect(Number.isNaN(stats.rttMedianMs)).toBe(true);
    expect(Number.isNaN(stats.rttP95Ms)).toBe(true);
    expect(Number.isNaN(stats.rttSuccessRate)).toBe(true);
  });
});

describe("LatencyMonitor.createExchange", () => {
  it("returns a CCXT Exchange instance for valid IDs", () => {
    const monitor = new LatencyMonitor();
    for (const id of SUPPORTED_EXCHANGE_IDS) {
      const ex = monitor.createExchange(id);
      expect(ex).toBeDefined();
      expect(typeof ex.fetchTicker).toBe("function");
      expect(typeof ex.watchOrderBook).toBe("function");
    }
  });

  it("throws on unknown IDs", () => {
    const monitor = new LatencyMonitor();
    const createExchange = monitor.createExchange.bind(monitor);
    expect(() => {
      Reflect.apply(createExchange, undefined, ["unknown"]);
    }).toThrow(/Ismeretlen exchange/);
  });
});

class RejectingBybitMonitor extends LatencyMonitor {
  override async measureExchange(exchangeId: SupportedExchangeId, config: LatencyMonitorConfig) {
    if (exchangeId === "bybit") {
      throw new Error("bybit measurement rejected");
    }

    return super.measureExchange(exchangeId, config);
  }
}

class RejectingEveryExchangeMonitor extends LatencyMonitor {
  override measureExchange(exchangeId: SupportedExchangeId, config: LatencyMonitorConfig) {
    return Promise.reject(
      new Error(`${exchangeId} measurement rejected for ${config.symbol ?? "the default symbol"}`),
    );
  }
}

describe("LatencyMonitor.start", () => {
  it("preserves only selected exchange keys in configured order when every measurement rejects", async () => {
    const result = await new RejectingEveryExchangeMonitor().start({
      exchangeIds: ["binance", "bybit", "kucoin", "bybiteu"],
    });

    expect(Object.keys(result.statsByExchange)).toEqual(["binance", "bybit", "kucoin", "bybiteu"]);
    expect(result.statsByExchange.kucoin.rttCount).toBe(0);
    expect(result.statsByExchange.bybiteu.gapCount).toBe(0);
  });

  it("returns empty NaN stats when a public exchange measurement rejects", async () => {
    const monitor = new RejectingBybitMonitor();

    const result = await monitor.start({ exchangeIds: ["bybit"] });
    const stats = result.statsByExchange.bybit;

    expect(result.samples).toEqual([]);
    expect(stats.rttCount).toBe(0);
    expect(stats.gapCount).toBe(0);
    expect(stats.reconnectCount).toBe(0);

    for (const metric of [
      stats.rttMinMs,
      stats.rttMaxMs,
      stats.rttMedianMs,
      stats.rttP95Ms,
      stats.rttP99Ms,
      stats.rttSuccessRate,
      stats.gapMinMs,
      stats.gapMaxMs,
      stats.gapMedianMs,
      stats.gapP95Ms,
      stats.gapP99Ms,
      stats.reconnectMinMs,
      stats.reconnectMaxMs,
      stats.reconnectMedianMs,
      stats.reconnectP95Ms,
    ]) {
      expect(Number.isNaN(metric)).toBe(true);
    }
  });
});
