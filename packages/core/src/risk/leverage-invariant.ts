// Aggregate effective-exposure risk guard.
//
// Independently applies a numeric aggregate exposure cap. It does not select,
// validate, or compare immutable session-selected leverage. Its numeric inputs
// are not exact valuation.

// ----------------------------------------------------------------------
// Type definitions
// ----------------------------------------------------------------------

/**
 * `DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE` is the default numeric
 * aggregate effective-exposure cap. Its value is independent of session
 * selected leverage.
 *
 * `as const` narrows to the literal type so downstream comparisons
 * are type-safe.
 */
export const DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE = 10 as const;

/**
 * Compatibility alias for consumers of the fixed selected-leverage constant.
 * It reuses the aggregate effective-exposure value without changing selected
 * leverage validation or configuration semantics.
 */
export const ONE_TO_TEN_LEVERAGE = DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE;

/**
 * `MINIMUM_MAX_AGGREGATE_EFFECTIVE_LEVERAGE` is a numeric reference for aggregate-exposure diagnostics.
 */
export const MINIMUM_MAX_AGGREGATE_EFFECTIVE_LEVERAGE = 1 as const;

/**
 * `AggregateEffectiveExposureLimit` — aggregate effective-exposure limit settings.
 *
 * Defaults retain the numeric aggregate exposure cap:
 *   - `maxAggregateEffectiveLeverage = 10`
 *   - `tolerance = 0` — the aggregate exposure boundary has no slack
 *   - `warnOnApproach = 0.95` — when aggregate reaches 95% of cap,
 *     emit a warning signal (informational, not a breach). This gives
 *     the operator early visibility before the cap is hit.
 */
export interface AggregateEffectiveExposureLimit {
  /**
  Maximum aggregate effective exposure ratio.
  */
  readonly maxAggregateEffectiveLeverage: number;
  /**
  Must be canonical positive zero. Aggregate exposure has no tolerance.
  */
  readonly tolerance: number;
  /**
  Fraction of max at which a "approaching limit" warning fires.
  */
  readonly warnOnApproach: number;
}

/**
 * `DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT` — aggregate guard defaults.
 *
 * `maxAggregateEffectiveLeverage: 10` is the default numeric cap. `warnOnApproach: 0.95`
 * fires a warning at 95% of that cap.
 */
export const DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT: AggregateEffectiveExposureLimit = Object.freeze({
  maxAggregateEffectiveLeverage: DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  tolerance: 0,
  warnOnApproach: 0.95,
});

/**
 * `Position` — minimal position representation needed by the invariant
 * guard. The engine doesn't need the full `OpenPositionSnapshot` — just
 * the effective notional (per-strategy). The symbol is included for
 * per-symbol concentration tracking (separate module: portfolio-risk-engine).
 */
export interface Position {
  readonly symbol: string;
  /**
  Strategy plugin that owns this position (for attribution).
  */
  readonly source: string;
  /**
  Effective notional in USD (sign × magnitude, signed for short positions).
  */
  readonly effectiveNotionalUsd: number;
}

/**
 * `AggregateEffectiveExposureLimitBreachError` — custom error class for invariant violations.
 *
 * Carries the offending numbers (computed effective leverage, base capital, max)
 * so the caller can log structured diagnostics. The `name` property
 * differentiates it from generic `Error` for runtime discrimination.
 */
export class AggregateEffectiveExposureLimitBreachError extends Error {
  override readonly name = "AggregateEffectiveExposureLimitBreachError";
  constructor(
    message: string,
    readonly computedEffectiveLeverage: number,
    readonly baseCapital: number,
    readonly maxAggregateEffectiveLeverage: number,
  ) {
    super(message);
    // Restore prototype chain (required when extending Error in TS + ESM).
    Object.setPrototypeOf(this, AggregateEffectiveExposureLimitBreachError.prototype);
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/**
 * `computeEffectiveLeverage` — sum absolute effective notionals and divide
 * by base capital. Returns the gross aggregate effective leverage across all
 * positions. A +$50k long and a -$50k short therefore count as $100k of
 * gross exposure; they do not cancel.
 *
 * Defensive guards:
 *   - Non-finite inputs → throw (suggests upstream bug)
 *   - Negative base capital → throw
 *   - Zero base capital → throw (cannot divide)
 *
 * Pure function, no side effects.
 */
export function computeEffectiveLeverage(positions: readonly Position[], baseCapital: number): number {
  if (!Number.isFinite(baseCapital)) {
    throw new TypeError(`baseCapital must be a finite number, got ${String(baseCapital)}`);
  }
  if (baseCapital <= 0) {
    throw new Error(`baseCapital must be positive, got ${String(baseCapital)}`);
  }
  let sumNotional = 0;
  for (const p of positions) {
    if (!Number.isFinite(p.effectiveNotionalUsd)) {
      throw new TypeError(
        `Position.effectiveNotionalUsd must be finite for symbol=${p.symbol} source=${p.source}, got ${String(p.effectiveNotionalUsd)}`,
      );
    }
    sumNotional += Math.abs(p.effectiveNotionalUsd);
  }
  return sumNotional / baseCapital;
}

interface AggregateEffectiveExposureLimitSnapshot {
  readonly maxAggregateEffectiveLeverage: number;
  readonly tolerance: number;
  readonly warnOnApproach: number;
}

const INVALID_AGGREGATE_EFFECTIVE_EXPOSURE_CONFIGURATION =
  "[leverage-invariant] Aggregate exposure configuration is invalid.";

function snapshotAggregateEffectiveExposureLimit(config: unknown): AggregateEffectiveExposureLimitSnapshot {
  try {
    if (typeof config !== "object" || config === null) {
      throw new TypeError(INVALID_AGGREGATE_EFFECTIVE_EXPOSURE_CONFIGURATION);
    }

    const maxAggregateEffectiveLeverage: unknown = Reflect.get(config, "maxAggregateEffectiveLeverage");
    const tolerance: unknown = Reflect.get(config, "tolerance");
    const warnOnApproach: unknown = Reflect.get(config, "warnOnApproach");

    if (
      typeof maxAggregateEffectiveLeverage !== "number" ||
      typeof tolerance !== "number" ||
      typeof warnOnApproach !== "number"
    ) {
      throw new TypeError(INVALID_AGGREGATE_EFFECTIVE_EXPOSURE_CONFIGURATION);
    }
    if (
      !Number.isFinite(maxAggregateEffectiveLeverage) ||
      !Number.isFinite(tolerance) ||
      !Number.isFinite(warnOnApproach)
    ) {
      throw new TypeError(INVALID_AGGREGATE_EFFECTIVE_EXPOSURE_CONFIGURATION);
    }
    if (
      maxAggregateEffectiveLeverage <= 0 ||
      !Object.is(tolerance, 0) ||
      warnOnApproach < 0 ||
      warnOnApproach > 1
    ) {
      throw new TypeError(INVALID_AGGREGATE_EFFECTIVE_EXPOSURE_CONFIGURATION);
    }

    return Object.freeze({ maxAggregateEffectiveLeverage, tolerance, warnOnApproach });
  } catch (error) {
    throw new TypeError(INVALID_AGGREGATE_EFFECTIVE_EXPOSURE_CONFIGURATION, { cause: error });
  }
}

/**
 * `assertAggregateEffectiveExposureLimit` — HARD GUARDRAIL. Throws
 * `AggregateEffectiveExposureLimitBreachError` if the AGGREGATE effective leverage exceeds
 * `config.maxAggregateEffectiveLeverage`.
 *
 * This guard is independent of selected leverage. It does not reason about
 * strategy logic, hedge ratios, or correlation — it just sums
 * notionals and asserts. Per OpenAlgo guidance, "the gate is
 * deliberately dumb, independent of the signal, and easy to reason
 * about, because it is the thing standing between a bug and a blown
 * account".
 *
 * Pure function (throws on violation, otherwise returns void).
 *
 * @param totalEffectiveNotional Aggregate effective notional in USD
 *                               (can be pre-summed by caller).
 * @param baseCapital             Base capital in USD.
 * @param config                  Aggregate exposure guard configuration.
 */
export function assertAggregateEffectiveExposureLimit(
  totalEffectiveNotional: number,
  baseCapital: number,
  config: AggregateEffectiveExposureLimit = DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
): void {
  // Defensive input validation — refuse non-finite / NaN / Infinity
  if (!Number.isFinite(totalEffectiveNotional)) {
    throw new TypeError(
      `[leverage-invariant] totalEffectiveNotional must be a finite number, got ${String(totalEffectiveNotional)}`,
    );
  }
  if (!Number.isFinite(baseCapital)) {
    throw new TypeError(
      `[leverage-invariant] baseCapital must be a finite number, got ${String(baseCapital)}`,
    );
  }
  if (baseCapital <= 0) {
    throw new Error(`[leverage-invariant] baseCapital must be positive, got ${String(baseCapital)}`);
  }
  // Negative notional is defensive — caller bug. Refuse rather than
  // silently absorb with abs().
  if (totalEffectiveNotional < 0) {
    throw new Error(
      `[leverage-invariant] totalEffectiveNotional must be non-negative, got ${String(totalEffectiveNotional)}`,
    );
  }
  const limit = snapshotAggregateEffectiveExposureLimit(config);
  const computedLeverage = totalEffectiveNotional / baseCapital;
  if (computedLeverage > limit.maxAggregateEffectiveLeverage) {
    throw new AggregateEffectiveExposureLimitBreachError(
      `[leverage-invariant] AGGREGATE EFFECTIVE-EXPOSURE BREACH: aggregate effective leverage ` +
        `${String(computedLeverage)}× exceeds max ${String(limit.maxAggregateEffectiveLeverage)}× ` +
        `(totalEffectiveNotional=${String(totalEffectiveNotional)}, baseCapital=${String(baseCapital)}). ` +
        `Refusing to proceed. Reduce position sizes or add base capital.`,
      computedLeverage,
      baseCapital,
      limit.maxAggregateEffectiveLeverage,
    );
  }
}

/**
 * `isAggregateEffectiveExposureApproachingLimit` — soft check: returns true when aggregate
 * leverage has reached `warnOnApproach` fraction of the cap. This is
 * the early-warning signal for monitoring dashboards (NOT a breach).
 *
 * Use this to emit `RiskSignal { source: 'leverage-approach-warning' }`
 * BEFORE the hard cap fires.
 *
 * Pure function.
 */
export function isAggregateEffectiveExposureApproachingLimit(
  totalEffectiveNotional: number,
  baseCapital: number,
  config: AggregateEffectiveExposureLimit = DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
): boolean {
  if (!Number.isFinite(totalEffectiveNotional) || !Number.isFinite(baseCapital)) {
    snapshotAggregateEffectiveExposureLimit(config);
    return false;
  }
  if (baseCapital <= 0 || totalEffectiveNotional < 0) {
    snapshotAggregateEffectiveExposureLimit(config);
    return false;
  }
  const limit = snapshotAggregateEffectiveExposureLimit(config);
  const computedLeverage = totalEffectiveNotional / baseCapital;
  return (
    computedLeverage >= limit.maxAggregateEffectiveLeverage * limit.warnOnApproach &&
    computedLeverage <= limit.maxAggregateEffectiveLeverage
  );
}

/**
 * `assertAggregatePositionsEffectiveExposureLimit` — convenience wrapper that calls
 * `computeEffectiveLeverage` then `assertAggregateEffectiveExposureLimit`. Useful
 * when the caller has a list of `Position` objects and wants a single
 * call to validate the aggregate.
 *
 * Pure function (throws on violation).
 */
export function assertAggregatePositionsEffectiveExposureLimit(
  positions: readonly Position[],
  baseCapital: number,
  config: AggregateEffectiveExposureLimit = DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
): number {
  const totalEffectiveNotional = positions.reduce(
    (accumulator, p) => accumulator + Math.abs(p.effectiveNotionalUsd),
    0,
  );
  assertAggregateEffectiveExposureLimit(totalEffectiveNotional, baseCapital, config);
  return totalEffectiveNotional / baseCapital;
}
