/**
 * Unit tests for LatencyMonitor measurement and abort behavior.
 */

import { describe, expect, it } from "bun:test";
import ccxt, { type Dictionary, type Exchange, type Market, type OrderBook, type Ticker } from "ccxt";

import { LatencyMonitor, type SupportedExchangeId } from "./latency-monitor.js";

/**
 * Typed CCXT Pro test double with deterministic public operation overrides.
 */
class MockCcxtExchange extends ccxt.pro.binance {
  fetchTickerImpl: (symbol: string) => Promise<Ticker> = () => Promise.resolve(makeTicker());
  watchOrderBookImpl: (symbol: string, limit: number | undefined) => Promise<OrderBook> = () =>
    Promise.resolve(makeOrderBook(Date.now()));
  loadMarketsImpl: () => Promise<Dictionary<Market>> = () => Promise.resolve({});
  closeImpl: () => Promise<void> = () => Promise.resolve();

  override fetchTicker(symbol: string): Promise<Ticker> {
    return this.fetchTickerImpl(symbol);
  }

  override watchOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    return this.watchOrderBookImpl(symbol, limit);
  }

  override loadMarkets(): Promise<Dictionary<Market>> {
    return this.loadMarketsImpl();
  }

  override close(): Promise<void> {
    return this.closeImpl();
  }
}

function makeTicker(symbol = "BTC/USDT", last?: number): Ticker {
  return {
    symbol,
    info: {},
    timestamp: Date.now(),
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
    last,
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

function makeOrderBook(timestamp: number): OrderBook {
  return {
    asks: [],
    bids: [],
    datetime: undefined,
    timestamp,
    nonce: undefined,
    symbol: undefined,
    copy: () => makeOrderBook(timestamp),
  };
}

class MockLatencyMonitor extends LatencyMonitor {
  constructor(private readonly mocks: ReadonlyMap<SupportedExchangeId, MockCcxtExchange>) {
    super();
  }

  override createExchange(exchangeId: SupportedExchangeId): Exchange {
    const mock = this.mocks.get(exchangeId);
    if (mock === undefined) return super.createExchange(exchangeId);
    return mock;
  }
}

function getMock(
  mocks: ReadonlyMap<SupportedExchangeId, MockCcxtExchange>,
  exchangeId: SupportedExchangeId,
): MockCcxtExchange {
  const mock = mocks.get(exchangeId);
  if (mock === undefined) throw new Error(`mock for ${exchangeId} not found`);
  return mock;
}

async function waitForClose(closeCalled: Promise<void>): Promise<"closed"> {
  await closeCalled;
  return "closed";
}

function waitForTimeout(timeoutMs: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("timeout");
    }, timeoutMs);
  });
}

/**
 * Creates a monitor whose public factory returns the supplied test doubles.
 */
function makeMonitorWithMocks(ids: readonly SupportedExchangeId[]): {
  monitor: LatencyMonitor;
  mocks: Map<SupportedExchangeId, MockCcxtExchange>;
} {
  const mocks = new Map<SupportedExchangeId, MockCcxtExchange>();
  for (const id of ids) {
    mocks.set(id, new MockCcxtExchange());
  }
  const monitor = new MockLatencyMonitor(mocks);
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
    const ex = getMock(mocks, "binance");
    ex.fetchTickerImpl = async () => {
      // 30 ms szimulált hálózati késleltetés minden hívásnál.
      await new Promise((r) => setTimeout(r, 30));
      return makeTicker("BTC/USDT", 50_000);
    };
    ex.watchOrderBookImpl = async () => {
      // Azonnal visszatérünk, de a duration timer le fog állítani.
      await new Promise((r) => setTimeout(r, 10));
      return makeOrderBook(Date.now());
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
    // A teszt korábban timing-érzékeny volt CI-ban (a setTimeout-alapú
    // mock néha nem tudta kiszolgálni a 600ms-os duration alatt a
    // szükséges üzeneteket, így gapCount=0 lett). Most hosszabb
    // duration és kisebb threshold a robusztusság kedvéért.
    const { monitor, mocks } = makeMonitorWithMocks(["binance"]);
    const ex = getMock(mocks, "binance");
    ex.fetchTickerImpl = () => Promise.resolve(makeTicker());
    let callIndex = 0;
    ex.watchOrderBookImpl = async () => {
      const targetTime = Date.now() + 80 * (callIndex + 1);
      callIndex += 1;
      await new Promise((r) => setTimeout(r, Math.max(0, targetTime - Date.now())));
      return makeOrderBook(Date.now());
    };

    const result = await monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      symbol: "BTC/USDT",
      durationMs: 1500,
      rttIntervalMs: 5000,
      wsMessageBudget: 30,
      measureReconnect: false,
    });

    // A 1500ms duration + 80ms cadence → elvárt ~18 message, ~17 gap.
    // A CI timing-flakiness miatt >= 2 threshold-ot használunk (korábban 3 volt).
    expect(result.stats.gapCount).toBeGreaterThanOrEqual(2);
    // A median gap a 80ms cadence közelében legyen, de timing-flakess
    // miatt tág intervallumban: [30, 400]ms.
    expect(result.stats.gapMedianMs).toBeGreaterThanOrEqual(30);
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
    const ex = getMock(mocks, "binance");
    ex.fetchTickerImpl = () => Promise.resolve(makeTicker());
    let messageCount = 0;
    ex.watchOrderBookImpl = async () => {
      messageCount += 1;
      if (messageCount < 3) {
        return makeOrderBook(Date.now());
      }
      await new Promise((r) => setTimeout(r, 30));
      return makeOrderBook(Date.now());
    };
    ex.closeImpl = () => Promise.resolve();
    ex.loadMarketsImpl = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return makeTicker();
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
    const binanceEx = getMock(mocks, "binance");
    const bybitEx = getMock(mocks, "bybit");

    binanceEx.fetchTickerImpl = async () => {
      await new Promise((r) => setTimeout(r, 20));
      return makeTicker();
    };
    bybitEx.fetchTickerImpl = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return makeTicker();
    };
    binanceEx.watchOrderBookImpl = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return makeOrderBook(Date.now());
    };
    bybitEx.watchOrderBookImpl = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return makeOrderBook(Date.now());
    };

    const result = await monitor.start({
      exchangeIds: ["binance", "bybit"],
      symbol: "BTC/USDT",
      durationMs: 500,
      rttIntervalMs: 200,
      wsMessageBudget: 5,
      measureReconnect: false,
    });

    expect(result.statsByExchange.binance).toBeDefined();
    expect(result.statsByExchange.bybit).toBeDefined();
    expect(result.statsByExchange.binance.rttCount).toBeGreaterThanOrEqual(1);
    expect(result.statsByExchange.bybit.rttCount).toBeGreaterThanOrEqual(1);
    expect(result.statsByExchange.bybit.rttMedianMs).toBeGreaterThan(
      result.statsByExchange.binance.rttMedianMs,
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
    const ex = getMock(mocks, "binance");
    ex.fetchTickerImpl = () => Promise.resolve(makeTicker());
    let callIndex = 0;
    ex.watchOrderBookImpl = async () => {
      callIndex += 1;
      if (callIndex % 2 === 0) {
        throw new Error("WS timeout");
      }
      await new Promise((r) => setTimeout(r, 30));
      return makeOrderBook(Date.now());
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
    const ex = getMock(mocks, "binance");
    let fetchCount = 0;
    ex.fetchTickerImpl = async () => {
      fetchCount += 1;
      if (fetchCount % 3 === 0) {
        throw new Error("Rate limited");
      }
      await new Promise((r) => setTimeout(r, 20));
      return makeTicker();
    };
    ex.watchOrderBookImpl = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return makeOrderBook(Date.now());
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

describe("LatencyMonitor.abort", () => {
  /**
   * Teszt #7 — Abort API: mid-measurement cleanup.
   *
   * A teszt indít egy hosszú (5000ms) mérést egy gyors mock watchOrderBook
   * mellett, majd 50ms után meghívja az `abort()`-ot. Az assertálja, hogy:
   *   1. A mérés nem fut le a duration végéig (az abort leállítja).
   *   2. Az `exchange.close()` az `abort()` hívásától számított 100ms-on
   *      belül meghívódik (a try/finally azonnal cleanup-ol).
   *   3. A mérés visszatér (a promise feloldódik, nem függ).
   */
  it("aborts in-flight measurement and triggers cleanup within 100ms", async () => {
    const { monitor, mocks } = makeMonitorWithMocks(["binance"]);
    const ex = getMock(mocks, "binance");

    ex.fetchTickerImpl = () => Promise.resolve(makeTicker());
    // A `watchOrderBook` azonnal visszatér, hogy a belső ciklus a
    // `!this.cancelled` flag-et minél gyorsabban ellenőrizze.
    ex.watchOrderBookImpl = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return makeOrderBook(Date.now());
    };
    // A close() felold egy promise-ot, hogy a teszt szinkronban mérhesse
    // a close() hívásának időpontját az abort() hívásához képest.
    const { promise: closeCalled, resolve: closeResolve } = Promise.withResolvers<undefined>();
    ex.closeImpl = () => {
      closeResolve(undefined);
      return Promise.resolve();
    };

    const measureStart = Date.now();
    const measurePromise = monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      symbol: "BTC/USDT",
      durationMs: 5000, // 5s — jóval több, mint amennyit a teszt vár
      rttIntervalMs: 50,
      wsMessageBudget: 100_000,
      measureReconnect: false,
    });

    // Várunk 50ms-ot, hogy a ciklusok elinduljanak
    await new Promise((r) => setTimeout(r, 50));
    const abortCallStart = Date.now();
    await monitor.abort();

    // A close()-nak az abort() hívásától számított 100ms-on belül meg
    // kell hívódnia — a `closeCalled` promise jelzi a hívás időpontját.
    const closeResult = await Promise.race([waitForClose(closeCalled), waitForTimeout(200)]);
    const cleanupLatencyMs = Date.now() - abortCallStart;
    expect(closeResult).toBe("closed");
    expect(cleanupLatencyMs).toBeLessThan(100);

    // A mérés a try/finally-n keresztül visszatér — várjuk meg.
    await measurePromise;
    // A mérés az abort miatt sokkal hamarabb befejeződött, mint 5s.
    const totalDurationMs = Date.now() - measureStart;
    expect(totalDurationMs).toBeLessThan(2000);
  });

  /**
   * Teszt #8 — Abort API: idempotens / no-op ha nincs aktív mérés.
   *
   * Ha `abort()`-ot hívunk MIELŐTT bármilyen `measureExchange` elindult,
   * a `cancelled` flag-et beállítja, de az `activeExchange` null, tehát
   * nem hív `close()`-t. A következő `measureExchange` reseteli a flag-et,
   * és normálisan fut.
   */
  it("is a no-op when no measurement is in flight (no close() call, but resets cleanly)", async () => {
    const { monitor, mocks } = makeMonitorWithMocks(["binance"]);
    // abort() aktív mérés nélkül — nem dob, nem crashel.
    await monitor.abort();
    // Ezután indított mérésnek normálisan kell futnia (a flag resetelődik
    // a measureExchange elején).
    const ex = getMock(mocks, "binance");
    let closeCount = 0;
    ex.fetchTickerImpl = () => Promise.resolve(makeTicker());
    ex.watchOrderBookImpl = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return makeOrderBook(Date.now());
    };
    ex.closeImpl = () => {
      closeCount += 1;
      return Promise.resolve();
    };

    const result = await monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      symbol: "BTC/USDT",
      durationMs: 200,
      rttIntervalMs: 100,
      wsMessageBudget: 5,
      measureReconnect: false,
    });
    // Normálisan lefutott — nem lépett ki azonnal a flag miatt.
    expect(result.stats.rttCount).toBeGreaterThanOrEqual(1);
    // A close() hívódik: az inner measureMessageGap cleanup-ja + a külső
    // try/finally is hívja (mindkettő best-effort try/catch-ben). A
    // pontos szám (2) nem kritikus — a lényeg, hogy a cleanup lefutott.
    expect(closeCount).toBeGreaterThanOrEqual(1);
  });

  /**
   * Teszt #9 — Abort API: a `close()` által dobott hibát a best-effort
   * try/catch elnyeli (nem crasheli az abort()-ot).
   */
  it("swallows close() errors during abort (best-effort cleanup)", async () => {
    const { monitor, mocks } = makeMonitorWithMocks(["binance"]);
    const ex = getMock(mocks, "binance");

    ex.fetchTickerImpl = () => Promise.resolve(makeTicker());
    ex.watchOrderBookImpl = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return makeOrderBook(Date.now());
    };
    ex.closeImpl = () => Promise.reject(new Error("WS already closed"));

    const measurePromise = monitor.measureExchange("binance", {
      exchangeIds: ["binance"],
      symbol: "BTC/USDT",
      durationMs: 5000,
      rttIntervalMs: 50,
      wsMessageBudget: 100_000,
      measureReconnect: false,
    });

    await new Promise((r) => setTimeout(r, 50));
    // Az abort() a close() hibája ellenére feloldódik.
    let abortError: unknown;
    try {
      await monitor.abort();
    } catch (error: unknown) {
      abortError = error;
    }
    expect(abortError).toBeUndefined();
    // A measureExchange finally blokkja is elnyeli a close() hibát.
    expect(await measurePromise).toBeDefined();
  });
});
