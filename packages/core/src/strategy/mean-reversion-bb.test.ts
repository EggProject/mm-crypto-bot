// packages/core/src/strategy/mean-reversion-bb.test.ts — unit tesztek

import { describe, expect, it } from "bun:test";

import { MeanReversionBbStrategy, DEFAULT_MR_CONFIG } from "./mean-reversion-bb.js";
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
  candleIndex: 200,
  candle: baseCandle(100),
  mtfState: {
    htf: {},
    mtf: {},
    ltf: {},
  },
  pricePrecision: 2,
  ...overrides,
});

describe("MeanReversionBbStrategy", () => {
  it("default config is 1% stop loss", () => {
    expect(DEFAULT_MR_CONFIG.stopLossPct).toBe(0.01);
  });

  it("warmup returns 96 (24 + buffer for MTF BB(20, 2σ) on 4h)", () => {
    const strat = new MeanReversionBbStrategy();
    expect(strat.warmup()).toBe(96);
  });

  it("warmup gyertyáin nincs jelzés", () => {
    const strat = new MeanReversionBbStrategy();
    const ctx = makeCtx({ candleIndex: 50 });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("LTF close <= MTF bbLower → long jelzés, target = bbMiddle, stop = entry * 0.99", () => {
    const strat = new MeanReversionBbStrategy();
    const ctx = makeCtx({
      candle: baseCandle(95),
      mtfState: {
        htf: {},
        mtf: {
          bbLower: 96,
          bbUpper: 110,
          bbMiddle: 103,
          adx: 20,
        },
        ltf: {},
      },
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.stopLoss).toBeCloseTo(95 * 0.99, 2); // 94.05
    expect(signal?.takeProfit).toBe(103);
  });

  it("LTF close >= MTF bbUpper → short jelzés", () => {
    const strat = new MeanReversionBbStrategy();
    const ctx = makeCtx({
      candle: baseCandle(111),
      mtfState: {
        htf: {},
        mtf: {
          bbLower: 96,
          bbUpper: 110,
          bbMiddle: 103,
          adx: 20,
        },
        ltf: {},
      },
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    expect(signal?.stopLoss).toBeCloseTo(111 * 1.01, 2); // 112.11
    expect(signal?.takeProfit).toBe(103);
  });

  it("középzónában → nincs jelzés", () => {
    const strat = new MeanReversionBbStrategy();
    const ctx = makeCtx({
      candle: baseCandle(103),
      mtfState: {
        htf: {},
        mtf: { bbLower: 96, bbUpper: 110, bbMiddle: 103, adx: 20 },
        ltf: {},
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("ADX > 35 esetén a stratégia visszavonul (erős trend)", () => {
    const strat = new MeanReversionBbStrategy();
    const ctx = makeCtx({
      candle: baseCandle(95),
      mtfState: {
        htf: {},
        mtf: { bbLower: 96, bbUpper: 110, bbMiddle: 103, adx: 40 },
        ltf: {},
      },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("hiányzó BB adatok esetén nincs jelzés", () => {
    const strat = new MeanReversionBbStrategy();
    const ctx = makeCtx({
      candle: baseCandle(95),
      mtfState: { htf: {}, mtf: {}, ltf: {} },
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });
});
