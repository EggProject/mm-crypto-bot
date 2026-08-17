import { describe, expect, it } from "vitest";
import { PaperTrader } from "./paper-trader.js";
import {
  DEFAULT_FEE,
  ZERO_FEE,
  buySignal,
  makeFeed,
  requireTestValue,
  sellSignal,
} from "./paper-trader.test-support.js";
import { defaultMockTicker } from "./test-helpers.js";
import type { TradingSignal } from "@mm-crypto-bot/shared";

describe("PaperTrader — konstruktor és snapshot", () => {
  it("a kezdeti cash az initialBalanceQuote értéke, a positions üres", () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: ZERO_FEE,
    });
    const snap = pt.snapshot();
    expect(snap.cash).toBe(10_000);
    expect(snap.positions).toEqual([]);
  });

  it("a history kezdetben üres (read-only copy)", () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const h = pt.history_();
    expect(h).toEqual([]);
    // A history() a belső tömb másolata — módosítása NEM érinti a PaperTrader-t.
    expect(Array.isArray(h)).toBe(true);
  });

  it("a default maxHistory a konstruktorban 1000-re van állítva", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    // Közvetetten teszteljük: 1001 fill után a history csak 1000 elemű.
    const sig = buySignal({ suggestedAmount: 0.0001, suggestedPrice: 100 });
    for (let index = 0; index < 1001; index++) {
      await pt.executeSignal(sig);
    }
    const h = pt.history_();
    expect(h.length).toBe(1000);
  });

  it("az explicit maxHistory felülírja a default-ot", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 100_000,
      fee: DEFAULT_FEE,
      maxHistory: 5,
    });
    const sig = buySignal({ suggestedAmount: 0.0001, suggestedPrice: 100 });
    for (let index = 0; index < 10; index++) {
      await pt.executeSignal(sig);
    }
    expect(pt.history_().length).toBe(5);
  });
});

describe("PaperTrader.executeSignal — hold action", () => {
  it("a 'hold' action esetén null-t ad vissza és nem hívja a feed-et", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig: TradingSignal = {
      symbol: "BTC/USDT",
      action: "hold",
      confidence: 0.5,
      reason: "test",
      generatedAt: Date.now(),
    };
    const result = await pt.executeSignal(sig);
    expect(result).toBeNull();
    expect(feed.lastFetchedSymbol).toBeUndefined();
    expect(pt.snapshot().positions).toEqual([]);
  });
});

describe("PaperTrader.executeSignal — fill price kiválasztás", () => {
  it("buy signal esetén suggestedPrice nélkül az ask árat használja", async () => {
    const feed = makeFeed({
      tickerResolver: (sym) => defaultMockTicker(sym, { ask: 105, bid: 95, last: 100 }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01 });
    const fill = await pt.executeSignal(sig);
    const filledOrder = requireTestValue(fill, "buy fill");
    expect(filledOrder.price).toBe(105); // az ask
    expect(filledOrder.side).toBe("buy");
  });

  it("sell signal esetén suggestedPrice nélkül a bid árat használja", async () => {
    const feed = makeFeed({
      tickerResolver: (sym) => defaultMockTicker(sym, { ask: 105, bid: 95, last: 100 }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = sellSignal({ suggestedAmount: 0.01 });
    const fill = await pt.executeSignal(sig);
    const filledOrder = requireTestValue(fill, "sell fill");
    expect(filledOrder.price).toBe(95); // a bid
    expect(filledOrder.side).toBe("sell");
  });

  it("ha nincs ask sem bid sem last, a fillPrice=0 és null-t ad vissza", async () => {
    // Make the default mock ticker's ask, bid, and last values absent.
    const feed = makeFeed({
      tickerResolver: (sym) => defaultMockTicker(sym, { ask: undefined, bid: undefined, last: undefined }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01 });
    const fill = await pt.executeSignal(sig);
    expect(fill).toBeNull();
  });

  it("buy signal falls back to the ticker last price when ask is absent", async () => {
    const feed = makeFeed({
      tickerResolver: (symbol) => defaultMockTicker(symbol, { ask: undefined, last: 99 }),
    });
    const trader = new PaperTrader(feed, { initialBalanceQuote: 10_000, fee: DEFAULT_FEE });
    const fill = await trader.executeSignal(buySignal({ suggestedAmount: 0.01 }));
    expect(requireTestValue(fill, "last-price buy fill").price).toBe(99);
  });

  it("sell signal falls back to last or no fill when bid is absent", async () => {
    const lastPriceFeed = makeFeed({
      tickerResolver: (symbol) => defaultMockTicker(symbol, { bid: undefined, last: 98 }),
    });
    const lastPriceTrader = new PaperTrader(lastPriceFeed, { initialBalanceQuote: 10_000, fee: DEFAULT_FEE });
    const lastPriceFill = await lastPriceTrader.executeSignal(sellSignal({ suggestedAmount: 0.01 }));
    expect(requireTestValue(lastPriceFill, "last-price sell fill").price).toBe(98);

    const absentPriceFeed = makeFeed({
      tickerResolver: (symbol) => defaultMockTicker(symbol, { bid: undefined, last: undefined }),
    });
    const absentPriceTrader = new PaperTrader(absentPriceFeed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    expect(await absentPriceTrader.executeSignal(sellSignal({ suggestedAmount: 0.01 }))).toBeNull();
  });

  it("ha a suggestedPrice 0 vagy negatív, null-t ad vissza", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01, suggestedPrice: 0 });
    expect(await pt.executeSignal(sig)).toBeNull();

    const sig2 = buySignal({ suggestedAmount: 0.01, suggestedPrice: -50 });
    expect(await pt.executeSignal(sig2)).toBeNull();
  });

  it("a suggestedPrice explicit értéke felülírja a ticker árat", async () => {
    const feed = makeFeed({
      tickerResolver: (sym) => defaultMockTicker(sym, { ask: 105, bid: 95, last: 100 }),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01, suggestedPrice: 200 });
    const fill = await pt.executeSignal(sig);
    expect(requireTestValue(fill, "explicit-price fill").price).toBe(200);
  });
});

describe("PaperTrader.executeSignal — amount kiválasztás", () => {
  it("a suggestedAmount felülírja a Kelly-size-t", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.05, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    expect(requireTestValue(fill, "suggested-amount fill").amount).toBe(0.05);
  });

  it("ha a suggestedAmount 0 vagy negatív, null-t ad vissza", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0, suggestedPrice: 100 });
    expect(await pt.executeSignal(sig)).toBeNull();
  });

  it("ha a Kelly-size 0-t ad (nincs cash), null-t ad vissza", async () => {
    const feed = makeFeed();
    // Kezdő egyenleg 0 — a Kelly size = (0 * confidence * 0.25) / price = 0
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 0,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedPrice: 100 }); // nincs suggestedAmount → Kelly
    expect(await pt.executeSignal(sig)).toBeNull();
  });

  it("a Kelly-size a confidence * 0.25 * equity / price képletet használja", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    // confidence = 1.0 → size = (10000 * 1.0 * 0.25) / 100 = 25
    const sig = buySignal({ confidence: 1, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    expect(requireTestValue(fill, "Kelly fill").amount).toBeCloseTo(25, 6);
  });

  it("a confidence > 1.0 esetén is 1.0-ra van vágva (Math.min)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ confidence: 5, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    expect(requireTestValue(fill, "clamped Kelly fill").amount).toBeCloseTo(25, 6); // 10000 * 1.0 * 0.25 / 100
  });

  it("a confidence < 0.0 esetén is 0.0-ra van vágva (Math.max)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ confidence: -1, suggestedPrice: 100 });
    // A zero Kelly size produces no fill.
    const fill = await pt.executeSignal(sig);
    expect(fill).toBeNull();
  });
});

describe("PaperTrader.executeSignal — fillOrder: új pozíció nyitása", () => {
  it("az első buy új long pozíciót nyit, csökkenti a cash-t", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.5, suggestedPrice: 100 });
    await pt.executeSignal(sig);
    const snap = pt.snapshot();
    expect(snap.positions.length).toBe(1);
    const pos = requireTestValue(snap.positions[0], "long position");
    expect(pos.symbol).toBe("BTC/USDT");
    expect(pos.side).toBe("long");
    expect(pos.amount).toBe(0.5);
    expect(pos.avgEntryPrice).toBe(100);
    expect(pos.leverage).toBe(1);
    // A cash csökkenés: cost + fee = 100 * 0.5 + 100 * 0.5 * 0.001 = 50 + 0.05
    expect(snap.cash).toBeCloseTo(10_000 - 50 - 0.05, 6);
  });

  it("az első sell új short pozíciót nyit (amount negatív, side='short')", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = sellSignal({ suggestedAmount: 0.5, suggestedPrice: 100 });
    await pt.executeSignal(sig);
    const snap = pt.snapshot();
    expect(snap.positions.length).toBe(1);
    const pos = requireTestValue(snap.positions[0], "short position");
    expect(pos.side).toBe("short");
    expect(pos.amount).toBe(0.5);
    // Cash-accounting: short nyitáskor a short-sale proceeds beérkezik,
    // a taker fee pedig azonnal levonódik.
    expect(snap.cash).toBeCloseTo(10_000 + 50 - 0.05, 6);
  });
});

describe("PaperTrader.executeSignal — fillOrder: meglévő pozíció növelése", () => {
  it("a második, azonos irányú buy növeli a pozíciót és átlagolja az árat", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 200 }));
    const pos = requireTestValue(pt.snapshot().positions[0], "increased long position");
    expect(pos.amount).toBe(2);
    // Átlagár: (1*100 + 1*200) / 2 = 150
    expect(pos.avgEntryPrice).toBe(150);
  });

  it("a második, azonos irányú sell (short) növeli a short mennyiséget", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 100_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 200 }));
    const pos = requireTestValue(pt.snapshot().positions[0], "increased short position");
    expect(pos.amount).toBe(2);
    expect(pos.avgEntryPrice).toBe(150);
  });
});

describe("PaperTrader.executeSignal — fillOrder: ellentétes irányú fill", () => {
  it("egy ellentétes sell részlegesen zárja a long pozíciót", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: ZERO_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 150 }));
    const pos = requireTestValue(pt.snapshot().positions[0], "partially closed long position");
    expect(pos.amount).toBe(1);
    // Részleges csökkentés nem írja át a megmaradó long entry árát.
    expect(pos.avgEntryPrice).toBe(100);
    expect(pt.snapshot().cash).toBe(9950);
    expect(pt.snapshot().cash + pos.amount * 150).toBe(10_100);
  });

  it("egy ellentétes sell ami pontosan kiegyenlíti a longot, eltávolítja a pozíciót", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: ZERO_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(sellSignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    const snap = pt.snapshot();
    expect(snap.positions).toEqual([]);
    expect(snap.cash).toBe(10_000);
  });

  it("short részleges covernél megtartja a short entry-t és a cash/equity konzisztens", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, { initialBalanceQuote: 10_000, fee: ZERO_FEE });
    await pt.executeSignal(sellSignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 50 }));
    const snap = pt.snapshot();
    const pos = requireTestValue(snap.positions[0], "partially covered short position");
    expect(pos.side).toBe("short");
    expect(pos.amount).toBe(1);
    expect(pos.avgEntryPrice).toBe(100);
    expect(snap.cash).toBe(10_150);
    // cash + signed inventory at the current mark = 10_100 (50 realized gain).
    expect(snap.cash - pos.amount * 50).toBe(10_100);
  });

  it("long -> short reversalnál csak a maradék kap új entry árat", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, { initialBalanceQuote: 10_000, fee: ZERO_FEE });
    await pt.executeSignal(buySignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(sellSignal({ suggestedAmount: 3, suggestedPrice: 150 }));
    const snap = pt.snapshot();
    const pos = requireTestValue(snap.positions[0], "long-to-short reversal position");
    expect(pos.side).toBe("short");
    expect(pos.amount).toBe(1);
    expect(pos.avgEntryPrice).toBe(150);
    expect(snap.cash).toBe(10_250);
    expect(snap.cash - pos.amount * 150).toBe(10_100);
  });

  it("short -> long reversalnál csak a maradék kap új entry árat", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, { initialBalanceQuote: 10_000, fee: ZERO_FEE });
    await pt.executeSignal(sellSignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(buySignal({ suggestedAmount: 3, suggestedPrice: 50 }));
    const snap = pt.snapshot();
    const pos = requireTestValue(snap.positions[0], "short-to-long reversal position");
    expect(pos.side).toBe("long");
    expect(pos.amount).toBe(1);
    expect(pos.avgEntryPrice).toBe(50);
    expect(snap.cash).toBe(10_050);
    expect(snap.cash + pos.amount * 50).toBe(10_100);
  });

  it("long -> short reversal nem nulla díjnál is megőrzi a cash/equity invariánst", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, { initialBalanceQuote: 10_000, fee: DEFAULT_FEE });
    await pt.executeSignal(buySignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(sellSignal({ suggestedAmount: 3, suggestedPrice: 150 }));
    const snap = pt.snapshot();
    const pos = requireTestValue(snap.positions[0], "fee-bearing long-to-short reversal position");
    expect(pos.side).toBe("short");
    expect(pos.amount).toBe(1);
    expect(pos.avgEntryPrice).toBe(150);
    // 10_000 - 200 - 0.20 + 450 - 0.45
    expect(snap.cash).toBeCloseTo(10_249.35, 8);
    // Gross realized PnL 100, total fees 0.65.
    expect(snap.cash - pos.amount * 150).toBeCloseTo(10_099.35, 8);
  });

  it("short -> long reversal nem nulla díjnál is megőrzi a cash/equity invariánst", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, { initialBalanceQuote: 10_000, fee: DEFAULT_FEE });
    await pt.executeSignal(sellSignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(buySignal({ suggestedAmount: 3, suggestedPrice: 50 }));
    const snap = pt.snapshot();
    const pos = requireTestValue(snap.positions[0], "fee-bearing short-to-long reversal position");
    expect(pos.side).toBe("long");
    expect(pos.amount).toBe(1);
    expect(pos.avgEntryPrice).toBe(50);
    // 10_000 + 200 - 0.20 - 150 - 0.15
    expect(snap.cash).toBeCloseTo(10_049.65, 8);
    // Gross realized PnL 100, total fees 0.35.
    expect(snap.cash + pos.amount * 50).toBeCloseTo(10_099.65, 8);
  });

  it("short teljes covernél a cash visszatér a kezdeti egyenlegre", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, { initialBalanceQuote: 10_000, fee: ZERO_FEE });
    await pt.executeSignal(sellSignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    await pt.executeSignal(buySignal({ suggestedAmount: 2, suggestedPrice: 100 }));
    const snap = pt.snapshot();
    expect(snap.positions).toEqual([]);
    expect(snap.cash).toBe(10_000);
  });
});
