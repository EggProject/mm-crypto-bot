import { describe, expect, it } from "vitest";

import type { Bar, SizingSignal } from "./types.js";
import { SignalCenterV1 } from "./signal-center-v1.js";
import type { StrategyPlugin } from "./strategy-registry.js";

const bar: Bar = { timestamp: 1_700_000_000_000, open: 1, high: 1, low: 1, close: 1, volume: 1 };

function createPlugin(name: string): StrategyPlugin {
  return {
    metadata: {
      name,
      version: "1",
      edgeClass: "sizing",
      capitalRequirement: 0,
      maxAggregateEffectiveLeverage: 10,
    },
    subscribe: () => {
      /*
       * no subscriptions
       */
    },
    onBar: () => {
      /*
       * no per-bar work
       */
    },
    validateConfig: () => ({ ok: true, value: undefined }),
    reset: () => {
      /*
       * no state
       */
    },
  };
}

function sizing(source: string, notional: number): SizingSignal {
  return { kind: "sizing", source, notional, kellyFraction: 1, volMultiplier: 1, timestampMs: bar.timestamp };
}

describe("SignalCenterV1 aggregate risk boundary", () => {
  it("uses the configured 2x aggregate limit during per-bar enforcement", () => {
    const signalCenter = new SignalCenterV1({
      initialEquity: 1000,
      maxAggregateEffectiveLeverage: 2,
      leverageInvariant: { maxAggregateEffectiveLeverage: 2, tolerance: 0, warnOnApproach: 0.95 },
    });
    const first = createPlugin("first");
    const second = createPlugin("second");
    signalCenter.registerPlugin(first);
    signalCenter.registerPlugin(second);
    signalCenter.start();
    signalCenter.bus.emit(sizing("first", 1500));
    signalCenter.bus.emit(sizing("second", 1500));
    signalCenter.onBar(bar);
    expect(signalCenter.getPortfolioRisk().numLeverageBreaches).toBeGreaterThanOrEqual(1);
  });

  it("uses the configured 2x aggregate limit during start validation", () => {
    const signalCenter = new SignalCenterV1({ initialEquity: 1000, maxAggregateEffectiveLeverage: 2 });
    signalCenter.riskEngine.submitSignal({
      kind: "sizing",
      source: "preloaded",
      symbol: "BTC/USDT",
      effectiveNotionalUsd: 3000,
      leverage: 3,
      timestamp: bar.timestamp,
    });
    signalCenter.registerPlugin(createPlugin("only-plugin"));
    expect(() => {
      signalCenter.start();
    }).toThrow(/aggregate effective-exposure/i);
  });

  it("does not permit a divergent leverageInvariant limit", () => {
    expect(
      () =>
        new SignalCenterV1({
          maxAggregateEffectiveLeverage: 2,
          leverageInvariant: { maxAggregateEffectiveLeverage: 3, tolerance: 0, warnOnApproach: 0.95 },
        }),
    ).toThrow(/must match maxAggregateEffectiveLeverage/);
  });

  it("preserves zero sizing and explicit risk metadata at the central boundary", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createPlugin("boundary-plugin"));
    signalCenter.start();
    signalCenter.bus.emit({
      kind: "sizing",
      source: "zero-sizing",
      notional: 0,
      kellyFraction: 0,
      volMultiplier: 0,
    });
    signalCenter.bus.emit({
      kind: "risk",
      source: "explicit-risk",
      varDaily95: 0.1,
      correlationPenalty: 0,
      drawdownLimit: 0.2,
      reason: "explicit reason",
      timestampMs: bar.timestamp,
      breach: true,
    });
    signalCenter.bus.emit({
      kind: "risk",
      source: "default-risk",
      varDaily95: 0.1,
      correlationPenalty: 0,
      drawdownLimit: 0.2,
    });
    expect(signalCenter.getPortfolioRisk().positions[0]?.symbol).toBe("?");
    expect(signalCenter.getPortfolioRisk().positions[0]?.effectiveNotionalUsd).toBe(0);
    expect(signalCenter.signalsSubmitted).toBe(3);
  });
});
