import { describe, expect, it } from "bun:test";
import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  ALL_KILL_SWITCHES,
  DEFAULT_DYDX_CEX_CARRY_CONFIG,
  DEFAULT_KILL_SWITCH_CONFIG,
  DEFAULT_PRECONDITION_CONFIG,
  DydxCexCarryStrategy,
  allPreconditionsSatisfied,
  evaluateKillSwitches,
  evaluatePrecondition,
} from "./dydx-cex-carry.js";
import {
  DAY,
  FIXED_NOW,
  HOUR,
  MockFundingSource,
  mkStrategy,
  mkStrategyContext,
  satisfyPreconditions,
} from "./dydx-cex-carry.test-support.js";
import type { KillSwitchConfig, PreconditionConfig } from "./dydx-cex-carry.js";

function preconditionState(start: number, isChainSatisfied = true) {
  return {
    "live-divergence": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
    "chain-incident-clear": {
      satisfied: isChainSatisfied,
      firstSatisfiedMs: isChainSatisfied ? start : undefined,
      lastVerifiedMs: FIXED_NOW,
    },
    "no-recent-governance": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
  };
}

describe("DydxCexCarryStrategy — config invariants", () => {
  it("1. default config matches orchestrator scope lock", () => {
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.market).toBe("BTC-USD");
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.notionalPerLegUsd.equals(ExactRational.from("10000"))).toBe(true);
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.capFraction).toBe(0.025);
  });

  it("2. market = ETH-USD is rejected (deferred)", () => {
    expect(
      () =>
        new DydxCexCarryStrategy({
          fundingSource: new MockFundingSource(),
          market: "ETH-USD",
        }),
    ).toThrow(/ETH-USD/);
  });

  it("3. market = SOL-USD is rejected (halted)", () => {
    expect(
      () =>
        new DydxCexCarryStrategy({
          fundingSource: new MockFundingSource(),
          market: "SOL-USD",
        }),
    ).toThrow(/SOL-USD/);
  });

  it("4. unsupported leverage configuration is rejected", () => {
    expect(() => new DydxCexCarryStrategy({ fundingSource: new MockFundingSource(), leverage: 5 })).toThrow(
      /unsupported config field/,
    );
  });

  it("5. notionalPerLegUsd ≤ 0 throws", () => {
    expect(
      () => new DydxCexCarryStrategy({ fundingSource: new MockFundingSource(), notionalPerLegUsd: "0" }),
    ).toThrow(/notionalPerLegUsd/);
    expect(
      () => new DydxCexCarryStrategy({ fundingSource: new MockFundingSource(), notionalPerLegUsd: "-1" }),
    ).toThrow(/notionalPerLegUsd/);
  });

  it("6. capFraction > 0.5 throws", () => {
    expect(() => mkStrategy(new MockFundingSource(), { capFraction: 0.6 })).toThrow(/capFraction/);
  });

  it("7. capFraction ≤ 0 throws", () => {
    expect(() => mkStrategy(new MockFundingSource(), { capFraction: 0 })).toThrow(/capFraction/);
  });
});

describe("evaluateKillSwitches — pure functional", () => {
  const config: KillSwitchConfig = DEFAULT_KILL_SWITCH_CONFIG;
  const evaluate = (input: Partial<Parameters<typeof evaluateKillSwitches>[0]>) =>
    evaluateKillSwitches(
      {
        indexerStaleMs: 0,
        chainNonFinalizedMs: 0,
        compressedDivergenceDayStreak: 0,
        tickDensityLast7d: 200,
        bybitEuSpotDepthUsd: 200_000,
        ...input,
      },
      config,
    );

  it("8. indexer-stale fires when stale > 5min", () => {
    expect(evaluate({ indexerStaleMs: 6 * 60 * 1000 })["indexer-stale"].engaged).toBe(true);
    expect(evaluate({ indexerStaleMs: 6 * 60 * 1000 })["indexer-stale"].reason).toMatch(/indexer-stale/);
  });
  it("9. indexer-stale fires when no tick ever", () => {
    expect(evaluate({ indexerStaleMs: undefined })["indexer-stale"].engaged).toBe(true);
    expect(evaluate({ indexerStaleMs: undefined })["indexer-stale"].reason).toMatch(/never-tick/);
  });
  it("10. indexer-stale does NOT fire when fresh", () => {
    expect(evaluate({ indexerStaleMs: 60_000 })["indexer-stale"].engaged).toBe(false);
  });
  it("11. chain-non-finalized fires when > 10min", () => {
    expect(evaluate({ chainNonFinalizedMs: 11 * 60 * 1000 })["chain-non-finalized"].engaged).toBe(true);
  });
  it("12. chain-non-finalized fires when no block ever", () => {
    expect(evaluate({ chainNonFinalizedMs: undefined })["chain-non-finalized"].engaged).toBe(true);
    expect(evaluate({ chainNonFinalizedMs: undefined })["chain-non-finalized"].reason).toMatch(
      /never-finalized/,
    );
  });
  it("13. divergence-7d-compression fires when streak=7 AND density ≥ 168", () => {
    expect(
      evaluate({ compressedDivergenceDayStreak: 7, tickDensityLast7d: 168 })["divergence-7d-compression"]
        .engaged,
    ).toBe(true);
    expect(
      evaluate({ compressedDivergenceDayStreak: 7, tickDensityLast7d: 168 })["divergence-7d-compression"]
        .reason,
    ).toMatch(/7d/);
  });
  it("14. divergence-7d-compression does NOT fire when streak=7 but density < 168 (SPARSE-DATA GUARD)", () => {
    expect(
      evaluate({ compressedDivergenceDayStreak: 7, tickDensityLast7d: 50 })["divergence-7d-compression"]
        .engaged,
    ).toBe(false);
    expect(
      evaluate({ compressedDivergenceDayStreak: 7, tickDensityLast7d: 50 })["divergence-7d-compression"]
        .reason,
    ).toMatch(/sparse-data/);
  });
  it("15. divergence-7d-compression does NOT fire when streak < 7", () => {
    expect(evaluate({ compressedDivergenceDayStreak: 6 })["divergence-7d-compression"].engaged).toBe(false);
  });
  it("16. bybit-eu-spot-thin fires when depth < $100k", () => {
    expect(evaluate({ bybitEuSpotDepthUsd: 50_000 })["bybit-eu-spot-thin"].engaged).toBe(true);
  });
  it("17. bybit-eu-spot-thin does NOT fire when depth ≥ $100k", () => {
    expect(evaluate({ bybitEuSpotDepthUsd: 200_000 })["bybit-eu-spot-thin"].engaged).toBe(false);
  });
  it("18. bybit-eu-spot-thin does NOT fire when depth unknown", () => {
    expect(evaluate({ bybitEuSpotDepthUsd: undefined })["bybit-eu-spot-thin"].engaged).toBe(true);
    expect(evaluate({ bybitEuSpotDepthUsd: undefined })["bybit-eu-spot-thin"].reason).toMatch(/unknown/);
  });
  it("fails closed when Bybit EU spot depth is not finite", () => {
    expect(evaluate({ bybitEuSpotDepthUsd: NaN })["bybit-eu-spot-thin"].engaged).toBe(true);
    expect(evaluate({ bybitEuSpotDepthUsd: Infinity })["bybit-eu-spot-thin"].engaged).toBe(true);
  });
});

describe("allPreconditionsSatisfied — duration gates", () => {
  const config: PreconditionConfig = DEFAULT_PRECONDITION_CONFIG;
  it("19. returns ok=true after full duration", () => {
    expect(allPreconditionsSatisfied(preconditionState(FIXED_NOW - 20 * DAY), FIXED_NOW, config).ok).toBe(
      true,
    );
    expect(
      allPreconditionsSatisfied(preconditionState(FIXED_NOW - 20 * DAY), FIXED_NOW, config).reasons,
    ).toEqual([]);
  });
  it("20. returns ok=false when one is not satisfied", () => {
    expect(
      allPreconditionsSatisfied(preconditionState(FIXED_NOW - 20 * DAY, false), FIXED_NOW, config).ok,
    ).toBe(false);
    expect(
      allPreconditionsSatisfied(preconditionState(FIXED_NOW - 20 * DAY, false), FIXED_NOW, config).reasons,
    ).toContain("chain-incident-clear not satisfied");
  });
  it("21. live-divergence needs ≥ 7d sustained", () => {
    expect(allPreconditionsSatisfied(preconditionState(FIXED_NOW - 6 * DAY), FIXED_NOW, config).ok).toBe(
      false,
    );
    expect(
      allPreconditionsSatisfied(preconditionState(FIXED_NOW - 6 * DAY), FIXED_NOW, config).reasons.some(
        (reason) => reason.includes("live-divergence"),
      ),
    ).toBe(true);
  });
  it("22. chain-incident-clear needs ≥ 72h sustained", () => {
    expect(allPreconditionsSatisfied(preconditionState(FIXED_NOW - 60 * HOUR), FIXED_NOW, config).ok).toBe(
      false,
    );
    expect(
      allPreconditionsSatisfied(preconditionState(FIXED_NOW - 60 * HOUR), FIXED_NOW, config).reasons.some(
        (reason) => reason.includes("chain-incident-clear"),
      ),
    ).toBe(true);
  });
  it("23. no-recent-governance needs ≥ 14d sustained", () => {
    expect(allPreconditionsSatisfied(preconditionState(FIXED_NOW - 10 * DAY), FIXED_NOW, config).ok).toBe(
      false,
    );
    expect(
      allPreconditionsSatisfied(preconditionState(FIXED_NOW - 10 * DAY), FIXED_NOW, config).reasons.some(
        (reason) => reason.includes("no-recent-governance"),
      ),
    ).toBe(true);
  });
  it("resets the sustained timer after a failed re-verification", () => {
    const first = evaluatePrecondition(
      "live-divergence",
      { satisfied: false, firstSatisfiedMs: undefined, lastVerifiedMs: undefined },
      FIXED_NOW - 8 * DAY,
      { kind: "live-divergence", satisfied: true },
    );
    const failed = evaluatePrecondition("live-divergence", first, FIXED_NOW - DAY, {
      kind: "live-divergence",
      satisfied: false,
    });
    expect(failed.firstSatisfiedMs).toBeUndefined();
    expect(
      evaluatePrecondition("live-divergence", failed, FIXED_NOW, { kind: "live-divergence", satisfied: true })
        .firstSatisfiedMs,
    ).toBe(FIXED_NOW);
  });
  it("rejects mismatched precondition evidence and recovers a missing prior timestamp", () => {
    expect(() =>
      evaluatePrecondition(
        "live-divergence",
        { satisfied: false, firstSatisfiedMs: undefined, lastVerifiedMs: undefined },
        FIXED_NOW,
        { kind: "chain-incident-clear", satisfied: true },
      ),
    ).toThrow(/mismatch/);
    expect(
      evaluatePrecondition(
        "live-divergence",
        { satisfied: true, firstSatisfiedMs: undefined, lastVerifiedMs: FIXED_NOW - HOUR },
        FIXED_NOW,
        { kind: "live-divergence", satisfied: true },
      ).firstSatisfiedMs,
    ).toBe(FIXED_NOW);
  });
  it("gates entry on all preconditions and changes hasEntered only on position lifecycle", () => {
    const source = new MockFundingSource();
    const strategy = mkStrategy(source);
    strategy.recordLatencySnapshot({ pair: "test", roundTripMsMax: 0, sourceJsonPath: "test" }, FIXED_NOW);
    strategy.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    const context = mkStrategyContext();
    expect(strategy.onCandle(context)).toBeUndefined();
    satisfyPreconditions(strategy);
    expect(strategy.onCandle(context)?.side).toBe("buy");
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
    ).toBeUndefined();
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
    strategy.onPositionClosed("rejected-or-closed");
    expect(strategy.state.hasEntered).toBe(false);
  });
  it("keeps warmup and non-halted position management on their public no-op paths", () => {
    const strategy = mkStrategy(new MockFundingSource());
    const context = mkStrategyContext();
    expect(strategy.onCandle(mkStrategyContext(23))).toBeUndefined();
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
    ).toBeUndefined();
  });
});

void ALL_KILL_SWITCHES;
