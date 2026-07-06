// packages/core/src/portfolio/index.ts — Phase 13 Track B
//
// =========================================================================
// PORTFOLIO MODULE — multi-symbol orchestrator + decision engine
// =========================================================================
//
// Re-exports the public surface of the portfolio module:
//   - PortfolioOrchestrator — multi-symbol coordinator
//   - PortfolioOrchestratorConfig, PortfolioSnapshot, PortfolioEnvelope
//   - DecisionEngine + PositionDecision (Track B local stub; Track A's
//     class is 1:1 compatible and drops in when merged)
//   - Per-symbol and portfolio-level helpers
//
// Consumers should import from `@mm-crypto-bot/core/portfolio` (this
// file) rather than the individual files. The package's main
// `index.ts` re-exports everything below.

export {
  DEFAULT_DECISION_ENGINE_CONFIG,
  DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG,
  DEFENSIVE_PLUGIN_NAMES,
  DecisionEngine,
  PortfolioOrchestrator,
  createPortfolioOrchestrator,
} from "./portfolio-orchestrator.js";

export type {
  CapReason,
  DecisionEngineConfig,
  DecisionEngineLike,
  PerSymbolEnvelope,
  PortfolioEnvelope,
  PortfolioOrchestratorConfig,
  PortfolioPosition,
  PortfolioSnapshot,
  PositionDecision,
} from "./portfolio-orchestrator.js";