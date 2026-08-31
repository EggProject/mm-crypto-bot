// packages/core/src/strategy/composite.ts — Composite multi-strategy ensemble
//
// Combines a trend filter and a mean-reversion entry signal:
//   - The trend component supplies the direction filter.
//   - The signal component supplies the entry trigger.
//
// The trend filter rejects mean-reversion signals that oppose the trend:
//   - If trend (component1) is undefined → accept no signals (no trend)
//   - If trend and mean reversion agree, emit that direction.
//   - If they disagree, emit the trend direction.
//   - If trend is LONG/SHORT and MR is undefined → composite follows the trend signal
//
// References:
//   - StrategyArena 2026: 60% MR + 40% Trend BTC 12-month composite:
//     +23.8% PnL, Sharpe 1.58, max DD -9.2% (lowest of any mix tested)
//   - SSRN Multi-Strategy Portfolios (académiai paper)
//   - Price Action Lab 2023: trend + MR ensemble "boosts Sharpe significantly"
//   - Documentation: composite strategy selection analysis, section 2.B

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

class CompositeStrategyCallbackError extends Error {
  constructor(component: "component1" | "component2", detail: string, cause?: unknown) {
    super(`CompositeStrategy callback result from ${component} is invalid: ${detail}`, { cause });
    this.name = "CompositeStrategyCallbackError";
  }
}

function isSignalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isUnitIntervalNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isSignalSide(value: unknown): value is "buy" | "sell" {
  return value === "buy" || value === "sell";
}

function snapshotStrategySignal(
  component: "component1" | "component2",
  callbackResult: unknown,
): StrategySignal {
  if (!isSignalRecord(callbackResult)) {
    throw new CompositeStrategyCallbackError(component, "it must be a non-null object");
  }

  let side: unknown;
  let confidence: unknown;
  let reason: unknown;
  let stopLoss: unknown;
  let takeProfit: unknown;
  try {
    side = callbackResult["side"];
    confidence = callbackResult["confidence"];
    reason = callbackResult["reason"];
    stopLoss = callbackResult["stopLoss"];
    takeProfit = callbackResult["takeProfit"];
  } catch (error) {
    throw new CompositeStrategyCallbackError(component, "its fields are unreadable", error);
  }

  if (!isSignalSide(side)) {
    throw new CompositeStrategyCallbackError(component, "side must be buy or sell");
  }
  if (!isUnitIntervalNumber(confidence)) {
    throw new CompositeStrategyCallbackError(component, "confidence must be finite and in [0, 1]");
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new CompositeStrategyCallbackError(component, "reason must be a non-empty string");
  }
  if (!isPositiveFiniteNumber(stopLoss) || !isPositiveFiniteNumber(takeProfit)) {
    throw new CompositeStrategyCallbackError(
      component,
      "stopLoss and takeProfit must be finite and positive",
    );
  }
  if ((side === "buy" && stopLoss >= takeProfit) || (side === "sell" && stopLoss <= takeProfit)) {
    throw new CompositeStrategyCallbackError(
      component,
      "stopLoss and takeProfit do not match the signal side",
    );
  }

  return { side, confidence, reason, stopLoss, takeProfit };
}

export interface CompositeStrategyConfig {
  readonly component1: Strategy;
  readonly component2: Strategy;
  /**
  If true (default), component2 signals are filtered by component1 direction.
  */
  readonly useTrendFilter: boolean;
  /**
  Confidence boost when both components agree on the same direction.
  */
  readonly agreementConfidenceBoost: number;
}

export const DEFAULT_COMPOSITE_CONFIG: Omit<CompositeStrategyConfig, "component1" | "component2"> = {
  useTrendFilter: true,
  agreementConfidenceBoost: 0.05,
};

export class CompositeStrategy implements Strategy {
  readonly name = "Composite Trend Filter";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: CompositeStrategyConfig;

  constructor(config: CompositeStrategyConfig) {
    this.config = config;
  }

  private getSignal(
    component: Strategy,
    componentName: "component1" | "component2",
    context: StrategyContext,
  ): StrategySignal | undefined {
    let callbackResult: unknown;
    try {
      callbackResult = component.onCandle(context);
    } catch (error) {
      throw new CompositeStrategyCallbackError(componentName, "callback threw or was unreadable", error);
    }
    return callbackResult === undefined ? undefined : snapshotStrategySignal(componentName, callbackResult);
  }

  private getComponentName(component: Strategy, componentName: "component1" | "component2"): string {
    try {
      const name: unknown = component.name;
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new CompositeStrategyCallbackError(componentName, "name must be a non-empty string");
      }
      return name;
    } catch (error) {
      if (error instanceof CompositeStrategyCallbackError) throw error;
      throw new CompositeStrategyCallbackError(componentName, "name was unreadable", error);
    }
  }

  warmup(): number {
    // Both components must be warm before ensemble can produce signals
    return Math.max(this.config.component1.warmup(), this.config.component2.warmup());
  }

  /**
   * Runs on the 1h LTF and combines both component signals through the
   * configured trend filter. When enabled, an absent first signal produces no
   * result; an absent second signal preserves the first; matching signals use
   * the second signal and boost confidence; conflicting signals preserve the
   * first. When disabled, either signal may pass through using OR voting.
   */
  onCandle(context: StrategyContext): StrategySignal | undefined {
    const { component1, component2, useTrendFilter, agreementConfidenceBoost } = this.config;
    const sig1 = this.getSignal(component1, "component1", context);
    const sig2 = this.getSignal(component2, "component2", context);

    if (!useTrendFilter) {
      // OR voting: bármelyik
      if (sig1 !== undefined) return sig1;
      if (sig2 !== undefined) return sig2;
      return undefined;
    }

    // Trend-filter ON
    if (sig1 === undefined) {
      // No trend signal — no entry (trend-filter protects against MR-only trades)
      return undefined;
    }

    if (sig2 === undefined) {
      // Only trend signal — follow trend
      return sig1;
    }

    const name1 = this.getComponentName(component1, "component1");
    const name2 = this.getComponentName(component2, "component2");

    // Both signals present
    if (sig1.side === sig2.side) {
      // Agreement — follow MR (more specific trigger), boost confidence
      return {
        ...sig2,
        confidence: Math.min(1, sig2.confidence + agreementConfidenceBoost),
        reason: `Composite AGREEMENT (${name1} + ${name2}, both ${sig1.side.toUpperCase()}): ${sig2.reason}`,
      };
    }

    // Disagreement — TREND WINS, MR filtered out
    return {
      ...sig1,
      reason: `Composite TREND FILTER (${name1} ${sig1.side.toUpperCase()} overrides ${name2} ${sig2.side.toUpperCase()}): ${sig1.reason}`,
    };
  }
}
