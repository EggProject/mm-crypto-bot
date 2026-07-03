// packages/core/src/strategy/always-in-trend.test.ts — unit tesztek

import { describe, expect, it } from "bun:test";

import { AlwaysInTrendStrategy, DEFAULT_ALWAYSIN_CONFIG } from "./always-in-trend.js";
import type { StrategyContext } from "../types.js";

const baseCandle = (close: number) => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume: 1000,
});

const makeCtx = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
  symbol: "BTC/USDT" as never,
  timeframe: "1h",
  candleIndex: 300,
  candle: baseCandle(100),
  mtfState: {
    htf: {},
    mtf: {},
    ltf: {},
  },
  pricePrecision: 2,
  ...overrides,
});

describe("AlwaysInTrendStrategy", () => {
  it("default config has 3.0× stop, 20× TP ATR multiples", () => {
    expect(DEFAULT_ALWAYSIN_CONFIG.stopAtrMultiplier).toBe(3.0);
    expect(DEFAULT_ALWAYSIN_CONFIG.tpAtrMultiplier).toBe(20.0);
    expect(DEFAULT_ALWAYSIN_CONFIG.minEmaGapPct).toBe(0.001);
  });

  it("warmup returns 250 (EMA200 needs ~200 LTF candles + buffer)", () => {
    const strat = new AlwaysInTrendStrategy();
    expect(strat.warmup()).toBe(250);
  });

  it("candleIndex < warmup → null signal", () => {
    const strat = new AlwaysInTrendStrategy();
    const ctx = makeCtx({ candleIndex: 100 });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("HTF EMA50 > EMA200 (uptrend) → LONG signal", () => {
    const strat = new AlwaysInTrendStrategy();
    const ctx = makeCtx({
      candle: baseCandle(100),
      mtfState: {
        htf: { ema50: 105, ema200: 100 },
        mtf: {},
        ltf: { atr: 2.0 },
      },
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    // stop = 100 - 2*3 = 94
    expect(signal?.stopLoss).toBeCloseTo(94, 0);
    // TP = 100 + 2*20 = 140 (very wide for always-in)
    expect(signal?.takeProfit).toBeCloseTo(140, 0);
    expect(signal?.reason).toContain("Always-in LONG");
    expect(signal?.reason).toContain("gap=");
  });

  it("HTF EMA50 < EMA200 (downtrend) → SHORT signal", () => {
    const strat = new AlwaysInTrendStrategy();
    const ctx = makeCtx({
      candle: baseCandle(100),
      mtfState: {
        htf: { ema50: 95, ema200: 100 },
        mtf: {},
        ltf: { atr: 2.0 },
      },
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    // stop = 100 + 2*3 = 106
    expect(signal?.stopLoss).toBeCloseTo(106, 0);
    // TP = 100 - 2*20 = 60 (very wide)
    expect(signal?.takeProfit).toBeCloseTo(60, 0);
    expect(signal?.reason).toContain("Always-in SHORT");
  });

  it("HTF EMA50 ≈ EMA200 (within minEmaGapPct) → null signal (transition)", () => {
    const strat = new AlwaysInTrendStrategy();
    const ctx = makeCtx({
      candle: baseCandle(100),
      mtfState: {
        // 0.0005 gap, below minEmaGapPct=0.001
        htf: { ema50: 100.05, ema200: 100 },
        mtf: {},
        ltf: { atr: 2.0 },
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("missing HTF ema50 → null signal", () => {
    const strat = new AlwaysInTrendStrategy();
    const ctx = makeCtx({
      mtfState: {
        htf: { ema200: 100 },
        mtf: {},
        ltf: { atr: 2.0 },
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("missing HTF ema200 → null signal", () => {
    const strat = new AlwaysInTrendStrategy();
    const ctx = makeCtx({
      mtfState: {
        htf: { ema50: 105 },
        mtf: {},
        ltf: { atr: 2.0 },
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("missing LTF atr → null signal", () => {
    const strat = new AlwaysInTrendStrategy();
    const ctx = makeCtx({
      mtfState: {
        htf: { ema50: 105, ema200: 100 },
        mtf: {},
        ltf: {},
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("LTF atr = 0 (degenerate) → null signal", () => {
    const strat = new AlwaysInTrendStrategy();
    const ctx = makeCtx({
      mtfState: {
        htf: { ema50: 105, ema200: 100 },
        mtf: {},
        ltf: { atr: 0 },
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("custom config multipliers apply correctly", () => {
    const strat = new AlwaysInTrendStrategy({
      stopAtrMultiplier: 2.0,
      tpAtrMultiplier: 10.0,
      minEmaGapPct: 0.01,
    });
    const ctx = makeCtx({
      candle: baseCandle(200),
      mtfState: {
        htf: { ema50: 105, ema200: 100 },
        mtf: {},
        ltf: { atr: 5.0 },
      },
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    // stop = 200 - 5*2 = 190
    expect(signal?.stopLoss).toBeCloseTo(190, 0);
    // TP = 200 + 5*10 = 250
    expect(signal?.takeProfit).toBeCloseTo(250, 0);
  });

  it("name and timeframes are correctly set", () => {
    const strat = new AlwaysInTrendStrategy();
    expect(strat.name).toContain("Always-In");
    expect(strat.timeframes).toEqual(["1d", "4h", "1h"]);
  });
});
