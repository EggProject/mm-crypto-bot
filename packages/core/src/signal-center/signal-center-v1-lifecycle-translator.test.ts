import { describe, expect, it } from "vitest";

import type { Signal, SizingSignal } from "./types.js";
import { toRiskEngineSignal } from "./signal-center-v1-lifecycle.js";

const signalsWithoutTimestamp: readonly Signal[] = [
  { kind: "direction", side: "long", strength: 0.8, source: "direction-source" },
  { kind: "carry", fundingRate: 0.0001, regime: "high", source: "carry-source" },
  { kind: "sizing", kellyFraction: 0.5, volMultiplier: 1, notional: 5000, source: "sizing-source" },
  {
    kind: "risk",
    varDaily95: 0.01,
    correlationPenalty: 0,
    drawdownLimit: 0.1,
    source: "risk-source",
  },
  { kind: "factor", factor: 0.5, regime: "accumulation", zScore: 1.5, source: "factor-source" },
  {
    kind: "funding-snapshot",
    asset: "BTC",
    hl8h: 1,
    bz: 2,
    by: 3,
    ok: 4,
    spreadMax: 3,
    predictedGap: 0,
    timestamp: 1_700_000_000_000,
    source: "funding-source",
  },
];

describe("toRiskEngineSignal — timestamp fallback", () => {
  it("uses deterministic zero when every signal discriminant omits timestampMs", () => {
    for (const signal of signalsWithoutTimestamp) {
      expect(toRiskEngineSignal(signal, "BTC/USDT", 1000).timestamp).toBe(0);
    }
  });

  it("preserves an explicit timestampMs for every signal discriminant", () => {
    const timestampMs = 1_700_000_000_123;
    for (const signal of signalsWithoutTimestamp) {
      expect(toRiskEngineSignal({ ...signal, timestampMs }, "BTC/USDT", 1000).timestamp).toBe(timestampMs);
    }
  });
});

describe("toRiskEngineSignal — sizing boundary", () => {
  it("maps zero notional to zero leverage with an explicit initial equity", () => {
    const signal: SizingSignal = {
      kind: "sizing",
      kellyFraction: 0,
      volMultiplier: 0,
      notional: 0,
      source: "zero-sizing",
    };
    expect(toRiskEngineSignal(signal, "BTC/USDT", 1000)).toMatchObject({ kind: "sizing", leverage: 0 });
  });
});
