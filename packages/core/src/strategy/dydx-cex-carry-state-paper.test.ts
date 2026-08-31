import { describe, expect, it } from "bun:test";
import { ExactRational } from "@mm-crypto-bot/numeric";
import { DEFAULT_DYDX_CEX_CARRY_CONFIG, DydxCexCarryStrategy } from "./dydx-cex-carry.js";
import {
  DAY,
  FIXED_NOW,
  HOUR,
  MockFundingSource,
  mkSnapshot,
  mkStrategy,
  mkStrategyContext,
} from "./dydx-cex-carry.test-support.js";
describe("DydxCexCarryStrategy — state persistence", () => {
  it("validates and wraps every funding and latency source boundary", () => {
    let wasClosed = false;
    const strategy = new DydxCexCarryStrategy({
      fundingSource: {
        lastTickAgeMs: () => 0,
        lastChainBlockHeight: () => 7,
        lastChainBlockTs: () => FIXED_NOW,
        bybitEuSpotDepthUsd: () => 200_000,
        subscribe: () => ({
          close: () => {
            wasClosed = true;
          },
        }),
        health: () => ({ lastTickMs: FIXED_NOW, chainBlockHeight: 7 }),
      },
      latencySource: { pair: "dydx-bybit-btc", observeRoundTripMs: () => 100 },
    });
    const source = strategy.config.fundingSource;
    expect(source.lastTickAgeMs("BTC-USD", FIXED_NOW)).toBe(0);
    expect(source.lastChainBlockHeight("BTC-USD")).toBe(7);
    expect(source.lastChainBlockTs("BTC-USD")).toBe(FIXED_NOW);
    expect(source.bybitEuSpotDepthUsd("BTC-USD", FIXED_NOW)).toBe(200_000);
    source
      .subscribe("BTC-USD", (snapshots) => {
        void snapshots;
      })
      .close();
    expect(wasClosed).toBe(true);
    expect(source.health()).toEqual({ lastTickMs: FIXED_NOW, chainBlockHeight: 7 });
    expect(strategy.pollLatencySource(FIXED_NOW)?.carryAllowed).toBe(true);
  });
  it("rejects an unsupported carry direction at the unknown config boundary", () => {
    expect(
      () => new DydxCexCarryStrategy({ fundingSource: new MockFundingSource(), direction: "reverse" }),
    ).toThrow(/direction/);
  });
  it("rejects malformed unknown config and malformed snapshots at public boundaries", () => {
    expect(() => new DydxCexCarryStrategy({ fundingSource: {} })).toThrow(/fundingSource/);
    expect(() => DydxCexCarryStrategy.fromSnapshot({ fundingSource: new MockFundingSource() }, {})).toThrow(
      /snapshot/,
    );
  });
  it("rejects hostile nested config values at the unknown boundary", () => {
    const source = new MockFundingSource();
    expect(() => new DydxCexCarryStrategy({ fundingSource: source, latencySource: { pair: "" } })).toThrow(
      /latencySource.pair/,
    );
    expect(() => new DydxCexCarryStrategy({ fundingSource: [] })).toThrow(/fundingSource/);
    expect(
      () =>
        new DydxCexCarryStrategy({
          fundingSource: source,
          killSwitch: { compressionThreshold: "-1" },
        }),
    ).toThrow(/compressionThreshold/);
    expect(
      () =>
        new DydxCexCarryStrategy({
          fundingSource: source,
          killSwitch: { sparseDataMinTicksPer7d: 1.5 },
        }),
    ).toThrow(/sparseDataMinTicksPer7d/);
    expect(() => new DydxCexCarryStrategy({ fundingSource: source, market: 7 })).toThrow(/non-string/);
  });
  it("fails closed for an empty latency snapshot pair at the public boundary", () => {
    const strategy = mkStrategy(new MockFundingSource());
    expect(() =>
      strategy.recordLatencySnapshot(
        { pair: "", roundTripMsMax: 10, sourceJsonPath: "live-latency-source" },
        FIXED_NOW,
      ),
    ).toThrow(/INVALID_LATENCY_SNAPSHOT/);
  });
  it("exposes a frozen state snapshot rather than mutable risk state", () => {
    const state = mkStrategy(new MockFundingSource()).state;
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.preconditions)).toBe(true);
    expect(Object.isFrozen(state.tickDensity.days)).toBe(true);
    expect(Object.isFrozen(state.bybitDepth)).toBe(true);
    expect(state.latency.status).toBe("unobserved");
  });
  it("persists valid and invalid public Bybit depth observations fail-closed", () => {
    const strategy = mkStrategy(new MockFundingSource());
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    const valid = DydxCexCarryStrategy.fromSnapshot(strategy.config, strategy.serializeState());
    expect(valid.state.bybitDepth.status).toBe("valid");
    strategy.recordBybitEuLiquidity("BTC-USD", NaN, FIXED_NOW + 1);
    const invalid = DydxCexCarryStrategy.fromSnapshot(strategy.config, strategy.serializeState());
    expect(invalid.state.bybitDepth.status).toBe("invalid");
    expect(invalid.isHalted()).toBe(true);
  });
  it("fails closed when a public funding source has no chain timestamp", () => {
    const source = new MockFundingSource();
    source.chainBlockTsOverride = undefined;
    const strategy = mkStrategy(source);
    strategy.recordLatencySnapshot({ pair: "test", roundTripMsMax: 0, sourceJsonPath: "test" }, FIXED_NOW);
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    expect(
      strategy
        .recordFundingTick(
          mkSnapshot("BTC-USD", FIXED_NOW, "0.001"),
          mkSnapshot("BTC-USD", FIXED_NOW, "0.0001"),
          FIXED_NOW,
        )
        .isZero(),
    ).toBe(true);
    expect(strategy.isHalted()).toBe(true);
  });

  it("rejects hostile funding input without mutating public state or accruing PnL", () => {
    const strategy = mkStrategy(new MockFundingSource());
    const before = strategy.serializeState();
    const malformed = { fundingTime: FIXED_NOW, symbol: "ETH-USD", fundingRate: 0.001 };
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error("hostile getter");
        },
      },
    );
    expect(() => strategy.recordFundingTick(malformed, mkSnapshot(), FIXED_NOW)).toThrow(
      /INVALID_FUNDING_TICK/,
    );
    expect(strategy.serializeState()).toEqual(before);
    expect(() =>
      strategy.recordFundingTick(
        { fundingTime: NaN, symbol: "BTC-USD", fundingRate: 0.001 },
        mkSnapshot(),
        FIXED_NOW,
      ),
    ).toThrow(/INVALID_FUNDING_TICK/);
    expect(strategy.serializeState()).toEqual(before);
    expect(() =>
      strategy.recordFundingTick(
        { fundingTime: FIXED_NOW, symbol: "BTC-USD", fundingRate: Infinity },
        mkSnapshot(),
        FIXED_NOW,
      ),
    ).toThrow(/INVALID_FUNDING_TICK/);
    expect(strategy.serializeState()).toEqual(before);
    expect(() =>
      strategy.recordFundingTick(
        { fundingTime: FIXED_NOW, symbol: "BTC-USD", fundingRate: 0.001, markPrice: NaN },
        mkSnapshot(),
        FIXED_NOW,
      ),
    ).toThrow(/INVALID_FUNDING_TICK/);
    expect(strategy.serializeState()).toEqual(before);
    expect(() => strategy.recordFundingTick(hostile, mkSnapshot(), FIXED_NOW)).toThrow(
      /INVALID_FUNDING_TICK/,
    );
    expect(strategy.serializeState()).toEqual(before);
    expect(() => strategy.recordFundingTick(undefined, mkSnapshot(), FIXED_NOW)).toThrow(
      /INVALID_FUNDING_TICK/,
    );
    expect(strategy.serializeState()).toEqual(before);
    expect(() => strategy.recordFundingTick(mkSnapshot(), mkSnapshot(), NaN)).toThrow(/INVALID_FUNDING_TICK/);
    expect(strategy.serializeState()).toEqual(before);
  });

  it("requests a public force exit when a kill switch is engaged", () => {
    const source = new MockFundingSource();
    source.staleMsOverride = 6 * 60 * 1000;
    const strategy = mkStrategy(source);
    strategy.recordLatencySnapshot({ pair: "test", roundTripMsMax: 0, sourceJsonPath: "test" }, FIXED_NOW);
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    strategy.recordFundingTick(
      mkSnapshot("BTC-USD", FIXED_NOW, "0.001"),
      mkSnapshot("BTC-USD", FIXED_NOW, "0.0001"),
      FIXED_NOW,
    );
    const context = mkStrategyContext();
    expect(
      strategy.onOpenPositionUpdate({
        openPosition: {
          side: "buy",
          entryTime: FIXED_NOW - HOUR,
          entryPrice: 60_000,
          quantity: 1,
          stopLoss: 59_400,
          takeProfit: 6_000_000,
          holdingBars: 1,
        },
        candle: context.candle,
        candleIndex: context.candleIndex,
        mtfState: context.mtfState,
        pricePrecision: context.pricePrecision,
      }),
    ).toEqual({ forceExit: true, exitPrice: 60_000, reason: "kill_switch" });
  });
  it("24. serializeState / fromSnapshot round-trip preserves all sub-trackers", () => {
    const source = new MockFundingSource();
    const first = mkStrategy(source);
    first.onCandleObserved({
      ...mkStrategyContext(),
      candle: { ...mkStrategyContext().candle, close: 60_500 },
    });
    first.recordLatencySnapshot({ pair: "test", roundTripMsMax: 0, sourceJsonPath: "test" }, FIXED_NOW);
    first.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    first.recordFundingTick(
      mkSnapshot("BTC-USD", FIXED_NOW, "0.001"),
      mkSnapshot("BTC-USD", FIXED_NOW, "0.0001", "60500"),
      FIXED_NOW,
    );
    first.recordChainHeartbeat("BTC-USD", 1_000_000, FIXED_NOW, FIXED_NOW);
    first.recordPreconditionReverify("live-divergence", true, FIXED_NOW - 8 * DAY);
    first.recordPreconditionReverify("chain-incident-clear", true, FIXED_NOW - 4 * DAY);
    first.recordPreconditionReverify("no-recent-governance", true, FIXED_NOW - 15 * DAY);
    const restored = DydxCexCarryStrategy.fromSnapshot(
      { ...DEFAULT_DYDX_CEX_CARRY_CONFIG, fundingSource: source },
      first.serializeState(),
    );
    expect(restored.state.fundingCollectedUsd.equals(first.state.fundingCollectedUsd)).toBe(true);
    expect(restored.state.rebalanceCount).toBe(first.state.rebalanceCount);
    expect(restored.state.fundingPeriods).toBe(first.state.fundingPeriods);
    expect(restored.state.lastMarkPrice?.equals(ExactRational.from("60500"))).toBe(true);
    expect(restored.state.tickDensity.totalTicksLast7d).toBe(first.state.tickDensity.totalTicksLast7d);
    expect(restored.state.compressedDayStreak).toBe(first.state.compressedDayStreak);
    expect(restored.state.firstTickMs).toBe(FIXED_NOW);
    expect(restored.state.firstChainBlockMs).toBe(FIXED_NOW);
    expect(restored.state.preconditions["live-divergence"].satisfied).toBe(true);
    expect(restored.state.preconditions["chain-incident-clear"].firstSatisfiedMs).toBe(FIXED_NOW - 4 * DAY);
  });

  it("25. preconditions state persists across restart", () => {
    const source = new MockFundingSource();
    const first = mkStrategy(source);
    first.recordPreconditionReverify("chain-incident-clear", true, FIXED_NOW - 4 * DAY);
    first.recordPreconditionReverify("chain-incident-clear", true, FIXED_NOW - DAY);
    const restored = DydxCexCarryStrategy.fromSnapshot(
      { ...DEFAULT_DYDX_CEX_CARRY_CONFIG, fundingSource: source },
      first.serializeState(),
    );
    expect(restored.state.preconditions["chain-incident-clear"].firstSatisfiedMs).toBe(FIXED_NOW - 4 * DAY);
    expect(restored.state.preconditions["chain-incident-clear"].satisfied).toBe(true);
  });

  it("26. tickDensity persists across restart", () => {
    const source = new MockFundingSource();
    const first = mkStrategy(source);
    first.recordFundingTick(
      mkSnapshot("BTC-USD", FIXED_NOW, "0.0001"),
      mkSnapshot("BTC-USD", FIXED_NOW, "0.0001", undefined),
      FIXED_NOW,
    );
    const restored = DydxCexCarryStrategy.fromSnapshot(
      { ...DEFAULT_DYDX_CEX_CARRY_CONFIG, fundingSource: source },
      first.serializeState(),
    );
    expect(restored.state.tickDensity.totalTicksLast7d).toBe(first.state.tickDensity.totalTicksLast7d);
  });

  it("rejects malformed persisted state at the public restart boundary", () => {
    const strategy = mkStrategy(new MockFundingSource());
    const snapshot = strategy.serializeState();
    const restore = (candidate: unknown) => DydxCexCarryStrategy.fromSnapshot(strategy.config, candidate);

    expect(() => restore([])).toThrow(/snapshot must be an object/);
    expect(() => restore({ ...snapshot, unsupported: true })).toThrow(/unsupported field/);
    expect(() =>
      restore({ ...snapshot, tickDensity: { ...snapshot.tickDensity, days: "not-an-array" } }),
    ).toThrow(/tickDensity.days/);
    expect(() => restore({ ...snapshot, lastMarkPrice: -1 })).toThrow(/lastMarkPrice/);
    expect(() => restore({ ...snapshot, fundingPeriods: 0.5 })).toThrow(/fundingPeriods/);
    expect(() => restore({ ...snapshot, hasEntered: "true" })).toThrow(/hasEntered/);
    expect(() => restore({ ...snapshot, lastDivergenceDay: 7 })).toThrow(/lastDivergenceDay/);
    expect(() => restore({ ...snapshot, fundingCollectedUsd: Infinity })).toThrow(/fundingCollectedUsd/);
    expect(() => restore({ ...snapshot, latency: { status: "other" } })).toThrow(/latency.status/);
  });
});
