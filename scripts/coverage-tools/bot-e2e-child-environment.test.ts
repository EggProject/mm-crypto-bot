import { describe, expect, it } from "bun:test";

import {
  buildBotE2eChildEnvironment,
  dropBotE2eCredentialsFromProcessEnvironment,
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
    const environment = buildBotE2eChildEnvironment({
      PATH: "/test/bin",
      EXCHANGE: "bybiteu",
      BYBIT_REGION: "EU",
      ...poisonedCredentials,
    }, {
      MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
      MM_BOT_E2E_CASE_ID: "credential-boundary",
    });

    expect(environment).toEqual({
      PATH: "/test/bin",
      EXCHANGE: "bybiteu",
      BYBIT_REGION: "EU",
      MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
      MM_BOT_E2E_CASE_ID: "credential-boundary",
    });
  });

  it("fails closed for non-contract overrides and cannot reintroduce a credential", () => {
    expect(() => buildBotE2eChildEnvironment({}, { HOME: "/unexpected" })).toThrow(
      "bot E2E child environment override is not allowed: HOME",
    );
    expect(() => buildBotE2eChildEnvironment({}, { BYBIT_API_KEY: "reintroduced" })).toThrow(
      "bot E2E child environment override is not allowed: BYBIT_API_KEY",
    );
  });

  it("uses the same predicate for preload-time defense in depth", () => {
    const environment: NodeJS.ProcessEnv = {
      EXCHANGE: "bybiteu",
      ...poisonedCredentials,
    };
    expect(dropBotE2eCredentialsFromProcessEnvironment(environment)).toEqual([
      "BYBIT_API_KEY",
      "BYBIT_API_SECRET",
      "BYBIT_EU_ACCESS_TOKEN",
      "CCXT_PASSWORD",
      "EXCHANGE_PASSPHRASE",
    ]);
    expect(environment).toEqual({ EXCHANGE: "bybiteu" });
    expect(isExchangeCredentialEnvironmentKey("UNRELATED_TOKEN")).toBe(false);
  });
});
