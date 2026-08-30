import { describe, expect, test } from "bun:test";
import type {
  CarrySignal,
  DirectionSignal,
  FactorSignal,
  FundingSnapshotSignal,
  RiskSignal,
  SizingSignal,
} from "../index.js";
import { DecisionEngine, type DecisionEngineConfig } from "./portfolio-decision.js";
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
    source,
    regime,
    fundingRate: 0.0001,
    timestampMs,
  };
}

/**
 * `mkSizingSignal` — készít egy SizingSignal tesztpéldányt.
 */
function mkSizingSignal(
  source: string,
  notional: number,
  volMultiplier = 1,
  timestampMs = 1_700_000_000_000,
): SizingSignal {
  return {
    kind: "sizing",
    source,
    notional,
    volMultiplier,
    kellyFraction: 0.05,
    timestampMs,
  };
}

// ---------------------------------------------------------------------------
// 4. `DecisionEngine` konstruktor — config validáció
// ---------------------------------------------------------------------------

describe("DecisionEngine konstruktor", () => {
  test("happy path: symbol + default config", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    expect(engine.symbol).toBe("BTCUSDT");
    expect(engine.config.defaultWeight).toBe(1);
    expect(engine.config.defensiveWeight).toBe(2);
  });

  test("egyedi config felülírja a defaultot", () => {
    const config: Partial<DecisionEngineConfig> = {
      defaultWeight: 2.5,
      defensiveWeight: 5,
      minConsensusStrength: 0.5,
      maxNotionalPerSymbolUsd: 50_000,
    };
    const engine = new DecisionEngine({ symbol: "ETHUSDT", ...config });
    expect(engine.config.defaultWeight).toBe(2.5);
    expect(engine.config.defensiveWeight).toBe(5);
    expect(engine.config.minConsensusStrength).toBe(0.5);
    expect(engine.config.maxNotionalPerSymbolUsd).toBe(50_000);
  });

  test("defaultWeight <= 0 → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", defaultWeight: 0 })).toThrow(
      /defaultWeight must be positive finite/,
    );
  });

  test("defaultWeight = NaN → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", defaultWeight: NaN })).toThrow(
      /defaultWeight must be positive finite/,
    );
  });

  test("defaultWeight = Infinity → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", defaultWeight: Infinity })).toThrow(
      /defaultWeight must be positive finite/,
    );
  });

  test("defaultWeight = -1 → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", defaultWeight: -1 })).toThrow(
      /defaultWeight must be positive finite/,
    );
  });

  test("defensiveWeight <= 0 → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", defensiveWeight: -0.5 })).toThrow(
      /defensiveWeight must be positive finite/,
    );
  });

  test("defensiveWeight = NaN → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", defensiveWeight: NaN })).toThrow(
      /defensiveWeight must be positive finite/,
    );
  });

  test("minConsensusStrength < 0 → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", minConsensusStrength: -0.1 })).toThrow(
      /minConsensusStrength must be in/,
    );
  });

  test("minConsensusStrength > 1 → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", minConsensusStrength: 1.5 })).toThrow(
      /minConsensusStrength must be in/,
    );
  });

  test("minConsensusStrength = NaN → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", minConsensusStrength: NaN })).toThrow(
      /minConsensusStrength must be in/,
    );
  });

  test("maxNotionalPerSymbolUsd <= 0 → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", maxNotionalPerSymbolUsd: 0 })).toThrow(
      /maxNotionalPerSymbolUsd must be positive finite/,
    );
  });

  test("maxNotionalPerSymbolUsd = -1 → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", maxNotionalPerSymbolUsd: -1 })).toThrow(
      /maxNotionalPerSymbolUsd must be positive finite/,
    );
  });

  test("maxNotionalPerSymbolUsd = NaN → throw", () => {
    expect(() => new DecisionEngine({ symbol: "BTCUSDT", maxNotionalPerSymbolUsd: NaN })).toThrow(
      /maxNotionalPerSymbolUsd must be positive finite/,
    );
  });

  test("üres symbol → throw", () => {
    expect(() => new DecisionEngine({ symbol: "" })).toThrow(/symbol must be a non-empty string/);
  });

  test("symbol hossza ellenőrizve van (length === 0 fail)", () => {
    // Típuskényszerítéssel kikerüljük a típusrendszert.
    expect(() => new DecisionEngine({ symbol: "" })).toThrow(/symbol must be a non-empty string/);
  });
});

// ---------------------------------------------------------------------------
// 6. `DecisionEngine.subscribe()` — bus integráció
// ---------------------------------------------------------------------------

describe("DecisionEngine.subscribe", () => {
  test("visszaad egy unsubscribe függvényt", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
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
    expect(engine.synthesize("BTCUSDT", 1_700_000_000_001)).toBeUndefined();
  });

  test("többszöri unsubscribe hívás nem dob hibát (best-effort cleanup)", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    const unsub = engine.subscribe(bus);
    unsub();
    // Második hívás: a belső tömb már üres, de nem szabad, hogy dobjon.
    expect(() => {
      unsub();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. `DecisionEngine.synthesize()` — per-bar arbitráció
// ---------------------------------------------------------------------------

describe("DecisionEngine.synthesize", () => {
  test("nincs pending signal → undefined", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    expect(engine.synthesize("BTCUSDT", 1_700_000_000_000)).toBeUndefined();
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

    // Második synthesize, nincs új signal → undefined
    const d2 = engine.synthesize("BTCUSDT", 1_700_000_001_000);
    expect(d2).toBeUndefined();
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
    expect(engine.latestDecision("ETHUSDT")).toBeUndefined();
  });

  test("selects the most defensive sizing proposal and caps carry amplification", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);
    bus.emit(mkDirectionSignal("alpha", "long", 1));
    bus.emit(mkCarrySignal("carry-a", "high"));
    bus.emit(mkCarrySignal("carry-b", "high"));
    bus.emit(mkCarrySignal("carry-c", "high"));
    bus.emit(mkSizingSignal("sizer", 4000, 0.25));
    bus.emit(mkSizingSignal("defensive-sizer", 2500));

    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    expect(decision?.notionalUsd).toBe(2500);
  });

  test("keeps informational attribution while capping a short sizing proposal", async () => {
    const engine = new DecisionEngine({ maxNotionalPerSymbolUsd: 1000, symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);
    bus.emit(mkDirectionSignal("alpha", "short", 1));
    bus.emit(mkSizingSignal("sizer", 5000));
    bus.emit({
      factor: 0,
      kind: "factor",
      regime: "neutral",
      source: "factor-observer",
      symbol: "BTCUSDT",
      zScore: 0,
    } satisfies FactorSignal);
    bus.emit({
      asset: "BTCUSDT",
      by: 0,
      bz: 0,
      hl8h: 0,
      kind: "funding-snapshot",
      ok: 0,
      predictedGap: 0,
      source: "funding-observer",
      spreadMax: 0,
      timestamp: 1_700_000_000_000,
    } satisfies FundingSnapshotSignal);
    const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
    expect(decision?.notionalUsd).toBe(-1000);
    expect(decision?.sourceWeights).toMatchObject({ "factor-observer": 0, "funding-observer": 0 });
  });

  test("risk breach vagy close utasítás végrehajthatatlan irány helyett flat/0 döntést ad", async () => {
    for (const risk of [{ breach: true }, { breach: false, closeNotionalUsd: 1000 }] satisfies (Pick<
      RiskSignal,
      "breach"
    > &
      Partial<Pick<RiskSignal, "closeNotionalUsd">>)[]) {
      const engine = new DecisionEngine({ symbol: "BTCUSDT" });
      const { createSignalBus } = await import("../index.js");
      const bus = createSignalBus();
      engine.subscribe(bus);
      bus.emit(mkDirectionSignal("alpha", "long", 1));
      bus.emit(mkSizingSignal("sizer", 4000));
      bus.emit({
        kind: "risk",
        source: "risk-guard",
        symbol: "BTCUSDT",
        varDaily95: 0,
        correlationPenalty: 0,
        drawdownLimit: 0,
        ...risk,
      });

      const decision = engine.synthesize("BTCUSDT", 1_700_000_000_000);
      expect(decision?.side).toBe("flat");
      expect(decision?.notionalUsd).toBe(0);
    }
  });

  test("explicit symbol attribution prevents cross-symbol ingestion", async () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);
    bus.emit({ ...mkDirectionSignal("alpha", "long", 1), symbol: "ETHUSDT" });
    expect(engine.synthesize("BTCUSDT", 1_700_000_000_000)).toBeUndefined();
  });

  test("fails closed when an accepted signal discriminator changes before arbitration", async () => {
    let kind: "direction" | "unknown" = "direction";
    const signal = mkDirectionSignal("untrusted-source", "long", 1);
    Object.defineProperty(signal, "kind", { get: () => kind });
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const { createSignalBus } = await import("../index.js");
    const bus = createSignalBus();
    engine.subscribe(bus);
    bus.emit(signal);
    kind = "unknown";
    expect(() => engine.synthesize("BTCUSDT", 1_700_000_000_000)).toThrow(/Non-exhaustive Signal switch/);
  });
});

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

    expect(d?.sourceWeights["regime-detector-meta.A"]).toBeCloseTo(1, 5); // 2.0 × 0.5
  });
});
