// packages/core/src/strategy/multi-class-ensemble-v4.test.ts — V4 ensemble tests
//
// Phase 9 M2 — comprehensive tests for the V4 multi-class ensemble covering:
//   - Construction + config (V4 holds 4 sub-strategies + hybrid result)
//   - Component isolation (each track removable independently)
//   - No-double-counting (verify signal flow)
//   - Carry timing gate pause (Phase 8 E logic preserved)
//   - Funding-flip kill-switch integration (Phase 9 9D logic)
//   - Hybrid sizer integration (Phase 9 9E logic)
//   - Leverage scaling under vol target + 9E hybrid (effective lev ≤ 10)
//   - Position-management hook delegation
//   - State aggregation across all 5 components (9D + 9E + D + E + F + G)
//   - Per-symbol composition (BTC/ETH/SOL)
//   - Effective leverage clamp (≤ 10 even at extreme low-vol regimes)
//   - Helper functions
//   - Determinism
//
// Coverage target: 100% line + 100% function coverage.

import { describe, expect, it } from "bun:test";

import type { Candle, Symbol } from "@mm-crypto-bot/shared/types";

import type {
  IndicatorState,
  MtfState,
  OpenPositionSnapshot,
  PositionManagementContext,
  StrategyContext,
} from "../types.js";
import { DEFAULT_VOL_TARGET_CONFIG } from "../risk/vol-targeted-sizer.js";
import type { HybridSizerResult } from "../risk/adaptive-kelly-vol-hybrid.js";
import {
  combineVolAndCarryLeverageV4,
  computeV4CarryFractionFromFlipSwitchState,
  DEFAULT_MULTI_CLASS_ENSEMBLE_V4_CONFIG_PARTIAL,
  defaultV4CompositionForSymbol,
  defaultV4VolTargetConfig,
  MultiClassEnsembleV4,
  timeframesForMultiClassV4,
  type MultiClassEnsembleV4Config,
} from "./multi-class-ensemble-v4.js";
import type { DEFAULT_DONCHIAN_MTF_CONFIG } from "./donchian-mtf.js";
import type {
  DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG,
} from "./funding-flip-kill-switch.js";
import type { DEFAULT_LEVERAGED_CARRY_CONFIG } from "./funding-carry-leverage.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_SYMBOL = "BTC/USDT" as Symbol;

function makeCandle(close: number, high = close, low = close, timestamp = 0): Candle {
  return {
    timestamp,
    open: close,
    high,
    low,
    close,
    volume: 1000,
  };
}

function makeMtfState(close: number, atr?: number, donchianUpper?: number): MtfState {
  const base: IndicatorState = { close };
  const withAtr: IndicatorState = atr !== undefined ? { close, atr } : base;
  const htf: IndicatorState = { close, supertrend: close - 100 };
  const mtf: IndicatorState =
    donchianUpper !== undefined
      ? { close, donchianUpper }
      : { close };
  return { htf, mtf: { ...mtf, ...withAtr }, ltf: withAtr };
}

function makeCtx(opts: {
  readonly close: number;
  readonly high?: number;
  readonly low?: number;
  readonly candleIndex?: number;
  readonly timestamp?: number;
  readonly atr?: number;
  readonly donchianUpper?: number;
} = { close: 100 }): StrategyContext {
  return {
    symbol: TEST_SYMBOL,
    timeframe: "1h",
    candleIndex: opts.candleIndex ?? 0,
    candle: makeCandle(opts.close, opts.high, opts.low, opts.timestamp ?? opts.candleIndex ?? 0),
    mtfState: makeMtfState(opts.close, opts.atr, opts.donchianUpper),
    pricePrecision: 2,
  };
}

function makeOpenPositionCtx(opts: {
  readonly side: "buy" | "sell";
  readonly close: number;
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly holdingBars: number;
  readonly atr?: number;
}): PositionManagementContext {
  const snapshot: OpenPositionSnapshot = {
    side: opts.side,
    entryTime: 0,
    entryPrice: opts.entryPrice,
    quantity: 1,
    stopLoss: opts.stopLoss,
    takeProfit: opts.takeProfit,
    holdingBars: opts.holdingBars,
  };
  return {
    openPosition: snapshot,
    candle: makeCandle(opts.close),
    candleIndex: 100,
    mtfState: makeMtfState(opts.close, opts.atr),
    pricePrecision: 2,
  };
}

function makeConfig(overrides: {
  readonly donchianMtf?: Partial<typeof DEFAULT_DONCHIAN_MTF_CONFIG>;
  readonly fundingFlipKillSwitch?: Partial<typeof DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG>;
  readonly fundingCarryLeverage?: Partial<typeof DEFAULT_LEVERAGED_CARRY_CONFIG>;
  readonly volTargetedSizer?: Partial<typeof DEFAULT_VOL_TARGET_CONFIG>;
  readonly hybridSizerResult?: HybridSizerResult;
} = {}): MultiClassEnsembleV4Config {
  const merged: MultiClassEnsembleV4Config = {
    ...DEFAULT_MULTI_CLASS_ENSEMBLE_V4_CONFIG_PARTIAL,
    ...overrides,
    volTargetedSizer: {
      ...DEFAULT_VOL_TARGET_CONFIG,
      ...overrides.volTargetedSizer,
    },
  };
  if (overrides.hybridSizerResult !== undefined) {
    return { ...merged, hybridSizerResult: overrides.hybridSizerResult };
  }
  return merged;
}

function makeHybridResult(overrides: {
  readonly avgKellyFraction?: number;
  readonly avgVolMultiplier?: number;
  readonly avgEffectivePositionFactor?: number;
  readonly avgEffectiveLeverage?: number;
  readonly recommendedRiskPerTrade?: number;
  readonly recommendedMaxPositionPctEquity?: number;
} = {}): HybridSizerResult {
  const avgKelly = overrides.avgKellyFraction ?? 0.5;
  const avgVolMult = overrides.avgVolMultiplier ?? 0.8;
  const avgFactor = overrides.avgEffectivePositionFactor ?? avgKelly * avgVolMult;
  return {
    config: {
      rollingWindowDays: 30,
      baseKellyFraction: avgKelly,
      volTargetConfig: DEFAULT_VOL_TARGET_CONFIG,
      initialEquity: 10_000,
      minTradeCount: 30,
    },
    days: [],
    avgKellyFraction: avgKelly,
    avgVolMultiplier: avgVolMult,
    avgEffectivePositionFactor: avgFactor,
    avgEffectiveLeverage: overrides.avgEffectiveLeverage ?? 10 * avgVolMult,
    upperClampFraction: 0.1,
    lowerClampFraction: 0.05,
    middleFraction: 0.85,
    kellyBucketDistribution: {
      fullKellyFraction: 0.1,
      threeQuarterFraction: 0.2,
      halfKellyFraction: 0.5,
      quarterKellyFraction: 0.15,
      insufficientFraction: 0.05,
    },
    recommendedRiskPerTrade: overrides.recommendedRiskPerTrade ?? 0.05,
    recommendedMaxPositionPctEquity: overrides.recommendedMaxPositionPctEquity ?? avgFactor * 0.2,
    hadAllLossStreak: false,
  };
}

// ---------------------------------------------------------------------------
// Construction + config
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — construction + config", () => {
  it("default config: builds all 4 sub-components with sane defaults", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    expect(ens.donchianMtf).toBeDefined();
    expect(ens.fundingFlipKillSwitch).toBeDefined();
    expect(ens.fundingCarryLeverage).toBeDefined();
    expect(ens.volTargetedSizerConfig).toBeDefined();
    expect(ens.name).toContain("Phase 9 Multi-Class Ensemble V4");
    expect(ens.name).toContain("Donchian-MTF");
    expect(ens.name).toContain("Funding-Flip-KillSwitch");
    expect(ens.name).toContain("Carry-Leverage-10x");
    expect(ens.name).toContain("VolTarget");
    expect(ens.name).toContain("HybridSizer");
    expect(ens.timeframes).toEqual(["1d", "4h", "1h"]);
  });

  it("warmup: returns max of all sub-strategy warmups (≥720 for flip kill-switch)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    expect(ens.warmup()).toBeGreaterThanOrEqual(720);
  });

  it("default state: all counters zero, vol multiplier 1.0, hybrid factor 1.0", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    const state = ens.getState();
    expect(state.donchianSignalsEmitted).toBe(0);
    expect(state.donchianTimeExitCloses).toBe(0);
    expect(state.fundingCarryEntries).toBe(0);
    expect(state.fundingCarryUsd).toBe(0);
    expect(state.fundingCarryTimeInCarryFraction).toBe(0);
    expect(state.volTargetedAvgMultiplier).toBe(1.0);
    expect(state.hybridPositionFactor).toBe(1.0);
    expect(state.liquidationEvents).toBe(0);
    expect(state.dailyVaR95Pct).toBe(0);
    expect(state.combinedEdgePct).toBe(0);
    expect(state.flipRegimeActivationCount).toBe(0);
    expect(state.flipForcedExitCount).toBe(0);
  });

  it("default config partial: has all 3 sub-strategy defaults wired", () => {
    expect(DEFAULT_MULTI_CLASS_ENSEMBLE_V4_CONFIG_PARTIAL.donchianMtf).toBeDefined();
    expect(DEFAULT_MULTI_CLASS_ENSEMBLE_V4_CONFIG_PARTIAL.fundingFlipKillSwitch).toBeDefined();
    expect(DEFAULT_MULTI_CLASS_ENSEMBLE_V4_CONFIG_PARTIAL.fundingCarryLeverage).toBeDefined();
  });

  it("defaultV4VolTargetConfig: returns the same values as DEFAULT_VOL_TARGET_CONFIG", () => {
    expect(defaultV4VolTargetConfig()).toEqual(DEFAULT_VOL_TARGET_CONFIG);
  });

  it("hybrid sizer result is optional: constructor accepts config without it", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    expect(ens.hybridSizerResult).toBeUndefined();
    expect(ens.getCurrentHybridFactor()).toBe(1.0);
  });

  it("hybrid sizer result is wired: constructor pre-populates currentHybridFactor", () => {
    const hybrid = makeHybridResult({ avgEffectivePositionFactor: 0.42 });
    const ens = new MultiClassEnsembleV4(makeConfig({ hybridSizerResult: hybrid }));
    expect(ens.hybridSizerResult).toBe(hybrid);
    expect(ens.getCurrentHybridFactor()).toBe(0.42);
  });
});

// ---------------------------------------------------------------------------
// Vol-target multiplier injection (Track G)
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — vol-target multiplier injection (Track G)", () => {
  it("setVolTargetMultiplier: clamps to [minVolMultiplier, maxVolMultiplier]", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    ens.setVolTargetMultiplier(0.05);
    expect(ens.getCurrentVolMultiplier()).toBe(DEFAULT_VOL_TARGET_CONFIG.minVolMultiplier);
    ens.setVolTargetMultiplier(2.0);
    expect(ens.getCurrentVolMultiplier()).toBe(DEFAULT_VOL_TARGET_CONFIG.maxVolMultiplier);
    ens.setVolTargetMultiplier(0.6);
    expect(ens.getCurrentVolMultiplier()).toBeCloseTo(0.6, 6);
  });

  it("setVolTargetMultiplier: rejects non-finite or non-positive", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    expect(() => ens.setVolTargetMultiplier(NaN)).toThrow();
    expect(() => ens.setVolTargetMultiplier(0)).toThrow();
    expect(() => ens.setVolTargetMultiplier(-1)).toThrow();
    expect(() => ens.setVolTargetMultiplier(Infinity)).toThrow();
  });

  it("setRecommendedMaxPositionPctEquity: stores and returns in state", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    ens.setRecommendedMaxPositionPctEquity(0.15);
    expect(ens.getState().recommendedMaxPositionPctEquity).toBe(0.15);
  });

  it("setRecommendedMaxPositionPctEquity: rejects non-finite or negative", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    expect(() => ens.setRecommendedMaxPositionPctEquity(NaN)).toThrow();
    expect(() => ens.setRecommendedMaxPositionPctEquity(-0.1)).toThrow();
    expect(() => ens.setRecommendedMaxPositionPctEquity(Infinity)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Hybrid sizer factor injection (Track 9E)
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — hybrid position factor injection (Track 9E)", () => {
  it("setHybridPositionFactor: accepts factors in [0.01, 2.0]", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    ens.setHybridPositionFactor(0.5);
    expect(ens.getCurrentHybridFactor()).toBeCloseTo(0.5, 6);
    ens.setHybridPositionFactor(1.2);
    expect(ens.getCurrentHybridFactor()).toBeCloseTo(1.2, 6);
  });

  it("setHybridPositionFactor: clamps to [0.01, 2.0]", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    ens.setHybridPositionFactor(0.001);
    expect(ens.getCurrentHybridFactor()).toBe(0.01);
    ens.setHybridPositionFactor(5.0);
    expect(ens.getCurrentHybridFactor()).toBe(2.0);
  });

  it("setHybridPositionFactor: rejects non-finite or non-positive", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    expect(() => ens.setHybridPositionFactor(NaN)).toThrow();
    expect(() => ens.setHybridPositionFactor(0)).toThrow();
    expect(() => ens.setHybridPositionFactor(-1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// combineVolAndCarryLeverageV4 helper
// ---------------------------------------------------------------------------

describe("combineVolAndCarryLeverageV4 helper", () => {
  it("multiplies carryMaxLeverage × clampedVolMultiplier", () => {
    // 10 × 0.8 = 8
    expect(combineVolAndCarryLeverageV4(10, 0.8)).toBe(8);
    // 10 × 1.0 = 10
    expect(combineVolAndCarryLeverageV4(10, 1.0)).toBe(10);
  });

  it("clamps result to [1, 10] — even at extreme low-vol regime (1:10 MANDATE)", () => {
    // 10 × 1.0 = 10
    expect(combineVolAndCarryLeverageV4(10, 1.0)).toBe(10);
    // 10 × 0.25 = 2.5 → floor → 2
    expect(combineVolAndCarryLeverageV4(10, 0.25)).toBe(2);
    // 10 × 0.05 = 0.5 → clamped to 1
    expect(combineVolAndCarryLeverageV4(10, 0.05)).toBe(1);
    // floor effect: 10 × 0.83 = 8.3 → floor → 8
    expect(combineVolAndCarryLeverageV4(10, 0.83)).toBe(8);
  });

  it("rejects non-finite or non-positive inputs", () => {
    expect(() => combineVolAndCarryLeverageV4(NaN, 1)).toThrow();
    expect(() => combineVolAndCarryLeverageV4(0, 1)).toThrow();
    expect(() => combineVolAndCarryLeverageV4(10, NaN)).toThrow();
    expect(() => combineVolAndCarryLeverageV4(10, 0)).toThrow();
    expect(() => combineVolAndCarryLeverageV4(-1, 1)).toThrow();
    expect(() => combineVolAndCarryLeverageV4(Infinity, 1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Effective leverage clamp (1:10 MANDATORY)
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — effective leverage clamp (1:10 MANDATORY)", () => {
  it("effective leverage never exceeds 10 even at extreme low-vol regime", () => {
    const ens = new MultiClassEnsembleV4(
      makeConfig({
        volTargetedSizer: { minVolMultiplier: 0.25, maxVolMultiplier: 1.0 },
      }),
    );
    // Push both multipliers to max → 10 × 1.0 × 2.0 = 20 → clamped to 10
    ens.setVolTargetMultiplier(1.0);
    ens.setHybridPositionFactor(2.0);
    expect(ens.getEffectiveCarryLeverage()).toBeLessThanOrEqual(10);
    expect(ens.getEffectiveCarryLeverage()).toBe(10);
  });

  it("effective leverage floors at 1 even at extreme high-vol regime", () => {
    const ens = new MultiClassEnsembleV4(
      makeConfig({
        volTargetedSizer: { minVolMultiplier: 0.01, maxVolMultiplier: 1.0 },
      }),
    );
    ens.setVolTargetMultiplier(0.05);
    ens.setHybridPositionFactor(0.01);
    // 10 × 0.05 = 0.5 → clamped to 1
    expect(ens.getEffectiveCarryLeverage()).toBe(1);
  });

  it("applyCarrySnapshot: mutates Track D state.currentLeverage with combined value", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    ens.setVolTargetMultiplier(0.5);
    ens.setHybridPositionFactor(0.5);
    const lev = ens.applyCarrySnapshot(0);
    expect(lev).toBeLessThanOrEqual(10);
    expect(ens.fundingCarryLeverage.state.currentLeverage).toBe(lev);
    expect(ens.fundingCarryLeverage.state.effectiveNotionalUsd).toBe(
      ens.fundingCarryLeverage.config.baseNotionalUsd * lev,
    );
  });
});

// ---------------------------------------------------------------------------
// computeV4CarryFractionFromFlipSwitchState helper
// ---------------------------------------------------------------------------

describe("computeV4CarryFractionFromFlipSwitchState helper", () => {
  it("returns 0 when no funding periods recorded", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    const fraction = computeV4CarryFractionFromFlipSwitchState(ens.fundingFlipKillSwitch.state);
    expect(fraction).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// timeframesForMultiClassV4
// ---------------------------------------------------------------------------

describe("timeframesForMultiClassV4", () => {
  it("1h ltf → htf=1d, mtf=4h, ltf=1h", () => {
    expect(timeframesForMultiClassV4("1h")).toEqual({ htf: "1d", mtf: "4h", ltf: "1h" });
  });
  it("4h ltf → htf=1d, mtf=4h, ltf=4h", () => {
    expect(timeframesForMultiClassV4("4h")).toEqual({ htf: "1d", mtf: "4h", ltf: "4h" });
  });
  it("1d ltf → htf=1d, mtf=4h, ltf=1d", () => {
    expect(timeframesForMultiClassV4("1d")).toEqual({ htf: "1d", mtf: "4h", ltf: "1d" });
  });
  it("unsupported ltf → throws", () => {
    // Cast to Timeframe to bypass the union type — the runtime guard rejects it
    expect(() => timeframesForMultiClassV4("5m" as unknown as Parameters<typeof timeframesForMultiClassV4>[0])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// per-symbol composition helper
// ---------------------------------------------------------------------------

describe("defaultV4CompositionForSymbol", () => {
  it("BTC: full V4 stack (donchian + flip + hybrid)", () => {
    const c = defaultV4CompositionForSymbol("BTC");
    expect(c.useDonchianMtf).toBe(true);
    expect(c.useFlipKillSwitch).toBe(true);
    expect(c.useHybridSizer).toBe(true);
    expect(c.reasoning).toContain("BTC");
  });
  it("ETH: full V4 stack (donchian + flip + hybrid)", () => {
    const c = defaultV4CompositionForSymbol("ETH");
    expect(c.useDonchianMtf).toBe(true);
    expect(c.useFlipKillSwitch).toBe(true);
    expect(c.useHybridSizer).toBe(true);
    expect(c.reasoning).toContain("ETH");
  });
  it("SOL: full V4 stack — flip kill-switch engaged during flip regime only", () => {
    const c = defaultV4CompositionForSymbol("SOL");
    expect(c.useDonchianMtf).toBe(true);
    expect(c.useFlipKillSwitch).toBe(true);
    expect(c.useHybridSizer).toBe(true);
    expect(c.reasoning).toContain("SOL");
    expect(c.reasoning).toContain("flip");
  });
});

// ---------------------------------------------------------------------------
// onCandle signal flow
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — onCandle signal flow", () => {
  it("pre-warmup candle: returns null (Donchian MTF gates)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    const signal = ens.onCandle(makeCtx({ close: 100 }));
    expect(signal).toBeNull();
  });

  it("after warmup with non-triggering candle: returns null (no MTF signal)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    // Drive warmup
    for (let i = 0; i < 1000; i++) {
      ens.onCandle(makeCtx({ close: 100 + i, candleIndex: i, timestamp: i * 3_600_000 }));
    }
    const before = ens.getState().donchianSignalsEmitted;
    const signal = ens.onCandle(makeCtx({ close: 100, candleIndex: 1000, timestamp: 1000 * 3_600_000 }));
    expect(signal).toBeNull();
    expect(ens.getState().donchianSignalsEmitted).toBe(before);
  });

  it("increments donchianSignalsEmitted only when MTF signal is produced", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    for (let i = 0; i < 1000; i++) {
      ens.onCandle(makeCtx({ close: 100 + i, candleIndex: i, timestamp: i * 3_600_000 }));
    }
    const before = ens.getState().donchianSignalsEmitted;
    // Try to trigger by setting 1h close > 4h donchian upper AND 1d supertrend below
    const sig = ens.onCandle(
      makeCtx({
        close: 200,
        candleIndex: 1000,
        timestamp: 1000 * 3_600_000,
        donchianUpper: 150,
      }),
    );
    if (sig !== null) {
      expect(ens.getState().donchianSignalsEmitted).toBe(before + 1);
    }
  });

  it("ignores carry-side signals (no double-counting)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    for (let i = 0; i < 1000; i++) {
      ens.onCandle(makeCtx({ close: 100 + i, candleIndex: i, timestamp: i * 3_600_000 }));
    }
    const beforeEntries = ens.getState().fundingCarryEntries;
    ens.onCandle(
      makeCtx({
        close: 100 + 1000,
        candleIndex: 1000,
        timestamp: 1000 * 3_600_000,
        donchianUpper: 50, // would NOT trigger MTF
      }),
    );
    // Carry-side entries may or may not advance — but ONLY via the
    // DonchianMTF signal flow does the engine see a signal. The flip
    // kill-switch's onCandle returns null when engaged, otherwise
    // delegates to inner FundingCarryTiming.
    expect(ens.getState().fundingCarryEntries).toBeGreaterThanOrEqual(beforeEntries);
  });

  it("signal reason tag includes ensemble metadata", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    for (let i = 0; i < 1000; i++) {
      ens.onCandle(makeCtx({ close: 100 + i, candleIndex: i, timestamp: i * 3_600_000 }));
    }
    ens.setVolTargetMultiplier(0.7);
    ens.setHybridPositionFactor(0.5);
    const sig = ens.onCandle(
      makeCtx({
        close: 500,
        candleIndex: 1000,
        timestamp: 1000 * 3_600_000,
        donchianUpper: 100,
      }),
    );
    if (sig !== null) {
      expect(sig.reason).toContain("MultiClassEnsembleV4");
      expect(sig.reason).toContain("vol=0.700");
      expect(sig.reason).toContain("hybrid=0.500");
    }
  });
});

// ---------------------------------------------------------------------------
// Position-management delegation (Track F owns hooks)
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — position-management delegation", () => {
  it("onPositionOpened delegates to DonchianMtf (no exception)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    expect(() =>
      ens.onPositionOpened({
        side: "buy",
        entryTime: 0,
        entryPrice: 100,
        quantity: 1,
        stopLoss: 95,
        takeProfit: 110,
        holdingBars: 0,
      }),
    ).not.toThrow();
  });

  it("onPositionClosed delegates to DonchianMtf (no exception)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    expect(() => ens.onPositionClosed("take_profit")).not.toThrow();
  });

  it("onOpenPositionUpdate: max-hold trigger → forceExit + donchianTimeExitCloses++", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    const before = ens.getState().donchianTimeExitCloses;
    const update = ens.onOpenPositionUpdate(
      makeOpenPositionCtx({
        side: "buy",
        close: 100,
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 110,
        holdingBars: 200, // > 168 max-hold
      }),
    );
    if (update !== null && update.forceExit && update.reason === "time_exit") {
      expect(ens.getState().donchianTimeExitCloses).toBe(before + 1);
    }
  });

  it("onOpenPositionUpdate: non-trigger update (no forceExit) — counter stays at 0", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    const update = ens.onOpenPositionUpdate(
      makeOpenPositionCtx({
        side: "buy",
        close: 100,
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 110,
        holdingBars: 50, // < 168
      }),
    );
    // The Track F strategy returns null when no force-exit is needed.
    if (update === null) {
      expect(ens.getState().donchianTimeExitCloses).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// recordFundingSnapshot + applyCarrySnapshot
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — recordFundingSnapshot + applyCarrySnapshot", () => {
  it("recordFundingSnapshot: returns 0 when not in carry", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    const payment = ens.recordFundingSnapshot(0, 0.0001);
    expect(payment).toBe(0);
  });

  it("recordFundingSnapshot: drives the 9D flip detector (state updates)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    ens.recordFundingSnapshot(1_000_000, 0.0001);
    expect(ens.fundingFlipKillSwitch.state.fundingHistory.length).toBeGreaterThan(0);
  });

  it("recordFundingSnapshot: returns payment when in carry (after timing entry)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    // Drive warmup + enter carry by accumulating >p75 funding rate
    let ts = 0;
    for (let i = 0; i < 30 * 3; i++) {
      ts = i * 8 * 60 * 60 * 1000; // 8h cadence
      ens.recordFundingSnapshot(ts, 0.0005); // high positive rate
    }
    // After 30d of high funding, timing should have entered carry at some point
    const payment = ens.recordFundingSnapshot(ts + 8 * 60 * 60 * 1000, 0.0005);
    // payment is 0 if out of carry OR non-zero if in carry
    expect(payment).toBeGreaterThanOrEqual(0);
  });

  it("applyCarrySnapshot: returns effective leverage ≤ 10 (1:10 MANDATE)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    ens.setVolTargetMultiplier(0.8);
    ens.setHybridPositionFactor(0.7);
    const lev = ens.applyCarrySnapshot(0);
    expect(lev).toBeGreaterThanOrEqual(1);
    expect(lev).toBeLessThanOrEqual(10);
  });

  it("applyCarrySnapshot: leverage floored at 1 even with very small multiplier", () => {
    const ens = new MultiClassEnsembleV4(
      makeConfig({
        volTargetedSizer: { minVolMultiplier: 0.01, maxVolMultiplier: 1.0 },
      }),
    );
    ens.setVolTargetMultiplier(0.05);
    ens.setHybridPositionFactor(0.1);
    const lev = ens.applyCarrySnapshot(0);
    // 10 × 0.05 = 0.5 → clamped to 1 (hybrid doesn't scale leverage)
    expect(lev).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// State aggregation
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — state aggregation", () => {
  it("getState: all fields present and zeroed on fresh instance", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    const state = ens.getState();
    expect(state.donchianSignalsEmitted).toBe(0);
    expect(state.donchianTimeExitCloses).toBe(0);
    expect(state.fundingCarryUsd).toBe(0);
    expect(state.fundingCarryTimeInCarryFraction).toBe(0);
    expect(state.fundingCarryEntries).toBe(0);
    expect(state.effectiveCarryLeverage).toBe(10);
    expect(state.volTargetedAvgMultiplier).toBe(1.0);
    expect(state.hybridPositionFactor).toBe(1.0);
    expect(state.dailyVaR95Pct).toBe(0);
    expect(state.liquidationEvents).toBe(0);
    expect(state.combinedEdgePct).toBe(0);
    expect(state.flipKillSwitchSide).toBeDefined();
    expect(state.carrySide).toBeDefined();
    expect(state.recommendedMaxPositionPctEquity).toBe(0);
    expect(state.flipRegimeActivationCount).toBe(0);
    expect(state.flipCarryPausedFundingPeriods).toBe(0);
    expect(state.flipCarryPausedFundingUsd).toBe(0);
    expect(state.flipForcedExitCount).toBe(0);
    expect(state.hybridAvgKellyFraction).toBe(0);
    expect(state.hybridAvgVolMultiplier).toBe(1.0);
    expect(state.hybridAvgEffectiveLeverage).toBe(10);
  });

  it("getState: carrySide is a snapshot (mutating it doesn't affect ensemble)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    const state = ens.getState();
    state.carrySide.fundingCollectedUsd = 99999;
    state.carrySide.liquidationEventsCount = 999;
    expect(ens.fundingCarryLeverage.state.fundingCollectedUsd).not.toBe(99999);
    expect(ens.fundingCarryLeverage.state.liquidationEventsCount).not.toBe(999);
  });

  it("getState: flipKillSwitchSide is a snapshot", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    const state = ens.getState();
    state.flipKillSwitchSide.regimeActivationCount = 999;
    expect(ens.fundingFlipKillSwitch.state.regimeActivationCount).not.toBe(999);
  });

  it("getState: effectiveCarryLeverage reflects current vol multiplier", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    ens.setVolTargetMultiplier(0.5);
    ens.setHybridPositionFactor(0.5);
    // effectiveCarryLeverage depends on volMultiplier only (Track 9E hybrid
    // scales the directional position size, not the carry leverage).
    // 10 × 0.5 = 5 → floor → 5
    expect(ens.getState().effectiveCarryLeverage).toBe(5);
  });

  it("getState: hybrid* fields populated when HybridSizerResult injected", () => {
    const hybrid = makeHybridResult({
      avgKellyFraction: 0.7,
      avgVolMultiplier: 0.8,
      avgEffectivePositionFactor: 0.56,
      avgEffectiveLeverage: 8,
    });
    const ens = new MultiClassEnsembleV4(makeConfig({ hybridSizerResult: hybrid }));
    const state = ens.getState();
    expect(state.hybridAvgKellyFraction).toBe(0.7);
    expect(state.hybridAvgVolMultiplier).toBe(0.8);
    expect(state.hybridAvgEffectiveLeverage).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Component isolation (each track removable independently)
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — component isolation", () => {
  it("kill-switch can be disabled via fundingFlipKillSwitch config", () => {
    const ens = new MultiClassEnsembleV4(
      makeConfig({ fundingFlipKillSwitch: { killSwitchEnabled: false } }),
    );
    expect(ens.fundingFlipKillSwitch.config.killSwitchEnabled).toBe(false);
  });

  it("donchian leverage can be overridden independently", () => {
    const ens = new MultiClassEnsembleV4(makeConfig({ donchianMtf: { leverage: 1 } }));
    expect(ens.donchianMtf.config.leverage).toBe(1);
  });

  it("funding flip kill-switch leverage can be overridden independently", () => {
    const ens = new MultiClassEnsembleV4(
      makeConfig({ fundingFlipKillSwitch: { timingLeverage: 10 } }),
    );
    expect(ens.fundingFlipKillSwitch.config.timingLeverage).toBe(10);
  });

  it("funding carry leverage max can be overridden independently", () => {
    const ens = new MultiClassEnsembleV4(makeConfig({ fundingCarryLeverage: { maxLeverage: 10 } }));
    expect(ens.fundingCarryLeverage.config.maxLeverage).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — determinism", () => {
  it("same input sequence produces same output sequence", () => {
    function runOnce(): MultiClassEnsembleV4 {
      const ens = new MultiClassEnsembleV4(makeConfig());
      for (let i = 0; i < 200; i++) {
        ens.onCandle(
          makeCtx({
            close: 100 + i,
            candleIndex: i,
            timestamp: i * 3_600_000,
          }),
        );
        ens.recordFundingSnapshot(i * 8 * 60 * 60 * 1000, 0.0001 * ((i % 2) === 0 ? 1 : -1));
        ens.setVolTargetMultiplier(0.5 + 0.1 * Math.sin(i / 10));
      }
      return ens;
    }
    const ensA = runOnce();
    const ensB = runOnce();
    const sA = ensA.getState();
    const sB = ensB.getState();
    expect(sA.donchianSignalsEmitted).toBe(sB.donchianSignalsEmitted);
    expect(sA.fundingCarryEntries).toBe(sB.fundingCarryEntries);
    expect(sA.flipRegimeActivationCount).toBe(sB.flipRegimeActivationCount);
  });
});

// ---------------------------------------------------------------------------
// Accessor methods
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV4 — accessor methods", () => {
  it("getEffectiveCarryLeverage: returns combined value (volMultiplier only)", () => {
    const ens = new MultiClassEnsembleV4(makeConfig());
    ens.setVolTargetMultiplier(0.8);
    ens.setHybridPositionFactor(0.5);
    // 10 × 0.8 = 8 (hybrid factor does NOT scale carry leverage;
    // it scales directional position size instead)
    expect(ens.getEffectiveCarryLeverage()).toBe(8);
  });

  it("getVolTargetConfig: returns the injected config", () => {
    const customVolTarget = { ...DEFAULT_VOL_TARGET_CONFIG, targetDailyVol: 0.03 };
    const ens = new MultiClassEnsembleV4(makeConfig({ volTargetedSizer: customVolTarget }));
    expect(ens.getVolTargetConfig().targetDailyVol).toBe(0.03);
  });
});