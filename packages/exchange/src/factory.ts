// packages/exchange/src/factory.ts — exchange feed factory-k
//
// FELADAT: A factory-k egyetlen belépési pontot adnak a `BybitEuFeed`
// példányosításához. A `createExchangeClient` factory a környezeti
// változókból (`BYBIT_API_KEY`, `BYBIT_API_SECRET`) olvassa a
// hitelesítő adatokat, és a `BUN_ENV` értéke alapján dönti el, hogy
// melyik feed-et adja vissza.
//
// FONTOS (fail-safe): a rendszer ALAPÉRTELMEZETTEN paper módban indul —
// ha `BUN_ENV === "live"` ÉS a `BYBIT_API_KEY`/`BYBIT_API_SECRET` nincs
// beállítva, dobunk. Ellenkező esetben a `BUN_ENV` értékétől függetlenül
// mindig a `BybitEuFeed`-et adjuk vissza (mert a paper mód a valódi
// WS feedre épül — lásd `docs/research/stack-findings.md` §1.4).
//
// === PHASE 66 ENFORCEMENT ===
//   The previous `createMockFeed` factory and the `useMock: true` branch
//   in `createExchangeClient` were REMOVED. The `MockExchangeFeed` class
//   lives in `packages/exchange/src/__testing__/mockFeed.ts` (test-only)
//   and is intentionally NOT importable from production code. Tests
//   import it directly via the relative path; the Bot's runtime feed
//   wire-up is always real bybit.eu (or injected via `options.feed`).

import type { ExchangeFeed } from "./feed.js";
import { BybitEuFeed, type BybitEuFeedOptions } from "./bybitEuFeed.js";

/** `ExchangeEnv` — a futtatókörnyezet módja. */
export type ExchangeEnv = "paper" | "live";

/** `ExchangeCredentials` — a környezeti változókból kiolvasott API kulcsok. */
export interface ExchangeCredentials {
  readonly apiKey: string;
  readonly secret: string;
}

/**
 * `readExchangeCredentials` — kiolvassa a `BYBIT_API_KEY` és `BYBIT_API_SECRET`
 * környezeti változókat. Ha bármelyik hiányzik, `MissingCredentialsError`-t dob.
 *
 * A függvény CSAK a környezeti változókat olvassa — a `process.env`-ben
 * tárolt értékeket SOHA nem szabad a kódba égetni.
 */
export function readExchangeCredentials(): ExchangeCredentials {
  const apiKey = process.env["BYBIT_API_KEY"];
  const secret = process.env["BYBIT_API_SECRET"];
  if (!apiKey || !secret) {
    throw new MissingCredentialsError();
  }
  return { apiKey, secret };
}

/** `MissingCredentialsError` — dobódik, ha a környezeti változók hiányoznak. */
export class MissingCredentialsError extends Error {
  constructor() {
    super(
      "Hiányzó API hitelesítő adatok. Állítsd be a BYBIT_API_KEY és BYBIT_API_SECRET környezeti változókat a .env fájlban (lásd .env.example).",
    );
    this.name = "MissingCredentialsError";
  }
}

/**
 * `detectExchangeEnv` — a `BUN_ENV` környezeti változóból kiolvassa a módot.
 * Alapértelmezetten "paper" (fail-safe).
 */
export function detectExchangeEnv(): ExchangeEnv {
  const env = process.env["BUN_ENV"];
  return env === "live" ? "live" : "paper";
}

/**
 * `createExchangeClient` — a fő factory függvény. KIZÁRÓLAG a `BybitEuFeed`
 * példányosításához (real bybit.eu, paper vagy live).
 *
 * A `MockExchangeFeed` (a unit/integration tesztekhez) külön fájlban van,
 * a `__testing__/` almappában, és NEM érhető el a production kódból —
 * lásd a fájl tetején lévő PHASE 66 ENFORCEMENT blokkot.
 *
 * Az opcionális `override` paraméterrel a kulcsok explicit megadhatók
 * (pl. smoke tesztnél vagy a `bun run paper --dry` parancsnál).
 */
export function createExchangeClient(opts: { readonly override?: ExchangeCredentials | undefined; readonly sandbox?: boolean | undefined; readonly rateLimitMs?: number | undefined }): ExchangeFeed {
  const creds = opts.override ?? readExchangeCredentials();
  const bybitOpts: BybitEuFeedOptions = {
    apiKey: creds.apiKey,
    secret: creds.secret,
    rateLimitMs: opts.rateLimitMs ?? Number.parseInt(process.env["CCXT_RATE_LIMIT_MS"] ?? "100", 10),
    sandbox: opts.sandbox ?? false,
  };
  return new BybitEuFeed(bybitOpts);
}

/** A `BybitEuFeed` re-exportja — a felsőbb rétegeknek, akiknek típus-konkrét kód kell. */
export { BybitEuFeed, type BybitEuFeedOptions } from "./bybitEuFeed.js";
