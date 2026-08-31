import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExchangeFeedError } from "../src/feed.js";
import type { FeedEvent } from "../src/types.js";
import {
  BTC_USDC,
  ignoreFeedEvent,
  makeFeed,
  releaseAndComplete,
  WatchFixtureClient,
} from "./bybit-eu-feed-watch.test-support.js";

describe("BybitEuFeed — open/close + watch loops", () => {
  let client: WatchFixtureClient;
  let feed: ReturnType<typeof makeFeed>;

  beforeEach(() => {
    client = new WatchFixtureClient();
    feed = makeFeed(client);
  });

  describe("open()", () => {
    it("másodszori híváskor nem hívja újra a loadMarkets-et (early return)", async () => {
      const spy = vi.spyOn(client, "loadMarkets");
      await feed.open();
      await feed.open();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("close()", () => {
    it("az aktív subscriptionöket cancelled-re állítja, majd törli a map-ből", async () => {
      await feed.open();
      const tickerId = await feed.subscribeTicker(BTC_USDC, ignoreFeedEvent);
      const bookId = await feed.subscribeOrderBook(BTC_USDC, 10, ignoreFeedEvent);
      const tickerCompletion = feed.waitForSubscription(tickerId);
      const bookCompletion = feed.waitForSubscription(bookId);
      await feed.close();
      await expect(tickerCompletion).resolves.toBeUndefined();
      await expect(bookCompletion).resolves.toBeUndefined();
      await expect(feed.fetchBalances()).rejects.toThrow(ExchangeFeedError);
      expect(tickerId).not.toBe(bookId);
    });
  });

  describe("subscribeTicker + runTickerLoop", () => {
    it("feliratkozáskor a watchTicker hívódik és az event megérkezik", async () => {
      await feed.open();
      const events: FeedEvent[] = [];
      const id = await feed.subscribeTicker(BTC_USDC, (event) => {
        events.push(event);
      });
      await releaseAndComplete(feed, id, () =>
        client.release("ticker", {
          ask: 2,
          baseVolume: 1,
          bid: 1,
          last: 1.5,
          quoteVolume: 1,
          timestamp: 100,
        }),
      );
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.kind).toBe("ticker");
    });
  });

  describe("subscribeOrderBook + runOrderBookLoop", () => {
    it("feliratkozáskor a watchOrderBook hívódik és az event megérkezik", async () => {
      await feed.open();
      const events: FeedEvent[] = [];
      const id = await feed.subscribeOrderBook(BTC_USDC, 10, (event) => {
        events.push(event);
      });
      await releaseAndComplete(feed, id, () =>
        client.release("orderbook", { asks: [], bids: [], nonce: 1, timestamp: 1 }),
      );
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.kind).toBe("orderbook");
    });
  });

  describe("subscribeTrades + runTradesLoop", () => {
    it("a trades tömb minden elemét eventként küldi", async () => {
      await feed.open();
      const events: FeedEvent[] = [];
      const id = await feed.subscribeTrades(BTC_USDC, (event) => {
        events.push(event);
      });
      await releaseAndComplete(feed, id, () =>
        client.release("trades", [
          { amount: 1, id: "t1", price: 100, side: "buy", timestamp: 1 },
          { amount: 2, id: "t2", price: 101, side: "sell", timestamp: 2 },
        ]),
      );
      expect(events.length).toBe(2);
      expect(events[0]?.kind).toBe("trade");
      expect(events[1]?.kind).toBe("trade");
    });
  });

  describe("subscribeOhlcv + runOhlcvLoop", () => {
    it("az OHLCV candle-öket eventként küldi", async () => {
      await feed.open();
      const events: FeedEvent[] = [];
      const id = await feed.subscribeOhlcv(BTC_USDC, "1m", (event) => {
        events.push(event);
      });
      await releaseAndComplete(feed, id, () =>
        client.release("ohlcv", [
          [1, 100, 101, 99, 100, 10],
          [60_001, 100, 102, 99, 101, 11],
        ]),
      );
      expect(events.length).toBeGreaterThan(0);
      const firstEvent = events[0];
      if (firstEvent?.kind !== "ohlcv") throw new Error("Expected an OHLCV event");
      expect(firstEvent.kind).toBe("ohlcv");
      expect(firstEvent.payload.candle).toEqual([1, 100, 101, 99, 100, 10]);
    });
  });

  describe("private order/execution loops", () => {
    it("normalizes authenticated updates and explicitly unwatches both streams", async () => {
      await feed.open();
      const events: FeedEvent[] = [];
      const orderId = await feed.subscribeOrderUpdates((event) => {
        events.push(event);
      });
      const executionId = await feed.subscribeExecutions((event) => {
        events.push(event);
      });
      const orderCompletion = feed.waitForSubscription(orderId);
      const executionCompletion = feed.waitForSubscription(executionId);
      await client.release("orders", [
        {
          amount: 2,
          average: 100,
          clientOrderId: "client-1",
          filled: 1,
          id: "venue-1",
          side: "buy",
          status: "open",
          symbol: "BTC/USDC",
          timestamp: 1,
          type: "market",
        },
      ]);
      await client.release("executions", [
        {
          amount: 1,
          fee: { cost: 0.1, currency: "USDC" },
          id: "exec-1",
          order: "venue-1",
          price: 100,
          side: "buy",
          symbol: "BTC/USDC",
          timestamp: 2,
        },
      ]);
      await feed.unsubscribe(orderId);
      await feed.unsubscribe(executionId);
      await expect(orderCompletion).resolves.toBeUndefined();
      await expect(executionCompletion).resolves.toBeUndefined();
      expect(events.map((event) => event.kind)).toEqual(["order", "execution"]);
      expect(client.calls.filter((call) => call.kind === "unWatchOrders")).toHaveLength(1);
      expect(client.calls.filter((call) => call.kind === "unWatchMyTrades")).toHaveLength(1);
    });
  });

  describe("run*Loop error handling", () => {
    it("ha a watch hiba után még nem cancelled, a runner ExchangeFeedError-t dob (caller felelőssége)", async () => {
      await feed.open();
      client.setWatchTicker(() => Promise.reject(new Error("ws-fail")));
      const events: FeedEvent[] = [];
      const id = await feed.subscribeTicker(BTC_USDC, (event) => {
        events.push(event);
      });
      const completion = feed.waitForSubscription(id);
      await expect(completion).rejects.toThrow(ExchangeFeedError);
      expect(events.length).toBe(0);
    });
  });

  describe("unsubscribe()", () => {
    it("nem létező id esetén csendben visszatér (no throw)", async () => {
      await expect(feed.unsubscribe(999)).resolves.toBeUndefined();
    });

    it("létező id esetén törli a sub-ot és cancelled-re állítja", async () => {
      await feed.open();
      const id = await feed.subscribeTicker(BTC_USDC, ignoreFeedEvent);
      const completion = feed.waitForSubscription(id);
      await feed.unsubscribe(id);
      await expect(completion).resolves.toBeUndefined();
    });
  });
});
