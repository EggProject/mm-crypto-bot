// packages/core/src/indicators/adx.test.ts — ADX indikátor unit-tesztek
//
// 100%-os coverage: empty, period<=0, warmup, normál (DX + ADX),
// TR=0 edge case, last.
//
// Specifikáció: docs/research/selected-strategy.md §2.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { adx, lastAdx } from "./adx.js";

function mkCandle(open: number, high: number, low: number, close: number): Candle {
  return { timestamp: 0, open, high, low, close, volume: 0 };
}

describe("adx", () => {
  it("üres candle-sorozatra üres tömböt ad vissza", () => {
    expect(adx([], 14)).toEqual([]);
  });

  it("period <= 0 esetén üres tömböt ad vissza", () => {
    expect(adx([mkCandle(10, 10, 10, 10)], 0)).toEqual([]);
    expect(adx([mkCandle(10, 10, 10, 10)], -1)).toEqual([]);
  });

  it("ha a candle-sor hossza <= period+1, minden undefined", () => {
    // Kevesebb vagy egyenlő adat, mint a seed-ablak.
    const out = adx([mkCandle(10, 10, 10, 10), mkCandle(10, 11, 9, 11)], 5);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
  });

  it("a bemelegedési periódusban undefined értékeket ad", () => {
    // Az első `period+1` elemben az ADX még nem definiált. A seed (első DX)
    // a `period+1`. indexen.
    const candles: Candle[] = [];
    for (let i = 0; i < 6; i++) {
      candles.push(mkCandle(10, 11, 9, 10 + i));
    }
    const out = adx(candles, 3);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
    expect(out[3]).toBeUndefined();
  });

  it("erős uptrendben az ADX magas (közel 100)", () => {
    // Erős uptrend: minden lépésben high felfelé, low felfelé, prev_close felfelé.
    // +DM = high - prev_high; -DM = prev_low - low; a +DM dominál.
    // +DI közel 100, -DI közel 0 → DX közel 100 → ADX magas.
    const candles: Candle[] = [];
    let price = 10;
    for (let i = 0; i < 30; i++) {
      candles.push(mkCandle(price, price + 1, price - 0.5, price + 1));
      price += 1;
    }
    const out = adx(candles, 14);
    // Az utolsó értéknek magasnak kell lennie (50+).
    const last = out[out.length - 1];
    expect(last).toBeDefined();
    expect(last!).toBeGreaterThan(50);
  });

  it("erős downtrendben az ADX szintén magas", () => {
    // Erős downtrend: minden lépésben high lefelé, low lefelé.
    // -DM = prev_low - low; a -DM dominál.
    // -DI közel 100, +DI közel 0 → DX közel 100 → ADX magas.
    // Ez a teszt a `down > up && down > 0` true ágat is ellenőrzi.
    const candles: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 30; i++) {
      candles.push(mkCandle(price, price + 0.5, price - 1, price - 1));
      price -= 1;
    }
    const out = adx(candles, 14);
    // Az utolsó értéknek magasnak kell lennie.
    const last = out[out.length - 1];
    expect(last).toBeDefined();
    expect(last!).toBeGreaterThan(50);
  });

  it("TR=0 esetén +DI/-DI 0 és DX 0 (a division-by-zero guard)", () => {
    // Ha minden candle high=low=close (nincs mozgás), a TR=0, a +DI/-DI=0, a DX=0.
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      candles.push(mkCandle(10, 10, 10, 10));
    }
    const out = adx(candles, 14);
    // A period+1 (=15). indextől minden 0.
    for (let i = 15; i < out.length; i++) {
      expect(out[i]).toBe(0);
    }
  });
});

describe("lastAdx", () => {
  it("üres sorra undefined-ot ad", () => {
    expect(lastAdx([])).toBeUndefined();
  });

  it("csupa undefined sorra undefined-ot ad", () => {
    expect(lastAdx([undefined, undefined])).toBeUndefined();
  });

  it("a sor legutolsó definiált értékét adja", () => {
    expect(lastAdx([1, 2, undefined, 3, undefined])).toBe(3);
  });
});
