// packages/core/src/indicators/atr.test.ts — ATR indikátor unit-tesztek
//
// 100%-os coverage: empty, period<=0, single candle, warmup, normál,
// last. A TR (True Range) számítása a high/low/prev_close alapján történik.
//
// Specifikáció: docs/research/selected-strategy.md §2.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { atr, lastAtr } from "./atr.js";

function mkCandle(open: number, high: number, low: number, close: number): Candle {
  return { timestamp: 0, open, high, low, close, volume: 0 };
}

describe("atr", () => {
  it("üres candle-sorozatra üres tömböt ad vissza", () => {
    expect(atr([], 14)).toEqual([]);
  });

  it("period <= 0 esetén üres tömböt ad vissza", () => {
    expect(atr([mkCandle(10, 10, 10, 10)], 0)).toEqual([]);
    expect(atr([mkCandle(10, 10, 10, 10)], -1)).toEqual([]);
  });

  it("egyetlen candle esetén undefined (nincs prev_close)", () => {
    // Az első elemben nincs TR-mert nincs előző záróár.
    const out = atr([mkCandle(10, 10, 10, 10)], 3);
    expect(out[0]).toBeUndefined();
  });

  it("a bemelegedési periódusban undefined", () => {
    // Az első `period` elemben az ATR még nem definiált. A seed a `period`. indexen.
    const candles: Candle[] = [];
    for (let i = 0; i < 5; i++) {
      candles.push(mkCandle(10, 11, 9, 10 + i));
    }
    const out = atr(candles, 3);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
  });

  it("a seed-ablak átlaga az első ATR-érték", () => {
    // period=2; candles 10→11 (high=11, low=9, prev_close=10: TR = max(2, 1, 1) = 2)
    //           11→12 (high=12, low=9, prev_close=11: TR = max(3, 1, 2) = 3)
    // Seed = (2+3)/2 = 2.5; a seed out[period] = out[2].
    const candles = [mkCandle(10, 10, 10, 10), mkCandle(10, 11, 9, 11), mkCandle(11, 12, 9, 12)];
    const out = atr(candles, 2);
    expect(out[2]).toBe(2.5);
  });

  it("Wilder-simítás a seed után", () => {
    // period=2; az elso ATR=2.5. Kovetkezo candle: high=14, low=8, close=14,
    // prev=12; TR = max(14-8=6, |14-12|=2, |8-12|=4) = 6.
    // ATR = (2.5 * 1 + 6) / 2 = 4.25.
    const candles = [
      mkCandle(10, 10, 10, 10),
      mkCandle(10, 11, 9, 11),
      mkCandle(11, 12, 9, 12),
      mkCandle(12, 14, 8, 14),
    ];
    const out = atr(candles, 2);
    expect(out[2]).toBe(2.5);
    expect(out[3]).toBe(4.25);
  });

  it("ha a candle-sor hossza <= period, minden undefined", () => {
    // Kevesebb vagy egyenlő adat, mint a seed-ablak.
    const candles = [mkCandle(10, 10, 10, 10), mkCandle(10, 11, 9, 11)];
    const out = atr(candles, 5);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
  });
});

describe("lastAtr", () => {
  it("üres sorra undefined-ot ad", () => {
    expect(lastAtr([])).toBeUndefined();
  });

  it("csupa undefined sorra undefined-ot ad", () => {
    expect(lastAtr([undefined, undefined])).toBeUndefined();
  });

  it("a sor legutolsó definiált értékét adja", () => {
    expect(lastAtr([1, 2, undefined, 3, undefined])).toBe(3);
  });
});
