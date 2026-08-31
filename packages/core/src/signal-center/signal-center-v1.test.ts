import { describe, expect, it } from "vitest";

import type { Bar, CarrySignal, DirectionSignal, RiskSignal, SizingSignal } from "./types.js";
import { SignalCenterV1, toRiskEngineSignal } from "./signal-center-v1.js";
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

function createSizingPlugin(name: string, notional: number): StrategyPlugin & { emitSizing(): SizingSignal } {
  return {
    metadata: {
      name,
      version: "1.0.0",
      edgeClass: "sizing",
      capitalRequirement: 10_000,
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
    emitSizing: () => ({
      kind: "sizing",
      kellyFraction: 1,
      volMultiplier: 1,
      notional,
      source: name,
      timestampMs: sampleBar.timestamp,
    }),
  };
}

describe("SignalCenterV1 — snapshot serializability", () => {
  it("telemetry snapshot is JSON-serializable", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    const snapshot = signalCenter.getTelemetrySnapshot();
    const serialized = JSON.stringify(snapshot);
    expect(JSON.parse(serialized)).toEqual(snapshot);
    expect(serialized).toContain("numStrategies");
  });

  it("risk snapshot is JSON-serializable (Map fields serialize as objects)", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    const snapshot = signalCenter.getPortfolioRisk();
    const serialized = JSON.stringify(snapshot);
    expect(JSON.parse(serialized)).toMatchObject({ numLeverageBreaches: snapshot.numLeverageBreaches });
    expect(serialized).toContain("aggregateLeverage");
  });

  it("risk snapshot has correct field structure", () => {
    const signalCenter = new SignalCenterV1({ symbol: "BTC/USDT" });
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    const snapshot = signalCenter.getPortfolioRisk();
    expect(snapshot).toHaveProperty("timestamp");
    expect(snapshot).toHaveProperty("numStrategies");
    expect(snapshot).toHaveProperty("numSignalsSubmitted");
    expect(snapshot).toHaveProperty("numRiskSignalsEmitted");
    expect(snapshot).toHaveProperty("numLeverageBreaches");
    expect(snapshot).toHaveProperty("exposure");
    expect(snapshot).toHaveProperty("drawdown");
    expect(snapshot).toHaveProperty("aggregateLeverage");
  });

  it("telemetry snapshot has correct field structure", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    const snapshot = signalCenter.getTelemetrySnapshot();
    expect(snapshot).toHaveProperty("timestamp");
    expect(snapshot).toHaveProperty("numStrategies");
    expect(snapshot).toHaveProperty("numActiveStrategies");
    expect(snapshot).toHaveProperty("numDisabledStrategies");
    expect(snapshot).toHaveProperty("totalTrades");
    expect(snapshot).toHaveProperty("perStrategy");
    expect(snapshot).toHaveProperty("killSwitchHistory");
  });
});

describe("SignalCenterV1 — determinism", () => {
  it("same input → same telemetry snapshot (deterministic)", () => {
    const first = new SignalCenterV1({ initialEquity: 10_000, symbol: "BTC/USDT" });
    const second = new SignalCenterV1({ initialEquity: 10_000, symbol: "BTC/USDT" });
    const firstPlugin = createSizingPlugin("p1", 50_000);
    const secondPlugin = createSizingPlugin("p1", 50_000);
    first.registerPlugin(firstPlugin);
    second.registerPlugin(secondPlugin);
    first.start();
    second.start();
    first.bus.emit(firstPlugin.emitSizing());
    second.bus.emit(secondPlugin.emitSizing());
    first.onBar(sampleBar);
    second.onBar(sampleBar);
    const firstSnapshot = first.getTelemetrySnapshot();
    const secondSnapshot = second.getTelemetrySnapshot();
    expect(firstSnapshot.numStrategies).toBe(secondSnapshot.numStrategies);
    expect(firstSnapshot.numActiveStrategies).toBe(secondSnapshot.numActiveStrategies);
    expect(firstSnapshot.numDisabledStrategies).toBe(secondSnapshot.numDisabledStrategies);
    expect(firstSnapshot.totalTrades).toBe(secondSnapshot.totalTrades);
    expect(firstSnapshot.totalPnlUsd).toBe(secondSnapshot.totalPnlUsd);
    expect(firstSnapshot.perStrategy.length).toBe(secondSnapshot.perStrategy.length);
  });

  it("same input → same risk aggregate (deterministic)", () => {
    const first = new SignalCenterV1({ initialEquity: 10_000 });
    const second = new SignalCenterV1({ initialEquity: 10_000 });
    const firstPlugin = createSizingPlugin("p1", 50_000);
    const secondPlugin = createSizingPlugin("p1", 50_000);
    first.registerPlugin(firstPlugin);
    second.registerPlugin(secondPlugin);
    first.start();
    second.start();
    first.bus.emit(firstPlugin.emitSizing());
    second.bus.emit(secondPlugin.emitSizing());
    first.onBar(sampleBar);
    second.onBar(sampleBar);
    const firstRisk = first.getPortfolioRisk();
    const secondRisk = second.getPortfolioRisk();
    expect(firstRisk.aggregateLeverage).toBeCloseTo(secondRisk.aggregateLeverage, 6);
    expect(firstRisk.numSignalsSubmitted).toBe(secondRisk.numSignalsSubmitted);
  });
});

describe("SignalCenterV1 — edge cases", () => {
  it("0 plugins — start throws", () => {
    expect(() => {
      new SignalCenterV1().start();
    }).toThrow(/At least one plugin must be registered/);
  });

  it("1 plugin — works", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    signalCenter.onBar(sampleBar);
    expect(signalCenter.barCount).toBe(1);
  });

  it("100 plugins — works", () => {
    const signalCenter = new SignalCenterV1();
    for (let index = 0; index < 100; index += 1) {
      signalCenter.registerPlugin(createNoopPlugin(`p-${String(index)}`));
    }
    signalCenter.start();
    signalCenter.onBar(sampleBar);
    expect(signalCenter.registry.size).toBe(100);
  });

  it("missing data (empty bar) is handled gracefully", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    const emptyBar: Bar = { timestamp: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 };
    expect(() => signalCenter.onBar(emptyBar)).not.toThrow();
  });

  it("multiple onBar calls accumulate barCount", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    for (let index = 0; index < 50; index += 1) signalCenter.onBar(sampleBar);
    expect(signalCenter.barCount).toBe(50);
  });
});

describe("SignalCenterV1 — isPluginKilled / helpers", () => {
  it("isPluginKilled returns true after kill, false before", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    expect(signalCenter.isPluginKilled("noop-test")).toBe(false);
    signalCenter.killPlugin("noop-test");
    expect(signalCenter.isPluginKilled("noop-test")).toBe(true);
  });

  it("isPluginKilled returns false for unknown plugin", () => {
    expect(new SignalCenterV1().isPluginKilled("nonexistent")).toBe(false);
  });

  it("recordTrade is recorded by telemetry", () => {
    const signalCenter = new SignalCenterV1({
      telemetry: { sharpeWindowDays: 30, minTradeCount: 0, exportDelimiter: "," },
    });
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    signalCenter.recordTrade({
      source: "noop-test",
      symbol: "BTC/USDT",
      timestamp: sampleBar.timestamp,
      notionalUsd: 100_000,
      pnlUsd: 50,
      side: "carry",
    });
    expect(signalCenter.getTelemetrySnapshot().totalTrades).toBe(1);
  });

  it("recordSourceReturn is recorded by risk engine", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    signalCenter.recordSourceReturn("test-source", sampleBar.timestamp, 0.01);
    expect(signalCenter.getPortfolioRisk().numStrategies).toBe(1);
  });

  it("recordEquitySnapshot feeds drawdown tracking", () => {
    const signalCenter = new SignalCenterV1();
    signalCenter.registerPlugin(createNoopPlugin());
    signalCenter.start();
    signalCenter.recordEquitySnapshot(sampleBar.timestamp, 10_000);
    signalCenter.recordEquitySnapshot(sampleBar.timestamp + 100_000, 9500);
    expect(signalCenter.getPortfolioRisk().drawdown.maxDrawdownPct).toBeCloseTo(0.05, 4);
  });
});

describe("toRiskEngineSignal — shape translator", () => {
  it("translates CarrySignal", () => {
    const signal: CarrySignal = {
      kind: "carry",
      fundingRate: 0.0001,
      regime: "high",
      source: "noop-test",
      timestampMs: sampleBar.timestamp,
    };
    const translated = toRiskEngineSignal(signal, "BTC/USDT", 10_000);
    expect(translated).toMatchObject({
      kind: "carry",
      source: "noop-test",
      symbol: "BTC/USDT",
      effectiveNotionalUsd: 0,
      timestamp: sampleBar.timestamp,
    });
  });

  it("translates SizingSignal with notional → effectiveNotionalUsd", () => {
    const signal: SizingSignal = {
      kind: "sizing",
      kellyFraction: 0.5,
      volMultiplier: 1,
      notional: 50_000,
      source: "noop-test",
      timestampMs: sampleBar.timestamp,
    };
    const translated = toRiskEngineSignal(signal, "BTC/USDT", 5000);
    expect(translated).toMatchObject({ kind: "sizing", effectiveNotionalUsd: 50_000, leverage: 10 });
  });

  it("translates DirectionSignal with side='flat' → 'long'", () => {
    const signal: DirectionSignal = {
      kind: "direction",
      side: "flat",
      strength: 0.5,
      source: "donchian-mtf",
      timestampMs: sampleBar.timestamp,
    };
    const translated = toRiskEngineSignal(signal, "BTC/USDT", 10_000);
    expect(translated).toMatchObject({ kind: "direction", side: "long", confidence: 0.5 });
  });

  it("translates RiskSignal with breach=false default", () => {
    const signal: RiskSignal = {
      kind: "risk",
      varDaily95: 0.01,
      correlationPenalty: 0.2,
      drawdownLimit: 0.1,
      source: "test-source",
      timestampMs: sampleBar.timestamp,
    };
    const translated = toRiskEngineSignal(signal, "BTC/USDT", 10_000);
    expect(translated).toMatchObject({ kind: "risk", breach: false, reason: "test-source" });
  });

  it("rejects invalid initial equity at the risk-engine translation boundary", () => {
    const signal: SizingSignal = {
      kind: "sizing",
      kellyFraction: 0.5,
      volMultiplier: 1,
      notional: 5000,
      source: "noop-test",
    };
    expect(() => toRiskEngineSignal(signal, "BTC/USDT", 0)).toThrow(
      /initialEquity must be positive safe integer/,
    );
  });
});
