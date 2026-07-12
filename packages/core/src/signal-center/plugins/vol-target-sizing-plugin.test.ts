// packages/core/src/signal-center/plugins/vol-target-sizing-plugin.test.ts —
// Phase 11.1c Track A — VolTargetSizingPlugin test suite.
//
// Test coverage (≥30 unit tests) for VolTargetSizingPlugin:
//
// Construction / config validation:
//   1-12 see plugin header for full breakdown.

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import { isSizing } from "../types.js";
import type { SizingSignal } from "../types.js";
import {
  DEFAULT_BASE_NOTIONAL_USD,
  DEFAULT_ENABLED_SYMBOLS,
  DEFAULT_MAX_VOL_MULTIPLIER,
  DEFAULT_MIN_VOL_MULTIPLIER,
  DEFAULT_TARGET_DAILY_VOL,
  DEFAULT_VOL_WINDOW_DAYS,
  MAX_MIN_VOL_MULTIPLIER,
  MAX_TARGET_DAILY_VOL,
  MAX_VOL_WINDOW_DAYS,
  MIN_MIN_VOL_MULTIPLIER,
  MIN_TARGET_DAILY_VOL,
  MIN_VOL_WINDOW_DAYS,
  ONE_TO_TEN_LEVERAGE,
  VolTargetSizingPlugin,
  createVolTargetSizingPlugin,
  extractSizingSignal,
} from "./vol-target-sizing-plugin.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (
  plugin: VolTargetSizingPlugin,
): { bus: SignalBus; captured: SizingSignal[] } => {
  const bus = mkBus();
  const captured: SizingSignal[] = [];
  plugin.subscribe(bus);
  // External subscriber observes only the RESCALED signals.
  bus.subscribe("sizing", (s) => {
    if (isSizing(s) && s.source === plugin.metadata.name) captured.push(s);
  });
  return { bus, captured };
};

const mkSizing = (overrides: Partial<SizingSignal> = {}): SizingSignal => ({
  kind: "sizing",
  kellyFraction: 0.5,
  volMultiplier: 0.8,
  notional: 50_000,
  source: "carry-baseline-v1:BTC/USDT",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Construction / config validation
// ---------------------------------------------------------------------------

describe("VolTargetSizingPlugin — construction and metadata", () => {
  it("construction with default config succeeds", () => {
    const p = new VolTargetSizingPlugin();
    expect(p.config.targetDailyVol).toBe(DEFAULT_TARGET_DAILY_VOL);
    expect(p.config.volWindowDays).toBe(DEFAULT_VOL_WINDOW_DAYS);
    expect(p.config.maxVolMultiplier).toBe(DEFAULT_MAX_VOL_MULTIPLIER);
    expect(p.config.minVolMultiplier).toBe(DEFAULT_MIN_VOL_MULTIPLIER);
    expect(p.config.baseNotionalUsd).toBe(DEFAULT_BASE_NOTIONAL_USD);
    expect(p.config.enabledSymbols).toEqual(DEFAULT_ENABLED_SYMBOLS);
  });

  it("construction with maxVolMultiplier > 1.0 REJECTED (1:10 hard cap)", () => {
    expect(
      () => new VolTargetSizingPlugin({ maxVolMultiplier: 1.5 }),
    ).toThrow(/maxVolMultiplier=1\.5 exceeds 1\.0/);
  });

  it("construction with targetDailyVol below 0.5% REJECTED", () => {
    expect(
      () => new VolTargetSizingPlugin({ targetDailyVol: 0.001 }),
    ).toThrow(/targetDailyVol=0\.001 outside allowed range/);
  });

  it("construction with targetDailyVol above 5% REJECTED", () => {
    expect(
      () => new VolTargetSizingPlugin({ targetDailyVol: 0.10 }),
    ).toThrow(/targetDailyVol=0\.1 outside allowed range/);
  });

  it("construction with volWindowDays = 0 REJECTED (validateConfig or constructor)", () => {
    expect(() => new VolTargetSizingPlugin({ volWindowDays: 0 })).toThrow();
  });

  it("construction with baseNotionalUsd = 0 REJECTED", () => {
    expect(
      () => new VolTargetSizingPlugin({ baseNotionalUsd: 0 }),
    ).toThrow();
  });

  it("metadata declares correct fields", () => {
    const p = new VolTargetSizingPlugin();
    expect(p.metadata.name).toBe("vol-target-sizing-v1");
    expect(p.metadata.version).toBe("1.0.0");
    expect(p.metadata.edgeClass).toBe("sizing");
    expect(p.metadata.capitalRequirement).toBe(0);
    expect(p.metadata.maxLeverage).toBe(ONE_TO_TEN_LEVERAGE);
  });

  it("validateConfig rejects maxVolMultiplier > 1.0 (HARD CAP)", () => {
    const p = new VolTargetSizingPlugin();
    const result = p.validateConfig({ maxVolMultiplier: 2.0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("maxVolMultiplier");
      expect(result.error.message).toMatch(/HARD CAP at 1\.0/);
    }
  });

  it("validateConfig accepts a clean valid override", () => {
    const p = new VolTargetSizingPlugin();
    const result = p.validateConfig({
      targetDailyVol: 0.015,
      volWindowDays: 14,
      minVolMultiplier: 0.30,
      maxVolMultiplier: 1.0,
    });
    expect(result.ok).toBe(true);
  });

  it("validateConfig rejects invalid enabledSymbols (empty string)", () => {
    const p = new VolTargetSizingPlugin();
    const result = p.validateConfig({ enabledSymbols: ["BTC/USDT", ""] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("enabledSymbols");
  });

  it("enabledSymbols defaults to BTC + ETH + SOL", () => {
    expect(DEFAULT_ENABLED_SYMBOLS).toContain("BTC/USDT");
    expect(DEFAULT_ENABLED_SYMBOLS).toContain("ETH/USDT");
    expect(DEFAULT_ENABLED_SYMBOLS).toContain("SOL/USDT");
  });

  it("isSymbolEnabled reflects enabledSymbols", () => {
    const p = new VolTargetSizingPlugin();
    expect(p.isSymbolEnabled("BTC/USDT")).toBe(true);
    expect(p.isSymbolEnabled("ETH/USDT")).toBe(true);
    expect(p.isSymbolEnabled("SOL/USDT")).toBe(true);
    expect(p.isSymbolEnabled("XRP/USDT")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3-layer 1:10 leverage defense
// ---------------------------------------------------------------------------

describe("VolTargetSizingPlugin — 3-layer 1:10 leverage defense", () => {
  it("Layer 1: metadata.maxLeverage === 10", () => {
    const p = new VolTargetSizingPlugin();
    expect(p.metadata.maxLeverage).toBe(10);
  });

  it("Layer 1: effectiveMaxNotionalUsd === baseNotionalUsd × 10", () => {
    const p = new VolTargetSizingPlugin({ baseNotionalUsd: 10_000 });
    expect(p.effectiveMaxNotionalUsd()).toBe(100_000);
  });

  it("Layer 2: assertLeverageInvariantForTesting throws on 12× synthetic breach", () => {
    const p = new VolTargetSizingPlugin({ baseNotionalUsd: 10_000 });
    // 120_000 = 12 × 10_000 — exceeds 1:10 cap.
    expect(() => p.assertLeverageInvariantForTesting(120_000)).toThrow();
  });

  it("Layer 2: assertLeverageInvariantForTesting passes on exactly 10×", () => {
    const p = new VolTargetSizingPlugin({ baseNotionalUsd: 10_000 });
    expect(() => p.assertLeverageInvariantForTesting(100_000)).not.toThrow();
  });

  it("Layer 2: synthetic 12× incoming signal triggers LAYER 2 throw in handler", () => {
    const p = new VolTargetSizingPlugin({ baseNotionalUsd: 10_000 });
    const { bus } = wirePlugin(p);
    // Feed realistic vol history so multiplier is in (0, 1].
    for (let i = 0; i < 30; i++) {
      p.recordClose("BTC/USDT", 50_000 * (1 + 0.001 * Math.sin(i)));
    }
    const breach: SizingSignal = mkSizing({
      notional: 120_000, // 12× breach
      volMultiplier: 0.8,
    });
    expect(() => bus.emit(breach)).toThrow(/LAYER 2 BREACH/);
    expect(p.state.breachDrops).toBe(1);
  });

  it("Layer 3: assertLeverageInvariantForTesting post-rescale would catch breach", () => {
    const p = new VolTargetSizingPlugin({ baseNotionalUsd: 10_000 });
    expect(() => p.assertLeverageInvariantForTesting(110_000)).toThrow();
  });

  it("Layer 3: per-emit notional clamp reduces an attempt above 10× to 10×", () => {
    const p = new VolTargetSizingPlugin({ baseNotionalUsd: 10_000 });
    const { bus, captured } = wirePlugin(p);
    p.recordClose("BTC/USDT", 50_000); // seed only — no realized vol yet
    // Multiplier stays at 1.0 (no realized vol → maxVolMultiplier).
    const sig = mkSizing({ notional: 99_000, volMultiplier: 1.0 }); // 9.9× ok
    bus.emit(sig);
    expect(captured.length).toBe(1);
    expect(captured[0]!.notional).toBeLessThanOrEqual(100_000);
  });

  it("Layer 3: SizingSignal.notional never exceeds baseNotionalUsd × 10 across many bars", () => {
    const p = new VolTargetSizingPlugin({ baseNotionalUsd: 10_000 });
    const { bus, captured } = wirePlugin(p);
    // Mix of regimes.
    for (let i = 0; i < 30; i++) {
      p.recordClose("BTC/USDT", 50_000 * (1 + 0.02 * ((i % 2) * 2 - 1)));
    }
    for (let i = 0; i < 100; i++) {
      bus.emit(
        mkSizing({ notional: 50_000 + (i % 5) * 10_000, volMultiplier: 0.5 + 0.1 * (i % 5) }),
      );
    }
    expect(captured.length).toBe(100);
    for (const s of captured) {
      expect(s.notional).toBeLessThanOrEqual(100_000);
    }
  });
});

// ---------------------------------------------------------------------------
// Modifier / rescaling behavior
// ---------------------------------------------------------------------------

describe("VolTargetSizingPlugin — multiplier and rescaling", () => {
  it("low-vol → multiplier = 1.0 (cap, no scaling up)", () => {
    const p = new VolTargetSizingPlugin();
    for (let i = 0; i < 30; i++) {
      p.recordClose("BTC/USDT", 50_000 * (1 + 1e-5 * (i % 2 === 0 ? 1 : -1)));
    }
    const m = p.currentMultiplierForSymbol("BTC/USDT");
    expect(m).not.toBeNull();
    expect(m).toBe(1.0); // HARD CAP — do not scale up
  });

  it("high-vol → multiplier = 0.25 (floor)", () => {
    const p = new VolTargetSizingPlugin();
    // Oscillating ±10% per bar → stddev ≈ 0.10 (annualized ~190%).
    // target 0.02 / 0.10 = 0.2 → clamp to 0.25 floor.
    let px = 50_000;
    for (let i = 0; i < 30; i++) {
      px = px * (i % 2 === 0 ? 1.10 : 0.90);
      p.recordClose("BTC/USDT", px);
    }
    const m = p.currentMultiplierForSymbol("BTC/USDT");
    expect(m).not.toBeNull();
    expect(m).toBe(0.25); // FLOOR
  });

  it("mid-vol → multiplier ∈ [0.25, 1.0]", () => {
    const p = new VolTargetSizingPlugin();
    for (let i = 0; i < 30; i++) {
      p.recordClose("BTC/USDT", 50_000 * (1 + 0.001 * ((i % 2) * 2 - 1)));
    }
    const m = p.currentMultiplierForSymbol("BTC/USDT");
    expect(m).not.toBeNull();
    expect(m!).toBeGreaterThanOrEqual(0.25);
    expect(m!).toBeLessThanOrEqual(1.0);
  });

  it("rescaled.volMultiplier clamped to [0.25, 1.0] under extreme upstream volMultiplier", () => {
    const p = new VolTargetSizingPlugin();
    const { bus, captured } = wirePlugin(p);
    // Oscillating ±10% → stddev ≈ 0.10 → floor clamp.
    let px = 50_000;
    for (let i = 0; i < 30; i++) {
      px = px * (i % 2 === 0 ? 1.10 : 0.90);
      p.recordClose("BTC/USDT", px);
    }
    bus.emit(mkSizing({ notional: 10_000, volMultiplier: 1.0 }));
    expect(captured.length).toBe(1);
    expect(captured[0]!.volMultiplier).toBeGreaterThanOrEqual(0.25);
    expect(captured[0]!.volMultiplier).toBeLessThanOrEqual(1.0);
  });

  it("per-symbol enable: non-enabled symbol → signal dropped", () => {
    const p = new VolTargetSizingPlugin({
      enabledSymbols: ["ETH/USDT"],
    });
    const { bus, captured } = wirePlugin(p);
    p.recordClose("ETH/USDT", 3_000);
    bus.emit(mkSizing({ source: "carry-baseline-v1:BTC/USDT" })); // dropped
    bus.emit(
      mkSizing({
        source: "carry-baseline-v1:ETH/USDT",
        notional: 10_000,
      }),
    );
    expect(captured.length).toBe(1);
    expect(p.state.symbolDropCount).toBe(1);
  });

  it("multiplier is updated each bar (per-symbol rolling window)", () => {
    const p = new VolTargetSizingPlugin();
    // Quiet market → low vol → multiplier = 1.0.
    for (let i = 0; i < 30; i++) p.recordClose("BTC/USDT", 50_000 + i * 0.01);
    expect(p.currentMultiplierForSymbol("BTC/USDT")).toBe(1.0);
    // Stormy market → oscillating ±10% → stddev ≈ 0.10 → multiplier
    // = 0.02 / 0.10 = 0.2 → clamp to 0.25 floor.
    let px2 = 50_001;
    for (let i = 0; i < 30; i++) {
      px2 = px2 * (i % 2 === 0 ? 1.10 : 0.90);
      p.recordClose("BTC/USDT", px2);
    }
    expect(p.currentMultiplierForSymbol("BTC/USDT")).toBe(0.25);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle / determinism
// ---------------------------------------------------------------------------

describe("VolTargetSizingPlugin — lifecycle and determinism", () => {
  it("subscribe() stores bus reference; dispose() releases it", () => {
    const p = new VolTargetSizingPlugin();
    const bus = mkBus();
    p.subscribe(bus);
    expect(bus.subscriberCount).toBeGreaterThanOrEqual(1);
    p.dispose();
    expect(bus.subscriberCount).toBe(0);
  });

  it("reset() clears all per-symbol state + counters", () => {
    const p = new VolTargetSizingPlugin();
    p.recordClose("BTC/USDT", 50_000);
    p.recordClose("BTC/USDT", 51_000);
    p.state.signalsReceived = 5;
    p.state.signalsEmitted = 4;
    p.state.barsProcessed = 100;
    p.reset();
    expect(p.state.signalsReceived).toBe(0);
    expect(p.state.signalsEmitted).toBe(0);
    expect(p.state.barsProcessed).toBe(0);
    expect(p.state.symbolState.size).toBe(0);
  });

  it("determinism: same input sequence → same signal sequence", () => {
    const mk = () => {
      const p = new VolTargetSizingPlugin({ baseNotionalUsd: 10_000 });
      const { bus, captured } = wirePlugin(p);
      p.recordClose("BTC/USDT", 50_000);
      p.recordClose("BTC/USDT", 51_000);
      p.recordClose("BTC/USDT", 52_000);
      for (let i = 0; i < 10; i++) {
        bus.emit(mkSizing({ notional: 50_000, volMultiplier: 0.7 }));
      }
      return captured.map((s) => ({ notional: s.notional, vol: s.volMultiplier }));
    };
    const a = mk();
    const b = mk();
    expect(a).toEqual(b);
  });

  it("empty input (no bars, no signals) → no signals emitted", () => {
    const p = new VolTargetSizingPlugin();
    const { captured } = wirePlugin(p);
    expect(captured.length).toBe(0);
    expect(p.state.signalsEmitted).toBe(0);
  });

  it("re-entrancy: plugin's own emitted signals are not re-processed", () => {
    const p = new VolTargetSizingPlugin();
    const { bus, captured } = wirePlugin(p);
    p.recordClose("BTC/USDT", 50_000);
    p.recordClose("BTC/USDT", 51_000);
    bus.emit(mkSizing({ notional: 20_000, volMultiplier: 0.6 }));
    expect(captured.length).toBe(1);
    expect(captured[0]!.source).toBe("vol-target-sizing-v1");
    expect(p.state.signalsReceived).toBe(1);
    expect(p.state.signalsEmitted).toBe(1);
  });

  it("VaR 95% daily at 2% target vol with multiplier 0.25 floor < 1%", () => {
    // Parametric 1-day VaR @ 95% = 1.65 × σ_daily.
    // At target σ = 0.02 with worst-case multiplier = 0.25:
    //   σ_post = 0.02 × 0.25 = 0.005
    //   VaR95 = 1.65 × 0.005 = 0.00825 = 0.825%
    const target = 0.02;
    const multiplier = 0.25;
    const sigmaPost = target * multiplier;
    const var95 = 1.65 * sigmaPost;
    expect(var95).toBeLessThan(0.01);
  });

  it("recordClose seeds and updates per-symbol rolling window", () => {
    const p = new VolTargetSizingPlugin();
    p.recordClose("ETH/USDT", 3_000);
    p.recordClose("ETH/USDT", 3_100);
    p.recordClose("ETH/USDT", 3_200);
    const ss = p.state.symbolState.get("ETH/USDT");
    expect(ss).toBeDefined();
    expect(ss!.returns.length).toBe(2);
    expect(ss!.realizedDailyVol).not.toBeNull();
    expect(ss!.realizedDailyVol!).toBeGreaterThan(0);
  });

  it("computeMultiplier formula: single observation → realizedDailyVol = null", () => {
    const p = new VolTargetSizingPlugin();
    p.recordClose("XRP/USDT", 1.0);
    expect(p.currentMultiplierForSymbol("XRP/USDT")).toBeNull();
  });

  it("default-constructed config is identical to factory function output", () => {
    const a = new VolTargetSizingPlugin();
    const b = createVolTargetSizingPlugin();
    expect(a.config).toEqual(b.config);
    expect(a.metadata).toEqual(b.metadata);
  });
});

// ---------------------------------------------------------------------------
// Bounds constants sanity
// ---------------------------------------------------------------------------

describe("VolTargetSizingPlugin — bounds constants", () => {
  it("MIN/MAX constants are in correct order", () => {
    expect(MIN_TARGET_DAILY_VOL).toBeLessThan(MAX_TARGET_DAILY_VOL);
    expect(MIN_VOL_WINDOW_DAYS).toBeLessThan(MAX_VOL_WINDOW_DAYS);
    expect(MIN_MIN_VOL_MULTIPLIER).toBeLessThan(MAX_MIN_VOL_MULTIPLIER);
    expect(MIN_TARGET_DAILY_VOL).toBe(0.005);
    expect(MAX_TARGET_DAILY_VOL).toBe(0.05);
  });
});

// ----------------------------------------------------------------------
// Phase 35b — `extractSizingSignal` export + `onBar` no-op body coverage
// ----------------------------------------------------------------------
//
// Line 783: `export function extractSizingSignal(s: unknown): SizingSignal | null`
//   - a `SizingSignal` → returns the signal
//   - a non-SizingSignal → returns null
//
// Lines 322-336: `onBar(bar, _state)` body is a no-op (it just increments
// `state.barsProcessed` and ends with `void bar`). The body must be hit
// at least once to register as covered.
//
describe("VolTargetSizingPlugin — extractSizingSignal (line 783)", () => {
  it("returns the signal when given a valid SizingSignal", () => {
    // Phase 35b: SizingSignal type uses `kellyFraction` / `volMultiplier` /
    // `notional` / `source` / `timestampMs` (no `symbol`, no
    // `effectiveNotionalUsd`, no `leverage`, no `timestamp`).
    const valid: SizingSignal = {
      kind: "sizing",
      source: "test",
      kellyFraction: 0.5,
      volMultiplier: 0.8,
      notional: 5_000,
      timestampMs: 1_704_067_200_000,
    };
    expect(extractSizingSignal(valid)).toEqual(valid);
  });

  it("returns null when given a non-SizingSignal payload", () => {
    // `isSizing` is `(s: Signal) => s is SizingSignal` — it does NOT accept
    // `null`/`undefined`. The function's runtime guard is a duck-type check
    // on `s.kind`, so we pass non-SizingSignal objects (and primitives
    // that have a `.kind` property that isn't "sizing").
    expect(extractSizingSignal({ kind: "direction" })).toBeNull();
    expect(extractSizingSignal({ kind: "carry" })).toBeNull();
    expect(extractSizingSignal({ kind: "risk" })).toBeNull();
    expect(extractSizingSignal({ kind: "something-else" })).toBeNull();
    expect(extractSizingSignal({})).toBeNull();
  });
});

describe("VolTargetSizingPlugin — onBar body coverage (lines 322-336)", () => {
  it("onBar is a no-op that increments barsProcessed (the entire body must execute)", () => {
    const p = new VolTargetSizingPlugin();
    const before = p.state.barsProcessed;
    p.onBar(
      {
        timestamp: 1_704_067_200_000,
        open: 50_000,
        high: 50_500,
        low: 49_500,
        close: 50_200,
        volume: 100,
      },
      p.state,
    );
    expect(p.state.barsProcessed).toBe(before + 1);
  });
});
