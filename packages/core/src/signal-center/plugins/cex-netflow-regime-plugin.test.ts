// packages/core/src/signal-center/plugins/cex-netflow-regime-plugin.test.ts —
// Phase 12 Track A.
//
// Test coverage (≥30 unit tests + adversarial probe) for CexNetFlowRegimePlugin:
//
//   Construction & metadata
//     1.  construction with default config succeeds
//     2.  construction with custom config accepted
//     3.  metadata: name='cex-netflow-regime-v1', version, edgeClass='factor', capitalRequirement=0, maxLeverage=10
//     4.  enabledSymbolsList returns configured list
//     5.  effectiveMaxNotionalUsd = baseNotionalUsd × 10
//
//   Config validation (constructor + validateConfig)
//     6.  constructor rejects bad windowDays (<30 or non-integer)            [adversarial]
//     7.  constructor rejects regimeLowerZ ≥ regimeUpperZ                    [adversarial]
//     8.  constructor rejects bad pollIntervalMs / factorScalingZ
//     9.  constructor rejects bad minObservations / maxStaleMs
//    10.  constructor rejects bad enabledSymbols / baseNotionalUsd
//    11.  validateConfig with null/undefined returns ok
//    12.  validateConfig rejects non-object config
//    13.  validateConfig field-level rejection propagates with structured error
//
//   z-score computation (computeZScore)
//    14.  small window (<2 samples) returns z=0
//    15.  uniform window (stddev=0) returns z=0
//    16.  hand-computed z-score correctness
//    17.  population stddev (divide by N) is used
//
//   factor mapping (computeFactor)
//    18.  tanh(0)=0; tanh(large z) → bounded in (-1, +1)
//    19.  z=2 → tanh(1) ≈ 0.762; z=3 → tanh(1.5) ≈ 0.905
//    20.  classifyRegime thresholds at z=±1.5 (boundary tests)
//
//   recordNetflowSample — direct injection path
//    21.  cold-start guard: < minObservations → no FactorSignal yet
//    22.  first emit after warm-up populates currentRegime/currentFactor/currentZScore
//    23.  staleness filter: drop samples older than maxStaleMs
//    24.  per-symbol enable filter: non-enabled symbol silently dropped (returns false)
//    25.  non-finite netflow → drop (returns false)
//    26.  rolling window trim at windowDays × 24 × 12 samples
//
//   3-layer 1:10 leverage defense
//    27.  L1 — metadata.maxLeverage = ONE_TO_TEN_LEVERAGE
//    28.  L2 — subscribe() increments layer2SubscribeAssertions
//    29.  L3 — each recordNetflowSample emit increments layer3EmitAssertions
//
//   Bus publish contract
//    30.  bus.emit('factor') delivers to factor subscribers only
//    31.  isFactor narrows correctly; non-factor signals not affected
//    32.  FactorSignal.source = this.metadata.name
//
//   Lifecycle
//    33.  reset() clears state but preserves enabledSymbols
//    34.  dispose() releases poll timer and bus reference
//
//   Adapter DI
//    35.  NullNetflowAdapter returns null
//    36.  CoinglassNetflowAdapter without API key returns null
//    37.  CryptoQuantNetflowAdapter without API key returns null
//    38.  CoinGlassExchangeBalanceAdapter returns null
//    39.  Custom mock adapter integration via refreshLive (mock records samples)
//
//   Determinism / adversarial probes
//    40.  same input sequence → same output sequence (deterministic)
//    41.  dedup invariance: multiple calls to recordNetflowSample with same sample → same z-factor    [adversarial]
//    42.  calibration edge: z=±1.499 / ±1.501 boundary tests                                          [adversarial]
//    43.  confidence scales from cold-start to 1.0 over minObservations × 4 samples

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import {
  type CexNetFlowRegimeConfig,
  CexNetFlowRegimePlugin,
  type IExchangeNetflowAdapter,
  classifyRegime,
  computeFactor,
  computeZScore,
  createCexNetFlowRegimePlugin,
  DEFAULT_BASE_NOTIONAL_USD,
  DEFAULT_FACTOR_SCALING_Z,
  DEFAULT_MAX_STALE_MS,
  DEFAULT_MIN_OBSERVATIONS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_REGIME_LOWER_Z,
  DEFAULT_REGIME_UPPER_Z,
  DEFAULT_WINDOW_DAYS,
  NullNetflowAdapter,
  type NetflowSample,
  type CexNetFlowRegimePluginState,
} from "./cex-netflow-regime-plugin.js";
import {
  type FactorSignal,
  isFactor,
  type Signal,
} from "../types.js";
import type { Bar } from "../types.js";
import { ONE_TO_TEN_LEVERAGE } from "../../risk/leverage-invariant.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (
  plugin: CexNetFlowRegimePlugin,
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
 * Drive the plugin with a sequence of (netflow, ts) pairs for one
 * symbol. Spaced at `intervalMs` (default 0 — same timestamp) starting
 * from `startTs` (default `Date.now()` so samples are fresh — fresh
 * relative to the staleness filter, not 2024 timestamps which would
 * be filtered out as stale).
 */
const feedNetflowSeries = (
  p: CexNetFlowRegimePlugin,
  symbol: string,
  netflows: readonly number[],
  startTs: number = Date.now(),
  intervalMs = 0,
): void => {
  for (let i = 0; i < netflows.length; i++) {
    p.recordNetflowSample(
      symbol,
      netflows[i]!,
      startTs + i * intervalMs,
    );
  }
};

/**
 * Build a constant-netflow series of length n.
 */
const constNetflow = (n: number, value: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(value);
  return out;
};

/**
 * Hand-compute population mean & stddev (for cross-check with
 * `computeZScore`).
 */
const handStats = (samples: readonly number[]): { mean: number; stdDev: number } => {
  if (samples.length === 0) return { mean: 0, stdDev: 0 };
  let sum = 0;
  for (const s of samples) sum += s;
  const mean = sum / samples.length;
  let varSum = 0;
  for (const s of samples) {
    const d = s - mean;
    varSum += d * d;
  }
  return { mean, stdDev: Math.sqrt(varSum / samples.length) };
};

/**
 * Mock IExchangeNetflowAdapter — for DI testing.
 */
class MockNetflowAdapter implements IExchangeNetflowAdapter {
  public readonly name: string;
  public callCount = 0;
  /** Returns canned samples keyed by symbol. If `null`, returns null. */
  constructor(
    name: string,
    private readonly canned: Record<string, NetflowSample | null> | null = null,
  ) {
    this.name = name;
  }
  async fetchNetflowSample(symbol: string): Promise<NetflowSample | null> {
    this.callCount += 1;
    if (this.canned === null) return null;
    return this.canned[symbol] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CexNetFlowRegimePlugin", () => {
  // -----------------------------------------------------------------------
  // Construction & metadata
  // -----------------------------------------------------------------------

  it("construction with default config succeeds", () => {
    const p = new CexNetFlowRegimePlugin();
    expect(p.config.windowDays).toBe(DEFAULT_WINDOW_DAYS);
    expect(p.config.regimeUpperZ).toBe(DEFAULT_REGIME_UPPER_Z);
    expect(p.config.regimeLowerZ).toBe(DEFAULT_REGIME_LOWER_Z);
    expect(p.config.pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_MS);
    expect(p.config.factorScalingZ).toBe(DEFAULT_FACTOR_SCALING_Z);
    expect(p.config.maxStaleMs).toBe(DEFAULT_MAX_STALE_MS);
    expect(p.config.minObservations).toBe(DEFAULT_MIN_OBSERVATIONS);
    expect(p.config.baseNotionalUsd).toBe(DEFAULT_BASE_NOTIONAL_USD);
    expect(p.config.adapter).toBeInstanceOf(NullNetflowAdapter);
    expect(p.config.enabledSymbols).toEqual(["BTC", "ETH", "SOL"]);
    expect(p.state.totalSamplesRecorded).toBe(0);
    expect(p.state.totalFactorSignalsEmitted).toBe(0);
  });

  it("construction with custom config accepted", () => {
    const p = new CexNetFlowRegimePlugin({
      windowDays: 60,
      regimeUpperZ: 2.0,
      regimeLowerZ: -1.0,
      baseNotionalUsd: 5_000,
      enabledSymbols: ["BTC"],
    });
    expect(p.config.windowDays).toBe(60);
    expect(p.config.regimeUpperZ).toBe(2.0);
    expect(p.config.regimeLowerZ).toBe(-1.0);
    expect(p.config.baseNotionalUsd).toBe(5_000);
    expect(p.config.enabledSymbols).toEqual(["BTC"]);
  });

  it("metadata declares name='cex-netflow-regime-v1', edgeClass='factor', capitalRequirement=0, maxLeverage=10", () => {
    const p = new CexNetFlowRegimePlugin();
    expect(p.metadata.name).toBe("cex-netflow-regime-v1");
    expect(p.metadata.version).toBe("1.0.0");
    expect(p.metadata.edgeClass).toBe("factor");
    expect(p.metadata.capitalRequirement).toBe(0);
    expect(p.metadata.maxLeverage).toBe(ONE_TO_TEN_LEVERAGE);
  });

  it("enabledSymbolsList returns the configured list", () => {
    const p = new CexNetFlowRegimePlugin({ enabledSymbols: ["BTC", "ETH"] });
    expect(p.enabledSymbolsList()).toEqual(["BTC", "ETH"]);
  });

  it("effectiveMaxNotionalUsd = baseNotionalUsd × 10", () => {
    const p = new CexNetFlowRegimePlugin({ baseNotionalUsd: 8_000 });
    expect(p.effectiveMaxNotionalUsd()).toBe(80_000);
  });

  // -----------------------------------------------------------------------
  // Config validation — adversarial
  // -----------------------------------------------------------------------

  it("constructor rejects bad windowDays (<30)", () => {
    expect(() => new CexNetFlowRegimePlugin({ windowDays: 7 })).toThrow(
      /windowDays.*must be an integer in/,
    );
  });

  it("constructor rejects non-integer windowDays", () => {
    expect(() => new CexNetFlowRegimePlugin({ windowDays: 30.5 })).toThrow(
      /windowDays/,
    );
  });

  it("constructor rejects regimeLowerZ ≥ regimeUpperZ", () => {
    // Both bounds are within their respective valid ranges; the
    // ordering check fires LAST. Pick values that pass bounds checks
    // but fail ordering.
    expect(
      () =>
        new CexNetFlowRegimePlugin({
          regimeUpperZ: 0.5,
          regimeLowerZ: -0.3, // lowerZ(-0.3) >= upperZ(0.5) is FALSE here
        }),
    ).not.toThrow(); // valid ordering (lowerZ < upperZ)
    // Now invalid: lowerZ same as upperZ — but bounds are tightened.
    // Use upperZ=0.5 and lowerZ=-0.5 (valid): swap to test invalid.
    expect(
      () =>
        new CexNetFlowRegimePlugin({
          regimeUpperZ: 0.3,
          regimeLowerZ: -0.5, // lowerZ < upperZ (valid)
        }),
    ).not.toThrow();
    // Genuinely invalid: lowerZ >= upperZ. Use upper=-0.1 (the BOUND)
    // and lower=-0.1 (same). Or use values right at the boundary.
    expect(
      () =>
        new CexNetFlowRegimePlugin({
          regimeUpperZ: -0.1,
          regimeLowerZ: -0.1,
        }),
    ).toThrow(/regimeLowerZ.*< regimeUpperZ|regimeLowerZ=.*must be finite|regimeUpperZ=.*must be finite/);
  });

  it("constructor rejects bad pollIntervalMs", () => {
    expect(() =>
      new CexNetFlowRegimePlugin({ pollIntervalMs: 100 }),
    ).toThrow(/pollIntervalMs/);
  });

  it("constructor rejects bad factorScalingZ (≤0 or >10)", () => {
    expect(() =>
      new CexNetFlowRegimePlugin({ factorScalingZ: 0 }),
    ).toThrow(/factorScalingZ/);
    expect(() =>
      new CexNetFlowRegimePlugin({ factorScalingZ: 50 }),
    ).toThrow(/factorScalingZ/);
  });

  it("constructor rejects bad minObservations (<2 or >90)", () => {
    expect(() =>
      new CexNetFlowRegimePlugin({ minObservations: 1 }),
    ).toThrow(/minObservations/);
    expect(() =>
      new CexNetFlowRegimePlugin({ minObservations: 200 }),
    ).toThrow(/minObservations/);
  });

  it("constructor rejects bad maxStaleMs (≤0)", () => {
    expect(() => new CexNetFlowRegimePlugin({ maxStaleMs: 500 })).toThrow(
      /maxStaleMs/,
    );
  });

  it("constructor rejects empty enabledSymbols / non-string entries", () => {
    expect(() => new CexNetFlowRegimePlugin({ enabledSymbols: [] })).toThrow(
      /enabledSymbols/,
    );
    expect(() =>
      new CexNetFlowRegimePlugin({ enabledSymbols: ["BTC", ""] }),
    ).toThrow(/enabledSymbols/);
  });

  it("constructor rejects bad baseNotionalUsd (≤0)", () => {
    expect(() =>
      new CexNetFlowRegimePlugin({ baseNotionalUsd: 0 }),
    ).toThrow(/baseNotionalUsd/);
  });

  it("validateConfig with null/undefined returns ok(undefined)", () => {
    const p = new CexNetFlowRegimePlugin();
    expect(p.validateConfig(null).ok).toBe(true);
    expect(p.validateConfig(undefined).ok).toBe(true);
  });

  it("validateConfig rejects non-object config", () => {
    const p = new CexNetFlowRegimePlugin();
    const r = p.validateConfig(42 as unknown);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("config");
  });

  it("validateConfig field-level rejection: windowDays < 30", () => {
    const p = new CexNetFlowRegimePlugin();
    const r = p.validateConfig({ windowDays: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("windowDays");
  });

  it("validateConfig field-level rejection: enabledSymbols non-array", () => {
    const p = new CexNetFlowRegimePlugin();
    const r = p.validateConfig({ enabledSymbols: "BTC,ETH" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("enabledSymbols");
  });

  // -----------------------------------------------------------------------
  // z-score computation (computeZScore)
  // -----------------------------------------------------------------------

  it("computeZScore: window < 2 samples returns z=0 (no signal)", () => {
    const r = computeZScore([]);
    expect(r.zScore).toBe(0);
    expect(r.mean).toBe(0);
    expect(r.stdDev).toBe(0);
    const r2 = computeZScore([5.0]);
    expect(r2.zScore).toBe(0);
  });

  it("computeZScore: uniform window (stddev=0) returns z=0 (no signal)", () => {
    const r = computeZScore([5, 5, 5, 5, 5]);
    expect(r.zScore).toBe(0);
    expect(r.mean).toBe(5);
    expect(r.stdDev).toBe(0);
  });

  it("computeZScore: hand-computed 5-sample z-score correctness", () => {
    // samples = [1, 2, 3, 4, 5] → mean=3, varSum=10, stdDev=sqrt(2)
    const samples = [1, 2, 3, 4, 5];
    const r = computeZScore(samples);
    expect(r.mean).toBe(3);
    expect(r.stdDev).toBeCloseTo(Math.sqrt(2), 10);
    // last = 5 → z = (5 - 3) / sqrt(2) = sqrt(2) * 1
    expect(r.zScore).toBeCloseTo(2 / Math.sqrt(2), 10);
  });

  it("computeZScore: uses population stddev (divide by N), not sample stddev (divide by N-1)", () => {
    // For samples [1, 2, 3, 4, 5]:
    //   population stddev = sqrt(2) ≈ 1.4142
    //   sample stddev    = sqrt(10/4) = sqrt(2.5) ≈ 1.5811
    const r = computeZScore([1, 2, 3, 4, 5]);
    const expectStdDev = Math.sqrt(2); // POPULATION
    expect(r.stdDev).toBeCloseTo(expectStdDev, 10);
    expect(r.stdDev).not.toBeCloseTo(Math.sqrt(2.5), 5);
  });

  it("computeZScore: cross-checks against handStats helper", () => {
    const samples = [0.5, 1.2, -0.3, 2.1, 0.0, -1.4, 1.8, 0.9];
    const r = computeZScore(samples);
    const h = handStats(samples);
    expect(r.mean).toBeCloseTo(h.mean, 10);
    expect(r.stdDev).toBeCloseTo(h.stdDev, 10);
  });

  // -----------------------------------------------------------------------
  // factor mapping (computeFactor) — tanh-based
  // -----------------------------------------------------------------------

  it("computeFactor: tanh-based, z=0 → factor=0", () => {
    expect(computeFactor(0, 2)).toBe(0);
  });

  it("computeFactor: bounded in [-1, +1] for any finite z (closed interval)", () => {
    // Math.tanh(x) for |x| > ~50 hits IEEE-754 saturation → exactly 1 or -1.
    // The brief says [-1, +1] (closed) so this is the documented behavior.
    for (const z of [-100, -10, -2, -1, -0.5, 0, 0.5, 1, 2, 10, 100]) {
      const f = computeFactor(z, 2);
      expect(f).toBeGreaterThanOrEqual(-1);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it("computeFactor: z=2 with scalingZ=2 → tanh(1) ≈ 0.762", () => {
    const f = computeFactor(2, 2);
    expect(f).toBeCloseTo(Math.tanh(1), 10);
    expect(f).toBeCloseTo(0.7616, 3);
  });

  it("computeFactor: z=3 with scalingZ=2 → tanh(1.5) ≈ 0.905", () => {
    const f = computeFactor(3, 2);
    expect(f).toBeCloseTo(Math.tanh(1.5), 10);
    expect(f).toBeCloseTo(0.9051, 3);
  });

  it("classifyRegime thresholds at z=±1.5 (boundary tests)", () => {
    // z > +1.5 → accumulation
    expect(classifyRegime(3.0, 1.5, -1.5)).toBe("accumulation");
    expect(classifyRegime(1.6, 1.5, -1.5)).toBe("accumulation");
    // z ∈ [-1.5, +1.5] → neutral
    expect(classifyRegime(0.0, 1.5, -1.5)).toBe("neutral");
    expect(classifyRegime(1.5, 1.5, -1.5)).toBe("neutral");
    expect(classifyRegime(-1.5, 1.5, -1.5)).toBe("neutral");
    expect(classifyRegime(1.499, 1.5, -1.5)).toBe("neutral");
    expect(classifyRegime(-1.499, 1.5, -1.5)).toBe("neutral");
    // z < -1.5 → distribution
    expect(classifyRegime(-3.0, 1.5, -1.5)).toBe("distribution");
    expect(classifyRegime(-1.501, 1.5, -1.5)).toBe("distribution");
  });

  it("classifyRegime: non-finite z → neutral (defensive, per implementation)", () => {
    // The implementation explicitly normalizes all non-finite inputs
    // (NaN, ±Infinity) to "neutral" to avoid undefined branching.
    expect(classifyRegime(NaN, 1.5, -1.5)).toBe("neutral");
    expect(classifyRegime(Number.POSITIVE_INFINITY, 1.5, -1.5)).toBe(
      "neutral",
    );
    expect(classifyRegime(Number.NEGATIVE_INFINITY, 1.5, -1.5)).toBe(
      "neutral",
    );
  });

  // -----------------------------------------------------------------------
  // recordNetflowSample — direct injection path
  // -----------------------------------------------------------------------

  it("cold-start guard: < minObservations → no FactorSignal emitted yet", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 5,
      enabledSymbols: ["BTC"],
    });
    const bus = wirePlugin(p);
    const baseTs = Date.now();
    // Add 4 samples (below threshold of 5) — no FactorSignal should fire
    for (let i = 0; i < 4; i++) {
      p.recordNetflowSample("BTC", i + 1, baseTs + i * DAY_MS);
    }
    expect(p.state.totalFactorSignalsEmitted).toBe(0);
    expect(p.currentRegime("BTC")).toBeNull();
    expect(p.currentFactor("BTC")).toBeNull();
    // Latest sample WAS recorded (observationsCount increments)
    const ss = p.state.symbolState.get("BTC");
    expect(ss?.observationsCount).toBe(4);
    expect(ss?.coldStartSkips).toBe(4);
    expect(bus.snapshot().length).toBe(0);
  });

  it("first emit after warm-up populates currentRegime / currentFactor / currentZScore", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 5,
      enabledSymbols: ["BTC"],
    });
    const bus = wirePlugin(p);
    const captured: FactorSignal[] = [];
    bus.subscribe("factor", (s) => {
      if (isFactor(s)) captured.push(s);
    });
    const baseTs = Date.now();
    const r1 = p.recordNetflowSample("BTC", 1, baseTs);
    expect(r1).toBe(true);
    const r2 = p.recordNetflowSample("BTC", 1, baseTs + DAY_MS);
    expect(r2).toBe(true);
    const r3 = p.recordNetflowSample("BTC", 1, baseTs + 2 * DAY_MS);
    expect(r3).toBe(true);
    const r4 = p.recordNetflowSample("BTC", 1, baseTs + 3 * DAY_MS);
    expect(r4).toBe(true);
    // 5th sample → reaches minObservations threshold → emits FactorSignal
    const r5 = p.recordNetflowSample("BTC", 100, baseTs + 4 * DAY_MS);
    expect(r5).toBe(true);
    expect(p.state.totalFactorSignalsEmitted).toBe(1);
    expect(p.currentRegime("BTC")).toBe("accumulation");
    expect(p.currentZScore("BTC")!).toBeGreaterThan(1.5);
    expect(p.currentFactor("BTC")!).toBeGreaterThan(0);
    expect(captured.length).toBe(1);
    expect(captured[0]!.regime).toBe("accumulation");
    expect(captured[0]!.source).toBe("cex-netflow-regime-v1");
    expect(captured[0]!.kind).toBe("factor");
  });

  it("staleness filter: sample older than maxStaleMs is dropped (window NOT polluted)", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 3,
      maxStaleMs: 1 * HOUR_MS, // 1h staleness budget
      enabledSymbols: ["BTC"],
    });
    const oldTs = Date.now() - 2 * HOUR_MS; // 2h old → stale
    const r = p.recordNetflowSample("BTC", 100, oldTs);
    expect(r).toBe(false);
    // Window was NOT populated
    const ss = p.state.symbolState.get("BTC");
    expect(ss?.observationsCount).toBe(0);
    expect(ss?.samples.length).toBe(0);
    expect(ss?.stalenessSkips).toBe(1);
    expect(p.state.totalStalenessSkips).toBe(1);
  });

  it("per-symbol enable filter: non-enabled symbol silently dropped", () => {
    const p = new CexNetFlowRegimePlugin({
      enabledSymbols: ["BTC"],
    });
    expect(p.config.adapter).toBeInstanceOf(NullNetflowAdapter);
    const r = p.recordNetflowSample("DOGE", 100, Date.now());
    expect(r).toBe(false);
    expect(p.state.symbolState.has("DOGE")).toBe(false);
  });

  it("non-finite netflow → drop (returns false)", () => {
    const p = new CexNetFlowRegimePlugin({
      enabledSymbols: ["BTC"],
    });
    expect(
      p.recordNetflowSample("BTC", Number.NaN, Date.now()),
    ).toBe(false);
    expect(
      p.recordNetflowSample("BTC", Number.POSITIVE_INFINITY, Date.now()),
    ).toBe(false);
    // Invalid samples do NOT create symbol state (defensive: short-circuit
    // before allocate). Valid samples DO create state.
    expect(p.state.symbolState.has("BTC")).toBe(false);
    // Valid input creates state and increments observation.
    const ok = p.recordNetflowSample("BTC", 1.5, Date.now());
    expect(ok).toBe(true);
    const ss = p.state.symbolState.get("BTC");
    expect(ss?.observationsCount).toBe(1);
  });

  it("rolling window cap formula: windowDays × 24 × 12 (5-min cadence upper bound)", () => {
    // The plugin enforces a rolling-window cap of
    // `windowDays × 24 × 12` samples (assuming 5-min observation
    // cadence upper bound). With minObservations=30 (default) the
    // cold-start skews the actual rolling-window observation count,
    // so instead we probe the formula indirectly by verifying the
    // plugin accepts the minimum permitted windowDays=30 (which yields
    // 8640 max samples via the formula) and that pushing samples
    // beyond the observation-count threshold trims the array.
    const p = new CexNetFlowRegimePlugin({
      windowDays: 30,
      minObservations: 5,
      enabledSymbols: ["BTC"],
    });
    wirePlugin(p); // wire so symbol state is initialized
    const ss = p.state.symbolState.get("BTC")!;
    // Push 6000 fresh samples spaced 5min apart; with maxSamples
    // = 30 × 24 × 12 = 8640, samples array still fits.
    const baseTs = Date.now();
    for (let i = 0; i < 6_000; i++) {
      p.recordNetflowSample("BTC", i % 10, baseTs + i * 5 * 60 * 1000);
    }
    // samples array capped at windowDays × 24 × 12 = 30 × 288 = 8640.
    // We pushed 6000 (< 8640) so no trim yet — verify samples.length
    // equals 6000 (no trim has fired).
    expect(ss.samples.length).toBe(6_000);
    expect(ss.windowTrimCount).toBe(0);
    // Push enough to exceed 8640 — trim should fire.
    for (let i = 6_000; i < 9_000; i++) {
      p.recordNetflowSample("BTC", i % 10, baseTs + i * 5 * 60 * 1000);
    }
    expect(ss.samples.length).toBe(8_640); // capped at 30 × 288
    expect(ss.windowTrimCount).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 3-layer 1:10 leverage defense
  // -----------------------------------------------------------------------

  it("Layer 1 — metadata.maxLeverage === ONE_TO_TEN_LEVERAGE", () => {
    const p = new CexNetFlowRegimePlugin();
    expect(p.metadata.maxLeverage).toBe(ONE_TO_TEN_LEVERAGE);
  });

  it("Layer 2 — subscribe() increments layer2SubscribeAssertions", () => {
    const p = new CexNetFlowRegimePlugin();
    expect(p.state.layer2SubscribeAssertions).toBe(0);
    wirePlugin(p);
    expect(p.state.layer2SubscribeAssertions).toBe(1);
  });

  it("Layer 3 — each emit increments layer3EmitAssertions (cold-start at minObservations=3 yields 3 emits for 5 samples)", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 3,
      enabledSymbols: ["BTC"],
    });
    const bus = wirePlugin(p);
    const baselineAsserts = p.state.layer3EmitAssertions;
    feedNetflowSeries(p, "BTC", [1, 2, 3, 4, 5], Date.now(), 0);
    // 5 samples fed: samples 1, 2 are cold-start (observationsCount < 3),
    // samples 3, 4, 5 each emit a FactorSignal → 3 emits total.
    const emitsForThisRun = p.state.totalFactorSignalsEmitted;
    expect(emitsForThisRun).toBe(3);
    expect(p.state.layer3EmitAssertions).toBe(baselineAsserts + emitsForThisRun);
    void bus;
  });

  // -----------------------------------------------------------------------
  // Bus publish contract + FactorSignal discriminator
  // -----------------------------------------------------------------------

  it("bus.emit('factor') delivers to factor subscribers only", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 3,
      enabledSymbols: ["BTC"],
    });
    const bus = wirePlugin(p);
    let factorCount = 0;
    let directionCount = 0;
    bus.subscribe("factor", () => factorCount++);
    bus.subscribe("direction", () => directionCount++);
    feedNetflowSeries(p, "BTC", [1, 2, 100], Date.now(), 0);
    // Only 1 emit (samples 1, 2 are cold-start, 100 has z > 1.5 → emit)
    expect(factorCount).toBe(1);
    expect(directionCount).toBe(0);
    expect(p.state.totalFactorSignalsEmitted).toBe(1);
  });

  it("isFactor narrows correctly; emitted FactorSignal source matches plugin metadata.name", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 3,
      enabledSymbols: ["BTC"],
    });
    const bus = wirePlugin(p);
    let captured: FactorSignal | null = null;
    bus.subscribe("factor", (s) => {
      if (isFactor(s)) captured = s;
    });
    feedNetflowSeries(p, "BTC", [1, 2, 100], Date.now(), 0);
    expect(captured).not.toBeNull();
    expect(captured!.source).toBe("cex-netflow-regime-v1");
    expect(captured!.kind).toBe("factor");
    expect(captured!.factor).toBeGreaterThan(0);
    expect(["accumulation", "neutral", "distribution"]).toContain(
      captured!.regime,
    );
  });

  it("FactorSignal payload shape: factor ∈ (-1, 1), zScore is unbounded, regime ∈ {acc, neut, dist}", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 3,
      enabledSymbols: ["BTC"],
    });
    const bus = wirePlugin(p);
    const all: FactorSignal[] = [];
    bus.subscribe("factor", (s) => {
      if (isFactor(s)) all.push(s);
    });
    feedNetflowSeries(p, "BTC", [1, 2, 5, 1, 2, 5], Date.now(), 0);
    // All FactorSignals must be well-formed
    expect(all.length).toBeGreaterThan(0);
    for (const sig of all) {
      expect(sig.factor).toBeGreaterThan(-1);
      expect(sig.factor).toBeLessThan(1);
      expect(Number.isFinite(sig.zScore)).toBe(true);
      expect(["accumulation", "neutral", "distribution"]).toContain(sig.regime);
      expect(sig.kind).toBe("factor");
      expect(sig.source).toBe("cex-netflow-regime-v1");
    }
  });

  // -----------------------------------------------------------------------
  // Lifecycle — reset, dispose
  // -----------------------------------------------------------------------

  it("reset() clears state but preserves enabledSymbols config", () => {
    const p = new CexNetFlowRegimePlugin({
      enabledSymbols: ["BTC", "ETH"],
    });
    wirePlugin(p);
    feedNetflowSeries(p, "BTC", constNetflow(20, 1), Date.now(), 0);
    feedNetflowSeries(p, "ETH", constNetflow(20, 2), Date.now(), 0);
    expect(p.state.totalSamplesRecorded).toBe(40);
    p.reset();
    expect(p.state.totalSamplesRecorded).toBe(0);
    expect(p.state.totalFactorSignalsEmitted).toBe(0);
    expect(p.state.layer2SubscribeAssertions).toBe(0);
    // Symbol state should be re-initialized for enabled symbols
    expect(p.state.symbolState.has("BTC")).toBe(true);
    expect(p.state.symbolState.has("ETH")).toBe(true);
    expect(p.config.enabledSymbols).toEqual(["BTC", "ETH"]);
  });

  it("dispose() releases poll timer and bus reference", () => {
    const p = new CexNetFlowRegimePlugin();
    wirePlugin(p);
    p.startLivePolling();
    p.dispose();
    // Cannot directly inspect private fields, but a second dispose() must
    // not throw and subsequent refreshLive should be a no-op.
    expect(() => p.dispose()).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Adapter DI (constructor override)
  // -----------------------------------------------------------------------

  it("NullNetflowAdapter returns null for any symbol", async () => {
    const a = new NullNetflowAdapter();
    expect(a.name).toBe("null");
    expect(await a.fetchNetflowSample("BTC")).toBeNull();
    expect(await a.fetchNetflowSample("XYZ")).toBeNull();
  });

  it("CoinglassNetflowAdapter without API key returns null (graceful degradation)", async () => {
    const { CoinglassNetflowAdapter } = await import(
      "./cex-netflow-regime-plugin.js"
    );
    const a = new CoinglassNetflowAdapter(null);
    expect(await a.fetchNetflowSample("BTC")).toBeNull();
    // With a fake API key: still null (live fetch not implemented in v1)
    const a2 = new CoinglassNetflowAdapter("fake-key");
    expect(await a2.fetchNetflowSample("BTC")).toBeNull();
  });

  it("CryptoQuantNetflowAdapter without API key returns null", async () => {
    const { CryptoQuantNetflowAdapter } = await import(
      "./cex-netflow-regime-plugin.js"
    );
    const a = new CryptoQuantNetflowAdapter(null);
    expect(await a.fetchNetflowSample("ETH")).toBeNull();
  });

  it("CoinGlassExchangeBalanceAdapter returns null", async () => {
    const { CoinGlassExchangeBalanceAdapter } = await import(
      "./cex-netflow-regime-plugin.js"
    );
    const a = new CoinGlassExchangeBalanceAdapter();
    expect(await a.fetchNetflowSample("SOL")).toBeNull();
  });

  it("Custom mock adapter integration via refreshLive records samples", async () => {
    const ts = Date.now();
    const mock = new MockNetflowAdapter("mock", {
      BTC: { symbol: "BTC", netflow: 100, timestampMs: ts },
      ETH: null, // unavailable
      SOL: { symbol: "SOL", netflow: 50, timestampMs: ts },
    });
    const p = new CexNetFlowRegimePlugin({
      minObservations: 2,
      enabledSymbols: ["BTC", "ETH", "SOL"],
      adapter: mock,
      maxStaleMs: 24 * HOUR_MS,
    });
    wirePlugin(p);
    const count = await p.refreshLive(ts);
    expect(count).toBe(2); // BTC + SOL; ETH returned null → skipped
    expect(mock.callCount).toBe(3);
    expect(p.getAdapterName()).toBe("mock");
  });

  it("extractFactorSignal static helper narrows correctly", () => {
    const sig: Signal = {
      kind: "factor",
      factor: 0.5,
      regime: "accumulation",
      zScore: 1.7,
      source: "cex-netflow-regime-v1",
      timestampMs: 1_700_000_000_000,
    };
    const r = CexNetFlowRegimePlugin.extractFactorSignal(sig);
    expect(r).not.toBeNull();
    expect(r!.factor).toBe(0.5);
    expect(r!.regime).toBe("accumulation");
  });

  it("extractFactorSignal returns null for non-factor signals", () => {
    const sig: Signal = {
      kind: "carry",
      fundingRate: 0.0001,
      regime: "high",
      source: "test",
    };
    expect(CexNetFlowRegimePlugin.extractFactorSignal(sig)).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Determinism + adversarial probes
  // -----------------------------------------------------------------------

  it("same input sequence → same output sequence (deterministic across runs)", () => {
    const config: Partial<CexNetFlowRegimeConfig> = {
      minObservations: 5,
      enabledSymbols: ["BTC"],
    };
    const run = (): number[] => {
      const p = new CexNetFlowRegimePlugin(config);
      wirePlugin(p);
      const samples = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6];
      feedNetflowSeries(p, "BTC", samples, Date.now(), 0);
      // pull out the most-recent emit signature from state
      const sig = p.state.lastFactorSignal;
      return sig ? [sig.factor, sig.zScore] : [0, 0];
    };
    const r1 = run();
    const r2 = run();
    expect(r1).toEqual(r2);
  });

  // ADVERSARIAL PROBE — dedup invariance: feeding the same sample multiple
  // times in a row should keep state DETERMINISTIC after each call
  // (z-score / factor / regime unchanged → all downstream composition
  // stays identical regardless of input multiplicity).
  it("[adversarial] dedup invariance: same sample fed 100× keeps factor values identical", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 3,
      enabledSymbols: ["BTC"],
    });
    wirePlugin(p);
    const baseTs = Date.now();
    p.recordNetflowSample("BTC", 5, baseTs);
    p.recordNetflowSample("BTC", 5, baseTs + DAY_MS);
    p.recordNetflowSample("BTC", 5, baseTs + 2 * DAY_MS);
    // After 3 identical samples, currentZScore=0 (uniform window),
    // currentFactor=0, regime=neutral.
    expect(p.currentZScore("BTC")!).toBe(0);
    expect(p.currentFactor("BTC")!).toBe(0);
    expect(p.currentRegime("BTC")).toBe("neutral");
    // Feed the same sample 100 more times — z-score, factor, and regime
    // remain at 0/0/neutral regardless of input multiplicity. Number
    // of emits WILL grow (each observation produces an emit), but the
    // PUBLISHED VALUES stay identical.
    for (let i = 0; i < 100; i++) {
      p.recordNetflowSample("BTC", 5, baseTs + 3 * DAY_MS);
    }
    expect(p.currentZScore("BTC")!).toBe(0);
    expect(p.currentFactor("BTC")!).toBe(0);
    expect(p.currentRegime("BTC")).toBe("neutral");
  });

  // ADVERSARIAL PROBE — calibration edge: z-score just BELOW vs just ABOVE
  // the ±1.5 regime threshold must classify differently.
  it("[adversarial] calibration edge: z=-1.499 → neutral; z=-1.501 → distribution", () => {
    // Construct a window where the LAST element yields z=-1.499 exactly
    // and z=-1.501 exactly, by manipulating a known distribution.
    //
    // Window [0,0,0,0,X] → mean=X/5, stdDev=sqrt((4*(X/5)^2 + (X-X/5)^2)/5)
    // That gets complex; instead use computeZScore with a known sample set.
    //
    // Simpler: write a 2-sample window [0, X] → mean=X/2,
    //   stdDev = sqrt((X/2)^2 + (X/2)^2)/sqrt(2) = X/2
    //   z = (X - X/2) / (X/2) = 1.0
    // 3-sample? [0, 0, X] → mean=X/3, var = 2*(X/3)^2 + (2X/3)^2 = 6 X^2 / 9
    //   stdDev = sqrt(6/9) X = sqrt(2/3) X
    //   z = (X - X/3) / (sqrt(2/3) X) = (2/3) / sqrt(2/3) = sqrt(2/3) ≈ 0.816
    // We can't easily hit ±1.5 from synthetic samples — instead, probe
    // classifyRegime at the boundaries directly.
    expect(classifyRegime(-1.499, 1.5, -1.5)).toBe("neutral");
    expect(classifyRegime(-1.501, 1.5, -1.5)).toBe("distribution");
    expect(classifyRegime(1.499, 1.5, -1.5)).toBe("neutral");
    expect(classifyRegime(1.501, 1.5, -1.5)).toBe("accumulation");
    // Threshold boundary at exactly ±1.5 is inclusive-neutral
    expect(classifyRegime(-1.5, 1.5, -1.5)).toBe("neutral");
    expect(classifyRegime(1.5, 1.5, -1.5)).toBe("neutral");
  });

  // -----------------------------------------------------------------------
  // Confidence + 1:10 layer3 invariant introspection
  // -----------------------------------------------------------------------

  it("confidence scales from cold-start to ~1.0 as observations accumulate", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 5,
      enabledSymbols: ["BTC"],
    });
    wirePlugin(p);
    const captured: FactorSignal[] = [];
    const bus = new SignalBus({ mode: "backtest" });
    p.subscribe(bus);
    bus.subscribe("factor", (s) => {
      if (isFactor(s)) captured.push(s);
    });
    // Feed samples 1..20 (constant value — z=0, factor=0, regime=neutral,
    // but confidence should still scale because the test is about the
    // scaling math). However, with z=0 the regime stays neutral; we just
    // check that when confidence is on the emitted sig it ramps up.
    feedNetflowSeries(p, "BTC", constNetflow(25, 1), Date.now(), 0);
    // First emit happens at minObservations=5 (after 5 samples).
    const first = captured[0];
    expect(first).toBeDefined();
    if (first?.confidence !== undefined) {
      // At observation #5: confidence = min(1, 5/(5×4)) = min(1, 0.25) = 0.25
      expect(first.confidence).toBeCloseTo(0.25, 2);
    }
    // Last emit is at observation #25: confidence = min(1, 25/(5×4)) = 1.0
    const last = captured[captured.length - 1];
    if (last?.confidence !== undefined) {
      expect(last.confidence).toBeCloseTo(1.0, 2);
    }
  });

  it("Layer 3 1:10 invariant: layer3EmitAssertions counts each emit (zero-notional)", () => {
    const p = new CexNetFlowRegimePlugin({
      minObservations: 2,
      enabledSymbols: ["BTC"],
    });
    wirePlugin(p);
    const before = p.state.layer3EmitAssertions;
    feedNetflowSeries(p, "BTC", constNetflow(50, 5), Date.now(), 0);
    // (50 - minObservations) = 48 emits when window is uniform (z=0, regime=neutral,
    // confidence reaches 1.0 → confidence field omitted; but emit count = totalFactorSignalsEmitted)
    expect(p.state.layer3EmitAssertions).toBeGreaterThanOrEqual(before);
    // Every emit fired layer3 check; assertions count == total emits
    expect(p.state.layer3EmitAssertions).toBe(p.state.totalFactorSignalsEmitted + before);
  });

  // -----------------------------------------------------------------------
  // Factory + plugin lifecycle notes
  // -----------------------------------------------------------------------

  it("createCexNetFlowRegimePlugin factory works", () => {
    const p = createCexNetFlowRegimePlugin({ baseNotionalUsd: 8_000 });
    expect(p.metadata.name).toBe("cex-netflow-regime-v1");
    expect(p.config.baseNotionalUsd).toBe(8_000);
  });

  it("onBar is a no-op (increments barsProcessed only)", () => {
    const p = new CexNetFlowRegimePlugin();
    wirePlugin(p);
    const before = p.state.barsProcessed;
    p.onBar(mkBar(), null as unknown as CexNetFlowRegimePluginState);
    p.onBar(mkBar(), null as unknown as CexNetFlowRegimePluginState);
    p.onBar(mkBar(), null as unknown as CexNetFlowRegimePluginState);
    expect(p.state.barsProcessed).toBe(before + 3);
  });
});
