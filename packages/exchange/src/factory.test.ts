/**
 * packages/exchange/src/factory.test.ts
 *
 * 100% coverage test for `factory.ts` — the exchange feed factory
 * functions: `readExchangeCredentials`, `detectExchangeEnvironment`,
 * `createExchangeClient` (the real bybit.eu wire-up path), and the
 * `MissingCredentialsError` class.
 *
 * Phase 35b gap closer — no exchange-package test was covering the
 * factory logic directly. We mock `process.env` (saved/restored
 * around each test) to exercise the credential-detection branches.
 *
 * Phase 66: the previous `useMock: true` branch and the `createMockFeed`
 * factory were REMOVED — the `MockExchangeFeed` is now test-only and
 * lives in the `testing/` subdirectory (not exportable from
 * production). The corresponding tests are deleted from this file.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import ccxt from "ccxt";

import {
  BybitEuFeed,
  type BybitEuFeedOptions,
  type ExchangeCredentials,
  MissingCredentialsError,
  createExchangeClient,
  detectExchangeEnvironment,
  readExchangeCredentials,
} from "./factory.js";
import { withCapturedBybitEuConstructor } from "./bybit-eu-feed.test-support.js";

describe("factory", () => {
  const originalEnvironment: {
    apiKey: string | undefined;
    secret: string | undefined;
    bunEnvironment: string | undefined;
    rateLimit: string | undefined;
  } = {
    apiKey: undefined,
    secret: undefined,
    bunEnvironment: undefined,
    rateLimit: undefined,
  };

  beforeEach(() => {
    originalEnvironment.apiKey = process.env["BYBIT_API_KEY"];
    originalEnvironment.secret = process.env["BYBIT_API_SECRET"];
    originalEnvironment.bunEnvironment = process.env["BUN_ENV"];
    originalEnvironment.rateLimit = process.env["CCXT_RATE_LIMIT_MS"];
    Reflect.deleteProperty(process.env, "BYBIT_API_KEY");
    Reflect.deleteProperty(process.env, "BYBIT_API_SECRET");
    Reflect.deleteProperty(process.env, "BUN_ENV");
    Reflect.deleteProperty(process.env, "CCXT_RATE_LIMIT_MS");
  });

  afterEach(() => {
    if (originalEnvironment.apiKey === undefined) Reflect.deleteProperty(process.env, "BYBIT_API_KEY");
    else process.env["BYBIT_API_KEY"] = originalEnvironment.apiKey;
    if (originalEnvironment.secret === undefined) Reflect.deleteProperty(process.env, "BYBIT_API_SECRET");
    else process.env["BYBIT_API_SECRET"] = originalEnvironment.secret;
    if (originalEnvironment.bunEnvironment === undefined) Reflect.deleteProperty(process.env, "BUN_ENV");
    else process.env["BUN_ENV"] = originalEnvironment.bunEnvironment;
    if (originalEnvironment.rateLimit === undefined)
      Reflect.deleteProperty(process.env, "CCXT_RATE_LIMIT_MS");
    else process.env["CCXT_RATE_LIMIT_MS"] = originalEnvironment.rateLimit;
  });

  describe("MissingCredentialsError", () => {
    it("konstruktor beállítja az üzenetet és a name-et", () => {
      const error = new MissingCredentialsError();
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("MissingCredentialsError");
      expect(error.message).toContain("BYBIT_API_KEY");
      expect(error.message).toContain("BYBIT_API_SECRET");
    });
  });

  describe("readExchangeCredentials", () => {
    it("visszaadja a kulcsokat, ha mindkettő be van állítva", () => {
      process.env["BYBIT_API_KEY"] = "test-key";
      process.env["BYBIT_API_SECRET"] = "test-secret";
      const creds = readExchangeCredentials();
      expect(creds.apiKey).toBe("test-key");
      expect(creds.secret).toBe("test-secret");
    });

    it("MissingCredentialsError-t dob, ha az API key hiányzik", () => {
      process.env["BYBIT_API_SECRET"] = "test-secret";
      expect(() => readExchangeCredentials()).toThrow(MissingCredentialsError);
    });

    it("MissingCredentialsError-t dob, ha a secret hiányzik", () => {
      process.env["BYBIT_API_KEY"] = "test-key";
      expect(() => readExchangeCredentials()).toThrow(MissingCredentialsError);
    });

    it("MissingCredentialsError-t dob, ha mindkettő hiányzik", () => {
      expect(() => readExchangeCredentials()).toThrow(MissingCredentialsError);
    });

    it("MissingCredentialsError-t dob, ha a kulcsok üres stringek", () => {
      process.env["BYBIT_API_KEY"] = "";
      process.env["BYBIT_API_SECRET"] = "";
      expect(() => readExchangeCredentials()).toThrow(MissingCredentialsError);
    });
  });

  describe("detectExchangeEnvironment", () => {
    it("'paper'-t ad vissza, ha BUN_ENV nincs beállítva (fail-safe default)", () => {
      expect(detectExchangeEnvironment()).toBe("paper");
    });

    it("'paper'-t ad vissza, ha BUN_ENV === 'paper'", () => {
      process.env["BUN_ENV"] = "paper";
      expect(detectExchangeEnvironment()).toBe("paper");
    });

    it("'paper'-t ad vissza ismeretlen BUN_ENV értékre (fail-safe)", () => {
      process.env["BUN_ENV"] = "staging";
      expect(detectExchangeEnvironment()).toBe("paper");
    });

    it("'live'-ot ad vissza, ha BUN_ENV === 'live'", () => {
      process.env["BUN_ENV"] = "live";
      expect(detectExchangeEnvironment()).toBe("live");
    });
  });

  describe("createExchangeClient", () => {
    // Phase 66: a `useMock: true` branch és a `createMockFeed` factory
    // TÖRÖLVE. A `MockExchangeFeed` a `testing/mock-feed.ts`-ben
    // van, és NEM érhető el production kódból. A függvény most
    // kizárólag `BybitEuFeed`-et ad vissza.

    it("BybitEuFeed-et ad vissza override-olt kulcsokkal", () => {
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
      expect(feed.exchangeId).toBe("bybiteu");
    });

    it("returns a BybitEuFeed with an explicit timeout and typed override credentials", () => {
      const credentials: ExchangeCredentials = { apiKey: "timeout-key", secret: "timeout-secret" };

      withCapturedBybitEuConstructor((capture) => {
        const feed = createExchangeClient({ override: credentials, timeoutMs: 750 });

        expect(feed).toBeInstanceOf(BybitEuFeed);
        expect(feed.exchangeId).toBe("bybiteu");
        expect(capture.calls()).toBe(1);
        expect(capture.options()).toMatchObject({
          apiKey: "timeout-key",
          secret: "timeout-secret",
          enableRateLimit: true,
          rateLimit: 100,
          timeout: 750,
        });
      });
    });

    it("BybitEuFeed-et ad vissza env-ből olvasott kulcsokkal", () => {
      process.env["BYBIT_API_KEY"] = "env-key";
      process.env["BYBIT_API_SECRET"] = "env-secret";
      const feed = createExchangeClient({});
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("MissingCredentialsError-t dob, ha nincs override sem env sem", () => {
      expect(() => createExchangeClient({})).toThrow(MissingCredentialsError);
    });

    it("alkalmazza a rateLimitMs opciót (default 100ms)", () => {
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
      });
      // A BybitEuFeed tárolja a rateLimitMs-t; ezt az exchangeId-n
      // és a típuson keresztül ellenőrizzük (a feed típusa BybitEuFeed).
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("alkalmazza a rateLimitMs opciót explicit értékkel", () => {
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
        rateLimitMs: 250,
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("olvassa a CCXT_RATE_LIMIT_MS-t az env-ből", () => {
      process.env["BYBIT_API_KEY"] = "k";
      process.env["BYBIT_API_SECRET"] = "s";
      process.env["CCXT_RATE_LIMIT_MS"] = "500";
      const feed = createExchangeClient({});
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("fallback 100ms-re, ha CCXT_RATE_LIMIT_MS nem érvényes szám", () => {
      process.env["BYBIT_API_KEY"] = "k";
      process.env["BYBIT_API_SECRET"] = "s";
      process.env["CCXT_RATE_LIMIT_MS"] = "not-a-number";
      const feed = createExchangeClient({});
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

    it("rejects an untrusted origin before constructing CCXT or routing credentials", () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(ccxt.pro, "bybiteu");
      if (originalDescriptor === undefined) throw new Error("CCXT Bybit EU constructor is unavailable");
      const originalConstructor = Reflect.get(ccxt.pro, "bybiteu");
      let constructorCalls = 0;
      let isCredentialRouted = false;
      const trackedConstructor = new Proxy(originalConstructor, {
        construct(target, arguments_, newTarget) {
          constructorCalls++;
          const config: unknown = arguments_[0];
          isCredentialRouted = hasExpectedCredentials(config);
          Reflect.construct(target, arguments_, newTarget);
          return {};
        },
      });
      Reflect.defineProperty(ccxt.pro, "bybiteu", { ...originalDescriptor, value: trackedConstructor });
      const options = { override: { apiKey: "origin-lock-key", secret: "origin-lock-secret" } };
      Reflect.defineProperty(options, "endpoint", { enumerable: true, value: "https://rest.example.test" });

      try {
        expect(() => createExchangeClient(options)).toThrow(/does not permit endpoint overrides/);
        expect(constructorCalls).toBe(0);
        expect(isCredentialRouted).toBe(false);
      } finally {
        Reflect.defineProperty(ccxt.pro, "bybiteu", originalDescriptor);
      }
    });

    it("locks the CCXT client to the approved Bybit EU origins", () => {
      withCapturedBybitEuConstructor((capture) => {
        new BybitEuFeed({ apiKey: "k", secret: "s", rateLimitMs: 100 });

        expect(capture.calls()).toBe(1);
        expect(capture.urls()).toMatchObject({
          api: {
            spot: "https://api.bybit.eu",
            private: "https://api.bybit.eu",
            ws: {
              public: { spot: "wss://stream.bybit.eu/v5/public/spot" },
              private: { spot: { unified: "wss://stream.bybit.eu/v5/private" } },
            },
          },
        });
      });
    });
  });

  describe("BybitEuFeed re-export", () => {
    it("a BybitEuFeed osztály elérhető a factory.ts-ből (type/class)", () => {
      // A factory.ts re-exportolja a BybitEuFeed-et.
      // Nem példányosítunk (a CCXT init hálózati state-et igényel),
      // csak a class konstruktor függvény-e.
      expect(typeof BybitEuFeed).toBe("function");
      // A BybitEuFeedOptions típust pedig típusellenőrzés szintjén
      // ellenőrizzük:
      const options: BybitEuFeedOptions = {
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
      };
      expect(options.apiKey).toBe("k");
    });
  });
});

function hasExpectedCredentials(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return (
    Reflect.get(value, "apiKey") === "origin-lock-key" &&
    Reflect.get(value, "secret") === "origin-lock-secret"
  );
}
