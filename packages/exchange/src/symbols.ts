// packages/exchange/src/symbols.ts — a `Symbol` brand konverziós segédletek
//
// FELADAT: A `Symbol` egy branded type (`Brand<string, "ExchangeSymbol">`).
// A fogyasztó kódok (paper engine, TUI) "BTC/USDT" néven írják be a
// konfig fájlokba, de a feldolgozó kód erősen típusú `Symbol`-t vár.
// Ez a modul ad két konverziós függvényt: `asSymbol` (string → Symbol,
// CSAK megbízható inputra) és `symbolOf` (string → Symbol, futásidejű
// validációval).
//
// A támogatott symbol-halmazt itt központilag definiáljuk: a feladat
// kikötése szerint CSAK bybit.eu SPOT-on, CSAK BTC/ETH/SOL párokkal
// dolgozunk. A `SUPPORTED_SYMBOLS` tömb az engedélyezett listát adja,
// és a `symbolOf` a futásidejű inputot is ellenőrzi ellene.

import type { Symbol } from "./types.js";

/**
 * `SUPPORTED_SYMBOLS` — a projekt által támogatott symbol-ok listája.
 * A feladat-specifikáció (docs/research/selected-strategy.md §6.3) szerint
 * a kereskedés kizárólag ezekre a párokra korlátozódik:
 *   - BTC/USDC (bybit.eu spot margin hivatalosan elérhető, 1:10)
 *   - ETH/USDC (bybit.eu spot margin hivatalosan elérhető, 1:10)
 *   - SOL/USDC (spot kereskedés elérhető, margin a SOL/USDC-n kevésbé
 *     hangsúlyos, de a stratégia szimmetrikus mindháromra)
 *
 * A USDC párt választottuk USDT helyett, mert a bybit.eu-n a margin
 * trading USDC ellenében érhető el (lásd stack-findings.md §2.4).
 */
export const SUPPORTED_SYMBOLS: readonly Symbol[] = [
  "BTC/USDC" as Symbol,
  "ETH/USDC" as Symbol,
  "SOL/USDC" as Symbol,
] as const;

/** `isSupportedSymbol` — futásidejű validáció, hogy egy string a támogatott listában van-e. */
export function isSupportedSymbol(s: string): s is Symbol {
  // A noUncheckedIndexedAccess miatt a `includes` adhat `boolean`-t.
  // A Set-re konvertálás gyorsabb, de a 3 elem esetén ez is OK.
  return (SUPPORTED_SYMBOLS as readonly string[]).includes(s);
}

/**
 * `asSymbol` — type-cast segédlet. CSAK akkor használd, ha az input
 * egy konstanstól jön (pl. konfigurációs fájl betöltés után, ahol a
 * validáció már megtörtént). Futásidejű ellenőrzést NEM végez.
 */
export function asSymbol(s: string): Symbol {
  return s as Symbol;
}

/**
 * `symbolOf` — biztonságos string → Symbol konverzió futásidejű
 * validációval. Ha a string nem a támogatott listában van, dob.
 *
 * Példa:
 *   const sym = symbolOf("BTC/USDC");  // OK
 *   symbolOf("DOGE/USDC");             // dob InvalidSymbolError-t
 */
export function symbolOf(s: string): Symbol {
  if (!isSupportedSymbol(s)) {
    throw new InvalidSymbolError(s);
  }
  return s;
}

/** `InvalidSymbolError` — dobódik, ha a megadott symbol nem a támogatott listában van. */
export class InvalidSymbolError extends Error {
  constructor(public readonly symbol: string) {
    super(`Nem támogatott symbol: "${symbol}". Támogatott: ${SUPPORTED_SYMBOLS.join(", ")}`);
    this.name = "InvalidSymbolError";
  }
}

/** A `quoteCurrency` kinyerése egy symbol-ból (a `/` előtti rész az alap, utána a quote). */
export function quoteCurrencyOf(s: Symbol): string {
  const slashIndex = s.indexOf("/");
  if (slashIndex === -1) {
    // Ez sosem történhet meg, ha a Symbol brand-et betartjuk, de a
    // strict null checks miatt védekezünk.
    return "USDC";
  }
  return s.slice(slashIndex + 1);
}

/** Az `baseCurrency` kinyerése egy symbol-ból. */
export function baseCurrencyOf(s: Symbol): string {
  const slashIndex = s.indexOf("/");
  if (slashIndex === -1) {
    return "UNKNOWN";
  }
  return s.slice(0, slashIndex);
}
