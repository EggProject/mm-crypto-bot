// packages/core/src/signal-center/decision-engine.test.ts — Phase 13 Track A
//
// ===========================================================================
// DecisionEngine test suite (≥25 tests)
// ===========================================================================
//
// Coverage targets (100% lines + 100% branches on decision-engine.ts):
//   - Construction / config validation (4 tests)
//   - subscribe / unsubscribe lifecycle (3 tests)
//   - Direction arbitration: weighted vote + tie + tiebreak (5 tests)
//   - Carry regime multiplier application (4 tests)
//   - Risk signal size modifier (3 tests)
//   - Factor / funding-snapshot informational pass-through (2 tests)
//   - Min consensus threshold (2 tests)
//   - Per-symbol isolation (2 tests)
//   - reset() / decisions() / latestDecision() (3 tests)
//   - Exhaustive switch compile-time check via assertNever (1 test)
//   - Edge cases (empty bus, single signal, 3+ conflicting) (3 tests)
//
// Total: ≥32 tests.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { SignalBus } from "./signal-bus.js";
import {
  DEFAULT_DECISION_ENGINE_CONFIG,
  DEFENSIVE_PLUGIN_NAMES,
  DecisionEngine,
  assertNever,
  createDecisionEngine,
} from "./decision-engine.js";
import type {
  CarrySignal,
  DirectionSignal,
  FactorSignal,
  FundingSnapshotSignal,
  RiskSignal,
  Signal,
} from "./types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

/** Wire the engine to a fresh bus; return both. */
function wire(engine: DecisionEngine): SignalBus {
  const bus = mkBus();
  engine.subscribe(bus);
  return bus;
}

function dirSig(
  source: string,
  side: "long" | "short" | "flat",
  strength: number,
  timestampMs?: number,
): DirectionSignal {
  const base: DirectionSignal = {
    kind: "direction",
    source,
    side,
    strength,
  };
  return timestampMs === undefined ? base : { ...base, timestampMs };
}

function carrySig(
  source: string,
  regime: "high" | "neutral" | "flip",
  fundingRate = 0.0001,
  timestampMs?: number,
): CarrySignal {
  const base: CarrySignal = {
    kind: "carry",
    source,
    fundingRate,
    regime,
  };
  return timestampMs === undefined ? base : { ...base, timestampMs };
}

function riskSig(
  source: string,
  opts: {
    sizeModifier?: number;
    timestampMs?: number;
    breach?: boolean;
  } = {},
): RiskSignal {
  const base: RiskSignal = {
    kind: "risk",
    source,
    varDaily95: 0,
    correlationPenalty: 0,
    drawdownLimit: 1.0,
  };
  const merged: RiskSignal = {
    ...base,
    ...(opts.sizeModifier !== undefined
      ? { sizeModifier: opts.sizeModifier }
      : {}),
    ...(opts.breach !== undefined ? { breach: opts.breach } : {}),
    ...(opts.timestampMs !== undefined
      ? { timestampMs: opts.timestampMs }
      : {}),
  };
  return merged;
}

function factorSig(source: string, regime: "accumulation" | "neutral" | "distribution"): FactorSignal {
  return {
    kind: "factor",
    source,
    factor: 0.5,
    regime,
    zScore: 1.0,
  };
}

function fundingSnapSig(source: string, asset: string): FundingSnapshotSignal {
  return {
    kind: "funding-snapshot",
    source,
    asset,
    hl8h: 10,
    bz: 9,
    by: 11,
    ok: 8,
    spreadMax: 3,
    predictedGap: 1,
    timestamp: 1_700_000_000_000,
  };
}

// ---------------------------------------------------------------------------
// 1. Construction / config validation
// ---------------------------------------------------------------------------

describe("DecisionEngine — construction & config validation", () => {
  it("construction with default config succeeds", () => {
    const e = new DecisionEngine();
    expect(e.config.defaultWeight).toBe(1.0);
    expect(e.config.defensiveWeight).toBe(2.0);
    expect(e.config.minConsensusStrength).toBe(0.3);
    expect(e.config.maxNotionalPerSymbolUsd).toBe(10_000);
    expect(DEFAULT_DECISION_ENGINE_CONFIG.defaultWeight).toBe(1.0);
  });

  it("construction with overrides merges into defaults", () => {
    const e = new DecisionEngine({ minConsensusStrength: 0.5 });
    expect(e.config.minConsensusStrength).toBe(0.5);
    expect(e.config.defaultWeight).toBe(1.0);
    expect(e.config.maxNotionalPerSymbolUsd).toBe(10_000);
  });

  it("construction rejects non-finite defaultWeight", () => {
    expect(() => new DecisionEngine({ defaultWeight: Number.NaN })).toThrow(/defaultWeight/);
    expect(() => new DecisionEngine({ defaultWeight: -1 })).toThrow(/defaultWeight/);
  });

  it("construction rejects non-finite defensiveWeight", () => {
    expect(() => new DecisionEngine({ defensiveWeight: 0 })).toThrow(/defensiveWeight/);
  });

  it("construction rejects minConsensusStrength outside [0, 1]", () => {
    expect(() => new DecisionEngine({ minConsensusStrength: 1.5 })).toThrow(
      /minConsensusStrength/,
    );
    expect(() => new DecisionEngine({ minConsensusStrength: -0.1 })).toThrow(
      /minConsensusStrength/,
    );
  });

  it("construction rejects non-positive maxNotionalPerSymbolUsd", () => {
    expect(() => new DecisionEngine({ maxNotionalPerSymbolUsd: 0 })).toThrow(
      /maxNotionalPerSymbolUsd/,
    );
  });

  it("validateConfig returns ok for valid partial", () => {
    const e = new DecisionEngine();
    expect(e.validateConfig({ defaultWeight: 2.0 }).ok).toBe(true);
  });

  it("validateConfig returns error for non-object", () => {
    const e = new DecisionEngine();
    const r = e.validateConfig("not an object");
    expect(r.ok).toBe(false);
  });

  it("validateConfig returns error for invalid weight", () => {
    const e = new DecisionEngine();
    const r = e.validateConfig({ defaultWeight: -1 });
    expect(r.ok).toBe(false);
  });

  it("validateConfig accepts null/undefined (use defaults)", () => {
    const e = new DecisionEngine();
    expect(e.validateConfig(undefined).ok).toBe(true);
    expect(e.validateConfig(null).ok).toBe(true);
  });

  it("createDecisionEngine factory works", () => {
    const e = createDecisionEngine();
    expect(e).toBeInstanceOf(DecisionEngine);
  });

  it("DEFENSIVE_PLUGIN_NAMES contains the three documented defensive plugins", () => {
    expect(DEFENSIVE_PLUGIN_NAMES).toContain("regime-detector-v1");
    expect(DEFENSIVE_PLUGIN_NAMES).toContain("perpdex-liquidation-signals-v1");
    expect(DEFENSIVE_PLUGIN_NAMES).toContain("sol-flip-kill-switch");
  });
});

// ---------------------------------------------------------------------------
// 2. subscribe / unsubscribe lifecycle
// ---------------------------------------------------------------------------

describe("DecisionEngine — subscribe / unsubscribe lifecycle", () => {
  let engine: DecisionEngine;
  beforeEach(() => {
    engine = new DecisionEngine();
  });
  afterEach(() => {
    engine.dispose();
  });

  it("subscribe registers handlers for all 6 signal kinds", () => {
    const bus = mkBus();
    engine.subscribe(bus);
    expect(bus.subscribersForKind("direction")).toBeGreaterThan(0);
    expect(bus.subscribersForKind("carry")).toBeGreaterThan(0);
    expect(bus.subscribersForKind("sizing")).toBeGreaterThan(0);
    expect(bus.subscribersForKind("risk")).toBeGreaterThan(0);
    expect(bus.subscribersForKind("factor")).toBeGreaterThan(0);
    expect(bus.subscribersForKind("funding-snapshot")).toBeGreaterThan(0);
  });

  it("subscribe returns a function that detaches the engine", () => {
    const bus = mkBus();
    const unsub = engine.subscribe(bus);
    const before = bus.subscriberCount;
    expect(before).toBeGreaterThan(0);
    unsub();
    expect(bus.subscriberCount).toBe(before - 6);
  });

  it("dispose releases all subscriptions", () => {
    const bus = mkBus();
    engine.subscribe(bus);
    const before = bus.subscriberCount;
    engine.dispose();
    expect(bus.subscriberCount).toBe(before - 6);
  });
});

// ---------------------------------------------------------------------------
// 3. Direction arbitration: weighted vote + tie + tiebreak
// ---------------------------------------------------------------------------

describe("DecisionEngine — direction arbitration", () => {
  let engine: DecisionEngine;
  beforeEach(() => {
    engine = new DecisionEngine();
  });
  afterEach(() => {
    engine.dispose();
  });

  it("all-agree long → side='long', confidence > min consensus", () => {
    const bus = wire(engine);
    bus.emit(dirSig("directional-mtf-v1:BTC/USDT", "long", 1.0, 1000));
    bus.emit(dirSig("another-plugin:BTC/USDT", "long", 1.0, 1100));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("long");
    expect(d.confidence).toBe(1.0); // both agree → 100%
    expect(d.sourceWeights["directional-mtf-v1:BTC/USDT"]).toBe(1.0);
    expect(d.sourceWeights["another-plugin:BTC/USDT"]).toBe(1.0);
  });

  it("all-agree short → side='short'", () => {
    const bus = wire(engine);
    bus.emit(dirSig("directional-mtf-v1:BTC/USDT", "short", 1.0, 1000));
    bus.emit(dirSig("another-plugin:BTC/USDT", "short", 1.0, 1100));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("short");
    expect(d.confidence).toBe(1.0);
  });

  it("long+short conflict (weighted) → side='long' (weighted majority)", () => {
    const bus = wire(engine);
    // long: weight 1 × strength 1.0 = 1.0
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    // short: weight 1 × strength 0.5 = 0.5
    bus.emit(dirSig("b:BTC/USDT", "short", 0.5, 1100));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("long");
    expect(d.confidence).toBeGreaterThan(0);
  });

  it("defensive plugin weight 2.0 wins over default 1.0 on conflict", () => {
    const bus = wire(engine);
    // Defensive: weight 2 × strength 0.5 = 1.0
    bus.emit(dirSig("regime-detector-v1:BTC/USDT", "short", 0.5, 1000));
    // Default: weight 1 × strength 1.0 = 1.0
    bus.emit(dirSig("directional-mtf-v1:BTC/USDT", "long", 1.0, 1100));
    const d = engine.arbitrate("BTC/USDT");
    // Defensive shortScore = 1.0, default longScore = 1.0 → tie → flat
    expect(d.side).toBe("flat");
  });

  it("defensive plugin (high strength) wins decisively on conflict", () => {
    const bus = wire(engine);
    // Defensive: weight 2 × strength 0.9 = 1.8
    bus.emit(dirSig("perpdex-liquidation-signals-v1:BTC/USDT", "short", 0.9, 1000));
    // Default: weight 1 × strength 0.5 = 0.5
    bus.emit(dirSig("directional-mtf-v1:BTC/USDT", "long", 0.5, 1100));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("short");
  });

  it("tie resolution: equal long + short → flat (conservative)", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 0.5, 1000));
    bus.emit(dirSig("b:BTC/USDT", "short", 0.5, 1100));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("flat");
  });

  it("flat signal wins when no other directional signal present", () => {
    const bus = wire(engine);
    bus.emit(dirSig("directional-mtf-v1:BTC/USDT", "flat", 1.0, 1000));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("flat");
    expect(d.confidence).toBe(1.0);
  });

  it("weighted majority direction calculation is correct", () => {
    const bus = wire(engine);
    // Three long, two short
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(dirSig("b:BTC/USDT", "long", 0.8, 1100));
    bus.emit(dirSig("c:BTC/USDT", "long", 0.6, 1200));
    bus.emit(dirSig("d:BTC/USDT", "short", 0.5, 1300));
    bus.emit(dirSig("e:BTC/USDT", "short", 0.3, 1400));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("long");
    // Total weight = 5; longScore = 2.4; confidence = 2.4/5 = 0.48
    expect(d.confidence).toBeCloseTo(2.4 / 5, 5);
  });

  it("3+ conflicting signals → weighted majority wins", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(dirSig("b:BTC/USDT", "short", 0.9, 1100));
    bus.emit(dirSig("c:BTC/USDT", "flat", 0.5, 1200));
    bus.emit(dirSig("d:BTC/USDT", "long", 0.7, 1300));
    bus.emit(dirSig("e:BTC/USDT", "short", 0.3, 1400));
    const d = engine.arbitrate("BTC/USDT");
    // longScore = 1.0 + 0.7 = 1.7, shortScore = 0.9 + 0.3 = 1.2, flatScore = 0.5
    expect(d.side).toBe("long");
  });
});

// ---------------------------------------------------------------------------
// 4. Carry regime multiplier application
// ---------------------------------------------------------------------------

describe("DecisionEngine — carry regime multiplier", () => {
  let engine: DecisionEngine;
  beforeEach(() => {
    engine = new DecisionEngine();
  });
  afterEach(() => {
    engine.dispose();
  });

  it("high regime → sizeMultiplier scaled 1.2 (clamped to 1.0)", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(carrySig("b:BTC/USDT", "high", 0.0001, 1100));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.sizeMultiplier).toBe(1.0); // clamped
    expect(d.side).toBe("long");
  });

  it("neutral regime → sizeMultiplier = 1.0", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(carrySig("b:BTC/USDT", "neutral", 0.0001, 1100));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.sizeMultiplier).toBe(1.0);
  });

  it("flip regime → sizeMultiplier = 0.5", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(carrySig("b:BTC/USDT", "flip", -0.0001, 1100));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.sizeMultiplier).toBe(0.5);
  });

  it("multiple carry signals → most defensive wins (MIN multiplier)", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(carrySig("b:BTC/USDT", "high", 0.0001, 1100));
    bus.emit(carrySig("c:BTC/USDT", "flip", -0.0001, 1200));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.sizeMultiplier).toBe(0.5); // min(1.2, 0.5) clamped to [0,1]
  });
});

// ---------------------------------------------------------------------------
// 5. Risk signal size modifier
// ---------------------------------------------------------------------------

describe("DecisionEngine — risk signal size modifier", () => {
  let engine: DecisionEngine;
  beforeEach(() => {
    engine = new DecisionEngine();
  });
  afterEach(() => {
    engine.dispose();
  });

  it("risk signal sizeModifier=0.5 → applied to all decisions", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(riskSig("b:BTC/USDT", { sizeModifier: 0.5 }));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("long");
    expect(d.sizeMultiplier).toBe(0.5);
    expect(d.notionalUsd).toBe(5_000); // 10000 × 0.5
  });

  it("risk signal sizeModifier=1.0 (default) → no scale-down", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(riskSig("b:BTC/USDT", { sizeModifier: 1.0 }));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.sizeMultiplier).toBe(1.0);
  });

  it("multiple risk signals → most defensive wins (MIN)", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(riskSig("b:BTC/USDT", { sizeModifier: 0.8 }));
    bus.emit(riskSig("c:BTC/USDT", { sizeModifier: 0.3 }));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.sizeMultiplier).toBe(0.3);
  });

  it("risk signal without sizeModifier → no scale-down", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(riskSig("b:BTC/USDT"));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.sizeMultiplier).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// 6. Factor / funding-snapshot informational pass-through
// ---------------------------------------------------------------------------

describe("DecisionEngine — informational signal handling", () => {
  let engine: DecisionEngine;
  beforeEach(() => {
    engine = new DecisionEngine();
  });
  afterEach(() => {
    engine.dispose();
  });

  it("FactorSignal does NOT contribute to direction or size", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(factorSig("b:BTC/USDT", "accumulation"));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("long");
    expect(d.sizeMultiplier).toBe(1.0); // factor signal ignored
  });

  it("FundingSnapshotSignal does NOT contribute to direction or size", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "short", 1.0, 1000));
    bus.emit(fundingSnapSig("b:BTC/USDT", "BTC"));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("short");
    expect(d.sizeMultiplier).toBe(1.0);
  });

  it("factor + funding-snapshot counters increment on emit", () => {
    const bus = wire(engine);
    bus.emit(factorSig("a:BTC/USDT", "neutral"));
    bus.emit(fundingSnapSig("b:BTC/USDT", "BTC"));
    bus.emit(factorSig("a:BTC/USDT", "distribution"));
    expect(engine.state.factorSignalsReceived).toBe(2);
    expect(engine.state.fundingSnapshotSignalsReceived).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Min consensus threshold
// ---------------------------------------------------------------------------

describe("DecisionEngine — min consensus threshold", () => {
  let engine: DecisionEngine;
  beforeEach(() => {
    engine = new DecisionEngine({ minConsensusStrength: 0.5 });
  });
  afterEach(() => {
    engine.dispose();
  });

  it("below minConsensusStrength → flat (no commit)", () => {
    const bus = wire(engine);
    // weak long signal (strength 0.4 with weight 1.0 = 0.4 / 1.0 = 0.4 confidence)
    bus.emit(dirSig("a:BTC/USDT", "long", 0.4, 1000));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("flat");
    expect(d.notionalUsd).toBe(0);
  });

  it("at or above minConsensusStrength → executes the winning side", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("long");
    expect(d.notionalUsd).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// 8. Per-symbol isolation
// ---------------------------------------------------------------------------

describe("DecisionEngine — per-symbol isolation", () => {
  let engine: DecisionEngine;
  beforeEach(() => {
    engine = new DecisionEngine();
  });
  afterEach(() => {
    engine.dispose();
  });

  it("BTC decisions don't leak to ETH", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    // ETH has no signal — should be flat on arbitrate
    const ethD = engine.arbitrate("ETH/USDT");
    expect(ethD.side).toBe("flat");
    expect(ethD.notionalUsd).toBe(0);

    const btcD = engine.arbitrate("BTC/USDT");
    expect(btcD.side).toBe("long");
  });

  it("3 symbols arbitrated independently in arbitrateAll", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    bus.emit(dirSig("b:ETH/USDT", "short", 1.0, 1100));
    bus.emit(dirSig("c:SOL/USDT", "flat", 1.0, 1200));
    const decisions = engine.arbitrateAll();
    const sides: Record<string, string> = {};
    for (const d of decisions) sides[d.symbol] = d.side;
    expect(sides["BTC/USDT"]).toBe("long");
    expect(sides["ETH/USDT"]).toBe("short");
    expect(sides["SOL/USDT"]).toBe("flat");
  });
});

// ---------------------------------------------------------------------------
// 9. reset() / decisions() / latestDecision()
// ---------------------------------------------------------------------------

describe("DecisionEngine — reset / decision log / latest", () => {
  let engine: DecisionEngine;
  beforeEach(() => {
    engine = new DecisionEngine();
  });
  afterEach(() => {
    engine.dispose();
  });

  it("decisions() returns chronological list", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    engine.arbitrate("BTC/USDT");
    bus.emit(dirSig("a:ETH/USDT", "long", 1.0, 2000));
    engine.arbitrate("ETH/USDT");
    const decisions = engine.decisions();
    expect(decisions.length).toBe(2);
    expect(decisions[0]?.symbol).toBe("BTC/USDT");
    expect(decisions[1]?.symbol).toBe("ETH/USDT");
  });

  it("latestDecision(symbol) returns the most recent matching decision", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    engine.arbitrate("BTC/USDT");
    bus.emit(dirSig("a:ETH/USDT", "long", 1.0, 2000));
    engine.arbitrate("ETH/USDT");
    const latest = engine.latestDecision("BTC/USDT");
    expect(latest?.symbol).toBe("BTC/USDT");
    const none = engine.latestDecision("SOL/USDT");
    expect(none).toBeNull();
  });

  it("reset() clears all accumulators + decisions + counters", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    engine.arbitrate("BTC/USDT");
    expect(engine.decisions().length).toBe(1);
    engine.reset();
    expect(engine.decisions().length).toBe(0);
    expect(engine.state.directionSignalsReceived).toBe(0);
    expect(engine.state.arbitrateCallCount).toBe(0);
    expect(engine.accumulatorFor("BTC/USDT")).toBeNull();
  });

  it("accumulatorFor(symbol) returns the current snapshot", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 0.8, 1000));
    const acc = engine.accumulatorFor("BTC/USDT");
    expect(acc).not.toBeNull();
    expect(acc?.longScore).toBeCloseTo(0.8, 5);
    expect(acc?.totalWeight).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// 10. Edge cases
// ---------------------------------------------------------------------------

describe("DecisionEngine — edge cases", () => {
  let engine: DecisionEngine;
  beforeEach(() => {
    engine = new DecisionEngine();
  });
  afterEach(() => {
    engine.dispose();
  });

  it("empty bus → arbitrate returns flat with notionalUsd=0", () => {
    wire(engine);
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("flat");
    expect(d.notionalUsd).toBe(0);
    expect(d.confidence).toBe(0);
  });

  it("single signal → winner with confidence=1.0", () => {
    const bus = wire(engine);
    bus.emit(dirSig("only:BTC/USDT", "long", 1.0, 1000));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("long");
    expect(d.confidence).toBe(1.0);
  });

  it("sizeMultiplier is clamped to [0, maxNotionalPerSymbolUsd]", () => {
    const bus = wire(engine);
    bus.emit(dirSig("a:BTC/USDT", "long", 1.0, 1000));
    // Carry high gives 1.2, clamped to 1.0 in sizeMultiplier
    bus.emit(carrySig("b:BTC/USDT", "high", 0.0001, 1100));
    // Risk sizeModifier = 0.7
    bus.emit(riskSig("c:BTC/USDT", { sizeModifier: 0.7 }));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.sizeMultiplier).toBeLessThanOrEqual(1.0);
    expect(d.notionalUsd).toBeLessThanOrEqual(10_000);
    expect(d.notionalUsd).toBeGreaterThan(0);
  });

  it("notionalUsd is 0 when side is flat", () => {
    const bus = wire(engine);
    // weak long signal — confidence below 0.3 threshold → flat decision
    bus.emit(dirSig("a:BTC/USDT", "long", 0.1, 1000));
    const d = engine.arbitrate("BTC/USDT");
    expect(d.side).toBe("flat");
    expect(d.notionalUsd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Type exhaustiveness — assertNever
// ---------------------------------------------------------------------------

describe("DecisionEngine — assertNever helper", () => {
  it("assertNever throws on unknown value (runtime exhaustiveness check)", () => {
    // We can't construct an actual non-never type at runtime, but we
    // can verify the helper throws when called with any value.
    expect(() => assertNever(undefined as never)).toThrow(/Non-exhaustive/);
    expect(() => assertNever("hello" as never)).toThrow(/Non-exhaustive/);
    expect(() => assertNever(42 as never)).toThrow(/Non-exhaustive/);
  });

  it("compile-time exhaustiveness: assertNever is typed correctly", () => {
    // This test verifies the type narrowing contract at compile time.
    // We construct a discriminated union switch and verify assertNever
    // accepts the type system assertion that all branches are covered.
    type Color = "red" | "green" | "blue";
    function describe(c: Color): string {
      switch (c) {
        case "red":
          return "warm";
        case "green":
          return "cool";
        case "blue":
          return "cool";
        default:
          // assertNever here would fail to compile if a new Color were added.
          return assertNever(c);
      }
    }
    expect(describe("red")).toBe("warm");
    expect(describe("green")).toBe("cool");
  });
});

// ---------------------------------------------------------------------------
// 12. Determinism / reproducibility
// ---------------------------------------------------------------------------

describe("DecisionEngine — determinism", () => {
  it("same input sequence → same decision sequence", () => {
    const runOnce = () => {
      const engine = new DecisionEngine();
      const bus = wire(engine);
      const sequence: Signal[] = [
        dirSig("a:BTC/USDT", "long", 1.0, 1000),
        dirSig("b:BTC/USDT", "long", 0.5, 1100),
        carrySig("c:BTC/USDT", "neutral", 0.0001, 1200),
        riskSig("d:BTC/USDT", { sizeModifier: 0.8 }),
      ];
      for (const s of sequence) bus.emit(s);
      const decisions = engine.decisions();
      engine.dispose();
      return decisions;
    };
    const r1 = runOnce();
    const r2 = runOnce();
    expect(r1).toEqual(r2);
  });
});