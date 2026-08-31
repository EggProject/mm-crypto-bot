import { describe, expect, it } from "bun:test";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";
import type { BybitEuClient } from "./bybit-eu-client.js";
import type { RawMarketPayload, RawOrderPayload } from "./bybit-eu-raw-payloads.js";
import { BybitEuFeed } from "./bybit-eu-feed.js";
import { CcxtBybitEuSpotMarginClient } from "./bybit-eu-spot-margin-client.js";
import { officialBybitEuUrlMap } from "./bybit-eu-feed.test-support.js";
import { makeClientOrderId } from "./client-order-id.js";
import { ExchangeFeedError } from "./feed.js";
import { symbolOf } from "./symbols.js";
import {
  SpotMarginAuthorizationError,
  SpotMarginAuthorizer,
  type SpotMarginAuthorizationClient,
  type SpotMarginClock,
} from "./spot-margin-authorization.js";
import type { OrderRequest } from "./types.js";

class FixedClock implements SpotMarginClock {
  nowUtcMs(): number {
    return 1_700_000_000_000;
  }
}

const authorizationClient: SpotMarginAuthorizationClient = {
  getSpotMarginState: () =>
    Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10" } }),
  setSpotMarginLeverage: () => Promise.resolve({ retCode: 0, result: {} }),
  getBorrowQuota: () =>
    Promise.resolve({
      retCode: 0,
      result: {
        symbol: "BTCUSDC",
        side: "Buy",
        maxTradeQty: "1",
        maxTradeAmount: "100",
        spotMaxTradeQty: "0.1",
        spotMaxTradeAmount: "10",
        borrowCoin: "USDC",
      },
    }),
};

describe("BybitEuFeed Spot Margin order boundary", () => {
  it("rejects a throwing request proxy before I/O without reading a closed request", async () => {
    const original = spotOrder(SelectedLeverage.initialBaseline);
    let reads = 0;
    const proxy = new Proxy(original, {
      get(target, property, receiver) {
        reads += 1;
        if (property === "symbol") throw new Error("hostile symbol getter");
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
    let marketReads = 0;
    const exchange: BybitEuClient = {
      ...testExchange(() => Promise.resolve({})),
      market: () => {
        marketReads += 1;
        return spotMarket;
      },
    };
    const feed = new BybitEuFeed({ apiKey: "redacted", secret: "redacted", rateLimitMs: 100, exchange });
    let closedError: unknown;
    try {
      await feed.placeOrder(proxy);
    } catch (error) {
      closedError = error;
    }
    if (!(closedError instanceof ExchangeFeedError)) throw new Error("Closed feed must reject the order");
    expect(closedError.message).toBe("Exchange feed is not open");
    expect(reads).toBe(0);
    await feed.open();
    await expectOrderAuthorizationFailure(feed.placeOrder(proxy));
    expect(reads).toBe(2);
    expect(marketReads).toBe(0);
  });
  it("rejects malformed primitive, leverage, and capacity fields before market, state, borrow, or create", async () => {
    const nullValue = new URL("https://example.invalid").searchParams.get("missing");
    const selectedLeverageProxy = new Proxy(SelectedLeverage.initialBaseline, {});
    const forgedSelectedLeverage: unknown = Object.create(SelectedLeverage.prototype);
    const revokedLeverage = Proxy.revocable(SelectedLeverage.initialBaseline, {});
    revokedLeverage.revoke();
    const scenarios: readonly Readonly<{ field: string; value: unknown }>[] = [
      { field: "clientOrderId", value: {} },
      { field: "symbol", value: nullValue },
      { field: "side", value: "hold" },
      { field: "type", value: "stop" },
      { field: "amount", value: NaN },
      { field: "amount", value: -1 },
      { field: "amount", value: 0 },
      { field: "type", value: "limit" },
      { field: "price", value: NaN },
      { field: "price", value: -1 },
      { field: "price", value: 0 },
      { field: "selectedSpotMarginLeverage", value: selectedLeverageProxy },
      { field: "selectedSpotMarginLeverage", value: forgedSelectedLeverage },
      { field: "selectedSpotMarginLeverage", value: revokedLeverage.proxy },
      { field: "spotMarginOrderIntent", value: "unrecognized" },
      { field: "spotMarginRequiredCapacity", value: "100.0" },
      { field: "spotMarginRequiredCapacity", value: "9".repeat(1025) },
      { field: "protectiveKind", value: "unknown" },
      { field: "triggerPrice", value: NaN },
      { field: "triggerPrice", value: -1 },
    ];
    for (const scenario of scenarios) {
      let marketReads = 0;
      let stateReads = 0;
      let borrowReads = 0;
      let submissions = 0;
      const exchange: BybitEuClient = {
        ...testExchange(() => {
          submissions += 1;
          return Promise.resolve({});
        }),
        market: () => {
          marketReads += 1;
          return spotMarket;
        },
      };
      const feed = new BybitEuFeed({
        apiKey: "redacted",
        secret: "redacted",
        rateLimitMs: 100,
        exchange,
        spotMarginAuthorization: {
          maximumAgeMs: 5000,
          clock: new FixedClock(),
          client: {
            getSpotMarginState: () => {
              stateReads += 1;
              return Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10" } });
            },
            setSpotMarginLeverage: () => Promise.resolve({ retCode: 0, result: {} }),
            getBorrowQuota: () => {
              borrowReads += 1;
              return Promise.resolve({ retCode: 0, result: availableBorrowQuota() });
            },
          },
        },
      });
      const order = spotOrder(SelectedLeverage.initialBaseline);
      if (scenario.field === "type" && scenario.value === "limit") {
        expect(Reflect.set(order, "type", scenario.value)).toBe(true);
        expect(Reflect.set(order, "price", undefined)).toBe(true);
      } else if (scenario.field === "triggerPrice") {
        expect(Reflect.set(order, "protectiveKind", "stop_loss")).toBe(true);
        expect(Reflect.set(order, scenario.field, scenario.value)).toBe(true);
      } else {
        expect(Reflect.set(order, scenario.field, scenario.value)).toBe(true);
      }
      await feed.open();
      await expectOrderAuthorizationFailure(feed.placeOrder(order));
      expect(marketReads).toBe(0);
      expect(stateReads).toBe(0);
      expect(borrowReads).toBe(0);
      expect(submissions).toBe(0);
    }
  });
  it("rejects an invalid activation clock before state or set-leverage I/O", async () => {
    const calls: string[] = [];
    const authorizer = new SpotMarginAuthorizer(
      {
        getSpotMarginState: () => {
          calls.push("state");
          return Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10" } });
        },
        setSpotMarginLeverage: () => {
          calls.push("set");
          return Promise.resolve({ retCode: 0, result: {} });
        },
        getBorrowQuota: () => Promise.resolve({ retCode: 0, result: availableBorrowQuota() }),
      },
      { nowUtcMs: () => NaN },
    );
    await expectActivationFailure(authorizer.activateSelectedLeverage(SelectedLeverage.initialBaseline));
    expect(calls).toEqual([]);
  });
  it("freezes authorization borrow evidence against runtime mutation", async () => {
    const authorizer = new SpotMarginAuthorizer(
      {
        getSpotMarginState: () =>
          Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10" } }),
        setSpotMarginLeverage: () => Promise.resolve({ retCode: 0, result: {} }),
        getBorrowQuota: () => Promise.resolve({ retCode: 0, result: availableBorrowQuota() }),
      },
      new FixedClock(),
    );
    const evidence = await authorizer.authorize({
      selectedLeverage: SelectedLeverage.initialBaseline,
      symbol: symbolOf("BTC/USDC"),
      bybitSymbol: "BTCUSDC",
      side: "buy",
      intent: "risk_increasing",
      requiredCapacity: "10",
    });
    if (evidence.borrowCapacity === undefined)
      throw new Error("Risk-increasing authorization must record borrow capacity");
    expect(Object.isFrozen(evidence.borrowCapacity)).toBe(true);
    expect(Reflect.set(evidence.borrowCapacity, "maxTradeAmount", "999")).toBe(false);
    expect(evidence.borrowCapacity.maxTradeAmount).toBe("100");
  });
  it("uses only generated raw V5 state and set-leverage methods with canonical string arguments", async () => {
    const calls: string[] = [];
    const exchange: BybitEuClient = {
      ...testExchange(() => Promise.resolve({})),
      privateGetV5SpotMarginTradeState: () => {
        calls.push("state");
        return Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10" } });
      },
      privatePostV5SpotMarginTradeSetLeverage: (input) => {
        calls.push(`set:${input.leverage}`);
        return Promise.resolve({ retCode: 0, result: {} });
      },
    };
    const client = new CcxtBybitEuSpotMarginClient(exchange);
    await client.getSpotMarginState();
    await client.setSpotMarginLeverage({ leverage: "2" });
    expect(calls).toEqual(["state", "set:2"]);
  });
  it("permits exact 2, but rejects exact-domain 2.5 before createOrder", async () => {
    let submissions = 0;
    const exchange = testExchange(() => {
      submissions += 1;
      return Promise.resolve({ id: "order-2", symbol: "BTC/USDC", status: "open" });
    });
    const authorizationClient: SpotMarginAuthorizationClient = {
      getSpotMarginState: () =>
        Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "2" } }),
      setSpotMarginLeverage: () => Promise.resolve({ retCode: 0, result: {} }),
      getBorrowQuota: () => Promise.resolve({ retCode: 0, result: availableBorrowQuota() }),
    };
    const feed = new BybitEuFeed({
      apiKey: "redacted",
      secret: "redacted",
      rateLimitMs: 100,
      exchange,
      spotMarginAuthorization: { maximumAgeMs: 5000, clock: new FixedClock(), client: authorizationClient },
    });
    await feed.open();
    await feed.placeOrder(spotOrder(SelectedLeverage.parse("2")));
    expect(submissions).toBe(1);
    const unsupportedOrder = spotOrder(SelectedLeverage.parse("2.5"));
    await expectOrderAuthorizationFailure(feed.placeOrder(unsupportedOrder));
    expect(submissions).toBe(1);
  });
  it("checks state for a risk-reducing order and blocks a selected-leverage mismatch", async () => {
    let submissions = 0;
    const exchange = testExchange(() => {
      submissions += 1;
      return Promise.resolve({});
    });
    const feed = new BybitEuFeed({
      apiKey: "redacted",
      secret: "redacted",
      rateLimitMs: 100,
      exchange,
      spotMarginAuthorization: {
        maximumAgeMs: 5000,
        clock: new FixedClock(),
        client: {
          getSpotMarginState: () =>
            Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "9" } }),
          setSpotMarginLeverage: () => Promise.resolve({ retCode: 0, result: {} }),
          getBorrowQuota: () => Promise.resolve({ retCode: 0, result: availableBorrowQuota() }),
        },
      },
    });
    await feed.open();
    await expectOrderAuthorizationFailure(
      feed.placeOrder({
        ...spotOrder(SelectedLeverage.initialBaseline),
        spotMarginOrderIntent: "risk_reducing",
      }),
    );
    expect(submissions).toBe(0);
  });
  it("requires authorization and sends Bybit V5 isLeverage=1 for every spot order", async () => {
    let receivedParameters: Readonly<Record<string, unknown>> | undefined;
    const exchange = testExchange((_symbol, _type, _side, _amount, _price, parameters) => {
      receivedParameters = parameters;
      return Promise.resolve({
        id: "order-1",
        clientOrderId: "test-order",
        symbol: "BTC/USDC",
        type: "market",
        side: "buy",
        amount: 0.1,
        status: "open",
        filled: 0,
        timestamp: 1,
      });
    });
    const feed = new BybitEuFeed({
      apiKey: "redacted",
      secret: "redacted",
      rateLimitMs: 100,
      exchange,
      spotMarginAuthorization: { maximumAgeMs: 5000, clock: new FixedClock(), client: authorizationClient },
    });
    await feed.open();
    const fields = [
      "clientOrderId",
      "symbol",
      "side",
      "type",
      "amount",
      "price",
      "selectedSpotMarginLeverage",
      "spotMarginOrderIntent",
      "spotMarginRequiredCapacity",
      "protectiveKind",
      "triggerPrice",
    ];
    const reads: string[] = [];
    const request = new Proxy(spotOrder(SelectedLeverage.initialBaseline), {
      get(target, property, receiver) {
        reads.push(String(property));
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
    await feed.placeOrder(request);
    expect(reads).toEqual(fields);
    expect(receivedParameters).toEqual({ orderLinkId: "test-10", isLeverage: 1 });
  });
  it("fails closed before createOrder when Spot Margin authorization is absent", async () => {
    let submissions = 0;
    const feed = new BybitEuFeed({
      apiKey: "redacted",
      secret: "redacted",
      rateLimitMs: 100,
      exchange: testExchange(() => {
        submissions++;
        return Promise.resolve({});
      }),
    });
    await feed.open();
    let thrown: unknown;
    try {
      await feed.placeOrder({
        clientOrderId: makeClientOrderId("test-order"),
        symbol: symbolOf("BTC/USDC"),
        side: "buy",
        type: "market",
        amount: 0.1,
        selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
        spotMarginOrderIntent: "risk_increasing",
        spotMarginRequiredCapacity: "10",
      });
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof Error))
      throw new Error("Spot Margin authorization absence must reject the order");
    expect(thrown.message).toContain("authorization is required");
    expect(submissions).toBe(0);
  });
  it("revalidates origins after authorization before it can submit an order", async () => {
    let submissions = 0;
    const exchange = testExchange(() => {
      submissions += 1;
      return Promise.resolve({});
    });
    const feed = new BybitEuFeed({
      apiKey: "redacted",
      secret: "redacted",
      rateLimitMs: 100,
      exchange,
      spotMarginAuthorization: {
        maximumAgeMs: 5000,
        clock: new FixedClock(),
        client: {
          getSpotMarginState: () => {
            setUnapprovedPrivateOrigin(exchange);
            return Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10" } });
          },
          setSpotMarginLeverage: () => Promise.resolve({ retCode: 0, result: {} }),
          getBorrowQuota: (input) => authorizationClient.getBorrowQuota(input),
        },
      },
    });
    await feed.open();
    let thrown: unknown;
    try {
      await feed.placeOrder({
        clientOrderId: makeClientOrderId("origin-drift-order"),
        symbol: symbolOf("BTC/USDC"),
        side: "buy",
        type: "market",
        amount: 0.1,
        selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
        spotMarginOrderIntent: "risk_increasing",
        spotMarginRequiredCapacity: "10",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExchangeFeedError);
    expect(submissions).toBe(0);
  });
});
const spotMarket: RawMarketPayload = {
  base: "BTC",
  id: "BTCUSDC",
  limits: {},
  precision: {},
  quote: "USDC",
  spot: true,
};

function testExchange(createOrder: BybitEuClient["createOrder"]): BybitEuClient {
  const markets: Readonly<Record<string, RawMarketPayload | undefined>> = { "BTC/USDC": spotMarket };
  const emptyOrder: RawOrderPayload = {};
  return {
    has: {},
    markets,
    urls: officialBybitEuUrlMap(),
    cancelOrder: () => Promise.resolve(emptyOrder),
    close: () => Promise.resolve(),
    createOrder,
    fetchBalance: () => Promise.resolve({}),
    fetchOHLCV: () => Promise.resolve([]),
    fetchOpenOrders: () => Promise.resolve([]),
    fetchOrder: () => Promise.resolve(emptyOrder),
    fetchOrderBook: () => Promise.resolve({ asks: [], bids: [] }),
    fetchPositions: () => Promise.resolve([]),
    fetchTicker: () => Promise.resolve({}),
    fetchTrades: () => Promise.resolve([]),
    loadMarkets: () => Promise.resolve(markets),
    market: () => spotMarket,
    unWatchMyTrades: () => Promise.resolve(),
    unWatchOrders: () => Promise.resolve(),
    watchMyTrades: () => Promise.resolve([]),
    watchOHLCV: () => Promise.resolve([]),
    watchOrderBook: () => Promise.resolve({ asks: [], bids: [] }),
    watchOrders: () => Promise.resolve([]),
    watchTicker: () => Promise.resolve({}),
    watchTrades: () => Promise.resolve([]),
  };
}

function setUnapprovedPrivateOrigin(exchange: BybitEuClient): void {
  const api = Reflect.get(exchange.urls, "api");
  if (api === null || typeof api !== "object" || Array.isArray(api)) {
    throw new Error("The test exchange URL map is malformed");
  }
  Reflect.set(api, "private", "https://api-testnet.bybit.eu");
}

function spotOrder(selectedSpotMarginLeverage: SelectedLeverage): OrderRequest {
  return {
    clientOrderId: makeClientOrderId(
      selectedSpotMarginLeverage.canonical === "2.5"
        ? "test-two-five"
        : `test-${selectedSpotMarginLeverage.canonical}`,
    ),
    symbol: symbolOf("BTC/USDC"),
    side: "buy" as const,
    type: "market" as const,
    amount: 0.1,
    selectedSpotMarginLeverage,
    spotMarginOrderIntent: "risk_increasing" as const,
    spotMarginRequiredCapacity: "10",
  };
}

function availableBorrowQuota(): Readonly<Record<string, string>> {
  return {
    symbol: "BTCUSDC",
    side: "Buy",
    maxTradeQty: "1",
    maxTradeAmount: "100",
    spotMaxTradeQty: "0.1",
    spotMaxTradeAmount: "10",
    borrowCoin: "USDC",
  };
}

async function expectOrderAuthorizationFailure(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ExchangeFeedError);
    return;
  }
  expect.unreachable("Expected Spot Margin order authorization to reject");
}

async function expectActivationFailure(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(SpotMarginAuthorizationError);
    return;
  }
  expect.unreachable("Expected Spot Margin activation to reject");
}
