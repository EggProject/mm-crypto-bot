import coveragePackage from "istanbul-lib-coverage";
import { describe, expect, it, vi } from "vitest";

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
import type { LoggingE2eArtifactRun } from "./logging-e2e-artifact-run.ts";
import type { LoggingEndToEndCoverageSummary } from "./logging-e2e-gate.ts";
import { LOGGING_E2E_CASE_IDS, type LoggingEndToEndCaseResult } from "./logging-e2e-runner.ts";
import type { LoggingEndToEndScopeManifest } from "./logging-e2e-scope.ts";
import {
  runLoggingEndToEndCoverage,
  runLoggingEndToEndCoverageMain,
  setLoggingEndToEndCoverageProcessExitCode,
  type LoggingEndToEndCoverageMainPort,
  type LoggingEndToEndCoveragePort,
  writeLoggingEndToEndCoverageMainError,
} from "./run-logging-e2e-coverage.ts";

const ARTIFACT_PATHS = Object.freeze({ bundle: "/private/bundle", raw: "/private/raw", root: "/private" });
const ARTIFACT_IDENTITIES = Object.freeze({
  bundle: Object.freeze({ device: 1n, inode: 3n }),
  raw: Object.freeze({ device: 1n, inode: 2n }),
  root: Object.freeze({ device: 1n, inode: 1n }),
});
const RUNTIME_FILES = Object.freeze(["packages/logging/src/logger.ts"]);
const EMPTY_COVERAGE = coveragePackage.createCoverageMap({}).getCoverageSummary().toJSON();

function createManifest(caseIds: readonly string[] = LOGGING_E2E_CASE_IDS): LoggingEndToEndScopeManifest {
  return Object.freeze({
    e2eCases: Object.freeze([...caseIds]),
    runtimeFiles: RUNTIME_FILES,
    schemaVersion: 1,
  });
}

function createSummary(isPassed = true): LoggingEndToEndCoverageSummary {
  return Object.freeze({
    caseIds: Object.freeze([...LOGGING_E2E_CASE_IDS]),
    failures: Object.freeze([]),
    files: Object.freeze({}),
    label: "logging-subprocess-e2e",
    passed: isPassed,
    rawFileCount: LOGGING_E2E_CASE_IDS.length,
    schemaVersion: 1,
    scope: RUNTIME_FILES,
    total: EMPTY_COVERAGE,
  });
}

function createResults(
  caseIds: readonly LoggingEndToEndCaseResult["caseId"][] = LOGGING_E2E_CASE_IDS,
): readonly LoggingEndToEndCaseResult[] {
  return Object.freeze(
    caseIds.map((caseId) => Object.freeze({ caseId, exitCode: 0, stderr: "", stdout: "" })),
  );
}

function createMismatchedCaseIds(): readonly LoggingEndToEndCaseResult["caseId"][] {
  const [first, second, ...remaining] = LOGGING_E2E_CASE_IDS;
  return Object.freeze([second, first, ...remaining]);
}

function createArtifactRun(
  events: string[],
  adoptedFiles: readonly string[] = LOGGING_E2E_CASE_IDS,
): LoggingE2eArtifactRun {
  return Object.freeze({
    adoptExternalFiles: (directory: "raw" | "bundle") => {
      events.push(`adopt:${directory}`);
      return Object.freeze([...adoptedFiles]);
    },
    cleanup: () => {
      events.push("cleanup");
    },
    identities: ARTIFACT_IDENTITIES,
    paths: ARTIFACT_PATHS,
    readFile: (directory: "raw" | "bundle", name: string) => {
      events.push(`read:${directory}:${name}`);
      return new Uint8Array();
    },
    revalidateDirectories: () => {
      events.push("revalidate");
    },
    writeExclusiveFile: () => {
      events.push("write");
    },
  });
}

function createPort(
  events: string[],
  overrides: Readonly<Partial<LoggingEndToEndCoveragePort>> = Object.freeze({}),
): LoggingEndToEndCoveragePort {
  const artifactRun = createArtifactRun(events);
  const port: LoggingEndToEndCoveragePort = {
    build: () => {
      events.push("build");
      return Promise.resolve(
        Object.freeze({
          childEntry: "/private/bundle/logging-e2e-child.js",
          instrumentedCount: 1,
          preloadEntry: "/private/bundle/logging-e2e-preload.js",
        }),
      );
    },
    collect: () => {
      events.push("collect");
      return createSummary();
    },
    createArtifactRun: () => artifactRun,
    environment: Object.freeze({}),
    loadManifest: () => createManifest(),
    print: () => {
      events.push("print");
    },
    publish: () => {
      events.push("publish");
    },
    runSubprocesses: (options) => {
      events.push("runner");
      options.verifyExecutableArtifacts();
      return Promise.resolve(createResults());
    },
    setExitCode: (exitCode) => {
      events.push(`exit:${String(exitCode)}`);
    },
  };
  return Object.freeze({ ...port, ...overrides });
}

function createMainPort(
  events: string[],
  overrides: Readonly<Partial<LoggingEndToEndCoverageMainPort>> = Object.freeze({}),
): LoggingEndToEndCoverageMainPort {
  const port: LoggingEndToEndCoverageMainPort = {
    run: () => {
      events.push("run");
      return Promise.resolve();
    },
    setExitCode: (exitCode) => {
      events.push(`exit:${String(exitCode)}`);
    },
    writeError: (message) => {
      events.push(`error:${message}`);
    },
  };
  return Object.freeze({ ...port, ...overrides });
}

function failingPort(
  events: string[],
  phase: "build" | "runner" | "collect" | "publish",
  error: Error,
): LoggingEndToEndCoveragePort {
  const port = createPort(events);
  if (phase === "build")
    return Object.freeze({
      ...port,
      build: async () => {
        await Promise.resolve();
        throw error;
      },
    });
  if (phase === "runner")
    return Object.freeze({
      ...port,
      runSubprocesses: async () => {
        await Promise.resolve();
        throw error;
      },
    });
  if (phase === "collect")
    return Object.freeze({
      ...port,
      collect: () => {
        throw error;
      },
    });
  return Object.freeze({
    ...port,
    publish: () => {
      throw error;
    },
  });
}

describe("logging E2E coverage orchestration", () => {
  it("runs the main lifecycle without diagnostics on success", async () => {
    const events: string[] = [];

    await runLoggingEndToEndCoverageMain(createMainPort(events));

    expect(events).toEqual(["run"]);
  });

  it("writes an Error diagnostic and exit code two without rethrowing", async () => {
    const events: string[] = [];
    const failure = new Error("planned main failure");
    const port = createMainPort(events, {
      run: () => Promise.reject(failure),
    });

    await expect(runLoggingEndToEndCoverageMain(port)).resolves.toBeUndefined();
    expect(events).toEqual([
      "error:Logging subprocess E2E coverage infrastructure failed: planned main failure",
      "exit:2",
    ]);
  });

  it("writes a non-Error diagnostic and exit code two without rethrowing", async () => {
    const events: string[] = [];
    const failure = new Error("planned foreign main failure");
    Object.setPrototypeOf(failure, Object.freeze({ toString: () => "foreign failure" }));
    const port = createMainPort(events, {
      run: async () => {
        await Promise.resolve();
        throw failure;
      },
    });

    await expect(runLoggingEndToEndCoverageMain(port)).resolves.toBeUndefined();
    expect(events).toEqual([
      "error:Logging subprocess E2E coverage infrastructure failed: foreign failure",
      "exit:2",
    ]);
  });

  it("sets the default process exit code exactly and restores process state", () => {
    const originalExitCode = process.exitCode;

    try {
      setLoggingEndToEndCoverageProcessExitCode(23);
      expect(process.exitCode).toBe(23);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("writes the default main diagnostic exactly through console.error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => "");

    try {
      writeLoggingEndToEndCoverageMainError("exact diagnostic");
      expect(errorSpy).toHaveBeenCalledExactlyOnceWith("exact diagnostic");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("runs the verified lifecycle in order and checks both private executable artifacts", async () => {
    const events: string[] = [];

    await runLoggingEndToEndCoverage(createPort(events));

    expect(events).toEqual([
      "build",
      "runner",
      "read:bundle:logging-e2e-child.js",
      "read:bundle:logging-e2e-preload.js",
      "adopt:raw",
      "collect",
      "publish",
      "print",
      "cleanup",
    ]);
  });

  it.each([
    ["child", "/private/bundle/not-child.js"],
    ["preload", "/private/bundle/not-preload.js"],
  ])(
    "fails before raw adoption when the %s artifact is not the exact direct child",
    async (_label, badEntry) => {
      const events: string[] = [];
      const basePort = createPort(events);
      const port = Object.freeze({
        ...basePort,
        build: () =>
          Promise.resolve(
            Object.freeze({
              childEntry: _label === "child" ? badEntry : "/private/bundle/logging-e2e-child.js",
              instrumentedCount: 1,
              preloadEntry: _label === "preload" ? badEntry : "/private/bundle/logging-e2e-preload.js",
            }),
          ),
      });

      await expect(runLoggingEndToEndCoverage(port)).rejects.toThrow("private artifact bundle direct child");
      expect(events).not.toContain("adopt:raw");
      expect(events).toContain("cleanup");
    },
  );

  it("fails when the adopted raw artifact count differs from completed subprocesses", async () => {
    const events: string[] = [];
    const artifactRun = createArtifactRun(events, ["one.json"]);
    const port = createPort(events, { createArtifactRun: () => artifactRun });

    await expect(runLoggingEndToEndCoverage(port)).rejects.toThrow("adopted logging E2E raw coverage files");
    expect(events).toContain("cleanup");
  });

  it("fails when completed runner case IDs do not exactly equal the contract", async () => {
    const events: string[] = [];
    const port = createPort(events, {
      runSubprocesses: () => Promise.resolve(createResults(createMismatchedCaseIds())),
    });

    await expect(runLoggingEndToEndCoverage(port)).rejects.toThrow("Completed logging E2E case IDs");
    expect(events).toContain("adopt:raw");
    expect(events).toContain("cleanup");
  });

  it("fails when completed runner case IDs do not exactly equal the manifest", async () => {
    const events: string[] = [];
    const port = createPort(events, {
      loadManifest: () => createManifest(createMismatchedCaseIds()),
    });

    await expect(runLoggingEndToEndCoverage(port)).rejects.toThrow("Completed logging E2E manifest case IDs");
    expect(events).toContain("adopt:raw");
    expect(events).toContain("cleanup");
  });

  it("marks an unsuccessful coverage gate with exit code one after printing", async () => {
    const events: string[] = [];
    const port = createPort(events, { collect: () => createSummary(false) });

    await runLoggingEndToEndCoverage(port);

    expect(events.slice(-3)).toEqual(["print", "exit:1", "cleanup"]);
  });

  it.each(["build", "runner", "collect", "publish"] as const)(
    "preserves a %s failure after cleanup",
    async (phase) => {
      const events: string[] = [];
      const primary = new Error(`${phase} primary`);

      await expect(runLoggingEndToEndCoverage(failingPort(events, phase, primary))).rejects.toBe(primary);
      expect(events).toContain("cleanup");
    },
  );

  it("throws a cleanup-only failure", async () => {
    const events: string[] = [];
    const cleanup = new Error("cleanup only");
    const artifactRun = Object.freeze({
      ...createArtifactRun(events),
      cleanup: () => {
        throw cleanup;
      },
    });
    const port = createPort(events, { createArtifactRun: () => artifactRun });

    await expect(runLoggingEndToEndCoverage(port)).rejects.toBe(cleanup);
  });

  it("preserves primary then cleanup errors in an aggregate error", async () => {
    const events: string[] = [];
    const primary = new Error("primary");
    const cleanup = new Error("cleanup");
    const artifactRun = Object.freeze({
      ...createArtifactRun(events),
      cleanup: () => {
        throw cleanup;
      },
    });
    const port = createPort(events, {
      build: async () => {
        await Promise.resolve();
        throw primary;
      },
      createArtifactRun: () => artifactRun,
    });

    await expect(runLoggingEndToEndCoverage(port)).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof AggregateError)) return false;
      return error.cause === primary && JSON.stringify(error.errors) === JSON.stringify([primary, cleanup]);
    });
  });
});
