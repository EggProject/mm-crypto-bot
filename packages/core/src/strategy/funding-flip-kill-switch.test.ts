/**
 * packages/core/src/strategy/funding-flip-kill-switch.test.ts
 *
 * Unit tesztek a `funding-flip-kill-switch.ts` pure-functional
 * detector helpers-hez. A forrás 276 LOC, 3 fő export:
 *   - `assert1to10Leverage(leverage)` — 1:10 mandate guardrail
 *   - `computeFlipDetectorMetrics(history, cfg)` — windowed metrics
 *   - `evaluateRegime(metrics, cfg)` — regime decision
 *
 * A 100% line+function coverage eléréséhez a throw path-okat
 * (assert1to10Leverage invalid input), az empty history path-ot
 * (computeFlipDetectorMetrics early return), és az extreme regime
 * path-ot (evaluateRegime when zscore triggered) is le kell fedni.
 */

import { describe, expect, it } from "bun:test";
import {
  ALLOWED_KILL_SWITCH_LEVERAGE,
  assert1to10Leverage,
  computeFlipDetectorMetrics,
  DEFAULT_FLIP_DETECTOR_CONFIG,
  evaluateRegime,
  type FlipDetectorConfig,
} from "./funding-flip-kill-switch.js";

// === assert1to10Leverage ===

describe("assert1to10Leverage — 1:10 mandate guardrail", () => {
  it("elfogadja a leverage=1 értéket (baseline)", () => {
    expect(() => assert1to10Leverage(1)).not.toThrow();
  });

  it("elfogadja a leverage=10 értéket (1:10 bybit.eu SPOT default)", () => {
    expect(() => assert1to10Leverage(10)).not.toThrow();
  });

  it("dob egy Error-t ha a leverage nem 1 vagy 10 (pl. 5)", () => {
    expect(() => assert1to10Leverage(5)).toThrow(/1:10 HARD GUARDRAIL/);
  });

  it("dob egy Error-t ha a leverage negatív (pl. -1)", () => {
    expect(() => assert1to10Leverage(-1)).toThrow(/1:10 HARD GUARDRAIL/);
  });

  it("dob egy Error-t ha a leverage 0", () => {
    expect(() => assert1to10Leverage(0)).toThrow(/NOT allowed/);
  });

  it("dob egy Error-t ha a leverage > 10 (pl. 20)", () => {
    expect(() => assert1to10Leverage(20)).toThrow(/NOT allowed/);
  });

  it("ALLOWED_KILL_SWITCH_LEVERAGE frozen array tartalma [1, 10]", () => {
    expect(ALLOWED_KILL_SWITCH_LEVERAGE).toEqual([1, 10]);
    expect(Object.isFrozen(ALLOWED_KILL_SWITCH_LEVERAGE)).toBe(true);
  });
});

// === computeFlipDetectorMetrics ===

describe("computeFlipDetectorMetrics — empty history", () => {
  it("üres history-ra minden mező 0 (nincs flip regime)", () => {
    const m = computeFlipDetectorMetrics([], DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m).toEqual({
      flipCount: 0,
      negativeDominance: 0,
      absRateMean: 0,
      absRateStdDev: 0,
      baselineAbsRateMean: 0,
      baselineAbsRateStdDev: 0,
      zscore: 0,
      windowSize: 0,
      baselineWindowSize: 0,
    });
  });
});

describe("computeFlipDetectorMetrics — basic windowing", () => {
  it("21 snapshot-ból (7d × 3) kiszámolja a flip count-ot és a negatív dominanciát", () => {
    // 7d × 3 = 21 snapshot
    // +5, -5, +5, -5, ... (alternating)
    // 20 sign-flips (every consecutive non-zero pair flips)
    const history = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const m = computeFlipDetectorMetrics(history, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.windowSize).toBe(21);
    expect(m.flipCount).toBe(20);
    expect(m.negativeDominance).toBeCloseTo(10 / 21, 5);
  });

  it("kiszámolja a baseline statisztikákat a 30d trailing window-ból", () => {
    // 30d × 3 = 90 snapshot, mind 0.001 (constant)
    const history = Array.from({ length: 90 }, () => 0.001);
    const m = computeFlipDetectorMetrics(history, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.baselineWindowSize).toBe(90);
    expect(m.baselineAbsRateMean).toBeCloseTo(0.001, 6);
    expect(m.baselineAbsRateStdDev).toBeCloseTo(0, 9);
  });

  it("history rövidebb mint a flip window: csak a history-t használja", () => {
    // 5 snapshot, kevesebb mint 21
    const history = [0.01, -0.01, 0.01, -0.01, 0.01];
    const m = computeFlipDetectorMetrics(history, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.windowSize).toBe(5);
    expect(m.flipCount).toBe(4); // 4 sign-flips in 5 snapshots
  });

  it("zero-rate snapshots kimaradnak a sign-flip láncból (1 sign-flip marad)", () => {
    // +5, 0, 0, 0, -5 → a 0-k kimaradnak a sign-flip láncból,
    // így 1 sign-flip van (a +0.01 és -0.01 között)
    const history = [0.01, 0, 0, 0, -0.01];
    const m = computeFlipDetectorMetrics(history, DEFAULT_FLIP_DETECTOR_CONFIG);
    expect(m.flipCount).toBe(1);
    expect(m.negativeDominance).toBeCloseTo(1 / 5, 5);
  });

  it("z-score számítása: flip-window mean vs baseline mean / baseline stddev", () => {
    // Construct: 30d baseline 0.001 ± 0.0001 noise (periodikus), then 7d spike to 0.005
    // A periodic pattern garantálja, hogy a baseline mean 0.001 és a stddev > 0.
    const baseline: number[] = [];
    for (let i = 0; i < 90; i++) {
      baseline.push(0.001 + (((i % 3) - 1) * 0.0002)); // -0.0001, +0.0001, +0.0003 cycling
    }
    // 90 elem, az átlag: 30*-0.0001 + 30*0.0001 + 30*0.0003 = 0.009
    // (bázis érték 0.001 az origó, így 90 elem 0.001-gyel kiegészítve az átlag = 0.001 + 0.009/90 = 0.0011)
    const spike = Array.from({ length: 21 }, () => 0.005);
    const history = [...baseline, ...spike];
    const m = computeFlipDetectorMetrics(history, DEFAULT_FLIP_DETECTOR_CONFIG);
    // baseline mean ≈ 0.0011, stddev > 0
    // flip mean ≈ 0.005, so z-score should be positive
    expect(m.baselineAbsRateStdDev).toBeGreaterThan(0);
    expect(m.zscore).toBeGreaterThan(0);
  });
});

// === evaluateRegime ===

describe("evaluateRegime — no regime (all below thresholds)", () => {
  it("minden metrika 0 → nincs aktív regime", () => {
    const decision = evaluateRegime(
      {
        flipCount: 0,
        negativeDominance: 0,
        absRateMean: 0,
        absRateStdDev: 0,
        baselineAbsRateMean: 0,
        baselineAbsRateStdDev: 0,
        zscore: 0,
        windowSize: 0,
        baselineWindowSize: 0,
      },
      DEFAULT_FLIP_DETECTOR_CONFIG,
    );
    expect(decision.regimeActive).toBe(false);
    expect(decision.flipRegime).toBe(false);
    expect(decision.negativeDominanceRegime).toBe(false);
    expect(decision.extremeRegime).toBe(false);
    expect(decision.reason).toContain("regime-inactive");
  });
});

describe("evaluateRegime — flip regime triggered", () => {
  it("flipCount ≥ threshold → flipRegime=true, reason mentions flip count", () => {
    const cfg: FlipDetectorConfig = { ...DEFAULT_FLIP_DETECTOR_CONFIG, flipThreshold: 5 };
    const decision = evaluateRegime(
      {
        flipCount: 6,
        negativeDominance: 0.5,
        absRateMean: 0.01,
        absRateStdDev: 0.001,
        baselineAbsRateMean: 0.01,
        baselineAbsRateStdDev: 0.001,
        zscore: 0.5,
        windowSize: 21,
        baselineWindowSize: 90,
      },
      cfg,
    );
    expect(decision.regimeActive).toBe(true);
    expect(decision.flipRegime).toBe(true);
    expect(decision.negativeDominanceRegime).toBe(false);
    expect(decision.extremeRegime).toBe(false);
    expect(decision.reason).toContain("flipCount=6");
  });
});

describe("evaluateRegime — negative-dominance regime triggered", () => {
  it("negativeDominance ≥ threshold → negativeDominanceRegime=true", () => {
    const cfg: FlipDetectorConfig = { ...DEFAULT_FLIP_DETECTOR_CONFIG, negativeDominanceThreshold: 0.8 };
    const decision = evaluateRegime(
      {
        flipCount: 2,
        negativeDominance: 0.85,
        absRateMean: 0.01,
        absRateStdDev: 0.001,
        baselineAbsRateMean: 0.01,
        baselineAbsRateStdDev: 0.001,
        zscore: 0.5,
        windowSize: 21,
        baselineWindowSize: 90,
      },
      cfg,
    );
    expect(decision.regimeActive).toBe(true);
    expect(decision.flipRegime).toBe(false);
    expect(decision.negativeDominanceRegime).toBe(true);
    expect(decision.extremeRegime).toBe(false);
    expect(decision.reason).toContain("negativeDominance=85.0%");
  });
});

describe("evaluateRegime — extreme z-score regime triggered (zscore positive)", () => {
  it("|zscore| ≥ threshold → extremeRegime=true, reason mentions |zscore|", () => {
    const cfg: FlipDetectorConfig = { ...DEFAULT_FLIP_DETECTOR_CONFIG, extremeZscoreThreshold: 1.5 };
    const decision = evaluateRegime(
      {
        flipCount: 0,
        negativeDominance: 0.1,
        absRateMean: 0.05,
        absRateStdDev: 0.01,
        baselineAbsRateMean: 0.01,
        baselineAbsRateStdDev: 0.005,
        zscore: 8.0, // (0.05 - 0.01) / 0.005 = 8.0
        windowSize: 21,
        baselineWindowSize: 90,
      },
      cfg,
    );
    expect(decision.regimeActive).toBe(true);
    expect(decision.flipRegime).toBe(false);
    expect(decision.negativeDominanceRegime).toBe(false);
    expect(decision.extremeRegime).toBe(true);
    expect(decision.reason).toContain("|zscore|=8.00");
  });

  it("zscore = -8.0 (negatív extrém) → extremeRegime=true (|zscore| >= threshold)", () => {
    const cfg: FlipDetectorConfig = { ...DEFAULT_FLIP_DETECTOR_CONFIG, extremeZscoreThreshold: 1.5 };
    const decision = evaluateRegime(
      {
        flipCount: 0,
        negativeDominance: 0.1,
        absRateMean: 0.0,
        absRateStdDev: 0,
        baselineAbsRateMean: 0.01,
        baselineAbsRateStdDev: 0.005,
        zscore: -8.0,
        windowSize: 21,
        baselineWindowSize: 90,
      },
      cfg,
    );
    expect(decision.extremeRegime).toBe(true);
    expect(decision.reason).toContain("|zscore|=8.00");
  });
});

describe("evaluateRegime — all three regimes active", () => {
  it("flip + negative-dominance + extreme egyidejűleg → reason mind a hármat tartalmazza", () => {
    const cfg: FlipDetectorConfig = {
      ...DEFAULT_FLIP_DETECTOR_CONFIG,
      flipThreshold: 3,
      negativeDominanceThreshold: 0.5,
      extremeZscoreThreshold: 1.0,
    };
    const decision = evaluateRegime(
      {
        flipCount: 10,
        negativeDominance: 0.9,
        absRateMean: 0.05,
        absRateStdDev: 0.01,
        baselineAbsRateMean: 0.01,
        baselineAbsRateStdDev: 0.005,
        zscore: 8.0,
        windowSize: 21,
        baselineWindowSize: 90,
      },
      cfg,
    );
    expect(decision.flipRegime).toBe(true);
    expect(decision.negativeDominanceRegime).toBe(true);
    expect(decision.extremeRegime).toBe(true);
    expect(decision.reason).toContain("regime-active");
    expect(decision.reason).toContain("flipCount=10");
    expect(decision.reason).toContain("negativeDominance=90.0%");
    expect(decision.reason).toContain("|zscore|=8.00");
  });
});
