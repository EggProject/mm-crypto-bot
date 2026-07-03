// packages/core/src/indicators/volume-ma.test.ts — Volume MA unit-tesztek
//
// 100%-os coverage: empty, period<=0, warmup, normál, last.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { lastVolumeMa, volumeMa } from "./volume-ma.js";

function mkCandles(volumes: readonly number[]): Candle[] {
  return volumes.map((v) => ({
    timestamp: 0,
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: v,
  }));
}

describe("volumeMa", () => {
  it("üres candle-sorozatra üres tömböt ad vissza", () => {
    expect(volumeMa([], 20)).toEqual([]);
  });

  it("period <= 0 esetén üres tömböt ad vissza", () => {
    expect(volumeMa(mkCandles([1, 2, 3]), 0)).toEqual([]);
    expect(volumeMa(mkCandles([1, 2, 3]), -5)).toEqual([]);
  });

  it("a bemelegedési periódusban undefined értékeket ad", () => {
    // period=3: az első 2 elemben nincs elég adat, a seed a 2. indexen.
    const out = volumeMa(mkCandles([10, 20, 30, 40, 50]), 3);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
  });

  it("az első Volume MA-érték a seed-ablak átlaga", () => {
    // period=2, volumes [10, 20, 30, 40]: a seed (out[1]) = (10+20)/2=15.
    // out[2] = (20+30)/2=25. out[3] = (30+40)/2=35.
    const out = volumeMa(mkCandles([10, 20, 30, 40]), 2);
    expect(out[1]).toBe(15);
    expect(out[2]).toBe(25);
    expect(out[3]).toBe(35);
  });

  it("ha a candle-sor hossza < period, minden undefined", () => {
    const out = volumeMa(mkCandles([1, 2]), 5);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
  });
});

describe("lastVolumeMa", () => {
  it("üres sorra undefined-ot ad", () => {
    expect(lastVolumeMa([])).toBeUndefined();
  });

  it("csupa undefined sorra undefined-ot ad", () => {
    expect(lastVolumeMa([undefined, undefined])).toBeUndefined();
  });

  it("a sor legutolsó definiált értékét adja", () => {
    expect(lastVolumeMa([1, 2, undefined, 3, undefined])).toBe(3);
  });
});
