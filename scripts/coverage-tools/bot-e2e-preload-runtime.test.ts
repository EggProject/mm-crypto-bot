import { describe, expect, it } from "bun:test";

import {
  createBotE2EPreloadRuntimeState,
  installBotE2EPreloadRuntime,
  type BotE2EPreloadRuntimePorts,
} from "./bot-e2e-preload-runtime.ts";

const REPOSITORY_ROOT = "/repository";
const RAW_DIRECTORY = "/repository/apps/bot/coverage/e2e/raw";

function resolvePath(...segments: readonly string[]): string {
  return segments.join("/").replaceAll("//", "/");
}

function createPorts({
  attempts = [],
  coverage,
  environment = {
    MM_BOT_E2E_COVERAGE_RAW_DIR: RAW_DIRECTORY,
    MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
    MM_BOT_E2E_CASE_ID: "network-negative",
  },
  exitCode,
}: {
  readonly attempts?: readonly string[];
  readonly coverage?: unknown;
  readonly environment?: NodeJS.ProcessEnv;
  readonly exitCode?: number;
} = {}): {
  readonly beforeExitListeners: readonly (() => void)[];
  readonly calls: readonly string[];
  readonly errors: readonly string[];
  readonly exitCodes: readonly number[];
  readonly exitListeners: readonly (() => void)[];
  readonly mkdirDirectories: readonly string[];
  readonly ports: BotE2EPreloadRuntimePorts;
  readonly writes: readonly {
    readonly contents: string;
    readonly options: { readonly encoding: "utf8"; readonly flag: "wx"; readonly mode: 0o600 };
    readonly path: string;
  }[];
} {
  const beforeExitListeners: (() => void)[] = [];
  const calls: string[] = [];
  const errors: string[] = [];
  const exitCodes: number[] = [];
  const exitListeners: (() => void)[] = [];
  const mkdirDirectories: string[] = [];
  const writes: {
    contents: string;
    options: { readonly encoding: "utf8"; readonly flag: "wx"; readonly mode: 0o600 };
    path: string;
  }[] = [];
  let currentExitCode = exitCode;

  return {
    beforeExitListeners,
    calls,
    errors,
    exitCodes,
    exitListeners,
    mkdirDirectories,
    ports: {
      environment,
      exitCodeTarget: {
        get exitCode(): number | undefined {
          return currentExitCode;
        },
        set exitCode(nextExitCode: number | string | null | undefined) {
          if (typeof nextExitCode !== "number") return;
          currentExitCode = nextExitCode;
          exitCodes.push(nextExitCode);
        },
      },
      dropCredentials: () => {
        calls.push("drop-credentials");
      },
      getCoverage: () => coverage,
      installNetworkGuard: () => {
        calls.push("install-network-guard");
        return { attempts };
      },
      mkdir: (directory) => {
        mkdirDirectories.push(directory);
      },
      processId: 1234,
      registerBeforeExit: (listener) => {
        beforeExitListeners.push(listener);
      },
      registerExit: (listener) => {
        exitListeners.push(listener);
      },
      repositoryRoot: REPOSITORY_ROOT,
      resolvePath,
      writeFile: (filePath, contents, options) => {
        writes.push({ path: filePath, contents, options });
      },
      writeStandardError: (message) => {
        errors.push(message);
      },
    },
    writes,
  };
}

describe("bot E2E preload runtime", () => {
  it("scrubs credentials and installs the network guard before rejecting an invalid raw directory", () => {
    const runtime = createPorts({
      environment: {
        MM_BOT_E2E_COVERAGE_RAW_DIR: "/wrong-directory",
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "network-negative",
      },
    });

    expect(() => {
      installBotE2EPreloadRuntime(runtime.ports, createBotE2EPreloadRuntimeState());
    }).toThrow("MM_BOT_E2E_COVERAGE_RAW_DIR must be the repository-owned E2E raw directory");
    expect(runtime.calls).toEqual(["drop-credentials", "install-network-guard"]);
    expect(runtime.beforeExitListeners).toEqual([]);
    expect(runtime.exitListeners).toEqual([]);
  });

  it("rejects a missing raw directory after the security boundaries install", () => {
    const runtime = createPorts({
      environment: {
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "network-negative",
      },
    });

    expect(() => {
      installBotE2EPreloadRuntime(runtime.ports, createBotE2EPreloadRuntimeState());
    }).toThrow("MM_BOT_E2E_COVERAGE_RAW_DIR must be the repository-owned E2E raw directory");
    expect(runtime.calls).toEqual(["drop-credentials", "install-network-guard"]);
  });

  it("registers one idempotent lifecycle pair and writes an exact 0600 coverage envelope", () => {
    const runtime = createPorts({ coverage: { "adapter.ts": { s: {} } } });
    const state = createBotE2EPreloadRuntimeState();

    installBotE2EPreloadRuntime(runtime.ports, state);
    installBotE2EPreloadRuntime(runtime.ports, state);
    const beforeExit = runtime.beforeExitListeners[0];
    const exit = runtime.exitListeners[0];
    if (beforeExit === undefined || exit === undefined)
      throw new Error("preload runtime did not register lifecycle listeners");
    beforeExit();
    exit();

    expect(runtime.calls).toEqual(["drop-credentials", "install-network-guard"]);
    expect(runtime.beforeExitListeners).toHaveLength(1);
    expect(runtime.exitListeners).toHaveLength(1);
    expect(runtime.mkdirDirectories).toEqual([RAW_DIRECTORY]);
    expect(runtime.writes).toEqual([
      {
        path: `${RAW_DIRECTORY}/1234.json`,
        contents: `${JSON.stringify({
          schemaVersion: 1,
          pid: 1234,
          entryKind: "canonical-cli",
          caseId: "network-negative",
          coverage: { "adapter.ts": { s: {} } },
        })}\n`,
        options: { encoding: "utf8", flag: "wx", mode: 0o600 },
      },
    ]);
  });

  it("writes one redacted network ledger and exit 86 before flushing when attempts exist", () => {
    const runtime = createPorts({
      attempts: ["global.fetch", "node:http.request", "Bun.connect"],
      coverage: undefined,
    });

    installBotE2EPreloadRuntime(runtime.ports, createBotE2EPreloadRuntimeState());
    const beforeExit = runtime.beforeExitListeners[0];
    const exit = runtime.exitListeners[0];
    if (beforeExit === undefined || exit === undefined)
      throw new Error("preload runtime did not register lifecycle listeners");
    beforeExit();
    exit();

    expect(runtime.exitCodes).toEqual([86]);
    expect(runtime.errors).toEqual([
      "[bot-e2e-network-guard] blocked attempt ledger: global.fetch, node:http.request, Bun.connect\n",
    ]);
    expect(runtime.mkdirDirectories).toEqual([]);
    expect(runtime.writes).toEqual([]);
  });

  it("preserves an existing non-zero exit code while writing the network ledger", () => {
    const runtime = createPorts({ attempts: ["global.fetch"], coverage: undefined, exitCode: 7 });

    installBotE2EPreloadRuntime(runtime.ports, createBotE2EPreloadRuntimeState());
    const beforeExit = runtime.beforeExitListeners[0];
    if (beforeExit === undefined) throw new Error("preload runtime did not register a before-exit listener");
    beforeExit();

    expect(runtime.exitCodes).toEqual([]);
    expect(runtime.errors).toEqual(["[bot-e2e-network-guard] blocked attempt ledger: global.fetch\n"]);
  });

  it("rejects invalid entry and case protocol values after the security boundaries install", () => {
    const invalidEnvironments: readonly NodeJS.ProcessEnv[] = [
      {
        MM_BOT_E2E_COVERAGE_RAW_DIR: RAW_DIRECTORY,
        MM_BOT_E2E_ENTRY_KIND: "invalid",
        MM_BOT_E2E_CASE_ID: "network-negative",
      },
      {
        MM_BOT_E2E_COVERAGE_RAW_DIR: RAW_DIRECTORY,
        MM_BOT_E2E_ENTRY_KIND: "runtime-driver",
      },
      {
        MM_BOT_E2E_COVERAGE_RAW_DIR: RAW_DIRECTORY,
        MM_BOT_E2E_ENTRY_KIND: "runtime-driver",
        MM_BOT_E2E_CASE_ID: "invalid_case",
      },
    ];

    for (const environment of invalidEnvironments) {
      const runtime = createPorts({ environment });
      expect(() => {
        installBotE2EPreloadRuntime(runtime.ports, createBotE2EPreloadRuntimeState());
      }).toThrow();
      expect(runtime.calls).toEqual(["drop-credentials", "install-network-guard"]);
    }
  });
});
