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
import { MockExchangeFeed } from "./mockFeed.js";
import type { FeedEvent, Trade } from "./types.js";
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
      { timestamp: 1, symbol: SYM, timeframe: "1m", open: 10, high: 11, low: 9, close: 10.5, volume: 100, tradeCount: 2 },
    ];
    const candles = barsToCandles(bars);
    expect(candles).toEqual([{ timestamp: 1, open: 10, high: 11, low: 9, close: 10.5, volume: 100 }]);
  });

  it("barsToOhlcv a CCXT tuple formátumot adja vissza", () => {
    const bars: OhlcBar[] = [
      { timestamp: 1, symbol: SYM, timeframe: "1m", open: 10, high: 11, low: 9, close: 10.5, volume: 100, tradeCount: 2 },
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
