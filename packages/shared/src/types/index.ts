// packages/shared/src/types/index.ts — közös típus-definíciók
//
// Ez a modul a `@mm/shared/types` belépési pontja. A scaffold fázisban csak
// a `Brand` utility típus és a `Result<T, E>` típus van itt — ezekből a
// későbbi fázisokban a konkrét domain-típusok (Trade, Position, Order stb.)
// fognak épülni.

/**
 `Brand<T, K>` — "opaque type" minta. Egy típust egy másikkal kompatibilissé tesz
 anélkül, hogy az értéke konvertálható lenne. Például egy `UserId` nem
 keveredik össze egy `Symbol`-lal, még ha mindkettő `string` is.
*/
export type Brand<T, K extends string> = T & { readonly __brand: K };

/**
 `Result<T, E>` — Rust-stílusú eredmény-típus. A hibakezelés explicit,
 típus-szinten kifejezhető, kikerüli a `throw` használatát.
*/
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 `Side` — a kereskedés iránya (long vagy short). A `@mm/core` stratégia-motor
 és a `@mm/exchange` adapter is ezt a típust fogja használni.
*/
export type Side = "buy" | "sell";

/**
 `Timeframe` — a chart idősíkjainak kanonikus halmaza. A kiválasztott stratégia
 (MTF-Trend-Konfluencia) három szintet használ: HTF (4h), MTF (1h), LTF (15m).
 Lásd: docs/research/selected-strategy.md.
*/
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
