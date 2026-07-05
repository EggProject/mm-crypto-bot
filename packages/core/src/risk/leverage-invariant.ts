// packages/core/src/risk/leverage-invariant.ts — 1:10 MANDATORY leverage hard guardrail
//
// Phase 10G Track B — leverage invariant enforcement (3rd defense-in-depth layer).
//
// =========================================================================
// 1:10 MANDATORY LEVERAGE CONSTRAINT (HARD USER DIRECTIVE)
// =========================================================================
// The plan owner (mvs_c13fe65cb68f4df3851304dea09a9099) has mandated
// project-wide: ALL trades use EXACTLY 1:10 leverage. That means 10×
// notional on 1× capital (9× borrowed from bybit.eu SPOT margin).
//
//   - 1× permitted ONLY as backtest baseline for scaling-curve comparison
//   - 10× (= 1:10) is the production default
//   - 2× / 3× / 5× / 7× etc. are EXPLICITLY REJECTED at every layer
//
// =========================================================================
// 3-LAYER DEFENSE-IN-DEPTH (memory pattern "Engineering discipline — 3-layer
// HARD GUARDRAIL pattern")
// =========================================================================
// The 1:10 mandate is enforced at THREE layers:
//   1. CLI parser (`parseAndValidateLeverage` in run-multi-class-baseline-v4.ts)
//      — first line of defense, refuses the backtest before any work
//   2. Strategy constructor (`assert1to10Leverage` in funding-carry-leverage.ts,
//      `validateTimingLeverage` in funding-carry-timing.ts)
//      — refuses to construct an invalid strategy instance
//   3. THIS MODULE (the "leverage invariant guard" inside
//      `PortfolioRiskEngine.leverageInvariantGuard`)
//      — re-verifies that the SUM of all in-flight SizingSignals' effective
//      notionals stays within the 1:10 mandate. Even if every strategy
//      individually reports 10×, the AGGREGATE could exceed 10× (e.g. two
//      strategies each at 6×). This is the defense-in-depth for the
//      COMPOSITION scenario.
//
// Layer 3 is a NEW safety check introduced by Phase 10G Track B because
// the signal-center composition model allows multiple alpha streams to
// emit SizingSignals concurrently, and their sum is what the user
// actually experiences as "leverage on capital".
//
// =========================================================================
// Module scope — what this module DOES vs DOES NOT enforce
// =========================================================================
//   DOES enforce:
//     - Total effective notional across all active positions
//     - Sum of (per-strategy effective_notional) divided by base capital
//     - Throws LeverageBreachError if the AGGREGATE exceeds 10×
//
//   DOES NOT enforce:
//     - Per-strategy leverage (already enforced by strategy constructors)
//     - Specific values for individual positions (caller's responsibility)
//     - Single trade leverage (CLI parser layer 1 already handles)
//
// =========================================================================
// References (≥3 independent sources per empirical claim)
// =========================================================================
//
// 1. bybit.eu SPOT margin FAQ — "Spot Margin Trading supports up to 10x
//    leverage". The exchange-enforced ceiling.
//    https://www.bybit.com/en/help-center/article/FAQ-Spot-Margin-Trading
//
// 2. bybit.eu PRNewswire Aug 2025 launch — "borrow additional funds to
//    execute a €1,000 trade using 10× leverage". IMR formula
//    `IMR for borrowed assets = 1 ÷ Selected Leverage` = 90% IMR at 10×.
//    https://www.prnewswire.com/news-releases/bybit-eu-empowers-european-traders-with-spot-margin-up-to-10x-leverage-full-transparency-and-built-in-risk-controls-302532221.html
//
// 3. HKMA (Hong Kong Monetary Authority) "Sound risk management practices
//    for algorithmic trading" (Mar 2020) — pre-trade risk controls must
//    include "risk limits based on the institution's capital, trading
//    strategy and risk tolerance". Aggregate exposure limits are
//    explicitly required ("limits on maximum order value or volume to
//    prevent uncommonly large orders from entering the order book").
//    https://brdr.hkma.gov.hk/eng/doc-ldg/docId/getPdf/20200306-4-EN/20200306-4-EN.pdf
//
// 4. FIA "Best Practices For Automated Trading Risk Controls And System
//    Safeguards" (Jul 2024) — "Localized pre-trade risk controls, not
//    credit controls, should be the primary tools used to prevent
//    inadvertent market activity". Aggregate-level checks (the third
//    layer) are the canonical pattern for multi-strategy composition.
//    https://www.fia.org/sites/default/files/2024-07/FIA_WP_AUTOMATED%20TRADING%20RISK%20CONTROLS_FINAL_0.pdf
//
// 5. OpenAlgo "Kill Switches, Risk Controls and Algo Surveillance" — the
//    kill-switch design pattern: "the gate is deliberately dumb,
//    independent of the signal, and easy to reason about, because it is
//    the thing standing between a bug and a blown account". This module
//    is the "dumb aggregate gate" — it doesn't reason about strategy
//    logic, it just sums notionals.
//    https://openalgo.in/quant/kill-switches-risk-controls

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
 * Defaults reflect the 1:10 user mandate:
 *   - `maxLeverage = 10` (the 1:10 cap, single source of truth)
 *   - `tolerance = 1e-6` — small numerical slack to avoid floating-point
 *     rejections at exactly 10.0000001× caused by FP rounding
 *   - `warnOnApproach = 0.95` — when aggregate reaches 95% of cap,
 *     emit a warning signal (informational, not a breach). This gives
 *     the operator early visibility before the cap is hit.
 */
export interface LeverageInvariantConfig {
  /** Maximum permitted effective leverage (1:10 = 10). */
  readonly maxLeverage: number;
  /** Numerical slack to avoid FP-rounding false-positives. */
  readonly tolerance: number;
  /** Fraction of max at which a "approaching limit" warning fires. */
  readonly warnOnApproach: number;
}

/**
 * `DEFAULT_LEVERAGE_INVARIANT_CONFIG` — the production defaults.
 *
 * `maxLeverage: 10` is the 1:10 mandate cap. `tolerance: 1e-6`
 * (1 microleverage unit) absorbs FP rounding. `warnOnApproach: 0.95`
 * fires a warning at 9.5× effective leverage.
 */
export const DEFAULT_LEVERAGE_INVARIANT_CONFIG: LeverageInvariantConfig = {
  maxLeverage: ONE_TO_TEN_LEVERAGE,
  tolerance: 1e-6,
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
  /** Strategy plugin that owns this position (for attribution). */
  readonly source: string;
  /** Effective notional in USD (sign × magnitude, signed for short positions). */
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
export function computeEffectiveLeverage(
  positions: readonly Position[],
  baseCapital: number,
): number {
  if (!Number.isFinite(baseCapital)) {
    throw new Error(
      `baseCapital must be a finite number, got ${String(baseCapital)}`,
    );
  }
  if (baseCapital <= 0) {
    throw new Error(
      `baseCapital must be positive, got ${String(baseCapital)}`,
    );
  }
  if (positions.length === 0) {
    return 0;
  }
  let sumNotional = 0;
  for (const p of positions) {
    if (!Number.isFinite(p.effectiveNotionalUsd)) {
      throw new Error(
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
 * `config.maxLeverage + config.tolerance`.
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
export function assertLeverageInvariant(
  totalEffectiveNotional: number,
  baseCapital: number,
  config: LeverageInvariantConfig = DEFAULT_LEVERAGE_INVARIANT_CONFIG,
): void {
  // Defensive input validation — refuse non-finite / NaN / Infinity
  if (!Number.isFinite(totalEffectiveNotional)) {
    throw new Error(
      `[leverage-invariant] totalEffectiveNotional must be a finite number, got ${String(totalEffectiveNotional)}`,
    );
  }
  if (!Number.isFinite(baseCapital)) {
    throw new Error(
      `[leverage-invariant] baseCapital must be a finite number, got ${String(baseCapital)}`,
    );
  }
  if (baseCapital <= 0) {
    throw new Error(
      `[leverage-invariant] baseCapital must be positive, got ${String(baseCapital)}`,
    );
  }
  if (!Number.isFinite(config.maxLeverage) || config.maxLeverage <= 0) {
    throw new Error(
      `[leverage-invariant] config.maxLeverage must be positive finite, got ${String(config.maxLeverage)}`,
    );
  }
  // Negative notional is defensive — caller bug. Refuse rather than
  // silently absorb with abs().
  if (totalEffectiveNotional < 0) {
    throw new Error(
      `[leverage-invariant] totalEffectiveNotional must be non-negative, got ${String(totalEffectiveNotional)}`,
    );
  }
  if (baseCapital === 0) {
    // Should already be caught by `baseCapital <= 0` above, but be explicit.
    throw new Error(`[leverage-invariant] baseCapital must be positive (cannot divide by zero)`);
  }
  const computedLeverage = totalEffectiveNotional / baseCapital;
  if (computedLeverage > config.maxLeverage + config.tolerance) {
    throw new LeverageBreachError(
      `[leverage-invariant] 1:10 MANDATE BREACH: aggregate effective leverage ` +
        `${computedLeverage.toFixed(4)}× exceeds max ${config.maxLeverage}× ` +
        `(totalEffectiveNotional=${totalEffectiveNotional}, baseCapital=${baseCapital}, ` +
        `tolerance=${config.tolerance}). ` +
        `Refusing to proceed. Reduce position sizes or add base capital.`,
      computedLeverage,
      baseCapital,
      config.maxLeverage,
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
export function checkLeverageApproach(
  totalEffectiveNotional: number,
  baseCapital: number,
  config: LeverageInvariantConfig = DEFAULT_LEVERAGE_INVARIANT_CONFIG,
): boolean {
  if (!Number.isFinite(totalEffectiveNotional) || !Number.isFinite(baseCapital)) {
    return false;
  }
  if (baseCapital <= 0 || totalEffectiveNotional < 0) {
    return false;
  }
  const computedLeverage = totalEffectiveNotional / baseCapital;
  return (
    computedLeverage >= config.maxLeverage * config.warnOnApproach - config.tolerance &&
    computedLeverage <= config.maxLeverage + config.tolerance
  );
}

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
    (acc, p) => acc + Math.abs(p.effectiveNotionalUsd),
    0,
  );
  assertLeverageInvariant(totalEffectiveNotional, baseCapital, config);
  return totalEffectiveNotional / baseCapital;
}