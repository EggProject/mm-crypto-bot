import { DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE } from "../risk/leverage-invariant.js";
import type { PortfolioRiskEngineConfig } from "../risk/portfolio-risk-engine.js";
import type { SignalCenterV1 } from "../signal-center/signal-center-v1.js";
import type { Bar } from "../signal-center/types.js";
import type { StrategyPlugin } from "../signal-center/strategy-registry.js";
import type { ApproximatePortfolioAnalytics } from "./portfolio-approximate-analytics.js";
import type { DecisionEngineConfig, DecisionEngineLike, PositionDecision } from "./portfolio-decision.js";
import type { PortfolioOrchestratorValidationConfig } from "./portfolio-orchestrator-analytics.js";

export const DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG = Object.freeze({
  approximateCorrelationThreshold: 0.85,
  approximateCorrelationWindowDays: 30,
  initialEquityUsd: 1000,
  maxAggregateEffectiveLeverage: DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  maxPositions: 7,
  perSymbolConcentrationPct: 0.5,
  symbols: Object.freeze(["BTC/USDT", "ETH/USDT", "SOL/USDT"]),
});

export interface PortfolioFundingSnapshot {
  readonly fundingRate: number;
  readonly fundingTime: number;
  readonly symbol: string;
}

export type CapReason = "none" | "maxPositions" | "concentration" | "leverage";

export interface PortfolioPosition {
  readonly symbol: string;
  readonly decision?: PositionDecision;
  readonly appliedNotionalUsd: number;
  readonly side: "long" | "short" | "flat";
  readonly concentrationPct: number;
  readonly capped: boolean;
  readonly capReason?: CapReason;
}

export interface PortfolioSnapshot {
  readonly timestampMs: number;
  readonly equityUsd: number;
  readonly positionsBySymbol: Readonly<Record<string, PortfolioPosition>>;
  readonly aggregateLeverage: number;
  readonly approximateAnalytics: ApproximatePortfolioAnalytics;
  readonly concentrationBySymbol: Readonly<Record<string, number>>;
  readonly decisionLog: readonly PositionDecision[];
  readonly openPositionCount: number;
}

export interface PerSymbolEnvelope {
  readonly symbol: string;
  readonly finalEquityUsd: number;
  readonly totalReturnPct: number;
  readonly sharpeRatio: number;
  readonly maxDrawdownPct: number;
  readonly decisionCount: number;
  readonly openPositionCount: number;
  readonly capacityUsedPct: number;
}

export interface PortfolioEnvelope {
  readonly snapshots: readonly PortfolioSnapshot[];
  readonly finalEquity: number;
  readonly totalReturn: number;
  readonly sharpe: number;
  readonly maxDD: number;
  readonly perSymbolEnvelopes: readonly PerSymbolEnvelope[];
  readonly decisionLog: readonly PositionDecision[];
  readonly barCount: number;
  readonly leverageBreaches: number;
  readonly liquidations: number;
}

export interface PortfolioOrchestratorConfig extends PortfolioOrchestratorValidationConfig {
  readonly dataDir: string;
  readonly fundingDir: string;
  readonly readTextFile: (root: string, fileName: string) => Promise<string>;
  readonly riskEngine?: PortfolioRiskEngineConfig | undefined;
  readonly decisionEngine?: Partial<DecisionEngineConfig> | undefined;
  readonly decisionEngineFactory?: (
    config: DecisionEngineConfig & { readonly symbol: string },
  ) => DecisionEngineLike;
  readonly pluginsBySymbol?: (symbol: string, signalCenter: SignalCenterV1) => readonly StrategyPlugin[];
  readonly crossSymbolRecordClose?: (symbol: string, close: number, timestampMs: number) => void;
  readonly crossSymbolRecordFundingRate?: (symbol: string, rate: number, timestampMs: number) => void;
  readonly feedPlugins?: (
    symbol: string,
    signalCenter: SignalCenterV1,
    bar: Bar,
    fundingInBar: readonly PortfolioFundingSnapshot[],
  ) => void;
}
