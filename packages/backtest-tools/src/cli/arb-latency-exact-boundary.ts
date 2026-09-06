import { canonicalizeExternalDecimal, ExactRational } from "@mm-crypto-bot/numeric";

const MAXIMUM_SAFE_INTEGER_AS_BIGINT = 9_007_199_254_740_991n;
const MINIMUM_DURATION_MS_AS_BIGINT = 1000n;

export type ArbLatencyBoundaryErrorCode =
  | "CCXT_NUMBER_MODE"
  | "CCXT_TICKER"
  | "CLI_DURATION"
  | "CLI_MIN_SPREAD"
  | "CLI_NOTIONAL"
  | "CLI_RTT_INTERVAL"
  | "MONOTONIC_CLOCK"
  | "MONOTONIC_ELAPSED";

export class ArbLatencyBoundaryError extends Error {
  public constructor(
    public readonly code: ArbLatencyBoundaryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArbLatencyBoundaryError";
  }
}

export interface ArbLatencyCliNumericInput {
  readonly tradeNotionalUsd: unknown;
  readonly minSpreadBps: unknown;
  readonly durationMs: unknown;
  readonly rttIntervalMs: unknown;
}

export interface ExactArbLatencyCliNumericInput {
  readonly tradeNotionalUsd: ExactRational;
  readonly minSpreadBps: ExactRational;
  readonly durationMs: number;
  readonly rttIntervalMs: number;
  readonly forcedDisconnectAtMs: number;
  readonly source: Readonly<{
    readonly tradeNotionalUsd: string;
    readonly minSpreadBps: string;
    readonly durationMs: string;
    readonly rttIntervalMs: string;
  }>;
}

export interface ExactCcxtTicker {
  readonly bid: ExactRational;
  readonly ask: ExactRational;
  readonly source: Readonly<{
    readonly bid: string;
    readonly ask: string;
  }>;
}

/**
 * A monotonic source used only for measuring elapsed durations.
 */
export interface MonotonicClock {
  readonly nowNanoseconds: () => bigint;
}

function fail(code: ArbLatencyBoundaryErrorCode, message: string, cause?: unknown): never {
  throw new ArbLatencyBoundaryError(code, message, cause);
}

function readOwnDataProperty(input: unknown, property: string, code: ArbLatencyBoundaryErrorCode): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail(code, "Boundary input must be an object with own data properties.");
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, property);
  } catch (error: unknown) {
    fail(code, "Boundary input could not be inspected safely.", error);
  }

  if (
    descriptor === undefined ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    !Object.hasOwn(descriptor, "value")
  ) {
    fail(code, `Boundary input property ${property} must be an own data property.`);
  }

  const value: unknown = descriptor.value;
  return value;
}

function parseCanonicalDecimal(
  input: unknown,
  code: "CLI_NOTIONAL" | "CLI_MIN_SPREAD",
): readonly [ExactRational, string] {
  if (typeof input !== "string") {
    fail(code, "CLI financial input must be a canonical decimal string.");
  }

  try {
    return [ExactRational.from(input), input];
  } catch (error: unknown) {
    fail(code, "CLI financial input must be a canonical decimal string.", error);
  }
}

function isCanonicalPositiveUnsignedIntegerString(input: string): boolean {
  if (input.length === 0 || input.startsWith("0")) {
    return false;
  }

  for (const character of input) {
    if (character < "0" || character > "9") {
      return false;
    }
  }
  return true;
}

function parsePositiveSafeInteger(
  input: unknown,
  code: "CLI_DURATION" | "CLI_RTT_INTERVAL",
): readonly [number, string] {
  if (typeof input !== "string") {
    fail(code, "CLI duration input must be a positive canonical unsigned integer string.");
  }
  if (!isCanonicalPositiveUnsignedIntegerString(input)) {
    fail(code, "CLI duration input must be a positive canonical unsigned integer string.");
  }

  const value = BigInt(input);
  if (value > MAXIMUM_SAFE_INTEGER_AS_BIGINT) {
    fail(code, "CLI duration input exceeds the maximum safe integer.");
  }

  return [Number(value), input];
}

/**
 * Parses the numeric CLI fields without admitting binary floating-point input.
 */
export function parseExactArbLatencyCliNumericInput(input: unknown): ExactArbLatencyCliNumericInput {
  const tradeNotionalUsdSource = readOwnDataProperty(input, "tradeNotionalUsd", "CLI_NOTIONAL");
  const minSpreadBpsSource = readOwnDataProperty(input, "minSpreadBps", "CLI_MIN_SPREAD");
  const durationMsSource = readOwnDataProperty(input, "durationMs", "CLI_DURATION");
  const rttIntervalMsSource = readOwnDataProperty(input, "rttIntervalMs", "CLI_RTT_INTERVAL");

  const [tradeNotionalUsd, tradeNotionalUsdCanonical] = parseCanonicalDecimal(
    tradeNotionalUsdSource,
    "CLI_NOTIONAL",
  );
  if (tradeNotionalUsd.isZero() || tradeNotionalUsd.isNegative()) {
    fail("CLI_NOTIONAL", "Trade notional USD must be greater than zero.");
  }

  const [minSpreadBps, minSpreadBpsCanonical] = parseCanonicalDecimal(minSpreadBpsSource, "CLI_MIN_SPREAD");
  if (minSpreadBps.isNegative()) {
    fail("CLI_MIN_SPREAD", "Minimum spread basis points must not be negative.");
  }

  const [durationMs, durationSource] = parsePositiveSafeInteger(durationMsSource, "CLI_DURATION");
  if (BigInt(durationSource) < MINIMUM_DURATION_MS_AS_BIGINT || durationMs % 2 !== 0) {
    fail("CLI_DURATION", "Duration must be at least 1000 milliseconds and even.");
  }

  const [rttIntervalMs, rttIntervalSource] = parsePositiveSafeInteger(
    rttIntervalMsSource,
    "CLI_RTT_INTERVAL",
  );
  return Object.freeze({
    tradeNotionalUsd,
    minSpreadBps,
    durationMs,
    rttIntervalMs,
    forcedDisconnectAtMs: durationMs / 2,
    source: Object.freeze({
      tradeNotionalUsd: tradeNotionalUsdCanonical,
      minSpreadBps: minSpreadBpsCanonical,
      durationMs: durationSource,
      rttIntervalMs: rttIntervalSource,
    }),
  });
}

function parsePositiveTickerPrice(input: unknown): readonly [ExactRational, string] {
  if (typeof input !== "string") {
    fail("CCXT_TICKER", "CCXT ticker prices must be string transport scalars.");
  }

  let canonical: string;
  try {
    canonical = canonicalizeExternalDecimal(input);
  } catch (error: unknown) {
    fail("CCXT_TICKER", "CCXT ticker price is not a valid decimal transport scalar.", error);
  }

  const price = ExactRational.from(canonical);
  if (price.isZero() || price.isNegative()) {
    fail("CCXT_TICKER", "CCXT ticker prices must be greater than zero.");
  }
  return [price, canonical];
}

/**
 * Decodes only CCXT ticker values produced through the exact String number mode.
 */
export function decodeExactCcxtTicker(input: unknown): ExactCcxtTicker {
  const bidSource = readOwnDataProperty(input, "bid", "CCXT_TICKER");
  const askSource = readOwnDataProperty(input, "ask", "CCXT_TICKER");
  const [bid, bidCanonical] = parsePositiveTickerPrice(bidSource);
  const [ask, askCanonical] = parsePositiveTickerPrice(askSource);
  return Object.freeze({
    bid,
    ask,
    source: Object.freeze({ bid: bidCanonical, ask: askCanonical }),
  });
}

/**
 * Returns the constructor option that makes CCXT preserve transport decimals as strings.
 */
export function createExactCcxtConstructorOptions(): Readonly<{ readonly number: StringConstructor }> {
  return Object.freeze({ number: String });
}

/**
 * Verifies that an instantiated CCXT exchange still returns numeric transport fields as strings.
 */
export function assertExactCcxtNumberMode(exchange: unknown): void {
  const numberMode = readOwnDataProperty(exchange, "number", "CCXT_NUMBER_MODE");
  if (numberMode !== String) {
    fail("CCXT_NUMBER_MODE", "CCXT exchange number mode must be exactly String.");
  }
}

export const defaultMonotonicClock: MonotonicClock = Object.freeze({
  nowNanoseconds: (): bigint => process.hrtime.bigint(),
});

function isUnknownClockFunction(input: unknown): input is () => unknown {
  return typeof input === "function";
}

/**
 * Captures one nonnegative nanosecond endpoint from an injected monotonic clock.
 */
export function captureMonotonicNanoseconds(clock: unknown): bigint {
  const nowNanoseconds = readOwnDataProperty(clock, "nowNanoseconds", "MONOTONIC_CLOCK");
  if (!isUnknownClockFunction(nowNanoseconds)) {
    fail("MONOTONIC_CLOCK", "Monotonic clock must expose an own nowNanoseconds function.");
  }

  let value: unknown;
  try {
    value = nowNanoseconds();
  } catch (error: unknown) {
    fail("MONOTONIC_CLOCK", "Monotonic clock failed while reading elapsed time.", error);
  }
  if (typeof value !== "bigint") {
    fail("MONOTONIC_CLOCK", "Monotonic clock must return bigint nanoseconds.");
  }
  if (value < 0n) {
    fail("MONOTONIC_CLOCK", "Monotonic clock must return nonnegative nanoseconds.");
  }
  return value;
}

/**
 * Calculates a strictly positive elapsed duration from two monotonic endpoints.
 */
export function calculatePositiveMonotonicElapsedNanoseconds(start: unknown, end: unknown): bigint {
  if (typeof start !== "bigint" || typeof end !== "bigint" || start < 0n || end < 0n || end <= start) {
    fail("MONOTONIC_ELAPSED", "Monotonic elapsed duration must be positive and nondecreasing.");
  }
  return end - start;
}
