import type { Bar } from "../signal-center/types.js";
import type { DecisionEngineConfig, DecisionEngineLike, PositionDecision } from "./portfolio-decision.js";
import type { RiskSnapshot } from "../risk/portfolio-risk-engine.js";
import type { PortfolioFundingSnapshot } from "./portfolio-orchestrator-contracts.js";

export {
  DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG,
  type CapReason,
  type PerSymbolEnvelope,
  type PortfolioEnvelope,
  type PortfolioFundingSnapshot,
  type PortfolioPosition,
  type PortfolioSnapshot,
} from "./portfolio-orchestrator-contracts.js";

const OHLCV_HEADER = "timestamp,open,high,low,close,volume";
const FUNDING_HEADER = "fundingTime,symbol,fundingRate,markPrice";
export class PortfolioCsvValidationError extends Error {
  constructor(
    readonly datasetKind: "OHLCV" | "funding",
    readonly sourceFile: string,
    readonly line: number,
    reason: string,
  ) {
    super(
      `[PortfolioOrchestrator] Invalid ${datasetKind} CSV ${sourceFile} at line ${String(line)}: ${reason}`,
    );
    this.name = "PortfolioCsvValidationError";
  }
}
export class PortfolioDecisionBoundaryError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`[PortfolioOrchestrator] Portfolio decision boundary: ${reason}`, options);
    this.name = "PortfolioDecisionBoundaryError";
  }
}
export function marketDataFileStem(symbol: string): string {
  return symbol.slice(0, symbol.indexOf("/")).toLowerCase();
}
export function requirePortfolioInvariant<T>(value: T | undefined, message: string): T {
  if (value === undefined)
    throw new Error(`[PortfolioOrchestrator] Internal invariant violation: ${message}`);
  return value;
}
export function parseOhlcvCsv(raw: string, startMs: number, endMs: number, sourceFile = "<inline>"): Bar[] {
  const rows = csvRows(raw, "OHLCV", OHLCV_HEADER, sourceFile, 6);
  const bars: Bar[] = [];
  let previousTimestamp: number | undefined;
  for (const [index, parts] of rows.entries()) {
    const line = index + 2;
    const timestamp = parseTimestamp(String(parts[0]), "OHLCV", sourceFile, line);
    assertStrictlyIncreasing(previousTimestamp, timestamp, "OHLCV", sourceFile, line);
    previousTimestamp = timestamp;
    const open = parseNumber(String(parts[1]), "open", "OHLCV", sourceFile, line);
    const high = parseNumber(String(parts[2]), "high", "OHLCV", sourceFile, line);
    const low = parseNumber(String(parts[3]), "low", "OHLCV", sourceFile, line);
    const close = parseNumber(String(parts[4]), "close", "OHLCV", sourceFile, line);
    const volume = parseNumber(String(parts[5]), "volume", "OHLCV", sourceFile, line);
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0)
      throw new PortfolioCsvValidationError("OHLCV", sourceFile, line, "OHLC values must be positive.");
    if (volume < 0)
      throw new PortfolioCsvValidationError("OHLCV", sourceFile, line, "volume must be non-negative.");
    if (high < Math.max(open, low, close) || low > Math.min(open, high, close))
      throw new PortfolioCsvValidationError(
        "OHLCV",
        sourceFile,
        line,
        "OHLC values are internally inconsistent.",
      );
    if (timestamp >= startMs && timestamp <= endMs) bars.push({ close, high, low, open, timestamp, volume });
  }
  return bars;
}
export function parseFundingCsv(
  raw: string,
  symbol: string,
  startMs: number,
  endMs: number,
  sourceFile = "<inline>",
): PortfolioFundingSnapshot[] {
  const rows = csvRows(raw, "funding", FUNDING_HEADER, sourceFile, 4);
  const snapshots: PortfolioFundingSnapshot[] = [];
  let previousTimestamp: number | undefined;
  for (const [index, parts] of rows.entries()) {
    const line = index + 2;
    const fundingTime = parseTimestamp(String(parts[0]), "funding", sourceFile, line);
    assertStrictlyIncreasing(previousTimestamp, fundingTime, "funding", sourceFile, line);
    previousTimestamp = fundingTime;
    const fundingSymbol = String(parts[1]);
    if (fundingSymbol.trim().length === 0)
      throw new PortfolioCsvValidationError("funding", sourceFile, line, "symbol must be non-empty.");
    if (fundingSymbol !== `${marketDataFileStem(symbol).toUpperCase()}USDT`)
      throw new PortfolioCsvValidationError(
        "funding",
        sourceFile,
        line,
        "symbol does not match the request.",
      );
    const fundingRate = parseNumber(String(parts[2]), "fundingRate", "funding", sourceFile, line);
    const markPrice = String(parts[3]);
    if (markPrice.trim().length > 0) parseNumber(markPrice, "markPrice", "funding", sourceFile, line);
    if (fundingTime >= startMs && fundingTime <= endMs) snapshots.push({ fundingRate, fundingTime, symbol });
  }
  return snapshots;
}
export function commonBarTimestamps(
  symbols: readonly [string, ...string[]],
  barsBySymbol: ReadonlyMap<string, readonly Bar[]>,
): number[] {
  const timestampSets = symbols
    .slice(1)
    .map((symbol) => new Set(barsBySymbol.get(symbol)?.map(({ timestamp }) => timestamp)));
  return [...new Set(barsBySymbol.get(symbols[0])?.map(({ timestamp }) => timestamp))].filter((timestamp) =>
    timestampSets.every((set) => set.has(timestamp)),
  );
}
export function previousBarBefore(bars: readonly Bar[] | undefined, timestampMs: number): Bar | undefined {
  if (bars === undefined) return undefined;
  let previous: Bar | undefined;
  for (const bar of bars) {
    if (bar.timestamp >= timestampMs) break;
    previous = bar;
  }
  return previous;
}
export function findDecisionAtTimestamp(
  engine: DecisionEngineLike,
  timestampMs: number,
): PositionDecision | undefined {
  let matchingDecision: PositionDecision | undefined;
  try {
    for (const decision of engine.decisions()) {
      if (decision.timestampMs === timestampMs) matchingDecision = decision;
    }
  } catch (error: unknown) {
    throw new PortfolioDecisionBoundaryError("unable to inspect an injected decision history.", {
      cause: error,
    });
  }
  return matchingDecision;
}
type DecisionSynthesizer = (
  this: DecisionEngineLike,
  symbol: string,
  timestampMs: number,
) => PositionDecision | undefined;
export function readDecisionSynthesizer(engine: DecisionEngineLike): DecisionSynthesizer | undefined {
  try {
    const synthesize: unknown = Reflect.get(engine, "synthesize");
    return isDecisionSynthesizer(synthesize) ? synthesize : undefined;
  } catch (error: unknown) {
    throw new PortfolioDecisionBoundaryError("unable to read an injected synthesize method.", {
      cause: error,
    });
  }
}
export function invokeDecisionSynthesizer(
  engine: DecisionEngineLike,
  synthesize: DecisionSynthesizer,
  symbol: string,
  timestampMs: number,
): PositionDecision | undefined {
  try {
    return synthesize.call(engine, symbol, timestampMs);
  } catch (error: unknown) {
    throw new PortfolioDecisionBoundaryError("unable to invoke an injected synthesize method.", {
      cause: error,
    });
  }
}
export function copyImmutableRiskSnapshot(snapshot: RiskSnapshot): RiskSnapshot {
  const lastCorrelation = snapshot.lastCorrelation;
  const matrix = lastCorrelation?.matrix.map((row) => Object.freeze([...row]));
  return Object.freeze({
    ...snapshot,
    drawdown: Object.freeze({ ...snapshot.drawdown }),
    exposure: Object.freeze({
      ...snapshot.exposure,
      overThresholdSymbols: Object.freeze([...snapshot.exposure.overThresholdSymbols]),
      perSymbol: new Map(snapshot.exposure.perSymbol),
      perSymbolFraction: new Map(snapshot.exposure.perSymbolFraction),
    }),
    ...(lastCorrelation !== undefined &&
      matrix !== undefined && {
        lastCorrelation: Object.freeze({
          ...lastCorrelation,
          matrix: Object.freeze(matrix),
          sources: Object.freeze([...lastCorrelation.sources]),
        }),
      }),
    ...(snapshot.lastVaR !== undefined && { lastVaR: Object.freeze({ ...snapshot.lastVaR }) }),
    leverageInvariantFires: Object.freeze(
      snapshot.leverageInvariantFires.map((fire) => Object.freeze({ ...fire })),
    ),
    positions: Object.freeze(snapshot.positions.map((position) => Object.freeze({ ...position }))),
  });
}
export function copyImmutableDecision(decision: PositionDecision): PositionDecision {
  return validateDecisionEngineResult(decision, decision.symbol, decision.timestampMs);
}
export function copyImmutableDecisions(decisions: readonly PositionDecision[]): readonly PositionDecision[] {
  return Object.freeze(decisions.map((decision) => copyImmutableDecision(decision)));
}
export function formatPortfolioDecisionLogJsonl(decisions: readonly PositionDecision[]): string {
  return decisions
    .map(({ timestampMs: ts, symbol, side, notionalUsd: notional, sourceWeights }) =>
      JSON.stringify({ notional, side, sourceWeights, symbol, ts }),
    )
    .join("\n");
}
export function immutableDecisionEngineConfig(
  config: Partial<DecisionEngineConfig> | undefined,
): Readonly<Partial<DecisionEngineConfig>> | undefined {
  return config === undefined ? undefined : Object.freeze({ ...config });
}
export function validateDecisionEngineResult(
  candidate: unknown,
  expectedSymbol: string,
  expectedTimestampMs: number,
): PositionDecision {
  try {
    if (!isRecord(candidate)) throw new PortfolioDecisionBoundaryError("decision must be an object.");
    const materialized = materializeDecisionFields(candidate);
    const { confidence, notionalUsd, side, sizeMultiplier, sourceWeights, symbol, timestampMs } =
      materialized;
    if (symbol !== expectedSymbol)
      throw new PortfolioDecisionBoundaryError("decision symbol does not match the driven symbol.");
    if (timestampMs !== expectedTimestampMs)
      throw new PortfolioDecisionBoundaryError("decision timestamp does not match the driven bar.");
    if (side !== "long" && side !== "short" && side !== "flat")
      throw new PortfolioDecisionBoundaryError("decision side is not allowed.");
    if (!isFiniteNumber(notionalUsd))
      throw new PortfolioDecisionBoundaryError("decision notional must be finite.");
    if (
      (side === "flat" && notionalUsd !== 0) ||
      (side === "long" && notionalUsd < 0) ||
      (side === "short" && notionalUsd > 0)
    )
      throw new PortfolioDecisionBoundaryError("decision notional sign does not match its side.");
    if (!isUnitInterval(sizeMultiplier))
      throw new PortfolioDecisionBoundaryError("decision sizeMultiplier must be finite in [0, 1].");
    if (!isUnitInterval(confidence))
      throw new PortfolioDecisionBoundaryError("decision confidence must be finite in [0, 1].");
    return Object.freeze({
      confidence,
      notionalUsd,
      side,
      sizeMultiplier,
      sourceWeights: copySourceWeights(sourceWeights),
      symbol,
      timestampMs,
    });
  } catch (error: unknown) {
    if (error instanceof PortfolioDecisionBoundaryError) throw error;
    throw new PortfolioDecisionBoundaryError("unable to materialize an injected decision.", { cause: error });
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isDecisionSynthesizer(value: unknown): value is DecisionSynthesizer {
  return typeof value === "function";
}
function materializeDecisionFields(candidate: Record<string, unknown>): Readonly<{
  readonly confidence: unknown;
  readonly notionalUsd: unknown;
  readonly side: unknown;
  readonly sizeMultiplier: unknown;
  readonly sourceWeights: unknown;
  readonly symbol: unknown;
  readonly timestampMs: unknown;
}> {
  return Object.freeze({
    confidence: candidate["confidence"],
    notionalUsd: candidate["notionalUsd"],
    side: candidate["side"],
    sizeMultiplier: candidate["sizeMultiplier"],
    sourceWeights: candidate["sourceWeights"],
    symbol: candidate["symbol"],
    timestampMs: candidate["timestampMs"],
  });
}
function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function copySourceWeights(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new PortfolioDecisionBoundaryError("decision sourceWeights must be a plain record.");
  const copied: Record<string, number> = {};
  const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value));
  for (const [key, descriptor] of descriptors) {
    if (!descriptor.enumerable || !("value" in descriptor))
      throw new PortfolioDecisionBoundaryError("decision sourceWeights must contain enumerable data values.");
    if (key.trim().length === 0 || typeof descriptor.value !== "number" || !Number.isFinite(descriptor.value))
      throw new PortfolioDecisionBoundaryError("decision sourceWeights contain an invalid entry.");
    if (descriptor.value < 0)
      throw new PortfolioDecisionBoundaryError("decision sourceWeights must be non-negative.");
    Object.defineProperty(copied, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return Object.freeze(copied);
}
function csvRows(
  raw: string,
  datasetKind: "OHLCV" | "funding",
  expectedHeader: string,
  sourceFile: string,
  expectedColumns: number,
): readonly (readonly string[])[] {
  const lines = raw.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== expectedHeader)
    throw new PortfolioCsvValidationError(datasetKind, sourceFile, 1, `expected header ${expectedHeader}.`);
  return lines.slice(1).map((line, index) => {
    const lineNumber = index + 2;
    if (line.length === 0)
      throw new PortfolioCsvValidationError(
        datasetKind,
        sourceFile,
        lineNumber,
        "blank data rows are not allowed.",
      );
    const columns = line.split(",");
    if (columns.length !== expectedColumns)
      throw new PortfolioCsvValidationError(
        datasetKind,
        sourceFile,
        lineNumber,
        `expected ${String(expectedColumns)} columns, received ${String(columns.length)}.`,
      );
    return columns;
  });
}
function parseTimestamp(
  raw: string,
  datasetKind: "OHLCV" | "funding",
  sourceFile: string,
  line: number,
): number {
  const timestamp = parseNumber(raw, "timestamp", datasetKind, sourceFile, line);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0)
    throw new PortfolioCsvValidationError(
      datasetKind,
      sourceFile,
      line,
      "timestamp must be a non-negative safe integer.",
    );
  return timestamp;
}
function parseNumber(
  raw: string,
  key: string,
  kind: "OHLCV" | "funding",
  source: string,
  line: number,
): number {
  const value = raw.trim().length === 0 ? NaN : Number(raw);
  if (!Number.isFinite(value))
    throw new PortfolioCsvValidationError(kind, source, line, `${key} must be a finite number.`);
  return value;
}
function assertStrictlyIncreasing(
  previousTimestamp: number | undefined,
  timestamp: number,
  datasetKind: "OHLCV" | "funding",
  sourceFile: string,
  line: number,
): void {
  if (previousTimestamp !== undefined && timestamp <= previousTimestamp)
    throw new PortfolioCsvValidationError(
      datasetKind,
      sourceFile,
      line,
      "timestamps must be strictly increasing with no duplicates.",
    );
}
export function correlationMatrix(
  symbols: readonly string[],
  returns: ReadonlyMap<string, readonly number[]>,
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  return new Map(
    symbols.map((left) => [
      left,
      new Map(
        symbols.map((right) => [
          right,
          left === right
            ? 1
            : pearsonCorrelation(
                requirePortfolioInvariant(returns.get(left), `missing returns for ${left}`),
                requirePortfolioInvariant(returns.get(right), `missing returns for ${right}`),
              ),
        ]),
      ),
    ]),
  );
}
export function correlatedPairs(
  symbols: readonly string[],
  matrix: ReadonlyMap<string, ReadonlyMap<string, number>>,
  threshold: number,
): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (const [index, left] of symbols.entries()) {
    const remainingSymbols = symbols.slice(index + 1);
    for (const right of remainingSymbols) {
      const row = requirePortfolioInvariant(matrix.get(left), `missing correlation row for ${left}`);
      const correlation = requirePortfolioInvariant(
        row.get(right),
        `missing correlation for ${left}/${right}`,
      );
      if (Math.abs(correlation) > threshold) pairs.push([left, right]);
    }
  }
  return pairs;
}
function pearsonCorrelation(left: readonly number[], right: readonly number[]): number {
  if (left.length < 2 || right.length < 2) return 0;
  const count = Math.min(left.length, right.length);
  const leftValues = left.slice(-count);
  const rightValues = right.slice(-count);
  const leftMean = leftValues.reduce((total, value) => total + value, 0) / count;
  const rightMean = rightValues.reduce((total, value) => total + value, 0) / count;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < count; index += 1) {
    const leftDelta =
      requirePortfolioInvariant(leftValues.at(index), `missing left value ${String(index)}`) - leftMean;
    const rightDelta =
      requirePortfolioInvariant(rightValues.at(index), `missing right value ${String(index)}`) - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? 0 : numerator / denominator;
}
