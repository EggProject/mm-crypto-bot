// packages/core/src/risk/kelly-adaptive.test.ts — unit tests
//
// ≥10 unit tests covering:
//   1. Sharpe→bucket mapping function (boundary values)
//   2. `nearestBucket` rounding (4 boundaries)
//   3. Daily P&L aggregation correctness
//   4. Rolling Sharpe computation correctness (window boundary, partial window)
//   5. Bucket distribution and average Kelly multiplier
//   6. Walk-forward split logic (IS/OOS dates)
//   7. Edge cases: empty trade list, single trade, all-loss streak,
//      all-win streak, insufficient history fallback
//   8. Integration with KellyPositionSizer (optimizeKelly + adaptive)
//   9. Determinism: same input → same output

import { describe, expect, it } from "bun:test";

import type { Trade } from "@mm-crypto-bot/shared/types";

import {
  aggregateTradesToDailyPnl,
  averageKellyMultiplier,
  bucketDistribution,
  compareAdaptiveVsStaticKelly,
  computeAdaptiveKelly,
  hasAllLossStreak,
  nearestBucket,
  rollingSharpeFromDailyPnl,
  runAdaptiveWalkForwardValidation,
  sharpeToKellyBucket,
  SHARPE_BUCKET_HIGH_BOUNDARY,
  SHARPE_BUCKET_LOW_BOUNDARY,
  SHARPE_BUCKET_MID_BOUNDARY,
  type AdaptiveKellyBucket,
  type AdaptiveKellyResult,
} from "./kelly-adaptive.js";
import {
  DEFAULT_KELLY_OPT_CONFIG,
  applyRiskCaps,
  fractionalKelly,
  fullKellyFraction,
  optimizeKelly,
} from "./kelly-position-sizer.js";

// ----------------------------------------------------------------------
// Test helpers — match the conventions of kelly-position-sizer.test.ts
// ----------------------------------------------------------------------

const DAY_MS: number = 24 * 60 * 60 * 1000;

function mkTrade(
  entryOffsetDays: number,
  exitOffsetDays: number,
  pnlUsd: number,
  notionalUsd = 2000,
): Trade {
  return {
    symbol: "BTC/USDT" as never,
    side: pnlUsd >= 0 ? "buy" : "sell",
    entryTime: 1_704_067_200_000 + entryOffsetDays * DAY_MS,
    exitTime: 1_704_067_200_000 + exitOffsetDays * DAY_MS,
    entryPrice: 50_000,
    exitPrice: pnlUsd >= 0 ? 50_000 + Math.abs(pnlUsd) : 50_000 - Math.abs(pnlUsd),
    quantity: notionalUsd / 50_000,
    notionalUsd,
    pnlUsd,
    pnlPct: pnlUsd / notionalUsd,
    feesUsd: 4,
    exitReason: "time_exit",
  };
}

/**
 * Build a stationary-position-size trade stream with deterministic win
 * pattern: trade i wins iff (i % 10) < 6 (i.e., 60% win rate). Each win
 * pays `winPnl`, each loss costs `lossPnl`.
 */
function mkStream(count: number, winPnl: number, lossPnl: number): Trade[] {
  const trades: Trade[] = [];
  for (let i = 0; i < count; i++) {
    const pnl = (i % 10) < 6 ? winPnl : lossPnl;
    trades.push(mkTrade(i, i + 1, pnl));
  }
  return trades;
}

// ----------------------------------------------------------------------
// sharpeToKellyBucket — boundary mapping
// ----------------------------------------------------------------------

describe("sharpeToKellyBucket", () => {
  it("maps Sharpe < 0 to 0.25× (defensive quarter-Kelly)", () => {
    expect(sharpeToKellyBucket(-1)).toBe(0.25);
    expect(sharpeToKellyBucket(-0.001)).toBe(0.25);
    expect(sharpeToKellyBucket(SHARPE_BUCKET_LOW_BOUNDARY - 1e-9)).toBe(0.25);
  });

  it("maps Sharpe = 0 to 0.5× (static default half-Kelly)", () => {
    expect(sharpeToKellyBucket(0)).toBe(0.5);
    expect(sharpeToKellyBucket(SHARPE_BUCKET_LOW_BOUNDARY)).toBe(0.5);
  });

  it("maps Sharpe in [0, 0.5) to 0.5×", () => {
    expect(sharpeToKellyBucket(0.1)).toBe(0.5);
    expect(sharpeToKellyBucket(0.25)).toBe(0.5);
    expect(sharpeToKellyBucket(SHARPE_BUCKET_MID_BOUNDARY - 1e-9)).toBe(0.5);
  });

  it("maps Sharpe = 0.5 to 0.7× (lower bound of three-quarter bucket)", () => {
    expect(sharpeToKellyBucket(SHARPE_BUCKET_MID_BOUNDARY)).toBe(0.7);
    expect(sharpeToKellyBucket(0.6)).toBe(0.7);
    expect(sharpeToKellyBucket(SHARPE_BUCKET_HIGH_BOUNDARY - 1e-9)).toBe(0.7);
  });

  it("maps Sharpe ≥ 1.0 to 1.0× (full Kelly)", () => {
    expect(sharpeToKellyBucket(SHARPE_BUCKET_HIGH_BOUNDARY)).toBe(1.0);
    expect(sharpeToKellyBucket(1.5)).toBe(1.0);
    expect(sharpeToKellyBucket(3.0)).toBe(1.0);
  });

  it("throws on non-finite Sharpe", () => {
    expect(() => sharpeToKellyBucket(NaN)).toThrow();
    expect(() => sharpeToKellyBucket(Infinity)).toThrow();
    expect(() => sharpeToKellyBucket(-Infinity)).toThrow();
  });
});

// ----------------------------------------------------------------------
// nearestBucket — rounding function used by computeAdaptiveKelly
// ----------------------------------------------------------------------

describe("nearestBucket", () => {
  it("rounds 0.20 / 0.30 to 0.25×", () => {
    expect(nearestBucket(0.20)).toBe(0.25);
    expect(nearestBucket(0.374)).toBe(0.25);
  });

  it("rounds 0.40 / 0.50 to 0.5×", () => {
    expect(nearestBucket(0.40)).toBe(0.5);
    expect(nearestBucket(0.624)).toBe(0.5);
  });

  it("rounds 0.70 / 0.80 to 0.7×", () => {
    expect(nearestBucket(0.70)).toBe(0.7);
    expect(nearestBucket(0.849)).toBe(0.7);
  });

  it("rounds 0.90 / 1.00 / 1.20 to 1.0×", () => {
    expect(nearestBucket(0.90)).toBe(1.0);
    expect(nearestBucket(1.0)).toBe(1.0);
    expect(nearestBucket(1.2)).toBe(1.0);
  });

  it("throws on non-finite input", () => {
    expect(() => nearestBucket(NaN)).toThrow();
    expect(() => nearestBucket(Infinity)).toThrow();
  });
});

// ----------------------------------------------------------------------
// aggregateTradesToDailyPnl
// ----------------------------------------------------------------------

describe("aggregateTradesToDailyPnl", () => {
  it("returns empty array for empty input", () => {
    expect(aggregateTradesToDailyPnl([], 10_000)).toEqual([]);
  });

  it("throws on non-positive initialEquity", () => {
    const trades = [mkTrade(0, 1, 100)];
    expect(() => aggregateTradesToDailyPnl(trades, 0)).toThrow();
    expect(() => aggregateTradesToDailyPnl(trades, -100)).toThrow();
    expect(() => aggregateTradesToDailyPnl(trades, NaN)).toThrow();
  });

  it("aggregates multiple trades on the same day into a single daily entry", () => {
    // Three trades all closed on day 1.
    const trades = [mkTrade(0, 1, 100), mkTrade(0, 1, -50), mkTrade(0, 1, 200)];
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    expect(daily.length).toBe(1);
    expect(daily[0]!.pnlUsd).toBe(250);
    expect(daily[0]!.equityUsd).toBe(10_250);
    expect(daily[0]!.tradeCount).toBe(3);
  });

  it("produces one entry per UTC day in the period (including zero-trade days)", () => {
    // 5 trades, one per day starting day 0 → 5 daily entries.
    const trades = [
      mkTrade(0, 0, 100),
      mkTrade(1, 1, 100),
      mkTrade(2, 2, -50),
      mkTrade(4, 4, 200), // day 3 missing
      mkTrade(5, 5, -30),
    ];
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    expect(daily.length).toBe(6); // days 0..5 inclusive
    expect(daily[3]!.tradeCount).toBe(0);
    expect(daily[3]!.pnlUsd).toBe(0);
    // Cumulative equity through day 5: 10000 + 100 + 100 - 50 + 0 + 200 - 30 = 10320.
    expect(daily[5]!.equityUsd).toBeCloseTo(10_320, 6);
  });

  it("sorts unsorted input before aggregating (deterministic)", () => {
    const trades = [mkTrade(2, 2, 100), mkTrade(0, 0, 50), mkTrade(1, 1, -25)];
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    expect(daily.length).toBe(3);
    expect(daily[0]!.pnlUsd).toBe(50);
    expect(daily[1]!.pnlUsd).toBe(-25);
    expect(daily[2]!.pnlUsd).toBe(100);
    expect(daily[2]!.equityUsd).toBeCloseTo(10_125, 6);
  });
});

// ----------------------------------------------------------------------
// rollingSharpeFromDailyPnl
// ----------------------------------------------------------------------

describe("rollingSharpeFromDailyPnl", () => {
  it("returns empty array for empty input", () => {
    expect(rollingSharpeFromDailyPnl([], 30)).toEqual([]);
  });

  it("throws on non-positive window days", () => {
    const daily = aggregateTradesToDailyPnl([mkTrade(0, 1, 100)], 10_000);
    expect(() => rollingSharpeFromDailyPnl(daily, 0)).toThrow();
    expect(() => rollingSharpeFromDailyPnl(daily, -5)).toThrow();
    expect(() => rollingSharpeFromDailyPnl(daily, 1.5)).toThrow(); // not integer
  });

  it("produces null Sharpe for the first (windowDays - 1) days (partial window)", () => {
    // 10 trades over 10 days with stationary 60% W-L=1.5 stream.
    const trades = mkStream(10, 150, -100);
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    const rolling = rollingSharpeFromDailyPnl(daily, 5);
    // First 4 days must have null Sharpe (window not yet full).
    for (let i = 0; i < 4; i++) {
      expect(rolling[i]!.sharpe).toBeNull();
      expect(rolling[i]!.bucket).toBeNull();
    }
    // Day 4 is the first day with a full 5-day window.
    expect(rolling[4]!.sharpe).not.toBeNull();
    expect(rolling[4]!.bucket).not.toBeNull();
    expect(rolling[4]!.contributingDays).toBe(5);
  });

  it("computes Sharpe > 0 for a +EV stream and bucket in [0.5, 1.0]", () => {
    const trades = mkStream(60, 150, -100); // 60% wins, W-L=1.5 → f* = 0.33
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    const rolling = rollingSharpeFromDailyPnl(daily, 30);
    // Mid-window Sharpe should be positive.
    const mid = rolling[rolling.length - 1]!.sharpe!;
    expect(mid).toBeGreaterThan(0);
    // Bucket must be one of the 4 valid ones.
    const lastBucket = rolling[rolling.length - 1]!.bucket;
    expect(lastBucket).not.toBeNull();
    expect([0.25, 0.5, 0.7, 1.0] as AdaptiveKellyBucket[]).toContain(lastBucket!);
  });

  it("computes Sharpe < 0 for a -EV stream and bucket 0.25×", () => {
    // 30% win rate, W-L=0.5 → negative edge.
    const trades: Trade[] = [];
    for (let i = 0; i < 60; i++) {
      const pnl = (i % 10) < 3 ? 50 : -100;
      trades.push(mkTrade(i, i + 1, pnl));
    }
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    const rolling = rollingSharpeFromDailyPnl(daily, 30);
    const mid = rolling[rolling.length - 1]!.sharpe!;
    expect(mid).toBeLessThan(0);
    expect(rolling[rolling.length - 1]!.bucket).toBe(0.25);
  });

  it("is deterministic: same input produces same Sharpe series", () => {
    const trades = mkStream(60, 150, -100);
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    const a = rollingSharpeFromDailyPnl(daily, 30);
    const b = rollingSharpeFromDailyPnl(daily, 30);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.sharpe).toBe(b[i]!.sharpe);
      expect(a[i]!.bucket).toBe(b[i]!.bucket);
    }
  });
});

// ----------------------------------------------------------------------
// bucketDistribution + averageKellyMultiplier
// ----------------------------------------------------------------------

describe("bucketDistribution", () => {
  it("returns all-zero fractions for empty input", () => {
    const d = bucketDistribution([]);
    expect(d.totalDays).toBe(0);
    expect(d.fullKellyFraction).toBe(0);
    expect(d.insufficientFraction).toBe(0);
  });

  it("sums to 1.0 (within floating-point error) and tallies each bucket", () => {
    // Construct a known rolling Sharpe series manually.
    const daily = aggregateTradesToDailyPnl(mkStream(30, 150, -100), 10_000);
    const rolling = rollingSharpeFromDailyPnl(daily, 10);
    const dist = bucketDistribution(rolling);
    const sum =
      dist.fullKellyFraction +
      dist.threeQuarterFraction +
      dist.halfKellyFraction +
      dist.quarterKellyFraction +
      dist.insufficientFraction;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
    expect(dist.totalDays).toBe(rolling.length);
  });
});

describe("averageKellyMultiplier", () => {
  it("returns fallback for empty input", () => {
    expect(averageKellyMultiplier([], 0.5)).toBe(0.5);
    expect(averageKellyMultiplier([], 0.7)).toBe(0.7);
  });

  it("treats null-bucket days as the fallback multiplier", () => {
    // Day 0 is null (insufficient history for window=5).
    const series = rollingSharpeFromDailyPnl(
      aggregateTradesToDailyPnl(mkStream(10, 150, -100), 10_000),
      5,
    );
    // Series[0..3] are null → counted as fallback (0.5).
    const avg = averageKellyMultiplier(series, 0.5);
    // Should be at most the fallback for the null prefix and equal to
    // the actual average for the full-window suffix. We just check it
    // is between fallback (0.5) and 1.0.
    expect(avg).toBeGreaterThanOrEqual(0.5);
    expect(avg).toBeLessThanOrEqual(1.0);
  });
});

// ----------------------------------------------------------------------
// hasAllLossStreak
// ----------------------------------------------------------------------

describe("hasAllLossStreak", () => {
  it("returns false for empty input", () => {
    expect(hasAllLossStreak([], 30)).toBe(false);
  });

  it("returns false when no trades in the streak window", () => {
    const daily = aggregateTradesToDailyPnl([], 10_000);
    expect(hasAllLossStreak(daily, 30)).toBe(false);
  });

  it("returns true when last N days all have net-negative P&L and at least one loss day", () => {
    // 5 consecutive loss days.
    const trades: Trade[] = [];
    for (let i = 0; i < 5; i++) {
      trades.push(mkTrade(i, i, -100));
    }
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    expect(hasAllLossStreak(daily, 30)).toBe(true);
  });

  it("returns false when any day in the window has positive P&L", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 4; i++) trades.push(mkTrade(i, i, -100));
    trades.push(mkTrade(5, 5, 50)); // a win breaks the streak
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    expect(hasAllLossStreak(daily, 30)).toBe(false);
  });

  it("uses only the trailing streakWindowDays (early losses don't trigger)", () => {
    // 5 loss days then a big win in the middle, then 5 more losses.
    const trades: Trade[] = [];
    for (let i = 0; i < 5; i++) trades.push(mkTrade(i, i, -100));
    trades.push(mkTrade(6, 6, 1000));
    for (let i = 10; i < 15; i++) trades.push(mkTrade(i, i, -100));
    const daily = aggregateTradesToDailyPnl(trades, 10_000);
    // streakWindow=5 → only days 10..14 considered; all are losses.
    expect(hasAllLossStreak(daily, 5)).toBe(true);
  });
});

// ----------------------------------------------------------------------
// computeAdaptiveKelly — end-to-end pipeline
// ----------------------------------------------------------------------

describe("computeAdaptiveKelly", () => {
  it("falls back to 0.5× for empty trade list (insufficient history)", () => {
    const result = computeAdaptiveKelly([], 30, 10_000);
    expect(result.rollingSharpe.length).toBe(0);
    expect(result.rawAverageKellyMultiplier).toBe(0.5);
    expect(result.hadAllLossStreak).toBe(false);
    expect(result.bucketDistribution.totalDays).toBe(0);
  });

  it("falls back to 0.5× for trade counts below minTradeCount (insufficient history)", () => {
    // 20 trades < minTradeCount=30 default → forced fallback to 0.5×.
    const trades = mkStream(20, 150, -100);
    const result = computeAdaptiveKelly(trades);
    expect(result.rawAverageKellyMultiplier).toBe(0.5);
    expect(result.hadAllLossStreak).toBe(false);
  });

  it("computes a non-trivial bucket distribution for a +EV 60% W-L=1.5 stream", () => {
    // 90 trades over 90 days; 60% wins × W-L=1.5 → expected Sharpe ~ +0.3-0.6.
    const trades = mkStream(90, 150, -100);
    const result = computeAdaptiveKelly(trades);
    // The mid/late stream should be in 0.5× or 0.7× (Sharpe 0-1.0).
    expect(result.rawAverageKellyMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(result.rawAverageKellyMultiplier).toBeLessThanOrEqual(1.0);
    // Bucket distribution should be sum to 1.
    const sum =
      result.bucketDistribution.fullKellyFraction +
      result.bucketDistribution.threeQuarterFraction +
      result.bucketDistribution.halfKellyFraction +
      result.bucketDistribution.quarterKellyFraction +
      result.bucketDistribution.insufficientFraction;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
    // No all-loss streak on a +EV stream.
    expect(result.hadAllLossStreak).toBe(false);
  });

  it("hard-floors to 0.25× on an all-loss streak", () => {
    // 40 loss trades in a row.
    const trades: Trade[] = [];
    for (let i = 0; i < 40; i++) trades.push(mkTrade(i, i + 1, -100));
    const result = computeAdaptiveKelly(trades);
    expect(result.hadAllLossStreak).toBe(true);
    expect(result.effectiveKellyMultiplier).toBe(0.25);
    expect(result.effectiveCappedKellyFraction).toBeLessThanOrEqual(
      result.cappedBaseKellyFraction * 0.25 + 1e-9,
    );
  });

  it("uses 0.25× bucket for a -EV stream (no streak needed — Sharpe < 0)", () => {
    // 30% wins, W-L=0.5 — negative edge.
    const trades: Trade[] = [];
    for (let i = 0; i < 60; i++) {
      const pnl = (i % 10) < 3 ? 50 : -100;
      trades.push(mkTrade(i, i + 1, pnl));
    }
    const result = computeAdaptiveKelly(trades);
    expect(result.effectiveKellyMultiplier).toBe(0.25);
  });

  it("applies risk caps to the effective Kelly fraction", () => {
    // Stream that produces a very high full-Kelly → must be capped.
    const trades: Trade[] = [];
    for (let i = 0; i < 90; i++) {
      // 80% wins × 5 W-L → full Kelly = 0.76 → cap at 0.20 × 0.5 = 0.10.
      const pnl = (i % 10) < 8 ? 500 : -100;
      trades.push(mkTrade(i, i + 1, pnl));
    }
    const result = computeAdaptiveKelly(trades);
    expect(result.cappedBaseKellyFraction).toBe(DEFAULT_KELLY_OPT_CONFIG.maxPositionPctEquity);
    expect(result.effectiveCappedKellyFraction).toBeLessThanOrEqual(
      DEFAULT_KELLY_OPT_CONFIG.maxPositionPctEquity + 1e-9,
    );
  });

  it("is deterministic: same input produces identical output", () => {
    const trades = mkStream(90, 150, -100);
    const a = computeAdaptiveKelly(trades);
    const b = computeAdaptiveKelly(trades);
    expect(a.rawAverageKellyMultiplier).toBe(b.rawAverageKellyMultiplier);
    expect(a.effectiveCappedKellyFraction).toBe(b.effectiveCappedKellyFraction);
    expect(a.rollingSharpe.length).toBe(b.rollingSharpe.length);
    for (let i = 0; i < a.rollingSharpe.length; i++) {
      expect(a.rollingSharpe[i]!.sharpe).toBe(b.rollingSharpe[i]!.sharpe);
    }
  });

  it("recommendedRiskPerTrade follows cappedKelly / 0.10 (Phase 6 convention)", () => {
    const trades = mkStream(90, 150, -100);
    const result = computeAdaptiveKelly(trades);
    expect(result.recommendedRiskPerTrade).toBeCloseTo(result.effectiveCappedKellyFraction / 0.1, 6);
    expect(result.recommendedMaxPositionPctEquity).toBeCloseTo(result.effectiveCappedKellyFraction, 6);
  });
});

// ----------------------------------------------------------------------
// Integration with KellyPositionSizer
// ----------------------------------------------------------------------

describe("computeAdaptiveKelly ↔ KellyPositionSizer integration", () => {
  it("agrees on full-Kelly and base risk-cap output for the same trade list", () => {
    // 540 trades so the static 180d IS / 30d OOS windows fit.
    const trades = mkStream(540, 150, -100);
    const adaptive: AdaptiveKellyResult = computeAdaptiveKelly(trades);
    const staticResult = optimizeKelly(trades);
    // The base full-Kelly must match.
    expect(adaptive.fullKellyFraction).toBeCloseTo(staticResult.fullKellyFraction, 6);
    // The base capped Kelly must match (config defaults match).
    expect(adaptive.cappedBaseKellyFraction).toBeCloseTo(staticResult.cappedKellyFraction, 6);
  });

  it("exposes the static `optimizeKelly` walk-forward result for cross-comparison", () => {
    // 540 trades so the static 180d IS / 30d OOS windows fit.
    const trades = mkStream(540, 150, -100);
    const adaptive = computeAdaptiveKelly(trades);
    // Re-run optimizeKelly here and confirm consistency.
    const staticResult = optimizeKelly(trades);
    expect(staticResult.walkForward.windows.length).toBeGreaterThan(0);
    // avgTrainKelly should be positive for a +EV stream.
    expect(staticResult.walkForward.avgTrainKellyFraction).toBeGreaterThan(0);
    // The adaptive base capped Kelly matches the static capped Kelly.
    expect(adaptive.cappedBaseKellyFraction).toBeCloseTo(staticResult.cappedKellyFraction, 6);
  });

  it("applies the same fullKellyFraction + applyRiskCaps pipeline as the static module", () => {
    const trades = mkStream(90, 150, -100);
    const adaptive = computeAdaptiveKelly(trades);
    const stats = adaptive.overallStats;
    const expectedFull = fullKellyFraction(stats.winRate, stats.winLossRatio);
    expect(adaptive.fullKellyFraction).toBeCloseTo(expectedFull, 9);
    // Capped base = fractional Kelly × max cap.
    const expectedCappedBase = applyRiskCaps(
      fractionalKelly(expectedFull, 0.5),
      DEFAULT_KELLY_OPT_CONFIG,
    );
    expect(adaptive.cappedBaseKellyFraction).toBeCloseTo(expectedCappedBase, 9);
  });
});

// ----------------------------------------------------------------------
// runAdaptiveWalkForwardValidation
// ----------------------------------------------------------------------

describe("runAdaptiveWalkForwardValidation", () => {
  it("produces a non-empty WalkForwardValidation for a long enough stream", () => {
    const trades = mkStream(540, 150, -100); // 540-day +EV stream
    const wf = runAdaptiveWalkForwardValidation(trades, 180, 30, 30);
    expect(wf.windows.length).toBeGreaterThan(0);
    expect(wf.avgTrainSharpe).toBeGreaterThanOrEqual(0);
    expect(wf.avgTestMultiplier).toBeGreaterThanOrEqual(0.25);
    expect(wf.avgTestMultiplier).toBeLessThanOrEqual(1.0);
  });

  it("IS/OOS train-test split: no future-leakage (testStart >= trainEnd)", () => {
    const trades = mkStream(540, 150, -100);
    const wf = runAdaptiveWalkForwardValidation(trades, 180, 30, 30);
    for (const w of wf.windows) {
      expect(w.testStart).toBe(w.trainEnd);
      expect(w.testStart).toBeGreaterThanOrEqual(w.trainEnd);
    }
  });

  it("throws when no non-empty windows fit the input", () => {
    const trades = [mkTrade(0, 1, 100), mkTrade(1, 2, 100)];
    expect(() => runAdaptiveWalkForwardValidation(trades, 30, 7, 7)).toThrow();
  });

  it("overfit-risk verdict categorical for a stationary +EV stream", () => {
    const trades = mkStream(540, 150, -100);
    const wf = runAdaptiveWalkForwardValidation(trades, 180, 30, 30);
    // For a stationary +EV stream we expect LOW or MEDIUM (never HIGH).
    expect(["LOW", "MEDIUM"]).toContain(wf.overfitRisk);
  });

  it("is deterministic: same input produces same windows", () => {
    const trades = mkStream(540, 150, -100);
    const a = runAdaptiveWalkForwardValidation(trades, 180, 30, 30);
    const b = runAdaptiveWalkForwardValidation(trades, 180, 30, 30);
    expect(a.windows.length).toBe(b.windows.length);
    for (let i = 0; i < a.windows.length; i++) {
      expect(a.windows[i]!.trainSharpe).toBe(b.windows[i]!.trainSharpe);
      expect(a.windows[i]!.testMultiplier).toBe(b.windows[i]!.testMultiplier);
      expect(a.windows[i]!.testReturn).toBe(b.windows[i]!.testReturn);
    }
  });
});

// ----------------------------------------------------------------------
// compareAdaptiveVsStaticKelly — drop-in wrapper for the CLI runner
// ----------------------------------------------------------------------

describe("compareAdaptiveVsStaticKelly", () => {
  it("emits side-by-side static + adaptive results", () => {
    const trades = mkStream(540, 150, -100);
    const cmp = compareAdaptiveVsStaticKelly(trades);
    expect(cmp.staticKelly.cappedKellyFraction).toBeGreaterThan(0);
    expect(cmp.adaptiveKelly.effectiveCappedKellyFraction).toBeGreaterThan(0);
    // The "adaptive amplifies" flag is well-defined.
    expect(typeof cmp.adaptiveAmplifies).toBe("boolean");
  });

  it("adaptive avg multiplier is one of the 4 buckets (after rounding)", () => {
    const trades = mkStream(540, 150, -100);
    const cmp = compareAdaptiveVsStaticKelly(trades);
    expect([0.25, 0.5, 0.7, 1.0] as AdaptiveKellyBucket[]).toContain(
      nearestBucket(cmp.adaptiveAvgMultiplier),
    );
  });

  it("is deterministic across runs", () => {
    const trades = mkStream(540, 150, -100);
    const a = compareAdaptiveVsStaticKelly(trades);
    const b = compareAdaptiveVsStaticKelly(trades);
    expect(a.adaptiveKelly.effectiveCappedKellyFraction).toBe(
      b.adaptiveKelly.effectiveCappedKellyFraction,
    );
    expect(a.adaptiveAmplifies).toBe(b.adaptiveAmplifies);
  });
});