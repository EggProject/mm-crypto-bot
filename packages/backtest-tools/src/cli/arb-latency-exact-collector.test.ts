import { describe, expect, it } from "vitest";
import { Script } from "node:vm";

import { ExactRational } from "@mm-crypto-bot/numeric";

import type { SupportedExchangeId } from "@mm-crypto-bot/exchange";

import {
  ArbLatencyExactCollectorDeadlineError,
  ArbLatencyExactCollectorError,
  collectExactArbLatency,
  MAXIMUM_EXACT_ARB_LATENCY_SAMPLES,
  type BoundedOperation,
  type ExactArbLatencyCollectorDependencies,
  type ExactArbLatencyCollectorInput,
  type ExactCcxtTickerExchange,
} from "./arb-latency-exact-collector.js";
import { ArbLatencyBoundaryError } from "./arb-latency-exact-boundary.js";

const MILLISECOND_NS = 1_000_000n;
const DEFAULT_TICKER_A = Object.freeze({ ask: "111", bid: "110" });
const DEFAULT_TICKER_B = Object.freeze({ ask: "101", bid: "100" });

interface HarnessOptions {
  readonly closeAFailure?: Error;
  readonly closeBFailure?: Error;
  readonly deadlineLabel?: string;
  readonly deadlineCode?: "CANCELLED" | "TIMEOUT";
  readonly advanceOnFetchB?: boolean;
  readonly advanceOnFactoryB?: boolean;
  readonly epoch?: number;
  readonly epochFailure?: Error;
  readonly factoryFailure?: Error;
  readonly fetchAFailure?: Error;
  readonly rawFetchAFailure?: boolean;
  readonly invalidModeA?: boolean;
  readonly monotonicNanosecondReadings?: readonly bigint[];
}

function input(
  overrides: Readonly<Partial<ExactArbLatencyCollectorInput>> = {},
): ExactArbLatencyCollectorInput {
  return {
    exchangeA: "binance",
    exchangeB: "bybit",
    symbol: "BTC/USDT",
    durationMs: 1,
    rttIntervalMs: 1,
    minSpreadBps: ExactRational.from(0n),
    ...overrides,
  };
}

function inputWithForeignRealmFailure(): ExactArbLatencyCollectorInput {
  const validInput = input();
  let minSpreadReads = 0;
  return {
    ...validInput,
    get minSpreadBps(): ExactRational {
      minSpreadReads += 1;
      if (minSpreadReads <= 2) {
        return validInput.minSpreadBps;
      }
      const script = new Script('throw new Error("foreign realm failure")');
      script.runInNewContext();
      throw new Error("Foreign realm failure script unexpectedly returned.");
    },
  };
}

function exchange(
  id: string,
  events: string[],
  ticker: unknown,
  closeFailure: Error | undefined,
  fetchFailure: Error | undefined,
  number: StringConstructor,
): ExactCcxtTickerExchange {
  return {
    number,
    fetchTicker: (symbol, signal) => {
      events.push(`fetch:${id}:${symbol}:${String(signal.aborted)}`);
      return fetchFailure === undefined ? Promise.resolve(ticker) : Promise.reject(fetchFailure);
    },
    close: (signal) => {
      events.push(`close:${id}:${String(signal.aborted)}`);
      return closeFailure === undefined ? Promise.resolve() : Promise.reject(closeFailure);
    },
  };
}

function harness(
  events: string[],
  tickerA: unknown = DEFAULT_TICKER_A,
  tickerB: unknown = DEFAULT_TICKER_B,
  options: HarnessOptions = {},
): ExactArbLatencyCollectorDependencies {
  let now = 0n;
  let monotonicReadingIndex = 0;
  const a = exchange("a", events, tickerA, options.closeAFailure, options.fetchAFailure, String);
  if (options.rawFetchAFailure) {
    Object.defineProperty(a, "fetchTicker", {
      configurable: true,
      value: (): Promise<unknown> => {
        const deferred = Promise.withResolvers<unknown>();
        const rawFailure: unknown = JSON.parse('"raw"');
        deferred.reject(rawFailure);
        return deferred.promise;
      },
    });
  }
  if (options.invalidModeA) {
    Object.defineProperty(a, "number", { configurable: true, value: Number });
  }
  const b = exchange("b", events, tickerB, options.closeBFailure, undefined, String);
  const execute = <T>(operation: BoundedOperation<T>): Promise<T> => {
    events.push(`bounded:${operation.label}:${operation.remainingNanoseconds.toString()}`);
    if (operation.label === options.deadlineLabel) {
      now = MILLISECOND_NS;
      return Promise.reject(
        new ArbLatencyExactCollectorDeadlineError(options.deadlineCode ?? "TIMEOUT", "deadline"),
      );
    }
    if (operation.label === "fetch:bybit:BTC/USDT" && options.advanceOnFetchB) {
      now = MILLISECOND_NS;
    }
    return operation.operation(new AbortController().signal, operation.remainingNanoseconds);
  };
  return {
    exchangeFactory: {
      createExchange: (id: SupportedExchangeId, signal: AbortSignal): Promise<ExactCcxtTickerExchange> => {
        events.push(`factory:${id}:${String(signal.aborted)}`);
        if (id === "bybit" && options.factoryFailure !== undefined) {
          return Promise.reject(options.factoryFailure);
        }
        if (id === "bybit" && options.advanceOnFactoryB) {
          now = MILLISECOND_NS;
        }
        return Promise.resolve(id === "binance" ? a : b);
      },
    },
    monotonicClock: {
      nowNanoseconds: (): bigint => {
        const configuredReading = options.monotonicNanosecondReadings?.at(monotonicReadingIndex);
        monotonicReadingIndex += 1;
        if (configuredReading !== undefined) {
          now = configuredReading;
        }
        return now;
      },
    },
    epochMillisecondsClock: {
      nowEpochMilliseconds: (): number => {
        if (options.epochFailure !== undefined) {
          throw options.epochFailure;
        }
        return options.epoch ?? 7;
      },
    },
    boundedOperationExecutor: {
      execute,
    },
    sleepNanoseconds: (nanoseconds: bigint, signal: AbortSignal): Promise<void> => {
      events.push(`sleep:${nanoseconds.toString()}:${String(signal.aborted)}`);
      now += nanoseconds;
      return Promise.resolve();
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected failure.");
}

async function collectFailure(
  dependencies: ExactArbLatencyCollectorDependencies,
  collectorInput: ExactArbLatencyCollectorInput = input(),
): Promise<unknown> {
  const collection = collectExactArbLatency(collectorInput, dependencies);
  return failure(collection);
}

function expectCode(error: unknown, code: string): ArbLatencyExactCollectorError {
  expect(error).toBeInstanceOf(ArbLatencyExactCollectorError);
  if (error instanceof ArbLatencyExactCollectorError) {
    expect(error.code).toBe(code);
    return error;
  }
  throw new Error("Expected collector error.");
}

describe("exact arb latency collector", () => {
  it("uses bounded signalled ports, exact asymmetric spreads, and immutable provisional opportunities", async () => {
    const events: string[] = [];
    const result = await collectExactArbLatency(
      input({ minSpreadBps: ExactRational.fromParts(180_000n, 211n) }),
      harness(events),
    );
    expect(result.observedDurationNs).toBe(MILLISECOND_NS);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]?.aSellBBuySpreadBps.toSnapshot()).toMatchObject({
      numerator: "180000",
      denominator: "211",
    });
    expect(result.samples[0]?.bSellABuySpreadBps.toSnapshot()).toMatchObject({
      numerator: "-220000",
      denominator: "211",
    });
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]?.profitableAfterLatency).toBe(false);
    expect(result.opportunities[0]?.theoreticalPnlUsd.equals(ExactRational.from(0n))).toBe(true);
    expect(Object.isFrozen(result.samples)).toBe(true);
    expect(Object.isFrozen(result.samples[0])).toBe(true);
    expect(events).toContain("bounded:sleep:1000000");
    expect(events).toContain("sleep:1000000:false");
    expect(events.slice(-4)).toEqual([
      "bounded:close:1",
      "close:b:false",
      "bounded:close:1",
      "close:a:false",
    ]);
    expect(new ArbLatencyExactCollectorError("INPUT", "direct").cause).toBeUndefined();
    expect(new ArbLatencyExactCollectorDeadlineError("TIMEOUT", "direct").cause).toBeUndefined();
    expect(
      new ArbLatencyExactCollectorDeadlineError("TIMEOUT", "caused", new Error("cause")).cause,
    ).toBeInstanceOf(Error);
    const rawFetchFailure = await collectFailure(
      harness([], undefined, undefined, { rawFetchAFailure: true }),
    );
    expectCode(rawFetchFailure, "FETCH");
  });

  it("caps sleep to remaining duration and selects the reverse direction only when it is maximum", async () => {
    const events: string[] = [];
    const result = await collectExactArbLatency(
      input({ durationMs: 1, rttIntervalMs: 2, minSpreadBps: ExactRational.from(3000n) }),
      harness(events, { bid: "100", ask: "101" }, { bid: "130", ask: "131" }),
    );
    expect(result.samples[0]?.maximumSpreadBps.toSnapshot()).toMatchObject({
      numerator: "580000",
      denominator: "231",
    });
    expect(result.opportunities).toHaveLength(0);
    expect(events).toContain("sleep:1000000:false");
  });

  it("derives the requested sleep from the executor current remaining budget", async () => {
    const events: string[] = [];
    const result = await collectExactArbLatency(
      input(),
      harness(events, undefined, undefined, {
        monotonicNanosecondReadings: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 500_000n, MILLISECOND_NS],
      }),
    );
    expect(events).toContain("bounded:sleep:500000");
    expect(events).toContain("sleep:500000:false");
    expect(events).not.toContain("sleep:1000000:false");
    expect(result.observedDurationNs).toBe(MILLISECOND_NS);
  });

  it("returns typed timeout and cancellation errors for non-settling bounded fetches and still cleans up", async () => {
    for (const code of ["TIMEOUT", "CANCELLED"] as const) {
      const events: string[] = [];
      const deadlineDependencies = harness(events, undefined, undefined, {
        deadlineLabel: "fetch:binance:BTC/USDT",
        deadlineCode: code,
      });
      const error = await collectFailure(deadlineDependencies);
      expectCode(error, code);
      expect(events).toContain("bounded:close:1");
      expect(events).toContain("close:a:false");
      expect(events).toContain("close:b:false");
    }
  });

  it("does not start a later fetch after the deadline and handles invalid input, clocks, factory, and decoding", async () => {
    const deadlineEvents: string[] = [];
    const deadlineDependencies = harness(deadlineEvents, undefined, undefined, {
      deadlineLabel: "fetch:binance:BTC/USDT",
    });
    const deadlineError = await collectFailure(deadlineDependencies);
    expectCode(deadlineError, "TIMEOUT");
    expect(deadlineEvents).not.toContain("bounded:fetch:bybit:BTC/USDT:1000000");

    const invalidEvents: string[] = [];
    const duplicateExchangeInput = input({ exchangeB: "binance" });
    const invalidError = await collectFailure(harness(invalidEvents), duplicateExchangeInput);
    expectCode(invalidError, "INPUT");
    expect(invalidEvents).toEqual([]);
    for (const invalidInput of [
      input({ durationMs: 0 }),
      input({ rttIntervalMs: Infinity }),
      input({ minSpreadBps: ExactRational.from("-1") }),
    ]) {
      const invalidInputError = await collectFailure(harness([]), invalidInput);
      expectCode(invalidInputError, "INPUT");
    }

    const factoryDependencies = harness([], undefined, undefined, {
      factoryFailure: new Error("factory"),
    });
    const factoryError = await collectFailure(factoryDependencies);
    expectCode(factoryError, "FACTORY");

    const invalidModeDependencies = harness([], undefined, undefined, { invalidModeA: true });
    const modeError = await collectFailure(invalidModeDependencies);
    expect(modeError).toBeInstanceOf(ArbLatencyBoundaryError);

    const invalidTickerDependencies = harness([], { bid: 1, ask: "2" });
    const decodeError = await collectFailure(invalidTickerDependencies);
    expect(decodeError).toBeInstanceOf(ArbLatencyBoundaryError);

    const clock = harness([]);
    const badClock = { ...clock, monotonicClock: { nowNanoseconds: (): bigint => -1n } };
    const badClockError = await collectFailure(badClock);
    expect(badClockError).toBeInstanceOf(ArbLatencyBoundaryError);
    const invalidEpochDependencies = harness([], undefined, undefined, { epoch: -1 });
    const invalidEpochError = await collectFailure(invalidEpochDependencies);
    expectCode(invalidEpochError, "CLOCK");
    const backwardsClock = harness([]);
    let calls = 0;
    const backwards = {
      ...backwardsClock,
      monotonicClock: {
        nowNanoseconds: (): bigint => {
          calls += 1;
          return calls === 1 ? 1n : 0n;
        },
      },
    };
    const backwardsError = await collectFailure(backwards);
    expectCode(backwardsError, "CLOCK");
    const expiredBeforeFetch = await collectExactArbLatency(
      input(),
      harness([], undefined, undefined, { advanceOnFactoryB: true }),
    );
    expect(expiredBeforeFetch.samples).toHaveLength(0);
    const failedEpochDependencies = harness([], undefined, undefined, {
      epochFailure: new Error("epoch"),
    });
    const failedEpochError = await collectFailure(failedEpochDependencies);
    expectCode(failedEpochError, "CLOCK");

    const foreignRealmFailure = await collectFailure(harness([]), inputWithForeignRealmFailure());
    const normalizedForeignRealmFailure = expectCode(foreignRealmFailure, "INPUT");
    expect(normalizedForeignRealmFailure.cause).not.toBeInstanceOf(Error);
  });

  it("aggregates cleanup failures in reverse resource order and preserves the primary failure", async () => {
    const primary = new Error("fetch");
    const closeAFailure = new Error("a");
    const closeBFailure = new Error("b");
    const events: string[] = [];
    const error = await failure(
      collectExactArbLatency(
        input(),
        harness(events, undefined, undefined, {
          fetchAFailure: primary,
          closeAFailure,
          closeBFailure,
        }),
      ),
    );
    expect(error).toBeInstanceOf(AggregateError);
    if (error instanceof AggregateError) {
      const primaryFailure = expectCode(error.errors[0], "FETCH");
      expect(primaryFailure.cause).toBe(primary);
      expectCode(error.errors[1], "CLOSE");
      expectCode(error.errors[2], "CLOSE");
    }
    expect(events.slice(-4)).toEqual([
      "bounded:close:1000000",
      "close:b:false",
      "bounded:close:1000000",
      "close:a:false",
    ]);
  });

  it("retains one cleanup failure and deadline cleanup failures as stable typed errors", async () => {
    const closeFailureDependencies = harness([], undefined, undefined, {
      closeBFailure: new Error("close"),
    });
    const oneCleanup = await collectFailure(closeFailureDependencies);
    expectCode(oneCleanup, "CLOSE");

    const deadlineCleanup = await failure(
      collectExactArbLatency(
        input(),
        harness([], undefined, undefined, { deadlineLabel: "close", deadlineCode: "CANCELLED" }),
      ),
    );
    expect(deadlineCleanup).toBeInstanceOf(AggregateError);
    const timeoutCleanup = await failure(
      collectExactArbLatency(input(), harness([], undefined, undefined, { deadlineLabel: "close" })),
    );
    expect(timeoutCleanup).toBeInstanceOf(AggregateError);

    const afterSampleEvents: string[] = [];
    const afterSample = await collectExactArbLatency(
      input(),
      harness(afterSampleEvents, undefined, undefined, { advanceOnFetchB: true }),
    );
    expect(afterSample.samples).toHaveLength(1);
    expect(afterSampleEvents).not.toContain("bounded:sleep:1000000");
  });

  it("fails before retained sample state could exceed the documented cap", async () => {
    const events: string[] = [];
    const error = await failure(
      collectExactArbLatency(input({ durationMs: MAXIMUM_EXACT_ARB_LATENCY_SAMPLES + 1 }), harness(events)),
    );
    expectCode(error, "INPUT");
    expect(events.filter((event) => event.startsWith("bounded:fetch:binance:BTC/USDT:"))).toHaveLength(
      MAXIMUM_EXACT_ARB_LATENCY_SAMPLES,
    );
  });
});
