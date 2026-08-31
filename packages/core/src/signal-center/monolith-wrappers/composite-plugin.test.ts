// packages/core/src/signal-center/monolith-wrappers/composite-plugin.test.ts
// — Phase 13 Track A
//
// Test suite for CompositePlugin — ≥5 tests covering:
//   - Plugin registration (registry accepts)
//   - onBar emits expected signal kind
//   - maxAggregateEffectiveLeverage === 10 invariant
//   - subscribe/unsubscribe lifecycle
//   - reset() behavior
// Plus additional coverage for the aggregate effective-exposure defense layers.

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import { StrategyRegistry } from "../strategy-registry.js";
import {
  CompositePlugin,
  createCompositePlugin,
  DEFAULT_COMPOSITE_PLUGIN_CONFIG,
} from "./composite-plugin.js";
import type { Bar } from "../types.js";
import type { Strategy } from "../../types.js";
import type { Timeframe } from "@mm-crypto-bot/shared/types";

const TEST_TIMEFRAME: Timeframe = "1h";

const makeComponent = (name: string): Strategy & { reset(): void } => ({
  name,
  timeframes: ["1h"],
  warmup: () => 0,
  onCandle: () => {
    return;
  },
  reset: () => {
    void 0;
  },
});

const validConfig = () => ({
  symbol: "BTC/USDT",
  timeframe: TEST_TIMEFRAME,
  strategy: {
    component1: makeComponent("trend"),
    component2: makeComponent("entry"),
  },
});

const mkPlugin = (overrides: ConstructorParameters<typeof CompositePlugin>[0] = {}): CompositePlugin =>
  new CompositePlugin({ ...validConfig(), ...overrides });

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (p: CompositePlugin): SignalBus => {
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

describe("CompositePlugin", () => {
  it("fails loud when components or instrument context are missing", () => {
    expect(() => new CompositePlugin()).toThrow(/component1.*component2/);
    expect(() => new CompositePlugin({ strategy: validConfig().strategy })).toThrow(/symbol is required/);
  });

  it("fails loud at construction when either component lacks reset()", () => {
    const noReset: Strategy = {
      name: "stateful-without-reset",
      timeframes: ["1h"],
      warmup: () => 0,
      onCandle: () => {
        return;
      },
    };
    expect(() =>
      mkPlugin({
        strategy: { component1: noReset, component2: makeComponent("entry") },
      }),
    ).toThrow(/lacks reset.*fresh-run lifecycle/);
  });

  it("construction with default config succeeds", () => {
    const p = mkPlugin();
    expect(p.config.leverage).toBe(10);
    expect(p.config.baseNotionalUsd).toBe(10_000);
    expect(p.effectiveLeverage()).toBe(10);
    expect(p.effectiveNotionalUsd()).toBe(100_000);
  });

  it("metadata declares maxAggregateEffectiveLeverage=10 (aggregate effective-exposure hard guardrail)", () => {
    const p = mkPlugin();
    expect(p.metadata.maxAggregateEffectiveLeverage).toBe(10);
    expect(p.metadata.name).toBe("composite-v1");
    expect(p.metadata.edgeClass).toBe("mixed");
  });

  it("registry accepts the plugin", () => {
    const registry = new StrategyRegistry();
    registry.register(mkPlugin());
    expect(registry.size).toBe(1);
  });

  it("subscribe() stores bus reference + Layer 2 assertion fires", () => {
    const p = mkPlugin();
    wirePlugin(p);
    expect(p.layer2AssertionCountForTest()).toBe(1);
  });

  it("onBar emits a DirectionSignal (flat by default with minimal context)", () => {
    const p = mkPlugin();
    const bus = wirePlugin(p);
    const received: unknown[] = [];
    bus.subscribe("direction", (signal) => {
      received.push(signal);
    });
    p.onBar(mkBar(), undefined);
    expect(p.state.directionSignalCount).toBe(1);
    expect(received.length).toBe(1);
    expect(received[0]).toMatchObject({ kind: "direction" });
    expect(received[0]).toMatchObject({ source: "composite-v1" });
  });

  it("multiple onBar calls increment directionSignalCount", () => {
    const p = mkPlugin();
    wirePlugin(p);
    for (let index = 0; index < 5; index++) {
      p.onBar(mkBar(50_000 + index), undefined);
    }
    expect(p.state.directionSignalCount).toBe(5);
    expect(p.barCountForTest()).toBe(5);
  });

  it("reset() clears all state", () => {
    const p = mkPlugin();
    wirePlugin(p);
    for (let index = 0; index < 3; index++) p.onBar(mkBar(), undefined);
    expect(p.state.directionSignalCount).toBe(3);
    p.reset();
    expect(p.state.directionSignalCount).toBe(0);
    expect(p.barCountForTest()).toBe(0);
    expect(p.state.lastDirectionSignal).toBeUndefined();
  });

  it("dispose() releases bus reference", () => {
    const p = mkPlugin();
    wirePlugin(p);
    p.dispose();
    p.onBar(mkBar(), undefined);
    expect(p.state.directionSignalCount).toBe(0);
  });

  it("construction rejects leverage ∉ {1, 10}", () => {
    expect(() => mkPlugin({ leverage: 5 })).toThrow(/aggregate effective-exposure hard guardrail/);
    expect(() => mkPlugin({ leverage: 0 })).toThrow(/aggregate effective-exposure hard guardrail/);
  });

  it("construction rejects non-positive baseNotionalUsd", () => {
    expect(() => mkPlugin({ baseNotionalUsd: 0 })).toThrow(/baseNotionalUsd/);
    expect(() => mkPlugin({ baseNotionalUsd: -1 })).toThrow(/baseNotionalUsd/);
  });

  it("validateConfig returns ok for undefined / null", () => {
    const p = mkPlugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    expect(p.validateConfig(new URLSearchParams().get("missing")).ok).toBe(true);
  });

  it("validateConfig rejects invalid leverage", () => {
    const p = mkPlugin();
    const r = p.validateConfig({ leverage: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("leverage");
  });

  it("validateConfig rejects non-object input", () => {
    const p = mkPlugin();
    const r = p.validateConfig("not an object");
    expect(r.ok).toBe(false);
  });

  it("validateConfig rejects non-positive baseNotionalUsd", () => {
    const p = mkPlugin();
    const r = p.validateConfig({ baseNotionalUsd: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("baseNotionalUsd");
  });

  it("effectiveMaxNotionalUsd is baseNotional × 10", () => {
    expect(mkPlugin({ baseNotionalUsd: 5000 }).effectiveMaxNotionalUsd()).toBe(50_000);
    expect(mkPlugin().effectiveMaxNotionalUsd()).toBe(100_000);
  });

  it("createCompositePlugin factory works", () => {
    const p = createCompositePlugin(validConfig());
    expect(p).toBeInstanceOf(CompositePlugin);
  });

  it("DEFAULT_COMPOSITE_PLUGIN_CONFIG has expected invariants", () => {
    expect(DEFAULT_COMPOSITE_PLUGIN_CONFIG.leverage).toBe(10);
    expect(DEFAULT_COMPOSITE_PLUGIN_CONFIG.baseNotionalUsd).toBe(10_000);
  });

  it("emitSizingForTest triggers Layer 3 sizing path", () => {
    const p = mkPlugin();
    const bus = wirePlugin(p);
    const sizingReceived: unknown[] = [];
    bus.subscribe("sizing", (signal) => {
      sizingReceived.push(signal);
    });
    p.emitSizingForTest(1, 1_700_000_000_000);
    expect(sizingReceived.length).toBe(1);
    expect(p.state.sizingSignalCount).toBe(1);
    expect(p.layer3AssertionCountForTest()).toBeGreaterThanOrEqual(1);
    expect(sizingReceived[0]).toMatchObject({ notional: p.effectiveMaxNotionalUsd() });
    expect(sizingReceived[0]).toMatchObject({ kellyFraction: 1 });
  });

  it("emitSizingForTest with strength=0 emits kellyFraction=0", () => {
    const p = mkPlugin();
    wirePlugin(p);
    p.emitSizingForTest(0, 1_700_000_000_000);
    expect(p.state.sizingSignalCount).toBe(1);
    expect(p.state.lastSizingSignal?.kellyFraction).toBe(0);
  });

  it("emitSizingForTest with strength >1 clamps to 1.0", () => {
    const p = mkPlugin();
    wirePlugin(p);
    p.emitSizingForTest(2.5, 1_700_000_000_000);
    expect(p.state.lastSizingSignal?.kellyFraction).toBe(1);
  });

  it("lastUnderlyingSignal is null when underlying returns null", () => {
    const p = mkPlugin();
    wirePlugin(p);
    p.onBar(mkBar(), undefined);
    expect(p.state.lastUnderlyingSignal).toBeUndefined();
    expect(p.state.lastDirectionSignal).not.toBeUndefined();
  });

  it("subscribe → onBar → dispose cycle works", () => {
    const p = mkPlugin();
    const bus = wirePlugin(p);
    const received: unknown[] = [];
    bus.subscribe("direction", (signal) => {
      received.push(signal);
    });
    for (let index = 0; index < 3; index++) p.onBar(mkBar(), undefined);
    p.dispose();
    expect(received.length).toBe(3);
    p.onBar(mkBar(), undefined);
    expect(received.length).toBe(3);
  });

  it("leverage=1 (baseline) accepted", () => {
    const p = mkPlugin({ leverage: 1 });
    expect(p.effectiveLeverage()).toBe(1);
    expect(p.effectiveNotionalUsd()).toBe(10_000);
    wirePlugin(p);
    p.onBar(mkBar(), undefined);
    expect(p.state.directionSignalCount).toBe(1);
  });
});
