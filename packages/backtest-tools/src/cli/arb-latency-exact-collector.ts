import { ExactRational } from "@mm-crypto-bot/numeric";

import type { SupportedExchangeId } from "@mm-crypto-bot/exchange";

import {
  assertExactCcxtNumberMode,
  calculatePositiveMonotonicElapsedNanoseconds,
  captureMonotonicNanoseconds,
  decodeExactCcxtTicker,
  type MonotonicClock,
} from "./arb-latency-exact-boundary.js";
import {
  calculateExactDirectionalArbSpreads,
  type ExactExchangeQuote,
  type ExactSpreadOpportunity,
} from "./arb-latency-exact-calculations.js";

const EXACT_ZERO = ExactRational.from(0n);
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

/**
 * Bounds retained collector state to more than 30 seconds at a 500ms interval.
 */
export const MAXIMUM_EXACT_ARB_LATENCY_SAMPLES = 10_000;

export type ArbLatencyExactCollectorErrorCode =
  "CANCELLED" | "CLOCK" | "CLOSE" | "FACTORY" | "FETCH" | "INPUT" | "SLEEP" | "TIMEOUT";

export class ArbLatencyExactCollectorError extends Error {
  public constructor(
    public readonly code: ArbLatencyExactCollectorErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArbLatencyExactCollectorError";
  }
}

export class ArbLatencyExactCollectorDeadlineError extends Error {
  public constructor(
    public readonly code: "CANCELLED" | "TIMEOUT",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArbLatencyExactCollectorDeadlineError";
  }
}

export interface BoundedOperation<T> {
  readonly label: string;
  readonly remainingNanoseconds: bigint;
  readonly operation: (signal: AbortSignal, remainingNanoseconds: bigint) => Promise<T>;
}

export interface BoundedOperationExecutor {
  readonly execute: <T>(operation: BoundedOperation<T>) => Promise<T>;
}

export interface ExactCcxtTickerExchange {
  readonly number: unknown;
  readonly fetchTicker: (symbol: string, signal: AbortSignal) => Promise<unknown>;
  readonly close: (signal: AbortSignal) => Promise<void>;
}

export interface ExactCcxtTickerExchangeFactory {
  readonly createExchange: (
    exchangeId: SupportedExchangeId,
    signal: AbortSignal,
  ) => Promise<ExactCcxtTickerExchange>;
}

export interface EpochMillisecondsClock {
  readonly nowEpochMilliseconds: () => number;
}

export interface ExactArbLatencyCollectorDependencies {
  readonly exchangeFactory: ExactCcxtTickerExchangeFactory;
  readonly monotonicClock: MonotonicClock;
  readonly epochMillisecondsClock: EpochMillisecondsClock;
  readonly boundedOperationExecutor: BoundedOperationExecutor;
  readonly sleepNanoseconds: (nanoseconds: bigint, signal: AbortSignal) => Promise<void>;
}

export interface ExactArbLatencyCollectorInput {
  readonly exchangeA: SupportedExchangeId;
  readonly exchangeB: SupportedExchangeId;
  readonly symbol: string;
  readonly durationMs: number;
  readonly rttIntervalMs: number;
  readonly minSpreadBps: ExactRational;
}

export interface ExactArbLatencySpreadSample {
  readonly timestamp: number;
  readonly exchangeA: ExactExchangeQuote;
  readonly exchangeB: ExactExchangeQuote;
  readonly aSellBBuySpreadBps: ExactRational;
  readonly bSellABuySpreadBps: ExactRational;
  readonly maximumSpreadBps: ExactRational;
}

export interface ExactArbLatencyCollection {
  readonly samples: readonly ExactArbLatencySpreadSample[];
  readonly opportunities: readonly ExactSpreadOpportunity[];
  readonly observedDurationNs: bigint;
}

type CollectionAttempt =
  | Readonly<{ readonly kind: "failure"; readonly error: Error }>
  | Readonly<{ readonly kind: "success"; readonly collection: ExactArbLatencyCollection }>;

function fail(code: ArbLatencyExactCollectorErrorCode, message: string, cause?: unknown): never {
  throw new ArbLatencyExactCollectorError(code, message, cause);
}

function asError(error: unknown, code: ArbLatencyExactCollectorErrorCode, message: string): Error {
  return error instanceof Error ? error : new ArbLatencyExactCollectorError(code, message, error);
}

function requireSafePositiveInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("INPUT", `${fieldName} must be a positive safe integer.`);
  }
}

function requireCollectorInput(input: ExactArbLatencyCollectorInput): ExactRational {
  if (input.exchangeA === input.exchangeB || input.symbol.length === 0) {
    fail("INPUT", "Exchange identifiers must be distinct and the symbol must be nonempty.");
  }
  requireSafePositiveInteger(input.durationMs, "durationMs");
  requireSafePositiveInteger(input.rttIntervalMs, "rttIntervalMs");
  let minSpreadBps: ExactRational;
  try {
    minSpreadBps = ExactRational.requireAuthentic(input.minSpreadBps);
  } catch (error: unknown) {
    fail("INPUT", "minSpreadBps must be an authentic ExactRational.", error);
  }
  if (minSpreadBps.compare(EXACT_ZERO) < 0) {
    fail("INPUT", "minSpreadBps must be a nonnegative ExactRational.");
  }
  return minSpreadBps;
}

function toDurationNanoseconds(milliseconds: number): bigint {
  return BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
}

function readEpochMilliseconds(clock: EpochMillisecondsClock): number {
  let timestamp: unknown;
  try {
    timestamp = clock.nowEpochMilliseconds();
  } catch (error: unknown) {
    fail("CLOCK", "Epoch clock failed while reading a timestamp.", error);
  }
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0) {
    fail("CLOCK", "Epoch clock must return a nonnegative safe integer epoch millisecond value.");
  }
  return timestamp;
}

function remainingNanoseconds(
  clock: MonotonicClock,
  startedNanoseconds: bigint,
  durationNanoseconds: bigint,
): bigint {
  const currentNanoseconds = captureMonotonicNanoseconds(clock);
  if (currentNanoseconds < startedNanoseconds) {
    fail("CLOCK", "Monotonic clock moved backwards.");
  }
  return durationNanoseconds - (currentNanoseconds - startedNanoseconds);
}

async function executeBounded<T>(
  dependencies: ExactArbLatencyCollectorDependencies,
  startedNanoseconds: bigint,
  durationNanoseconds: bigint,
  label: string,
  isCleanup: boolean,
  operationFailureCode: ArbLatencyExactCollectorErrorCode,
  operation: (signal: AbortSignal, remainingNanoseconds: bigint) => Promise<T>,
): Promise<T> {
  let budgetNanoseconds: bigint;
  try {
    budgetNanoseconds = remainingNanoseconds(
      dependencies.monotonicClock,
      startedNanoseconds,
      durationNanoseconds,
    );
    if (budgetNanoseconds <= 0n) {
      fail("TIMEOUT", "Exact arbitrage latency collection deadline was reached.");
    }
  } catch (error: unknown) {
    if (!isCleanup) {
      throw error;
    }
    budgetNanoseconds = 1n;
  }
  try {
    const boundedOperation: BoundedOperation<T> = Object.freeze({
      label,
      remainingNanoseconds: budgetNanoseconds,
      operation,
    });
    return await dependencies.boundedOperationExecutor.execute(boundedOperation);
  } catch (error: unknown) {
    if (error instanceof ArbLatencyExactCollectorDeadlineError) {
      fail(error.code, `Bounded operation ${label} did not complete.`, error);
    }
    fail(operationFailureCode, `Bounded operation ${label} failed.`, error);
  }
}

async function createExactExchange(
  dependencies: ExactArbLatencyCollectorDependencies,
  startedNanoseconds: bigint,
  durationNanoseconds: bigint,
  exchangeId: SupportedExchangeId,
): Promise<ExactCcxtTickerExchange> {
  return executeBounded(
    dependencies,
    startedNanoseconds,
    durationNanoseconds,
    `factory:${exchangeId}`,
    false,
    "FACTORY",
    (signal) => dependencies.exchangeFactory.createExchange(exchangeId, signal),
  );
}

async function closeCreatedExchanges(
  dependencies: ExactArbLatencyCollectorDependencies,
  startedNanoseconds: bigint,
  durationNanoseconds: bigint,
  exchangeA: ExactCcxtTickerExchange | undefined,
  exchangeB: ExactCcxtTickerExchange | undefined,
): Promise<readonly Error[]> {
  const failures: Error[] = [];
  for (const exchange of [exchangeB, exchangeA]) {
    if (exchange === undefined) {
      continue;
    }
    try {
      await executeBounded(
        dependencies,
        startedNanoseconds,
        durationNanoseconds,
        "close",
        true,
        "CLOSE",
        (signal) => exchange.close(signal),
      );
    } catch (error: unknown) {
      failures.push(
        new ArbLatencyExactCollectorError("CLOSE", "Could not close exact CCXT exchange.", error),
      );
    }
  }
  return failures;
}

function combineFailures(primaryFailure: Error, cleanupFailures: readonly Error[]): Error;
function combineFailures(primaryFailure: undefined, cleanupFailures: readonly Error[]): Error | undefined;
function combineFailures(
  primaryFailure: Error | undefined,
  cleanupFailures: readonly Error[],
): Error | undefined {
  if (primaryFailure === undefined && cleanupFailures.length === 0) {
    return undefined;
  }
  if (primaryFailure !== undefined && cleanupFailures.length === 0) {
    return primaryFailure;
  }
  if (primaryFailure === undefined && cleanupFailures.length === 1) {
    return cleanupFailures[0];
  }
  return new AggregateError(
    primaryFailure === undefined ? cleanupFailures : [primaryFailure, ...cleanupFailures],
    "Exact arbitrage latency collection and cleanup failed.",
  );
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function createSample(
  timestamp: number,
  exchangeAId: SupportedExchangeId,
  exchangeBId: SupportedExchangeId,
  tickerA: unknown,
  tickerB: unknown,
): ExactArbLatencySpreadSample {
  const quoteA = decodeExactCcxtTicker(tickerA);
  const quoteB = decodeExactCcxtTicker(tickerB);
  const exchangeA: ExactExchangeQuote = Object.freeze({ id: exchangeAId, bid: quoteA.bid, ask: quoteA.ask });
  const exchangeB: ExactExchangeQuote = Object.freeze({ id: exchangeBId, bid: quoteB.bid, ask: quoteB.ask });
  const directionalSpreads = calculateExactDirectionalArbSpreads(exchangeA, exchangeB);
  return Object.freeze({
    timestamp,
    exchangeA,
    exchangeB,
    ...directionalSpreads,
  });
}

function provisionalOpportunity(sample: ExactArbLatencySpreadSample): ExactSpreadOpportunity {
  return Object.freeze({
    timestamp: sample.timestamp,
    exchangeA: sample.exchangeA,
    exchangeB: sample.exchangeB,
    crossSpreadBps: sample.maximumSpreadBps,
    profitableAfterLatency: false,
    theoreticalPnlUsd: EXACT_ZERO,
  });
}

/**
 * Collects exact spreads; all profitability remains provisional until latency recomputation.
 */
export async function collectExactArbLatency(
  input: ExactArbLatencyCollectorInput,
  dependencies: ExactArbLatencyCollectorDependencies,
): Promise<ExactArbLatencyCollection> {
  const minSpreadBps = requireCollectorInput(input);
  const durationNanoseconds = toDurationNanoseconds(input.durationMs);
  const startedNanoseconds = captureMonotonicNanoseconds(dependencies.monotonicClock);
  let exchangeA: ExactCcxtTickerExchange | undefined;
  let exchangeB: ExactCcxtTickerExchange | undefined;
  let attempt: CollectionAttempt;

  try {
    exchangeA = await createExactExchange(
      dependencies,
      startedNanoseconds,
      durationNanoseconds,
      input.exchangeA,
    );
    assertExactCcxtNumberMode(exchangeA);
    const initializedExchangeA = exchangeA;
    exchangeB = await createExactExchange(
      dependencies,
      startedNanoseconds,
      durationNanoseconds,
      input.exchangeB,
    );
    assertExactCcxtNumberMode(exchangeB);
    const initializedExchangeB = exchangeB;
    const samples: ExactArbLatencySpreadSample[] = [];
    const opportunities: ExactSpreadOpportunity[] = [];
    const intervalNanoseconds = toDurationNanoseconds(input.rttIntervalMs);

    for (;;) {
      if (remainingNanoseconds(dependencies.monotonicClock, startedNanoseconds, durationNanoseconds) <= 0n) {
        break;
      }
      if (samples.length >= MAXIMUM_EXACT_ARB_LATENCY_SAMPLES) {
        fail("INPUT", "Exact arbitrage latency collector sample limit was reached.");
      }
      const tickerA = await executeBounded(
        dependencies,
        startedNanoseconds,
        durationNanoseconds,
        `fetch:${input.exchangeA}:${input.symbol}`,
        false,
        "FETCH",
        (signal) => initializedExchangeA.fetchTicker(input.symbol, signal),
      );
      const tickerB = await executeBounded(
        dependencies,
        startedNanoseconds,
        durationNanoseconds,
        `fetch:${input.exchangeB}:${input.symbol}`,
        false,
        "FETCH",
        (signal) => initializedExchangeB.fetchTicker(input.symbol, signal),
      );
      const sample = createSample(
        readEpochMilliseconds(dependencies.epochMillisecondsClock),
        input.exchangeA,
        input.exchangeB,
        tickerA,
        tickerB,
      );
      samples.push(sample);
      if (sample.maximumSpreadBps.compare(minSpreadBps) >= 0) {
        opportunities.push(provisionalOpportunity(sample));
      }
      const remaining = remainingNanoseconds(
        dependencies.monotonicClock,
        startedNanoseconds,
        durationNanoseconds,
      );
      if (remaining <= 0n) {
        break;
      }
      await executeBounded(
        dependencies,
        startedNanoseconds,
        durationNanoseconds,
        "sleep",
        false,
        "SLEEP",
        (signal, currentRemainingNanoseconds) =>
          dependencies.sleepNanoseconds(minimum(intervalNanoseconds, currentRemainingNanoseconds), signal),
      );
    }
    const observedDurationNs = calculatePositiveMonotonicElapsedNanoseconds(
      startedNanoseconds,
      captureMonotonicNanoseconds(dependencies.monotonicClock),
    );
    attempt = Object.freeze({
      kind: "success",
      collection: Object.freeze({
        samples: Object.freeze(samples),
        opportunities: Object.freeze(opportunities),
        observedDurationNs,
      }),
    });
  } catch (error: unknown) {
    attempt = Object.freeze({
      kind: "failure",
      error: asError(error, "INPUT", "Exact collector failed with a non-error value."),
    });
  }

  const cleanupFailures = await closeCreatedExchanges(
    dependencies,
    startedNanoseconds,
    durationNanoseconds,
    exchangeA,
    exchangeB,
  );
  if (attempt.kind === "failure") {
    throw combineFailures(attempt.error, cleanupFailures);
  }
  const cleanupFailure = combineFailures(undefined, cleanupFailures);
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
  return attempt.collection;
}
