// Public aggregate leverage invariant behavior.

import { describe, expect, test } from "bun:test";

import {
  assertLeverageInvariant,
  assertPositionsInvariant,
  checkLeverageApproach,
  computeEffectiveLeverage,
  DEFAULT_LEVERAGE_INVARIANT_CONFIG,
  LeverageBreachError,
  ONE_TO_TEN_LEVERAGE,
  ONE_X_LEVERAGE,
  type Position,
} from "./leverage-invariant.js";

// ----------------------------------------------------------------------
// assertLeverageInvariant — boundary tests on the 1:10 cap
// ----------------------------------------------------------------------

describe("assertLeverageInvariant — boundary tests", () => {
  test("10× exactly → no throw", () => {
    const baseCapital = 10_000;
    const totalNotional = 10 * baseCapital; // 100_000
    expect(() => {
      assertLeverageInvariant(totalNotional, baseCapital);
    }).not.toThrow();
  });

  test("10.001× → throws LeverageBreachError", () => {
    const baseCapital = 10_000;
    const totalNotional = 100_010; // 10.001×
    expect(() => {
      assertLeverageInvariant(totalNotional, baseCapital);
    }).toThrow(LeverageBreachError);
  });

  test("11× → throws with details", () => {
    const baseCapital = 10_000;
    const totalNotional = 110_000; // 11×
    let caught: unknown;
    try {
      assertLeverageInvariant(totalNotional, baseCapital);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LeverageBreachError);
    if (caught instanceof LeverageBreachError) {
      expect(caught.computedLeverage).toBeCloseTo(11, 6);
      expect(caught.baseCapital).toBe(10_000);
      expect(caught.maxLeverage).toBe(10);
      expect(caught.message).toContain("1:10 MANDATE BREACH");
    }
  });

  test("1× → no throw (baseline reference)", () => {
    const baseCapital = 10_000;
    const totalNotional = 10_000; // 1×
    expect(() => {
      assertLeverageInvariant(totalNotional, baseCapital);
    }).not.toThrow();
  });

  test("0× (zero notional) → no throw", () => {
    const baseCapital = 10_000;
    const totalNotional = 0;
    expect(() => {
      assertLeverageInvariant(totalNotional, baseCapital);
    }).not.toThrow();
  });

  test("5× → no throw (under cap, not a permitted production state but the guard does not refuse it)", () => {
    // The guard's job is the UPPER bound (max 10×). Mid-cap values are
    // not the guard's concern — they're the per-strategy layer's concern.
    const baseCapital = 10_000;
    const totalNotional = 50_000; // 5×
    expect(() => {
      assertLeverageInvariant(totalNotional, baseCapital);
    }).not.toThrow();
  });
});

// ----------------------------------------------------------------------
// assertLeverageInvariant — defensive input validation
// ----------------------------------------------------------------------

describe("assertLeverageInvariant — defensive guards", () => {
  test("NaN notional → throws (does NOT silently allow)", () => {
    expect(() => {
      assertLeverageInvariant(NaN, 10_000);
    }).toThrow(/finite/);
  });

  test("Infinity notional → throws", () => {
    expect(() => {
      assertLeverageInvariant(Infinity, 10_000);
    }).toThrow(/finite/);
  });

  test("NaN base capital → throws", () => {
    expect(() => {
      assertLeverageInvariant(10_000, NaN);
    }).toThrow(/finite/);
  });

  test("Zero base capital → throws (division by zero)", () => {
    expect(() => {
      assertLeverageInvariant(10_000, 0);
    }).toThrow(/positive/);
  });

  test("Negative base capital → throws", () => {
    expect(() => {
      assertLeverageInvariant(10_000, -1);
    }).toThrow(/positive/);
  });

  test("Negative notional → throws (defensive — caller bug, not silently abs())", () => {
    expect(() => {
      assertLeverageInvariant(-50_000, 10_000);
    }).toThrow(/non-negative/);
  });
});

describe("assertLeverageInvariant — custom config", () => {
  test("custom cap 3× — 3.5× throws", () => {
    const baseCapital = 10_000;
    const totalNotional = 35_000; // 3.5×
    const config = { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, maxLeverage: 3 };
    expect(() => {
      assertLeverageInvariant(totalNotional, baseCapital, config);
    }).toThrow(LeverageBreachError);
  });

  test("default configuration rejects 10.0000001×", () => {
    const baseCapital = 10_000;
    const totalNotional = 100_000.001;
    expect(() => {
      assertLeverageInvariant(totalNotional, baseCapital);
    }).toThrow(LeverageBreachError);
  });

  test("positive tolerance is rejected instead of absorbing 10.0000001×", () => {
    const baseCapital = 10_000;
    const totalNotional = 100_000.001;
    const config = { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, tolerance: 0.000001 };
    expect(() => {
      assertLeverageInvariant(totalNotional, baseCapital, config);
    }).toThrow("[leverage-invariant] Leverage configuration is invalid.");
  });

  test("negative zero tolerance is rejected", () => {
    const config = { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, tolerance: -0 };
    expect(() => {
      assertLeverageInvariant(100_000, 10_000, config);
    }).toThrow("[leverage-invariant] Leverage configuration is invalid.");
  });

  test("hard and soft guards reject every noncanonical tolerance before evaluating measurements", () => {
    const noncanonicalTolerances = [0.000001, -0.000001, NaN, Infinity, -Infinity, -0];

    for (const tolerance of noncanonicalTolerances) {
      const config = { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, tolerance };
      expect(() => {
        assertLeverageInvariant(100_000, 10_000, config);
      }).toThrow("[leverage-invariant] Leverage configuration is invalid.");
      expect(() => checkLeverageApproach(NaN, 10_000, config)).toThrow(
        "[leverage-invariant] Leverage configuration is invalid.",
      );
    }
  });

  test("hard and soft guards reject invalid maximum and warning configuration", () => {
    const invalidConfigurations = [
      { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, maxLeverage: NaN },
      { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, maxLeverage: Infinity },
      { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, maxLeverage: 0 },
      { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, maxLeverage: -1 },
      { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, warnOnApproach: NaN },
      { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, warnOnApproach: Infinity },
      { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, warnOnApproach: -0.01 },
      { ...DEFAULT_LEVERAGE_INVARIANT_CONFIG, warnOnApproach: 1.01 },
    ];

    for (const config of invalidConfigurations) {
      expect(() => {
        assertLeverageInvariant(50_000, 10_000, config);
      }).toThrow("[leverage-invariant] Leverage configuration is invalid.");
      expect(() => checkLeverageApproach(NaN, 10_000, config)).toThrow(
        "[leverage-invariant] Leverage configuration is invalid.",
      );
    }
  });

  test("snapshots every public config field once for each guard", () => {
    const readCounts = { maximum: 0, tolerance: 0, warning: 0 };
    const config = {
      get maxLeverage(): number {
        readCounts.maximum += 1;
        return 10;
      },
      get tolerance(): number {
        readCounts.tolerance += 1;
        return 0;
      },
      get warnOnApproach(): number {
        readCounts.warning += 1;
        return 0.95;
      },
    };

    expect(() => {
      assertLeverageInvariant(100_000, 10_000, config);
    }).not.toThrow();
    expect(readCounts).toEqual({ maximum: 1, tolerance: 1, warning: 1 });
    readCounts.maximum = 0;
    readCounts.tolerance = 0;
    readCounts.warning = 0;
    expect(checkLeverageApproach(95_000, 10_000, config)).toBe(true);
    expect(readCounts).toEqual({ maximum: 1, tolerance: 1, warning: 1 });
  });

  test("hard and soft guards fail closed for hostile and revoked configurations", () => {
    const hostile = {
      get maxLeverage(): number {
        throw new Error("hostile getter");
      },
      tolerance: 0,
      warnOnApproach: 0.95,
    };
    const revoked = Proxy.revocable(DEFAULT_LEVERAGE_INVARIANT_CONFIG, {});
    revoked.revoke();
    const malformed = { maxLeverage: "10", tolerance: 0, warnOnApproach: 0.95 };

    expect(() => {
      assertLeverageInvariant(100_000, 10_000, hostile);
    }).toThrow("[leverage-invariant] Leverage configuration is invalid.");
    expect(() => checkLeverageApproach(NaN, 10_000, hostile)).toThrow(
      "[leverage-invariant] Leverage configuration is invalid.",
    );
    expect(() => {
      assertLeverageInvariant(100_000, 10_000, revoked.proxy);
    }).toThrow("[leverage-invariant] Leverage configuration is invalid.");
    expect(() => checkLeverageApproach(NaN, 10_000, revoked.proxy)).toThrow(
      "[leverage-invariant] Leverage configuration is invalid.",
    );
    expect(() => {
      Reflect.apply(assertLeverageInvariant, undefined, [100_000, 10_000, false]);
    }).toThrow("[leverage-invariant] Leverage configuration is invalid.");
    expect(() => {
      Reflect.apply(checkLeverageApproach, undefined, [NaN, 10_000, malformed]);
    }).toThrow("[leverage-invariant] Leverage configuration is invalid.");
  });
});

describe("computeEffectiveLeverage — pure function", () => {
  test("empty positions → 0", () => {
    expect(computeEffectiveLeverage([], 10_000)).toBe(0);
  });

  test("single position 10× notional on 10k capital → 10×", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 100_000 },
    ];
    expect(computeEffectiveLeverage(positions, 10_000)).toBe(10);
  });

  test("two positions each 5× → AGGREGATE 10× (not 5×)", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 50_000 },
      { symbol: "ETH/USDT", source: "directional", effectiveNotionalUsd: 50_000 },
    ];
    expect(computeEffectiveLeverage(positions, 10_000)).toBe(10);
  });

  test("two positions each 6× → AGGREGATE 12× (BREACH)", () => {
    // This is the canonical scenario the 3rd layer defends against:
    // each strategy individually reports 6× (under cap), but the
    // AGGREGATE is 12× (above cap). The per-strategy guard (layer 2)
    // would NOT fire because each strategy is at 6×.
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 60_000 },
      { symbol: "ETH/USDT", source: "directional", effectiveNotionalUsd: 60_000 },
    ];
    expect(computeEffectiveLeverage(positions, 10_000)).toBe(12);
  });

  test("short + long at same magnitude → gross 10× (NOT netted; mandate caps gross exposure)", () => {
    // The 1:10 mandate is about GROSS exposure (what can move against
    // you under liquidation). A perfectly-hedged position still has
    // 100k notional (50k long + 50k short) — if either leg gets
    // liquidated, the other leg is naked. So we sum abs() not signed.
    // This matches the bybit.eu SPOT-margin MMR (Maintenance Margin
    // Requirement) which is computed on the gross position size.
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 50_000 },
      { symbol: "BTC/USDT", source: "funding-carry", effectiveNotionalUsd: -50_000 },
    ];
    expect(computeEffectiveLeverage(positions, 10_000)).toBe(10);
  });

  test("signed sum helper — netPositionNotional = signed sum, for hedging diagnostics", () => {
    // The PORTFOLIO RISK ENGINE (separate module) computes net
    // signed exposure for concentration analysis. The LEVERAGE INVARIANT
    // is gross-exposure-based because that's what blows up.
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 50_000 },
      { symbol: "BTC/USDT", source: "funding-carry", effectiveNotionalUsd: -50_000 },
    ];
    const signedSum = positions.reduce((accumulator, p) => accumulator + p.effectiveNotionalUsd, 0);
    expect(signedSum).toBe(0); // perfectly hedged at signed level
    // But the mandate guard sums absolute values (gross exposure).
    const grossSum = positions.reduce((accumulator, p) => accumulator + Math.abs(p.effectiveNotionalUsd), 0);
    expect(grossSum).toBe(100_000);
    expect(computeEffectiveLeverage(positions, 10_000)).toBe(10);
  });

  test("non-finite notional in positions array → throws", () => {
    const positions: Position[] = [{ symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: NaN }];
    expect(() => computeEffectiveLeverage(positions, 10_000)).toThrow(/finite/);
  });

  test("negative base capital → throws", () => {
    expect(() => computeEffectiveLeverage([], -1)).toThrow(/positive/);
  });

  test("non-finite base capital → throws", () => {
    expect(() => computeEffectiveLeverage([], Infinity)).toThrow(/finite/);
  });

  test("zero base capital → throws", () => {
    expect(() => computeEffectiveLeverage([], 0)).toThrow(/positive/);
  });
});

// ----------------------------------------------------------------------
// assertPositionsInvariant — convenience wrapper
// ----------------------------------------------------------------------

describe("assertPositionsInvariant — convenience wrapper", () => {
  test("valid positions under cap → returns leverage", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 50_000 },
    ];
    const lev = assertPositionsInvariant(positions, 10_000);
    expect(lev).toBe(5);
  });

  test("positions exceeding cap → throws LeverageBreachError", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 60_000 },
      { symbol: "ETH/USDT", source: "directional", effectiveNotionalUsd: 60_000 },
    ];
    expect(() => assertPositionsInvariant(positions, 10_000)).toThrow(LeverageBreachError);
  });

  test("empty positions → 0 (no throw)", () => {
    expect(assertPositionsInvariant([], 10_000)).toBe(0);
  });
});

// ----------------------------------------------------------------------
// checkLeverageApproach — soft warning signal
// ----------------------------------------------------------------------

describe("checkLeverageApproach — soft warning", () => {
  test("5× → false (under 95% of 10× cap)", () => {
    expect(checkLeverageApproach(50_000, 10_000)).toBe(false);
  });

  test("9.5× → true (at warning threshold)", () => {
    expect(checkLeverageApproach(95_000, 10_000)).toBe(true);
  });

  test("9.9× → true (approaching cap)", () => {
    expect(checkLeverageApproach(99_000, 10_000)).toBe(true);
  });

  test("10× exactly → true (still under cap, warning active)", () => {
    expect(checkLeverageApproach(100_000, 10_000)).toBe(true);
  });

  test("0× → false", () => {
    expect(checkLeverageApproach(0, 10_000)).toBe(false);
  });

  test("NaN → false (defensive: don't false-positive)", () => {
    expect(checkLeverageApproach(NaN, 10_000)).toBe(false);
  });

  test("NaN base capital → false", () => {
    expect(checkLeverageApproach(50_000, NaN)).toBe(false);
  });

  test("non-positive base capital and negative notional → false", () => {
    expect(checkLeverageApproach(50_000, 0)).toBe(false);
    expect(checkLeverageApproach(-50_000, 10_000)).toBe(false);
  });
});

// ----------------------------------------------------------------------
// Constants — sanity checks
// ----------------------------------------------------------------------

describe("constants — sanity", () => {
  test("ONE_TO_TEN_LEVERAGE === 10", () => {
    expect(ONE_TO_TEN_LEVERAGE).toBe(10);
  });

  test("ONE_X_LEVERAGE === 1", () => {
    expect(ONE_X_LEVERAGE).toBe(1);
  });

  test("DEFAULT_LEVERAGE_INVARIANT_CONFIG.maxLeverage === 10", () => {
    expect(DEFAULT_LEVERAGE_INVARIANT_CONFIG.maxLeverage).toBe(10);
  });
});

// ----------------------------------------------------------------------
// Determinism — same input → same output
// ----------------------------------------------------------------------

describe("determinism", () => {
  test("assertLeverageInvariant deterministic on multiple invocations", () => {
    const baseCapital = 10_000;
    const totalNotional = 80_000; // 8× — under cap
    for (let index = 0; index < 100; index++) {
      expect(() => {
        assertLeverageInvariant(totalNotional, baseCapital);
      }).not.toThrow();
    }
  });

  test("computeEffectiveLeverage deterministic on repeated calls", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 100_000 },
    ];
    const first = computeEffectiveLeverage(positions, 10_000);
    const second = computeEffectiveLeverage(positions, 10_000);
    const third = computeEffectiveLeverage(positions, 10_000);
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first).toBe(10);
  });
});

// ----------------------------------------------------------------------
// Aggregate breach examples
// ----------------------------------------------------------------------

describe("aggregate breach examples", () => {
  test("two $60k notionals summing to 12× on $10k capital → BREACH", () => {
    // Simulates the past scenario: Strategy A emits $60k notional,
    // Strategy B emits $60k notional. Each individually is at 6× (under
    // per-strategy cap). The aggregate is 12× (BREACH at portfolio level).
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "strategy-A", effectiveNotionalUsd: 60_000 },
      { symbol: "ETH/USDT", source: "strategy-B", effectiveNotionalUsd: 60_000 },
    ];
    const baseCapital = 10_000;
    const computed = computeEffectiveLeverage(positions, baseCapital);
    expect(computed).toBe(12);
    expect(() => assertPositionsInvariant(positions, baseCapital)).toThrow(LeverageBreachError);
  });

  test("reducing one signal from $60k to $40k → 10× aggregate (AT cap, no breach)", () => {
    // Operator response: reduce one strategy's notional.
    //   Before: $60k + $60k = $120k = 12× (BREACH)
    //   After:  $60k + $40k = $100k = 10× (AT cap, OK)
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "strategy-A", effectiveNotionalUsd: 60_000 },
      { symbol: "ETH/USDT", source: "strategy-B", effectiveNotionalUsd: 40_000 },
    ];
    const baseCapital = 10_000;
    const computed = computeEffectiveLeverage(positions, baseCapital);
    expect(computed).toBe(10);
    expect(() => assertPositionsInvariant(positions, baseCapital)).not.toThrow();
  });

  test("reducing both signals to $45k → 9× aggregate (well under cap)", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "strategy-A", effectiveNotionalUsd: 45_000 },
      { symbol: "ETH/USDT", source: "strategy-B", effectiveNotionalUsd: 45_000 },
    ];
    const baseCapital = 10_000;
    expect(computeEffectiveLeverage(positions, baseCapital)).toBe(9);
    expect(() => assertPositionsInvariant(positions, baseCapital)).not.toThrow();
  });
});
