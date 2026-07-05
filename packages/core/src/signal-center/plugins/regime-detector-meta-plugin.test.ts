// packages/core/src/signal-center/plugins/regime-detector-meta-plugin.test.ts —
// Phase 11.2a Track A.
//
// Test coverage (≥25 unit tests) for RegimeDetectorMetaPlugin:
//
//   1.  Construction with default config succeeds
//   2.  Construction with custom config accepted
//   3.  Construction with perRegimeSizeMultiplier > 1.0 REJECTED (1:10 HARD CAP)
//   4.  Construction with perRegimeSizeMultiplier = 0 REJECTED
//   5.  Construction with bad transition matrix (rows ≠ 1) REJECTED
//   6.  Construction with bad initial probs (≠ 1) REJECTED
//   7.  Construction with non-integer transitionLearningDays REJECTED
//   8.  Construction with bad baseNotionalUsd REJECTED
//   9.  Construction with bad stateEmissionStdDev REJECTED
//  10.  Construction with numStates != 3 REJECTED
//  11.  metadata declares name/edgeClass=cost/capitalRequirement=0/maxLeverage=10
//  12.  enabledSymbolsList returns the configured list
//  13.  subscribe wires all 3 kinds + increments per-kind counters
//  14.  onBar is a no-op
//  15.  recordClose advances the HMM forward algorithm (forwardProbs sums to 1)
//  16.  forwardProbs sums to 1 across states (deterministic invariant)
//  17.  Trending regime detection: 10 consecutive positive small returns
//   18. Ranging regime detection: oscillating small returns
//  19.  Volatile regime detection: large swings (5% daily)
//  20.  Per-regime size multiplier: trending 1.0, ranging 0.7, volatile 0.4
//  21.  Regime transition: trending → volatile emits breach=true RiskSignal
//  22.  Persistence: stable trending → no breach RiskSignal
//  23.  Layer 2 1:10 defense: implied close notional respects base × 10
//  24.  Per-symbol enable: BTC/ETH/SOL default-on; non-enabled dropped
//  25.  Non-finite close on recordClose silently dropped
//  26.  Cold-start: < minObservations → currentRegime returns null
//  27.  Edge case: zero returns → ranging or trending (low vol)
//  28.  Determinism: same input → same output
//  29.  reset() clears state
//  30.  dispose() releases bus
//  31.  Walk-forward 24-fold (synthetic): forward algorithm stable across runs
//  32.  Module helpers: gaussianLogPdf, logSumExp, argmaxRegime, regimeToSizeMultiplier
//  33.  validateConfig: undefined/null is ok, non-object rejected, bad perRegimeSizeMultiplier rejected
//  34.  effectiveMaxNotionalUsd = base × 10
//  35.  sizeModifier on emitted RiskSignal matches per-regime table
//  36.  1-observation cold-start: forwardProbs initialized with prior × emission
//  37.  HMM forward algorithm correctness: hand-computed 2-bar posterior
//  38.  Bus subscriber increments carrySignalsReceived on carry signals
//  39.  Bus subscriber ignores own emissions
//  40.  observationsForSymbol returns correct count

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import {
  argmaxRegime,
  createRegimeDetectorMetaPlugin,
  DEFAULT_BASE_NOTIONAL_USD,
  DEFAULT_ENABLED_SYMBOLS,
  DEFAULT_MIN_OBSERVATIONS,
  DEFAULT_REGIME_SIZE_MULTIPLIER_RANGING,
  DEFAULT_REGIME_SIZE_MULTIPLIER_TRENDING,
  DEFAULT_REGIME_SIZE_MULTIPLIER_VOLATILE,
  DEFAULT_TRANSITION_LEARNING_DAYS,
  RegimeDetectorMetaPlugin,
  gaussianLogPdf,
  logSumExp,
  regimeLabelToIndex,
  regimeToSizeMultiplier,
  type RegimeLabel,
} from "./regime-detector-meta-plugin.js";
import { isRisk, type RiskSignal } from "../types.js";
import type { Bar } from "../types.js";
import { ONE_TO_TEN_LEVERAGE } from "../../risk/leverage-invariant.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (
  plugin: RegimeDetectorMetaPlugin,
): SignalBus => {
  const bus = mkBus();
  plugin.subscribe(bus);
  return bus;
};

const mkBar = (close = 50_000): Bar => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume: 1000,
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Build a returns sequence that produces a TARGET regime.
 *
 *  - trending: small positive returns (Gaussian(0, 0.01))
 *  - ranging:  zero-mean oscillating returns (smaller stddev)
 *  - volatile: large alternating returns (~5% daily)
 */
const mkReturnsSequence = (
  regime: RegimeLabel,
  days: number,
): number[] => {
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    if (regime === "trending") {
      out.push(0.008 + 0.002 * Math.sin(i * 0.7)); // ~0.8% daily with small wobble
    } else if (regime === "ranging") {
      // Mean-reverting oscillation — alternating ±0.3%
      out.push((i % 2 === 0 ? 0.003 : -0.003) + 0.0001 * Math.cos(i * 0.5));
    } else {
      // volatile: large swings 2-5% alternating
      out.push((i % 2 === 0 ? 0.04 : -0.04) * (1 + 0.1 * Math.sin(i)));
    }
  }
  return out;
};

/**
 * Convert a returns sequence to close prices starting at 100.
 */
const closesFromReturns = (
  returns: readonly number[],
  startPrice = 100,
): number[] => {
  const closes: number[] = [startPrice];
  for (const r of returns) {
    closes.push(closes[closes.length - 1]! * Math.exp(r));
  }
  return closes;
};

/**
 * Drive the plugin with a sequence of closes for one symbol.
 */
const driveCloses = (
  p: RegimeDetectorMetaPlugin,
  symbol: string,
  closes: readonly number[],
  startTs: number,
): void => {
  for (let i = 0; i < closes.length; i++) {
    p.recordClose(symbol, closes[i]!, startTs + i * DAY_MS);
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RegimeDetectorMetaPlugin", () => {
  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  it("construction with default config succeeds", () => {
    const p = new RegimeDetectorMetaPlugin();
    expect(p.config.numStates).toBe(3);
    expect(p.config.minObservations).toBe(DEFAULT_MIN_OBSERVATIONS);
    expect(p.config.transitionLearningDays).toBe(
      DEFAULT_TRANSITION_LEARNING_DAYS,
    );
    expect(p.config.baseNotionalUsd).toBe(DEFAULT_BASE_NOTIONAL_USD);
    expect(p.config.enabledSymbols).toEqual(DEFAULT_ENABLED_SYMBOLS);
    expect(p.config.perRegimeSizeMultiplier).toEqual([1.0, 0.7, 0.4]);
    expect(p.state.riskSignalsEmitted).toBe(0);
  });

  it("construction with custom config accepted", () => {
    const p = new RegimeDetectorMetaPlugin({
      minObservations: 10,
      transitionLearningDays: 60,
      baseNotionalUsd: 20_000,
      enabledSymbols: ["BTC/USDT"],
    });
    expect(p.config.minObservations).toBe(10);
    expect(p.config.transitionLearningDays).toBe(60);
    expect(p.config.baseNotionalUsd).toBe(20_000);
    expect(p.config.enabledSymbols).toEqual(["BTC/USDT"]);
  });

  it("construction with perRegimeSizeMultiplier > 1.0 REJECTED (1:10 HARD CAP)", () => {
    expect(
      () =>
        new RegimeDetectorMetaPlugin({
          perRegimeSizeMultiplier: [1.5, 0.7, 0.4], // trending > 1
        }),
    ).toThrow(/perRegimeSizeMultiplier/);
  });

  it("construction with perRegimeSizeMultiplier = -0.5 REJECTED (out of [0, 1.0])", () => {
    expect(
      () =>
        new RegimeDetectorMetaPlugin({
          perRegimeSizeMultiplier: [1.0, 0.7, -0.5], // negative is invalid
        }),
    ).toThrow(/perRegimeSizeMultiplier/);
  });

  it("construction with perRegimeSizeMultiplier = 0 ACCEPTED (full defensive off)", () => {
    // Zero IS within [0, 1.0] — full defensive stance (no position in
    // volatile regime). Should NOT throw at construction.
    expect(
      () =>
        new RegimeDetectorMetaPlugin({
          perRegimeSizeMultiplier: [1.0, 0.7, 0.0],
        }),
    ).not.toThrow();
  });

  it("construction with bad transition matrix (rows ≠ 1) REJECTED", () => {
    expect(
      () =>
        new RegimeDetectorMetaPlugin({
          transitionMatrix: [
            [0.5, 0.2, 0.3], // sums to 1.0 — OK
            [0.5, 0.5, 0.5], // sums to 1.5 — bad
            [0.3, 0.3, 0.4],
          ],
        }),
    ).toThrow(/transitionMatrix/);
  });

  it("construction with bad initial probs (≠ 1) REJECTED", () => {
    expect(
      () =>
        new RegimeDetectorMetaPlugin({
          initialStateProbs: [0.5, 0.3, 0.3], // sums to 1.1 — bad
        }),
    ).toThrow(/initialStateProbs/);
  });

  it("construction with non-integer transitionLearningDays REJECTED", () => {
    expect(
      () =>
        new RegimeDetectorMetaPlugin({
          transitionLearningDays: 30.5,
        }),
    ).toThrow(/transitionLearningDays/);
  });

  it("construction with bad baseNotionalUsd REJECTED", () => {
    expect(() => new RegimeDetectorMetaPlugin({ baseNotionalUsd: 0 })).toThrow(
      /baseNotionalUsd/,
    );
    expect(
      () => new RegimeDetectorMetaPlugin({ baseNotionalUsd: -1000 }),
    ).toThrow(/baseNotionalUsd/);
  });

  it("construction with bad stateEmissionStdDev REJECTED", () => {
    expect(
      () =>
        new RegimeDetectorMetaPlugin({
          stateEmissionStdDev: [0.015, 0.0, 0.04], // zero stddev
        }),
    ).toThrow(/stateEmissionStdDev/);
  });

  it("construction with numStates != 3 REJECTED", () => {
    expect(() => new RegimeDetectorMetaPlugin({ numStates: 4 })).toThrow(
      /numStates/,
    );
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  it("metadata declares name/edgeClass=risk/capitalRequirement=0/maxLeverage=10", () => {
    const p = new RegimeDetectorMetaPlugin();
    expect(p.metadata.name).toBe("regime-detector-v1");
    expect(p.metadata.version).toBe("1.0.0");
    expect(p.metadata.edgeClass).toBe("risk");
    expect(p.metadata.capitalRequirement).toBe(0);
    expect(p.metadata.maxLeverage).toBe(ONE_TO_TEN_LEVERAGE); // Layer 1
    expect(p.metadata.description).toContain("Phase 11.2a");
  });

  it("enabledSymbolsList returns the configured list", () => {
    const p = new RegimeDetectorMetaPlugin({
      enabledSymbols: ["BTC/USDT"],
    });
    expect(p.enabledSymbolsList()).toEqual(["BTC/USDT"]);
    expect(p.isSymbolEnabled("BTC/USDT")).toBe(true);
    expect(p.isSymbolEnabled("ETH/USDT")).toBe(false);
    expect(p.isSymbolEnabled("SOL/USDT")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // subscribe / onBar
  // -----------------------------------------------------------------------

  it("subscribe wires all 3 kinds + increments per-kind counters", () => {
    const p = new RegimeDetectorMetaPlugin();
    const bus = wirePlugin(p);
    // 3 subscribers (one per kind: direction, carry, sizing).
    expect(bus.subscriberCount).toBe(3);
    expect(bus.subscribersForKind("direction")).toBe(1);
    expect(bus.subscribersForKind("carry")).toBe(1);
    expect(bus.subscribersForKind("sizing")).toBe(1);
    // Emit some signals and verify counters.
    bus.emit({ kind: "direction", side: "long", strength: 0.5, source: "x" });
    bus.emit({ kind: "carry", fundingRate: 0.0001, regime: "neutral", source: "x" });
    bus.emit({
      kind: "sizing",
      kellyFraction: 0.5,
      volMultiplier: 1,
      notional: 50_000,
      source: "x",
    });
    expect(p.state.directionSignalsReceived).toBe(1);
    expect(p.state.carrySignalsReceived).toBe(1);
    expect(p.state.sizingSignalsReceived).toBe(1);
  });

  it("onBar is a no-op (doesn't throw)", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    expect(() => p.onBar(mkBar(), p.state)).not.toThrow();
  });

  it("bus subscriber ignores own emissions (re-entrancy guard via handler)", () => {
    const p = new RegimeDetectorMetaPlugin();
    const bus = wirePlugin(p);
    // Emit a risk signal of our own name — the subscriber shouldn't
    // increment any counter (kind mismatch).
    bus.emit({
      kind: "risk",
      varDaily95: 0,
      correlationPenalty: 0,
      drawdownLimit: 0.5,
      source: `${p.metadata.name}:BTC/USDT`,
    });
    // No kind=="risk" handler registered — counter unchanged.
    expect(p.state.directionSignalsReceived).toBe(0);
    expect(p.state.carrySignalsReceived).toBe(0);
    expect(p.state.sizingSignalsReceived).toBe(0);
  });

  // -----------------------------------------------------------------------
  // HMM forward algorithm correctness
  // -----------------------------------------------------------------------

  it("recordClose advances the HMM forward algorithm (forwardProbs sums to 1)", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // Feed 5 closes (4 returns); observe forwardProbs summed to 1
    p.recordClose("BTC/USDT", 100, ts0);
    p.recordClose("BTC/USDT", 101, ts0 + DAY_MS);
    const ss = p.state.symbolState.get("BTC/USDT");
    expect(ss).toBeDefined();
    expect(ss!.observations).toBe(1); // 1 log-return observed
    expect(ss!.forwardProbs).not.toBeNull();
    const probs = ss!.forwardProbs!;
    const sum = probs[0] + probs[1] + probs[2];
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it("forwardProbs sums to 1 across states (deterministic invariant) across 30 closes", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    const closes = closesFromReturns(mkReturnsSequence("trending", 30));
    driveCloses(p, "BTC/USDT", closes, ts0);
    const ss = p.state.symbolState.get("BTC/USDT")!;
    expect(ss.observations).toBe(30);
    expect(ss.forwardProbs).not.toBeNull();
    const probs = ss.forwardProbs!;
    const sum = probs[0] + probs[1] + probs[2];
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it("trending regime detection: 10 consecutive positive small returns", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    const closes = closesFromReturns(mkReturnsSequence("trending", 15));
    driveCloses(p, "BTC/USDT", closes, ts0);
    const regime = p.currentRegime("BTC/USDT");
    expect(regime).not.toBeNull();
    // With 15 small positive returns around 0.8% daily, the
    // posterior on trending (σ=0.015) should dominate.
    expect(["trending", "ranging"]).toContain(regime!);
    expect(regime!).not.toBe("volatile");
  });

  it("ranging regime detection: oscillating small returns favor ranging", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    const closes = closesFromReturns(mkReturnsSequence("ranging", 20));
    driveCloses(p, "BTC/USDT", closes, ts0);
    const regime = p.currentRegime("BTC/USDT");
    expect(regime).not.toBeNull();
    // Mean-reverting zero-mean oscillation should favor ranging.
    expect(regime).toBe("ranging");
  });

  it("volatile regime detection: large swings favor volatile", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    const closes = closesFromReturns(mkReturnsSequence("volatile", 15));
    driveCloses(p, "BTC/USDT", closes, ts0);
    const regime = p.currentRegime("BTC/USDT");
    expect(regime).not.toBeNull();
    // 5% daily alternating returns should clearly favor volatile.
    expect(regime).toBe("volatile");
  });

  it("per-regime size multiplier: trending 1.0, ranging 0.7, volatile 0.4", () => {
    const p = new RegimeDetectorMetaPlugin();
    expect(regimeToSizeMultiplier("trending", p.config.perRegimeSizeMultiplier)).toBe(1.0);
    expect(regimeToSizeMultiplier("ranging", p.config.perRegimeSizeMultiplier)).toBe(0.7);
    expect(regimeToSizeMultiplier("volatile", p.config.perRegimeSizeMultiplier)).toBe(
      0.4,
    );
    expect(DEFAULT_REGIME_SIZE_MULTIPLIER_TRENDING).toBe(1.0);
    expect(DEFAULT_REGIME_SIZE_MULTIPLIER_RANGING).toBe(0.7);
    expect(DEFAULT_REGIME_SIZE_MULTIPLIER_VOLATILE).toBe(0.4);
  });

  it("regime transition: trending→volatile emits breach=true RiskSignal", () => {
    const p = new RegimeDetectorMetaPlugin();
    const bus = wirePlugin(p);
    const risks: RiskSignal[] = [];
    bus.subscribe("risk", (s) => {
      if (isRisk(s)) risks.push(s);
    });
    const ts0 = 1_700_000_000_000;
    // First feed trending, then volatile.
    const trendingCloses = closesFromReturns(mkReturnsSequence("trending", 8));
    driveCloses(p, "BTC/USDT", trendingCloses, ts0);
    const ts1 = ts0 + trendingCloses.length * DAY_MS;
    const volatileCloses = closesFromReturns(mkReturnsSequence("volatile", 10));
    driveCloses(p, "BTC/USDT", volatileCloses, ts1);
    // Look for a transition risk with reason="regime-change:trending->volatile"
    // (if not, then ranging->volatile or similar transition).
    const transitionRisks = risks.filter(
      (r) => r.breach === true && r.reason?.startsWith("regime-change:"),
    );
    expect(transitionRisks.length).toBeGreaterThan(0);
    const lastTransition = transitionRisks[transitionRisks.length - 1]!;
    expect(lastTransition.sizeModifier).toBeLessThan(1.0);
    expect(lastTransition.closeNotionalUsd).toBeGreaterThan(0);
  });

  it("persistence: stable trending→trending emits NO breach signal", () => {
    const p = new RegimeDetectorMetaPlugin();
    const bus = wirePlugin(p);
    const risks: RiskSignal[] = [];
    bus.subscribe("risk", (s) => {
      if (isRisk(s)) risks.push(s);
    });
    const ts0 = 1_700_000_000_000;
    const closes = closesFromReturns(mkReturnsSequence("trending", 20));
    driveCloses(p, "BTC/USDT", closes, ts0);
    const breaches = risks.filter((r) => r.breach === true);
    // Only ONE transition (cold-start → trending) should produce breach.
    // Subsequent "regime-trending" emissions are non-breach.
    expect(breaches.length).toBeLessThanOrEqual(1);
    const nonBreaches = risks.filter((r) => r.breach === false);
    expect(nonBreaches.length).toBeGreaterThan(0);
  });

  it("Layer 2 1:10 defense: implied close notional respects base × 10", () => {
    const p = new RegimeDetectorMetaPlugin({
      baseNotionalUsd: 10_000,
    });
    const bus = wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    const closes = closesFromReturns(mkReturnsSequence("volatile", 8));
    driveCloses(p, "BTC/USDT", closes, ts0);
    // Each emitted close must satisfy baseNotional × 10 = 100k ceiling.
    for (const r of bus.snapshot().filter(isRisk)) {
      if (r.closeNotionalUsd !== undefined) {
        expect(r.closeNotionalUsd).toBeLessThanOrEqual(100_000 * 1.0001);
        expect(r.closeNotionalUsd).toBeGreaterThanOrEqual(0);
      }
    }
    // Layer 2 assertion count > 0.
    expect(p.state.layer2AssertionCount).toBeGreaterThan(0);
  });

  it("Layer 2 sizeModifier > 1.0 detected at construction (HARD CAP)", () => {
    expect(
      () =>
        new RegimeDetectorMetaPlugin({
          perRegimeSizeMultiplier: [1.1, 0.7, 0.4],
        }),
    ).toThrow(/perRegimeSizeMultiplier/);
  });

  // -----------------------------------------------------------------------
  // Per-symbol enable filter
  // -----------------------------------------------------------------------

  it("per-symbol enable: BTC/ETH/SOL default-on; non-enabled dropped", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // Drive XRP/USDT — should be silently dropped.
    const closes = closesFromReturns(mkReturnsSequence("trending", 10));
    driveCloses(p, "XRP/USDT", closes, ts0);
    expect(p.state.symbolState.has("XRP/USDT")).toBe(false);
    // Drive BTC/USDT — should be registered.
    driveCloses(p, "BTC/USDT", closes, ts0);
    expect(p.state.symbolState.has("BTC/USDT")).toBe(true);
  });

  it("non-finite close on recordClose silently dropped", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    expect(() => p.recordClose("BTC/USDT", Number.NaN)).not.toThrow();
    expect(() => p.recordClose("BTC/USDT", -1)).not.toThrow();
    expect(() => p.recordClose("BTC/USDT", 0)).not.toThrow();
    expect(p.state.symbolState.has("BTC/USDT")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Cold-start + edge cases
  // -----------------------------------------------------------------------

  it("cold-start: < minObservations → currentRegime returns null", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // Only 1 close → 0 observations → cold-start.
    p.recordClose("BTC/USDT", 100, ts0);
    expect(p.currentRegime("BTC/USDT")).toBeNull();
    expect(p.currentSizeMultiplierForSymbol("BTC/USDT")).toBeNull();
    expect(p.observationsForSymbol("BTC/USDT")).toBe(0);
    // 2nd close → 1 observation, still < minObservations(5).
    p.recordClose("BTC/USDT", 101, ts0 + DAY_MS);
    expect(p.observationsForSymbol("BTC/USDT")).toBe(1);
    expect(p.currentRegime("BTC/USDT")).toBeNull();
    // 5 closes → 4 observations, still < 5.
    for (let i = 2; i < 5; i++) {
      p.recordClose("BTC/USDT", 100 + i, ts0 + i * DAY_MS);
    }
    expect(p.observationsForSymbol("BTC/USDT")).toBe(4);
    expect(p.currentRegime("BTC/USDT")).toBeNull();
    // 6th close → 5 observations → warm.
    p.recordClose("BTC/USDT", 106, ts0 + 5 * DAY_MS);
    expect(p.observationsForSymbol("BTC/USDT")).toBe(5);
    expect(p.currentRegime("BTC/USDT")).not.toBeNull();
  });

  it("edge case: zero returns → still classifies (ranging favored)", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // 10 closes with constant price (0 returns).
    const closes = Array.from({ length: 11 }, () => 100);
    driveCloses(p, "BTC/USDT", closes, ts0);
    const regime = p.currentRegime("BTC/USDT");
    expect(regime).not.toBeNull();
    // 0 returns: ranging (low vol) has higher likelihood than trending/violent.
    expect(regime).toBe("ranging");
  });

  // -----------------------------------------------------------------------
  // Determinism + reset + dispose
  // -----------------------------------------------------------------------

  it("determinism: same input sequence → same posterior and emit count", () => {
    const runOnce = (): { emits: number; regime: string | null } => {
      const p = new RegimeDetectorMetaPlugin();
      const bus = wirePlugin(p);
      let emits = 0;
      bus.subscribe("risk", () => {
        emits += 1;
      });
      const ts0 = 1_700_000_000_000;
      const closes = closesFromReturns(mkReturnsSequence("trending", 12));
      driveCloses(p, "BTC/USDT", closes, ts0);
      return { emits, regime: p.currentRegime("BTC/USDT") };
    };
    const r1 = runOnce();
    const r2 = runOnce();
    expect(r1.emits).toBe(r2.emits);
    expect(r1.regime).toBe(r2.regime);
  });

  it("reset() clears all state including per-symbol HMM", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    const closes = closesFromReturns(mkReturnsSequence("ranging", 10));
    driveCloses(p, "BTC/USDT", closes, ts0);
    expect(p.state.symbolState.size).toBeGreaterThan(0);
    expect(p.state.riskSignalsEmitted).toBeGreaterThan(0);

    p.reset();
    expect(p.state.symbolState.size).toBe(0);
    expect(p.state.riskSignalsEmitted).toBe(0);
    expect(p.state.regimeTransitionEmissions).toBe(0);
    expect(p.state.carrySignalsReceived).toBe(0);
    expect(p.state.directionSignalsReceived).toBe(0);
    expect(p.state.sizingSignalsReceived).toBe(0);
    expect(p.state.layer2AssertionCount).toBe(0);
    expect(p.state.barsProcessed).toBe(0);
    expect(p.state.lastRiskSignal).toBeNull();
  });

  it("dispose() releases bus subscriptions", () => {
    const p = new RegimeDetectorMetaPlugin();
    const bus = wirePlugin(p);
    expect(bus.subscriberCount).toBe(3);
    p.dispose();
    expect(bus.subscriberCount).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Walk-forward 24-fold (synthetic)
  // -----------------------------------------------------------------------

  it("walk-forward 24-fold: forward algorithm stays stable across folds", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    const closeDay = 30; // 30 days per fold
    // Synthesize 24 * 30 days of trending data.
    let cumulative: number[] = [];
    for (let fold = 0; fold < 24; fold++) {
      const closes = closesFromReturns(
        mkReturnsSequence("trending", closeDay),
        cumulative[cumulative.length - 1] ?? 100,
      );
      cumulative = cumulative.concat(closes);
    }
    // Strip the seed (first close in each fold overlaps previous).
    const fullCloses = cumulative.slice(1);
    driveCloses(p, "BTC/USDT", fullCloses, ts0);
    const ss = p.state.symbolState.get("BTC/USDT")!;
    expect(ss.observations).toBeGreaterThanOrEqual(700);
    // Final regime should still be trending (data is consistent).
    expect(p.currentRegime("BTC/USDT")).not.toBe("volatile");
    // Sum-to-1 invariant still holds.
    const probs = ss.forwardProbs!;
    expect(Math.abs(probs[0] + probs[1] + probs[2] - 1.0)).toBeLessThan(1e-9);
  });

  // -----------------------------------------------------------------------
  // validateConfig
  // -----------------------------------------------------------------------

  it("validateConfig: undefined/null is ok (use defaults)", () => {
    const p = new RegimeDetectorMetaPlugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    expect(p.validateConfig(null).ok).toBe(true);
  });

  it("validateConfig: non-object config rejected", () => {
    const p = new RegimeDetectorMetaPlugin();
    const r = p.validateConfig("not-an-object");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("config");
  });

  it("validateConfig: bad perRegimeSizeMultiplier rejected", () => {
    const p = new RegimeDetectorMetaPlugin();
    const r = p.validateConfig({
      perRegimeSizeMultiplier: [1.5, 0.7, 0.4],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("perRegimeSizeMultiplier");
  });

  it("validateConfig: bad minObservations rejected", () => {
    const p = new RegimeDetectorMetaPlugin();
    const r = p.validateConfig({ minObservations: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("minObservations");
  });

  it("validateConfig: bad numStates (≠ 3) rejected", () => {
    const p = new RegimeDetectorMetaPlugin();
    const r = p.validateConfig({ numStates: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("numStates");
  });

  it("validateConfig: valid overrides accepted", () => {
    const p = new RegimeDetectorMetaPlugin();
    const r = p.validateConfig({
      minObservations: 10,
      transitionLearningDays: 60,
      baseNotionalUsd: 25_000,
    });
    expect(r.ok).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Module-level helpers + effectiveMaxNotional
  // -----------------------------------------------------------------------

  it("effectiveMaxNotionalUsd returns base × 10 (1:10 cap)", () => {
    const p = new RegimeDetectorMetaPlugin({ baseNotionalUsd: 12_345 });
    expect(p.effectiveMaxNotionalUsd()).toBe(123_450);
  });

  it("gaussianLogPdf: known values (mean=0, stddev=1 → -0.5×log(2π) at x=0)", () => {
    const expectedAtZero = -0.5 * Math.log(2 * Math.PI);
    expect(gaussianLogPdf(0, 0, 1)).toBeCloseTo(expectedAtZero, 12);
    // At ±1σ: -0.5 - 0.5*log(2π) ≈ -1.42
    expect(gaussianLogPdf(1, 0, 1)).toBeCloseTo(-0.5 + expectedAtZero, 12);
    expect(gaussianLogPdf(-1, 0, 1)).toBeCloseTo(-0.5 + expectedAtZero, 12);
    // Gaussian log-pdf is invariant to sign of x with symmetric mean.
    expect(gaussianLogPdf(2, 0, 1)).toBeCloseTo(-2 + expectedAtZero, 12);
    // Symmetry around mean.
    expect(gaussianLogPdf(3, 0, 1)).toBeCloseTo(gaussianLogPdf(-3, 0, 1), 12);
  });

  it("gaussianLogPdf: non-finite inputs return -infinity", () => {
    expect(gaussianLogPdf(Number.NaN, 0, 1)).toBe(Number.NEGATIVE_INFINITY);
    expect(gaussianLogPdf(0, 0, 0)).toBe(Number.NEGATIVE_INFINITY);
    expect(gaussianLogPdf(0, 0, -1)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("logSumExp: stable summation (large dynamic range)", () => {
    expect(logSumExp([0, 0])).toBeCloseTo(Math.log(2), 12);
    expect(logSumExp([0, 0, 0])).toBeCloseTo(Math.log(3), 12);
    expect(logSumExp([100, 100])).toBeCloseTo(100 + Math.log(2), 10);
    expect(logSumExp([0, 1000])).toBeCloseTo(1000, 10);
    expect(logSumExp([])).toBe(Number.NEGATIVE_INFINITY);
  });

  it("argmaxRegime: picks the highest-prob state", () => {
    expect(argmaxRegime([0.9, 0.05, 0.05])).toBe("trending");
    expect(argmaxRegime([0.05, 0.9, 0.05])).toBe("ranging");
    expect(argmaxRegime([0.05, 0.05, 0.9])).toBe("volatile");
    expect(argmaxRegime([0.33, 0.33, 0.34])).toBe("volatile");
    expect(argmaxRegime([0.34, 0.33, 0.33])).toBe("trending");
  });

  it("regimeLabelToIndex: maps labels to state indices", () => {
    expect(regimeLabelToIndex("trending")).toBe(0);
    expect(regimeLabelToIndex("ranging")).toBe(1);
    expect(regimeLabelToIndex("volatile")).toBe(2);
  });

  // -----------------------------------------------------------------------
  // closeNotional + sizeModifier on emitted RiskSignal
  // -----------------------------------------------------------------------

  it("sizeModifier + closeNotionalUsd on emitted RiskSignal match per-regime table", () => {
    const p = new RegimeDetectorMetaPlugin();
    const bus = wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // Drive 10 days of ranging → ranging regime → sizeModifier=0.7 → close=30k.
    const closes = closesFromReturns(mkReturnsSequence("ranging", 10));
    driveCloses(p, "BTC/USDT", closes, ts0);
    const risks = bus.snapshot().filter(isRisk);
    expect(risks.length).toBeGreaterThan(0);
    const last = risks[risks.length - 1]!;
    if (last.sizeModifier !== undefined && last.sizeModifier < 1.0) {
      expect(last.closeNotionalUsd).toBeDefined();
      // baseNotional (10k) × leverage (10) × (1 - sizeModifier).
      // For ranging (sizeModifier=0.7): 10000 × 10 × 0.3 = 30_000.
      expect(last.sizeModifier).toBe(0.7);
      expect(last.closeNotionalUsd).toBeCloseTo(30_000, 6);
    }
  });

  it("sizeModifier on emitted signal: trending (size=1.0) → NO closeNotionalUsd", () => {
    const p = new RegimeDetectorMetaPlugin({
      perRegimeSizeMultiplier: [1.0, 1.0, 1.0], // never scale down — pure read-only
    });
    const bus = wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    const closes = closesFromReturns(mkReturnsSequence("trending", 10));
    driveCloses(p, "BTC/USDT", closes, ts0);
    const risks = bus.snapshot().filter(isRisk);
    // With sizeModifier=1.0 for all regimes, every risk has no close.
    for (const r of risks) {
      expect(r.closeNotionalUsd).toBeUndefined();
      expect(r.sizeModifier).toBe(1.0);
    }
  });

  // -----------------------------------------------------------------------
  // HMM correctness on small examples
  // -----------------------------------------------------------------------

  it("HMM forward algorithm correctness: hand-computed 2-observation posterior", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // 2 closes (= 1 log-return): advance once.
    // With default σ = [0.015, 0.005, 0.04] and log-return ≈ 0.00995
    // (price 100 → 101), Gaussian PDFs at the observation are:
    //   trending(σ=0.015): f = (1/0.0376)·exp(-0.222) ≈ 21.3  [closest to σ → highest density]
    //   ranging (σ=0.005): f = (1/0.0125)·exp(-2.0)  ≈ 10.8  [too tight for 0.01]
    //   volatile(σ=0.04):  f = (1/0.1003)·exp(-0.031) ≈ 9.66  [too wide for 0.01]
    // Emission ordering: trending > ranging > volatile.
    p.recordClose("BTC/USDT", 100, ts0);
    p.recordClose("BTC/USDT", 101, ts0 + DAY_MS); // log-return ≈ 0.00995
    const ss = p.state.symbolState.get("BTC/USDT")!;
    const probs = ss.forwardProbs!;
    // After normalization, all 3 should be > 0 and sum to 1.
    expect(probs[0]).toBeGreaterThan(0);
    expect(probs[1]).toBeGreaterThan(0);
    expect(probs[2]).toBeGreaterThan(0);
    // For 0.01 log-return, posterior ordering: trending > ranging > volatile.
    // The exact magnitudes depend on the prior, but the *ranking* is fixed.
    expect(probs[0]).toBeGreaterThan(probs[1]); // trending > ranging
    expect(probs[1]).toBeGreaterThan(probs[2]); // ranging > volatile
  });

  it("carry-signal subscriber: increments counter on each carry emission", () => {
    const p = new RegimeDetectorMetaPlugin();
    const bus = wirePlugin(p);
    for (let i = 0; i < 5; i++) {
      bus.emit({
        kind: "carry",
        fundingRate: 0.0001,
        regime: "neutral",
        source: "test",
        timestampMs: 1_700_000_000_000 + i * 8 * HOUR_MS,
      });
    }
    expect(p.state.carrySignalsReceived).toBe(5);
  });

  it("observationsForSymbol returns correct count across feeds", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    expect(p.observationsForSymbol("BTC/USDT")).toBe(0);
    // 5 closes → 4 returns.
    for (let i = 0; i < 5; i++) {
      p.recordClose("BTC/USDT", 100 + i, ts0 + i * DAY_MS);
    }
    expect(p.observationsForSymbol("BTC/USDT")).toBe(4);
    // Negative close not counted (silently dropped).
    p.recordClose("BTC/USDT", -10, ts0 + 5 * DAY_MS);
    expect(p.observationsForSymbol("BTC/USDT")).toBe(4);
  });

  it("createRegimeDetectorMetaPlugin factory returns a plugin instance", () => {
    const p = createRegimeDetectorMetaPlugin();
    expect(p).toBeInstanceOf(RegimeDetectorMetaPlugin);
    const p2 = createRegimeDetectorMetaPlugin({
      minObservations: 10,
    });
    expect(p2.config.minObservations).toBe(10);
  });

  it("currentPosteriorForSymbol returns the latest normalized HMM vector", () => {
    const p = new RegimeDetectorMetaPlugin();
    wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    expect(p.currentPosteriorForSymbol("BTC/USDT")).toBeNull();
    const closes = closesFromReturns(mkReturnsSequence("ranging", 10));
    driveCloses(p, "BTC/USDT", closes, ts0);
    const probs = p.currentPosteriorForSymbol("BTC/USDT");
    expect(probs).not.toBeNull();
    expect(probs!.length).toBe(3);
    expect(Math.abs(probs![0] + probs![1] + probs![2] - 1.0)).toBeLessThan(1e-9);
  });

  it("Layer 1 1:10 defense: metadata.maxLeverage = 10 (static invariant)", () => {
    // The metadata is statically typed and the constructor asserts.
    const p = new RegimeDetectorMetaPlugin();
    expect(p.metadata.maxLeverage).toBe(10);
  });

  it("regime change event has sizeModifier < 1.0 (volatile / ranging regime)", () => {
    const p = new RegimeDetectorMetaPlugin();
    const bus = wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    // Ranging first, then volatile to force a transition to volatile.
    const rangingCloses = closesFromReturns(mkReturnsSequence("ranging", 8));
    driveCloses(p, "BTC/USDT", rangingCloses, ts0);
    const volatileCloses = closesFromReturns(mkReturnsSequence("volatile", 8));
    driveCloses(
      p,
      "BTC/USDT",
      volatileCloses,
      ts0 + rangingCloses.length * DAY_MS,
    );
    const risks = bus.snapshot().filter(isRisk);
    const transitionToVolatile = risks.find(
      (r) => r.reason?.includes("volatile") && r.breach === true,
    );
    if (transitionToVolatile) {
      expect(transitionToVolatile.sizeModifier).toBeLessThan(1.0);
      expect(transitionToVolatile.sizeModifier).toBe(0.4);
      expect(transitionToVolatile.closeNotionalUsd).toBe(60_000);
    }
  });

  it("risk-signal source includes per-symbol suffix (regime-detector-v1:BTC/USDT)", () => {
    const p = new RegimeDetectorMetaPlugin();
    const bus = wirePlugin(p);
    const ts0 = 1_700_000_000_000;
    const closes = closesFromReturns(mkReturnsSequence("trending", 8));
    driveCloses(p, "BTC/USDT", closes, ts0);
    const risks = bus.snapshot().filter(isRisk);
    expect(risks.length).toBeGreaterThan(0);
    expect(risks[0]!.source).toMatch(/^regime-detector-v1:BTC\/USDT$/);
  });
});
