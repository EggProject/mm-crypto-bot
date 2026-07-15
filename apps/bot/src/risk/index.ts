/**
 * apps/bot/src/risk/index.ts
 *
 * Phase 37 Track 1 — `apps/bot/src/risk` barrel. Single import point
 * for the adaptive risk management modules.
 *
 *   - `DrawdownScaler`         — equity drawdown-aware position scaler.
 *   - `KellySizer`             — dynamic Kelly position sizing.
 *   - `TrailingStopManager`    — per-position ATR trailing stop.
 *   - `RiskManager`            — orchestrator over the three modules.
 *
 * The pure helpers (`kellyFraction`, `computeStats`,
 * `DrawdownScaler.scaleFactorForRegion`) are also re-exported.
 */

export { DrawdownScaler } from "./drawdown-scaler.js";
export type { DrawdownRegion, DrawdownScalerOptions, DrawdownState } from "./drawdown-scaler.js";

export { KellySizer, kellyFraction, computeStats } from "./kelly.js";
export type { ClosedTrade, KellyConfig, KellyStats } from "./kelly.js";

export { TrailingStopManager } from "./trailing-stop.js";
export type {
  TrailConfig,
  TrailState,
  TrailingStopSide,
  TrailingStopDecision,
  TrailEvaluationInput,
} from "./trailing-stop.js";

export { RiskManager } from "./risk-manager.js";
export type {
  RiskManagerConfig,
  RiskManagerSnapshot,
  TickEvent,
  NewPositionSizeRequest,
  TrailingStopCloseEvent,
  TrailingStopCloseCallback,
} from "./risk-manager.js";
