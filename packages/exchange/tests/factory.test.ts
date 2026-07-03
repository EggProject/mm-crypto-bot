// packages/exchange/tests/factory.test.ts — a `factory.ts` tesztjei
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  readExchangeCredentials,
  detectExchangeEnv,
  createExchangeClient,
  createMockFeed,
  MissingCredentialsError,
} from "../src/factory.js";
import { BybitEuFeed } from "../src/bybitEuFeed.js";
import { MockExchangeFeed } from "../src/mockFeed.js";

describe("factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];
    delete process.env["BUN_ENV"];
  });

  afterEach(() => {
    process.env = originalEnv;
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

  describe("detectExchangeEnv", () => {
    it("paper-t ad vissza, ha BUN_ENV nincs beállítva (fail-safe default)", () => {
      expect(detectExchangeEnv()).toBe("paper");
    });

    it("paper-t ad vissza, ha BUN_ENV = 'paper'", () => {
      process.env["BUN_ENV"] = "paper";
      expect(detectExchangeEnv()).toBe("paper");
    });

    it("live-ot ad vissza, ha BUN_ENV = 'live'", () => {
      process.env["BUN_ENV"] = "live";
      expect(detectExchangeEnv()).toBe("live");
    });

    it("paper-t ad vissza ismeretlen BUN_ENV értékre", () => {
      process.env["BUN_ENV"] = "weird";
      expect(detectExchangeEnv()).toBe("paper");
    });
  });

  describe("createExchangeClient", () => {
    it("MockExchangeFeed-et ad vissza, ha useMock = true", () => {
      const feed = createExchangeClient({ useMock: true });
      expect(feed).toBeInstanceOf(MockExchangeFeed);
    });

    it("BybitEuFeed-et ad vissza, ha useMock = false override opcióval", () => {
      const feed = createExchangeClient({
        useMock: false,
        override: { apiKey: "k", secret: "s" },
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("BybitEuFeed-et ad vissza, ha useMock = false és env-ben vannak kulcsok", () => {
      process.env["BYBIT_API_KEY"] = "k";
      process.env["BYBIT_API_SECRET"] = "s";
      const feed = createExchangeClient({ useMock: false });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("MissingCredentialsError-t dob, ha useMock = false és nincs kulcs", () => {
      expect(() => createExchangeClient({ useMock: false })).toThrow(MissingCredentialsError);
    });

    it("a BybitEuFeed exchangeId 'bybiteu'", () => {
      const feed = createExchangeClient({
        useMock: false,
        override: { apiKey: "k", secret: "s" },
      });
      expect(feed.exchangeId).toBe("bybiteu");
    });

    it("default rateLimitMs 100, ha nincs CCXT_RATE_LIMIT_MS", () => {
      delete process.env["CCXT_RATE_LIMIT_MS"];
      const feed = createExchangeClient({
        useMock: false,
        override: { apiKey: "k", secret: "s" },
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("explicit rateLimitMs-t használ, ha meg van adva", () => {
      const feed = createExchangeClient({
        useMock: false,
        override: { apiKey: "k", secret: "s" },
        rateLimitMs: 50,
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("explicit sandbox=false flag-et elfogad", () => {
      const feed = createExchangeClient({
        useMock: false,
        override: { apiKey: "k", secret: "s" },
        sandbox: false,
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("explicit sandbox=true flag-et elfogad", () => {
      const feed = createExchangeClient({
        useMock: false,
        override: { apiKey: "k", secret: "s" },
        sandbox: true,
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });
  });

  describe("createMockFeed", () => {
    it("üres opciókkal is működik", () => {
      const feed = createMockFeed();
      expect(feed).toBeInstanceOf(MockExchangeFeed);
    });

    it("opciókkal is működik", () => {
      const feed = createMockFeed({ exchangeId: "custom-mock" });
      expect(feed.exchangeId).toBe("custom-mock");
    });
  });
});
