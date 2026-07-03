// packages/core/src/indicators/rsi.ts — RSI (Relative Strength Index)
//
// Az RSI az egyik legelterjedtebb momentum-indikátor. A kiválasztott
// stratégia kétféleképpen használja:
//   1. MTF-en: pullback-detektor (RSI <= 35 long setup, RSI >= 65 short setup).
//   2. LTF-en: cross-back trigger (RSI visszater 30 fole long, 70 ala short).
//
// A klasszikus Wilder-fele RSI-t implementaljuk (1978):
//   RS = avgGain / avgLoss     (14 periodusu exponencialis atlag)
//   RSI = 100 - 100 / (1 + RS)
//
// A simitas exponencialis (Wilder): avg_t = (avg_{t-1} * (n-1) + x_t) / n.
// Ez a "valodi" Wilder-RS, nem az egyszeru SMA — az MT4/MT5 is ezt hasznalja.
//
// Specifikacio: docs/research/selected-strategy.md §2.

import type { Candle } from "@mm-crypto-bot/shared/types";

/**
 `rsi` — kiszamolja az RSI(period) sort a candle-sorozatra.
 Az elso `period` elemben `undefined` ertekeket ad vissza (a warmup):
 az elso `period` valtozasra van szukseg az atlagolashoz. A seed a
 `period`. indexen van.

 A fuggveny **determinisztikus** — nincs belso allapot.
*/
export function rsi(candles: readonly Candle[], period: number): (number | undefined)[] {
  if (period <= 0 || candles.length === 0) {
    return [];
  }
  const out: (number | undefined)[] = new Array<number | undefined>(candles.length);
  // Az elso `period` elemben meg nincs eleg valtozas az atlagolashoz.
  for (let i = 0; i <= period && i < candles.length; i++) {
    out[i] = undefined;
  }
  if (candles.length <= period + 1) {
    return out;
  }
  // 1) Elso lepes: az elso `period` darab valtozas atlaga (SMA-szeru seed).
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i]!.close - candles[i - 1]!.close;
    if (change > 0) {
      gainSum += change;
    } else {
      // A veszteseget abszolut ertekben szamoljuk (Wilder).
      lossSum += -change;
    }
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  // Az elso RSI-ertek a seed utan.
  out[period] = computeRsi(avgGain, avgLoss);
  // 2) Tobbi lepes: Wilder-simitas.
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i]!.close - candles[i - 1]!.close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = computeRsi(avgGain, avgLoss);
  }
  return out;
}

/**
 `computeRsi` — az RSI-ertek kiszamitasa az atlagos nyereseg/veszteseg
 hanyadosbol. Ha `avgLoss === 0` es `avgGain > 0`, RSI = 100 (minden
 valtozas nyereseg volt — extrem bull); ha `avgGain === 0` es
 `avgLoss === 0`, RSI = 50 (semleges — nincs elmozdulas).
*/
function computeRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) {
    if (avgGain === 0) {
      return 50;
    }
    return 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 `lastRsi` — az RSI-sor legutolso definialt erteke.
*/
export function lastRsi(series: readonly (number | undefined)[]): number | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}
