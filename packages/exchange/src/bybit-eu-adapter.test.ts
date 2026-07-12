/**
 * packages/exchange/src/bybit-eu-adapter.test.ts
 *
 * Unit tesztek a `BybitEuAdapter` CCXT Pro wrapper osztályhoz.
 *
 * A `BybitEuAdapter` a CCXT Pro `bybiteu` exchange osztályát wrap-eli —
 * minden metódus egy 1-az-1-ben delegate `this.exchange.X(...)` hívás.
 * A 100% line+branch+function coverage eléréséhez MOCKOLJUK a CCXT
 * `bybiteu` osztályát, hogy valódi hálózati hívás nélkül minden ágat
 * letesztelhessünk.
 *
 * A mock a `ccxt` modul `bybiteu` kulcsát cseréli le egy `MockBybitEu`
 * osztályra, ami rögzíti a konstruktor-argumentumokat és a metódus-
 * hívásokat. A CCXT típusok továbbra is elérhetők a `ccxt` importból
 * (csak a `bybiteu` factory-t cseréltük).
 *
 * Phase 35 Track H: az adapter korábban orphan volt (nem importálta
 * senki, így a coverage riportban sem jelent meg). Ez a teszt a
 * `mock.module` segítségével hozza be a coverage riportba.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// A CCXT típusokat a `MockBybitEu` osztály metódusainak szignatúrájában
// használjuk (a `ccxtExchange` getter visszatérési értékén keresztül).
// A CCXT típus-import nem szükséges a teszt-fájlban, mert a
// `MockBybitEu` osztály metódusai `Promise<{...}>` shape-eket adnak,
// nem CCXT típusokat.

// `mock.module` hívás a CCXT csomag `bybiteu` factory-jának
// kicseréléséhez. Ez a `BybitEuAdapter` importja ELŐTT fut le, így
// az adapter a mockolt osztályt fogja példányosítani.
//
// A `factory` visszatérési értéke a CCXT modul teljes export-alakja:
//   - `default`: a CCXT névképes exchange factory (alapértelmezett import)
//   - `bybiteu`: a `new ccxt.bybiteu(...)` híváshoz használt factory
//   - `pro`: a CCXT Pro factory (a mi adapterünk nem használja, de a
//     típus-kompatibilitás megőrzéséhez átadjuk a default-ból)
//
// A `Record<string, unknown>` típusú `ccxt` modul-export egyszerűsített
// nézet — a `bun:test` `mock.module` factory csak az általunk használt
// kulcsokat követeli meg, a többit a TS `as unknown as ...` cast-tal
// tesszük kompatibilissé.
interface MockModuleState {
  readonly lastConstructorOpts: Readonly<Record<string, unknown>> | undefined;
  readonly sandboxCalls: readonly boolean[];
  readonly watchPositionsCalls: readonly { readonly hasSymbols: boolean; readonly symbolCount: number }[];
  readonly closeCalls: number;
}

const state: MockModuleState = {
  lastConstructorOpts: undefined,
  sandboxCalls: [],
  watchPositionsCalls: [],
  closeCalls: 0,
};

class MockBybitEu {
  readonly opts: Readonly<Record<string, unknown>>;
  constructor(opts: Readonly<Record<string, unknown>>) {
    this.opts = opts;
    // A state singleton-t közvetlenül írjuk — a bun-test-ek
    // során minden példányosítás felülírja az előző értéket.
    (state as { lastConstructorOpts: Readonly<Record<string, unknown>> }).lastConstructorOpts = opts;
  }
  setSandboxMode(value: boolean): void {
    (state as { sandboxCalls: readonly boolean[] }).sandboxCalls = [
      ...state.sandboxCalls,
      value,
    ];
  }
  // === load* / fetch* metódusok — minden hívás egy azonosítható
  //     szenzitív visszatérési értéket ad, így a tesztek assertion
  //     szinten is tudják ellenőrizni, hogy a delegate működött.
  async loadMarkets(reload?: boolean): Promise<{ readonly __mock: true; readonly reload: boolean }> {
    return { __mock: true, reload: reload ?? false };
  }
  async fetchTicker(symbol: string): Promise<{ readonly __mock: true; readonly symbol: string }> {
    return { __mock: true, symbol };
  }
  async fetchOrderBook(
    symbol: string,
    limit?: number,
  ): Promise<{ readonly __mock: true; readonly symbol: string; readonly limit: number | undefined }> {
    return { __mock: true, symbol, limit };
  }
  async fetchTrades(
    symbol: string,
    since?: number,
    limit?: number,
  ): Promise<{
    readonly __mock: true;
    readonly symbol: string;
    readonly since: number | undefined;
    readonly limit: number | undefined;
  }> {
    return { __mock: true, symbol, since, limit };
  }
  async fetchOHLCV(
    symbol: string,
    timeframe: string,
    since?: number,
    limit?: number,
  ): Promise<{
    readonly __mock: true;
    readonly symbol: string;
    readonly timeframe: string;
    readonly since: number | undefined;
    readonly limit: number | undefined;
  }> {
    return { __mock: true, symbol, timeframe, since, limit };
  }
  async fetchBalance(): Promise<{ readonly __mock: true; readonly balance: string }> {
    return { __mock: true, balance: "MOCK_BALANCE" };
  }
  async createOrder(
    symbol: string,
    type: "market" | "limit",
    side: "buy" | "sell",
    amount: number,
    price?: number,
    params?: Record<string, unknown>,
  ): Promise<{
    readonly __mock: true;
    readonly symbol: string;
    readonly type: string;
    readonly side: string;
    readonly amount: number;
    readonly price: number | undefined;
    readonly params: Record<string, unknown> | undefined;
  }> {
    return { __mock: true, symbol, type, side, amount, price, params };
  }
  async cancelOrder(
    id: string,
    symbol?: string,
  ): Promise<{ readonly __mock: true; readonly id: string; readonly symbol: string | undefined }> {
    return { __mock: true, id, symbol };
  }
  // === watch* metódusok — a CCXT Pro stateful iterator-ok, a mock
  //     egy Promise-t ad vissza, ami sosem oldódik fel (a watch loop
  //     a cancelled flag-en keresztül áll le — itt a teszt nem hív
  //     watch*-ot, csak a metódus-átadást ellenőrzi).
  async watchOrderBook(
    symbol: string,
    limit: number,
  ): Promise<{ readonly __mock: true; readonly symbol: string; readonly limit: number }> {
    return { __mock: true, symbol, limit };
  }
  async watchTicker(
    symbol: string,
  ): Promise<{ readonly __mock: true; readonly symbol: string }> {
    return { __mock: true, symbol };
  }
  async watchTrades(
    symbol: string,
    since?: number,
    limit?: number,
  ): Promise<{
    readonly __mock: true;
    readonly symbol: string;
    readonly since: number | undefined;
    readonly limit: number | undefined;
  }> {
    return { __mock: true, symbol, since, limit };
  }
  async watchOHLCV(
    symbol: string,
    timeframe: string,
    since?: number,
    limit?: number,
  ): Promise<{
    readonly __mock: true;
    readonly symbol: string;
    readonly timeframe: string;
    readonly since: number | undefined;
    readonly limit: number | undefined;
  }> {
    return { __mock: true, symbol, timeframe, since, limit };
  }
  async watchOrders(
    symbol: string,
    since?: number,
    limit?: number,
  ): Promise<{
    readonly __mock: true;
    readonly symbol: string;
    readonly since: number | undefined;
    readonly limit: number | undefined;
  }> {
    return { __mock: true, symbol, since, limit };
  }
  async watchBalance(): Promise<{ readonly __mock: true }> {
    return { __mock: true };
  }
  async watchPositions(
    symbols?: string[],
  ): Promise<{
    readonly __mock: true;
    readonly hasSymbols: boolean;
    readonly symbolCount: number;
  }> {
    const result = { __mock: true, hasSymbols: symbols !== undefined, symbolCount: symbols?.length ?? 0 };
    (state as { watchPositionsCalls: readonly unknown[] }).watchPositionsCalls = [
      ...state.watchPositionsCalls,
      result,
    ];
    return result;
  }
  // A CCXT Pro WS client-nek van `close` metódusa is — a mi adapterünk
  // `close()`-ja nem hívja, de a típus-kompatibilitáshoz itt van.
  close(): void {
    (state as { closeCalls: number }).closeCalls = state.closeCalls + 1;
  }
}

// A CCXT modul mock — a `default` export az a névképes factory object,
// amiből a `new ccxt.bybiteu(...)` hívás származik. A `bybiteu` kulcs
// a `ccxt.bybiteu` namespace-szintű alternatíva.
//
// A `Record<string, unknown>` típus a bun-test mock.module factory
// egyszerűsített contract-ja; a `default`-ot `any`-ként kezeljük,
// mert a CCXT `Exchange` típusa túl összetett egy mock-hoz.
const mockModule = {
  default: {
    bybiteu: MockBybitEu,
  },
  bybiteu: MockBybitEu,
} as unknown as { default: { bybiteu: unknown }; bybiteu: unknown };

mock.module("ccxt", () => mockModule);

// A `BybitEuAdapter` importja a mock beállítása UTÁN történik — a
// `mock.module` a bun module loader-ét patch-eli, így az adapter
// a mockolt `ccxt.bybiteu`-t fogja használni.
//
// Fontos: ez a `import` a `mock.module` hívás UTÁN kell legyen, de
// a TypeScript/bun az `import` utasításokat a fájl tetejére emeli.
// A bun-test futtató specifikusan kezeli ezt az esetet: a `mock.module`
// szinkronban fut, mielőtt a többi import feloldódna.
const { BybitEuAdapter } = await import("./bybit-eu-adapter.js");

// === Helpers ===

function resetState(): void {
  (state as { lastConstructorOpts: Readonly<Record<string, unknown>> | undefined }).lastConstructorOpts = undefined;
  (state as { sandboxCalls: readonly boolean[] }).sandboxCalls = [];
  (state as { watchPositionsCalls: readonly unknown[] }).watchPositionsCalls = [];
  (state as { closeCalls: number }).closeCalls = 0;
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  resetState();
});

// === Konstruktor + identifier tesztek ===

describe("BybitEuAdapter — identifier + constructor", () => {
  it("alapértelmezett konstruktor: rateLimit 100, enableRateLimit true, no apiKey/secret, no sandbox", () => {
    const adapter = new BybitEuAdapter();
    expect(adapter.id).toBe("bybiteu");
    expect(adapter.name).toBe("Bybit EU");
    expect(state.lastConstructorOpts).toBeDefined();
    expect(state.lastConstructorOpts?.["enableRateLimit"]).toBe(true);
    expect(state.lastConstructorOpts?.["rateLimit"]).toBe(100);
    expect(state.lastConstructorOpts?.["apiKey"]).toBeUndefined();
    expect(state.lastConstructorOpts?.["secret"]).toBeUndefined();
    // Alapértelmezetten NEM hívunk setSandboxMode-ot.
    expect(state.sandboxCalls).toEqual([]);
  });

  it("konstruktor apiKey+secret opciókkal: a CCXT megkapja mindkettőt", () => {
    const adapter = new BybitEuAdapter({
      apiKey: "test-api-key",
      secret: "test-secret",
    });
    expect(adapter.id).toBe("bybiteu");
    expect(state.lastConstructorOpts?.["apiKey"]).toBe("test-api-key");
    expect(state.lastConstructorOpts?.["secret"]).toBe("test-secret");
    expect(state.lastConstructorOpts?.["rateLimit"]).toBe(100);
    expect(state.sandboxCalls).toEqual([]);
  });

  it("konstruktor custom rateLimitMs opcióval: a CCXT rateLimit a megadott értéket kapja", () => {
    const adapter = new BybitEuAdapter({ rateLimitMs: 250 });
    void adapter; // adapter használva van a konstruktor mellékhatásában (mock state capture)
    expect(state.lastConstructorOpts?.["rateLimit"]).toBe(250);
    expect(state.lastConstructorOpts?.["enableRateLimit"]).toBe(true);
  });

  it("konstruktor sandbox=true opcióval: setSandboxMode(true) hívódik", () => {
    const adapter = new BybitEuAdapter({ sandbox: true });
    expect(state.sandboxCalls).toEqual([true]);
    // A ccxtExchange getter visszaadja a mock példányt.
    expect(adapter.ccxtExchange).toBeInstanceOf(MockBybitEu);
  });

  it("konstruktor sandbox=false opcióval: setSandboxMode NEM hívódik", () => {
    const adapter = new BybitEuAdapter({ sandbox: false });
    void adapter; // adapter használva van a konstruktor mellékhatásában (mock state capture)
    expect(state.sandboxCalls).toEqual([]);
  });

  it("konstruktor az összes opcióval együtt: minden érték átadódik a CCXT-nek", () => {
    const adapter = new BybitEuAdapter({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 50,
      sandbox: true,
    });
    void adapter; // adapter használva van a konstruktor mellékhatásában (mock state capture)
    expect(state.lastConstructorOpts).toMatchObject({
      apiKey: "k",
      secret: "s",
      rateLimit: 50,
      enableRateLimit: true,
    });
    expect(state.sandboxCalls).toEqual([true]);
  });
});

// === ccxtExchange getter teszt ===

describe("BybitEuAdapter — ccxtExchange getter", () => {
  it("visszaadja a belső CCXT exchange példányt", () => {
    const adapter = new BybitEuAdapter();
    const ex = adapter.ccxtExchange;
    expect(ex).toBeDefined();
    expect(typeof ex.loadMarkets).toBe("function");
  });
});

// === load* / fetch* metódus delegate tesztek ===

describe("BybitEuAdapter — load* / fetch* delegation", () => {
  it("loadMarkets(reload?) továbbítja a reload flag-et", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.loadMarkets(true);
    expect(r).toEqual({ __mock: true, reload: true });
  });

  it("loadMarkets() reload nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.loadMarkets();
    expect(r).toEqual({ __mock: true, reload: false });
  });

  it("fetchTicker(symbol) továbbítja a symbol-t", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.fetchTicker("BTC/USDC");
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC" });
  });

  it("fetchOrderBook(symbol, limit) továbbítja mindkét paramétert", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.fetchOrderBook("ETH/USDC", 20);
    expect(r).toEqual({ __mock: true, symbol: "ETH/USDC", limit: 20 });
  });

  it("fetchOrderBook(symbol) limit nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.fetchOrderBook("ETH/USDC");
    expect(r).toEqual({ __mock: true, symbol: "ETH/USDC", limit: undefined });
  });

  it("fetchTrades(symbol, since?, limit?) továbbítja az összes paramétert", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.fetchTrades("BTC/USDC", 1_700_000_000_000, 50);
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: 1_700_000_000_000,
      limit: 50,
    });
  });

  it("fetchTrades(symbol) since/limit nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.fetchTrades("BTC/USDC");
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: undefined,
      limit: undefined,
    });
  });

  it("fetchOHLCV(symbol, timeframe, since?, limit?) továbbítja az összes paramétert", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.fetchOHLCV("BTC/USDC", "1h", 1_700_000_000_000, 100);
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      timeframe: "1h",
      since: 1_700_000_000_000,
      limit: 100,
    });
  });

  it("fetchOHLCV(symbol, timeframe) since/limit nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.fetchOHLCV("BTC/USDC", "4h");
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      timeframe: "4h",
      since: undefined,
      limit: undefined,
    });
  });

  it("fetchBalance() a CCXT fetchBalance delegate-jét hívja", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.fetchBalance();
    expect(r).toEqual({ __mock: true, balance: "MOCK_BALANCE" });
  });
});

// === createOrder / cancelOrder delegation ===

describe("BybitEuAdapter — order management delegation", () => {
  it("createOrder(symbol, type, side, amount, price?, params?) mindent továbbít", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.createOrder("BTC/USDC", "limit", "buy", 0.5, 50_000, {
      timeInForce: "GTC",
    });
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      type: "limit",
      side: "buy",
      amount: 0.5,
      price: 50_000,
      params: { timeInForce: "GTC" },
    });
  });

  it("createOrder market típussal, price és params nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.createOrder("BTC/USDC", "market", "sell", 0.1);
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      type: "market",
      side: "sell",
      amount: 0.1,
      price: undefined,
      params: undefined,
    });
  });

  it("cancelOrder(id, symbol?) továbbítja mindkét paramétert", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.cancelOrder("order-123", "BTC/USDC");
    expect(r).toEqual({ __mock: true, id: "order-123", symbol: "BTC/USDC" });
  });

  it("cancelOrder(id) symbol nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.cancelOrder("order-123");
    expect(r).toEqual({ __mock: true, id: "order-123", symbol: undefined });
  });
});

// === watch* metódus delegate tesztek ===

describe("BybitEuAdapter — watch* delegation", () => {
  it("watchOrderBook(symbol, limit) továbbítja a paramétereket", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchOrderBook("BTC/USDC", 25);
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC", limit: 25 });
  });

  it("watchOrderBook(symbol, limit) az _opts paramétert figyelmen kívül hagyja (default {})", async () => {
    const adapter = new BybitEuAdapter();
    // A `WatchOptions` típusú `_opts` paramétert a CCXT Pro jelenleg
    // nem használja — a metódus csak a symbol+limit-et adja tovább.
    const r = await adapter.watchOrderBook("BTC/USDC", 25, { since: 12345 });
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC", limit: 25 });
  });

  it("watchTicker(symbol) továbbítja a symbol-t", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchTicker("BTC/USDC");
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC" });
  });

  it("watchTicker(symbol) az _opts paramétert figyelmen kívül hagyja (default {})", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchTicker("BTC/USDC", { since: 999 });
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC" });
  });

  it("watchTrades(symbol, opts) since/limit értékeket kinyeri az opts-ból", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchTrades("BTC/USDC", { since: 1_700_000_000_000, limit: 100 });
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: 1_700_000_000_000,
      limit: 100,
    });
  });

  it("watchTrades(symbol) opts nélkül is hívható (default {})", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchTrades("BTC/USDC");
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: undefined,
      limit: undefined,
    });
  });

  it("watchOHLCV(symbol, timeframe, opts) since/limit értékeket kinyeri az opts-ból", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchOHLCV("BTC/USDC", "1h", {
      since: 1_700_000_000_000,
      limit: 200,
    });
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      timeframe: "1h",
      since: 1_700_000_000_000,
      limit: 200,
    });
  });

  it("watchOHLCV(symbol, timeframe) opts nélkül is hívható (default {})", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchOHLCV("BTC/USDC", "4h");
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      timeframe: "4h",
      since: undefined,
      limit: undefined,
    });
  });

  it("watchOrders(symbol, opts) since/limit értékeket kinyeri az opts-ból", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchOrders("BTC/USDC", { since: 1_700_000_000_000, limit: 50 });
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: 1_700_000_000_000,
      limit: 50,
    });
  });

  it("watchOrders(symbol) opts nélkül is hívható (default {})", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchOrders("BTC/USDC");
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: undefined,
      limit: undefined,
    });
  });

  it("watchBalance(_opts) a CCXT watchBalance delegate-jét hívja", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchBalance();
    expect(r).toEqual({ __mock: true });
  });

  it("watchPositions(symbols) a symbols tömböt adja tovább a CCXT-nek", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchPositions(["BTC/USDC", "ETH/USDC"]);
    expect(r).toEqual({ __mock: true, hasSymbols: true, symbolCount: 2 });
  });

  it("watchPositions(undefined) az 'undefined' ágat futtatja (no symbols filter)", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchPositions();
    expect(r).toEqual({ __mock: true, hasSymbols: false, symbolCount: 0 });
  });

  it("watchPositions(symbols?: ...) a _opts paramétert figyelmen kívül hagyja (default {})", async () => {
    const adapter = new BybitEuAdapter();
    const r = await adapter.watchPositions(["BTC/USDC"], { since: 1 });
    expect(r).toEqual({ __mock: true, hasSymbols: true, symbolCount: 1 });
  });
});

// === close() — no-op ===

describe("BybitEuAdapter — close()", () => {
  it("close() nem dob (no-op, a CCXT Pro watch ciklusok a consumer kilépésével állnak le)", () => {
    const adapter = new BybitEuAdapter();
    expect(() => adapter.close()).not.toThrow();
  });
});

// === watchPositions(symbols) elágazás: a symbols === undefined branch ===
//
// A `watchPositions(symbols?: string[], _opts = {})` metódus két ágat
// tartalmaz: ha a `symbols` undefined, a CCXT `watchPositions(undefined)`-
// et hívja; ha definiált, a `watchPositions(symbols)`-ot. A fenti
// tesztek mindkét ágat lefedik — ez a teszt kifejezetten a type-narrowing
// assertiót teszi meg a `hasSymbols` flag-en keresztül.

describe("BybitEuAdapter — watchPositions branch coverage", () => {
  it("watchPositions(undefined) a CCXT watchPositions(undefined) ágat hívja", async () => {
    const adapter = new BybitEuAdapter();
    await adapter.watchPositions();
    expect(state.watchPositionsCalls).toEqual([
      { __mock: true, hasSymbols: false, symbolCount: 0 },
    ]);
  });

  it("watchPositions(symbols) a CCXT watchPositions(symbols) ágat hívja", async () => {
    const adapter = new BybitEuAdapter();
    await adapter.watchPositions(["BTC/USDC"]);
    expect(state.watchPositionsCalls).toEqual([
      { __mock: true, hasSymbols: true, symbolCount: 1 },
    ]);
  });
});

// Type-only assertion: a `BybitEuAdapter` megvalósítja a shared
// `ExchangeFeed` interface-t. A shared típus `id` mezőt használ
// (nem `exchangeId`-et, mint a lokális `feed.ts` ExchangeFeed).
import type { ExchangeFeed } from "@mm-crypto-bot/shared";

describe("BybitEuAdapter — type contract", () => {
  it("implementálja a shared ExchangeFeed interface-t (type assertion)", () => {
    const adapter: ExchangeFeed = new BybitEuAdapter();
    expect(adapter.id).toBe("bybiteu");
    expect(adapter.name).toBe("Bybit EU");
  });
});
