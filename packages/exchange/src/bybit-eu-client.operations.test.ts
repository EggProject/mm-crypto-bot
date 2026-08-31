import { describe, expect, it } from "vitest";

import {
  BybitEuClientError,
  BybitEuOriginAdmissionError,
  CcxtBybitEuClientAdapter,
  guardBybitEuClientOrigins,
} from "./bybit-eu-client.js";
import { CcxtBybitEuSpotMarginClient } from "./bybit-eu-spot-margin-client.js";
import { makeFakeExchange } from "./bybit-eu-feed.test-support.js";
import { SpotMarginAuthorizationError } from "./spot-margin-authorization.js";

const market = {
  base: "BTC",
  id: "BTCUSDC",
  limits: { amount: { min: 0.001 }, cost: { min: 1 } },
  precision: { amount: 0.001, price: 0.01 },
  quote: "USDC",
  spot: true,
};
const order = {
  amount: 1,
  average: 10,
  clientOrderId: "client-1",
  filled: 0,
  id: "order-1",
  lastUpdateTimestamp: 3,
  price: 10,
  side: "buy",
  status: "open",
  symbol: "BTC/USDC",
  timestamp: 2,
  type: "limit",
};
type RawEndpointCall = readonly [string, ...(readonly unknown[])];

function nativeClient(): Record<string, unknown> {
  return {
    cancelOrder: () => Promise.resolve({ ...order, status: "canceled" }),
    close: () => Promise.resolve(),
    createOrder: () => Promise.resolve(order),
    fetchBalance: () => Promise.resolve({ BTC: { free: 1, total: 2 }, USD: "3", ignored: undefined }),
    fetchOHLCV: () => Promise.resolve([[1, 2, 3, 4, 5, 6]]),
    fetchOpenOrders: () => Promise.resolve([order]),
    fetchOrder: () => Promise.resolve(order),
    fetchOrderBook: () => Promise.resolve({ asks: [[11, 1]], bids: [[10, 2]], nonce: 3, timestamp: 4 }),
    fetchPositions: () =>
      Promise.resolve([
        {
          contracts: 1,
          entryPrice: 2,
          lastUpdateTimestamp: 3,
          markPrice: 4,
          side: "long",
          symbol: "BTC/USDC",
          unrealizedPnl: 5,
        },
      ]),
    fetchTicker: () =>
      Promise.resolve({ ask: 11, baseVolume: 12, bid: 10, last: 10.5, quoteVolume: 13, timestamp: 14 }),
    fetchTrades: () =>
      Promise.resolve([
        {
          amount: 1,
          fee: { cost: 0.1, currency: "USDC" },
          id: "trade-1",
          order: "order-1",
          price: 10,
          side: "buy",
          symbol: "BTC/USDC",
          timestamp: 2,
        },
      ]),
    has: { fetchTicker: true, emulated: "emulated", ignored: undefined },
    loadMarkets: () => Promise.resolve({ "BTC/USDC": market }),
    market: () => market,
    markets: { "BTC/USDC": market },
    privateGetV5OrderSpotBorrowCheck: () => Promise.resolve({ retCode: 0 }),
    privateGetV5SpotMarginTradeState: () =>
      Promise.resolve({ retCode: 0, result: { spotLeverage: "10", spotMarginMode: "1" } }),
    privatePostV5SpotMarginTradeSetLeverage: () => Promise.resolve({ retCode: 0, result: {} }),
    unWatchMyTrades: () => Promise.resolve(),
    unWatchOrders: () => Promise.resolve(),
    urls: { api: "https://api.bybit.eu" },
    watchMyTrades: () => Promise.resolve([{ amount: 1, id: "trade-2", price: 10, timestamp: 2 }]),
    watchOHLCV: () => Promise.resolve([[1, 2, 3, 4, 5, 6]]),
    watchOrderBook: () => Promise.resolve({ asks: [], bids: [] }),
    watchOrders: () => Promise.resolve([order]),
    watchTicker: () => Promise.resolve({ last: 10 }),
    watchTrades: () => Promise.resolve([{ amount: 1, id: "trade-3", price: 10, timestamp: 2 }]),
  };
}

function adapterWithResponse(method: string, response: unknown): CcxtBybitEuClientAdapter {
  const client = nativeClient();
  Reflect.set(client, method, () => Promise.resolve(response));
  return new CcxtBybitEuClientAdapter(client);
}

describe("CcxtBybitEuClientAdapter operations", () => {
  it("normalizes every public CCXT operation without leaking the external client", async () => {
    const adapter = new CcxtBybitEuClientAdapter(nativeClient());
    expect(adapter.has).toEqual({ fetchTicker: true });
    expect(adapter.markets["BTC/USDC"]?.precision).toEqual({ amount: 0.001, price: 0.01 });
    expect(adapter.urls).toEqual({ api: "https://api.bybit.eu" });
    await expect(adapter.cancelOrder("order-1", "BTC/USDC", {})).resolves.toMatchObject({
      status: "canceled",
    });
    await expect(adapter.close()).resolves.toBeUndefined();
    await expect(adapter.createOrder("BTC/USDC", "limit", "buy", 1, 10, {})).resolves.toMatchObject({
      id: "order-1",
    });
    await expect(adapter.fetchBalance()).resolves.toEqual({ BTC: { free: 1, total: 2 }, USD: "3" });
    await expect(adapter.fetchOHLCV("BTC/USDC", "1m", 1, 1)).resolves.toEqual([[1, 2, 3, 4, 5, 6]]);
    await expect(adapter.fetchOpenOrders("BTC/USDC")).resolves.toHaveLength(1);
    await expect(adapter.fetchOrder("order-1", "BTC/USDC", {})).resolves.toMatchObject({ id: "order-1" });
    await expect(adapter.fetchOrderBook("BTC/USDC", 1)).resolves.toMatchObject({ nonce: 3 });
    await expect(adapter.fetchPositions(["BTC/USDC"])).resolves.toHaveLength(1);
    await expect(adapter.fetchTicker("BTC/USDC")).resolves.toMatchObject({ last: 10.5 });
    await expect(adapter.fetchTrades("BTC/USDC")).resolves.toHaveLength(1);
    await expect(adapter.loadMarkets()).resolves.toHaveProperty("BTC/USDC");
    expect(adapter.market("BTC/USDC")).toMatchObject({ base: "BTC", quote: "USDC" });
    await expect(adapter.privateGetV5OrderSpotBorrowCheck({ category: "spot" })).resolves.toEqual({
      retCode: 0,
    });
    await expect(adapter.privateGetV5SpotMarginTradeState()).resolves.toMatchObject({ retCode: 0 });
    await expect(adapter.privatePostV5SpotMarginTradeSetLeverage({ leverage: "10" })).resolves.toMatchObject({
      retCode: 0,
    });
    await expect(adapter.unWatchMyTrades()).resolves.toBeUndefined();
    await expect(adapter.unWatchOrders()).resolves.toBeUndefined();
    await expect(adapter.watchMyTrades()).resolves.toHaveLength(1);
    await expect(adapter.watchOHLCV("BTC/USDC", "1m", undefined, undefined)).resolves.toHaveLength(1);
    await expect(adapter.watchOrderBook("BTC/USDC", 1)).resolves.toMatchObject({ asks: [], bids: [] });
    await expect(adapter.watchOrders()).resolves.toHaveLength(1);
    await expect(adapter.watchTicker("BTC/USDC")).resolves.toMatchObject({ last: 10 });
    await expect(adapter.watchTrades("BTC/USDC")).resolves.toHaveLength(1);
  });

  it("rejects unavailable and malformed external operations at the adapter boundary", async () => {
    await expect(new CcxtBybitEuClientAdapter({}).fetchTicker("BTC/USDC")).rejects.toThrow(
      BybitEuClientError,
    );
    await expect(adapterWithResponse("fetchTicker", { last: "bad" }).fetchTicker("BTC/USDC")).rejects.toThrow(
      /malformed/,
    );
    await expect(
      adapterWithResponse("fetchOrderBook", { asks: "bad", bids: [] }).fetchOrderBook("BTC/USDC", 1),
    ).rejects.toThrow(/malformed/);
    await expect(
      adapterWithResponse("fetchOrderBook", { asks: [[1]], bids: [] }).fetchOrderBook("BTC/USDC", 1),
    ).rejects.toThrow(/level is malformed/);
    await expect(adapterWithResponse("fetchTrades", "bad").fetchTrades("BTC/USDC")).rejects.toThrow(
      /malformed/,
    );
    await expect(adapterWithResponse("fetchTrades", [{ side: 1 }]).fetchTrades("BTC/USDC")).rejects.toThrow(
      /malformed/,
    );
    await expect(
      adapterWithResponse("fetchOHLCV", [[1, 2]]).fetchOHLCV("BTC/USDC", "1m", undefined, 1),
    ).rejects.toThrow(/malformed/);
    await expect(
      adapterWithResponse("fetchOHLCV", [[1, 2, 3, 4, 5, "bad"]]).fetchOHLCV("BTC/USDC", "1m", undefined, 1),
    ).rejects.toThrow(/malformed/);
    await expect(
      adapterWithResponse("fetchOHLCV", "bad").fetchOHLCV("BTC/USDC", "1m", undefined, 1),
    ).rejects.toThrow(/malformed/);
    await expect(
      adapterWithResponse("fetchBalance", { BTC: { free: "bad" } }).fetchBalance(),
    ).rejects.toThrow(/malformed/);
    await expect(adapterWithResponse("fetchPositions", "bad").fetchPositions(undefined)).rejects.toThrow(
      /malformed/,
    );
    await expect(
      adapterWithResponse("fetchPositions", [{ symbol: 1 }]).fetchPositions(undefined),
    ).rejects.toThrow(/malformed/);
    await expect(adapterWithResponse("fetchOpenOrders", "bad").fetchOpenOrders("BTC/USDC")).rejects.toThrow(
      /malformed/,
    );
    await expect(
      adapterWithResponse("fetchOpenOrders", [{ type: 1 }]).fetchOpenOrders("BTC/USDC"),
    ).rejects.toThrow(/malformed/);
    expect(() => new CcxtBybitEuClientAdapter({ markets: { "BTC/USDC": {} } }).markets).toThrow(/malformed/);
    expect(() => new CcxtBybitEuClientAdapter({ markets: { "BTC/USDC": { base: 1 } } }).markets).toThrow(
      /malformed/,
    );
    expect(
      () => new CcxtBybitEuClientAdapter({ markets: { "BTC/USDC": { ...market, quote: 1 } } }).markets,
    ).toThrow(/malformed/);
    expect(
      () => new CcxtBybitEuClientAdapter({ markets: { "BTC/USDC": { ...market, spot: "yes" } } }).markets,
    ).toThrow(/malformed/);
    expect(
      new CcxtBybitEuClientAdapter({ markets: { "BTC/USDC": { ...market, spot: undefined } } }).markets,
    ).toHaveProperty("BTC/USDC");
  });
});

describe("spot margin raw boundary", () => {
  it("preserves receiver and exact arguments for generated raw endpoints", async () => {
    const calls: RawEndpointCall[] = [];
    const exchange = nativeClient();
    for (const name of [
      "privateGetV5OrderSpotBorrowCheck",
      "privateGetV5SpotMarginTradeState",
      "privatePostV5SpotMarginTradeSetLeverage",
    ]) {
      Reflect.set(
        exchange,
        name,
        function (this: unknown, ...arguments_: readonly unknown[]): Promise<unknown> {
          if (this !== exchange) throw new Error("wrong receiver");
          calls.push([name, ...arguments_]);
          return Promise.resolve({ retCode: 0 });
        },
      );
    }
    const adapter = new CcxtBybitEuClientAdapter(exchange);
    await adapter.privateGetV5OrderSpotBorrowCheck({ category: "spot" });
    await adapter.privateGetV5SpotMarginTradeState();
    await adapter.privatePostV5SpotMarginTradeSetLeverage({ leverage: "2" });
    expect(calls).toEqual([
      ["privateGetV5OrderSpotBorrowCheck", { category: "spot" }],
      ["privateGetV5SpotMarginTradeState"],
      ["privatePostV5SpotMarginTradeSetLeverage", { leverage: "2" }],
    ]);
  });

  it("fails closed for guarded origins and unavailable spot-margin endpoints", async () => {
    const guarded = guardBybitEuClientOrigins(new CcxtBybitEuClientAdapter(nativeClient()), () => {
      throw new Error("wrong origin");
    });
    expect(() => guarded.privateGetV5SpotMarginTradeState()).toThrow(BybitEuOriginAdmissionError);
    await expect(
      new CcxtBybitEuSpotMarginClient(
        makeFakeExchange({ privateGetV5SpotMarginTradeState: undefined }),
      ).getSpotMarginState(),
    ).rejects.toThrow(SpotMarginAuthorizationError);
    await expect(
      new CcxtBybitEuSpotMarginClient(
        makeFakeExchange({ privatePostV5SpotMarginTradeSetLeverage: undefined }),
      ).setSpotMarginLeverage({ leverage: "2" }),
    ).rejects.toThrow(SpotMarginAuthorizationError);
    await expect(
      new CcxtBybitEuSpotMarginClient(
        makeFakeExchange({ privateGetV5OrderSpotBorrowCheck: undefined }),
      ).getBorrowQuota({ category: "spot", side: "Buy", symbol: "BTCUSDC" }),
    ).rejects.toThrow(SpotMarginAuthorizationError);
  });

  it("delegates authenticated state, set, and borrow calls exactly", async () => {
    const calls: RawEndpointCall[] = [];
    const exchange = makeFakeExchange({
      privateGetV5OrderSpotBorrowCheck(input) {
        calls.push(["borrow", input]);
        return Promise.resolve({ retCode: 0 });
      },
      privateGetV5SpotMarginTradeState() {
        calls.push(["state"]);
        return Promise.resolve({ retCode: 0 });
      },
      privatePostV5SpotMarginTradeSetLeverage(input) {
        calls.push(["set", input]);
        return Promise.resolve({ retCode: 0 });
      },
    });
    const client = new CcxtBybitEuSpotMarginClient(exchange);
    await client.getSpotMarginState();
    await client.setSpotMarginLeverage({ leverage: "10" });
    await client.getBorrowQuota({ category: "spot", side: "Sell", symbol: "ETHUSDC" });
    expect(calls).toEqual([
      ["state"],
      ["set", { leverage: "10" }],
      ["borrow", { category: "spot", side: "Sell", symbol: "ETHUSDC" }],
    ]);
  });
});
