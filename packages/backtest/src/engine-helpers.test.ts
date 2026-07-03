// packages/backtest/src/engine-helpers.test.ts — a backtest motor helper függvényeinek
// unit-tesztek
//
// Ezek a tesztek közvetlenül hívják a `checkExit`, `closePosition` és
// `aggregateToTimeframe` függvényeket, hogy 100%-os coverage-et
// biztosítsanak a trade-kezelési logikán — a `runBacktest` integrációs
// tesztjei kiegészítésére.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import type { CostModel } from "./types.js";

import { aggregateToTimeframe, checkExit, closePosition, type OpenPosition } from "./engine.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
};

function mkCandle(timestamp: number, price: number, opts?: { high?: number; low?: number }): Candle {
  return {
    timestamp,
    open: price,
    high: opts?.high ?? price * 1.01,
    low: opts?.low ?? price * 0.99,
    close: price,
    volume: 1000,
  };
}

function mkLongPosition(entryTime: number, entryPrice: number): OpenPosition {
  return {
    symbol: "BTC/USDC" as never,
    side: "buy",
    entryTime,
    entryPrice,
    quantity: 10, // 10 BTC
    notionalUsd: 1000, // 10 * 100 = 1000
    marginNotional: 1000,
    stopLoss: entryPrice * 0.97, // 3% stop
    takeProfit: entryPrice * 1.1, // 10% TP
    entryFee: 1,
    entryReason: "test",
  };
}

function mkShortPosition(entryTime: number, entryPrice: number): OpenPosition {
  return {
    symbol: "BTC/USDC" as never,
    side: "sell",
    entryTime,
    entryPrice,
    quantity: 10, // 10 BTC
    notionalUsd: 1000, // 10 * 100 = 1000
    marginNotional: 1000,
    stopLoss: entryPrice * 1.03, // 3% stop
    takeProfit: entryPrice * 0.9, // 10% TP
    entryFee: 1,
    entryReason: "test",
  };
}

describe("aggregateToTimeframe", () => {
  it("üres candle-listára üres tömböt ad", () => {
    expect(aggregateToTimeframe([], HOUR_MS)).toEqual([]);
  });

  it("negatív vagy 0 targetMs esetén üres tömböt ad", () => {
    expect(aggregateToTimeframe([mkCandle(0, 100)], 0)).toEqual([]);
    expect(aggregateToTimeframe([mkCandle(0, 100)], -1)).toEqual([]);
  });

  it("24 darab 1H candle-t 1 db 1D candle-re aggregál", () => {
    const candles: Candle[] = [];
    for (let h = 0; h < 24; h++) {
      candles.push(mkCandle(h * HOUR_MS, 100 + h));
    }
    const result = aggregateToTimeframe(candles, DAY_MS);
    expect(result.length).toBe(1);
    expect(result[0]!.close).toBe(123);
    expect(result[0]!.open).toBe(100);
  });

  it("48 darab 1H candle-t 2 db 1D candle-re aggregál", () => {
    const candles: Candle[] = [];
    for (let h = 0; h < 48; h++) {
      candles.push(mkCandle(h * HOUR_MS, 100 + h));
    }
    const result = aggregateToTimeframe(candles, DAY_MS);
    expect(result.length).toBe(2);
    expect(result[0]!.close).toBe(123);
    expect(result[1]!.close).toBe(147);
  });

  it("a high a max, a low a min az ablakban", () => {
    const candles = [
      mkCandle(0, 100, { high: 105, low: 95 }),
      mkCandle(HOUR_MS, 110, { high: 115, low: 100 }),
      mkCandle(2 * HOUR_MS, 108, { high: 120, low: 90 }),
    ];
    const result = aggregateToTimeframe(candles, DAY_MS);
    expect(result[0]!.high).toBe(120);
    expect(result[0]!.low).toBe(90);
  });

  it("a volume összeadódik", () => {
    const candles: Candle[] = [];
    for (let h = 0; h < 5; h++) {
      candles.push({ ...mkCandle(h * HOUR_MS, 100), volume: 100 + h });
    }
    const result = aggregateToTimeframe(candles, DAY_MS);
    expect(result[0]!.volume).toBe(100 + 101 + 102 + 103 + 104);
  });

  it("új bucket kezdése: a c.timestamp pontosan bucketEnd-nél van", () => {
    // A 25. candle pontosan a második nap elején van.
    const candles: Candle[] = [];
    for (let h = 0; h < 24; h++) {
      candles.push(mkCandle(h * HOUR_MS, 100 + h));
    }
    candles.push(mkCandle(24 * HOUR_MS, 200));
    candles.push(mkCandle(25 * HOUR_MS, 210));
    const result = aggregateToTimeframe(candles, DAY_MS);
    expect(result.length).toBe(2);
    expect(result[0]!.close).toBe(123);
    expect(result[1]!.close).toBe(210);
  });

  it("az első candle a bucket határán: bucket = null ág is lefut", () => {
    // Az első candle pontosan a bucket határán van (timestamp = DAY_MS).
    // Ez a bucket === null false ágat triggereli (63. sor).
    const candles: Candle[] = [];
    candles.push(mkCandle(DAY_MS, 100));
    candles.push(mkCandle(DAY_MS + HOUR_MS, 110));
    const result = aggregateToTimeframe(candles, DAY_MS);
    expect(result.length).toBe(1);
    expect(result[0]!.close).toBe(110);
  });
});

describe("checkExit", () => {
  it("long pozíció: stop-loss triggerelődik, ha a candle low eléri a stop-ot", () => {
    const pos = mkLongPosition(0, 100);
    const candle = mkCandle(HOUR_MS, 100, { low: 96.5, high: 105 });
    const result = checkExit(pos, candle, COST_MODEL);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("stop_loss");
  });

  it("long pozíció: take-profit triggerelődik, ha a candle high eléri a TP-t", () => {
    const pos = mkLongPosition(0, 100);
    const candle = mkCandle(HOUR_MS, 105, { low: 102, high: 111 });
    const result = checkExit(pos, candle, COST_MODEL);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("take_profit");
  });

  it("long pozíció: nincs kilépés, ha a candle se a stop-ot, se a TP-t nem éri el", () => {
    const pos = mkLongPosition(0, 100);
    const candle = mkCandle(HOUR_MS, 100, { low: 98, high: 105 });
    const result = checkExit(pos, candle, COST_MODEL);
    expect(result).toBeNull();
  });

  it("short pozíció: stop-loss triggerelődik, ha a candle high eléri a stop-ot", () => {
    const pos = mkShortPosition(0, 100);
    const candle = mkCandle(HOUR_MS, 100, { low: 95, high: 103.5 });
    const result = checkExit(pos, candle, COST_MODEL);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("stop_loss");
  });

  it("short pozíció: take-profit triggerelődik, ha a candle low eléri a TP-t", () => {
    const pos = mkShortPosition(0, 100);
    const candle = mkCandle(HOUR_MS, 95, { low: 89, high: 100 });
    const result = checkExit(pos, candle, COST_MODEL);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("take_profit");
  });

  it("long pozíció: time-exit 72 óra után, ha nyereséges", () => {
    const pos = mkLongPosition(0, 100);
    // 73 óra múlva, a close 105 (5% nyereség).
    const candle = mkCandle(73 * HOUR_MS, 105, { low: 102, high: 108 });
    const result = checkExit(pos, candle, COST_MODEL);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("time_exit");
  });

  it("long pozíció: time-exit 72 óra után NEM triggerelődik, ha veszteséges", () => {
    const pos = mkLongPosition(0, 100);
    // 73 óra múlva, a close 99 (veszteség).
    const candle = mkCandle(73 * HOUR_MS, 99, { low: 98, high: 102 });
    const result = checkExit(pos, candle, COST_MODEL);
    expect(result).toBeNull();
  });

  it("short pozíció: time-exit 72 óra után, ha nyereséges", () => {
    const pos = mkShortPosition(0, 100);
    // 73 óra múlva, a close 95 (5% nyereség).
    const candle = mkCandle(73 * HOUR_MS, 95, { low: 92, high: 98 });
    const result = checkExit(pos, candle, COST_MODEL);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("time_exit");
  });
});

describe("closePosition", () => {
  it("long take-profit exit: pozitív PnL-t ad (a fee-k levonása után)", () => {
    const pos = mkLongPosition(0, 100);
    const candle = mkCandle(HOUR_MS, 110, { low: 109, high: 110.5 });
    const trade = closePosition(pos, candle, { reason: "take_profit", exitPrice: 110 }, COST_MODEL);
    expect(trade.side).toBe("buy");
    expect(trade.exitReason).toBe("take_profit");
    expect(trade.pnlUsd).toBeGreaterThan(0);
    // A fee-k miatt a PnL kisebb, mint a bruttó 100 USD (10 * 0.01 BTC * 110 USD).
    expect(trade.feesUsd).toBeGreaterThan(0);
  });

  it("long stop-loss exit: negatív PnL-t ad", () => {
    const pos = mkLongPosition(0, 100);
    const candle = mkCandle(HOUR_MS, 97, { low: 96.5, high: 99 });
    const trade = closePosition(pos, candle, { reason: "stop_loss", exitPrice: 97 }, COST_MODEL);
    expect(trade.pnlUsd).toBeLessThan(0);
  });

  it("short take-profit exit: pozitív PnL-t ad", () => {
    const pos = mkShortPosition(0, 100);
    const candle = mkCandle(HOUR_MS, 90, { low: 89.5, high: 91 });
    const trade = closePosition(pos, candle, { reason: "take_profit", exitPrice: 90 }, COST_MODEL);
    expect(trade.side).toBe("sell");
    expect(trade.pnlUsd).toBeGreaterThan(0);
  });

  it("a trade entry és exit timestamp-ek helyesek", () => {
    const pos = mkLongPosition(0, 100);
    const candle = mkCandle(2 * HOUR_MS, 110, { low: 109, high: 110.5 });
    const trade = closePosition(pos, candle, { reason: "take_profit", exitPrice: 110 }, COST_MODEL);
    expect(trade.entryTime).toBe(0);
    expect(trade.exitTime).toBe(2 * HOUR_MS);
  });

  it("a trade entryPrice az eredeti entryPrice-rel egyezik", () => {
    const pos = mkLongPosition(0, 100);
    const candle = mkCandle(HOUR_MS, 110, { low: 109, high: 110.5 });
    const trade = closePosition(pos, candle, { reason: "take_profit", exitPrice: 110 }, COST_MODEL);
    expect(trade.entryPrice).toBe(100);
  });

  it("a PnL% a notional %-ában van kifejezve", () => {
    const pos = mkLongPosition(0, 100);
    // notional = 1000, exit + 10% (bruttó 100 USD PnL)
    // fee-k levonva, de nagyságrendileg ~10%
    const candle = mkCandle(HOUR_MS, 110, { low: 109, high: 110.5 });
    const trade = closePosition(pos, candle, { reason: "take_profit", exitPrice: 110 }, COST_MODEL);
    expect(trade.pnlPct).toBeGreaterThan(0.05); // 5% felett a fee-k miatt
    expect(trade.pnlPct).toBeLessThan(0.1);
  });
});
