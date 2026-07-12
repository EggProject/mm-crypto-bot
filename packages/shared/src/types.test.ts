/**
 * packages/shared/src/types.test.ts
 *
 * A `types.ts` típus-műveleteinek 100% line + branch tesztje.
 * A legtöbb típus type-only, de a `makeSymbol` és az `asExchangeFeed`
 * függvények futtatható kódot tartalmaznak — ezeket kell lefedni.
 */

import { describe, expect, it } from "bun:test";
import { makeSymbol, asExchangeFeed } from "./types.js";
import type {
  Brand,
  Result,
  Side,
  Timeframe,
  Candle,
  Trade,
  ExitReason,
  ExchangeFeed,
} from "./types.js";
import type { Exchange } from "ccxt";

describe("makeSymbol — Symbol brand konstruktor", () => {
  it("a string-et Symbol branded típussá alakítja", () => {
    const sym = makeSymbol("BTC/USDC");
    // Type-szinten Symbol, runtime-on string.
    expect(sym as string).toBe("BTC/USDC");
    expect(typeof sym).toBe("string");
  });

  it("különböző string-ek különböző Symbol-okká alakulnak", () => {
    const a = makeSymbol("BTC/USDC");
    const b = makeSymbol("ETH/USDC");
    expect(a as string).not.toBe(b as string);
  });

  it("üres string is valid Symbol (a brand csak type-szinten)", () => {
    const sym = makeSymbol("");
    expect(sym as string).toBe("");
  });
});

describe("asExchangeFeed — ccxt Exchange → ExchangeFeed típus-assertion", () => {
  it("egy ccxt Exchange objektumot ExchangeFeed-ként ad vissza", () => {
    // A ccxt Exchange egy konkrét osztály — itt egy minimalista mock-ot készítünk,
    // ami kielégíti a típus-szintű Exchange kontraktot.
    const mockEx = {
      id: "binance",
      name: "Binance",
      // A többi metódust a teszt nem hívja — a type-assertion az egyetlen futó kód.
    } as unknown as Exchange;

    const feed: ExchangeFeed = asExchangeFeed(mockEx);
    expect(feed.id).toBe("binance");
    expect(feed.name).toBe("Binance");
  });

  it("az asExchangeFeed visszatérési értéke referenciája megegyezik a bemenettel", () => {
    const mockEx = { id: "x", name: "X" } as unknown as Exchange;
    const feed: ExchangeFeed = asExchangeFeed(mockEx);
    expect(feed as unknown as Exchange).toBe(mockEx);
  });
});

describe("Brand típus — type-szintű ellenőrzés (compile-time)", () => {
  it("egy Brand<string, X> érték string-ként használható", () => {
    // Ha a Brand típus nem kompatibilis a string-gel, ez a teszt nem fordul.
    const branded: Brand<string, "UserId"> = "user-123" as Brand<string, "UserId">;
    const asString: string = branded;
    expect(asString).toBe("user-123");
  });
});

describe("Result típus — discriminated union típusellenőrzés (compile-time)", () => {
  it("egy ok=true Result értéke kiolvasható", () => {
    const r: Result<number> = { ok: true, value: 42 };
    if (r.ok) {
      expect(r.value).toBe(42);
    }
  });

  it("egy ok=false Result hibája kiolvasható", () => {
    const r: Result<number, string> = { ok: false, error: "boom" };
    if (!r.ok) {
      expect(r.error).toBe("boom");
    }
  });
});

describe("Side és Timeframe — literal típusok", () => {
  it("a Side típusú érték 'buy' vagy 'sell' lehet", () => {
    const buy: Side = "buy";
    const sell: Side = "sell";
    expect(buy).toBe("buy");
    expect(sell).toBe("sell");
  });

  it("a Timeframe típusú értékek a kanonikus timeframe-ök", () => {
    const tfs: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
    expect(tfs.length).toBe(6);
  });
});

describe("Candle és Trade típusok — type-szintű ellenőrzés", () => {
  it("egy Candle értéke runtime ellenőrizhető", () => {
    const c: Candle = {
      timestamp: 1_000_000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 50,
    };
    expect(c.open).toBe(100);
    expect(c.close).toBe(105);
  });

  it("egy Trade típusú érték minden mezője typecheck-elhető", () => {
    const t: Trade = {
      symbol: makeSymbol("BTC/USDC"),
      side: "buy",
      entryTime: 1000,
      entryPrice: 100,
      exitTime: 2000,
      exitPrice: 110,
      quantity: 1,
      notionalUsd: 100,
      pnlUsd: 10,
      pnlPct: 10,
      feesUsd: 0.1,
      exitReason: "take_profit" as ExitReason,
    };
    expect(t.pnlUsd).toBe(10);
  });

  it("az ExitReason union minden ága typecheck-elhető", () => {
    const reasons: ExitReason[] = [
      "stop_loss",
      "take_profit",
      "trailing_stop",
      "trend_reversal",
      "time_exit",
      "kill_switch",
      "end_of_data",
    ];
    expect(reasons.length).toBe(7);
  });
});
