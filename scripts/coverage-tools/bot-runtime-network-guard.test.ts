/* eslint-disable security/detect-non-literal-fs-filename -- the raw directory is an exact repository-owned coverage path */
import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";

import { buildBotE2eChildEnvironment } from "./bot-e2e-child-environment.ts";
import { REPOSITORY_ROOT } from "./bot-runtime-scope.ts";
import {
  getInstalledOutboundNetworkGuard,
  OutboundNetworkAttemptError,
  installOutboundNetworkGuard,
} from "./bot-runtime-network-guard.ts";

function invokeBoundary(target: object, property: PropertyKey): void {
  const boundary: unknown = Object.getOwnPropertyDescriptor(target, property)?.value as unknown;
  if (typeof boundary !== "function") throw new Error(`missing test boundary: ${String(property)}`);
  Reflect.apply(boundary as (this: object) => unknown, target, []);
}

describe("runtime driver outbound network guard", () => {
  it("records and blocks intentional fetch, Node and Bun attempts", () => {
    const originalExitCode = process.exitCode;
    const guard = installOutboundNetworkGuard();
    try {
      expect(() => { void globalThis.fetch("https://network-attempt.invalid"); }).toThrow(OutboundNetworkAttemptError);
      expect(() => { invokeBoundary(http, "request"); }).toThrow(OutboundNetworkAttemptError);
      expect(() => { invokeBoundary(Bun, "connect"); }).toThrow(OutboundNetworkAttemptError);
      expect(guard.attempts).toEqual(["global.fetch", "node:http.request", "Bun.connect"]);
      expect(() => { guard.assertNoAttempts(); }).toThrow("bot E2E child attempted outbound network access");
    } finally {
      guard.restore();
      process.exitCode = originalExitCode ?? 0;
    }
  });

  it("installs idempotently and restores every patched boundary", () => {
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

  it("blocks three real spawned-child attempt paths before network I/O", () => {
    const preload = resolve(REPOSITORY_ROOT, "scripts/coverage-tools/bot-e2e-preload.ts");
    const fixture = resolve(REPOSITORY_ROOT, "scripts/coverage-tools/bot-runtime-network-negative-fixture.ts");
    const rawDirectory = resolve(REPOSITORY_ROOT, "apps/bot/coverage/e2e/raw");
    mkdirSync(rawDirectory, { recursive: true });
    const result = Bun.spawnSync({
      cmd: ["bun", "--preload", preload, fixture],
      cwd: REPOSITORY_ROOT,
      env: buildBotE2eChildEnvironment({
        ...process.env,
        BYBIT_API_KEY: "must-not-reach-child",
        BYBIT_API_SECRET: "must-not-reach-child",
        BYBIT_EU_ACCESS_TOKEN: "must-not-reach-child",
        CCXT_PASSWORD: "must-not-reach-child",
        EXCHANGE_PASSPHRASE: "must-not-reach-child",
      }, {
        MM_BOT_E2E_COVERAGE_RAW_DIR: rawDirectory,
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "network-negative",
      }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = new TextDecoder().decode(result.stderr);

    expect(result.exitCode).toBe(86);
    expect(stderr).toContain("credential environment absent before fixture evaluation");
    expect(stderr).toContain("blocked outbound attempt: global.fetch");
    expect(stderr).toContain("blocked outbound attempt: node:http.request");
    expect(stderr).toContain("blocked outbound attempt: Bun.connect");
    expect(stderr).toContain(
      "blocked attempt ledger: global.fetch, node:http.request, Bun.connect",
    );
  });
});
