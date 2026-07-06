// packages/core/src/strategy/bollinger-range-squeeze.test.ts — unit tests
// for the Phase 15 M5 Bollinger Band range-squeeze breakout strategy.
//
// Test coverage targets (14 tests):
//   1. Default config (0.020 / 2 / 2.0)
//   2. Custom squeezeThreshold respected
//   3. Custom minConsecutiveSqueezeCandles respected
//   4. Custom atrBreakoutMultiplier respected
//   5. warmup returns 30
//   6. candleIndex < warmup → null
//   7. Missing BB data → null
//   8. Missing ATR data → null
//   9. bbMiddle <= 0 → null (avoid division-by-zero degenerate)
//  10. bbWidth below threshold → state counter increments, no signal yet
//  11. ≥2 consecutive squeeze + close > bbUpper → LONG breakout
//  12. ≥2 consecutive squeeze + close < bbLower → SHORT breakout
//  13. Single squeeze candle (then exits) → no breakout signal
//  14. Squeeze counter resets when bbWidth >= threshold (post-breakout)
//  15. name + timeframes wired correctly for M5 LTF

import { describe, expect, it } from "bun:test";

import {
  BollingerRangeSqueezeStrategy,
  DEFAULT_BB_SQUEEZE_CONFIG,
} from "./bollinger-range-squeeze.js";
import type { StrategyContext } from "../types.js";
import type { Candle, Symbol, Timeframe } from "@mm-crypto-bot/shared/types";

const makeCandle = (close: number, opts: { timestamp: number } = { timestamp: 1_700_000_000_000 }): Candle => ({
  timestamp: opts.timestamp,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume: 1000,
});

const baseCtx = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
  symbol: "BTC/USDT" as unknown as Symbol,
  timeframe: "5m" as Timeframe,
  candleIndex: 100,
  candle: makeCandle(100),
  mtfState: {
    htf: {},
    mtf: {},
    ltf: {},
  },
  pricePrecision: 2,
  ...overrides,
});

/**
 * `pumpCandles` — drive N candles through the strategy. Each candle has
 * a bbMiddle-centered Bollinger configuration: bbUpper = bbMiddle + band,
 * bbLower = bbMiddle - band. The `bbWidth` of every candle is the same
 * (computed from band / bbMiddle).
 */
function pumpCandles(
  strat: BollingerRangeSqueezeStrategy,
  candles: { close: number; bbWidth?: number; atr?: number }[],
  ctxOverrides: Partial<StrategyContext> = {},
  startCandleIndex = 100,
): void {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    // bbWidth defaults to 0.01 (1% normalized band width) — clearly
    // below the 0.020 squeeze threshold so the fixture is in-squeeze
    // unless overridden.
    const targetBbWidth = c.bbWidth ?? 0.01;
    const atr = c.atr ?? 1.0;
    const bbMiddle = 100;
    // bbWidth = (bbUpper - bbLower) / bbMiddle → bbUpper - bbLower = bbWidth * bbMiddle.
    // Pick band = (bbWidth * bbMiddle) / 2 — symmetrical around the middle.
    const band = (targetBbWidth * bbMiddle) / 2;
    const bbUpper = bbMiddle + band;
    const bbLower = bbMiddle - band;
    strat.onCandle(
      baseCtx({
        candleIndex: startCandleIndex + i,
        candle: makeCandle(c.close, { timestamp: 1_700_000_000_000 + i * 5 * 60 * 1000 }),
        mtfState: {
          htf: {},
          mtf: { bbUpper, bbLower, bbMiddle },
          ltf: { atr },
        },
        ...ctxOverrides,
      }),
    );
  }
}

describe("BollingerRangeSqueezeStrategy — default config & warmup", () => {
  it("1. default config has squeezeThreshold=0.020, minConsecutive=2, atrMult=2.0", () => {
    expect(DEFAULT_BB_SQUEEZE_CONFIG.squeezeThreshold).toBe(0.020);
    expect(DEFAULT_BB_SQUEEZE_CONFIG.minConsecutiveSqueezeCandles).toBe(2);
    expect(DEFAULT_BB_SQUEEZE_CONFIG.atrBreakoutMultiplier).toBe(2.0);
  });

  it("2. custom squeezeThreshold persists via Partial<Config> spread", () => {
    const strat = new BollingerRangeSqueezeStrategy({ squeezeThreshold: 0.015 });
    expect(strat.config.squeezeThreshold).toBe(0.015);
    expect(strat.config.minConsecutiveSqueezeCandles).toBe(2);
    expect(strat.config.atrBreakoutMultiplier).toBe(2.0);
  });

  it("3. custom minConsecutiveSqueezeCandles persists", () => {
    const strat = new BollingerRangeSqueezeStrategy({ minConsecutiveSqueezeCandles: 3 });
    expect(strat.config.minConsecutiveSqueezeCandles).toBe(3);
  });

  it("4. custom atrBreakoutMultiplier persists", () => {
    const strat = new BollingerRangeSqueezeStrategy({ atrBreakoutMultiplier: 1.5 });
    expect(strat.config.atrBreakoutMultiplier).toBe(1.5);
  });

  it("5. warmup returns 30 M5 candles (BB(20, 2σ) 1h + buffer)", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    expect(strat.warmup()).toBe(30);
  });

  it("6. candleIndex < warmup → null (engine warmup gate)", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    const ctx = baseCtx({
      candleIndex: 20,
      mtfState: { htf: {}, mtf: { bbUpper: 101, bbLower: 99, bbMiddle: 100 }, ltf: { atr: 1.0 } },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });
});

describe("BollingerRangeSqueezeStrategy — required indicator gating", () => {
  it("7. missing MTF BB values → null signal", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    const ctx = baseCtx({
      candleIndex: 100,
      mtfState: { htf: {}, mtf: {}, ltf: { atr: 1.0 } },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("8. missing LTF ATR → null signal (can't size the breakout TP)", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    const ctx = baseCtx({
      candleIndex: 100,
      mtfState: { htf: {}, mtf: { bbUpper: 101, bbLower: 99, bbMiddle: 100 }, ltf: {} },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("9. LTF ATR = 0 (degenerate) → null signal", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    const ctx = baseCtx({
      candleIndex: 100,
      mtfState: { htf: {}, mtf: { bbUpper: 101, bbLower: 99, bbMiddle: 100 }, ltf: { atr: 0 } },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("10. bbMiddle <= 0 (degenerate, division-by-zero guard) → null signal", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    const ctx = baseCtx({
      candleIndex: 100,
      mtfState: { htf: {}, mtf: { bbUpper: 1, bbLower: -1, bbMiddle: 0 }, ltf: { atr: 1.0 } },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });
});

describe("BollingerRangeSqueezeStrategy — squeeze detection & breakout", () => {
  it("11. bbWidth < threshold increments counter but no signal yet (need 2 consecutive)", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    // First candle (in squeeze, no previous count): no breakout possible.
    const first = strat.onCandle(
      baseCtx({
        candleIndex: 100,
        candle: makeCandle(100, { timestamp: 1_700_000_000_000 }),
        mtfState: { htf: {}, mtf: { bbUpper: 100.5, bbLower: 99.5, bbMiddle: 100 }, ltf: { atr: 1.0 } },
      }),
    );
    expect(first).toBeNull();
    expect(strat.state.squeezeCandles).toBe(1);

    // Second candle (still in squeeze, count reaches minConsecutive=2,
    // but close is INSIDE the band → no breakout yet).
    const second = strat.onCandle(
      baseCtx({
        candleIndex: 101,
        candle: makeCandle(100, { timestamp: 1_700_000_300_000 }),
        mtfState: { htf: {}, mtf: { bbUpper: 100.5, bbLower: 99.5, bbMiddle: 100 }, ltf: { atr: 1.0 } },
      }),
    );
    expect(second).toBeNull();
    expect(strat.state.squeezeCandles).toBe(2);
  });

  it("12. ≥2 consecutive squeeze + close > bbUpper → LONG breakout", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    // Pump 2 squeeze candles (in-squeeze, close in band), then 1 with close > bbUpper.
    // bbMiddle=100, bbWidth=0.01 → bbUpper=100.5, bbLower=99.5.
    pumpCandles(strat, [
      { close: 100 }, // in squeeze (count → 1)
      { close: 100 }, // in squeeze (count → 2)
    ]);
    expect(strat.state.squeezeCandles).toBe(2);

    // Breakout candle — close=101.5 > bbUpper=100.5, ATR=2.0.
    const signal = strat.onCandle(
      baseCtx({
        candleIndex: 200,
        candle: makeCandle(101.5, { timestamp: 1_700_001_000_000 }),
        mtfState: {
          htf: {},
          mtf: { bbUpper: 100.5, bbLower: 99.5, bbMiddle: 100 },
          ltf: { atr: 2.0 },
        },
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(1.0);
    // stopLoss = roundTo(bbMiddle=100, 2) = 100.
    expect(signal?.stopLoss).toBeCloseTo(100, 2);
    // takeProfit = roundTo(bbUpper + 2.0 × 2.0 = 104.5, 2) = 104.5.
    expect(signal?.takeProfit).toBeCloseTo(104.5, 2);
    // Counter resets to 0 after breakout.
    expect(strat.state.squeezeCandles).toBe(0);
  });

  it("13. ≥2 consecutive squeeze + close < bbLower → SHORT breakout", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    pumpCandles(strat, [
      { close: 100 }, // in squeeze (count → 1)
      { close: 100 }, // in squeeze (count → 2)
    ]);
    expect(strat.state.squeezeCandles).toBe(2);

    // Breakout candle — close=98.5 < bbLower=99.5, ATR=2.0.
    const signal = strat.onCandle(
      baseCtx({
        candleIndex: 200,
        candle: makeCandle(98.5, { timestamp: 1_700_001_000_000 }),
        mtfState: {
          htf: {},
          mtf: { bbUpper: 100.5, bbLower: 99.5, bbMiddle: 100 },
          ltf: { atr: 2.0 },
        },
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    expect(signal?.confidence).toBe(1.0);
    // SL = roundTo(bbMiddle=100, 2) = 100.
    expect(signal?.stopLoss).toBeCloseTo(100, 2);
    // TP = roundTo(bbLower - 2.0 × 2.0 = 95.5, 2) = 95.5.
    expect(signal?.takeProfit).toBeCloseTo(95.5, 2);
    expect(strat.state.squeezeCandles).toBe(0);
  });

  it("14. single squeeze candle (then exits) → no breakout signal", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    // One squeeze candle (count = 1), then one wide candle (count → 0).
    pumpCandles(strat, [
      { close: 100 }, // in squeeze (count → 1)
      { close: 100, bbWidth: 0.05 }, // wide band (count → 0)
    ]);
    expect(strat.state.squeezeCandles).toBe(0);

    // A "breakout" candle — close > bbUpper — but the count is 0, so no signal.
    const signal = strat.onCandle(
      baseCtx({
        candleIndex: 200,
        candle: makeCandle(105, { timestamp: 1_700_001_000_000 }),
        mtfState: {
          htf: {},
          mtf: { bbUpper: 100.5, bbLower: 99.5, bbMiddle: 100 },
          ltf: { atr: 2.0 },
        },
      }),
    );
    expect(signal).toBeNull();
  });

  it("15. squeeze counter resets when bbWidth >= threshold (between breakouts)", () => {
    const strat = new BollingerRangeSqueezeStrategy({ minConsecutiveSqueezeCandles: 2 });
    // Build up 2 squeeze candles, then a wide candle resets to 0.
    pumpCandles(strat, [
      { close: 100 }, // in squeeze (count → 1)
      { close: 100 }, // in squeeze (count → 2)
      { close: 100, bbWidth: 0.05 }, // wide (count → 0)
    ]);
    expect(strat.state.squeezeCandles).toBe(0);

    // Now build 2 NEW squeeze candles and trigger a breakout.
    pumpCandles(strat, [
      { close: 100, bbWidth: 0.01 }, // in squeeze (count → 1)
      { close: 100, bbWidth: 0.01 }, // in squeeze (count → 2)
    ]);
    const signal = strat.onCandle(
      baseCtx({
        candleIndex: 300,
        candle: makeCandle(101.5, { timestamp: 1_700_002_000_000 }),
        mtfState: {
          htf: {},
          mtf: { bbUpper: 100.5, bbLower: 99.5, bbMiddle: 100 },
          ltf: { atr: 2.0 },
        },
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
  });
});

describe("BollingerRangeSqueezeStrategy — strategy surface", () => {
  it("16. name and timeframes are wired correctly for M5 LTF", () => {
    const strat = new BollingerRangeSqueezeStrategy();
    expect(strat.name).toContain("Bollinger Range Squeeze");
    expect(strat.timeframes).toEqual(["1h", "5m"]);
  });
});
