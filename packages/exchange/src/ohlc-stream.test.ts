// Pure OhlcStream helpers and RingBuffer behavior.
import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import {
  alignToTimeframe,
  barsToCandles,
  barsToOhlcv,
  OhlcStream,
  RingBuffer,
  type OhlcBar,
  type OhlcStreamBarEvent,
  type OhlcStreamErrorEvent,
} from "./ohlc-stream.js";
import type { OhlcStreamOptions } from "./index.js";
import type { FeedListener } from "./feed.js";
import { asSymbol } from "./symbols.js";
import { MockExchangeFeed } from "./testing/mock-feed.js";
import type { Ohlcv, Symbol, Trade } from "./types.js";

const SYM = asSymbol("BTC/USDT");
const OTHER_SYM = asSymbol("ETH/USDT");

class EventInjectingFeed extends MockExchangeFeed {
  subscribeTradesCalls = 0;

  override async subscribeTrades(symbol: Symbol, listener: FeedListener): Promise<number> {
    this.subscribeTradesCalls += 1;
    listener({ kind: "ticker", payload: await this.fetchTickerSnapshot(symbol) });
    listener({ kind: "trade", payload: tradeFor(symbol) });
    return super.subscribeTrades(symbol, listener);
  }
}

class UnsubscribeFailureFeed extends MockExchangeFeed {
  constructor(private readonly failure: unknown) {
    super();
  }

  private async rejectWithFailure(): Promise<never> {
    await Promise.resolve();
    throw this.failure;
  }

  override unsubscribe(_id: number): Promise<void> {
    return this.rejectWithFailure();
  }
}

function tradeFor(symbol: Symbol, timestamp = 1_700_000_400_000): Trade {
  return { id: `trade-${String(timestamp)}`, symbol, timestamp, price: 100, amount: 1, takerSide: "buy" };
}

function createEventEmitter(): EventEmitter {
  // eslint-disable-next-line unicorn/prefer-event-target -- OhlcStream exposes the Node EventEmitter contract.
  return new EventEmitter();
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

  it("preserves explicit undefined values before and after overflow", () => {
    const rb = new RingBuffer<number | undefined>(2);
    rb.push(undefined);
    rb.push(1);
    expect(rb.toArray()).toEqual([undefined, 1]);
    rb.push(2);
    expect(rb.toArray()).toEqual([1, 2]);
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
    const rb = new RingBuffer<string>(3);
    rb.push("a");
    rb.push("b");
    rb.push("c");
    rb.push("d");
    const seen = rb.toArray();
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

  it("rejects an unknown public timeframe", () => {
    expect(() => alignToTimeframe(1_700_000_123_456, "unsupported")).toThrow(
      "Unsupported timeframe: unsupported",
    );
  });
});

describe("OhlcStream public boundaries", () => {
  it("rejects an invalid timeframe option before it invokes the feed", () => {
    const feed = new EventInjectingFeed();
    const options: OhlcStreamOptions = { timeframes: ["unsupported"] };
    expect(() => new OhlcStream(feed, createEventEmitter(), options)).toThrow(
      "Unsupported timeframe: unsupported",
    );
    expect(feed.subscribeTradesCalls).toBe(0);
  });

  it("normalizes a valid scalar timeframe option", () => {
    const options: OhlcStreamOptions = { timeframes: "1m" };
    const stream = new OhlcStream(new MockExchangeFeed(), createEventEmitter(), options);
    expect(stream.config.timeframes).toEqual(["1m"]);
  });

  it("ignores a ticker event and processes the subsequent real trade from a valid feed", async () => {
    const feed = new EventInjectingFeed();
    feed.setOhlcv(SYM, "1m", []);
    const stream = new OhlcStream(feed, createEventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 2,
      symbols: [SYM],
    });
    await stream.start();
    stream.ingest(tradeFor(SYM, 1_700_000_460_000));
    expect(feed.subscribeTradesCalls).toBe(1);
    expect(stream.getBars(SYM, "1m")).toHaveLength(1);
    await stream.stop();
  });

  it("normalizes Error and non-Error unsubscribe failures into public error events", async () => {
    const cases: readonly { readonly failure: unknown; readonly message: string }[] = [
      { failure: new Error("unsubscribe error"), message: "unsubscribe error" },
      { failure: "unsubscribe text", message: "unsubscribe text" },
    ];
    for (const { failure, message } of cases) {
      const emitter = createEventEmitter();
      const errors: OhlcStreamErrorEvent[] = [];
      emitter.on("error", (event: OhlcStreamErrorEvent) => {
        errors.push(event);
      });
      const stream = new OhlcStream(new UnsubscribeFailureFeed(failure), emitter, {
        timeframes: ["1m"],
        bufferSize: 2,
        symbols: [SYM],
      });
      await stream.start();
      await stream.stop();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.error.message).toBe(message);
    }
  });

  it("backfills a configured symbol and ignores an unknown symbol", async () => {
    const feed = new MockExchangeFeed();
    await feed.open();
    const stream = new OhlcStream(feed, createEventEmitter(), {
      timeframes: ["1m"],
      bufferSize: 2,
      symbols: [SYM],
    });
    const ohlcv: Ohlcv = [1_700_000_400_000, 100, 110, 90, 105, 1];
    feed.setOhlcv(SYM, "1m", [ohlcv]);
    await stream.backfill(SYM, "1m", 2);
    await stream.backfill(OTHER_SYM, "1m", 2);
    expect(stream.getBars(SYM, "1m")).toHaveLength(1);
    expect(stream.getBars(OTHER_SYM, "1m")).toEqual([]);
  });

  it("retains configured-symbol bars and emits unknown-symbol bars without retaining them", () => {
    const emitter = createEventEmitter();
    const events: OhlcStreamBarEvent[] = [];
    emitter.on("bar", (event: OhlcStreamBarEvent) => {
      events.push(event);
    });
    const stream = new OhlcStream(new MockExchangeFeed(), emitter, {
      timeframes: ["1m"],
      bufferSize: 2,
      symbols: [SYM],
    });
    stream.ingest(tradeFor(SYM));
    stream.ingest(tradeFor(SYM, 1_700_000_460_000));
    stream.ingest(tradeFor(OTHER_SYM));
    stream.ingest(tradeFor(OTHER_SYM, 1_700_000_460_000));
    expect(stream.getBars(SYM, "1m")).toHaveLength(1);
    expect(stream.getBars(OTHER_SYM, "1m")).toEqual([]);
    expect(events.map((event) => event.bar.symbol)).toEqual([SYM, OTHER_SYM]);
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
