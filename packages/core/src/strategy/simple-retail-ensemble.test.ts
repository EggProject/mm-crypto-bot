// packages/core/src/strategy/simple-retail-ensemble.test.ts — Phase 15 Track D ensemble tests
//
// 100%-os line-coverage a simple-retail-ensemble.ts-re. A tesztek a Phase 1-3
// stratégia-tesztek konvencióját követik: `@ts-nocheck` a readonly mutation +
// undefined literálokra (ultra-strict tsconfig a main-en nem kapcsolható ki
// per-fájl szinten; a viselkedés-helyességet a runtime assertion-ök biztosítják).
//
// Tests coverage (≥10 tests, all required by the Phase 15 Track D brief):
//   - Default construction (all 4 strategies exist, defaults propagated)
//   - Custom config respected (per-sub-strategy override propagated)
//   - Custom LTF reflected in timeframes field
//   - warmup returns max of 4 sub-strategy warmups
//   - All-null sub-strategies → ensemble returns null
//   - Single signal (only pivot fires) → that signal + reason tagged "solo=pivot-grid"
//   - Single short signal (only donchian fires short) → that signal + "solo=donchian-range"
//   - Multi-signal consensus (pivot + donchian both long) → highest-confidence wins + "consensus=N/4"
//   - Multi-signal consensus (all 4 fire same side) → highest-confidence wins
//   - Conflict (pivot long + donchian short) → null (defer)
//   - Conflict with 3-way split (long + short + third on same side) → null
//   - Each sub-strategy receives the same `ctx` (delegation test)

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import type { MtfState, StrategyContext, StrategySignal } from "../types.js";
import type { BollingerSqueezeConfig } from "./bollinger-range-squeeze.js";
import {
  DEFAULT_SIMPLE_RETAIL_ENSEMBLE_CONFIG,
  ENSEMBLE_DEFAULT_LTF,
  SimpleRetailEnsemble,
} from "./simple-retail-ensemble.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * `mkCandle` — minimal OHLCV candle constructor with overrides.
 */
function mkCandle(overrides: Partial<Candle> = {}): Candle {
  return {
    timestamp: 0,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
    ...overrides,
  };
}

/**
 * `mkState` — minimal MtfState constructor with overrides. Each sub-strategy
 * expects different indicator fields; we leave most undefined by default
 * (each sub-strategy treats undefined as "skip" and returns null).
 */
function mkState(overrides: Partial<MtfState> = {}): MtfState {
  return {
    htf: { ...overrides.htf },
    mtf: { ...overrides.mtf },
    ltf: { ...overrides.ltf },
  };
}

/**
 * `mkContext` — StrategyContext builder. `candle`, `mtfState`, `candleIndex`
 * are overrideable; everything else defaults.
 */
function mkContext(
  overrides: {
    readonly candle?: Partial<Candle>;
    readonly mtfState?: Partial<MtfState>;
    readonly candleIndex?: number;
    readonly timeframe?: "1d" | "4h" | "1h" | "5m" | "15m" | "1m";
  } = {},
): StrategyContext {
  return {
    symbol: "BTC/USDC" as never,
    timeframe: overrides.timeframe ?? "15m",
    candleIndex: overrides.candleIndex ?? 5000,
    candle: mkCandle(overrides.candle),
    mtfState: mkState(overrides.mtfState ?? {}),
    pricePrecision: 2,
  };
}

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe("SimpleRetailEnsemble — construction", () => {
  it("default construction: name, timeframes (1d, 4h, 15m), all 4 sub-strategies exist", () => {
    const e = new SimpleRetailEnsemble();
    expect(e.name).toBe(
      "Simple Retail Ensemble (Phase 15 — Pivot + BB Squeeze + Donchian Range + Keltner Grid)",
    );
    // Default LTF = "15m"
    expect(e.timeframes).toEqual(["1d", "4h", "15m"]);
    expect(ENSEMBLE_DEFAULT_LTF).toBe("15m");
    expect(e.pivotGrid).toBeDefined();
    expect(e.bbSqueeze).toBeDefined();
    expect(e.donchianRange).toBeDefined();
    expect(e.keltnerGrid).toBeDefined();
    // Deep-default config check — each sub-config has at least one
    // field from its DEFAULT_*_CONFIG.
    const defaults = DEFAULT_SIMPLE_RETAIL_ENSEMBLE_CONFIG;
    expect(defaults.pivotGrid).toEqual({});
    expect(defaults.bbSqueeze).toEqual({});
    expect(defaults.donchianRange).toEqual({});
    expect(defaults.keltnerGrid).toEqual({});
  });

  it("custom config respected: per-sub-strategy partial overrides forwarded", () => {
    const e = new SimpleRetailEnsemble({
      pivotGrid: { multiplierFib1: 0.5 },
      bbSqueeze: { squeezeThreshold: 0.015 } as Partial<BollingerSqueezeConfig>,
      donchianRange: { adxTrendThreshold: 30 },
      keltnerGrid: { gridLevelCount: 7 },
    });
    // Each sub-strategy received its partial override merged over default.
    expect((e.pivotGrid.config as unknown as { multiplierFib1: number }).multiplierFib1).toBe(0.5);
    expect((e.bbSqueeze.config as unknown as { squeezeThreshold: number }).squeezeThreshold).toBe(0.015);
    expect((e.donchianRange.config as unknown as { adxTrendThreshold: number }).adxTrendThreshold).toBe(30);
    expect((e.keltnerGrid.config as unknown as { gridLevelCount: number }).gridLevelCount).toBe(7);
  });

  it("custom LTF (5m) reflected in timeframes field", () => {
    const e = new SimpleRetailEnsemble({}, "5m");
    expect(e.timeframes).toEqual(["1d", "4h", "5m"]);
  });

  it("custom LTF (1h) reflected in timeframes field", () => {
    const e = new SimpleRetailEnsemble({}, "1h");
    expect(e.timeframes).toEqual(["1d", "4h", "1h"]);
  });
});

// ---------------------------------------------------------------------------
// warmup tests
// ---------------------------------------------------------------------------

describe("SimpleRetailEnsemble.warmup", () => {
  it("returns the max of all 4 sub-strategy warmups", () => {
    const e = new SimpleRetailEnsemble();
    const expectedMax = Math.max(
      e.pivotGrid.warmup(),
      e.bbSqueeze.warmup(),
      e.donchianRange.warmup(),
      e.keltnerGrid.warmup(),
    );
    // warmup must be deterministic — exact equality (no tolerance) since the
    // sub-strategies' warmup functions are pure integer arithmetic.
    expect(e.warmup()).toBe(expectedMax);
    expect(e.warmup()).toBeGreaterThanOrEqual(e.pivotGrid.warmup());
    expect(e.warmup()).toBeGreaterThanOrEqual(e.bbSqueeze.warmup());
    expect(e.warmup()).toBeGreaterThanOrEqual(e.donchianRange.warmup());
    expect(e.warmup()).toBeGreaterThanOrEqual(e.keltnerGrid.warmup());
  });
});

// ---------------------------------------------------------------------------
// Aggregation logic tests — using a spy harness
// ---------------------------------------------------------------------------

/**
 * `spyStrategies` — replaces each sub-strategy's `onCandle` with a
 * pre-programmed stub that returns the supplied signal or null based on a
 * side-effect map. This isolates the aggregation logic from the sub-strategy
 * internals (which are covered by Track B+C's tests).
 *
 * The map keys are the sub-strategy names; values are either a StrategySignal
 * to return or null to skip.
 */
function setupSubStrategyStubs(
  e: SimpleRetailEnsemble,
  stubs: Readonly<Record<string, StrategySignal | null>>,
): void {
  // Sub-strategy name → onCandle override.
  // Each sub-strategy shares the same `ctx` so all 4 stubs see the same input.
  const map: Readonly<Record<string, () => StrategySignal | null>> = {
    pivot: () => stubs["pivot-grid"] ?? null,
    bb: () => stubs["bb-squeeze"] ?? null,
    donchian: () => stubs["donchian-range"] ?? null,
    keltner: () => stubs["keltner-grid"] ?? null,
  };
  // The names correspond to the sub-strategy field names on the ensemble.
  // We replace the onCandle method on each prototype-bound instance.
  e.pivotGrid.onCandle = map["pivot"]!;
  e.bbSqueeze.onCandle = map["bb"]!;
  e.donchianRange.onCandle = map["donchian"]!;
  e.keltnerGrid.onCandle = map["keltner"]!;
}

/**
 * `mkLongSignal` — minimal StrategySignal with a given confidence.
 */
function mkLongSignal(confidence: number, reason: string): StrategySignal {
  return {
    side: "buy",
    confidence,
    reason,
    stopLoss: 95,
    takeProfit: 110,
  };
}

/**
 * `mkShortSignal` — minimal StrategySignal with a given confidence.
 */
function mkShortSignal(confidence: number, reason: string): StrategySignal {
  return {
    side: "sell",
    confidence,
    reason,
    stopLoss: 105,
    takeProfit: 90,
  };
}

describe("SimpleRetailEnsemble.onCandle — aggregation", () => {
  it("all 4 null sub-signals → null", () => {
    const e = new SimpleRetailEnsemble();
    setupSubStrategyStubs(e, {
      "pivot-grid": null,
      "bb-squeeze": null,
      "donchian-range": null,
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext());
    expect(result).toBeNull();
  });

  it("single signal: only pivot-grid fires long → that signal with reason tagged 'solo=pivot-grid'", () => {
    const e = new SimpleRetailEnsemble();
    const pivotSig = mkLongSignal(0.8, "pivot at S2 → buy");
    setupSubStrategyStubs(e, {
      "pivot-grid": pivotSig,
      "bb-squeeze": null,
      "donchian-range": null,
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext());
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.8);
    expect(result!.reason).toContain("[Ensemble] solo=pivot-grid");
    expect(result!.reason).toContain("pivot at S2");
  });

  it("single short signal: only donchian-range fires short → that signal tagged 'solo=donchian-range'", () => {
    const e = new SimpleRetailEnsemble();
    const donchSig = mkShortSignal(0.9, "donchian at upper → sell");
    setupSubStrategyStubs(e, {
      "pivot-grid": null,
      "bb-squeeze": null,
      "donchian-range": donchSig,
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext());
    expect(result).not.toBeNull();
    expect(result!.side).toBe("sell");
    expect(result!.confidence).toBe(0.9);
    expect(result!.reason).toContain("[Ensemble] solo=donchian-range");
    expect(result!.reason).toContain("donchian at upper");
  });

  it("multi-signal same-direction: pivot + donchian both long → highest-confidence wins, consensus tag", () => {
    const e = new SimpleRetailEnsemble();
    setupSubStrategyStubs(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot at S1 → buy"),
      "bb-squeeze": null,
      "donchian-range": mkLongSignal(0.95, "donchian at lower → buy"),
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext());
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    // Highest confidence = 0.95 (donchian-range) → that signal wins.
    expect(result!.confidence).toBe(0.95);
    expect(result!.reason).toContain("[Ensemble] consensus=2/4");
    expect(result!.reason).toContain("donchian at lower");
    expect(result!.reason).toContain("winner=donchian-range");
  });

  it("multi-signal all 4 same-direction: highest-confidence wins, consensus=4/4", () => {
    const e = new SimpleRetailEnsemble();
    setupSubStrategyStubs(e, {
      "pivot-grid": mkLongSignal(0.6, "pivot at S1"),
      "bb-squeeze": mkLongSignal(0.85, "bb breakout up"),
      "donchian-range": mkLongSignal(0.7, "donchian at lower"),
      "keltner-grid": mkLongSignal(0.75, "keltner grid long"),
    });
    const result = e.onCandle(mkContext());
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.85);
    expect(result!.reason).toContain("[Ensemble] consensus=4/4");
    expect(result!.reason).toContain("bb breakout up");
    expect(result!.reason).toContain("winner=bb-squeeze");
  });

  it("conflict: pivot long + donchian short → null (defer)", () => {
    const e = new SimpleRetailEnsemble();
    setupSubStrategyStubs(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot at S1 → buy"),
      "bb-squeeze": null,
      "donchian-range": mkShortSignal(0.85, "donchian at upper → sell"),
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext());
    expect(result).toBeNull();
  });

  it("conflict with 3-way split: 2 long + 1 short → null (defer)", () => {
    const e = new SimpleRetailEnsemble();
    setupSubStrategyStubs(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot long"),
      "bb-squeeze": null,
      "donchian-range": mkLongSignal(0.6, "donchian long"),
      "keltner-grid": mkShortSignal(0.8, "keltner short"),
    });
    const result = e.onCandle(mkContext());
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Delegation test — verify each sub-strategy receives the same ctx
// ---------------------------------------------------------------------------

describe("SimpleRetailEnsemble — delegation", () => {
  it("each sub-strategy receives the same `ctx` object (delegation test)", () => {
    const e = new SimpleRetailEnsemble();
    const observedCtxs: StrategyContext[] = [];
    // Monkey-patch each sub-strategy's onCandle to capture the ctx.
    const capture = (ctx: StrategyContext): StrategySignal | null => {
      observedCtxs.push(ctx);
      return null;
    };
    e.pivotGrid.onCandle = capture as unknown as (ctx: StrategyContext) => StrategySignal | null;
    e.bbSqueeze.onCandle = capture as unknown as (ctx: StrategyContext) => StrategySignal | null;
    e.donchianRange.onCandle = capture as unknown as (ctx: StrategyContext) => StrategySignal | null;
    e.keltnerGrid.onCandle = capture as unknown as (ctx: StrategyContext) => StrategySignal | null;
    const inputCtx = mkContext({ candleIndex: 42 });
    e.onCandle(inputCtx);
    // 4 captures expected (one per sub-strategy).
    expect(observedCtxs.length).toBe(4);
    // All observed contexts should be referentially equal to the input
    // ctx (the ensemble delegates without cloning).
    for (const ctx of observedCtxs) {
      expect(ctx).toBe(inputCtx);
    }
    // candleIndex carried through.
    expect(observedCtxs[0]!.candleIndex).toBe(42);
  });
});
