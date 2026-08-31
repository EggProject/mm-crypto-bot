/**
 * CCXT Pro delegation contract with an injected deterministic exchange fake.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BybitEuAdapter, type BybitEuAdapterClient, type BybitEuAdapterOptions } from "./bybit-eu-adapter.js";
import { withCapturedBybitEuConstructor } from "./bybit-eu-feed.test-support.js";
import {
  mockBalances,
  mockMarkets,
  mockOhlcvs,
  mockOrder,
  mockOrderBook,
  mockOrders,
  mockPositions,
  mockTicker,
  mockTrades,
  orderBookWith,
  orderWith,
  tickerWith,
} from "./bybit-eu-adapter.test-support.js";

/**
 * Mock state.
 */

interface MockModuleState {
  watchPositionsCalls: readonly string[] | undefined;
  closeCalls: number;
  lastCall: readonly unknown[];
}

const state: MockModuleState = {
  watchPositionsCalls: [],
  closeCalls: 0,
  lastCall: [],
};

/**
 * Deterministic fake that implements only the public adapter client port.
 */
class MockBybitEu implements BybitEuAdapterClient {
  readonly loadMarkets: BybitEuAdapterClient["loadMarkets"] = (...arguments_) => {
    state.lastCall = ["loadMarkets", ...arguments_];
    return Promise.resolve(mockMarkets());
  };
  readonly fetchTicker: BybitEuAdapterClient["fetchTicker"] = (...arguments_) => {
    state.lastCall = ["fetchTicker", ...arguments_];
    return Promise.resolve(mockTicker(arguments_[0]));
  };
  readonly fetchOrderBook: BybitEuAdapterClient["fetchOrderBook"] = (...arguments_) => {
    state.lastCall = ["fetchOrderBook", ...arguments_];
    return Promise.resolve(mockOrderBook(arguments_[0]));
  };
  readonly fetchTrades: BybitEuAdapterClient["fetchTrades"] = (...arguments_) => {
    state.lastCall = ["fetchTrades", ...arguments_];
    return Promise.resolve(mockTrades());
  };
  readonly fetchOHLCV: BybitEuAdapterClient["fetchOHLCV"] = (...arguments_) => {
    state.lastCall = ["fetchOHLCV", ...arguments_];
    return Promise.resolve(mockOhlcvs());
  };
  readonly fetchBalance: BybitEuAdapterClient["fetchBalance"] = (...arguments_) => {
    state.lastCall = ["fetchBalance", ...arguments_];
    return Promise.resolve(mockBalances());
  };
  readonly createOrder: BybitEuAdapterClient["createOrder"] = (...arguments_) => {
    state.lastCall = ["createOrder", ...arguments_];
    return Promise.resolve(mockOrder(arguments_[0]));
  };
  readonly cancelOrder: BybitEuAdapterClient["cancelOrder"] = (...arguments_) => {
    state.lastCall = ["cancelOrder", ...arguments_];
    return Promise.resolve(mockOrder(arguments_[1] ?? "BTC/USDC"));
  };
  readonly watchOrderBook: BybitEuAdapterClient["watchOrderBook"] = (...arguments_) => {
    state.lastCall = ["watchOrderBook", ...arguments_];
    return Promise.resolve(mockOrderBook(arguments_[0]));
  };
  readonly watchTicker: BybitEuAdapterClient["watchTicker"] = (...arguments_) => {
    state.lastCall = ["watchTicker", ...arguments_];
    return Promise.resolve(mockTicker(arguments_[0]));
  };
  readonly watchTrades: BybitEuAdapterClient["watchTrades"] = (...arguments_) => {
    state.lastCall = ["watchTrades", ...arguments_];
    return Promise.resolve(mockTrades());
  };
  readonly watchOHLCV: BybitEuAdapterClient["watchOHLCV"] = (...arguments_) => {
    state.lastCall = ["watchOHLCV", ...arguments_];
    return Promise.resolve(mockOhlcvs());
  };
  readonly watchOrders: BybitEuAdapterClient["watchOrders"] = (...arguments_) => {
    state.lastCall = ["watchOrders", ...arguments_];
    return Promise.resolve(mockOrders(arguments_[0] ?? "BTC/USDC"));
  };
  readonly watchBalance: BybitEuAdapterClient["watchBalance"] = (...arguments_) => {
    state.lastCall = ["watchBalance", ...arguments_];
    return Promise.resolve(mockBalances());
  };
  readonly watchPositions: BybitEuAdapterClient["watchPositions"] = (symbols) => {
    state.watchPositionsCalls = symbols;
    state.lastCall = ["watchPositions", symbols];
    return Promise.resolve(mockPositions());
  };
}

/**
 * Helpers.
 */

/**
 * `makeMock` — minden teszt híváskor új MockBybitEu példányt ad.
 * A `state` singleton marad, hogy a tesztek lássák a hívásokat.
 */
function makeMock(): BybitEuAdapterClient {
  return new MockBybitEu();
}

function resetState(): void {
  state.watchPositionsCalls = undefined;
  state.closeCalls = 0;
  state.lastCall = [];
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  resetState();
});

/**
 * Constructor and identifier tests.
 */

describe("BybitEuAdapter — identifier + constructor", () => {
  it("alapértelmezett konstruktor: id='bybiteu', name='Bybit EU'", () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    expect(adapter.id).toBe("bybiteu");
    expect(adapter.name).toBe("Bybit EU");
  });

  it("constructs the WebSocket-capable CCXT Pro client by default", () => {
    withCapturedBybitEuConstructor((capture) => {
      const adapter = new BybitEuAdapter();

      expect(capture.calls()).toBe(1);
      expect(capture.client()).toBeDefined();
      expect(Reflect.has(adapter, "ccxtExchange")).toBe(false);
    });
  });

  it("constructs the WebSocket-capable CCXT Pro client with injected credentials", () => {
    withCapturedBybitEuConstructor((capture) => {
      new BybitEuAdapter({ apiKey: "adapter-test-key", secret: "adapter-test-secret" });

      expect(capture.calls()).toBe(1);
      expect(capture.options()).toMatchObject({ apiKey: "adapter-test-key", secret: "adapter-test-secret" });
    });
  });

  it("does not require a sandbox method from an injected client", () => {
    const injectedClient = makeMock();
    withCapturedBybitEuConstructor((capture) => {
      const adapter = new BybitEuAdapter({ exchange: injectedClient });

      expect(capture.calls()).toBe(0);
      expect(Reflect.has(adapter, "ccxtExchange")).toBe(false);
    });
  });
});

type AdapterOptionsExcludeSandbox = "sandbox" extends keyof BybitEuAdapterOptions ? false : true;
type AdapterClientExcludesSandboxActivation = "setSandboxMode" extends keyof BybitEuAdapterClient
  ? false
  : true;
type AdapterExcludesRawClient = "ccxtExchange" extends keyof BybitEuAdapter ? false : true;

const hasNoSandboxOption: AdapterOptionsExcludeSandbox = true;
const hasNoSandboxActivationMethod: AdapterClientExcludesSandboxActivation = true;
const hasNoRawClient: AdapterExcludesRawClient = true;

describe("BybitEuAdapter — public sandbox boundary", () => {
  it("does not expose sandbox activation or a raw client in its public types", () => {
    expect(hasNoSandboxOption).toBe(true);
    expect(hasNoSandboxActivationMethod).toBe(true);
    expect(hasNoRawClient).toBe(true);
  });
});

describe("BybitEuAdapter test support", () => {
  it("creates explicit helper overrides and a canonical six-field order book", () => {
    const ticker = tickerWith("BTC/USDC", { bid: 59_999 });
    const order = orderWith("BTC/USDC", { status: "closed" });
    const orderBook = orderBookWith("BTC/USDC", {
      asks: [[60_001, 2]],
      bids: [[59_999, 3]],
    });
    expect(ticker.bid).toBe(59_999);
    expect(order.status).toBe("closed");
    expect(orderBook).toEqual({
      symbol: "BTC/USDC",
      asks: [[60_001, 2]],
      bids: [[59_999, 3]],
      datetime: "1970-01-01T00:00:00.000Z",
      timestamp: 1,
      nonce: 1,
    });
    expect(mockOrderBook("ETH/USDC")).toEqual({
      symbol: "ETH/USDC",
      asks: [],
      bids: [],
      datetime: "1970-01-01T00:00:00.000Z",
      timestamp: 1,
      nonce: 1,
    });
  });
});

/**
 * Load and fetch delegation.
 */

describe("BybitEuAdapter — load* / fetch* delegation", () => {
  it("loadMarkets() delegálódik a mock-hoz", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.loadMarkets();
    expect(state.lastCall).toEqual(["loadMarkets", undefined]);
  });

  it("forwards the reload flag", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.loadMarkets(true);
    expect(state.lastCall).toEqual(["loadMarkets", true]);
  });

  it("fetchTicker(symbol) delegálódik", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.fetchTicker("BTC/USDC");
    expect(state.lastCall).toEqual(["fetchTicker", "BTC/USDC"]);
  });

  it("fetchOrderBook(symbol) a limit nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.fetchOrderBook("BTC/USDC");
    expect(state.lastCall).toEqual(["fetchOrderBook", "BTC/USDC", undefined]);
  });

  it("fetchOrderBook(symbol, limit) a limit paramétert továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.fetchOrderBook("BTC/USDC", 50);
    expect(state.lastCall).toEqual(["fetchOrderBook", "BTC/USDC", 50]);
  });

  it("fetchTrades(symbol) az opcionális paraméterek nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.fetchTrades("BTC/USDC");
    expect(state.lastCall).toEqual(["fetchTrades", "BTC/USDC", undefined, undefined]);
  });

  it("fetchTrades(symbol, since, limit) a since+limit értékeket továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.fetchTrades("BTC/USDC", 1_700_000_000_000, 100);
    expect(state.lastCall).toEqual(["fetchTrades", "BTC/USDC", 1_700_000_000_000, 100]);
  });

  it("fetchOHLCV(symbol, timeframe) az opcionális paraméterek nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.fetchOHLCV("BTC/USDC", "1h");
    expect(state.lastCall).toEqual(["fetchOHLCV", "BTC/USDC", "1h", undefined, undefined]);
  });

  it("fetchOHLCV(symbol, timeframe, since, limit) minden paramétert továbbít", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.fetchOHLCV("BTC/USDC", "4h", 1_700_000_000_000, 500);
    expect(state.lastCall).toEqual(["fetchOHLCV", "BTC/USDC", "4h", 1_700_000_000_000, 500]);
  });

  it("fetchBalance() a balance mock értéket adja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.fetchBalance();
    expect(state.lastCall).toEqual(["fetchBalance"]);
  });
});

/**
 * Order-management delegation.
 */

describe("BybitEuAdapter — order management delegation", () => {
  it("createOrder() limit típussal, price+params értékekkel", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.createOrder("BTC/USDC", "limit", "buy", 0.5, 60_000, { timeInForce: "GTC" });
    expect(state.lastCall).toEqual([
      "createOrder",
      "BTC/USDC",
      "limit",
      "buy",
      0.5,
      60_000,
      { timeInForce: "GTC" },
    ]);
  });

  it("createOrder() market típussal, price/params nélkül", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.createOrder("BTC/USDC", "market", "sell", 0.5);
    expect(state.lastCall).toEqual(["createOrder", "BTC/USDC", "market", "sell", 0.5, undefined, undefined]);
  });

  it("cancelOrder(id) symbol nélkül is hívható", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.cancelOrder("order-123");
    expect(state.lastCall).toEqual(["cancelOrder", "order-123", undefined]);
  });

  it("cancelOrder(id, symbol) mindkét paramétert továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.cancelOrder("order-123", "BTC/USDC");
    expect(state.lastCall).toEqual(["cancelOrder", "order-123", "BTC/USDC"]);
  });
});

/**
 * Watch delegation.
 */

describe("BybitEuAdapter — watch* delegation", () => {
  it("watchOrderBook(symbol, limit) a limit paramétert továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchOrderBook("BTC/USDC", 25);
    expect(state.lastCall).toEqual(["watchOrderBook", "BTC/USDC", 25]);
  });

  it("watchTicker(symbol) a symbol paramétert továbbítja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchTicker("ETH/USDC");
    expect(state.lastCall).toEqual(["watchTicker", "ETH/USDC"]);
  });

  it("watchTrades(symbol, opts) since/limit értékeket kinyeri az opts-ból", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchTrades("BTC/USDC", { since: 1_700_000_000_000, limit: 100 });
    expect(state.lastCall).toEqual(["watchTrades", "BTC/USDC", 1_700_000_000_000, 100]);
  });

  it("watchTrades(symbol) opts nélkül is hívható (default {})", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchTrades("BTC/USDC");
    expect(state.lastCall).toEqual(["watchTrades", "BTC/USDC", undefined, undefined]);
  });

  it("watchOHLCV(symbol, timeframe, opts) minden paramétert továbbít", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchOHLCV("BTC/USDC", "4h", { since: 1_700_000_000_000, limit: 200 });
    expect(state.lastCall).toEqual(["watchOHLCV", "BTC/USDC", "4h", 1_700_000_000_000, 200]);
  });

  it("watchOHLCV(symbol, timeframe) opts nélkül is hívható (default {})", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchOHLCV("BTC/USDC", "4h");
    expect(state.lastCall).toEqual(["watchOHLCV", "BTC/USDC", "4h", undefined, undefined]);
  });

  it("watchOrders(symbol, opts) since/limit értékeket kinyeri az opts-ból", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchOrders("BTC/USDC", { since: 1_700_000_000_000, limit: 50 });
    expect(state.lastCall).toEqual(["watchOrders", "BTC/USDC", 1_700_000_000_000, 50]);
  });

  it("watchOrders(symbol) opts nélkül is hívható (default {})", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchOrders("BTC/USDC");
    expect(state.lastCall).toEqual(["watchOrders", "BTC/USDC", undefined, undefined]);
  });

  it("watchBalance(_opts) a CCXT watchBalance delegate-jét hívja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchBalance();
    expect(state.lastCall).toEqual(["watchBalance"]);
  });

  it("watchPositions(symbols) a symbols tömböt adja tovább a CCXT-nek", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchPositions(["BTC/USDC", "ETH/USDC"]);
    expect(state.lastCall).toEqual(["watchPositions", ["BTC/USDC", "ETH/USDC"]]);
  });

  it("watchPositions(undefined) az 'undefined' ágat futtatja (no symbols filter)", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchPositions();
    expect(state.lastCall).toEqual(["watchPositions", undefined]);
  });

  it("watchPositions(symbols?: ...) a _opts paramétert figyelmen kívül hagyja (default {})", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchPositions(["BTC/USDC"], { since: 1 });
    expect(state.lastCall).toEqual(["watchPositions", ["BTC/USDC"]]);
  });
});

/**
 * Close no-op.
 */

describe("BybitEuAdapter — close()", () => {
  it("close() nem dob (no-op, a CCXT Pro watch ciklusok a consumer kilépésével állnak le)", () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    expect(() => {
      adapter.close();
    }).not.toThrow();
  });
});

/**
 * watchPositions undefined-symbol branch.
 */

describe("BybitEuAdapter — watchPositions branch coverage", () => {
  it("watchPositions(undefined) a CCXT watchPositions(undefined) ágat hívja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchPositions();
    expect(state.watchPositionsCalls).toBeUndefined();
  });

  it("watchPositions(symbols) a CCXT watchPositions(symbols) ágat hívja", async () => {
    const adapter = new BybitEuAdapter({ exchange: makeMock() });
    await adapter.watchPositions(["BTC/USDC"]);
    expect(state.watchPositionsCalls).toEqual(["BTC/USDC"]);
  });
});

/**
 * Type contract.
 */

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
