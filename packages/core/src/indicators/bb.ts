// packages/core/src/indicators/bb.ts — Bollinger Bands
//
// A Bollinger Bands (BB) egy volatilitas-alapu envelope indikator. A BB
// harom vonalból all:
//   - Kozepvonal (BB_middle) = SMA(close, period)
//   - Felso sav (BB_upper)   = BB_middle + k * StdDev(close, period)
//   - Also sav (BB_lower)    = BB_middle - k * StdDev(close, period)
//
// A kivalasztott strategia a BB-t ket celra hasznalja:
//   1. MTF-en: pullback-detektor (close <= BB_lower long, close >= BB_upper short).
//   2. LTF-en: kilepesi szabaly (BB_middle a trend-reszerkezetben).
//
// A seed a `period - 1`. indexen van — az elso `period` close-bol szamolodik.
// A warmup `period - 1` elem. A rolling window [i-period+1, i] az out[i] -hez.
//
// Specifikacio: docs/research/selected-strategy.md §2.

import type { Candle } from "@mm-crypto-bot/shared/types";

export interface BollingerBands {
  readonly middle: number;
  readonly upper: number;
  readonly lower: number;
}

/**
 `bb` — kiszamolja a Bollinger Bands(period, stddev) sort.
 Az elso `period - 1` elemben `undefined` ertekeket ad vissza. A seed a
 `period - 1`. indexen van.

 A fuggveny **determinisztikus** — nincs belso allapot.
*/
export function bb(
  candles: readonly Candle[],
  period: number,
  stddevMultiplier: number,
): (BollingerBands | undefined)[] {
  if (period <= 0 || candles.length === 0) {
    return [];
  }
  const out: (BollingerBands | undefined)[] = new Array<BollingerBands | undefined>(candles.length);
  for (let i = 0; i < period - 1 && i < candles.length; i++) {
    out[i] = undefined;
  }
  if (candles.length < period) {
    return out;
  }
  // Rolling-osszeg — O(n) komplexitas, minden i-re kiszamoljuk a
  // [i-period+1, i] intervallum SMA-jat es szorasat.
  let windowSum = 0;
  for (let i = 0; i < period; i++) {
    windowSum += candles[i]!.close;
  }
  const mean0 = windowSum / period;
  let sqDiffSum = 0;
  for (let i = 0; i < period; i++) {
    const d = candles[i]!.close - mean0;
    sqDiffSum += d * d;
  }
  const stddev0 = Math.sqrt(sqDiffSum / period);
  out[period - 1] = {
    middle: mean0,
    upper: mean0 + stddevMultiplier * stddev0,
    lower: mean0 - stddevMultiplier * stddev0,
  };
  for (let i = period; i < candles.length; i++) {
    // Ablak-eltolas: kivonjuk a lego oregbb elemet, hozzaadjuk az ujat.
    // Az out[i] a candles[i-period+1..i] ablakbol szamol.
    windowSum += candles[i]!.close - candles[i - period]!.close;
    const mean = windowSum / period;
    let sqDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = candles[j]!.close - mean;
      sqDiff += d * d;
    }
    const sd = Math.sqrt(sqDiff / period);
    out[i] = {
      middle: mean,
      upper: mean + stddevMultiplier * sd,
      lower: mean - stddevMultiplier * sd,
    };
  }
  return out;
}

/**
 `lastBb` — a BB-sor legutolso definialt erteke.
*/
export function lastBb(series: readonly (BollingerBands | undefined)[]): BollingerBands | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}
