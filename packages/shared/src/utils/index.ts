// packages/shared/src/utils/index.ts — közös util függvények
//
// A scaffold fázisban a legszükségesebb típus-konverziós és pénzkezelési
// segédleteket tesszük ide. A későbbi fázisokban a többi util itt fog
// felhalmozódni (date parsing, formatters, stb.).

import type { Result } from "../types/index.js";

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
