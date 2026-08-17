import { describe, expect, it } from "vitest";
import { PaperTrader } from "./paper-trader.js";
import {
  DEFAULT_FEE,
  buySignal,
  makeFeed,
  requireTestValue,
  sellSignal,
} from "./paper-trader.test-support.js";

async function captureExpectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error("Expected PaperTrader to reject with an Error", { cause: error });
  }
  throw new Error("Expected PaperTrader to reject");
}

describe("paper test support guards", () => {
  it("rejects an absent test value with its description", () => {
    expect(() => {
      requireTestValue(undefined, "required test value");
    }).toThrow("required test value");
  });
});

describe("PaperTrader.executeSignal — fetchTicker hiba", () => {
  it("ha a fetchTicker hibát dob, a hiba továbbdobódik", async () => {
    const feed = makeFeed({
      tickerError: (sym) => new Error(`fetchTicker failed for ${sym}`),
    });
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const sig = buySignal({ suggestedAmount: 0.01, suggestedPrice: 100 });
    const error = await captureExpectedError(pt.executeSignal(sig));
    expect(error.message).toContain("fetchTicker failed for BTC/USDT");
  });
});

describe("PaperTrader — fee számítás", () => {
  it("a fee a cost * feeRate (spotTakerFee)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: { ...DEFAULT_FEE, spotTakerFee: 0.005 }, // 0.5%
    });
    const sig = buySignal({ suggestedAmount: 1, suggestedPrice: 100 });
    const fill = await pt.executeSignal(sig);
    // cost = 100, fee = 100 * 0.005 = 0.5
    expect(requireTestValue(fill, "fee fill").fee).toBeCloseTo(0.5, 6);
    // A feeCurrency "USDT".
    expect(requireTestValue(fill, "fee fill").feeCurrency).toBe("USDT");
  });

  it("a fill mode='paper'", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const fill = await pt.executeSignal(buySignal({ suggestedAmount: 0.1, suggestedPrice: 100 }));
    expect(requireTestValue(fill, "paper-mode fill").mode).toBe("paper");
  });

  it("a fill orderId-t a PaperTrader állítja elő", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const fill = await pt.executeSignal(buySignal({ suggestedAmount: 0.1, suggestedPrice: 100 }));
    expect(requireTestValue(fill, "order-id fill").orderId).toMatch(/^paper-\d+$/);
  });

  it("a fill id-jének formátuma 'fill-...'", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const fill = await pt.executeSignal(buySignal({ suggestedAmount: 0.1, suggestedPrice: 100 }));
    expect(requireTestValue(fill, "fill-id fill").id).toMatch(/^fill-\d+-[a-z0-9]+$/);
  });
});

describe("PaperTrader.snapshot — side / amount leképezés", () => {
  it("long pozíció: amount pozitív, side='long'", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const pos = requireTestValue(pt.snapshot().positions[0], "long snapshot position");
    expect(pos.side).toBe("long");
    expect(pos.amount).toBe(1);
  });

  it("short pozíció: amount pozitív abszolút érték, side='short'", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const pos = requireTestValue(pt.snapshot().positions[0], "short snapshot position");
    expect(pos.side).toBe("short");
    // A belső amount -1 (signed), de a snapshot-ban Math.abs() → 1.
    expect(pos.amount).toBe(1);
  });

  it("a snapshot unrealizedPnl és realizedPnl jelenleg mindig 0 (TODO marker)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const pos = requireTestValue(pt.snapshot().positions[0], "unrealized-PnL snapshot position");
    expect(pos.unrealizedPnl).toBe(0);
    expect(pos.realizedPnl).toBe(0);
  });

  it("a snapshot leverage=1 az új pozícióknál (a PaperTrader jelenleg 1x leverage-et használ)", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    const pos = requireTestValue(pt.snapshot().positions[0], "leverage snapshot position");
    expect(pos.leverage).toBe(1);
  });
});

describe("PaperTrader — openedAt timestamp", () => {
  it("a pozíció openedAt a fill idejéhez közeli timestamp", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    const before = Date.now();
    await pt.executeSignal(buySignal({ suggestedAmount: 0.1, suggestedPrice: 100 }));
    const after = Date.now();
    const pos = requireTestValue(pt.snapshot().positions[0], "opened-at snapshot position");
    expect(pos.openedAt).toBeGreaterThanOrEqual(before);
    expect(pos.openedAt).toBeLessThanOrEqual(after + 5);
  });

  it("egy ellentétes fill, ami nullázza az amount-ot, eltávolítja a pozíciót", async () => {
    const feed = makeFeed();
    const pt = new PaperTrader(feed, {
      initialBalanceQuote: 10_000,
      fee: DEFAULT_FEE,
    });
    await pt.executeSignal(buySignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    await pt.executeSignal(sellSignal({ suggestedAmount: 1, suggestedPrice: 100 }));
    expect(pt.snapshot().positions).toEqual([]);
  });
});
