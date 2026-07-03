// packages/core/src/indicators/donchian.ts — Donchian Channels
//
// A Donchian-csatorna a legmagasabb high-t es a legalacsonyabb low-t
// mutatja egy adott perioduson belul. A kivalasztott strategia a HTF-en
// hasznalja (period=20) a "20-napos uj csucs" mint trend-szuro.
//
// Szamitas:
//   upper = Highest(high, period)   (a period legmagasabb high-ja)
//   lower = Lowest(low, period)     (a period legalacsonyabb low-ja)
//
// A csatorna trend-szuronek hasznalhato:
//   close > upper = uj csucs (bullish breakout)
//   close < lower = uj melypont (bearish breakout)
//
// A kilepesi szabalyoknal a 10-periodus valtozatot is hasznaljuk a
// trailing-stop szamitasnal (a kivalasztott strategia "Donchian_lower(20, 4H)"
// a long trailing-stop).
//
// A seed a `period - 1`. indexen van — az elso `period` candle high/low-bol.
// A warmup `period` elem. A rolling window [i-period, i-1] (previous-period-exclusive) az out[i] -hez.
//
// Specifikacio: docs/research/selected-strategy.md §2, §4.1.

import type { Candle } from "@mm-crypto-bot/shared/types";

export interface DonchianChannel {
  readonly upper: number;
  readonly lower: number;
}

/**
 `donchian` — kiszamolja a Donchian(period) csatornat a candle-sorozatra.
 Az elso `period - 1` elemben `undefined` ertekeket ad vissza. A seed a
 `period - 1`. indexen van.

 A fuggveny **determinisztikus** — nincs belso allapot.
*/
export function donchian(candles: readonly Candle[], period: number): (DonchianChannel | undefined)[] {
  if (period <= 0 || candles.length === 0) {
    return [];
  }
  const out: (DonchianChannel | undefined)[] = new Array<DonchianChannel | undefined>(candles.length);
  for (let i = 0; i < period - 1 && i < candles.length; i++) {
    out[i] = undefined;
  }
  if (candles.length < period) {
    return out;
  }
  // Az out[i] a candles[i-period..i-1] ablakbol szamol (kiveve a current bar-t).
  // A jelenlegi candle-t kizarjuk, mert kulonben a close <= high <= max(high), es
  // igy a breakout detekcio (close > upper / high > upper) soha nem triggerelne.
  // A breakout-comparison igy mindig a previous N-period max-hoz hasonlit, ami
  // a standard Donchian-csatorna breakout (Turtle-trading) definicio.
  for (let i = period; i < candles.length; i++) {
    let high = -Infinity;
    let low = Infinity;
    for (let j = i - period; j <= i - 1; j++) {
      const c = candles[j]!;
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
    }
    out[i] = { upper: high, lower: low };
  }
  return out;
}

/**
 `lastDonchian` — a Donchian-sor legutolso definialt erteke.
*/
export function lastDonchian(series: readonly (DonchianChannel | undefined)[]): DonchianChannel | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}
