/**
 * apps/web/src/indicators/strategy-indicators.test.ts
 *
 * Phase 79 + 81: bun:test unit tests for the per-strategy
 * indicator registry. The 100% line + branch coverage target
 * applies to `strategy-indicators.ts`; the chart-card
 * integration is covered by the existing e2e suite.
 *
 * The tests are pure: no React, no DOM, no lightweight-charts.
 * The function under test takes a strategy name and returns the
 * per-strategy indicator set; the focus is the dispatch logic,
 * not the renderers (which are tested in their own files).
 *
 * Phase 81 changes: the 4 disabled strategies now have
 * strategy-specific indicators in addition to the universal
 * Donchian band. The new tests assert the ≥1 line + ≥1 marker
 * contract per disabled strategy.
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

  it("the ENABLED strategy (donchian_pivot_composition) has 4 line indicators + 1 marker indicator (Phase 81: +Bollinger, +daily_pivot)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    expect(set).toBeDefined();
    // Phase 79 had 2 lines (donchian + pivot). Phase 81 added 2
    // more (bollinger + daily_pivot) for a total of 4.
    expect(set?.lines.length).toBe(4);
    expect(set?.markers.length).toBe(1);
    // The four lines are: Donchian band + rolling pivot + Bollinger
    // band + daily pivot.
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).toContain("donchian");
    expect(lineNames).toContain("pivot");
    expect(lineNames).toContain("bollinger");
    expect(lineNames).toContain("daily_pivot");
    // The marker is the breakout signal.
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("breakout_signals");
  });

  // -------------------------------------------------------------------------
  // Phase 81: the 4 disabled strategies now have strategy-specific
  // indicators in addition to the universal Donchian band. Each
  // disabled strategy MUST have at least 1 line OR at least 1 marker
  // that is strategy-specific (not the universal Donchian).
  // -------------------------------------------------------------------------

  it("dydx_cex_carry has the Donchian band + funding rate + funding spread + funding-paid markers", () => {
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    expect(set).toBeDefined();
    // 3 lines: donchian, funding_rate, funding_spread
    expect(set?.lines.length).toBe(3);
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).toContain("donchian");
    expect(lineNames).toContain("funding_rate");
    expect(lineNames).toContain("funding_spread");
    // 1 marker: funding_paid
    expect(set?.markers.length).toBe(1);
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("funding_paid");
  });

  it("cascade_fade has the Donchian band + cascade event markers", () => {
    const set = STRATEGY_INDICATOR_SETS["cascade_fade"];
    expect(set).toBeDefined();
    // 1 line: donchian
    expect(set?.lines.length).toBe(1);
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).toEqual(["donchian"]);
    // 1 marker: cascade_events
    expect(set?.markers.length).toBe(1);
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("cascade_events");
  });

  it("funding_flip_kill_switch has the Donchian band + funding rate + funding-flip markers", () => {
    const set = STRATEGY_INDICATOR_SETS["funding_flip_kill_switch"];
    expect(set).toBeDefined();
    // 2 lines: donchian, funding_rate
    expect(set?.lines.length).toBe(2);
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).toContain("donchian");
    expect(lineNames).toContain("funding_rate");
    // 1 marker: funding_flips
    expect(set?.markers.length).toBe(1);
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("funding_flips");
  });

  it("regime_detector has the Donchian band + regime-change markers", () => {
    const set = STRATEGY_INDICATOR_SETS["regime_detector"];
    expect(set).toBeDefined();
    // 1 line: donchian
    expect(set?.lines.length).toBe(1);
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).toEqual(["donchian"]);
    // 1 marker: regime_changes
    expect(set?.markers.length).toBe(1);
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("regime_changes");
  });

  it("every disabled strategy has ≥1 line AND ≥1 marker (the Phase 81 mandate)", () => {
    for (const name of [
      "dydx_cex_carry",
      "cascade_fade",
      "funding_flip_kill_switch",
      "regime_detector",
    ] as const) {
      // eslint-disable-next-line security/detect-object-injection -- `name` is from a const-tuple literal above
      const set = STRATEGY_INDICATOR_SETS[name];
      expect(set).toBeDefined();
      // The user mandate: each disabled strategy must show its
      // SPECIFIC drawings. Lines alone (universal Donchian band)
      // are not enough; markers alone are not enough. The
      // strategy must have at least one line AND at least one
      // marker.
      expect(set?.lines.length).toBeGreaterThanOrEqual(1);
      expect(set?.markers.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("getStrategyIndicatorSet", () => {
  it("returns the registered set for a known strategy", () => {
    const set = getStrategyIndicatorSet("donchian_pivot_composition");
    expect(set.strategy).toBe("donchian_pivot_composition");
    expect(set.lines.length).toBe(4);
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
