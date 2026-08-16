import { describe, expect, it } from "bun:test";

import { computeIndicators } from "@mm-crypto-bot/core";
import type { Candle } from "@mm-crypto-bot/shared/types";

import { precomputeHistoricalIndicatorTimeline } from "./engine.js";

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
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.07 + Math.sin((i + phase) / 5) * 3 + Math.cos((i + phase) / 17);
    return {
      timestamp: i * stepMs,
      open: close - Math.sin(i) * 0.2,
      high: close + 1 + (i % 3) * 0.1,
      low: close - 1 - (i % 5) * 0.1,
      close,
      volume: 1_000 + (i % 19) * 13,
    };
  });
}

describe("precomputeHistoricalIndicatorTimeline", () => {
  it("is bit-identical to legacy prefix recomputation at every HTF/MTF/LTF step", () => {
    const htf = candles(260, 86_400_000, 0);
    const mtf = candles(320, 14_400_000, 7);
    const ltf = candles(360, 900_000, 13);
    const timeline = precomputeHistoricalIndicatorTimeline(htf, mtf, ltf, CONFIG);

    for (let i = 0; i < htf.length; i++) {
      expect(timeline.htf[i]).toEqual(computeIndicators(htf.slice(0, i + 1), [], [], CONFIG).htf);
    }
    for (let i = 0; i < mtf.length; i++) {
      expect(timeline.mtf[i]).toEqual(computeIndicators([], mtf.slice(0, i + 1), [], CONFIG).mtf);
    }
    for (let i = 0; i < ltf.length; i++) {
      expect(timeline.ltf[i]).toEqual(computeIndicators([], [], ltf.slice(0, i + 1), CONFIG).ltf);
    }
  });
});
