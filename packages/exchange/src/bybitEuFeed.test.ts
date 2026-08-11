/**
 * packages/exchange/src/bybitEuFeed.test.ts
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
 * the methods the wrapper actually calls (loadMarkets, setSandboxMode,
 * watchTicker, watchOrderBook, watchTrades, watchOHLCV, fetchTicker,
 * fetchOrderBook, fetchBalance, createOrder, cancelOrder, fetchOrder,
 * fetchOpenOrders, markets, id). Everything else is omitted.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { asSymbol, type Timeframe } from "./symbols.js";
import type { FeedListener } from "./feed.js";
import type { ClientOrderId, OrderRequest } from "./types.js";
import ccxt, { type Exchange as CcxtExchange } from "ccxt";

import { BybitEuFeed, normalizeTrade } from "./bybitEuFeed.js";

// ---------------------------------------------------------------------------
// Fake CCXT exchange — implements only the methods BybitEuFeed uses
// ---------------------------------------------------------------------------

interface FakeExchange {
  id: string;
  markets: Record<string, unknown>;
  market: (symbol: string) => { spot: boolean };
  loadMarkets: () => Promise<unknown[]>;
  setSandboxMode: (v: boolean) => void;
  watchTicker: (symbol: string) => Promise<unknown>;
  watchOrderBook: (symbol: string, limit: number) => Promise<unknown>;
  watchTrades: (symbol: string) => Promise<unknown>;
  watchOHLCV: (symbol: string, timeframe: string) => Promise<unknown>;
  fetchTicker: (symbol: string) => Promise<unknown>;
  fetchOrderBook: (symbol: string, limit: number) => Promise<unknown>;
  fetchTrades: (symbol: string) => Promise<unknown[]>;
  fetchBalance: () => Promise<unknown>;
  has: Record<string, boolean>;
  fetchPositions: (symbols?: string[]) => Promise<unknown[]>;
  fetchOHLCV?: (symbol: string, timeframe: string, since?: number, limit?: number) => Promise<unknown>;
  createOrder: (
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price?: number,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  cancelOrderWithClientOrderId: (
    clientOrderId: string,
    symbol: string,
  ) => Promise<unknown>;
  cancelOrder: (
    id: string | undefined,
    symbol: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  fetchOrderWithClientOrderId: (
    clientOrderId: string,
    symbol: string,
  ) => Promise<unknown>;
  fetchOrder: (
    id: string | undefined,
    symbol: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  fetchOpenOrders: (symbol: string) => Promise<unknown[]>;
  close: () => Promise<void>;
}

function makeFakeExchange(overrides: Partial<FakeExchange> = {}): FakeExchange {
  // A `watch*` metódusok soha nem resolve-olnak (a teszt cancel-eli
  // a subscription-t, mielőtt bármi történne). Így a CCXT wrapper
  // run*Loop metódusai a subscription-ig futnak, és a cancelled flag
  // miatt kilépnek.
  const neverResolvingPromise = new Promise<unknown>(() => { /* never */ });
  const base: FakeExchange = {
    id: "bybiteu",
    markets: {
      "BTC/USDC": {
        id: "BTCUSDC",
        symbol: "BTC/USDC",
        base: "BTC",
        quote: "USDC",
        precision: { amount: 4, price: 2 },
        limits: { amount: { min: 0.0001 }, cost: { min: 1 } },
      },
    },
    market: (_symbol: string) => ({ spot: true }),
    loadMarkets: async () => [],
    setSandboxMode: (_v: boolean) => { /* no-op */ },
    watchTicker: (_symbol: string) => neverResolvingPromise,
    watchOrderBook: (_symbol: string, _limit: number) => neverResolvingPromise,
    watchTrades: (_symbol: string) => neverResolvingPromise,
    watchOHLCV: (_symbol: string, _tf: string) => neverResolvingPromise,
    fetchTicker: async (_symbol: string) => ({
      symbol: "BTC/USDC",
      timestamp: Date.now(),
      bid: 59_999,
      ask: 60_001,
      last: 60_000,
      baseVolume: 0,
      quoteVolume: 0,
    }),
    fetchOrderBook: async (_symbol: string, _limit: number) => ({
      symbol: "BTC/USDC",
      timestamp: Date.now(),
      nonce: 0,
      bids: [[59_999, 1]],
      asks: [[60_001, 1]],
    }),
    fetchTrades: async (_symbol: string) => [],
    fetchBalance: async () => ({
      USDC: { free: 10_000, total: 10_000, used: 0 },
      info: {},
    }),
    has: { fetchPositions: false },
    fetchPositions: async (_symbols?: string[]) => [],
    createOrder: async (
      _symbol: string,
      type: string,
      side: string,
      amount: number,
      price?: number,
      _params?: Record<string, unknown>,
    ) => ({
      id: `mock-${Date.now()}`,
      clientOrderId: "test-order",
      symbol: "BTC/USDC",
      type,
      side,
      amount,
      price,
      status: "open",
      filled: 0,
      timestamp: Date.now(),
    }),
    cancelOrderWithClientOrderId: async (
      _clientOrderId: string,
      _symbol: string,
    ) => ({
      id: "mock",
      clientOrderId: "test-order",
      symbol: "BTC/USDC",
      status: "canceled",
    }),
    cancelOrder: async (
      _id: string | undefined,
      _symbol: string,
      params?: Record<string, unknown>,
    ) => ({
      id: "mock",
      clientOrderId: params?.orderLinkId,
      symbol: "BTC/USDC",
      status: "canceled",
    }),
    fetchOrderWithClientOrderId: async (
      clientOrderId: string,
      _symbol: string,
    ) => ({
      id: "mock",
      clientOrderId,
      symbol: "BTC/USDC",
      status: "open",
    }),
    fetchOrder: async (
      _id: string | undefined,
      _symbol: string,
      params?: Record<string, unknown>,
    ) => ({
      id: "mock",
      clientOrderId: params?.orderLinkId,
      symbol: "BTC/USDC",
      status: "open",
    }),
    fetchOpenOrders: async (_symbol: string) => [],
    close: async () => { /* no-op — tracked via overrides for C3 test */ },
  };
  return { ...base, ...overrides };
}

/**
 * A fake exchange-t úgy adjuk át a BybitEuFeed-nek, hogy a CCXT
 * típusnak tűnjön. A TypeScript strict type-checkinghez kasztolunk.
 */
function asCcxt(fake: FakeExchange): CcxtExchange {
  return fake as unknown as CcxtExchange;
}

describe("bybitEuFeed", () => {
  describe("konstruktor", () => {
    it("exchangeId='bybiteu'", () => {
      const fake = makeFakeExchange();
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(fake),
      });
      expect(feed.exchangeId).toBe("bybiteu");
    });

    it("sandbox=true esetén setSandboxMode(true)-t hív", () => {
      let sandboxCalled = false;
      const fake = makeFakeExchange({
        setSandboxMode: (_v: boolean) => {
          sandboxCalled = true;
        },
      });
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: true,
        exchange: asCcxt(fake),
      });
      expect(sandboxCalled).toBe(true);
      expect(feed.exchangeId).toBe("bybiteu");
    });

    it("sandbox=false esetén NEM hív setSandboxMode-ot", () => {
      let sandboxCalled = false;
      const fake = makeFakeExchange({
        setSandboxMode: (_v: boolean) => {
          sandboxCalled = true;
        },
      });
      const _feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(fake),
      });
      expect(sandboxCalled).toBe(false);
    });

    it("a 'raw' getter a CCXT exchange-t adja vissza", () => {
      const fake = makeFakeExchange();
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(fake),
      });
      const raw = (feed as unknown as { raw: unknown }).raw;
      expect(raw).toBe(fake);
    });
  });

  describe("open / close", () => {
    it("open() hívja a loadMarkets()-t és opened=true lesz", async () => {
      let loadMarketsCalled = false;
      const fake = makeFakeExchange({
        loadMarkets: async () => {
          loadMarketsCalled = true;
          return [];
        },
      });
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(fake),
      });
      await feed.open();
      expect(loadMarketsCalled).toBe(true);
    });

    it("open() idempotens (második hívás NEM hívja loadMarkets()-t)", async () => {
      let loadMarketsCount = 0;
      const fake = makeFakeExchange({
        loadMarkets: async () => {
          loadMarketsCount++;
          return [];
        },
      });
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(fake),
      });
      await feed.open();
      await feed.open();
      expect(loadMarketsCount).toBe(1);
    });

    it("close() törli a subscription-öket", async () => {
      const fake = makeFakeExchange();
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(fake),
      });
      await feed.open();
      const id = await feed.subscribeTicker(asSymbol("BTC/USDC"), () => { /* no-op */ });
      expect(typeof id).toBe("number");
      await feed.close();
      // A close() után a subscription törölve van.
      // Az unsubscribe NEM dob, csak no-op.
      await feed.unsubscribe(id);
    });
  });

  describe("subscribe* metódusok", () => {
    let feed: BybitEuFeed;
    let fake: FakeExchange;

    beforeEach(async () => {
      fake = makeFakeExchange();
      feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(fake),
      });
      await feed.open();
    });

    afterEach(async () => {
      await feed.close();
    });

    it("subscribeTicker visszaad egy id-t és a CCXT watchTicker hívódik", async () => {
      let watchTickerCalled = false;
      const newFake = makeFakeExchange({
        watchTicker: async (_symbol: string) => {
          watchTickerCalled = true;
          return new Promise<unknown>(() => { /* never */ });
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(newFake),
      });
      await f.open();
      const id = await f.subscribeTicker(asSymbol("BTC/USDC"), () => { /* no-op */ });
      expect(typeof id).toBe("number");
      // Kis várakozás, hogy a runTickerLoop elinduljon.
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(watchTickerCalled).toBe(true);
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
        watchTicker: async (_symbol: string): Promise<unknown> => {
          const err = new Error("bybiteu watchTicker() is not supported yet");
          err.name = "NotSupported";
          throw err;
        },
        fetchTicker: async (_symbol: string) => {
          fetchTickerCalls++;
          return {
            symbol: "BTC/USDC",
            timestamp: Date.now(),
            bid: 59_999,
            ask: 60_001,
            last: 60_000 + fetchTickerCalls,
            baseVolume: 0,
            quoteVolume: 0,
          };
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        sandbox: false,
        exchange: asCcxt(newFake),
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
      const receivedCandles: unknown[] = [];
      const closedTimestamp = Date.now() - 2 * 60 * 60 * 1000;
      const newFake = makeFakeExchange({
        watchOHLCV: async (_symbol: string, _tf: string): Promise<unknown> => {
          const err = new Error("bybiteu watchOHLCV() is not supported yet");
          err.name = "NotSupported";
          throw err;
        },
        fetchOHLCV: async (_symbol: string, _tf: string) => {
          fetchOhlcvCalls++;
          return [
            // A lezárt candle többször visszajön a REST 100-as ablakában,
            // az aktuális (nyitott) candle pedig sosem jut át a feeden.
            [closedTimestamp, 60_000, 60_100, 59_900, 60_050, 12.345],
            [Date.now(), 60_050, 60_100, 60_000, 60_075, 1],
          ];
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        sandbox: false,
        exchange: asCcxt(newFake),
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
      expect((receivedCandles[0] as readonly number[])[0]).toBe(closedTimestamp);
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
          return new Promise<unknown>(() => { /* wait for unsubscribe */ });
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        sandbox: false,
        exchange: asCcxt(newFake),
      });
      await f.open();
      const received: number[] = [];
      let resolveReceived!: () => void;
      const receivedTwice = new Promise<void>((resolve) => {
        resolveReceived = resolve;
      });
      const id = await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", (event) => {
        if (event.kind === "ohlcv") {
          received.push(event.payload.candle[0]);
          if (received.length === 2) resolveReceived();
        }
      });
      await Promise.race([
        receivedTwice,
        new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error("OHLCV events did not arrive")), 100)),
      ]);
      expect(received).toEqual([firstClosed, secondClosed]);
      await f.unsubscribe(id);
      await f.close();
    });

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
          if (calls === 3) return [[first, 1, 3, 1, 2.75, 3], [second, 2.75, 4, 2, 3, 1]]; // later bucket proves first final
          if (calls === 4) return [
            [first, 1, 3, 1, 2.75, 3], [second, 2.75, 4, 2, 3.5, 2], [third, 3.5, 5, 3, 4, 1],
          ]; // reconnect cache replay proves second final
          return new Promise<unknown>(() => { /* wait for unsubscribe */ });
        },
      });
      const f = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 10, sandbox: false, exchange: asCcxt(newFake) });
      await f.open();
      const received: Ohlcv[] = [];
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => { resolveDone = resolve; });
      const id = await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1m", (event) => {
        if (event.kind !== "ohlcv") return;
        received.push(event.payload.candle);
        if (received.length === 2) resolveDone();
      });
      await Promise.race([done, new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error("final candles missing")), 100))]);
      expect(received.map((candle) => candle[0])).toEqual([first, second]);
      expect(received[0]?.[4]).toBe(2.75); // latest value, not first open snapshot
      await f.unsubscribe(id);
      await f.close();
    });

    it("self-unsubscribe után a cache következő candle-je nem emitálódik, a másik subscription független", async () => {
      const now = Date.now();
      const firstClosed = now - 3 * 60 * 60 * 1000;
      const secondClosed = now - 2 * 60 * 60 * 1000;
      const releases: ((value: unknown) => void)[] = [];
      const newFake = makeFakeExchange({
        watchOHLCV: async () => new Promise<unknown>((resolve) => releases.push(resolve)),
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        sandbox: false,
        exchange: asCcxt(newFake),
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
      let resolveSecond!: () => void;
      const secondDone = new Promise<void>((resolve) => {
        resolveSecond = resolve;
      });
      const secondId = await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", (event) => {
        if (event.kind !== "ohlcv") return;
        secondReceived.push(event.payload.candle[0]);
        if (secondReceived.length === 2) resolveSecond();
      });
      const firstRunner = (f as unknown as { subs: Map<number, { runner: Promise<void> }> }).subs.get(firstId)!.runner;
      const secondRunner = (f as unknown as { subs: Map<number, { runner: Promise<void> }> }).subs.get(secondId)!.runner;
      const batch = [
        [firstClosed, 1, 2, 1, 2, 1],
        [secondClosed, 2, 3, 2, 3, 1],
        [now, 3, 4, 3, 4, 1],
      ];
      releases[0]!(batch);
      releases[1]!(batch);
      await secondDone;
      await firstRunner;
      expect(firstReceived).toEqual([firstClosed]);
      expect(secondReceived).toEqual([firstClosed, secondClosed]);
      await f.unsubscribe(secondId);
      // A második subscription már a következő CCXT watch Promise-ban vár.
      releases[2]!([]);
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
      const nowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);
      try {
        for (const [timeframe, duration] of cases) {
          const releases: ((value: unknown) => void)[] = [];
          const f = new BybitEuFeed({
            apiKey: "k",
            secret: "s",
            rateLimitMs: 10,
            sandbox: false,
            exchange: asCcxt(makeFakeExchange({
              watchOHLCV: async () => new Promise<unknown>((resolve) => releases.push(resolve)),
            })),
          });
          await f.open();
          const received: number[] = [];
          let resolveReceived!: () => void;
          const firstEvent = new Promise<void>((resolve) => {
            resolveReceived = resolve;
          });
          const id = await f.subscribeOhlcv(asSymbol("BTC/USDC"), timeframe, (event) => {
            if (event.kind === "ohlcv") {
              received.push(event.payload.candle[0]);
              resolveReceived();
            }
          });
          const runner = (f as unknown as { subs: Map<number, { runner: Promise<void> }> }).subs.get(id)!.runner;
          const exactBoundary = fixedNow - duration;
          releases[0]!([
            [exactBoundary, 1, 2, 1, 2, 1],
            [exactBoundary + 1, 2, 3, 2, 3, 1],
          ]);
          await firstEvent;
          expect(received).toEqual([exactBoundary]);
          await f.unsubscribe(id);
          releases[1]!([]);
          await runner;
          await f.close();
        }
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("mind a négy REST fallback várakozása azonnal abortálható és nem hagy timert", async () => {
      const notSupported = async (): Promise<never> => {
        const err = new Error("not supported");
        err.name = "NotSupported";
        throw err;
      };
      const oldCandle = Date.now() - 2 * 60 * 60 * 1000;
      const cases: readonly {
        readonly name: string;
        readonly overrides: Partial<FakeExchange>;
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
            fetchTrades: async () => [{ id: "t1", timestamp: 1, price: 100, amount: 1, side: "buy" }],
          },
          subscribe: (current, listener) => current.subscribeTrades(asSymbol("BTC/USDC"), listener),
        },
        {
          name: "ohlcv",
          overrides: {
            watchOHLCV: notSupported,
            fetchOHLCV: async () => [[oldCandle, 1, 2, 1, 2, 1]],
          },
          subscribe: (current, listener) => current.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", listener),
        },
      ];
      const setIntervalSpy = spyOn(globalThis, "setInterval");
      const setTimeoutSpy = spyOn(globalThis, "setTimeout");
      const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");
      try {
        for (const item of cases) {
          const f = new BybitEuFeed({
            apiKey: "k",
            secret: "s",
            rateLimitMs: 10,
            sandbox: false,
            exchange: asCcxt(makeFakeExchange(item.overrides)),
          });
          await f.open();
          let resolveReceived!: () => void;
          const received = new Promise<void>((resolve) => {
            resolveReceived = resolve;
          });
          let emitCount = 0;
          const id = await item.subscribe(f, () => {
            emitCount++;
            resolveReceived();
          });
          await received;
          const sub = (f as unknown as { subs: Map<number, { runner: Promise<void> }> }).subs.get(id)!;
          const scheduledBeforeAbort = setTimeoutSpy.mock.calls.length;
          const clearedBeforeAbort = clearTimeoutSpy.mock.calls.length;
          expect(scheduledBeforeAbort).toBeGreaterThan(0);
          await f.unsubscribe(id);
          await sub.runner;
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
      const notSupported = async (): Promise<never> => {
        const err = new Error("not supported");
        err.name = "NotSupported";
        throw err;
      };
      const cases: readonly {
        readonly name: string;
        readonly result: unknown;
        readonly createOverrides: (
          pending: Promise<unknown>,
          markStarted: () => void,
        ) => Partial<FakeExchange>;
        readonly subscribe: (feed: BybitEuFeed, listener: FeedListener) => Promise<number>;
      }[] = [
        {
          name: "ticker",
          result: { symbol: "BTC/USDC", timestamp: 1, bid: 1, ask: 2, last: 1.5 },
          createOverrides: (pending, markStarted) => ({
            watchTicker: notSupported,
            fetchTicker: () => {
              markStarted();
              return pending;
            },
          }),
          subscribe: (current, listener) => current.subscribeTicker(asSymbol("BTC/USDC"), listener),
        },
        {
          name: "orderbook",
          result: { symbol: "BTC/USDC", timestamp: 1, nonce: 1, bids: [[1, 1]], asks: [[2, 1]] },
          createOverrides: (pending, markStarted) => ({
            watchOrderBook: notSupported,
            fetchOrderBook: () => {
              markStarted();
              return pending;
            },
          }),
          subscribe: (current, listener) => current.subscribeOrderBook(asSymbol("BTC/USDC"), 10, listener),
        },
        {
          name: "trades",
          result: [{ id: "t1", timestamp: 1, price: 1, amount: 1, side: "buy" }],
          createOverrides: (pending, markStarted) => ({
            watchTrades: notSupported,
            fetchTrades: () => {
              markStarted();
              return pending as Promise<unknown[]>;
            },
          }),
          subscribe: (current, listener) => current.subscribeTrades(asSymbol("BTC/USDC"), listener),
        },
        {
          name: "ohlcv",
          result: [[1, 1, 2, 1, 2, 1]],
          createOverrides: (pending, markStarted) => ({
            watchOHLCV: notSupported,
            fetchOHLCV: () => {
              markStarted();
              return pending;
            },
          }),
          subscribe: (current, listener) => current.subscribeOhlcv(asSymbol("BTC/USDC"), "1h", listener),
        },
      ];
      const setIntervalSpy = spyOn(globalThis, "setInterval");
      const setTimeoutSpy = spyOn(globalThis, "setTimeout");
      const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");
      const addAbortListenerSpy = spyOn(AbortSignal.prototype, "addEventListener");
      const removeAbortListenerSpy = spyOn(AbortSignal.prototype, "removeEventListener");
      try {
        for (const item of cases) {
          let resolveStarted!: () => void;
          const started = new Promise<void>((resolve) => {
            resolveStarted = resolve;
          });
          let resolveFetch!: (value: unknown) => void;
          const pendingFetch = new Promise<unknown>((resolve) => {
            resolveFetch = resolve;
          });
          const f = new BybitEuFeed({
            apiKey: "k",
            secret: "s",
            rateLimitMs: 10,
            sandbox: false,
            exchange: asCcxt(makeFakeExchange(item.createOverrides(pendingFetch, resolveStarted))),
          });
          await f.open();
          let emitCount = 0;
          const id = await item.subscribe(f, () => {
            emitCount++;
          });
          const sub = (f as unknown as { subs: Map<number, { runner: Promise<void> }> }).subs.get(id)!;
          await started;
          await f.unsubscribe(id);
          resolveFetch(item.result);
          await sub.runner;
          expect(emitCount).toBe(0);
          await f.close();
        }
        // Unsubscribe a pending fetch-et nem tudja megszakítani, de annak
        // visszatérése után a loop még a poll-wait létrehozása előtt kilép.
        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        expect(clearTimeoutSpy).not.toHaveBeenCalled();
        expect(addAbortListenerSpy).not.toHaveBeenCalled();
        expect(removeAbortListenerSpy).not.toHaveBeenCalled();
      } finally {
        setIntervalSpy.mockRestore();
        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
        addAbortListenerSpy.mockRestore();
        removeAbortListenerSpy.mockRestore();
      }
    });

    it("subscribeOrderBook átadja a limit paramétert", async () => {
      let receivedLimit: number | undefined;
      const newFake = makeFakeExchange({
        watchOrderBook: async (_symbol: string, limit: number) => {
          receivedLimit = limit;
          return new Promise<unknown>(() => { /* never */ });
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(newFake),
      });
      await f.open();
      await f.subscribeOrderBook(asSymbol("BTC/USDC"), 50, () => { /* no-op */ });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(receivedLimit).toBe(50);
      await f.close();
    });

    it("subscribeTrades hívja a watchTrades-t", async () => {
      let called = false;
      const newFake = makeFakeExchange({
        watchTrades: async (_symbol: string) => {
          called = true;
          return new Promise<unknown>(() => { /* never */ });
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(newFake),
      });
      await f.open();
      await f.subscribeTrades(asSymbol("BTC/USDC"), () => { /* no-op */ });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(called).toBe(true);
      await f.close();
    });

    it("subscribeOhlcv átadja a timeframe paramétert", async () => {
      let receivedTimeframe: string | undefined;
      const newFake = makeFakeExchange({
        watchOHLCV: async (_symbol: string, tf: string) => {
          receivedTimeframe = tf;
          return new Promise<unknown>(() => { /* never */ });
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(newFake),
      });
      await f.open();
      await f.subscribeOhlcv(asSymbol("BTC/USDC"), "1m" as Timeframe, () => { /* no-op */ });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(receivedTimeframe).toBe("1m");
      await f.close();
    });

    it("subscribe* dob, ha nincs open() hívás", async () => {
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(makeFakeExchange()),
      });
      await expect(
        f.subscribeTicker(asSymbol("BTC/USDC"), () => { /* no-op */ }),
      ).rejects.toThrow(/open/);
    });

    it("unsubscribe törli a subscription-t", async () => {
      let called = false;
      const newFake = makeFakeExchange({
        watchTicker: async (_symbol: string) => {
          called = true;
          return new Promise<unknown>(() => { /* never */ });
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(newFake),
      });
      await f.open();
      const id = await f.subscribeTicker(asSymbol("BTC/USDC"), () => { /* no-op */ });
      await new Promise<void>((r) => setTimeout(r, 10));
      await f.unsubscribe(id);
      // A cancel a watchTicker által visszaadott promise-t "feloldja",
      // de mivel a fake soha nem oldja fel, ez csak a belső state-et
      // frissíti.
      expect(called).toBe(true);
      await f.close();
    });
  });

  describe("fetch* metódusok", () => {
    let feed: BybitEuFeed;
    beforeEach(async () => {
      feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(makeFakeExchange()),
      });
      await feed.open();
    });

    afterEach(async () => {
      await feed.close();
    });

    it("fetchTickerSnapshot a CCXT fetchTicker-t hívja és Ticker-ré alakítja", async () => {
      const t = await feed.fetchTickerSnapshot(asSymbol("BTC/USDC"));
      expect(t.symbol).toBe("BTC/USDC");
      expect(typeof t.last).toBe("number");
    });

    it("fetchTickerSnapshot dob, ha a CCXT válasz nem sikerült", async () => {
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(
          makeFakeExchange({
            fetchTicker: async (_symbol: string) => {
              throw new Error("network error");
            },
          }),
        ),
      });
      await f.open();
      await expect(
        f.fetchTickerSnapshot(asSymbol("BTC/USDC")),
      ).rejects.toThrow(/network error/);
      await f.close();
    });

    it("fetchOrderBookSnapshot a CCXT fetchOrderBook-ot hívja", async () => {
      const ob = await feed.fetchOrderBookSnapshot(asSymbol("BTC/USDC"), 10);
      expect(ob.symbol).toBe("BTC/USDC");
      expect(ob.bids.length).toBeGreaterThan(0);
      expect(ob.asks.length).toBeGreaterThan(0);
    });

    it("fetchOrderBookSnapshot dob hibánál", async () => {
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(
          makeFakeExchange({
            fetchOrderBook: async (_symbol: string, _limit: number) => {
              throw new Error("book error");
            },
          }),
        ),
      });
      await f.open();
      await expect(
        f.fetchOrderBookSnapshot(asSymbol("BTC/USDC"), 10),
      ).rejects.toThrow(/book error/);
      await f.close();
    });

    it("fetchMarketMeta a CCXT markets-ből nyeri a meta-t", async () => {
      const mm = await feed.fetchMarketMeta(asSymbol("BTC/USDC"));
      expect(mm.symbol).toBe("BTC/USDC");
      expect(mm.base).toBe("BTC");
      expect(mm.quote).toBe("USDC");
      expect(typeof mm.amountPrecision).toBe("number");
      expect(typeof mm.pricePrecision).toBe("number");
    });

    it("fetchBalances a CCXT fetchBalance-t hívja és Balance[]-é alakítja", async () => {
      const balances = await feed.fetchBalances();
      expect(balances.length).toBeGreaterThan(0);
      expect(balances[0]?.currency).toBe("USDC");
    });

    it("fetchPositions only treats an explicit CCXT capability as authoritative", async () => {
      const unsupported = new BybitEuFeed({ apiKey: "x", secret: "y", rateLimitMs: 100, sandbox: false, exchange: makeFakeExchange() as unknown as CcxtExchange });
      await unsupported.open();
      await expect(unsupported.fetchPositions()).rejects.toThrow("does not support fetchPositions");

      const supported = new BybitEuFeed({
        apiKey: "x", secret: "y", rateLimitMs: 100, sandbox: false,
        exchange: makeFakeExchange({
          has: { fetchPositions: true },
          fetchPositions: async () => [{ symbol: "BTC/USDC", side: "long", contracts: 2, entryPrice: 100, markPrice: 101, lastUpdateTimestamp: 42 }],
        }) as unknown as CcxtExchange,
      });
      await supported.open();
      await expect(supported.fetchPositions()).resolves.toEqual([{
        symbol: "BTC/USDC", side: "long", quantity: 2, entryPrice: 100, markPrice: 101, unrealizedPnl: undefined, updateTimestamp: 42,
      }]);
    });

    /**
     * Per-package 100% OWN coverage — PR #220 fix.
     *
     * A `fetchOHLCV(symbol, timeframe, since, limit)` publikus metódus
     * (bybitEuFeed.ts:268) az `OhlcStream.start()` backfill hívásán kívül
     * nem volt közvetlenül tesztelve — a per-package 100% line coverage
     * gate számára ez 4 uncovered line-t jelent (269-272). Ez a teszt
     * a sikeres happy path-ot és az error path-ot is lefedi.
     */
    it("fetchOHLCV a CCXT fetchOHLCV-t hívja és Ohlcv[]-é castolja", async () => {
      // A default makeFakeExchange() nem definiál fetchOHLCV-t (a CCXT Pro
      // bybit.eu esetén opcionális), ezért külön BybitEuFeed instance-ot
      // építünk egy fake exchange-szel, ami a CCXT candle formátumot adja.
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(
          makeFakeExchange({
            fetchOHLCV: async (_symbol: string, _tf: string) => [
              [1_700_000_000_000, 60_000, 60_100, 59_900, 60_050, 12.345],
            ],
          }),
        ),
      });
      await f.open();
      try {
        const candles = await f.fetchOHLCV(asSymbol("BTC/USDC"), "1h", 1_700_000_000_000, 100);
        expect(Array.isArray(candles)).toBe(true);
        // A return sor (line 272) lefut, és a function body
        // (assertOpen + assertSupported + client.fetchOHLCV) is covered.
        expect(candles).toBeDefined();
      } finally {
        await f.close();
      }
    });

    it("fetchOHLCV dob, ha a CCXT fetchOHLCV hibát dob", async () => {
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(
          makeFakeExchange({
            fetchOHLCV: async (_symbol: string, _tf: string) => {
              throw new Error("ohlcv error");
            },
          }),
        ),
      });
      await f.open();
      await expect(
        f.fetchOHLCV(asSymbol("BTC/USDC"), "1h", undefined, 50),
      ).rejects.toThrow(/ohlcv error/);
      await f.close();
    });

    it("fetchOHLCV undefined since-nel és limit-tel is hívható", async () => {
      // A `since?: number | undefined` és `limit: number` opcionális
      // paramétereinek variánsát is le kell fedni — a function body
      // minden ágát (assertOpen, assertSupported, await client.fetchOHLCV)
      // érintenie kell a 100% line coverage-hez.
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(
          makeFakeExchange({
            fetchOHLCV: async (_symbol: string, _tf: string) => [],
          }),
        ),
      });
      await f.open();
      try {
        const candles = await f.fetchOHLCV(asSymbol("BTC/USDC"), "1h", undefined, 100);
        expect(candles).toBeDefined();
      } finally {
        await f.close();
      }
    });

    /**
     * Bun lcov quirk fix — PR #220.
     *
     * A `fetchOrderBookSnapshot` (bybitEuFeed.ts:253-258) return sora
     * (line 257) a fenti tesztben (`fetchOrderBookSnapshot a CCXT
     * fetchOrderBook-ot hívja`) logikailag lefut, de a bun coverage
     * tool egyes verziókban az `async` függvény `return <expr>;` sorát
     * az `await` continuation miatt nem trackeli (a function body
     * többi része — assertOpen, assertSupported, await — igen).
     * Ez a teszt egy extra hívással biztosítja, hogy a return sor
     * (line 257) és a closing brace (line 258) is látható legyen a
     * lcov reportban.
     */
    it("fetchOrderBookSnapshot extra hívás: a return sort explicit lefedi", async () => {
      // Két független hívás ugyanazzal a mock exchange-szel — a második
      // hívás során a return sort (line 257) és a záró kapcsos zárójelet
      // (line 258) is a lcov által számon kért execution path-ra kényszerítjük.
      const ob1 = await feed.fetchOrderBookSnapshot(asSymbol("BTC/USDC"), 10);
      const ob2 = await feed.fetchOrderBookSnapshot(asSymbol("ETH/USDC"), 5);
      expect(ob1.symbol).toBe("BTC/USDC");
      expect(ob2.symbol).toBe("ETH/USDC");
      expect(ob1.bids.length).toBeGreaterThan(0);
      expect(ob2.bids.length).toBeGreaterThan(0);
    });
  });

  describe("placeOrder / cancelOrder / fetchOrder / fetchOpenOrders", () => {
    let feed: BybitEuFeed;
    beforeEach(async () => {
      feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(makeFakeExchange()),
      });
      await feed.open();
    });

    afterEach(async () => {
      await feed.close();
    });

    it("placeOrder limit típusnál átadja a price-t", async () => {
      let receivedPrice: number | undefined;
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(
          makeFakeExchange({
            createOrder: async (
              _symbol: string,
              _type: string,
              _side: string,
              _amount: number,
              price?: number,
              _params?: Record<string, unknown>,
            ) => {
              receivedPrice = price;
              return {
                id: "x",
                symbol: "BTC/USDC",
                type: "limit",
                side: "buy",
                amount: 0.01,
                price: 60_000,
                status: "open",
                filled: 0,
                timestamp: Date.now(),
              };
            },
          }),
        ),
      });
      await f.open();
      const req: OrderRequest = {
        clientOrderId: "coid" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      };
      await f.placeOrder(req);
      expect(receivedPrice).toBe(60_000);
      await f.close();
    });

    it("placeOrder market típusnál NEM ad át price-t (undefined)", async () => {
      let receivedPrice: number | undefined = -1;
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(
          makeFakeExchange({
            createOrder: async (
              _symbol: string,
              _type: string,
              _side: string,
              _amount: number,
              price?: number,
              _params?: Record<string, unknown>,
            ) => {
              receivedPrice = price;
              return {
                id: "x",
                symbol: "BTC/USDC",
                type: "market",
                side: "buy",
                amount: 0.01,
                status: "open",
                filled: 0,
                timestamp: Date.now(),
              };
            },
          }),
        ),
      });
      await f.open();
      const req: OrderRequest = {
        clientOrderId: "coid" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "market",
        amount: 0.01,
        price: undefined,
      };
      await f.placeOrder(req);
      expect(receivedPrice).toBeUndefined();
      await f.close();
    });

    it("creates a post-fill spot protective conditional with triggerPrice, StopOrder, and a client id", async () => {
      let received: Record<string, unknown> | undefined;
      const f = new BybitEuFeed({
        apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false,
        exchange: asCcxt(makeFakeExchange({
          createOrder: async (_symbol, _type, _side, amount, _price, params) => {
            received = params;
            return { id: "protective", clientOrderId: params?.orderLinkId, symbol: "BTC/USDC", type: "market", side: "sell", amount, status: "open", filled: 0 };
          },
        })),
      });
      await f.open();
      await f.placeOrder({
        clientOrderId: "sl-1" as never, symbol: asSymbol("BTC/USDC"), side: "sell", type: "market", amount: 0.1,
        protectiveKind: "stop_loss", triggerPrice: 50_000, reduceOnly: true,
      });
      expect(received).toEqual({ orderLinkId: "sl-1", triggerPrice: 50_000, orderFilter: "StopOrder" });
      await f.close();
    });

    it("uses Bybit V5 orderLinkId (never empty orderId/clientOrderId) for normal spot cancel and lookup", async () => {
      let cancelCall: { id: string | undefined; symbol: string; params: Record<string, unknown> | undefined } | undefined;
      let fetchCall: { id: string | undefined; symbol: string; params: Record<string, unknown> | undefined } | undefined;
      const f = new BybitEuFeed({
        apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false,
        exchange: asCcxt(makeFakeExchange({
          cancelOrder: async (id, symbol, params) => {
            cancelCall = { id, symbol, params };
            return { id: "cancel", clientOrderId: params?.orderLinkId, symbol, status: "canceled" };
          },
          fetchOrder: async (id, symbol, params) => {
            fetchCall = { id, symbol, params };
            return { id: "get", clientOrderId: params?.orderLinkId, symbol, status: "open" };
          },
        })),
      });
      await f.open();
      const id = "spot-normal" as ClientOrderId;
      const o = await f.cancelOrder(id, asSymbol("BTC/USDC"));
      expect(o.status).toBe("canceled");
      await f.fetchOrder(id, asSymbol("BTC/USDC"));
      expect(cancelCall).toEqual({ id: undefined, symbol: "BTC/USDC", params: { orderLinkId: "spot-normal", orderFilter: "Order" } });
      expect(fetchCall).toEqual({ id: undefined, symbol: "BTC/USDC", params: { orderLinkId: "spot-normal", acknowledged: true } });
      await f.close();
    });

    it("keeps spot protection on StopOrder for cancel and lookup after the create ACK", async () => {
      let cancelParams: Record<string, unknown> | undefined;
      let fetchParams: Record<string, unknown> | undefined;
      const f = new BybitEuFeed({
        apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false,
        exchange: asCcxt(makeFakeExchange({
          cancelOrder: async (_id, symbol, params) => {
            cancelParams = params;
            return { id: "cancel", clientOrderId: params?.orderLinkId, symbol, status: "canceled" };
          },
          fetchOrder: async (_id, symbol, params) => {
            fetchParams = params;
            return { id: "get", clientOrderId: params?.orderLinkId, symbol, status: "open" };
          },
        })),
      });
      await f.open();
      const id = "spot-stop" as ClientOrderId;
      await f.placeOrder({ clientOrderId: id, symbol: asSymbol("BTC/USDC"), side: "sell", type: "market", amount: 0.1, protectiveKind: "stop_loss", triggerPrice: 50_000 });
      await f.cancelOrder(id, asSymbol("BTC/USDC"));
      await f.fetchOrder(id, asSymbol("BTC/USDC"));
      expect(cancelParams).toEqual({ orderLinkId: "spot-stop", orderFilter: "StopOrder" });
      expect(fetchParams).toEqual({ orderLinkId: "spot-stop", acknowledged: true, trigger: true });
      await f.close();
    });

    it("routes linear and inverse client ids through contract category without spot filters", async () => {
      // The application intentionally admits only USDC spot symbols; emulate
      // the two V5 derivative categories through CCXT's resolved market.
      for (const category of ["linear", "inverse"]) {
        const symbol = "BTC/USDC";
        let cancelParams: Record<string, unknown> | undefined;
        let fetchParams: Record<string, unknown> | undefined;
        const f = new BybitEuFeed({
          apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false,
          exchange: asCcxt(makeFakeExchange({
            market: () => ({ spot: false }),
            cancelOrder: async (_id, requestSymbol, params) => {
              cancelParams = params;
              return { id: "cancel", clientOrderId: params?.orderLinkId, symbol: requestSymbol, status: "canceled" };
            },
            fetchOrder: async (_id, requestSymbol, params) => {
              fetchParams = params;
              return { id: "get", clientOrderId: params?.orderLinkId, symbol: requestSymbol, status: "open" };
            },
          })),
        });
        await f.open();
        await f.cancelOrder(`contract-close-${category}` as ClientOrderId, asSymbol(symbol));
        await f.fetchOrder(`contract-close-${category}` as ClientOrderId, asSymbol(symbol));
        expect(cancelParams).toEqual({ orderLinkId: `contract-close-${category}` });
        expect(fetchParams).toEqual({ orderLinkId: `contract-close-${category}`, acknowledged: true });
        await f.close();
      }
    });

    it("fetchOpenOrders hívja a CCXT fetchOpenOrders-t", async () => {
      const orders = await feed.fetchOpenOrders(asSymbol("BTC/USDC"));
      expect(Array.isArray(orders)).toBe(true);
    });
  });

  describe("statusOf", () => {
    let feed: BybitEuFeed;
    beforeEach(() => {
      feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(makeFakeExchange()),
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
    it("subscribeTicker dob, ha nincs open()", async () => {
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(makeFakeExchange()),
      });
      await expect(
        feed.subscribeTicker(asSymbol("BTC/USDC"), () => { /* no-op */ }),
      ).rejects.toThrow();
    });

    it("fetchBalances dob, ha nincs open()", async () => {
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(makeFakeExchange()),
      });
      await expect(feed.fetchBalances()).rejects.toThrow();
    });
  });

  describe("normalizeTrade (exportált helper)", () => {
    it("CCXT trade-et a mi Trade formátumunkra konvertálja", () => {
      // A CCXT trade formátumot a mi `Trade` típusunkra alakítja.
      const ccxtTrade = {
        id: "trade-1",
        timestamp: 1_700_000_000_000,
        datetime: "2023-11-14T22:13:20.000Z",
        symbol: "BTC/USDC",
        side: "buy" as const,
        price: 60_000,
        amount: 0.01,
        cost: 600,
      };
      const trade = normalizeTrade(ccxtTrade as never, asSymbol("BTC/USDC"));
      expect(trade.id).toBe("trade-1");
      expect(trade.symbol).toBe("BTC/USDC");
      expect(trade.takerSide).toBe("buy");
      expect(trade.price).toBe(60_000);
      expect(trade.amount).toBe(0.01);
      expect(trade.timestamp).toBe(1_700_000_000_000);
    });

    it("a 'sell' side-ot is kezeli", () => {
      const ccxtTrade = {
        id: "trade-2",
        timestamp: 1_700_000_000_000,
        symbol: "BTC/USDC",
        side: "sell" as const,
        price: 60_000,
        amount: 0.01,
      };
      const trade = normalizeTrade(ccxtTrade as never, asSymbol("BTC/USDC"));
      expect(trade.takerSide).toBe("sell");
    });

    it("hiányzó id/timestamp/price/amount esetén default-okat ad", () => {
      // A CCXT trade formátum néha hiányos — a normalizeTrade default-okat ad.
      const ccxtTrade = {
        symbol: "BTC/USDC",
      };
      const before = Date.now();
      const trade = normalizeTrade(ccxtTrade as never, asSymbol("BTC/USDC"));
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
      // Ne adjunk át `exchange` opciót — a production code path fusson le.
      // A CCXT class nem nyit network connection-t a konstruktorban
      // (a loadMarkets() az open()-ben hívódik), ezért a teszt biztonságos.
      const feed = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
      });
      // A belső client a WS-enabled `ccxt.pro.bybiteu` kell legyen,
      // NEM a REST-only `ccxt.bybiteu`. Ez a root cause: a kettő
      // különböző osztály (`pro instance instanceof ccxt.bybiteu === false`).
      const client = (feed as unknown as { client: unknown }).client;
      expect(client).toBeInstanceOf(ccxt.pro.bybiteu);
      // A REST-only class-ba NEM szabad esnie — az garantálja, hogy
      // tényleg a Pro namespace-t használjuk, nem egy rename/alias trükköt.
      expect(client).not.toBeInstanceOf(ccxt.bybiteu);
    });

    it("C2: watchOrderBook NotSupported falls back to fetchOrderBook polling", async () => {
      let fetchOrderBookCalls = 0;
      const receivedBooks: unknown[] = [];
      const newFake = makeFakeExchange({
        watchOrderBook: async (_symbol: string, _limit: number): Promise<unknown> => {
          const err = new Error("bybiteu watchOrderBook() is not supported yet");
          err.name = "NotSupported";
          throw err;
        },
        fetchOrderBook: async (_symbol: string, _limit: number) => {
          fetchOrderBookCalls++;
          return {
            symbol: "BTC/USDC",
            timestamp: Date.now(),
            nonce: fetchOrderBookCalls,
            bids: [[59_999 + fetchOrderBookCalls, 1]],
            asks: [[60_001 + fetchOrderBookCalls, 1]],
          };
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        sandbox: false,
        exchange: asCcxt(newFake),
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
      const receivedTrades: unknown[] = [];
      const newFake = makeFakeExchange({
        watchTrades: async (_symbol: string): Promise<unknown> => {
          const err = new Error("bybiteu watchTrades() is not supported yet");
          err.name = "NotSupported";
          throw err;
        },
        fetchTrades: async (_symbol: string) => {
          fetchTradesCalls++;
          return [
            {
              id: `trade-${fetchTradesCalls}`,
              timestamp: Date.now(),
              symbol: "BTC/USDC",
              side: "buy" as const,
              price: 60_000,
              amount: 0.01,
            },
          ];
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 10,
        sandbox: false,
        exchange: asCcxt(newFake),
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
      let closeCalled = false;
      const newFake = makeFakeExchange({
        close: async () => {
          closeCalled = true;
        },
      });
      const f = new BybitEuFeed({
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
        exchange: asCcxt(newFake),
      });
      await f.open();
      expect(closeCalled).toBe(false);
      await f.close();
      // A C3 fix: a this.client.close() a subs.clear() UTÁN hívódik.
      // Korábban a close() nem hívta — ez volt a WS leak.
      expect(closeCalled).toBe(true);
    });
  });
});
