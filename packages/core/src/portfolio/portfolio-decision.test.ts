// packages/core/src/portfolio/portfolio-decision.test.ts — Phase 35 Track I
//
// =========================================================================
// DECISION ENGINE + PORTFOLIO DECISION TESTS — 100% line+branch+function
// =========================================================================
//
// Ez a fájl kiegészíti a meglévő portfolio-orchestrator.test.ts tesztjeit
// azzal, hogy lefedi a portfolio-decision.ts önállóan exportált
// függvényeit és típusait — minden `assertExhaustiveSignal` hívást,
// minden konstruktor-validációt, minden config-defaultot, és a
// DecisionEngine arbitrációs lépéseit a portfolio-orchestrator
// integrációjától függetlenül.
//
// Lefedettségi cél:
//   - portfolio-decision.ts: 100% sor + 100% függvény
//   - Ez a fájl önmagában ~30 tesztet ad hozzá.
//
// =========================================================================

import { describe, expect, test } from "bun:test";

import type { CarrySignal, DirectionSignal, SizingSignal } from "../index.js";

import {
  assertExhaustiveSignal,
  DEFAULT_DECISION_ENGINE_CONFIG,
  DEFENSIVE_PLUGIN_NAMES,
  DecisionEngine,
  type DecisionEngineConfig,
  type PositionDecision,
} from "./portfolio-decision.js";

// ---------------------------------------------------------------------------
// Segédfüggvények — szintetikus signal építők
// ---------------------------------------------------------------------------

/**
 * `mkDirectionSignal` — készít egy DirectionSignal tesztpéldányt.
 */
function mkDirectionSignal(
  source: string,
  side: "long" | "short" | "flat",
  strength: number,
  timestampMs = 1_700_000_000_000,
): DirectionSignal {
  return {
    kind: "direction",
    symbol: "BTCUSDT",
    source,
    side,
    strength,
    timestampMs,
  };
}

/**
 * `mkCarrySignal` — készít egy CarrySignal tesztpéldányt.
 */
function mkCarrySignal(
  source: string,
  regime: "high" | "neutral" | "flip",
  timestampMs = 1_700_000_000_000,
): CarrySignal {
  return {
    kind: "carry",
    symbol: "BTCUSDT",
    source,
    regime,
    timestampMs,
  };
}

/**
 * `mkSizingSignal` — készít egy SizingSignal tesztpéldányt.
 */
function mkSizingSignal(
  source: string,
  notional: number,
  volMultiplier = 1.0,
  timestampMs = 1_700_000_000_000,
): SizingSignal {
  return {
    kind: "sizing",
    symbol: "BTCUSDT",
    source,
    notional,
    volMultiplier,
    timestampMs,
  };
}

// ---------------------------------------------------------------------------
// 1. `assertExhaustiveSignal` — compile-time guard, runtime hívás
// ---------------------------------------------------------------------------

describe("assertExhaustiveSignal", () => {
  test("dob egy Error-t, ha bármilyen értéket kap (never fallback)", () => {
    // A `never` típust kikerülve, 'as never' cast-tal hívjuk, hogy
    // a runtime throw ágat triggereljük.
    expect(() => assertExhaustiveSignal(undefined as never)).toThrow(
      /Non-exhaustive Signal switch/,
    );
  });

  test("a hibaüzenet tartalmazza az értéket (JSON.stringify)", () => {
    // A string értéket JSON.stringify formázza — ellenőrizzük, hogy
    // a hibaüzenet a kapott értéket tükrözi.
    const weird = { kind: "future-imaginary" } as never;
    let caught: Error | null = null;
    try {
      assertExhaustiveSignal(weird);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain("Non-exhaustive Signal switch");
    expect(caught?.message).toContain("future-imaginary");
  });

  test("szám típusú értéket is elfogad és JSON.stringify-vel formáz", () => {
    expect(() => assertExhaustiveSignal(42 as never)).toThrow(/42/);
  });
});

// ---------------------------------------------------------------------------
// 2. `DEFAULT_DECISION_ENGINE_CONFIG` — alapértelmezett értékek
// ---------------------------------------------------------------------------

describe("DEFAULT_DECISION_ENGINE_CONFIG", () => {
  test("defaultWeight = 1.0", () => {
    expect(DEFAULT_DECISION_ENGINE_CONFIG.defaultWeight).toBe(1.0);
  });

  test("defensiveWeight = 2.0", () => {
    expect(DEFAULT_DECISION_ENGINE_CONFIG.defensiveWeight).toBe(2.0);
  });

  test("minConsensusStrength = 0.3", () => {
    expect(DEFAULT_DECISION_ENGINE_CONFIG.minConsensusStrength).toBe(0.3);
  });

  test("maxNotionalPerSymbolUsd = 10_000", () => {
    expect(DEFAULT_DECISION_ENGINE_CONFIG.maxNotionalPerSymbolUsd).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// 3. `DEFENSIVE_PLUGIN_NAMES` — readonly tömb a defensive plugin prefixekkel
// ---------------------------------------------------------------------------

describe("DEFENSIVE_PLUGIN_NAMES", () => {
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
});

// ---------------------------------------------------------------------------
// 4. `DecisionEngine` konstruktor — config validáció
// ---------------------------------------------------------------------------

describe("DecisionEngine konstruktor", () => {
  test("happy path: symbol + default config", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    expect(engine.symbol).toBe("BTCUSDT");
    expect(engine.config.defaultWeight).toBe(1.0);
    expect(engine.config.defensiveWeight).toBe(2.0);
  });

  test("egyedi config felülírja a defaultot", () => {
    const cfg: Partial<DecisionEngineConfig> = {
      defaultWeight: 2.5,
      defensiveWeight: 5.0,
      minConsensusStrength: 0.5,
      maxNotionalPerSymbolUsd: 50_000,
    };
    const engine = new DecisionEngine({ symbol: "ETHUSDT", ...cfg });
    expect(engine.config.defaultWeight).toBe(2.5);
    expect(engine.config.defensiveWeight).toBe(5.0);
    expect(engine.config.minConsensusStrength).toBe(0.5);
    expect(engine.config.maxNotionalPerSymbolUsd).toBe(50_000);
  });

  test("defaultWeight <= 0 → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", defaultWeight: 0 }),
    ).toThrow(/defaultWeight must be positive finite/);
  });

  test("defaultWeight = NaN → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", defaultWeight: Number.NaN }),
    ).toThrow(/defaultWeight must be positive finite/);
  });

  test("defaultWeight = Infinity → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", defaultWeight: Number.POSITIVE_INFINITY }),
    ).toThrow(/defaultWeight must be positive finite/);
  });

  test("defaultWeight = -1 → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", defaultWeight: -1 }),
    ).toThrow(/defaultWeight must be positive finite/);
  });

  test("defensiveWeight <= 0 → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", defensiveWeight: -0.5 }),
    ).toThrow(/defensiveWeight must be positive finite/);
  });

  test("defensiveWeight = NaN → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", defensiveWeight: Number.NaN }),
    ).toThrow(/defensiveWeight must be positive finite/);
  });

  test("minConsensusStrength < 0 → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", minConsensusStrength: -0.1 }),
    ).toThrow(/minConsensusStrength must be in/);
  });

  test("minConsensusStrength > 1 → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", minConsensusStrength: 1.5 }),
    ).toThrow(/minConsensusStrength must be in/);
  });

  test("minConsensusStrength = NaN → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", minConsensusStrength: Number.NaN }),
    ).toThrow(/minConsensusStrength must be in/);
  });

  test("maxNotionalPerSymbolUsd <= 0 → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", maxNotionalPerSymbolUsd: 0 }),
    ).toThrow(/maxNotionalPerSymbolUsd must be positive finite/);
  });

  test("maxNotionalPerSymbolUsd = -1 → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", maxNotionalPerSymbolUsd: -1 }),
    ).toThrow(/maxNotionalPerSymbolUsd must be positive finite/);
  });

  test("maxNotionalPerSymbolUsd = NaN → throw", () => {
    expect(
      () => new DecisionEngine({ symbol: "BTCUSDT", maxNotionalPerSymbolUsd: Number.NaN }),
    ).toThrow(/maxNotionalPerSymbolUsd must be positive finite/);
  });

  test("üres symbol → throw", () => {
    expect(() => new DecisionEngine({ symbol: "" })).toThrow(/symbol must be a non-empty string/);
  });

  test("symbol hossza ellenőrizve van (length === 0 fail)", () => {
    // Típuskényszerítéssel kikerüljük a típusrendszert.
    expect(() => new DecisionEngine({ symbol: "" as string })).toThrow(
      /symbol must be a non-empty string/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. `DecisionEngine.decisions()` / `latestDecision()` / `reset()`
// ---------------------------------------------------------------------------

describe("DecisionEngine state accessors", () => {
  test("kezdeti decisions() üres tömb", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    expect(engine.decisions()).toEqual([]);
  });

  test("latestDecision() null ha nincs döntés", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    expect(engine.latestDecision("BTCUSDT")).toBeNull();
  });

  test("reset() törli a decisions listát", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });

    // Bus nélkül is tudunk jelet ingest-elni a privát metóduson
    // keresztül: subscribe + bus.dispatchSequence.
    const bus = (await import("../index.js")).createSignalBus();
    engine.subscribe(bus);
    bus.emit(mkDirectionSignal("test", "long", 0.8));
    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    expect(decision).not.toBeNull();
    expect(engine.decisions().length).toBe(1);

    engine.reset();
    expect(engine.decisions().length).toBe(0);
    expect(engine.latestDecision("BTCUSDT")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. `DecisionEngine.subscribe()` — bus integráció
// ---------------------------------------------------------------------------

describe("DecisionEngine.subscribe", () => {
  test("visszaad egy unsubscribe függvényt", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const bus = (() => {
      const { createSignalBus } = require("../index.js");
      return createSignalBus();
    })();
    const unsub = engine.subscribe(bus);
    expect(typeof unsub).toBe("function");
    unsub();
  });

  test("subscribe után ingesteli a direction jelet", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);

    bus.emit(mkDirectionSignal("plugin-A", "long", 0.9));
    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    expect(decision).not.toBeNull();
    expect(decision?.side).toBe("long");
  });

  test("subscribe után ingesteli a carry jelet", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);

    bus.emit(mkCarrySignal("carry-plugin", "high"));
    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    // A carry signal nem ad irány-szavazatot → side flat
    expect(decision).not.toBeNull();
    expect(decision?.side).toBe("flat");
  });

  test("subscribe után ingesteli a sizing jelet", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);

    bus.emit(mkSizingSignal("sizer", 5000));
    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    // Csak sizing → side flat, de a notional a sizingből jön
    expect(decision).not.toBeNull();
    expect(decision?.side).toBe("flat");
  });

  test("unsubscribe leállítja a jelfeldolgozást", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    const unsub = engine.subscribe(bus);

    bus.emit(mkDirectionSignal("plugin-A", "long", 0.9));
    expect(engine.synthesize("BTCUSDT", 1_700_000_000_000)).not.toBeNull();

    unsub();
    // Az unsubscribe után publish → nincs ingest
    bus.emit(mkDirectionSignal("plugin-B", "short", 0.9));
    expect(engine.synthesize("BTCUSDT", 1_700_000_000_001)).toBeNull();
  });

  test("többszöri unsubscribe hívás nem dob hibát (best-effort cleanup)", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = require("../index.js");
    const bus = createSignalBus();
    const unsub = engine.subscribe(bus);
    unsub();
    // Második hívás: a belső tömb már üres, de nem szabad, hogy dobjon.
    expect(() => unsub()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. `DecisionEngine.synthesize()` — per-bar arbitráció
// ---------------------------------------------------------------------------

describe("DecisionEngine.synthesize", () => {
  test("nincs pending signal → null", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    expect(engine.synthesize("BTCUSDT", 1_700_000_000_000)).toBeNull();
  });

  test("egyetlen long direction signal → side = long", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);
    bus.emit(mkDirectionSignal("plugin-A", "long", 0.8));

    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    expect(decision?.side).toBe("long");
    expect(decision?.symbol).toBe("BTCUSDT");
    expect(decision?.timestampMs).toBe(1_700_000_000_000);
  });

  test("egyetlen short direction signal → side = short", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);
    bus.emit(mkDirectionSignal("plugin-A", "short", 0.8));

    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    expect(decision?.side).toBe("short");
  });

  test("flat direction signal → side = flat", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);
    bus.emit(mkDirectionSignal("plugin-A", "flat", 0.8));

    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    expect(decision?.side).toBe("flat");
  });

  test("többszöri hívás: pending cleared, decisions lista bővül", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);

    bus.emit(mkDirectionSignal("plugin-A", "long", 0.8));
    const d1 = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    expect(d1).not.toBeNull();
    expect(engine.decisions().length).toBe(1);

    // Második synthesize, nincs új signal → null
    const d2 = engine.synthesize("BTCUSDT", 1_700_000_001_000);
    expect(d2).toBeNull();
    expect(engine.decisions().length).toBe(1);
  });

  test("latestDecision(symbol) visszaadja a legutóbbi döntést", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);

    bus.emit(mkDirectionSignal("plugin-A", "long", 0.8));
    engine.synthesize("BTCUSDT", 1_700_000_000_000);
    bus.emit(mkDirectionSignal("plugin-B", "short", 0.9));
    engine.synthesize("BTCUSDT", 1_700_000_001_000);

    const latest = engine.latestDecision("BTCUSDT");
    expect(latest).not.toBeNull();
    expect(latest?.timestampMs).toBe(1_700_000_001_000);
  });
});

// ---------------------------------------------------------------------------
// 8. PositionDecision shape — típusellenőrzés
// ---------------------------------------------------------------------------

describe("PositionDecision shape", () => {
  test("a position decision minden szükséges mezőt tartalmaz", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);

    bus.emit(mkDirectionSignal("plugin-A", "long", 0.8));
    bus.emit(mkSizingSignal("sizer", 1000));
    const d = engine.synthesize("BTCUSDT", 1_700_000_000_000);

    expect(d).toMatchObject({
      symbol: "BTCUSDT",
      side: "long",
      timestampMs: 1_700_000_000_000,
    });
    expect(typeof d?.notionalUsd).toBe("number");
    expect(typeof d?.sizeMultiplier).toBe("number");
    expect(typeof d?.confidence).toBe("number");
    expect(typeof d?.sourceWeights).toBe("object");
  });

  test("a defensive weight magasabb, mint a default (vote × 2)", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);

    // regime-detector-meta prefix egyezik → defensive weight = 2.0
    bus.emit(mkDirectionSignal("regime-detector-meta.A", "long", 0.5));
    const d = engine.synthesize("BTCUSDT", 1_700_000_000_000);

    expect(d?.sourceWeights["regime-detector-meta.A"]).toBeCloseTo(1.0, 5); // 2.0 × 0.5
  });
});
