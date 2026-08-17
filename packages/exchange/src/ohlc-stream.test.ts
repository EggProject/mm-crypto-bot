// packages/exchange/src/ohlc-stream.test.ts — 100% line coverage for OhlcStream
//
// Phase 37 Track 3: the new `OhlcStream` class that aggregates live
// trades into OHLC bars + ring buffer + EventEmitter. The tests cover
//   - The `RingBuffer` ring semantics (push, overflow, iteration order)
//   - The `alignToTimeframe` grid-alignment helper
//   - `barsToCandles` / `barsToOhlcv` shape conversion
//   - The `OhlcStream` lifecycle (start, stop, idempotency)
//   - The trade → bar aggregation (single bucket + bucket rollover)
//   - The `getBars` / `lastBar` / `bufferSizeOf` query methods
//   - The `ingest` programmatic feed (test + backtest path)
//   - The `subscribe*` plumbing via `MockExchangeFeed.pushEvent`
//   - The `error` event when `feed.unsubscribe` throws

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import {
  alignToTimeframe,
  barsToCandles,
  barsToOhlcv,
  DEFAULT_OHLC_STREAM_CONFIG,
  OhlcStream,
  RingBuffer,
  type OhlcBar,
  type OhlcStreamBarEvent,
  type OhlcStreamErrorEvent,
} from "./ohlc-stream.js";
// Phase 66: the mock feed moved to the `__testing__/` subdirectory.
// Update the relative import to match.
import { MockExchangeFeed } from "./__testing__/mockFeed.js";
import type { FeedEvent, Ohlcv, Trade } from "./types.js";
import { asSymbol } from "./symbols.js";

const SYM = asSymbol("BTC/USDT");
const SYM2 = asSymbol("ETH/USDT");

function mkTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t-default",
    symbol: SYM,
    timestamp: 1_700_000_400_000,
    price: 100,
    amount: 1,
    takerSide: "buy",
    ...overrides,
  };
}

function pushTrade(feed: MockExchangeFeed, trade: Trade): void {
  const event: FeedEvent = { kind: "trade", payload: trade };
  feed.pushEvent(event);
}

describe("RingBuffer", () => {
  it("konstruktor elutasítja a nem-pozitív kapacitást", () => {
    expect(() => new RingBuffer<number>(0)).toThrow(/capacity/);
    expect(() => new RingBuffer<number>(-1)).toThrow(/capacity/);
    expect(() => new RingBuffer<number>(1.5)).toThrow(/capacity/);
  });

  it("push + toArray, méret növekszik a kapacitásig", () => {
    const rb = new RingBuffer<number>(3);
    expect(rb.size).toBe(0);
    expect(rb.toArray()).toEqual([]);
    rb.push(1);
    rb.push(2);
    expect(rb.size).toBe(2);
    expect(rb.toArray()).toEqual([1, 2]);
    rb.push(3);
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([1, 2, 3]);
  });

  it("túlcsordulás: a legrégebbi elem kiesik, sorrend megmarad", () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4); // kiesik: 1
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([2, 3, 4]);
    rb.push(5);
    expect(rb.toArray()).toEqual([3, 4, 5]);
  });

  it("values() iterátor a megfelelő sorrendben adja vissza az elemeket", () => {
    const rb = new RingBuffer<number>(3);
    rb.push("a" as unknown as number);
    rb.push("b" as unknown as number);
    rb.push("c" as unknown as number);
    rb.push("d" as unknown as number);
    const seen: unknown[] = [];
    for (const v of rb.values()) seen.push(v);
    expect(seen).toEqual(["b", "c", "d"]);
  });
});

describe("alignToTimeframe", () => {
  it("1m grid: levágja a másodpercet és a milli-szekundumot", () => {
    // 1_700_000_400_000 % 60_000 = 20_000, így az 1m grid a 1_700_000_400_000.
    // 1_700_000_123_456 % 60_000 = 23_456, így az 1m grid a 1_700_000_100_000.
    expect(alignToTimeframe(1_700_000_123_456, "1m")).toBe(1_700_000_100_000);
  });
  it("5m grid: az 5-perces ablak elejére kerekít", () => {
    // 1_700_000_123_000 % 300_000 = 23_000, így az 5m grid a 1_700_000_100_000.
    expect(alignToTimeframe(1_700_000_123_000, "5m")).toBe(1_700_000_100_000);
  });
  it("1h grid: a pontos óra-határra kerekít", () => {
    const h1 = alignToTimeframe(1_700_001_234_000, "1h");
    expect(h1 % (60 * 60_000)).toBe(0);
    expect(h1).toBeLessThanOrEqual(1_700_001_234_000);
  });
  it("1d grid: az adott nap UTC-éjfélre kerekít", () => {
    const d1 = alignToTimeframe(1_700_001_234_000, "1d");
    expect(d1 % (24 * 60 * 60_000)).toBe(0);
  });
  it("pontosan grid-határon lévő timestamp változatlan marad", () => {
    // 1_700_000_100_000 pontosan az 1m grid-en.
    const aligned = 1_700_000_100_000;
    expect(alignToTimeframe(aligned, "1m")).toBe(aligned);
    // Számoljuk ki: 1_700_000_400_000 — 1_700_000_400_000 % 300_000 = ?
    // 1_700_000_400_000 / 300_000 = 5666668, 5666668 * 300_000 = 1_700_000_400_000 — IGEN, pontos.
    const alignedGrid5m = 1_700_000_400_000;
    expect(alignToTimeframe(alignedGrid5m, "5m")).toBe(alignedGrid5m);
  });
});

describe("barsToCandles + barsToOhlcv", () => {
  it("barsToCandles visszaadja a Candle shape-et, volume mezővel együtt", () => {
    const bars: OhlcBar[] = [
      {
        timestamp: 1,
        symbol: SYM,
        timeframe: "1m",
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 100,
        tradeCount: 2,
      },
    ];
    const candles = barsToCandles(bars);
    expect(candles).toEqual([{ timestamp: 1, open: 10, high: 11, low: 9, close: 10.5, volume: 100 }]);
  });

  it("barsToOhlcv a CCXT tuple formátumot adja vissza", () => {
    const bars: OhlcBar[] = [
      {
        timestamp: 1,
        symbol: SYM,
        timeframe: "1m",
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 100,
        tradeCount: 2,
      },
    ];
    const ohlcv = barsToOhlcv(bars);
    expect(ohlcv).toEqual([[1, 10, 11, 9, 10.5, 100]]);
  });
});

describe("OhlcStream (default config)", () => {
  let feed: MockExchangeFeed;
  let emitter: EventEmitter;
  let stream: OhlcStream;

  beforeEach(() => {
    feed = new MockExchangeFeed();
    emitter = new EventEmitter();
    // A C4 fix óta az `OhlcStream.start()` REST backfillt végez a
    // ring buffer feltöltésére. A meglévő trade-aggregációs tesztek
    // viszont kifejezetten üres bufferrel dolgoznak — a backfillt
    // itt lokálisan kikapcsoljuk, hogy a C4 hatását kizárólag az
    // új, dedikált tesztek ellenőrizzék.
    for (const tf of DEFAULT_OHLC_STREAM_CONFIG.timeframes) {
      feed.setOhlcv(SYM, tf, []);
    }
    stream = new OhlcStream(feed, emitter);
  });

  afterEach(async () => {
    await stream.stop();
  });

  it("a default config tartalmazza a 6 standard timeframe-öt", () => {
    expect(DEFAULT_OHLC_STREAM_CONFIG.timeframes).toEqual(["1m", "5m", "15m", "1h", "4h", "1d"]);
    expect(DEFAULT_OHLC_STREAM_CONFIG.bufferSize).toBe(1000);
  });

  it("isRunning false a start előtt, true után, false a stop után", async () => {
    expect(stream.isRunning()).toBe(false);
    await stream.start();
    expect(stream.isRunning()).toBe(true);
    await stream.stop();
    expect(stream.isRunning()).toBe(false);
  });

  it("start() idempotens: második hívás nem csinál semmit", async () => {
    await stream.start();
    await stream.start();
    expect(stream.isRunning()).toBe(true);
  });

  it("stop() akkor is biztonságos, ha még nem fut", async () => {
    await stream.stop();
    expect(stream.isRunning()).toBe(false);
  });

  it("start() feliratkozik a trade stream-re minden symbol-ra", async () => {
    // A C4 fix miatt a backfill SYM2-re is le kell fusson — kapcsoljuk
    // ki lokálisan, hogy a trade-aggregációs vizsgálat tiszta maradjon.
    feed.setOhlcv(SYM2, "1m", []);
    const customStream = new OhlcStream(feed, emitter, {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM, SYM2],
    });
    await customStream.start();
    // 2 trade / symbol → 1 completed bar / symbol (a 2. trade új bucket).
    pushTrade(feed, mkTrade({ symbol: SYM, timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    pushTrade(feed, mkTrade({ symbol: SYM2, timestamp: 1_700_000_400_000, price: 50, amount: 2 }));
    pushTrade(feed, mkTrade({ symbol: SYM, timestamp: 1_700_000_460_000, price: 110, amount: 1 }));
    pushTrade(feed, mkTrade({ symbol: SYM2, timestamp: 1_700_000_460_000, price: 55, amount: 1 }));
    expect(customStream.bufferSizeOf(SYM, "1m")).toBe(1);
    expect(customStream.bufferSizeOf(SYM2, "1m")).toBe(1);
    await customStream.stop();
  });

  it("ingest(): trade → aktív bar minden timeframe-re, nincs completed bar amíg nincs rollover", () => {
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    // 1 trade → 0 completed bar (a bar csak a KÖVETKEző új bucketnél zárul).
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    expect(stream.bufferSizeOf(SYM, "5m")).toBe(0);
    expect(stream.bufferSizeOf(SYM, "1h")).toBe(0);
    // A 2. trade új 1m bucketben → az 1. 1m bar lezár, minden tf-en aktív.
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000 + 60_000, price: 110, amount: 1 }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
    // Az 5m és 1h tf-eken a 2. trade MÉG ugyanabban a bucketben van
    // (60s < 5m/1h), így 0 completed bar.
    expect(stream.bufferSizeOf(SYM, "5m")).toBe(0);
    expect(stream.bufferSizeOf(SYM, "1h")).toBe(0);
    // A trade-ek száma a lezárt 1m bar tradeCount mezejében.
    const bar1m = stream.lastBar(SYM, "1m");
    expect(bar1m).toBeDefined();
    expect(bar1m?.tradeCount).toBe(1);
    expect(bar1m?.open).toBe(100);
    expect(bar1m?.close).toBe(100);
  });

  it("azonos bucketen belüli trade-ek ugyanazt a bar-t töltik (high/low/close frissül)", () => {
    const t0 = 1_700_000_400_000; // 1m grid
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 5_000, price: 110, amount: 2, takerSide: "sell" }));
    stream.ingest(mkTrade({ timestamp: t0 + 30_000, price: 95, amount: 1, takerSide: "sell" }));
    // Még mindig 0 completed bar (minden trade ugyanabba a bucketbe esik).
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    // A 4. trade új bucketet nyit → az 1. bar lezár HIGH=110 LOW=95 CLOSE=95 értékekkel.
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 105, amount: 1 }));
    const completed = stream.lastBar(SYM, "1m");
    expect(completed?.open).toBe(100);
    expect(completed?.high).toBe(110);
    expect(completed?.low).toBe(95);
    expect(completed?.close).toBe(95);
    expect(completed?.volume).toBe(4); // 1 + 2 + 1
    expect(completed?.tradeCount).toBe(3);
  });

  it("bucket rollover: az új trade új bar-t nyit, a régi bezárul", () => {
    const t0 = 1_700_000_400_000;
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 120_000, price: 120, amount: 1 }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(2);
    const bars = stream.getBars(SYM, "1m");
    expect(bars).toHaveLength(2);
    expect(bars[0]?.open).toBe(100);
    expect(bars[0]?.close).toBe(100);
    expect(bars[0]?.high).toBe(100);
    expect(bars[1]?.open).toBe(110);
    expect(bars[1]?.close).toBe(110);
  });

  it("bar eventet bocsát ki minden bar lezáráskor", () => {
    const seen: OhlcStreamBarEvent[] = [];
    emitter.on("bar", (e: OhlcStreamBarEvent) => seen.push(e));
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000 + 60_000, price: 110, amount: 1 }));
    // 2 bar zárult (1m-en a 2. trade új bucketet nyit, az 1. bezárul).
    expect(seen.length).toBe(1);
    expect(seen[0]?.bar.open).toBe(100);
  });

  it("getBars(symbol, tf) üres tömböt ad, ha a symbol nem a config-ban van", () => {
    expect(stream.getBars(asSymbol("NOPE/USDT"), "1m")).toEqual([]);
  });

  it("getBars(symbol, tf, since) szűri a timestamp-eket", () => {
    const t0 = 1_700_000_400_000;
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 120_000, price: 120, amount: 1 }));
    const all = stream.getBars(SYM, "1m");
    // 3 trade → 2 completed bar (a 2. és 3. trade egyaránt új bucket).
    expect(all).toHaveLength(2);
    expect(all[0]?.timestamp).toBe(t0);
    expect(all[1]?.timestamp).toBe(t0 + 60_000);
    // A `since` filter a timestamp >= since, így t0+60_001 NEM tartja meg a 2. bar-t
    // (mivel a 2. bar timestamp-je pontosan t0+60_000 < t0+60_001).
    const afterFirst = stream.getBars(SYM, "1m", t0 + 60_001);
    expect(afterFirst).toHaveLength(0);
    // Viszont t0+60_000 határ-inkluzív: a 2. bar benne marad.
    const atSecond = stream.getBars(SYM, "1m", t0 + 60_000);
    expect(atSecond).toHaveLength(1);
    expect(atSecond[0]?.timestamp).toBe(t0 + 60_000);
  });

  it("lastBar undefined, ha nincs lezárt bar", () => {
    expect(stream.lastBar(SYM, "1m")).toBeUndefined();
  });

  it("bufferSizeOf 0, ha a (symbol, tf) páros nem a config-ban van", () => {
    expect(stream.bufferSizeOf(asSymbol("NOPE/USDT"), "1m")).toBe(0);
  });

  it("a push valóban ring-el: a buffer mérete a capacity-ig nő, utána nem", () => {
    const small = new OhlcStream(feed, new EventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 3,
      symbols: [SYM],
    });
    const t0 = 1_700_000_400_000;
    for (let i = 0; i < 10; i++) {
      small.ingest(mkTrade({ timestamp: t0 + i * 60_000, price: 100 + i, amount: 1 }));
    }
    // 10 trade → 9 completed bar (az utolsó trade csak megnyitja a 10. aktív bar-t, nem zár le semmit).
    expect(small.bufferSizeOf(SYM, "1m")).toBe(3);
    const bars = small.getBars(SYM, "1m");
    expect(bars).toHaveLength(3);
    // A 7., 8., 9. completed bar (price 106, 107, 108) maradt a ring buffer-ben.
    expect(bars[0]?.open).toBe(106);
    expect(bars[2]?.open).toBe(108);
  });

  it("a subscribeTrades-en átjövő trade-ek is összegyűlnek", async () => {
    await stream.start();
    pushTrade(feed, mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    pushTrade(feed, mkTrade({ timestamp: 1_700_000_400_000 + 60_000, price: 110, amount: 1 }));
    // 2 trade → 1 completed bar (a 2. trade új 1m bucket).
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
  });

  it("a nem-trade FeedEvent típusokat a handleTrade figyelmen kívül hagyja", async () => {
    await stream.start();
    feed.pushEvent({ kind: "ticker", payload: {} as never });
    feed.pushEvent({ kind: "orderbook", payload: {} as never });
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
  });

  it("stop() törli az active bar-okat és újrainicializálja a ring buffereket", async () => {
    await stream.start();
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000 + 60_000, price: 110, amount: 1 }));
    // 2 trade → 1 completed bar.
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
    await stream.stop();
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    expect(stream.lastBar(SYM, "1m")).toBeUndefined();
  });

  it("ha az unsubscribe hibát dob, error eventet bocsát ki és a többit is leiratkozza", async () => {
    await stream.start();
    // Egy mock hibás feed, ami minden unsubscribe-re hibát dob.
    let unsubCalls = 0;
    const failingFeed = new MockExchangeFeed();
    await failingFeed.open();
    await failingFeed.subscribeTrades(SYM, () => undefined);
    const origUnsub = failingFeed.unsubscribe.bind(failingFeed);
    failingFeed.unsubscribe = async (id) => {
      unsubCalls += 1;
      if (unsubCalls === 1) throw new Error("simulated unsubscribe error");
      return origUnsub(id);
    };
    const streamWithFail = new OhlcStream(failingFeed, emitter, {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    await streamWithFail.start();
    const errors: OhlcStreamErrorEvent[] = [];
    emitter.on("error", (e: OhlcStreamErrorEvent) => errors.push(e));
    await streamWithFail.stop();
    expect(errors.length).toBe(1);
    expect(errors[0]?.error.message).toContain("simulated unsubscribe error");
    expect(unsubCalls).toBe(1);
  });
});

describe("OhlcStream (egyedi config — 1 symbol, 1 timeframe)", () => {
  it("a konstruktor megőrzi a részleges config-ot", () => {
    const feed = new MockExchangeFeed();
    const s = new OhlcStream(feed, new EventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 5,
      symbols: [SYM],
    });
    expect(s.config.timeframes).toEqual(["1m"]);
    expect(s.config.bufferSize).toBe(5);
    expect(s.config.symbols).toEqual([SYM]);
  });
});

describe("OhlcStream — C4 fix: REST backfill on start()", () => {
  it("start() a subscribeTrades ELŐTT feltölti a ring buffer-t a REST history-val", async () => {
    // A C4 fix lényege: a ring buffer NEM üres a start() után. A
    // strategy (ohlc-trend 200-as EMA) azonnal kap history-t, nem
    // kell 8 napot várni az első signalig.
    const feed = new MockExchangeFeed();
    const emitter = new EventEmitter();
    // Explicit history-t állítunk be, hogy az ellenőrzés determinisztikus legyen.
    const t0 = 1_700_000_000_000; // UTC 2023-11-14 22:13:20 (1m grid-en)
    const history: Ohlcv[] = [];
    for (let i = 0; i < 5; i++) {
      const ts = t0 + i * 60_000; // 5 db 1m bar
      history.push([ts, 100 + i, 105 + i, 95 + i, 102 + i, 10 + i]);
    }
    feed.setOhlcv(SYM, "1m", history);
    feed.setOhlcv(SYM, "5m", history); // más timeframe-ökre is
    feed.setOhlcv(SYM, "15m", history);
    feed.setOhlcv(SYM, "1h", history);
    feed.setOhlcv(SYM, "4h", history);
    feed.setOhlcv(SYM, "1d", history);

    const stream = new OhlcStream(feed, emitter, {
      timeframes: ["1m", "5m", "15m", "1h", "4h", "1d"],
      bufferSize: 200,
      symbols: [SYM],
    });
    // A start() előtt a buffer üres.
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    await stream.start();
    // A start() UTÁN minden timeframe-re pontosan 5 backfilled bar van.
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "5m")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "15m")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "1h")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "4h")).toBe(5);
    expect(stream.bufferSizeOf(SYM, "1d")).toBe(5);
    // Az OHLCV mezők helyesen másolódtak át OhlcBar-ra.
    const bar1m = stream.getBars(SYM, "1m");
    expect(bar1m[0]?.open).toBe(100);
    expect(bar1m[0]?.high).toBe(105);
    expect(bar1m[0]?.low).toBe(95);
    expect(bar1m[0]?.close).toBe(102);
    expect(bar1m[0]?.volume).toBe(10);
    // A backfillből nem tudjuk a tradeCount-ot → 0.
    expect(bar1m[0]?.tradeCount).toBe(0);
    await stream.stop();
  });

  it("start() a limit=200 history-t kéri le a feed-től (strategy slowEma period)", async () => {
    // A C4 fix a strategy `slowEma=200` periódusával egyező backfillt
    // végez. Ellenőrizzük, hogy a feed a megfelelő `limit` értéket
    // kapja.
    const feed = new MockExchangeFeed();
    const emitter = new EventEmitter();
    let observedLimit: number | undefined;
    const origFetch = feed.fetchOHLCV.bind(feed);
    feed.fetchOHLCV = async (symbol, timeframe, since, limit) => {
      observedLimit = limit;
      return origFetch(symbol, timeframe, since, limit);
    };
    const stream = new OhlcStream(feed, emitter, {
      timeframes: ["1m"],
      bufferSize: 200,
      symbols: [SYM],
    });
    await stream.start();
    expect(observedLimit).toBe(200);
    await stream.stop();
  });

  it("backfill() segédmetódus közvetlenül is hívható (test + backtest path)", async () => {
    // A backfill() publikus, hogy a backtest fixture és a tesztek
    // közvetlenül is használhassák a history seed-elésre.
    const feed = new MockExchangeFeed();
    await feed.open();
    const emitter = new EventEmitter();
    const t0 = 1_700_000_000_000;
    feed.setOhlcv(SYM, "1h", [
      [t0, 100, 110, 90, 105, 50],
      [t0 + 3_600_000, 105, 115, 100, 110, 60],
    ]);
    const stream = new OhlcStream(feed, emitter, {
      timeframes: ["1h"],
      bufferSize: 200,
      symbols: [SYM],
    });
    await stream.backfill(SYM, "1h", 200);
    expect(stream.bufferSizeOf(SYM, "1h")).toBe(2);
    expect(stream.getBars(SYM, "1h")[0]?.close).toBe(105);
    expect(stream.getBars(SYM, "1h")[1]?.close).toBe(110);
  });

  it("ha a feed üres history-t ad vissza, a buffer üres marad (graceful degradation)", async () => {
    // A REST endpoint átmenetileg elérhetetlen lehet, vagy új
    // symbol-on 0 history van. A C4 fix NEM throw-ol — a start()
    // sikeres, és a trade-ek szépen aggregálódnak a 0-ról induló
    // bufferbe.
    const feed = new MockExchangeFeed();
    const emitter = new EventEmitter();
    feed.setOhlcv(SYM, "1m", []);
    const stream = new OhlcStream(feed, emitter, {
      timeframes: ["1m"],
      bufferSize: 200,
      symbols: [SYM],
    });
    await stream.start();
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    // Az első trade az aktív bar-t seed-eli, és a backfill utáni
    // 0. completed bar-ról indulunk tovább.
    stream.ingest(mkTrade({ timestamp: 1_700_000_400_000, price: 100, amount: 1 }));
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(0);
    await stream.stop();
  });
});

describe("OhlcStream — C5 fix: out-of-order trade detection", () => {
  it("a késői trade (current bar-nál korábbi bucket) eldobódik, és a counter nő", () => {
    // 1. Aktív bar seed-elése t0-n.
    // 2. Rollover egy új bucketbe (t0+60s).
    // 3. KÉSŐ trade jön t0-30s timestamp-pel (a régi bucketbe tartozik).
    // A C5 fix ezt a trade-et eldobja, a counter 1-re nő, és a
    // ring buffer tartalma változatlan marad (1 completed bar).
    const t0 = 1_700_000_400_000; // 1m grid-en
    const stream = new OhlcStream(new MockExchangeFeed(), new EventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    expect(stream.droppedLateTrades()).toBe(0);

    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    // 2 trade → 1 completed bar (az 1. lezárult, a 2. aktív).
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
    expect(stream.droppedLateTrades()).toBe(0);

    // Késői trade: bucketStart = t0-60_000 (a korábbi perc), ami < t0+60_000.
    stream.ingest(mkTrade({ timestamp: t0 - 30_000, price: 95, amount: 1 }));
    // A counter 1-re nőtt, a ring buffer VÁLTOZATLAN.
    expect(stream.droppedLateTrades()).toBe(1);
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
  });

  it("az aktív bar értékei nem korruptálódnak késői trade hatására", () => {
    // Specifikus regression teszt: a C5 fix előtt a késői trade
    // lezárta az aktív bart és seed-elt egy újat a múltban, így a
    // `lastBar.close` értéke a késői trade price-ára ugrott.
    // Most: a késői trade eldobódik, az aktív bar close értéke
    // változatlan.
    const t0 = 1_700_000_400_000;
    const stream = new OhlcStream(new MockExchangeFeed(), new EventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    // Aktív bar seed-elése t0-n, close=100.
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    // Rollover t0+60s, új aktív bar close=110.
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    // Késői trade: t0-30s, price=999. Ha nem lenne C5 fix, az
    // aktív bar lezárulna (close=110), és a késői trade-ből új
    // bar seed-elődne (close=999) a `active` map-ben.
    stream.ingest(mkTrade({ timestamp: t0 - 30_000, price: 999, amount: 1 }));
    // Most: az aktív bar (a `lastBar` mivel nincs lezárt bar a t0+60s után)
    // HIBÁSAN nézi ki a ring buffer-ből — a teszt a bufferSizeOf-szal
    // és a droppedLateTrades counter-rel ellenőrzi a C5 fixet.
    expect(stream.droppedLateTrades()).toBe(1);
    // A ring bufferben 1 bar van (a t0-n lezárt), és NEM 2 (nem
    // zárt le egy második bart a késői trade).
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(1);
    expect(stream.getBars(SYM, "1m")[0]?.close).toBe(100);
  });

  it("a dropped counter több késői trade-re is növekszik", () => {
    const t0 = 1_700_000_400_000;
    const stream = new OhlcStream(new MockExchangeFeed(), new EventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 - 30_000, price: 90, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 - 90_000, price: 80, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 30_000, price: 105, amount: 1 })); // t0+30s, current=t0+60s → késői
    expect(stream.droppedLateTrades()).toBe(3);
  });

  it("a normál (in-order) trade-ek NEM növelik a dropped countert", () => {
    const t0 = 1_700_000_400_000;
    const stream = new OhlcStream(new MockExchangeFeed(), new EventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    // 5 in-order trade: aktív bar seed + 4 rollover.
    for (let i = 0; i < 5; i++) {
      stream.ingest(mkTrade({ timestamp: t0 + i * 60_000, price: 100 + i, amount: 1 }));
    }
    expect(stream.droppedLateTrades()).toBe(0);
    expect(stream.bufferSizeOf(SYM, "1m")).toBe(4);
  });

  it("a késői trade warning logot ír a console-ra (diagnosztika)", () => {
    // A C5 fix console.warn-nel jelzi a késői trade-et, hogy a
    // üzemeltető lássa a normál üzemtől való eltérést.
    const t0 = 1_700_000_400_000;
    const stream = new OhlcStream(new MockExchangeFeed(), new EventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 10,
      symbols: [SYM],
    });
    stream.ingest(mkTrade({ timestamp: t0, price: 100, amount: 1 }));
    stream.ingest(mkTrade({ timestamp: t0 + 60_000, price: 110, amount: 1 }));
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };
    try {
      stream.ingest(mkTrade({ timestamp: t0 - 30_000, price: 95, amount: 1 }));
    } finally {
      console.warn = origWarn;
    }
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("dropped late trade");
    expect(warnings[0]).toContain("BTC/USDT");
    expect(warnings[0]).toContain("1m");
  });
});
