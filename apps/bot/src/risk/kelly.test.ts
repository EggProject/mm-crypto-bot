/**
 * apps/bot/src/risk/kelly.test.ts
 *
 * Unit tests for the pure `kellyFraction` / `computeStats` helpers and
 * the stateful `KellySizer`. Targets 100% line + branch coverage.
 *
 * References used for the math (the formula is well-established; we
 * re-verify edge cases by hand):
 *   - Thorp (2006): f* = (b × p − q) / b, with b = win/loss ratio.
 *   - For p=0.6, b=2.0: f* = (2 × 0.6 − 0.4) / 2 = 0.4
 *   - For p=0.4, b=1.0: f* = (1 × 0.4 − 0.6) / 1 = -0.2 → 0 (no edge).
 *   - For p=0.5, b=0: f* = 0 (degenerate — no losing trades).
 */

import { describe, expect, it } from "bun:test";

import { KellySizer, computeStats, kellyFraction } from "./kelly.js";

describe("kellyFraction (pure)", () => {
  it("computes the canonical formula", () => {
    // p = 0.6, b = 2 → f* = (2*0.6 - 0.4) / 2 = 0.4
    expect(kellyFraction(0.6, 2.0)).toBeCloseTo(0.4, 6);
  });

  it("returns 0 when EV is negative (no edge)", () => {
    // p = 0.3, b = 1 → f* = (1*0.3 - 0.7) / 1 = -0.4
    expect(kellyFraction(0.3, 1.0)).toBe(0);
  });

  it("returns 0 when winLossRatio is 0 (degenerate)", () => {
    expect(kellyFraction(0.5, 0)).toBe(0);
  });

  it("caps at 1.0 when raw Kelly is > 1", () => {
    // p = 0.9, b = 10 → f* = (10*0.9 - 0.1) / 10 = 0.89 (below 1, fine)
    expect(kellyFraction(0.9, 10.0)).toBeCloseTo(0.89, 6);
    // Force a case where raw Kelly > 1: p=1, b=very large
    // f* = (b*1 - 0) / b = 1 → already at cap
    expect(kellyFraction(1.0, 100.0)).toBe(1.0);
  });

  it("rejects out-of-range winRate", () => {
    expect(() => kellyFraction(-0.1, 1)).toThrow(/winRate/);
    expect(() => kellyFraction(1.1, 1)).toThrow(/winRate/);
    expect(() => kellyFraction(NaN, 1)).toThrow(/winRate/);
  });

  it("rejects negative or non-finite winLossRatio", () => {
    expect(() => kellyFraction(0.5, -1)).toThrow(/winLossRatio/);
    expect(() => kellyFraction(0.5, NaN)).toThrow(/winLossRatio/);
  });
});

describe("computeStats (pure)", () => {
  it("returns zeros on empty input", () => {
    const s = computeStats([]);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.avgWin).toBe(0);
    expect(s.avgLoss).toBe(0);
    expect(s.winLossRatio).toBe(0);
  });

  it("computes win-rate, avg win, avg loss, W/L ratio correctly", () => {
    const s = computeStats([
      { pnlUsd: 100, closedAt: 1 },
      { pnlUsd: 200, closedAt: 2 },
      { pnlUsd: -50, closedAt: 3 },
      { pnlUsd: -50, closedAt: 4 },
    ]);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBe(0.5);
    expect(s.avgWin).toBe(150);
    expect(s.avgLoss).toBe(50);
    expect(s.winLossRatio).toBe(3.0);
  });

  it("excludes zero-pnl trades from both counts", () => {
    const s = computeStats([
      { pnlUsd: 100, closedAt: 1 },
      { pnlUsd: 0, closedAt: 2 },
      { pnlUsd: -50, closedAt: 3 },
    ]);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(0.5);
  });
});

describe("KellySizer", () => {
  // -------------------------------------------------------------------------
  // Constructor validation
  // -------------------------------------------------------------------------
  it("constructor rejects invalid fraction", () => {
    expect(() => {
      new KellySizer({
        enabled: true,
        fraction: 0,
        windowSize: 50,
        minTrades: 10,
        fallbackFraction: 0.01,
        maxFraction: 0.10,
      });
    }).toThrow(/fraction/);
    expect(() => {
      new KellySizer({
        enabled: true,
        fraction: 1.5,
        windowSize: 50,
        minTrades: 10,
        fallbackFraction: 0.01,
        maxFraction: 0.10,
      });
    }).toThrow(/fraction/);
  });

  it("constructor rejects invalid windowSize", () => {
    expect(() => {
      new KellySizer({
        enabled: true,
        fraction: 0.25,
        windowSize: 0,
        minTrades: 10,
        fallbackFraction: 0.01,
        maxFraction: 0.10,
      });
    }).toThrow(/windowSize/);
  });

  it("constructor rejects invalid minTrades", () => {
    expect(() => {
      new KellySizer({
        enabled: true,
        fraction: 0.25,
        windowSize: 50,
        minTrades: 0,
        fallbackFraction: 0.01,
        maxFraction: 0.10,
      });
    }).toThrow(/minTrades/);
  });

  it("constructor rejects invalid fallbackFraction", () => {
    expect(() => {
      new KellySizer({
        enabled: true,
        fraction: 0.25,
        windowSize: 50,
        minTrades: 10,
        fallbackFraction: -0.01,
        maxFraction: 0.10,
      });
    }).toThrow(/fallbackFraction/);
  });

  it("constructor rejects invalid maxFraction", () => {
    expect(() => {
      new KellySizer({
        enabled: true,
        fraction: 0.25,
        windowSize: 50,
        minTrades: 10,
        fallbackFraction: 0.01,
        maxFraction: 0,
      });
    }).toThrow(/maxFraction/);
  });

  // -------------------------------------------------------------------------
  // Disabled sizer returns 0
  // -------------------------------------------------------------------------
  it("disabled sizer always returns 0", () => {
    const s = new KellySizer({
      enabled: false,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 10,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    s.recordClosedTrade({ pnlUsd: 100, closedAt: 1 });
    s.recordClosedTrade({ pnlUsd: 100, closedAt: 2 });
    expect(s.recommendedSize()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Cold-start: returns fallbackFraction
  // -------------------------------------------------------------------------
  it("cold-start (< minTrades) returns fallbackFraction", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 10,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    for (let i = 0; i < 9; i++) {
      s.recordClosedTrade({ pnlUsd: 100, closedAt: i });
    }
    expect(s.recommendedSize()).toBe(0.01);
  });

  // -------------------------------------------------------------------------
  // Hot path: returns min(fractional Kelly, maxFraction)
  // -------------------------------------------------------------------------
  it("hot path returns min(fractional Kelly, maxFraction)", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 10,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    // 12 wins of +100, 2 losses of -50 → p=0.857, b=2.0
    // fullKelly = (2*0.857 - 0.143)/2 ≈ 0.7857
    // 0.25× → 0.196 → capped at 0.10
    for (let i = 0; i < 12; i++) s.recordClosedTrade({ pnlUsd: 100, closedAt: i });
    for (let i = 0; i < 2; i++) s.recordClosedTrade({ pnlUsd: -50, closedAt: 100 + i });
    const size = s.recommendedSize();
    expect(size).toBeCloseTo(0.10, 6);
  });

  it("hot path returns fractional Kelly when below maxFraction", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 10,
      fallbackFraction: 0.01,
      maxFraction: 0.50, // high cap → fractional Kelly passes through
    });
    // 6 wins of +100, 4 losses of -100 → p=0.6, b=1.0
    // fullKelly = (1*0.6 - 0.4)/1 = 0.2
    // 0.25× → 0.05 → below 0.50 cap
    for (let i = 0; i < 6; i++) s.recordClosedTrade({ pnlUsd: 100, closedAt: i });
    for (let i = 0; i < 4; i++) s.recordClosedTrade({ pnlUsd: -100, closedAt: 100 + i });
    expect(s.recommendedSize()).toBeCloseTo(0.05, 6);
  });

  // -------------------------------------------------------------------------
  // No-edge: returns 0
  // -------------------------------------------------------------------------
  it("no edge (negative EV) returns 0", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 10,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    // 3 wins, 7 losses → p=0.3, b=1 → f* = (1*0.3 - 0.7)/1 = -0.4 → 0
    for (let i = 0; i < 3; i++) s.recordClosedTrade({ pnlUsd: 100, closedAt: i });
    for (let i = 0; i < 7; i++) s.recordClosedTrade({ pnlUsd: -100, closedAt: 100 + i });
    expect(s.recommendedSize()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Rolling window: oldest trade evicted
  // -------------------------------------------------------------------------
  it("rolling window evicts oldest trade when full", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 5,
      minTrades: 5,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    // 4 losses first, then 1 win. Then 4 wins. With window=5, after the
    // 4 wins the 4 losses are evicted → only the original win remains.
    for (let i = 0; i < 4; i++) s.recordClosedTrade({ pnlUsd: -100, closedAt: i });
    s.recordClosedTrade({ pnlUsd: 100, closedAt: 4 });
    expect(s.getStats().trades).toBe(5);
    for (let i = 0; i < 4; i++) s.recordClosedTrade({ pnlUsd: 100, closedAt: 100 + i });
    // Now 4 wins + 1 win (the original), 0 losses.
    expect(s.getStats().trades).toBe(5);
    expect(s.getStats().wins).toBe(5);
    expect(s.getStats().losses).toBe(0);
    // avgWin=100, avgLoss=0 → winLossRatio=0 → kelly=0 → recommendedSize=0
    expect(s.recommendedSize()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // getStats covers all regions
  // -------------------------------------------------------------------------
  it("getStats reports cold-start region when < minTrades", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 10,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    expect(s.getStats().region).toBe("cold-start");
  });

  it("getStats reports no-edge region when Kelly is 0 with enough trades", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 5,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    for (let i = 0; i < 3; i++) s.recordClosedTrade({ pnlUsd: 100, closedAt: i });
    for (let i = 0; i < 7; i++) s.recordClosedTrade({ pnlUsd: -100, closedAt: 100 + i });
    expect(s.getStats().region).toBe("no-edge");
  });

  it("getStats reports active region when Kelly is positive", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 5,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    for (let i = 0; i < 7; i++) s.recordClosedTrade({ pnlUsd: 100, closedAt: i });
    for (let i = 0; i < 3; i++) s.recordClosedTrade({ pnlUsd: -100, closedAt: 100 + i });
    expect(s.getStats().region).toBe("active");
  });

  it("getStats reports cold-start when disabled", () => {
    const s = new KellySizer({
      enabled: false,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 5,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    expect(s.getStats().region).toBe("cold-start");
  });

  // -------------------------------------------------------------------------
  // recordClosedTrade ignores non-finite pnl
  // -------------------------------------------------------------------------
  it("recordClosedTrade ignores non-finite pnl", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 5,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    s.recordClosedTrade({ pnlUsd: NaN, closedAt: 1 });
    s.recordClosedTrade({ pnlUsd: 100, closedAt: 2 });
    expect(s.getStats().trades).toBe(1);
  });

  // -------------------------------------------------------------------------
  // reset clears the window
  // -------------------------------------------------------------------------
  it("reset clears the rolling window", () => {
    const s = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 5,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    for (let i = 0; i < 7; i++) s.recordClosedTrade({ pnlUsd: 100, closedAt: i });
    expect(s.getStats().trades).toBe(7);
    s.reset();
    expect(s.getStats().trades).toBe(0);
  });

  it("isEnabled reports the config", () => {
    const s1 = new KellySizer({
      enabled: true,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 5,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    expect(s1.isEnabled()).toBe(true);
    const s2 = new KellySizer({
      enabled: false,
      fraction: 0.25,
      windowSize: 50,
      minTrades: 5,
      fallbackFraction: 0.01,
      maxFraction: 0.10,
    });
    expect(s2.isEnabled()).toBe(false);
  });
});
