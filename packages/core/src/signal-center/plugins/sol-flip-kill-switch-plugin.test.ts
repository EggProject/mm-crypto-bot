// packages/core/src/signal-center/plugins/sol-flip-kill-switch-plugin.test.ts —
// Phase 11.1d Track A.
//
// Test coverage (≥15) for SOLFlipKillSwitchPlugin:
//
//   1.  Construction with default config (7d/1.5σ/5d) succeeds
//   2.  Construction with timingLeverage=1 accepted
//   3.  Construction with timingLeverage=2 REJECTED (1:10 hard guardrail)
//   4.  Construction with signFlipWindowDays=0 REJECTED
//   5.  Construction with extremeSigmaThreshold=-1 REJECTED
//   6.  Construction with persistenceDays=-1 REJECTED
//   7.  Construction with volWindowDays=0 REJECTED
//   8.  Construction with baseNotionalUsd=0 REJECTED
//   9.  metadata declares name/edgeClass/capitalRequirement/maxLeverage correctly
//  10.  subscribe() stores bus reference
//  11.  onBar is a no-op (doesn't throw)
//  12.  subscribe filters non-carry signals
//  13.  7d sign-flip detection: alternating ±rates → flipRegime becomes true
//  14.  1.5σ extreme regime detection: rate spike → extremeRegime triggers
//  15.  5d persistence: kill-switch stays engaged for persistenceDays after last signal
//  16.  Persistence reset on regime change (fresh signal extends window)
//  17.  RiskSignal emitted on trigger with breach: true + reason: "funding-flip"
//  18.  RiskSignal emitted with reason: "extreme-regime" when z-score fires
//  19.  RiskSignal emitted on disengage with breach: false + reason: "regime-cleared"
//  20.  Per-symbol enable flag: SOL on, BTC/ETH off (samples for non-enabled dropped)
//  21.  Multi-symbol enable: both SOL and ETH register independently
//  22.  Synthetic breach test: 7d flip on SOL synthetic data → trigger fires
//  23.  reset() clears all state
//  24.  dispose() releases bus reference
//  25.  Determinism: same input sequence → same signal sequence
//  26.  Layer 2 leverage invariant: assertLeverageInvariant fires per-emit
//  27.  Layer 2 leverage invariant: assertLeverageInvariant runs without throwing
//  28.  closeNotionalUsd respects maxCloseNotionalUsd ceiling
//  29.  emitCloseInstruction=false suppresses closeNotionalUsd
//  30.  recordFundingSample throws on non-finite fundingRate
//  31.  recordFundingSample throws on non-finite timestampMs
//  32.  Edge case: all-zero funding rates → no regime (no flip)
//  33.  Edge case: insufficient history → regimeActive=false
//  34.  Edge case: positive regime → no flip, no extreme
//  35.  Config validation: invalid enabledSymbols rejected
//  36.  Config validation: invalid baseNotionalUsd rejected
//  37.  Config validation: invalid maxCloseNotionalUsd rejected
//  38.  Config validation: invalid timingLeverage rejected
//  39.  Config validation: invalid signFlipWindowDays rejected
//  40.  Config validation: invalid extremeSigmaThreshold rejected
//  41.  Config validation: invalid persistenceDays rejected
//  42.  Config validation: undefined/null is ok
//  43.  Config validation: non-object config rejected
//  44.  DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG invariants

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import {
  DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
  SOLFlipKillSwitchPlugin,
} from "./sol-flip-kill-switch-plugin.js";
import { isCarry, isRisk, type RiskSignal } from "../types.js";
import type { Bar } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (plugin: SOLFlipKillSwitchPlugin): SignalBus => {
  const bus = mkBus();
  plugin.subscribe(bus);
  return bus;
};

const mkBar = (close = 50_000): Bar => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume: 1000,
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Build a funding-rate sequence that alternates signs every snapshot
 * for `days` days — emulates a flip regime (high flip count). With
 * signFlipWindowDays=7 (Phase 9 9D default), 7+ days of alternating
 * rates triggers the flip regime (flipCount ≥ flipThreshold=10).
 */
const mkFlipRegimeSequence = (days: number): number[] => {
  const out: number[] = [];
  const snapshotsPerDay = 3; // 8h cadence
  for (let i = 0; i < days * snapshotsPerDay; i++) {
    out.push(i % 2 === 0 ? 0.0005 : -0.0005);
  }
  return out;
};

/**
 * Build a funding-rate sequence with 30d stable baseline + N days of
 * 5×-larger rates (extreme regime). The z-score of the trailing 7d
 * |rate| mean vs the 30d baseline mean should exceed extremeSigmaThreshold.
 */
const mkExtremeRegimeSequence = (baselineDays: number, extremeDays: number): number[] => {
  const out: number[] = [];
  const snapshotsPerDay = 3;
  // Baseline: small positive rates with low variance.
  for (let i = 0; i < baselineDays * snapshotsPerDay; i++) {
    out.push(0.0001 + (i % 5) * 1e-6);
  }
  // Extreme: rates 50× the baseline mean — guarantees z-score >= 1.5σ.
  for (let i = 0; i < extremeDays * snapshotsPerDay; i++) {
    out.push(0.005);
  }
  return out;
};

/**
 * Drive the plugin with a sequence of (rate, ts) pairs for a single symbol.
 */
const driveSequence = (
  p: SOLFlipKillSwitchPlugin,
  symbol: string,
  rates: readonly number[],
  startTs: number,
  intervalMs = 8 * HOUR_MS,
): void => {
  for (let i = 0; i < rates.length; i++) {
    p.recordFundingSample(symbol, rates[i]!, startTs + i * intervalMs);
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SOLFlipKillSwitchPlugin", () => {
  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  it("construction with default config (7d/1.5σ/5d) succeeds", () => {
    const p = new SOLFlipKillSwitchPlugin();
    expect(p.config.signFlipWindowDays).toBe(7);
    expect(p.config.extremeSigmaThreshold).toBe(1.5);
    expect(p.config.persistenceDays).toBe(5);
    expect(p.config.enabledSymbols).toEqual(["SOL/USDT"]);
    expect(p.config.timingLeverage).toBe(10);
    expect(p.state.killSwitchEngaged).toBe(false);
    expect(p.state.riskSignalCount).toBe(0);
  });

  it("construction with timingLeverage=1 accepted", () => {
    const p = new SOLFlipKillSwitchPlugin({ timingLeverage: 1 });
    expect(p.config.timingLeverage).toBe(1);
  });

  it("construction with timingLeverage=2 REJECTED (1:10 hard guardrail)", () => {
    expect(() => new SOLFlipKillSwitchPlugin({ timingLeverage: 2 as 1 | 10 })).toThrow(
      /1:10 HARD GUARDRAIL/,
    );
  });

  it("construction with signFlipWindowDays=0 REJECTED", () => {
    expect(() => new SOLFlipKillSwitchPlugin({ signFlipWindowDays: 0 })).toThrow(
      /signFlipWindowDays/,
    );
  });

  it("construction with extremeSigmaThreshold=-1 REJECTED", () => {
    expect(
      () => new SOLFlipKillSwitchPlugin({ extremeSigmaThreshold: -1 }),
    ).toThrow(/extremeSigmaThreshold/);
  });

  it("construction with persistenceDays=-1 REJECTED", () => {
    expect(() => new SOLFlipKillSwitchPlugin({ persistenceDays: -1 })).toThrow(
      /persistenceDays/,
    );
  });

  it("construction with volWindowDays=0 REJECTED", () => {
    expect(() => new SOLFlipKillSwitchPlugin({ volWindowDays: 0 })).toThrow(
      /volWindowDays/,
    );
  });

  it("construction with baseNotionalUsd=0 REJECTED", () => {
    expect(() => new SOLFlipKillSwitchPlugin({ baseNotionalUsd: 0 })).toThrow(
      /baseNotionalUsd/,
    );
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  it("metadata declares name/edgeClass/capitalRequirement/maxLeverage correctly", () => {
    const p = new SOLFlipKillSwitchPlugin();
    expect(p.metadata.name).toBe("sol-flip-kill-switch");
    expect(p.metadata.version).toBe("1.0.0");
    expect(p.metadata.edgeClass).toBe("risk");
    expect(p.metadata.capitalRequirement).toBe(0);
    expect(p.metadata.maxLeverage).toBe(10); // 1:10 HARD GUARDRAIL — Layer 1
    expect(p.metadata.description).toContain("Phase 11.1d");
  });

  // -----------------------------------------------------------------------
  // subscribe / onBar
  // -----------------------------------------------------------------------

  it("subscribe() stores bus reference", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const bus = wirePlugin(p);
    // Internal bus reference is set — recordFundingSnapshot should NOT throw.
    expect(() =>
      p.recordFundingSample("SOL/USDT", 0.0001, 1_700_000_000_000),
    ).not.toThrow();
    // Should have subscribed to 'carry' signals.
    expect(bus.subscriberCount).toBe(1);
    expect(bus.subscribersForKind("carry")).toBe(1);
  });

  it("onBar is a no-op (doesn't throw)", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    expect(() => p.onBar(mkBar(), p.state)).not.toThrow();
  });

  it("subscribe filters non-carry signals (only processes 'carry' kind)", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const bus = wirePlugin(p);
    const initialCount = p.state.riskSignalCount;
    // Emit a 'direction' signal — should NOT trigger our handler.
    bus.emit({
      kind: "direction",
      side: "long",
      strength: 0.5,
      source: "test",
    });
    expect(p.state.riskSignalCount).toBe(initialCount);
  });

  it("subscribe consumes carry signals and drives the detector", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const bus = wirePlugin(p);
    // Feed a flip-regime sequence via bus carry signals.
    const rates = mkFlipRegimeSequence(7);
    const ts0 = 1_700_000_000_000;
    for (let i = 0; i < rates.length; i++) {
      bus.emit({
        kind: "carry",
        fundingRate: rates[i]!,
        regime: "neutral",
        source: "test",
        timestampMs: ts0 + i * 8 * HOUR_MS,
      });
    }
    // The detector should have been driven by the bus feed.
    expect(p.state.fundingHistory.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 7d sign-flip detection
  // -----------------------------------------------------------------------

  it("7d sign-flip detection: alternating ±rates → flipRegime becomes true", () => {
    // Use Phase 9 9D defaults (signFlipWindowDays=7, flipThreshold=10).
    // 7+ days of alternating rates triggers the flip regime.
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    const rates = mkFlipRegimeSequence(7);
    driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
    expect(p.state.flipRegimeSignalCount).toBeGreaterThan(0);
    expect(p.state.killSwitchEngaged).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 1.5σ extreme regime detection
  // -----------------------------------------------------------------------

  it("1.5σ extreme regime detection: rate spike → extremeRegime triggers", () => {
    // Use defaults. 30d baseline + 7d extreme (so trailing 7d window is
    // all extreme) → z-score > 1.5σ. The trailing 30d includes the
    // 7d extreme, but the extreme-vs-baseline contrast dominates.
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    const rates = mkExtremeRegimeSequence(30, 7);
    driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
    expect(p.state.extremeRegimeSignalCount).toBeGreaterThan(0);
    expect(p.state.killSwitchEngaged).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 5d persistence (direct state manipulation)
  // -----------------------------------------------------------------------

  it("5d persistence: kill-switch stays engaged for persistenceDays after last signal", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    // Manually simulate an active kill-switch (engaged at ts0, persists 5d).
    const ts0 = 1_700_000_000_000;
    p.state.killSwitchEngaged = true;
    p.state.killSwitchUntilMs = ts0 + 5 * DAY_MS;
    p.state.lastRegimeSignalMs = ts0;
    // 2 days later — still engaged (within 5d window).
    expect(p.isKillSwitchEngaged(ts0 + 2 * DAY_MS)).toBe(true);
    // 4 days later — still engaged.
    expect(p.isKillSwitchEngaged(ts0 + 4 * DAY_MS)).toBe(true);
    // 6 days later — disengaged.
    expect(p.isKillSwitchEngaged(ts0 + 6 * DAY_MS)).toBe(false);
  });

  it("persistence reset on regime change (fresh signal extends window)", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // Initial engagement at ts0, persists 5d.
    p.state.killSwitchEngaged = true;
    p.state.killSwitchUntilMs = ts0 + 5 * DAY_MS;
    p.state.lastRegimeSignalMs = ts0;
    // Fresh signal at day 3 — extends persistence to day 3 + 5d = day 8.
    const freshTs = ts0 + 3 * DAY_MS;
    p.state.killSwitchUntilMs = freshTs + 5 * DAY_MS;
    p.state.lastRegimeSignalMs = freshTs;
    // Day 6 — still engaged (fresh signal at day 3 → until day 8).
    expect(p.isKillSwitchEngaged(ts0 + 6 * DAY_MS)).toBe(true);
    // Day 9 — disengaged.
    expect(p.isKillSwitchEngaged(ts0 + 9 * DAY_MS)).toBe(false);
  });

  it("isKillSwitchEngaged returns false when killSwitchUntilMs is null", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    expect(p.isKillSwitchEngaged(1_700_000_000_000)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // RiskSignal emission
  // -----------------------------------------------------------------------

  it("RiskSignal emitted on trigger with breach: true + reason: 'funding-flip'", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const bus = wirePlugin(p);
    const risks: RiskSignal[] = [];
    bus.subscribe("risk", (s) => {
      if (isRisk(s)) risks.push(s);
    });
    // Drive a flip regime (7 days → 21 alternating snapshots).
    const rates = mkFlipRegimeSequence(7);
    driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
    expect(risks.length).toBeGreaterThan(0);
    const breachRisk = risks.find((r) => r.breach === true);
    expect(breachRisk).toBeDefined();
    expect(breachRisk!.reason).toBe("funding-flip");
    expect(breachRisk!.source).toBe("sol-flip-kill-switch");
    expect(breachRisk!.closeNotionalUsd).toBe(100_000); // 10k × 10
  });

  it("RiskSignal emitted with reason: 'extreme-regime' when z-score fires", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const bus = wirePlugin(p);
    const risks: RiskSignal[] = [];
    bus.subscribe("risk", (s) => {
      if (isRisk(s)) risks.push(s);
    });
    const rates = mkExtremeRegimeSequence(30, 7);
    driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
    const extremeRisk = risks.find((r) => r.reason === "extreme-regime");
    expect(extremeRisk).toBeDefined();
    expect(extremeRisk!.breach).toBe(true);
  });

  it("RiskSignal emitted on disengage with breach: false + reason: 'regime-cleared'", () => {
    const p = new SOLFlipKillSwitchPlugin({
      persistenceDays: 1, // short persistence for fast test
    });
    const bus = wirePlugin(p);
    const risks: RiskSignal[] = [];
    bus.subscribe("risk", (s) => {
      if (isRisk(s)) risks.push(s);
    });
    const ts0 = 1_700_000_000_000;
    // Drive flip regime (engages).
    const flipRates = mkFlipRegimeSequence(7);
    driveSequence(p, "SOL/USDT", flipRates, ts0);
    expect(p.state.killSwitchEngaged).toBe(true);
    // Drive calm regime past persistence window (1d) — needs to last
    // longer than persistenceDays * 24 snapshots worth. Calm: stable
    // positive rates for 3 days.
    const calmRates = Array.from({ length: 9 }, () => 0.0001);
    const calmTs0 = ts0 + flipRates.length * 8 * HOUR_MS + 2 * DAY_MS;
    driveSequence(p, "SOL/USDT", calmRates, calmTs0);
    // Verify a cleared signal was emitted.
    const clearedRisk = risks.find((r) => r.breach === false);
    expect(clearedRisk).toBeDefined();
    expect(clearedRisk!.reason).toBe("regime-cleared");
  });

  // -----------------------------------------------------------------------
  // Per-symbol enable filter
  // -----------------------------------------------------------------------

  it("per-symbol enable flag: SOL on, BTC/ETH off (samples for non-enabled dropped)", () => {
    const p = new SOLFlipKillSwitchPlugin({
      enabledSymbols: ["SOL/USDT"],
    });
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // Drive flip regime on BTC — should NOT engage kill-switch (not enabled).
    const rates = mkFlipRegimeSequence(7);
    driveSequence(p, "BTC/USDT", rates, ts0);
    expect(p.state.killSwitchEngaged).toBe(false);
    expect(p.state.fundingHistory.length).toBe(0); // not added
    expect(p.state.perSymbolFundingHistory.has("BTC/USDT")).toBe(false);
    // Drive flip regime on SOL — should engage.
    driveSequence(p, "SOL/USDT", rates, ts0);
    expect(p.state.killSwitchEngaged).toBe(true);
    expect(p.state.fundingHistory.length).toBeGreaterThan(0);
  });

  it("multi-symbol enable: both SOL and ETH register independently", () => {
    const p = new SOLFlipKillSwitchPlugin({
      enabledSymbols: ["SOL/USDT", "ETH/USDT"],
    });
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // Drive ETH flip regime — engages kill-switch.
    const rates = mkFlipRegimeSequence(7);
    driveSequence(p, "ETH/USDT", rates, ts0);
    expect(p.state.killSwitchEngaged).toBe(true);
    // Verify per-symbol history has ETH but not SOL.
    expect(p.state.perSymbolFundingHistory.has("ETH/USDT")).toBe(true);
    expect(p.state.perSymbolFundingHistory.has("SOL/USDT")).toBe(false);
  });

  it("enabledSymbolsList returns the configured list", () => {
    const p = new SOLFlipKillSwitchPlugin({
      enabledSymbols: ["SOL/USDT", "ETH/USDT"],
    });
    expect(p.enabledSymbolsList()).toEqual(["SOL/USDT", "ETH/USDT"]);
  });

  it("default enabledSymbols is SOL/USDT only (BTC/ETH not registered)", () => {
    const p = new SOLFlipKillSwitchPlugin();
    expect(p.enabledSymbolsList()).toEqual(["SOL/USDT"]);
    // BTC/ETH samples should be dropped.
    p.recordFundingSample("BTC/USDT", 0.0005, 1_700_000_000_000);
    p.recordFundingSample("ETH/USDT", 0.0005, 1_700_000_000_000);
    expect(p.state.fundingHistory.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Synthetic breach test
  // -----------------------------------------------------------------------

  it("synthetic breach test: 7d flip on SOL synthetic data → trigger fires", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const bus = wirePlugin(p);
    // 7 days of alternating rates (21 snapshots).
    const rates = mkFlipRegimeSequence(7);
    driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
    // At least one RiskSignal with breach: true should have been emitted.
    expect(p.state.riskSignalCount).toBeGreaterThan(0);
    expect(p.state.riskSignalBreachCount).toBeGreaterThan(0);
    expect(p.state.killSwitchEngaged).toBe(true);
    // And the bus should have observed it.
    const allRisks = bus.snapshot().filter(isRisk);
    const breachRisk = allRisks.find((r) => r.breach === true);
    expect(breachRisk).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // reset / dispose
  // -----------------------------------------------------------------------

  it("reset() clears all state", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    const rates = mkFlipRegimeSequence(7);
    driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
    expect(p.state.killSwitchEngaged).toBe(true);
    expect(p.state.riskSignalCount).toBeGreaterThan(0);

    p.reset();
    expect(p.state.killSwitchEngaged).toBe(false);
    expect(p.state.riskSignalCount).toBe(0);
    expect(p.state.riskSignalBreachCount).toBe(0);
    expect(p.state.fundingHistory.length).toBe(0);
    expect(p.state.perSymbolFundingHistory.size).toBe(0);
    expect(p.state.lastRiskSignal).toBeNull();
    expect(p.state.flipRegimeSignalCount).toBe(0);
    expect(p.state.extremeRegimeSignalCount).toBe(0);
  });

  it("dispose() releases bus reference and unsubscribes", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const bus = wirePlugin(p);
    expect(bus.subscriberCount).toBe(1);
    p.dispose();
    expect(bus.subscriberCount).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------

  it("determinism: same input sequence → same signal sequence", () => {
    const runOnce = (): {
      regimeActivationCount: number;
      riskSignalCount: number;
      breachCount: number;
      breachReasons: string[];
    } => {
      const p = new SOLFlipKillSwitchPlugin();
      const bus = wirePlugin(p);
      const risks: RiskSignal[] = [];
      bus.subscribe("risk", (s) => {
        if (isRisk(s)) risks.push(s);
      });
      const rates = mkFlipRegimeSequence(7);
      driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
      return {
        regimeActivationCount: p.state.regimeActivationCount,
        riskSignalCount: p.state.riskSignalCount,
        breachCount: p.state.riskSignalBreachCount,
        breachReasons: risks.filter((r) => r.breach === true).map((r) => r.reason ?? ""),
      };
    };
    const r1 = runOnce();
    const r2 = runOnce();
    expect(r1.regimeActivationCount).toBe(r2.regimeActivationCount);
    expect(r1.riskSignalCount).toBe(r2.riskSignalCount);
    expect(r1.breachCount).toBe(r2.breachCount);
    expect(r1.breachReasons).toEqual(r2.breachReasons);
  });

  // -----------------------------------------------------------------------
  // Layer 2 leverage invariant
  // -----------------------------------------------------------------------

  it("Layer 2 leverage invariant: assertLeverageInvariant fires per-emit", () => {
    const p = new SOLFlipKillSwitchPlugin({
      baseNotionalUsd: 10_000,
      timingLeverage: 10,
      maxCloseNotionalUsd: 100_000,
    });
    wirePlugin(p);
    const rates = mkFlipRegimeSequence(7);
    driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
    // Each RiskSignal emit triggers a Layer 2 assertion.
    expect(p.state.leverageAssertionCount).toBeGreaterThan(0);
    expect(p.state.leverageAssertionCount).toBe(p.state.riskSignalCount);
    // closeNotionalUsd should equal baseNotional × leverage = 100k.
    const lastRisk = p.state.lastRiskSignal;
    expect(lastRisk).not.toBeNull();
    expect(lastRisk!.closeNotionalUsd).toBe(100_000);
  });

  it("Layer 2 leverage invariant: runs without throwing on default config", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    const rates = mkFlipRegimeSequence(7);
    // Driving the detector should NOT throw — the Layer 2 assertion
    // must pass on every emit.
    expect(() => driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000)).not.toThrow();
    expect(p.state.leverageAssertionCount).toBeGreaterThan(0);
  });

  it("closeNotionalUsd respects maxCloseNotionalUsd ceiling", () => {
    const p = new SOLFlipKillSwitchPlugin({
      baseNotionalUsd: 10_000,
      timingLeverage: 10,
      maxCloseNotionalUsd: 50_000, // less than 10× default
    });
    wirePlugin(p);
    const rates = mkFlipRegimeSequence(7);
    driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
    const lastRisk = p.state.lastRiskSignal;
    expect(lastRisk).not.toBeNull();
    expect(lastRisk!.closeNotionalUsd).toBe(50_000); // clamped to maxCloseNotionalUsd
  });

  it("emitCloseInstruction=false suppresses closeNotionalUsd", () => {
    const p = new SOLFlipKillSwitchPlugin({
      emitCloseInstruction: false,
    });
    wirePlugin(p);
    const rates = mkFlipRegimeSequence(7);
    driveSequence(p, "SOL/USDT", rates, 1_700_000_000_000);
    const lastRisk = p.state.lastRiskSignal;
    expect(lastRisk).not.toBeNull();
    expect(lastRisk!.closeNotionalUsd).toBeUndefined();
    // But the Layer 2 assertion should still fire (sanity check).
    expect(p.state.leverageAssertionCount).toBeGreaterThan(0);
  });

  it("maxCloseNotionalUsd > baseNotional × leverage REJECTED at construction", () => {
    expect(
      () =>
        new SOLFlipKillSwitchPlugin({
          baseNotionalUsd: 10_000,
          timingLeverage: 10,
          maxCloseNotionalUsd: 200_000, // 2× the 1:10 cap
        }),
    ).toThrow(/maxCloseNotionalUsd/);
  });

  // -----------------------------------------------------------------------
  // Input validation
  // -----------------------------------------------------------------------

  it("recordFundingSample throws on non-finite fundingRate", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    expect(() =>
      p.recordFundingSample("SOL/USDT", Number.NaN, 1_700_000_000_000),
    ).toThrow(/fundingRate must be finite/);
    expect(() =>
      p.recordFundingSample("SOL/USDT", Number.POSITIVE_INFINITY, 1_700_000_000_000),
    ).toThrow(/fundingRate must be finite/);
  });

  it("recordFundingSample throws on non-finite timestampMs", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    expect(() => p.recordFundingSample("SOL/USDT", 0.0001, Number.NaN)).toThrow(
      /timestampMs must be/,
    );
    expect(() =>
      p.recordFundingSample("SOL/USDT", 0.0001, -1),
    ).toThrow(/timestampMs must be/);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("edge case: all-zero funding rates → no regime (no flip)", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    for (let i = 0; i < 100; i++) {
      p.recordFundingSample("SOL/USDT", 0, 1_700_000_000_000 + i * 8 * HOUR_MS);
    }
    expect(p.state.killSwitchEngaged).toBe(false);
    expect(p.state.flipRegimeSignalCount).toBe(0);
    expect(p.state.extremeRegimeSignalCount).toBe(0);
  });

  it("edge case: insufficient history → regimeActive=false", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    // Only 1 snapshot — insufficient history.
    p.recordFundingSample("SOL/USDT", 0.001, 1_700_000_000_000);
    const regime = p.currentRegime();
    expect(regime.regimeActive).toBe(false);
    expect(regime.reason).toBe("insufficient-history");
  });

  it("edge case: positive regime → no flip, no extreme", () => {
    const p = new SOLFlipKillSwitchPlugin();
    wirePlugin(p);
    // 30 days of stable positive rates.
    for (let i = 0; i < 90; i++) {
      p.recordFundingSample("SOL/USDT", 0.0001, 1_700_000_000_000 + i * 8 * HOUR_MS);
    }
    const regime = p.currentRegime();
    expect(regime.flipRegime).toBe(false);
    expect(regime.extremeRegime).toBe(false);
    expect(regime.negativeDominanceRegime).toBe(false);
    expect(p.state.killSwitchEngaged).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Config validation
  // -----------------------------------------------------------------------

  it("config validation: invalid enabledSymbols rejected", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const r = p.validateConfig({ enabledSymbols: "not-an-array" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("enabledSymbols");
  });

  it("config validation: enabledSymbols with empty strings rejected", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const r = p.validateConfig({ enabledSymbols: ["SOL/USDT", ""] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("enabledSymbols");
  });

  it("config validation: invalid baseNotionalUsd rejected", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const r = p.validateConfig({ baseNotionalUsd: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("baseNotionalUsd");
  });

  it("config validation: invalid maxCloseNotionalUsd rejected", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const r = p.validateConfig({ maxCloseNotionalUsd: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("maxCloseNotionalUsd");
  });

  it("config validation: invalid timingLeverage rejected", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const r = p.validateConfig({ timingLeverage: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("timingLeverage");
      expect(r.error.message).toMatch(/1:10 HARD GUARDRAIL/);
    }
  });

  it("config validation: invalid signFlipWindowDays rejected", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const r = p.validateConfig({ signFlipWindowDays: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("signFlipWindowDays");
  });

  it("config validation: invalid extremeSigmaThreshold rejected", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const r = p.validateConfig({ extremeSigmaThreshold: -0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("extremeSigmaThreshold");
  });

  it("config validation: invalid persistenceDays rejected", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const r = p.validateConfig({ persistenceDays: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("persistenceDays");
  });

  it("config validation: undefined/null is ok (use defaults)", () => {
    const p = new SOLFlipKillSwitchPlugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    expect(p.validateConfig(null).ok).toBe(true);
  });

  it("config validation: non-object config rejected", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const r = p.validateConfig("not-an-object");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("config");
  });

  // -----------------------------------------------------------------------
  // Default config invariants
  // -----------------------------------------------------------------------

  it("DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG has expected invariants", () => {
    expect(DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG.signFlipWindowDays).toBe(7);
    expect(DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG.extremeSigmaThreshold).toBe(1.5);
    expect(DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG.persistenceDays).toBe(5);
    expect(DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG.volWindowDays).toBe(30);
    expect(DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG.enabledSymbols).toEqual(["SOL/USDT"]);
    expect(DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG.timingLeverage).toBe(10);
    expect(DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG.baseNotionalUsd).toBe(10_000);
    expect(DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG.maxCloseNotionalUsd).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Carry-signal passthrough (defensive: subscribe handler only consumes 'carry')
// ---------------------------------------------------------------------------

describe("SOLFlipKillSwitchPlugin / carry-signal passthrough", () => {
  it("subscribe handler ignores non-carry signals", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const bus = wirePlugin(p);
    const initialCount = p.state.riskSignalCount;
    // Emit direction + sizing signals — should NOT trigger our handler.
    bus.emit({ kind: "direction", side: "long", strength: 0.5, source: "x" });
    bus.emit({
      kind: "sizing",
      kellyFraction: 0.5,
      volMultiplier: 1,
      notional: 50_000,
      source: "x",
    });
    expect(p.state.riskSignalCount).toBe(initialCount);
  });

  it("subscribe handler processes carry signals", () => {
    const p = new SOLFlipKillSwitchPlugin();
    const bus = wirePlugin(p);
    // Emit 7 days of flip-regime carry signals.
    const rates = mkFlipRegimeSequence(7);
    const ts0 = 1_700_000_000_000;
    for (let i = 0; i < rates.length; i++) {
      const sig = {
        kind: "carry" as const,
        fundingRate: rates[i]!,
        regime: "neutral" as const,
        source: "test",
        timestampMs: ts0 + i * 8 * HOUR_MS,
      };
      bus.emit(sig);
      expect(isCarry(sig)).toBe(true);
    }
    expect(p.state.riskSignalCount).toBeGreaterThan(0);
  });
});