/**
 * packages/exchange/src/bybit-eu-adapter.test.ts
 *
 * Unit tesztek a `BybitEuAdapter` CCXT Pro wrapper osztályhoz.
 *
 * A `BybitEuAdapter` a CCXT Pro `bybiteu` exchange osztályát wrap-eli —
 * minden metódus egy 1-az-1-ben delegate `this.exchange.X(...)` hívás.
 * A 100% line+branch+function coverage eléréséhez egy MockBybitEu
 * osztályt adunk át az adapter `exchange` constructor opcióján
 * (dependency injection) — így NEM kell a teljes `ccxt` modult
 * `mock.module`-dal patch-elnünk (ami az előző implementációban a
 * `LatencyMonitor` tesztet elrontotta, mert a mock a `pro` mezőt
 * elvesztette).
 *
 * A `MockBybitEu` rögzíti a `setSandboxMode` hívásokat és minden
 * watch* metódus argumentumát a `state` singleton-on keresztül, hogy
 * a tesztek assertion szinten is tudják ellenőrizni a delegate-eket.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BybitEuAdapter } from "./bybit-eu-adapter.js";

// === Mock state ===

interface MockModuleState {
  readonly sandboxCalls: readonly boolean[];
  readonly watchPositionsCalls: readonly { readonly hasSymbols: boolean; readonly symbolCount: number }[];
  readonly closeCalls: number;
}

const state: MockModuleState = {
  sandboxCalls: [],
  watchPositionsCalls: [],
  closeCalls: 0,
};

/**
 * `MockBybitEu` — a CCXT Pro bybiteu interface minimális mock-ja.
 * Minden metódus azonosítható mock-shape visszatérési értéket ad,
 * hogy a tesztek ellenőrizni tudják a delegate hívásokat.
 *
 * A `BybitEuAdapter` `exchange` constructor opcióján keresztül
 * injektáljuk, így nem kell a teljes `ccxt` modult mockolni.
 */
class MockBybitEu {
  setSandboxMode(value: boolean): void {
    (state as { sandboxCalls: readonly boolean[] }).sandboxCalls = [
      ...state.sandboxCalls,
      value,
    ];
  }
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
  close(): void {
    (state as { closeCalls: number }).closeCalls = state.closeCalls + 1;
  }
}

// === Helpers ===

/**
 * `makeMock` — minden teszt híváskor új MockBybitEu példányt ad.
 * A `state` singleton marad, hogy a tesztek lássák a hívásokat.
 */
function makeMock(): MockBybitEu {
  return new MockBybitEu();
}

function resetState(): void {
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
  it("alapértelmezett konstruktor: id='bybiteu', name='Bybit EU'", () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    expect(adapter.id).toBe("bybiteu");
    expect(adapter.name).toBe("Bybit EU");
  });

  it("alapértelmezett konstruktor: NEM hívunk setSandboxMode-ot (a DI mock az exchange, nincs CCXT init)", () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    void adapter;
    expect(state.sandboxCalls).toEqual([]);
  });

  it("konstruktor az összes opcióval együtt: az exchange opció felülírja a többit", () => {
    const adapter = new BybitEuAdapter({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 50,
      sandbox: true,
      exchange: makeMock(),
    });
    void adapter;
    // A DI esetén a sandbox flag NEM hív setSandboxMode-ot — a
    // consumer felelőssége a mock-on (vagy a CCXT-n) beállítani.
    expect(state.sandboxCalls).toEqual([]);
  });
});

// === ccxtExchange getter teszt ===

describe("BybitEuAdapter — ccxtExchange getter", () => {
  it("visszaadja a belső exchange példányt (a DI mock-ot)", () => {
    const mock = makeMock();
    const adapter = new BybitEuAdapter({ exchange: mock });
    expect(adapter.ccxtExchange).toBe(mock);
  });
});

// === load* / fetch* delegation ===

describe("BybitEuAdapter — load* / fetch* delegation", () => {
  it("loadMarkets() delegálódik a mock-hoz", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.loadMarkets();
    expect(r).toEqual({ __mock: true, reload: false });
  });

  it("loadMarkets(true) a reload flag-et továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.loadMarkets(true);
    expect(r).toEqual({ __mock: true, reload: true });
  });

  it("fetchTicker(symbol) delegálódik", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.fetchTicker("BTC/USDC");
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC" });
  });

  it("fetchOrderBook(symbol) a limit nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.fetchOrderBook("BTC/USDC");
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC", limit: undefined });
  });

  it("fetchOrderBook(symbol, limit) a limit paramétert továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.fetchOrderBook("BTC/USDC", 50);
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC", limit: 50 });
  });

  it("fetchTrades(symbol) az opcionális paraméterek nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.fetchTrades("BTC/USDC");
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC", since: undefined, limit: undefined });
  });

  it("fetchTrades(symbol, since, limit) a since+limit értékeket továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.fetchTrades("BTC/USDC", 1_700_000_000_000, 100);
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC", since: 1_700_000_000_000, limit: 100 });
  });

  it("fetchOHLCV(symbol, timeframe) az opcionális paraméterek nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.fetchOHLCV("BTC/USDC", "1h");
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      timeframe: "1h",
      since: undefined,
      limit: undefined,
    });
  });

  it("fetchOHLCV(symbol, timeframe, since, limit) minden paramétert továbbít", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.fetchOHLCV("BTC/USDC", "4h", 1_700_000_000_000, 500);
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      timeframe: "4h",
      since: 1_700_000_000_000,
      limit: 500,
    });
  });

  it("fetchBalance() a balance mock értéket adja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.fetchBalance();
    expect(r).toEqual({ __mock: true, balance: "MOCK_BALANCE" });
  });
});

// === order management delegation ===

describe("BybitEuAdapter — order management delegation", () => {
  it("createOrder() limit típussal, price+params értékekkel", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.createOrder("BTC/USDC", "limit", "buy", 0.5, 60_000, { timeInForce: "GTC" });
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      type: "limit",
      side: "buy",
      amount: 0.5,
      price: 60_000,
      params: { timeInForce: "GTC" },
    });
  });

  it("createOrder() market típussal, price/params nélkül", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.createOrder("BTC/USDC", "market", "sell", 0.5);
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      type: "market",
      side: "sell",
      amount: 0.5,
      price: undefined,
      params: undefined,
    });
  });

  it("cancelOrder(id) symbol nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.cancelOrder("order-123");
    expect(r).toEqual({ __mock: true, id: "order-123", symbol: undefined });
  });

  it("cancelOrder(id, symbol) mindkét paramétert továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.cancelOrder("order-123", "BTC/USDC");
    expect(r).toEqual({ __mock: true, id: "order-123", symbol: "BTC/USDC" });
  });
});

// === watch* delegation ===

describe("BybitEuAdapter — watch* delegation", () => {
  it("watchOrderBook(symbol, limit) a limit paramétert továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchOrderBook("BTC/USDC", 25);
    expect(r).toEqual({ __mock: true, symbol: "BTC/USDC", limit: 25 });
  });

  it("watchTicker(symbol) a symbol paramétert továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchTicker("ETH/USDC");
    expect(r).toEqual({ __mock: true, symbol: "ETH/USDC" });
  });

  it("watchTrades(symbol, opts) since/limit értékeket kinyeri az opts-ból", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchTrades("BTC/USDC", { since: 1_700_000_000_000, limit: 100 });
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: 1_700_000_000_000,
      limit: 100,
    });
  });

  it("watchTrades(symbol) opts nélkül is hívható (default {})", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchTrades("BTC/USDC");
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: undefined,
      limit: undefined,
    });
  });

  it("watchOHLCV(symbol, timeframe, opts) minden paramétert továbbít", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchOHLCV("BTC/USDC", "4h", { since: 1_700_000_000_000, limit: 200 });
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      timeframe: "4h",
      since: 1_700_000_000_000,
      limit: 200,
    });
  });

  it("watchOHLCV(symbol, timeframe) opts nélkül is hívható (default {})", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
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
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchOrders("BTC/USDC", { since: 1_700_000_000_000, limit: 50 });
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: 1_700_000_000_000,
      limit: 50,
    });
  });

  it("watchOrders(symbol) opts nélkül is hívható (default {})", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchOrders("BTC/USDC");
    expect(r).toEqual({
      __mock: true,
      symbol: "BTC/USDC",
      since: undefined,
      limit: undefined,
    });
  });

  it("watchBalance(_opts) a CCXT watchBalance delegate-jét hívja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchBalance();
    expect(r).toEqual({ __mock: true });
  });

  it("watchPositions(symbols) a symbols tömböt adja tovább a CCXT-nek", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchPositions(["BTC/USDC", "ETH/USDC"]);
    expect(r).toEqual({ __mock: true, hasSymbols: true, symbolCount: 2 });
  });

  it("watchPositions(undefined) az 'undefined' ágat futtatja (no symbols filter)", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchPositions();
    expect(r).toEqual({ __mock: true, hasSymbols: false, symbolCount: 0 });
  });

  it("watchPositions(symbols?: ...) a _opts paramétert figyelmen kívül hagyja (default {})", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    const r = await adapter.watchPositions(["BTC/USDC"], { since: 1 });
    expect(r).toEqual({ __mock: true, hasSymbols: true, symbolCount: 1 });
  });
});

// === close() — no-op ===

describe("BybitEuAdapter — close()", () => {
  it("close() nem dob (no-op, a CCXT Pro watch ciklusok a consumer kilépésével állnak le)", () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    expect(() => adapter.close()).not.toThrow();
  });
});

// === watchPositions(symbols) elágazás: a symbols === undefined branch ===

describe("BybitEuAdapter — watchPositions branch coverage", () => {
  it("watchPositions(undefined) a CCXT watchPositions(undefined) ágat hívja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchPositions();
    expect(state.watchPositionsCalls).toEqual([
      { __mock: true, hasSymbols: false, symbolCount: 0 },
    ]);
  });

  it("watchPositions(symbols) a CCXT watchPositions(symbols) ágat hívja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchPositions(["BTC/USDC"]);
    expect(state.watchPositionsCalls).toEqual([
      { __mock: true, hasSymbols: true, symbolCount: 1 },
    ]);
  });
});

// === type contract ===

describe("BybitEuAdapter — type contract", () => {
  it("implementálja a shared ExchangeFeed interface-t (id field, name field)", () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    expect(typeof adapter.id).toBe("string");
    expect(typeof adapter.name).toBe("string");
    expect(typeof adapter.loadMarkets).toBe("function");
    expect(typeof adapter.fetchTicker).toBe("function");
    expect(typeof adapter.watchOrderBook).toBe("function");
  });
});
