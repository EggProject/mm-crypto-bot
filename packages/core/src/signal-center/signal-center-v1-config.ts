import {
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  type AggregateEffectiveExposureLimit,
} from "../risk/leverage-invariant.js";
import {
  DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  type PortfolioRiskEngineConfig,
} from "../risk/portfolio-risk-engine.js";
import {
  DEFAULT_STRATEGY_TELEMETRY_CONFIG,
  type StrategyTelemetryConfig,
} from "../telemetry/strategy-telemetry.js";

export interface SignalCenterV1Config {
  readonly initialEquity: number;
  readonly maxAggregateEffectiveLeverage: number;
  readonly symbol?: string;
  readonly riskEngine: PortfolioRiskEngineConfig;
  readonly telemetry: StrategyTelemetryConfig;
  readonly leverageInvariant: AggregateEffectiveExposureLimit;
  readonly varCapital?: number;
}

/**
 * Fixed paper/backtest baseline; the selected leverage baseline is 10x.
 */
export const DEFAULT_SIGNAL_CENTER_V1_BASELINE = {
  initialEquityUsd: 1000,
  initialGrossExposureCeilingUsd: 1000 * DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
} as const;

export const DEFAULT_SIGNAL_CENTER_V1_CONFIG: Omit<SignalCenterV1Config, "symbol"> = {
  initialEquity: DEFAULT_SIGNAL_CENTER_V1_BASELINE.initialEquityUsd,
  maxAggregateEffectiveLeverage: DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE,
  riskEngine: DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  telemetry: DEFAULT_STRATEGY_TELEMETRY_CONFIG,
  leverageInvariant: DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
};

export function createSignalCenterV1Config(config: Partial<SignalCenterV1Config>): SignalCenterV1Config {
  const maxAggregateEffectiveLeverage =
    config.maxAggregateEffectiveLeverage ?? DEFAULT_SIGNAL_CENTER_V1_CONFIG.maxAggregateEffectiveLeverage;
  validateAggregateEffectiveLeverage(maxAggregateEffectiveLeverage, "maxAggregateEffectiveLeverage");

  const requestedLeverageInvariant = config.leverageInvariant;
  if (requestedLeverageInvariant !== undefined) {
    const requestedTolerance = requestedLeverageInvariant.tolerance;
    validateAggregateEffectiveLeverage(
      requestedLeverageInvariant.maxAggregateEffectiveLeverage,
      "leverageInvariant.maxAggregateEffectiveLeverage",
    );
    if (!Object.is(requestedTolerance, 0)) {
      throw new Error("[SignalCenterV1] leverageInvariant.tolerance must be exactly 0");
    }
    if (
      !Number.isFinite(requestedLeverageInvariant.warnOnApproach) ||
      requestedLeverageInvariant.warnOnApproach < 0 ||
      requestedLeverageInvariant.warnOnApproach > 1
    ) {
      throw new Error("[SignalCenterV1] leverageInvariant.warnOnApproach must be finite and in [0, 1]");
    }
    if (requestedLeverageInvariant.maxAggregateEffectiveLeverage !== maxAggregateEffectiveLeverage) {
      throw new Error(
        "[SignalCenterV1] leverageInvariant.maxAggregateEffectiveLeverage must match maxAggregateEffectiveLeverage",
      );
    }
  }
  const leverageInvariant: AggregateEffectiveExposureLimit = {
    ...(requestedLeverageInvariant ?? DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT),
    maxAggregateEffectiveLeverage,
  };
  const merged = {
    ...DEFAULT_SIGNAL_CENTER_V1_CONFIG,
    ...config,
    maxAggregateEffectiveLeverage,
    leverageInvariant,
  };
  if (!Number.isSafeInteger(merged.initialEquity) || merged.initialEquity <= 0) {
    throw new Error(
      `[SignalCenterV1] initialEquity must be positive safe integer, got ${String(merged.initialEquity)}`,
    );
  }
  return merged;
}

function validateAggregateEffectiveLeverage(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 1 || value > DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE) {
    throw new Error(
      `[SignalCenterV1] aggregate effective-exposure limit breach: ${field} must be in [1, ${String(DEFAULT_MAX_AGGREGATE_EFFECTIVE_LEVERAGE)}], got ${String(value)}`,
    );
  }
}
