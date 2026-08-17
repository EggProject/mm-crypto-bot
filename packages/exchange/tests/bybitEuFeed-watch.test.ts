// packages/exchange/tests/bybitEuFeed-watch.test.ts
//
// FELADAT: a `BybitEuFeed` watch loop + fetch + open/close metódusainak
// unit tesztjei. A CCXT Pro WS integrációt egy mock client-tel helyettesítjük,
// hogy valódi hálózati hívás nélkül is 100% line + branch coverage-t érjünk el.
//
// A `bybitEuFeed.test.ts` a normalizálókat és a state hibákat fedi le.
// Ez a fájl kiegészíti azt a watch loop-okkal és a fetch metódusokkal.
//
// Megjegyzés: a watch loop-ok a CCXT Pro `watch*` metódusait hívják, amik Promise-t
// adnak vissza. A mock-unk Promise-t ad, de a hurok a `cancelled` flag-en
// keresztül kilép. A tesztek Promise-alapúak (a listener első hívásakor oldódnak
// fel), nem setTimeout-alapúak, hogy determinisztikusak legyenek.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Exchange as CcxtExchange } from "ccxt";

import { BybitEuFeed } from "../src/bybitEuFeed.js";
import { ExchangeFeedError } from "../src/feed.js";
import type { ClientOrderId, Symbol } from "../src/types.js";

const BTC_USDC: Symbol = "BTC/USDC" as Symbol;
const ETH_USDC: Symbol = "ETH/USDC" as Symbol;

type AnyMock = Record<string, (...args: unknown[]) => unknown>;

/**
 * Build a controllable mock CCXT exchange client. The watch methods return
 * Promises that resolve when the test calls `release(kind)`. This way the
 * test can synchronize: the runner awaits watch; the test releases when ready.
 */
function makeMockClient(): {
  client: CcxtExchange;
  release: (
    kind: "ticker" | "orderbook" | "trades" | "ohlcv" | "orders" | "executions",
    value: unknown,
  ) => Promise<void>;
  setMarkets: (markets: Record<string, unknown>) => void;
  calls: { kind: string; args: unknown[] }[];
} {
  const calls: { kind: string; args: unknown[] }[] = [];
  // For each watch kind, a deferred-resolver pair; first call awaits release.
  const deferreds: Record<string, { resolve: (v: unknown) => void; promise: Promise<unknown> }[]> = {
    ticker: [],
    orderbook: [],
    trades: [],
    ohlcv: [],
    orders: [],
    executions: [],
  };
  function makeDefer() {
    let resolveFn!: (v: unknown) => void;
    const promise = new Promise<unknown>((res) => {
      resolveFn = res;
    });
    return { resolve: resolveFn, promise };
  }
  let markets: Record<string, unknown> = {
    [BTC_USDC]: {
      base: "BTC",
      quote: "USDC",
      precision: { amount: 6, price: 2 },
      limits: { amount: { min: 0.0001 }, cost: { min: 1 } },
    },
  };
  const watchHelper = (kind: string) => () => {
    calls.push({ kind, args: [] });
    const d = makeDefer();
    deferreds[kind].push(d);
    return d.promise;
  };
  const client: AnyMock = {
    loadMarkets: async () => undefined,
    // `placeOrder` branches by CCXT market category to keep Bybit's spot
    // parameter grammar separate from contract reduce-only orders.
    market: (_symbol: string) => ({ spot: false }),
    setSandboxMode: (_v: unknown) => undefined,
    watchTicker: watchHelper("ticker"),
    watchOrderBook: watchHelper("orderbook"),
    watchTrades: watchHelper("trades"),
    watchOHLCV: watchHelper("ohlcv"),
    watchOrders: watchHelper("orders"),
    watchMyTrades: watchHelper("executions"),
    unWatchOrders: async () => {
      calls.push({ kind: "unWatchOrders", args: [] });
    },
    unWatchMyTrades: async () => {
      calls.push({ kind: "unWatchMyTrades", args: [] });
    },
    has: { unWatchOrders: true, unWatchMyTrades: true },
    fetchTicker: async (sym: string) => ({
      symbol: sym,
      timestamp: 12345,
      bid: 50000,
      ask: 50100,
      last: 50050,
      baseVolume: 10,
      quoteVolume: 500000,
    }),
    fetchOrderBook: async (sym: string, _limit: number) => ({
      symbol: sym,
      timestamp: 1,
      nonce: 2,
      bids: [[50000, 1]],
      asks: [[50100, 2]],
    }),
    fetchBalance: async () => ({
      BTC: { free: 0.5, used: 0, total: 0.5 },
      USDC: { free: 1000, used: 0, total: 1000 },
    }),
    createOrder: async (...args: unknown[]) => {
      calls.push({ kind: "createOrder", args });
      return {
        id: "order-1",
        clientOrderId: (args[0] as { clientOrderId?: string })?.clientOrderId ?? "c1",
        status: "open",
        side: args[2],
        type: args[1],
        amount: args[3],
        price: args[4],
        filled: 0,
        timestamp: 1234,
      };
    },
    cancelOrder: async (...args: unknown[]) => {
      calls.push({ kind: "cancelOrder", args });
      const params = args[2] as { orderLinkId?: string } | undefined;
      return {
        id: "x",
        clientOrderId: params?.orderLinkId,
        status: "canceled",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
      };
    },
    fetchOrder: async (...args: unknown[]) => {
      calls.push({ kind: "fetchOrder", args });
      const params = args[2] as { orderLinkId?: string } | undefined;
      return {
        id: "x",
        clientOrderId: params?.orderLinkId,
        status: "open",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
      };
    },
    fetchOpenOrders: async (sym: string) => [
      {
        id: "x",
        clientOrderId: "c1",
        status: "open",
        side: "buy",
        type: "limit",
        amount: 1,
        price: 100,
        filled: 0,
        timestamp: 1,
        symbol: sym,
      },
    ],
    // C3 fix: close() a this.client.close() hívásához a BybitEuFeed.close()-ban.
    // A CCXT Pro NEM zárja be magát — a feed-nek explicit hívnia kell.
    close: async () => undefined,
    get markets() {
      return markets;
    },
  };
  return {
    client: client as unknown as CcxtExchange,
    release: async (kind, value) => {
      const d = deferreds[kind].shift();
      if (d === undefined) {
        throw new Error(`No pending watch for kind=${kind}`);
      }
      d.resolve(value);
    },
    setMarkets: (m) => {
      markets = m;
    },
    calls,
  };
}

function withMockClient(feed: BybitEuFeed, mock: ReturnType<typeof makeMockClient>): void {
  // Bypass private field — typed as `any` for test only.
  (feed as unknown as { client: CcxtExchange }).client = mock.client;
}

function makeFeed(): BybitEuFeed {
  return new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false });
}

describe("BybitEuFeed — open/close + watch loops", () => {
  let mock: ReturnType<typeof makeMockClient>;
  let feed: BybitEuFeed;

  beforeEach(() => {
    mock = makeMockClient();
    feed = makeFeed();
    withMockClient(feed, mock);
  });

  describe("open()", () => {
    it("másodszori híváskor nem hívja újra a loadMarkets-et (early return)", async () => {
      const spy = vi.spyOn(mock.client as unknown as { loadMarkets: () => Promise<void> }, "loadMarkets");
      await feed.open();
      await feed.open();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("close()", () => {
    it("az aktív subscriptionöket cancelled-re állítja, majd törli a map-ből", async () => {
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      const subs = (
        feed as unknown as { subs: Map<number, { cancelled: boolean; abortController: AbortController }> }
      ).subs;
      const s1 = { cancelled: false, abortController: new AbortController() };
      const s2 = { cancelled: false, abortController: new AbortController() };
      subs.set(1, s1);
      subs.set(2, s2);
      await feed.close();
      expect(s1.cancelled).toBe(true);
      expect(s2.cancelled).toBe(true);
      expect(subs.size).toBe(0);
      expect((feed as unknown as { opened: boolean }).opened).toBe(false);
    });
  });

  describe("subscribeTicker + runTickerLoop", () => {
    it("feliratkozáskor a watchTicker hívódik és az event megérkezik", async () => {
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      const events: unknown[] = [];
      const id = await feed.subscribeTicker(BTC_USDC, (e) => events.push(e));
      // A runner elindult és várja az első watch-ot. Adjunk neki egy tick-et,
      // majd unsubscribe-elünk, hogy kilépjen.
      await mock.release("ticker", {
        symbol: "BTC/USDC",
        timestamp: 100,
        bid: 1,
        ask: 2,
        last: 1.5,
        baseVolume: 1,
        quoteVolume: 1,
      });
      // A release feloldja a watch promise-t. A loop feldolgozza, hívja a
      // listener-t, majd újra várja a watch-ot. A második watch hívás új
      // deferred, amit a teszt soha nem old fel — a loop blokkolva marad.
      // Az unsubscribe törli a sub-ot és cancelled-re állítja.
      await feed.unsubscribe(id);
      // A 2. watch deferred feloldása nélkül a runner örökre vár — oldjuk fel
      // egy noop-pal, hogy ne legyen lógó promise.
      await mock.release("ticker", null);
      expect(events.length).toBeGreaterThan(0);
      expect((events[0] as { kind: string }).kind).toBe("ticker");
    });
  });

  describe("subscribeOrderBook + runOrderBookLoop", () => {
    it("feliratkozáskor a watchOrderBook hívódik és az event megérkezik", async () => {
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      const events: unknown[] = [];
      const id = await feed.subscribeOrderBook(BTC_USDC, 10, (e) => events.push(e));
      await mock.release("orderbook", {
        symbol: "BTC/USDC",
        timestamp: 1,
        nonce: 1,
        bids: [],
        asks: [],
      });
      await feed.unsubscribe(id);
      await mock.release("orderbook", null);
      expect(events.length).toBeGreaterThan(0);
      expect((events[0] as { kind: string }).kind).toBe("orderbook");
    });
  });

  describe("subscribeTrades + runTradesLoop", () => {
    it("a trades tömb minden elemét eventként küldi", async () => {
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      const events: unknown[] = [];
      const id = await feed.subscribeTrades(BTC_USDC, (e) => events.push(e));
      await mock.release("trades", [
        { id: "t1", timestamp: 1, price: 100, amount: 1, side: "buy" },
        { id: "t2", timestamp: 2, price: 101, amount: 2, side: "sell" },
      ]);
      await feed.unsubscribe(id);
      await mock.release("trades", null);
      expect(events.length).toBe(2);
      expect((events[0] as { kind: string }).kind).toBe("trade");
      expect((events[1] as { kind: string }).kind).toBe("trade");
    });
  });

  describe("subscribeOhlcv + runOhlcvLoop", () => {
    it("az OHLCV candle-öket eventként küldi", async () => {
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      const events: unknown[] = [];
      const id = await feed.subscribeOhlcv(BTC_USDC, "1m", (e) => events.push(e));
      await mock.release("ohlcv", [
        [1, 100, 101, 99, 100, 10],
        [60_001, 100, 102, 99, 101, 11],
      ]);
      await feed.unsubscribe(id);
      await mock.release("ohlcv", null);
      expect(events.length).toBeGreaterThan(0);
      expect((events[0] as { kind: string; payload: { candle: unknown[] } }).kind).toBe("ohlcv");
      expect((events[0] as { kind: string; payload: { candle: unknown[] } }).payload.candle).toEqual([
        1, 100, 101, 99, 100, 10,
      ]);
    });
  });

  describe("private order/execution loops", () => {
    it("normalizes authenticated updates and explicitly unwatches both streams", async () => {
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      const events: unknown[] = [];
      const orderId = await feed.subscribeOrderUpdates((event) => events.push(event));
      const executionId = await feed.subscribeExecutions((event) => events.push(event));
      await mock.release("orders", [
        {
          id: "venue-1",
          clientOrderId: "client-1",
          symbol: "BTC/USDC",
          side: "buy",
          type: "market",
          amount: 2,
          filled: 1,
          average: 100,
          status: "open",
          timestamp: 1,
        },
      ]);
      await mock.release("executions", [
        {
          id: "exec-1",
          order: "venue-1",
          symbol: "BTC/USDC",
          side: "buy",
          amount: 1,
          price: 100,
          timestamp: 2,
          fee: { cost: 0.1, currency: "USDC" },
          info: { orderLinkId: "client-1" },
        },
      ]);
      await feed.unsubscribe(orderId);
      await feed.unsubscribe(executionId);
      await mock.release("orders", []);
      await mock.release("executions", []);
      expect(events.map((event) => (event as { kind: string }).kind)).toEqual(["order", "execution"]);
      expect(mock.calls.filter((call) => call.kind === "unWatchOrders")).toHaveLength(1);
      expect(mock.calls.filter((call) => call.kind === "unWatchMyTrades")).toHaveLength(1);
    });
  });

  describe("run*Loop error handling", () => {
    it("ha a watch hiba után még nem cancelled, a runner ExchangeFeedError-t dob (caller felelőssége)", async () => {
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      (mock.client as AnyMock).watchTicker = async () => {
        throw new Error("ws-fail");
      };
      const events: unknown[] = [];
      const id = await feed.subscribeTicker(BTC_USDC, (e) => events.push(e));
      // A runner azonnal elindul, a watch throwol, a catch ág `if (!cancelled)`
      // true, tehát újradobja az ExchangeFeedError-t.
      const subs = (feed as unknown as { subs: Map<number, { runner: Promise<unknown> }> }).subs;
      const sub = subs.get(id);
      if (sub) {
        await expect(sub.runner).rejects.toThrow(ExchangeFeedError);
      }
      // A sub.cancelled flag-et true-ra állítjuk, hogy a futó lánc
      // (ha a CCXT belső reconnect logikája újra hívná) ne fusson tovább.
      const subRec = (feed as unknown as { subs: Map<number, { cancelled: boolean }> }).subs.get(id);
      if (subRec) subRec.cancelled = true;
      expect(events.length).toBe(0);
    });
  });

  describe("unsubscribe()", () => {
    it("nem létező id esetén csendben visszatér (no throw)", async () => {
      await expect(feed.unsubscribe(999 as never)).resolves.toBeUndefined();
    });

    it("létező id esetén törli a sub-ot és cancelled-re állítja", async () => {
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      const subs = (
        feed as unknown as { subs: Map<number, { cancelled: boolean; abortController: AbortController }> }
      ).subs;
      subs.set(1, { cancelled: false, abortController: new AbortController() });
      await feed.unsubscribe(1 as never);
      expect(subs.has(1)).toBe(false);
    });
  });
});

describe("BybitEuFeed — fetch* methods", () => {
  let mock: ReturnType<typeof makeMockClient>;
  let feed: BybitEuFeed;

  beforeEach(() => {
    mock = makeMockClient();
    feed = makeFeed();
    withMockClient(feed, mock);
    Object.defineProperty(feed, "opened", { value: true, writable: true });
  });

  describe("fetchTickerSnapshot", () => {
    it("a CCXT fetchTicker-t hívja és normalizálja", async () => {
      const t = await feed.fetchTickerSnapshot(BTC_USDC);
      expect(t.symbol).toBe(BTC_USDC);
      expect(t.bid).toBe(50000);
    });
  });

  describe("fetchOrderBookSnapshot", () => {
    it("a CCXT fetchOrderBook-ot hívja a megadott limit-tel", async () => {
      const ob = await feed.fetchOrderBookSnapshot(BTC_USDC, 5);
      expect(ob.symbol).toBe(BTC_USDC);
      expect(ob.bids).toHaveLength(1);
    });
  });

  describe("fetchMarketMeta", () => {
    it("a CCXT markets dict-ből veszi a meta-t", async () => {
      const m = await feed.fetchMarketMeta(BTC_USDC);
      expect(m.symbol).toBe(BTC_USDC);
      expect(m.base).toBe("BTC");
      expect(m.quote).toBe("USDC");
    });

    it("ExchangeFeedError-t dob, ha a market nem található", async () => {
      mock.setMarkets({});
      await expect(feed.fetchMarketMeta("UNKNOWN/USDC" as Symbol)).rejects.toThrow(ExchangeFeedError);
    });
  });

  describe("fetchBalances", () => {
    it("a CCXT fetchBalance-t hívja és normalizálja", async () => {
      const bals = await feed.fetchBalances();
      expect(bals.length).toBeGreaterThan(0);
      expect(bals.map((b) => b.currency)).toContain("BTC");
    });
  });

  describe("placeOrder", () => {
    it("a CCXT createOrder-t hívja a request mezőkkel", async () => {
      const o = await feed.placeOrder({
        clientOrderId: "cid" as ClientOrderId,
        symbol: BTC_USDC,
        side: "buy",
        type: "market",
        amount: 0.5,
      });
      expect(o.symbol).toBe(BTC_USDC);
      expect(mock.calls.some((c) => c.kind === "createOrder")).toBe(true);
    });

    it("does not attach TP/SL blindly to a market entry", async () => {
      await feed.placeOrder({
        clientOrderId: "cid" as ClientOrderId,
        symbol: BTC_USDC,
        side: "buy",
        type: "market",
        amount: 0.5,
        takeProfitPrice: 110,
        stopLossPrice: 90,
      });
      const call = mock.calls.find((c) => c.kind === "createOrder");
      expect(call).toBeDefined();
      const params = (call!.args[5] ?? {}) as Record<string, unknown>;
      // Bybit V5 accepts spot attached TP/SL only on limit entries and
      // reduceOnly cannot be mixed with TP/SL.  The execution lifecycle
      // must create protected exits after the entry has a confirmed fill.
      expect(params["takeProfitPrice"]).toBeUndefined();
      expect(params["stopLossPrice"]).toBeUndefined();
    });

    it("forwards a reduce-only safety close without TP/SL fields", async () => {
      await feed.placeOrder({
        clientOrderId: "close" as ClientOrderId,
        symbol: BTC_USDC,
        side: "sell",
        type: "market",
        amount: 0.5,
        reduceOnly: true,
      });
      const call = mock.calls.find((item) => item.kind === "createOrder");
      const params = (call!.args[5] ?? {}) as Record<string, unknown>;
      expect(params["reduceOnly"]).toBe(true);
      expect(params["takeProfitPrice"]).toBeUndefined();
      expect(params["stopLossPrice"]).toBeUndefined();
    });
  });

  describe("cancelOrder", () => {
    it("explicit V5 orderLinkId-val hívja a cancelOrder-t, üres orderId nélkül", async () => {
      const o = await feed.cancelOrder("cid" as ClientOrderId, BTC_USDC);
      expect(o.status).toBe("canceled");
      expect(mock.calls.find((call) => call.kind === "cancelOrder")?.args).toEqual([
        undefined,
        BTC_USDC,
        { orderLinkId: "cid" },
      ]);
    });
  });

  describe("fetchOrder", () => {
    it("explicit V5 orderLinkId-val és acknowledged-del hívja a fetchOrder-t", async () => {
      const o = await feed.fetchOrder("cid" as ClientOrderId, BTC_USDC);
      expect(o.status).toBe("open");
      expect(mock.calls.find((call) => call.kind === "fetchOrder")?.args).toEqual([
        undefined,
        BTC_USDC,
        { orderLinkId: "cid", acknowledged: true },
      ]);
    });
  });

  describe("fetchOpenOrders", () => {
    it("a CCXT fetchOpenOrders-t hívja és normalizálja a listát", async () => {
      const os = await feed.fetchOpenOrders(BTC_USDC);
      expect(os.length).toBe(1);
      expect(os[0]?.symbol).toBe(BTC_USDC);
    });
  });

  describe("assertOpen / assertSupported path coverage", () => {
    it("ETH_USDC-t is elfogadja (második támogatott symbol)", async () => {
      // A belső symbol-check lefut, de a fetchTicker a mock-on átmegy.
      const t = await feed.fetchTickerSnapshot(ETH_USDC);
      expect(t.symbol).toBe(ETH_USDC);
    });
  });
});
