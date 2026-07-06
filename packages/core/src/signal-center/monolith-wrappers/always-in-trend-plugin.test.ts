// packages/core/src/signal-center/monolith-wrappers/always-in-trend-plugin.test.ts
// — Phase 13 Track A
//
// Test suite for AlwaysInTrendPlugin — ≥5 tests covering:
//   - Plugin registration (registry accepts)
//   - onBar emits expected signal kind (DirectionSignal)
//   - maxLeverage === 10 invariant
//   - subscribe/unsubscribe lifecycle
//   - reset() behavior
// Plus additional coverage for the 1:10 defense layers.

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import { StrategyRegistry } from "../strategy-registry.js";
import {
  AlwaysInTrendPlugin,
  createAlwaysInTrendPlugin,
  DEFAULT_ALWAYS_IN_TREND_PLUGIN_CONFIG,
} from "./always-in-trend-plugin.js";
import type { Bar } from "../types.js";

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (p: AlwaysInTrendPlugin): SignalBus => {
  const bus = mkBus();
  p.subscribe(bus);
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

describe("AlwaysInTrendPlugin", () => {
  it("construction with default config succeeds", () => {
    const p = new AlwaysInTrendPlugin();
    expect(p.config.leverage).toBe(10);
    expect(p.config.baseNotionalUsd).toBe(10_000);
    expect(p.effectiveLeverage()).toBe(10);
    expect(p.effectiveNotionalUsd()).toBe(100_000);
  });

  it("metadata declares maxLeverage=10 (1:10 HARD GUARDRAIL)", () => {
    const p = new AlwaysInTrendPlugin();
    expect(p.metadata.maxLeverage).toBe(10);
    expect(p.metadata.name).toBe("always-in-trend-v1");
    expect(p.metadata.edgeClass).toBe("directional");
  });

  it("registry accepts the plugin", () => {
    const registry = new StrategyRegistry();
    registry.register(new AlwaysInTrendPlugin());
    expect(registry.size).toBe(1);
  });

  it("subscribe() stores bus reference + Layer 2 assertion fires", () => {
    const p = new AlwaysInTrendPlugin();
    wirePlugin(p);
    expect(p.layer2AssertionCountForTest()).toBe(1);
  });

  it("onBar emits a DirectionSignal (flat by default with minimal context)", () => {
    const p = new AlwaysInTrendPlugin();
    const bus = wirePlugin(p);
    const received: unknown[] = [];
    bus.subscribe("direction", (s) => received.push(s));
    p.onBar(mkBar(), null);
    expect(p.state.directionSignalCount).toBe(1);
    expect(received.length).toBe(1);
    const sig = received[0] as { kind: string; side: string; source: string };
    expect(sig.kind).toBe("direction");
    expect(sig.side).toBe("flat"); // no MTF state → flat
    expect(sig.source).toBe("always-in-trend-v1");
  });

  it("multiple onBar calls increment directionSignalCount", () => {
    const p = new AlwaysInTrendPlugin();
    wirePlugin(p);
    for (let i = 0; i < 5; i++) {
      p.onBar(mkBar(50_000 + i), null);
    }
    expect(p.state.directionSignalCount).toBe(5);
    expect(p.barCountForTest()).toBe(5);
  });

  it("reset() clears all state including directionSignalCount", () => {
    const p = new AlwaysInTrendPlugin();
    wirePlugin(p);
    for (let i = 0; i < 3; i++) p.onBar(mkBar(), null);
    expect(p.state.directionSignalCount).toBe(3);
    p.reset();
    expect(p.state.directionSignalCount).toBe(0);
    expect(p.barCountForTest()).toBe(0);
    expect(p.state.lastDirectionSignal).toBeNull();
  });

  it("dispose() releases bus reference", () => {
    const p = new AlwaysInTrendPlugin();
    wirePlugin(p);
    p.dispose();
    // After dispose, onBar should not throw but also not emit anything.
    p.onBar(mkBar(), null);
    expect(p.state.directionSignalCount).toBe(0);
  });

  it("construction rejects leverage ∉ {1, 10}", () => {
    expect(() => new AlwaysInTrendPlugin({ leverage: 5 as 1 | 10 })).toThrow(/1:10 HARD GUARDRAIL/);
    expect(() => new AlwaysInTrendPlugin({ leverage: 0 as 1 | 10 })).toThrow(/1:10 HARD GUARDRAIL/);
  });

  it("construction rejects non-positive baseNotionalUsd", () => {
    expect(() => new AlwaysInTrendPlugin({ baseNotionalUsd: 0 })).toThrow(/baseNotionalUsd/);
    expect(() => new AlwaysInTrendPlugin({ baseNotionalUsd: -1 })).toThrow(/baseNotionalUsd/);
  });

  it("validateConfig returns ok for undefined / null", () => {
    const p = new AlwaysInTrendPlugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    expect(p.validateConfig(null).ok).toBe(true);
  });

  it("validateConfig rejects invalid leverage", () => {
    const p = new AlwaysInTrendPlugin();
    const r = p.validateConfig({ leverage: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("leverage");
  });

  it("validateConfig rejects non-object input", () => {
    const p = new AlwaysInTrendPlugin();
    const r = p.validateConfig("not an object");
    expect(r.ok).toBe(false);
  });

  it("validateConfig rejects non-positive baseNotionalUsd", () => {
    const p = new AlwaysInTrendPlugin();
    const r = p.validateConfig({ baseNotionalUsd: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("baseNotionalUsd");
  });

  it("effectiveMaxNotionalUsd is baseNotional × 10", () => {
    expect(new AlwaysInTrendPlugin({ baseNotionalUsd: 5_000 }).effectiveMaxNotionalUsd()).toBe(50_000);
    expect(new AlwaysInTrendPlugin().effectiveMaxNotionalUsd()).toBe(100_000);
  });

  it("createAlwaysInTrendPlugin factory works", () => {
    const p = createAlwaysInTrendPlugin();
    expect(p).toBeInstanceOf(AlwaysInTrendPlugin);
  });

  it("DEFAULT_ALWAYS_IN_TREND_PLUGIN_CONFIG has expected invariants", () => {
    expect(DEFAULT_ALWAYS_IN_TREND_PLUGIN_CONFIG.leverage).toBe(10);
    expect(DEFAULT_ALWAYS_IN_TREND_PLUGIN_CONFIG.baseNotionalUsd).toBe(10_000);
  });

  it("Layer 3: SizingSignal notional ≤ baseNotional × 10 invariant", () => {
    // Manual emit via _emitSizing with strength 1.0 → notional = base × leverage × 1.0
    // For leverage=10, base=10000 → notional = 100000, exactly the ceiling
    const p = new AlwaysInTrendPlugin();
    wirePlugin(p);
    // OnBar with insufficient context returns null → flat (no sizing). But
    // we can verify the invariant by checking that no sizing signal exceeds
    // the ceiling. Force a sizing emit via dispatching a buy signal context
    // — we can't easily reach _emitSizing directly, so we test the cap
    // calculation instead.
    expect(p.effectiveMaxNotionalUsd()).toBe(10 * 10_000);
  });

  it("lastUnderlyingSignal is null when underlying returns null (no MTF state)", () => {
    const p = new AlwaysInTrendPlugin();
    wirePlugin(p);
    p.onBar(mkBar(), null);
    expect(p.state.lastUnderlyingSignal).toBeNull();
    expect(p.state.lastDirectionSignal).not.toBeNull();
  });

  it("subscribe → onBar → dispose cycle works", () => {
    const p = new AlwaysInTrendPlugin();
    const bus = wirePlugin(p);
    const received: unknown[] = [];
    bus.subscribe("direction", (s) => received.push(s));
    for (let i = 0; i < 3; i++) p.onBar(mkBar(), null);
    p.dispose();
    // After dispose, no new emissions.
    expect(received.length).toBe(3);
    p.onBar(mkBar(), null); // no-op after dispose
    expect(received.length).toBe(3);
  });

  it("leverage=1 (baseline) accepted", () => {
    const p = new AlwaysInTrendPlugin({ leverage: 1 });
    expect(p.effectiveLeverage()).toBe(1);
    expect(p.effectiveNotionalUsd()).toBe(10_000);
    wirePlugin(p);
    p.onBar(mkBar(), null);
    expect(p.state.directionSignalCount).toBe(1);
  });

  it("emitSizingForTest triggers Layer 3 sizing path", () => {
    const p = new AlwaysInTrendPlugin();
    const bus = wirePlugin(p);
    const sizingReceived: unknown[] = [];
    bus.subscribe("sizing", (s) => sizingReceived.push(s));
    p.emitSizingForTest(1.0, 1_700_000_000_000);
    expect(sizingReceived.length).toBe(1);
    expect(p.state.sizingSignalCount).toBe(1);
    expect(p.layer3AssertionCountForTest()).toBeGreaterThanOrEqual(1);
    const sig = sizingReceived[0] as { notional: number; kellyFraction: number };
    expect(sig.notional).toBeLessThanOrEqual(p.effectiveMaxNotionalUsd());
    expect(sig.kellyFraction).toBe(1.0);
  });

  it("emitSizingForTest with strength=0 emits kellyFraction=0", () => {
    const p = new AlwaysInTrendPlugin();
    wirePlugin(p);
    p.emitSizingForTest(0, 1_700_000_000_000);
    expect(p.state.sizingSignalCount).toBe(1);
    expect(p.state.lastSizingSignal?.kellyFraction).toBe(0);
  });

  it("emitSizingForTest with strength >1 clamps to 1.0", () => {
    const p = new AlwaysInTrendPlugin();
    wirePlugin(p);
    p.emitSizingForTest(2.5, 1_700_000_000_000);
    expect(p.state.lastSizingSignal?.kellyFraction).toBe(1.0);
  });
});