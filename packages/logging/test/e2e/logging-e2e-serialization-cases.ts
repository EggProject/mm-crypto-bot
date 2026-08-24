import {
  StructuredLogger,
  type LogContext,
  type LogObject,
  type LogRecord,
  type LogSink,
  type LogSinkWriteResult,
  type LogValue,
} from "../../src/index.ts";

const FIXED_TIMESTAMP = "2026-08-24T00:00:00.000Z";
const REDACTION_SENTINEL = "logging-e2e-secret-sentinel";

const EXACT_CONTEXT: LogContext = Object.freeze({
  component: "logging-e2e",
  correlationId: "correlation-e2e-1",
  runId: "run-e2e-1",
});

function assertCondition(isConditionSatisfied: boolean, message: string): asserts isConditionSatisfied {
  if (!isConditionSatisfied) {
    throw new Error(message);
  }
}

function isLogObject(value: LogValue | undefined): value is LogObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLogArray(value: LogValue | undefined): value is readonly LogValue[] {
  return Array.isArray(value);
}

class RecordingSink implements LogSink {
  private readonly storedRecords: LogRecord[] = [];

  public write(record: LogRecord): LogSinkWriteResult {
    this.storedRecords.push(record);
    return { acceptance: "accepted", recordAccepted: true };
  }

  public getStoredRecords(): readonly LogRecord[] {
    return this.storedRecords;
  }
}

function createLogger(sink: LogSink): StructuredLogger {
  return new StructuredLogger({
    clock: { now: () => new Date(FIXED_TIMESTAMP) },
    context: EXACT_CONTEXT,
    sink,
  });
}

export async function runSerializationBoundaries(): Promise<void> {
  const sink = new RecordingSink();
  const logger = createLogger(sink);
  const secretUrl = `https://operator:${REDACTION_SENTINEL}@example.invalid/path`;
  const secretError = new Error(`secret: ${REDACTION_SENTINEL}`);

  logger.info("logging.serialization.boundaries", {
    bigintVal: 42n,
    errorVal: secretError,
    finiteNum: 12.5,
    nanVal: NaN,
    nestedArray: ["safe-item", 100],
    nestedObject: { innerKey: "innerValue" },
    posInfinity: Infinity,
    undefinedVal: undefined,
    urlVal: secretUrl,
  });
  await logger.flush();

  const storedRecords = sink.getStoredRecords();
  assertCondition(storedRecords.length === 1, "Exactly one record must be stored by the recording sink.");
  const firstRecord = storedRecords[0];
  assertCondition(firstRecord !== undefined, "First stored record must be defined.");
  const fields = firstRecord.fields;

  assertCondition(fields["finiteNum"] === "12.5", "Finite number 12.5 must serialize to string 12.5.");
  assertCondition(fields["nanVal"] === "[NON_FINITE_NUMBER]", "NaN must serialize to [NON_FINITE_NUMBER].");
  assertCondition(
    fields["posInfinity"] === "[NON_FINITE_NUMBER]",
    "Positive Infinity must serialize to [NON_FINITE_NUMBER].",
  );
  assertCondition(fields["bigintVal"] === "42", "Bigint 42n must serialize to string 42.");
  assertCondition(fields["undefinedVal"] === "[UNDEFINED]", "Undefined value must serialize to [UNDEFINED].");

  const nestedObject = fields["nestedObject"];
  assertCondition(isLogObject(nestedObject), "nestedObject must be serialized as a LogObject.");
  assertCondition(
    nestedObject["innerKey"] === "innerValue",
    "Nested safe object properties must be preserved.",
  );

  const nestedArray = fields["nestedArray"];
  assertCondition(isLogArray(nestedArray), "nestedArray must be serialized as a LogArray.");
  assertCondition(
    nestedArray.length === 2 && nestedArray[0] === "safe-item" && nestedArray[1] === "100",
    "Nested safe array elements must be preserved.",
  );

  const serializedUrl = fields["urlVal"];
  assertCondition(typeof serializedUrl === "string", "urlVal must be serialized as a string.");
  assertCondition(
    !serializedUrl.includes(REDACTION_SENTINEL),
    "Serialized URL must not contain secret sentinel.",
  );
  assertCondition(serializedUrl === "[REDACTED]", "Serialized secret-bearing URL must equal [REDACTED].");

  const serializedError = fields["errorVal"];
  assertCondition(isLogObject(serializedError), "errorVal must be serialized as a LogObject.");
  const serializedErrorMessage = serializedError["message"];
  assertCondition(typeof serializedErrorMessage === "string", "Serialized error message must be a string.");
  assertCondition(
    !serializedErrorMessage.includes(REDACTION_SENTINEL),
    "Serialized error message must not contain secret sentinel.",
  );
  assertCondition(
    serializedErrorMessage === "[REDACTED]",
    "Serialized secret-bearing error message must equal [REDACTED].",
  );
}
