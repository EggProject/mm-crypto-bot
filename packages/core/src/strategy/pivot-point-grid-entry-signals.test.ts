import { describe, expect, it } from "bun:test";

import { PivotPointGridStrategy } from "./pivot-point-grid.js";
import { makeCandle, makeContext, seedPivotData } from "./pivot-point-grid.test-support.js";

describe("PivotPointGridStrategy — entry signals", () => {
  it("9. close <= S2 → LONG (deep overshoot) with SL=S3, TP=PP, confidence=1.0 (legacy cap)", () => {
    const strat = new PivotPointGridStrategy({ maxPositionPctEquity: 1 });
    seedPivotData(strat);
    // Pivots: PP=100, S3=80, S2=87.64, S1=92.36, R1=107.64, R2=112.36, R3=120.
    // close=85 < S2 (87.64) → deep long.
    const signal = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(85, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBe(1);
    expect(signal?.stopLoss).toBeCloseTo(80, 2); // S3
    expect(signal?.takeProfit).toBeCloseTo(100, 2); // PP
  });

  it("10. close at S1 boundary (S2 < close <= S1) → LONG (shallow overshoot), confidence=0.7 (legacy cap)", () => {
    const strat = new PivotPointGridStrategy({ maxPositionPctEquity: 1 });
    seedPivotData(strat);
    // close=90 — sits in the S2..S1 band (87.64 < 90 <= 92.36) → shallow long.
    const signal = strat.onCandle(
      makeContext({
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

  it("11. close >= R2 → SHORT (deep overbought) with SL=R3, TP=PP, confidence=1.0 (legacy cap)", () => {
    const strat = new PivotPointGridStrategy({ maxPositionPctEquity: 1 });
    seedPivotData(strat);
    // close=115 > R2 (112.36) → deep short.
    const signal = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(115, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    expect(signal?.confidence).toBe(1);
    expect(signal?.stopLoss).toBeCloseTo(120, 2); // R3
    expect(signal?.takeProfit).toBeCloseTo(100, 2); // PP
  });

  it("12. close at R1 boundary (R1 <= close < R2) → SHORT (shallow overbought), confidence=0.7 (legacy cap)", () => {
    const strat = new PivotPointGridStrategy({ maxPositionPctEquity: 1 });
    seedPivotData(strat);
    // close=108 — in the R1..R2 band (107.64 <= 108 < 112.36) → shallow short.
    const signal = strat.onCandle(
      makeContext({
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

  it("13. middle zone (S1 < close < R1) → no signal (cap irrelevant when undefined)", () => {
    const strat = new PivotPointGridStrategy();
    seedPivotData(strat);
    // close=100 — exactly at PP, well inside S1..R1 → middle zone, no signal.
    const signal = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(100, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).toBeUndefined();
  });
});
