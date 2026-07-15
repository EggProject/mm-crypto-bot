/**
 * apps/bot/src/portfolio/index.ts
 *
 * A `apps/bot/src/portfolio` barrel — egységes belépési pont a
 * portfolió-koordinációs komponensekhez.
 *
 * A `Bot` runtime, a `Bot`-tesztek és a CLI parancsok egyetlen
 * import-tal hozzáférnek minden nyilvános osztályhoz és típushoz:
 *
 *   import { PortfolioManager, RiskBudgetAllocator, ... } from "../portfolio";
 */

export { RiskBudgetAllocator, RISK_BUDGET_HARD_CAPS } from "./risk-budget.js";
export type {
  BudgetBreakdown,
  CorrelationProvider,
  RiskBudgetOptions,
  StrategyRiskConfig,
} from "./risk-budget.js";

export { CorrelationMatrix, CORRELATION_HARD_CAPS } from "./correlation.js";
export type { CorrelationMatrixOptions, CorrelationSnapshot } from "./correlation.js";

export {
  PortfolioStop,
  PortfolioStopError,
  PORTFOLIO_STOP_HARD_CAPS,
} from "./portfolio-stop.js";
export type { PortfolioStopOptions, PortfolioStopState } from "./portfolio-stop.js";

export { PortfolioManager } from "./portfolio-manager.js";
export type {
  PerStrategyBudget,
  PortfolioManagerOptions,
  PortfolioState,
  RecordFillInput,
} from "./portfolio-manager.js";
