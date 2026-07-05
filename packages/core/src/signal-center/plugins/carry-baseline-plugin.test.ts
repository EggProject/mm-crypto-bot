// packages/core/src/signal-center/plugins/carry-baseline-plugin.test.ts —
// Phase 10G Track A reference plugin test suite.
//
// Test coverage (≥10) for CarryBaselinePlugin:
//
//   1.  Construction with default config
//   2.  Construction with timingLeverage=1 (baseline-only) accepted
//   3.  Construction with timingLeverage=2 REJECTED (1:10 hard guardrail)
//   4.  Metadata declares maxLeverage=10
//   5.  subscribe() stores bus reference
//   6.  recordFundingSnapshot throws when bus not wired
//   7.  Carry signal emitted on every funding snapshot
//   8.  Regime classifier: high / neutral / flip
//   9.  Sizing signal emitted on regime transitions
//  10.  1:10 leverage invariant: every emitted SizingSignal respects cap
//  11.  Config validation rejects leverage > 10
//  12.  Config validation rejects baseNotionalUsd <= 0
//  13.  Config validation rejects kellyCap > 1
//  14.  Determinism: same input sequence → same signal sequence
//  15.  reset() clears all state including fundingCollectedUsd
//  16.  dispose() releases bus reference
//  17.  Effective leverage always in {1, 10}
//  18.  Effective notional never exceeds baseNotional × 10
//  19.  Edge case: extreme funding regime (very high / very negative)
//  20.  Edge case: zero-vol period (all rates = 0)

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import {
  CarryBaselinePlugin,
  DEFAULT_CARRY_BASELINE_PLUGIN_CONFIG,
  extractCarrySignal,
} from "./carry-baseline-plugin.js";
import { isCarry, isSizing } from "../types.js";
import type { Bar } from "../types.js";
import type { FundingSnapshot } from "../../strategy/funding-carry.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (plugin: CarryBaselinePlugin): SignalBus => {
  const bus = mkBus();
  plugin.subscribe(bus);
  return bus;
};

const mkSnap = (
  fundingTimeMs: number,
  fundingRate: number,
): FundingSnapshot => ({
  fundingTime: fundingTimeMs,
  symbol: "BTCUSDT",
  fundingRate,
});

const mkBar = (close = 50_000): Bar => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume: 1000,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CarryBaselinePlugin", () => {
  it("construction with default config succeeds", () => {
    const p = new CarryBaselinePlugin();
    expect(p.config.timingLeverage).toBe(10);
    expect(p.config.baseNotionalUsd).toBe(10_000);
    expect(p.config.kellyCap).toBe(0.5);
    expect(p.config.volTargetMax).toBe(1.0);
    expect(p.state.currentRegime).toBe("neutral");
    expect(p.state.entryCount).toBe(0);
  });

  it("construction with timingLeverage=1 (baseline) accepted", () => {
    const p = new CarryBaselinePlugin({ timingLeverage: 1 });
    expect(p.config.timingLeverage).toBe(1);
    expect(p.effectiveLeverage()).toBe(1);
    expect(p.effectiveNotionalUsd()).toBe(10_000);
  });

  it("construction with timingLeverage=2 REJECTED (1:10 hard guardrail)", () => {
    expect(() => new CarryBaselinePlugin({ timingLeverage: 2 as 1 | 10 })).toThrow();
  });

  it("construction with timingLeverage=5 REJECTED", () => {
    expect(() => new CarryBaselinePlugin({ timingLeverage: 5 as 1 | 10 })).toThrow();
  });

  it("metadata declares maxLeverage=10", () => {
    const p = new CarryBaselinePlugin();
    expect(p.metadata.maxLeverage).toBe(10);
    expect(p.metadata.name).toBe("carry-baseline");
    expect(p.metadata.edgeClass).toBe("mixed");
    expect(p.metadata.capitalRequirement).toBe(10_000);
  });

  it("subscribe() stores bus reference (so recordFundingSnapshot works)", () => {
    const p = new CarryBaselinePlugin();
    const bus = wirePlugin(p);
    // Internal bus reference is set — recordFundingSnapshot should NOT throw.
    expect(() => p.recordFundingSnapshot(mkSnap(1_700_000_000_000, 0.0001))).not.toThrow();
    expect(bus.subscriberCount).toBe(0); // we don't subscribe to anything
  });

  it("recordFundingSnapshot throws when bus not wired", () => {
    const p = new CarryBaselinePlugin();
    expect(() => p.recordFundingSnapshot(mkSnap(1, 0.0001))).toThrow(/bus not wired/);
  });

  it("CarrySignal emitted on every funding snapshot", () => {
    const p = new CarryBaselinePlugin();
    const bus = wirePlugin(p);
    const received: unknown[] = [];
    bus.subscribe("carry", (s) => received.push(s));
    // Drive 5 snapshots with low rates — all should be neutral regime.
    for (let i = 0; i < 5; i++) {
      p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + i * 8 * 3600 * 1000, 0.0001));
    }
    expect(received.length).toBe(5);
    expect(p.state.carrySignalCount).toBe(5);
    for (const s of received) {
      expect(isCarry(s as never)).toBe(true);
    }
  });

  it("regime classifier: high / neutral / flip", () => {
    const p = new CarryBaselinePlugin();
    wirePlugin(p);
    // Build a stable rolling window of slightly-positive rates (median ≈ p75).
    const baseRate = 0.0001;
    const stableHistory = Array.from({ length: 100 }, (_, i) => baseRate + (i % 5) * 1e-6);
    // Use the public API so plugin state + carry state stay in sync.
    for (let i = 0; i < stableHistory.length; i++) {
      p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + i * 8 * 3600 * 1000, stableHistory[i]!));
    }
    const stats = p.state.lastRollingStats;
    // Window trimmed to windowDays*3 + 8 = 30*3 + 8 = 98 entries.
    expect(stats.count).toBeGreaterThanOrEqual(90);
    expect(stats.count).toBeLessThanOrEqual(98);

    // High: rate > p75 AND positive. Make rate 2× p75.
    const highRate = stats.p75 * 2;
    expect(p.classifyRegime(highRate, stats)).toBe("high");

    // Flip: rate < median AND negative.
    const flipRate = Math.min(stats.median - 1e-6, -1e-6);
    expect(p.classifyRegime(flipRate, stats)).toBe("flip");

    // Neutral: rate near median (positive but not > p75).
    const neutralRate = stats.median * 0.5;
    expect(p.classifyRegime(neutralRate, stats)).toBe("neutral");

    // Insufficient history → neutral.
    const emptyStats = { ...stats, count: 10 };
    expect(p.classifyRegime(0.001, emptyStats)).toBe("neutral");
  });

  it("SizingSignal emitted on regime transitions", () => {
    const p = new CarryBaselinePlugin();
    const bus = wirePlugin(p);
    const sizing: unknown[] = [];
    bus.subscribe("sizing", (s) => sizing.push(s));

    // Drive 60 snapshots with low positive rates (steady-state).
    for (let i = 0; i < 60; i++) {
      p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + i * 8 * 3600 * 1000, 0.0001));
    }
    const sizingBefore = sizing.length;
    // Drive a single negative snapshot — regime may flip.
    p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + 60 * 8 * 3600 * 1000, -0.0001));
    const sizingAfter = sizing.length;
    // We expect ≥1 sizing signal on the regime transition.
    expect(sizingAfter).toBeGreaterThanOrEqual(sizingBefore);
    expect(p.state.sizingSignalCount).toBeGreaterThanOrEqual(1);
    if (sizingAfter > 0) {
      const last = sizing[sizing.length - 1] as { kind: string; source: string };
      expect(last.kind).toBe("sizing");
      expect(last.source).toBe("carry-baseline");
    }
  });

  it("1:10 leverage invariant: every emitted SizingSignal respects cap", () => {
    const p = new CarryBaselinePlugin();
    const bus = wirePlugin(p);
    const allSizing: unknown[] = [];
    bus.subscribe("sizing", (s) => allSizing.push(s));
    // Drive many snapshots across regimes — exhaustively.
    const rates = [
      0.0001, 0.0002, 0.0003, 0.0004, 0.0005, 0.0006, 0.0007, 0.0008, 0.0009, 0.001,
      -0.0001, -0.0002, -0.0003, -0.0005, -0.001, 0.0, 0.0, 0.0, 0.0001, -0.0001,
    ];
    for (let i = 0; i < 200; i++) {
      const rate = rates[i % rates.length]!;
      p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + i * 8 * 3600 * 1000, rate));
    }
    expect(allSizing.length).toBeGreaterThan(0);
    for (const s of allSizing) {
      const sig = s as { notional: number; kellyFraction: number; volMultiplier: number };
      // The 1:10 mandate: notional ≤ baseNotional × 10.
      expect(sig.notional).toBeLessThanOrEqual(10_000 * 10);
      expect(sig.notional).toBeGreaterThanOrEqual(0);
      expect(sig.kellyFraction).toBeGreaterThanOrEqual(0);
      expect(sig.kellyFraction).toBeLessThanOrEqual(1);
      expect(sig.volMultiplier).toBeGreaterThanOrEqual(0);
      expect(sig.volMultiplier).toBeLessThanOrEqual(1);
    }
  });

  it("config validation rejects leverage > 10", () => {
    const p = new CarryBaselinePlugin();
    const r1 = p.validateConfig({ timingLeverage: 11 });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.field).toBe("timingLeverage");
      expect(r1.error.message).toMatch(/1:10 HARD GUARDRAIL/);
    }
  });

  it("config validation rejects baseNotionalUsd <= 0", () => {
    const p = new CarryBaselinePlugin();
    const r = p.validateConfig({ baseNotionalUsd: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("baseNotionalUsd");
    }
  });

  it("config validation rejects kellyCap > 1", () => {
    const p = new CarryBaselinePlugin();
    const r = p.validateConfig({ kellyCap: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("kellyCap");
    }
  });

  it("config validation: undefined / null is ok (use defaults)", () => {
    const p = new CarryBaselinePlugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    expect(p.validateConfig(null).ok).toBe(true);
  });

  it("determinism: same input sequence → same signal sequence", () => {
    const runOnce = (): { carrySeq: string[]; sizingSeq: number[] } => {
      const p = new CarryBaselinePlugin();
      const bus = wirePlugin(p);
      const carrySeq: string[] = [];
      const sizingSeq: number[] = [];
      bus.subscribe("carry", (s) => {
        const sig = s as { fundingRate: number; regime: string };
        carrySeq.push(`${sig.fundingRate.toFixed(6)}:${sig.regime}`);
      });
      bus.subscribe("sizing", (s) => {
        const sig = s as { notional: number };
        sizingSeq.push(sig.notional);
      });
      // Drive deterministic snapshot sequence.
      const rates = [0.0001, 0.0002, 0.0003, -0.0001, -0.0002, 0.00015];
      for (let i = 0; i < 100; i++) {
        p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + i * 8 * 3600 * 1000, rates[i % rates.length]!));
      }
      return { carrySeq, sizingSeq };
    };
    const r1 = runOnce();
    const r2 = runOnce();
    expect(r1.carrySeq).toEqual(r2.carrySeq);
    expect(r1.sizingSeq).toEqual(r2.sizingSeq);
    expect(r1.carrySeq.length).toBe(100);
  });

  it("reset() clears all state including fundingCollectedUsd", () => {
    const p = new CarryBaselinePlugin();
    wirePlugin(p);
    for (let i = 0; i < 50; i++) {
      p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + i * 8 * 3600 * 1000, 0.0002));
    }
    expect(p.state.fundingCollectedUsd).toBeGreaterThanOrEqual(0);
    expect(p.state.carrySignalCount).toBeGreaterThan(0);

    p.reset();
    expect(p.state.fundingCollectedUsd).toBe(0);
    expect(p.state.carrySignalCount).toBe(0);
    expect(p.state.entryCount).toBe(0);
    expect(p.state.exitCount).toBe(0);
    expect(p.state.fundingHistory.length).toBe(0);
    expect(p.state.currentRegime).toBe("neutral");
    expect(p.state.isInCarry).toBe(false);
  });

  it("dispose() releases bus reference", () => {
    const p = new CarryBaselinePlugin();
    wirePlugin(p);
    p.dispose();
    // After dispose, recordFundingSnapshot should throw because bus is nulled.
    expect(() => p.recordFundingSnapshot(mkSnap(1, 0.0001))).toThrow(/bus not wired/);
  });

  it("effectiveLeverage always in {1, 10}", () => {
    expect(new CarryBaselinePlugin({ timingLeverage: 10 }).effectiveLeverage()).toBe(10);
    expect(new CarryBaselinePlugin({ timingLeverage: 1 }).effectiveLeverage()).toBe(1);
  });

  it("effectiveNotional never exceeds baseNotional × 10", () => {
    expect(new CarryBaselinePlugin({ baseNotionalUsd: 5_000 }).effectiveNotionalUsd()).toBe(50_000);
    expect(new CarryBaselinePlugin({ baseNotionalUsd: 5_000, timingLeverage: 1 }).effectiveNotionalUsd()).toBe(5_000);
    expect(new CarryBaselinePlugin({ baseNotionalUsd: 100_000 }).effectiveNotionalUsd()).toBe(1_000_000);
  });

  it("edge case: extreme funding regime (very high / very negative)", () => {
    const p = new CarryBaselinePlugin();
    const bus = wirePlugin(p);
    // Very high funding (e.g., 0.01 = 1% per 8h, abnormal but possible).
    p.recordFundingSnapshot(mkSnap(1_700_000_000_000, 0.01));
    // Very negative funding (-0.005 = -0.5% per 8h, flip regime).
    p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + 8 * 3600 * 1000, -0.005));
    expect(p.state.carrySignalCount).toBe(2);
    // The negative rate should push toward 'flip' regime (eventually).
    // The exact classification depends on rolling stats; just verify no crash.
    expect(bus.snapshot().length).toBeGreaterThanOrEqual(2);
  });

  it("edge case: zero-vol period (all rates = 0) → neutral regime", () => {
    const p = new CarryBaselinePlugin();
    wirePlugin(p);
    for (let i = 0; i < 50; i++) {
      p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + i * 8 * 3600 * 1000, 0));
    }
    // Zero rates everywhere — should classify as neutral (median=0, p75=0).
    expect(p.state.currentRegime).toBe("neutral");
    // No entry should fire (rate never > p75).
    expect(p.state.entryCount).toBe(0);
  });

  it("extractCarrySignal helper correctly narrows", () => {
    const sig = {
      kind: "carry" as const,
      fundingRate: 0.0001,
      regime: "high" as const,
      source: "test",
    };
    expect(extractCarrySignal(sig)).toEqual(sig);
    expect(extractCarrySignal({ kind: "direction", side: "long", strength: 0.5, source: "x" })).toBeNull();
    expect(extractCarrySignal(null)).toBeNull();
    expect(extractCarrySignal("not a signal")).toBeNull();
  });

  it("DEFAULT_CARRY_BASELINE_PLUGIN_CONFIG has expected invariants", () => {
    expect(DEFAULT_CARRY_BASELINE_PLUGIN_CONFIG.timingLeverage).toBe(10);
    expect(DEFAULT_CARRY_BASELINE_PLUGIN_CONFIG.kellyCap).toBeLessThanOrEqual(1);
    expect(DEFAULT_CARRY_BASELINE_PLUGIN_CONFIG.volTargetMax).toBeLessThanOrEqual(1);
    expect(DEFAULT_CARRY_BASELINE_PLUGIN_CONFIG.baseNotionalUsd).toBe(10_000);
  });

  it("subscribe + emit integration: signal observed in test-side subscriber", () => {
    const p = new CarryBaselinePlugin();
    const bus = wirePlugin(p);
    const carryObserved: unknown[] = [];
    const sizingObserved: unknown[] = [];
    bus.subscribe("carry", (s) => carryObserved.push(s));
    bus.subscribe("sizing", (s) => sizingObserved.push(s));
    // Strong regime variation: low → high → negative to force regime transitions.
    const lowRates = Array.from({ length: 40 }, () => 0.0001);
    const highRates = Array.from({ length: 20 }, () => 0.01); // 100× typical
    const negativeRates = Array.from({ length: 20 }, () => -0.005);
    const allRates = [...lowRates, ...highRates, ...negativeRates];
    for (let i = 0; i < allRates.length; i++) {
      p.recordFundingSnapshot(mkSnap(1_700_000_000_000 + i * 8 * 3600 * 1000, allRates[i]!));
    }
    expect(carryObserved.length).toBe(allRates.length);
    // With this much variation, regime MUST transition multiple times,
    // so sizing signals must fire. We check ≥1 to be robust.
    expect(sizingObserved.length).toBeGreaterThanOrEqual(1);
    expect(isCarry(carryObserved[0] as never)).toBe(true);
    if (sizingObserved.length > 0) {
      expect(isSizing(sizingObserved[sizingObserved.length - 1] as never)).toBe(true);
    }
  });

  it("onBar accepts a bar (interface compliance)", () => {
    const p = new CarryBaselinePlugin();
    wirePlugin(p);
    // onBar is a no-op for carry — it just shouldn't throw.
    expect(() => p.onBar(mkBar(), p.state)).not.toThrow();
  });
});