// packages/core/src/strategy/pivot-point-grid.test.ts — unit tests for the
// Pivot Point Grid (Phase 15 M15 range-mean-reversion) strategy.
//
// Test coverage targets (14 tests):
//   1. Default Fibonacci multipliers (0.382 / 0.618 / 1.000)
//   2. Custom multipliers respected (e.g. 0.5 / 1.0 / 1.5)
//   3. warmup() returns 100
//   4. candleIndex < warmup → no signal
//   5. Missing previous HTF → no signal
//   6. Boundary candle (timestamp % 86_400_000 === 0) commits prev*
//   7. Pivot recomputed when a new HTF candle rolls up
//   8. Within-bucket candles extend the running high/low/close
//   9. close <= S2 → LONG, SL=S3, TP=PP, confidence=1.0
//  10. close at S1 boundary (S2 < close <= S1) → LONG, SL=S2, TP=PP, confidence=0.7
//  11. close >= R2 → SHORT, SL=R3, TP=PP, confidence=1.0
//  12. close at R1 boundary (R1 <= close < R2) → SHORT, SL=R2, TP=PP, confidence=0.7
//  13. Middle zone (S1 < close < R1) → no signal
//  14. name + timeframes wired correctly for M15 LTF

import { describe, expect, it } from "bun:test";

import {
  DEFAULT_PIVOT_GRID_CONFIG,
  PivotPointGridStrategy,
} from "./pivot-point-grid.js";
import type { StrategyContext, StrategySignal } from "../types.js";
import type { Candle, Symbol, Timeframe } from "@mm-crypto-bot/shared/types";

const HTF_MS = 86_400_000;
const LTF_MS = 15 * 60 * 1000;

const makeCandle = (
  close: number,
  opts: { timestamp: number; open?: number; high?: number; low?: number; volume?: number } = {
    timestamp: 1_700_000_000_000,
  },
): Candle => ({
  timestamp: opts.timestamp,
  open: opts.open ?? close,
  high: opts.high ?? close,
  low: opts.low ?? close,
  close,
  volume: opts.volume ?? 1000,
});

const makeCtx = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
  symbol: "BTC/USDT" as unknown as Symbol,
  timeframe: "15m" as Timeframe,
  candleIndex: 200,
  candle: makeCandle(100, { timestamp: 1_700_000_000_000 }),
  mtfState: {
    htf: {},
    mtf: {},
    ltf: {},
  },
  pricePrecision: 2,
  ...overrides,
});

/**
 * `feedCandles` — pump a list of explicit OHLCV candles through the strategy
 * starting at candleIndex = `candleIndexBase`. Useful for staging
 * day-rollup sequences with exact H/L/C values.
 */
function feedCandles(
  strat: PivotPointGridStrategy,
  candles: { timestamp: number; high: number; low: number; close: number }[],
  candleIndexBase = 100,
): void {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    strat.onCandle(
      makeCtx({
        candleIndex: candleIndexBase + i,
        candle: makeCandle(c.close, c),
      }),
    );
  }
}

/**
 * `seedPivotData` — drives enough candles to populate `prevHtf*` with
 * H=110, L=90, C=100. After this returns, the next call to `onCandle`
 * (at any timestamp that is NOT on a 1d boundary) sees:
 *   PP=100, range=20
 *   R1=107.64, S1=92.36
 *   R2=112.36, S2=87.64
 *   R3=120,    S3=80
 *
 * The fixture places 4 day-0 candles, then a 1d-boundary candle that
 * commits day 0's accumulated H/L/C to `prev*`.
 *
 * `candleIndex` starts at 100 (post-warmup) so the boundary detection
 * actually runs — warmup() returns 100 and `onCandle` short-circuits
 * before the boundary commit at candleIndex < 100.
 */
function seedPivotData(strat: PivotPointGridStrategy): void {
  const day0Start = 1_700_000_000_000 - (1_700_000_000_000 % HTF_MS);
  const day1Boundary = day0Start + HTF_MS;
  const day0Candles = [
    { timestamp: day0Start + 0 * LTF_MS, high: 101, low: 99, close: 100 },
    { timestamp: day0Start + 1 * LTF_MS, high: 110, low: 109, close: 110 },
    { timestamp: day0Start + 2 * LTF_MS, high: 91, low: 90, close: 90 },
    { timestamp: day0Start + 3 * LTF_MS, high: 101, low: 99, close: 100 },
  ];
  feedCandles(strat, day0Candles, 100);

  // Boundary candle (day 1 start) — commits prev* to (110, 90, 100).
  strat.onCandle(
    makeCtx({
      candleIndex: 104,
      candle: makeCandle(102, {
        timestamp: day1Boundary,
        open: 102,
        high: 103,
        low: 101,
      }),
    }),
  );
}

describe("PivotPointGridStrategy — default config & warmup", () => {
  it("1. default multipliers are 0.382 / 0.618 / 1.000 (classical Fibonacci pivots)", () => {
    expect(DEFAULT_PIVOT_GRID_CONFIG.multiplierFib1).toBe(0.382);
    expect(DEFAULT_PIVOT_GRID_CONFIG.multiplierFib2).toBe(0.618);
    expect(DEFAULT_PIVOT_GRID_CONFIG.multiplierFib3).toBe(1.0);
  });

  it("2. custom multipliers persist (Partial<Config> spread)", () => {
    const strat = new PivotPointGridStrategy({
      multiplierFib1: 0.5,
      multiplierFib2: 1.0,
      multiplierFib3: 1.5,
    });
    expect(strat.config.multiplierFib1).toBe(0.5);
    expect(strat.config.multiplierFib2).toBe(1.0);
    expect(strat.config.multiplierFib3).toBe(1.5);
  });

  it("3. warmup returns 100 LTF (15m) candles (24h × 4 + buffer)", () => {
    const strat = new PivotPointGridStrategy();
    expect(strat.warmup()).toBe(100);
  });

  it("4. candleIndex < warmup → null signal (engine warmup gate)", () => {
    const strat = new PivotPointGridStrategy();
    const ctx = makeCtx({ candleIndex: 50 });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("5. missing prev HTF data → null signal (no committed previous-day candle yet)", () => {
    const strat = new PivotPointGridStrategy();
    // candleIndex is past warmup, but we never cross a 1d boundary,
    // so prev* is still undefined.
    let lastSignal: StrategySignal | null = null;
    for (let i = 0; i < 110; i++) {
      const ts = 1_700_003_500_000 + i * LTF_MS; // intentionally NOT on a 1d boundary
      lastSignal = strat.onCandle(
        makeCtx({
          candleIndex: 100 + i,
          candle: makeCandle(100, {
            timestamp: ts,
            open: 100,
            high: 101,
            low: 99,
          }),
        }),
      );
    }
    expect(lastSignal).toBeNull();
    expect(strat.committedPrevHtfAtLeastOnce).toBe(false);
  });
});

describe("PivotPointGridStrategy — HTF boundary detection", () => {
  it("6. boundary candle (timestamp % 86_400_000 === 0) commits prev* + resets accumulator", () => {
    const strat = new PivotPointGridStrategy();
    const day0Start = 1_700_000_000_000 - (1_700_000_000_000 % HTF_MS);
    const day1Boundary = day0Start + HTF_MS;

    // Day 0: 4 candles. Accumulated H/L/C after the 4th candle: H=110, L=90, C=100.
    feedCandles(
      strat,
      [
        { timestamp: day0Start + 0 * LTF_MS, high: 101, low: 99, close: 100 },
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
      makeCtx({
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

  it("7. pivot point recomputes when a new HTF candle rolls up", () => {
    const strat = new PivotPointGridStrategy();
    // Tight day-0 range: H=101, L=99, C=100 → PP=100, range=2.
    const day0Start = 1_700_000_000_000 - (1_700_000_000_000 % HTF_MS);
    const day1Boundary = day0Start + HTF_MS;
    feedCandles(
      strat,
      [
        { timestamp: day0Start + 0 * LTF_MS, high: 100.5, low: 99.5, close: 100 },
        { timestamp: day0Start + 1 * LTF_MS, high: 101, low: 100, close: 100.5 },
        { timestamp: day0Start + 2 * LTF_MS, high: 100.5, low: 99, close: 100 },
        { timestamp: day0Start + 3 * LTF_MS, high: 100.5, low: 99.5, close: 100 },
      ],
      100,
    );
    strat.onCandle(
      makeCtx({
        candleIndex: 104,
        candle: makeCandle(100, { timestamp: day1Boundary, open: 100, high: 100.5, low: 99.5 }),
      }),
    );

    // Tight-range scenario: PP=100, range=2.
    //   R1=100.764, S1=99.236, R2=101.236, S2=98.764, R3=102, S3=98.
    // close=97.5 < S2 (98.764) → deep long, stopLoss=S3=98, TP=PP=100.
    const signal = strat.onCandle(
      makeCtx({
        candleIndex: 200,
        candle: makeCandle(97.5, { timestamp: 1_700_003_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(1.0);
    expect(signal?.stopLoss).toBeCloseTo(98, 2);
    expect(signal?.takeProfit).toBeCloseTo(100, 2);
  });

  it("8. within-bucket candles extend the running high/low/close (no commit until boundary)", () => {
    const strat = new PivotPointGridStrategy();
    for (let i = 0; i < 10; i++) {
      strat.onCandle(
        makeCtx({
          candleIndex: 100 + i,
          candle: makeCandle(100 + i, {
            timestamp: 1_700_001_500_000 + i * LTF_MS, // not on a 1d boundary
            open: 100 + i,
            high: (100 + i) * 1.01,
            low: (100 + i) * 0.99,
          }),
        }),
      );
    }
    expect(strat.committedPrevHtfAtLeastOnce).toBe(false);
  });
});

describe("PivotPointGridStrategy — entry signals", () => {
  it("9. close <= S2 → LONG (deep overshoot) with SL=S3, TP=PP, confidence=1.0", () => {
    const strat = new PivotPointGridStrategy();
    seedPivotData(strat);
    // Pivots: PP=100, S3=80, S2=87.64, S1=92.36, R1=107.64, R2=112.36, R3=120.
    // close=85 < S2 (87.64) → deep long.
    const signal = strat.onCandle(
      makeCtx({
        candleIndex: 200,
        candle: makeCandle(85, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(1.0);
    expect(signal?.stopLoss).toBeCloseTo(80, 2); // S3
    expect(signal?.takeProfit).toBeCloseTo(100, 2); // PP
  });

  it("10. close at S1 boundary (S2 < close <= S1) → LONG (shallow overshoot), confidence=0.7", () => {
    const strat = new PivotPointGridStrategy();
    seedPivotData(strat);
    // close=90 — sits in the S2..S1 band (87.64 < 90 <= 92.36) → shallow long.
    const signal = strat.onCandle(
      makeCtx({
        candleIndex: 200,
        candle: makeCandle(90, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(0.7);
    expect(signal?.stopLoss).toBeCloseTo(87.64, 2); // S2
    expect(signal?.takeProfit).toBeCloseTo(100, 2); // PP
  });

  it("11. close >= R2 → SHORT (deep overbought) with SL=R3, TP=PP, confidence=1.0", () => {
    const strat = new PivotPointGridStrategy();
    seedPivotData(strat);
    // close=115 > R2 (112.36) → deep short.
    const signal = strat.onCandle(
      makeCtx({
        candleIndex: 200,
        candle: makeCandle(115, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    expect(signal?.confidence).toBe(1.0);
    expect(signal?.stopLoss).toBeCloseTo(120, 2); // R3
    expect(signal?.takeProfit).toBeCloseTo(100, 2); // PP
  });

  it("12. close at R1 boundary (R1 <= close < R2) → SHORT (shallow overbought), confidence=0.7", () => {
    const strat = new PivotPointGridStrategy();
    seedPivotData(strat);
    // close=108 — in the R1..R2 band (107.64 <= 108 < 112.36) → shallow short.
    const signal = strat.onCandle(
      makeCtx({
        candleIndex: 200,
        candle: makeCandle(108, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    expect(signal?.confidence).toBe(0.7);
    expect(signal?.stopLoss).toBeCloseTo(112.36, 2); // R2
    expect(signal?.takeProfit).toBeCloseTo(100, 2); // PP
  });

  it("13. middle zone (S1 < close < R1) → no signal", () => {
    const strat = new PivotPointGridStrategy();
    seedPivotData(strat);
    // close=100 — exactly at PP, well inside S1..R1 → middle zone, no signal.
    const signal = strat.onCandle(
      makeCtx({
        candleIndex: 200,
        candle: makeCandle(100, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).toBeNull();
  });
});

describe("PivotPointGridStrategy — strategy surface", () => {
  it("14. name and timeframes are wired correctly for M15 LTF", () => {
    const strat = new PivotPointGridStrategy();
    expect(strat.name).toContain("Pivot Point Grid");
    expect(strat.timeframes).toEqual(["1d", "15m"]);
  });
});
