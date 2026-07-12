/**
 * packages/paper/src/test-helpers.test.ts
 *
 * A `MockExchangeFeed` és a `defaultMockTicker` segédletek tesztjei.
 * A test-helpers.ts célja, hogy a PaperTrader tesztjeihez nyújtson
 * egy minimális CCXT-szerű `ExchangeFeed` implementációt. A nem-hívott
 * metódusok `throw new Error("not implemented")` típusú hibát dobnak —
 * ezt a lefedettséget itt teszteljük.
 */

import { describe, expect, it } from "bun:test";
import { MockExchangeFeed, defaultMockTicker } from "./test-helpers.js";

describe("MockExchangeFeed — default konstruktor", () => {
  it("a default id='mock' és name='Mock Exchange'", () => {
    const feed = new MockExchangeFeed();
    expect(feed.id).toBe("mock");
    expect(feed.name).toBe("Mock Exchange");
  });

  it("az opciókkal megadott id és name felülíródnak", () => {
    const feed = new MockExchangeFeed({ id: "binance", name: "Binance Mock" });
    expect(feed.id).toBe("binance");
    expect(feed.name).toBe("Binance Mock");
  });
});

describe("MockExchangeFeed — fetchTicker", () => {
  it("a default tickerResolver a defaultMockTicker-t adja vissza", async () => {
    const feed = new MockExchangeFeed();
    const t = await feed.fetchTicker("BTC/USDT");
    expect(t.symbol).toBe("BTC/USDT");
    expect(t.last).toBe(100);
  });

  it("a lastFetchedSymbol frissül a fetchTicker hívásra", async () => {
    const feed = new MockExchangeFeed();
    expect(feed.lastFetchedSymbol).toBeNull();
    await feed.fetchTicker("ETH/USDT");
    expect(feed.lastFetchedSymbol).toBe("ETH/USDT");
  });

  it("ha a tickerError meg van adva, a fetchTicker azt a hibát dobja", async () => {
    const feed = new MockExchangeFeed({
      tickerError: (sym) => new Error(`Ticker hiba: ${sym}`),
    });
    await expect(feed.fetchTicker("BTC/USDT")).rejects.toThrow("Ticker hiba: BTC/USDT");
  });

  it("ha a symbol === 'NETWORK_ERROR' és networkErrorMessage meg van adva, a fetchTicker azt a hibát dobja", async () => {
    const feed = new MockExchangeFeed({
      networkErrorMessage: "Network timeout",
    });
    await expect(feed.fetchTicker("NETWORK_ERROR")).rejects.toThrow("Network timeout");
  });
});

describe("MockExchangeFeed — watchTicker", () => {
  it("a watchTickerImpl hívódik a watchTicker hívásra", async () => {
    let called = false;
    const feed = new MockExchangeFeed({
      watchTickerImpl: () => {
        called = true;
        return Promise.resolve(defaultMockTicker("BTC/USDT"));
      },
    });
    await feed.watchTicker("BTC/USDT");
    expect(called).toBe(true);
  });

  it("a default watchTickerImpl soha-nem-resolve-ölő Promise-t ad vissza", async () => {
    const feed = new MockExchangeFeed();
    // Nem hívunk await-ot — csak ellenőrizzük, hogy a Promise pending.
    const p = feed.watchTicker("BTC/USDT");
    // A race Promise-el megoldjuk a tesztet 1ms után, hogy ne legyen pending.
    const raceResult = await Promise.race([
      p.then(() => "resolved" as const),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5)),
    ]);
    expect(raceResult).toBe("timeout");
  });
});

describe("MockExchangeFeed — unimplemented metódusok", () => {
  it("loadMarkets hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.loadMarkets()).rejects.toThrow("not implemented");
  });

  it("fetchOrderBook hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.fetchOrderBook("BTC/USDT")).rejects.toThrow("not implemented");
  });

  it("fetchTrades hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.fetchTrades("BTC/USDT")).rejects.toThrow("not implemented");
  });

  it("fetchOHLCV hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.fetchOHLCV("BTC/USDT", "1h")).rejects.toThrow("not implemented");
  });

  it("watchOrderBook hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.watchOrderBook("BTC/USDT", 10)).rejects.toThrow("not implemented");
  });

  it("watchTrades hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.watchTrades("BTC/USDT")).rejects.toThrow("not implemented");
  });

  it("watchOHLCV hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.watchOHLCV("BTC/USDT", "1h")).rejects.toThrow("not implemented");
  });

  it("watchOrders hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.watchOrders("BTC/USDT")).rejects.toThrow("not implemented");
  });

  it("watchBalance hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.watchBalance()).rejects.toThrow("not implemented");
  });

  it("watchPositions hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.watchPositions()).rejects.toThrow("not implemented");
  });

  it("fetchBalance hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.fetchBalance()).rejects.toThrow("not implemented");
  });

  it("createOrder hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.createOrder("BTC/USDT", "market", "buy", 1)).rejects.toThrow(
      "not implemented",
    );
  });

  it("cancelOrder hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expect(feed.cancelOrder("order-1")).rejects.toThrow("not implemented");
  });
});

describe("defaultMockTicker — helper", () => {
  it("a default ticker 100 USDT last/bid/ask árakkal jön létre", () => {
    const t = defaultMockTicker("BTC/USDT");
    expect(t.last).toBe(100);
    expect(t.bid).toBe(100);
    expect(t.ask).toBe(101);
  });

  it("az overrides alkalmazódnak a defaultra", () => {
    const t = defaultMockTicker("ETH/USDT", { last: 200, ask: 205 });
    expect(t.last).toBe(200);
    expect(t.ask).toBe(205);
    expect(t.bid).toBe(100); // default maradt
  });
});
