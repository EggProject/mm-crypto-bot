/**
 * packages/exchange/src/__testing__/mockFeed.test.ts
 *
 * 100% coverage test for `__testing__/mockFeed.ts` — the `MockExchangeFeed`
 * class (the in-memory test double for `ExchangeFeed`) and the
 * 3 helper functions: `defaultTicker`, `defaultOrderBook`,
 * `defaultMarketMeta`.
 *
 * Phase 35b gap closer — no exchange-package test was covering the
 * mock feed's lifecycle, push event routing, placeOrder limit-price
 * branch, setBalance create-vs-update branch, and the default-* helpers.
 *
 * Phase 66: this test file was moved from `packages/exchange/src/mockFeed.test.ts`
 * to the `__testing__/` subdirectory to signal that the mock feed is
 * TEST-ONLY (per user mandate "csak a test hasznalhatja a mock feed -et!").
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  MockExchangeFeed,
  defaultMarketMeta,
  defaultOrderBook,
  defaultTicker,
} from "./mockFeed.js";
import { type Symbol, type Timeframe } from "../types.js";
import { asSymbol } from "../symbols.js";

describe("mockFeed", () => {
  let feed: MockExchangeFeed;

  beforeEach(() => {
    feed = new MockExchangeFeed();
  });

  afterEach(async () => {
    // A feed-eket zárjuk le, hogy ne legyenek nyitott state-ek a tesztek között.
    if (feed !== undefined) {
      try {
        await feed.close();
      } catch {
        // lehet, hogy nincs is megnyitva
      }
    }
  });

  describe("konstruktor + alapállapot", () => {
    it("alapértelmezetten exchangeId='mock'", () => {
      const f = new MockExchangeFeed();
      expect(f.exchangeId).toBe("mock");
    });

    it("egyedi exchangeId megadható", () => {
      const f = new MockExchangeFeed({ exchangeId: "custom-mock" });
      expect(f.exchangeId).toBe("custom-mock");
    });

    it("alapértelmezetten 10 000 USDC egyenleg", async () => {
      const f = new MockExchangeFeed();
      await f.open();
      const balances = await f.fetchBalances();
      expect(balances.length).toBe(1);
      expect(balances[0]?.currency).toBe("USDC");
      expect(balances[0]?.total).toBe(10_000);
      expect(balances[0]?.free).toBe(10_000);
    });

    it("explicit balances opcióval felülírja az alapértelmezettet", async () => {
      const f = new MockExchangeFeed({
        balances: [
          { currency: "USDC", free: 5_000, total: 5_000 },
          { currency: "BTC", free: 0.5, total: 0.5 },
        ],
      });
      await f.open();
      const balances = await f.fetchBalances();
      expect(balances.length).toBe(2);
    });

    it("explicit tickerSnapshot opcióval feltölti a snapshot-ot", async () => {
      const tickerMap = new Map<Symbol, ReturnType<typeof defaultTicker>>();
      const sym = asSymbol("BTC/USDC");
      const t = { ...defaultTicker(sym), last: 99_999 };
      tickerMap.set(sym, t);
      const f = new MockExchangeFeed({ tickerSnapshot: tickerMap });
      await f.open();
      const fetched = await f.fetchTickerSnapshot(sym);
      expect(fetched.last).toBe(99_999);
    });

    it("explicit orderBookSnapshot opcióval feltölti a snapshot-ot", async () => {
      const obMap = new Map<Symbol, ReturnType<typeof defaultOrderBook>>();
      const sym = asSymbol("BTC/USDC");
      const ob = { ...defaultOrderBook(sym), nonce: 42 };
      obMap.set(sym, ob);
      const f = new MockExchangeFeed({ orderBookSnapshot: obMap });
      await f.open();
      const fetched = await f.fetchOrderBookSnapshot(sym, 10);
      expect(fetched.nonce).toBe(42);
    });

    it("explicit marketMeta opcióval feltölti a meta-t", async () => {
      const mmMap = new Map<Symbol, ReturnType<typeof defaultMarketMeta>>();
      const sym = asSymbol("BTC/USDC");
      const mm = { ...defaultMarketMeta(sym), amountPrecision: 8 };
      mmMap.set(sym, mm);
      const f = new MockExchangeFeed({ marketMeta: mmMap });
      await f.open();
      const fetched = await f.fetchMarketMeta(sym);
      expect(fetched.amountPrecision).toBe(8);
    });
  });

  describe("open/close + assertOpen", () => {
    it("open() után opened=true", async () => {
      await feed.open();
      // Sikeres fetch hívás bizonyítja, hogy opened=true.
      const balances = await feed.fetchBalances();
      expect(balances.length).toBe(1);
    });

    it("close() törli a subscription-öket és opened=false", async () => {
      await feed.open();
      await feed.subscribeTicker(asSymbol("BTC/USDC"), () => { /* no-op */ });
      expect(feed.subscriptionCount()).toBe(1);
      await feed.close();
      expect(feed.subscriptionCount()).toBe(0);
    });

    it("open() hívása nélkül a metódusok dob", async () => {
      // Nincs open() hívás.
      await expect(feed.fetchBalances()).rejects.toThrow(/MockFeed.*open/);
      await expect(feed.fetchTickerSnapshot(asSymbol("BTC/USDC"))).rejects.toThrow(
        /MockFeed.*open/,
      );
    });
  });

  describe("subscribe* metódusok", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("subscribeTicker visszaad egy subscription id-t", async () => {
      const id = await feed.subscribeTicker(asSymbol("BTC/USDC"), () => { /* no-op */ });
      expect(typeof id).toBe("number");
      expect(feed.subscriptionCount()).toBe(1);
    });

    it("subscribeOrderBook figyelmen kívül hagyja a limit paramétert", async () => {
      const id = await feed.subscribeOrderBook(asSymbol("BTC/USDC"), 50, () => { /* no-op */ });
      expect(typeof id).toBe("number");
    });

    it("subscribeTrades visszaad egy id-t", async () => {
      const id = await feed.subscribeTrades(asSymbol("ETH/USDC"), () => { /* no-op */ });
      expect(typeof id).toBe("number");
    });

    it("subscribeOhlcv timeframe paramétert is eltárolja", async () => {
      const id = await feed.subscribeOhlcv(
        asSymbol("BTC/USDC"),
        "1m" as Timeframe,
        () => { /* no-op */ },
      );
      expect(typeof id).toBe("number");
    });

    it("unsubscribe törli a subscription-t", async () => {
      const id = await feed.subscribeTicker(asSymbol("BTC/USDC"), () => { /* no-op */ });
      await feed.unsubscribe(id);
      expect(feed.subscriptionCount()).toBe(0);
    });

    it("a subscription id-k egyediek (monoton növekvő)", async () => {
      const id1 = await feed.subscribeTicker(asSymbol("BTC/USDC"), () => { /* no-op */ });
      const id2 = await feed.subscribeTicker(asSymbol("ETH/USDC"), () => { /* no-op */ });
      expect(id2).toBeGreaterThan(id1);
    });
  });

  describe("pushEvent routing", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("a pushEvent meghívja a megfelelő symbol ticker listenert", async () => {
      let called = 0;
      await feed.subscribeTicker(asSymbol("BTC/USDC"), () => {
        called++;
      });
      feed.pushEvent({
        kind: "ticker",
        payload: {
          symbol: asSymbol("BTC/USDC") as unknown as never,
          timestamp: Date.now(),
          bid: 100,
          ask: 101,
          last: 100.5,
          baseVolume: 0,
          quoteVolume: 0,
        } as never,
      });
      expect(called).toBe(1);
    });

    it("a pushEvent NEM hívja meg a nem megfelelő symbol listenert", async () => {
      let called = 0;
      await feed.subscribeTicker(asSymbol("ETH/USDC"), () => {
        called++;
      });
      feed.pushEvent({
        kind: "ticker",
        payload: {
          symbol: asSymbol("BTC/USDC") as unknown as never,
          timestamp: Date.now(),
          bid: 100,
          ask: 101,
          last: 100.5,
          baseVolume: 0,
          quoteVolume: 0,
        } as never,
      });
      expect(called).toBe(0);
    });

    it("a pushEvent NEM hívja meg a nem megfelelő kind listenert", async () => {
      let tickerCalled = 0;
      let orderbookCalled = 0;
      await feed.subscribeTicker(asSymbol("BTC/USDC"), () => {
        tickerCalled++;
      });
      await feed.subscribeOrderBook(asSymbol("BTC/USDC"), 10, () => {
        orderbookCalled++;
      });
      feed.pushEvent({
        kind: "ticker",
        payload: {
          symbol: asSymbol("BTC/USDC") as unknown as never,
          timestamp: Date.now(),
          bid: 100,
          ask: 101,
          last: 100.5,
          baseVolume: 0,
          quoteVolume: 0,
        } as never,
      });
      expect(tickerCalled).toBe(1);
      expect(orderbookCalled).toBe(0);
    });

    it("az OHLCV pushEvent a timeframe egyezésnél hív", async () => {
      let called1m = 0;
      let called5m = 0;
      await feed.subscribeOhlcv(asSymbol("BTC/USDC"), "1m" as Timeframe, () => {
        called1m++;
      });
      await feed.subscribeOhlcv(asSymbol("BTC/USDC"), "5m" as Timeframe, () => {
        called5m++;
      });
      feed.pushEvent({
        kind: "ohlcv",
        payload: {
          symbol: asSymbol("BTC/USDC") as unknown as never,
          timeframe: "1m" as Timeframe,
          timestamp: Date.now(),
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 0,
        } as never,
      });
      expect(called1m).toBe(1);
      expect(called5m).toBe(0);
    });
  });

  describe("fetch metódusok", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("fetchTickerSnapshot default tickert ad, ha nincs explicit snapshot", async () => {
      const t = await feed.fetchTickerSnapshot(asSymbol("BTC/USDC"));
      expect(t.symbol).toBe("BTC/USDC");
      expect(t.last).toBe(60_000);
    });

    it("fetchTickerSnapshot az explicit setTicker értéket adja", async () => {
      const sym = asSymbol("BTC/USDC");
      feed.setTicker(sym, {
        symbol: sym,
        timestamp: 0,
        bid: 1,
        ask: 2,
        last: 1.5,
        baseVolume: 0,
        quoteVolume: 0,
      });
      const t = await feed.fetchTickerSnapshot(sym);
      expect(t.last).toBe(1.5);
    });

    it("fetchOrderBookSnapshot default orderbook-ot ad, ha nincs explicit", async () => {
      const ob = await feed.fetchOrderBookSnapshot(asSymbol("BTC/USDC"), 10);
      expect(ob.symbol).toBe("BTC/USDC");
      expect(ob.bids.length).toBe(1);
      expect(ob.asks.length).toBe(1);
    });

    it("fetchMarketMeta default meta-t ad, ha nincs explicit", async () => {
      const mm = await feed.fetchMarketMeta(asSymbol("BTC/USDC"));
      expect(mm.symbol).toBe("BTC/USDC");
      expect(mm.base).toBe("BTC");
      expect(mm.quote).toBe("USDC");
    });

    it("fetchBalances a másolt tömböt adja vissza (nem az eredeti referenciát)", async () => {
      const balances1 = await feed.fetchBalances();
      const balances2 = await feed.fetchBalances();
      expect(balances1).not.toBe(balances2);
      expect(balances1).toEqual(balances2);
    });
  });

  describe("placeOrder + cancelOrder + fetchOrder + fetchOpenOrders", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("placeOrder limit price nélkül dob", async () => {
      await expect(
        feed.placeOrder({
          clientOrderId: "test-1" as never,
          symbol: asSymbol("BTC/USDC"),
          side: "buy",
          type: "limit",
          amount: 0.01,
          price: undefined,
        }),
      ).rejects.toThrow(/limit.*price/);
    });

    it("placeOrder market típusnál NEM dob, ha nincs price", async () => {
      const order = await feed.placeOrder({
        clientOrderId: "test-1" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "market",
        amount: 0.01,
        price: undefined,
      });
      expect(order.status).toBe("open");
      expect(order.type).toBe("market");
    });

    it("placeOrder limit price-szal sikeres, open státusszal", async () => {
      const order = await feed.placeOrder({
        clientOrderId: "test-1" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      expect(order.status).toBe("open");
      expect(order.price).toBe(60_000);
      expect(feed.getOrder("test-1" as never)).toBeDefined();
    });

    it("cancelOrder ismeretlen order-re dob", async () => {
      await expect(
        feed.cancelOrder("unknown" as never, asSymbol("BTC/USDC")),
      ).rejects.toThrow(/ismeretlen order/);
    });

    it("cancelOrder létező order-t canceled-re állít", async () => {
      await feed.placeOrder({
        clientOrderId: "test-1" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      const canceled = await feed.cancelOrder("test-1" as never, asSymbol("BTC/USDC"));
      expect(canceled.status).toBe("canceled");
    });

    it("fetchOrder ismeretlen order-re dob", async () => {
      await expect(
        feed.fetchOrder("unknown" as never, asSymbol("BTC/USDC")),
      ).rejects.toThrow(/ismeretlen order/);
    });

    it("fetchOrder létező order-t ad vissza", async () => {
      await feed.placeOrder({
        clientOrderId: "test-1" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      const order = await feed.fetchOrder("test-1" as never, asSymbol("BTC/USDC"));
      expect(order.clientOrderId).toBe("test-1");
    });

    it("fetchOpenOrders csak az 'open' státuszú order-eket adja", async () => {
      await feed.placeOrder({
        clientOrderId: "test-1" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      await feed.placeOrder({
        clientOrderId: "test-2" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_001,
      });
      await feed.cancelOrder("test-1" as never, asSymbol("BTC/USDC"));
      const open = await feed.fetchOpenOrders(asSymbol("BTC/USDC"));
      expect(open.length).toBe(1);
      expect(open[0]?.clientOrderId).toBe("test-2");
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
      feed.setBalance("USDC", 5_000, 5_000);
      const balances = await feed.fetchBalances();
      const usdc = balances.find((b) => b.currency === "USDC");
      expect(usdc?.total).toBe(5_000);
    });
  });

  describe("setOrderStatus", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("ismeretlen order-re nem csinál semmit (no-op)", () => {
      // Nem dob, csak no-op.
      feed.setOrderStatus("unknown" as never, { status: "closed" });
      // Nincs assert — csak hogy ne dobjon.
    });

    it("létező order-t patch-eli", async () => {
      await feed.placeOrder({
        clientOrderId: "test-1" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      feed.setOrderStatus("test-1" as never, { status: "closed", filled: 0.01 });
      const order = feed.getOrder("test-1" as never);
      expect(order?.status).toBe("closed");
      expect(order?.filled).toBe(0.01);
    });
  });

  describe("getOrder", () => {
    beforeEach(async () => {
      await feed.open();
    });

    it("undefined-ot ad ismeretlen order-re", () => {
      expect(feed.getOrder("unknown" as never)).toBeUndefined();
    });

    it("a order-t adja vissza, ha létezik", async () => {
      await feed.placeOrder({
        clientOrderId: "test-1" as never,
        symbol: asSymbol("BTC/USDC"),
        side: "buy",
        type: "limit",
        amount: 0.01,
        price: 60_000,
      });
      const order = feed.getOrder("test-1" as never);
      expect(order?.clientOrderId).toBe("test-1");
    });
  });
});

describe("defaultTicker", () => {
  it("BTC/USDC @ 60_000", () => {
    const t = defaultTicker(asSymbol("BTC/USDC"));
    expect(t.last).toBe(60_000);
    expect(t.bid).toBe(59_999);
    expect(t.ask).toBe(60_001);
  });

  it("ETH/USDC @ 3_000", () => {
    const t = defaultTicker(asSymbol("ETH/USDC"));
    expect(t.last).toBe(3_000);
  });

  it("SOL/USDC @ 150", () => {
    const t = defaultTicker(asSymbol("SOL/USDC"));
    expect(t.last).toBe(150);
  });

  it("ismeretlen symbol @ 100 (default)", () => {
    const t = defaultTicker(asSymbol("UNKNOWN/USDC"));
    expect(t.last).toBe(100);
  });
});

describe("defaultOrderBook", () => {
  it("1 szintű book-ot ad (1 bid + 1 ask)", () => {
    const ob = defaultOrderBook(asSymbol("BTC/USDC"));
    expect(ob.bids.length).toBe(1);
    expect(ob.asks.length).toBe(1);
  });

  it("a bid/ask árai a default ticker bid/ask-ját tükrözik", () => {
    const ob = defaultOrderBook(asSymbol("BTC/USDC"));
    expect(ob.bids[0]?.price).toBe(59_999);
    expect(ob.asks[0]?.price).toBe(60_001);
  });
});

describe("defaultMarketMeta", () => {
  it("BTC/USDC meta: base=BTC, quote=USDC", () => {
    const mm = defaultMarketMeta(asSymbol("BTC/USDC"));
    expect(mm.base).toBe("BTC");
    expect(mm.quote).toBe("USDC");
  });

  it("ETH/USDC meta: base=ETH", () => {
    const mm = defaultMarketMeta(asSymbol("ETH/USDC"));
    expect(mm.base).toBe("ETH");
  });

  it("SOL/USDC meta: base=SOL", () => {
    const mm = defaultMarketMeta(asSymbol("SOL/USDC"));
    expect(mm.base).toBe("SOL");
  });

  it("defensive: symbol '/' nélkül — base=UNKNOWN, quote=USDC", () => {
    const mm = defaultMarketMeta(asSymbol("BTCUSDC"));
    expect(mm.base).toBe("UNKNOWN");
    expect(mm.quote).toBe("USDC");
  });
});
