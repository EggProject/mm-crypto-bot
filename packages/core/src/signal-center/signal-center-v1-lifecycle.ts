import type { SignalBus } from "./signal-bus.js";
import type { RiskSignal as SignalCenterRiskSignal, Signal } from "./types.js";
import type { SignalCenterV1Config } from "./signal-center-v1-config.js";
import type * as riskEngineModule from "../risk/portfolio-risk-engine.js";
import type { PortfolioRiskEngine } from "../risk/portfolio-risk-engine.js";

export function emitAggregateEffectiveExposureLimitBreachIfNeeded(
  riskEngine: PortfolioRiskEngine,
  config: SignalCenterV1Config,
  bus: SignalBus,
): void {
  const breach = riskEngine.leverageInvariantGuard(config.initialEquity);
  if (breach === undefined) return;
  const signal: SignalCenterRiskSignal = {
    kind: "risk",
    source: breach.source,
    varDaily95: breach.varDaily95 ?? 0,
    correlationPenalty: 0,
    drawdownLimit: 0,
    timestampMs: breach.timestamp,
    breach: true,
    reason: breach.reason,
    ...(config.symbol !== undefined && { symbol: config.symbol }),
  };
  bus.emit(signal);
}

export function toRiskEngineSignal(
  signal: Signal,
  symbol: string,
  initialEquity: number,
): riskEngineModule.Signal {
  if (!Number.isSafeInteger(initialEquity) || initialEquity <= 0) {
    throw new Error(
      `[SignalCenterV1] initialEquity must be positive safe integer, got ${String(initialEquity)}`,
    );
  }
  const timestamp = signal.timestampMs ?? 0;
  const attributedSymbol = signal.symbol ?? symbol;
  switch (signal.kind) {
    case "direction": {
      return {
        kind: "direction",
        source: signal.source,
        symbol: attributedSymbol,
        side: signal.side === "flat" ? "long" : signal.side,
        confidence: signal.strength,
        effectiveNotionalUsd: 0,
        timestamp,
      };
    }
    case "carry": {
      return {
        kind: "carry",
        source: signal.source,
        symbol: attributedSymbol,
        effectiveNotionalUsd: 0,
        timestamp,
      };
    }
    case "sizing": {
      return {
        kind: "sizing",
        source: signal.source,
        symbol: attributedSymbol,
        effectiveNotionalUsd: signal.notional,
        leverage: signal.notional > 0 ? signal.notional / initialEquity : 0,
        timestamp,
      };
    }
    case "risk": {
      return {
        kind: "risk",
        source: signal.source,
        symbol: attributedSymbol,
        drawdownLimit: signal.drawdownLimit,
        varDaily95: signal.varDaily95,
        reason: signal.source,
        timestamp,
        breach: signal.breach ?? false,
      };
    }
    case "factor": {
      return {
        kind: "carry",
        source: signal.source,
        symbol: attributedSymbol,
        effectiveNotionalUsd: 0,
        timestamp,
      };
    }
    case "funding-snapshot": {
      return {
        kind: "direction",
        source: signal.source,
        symbol: attributedSymbol,
        side: "long",
        confidence: 0,
        effectiveNotionalUsd: 0,
        timestamp,
      };
    }
  }
}
