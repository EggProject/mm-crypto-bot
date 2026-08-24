import {
  LoggingError,
  StructuredLogger,
  type LogContext,
  type LogObject,
  type LogRecord,
  type LogSink,
  type LogSinkWriteResult,
  type LogValue,
  type UtcClock,
} from "../../src/index.ts";

type LoggerOptions = ConstructorParameters<typeof StructuredLogger>[0];

const FIXED_TIMESTAMP = "2026-08-18T00:00:00.000Z";

const FULL_CONTEXT: LogContext = Object.freeze({
  component: "logging-e2e",
  correlationId: "correlation-e2e-1",
  datasetId: "dataset-e2e-1",
  orderId: "order-e2e-1",
  runId: "run-e2e-1",
  strategyId: "strategy-e2e-1",
  symbol: "BTC-USDC",
});

const BASE_CONTEXT: LogContext = Object.freeze({
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

function assertDeeplyFrozen(value: LogValue | undefined, path: string): void {
  if (typeof value !== "object" || value === null) return;
  assertCondition(Object.isFrozen(value), `${path} must be frozen.`);
  for (const [key, nestedValue] of Object.entries(value)) {
    assertDeeplyFrozen(nestedValue, `${path}.${key}`);
  }
}

function assertLoggingError(
  action: () => void,
  expectedCode: LoggingError["code"],
  message: string,
): LoggingError {
  let caughtError: unknown;
  try {
    action();
  } catch (error: unknown) {
    caughtError = error;
  }
  assertCondition(caughtError instanceof LoggingError && caughtError.code === expectedCode, message);
  return caughtError;
}

function assertConstructorInvalidContext(options: LoggerOptions, message: string): LoggingError {
  return assertLoggingError(() => new StructuredLogger(options), "INVALID_CONTEXT", message);
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

  public getStoredEventNames(): readonly string[] {
    return this.storedRecords.map((record) => record.event);
  }
}

export async function runStructuredBoundaryValidationAndFreeze(): Promise<void> {
  const fixedClock: UtcClock = { now: () => new Date(FIXED_TIMESTAMP) };
  const acceptingSink = new RecordingSink();
  const logger = new StructuredLogger({
    clock: fixedClock,
    context: FULL_CONTEXT,
    sink: acceptingSink,
    threshold: "debug",
  });

  const nestedError = new Error("outer failure", {
    cause: { nestedCauseItems: ["cause-array-leaf"] },
  });

  logger.debug("logging.e2e.immutable", {
    errorField: nestedError,
    level1: {
      level2: {
        level3: {
          level4: {
            level5: {
              level6: {
                level7: { leafArray: ["nested-array-leaf"], leafObject: { key: "nested-object-leaf" } },
              },
            },
          },
        },
      },
    },
    nestedArray: ["array-item-1"],
    nestedObject: { innerKey: "innerValue" },
  });
  await logger.flush();

  const records = acceptingSink.getStoredRecords();
  assertCondition(records.length === 1, "Exactly one record must be captured by recording sink.");
  const record = records[0];
  assertCondition(record !== undefined, "First captured record must be defined.");

  assertCondition(
    record.timestamp === FIXED_TIMESTAMP &&
      record.component === "logging-e2e" &&
      record.runId === "run-e2e-1" &&
      record.correlationId === "correlation-e2e-1" &&
      record.strategyId === "strategy-e2e-1" &&
      record.symbol === "BTC-USDC" &&
      record.datasetId === "dataset-e2e-1" &&
      record.orderId === "order-e2e-1" &&
      record.event === "logging.e2e.immutable" &&
      record.level === "debug",
    "Record must contain fixed timestamp, level, event, and all context fields.",
  );

  assertCondition(Object.isFrozen(record), "LogRecord must be frozen.");
  assertDeeplyFrozen(record.fields, "LogRecord.fields");

  const fields = record.fields;
  const nestedArray = fields["nestedArray"];
  assertCondition(
    isLogArray(nestedArray) && Object.isFrozen(nestedArray),
    "fields.nestedArray must be frozen array.",
  );

  const nestedObject = fields["nestedObject"];
  assertCondition(
    isLogObject(nestedObject) && Object.isFrozen(nestedObject),
    "fields.nestedObject must be frozen object.",
  );

  const sanitizedError = fields["errorField"];
  assertCondition(
    isLogObject(sanitizedError) && Object.isFrozen(sanitizedError),
    "Sanitized error object must be frozen.",
  );

  const sanitizedErrorCause = sanitizedError["cause"];
  assertCondition(
    isLogObject(sanitizedErrorCause) && Object.isFrozen(sanitizedErrorCause),
    "Sanitized error cause object must be frozen.",
  );

  const errorCauseArray = sanitizedErrorCause["nestedCauseItems"];
  assertCondition(
    isLogArray(errorCauseArray) && Object.isFrozen(errorCauseArray),
    "Nested error cause array must be frozen.",
  );

  assertCondition(
    !Reflect.set(record, "event", "tampered"),
    "Reflect.set on frozen record must return false.",
  );
  assertCondition(
    !Reflect.set(fields, "injected", "tampered"),
    "Reflect.set on frozen fields root must return false.",
  );
  assertCondition(
    !Reflect.set(nestedArray, 0, "tampered"),
    "Reflect.set on frozen nested array must return false.",
  );
  assertCondition(
    !Reflect.set(nestedObject, "innerKey", "tampered"),
    "Reflect.set on frozen nested object must return false.",
  );
  assertCondition(
    !Reflect.set(sanitizedError, "message", "tampered"),
    "Reflect.set on frozen sanitized error must return false.",
  );
  assertCondition(
    !Reflect.set(errorCauseArray, 0, "tampered"),
    "Reflect.set on frozen error-cause array must return false.",
  );

  const validClock: UtcClock = { now: () => new Date(FIXED_TIMESTAMP) };
  const validSink: LogSink = { write: () => ({ acceptance: "accepted", recordAccepted: true }) };

  assertConstructorInvalidContext(
    { clock: validClock, context: { ...BASE_CONTEXT, component: "" }, sink: validSink },
    "Empty component must throw LoggingError INVALID_CONTEXT.",
  );
  assertConstructorInvalidContext(
    { clock: validClock, context: { ...BASE_CONTEXT, component: "logging e2e" }, sink: validSink },
    "Component containing a space must throw LoggingError INVALID_CONTEXT.",
  );
  assertConstructorInvalidContext(
    { clock: validClock, context: { ...BASE_CONTEXT, runId: "a".repeat(129) }, sink: validSink },
    "Overlong 129-character runId must throw LoggingError INVALID_CONTEXT.",
  );
  assertConstructorInvalidContext(
    { clock: validClock, context: { ...BASE_CONTEXT, runId: "JSESSIONID-secret" }, sink: validSink },
    "Sensitive runId JSESSIONID-secret must throw LoggingError INVALID_CONTEXT.",
  );
  assertConstructorInvalidContext(
    {
      clock: validClock,
      context: { ...BASE_CONTEXT, correlationId: "access-token-secret" },
      sink: validSink,
    },
    "Sensitive correlationId access-token-secret must throw LoggingError INVALID_CONTEXT.",
  );
  assertConstructorInvalidContext(
    { clock: validClock, context: { ...BASE_CONTEXT, component: "session-manager" }, sink: validSink },
    "Sensitive component session-manager must throw LoggingError INVALID_CONTEXT.",
  );
  assertConstructorInvalidContext(
    { clock: validClock, context: BASE_CONTEXT, maximumBufferedRecords: 0, sink: validSink },
    "Queue bound of 0 must throw LoggingError INVALID_CONTEXT.",
  );
  assertConstructorInvalidContext(
    { clock: validClock, context: BASE_CONTEXT, maximumBufferedRecords: 0.5, sink: validSink },
    "Queue bound of 0.5 must throw LoggingError INVALID_CONTEXT.",
  );
  assertConstructorInvalidContext(
    { clock: validClock, context: BASE_CONTEXT, maximumBufferedRecords: 1025, sink: validSink },
    "Queue bound of 1025 must throw LoggingError INVALID_CONTEXT.",
  );

  const throwingClockGetter: UtcClock = {
    get now(): () => Date {
      throw new Error("clock now getter failure");
    },
  };
  assertConstructorInvalidContext(
    { clock: throwingClockGetter, context: BASE_CONTEXT, sink: validSink },
    "Clock with throwing now getter must throw LoggingError INVALID_CONTEXT.",
  );

  const throwingSinkGetter: LogSink = {
    get write(): (record: LogRecord) => LogSinkWriteResult {
      throw new Error("sink write getter failure");
    },
  };
  assertConstructorInvalidContext(
    { clock: validClock, context: BASE_CONTEXT, sink: throwingSinkGetter },
    "Sink with throwing write getter must throw LoggingError INVALID_CONTEXT.",
  );

  const optionsSinkCause = new Error("options sink getter failure");
  const optionsGetterError = assertConstructorInvalidContext(
    {
      clock: validClock,
      context: BASE_CONTEXT,
      get sink(): LogSink {
        throw optionsSinkCause;
      },
    },
    "Options object with throwing sink getter must throw LoggingError INVALID_CONTEXT.",
  );
  assertCondition(
    optionsGetterError.cause === optionsSinkCause,
    "Options sink getter error cause must match original thrown error.",
  );

  const throwingComponentContext: LogContext = {
    get component(): string {
      throw new Error("context component getter failure");
    },
    correlationId: "correlation-e2e-1",
    runId: "run-e2e-1",
  };
  assertConstructorInvalidContext(
    { clock: validClock, context: throwingComponentContext, sink: validSink },
    "Context object with throwing component getter must throw LoggingError INVALID_CONTEXT.",
  );

  const eventValidationLogger = new StructuredLogger({
    clock: validClock,
    context: BASE_CONTEXT,
    sink: validSink,
  });

  const invalidEvents: readonly string[] = [
    "not an event",
    ".logging",
    "logging.",
    "logging.Évent",
    `logging.${"a".repeat(154)}`,
  ];
  for (const invalidEvent of invalidEvents) {
    assertLoggingError(
      () => {
        eventValidationLogger.info(invalidEvent);
      },
      "INVALID_EVENT",
      `Invalid event "${invalidEvent.slice(0, 20)}" must throw LoggingError INVALID_EVENT.`,
    );
  }

  const clockExecutionCause = new Error("clock execution exploded");
  const throwingClockLogger = new StructuredLogger({
    clock: {
      now: () => {
        throw clockExecutionCause;
      },
    },
    context: BASE_CONTEXT,
    sink: validSink,
  });
  const clockExecutionError = assertLoggingError(
    () => {
      throwingClockLogger.info("logging.clock.failure");
    },
    "INVALID_CONTEXT",
    "Logger info call with throwing clock now() must throw LoggingError INVALID_CONTEXT.",
  );
  assertCondition(
    clockExecutionError.cause === clockExecutionCause,
    "Throwing clock error must be preserved as LoggingError cause.",
  );

  const invalidDateLogger = new StructuredLogger({
    clock: { now: () => new Date(NaN) },
    context: BASE_CONTEXT,
    sink: validSink,
  });
  assertLoggingError(
    () => {
      invalidDateLogger.info("logging.invalid.date");
    },
    "INVALID_CONTEXT",
    "Logger info call with clock returning invalid Date must throw LoggingError INVALID_CONTEXT.",
  );

  const acceptanceGetterError = new Error("acceptance getter failure");
  const throwingAcceptanceLogger = new StructuredLogger({
    clock: validClock,
    context: BASE_CONTEXT,
    sink: {
      write: (): LogSinkWriteResult => ({
        get acceptance(): "accepted" | "backpressure" {
          throw acceptanceGetterError;
        },
        recordAccepted: true,
      }),
    },
  });
  assertLoggingError(
    () => {
      throwingAcceptanceLogger.info("logging.sink.acceptance.throw");
    },
    "SINK_FAILURE",
    "Sink write result with throwing acceptance getter must throw LoggingError SINK_FAILURE.",
  );

  const contradictoryResultLogger = new StructuredLogger({
    clock: validClock,
    context: BASE_CONTEXT,
    sink: { write: (): LogSinkWriteResult => ({ acceptance: "accepted", recordAccepted: false }) },
  });
  assertLoggingError(
    () => {
      contradictoryResultLogger.info("logging.sink.contradictory");
    },
    "SINK_FAILURE",
    "Sink write result with acceptance accepted and recordAccepted false must throw LoggingError SINK_FAILURE.",
  );
}
