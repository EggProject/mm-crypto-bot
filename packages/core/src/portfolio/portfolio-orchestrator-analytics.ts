import {
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  assertAggregateEffectiveExposureLimit,
} from "../risk/leverage-invariant.js";
import {
  type PortfolioRiskEngine,
  type PortfolioRiskEngineConfig,
  type RiskSnapshot,
} from "../risk/portfolio-risk-engine.js";
import type { PositionDecision } from "./portfolio-decision.js";
import {
  calculateApproximatePortfolioAnalytics,
  copyImmutableApproximatePortfolioAnalytics,
  type ApproximatePortfolioAnalytics,
} from "./portfolio-approximate-analytics.js";
import {
  type CapReason,
  copyImmutableDecision,
  copyImmutableRiskSnapshot,
  previousBarBefore,
  requirePortfolioInvariant,
} from "./portfolio-orchestrator-market-data.js";
import type { Bar } from "../signal-center/types.js";
export interface AnalyticsPortfolioPosition {
  readonly appliedNotionalUsd: number;
  readonly capReason?: CapReason;
  readonly capped: boolean;
  readonly concentrationPct: number;
  readonly decision?: PositionDecision;
  readonly side: "long" | "short" | "flat";
  readonly symbol: string;
}
export interface AnalyticsPortfolioSnapshot {
  readonly aggregateLeverage: number;
  readonly approximateAnalytics: ApproximatePortfolioAnalytics;
  readonly concentrationBySymbol: Readonly<Record<string, number>>;
  readonly decisionLog: readonly PositionDecision[];
  readonly equityUsd: number;
  readonly openPositionCount: number;
  readonly positionsBySymbol: Readonly<Record<string, AnalyticsPortfolioPosition>>;
  readonly timestampMs: number;
}
export interface AggregateBarInput {
  readonly correlationThreshold: number;
  readonly decisionsBySymbol: ReadonlyMap<string, PositionDecision | undefined>;
  readonly decisionsForTimestamp: readonly PositionDecision[];
  readonly maxAggregateEffectiveLeverage: number;
  readonly maxPositions: number;
  readonly perSymbolConcentrationPct: number;
  readonly portfolioEquity: number;
  readonly returnsBySymbol: ReadonlyMap<string, readonly number[]>;
  readonly symbols: readonly string[];
  readonly timestampMs: number;
}
export interface AggregateBarResult {
  readonly isLeverageBreached: boolean;
  readonly isLiquidationObserved: boolean;
  readonly snapshot: AnalyticsPortfolioSnapshot;
}
export interface PortfolioOrchestratorValidationConfig {
  readonly approximateCorrelationThreshold: number;
  readonly approximateCorrelationWindowDays: number;
  readonly initialEquityUsd: number;
  readonly maxAggregateEffectiveLeverage: number;
  readonly maxPositions: number;
  readonly perSymbolConcentrationPct: number;
  readonly symbols: readonly string[];
}
export function validatePortfolioOrchestratorConfig(config: PortfolioOrchestratorValidationConfig): void {
  validateAggregateLimit(config.maxAggregateEffectiveLeverage);
  if (config.initialEquityUsd !== 1000)
    throw new Error("[PortfolioOrchestrator] initialEquityUsd must be exactly 1000 USD.");
  validatePositiveInteger("maxPositions", config.maxPositions);
  validateFraction("perSymbolConcentrationPct", config.perSymbolConcentrationPct);
  validateSymbols(config.symbols);
  if (
    !Number.isFinite(config.approximateCorrelationThreshold) ||
    Math.abs(config.approximateCorrelationThreshold) > 1
  ) {
    throw new Error(
      `[PortfolioOrchestrator] approximateCorrelationThreshold must be in [-1, 1], got ${String(config.approximateCorrelationThreshold)}`,
    );
  }
  validatePositiveInteger("approximateCorrelationWindowDays", config.approximateCorrelationWindowDays);
}
export function immutableSymbols(symbols: unknown): readonly [string, ...string[]] {
  validateSymbols(symbols);
  const [firstSymbol, ...remainingSymbols] = symbols;
  const copied: [string, ...string[]] = [firstSymbol, ...remainingSymbols];
  return Object.freeze(copied);
}
export function immutableRiskEngineConfig(config: PortfolioRiskEngineConfig): PortfolioRiskEngineConfig;
export function immutableRiskEngineConfig(config: undefined): undefined;
export function immutableRiskEngineConfig(
  config: PortfolioRiskEngineConfig | undefined,
): PortfolioRiskEngineConfig | undefined {
  if (config === undefined) return undefined;
  return Object.freeze({ ...config, leverageInvariant: Object.freeze({ ...config.leverageInvariant }) });
}
export function copyImmutableSnapshot(snapshot: AnalyticsPortfolioSnapshot): AnalyticsPortfolioSnapshot {
  const positionsBySymbol = Object.freeze(
    Object.fromEntries(
      Object.entries(snapshot.positionsBySymbol).map(([symbol, position]) => [
        symbol,
        Object.freeze({
          ...position,
          ...(position.decision !== undefined && { decision: copyImmutableDecision(position.decision) }),
        }),
      ]),
    ),
  );
  return Object.freeze({
    ...snapshot,
    concentrationBySymbol: Object.freeze({ ...snapshot.concentrationBySymbol }),
    approximateAnalytics: copyImmutableApproximatePortfolioAnalytics(snapshot.approximateAnalytics),
    decisionLog: Object.freeze(snapshot.decisionLog.map((decision) => copyImmutableDecision(decision))),
    positionsBySymbol,
  });
}
export function copyImmutableSnapshots(
  snapshots: readonly AnalyticsPortfolioSnapshot[],
): readonly AnalyticsPortfolioSnapshot[] {
  return Object.freeze(snapshots.map((snapshot) => copyImmutableSnapshot(snapshot)));
}
export function currentPortfolioRisk(risk: PortfolioRiskEngine, initialEquityUsd: number): RiskSnapshot {
  return copyImmutableRiskSnapshot(risk.snapshot(initialEquityUsd));
}
export function calculateAggregateBar(input: AggregateBarInput): AggregateBarResult {
  const positions = new Map<string, AnalyticsPortfolioPosition>();
  const notionals = new Map<string, number>();
  const sides = new Map<string, "long" | "short" | "flat">();
  let totalNotional = 0;
  let openCount = 0;
  for (const symbol of input.symbols) {
    const decision = input.decisionsBySymbol.get(symbol);
    const side = decision?.side ?? "flat";
    const notional = decision === undefined ? 0 : Math.abs(decision.notionalUsd);
    positions.set(symbol, {
      appliedNotionalUsd: notional,
      ...(notional <= 0 && { capReason: "none" }),
      capped: false,
      concentrationPct: 0,
      ...(decision !== undefined && { decision }),
      side,
      symbol,
    });
    notionals.set(symbol, notional);
    sides.set(symbol, side);
    if (side !== "flat" && notional > 0) {
      totalNotional += notional;
      openCount += 1;
    }
  }
  const orderedSymbols: string[] = [];
  for (const symbol of input.symbols) {
    const notional = requirePortfolioInvariant(notionals.get(symbol), `missing notional for ${symbol}`);
    const insertionIndex = orderedSymbols.findIndex(
      (candidate) =>
        requirePortfolioInvariant(notionals.get(candidate), `missing notional for ${candidate}`) < notional,
    );
    if (insertionIndex === -1) {
      orderedSymbols.push(symbol);
    } else {
      orderedSymbols.splice(insertionIndex, 0, symbol);
    }
  }
  const allowedSymbols = new Set(orderedSymbols.slice(0, input.maxPositions));
  for (const symbol of input.symbols) {
    if (
      openCount <= input.maxPositions ||
      requirePortfolioInvariant(sides.get(symbol), `missing side for ${symbol}`) === "flat" ||
      allowedSymbols.has(symbol)
    )
      continue;
    const position = requirePortfolioInvariant(positions.get(symbol), `missing position for ${symbol}`);
    const notional = requirePortfolioInvariant(notionals.get(symbol), `missing notional for ${symbol}`);
    positions.set(symbol, {
      ...position,
      appliedNotionalUsd: 0,
      capReason: "maxPositions",
      capped: true,
      side: "flat",
    });
    notionals.set(symbol, 0);
    sides.set(symbol, "flat");
    totalNotional -= notional;
    openCount -= 1;
  }
  for (const symbol of input.symbols) {
    if (requirePortfolioInvariant(sides.get(symbol), `missing side for ${symbol}`) === "flat") continue;
    const position = requirePortfolioInvariant(positions.get(symbol), `missing position for ${symbol}`);
    const notional = requirePortfolioInvariant(notionals.get(symbol), `missing notional for ${symbol}`);
    const maximum =
      input.portfolioEquity * input.perSymbolConcentrationPct * input.maxAggregateEffectiveLeverage;
    if (notional <= maximum) continue;
    positions.set(symbol, {
      ...position,
      appliedNotionalUsd: maximum,
      capReason: position.capReason ?? "concentration",
      capped: true,
    });
    notionals.set(symbol, maximum);
    totalNotional -= notional - maximum;
  }
  const concentrations = new Map<string, number>();
  const aggregateLeverage = totalNotional / input.portfolioEquity;
  const isLeverageBreached = aggregateLeverage > input.maxAggregateEffectiveLeverage;
  if (isLeverageBreached) {
    totalNotional = scalePositions(
      positions,
      notionals,
      sides,
      input.symbols,
      input.maxAggregateEffectiveLeverage / aggregateLeverage,
      totalNotional,
      "leverage",
    );
    assertAggregateEffectiveExposureLimit(totalNotional, input.portfolioEquity, {
      ...DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
      maxAggregateEffectiveLeverage: input.maxAggregateEffectiveLeverage,
    });
  }
  for (const symbol of input.symbols) {
    const concentration =
      requirePortfolioInvariant(notionals.get(symbol), `missing notional for ${symbol}`) /
      input.portfolioEquity;
    concentrations.set(symbol, concentration);
    const position = requirePortfolioInvariant(positions.get(symbol), `missing position for ${symbol}`);
    positions.set(symbol, { ...position, concentrationPct: concentration });
  }
  return {
    isLeverageBreached,
    isLiquidationObserved: isLeverageBreached && aggregateLeverage > 1,
    snapshot: copyImmutableSnapshot({
      aggregateLeverage: totalNotional / input.portfolioEquity,
      approximateAnalytics: calculateApproximatePortfolioAnalytics({
        correlationThreshold: input.correlationThreshold,
        portfolioEquity: input.portfolioEquity,
        returnsBySymbol: input.returnsBySymbol,
        symbols: input.symbols,
        totalNotionalUsd: totalNotional,
      }),
      concentrationBySymbol: Object.fromEntries(concentrations),
      decisionLog: input.decisionsForTimestamp,
      equityUsd: input.portfolioEquity,
      openPositionCount: openCount,
      positionsBySymbol: Object.fromEntries(positions),
      timestampMs: input.timestampMs,
    }),
  };
}
export function sumAppliedNotionals(
  positions: Readonly<Record<string, { readonly appliedNotionalUsd: number }>>,
): number {
  let total = 0;
  for (const position of Object.values(positions)) {
    total += position.appliedNotionalUsd;
  }
  return total;
}
export function recordPortfolioEquityAndReturns(
  symbols: readonly string[],
  initialEquityUsd: number,
  approximateCorrelationWindowDays: number,
  snapshot: AnalyticsPortfolioSnapshot,
  timestampMs: number,
  bars: ReadonlyMap<string, Bar>,
  barsBySymbolCache: ReadonlyMap<string, readonly Bar[]>,
  equityCurves: Map<string, number[]>,
  dailyReturns: Map<string, number[]>,
): void {
  for (const symbol of symbols) {
    const curve = requirePortfolioInvariant(equityCurves.get(symbol), `missing equity curve for ${symbol}`);
    const position = requirePortfolioInvariant(
      Object.entries(snapshot.positionsBySymbol).find(([candidate]) => candidate === symbol)?.[1],
      `missing position for ${symbol}`,
    );
    const total = sumAppliedNotionals(snapshot.positionsBySymbol);
    const share = total <= 0 ? 1 / symbols.length : Math.abs(position.appliedNotionalUsd) / total;
    curve.push(initialEquityUsd + (snapshot.equityUsd - initialEquityUsd) * share);
    const bar = requirePortfolioInvariant(bars.get(symbol), `missing driven bar for ${symbol}`);
    const returns = requirePortfolioInvariant(dailyReturns.get(symbol), `missing returns for ${symbol}`);
    const earlier = previousBarBefore(barsBySymbolCache.get(symbol), timestampMs);
    returns.push(
      earlier === undefined || earlier.close <= 0 || returns.length === 0
        ? 0
        : (bar.close - earlier.close) / earlier.close,
    );
    if (returns.length > approximateCorrelationWindowDays)
      returns.splice(0, returns.length - approximateCorrelationWindowDays);
  }
}
export function buildPortfolioMetrics(input: {
  readonly decisionCountBySymbol: ReadonlyMap<string, number>;
  readonly decisionLog: readonly PositionDecision[];
  readonly equityCurves: ReadonlyMap<string, readonly number[]>;
  readonly initialEquityUsd: number;
  readonly leverageBreaches: number;
  readonly liquidations: number;
  readonly maxPositions: number;
  readonly openCountBySymbol: ReadonlyMap<string, number>;
  readonly returnsBySymbol: ReadonlyMap<string, readonly number[]>;
  readonly snapshots: readonly AnalyticsPortfolioSnapshot[];
  readonly symbols: readonly string[];
}): {
  readonly barCount: number;
  readonly decisionLog: readonly PositionDecision[];
  readonly finalEquity: number;
  readonly leverageBreaches: number;
  readonly liquidations: number;
  readonly maxDD: number;
  readonly perSymbolEnvelopes: readonly {
    readonly capacityUsedPct: number;
    readonly decisionCount: number;
    readonly finalEquityUsd: number;
    readonly maxDrawdownPct: number;
    readonly openPositionCount: number;
    readonly sharpeRatio: number;
    readonly symbol: string;
    readonly totalReturnPct: number;
  }[];
  readonly sharpe: number;
  readonly snapshots: readonly AnalyticsPortfolioSnapshot[];
  readonly totalReturn: number;
} {
  const perSymbolEnvelopes = input.symbols.map((symbol) => {
    const curve = requirePortfolioInvariant(
      input.equityCurves.get(symbol),
      `missing equity curve for ${symbol}`,
    );
    const finalEquityUsd = requirePortfolioInvariant(curve.at(-1), `empty equity curve for ${symbol}`);
    return {
      capacityUsedPct:
        requirePortfolioInvariant(input.openCountBySymbol.get(symbol), `missing open count for ${symbol}`) /
        input.maxPositions,
      decisionCount: requirePortfolioInvariant(
        input.decisionCountBySymbol.get(symbol),
        `missing decision count for ${symbol}`,
      ),
      finalEquityUsd,
      maxDrawdownPct: maximumDrawdown(curve),
      openPositionCount: requirePortfolioInvariant(
        input.openCountBySymbol.get(symbol),
        `missing open count for ${symbol}`,
      ),
      sharpeRatio: sharpeRatio(
        requirePortfolioInvariant(input.returnsBySymbol.get(symbol), `missing returns for ${symbol}`),
      ),
      symbol,
      totalReturnPct: (finalEquityUsd - input.initialEquityUsd) / input.initialEquityUsd,
    };
  });
  const curve = input.snapshots.map(({ equityUsd }) => equityUsd);
  const finalEquity = requirePortfolioInvariant(curve.at(-1), "empty portfolio snapshot history");
  const returns = curve.slice(1).map((equityUsd, index) => {
    const previous = requirePortfolioInvariant(
      curve.at(index),
      `missing portfolio curve item ${String(index)}`,
    );
    return (equityUsd - previous) / previous;
  });
  return Object.freeze({
    barCount: input.snapshots.length,
    decisionLog: Object.freeze(input.decisionLog.map((decision) => copyImmutableDecision(decision))),
    finalEquity,
    leverageBreaches: input.leverageBreaches,
    liquidations: input.liquidations,
    maxDD: maximumDrawdown(curve),
    perSymbolEnvelopes: Object.freeze(perSymbolEnvelopes.map((envelope) => Object.freeze(envelope))),
    sharpe: sharpeRatio(returns),
    snapshots: Object.freeze(input.snapshots.map((snapshot) => copyImmutableSnapshot(snapshot))),
    totalReturn: (finalEquity - input.initialEquityUsd) / input.initialEquityUsd,
  });
}
function validateAggregateLimit(value: number): void {
  if (!Number.isFinite(value) || value < 1 || value > 10)
    throw new Error(
      `[PortfolioOrchestrator] aggregate effective-exposure limit breach: maxAggregateEffectiveLeverage must be in [1, 10]. Got ${String(value)}. Refusing to construct.`,
    );
}
function validateSymbols(symbols: unknown): asserts symbols is readonly [string, ...string[]] {
  if (!Array.isArray(symbols) || symbols.length === 0)
    throw new Error("[PortfolioOrchestrator] symbols must be a non-empty array.");
  const seen = new Set<string>();
  for (const symbol of symbols) {
    const isCanonicalSymbol = typeof symbol === "string" && /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol);
    if (!isCanonicalSymbol || seen.has(symbol))
      throw new Error("[PortfolioOrchestrator] symbols must contain canonical BASE/QUOTE pairs.");
    seen.add(symbol);
  }
}
function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`[PortfolioOrchestrator] ${name} must be a positive integer, got ${String(value)}`);
}
function validateFraction(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1)
    throw new Error(`[PortfolioOrchestrator] ${name} must be in (0, 1], got ${String(value)}`);
}
function scalePositions(
  positions: Map<string, AnalyticsPortfolioPosition>,
  notionals: Map<string, number>,
  sides: ReadonlyMap<string, "long" | "short" | "flat">,
  symbols: readonly string[],
  scale: number,
  total: number,
  capReason: CapReason,
): number {
  for (const symbol of symbols) {
    if (requirePortfolioInvariant(sides.get(symbol), `missing side for ${symbol}`) === "flat") continue;
    const position = requirePortfolioInvariant(positions.get(symbol), `missing position for ${symbol}`);
    const prior = requirePortfolioInvariant(notionals.get(symbol), `missing notional for ${symbol}`);
    const next = prior * scale;
    positions.set(symbol, {
      ...position,
      appliedNotionalUsd: next,
      capReason: position.capReason ?? capReason,
      capped: true,
    });
    notionals.set(symbol, next);
    total -= prior - next;
  }
  return total;
}
function sharpeRatio(returns: readonly number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const deviation = Math.sqrt(
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1),
  );
  return deviation === 0 ? 0 : (mean / deviation) * Math.sqrt(365);
}
function maximumDrawdown(curve: readonly number[]): number {
  let peak = -Infinity;
  let drawdown = 0;
  for (const equity of curve) {
    if (equity > peak) peak = equity;
    drawdown = Math.max(drawdown, (peak - equity) / peak);
  }
  return drawdown;
}
