import { describe, expect, it } from "bun:test";

import { makeSymbol, type Candle } from "@mm-crypto-bot/shared/types";

import type { MtfState, StrategyContext, StrategySignal } from "../types.js";
import {
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
  DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF,
  DonchianPivotComposition,
} from "./donchian-pivot-composition.js";

const DAY_MS = 86_400_000;

function mkCandle(close: number, timestamp: number, high = close, low = close): Candle {
  return { timestamp, open: close, high, low, close, volume: 1000 };
}

function mkState(donchianLower: number | undefined, donchianUpper: number | undefined): MtfState {
  return {
    htf: {
      adx: 20,
      ...(donchianLower !== undefined && { donchianLower }),
      ...(donchianUpper !== undefined && { donchianUpper }),
    },
    mtf: {},
    ltf: { atr: 2 },
  };
}

function mkContext(arguments_: {
  readonly close: number;
  readonly timestamp: number;
  readonly candleIndex: number;
  readonly donchianLower?: number;
  readonly donchianUpper?: number;
  readonly high?: number;
  readonly low?: number;
}): StrategyContext {
  return {
    symbol: makeSymbol("BTC/USDC"),
    timeframe: "15m",
    candleIndex: arguments_.candleIndex,
    candle: mkCandle(arguments_.close, arguments_.timestamp, arguments_.high, arguments_.low),
    mtfState: mkState(arguments_.donchianLower, arguments_.donchianUpper),
    pricePrecision: 2,
  };
}

function primePivotState(composition: DonchianPivotComposition): void {
  composition.onCandle(mkContext({ close: 100, timestamp: 0, candleIndex: 100, high: 120, low: 80 }));
  composition.onCandle(mkContext({ close: 100, timestamp: DAY_MS, candleIndex: 101, high: 102, low: 98 }));
}

function evaluateComposition(arguments_: {
  readonly config?: ConstructorParameters<typeof DonchianPivotComposition>[0];
  readonly close: number;
  readonly donchianLower: number;
  readonly donchianUpper: number;
}): StrategySignal | undefined {
  const composition = new DonchianPivotComposition(arguments_.config);
  primePivotState(composition);
  return composition.onCandle(
    mkContext({
      close: arguments_.close,
      timestamp: DAY_MS + 15 * 60_000,
      candleIndex: 102,
      donchianLower: arguments_.donchianLower,
      donchianUpper: arguments_.donchianUpper,
    }),
  );
}

function expectSignal(signal: StrategySignal | undefined): StrategySignal {
  expect(signal).toBeDefined();
  if (signal === undefined) throw new Error("expected strategy signal");
  return signal;
}

describe("DonchianPivotComposition — construction", () => {
  it("default construction: name, timeframes (1d, 4h, 15m), minConsensus=2, both sub-strategies exist", () => {
    const composition = new DonchianPivotComposition();
    expect(composition.name).toBe("Donchian + Pivot Composition");
    expect(composition.timeframes).toEqual(["1d", "4h", "15m"]);
    expect(DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF).toBe("15m");
    expect(composition.config.minConsensus).toBe(2);
    expect(composition.donchianRange).toBeDefined();
    expect(composition.pivotGrid).toBeDefined();
    expect(DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG.minConsensus).toBe(2);
    expect(DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG.donchianRange).toEqual({});
    expect(DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG.pivotGrid).toEqual({});
  });

  it("custom minConsensus=1 is honored; custom LTF reflected in timeframes field", () => {
    const composition = new DonchianPivotComposition({ minConsensus: 1 }, "1h");
    expect(composition.config.minConsensus).toBe(1);
    expect(composition.timeframes).toEqual(["1d", "4h", "1h"]);
  });

  it("custom per-sub-strategy config is forwarded (donchian + pivot overrides)", () => {
    const composition = new DonchianPivotComposition({
      donchianRange: { adxTrendThreshold: 30 },
      pivotGrid: { multiplierFib1: 0.5 },
    });
    expect(composition.donchianRange.config.adxTrendThreshold).toBe(30);
    expect(composition.pivotGrid.config.multiplierFib1).toBe(0.5);
  });

  it("warmup returns the max of the 2 sub-strategy warmups (pivot=100, donchian=30 → 100)", () => {
    const composition = new DonchianPivotComposition();
    expect(composition.warmup()).toBe(
      Math.max(composition.donchianRange.warmup(), composition.pivotGrid.warmup()),
    );
    expect(composition.warmup()).toBeGreaterThanOrEqual(composition.donchianRange.warmup());
    expect(composition.warmup()).toBeGreaterThanOrEqual(composition.pivotGrid.warmup());
    composition.onCandleObserved(
      mkContext({ close: 100, timestamp: 0, candleIndex: 100, high: 120, low: 80 }),
    );
    expect(composition.pivotGrid.committedPrevHtfAtLeastOnce).toBe(false);
  });

  it("constructor rejects out-of-range minConsensus (0, 3, -1, 2.5)", () => {
    expect(() => new DonchianPivotComposition({ minConsensus: 0 })).toThrow(RangeError);
    expect(() => new DonchianPivotComposition({ minConsensus: 3 })).toThrow(RangeError);
    expect(() => new DonchianPivotComposition({ minConsensus: -1 })).toThrow(RangeError);
    expect(() => new DonchianPivotComposition({ minConsensus: 2.5 })).toThrow(RangeError);
  });
});

describe("DonchianPivotComposition.onCandle — consensus (default 2-of-2)", () => {
  it("1. both fire (2-of-2 default) → emit consensus signal", () => {
    const signal = expectSignal(evaluateComposition({ close: 80, donchianLower: 90, donchianUpper: 110 }));
    expect(signal.side).toBe("buy");
    expect(signal.reason).toContain("[DonchianPivot] consensus=2/2");
    expect(signal.reason).toContain("Donchian-Range long");
  });

  it("2. only Donchian fires → no emit (default 2-of-2)", () => {
    expect(evaluateComposition({ close: 88, donchianLower: 90, donchianUpper: 110 })).toBeUndefined();
  });

  it("3. only Pivot fires → no emit (default 2-of-2)", () => {
    expect(evaluateComposition({ close: 80, donchianLower: 70, donchianUpper: 110 })).toBeUndefined();
  });

  it("4. neither fires → no emit", () => {
    expect(evaluateComposition({ close: 100, donchianLower: 90, donchianUpper: 110 })).toBeUndefined();
  });
});

describe("DonchianPivotComposition.onCandle — signal merge", () => {
  it("5. confidence = mean of the real sub-strategy confidences", () => {
    const signal = expectSignal(evaluateComposition({ close: 80, donchianLower: 90, donchianUpper: 110 }));
    expect(signal.confidence).toBeCloseTo(0.57, 10);
  });

  it("6. signal fields merged correctly: side agreed, LONG stopLoss = max(stops), takeProfit = mean", () => {
    const signal = expectSignal(
      evaluateComposition({
        config: { pivotGrid: { maxPositionPctEquity: 0.2 } },
        close: 70,
        donchianLower: 80,
        donchianUpper: 120,
      }),
    );
    expect(signal.side).toBe("buy");
    expect(signal.confidence).toBe(1);
    expect(signal.stopLoss).toBe(78);
    expect(signal.takeProfit).toBe(110);
    expect(signal.reason).toBe(
      "[DonchianPivot] consensus=2/2 winner=donchian-range (conf=1.00) | Donchian-Range long: 15m close 70.00 <= 1d-Donchian-lower 80.00; ADX=20.00; ATR(14)=2.00",
    );
  });

  it("6b. signal fields merged correctly: SHORT stopLoss = min(stops) (tighter for short)", () => {
    const signal = expectSignal(
      evaluateComposition({
        config: { pivotGrid: { maxPositionPctEquity: 0.2 } },
        close: 130,
        donchianLower: 80,
        donchianUpper: 120,
      }),
    );
    expect(signal.side).toBe("sell");
    expect(signal.confidence).toBe(1);
    expect(signal.stopLoss).toBe(122);
    expect(signal.takeProfit).toBe(90);
    expect(signal.reason).toBe(
      "[DonchianPivot] consensus=2/2 winner=donchian-range (conf=1.00) | Donchian-Range short: 15m close 130.00 >= 1d-Donchian-upper 120.00; ADX=20.00; ATR(14)=2.00",
    );
  });

  it("6c. side conflict (donchian long + pivot short) → no emit (defer)", () => {
    expect(evaluateComposition({ close: 120, donchianLower: 125, donchianUpper: 130 })).toBeUndefined();
  });
});

describe("DonchianPivotComposition.onCandle — minConsensus=1 override", () => {
  it("7. minConsensus=1 → emit if either fires (donchian alone)", () => {
    const signal = expectSignal(
      evaluateComposition({ config: { minConsensus: 1 }, close: 88, donchianLower: 90, donchianUpper: 110 }),
    );
    expect(signal.side).toBe("buy");
    expect(signal.confidence).toBe(1);
    expect(signal.reason).toContain("consensus=1/2");
    expect(signal.reason).toContain("Donchian-Range long");
  });

  it("7b. minConsensus=1 → emit if either fires (pivot alone)", () => {
    const signal = expectSignal(
      evaluateComposition({ config: { minConsensus: 1 }, close: 80, donchianLower: 70, donchianUpper: 110 }),
    );
    expect(signal.side).toBe("buy");
    expect(signal.confidence).toBeCloseTo(0.14, 10);
    expect(signal.reason).toContain("consensus=1/2");
    expect(signal.reason).toContain("PivotGrid LONG");
  });

  it("7c. minConsensus=1, neither fires → still no emit", () => {
    expect(
      evaluateComposition({ config: { minConsensus: 1 }, close: 100, donchianLower: 90, donchianUpper: 110 }),
    ).toBeUndefined();
  });

  it("7d. minConsensus=1, side conflict → still no emit (defer)", () => {
    expect(
      evaluateComposition({
        config: { minConsensus: 1 },
        close: 120,
        donchianLower: 125,
        donchianUpper: 130,
      }),
    ).toBeUndefined();
  });
});

describe("DonchianPivotComposition.onCandle — confidence mean edge case", () => {
  it("8. both fire with capped Pivot confidence → emit their arithmetic mean", () => {
    const signal = expectSignal(
      evaluateComposition({
        config: { pivotGrid: { maxPositionPctEquity: 0.1 } },
        close: 80,
        donchianLower: 90,
        donchianUpper: 110,
      }),
    );
    expect(signal.confidence).toBeCloseTo(0.675, 10);
    expect(signal.reason).toContain("consensus=2/2");
  });
});
