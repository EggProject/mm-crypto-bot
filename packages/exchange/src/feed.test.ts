/**
 * packages/exchange/src/feed.test.ts
 *
 * 100% coverage test for `feed.ts` — the `ExchangeFeed` abstract
 * interface contract + the `SubscriptionId` / `FeedListener` type
 * re-exports + the `ExchangeFeedError` class.
 *
 * The interface itself has no logic (TypeScript-only), but the
 * `ExchangeFeedError` class wraps a `cause` and must be tested.
 * We also test the type re-exports compile correctly.
 */
import { describe, expect, it } from "bun:test";

import {
  ExchangeFeedError,
  type ExchangeFeed,
  type FeedEvent,
  type FeedListener,
  type SubscriptionId,
} from "./feed.js";

const unexpectedSubscriptionInvocation: FeedListener = () => {
  throw new Error("subscribeTicker must not invoke its listener");
};

describe("feed", () => {
  describe("ExchangeFeedError", () => {
    it("konstruktor eltárolja az üzenetet és a cause-t", () => {
      const cause = new Error("original error");
      const error = new ExchangeFeedError("wrapper message", cause);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ExchangeFeedError);
      expect(error.message).toBe("wrapper message");
      expect(error.cause).toBe(cause);
      expect(error.name).toBe("ExchangeFeedError");
    });

    it("cause lehet nem-Error típusú is (string, object, undefined)", () => {
      // A `cause` típusa `unknown`, tehát bármi lehet.
      const error1 = new ExchangeFeedError("with string", "string cause");
      expect(error1.cause).toBe("string cause");

      const error2 = new ExchangeFeedError("with object", { code: 500 });
      expect(error2.cause).toEqual({ code: 500 });

      const error3 = new ExchangeFeedError("with undefined", undefined);
      expect(error3.cause).toBeUndefined();
    });

    it("a stack trace az ExchangeFeedError konstruktorából származik", () => {
      const error = new ExchangeFeedError("test", new Error("inner"));
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("ExchangeFeedError");
    });
  });

  describe("ExchangeFeed interface contract", () => {
    it("MockExchangeFeed implementálja az ExchangeFeed interfészt", async () => {
      // The assignment verifies the compile-time interface contract.
      const { MockExchangeFeed } = await import("./__testing__/mockFeed.js");
      const feed: ExchangeFeed = new MockExchangeFeed();

      // The remaining assertions verify the runtime method surface.
      expect(typeof feed.open).toBe("function");
      expect(typeof feed.subscribeTicker).toBe("function");
      expect(typeof feed.subscribeOrderBook).toBe("function");
      expect(typeof feed.subscribeTrades).toBe("function");
      expect(typeof feed.subscribeOhlcv).toBe("function");
      expect(typeof feed.unsubscribe).toBe("function");
      expect(typeof feed.fetchTickerSnapshot).toBe("function");
      expect(typeof feed.fetchOrderBookSnapshot).toBe("function");
      expect(typeof feed.fetchMarketMeta).toBe("function");
      expect(typeof feed.fetchBalances).toBe("function");
      expect(typeof feed.placeOrder).toBe("function");
      expect(typeof feed.cancelOrder).toBe("function");
      expect(typeof feed.fetchOrder).toBe("function");
      expect(typeof feed.fetchOpenOrders).toBe("function");
      expect(typeof feed.close).toBe("function");
      expect(typeof feed.statusOf).toBe("function");
      expect(typeof feed.exchangeId).toBe("string");
    });
  });

  describe("SubscriptionId type", () => {
    it("a subscribe visszatérési értéke number (SubscriptionId = number)", async () => {
      const { MockExchangeFeed } = await import("./__testing__/mockFeed.js");
      const { asSymbol } = await import("./symbols.js");
      const feed = new MockExchangeFeed();
      await feed.open();
      const subId: SubscriptionId = await feed.subscribeTicker(
        asSymbol("BTC/USDC"),
        unexpectedSubscriptionInvocation,
      );
      expect(typeof subId).toBe("number");
      await feed.unsubscribe(subId);
      await feed.close();
    });
  });

  describe("FeedListener type", () => {
    it("a FeedListener típusú callback meghívódik ticker event-nél", async () => {
      const { MockExchangeFeed } = await import("./__testing__/mockFeed.js");
      const { asSymbol } = await import("./symbols.js");
      const feed = new MockExchangeFeed();
      await feed.open();
      let called = 0;
      const listener: FeedListener = () => {
        called++;
      };
      const subId = await feed.subscribeTicker(asSymbol("BTC/USDC"), listener);
      const symbol = asSymbol("BTC/USDC");
      const event: FeedEvent = {
        kind: "ticker",
        payload: {
          symbol,
          timestamp: 0,
          bid: 100,
          ask: 101,
          last: 100.5,
          baseVolume: 0,
          quoteVolume: 0,
        },
      };
      feed.pushEvent(event);
      expect(called).toBe(1);
      await feed.unsubscribe(subId);
      await feed.close();
    });
  });

  describe("type re-exports", () => {
    it("a re-exportált típusok importálhatók a feed.ts-ből", () => {
      // Ha ez a fájl lefordul, akkor a re-exportok működnek.
      // A típusellenőrzéshez használunk egy típusannotációt:
      const _typeCheck: ExchangeFeed["exchangeId"] = "test";
      expect(_typeCheck).toBe("test");
    });
  });
});
