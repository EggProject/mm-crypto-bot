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
// Phase 27 deletion (REFRESH-phase26.md): removed 6 wrapper plugins for
// HALT/REMOVE strategies (always-in-trend, mean-reversion-bb,
// mtf-trend-confluence, multi-class ensemble v1, v3, v4). Kept wrappers
// for: composite, cross-venue-funding-divergence, donchian-mtf (Phase 11.1b
// DirectionalMTFPlugin depends on it), donchian-breakout + donchian-trailing
// (sub-components of MultiClassEnsembleV2 production candidate chain:
// v2 → DonchianTrailing → DonchianBreakout),
// funding-carry, funding-carry-leverage, funding-carry-timing,
// funding-flip-kill-switch, multi-class-ensemble-v2 (production candidate).

export * from "./composite-plugin.js";
export * from "./cross-venue-funding-divergence-plugin.js";
export * from "./donchian-breakout-plugin.js";
export * from "./donchian-mtf-plugin.js";
export * from "./donchian-trailing-plugin.js";
export * from "./funding-carry-plugin.js";
export * from "./funding-carry-leverage-plugin.js";
export * from "./funding-carry-timing-plugin.js";
export * from "./funding-flip-kill-switch-plugin.js";
export * from "./multi-class-ensemble-v2-plugin.js";