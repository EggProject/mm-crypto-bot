import { describe, expect, it } from "bun:test";

import { asSymbol, type RawOhlcvPayload, type RawTickerPayload } from "./index.js";
import { BybitEuFeed } from "./bybit-eu-feed.js";
import { makeFakeExchange, neverResolvingPromise } from "./bybit-eu-feed.test-support.js";
import type { Ohlcv } from "./types.js";

class NotSupportedError extends Error {
  override name = "NotSupported";
}

describe("bybitEuFeed", () => {
  describe("subscribe* metódusok", () => {
    it("subscribeTicker visszaad egy id-t és a CCXT watchTicker hívódik", async () => {
      let isWatchTickerCalled = false;
      const newFake = makeFakeExchange({
        watchTicker: (_symbol: string) => {
          isWatchTickerCalled = true;
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
      expect(typeof id).toBe("number");
      // Kis várakozás, hogy a runTickerLoop elinduljon.
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(isWatchTickerCalled).toBe(true);
      await f.close();
    });

    // -----------------------------------------------------------------
    // Phase 66: CCXT 4.5.64 bybit.eu does NOT support watchTicker /
    // watchOHLCV (throws "NotSupported: bybiteu watchTicker() is not
    // supported yet"). The feed must fall back to fetchTicker /
    // fetchOHLCV polling at 1s intervals. Covers the polling-fallback
    // branches in bybitEuFeed.ts:367-380 (ticker) and :476-486 (ohlcv).
    // -----------------------------------------------------------------
    it("watchTicker NotSupported falls back to fetchTicker polling", async () => {
      let fetchTickerCalls = 0;
      const receivedTicks: number[] = [];
      const newFake = makeFakeExchange({
        watchTicker: (_symbol: string): Promise<RawTickerPayload> => {
          throw new NotSupportedError("bybiteu watchTicker() is not supported yet");
        },
        fetchTicker: (_symbol: string) => {
          fetchTickerCalls++;
          return Promise.resolve({
            symbol: "BTC/USDC",
            timestamp: Date.now(),
            bid: 59_999,
            ask: 60_001,
            last: 60_000 + fetchTickerCalls,
            baseVolume: 0,
            quoteVolume: 0,
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
      await f.subscribeTicker(asSymbol("BTC/USDC"), (event) => {
        if (event.kind === "ticker") {
          receivedTicks.push(event.payload.last);
        }
      });
      // The polling loop runs at 1s intervals; wait ~2.2s for ≥2 polls.
      await new Promise<void>((r) => setTimeout(r, 2200));
      expect(fetchTickerCalls).toBeGreaterThanOrEqual(2);
      expect(receivedTicks.length).toBeGreaterThanOrEqual(2);
      // The listener should have received the polled values.
      expect(receivedTicks[0]).toBeGreaterThan(60_000);
      await f.close();
    });

    it("watchOHLCV NotSupported falls back to fetchOHLCV polling", async () => {
      let fetchOhlcvCalls = 0;
      const receivedCandles: Ohlcv[] = [];
      const closedTimestamp = Date.now() - 2 * 60 * 60 * 1000;
      const newFake = makeFakeExchange({
        watchOHLCV: (_symbol: string, _tf: string): Promise<readonly RawOhlcvPayload[]> => {
          throw new NotSupportedError("bybiteu watchOHLCV() is not supported yet");
        },
        fetchOHLCV: (_symbol: string, _tf: string) => {
          fetchOhlcvCalls++;
          return Promise.resolve([
            // A lezárt candle többször visszajön a REST 100-as ablakában,
            // az aktuális (nyitott) candle pedig sosem jut át a feeden.
            [closedTimestamp, 60_000, 60_100, 59_900, 60_050, 12.345],
            [Date.now(), 60_050, 60_100, 60_000, 60_075, 1],
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
      await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", (event) => {
        if (event.kind === "ohlcv") {
          receivedCandles.push(event.payload.candle);
        }
      });
      // The polling loop runs at 1s intervals; wait ~2.2s for ≥2 polls.
      await new Promise<void>((r) => setTimeout(r, 2200));
      expect(fetchOhlcvCalls).toBeGreaterThanOrEqual(2);
      expect(receivedCandles).toHaveLength(1);
      expect(receivedCandles[0]?.[0]).toBe(closedTimestamp);
      await f.close();
    });

    it("a websocketből csak új, lezárt OHLCV candle-öket ad tovább", async () => {
      const now = Date.now();
      const firstClosed = now - 3 * 60 * 60 * 1000;
      const secondClosed = now - 2 * 60 * 60 * 1000;
      const open = now;
      let calls = 0;
      const newFake = makeFakeExchange({
        watchOHLCV: async () => {
          calls++;
          if (calls === 1) {
            return [
              [firstClosed, 1, 2, 1, 2, 1],
              [open, 2, 3, 2, 3, 1],
            ];
          }
          if (calls === 2) {
            return [
              [firstClosed, 1, 2, 1, 2, 1],
              [secondClosed, 2, 3, 2, 3, 1],
              [open, 3, 4, 3, 4, 1],
            ];
          }
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
      const received: number[] = [];
      const { promise: receivedTwice, resolve: resolveReceived } = Promise.withResolvers<undefined>();
      const id = await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", (event) => {
        if (event.kind !== "ohlcv") {
          return;
        }

        received.push(event.payload.candle[0]);
        if (received.length === 2) resolveReceived(undefined);
      });
      await Promise.race([
        receivedTwice,
        new Promise<void>((_resolve, reject) =>
          setTimeout(() => {
            reject(new Error("OHLCV events did not arrive"));
          }, 100),
        ),
      ]);
      expect(received).toEqual([firstClosed, secondClosed]);
      await f.unsubscribe(id);
      await f.close();
    });
  });
});
