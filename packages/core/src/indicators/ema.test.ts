// packages/core/src/indicators/ema.test.ts — EMA indikátor unit-tesztek
//
// A 100%-os coverage érdekében minden ágat (empty, period<=0, warmup,
// normál számítás, last) meg kell érinteni.
//
// Specifikáció: docs/research/selected-strategy.md §2.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { ema, lastEma } from "./ema.js";

/**
 `mkCandles` — egyszerű OHLCV candle-sor gyártó. Az ema-hoz csak a
 `close` mező számít; a többi `0`. A `start` a kiinduló záróár.
*/
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

describe("ema", () => {
  it("üres candle-sorozatra üres tömböt ad vissza", () => {
    // Az empty-input ág: a backtest motor üres feed-re is működjön.
    expect(ema([], 14)).toEqual([]);
  });

  it("period <= 0 esetén üres tömböt ad vissza", () => {
    // A guard-ág: érvénytelen paraméter.
    expect(ema(mkCandles([1, 2, 3]), 0)).toEqual([]);
    expect(ema(mkCandles([1, 2, 3]), -5)).toEqual([]);
  });

  it("a bemelegedési periódusban undefined értékeket ad", () => {
    // Az első `period - 1` elemben az EMA még nem definiált — a seed a
    // `period - 1`. indexre esik.
    const out = ema(mkCandles([10, 11, 12, 13, 14, 15]), 3);
    expect(out.length).toBe(6);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
  });

  it("az első EMA-érték a seed-átlag (első `period` elem átlaga)", () => {
    // A seed: (10 + 11 + 12) / 3 = 11.
    const out = ema(mkCandles([10, 11, 12, 13, 14, 15]), 3);
    expect(out[2]).toBe(11);
  });

  it("a további EMA-értékek rekurzívan számolódnak (k = 2/(period+1))", () => {
    // period=2, k=2/3; a seed = (10+11)/2 = 10.5; out[1] = 10.5.
    // out[2] = close[2] * (2/3) + out[1] * (1/3) = 12 * 2/3 + 10.5 * 1/3
    //        = 8 + 3.5 = 11.5
    const out = ema(mkCandles([10, 11, 12, 13, 14, 15]), 2);
    expect(out[1]).toBe(10.5);
    expect(out[2]).toBeCloseTo(11.5, 5);
  });

  it("a candle-sor hossza < period — minden undefined", () => {
    // A guard-ág: kevesebb adat, mint a periódus.
    const out = ema(mkCandles([1, 2, 3]), 5);
    expect(out).toEqual([undefined, undefined, undefined]);
  });

  it("period=1 esetén az EMA a záróár (k=1, azonnali)", () => {
    // period=1: k = 2/(1+1) = 1; a warmup 0 elem (period-1=0), a seed
    // out[0] = 10. A recursive step out[1] = 20 * 1 + 10 * 0 = 20.
    const out = ema(mkCandles([10, 20, 30]), 1);
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(20);
    expect(out[2]).toBe(30);
  });
});

describe("lastEma", () => {
  it("üres sorra undefined-ot ad", () => {
    expect(lastEma([])).toBeUndefined();
  });

  it("csupa undefined sorra undefined-ot ad", () => {
    expect(lastEma([undefined, undefined])).toBeUndefined();
  });

  it("a sor legutolsó definiált értékét adja (tail-skip)", () => {
    expect(lastEma([undefined, 1, 2, undefined, 3])).toBe(3);
    // A második `undefined`-ig visszafelé haladva a 3 az utolsó definiált.
    expect(lastEma([undefined, 1, 2, undefined, 3, undefined])).toBe(3);
  });
});
