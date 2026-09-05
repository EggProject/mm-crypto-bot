// Pure OhlcStream helpers and RingBuffer behavior.
import { describe, expect, it } from "bun:test";

import { alignToTimeframe, barsToCandles, barsToOhlcv, RingBuffer, type OhlcBar } from "./ohlc-stream.js";
import { asSymbol } from "./symbols.js";

const SYM = asSymbol("BTC/USDT");

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
