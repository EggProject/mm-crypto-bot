import {
  LoggingError,
  StructuredLogger,
  type LogContext,
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

class ControlledBackpressureRecoverySink implements LogSink {
  private isAccepted = false;
  private readonly storedRecords: LogRecord[] = [];

  public write(record: LogRecord): LogSinkWriteResult {
    if (!this.isAccepted) {
      return { acceptance: "backpressure", recordAccepted: false };
    }
    this.storedRecords.push(record);
    return { acceptance: "accepted", recordAccepted: true };
  }

  public allowAcceptance(): void {
    this.isAccepted = true;
  }

  public getStoredEventNames(): readonly string[] {
    return this.storedRecords.map((record) => record.event);
  }
}

class ControlledDrainFailureSink implements LogSink {
  public write(_record: LogRecord): LogSinkWriteResult {
    return { acceptance: "backpressure", recordAccepted: true };
  }

  public async drain(): Promise<void> {
    await Promise.resolve();
    throw new Error("controlled drain failure");
  }
}

function createLogger(sink: LogSink, maximumBufferedRecords?: number): StructuredLogger {
  return new StructuredLogger({
    clock: { now: () => new Date(FIXED_TIMESTAMP) },
    context: EXACT_CONTEXT,
    sink,
    ...(maximumBufferedRecords !== undefined && { maximumBufferedRecords }),
  });
}

export async function runControlledSinkBackpressureRecovery(): Promise<void> {
  const sink = new ControlledBackpressureRecoverySink();
  const logger = createLogger(sink, 1);

  logger.info("logging.first");
  logger.warn("logging.dropped");

  assertCondition(logger.getDroppedNoncriticalRecordCount() === 1, "Dropped noncritical count must equal 1.");

  let rejectedFirstFlushError: unknown;
  try {
    await logger.flush();
  } catch (error: unknown) {
    rejectedFirstFlushError = error;
  }
  assertCondition(
    rejectedFirstFlushError instanceof LoggingError && rejectedFirstFlushError.code === "BACKPRESSURE",
    "First flush must reject with LoggingError code BACKPRESSURE.",
  );

  await Promise.resolve();
  sink.allowAcceptance();
  await logger.flush();

  logger.critical("logging.critical");
  await logger.flush();

  const storedEventNames = sink.getStoredEventNames();
  assertCondition(
    storedEventNames.length === 2 &&
      storedEventNames[0] === "logging.first" &&
      storedEventNames[1] === "logging.critical",
    "Stored event names must equal exactly [logging.first, logging.critical].",
  );
}

export async function runControlledSinkDrainFailure(): Promise<void> {
  const sink = new ControlledDrainFailureSink();
  const logger = createLogger(sink);

  logger.info("logging.controlled.drain.failure");

  let rejectedFlushError: unknown;
  try {
    await logger.flush();
  } catch (error: unknown) {
    rejectedFlushError = error;
  }
  assertCondition(
    rejectedFlushError instanceof LoggingError &&
      rejectedFlushError.code === "SINK_FAILURE" &&
      rejectedFlushError.cause instanceof Error &&
      rejectedFlushError.cause.message === "controlled drain failure",
    "Flush must reject with LoggingError code SINK_FAILURE preserving the Error cause.",
  );
}

export async function runControlledCriticalFullQueue(): Promise<void> {
  const sink = new ControlledBackpressureRecoverySink();
  const logger = createLogger(sink, 1);

  logger.info("logging.first");

  let criticalDeliveryError: unknown;
  try {
    logger.critical("logging.second.critical");
  } catch (error: unknown) {
    criticalDeliveryError = error;
  }
  assertCondition(
    criticalDeliveryError instanceof LoggingError && criticalDeliveryError.code === "CRITICAL_DELIVERY",
    "Calling critical when the queue is full must synchronously throw LoggingError CRITICAL_DELIVERY.",
  );

  sink.allowAcceptance();
  await logger.flush();

  const storedEventNames = sink.getStoredEventNames();
  assertCondition(
    storedEventNames.length === 1 && storedEventNames[0] === "logging.first",
    "The sink must store exactly the first noncritical event.",
  );
  assertCondition(
    !storedEventNames.includes("logging.second.critical"),
    "The sink must never store the rejected critical event.",
  );
}
