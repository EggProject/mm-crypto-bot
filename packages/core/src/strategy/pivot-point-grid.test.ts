import { describe, expect, it } from "bun:test";

import { DEFAULT_PIVOT_GRID_CONFIG, PivotPointGridStrategy } from "./pivot-point-grid.js";
import type { StrategySignal } from "../types.js";
import {
  DAY_ZERO_START_MS,
  HTF_MS,
  LTF_MS,
  feedCandles,
  makeCandle,
  makeContext,
} from "./pivot-point-grid.test-support.js";

describe("PivotPointGridStrategy — default config & warmup", () => {
  it("1. default multipliers are 0.382 / 0.618 / 1.000 (classical Fibonacci pivots) + Phase 16 cap 0.04", () => {
    expect(DEFAULT_PIVOT_GRID_CONFIG.multiplierFib1).toBe(0.382);
    expect(DEFAULT_PIVOT_GRID_CONFIG.multiplierFib2).toBe(0.618);
    expect(DEFAULT_PIVOT_GRID_CONFIG.multiplierFib3).toBe(1);
    expect(DEFAULT_PIVOT_GRID_CONFIG.maxPositionPctEquity).toBe(0.04);
  });

  it("2. custom config persists (Partial<Config> spread) — multipliers AND cap", () => {
    const strat = new PivotPointGridStrategy({
      multiplierFib1: 0.5,
      multiplierFib2: 1,
      multiplierFib3: 1.5,
      maxPositionPctEquity: 0.08,
    });
    expect(strat.config.multiplierFib1).toBe(0.5);
    expect(strat.config.multiplierFib2).toBe(1);
    expect(strat.config.multiplierFib3).toBe(1.5);
    expect(strat.config.maxPositionPctEquity).toBe(0.08);
  });

  it("3. warmup returns 100 LTF (15m) candles (24h × 4 + buffer)", () => {
    const strat = new PivotPointGridStrategy();
    expect(strat.warmup()).toBe(100);
  });

  it("4. candleIndex < warmup → undefined signal (engine warmup gate)", () => {
    const strat = new PivotPointGridStrategy();
    const context = makeContext({ candleIndex: 50 });
    strat.onCandleObserved(context);
    expect(strat.committedPrevHtfAtLeastOnce).toBe(false);
    expect(strat.onCandle(context)).toBeUndefined();
  });

  it("5. missing prev HTF data → undefined signal (no committed previous-day candle yet)", () => {
    const strat = new PivotPointGridStrategy();
    // candleIndex is past warmup, but we never cross a 1d boundary,
    // so prev* is still undefined.
    let lastSignal: StrategySignal | undefined;
    for (let index = 0; index < 110; index++) {
      const ts = 1_700_003_500_000 + index * LTF_MS; // intentionally NOT on a 1d boundary
      lastSignal = strat.onCandle(
        makeContext({
          candleIndex: 100 + index,
          candle: makeCandle(100, {
            timestamp: ts,
            open: 100,
            high: 101,
            low: 99,
          }),
        }),
      );
    }
    expect(lastSignal).toBeUndefined();
    expect(strat.committedPrevHtfAtLeastOnce).toBe(false);
  });
});

describe("PivotPointGridStrategy — HTF boundary detection", () => {
  it("6. boundary candle (timestamp % 86_400_000 === 0) commits prev* + resets accumulator", () => {
    const strat = new PivotPointGridStrategy();
    const day0Start = DAY_ZERO_START_MS;
    const day1Boundary = day0Start + HTF_MS;

    // Day 0: 4 candles. Accumulated H/L/C after the 4th candle: H=110, L=90, C=100.
    feedCandles(
      strat,
      [
        { timestamp: day0Start, high: 101, low: 99, close: 100 },
        { timestamp: day0Start + 1 * LTF_MS, high: 110, low: 109, close: 110 },
        { timestamp: day0Start + 2 * LTF_MS, high: 91, low: 90, close: 90 },
        { timestamp: day0Start + 3 * LTF_MS, high: 101, low: 99, close: 100 },
      ],
      100, // post-warmup so boundary detection runs
    );
    // Right before the boundary: no commit yet.
    expect(strat.committedPrevHtfAtLeastOnce).toBe(false);

    // First candle of day 1 (timestamp on the 1d boundary) — commits day 0.
    strat.onCandle(
      makeContext({
        candleIndex: 104,
        candle: makeCandle(102, {
          timestamp: day1Boundary,
          open: 102,
          high: 103,
          low: 101,
        }),
      }),
    );
    expect(strat.committedPrevHtfAtLeastOnce).toBe(true);
  });

  it("7. pivot point recomputes when a new HTF candle rolls up (legacy cap)", () => {
    const strat = new PivotPointGridStrategy({ maxPositionPctEquity: 1 });
    // Tight day-0 range: H=101, L=99, C=100 → PP=100, range=2.
    const day0Start = DAY_ZERO_START_MS;
    const day1Boundary = day0Start + HTF_MS;
    feedCandles(
      strat,
      [
        { timestamp: day0Start, high: 100.5, low: 99.5, close: 100 },
        { timestamp: day0Start + 1 * LTF_MS, high: 101, low: 100, close: 100.5 },
        { timestamp: day0Start + 2 * LTF_MS, high: 100.5, low: 99, close: 100 },
        { timestamp: day0Start + 3 * LTF_MS, high: 100.5, low: 99.5, close: 100 },
      ],
      100,
    );
    strat.onCandle(
      makeContext({
        candleIndex: 104,
        candle: makeCandle(100, { timestamp: day1Boundary, open: 100, high: 100.5, low: 99.5 }),
      }),
    );

    // Tight-range scenario: PP=100, range=2.
    //   R1=100.764, S1=99.236, R2=101.236, S2=98.764, R3=102, S3=98.
    // close=97.5 < S2 (98.764) → deep long, stopLoss=S3=98, TP=PP=100.
    const signal = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(97.5, { timestamp: 1_700_003_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(1);
    expect(signal?.stopLoss).toBeCloseTo(98, 2);
    expect(signal?.takeProfit).toBeCloseTo(100, 2);
  });

  it("8. within-bucket candles extend the running high/low/close (no commit until boundary)", () => {
    const strat = new PivotPointGridStrategy();
    for (let index = 0; index < 10; index++) {
      strat.onCandle(
        makeContext({
          candleIndex: 100 + index,
          candle: makeCandle(100 + index, {
            timestamp: 1_700_001_500_000 + index * LTF_MS, // not on a 1d boundary
            open: 100 + index,
            high: (100 + index) * 1.01,
            low: (100 + index) * 0.99,
          }),
        }),
      );
    }
    expect(strat.committedPrevHtfAtLeastOnce).toBe(false);
  });
});
