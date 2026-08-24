import { LoggingError, StderrJsonSink, type LogRecord, type StderrJsonWritable } from "../../src/index.ts";

const CANONICAL_LOG_RECORD: LogRecord = Object.freeze({
  component: "logging-e2e",
  correlationId: "correlation-e2e-1",
  event: "logging.e2e.stderr",
  fields: Object.freeze({ key: "value" }),
  level: "info",
  runId: "run-e2e-1",
  timestamp: "2026-08-24T00:00:00.000Z",
});

class ControlledStderrJsonWritable implements StderrJsonWritable {
  private readonly drainListeners = new Set<(cause?: unknown) => void>();
  private readonly errorListeners = new Set<(cause?: unknown) => void>();
  private readonly writtenChunks: string[] = [];
  private isWriteAccepted: boolean;

  public constructor(isInitiallyAccepted = true) {
    this.isWriteAccepted = isInitiallyAccepted;
  }

  public write(chunk: string): boolean {
    this.writtenChunks.push(chunk);
    return this.isWriteAccepted;
  }

  public once(event: "drain" | "error", listener: (cause?: unknown) => void): void {
    if (event === "drain") {
      this.drainListeners.add(listener);
      return;
    }
    this.errorListeners.add(listener);
  }

  public off(event: "drain" | "error", listener: (cause?: unknown) => void): void {
    if (event === "drain") {
      this.drainListeners.delete(listener);
      return;
    }
    this.errorListeners.delete(listener);
  }

  public getDrainListenerCount(): number {
    return this.drainListeners.size;
  }

  public getErrorListenerCount(): number {
    return this.errorListeners.size;
  }

  public getWrittenChunks(): readonly string[] {
    return this.writtenChunks;
  }

  public emitDrain(): void {
    const snapshot = [...this.drainListeners];
    for (const listener of snapshot) {
      listener();
    }
  }

  public emitError(cause: unknown): void {
    const snapshot = [...this.errorListeners];
    for (const listener of snapshot) {
      listener(cause);
    }
  }
}

function assertCondition(isConditionSatisfied: boolean, message: string): asserts isConditionSatisfied {
  if (!isConditionSatisfied) {
    throw new Error(message);
  }
}

async function assertRejectsWithLoggingError(
  promise: Promise<unknown>,
  expectedCode: LoggingError["code"],
  message: string,
): Promise<LoggingError> {
  let caughtError: unknown;
  try {
    await promise;
  } catch (error: unknown) {
    caughtError = error;
  }
  assertCondition(caughtError instanceof LoggingError && caughtError.code === expectedCode, message);
  return caughtError;
}

export async function runPublicStderrIdleLifecycle(): Promise<void> {
  const sink = new StderrJsonSink();
  const writeResult = sink.write(CANONICAL_LOG_RECORD);
  assertCondition(
    writeResult.acceptance === "accepted" && writeResult.recordAccepted,
    "Default stderr write must be accepted without backpressure.",
  );
  await sink.drain();
  sink.close();
}

export async function runControlledStderrBackpressureDrain(): Promise<void> {
  const writable = new ControlledStderrJsonWritable(false);
  const sink = new StderrJsonSink(writable);

  const firstResult = sink.write(CANONICAL_LOG_RECORD);
  assertCondition(
    firstResult.acceptance === "backpressure" && firstResult.recordAccepted,
    "First write under backpressure must be accepted into backpressure state.",
  );

  const secondResult = sink.write(CANONICAL_LOG_RECORD);
  assertCondition(
    secondResult.acceptance === "backpressure" && !secondResult.recordAccepted,
    "Second write before settlement must report backpressure without accepting record.",
  );

  assertCondition(
    writable.getWrittenChunks().length === 1,
    "Exactly one serialized record must be written to the controlled writable.",
  );
  assertCondition(writable.getDrainListenerCount() === 1, "Exactly one drain listener must be registered.");
  assertCondition(writable.getErrorListenerCount() === 1, "Exactly one error listener must be registered.");

  const drainPromise = sink.drain();
  sink.close();

  assertCondition(
    writable.getDrainListenerCount() === 1,
    "Drain listener must remain registered after close.",
  );
  assertCondition(
    writable.getErrorListenerCount() === 1,
    "Error listener must remain registered after close.",
  );

  writable.emitDrain();
  await drainPromise;

  assertCondition(
    writable.getDrainListenerCount() === 0,
    "Drain listener count must be zero after drain resolution.",
  );
  assertCondition(
    writable.getErrorListenerCount() === 0,
    "Error listener count must be zero after drain resolution.",
  );
  await sink.drain();
}

export async function runControlledStderrBackpressureError(): Promise<void> {
  const writable = new ControlledStderrJsonWritable(false);
  const sink = new StderrJsonSink(writable);

  const writeResult = sink.write(CANONICAL_LOG_RECORD);
  assertCondition(
    writeResult.acceptance === "backpressure" && writeResult.recordAccepted,
    "Write under backpressure must be accepted into backpressure state.",
  );

  const firstDrainPromise = sink.drain();
  const secondDrainPromise = sink.drain();
  assertCondition(
    firstDrainPromise === secondDrainPromise,
    "Concurrent drain calls must return identical Promise instance.",
  );

  const expectedFailure = new Error("controlled stderr failure");
  const firstDrainAssertion = assertRejectsWithLoggingError(
    firstDrainPromise,
    "SINK_FAILURE",
    "First drain promise must reject with LoggingError SINK_FAILURE.",
  );
  const secondDrainAssertion = assertRejectsWithLoggingError(
    secondDrainPromise,
    "SINK_FAILURE",
    "Second drain promise must reject with LoggingError SINK_FAILURE.",
  );

  writable.emitError(expectedFailure);
  const [firstError, secondError] = await Promise.all([firstDrainAssertion, secondDrainAssertion]);

  assertCondition(
    firstError.cause === expectedFailure,
    "First drain error cause must match emitted failure.",
  );
  assertCondition(
    secondError.cause === expectedFailure,
    "Second drain error cause must match emitted failure.",
  );
  assertCondition(
    writable.getDrainListenerCount() === 0,
    "Drain listener count must be zero after error rejection.",
  );
  assertCondition(
    writable.getErrorListenerCount() === 0,
    "Error listener count must be zero after error rejection.",
  );
}
