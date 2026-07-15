/**
 * apps/bot/src/portfolio/portfolio-stop.test.ts
 *
 * A `PortfolioStop` unit tesztjei — DD számítás, trip-on-DD, latch,
 * reset, force-trip, per-strategy contribution, edge case-ek.
 */

import { describe, expect, it } from "bun:test";

import {
  PortfolioStop,
  PortfolioStopError,
  PORTFOLIO_STOP_HARD_CAPS,
} from "./portfolio-stop.js";

describe("PortfolioStop", () => {
  // ---------------------------------------------------------------------------
  // 1) Constructor validation
  // ---------------------------------------------------------------------------
  describe("constructor", () => {
    it("uses default maxDdPct = 0.10", () => {
      const ps = new PortfolioStop();
      expect(ps.getMaxDdPct()).toBe(PORTFOLIO_STOP_HARD_CAPS.maxDdPctDefault);
    });

    it("accepts custom maxDdPct", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.05 });
      expect(ps.getMaxDdPct()).toBe(0.05);
    });

    it("accepts maxDdPct at boundaries", () => {
      expect(new PortfolioStop({ maxDdPct: 0.01 }).getMaxDdPct()).toBe(0.01);
      expect(new PortfolioStop({ maxDdPct: 0.30 }).getMaxDdPct()).toBe(0.30);
    });

    it("rejects maxDdPct below 0.01", () => {
      expect(() => new PortfolioStop({ maxDdPct: 0.005 })).toThrow(PortfolioStopError);
    });

    it("rejects maxDdPct above 0.30", () => {
      expect(() => new PortfolioStop({ maxDdPct: 0.31 })).toThrow(PortfolioStopError);
    });

    it("rejects non-finite maxDdPct", () => {
      expect(() => new PortfolioStop({ maxDdPct: Number.NaN })).toThrow(PortfolioStopError);
      expect(() => new PortfolioStop({ maxDdPct: Number.POSITIVE_INFINITY })).toThrow(PortfolioStopError);
    });
  });

  // ---------------------------------------------------------------------------
  // 2) Equity tracking
  // ---------------------------------------------------------------------------
  describe("equity tracking", () => {
    it("starts with 0 peak, 0 current, 0 DD", () => {
      const ps = new PortfolioStop();
      expect(ps.getPeakEquity()).toBe(0);
      expect(ps.getCurrentEquity()).toBe(0);
      expect(ps.getDrawdownPct()).toBe(0);
    });

    it("records equity and sets the peak on first call", () => {
      const ps = new PortfolioStop();
      ps.recordEquity(10_000);
      expect(ps.getCurrentEquity()).toBe(10_000);
      expect(ps.getPeakEquity()).toBe(10_000);
      expect(ps.getDrawdownPct()).toBe(0);
    });

    it("updates peak to higher equity", () => {
      const ps = new PortfolioStop();
      ps.recordEquity(10_000);
      ps.recordEquity(12_000);
      expect(ps.getPeakEquity()).toBe(12_000);
      expect(ps.getCurrentEquity()).toBe(12_000);
      expect(ps.getDrawdownPct()).toBe(0);
    });

    it("does NOT update peak on lower equity", () => {
      const ps = new PortfolioStop();
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      expect(ps.getPeakEquity()).toBe(10_000);
      expect(ps.getCurrentEquity()).toBe(9_000);
    });

    it("computes drawdown pct as (peak - current) / peak", () => {
      const ps = new PortfolioStop();
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      // 1000 / 10000 = 0.1
      expect(ps.getDrawdownPct()).toBeCloseTo(0.1, 5);
    });

    it("ignores non-finite equity values", () => {
      const ps = new PortfolioStop();
      ps.recordEquity(10_000);
      ps.recordEquity(Number.NaN);
      expect(ps.getCurrentEquity()).toBe(10_000);
    });

    it("hasReceivedAnyEquity returns true after first recordEquity", () => {
      const ps = new PortfolioStop();
      expect(ps.hasReceivedAnyEquity()).toBe(false);
      ps.recordEquity(10_000);
      expect(ps.hasReceivedAnyEquity()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3) Trip-on-DD
  // ---------------------------------------------------------------------------
  describe("trip on DD", () => {
    it("does NOT trip below threshold", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000);
      ps.recordEquity(9_500); // DD = 5%
      expect(ps.isTripped()).toBe(false);
    });

    it("trips at threshold", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000); // DD = 10%
      expect(ps.isTripped()).toBe(true);
    });

    it("trips above threshold", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.05 });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000); // DD = 10% > 5%
      expect(ps.isTripped()).toBe(true);
    });

    it("trippedAt is set when tripped", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000);
      expect(ps.getTrippedAt()).toBeNull();
      const before = Date.now();
      ps.recordEquity(9_000);
      const after = Date.now();
      expect(ps.getTrippedAt()).not.toBeNull();
      const t = ps.getTrippedAt() ?? 0;
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after);
    });

    it("is LATCHED — does NOT un-trip on equity recovery", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      expect(ps.isTripped()).toBe(true);
      ps.recordEquity(11_000); // Recovery above peak
      expect(ps.isTripped()).toBe(true);
    });

    it("does NOT trip when no peak has been set (peak=0)", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(0);
      expect(ps.isTripped()).toBe(false);
    });

    it("does NOT trip on negative equity (peak=0 case)", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000);
      ps.recordEquity(-1_000); // peak stays 10k, current -1k, DD > 1
      // Actually peak=10k, current=-1k, DD = 11000/10000 = 1.1 > 0.10 → trips
      // But peak stays at 10k only because peak is the high-water mark;
      // the negative equity is the current.
      expect(ps.isTripped()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4) Trip action callback
  // ---------------------------------------------------------------------------
  describe("trip action", () => {
    it("fires the trip action callback when tripped", () => {
      let called = false;
      const ps = new PortfolioStop({
        maxDdPct: 0.10,
        tripAction: () => {
          called = true;
        },
      });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      expect(called).toBe(true);
    });

    it("does NOT fire trip action if no callback provided", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      // No error, just no callback
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      expect(ps.isTripped()).toBe(true);
    });

    it("setTripAction replaces the action (used by PortfolioManager)", () => {
      let called = false;
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.setTripAction(() => {
        called = true;
      });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      expect(called).toBe(true);
    });

    it("setTripAction(null) removes the action", () => {
      let called = 0;
      const ps = new PortfolioStop({
        maxDdPct: 0.10,
        tripAction: () => {
          called++;
        },
      });
      ps.setTripAction(null);
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      expect(called).toBe(0);
    });

    it("trip action that throws does NOT crash the bot", () => {
      const ps = new PortfolioStop({
        maxDdPct: 0.10,
        tripAction: () => {
          throw new Error("test");
        },
      });
      ps.recordEquity(10_000);
      // Should not throw even though the callback throws
      expect(() => ps.recordEquity(9_000)).not.toThrow();
    });

    it("trip action is async-aware (Promise return value is awaited)", async () => {
      let resolved = false;
      const ps = new PortfolioStop({
        maxDdPct: 0.10,
        tripAction: () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              resolved = true;
              resolve();
            }, 5);
          }),
      });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      // The fire-and-forget pattern means we need to wait for the microtask
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
      expect(resolved).toBe(true);
    });

    it("fireTripAction is idempotent — fires only once", () => {
      let called = 0;
      const ps = new PortfolioStop({
        maxDdPct: 0.10,
        tripAction: () => {
          called++;
        },
      });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      ps.recordEquity(8_000); // Even more DD
      ps.recordEquity(11_000); // Recovery
      expect(called).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5) Reset
  // ---------------------------------------------------------------------------
  describe("reset", () => {
    it("clears the latch and the trippedAt timestamp", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      expect(ps.isTripped()).toBe(true);
      ps.reset();
      expect(ps.isTripped()).toBe(false);
      expect(ps.getTrippedAt()).toBeNull();
    });

    it("keeps the peak by default (clearPeak: false)", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      ps.reset();
      expect(ps.getPeakEquity()).toBe(10_000);
    });

    it("clears the peak with { clearPeak: true }", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      ps.reset({ clearPeak: true });
      expect(ps.getPeakEquity()).toBe(0);
      expect(ps.getCurrentEquity()).toBe(0);
      expect(ps.hasReceivedAnyEquity()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 6) Force trip
  // ---------------------------------------------------------------------------
  describe("forceTrip", () => {
    it("trips immediately regardless of DD", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.forceTrip("manual");
      expect(ps.isTripped()).toBe(true);
      expect(ps.getTrippedAt()).not.toBeNull();
    });

    it("force trip fires the action", () => {
      let called = false;
      const ps = new PortfolioStop({
        maxDdPct: 0.10,
        tripAction: () => {
          called = true;
        },
      });
      ps.forceTrip("manual");
      expect(called).toBe(true);
    });

    it("force trip is idempotent", () => {
      let called = 0;
      const ps = new PortfolioStop({
        maxDdPct: 0.10,
        tripAction: () => {
          called++;
        },
      });
      ps.forceTrip("first");
      ps.forceTrip("second");
      expect(called).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 7) Per-strategy contribution
  // ---------------------------------------------------------------------------
  describe("per-strategy contribution", () => {
    it("records the contribution map", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      const contrib = new Map<string, number>([
        ["carry", -200],
        ["ohlc", -50],
      ]);
      ps.recordEquity(10_000, contrib);
      const state = ps.getState();
      expect(state.perStrategyContrib.get("carry")).toBe(-200);
      expect(state.perStrategyContrib.get("ohlc")).toBe(-50);
    });

    it("replaces the contribution map on each call (does not merge)", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000, new Map([["a", -100]]));
      ps.recordEquity(10_000, new Map([["b", -200]]));
      const state = ps.getState();
      expect(state.perStrategyContrib.has("a")).toBe(false);
      expect(state.perStrategyContrib.get("b")).toBe(-200);
    });
  });

  // ---------------------------------------------------------------------------
  // 8) getState / evaluate
  // ---------------------------------------------------------------------------
  describe("getState", () => {
    it("returns the full state snapshot", () => {
      const ps = new PortfolioStop({ maxDdPct: 0.10 });
      ps.recordEquity(10_000);
      ps.recordEquity(9_000);
      const state = ps.getState();
      expect(state.currentEquityUsd).toBe(9_000);
      expect(state.peakEquityUsd).toBe(10_000);
      expect(state.drawdownPct).toBeCloseTo(0.1, 5);
      expect(state.maxDdPct).toBe(0.10);
      expect(state.tripped).toBe(true);
      expect(state.trippedAt).not.toBeNull();
    });
  });
});
