import { beforeEach, describe, expect, it } from "vitest";

import type { Bar, ConfigError, DirectionSignal, Result, SizingSignal } from "./types.js";
import { SignalCenterV1 } from "./signal-center-v1.js";
import type { StrategyPlugin } from "./strategy-registry.js";

const sampleBar: Bar = {
  timestamp: 1_700_000_000_000,
  open: 30_000,
  high: 30_500,
  low: 29_800,
  close: 30_200,
  volume: 100,
};
function createNoopPlugin(name = "noop-test"): StrategyPlugin {
  return {
    metadata: {
      name,
      version: "1",
      description: "No-op test plugin",
      edgeClass: "mixed",
      capitalRequirement: 0,
      maxAggregateEffectiveLeverage: 10,
    },
    subscribe: () => {
      /*
       * no subscriptions
       */
    },
    onBar: () => {
      /*
       * no per-bar work
       */
    },
    validateConfig: () => ({ ok: true, value: undefined }),
    reset: () => {
      /*
       * no state
       */
    },
  };
}
interface SizingPlugin extends StrategyPlugin {
  readonly barCount: number;
  emitSizing(): SizingSignal;
}
function createSizingPlugin(name: string, notionalUsd: number): SizingPlugin {
  let barCount = 0;
  return {
    metadata: {
      name,
      version: "1.0.0",
      edgeClass: "sizing",
      capitalRequirement: 10_000,
      maxAggregateEffectiveLeverage: 10,
      description: "Test-only plugin that emits a sizing signal",
    },
    get barCount(): number {
      return barCount;
    },
    subscribe: () => {
      /*
       * no subscriptions
       */
    },
    onBar: () => {
      barCount += 1;
    },
    validateConfig: () => ({ ok: true, value: undefined }),
    reset: () => {
      barCount = 0;
    },
    emitSizing: () => ({
      kind: "sizing",
      kellyFraction: 1,
      volMultiplier: 1,
      notional: notionalUsd,
      source: name,
      timestampMs: sampleBar.timestamp,
    }),
  };
}

interface MultiEmitterPlugin extends StrategyPlugin {
  readonly emitted: number;
}

function createMultiEmitterPlugin(name: string): MultiEmitterPlugin {
  let emitted = 0;
  return {
    metadata: {
      name,
      version: "1.0.0",
      edgeClass: "mixed",
      capitalRequirement: 10_000,
      maxAggregateEffectiveLeverage: 10,
    },
    get emitted(): number {
      return emitted;
    },
    subscribe: () => {
      /*
       * no subscriptions
       */
    },
    onBar: () => {
      emitted += 1;
    },
    validateConfig: () => ({ ok: true, value: undefined }),
    reset: () => {
      emitted = 0;
    },
  };
}

describe("SignalCenterV1 — plugin lifecycle", () => {
  let signalCenter: SignalCenterV1;

  beforeEach(() => {
    signalCenter = new SignalCenterV1({ symbol: "BTC/USDT" });
  });

  it("registerPlugin adds to registry (start not called yet)", () => {
    signalCenter.registerPlugin(createNoopPlugin());
    expect(signalCenter.registry.size).toBe(1);
    expect(signalCenter.registry.get("noop-test")).toBeDefined();
  });

  it("rejects plugin registration AFTER start()", () => {
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    expect(() => {
      signalCenter.registerPlugin(createNoopPlugin("second"));
    }).toThrow(/cannot register after start/);
  });

  it("rejects duplicate plugin registration", () => {
    signalCenter.registerPlugin(createNoopPlugin());
    expect(() => {
      signalCenter.registerPlugin(createNoopPlugin());
    }).toThrow(/duplicate plugin name/);
  });

  it("start() validates all plugins and wires to bus", () => {
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    expect(signalCenter.isStarted).toBe(true);
    expect(signalCenter.registry.size).toBe(1);
  });

  it("start() refuses with 0 plugins", () => {
    expect(() => {
      signalCenter.start();
    }).toThrow(/At least one plugin must be registered/);
  });

  it("start() fails closed when a registered plugin rejects its configuration", () => {
    const invalidPlugin: StrategyPlugin = {
      metadata: {
        name: "invalid-config",
        version: "1",
        edgeClass: "mixed",
        capitalRequirement: 0,
        maxAggregateEffectiveLeverage: 10,
      },
      subscribe: () => {
        /*
         * no subscriptions
         */
      },
      onBar: () => {
        /*
         * no per-bar work
         */
      },
      validateConfig: (): Result<void, ConfigError> => ({
        ok: false,
        error: { pluginName: "invalid-config", field: "mode", message: "invalid test configuration" },
      }),
      reset: () => {
        /*
         * no state
         */
      },
    };
    signalCenter.registerPlugin(invalidPlugin);
    expect(() => {
      signalCenter.start();
    }).toThrow(/Boot validation failed/);
  });

  it("start() called twice throws", () => {
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    expect(() => {
      signalCenter.start();
    }).toThrow(/called twice/);
  });

  it("reset() clears state and allows re-start", () => {
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    signalCenter.onBar(sampleBar);
    signalCenter.reset();
    expect(signalCenter.isStarted).toBe(false);
    expect(signalCenter.barCount).toBe(0);
    expect(signalCenter.signalsSubmitted).toBe(0);
    expect(signalCenter.busEmissions).toBe(0);
    signalCenter.start();
    expect(signalCenter.isStarted).toBe(true);
  });

  it("getRegisteredPlugins returns metadata", () => {
    signalCenter.registerPlugin(createNoopPlugin());
    const plugins = signalCenter.getRegisteredPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("noop-test");
    expect(plugins[0]?.edgeClass).toBe("mixed");
    expect(plugins[0]?.maxAggregateEffectiveLeverage).toBe(10);
    expect(plugins[0]?.version).toBe("1");
    expect(plugins[0]).toHaveProperty("maxAggregateEffectiveLeverage");
  });
});

describe("SignalCenterV1 — per-bar dispatch", () => {
  it("onBar before start() is a silent no-op", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.onBar(sampleBar);
    expect(signalCenter.barCount).toBe(0);
  });

  it("onBar dispatches to all registered plugins", () => {
    const signalCenter = new SignalCenterV1();
    const plugin = createSizingPlugin("sizing", 10_000);
    signalCenter.registerPlugin(plugin);
    signalCenter.start();
    signalCenter.onBar(sampleBar);
    expect(plugin.barCount).toBe(1);
    expect(signalCenter.barCount).toBe(1);
    expect(signalCenter.isStarted).toBe(true);
  });

  it("multi-plugin composition: 10 plugins all receive onBar", () => {
    const signalCenter = new SignalCenterV1();
    const plugins = Array.from({ length: 10 }, (_, index) =>
      createMultiEmitterPlugin(`multi-${String(index)}`),
    );
    for (const plugin of plugins) {
      signalCenter.registerPlugin(plugin);
    }
    signalCenter.start();
    signalCenter.onBar(sampleBar);
    expect(plugins.every((plugin) => plugin.emitted === 1)).toBe(true);
  });

  it("scales to 100 plugins without crashing", () => {
    const signalCenter = new SignalCenterV1();
    for (let index = 0; index < 100; index += 1) {
      signalCenter.registerPlugin(createMultiEmitterPlugin(`p-${String(index)}`));
    }
    signalCenter.start();
    expect(() => signalCenter.onBar(sampleBar)).not.toThrow();
    expect(signalCenter.registry.size).toBe(100);
  });

  it("signals emitted by plugins flow through bus → risk engine → telemetry", () => {
    const signalCenter = new SignalCenterV1({ symbol: "BTC/USDT" });
    const plugin = createSizingPlugin("sizing", 50_000);
    signalCenter.registerPlugin(plugin);
    signalCenter.start();
    signalCenter.bus.emit(plugin.emitSizing());
    expect(signalCenter.signalsSubmitted).toBe(1);
    expect(signalCenter.busEmissions).toBe(1);
    expect(signalCenter.getPortfolioRisk().numSignalsSubmitted).toBe(1);
  });

  it("NoOpPlugin integration: SCv1 should start without crash on no-op plugin (Phase 32 stub)", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    expect(() => {
      signalCenter.start();
    }).not.toThrow();
  });

  it("DirectionSignal is routed to telemetry but NOT to risk engine (no notional)", () => {
    const signalCenter = new SignalCenterV1({ symbol: "BTC/USDT" });
    signalCenter.registerPlugin(createMultiEmitterPlugin("multi-emitter"));
    signalCenter.start();
    const direction: DirectionSignal = {
      kind: "direction",
      side: "long",
      strength: 0.8,
      source: "donchian-mtf",
      timestampMs: sampleBar.timestamp,
    };
    signalCenter.bus.emit(direction);
    expect(signalCenter.busEmissions).toBe(1);
    const beforeRisk = signalCenter.signalsSubmitted;
    signalCenter.bus.emit(direction);
    expect(signalCenter.signalsSubmitted).toBe(beforeRisk);
  });
});

describe("SignalCenterV1 — kill-switch", () => {
  it("killPlugin disables a plugin (no further signals processed by telemetry)", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    expect(signalCenter.killPlugin("noop-test", "manual test")).toBe(true);
    expect(signalCenter.isPluginKilled("noop-test")).toBe(true);
    expect(signalCenter.getDisabledPlugins()).toContain("noop-test");
    expect(signalCenter.killPlugin("noop-test")).toBe(false);
  });

  it("enablePlugin re-enables a killed plugin", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    signalCenter.killPlugin("noop-test", "first kill");
    expect(signalCenter.enablePlugin("noop-test")).toBe(true);
    expect(signalCenter.isPluginKilled("noop-test")).toBe(false);
    expect(signalCenter.getDisabledPlugins()).not.toContain("noop-test");
    expect(signalCenter.enablePlugin("noop-test")).toBe(false);
  });

  it("killPlugin on unknown plugin returns false", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    expect(signalCenter.killPlugin("nonexistent")).toBe(false);
  });

  it("kill-switch event is recorded in telemetry history", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    signalCenter.killPlugin("noop-test", "test kill");
    const history = signalCenter.getKillSwitchHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.action).toBe("disable");
    expect(history[0]?.reason).toBe("test kill");
  });

  it("signals from killed plugins are rejected before every central consumer", () => {
    const signalCenter = new SignalCenterV1({ symbol: "BTC/USDT" });
    const plugin = createSizingPlugin("sizing", 50_000);
    signalCenter.registerPlugin(plugin);
    signalCenter.start();
    signalCenter.bus.emit(plugin.emitSizing());
    expect(signalCenter.signalsSubmitted).toBe(1);
    signalCenter.killPlugin(plugin.metadata.name);
    const acceptedBeforeKill = signalCenter.bus.snapshot().length;
    signalCenter.bus.emit(plugin.emitSizing());
    expect(signalCenter.signalsSubmitted).toBe(1);
    expect(signalCenter.bus.snapshot()).toHaveLength(acceptedBeforeKill);
    expect(signalCenter.getTelemetrySnapshot().numDisabledStrategies).toBe(1);
  });
});

describe("SignalCenterV1 — aggregate effective-exposure limit", () => {
  it("Layer 1: constructor rejects maxLeverage > 10", () => {
    expect(() => {
      new SignalCenterV1({ maxAggregateEffectiveLeverage: 11 });
    }).toThrow(/aggregate effective-exposure limit breach/);
  });

  it("Layer 1: registry's per-plugin guardrail rejects maxLeverage > 10", () => {
    const signalCenter = new SignalCenterV1();
    const plugin: StrategyPlugin = {
      metadata: {
        name: "bad",
        version: "1.0.0",
        edgeClass: "sizing",
        capitalRequirement: 10_000,
        maxAggregateEffectiveLeverage: 11,
      },
      subscribe: () => {
        /*
         * no subscriptions
         */
      },
      onBar: () => {
        /*
         * no per-bar work
         */
      },
      validateConfig: () => ({ ok: true, value: undefined }),
      reset: () => {
        /*
         * no state
         */
      },
    };
    expect(() => {
      signalCenter.registerPlugin(plugin);
    }).toThrow(/Aggregate effective-exposure limit/);
  });

  it("Layer 3: per-bar leverageInvariantGuard fires on aggregate breach", () => {
    const signalCenter = new SignalCenterV1({
      initialEquity: 10_000,
      maxAggregateEffectiveLeverage: 10,
      symbol: "BTC/USDT",
    });
    const first = createSizingPlugin("p1", 60_000);
    const second = createSizingPlugin("p2", 60_000);
    signalCenter.registerPlugin(first);
    signalCenter.registerPlugin(second);
    signalCenter.start();
    signalCenter.bus.emit(first.emitSizing());
    signalCenter.bus.emit(second.emitSizing());
    signalCenter.onBar(sampleBar);
    const risk = signalCenter.getPortfolioRisk();
    expect(risk.numLeverageBreaches).toBeGreaterThanOrEqual(1);
    expect(
      signalCenter.bus.snapshot().some((signal) => signal.kind === "risk" && signal.breach === true),
    ).toBe(true);
    expect(
      signalCenter.bus.snapshot().some((signal) => signal.kind === "risk" && signal.symbol === "BTC/USDT"),
    ).toBe(true);
  });

  it("Layer 3: no breach when aggregate stays within 1:10", () => {
    const signalCenter = new SignalCenterV1({ initialEquity: 10_000, maxAggregateEffectiveLeverage: 10 });
    const first = createSizingPlugin("p1", 40_000);
    const second = createSizingPlugin("p2", 40_000);
    signalCenter.registerPlugin(first);
    signalCenter.registerPlugin(second);
    signalCenter.start();
    signalCenter.bus.emit(first.emitSizing());
    signalCenter.bus.emit(second.emitSizing());
    signalCenter.onBar(sampleBar);
    expect(signalCenter.getPortfolioRisk().numLeverageBreaches).toBe(0);
    expect(signalCenter.getPortfolioRisk().aggregateLeverage).toBeLessThanOrEqual(10);
    expect(signalCenter.getPortfolioRisk().numSignalsSubmitted).toBe(2);
  });

  it("Layer 3: synthetic 11× single plugin fires breach", () => {
    const signalCenter = new SignalCenterV1({ initialEquity: 10_000, maxAggregateEffectiveLeverage: 10 });
    const plugin = createSizingPlugin("p1", 110_000);
    signalCenter.registerPlugin(plugin);
    signalCenter.start();
    signalCenter.bus.emit(plugin.emitSizing());
    signalCenter.onBar(sampleBar);
    expect(signalCenter.getPortfolioRisk().numLeverageBreaches).toBeGreaterThanOrEqual(1);
    expect(signalCenter.getPortfolioRisk().aggregateLeverage).toBeGreaterThan(10);
  });

  it("Layer 3: 9× single plugin does NOT breach (within cap)", () => {
    const signalCenter = new SignalCenterV1({ initialEquity: 10_000, maxAggregateEffectiveLeverage: 10 });
    const plugin = createSizingPlugin("p1", 90_000);
    signalCenter.registerPlugin(plugin);
    signalCenter.start();
    signalCenter.bus.emit(plugin.emitSizing());
    signalCenter.onBar(sampleBar);
    expect(signalCenter.getPortfolioRisk().numLeverageBreaches).toBe(0);
    expect(signalCenter.getPortfolioRisk().aggregateLeverage).toBeLessThanOrEqual(10);
    expect(signalCenter.getPortfolioRisk().numSignalsSubmitted).toBe(1);
  });

  it("Layer 2: start() — assertLeverageInvariant throws on initial notional breach", () => {
    const signalCenter = new SignalCenterV1({ initialEquity: 10_000, maxAggregateEffectiveLeverage: 10 });
    signalCenter.riskEngine.submitSignal({
      kind: "sizing",
      symbol: "BTC/USDT",
      source: "test-prepop",
      effectiveNotionalUsd: 120_000,
      leverage: 12,
      timestamp: sampleBar.timestamp,
    });
    signalCenter.registerPlugin(createSizingPlugin("valid-plugin", 10_000));
    expect(() => {
      signalCenter.start();
    }).toThrow(/leverage/i);
    expect(() => {
      signalCenter.start();
    }).toThrow(/leverage/i);
  });

  it("Layer 2: start() — clean risk engine at boot does NOT throw (passes Layer 2 trivially)", () => {
    const signalCenter = new SignalCenterV1({ initialEquity: 10_000, maxAggregateEffectiveLeverage: 10 });
    signalCenter.registerPlugin(createSizingPlugin("valid-plugin", 10_000));
    expect(() => {
      signalCenter.start();
    }).not.toThrow();
    expect(() => {
      signalCenter.start();
    }).toThrow(/called twice/);
  });
});
