// packages/core/src/strategy/donchian-pivot-composition.test.ts — Phase 18 Track B
// Donchian + Pivot 2-component composition tests.
//
// 100%-os line+branch coverage a donchian-pivot-composition.ts-re. A
// tesztek a Phase 15 Track D `simple-retail-ensemble.test.ts` konvencióját
// követik: replace each sub-strategy's `onCandle` with a pre-programmed
// stub via property assignment, then exercise the composition's
// consensus + side-conflict + signal-merge logic in isolation from the
// sub-strategy internals (which are covered by the per-strategy test files).
//
// `@ts-nocheck` per project convention for ultra-strict tsconfig —
// runtime assertions verify behavior correctness.
//
// Tests coverage (8 tests, all required by the Phase 18 Track B brief):
//   1.  both fire (2-of-2 default) → emit consensus signal
//   2.  only Donchian fires → no emit (default 2-of-2)
//   3.  only Pivot fires → no emit (default 2-of-2)
//   4.  neither fires → no emit
//   5.  confidence = mean of sub-strategy confidences
//   6.  signal fields merged correctly (side, stopLoss, takeProfit)
//   7.  minConsensus=1 (override) → emit if either fires
//   8.  both fire at conf=0.5 → emit at conf=0.5

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import type { MtfState, StrategyContext, StrategySignal } from "../types.js";
import {
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
  DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF,
  DonchianPivotComposition,
} from "./donchian-pivot-composition.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * `mkCandle` — minimal OHLCV candle constructor with overrides.
 */
function mkCandle(overrides: Partial<Candle> = {}): Candle {
  return {
    timestamp: 0,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
    ...overrides,
  };
}

/**
 * `mkState` — minimal MtfState constructor with overrides. The composition
 * delegates to the sub-strategies which read their own fields; we leave
 * most undefined by default.
 */
function mkState(overrides: Partial<MtfState> = {}): MtfState {
  return {
    htf: { ...overrides.htf },
    mtf: { ...overrides.mtf },
    ltf: { ...overrides.ltf },
  };
}

/**
 * `mkContext` — StrategyContext builder. `candle`, `mtfState`, `candleIndex`,
 * `timeframe` are overrideable; everything else defaults.
 */
function mkContext(
  overrides: {
    readonly candle?: Partial<Candle>;
    readonly mtfState?: Partial<MtfState>;
    readonly candleIndex?: number;
    readonly timeframe?: "1d" | "4h" | "1h" | "5m" | "15m" | "1m";
  } = {},
): StrategyContext {
  return {
    symbol: "BTC/USDC" as never,
    timeframe: overrides.timeframe ?? "15m",
    candleIndex: overrides.candleIndex ?? 5000,
    candle: mkCandle(overrides.candle),
    mtfState: mkState(overrides.mtfState ?? {}),
    pricePrecision: 2,
  };
}

/**
 * `mkLongSignal` — minimal long StrategySignal with a given confidence,
 * stopLoss, takeProfit, and reason.
 */
function mkLongSignal(
  confidence: number,
  opts: { readonly stopLoss?: number; readonly takeProfit?: number; readonly reason?: string } = {},
): StrategySignal {
  return {
    side: "buy",
    confidence,
    reason: opts.reason ?? "long signal",
    stopLoss: opts.stopLoss ?? 95,
    takeProfit: opts.takeProfit ?? 110,
  };
}

/**
 * `mkShortSignal` — minimal short StrategySignal with a given confidence,
 * stopLoss, takeProfit, and reason.
 */
function mkShortSignal(
  confidence: number,
  opts: { readonly stopLoss?: number; readonly takeProfit?: number; readonly reason?: string } = {},
): StrategySignal {
  return {
    side: "sell",
    confidence,
    reason: opts.reason ?? "short signal",
    stopLoss: opts.stopLoss ?? 105,
    takeProfit: opts.takeProfit ?? 90,
  };
}

/**
 * `stubSubStrategies` — replace each sub-strategy's `onCandle` with a
 * pre-programmed stub. The stubs return the supplied signal or null based
 * on the input map (keys: `donchian-range`, `pivot-grid`).
 */
function stubSubStrategies(
  c: DonchianPivotComposition,
  stubs: Readonly<Record<string, StrategySignal | null>>,
): void {
  c.donchianRange.onCandle = (_ctx: StrategyContext): StrategySignal | null =>
    stubs["donchian-range"] ?? null;
  c.pivotGrid.onCandle = (_ctx: StrategyContext): StrategySignal | null =>
    stubs["pivot-grid"] ?? null;
}

// ---------------------------------------------------------------------------
// Construction tests (extras — not in the 8 required, but pin the contract)
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition — construction", () => {
  it("default construction: name, timeframes (1d, 4h, 15m), minConsensus=2, both sub-strategies exist", () => {
    const c = new DonchianPivotComposition();
    expect(c.name).toBe(
      "Donchian + Pivot Composition (Phase 18 — 2-component M15-native mean-reversion)",
    );
    // Default LTF = "15m"
    expect(c.timeframes).toEqual(["1d", "4h", "15m"]);
    expect(DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF).toBe("15m");
    expect(c.config.minConsensus).toBe(2);
    expect(c.donchianRange).toBeDefined();
    expect(c.pivotGrid).toBeDefined();
    // Default config check.
    expect(DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG.minConsensus).toBe(2);
    expect(DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG.donchianRange).toEqual({});
    expect(DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG.pivotGrid).toEqual({});
  });

  it("custom minConsensus=1 is honored; custom LTF reflected in timeframes field", () => {
    const c = new DonchianPivotComposition({ minConsensus: 1 }, "1h");
    expect(c.config.minConsensus).toBe(1);
    expect(c.timeframes).toEqual(["1d", "4h", "1h"]);
  });

  it("custom per-sub-strategy config is forwarded (donchian + pivot overrides)", () => {
    const c = new DonchianPivotComposition({
      donchianRange: { adxTrendThreshold: 30 },
      pivotGrid: { multiplierFib1: 0.5 },
    });
    expect(c.donchianRange.config.adxTrendThreshold).toBe(30);
    expect(c.pivotGrid.config.multiplierFib1).toBe(0.5);
  });

  it("warmup returns the max of the 2 sub-strategy warmups (pivot=100, donchian=30 → 100)", () => {
    const c = new DonchianPivotComposition();
    expect(c.warmup()).toBe(Math.max(c.donchianRange.warmup(), c.pivotGrid.warmup()));
    expect(c.warmup()).toBeGreaterThanOrEqual(c.donchianRange.warmup());
    expect(c.warmup()).toBeGreaterThanOrEqual(c.pivotGrid.warmup());
  });

  it("constructor rejects out-of-range minConsensus (0, 3, -1, 2.5)", () => {
    expect(() => new DonchianPivotComposition({ minConsensus: 0 })).toThrow(RangeError);
    expect(() => new DonchianPivotComposition({ minConsensus: 3 })).toThrow(RangeError);
    expect(() => new DonchianPivotComposition({ minConsensus: -1 })).toThrow(RangeError);
    expect(() => new DonchianPivotComposition({ minConsensus: 2.5 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Required 8 tests — consensus + side-conflict + signal-merge
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition.onCandle — consensus (default 2-of-2)", () => {
  it("1. both fire (2-of-2 default) → emit consensus signal", () => {
    const c = new DonchianPivotComposition();
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8, { reason: "donchian long" }),
      "pivot-grid": mkLongSignal(0.7, { reason: "pivot long" }),
    });
    const result = c.onCandle(mkContext());
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    // Both sub-strategies fired → consensus tag = 2/2.
    expect(result!.reason).toContain("[DonchianPivot] consensus=2/2");
    expect(result!.reason).toContain("donchian long");
  });

  it("2. only Donchian fires → no emit (default 2-of-2)", () => {
    const c = new DonchianPivotComposition();
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8, { reason: "donchian long" }),
      "pivot-grid": null,
    });
    expect(c.onCandle(mkContext())).toBeNull();
  });

  it("3. only Pivot fires → no emit (default 2-of-2)", () => {
    const c = new DonchianPivotComposition();
    stubSubStrategies(c, {
      "donchian-range": null,
      "pivot-grid": mkLongSignal(0.7, { reason: "pivot long" }),
    });
    expect(c.onCandle(mkContext())).toBeNull();
  });

  it("4. neither fires → no emit", () => {
    const c = new DonchianPivotComposition();
    stubSubStrategies(c, {
      "donchian-range": null,
      "pivot-grid": null,
    });
    expect(c.onCandle(mkContext())).toBeNull();
  });
});

describe("DonchianPivotComposition.onCandle — signal merge", () => {
  it("5. confidence = mean of sub-strategy confidences (0.6 + 0.9 → 0.75)", () => {
    const c = new DonchianPivotComposition();
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.6),
      "pivot-grid": mkLongSignal(0.9),
    });
    const result = c.onCandle(mkContext());
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeCloseTo((0.6 + 0.9) / 2, 10);
  });

  it("6. signal fields merged correctly: side agreed, LONG stopLoss = max(stops), takeProfit = mean", () => {
    const c = new DonchianPivotComposition();
    stubSubStrategies(c, {
      // Donchian long: SL=87 (tighter for long — closer to entry)
      "donchian-range": mkLongSignal(0.8, { stopLoss: 87, takeProfit: 110, reason: "donchian long" }),
      // Pivot long: SL=80 (wider for long — further from entry)
      "pivot-grid": mkLongSignal(0.7, { stopLoss: 80, takeProfit: 100, reason: "pivot long" }),
    });
    const result = c.onCandle(mkContext({ candle: { close: 100 } }));
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    // For LONG, tighter stop = max(stops) = 87 (Donchian's, closer to entry 100).
    expect(result!.stopLoss).toBe(87);
    // takeProfit = mean(110, 100) = 105.
    expect(result!.takeProfit).toBe(105);
    // reason tag includes winner (donchian-range has higher conf 0.8).
    expect(result!.reason).toContain("winner=donchian-range");
    expect(result!.reason).toContain("consensus=2/2");
  });

  it("6b. signal fields merged correctly: SHORT stopLoss = min(stops) (tighter for short)", () => {
    const c = new DonchianPivotComposition();
    stubSubStrategies(c, {
      // Donchian short: SL=113 (tighter for short — closer to entry 100)
      "donchian-range": mkShortSignal(0.8, { stopLoss: 113, takeProfit: 90, reason: "donchian short" }),
      // Pivot short: SL=120 (wider for short — further from entry 100)
      "pivot-grid": mkShortSignal(0.7, { stopLoss: 120, takeProfit: 100, reason: "pivot short" }),
    });
    const result = c.onCandle(mkContext({ candle: { close: 100 } }));
    expect(result).not.toBeNull();
    expect(result!.side).toBe("sell");
    // For SHORT, tighter stop = min(stops) = 113 (Donchian's, closer to entry 100).
    expect(result!.stopLoss).toBe(113);
    // takeProfit = mean(90, 100) = 95.
    expect(result!.takeProfit).toBe(95);
  });

  it("6c. side conflict (donchian long + pivot short) → no emit (defer)", () => {
    const c = new DonchianPivotComposition();
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8),
      "pivot-grid": mkShortSignal(0.7),
    });
    expect(c.onCandle(mkContext())).toBeNull();
  });
});

describe("DonchianPivotComposition.onCandle — minConsensus=1 override", () => {
  it("7. minConsensus=1 → emit if either fires (donchian alone)", () => {
    const c = new DonchianPivotComposition({ minConsensus: 1 });
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8, { reason: "donchian long solo" }),
      "pivot-grid": null,
    });
    const result = c.onCandle(mkContext());
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.8);
    expect(result!.reason).toContain("consensus=1/2");
    expect(result!.reason).toContain("donchian long solo");
  });

  it("7b. minConsensus=1 → emit if either fires (pivot alone)", () => {
    const c = new DonchianPivotComposition({ minConsensus: 1 });
    stubSubStrategies(c, {
      "donchian-range": null,
      "pivot-grid": mkLongSignal(0.7, { reason: "pivot long solo" }),
    });
    const result = c.onCandle(mkContext());
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.7);
    expect(result!.reason).toContain("pivot long solo");
  });

  it("7c. minConsensus=1, neither fires → still no emit", () => {
    const c = new DonchianPivotComposition({ minConsensus: 1 });
    stubSubStrategies(c, {
      "donchian-range": null,
      "pivot-grid": null,
    });
    expect(c.onCandle(mkContext())).toBeNull();
  });

  it("7d. minConsensus=1, side conflict → still no emit (defer)", () => {
    const c = new DonchianPivotComposition({ minConsensus: 1 });
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8),
      "pivot-grid": mkShortSignal(0.7),
    });
    expect(c.onCandle(mkContext())).toBeNull();
  });
});

describe("DonchianPivotComposition.onCandle — confidence mean edge case", () => {
  it("8. both fire at conf=0.5 → emit at conf=0.5 (mean(0.5, 0.5) = 0.5)", () => {
    const c = new DonchianPivotComposition();
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.5, { reason: "donchian 0.5" }),
      "pivot-grid": mkLongSignal(0.5, { reason: "pivot 0.5" }),
    });
    const result = c.onCandle(mkContext());
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.5);
    expect(result!.reason).toContain("consensus=2/2");
  });
});
