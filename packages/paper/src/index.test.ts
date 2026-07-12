/**
 * packages/paper/src/index.test.ts
 *
 * A `@mm-crypto-bot/paper` barrel-export tesztje.
 * Ellenőrzi, hogy a `PaperTrader` és a `PaperTraderOptions` típus
 * elérhető a csomag belépési pontján keresztül.
 */

import { describe, expect, it } from "bun:test";
import { PaperTrader } from "./index.js";
import type { PaperTraderOptions } from "./index.js";
import { MockExchangeFeed } from "./test-helpers.js";
import type { ExchangeFeeConfig } from "@mm-crypto-bot/shared";

const FEE: ExchangeFeeConfig = {
  spotTakerFee: 0.001,
  spotMakerFee: 0.001,
  borrowRatePerDay: 0.0002,
  liquidationFee: 0.02,
  maintenanceMarginRatio: 1.0,
};

describe("paper barrel index", () => {
  it("PaperTrader osztály elérhető a barrel-en keresztül", () => {
    expect(typeof PaperTrader).toBe("function");
  });

  it("a PaperTraderOptions típus használható a konstruktorban", () => {
    const opts: PaperTraderOptions = {
      initialBalanceQuote: 1000,
      fee: FEE,
    };
    const feed = new MockExchangeFeed();
    const pt = new PaperTrader(feed, opts);
    expect(pt.snapshot().cash).toBe(1000);
  });

  it("az index.ts re-exportja a PaperTrader-t a paper-trader.js-ből", () => {
    const opts: PaperTraderOptions = {
      initialBalanceQuote: 5000,
      fee: FEE,
      maxHistory: 100,
    };
    const feed = new MockExchangeFeed();
    const pt = new PaperTrader(feed, opts);
    expect(pt).toBeInstanceOf(PaperTrader);
  });
});
