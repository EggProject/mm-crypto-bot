import { describe, expect, it, vi } from "bun:test";

import {
  asSymbol,
  type RawOhlcvPayload,
  type RawOrderBookPayload,
  type RawTickerPayload,
  type RawTradePayload,
} from "./index.js";
import { ExchangeFeedError, type FeedListener } from "./feed.js";
import { BybitEuFeed } from "./bybit-eu-feed.js";
import { makeFakeExchange, neverResolvingPromise, type BybitEuClient } from "./bybit-eu-feed.test-support.js";
import type { Ohlcv, Timeframe } from "./types.js";

class NotSupportedError extends Error {
  override name = "NotSupported";
}

function notSupported(): Promise<never> {
  return Promise.reject(new NotSupportedError("not supported"));
}

describe("bybitEuFeed", () => {
  describe("subscribe* metódusok", () => {
    it("open/repeat/late-final/reconnect esetén timestampenként pontosan egy lezárt döntést ad", async () => {
      const first = 1_800_000_000_000;
      const second = first + 60_000;
      const third = second + 60_000;
      let calls = 0;
      const newFake = makeFakeExchange({
        watchOHLCV: async () => {
          calls++;
          if (calls === 1) return [[first, 1, 2, 1, 1.5, 1]];
          if (calls === 2) return [[first, 1, 3, 1, 2.5, 2]]; // repeated open update
          if (calls === 3)
            return [
              [first, 1, 3, 1, 2.75, 3],
              [second, 2.75, 4, 2, 3, 1],
            ]; // later bucket proves first final
          if (calls === 4)
            return [
              [first, 1, 3, 1, 2.75, 3],
              [second, 2.75, 4, 2, 3.5, 2],
              [third, 3.5, 5, 3, 4, 1],
            ]; // reconnect cache replay proves second final
          return neverResolvingPromise<readonly RawOhlcvPayload[]>();
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        exchange: newFake,
      });
      await f.open();
      const received: Ohlcv[] = [];
      const { promise: done, resolve: resolveDone } = Promise.withResolvers<undefined>();
      const id = await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1m", (event) => {
        if (event.kind !== "ohlcv") return;
        received.push(event.payload.candle);
        if (received.length === 2) resolveDone(undefined);
      });
      await Promise.race([
        done,
        new Promise<void>((_resolve, reject) =>
          setTimeout(() => {
            reject(new Error("final candles missing"));
          }, 100),
        ),
      ]);
      expect(received.map((candle) => candle[0])).toEqual([first, second]);
      expect(received[0]?.[4]).toBe(2.75); // latest value, not first open snapshot
      await f.unsubscribe(id);
      await f.close();
    });

    it("self-unsubscribe után a cache következő candle-je nem emitálódik, a másik subscription független", async () => {
      const now = Date.now();
      const firstClosed = now - 3 * 60 * 60 * 1000;
      const secondClosed = now - 2 * 60 * 60 * 1000;
      const releases: ((value: readonly RawOhlcvPayload[]) => void)[] = [];
      const newFake = makeFakeExchange({
        watchOHLCV: async () =>
          new Promise<readonly RawOhlcvPayload[]>((resolve) => {
            releases.push(resolve);
          }),
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        exchange: newFake,
      });
      await f.open();
      const firstReceived: number[] = [];
      const secondReceived: number[] = [];
      const firstSubscription = { id: 0 };
      const firstId = await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", (event) => {
        if (event.kind !== "ohlcv") return;
        firstReceived.push(event.payload.candle[0]);
        // Az async metódushívás a cancelled flaget szinkron állítja át.
        void f.unsubscribe(firstSubscription.id);
      });
      firstSubscription.id = firstId;
      const { promise: secondDone, resolve: resolveSecond } = Promise.withResolvers<undefined>();
      const secondId = await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", (event) => {
        if (event.kind !== "ohlcv") return;
        secondReceived.push(event.payload.candle[0]);
        if (secondReceived.length === 2) resolveSecond(undefined);
      });
      const firstRunner = f.waitForSubscription(firstId);
      const secondRunner = f.waitForSubscription(secondId);
      const batch: readonly RawOhlcvPayload[] = [
        [firstClosed, 1, 2, 1, 2, 1],
        [secondClosed, 2, 3, 2, 3, 1],
        [now, 3, 4, 3, 4, 1],
      ];
      const firstRelease = releases[0];
      const secondRelease = releases[1];
      if (firstRelease === undefined || secondRelease === undefined) {
        throw new Error("OHLCV subscriptions did not start");
      }
      firstRelease(batch);
      secondRelease(batch);
      await secondDone;
      await firstRunner;
      expect(firstReceived).toEqual([firstClosed]);
      expect(secondReceived).toEqual([firstClosed, secondClosed]);
      await f.unsubscribe(secondId);
      // A második subscription már a következő CCXT watch Promise-ban vár.
      const thirdRelease = releases[2];
      if (thirdRelease === undefined) {
        throw new Error("Second OHLCV subscription did not start its next watch");
      }
      thirdRelease([]);
      await secondRunner;
      await f.close();
    });

    it("minden támogatott timeframe pontos close-határán emitál, előtte nem", async () => {
      const fixedNow = 1_800_000_000_000;
      const cases: readonly [Timeframe, number][] = [
        ["1m", 60_000],
        ["5m", 5 * 60_000],
        ["15m", 15 * 60_000],
        ["1h", 60 * 60_000],
        ["4h", 4 * 60 * 60_000],
        ["1d", 24 * 60 * 60_000],
      ];
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
      try {
        for (const [timeframe, duration] of cases) {
          const releases: ((value: readonly RawOhlcvPayload[]) => void)[] = [];
          const f = new BybitEuFeed({
            apiKey: "k",
            secret: "s",
            rateLimitMs: 10,
            exchange: makeFakeExchange({
              watchOHLCV: async () =>
                new Promise<readonly RawOhlcvPayload[]>((resolve) => {
                  releases.push(resolve);
                }),
            }),
          });
          await f.open();
          const received: number[] = [];
          const { promise: firstEvent, resolve: resolveReceived } = Promise.withResolvers<undefined>();
          const id = await f.subscribeOhlcv(asSymbol("BTC/USDC"), timeframe, (event) => {
            if (event.kind !== "ohlcv") {
              return;
            }

            received.push(event.payload.candle[0]);
            resolveReceived(undefined);
          });
          const runner = f.waitForSubscription(id);
          const exactBoundary = fixedNow - duration;
          const firstRelease = releases[0];
          if (firstRelease === undefined) {
            throw new Error("OHLCV subscription did not start");
          }
          firstRelease([
            [exactBoundary, 1, 2, 1, 2, 1],
            [exactBoundary + 1, 2, 3, 2, 3, 1],
          ]);
          await firstEvent;
          expect(received).toEqual([exactBoundary]);
          await f.unsubscribe(id);
          const secondRelease = releases[1];
          if (secondRelease === undefined) {
            throw new Error("OHLCV subscription did not start its next watch");
          }
          secondRelease([]);
          await runner;
          await f.close();
        }
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("mind a négy REST fallback várakozása azonnal abortálható és nem hagy timert", async () => {
      const oldCandle = Date.now() - 2 * 60 * 60 * 1000;
      const cases: readonly {
        readonly name: string;
        readonly overrides: Partial<BybitEuClient>;
        readonly subscribe: (feed: BybitEuFeed, listener: FeedListener) => Promise<number>;
      }[] = [
        {
          name: "ticker",
          overrides: { watchTicker: notSupported },
          subscribe: (current, listener) => current.subscribeTicker(asSymbol("BTC/USDC"), listener),
        },
        {
          name: "orderbook",
          overrides: { watchOrderBook: notSupported },
          subscribe: (current, listener) => current.subscribeOrderBook(asSymbol("BTC/USDC"), 10, listener),
        },
        {
          name: "trades",
          overrides: {
            watchTrades: notSupported,
            fetchTrades: () =>
              Promise.resolve([{ id: "t1", timestamp: 1, price: 100, amount: 1, side: "buy" }]),
          },
          subscribe: (current, listener) => current.subscribeTrades(asSymbol("BTC/USDC"), listener),
        },
        {
          name: "ohlcv",
          overrides: {
            watchOHLCV: notSupported,
            fetchOHLCV: () => Promise.resolve([[oldCandle, 1, 2, 1, 2, 1]]),
          },
          subscribe: (current, listener) => current.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", listener),
        },
      ];
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      try {
        for (const item of cases) {
          const f = new BybitEuFeed({
            apiKey: "k",
            secret: "s",
            rateLimitMs: 10,
            exchange: makeFakeExchange(item.overrides),
          });
          await f.open();
          const { promise: received, resolve: resolveReceived } = Promise.withResolvers<undefined>();
          let emitCount = 0;
          const id = await item.subscribe(f, () => {
            emitCount++;
            resolveReceived(undefined);
          });
          await received;
          const sub = f.waitForSubscription(id);
          const scheduledBeforeAbort = setTimeoutSpy.mock.calls.length;
          const clearedBeforeAbort = clearTimeoutSpy.mock.calls.length;
          expect(scheduledBeforeAbort).toBeGreaterThan(0);
          await f.unsubscribe(id);
          await sub;
          expect(clearTimeoutSpy.mock.calls.length).toBe(clearedBeforeAbort + 1);
          expect(emitCount).toBe(1);
          await f.close();
        }
        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(setTimeoutSpy).toHaveBeenCalledTimes(cases.length);
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(cases.length);
      } finally {
        setIntervalSpy.mockRestore();
        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      }
    });

    it("mind a négy pending CCXT fallback fetch eredményét eldobja unsubscribe után", async () => {
      const cases: readonly {
        readonly name: string;
        readonly createClient: (markStarted: () => void) => {
          readonly client: BybitEuClient;
          readonly resolvePendingFetch: () => void;
        };
        readonly subscribe: (feed: BybitEuFeed, listener: FeedListener) => Promise<number>;
      }[] = [
        {
          name: "ticker",
          createClient: (markStarted) => {
            const { promise: pending, resolve: resolvePending } = Promise.withResolvers<RawTickerPayload>();
            return {
              client: makeFakeExchange({
                watchTicker: notSupported,
                fetchTicker: () => {
                  markStarted();
                  return pending;
                },
              }),
              resolvePendingFetch: () => {
                resolvePending({ timestamp: 1, bid: 1, ask: 2, last: 1.5 });
              },
            };
          },
          subscribe: (current, listener) => current.subscribeTicker(asSymbol("BTC/USDC"), listener),
        },
        {
          name: "orderbook",
          createClient: (markStarted) => {
            const { promise: pending, resolve: resolvePending } =
              Promise.withResolvers<RawOrderBookPayload>();
            return {
              client: makeFakeExchange({
                watchOrderBook: notSupported,
                fetchOrderBook: () => {
                  markStarted();
                  return pending;
                },
              }),
              resolvePendingFetch: () => {
                resolvePending({ timestamp: 1, nonce: 1, bids: [[1, 1]], asks: [[2, 1]] });
              },
            };
          },
          subscribe: (current, listener) => current.subscribeOrderBook(asSymbol("BTC/USDC"), 10, listener),
        },
        {
          name: "trades",
          createClient: (markStarted) => {
            const { promise: pending, resolve: resolvePending } =
              Promise.withResolvers<readonly RawTradePayload[]>();
            return {
              client: makeFakeExchange({
                watchTrades: notSupported,
                fetchTrades: () => {
                  markStarted();
                  return pending;
                },
              }),
              resolvePendingFetch: () => {
                resolvePending([{ id: "t1", timestamp: 1, price: 1, amount: 1, side: "buy" }]);
              },
            };
          },
          subscribe: (current, listener) => current.subscribeTrades(asSymbol("BTC/USDC"), listener),
        },
        {
          name: "ohlcv",
          createClient: (markStarted) => {
            const { promise: pending, resolve: resolvePending } =
              Promise.withResolvers<readonly RawOhlcvPayload[]>();
            return {
              client: makeFakeExchange({
                watchOHLCV: notSupported,
                fetchOHLCV: () => {
                  markStarted();
                  return pending;
                },
              }),
              resolvePendingFetch: () => {
                resolvePending([[1, 1, 2, 1, 2, 1]]);
              },
            };
          },
          subscribe: (current, listener) => current.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", listener),
        },
      ];
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      try {
        for (const item of cases) {
          const { promise: started, resolve: resolveStarted } = Promise.withResolvers<undefined>();
          const current = item.createClient(resolveStarted);
          const f = new BybitEuFeed({
            apiKey: "k",
            secret: "s",
            rateLimitMs: 10,
            exchange: current.client,
          });
          await f.open();
          let emitCount = 0;
          const id = await item.subscribe(f, () => {
            emitCount++;
          });
          const sub = f.waitForSubscription(id);
          await started;
          await f.unsubscribe(id);
          current.resolvePendingFetch();
          await sub;
          expect(sub).resolves.toBeUndefined();
          expect(emitCount).toBe(0);
          expect(() => f.waitForSubscription(id)).toThrow(ExchangeFeedError);
          await f.close();
        }
        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        expect(clearTimeoutSpy).not.toHaveBeenCalled();
      } finally {
        setIntervalSpy.mockRestore();
        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      }
    });
  });
});
