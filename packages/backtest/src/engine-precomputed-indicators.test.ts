import { describe, expect, it } from "bun:test";

import { computeIndicators } from "@mm-crypto-bot/core";
import type { Candle } from "@mm-crypto-bot/shared/types";

import { HistoricalIndicatorCursor, precomputeHistoricalIndicatorTimeline } from "./engine-indicators.js";

const CONFIG = {
  htfDonchianPeriod: 20,
  htfSupertrendPeriod: 10,
  htfSupertrendMultiplier: 3,
  htfEmaFast: 50,
  htfEmaSlow: 200,
  htfAdxPeriod: 14,
  mtfBbPeriod: 20,
  mtfBbStddev: 2,
  mtfAdxPeriod: 14,
  mtfRsiPeriod: 14,
  mtfDonchianPeriod: 20,
  ltfRsiPeriod: 14,
  ltfVolumeMaPeriod: 20,
  ltfAtrPeriod: 14,
} as const;

function candles(count: number, stepMs: number, phase: number): readonly Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.07 + Math.sin((index + phase) / 5) * 3 + Math.cos((index + phase) / 17);
    return {
      timestamp: index * stepMs,
      open: close - Math.sin(index) * 0.2,
      high: close + 1 + (index % 3) * 0.1,
      low: close - 1 - (index % 5) * 0.1,
      close,
      volume: 1000 + (index % 19) * 13,
    };
  });
}

describe("precomputeHistoricalIndicatorTimeline", () => {
  it("is bit-identical to baseline-compatible prefix recomputation at every HTF/MTF/LTF step", () => {
    const htf = candles(260, 86_400_000, 0);
    const mtf = candles(320, 14_400_000, 7);
    const ltf = candles(360, 900_000, 13);
    const timeline = precomputeHistoricalIndicatorTimeline(htf, mtf, ltf, CONFIG);

    for (let index = 0; index < htf.length; index++) {
      expect(timeline.htf.at(index)).toEqual(computeIndicators(htf.slice(0, index + 1), [], [], CONFIG).htf);
    }
    for (let index = 0; index < mtf.length; index++) {
      expect(timeline.mtf.at(index)).toEqual(computeIndicators([], mtf.slice(0, index + 1), [], CONFIG).mtf);
    }
    for (let index = 0; index < ltf.length; index++) {
      expect(timeline.ltf.at(index)).toEqual(computeIndicators([], [], ltf.slice(0, index + 1), CONFIG).ltf);
    }
  });

  it("omits the MTF Donchian channel when an adversarial runtime config lacks that field", () => {
    const config = { ...CONFIG };
    // A boundary guard must handle an absent runtime field even though the static config contract requires it.
    Object.defineProperty(config, "mtfDonchianPeriod", { configurable: true, value: undefined });
    const timeline = precomputeHistoricalIndicatorTimeline([], candles(1, 14_400_000, 0), [], config);

    expect(timeline.mtf).toEqual([{ candleIndex: 0, close: 101 }]);
  });

  it("fails closed when the cursor receives no LTF state for a requested index", () => {
    const cursor = new HistoricalIndicatorCursor({ htf: [], mtf: [], ltf: [] }, [], [], 1, 1);

    expect(() => cursor.stateAt(0, 0)).toThrow("Missing LTF indicator state at index 0.");
  });
});
