/**
 * packages/backtest/src/index.ts
 */

export { BacktestEngine } from "./backtest-engine.js";
export type { BacktestConfig, BacktestResult } from "./backtest-engine.js";
export { calcFillCost, calcBacktestCost, auditFeeConfig } from "./fee-model.js";
export type { BacktestCostBreakdown } from "./fee-model.js";