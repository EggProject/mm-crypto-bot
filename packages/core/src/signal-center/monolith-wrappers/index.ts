// packages/core/src/signal-center/monolith-wrappers/index.ts — Phase 13 Track A
//
// ===========================================================================
// Monolith strategy wrappers — barrel re-export
// ===========================================================================
//
// Phase 13 mandate: hide all 15 monolith strategies from `packages/core/src/strategy/`
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

export * from "./always-in-trend-plugin.js";
export * from "./composite-plugin.js";
export * from "./donchian-breakout-plugin.js";
export * from "./donchian-mtf-plugin.js";
export * from "./donchian-trailing-plugin.js";
export * from "./funding-carry-plugin.js";
export * from "./funding-carry-leverage-plugin.js";
export * from "./funding-carry-timing-plugin.js";
export * from "./funding-flip-kill-switch-plugin.js";
export * from "./mean-reversion-bb-plugin.js";
export * from "./mtf-trend-confluence-plugin.js";
export * from "./multi-class-ensemble-plugin.js";
export * from "./multi-class-ensemble-v2-plugin.js";
export * from "./multi-class-ensemble-v3-plugin.js";
export * from "./multi-class-ensemble-v4-plugin.js";