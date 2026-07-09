// packages/core/src/signal-center/monolith-wrappers/index.ts — Phase 13 Track A
//
// ===========================================================================
// Monolith strategy wrappers — barrel re-export
// ===========================================================================
//
// Phase 13 mandate: hide monolith strategies from `packages/core/src/strategy/`
// behind the Signal Center so the Decision Engine arbitrates them.
//
// Each wrapper implements `StrategyPlugin` and:
//   - declares `maxLeverage: 10` (1:10 HARD GUARDRAIL)
//   - asserts the 1:10 leverage invariant at 3 layers (constructor,
//     subscribe, per-emit) — see "Three-layer enforcement" memory rule
//   - translates the underlying `Strategy` interface's `StrategySignal`
//     output into typed Signal events (DirectionSignal, SizingSignal) on
//     the SignalBus
//   - delegates lifecycle (`onBar`, `onPositionOpened`, `onPositionClosed`,
//     `onOpenPositionUpdate`) to the underlying strategy where applicable
//
// Phase 32 deletion: removed 7 wrapper plugins for strategies that were
// deleted in Phase 32 cleanup (see docs/research/deprecated-strategies/REPORT.md
// for the per-strategy deletion records). Kept wrappers for:
//   - composite (still used by DP composition-style ensembles)
//   - cross-venue-funding-divergence (Phase 25 #1 cross-venue signal pool)

export * from "./composite-plugin.js";
export * from "./cross-venue-funding-divergence-plugin.js";