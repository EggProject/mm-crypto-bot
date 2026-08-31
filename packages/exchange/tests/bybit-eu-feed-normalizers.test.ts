import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  normalizeTicker,
  normalizeOrderBook,
  normalizeTrade,
  normalizeMarketMeta,
  normalizeBalances,
  normalizeOrder,
} from "../src/bybit-eu-normalizers.js";
import { BybitEuFeed } from "../src/bybit-eu-feed.js";
import { CcxtBybitEuClientAdapter } from "../src/bybit-eu-client.js";
import { officialBybitEuUrlMap } from "../src/bybit-eu-feed.test-support.js";
import { ExchangeFeedError } from "../src/feed.js";
import { makeClientOrderId } from "../src/client-order-id.js";
import { asSymbol, symbolOf } from "../src/symbols.js";
import type {
  RawBalancesPayload,
  RawMarketPayload,
  RawOrderBookPayload,
  RawOrderPayload,
  RawTickerPayload,
  RawTradePayload,
} from "../src/bybit-eu-raw-payloads.js";
import type { OrderRequest } from "../src/types.js";

const BTC_USDC = symbolOf("BTC/USDC");

function createOpenableFeed(): BybitEuFeed {
  const rawClient = {
    markets: {},
    urls: officialBybitEuUrlMap(),
    loadMarkets: () => Promise.resolve({}),
  };
  return new BybitEuFeed({
    apiKey: "k",
    secret: "s",
    rateLimitMs: 100,
    exchange: new CcxtBybitEuClientAdapter(rawClient),
  });
}

describe("Bybit EU feed normalizers", () => {
  describe("normalizeTicker", () => {
    it("a CCXT Ticker-t a mi Ticker típusunkra konvertálja", () => {
      const raw: RawTickerPayload = {
        timestamp: 12_345,
        bid: 50_000,
        ask: 50_100,
        last: 50_050,
        baseVolume: 10,
        quoteVolume: 500_000,
      };
      const ticker = normalizeTicker(raw, BTC_USDC);
      expect(ticker.symbol).toBe(BTC_USDC);
      expect(ticker.timestamp).toBe(12_345);
      expect(ticker.bid).toBe(50_000);
      expect(ticker.ask).toBe(50_100);
      expect(ticker.last).toBe(50_050);
    });

    it("az undefined mezőkhöz 0-t ad", () => {
      const raw: RawTickerPayload = {};
      const ticker = normalizeTicker(raw, BTC_USDC);
      expect(ticker.bid).toBe(0);
      expect(ticker.ask).toBe(0);
      expect(ticker.last).toBe(0);
      expect(ticker.baseVolume).toBe(0);
      expect(ticker.quoteVolume).toBe(0);
      expect(ticker.timestamp).toBeGreaterThan(0);
    });
  });

  describe("normalizeOrderBook", () => {
    it("a CCXT OrderBook-ot a mi típusunkra konvertálja", () => {
      const raw: RawOrderBookPayload = {
        timestamp: 1,
        nonce: 2,
        bids: [[50_000, 1]],
        asks: [[50_100, 2]],
      };
      const orderBook = normalizeOrderBook(raw, BTC_USDC);
      expect(orderBook.bids).toHaveLength(1);
      expect(orderBook.asks).toHaveLength(1);
      expect(orderBook.bids[0]?.price).toBe(50_000);
      expect(orderBook.bids[0]?.amount).toBe(1);
      expect(orderBook.asks[0]?.price).toBe(50_100);
    });

    it("üres bids/asks esetén üres tömböt ad", () => {
      const raw: RawOrderBookPayload = { timestamp: 1, nonce: 2, bids: [], asks: [] };
      const orderBook = normalizeOrderBook(raw, BTC_USDC);
      expect(orderBook.bids).toHaveLength(0);
      expect(orderBook.asks).toHaveLength(0);
    });
  });

  describe("normalizeTrade", () => {
    it("a 'sell' side-ot 'sell'-re normalizálja", () => {
      const raw: RawTradePayload = { id: "t1", timestamp: 1, price: 100, amount: 1, side: "sell" };
      const trade = normalizeTrade(raw, BTC_USDC);
      expect(trade.takerSide).toBe("sell");
      expect(trade.price).toBe(100);
    });

    it("a 'buy' side-ot 'buy'-ra normalizálja", () => {
      const raw: RawTradePayload = { id: "t1", timestamp: 1, price: 100, amount: 1, side: "buy" };
      const trade = normalizeTrade(raw, BTC_USDC);
      expect(trade.takerSide).toBe("buy");
    });

    it("az undefined side-ot 'buy'-ra default-olja", () => {
      const raw: RawTradePayload = { id: "t1", timestamp: 1, price: 100, amount: 1 };
      const trade = normalizeTrade(raw, BTC_USDC);
      expect(trade.takerSide).toBe("buy");
    });
  });

  describe("normalizeMarketMeta", () => {
    it("a CCXT Market-ből a mi MarketMeta típusunkat készíti", () => {
      const raw: RawMarketPayload = {
        base: "BTC",
        quote: "USDC",
        precision: { amount: 6, price: 2 },
        limits: { amount: { min: 0.0001 }, cost: { min: 1 } },
      };
      const market = normalizeMarketMeta(raw, BTC_USDC);
      expect(market.symbol).toBe(BTC_USDC);
      expect(market.base).toBe("BTC");
      expect(market.quote).toBe("USDC");
      expect(market.amountPrecision).toBe(6);
      expect(market.pricePrecision).toBe(2);
      expect(market.minAmount).toBe(0.0001);
      expect(market.minCost).toBe(1);
    });

    it("undefined precision esetén default értékeket ad", () => {
      const raw: RawMarketPayload = {
        base: "X",
        quote: "Y",
        precision: { amount: 0, price: 0 },
        limits: { amount: {}, cost: {} },
      };
      const market = normalizeMarketMeta(raw, BTC_USDC);
      expect(market.amountPrecision).toBe(0);
      expect(market.pricePrecision).toBe(0);
      expect(market.minAmount).toBe(0);
      expect(market.minCost).toBe(0);
    });
  });

  describe("normalizeBalances", () => {
    it("kiszűri az info/timestamp/datetime extra mezőket", () => {
      const raw: RawBalancesPayload = {
        BTC: { free: 0.5, total: 0.5 },
        USDC: { free: 1000, total: 1000 },
        info: { free: 0, total: 0 },
        timestamp: 12_345,
        datetime: "2026-01-01T00:00:00Z",
      };
      const balances = normalizeBalances(raw);
      expect(balances).toHaveLength(2);
      expect(balances).toContainEqual({ currency: "BTC", free: 0.5, total: 0.5 });
      expect(balances).toContainEqual({ currency: "USDC", free: 1000, total: 1000 });
    });

    it("undefined free/total esetén 0-t ad", () => {
      const raw: RawBalancesPayload = { BTC: {} };
      const balances = normalizeBalances(raw);
      expect(balances).toEqual([{ currency: "BTC", free: 0, total: 0 }]);
    });

    it("undefined entry esetén kihagyja a currency-t", () => {
      const raw: RawBalancesPayload = { BTC: undefined };
      const balances = normalizeBalances(raw);
      expect(balances).toHaveLength(0);
    });
  });

  describe("normalizeOrder", () => {
    it("az 'open' státuszt megtartja", () => {
      const raw: RawOrderPayload = {
        id: "1",
        clientOrderId: "c1",
        status: "open",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
      };
      const order = normalizeOrder(raw, undefined);
      expect(order.status).toBe("open");
    });

    it("a 'filled' státuszt 'closed'-ra normalizálja", () => {
      const raw: RawOrderPayload = {
        id: "1",
        clientOrderId: "c1",
        status: "filled",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 1,
        timestamp: 1,
      };
      const order = normalizeOrder(raw, undefined);
      expect(order.status).toBe("closed");
    });

    it("a 'canceled' státuszt 'canceled'-re normalizálja", () => {
      const raw: RawOrderPayload = {
        id: "1",
        clientOrderId: "c1",
        status: "canceled",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
      };
      const order = normalizeOrder(raw, undefined);
      expect(order.status).toBe("canceled");
    });

    it("a 'cancelled' (UK) státuszt 'canceled'-re (US) normalizálja", () => {
      const raw: RawOrderPayload = {
        id: "1",
        clientOrderId: "c1",
        status: "cancelled",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
      };
      const order = normalizeOrder(raw, undefined);
      expect(order.status).toBe("canceled");
    });

    it("ismeretlen státuszra 'open'-t ad", () => {
      const raw: RawOrderPayload = {
        id: "1",
        clientOrderId: "c1",
        status: "weird",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
      };
      const order = normalizeOrder(raw, undefined);
      expect(order.status).toBe("open");
    });

    it("a 'sell' side-ot 'sell'-re normalizálja", () => {
      const raw: RawOrderPayload = {
        id: "1",
        clientOrderId: "c1",
        status: "open",
        side: "sell",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
      };
      const order = normalizeOrder(raw, undefined);
      expect(order.side).toBe("sell");
    });

    it("a 'market' típust 'market'-re hagyja", () => {
      const raw: RawOrderPayload = {
        id: "1",
        clientOrderId: "c1",
        status: "open",
        side: "buy",
        type: "market",
        amount: 1,
        filled: 0,
        timestamp: 1,
      };
      const order = normalizeOrder(raw, undefined);
      expect(order.type).toBe("market");
    });

    it("az exchangeId-t undefined-ra állítja, ha a raw id üres string", () => {
      const raw: RawOrderPayload = {
        id: "",
        clientOrderId: "c1",
        status: "open",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
      };
      const order = normalizeOrder(raw, undefined);
      expect(order.exchangeId).toBeUndefined();
    });

    it("a req-ből veszi a hiányzó clientOrderId-t", () => {
      const raw: RawOrderPayload = {
        id: "1",
        status: "open",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
      };
      const request: OrderRequest = {
        clientOrderId: makeClientOrderId("from-req"),
        symbol: BTC_USDC,
        side: "buy" as const,
        type: "limit" as const,
        amount: 1,
        price: 100,
      };
      const order = normalizeOrder(raw, request);
      expect(order.clientOrderId).toBe("from-req");
    });
  });
});

describe("BybitEuFeed instance", () => {
  let originalEnvironment: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnvironment = process.env;
    process.env = { ...originalEnvironment };
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  describe("exchangeId", () => {
    it("'bybiteu'", () => {
      const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100 });
      expect(feed.exchangeId).toBe("bybiteu");
    });
  });

  describe("statusOf", () => {
    let feed: BybitEuFeed;
    beforeEach(() => {
      feed = createOpenableFeed();
    });

    it("a CCXT 'filled' státuszt 'closed'-ra normalizálja", () => {
      expect(feed.statusOf("filled")).toBe("closed");
    });

    it("az 'open'/'closed'/'canceled' értékeket változatlanul hagyja", () => {
      expect(feed.statusOf("open")).toBe("open");
      expect(feed.statusOf("closed")).toBe("closed");
      expect(feed.statusOf("canceled")).toBe("canceled");
    });

    it("ismeretlen értékre 'open'-t ad", () => {
      expect(feed.statusOf("unknown")).toBe("open");
    });
  });

  describe("feed state hibák", () => {
    let feed: BybitEuFeed;

    beforeEach(() => {
      feed = createOpenableFeed();
    });

    it("fetchTickerSnapshot hibát dob, ha a feed nincs megnyitva", async () => {
      await expect(feed.fetchTickerSnapshot(BTC_USDC)).rejects.toThrow(ExchangeFeedError);
    });

    it("fetchTickerSnapshot hibát dob nem támogatott symbol-ra", async () => {
      await feed.open();
      await expect(feed.fetchTickerSnapshot(asSymbol("DOGE/USDC"))).rejects.toThrow(ExchangeFeedError);
    });

    it("placeOrder limit order price nélkül hibát dob", async () => {
      await feed.open();
      await expect(
        feed.placeOrder({
          clientOrderId: makeClientOrderId("x"),
          symbol: BTC_USDC,
          side: "buy",
          type: "limit",
          amount: 0.1,
        }),
      ).rejects.toThrow(ExchangeFeedError);
    });
  });

  describe("close()", () => {
    it("bezárja a feed-et és törli a subscriptionöket", async () => {
      let closeCalls = 0;
      const { promise: tickerPromise } = Promise.withResolvers<never>();
      const rawClient = {
        urls: officialBybitEuUrlMap(),
        markets: {},
        loadMarkets: () => Promise.resolve({}),
        close: () => {
          closeCalls += 1;
          return Promise.resolve();
        },
        watchTicker: () => tickerPromise,
      };
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: new CcxtBybitEuClientAdapter(rawClient),
      });
      await feed.open();
      const subscriptionId = await feed.subscribeTicker(BTC_USDC, () => {
        throw new Error("Unexpected ticker event");
      });
      const subscription = feed.waitForSubscription(subscriptionId);
      await feed.close();
      await expect(subscription).resolves.toBeUndefined();
      expect(closeCalls).toBe(1);
    });
  });
});

describe("ExchangeFeedError", () => {
  it("Error-ből származik, name='ExchangeFeedError'", () => {
    const error = new ExchangeFeedError("test", undefined);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ExchangeFeedError");
    expect(error.message).toBe("test");
    expect(error.cause).toBeUndefined();
  });

  it("a cause mezőt megőrzi", () => {
    const cause = new Error("original");
    const error = new ExchangeFeedError("wrap", cause);
    expect(error.cause).toBe(cause);
  });
});
