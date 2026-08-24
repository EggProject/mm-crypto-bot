import { REPOSITORY_ROOT } from "./logging-e2e-scope.ts";
import { LOGGING_E2E_CASE_IDS, type LoggingEndToEndCaseId } from "./logging-e2e-case-contract.ts";

export { LOGGING_E2E_CASE_IDS, type LoggingEndToEndCaseId } from "./logging-e2e-case-contract.ts";

const REDACTION_SENTINEL = "logging-e2e-secret-sentinel";
const EXPECTED_TIMESTAMP = "2026-08-24T00:00:00.000Z";

const PUBLIC_STDERR_CASE_IDS: ReadonlySet<LoggingEndToEndCaseId> = new Set([
  "public-schema-redaction",
  "public-critical-audit",
  "public-stderr-idle-lifecycle",
]);

type PublicStderrCaseId =
  "public-schema-redaction" | "public-critical-audit" | "public-stderr-idle-lifecycle";

export interface LoggingEndToEndRunnerOptions {
  readonly childEntry: string;
  readonly preload: string;
  readonly rawDirectory: string;
  readonly rawDirectoryIdentity: Readonly<{ device: bigint; inode: bigint }>;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /**
   * Revalidates both private executable artifacts immediately before each subprocess.
   */
  readonly verifyExecutableArtifacts: () => void;
  /**
   * Test-only seam; this module is E2E infrastructure and not a package API.
   */
  readonly spawn?: LoggingEndToEndSpawnExecutor;
}

export interface LoggingEndToEndCaseResult {
  readonly caseId: LoggingEndToEndCaseId;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface LoggingEndToEndSpawnRequest {
  readonly cmd: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stderr: "pipe";
  readonly stdout: "pipe";
}

interface LoggingEndToEndSpawnedChild {
  readonly exited: Promise<number>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
}

type LoggingEndToEndSpawnExecutor = (request: LoggingEndToEndSpawnRequest) => LoggingEndToEndSpawnedChild;

const spawnLoggingEndToEndChild: LoggingEndToEndSpawnExecutor = (request) =>
  Bun.spawn({ ...request, cmd: [...request.cmd] });

function assertCondition(isConditionSatisfied: boolean, message: string): asserts isConditionSatisfied {
  if (!isConditionSatisfied) throw new Error(message);
}

type UnknownLogFields = Readonly<Record<string, unknown>>;

interface UnknownLogRecord {
  readonly component?: unknown;
  readonly correlationId?: unknown;
  readonly event?: unknown;
  readonly fields?: unknown;
  readonly level?: unknown;
  readonly runId?: unknown;
  readonly timestamp?: unknown;
}

function isRecord(value: unknown): value is UnknownLogRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLogFields(value: unknown): value is UnknownLogFields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  assertCondition(typeof value === "string", `${field} must be a string.`);
  return value;
}

function parseStderr(stderr: string): UnknownLogRecord {
  assertCondition(stderr.endsWith("\n"), "stderr must be line-delimited.");
  const line = stderr.slice(0, -1);
  assertCondition(
    !line.includes("\n"),
    "each public E2E child scenario must write exactly one stderr record.",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error: unknown) {
    throw new Error("stderr line must be valid JSON.", { cause: error });
  }
  assertCondition(isRecord(parsed), "stderr line must be a structured JSON object.");
  return parsed;
}

function assertPublicRecord(record: UnknownLogRecord, caseId: PublicStderrCaseId): void {
  assertCondition(
    readString(record.timestamp, "timestamp") === EXPECTED_TIMESTAMP,
    "timestamp must be fixed UTC.",
  );
  assertCondition(readString(record.component, "component") === "logging-e2e", "component is required.");
  assertCondition(readString(record.runId, "runId") === "run-e2e-1", "runId is required.");
  assertCondition(
    readString(record.correlationId, "correlationId") === "correlation-e2e-1",
    "correlationId is required.",
  );
  const fields = record.fields;
  assertCondition(isLogFields(fields), "fields must be a structured object.");

  if (caseId === "public-schema-redaction") {
    assertCondition(readString(record.level, "level") === "info", "level must be info.");
    assertCondition(
      readString(record.event, "event") === "logging.e2e.schema",
      "event must be logging.e2e.schema.",
    );
    assertCondition(
      fields["token"] === "[REDACTED]",
      "the public stderr record must redact the token field.",
    );
  } else if (caseId === "public-critical-audit") {
    assertCondition(readString(record.level, "level") === "error", "level must be error.");
    assertCondition(
      readString(record.event, "event") === "logging.e2e.critical.audit",
      "event must be logging.e2e.critical.audit.",
    );
    assertCondition(
      fields["audit"] === "preserved",
      "the public stderr record must preserve the audit field.",
    );
  } else {
    assertCondition(readString(record.level, "level") === "info", "level must be info.");
    assertCondition(
      readString(record.event, "event") === "logging.e2e.stderr",
      "event must be logging.e2e.stderr.",
    );
    assertCondition(fields["key"] === "value", "the default stderr record must preserve the key field.");
  }
}

function isPublicStderrCase(caseId: LoggingEndToEndCaseId): caseId is PublicStderrCaseId {
  return PUBLIC_STDERR_CASE_IDS.has(caseId);
}

function buildChildEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  rawDirectory: string,
  rawDirectoryIdentity: Readonly<{ device: bigint; inode: bigint }>,
  caseId: LoggingEndToEndCaseId,
): Readonly<Record<string, string>> {
  const inheritedEntries = Object.entries(inherited).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return {
    ...Object.fromEntries(inheritedEntries),
    MM_LOGGING_E2E_COVERAGE_RAW_DIR: rawDirectory,
    MM_LOGGING_E2E_COVERAGE_RAW_DEVICE: rawDirectoryIdentity.device.toString(),
    MM_LOGGING_E2E_COVERAGE_RAW_INODE: rawDirectoryIdentity.inode.toString(),
    MM_LOGGING_E2E_CASE_ID: caseId,
  };
}

export async function runLoggingEndToEndSubprocesses(
  options: LoggingEndToEndRunnerOptions,
): Promise<readonly LoggingEndToEndCaseResult[]> {
  const results: LoggingEndToEndCaseResult[] = [];
  for (const caseId of LOGGING_E2E_CASE_IDS) {
    const environment = buildChildEnvironment(
      options.environment,
      options.rawDirectory,
      options.rawDirectoryIdentity,
      caseId,
    );
    options.verifyExecutableArtifacts();
    const child = (options.spawn ?? spawnLoggingEndToEndChild)({
      cmd: ["bun", "--preload", options.preload, options.childEntry, caseId],
      cwd: REPOSITORY_ROOT,
      env: environment,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    assertCondition(exitCode === 0, `${caseId} exited ${String(exitCode)}.`);
    assertCondition(stdout === "", `${caseId} wrote to stdout.`);
    assertCondition(
      !stderr.includes(REDACTION_SENTINEL),
      `${caseId} leaked the redaction sentinel to stderr.`,
    );

    if (isPublicStderrCase(caseId)) {
      const record = parseStderr(stderr);
      assertPublicRecord(record, caseId);
    } else {
      assertCondition(stderr === "", `${caseId} wrote to stderr.`);
    }

    results.push({
      caseId,
      exitCode,
      stderr,
      stdout,
    });
  }
  return Object.freeze(results);
}
