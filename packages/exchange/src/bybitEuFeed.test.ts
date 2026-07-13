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
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { asSymbol, type Timeframe } from "./symbols.js";
import type { ClientOrderId, OrderRequest } from "./types.js";
import type { Exchange as CcxtExchange } from "ccxt";

import { BybitEuFeed, normalizeTrade } from "./bybitEuFeed.js";

// ---------------------------------------------------------------------------
// Fake CCXT exchange — implements only the methods BybitEuFeed uses
// ---------------------------------------------------------------------------

interface FakeExchange {
  id: string;
  markets: Record<string, unknown>;
  loadMarkets: () => Promise<unknown[]>;
  setSandboxMode: (v: boolean) => void;
  watchTicker: (symbol: string) => Promise<unknown>;
  watchOrderBook: (symbol: string, limit: number) => Promise<unknown>;
  watchTrades: (symbol: string) => Promise<unknown>;
  watchOHLCV: (symbol: string, timeframe: string) => Promise<unknown>;
  fetchTicker: (symbol: string) => Promise<unknown>;
  fetchOrderBook: (symbol: string, limit: number) => Promise<unknown>;
  fetchBalance: () => Promise<unknown>;
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
  fetchOrderWithClientOrderId: (
    clientOrderId: string,
    symbol: string,
  ) => Promise<unknown>;
  fetchOpenOrders: (symbol: string) => Promise<unknown[]>;
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
    fetchBalance: async () => ({
      USDC: { free: 10_000, total: 10_000, used: 0 },
      info: {},
    }),
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
    fetchOrderWithClientOrderId: async (
      clientOrderId: string,
      _symbol: string,
    ) => ({
      id: "mock",
      clientOrderId,
      symbol: "BTC/USDC",
      status: "open",
    }),
    fetchOpenOrders: async (_symbol: string) => [],
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

    it("cancelOrder hívja a CCXT cancelOrder-t", async () => {
      const o = await feed.cancelOrder("coid" as ClientOrderId, asSymbol("BTC/USDC"));
      expect(o.status).toBe("canceled");
    });

    it("fetchOrder hívja a CCXT fetchOrder-t", async () => {
      const o = await feed.fetchOrder("coid" as ClientOrderId, asSymbol("BTC/USDC"));
      expect(o.clientOrderId).toBe("coid");
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
});
