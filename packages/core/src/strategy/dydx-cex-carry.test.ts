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
//   8.  paperTradeDaysRequired < 0 throws
// ============================================================================
// KILL-SWITCHES (pure-functional evaluator)
//   9.  indexer-stale fires when stale > 5min
//   10. indexer-stale fires when no tick ever
//   11. indexer-stale does NOT fire when fresh
//   12. chain-non-finalized fires when > 10min
//   13. chain-non-finalized fires when no block ever
//   14. divergence-7d-compression fires when streak=7 AND density ≥ 168
//   15. divergence-7d-compression does NOT fire when streak=7 but density < 168
//       (SPARSE-DATA GUARD — T1 false-positive fix)
//   16. divergence-7d-compression does NOT fire when streak < 7
//   17. bybit-eu-spot-thin fires when depth < $100k
//   18. bybit-eu-spot-thin does NOT fire when depth ≥ $100k
//   19. bybit-eu-spot-thin does NOT fire when depth unknown
// ============================================================================
// PRE-CONDITIONS (3 pre-conditions + duration gates)
//   20. allPreconditionsSatisfied returns ok=true after full duration
//   21. allPreconditionsSatisfied returns ok=false when one is not satisfied
//   22. live-divergence needs ≥ 7d sustained
//   23. chain-incident-clear needs ≥ 72h sustained
//   24. no-recent-governance needs ≥ 14d sustained
// ============================================================================
// STATE PERSISTENCE (across restarts)
//   25. serializeState / fromSnapshot round-trip preserves all sub-trackers
//   26. preconditions state persists across restart (no reset)
//   27. tickDensity persists across restart
//   28. paperTradeDayCount persists across restart
//   29. liveOrdersEnabled persists across restart
// ============================================================================
// PAPER-TRADE GATE
//   30. Paper-trade gate does NOT open on day 0
//   31. Paper-trade gate opens on day 7 when all 3 pre-conditions satisfied
//   32. Paper-trade gate does NOT open if chain-incident-clear duration < 72h
//   33. Paper-trade gate does NOT open on a 6-day run (orchestrator: 7-day MANDATORY)
// ============================================================================
// WIRE-UP INTEGRITY (Phase 19 #1 cap=0.20 BTC anchor)
//   34. BTC-only market assertion (no ETH/SOL plumbing)
//   35. Strategy name includes Phase 25 #2 T2 marker
// ============================================================================
// INTEGRATION (live WS → strategy → paper-trade P&L, mocked exchange)
//   36. End-to-end 7-day paper-trade run with mock source produces report
//   37. Indexer-stale during run halts and populates haltReason
//   38. bybit-eu-thin reduces effective notional by 50%
//   39. Funding accrual is zero when halted
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
import type { FundingSnapshot } from "./funding-carry.js";

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
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.paperTradeDaysRequired).toBe(7);
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

  it("8. paperTradeDaysRequired < 0 throws", () => {
    const src = new MockFundingSource();
    expect(() => new DydxCexCarryStrategy({
      fundingSource: src,
      paperTradeDaysRequired: -1,
    })).toThrow(/paperTradeDaysRequired/);
  });
});

// ============================================================================
// KILL-SWITCH EVALUATOR (9-19) — pure functional
// ============================================================================

describe("evaluateKillSwitches — pure functional", () => {
  const cfg: KillSwitchConfig = DEFAULT_KILL_SWITCH_CONFIG;

  it("9. indexer-stale fires when stale > 5min", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 6 * 60 * 1000, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["indexer-stale"].engaged).toBe(true);
    expect(v["indexer-stale"].reason).toMatch(/indexer-stale/);
  });

  it("10. indexer-stale fires when no tick ever", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: null, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["indexer-stale"].engaged).toBe(true);
    expect(v["indexer-stale"].reason).toMatch(/never-tick/);
  });

  it("11. indexer-stale does NOT fire when fresh", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 60_000, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["indexer-stale"].engaged).toBe(false);
  });

  it("12. chain-non-finalized fires when > 10min", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 11 * 60 * 1000, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["chain-non-finalized"].engaged).toBe(true);
  });

  it("13. chain-non-finalized fires when no block ever", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: null, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["chain-non-finalized"].engaged).toBe(true);
    expect(v["chain-non-finalized"].reason).toMatch(/never-finalized/);
  });

  it("14. divergence-7d-compression fires when streak=7 AND density ≥ 168", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 7, tickDensityLast7d: 168, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["divergence-7d-compression"].engaged).toBe(true);
    expect(v["divergence-7d-compression"].reason).toMatch(/7d/);
  });

  it("15. divergence-7d-compression does NOT fire when streak=7 but density < 168 (SPARSE-DATA GUARD)", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 7, tickDensityLast7d: 50, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["divergence-7d-compression"].engaged).toBe(false);
    expect(v["divergence-7d-compression"].reason).toMatch(/sparse-data/);
  });

  it("16. divergence-7d-compression does NOT fire when streak < 7", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 6, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["divergence-7d-compression"].engaged).toBe(false);
  });

  it("17. bybit-eu-spot-thin fires when depth < $100k", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 50_000 },
      cfg,
    );
    expect(v["bybit-eu-spot-thin"].engaged).toBe(true);
  });

  it("18. bybit-eu-spot-thin does NOT fire when depth ≥ $100k", () => {
    const v = evaluateKillSwitches(
      { indexerStaleMs: 0, chainNonFinalizedMs: 0, compressedDivergenceDayStreak: 0, tickDensityLast7d: 200, bybitEuSpotDepthUsd: 200_000 },
      cfg,
    );
    expect(v["bybit-eu-spot-thin"].engaged).toBe(false);
  });

  it("19. bybit-eu-spot-thin does NOT fire when depth unknown", () => {
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

  it("20. returns ok=true after full duration", () => {
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

  it("21. returns ok=false when one is not satisfied", () => {
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

  it("22. live-divergence needs ≥ 7d sustained", () => {
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

  it("23. chain-incident-clear needs ≥ 72h sustained", () => {
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

  it("24. no-recent-governance needs ≥ 14d sustained", () => {
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
// STATE PERSISTENCE (25-29)
// ============================================================================

describe("DydxCexCarryStrategy — state persistence", () => {
  it("25. serializeState / fromSnapshot round-trip preserves all sub-trackers", () => {
    const src = new MockFundingSource();
    const s1 = mkStrategy(src);
    // Mutate state
    s1.state.fundingCollectedUsd = 1234.5;
    s1.state.rebalanceCount = 3;
    s1.state.paperTradeDayCount = 5;
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
    expect(s2.state.paperTradeDayCount).toBe(5);
    expect(s2.state.tickDensity.totalTicksLast7d).toBe(27);
    expect(s2.state.compressedDayStreak).toBe(2);
    expect(s2.state.firstTickMs).toBe(FIXED_NOW);
    expect(s2.state.firstChainBlockMs).toBe(FIXED_NOW);
    expect(s2.state.preconditions["live-divergence"].satisfied).toBe(true);
    expect(s2.state.preconditions["chain-incident-clear"].firstSatisfiedMs).toBe(FIXED_NOW - 4 * DAY);
  });

  it("26. preconditions state persists across restart", () => {
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

  it("27. tickDensity persists across restart", () => {
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

  it("28. paperTradeDayCount persists across restart", () => {
    const src = new MockFundingSource();
    const s1 = mkStrategy(src);
    s1.incrementPaperTradeDay(FIXED_NOW);
    s1.incrementPaperTradeDay(FIXED_NOW + DAY);
    s1.incrementPaperTradeDay(FIXED_NOW + 2 * DAY);
    const s2 = DydxCexCarryStrategy.fromSnapshot(
      { ...DEFAULT_DYDX_CEX_CARRY_CONFIG, fundingSource: src },
      s1.serializeState(),
    );
    expect(s2.state.paperTradeDayCount).toBe(3);
  });

  it("29. liveOrdersEnabled persists across restart (gates stay open once cleared)", () => {
    const src = new MockFundingSource();
    const s1 = mkStrategy(src);
    // Pre-populate preconditions at the required durations
    s1.recordPreconditionReverify("live-divergence", true, FIXED_NOW - 8 * DAY);
    s1.recordPreconditionReverify("chain-incident-clear", true, FIXED_NOW - 4 * DAY);
    s1.recordPreconditionReverify("no-recent-governance", true, FIXED_NOW - 15 * DAY);
    // Bump paperTradeDayCount to 7
    for (let i = 0; i < 7; i++) s1.incrementPaperTradeDay(FIXED_NOW + i * DAY);
    expect(s1.state.liveOrdersEnabled).toBe(true);

    const s2 = DydxCexCarryStrategy.fromSnapshot(
      { ...DEFAULT_DYDX_CEX_CARRY_CONFIG, fundingSource: src },
      s1.serializeState(),
    );
    expect(s2.state.liveOrdersEnabled).toBe(true);
  });
});

// ============================================================================
// PAPER-TRADE GATE (30-33)
// ============================================================================

describe("DydxCexCarryStrategy — paper-trade gate", () => {
  function prePopulatePreconditions(s: DydxCexCarryStrategy, nowMs: number): void {
    s.recordPreconditionReverify("live-divergence", true, nowMs - 8 * DAY);
    s.recordPreconditionReverify("chain-incident-clear", true, nowMs - 4 * DAY);
    s.recordPreconditionReverify("no-recent-governance", true, nowMs - 15 * DAY);
  }

  it("30. paper-trade gate does NOT open on day 0", () => {
    const s = mkStrategy(new MockFundingSource());
    prePopulatePreconditions(s, FIXED_NOW);
    s.incrementPaperTradeDay(FIXED_NOW);
    expect(s.state.liveOrdersEnabled).toBe(false);
  });

  it("31. paper-trade gate opens on day 7 when all 3 pre-conditions satisfied", () => {
    const s = mkStrategy(new MockFundingSource());
    prePopulatePreconditions(s, FIXED_NOW);
    let gateOpenedAt: number | null = null;
    for (let i = 0; i < 7; i++) {
      const r = s.incrementPaperTradeDay(FIXED_NOW + i * DAY);
      if (r.gateOpened) gateOpenedAt = FIXED_NOW + i * DAY;
    }
    expect(s.state.liveOrdersEnabled).toBe(true);
    expect(gateOpenedAt).toBe(FIXED_NOW + 6 * DAY);
  });

  it("32. paper-trade gate does NOT open if chain-incident-clear duration < 72h at gate-check time", () => {
    const s = mkStrategy(new MockFundingSource());
    s.recordPreconditionReverify("live-divergence", true, FIXED_NOW - 8 * DAY);
    // chain-incident-clear set 12h ago; gate check happens at FIXED_NOW,
    // so elapsed = 12h < 72h → gate must NOT open.
    s.recordPreconditionReverify("chain-incident-clear", true, FIXED_NOW - 12 * HOUR);
    s.recordPreconditionReverify("no-recent-governance", true, FIXED_NOW - 15 * DAY);
    // Increment 7 days all at FIXED_NOW (no time advance) so the
    // duration gates are evaluated at FIXED_NOW.
    for (let i = 0; i < 7; i++) s.incrementPaperTradeDay(FIXED_NOW);
    expect(s.state.paperTradeDayCount).toBe(7);
    expect(s.state.liveOrdersEnabled).toBe(false);
  });

  it("33. paper-trade gate does NOT open on a 6-day run (orchestrator: 7-day MANDATORY)", () => {
    const s = mkStrategy(new MockFundingSource());
    prePopulatePreconditions(s, FIXED_NOW);
    for (let i = 0; i < 6; i++) s.incrementPaperTradeDay(FIXED_NOW + i * DAY);
    expect(s.state.paperTradeDayCount).toBe(6);
    expect(s.state.liveOrdersEnabled).toBe(false);
  });
});

// ============================================================================
// WIRE-UP INTEGRITY (34-35) — Phase 19 #1 cap=0.20 BTC anchor
// ============================================================================

describe("DydxCexCarryStrategy — wire-up integrity", () => {
  it("34. BTC-only market assertion (no ETH/SOL plumbing)", () => {
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.market).toBe("BTC-USD");
    // Phase 14B 15% DD target sizing: cap=0.025, notional=$125k
    expect(DEFAULT_DYDX_CEX_CARRY_CONFIG.capFraction * DEFAULT_DYDX_CEX_CARRY_CONFIG.notionalPerLegUsd).toBe(3125);
  });

  it("35. strategy name includes Phase 25 #2 T2 marker", () => {
    const s = mkStrategy(new MockFundingSource());
    expect(s.name).toMatch(/Phase 25 #2 T2/);
  });
});

// ============================================================================
// INTEGRATION (36-39) — live WS → strategy → paper-trade P&L
// ============================================================================

describe("DydxCexCarryPaperTrader — end-to-end", () => {
  it("36. 7-day paper-trade run produces a clean report", async () => {
    const src = new MockFundingSource();
    const sim = new MockFillSimulator();
    const s = mkStrategy(src);
    // Pre-populate preconditions so the 7-day gate opens
    s.recordPreconditionReverify("live-divergence", true, FIXED_NOW - 8 * DAY);
    s.recordPreconditionReverify("chain-incident-clear", true, FIXED_NOW - 4 * DAY);
    s.recordPreconditionReverify("no-recent-governance", true, FIXED_NOW - 15 * DAY);
    const trader = new DydxCexCarryPaperTrader(s, sim, { days: 7, tickIntervalMs: HOUR });
    const report = await trader.runForDays(7, src, FIXED_NOW);
    expect(report.market).toBe("BTC-USD");
    expect(report.daysCompleted).toBe(7);
    expect(report.fundingTicksRecorded).toBeGreaterThan(0);
    expect(report.paperTradeGateOpened).toBe(true);
    expect(report.halted).toBe(false);
  });

  it("37. indexer-stale during run halts and populates haltReason", async () => {
    const src = new MockFundingSource();
    const sim = new MockFillSimulator();
    const s = mkStrategy(src);
    src.staleMsOverride = 6 * 60 * 1000; // 6 min > 5 min threshold
    const trader = new DydxCexCarryPaperTrader(s, sim, { days: 7, tickIntervalMs: HOUR });
    const report = await trader.runForDays(7, src, FIXED_NOW);
    expect(report.halted).toBe(true);
    expect(report.haltReason).toMatch(/indexer-stale/);
  });

  it("38. bybit-eu-thin reduces effective notional by 50%", () => {
    const src = new MockFundingSource();
    src.bybitEuDepthUsdOverride = 50_000; // < $100k
    const s = mkStrategy(src);
    // Force kill-switch re-evaluation
    s.recordBybitEuLiquidity("BTC-USD", 50_000, FIXED_NOW);
    expect(s.isSizingReduced()).toBe(true);
    expect(s.effectiveNotionalUsd()).toBe(62_500); // 125k × 0.5
  });

  it("39. funding accrual is zero when halted", () => {
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
// SANITY: ALL_KILL_SWITCHES + factory functions
// ============================================================================

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
