import { describe, expect, it } from "bun:test";
import { ExactRational } from "@mm-crypto-bot/numeric";
import { DydxCexCarryPaperTrader } from "./dydx-cex-carry.paper-trade.js";
import { DydxCexCarryStrategy } from "./dydx-cex-carry.js";
import {
  DAY,
  FIXED_NOW,
  HOUR,
  MockFillSimulator,
  MockFundingSource,
  mkSnapshot,
  mkStrategy,
} from "./dydx-cex-carry.test-support.js";
describe("DydxCexCarryPaperTrader — end-to-end", () => {
  it("rejects invalid paper-run durations and reports an unobserved source without a verdict", () => {
    const source = new MockFundingSource();
    const trader = new DydxCexCarryPaperTrader(mkStrategy(source), new MockFillSimulator(), { days: 1 });
    expect(() => trader.runForDays(0, source, FIXED_NOW)).toThrow(/days/);
    source.staleMsOverride = undefined;
    source.chainBlockTsOverride = undefined;
    source.chainBlockHeightOverride = undefined;
    source.bybitEuDepthUsdOverride = undefined;
    const report = trader.runForDays(1, source, FIXED_NOW);
    expect(report.fundingTicksRecorded).toBe(0);
    expect(report.chainHeartbeatsRecorded).toBe(0);
    expect(report.bybitEuDepthObservations).toBe(1);
    expect(report.finalKillSwitchVerdicts["indexer-stale"].reason).toBe("indexer-never-tick");
  });

  it("records latency pause telemetry without treating latency as a position exit", () => {
    const source = new MockFundingSource();
    const strategy = mkStrategy(source, {
      latencySource: { pair: "dydx-bybit-btc", observeRoundTripMs: () => 800 },
    });
    const report = new DydxCexCarryPaperTrader(strategy, new MockFillSimulator(), {
      days: 1,
      tickIntervalMs: HOUR,
    }).runForDays(1, source, FIXED_NOW);
    expect(report.latency?.pausedTickCount).toBeGreaterThan(0);
    expect(report.latency?.maxRoundTripMs).toBe(800);
    expect(report.latency?.minRoundTripMs).toBe(800);
    expect(report.latency?.meanRoundTripMs).toBe(800);
  });

  it("blocks paper fills and funding accrual when latency samples are absent, nonfinite, or negative", () => {
    const absentSamples = new Map<number, number>();
    for (const observeRoundTripMs of [
      (nowMs: number) => absentSamples.get(nowMs),
      (_nowMs: number) => NaN,
      (_nowMs: number) => -1,
    ]) {
      const source = new MockFundingSource();
      const strategy = mkStrategy(source, {
        latencySource: { pair: "dydx-bybit-btc", observeRoundTripMs },
      });
      const report = new DydxCexCarryPaperTrader(strategy, new MockFillSimulator(), {
        days: 1,
        tickIntervalMs: HOUR,
      }).runForDays(1, source, FIXED_NOW);
      expect(report.totalAccruedFundingUsd.isZero()).toBe(true);
      expect(report.totalFillCount).toBe(0);
      expect(strategy.isLatencyPaused()).toBe(true);
    }
  });

  it("reports configured latency without ticks without manufacturing telemetry", () => {
    const source = new MockFundingSource();
    source.staleMsOverride = undefined;
    source.chainBlockTsOverride = undefined;
    source.chainBlockHeightOverride = undefined;
    source.bybitEuDepthUsdOverride = undefined;
    const report = new DydxCexCarryPaperTrader(
      mkStrategy(source, {
        latencySource: { pair: "dydx-bybit-btc", observeRoundTripMs: () => NaN },
      }),
      new MockFillSimulator(),
      { days: 1, tickIntervalMs: HOUR },
    ).runForDays(1, source, FIXED_NOW);
    expect(report.fundingTicksRecorded).toBe(0);
    expect(report.latency?.pausedFraction).toBe(0);
    expect(report.latency?.meanRoundTripMs).toBeUndefined();
  });

  it("records fail-closed paper telemetry when an observed source yields a nonfinite latency sample", () => {
    const source = new MockFundingSource();
    const report = new DydxCexCarryPaperTrader(
      mkStrategy(source, {
        latencySource: { pair: "dydx-bybit-btc", observeRoundTripMs: () => NaN },
      }),
      new MockFillSimulator(),
      { days: 1, tickIntervalMs: HOUR },
    ).runForDays(1, source, FIXED_NOW);
    expect(report.fundingTicksRecorded).toBeGreaterThan(0);
    expect(report.latency?.pausedTickCount).toBeGreaterThan(0);
    expect(report.latency?.meanRoundTripMs).toBeUndefined();
  });

  it("does not create a fill when the public simulator has no usable price", () => {
    const source = new MockFundingSource();
    const simulator = new MockFillSimulator();
    simulator.midPriceUsdOverride = undefined;
    const report = new DydxCexCarryPaperTrader(mkStrategy(source), simulator, {
      days: 1,
      tickIntervalMs: HOUR,
    }).runForDays(1, source, FIXED_NOW);
    expect(report.fundingTicksRecorded).toBeGreaterThan(0);
    expect(report.totalFillCount).toBe(0);
  });

  it("reports observed healthy latency as unpaused paper-trade telemetry", () => {
    const source = new MockFundingSource();
    const report = new DydxCexCarryPaperTrader(
      mkStrategy(source, {
        latencySource: { pair: "dydx-bybit-btc", observeRoundTripMs: () => 100 },
      }),
      new MockFillSimulator(),
      { days: 1, tickIntervalMs: HOUR },
    ).runForDays(1, source, FIXED_NOW);
    expect(report.latency?.pausedTickCount).toBe(0);
    expect(report.latency?.meanRoundTripMs).toBe(100);
  });

  it("reports a chain halt reason through the public paper lifecycle", () => {
    const source = {
      lastTickAgeMs: () => 0,
      lastChainBlockHeight: () => 7,
      lastChainBlockTs: () => FIXED_NOW - 600_001,
      bybitEuSpotDepthUsd: () => 200_000,
      subscribe: () => ({
        close: () => {
          void 0;
        },
      }),
      health: () => ({ lastTickMs: FIXED_NOW, chainBlockHeight: 7 }),
    };
    const report = new DydxCexCarryPaperTrader(
      new DydxCexCarryStrategy({ fundingSource: source }),
      new MockFillSimulator(),
      {
        days: 1,
        tickIntervalMs: HOUR,
      },
    ).runForDays(1, source, FIXED_NOW);
    expect(report.halted).toBe(true);
    expect(report.haltReason).toMatch(/chain-stale/);
  });

  it("reports a compression halt reason through the public paper lifecycle", () => {
    const source = new MockFundingSource();
    const strategy = mkStrategy(source);
    strategy.recordLatencySnapshot({ pair: "test", roundTripMsMax: 0, sourceJsonPath: "test" }, FIXED_NOW);
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    for (let day = 0; day < 8; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const timestamp = FIXED_NOW + (day * 24 + hour) * HOUR;
        source.lastTickMsOverride = timestamp;
        source.chainBlockTsOverride = timestamp;
        strategy.recordFundingTick(
          mkSnapshot("BTC-USD", timestamp, "0"),
          mkSnapshot("BTC-USD", timestamp, "0"),
          timestamp,
        );
      }
    }
    const report = new DydxCexCarryPaperTrader(strategy, new MockFillSimulator(), {
      days: 1,
      tickIntervalMs: HOUR,
    }).runForDays(1, source, FIXED_NOW + 8 * DAY);
    expect(report.halted).toBe(true);
    expect(report.haltReason).toMatch(/compressed-streak/);
  });

  it("30. 7-day paper-trade run produces a clean report", () => {
    const source = new MockFundingSource();
    const trader = new DydxCexCarryPaperTrader(mkStrategy(source), new MockFillSimulator(), {
      days: 7,
      tickIntervalMs: HOUR,
    });
    const report = trader.runForDays(7, source, FIXED_NOW);
    expect(report.market).toBe("BTC-USD");
    expect(report.daysCompleted).toBe(7);
    expect(report.fundingTicksRecorded).toBeGreaterThan(0);
    expect(report.halted).toBe(false);
  });

  it("31. indexer-stale during run halts and populates haltReason", () => {
    const source = new MockFundingSource();
    source.staleMsOverride = 6 * 60 * 1000;
    const report = new DydxCexCarryPaperTrader(mkStrategy(source), new MockFillSimulator(), {
      days: 7,
      tickIntervalMs: HOUR,
    }).runForDays(7, source, FIXED_NOW);
    expect(report.halted).toBe(true);
    expect(report.haltReason).toMatch(/indexer-stale/);
  });

  it("32. bybit-eu-thin blocks funding rather than reducing notional", () => {
    const source = new MockFundingSource();
    source.bybitEuDepthUsdOverride = 50_000;
    const strategy = mkStrategy(source);
    strategy.recordBybitEuLiquidity("BTC-USD", 50_000, FIXED_NOW);
    strategy.recordLatencySnapshot({ pair: "test", roundTripMsMax: 0, sourceJsonPath: "test" }, FIXED_NOW);
    expect(strategy.effectiveNotionalUsd().equals(ExactRational.from("10000"))).toBe(true);
    expect(
      strategy
        .recordFundingTick(
          mkSnapshot("BTC-USD", FIXED_NOW, "0.001"),
          mkSnapshot("BTC-USD", FIXED_NOW, "0.0001"),
          FIXED_NOW,
        )
        .isZero(),
    ).toBe(true);
  });

  it("33. funding accrual is zero when halted", () => {
    const source = new MockFundingSource();
    source.staleMsOverride = 10 * 60 * 1000;
    const strategy = mkStrategy(source);
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    expect(
      strategy
        .recordFundingTick(
          mkSnapshot("BTC-USD", FIXED_NOW, "0.001"),
          mkSnapshot("BTC-USD", FIXED_NOW, "0.0001", undefined),
          FIXED_NOW,
        )
        .isZero(),
    ).toBe(true);
  });
});
