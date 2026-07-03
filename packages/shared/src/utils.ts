// packages/shared/src/utils/index.ts — közös util függvények
//
// A monorepo minden csomagja által használt pénzkezelési, statisztikai
// és típus-konverziós segédletek. Az indikátor-számítás és a backtest
// motor (Sharpe, Sortino, Kelly) is innen fogyaszt.

import type { Result } from "./types.js";

/**
 `unwrap` — a `Result<T, E>` értékének kicsomagolása.
 Ha `result.ok === true`, visszaadja a `value`-t; különben dobja az `error`-t.
 CSAK akkor használd, ha garantált, hogy a Result `ok` — különben
 a `match`/`fold` minta preferálandó.
*/
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  // A `Result.error` típusa `E` — ha `E = Error`, akkor dobható; ha `E = string`,
  // akkor becsomagoljuk. A `throw result.error` közvetlenül csak akkor működne,
  // ha `E` maga az `Error` típus lenne — ezért egy típus-őrt biztosítunk.
  if (result.error instanceof Error) {
    throw result.error;
  }
  throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/**
 `roundTo` — egy lebegőpontos számot adott számú tizedesjegyre kerekít.
 A backtest riportok (és az exchange-nek küldött árak) formázásához.
 A banker-kerekítést (half-to-even) használja, ne a standard kerekítést,
 mert a kriptó tőzsdék általában ezt alkalmazzák a fee-számításnál.
*/
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** decimals;
  // A half-to-even (banker's rounding) megakadályozza a torz felhalmozódást
  // nagy mennyiségű trade-aggregálásnál.
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (diff > 0.5) {
    return (floor + 1) / factor;
  }
  if (diff < 0.5) {
    return floor / factor;
  }
  // diff === 0.5 → a legközelebbi párosra kerekítünk.
  return (floor % 2 === 0 ? floor : floor + 1) / factor;
}

/**
 `clamp` — egy értéket egy [min, max] intervallumba szorít.
 A Kelly-frakció és a position-size limit clamp-eléséhez használjuk,
 nehogy a user-facing paraméterek极端 értékeket vehessenek fel.
*/
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 `mean` — egy számsor átlaga. Üres tömb esetén 0-t ad vissza
 (a backtest equity-görbe elején lehet, hogy nincs elég adat).
*/
export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum / values.length;
}

/**
 `stddev` — minta-standard deviáció (n-1 nevezővel). A backtest
 a hozamok szórását számítja vele a Sharpe/Sortino-hoz.
 Üres vagy 1 elemű tömb esetén 0-t ad vissza.
*/
export function stddev(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const m = mean(values);
  let sumSq = 0;
  for (const v of values) {
    const diff = v - m;
    sumSq += diff * diff;
  }
  // Bessel-korrekció (n-1) a minta-szóráshoz.
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 `sum` — egy számsor összege. A pozíció-PnL és a fee-aggregálás
 egyik alapművelete; a `reduce` inline használatánál gyorsabb
 és kevésbé allokál.
*/
export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    total += v;
  }
  return total;
}
