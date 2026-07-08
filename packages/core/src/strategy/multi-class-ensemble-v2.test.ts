// packages/core/src/strategy/multi-class-ensemble-v2.test.ts — V2 ensemble tests
//
// Phase 7 M2 — a Phase 6 multi-class-ensemble.test.ts mintát követi
// (külön-külön minden V2 komponensre + end-to-end smoke test). A
// lefedettségi cél: minden V2-specifikus kódút (signal delegation,
// trailing-stop hook delegation, gate pause, state aggregation).

import { describe, expect, it } from "bun:test";

import type { Candle, Symbol } from "@mm-crypto-bot/shared/types";

import type {
  IndicatorState,
  MtfState,
  OpenPositionSnapshot,
  PositionManagementContext,
  StrategyContext,
} from "../types.js";
import { DEFAULT_LATENCY_GATE_DISABLED, type LatencyGate } from "./multi-class-ensemble.js";
import {
  DEFAULT_ADAPTIVE_KELLY_AGGREGATE,
  DEFAULT_MULTI_CLASS_ENSEMBLE_V2_CONFIG_PARTIAL,
  MultiClassEnsembleV2,
  timeframesForMultiClassV2,
  type AdaptiveKellyAggregate,
  type MultiClassEnsembleV2Config,
  type MultiClassEnsembleV2State,
} from "./multi-class-ensemble-v2.js";

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

function makeMtfState(close: number, atr?: number): MtfState {
  const base: IndicatorState = { close };
  const withAtr: IndicatorState = atr !== undefined ? { close, atr } : base;
  return { htf: withAtr, mtf: withAtr, ltf: withAtr };
}

function makeCtx(opts: {
  readonly close: number;
  readonly high?: number;
  readonly low?: number;
  readonly candleIndex?: number;
  readonly atr?: number;
}): StrategyContext {
  return {
    symbol: TEST_SYMBOL,
    timeframe: "1h",
    candleIndex: opts.candleIndex ?? 0,
    candle: makeCandle(opts.close, opts.high, opts.low, opts.candleIndex ?? 0),
    mtfState: makeMtfState(opts.close, opts.atr),
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
  readonly latencyGate?: LatencyGate;
  readonly adaptiveKelly?: Partial<AdaptiveKellyAggregate>;
} = {}): MultiClassEnsembleV2Config {
  return {
    ...DEFAULT_MULTI_CLASS_ENSEMBLE_V2_CONFIG_PARTIAL,
    latencyGate: overrides.latencyGate ?? DEFAULT_LATENCY_GATE_DISABLED,
    adaptiveKelly: { ...DEFAULT_ADAPTIVE_KELLY_AGGREGATE, ...overrides.adaptiveKelly },
  };
}

// ---------------------------------------------------------------------------
// V2 ensemble — construction + config
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV2 — construction + config", () => {
  it("default config: builds all 3 sub-strategies with sane defaults", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    expect(ens.donchian).toBeDefined();
    expect(ens.fundingCarry).toBeDefined();
    expect(ens.latencyGate).toBe(DEFAULT_LATENCY_GATE_DISABLED);
    expect(ens.adaptiveKelly.effectiveMultiplier).toBe(0.5);
    expect(ens.name).toContain("Phase 7 Multi-Class Ensemble V2");
    expect(ens.timeframes).toEqual(["1d", "4h", "1h"]);
  });

  it("warmup: returns max of all sub-strategy warmups (≥30)", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    expect(ens.warmup()).toBeGreaterThanOrEqual(30);
  });

  it("config: adaptiveKelly multiplier override (0.7) is accepted", () => {
    const ens = new MultiClassEnsembleV2(
      makeConfig({
        adaptiveKelly: { effectiveMultiplier: 0.7, recommendedMaxPositionPctEquity: 0.15 },
      }),
    );
    expect(ens.adaptiveKelly.effectiveMultiplier).toBe(0.7);
    expect(ens.adaptiveKelly.recommendedMaxPositionPctEquity).toBe(0.15);
  });

  it("config: latencyGate bypass (default disabled) — carry is always active", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    expect(ens.latencyGate.isCarryAllowed()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V2 ensemble — onCandle delegation
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV2 — onCandle delegation", () => {
  it("returns null when Donchian produces no signal (warmup period)", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    // Pre-warmup candle (no HTF data).
    const ctx = makeCtx({ close: 100, candleIndex: 0 });
    expect(ens.onCandle(ctx)).toBeNull();
  });

  it("initial state: no signals emitted, no carry candles yet", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    const state = ens.getState();
    expect(state.donchianSignalsEmitted).toBe(0);
    expect(state.fundingCarryActiveCandles).toBe(0);
  });

  it("name: contains all 3 sub-component references", () => {
    const ens = new MultiClassEnsembleV2(
      makeConfig({ adaptiveKelly: { effectiveMultiplier: 0.7 } }),
    );
    expect(ens.name).toContain("Donchian-Trailing");
    expect(ens.name).toContain("Adaptive-Kelly");
    expect(ens.name).toContain("Leveraged-Carry");
  });
});

// ---------------------------------------------------------------------------
// V2 ensemble — latency gate behavior
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV2 — latency gate", () => {
  it("default disabled gate: always allows carry (carries active on every candle)", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    const ctx = makeCtx({ close: 100, candleIndex: 0 });
    ens.onCandle(ctx);
    ens.onCandle(ctx);
    ens.onCandle(ctx);
    const state = ens.getState();
    expect(state.fundingCarryPausedCandles).toBe(0);
    expect(state.fundingCarryActiveCandles).toBe(3);
  });

  it("closed gate: pauses carry, no funding accrual", () => {
    const closedGate: LatencyGate = {
      snapshot: { pair: "test", roundTripMsMax: 9999, sourceJsonPath: "test.json" },
      arbThresholdMs: 100,
      isCarryAllowed: () => false,
    };
    const ens = new MultiClassEnsembleV2(makeConfig({ latencyGate: closedGate }));
    const ctx = makeCtx({ close: 100, candleIndex: 0 });
    ens.onCandle(ctx);
    ens.onCandle(ctx);
    const state = ens.getState();
    expect(state.fundingCarryPausedCandles).toBe(2);
    expect(state.fundingCarryActiveCandles).toBe(0);
    expect(state.latencyGateActiveFraction).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// V2 ensemble — position management delegation (Track A trailing-stop)
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV2 — position management delegation", () => {
  it("onPositionOpened delegates to DonchianTrailing (no exception)", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    const snapshot: OpenPositionSnapshot = {
      side: "buy",
      entryTime: 0,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 110,
      holdingBars: 0,
    };
    expect(() => ens.onPositionOpened(snapshot)).not.toThrow();
  });

  it("onPositionClosed delegates to DonchianTrailing (no exception)", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    expect(() => ens.onPositionClosed("trailing_stop")).not.toThrow();
  });

  it("onOpenPositionUpdate: HWM high → no trigger (price above HWM)", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
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
        close: 110, // above HWM (=100)
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 120,
        holdingBars: 5,
        atr: 2,
      }),
    );
    // No trigger expected — price (110) > HWM (100) and no trail breach.
    if (update !== null) {
      expect(update.forceExit).not.toBe(true);
    }
  });

  it("onOpenPositionUpdate: trail trigger → forceExit + trailingStopExits++", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    ens.onPositionOpened({
      side: "buy",
      entryTime: 0,
      entryPrice: 100,
      quantity: 1,
      stopLoss: 90,
      takeProfit: 120,
      holdingBars: 0,
    });
    // HWM rises to 110, then close (95) breaches 10% trail (HWM * 0.9 = 99).
    ens.onOpenPositionUpdate(
      makeOpenPositionCtx({
        side: "buy",
        close: 110,
        entryPrice: 100,
        stopLoss: 90,
        takeProfit: 120,
        holdingBars: 1,
        atr: 2,
      }),
    );
    const update2 = ens.onOpenPositionUpdate(
      makeOpenPositionCtx({
        side: "buy",
        close: 95, // < HWM*0.9 = 99
        entryPrice: 100,
        stopLoss: 90,
        takeProfit: 120,
        holdingBars: 2,
        atr: 2,
      }),
    );
    expect(update2).not.toBeNull();
    expect(update2?.forceExit).toBe(true);
    expect(update2?.reason).toBe("trailing_stop");
    expect(ens.getState().trailingStopExits).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// V2 ensemble — state aggregation
// ---------------------------------------------------------------------------

describe("MultiClassEnsembleV2 — state aggregation", () => {
  it("getState: all fields present and zeroed on fresh instance", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    const state: MultiClassEnsembleV2State = ens.getState();
    expect(state.donchianSignalsEmitted).toBe(0);
    expect(state.trailingStopExits).toBe(0);
    expect(state.fundingCarryUsd).toBe(0);
    expect(state.liquidationEvents).toBe(0);
    expect(state.dailyVaR95Pct).toBe(0);
    expect(state.effectiveLeverage).toBeGreaterThanOrEqual(1);
    expect(state.effectiveKellyMultiplier).toBe(0.5);
    expect(state.combinedEdgePct).toBe(0);
    expect(state.hadAllLossStreak).toBe(false);
  });

  it("getState: latencyGateActiveFraction is 1.0 with default disabled gate after onCandle calls", () => {
    const ens = new MultiClassEnsembleV2(makeConfig());
    ens.onCandle(makeCtx({ close: 100, candleIndex: 0 }));
    ens.onCandle(makeCtx({ close: 101, candleIndex: 1 }));
    const state = ens.getState();
    expect(state.latencyGateActiveFraction).toBe(1);
  });

  it("getState: reflects adaptiveKelly multiplier 0.7 when configured", () => {
    const ens = new MultiClassEnsembleV2(
      makeConfig({ adaptiveKelly: { effectiveMultiplier: 0.7 } }),
    );
    const state = ens.getState();
    expect(state.effectiveKellyMultiplier).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// V2 ensemble — helpers
// ---------------------------------------------------------------------------

describe("timeframesForMultiClassV2", () => {
  it("1h ltf → htf=1d, mtf=4h, ltf=1h", () => {
    expect(timeframesForMultiClassV2("1h")).toEqual({ htf: "1d", mtf: "4h", ltf: "1h" });
  });

  it("4h ltf → htf=1d, mtf=4h, ltf=4h", () => {
    expect(timeframesForMultiClassV2("4h")).toEqual({ htf: "1d", mtf: "4h", ltf: "4h" });
  });

  it("1d ltf → htf=1d, mtf=4h, ltf=1d", () => {
    expect(timeframesForMultiClassV2("1d")).toEqual({ htf: "1d", mtf: "4h", ltf: "1d" });
  });

  it("unsupported ltf → throws", () => {
    expect(() =>
      timeframesForMultiClassV2("5m" as unknown as "1h" | "4h" | "1d"),
    ).toThrow();
  });
});
