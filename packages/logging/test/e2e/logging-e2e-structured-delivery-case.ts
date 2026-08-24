import {
  LoggingError,
  StructuredLogger,
  type LogContext,
  type LogRecord,
  type LogSink,
  type LogSinkWriteResult,
  type UtcClock,
} from "../../src/index.ts";

const FIXED_TIMESTAMP = "2026-08-18T00:00:00.000Z";

const BASE_CONTEXT: LogContext = Object.freeze({
  component: "logging-e2e",
  correlationId: "correlation-e2e-1",
  runId: "run-e2e-1",
});

function assertCondition(isConditionSatisfied: boolean, message: string): asserts isConditionSatisfied {
  if (!isConditionSatisfied) throw new Error(message);
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

class ControlledBackpressureSink implements LogSink {
  private isAccepted = false;
  private readonly storedRecords: LogRecord[] = [];

  public write(record: LogRecord): LogSinkWriteResult {
    if (!this.isAccepted) return { acceptance: "backpressure", recordAccepted: false };
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

class ReentrantSink implements LogSink {
  private hasReentered = false;
  private readonly storedRecords: LogRecord[] = [];
  private targetLogger: StructuredLogger | undefined;

  public setLogger(logger: StructuredLogger): void {
    this.targetLogger = logger;
  }

  public write(record: LogRecord): LogSinkWriteResult {
    this.storedRecords.push(record);
    if (!this.hasReentered && this.targetLogger !== undefined) {
      this.hasReentered = true;
      this.targetLogger.info("logging.reentrant");
    }
    return { acceptance: "accepted", recordAccepted: true };
  }

  public getStoredEventNames(): readonly string[] {
    return this.storedRecords.map((record) => record.event);
  }
}

export async function runStructuredDeliveryReentrancyAndCriticalBackpressure(): Promise<void> {
  const fixedClock: UtcClock = { now: () => new Date(FIXED_TIMESTAMP) };

  const reentrantSink = new ReentrantSink();
  const reentrantLogger = new StructuredLogger({
    clock: fixedClock,
    context: BASE_CONTEXT,
    sink: reentrantSink,
  });
  reentrantSink.setLogger(reentrantLogger);
  reentrantLogger.info("logging.outer");

  const storedAfterOuter = reentrantSink.getStoredEventNames();
  assertCondition(
    storedAfterOuter.length === 1 && storedAfterOuter[0] === "logging.outer",
    "After initial outer write, only logging.outer must be delivered to sink.",
  );

  await reentrantLogger.flush();
  const storedAfterFlush = reentrantSink.getStoredEventNames();
  assertCondition(
    storedAfterFlush.length === 2 &&
      storedAfterFlush[0] === "logging.outer" &&
      storedAfterFlush[1] === "logging.reentrant",
    "After flush, exact FIFO events [logging.outer, logging.reentrant] must be delivered.",
  );

  const controlledRecoverySink = new ControlledBackpressureSink();
  const controlledRecoveryLogger = new StructuredLogger({
    clock: fixedClock,
    context: BASE_CONTEXT,
    sink: controlledRecoverySink,
  });
  assertLoggingError(
    () => {
      controlledRecoveryLogger.critical("logging.critical");
    },
    "CRITICAL_DELIVERY",
    "Critical write under backpressure must throw LoggingError CRITICAL_DELIVERY.",
  );
  assertCondition(
    controlledRecoveryLogger.getDroppedNoncriticalRecordCount() === 0,
    "Dropped noncritical record count must remain exactly 0.",
  );
  assertCondition(
    !controlledRecoverySink.getStoredEventNames().includes("logging.critical"),
    "Accepted records must not yet contain the backpressured critical event.",
  );

  controlledRecoverySink.allowAcceptance();
  await controlledRecoveryLogger.flush();
  const storedAfterRecovery = controlledRecoverySink.getStoredEventNames();
  assertCondition(
    storedAfterRecovery.length === 1 && storedAfterRecovery[0] === "logging.critical",
    "Retained critical event must be delivered exactly once after backpressure recovery flush.",
  );

  const invalidWriteResultLogger = new StructuredLogger({
    clock: fixedClock,
    context: BASE_CONTEXT,
    sink: { write: (): LogSinkWriteResult => ({ acceptance: "accepted", recordAccepted: false }) },
  });
  assertLoggingError(
    () => {
      invalidWriteResultLogger.info("logging.sink.failure.accepted.false");
    },
    "SINK_FAILURE",
    "Public noncritical write with accepted and recordAccepted:false must throw SINK_FAILURE.",
  );

  const directWriteError = new Error("direct sink write failure");
  const directWriteThrowingLogger = new StructuredLogger({
    clock: fixedClock,
    context: BASE_CONTEXT,
    sink: {
      write: () => {
        throw directWriteError;
      },
    },
  });
  const caughtDirectWriteError = assertLoggingError(
    () => {
      directWriteThrowingLogger.info("logging.sink.direct.throw");
    },
    "SINK_FAILURE",
    "Public noncritical write when sink.write throws must throw SINK_FAILURE.",
  );
  assertCondition(
    caughtDirectWriteError.cause === directWriteError,
    "SINK_FAILURE cause must equal the exact error thrown by sink.write.",
  );

  const primitiveResultSink: LogSink = {
    write: (): LogSinkWriteResult => ({ acceptance: "accepted", recordAccepted: true }),
  };
  Object.defineProperty(primitiveResultSink, "write", {
    value: (): string => "invalid",
  });
  const primitiveResultLogger = new StructuredLogger({
    clock: fixedClock,
    context: BASE_CONTEXT,
    sink: primitiveResultSink,
  });
  assertLoggingError(
    () => {
      primitiveResultLogger.info("logging.sink.failure.primitive.result");
    },
    "SINK_FAILURE",
    "Public noncritical write with a primitive result must throw SINK_FAILURE.",
  );
}
