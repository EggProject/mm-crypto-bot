import { describe, expect, it } from "bun:test";

import {
  buildBotE2EChildEnvironment,
  dropBotE2ECredentialsFromProcessEnvironment,
  isExchangeCredentialEnvironmentKey,
} from "./bot-e2e-child-environment.ts";

const poisonedCredentials = {
  BYBIT_API_KEY: "parent-key",
  BYBIT_API_SECRET: "parent-secret",
  BYBIT_EU_ACCESS_TOKEN: "parent-token",
  CCXT_PASSWORD: "parent-password",
  EXCHANGE_PASSPHRASE: "parent-passphrase",
};

describe("bot E2E child environment boundary", () => {
  it("drops Bybit and exchange credential variants while retaining non-secret context", () => {
    const environment = buildBotE2EChildEnvironment(
      {
        PATH: "/test/bin",
        EXCHANGE: "bybiteu",
        BYBIT_REGION: "EU",
        ...poisonedCredentials,
      },
      {
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "credential-boundary",
      },
    );

    expect(environment).toEqual({
      PATH: "/test/bin",
      EXCHANGE: "bybiteu",
      BYBIT_REGION: "EU",
      MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
      MM_BOT_E2E_CASE_ID: "credential-boundary",
    });
  });

  it("fails closed for non-contract overrides and cannot reintroduce a credential", () => {
    expect(() => buildBotE2EChildEnvironment({}, { HOME: "/unexpected" })).toThrow(
      "bot E2E child environment override is not allowed: HOME",
    );
    expect(() => buildBotE2EChildEnvironment({}, { BYBIT_API_KEY: "reintroduced" })).toThrow(
      "bot E2E child environment override is not allowed: BYBIT_API_KEY",
    );
  });

  it("uses the same predicate for preload-time defense in depth", () => {
    const environment: NodeJS.ProcessEnv = {
      EXCHANGE: "bybiteu",
      ...poisonedCredentials,
    };
    expect(dropBotE2ECredentialsFromProcessEnvironment(environment)).toEqual([
      "BYBIT_API_KEY",
      "BYBIT_API_SECRET",
      "BYBIT_EU_ACCESS_TOKEN",
      "CCXT_PASSWORD",
      "EXCHANGE_PASSPHRASE",
    ]);
    expect(environment).toEqual({ EXCHANGE: "bybiteu" });
    expect(isExchangeCredentialEnvironmentKey("UNRELATED_TOKEN")).toBe(false);
    expect(isExchangeCredentialEnvironmentKey("BYBIT_REGION")).toBe(false);
    expect(isExchangeCredentialEnvironmentKey("CCXT_APIKEY")).toBe(true);
  });

  it("accepts every explicit override and removes an allowed inherited value", () => {
    expect(
      buildBotE2EChildEnvironment(
        { MM_BOT_E2E_ENTRY: "old", UNSET: undefined },
        {
          MM_BOT_E2E_CASE_ID: "case",
          MM_BOT_E2E_COVERAGE_PRELOAD: "preload",
          MM_BOT_E2E_COVERAGE_RAW_DIR: "raw",
          MM_BOT_E2E_ENTRY: undefined,
          MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
          MM_BOT_E2E_START_MODULE: "start",
        },
      ),
    ).toEqual({
      MM_BOT_E2E_CASE_ID: "case",
      MM_BOT_E2E_COVERAGE_PRELOAD: "preload",
      MM_BOT_E2E_COVERAGE_RAW_DIR: "raw",
      MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
      MM_BOT_E2E_START_MODULE: "start",
    });
  });
});
