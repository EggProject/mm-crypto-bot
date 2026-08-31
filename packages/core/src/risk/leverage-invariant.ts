// Enforces the aggregate effective-leverage limit for a position set.

// ----------------------------------------------------------------------
// Type definitions
// ----------------------------------------------------------------------

/**
 * `ONE_TO_TEN_LEVERAGE` — the single source of truth for the user's
 * 1:10 leverage mandate. Every component that needs to know the cap
 * MUST import this constant (NOT hard-code 10).
 *
 * `as const` narrows to the literal type so downstream comparisons
 * are type-safe.
 */
export const ONE_TO_TEN_LEVERAGE = 10 as const;

/**
 * `ONE_X_LEVERAGE` — the backtest baseline reference (1× = unlevered).
 * The portfolio risk engine treats 1× as the "no leverage applied"
 * reference for diagnostic comparisons (per-strategy VaR at 1× vs at
 * 10×), NOT as a permitted production state.
 */
export const ONE_X_LEVERAGE = 1 as const;

/**
 * `LeverageInvariantConfig` — knobs for the leverage invariant guard.
 *
 * Defaults enforce the aggregate leverage limit:
 *   - `maxLeverage = 10` (the 1:10 cap, single source of truth)
 *   - `tolerance = 0` — aggregate exposure has no slack
 *   - `warnOnApproach = 0.95` — when aggregate reaches 95% of cap,
 *     emit a warning signal (informational, not a breach). This gives
 *     the operator early visibility before the cap is hit.
 */
export interface LeverageInvariantConfig {
  /**
  Maximum permitted effective leverage (1:10 = 10).
  */
  readonly maxLeverage: number;
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
 * `DEFAULT_LEVERAGE_INVARIANT_CONFIG` — the production defaults.
 *
 * `maxLeverage: 10` is the 1:10 mandate cap. `tolerance: 0` and `warnOnApproach: 0.95`
 * fires a warning at 9.5× effective leverage.
 */
export const DEFAULT_LEVERAGE_INVARIANT_CONFIG: LeverageInvariantConfig = {
  maxLeverage: ONE_TO_TEN_LEVERAGE,
  tolerance: 0,
  warnOnApproach: 0.95,
};

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
 * `LeverageBreachError` — custom error class for invariant violations.
 *
 * Carries the offending numbers (computed leverage, base capital, max)
 * so the caller can log structured diagnostics. The `name` property
 * differentiates it from generic `Error` for runtime discrimination.
 */
export class LeverageBreachError extends Error {
  override readonly name = "LeverageBreachError";
  constructor(
    message: string,
    readonly computedLeverage: number,
    readonly baseCapital: number,
    readonly maxLeverage: number,
  ) {
    super(message);
    // Restore prototype chain (required when extending Error in TS + ESM).
    Object.setPrototypeOf(this, LeverageBreachError.prototype);
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/**
 * `computeEffectiveLeverage` — sum signed effective notionals and divide
 * by base capital. Returns the AGGREGATE effective leverage across all
 * positions (matches what the user actually experiences as leverage on
 * capital). Absolute-value aware: a +$50k long + a $50k short = 0
 * (perfectly hedged), not $100k.
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
  if (positions.length === 0) {
    return 0;
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

/**
 * `assertLeverageInvariant` — HARD GUARDRAIL. Throws
 * `LeverageBreachError` if the AGGREGATE effective leverage exceeds
 * `config.maxLeverage`.
 *
 * This is the 3rd defense-in-depth layer for the 1:10 mandate.
 * It is intentionally simple and dumb: it does NOT reason about
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
 * @param config                  Invariant config (defaults to 1:10).
 */
interface LeverageInvariantConfigSnapshot {
  readonly maxLeverage: number;
  readonly tolerance: number;
  readonly warnOnApproach: number;
}

const INVALID_LEVERAGE_INVARIANT_CONFIGURATION = "[leverage-invariant] Leverage configuration is invalid.";

function snapshotLeverageInvariantConfig(config: unknown): LeverageInvariantConfigSnapshot {
  try {
    if (typeof config !== "object" || config === null) {
      throw new TypeError(INVALID_LEVERAGE_INVARIANT_CONFIGURATION);
    }

    const maxLeverage: unknown = Reflect.get(config, "maxLeverage");
    const tolerance: unknown = Reflect.get(config, "tolerance");
    const warnOnApproach: unknown = Reflect.get(config, "warnOnApproach");

    if (
      typeof maxLeverage !== "number" ||
      typeof tolerance !== "number" ||
      typeof warnOnApproach !== "number" ||
      !Number.isFinite(maxLeverage) ||
      !Number.isFinite(tolerance) ||
      !Number.isFinite(warnOnApproach) ||
      maxLeverage <= 0 ||
      !Object.is(tolerance, 0) ||
      warnOnApproach < 0 ||
      warnOnApproach > 1
    ) {
      throw new TypeError(INVALID_LEVERAGE_INVARIANT_CONFIGURATION);
    }

    return Object.freeze({ maxLeverage, tolerance, warnOnApproach });
  } catch (error) {
    throw new TypeError(INVALID_LEVERAGE_INVARIANT_CONFIGURATION, { cause: error });
  }
}

export function assertLeverageInvariant(
  totalEffectiveNotional: number,
  baseCapital: number,
  config: LeverageInvariantConfig = DEFAULT_LEVERAGE_INVARIANT_CONFIG,
): void {
  assertLeverageInvariantWithinLimit(
    totalEffectiveNotional,
    baseCapital,
    snapshotLeverageInvariantConfig(config),
  );
}

function assertLeverageInvariantWithinLimit(
  totalEffectiveNotional: number,
  baseCapital: number,
  limit: LeverageInvariantConfigSnapshot,
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
  const computedLeverage = totalEffectiveNotional / baseCapital;
  if (computedLeverage > limit.maxLeverage) {
    throw new LeverageBreachError(
      `[leverage-invariant] 1:10 MANDATE BREACH: aggregate effective leverage ` +
        `${String(computedLeverage)}× exceeds max ${String(limit.maxLeverage)}× ` +
        `(totalEffectiveNotional=${String(totalEffectiveNotional)}, baseCapital=${String(baseCapital)}). ` +
        `Refusing to proceed. Reduce position sizes or add base capital.`,
      computedLeverage,
      baseCapital,
      limit.maxLeverage,
    );
  }
}

/**
 * `checkLeverageApproach` — soft check: returns true when aggregate
 * leverage has reached `warnOnApproach` fraction of the cap. This is
 * the early-warning signal for monitoring dashboards (NOT a breach).
 *
 * Use this to emit `RiskSignal { source: 'leverage-approach-warning' }`
 * BEFORE the hard cap fires.
 *
 * Pure function.
 */
export function isLeverageApproach(
  totalEffectiveNotional: number,
  baseCapital: number,
  config: LeverageInvariantConfig = DEFAULT_LEVERAGE_INVARIANT_CONFIG,
): boolean {
  return isLeverageApproachWithinLimit(
    totalEffectiveNotional,
    baseCapital,
    snapshotLeverageInvariantConfig(config),
  );
}

function isLeverageApproachWithinLimit(
  totalEffectiveNotional: number,
  baseCapital: number,
  limit: LeverageInvariantConfigSnapshot,
): boolean {
  if (!Number.isFinite(totalEffectiveNotional) || !Number.isFinite(baseCapital)) {
    return false;
  }
  if (baseCapital <= 0 || totalEffectiveNotional < 0) {
    return false;
  }
  const computedLeverage = totalEffectiveNotional / baseCapital;
  return (
    computedLeverage >= limit.maxLeverage * limit.warnOnApproach && computedLeverage <= limit.maxLeverage
  );
}

export { isLeverageApproach as checkLeverageApproach };

/**
 * `assertPositionsInvariant` — convenience wrapper that calls
 * `computeEffectiveLeverage` then `assertLeverageInvariant`. Useful
 * when the caller has a list of `Position` objects and wants a single
 * call to validate the aggregate.
 *
 * Pure function (throws on violation).
 */
export function assertPositionsInvariant(
  positions: readonly Position[],
  baseCapital: number,
  config: LeverageInvariantConfig = DEFAULT_LEVERAGE_INVARIANT_CONFIG,
): number {
  const totalEffectiveNotional = positions.reduce(
    (accumulator, p) => accumulator + Math.abs(p.effectiveNotionalUsd),
    0,
  );
  assertLeverageInvariant(totalEffectiveNotional, baseCapital, config);
  return totalEffectiveNotional / baseCapital;
}
