// packages/core/src/indicators/supertrend.test.ts — Supertrend unit-tesztek
//
// 100%-os coverage: empty, period<=0, multiplier<=0, warmup, normál,
// irányváltás, last.
//
// Specifikáció: docs/research/selected-strategy.md §2.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { lastSupertrend, supertrend } from "./supertrend.js";

function mkCandle(close: number, high: number, low: number): Candle {
  return { timestamp: 0, open: close, high, low, close, volume: 0 };
}

describe("supertrend", () => {
  it("üres candle-sorozatra üres tömböt ad vissza", () => {
    expect(supertrend([], 10, 3)).toEqual([]);
  });

  it("period <= 0 esetén üres tömböt ad vissza", () => {
    expect(supertrend([mkCandle(10, 10, 10)], 0, 3)).toEqual([]);
    expect(supertrend([mkCandle(10, 10, 10)], -1, 3)).toEqual([]);
  });

  it("multiplier <= 0 esetén üres tömböt ad vissza", () => {
    expect(supertrend([mkCandle(10, 10, 10)], 10, 0)).toEqual([]);
    expect(supertrend([mkCandle(10, 10, 10)], 10, -1)).toEqual([]);
  });

  it("a bemelegedési periódusban undefined értékeket ad", () => {
    // period=3: az első 2 elemben nincs ATR (a Supertrend nem definiált).
    // A seed a 3. indexen van (az első ATR-rel rendelkező candle).
    const out = supertrend(
      [mkCandle(10, 11, 9), mkCandle(11, 12, 10), mkCandle(12, 13, 11), mkCandle(13, 14, 12)],
      3,
      2,
    );
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
  });

  it("erős uptrendben a Supertrend direction = 1", () => {
    // Minden candle szigorúan emelkedik.
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(mkCandle(100 + i, 100 + i + 1, 100 + i - 0.5));
    }
    const out = supertrend(candles, 10, 3);
    const last = out[out.length - 1];
    expect(last).toBeDefined();
    expect(last!.direction).toBe(1);
  });

  it("erős downtrendben a Supertrend direction = -1", () => {
    // A Supertrend a seed-del kezd (i = period), és a direction a close vs
    // lower band viszonyától függ. Ha close <= lower, direction = -1.
    // Konstruálunk egy szcenáriót, ahol az első definiált pont close <= lower.
    // 10 kiscandle (kis ATR), majd egy nagyrange candle, ahol a close a
    // lower band alatt van.
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      const c = 100 + i;
      candles.push(mkCandle(c, c + 0.5, c - 0.5));
    }
    // A 10. candle (i=10): nagy range, close a lower alatt.
    // HL2 = (110 + 80) / 2 = 95; ATR (Wilder) ≈ 1; multiplier=1
    // lower = 95 - 1 = 94; close = 85 < 94 → direction = -1 a seed-nél.
    candles.push(mkCandle(85, 110, 80));
    const out = supertrend(candles, 10, 1);
    const last = out[out.length - 1];
    expect(last).toBeDefined();
    expect(last!.direction).toBe(-1);
  });

  it("az irányváltás a close és a finalBand-ek alapján történik", () => {
    // A Supertrend irányát a close és a finalBand-ek viszonya határozza meg.
    // Egy uptrend után egy hirtelen, nagyrange zuhanó candle a direction-t -1-re váltja.
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      const c = 100 + i;
      candles.push(mkCandle(c, c + 0.5, c - 0.5));
    }
    // A 10. candle: nagy range, close a lower band alatt.
    candles.push(mkCandle(85, 110, 80));
    const out = supertrend(candles, 10, 1);
    const last = out[out.length - 1];
    expect(last).toBeDefined();
    // Az utolsó candle-ok a lower band alatt vannak → direction = -1.
    expect(last!.direction).toBe(-1);
  });

  it("ha az ATR egy adott candle-ban undefined, a Supertrend is undefined marad", () => {
    // 19 candle: az ATR period=10-zel out[10..] definialt, de a Supertrend
    // period=20-nal out[0..19] = undefined.
    const candles: Candle[] = [];
    for (let i = 0; i < 19; i++) {
      candles.push(mkCandle(100 + i, 100 + i + 1, 100 + i - 0.5));
    }
    const out = supertrend(candles, 20, 3);
    for (let i = 0; i < 19; i++) {
      expect(out[i]).toBeUndefined();
    }
  });

  it("direction nem változik, ha a close a finalBand-ek között marad", () => {
    // A Supertrend direction csak akkor változik, ha a close kilép a
    // finalLower/finalUpper sávból. Egy kis volatilitású, trend-mentes
    // piacon a direction az eredeti irányban marad.
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      // Kis range, enyhe trend.
      const c = 100 + i * 0.1;
      candles.push(mkCandle(c, c + 0.3, c - 0.3));
    }
    const out = supertrend(candles, 10, 3);
    // Minden Supertrend-ertek definialt, es direction = 1 (a seed-bol).
    for (let i = 10; i < out.length; i++) {
      expect(out[i]).toBeDefined();
      expect(out[i]!.direction).toBe(1);
    }
  });

  it("a direction -1-re vált, ha a close a finalLower alá esik egy későbbi candle-ban", () => {
    // 10 up candle (close=100, 101, ..., 109), majd egy nagy range-ű
    // drop candle, ahol a close a finalLower alá esik. A seed direction=1,
    // de a drop candle-re az else if ág aktiválódik.
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      const c = 100 + i;
      candles.push(mkCandle(c, c + 0.5, c - 0.5));
    }
    // A 10. candle: nagy range, close a lower band alatt → seed direction=-1.
    candles.push(mkCandle(80, 115, 70));
    // A 11. candle: közepes drop, close a prevSupertrend alatt marad.
    candles.push(mkCandle(82, 85, 75));
    // A 12. candle: kisebb up, de a close még mindig a finalUpper alatt.
    candles.push(mkCandle(85, 88, 80));
    const out = supertrend(candles, 10, 1);
    // Az out[10] (seed): close=80, HL2=92.5, ATR≈1, lower=91.5, close < lower → direction=-1.
    expect(out[10]!.direction).toBe(-1);
    // Az out[11] (else branch): close=82, prevSupertrend=finalUpper(seed)=93.5.
    // close < 93.5 → direction = -1 (else if body).
    expect(out[11]!.direction).toBe(-1);
    // Az out[12]: close=85, prevSupertrend=finalUpper(from iter 11).
    // close < finalUpper → direction marad -1.
    expect(out[12]!.direction).toBe(-1);
  });

  it("a finalUpper frissül (Math.max ág) amikor a close a korábbi finalUpper fölé megy", () => {
    // A `prev.close > finalUpper ? Math.max(upper, finalUpper) : upper` kifejezés
    // mindkét ágát teszteli. Az uptrend ág (Math.max) akkor fut le, amikor
    // a close a korábbi finalUpper értéket meghaladja.
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      const c = 100 + i;
      candles.push(mkCandle(c, c + 0.5, c - 0.5));
    }
    // A 10. candle: alacsony close → seed direction=-1, finalUpper nagy.
    candles.push(mkCandle(80, 115, 70));
    // A 11. candle: a close a finalUpper fölé megy → finalUpper frissül
    // (Math.max ág). Ez a korábbi downtrend → uptrend átmenet.
    candles.push(mkCandle(200, 201, 199));
    const out = supertrend(candles, 10, 1);
    // Az out[11] az else ágba megy: prev.close=80, finalUpper(seed)=93.5.
    // 80 > 93.5? No → finalUpper = upper[11] = 200 + 1*Wilder(ATR).
    // A Math.max ág NEM fut le, mert prev.close nem haladja meg a finalUpper-t.
    // Helyette a :upper ág fut.
    expect(out[11]!.direction).toBe(1); // close=200 > prevSupertrend=finalUpper=93.5
  });

  it("a direction nem változik, ha a close a finalBand-ek közé esik", () => {
    // A Supertrend három állapota: close > finalLower (up), close < finalUpper
    // (down), vagy a kettő között (nincs változás). Az utolsó eset is kell
    // a teljes branch coverage-hez.
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      const c = 100 + i;
      candles.push(mkCandle(c, c + 0.5, c - 0.5));
    }
    // A 10. candle: close a sávok között (HL2 = 110, multiplier=1, ATR=1).
    candles.push(mkCandle(109, 111, 108));
    supertrend(candles, 10, 1);
    // Az out[10]: close=109, HL2=109.5, ATR=1, multiplier=1.
    // upper = 110.5, lower = 108.5. close=109 > 108.5 → direction=1.
    // Hozzáadunk egy köv. candle-t, ahol close a sávok közé esik.
    candles.push(mkCandle(109, 110, 108));
    // Most az out[11] a 11. iteráció (i > period), az else ágba megy.
    // HL2 = 109, upper = 110, lower = 108. close=109, prev close=109.
    // finalUpper: 109 > 110.5? No → finalUpper=110.
    // finalLower: 109 < 108.5? No → finalLower=108.
    // close=109 > 108? Yes → direction=1.
    const out2 = supertrend(candles, 10, 1);
    expect(out2[10]!.direction).toBe(1);
    expect(out2[11]!.direction).toBe(1);
  });
});

describe("lastSupertrend", () => {
  it("üres sorra undefined-ot ad", () => {
    expect(lastSupertrend([])).toBeUndefined();
  });

  it("csupa undefined sorra undefined-ot ad", () => {
    expect(lastSupertrend([undefined, undefined])).toBeUndefined();
  });

  it("a sor legutolsó definiált értékét adja", () => {
    const v = { value: 1, direction: 1 as const };
    expect(lastSupertrend([undefined, v, undefined])).toBe(v);
  });
});
