// packages/core/src/indicators/rsi.test.ts — RSI indikátor unit-tesztek
//
// 100%-os coverage: minden ág (empty, period<=0, all-up, all-down,
// avgLoss===0, avgGain===0, last).
//
// Specifikáció: docs/research/selected-strategy.md §2.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { lastRsi, rsi } from "./rsi.js";

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

describe("rsi", () => {
  it("üres candle-sorozatra üres tömböt ad vissza", () => {
    expect(rsi([], 14)).toEqual([]);
  });

  it("period <= 0 esetén üres tömböt ad vissza", () => {
    expect(rsi(mkCandles([1, 2, 3]), 0)).toEqual([]);
    expect(rsi(mkCandles([1, 2, 3]), -3)).toEqual([]);
  });

  it("a bemelegedési periódusban undefined értékeket ad", () => {
    // Az első `period` elemben nincs elég változás. A seed a `period`. indexen.
    const out = rsi(mkCandles([10, 11, 12, 13, 14, 15]), 3);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
  });

  it("ha a candle-sor hossza <= period+1, minden undefined", () => {
    // A guard-ág: kevesebb adat, mint amennyi a seed-hez kell.
    const out = rsi(mkCandles([1, 2, 3]), 5);
    expect(out).toEqual([undefined, undefined, undefined]);
  });

  it("minden növekvő close: avgLoss = 0, RSI = 100", () => {
    // Minden lépés nyereség → avgLoss = 0 → RSI = 100.
    const out = rsi(mkCandles([10, 11, 12, 13, 14, 15, 16, 17]), 3);
    // A seed a period (3). indexen — a 4. indextől kezdve minden 100.
    expect(out[3]).toBe(100);
    expect(out[4]).toBe(100);
    expect(out[5]).toBe(100);
    expect(out[6]).toBe(100);
    expect(out[7]).toBe(100);
  });

  it("minden csökkenő close: avgGain = 0, RSI = 0", () => {
    // Minden lépés veszteség → avgGain = 0 → rs = 0 → RSI = 0.
    const out = rsi(mkCandles([17, 16, 15, 14, 13, 12, 11, 10]), 3);
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(0);
    expect(out[5]).toBe(0);
  });

  it("váltakozó up/down mozgások: a klasszikus Wilder-számítás", () => {
    // closes: 10, 12, 14, 12, 10, 8, 10, 12, period=3.
    // Változások: +2, +2, -2, -2, -2, +2, +2.
    // Seed (period=3): gain = (2+2+0)/3 = 4/3; loss = (0+0+2)/3 = 2/3.
    // RS = 2; RSI = 100 - 100/3 = 66.666...
    const out = rsi(mkCandles([10, 12, 14, 12, 10, 8, 10, 12]), 3);
    expect(out[3]).toBeCloseTo(66.6666666667, 5);
  });

  it("változatlan close-ok: avgGain = 0 és avgLoss = 0 → RSI = 50", () => {
    // Ha minden close azonos, nincs sem nyereség sem veszteség → RSI = 50
    // (a semleges zóna). Ez a computeRsi belső `avgGain === 0` ágát is
    // teszteli (avgLoss === 0 && avgGain === 0).
    const out = rsi(mkCandles([10, 10, 10, 10, 10, 10, 10]), 3);
    // Az első definiált érték a period (3). indexen.
    expect(out[3]).toBe(50);
    expect(out[4]).toBe(50);
    expect(out[5]).toBe(50);
    expect(out[6]).toBe(50);
  });
});

describe("lastRsi", () => {
  it("üres sorra undefined-ot ad", () => {
    expect(lastRsi([])).toBeUndefined();
  });

  it("csupa undefined sorra undefined-ot ad", () => {
    expect(lastRsi([undefined, undefined])).toBeUndefined();
  });

  it("a sor legutolsó definiált értékét adja", () => {
    expect(lastRsi([undefined, 1, 2, undefined, 3])).toBe(3);
  });
});
