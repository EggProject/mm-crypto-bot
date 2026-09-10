import type { Symbol, Timeframe } from "./types.js";
import { TIMEFRAME_MS } from "@mm-crypto-bot/shared/types";

import { symbolOf } from "./symbols.js";

export interface OhlcStreamConfig {
  readonly timeframes: readonly Timeframe[];
  readonly bufferSize: number;
  readonly symbols: readonly Symbol[];
}

/**
 * Public, untrusted input accepted by the OhlcStream constructor.
 */
export interface OhlcStreamOptions {
  readonly timeframes?: unknown;
  readonly bufferSize?: unknown;
  readonly symbols?: unknown;
}

function freezeOhlcStreamConfig(
  timeframes: readonly Timeframe[],
  bufferSize: number,
  symbols: readonly Symbol[],
): OhlcStreamConfig {
  return Object.freeze({
    timeframes: Object.freeze([...timeframes]),
    bufferSize,
    symbols: Object.freeze([...symbols]),
  });
}

export const DEFAULT_OHLC_STREAM_CONFIG = freezeOhlcStreamConfig(
  ["1m", "5m", "15m", "1h", "4h", "1d"],
  1000,
  [symbolOf("BTC/USDC")],
);

const MAX_OHLC_STREAM_BUFFER_SIZE = 10_000;
const OHLC_STREAM_OPTION_KEYS = new Set<string>(["timeframes", "bufferSize", "symbols"]);
const TIMEFRAME_DURATIONS: Readonly<Record<Timeframe, number>> = {
  "1m": TIMEFRAME_MS["1m"],
  "5m": TIMEFRAME_MS["5m"],
  "15m": TIMEFRAME_MS["15m"],
  "1h": TIMEFRAME_MS["1h"],
  "4h": TIMEFRAME_MS["4h"],
  "1d": TIMEFRAME_MS["1d"],
};

function isOptionsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownOhlcStreamOptionKeys(options: Record<string, unknown>): void {
  for (const key of Object.getOwnPropertyNames(options)) {
    if (!OHLC_STREAM_OPTION_KEYS.has(key)) {
      throw new TypeError("OhlcStream options must contain only timeframes, bufferSize, and symbols");
    }
  }
  if (Object.getOwnPropertySymbols(options).length > 0) {
    throw new TypeError("OhlcStream options must contain only timeframes, bufferSize, and symbols");
  }
}

function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && Object.hasOwn(TIMEFRAME_DURATIONS, value);
}

export function parseOhlcStreamTimeframe(value: unknown): Timeframe {
  if (isTimeframe(value)) return value;
  throw new Error(`Unsupported timeframe: ${String(value)}`);
}

function normalizeTimeframes(value: unknown): readonly Timeframe[] {
  if (value === undefined) return DEFAULT_OHLC_STREAM_CONFIG.timeframes;
  if (!Array.isArray(value)) return [parseOhlcStreamTimeframe(value)];
  if (value.length === 0) throw new TypeError("OhlcStream timeframes must be a non-empty array");
  const timeframes: Timeframe[] = [];
  const seen = new Set<Timeframe>();
  for (const candidate of value) {
    const timeframe = parseOhlcStreamTimeframe(candidate);
    if (seen.has(timeframe)) throw new TypeError("OhlcStream timeframes must not contain duplicates");
    seen.add(timeframe);
    timeframes.push(timeframe);
  }
  return timeframes;
}

function normalizeSymbols(value: unknown): readonly Symbol[] {
  if (value === undefined) return DEFAULT_OHLC_STREAM_CONFIG.symbols;
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("OhlcStream symbols must be a non-empty array");
  }
  const symbols: Symbol[] = [];
  const seen = new Set<Symbol>();
  for (const candidate of value) {
    if (typeof candidate !== "string") {
      throw new TypeError("OhlcStream symbols must contain only supported strings");
    }
    const symbol = symbolOf(candidate);
    if (seen.has(symbol)) throw new TypeError("OhlcStream symbols must not contain duplicates");
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols;
}

function normalizeBufferSize(value: unknown): number {
  if (value === undefined) return DEFAULT_OHLC_STREAM_CONFIG.bufferSize;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_OHLC_STREAM_BUFFER_SIZE
  ) {
    throw new TypeError("OhlcStream bufferSize must be a positive safe integer no greater than 10000");
  }
  return value;
}

/**
 * Validates all public options before allocation or any feed interaction.
 */
export function normalizeOhlcStreamOptions(options: unknown): OhlcStreamConfig {
  if (!isOptionsRecord(options)) throw new TypeError("OhlcStream options must be an object");
  assertKnownOhlcStreamOptionKeys(options);
  return freezeOhlcStreamConfig(
    normalizeTimeframes(Object.hasOwn(options, "timeframes") ? options["timeframes"] : undefined),
    normalizeBufferSize(Object.hasOwn(options, "bufferSize") ? options["bufferSize"] : undefined),
    normalizeSymbols(Object.hasOwn(options, "symbols") ? options["symbols"] : undefined),
  );
}
