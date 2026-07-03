// packages/core/src/indicators/volume-ma.ts — Volume MA
//
// A Volume MA(20) a forgalom atlaga az utolso `period` gyertyara.
// A kivalasztott strategia az LTF-en hasznalja trigger-konfirmaciohoz:
// a long belepes csak akkor ervenyes, ha a kovetkezo gyertya volumenje
// >= 1.2 * VolumeMA(20).
//
// Egyszeru SMA-t hasznalunk (az exponencialis simitas kriptoban
// kevesse szokasos a volumen-szuresnel).
//
// A seed a `period - 1`. indexen van — az elso `period` candle volume-bol.
// A warmup `period - 1` elem.
//
// Specifikacio: docs/research/selected-strategy.md §2, §3.1.

import type { Candle } from "@mm-crypto-bot/shared/types";

/**
 `volumeMa` — kiszamolja a Volume MA(period) sort.
 Az elso `period - 1` elemben `undefined` ertekeket ad vissza. A seed a
 `period - 1`. indexen van.

 A fuggveny **determinisztikus** — nincs belso allapot.
*/
export function volumeMa(candles: readonly Candle[], period: number): (number | undefined)[] {
  if (period <= 0 || candles.length === 0) {
    return [];
  }
  const out: (number | undefined)[] = new Array<number | undefined>(candles.length);
  for (let i = 0; i < period - 1 && i < candles.length; i++) {
    out[i] = undefined;
  }
  if (candles.length < period) {
    return out;
  }
  // Rolling-osszeg — O(n) komplexitas.
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i]!.volume;
  }
  out[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    sum += candles[i]!.volume - candles[i - period]!.volume;
    out[i] = sum / period;
  }
  return out;
}

/**
 `lastVolumeMa` — a Volume MA-sor legutolso definialt erteke.
*/
export function lastVolumeMa(series: readonly (number | undefined)[]): number | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}
