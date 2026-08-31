import { describe, expect, it } from "bun:test";
import { ExactRational } from "@mm-crypto-bot/numeric";

import { FIXED_NOW, MockFundingSource, mkSnapshot, mkStrategy } from "./dydx-cex-carry.test-support.js";

describe("DydxCexCarryStrategy fail-closed funding boundary", () => {
  it("rejects an invalid latency-source observation before a funding tick mutates state", () => {
    const strategy = mkStrategy(new MockFundingSource(), {
      latencySource: { pair: "dydx-bybit-btc", observeRoundTripMs: () => NaN },
    });
    const before = strategy.serializeState();

    expect(() => strategy.recordFundingTick(mkSnapshot(), mkSnapshot(), FIXED_NOW)).toThrow(
      /INVALID_LATENCY_SNAPSHOT/,
    );
    expect(strategy.state.latency).toEqual({ status: "invalid", observedAtMs: FIXED_NOW });
    expect(strategy.state.fundingCollectedUsd.toSnapshot()).toEqual(before.fundingCollectedUsd);
    expect(strategy.state.fundingPeriods).toBe(before.fundingPeriods);
    expect(strategy.state.lastMarkPrice).toBeUndefined();
  });

  it("does not accrue funding when the latest Bybit depth observation is unavailable", () => {
    const strategy = mkStrategy(new MockFundingSource());
    strategy.recordLatencySnapshot(
      { pair: "dydx-bybit-btc", roundTripMsMax: 1, sourceJsonPath: "test" },
      FIXED_NOW,
    );
    strategy.recordBybitEuLiquidity("BTC-USD", undefined, FIXED_NOW);

    expect(
      strategy
        .recordFundingTick(
          mkSnapshot("BTC-USD", FIXED_NOW, "0.001"),
          mkSnapshot("BTC-USD", FIXED_NOW, "0.0001"),
          FIXED_NOW,
        )
        .isZero(),
    ).toBe(true);
    expect(strategy.totalFundingUsd().isZero()).toBe(true);
  });

  it("rejects a hostile exact-rational proxy before funding state mutation", () => {
    const strategy = mkStrategy(new MockFundingSource());
    const hostile = new Proxy(ExactRational.from("0.001"), {
      get: () => {
        throw new Error("hostile");
      },
    });
    const before = strategy.serializeState();
    expect(() =>
      strategy.recordFundingTick({ ...mkSnapshot(), fundingRate: hostile }, mkSnapshot(), FIXED_NOW),
    ).toThrow(/INVALID_FUNDING_TICK/);
    expect(strategy.serializeState()).toEqual(before);
  });

  it("rejects a hostile mark-price exact rational before funding state mutation", () => {
    const strategy = mkStrategy(new MockFundingSource());
    const hostile = new Proxy(ExactRational.from("60000"), {
      get: () => {
        throw new Error("hostile");
      },
    });
    const before = strategy.serializeState();
    expect(() =>
      strategy.recordFundingTick({ ...mkSnapshot(), markPrice: hostile }, mkSnapshot(), FIXED_NOW),
    ).toThrow(/INVALID_FUNDING_TICK/);
    expect(strategy.serializeState()).toEqual(before);
  });
});
