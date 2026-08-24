import { describe, expect, it } from "vitest";

import { sanitizeLogRecord, serializeLogFields, serializeLogValue } from "./serialization.js";

describe("log serialization", () => {
  it("converts all scalar and bounded collection values to safe JSON values", () => {
    // eslint-disable-next-line unicorn/no-null -- this public serialization contract preserves explicit JSON null.
    expect(serializeLogValue(null)).toBeNull();
    expect(
      serializeLogFields({
        big: 123n,
        bool: true,
        fn: () => 0,
        missing: undefined,
        nan: NaN,
        number: 1.25,
        payload: "Bearer credential-value",
        secretToken: "must-not-appear",
        symbol: Symbol("secret"),
        text: "safe",
      }),
    ).toEqual({
      big: "123",
      bool: true,
      fn: "[FUNCTION]",
      missing: "[UNDEFINED]",
      nan: "[NON_FINITE_NUMBER]",
      number: "1.25",
      payload: "[REDACTED]",
      secretToken: "[REDACTED]",
      symbol: "[SYMBOL]",
      text: "safe",
    });
  });

  it("redacts recursively, handles cycles, and refuses accessor values", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const payload: object = {};
    Object.defineProperties(payload, {
      cycle: { enumerable: true, value: cycle },
      getter: {
        enumerable: true,
        get: () => {
          throw new Error("getter must not run");
        },
      },
      password: { enumerable: true, value: "hidden" },
    });
    expect(serializeLogFields({ payload })).toEqual({
      payload: { cycle: { self: "[CYCLE]" }, getter: "[UNREADABLE_VALUE]", password: "[REDACTED]" },
    });
  });

  it("serializes complete Error causes and protects unreadable proxies", () => {
    const root = new Error("root", { cause: new Error("cause") });
    Object.defineProperty(root, "stack", { configurable: true, value: "test-stack" });
    const unreadable = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("blocked");
        },
      },
    );
    const prototypeTrap = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("blocked");
        },
      },
    );
    const descriptorTrap = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("blocked");
        },
        ownKeys: () => ["blocked"],
      },
    );
    const serialized = serializeLogFields({ descriptorTrap, prototypeTrap, root, unreadable });
    expect(serialized).toMatchObject({
      descriptorTrap: "[UNREADABLE_OBJECT]",
      prototypeTrap: "[UNREADABLE_OBJECT]",
      root: {
        cause: { message: "cause", name: "Error" },
        message: "root",
        name: "Error",
      },
      unreadable: "[UNREADABLE_OBJECT]",
    });
    expect(JSON.stringify(serialized)).toContain("stack");
  });

  it("preserves a safe wrapper when the root field record cannot be enumerated", () => {
    const unreadableRoot = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("blocked");
        },
      },
    );
    expect(serializeLogFields(unreadableRoot)).toEqual({ fields: "[UNREADABLE_OBJECT]" });
  });

  it("bounds depth, array size, keys, and string size", () => {
    const deeplyNested: { child?: unknown } = {};
    let cursor = deeplyNested;
    for (let index = 0; index < 9; index += 1) {
      const child: { child?: unknown } = {};
      cursor.child = child;
      cursor = child;
    }
    const longText = "x".repeat(8193);
    expect(JSON.stringify(serializeLogValue(deeplyNested))).toContain("[TRUNCATED]");
    expect(serializeLogValue(Array.from({ length: 65 }, (_, index) => index))).toHaveLength(64);
    expect(serializeLogValue(longText)).toMatch(/\[TRUNCATED\]$/u);
    const manyKeys: Record<string, unknown> = {};
    for (let index = 0; index < 65; index += 1) {
      Object.defineProperty(manyKeys, `key${String(index)}`, {
        configurable: false,
        enumerable: true,
        value: index,
        writable: false,
      });
    }
    const serialized = serializeLogFields(manyKeys);
    expect(Object.keys(serialized)).toHaveLength(64);
  });

  it("bounds bigint conversion and oversized field names before JSON output", () => {
    const oversized = 10n ** 1024n;
    const oversizedKey = "x".repeat(129);
    expect(serializeLogValue(oversized)).toBe("[TRUNCATED]");
    expect(serializeLogValue(-oversized)).toBe("[TRUNCATED]");
    expect(serializeLogFields({ [oversizedKey]: "secret-value" })).toEqual({
      "[TRUNCATED_KEY_0]": "[REDACTED]",
    });
  });

  it("redacts delimiter-encoded credentials throughout nested error serialization", () => {
    const bearerSentinel = "bearer-sentinel";
    const secretSentinel = "secret-sentinel";
    const tokenSentinel = "token-sentinel";
    const apiKeySentinel = "api-key-sentinel";
    const credentialSentinel = "credential-sentinel";
    const authorizationSentinel = "authorization-sentinel";
    const nestedCause = new Error(`SeCrEt : ${secretSentinel}`, {
      cause: `Bearer    ${bearerSentinel}`,
    });
    Object.defineProperty(nestedCause, "stack", { value: `TOKEN\t${tokenSentinel}` });
    const error = new Error(`CREDENTIAL    ${credentialSentinel}`, { cause: nestedCause });
    Object.defineProperty(error, "stack", { value: `Authorization : ${authorizationSentinel}` });
    const serialized = serializeLogFields({ error, text: `API-Key = ${apiKeySentinel}` });

    expect(serialized).toEqual({
      error: {
        cause: {
          cause: "[REDACTED]",
          message: "[REDACTED]",
          name: "Error",
          stack: "[REDACTED]",
        },
        message: "[REDACTED]",
        name: "Error",
        stack: "[REDACTED]",
      },
      text: "[REDACTED]",
    });
    const serializedJson = JSON.stringify(serialized);
    for (const sentinel of [
      apiKeySentinel,
      authorizationSentinel,
      bearerSentinel,
      credentialSentinel,
      secretSentinel,
      tokenSentinel,
    ]) {
      expect(serializedJson).not.toContain(sentinel);
    }
  });

  it("redacts existing secret-shaped text in fields and error causes", () => {
    const error = new Error("token=credential-value", { cause: "sk-credential-value" });
    expect(serializeLogFields({ error, text: "ghp_credential-value" })).toMatchObject({
      error: { cause: "[REDACTED]", message: "[REDACTED]" },
      text: "[REDACTED]",
    });
  });

  it("redacts URL query credentials with encoded delimiters", () => {
    const accessTokenSentinel = "access-token-sentinel";
    const sessionSentinel = "jsession-sentinel";
    const serialized = serializeLogFields({
      accessUrl: `https://example.invalid/callback?access_token%3D${accessTokenSentinel}`,
      sessionUrl: `https://example.invalid/session?JSESSIONID%3d${sessionSentinel}`,
    });

    expect(serialized).toEqual({ accessUrl: "[REDACTED]", sessionUrl: "[REDACTED]" });
    const serializedJson = JSON.stringify(serialized);
    expect(serializedJson).not.toContain(accessTokenSentinel);
    expect(serializedJson).not.toContain(sessionSentinel);
  });

  it("redacts URL userinfo with literal and encoded delimiters", () => {
    const literalSentinel = "literal-userinfo-sentinel";
    const encodedSentinel = "encoded-userinfo-sentinel";
    const errorMessageSentinel = "error-message-userinfo-sentinel";
    const errorStackSentinel = "error-stack-userinfo-sentinel";
    const errorCauseSentinel = "error-cause-userinfo-sentinel";
    const nestedError = new Error(`https://${errorMessageSentinel}@example.invalid/message`, {
      cause: `HTTPS%3A%2F%2F${errorCauseSentinel}%40example.invalid%2Fcause`,
    });
    Object.defineProperty(nestedError, "stack", {
      value: `HTTPS%3A%2F%2F${errorStackSentinel}%40example.invalid%2Fstack`,
    });
    const serialized = serializeLogFields({
      encodedUrl: `HTTPS%3A%2F%2F${encodedSentinel}%40example.invalid`,
      error: nestedError,
      literalUrl: `https://${literalSentinel}@example.invalid/orders`,
      safeEmailText: "Contact alice@example.invalid for assistance.",
      safeEncodedFragment: "https%3A%2F%2Fexample.invalid%23alice%40example.invalid%ZZ",
      safeEncodedPath: "https%3A%2F%2Fexample.invalid%2Falice%40example.invalid%ZZ",
      safeEncodedQuery: "https%3A%2F%2Fexample.invalid%3Falice%40example.invalid%ZZ",
      safeEmptyUserinfo: "https://@example.invalid/orders",
      safeColonText: "https://example.invalid:443/orders owner: operator",
      safeFragment: "https://example.invalid#alice@example.invalid",
      safeQuery: "https://example.invalid?owner=alice@example.invalid",
      safeSpaceText: "https://example.invalid alice@example.invalid",
      safeAuthority: "https://example.invalid",
      safeUrl: "https://example.invalid/orders",
    });

    expect(serialized).toEqual({
      encodedUrl: "[REDACTED]",
      literalUrl: "[REDACTED]",
      error: {
        cause: "[REDACTED]",
        message: "[REDACTED]",
        name: "Error",
        stack: "[REDACTED]",
      },
      safeAuthority: "https://example.invalid",
      safeEmptyUserinfo: "https://@example.invalid/orders",
      safeEmailText: "Contact alice@example.invalid for assistance.",
      safeEncodedFragment: "https%3A%2F%2Fexample.invalid%23alice%40example.invalid%ZZ",
      safeEncodedPath: "https%3A%2F%2Fexample.invalid%2Falice%40example.invalid%ZZ",
      safeEncodedQuery: "https%3A%2F%2Fexample.invalid%3Falice%40example.invalid%ZZ",
      safeColonText: "https://example.invalid:443/orders owner: operator",
      safeFragment: "https://example.invalid#alice@example.invalid",
      safeQuery: "https://example.invalid?owner=alice@example.invalid",
      safeSpaceText: "https://example.invalid alice@example.invalid",
      safeUrl: "https://example.invalid/orders",
    });
    const serializedJson = JSON.stringify(serialized);
    for (const sentinel of [
      encodedSentinel,
      errorCauseSentinel,
      errorMessageSentinel,
      errorStackSentinel,
      literalSentinel,
    ]) {
      expect(serializedJson).not.toContain(sentinel);
    }
  });

  it("canonicalizes every record root while dropping unexpected properties", () => {
    const accessTokenSentinel = "root-access-token-sentinel";
    const cookieSentinel = "root-cookie-sentinel";
    const malformedRecord = {
      component: "logging-test",
      correlationId: "correlation-1",
      event: "logging.valid",
      fields: { payload: `https://example.invalid/?access_token=${accessTokenSentinel}` },
      level: "info",
      runId: "run-1",
      timestamp: "2026-08-18T00:00:00.000Z",
    };
    Object.defineProperties(malformedRecord, {
      component: {
        get: (): never => {
          throw new Error("component getter must not run");
        },
      },
      event: { value: `logging.${accessTokenSentinel}` },
      level: { value: "unexpected-level" },
      timestamp: { value: `https://example.invalid/?access_token=${accessTokenSentinel}` },
      unexpected: { enumerable: true, value: `Cookie: JSESSIONID=${cookieSentinel}` },
    });

    expect(sanitizeLogRecord(malformedRecord)).toEqual({
      component: "invalid",
      correlationId: "correlation-1",
      event: "logging.invalid.record",
      fields: { payload: "[REDACTED]" },
      level: "error",
      runId: "run-1",
      timestamp: "1970-01-01T00:00:00.000Z",
    });
    const sanitizedJson = JSON.stringify(sanitizeLogRecord(malformedRecord));
    expect(sanitizedJson).not.toContain(accessTokenSentinel);
    expect(sanitizedJson).not.toContain(cookieSentinel);
  });

  it("contains malformed root values without evaluating untrusted record descriptors", () => {
    const descriptorTrap = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("record descriptor blocked");
        },
      },
    );

    expect(serializeLogFields("unstructured root fields")).toEqual({ fields: "unstructured root fields" });
    expect(serializeLogValue("https://example.invalid/?access_token%ZZ")).toBe(
      "https://example.invalid/?access_token%ZZ",
    );
    expect(sanitizeLogRecord("not-a-record")).toMatchObject({
      component: "invalid",
      correlationId: "invalid",
      event: "logging.invalid.record",
      fields: { fields: "[UNREADABLE_VALUE]" },
      level: "error",
      runId: "invalid",
      timestamp: "1970-01-01T00:00:00.000Z",
    });
    expect(sanitizeLogRecord(descriptorTrap)).toMatchObject({
      component: "invalid",
      correlationId: "invalid",
      event: "logging.invalid.record",
      fields: { fields: "[UNREADABLE_VALUE]" },
      level: "error",
      runId: "invalid",
      timestamp: "1970-01-01T00:00:00.000Z",
    });
    for (const level of ["debug", "warn"]) {
      expect(
        sanitizeLogRecord({
          component: "",
          correlationId: "session-secret",
          event: "logging.access?token=secret",
          fields: {},
          level,
          runId: "x".repeat(129),
          timestamp: "not-a-timestamp",
        }),
      ).toMatchObject({
        component: "invalid",
        correlationId: "invalid",
        event: "logging.invalid.record",
        level,
        runId: "invalid",
        timestamp: "1970-01-01T00:00:00.000Z",
      });
    }
    expect(
      sanitizeLogRecord({
        component: "bad identifier",
        correlationId: "correlation-1",
        event: "logging.valid",
        fields: {},
        level: "info",
        runId: "run-1",
        timestamp: "2026-08-18T00:00:00.000Z",
      }),
    ).toMatchObject({ component: "invalid" });
    expect(
      sanitizeLogRecord({
        component: "logging-test",
        correlationId: "correlation-1",
        event: "logging..invalid",
        fields: {},
        level: "info",
        runId: "run-1",
        timestamp: "2026-08-18T00:00:00.000Z",
      }),
    ).toMatchObject({ event: "logging.invalid.record" });
  });

  it("redacts cookie and session delimiters throughout nested Error details", () => {
    const cookieSentinel = "cookie-sentinel";
    const sessionSentinel = "session-sentinel";
    const cookieHeaderSentinel = "set-cookie-sentinel";
    const nestedCause = new Error(`Set-Cookie: ${cookieHeaderSentinel}`, {
      cause: `{"SESSION_ID":"${sessionSentinel}"}`,
    });
    Object.defineProperty(nestedCause, "stack", { value: `Cookie=${cookieSentinel}` });
    const error = new Error("request failed", { cause: nestedCause });
    const serialized = serializeLogFields({ error, payload: `session = ${sessionSentinel}` });

    expect(serialized).toMatchObject({
      error: {
        cause: {
          cause: "[REDACTED]",
          message: "[REDACTED]",
          stack: "[REDACTED]",
        },
        message: "request failed",
      },
      payload: "[REDACTED]",
    });
    const serializedJson = JSON.stringify(serialized);
    for (const sentinel of [cookieSentinel, sessionSentinel, cookieHeaderSentinel]) {
      expect(serializedJson).not.toContain(sentinel);
    }
    expect(
      serializeLogFields({
        bareMessage: "cookie",
        policyMessage: "cookie policy accepted",
        lifecycleMessage: "session started successfully",
      }),
    ).toEqual({
      bareMessage: "cookie",
      policyMessage: "cookie policy accepted",
      lifecycleMessage: "session started successfully",
    });
  });
});
