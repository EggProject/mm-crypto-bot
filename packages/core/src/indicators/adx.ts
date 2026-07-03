// packages/core/src/indicators/adx.ts — ADX (Average Directional Index, Wilder)
//
// Az ADX a trend *erosseneget* meri (0-100 kozott), ellentetben a Donchian
// vagy a Supertrend-del, amelyek a trend *iranyat* is mutatjak. A kivalasztott
// strategia a HTF-en es a MTF-en is kovetelmenykent hasznalja (ADX > 20),
// hogy kiszurje a szatold oldalazast.
//
// A Wilder-fele ADX harom komponensbol all:
//   1. +DM (Directional Movement up)   = high - prev_high  ha > 0 es > -DM, maskepp 0
//   2. -DM (Directional Movement down) = prev_low - low    ha > 0 es > +DM, maskepp 0
//   3. TR (True Range) = max(high-low, |high-prev_close|, |low-prev_close|)
//
//   +DI = 100 * WilderSmooth(+DM) / WilderSmooth(TR)
//   -DI = 100 * WilderSmooth(-DM) / WilderSmooth(TR)
//   DX  = 100 * |+DI - -DI| / (+DI + -DI)
//   ADX = WilderSmooth(DX)
//
// A warmup `period + 1` elem (az elso `period` TR a seed, plusz egy a DX-hez).
// A seed (elso DX) a `period + 1`. indexen van, az elso ADX a `period + 2`-on.
//
// Specifikacio: docs/research/selected-strategy.md §2.

import type { Candle } from "@mm-crypto-bot/shared/types";

/**
 `adx` — kiszamolja az ADX(period) sort a candle-sorozatra.
 Az elso `period + 1` elemben `undefined` ertekeket ad vissza (a warmup).
 Az elso definialt ertek a `period + 1`. indexen van (az elso DX).

 A fuggveny **determinisztikus** — nincs belso allapot.
*/
export function adx(candles: readonly Candle[], period: number): (number | undefined)[] {
  if (period <= 0 || candles.length === 0) {
    return [];
  }
  const out: (number | undefined)[] = new Array<number | undefined>(candles.length);
  // Az elso `period + 1` elemben nincs eleg adat a DX seed-hez.
  for (let i = 0; i <= period && i < candles.length; i++) {
    out[i] = undefined;
  }
  if (candles.length <= period + 1) {
    return out;
  }
  // 1) TR, +DM, -DM szamitasa minden i >= 1-re.
  const trs: number[] = new Array<number>(candles.length);
  const plusDms: number[] = new Array<number>(candles.length);
  const minusDms: number[] = new Array<number>(candles.length);
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i]!;
    const prev = candles[i - 1]!;
    const up = cur.high - prev.high;
    const down = prev.low - cur.low;
    plusDms[i] = up > down && up > 0 ? up : 0;
    minusDms[i] = down > up && down > 0 ? down : 0;
    const highLow = cur.high - cur.low;
    const highPrev = Math.abs(cur.high - prev.close);
    const lowPrev = Math.abs(cur.low - prev.close);
    trs[i] = Math.max(highLow, highPrev, lowPrev);
  }
  // 2) Wilder-simas seed: az elso `period` TR/DM osszege (1..period).
  let trSmooth = 0;
  let plusSmooth = 0;
  let minusSmooth = 0;
  for (let i = 1; i <= period; i++) {
    trSmooth += trs[i]!;
    plusSmooth += plusDms[i]!;
    minusSmooth += minusDms[i]!;
  }
  // 3) Iterativ Wilder-simas: smooth_t = smooth_{t-1} - smooth_{t-1}/period + x_t.
  //    Az elso DX az i = period + 1 elembol jon.
  for (let i = period + 1; i < candles.length; i++) {
    // A trs/plusDms/minusDms i-edik eleme mindig definialt, mert az 1..
    // candles.length-1 intervallumban a TR/DM ciklus mar beallitotta oket.
    trSmooth = trSmooth - trSmooth / period + trs[i]!;
    plusSmooth = plusSmooth - plusSmooth / period + plusDms[i]!;
    minusSmooth = minusSmooth - minusSmooth / period + minusDms[i]!;
    const plusDi = trSmooth === 0 ? 0 : (100 * plusSmooth) / trSmooth;
    const minusDi = trSmooth === 0 ? 0 : (100 * minusSmooth) / trSmooth;
    const sum = plusDi + minusDi;
    const dx = sum === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / sum;
    // Az elso DX-et taroljuk az ADX seedjekent; a tobbbi iteracioban az
    // ADX = (elozo_ADX * (period-1) + dx) / period Wilder-simas.
    if (i === period + 1) {
      out[i] = dx;
    } else {
      // Az elozo ADX a loop-ban mindig definialt, mert a seed out[period+1]
      // az elso iteracioban kerul beallitasra.
      const prevAdx = out[i - 1]!;
      // ADX = (prevAdx * (period-1) + dx) / period
      out[i] = (prevAdx * (period - 1) + dx) / period;
    }
  }
  return out;
}

/**
 `lastAdx` — az ADX-sor legutolso definialt erteke.
*/
export function lastAdx(series: readonly (number | undefined)[]): number | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}
