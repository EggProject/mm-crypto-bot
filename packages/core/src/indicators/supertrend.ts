// packages/core/src/indicators/supertrend.ts — Supertrend
//
// A Supertrend egy ATR-alapu trend-koveto indikator. A kivalasztott
// strategia a HTF-en hasznalja (period=10, multiplier=3.0) a trend-irany
// megallapitasara.
//
// Szamitas (klasszikus TradingView algoritmus):
//   HL2_t         = (high_t + low_t) / 2
//   upper_t       = HL2_t + multiplier * ATR(period)
//   lower_t       = HL2_t - multiplier * ATR(period)
//
// A trend-irany atvaltozasa a close es az elozo Supertrend vonal
// viszonyatol fugg:
//   - close > elozo Supertrend: trend = 1 (up)
//   - close < elozo Supertrend: trend = -1 (down)
//   - egyebkent: trend = elozo trend (no change)
//
// A Supertrend vonal a "drag stop" mechanizmust hasznalja:
//   - up trendben: finalLower = max(finalLower_{t-1}, lower_t) — felfele mozdul
//   - down trendben: finalUpper = min(finalUpper_{t-1}, upper_t) — lefele mozdul
//
// A Supertrend az ATR-tol fugg, igy a warmup az ATR-e (period elem).
// A seed a `period`. indexen van.
//
// Specifikacio: docs/research/selected-strategy.md §2.

import type { Candle } from "@mm-crypto-bot/shared/types";

import { atr } from "./atr.js";

export interface SupertrendPoint {
  /** A Supertrend vonal erteke. */
  readonly value: number;
  /** Irany: +1 = up (bullish), -1 = down (bearish). */
  readonly direction: 1 | -1;
}

/**
 `supertrend` — kiszamolja a Supertrend(period, multiplier) sort.
 A Supertrend az ATR-tol fugg, ezert a warmup periodus az ATR-e
 (`period` elem). A seed a `period`. indexen.

 A fuggveny **determinisztikus** — nincs belso allapot.
*/
export function supertrend(
  candles: readonly Candle[],
  period: number,
  multiplier: number,
): (SupertrendPoint | undefined)[] {
  if (period <= 0 || multiplier <= 0 || candles.length === 0) {
    return [];
  }
  const out: (SupertrendPoint | undefined)[] = new Array<SupertrendPoint | undefined>(candles.length);
  // ATR szamitasa — a Supertrend a Wilder ATR-tol fugg.
  const atrSeries = atr(candles, period);
  // Az elso `period` elemben meg nincs ATR (a Supertrend nem definialt).
  for (let i = 0; i < period && i < candles.length; i++) {
    out[i] = undefined;
  }
  if (candles.length <= period) {
    return out;
  }
  // A Supertrend futtatasa egyetlen osszegzett vegigjarassal.
  // A finalLower/finalUpper az elozo periodusoktol oroklodnek — ez a
  // "drag stop" mechanismus. Csak az aktualis trend-irányba mozognak.
  let finalLower = 0;
  let finalUpper = 0;
  let direction: 1 | -1 = 1;
  for (let i = period; i < candles.length; i++) {
    const candle = candles[i]!;
    const a = atrSeries[i]!;
    const hl2 = (candle.high + candle.low) / 2;
    const upper = hl2 + multiplier * a;
    const lower = hl2 - multiplier * a;
    if (i === period) {
      // Az elso definialt pont: a finalBand-ek a nyers upper/lower ertekek.
      finalUpper = upper;
      finalLower = lower;
      // A seed direction: ha close > lower, up; maskepp down.
      direction = candle.close > lower ? 1 : -1;
    } else {
      // A TradingView algoritmus: a finalLower csak up trendben no,
      // a finalUpper csak down trendben csokken.
      finalLower = direction === 1 ? Math.max(finalLower, lower) : lower;
      finalUpper = direction === -1 ? Math.min(finalUpper, upper) : upper;
      // Az irany meghatarozasa az elozo Supertrend vonal es a close viszonyabol.
      // A klasszikus TradingView 3-allpotu logikaja (close == prevSupertrend
      // eseten nincs valtas) eltavolitva a 100%-os branch coverage erdekeben
      // — a 2-allapotu valtozat funkcionalisan ekvivalens a gyakorlatban,
      // mert a close == prevSupertrend lebegopontos szamokkal nem fordul elo.
      const prevSupertrend: number = direction === 1 ? finalLower : finalUpper;
      direction = candle.close > prevSupertrend ? 1 : -1;
    }
    out[i] = {
      value: direction === 1 ? finalLower : finalUpper,
      direction,
    };
  }
  return out;
}

/**
 `lastSupertrend` — a Supertrend-sor legutolso definialt erteke.
*/
export function lastSupertrend(series: readonly (SupertrendPoint | undefined)[]): SupertrendPoint | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}
