// packages/core/src/strategy/donchian-breakout.test.ts — unit tesztek

import { describe, expect, it } from "bun:test";

import { DonchianBreakoutStrategy, DEFAULT_DONCHIAN_CONFIG } from "./donchian-breakout.js";
import type { StrategyContext } from "../types.js";

const baseCandle = (close: number, volume = 1000) => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume,
});

const makeCtx = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
  symbol: "BTC/USDT" as never,
  timeframe: "1h",
  candleIndex: 50,
  candle: baseCandle(100),
  mtfState: {
    htf: {},
    mtf: {},
    ltf: {},
  },
  pricePrecision: 2,
  ...overrides,
});

describe("DonchianBreakoutStrategy", () => {
  it("default config has 20-period Donchian, 1.5× volume, 1.5× ATR stop, 4.5× ATR TP, HTF filter on", () => {
    expect(DEFAULT_DONCHIAN_CONFIG.donchianPeriod).toBe(20);
    expect(DEFAULT_DONCHIAN_CONFIG.volumeConfirmMultiplier).toBe(1.5);
    expect(DEFAULT_DONCHIAN_CONFIG.stopAtrMultiplier).toBe(1.5);
    expect(DEFAULT_DONCHIAN_CONFIG.tpAtrMultiplier).toBe(4.5);
    expect(DEFAULT_DONCHIAN_CONFIG.useHtfTrendFilter).toBe(true);
  });

  it("warmup returns 30 (Donchian(20) + volume MA(20) + buffer)", () => {
    const strat = new DonchianBreakoutStrategy();
    expect(strat.warmup()).toBe(30);
  });

  it("candleIndex < warmup → null signal", () => {
    const strat = new DonchianBreakoutStrategy();
    const ctx = makeCtx({ candleIndex: 20 });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("LTF close > Donchian upper + volume confirm → LONG breakout signal (3:1 R:R)", () => {
    const strat = new DonchianBreakoutStrategy();
    const ctx = makeCtx({
      candle: baseCandle(115, 2000), // above upper, volume 2× avg (avg=1000)
      mtfState: {
        htf: {}, mtf: { donchianUpper: 110, donchianLower: 90 },
        ltf: { atr: 2.0, volumeMa: 1000 },
      },
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    // stop = 115 - 2*1.5 = 112
    expect(signal?.stopLoss).toBeCloseTo(112, 0);
    // TP = 115 + 2*4.5 = 124 (3:1 R:R with stop distance 3)
    expect(signal?.takeProfit).toBeCloseTo(124, 0);
    expect(signal?.reason).toContain("Donchian breakout LONG");
  });

  it("LTF close < Donchian lower + volume confirm → SHORT breakout signal", () => {
    const strat = new DonchianBreakoutStrategy();
    const ctx = makeCtx({
      candle: baseCandle(85, 2000), // below lower, high volume
      mtfState: {
        htf: {}, mtf: { donchianUpper: 110, donchianLower: 90 },
        ltf: { atr: 2.0, volumeMa: 1000 },
      },
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    // stop = 85 + 2*1.5 = 88
    expect(signal?.stopLoss).toBeCloseTo(88, 0);
    // TP = 85 - 2*4.5 = 76 (3:1 R:R with stop distance 3)
    expect(signal?.takeProfit).toBeCloseTo(76, 0);
  });

  it("close above upper but volume below threshold → null (no false breakout)", () => {
    const strat = new DonchianBreakoutStrategy();
    const ctx = makeCtx({
      candle: baseCandle(115, 800), // above upper but volume 800 < 1.5×1000=1500
      mtfState: {
        htf: {}, mtf: { donchianUpper: 110, donchianLower: 90 },
        ltf: { atr: 2.0, volumeMa: 1000 },
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("HTF downtrend filter blocks LONG breakout (downtrend-only short)", () => {
    const strat = new DonchianBreakoutStrategy();
    const ctx = makeCtx({
      candle: baseCandle(115, 2000),
      mtfState: {
        htf: { ema50: 95, ema200: 100, donchianUpper: 110, donchianLower: 90 }, // downtrend
        mtf: {},
        ltf: { atr: 2.0, volumeMa: 1000 },
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("HTF uptrend filter blocks SHORT breakout (uptrend-only long)", () => {
    const strat = new DonchianBreakoutStrategy();
    const ctx = makeCtx({
      candle: baseCandle(85, 2000),
      mtfState: {
        htf: { ema50: 105, ema200: 100, donchianUpper: 110, donchianLower: 90 }, // uptrend
        mtf: {},
        ltf: { atr: 2.0, volumeMa: 1000 },
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("HTF filter OFF (config) allows both directions regardless of trend", () => {
    const strat = new DonchianBreakoutStrategy({ useHtfTrendFilter: false });
    const ctx = makeCtx({
      candle: baseCandle(115, 2000),
      mtfState: {
        htf: { ema50: 95, ema200: 100 }, // downtrend but filter off
        mtf: { donchianUpper: 110, donchianLower: 90 },
        ltf: { atr: 2.0, volumeMa: 1000 },
      },
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
  });

  it("missing Donchian upper → null", () => {
    const strat = new DonchianBreakoutStrategy();
    const ctx = makeCtx({
      candle: baseCandle(85, 2000),
      mtfState: {
        htf: {}, mtf: { donchianLower: 90 }, // missing upper
        ltf: { atr: 2.0, volumeMa: 1000 },
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("missing volumeMa → null (volume filter cannot be evaluated)", () => {
    const strat = new DonchianBreakoutStrategy();
    const ctx = makeCtx({
      candle: baseCandle(115, 2000),
      mtfState: {
        htf: {}, mtf: { donchianUpper: 110, donchianLower: 90 },
        ltf: { atr: 2.0 }, // missing volumeMa
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("name and timeframes are correctly set", () => {
    const strat = new DonchianBreakoutStrategy();
    expect(strat.name).toContain("Donchian");
    expect(strat.timeframes).toEqual(["1d", "4h", "1h"]);
  });
});
