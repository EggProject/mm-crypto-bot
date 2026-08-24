import {
  LoggingError,
  StructuredLogger,
  type LogContext,
  type LogObject,
  type LogRecord,
  type LogSink,
  type LogSinkWriteResult,
  type LogValue,
  type StderrJsonWritable,
} from "../../src/index.ts";

export { requireLogger } from "../../src/index.ts";

export const FIXED_TIMESTAMP = "2026-08-24T00:00:00.000Z";
export const REDACTION_SENTINEL = "logging-e2e-secret-sentinel";
const EPOCH_TIMESTAMP = "1970-01-01T00:00:00.000Z";
export const OVERLONG_KEY = "k".repeat(129);

const LOG_CONTEXT: LogContext = Object.freeze({
  component: "logging-e2e",
  correlationId: "correlation-e2e-1",
  runId: "run-e2e-1",
});

export function assertCondition(
  isConditionSatisfied: boolean,
  message: string,
): asserts isConditionSatisfied {
  if (!isConditionSatisfied) throw new Error(message);
}

export function isLogObject(value: LogValue | undefined): value is LogObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLogArray(value: LogValue | undefined): value is readonly LogValue[] {
  return Array.isArray(value);
}

export function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class RecordingSink implements LogSink {
  private readonly storedRecords: LogRecord[] = [];

  public write(record: LogRecord): LogSinkWriteResult {
    this.storedRecords.push(record);
    return { acceptance: "accepted", recordAccepted: true };
  }

  public getStoredRecords(): readonly LogRecord[] {
    return Object.freeze([...this.storedRecords]);
  }
}

export class RecordingStderrJsonWritable implements StderrJsonWritable {
  private readonly writtenChunks: string[] = [];

  public write(chunk: string): boolean {
    this.writtenChunks.push(chunk);
    return true;
  }

  public once(_event: "drain" | "error", _listener: (cause?: unknown) => void): void {
    void _event;
    void _listener;
  }

  public off(_event: "drain" | "error", _listener: (cause?: unknown) => void): void {
    void _event;
    void _listener;
  }

  public getWrittenChunks(): readonly string[] {
    return Object.freeze([...this.writtenChunks]);
  }
}

export function createLogger(sink: LogSink): StructuredLogger {
  return new StructuredLogger({
    clock: { now: () => new Date(FIXED_TIMESTAMP) },
    context: LOG_CONTEXT,
    sink,
    threshold: "debug",
  });
}

export function assertLoggingError(
  action: () => void,
  expectedCode: LoggingError["code"],
  expectedMessage: string,
): void {
  let caughtError: unknown;
  try {
    action();
  } catch (error: unknown) {
    caughtError = error;
  }
  assertCondition(caughtError instanceof LoggingError, "Expected a LoggingError.");
  assertCondition(caughtError.code === expectedCode, `Expected ${expectedCode} LoggingError code.`);
  assertCondition(caughtError.message === expectedMessage, "LoggingError message must be exact.");
}

export function createNineLevelObject(): Readonly<Record<string, unknown>> {
  let nested: Readonly<Record<string, unknown>> = Object.freeze({ depth9: "leaf" });
  for (let depth = 8; depth >= 1; depth -= 1) {
    nested = Object.freeze({ [`depth${String(depth)}`]: nested });
  }
  return nested;
}

export function readSerializedRecord(chunk: string): Readonly<Record<string, unknown>> {
  assertCondition(chunk.endsWith("\n"), "Stderr sink writes must be JSONL.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(chunk.slice(0, -1));
  } catch (error: unknown) {
    throw new Error("Stderr sink writes must be valid JSON.", { cause: error });
  }
  assertCondition(isUnknownRecord(parsed), "Stderr JSONL root must be an object.");
  return parsed;
}

export function assertUnreadableFields(
  record: Readonly<Record<string, unknown>>,
  expectedMarker: "[UNREADABLE_OBJECT]" | "[UNREADABLE_VALUE]",
): void {
  const fields = record["fields"];
  assertCondition(isUnknownRecord(fields), "Fail-closed fields must be an object.");
  assertCondition(
    Object.keys(fields).length === 1 && fields["fields"] === expectedMarker,
    "Unreadable record fields must use the canonical marker.",
  );
}

export function assertCanonicalInvalidRecord(record: Readonly<Record<string, unknown>>): void {
  assertCondition(record["timestamp"] === EPOCH_TIMESTAMP, "Invalid timestamps must use the epoch default.");
  assertCondition(record["level"] === "error", "Invalid levels must use error.");
  assertCondition(record["event"] === "logging.invalid.record", "Invalid events must use canonical event.");
  assertCondition(record["component"] === "invalid", "Invalid components must use canonical identifier.");
  assertCondition(record["runId"] === "invalid", "Invalid run IDs must use canonical identifier.");
  assertCondition(
    record["correlationId"] === "invalid",
    "Invalid correlation IDs must use canonical identifier.",
  );
  assertUnreadableFields(record, "[UNREADABLE_VALUE]");
  assertCondition(
    !JSON.stringify(record).includes(REDACTION_SENTINEL),
    "Fail-closed stderr output must not contain the secret sentinel.",
  );
}
