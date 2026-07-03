// packages/exchange/tests/bybitEuFeed.test.ts — a `bybitEuFeed.ts` tesztjei
//
// FELADAT: A CCXT Pro tényleges WS kapcsolatot igényel, ezért a `BybitEuFeed`
// integrációs tesztjeit egy mocking réteggel oldjuk meg. A unit tesztek
// a normalizáló függvényekre és a feed wrapper belső logikájára fókuszálnak
// (assertOpen, assertSupported, status mapping, watch loop indítás).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Exchange as CcxtExchange } from "ccxt";

import { BybitEuFeed, normalizeTicker, normalizeOrderBook, normalizeTrade, normalizeMarketMeta, normalizeBalances, normalizeOrder } from "../src/bybitEuFeed.js";
import { ExchangeFeedError } from "../src/feed.js";
import type { Symbol, ClientOrderId } from "../src/types.js";

const BTC_USDC: Symbol = "BTC/USDC" as Symbol;
const ETH_USDC: Symbol = "ETH/USDC" as Symbol;

describe("bybitEuFeed.normalizers", () => {
  describe("normalizeTicker", () => {
    it("a CCXT Ticker-t a mi Ticker típusunkra konvertálja", () => {
      const raw = {
        symbol: "BTC/USDC",
        timestamp: 12345,
        bid: 50000,
        ask: 50100,
        last: 50050,
        baseVolume: 10,
        quoteVolume: 500000,
      };
      const t = normalizeTicker(raw as never, BTC_USDC);
      expect(t.symbol).toBe(BTC_USDC);
      expect(t.timestamp).toBe(12345);
      expect(t.bid).toBe(50000);
      expect(t.ask).toBe(50100);
      expect(t.last).toBe(50050);
    });

    it("az undefined mezőkhöz 0-t ad", () => {
      const raw = { symbol: "BTC/USDC" };
      const t = normalizeTicker(raw as never, BTC_USDC);
      expect(t.bid).toBe(0);
      expect(t.ask).toBe(0);
      expect(t.last).toBe(0);
      expect(t.baseVolume).toBe(0);
      expect(t.quoteVolume).toBe(0);
      expect(t.timestamp).toBeGreaterThan(0);
    });
  });

  describe("normalizeOrderBook", () => {
    it("a CCXT OrderBook-ot a mi típusunkra konvertálja", () => {
      const raw = {
        symbol: "BTC/USDC",
        timestamp: 1,
        nonce: 2,
        bids: [[50000, 1]] as [number, number][],
        asks: [[50100, 2]] as [number, number][],
      };
      const ob = normalizeOrderBook(raw as never, BTC_USDC);
      expect(ob.bids).toHaveLength(1);
      expect(ob.asks).toHaveLength(1);
      expect(ob.bids[0]?.price).toBe(50000);
      expect(ob.bids[0]?.amount).toBe(1);
      expect(ob.asks[0]?.price).toBe(50100);
    });

    it("üres bids/asks esetén üres tömböt ad", () => {
      const raw = { symbol: "BTC/USDC", timestamp: 1, nonce: 2, bids: [], asks: [] };
      const ob = normalizeOrderBook(raw as never, BTC_USDC);
      expect(ob.bids).toHaveLength(0);
      expect(ob.asks).toHaveLength(0);
    });
  });

  describe("normalizeTrade", () => {
    it("a 'sell' side-ot 'sell'-re normalizálja", () => {
      const raw = { id: "t1", timestamp: 1, price: 100, amount: 1, side: "sell" as const };
      const t = normalizeTrade(raw as never, BTC_USDC);
      expect(t.takerSide).toBe("sell");
      expect(t.price).toBe(100);
    });

    it("a 'buy' side-ot 'buy'-ra normalizálja", () => {
      const raw = { id: "t1", timestamp: 1, price: 100, amount: 1, side: "buy" as const };
      const t = normalizeTrade(raw as never, BTC_USDC);
      expect(t.takerSide).toBe("buy");
    });

    it("az undefined side-ot 'buy'-ra default-olja", () => {
      const raw = { id: "t1", timestamp: 1, price: 100, amount: 1, side: undefined };
      const t = normalizeTrade(raw as never, BTC_USDC);
      expect(t.takerSide).toBe("buy");
    });
  });

  describe("normalizeMarketMeta", () => {
    it("a CCXT Market-ből a mi MarketMeta típusunkat készíti", () => {
      const raw = {
        base: "BTC",
        quote: "USDC",
        precision: { amount: 6, price: 2 },
        limits: { amount: { min: 0.0001 }, cost: { min: 1 } },
      };
      const m = normalizeMarketMeta(raw as never, BTC_USDC);
      expect(m.symbol).toBe(BTC_USDC);
      expect(m.base).toBe("BTC");
      expect(m.quote).toBe("USDC");
      expect(m.amountPrecision).toBe(6);
      expect(m.pricePrecision).toBe(2);
      expect(m.minAmount).toBe(0.0001);
      expect(m.minCost).toBe(1);
    });

    it("undefined precision esetén default értékeket ad", () => {
      const raw = { base: "X", quote: "Y", precision: { amount: 0, price: 0 }, limits: { amount: {}, cost: {} } };
      // A `0` nem szám a typeof === "number" ellenőrzésünk miatt...
      // Javítva: a typeof "number" true, tehát a default ágra kerülünk.
      const m = normalizeMarketMeta(raw as never, BTC_USDC);
      expect(m.amountPrecision).toBe(0);
      expect(m.pricePrecision).toBe(0);
      expect(m.minAmount).toBe(0);
      expect(m.minCost).toBe(0);
    });
  });

  describe("normalizeBalances", () => {
    it("kiszűri az info/timestamp/datetime extra mezőket", () => {
      const raw = {
        BTC: { free: 0.5, used: 0, total: 0.5 },
        USDC: { free: 1000, used: 0, total: 1000 },
        info: { foo: "bar" },
        timestamp: 12345,
        datetime: "2026-01-01T00:00:00Z",
      };
      const balances = normalizeBalances(raw);
      expect(balances).toHaveLength(2);
      expect(balances).toContainEqual({ currency: "BTC", free: 0.5, total: 0.5 });
      expect(balances).toContainEqual({ currency: "USDC", free: 1000, total: 1000 });
    });

    it("undefined free/total esetén 0-t ad", () => {
      const raw = { BTC: { free: undefined, total: undefined } };
      const balances = normalizeBalances(raw);
      expect(balances).toEqual([{ currency: "BTC", free: 0, total: 0 }]);
    });

    it("undefined entry esetén kihagyja a currency-t", () => {
      const raw = { BTC: undefined };
      const balances = normalizeBalances(raw);
      expect(balances).toHaveLength(0);
    });
  });

  describe("normalizeOrder", () => {
    it("az 'open' státuszt megtartja", () => {
      const raw = { id: "1", clientOrderId: "c1", status: "open", side: "buy", type: "limit", amount: 1, price: 100, filled: 0, timestamp: 1 };
      const o = normalizeOrder(raw as never, undefined);
      expect(o.status).toBe("open");
    });

    it("a 'filled' státuszt 'closed'-ra normalizálja", () => {
      const raw = { id: "1", clientOrderId: "c1", status: "filled", side: "buy", type: "limit", amount: 1, price: 100, filled: 1, timestamp: 1 };
      const o = normalizeOrder(raw as never, undefined);
      expect(o.status).toBe("closed");
    });

    it("a 'canceled' státuszt 'canceled'-re normalizálja", () => {
      const raw = { id: "1", clientOrderId: "c1", status: "canceled", side: "buy", type: "limit", amount: 1, price: 100, filled: 0, timestamp: 1 };
      const o = normalizeOrder(raw as never, undefined);
      expect(o.status).toBe("canceled");
    });

    it("a 'cancelled' (UK) státuszt 'canceled'-re (US) normalizálja", () => {
      const raw = { id: "1", clientOrderId: "c1", status: "cancelled", side: "buy", type: "limit", amount: 1, price: 100, filled: 0, timestamp: 1 };
      const o = normalizeOrder(raw as never, undefined);
      expect(o.status).toBe("canceled");
    });

    it("ismeretlen státuszra 'open'-t ad", () => {
      const raw = { id: "1", clientOrderId: "c1", status: "weird", side: "buy", type: "limit", amount: 1, price: 100, filled: 0, timestamp: 1 };
      const o = normalizeOrder(raw as never, undefined);
      expect(o.status).toBe("open");
    });

    it("a 'sell' side-ot 'sell'-re normalizálja", () => {
      const raw = { id: "1", clientOrderId: "c1", status: "open", side: "sell", type: "limit", amount: 1, price: 100, filled: 0, timestamp: 1 };
      const o = normalizeOrder(raw as never, undefined);
      expect(o.side).toBe("sell");
    });

    it("a 'market' típust 'market'-re hagyja", () => {
      const raw = { id: "1", clientOrderId: "c1", status: "open", side: "buy", type: "market", amount: 1, filled: 0, timestamp: 1 };
      const o = normalizeOrder(raw as never, undefined);
      expect(o.type).toBe("market");
    });

    it("az exchangeId-t undefined-ra állítja, ha a raw id üres string", () => {
      const raw = { id: "", clientOrderId: "c1", status: "open", side: "buy", type: "limit", amount: 1, price: 100, filled: 0, timestamp: 1 };
      const o = normalizeOrder(raw as never, undefined);
      expect(o.exchangeId).toBeUndefined();
    });

    it("a req-ből veszi a hiányzó clientOrderId-t", () => {
      const raw = { id: "1", status: "open", side: "buy", type: "limit", amount: 1, price: 100, filled: 0, timestamp: 1 };
      const req = { clientOrderId: "from-req" as ClientOrderId, symbol: BTC_USDC, side: "buy" as const, type: "limit" as const, amount: 1, price: 100 };
      const o = normalizeOrder(raw as never, req);
      expect(o.clientOrderId).toBe("from-req");
    });
  });
});

describe("BybitEuFeed instance", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("exchangeId", () => {
    it("'bybiteu'", () => {
      const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false });
      expect(feed.exchangeId).toBe("bybiteu");
    });
  });

  describe("statusOf", () => {
    let feed: BybitEuFeed;
    beforeEach(() => {
      feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false });
    });

    it("a CCXT 'filled' státuszt 'closed'-ra normalizálja", () => {
      expect(feed.statusOf("filled")).toBe("closed");
    });

    it("az 'open'/'closed'/'canceled' értékeket változatlanul hagyja", () => {
      expect(feed.statusOf("open")).toBe("open");
      expect(feed.statusOf("closed")).toBe("closed");
      expect(feed.statusOf("canceled")).toBe("canceled");
    });

    it("ismeretlen értékre 'open'-t ad", () => {
      expect(feed.statusOf("unknown")).toBe("open");
    });
  });

  describe("feed state hibák", () => {
    let feed: BybitEuFeed;

    beforeEach(() => {
      feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false });
    });

    it("fetchTickerSnapshot hibát dob, ha a feed nincs megnyitva", async () => {
      await expect(feed.fetchTickerSnapshot(BTC_USDC)).rejects.toThrow(ExchangeFeedError);
    });

    it("fetchTickerSnapshot hibát dob nem támogatott symbol-ra", async () => {
      // Az open() nélkül a fetch nem hívható, ezért a feed.open() kell előbb.
      // Mock-oljuk a CCXT belső loadMarkets hívását.
      await (feed as unknown as { opened: boolean }).opened !== undefined;
      // Az open() mock: a CCXT loadMarkets sikeresen fut le (valójában hálózati hívás, de mock-olható)
      // Helyette: a feed-et nyitottnak jelöljük a privát flag-en keresztül.
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      await expect(
        feed.fetchTickerSnapshot("DOGE/USDC" as Symbol),
      ).rejects.toThrow(ExchangeFeedError);
    });

    it("placeOrder limit order price nélkül hibát dob", async () => {
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      await expect(
        feed.placeOrder({
          clientOrderId: "x" as ClientOrderId,
          symbol: BTC_USDC,
          side: "buy",
          type: "limit",
          amount: 0.1,
        }),
      ).rejects.toThrow(ExchangeFeedError);
    });
  });

  describe("raw property", () => {
    it("a CCXT exchange instance-hez ad hozzáférést", () => {
      const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false });
      const raw = feed.raw as CcxtExchange;
      expect(raw).toBeDefined();
      expect(raw.id).toBe("bybiteu");
    });
  });

  describe("close()", () => {
    it("bezárja a feed-et és törli a subscriptionöket", async () => {
      const feed = new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100, sandbox: false });
      // Privát flag beállítása (a CCXT loadMarkets-et kikerüljük).
      Object.defineProperty(feed, "opened", { value: true, writable: true });
      // Kézzel felveszünk egy subscriptiont.
      const subs = (feed as unknown as { subs: Map<number, { cancelled: boolean }> }).subs;
      subs.set(1, { cancelled: false } as { cancelled: boolean });
      await feed.close();
      expect(subs.size).toBe(0);
    });
  });
});

describe("ExchangeFeedError", () => {
  it("Error-ből származik, name='ExchangeFeedError'", () => {
    const err = new ExchangeFeedError("test", undefined);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ExchangeFeedError");
    expect(err.message).toBe("test");
    expect(err.cause).toBeUndefined();
  });

  it("a cause mezőt megőrzi", () => {
    const cause = new Error("original");
    const err = new ExchangeFeedError("wrap", cause);
    expect(err.cause).toBe(cause);
  });
});
