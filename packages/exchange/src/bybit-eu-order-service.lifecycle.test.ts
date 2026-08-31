import { describe, expect, it } from "bun:test";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";

import { BybitEuOrderService } from "./bybit-eu-order-service.js";
import { makeClientOrderId } from "./client-order-id.js";
import { ExchangeFeedError } from "./feed.js";
import { makeFakeExchange, spotMarginAuthorization } from "./bybit-eu-feed.test-support.js";
import { asSymbol } from "./symbols.js";
import type { OrderRequest } from "./types.js";

function orderRequest(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    clientOrderId: makeClientOrderId("r3b-order"),
    symbol: asSymbol("BTC/USDC"),
    side: "buy",
    type: "market",
    amount: 0.01,
    selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
    spotMarginOrderIntent: "risk_increasing",
    spotMarginRequiredCapacity: "10",
    ...overrides,
  };
}

describe("BybitEuOrderService public lifecycle boundary", () => {
  it("rejects hostile selected-leverage proxies before all client I/O", async () => {
    let canonicalGetTraps = 0;
    const leverage = new Proxy(SelectedLeverage.initialBaseline, {
      get(target, property, receiver) {
        canonicalGetTraps += 1;
        if (property === "canonical") return "2";
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
    let marketReads = 0;
    let stateReads = 0;
    let borrowReads = 0;
    let submissions = 0;
    const service = new BybitEuOrderService(
      makeFakeExchange({
        market: () => {
          marketReads += 1;
          return { id: "BTCUSDC", spot: true };
        },
        createOrder: () => {
          submissions += 1;
          return Promise.resolve({ id: "forbidden", symbol: "BTC/USDC", status: "open" });
        },
      }),
      {
        ...spotMarginAuthorization,
        client: {
          ...spotMarginAuthorization.client,
          getSpotMarginState: () => {
            stateReads += 1;
            return Promise.resolve({ retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10" } });
          },
          getBorrowQuota: () => {
            borrowReads += 1;
            return Promise.resolve({ retCode: 0, result: {} });
          },
        },
      },
    );

    await expectExchangeFailure(service.place(orderRequest({ selectedSpotMarginLeverage: leverage })));
    const nonInstanceOrder = orderRequest();
    expect(Reflect.set(nonInstanceOrder, "selectedSpotMarginLeverage", {})).toBe(true);
    await expectExchangeFailure(service.place(nonInstanceOrder));
    expect(canonicalGetTraps).toBe(0);
    expect([marketReads, stateReads, borrowReads, submissions]).toEqual([0, 0, 0, 0]);
  });

  it("rejects runtime-null and incomplete protective requests before client I/O", async () => {
    let calls = 0;
    const service = new BybitEuOrderService(
      makeFakeExchange({
        market: () => {
          calls += 1;
          return { id: "BTCUSDC", spot: true };
        },
      }),
      spotMarginAuthorization,
    );

    await expectExchangeFailure(invokePlace(service, undefined));
    await expectExchangeFailure(service.place(orderRequest({ protectiveKind: "take_profit" })));
    expect(calls).toBe(0);
  });

  it("keeps a trigger without a protective kind out of the raw order parameters", async () => {
    let parameters: Readonly<Record<string, unknown>> | undefined;
    const service = new BybitEuOrderService(
      makeFakeExchange({
        createOrder: (_symbol, _type, _side, _amount, _price, value) => {
          parameters = value;
          return Promise.resolve({ id: "normal", symbol: "BTC/USDC", status: "open" });
        },
      }),
      spotMarginAuthorization,
    );

    await service.place(orderRequest({ triggerPrice: 50_000 }));
    expect(parameters).toEqual({ orderLinkId: "r3b-order", isLeverage: 1 });
  });

  it("fails closed when no explicit Spot Margin authorization client is configured", async () => {
    let submissions = 0;
    const service = new BybitEuOrderService(
      makeFakeExchange({
        createOrder: () => {
          submissions += 1;
          return Promise.resolve({ id: "forbidden", symbol: "BTC/USDC", status: "open" });
        },
      }),
      { maximumAgeMs: 5000, clock: spotMarginAuthorization.clock },
    );

    await expectExchangeFailure(service.place(orderRequest()));
    expect(submissions).toBe(0);
  });

  it("normalizes every public open-order result and rejects unavailable spot markets", async () => {
    const service = new BybitEuOrderService(
      makeFakeExchange({
        fetchOpenOrders: () => Promise.resolve([{ id: "open", symbol: "BTC/USDC", status: "open" }]),
      }),
      spotMarginAuthorization,
    );
    const openOrders = await service.fetchOpen(asSymbol("BTC/USDC"));
    expect(openOrders).toEqual([
      expect.objectContaining({ exchangeId: "open", symbol: asSymbol("BTC/USDC"), status: "open" }),
    ]);

    const throwingMarketService = new BybitEuOrderService(
      makeFakeExchange({
        market: () => {
          throw new Error("market unavailable");
        },
      }),
      spotMarginAuthorization,
    );
    const nonSpotService = new BybitEuOrderService(
      makeFakeExchange({ market: () => ({ id: "BTCUSDC", spot: false }) }),
      spotMarginAuthorization,
    );
    await expectExchangeFailure(throwingMarketService.fetchOpen(asSymbol("BTC/USDC")));
    await expectExchangeFailure(nonSpotService.fetchOpen(asSymbol("BTC/USDC")));
  });

  it("expires closed metadata at the authorization-clock TTL before a later public cancel", async () => {
    let nowUtcMs = 1_700_000_000_000;
    const cancellationFilters: unknown[] = [];
    let creations = 0;
    const service = new BybitEuOrderService(
      makeFakeExchange({
        createOrder: (_symbol, _type, _side, _amount, _price, parameters) => {
          creations += 1;
          return Promise.resolve({
            id: `created-${String(creations)}`,
            clientOrderId:
              typeof parameters["orderLinkId"] === "string" ? parameters["orderLinkId"] : undefined,
            symbol: "BTC/USDC",
            status: creations === 1 ? "canceled" : "open",
          });
        },
        cancelOrder: (_id, _symbol, parameters) => {
          cancellationFilters.push(parameters["orderFilter"]);
          return Promise.resolve({ id: "canceled", symbol: "BTC/USDC", status: "canceled" });
        },
      }),
      { ...spotMarginAuthorization, clock: { nowUtcMs: () => nowUtcMs } },
    );
    const expiredId = makeClientOrderId("r3b-expired");

    await service.place(
      orderRequest({ clientOrderId: expiredId, protectiveKind: "stop_loss", triggerPrice: 1 }),
    );
    nowUtcMs += 60 * 60 * 1000 + 1;
    await service.place(orderRequest({ clientOrderId: makeClientOrderId("r3b-later") }));
    await service.cancel(expiredId, asSymbol("BTC/USDC"));

    expect(creations).toBe(2);
    expect(cancellationFilters).toEqual(["Order"]);
  });

  it("evicts only the oldest retained protective-order metadata at its bounded public limit", async () => {
    let creations = 0;
    const cancels: { readonly orderLinkId: unknown; readonly orderFilter: unknown }[] = [];
    const service = new BybitEuOrderService(
      makeFakeExchange({
        createOrder: (_symbol, _type, _side, _amount, _price, parameters) => {
          creations += 1;
          return Promise.resolve({
            id: `created-${String(creations)}`,
            clientOrderId:
              typeof parameters["orderLinkId"] === "string" ? parameters["orderLinkId"] : undefined,
            symbol: "BTC/USDC",
            status: "open",
          });
        },
        cancelOrder: (_id, _symbol, parameters) => {
          cancels.push({ orderLinkId: parameters["orderLinkId"], orderFilter: parameters["orderFilter"] });
          return Promise.resolve({ id: "canceled", symbol: "BTC/USDC", status: "canceled" });
        },
      }),
      spotMarginAuthorization,
    );
    const first = makeClientOrderId("r3b-retention-0");
    const latest = makeClientOrderId("r3b-retention-5000");

    for (let index = 0; index <= 5000; index += 1) {
      const clientOrderId = makeClientOrderId(`r3b-retention-${String(index)}`);
      await service.place(
        orderRequest({
          clientOrderId,
          protectiveKind: "stop_loss",
          triggerPrice: 1,
        }),
      );
    }
    await service.cancel(first, asSymbol("BTC/USDC"));
    await service.cancel(latest, asSymbol("BTC/USDC"));

    expect(creations).toBe(5001);
    expect(cancels).toEqual([
      { orderLinkId: first, orderFilter: "Order" },
      { orderLinkId: latest, orderFilter: "StopOrder" },
    ]);
  });
});

function invokePlace(service: BybitEuOrderService, request: unknown): Promise<unknown> {
  const method: unknown = Reflect.get(service, "place");
  if (typeof method !== "function") throw new Error("Bybit EU order service has no place method");
  const result: unknown = Reflect.apply(method, service, [request]);
  if (!(result instanceof Promise)) throw new Error("Bybit EU order placement must return a promise");
  return result;
}

async function expectExchangeFailure(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
    throw new Error("Bybit EU order operation unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(ExchangeFeedError);
  }
}
