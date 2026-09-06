import { isSupportedExchangeId, type SupportedExchangeId } from "@mm-crypto-bot/exchange";
import { type ExactRational } from "@mm-crypto-bot/numeric";

import {
  parseExactArbLatencyCliNumericInput,
  type ExactArbLatencyCliNumericInput,
} from "./arb-latency-exact-boundary.js";

const configErrorMessage = "Arbitrage latency CLI configuration is invalid.";
const defaultArguments = Object.freeze({
  durationMs: "30000",
  minSpreadBps: "5",
  outputPath: "arb-latency-sample.json",
  rttIntervalMs: "500",
  symbol: "BTC/USDT",
  tradeNotionalUsd: "10000",
});

export type ArbLatencyCliArgumentsErrorCode = "INVALID_ARB_LATENCY_CLI_ARGUMENTS";

/**
 * A stable failure boundary for arbitrage-latency CLI configuration.
 */
export class ArbLatencyCliArgumentsError extends Error {
  public readonly code: ArbLatencyCliArgumentsErrorCode = "INVALID_ARB_LATENCY_CLI_ARGUMENTS";

  public constructor(cause?: unknown) {
    super(configErrorMessage, cause === undefined ? undefined : { cause });
    this.name = "ArbLatencyCliArgumentsError";
  }
}

export interface ExactArbLatencyCliArguments {
  readonly exchangeA: SupportedExchangeId;
  readonly exchangeB: SupportedExchangeId;
  readonly symbol: string;
  readonly durationMs: number;
  readonly rttIntervalMs: number;
  readonly measureReconnect: boolean;
  readonly minSpreadBps: ExactRational;
  readonly tradeNotionalUsd: ExactRational;
  readonly outputPath: string;
  readonly source: ExactArbLatencyCliNumericInput["source"];
}

type ArgumentKey =
  | "exchangeA"
  | "exchangeB"
  | "symbol"
  | "durationMs"
  | "rttIntervalMs"
  | "minSpreadBps"
  | "tradeNotionalUsd"
  | "outputPath";

interface RawArguments {
  exchangeA: string;
  exchangeB: string;
  symbol: string;
  durationMs: string;
  rttIntervalMs: string;
  minSpreadBps: string;
  tradeNotionalUsd: string;
  outputPath: string;
}

function fail(cause?: unknown): never {
  throw new ArbLatencyCliArgumentsError(cause);
}

function readTokens(input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    fail();
  }
  const tokens: string[] = [];
  for (const token of input) {
    if (typeof token !== "string") {
      fail();
    }
    tokens.push(token);
  }
  return tokens;
}

function readArgumentKey(optionName: string): ArgumentKey | undefined {
  switch (optionName) {
    case "--exchange-a": {
      return "exchangeA";
    }
    case "--exchange-b": {
      return "exchangeB";
    }
    case "--symbol": {
      return "symbol";
    }
    case "--duration-ms": {
      return "durationMs";
    }
    case "--rtt-interval-ms": {
      return "rttIntervalMs";
    }
    case "--min-spread-bps": {
      return "minSpreadBps";
    }
    case "--trade-notional-usd": {
      return "tradeNotionalUsd";
    }
    case "--output": {
      return "outputPath";
    }
    default: {
      return undefined;
    }
  }
}

function validateSymbol(symbol: string): void {
  if (!/^[A-Z0-9]+\/[A-Z0-9]+$/u.test(symbol) || /\p{Cc}/u.test(symbol)) {
    fail();
  }
}

function validateRelativeOutputPath(outputPath: string): void {
  if (
    outputPath.length === 0 ||
    /\p{Cc}/u.test(outputPath) ||
    outputPath.startsWith("/") ||
    outputPath.includes("\\") ||
    /^[A-Za-z]:\//u.test(outputPath)
  ) {
    fail();
  }
  for (const segment of outputPath.split("/")) {
    if (segment === "." || segment === "..") {
      fail();
    }
  }
}

function assignArgument(raw: RawArguments, key: ArgumentKey, value: string): void {
  switch (key) {
    case "exchangeA": {
      raw.exchangeA = value;
      return;
    }
    case "exchangeB": {
      raw.exchangeB = value;
      return;
    }
    case "symbol": {
      raw.symbol = value;
      return;
    }
    case "durationMs": {
      raw.durationMs = value;
      return;
    }
    case "rttIntervalMs": {
      raw.rttIntervalMs = value;
      return;
    }
    case "minSpreadBps": {
      raw.minSpreadBps = value;
      return;
    }
    case "tradeNotionalUsd": {
      raw.tradeNotionalUsd = value;
      return;
    }
    case "outputPath": {
      raw.outputPath = value;
      return;
    }
  }
}

function parseValidatedArguments(input: unknown): ExactArbLatencyCliArguments {
  const raw: RawArguments = {
    ...defaultArguments,
    exchangeA: "",
    exchangeB: "",
  };
  const seen = new Set<string>();
  let isMeasureReconnect = true;
  let hasMeasureReconnect = false;
  let hasNoReconnect = false;

  for (const token of readTokens(input)) {
    if (token === "--measure-reconnect" || token === "--no-reconnect") {
      if (seen.has(token)) {
        fail();
      }
      seen.add(token);
      isMeasureReconnect = token === "--measure-reconnect";
      hasMeasureReconnect ||= isMeasureReconnect;
      hasNoReconnect ||= !isMeasureReconnect;
      continue;
    }
    const separatorIndex = token.indexOf("=");
    if (separatorIndex === -1 || !token.startsWith("--")) {
      fail();
    }
    const optionName = token.slice(0, separatorIndex);
    const key = readArgumentKey(optionName);
    if (key === undefined || seen.has(optionName)) {
      fail();
    }
    seen.add(optionName);
    assignArgument(raw, key, token.slice(separatorIndex + 1));
  }

  if (
    (hasMeasureReconnect && hasNoReconnect) ||
    raw.exchangeA === raw.exchangeB ||
    !isSupportedExchangeId(raw.exchangeA) ||
    !isSupportedExchangeId(raw.exchangeB)
  ) {
    fail();
  }
  validateSymbol(raw.symbol);
  validateRelativeOutputPath(raw.outputPath);
  const numeric = parseExactArbLatencyCliNumericInput({
    durationMs: raw.durationMs,
    minSpreadBps: raw.minSpreadBps,
    rttIntervalMs: raw.rttIntervalMs,
    tradeNotionalUsd: raw.tradeNotionalUsd,
  });
  return Object.freeze({
    durationMs: numeric.durationMs,
    exchangeA: raw.exchangeA,
    exchangeB: raw.exchangeB,
    measureReconnect: isMeasureReconnect,
    minSpreadBps: numeric.minSpreadBps,
    outputPath: raw.outputPath,
    rttIntervalMs: numeric.rttIntervalMs,
    source: numeric.source,
    symbol: raw.symbol,
    tradeNotionalUsd: numeric.tradeNotionalUsd,
  });
}

/**
 * Parses explicit tokens into immutable exact arbitrage-latency configuration.
 */
export function parseExactArbLatencyCliArguments(input: unknown): ExactArbLatencyCliArguments {
  try {
    return parseValidatedArguments(input);
  } catch (error: unknown) {
    if (error instanceof ArbLatencyCliArgumentsError) {
      throw error;
    }
    fail(error);
  }
}
