// packages/exchange/tests/mockFeed.test.ts — a `mockFeed.ts` tesztjei
import { describe, it, expect, beforeEach } from "vitest";

import { MockExchangeFeed, defaultTicker, defaultOrderBook, defaultMarketMeta } from "../src/mockFeed.js";
import type { ClientOrderId, FeedEvent, Symbol, Timeframe, Ticker, OrderBook, MarketMeta, OrderRequest } from "../src/types.js";

const BTC_USDC: Symbol = "BTC/USDC" as Symbol;
const ETH_USDC: Symbol = "ETH/USDC" as Symbol;
const SOL_USDC: Symbol = "SOL/USDC" as Symbol;

describe("MockExchangeFeed", () => {
  let feed: MockExchangeFeed;

  beforeEach(() => {
    feed = new MockExchangeFeed();
  });

  describe("open / close", () => {
    it("az open() megnyitja a feed-et", async () => {
      await feed.open();
      // Nyitott állapotban a fetchBalances nem dob
      const balances = await feed.fetchBalances();
      expect(balances).toEqual([{ currency: "USDC", free: 10_000, total: 10_000 }]);
    });

    it("a close() lezárja a feed-et", async () => {
      await feed.open();
      await feed.close();
      // A close() után a fetchBalances hibát dob
      await expect(feed.fetchBalances()).rejects.toThrow("nincs megnyitva");
    });
  });

  describe("exchangeId", () => {
    it("alapértelmezetten 'mock'", () => {
      expect(feed.exchangeId).toBe("mock");
    });

    it("opcióval egyedi értéket kaphat", () => {
      const custom = new MockExchangeFeed({ exchangeId: "test-mock" });
      expect(custom.exchangeId).toBe("test-mock");
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("a subscribe* visszaad egy subscription ID-t", async () => {
      await feed.open();
      const sub1 = await feed.subscribeTicker(BTC_USDC, () => {});
      const sub2 = await feed.subscribeOrderBook(BTC_USDC, 20, () => {});
      const sub3 = await feed.subscribeTrades(BTC_USDC, () => {});
      const sub4 = await feed.subscribeOhlcv(BTC_USDC, "1h", () => {});
      expect(sub1).toBeTypeOf("number");
      expect(sub2).toBeTypeOf("number");
      expect(sub3).toBeTypeOf("number");
      expect(sub4).toBeTypeOf("number");
      expect(feed.subscriptionCount()).toBe(4);
    });

    it("az unsubscribe eltávolítja a subscriptiont", async () => {
      await feed.open();
      const id = await feed.subscribeTicker(BTC_USDC, () => {});
      expect(feed.subscriptionCount()).toBe(1);
      await feed.unsubscribe(id);
      expect(feed.subscriptionCount()).toBe(0);
    });

    it("az unsubscribe ismeretlen ID-re nem dob", async () => {
      await feed.open();
      await expect(feed.unsubscribe(9999)).resolves.toBeUndefined();
    });

    it("a pushEvent csak a megfelelő symbol-ú subscribernek küld", async () => {
      await feed.open();
      const received: FeedEvent[] = [];
      await feed.subscribeTicker(BTC_USDC, (e) => received.push(e));
      await feed.subscribeTicker(ETH_USDC, () => {
        // should not be called
        expect.fail("ETH subscriber should not receive BTC event");
      });
      const event: FeedEvent = { kind: "ticker", payload: defaultTicker(BTC_USDC) };
      feed.pushEvent(event);
      expect(received).toHaveLength(1);
    });

    it("a pushEvent a timeframe alapján szűr az OHLCV subscriptionöknél", async () => {
      await feed.open();
      const received: string[] = [];
      await feed.subscribeOhlcv(BTC_USDC, "1h", (e) => {
        if (e.kind === "ohlcv") received.push("1h");
      });
      await feed.subscribeOhlcv(BTC_USDC, "4h", (e) => {
        if (e.kind === "ohlcv") received.push("4h");
      });
      const event1h: FeedEvent = { kind: "ohlcv", payload: { symbol: BTC_USDC, timeframe: "1h", candle: [0, 100, 101, 99, 100, 0] } };
      const event4h: FeedEvent = { kind: "ohlcv", payload: { symbol: BTC_USDC, timeframe: "4h", candle: [0, 100, 101, 99, 100, 0] } };
      feed.pushEvent(event1h);
      feed.pushEvent(event4h);
      expect(received).toEqual(["1h", "4h"]);
    });

    it("a pushEvent figyelmen kívül hagyja a más típusú event-eket", async () => {
      await feed.open();
      let called = false;
      await feed.subscribeTicker(BTC_USDC, () => {
        called = true;
      });
      const event: FeedEvent = { kind: "trade", payload: { id: "1", symbol: BTC_USDC, timestamp: 0, price: 100, amount: 1, takerSide: "buy" } };
      feed.pushEvent(event);
      expect(called).toBe(false);
    });
  });

  describe("fetch* metódusok", () => {
    it("fetchTickerSnapshot a default ticker-t adja, ha nincs explicit", async () => {
      await feed.open();
      const t = await feed.fetchTickerSnapshot(BTC_USDC);
      expect(t.symbol).toBe(BTC_USDC);
      expect(t.last).toBeGreaterThan(0);
    });

    it("fetchTickerSnapshot az explicit setTicker értéket adja", async () => {
      await feed.open();
      const custom: Ticker = {
        symbol: BTC_USDC,
        timestamp: 12345,
        bid: 50000,
        ask: 50100,
        last: 50050,
        baseVolume: 100,
        quoteVolume: 5_000_000,
      };
      feed.setTicker(BTC_USDC, custom);
      const t = await feed.fetchTickerSnapshot(BTC_USDC);
      expect(t).toEqual(custom);
    });

    it("fetchOrderBookSnapshot a default orderbook-ot adja", async () => {
      await feed.open();
      const ob = await feed.fetchOrderBookSnapshot(BTC_USDC, 20);
      expect(ob.symbol).toBe(BTC_USDC);
      expect(ob.bids.length).toBeGreaterThan(0);
      expect(ob.asks.length).toBeGreaterThan(0);
    });

    it("fetchOrderBookSnapshot a set snapshot-ot adja", async () => {
      await feed.open();
      const custom: OrderBook = {
        symbol: BTC_USDC,
        timestamp: 1,
        nonce: 2,
        bids: [{ price: 100, amount: 1 }],
        asks: [{ price: 101, amount: 1 }],
      };
      const newFeed = new MockExchangeFeed({ orderBookSnapshot: new Map([[BTC_USDC, custom]]) });
      await newFeed.open();
      const ob = await newFeed.fetchOrderBookSnapshot(BTC_USDC, 20);
      expect(ob).toEqual(custom);
    });

    it("fetchMarketMeta a default meta-t adja", async () => {
      await feed.open();
      const meta = await feed.fetchMarketMeta(ETH_USDC);
      expect(meta.symbol).toBe(ETH_USDC);
      expect(meta.base).toBe("ETH");
    });

    it("fetchMarketMeta a set meta-t adja", async () => {
      await feed.open();
      const custom: MarketMeta = {
        symbol: BTC_USDC,
        base: "BTC",
        quote: "USDC",
        amountPrecision: 8,
        pricePrecision: 2,
        minAmount: 0.0001,
        minCost: 10,
      };
      const newFeed = new MockExchangeFeed({ marketMeta: new Map([[BTC_USDC, custom]]) });
      await newFeed.open();
      const meta = await newFeed.fetchMarketMeta(BTC_USDC);
      expect(meta).toEqual(custom);
    });

    it("fetchBalances visszaadja a beállított egyenleget", async () => {
      await feed.open();
      feed.setBalance("USDC", 5000, 5000);
      const balances = await feed.fetchBalances();
      expect(balances).toContainEqual({ currency: "USDC", free: 5000, total: 5000 });
    });

    it("fetchBalances új currency-t ad hozzá, ha még nincs", async () => {
      await feed.open();
      feed.setBalance("BTC", 0.5, 0.5);
      const balances = await feed.fetchBalances();
      expect(balances).toContainEqual({ currency: "BTC", free: 0.5, total: 0.5 });
    });
  });

  describe("placeOrder / cancelOrder / fetchOrder", () => {
    const sampleOrder: OrderRequest = {
      clientOrderId: "order-1" as ClientOrderId,
      symbol: BTC_USDC,
      side: "buy",
      type: "limit",
      amount: 0.1,
      price: 60000,
    };

    it("placeOrder eltárolja az order-t open státusszal", async () => {
      await feed.open();
      const order = await feed.placeOrder(sampleOrder);
      expect(order.status).toBe("open");
      expect(order.filled).toBe(0);
      expect(feed.getOrder(sampleOrder.clientOrderId)).toBeDefined();
    });

    it("placeOrder hibát dob, ha limit order price nélkül jön", async () => {
      await feed.open();
      await expect(
        feed.placeOrder({ ...sampleOrder, price: undefined }),
      ).rejects.toThrow("limit order-hez kötelező a price");
    });

    it("cancelOrder törli az order státuszát canceled-re", async () => {
      await feed.open();
      await feed.placeOrder(sampleOrder);
      const canceled = await feed.cancelOrder(sampleOrder.clientOrderId, BTC_USDC);
      expect(canceled.status).toBe("canceled");
    });

    it("cancelOrder hibát dob ismeretlen order-re", async () => {
      await feed.open();
      await expect(
        feed.cancelOrder("nonexistent" as ClientOrderId, BTC_USDC),
      ).rejects.toThrow("ismeretlen order");
    });

    it("fetchOrder visszaadja az order-t", async () => {
      await feed.open();
      await feed.placeOrder(sampleOrder);
      const o = await feed.fetchOrder(sampleOrder.clientOrderId, BTC_USDC);
      expect(o.clientOrderId).toBe(sampleOrder.clientOrderId);
    });

    it("fetchOrder hibát dob ismeretlen order-re", async () => {
      await feed.open();
      await expect(
        feed.fetchOrder("nonexistent" as ClientOrderId, BTC_USDC),
      ).rejects.toThrow("ismeretlen order");
    });

    it("fetchOpenOrders csak az open státuszúakat adja", async () => {
      await feed.open();
      const o1: OrderRequest = { ...sampleOrder, clientOrderId: "o1" as ClientOrderId };
      const o2: OrderRequest = { ...sampleOrder, clientOrderId: "o2" as ClientOrderId };
      await feed.placeOrder(o1);
      await feed.placeOrder(o2);
      await feed.cancelOrder("o2" as ClientOrderId, BTC_USDC);
      const open = await feed.fetchOpenOrders(BTC_USDC);
      expect(open).toHaveLength(1);
      expect(open[0]?.clientOrderId).toBe("o1");
    });

    it("setOrderStatus frissíti az order-t", async () => {
      await feed.open();
      await feed.placeOrder(sampleOrder);
      feed.setOrderStatus(sampleOrder.clientOrderId, { status: "closed", filled: 0.1, average: 60000 });
      const o = feed.getOrder(sampleOrder.clientOrderId);
      expect(o?.status).toBe("closed");
      expect(o?.filled).toBe(0.1);
    });

    it("setOrderStatus nem csinál semmit, ha nincs ilyen order", async () => {
      await feed.open();
      feed.setOrderStatus("nonexistent" as ClientOrderId, { status: "closed" });
      expect(feed.getOrder("nonexistent" as ClientOrderId)).toBeUndefined();
    });
  });

  describe("statusOf", () => {
    it("a 'open'/'closed'/'canceled' stringet visszaadja", () => {
      expect(feed.statusOf("open")).toBe("open");
      expect(feed.statusOf("closed")).toBe("closed");
      expect(feed.statusOf("canceled")).toBe("canceled");
    });

    it("a 'filled' stringet 'closed'-ra normalizálja", () => {
      expect(feed.statusOf("filled")).toBe("closed");
    });

    it("ismeretlen stringre 'open'-t ad vissza", () => {
      expect(feed.statusOf("unknown")).toBe("open");
    });
  });

  describe("feed nincs megnyitva", () => {
    it("fetchBalances hibát dob", async () => {
      await expect(feed.fetchBalances()).rejects.toThrow("nincs megnyitva");
    });

    it("fetchTickerSnapshot hibát dob", async () => {
      await expect(feed.fetchTickerSnapshot(BTC_USDC)).rejects.toThrow("nincs megnyitva");
    });

    it("fetchOrderBookSnapshot hibát dob", async () => {
      await expect(feed.fetchOrderBookSnapshot(BTC_USDC, 20)).rejects.toThrow("nincs megnyitva");
    });

    it("fetchMarketMeta hibát dob", async () => {
      await expect(feed.fetchMarketMeta(BTC_USDC)).rejects.toThrow("nincs megnyitva");
    });

    it("placeOrder hibát dob", async () => {
      const req: OrderRequest = {
        clientOrderId: "x" as ClientOrderId,
        symbol: BTC_USDC,
        side: "buy",
        type: "market",
        amount: 0.1,
      };
      await expect(feed.placeOrder(req)).rejects.toThrow("nincs megnyitva");
    });

    it("cancelOrder hibát dob", async () => {
      await expect(
        feed.cancelOrder("x" as ClientOrderId, BTC_USDC),
      ).rejects.toThrow("nincs megnyitva");
    });

    it("fetchOrder hibát dob", async () => {
      await expect(
        feed.fetchOrder("x" as ClientOrderId, BTC_USDC),
      ).rejects.toThrow("nincs megnyitva");
    });

    it("fetchOpenOrders hibát dob", async () => {
      await expect(feed.fetchOpenOrders(BTC_USDC)).rejects.toThrow("nincs megnyitva");
    });

    it("subscribeTicker hibát dob", async () => {
      await expect(feed.subscribeTicker(BTC_USDC, () => {})).rejects.toThrow("nincs megnyitva");
    });

    it("subscribeOrderBook hibát dob", async () => {
      await expect(feed.subscribeOrderBook(BTC_USDC, 20, () => {})).rejects.toThrow("nincs megnyitva");
    });

    it("subscribeTrades hibát dob", async () => {
      await expect(feed.subscribeTrades(BTC_USDC, () => {})).rejects.toThrow("nincs megnyitva");
    });

    it("subscribeOhlcv hibát dob", async () => {
      await expect(feed.subscribeOhlcv(BTC_USDC, "1h", () => {})).rejects.toThrow("nincs megnyitva");
    });
  });
});

describe("defaultTicker", () => {
  it("a támogatott symbolokra értelmes default értéket ad", () => {
    const btc = defaultTicker(BTC_USDC);
    expect(btc.symbol).toBe(BTC_USDC);
    expect(btc.bid).toBeLessThan(btc.last);
    expect(btc.ask).toBeGreaterThan(btc.last);
  });

  it("ismeretlen symbolra 100-as default-ot ad", () => {
    const t = defaultTicker("UNKNOWN/USDC" as Symbol);
    expect(t.last).toBe(100);
  });
});

describe("defaultOrderBook", () => {
  it("1 szintű orderbook-ot ad", () => {
    const ob = defaultOrderBook(SOL_USDC);
    expect(ob.bids).toHaveLength(1);
    expect(ob.asks).toHaveLength(1);
  });
});

describe("defaultMarketMeta", () => {
  it("a symbol-ból kinyeri a base/quote currency-t", () => {
    const meta = defaultMarketMeta(BTC_USDC);
    expect(meta.base).toBe("BTC");
    expect(meta.quote).toBe("USDC");
  });
});
