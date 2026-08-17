/**
 * packages/paper/src/test-helpers.test.ts
 *
 * A `MockExchangeFeed` és a `defaultMockTicker` segédletek tesztjei.
 * A test-helpers.ts célja, hogy a PaperTrader tesztjeihez nyújtson
 * egy minimális CCXT-szerű `ExchangeFeed` implementációt. A nem-hívott
 * metódusok `throw new Error("not implemented")` típusú hibát dobnak —
 * ezt a lefedettséget itt teszteljük.
 */

import { describe, expect, it } from "vitest";
import { MockExchangeFeed, defaultMockTicker } from "./test-helpers.js";

async function expectRejectedWith(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof Error) {
      expect(error.message).toContain(message);
      return;
    }
    throw new Error("Expected MockExchangeFeed to reject with an Error", { cause: error });
  }
  throw new Error("Expected MockExchangeFeed to reject");
}

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
    expect(feed.lastFetchedSymbol).toBeUndefined();
    await feed.fetchTicker("ETH/USDT");
    expect(feed.lastFetchedSymbol).toBe("ETH/USDT");
  });

  it("ha a tickerError meg van adva, a fetchTicker azt a hibát dobja", async () => {
    const feed = new MockExchangeFeed({
      tickerError: (sym) => new Error(`Ticker hiba: ${sym}`),
    });
    await expectRejectedWith(feed.fetchTicker("BTC/USDT"), "Ticker hiba: BTC/USDT");
  });

  it("ha a symbol === 'NETWORK_ERROR' és networkErrorMessage meg van adva, a fetchTicker azt a hibát dobja", async () => {
    const feed = new MockExchangeFeed({
      networkErrorMessage: "Network timeout",
    });
    await expectRejectedWith(feed.fetchTicker("NETWORK_ERROR"), "Network timeout");
  });
});

describe("MockExchangeFeed — watchTicker", () => {
  it("a watchTickerImpl hívódik a watchTicker hívásra", async () => {
    let isCalled = false;
    const feed = new MockExchangeFeed({
      watchTickerImpl: () => {
        isCalled = true;
        return Promise.resolve(defaultMockTicker("BTC/USDT"));
      },
    });
    await feed.watchTicker("BTC/USDT");
    expect(isCalled).toBe(true);
    expect(feed.watchTickerCalls).toEqual(["BTC/USDT"]);
  });

  it("a sorba tett watchTicker hiba a hívás után elutasítódik", async () => {
    const feed = new MockExchangeFeed({
      queuedWatchTickerErrors: [new Error("queued ticker error")],
    });
    await expectRejectedWith(feed.watchTicker("BTC/USDT"), "queued ticker error");
    expect(feed.watchTickerCalls).toEqual(["BTC/USDT"]);
  });

  it("a default watchTickerImpl soha-nem-resolve-ölő Promise-t ad vissza", async () => {
    const feed = new MockExchangeFeed();
    // Nem hívunk await-ot — csak ellenőrizzük, hogy a Promise pending.
    const p = feed.watchTicker("BTC/USDT");
    // A race Promise-el megoldjuk a tesztet 1ms után, hogy ne legyen pending.
    const raceResult = await Promise.race<"resolved" | "timeout">([
      (async (): Promise<"resolved"> => {
        await p;
        return "resolved";
      })(),
      new Promise<"timeout">((resolve) => {
        setTimeout(resolve, 5, "timeout");
      }),
    ]);
    expect(raceResult).toBe("timeout");
  });
});

describe("MockExchangeFeed — unimplemented metódusok", () => {
  it("loadMarkets hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.loadMarkets(), "not implemented");
  });

  it("fetchOrderBook hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.fetchOrderBook("BTC/USDT"), "not implemented");
  });

  it("fetchTrades hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.fetchTrades("BTC/USDT"), "not implemented");
  });

  it("fetchOHLCV hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.fetchOHLCV("BTC/USDT", "1h"), "not implemented");
  });

  it("watchOrderBook hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.watchOrderBook("BTC/USDT", 10), "not implemented");
  });

  it("watchTrades hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.watchTrades("BTC/USDT"), "not implemented");
  });

  it("watchOHLCV hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.watchOHLCV("BTC/USDT", "1h"), "not implemented");
  });

  it("watchOrders hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.watchOrders("BTC/USDT"), "not implemented");
  });

  it("watchBalance hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.watchBalance(), "not implemented");
  });

  it("watchPositions hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.watchPositions(), "not implemented");
  });

  it("fetchBalance hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.fetchBalance(), "not implemented");
  });

  it("createOrder hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.createOrder("BTC/USDT", "market", "buy", 1), "not implemented");
  });

  it("cancelOrder hibát dob", async () => {
    const feed = new MockExchangeFeed();
    await expectRejectedWith(feed.cancelOrder("order-1"), "not implemented");
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
