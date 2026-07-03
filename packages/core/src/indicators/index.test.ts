// packages/core/src/indicators/index.test.ts — computeIndicators unit-tesztek
//
// 100%-os coverage: minden ág a computeIndicators függvényben.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { computeIndicators } from "./index.js";

function mkCandle(close: number, high: number, low: number, volume = 1000): Candle {
  return { timestamp: 0, open: close, high, low, close, volume };
}

const CONFIG = {
  htfDonchianPeriod: 20,
  htfSupertrendPeriod: 10,
  htfSupertrendMultiplier: 3,
  htfEmaFast: 50,
  htfEmaSlow: 200,
  htfAdxPeriod: 14,
  mtfBbPeriod: 20,
  mtfBbStddev: 2,
  mtfAdxPeriod: 14,
  mtfRsiPeriod: 14,
  ltfRsiPeriod: 14,
  ltfVolumeMaPeriod: 20,
  ltfAtrPeriod: 14,
} as const;

function mkTrendCandles(n: number, base: number, drift: number): Candle[] {
  // Egy egyszerű lineáris trend candle-sor.
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = base + drift * i;
    out.push(mkCandle(c, c + 0.5, c - 0.5, 1000 + i));
  }
  return out;
}

describe("computeIndicators", () => {
  it("a HTF/MTF/LTF candle-ok close értékeit a state-be helyezi", () => {
    // A state `close` mezoje a backtest motor számara fontos: ez alapjan
    // donti el a strategia, hogy a Donchian/BB szeleihez kepest hol allunk.
    const htf = mkTrendCandles(50, 1000, 1);
    const mtf = mkTrendCandles(50, 1000, 1);
    const ltf = mkTrendCandles(50, 1000, 1);
    const result = computeIndicators(htf, mtf, ltf, CONFIG);
    expect(result.htf.close).toBe(htf[htf.length - 1]!.close);
    expect(result.mtf.close).toBe(mtf[mtf.length - 1]!.close);
    expect(result.ltf.close).toBe(ltf[ltf.length - 1]!.close);
  });

  it("a candle-ok candleIndex mezője a tömb hossza-1", () => {
    const htf = mkTrendCandles(50, 1000, 1);
    const mtf = mkTrendCandles(50, 1000, 1);
    const ltf = mkTrendCandles(50, 1000, 1);
    const result = computeIndicators(htf, mtf, ltf, CONFIG);
    expect(result.htf.candleIndex).toBe(49);
    expect(result.mtf.candleIndex).toBe(49);
    expect(result.ltf.candleIndex).toBe(49);
  });

  it("a HTF indikátorok definiáltak 50 candle után", () => {
    const htf = mkTrendCandles(50, 1000, 1);
    const mtf = mkTrendCandles(50, 1000, 1);
    const ltf = mkTrendCandles(50, 1000, 1);
    const result = computeIndicators(htf, mtf, ltf, CONFIG);
    // 50 candle > Donchian 20, EMA 50, Supertrend 10 → minden definiált.
    expect(result.htf.donchianUpper).toBeDefined();
    expect(result.htf.donchianLower).toBeDefined();
    expect(result.htf.supertrend).toBeDefined();
    expect(result.htf.supertrendDir).toBeDefined();
    // EMA 50: seed a 49. indexen (period-1), 50 candle = 50 → definiált.
    expect(result.htf.ema50).toBeDefined();
    expect(result.htf.adx).toBeDefined();
    // Az EMA 200-hoz 200 candle kell → 50-nél még nincs.
    expect(result.htf.ema200).toBeUndefined();
  });

  it("a MTF indikátorok definiáltak 50 candle után", () => {
    const htf = mkTrendCandles(50, 1000, 1);
    const mtf = mkTrendCandles(50, 1000, 1);
    const ltf = mkTrendCandles(50, 1000, 1);
    const result = computeIndicators(htf, mtf, ltf, CONFIG);
    expect(result.mtf.bbUpper).toBeDefined();
    expect(result.mtf.bbLower).toBeDefined();
    expect(result.mtf.bbMiddle).toBeDefined();
    expect(result.mtf.adx).toBeDefined();
    expect(result.mtf.rsi).toBeDefined();
  });

  it("az LTF indikátorok definiáltak 50 candle után", () => {
    const htf = mkTrendCandles(50, 1000, 1);
    const mtf = mkTrendCandles(50, 1000, 1);
    const ltf = mkTrendCandles(50, 1000, 1);
    const result = computeIndicators(htf, mtf, ltf, CONFIG);
    expect(result.ltf.rsi).toBeDefined();
    expect(result.ltf.volumeMa).toBeDefined();
    expect(result.ltf.atr).toBeDefined();
  });

  it("üres candle-sorokra minden mező undefined", () => {
    const result = computeIndicators([], [], [], CONFIG);
    expect(result.htf.close).toBeUndefined();
    expect(result.htf.donchianUpper).toBeUndefined();
    expect(result.htf.donchianLower).toBeUndefined();
    expect(result.htf.supertrend).toBeUndefined();
    expect(result.htf.supertrendDir).toBeUndefined();
    expect(result.htf.ema50).toBeUndefined();
    expect(result.htf.ema200).toBeUndefined();
    expect(result.htf.adx).toBeUndefined();
    expect(result.mtf.close).toBeUndefined();
    expect(result.mtf.bbUpper).toBeUndefined();
    expect(result.mtf.bbLower).toBeUndefined();
    expect(result.mtf.bbMiddle).toBeUndefined();
    expect(result.mtf.adx).toBeUndefined();
    expect(result.mtf.rsi).toBeUndefined();
    expect(result.ltf.close).toBeUndefined();
    expect(result.ltf.rsi).toBeUndefined();
    expect(result.ltf.volumeMa).toBeUndefined();
    expect(result.ltf.atr).toBeUndefined();
  });

  it("rövid candle-sorokra a bemelegedési ágak mind lefutnak", () => {
    // 5 candle < minden period: minden undefined, de nem dob hibát.
    const htf = mkTrendCandles(5, 100, 1);
    const mtf = mkTrendCandles(5, 100, 1);
    const ltf = mkTrendCandles(5, 100, 1);
    const result = computeIndicators(htf, mtf, ltf, CONFIG);
    expect(result.htf.ema50).toBeUndefined();
    expect(result.mtf.bbUpper).toBeUndefined();
    expect(result.ltf.atr).toBeUndefined();
  });

  it("a HTF Supertrend direction up trendben = 1", () => {
    const htf = mkTrendCandles(50, 1000, 1);
    const mtf = mkTrendCandles(50, 1000, 1);
    const ltf = mkTrendCandles(50, 1000, 1);
    const result = computeIndicators(htf, mtf, ltf, CONFIG);
    expect(result.htf.supertrendDir).toBe(1);
  });
});
