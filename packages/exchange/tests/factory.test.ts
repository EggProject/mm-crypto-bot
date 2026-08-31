// packages/exchange/tests/factory.test.ts — a `factory.ts` tesztjei
// (vitest test, the `bun test` runner picks this up via the
// `bun test src tests` script in `package.json`).
//
// Phase 66: the previous `useMock: true` branch and the `createMockFeed`
// factory were REMOVED. The `MockExchangeFeed` is test-only and lives
// in the `__testing__/` subdirectory (NOT exportable from production).
// The corresponding `useMock: true` and `createMockFeed` tests are
// deleted from this file.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  readExchangeCredentials,
  detectExchangeEnvironment,
  createExchangeClient,
  MissingCredentialsError,
} from "../src/factory.js";
import { BybitEuFeed } from "../src/bybit-eu-feed.js";

describe("factory", () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];
    delete process.env["BUN_ENV"];
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  describe("readExchangeCredentials", () => {
    it("visszaadja a kulcsokat, ha mindkettő be van állítva", () => {
      process.env["BYBIT_API_KEY"] = "test-key";
      process.env["BYBIT_API_SECRET"] = "test-secret";
      const creds = readExchangeCredentials();
      expect(creds.apiKey).toBe("test-key");
      expect(creds.secret).toBe("test-secret");
    });

    it("MissingCredentialsError-t dob, ha BYBIT_API_KEY hiányzik", () => {
      process.env["BYBIT_API_SECRET"] = "test-secret";
      expect(() => readExchangeCredentials()).toThrow(MissingCredentialsError);
    });

    it("MissingCredentialsError-t dob, ha BYBIT_API_SECRET hiányzik", () => {
      process.env["BYBIT_API_KEY"] = "test-key";
      expect(() => readExchangeCredentials()).toThrow(MissingCredentialsError);
    });

    it("MissingCredentialsError-t dob, ha mindkettő hiányzik", () => {
      expect(() => readExchangeCredentials()).toThrow(MissingCredentialsError);
    });

    it("MissingCredentialsError-t dob, ha BYBIT_API_KEY üres string", () => {
      process.env["BYBIT_API_KEY"] = "";
      process.env["BYBIT_API_SECRET"] = "secret";
      expect(() => readExchangeCredentials()).toThrow(MissingCredentialsError);
    });
  });

  describe("detectExchangeEnvironment", () => {
    it("paper-t ad vissza, ha BUN_ENV nincs beállítva (fail-safe default)", () => {
      expect(detectExchangeEnvironment()).toBe("paper");
    });

    it("paper-t ad vissza, ha BUN_ENV = 'paper'", () => {
      process.env["BUN_ENV"] = "paper";
      expect(detectExchangeEnvironment()).toBe("paper");
    });

    it("live-ot ad vissza, ha BUN_ENV = 'live'", () => {
      process.env["BUN_ENV"] = "live";
      expect(detectExchangeEnvironment()).toBe("live");
    });

    it("paper-t ad vissza ismeretlen BUN_ENV értékre", () => {
      process.env["BUN_ENV"] = "weird";
      expect(detectExchangeEnvironment()).toBe("paper");
    });
  });

  describe("createExchangeClient", () => {
    // Phase 66: a `useMock: true` branch TÖRÖLVE — a `MockExchangeFeed`
    // a `__testing__/mockFeed.ts`-ban van, nem érhető el production
    // kódból. A `createExchangeClient` kizárólag `BybitEuFeed`-et ad.

    it("BybitEuFeed-et ad vissza override opcióval", () => {
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("BybitEuFeed-et ad vissza env-ben lévő kulcsokkal", () => {
      process.env["BYBIT_API_KEY"] = "k";
      process.env["BYBIT_API_SECRET"] = "s";
      const feed = createExchangeClient({});
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("MissingCredentialsError-t dob, ha nincs kulcs", () => {
      expect(() => createExchangeClient({})).toThrow(MissingCredentialsError);
    });

    it("a BybitEuFeed exchangeId 'bybiteu'", () => {
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
      });
      expect(feed.exchangeId).toBe("bybiteu");
    });

    it("default rateLimitMs 100, ha nincs CCXT_RATE_LIMIT_MS", () => {
      delete process.env["CCXT_RATE_LIMIT_MS"];
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("explicit rateLimitMs-t használ, ha meg van adva", () => {
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
        rateLimitMs: 50,
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it.each([
      ["endpoint", "https://rest.example.test"],
      ["endpoint", "https://api.bybit.com"],
      ["endpoint", "https://api.bybit.eu/v5"],
      ["endpoint", "ftp://api.bybit.eu"],
      ["wsEndpoint", "wss://stream.example.test"],
      ["wsEndpoint", "wss://stream.bybit.eu/v5"],
      ["wsEndpoint", "wss://stream.bybit.com"],
      ["sandbox", true],
    ] as const)("rejects %s before reading or routing credentials", (field, value) => {
      const options = {};
      Reflect.defineProperty(options, field, { enumerable: true, value });

      expect(() => createExchangeClient(options)).toThrow(
        `Bybit EU production configuration does not permit ${field} overrides`,
      );
    });
  });
});
