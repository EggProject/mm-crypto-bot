import { beforeEach, describe, expect, it } from "vitest";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";

import { makeClientOrderId } from "../src/client-order-id.js";
import { ExchangeFeedError } from "../src/feed.js";
import { asSymbol } from "../src/symbols.js";
import type { OrderRequest } from "../src/types.js";
import {
  BTC_USDC,
  ETH_USDC,
  findCall,
  makeFeed,
  WatchFixtureClient,
} from "./bybit-eu-feed-watch.test-support.js";

describe("BybitEuFeed — fetch* methods", () => {
  let client: WatchFixtureClient;
  let feed: ReturnType<typeof makeFeed>;

  beforeEach(async () => {
    client = new WatchFixtureClient();
    feed = makeFeed(client);
    await feed.open();
  });

  describe("fetchTickerSnapshot", () => {
    it("a CCXT fetchTicker-t hívja és normalizálja", async () => {
      const ticker = await feed.fetchTickerSnapshot(BTC_USDC);
      expect(ticker.symbol).toBe(BTC_USDC);
      expect(ticker.bid).toBe(50_000);
    });
  });

  describe("fetchOrderBookSnapshot", () => {
    it("a CCXT fetchOrderBook-ot hívja a megadott limit-tel", async () => {
      const orderBook = await feed.fetchOrderBookSnapshot(BTC_USDC, 5);
      expect(orderBook.symbol).toBe(BTC_USDC);
      expect(orderBook.bids).toHaveLength(1);
    });
  });

  describe("fetchMarketMeta", () => {
    it("a CCXT markets dict-ből veszi a meta-t", async () => {
      const market = await feed.fetchMarketMeta(BTC_USDC);
      expect(market.symbol).toBe(BTC_USDC);
      expect(market.base).toBe("BTC");
      expect(market.quote).toBe("USDC");
    });

    it("ExchangeFeedError-t dob, ha a market nem található", async () => {
      client.setMarkets({});
      await expect(feed.fetchMarketMeta(asSymbol("UNKNOWN/USDC"))).rejects.toThrow(ExchangeFeedError);
    });
  });

  describe("fetchBalances", () => {
    it("a CCXT fetchBalance-t hívja és normalizálja", async () => {
      const balances = await feed.fetchBalances();
      expect(balances.length).toBeGreaterThan(0);
      expect(balances.map((balance) => balance.currency)).toContain("BTC");
    });
  });

  describe("placeOrder", () => {
    it("a CCXT createOrder-t hívja a request mezőkkel", async () => {
      const order = await feed.placeOrder({
        amount: 0.5,
        clientOrderId: makeClientOrderId("cid"),
        selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
        side: "buy",
        spotMarginOrderIntent: "risk_increasing",
        spotMarginRequiredCapacity: "1",
        symbol: BTC_USDC,
        type: "market",
      });
      expect(order.symbol).toBe(BTC_USDC);
      expect(client.calls.some((call) => call.kind === "createOrder")).toBe(true);
      expect(findCall(client.calls, "spotMarginTradeState").args).toEqual([]);
      expect(findCall(client.calls, "spotMarginBorrowCheck").args).toEqual([
        { category: "spot", side: "Buy", symbol: "BTCUSDC" },
      ]);
      expect(findCall(client.calls, "createOrder").args[5]).toEqual({ isLeverage: 1, orderLinkId: "cid" });
    });

    it("does not attach TP/SL blindly to a market entry", async () => {
      await feed.placeOrder({
        amount: 0.5,
        clientOrderId: makeClientOrderId("cid"),
        selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
        side: "buy",
        spotMarginOrderIntent: "risk_increasing",
        spotMarginRequiredCapacity: "1",
        stopLossPrice: 90,
        symbol: BTC_USDC,
        takeProfitPrice: 110,
        type: "market",
      });
      const parameters = findCall(client.calls, "createOrder").args[5];
      expect(parameters["takeProfitPrice"]).toBeUndefined();
      expect(parameters["stopLossPrice"]).toBeUndefined();
    });

    it("forwards a reduce-only safety close without TP/SL fields", async () => {
      const request: OrderRequest = {
        amount: 0.5,
        clientOrderId: makeClientOrderId("close"),
        reduceOnly: true,
        selectedSpotMarginLeverage: SelectedLeverage.initialBaseline,
        side: "sell",
        spotMarginOrderIntent: "risk_reducing",
        symbol: BTC_USDC,
        type: "market",
      };
      await feed.placeOrder(request);
      const parameters = findCall(client.calls, "createOrder").args[5];
      expect(request.selectedSpotMarginLeverage).toBe(SelectedLeverage.initialBaseline);
      expect(request.spotMarginOrderIntent).toBe("risk_reducing");
      expect(request.spotMarginRequiredCapacity).toBeUndefined();
      expect(client.calls.some((call) => call.kind === "spotMarginBorrowCheck")).toBe(false);
      expect(parameters["isLeverage"]).toBe(1);
      expect(parameters["reduceOnly"]).toBeUndefined();
      expect(parameters["takeProfitPrice"]).toBeUndefined();
      expect(parameters["stopLossPrice"]).toBeUndefined();
    });
  });

  describe("cancelOrder", () => {
    it("explicit V5 orderLinkId-val hívja a cancelOrder-t, üres orderId nélkül", async () => {
      const order = await feed.cancelOrder(makeClientOrderId("cid"), BTC_USDC);
      expect(order.status).toBe("canceled");
      expect(findCall(client.calls, "cancelOrder").args).toEqual([
        undefined,
        BTC_USDC,
        { orderFilter: "Order", orderLinkId: "cid" },
      ]);
    });
  });

  describe("fetchOrder", () => {
    it("explicit V5 orderLinkId-val és acknowledged-del hívja a fetchOrder-t", async () => {
      const order = await feed.fetchOrder(makeClientOrderId("cid"), BTC_USDC);
      expect(order.status).toBe("open");
      expect(findCall(client.calls, "fetchOrder").args).toEqual([
        undefined,
        BTC_USDC,
        { acknowledged: true, orderLinkId: "cid" },
      ]);
    });
  });

  describe("fetchOpenOrders", () => {
    it("a CCXT fetchOpenOrders-t hívja és normalizálja a listát", async () => {
      const orders = await feed.fetchOpenOrders(BTC_USDC);
      expect(orders.length).toBe(1);
      expect(orders[0]?.symbol).toBe(BTC_USDC);
    });
  });

  describe("assertOpen / assertSupported path coverage", () => {
    it("ETH_USDC-t is elfogadja (második támogatott symbol)", async () => {
      const ticker = await feed.fetchTickerSnapshot(ETH_USDC);
      expect(ticker.symbol).toBe(ETH_USDC);
    });
  });
});
