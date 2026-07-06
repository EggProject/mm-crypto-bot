// packages/core/src/strategy/regime-routed-ensemble.test.ts — Phase 16 Track B
// Regime-Routed Ensemble tests.
//
// 100% line+branch coverage on regime-routed-ensemble.ts. The tests follow
// the Phase 15 Track D `simple-retail-ensemble.test.ts` pattern: replace each
// sub-strategy's `onCandle` with a pre-programmed stub via property
// assignment, then exercise the ensemble's regime-routing + aggregation
// logic in isolation from the sub-strategy internals (which are covered by
// the per-strategy test files).
//
// Sub-strategy call counters verify the regime filter (range regime should
// NOT call BB Squeeze / Keltner Grid; trend regime should NOT call Pivot /
// Donchian Range). This is the "ADX < 20 → only Pivot + Donchian considered"
// and "ADX >= 20 → only BB + Keltner considered" tests from the Phase 16 brief.
//
// `@ts-nocheck` per project convention for ultra-strict tsconfig — the
// runtime assertions verify behavior correctness.
//
// Tests coverage (≥12 tests, all required by the Phase 16 Track B brief):
//   1.  Default construction: name, timeframes, adxRangeThreshold=20
//   2.  Custom config: adxRangeThreshold + per-sub-strategy overrides forwarded
//   3.  Custom LTF reflected in timeframes field
//   4.  warmup returns max of all 4 sub-strategy warmups (= 100)
//   5.  ADX < 20 → only Pivot + Donchian called (BB + Keltner NOT called)
//   6.  ADX >= 20 → only BB + Keltner called (Pivot + Donchian NOT called)
//   7.  ADX exactly 20 → trend regime (strict >= comparison)
//   8.  Range regime + Pivot long + Donchian long → highest-confidence wins,
//        reason tagged "regime=range consensus=2/2"
//   9.  Range regime + Pivot long + Donchian short → null (conflict)
//   10. Range regime + only Pivot long → emit, reason tagged
//        "regime=range solo=pivot-grid"
//   11. Trend regime + BB long + Keltner long → highest-confidence wins
//   12. Trend regime + BB short + Keltner long → null (conflict)
//   13. Missing ADX → null (regime unknown)
//   14. Custom adxRangeThreshold=25 → ADX 22 = range, ADX 27 = trend
//   15. Each sub-strategy receives the same `ctx` (delegation test)
//   16. Default config values match DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import type { MtfState, StrategyContext, StrategySignal } from "../types.js";
import {
  DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG,
  REGIME_ROUTED_ENSEMBLE_DEFAULT_LTF,
  RegimeRoutedEnsemble,
} from "./regime-routed-ensemble.js";

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
 * `mkState` — minimal MtfState constructor with overrides. The ensemble
 * only reads `mtfState.htf.adx`; everything else is left undefined by
 * default.
 */
function mkState(overrides: Partial<MtfState> = {}): MtfState {
  return {
    htf: { ...overrides.htf },
    mtf: { ...overrides.mtf },
    ltf: { ...overrides.ltf },
  };
}

/**
 * `mkContext` — StrategyContext builder. `candle`, `mtfState`, `candleIndex`,
 * `timeframe` are overrideable; everything else defaults.
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

/**
 * `mkSubStrategySpies` — replace each sub-strategy's `onCandle` with a
 * spy that returns the pre-programmed signal (or null) AND counts how
 * many times it was called. Returns the counters so tests can verify
 * which sub-strategies the regime filter allowed through.
 */
function mkSubStrategySpies(
  e: RegimeRoutedEnsemble,
  stubs: Readonly<Record<string, StrategySignal | null>>,
): {
  readonly counts: { readonly pivot: number; readonly bb: number; readonly donchian: number; readonly keltner: number };
} {
  let pivot = 0;
  let bb = 0;
  let donchian = 0;
  let keltner = 0;
  // @ts-expect-error — runtime monkey-patch for test isolation.
  e.pivotGrid.onCandle = (_ctx: StrategyContext): StrategySignal | null => {
    pivot += 1;
    return stubs["pivot-grid"] ?? null;
  };
  // @ts-expect-error — runtime monkey-patch for test isolation.
  e.bbSqueeze.onCandle = (_ctx: StrategyContext): StrategySignal | null => {
    bb += 1;
    return stubs["bb-squeeze"] ?? null;
  };
  // @ts-expect-error — runtime monkey-patch for test isolation.
  e.donchianRange.onCandle = (_ctx: StrategyContext): StrategySignal | null => {
    donchian += 1;
    return stubs["donchian-range"] ?? null;
  };
  // @ts-expect-error — runtime monkey-patch for test isolation.
  e.keltnerGrid.onCandle = (_ctx: StrategyContext): StrategySignal | null => {
    keltner += 1;
    return stubs["keltner-grid"] ?? null;
  };
  return {
    counts: {
      get pivot() {
        return pivot;
      },
      get bb() {
        return bb;
      },
      get donchian() {
        return donchian;
      },
      get keltner() {
        return keltner;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe("RegimeRoutedEnsemble — construction", () => {
  it("default construction: name, timeframes (1d, 4h, 15m), adxRangeThreshold=20, all 4 sub-strategies exist", () => {
    const e = new RegimeRoutedEnsemble();
    expect(e.name).toBe(
      "Regime-Routed Ensemble (Phase 16 — ADX-routed Pivot/Donchian + BB/Keltner)",
    );
    // Default LTF = "15m"
    expect(e.timeframes).toEqual(["1d", "4h", "15m"]);
    expect(REGIME_ROUTED_ENSEMBLE_DEFAULT_LTF).toBe("15m");
    expect(e.config.adxRangeThreshold).toBe(20);
    expect(e.pivotGrid).toBeDefined();
    expect(e.bbSqueeze).toBeDefined();
    expect(e.donchianRange).toBeDefined();
    expect(e.keltnerGrid).toBeDefined();
    // Default config check.
    expect(DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG.adxRangeThreshold).toBe(20);
    expect(DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG.pivotGrid).toEqual({});
    expect(DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG.bbSqueeze).toEqual({});
    expect(DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG.donchianRange).toEqual({});
    expect(DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG.keltnerGrid).toEqual({});
  });

  it("custom config respected: adxRangeThreshold + per-sub-strategy partial overrides forwarded", () => {
    const e = new RegimeRoutedEnsemble({
      adxRangeThreshold: 25,
      pivotGrid: { multiplierFib1: 0.5 },
      bbSqueeze: { squeezeThreshold: 0.015 },
      donchianRange: { adxTrendThreshold: 30 },
      keltnerGrid: { gridLevelCount: 7 },
    });
    expect(e.config.adxRangeThreshold).toBe(25);
    expect((e.pivotGrid.config as unknown as { multiplierFib1: number }).multiplierFib1).toBe(0.5);
    expect((e.bbSqueeze.config as unknown as { squeezeThreshold: number }).squeezeThreshold).toBe(0.015);
    expect((e.donchianRange.config as unknown as { adxTrendThreshold: number }).adxTrendThreshold).toBe(30);
    expect((e.keltnerGrid.config as unknown as { gridLevelCount: number }).gridLevelCount).toBe(7);
  });

  it("custom LTF (5m) reflected in timeframes field", () => {
    const e = new RegimeRoutedEnsemble({}, "5m");
    expect(e.timeframes).toEqual(["1d", "4h", "5m"]);
  });

  it("custom LTF (1h) reflected in timeframes field", () => {
    const e = new RegimeRoutedEnsemble({}, "1h");
    expect(e.timeframes).toEqual(["1d", "4h", "1h"]);
  });
});

// ---------------------------------------------------------------------------
// warmup tests
// ---------------------------------------------------------------------------

describe("RegimeRoutedEnsemble.warmup", () => {
  it("returns the max of all 4 sub-strategy warmups (Pivot=100 wins over the rest)", () => {
    const e = new RegimeRoutedEnsemble();
    // Each sub-strategy's warmup value (deterministic constants):
    //   Pivot = 100, BB Squeeze = 30, Donchian = 30, Keltner = 30.
    const expectedMax = Math.max(
      e.pivotGrid.warmup(),
      e.bbSqueeze.warmup(),
      e.donchianRange.warmup(),
      e.keltnerGrid.warmup(),
    );
    expect(e.warmup()).toBe(expectedMax);
    expect(e.warmup()).toBe(100);
    expect(e.warmup()).toBeGreaterThanOrEqual(e.pivotGrid.warmup());
    expect(e.warmup()).toBeGreaterThanOrEqual(e.bbSqueeze.warmup());
    expect(e.warmup()).toBeGreaterThanOrEqual(e.donchianRange.warmup());
    expect(e.warmup()).toBeGreaterThanOrEqual(e.keltnerGrid.warmup());
  });
});

// ---------------------------------------------------------------------------
// Regime routing tests — verify which sub-strategies get called per regime
// ---------------------------------------------------------------------------

describe("RegimeRoutedEnsemble — regime routing (sub-strategy call counters)", () => {
  it("ADX < 20 (range regime): only Pivot + Donchian called; BB + Keltner NOT called", () => {
    const e = new RegimeRoutedEnsemble();
    const spies = mkSubStrategySpies(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot long"),
      "bb-squeeze": mkLongSignal(0.9, "bb long — should NOT be called"),
      "donchian-range": mkLongSignal(0.8, "donchian long"),
      "keltner-grid": mkLongSignal(0.85, "keltner long — should NOT be called"),
    });
    const ctx = mkContext({ mtfState: { htf: { adx: 15 } } });
    const result = e.onCandle(ctx);
    // Range regime: only Pivot + Donchian called.
    expect(spies.counts.pivot).toBe(1);
    expect(spies.counts.donchian).toBe(1);
    expect(spies.counts.bb).toBe(0);
    expect(spies.counts.keltner).toBe(0);
    // Highest confidence wins (donchian @ 0.8 vs pivot @ 0.7 → donchian).
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.8);
  });

  it("ADX >= 20 (trend regime): only BB + Keltner called; Pivot + Donchian NOT called", () => {
    const e = new RegimeRoutedEnsemble();
    const spies = mkSubStrategySpies(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot long — should NOT be called"),
      "bb-squeeze": mkLongSignal(0.9, "bb long"),
      "donchian-range": mkLongSignal(0.8, "donchian long — should NOT be called"),
      "keltner-grid": mkLongSignal(0.85, "keltner long"),
    });
    const ctx = mkContext({ mtfState: { htf: { adx: 30 } } });
    const result = e.onCandle(ctx);
    // Trend regime: only BB + Keltner called.
    expect(spies.counts.bb).toBe(1);
    expect(spies.counts.keltner).toBe(1);
    expect(spies.counts.pivot).toBe(0);
    expect(spies.counts.donchian).toBe(0);
    // Highest confidence wins (bb @ 0.9 vs keltner @ 0.85 → bb).
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.9);
  });

  it("ADX exactly 20 → trend regime (strict >= comparison)", () => {
    const e = new RegimeRoutedEnsemble();
    const spies = mkSubStrategySpies(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot"),
      "bb-squeeze": mkLongSignal(0.9, "bb"),
      "donchian-range": mkLongSignal(0.8, "donchian"),
      "keltner-grid": mkLongSignal(0.85, "keltner"),
    });
    const ctx = mkContext({ mtfState: { htf: { adx: 20 } } });
    e.onCandle(ctx);
    // 20 is NOT less than 20 → trend regime → BB + Keltner.
    expect(spies.counts.pivot).toBe(0);
    expect(spies.counts.donchian).toBe(0);
    expect(spies.counts.bb).toBe(1);
    expect(spies.counts.keltner).toBe(1);
  });

  it("ADX = 19.999 → range regime (just below threshold)", () => {
    const e = new RegimeRoutedEnsemble();
    const spies = mkSubStrategySpies(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot"),
      "bb-squeeze": mkLongSignal(0.9, "bb"),
      "donchian-range": mkLongSignal(0.8, "donchian"),
      "keltner-grid": mkLongSignal(0.85, "keltner"),
    });
    const ctx = mkContext({ mtfState: { htf: { adx: 19.999 } } });
    e.onCandle(ctx);
    expect(spies.counts.pivot).toBe(1);
    expect(spies.counts.donchian).toBe(1);
    expect(spies.counts.bb).toBe(0);
    expect(spies.counts.keltner).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Aggregation logic tests
// ---------------------------------------------------------------------------

describe("RegimeRoutedEnsemble.onCandle — consensus / solo / conflict", () => {
  it("range regime + Pivot long + Donchian long → highest-confidence wins, reason tagged 'regime=range consensus=2/2'", () => {
    const e = new RegimeRoutedEnsemble();
    mkSubStrategySpies(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot at S1 → buy"),
      "bb-squeeze": null,
      "donchian-range": mkLongSignal(0.95, "donchian at lower → buy"),
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext({ mtfState: { htf: { adx: 15 } } }));
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.95);
    expect(result!.reason).toContain("[RegimeEnsemble] regime=range consensus=2/2");
    expect(result!.reason).toContain("donchian at lower");
    expect(result!.reason).toContain("winner=donchian-range");
  });

  it("range regime + Pivot long + Donchian short → null (conflict, defer)", () => {
    const e = new RegimeRoutedEnsemble();
    mkSubStrategySpies(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot long"),
      "bb-squeeze": null,
      "donchian-range": mkShortSignal(0.85, "donchian short"),
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext({ mtfState: { htf: { adx: 15 } } }));
    expect(result).toBeNull();
  });

  it("range regime + only Pivot long → emit, reason tagged 'regime=range solo=pivot-grid'", () => {
    const e = new RegimeRoutedEnsemble();
    const pivotSig = mkLongSignal(0.8, "pivot at S2 → buy");
    mkSubStrategySpies(e, {
      "pivot-grid": pivotSig,
      "bb-squeeze": null,
      "donchian-range": null,
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext({ mtfState: { htf: { adx: 15 } } }));
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.8);
    expect(result!.reason).toContain("[RegimeEnsemble] regime=range solo=pivot-grid");
    expect(result!.reason).toContain("pivot at S2");
  });

  it("range regime + only Donchian short → emit, reason tagged 'regime=range solo=donchian-range'", () => {
    const e = new RegimeRoutedEnsemble();
    const donchSig = mkShortSignal(0.9, "donchian at upper → sell");
    mkSubStrategySpies(e, {
      "pivot-grid": null,
      "bb-squeeze": null,
      "donchian-range": donchSig,
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext({ mtfState: { htf: { adx: 15 } } }));
    expect(result).not.toBeNull();
    expect(result!.side).toBe("sell");
    expect(result!.confidence).toBe(0.9);
    expect(result!.reason).toContain("[RegimeEnsemble] regime=range solo=donchian-range");
  });

  it("range regime + 0 signals fire (both null) → null", () => {
    const e = new RegimeRoutedEnsemble();
    mkSubStrategySpies(e, {
      "pivot-grid": null,
      "bb-squeeze": null,
      "donchian-range": null,
      "keltner-grid": null,
    });
    const result = e.onCandle(mkContext({ mtfState: { htf: { adx: 15 } } }));
    expect(result).toBeNull();
  });

  it("trend regime + BB long + Keltner long → highest-confidence wins, reason tagged 'regime=trend consensus=2/2'", () => {
    const e = new RegimeRoutedEnsemble();
    mkSubStrategySpies(e, {
      "pivot-grid": null,
      "bb-squeeze": mkLongSignal(0.85, "bb breakout up"),
      "donchian-range": null,
      "keltner-grid": mkLongSignal(0.75, "keltner grid long"),
    });
    const result = e.onCandle(mkContext({ mtfState: { htf: { adx: 30 } } }));
    expect(result).not.toBeNull();
    expect(result!.side).toBe("buy");
    expect(result!.confidence).toBe(0.85);
    expect(result!.reason).toContain("[RegimeEnsemble] regime=trend consensus=2/2");
    expect(result!.reason).toContain("bb breakout up");
    expect(result!.reason).toContain("winner=bb-squeeze");
  });

  it("trend regime + BB short + Keltner long → null (conflict)", () => {
    const e = new RegimeRoutedEnsemble();
    mkSubStrategySpies(e, {
      "pivot-grid": null,
      "bb-squeeze": mkShortSignal(0.85, "bb breakdown"),
      "donchian-range": null,
      "keltner-grid": mkLongSignal(0.75, "keltner long"),
    });
    const result = e.onCandle(mkContext({ mtfState: { htf: { adx: 30 } } }));
    expect(result).toBeNull();
  });

  it("trend regime + only Keltner short → emit, reason tagged 'regime=trend solo=keltner-grid'", () => {
    const e = new RegimeRoutedEnsemble();
    const kelSig = mkShortSignal(0.7, "keltner short touch");
    mkSubStrategySpies(e, {
      "pivot-grid": null,
      "bb-squeeze": null,
      "donchian-range": null,
      "keltner-grid": kelSig,
    });
    const result = e.onCandle(mkContext({ mtfState: { htf: { adx: 30 } } }));
    expect(result).not.toBeNull();
    expect(result!.side).toBe("sell");
    expect(result!.confidence).toBe(0.7);
    expect(result!.reason).toContain("[RegimeEnsemble] regime=trend solo=keltner-grid");
  });
});

// ---------------------------------------------------------------------------
// Missing-ADX + custom-threshold tests
// ---------------------------------------------------------------------------

describe("RegimeRoutedEnsemble — missing ADX + custom threshold", () => {
  it("ADX undefined → null (no regime detection possible)", () => {
    const e = new RegimeRoutedEnsemble();
    const spies = mkSubStrategySpies(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot"),
      "bb-squeeze": mkLongSignal(0.9, "bb"),
      "donchian-range": mkLongSignal(0.8, "donchian"),
      "keltner-grid": mkLongSignal(0.85, "keltner"),
    });
    // No htf.adx in the mtfState.
    const result = e.onCandle(mkContext({ mtfState: {} }));
    expect(result).toBeNull();
    // No sub-strategy should be called when regime is unknown.
    expect(spies.counts.pivot).toBe(0);
    expect(spies.counts.bb).toBe(0);
    expect(spies.counts.donchian).toBe(0);
    expect(spies.counts.keltner).toBe(0);
  });

  it("custom adxRangeThreshold=25: ADX 22 = range, ADX 27 = trend", () => {
    const e = new RegimeRoutedEnsemble({ adxRangeThreshold: 25 });

    // ADX 22 → range (22 < 25).
    {
      const spies = mkSubStrategySpies(e, {
        "pivot-grid": mkLongSignal(0.7, "pivot"),
        "bb-squeeze": null,
        "donchian-range": null,
        "keltner-grid": null,
      });
      const ctx = mkContext({ mtfState: { htf: { adx: 22 } } });
      const result = e.onCandle(ctx);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain("regime=range");
      expect(spies.counts.pivot).toBe(1);
      expect(spies.counts.bb).toBe(0);
      expect(spies.counts.keltner).toBe(0);
    }

    // ADX 27 → trend (27 >= 25).
    {
      const spies = mkSubStrategySpies(e, {
        "pivot-grid": null,
        "bb-squeeze": null,
        "donchian-range": null,
        "keltner-grid": mkLongSignal(0.7, "keltner"),
      });
      const ctx = mkContext({ mtfState: { htf: { adx: 27 } } });
      const result = e.onCandle(ctx);
      expect(result).not.toBeNull();
      expect(result!.reason).toContain("regime=trend");
      expect(spies.counts.keltner).toBe(1);
      expect(spies.counts.pivot).toBe(0);
      expect(spies.counts.donchian).toBe(0);
    }
  });

  it("ADX exactly at custom threshold → trend regime (strict >=)", () => {
    const e = new RegimeRoutedEnsemble({ adxRangeThreshold: 25 });
    const spies = mkSubStrategySpies(e, {
      "pivot-grid": mkLongSignal(0.7, "pivot"),
      "bb-squeeze": mkLongSignal(0.9, "bb"),
      "donchian-range": mkLongSignal(0.8, "donchian"),
      "keltner-grid": mkLongSignal(0.85, "keltner"),
    });
    const ctx = mkContext({ mtfState: { htf: { adx: 25 } } });
    e.onCandle(ctx);
    expect(spies.counts.pivot).toBe(0);
    expect(spies.counts.donchian).toBe(0);
    expect(spies.counts.bb).toBe(1);
    expect(spies.counts.keltner).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Delegation test — verify each sub-strategy receives the same ctx
// ---------------------------------------------------------------------------

describe("RegimeRoutedEnsemble — delegation", () => {
  it("each sub-strategy receives the same `ctx` object (delegation test)", () => {
    const e = new RegimeRoutedEnsemble();
    const observedCtxs: StrategyContext[] = [];
    // @ts-expect-error — capture-based monkey-patch for delegation test.
    e.pivotGrid.onCandle = (ctx: StrategyContext): StrategySignal | null => {
      observedCtxs.push(ctx);
      return null;
    };
    // @ts-expect-error — capture-based monkey-patch for delegation test.
    e.bbSqueeze.onCandle = (ctx: StrategyContext): StrategySignal | null => {
      observedCtxs.push(ctx);
      return null;
    };
    // @ts-expect-error — capture-based monkey-patch for delegation test.
    e.donchianRange.onCandle = (ctx: StrategyContext): StrategySignal | null => {
      observedCtxs.push(ctx);
      return null;
    };
    // @ts-expect-error — capture-based monkey-patch for delegation test.
    e.keltnerGrid.onCandle = (ctx: StrategyContext): StrategySignal | null => {
      observedCtxs.push(ctx);
      return null;
    };
    // Use a regime that fires all 4 sub-strategies (default threshold = 20
    // means we can't get all 4 in one regime, so use range regime to verify
    // Pivot + Donchian at minimum, then test trend regime for BB + Keltner).
    const inputCtxRange = mkContext({
      mtfState: { htf: { adx: 15 } },
      candleIndex: 42,
    });
    e.onCandle(inputCtxRange);
    // Range regime: only Pivot + Donchian called.
    expect(observedCtxs.length).toBe(2);
    for (const ctx of observedCtxs) {
      expect(ctx).toBe(inputCtxRange);
    }
    expect(observedCtxs[0]!.candleIndex).toBe(42);

    observedCtxs.length = 0;
    const inputCtxTrend = mkContext({
      mtfState: { htf: { adx: 30 } },
      candleIndex: 99,
    });
    e.onCandle(inputCtxTrend);
    // Trend regime: only BB + Keltner called.
    expect(observedCtxs.length).toBe(2);
    for (const ctx of observedCtxs) {
      expect(ctx).toBe(inputCtxTrend);
    }
    expect(observedCtxs[0]!.candleIndex).toBe(99);
  });
});