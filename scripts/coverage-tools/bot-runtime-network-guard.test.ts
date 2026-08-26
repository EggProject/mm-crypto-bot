/* eslint-disable security/detect-non-literal-fs-filename -- the raw directory is an exact repository-owned coverage path */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";

import { describe, expect, it } from "bun:test";

import { buildBotE2eChildEnvironment as buildNetworkGuardChildEnvironment } from "./bot-e2e-child-environment.ts";
import { REPOSITORY_ROOT } from "./bot-runtime-scope.ts";
import {
  getInstalledOutboundNetworkGuard,
  OutboundNetworkAttemptError,
  type OutboundNetworkGuard,
  installOutboundNetworkGuard,
} from "./bot-runtime-network-guard.ts";

const GUARD_STATE_SYMBOL = Symbol.for("mm-crypto-bot.coverage.outbound-network-guard");

function restoreDescriptor(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    if (!Reflect.deleteProperty(target, property)) {
      throw new Error(`test fixture could not remove ${String(property)}`);
    }
    return;
  }
  Object.defineProperty(target, property, descriptor);
}

function requireConfigurableDescriptor(target: object, property: PropertyKey): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  if (!descriptor?.configurable) {
    throw new Error(`test boundary must be configurable: ${String(property)}`);
  }
  return descriptor;
}

function invokeBoundary(target: object, property: PropertyKey): void {
  const boundary: unknown = Object.getOwnPropertyDescriptor(target, property)?.value;
  if (typeof boundary !== "function") throw new Error(`missing test boundary: ${String(property)}`);
  Reflect.apply(boundary, target, []);
}

function constructBoundary(target: object, property: PropertyKey): void {
  const boundary: unknown = Object.getOwnPropertyDescriptor(target, property)?.value;
  if (typeof boundary !== "function") throw new Error(`missing test boundary: ${String(property)}`);
  Reflect.construct(boundary, []);
}

function callablePrototype(boundary: { readonly prototype: unknown }): object {
  const prototype = boundary.prototype;
  if (prototype === null || typeof prototype !== "object") {
    throw new Error("missing constructable boundary prototype");
  }
  return prototype;
}

function withNodeBunFixture<Result>(operation: () => Result): Result {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Bun");
  if (originalDescriptor?.value !== null && typeof originalDescriptor?.value === "object") {
    return operation();
  }

  // The global binding is immutable while the guard-owned boundary descriptors
  // remain configurable, matching the production patch-and-restore contract.
  const nodeBunFixture = {
    connect: function nodeBunConnectFixture(): never {
      throw new Error("node Bun compatibility fixture must be replaced by the network guard");
    },
    udpSocket: function nodeBunUdpSocketFixture(): never {
      throw new Error("node Bun compatibility fixture must be replaced by the network guard");
    },
  };
  Object.defineProperty(globalThis, "Bun", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: nodeBunFixture,
  });
  try {
    return operation();
  } finally {
    restoreDescriptor(globalThis, "Bun", originalDescriptor);
  }
}

function withGuardState<Result>(value: unknown, operation: () => Result): Result {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, GUARD_STATE_SYMBOL);
  Object.defineProperty(globalThis, GUARD_STATE_SYMBOL, {
    configurable: true,
    enumerable: false,
    writable: false,
    value,
  });
  try {
    return operation();
  } finally {
    restoreDescriptor(globalThis, GUARD_STATE_SYMBOL, originalDescriptor);
  }
}

function missingGuardMethodState(method: "assertNoAttempts" | "restore"): object {
  const guard = {
    attempts: [],
    installedBoundaries: [],
    assertNoAttempts: (): void => undefined,
    restore: (): void => undefined,
  };
  Reflect.deleteProperty(guard, method);
  return { schemaVersion: 1, guard };
}

function runNegativeNetworkChild(): ReturnType<typeof spawnSync> {
  const preload = path.resolve(REPOSITORY_ROOT, "scripts/coverage-tools/bot-e2e-preload.ts");
  const fixture = path.resolve(
    REPOSITORY_ROOT,
    "scripts/coverage-tools/bot-runtime-network-negative-fixture.ts",
  );
  const rawDirectory = path.resolve(REPOSITORY_ROOT, "apps/bot/coverage/e2e/raw");
  mkdirSync(rawDirectory, { recursive: true });
  return spawnSync("bun", ["--preload", preload, fixture], {
    cwd: REPOSITORY_ROOT,
    env: buildNetworkGuardChildEnvironment(
      {
        ...process.env,
        BYBIT_API_KEY: "must-not-reach-child",
        BYBIT_API_SECRET: "must-not-reach-child",
        BYBIT_EU_ACCESS_TOKEN: "must-not-reach-child",
        CCXT_PASSWORD: "must-not-reach-child",
        EXCHANGE_PASSPHRASE: "must-not-reach-child",
      },
      {
        MM_BOT_E2E_COVERAGE_RAW_DIR: rawDirectory,
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "network-negative",
      },
    ),
    encoding: "utf8",
  });
}

describe("runtime driver outbound network guard", () => {
  it("records and blocks intentional fetch, Node and Bun attempts", () => {
    withNodeBunFixture(() => {
      const originalExitCode = process.exitCode;
      const guard = installOutboundNetworkGuard();
      try {
        expect(() => {
          void globalThis.fetch("https://network-attempt.invalid");
        }).toThrow(OutboundNetworkAttemptError);
        expect(() => {
          invokeBoundary(http, "request");
        }).toThrow(OutboundNetworkAttemptError);
        expect(() => {
          invokeBoundary(Bun, "connect");
        }).toThrow(OutboundNetworkAttemptError);
        expect(guard.attempts).toEqual(["global.fetch", "node:http.request", "Bun.connect"]);
        expect(() => {
          guard.assertNoAttempts();
        }).toThrow("bot E2E child attempted outbound network access");
      } finally {
        guard.restore();
        process.exitCode = originalExitCode ?? 0;
      }
    });
  });

  it("installs idempotently and restores every patched boundary", () => {
    withNodeBunFixture(() => {
      const originalFetch = globalThis.fetch;
      const guard = installOutboundNetworkGuard();
      expect(installOutboundNetworkGuard()).toBe(guard);
      expect(getInstalledOutboundNetworkGuard()).toBe(guard);
      expect(guard.installedBoundaries).toContain("global.fetch");
      expect(guard.installedBoundaries).toContain("node:https.request");
      expect(guard.installedBoundaries).toContain("Bun.connect");
      guard.assertNoAttempts();
      guard.restore();
      guard.restore();
      expect(globalThis.fetch).toBe(originalFetch);
      expect(() => getInstalledOutboundNetworkGuard()).toThrow("was not installed by the bot E2E preload");
    });
  });

  it("keeps the WebSocket blocker constructable for capability detection while blocking calls", () => {
    withNodeBunFixture(() => {
      const originalExitCode = process.exitCode;
      const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
      if (originalDescriptor === undefined || typeof originalDescriptor.value !== "function") {
        throw new Error("global WebSocket is required for the bot E2E network guard");
      }
      const guard = installOutboundNetworkGuard();
      try {
        const installedBoundary: unknown = Object.getOwnPropertyDescriptor(globalThis, "WebSocket")?.value;
        if (typeof installedBoundary !== "function") {
          throw new TypeError("global WebSocket blocker was not installed as a function");
        }

        const prototype = callablePrototype(installedBoundary);
        expect(typeof Reflect.get(prototype, "ping")).toBe("undefined");
        expect(() => {
          invokeBoundary(globalThis, "WebSocket");
        }).toThrow(OutboundNetworkAttemptError);
        expect(() => {
          constructBoundary(globalThis, "WebSocket");
        }).toThrow(OutboundNetworkAttemptError);
        expect(guard.attempts).toEqual(["global.WebSocket", "global.WebSocket"]);
      } finally {
        guard.restore();
        process.exitCode = originalExitCode ?? 0;
      }

      expect(Object.getOwnPropertyDescriptor(globalThis, "WebSocket")).toEqual(originalDescriptor);
    });
  });

  it("rejects malformed public global guard state without exposing a raw cause", () => {
    const invalidStates: readonly unknown[] = [
      Object.getPrototypeOf(Object.prototype),
      1,
      { schemaVersion: 2, guard: missingGuardMethodState("restore") },
      { schemaVersion: 1, guard: { attempts: "invalid", installedBoundaries: [] } },
      { schemaVersion: 1, guard: { attempts: [], installedBoundaries: "invalid" } },
      missingGuardMethodState("assertNoAttempts"),
      missingGuardMethodState("restore"),
    ];
    for (const invalidState of invalidStates) {
      withGuardState(invalidState, () => {
        expect(() => getInstalledOutboundNetworkGuard()).toThrow(
          "outbound network guard global state is malformed",
        );
      });
    }
  });

  it("fails closed for a missing required boundary without retaining partial patches", () => {
    withNodeBunFixture(() => {
      const originalFetch = requireConfigurableDescriptor(globalThis, "fetch");
      const originalHttpRequest = requireConfigurableDescriptor(http, "request");
      const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
      Reflect.deleteProperty(http, "request");
      try {
        expect(() => installOutboundNetworkGuard()).toThrow(
          "network boundary is unavailable: node:http.request",
        );
        expect(Object.getOwnPropertyDescriptor(globalThis, "fetch")).toEqual(originalFetch);
        expect(Object.getOwnPropertyDescriptor(globalThis, "WebSocket")).toEqual(originalWebSocket);
        expect(() => getInstalledOutboundNetworkGuard()).toThrow("was not installed by the bot E2E preload");
      } finally {
        restoreDescriptor(http, "request", originalHttpRequest);
      }
    });
  });

  it("allows an unavailable optional WebSocket boundary without installing it", () => {
    withNodeBunFixture(() => {
      const originalWebSocket = requireConfigurableDescriptor(globalThis, "WebSocket");
      Reflect.deleteProperty(globalThis, "WebSocket");
      try {
        const guard = installOutboundNetworkGuard();
        expect(guard.installedBoundaries).not.toContain("global.WebSocket");
        guard.restore();
      } finally {
        restoreDescriptor(globalThis, "WebSocket", originalWebSocket);
      }
    });
  });

  it("supports a runtime without a Bun global boundary", () => {
    const originalBun = Object.getOwnPropertyDescriptor(globalThis, "Bun");
    if (originalBun !== undefined && !originalBun.configurable) {
      return;
    }
    Reflect.deleteProperty(globalThis, "Bun");
    try {
      const guard = installOutboundNetworkGuard();
      expect(guard.installedBoundaries).not.toContain("Bun.connect");
      guard.restore();
    } finally {
      restoreDescriptor(globalThis, "Bun", originalBun);
    }
  });

  it("preserves a later valid guard state while restoring its own boundaries", () => {
    withNodeBunFixture(() => {
      const originalState = Object.getOwnPropertyDescriptor(globalThis, GUARD_STATE_SYMBOL);
      const guard = installOutboundNetworkGuard();
      const replacementGuard: OutboundNetworkGuard = Object.freeze({
        attempts: [],
        installedBoundaries: [],
        assertNoAttempts: (): void => undefined,
        restore: (): void => undefined,
      });
      Object.defineProperty(globalThis, GUARD_STATE_SYMBOL, {
        configurable: true,
        enumerable: false,
        writable: false,
        value: { schemaVersion: 1, guard: replacementGuard },
      });
      try {
        guard.restore();
        expect(getInstalledOutboundNetworkGuard()).toBe(replacementGuard);
      } finally {
        restoreDescriptor(globalThis, GUARD_STATE_SYMBOL, originalState);
      }
    });
  });

  it("blocks three real spawned-child attempt paths before network I/O", () => {
    const result = runNegativeNetworkChild();
    if (result.error !== undefined) throw result.error;
    const stderr = result.stderr;

    expect(result.status).toBe(86);
    expect(stderr).toContain("credential environment absent before fixture evaluation");
    expect(stderr).toContain("blocked outbound attempt: global.fetch");
    expect(stderr).toContain("blocked outbound attempt: node:http.request");
    expect(stderr).toContain("blocked outbound attempt: Bun.connect");
    expect(stderr).toContain("blocked attempt ledger: global.fetch, node:http.request, Bun.connect");
  });
});
