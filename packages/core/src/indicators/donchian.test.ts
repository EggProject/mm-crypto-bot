// packages/core/src/indicators/donchian.test.ts — Donchian csatorna unit-tesztek
//
// 100%-os coverage: empty, period<=0, warmup, normál, last.
//
// Specifikáció: docs/research/selected-strategy.md §2, §4.1.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { donchian, lastDonchian } from "./donchian.js";

function mkCandle(high: number, low: number): Candle {
  return { timestamp: 0, open: 0, high, low, close: 0, volume: 0 };
}

describe("donchian", () => {
  it("üres candle-sorozatra üres tömböt ad vissza", () => {
    expect(donchian([], 20)).toEqual([]);
  });

  it("period <= 0 esetén üres tömböt ad vissza", () => {
    expect(donchian([mkCandle(1, 1)], 0)).toEqual([]);
    expect(donchian([mkCandle(1, 1)], -1)).toEqual([]);
  });

  it("a bemelegedési periódusban undefined értékeket ad", () => {
    // period=3: az első 2 elemben nincs elég adat, a seed a 2. indexen.
    const out = donchian(
      [mkCandle(1, 1), mkCandle(2, 2), mkCandle(3, 3), mkCandle(4, 4)],
      3,
    );
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
  });

  it("az első Donchian-érték a teljes seed-ablak szélsőértéke", () => {
    // period=3, candles high=[10,12,14,16], low=[5,6,7,8].
    // A seed (2. index) a [10,12,14] ablakbol szamol: upper=14, lower=5.
    const out = donchian(
      [mkCandle(10, 5), mkCandle(12, 6), mkCandle(14, 7), mkCandle(16, 8)],
      3,
    );
    expect(out[2]!.upper).toBe(14);
    expect(out[2]!.lower).toBe(5);
  });

  it("a rolling-ablak helyesen tolódik", () => {
    // period=3: out[2] (seed) ablak [10, 12, 14] → upper=14, lower=5.
    // out[3]: ablak [12, 14, 16] → upper=16, lower=6.
    // out[4]: ablak [14, 16, 18] → upper=18, lower=7.
    const out = donchian(
      [mkCandle(10, 5), mkCandle(12, 6), mkCandle(14, 7), mkCandle(16, 8), mkCandle(18, 9)],
      3,
    );
    expect(out[2]!.upper).toBe(14);
    expect(out[2]!.lower).toBe(5);
    expect(out[3]!.upper).toBe(16);
    expect(out[3]!.lower).toBe(6);
    expect(out[4]!.upper).toBe(18);
    expect(out[4]!.lower).toBe(7);
  });

  it("ha a candle-sor hossza < period, minden undefined", () => {
    const out = donchian([mkCandle(1, 1)], 5);
    expect(out[0]).toBeUndefined();
  });

  it("a rolling-ablak a legnagyobb high-t és a legkisebb low-t veszi (nem feltétlenül az utolsó)", () => {
    // Nem-monoton candle-sor: a high és low az ablakon belül bárhol lehet.
    // candle 0: high=10, low=5
    // candle 1: high=15, low=3  (max high, min low)
    // candle 2: high=12, low=8
    // A period=3-mal az out[2] (seed) window [10,15,12] / [5,3,8]: upper=15, lower=3.
    const out = donchian(
      [mkCandle(10, 5), mkCandle(15, 3), mkCandle(12, 8)],
      3,
    );
    expect(out[2]!.upper).toBe(15);
    expect(out[2]!.lower).toBe(3);
  });
});

describe("lastDonchian", () => {
  it("üres sorra undefined-ot ad", () => {
    expect(lastDonchian([])).toBeUndefined();
  });

  it("csupa undefined sorra undefined-ot ad", () => {
    expect(lastDonchian([undefined, undefined])).toBeUndefined();
  });

  it("a sor legutolsó definiált értékét adja", () => {
    const v = { upper: 1, lower: 0 };
    expect(lastDonchian([undefined, v, undefined])).toBe(v);
  });
});
