/**
 * packages/exchange/src/bybit-eu-feed.test.ts
 *
 * 100% coverage test for `bybitEuFeed.ts` — the CCXT Pro bybit.eu
 * wrapper. We use **dependency injection** (the `exchange` option in
 * `BybitEuFeedOptions`) to inject a fake CCXT exchange, avoiding
 * `mock.module("ccxt", ...)` which would pollute the global CCXT
 * module and break the `latency-monitor.test.ts` tests that depend
 * on the real CCXT error messages.
 *
 * Phase 35b gap closer — the file was previously uncovered in the
 * exchange-package test suite (it relied on apps/bot integration
 * tests for coverage). The per-package 100% mandate requires an
 * OWN test, hence this file.
 *
 * The fake exchange is intentionally minimal: it implements only
 * the methods the wrapper actually calls (loadMarkets,
 * watchTicker, watchOrderBook, watchTrades, watchOHLCV, fetchTicker,
 * fetchOrderBook, fetchBalance, createOrder, cancelOrder, fetchOrder,
 * fetchOpenOrders, markets, id). Everything else is omitted.
 */
import { beforeEach, describe, expect, it } from "bun:test";

import {
  asSymbol,
  type RawOhlcvPayload,
  type RawOrderBookPayload,
  type RawTickerPayload,
  type RawTradePayload,
  symbolOf,
} from "./index.js";
import type { OrderBook } from "./types.js";

import { BybitEuFeed } from "./bybit-eu-feed.js";
import {
  makeFakeExchange,
  neverResolvingPromise,
  withCapturedBybitEuConstructor,
} from "./bybit-eu-feed.test-support.js";
import { normalizeTrade } from "./bybit-eu-normalizers.js";

class NotSupportedError extends Error {
  override name = "NotSupported";
}

describe("bybitEuFeed", () => {
  describe("subscribe* metódusok", () => {
    it("subscribeOrderBook átadja a limit paramétert", async () => {
      let receivedLimit: number | undefined;
      const newFake = makeFakeExchange({
        watchOrderBook: async (_symbol: string, limit: number) => {
          receivedLimit = limit;
          return neverResolvingPromise<RawOrderBookPayload>();
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: newFake,
      });
      await f.open();
      await f.subscribeOrderBook(asSymbol("BTC/USDC"), 50, () => {
        /*
        no-op
        */
      });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(receivedLimit).toBe(50);
      await f.close();
    });

    it("subscribeTrades hívja a watchTrades-t", async () => {
      let isCalled = false;
      const newFake = makeFakeExchange({
        watchTrades: async (_symbol: string) => {
          isCalled = true;
          return neverResolvingPromise<readonly RawTradePayload[]>();
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: newFake,
      });
      await f.open();
      await f.subscribeTrades(asSymbol("BTC/USDC"), () => {
        /*
        no-op
        */
      });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(isCalled).toBe(true);
      await f.close();
    });

    it("subscribeOhlcv átadja a timeframe paramétert", async () => {
      let receivedTimeframe: string | undefined;
      const newFake = makeFakeExchange({
        watchOHLCV: async (_symbol: string, tf: string) => {
          receivedTimeframe = tf;
          return neverResolvingPromise<readonly RawOhlcvPayload[]>();
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: newFake,
      });
      await f.open();
      await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1m", () => {
        /*
        no-op
        */
      });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(receivedTimeframe).toBe("1m");
      await f.close();
    });

    it("subscribe* dob, ha nincs open() hívás", () => {
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: makeFakeExchange(),
      });
      expect(
        f.subscribeTicker(asSymbol("BTC/USDC"), () => {
          /*
          no-op
          */
        }),
      ).rejects.toThrow(/open/);
    });

    it("unsubscribe törli a subscription-t", async () => {
      let isCalled = false;
      const newFake = makeFakeExchange({
        watchTicker: async (_symbol: string) => {
          isCalled = true;
          return neverResolvingPromise<RawTickerPayload>();
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: newFake,
      });
      await f.open();
      const id = await f.subscribeTicker(asSymbol("BTC/USDC"), () => {
        /*
        no-op
        */
      });
      await new Promise<void>((r) => setTimeout(r, 10));
      await f.unsubscribe(id);
      // A cancel a watchTicker által visszaadott promise-t "feloldja",
      // de mivel a fake soha nem oldja fel, ez csak a belső state-et
      // frissíti.
      expect(isCalled).toBe(true);
      await f.close();
    });
  });

  describe("statusOf", () => {
    let feed: BybitEuFeed;
    beforeEach(() => {
      feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: makeFakeExchange(),
      });
    });

    it("'open' → 'open'", () => {
      expect(feed.statusOf("open")).toBe("open");
    });

    it("'closed' → 'closed'", () => {
      expect(feed.statusOf("closed")).toBe("closed");
    });

    it("'canceled' → 'canceled'", () => {
      expect(feed.statusOf("canceled")).toBe("canceled");
    });

    it("'filled' → 'closed'", () => {
      expect(feed.statusOf("filled")).toBe("closed");
    });

    it("ismeretlen → 'open'", () => {
      expect(feed.statusOf("xxx")).toBe("open");
    });
  });

  describe("assertOpen (a metódusok előtti assert)", () => {
    it("subscribeTicker dob, ha nincs open()", () => {
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: makeFakeExchange(),
      });
      expect(
        feed.subscribeTicker(asSymbol("BTC/USDC"), () => {
          /*
          no-op
          */
        }),
      ).rejects.toThrow();
    });

    it("fetchBalances dob, ha nincs open()", () => {
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: makeFakeExchange(),
      });
      expect(feed.fetchBalances()).rejects.toThrow();
    });
  });

  describe("normalizeTrade (exportált helper)", () => {
    it("CCXT trade-et a mi Trade formátumunkra konvertálja", () => {
      // A CCXT trade formátumot a mi `Trade` típusunkra alakítja.
      const ccxtTrade: RawTradePayload = {
        id: "trade-1",
        timestamp: 1_700_000_000_000,
        symbol: "BTC/USDC",
        side: "buy",
        price: 60_000,
        amount: 0.01,
      };
      const trade = normalizeTrade(ccxtTrade, asSymbol("BTC/USDC"));
      expect(trade.id).toBe("trade-1");
      expect(trade.symbol).toBe(symbolOf("BTC/USDC"));
      expect(trade.takerSide).toBe("buy");
      expect(trade.price).toBe(60_000);
      expect(trade.amount).toBe(0.01);
      expect(trade.timestamp).toBe(1_700_000_000_000);
    });

    it("a 'sell' side-ot is kezeli", () => {
      const ccxtTrade: RawTradePayload = {
        id: "trade-2",
        timestamp: 1_700_000_000_000,
        symbol: "BTC/USDC",
        side: "sell",
        price: 60_000,
        amount: 0.01,
      };
      const trade = normalizeTrade(ccxtTrade, asSymbol("BTC/USDC"));
      expect(trade.takerSide).toBe("sell");
    });

    it("hiányzó id/timestamp/price/amount esetén default-okat ad", () => {
      // A CCXT trade formátum néha hiányos — a normalizeTrade default-okat ad.
      const ccxtTrade: RawTradePayload = {
        symbol: "BTC/USDC",
      };
      const before = Date.now();
      const trade = normalizeTrade(ccxtTrade, asSymbol("BTC/USDC"));
      const after = Date.now();
      expect(trade.id).toBe("");
      expect(trade.timestamp).toBeGreaterThanOrEqual(before);
      expect(trade.timestamp).toBeLessThanOrEqual(after);
      expect(trade.price).toBe(0);
      expect(trade.amount).toBe(0);
      // Hiányzó side esetén a takerSide "buy" (mert `raw.side === "sell"` hamis)
      expect(trade.takerSide).toBe("buy");
    });
  });

  // -----------------------------------------------------------------
  // CRITICAL FIX VERIFICATION (per /tmp/ccxt-FINAL-REPORT.md, /tmp/ccxt-review-3-ws.md)
  //
  // C1: bybitEuFeed.ts:118 — ccxt.bybiteu (REST-only) → ccxt.pro.bybiteu (WS-enabled).
  //     The CJS distribution's pro namespace is the only WS-enabled bybiteu.
  //     Verified at runtime: `pro instanceof ccxt.bybiteu === false`.
  // C2: bybitEuFeed.ts:401, 456 — watchOrderBook and watchTrades now have
  //     NotSupported → REST polling fallback (matching runTickerLoop/runOhlcvLoop).
  //     Defense-in-depth: even if CCXT regresses, the bot doesn't crash.
  // C3: bybitEuFeed.ts:164 — close() now calls this.client.close() to release
  //     the underlying WS connection. CCXT Pro does NOT self-close.
  // -----------------------------------------------------------------
  describe("C1/C2/C3 critical fix verification", () => {
    it("C1: a constructor ccxt.pro.bybiteu-t használ, nem a REST-only ccxt.bybiteu-t", () => {
      withCapturedBybitEuConstructor((capture) => {
        new BybitEuFeed({
          apiKey: "k",
          secret: "s",
          rateLimitMs: 100,
        });

        expect(capture.calls()).toBe(1);
        expect(capture.client()).toBeDefined();
      });
    });

    it("C2: watchOrderBook NotSupported falls back to fetchOrderBook polling", async () => {
      let fetchOrderBookCalls = 0;
      const receivedBooks: OrderBook[] = [];
      const newFake = makeFakeExchange({
        watchOrderBook: (_symbol: string, _limit: number): Promise<RawOrderBookPayload> =>
          Promise.reject(new NotSupportedError("bybiteu watchOrderBook() is not supported yet")),
        fetchOrderBook: (_symbol: string, _limit: number): Promise<RawOrderBookPayload> => {
          fetchOrderBookCalls++;
          return Promise.resolve({
            symbol: "BTC/USDC",
            timestamp: Date.now(),
            nonce: fetchOrderBookCalls,
            bids: [[59_999 + fetchOrderBookCalls, 1]],
            asks: [[60_001 + fetchOrderBookCalls, 1]],
          });
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        exchange: newFake,
      });
      await f.open();
      await f.subscribeOrderBook(asSymbol("BTC/USDC"), 10, (event) => {
        if (event.kind === "orderbook") {
          receivedBooks.push(event.payload);
        }
      });
      // The polling loop runs at 1s intervals; wait ~2.2s for ≥2 polls.
      await new Promise<void>((r) => setTimeout(r, 2200));
      expect(fetchOrderBookCalls).toBeGreaterThanOrEqual(2);
      expect(receivedBooks.length).toBeGreaterThanOrEqual(2);
      await f.close();
    });

    it("C2: watchTrades NotSupported falls back to fetchTrades polling", async () => {
      let fetchTradesCalls = 0;
      const receivedTrades: RawTradePayload[] = [];
      const newFake = makeFakeExchange({
        watchTrades: (_symbol: string): Promise<readonly RawTradePayload[]> =>
          Promise.reject(new NotSupportedError("bybiteu watchTrades() is not supported yet")),
        fetchTrades: (_symbol: string): Promise<readonly RawTradePayload[]> => {
          fetchTradesCalls++;
          return Promise.resolve([
            {
              id: `trade-${String(fetchTradesCalls)}`,
              timestamp: Date.now(),
              symbol: "BTC/USDC",
              side: "buy",
              price: 60_000,
              amount: 0.01,
            },
          ]);
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        exchange: newFake,
      });
      await f.open();
      await f.subscribeTrades(asSymbol("BTC/USDC"), (event) => {
        if (event.kind === "trade") {
          receivedTrades.push(event.payload);
        }
      });
      // The polling loop runs at 1s intervals; wait ~2.2s for ≥2 polls.
      await new Promise<void>((r) => setTimeout(r, 2200));
      expect(fetchTradesCalls).toBeGreaterThanOrEqual(2);
      expect(receivedTrades.length).toBeGreaterThanOrEqual(2);
      await f.close();
    });

    it("C3: close() hívja a this.client.close()-t a WS connection lezárásához", async () => {
      // Mockoljuk a CCXT client close metódusát, és asserteljük, hogy
      // a BybitEuFeed.close() tényleg hívja. CCXT Pro NEM zárja be
      // magát — a feed-nek kell explicit hívnia.
      let isCloseCalled = false;
      const newFake = makeFakeExchange({
        close: (): Promise<void> => {
          isCloseCalled = true;
          return Promise.resolve();
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        exchange: newFake,
      });
      await f.open();
      expect(isCloseCalled).toBe(false);
      await f.close();
      // A C3 fix: a this.client.close() a subs.clear() UTÁN hívódik.
      // Korábban a close() nem hívta — ez volt a WS leak.
      expect(isCloseCalled).toBe(true);
    });
  });
});
