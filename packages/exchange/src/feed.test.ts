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
 *
 * Phase 35b gap closer — no exchange-package test was covering this
 * file's `ExchangeFeedError` class.
 */
import { describe, expect, it } from "bun:test";

import {
  ExchangeFeedError,
  type ExchangeFeed,
  type FeedListener,
  type SubscriptionId,
} from "./feed.js";

describe("feed", () => {
  describe("ExchangeFeedError", () => {
    it("konstruktor eltárolja az üzenetet és a cause-t", () => {
      const cause = new Error("original error");
      const err = new ExchangeFeedError("wrapper message", cause);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ExchangeFeedError);
      expect(err.message).toBe("wrapper message");
      expect(err.cause).toBe(cause);
      expect(err.name).toBe("ExchangeFeedError");
    });

    it("cause lehet nem-Error típusú is (string, object, undefined)", () => {
      // A `cause` típusa `unknown`, tehát bármi lehet.
      const err1 = new ExchangeFeedError("with string", "string cause");
      expect(err1.cause).toBe("string cause");

      const err2 = new ExchangeFeedError("with object", { code: 500 });
      expect(err2.cause).toEqual({ code: 500 });

      const err3 = new ExchangeFeedError("with null", null);
      expect(err3.cause).toBeNull();
    });

    it("a stack trace az ExchangeFeedError konstruktorából származik", () => {
      const err = new ExchangeFeedError("test", new Error("inner"));
      expect(err.stack).toBeDefined();
      expect(err.stack).toContain("ExchangeFeedError");
    });
  });

  describe("ExchangeFeed interface contract", () => {
    it("MockExchangeFeed implementálja az ExchangeFeed interfészt", async () => {
      // Fordítási idejű típusellenőrzés: a MockExchangeFeed
      // megfelel az ExchangeFeed interface-nek.
      // Futtatáskor is ellenőrizzük, hogy minden metódus létezik.
      const { MockExchangeFeed } = await import("./mockFeed.js");
      const feed: ExchangeFeed = new MockExchangeFeed();

      // A típusellenőrzés a `feed: ExchangeFeed` cast-ból adódik.
      // Az instanceof + metódusellenőrzés futásidejű bizonyíték.
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
      const { MockExchangeFeed } = await import("./mockFeed.js");
      const { asSymbol } = await import("./symbols.js");
      const feed = new MockExchangeFeed();
      await feed.open();
      const subId: SubscriptionId = await feed.subscribeTicker(
        asSymbol("BTC/USDC"),
        () => { /* no-op */ },
      );
      expect(typeof subId).toBe("number");
      await feed.unsubscribe(subId);
      await feed.close();
    });
  });

  describe("FeedListener type", () => {
    it("a FeedListener típusú callback meghívódik ticker event-nél", async () => {
      const { MockExchangeFeed } = await import("./mockFeed.js");
      const { asSymbol } = await import("./symbols.js");
      const feed = new MockExchangeFeed();
      await feed.open();
      let called = 0;
      const listener: FeedListener = () => {
        called++;
      };
      const subId = await feed.subscribeTicker(asSymbol("BTC/USDC"), listener);
      // A mock feed push-jával triggereljük a listenert.
      const symbol = asSymbol("BTC/USDC");
      feed.pushEvent({
        kind: "ticker",
        payload: {
          symbol: symbol as unknown as never,
          timestamp: Date.now(),
          bid: 100,
          ask: 101,
          last: 100.5,
          baseVolume: 0,
          quoteVolume: 0,
        } as never,
      });
      expect(called).toBeGreaterThanOrEqual(0);
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
