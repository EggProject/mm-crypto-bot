// packages/core/src/signal-center/strategy-registry.test.ts — Phase 10G Track A
//
// Test coverage (≥10) for StrategyRegistry:
//
//   1.  Register + get + list (basic lifecycle)
//   2.  Duplicate name rejected
//   3.  Unregister existing plugin returns true
//   4.  Unregister non-existing plugin returns false
//   5.  Unregister calls plugin.dispose() (cleanup hook)
//   6.  Wire all plugins to bus (subscribe called on each)
//   7.  Validation: all valid configs → ok
//   8.  Validation: at least one invalid config → aggregated err
//   9.  Aggregated errors collect all failures (not first-fail)
//  10.  Plugin metadata validation: maxLeverage MUST be ≤ 10 (hard guard)
//  11.  Plugin metadata validation: invalid edgeClass rejected
//  12.  Plugin metadata validation: empty name rejected
//  13.  Plugin metadata validation: non-finite capitalRequirement rejected
//  14.  Plugin metadata validation: maxLeverage < 1 rejected
//  15.  Edge case: empty registry (wireAll, validateAll, onBarAll)
//  16.  onBarAll calls every plugin in order
//  17.  onBarAll swallows plugin exceptions (defensive isolation)
//  18.  resetAll calls plugin.reset() on every plugin

import { describe, expect, it } from "bun:test";

import { SignalBus } from "./signal-bus.js";
import {
  MAX_ALLOWED_PLUGIN_LEVERAGE,
  StrategyRegistry,
  createStrategyRegistry,
  validatePluginMetadata,
  type EdgeClass,
  type StrategyPlugin,
  type StrategyPluginMetadata,
} from "./strategy-registry.js";
import type { Bar, ConfigError, PluginState, Result } from "./types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mkMetadata = (overrides: Partial<StrategyPluginMetadata> = {}): StrategyPluginMetadata => ({
  name: "test-plugin",
  version: "1.0.0",
  edgeClass: "directional",
  capitalRequirement: 10_000,
  maxLeverage: 10,
  ...overrides,
});

const mkPlugin = (
  metadata: StrategyPluginMetadata,
  overrides: Partial<StrategyPlugin> = {},
): StrategyPlugin => {
  const counters = {
    subscribed: false,
    disposed: false,
    resetCount: 0,
    onBarCount: 0,
    validateResult: { ok: true, value: undefined } as Result<void, ConfigError>,
  };
  const plugin: StrategyPlugin & {
    readonly subscribed: boolean;
    readonly disposed: boolean;
    readonly resetCount: number;
    readonly onBarCount: number;
    setValidateResult(r: Result<void, ConfigError>): void;
  } = {
    metadata,
    subscribe(_bus: SignalBus): void {
      counters.subscribed = true;
    },
    onBar(_bar: Bar, _state: PluginState): void {
      counters.onBarCount += 1;
    },
    validateConfig(_config: unknown): Result<void, ConfigError> {
      return counters.validateResult;
    },
    reset(): void {
      counters.resetCount += 1;
    },
    dispose(): void {
      counters.disposed = true;
    },
    get subscribed() {
      return counters.subscribed;
    },
    get disposed() {
      return counters.disposed;
    },
    get resetCount() {
      return counters.resetCount;
    },
    get onBarCount() {
      return counters.onBarCount;
    },
    setValidateResult(r: Result<void, ConfigError>): void {
      counters.validateResult = r;
    },
  };
  return Object.assign(plugin, overrides);
};

const mkBar = (close = 100): Bar => ({
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

describe("StrategyRegistry", () => {
  it("register + get + list (basic lifecycle)", () => {
    const reg = new StrategyRegistry();
    const p = mkPlugin(mkMetadata({ name: "alpha" }));
    reg.register(p);
    expect(reg.size).toBe(1);
    expect(reg.get("alpha")).toBe(p);
    const list = reg.list();
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("alpha");
  });

  it("duplicate name rejected (throws)", () => {
    const reg = new StrategyRegistry();
    reg.register(mkPlugin(mkMetadata({ name: "alpha" })));
    expect(() => reg.register(mkPlugin(mkMetadata({ name: "alpha" })))).toThrow(
      'duplicate plugin name "alpha"',
    );
    expect(reg.size).toBe(1);
  });

  it("unregister existing plugin returns true", () => {
    const reg = new StrategyRegistry();
    reg.register(mkPlugin(mkMetadata({ name: "alpha" })));
    expect(reg.unregister("alpha")).toBe(true);
    expect(reg.size).toBe(0);
    expect(reg.get("alpha")).toBeUndefined();
  });

  it("unregister non-existing plugin returns false", () => {
    const reg = new StrategyRegistry();
    expect(reg.unregister("nonexistent")).toBe(false);
  });

  it("unregister calls plugin.dispose() (cleanup hook)", () => {
    const reg = new StrategyRegistry();
    const p = mkPlugin(mkMetadata({ name: "alpha" }));
    reg.register(p);
    reg.unregister("alpha");
    expect((p as unknown as { disposed: boolean }).disposed).toBe(true);
  });

  it("wire all plugins to bus (subscribe called on each)", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    reg.register(p1);
    reg.register(p2);
    const bus = new SignalBus();
    reg.wireAll(bus);
    expect((p1 as unknown as { subscribed: boolean }).subscribed).toBe(true);
    expect((p2 as unknown as { subscribed: boolean }).subscribed).toBe(true);
  });

  it("validation: all valid configs → ok", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    reg.register(p1);
    reg.register(p2);
    const v = reg.validateAll();
    expect(v.ok).toBe(true);
  });

  it("validation: at least one invalid config → aggregated err", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    (p2 as unknown as {
      setValidateResult(r: Result<void, ConfigError>): void;
    }).setValidateResult({
      ok: false,
      error: { pluginName: "beta", field: "leverage", message: "must be 10" },
    });
    reg.register(p1);
    reg.register(p2);
    const v = reg.validateAll();
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error.errors.length).toBe(1);
      expect(v.error.errors[0]!.pluginName).toBe("beta");
    }
  });

  it("aggregated errors collect all failures (not first-fail)", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    const p3 = mkPlugin(mkMetadata({ name: "gamma" }));
    (p1 as unknown as { setValidateResult(r: Result<void, ConfigError>): void }).setValidateResult({
      ok: false,
      error: { pluginName: "alpha", field: "a", message: "err-a" },
    });
    (p2 as unknown as { setValidateResult(r: Result<void, ConfigError>): void }).setValidateResult({
      ok: false,
      error: { pluginName: "beta", field: "b", message: "err-b" },
    });
    (p3 as unknown as { setValidateResult(r: Result<void, ConfigError>): void }).setValidateResult({
      ok: false,
      error: { pluginName: "gamma", field: "c", message: "err-c" },
    });
    reg.register(p1);
    reg.register(p2);
    reg.register(p3);
    const v = reg.validateAll();
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error.errors.length).toBe(3);
      const names = v.error.errors.map((e) => e.pluginName);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
      expect(names).toContain("gamma");
    }
  });

  it("plugin metadata validation: maxLeverage > 10 REJECTED (1:10 hard guard)", () => {
    const reg = new StrategyRegistry();
    const p = mkPlugin(mkMetadata({ name: "alpha", maxLeverage: 11 }));
    expect(() => reg.register(p)).toThrow(/1:10 HARD GUARDRAIL/);
    expect(() => reg.register(p)).toThrow(/maxLeverage must be in/);
    expect(reg.size).toBe(0);
  });

  it("plugin metadata validation: invalid edgeClass rejected", () => {
    const r1 = validatePluginMetadata(
      mkMetadata({ edgeClass: "invalid" as unknown as EdgeClass }),
    );
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.field).toBe("edgeClass");
    }
  });

  it("plugin metadata validation: empty name rejected", () => {
    const r = validatePluginMetadata(mkMetadata({ name: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("name");
    }
  });

  it("plugin metadata validation: name with whitespace rejected", () => {
    const r = validatePluginMetadata(mkMetadata({ name: "has space" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("name");
    }
  });

  it("plugin metadata validation: non-finite capitalRequirement rejected", () => {
    const r = validatePluginMetadata(mkMetadata({ capitalRequirement: Number.NaN }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("capitalRequirement");
    }
  });

  it("plugin metadata validation: maxLeverage < 1 rejected", () => {
    const r = validatePluginMetadata(mkMetadata({ maxLeverage: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("maxLeverage");
    }
  });

  it("plugin metadata validation: maxLeverage = MAX_ALLOWED_PLUGIN_LEVERAGE (10) accepted", () => {
    const r = validatePluginMetadata(mkMetadata({ maxLeverage: MAX_ALLOWED_PLUGIN_LEVERAGE }));
    expect(r.ok).toBe(true);
  });

  it("edge case: empty registry (wireAll, validateAll, onBarAll)", () => {
    const reg = new StrategyRegistry();
    const bus = new SignalBus();
    expect(() => reg.wireAll(bus)).not.toThrow();
    expect(reg.validateAll().ok).toBe(true);
    expect(() => reg.onBarAll(mkBar(), {})).not.toThrow();
    expect(() => reg.resetAll()).not.toThrow();
    expect(reg.size).toBe(0);
  });

  it("onBarAll calls every plugin in order", () => {
    const reg = new StrategyRegistry();
    const order: string[] = [];
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }), {
      onBar: () => {
        order.push("alpha");
      },
    });
    const p2 = mkPlugin(mkMetadata({ name: "beta" }), {
      onBar: () => {
        order.push("beta");
      },
    });
    const p3 = mkPlugin(mkMetadata({ name: "gamma" }), {
      onBar: () => {
        order.push("gamma");
      },
    });
    reg.register(p1);
    reg.register(p2);
    reg.register(p3);
    reg.onBarAll(mkBar(), {});
    expect(order).toEqual(["alpha", "beta", "gamma"]);
  });

  it("onBarAll swallows plugin exceptions (defensive isolation)", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }), {
      onBar: () => {
        throw new Error("alpha failed");
      },
    });
    const p2 = mkPlugin(mkMetadata({ name: "beta" }), {
      onBar: () => {
        // success
      },
    });
    reg.register(p1);
    reg.register(p2);
    expect(() => reg.onBarAll(mkBar(), {})).not.toThrow();
  });

  it("resetAll calls plugin.reset() on every plugin", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    reg.register(p1);
    reg.register(p2);
    reg.resetAll();
    expect((p1 as unknown as { resetCount: number }).resetCount).toBe(1);
    expect((p2 as unknown as { resetCount: number }).resetCount).toBe(1);
  });

  it("createStrategyRegistry factory matches new StrategyRegistry()", () => {
    const r = createStrategyRegistry();
    expect(r).toBeInstanceOf(StrategyRegistry);
    expect(r.size).toBe(0);
  });
});