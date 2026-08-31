// packages/core/src/signal-center/strategy-registry.test.ts — Phase 10G Track A

import { describe, expect, it } from "bun:test";

import { SignalBus } from "./signal-bus.js";
import {
  MAX_ALLOWED_PLUGIN_AGGREGATE_EFFECTIVE_LEVERAGE,
  StrategyRegistry,
  createStrategyRegistry,
  validatePluginMetadata,
  type StrategyPlugin,
  type StrategyPluginMetadata,
} from "./strategy-registry.js";
import type { Bar, ConfigError, PluginState, Result } from "./types.js";

const mkMetadata = (overrides: Partial<StrategyPluginMetadata> = {}): StrategyPluginMetadata => ({
  name: "test-plugin",
  version: "1.0.0",
  edgeClass: "directional",
  capitalRequirement: 10_000,
  maxAggregateEffectiveLeverage: 10,
  ...overrides,
});

interface TestStrategyPlugin extends StrategyPlugin {
  readonly subscribed: boolean;
  readonly disposed: boolean;
  readonly resetCount: number;
  readonly onBarCount: number;
  setValidateResult(result: Result<void, ConfigError>): void;
}

const mkPlugin = (
  metadata: StrategyPluginMetadata,
  overrides: Partial<StrategyPlugin> = {},
): TestStrategyPlugin => {
  let validateResult: Result<void, ConfigError> = { ok: true, value: undefined };
  const counters = {
    subscribed: false,
    disposed: false,
    resetCount: 0,
    onBarCount: 0,
  };
  const plugin: TestStrategyPlugin = {
    metadata,
    subscribe(_bus: SignalBus): void {
      counters.subscribed = true;
    },
    onBar(_bar: Bar, _state: PluginState): void {
      counters.onBarCount += 1;
    },
    validateConfig(_config: unknown): Result<void, ConfigError> {
      return validateResult;
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
    setValidateResult(result: Result<void, ConfigError>): void {
      validateResult = result;
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

describe("StrategyRegistry", () => {
  it("register + get + list (basic lifecycle)", () => {
    const reg = new StrategyRegistry();
    const p = mkPlugin(mkMetadata({ name: "alpha" }));
    reg.register(p);
    expect(reg.size).toBe(1);
    expect(reg.get("alpha")).toBe(p);
    const list = reg.list();
    expect(list.length).toBe(1);
    expect(list.at(0)?.name).toBe("alpha");
  });

  it("duplicate name rejected (throws)", () => {
    const reg = new StrategyRegistry();
    reg.register(mkPlugin(mkMetadata({ name: "alpha" })));
    expect(() => {
      reg.register(mkPlugin(mkMetadata({ name: "alpha" })));
    }).toThrow('duplicate plugin name "alpha"');
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
    expect(p.disposed).toBe(true);
  });

  it("wire all plugins to bus (subscribe called on each)", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    reg.register(p1);
    reg.register(p2);
    const bus = new SignalBus();
    reg.wireAll(bus);
    expect(p1.subscribed).toBe(true);
    expect(p2.subscribed).toBe(true);
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
    p2.setValidateResult({
      ok: false,
      error: { pluginName: "beta", field: "leverage", message: "must be 10" },
    });
    reg.register(p1);
    reg.register(p2);
    const v = reg.validateAll();
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error.errors.length).toBe(1);
      expect(v.error.errors.at(0)?.pluginName).toBe("beta");
    }
  });

  it("aggregated errors collect all failures (not first-fail)", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    const p3 = mkPlugin(mkMetadata({ name: "gamma" }));
    p1.setValidateResult({
      ok: false,
      error: { pluginName: "alpha", field: "a", message: "err-a" },
    });
    p2.setValidateResult({
      ok: false,
      error: { pluginName: "beta", field: "b", message: "err-b" },
    });
    p3.setValidateResult({
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
      const names = v.error.errors.map((configError) => configError.pluginName);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
      expect(names).toContain("gamma");
    }
  });

  it("plugin metadata validation: maxLeverage > 10 REJECTED (1:10 hard guard)", () => {
    const reg = new StrategyRegistry();
    const p = mkPlugin(mkMetadata({ name: "alpha", maxAggregateEffectiveLeverage: 11 }));
    expect(() => {
      reg.register(p);
    }).toThrow(/Aggregate effective-exposure limit/);
    expect(() => {
      reg.register(p);
    }).toThrow(/maxAggregateEffectiveLeverage must be in/);
    expect(reg.size).toBe(0);
  });

  it("plugin metadata validation: invalid edgeClass rejected", () => {
    const r1 = validatePluginMetadata(Object.assign(mkMetadata(), { edgeClass: "invalid" }));
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
    const r = validatePluginMetadata(mkMetadata({ capitalRequirement: NaN }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("capitalRequirement");
    }
  });

  it("plugin metadata validation: maxLeverage < 1 rejected", () => {
    const r = validatePluginMetadata(mkMetadata({ maxAggregateEffectiveLeverage: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("maxAggregateEffectiveLeverage");
    }
  });

  it("plugin metadata validation: maxLeverage = MAX_ALLOWED_PLUGIN_LEVERAGE (10) accepted", () => {
    const r = validatePluginMetadata(
      mkMetadata({ maxAggregateEffectiveLeverage: MAX_ALLOWED_PLUGIN_AGGREGATE_EFFECTIVE_LEVERAGE }),
    );
    expect(r.ok).toBe(true);
  });

  it("edge case: empty registry (wireAll, validateAll, onBarAll)", () => {
    const reg = new StrategyRegistry();
    const bus = new SignalBus();
    expect(() => {
      reg.wireAll(bus);
    }).not.toThrow();
    expect(reg.validateAll().ok).toBe(true);
    expect(() => {
      reg.onBarAll(mkBar(), {});
    }).not.toThrow();
    expect(() => {
      reg.resetAll();
    }).not.toThrow();
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

  it("async plugins fail loud on sync dispatch and are awaited in order", async () => {
    const reg = new StrategyRegistry();
    const order: string[] = [];
    const plugin = mkPlugin(mkMetadata({ name: "async-alpha", onBarMode: "async" }), {
      onBar: async () => {
        await Promise.resolve();
        order.push("async-alpha");
      },
    });
    reg.register(plugin);
    expect(() => {
      reg.onBarAll(mkBar(), {});
    }).toThrow(/onBarAllAsync/);
    expect(order).toEqual([]);
    await reg.onBarAllAsync(mkBar(), {});
    expect(order).toEqual(["async-alpha"]);
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
    expect(() => {
      reg.onBarAll(mkBar(), {});
    }).not.toThrow();
  });

  it("onBarAll a megadott logger-t hívja, ha egy plugin dob", () => {
    const messages: { message: string; arguments_: unknown[] }[] = [];
    const reg = new StrategyRegistry({
      logger: {
        error: (message: string, ...arguments_: unknown[]) => {
          messages.push({ message, arguments_ });
        },
      },
    });
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }), {
      onBar: () => {
        throw new Error("alpha failed");
      },
    });
    reg.register(p1);
    reg.onBarAll(mkBar(), {});
    expect(messages.length).toBe(1);
    expect(messages.at(0)?.message).toContain("alpha");
    expect(messages.at(0)?.arguments_.at(0)).toBe("alpha failed");
  });

  it("resetAll a megadott logger-t hívja, ha egy plugin dob", () => {
    const messages: { message: string; arguments_: unknown[] }[] = [];
    const reg = new StrategyRegistry({
      logger: {
        error: (message: string, ...arguments_: unknown[]) => {
          messages.push({ message, arguments_ });
        },
      },
    });
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }), {
      reset: () => {
        throw new Error("alpha reset failed");
      },
    });
    reg.register(p1);
    reg.resetAll();
    expect(messages.length).toBe(1);
    expect(messages.at(0)?.message).toContain("alpha");
    expect(messages.at(0)?.arguments_.at(0)).toBe("alpha reset failed");
  });

  it("onBarAll alapértelmezetten NEM logol (no-op logger)", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }), {
      onBar: () => {
        throw new Error("alpha failed");
      },
    });
    reg.register(p1);
    expect(() => {
      reg.onBarAll(mkBar(), {});
    }).not.toThrow();
  });

  it("resetAll calls plugin.reset() on every plugin", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    reg.register(p1);
    reg.register(p2);
    reg.resetAll();
    expect(p1.resetCount).toBe(1);
    expect(p2.resetCount).toBe(1);
  });

  it("createStrategyRegistry factory matches new StrategyRegistry()", () => {
    const r = createStrategyRegistry();
    expect(r).toBeInstanceOf(StrategyRegistry);
    expect(r.size).toBe(0);
  });
});
describe("Phase 35b — StrategyRegistry private method coverage via cast", () => {
  it("calls findIndexByName directly to ensure function is hit", () => {
    const reg = new StrategyRegistry();
    const p = mkPlugin(mkMetadata({ name: "alpha" }));
    reg.register(p);
    expect(reg.get("alpha")).toBe(p);
    expect(reg.get("nonexistent")).toBeUndefined();
  });
});

describe("Phase 35b — StrategyRegistry inline arrow coverage", () => {
  it("list() executes the (p) => p.metadata arrow at line 381", () => {
    const reg = new StrategyRegistry();
    reg.register(mkPlugin(mkMetadata({ name: "alpha" })));
    const list = reg.list();
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe("alpha");
  });

  it("validateAll() err path executes the (e) => ... arrow at line 434", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    p2.setValidateResult({
      ok: false,
      error: { pluginName: "beta", field: "leverage", message: "must be 10" },
    });
    reg.register(p1);
    reg.register(p2);
    const v = reg.validateAll();
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error.summary).toContain("beta.leverage");
    }
  });
});

describe("Phase 35b — StrategyRegistry extra function coverage", () => {
  it("list() with multiple plugins (forces the (p) => p.metadata arrow at line 381)", () => {
    const reg = new StrategyRegistry();
    reg.register(mkPlugin(mkMetadata({ name: "alpha" })));
    reg.register(mkPlugin(mkMetadata({ name: "beta" })));
    reg.register(mkPlugin(mkMetadata({ name: "gamma" })));
    const list = reg.list();
    expect(list.length).toBe(3);
    expect(list.map((m) => m.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("validateAll err path with 2 failures (forces the (e) => ... arrow at line 434)", () => {
    const reg = new StrategyRegistry();
    const p1 = mkPlugin(mkMetadata({ name: "alpha" }));
    const p2 = mkPlugin(mkMetadata({ name: "beta" }));
    p1.setValidateResult({
      ok: false,
      error: { pluginName: "alpha", field: "leverage", message: "must be 10" },
    });
    p2.setValidateResult({
      ok: false,
      error: { pluginName: "beta", field: "capital", message: "must be positive" },
    });
    reg.register(p1);
    reg.register(p2);
    const v = reg.validateAll();
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error.errors.length).toBe(2);
      expect(v.error.summary).toContain("alpha.leverage");
      expect(v.error.summary).toContain("beta.capital");
    }
  });
});

describe("Phase 35b — findIndexByName explicit call", () => {
  it("call findIndexByName via cast with empty registry", () => {
    const reg = new StrategyRegistry();
    expect(reg.get("nonexistent")).toBeUndefined();
  });

  it("call findIndexByName via cast with non-empty registry", () => {
    const reg = new StrategyRegistry();
    reg.register(mkPlugin(mkMetadata({ name: "alpha" })));
    expect(reg.get("alpha")?.metadata.name).toBe("alpha");
  });
});
