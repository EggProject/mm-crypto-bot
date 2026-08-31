import { describe, expect, it } from "vitest";

import { MAX_ALLOWED_PLUGIN_AGGREGATE_EFFECTIVE_LEVERAGE } from "./strategy-registry.js";
import {
  DEFAULT_SIGNAL_CENTER_V1_BASELINE,
  DEFAULT_SIGNAL_CENTER_V1_CONFIG,
  SignalCenterV1,
  createSignalCenterV1,
} from "./signal-center-v1.js";

describe("SignalCenterV1 — construction & config validation", () => {
  it("constructs with valid default config", () => {
    const signalCenter = new SignalCenterV1();
    expect(signalCenter.config.maxAggregateEffectiveLeverage).toBe(
      DEFAULT_SIGNAL_CENTER_V1_CONFIG.maxAggregateEffectiveLeverage,
    );
    expect(signalCenter.config.initialEquity).toBe(1000);
    expect(signalCenter.isStarted).toBe(false);
  });

  it("constructs with explicit config", () => {
    const signalCenter = new SignalCenterV1({
      initialEquity: 5000,
      maxAggregateEffectiveLeverage: 10,
      symbol: "BTC/USDT",
    });
    expect(signalCenter.config.initialEquity).toBe(5000);
    expect(signalCenter.config.maxAggregateEffectiveLeverage).toBe(10);
    expect(signalCenter.config.symbol).toBe("BTC/USDT");
  });

  it("factory `createSignalCenterV1` mirrors constructor", () => {
    const signalCenter = createSignalCenterV1({ initialEquity: 7500 });
    expect(signalCenter.config.initialEquity).toBe(7500);
  });

  it("rejects maxLeverage > 10 (Layer 1 defense)", () => {
    expect(() => new SignalCenterV1({ maxAggregateEffectiveLeverage: 11 })).toThrow(
      /aggregate effective-exposure limit breach/,
    );
    expect(() => new SignalCenterV1({ maxAggregateEffectiveLeverage: 50 })).toThrow(
      /aggregate effective-exposure limit breach/,
    );
  });

  it("rejects maxLeverage < 1 (Layer 1 defense)", () => {
    expect(() => new SignalCenterV1({ maxAggregateEffectiveLeverage: 0 })).toThrow(
      /maxAggregateEffectiveLeverage must be in \[1, 10\]/,
    );
    expect(() => new SignalCenterV1({ maxAggregateEffectiveLeverage: -5 })).toThrow(
      /maxAggregateEffectiveLeverage must be in \[1, 10\]/,
    );
  });

  it("rejects NaN/Infinity maxLeverage (Layer 1 defense)", () => {
    expect(() => new SignalCenterV1({ maxAggregateEffectiveLeverage: NaN })).toThrow(
      /maxAggregateEffectiveLeverage must be in \[1, 10\]/,
    );
    expect(() => new SignalCenterV1({ maxAggregateEffectiveLeverage: Infinity })).toThrow(
      /maxAggregateEffectiveLeverage must be in \[1, 10\]/,
    );
  });

  it("rejects non-positive initialEquity", () => {
    expect(() => new SignalCenterV1({ initialEquity: 0 })).toThrow(/initialEquity must be positive/);
    expect(() => new SignalCenterV1({ initialEquity: -100 })).toThrow(/initialEquity must be positive/);
  });

  it("rejects invalid leverageInvariant.maxLeverage", () => {
    expect(
      () =>
        new SignalCenterV1({
          leverageInvariant: { maxAggregateEffectiveLeverage: 15, tolerance: 0, warnOnApproach: 0.95 },
        }),
    ).toThrow(/leverageInvariant.maxAggregateEffectiveLeverage must be in \[1, 10\]/);
  });

  it("rejects a valid leverageInvariant cap that does not match the configured cap", () => {
    expect(
      () =>
        new SignalCenterV1({
          maxAggregateEffectiveLeverage: 10,
          leverageInvariant: { maxAggregateEffectiveLeverage: 9, tolerance: 0, warnOnApproach: 0.95 },
        }),
    ).toThrow(/leverageInvariant.maxAggregateEffectiveLeverage must match maxAggregateEffectiveLeverage/);
  });

  it("accepts a matching zero-tolerance leverageInvariant", () => {
    const signalCenter = new SignalCenterV1({
      maxAggregateEffectiveLeverage: 10,
      leverageInvariant: { maxAggregateEffectiveLeverage: 10, tolerance: 0, warnOnApproach: 0.95 },
    });

    expect(signalCenter.config.leverageInvariant.tolerance).toBe(0);
  });

  it("rejects negative, non-finite, and negative-zero leverageInvariant tolerance", () => {
    for (const tolerance of [-0.01, NaN, Infinity, -0]) {
      expect(
        () =>
          new SignalCenterV1({
            leverageInvariant: { maxAggregateEffectiveLeverage: 10, tolerance, warnOnApproach: 0.95 },
          }),
      ).toThrow(/leverageInvariant.tolerance must be exactly 0/);
    }
  });

  it("rejects positive leverageInvariant tolerance instead of allowing float slack", () => {
    expect(
      () =>
        new SignalCenterV1({
          leverageInvariant: { maxAggregateEffectiveLeverage: 10, tolerance: 0.000001, warnOnApproach: 0.95 },
        }),
    ).toThrow(/leverageInvariant.tolerance must be exactly 0/);
  });

  it("rejects non-finite or out-of-range leverageInvariant warning thresholds", () => {
    for (const warnOnApproach of [NaN, -Infinity, -0.01, 1.01]) {
      expect(
        () =>
          new SignalCenterV1({
            leverageInvariant: { maxAggregateEffectiveLeverage: 10, tolerance: 0, warnOnApproach },
          }),
      ).toThrow(/leverageInvariant.warnOnApproach must be finite and in \[0, 1\]/);
    }
  });

  it("exposes DEFAULT_SIGNAL_CENTER_V1_CONFIG with maxLeverage = 10", () => {
    expect(DEFAULT_SIGNAL_CENTER_V1_CONFIG.maxAggregateEffectiveLeverage).toBe(10);
    expect(MAX_ALLOWED_PLUGIN_AGGREGATE_EFFECTIVE_LEVERAGE).toBe(10);
  });

  it("uses the fixed USD 1000 baseline and USD 10000 initial gross-exposure ceiling", () => {
    expect(DEFAULT_SIGNAL_CENTER_V1_BASELINE.initialEquityUsd).toBe(1000);
    expect(DEFAULT_SIGNAL_CENTER_V1_BASELINE.initialGrossExposureCeilingUsd).toBe(10_000);
  });
});
