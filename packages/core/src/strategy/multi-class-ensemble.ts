// packages/core/src/strategy/multi-class-ensemble.ts — Latency-gate infrastructure
//
// Phase 27 cleanup: This file USED TO export the MultiClassEnsemble class
// (Phase 6 M2) which was empirically refuted (0 trades in current code, see
// REFRESH-phase26.md §3). The class has been removed.
//
// What REMAINS in this file is the latency-gate infrastructure — the
// `LatencyGate` interface, `LatencySnapshot` type, `createLatencyGate` factory,
// `DEFAULT_LATENCY_GATE_DISABLED` sentinel, and Kelly-related defaults.
// These are imported by `multi-class-ensemble-v2.ts` (production candidate,
// +9.46%/mo @ 3.43 Sharpe fresh BTC) and other downstream consumers.
//
// Kept under the original filename `./multi-class-ensemble.ts` so that
// existing imports in `multi-class-ensemble-v2.ts` continue to resolve
// without rename surgery.
//
// Phase 27 cleanup: removed `MultiClassEnsemble` class, `MultiClassEnsembleConfig`,
// `MultiClassEnsembleState`, and `timeframesForMultiClass` — all dead.

/**
 * `LatencySnapshot` — Track B latency profile input for the gate.
 * Pre-loaded from Phase 6 Track B 3 minta JSON files (arb-latency-*.json).
 */
export interface LatencySnapshot {
  /** Trading pair identifier (e.g. "binance-bybit-btc"). */
  readonly pair: string;
  /** Max observed round-trip latency in milliseconds. */
  readonly roundTripMsMax: number;
  /** Optional additional fields from the source JSON. */
  readonly sourceJsonPath: string;
}

/**
 * `LatencyGate` — the Track B gate component. A simple predicate that
 * decides whether the carry component is allowed to accrue funding on a
 * given candle.
 *
 * Design choice: the gate is a STANDALONE function (not a Strategy),
 * because it has no per-candle state — it operates on a pre-loaded
 * `LatencySnapshot` and a per-symbol `arbThresholdMs`. The
 * multi-class ensembles consult the gate before invoking the carry
 * component.
 */
export interface LatencyGate {
  /** True if the carry component may accrue funding on the current candle. */
  isCarryAllowed(): boolean;
  /** Snapshot of the latency profile used by this gate. */
  readonly snapshot: LatencySnapshot;
  /** Threshold in ms above which the carry is paused. */
  readonly arbThresholdMs: number;
}

/**
 * `createLatencyGate` — factory for the default latency gate. Returns a
 * simple closure-based gate that consults a pre-loaded `LatencySnapshot`.
 *
 * If `snapshot.roundTripMsMax > arbThresholdMs`, the carry is paused.
 *
 * @param snapshot Pre-loaded latency profile (from Track B JSON).
 * @param arbThresholdMs Max allowed round-trip time (default 500ms — Track B
 *                      empirical cutoff per docs/research/phase6-arb-latency.md).
 */
export function createLatencyGate(snapshot: LatencySnapshot, arbThresholdMs = 500): LatencyGate {
  return {
    snapshot,
    arbThresholdMs,
    isCarryAllowed: () => snapshot.roundTripMsMax <= arbThresholdMs,
  };
}

/**
 * `DEFAULT_LATENCY_GATE_DISABLED` — sentinel gate that always allows carry.
 * Used in tests and in the multi-class ensemble CLI runner when the
 * Track B JSON is not loaded (no arb-latency sample available). The carry
 * accrual proceeds unconstrained.
 */
export const DEFAULT_LATENCY_GATE_DISABLED: LatencyGate = {
  snapshot: {
    pair: "disabled",
    roundTripMsMax: 0,
    sourceJsonPath: "",
  },
  arbThresholdMs: Number.POSITIVE_INFINITY,
  isCarryAllowed: () => true,
};

/**
 * `KellyOptAggregate` — defaults for Kelly-driven position sizing.
 *
 * Phase 27 cleanup: this type remains because MultiClassEnsembleV2 references
 * it (re-exported through multi-class-ensemble-v2.ts). The actual Kelly
 * computation lives in `risk/kelly-position-sizer.ts`.
 */
export interface KellyOptAggregate {
  /** Static Kelly fraction (0.5× = half-Kelly). */
  readonly kellyFraction: number;
  /** Cap on Kelly-driven notional as % of equity. */
  readonly kellyCapPctEquity: number;
}

/**
 * `DEFAULT_KELLY_OPT_AGGREGATE` — defaults for the ensemble: 0.5× Kelly,
 * capped at 0.20 × equity notional (matches `maxPositionPctEquity` default).
 */
export const DEFAULT_KELLY_OPT_AGGREGATE: KellyOptAggregate = {
  kellyFraction: 0.5,
  kellyCapPctEquity: 0.20,
};