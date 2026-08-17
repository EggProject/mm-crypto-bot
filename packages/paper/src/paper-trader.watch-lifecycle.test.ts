import { describe, expect, it } from "vitest";
import { PaperTrader } from "./paper-trader.js";
import { defaultMockTicker } from "./test-helpers.js";
import {
  DEFAULT_FEE,
  makeFeed,
  makeFeedWithoutWatchTicker,
  makeTickerWithoutTimestamp,
} from "./paper-trader.test-support.js";
import type { MockExchangeFeed } from "./test-helpers.js";
import type { Ticker } from "ccxt";

/**
 * `makeQueuedTickerFeed` — queue-alapú watchTicker mock.
 * Minden hívás egy új Promise-t ad vissza, és a resolve-ját a `queue` tömb végéhez fűzi.
 * A teszt a `queue.shift()`-tel tudja resolve-olni az éppen futó tickert.
 * A `feedAfterStop` a stop() utáni hívásokra adott válasz (hogy ne akadjon el).
 */
interface QueuedTickerFeed {
  readonly feed: MockExchangeFeed;
  readonly queue: ((t: Ticker) => void)[];
  readonly stopGate: { stopped: boolean };
}
function makeQueuedTickerFeed(): QueuedTickerFeed {
  const queue: ((t: Ticker) => void)[] = [];
  const stopGate = { stopped: false };
  const feed = makeFeed({
    watchTickerImpl: () =>
      new Promise<Ticker>((resolve) => {
        if (stopGate.stopped) {
          // Stop után a watchTicker soha ne oldjon fel — a teszt leáll.
          // De mivel a while-ciklus kilép, ez a Promise GC-vel takarítódik.
          return;
        }
        queue.push(resolve);
      }),
  });
  return { feed, queue, stopGate };
}

/**
 * `drainQueue` — a queue-ból kiszedi a következő resolvert és resolve-olja a tickerrel.
 */
function drainQueue(q: QueuedTickerFeed, ticker: Ticker): void {
  const resolve = q.queue.shift();
  if (resolve !== undefined) resolve(ticker);
}

/**
 * `awaitMicrotasks` — microtask-queue kiürítése (Promise.resolve().then(())-szel).
 */
function awaitMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function captureExpectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error("Expected PaperTrader to reject with an Error", { cause: error });
  }
  throw new Error("Expected PaperTrader to reject");
}

class WarningCallRecorder {
  private readonly originalWarn = console.warn;
  readonly calls: Parameters<typeof console.warn>[] = [];

  install(): void {
    console.warn = (...arguments_: Parameters<typeof console.warn>): void => {
      this.calls.push(arguments_);
    };
  }

  restore(): void {
    console.warn = this.originalWarn;
  }

  contains(message: string): boolean {
    return this.calls.some(
      ([firstArgument]) => typeof firstArgument === "string" && firstArgument.includes(message),
    );
  }
}

describe("PaperTrader.start / stop — watchTicker ciklus", () => {
  it("a start() dob hibát, ha a feed nem támogatja a watchTicker-t", async () => {
    const feed = makeFeedWithoutWatchTicker();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const error = await captureExpectedError(pt.start({ symbols: ["BTC/USDT"] }));
    expect(error.message).toMatch(/A feed nem tamogatja a watchTicker-t/);
  });

  it("a start() elindul, és a stop() leállítja a watchTicker ciklust", async () => {
    const q = makeQueuedTickerFeed();
    const pt = new PaperTrader(q.feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const startPromise = pt.start({ symbols: ["BTC/USDT"] });
    // Várunk, hogy a watchTicker hívódjon és a queue feltöltődjön.
    await awaitMicrotasks();
    expect(q.queue.length).toBe(1);
    // Leállítjuk a botot, majd resolve-oljuk a függő tickert.
    pt.stop();
    q.stopGate.stopped = true;
    drainQueue(q, defaultMockTicker("BTC/USDT"));
    // A while-ciklus ellenőrzi a running flag-et, és kilép.
    await startPromise;
  });

  it("a watchTicker ciklusban a Network hibát elnyeli és folytatja", async () => {
    // A watchTicker Network hibát dob — a ciklus elkapja és `continue`-val továbblép.
    // A rejection-t 1ms-os késleltetéssel dobjuk, hogy a setTimeout(5)-nek legyen esélye
    // futni a tight CPU-loop közben.
    const feed = makeFeed({
      watchTickerImpl: () =>
        new Promise<Ticker>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Network connection lost"));
          }, 1);
        }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const startPromise = pt.start({ symbols: ["BTC/USDT"] });
    // Várunk, hogy a watchTicker fusson és a Network hiba legyen elnyelve.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    pt.stop();
    await startPromise;
  });

  it("a watchTicker ciklusban a nem-Network hiba továbbdobódik", async () => {
    // A watchTicker egy nem-Network hibát dob — a start() a catch-ágban továbbdobja.
    const feed = makeFeed({
      watchTickerImpl: () => Promise.reject(new Error("Random non-network error")),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    // A hiba a catch-ágban továbbdobódik, tehát a start() elutasítódik.
    const error = await captureExpectedError(pt.start({ symbols: ["BTC/USDT"] }));
    expect(error.message).toContain("Random non-network error");
    // Takarítás: a while-ciklus nem fut, mert a catch-ág a start() elutasítása előtt
    // a ciklust NEM állítja le (a running flag false marad). A pt.stop() biztosítja.
    pt.stop();
  });

  it("a watchTicker-ben lévő seq ellenőrzés — a sequence drift warning-ot ír", async () => {
    const warningRecorder = new WarningCallRecorder();
    warningRecorder.install();
    const q = makeQueuedTickerFeed();
    const pt = new PaperTrader(q.feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    try {
      const startPromise = pt.start({ symbols: ["BTC/USDT"] });
      await awaitMicrotasks();
      // Az első ticker seq=100 → eltároljuk 100-ként.
      drainQueue(q, defaultMockTicker("BTC/USDT", { timestamp: 100 }));
      await awaitMicrotasks();
      // A második ticker seq=102 → drift, 101 helyett 102 jött.
      drainQueue(q, defaultMockTicker("BTC/USDT", { timestamp: 102 }));
      await awaitMicrotasks();
      // Leállítjuk és utolsó tickert is resolve-oljuk.
      pt.stop();
      q.stopGate.stopped = true;
      drainQueue(q, defaultMockTicker("BTC/USDT", { timestamp: 103 }));
      await startPromise;

      expect(warningRecorder.contains("sequence drift")).toBe(true);
    } finally {
      warningRecorder.restore();
    }
  });

  it("a watchTicker-ben a nem-szám timestamp figyelmen kívül van hagyva", async () => {
    const warningRecorder = new WarningCallRecorder();
    warningRecorder.install();
    const q = makeQueuedTickerFeed();
    const pt = new PaperTrader(q.feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    try {
      const startPromise = pt.start({ symbols: ["BTC/USDT"] });
      await awaitMicrotasks();
      // timestamp = undefined → a checkSeq early-return.
      drainQueue(q, makeTickerWithoutTimestamp("BTC/USDT"));
      await awaitMicrotasks();
      pt.stop();
      q.stopGate.stopped = true;
      drainQueue(q, defaultMockTicker("BTC/USDT", { timestamp: 100 }));
      await startPromise;
      // Nem szabad warning-ot írni (nincs drift, mert nincs tárolt seq).
      expect(warningRecorder.contains("sequence drift")).toBe(false);
    } finally {
      warningRecorder.restore();
    }
  });

  it("processes open-position ticker values with both missing and valid last prices", async () => {
    const queuedFeed = makeQueuedTickerFeed();
    const trader = new PaperTrader(queuedFeed.feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await trader.executeSignal({
      symbol: "BTC/USDT",
      action: "buy",
      confidence: 0.5,
      reason: "stop-check coverage",
      generatedAt: Date.now(),
      suggestedAmount: 0.01,
      suggestedPrice: 100,
    });

    const startPromise = trader.start({ symbols: ["BTC/USDT"] });
    await awaitMicrotasks();
    drainQueue(queuedFeed, defaultMockTicker("BTC/USDT", { last: undefined, timestamp: 1 }));
    await awaitMicrotasks();
    drainQueue(queuedFeed, defaultMockTicker("BTC/USDT", { last: 100, timestamp: 2 }));
    await awaitMicrotasks();
    trader.stop();
    queuedFeed.stopGate.stopped = true;
    drainQueue(queuedFeed, defaultMockTicker("BTC/USDT", { timestamp: 3 }));
    await startPromise;
  });
});
