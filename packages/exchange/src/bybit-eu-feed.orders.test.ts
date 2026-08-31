import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";

import { asSymbol, makeClientOrderId } from "./index.js";
import { BybitEuFeed } from "./bybit-eu-feed.js";
import type { RawMarketPayload, RawOrderPayload } from "./bybit-eu-raw-payloads.js";
import { makeFakeExchange, optionalString, spotMarginAuthorization } from "./bybit-eu-feed.test-support.js";
import type { OrderRequest } from "./types.js";

describe("bybitEuFeed order operations", () => {
  let feed: BybitEuFeed;
  beforeEach(async (): Promise<void> => {
    feed = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 100,
      exchange: makeFakeExchange(),
    });
    await feed.open();
  });

  afterEach(async (): Promise<void> => {
    await feed.close();
  });

  it("placeOrder limit típusnál átadja a price-t", async (): Promise<void> => {
    let receivedPrice: number | undefined;
    const f = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 100,
      spotMarginAuthorization,
      exchange: makeFakeExchange({
        createOrder: (
          _exchangeSymbol: string,
          _orderType: string,
          _orderSide: string,
          _orderAmount: number,
          orderPrice: number | undefined,
          _orderParameters: Readonly<Record<string, unknown>>,
        ): Promise<RawOrderPayload> => {
          receivedPrice = orderPrice;
          return Promise.resolve({
            id: "x",
            symbol: "BTC/USDC",
            type: "limit",
            side: "buy",
            amount: 0.01,
            price: 60_000,
            status: "open",
            filled: 0,
            timestamp: Date.now(),
          });
        },
      }),
    });
    await f.open();
    const request: OrderRequest = {
      clientOrderId: makeClientOrderId("coid"),
      symbol: asSymbol("BTC/USDC"),
      side: "buy",
      type: "limit",
      amount: 0.01,
      price: 60_000,
      selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
      spotMarginOrderIntent: "risk_increasing",
      spotMarginRequiredCapacity: "10",
    };
    await f.placeOrder(request);
    expect(receivedPrice).toBe(60_000);
    await f.close();
  });

  it("placeOrder market típusnál NEM ad át price-t (undefined)", async (): Promise<void> => {
    let receivedPrice: number | undefined = -1;
    const f = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 100,
      spotMarginAuthorization,
      exchange: makeFakeExchange({
        createOrder: (
          _exchangeSymbol: string,
          _orderType: string,
          _orderSide: string,
          _orderAmount: number,
          orderPrice: number | undefined,
          _orderParameters: Readonly<Record<string, unknown>>,
        ): Promise<RawOrderPayload> => {
          receivedPrice = orderPrice;
          return Promise.resolve({
            id: "x",
            symbol: "BTC/USDC",
            type: "market",
            side: "buy",
            amount: 0.01,
            status: "open",
            filled: 0,
            timestamp: Date.now(),
          });
        },
      }),
    });
    await f.open();
    const request: OrderRequest = {
      clientOrderId: makeClientOrderId("coid"),
      symbol: asSymbol("BTC/USDC"),
      side: "buy",
      type: "market",
      amount: 0.01,
      selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
      spotMarginOrderIntent: "risk_increasing",
      spotMarginRequiredCapacity: "10",
    };
    await f.placeOrder(request);
    expect(receivedPrice).toBeUndefined();
    await f.close();
  });

  it("creates a post-fill spot protective conditional with triggerPrice, StopOrder, and a client id", async (): Promise<void> => {
    let received: Readonly<Record<string, unknown>> | undefined;
    const f = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 100,
      spotMarginAuthorization,
      exchange: makeFakeExchange({
        createOrder: (
          _exchangeSymbol: string,
          _orderType: string,
          _orderSide: string,
          orderAmount: number,
          _orderPrice: number | undefined,
          orderParameters: Readonly<Record<string, unknown>>,
        ): Promise<RawOrderPayload> => {
          received = orderParameters;
          return Promise.resolve({
            id: "protective",
            clientOrderId: optionalString(orderParameters["orderLinkId"]),
            symbol: "BTC/USDC",
            type: "market",
            side: "sell",
            amount: orderAmount,
            status: "open",
            filled: 0,
          });
        },
      }),
    });
    await f.open();
    await f.placeOrder({
      clientOrderId: makeClientOrderId("sl-1"),
      symbol: asSymbol("BTC/USDC"),
      side: "sell",
      type: "market",
      amount: 0.1,
      protectiveKind: "stop_loss",
      triggerPrice: 50_000,
      reduceOnly: true,
      selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
      spotMarginOrderIntent: "risk_reducing",
    });
    expect(received).toEqual({
      orderLinkId: "sl-1",
      isLeverage: 1,
      triggerPrice: 50_000,
      orderFilter: "StopOrder",
    });
    await f.close();
  });

  it("uses Bybit V5 orderLinkId (never empty orderId/clientOrderId) for normal spot cancel and lookup", async (): Promise<void> => {
    let cancelCall:
      | { id: string | undefined; symbol: string; params: Readonly<Record<string, unknown>> | undefined }
      | undefined;
    let fetchCall:
      | { id: string | undefined; symbol: string; params: Readonly<Record<string, unknown>> | undefined }
      | undefined;
    const f = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 100,
      exchange: makeFakeExchange({
        cancelOrder: (
          orderId: string | undefined,
          exchangeSymbol: string,
          orderParameters: Readonly<Record<string, unknown>>,
        ): Promise<RawOrderPayload> => {
          cancelCall = { id: orderId, symbol: exchangeSymbol, params: orderParameters };
          return Promise.resolve({
            id: "cancel",
            clientOrderId: optionalString(orderParameters["orderLinkId"]),
            symbol: exchangeSymbol,
            status: "canceled",
          });
        },
        fetchOrder: (
          orderId: string | undefined,
          exchangeSymbol: string,
          orderParameters: Readonly<Record<string, unknown>>,
        ): Promise<RawOrderPayload> => {
          fetchCall = { id: orderId, symbol: exchangeSymbol, params: orderParameters };
          return Promise.resolve({
            id: "get",
            clientOrderId: optionalString(orderParameters["orderLinkId"]),
            symbol: exchangeSymbol,
            status: "open",
          });
        },
      }),
    });
    await f.open();
    const id = makeClientOrderId("spot-normal");
    const o = await f.cancelOrder(id, asSymbol("BTC/USDC"));
    expect(o.status).toBe("canceled");
    await f.fetchOrder(id, asSymbol("BTC/USDC"));
    expect(cancelCall).toEqual({
      id: undefined,
      symbol: "BTC/USDC",
      params: { orderLinkId: "spot-normal", orderFilter: "Order" },
    });
    expect(fetchCall).toEqual({
      id: undefined,
      symbol: "BTC/USDC",
      params: { orderLinkId: "spot-normal", acknowledged: true },
    });
    await f.close();
  });

  it("keeps spot protection on StopOrder for cancel and lookup after the create ACK", async (): Promise<void> => {
    let cancelParameters: Readonly<Record<string, unknown>> | undefined;
    let fetchParameters: Readonly<Record<string, unknown>> | undefined;
    const f = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 100,
      spotMarginAuthorization,
      exchange: makeFakeExchange({
        cancelOrder: (
          _orderId: string | undefined,
          exchangeSymbol: string,
          orderParameters: Readonly<Record<string, unknown>>,
        ): Promise<RawOrderPayload> => {
          cancelParameters = orderParameters;
          return Promise.resolve({
            id: "cancel",
            clientOrderId: optionalString(orderParameters["orderLinkId"]),
            symbol: exchangeSymbol,
            status: "canceled",
          });
        },
        fetchOrder: (
          _orderId: string | undefined,
          exchangeSymbol: string,
          orderParameters: Readonly<Record<string, unknown>>,
        ): Promise<RawOrderPayload> => {
          fetchParameters = orderParameters;
          return Promise.resolve({
            id: "get",
            clientOrderId: optionalString(orderParameters["orderLinkId"]),
            symbol: exchangeSymbol,
            status: "open",
          });
        },
      }),
    });
    await f.open();
    const id = makeClientOrderId("spot-stop");
    await f.placeOrder({
      clientOrderId: id,
      symbol: asSymbol("BTC/USDC"),
      side: "sell",
      type: "market",
      amount: 0.1,
      protectiveKind: "stop_loss",
      triggerPrice: 50_000,
      selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
      spotMarginOrderIntent: "risk_reducing",
    });
    await f.cancelOrder(id, asSymbol("BTC/USDC"));
    await f.fetchOrder(id, asSymbol("BTC/USDC"));
    expect(cancelParameters).toEqual({ orderLinkId: "spot-stop", orderFilter: "StopOrder" });
    expect(fetchParameters).toEqual({ orderLinkId: "spot-stop", acknowledged: true, trigger: true });
    await f.close();
  });

  it("rejects linear, inverse, non-spot, and unknown markets before order submission", async (): Promise<void> => {
    const nonSpotMarket: RawMarketPayload = {
      id: "BTCUSDC",
      base: "BTC",
      quote: "USDC",
      spot: false,
      precision: { amount: 4, price: 2 },
      limits: { amount: { min: 0.0001 }, cost: { min: 1 } },
    };
    const scenarios: readonly {
      readonly name: string;
      readonly market: () => RawMarketPayload;
    }[] = [
      { name: "linear", market: () => nonSpotMarket },
      { name: "inverse", market: () => nonSpotMarket },
      { name: "non-spot", market: () => nonSpotMarket },
      {
        name: "unknown",
        market: () => {
          throw new Error("CCXT market is unavailable");
        },
      },
    ];

    for (const scenario of scenarios) {
      let submissions = 0;
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        spotMarginAuthorization,
        exchange: makeFakeExchange({
          market: scenario.market,
          createOrder: (): Promise<RawOrderPayload> => {
            submissions++;
            return Promise.resolve({});
          },
        }),
      });
      await f.open();
      await expectApprovedSpotMarketRejection(
        f.placeOrder({
          clientOrderId: makeClientOrderId(`reject-${scenario.name}`),
          symbol: asSymbol("BTC/USDC"),
          side: "buy",
          type: "market",
          amount: 0.01,
          selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
          spotMarginOrderIntent: "risk_increasing",
          spotMarginRequiredCapacity: "10",
        }),
      );
      expect(submissions).toBe(0);
      await f.close();
    }
  });

  it("rejects non-spot cancel, fetch, and open-order reads before exchange side effects", async (): Promise<void> => {
    const rejectedMarket: RawMarketPayload = {
      id: "BTCUSDC",
      base: "BTC",
      quote: "USDC",
      spot: false,
      precision: { amount: 4, price: 2 },
      limits: { amount: { min: 0.0001 }, cost: { min: 1 } },
    };
    let cancelCalls = 0;
    let fetchCalls = 0;
    let openOrderReads = 0;
    const f = new BybitEuFeed({
      apiKey: "k",
      secret: "s",
      rateLimitMs: 100,
      exchange: makeFakeExchange({
        market: () => rejectedMarket,
        cancelOrder: (): Promise<RawOrderPayload> => {
          cancelCalls++;
          return Promise.resolve({});
        },
        fetchOrder: (): Promise<RawOrderPayload> => {
          fetchCalls++;
          return Promise.resolve({});
        },
        fetchOpenOrders: (): Promise<readonly RawOrderPayload[]> => {
          openOrderReads++;
          return Promise.resolve([]);
        },
      }),
    });
    await f.open();
    const clientOrderId = makeClientOrderId("reject-non-spot");
    const symbol = asSymbol("BTC/USDC");

    await expectApprovedSpotMarketRejection(f.cancelOrder(clientOrderId, symbol));
    await expectApprovedSpotMarketRejection(f.fetchOrder(clientOrderId, symbol));
    await expectApprovedSpotMarketRejection(f.fetchOpenOrders(symbol));
    expect(cancelCalls).toBe(0);
    expect(fetchCalls).toBe(0);
    expect(openOrderReads).toBe(0);
    await f.close();
  });

  it("fetchOpenOrders hívja a CCXT fetchOpenOrders-t", async (): Promise<void> => {
    const orders = await feed.fetchOpenOrders(asSymbol("BTC/USDC"));
    expect(Array.isArray(orders)).toBe(true);
  });
});

async function expectApprovedSpotMarketRejection(operation: Promise<unknown>): Promise<void> {
  let rejection: unknown;
  try {
    await operation;
  } catch (error) {
    rejection = error;
  }
  if (!(rejection instanceof Error)) throw new Error("Non-spot order operation must reject");
  expect(rejection.message).toContain("approved Spot Margin market");
}
