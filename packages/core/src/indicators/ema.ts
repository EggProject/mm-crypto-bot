// packages/core/src/indicators/ema.ts — EMA (Exponential Moving Average)
//
// Az EMA a legegyszerűbb trend-indikátor. A kiválasztott stratégia a
// HTF-en használja (EMA 50 és 200), hogy a trend irányát megerősítse.
// A EMA késleltetése kisebb, mint az SMA-é, de még mindig a trend
// „meglévő" állapotát tükrözi — önmagában nem elég a belépéshez.
//
// Számítás: EMA_t = close_t × k + EMA_{t-1} × (1 − k)
//            ahol k = 2 / (period + 1)
//
// A seed az első `period` záróár egyszerű átlaga (TradingView konvenció).
// A warmup `period - 1` elem — az EMA azonnal a seed-től kezdve
// minden candle-re értelmezett.
//
// Specifikáció: docs/research/selected-strategy.md §2.

import type { Candle } from "@mm-crypto-bot/shared/types";

/**
 `ema` — kiszámolja az EMA(period) sort a megadott candle-sorozatra.
 Az első `period - 1` elemben `undefined` értékeket ad vissza (a warmup).
 A seed a `period - 1`. indexen van — az első `period` záróár SMA-ja.

 A függvény **determinisztikus**: ugyanarra a candle-sorozatra mindig
 ugyanazt az eredményt adja, nincs belső állapot vagy random seed.
*/
export function ema(candles: readonly Candle[], period: number): (number | undefined)[] {
  // A 0 vagy negatív periódus érvénytelen input — üres tömbbel térünk vissza.
  if (period <= 0 || candles.length === 0) {
    return [];
  }
  const out: (number | undefined)[] = new Array<number | undefined>(candles.length);
  // Súlyozó tényező: k = 2 / (period + 1). A klasszikus EMA-képlet.
  const k = 2 / (period + 1);
  // Az EMA az első `period - 1` elemben még nincs definiálva.
  for (let i = 0; i < period - 1 && i < candles.length; i++) {
    out[i] = undefined;
  }
  if (candles.length < period) {
    return out;
  }
  // Az első EMA-érték a seed: az első `period` darab záróár átlaga.
  let prev = 0;
  for (let i = 0; i < period; i++) {
    prev += candles[i]!.close;
  }
  prev /= period;
  out[period - 1] = prev;
  // A további EMA-értékek rekurzívan számolódnak.
  for (let i = period; i < candles.length; i++) {
    const close = candles[i]!.close;
    prev = close * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 `lastEma` — az EMA-sor legutolsó definiált értéke. Ha nincs egy sem
 (túl rövid a candle-sorozat), `undefined`-ot ad vissza.
*/
export function lastEma(series: readonly (number | undefined)[]): number | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}
