import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { MockExchangeFeed, defaultOhlcvHistory } from "./mock-feed.js";
import { makeClientOrderId, asSymbol } from "../index.js";
import type { Ohlcv } from "../types.js";

async function expectRejected(promise: Promise<unknown>, message: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      expect(error.message).toMatch(message);
      return;
    }
    throw error;
  }
  throw new Error("Expected mock feed operation to reject");
}

describe("mockFeed orders", () => {
  let feed: MockExchangeFeed;

  beforeEach(() => {
    feed = new MockExchangeFeed();
  });

  afterEach(async () => {
    await feed.close();
  });

  describe("OHLCV fixture behavior", () => {
    it("returns constructor-provided OHLCV history through the public fixture API", async () => {
      const history: readonly Ohlcv[] = [[300, 12, 14, 11, 13, 7]];
      const snapshotFeed = new MockExchangeFeed({
        ohlcvSnapshot: new Map([["BTC/USDC::1m", history]]),
      });
      await snapshotFeed.open();

      const result = await snapshotFeed.fetchOHLCV(asSymbol("BTC/USDC"), "1m", undefined, 1);
      expect(result).toEqual(history);
      await snapshotFeed.close();
    });

    it("returns configured OHLCV history through the public fixture API", async () => {
      await feed.open();
      const history: readonly Ohlcv[] = [
        [100, 10, 12, 9, 11, 5],
        [200, 11, 13, 10, 12, 6],
      ];
      feed.setOhlcv(asSymbol("BTC/USDC"), "1m", history);

      const result = await feed.fetchOHLCV(asSymbol("BTC/USDC"), "1m", undefined, 2);
      expect(result).toEqual(history);
    });

    it("filters and limits generated OHLCV history through the public fixture API", async () => {
      await feed.open();
      const history = defaultOhlcvHistory(asSymbol("BTC/USDC"), "1m", 2);
      const since = history[1]?.[0];

      const result = await feed.fetchOHLCV(asSymbol("BTC/USDC"), "1m", since, 1);
      expect(result).toEqual([history[1]]);
    });

    it("creates deterministic-length default OHLCV history with complete candles", () => {
      const history = defaultOhlcvHistory(asSymbol("ETH/USDC"), "1h", 2);

      expect(history).toHaveLength(2);
      expect(history[0]?.[0]).toBeLessThan(history[1]?.[0] ?? 0);
      expect(history[0]?.every((value) => Number.isFinite(value))).toBe(true);
    });
  });

  describe("placeOrder + cancelOrder + fetchOrder + fetchOpenOrders", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("placeOrder limit price nélkül dob", async () => {
      await expectRejected(
        feed.placeOrder({
          clientOrderId: makeClientOrderId("test-1"),
          symbol: asSymbol("BTC/USDC"),
          side: "buy",
          type: "limit",
          amount: 0.01,
        }),
        /limit.*price/,
      );
    });

    it("placeOrder market típusnál NEM dob, ha nincs price", async () => {
      const order = await feed.placeOrder({
        clientOrderId: makeClientOrderId("test-1"),
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "market",
        amount: 0.01,
      });
      expect(order.status).toBe("open");
      expect(order.type).toBe("market");
    });

    it("placeOrder limit price-szal sikeres, open státusszal", async () => {
      const order = await feed.placeOrder({
        clientOrderId: makeClientOrderId("test-1"),
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      expect(order.status).toBe("open");
      expect(order.price).toBe(60_000);
      expect(feed.getOrder(makeClientOrderId("test-1"))).toBeDefined();
    });

    it("cancelOrder ismeretlen order-re dob", async () => {
      await expectRejected(
        feed.cancelOrder(makeClientOrderId("unknown"), asSymbol("BTC/USDC")),
        /ismeretlen order/,
      );
    });

    it("cancelOrder létező order-t canceled-re állít", async () => {
      await feed.placeOrder({
        clientOrderId: makeClientOrderId("test-1"),
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      const canceled = await feed.cancelOrder(makeClientOrderId("test-1"), asSymbol("BTC/USDC"));
      expect(canceled.status).toBe("canceled");
    });

    it("fetchOrder ismeretlen order-re dob", async () => {
      await expectRejected(
        feed.fetchOrder(makeClientOrderId("unknown"), asSymbol("BTC/USDC")),
        /ismeretlen order/,
      );
    });

    it("fetchOrder létező order-t ad vissza", async () => {
      await feed.placeOrder({
        clientOrderId: makeClientOrderId("test-1"),
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      const order = await feed.fetchOrder(makeClientOrderId("test-1"), asSymbol("BTC/USDC"));
      expect(order.clientOrderId).toBe("test-1");
    });

    it("fetchOpenOrders csak az 'open' státuszú order-eket adja", async () => {
      await feed.placeOrder({
        clientOrderId: makeClientOrderId("test-1"),
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      await feed.placeOrder({
        clientOrderId: makeClientOrderId("test-2"),
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_001,
      });
      await feed.cancelOrder(makeClientOrderId("test-1"), asSymbol("BTC/USDC"));
      const open = await feed.fetchOpenOrders(asSymbol("BTC/USDC"));
      expect(open.length).toBe(1);
      expect(String(open[0]?.clientOrderId)).toBe("test-2");
    });
  });

  describe("statusOf", () => {
    it("a 'open'-t visszaadja", () => {
      expect(feed.statusOf("open")).toBe("open");
    });

    it("a 'closed'-t visszaadja", () => {
      expect(feed.statusOf("closed")).toBe("closed");
    });

    it("a 'canceled'-t visszaadja", () => {
      expect(feed.statusOf("canceled")).toBe("canceled");
    });

    it("a 'filled'-et 'closed'-re konvertálja", () => {
      expect(feed.statusOf("filled")).toBe("closed");
    });

    it("ismeretlen státuszt 'open'-re default-ol", () => {
      expect(feed.statusOf("unknown")).toBe("open");
    });
  });

  describe("setBalance", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("új currency-t ad hozzá, ha még nincs", async () => {
      feed.setBalance("BTC", 0.5, 0.5);
      const balances = await feed.fetchBalances();
      const btc = balances.find((b) => b.currency === "BTC");
      expect(btc).toBeDefined();
      expect(btc?.total).toBe(0.5);
    });

    it("létező currency-t frissíti", async () => {
      feed.setBalance("USDC", 5000, 5000);
      const balances = await feed.fetchBalances();
      const usdc = balances.find((b) => b.currency === "USDC");
      expect(usdc?.total).toBe(5000);
    });
  });

  describe("setOrderStatus", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("ismeretlen order-re nem csinál semmit (no-op)", () => {
      // Nem dob, csak no-op.
      feed.setOrderStatus(makeClientOrderId("unknown"), { status: "closed" });
      // Nincs assert — csak hogy ne dobjon.
    });

    it("létező order-t patch-eli", async () => {
      await feed.placeOrder({
        clientOrderId: makeClientOrderId("test-1"),
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      feed.setOrderStatus(makeClientOrderId("test-1"), { status: "closed", filled: 0.01 });
      const order = feed.getOrder(makeClientOrderId("test-1"));
      expect(order?.status).toBe("closed");
      expect(order?.filled).toBe(0.01);
    });
  });

  describe("getOrder", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("undefined-ot ad ismeretlen order-re", () => {
      expect(feed.getOrder(makeClientOrderId("unknown"))).toBeUndefined();
    });

    it("a order-t adja vissza, ha létezik", async () => {
      await feed.placeOrder({
        clientOrderId: makeClientOrderId("test-1"),
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      const order = feed.getOrder(makeClientOrderId("test-1"));
      expect(String(order?.clientOrderId)).toBe("test-1");
    });
  });
});
