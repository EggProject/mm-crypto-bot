/**
 * apps/web/src/indicators/strategy-indicators.test.ts
 *
 * Phase 79: bun:test unit tests for the per-strategy indicator
 * registry. The 100% line + branch coverage target applies to
 * `strategy-indicators.ts`; the chart-card integration is covered
 * by the existing e2e suite.
 *
 * The tests are pure: no React, no DOM, no lightweight-charts. The
 * function under test takes a strategy name and returns the
 * per-strategy indicator set; the focus is the dispatch logic, not
 * the renderers (which are tested in their own files).
 */

import { describe, expect, it } from "bun:test";

import {
  STRATEGY_INDICATOR_SETS,
  UNIVERSAL_FALLBACK_SET,
  getStrategyIndicatorSet,
} from "./strategy-indicators.js";

describe("STRATEGY_INDICATOR_SETS", () => {
  it("registers all 5 strategies from the bot config", () => {
    const names = Object.keys(STRATEGY_INDICATOR_SETS);
    expect(names).toContain("donchian_pivot_composition");
    expect(names).toContain("dydx_cex_carry");
    expect(names).toContain("cascade_fade");
    expect(names).toContain("funding_flip_kill_switch");
    expect(names).toContain("regime_detector");
  });

  it("the ENABLED strategy (donchian_pivot_composition) has 2 line indicators + 1 marker indicator", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    expect(set).toBeDefined();
    expect(set?.lines.length).toBe(2);
    expect(set?.markers.length).toBe(1);
    // The two lines are the Donchian band + the pivot level.
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).toContain("donchian");
    expect(lineNames).toContain("pivot");
    // The marker is the breakout signal.
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("breakout_signals");
  });

  it("the 4 disabled strategies fall back to the universal Donchian band only (no strategy-specific markers)", () => {
    for (const name of [
      "dydx_cex_carry",
      "cascade_fade",
      "funding_flip_kill_switch",
      "regime_detector",
    ] as const) {
      // eslint-disable-next-line security/detect-object-injection -- `name` is from a const-tuple literal above
      const set = STRATEGY_INDICATOR_SETS[name];
      expect(set).toBeDefined();
      // The disabled strategies have 1 line (Donchian) and NO
      // markers — the strategy-specific indicators require
      // external data (perpetual funding, liquidation cascades,
      // multi-TF regime classifications) that the client
      // doesn't have.
      expect(set?.lines.length).toBe(1);
      expect(set?.markers.length).toBe(0);
      const lineNames = set?.lines.map((l) => l.name) ?? [];
      expect(lineNames).toEqual(["donchian"]);
    }
  });
});

describe("getStrategyIndicatorSet", () => {
  it("returns the registered set for a known strategy", () => {
    const set = getStrategyIndicatorSet("donchian_pivot_composition");
    expect(set.strategy).toBe("donchian_pivot_composition");
    expect(set.lines.length).toBe(2);
    expect(set.markers.length).toBe(1);
  });

  it("returns the universal fallback for an unknown strategy", () => {
    const set = getStrategyIndicatorSet("not_a_real_strategy_xyz");
    // The fallback is a SHARED object — same reference across
    // calls — so a misuse (mutating it) would corrupt every
    // unknown-strategy chart. The test asserts identity to make
    // the contract explicit.
    expect(set).toBe(UNIVERSAL_FALLBACK_SET);
    expect(set.strategy).toBe("unknown");
    expect(set.lines.length).toBe(1);
    expect(set.markers.length).toBe(0);
  });

  it("returns the universal fallback for an empty string (defensive)", () => {
    const set = getStrategyIndicatorSet("");
    expect(set).toBe(UNIVERSAL_FALLBACK_SET);
  });

  it("returns the registered set for each of the 5 strategies (no mismatches)", () => {
    for (const name of Object.keys(STRATEGY_INDICATOR_SETS)) {
      const set = getStrategyIndicatorSet(name);
      expect(set.strategy).toBe(name);
    }
  });
});
