import { describe, expect, test } from "bun:test";

import {
  AggregateEffectiveExposureLimitBreachError,
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  assertAggregateEffectiveExposureLimit,
  isAggregateEffectiveExposureApproachingLimit,
} from "./leverage-invariant.js";

describe("aggregate effective-exposure zero tolerance", () => {
  test("accepts the exact limit and rejects every representable amount above it by default", () => {
    const baseCapital = 10_000;
    const exactLimit = 100_000;
    const aboveLimit = exactLimit + Number.EPSILON * exactLimit;

    expect(Object.is(DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT.tolerance, 0)).toBe(true);
    expect(() => {
      assertAggregateEffectiveExposureLimit(exactLimit, baseCapital);
    }).not.toThrow();
    expect(aboveLimit).toBeGreaterThan(exactLimit);
    expect(() => {
      assertAggregateEffectiveExposureLimit(aboveLimit, baseCapital);
    }).toThrow(AggregateEffectiveExposureLimitBreachError);
  });

  test("rejects positive tolerance instead of absorbing an above-limit exposure", () => {
    const nonzeroTolerance = {
      ...DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
      tolerance: 0.000001,
    };

    expect(() => {
      assertAggregateEffectiveExposureLimit(100_000.001, 10_000, nonzeroTolerance);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
    expect(() => {
      isAggregateEffectiveExposureApproachingLimit(95_000, 10_000, nonzeroTolerance);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
  });

  test("rejects negative zero tolerance", () => {
    const negativeZeroTolerance = {
      ...DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
      tolerance: -0,
    };

    expect(() => {
      assertAggregateEffectiveExposureLimit(100_000, 10_000, negativeZeroTolerance);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
  });

  test("rejects every noncanonical tolerance before soft-guard measurement validation", () => {
    const noncanonicalTolerances = [0.000001, -0.000001, NaN, Infinity, -Infinity, -0];

    for (const tolerance of noncanonicalTolerances) {
      const config = { ...DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT, tolerance };
      expect(() => {
        assertAggregateEffectiveExposureLimit(100_000, 10_000, config);
      }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
      expect(() => {
        isAggregateEffectiveExposureApproachingLimit(NaN, 10_000, config);
      }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
    }
  });

  test("rejects a negative tolerance before every soft-guard measurement result", () => {
    const invalidConfig = {
      maxAggregateEffectiveLeverage: 10,
      tolerance: -1,
      warnOnApproach: 0.95,
    };

    expect(() => {
      isAggregateEffectiveExposureApproachingLimit(90_000, 10_000, invalidConfig);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
    expect(() => {
      isAggregateEffectiveExposureApproachingLimit(NaN, 10_000, invalidConfig);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
  });

  test("soft guard rejects hostile and revoked configuration access before measurement return", () => {
    const hostile = new Proxy(DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT, {
      get() {
        throw new Error("hostile getter");
      },
    });
    const revoked = Proxy.revocable(DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT, {});
    revoked.revoke();

    expect(() => {
      isAggregateEffectiveExposureApproachingLimit(NaN, 10_000, hostile);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
    expect(() => {
      isAggregateEffectiveExposureApproachingLimit(NaN, 10_000, revoked.proxy);
    }).toThrow("[leverage-invariant] Aggregate exposure configuration is invalid.");
  });
});
