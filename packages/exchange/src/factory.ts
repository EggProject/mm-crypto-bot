// packages/exchange/src/factory.ts — exchange feed factory-k
//
// FELADAT: A factory-k egyetlen belépési pontot adnak a `BybitEuFeed` és
// a `MockExchangeFeed` példányosításához. A `createExchangeClient`
// factory a környezeti változókból (`BYBIT_API_KEY`, `BYBIT_API_SECRET`)
// olvassa a hitelesítő adatokat, és a `BUN_ENV` értéke alapján dönti el,
// hogy melyik feed-et adja vissza.
//
// FONTOS (fail-safe): a rendszer ALAPÉRTELMEZETTEN paper módban indul —
// ha `BUN_ENV === "live"` ÉS a `BYBIT_API_KEY`/`BYBIT_API_SECRET` nincs
// beállítva, dobunk. Ellenkező esetben a `BUN_ENV` értékétől függetlenül
// mindig a `BybitEuFeed`-et adjuk vissza (mert a paper mód a valódi
// WS feedre épül — lásd `docs/research/stack-findings.md` §1.4).
//
// A `createMockFeed` factory a unit tesztek és a `bun run paper --dry`
// smoke teszthez használható. Soha ne hívd production kódból!

import type { ExchangeFeed } from "./feed.js";
import { BybitEuFeed, type BybitEuFeedOptions } from "./bybitEuFeed.js";
import { MockExchangeFeed, type MockExchangeFeedOptions } from "./mockFeed.js";

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
 * `createExchangeClient` — a fő factory függvény.
 * - Ha a `useMock` true, egy `MockExchangeFeed`-et ad vissza.
 * - Ha a `useMock` false, a környezeti változókból olvasott kulcsokkal
 *   egy `BybitEuFeed`-et hoz létre.
 *
 * A függvény opcionálisan fogad egy `Override`-et, amivel a kulcsok
 * explicit megadhatók (pl. smoke tesztnél vagy a `bun run paper --dry` parancsnál).
 */
export function createExchangeClient(opts: { readonly useMock: boolean; readonly override?: ExchangeCredentials | undefined; readonly sandbox?: boolean | undefined; readonly rateLimitMs?: number | undefined }): ExchangeFeed {
  if (opts.useMock) {
    return new MockExchangeFeed();
  }
  const creds = opts.override ?? readExchangeCredentials();
  const bybitOpts: BybitEuFeedOptions = {
    apiKey: creds.apiKey,
    secret: creds.secret,
    rateLimitMs: opts.rateLimitMs ?? Number.parseInt(process.env["CCXT_RATE_LIMIT_MS"] ?? "100", 10),
    sandbox: opts.sandbox ?? false,
  };
  return new BybitEuFeed(bybitOpts);
}

/**
 * `createMockFeed` — explicit mock feed factory, opciókkal együtt.
 * A unit tesztek és a `bun run paper --dry` smoke teszt használja.
 */
export function createMockFeed(opts: MockExchangeFeedOptions = {}): MockExchangeFeed {
  return new MockExchangeFeed(opts);
}

/** A `BybitEuFeed` re-exportja — a felsőbb rétegeknek, akiknek típus-konkrét kód kell. */
export { BybitEuFeed, type BybitEuFeedOptions } from "./bybitEuFeed.js";
export { MockExchangeFeed, type MockExchangeFeedOptions } from "./mockFeed.js";
export type { MockExchangeFeedOptions as MockFeedOptions } from "./mockFeed.js";
