// packages/core/src/strategy/dydx-cex-carry.test.ts
//
// Phase 25 #2 T2 — unit + integration tests for the dYdX-vs-CEX carry
// strategy + paper-trade runner.
//
// Coverage (≥ 25 tests, all assertions on `bun:test`):
// ============================================================================
// CONFIG-INVARIANT (constructor hard guardrails)
//   1.  Default config matches orchestrator scope lock
//   2.  market = "ETH-USD" rejected (ETH deferred)
//   3.  market = "SOL-USD" rejected (SOL halted)
//   4.  leverage = 5 rejected (1:10 mandate)
//   5.  notionalPerLegUsd ≤ 0 throws
//   6.  capFraction > 0.5 throws
//   7.  capFraction ≤ 0 throws
// ============================================================================
// KILL-SWITCHES (pure-functional evaluator)
//   8.  indexer-stale fires when stale > 5min
//   9.  indexer-stale fires when no tick ever
//   10. indexer-stale does NOT fire when fresh
//   11. chain-non-finalized fires when > 10min
//   12. chain-non-finalized fires when no block ever
//   13. divergence-7d-compression fires when streak=7 AND density ≥ 168
//   14. divergence-7d-compression does NOT fire when streak=7 but density < 168
//       (SPARSE-DATA GUARD — T1 false-positive fix)
//   15. divergence-7d-compression does NOT fire when streak < 7
//   16. bybit-eu-spot-thin fires when depth < $100k
//   17. bybit-eu-spot-thin does NOT fire when depth ≥ $100k
//   18. bybit-eu-spot-thin does NOT fire when depth unknown
// ============================================================================
// PRE-CONDITIONS (3 pre-conditions + duration gates)
//   19. allPreconditionsSatisfied returns ok=true after full duration
//   20. allPreconditionsSatisfied returns ok=false when one is not satisfied
//   21. live-divergence needs ≥ 7d sustained
//   22. chain-incident-clear needs ≥ 72h sustained
//   23. no-recent-governance needs ≥ 14d sustained
// ============================================================================
// STATE PERSISTENCE (across restarts)
//   24. serializeState / fromSnapshot round-trip preserves all sub-trackers
//   25. preconditions state persists across restart (no reset)
//   26. tickDensity persists across restart
//   27. funding periods + lastMarkPrice persist across restart
// ============================================================================
// WIRE-UP INTEGRITY (Phase 19 #1 cap=0.20 BTC anchor)
//   28. BTC-only market assertion (no ETH/SOL plumbing)
//   29. Strategy name includes Phase 25 #2 T2 marker
// ============================================================================
// INTEGRATION (live WS → strategy → paper-trade P&L, mocked exchange)
//   30. End-to-end 7-day paper-trade run with mock source produces report
//   31. Indexer-stale during run halts and populates haltReason
//   32. bybit-eu-thin reduces effective notional by 50%
//   33. Funding accrual is zero when halted
// ============================================================================

import { describe, expect, it } from "bun:test";

import {
  DydxCexCarryStrategy,
  DEFAULT_DYDX_CEX_CARRY_CONFIG,
  ALL_KILL_SWITCHES,
  evaluateKillSwitches,
  allPreconditionsSatisfied,
  newPreconditionsState,
  newTickDensityState,
  newKillSwitchVerdicts,
  type DydxFundingSource,
  type KillSwitchConfig,
  type PreconditionConfig,
  type CarryMarket,
} from "./dydx-cex-carry.js";
import { DEFAULT_KILL_SWITCH_CONFIG, DEFAULT_PRECONDITION_CONFIG } from "./dydx-cex-carry.js";
import { DydxCexCarryPaperTrader, type BybitEuSpotFillSimulator } from "./dydx-cex-carry.paper-trade.js";
import type { FundingSnapshot } from "./funding-snapshot.js";

// ============================================================================
// TEST FIXTURES
// ============================================================================

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FIXED_NOW = Date.UTC(2026, 6, 1, 0, 0, 0); // 2026-07-01T00:00:00Z

/**
 * `MockFundingSource` — controllable funding source for tests.  Tests
 * set `staleMs`, `chainBlockTs`, `bybitEuDepthUsd` to drive the
 * kill-switch evaluator.
 */
class MockFundingSource implements DydxFundingSource {
  staleMsOverride: number | null = 0;
  chainBlockTsOverride: number | null = FIXED_NOW;
  chainBlockHeightOverride: number | null = 1_000_000;
  bybitEuDepthUsdOverride: number | null = 200_000;
  lastTickMsOverride: number | null = FIXED_NOW;
  private subscriptionCount = 0;
  private closeCount = 0;

  subscribe(
    _market: CarryMarket,
    _onTick: (snap: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void,
  ): { readonly close: () => void } {
    this.subscriptionCount += 1;
    return { close: () => { this.closeCount += 1; } };
  }

  lastTickAgeMs(_market: CarryMarket, nowMs: number): number | null {
    if (this.staleMsOverride === null) return null;
    if (this.lastTickMsOverride === null) return null;
    // If the test explicitly set a stale-override, return it; otherwise
    // compute from lastTickMs.
    if (this.staleMsOverride > 0) {
      // We use the override directly (allows tests to set absolute staleness).
      return this.staleMsOverride;
    }
    return nowMs - this.lastTickMsOverride;
  }

  lastChainBlockHeight(_market: CarryMarket): number | null {
    return this.chainBlockHeightOverride;
  }

  lastChainBlockTs(_market: CarryMarket): number | null {
    // In production, the dYdX chain produces a new block every ~1.5s,
    // so the lastBlockTs is always "very recent".  For paper-trade
    // purposes, return "never stale" by using the override (the
    // override is null-able, e.g. for testing the kill-switch).
    return this.chainBlockTsOverride;
  }

  /**
   * `advanceChainTo` — paper-trade helper.  Move the chain block
   * timestamp forward to a given time.  In production, the dYdX
   * chain naturally advances the blockTs; in the paper-trade test
   * we need to drive it explicitly so the chain-non-finalized
   * kill-switch doesn't false-positive on long paper-trade runs.
   */
  advanceChainTo(tsMs: number): void {
    if (this.chainBlockTsOverride === null) return;
    this.chainBlockTsOverride = tsMs;
    this.lastTickMsOverride = tsMs;
  }

  bybitEuSpotDepthUsd(_market: CarryMarket, _nowMs: number): number | null {
    return this.bybitEuDepthUsdOverride;
  }

  health(): { readonly lastTickMs: number | null; readonly chainBlockHeight: number | null } {
    return {
      lastTickMs: this.lastTickMsOverride,
      chainBlockHeight: this.chainBlockHeightOverride,
    };
  }

  // test-only accessors
  get subscriptionCountForTest(): number { return this.subscriptionCount; }
  get closeCountForTest(): number { return this.closeCount; }
}

class MockFillSimulator implements BybitEuSpotFillSimulator {
  midPriceUsdOverride = 60_000;
  slippageBpsOverride = 5;
  depthUsdAt1PctOverride = 200_000;

  slippageBps(_notionalUsd: number, _nowMs: number): number { return this.slippageBpsOverride; }
  depthUsdAt1Pct(_nowMs: number): number | null { return this.depthUsdAt1PctOverride; }
  midPriceUsd(_nowMs: number): number | null { return this.midPriceUsdOverride; }
}

function mkStrategy(source: MockFundingSource, override: Partial<typeof DEFAULT_DYDX_CEX_CARRY_CONFIG> = {}): DydxCexCarryStrategy {
  return new DydxCexCarryStrategy({
    fundingSource: source,
    ...override,
  });
}

function mkSnapshot(
  market: CarryMarket = "BTC-USD",
  fundingTime: number = FIXED_NOW,
  fundingRate = 0,
  markPrice: number | undefined = 60_000,
): FundingSnapshot {
  return {
    fundingTime,
    symbol: market,
    fundingRate,
    ...(markPrice !== undefined ? { markPrice } : {}),
  };
}

// ============================================================================
// CONFIG-INVARIANT (1-8)
// ============================================================================

describe("DydxCexCarryStrategy — config invariants", () => {
  it("1. default config matches orchestrator scope lock", () => {
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.market).toBe("BTC-USD");
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.notionalPerLegUsd).toBe(125_000);
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.capFraction).toBe(0.025);
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.leverage).toBe(10);
  });

  it("2. market = ETH-USD is rejected (deferred)", () => {
    const src = new MockFundingSource();
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      market: "ETH-USD" as unknown as CarryMarket,
    })).toThrow(/ETH-USD/);
  });

  it("3. market = SOL-USD is rejected (halted)", () => {
    const src = new MockFundingSource();
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      market: "SOL-USD" as unknown as CarryMarket,
    })).toThrow(/SOL-USD/);
  });

  it("4. leverage = 5 is rejected (1:10 mandate)", () => {
    const src = new MockFundingSource();
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      leverage: 5 as unknown as 1 | 10,
    })).toThrow(/1:10 HARD GUARDRAIL/);
  });

  it("5. notionalPerLegUsd ≤ 0 throws", () => {
    const src = new MockFundingSource();
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      notionalPerLegUsd: 0,
    })).toThrow(/notionalPerLegUsd/);
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      notionalPerLegUsd: -1,
    })).toThrow(/notionalPerLegUsd/);
  });

  it("6. capFraction > 0.5 throws", () => {
    const src = new MockFundingSource();
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      capFraction: 0.6,
    })).toThrow(/capFraction/);
  });

  it("7. capFraction ≤ 0 throws", () => {
    const src = new MockFundingSource();
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      capFraction: 0,
    })).toThrow(/capFraction/);
  });

});

// ============================================================================
// KILL-SWITCH EVALUATOR (9-19) — pure functional
// ============================================================================

describe("evaluateKillSwitches — pure functional", () => {
  const cfg: KillSwitchConfig = DEFAULT_KILL_SWITCH_CONFIG;

  it("8. indexer-stale fires when stale > 5min", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 6 * 60 * 1000, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["indexer-stale"].engaged).toBe(true);
    expect(v["indexer-stale"].reason).toMatch(/indexer-stale/);
  });

  it("9. indexer-stale fires when no tick ever", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: null, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["indexer-stale"].engaged).toBe(true);
    expect(v["indexer-stale"].reason).toMatch(/never-tick/);
  });

  it("10. indexer-stale does NOT fire when fresh", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 60_000, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["indexer-stale"].engaged).toBe(false);
  });

  it("11. chain-non-finalized fires when > 10min", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 11 * 60 * 1000, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["chain-non-finalized"].engaged).toBe(true);
  });

  it("12. chain-non-finalized fires when no block ever", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: null, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["chain-non-finalized"].engaged).toBe(true);
    expect(v["chain-non-finalized"].reason).toMatch(/never-finalized/);
  });

  it("13. divergence-7d-compression fires when streak=7 AND density ≥ 168", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 7, tickDensityLast7d: 168, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["divergence-7d-compression"].engaged).toBe(true);
    expect(v["divergence-7d-compression"].reason).toMatch(/7d/);
  });

  it("14. divergence-7d-compression does NOT fire when streak=7 but density < 168 (SPARSE-DATA GUARD)", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 7, tickDensityLast7d: 50, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["divergence-7d-compression"].engaged).toBe(false);
    expect(v["divergence-7d-compression"].reason).toMatch(/sparse-data/);
  });

  it("15. divergence-7d-compression does NOT fire when streak < 7", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 6, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["divergence-7d-compression"].engaged).toBe(false);
  });

  it("16. bybit-eu-spot-thin fires when depth < $100k", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 50_000 },
      cfg,
    );
    expect(v["bybit-eu-spot-thin"].engaged).toBe(true);
  });

  it("17. bybit-eu-spot-thin does NOT fire when depth ≥ $100k", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["bybit-eu-spot-thin"].engaged).toBe(false);
  });

  it("18. bybit-eu-spot-thin does NOT fire when depth unknown", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: null },
      cfg,
    );
    expect(v["bybit-eu-spot-thin"].engaged).toBe(false);
    expect(v["bybit-eu-spot-thin"].reason).toMatch(/unknown/);
  });
});

// ============================================================================
// PRE-CONDITIONS (20-24)
// ============================================================================

describe("allPreconditionsSatisfied — duration gates", () => {
  const cfg: PreconditionConfig = DEFAULT_PRECONDITION_CONFIG;

  it("19. returns ok=true after full duration", () => {
    const start = FIXED_NOW - 20 * DAY; // > 14d (no-recent-governance requirement)
    const state = {
      "live-divergence": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
      "chain-incident-clear": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
      "no-recent-governance": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
    };
    const r = allPreconditionsSatisfied(state, FIXED_NOW, cfg);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("20. returns ok=false when one is not satisfied", () => {
    const start = FIXED_NOW - 8 * DAY;
    const state = {
      "live-divergence": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
      "chain-incident-clear": { satisfied: false, firstSatisfiedMs: null, lastVerifiedMs: FIXED_NOW },
      "no-recent-governance": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
    };
    const r = allPreconditionsSatisfied(state, FIXED_NOW, cfg);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("chain-incident-clear not satisfied");
  });

  it("21. live-divergence needs ≥ 7d sustained", () => {
    const start = FIXED_NOW - 6 * DAY; // 1d short
    const state = {
      "live-divergence": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
      "chain-incident-clear": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
      "no-recent-governance": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
    };
    const r = allPreconditionsSatisfied(state, FIXED_NOW, cfg);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("live-divergence"))).toBe(true);
  });

  it("22. chain-incident-clear needs ≥ 72h sustained", () => {
    const start = FIXED_NOW - 60 * HOUR; // 12h short
    const state = {
      "live-divergence": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
      "chain-incident-clear": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
      "no-recent-governance": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
    };
    const r = allPreconditionsSatisfied(state, FIXED_NOW, cfg);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("chain-incident-clear"))).toBe(true);
  });

  it("23. no-recent-governance needs ≥ 14d sustained", () => {
    const start = FIXED_NOW - 10 * DAY; // 4d short
    const state = {
      "live-divergence": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
      "chain-incident-clear": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
      "no-recent-governance": { satisfied: true, firstSatisfiedMs: start, lastVerifiedMs: FIXED_NOW },
    };
    const r = allPreconditionsSatisfied(state, FIXED_NOW, cfg);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("no-recent-governance"))).toBe(true);
  });
});

// ============================================================================
// STATE PERSISTENCE (24-26)
// ============================================================================

describe("DydxCexCarryStrategy — state persistence", () => {
  it("24. serializeState / fromSnapshot round-trip preserves all sub-trackers", () => {
    const src = new MockFundingSource();
    const s1 = mkStrategy(src);
    // Mutate state
    s1.state.fundingCollectedUsd = 1234.5;
    s1.state.rebalanceCount = 3;
    s1.state.fundingPeriods = 9;
    s1.state.lastMarkPrice = 60_500;
    s1.state.tickDensity = { days: [{ day: "2026-07-01", dydxCount: 24, cexCount: 3 }], totalTicksLast7d: 27 };
    s1.state.compressedDayStreak = 2;
    s1.state.firstTickMs = FIXED_NOW;
    s1.state.firstChainBlockMs = FIXED_NOW;
    s1.state.preconditions = {
      "live-divergence": { satisfied: true, firstSatisfiedMs: FIXED_NOW - 8 * DAY, lastVerifiedMs: FIXED_NOW },
      "chain-incident-clear": { satisfied: true, firstSatisfiedMs: FIXED_NOW - 4 * DAY, lastVerifiedMs: FIXED_NOW },
      "no-recent-governance": { satisfied: true, firstSatisfiedMs: FIXED_NOW - 15 * DAY, lastVerifiedMs: FIXED_NOW },
    };

    const snap = s1.serializeState();
    const s2 = DydxCexCarryStrategy.fromSnapshot(
      { ...DEFAULT_DYDX_CEX_CARRY_CONFIG, fundingSource: src },
      snap,
    );

    expect(s2.state.fundingCollectedUsd).toBe(1234.5);
    expect(s2.state.rebalanceCount).toBe(3);
    expect(s2.state.fundingPeriods).toBe(9);
    expect(s2.state.lastMarkPrice).toBe(60_500);
    expect(s2.state.tickDensity.totalTicksLast7d).toBe(27);
    expect(s2.state.compressedDayStreak).toBe(2);
    expect(s2.state.firstTickMs).toBe(FIXED_NOW);
    expect(s2.state.firstChainBlockMs).toBe(FIXED_NOW);
    expect(s2.state.preconditions["live-divergence"].satisfied).toBe(true);
    expect(s2.state.preconditions["chain-incident-clear"].firstSatisfiedMs).toBe(FIXED_NOW - 4 * DAY);
  });

  it("25. preconditions state persists across restart", () => {
    const src = new MockFundingSource();
    const s1 = mkStrategy(src);
    s1.recordPreconditionReverify("chain-incident-clear", true, FIXED_NOW - 4 * DAY);
    s1.recordPreconditionReverify("chain-incident-clear", true, FIXED_NOW - 1 * DAY);
    const s2 = DydxCexCarryStrategy.fromSnapshot(
      { ...DEFAULT_DYDX_CEX_CARRY_CONFIG, fundingSource: src },
      s1.serializeState(),
    );
    expect(s2.state.preconditions["chain-incident-clear"].firstSatisfiedMs).toBe(FIXED_NOW - 4 * DAY);
    expect(s2.state.preconditions["chain-incident-clear"].satisfied).toBe(true);
  });

  it("26. tickDensity persists across restart", () => {
    const src = new MockFundingSource();
    const s1 = mkStrategy(src);
    // Record 3 ticks → state.tickDensity should be populated
    s1.recordFundingTick(mkSnapshot("BTC-USD", FIXED_NOW, 0.0001), mkSnapshot("BTC-USD", FIXED_NOW, 0.0001, undefined), FIXED_NOW);
    const td1 = s1.state.tickDensity.totalTicksLast7d;
    const s2 = DydxCexCarryStrategy.fromSnapshot(
      { ...DEFAULT_DYDX_CEX_CARRY_CONFIG, fundingSource: src },
      s1.serializeState(),
    );
    expect(s2.state.tickDensity.totalTicksLast7d).toBe(td1);
  });
});

// ============================================================================
// WIRE-UP INTEGRITY (28-29) — Phase 19 #1 cap=0.20 BTC anchor
// ============================================================================

describe("DydxCexCarryStrategy — wire-up integrity", () => {
  it("28. BTC-only market assertion (no ETH/SOL plumbing)", () => {
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.market).toBe("BTC-USD");
    // Phase 14B 15% DD target sizing: cap=0.025, notional=$125k
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.capFraction * DEFAULT_DYDX_CEX_CARRY_CONFIG.notionalPerLegUsd).toBe(3125);
  });

  it("29. strategy name includes Phase 25 #2 T2 marker", () => {
    const s = mkStrategy(new MockFundingSource());
    expect(s.name).toMatch(/Phase 25 #2 T2/);
  });
});

// ============================================================================
// INTEGRATION (30-33) — live WS → strategy → paper-trade P&L
// ============================================================================

describe("DydxCexCarryPaperTrader — end-to-end", () => {
  it("30. 7-day paper-trade run produces a clean report", async () => {
    const src = new MockFundingSource();
    const sim = new MockFillSimulator();
    const s = mkStrategy(src);
    // Pre-populate preconditions so the 3 pre-condition tracker has data.
    // Phase 33 cleanup: the auto-promote 7-day gate is gone, but the
    // pre-condition tracker is still used by the 3-precondition kill-switch
    // path on `evaluatePrecondition`; this test seeds it for telemetry.
    s.recordPreconditionReverify("live-divergence", true, FIXED_NOW - 8 * DAY);
    s.recordPreconditionReverify("chain-incident-clear", true, FIXED_NOW - 4 * DAY);
    s.recordPreconditionReverify("no-recent-governance", true, FIXED_NOW - 15 * DAY);
    const trader = new DydxCexCarryPaperTrader(s, sim, { days: 7, tickIntervalMs: HOUR });
    const report = await trader.runForDays(7, src, FIXED_NOW);
    expect(report.market).toBe("BTC-USD");
    expect(report.daysCompleted).toBe(7);
    expect(report.fundingTicksRecorded).toBeGreaterThan(0);
    expect(report.halted).toBe(false);
  });

  it("31. indexer-stale during run halts and populates haltReason", async () => {
    const src = new MockFundingSource();
    const sim = new MockFillSimulator();
    const s = mkStrategy(src);
    src.staleMsOverride = 6 * 60 * 1000; // 6 min > 5 min threshold
    const trader = new DydxCexCarryPaperTrader(s, sim, { days: 7, tickIntervalMs: HOUR });
    const report = await trader.runForDays(7, src, FIXED_NOW);
    expect(report.halted).toBe(true);
    expect(report.haltReason).toMatch(/indexer-stale/);
  });

  it("32. bybit-eu-thin reduces effective notional by 50%", () => {
    const src = new MockFundingSource();
    src.bybitEuDepthUsdOverride = 50_000; // < $100k
    const s = mkStrategy(src);
    // Force kill-switch re-evaluation
    s.recordBybitEuLiquidity("BTC-USD", 50_000, FIXED_NOW);
    expect(s.isSizingReduced()).toBe(true);
    expect(s.effectiveNotionalUsd()).toBe(62_500); // 125k × 0.5
  });

  it("33. funding accrual is zero when halted", () => {
    const src = new MockFundingSource();
    src.staleMsOverride = 10 * 60 * 1000; // 10 min > 5 min
    const s = mkStrategy(src);
    s.recordBybitEuLiquidity("BTC-USD", 200_000, FIXED_NOW);
    // 1e-3 funding rate per hour × $125k = $125 — but should be 0 when halted
    const payment = s.recordFundingTick(
      mkSnapshot("BTC-USD", FIXED_NOW, 0.001),
      mkSnapshot("BTC-USD", FIXED_NOW, 0.0001, undefined),
      FIXED_NOW,
    );
    expect(payment).toBe(0);
  });
});

// ============================================================================
// PHASE 30 — LATENCY GATE LIVE WIRING (34-52)
// ============================================================================
//
// Verifies the LatencyGate is properly wired into the dYdX-vs-CEX carry
// strategy.  The gate is constructed from `recordLatencySnapshot` calls
// (live) or from the `latencySource` poller (per funding tick + per
// candle).  When latency > threshold, the carry is paused: no funding
// accrual, no new entries.

/**
 * `FixedLatencySource` — Phase 30 test fixture.  Returns a fixed
 * round-trip ms on every observation.  Tests can mutate the field
 * to simulate latency spikes.
 */
class FixedLatencySource {
  readonly pair: string;
  rtMs: number | null;
  observationCount = 0;

  constructor(pair: string, rtMs: number | null) {
    this.pair = pair;
    this.rtMs = rtMs;
  }

  observeRoundTripMs(_nowMs: number): number | null {
    this.observationCount += 1;
    return this.rtMs;
  }
}

describe("DydxCexCarryStrategy — LatencyGate (Phase 30 live wiring)", () => {
  it("34. default constructor has latencyArbThresholdMs=500 and latencySource=null", () => {
    const s = mkStrategy(new MockFundingSource());
    expect(s.config.latencyArbThresholdMs).toBe(500);
    expect(s.config.latencySource).toBeNull();
  });

  it("35. constructor rejects non-positive latencyArbThresholdMs", () => {
    const src = new MockFundingSource();
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      latencyArbThresholdMs: 0,
    })).toThrow(/latencyArbThresholdMs/);
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      latencyArbThresholdMs: -1,
    })).toThrow(/latencyArbThresholdMs/);
  });

  it("36. constructor accepts +Infinity to explicitly disable latency gating", () => {
    const src = new MockFundingSource();
    const s = new DydxCexCarryStrategy({
      fundingSource: src,
      latencyArbThresholdMs: Number.POSITIVE_INFINITY,
    });
    expect(s.config.latencyArbThresholdMs).toBe(Number.POSITIVE_INFINITY);
    // Even with a high round-trip snapshot, the gate is disabled.
    const verdict = s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: 100_000, sourceJsonPath: "test" },
      FIXED_NOW,
    );
    expect(verdict.carryAllowed).toBe(true);
  });

  it("37. default LatencyGate is disabled (isLatencyPaused()=false on init)", () => {
    const s = mkStrategy(new MockFundingSource());
    expect(s.isLatencyPaused()).toBe(false);
    expect(s.currentLatencyGate().isCarryAllowed()).toBe(true);
  });

  it("38. recordLatencySnapshot with rtMs > threshold pauses the carry", () => {
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    const verdict = s.recordLatencySnapshot(
      { pair: "dydx-bybit-btc", roundTripMsMax: 1200, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    expect(verdict.carryAllowed).toBe(false);
    expect(verdict.reason).toMatch(/1200/);
    expect(s.isLatencyPaused()).toBe(true);
    expect(s.state.lastLatencyRoundTripMs).toBe(1200);
    expect(s.state.lastLatencySnapshotMs).toBe(FIXED_NOW);
  });

  it("39. recordLatencySnapshot with rtMs ≤ threshold allows the carry", () => {
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    const verdict = s.recordLatencySnapshot(
      { pair: "dydx-bybit-btc", roundTripMsMax: 250, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    expect(verdict.carryAllowed).toBe(true);
    expect(verdict.reason).toMatch(/250/);
    expect(s.isLatencyPaused()).toBe(false);
  });

  it("40. recordLatencySnapshot with rtMs = threshold (boundary) allows the carry", () => {
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    const verdict = s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: 500, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    expect(verdict.carryAllowed).toBe(true);
  });

  it("41. recordLatencySnapshot with invalid (NaN) snapshot keeps existing gate", () => {
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    // First, set a known state — paused (rtMs=1500 > 500).
    s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: 1500, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    expect(s.isLatencyPaused()).toBe(true);
    // Then send an invalid snapshot — should NOT change the gate.
    s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: Number.NaN, sourceJsonPath: "live" },
      FIXED_NOW + 1000,
    );
    expect(s.isLatencyPaused()).toBe(true);
    expect(s.state.lastLatencySnapshotMs).toBe(FIXED_NOW); // unchanged
  });

  it("42. recordLatencySnapshot with negative rtMs keeps existing gate", () => {
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: 100, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    expect(s.isLatencyPaused()).toBe(false);
    s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: -5, sourceJsonPath: "live" },
      FIXED_NOW + 1000,
    );
    expect(s.isLatencyPaused()).toBe(false);
    expect(s.state.lastLatencySnapshotMs).toBe(FIXED_NOW);
  });

  it("43. pollLatencySource with null latencySource returns null", () => {
    const s = mkStrategy(new MockFundingSource());
    expect(s.pollLatencySource(FIXED_NOW)).toBeNull();
  });

  it("44. pollLatencySource with latencySource updates the gate", () => {
    const src = new FixedLatencySource("dydx-bybit-btc", 800);
    const s = mkStrategy(new MockFundingSource(), { latencySource: src });
    const verdict = s.pollLatencySource(FIXED_NOW);
    expect(verdict).not.toBeNull();
    expect(verdict!.carryAllowed).toBe(false); // 800 > 500
    expect(src.observationCount).toBe(1);
    expect(s.isLatencyPaused()).toBe(true);
  });

  it("45. pollLatencySource with latencySource=null (no obs yet) keeps existing gate", () => {
    const src = new FixedLatencySource("dydx-bybit-btc", null);
    const s = mkStrategy(new MockFundingSource(), { latencySource: src });
    const verdict = s.pollLatencySource(FIXED_NOW);
    expect(verdict).not.toBeNull();
    expect(verdict!.reason).toMatch(/not yet observed/);
    expect(s.isLatencyPaused()).toBe(false);
    expect(src.observationCount).toBe(1);
  });

  it("46. recordFundingTick returns 0 when latency paused (no accrual)", () => {
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: 1200, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    const payment = s.recordFundingTick(
      mkSnapshot("BTC-USD", FIXED_NOW, 0.001),
      mkSnapshot("BTC-USD", FIXED_NOW, 0.0002, undefined),
      FIXED_NOW,
    );
    expect(payment).toBe(0);
  });

  it("47. recordFundingTick with latencySource auto-polls and gates carry", () => {
    const src = new FixedLatencySource("dydx-bybit-btc", 800);
    const s = mkStrategy(new MockFundingSource(), { latencySource: src });
    expect(s.isLatencyPaused()).toBe(false); // init state
    const payment = s.recordFundingTick(
      mkSnapshot("BTC-USD", FIXED_NOW, 0.001),
      mkSnapshot("BTC-USD", FIXED_NOW, 0.0002, undefined),
      FIXED_NOW,
    );
    expect(payment).toBe(0); // 800 > 500 → paused
    expect(src.observationCount).toBe(1);
  });

  it("48. onCandle does NOT enter when latency paused (live wire-up integrity)", () => {
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    // Phase 33 cleanup: the auto-promote 7-day paper-trade gate is gone,
    // so we no longer need to force `liveOrdersEnabled = true` to test
    // entry behavior.  The strategy emits an entry signal whenever
    // kill-switches don't halt and latency is not paused.
    // Skip warmup
    const pastWarmup = 25;
    const ctx = {
      candleIndex: pastWarmup,
      candle: { timestamp: FIXED_NOW, open: 60_000, high: 60_500, low: 59_500, close: 60_000, volume: 1000 },
      position: null,
      history: [],
    } as unknown as Parameters<typeof s.onCandle>[0];
    // No latency pause → would enter.
    const sigBefore = s.onCandle(ctx);
    expect(sigBefore?.side).toBe("buy");
    // Reset and pause → should NOT enter.
    s.reset();
    s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: 1200, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    const sigAfter = s.onCandle(ctx);
    expect(sigAfter).toBeNull();
    expect(s.isLatencyPaused()).toBe(true);
  });

  it("49. serializeState/fromSnapshot round-trip preserves latency state", () => {
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    s.recordLatencySnapshot(
      { pair: "dydx-bybit-btc", roundTripMsMax: 700, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    const snap = s.serializeState();
    // The function-bearing gate is NOT serialized (JSON cannot represent
    // functions).  Only the round-trip ms + timestamp are persisted.
    expect((snap as unknown as Record<string, unknown>)["currentLatencyGate"]).toBeUndefined();
    expect(snap.lastLatencyRoundTripMs).toBe(700);
    expect(snap.lastLatencySnapshotMs).toBe(FIXED_NOW);
    // Restore — the gate is reconstructed from round-trip + threshold.
    const s2 = DydxCexCarryStrategy.fromSnapshot(s.config, snap);
    expect(s2.state.lastLatencyRoundTripMs).toBe(700);
    expect(s2.state.lastLatencySnapshotMs).toBe(FIXED_NOW);
    expect(s2.isLatencyPaused()).toBe(true);
    expect(s2.currentLatencyGate().isCarryAllowed()).toBe(false);
  });

  it("50. fromSnapshot with pre-Phase-30 snapshot (no latency fields) loads defaults", () => {
    const s = mkStrategy(new MockFundingSource());
    const snap = s.serializeState();
    // Strip the Phase 30 fields (simulate a pre-Phase-30 persisted snapshot).
    // Use `as unknown as typeof snap` since `undefined` is not assignable
    // to the strict `number | null` field type.
    const prePhase30 = {
      ...snap,
      lastLatencyRoundTripMs: null as number | null,
      lastLatencySnapshotMs: null as number | null,
    };
    const s2 = DydxCexCarryStrategy.fromSnapshot(s.config, prePhase30);
    expect(s2.currentLatencyGate().isCarryAllowed()).toBe(true); // disabled
    expect(s2.state.lastLatencyRoundTripMs).toBeNull();
    expect(s2.state.lastLatencySnapshotMs).toBeNull();
  });

  it("51. reset() returns latency state to default (disabled)", () => {
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: 1200, sourceJsonPath: "live" },
      FIXED_NOW,
    );
    expect(s.isLatencyPaused()).toBe(true);
    s.reset();
    expect(s.isLatencyPaused()).toBe(false);
    expect(s.state.lastLatencyRoundTripMs).toBeNull();
    expect(s.state.lastLatencySnapshotMs).toBeNull();
  });

  it("52. latency pause does NOT auto-close a held position (entry-block only)", () => {
    // Wire-up: latency pause blocks new entries, but does NOT issue
    // a sell.  Existing positions stay open until a kill-switch fires
    // or the position is closed via the engine's normal flow.
    const s = mkStrategy(new MockFundingSource(), { latencyArbThresholdMs: 500 });
    const pastWarmup = 25;
    const ctx = {
      candleIndex: pastWarmup,
      candle: { timestamp: FIXED_NOW, open: 60_000, high: 60_500, low: 59_500, close: 60_000, volume: 1000 },
      position: null,
      history: [],
    } as unknown as Parameters<typeof s.onCandle>[0];
    // First entry.
    const entrySig = s.onCandle(ctx);
    expect(entrySig?.side).toBe("buy");
    expect(s.state.hasEntered).toBe(true);
    // Then pause latency.
    s.recordLatencySnapshot(
      { pair: "x", roundTripMsMax: 1200, sourceJsonPath: "live" },
      FIXED_NOW + HOUR,
    );
    // Next candle: no sell signal — the held position stays.
    const ctx2 = {
      ...ctx,
      candle: { ...ctx.candle, timestamp: FIXED_NOW + HOUR },
    } as unknown as Parameters<typeof s.onCandle>[0];
    const holdSig = s.onCandle(ctx2);
    expect(holdSig).toBeNull();
    expect(s.state.hasEntered).toBe(true);
  });
});

describe("factory helpers", () => {
  it("ALL_KILL_SWITCHES contains exactly 4 entries", () => {
    expect(ALL_KILL_SWITCHES.length).toBe(4);
    expect(ALL_KILL_SWITCHES).toContain("indexer-stale");
    expect(ALL_KILL_SWITCHES).toContain("chain-non-finalized");
    expect(ALL_KILL_SWITCHES).toContain("divergence-7d-compression");
    expect(ALL_KILL_SWITCHES).toContain("bybit-eu-spot-thin");
  });

  it("newPreconditionsState returns 3 entries all unsatisfied", () => {
    const s = newPreconditionsState();
    expect(s["live-divergence"].satisfied).toBe(false);
    expect(s["chain-incident-clear"].satisfied).toBe(false);
    expect(s["no-recent-governance"].satisfied).toBe(false);
  });

  it("newTickDensityState returns empty days + 0 total", () => {
    const s = newTickDensityState();
    expect(s.days).toEqual([]);
    expect(s.totalTicksLast7d).toBe(0);
  });

  it("newKillSwitchVerdicts returns 4 init verdicts", () => {
    const v = newKillSwitchVerdicts();
    for (const id of ALL_KILL_SWITCHES) {
      expect(v[id].engaged).toBe(false);
      expect(v[id].reason).toBe("init");
    }
  });
});

describe("DydxCexCarryStrategy — Phase 35 coverage gaps", () => {
  it("totalFundingUsd = fundingCollectedUsd - rebalanceCostUsd", () => {
    const src = new MockFundingSource();
    const fill = new MockFillSimulator();
    const lat = new FixedLatencySource();
    const s = new DydxCexCarryStrategy({
      fundingSource: src,
      fillSimulator: fill,
      latencySource: lat,
      config: { market: "BTC-USD" },
    });
    // State init: fundingCollected=0, rebalanceCost=0 → 0
    expect(s.totalFundingUsd()).toBe(0);

    // Manipulate state directly (test-only)
    (s as unknown as { state: { fundingCollectedUsd: number; rebalanceCostUsd: number } }).state.fundingCollectedUsd = 1000;
    (s as unknown as { state: { fundingCollectedUsd: number; rebalanceCostUsd: number } }).state.rebalanceCostUsd = 200;
    expect(s.totalFundingUsd()).toBe(800);
  });

  it("resetPreconditions clears the precondition state (forces re-verification)", () => {
    const src = new MockFundingSource();
    const fill = new MockFillSimulator();
    const lat = new FixedLatencySource();
    const s = new DydxCexCarryStrategy({
      fundingSource: src,
      fillSimulator: fill,
      latencySource: lat,
      config: { market: "BTC-USD" },
    });
    // Mark preconditions as satisfied
    const precondsBefore = s.state.preconditions;
    if (precondsBefore["live-divergence"]) {
      precondsBefore["live-divergence"].satisfied = true;
      precondsBefore["live-divergence"].lastVerifiedAtMs = 1_700_000_000_000;
    }
    s.resetPreconditions();
    // A NEW preconditions object is assigned to state.preconditions —
    // we must read the new one from state, not the old reference.
    const precondsAfter = s.state.preconditions;
    expect(precondsAfter).not.toBe(precondsBefore);
    for (const id of Object.keys(precondsAfter) as Array<keyof typeof precondsAfter>) {
      expect(precondsAfter[id].satisfied).toBe(false);
    }
  });

  it("private _haltReason returns 'init' when killSwitchVerdicts is null", () => {
    const src = new MockFundingSource();
    const fill = new MockFillSimulator();
    const lat = new FixedLatencySource();
    const s = new DydxCexCarryStrategy({
      fundingSource: src,
      fillSimulator: fill,
      latencySource: lat,
      config: { market: "BTC-USD" },
    });
    (s as unknown as { state: { killSwitchVerdicts: null } }).state.killSwitchVerdicts = null;
    expect(s["_haltReason"]()).toBe("init");
  });

  it("private _haltReason returns the indexer-stale reason when that verdict is engaged", () => {
    const src = new MockFundingSource();
    const fill = new MockFillSimulator();
    const lat = new FixedLatencySource();
    const s = new DydxCexCarryStrategy({
      fundingSource: src,
      fillSimulator: fill,
      latencySource: lat,
      config: { market: "BTC-USD" },
    });
    s.state.killSwitchVerdicts = newKillSwitchVerdicts();
    s.state.killSwitchVerdicts["indexer-stale"].engaged = true;
    s.state.killSwitchVerdicts["indexer-stale"].reason = "indexer is 600s stale";
    expect(s["_haltReason"]()).toBe("indexer is 600s stale");
  });

  it("private _haltReason returns the chain-non-finalized reason when that verdict is engaged", () => {
    const src = new MockFundingSource();
    const fill = new MockFillSimulator();
    const lat = new FixedLatencySource();
    const s = new DydxCexCarryStrategy({
      fundingSource: src,
      fillSimulator: fill,
      latencySource: lat,
      config: { market: "BTC-USD" },
    });
    s.state.killSwitchVerdicts = newKillSwitchVerdicts();
    s.state.killSwitchVerdicts["chain-non-finalized"].engaged = true;
    s.state.killSwitchVerdicts["chain-non-finalized"].reason = "chain non-finalized 90s";
    expect(s["_haltReason"]()).toBe("chain non-finalized 90s");
  });

  it("private _haltReason returns the divergence-7d-compression reason when that verdict is engaged", () => {
    const src = new MockFundingSource();
    const fill = new MockFillSimulator();
    const lat = new FixedLatencySource();
    const s = new DydxCexCarryStrategy({
      fundingSource: src,
      fillSimulator: fill,
      latencySource: lat,
      config: { market: "BTC-USD" },
    });
    s.state.killSwitchVerdicts = newKillSwitchVerdicts();
    s.state.killSwitchVerdicts["divergence-7d-compression"].engaged = true;
    s.state.killSwitchVerdicts["divergence-7d-compression"].reason = "7d divergence compressed";
    expect(s["_haltReason"]()).toBe("7d divergence compressed");
  });

  it("private _haltReason returns 'unknown' when no specific verdict is engaged", () => {
    const src = new MockFundingSource();
    const fill = new MockFillSimulator();
    const lat = new FixedLatencySource();
    const s = new DydxCexCarryStrategy({
      fundingSource: src,
      fillSimulator: fill,
      latencySource: lat,
      config: { market: "BTC-USD" },
    });
    s.state.killSwitchVerdicts = newKillSwitchVerdicts();
    // No verdicts engaged
    expect(s["_haltReason"]()).toBe("unknown");
  });
});
