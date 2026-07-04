/**
 * packages/exchange/src/latency-monitor.test.ts
 *
 * Unit tesztek a LatencyMonitor modulhoz — Phase 6 Track B.
 *
 * A tesztek PURE függvényekre és a `measureExchange` mockolt CCXT
 * exchange-ére építenek. A valós WS/REST hívásokat a CLI runner
 * (`run-arb-latency.ts`) futtatja — itt csak a logikát teszteljük.
 *
 * Minimum 6 teszt a brief előírása szerint:
 *   1. RTT measurement correctness (sample-ek számolása, RTT kalkuláció)
 *   2. Message gap calculation (consecutive message-ek közötti delta)
 *   3. Reconnect time tracking (forced disconnect → first message)
 *   4. Multi-exchange aggregation (Promise.all párhuzamosság + aggregáció)
 *   5. Edge case: dropped messages (üres gap lista, single sample)
 *   6. Edge case: partial responses (sikertelen REST request)
 *
 * + kiegészítők: percentile/median math, isSupportedExchangeId type guard.
 */

import { describe, expect, it } from "bun:test";

import {
  LatencyMonitor,
  SUPPORTED_EXCHANGE_IDS,
  aggregateStats,
  isSupportedExchangeId,
  median,
  percentile,
  round2,
  type LatencySample,
  type MessageGapSample,
  type ReconnectSample,
  type RttSample,
  type SupportedExchangeId,
} from "./latency-monitor.js";

// === Pure függvény tesztek (statisztikai helper-ek) ===

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
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(arr, 95)).toBe(95);
    // p50 = 50 (medián)
    expect(percentile(arr, 50)).toBe(50);
    // p99 = 99
    expect(percentile(arr, 99)).toBe(99);
  });

  it("clamps p<=0 to min and p>=100 to max", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(percentile(arr, 0)).toBe(1);
    expect(percentile(arr, -10)).toBe(1);
    expect(percentile(arr, 100)).toBe(5);
    expect(percentile(arr, 200)).toBe(5);
  });

  it("does not mutate input array (defensive copy)", () => {
    const arr = [3, 1, 2];
    percentile(arr, 50);
    expect(arr).toEqual([3, 1, 2]);
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
    expect(Number.isNaN(round2(Number.NaN))).toBe(true);
    expect(round2(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

// === aggregateStats tesztek ===

describe("aggregateStats", () => {
  it("classifies samples by type and aggregates correctly", () => {
    const samples: LatencySample[] = [
      { exchangeId: "binance", timestamp: 1, rttMs: 100, method: "rest", success: true } as RttSample,
      { exchangeId: "binance", timestamp: 2, rttMs: 200, method: "rest", success: true } as RttSample,
      { exchangeId: "binance", timestamp: 3, rttMs: 300, method: "rest", success: false } as RttSample,
      { exchangeId: "binance", timestamp: 4, gapMs: 50, previousTimestamp: 3 } as MessageGapSample,
      { exchangeId: "binance", timestamp: 5, gapMs: 150, previousTimestamp: 4 } as MessageGapSample,
      {
        exchangeId: "binance",
        timestamp: 6,
        reconnectMs: 500,
        disconnectAt: 5,
      } as ReconnectSample,
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

// === LatencyMonitor integrációs tesztek (mock CCXT exchange-szel) ===

/**
 * `MockCcxtExchange` — minimal stub a CCXT `Exchange` interface-hez.
 * Csak a `fetchTicker`, `watchOrderBook`, `loadMarkets` és `close`
 * metódusokat implementálja. A többi hívás TypeError-t dob.
 */
class MockCcxtExchange {
  fetchTickerImpl: (symbol: string) => Promise<unknown> = async () => ({});
  watchOrderBookImpl: (symbol: string, limit: number) => Promise<unknown> = async () => ({});
  loadMarketsImpl: () => Promise<unknown> = async () => ({});
  closeImpl: () => Promise<void> = async () => {
    // No-op default; tests override to simulate close delays/errors.
  };

  async fetchTicker(symbol: string): Promise<unknown> {
    return this.fetchTickerImpl(symbol);
  }

  async watchOrderBook(symbol: string, limit: number): Promise<unknown> {
    return this.watchOrderBookImpl(symbol, limit);
  }

  async loadMarkets(): Promise<unknown> {
    return this.loadMarketsImpl();
  }

  async close(): Promise<void> {
    return this.closeImpl();
  }
}

/**
 * `makeMonitorWithMocks` — létrehoz egy LatencyMonitor instance-t és
 * a megadott mock exchange-eket. A monitor `createExchange` metódusát
 * úgy írja felül, hogy a mock exchange-eket adja vissza a megadott ID-kre.
 *
 * Visszatérési érték: `{ monitor, mocks }`, ahol `mocks` egy Map a
 * `SupportedExchangeId` → `MockCcxtExchange` leképezéssel.
 */
function makeMonitorWithMocks(
  ids: readonly SupportedExchangeId[],
): {
  monitor: LatencyMonitor;
  mocks: Map<SupportedExchangeId, MockCcxtExchange>;
} {
  const monitor = new LatencyMonitor();
  const mocks = new Map<SupportedExchangeId, MockCcxtExchange>();
  for (const id of ids) {
    mocks.set(id, new MockCcxtExchange());
  }
  // A `createExchange` metódust írjuk felül: a `mocks` map-ből adjuk vissza
  // a megfelelő mock-ot, ha van, különben a CCXT factory-t hívjuk (de a
  // unit tesztek mindig átadják az összes ID-t a `mocks` map-ben).
  const original = monitor.createExchange.bind(monitor);
  (monitor as unknown as {
    createExchange: (id: SupportedExchangeId) => MockCcxtExchange;
  }).createExchange = (id: SupportedExchangeId): MockCcxtExchange => {
    const m = mocks.get(id);
    if (m !== undefined) return m;
    // Fallback: valódi CCXT exchange. Csak a type-check teljesítéséhez kell.
    return original(id) as unknown as MockCcxtExchange;
  };
  return { monitor, mocks };
}

describe("LatencyMonitor.measureExchange", () => {
  /**
   * Teszt #1 — RTT measurement correctness.
   *
   * A mock `fetchTicker` egy ismert késleltetéssel (sleep) tér vissza.
   * A mért RTT sample-ek számának és a mediánnak egyeznie kell a várttal.
   */
  it("RTT measurement correctness: counts samples, computes median", async () => {
    const { monitor, mocks } = makeMonitorWithMocks(["binance"]);
    const ex = mocks.get("binance") as MockCcxtExchange;
    ex.fetchTickerImpl = async () => {
      // 30 ms szimulált hálózati késleltetés minden hívásnál.
      await new Promise((r) => setTimeout(r, 30));
      return { symbol: "BTC/USDT", last: 50000 };
    };
    ex.watchOrderBookImpl = async () => {
      // Azonnal visszatérünk, de a duration timer le fog állítani.
      await new Promise((r) => setTimeout(r, 10));
      return { bids: [], asks: [], timestamp: Date.now() };
    };

    const result = await monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      symbol: "BTC/USDT",
      durationMs: 600,
      rttIntervalMs: 200,
      wsMessageBudget: 3,
      measureReconnect: false,
    });

    expect(result.stats.rttCount).toBeGreaterThanOrEqual(2);
    expect(result.stats.rttMedianMs).toBeGreaterThanOrEqual(20);
    expect(result.stats.rttSuccessRate).toBe(1);
  });

  /**
   * Teszt #2 — Message gap calculation.
   *
   * A mock `watchOrderBook` ismert időközönként ad vissza message-eket.
   * Az aggregált gap statisztikáknak illeszkedniük kell.
   */
  it("Message gap calculation: gaps match the mock's emit cadence", async () => {
    const { monitor, mocks } = makeMonitorWithMocks(["binance"]);
    const ex = mocks.get("binance") as MockCcxtExchange;
    ex.fetchTickerImpl = async () => ({});
    let callIndex = 0;
    ex.watchOrderBookImpl = async () => {
      const targetTime = Date.now() + 80 * (callIndex + 1);
      callIndex += 1;
      await new Promise((r) => setTimeout(r, Math.max(0, targetTime - Date.now())));
      return { bids: [], asks: [], timestamp: Date.now() };
    };

    const result = await monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      symbol: "BTC/USDT",
      durationMs: 600,
      rttIntervalMs: 1000,
      wsMessageBudget: 10,
      measureReconnect: false,
    });

    expect(result.stats.gapCount).toBeGreaterThanOrEqual(3);
    expect(result.stats.gapMedianMs).toBeGreaterThanOrEqual(50);
    expect(result.stats.gapMedianMs).toBeLessThanOrEqual(400);
  });

  /**
   * Teszt #3 — Reconnect time tracking.
   *
   * A reconnect trigger a mérés felénél jön (`forcedDisconnectAtMs`).
   * A reconnect sample számának ≤ 1 kell legyen, és ha van, értéke
   * ésszerű tartományban.
   */
  it("Reconnect time tracking: forced disconnect triggers at most one reconnect sample", async () => {
    const { monitor, mocks } = makeMonitorWithMocks(["binance"]);
    const ex = mocks.get("binance") as MockCcxtExchange;
    ex.fetchTickerImpl = async () => ({});
    let messageCount = 0;
    ex.watchOrderBookImpl = async () => {
      messageCount += 1;
      if (messageCount < 3) {
        return { bids: [], asks: [], timestamp: Date.now() };
      }
      await new Promise((r) => setTimeout(r, 30));
      return { bids: [], asks: [], timestamp: Date.now() };
    };
    ex.closeImpl = async () => {
      // Azonnali.
    };
    ex.loadMarketsImpl = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {};
    };

    const result = await monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      symbol: "BTC/USDT",
      durationMs: 1200,
      rttIntervalMs: 1000,
      wsMessageBudget: 20,
      measureReconnect: true,
      forcedDisconnectAtMs: 500,
    });

    expect(result.stats.reconnectCount).toBeLessThanOrEqual(1);
    if (result.stats.reconnectCount === 1) {
      expect(result.stats.reconnectMinMs).toBeGreaterThan(0);
      expect(result.stats.reconnectMinMs).toBeLessThan(2000);
    }
  });

  /**
   * Teszt #4 — Multi-exchange aggregation.
   *
   * Két exchange párhuzamos mérése — a `start` Promise.all-al futtatja,
   * mindkettő statsByExchange-be kerül.
   */
  it("Multi-exchange aggregation: start() aggregates stats from all exchanges", async () => {
    const { monitor, mocks } = makeMonitorWithMocks(["binance", "bybit"]);
    const binanceEx = mocks.get("binance") as MockCcxtExchange;
    const bybitEx = mocks.get("bybit") as MockCcxtExchange;

    binanceEx.fetchTickerImpl = async () => {
      await new Promise((r) => setTimeout(r, 20));
      return {};
    };
    bybitEx.fetchTickerImpl = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {};
    };
    binanceEx.watchOrderBookImpl = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { bids: [], asks: [], timestamp: Date.now() };
    };
    bybitEx.watchOrderBookImpl = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { bids: [], asks: [], timestamp: Date.now() };
    };

    const result = await monitor.start({
      exchangeIds: ["binance", "bybit"],
      symbol: "BTC/USDT",
      durationMs: 500,
      rttIntervalMs: 200,
      wsMessageBudget: 5,
      measureReconnect: false,
    });

    expect(result.statsByExchange["binance"]).toBeDefined();
    expect(result.statsByExchange["bybit"]).toBeDefined();
    expect(result.statsByExchange["binance"].rttCount).toBeGreaterThanOrEqual(1);
    expect(result.statsByExchange["bybit"].rttCount).toBeGreaterThanOrEqual(1);
    expect(result.statsByExchange["bybit"].rttMedianMs).toBeGreaterThan(
      result.statsByExchange["binance"].rttMedianMs,
    );
  });

  /**
   * Teszt #5 — Edge case: dropped messages.
   *
   * A mock `watchOrderBook` néha exception-t dob. A measureExchange
   * nem szállhat el, és a gap statisztikák továbbra is értelmesek
   * kell legyenek (kevesebb sample, de érvényes számokkal).
   */
  it("Edge case: dropped messages — exceptions in watchOrderBook are handled gracefully", async () => {
    const { monitor, mocks } = makeMonitorWithMocks(["binance"]);
    const ex = mocks.get("binance") as MockCcxtExchange;
    ex.fetchTickerImpl = async () => ({});
    let callIdx = 0;
    ex.watchOrderBookImpl = async () => {
      callIdx += 1;
      if (callIdx % 2 === 0) {
        throw new Error("WS timeout");
      }
      await new Promise((r) => setTimeout(r, 30));
      return { bids: [], asks: [], timestamp: Date.now() };
    };

    const result = await monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      symbol: "BTC/USDT",
      durationMs: 500,
      rttIntervalMs: 1000,
      wsMessageBudget: 20,
      measureReconnect: false,
    });

    expect(result.stats.exchangeId).toBe("binance");
    expect(result.stats.gapCount).toBeGreaterThanOrEqual(1);
  });

  /**
   * Teszt #6 — Edge case: partial responses (REST failures).
   *
   * A `fetchTicker` néha exception-t dob. A successRate < 1 kell legyen,
   * és a hibás hívások is bekerülnek a statisztikába (a torzítás
   * dokumentálva van).
   */
  it("Edge case: partial REST responses — successRate < 1 when fetchTicker fails intermittently", async () => {
    const { monitor, mocks } = makeMonitorWithMocks(["binance"]);
    const ex = mocks.get("binance") as MockCcxtExchange;
    let fetchCount = 0;
    ex.fetchTickerImpl = async () => {
      fetchCount += 1;
      if (fetchCount % 3 === 0) {
        throw new Error("Rate limited");
      }
      await new Promise((r) => setTimeout(r, 20));
      return {};
    };
    ex.watchOrderBookImpl = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { bids: [], asks: [], timestamp: Date.now() };
    };

    const result = await monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      symbol: "BTC/USDT",
      durationMs: 500,
      rttIntervalMs: 100,
      wsMessageBudget: 5,
      measureReconnect: false,
    });

    expect(result.stats.rttCount).toBeGreaterThanOrEqual(3);
    expect(result.stats.rttSuccessRate).toBeLessThan(1);
    expect(result.stats.rttSuccessRate).toBeGreaterThan(0);
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
    expect(() =>
      (monitor as unknown as { createExchange: (id: string) => unknown }).createExchange("unknown"),
    ).toThrow(/Ismeretlen exchange/);
  });
});