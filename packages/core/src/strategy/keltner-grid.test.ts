// packages/core/src/strategy/keltner-grid.test.ts — unit tests
//
// Phase 15 Track C retail-grid coverage. The Keltner strategy holds
// stateful EMA20 cumulative state (seed = SMA of FIRST 20 closes,
// then recursive EMA step per new close). Tests use two complementary
// surfaces:
//
//   - CUMULATIVE-STATE TESTS — push closes through `pushClose` and read
//     `computeEma20()` to verify the EMA math itself.
//
//   - SIGNAL-LOGIC TESTS — call `computeSignal(close, ema, atr, prec)`
//     directly with controlled inputs, bypassing the EMA state machine.
//     This keeps the regime / level-touch / stop-loss math clean.
//
// TRIGGER-FIRING OBSERVATION (important detail):
// For default config K=1.5 and N=5 grid: levels are at EMA ± (9, 3, 3).
// Specifically: 20%=EMA-9, 40%=EMA-3, 60%=EMA+3, 80%=EMA+9.
// The regime filter (close > ema → long, close < ema → short) means:
//   - LONG regime fires from the 60% level ONLY (above EMA).
//   - SHORT regime fires from the 40% level ONLY (below EMA).
// The 20% and 80% level triggers are regime-blocked (they sit on the
// opposite side of EMA from their regime's natural direction), but
// they remain in the trigger-set functions for documentation/audit.

import { describe, expect, it } from "bun:test";

import {
  DEFAULT_KELTNER_GRID_CONFIG,
  KeltnerGridStrategy,
} from "./keltner-grid.js";
import type { StrategyContext } from "../types.js";

const baseCandle = (close: number) => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume: 1000,
});

type KeltnerCtxOverrides = Partial<StrategyContext> & {
  readonly ltfAtr?: number | undefined;
};

const makeCtx = (overrides: KeltnerCtxOverrides = {}): StrategyContext => {
  const { ltfAtr, ...rest } = overrides;
  const ltf: { atr?: number } = {};
  if (ltfAtr !== undefined) ltf.atr = ltfAtr;
  return {
    symbol: "BTC/USDT" as never,
    timeframe: "5m",
    candleIndex: 100,
    candle: baseCandle(100),
    pricePrecision: 2,
    ...rest,
    mtfState: { htf: {}, mtf: {}, ltf },
  };
};

/**
 * `primeEmaBuffer` — push `n` closes through `pushClose`.
 */
function primeEmaBuffer(
  strat: KeltnerGridStrategy,
  n: number,
  close: number,
): void {
  for (let i = 0; i < n; i++) {
    strat.pushClose(close);
  }
}

describe("KeltnerGridStrategy — config + warmup", () => {
  it("default config is kMultiplier=1.5, gridLevelCount=5, atrPeriod=14", () => {
    expect(DEFAULT_KELTNER_GRID_CONFIG.kMultiplier).toBe(1.5);
    expect(DEFAULT_KELTNER_GRID_CONFIG.gridLevelCount).toBe(5);
    expect(DEFAULT_KELTNER_GRID_CONFIG.atrPeriod).toBe(14);
  });

  it("constructor copies default config when no overrides are passed", () => {
    const strat = new KeltnerGridStrategy();
    expect(strat.config).toEqual(DEFAULT_KELTNER_GRID_CONFIG);
  });

  it("constructor applies partial overrides on top of defaults", () => {
    const strat = new KeltnerGridStrategy({ kMultiplier: 2.0, gridLevelCount: 3 });
    expect(strat.config.kMultiplier).toBe(2.0);
    expect(strat.config.gridLevelCount).toBe(3);
    expect(strat.config.atrPeriod).toBe(14);
  });

  it("warmup returns 30 (≈2.5h of M5 candles)", () => {
    const strat = new KeltnerGridStrategy();
    expect(strat.warmup()).toBe(30);
  });

  it("timeframes field reports ['1h', '5m'] in that order", () => {
    const strat = new KeltnerGridStrategy();
    expect(strat.timeframes).toEqual(["1h", "5m"]);
  });
});

describe("KeltnerGridStrategy — EMA20 cumulative state", () => {
  it("computeEma20 returns undefined before 20 closes accumulate", () => {
    const strat = new KeltnerGridStrategy();
    expect(strat.computeEma20()).toBeUndefined();
    primeEmaBuffer(strat, 19, 100);
    expect(strat.computeEma20()).toBeUndefined();
  });

  it("computeEma20 stays at the seed value for the seed window (count = 20)", () => {
    const strat = new KeltnerGridStrategy();
    primeEmaBuffer(strat, 20, 100);
    expect(strat.computeEma20()).toBe(100);
  });

  it("computeEma20 returns the SMA of the first 20 closes (mixed values)", () => {
    const strat = new KeltnerGridStrategy();
    for (let i = 1; i <= 20; i++) {
      strat.pushClose(i);
    }
    // SMA of [1..20] = 210/20 = 10.5
    expect(strat.computeEma20()).toBeCloseTo(10.5, 5);
  });

  it("computeEma20 stays at the seed for a flat series", () => {
    const strat = new KeltnerGridStrategy();
    primeEmaBuffer(strat, 30, 100);
    expect(strat.computeEma20()).toBe(100);
  });

  it("computeEma20 advances correctly through the first recursion step", () => {
    const strat = new KeltnerGridStrategy();
    primeEmaBuffer(strat, 20, 100);
    strat.pushClose(110);
    // EMA_21 = 110 × α + 100 × (1−α) = 100 + 10 × (2/21)
    expect(strat.computeEma20()).toBeCloseTo(100 + 10 * (2 / 21), 5);
  });

  it("computeEma20 advances correctly through the second recursion step", () => {
    const strat = new KeltnerGridStrategy();
    primeEmaBuffer(strat, 20, 100);
    strat.pushClose(110);
    strat.pushClose(120);
    const ema21 = 100 + 10 * (2 / 21);
    const expectedEma22 = ema21 + (120 - ema21) * (2 / 21);
    expect(strat.computeEma20()).toBeCloseTo(expectedEma22, 5);
  });

  it("custom emaPeriod=10 seeds earlier (10 closes instead of 20)", () => {
    const strat = new KeltnerGridStrategy();
    primeEmaBuffer(strat, 9, 100);
    expect(strat.computeEma20(10)).toBeUndefined();
    strat.pushClose(100, 10); // emaPeriod=10 → 10th push sets seed
    expect(strat.computeEma20(10)).toBe(100);
  });

  it("rolling ring buffer caps at 20 entries (older closes dropped)", () => {
    // Diagnostic field — the cumulative EMA doesn't depend on it, but
    // we pin the cap-and-drop behavior so future refactors don't
    // accidentally let the buffer grow unbounded.
    const strat = new KeltnerGridStrategy();
    for (let i = 1; i <= 30; i++) {
      strat.pushClose(i);
    }
    const buf = (strat as unknown as { closeRingBuffer: number[] })
      .closeRingBuffer;
    expect(buf.length).toBe(20);
    expect(buf[0]).toBe(11); // dropped 1..10
    expect(buf[19]).toBe(30);
  });
});

describe("KeltnerGridStrategy — grid geometry", () => {
  it("gridFractions with default N=5 returns [0, 0.2, 0.4, 0.6, 0.8]", () => {
    const strat = new KeltnerGridStrategy();
    expect([...strat.gridFractions()]).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it("longTriggerFractions with default N=5 returns lower internal 3 levels [0.2, 0.4, 0.6]", () => {
    const strat = new KeltnerGridStrategy();
    expect([...strat.longTriggerFractions()]).toEqual([0.2, 0.4, 0.6]);
  });

  it("shortTriggerFractions with default N=5 returns upper internal 3 levels [0.4, 0.6, 0.8]", () => {
    const strat = new KeltnerGridStrategy();
    expect([...strat.shortTriggerFractions()]).toEqual([0.4, 0.6, 0.8]);
  });

  it("custom gridLevelCount=3 produces 3 levels [0, 1/3, 2/3]", () => {
    const strat = new KeltnerGridStrategy({ gridLevelCount: 3 });
    expect([...strat.gridFractions()]).toEqual([0, 1 / 3, 2 / 3]);
  });

  it("custom gridLevelCount=3 long-triggers at the 2 internal levels [1/3, 2/3]", () => {
    const strat = new KeltnerGridStrategy({ gridLevelCount: 3 });
    expect([...strat.longTriggerFractions()]).toEqual([1 / 3, 2 / 3]);
  });

  it("custom gridLevelCount=3 short-triggers at the topmost internal level [2/3]", () => {
    const strat = new KeltnerGridStrategy({ gridLevelCount: 3 });
    // n=3: start = max(1, 0) = 1, end = 3. i = 1, 2.
    expect([...strat.shortTriggerFractions()]).toEqual([1 / 3, 2 / 3]);
  });

  it("gridLevelCount=1 returns [0] and no triggers (lower rail only)", () => {
    const strat = new KeltnerGridStrategy({ gridLevelCount: 1 });
    expect([...strat.gridFractions()]).toEqual([0]);
    expect([...strat.longTriggerFractions()]).toEqual([]);
    expect([...strat.shortTriggerFractions()]).toEqual([]);
  });

  it("gridLevelCount=0 returns [] and no triggers (edge case)", () => {
    const strat = new KeltnerGridStrategy({ gridLevelCount: 0 });
    expect([...strat.gridFractions()]).toEqual([]);
    expect([...strat.longTriggerFractions()]).toEqual([]);
    expect([...strat.shortTriggerFractions()]).toEqual([]);
  });
});

describe("KeltnerGridStrategy — signal logic (pure computeSignal)", () => {
  // These tests use `computeSignal` directly with controlled EMA, ATR,
  // and close. They verify the level-touch and regime semantics
  // without contending with the cumulative EMA state machine.
  //
  // BAND-LAYOUT CHEAT SHEET (default K=1.5, ATR=10):
  //   band = [EMA − 15, EMA + 15], range = 30.
  //   20% level = EMA − 9
  //   40% level = EMA − 3
  //   60% level = EMA + 3
  //   80% level = EMA + 9
  //   touch tolerance = 30 / (2 × 4) = 3.75
  //
  // Because the regime filter (close > ema → long, close < ema → short)
  // excludes levels on the wrong side of EMA, in practice:
  //   - LONG regime fires from the 60% level (the only one ≥ EMA).
  //   - SHORT regime fires from the 40% level (the only one ≤ EMA).

  it("long regime, close at EMA+3 (60% level) → long signal", () => {
    const strat = new KeltnerGridStrategy();
    // EMA = 100, ATR = 10, K = 1.5 → band [85, 115].
    // close = 103 = EMA + 3 = 60% level. distance = 0.
    const signal = strat.computeSignal(103, 100, 10, 2);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(0.7);
  });

  it("short regime, close at EMA−3 (40% level) → short signal", () => {
    const strat = new KeltnerGridStrategy();
    // close = 97 = EMA − 3 = 40% level. distance = 0.
    const signal = strat.computeSignal(97, 100, 10, 2);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    expect(signal?.confidence).toBe(0.7);
  });

  it("long regime, close past the 60% trigger band → no signal", () => {
    const strat = new KeltnerGridStrategy();
    // close = 110 (> EMA + 6.75 = upper edge of 60% trigger band).
    // distance to nearest long trigger (60% at EMA+3 = 103) = 7 > tol 3.75.
    // SHORT trigger distances: 40%=97 (dist 13), 60%=103 (dist 7 — also
    // > tol), 80%=109 (dist 1 — this is the SHORT trigger at 80%).
    // But long regime doesn't scan SHORT triggers.
    // → no signal.
    const signal = strat.computeSignal(110, 100, 10, 2);
    expect(signal).toBeNull();
  });

  it("long regime, close above upper rail → no signal", () => {
    const strat = new KeltnerGridStrategy();
    const signal = strat.computeSignal(116, 100, 10, 2);
    expect(signal).toBeNull();
  });

  it("short regime, close past the 40% trigger band → no signal", () => {
    const strat = new KeltnerGridStrategy();
    // close = 80 (< EMA - 19.25 = lower edge of 40% trigger band).
    // LONG trigger distances: 20%=91 (dist 11), 40%=97 (dist 17),
    // 60%=103 (dist 23). All > tol. SHORT regime scans short triggers:
    // 40%=97 (dist 17), 60%=103 (dist 23), 80%=109 (dist 29). All > tol.
    // → no signal.
    const signal = strat.computeSignal(80, 100, 10, 2);
    expect(signal).toBeNull();
  });

  it("at EMA20 exactly → no signal (transition zone, both branches skipped)", () => {
    const strat = new KeltnerGridStrategy();
    const signal = strat.computeSignal(100, 100, 10, 2);
    expect(signal).toBeNull();
  });

  it("ATR=0 → no signal (degenerate range ≤ 0 guard)", () => {
    const strat = new KeltnerGridStrategy();
    const signal = strat.computeSignal(103, 100, 0, 2);
    expect(signal).toBeNull();
  });

  it("negative ATR (data error) → no signal (range ≤ 0 guard)", () => {
    const strat = new KeltnerGridStrategy();
    const signal = strat.computeSignal(103, 100, -5, 2);
    expect(signal).toBeNull();
  });

  it("custom kMultiplier=2.0 produces wider bands (stop distance scales)", () => {
    const strat = new KeltnerGridStrategy({ kMultiplier: 2.0 });
    // EMA = 100, ATR = 10, K = 2 → band [80, 120], range = 40.
    // 60% level = 80 + 0.6*40 = 104. stop = lower - 0.5*ATR = 80 - 5 = 75.
    const signal = strat.computeSignal(104, 100, 10, 2);
    expect(signal?.side).toBe("buy");
    expect(signal?.stopLoss).toBe(75); // wider than K=1.5's 80
    expect(signal?.takeProfit).toBe(100); // EMA20 still mid
  });

  it("long signal: stop is lower-0.5×ATR, target is EMA20", () => {
    const strat = new KeltnerGridStrategy();
    const signal = strat.computeSignal(103, 100, 10, 2);
    expect(signal?.side).toBe("buy");
    expect(signal?.stopLoss).toBeCloseTo(85 - 5, 2); // 80
    expect(signal?.takeProfit).toBe(100);
  });

  it("short signal: stop is upper+0.5×ATR, target is EMA20", () => {
    const strat = new KeltnerGridStrategy();
    const signal = strat.computeSignal(97, 100, 10, 2);
    expect(signal?.side).toBe("sell");
    expect(signal?.stopLoss).toBeCloseTo(115 + 5, 2); // 120
    expect(signal?.takeProfit).toBe(100);
  });

  it("long signal: confidence is 0.7 at the 60% level", () => {
    const strat = new KeltnerGridStrategy();
    // Try slightly varied closes near the 60% trigger (103 ± 2).
    for (const close of [101, 103, 105]) {
      const signal = strat.computeSignal(close, 100, 10, 2);
      expect(signal?.confidence).toBe(0.7);
    }
  });

  it("short signal: confidence is 0.7 at the 40% level", () => {
    const strat = new KeltnerGridStrategy();
    for (const close of [95, 97, 99]) {
      const signal = strat.computeSignal(close, 100, 10, 2);
      expect(signal?.confidence).toBe(0.7);
    }
  });

  it("long signal: reason string includes level %, EMA20, K, ATR", () => {
    const strat = new KeltnerGridStrategy();
    const signal = strat.computeSignal(103, 100, 10, 2);
    expect(signal?.reason).toContain("60%");
    expect(signal?.reason).toContain("EMA20 100.00");
    expect(signal?.reason).toContain("K=1.5");
    expect(signal?.reason).toContain("ATR(14)=10.00");
  });

  it("short signal: reason string includes level %, EMA20, K, ATR", () => {
    const strat = new KeltnerGridStrategy();
    const signal = strat.computeSignal(97, 100, 10, 2);
    expect(signal?.reason).toContain("40%");
    expect(signal?.reason).toContain("EMA20 100.00");
    expect(signal?.reason).toContain("K=1.5");
    expect(signal?.reason).toContain("ATR(14)=10.00");
  });

  it("mid-grid fraction (50% on default N=5) is NOT in the trigger sets", () => {
    // 50% level = EMA itself (the middle of the band). Even though the
    // brief lists 4 internal levels at 20/40/60/80%, the level set
    // should NOT include 50% — only the design-fraction levels.
    const strat = new KeltnerGridStrategy();
    expect(strat.longTriggerFractions()).not.toContain(0.5);
    expect(strat.shortTriggerFractions()).not.toContain(0.5);
  });

  it("custom gridLevelCount=3: close at EMA fires nothing (transition zone)", () => {
    const strat = new KeltnerGridStrategy({ gridLevelCount: 3 });
    const signal = strat.computeSignal(100, 100, 10, 2);
    expect(signal).toBeNull();
  });

  it("custom gridLevelCount=3: close above both trigger bands → no signal", () => {
    // With N=3, internal levels at fractions [1/3, 2/3] of band.
    // EMA=100, ATR=10 → band [85, 115], levels [95, 105].
    // tolerance = 30 / (2*2) = 7.5. trigger bands = [87.5, 102.5]
    // and [97.5, 112.5]. Above 112.5 → no long signal.
    const strat = new KeltnerGridStrategy({ gridLevelCount: 3 });
    const signal = strat.computeSignal(120, 100, 10, 2);
    expect(signal).toBeNull();
  });

  it("close just inside the touch tolerance of a trigger fires", () => {
    const strat = new KeltnerGridStrategy();
    // 60% level = 103. tolerance = 3.75. close = 105 → distance 2.
    const signal = strat.computeSignal(105, 100, 10, 2);
    expect(signal?.side).toBe("buy");
  });

  it("close just past the touch tolerance still fires (adjacent trigger band overlaps)", () => {
    // With default N=5 the trigger bands OVERLAP (spacing 6 < 2 ×
    // tolerance 3.75 × 2 = 7.5), so any close in the band fires at
    // least one trigger. This test pins that observation.
    const strat = new KeltnerGridStrategy();
    // close = 106 (between 60% level 103 and 80% level 109). distance
    // to 103 = 3 > 2.95 (just under tolerance 3.75). distance to 109
    // = 3 ≤ 3.75 → fires long from 60% trigger? No, distance 3 ≤ 3.75
    // so fires. Actually the 60% trigger is at 103 in LONG mode, the
    // 80% trigger is in SHORT mode. close=106 > EMA=100 → LONG regime.
    // Scans longTriggers [0.2/0.4/0.6] = [91, 97, 103]. distance to
    // 103 = 3 ≤ 3.75 → fires long.
    const signal = strat.computeSignal(106, 100, 10, 2);
    expect(signal?.side).toBe("buy");
  });
});

describe("KeltnerGridStrategy — onCandle wiring", () => {
  // The pure computeSignal is tested above. These tests verify the
  // onCandle wiring: warmup gate, pushClose side effects, EMA state
  // updates, and the pass-through to computeSignal.

  it("onCandle before warmup returns null but still advances the EMA state", () => {
    const strat = new KeltnerGridStrategy();
    const ctx = makeCtx({
      candleIndex: 5,
      candle: baseCandle(100),
      ltfAtr: 10,
    });
    expect(strat.onCandle(ctx)).toBeNull();
    expect(strat.computeEma20()).toBeUndefined(); // only 1 close so far
  });

  it("onCandle at warmup boundary (candleIndex=29) returns null", () => {
    const strat = new KeltnerGridStrategy();
    primeEmaBuffer(strat, 30, 100);
    const ctx = makeCtx({
      candleIndex: 29,
      candle: baseCandle(105),
      ltfAtr: 10,
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("onCandle at warmup+1 (candleIndex=30) can fire a signal", () => {
    // Prime so EMA = 100 (then onCandle advances once). After onCandle:
    // pushClose(close) → EMA = 100 + (close-100)*α. We pick close=103:
    // EMA = 100.286. band [85.286, 115.286], trigger fractions 60%
    // = 103.476. distance(103, 103.476) = 0.476 < tol 3.75 → fires long.
    const strat = new KeltnerGridStrategy();
    primeEmaBuffer(strat, 30, 100);
    const ctx = makeCtx({
      candleIndex: 30,
      candle: baseCandle(103),
      ltfAtr: 10,
    });
    const signal = strat.onCandle(ctx);
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(0.7);
  });

  it("onCandle with missing LTF ATR returns null", () => {
    const strat = new KeltnerGridStrategy();
    primeEmaBuffer(strat, 30, 100);
    const ctx = makeCtx({
      candleIndex: 35,
      candle: baseCandle(103),
      ltfAtr: undefined,
    });
    expect(strat.onCandle(ctx)).toBeNull();
  });

  it("onCandle advances EMA cumulatively across calls", () => {
    const strat = new KeltnerGridStrategy();
    primeEmaBuffer(strat, 30, 100);
    const ctx = makeCtx({
      candleIndex: 50,
      candle: baseCandle(110),
      ltfAtr: 10,
    });
    strat.onCandle(ctx);
    // After pushClose(110): EMA = 100 + 10*α = 100.952.
    expect(strat.computeEma20()).toBeCloseTo(100.952, 2);
  });
});
