import { describe, expect, it } from "bun:test";
import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  ALL_KILL_SWITCHES,
  DEFAULT_KILL_SWITCH_CONFIG,
  evaluateKillSwitches,
  newPreconditionsState,
  newKillSwitchVerdicts,
  newTickDensityState,
} from "./dydx-cex-carry.js";
import { DydxCexCarryPaperTrader } from "./dydx-cex-carry.paper-trade.js";
import {
  FIXED_NOW,
  HOUR,
  MockFillSimulator,
  MockFundingSource,
  mkSnapshot,
  mkStrategy,
  satisfyPreconditions,
} from "./dydx-cex-carry.test-support.js";
import type { CarryMarket } from "./dydx-cex-carry.js";
import type { FundingSnapshot } from "./funding-snapshot.js";

describe("factory helpers", () => {
  it("ALL_KILL_SWITCHES contains exactly 4 entries", () => {
    expect(ALL_KILL_SWITCHES).toEqual([
      "indexer-stale",
      "chain-non-finalized",
      "divergence-7d-compression",
      "bybit-eu-spot-thin",
    ]);
    expect(ALL_KILL_SWITCHES).toContain("indexer-stale");
    expect(ALL_KILL_SWITCHES).toContain("chain-non-finalized");
    expect(ALL_KILL_SWITCHES).toContain("divergence-7d-compression");
    expect(ALL_KILL_SWITCHES).toContain("bybit-eu-spot-thin");
  });

  it("newPreconditionsState returns 3 entries all unsatisfied", () => {
    const state = newPreconditionsState();
    expect(state["live-divergence"].satisfied).toBe(false);
    expect(state["chain-incident-clear"].satisfied).toBe(false);
    expect(state["no-recent-governance"].satisfied).toBe(false);
  });

  it("newTickDensityState returns empty days + 0 total", () => {
    const state = newTickDensityState();
    expect(state.days).toEqual([]);
    expect(state.totalTicksLast7d).toBe(0);
  });

  it("newKillSwitchVerdicts returns 4 init verdicts", () => {
    const verdicts = newKillSwitchVerdicts();
    for (const verdict of Object.values(verdicts)) {
      expect(verdict.engaged).toBe(false);
      expect(verdict.reason).toBe("init");
    }
  });
});

describe("DydxCexCarryStrategy funding, precondition, and halt behavior", () => {
  it("totalFundingUsd = fundingCollectedUsd - rebalanceCostUsd", () => {
    const strategy = mkStrategy(new MockFundingSource());
    expect(strategy.totalFundingUsd().equals(ExactRational.from("0"))).toBe(true);
    const payment = strategy.recordFundingTick(
      mkSnapshot("BTC-USD", FIXED_NOW, "0.001"),
      mkSnapshot("BTC-USD", FIXED_NOW, "0.0002"),
      FIXED_NOW,
    );
    expect(strategy.totalFundingUsd().equals(payment)).toBe(true);
  });

  it("resetPreconditions clears the precondition state (forces re-verification)", () => {
    const strategy = mkStrategy(new MockFundingSource());
    satisfyPreconditions(strategy);
    const before = strategy.state.preconditions;
    strategy.resetPreconditions();
    expect(strategy.state.preconditions).not.toBe(before);
    for (const entry of Object.values(strategy.state.preconditions)) expect(entry.satisfied).toBe(false);
  });

  it("starts with explicit non-halted kill-switch verdicts", () => {
    const strategy = mkStrategy(new MockFundingSource());
    expect(strategy.isHalted()).toBe(false);
    expect(strategy.state.killSwitchVerdicts["indexer-stale"].reason).toBe("init");
  });

  it("reports the indexer-stale reason when that verdict is engaged", () => {
    const source = new MockFundingSource();
    source.staleMsOverride = 600_000;
    const strategy = mkStrategy(source);
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    expect(strategy.isHalted()).toBe(true);
    expect(strategy.state.killSwitchVerdicts["indexer-stale"].reason).toMatch(/indexer-stale/);
  });

  it("reports the chain-non-finalized reason when that verdict is engaged", () => {
    const source = new MockFundingSource();
    source.chainBlockTsOverride = FIXED_NOW - 600_001;
    const strategy = mkStrategy(source);
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    expect(strategy.isHalted()).toBe(true);
    expect(strategy.state.killSwitchVerdicts["chain-non-finalized"].reason).toMatch(/chain-stale/);
  });

  it("reports the divergence-7d-compression reason when that verdict is engaged", () => {
    const verdicts = evaluateKillSwitches(
      {
        indexerStaleMs: 0,
        chainNonFinalizedMs: 0,
        compressedDivergenceDayStreak: 7,
        tickDensityLast7d: 168,
        bybitEuSpotDepthUsd: 200_000,
      },
      DEFAULT_KILL_SWITCH_CONFIG,
    );
    expect(verdicts["divergence-7d-compression"].engaged).toBe(true);
    expect(verdicts["divergence-7d-compression"].reason).toMatch(/compressed-streak/);
  });

  it("keeps the public verdict state at init when no kill switch is engaged", () => {
    const verdicts = newKillSwitchVerdicts();
    expect(Object.values(verdicts).some((verdict) => verdict.engaged)).toBe(false);
    expect(verdicts["indexer-stale"].reason).toBe("init");
  });
});

describe("DydxCexCarryPaperTrader subscription and public price behavior", () => {
  it("delivers a subscription callback to the paper trader", () => {
    class CallbackFiringSource extends MockFundingSource {
      override subscribe(
        market: CarryMarket,
        onTick: (snapshot: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void,
      ): { readonly close: () => void } {
        const subscription = super.subscribe(market, onTick);
        onTick({
          dydx: { fundingTime: 0, symbol: market, fundingRate: ExactRational.from("0") },
          cex: { fundingTime: 0, symbol: market, fundingRate: ExactRational.from("0") },
        });
        return subscription;
      }
    }
    const source = new CallbackFiringSource();
    const strategy = mkStrategy(source);
    satisfyPreconditions(strategy);
    const report = new DydxCexCarryPaperTrader(strategy, new MockFillSimulator(), {
      days: 1,
      tickIntervalMs: HOUR,
    }).runForDays(1, source, FIXED_NOW);
    expect(report.daysCompleted).toBe(1);
  });

  it("propagates a non-latency strategy error instead of treating it as a zero accrual", () => {
    const source = new MockFundingSource();
    const strategy = mkStrategy(source);
    expect(() =>
      new DydxCexCarryPaperTrader(strategy, new MockFillSimulator(), { days: 1 }).runForDays(
        1,
        source,
        Number.MAX_SAFE_INTEGER,
      ),
    ).toThrow();
  });

  it("does not fill against zero or negative public mid-price observations", () => {
    for (const price of ["0", "-1"]) {
      const source = new MockFundingSource();
      const fills = new MockFillSimulator();
      fills.midPriceUsdOverride = ExactRational.from(price);
      const strategy = mkStrategy(source, { latencySource: { pair: "test", observeRoundTripMs: () => 0 } });
      satisfyPreconditions(strategy);
      const report = new DydxCexCarryPaperTrader(strategy, fills, {
        days: 1,
        tickIntervalMs: HOUR,
      }).runForDays(1, source, FIXED_NOW);
      expect(report.totalFillCount).toBe(0);
    }
  });
});
