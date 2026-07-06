// packages/core/src/strategy/donchian-range-channel.test.ts — unit tests
//
// Phase 15 Track C retail-family coverage. Mirror the mean-reversion-bb
// test layout (baseCandle + makeCtx helpers) so the test surface stays
// consistent across the retail family.

import { describe, expect, it } from "bun:test";

import {
  DEFAULT_DONCHIAN_RANGE_CONFIG,
  DonchianRangeChannelStrategy,
} from "./donchian-range-channel.js";
import type { StrategyContext } from "../types.js";

const baseCandle = (close: number) => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume: 1000,
});

type DonchianCtxOverrides = Partial<StrategyContext> & {
  readonly htfDonchianUpper?: number | undefined;
  readonly htfDonchianLower?: number | undefined;
  readonly htfAdx?: number | undefined;
  readonly ltfAtr?: number | undefined;
};

const makeCtx = (overrides: DonchianCtxOverrides = {}): StrategyContext => {
  const {
    htfDonchianUpper,
    htfDonchianLower,
    htfAdx,
    ltfAtr,
    ...rest
  } = overrides;
  const htf: { donchianUpper?: number; donchianLower?: number; adx?: number } =
    {};
  if (htfDonchianUpper !== undefined) htf.donchianUpper = htfDonchianUpper;
  if (htfDonchianLower !== undefined) htf.donchianLower = htfDonchianLower;
  if (htfAdx !== undefined) htf.adx = htfAdx;
  const ltf: { atr?: number } = {};
  if (ltfAtr !== undefined) ltf.atr = ltfAtr;
  return {
    symbol: "BTC/USDT" as never,
    timeframe: "15m",
    candleIndex: 200,
    candle: baseCandle(100),
    pricePrecision: 2,
    ...rest,
    mtfState: { htf, mtf: {}, ltf },
  };
};

describe("DonchianRangeChannelStrategy", () => {
  it("default config is donchianPeriod=20, adxTrendThreshold=25", () => {
    expect(DEFAULT_DONCHIAN_RANGE_CONFIG.donchianPeriod).toBe(20);
    expect(DEFAULT_DONCHIAN_RANGE_CONFIG.adxTrendThreshold).toBe(25);
  });

  it("constructor copies default config when no overrides are passed", () => {
    const strat = new DonchianRangeChannelStrategy();
    expect(strat.config).toEqual(DEFAULT_DONCHIAN_RANGE_CONFIG);
  });

  it("constructor applies partial overrides on top of defaults", () => {
    const strat = new DonchianRangeChannelStrategy({ adxTrendThreshold: 30 });
    expect(strat.config.adxTrendThreshold).toBe(30);
    expect(strat.config.donchianPeriod).toBe(20);
  });

  it("warmup returns 30 (≈7.5h of M15 candles)", () => {
    const strat = new DonchianRangeChannelStrategy();
    expect(strat.warmup()).toBe(30);
  });

  it("warmup candles return null (no signal until index >= 30)", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candleIndex: 5,
      candle: baseCandle(80),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 20,
      ltfAtr: 2,
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("LTF close ≤ DonchianLower and ADX < 25 → long signal (SL=lower-atr, TP=upper)", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(89), // ≤ lower (90)
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 20,
      ltfAtr: 3,
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(1);
    expect(signal?.stopLoss).toBeCloseTo(90 - 3, 2); // 87
    expect(signal?.takeProfit).toBeCloseTo(110, 2);
  });

  it("LTF close ≥ DonchianUpper and ADX < 25 → short signal (SL=upper+atr, TP=lower)", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(111), // ≥ upper (110)
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 20,
      ltfAtr: 3,
    });
    const signal = strat.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    expect(signal?.confidence).toBe(1);
    expect(signal?.stopLoss).toBeCloseTo(110 + 3, 2); // 113
    expect(signal?.takeProfit).toBeCloseTo(90, 2);
  });

  it("LTF close === DonchianLower exactly → long signal (≤ boundary is inclusive)", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(90),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 20,
      ltfAtr: 2,
    });
    const signal = strat.onCandle(ctx);
    expect(signal?.side).toBe("buy");
  });

  it("LTF close === DonchianUpper exactly → short signal (≥ boundary is inclusive)", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(110),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 20,
      ltfAtr: 2,
    });
    const signal = strat.onCandle(ctx);
    expect(signal?.side).toBe("sell");
  });

  it("middle zone (lower < close < upper) → no signal", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(100), // between 90 and 110
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 20,
      ltfAtr: 2,
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("ADX > 25 (trending regime) → no signal even at the lower rail", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(89),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 30,
      ltfAtr: 2,
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("ADX exactly 25 (threshold) → no signal (strict > comparison)", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(89),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 25, // boundary value — skipped
      ltfAtr: 2,
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("ADX undefined → trend filter is skipped (code falls through, range fires)", () => {
    // The trend-filter check guards on `htf.adx !== undefined`, so an
    // undefined ADX does NOT silently shut the strategy off. This test
    // pins that behavior so a future refactor that flips the guard does
    // not regress to a no-op during the ADX warmup window.
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(89),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      ltfAtr: 2,
    });
    expect(strat.onCandle(ctx)?.side).toBe("buy");
  });

  it("missing Donchian upper → no signal", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(89),
      htfDonchianUpper: undefined,
      htfDonchianLower: 90,
      htfAdx: 20,
      ltfAtr: 2,
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("missing Donchian lower → no signal", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(111),
      htfDonchianUpper: 110,
      htfDonchianLower: undefined,
      htfAdx: 20,
      ltfAtr: 2,
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("missing LTF ATR → no signal (cannot compute stop distance)", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(89),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 20,
      ltfAtr: undefined,
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("custom adxTrendThreshold=30 admits ADX=25 but skips ADX=31", () => {
    const strat = new DonchianRangeChannelStrategy({ adxTrendThreshold: 30 });
    const lowAdxCtx = makeCtx({
      candle: baseCandle(89),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 25, // below the new 30 threshold → fires
      ltfAtr: 2,
    });
    expect(strat.onCandle(lowAdxCtx)?.side).toBe("buy");

    const highAdxCtx = makeCtx({
      candle: baseCandle(89),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 31, // above 30 → skipped
      ltfAtr: 2,
    });
    expect(strat.onCandle(highAdxCtx)).toBeNull();
  });

  it("timeframes field reports ['1d', '15m'] in that order", () => {
    const strat = new DonchianRangeChannelStrategy();
    expect(strat.timeframes).toEqual(["1d", "15m"]);
  });

  it("reason string includes close, Donchian rail, ADX, and ATR for debug", () => {
    const strat = new DonchianRangeChannelStrategy();
    const ctx = makeCtx({
      candle: baseCandle(89),
      htfDonchianUpper: 110,
      htfDonchianLower: 90,
      htfAdx: 20,
      ltfAtr: 3,
    });
    const signal = strat.onCandle(ctx);
    expect(signal?.reason).toContain("89.00");
    expect(signal?.reason).toContain("90.00");
    expect(signal?.reason).toContain("ADX=20.00");
    expect(signal?.reason).toContain("ATR(14)=3.00");
  });
});
