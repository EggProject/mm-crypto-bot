import { describe, expect, it } from "vitest";

import type { Bar, Signal } from "./types.js";
import { SignalCenterV1 } from "./signal-center-v1.js";
import type { StrategyPlugin } from "./strategy-registry.js";

const bar: Bar = { timestamp: 1_700_000_000_000, open: 1, high: 1, low: 1, close: 1, volume: 1 };

function createAsyncPlugin(): StrategyPlugin & { readonly barsProcessed: number } {
  let barsProcessed = 0;
  return {
    metadata: {
      name: "async-plugin",
      version: "1",
      edgeClass: "mixed",
      capitalRequirement: 0,
      maxAggregateEffectiveLeverage: 10,
      onBarMode: "async",
    },
    get barsProcessed(): number {
      return barsProcessed;
    },
    subscribe: () => {
      /*
       * no subscriptions
       */
    },
    onBar: async () => {
      await Promise.resolve();
      barsProcessed += 1;
    },
    validateConfig: () => ({ ok: true, value: undefined }),
    reset: () => {
      barsProcessed = 0;
    },
  };
}

const residualSignals: readonly Signal[] = [
  { kind: "carry", source: "carry", fundingRate: 0.001, regime: "high" },
  { kind: "factor", source: "factor", factor: 1, regime: "accumulation", zScore: 1 },
  {
    kind: "funding-snapshot",
    source: "funding",
    asset: "BTC",
    hl8h: 1,
    bz: 1,
    by: 1,
    ok: 1,
    spreadMax: 0,
    predictedGap: 0,
    timestamp: bar.timestamp,
  },
];

describe("SignalCenterV1 residual lifecycle coverage", () => {
  it("subscribes central consumers for carry, factor, and funding snapshots", () => {
    const signalCenter = new SignalCenterV1();
    expect(signalCenter.bus.subscribersForKind("carry")).toBe(1);
    expect(signalCenter.bus.subscribersForKind("factor")).toBe(1);
    expect(signalCenter.bus.subscribersForKind("funding-snapshot")).toBe(1);
    for (const signal of residualSignals) signalCenter.bus.emit(signal);
    expect(signalCenter.busEmissions).toBe(3);
    expect(signalCenter.bus.snapshot()).toEqual(residualSignals);
  });

  it("awaits async plugin work through onBarAsync", async () => {
    const signalCenter = new SignalCenterV1();
    const plugin = createAsyncPlugin();
    signalCenter.registerPlugin(plugin);
    signalCenter.start();
    await signalCenter.onBarAsync(bar);
    expect(plugin.barsProcessed).toBe(1);
    expect(signalCenter.barCount).toBe(1);
  });

  it("is a no-op when onBarAsync is called before start", async () => {
    const signalCenter = new SignalCenterV1();
    await signalCenter.onBarAsync(bar);
    expect(signalCenter.barCount).toBe(0);
  });
});
