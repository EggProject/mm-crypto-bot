import { describe, expect, it } from "bun:test";

import {
  CrossSymbolMomentumOverlayPlugin,
  MOMENTUM_NORMALIZER,
  clampStrengthFromMomentum,
  computeMomentum,
  createCrossSymbolMomentumOverlayPlugin,
} from "./cross-symbol-momentum-overlay-plugin.js";
import { SignalBus } from "../signal-bus.js";
import { isDirection } from "../types.js";

const DEFAULT_BASE_NOTIONAL = 10_000;
const TS_BASE = 1_700_000_000_000;

function makeBar(timestampMs = TS_BASE) {
  return {
    timestamp: timestampMs,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  };
}

describe("CrossSymbolMomentumOverlayPlugin", () => {
  it("construction with default config succeeds", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    expect(p.metadata.name).toBe("cross-symbol-momentum-overlay-v1");
    expect(p.config.lookbackDays).toBe(20);
    expect(p.config.momentumThreshold).toBe(0.05);
    expect(p.config.baseNotionalUsd).toBe(DEFAULT_BASE_NOTIONAL);
    expect(p.config.enabledSymbols.length).toBe(2);
    expect(p.config.enabledSymbols[0]).toBe("BTC/USDT");
  });
  it("construction with custom config accepted", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 30,
      momentumThreshold: 0.1,
      baseNotionalUsd: 25_000,
      enabledSymbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    });
    expect(p.config.lookbackDays).toBe(30);
    expect(p.config.momentumThreshold).toBe(0.1);
    expect(p.config.baseNotionalUsd).toBe(25_000);
    expect(p.config.enabledSymbols.length).toBe(3);
  });

  it("metadata declares name/edgeClass/capitalRequirement=10000/maxLeverage=10", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    expect(p.metadata.name).toBe("cross-symbol-momentum-overlay-v1");
    expect(p.metadata.version).toBe("1.0.0");
    expect(p.metadata.edgeClass).toBe("directional");
    expect(p.metadata.capitalRequirement).toBe(10_000);
    expect(p.metadata.maxAggregateEffectiveLeverage).toBe(10);
  });

  it("construction with lookbackDays < 2 REJECTED", () => {
    expect(() => new CrossSymbolMomentumOverlayPlugin({ lookbackDays: 1 })).toThrow(/lookbackDays=1/);
  });

  it("construction with lookbackDays > 365 REJECTED", () => {
    expect(() => new CrossSymbolMomentumOverlayPlugin({ lookbackDays: 366 })).toThrow(/lookbackDays=366/);
  });

  it("construction with non-integer lookbackDays REJECTED", () => {
    expect(() => new CrossSymbolMomentumOverlayPlugin({ lookbackDays: 2.5 })).toThrow(/lookbackDays=2\.5/);
  });

  it("construction with bad momentumThreshold REJECTED", () => {
    expect(() => new CrossSymbolMomentumOverlayPlugin({ momentumThreshold: -1 })).toThrow(
      /momentumThreshold=-1/,
    );
    expect(() => new CrossSymbolMomentumOverlayPlugin({ momentumThreshold: 2 })).toThrow(
      /momentumThreshold=2/,
    );
    expect(() => new CrossSymbolMomentumOverlayPlugin({ momentumThreshold: NaN })).toThrow(
      /momentumThreshold=NaN/,
    );
  });

  it("construction with bad baseNotionalUsd REJECTED", () => {
    expect(() => new CrossSymbolMomentumOverlayPlugin({ baseNotionalUsd: 0 })).toThrow(/baseNotionalUsd=0/);
    expect(() => new CrossSymbolMomentumOverlayPlugin({ baseNotionalUsd: -1 })).toThrow(/baseNotionalUsd=-1/);
    expect(() => new CrossSymbolMomentumOverlayPlugin({ baseNotionalUsd: 1e15 })).toThrow(/baseNotionalUsd=/);
  });

  it("construction with empty enabledSymbols REJECTED", () => {
    expect(() => new CrossSymbolMomentumOverlayPlugin({ enabledSymbols: [] })).toThrow(
      /enabledSymbols must be a non-empty/,
    );
  });

  it("construction with non-string enabledSymbols REJECTED", () => {
    const plugin = new CrossSymbolMomentumOverlayPlugin();
    expect(plugin.validateConfig({ enabledSymbols: ["BTC/USDT", 42] }).ok).toBe(false);
  });

  it("construction with duplicate enabledSymbols REJECTED", () => {
    expect(() => new CrossSymbolMomentumOverlayPlugin({ enabledSymbols: ["BTC/USDT", "BTC/USDT"] })).toThrow(
      /duplicate/,
    );
  });

  it("computeMomentum = (latest / lookback) - 1", () => {
    expect(computeMomentum(110, 100)).toBeCloseTo(0.1, 10);
    expect(computeMomentum(90, 100)).toBeCloseTo(-0.1, 10);
    expect(computeMomentum(100, 100)).toBe(0);
    expect(computeMomentum(NaN, 100)).toBeNull();
    expect(computeMomentum(100, NaN)).toBeNull();
    expect(computeMomentum(0, 100)).toBeNull();
    expect(computeMomentum(100, 0)).toBeNull();
    expect(computeMomentum(-1, 100)).toBeNull();
    expect(computeMomentum(100, -1)).toBeNull();
  });

  it("clampStrengthFromMomentum = min(|m|/0.10, 1.0)", () => {
    expect(clampStrengthFromMomentum(0)).toBe(0);
    expect(clampStrengthFromMomentum(0.1)).toBeCloseTo(1, 10);
    expect(clampStrengthFromMomentum(0.05)).toBeCloseTo(0.5, 10);
    expect(clampStrengthFromMomentum(0.5)).toBe(1);
    expect(clampStrengthFromMomentum(-0.05)).toBe(0);
    expect(clampStrengthFromMomentum(NaN)).toBe(0);
    expect(clampStrengthFromMomentum(Infinity)).toBe(1);
  });

  it("recordClose: lead symbol computes momentum and emits LONG on +threshold cross", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 20,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    // Feed 20 closes at 100, then close at 110 -> momentum = +10% > +5%.
    for (let index = 0; index < 20; index++) p.recordClose("BTC/USDT", 100);
    const emitted = p.recordClose("BTC/USDT", 110);
    expect(emitted.length).toBe(2); // BTC + ETH
    expect(p.currentPosition()).toBe("long");
    expect(p.state.longEmissions).toBe(1);
    expect(p.state.flatEmissions).toBe(0);
  });

  it("recordClose: lead symbol emits FLAT on -threshold cross", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 20,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 20; index++) p.recordClose("BTC/USDT", 100);
    p.recordClose("BTC/USDT", 110); // enter long
    expect(p.currentPosition()).toBe("long");
    // Now drop to 85 -> momentum = -15%.
    const emitted = p.recordClose("BTC/USDT", 85);
    expect(emitted.length).toBe(2);
    expect(p.currentPosition()).toBe("flat");
    expect(p.state.flatEmissions).toBe(1);
  });

  it("recordClose: deadzone |m| <= threshold emits nothing", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 20,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 20; index++) p.recordClose("BTC/USDT", 100);
    // +3% momentum (in deadzone).
    const emitted = p.recordClose("BTC/USDT", 103);
    expect(emitted.length).toBe(0);
    expect(p.state.longEmissions).toBe(0);
  });

  it("recordClose: non-lead symbol does not trigger emission (telemetry only)", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 20,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 20; index++) p.recordClose("BTC/USDT", 100);
    // Feed ETH (non-lead) with 1000 -> +900% but it's non-lead.
    const emitted = p.recordClose("ETH/USDT", 1000);
    expect(emitted.length).toBe(0);
    expect(p.state.longEmissions).toBe(0);
    expect(p.state.nonLeadClosesReceived).toBe(1);
  });

  it("recordClose: non-finite close increments malformedCloseDrops", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    p.subscribe(new SignalBus());
    const before = p.state.malformedCloseDrops;
    p.recordClose("BTC/USDT", NaN);
    p.recordClose("BTC/USDT", 0);
    p.recordClose("BTC/USDT", -1);
    p.recordClose("BTC/USDT", Infinity);
    expect(p.state.malformedCloseDrops).toBe(before + 4);
  });

  it("recordClose: insufficient history (< lookbackDays + 1) emits nothing", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 20,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 19; index++) p.recordClose("BTC/USDT", 100);
    expect(p.recordClose("BTC/USDT", 1000).length).toBe(0);
  });

  it("recordClose: idempotent — repeat same momentum direction does not re-emit", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 20,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 20; index++) p.recordClose("BTC/USDT", 100);
    p.recordClose("BTC/USDT", 110); // enter long
    expect(p.state.longEmissions).toBe(1);
    p.recordClose("BTC/USDT", 115);
    p.recordClose("BTC/USDT", 120);
    expect(p.state.longEmissions).toBe(1);
  });

  it("recordClose: strength = |momentum| / 0.10 capped at 1.0", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 20,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 20; index++) p.recordClose("BTC/USDT", 100);
    const emitted = p.recordClose("BTC/USDT", 130); // +30% -> capped at 1.0
    expect(emitted.length).toBe(2);
    expect(emitted.at(0)?.strength).toBe(1);
    expect(p.state.lastStrength).toBe(1);
  });

  it("bus emit routes to subscribers (direction kind)", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 20,
      momentumThreshold: 0.05,
    });
    const bus = new SignalBus();
    const received: { side: string; strength: number; source: string }[] = [];
    bus.subscribe("direction", (signal) => {
      if (isDirection(signal)) {
        received.push({ side: signal.side, strength: signal.strength, source: signal.source });
      }
    });
    p.subscribe(bus);
    for (let index = 0; index < 20; index++) p.recordClose("BTC/USDT", 100);
    p.recordClose("BTC/USDT", 110);
    expect(received.length).toBe(1);
    expect(received.at(0)?.source).toBe("cross-symbol-momentum-overlay-v1");
  });

  it("subscribe calls _assertInitialState (Layer 2)", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    const bus = new SignalBus();
    p.subscribe(bus);
    expect(p.wiredBuses().size).toBe(1);
  });

  it("_assertInitialState throws on missing config", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({ enabledSymbols: ["ETH/USDT"] });
    expect(() => {
      p.subscribe(new SignalBus());
    }).not.toThrow();
  });

  it("onBar increments barsProcessed", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    p.subscribe(new SignalBus());
    p.onBar(makeBar(), {});
    p.onBar(makeBar(), {});
    p.onBar(makeBar(), {});
    expect(p.state.barsProcessed).toBe(3);
  });

  it("reset() clears all state", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    p.subscribe(new SignalBus());
    p.recordClose("BTC/USDT", 100);
    p.state.barsProcessed = 5;
    p.reset();
    expect(p.state.barsProcessed).toBe(0);
    expect(p.state.symbolState.size).toBe(0);
    expect(p.state.position).toBe("flat");
    expect(p.state.lastMomentum).toBeNull();
  });

  it("dispose() releases bus references", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    const bus = new SignalBus();
    let received = 0;
    bus.subscribe("direction", () => {
      received += 1;
    });
    p.subscribe(bus);
    expect(p.wiredBuses().size).toBe(1);
    p.dispose();
    expect(p.wiredBuses().size).toBe(0);
    expect(received).toBe(0);
  });

  it("validateConfig: undefined is ok, non-object rejected, bad fields rejected", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    const url = new URL("https://example.invalid");
    const rawNullConfig = url.searchParams.get("missing");
    expect(p.validateConfig(rawNullConfig).ok).toBe(true);
    expect(p.validateConfig("not-object").ok).toBe(false);
    expect(p.validateConfig({ lookbackDays: 0 }).ok).toBe(false);
    expect(p.validateConfig({ lookbackDays: 100 }).ok).toBe(true);
    expect(p.validateConfig({ momentumThreshold: -1 }).ok).toBe(false);
    expect(p.validateConfig({ baseNotionalUsd: -1 }).ok).toBe(false);
    expect(p.validateConfig({ enabledSymbols: [] }).ok).toBe(false);
    expect(p.validateConfig({ enabledSymbols: ["X"] }).ok).toBe(true);
  });

  it("effectiveMaxNotionalUsd = baseNotionalUsd * 10", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({ baseNotionalUsd: 25_000 });
    expect(p.effectiveMaxNotionalUsd()).toBe(250_000);
  });

  it("leadSymbol + enabledSymbolsList accessors", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    expect(p.leadSymbol()).toBe("BTC/USDT");
    expect(p.enabledSymbolsList().length).toBe(2);
  });

  it("currentPosition + lastMomentumValue accessors", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 5,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    expect(p.currentPosition()).toBe("flat");
    expect(p.lastMomentumValue()).toBeNull();
    for (let index = 0; index < 5; index++) p.recordClose("BTC/USDT", 100);
    p.recordClose("BTC/USDT", 110);
    expect(p.currentPosition()).toBe("long");
    expect(p.lastMomentumValue()).toBeCloseTo(0.1, 10);
  });

  it("ADVERSARIAL: momentum = 0.5 (very large) emits strength = 1.0 (capped)", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 10,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 10; index++) p.recordClose("BTC/USDT", 100);
    const emitted = p.recordClose("BTC/USDT", 150); // +50%
    expect(emitted.at(0)?.strength).toBe(1);
  });

  it("ADVERSARIAL: malformed payload (NaN, 0, negative, Infinity) all dropped", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    p.subscribe(new SignalBus());
    const before = p.state.malformedCloseDrops;
    p.recordClose("BTC/USDT", NaN);
    p.recordClose("BTC/USDT", 0);
    p.recordClose("BTC/USDT", -1);
    p.recordClose("BTC/USDT", Infinity);
    expect(p.state.malformedCloseDrops).toBe(before + 4);
  });

  it("ADVERSARIAL: many rapid flips trigger no leverage violation", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 5,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let index = 0; index < 5; index++) p.recordClose("BTC/USDT", 100);
      p.recordClose("BTC/USDT", 120); // long
      for (let index = 0; index < 5; index++) p.recordClose("BTC/USDT", 100);
      p.recordClose("BTC/USDT", 80); // flat
    }
    expect(p.state.leverageClampCount).toBe(0);
  });

  it("ADVERSARIAL: deadzone crossing transition (long -> flat -> long)", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 10,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 10; index++) p.recordClose("BTC/USDT", 100);
    p.recordClose("BTC/USDT", 110); // long
    expect(p.currentPosition()).toBe("long");
    // Push to +3% (deadzone) -> no emission.
    p.recordClose("BTC/USDT", 103);
    expect(p.currentPosition()).toBe("long");
    expect(p.state.longEmissions).toBe(1);
    // Push below -5% -> flat.
    p.recordClose("BTC/USDT", 90);
    expect(p.currentPosition()).toBe("flat");
    expect(p.state.flatEmissions).toBe(1);
  });

  it("ADVERSARIAL: empty enabledSymbols throws at construction", () => {
    expect(() => new CrossSymbolMomentumOverlayPlugin({ enabledSymbols: [] })).toThrow(
      /enabledSymbols must be a non-empty/,
    );
  });

  it("Layer 2 1:10 defense: per-emit assertion runs", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 5,
      momentumThreshold: 0.05,
    });
    p.subscribe(new SignalBus());
    const before = p.state.layer2AssertionCount;
    for (let index = 0; index < 5; index++) p.recordClose("BTC/USDT", 100);
    p.recordClose("BTC/USDT", 120);
    expect(p.state.layer2AssertionCount).toBeGreaterThan(before);
  });

  it("factory createCrossSymbolMomentumOverlayPlugin produces same result as `new`", () => {
    const p1 = createCrossSymbolMomentumOverlayPlugin({ lookbackDays: 30 });
    const p2 = new CrossSymbolMomentumOverlayPlugin({ lookbackDays: 30 });
    expect(p1.config.lookbackDays).toBe(p2.config.lookbackDays);
    expect(p1.metadata.name).toBe(p2.metadata.name);
  });

  it("single-symbol enabledSymbols list (only lead) is valid", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 5,
      enabledSymbols: ["BTC/USDT"],
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 5; index++) p.recordClose("BTC/USDT", 100);
    const emitted = p.recordClose("BTC/USDT", 120);
    expect(emitted.length).toBe(1);
    expect(emitted.at(0)?.side).toBe("long");
  });

  it("multi-symbol enabledSymbols list emits per leg", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 5,
      enabledSymbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 5; index++) p.recordClose("BTC/USDT", 100);
    const emitted = p.recordClose("BTC/USDT", 120);
    expect(emitted.length).toBe(3);
    expect(emitted.every((signal) => signal.side === "long")).toBe(true);
  });

  it("MOMENTUM_NORMALIZER = 0.10 constant", () => {
    expect(MOMENTUM_NORMALIZER).toBe(0.1);
  });

  it("recordClose at threshold boundary: just below -> no emission", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 10,
      momentumThreshold: 0.1,
    });
    p.subscribe(new SignalBus());
    for (let index = 0; index < 10; index++) p.recordClose("BTC/USDT", 100);
    const emitted = p.recordClose("BTC/USDT", 105);
    expect(emitted.length).toBe(0);
    expect(p.state.longEmissions).toBe(0);
  });

  it("subscribeBuses routes exactly one symbol-bearing signal to each target bus", () => {
    const p = new CrossSymbolMomentumOverlayPlugin({
      lookbackDays: 10,
      momentumThreshold: 0.05,
      enabledSymbols: ["BTC/USDT", "ETH/USDT"],
    });
    const btcBus = new SignalBus();
    const ethBus = new SignalBus();
    const btcDirections: { side: string; strength: number }[] = [];
    const ethDirections: { side: string; strength: number }[] = [];
    btcBus.subscribe("direction", (signal) => {
      if (isDirection(signal)) btcDirections.push({ side: signal.side, strength: signal.strength });
    });
    ethBus.subscribe("direction", (signal) => {
      if (isDirection(signal)) ethDirections.push({ side: signal.side, strength: signal.strength });
    });
    p.subscribeBuses(
      new Map([
        ["BTC/USDT", btcBus],
        ["ETH/USDT", ethBus],
      ]),
    );
    // Generate +20% BTC momentum to cross threshold.
    for (let index = 0; index < 10; index++) p.recordClose("BTC/USDT", 100);
    p.recordClose("BTC/USDT", 120);
    expect(btcDirections.length).toBe(1);
    expect(ethDirections.length).toBe(1);
    expect(btcDirections.every((direction) => direction.side === "long")).toBe(true);
    expect(ethDirections.every((direction) => direction.side === "long")).toBe(true);
  });

  it("subscribeBuses rejects empty map", () => {
    const p = new CrossSymbolMomentumOverlayPlugin();
    expect(() => {
      p.subscribeBuses(new Map());
    }).toThrow(/at least one/);
  });
});
