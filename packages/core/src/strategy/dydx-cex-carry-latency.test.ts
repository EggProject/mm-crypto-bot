import { describe, expect, it } from "bun:test";

import { DydxCexCarryStrategy } from "./dydx-cex-carry.js";
import {
  FIXED_NOW,
  HOUR,
  MockFundingSource,
  mkSnapshot,
  mkStrategy,
  mkStrategyContext,
  satisfyPreconditions,
} from "./dydx-cex-carry.test-support.js";

class FixedLatencySource {
  observationCount = 0;

  constructor(
    readonly pair: string,
    private roundTripMs: number | undefined,
  ) {}

  observeRoundTripMs(_nowMs: number): number | undefined {
    this.observationCount += 1;
    return this.roundTripMs;
  }
}

describe("DydxCexCarryStrategy — LatencyGate wiring", () => {
  it("34. default latency configuration starts unobserved and fail-closed", () => {
    const strategy = mkStrategy(new MockFundingSource());
    expect(strategy.config.latencyArbThresholdMs).toBe(500);
    expect(strategy.config.latencySource).toBeUndefined();
    expect(strategy.isLatencyPaused()).toBe(true);
  });

  it("35. constructor rejects non-positive latencyArbThresholdMs", () => {
    expect(() => mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 0 })).toThrow(
      /latencyArbThresholdMs/,
    );
    expect(() => mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: -1 })).toThrow(
      /latencyArbThresholdMs/,
    );
  });

  it("36. constructor rejects nonfinite latency thresholds", () => {
    expect(
      () =>
        new DydxCexCarryStrategy({ fundingSource: new MockFundingSource(), latencyArbThresholdMs: Infinity }),
    ).toThrow(/latencyArbThresholdMs/);
    expect(
      () => new DydxCexCarryStrategy({ fundingSource: new MockFundingSource(), latencyArbThresholdMs: NaN }),
    ).toThrow(/latencyArbThresholdMs/);
  });

  it("37. a public null latency source is normalized and remains fail-closed until observed", () => {
    const strategy = mkStrategy(new MockFundingSource());
    const legacyNull = new URLSearchParams().get("latencySource");
    const nullConfigured = new DydxCexCarryStrategy({
      fundingSource: new MockFundingSource(),
      latencySource: legacyNull,
    });
    expect(strategy.isLatencyPaused()).toBe(true);
    expect(strategy.state.latency.status).toBe("unobserved");
    expect(nullConfigured.config.latencySource).toBeUndefined();
    expect(nullConfigured.isLatencyPaused()).toBe(true);
  });

  it("38. recordLatencySnapshot with rtMs > threshold pauses the carry", () => {
    const strategy = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    expect(
      strategy.recordLatencySnapshot(
        { pair: "dydx-bybit-btc", roundTripMsMax: 1200, sourceJsonPath: "live" },
        FIXED_NOW,
      ).carryAllowed,
    ).toBe(false);
    expect(
      strategy.recordLatencySnapshot(
        { pair: "dydx-bybit-btc", roundTripMsMax: 1200, sourceJsonPath: "live" },
        FIXED_NOW,
      ).reason,
    ).toMatch(/1200/);
    expect(strategy.isLatencyPaused()).toBe(true);
    expect(strategy.state.latency).toEqual({ status: "valid", roundTripMs: 1200, observedAtMs: FIXED_NOW });
  });

  it("39. recordLatencySnapshot with rtMs ≤ threshold allows the carry", () => {
    const strategy = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    expect(
      strategy.recordLatencySnapshot(
        { pair: "dydx-bybit-btc", roundTripMsMax: 250, sourceJsonPath: "live" },
        FIXED_NOW,
      ).carryAllowed,
    ).toBe(true);
    expect(
      strategy.recordLatencySnapshot(
        { pair: "dydx-bybit-btc", roundTripMsMax: 250, sourceJsonPath: "live" },
        FIXED_NOW,
      ).reason,
    ).toMatch(/250/);
    expect(strategy.isLatencyPaused()).toBe(false);
  });

  it("40. recordLatencySnapshot with rtMs = threshold (boundary) allows the carry", () => {
    expect(
      mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 }).recordLatencySnapshot(
        { pair: "x", roundTripMsMax: 500, sourceJsonPath: "live" },
        FIXED_NOW,
      ).carryAllowed,
    ).toBe(true);
  });

  it("41. invalid latency snapshot pauses and raises a typed domain error", () => {
    const strategy = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    strategy.recordLatencySnapshot({ pair: "x", roundTripMsMax: 1500, sourceJsonPath: "live" }, FIXED_NOW);
    expect(strategy.isLatencyPaused()).toBe(true);
    expect(() =>
      strategy.recordLatencySnapshot(
        { pair: "x", roundTripMsMax: NaN, sourceJsonPath: "live" },
        FIXED_NOW + 1000,
      ),
    ).toThrow(/INVALID_LATENCY_SNAPSHOT/);
    expect(strategy.isLatencyPaused()).toBe(true);
    expect(strategy.state.latency).toEqual({ status: "invalid", observedAtMs: FIXED_NOW + 1000 });
  });

  it("42. negative latency snapshot pauses and raises a typed domain error", () => {
    const strategy = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    strategy.recordLatencySnapshot({ pair: "x", roundTripMsMax: 100, sourceJsonPath: "live" }, FIXED_NOW);
    expect(strategy.isLatencyPaused()).toBe(false);
    expect(() =>
      strategy.recordLatencySnapshot(
        { pair: "x", roundTripMsMax: -5, sourceJsonPath: "live" },
        FIXED_NOW + 1000,
      ),
    ).toThrow(/INVALID_LATENCY_SNAPSHOT/);
    expect(strategy.isLatencyPaused()).toBe(true);
    expect(strategy.state.latency).toEqual({ status: "invalid", observedAtMs: FIXED_NOW + 1000 });
  });

  it("43. pollLatencySource with null latencySource returns null", () => {
    expect(mkStrategy(new MockFundingSource()).pollLatencySource(FIXED_NOW)).toBeUndefined();
  });

  it("44. pollLatencySource with latencySource updates the gate", () => {
    const source = new FixedLatencySource("dydx-bybit-btc", 800);
    const strategy = mkStrategy(new MockFundingSource(), { latencySource: source });
    const result = strategy.pollLatencySource(FIXED_NOW);
    expect(result).not.toBeUndefined();
    expect(result?.carryAllowed).toBe(false);
    expect(source.observationCount).toBe(1);
    expect(strategy.isLatencyPaused()).toBe(true);
  });

  it("45. invalid latency-source observation pauses and raises a typed domain error", () => {
    const source = new FixedLatencySource("dydx-bybit-btc", undefined);
    const strategy = mkStrategy(new MockFundingSource(), { latencySource: source });
    expect(() => strategy.pollLatencySource(FIXED_NOW)).toThrow(/INVALID_LATENCY_SNAPSHOT/);
    expect(strategy.isLatencyPaused()).toBe(true);
    expect(source.observationCount).toBe(1);
  });

  it("46. recordFundingTick returns 0 when latency paused (no accrual)", () => {
    const strategy = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    strategy.recordLatencySnapshot({ pair: "x", roundTripMsMax: 1200, sourceJsonPath: "live" }, FIXED_NOW);
    expect(
      strategy
        .recordFundingTick(
          mkSnapshot("BTC-USD", FIXED_NOW, "0.001"),
          mkSnapshot("BTC-USD", FIXED_NOW, "0.0002", undefined),
          FIXED_NOW,
        )
        .isZero(),
    ).toBe(true);
  });

  it("47. recordFundingTick with latencySource auto-polls and gates carry", () => {
    const source = new FixedLatencySource("dydx-bybit-btc", 800);
    const strategy = mkStrategy(new MockFundingSource(), { latencySource: source });
    expect(strategy.isLatencyPaused()).toBe(true);
    expect(
      strategy
        .recordFundingTick(
          mkSnapshot("BTC-USD", FIXED_NOW, "0.001"),
          mkSnapshot("BTC-USD", FIXED_NOW, "0.0002", undefined),
          FIXED_NOW,
        )
        .isZero(),
    ).toBe(true);
    expect(source.observationCount).toBe(1);
  });

  it("48. onCandle blocks entry after latency becomes paused", () => {
    const strategy = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    satisfyPreconditions(strategy);
    const context = mkStrategyContext();
    strategy.recordLatencySnapshot({ pair: "x", roundTripMsMax: 100, sourceJsonPath: "live" }, FIXED_NOW);
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    expect(strategy.onCandle(context)?.side).toBe("buy");
    strategy.reset();
    satisfyPreconditions(strategy);
    strategy.recordLatencySnapshot({ pair: "x", roundTripMsMax: 1200, sourceJsonPath: "live" }, FIXED_NOW);
    expect(strategy.onCandle(context)).toBeUndefined();
    expect(strategy.isLatencyPaused()).toBe(true);
  });

  it("49. serializeState/fromSnapshot round-trip preserves latency state", () => {
    const strategy = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    strategy.recordLatencySnapshot(
      { pair: "dydx-bybit-btc", roundTripMsMax: 700, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    const snapshot = strategy.serializeState();
    expect(snapshot.version).toBe(1);
    expect(snapshot.latency).toEqual({ status: "valid", roundTripMs: 700, observedAtMs: FIXED_NOW });
    const restored = DydxCexCarryStrategy.fromSnapshot(strategy.config, snapshot);
    expect(restored.state.latency).toEqual({ status: "valid", roundTripMs: 700, observedAtMs: FIXED_NOW });
    expect(restored.isLatencyPaused()).toBe(true);
  });

  it("fromSnapshot without latency fields rejects the snapshot", () => {
    const strategy = mkStrategy(new MockFundingSource());
    const snapshot = strategy.serializeState();
    const { version: ignoredVersion, ...unversioned } = snapshot;
    void ignoredVersion;
    expect(() => DydxCexCarryStrategy.fromSnapshot(strategy.config, unversioned)).toThrow(/version/);
  });

  it("51. reset() returns latency state to unobserved fail-closed", () => {
    const strategy = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    strategy.recordLatencySnapshot({ pair: "x", roundTripMsMax: 1200, sourceJsonPath: "live" }, FIXED_NOW);
    expect(strategy.isLatencyPaused()).toBe(true);
    strategy.reset();
    expect(strategy.isLatencyPaused()).toBe(true);
    expect(strategy.state.latency.status).toBe("unobserved");
  });

  it("persists unobserved and invalid latency state as fail-closed across restart", () => {
    const latencySource = { pair: "dydx-bybit-btc", observeRoundTripMs: () => 100 };
    const strategy = mkStrategy(new MockFundingSource(), { latencySource });
    expect(strategy.isLatencyPaused()).toBe(true);
    const unobserved = DydxCexCarryStrategy.fromSnapshot(strategy.config, strategy.serializeState());
    expect(unobserved.state.latency.status).toBe("unobserved");
    expect(unobserved.isLatencyPaused()).toBe(true);
    expect(() =>
      strategy.recordLatencySnapshot({ pair: "x", roundTripMsMax: NaN, sourceJsonPath: "live" }, FIXED_NOW),
    ).toThrow(/INVALID_LATENCY_SNAPSHOT/);
    const invalid = DydxCexCarryStrategy.fromSnapshot(strategy.config, strategy.serializeState());
    expect(invalid.state.latency.status).toBe("invalid");
    expect(invalid.isLatencyPaused()).toBe(true);
  });

  it("requires a fresh public latency observation after a restored valid snapshot", () => {
    const strategy = mkStrategy(new MockFundingSource());
    strategy.recordLatencySnapshot(
      { pair: "dydx-bybit-btc", roundTripMsMax: 100, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    expect(strategy.isLatencyPaused()).toBe(false);
    const restored = DydxCexCarryStrategy.fromSnapshot(strategy.config, strategy.serializeState());
    expect(restored.state.latency.status).toBe("valid");
    expect(restored.isLatencyPaused()).toBe(true);
    expect(
      restored.recordLatencySnapshot(
        { pair: "dydx-bybit-btc", roundTripMsMax: 100, sourceJsonPath: "fresh" },
        FIXED_NOW + HOUR,
      ).carryAllowed,
    ).toBe(true);
  });

  it("rejects unknown snapshot versions and unsupported versioned fields", () => {
    const strategy = mkStrategy(new MockFundingSource());
    const snapshot = strategy.serializeState();
    expect(() => DydxCexCarryStrategy.fromSnapshot(strategy.config, { ...snapshot, version: 2 })).toThrow(
      /version/,
    );
    expect(() => DydxCexCarryStrategy.fromSnapshot(strategy.config, { ...snapshot, extra: true })).toThrow(
      /unsupported field/,
    );
  });

  it("52. latency pause does NOT auto-close a held position (entry-block only)", () => {
    const strategy = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    satisfyPreconditions(strategy);
    const context = mkStrategyContext();
    strategy.recordLatencySnapshot({ pair: "x", roundTripMsMax: 100, sourceJsonPath: "live" }, FIXED_NOW);
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    expect(strategy.onCandle(context)?.side).toBe("buy");
    strategy.onPositionOpened({
      side: "buy",
      entryTime: FIXED_NOW,
      entryPrice: 60_000,
      quantity: 1,
      stopLoss: 59_400,
      takeProfit: 6_000_000,
      holdingBars: 0,
    });
    expect(strategy.state.hasEntered).toBe(true);
    strategy.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: 1200, sourceJsonPath: "live" },
      FIXED_NOW + HOUR,
    );
    expect(
      strategy.onCandle({ ...context, candle: { ...context.candle, timestamp: FIXED_NOW + HOUR } }),
    ).toBeUndefined();
    expect(strategy.state.hasEntered).toBe(true);
  });
});
