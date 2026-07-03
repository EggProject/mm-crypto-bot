// packages/exchange/src/index.ts — `@mm/exchange` belépési pont
//
// FELADAT: A `@mm/exchange` csomag a CCXT Pro REST + WS illesztése a bybit.eu
// exchange-hez. A CCXT Pro ugyanabban a `ccxt` csomagban van (nincs külön
// `ccxt-pro` npm csomag 4.x óta). A kiválasztott exchange ID a `bybiteu`
// (NEM `bybit` — a két hoszt és asset-lista eltérő).
//
// Részletek: docs/research/stack-findings.md §1.4 (sandbox hiány) és
// docs/research/selected-strategy.md §4 (rate-limit ajánlás).
//
// A scaffold fázisban csak a típus-definíciók és a `createExchangeClient`
// factory placeholder van itt — a tényleges implementáció a későbbi fázisokban.

export interface ExchangeClientOptions {
  readonly apiKey: string;
  readonly secret: string;
  readonly rateLimitMs: number;
  readonly sandbox: boolean;
}

export interface ExchangeClient {
  /** A CCXT példányhoz való hozzáférés (a felsőbb rétegek csak a metódusain keresztül érjék el). */
  readonly raw: unknown;
  readonly exchangeId: string;
}

export function createExchangeClient(_opts: ExchangeClientOptions): ExchangeClient {
  // A későbbi fázisban:
  //   import ccxt from "ccxt";
  //   const client = new ccxt.bybiteu({ ...opts, enableRateLimit: true });
  //   if (opts.sandbox) client.setSandboxMode(true);
  //   return { raw: client, exchangeId: "bybiteu" };
  throw new Error("not implemented yet: @mm/exchange createExchangeClient — későbbi fázisban implementálandó");
}
