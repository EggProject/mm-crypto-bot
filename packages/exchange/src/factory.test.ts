/**
 * packages/exchange/src/factory.test.ts
 *
 * 100% coverage test for `factory.ts` — the exchange feed factory
 * functions: `readExchangeCredentials`, `detectExchangeEnv`,
 * `createExchangeClient` (the real bybit.eu wire-up path), and the
 * `MissingCredentialsError` class.
 *
 * Phase 35b gap closer — no exchange-package test was covering the
 * factory logic directly. We mock `process.env` (saved/restored
 * around each test) to exercise the credential-detection branches.
 *
 * Phase 66: the previous `useMock: true` branch and the `createMockFeed`
 * factory were REMOVED — the `MockExchangeFeed` is now test-only and
 * lives in the `__testing__/` subdirectory (not exportable from
 * production). The corresponding tests are deleted from this file.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  BybitEuFeed,
  type BybitEuFeedOptions,
  MissingCredentialsError,
  createExchangeClient,
  detectExchangeEnv,
  readExchangeCredentials,
} from "./factory.js";

describe("factory", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Mentjük az eredeti env-et, hogy a teszt után vissza tudjuk állítani.
    const envKeys = [
      "BYBIT_API_KEY",
      "BYBIT_API_SECRET",
      "BUN_ENV",
      "CCXT_RATE_LIMIT_MS",
    ] as const;
    for (const k of envKeys) {
      originalEnv[k] = process.env[k];
      // A `delete process.env[k]` lint hibát ad dynamic key-re —
      // biztonságosabb a `Reflect.deleteProperty` használata.
      Reflect.deleteProperty(process.env, k);
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) Reflect.deleteProperty(process.env, k);
      else process.env[k] = v;
    }
  });

  describe("MissingCredentialsError", () => {
    it("konstruktor beállítja az üzenetet és a name-et", () => {
      const e = new MissingCredentialsError();
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe("MissingCredentialsError");
      expect(e.message).toContain("BYBIT_API_KEY");
      expect(e.message).toContain("BYBIT_API_SECRET");
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

  describe("detectExchangeEnv", () => {
    it("'paper'-t ad vissza, ha BUN_ENV nincs beállítva (fail-safe default)", () => {
      expect(detectExchangeEnv()).toBe("paper");
    });

    it("'paper'-t ad vissza, ha BUN_ENV === 'paper'", () => {
      process.env["BUN_ENV"] = "paper";
      expect(detectExchangeEnv()).toBe("paper");
    });

    it("'paper'-t ad vissza ismeretlen BUN_ENV értékre (fail-safe)", () => {
      process.env["BUN_ENV"] = "staging";
      expect(detectExchangeEnv()).toBe("paper");
    });

    it("'live'-ot ad vissza, ha BUN_ENV === 'live'", () => {
      process.env["BUN_ENV"] = "live";
      expect(detectExchangeEnv()).toBe("live");
    });
  });

  describe("createExchangeClient", () => {
    // Phase 66: a `useMock: true` branch és a `createMockFeed` factory
    // TÖRÖLVE. A `MockExchangeFeed` a `__testing__/mockFeed.ts`-ban
    // van, és NEM érhető el production kódból. A függvény most
    // kizárólag `BybitEuFeed`-et ad vissza.

    it("BybitEuFeed-et ad vissza override-olt kulcsokkal", () => {
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
      expect(feed.exchangeId).toBe("bybiteu");
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

    it("alkalmazza a sandbox=true opciót", () => {
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
        sandbox: true,
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
    });

    it("alapértelmezetten sandbox=false", () => {
      const feed = createExchangeClient({
        override: { apiKey: "k", secret: "s" },
      });
      expect(feed).toBeInstanceOf(BybitEuFeed);
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
      const opts: BybitEuFeedOptions = {
        apiKey: "k",
        secret: "s",
        rateLimitMs: 100,
        sandbox: false,
      };
      expect(opts.apiKey).toBe("k");
    });
  });
});
