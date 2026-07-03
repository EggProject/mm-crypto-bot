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

  it("a bemelegedési periódusban undefined értékeket ad (previous-bar-exclusive)", () => {
    // period=3: az első 3 elemben nincs elég previous-N adat.
    // Csak out[3]-tol vannak definialt ertekek.
    const out = donchian(
      [mkCandle(1, 1), mkCandle(2, 2), mkCandle(3, 3), mkCandle(4, 4)],
      3,
    );
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
    expect(out[3]).toBeDefined();
  });

  it("az első Donchian-érték a previous-N-period-slot-bol szamolodik", () => {
    // period=3, candles high=[10,12,14,16], low=[5,6,7,8].
    // A previous-bar-exclusive convention: out[2] = undefined (warmup = 3),
    // out[3] a [10,12,14] (az előző 3 candle) ablakbol szamol: upper=14, lower=5.
    // A current candle (16) nincs benne, mert a close <= high <= 4-period-max mindig,
    // igy a breakout-comparison (close > upper) csak igy lehet ervenyes.
    const out = donchian(
      [mkCandle(10, 5), mkCandle(12, 6), mkCandle(14, 7), mkCandle(16, 8)],
      3,
    );
    expect(out[2]).toBeUndefined();
    expect(out[3]!.upper).toBe(14);
    expect(out[3]!.lower).toBe(5);
  });

  it("a rolling-ablak helyesen tolódik (previous-bar-exclusive)", () => {
    // period=3: out[3] ablak [10, 12, 14] → upper=14, lower=5.
    // out[4] ablak [12, 14, 16] → upper=16, lower=6.
    // (out[5] a [14, 16, 18] → upper=18, lower=7, de nincs elég candle.)
    const out = donchian(
      [mkCandle(10, 5), mkCandle(12, 6), mkCandle(14, 7), mkCandle(16, 8), mkCandle(18, 9)],
      3,
    );
    expect(out[3]!.upper).toBe(14);
    expect(out[3]!.lower).toBe(5);
    expect(out[4]!.upper).toBe(16);
    expect(out[4]!.lower).toBe(6);
  });

  it("ha a candle-sor hossza < period, minden undefined", () => {
    const out = donchian([mkCandle(1, 1)], 5);
    expect(out[0]).toBeUndefined();
  });

  it("a rolling-ablak a legnagyobb high-t és a legkisebb low-t veszi (previous-bar-exclusive)", () => {
    // Nem-monoton candle-sor: a high és low az ablakon belül bárhol lehet.
    // candle 0: high=10, low=5
    // candle 1: high=15, low=3  (max high, min low)
    // candle 2: high=12, low=8
    // candle 3: high=14, low=9 (4. candle kell, mert period=3)
    // A period=3-mal az out[3] window [10,15,12] / [5,3,8]: upper=15, lower=3.
    const out = donchian(
      [mkCandle(10, 5), mkCandle(15, 3), mkCandle(12, 8), mkCandle(14, 9)],
      3,
    );
    expect(out[3]!.upper).toBe(15);
    expect(out[3]!.lower).toBe(3);
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
