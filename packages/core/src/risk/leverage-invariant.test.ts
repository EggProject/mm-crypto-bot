import { describe, expect, test } from "bun:test";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";

import {
  AggregateEffectiveExposureLimitBreachError,
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  assertAggregateEffectiveExposureLimit,
  assertAggregatePositionsEffectiveExposureLimit,
  isAggregateEffectiveExposureApproachingLimit,
  computeEffectiveLeverage,
  DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  MINIMUM_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  type AggregateEffectiveExposureLimit,
  type Position,
} from "./leverage-invariant.js";
import { freezeSelectedLeverage } from "./session-selected-leverage.js";

describe("assertAggregateEffectiveExposureLimit — boundary tests", () => {
  test("publishes the aggregate effective-exposure limit contract independently of a session selection", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));

    expect(frozen.selected.canonical).toBe("2.5");
    expect(DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT.maxAggregateEffectiveLeverage).toBe(10);
    expect(() => {
      assertAggregateEffectiveExposureLimit(100_001, 10_000);
    }).toThrow(AggregateEffectiveExposureLimitBreachError);
  });

  test("10× exactly → no throw", () => {
    const baseCapital = 10_000;
    const totalNotional = 10 * baseCapital; // 100_000
    expect(() => {
      assertAggregateEffectiveExposureLimit(totalNotional, baseCapital);
    }).not.toThrow();
  });

  test("10.001× → throws AggregateEffectiveExposureLimitBreachError", () => {
    const baseCapital = 10_000;
    const totalNotional = 100_010; // 10.001×
    expect(() => {
      assertAggregateEffectiveExposureLimit(totalNotional, baseCapital);
    }).toThrow(AggregateEffectiveExposureLimitBreachError);
  });

  test("11× → throws with details", () => {
    const baseCapital = 10_000;
    const totalNotional = 110_000; // 11×
    let caught: unknown;
    try {
      assertAggregateEffectiveExposureLimit(totalNotional, baseCapital);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateEffectiveExposureLimitBreachError);
    if (caught instanceof AggregateEffectiveExposureLimitBreachError) {
      expect(caught.computedEffectiveLeverage).toBeCloseTo(11, 6);
      expect(caught.baseCapital).toBe(10_000);
      expect(caught.maxAggregateEffectiveLeverage).toBe(10);
      expect(caught.message).toContain("AGGREGATE EFFECTIVE-EXPOSURE BREACH");
    }
  });

  test("1× → no throw (under the aggregate cap)", () => {
    const baseCapital = 10_000;
    const totalNotional = 10_000; // 1×
    expect(() => {
      assertAggregateEffectiveExposureLimit(totalNotional, baseCapital);
    }).not.toThrow();
  });

  test("0× (zero notional) → no throw", () => {
    const baseCapital = 10_000;
    const totalNotional = 0;
    expect(() => {
      assertAggregateEffectiveExposureLimit(totalNotional, baseCapital);
    }).not.toThrow();
  });

  test("5× → no throw (under cap)", () => {
    const baseCapital = 10_000;
    const totalNotional = 50_000; // 5×
    expect(() => {
      assertAggregateEffectiveExposureLimit(totalNotional, baseCapital);
    }).not.toThrow();
  });
});

describe("assertAggregateEffectiveExposureLimit — defensive guards", () => {
  test("NaN notional → throws (does NOT silently allow)", () => {
    expect(() => {
      assertAggregateEffectiveExposureLimit(NaN, 10_000);
    }).toThrow(/finite/);
  });

  test("Infinity notional → throws", () => {
    expect(() => {
      assertAggregateEffectiveExposureLimit(Infinity, 10_000);
    }).toThrow(/finite/);
  });

  test("NaN base capital → throws", () => {
    expect(() => {
      assertAggregateEffectiveExposureLimit(10_000, NaN);
    }).toThrow(/finite/);
  });

  test("Zero base capital → throws (division by zero)", () => {
    expect(() => {
      assertAggregateEffectiveExposureLimit(10_000, 0);
    }).toThrow(/positive/);
  });

  test("Negative base capital → throws", () => {
    expect(() => {
      assertAggregateEffectiveExposureLimit(10_000, -1);
    }).toThrow(/positive/);
  });

  test("Negative notional → throws (defensive — caller bug, not silently abs())", () => {
    expect(() => {
      assertAggregateEffectiveExposureLimit(-50_000, 10_000);
    }).toThrow(/non-negative/);
  });
});

describe("assertAggregateEffectiveExposureLimit — custom config", () => {
  test("a frozen 2.5 session selection does not replace the independent aggregate exposure cap", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));

    expect(frozen.selected.canonical).toBe("2.5");
    expect(DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT.maxAggregateEffectiveLeverage).toBe(10);
    expect(() => {
      assertAggregateEffectiveExposureLimit(100_001, 10_000);
    }).toThrow(AggregateEffectiveExposureLimitBreachError);
  });

  test("custom cap 3× — 3.5× throws", () => {
    const baseCapital = 10_000;
    const totalNotional = 35_000; // 3.5×
    const config = { ...DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT, maxAggregateEffectiveLeverage: 3 };
    expect(() => {
      assertAggregateEffectiveExposureLimit(totalNotional, baseCapital, config);
    }).toThrow(AggregateEffectiveExposureLimitBreachError);
  });

  test("default configuration rejects 10.0000001×", () => {
    const baseCapital = 10_000;
    const totalNotional = 100_000.001;
    expect(() => {
      assertAggregateEffectiveExposureLimit(totalNotional, baseCapital);
    }).toThrow(AggregateEffectiveExposureLimitBreachError);
  });

  test("canonical zero tolerance rejects 10.0000001×", () => {
    const baseCapital = 10_000;
    const totalNotional = 100_000.001;
    const config = { ...DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT, tolerance: 0 };
    expect(() => {
      assertAggregateEffectiveExposureLimit(totalNotional, baseCapital, config);
    }).toThrow(AggregateEffectiveExposureLimitBreachError);
  });
});

describe("aggregate exposure configuration boundary", () => {
  test("does not permit Reflect mutation of the published default configuration", () => {
    expect(Object.isFrozen(DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT)).toBe(true);
    expect(
      Reflect.set(
        DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
        "maxAggregateEffectiveLeverage",
        DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
      ),
    ).toBe(false);
  });

  test("snapshots every hard-guard configuration field exactly once before calculating", () => {
    let maximumReads = 0;
    let toleranceReads = 0;
    let warningReads = 0;
    const config = {
      get maxAggregateEffectiveLeverage() {
        maximumReads += 1;
        return maximumReads === 1 ? 3 : 100;
      },
      get tolerance() {
        toleranceReads += 1;
        return 0;
      },
      get warnOnApproach() {
        warningReads += 1;
        return 0.95;
      },
    } satisfies AggregateEffectiveExposureLimit;

    expect(() => {
      assertAggregateEffectiveExposureLimit(35_000, 10_000, config);
    }).toThrow(AggregateEffectiveExposureLimitBreachError);
    expect({ maximumReads, toleranceReads, warningReads }).toEqual({
      maximumReads: 1,
      toleranceReads: 1,
      warningReads: 1,
    });
  });

  test("converts a throwing configuration getter into the deterministic fail-closed error", () => {
    const config = new Proxy(
      {
        maxAggregateEffectiveLeverage: 10,
        tolerance: 0,
        warnOnApproach: 0.95,
      } satisfies AggregateEffectiveExposureLimit,
      {
        get() {
          throw new Error("untrusted getter failure");
        },
      },
    );

    expect(() => {
      assertAggregateEffectiveExposureLimit(50_000, 10_000, config);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
  });

  test("converts a revoked configuration proxy into the deterministic fail-closed error", () => {
    const revocable = Proxy.revocable(
      {
        maxAggregateEffectiveLeverage: 10,
        tolerance: 0,
        warnOnApproach: 0.95,
      } satisfies AggregateEffectiveExposureLimit,
      {},
    );
    revocable.revoke();

    expect(() => {
      assertAggregateEffectiveExposureLimit(50_000, 10_000, revocable.proxy);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
  });

  test("rejects a non-numeric configuration property before calculating", () => {
    const config = new Proxy(
      {
        maxAggregateEffectiveLeverage: 10,
        tolerance: 0,
        warnOnApproach: 0.95,
      } satisfies AggregateEffectiveExposureLimit,
      {
        get(_target, property) {
          if (property === "maxAggregateEffectiveLeverage") {
            return "10";
          }
          if (property === "tolerance") {
            return 0;
          }
          return 0.95;
        },
      },
    );

    expect(() => {
      assertAggregateEffectiveExposureLimit(50_000, 10_000, config);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
  });

  test("rejects every invalid configuration range before either guard calculates", () => {
    const invalidConfigurations = [
      { maxAggregateEffectiveLeverage: 0, tolerance: 0, warnOnApproach: 0.95 },
      { maxAggregateEffectiveLeverage: Infinity, tolerance: 0, warnOnApproach: 0.95 },
      { maxAggregateEffectiveLeverage: 10, tolerance: Infinity, warnOnApproach: 0.95 },
      { maxAggregateEffectiveLeverage: 10, tolerance: -1, warnOnApproach: 0.95 },
      { maxAggregateEffectiveLeverage: 10, tolerance: 0, warnOnApproach: -0.01 },
      { maxAggregateEffectiveLeverage: 10, tolerance: 0, warnOnApproach: 1.01 },
    ] satisfies readonly AggregateEffectiveExposureLimit[];

    for (const config of invalidConfigurations) {
      expect(() => {
        assertAggregateEffectiveExposureLimit(50_000, 10_000, config);
      }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
    }
  });

  test("rejects a non-object configuration at the runtime boundary", () => {
    expect(() => {
      Reflect.apply(assertAggregateEffectiveExposureLimit, undefined, [50_000, 10_000, false]);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
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
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 60_000 },
      { symbol: "ETH/USDT", source: "directional", effectiveNotionalUsd: 60_000 },
    ];
    expect(computeEffectiveLeverage(positions, 10_000)).toBe(12);
  });

  test("short + long at same magnitude → gross 10× (not netted)", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 50_000 },
      { symbol: "BTC/USDT", source: "funding-carry", effectiveNotionalUsd: -50_000 },
    ];
    expect(computeEffectiveLeverage(positions, 10_000)).toBe(10);
  });

  test("signed sum helper — netPositionNotional = signed sum, for hedging diagnostics", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 50_000 },
      { symbol: "BTC/USDT", source: "funding-carry", effectiveNotionalUsd: -50_000 },
    ];
    const signedSum = positions.reduce((accumulator, p) => accumulator + p.effectiveNotionalUsd, 0);
    expect(signedSum).toBe(0); // perfectly hedged at signed level
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

describe("assertAggregatePositionsEffectiveExposureLimit — convenience wrapper", () => {
  test("valid positions under cap → returns leverage", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 50_000 },
    ];
    const lev = assertAggregatePositionsEffectiveExposureLimit(positions, 10_000);
    expect(lev).toBe(5);
  });

  test("positions exceeding cap → throws AggregateEffectiveExposureLimitBreachError", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "directional", effectiveNotionalUsd: 60_000 },
      { symbol: "ETH/USDT", source: "directional", effectiveNotionalUsd: 60_000 },
    ];
    expect(() => assertAggregatePositionsEffectiveExposureLimit(positions, 10_000)).toThrow(
      AggregateEffectiveExposureLimitBreachError,
    );
  });

  test("empty positions → 0 (no throw)", () => {
    expect(assertAggregatePositionsEffectiveExposureLimit([], 10_000)).toBe(0);
  });
});

describe("isAggregateEffectiveExposureApproachingLimit — soft warning", () => {
  test("5× → false (under 95% of 10× cap)", () => {
    expect(isAggregateEffectiveExposureApproachingLimit(50_000, 10_000)).toBe(false);
  });

  test("9.5× → true (at warning threshold)", () => {
    expect(isAggregateEffectiveExposureApproachingLimit(95_000, 10_000)).toBe(true);
  });

  test("9.9× → true (approaching cap)", () => {
    expect(isAggregateEffectiveExposureApproachingLimit(99_000, 10_000)).toBe(true);
  });

  test("10× exactly → true (still under cap, warning active)", () => {
    expect(isAggregateEffectiveExposureApproachingLimit(100_000, 10_000)).toBe(true);
  });

  test("0× → false", () => {
    expect(isAggregateEffectiveExposureApproachingLimit(0, 10_000)).toBe(false);
  });

  test("NaN → false (defensive: don't false-positive)", () => {
    expect(isAggregateEffectiveExposureApproachingLimit(NaN, 10_000)).toBe(false);
  });

  test("NaN base capital → false", () => {
    expect(isAggregateEffectiveExposureApproachingLimit(50_000, NaN)).toBe(false);
  });

  test("zero base capital → false", () => {
    expect(isAggregateEffectiveExposureApproachingLimit(50_000, 0)).toBe(false);
  });
});

describe("constants — sanity", () => {
  test("DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE === 10", () => {
    expect(DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE).toBe(10);
  });

  test("MINIMUM_MAX_AGGREGATE_EFFECTIVE_LEVERAGE === 1", () => {
    expect(MINIMUM_MAX_AGGREGATE_EFFECTIVE_LEVERAGE).toBe(1);
  });

  test("DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT.maxAggregateEffectiveLeverage === 10", () => {
    expect(DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT.maxAggregateEffectiveLeverage).toBe(10);
  });
});

describe("determinism", () => {
  test("assertAggregateEffectiveExposureLimit deterministic on multiple invocations", () => {
    const baseCapital = 10_000;
    const totalNotional = 80_000; // 8× — under cap
    for (let index = 0; index < 100; index++) {
      expect(() => {
        assertAggregateEffectiveExposureLimit(totalNotional, baseCapital);
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

describe("aggregate breach examples", () => {
  test("two $60k notionals summing to 12× on $10k capital → BREACH", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "strategy-A", effectiveNotionalUsd: 60_000 },
      { symbol: "ETH/USDT", source: "strategy-B", effectiveNotionalUsd: 60_000 },
    ];
    const baseCapital = 10_000;
    const computed = computeEffectiveLeverage(positions, baseCapital);
    expect(computed).toBe(12);
    expect(() => assertAggregatePositionsEffectiveExposureLimit(positions, baseCapital)).toThrow(
      AggregateEffectiveExposureLimitBreachError,
    );
  });

  test("reducing one signal from $60k to $40k → 10× aggregate (AT cap, no breach)", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "strategy-A", effectiveNotionalUsd: 60_000 },
      { symbol: "ETH/USDT", source: "strategy-B", effectiveNotionalUsd: 40_000 },
    ];
    const baseCapital = 10_000;
    const computed = computeEffectiveLeverage(positions, baseCapital);
    expect(computed).toBe(10);
    expect(() => assertAggregatePositionsEffectiveExposureLimit(positions, baseCapital)).not.toThrow();
  });

  test("reducing both signals to $45k → 9× aggregate (well under cap)", () => {
    const positions: Position[] = [
      { symbol: "BTC/USDT", source: "strategy-A", effectiveNotionalUsd: 45_000 },
      { symbol: "ETH/USDT", source: "strategy-B", effectiveNotionalUsd: 45_000 },
    ];
    const baseCapital = 10_000;
    expect(computeEffectiveLeverage(positions, baseCapital)).toBe(9);
    expect(() => assertAggregatePositionsEffectiveExposureLimit(positions, baseCapital)).not.toThrow();
  });
});
