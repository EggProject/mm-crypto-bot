import { describe, expect, it, vi } from "vitest";

import {
  LOGGING_E2E_CASE_IDS,
  runLoggingEndToEndSubprocesses,
  type LoggingEndToEndRunnerOptions,
} from "./logging-e2e-runner.ts";
import { REPOSITORY_ROOT } from "./logging-e2e-scope.ts";

type Spawn = NonNullable<LoggingEndToEndRunnerOptions["spawn"]>;
type SpawnRequest = Parameters<Spawn>[0];
type SpawnedChild = ReturnType<Spawn>;

const encoder = new TextEncoder();
const FIRST_CASE = LOGGING_E2E_CASE_IDS[0];
const IDENTITY = { device: 17n, inode: 23n };
const BASE_ENVIRONMENT = {
  INHERITED: "kept",
  OMITTED: undefined,
  MM_LOGGING_E2E_CASE_ID: "overridden",
  MM_LOGGING_E2E_COVERAGE_RAW_DEVICE: "overridden",
  MM_LOGGING_E2E_COVERAGE_RAW_DIR: "overridden",
  MM_LOGGING_E2E_COVERAGE_RAW_INODE: "overridden",
} as const;

function stream(contents: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(contents));
      controller.close();
    },
  });
}

function publicRecord(caseId: string): Record<string, unknown> {
  const common = {
    timestamp: "2026-08-24T00:00:00.000Z",
    component: "logging-e2e",
    runId: "run-e2e-1",
    correlationId: "correlation-e2e-1",
  };
  if (caseId === "public-schema-redaction") {
    return { ...common, level: "info", event: "logging.e2e.schema", fields: { token: "[REDACTED]" } };
  }
  if (caseId === "public-critical-audit") {
    return { ...common, level: "error", event: "logging.e2e.critical.audit", fields: { audit: "preserved" } };
  }
  if (caseId === "public-stderr-idle-lifecycle") {
    return { ...common, level: "info", event: "logging.e2e.stderr", fields: { key: "value" } };
  }
  throw new Error(`No public record for ${caseId}.`);
}

function stderrFor(caseId: string): string {
  return ["public-schema-redaction", "public-critical-audit", "public-stderr-idle-lifecycle"].includes(caseId)
    ? `${JSON.stringify(publicRecord(caseId))}\n`
    : "";
}

function child(exitCode = 0, stdout = "", stderr = ""): SpawnedChild {
  return { exited: Promise.resolve(exitCode), stdout: stream(stdout), stderr: stream(stderr) };
}

function runnerOptions(
  spawn?: Spawn,
  environment: Readonly<Record<string, string | undefined>> = BASE_ENVIRONMENT,
): LoggingEndToEndRunnerOptions {
  return {
    childEntry: "/private/bundle/child.js",
    preload: "/private/bundle/preload.js",
    rawDirectory: "/private/raw",
    rawDirectoryIdentity: IDENTITY,
    environment,
    verifyExecutableArtifacts: (): void => undefined,
    ...(spawn !== undefined && { spawn }),
  };
}

function successfulSpawn(requests: SpawnRequest[]): Spawn {
  return (request): SpawnedChild => {
    requests.push(request);
    const caseId = request.cmd.at(-1) ?? "";
    return child(0, "", stderrFor(caseId));
  };
}

function mutatePublicStderr(
  caseId: "public-schema-redaction" | "public-critical-audit" | "public-stderr-idle-lifecycle",
  mutate: (record: Record<string, unknown>) => string,
): Spawn {
  return (request): SpawnedChild => {
    const spawnedCaseId = request.cmd.at(-1) ?? "";
    return child(0, "", spawnedCaseId === caseId ? mutate(publicRecord(caseId)) : stderrFor(spawnedCaseId));
  };
}

function spawnWithNonPublicStderr(request: SpawnRequest): SpawnedChild {
  const caseId = request.cmd.at(-1) ?? "";
  return child(0, "", caseId === "controlled-sink-backpressure-recovery" ? "unexpected" : stderrFor(caseId));
}

function runWithPublicStderr(
  caseId: "public-schema-redaction" | "public-critical-audit" | "public-stderr-idle-lifecycle",
  mutate: (record: Record<string, unknown>) => string,
) {
  return runLoggingEndToEndSubprocesses(runnerOptions(mutatePublicStderr(caseId, mutate)));
}

function serializeMutation(field: string, value: unknown): (record: Record<string, unknown>) => string {
  return (record): string => `${JSON.stringify({ ...record, [field]: value })}\n`;
}

describe("logging E2E runner public boundary", () => {
  it("passes only defined inherited values, overwrites fixed raw metadata, and freezes exact results", async () => {
    const requests: SpawnRequest[] = [];
    const results = await runLoggingEndToEndSubprocesses(runnerOptions(successfulSpawn(requests)));

    expect(results).toEqual(
      LOGGING_E2E_CASE_IDS.map((caseId) => ({ caseId, exitCode: 0, stdout: "", stderr: stderrFor(caseId) })),
    );
    expect(Object.isFrozen(results)).toBe(true);
    expect(requests).toHaveLength(LOGGING_E2E_CASE_IDS.length);
    const firstRequest = requests[0];
    expect(firstRequest?.cwd).toBeTypeOf("string");
    expect({ ...firstRequest, cwd: undefined }).toEqual({
      cmd: ["bun", "--preload", "/private/bundle/preload.js", "/private/bundle/child.js", FIRST_CASE],
      cwd: undefined,
      env: {
        INHERITED: "kept",
        MM_LOGGING_E2E_CASE_ID: FIRST_CASE,
        MM_LOGGING_E2E_COVERAGE_RAW_DIR: "/private/raw",
        MM_LOGGING_E2E_COVERAGE_RAW_DEVICE: "17",
        MM_LOGGING_E2E_COVERAGE_RAW_INODE: "23",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
  });

  it.each([
    ["nonzero exit", child(9), "public-schema-redaction exited 9."],
    ["nonempty stdout", child(0, "unexpected"), "public-schema-redaction wrote to stdout."],
    ["stdout sentinel", child(0, "logging-e2e-secret-sentinel"), "public-schema-redaction wrote to stdout."],
    [
      "stderr sentinel",
      child(0, "", "logging-e2e-secret-sentinel"),
      "public-schema-redaction leaked the redaction sentinel to stderr.",
    ],
  ])("rejects public child %s", async (_scenario, spawnedChild, message) => {
    await expect(runLoggingEndToEndSubprocesses(runnerOptions(() => spawnedChild))).rejects.toThrow(message);
  });

  it("rejects stderr from a non-public child", async () => {
    await expect(runLoggingEndToEndSubprocesses(runnerOptions(spawnWithNonPublicStderr))).rejects.toThrow(
      "controlled-sink-backpressure-recovery wrote to stderr.",
    );
  });

  it.each([
    [
      "missing final newline",
      (): string => JSON.stringify(publicRecord("public-schema-redaction")),
      "stderr must be line-delimited.",
    ],
    [
      "multiple lines",
      (): string => `${JSON.stringify(publicRecord("public-schema-redaction"))}\n{}\n`,
      "exactly one stderr record",
    ],
    ["malformed JSON", (): string => "{bad}\n", "stderr line must be valid JSON."],
    ["nonobject", (): string => "null\n", "structured JSON object"],
    ["array", (): string => "[]\n", "structured JSON object"],
    [
      "fields nonobject",
      (): string =>
        `${JSON.stringify({ ...publicRecord("public-schema-redaction"), fields: "not-an-object" })}\n`,
      "fields must be a structured object.",
    ],
    [
      "fields array",
      (): string => `${JSON.stringify({ ...publicRecord("public-schema-redaction"), fields: [] })}\n`,
      "fields must be a structured object.",
    ],
  ])("rejects public stderr with %s", async (_scenario, mutate, message) => {
    await expect(runWithPublicStderr("public-schema-redaction", () => mutate())).rejects.toThrow(message);
  });

  it("preserves the malformed JSON parser error as the stable error cause", async () => {
    let result: unknown;
    try {
      await runWithPublicStderr("public-schema-redaction", () => "{bad}\n");
    } catch (error: unknown) {
      result = error;
    }

    expect(result).toBeInstanceOf(Error);
    if (!(result instanceof Error)) throw new Error("Expected an Error.");
    expect(result.message).toBe("stderr line must be valid JSON.");
    expect(result.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    ["timestamp", 1, "timestamp must be a string."],
    ["component", 1, "component must be a string."],
    ["runId", 1, "runId must be a string."],
    ["correlationId", 1, "correlationId must be a string."],
    ["timestamp", "wrong", "timestamp must be fixed UTC."],
    ["component", "wrong", "component is required."],
    ["runId", "wrong", "runId is required."],
    ["correlationId", "wrong", "correlationId is required."],
  ])("rejects required %s value", async (field, value, message) => {
    await expect(
      runWithPublicStderr("public-schema-redaction", serializeMutation(field, value)),
    ).rejects.toThrow(message);
  });

  it.each([
    ["public-schema-redaction", "level", "error", "level must be info."],
    ["public-schema-redaction", "event", "wrong", "event must be logging.e2e.schema."],
    ["public-schema-redaction", "fields", { token: "wrong" }, "redact the token"],
    ["public-critical-audit", "level", "info", "level must be error."],
    ["public-critical-audit", "event", "wrong", "event must be logging.e2e.critical.audit."],
    ["public-critical-audit", "fields", { audit: "wrong" }, "preserve the audit"],
    ["public-stderr-idle-lifecycle", "level", "error", "level must be info."],
    ["public-stderr-idle-lifecycle", "event", "wrong", "event must be logging.e2e.stderr."],
    ["public-stderr-idle-lifecycle", "fields", { key: "wrong" }, "preserve the key"],
  ] as const)("rejects %s incorrect %s", async (caseId, field, value, message) => {
    await expect(runWithPublicStderr(caseId, serializeMutation(field, value))).rejects.toThrow(message);
  });

  it("uses the default Bun.spawn adapter and stops at its first failed child", async () => {
    const requests: SpawnRequest[] = [];
    const spawn: Spawn = (request): SpawnedChild => {
      requests.push(request);
      return child(9);
    };
    vi.stubGlobal("Bun", { spawn });
    try {
      await expect(
        runLoggingEndToEndSubprocesses({
          ...runnerOptions(),
        }),
      ).rejects.toThrow("public-schema-redaction exited 9.");
      expect(requests).toEqual([
        {
          cmd: ["bun", "--preload", "/private/bundle/preload.js", "/private/bundle/child.js", FIRST_CASE],
          cwd: REPOSITORY_ROOT,
          env: {
            INHERITED: "kept",
            MM_LOGGING_E2E_CASE_ID: FIRST_CASE,
            MM_LOGGING_E2E_COVERAGE_RAW_DIR: "/private/raw",
            MM_LOGGING_E2E_COVERAGE_RAW_DEVICE: "17",
            MM_LOGGING_E2E_COVERAGE_RAW_INODE: "23",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
