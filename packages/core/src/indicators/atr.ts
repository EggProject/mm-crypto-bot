// packages/core/src/indicators/atr.ts — ATR (Average True Range, Wilder)
//
// Az ATR a volatilitast meri. A kivalasztott strategia ket celra hasznalja:
//   1. LTF-en: stop-loss tavolsag meghatarozasa (ATR(14) * 1.5).
//   2. Kilepesi szabalyoknal: trailing stop, time-exit meresek.
//
// A klasszikus Wilder-fele ATR-t implementaljuk (1978):
//   TR_t = max(high - low, |high - prev_close|, |low - prev_close|)
//   ATR_t = (ATR_{t-1} * (period - 1) + TR_t) / period
//
// A seed a `period`. indexen van (az elso `period` TR atlaga).
//
// Specifikacio: docs/research/selected-strategy.md §2.

import type { Candle } from "@mm-crypto-bot/shared/types";

/**
 `atr` — kiszamolja az ATR(period) sort a candle-sorozatra.
 Az elso `period` elemben `undefined` ertekeket ad vissza (a warmup):
 az elso `period` TR-re van szukseg a seed-hez. A seed a `period`. indexen.

 A fuggveny **determinisztikus** — nincs belso allapot.
*/
export function atr(candles: readonly Candle[], period: number): (number | undefined)[] {
  if (period <= 0 || candles.length === 0) {
    return [];
  }
  const out: (number | undefined)[] = new Array<number | undefined>(candles.length);
  // Az elso `period` elemben meg nincs eleg TR az atlagolashoz.
  for (let i = 0; i < period && i < candles.length; i++) {
    out[i] = undefined;
  }
  if (candles.length <= period) {
    return out;
  }
  // 1) True Range-ek kiszamitasa (a 1. elemtol kezdve).
  const trs: number[] = new Array<number>(candles.length);
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i]!;
    const prev = candles[i - 1]!.close;
    const highLow = cur.high - cur.low;
    const highPrev = Math.abs(cur.high - prev);
    const lowPrev = Math.abs(cur.low - prev);
    trs[i] = Math.max(highLow, highPrev, lowPrev);
  }
  // 2) Seed: az elso `period` darab TR atlaga (SMA-szeru).
  let atrValue = 0;
  for (let i = 1; i <= period; i++) {
    atrValue += trs[i]!;
  }
  atrValue /= period;
  out[period] = atrValue;
  // 3) Tobbi lepes: Wilder-simitas.
  for (let i = period + 1; i < candles.length; i++) {
    // trs[i] mindig definialt, mert az 1..candles.length-1 intervallumban
    // a TR-szamitas ciklus mar beallitotta.
    atrValue = (atrValue * (period - 1) + trs[i]!) / period;
    out[i] = atrValue;
  }
  return out;
}

/**
 `lastAtr` — az ATR-sor legutolso definialt erteke.
*/
export function lastAtr(series: readonly (number | undefined)[]): number | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}
