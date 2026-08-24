import {
  LoggingError,
  StructuredLogger,
  type LogContext,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type LogSinkWriteResult,
} from "../../src/index.ts";

const FIXED_TIMESTAMP = "2026-08-24T00:00:00.000Z";

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

class RecordingSink implements LogSink {
  private readonly storedRecords: LogRecord[] = [];

  public write(record: LogRecord): LogSinkWriteResult {
    this.storedRecords.push(record);
    return { acceptance: "accepted", recordAccepted: true };
  }

  public getStoredEventNames(): readonly string[] {
    return this.storedRecords.map((record) => record.event);
  }
}

class LifecycleSink implements LogSink {
  private readonly storedRecords: LogRecord[] = [];
  public flushCount = 0;
  public closeCount = 0;

  public write(record: LogRecord): LogSinkWriteResult {
    this.storedRecords.push(record);
    return { acceptance: "accepted", recordAccepted: true };
  }

  public flush(): void {
    this.flushCount += 1;
  }

  public close(): void {
    this.closeCount += 1;
  }

  public getStoredRecords(): readonly LogRecord[] {
    return this.storedRecords;
  }
}

class NeverSettlingDrainSink implements LogSink {
  public write(_record: LogRecord): LogSinkWriteResult {
    return { acceptance: "backpressure", recordAccepted: true };
  }

  public drain(): Promise<void> {
    return Promise.withResolvers<never>().promise;
  }
}

function createLogger(
  sink: LogSink,
  maximumBufferedRecords?: number,
  threshold?: LogLevel,
): StructuredLogger {
  return new StructuredLogger({
    clock: { now: () => new Date(FIXED_TIMESTAMP) },
    context: EXACT_CONTEXT,
    sink,
    ...(maximumBufferedRecords !== undefined && { maximumBufferedRecords }),
    ...(threshold !== undefined && { threshold }),
  });
}

export async function runThresholdValidationAndContract(): Promise<void> {
  const sink = new RecordingSink();
  const logger = createLogger(sink, undefined, "warn");

  logger.debug("logging.debug");
  logger.info("logging.info");
  logger.warn("logging.warn");
  logger.error("logging.error");
  await logger.flush();

  const storedEventNames = sink.getStoredEventNames();
  assertCondition(
    storedEventNames.length === 2 &&
      storedEventNames[0] === "logging.warn" &&
      storedEventNames[1] === "logging.error",
    "Stored event names must equal exactly [logging.warn, logging.error] when threshold is warn.",
  );

  let invalidEventError: unknown;
  try {
    logger.info("Invalid Event!");
  } catch (error: unknown) {
    invalidEventError = error;
  }
  assertCondition(
    invalidEventError instanceof LoggingError && invalidEventError.code === "INVALID_EVENT",
    "Invalid event string must synchronously throw LoggingError INVALID_EVENT.",
  );

  let invalidContextError: unknown;
  try {
    new StructuredLogger({
      clock: { now: () => new Date(FIXED_TIMESTAMP) },
      context: EXACT_CONTEXT,
      maximumBufferedRecords: 0,
      sink,
    });
  } catch (error: unknown) {
    invalidContextError = error;
  }
  assertCondition(
    invalidContextError instanceof LoggingError && invalidContextError.code === "INVALID_CONTEXT",
    "Constructing logger with maximumBufferedRecords=0 must synchronously throw LoggingError INVALID_CONTEXT.",
  );
}

export async function runShutdownAndTimeout(): Promise<void> {
  const lifecycleSink = new LifecycleSink();
  const logger = createLogger(lifecycleSink);

  logger.info("logging.lifecycle.event");

  const firstShutdown = logger.shutdown();
  const secondShutdown = logger.shutdown();
  assertCondition(
    firstShutdown === secondShutdown,
    "Concurrent shutdown calls must return the identical Promise instance.",
  );
  await firstShutdown;

  assertCondition(
    lifecycleSink.getStoredRecords().length === 1 &&
      lifecycleSink.flushCount === 1 &&
      lifecycleSink.closeCount === 1,
    "Shutdown must persist exactly one event, one sink flush, and one sink close.",
  );

  let loggingAfterShutdownError: unknown;
  try {
    logger.info("logging.after.shutdown");
  } catch (error: unknown) {
    loggingAfterShutdownError = error;
  }
  assertCondition(
    loggingAfterShutdownError instanceof LoggingError && loggingAfterShutdownError.code === "SHUTDOWN",
    "Synchronous logging after shutdown must throw LoggingError SHUTDOWN.",
  );

  let flushAfterShutdownError: unknown;
  try {
    await logger.flush();
  } catch (error: unknown) {
    flushAfterShutdownError = error;
  }
  assertCondition(
    flushAfterShutdownError instanceof LoggingError && flushAfterShutdownError.code === "SHUTDOWN",
    "Flush after shutdown must reject with LoggingError SHUTDOWN.",
  );

  const timeoutLogger = createLogger(new NeverSettlingDrainSink());
  timeoutLogger.info("logging.timeout.event");

  let flushTimeoutError: unknown;
  try {
    await timeoutLogger.flush({ timeoutMs: 1 });
  } catch (error: unknown) {
    flushTimeoutError = error;
  }
  assertCondition(
    flushTimeoutError instanceof LoggingError && flushTimeoutError.code === "SHUTDOWN",
    "Flush on never-settling drain sink with timeout must reject with LoggingError SHUTDOWN.",
  );

  let shutdownAfterTimeoutError: unknown;
  try {
    await timeoutLogger.shutdown();
  } catch (error: unknown) {
    shutdownAfterTimeoutError = error;
  }
  assertCondition(
    shutdownAfterTimeoutError instanceof LoggingError && shutdownAfterTimeoutError.code === "SHUTDOWN",
    "Subsequent shutdown after timed-out flush must reject with LoggingError SHUTDOWN.",
  );
}
