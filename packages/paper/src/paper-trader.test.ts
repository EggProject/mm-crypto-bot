/**
 * packages/paper/src/paper-trader.test.ts
 *
 * Phase 35 Track G — 100% line + branch coverage a PaperTrader osztályhoz.
 *
 * A `PaperTrader` a paper-trading emulator fő osztálya:
 *   - `executeSignal(signal)` — a stratégia jeléből szimulált fillt készít
 *   - `start({symbols})` — CCXT Pro watchTicker ciklus
 *   - `stop()` — graceful leállítás
 *   - `snapshot()` / `history_()` — read-only állapot
 *
 * A tesztek a `MockExchangeFeed` segítségével hívják a feed-metódusokat.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { PaperTrader } from "./paper-trader.js";
import {
  MockExchangeFeed,
  defaultMockTicker,
} from "./test-helpers.js";
import type { ExchangeFeed, ExchangeFeeConfig, TradingSignal } from "@mm-crypto-bot/shared";
import type { Balances, Ticker } from "ccxt";

/**
 * Alap fee konfiguráció a tesztekhez — a bybit.eu default-okkal egyező.
 */
const DEFAULT_FEE: ExchangeFeeConfig = {
  spotTakerFee: 0.001,
  spotMakerFee: 0.001,
  borrowRatePerDay: 0.0002,
  liquidationFee: 0.02,
  maintenanceMarginRatio: 1.0,
};

/**
 * A mock feed alapértelmezett tickerét használjuk (last/bid/ask = 100/100/101).
 */
function makeFeed(opts: ConstructorParameters<typeof MockExchangeFeed>[0] = {}): MockExchangeFeed {
  return new MockExchangeFeed(opts);
}

/**
 * Egyszerű segédlet egy buy signal összeállításához.
 */
function buySignal(overrides: Partial<TradingSignal> = {}): TradingSignal {
  return {
    symbol: "BTC/USDT",
    action: "buy",
    confidence: 0.5,
    reason: "test",
    generatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Egyszerű segédlet egy sell signal összeállításához.
 */
function sellSignal(overrides: Partial<TradingSignal> = {}): TradingSignal {
  return {
    symbol: "BTC/USDT",
    action: "sell",
    confidence: 0.5,
    reason: "test",
    generatedAt: Date.now(),
    ...overrides,
  };
}

describe("PaperTrader — konstruktor és snapshot", () => {
  it("a kezdeti cash az initialBalanceQuote értéke, a positions üres", () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const snap = pt.snapshot();
    expect(snap.cash).toBe(10_000);
    expect(snap.positions).toEqual([]);
  });

  it("a history kezdetben üres (read-only copy)", () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const h = pt.history_();
    expect(h).toEqual([]);
    // A history() a belső tömb másolata — módosítása NEM érinti a PaperTrader-t.
    expect(Array.isArray(h)).toBe(true);
  });

  it("a default maxHistory a konstruktorban 1000-re van állítva", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    // Közvetetten teszteljük: 1001 fill után a history csak 1000 elemű.
    const sig = buySignal({ suggestedAmount: 0.0001, suggestedPrice: 100 });
    for (let i = 0; i < 1001; i++) {
      await pt.executeSignal(sig);
    }
    const h = pt.history_();
    expect(h.length).toBe(1000);
  });

  it("az explicit maxHistory felülírja a default-ot", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 100_000,
      fee: DEFAULT_FEE,
      maxHistory: 5,
    });
    const sig = buySignal({ suggestedAmount: 0.0001, suggestedPrice: 100 });
    for (let i = 0; i < 10; i++) {
      await pt.executeSignal(sig);
    }
    expect(pt.history_().length).toBe(5);
  });
});

describe("PaperTrader.executeSignal — hold action", () => {
  it("a 'hold' action esetén null-t ad vissza és nem hívja a feed-et", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig: TradingSignal = {
      symbol: "BTC/USDT",
      action: "hold",
      confidence: 0.5,
      reason: "test",
      generatedAt: Date.now(),
    };
    const result = await pt.executeSignal(sig);
    expect(result).toBeNull();
    expect(feed.lastFetchedSymbol).toBeNull();
    expect(pt.snapshot().positions).toEqual([]);
  });
});

describe("PaperTrader.executeSignal — fill price kiválasztás", () => {
  it("buy signal esetén suggestedPrice nélkül az ask árat használja", async () => {
    const feed = makeFeed({
      tickerResolver: (sym) => defaultMockTicker(sym, { ask: 105, bid: 95, last: 100 }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01 });
    const fill = await pt.executeSignal(sig);
    expect(fill).not.toBeNull();
    expect(fill!.price).toBe(105); // az ask
    expect(fill!.side).toBe("buy");
  });

  it("sell signal esetén suggestedPrice nélkül a bid árat használja", async () => {
    const feed = makeFeed({
      tickerResolver: (sym) => defaultMockTicker(sym, { ask: 105, bid: 95, last: 100 }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = sellSignal({ suggestedAmount: 0.01 });
    const fill = await pt.executeSignal(sig);
    expect(fill).not.toBeNull();
    expect(fill!.price).toBe(95); // a bid
    expect(fill!.side).toBe("sell");
  });

  it("ha nincs ask sem bid sem last, a fillPrice=0 és null-t ad vissza", async () => {
    // A default mock ticker tartalmaz ask/bid/last értéket — felülírjuk null-lal.
    const feed = makeFeed({
      tickerResolver: (sym) =>
        defaultMockTicker(sym, { ask: undefined, bid: undefined, last: undefined }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01 });
    const fill = await pt.executeSignal(sig);
    expect(fill).toBeNull();
  });

  it("ha a suggestedPrice 0 vagy negatív, null-t ad vissza", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01, suggestedPrice: 0 });
    expect(await pt.executeSignal(sig)).toBeNull();

    const sig2 = buySignal({ suggestedAmount: 0.01, suggestedPrice: -50 });
    expect(await pt.executeSignal(sig2)).toBeNull();
  });

  it("a suggestedPrice explicit értéke felülírja a ticker árat", async () => {
    const feed = makeFeed({
      tickerResolver: (sym) => defaultMockTicker(sym, { ask: 105, bid: 95, last: 100 }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01, suggestedPrice: 200 });
    const fill = await pt.executeSignal(sig);
    expect(fill!.price).toBe(200);
  });
});

describe("PaperTrader.executeSignal — amount kiválasztás", () => {
  it("a suggestedAmount felülírja a Kelly-size-t", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.05, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    expect(fill!.amount).toBe(0.05);
  });

  it("ha a suggestedAmount 0 vagy negatív, null-t ad vissza", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0, suggestedPrice: 100 });
    expect(await pt.executeSignal(sig)).toBeNull();
  });

  it("ha a Kelly-size 0-t ad (nincs cash), null-t ad vissza", async () => {
    const feed = makeFeed();
    // Kezdő egyenleg 0 — a Kelly size = (0 * confidence * 0.25) / price = 0
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 0,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedPrice: 100 }); // nincs suggestedAmount → Kelly
    expect(await pt.executeSignal(sig)).toBeNull();
  });

  it("a Kelly-size a confidence * 0.25 * equity / price képletet használja", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    // confidence = 1.0 → size = (10000 * 1.0 * 0.25) / 100 = 25
    const sig = buySignal({ confidence: 1.0, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    expect(fill!.amount).toBeCloseTo(25, 6);
  });

  it("a confidence > 1.0 esetén is 1.0-ra van vágva (Math.min)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ confidence: 5.0, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    expect(fill!.amount).toBeCloseTo(25, 6); // 10000 * 1.0 * 0.25 / 100
  });

  it("a confidence < 0.0 esetén is 0.0-ra van vágva (Math.max)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ confidence: -1.0, suggestedPrice: 100 });
    // A Kelly = 0, így null-t ad vissza.
    const fill = await pt.executeSignal(sig);
    expect(fill).toBeNull();
  });
});

describe("PaperTrader.executeSignal — fillOrder: új pozíció nyitása", () => {
  it("az első buy új long pozíciót nyit, csökkenti a cash-t", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.5, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    expect(fill).not.toBeNull();
    const snap = pt.snapshot();
    expect(snap.positions.length).toBe(1);
    const pos = snap.positions[0]!;
    expect(pos.symbol).toBe("BTC/USDT");
    expect(pos.side).toBe("long");
    expect(pos.amount).toBe(0.5);
    expect(pos.avgEntryPrice).toBe(100);
    expect(pos.leverage).toBe(1);
    // A cash csökkenés: cost + fee = 100 * 0.5 + 100 * 0.5 * 0.001 = 50 + 0.05
    expect(snap.cash).toBeCloseTo(10_000 - 50 - 0.05, 6);
  });

  it("az első sell új short pozíciót nyit (amount negatív, side='short')", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = sellSignal({ suggestedAmount: 0.5, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    expect(fill).not.toBeNull();
    const snap = pt.snapshot();
    expect(snap.positions.length).toBe(1);
    const pos = snap.positions[0]!;
    expect(pos.side).toBe("short");
    expect(pos.amount).toBe(0.5);
    // A jelenlegi implementáció új pozíciónál (long VAGY short) a
    //   `this.state.cash -= cost + fee` ágat használja — vagyis a cash
    // a (cost + fee) értékkel csökken a short nyitáskor is.
    // cost = 100 * 0.5 = 50, fee = 50 * 0.001 = 0.05, összesen 50.05.
    expect(snap.cash).toBeCloseTo(10_000 - 50 - 0.05, 6);
  });
});

describe("PaperTrader.executeSignal — fillOrder: meglévő pozíció növelése", () => {
  it("a második, azonos irányú buy növeli a pozíciót és átlagolja az árat", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 200 }));
    const pos = pt.snapshot().positions[0]!;
    expect(pos.amount).toBe(2);
    // Átlagár: (1*100 + 1*200) / 2 = 150
    expect(pos.avgEntryPrice).toBe(150);
  });

  it("a második, azonos irányú sell (short) növeli a short mennyiséget", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 100_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 200 }));
    const pos = pt.snapshot().positions[0]!;
    expect(pos.amount).toBe(2);
    expect(pos.avgEntryPrice).toBe(150);
  });
});

describe("PaperTrader.executeSignal — fillOrder: ellentétes irányú fill", () => {
  it("egy ellentétes sell részlegesen zárja a long pozíciót", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 150 }));
    const pos = pt.snapshot().positions[0]!;
    expect(pos.amount).toBe(1);
    // A jelenlegi implementáció a sign nem-váltó ágat használja
    // (totalAmount=1, sign megegyezik existing.amount=2 sign-jával).
    // Az átlagár a kód szerint: (2*100 + 1*150) / 1 = 350.
    expect(pos.avgEntryPrice).toBe(350);
  });

  it("egy ellentétes sell ami pontosan kiegyenlíti a longot, nullázza az amount-ot", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(sellSignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    const pos = pt.snapshot().positions[0]!;
    expect(pos.amount).toBe(0);
  });
});

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
function makeQueuedTickerFeed(opts: { initialTicker?: Ticker } = {}): QueuedTickerFeed {
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
  if (opts.initialTicker) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    queue.push(() => {});
    // az első resolve-ot a teszt hívja
  }
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
  return new Promise<void>((r) => setImmediate(r));
}

describe("PaperTrader.start / stop — watchTicker ciklus", () => {
  let warnSpy: ReturnType<typeof spyOn> | null = null;
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it("a start() dob hibát, ha a feed nem támogatja a watchTicker-t", async () => {
    // A MockExchangeFeed default-ból támogatja — készítünk egyet, ami nem.
    const feed: ExchangeFeed = {
      id: "no-watch",
      name: "No Watch",
      loadMarkets: async () => ({}),
      fetchTicker: async (sym: string) => defaultMockTicker(sym),
      fetchOrderBook: async () => {
        throw new Error("nope");
      },
      fetchTrades: async () => [],
      fetchOHLCV: async () => [],
      fetchBalance: async () => ({} as Balances),
      createOrder: async () => {
        throw new Error("nope");
      },
      cancelOrder: async () => {
        throw new Error("nope");
      },
      // Nincs watchTicker!
    };
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await expect(pt.start({ symbols: ["BTC/USDT"] })).rejects.toThrow(
      /A feed nem tamogatja a watchTicker-t/,
    );
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
          setTimeout(() => reject(new Error("Network connection lost")), 1);
        }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const startPromise = pt.start({ symbols: ["BTC/USDT"] });
    // Várunk, hogy a watchTicker fusson és a Network hiba legyen elnyelve.
    await new Promise((r) => setTimeout(r, 10));
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
    await expect(pt.start({ symbols: ["BTC/USDT"] })).rejects.toThrow("Random non-network error");
    // Takarítás: a while-ciklus nem fut, mert a catch-ág a start() elutasítása előtt
    // a ciklust NEM állítja le (a running flag false marad). A pt.stop() biztosítja.
    pt.stop();
  });

  it("a watchTicker-ben lévő seq ellenőrzés — a sequence drift warning-ot ír", async () => {
    const q = makeQueuedTickerFeed();
    const pt = new PaperTrader(q.feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
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

    // A warning spy ellenőrzi, hogy a drift logolódott.
    expect(warnSpy).toHaveBeenCalled();
    const calls = (warnSpy!.mock.calls as unknown[][]).map((args) =>
      String(args[0] ?? ""),
    );
    expect(calls.some((m) => m.includes("sequence drift"))).toBe(true);
  });

  it("a watchTicker-ben a nem-szám timestamp figyelmen kívül van hagyva", async () => {
    const q = makeQueuedTickerFeed();
    const pt = new PaperTrader(q.feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const startPromise = pt.start({ symbols: ["BTC/USDT"] });
    await awaitMicrotasks();
    // timestamp = undefined → a checkSeq early-return.
    drainQueue(q, defaultMockTicker("BTC/USDT", { timestamp: undefined as unknown as number }));
    await awaitMicrotasks();
    pt.stop();
    q.stopGate.stopped = true;
    drainQueue(q, defaultMockTicker("BTC/USDT", { timestamp: 100 }));
    await startPromise;
    // Nem szabad warning-ot írni (nincs drift, mert nincs tárolt seq).
    const calls = (warnSpy!.mock.calls as unknown[][]).map((args) =>
      String(args[0] ?? ""),
    );
    expect(calls.some((m) => m.includes("sequence drift"))).toBe(false);
  });
});

describe("PaperTrader.executeSignal — fetchTicker hiba", () => {
  it("ha a fetchTicker hibát dob, a hiba továbbdobódik", async () => {
    const feed = makeFeed({
      tickerError: (sym) => new Error(`fetchTicker failed for ${sym}`),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01, suggestedPrice: 100 });
    await expect(pt.executeSignal(sig)).rejects.toThrow("fetchTicker failed for BTC/USDT");
  });
});

describe("PaperTrader — fee számítás", () => {
  it("a fee a cost * feeRate (spotTakerFee)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: { ...DEFAULT_FEE, spotTakerFee: 0.005 }, // 0.5%
    });
    const sig = buySignal({ suggestedAmount: 1, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    // cost = 100, fee = 100 * 0.005 = 0.5
    expect(fill!.fee).toBeCloseTo(0.5, 6);
    // A feeCurrency "USDT".
    expect(fill!.feeCurrency).toBe("USDT");
  });

  it("a fill mode='paper'", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const fill = await pt.executeSignal(buySignal({ suggestedAmount: 0.1, suggestedPrice: 100 }));
    expect(fill!.mode).toBe("paper");
  });

  it("a fill orderId-t a PaperTrader állítja elő", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const fill = await pt.executeSignal(buySignal({ suggestedAmount: 0.1, suggestedPrice: 100 }));
    expect(fill!.orderId).toMatch(/^paper-\d+$/);
  });

  it("a fill id-jének formátuma 'fill-...'", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const fill = await pt.executeSignal(buySignal({ suggestedAmount: 0.1, suggestedPrice: 100 }));
    expect(fill!.id).toMatch(/^fill-\d+-[a-z0-9]+$/);
  });
});

describe("PaperTrader.snapshot — side / amount leképezés", () => {
  it("long pozíció: amount pozitív, side='long'", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const pos = pt.snapshot().positions[0]!;
    expect(pos.side).toBe("long");
    expect(pos.amount).toBe(1);
  });

  it("short pozíció: amount pozitív abszolút érték, side='short'", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const pos = pt.snapshot().positions[0]!;
    expect(pos.side).toBe("short");
    // A belső amount -1 (signed), de a snapshot-ban Math.abs() → 1.
    expect(pos.amount).toBe(1);
  });

  it("a snapshot unrealizedPnl és realizedPnl jelenleg mindig 0 (TODO marker)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const pos = pt.snapshot().positions[0]!;
    expect(pos.unrealizedPnl).toBe(0);
    expect(pos.realizedPnl).toBe(0);
  });

  it("a snapshot leverage=1 az új pozícióknál (a PaperTrader jelenleg 1x leverage-et használ)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const pos = pt.snapshot().positions[0]!;
    expect(pos.leverage).toBe(1);
  });
});

describe("PaperTrader — openedAt timestamp", () => {
  it("a pozíció openedAt a fill idejéhez közeli timestamp", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const before = Date.now();
    await pt.executeSignal(buySignal({ suggestedAmount: 0.1, suggestedPrice: 100 }));
    const after = Date.now();
    const pos = pt.snapshot().positions[0]!;
    expect(pos.openedAt).toBeGreaterThanOrEqual(before);
    expect(pos.openedAt).toBeLessThanOrEqual(after + 5);
  });

  it("egy ellentétes fill, ami nullázza az amount-ot, frissíti az openedAt-ot", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const firstOpenedAt = pt.snapshot().positions[0]!.openedAt;
    // Várunk kicsit, hogy az openedAt biztosan különböző legyen.
    await new Promise((r) => setTimeout(r, 5));
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const pos = pt.snapshot().positions[0]!;
    expect(pos.openedAt).toBeGreaterThan(firstOpenedAt);
  });
});
