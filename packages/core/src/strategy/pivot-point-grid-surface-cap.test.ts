import { describe, expect, it } from "bun:test";

import { DEFAULT_PIVOT_GRID_CONFIG, PivotPointGridStrategy } from "./pivot-point-grid.js";
import { LTF_MS, makeCandle, makeContext, seedPivotData } from "./pivot-point-grid.test-support.js";
import { makeSymbol } from "@mm-crypto-bot/shared/types";

describe("PivotPointGridStrategy — strategy surface", () => {
  it("14. name and timeframes are wired correctly for M15 LTF", () => {
    const strat = new PivotPointGridStrategy();
    expect(strat.name).toContain("Pivot Point Grid");
    expect(strat.timeframes).toEqual(["1d", "15m"]);
  });
});

describe("PivotPointGridStrategy — symbol isolation", () => {
  it("does not reuse BTC daily pivots when ETH is interleaved on the same instance", () => {
    const strat = new PivotPointGridStrategy({ maxPositionPctEquity: 1 });
    seedPivotData(strat);
    const timestamp = 1_700_000_000_000 + LTF_MS;

    const ethSignal = strat.onCandle(
      makeContext({
        symbol: makeSymbol("ETH/USDT"),
        candleIndex: 200,
        candle: makeCandle(10, { timestamp }),
      }),
    );
    const btcSignal = strat.onCandle(
      makeContext({
        symbol: makeSymbol("BTC/USDT"),
        candleIndex: 201,
        candle: makeCandle(80, { timestamp: timestamp + LTF_MS }),
      }),
    );

    expect(ethSignal).toBeUndefined();
    expect(btcSignal?.side).toBe("buy");
  });
});

describe("PivotPointGridStrategy — maxPositionPctEquity cap", () => {
  it("15. DEFAULT_PIVOT_GRID_CONFIG.maxPositionPctEquity === 0.04 (productionization envelope)", () => {
    expect(DEFAULT_PIVOT_GRID_CONFIG.maxPositionPctEquity).toBe(0.04);
    // Cap ratio at default: 0.04 / 0.20 = 0.20 (engine cap), so emitted
    // confidence is scaled to 20% of its raw value.
  });

  it("16. default cap (0.04) scales shallow long confidence 0.7 → 0.14", () => {
    const strat = new PivotPointGridStrategy(); // default cap 0.04
    seedPivotData(strat);
    // Pivots: PP=100, S1=92.36, S2=87.64.
    // close=90 sits in the S2..S1 band (87.64 < 90 <= 92.36) → shallow long.
    // capScale = min(1, 0.04 / 0.20) = 0.20. Scaled confidence = 0.7 * 0.20 = 0.14.
    const signal = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(90, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBeCloseTo(0.14, 5);
    // SL / TP / reason fields remain raw (cap only scales confidence).
    expect(signal?.stopLoss).toBeCloseTo(87.64, 2);
    expect(signal?.takeProfit).toBeCloseTo(100, 2);
  });

  it("17. default cap (0.04) scales deep short confidence 1.0 → 0.2", () => {
    const strat = new PivotPointGridStrategy(); // default cap 0.04
    seedPivotData(strat);
    // close=115 > R2 (112.36) → deep short, raw confidence 1.0.
    // capScale = 0.04 / 0.20 = 0.20. Scaled confidence = 1.0 * 0.20 = 0.20.
    const signal = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(115, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("sell");
    expect(signal?.confidence).toBeCloseTo(0.2, 5);
    expect(signal?.stopLoss).toBeCloseTo(120, 2); // R3 (raw, unchanged by cap)
    expect(signal?.takeProfit).toBeCloseTo(100, 2); // PP
  });

  it("18. custom cap (0.02) scales shallow long confidence 0.7 → 0.07", () => {
    const strat = new PivotPointGridStrategy({ maxPositionPctEquity: 0.02 });
    seedPivotData(strat);
    // capScale = 0.02 / 0.20 = 0.10. Scaled confidence = 0.7 * 0.10 = 0.07.
    const signal = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(90, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.confidence).toBeCloseTo(0.07, 5);
  });

  it("19. cap = 1.0 → confidence unchanged (no clamping)", () => {
    const strat = new PivotPointGridStrategy({ maxPositionPctEquity: 1 });
    seedPivotData(strat);
    // capScale = min(1, 1.0 / 0.20) = 1.0 → no scaling.
    const shallow = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(90, { timestamp: 1_700_010_000_000 }),
      }),
    );
    const deep = strat.onCandle(
      makeContext({
        candleIndex: 201,
        candle: makeCandle(85, { timestamp: 1_700_010_900_000 }),
      }),
    );
    expect(shallow?.confidence).toBe(0.7); // unchanged
    expect(deep?.confidence).toBe(1); // unchanged
  });

  it("20. cap > engine max (e.g. 0.5) → capScale clamped to 1.0 (no clamping, never amplifies)", () => {
    const strat = new PivotPointGridStrategy({ maxPositionPctEquity: 0.5 });
    seedPivotData(strat);
    // capScale = min(1, 0.5 / 0.20) = 1.0 → no amplification, raw confidence preserved.
    const shallow = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(90, { timestamp: 1_700_010_000_000 }),
      }),
    );
    const deep = strat.onCandle(
      makeContext({
        candleIndex: 201,
        candle: makeCandle(115, { timestamp: 1_700_010_900_000 }),
      }),
    );
    expect(shallow?.confidence).toBe(0.7); // unchanged
    expect(deep?.confidence).toBe(1); // unchanged
  });

  it("21. middle zone (S1 < close < R1) → undefined signal regardless of cap", () => {
    // Cap is irrelevant when no signal is emitted — middle-zone returns undefined.
    // before any scaling is applied.
    const strat = new PivotPointGridStrategy();
    seedPivotData(strat);
    const signal = strat.onCandle(
      makeContext({
        candleIndex: 200,
        candle: makeCandle(100, { timestamp: 1_700_010_000_000 }),
      }),
    );
    expect(signal).toBeUndefined();
  });
});
