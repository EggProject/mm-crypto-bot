// packages/core/src/signal-center/monolith-wrappers/multi-class-ensemble-v3-plugin.test.ts
// — Phase 13 Track A
//
// Test suite for MultiClassEnsembleV3Plugin — ≥5 tests covering:
//   - Plugin registration (registry accepts)
//   - onBar emits expected signal kind
//   - maxLeverage === 10 invariant
//   - subscribe/unsubscribe lifecycle
//   - reset() behavior
// Plus additional coverage for the 1:10 defense layers.

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import { StrategyRegistry } from "../strategy-registry.js";
import {
  MultiClassEnsembleV3Plugin,
  createMultiClassEnsembleV3Plugin,
  DEFAULT_MULTI_CLASS_ENSEMBLE_V3_PLUGIN_CONFIG,
} from "./multi-class-ensemble-v3-plugin.js";
import type { Bar } from "../types.js";

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (p: MultiClassEnsembleV3Plugin): SignalBus => {
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

describe("MultiClassEnsembleV3Plugin", () => {
  it("construction with default config succeeds", () => {
    const p = new MultiClassEnsembleV3Plugin();
    expect(p.config.leverage).toBe(10);
    expect(p.config.baseNotionalUsd).toBe(10_000);
    expect(p.effectiveLeverage()).toBe(10);
    expect(p.effectiveNotionalUsd()).toBe(100_000);
  });

  it("metadata declares maxLeverage=10 (1:10 HARD GUARDRAIL)", () => {
    const p = new MultiClassEnsembleV3Plugin();
    expect(p.metadata.maxLeverage).toBe(10);
    expect(p.metadata.name).toBe("multi-class-ensemble-v3-v1");
    expect(p.metadata.edgeClass).toBe("mixed");
  });

  it("registry accepts the plugin", () => {
    const registry = new StrategyRegistry();
    registry.register(new MultiClassEnsembleV3Plugin());
    expect(registry.size).toBe(1);
  });

  it("subscribe() stores bus reference + Layer 2 assertion fires", () => {
    const p = new MultiClassEnsembleV3Plugin();
    wirePlugin(p);
    expect(p.layer2AssertionCountForTest()).toBe(1);
  });

  it("onBar emits a DirectionSignal (flat by default with minimal context)", () => {
    const p = new MultiClassEnsembleV3Plugin();
    const bus = wirePlugin(p);
    const received: unknown[] = [];
    bus.subscribe("direction", (s) => received.push(s));
    p.onBar(mkBar(), null);
    expect(p.state.directionSignalCount).toBe(1);
    expect(received.length).toBe(1);
    const sig = received[0] as { kind: string; side: string; source: string };
    expect(sig.kind).toBe("direction");
    expect(sig.source).toBe("multi-class-ensemble-v3-v1");
  });

  it("multiple onBar calls increment directionSignalCount", () => {
    const p = new MultiClassEnsembleV3Plugin();
    wirePlugin(p);
    for (let i = 0; i < 5; i++) {
      p.onBar(mkBar(50_000 + i), null);
    }
    expect(p.state.directionSignalCount).toBe(5);
    expect(p.barCountForTest()).toBe(5);
  });

  it("reset() clears all state", () => {
    const p = new MultiClassEnsembleV3Plugin();
    wirePlugin(p);
    for (let i = 0; i < 3; i++) p.onBar(mkBar(), null);
    expect(p.state.directionSignalCount).toBe(3);
    p.reset();
    expect(p.state.directionSignalCount).toBe(0);
    expect(p.barCountForTest()).toBe(0);
    expect(p.state.lastDirectionSignal).toBeNull();
  });

  it("dispose() releases bus reference", () => {
    const p = new MultiClassEnsembleV3Plugin();
    wirePlugin(p);
    p.dispose();
    p.onBar(mkBar(), null);
    expect(p.state.directionSignalCount).toBe(0);
  });

  it("construction rejects leverage ∉ {1, 10}", () => {
    expect(() => new MultiClassEnsembleV3Plugin({ leverage: 5 as 1 | 10 })).toThrow(/1:10 HARD GUARDRAIL/);
    expect(() => new MultiClassEnsembleV3Plugin({ leverage: 0 as 1 | 10 })).toThrow(/1:10 HARD GUARDRAIL/);
  });

  it("construction rejects non-positive baseNotionalUsd", () => {
    expect(() => new MultiClassEnsembleV3Plugin({ baseNotionalUsd: 0 })).toThrow(/baseNotionalUsd/);
    expect(() => new MultiClassEnsembleV3Plugin({ baseNotionalUsd: -1 })).toThrow(/baseNotionalUsd/);
  });

  it("validateConfig returns ok for undefined / null", () => {
    const p = new MultiClassEnsembleV3Plugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    expect(p.validateConfig(null).ok).toBe(true);
  });

  it("validateConfig rejects invalid leverage", () => {
    const p = new MultiClassEnsembleV3Plugin();
    const r = p.validateConfig({ leverage: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("leverage");
  });

  it("validateConfig rejects non-object input", () => {
    const p = new MultiClassEnsembleV3Plugin();
    const r = p.validateConfig("not an object");
    expect(r.ok).toBe(false);
  });

  it("validateConfig rejects non-positive baseNotionalUsd", () => {
    const p = new MultiClassEnsembleV3Plugin();
    const r = p.validateConfig({ baseNotionalUsd: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("baseNotionalUsd");
  });

  it("effectiveMaxNotionalUsd is baseNotional × 10", () => {
    expect(new MultiClassEnsembleV3Plugin({ baseNotionalUsd: 5_000 }).effectiveMaxNotionalUsd()).toBe(50_000);
    expect(new MultiClassEnsembleV3Plugin().effectiveMaxNotionalUsd()).toBe(100_000);
  });

  it("createMultiClassEnsembleV3Plugin factory works", () => {
    const p = createMultiClassEnsembleV3Plugin();
    expect(p).toBeInstanceOf(MultiClassEnsembleV3Plugin);
  });

  it("DEFAULT_MULTI_CLASS_ENSEMBLE_V3_PLUGIN_CONFIG has expected invariants", () => {
    expect(DEFAULT_MULTI_CLASS_ENSEMBLE_V3_PLUGIN_CONFIG.leverage).toBe(10);
    expect(DEFAULT_MULTI_CLASS_ENSEMBLE_V3_PLUGIN_CONFIG.baseNotionalUsd).toBe(10_000);
  });

  it("emitSizingForTest triggers Layer 3 sizing path", () => {
    const p = new MultiClassEnsembleV3Plugin();
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
    const p = new MultiClassEnsembleV3Plugin();
    wirePlugin(p);
    p.emitSizingForTest(0, 1_700_000_000_000);
    expect(p.state.sizingSignalCount).toBe(1);
    expect(p.state.lastSizingSignal?.kellyFraction).toBe(0);
  });

  it("emitSizingForTest with strength >1 clamps to 1.0", () => {
    const p = new MultiClassEnsembleV3Plugin();
    wirePlugin(p);
    p.emitSizingForTest(2.5, 1_700_000_000_000);
    expect(p.state.lastSizingSignal?.kellyFraction).toBe(1.0);
  });

  it("lastUnderlyingSignal is null when underlying returns null", () => {
    const p = new MultiClassEnsembleV3Plugin();
    wirePlugin(p);
    p.onBar(mkBar(), null);
    expect(p.state.lastUnderlyingSignal).toBeNull();
    expect(p.state.lastDirectionSignal).not.toBeNull();
  });

  it("subscribe → onBar → dispose cycle works", () => {
    const p = new MultiClassEnsembleV3Plugin();
    const bus = wirePlugin(p);
    const received: unknown[] = [];
    bus.subscribe("direction", (s) => received.push(s));
    for (let i = 0; i < 3; i++) p.onBar(mkBar(), null);
    p.dispose();
    expect(received.length).toBe(3);
    p.onBar(mkBar(), null);
    expect(received.length).toBe(3);
  });

  it("leverage=1 (baseline) accepted", () => {
    const p = new MultiClassEnsembleV3Plugin({ leverage: 1 });
    expect(p.effectiveLeverage()).toBe(1);
    expect(p.effectiveNotionalUsd()).toBe(10_000);
    wirePlugin(p);
    p.onBar(mkBar(), null);
    expect(p.state.directionSignalCount).toBe(1);
  });
});
