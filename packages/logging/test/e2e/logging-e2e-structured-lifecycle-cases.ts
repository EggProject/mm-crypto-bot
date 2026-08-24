import {
  LoggingError,
  StructuredLogger,
  type LogRecord,
  type LogSink,
  type LogSinkWriteResult,
  type UtcClock,
} from "../../src/index.ts";

const FIXED_TIMESTAMP = "2026-08-24T00:00:00.000Z";

const fixedClock: UtcClock = Object.freeze({ now: () => new Date(FIXED_TIMESTAMP) });

function assertCondition(isConditionSatisfied: boolean, message: string): asserts isConditionSatisfied {
  if (!isConditionSatisfied) throw new Error(message);
}

function createLogger(sink: LogSink): StructuredLogger {
  return new StructuredLogger({
    clock: fixedClock,
    context: { component: "logging-e2e", correlationId: "correlation-e2e-1", runId: "run-e2e-1" },
    sink,
  });
}

async function expectLoggingError(
  operation: Promise<void>,
  expectedCode: LoggingError["code"],
  message: string,
): Promise<LoggingError> {
  try {
    await operation;
  } catch (error: unknown) {
    assertCondition(error instanceof LoggingError, `${message} Expected a LoggingError.`);
    assertCondition(
      error.code === expectedCode,
      `${message} Expected ${expectedCode}, received ${error.code}.`,
    );
    return error;
  }
  throw new Error(`${message} Expected rejection.`);
}

async function waitForTwoMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function hasSameCounts(expectedCounts: readonly number[], actualCounts: readonly number[]): boolean {
  if (expectedCounts.length !== actualCounts.length) return false;
  const actualIterator = actualCounts.values();
  for (const expectedCount of expectedCounts) {
    const nextActual = actualIterator.next();
    if (nextActual.done || nextActual.value !== expectedCount) return false;
  }
  return true;
}

class AcceptedBackpressureSink implements LogSink {
  public drainCount = 0;
  public flushCount = 0;
  public writeCount = 0;

  public write(_record: LogRecord): LogSinkWriteResult {
    this.writeCount += 1;
    return { acceptance: "backpressure", recordAccepted: true };
  }

  public drain(): Promise<void> {
    this.drainCount += 1;
    return Promise.resolve();
  }

  public flush(): void {
    this.flushCount += 1;
  }
}

class DeferredDrainSink implements LogSink {
  private readonly drainCompletion = Promise.withResolvers<undefined>();
  private readonly drainEntry = Promise.withResolvers<undefined>();
  public closeCount = 0;
  public drainCount = 0;
  public flushCount = 0;
  public writeCount = 0;

  public write(_record: LogRecord): LogSinkWriteResult {
    this.writeCount += 1;
    return { acceptance: "backpressure", recordAccepted: true };
  }

  public drain(): Promise<void> {
    this.drainCount += 1;
    this.drainEntry.resolve(undefined);
    return this.drainCompletion.promise;
  }

  public flush(): void {
    this.flushCount += 1;
  }

  public close(): void {
    this.closeCount += 1;
  }

  public waitForDrain(): Promise<void> {
    return this.drainEntry.promise;
  }

  public resolveDrain(): void {
    this.drainCompletion.resolve(undefined);
  }
}

class DeferredFlushSink implements LogSink {
  private readonly flushCompletion = Promise.withResolvers<undefined>();
  private readonly flushEntry = Promise.withResolvers<undefined>();
  public closeCount = 0;
  public flushCount = 0;
  public writeCount = 0;

  public write(_record: LogRecord): LogSinkWriteResult {
    this.writeCount += 1;
    return { acceptance: "accepted", recordAccepted: true };
  }

  public flush(): Promise<void> {
    this.flushCount += 1;
    this.flushEntry.resolve(undefined);
    return this.flushCompletion.promise;
  }

  public close(): void {
    this.closeCount += 1;
  }

  public waitForFlush(): Promise<void> {
    return this.flushEntry.promise;
  }

  public resolveFlush(): void {
    this.flushCompletion.resolve(undefined);
  }
}

class ThrowingFlushSink implements LogSink {
  public constructor(private readonly flushError: Error) {}

  public write(_record: LogRecord): LogSinkWriteResult {
    return { acceptance: "accepted", recordAccepted: true };
  }

  public flush(): void {
    throw this.flushError;
  }
}

class ThrowingCloseSink implements LogSink {
  public constructor(private readonly closeError: Error) {}

  public write(_record: LogRecord): LogSinkWriteResult {
    return { acceptance: "accepted", recordAccepted: true };
  }

  public close(): void {
    throw this.closeError;
  }
}

class DeferredCloseSink implements LogSink {
  private readonly closeCompletion = Promise.withResolvers<undefined>();
  private readonly closeEntry = Promise.withResolvers<undefined>();
  public closeCount = 0;

  public write(_record: LogRecord): LogSinkWriteResult {
    return { acceptance: "accepted", recordAccepted: true };
  }

  public close(): Promise<void> {
    this.closeCount += 1;
    this.closeEntry.resolve(undefined);
    return this.closeCompletion.promise;
  }

  public waitForClose(): Promise<void> {
    return this.closeEntry.promise;
  }

  public resolveClose(): void {
    this.closeCompletion.resolve(undefined);
  }
}

export async function runStructuredFlushLateTimeoutAndFailures(): Promise<void> {
  const acceptedBackpressureSink = new AcceptedBackpressureSink();
  const acceptedBackpressureLogger = createLogger(acceptedBackpressureSink);
  acceptedBackpressureLogger.info("logging.accepted.backpressure");
  await acceptedBackpressureLogger.flush();
  assertCondition(
    acceptedBackpressureSink.writeCount === 1 &&
      acceptedBackpressureSink.drainCount === 1 &&
      acceptedBackpressureSink.flushCount === 1,
    "An accepted backpressured record must drain once, flush once, and never be written twice.",
  );

  const deferredDrainSink = new DeferredDrainSink();
  const deferredDrainLogger = createLogger(deferredDrainSink);
  deferredDrainLogger.info("logging.flush.deferred.drain");
  const deferredDrainFlush = deferredDrainLogger.flush({ timeoutMs: 1 });
  await deferredDrainSink.waitForDrain();
  await expectLoggingError(deferredDrainFlush, "SHUTDOWN", "A timed-out deferred drain flush");
  deferredDrainSink.resolveDrain();
  await waitForTwoMicrotasks();
  assertCondition(
    deferredDrainSink.flushCount === 0 && deferredDrainSink.closeCount === 0,
    "A late drain completion must not advance flush or close lifecycle work.",
  );
  const deferredDrainLifecycleCounts = [
    deferredDrainSink.drainCount,
    deferredDrainSink.flushCount,
    deferredDrainSink.closeCount,
  ];
  await expectLoggingError(deferredDrainLogger.flush(), "SHUTDOWN", "Flush after a timed-out drain");
  await expectLoggingError(deferredDrainLogger.shutdown(), "SHUTDOWN", "Shutdown after a timed-out drain");
  assertCondition(
    hasSameCounts(deferredDrainLifecycleCounts, [
      deferredDrainSink.drainCount,
      deferredDrainSink.flushCount,
      deferredDrainSink.closeCount,
    ]),
    "Later lifecycle calls after a timed-out drain must not create new sink work.",
  );

  const deferredFlushSink = new DeferredFlushSink();
  const deferredFlushLogger = createLogger(deferredFlushSink);
  deferredFlushLogger.info("logging.flush.deferred.flush");
  const deferredSinkFlush = deferredFlushLogger.flush({ timeoutMs: 1 });
  await deferredFlushSink.waitForFlush();
  await expectLoggingError(deferredSinkFlush, "SHUTDOWN", "A timed-out deferred sink flush");
  deferredFlushSink.resolveFlush();
  await waitForTwoMicrotasks();
  assertCondition(
    deferredFlushSink.flushCount === 1 && deferredFlushSink.closeCount === 0,
    "A late sink flush completion must not start any further lifecycle work.",
  );
  const deferredFlushLifecycleCounts = [deferredFlushSink.flushCount, deferredFlushSink.closeCount];
  await expectLoggingError(deferredFlushLogger.flush(), "SHUTDOWN", "Flush after a timed-out sink flush");
  await expectLoggingError(
    deferredFlushLogger.shutdown(),
    "SHUTDOWN",
    "Shutdown after a timed-out sink flush",
  );
  assertCondition(
    hasSameCounts(deferredFlushLifecycleCounts, [deferredFlushSink.flushCount, deferredFlushSink.closeCount]),
    "Later lifecycle calls after a timed-out sink flush must not repeat sink work.",
  );

  const flushError = new Error("fixed flush failure");
  const throwingFlushLogger = createLogger(new ThrowingFlushSink(flushError));
  throwingFlushLogger.info("logging.flush.failure");
  const sinkFailure = await expectLoggingError(
    throwingFlushLogger.flush(),
    "SINK_FAILURE",
    "A throwing sink flush",
  );
  assertCondition(sinkFailure.cause === flushError, "Flush SINK_FAILURE must preserve the exact sink error.");

  for (const timeoutMs of [0, 0.5, 60_001]) {
    const invalidTimeoutLogger = createLogger(new AcceptedBackpressureSink());
    await expectLoggingError(
      invalidTimeoutLogger.flush({ timeoutMs }),
      "INVALID_CONTEXT",
      `Flush timeout ${String(timeoutMs)}`,
    );
  }
}

export async function runStructuredShutdownLateTimeoutAndFailures(): Promise<void> {
  const activeFlushSink = new DeferredFlushSink();
  const activeFlushLogger = createLogger(activeFlushSink);
  activeFlushLogger.info("logging.shutdown.active.flush");
  const activeFlush = activeFlushLogger.flush({ timeoutMs: 60_000 });
  await activeFlushSink.waitForFlush();
  const timedOutShutdown = activeFlushLogger.shutdown({ timeoutMs: 1 });
  await expectLoggingError(timedOutShutdown, "SHUTDOWN", "Shutdown waiting for an active public flush");
  activeFlushSink.resolveFlush();
  await waitForTwoMicrotasks();
  await activeFlush;
  assertCondition(activeFlushSink.closeCount === 0, "Late active flush completion must not close the sink.");
  const activeFlushLifecycleCounts = [activeFlushSink.flushCount, activeFlushSink.closeCount];
  await expectLoggingError(activeFlushLogger.shutdown(), "SHUTDOWN", "Shutdown after active flush timeout");
  await expectLoggingError(activeFlushLogger.flush(), "SHUTDOWN", "Flush after active flush timeout");
  assertCondition(
    hasSameCounts(activeFlushLifecycleCounts, [activeFlushSink.flushCount, activeFlushSink.closeCount]),
    "Later lifecycle calls after active flush timeout must not create sink work.",
  );

  const deferredDrainSink = new DeferredDrainSink();
  const deferredDrainLogger = createLogger(deferredDrainSink);
  deferredDrainLogger.info("logging.shutdown.deferred.drain");
  const deferredDrainShutdown = deferredDrainLogger.shutdown({ timeoutMs: 1 });
  await deferredDrainSink.waitForDrain();
  await expectLoggingError(deferredDrainShutdown, "SHUTDOWN", "Shutdown with deferred drain");
  deferredDrainSink.resolveDrain();
  await waitForTwoMicrotasks();
  assertCondition(
    deferredDrainSink.flushCount === 0 && deferredDrainSink.closeCount === 0,
    "Late shutdown drain completion must not advance to flush or close.",
  );

  const deferredFlushSink = new DeferredFlushSink();
  const deferredFlushLogger = createLogger(deferredFlushSink);
  deferredFlushLogger.info("logging.shutdown.deferred.flush");
  const deferredFlushShutdown = deferredFlushLogger.shutdown({ timeoutMs: 1 });
  await deferredFlushSink.waitForFlush();
  await expectLoggingError(deferredFlushShutdown, "SHUTDOWN", "Shutdown with deferred sink flush");
  deferredFlushSink.resolveFlush();
  await waitForTwoMicrotasks();
  assertCondition(
    deferredFlushSink.flushCount === 1 && deferredFlushSink.closeCount === 0,
    "Late shutdown sink flush completion must not advance to close.",
  );

  const closeError = new Error("fixed close failure");
  const throwingCloseLogger = createLogger(new ThrowingCloseSink(closeError));
  throwingCloseLogger.info("logging.shutdown.close.failure");
  const closeFailure = await expectLoggingError(
    throwingCloseLogger.shutdown(),
    "SINK_FAILURE",
    "A throwing sink close",
  );
  assertCondition(
    closeFailure.cause === closeError,
    "Shutdown SINK_FAILURE must preserve the exact close error.",
  );

  for (const timeoutMs of [0, 0.5, 60_001]) {
    const invalidTimeoutLogger = createLogger(new AcceptedBackpressureSink());
    await expectLoggingError(
      invalidTimeoutLogger.shutdown({ timeoutMs }),
      "INVALID_CONTEXT",
      `Shutdown timeout ${String(timeoutMs)}`,
    );
  }

  const deferredCloseSink = new DeferredCloseSink();
  const deferredCloseLogger = createLogger(deferredCloseSink);
  deferredCloseLogger.info("logging.shutdown.concurrent.close");
  const firstShutdown = deferredCloseLogger.shutdown({ timeoutMs: 60_000 });
  const secondShutdown = deferredCloseLogger.shutdown({ timeoutMs: 60_000 });
  assertCondition(
    firstShutdown === secondShutdown,
    "Concurrent shutdown calls must return the identical Promise instance.",
  );
  await deferredCloseSink.waitForClose();
  assertCondition(
    deferredCloseSink.closeCount === 1,
    "Concurrent shutdown must enter sink.close exactly once.",
  );
  const closeCountsAtCloseEntry = [deferredCloseSink.closeCount];
  deferredCloseSink.resolveClose();
  await firstShutdown;
  assertCondition(
    hasSameCounts(closeCountsAtCloseEntry, [deferredCloseSink.closeCount]),
    "Concurrent shutdown must close the sink exactly once.",
  );
}
