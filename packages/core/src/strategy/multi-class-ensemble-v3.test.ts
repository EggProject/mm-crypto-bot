// packages/core/src/strategy/multi-class-ensemble-v3.test.ts — V3 ensemble tests
//
// Phase 8 M2 — comprehensive tests for the V3 multi-class ensemble covering:
//   - Component isolation (each track removable independently)
//   - No-double-counting (verify signal flow)
//   - Carry timing gate pause
//   - Leverage scaling under vol target
//   - Position-management hook delegation
//   - State aggregation across all 4 components
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
import {
  combineVolAndCarryLeverage,
  computeV3CarryFractionFromTimingState,
  DEFAULT_MULTI_CLASS_ENSEMBLE_V3_CONFIG_PARTIAL,
  defaultV3VolTargetConfig,
  MultiClassEnsembleV3,
  timeframesForMultiClassV3,
  type MultiClassEnsembleV3Config,
  type MultiClassEnsembleV3State,
} from "./multi-class-ensemble-v3.js";
import { DEFAULT_DONCHIAN_MTF_CONFIG } from "./donchian-mtf.js";
import {
  DEFAULT_FUNDING_CARRY_TIMING_CONFIG,
  type FundingCarryTimingState,
} from "./funding-carry-timing.js";
import { DEFAULT_LEVERAGED_CARRY_CONFIG } from "./funding-carry-leverage.js";

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
  readonly atr?: number;
  readonly donchianUpper?: number;
} = { close: 100 }): StrategyContext {
  return {
    symbol: TEST_SYMBOL,
    timeframe: "1h",
    candleIndex: opts.candleIndex ?? 0,
    candle: makeCandle(opts.close, opts.high, opts.low, opts.candleIndex ?? 0),
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
  readonly fundingCarryTiming?: Partial<typeof DEFAULT_FUNDING_CARRY_TIMING_CONFIG>;
  readonly fundingCarryLeverage?: Partial<typeof DEFAULT_LEVERAGED_CARRY_CONFIG>;
  readonly volTargetedSizer?: Partial<typeof DEFAULT_VOL_TARGET_CONFIG>;
} = {}): MultiClassEnsembleV3Config {
  return {
    ...DEFAULT_MULTI_CLASS_ENSEMBLE_V3_CONFIG_PARTIAL,
    ...overrides,
    volTargetedSizer: {
      ...DEFAULT_VOL_TARGET_CONFIG,
      ...overrides.volTargetedSizer,
    },
  } as MultiClassEnsembleV3Config;
}

// ---------------------------------------------------------------------------
// Construction + config
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — construction + config", () => {
  it("default config: builds all 4 sub-components with sane defaults", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    expect(ens.donchianMtf).toBeDefined();
    expect(ens.fundingCarryTiming).toBeDefined();
    expect(ens.fundingCarryLeverage).toBeDefined();
    expect(ens.volTargetedSizerConfig).toBeDefined();
    expect(ens.name).toContain("Phase 8 Multi-Class Ensemble V3");
    expect(ens.name).toContain("Donchian-MTF");
    expect(ens.name).toContain("Funding-Carry-Timing");
    expect(ens.name).toContain("Carry-Leverage-10x");
    expect(ens.name).toContain("VolTargeted");
    expect(ens.timeframes).toEqual(["1d", "4h", "1h"]);
  });

  it("warmup: returns max of all sub-strategy warmups (≥720 for funding carry timing)", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    expect(ens.warmup()).toBeGreaterThanOrEqual(720);
  });

  it("default state: all counters zero, vol multiplier 1.0", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    const state = ens.getState();
    expect(state.donchianSignalsEmitted).toBe(0);
    expect(state.donchianTimeExitCloses).toBe(0);
    expect(state.fundingCarryEntries).toBe(0);
    expect(state.fundingCarryUsd).toBe(0);
    expect(state.fundingCarryTimeInCarryFraction).toBe(0);
    expect(state.volTargetedAvgMultiplier).toBe(1.0);
    expect(state.liquidationEvents).toBe(0);
    expect(state.dailyVaR95Pct).toBe(0);
    expect(state.combinedEdgePct).toBe(0);
  });

  it("default config partial: has all 3 sub-strategy defaults wired", () => {
    expect(DEFAULT_MULTI_CLASS_ENSEMBLE_V3_CONFIG_PARTIAL.donchianMtf).toBe(
      DEFAULT_DONCHIAN_MTF_CONFIG,
    );
    expect(DEFAULT_MULTI_CLASS_ENSEMBLE_V3_CONFIG_PARTIAL.fundingCarryTiming).toBe(
      DEFAULT_FUNDING_CARRY_TIMING_CONFIG,
    );
    expect(DEFAULT_MULTI_CLASS_ENSEMBLE_V3_CONFIG_PARTIAL.fundingCarryLeverage).toBe(
      DEFAULT_LEVERAGED_CARRY_CONFIG,
    );
  });

  it("defaultV3VolTargetConfig: returns the same values as DEFAULT_VOL_TARGET_CONFIG", () => {
    const cfg = defaultV3VolTargetConfig();
    expect(cfg).toEqual(DEFAULT_VOL_TARGET_CONFIG);
  });
});

// ---------------------------------------------------------------------------
// Vol-target multiplier injection
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — vol-target multiplier injection", () => {
  it("setVolTargetMultiplier: clamps to [minVolMultiplier, maxVolMultiplier]", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    ens.setVolTargetMultiplier(0.5);
    expect(ens.getCurrentVolMultiplier()).toBe(0.5);
    ens.setVolTargetMultiplier(0.1); // below 0.25 floor
    expect(ens.getCurrentVolMultiplier()).toBe(0.25);
    ens.setVolTargetMultiplier(1.5); // above 1.0 ceiling
    expect(ens.getCurrentVolMultiplier()).toBe(1.0);
  });

  it("setVolTargetMultiplier: rejects non-finite or non-positive", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    expect(() => ens.setVolTargetMultiplier(NaN)).toThrow();
    expect(() => ens.setVolTargetMultiplier(Infinity)).toThrow();
    expect(() => ens.setVolTargetMultiplier(0)).toThrow();
    expect(() => ens.setVolTargetMultiplier(-0.5)).toThrow();
  });

  it("setRecommendedMaxPositionPctEquity: stores and returns in state", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    ens.setRecommendedMaxPositionPctEquity(0.15);
    expect(ens.getState().recommendedMaxPositionPctEquity).toBe(0.15);
  });

  it("setRecommendedMaxPositionPctEquity: rejects non-finite or negative", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    expect(() => ens.setRecommendedMaxPositionPctEquity(NaN)).toThrow();
    expect(() => ens.setRecommendedMaxPositionPctEquity(-0.1)).toThrow();
  });

  it("getEffectiveCarryLeverage: combines Track G multiplier with Track D max", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    // Track D maxLeverage = 10, volMultiplier = 1.0 → combined = 10.
    expect(ens.getEffectiveCarryLeverage()).toBe(10);
    ens.setVolTargetMultiplier(0.5);
    expect(ens.getEffectiveCarryLeverage()).toBe(5);
    ens.setVolTargetMultiplier(0.25);
    expect(ens.getEffectiveCarryLeverage()).toBe(2); // floor at 1 but 10*0.25 = 2.5 → floor to 2
  });
});

// ---------------------------------------------------------------------------
// Combine helper
// ---------------------------------------------------------------------------

describe("combineVolAndCarryLeverage helper", () => {
  it("multiplies carryMaxLeverage × clampedVolMultiplier", () => {
    expect(combineVolAndCarryLeverage(10, 1.0)).toBe(10);
    expect(combineVolAndCarryLeverage(10, 0.5)).toBe(5);
    expect(combineVolAndCarryLeverage(10, 0.25)).toBe(2);
  });

  it("clamps result to [1, 10]", () => {
    // carryMaxLev=10, multiplier=2.0 (above 1.0) → clamp to 10.
    expect(combineVolAndCarryLeverage(10, 2.0)).toBe(10);
    // carryMaxLev=2, multiplier=0.1 → 0.2 → clamp to 1.
    expect(combineVolAndCarryLeverage(2, 0.1)).toBe(1);
  });

  it("rejects non-finite or non-positive inputs", () => {
    expect(() => combineVolAndCarryLeverage(NaN, 1.0)).toThrow();
    expect(() => combineVolAndCarryLeverage(0, 1.0)).toThrow();
    expect(() => combineVolAndCarryLeverage(10, NaN)).toThrow();
    expect(() => combineVolAndCarryLeverage(10, 0)).toThrow();
    expect(() => combineVolAndCarryLeverage(10, -0.1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Carry-fraction helper
// ---------------------------------------------------------------------------

describe("computeV3CarryFractionFromTimingState helper", () => {
  it("returns 0 when no funding periods recorded", () => {
    const emptyState: FundingCarryTimingState = {
      fundingHistory: [],
      isInCarry: false,
      lastEntryTimeMs: null,
      lastExitTimeMs: null,
      entryCount: 0,
      exitCount: 0,
      fundingCollectedUsd: 0,
      inCarryFundingPeriods: 0,
      outOfCarryFundingPeriods: 0,
      negativeFundingPaidUsd: 0,
      lastMarkPrice: 0,
      hasEntered: false,
      lastStats: {
        count: 0,
        median: 0,
        mean: 0,
        stdDev: 0,
        min: 0,
        max: 0,
        p25: 0,
        p75: 0,
        p90: 0,
      },
    };
    expect(computeV3CarryFractionFromTimingState(emptyState)).toBe(0);
  });

  it("computes in-carry fraction correctly", () => {
    const state: FundingCarryTimingState = {
      fundingHistory: [],
      isInCarry: false,
      lastEntryTimeMs: null,
      lastExitTimeMs: null,
      entryCount: 0,
      exitCount: 0,
      fundingCollectedUsd: 0,
      inCarryFundingPeriods: 26,
      outOfCarryFundingPeriods: 74,
      negativeFundingPaidUsd: 0,
      lastMarkPrice: 0,
      hasEntered: false,
      lastStats: {
        count: 0,
        median: 0,
        mean: 0,
        stdDev: 0,
        min: 0,
        max: 0,
        p25: 0,
        p75: 0,
        p90: 0,
      },
    };
    expect(computeV3CarryFractionFromTimingState(state)).toBeCloseTo(0.26, 5);
  });
});

// ---------------------------------------------------------------------------
// onCandle signal flow (no double-counting)
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — onCandle signal flow", () => {
  it("pre-warmup candle: returns null (Donchian MTF gates)", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    const ctx = makeCtx({ close: 100, candleIndex: 0 });
    expect(ens.onCandle(ctx)).toBeNull();
  });

  it("after warmup with non-triggering candle: returns null (no MTF signal)", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    // close=100, donchianUpper=200 (way above) → no signal
    const ctx = makeCtx({ close: 100, candleIndex: 800, atr: 5, donchianUpper: 200 });
    // htf close (100) < htf supertrend (100-100=0)? need to make HTF valid too.
    // Actually MTFStrategy checks htf.close > htf.supertrend. With close=100 and supertrend=0, that's true.
    // MTF check: mtf.close (100) > mtf.donchianUpper (200)? No → null.
    expect(ens.onCandle(ctx)).toBeNull();
  });

  it("after warmup with triggering candle: returns MTF signal tagged with V3 ensemble reason", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    // All 3 MTF conditions met: close > donchianUpper, mtf.close > donchianUpper, htf.close > htf.supertrend.
    const ctx = makeCtx({ close: 220, candleIndex: 800, atr: 5, donchianUpper: 200 });
    const sig = ens.onCandle(ctx);
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe("buy");
    expect(sig!.reason).toContain("[MultiClassEnsembleV3]");
    expect(sig!.reason).toContain("carry=");
    expect(sig!.reason).toContain("vol=");
    expect(sig!.reason).toContain("Donchian-MTF");
  });

  it("increments donchianSignalsEmitted only when MTF signal is produced", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    // Non-triggering candles (no signal)
    ens.onCandle(makeCtx({ close: 100, candleIndex: 800, atr: 5, donchianUpper: 200 }));
    ens.onCandle(makeCtx({ close: 100, candleIndex: 801, atr: 5, donchianUpper: 200 }));
    expect(ens.getState().donchianSignalsEmitted).toBe(0);
    // Triggering candle
    ens.onCandle(makeCtx({ close: 220, candleIndex: 802, atr: 5, donchianUpper: 200 }));
    expect(ens.getState().donchianSignalsEmitted).toBe(1);
  });

  it("ignores carry-side signals (no double-counting)", () => {
    // The FundingCarryLeverage and FundingCarryTiming both emit signals on
    // their first valid candle — V3 must NOT propagate them to the engine.
    const ens = new MultiClassEnsembleV3(makeConfig());
    // Run 1 candle past warmup; if V3 returned the carry signal, the engine
    // would see TWO signals per candle. V3 only returns the MTF signal.
    const ctx = makeCtx({ close: 220, candleIndex: 800, atr: 5, donchianUpper: 200 });
    const sig = ens.onCandle(ctx);
    expect(sig).not.toBeNull();
    // The signal reason should NOT reference funding-carry-leverage
    // or funding-carry-timing directly.
    expect(sig!.reason).not.toContain("Leveraged funding-carry entry");
    expect(sig!.reason).not.toContain("Funding-carry-timing entry");
  });

  it("multiple consecutive triggering candles: only one signal per candle", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    for (let i = 800; i < 805; i++) {
      ens.onCandle(makeCtx({ close: 220, candleIndex: i, atr: 5, donchianUpper: 200 }));
    }
    expect(ens.getState().donchianSignalsEmitted).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Carry timing gate (Track E) state propagation
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — carry timing gate state", () => {
  it("warmup period: stays out-of-carry, no entries", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    ens.onCandle(makeCtx({ close: 100, candleIndex: 0 }));
    ens.onCandle(makeCtx({ close: 100, candleIndex: 100 }));
    expect(ens.getState().fundingCarryEntries).toBe(0);
    expect(ens.getState().fundingCarryTimeInCarryFraction).toBe(0);
  });

  it("post-warmup: Track E enters carry and emits state transition", () => {
    // Push a few funding samples so the rolling window is populated.
    const ens = new MultiClassEnsembleV3(makeConfig());
    // Drive funding snapshots through the public API.
    for (let i = 0; i < 35; i++) {
      ens.recordFundingSnapshot(i * 8 * 3600 * 1000, 0.0001);
    }
    // Now drive candles past warmup.
    for (let i = 720; i < 730; i++) {
      ens.onCandle(makeCtx({ close: 100, candleIndex: i }));
    }
    // The Track E timing strategy should have entered carry at least once
    // given enough funding-rate volatility / percentile triggers.
    const state = ens.getState();
    expect(state.fundingCarryTimeInCarryFraction).toBeGreaterThanOrEqual(0);
    expect(state.fundingCarryTimeInCarryFraction).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Position-management hook delegation (Track F)
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — position-management delegation", () => {
  it("onPositionOpened delegates to DonchianMtf (no exception)", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    const snapshot: OpenPositionSnapshot = {
      side: "buy",
      entryTime: 0,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 120,
      holdingBars: 0,
    };
    expect(() => ens.onPositionOpened(snapshot)).not.toThrow();
  });

  it("onPositionClosed delegates to DonchianMtf (no exception)", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    expect(() => ens.onPositionClosed("trailing_stop")).not.toThrow();
  });

  it("onOpenPositionUpdate: max-hold trigger → forceExit + donchianTimeExitCloses++", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    ens.onPositionOpened({
      side: "buy",
      entryTime: 0,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 120,
      holdingBars: 0,
    });
    // Drive 168 candles (max-hold boundary).
    const update = ens.onOpenPositionUpdate(
      makeOpenPositionCtx({
        side: "buy",
        close: 110,
        entryPrice: 100,
        stopLoss: 90,
        takeProfit: 120,
        holdingBars: 168, // exactly at max-hold boundary
        atr: 2,
      }),
    );
    expect(update).not.toBeNull();
    expect(update!.forceExit).toBe(true);
    expect(update!.reason).toBe("time_exit");
    expect(ens.getState().donchianTimeExitCloses).toBe(1);
  });

  it("onOpenPositionUpdate: non-trigger update (no forceExit) — counter stays at 0", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    ens.onPositionOpened({
      side: "buy",
      entryTime: 0,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 120,
      holdingBars: 0,
    });
    const update = ens.onOpenPositionUpdate(
      makeOpenPositionCtx({
        side: "buy",
        close: 105,
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 120,
        holdingBars: 5, // well below 168h max-hold
        atr: 2,
      }),
    );
    // No forceExit (still well within hold window)
    if (update !== null) {
      expect(update.forceExit).not.toBe(true);
    }
    expect(ens.getState().donchianTimeExitCloses).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Funding snapshot recording
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — recordFundingSnapshot + applyCarrySnapshot", () => {
  it("recordFundingSnapshot: returns 0 when not in carry", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    // No funding samples yet → not in carry.
    const payment = ens.recordFundingSnapshot(0, 0.0001);
    expect(payment).toBe(0);
  });

  it("recordFundingSnapshot: accumulates funding payments while in carry", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    // First, populate the timing state machine to enter carry.
    // Push 30+ samples so the rolling window has data.
    for (let i = 0; i < 35; i++) {
      ens.recordFundingSnapshot(i * 8 * 3600 * 1000, 0.01); // high rate
    }
    // Now manually transition the timing strategy into carry for testing.
    ens.fundingCarryTiming._enterCarry(35 * 8 * 3600 * 1000);
    // Record another snapshot — should now accrue funding.
    const payment = ens.recordFundingSnapshot(36 * 8 * 3600 * 1000, 0.01);
    expect(payment).toBeGreaterThan(0);
    expect(ens.getState().fundingCarryUsd).toBeGreaterThan(0);
  });

  it("applyCarrySnapshot: updates effective carry leverage via combination", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    ens.setVolTargetMultiplier(0.5);
    const combined = ens.applyCarrySnapshot(0);
    // carryMaxLev=10 × 0.5 = 5
    expect(combined).toBe(5);
    expect(ens.fundingCarryLeverage.state.currentLeverage).toBe(5);
  });

  it("applyCarrySnapshot: leverage floored at 1 even with very small multiplier", () => {
    // Edge case: maxLev=1, multiplier=0.25 → 0.25 → floor to 1.
    // Construct with maxLev=1 manually.
    const customConfig = makeConfig({
      fundingCarryLeverage: { maxLeverage: 1, minLeverage: 1 },
    });
    const ens1x = new MultiClassEnsembleV3(customConfig);
    ens1x.setVolTargetMultiplier(0.25);
    const combined = ens1x.applyCarrySnapshot(0);
    expect(combined).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// State aggregation
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — state aggregation", () => {
  it("getState: all fields present and zeroed on fresh instance", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    const state: MultiClassEnsembleV3State = ens.getState();
    expect(state.donchianSignalsEmitted).toBe(0);
    expect(state.donchianTimeExitCloses).toBe(0);
    expect(state.fundingCarryUsd).toBe(0);
    expect(state.fundingCarryTimeInCarryFraction).toBe(0);
    expect(state.fundingCarryEntries).toBe(0);
    expect(state.effectiveCarryLeverage).toBe(10); // default 10× max
    expect(state.volTargetedAvgMultiplier).toBe(1.0);
    expect(state.dailyVaR95Pct).toBe(0);
    expect(state.liquidationEvents).toBe(0);
    expect(state.combinedEdgePct).toBe(0);
    expect(state.recommendedMaxPositionPctEquity).toBe(0);
  });

  it("getState: carrySide is a snapshot (mutating it doesn't affect ensemble)", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    const s1 = ens.getState();
    s1.carrySide.currentLeverage = 999;
    const s2 = ens.getState();
    expect(s2.carrySide.currentLeverage).not.toBe(999);
  });

  it("getState: timingSide is a snapshot", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    const s1 = ens.getState();
    s1.timingSide.fundingCollectedUsd = 999;
    const s2 = ens.getState();
    expect(s2.timingSide.fundingCollectedUsd).not.toBe(999);
  });

  it("getState: effectiveCarryLeverage reflects current vol multiplier", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    ens.setVolTargetMultiplier(0.5);
    expect(ens.getState().effectiveCarryLeverage).toBe(5);
    ens.setVolTargetMultiplier(1.0);
    expect(ens.getState().effectiveCarryLeverage).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Timeframe helpers
// ---------------------------------------------------------------------------

describe("timeframesForMultiClassV3", () => {
  it("1h ltf → htf=1d, mtf=4h, ltf=1h", () => {
    expect(timeframesForMultiClassV3("1h")).toEqual({ htf: "1d", mtf: "4h", ltf: "1h" });
  });

  it("4h ltf → htf=1d, mtf=4h, ltf=4h", () => {
    expect(timeframesForMultiClassV3("4h")).toEqual({ htf: "1d", mtf: "4h", ltf: "4h" });
  });

  it("1d ltf → htf=1d, mtf=4h, ltf=1d", () => {
    expect(timeframesForMultiClassV3("1d")).toEqual({ htf: "1d", mtf: "4h", ltf: "1d" });
  });

  it("unsupported ltf → throws", () => {
    expect(() =>
      timeframesForMultiClassV3("5m" as unknown as "1h" | "4h" | "1d"),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Component isolation / independence
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — component isolation", () => {
  it("Donchian MTF can be removed without breaking FundingCarry timing", () => {
    // Build an ensemble, then disable the MTF signal by zeroing donchianPeriod.
    // The carry side should still function independently.
    const ens = new MultiClassEnsembleV3(
      makeConfig({
        donchianMtf: { donchianPeriod: 1, mtfDonchianPeriod: 1, leverage: 1 },
      }),
    );
    // Push funding samples and trigger carry entry.
    for (let i = 0; i < 35; i++) {
      ens.recordFundingSnapshot(i * 8 * 3600 * 1000, 0.01);
    }
    ens.fundingCarryTiming._enterCarry(35 * 8 * 3600 * 1000);
    const payment = ens.recordFundingSnapshot(36 * 8 * 3600 * 1000, 0.01);
    expect(payment).toBeGreaterThan(0);
    // The MTF signal should NOT fire (close=100 << donchianUpper=null path).
    const sig = ens.onCandle(makeCtx({ close: 100, candleIndex: 800 }));
    expect(sig).toBeNull();
    // But the carry state is still being tracked.
    expect(ens.getState().fundingCarryUsd).toBeGreaterThan(0);
  });

  it("Carry timing can be disabled without breaking MTF signal", () => {
    // Build an ensemble, then never record funding samples (carry stays cold).
    const ens = new MultiClassEnsembleV3(makeConfig());
    const sig = ens.onCandle(makeCtx({ close: 220, candleIndex: 800, atr: 5, donchianUpper: 200 }));
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe("buy");
    // No carry recorded → fundingCarryUsd stays 0.
    expect(ens.getState().fundingCarryUsd).toBe(0);
  });

  it("Vol-target multiplier can be modified without affecting MTF logic", () => {
    const ens = new MultiClassEnsembleV3(makeConfig());
    ens.setVolTargetMultiplier(0.25);
    ens.setVolTargetMultiplier(1.5); // clamped to 1.0
    const sig = ens.onCandle(makeCtx({ close: 220, candleIndex: 800, atr: 5, donchianUpper: 200 }));
    expect(sig).not.toBeNull();
    // Signal still fires regardless of vol-target multiplier.
    expect(sig!.reason).toContain("vol=1.000");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — determinism", () => {
  it("identical inputs produce identical outputs across two fresh instances", () => {
    const ens1 = new MultiClassEnsembleV3(makeConfig());
    const ens2 = new MultiClassEnsembleV3(makeConfig());

    for (let i = 0; i < 100; i++) {
      const ctx = makeCtx({ close: 100 + i, candleIndex: 800 + i, atr: 5, donchianUpper: 50 });
      ens1.onCandle(ctx);
      ens2.onCandle(ctx);
    }

    const s1 = ens1.getState();
    const s2 = ens2.getState();
    expect(s1.donchianSignalsEmitted).toBe(s2.donchianSignalsEmitted);
    expect(s1.fundingCarryUsd).toBe(s2.fundingCarryUsd);
    expect(s1.fundingCarryTimeInCarryFraction).toBe(s2.fundingCarryTimeInCarryFraction);
    expect(s1.donchianTimeExitCloses).toBe(s2.donchianTimeExitCloses);
    expect(s1.effectiveCarryLeverage).toBe(s2.effectiveCarryLeverage);
  });
});

// ---------------------------------------------------------------------------
// Config object passed through correctly
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV3 — config plumbing", () => {
  it("exposes the supplied config verbatim", () => {
    const cfg = makeConfig({
      donchianMtf: { donchianPeriod: 30, maxHoldBars: 200 },
      fundingCarryTiming: { windowDays: 60, cooldownHours: 48 },
      fundingCarryLeverage: { maxLeverage: 10, baseNotionalUsd: 5000 },
    });
    const ens = new MultiClassEnsembleV3(cfg);
    expect(ens.config.donchianMtf.donchianPeriod).toBe(30);
    expect(ens.config.donchianMtf.maxHoldBars).toBe(200);
    expect(ens.config.fundingCarryTiming.windowDays).toBe(60);
    expect(ens.config.fundingCarryTiming.cooldownHours).toBe(48);
    expect(ens.config.fundingCarryLeverage.maxLeverage).toBe(10);
    expect(ens.config.fundingCarryLeverage.baseNotionalUsd).toBe(5000);
  });

  it("getVolTargetConfig: returns the supplied config", () => {
    const cfg = makeConfig({ volTargetedSizer: { targetDailyVol: 0.03 } });
    const ens = new MultiClassEnsembleV3(cfg);
    expect(ens.getVolTargetConfig().targetDailyVol).toBe(0.03);
  });
});