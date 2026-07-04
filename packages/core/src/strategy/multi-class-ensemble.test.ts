// packages/core/src/strategy/multi-class-ensemble.test.ts — Multi-class ensemble unit tests
//
// Phase 6 M2 — Verifies:
//   1. Component isolation (Donchian and FundingCarry can each be accessed standalone)
//   2. Ensemble signal aggregation (Donchian signal is the primary output;
//      carry does NOT inject signals into the engine — no double-counting)
//   3. Kelly-opt sizing propagates to `kellyOpt` field and `getState()`
//   4. Latency gate: if cross-exchange latency > arb threshold, the carry
//      component's funding does NOT accrue on that candle
//   5. Warmup is the max of the component warmups
//   6. The ensemble does NOT modify the Donchian signal's confidence
//   7. The ensemble adds the "carry=active|paused" prefix to the reason
//   8. getState() exposes the combined-edge metrics for the CLI runner

import { describe, expect, it } from "bun:test";

import type { StrategyContext } from "../types.js";

import {
  createLatencyGate,
  DEFAULT_KELLY_OPT_AGGREGATE,
  DEFAULT_LATENCY_GATE_DISABLED,
  DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
  MultiClassEnsemble,
  timeframesForMultiClass,
} from "./multi-class-ensemble.js";

// ---------------------------------------------------------------------------
// Test helpers — minimal mock contexts for the ensemble's onCandle
// ---------------------------------------------------------------------------

/**
 * `makeCtx` — builds a minimal `StrategyContext` for one LTF candle. The
 * mtfState values are valid (HTF Donchian upper/lower set, LTF ATR + volMA
 * set) so the Donchian breakout will produce a signal if a crossover is
 * indicated.
 *
 * For LONG breakout: close > mtf.donchianUpper AND volume > volumeMa * 1.5
 * For SHORT breakout: close < mtf.donchianLower AND volume > volumeMa * 1.5
 */
function makeCtx(opts: {
  readonly candleIndex: number;
  readonly close: number;
  readonly volume: number;
  readonly donchianUpper?: number;
  readonly donchianLower?: number;
  readonly atr?: number;
  readonly volumeMa?: number;
  readonly ema50?: number;
  readonly ema200?: number;
}): StrategyContext {
  const upper = opts.donchianUpper ?? 110;
  const lower = opts.donchianLower ?? 90;
  return {
    symbol: "BTC/USDC" as never,
    timeframe: "1h",
    candleIndex: opts.candleIndex,
    candle: {
      timestamp: 1_700_000_000_000 + opts.candleIndex * 3_600_000,
      open: opts.close,
      high: opts.close * 1.001,
      low: opts.close * 0.999,
      close: opts.close,
      volume: opts.volume,
    },
    mtfState: {
      htf: {
        close: opts.close,
        donchianUpper: upper,
        donchianLower: lower,
        ema50: opts.ema50 ?? 100,
        ema200: opts.ema200 ?? 95,
      },
      mtf: {
        close: opts.close,
        donchianUpper: upper,
        donchianLower: lower,
      },
      ltf: {
        close: opts.close,
        atr: opts.atr ?? 1,
        volumeMa: opts.volumeMa ?? 100,
      },
    },
    pricePrecision: 2,
  };
}

// ---------------------------------------------------------------------------
// 1. Component isolation — each strategy is reachable as a public field
// ---------------------------------------------------------------------------

describe("MultiClassEnsemble — component isolation", () => {
  it("exposes DonchianBreakoutStrategy as a public field, runnable standalone", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    expect(ens.donchian).toBeDefined();
    expect(ens.donchian.name).toContain("Donchian");
    // The Donchian is independently instantiable and produces a signal on a breakout candle.
    const sig = ens.donchian.onCandle(
      makeCtx({ candleIndex: 100, close: 120, volume: 1000, volumeMa: 100 }),
    );
    expect(sig).not.toBeNull();
    expect(sig?.side).toBe("buy");
  });

  it("exposes FundingCarryStrategy as a public field, runnable standalone", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    expect(ens.fundingCarry).toBeDefined();
    expect(ens.fundingCarry.name).toContain("Funding");
    // The carry strategy has its own state and can accrue funding.
    const ctx = makeCtx({ candleIndex: 100, close: 100, volume: 1000, volumeMa: 100 });
    const sig = ens.fundingCarry.onCandle(ctx);
    // After the first onCandle, the one-shot entry has flipped.
    // We verify the state fields are reachable and that the entry signal
    // is emitted on the first call (or null if warmup blocked it).
    expect(ens.fundingCarry.state.fundingCollectedUsd).toBe(0);
    expect(typeof ens.fundingCarry.state.hasEntered).toBe("boolean");
    // The signal is null OR set on the first call; either way the state is reachable.
    void sig;
  });

  it("exposes latencyGate and kellyOpt as public fields (no state coupling)", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    expect(ens.latencyGate.isCarryAllowed()).toBe(true);
    expect(ens.kellyOpt.kellyMultiplier).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// 2. Ensemble signal aggregation — no double-counting
// ---------------------------------------------------------------------------

describe("MultiClassEnsemble — signal aggregation (no double-counting)", () => {
  it("returns the Donchian signal when present (does NOT modify confidence)", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    // Warmup: 30 candles. Use candleIndex = 35 to ensure the Donchian is warm.
    const ctx = makeCtx({
      candleIndex: 35,
      close: 120, // > donchianUpper (110)
      volume: 1000,
      volumeMa: 100,
      donchianUpper: 110,
      donchianLower: 90,
    });
    const sig = ens.onCandle(ctx);
    expect(sig).not.toBeNull();
    expect(sig?.side).toBe("buy");
    // The Donchian's confidence (0.9) is NOT modified by the ensemble.
    expect(sig?.confidence).toBe(ens.donchian.onCandle(ctx)?.confidence);
    // The ensemble prefixes the reason with [MultiClassEnsemble].
    expect(sig?.reason).toMatch(/^\[MultiClassEnsemble\] carry=active \| /);
  });

  it("returns null when the Donchian does not produce a signal (carry is state-only)", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    // Warmup done but close is INSIDE the Donchian channel — no breakout.
    const ctx = makeCtx({
      candleIndex: 35,
      close: 100, // between lower (90) and upper (110)
      volume: 1000,
      volumeMa: 100,
      donchianUpper: 110,
      donchianLower: 90,
    });
    const sig = ens.onCandle(ctx);
    expect(sig).toBeNull();
  });

  it("the carry component NEVER injects a directional signal into the ensemble output", () => {
    // Even when the carry component itself has internal state and could
    // emit its one-shot "buy" signal, the ensemble output should be the
    // Donchian signal ONLY (or null). No double-counting.
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    // Force the carry to have entered by pre-warming its state.
    ens.fundingCarry.state.hasEntered = true;
    // Then a Donchian-breakout candle — ensemble output is the Donchian
    // signal, NOT the carry's earlier "buy".
    const ctx = makeCtx({
      candleIndex: 35,
      close: 120,
      volume: 1000,
      volumeMa: 100,
      donchianUpper: 110,
      donchianLower: 90,
    });
    const sig = ens.onCandle(ctx);
    expect(sig).not.toBeNull();
    expect(sig?.side).toBe("buy");
    expect(sig?.reason).toMatch(/MultiClassEnsemble/);
    // The carry's funding state was NOT used to override the signal.
    expect(sig?.confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Kelly-opt sizing — propagates to ensemble state
// ---------------------------------------------------------------------------

describe("MultiClassEnsemble — Kelly-opt sizing propagation", () => {
  it("the kellyOpt field is exposed via the public API and getState()", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: {
        kellyMultiplier: 0.5,
        recommendedMaxPositionPctEquity: 0.18,
        winRate: 0.6,
        winLossRatio: 1.5,
      },
    });
    expect(ens.kellyOpt.kellyMultiplier).toBe(0.5);
    expect(ens.kellyOpt.recommendedMaxPositionPctEquity).toBe(0.18);
    const state = ens.getState();
    expect(state.kellyMultiplier).toBe(0.5);
    // combinedEdgePct is left at 0 here; CLI runner computes it.
    expect(state.combinedEdgePct).toBe(0);
  });

  it("the strategy does NOT scale the position size itself (the Kelly sizing is external)", () => {
    // The ensemble's onCandle returns the Donchian signal with the same
    // stop-loss / take-profit as the standalone Donchian. The Kelly sizing
    // is applied externally via BacktestOptions.positionSize.
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: {
        kellyMultiplier: 1.0,
        recommendedMaxPositionPctEquity: 0.5,
        winRate: 0.7,
        winLossRatio: 2.0,
      },
    });
    const ctx = makeCtx({
      candleIndex: 35,
      close: 120,
      volume: 1000,
      volumeMa: 100,
      donchianUpper: 110,
      donchianLower: 90,
      atr: 2,
    });
    const sig = ens.onCandle(ctx);
    const standalone = ens.donchian.onCandle(ctx);
    expect(sig?.stopLoss).toBe(standalone?.stopLoss);
    expect(sig?.takeProfit).toBe(standalone?.takeProfit);
  });
});

// ---------------------------------------------------------------------------
// 4. Latency gate — gates the carry component
// ---------------------------------------------------------------------------

describe("MultiClassEnsemble — latency gate", () => {
  it("when the latency gate is OPEN, the carry component is invoked", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED, // always OPEN
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    const ctx = makeCtx({
      candleIndex: 35,
      close: 100, // no Donchian breakout — Donchian returns null
      volume: 1000,
      volumeMa: 100,
    });
    ens.onCandle(ctx);
    const state = ens.getState();
    expect(state.fundingCarryActiveCandles).toBe(1);
    expect(state.fundingCarryPausedCandles).toBe(0);
    expect(state.latencyGateActiveFraction).toBe(1);
  });

  it("when the latency gate is CLOSED (round-trip > threshold), the carry does NOT accrue", () => {
    const gate = createLatencyGate(
      {
        pair: "binance-bybit-btc",
        roundTripMsMax: 5000, // way above 500ms threshold
        roundTripMsMedian: 3000,
        sourceJsonPath: "backtest-results/arb-latency-binance-bybit-btc-sample.json",
      },
      500,
    );
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: gate,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    expect(gate.isCarryAllowed()).toBe(false);
    const ctx = makeCtx({
      candleIndex: 35,
      close: 100,
      volume: 1000,
      volumeMa: 100,
    });
    ens.onCandle(ctx);
    const state = ens.getState();
    expect(state.fundingCarryActiveCandles).toBe(0);
    expect(state.fundingCarryPausedCandles).toBe(1);
    expect(state.latencyGateActiveFraction).toBe(0);
  });

  it("the latency gate does NOT modify the Donchian signal (the two are orthogonal)", () => {
    const gate = createLatencyGate(
      {
        pair: "binance-bybit-btc",
        roundTripMsMax: 5000,
        roundTripMsMedian: 3000,
        sourceJsonPath: "backtest-results/arb-latency-binance-bybit-btc-sample.json",
      },
      500,
    );
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: gate,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    const ctx = makeCtx({
      candleIndex: 35,
      close: 120, // Donchian breakout
      volume: 1000,
      volumeMa: 100,
      donchianUpper: 110,
      donchianLower: 90,
    });
    const sigWithGateClosed = ens.onCandle(ctx);
    expect(sigWithGateClosed).not.toBeNull();
    expect(sigWithGateClosed?.side).toBe("buy");
    // The Donchian signal is the SAME as if the gate were open (the
    // gate doesn't gate the Donchian — only the carry).
    expect(sigWithGateClosed?.confidence).toBeGreaterThan(0);
    // The reason prefix shows "carry=paused" because the gate is closed.
    expect(sigWithGateClosed?.reason).toContain("carry=paused");
  });

  it("the latency gate snapshot is exposed for the CLI report", () => {
    const snapshot = {
      pair: "binance-bybit-btc",
      roundTripMsMax: 1027,
      roundTripMsMedian: 800,
      sourceJsonPath: "backtest-results/arb-latency-binance-bybit-btc-sample.json",
    };
    const gate = createLatencyGate(snapshot, 500);
    expect(gate.snapshot).toEqual(snapshot);
    expect(gate.arbThresholdMs).toBe(500);
    // roundTripMsMax (1027) > 500 → gate is CLOSED.
    expect(gate.isCarryAllowed()).toBe(false);
  });

  it("createLatencyGate: round-trip < threshold opens the gate (deployment-ready infra)", () => {
    const snapshot = {
      pair: "co-located-tokyo-aws",
      roundTripMsMax: 5,
      roundTripMsMedian: 3,
      sourceJsonPath: "(synthetic-Phase-7-co-location-snapshot)",
    };
    const gate = createLatencyGate(snapshot, 100);
    expect(gate.isCarryAllowed()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Warmup is the max of component warmups
// ---------------------------------------------------------------------------

describe("MultiClassEnsemble — warmup", () => {
  it("warmup = max(Donchian.warmup, FundingCarry.warmup)", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    const expected = Math.max(ens.donchian.warmup(), ens.fundingCarry.warmup());
    expect(ens.warmup()).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 6. The ensemble does NOT modify the Donchian signal's confidence
// ---------------------------------------------------------------------------

describe("MultiClassEnsemble — confidence is not modified", () => {
  it("the ensemble's signal.confidence equals the Donchian's signal.confidence", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    const ctx = makeCtx({
      candleIndex: 35,
      close: 120,
      volume: 1000,
      volumeMa: 100,
      donchianUpper: 110,
      donchianLower: 90,
    });
    const sig = ens.onCandle(ctx);
    const standalone = ens.donchian.onCandle(ctx);
    expect(sig?.confidence).toBe(standalone?.confidence);
    expect(sig?.confidence).toBeGreaterThan(0);
    expect(sig?.confidence).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 7. getState() exposes combined-edge metrics
// ---------------------------------------------------------------------------

describe("MultiClassEnsemble — getState exposes combined-edge metrics", () => {
  it("getState returns all the expected fields after a backtest run", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: {
        kellyMultiplier: 0.5,
        recommendedMaxPositionPctEquity: 0.18,
        winRate: 0.6,
        winLossRatio: 1.5,
      },
    });
    // Run 10 candles (no breakouts; all closes inside the Donchian channel).
    for (let i = 35; i < 45; i++) {
      ens.onCandle(
        makeCtx({
          candleIndex: i,
          close: 100,
          volume: 1000,
          volumeMa: 100,
          donchianUpper: 110,
          donchianLower: 90,
        }),
      );
    }
    const state = ens.getState();
    expect(state.donchianSignalsEmitted).toBe(0);
    expect(state.donchianSignalsAcceptedByFilter).toBe(0);
    expect(state.fundingCarryActiveCandles).toBe(10);
    expect(state.fundingCarryPausedCandles).toBe(0);
    expect(state.latencyGateActiveFraction).toBe(1);
    expect(state.kellyMultiplier).toBe(0.5);
    expect(state.combinedEdgePct).toBe(0); // CLI runner sets this
    expect(state.fundingCarryState).toBeDefined();
  });

  it("donchianSignalsEmitted counts breakouts", () => {
    const ens = new MultiClassEnsemble({
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
      latencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      kellyOpt: DEFAULT_KELLY_OPT_AGGREGATE,
    });
    // 3 breakout candles.
    for (let i = 35; i < 38; i++) {
      ens.onCandle(
        makeCtx({
          candleIndex: i,
          close: 120,
          volume: 1000,
          volumeMa: 100,
          donchianUpper: 110,
          donchianLower: 90,
        }),
      );
    }
    const state = ens.getState();
    expect(state.donchianSignalsEmitted).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 8. timeframesForMultiClass helper
// ---------------------------------------------------------------------------

describe("timeframesForMultiClass helper", () => {
  it("returns 1d/4h/1h for 1h input", () => {
    expect(timeframesForMultiClass("1h")).toEqual({ htf: "1d", mtf: "4h", ltf: "1h" });
  });
  it("returns 1d/4h/4h for 4h input", () => {
    expect(timeframesForMultiClass("4h")).toEqual({ htf: "1d", mtf: "4h", ltf: "4h" });
  });
  it("returns 1d/4h/1d for 1d input", () => {
    expect(timeframesForMultiClass("1d")).toEqual({ htf: "1d", mtf: "4h", ltf: "1d" });
  });
});
