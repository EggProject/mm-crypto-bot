// packages/core/src/indicators/bb.test.ts — Bollinger Bands unit-tesztek
//
// 100%-os coverage: empty, period<=0, warmup, normál, last.
//
// Specifikáció: docs/research/selected-strategy.md §2.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { bb, lastBb } from "./bb.js";

function mkCandles(closes: readonly number[]): Candle[] {
  return closes.map((c) => ({
    timestamp: 0,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 0,
  }));
}

describe("bb", () => {
  it("üres candle-sorozatra üres tömböt ad vissza", () => {
    expect(bb([], 20, 2)).toEqual([]);
  });

  it("period <= 0 esetén üres tömböt ad vissza", () => {
    expect(bb(mkCandles([1, 2, 3]), 0, 2)).toEqual([]);
    expect(bb(mkCandles([1, 2, 3]), -5, 2)).toEqual([]);
  });

  it("a bemelegedési periódusban undefined értékeket ad", () => {
    // Az első `period - 1` elemben nincs elég adat az ablakhoz. A seed a
    // `period - 1`. indexen van.
    const out = bb(mkCandles([10, 11, 12, 13, 14, 15]), 3, 2);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
  });

  it("az első BB-érték a seed-ablak átlaga és szórása", () => {
    // period=3, closes [10, 12, 14, 16, 18]: a seed a 2. indexen (period-1=2).
    // window [10, 12, 14]: mean=12, var=((10-12)^2+(12-12)^2+(14-12)^2)/3
    // = (4+0+4)/3 = 8/3, stddev = sqrt(8/3) ≈ 1.63299
    // upper = 12 + 2*1.63299 = 15.26598
    // lower = 12 - 2*1.63299 = 8.73402
    const out = bb(mkCandles([10, 12, 14, 16, 18]), 3, 2);
    expect(out[2]!.middle).toBe(12);
    expect(out[2]!.upper).toBeCloseTo(15.265986, 4);
    expect(out[2]!.lower).toBeCloseTo(8.734014, 4);
  });

  it("a rolling-ablak helyesen tolódik", () => {
    // period=2; closes [10, 12, 14, 16].
    // out[1] (seed): window [10, 12], mean=11, var=1, stddev=1, upper=13, lower=9.
    // out[2]: window [12, 14], mean=13, stddev=1, upper=15, lower=11.
    // out[3]: window [14, 16], mean=15, stddev=1, upper=17, lower=13.
    const out = bb(mkCandles([10, 12, 14, 16]), 2, 2);
    expect(out[1]!.middle).toBe(11);
    expect(out[1]!.upper).toBe(13);
    expect(out[1]!.lower).toBe(9);
    expect(out[2]!.middle).toBe(13);
    expect(out[2]!.upper).toBe(15);
    expect(out[2]!.lower).toBe(11);
    expect(out[3]!.middle).toBe(15);
    expect(out[3]!.upper).toBe(17);
    expect(out[3]!.lower).toBe(13);
  });

  it("ha a candle-sor hossza < period, minden undefined", () => {
    const out = bb(mkCandles([1, 2]), 5, 2);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
  });
});

describe("lastBb", () => {
  it("üres sorra undefined-ot ad", () => {
    expect(lastBb([])).toBeUndefined();
  });

  it("csupa undefined sorra undefined-ot ad", () => {
    expect(lastBb([undefined, undefined])).toBeUndefined();
  });

  it("a sor legutolsó definiált értékét adja", () => {
    const v = { middle: 1, upper: 2, lower: 0 };
    expect(lastBb([undefined, v, undefined])).toBe(v);
  });
});
