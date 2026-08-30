import { describe, expect, test } from "bun:test";

import {
  createSignalBus,
  DEFAULT_DECISION_ENGINE_CONFIG,
  DEFENSIVE_PLUGIN_NAMES,
  DecisionEngine,
} from "./index.js";
import type { DirectionSignal } from "./index.js";

function directionSignal() {
  return {
    kind: "direction",
    side: "long",
    source: "test",
    strength: 0.8,
    timestampMs: 1_700_000_000_000,
  } satisfies DirectionSignal;
}

describe("core public portfolio DecisionEngine API", () => {
  test("reports an undefined cache miss through the root barrel", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });

    expect(engine.latestDecision("BTCUSDT")).toBeUndefined();
  });

  test("reports an undefined synthesize miss through the root barrel", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });

    expect(engine.synthesize("BTCUSDT", 1_700_000_000_000)).toBeUndefined();
  });

  test("defaultWeight = 1.0", () => {
    expect(DEFAULT_DECISION_ENGINE_CONFIG.defaultWeight).toBe(1);
  });

  test("defensiveWeight = 2.0", () => {
    expect(DEFAULT_DECISION_ENGINE_CONFIG.defensiveWeight).toBe(2);
  });

  test("minConsensusStrength = 0.3", () => {
    expect(DEFAULT_DECISION_ENGINE_CONFIG.minConsensusStrength).toBe(0.3);
  });

  test("maxNotionalPerSymbolUsd = 10_000", () => {
    expect(DEFAULT_DECISION_ENGINE_CONFIG.maxNotionalPerSymbolUsd).toBe(10_000);
  });

  test("tartalmazza a regime-detector-meta prefixet", () => {
    expect(DEFENSIVE_PLUGIN_NAMES).toContain("regime-detector-meta");
  });

  test("tartalmazza a perpdex-liquidation-signals prefixet", () => {
    expect(DEFENSIVE_PLUGIN_NAMES).toContain("perpdex-liquidation-signals");
  });

  test("tartalmazza a sol-flip-kill-switch prefixet", () => {
    expect(DEFENSIVE_PLUGIN_NAMES).toContain("sol-flip-kill-switch");
  });

  test("tartalmazza a funding-flip-kill-switch prefixet", () => {
    expect(DEFENSIVE_PLUGIN_NAMES).toContain("funding-flip-kill-switch");
  });

  test("kezdeti decisions() üres tömb", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    expect(engine.decisions()).toEqual([]);
  });

  test("latestDecision() undefined ha nincs döntés", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    expect(engine.latestDecision("BTCUSDT")).toBeUndefined();
  });

  test("reset() törli a decisions listát", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const bus = createSignalBus();
    engine.subscribe(bus);
    bus.emit(directionSignal());
    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    expect(decision).not.toBeNull();
    expect(engine.decisions().length).toBe(1);

    engine.reset();
    expect(engine.decisions().length).toBe(0);
    expect(engine.latestDecision("BTCUSDT")).toBeUndefined();
  });
});
