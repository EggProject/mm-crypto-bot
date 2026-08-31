/**
 * Constructs real Bybit EU feeds for paper and live execution.
 * Paper mode uses real market data; test feeds remain test-only.
 */

import { ExchangeFeedError, type ExchangeFeed } from "./feed.js";
import { BybitEuFeed, type BybitEuFeedOptions } from "./bybit-eu-feed.js";

/**
 * Identifies the execution environment selected by `BUN_ENV`.
 */
export type ExchangeEnvironment = "paper" | "live";

/**
 * Contains API credentials supplied through environment variables.
 */
export interface ExchangeCredentials {
  readonly apiKey: string;
  readonly secret: string;
}

/**
 * Reads `BYBIT_API_KEY` and `BYBIT_API_SECRET`.
 *
 * Missing values fail closed with `MissingCredentialsError`.
 */
export function readExchangeCredentials(): ExchangeCredentials {
  const apiKey = process.env["BYBIT_API_KEY"];
  const secret = process.env["BYBIT_API_SECRET"];
  if (!apiKey || !secret) {
    throw new MissingCredentialsError();
  }
  return { apiKey, secret };
}

/**
 * Signals that required exchange credentials are unavailable.
 */
export class MissingCredentialsError extends Error {
  constructor() {
    super(
      "Hiányzó API hitelesítő adatok. Állítsd be a BYBIT_API_KEY és BYBIT_API_SECRET környezeti változókat a .env fájlban (lásd .env.example).",
    );
    this.name = "MissingCredentialsError";
  }
}

/**
 * Reads the execution environment from `BUN_ENV`.
 * Unknown and missing values select the fail-closed paper environment.
 */
export function detectExchangeEnvironment(): ExchangeEnvironment {
  const environment = process.env["BUN_ENV"];
  return environment === "live" ? "live" : "paper";
}

/**
 * Creates a real `BybitEuFeed` for paper or live execution.
 * Test feeds are not available through this production factory.
 */
export interface CreateExchangeClientOptions {
  readonly override?: ExchangeCredentials | undefined;
  readonly rateLimitMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export function createExchangeClient(options: CreateExchangeClientOptions): ExchangeFeed {
  assertApprovedBybitEuConfig(options);
  const credentials = options.override ?? readExchangeCredentials();
  const configuredRateLimit = process.env["CCXT_RATE_LIMIT_MS"] ?? "100";
  const integerPrefix = /^[+-]?\d+/u.exec(configuredRateLimit.trimStart());
  const environmentRateLimit = integerPrefix === null ? NaN : Number(integerPrefix[0]);
  const bybitOptions: BybitEuFeedOptions = {
    apiKey: credentials.apiKey,
    secret: credentials.secret,
    rateLimitMs: options.rateLimitMs ?? (Number.isFinite(environmentRateLimit) ? environmentRateLimit : 100),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
  };
  return new BybitEuFeed(bybitOptions);
}

function assertApprovedBybitEuConfig(options: object): void {
  const prohibitedFields = ["endpoint", "wsEndpoint", "sandbox"] as const;
  for (const field of prohibitedFields) {
    if (Reflect.get(options, field) !== undefined) {
      throw new ExchangeFeedError(
        `Bybit EU production configuration does not permit ${field} overrides`,
        undefined,
      );
    }
  }
}

/**
 * Re-export the concrete feed for consumers that require its public API.
 */
export { BybitEuFeed, type BybitEuFeedOptions } from "./bybit-eu-feed.js";
