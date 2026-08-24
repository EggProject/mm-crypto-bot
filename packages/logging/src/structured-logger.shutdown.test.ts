import { describe, expect, it, vi } from "vitest";

import type { LogRecord, LogSink, LogSinkWriteResult, UtcClock } from "./contracts.js";
import { LoggingError } from "./contracts.js";
import { StructuredLogger } from "./structured-logger.js";

class FixedUtcClock implements UtcClock {
  public now(): Date {
    return new Date("2026-08-18T00:00:00.000Z");
  }
}

class RecordingSink implements LogSink {
  public readonly records: LogRecord[] = [];
  public closeCount = 0;
  public flushCount = 0;
  public shouldFailFlush = false;
  public shouldFailClose = false;

  public write(record: LogRecord): LogSinkWriteResult {
    this.records.push(record);
    return { acceptance: "accepted", recordAccepted: true };
  }

  public flush(): void {
    if (this.shouldFailFlush) throw new Error("flush failed");
    this.flushCount += 1;
  }

  public close(): void {
    if (this.shouldFailClose) throw new Error("close failed");
    this.closeCount += 1;
  }
}

class DeferredDrainSink implements LogSink {
  private readonly pendingDrain: Promise<void>;
  private resolvePendingDrain: (() => void) | undefined;
  public readonly records: LogRecord[] = [];
  public closeCount = 0;
  public drainCount = 0;
  public flushCount = 0;

  public constructor() {
    this.pendingDrain = new Promise<void>((resolve) => {
      this.resolvePendingDrain = resolve;
    });
  }

  public write(record: LogRecord): LogSinkWriteResult {
    this.records.push(record);
    return { acceptance: "backpressure", recordAccepted: true };
  }

  public drain(): Promise<void> {
    this.drainCount += 1;
    return this.pendingDrain;
  }

  public close(): void {
    this.closeCount += 1;
  }

  public flush(): void {
    this.flushCount += 1;
  }

  public completeDrain(): void {
    this.resolvePendingDrain?.();
    this.resolvePendingDrain = undefined;
  }
}

class DeferredFlushSink implements LogSink {
  private readonly pendingFlush: Promise<void>;
  private resolvePendingFlush: (() => void) | undefined;
  public closeCount = 0;
  public flushCount = 0;

  public constructor() {
    this.pendingFlush = new Promise<void>((resolve) => {
      this.resolvePendingFlush = resolve;
    });
  }

  public write(record: LogRecord): LogSinkWriteResult {
    void record;
    return { acceptance: "accepted", recordAccepted: true };
  }

  public flush(): Promise<void> {
    this.flushCount += 1;
    return this.pendingFlush;
  }

  public close(): void {
    this.closeCount += 1;
  }

  public completeFlush(): void {
    this.resolvePendingFlush?.();
    this.resolvePendingFlush = undefined;
  }
}

class DeferredCloseSink implements LogSink {
  private readonly pendingClose: Promise<void>;
  private resolvePendingClose: (() => void) | undefined;
  public closeCount = 0;

  public constructor() {
    this.pendingClose = new Promise<void>((resolve) => {
      this.resolvePendingClose = resolve;
    });
  }

  public write(record: LogRecord): LogSinkWriteResult {
    void record;
    return { acceptance: "accepted", recordAccepted: true };
  }

  public close(): Promise<void> {
    this.closeCount += 1;
    return this.pendingClose;
  }

  public completeClose(): void {
    this.resolvePendingClose?.();
    this.resolvePendingClose = undefined;
  }
}

function createLogger(sink: LogSink = new RecordingSink(), maximumBufferedRecords = 2): StructuredLogger {
  return new StructuredLogger({
    clock: new FixedUtcClock(),
    context: { component: "logging-test", correlationId: "correlation-1", runId: "run-1" },
    maximumBufferedRecords,
    sink,
    threshold: "debug",
  });
}

function expectLoggingError(action: () => void, code: LoggingError["code"]): LoggingError {
  try {
    action();
  } catch (error) {
    if (error instanceof LoggingError) {
      expect(error.code).toBe(code);
      return error;
    }
    throw error;
  }
  throw new Error(`Expected ${code} logging error.`);
}

async function expectAsyncLoggingError(
  action: () => Promise<void>,
  code: LoggingError["code"],
): Promise<LoggingError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof LoggingError) {
      expect(error.code).toBe(code);
      return error;
    }
    throw error;
  }
  throw new Error(`Expected ${code} logging error.`);
}

describe("StructuredLogger", () => {
  it("flushes and closes once, then rejects later writes", async () => {
    const sink = new RecordingSink();
    const logger = createLogger(sink);
    logger.info("logging.shutdown");
    await logger.shutdown();
    await logger.shutdown();
    expect(sink.records).toHaveLength(1);
    expect(sink.closeCount).toBe(1);
    expectLoggingError(() => {
      logger.info("logging.after-shutdown");
    }, "SHUTDOWN");
  });

  it("maps a flush failure to a typed error and permits a later flush", async () => {
    const sink = new RecordingSink();
    const logger = createLogger(sink);
    sink.shouldFailFlush = true;
    await expectAsyncLoggingError(() => logger.flush(), "SINK_FAILURE");
    sink.shouldFailFlush = false;
    await logger.flush();
  });

  it("fails closed after a sink close failure", async () => {
    const sink = new RecordingSink();
    const logger = createLogger(sink);
    sink.shouldFailClose = true;

    const shutdown = logger.shutdown();
    await expectAsyncLoggingError(() => shutdown, "SINK_FAILURE");
    expect(logger.shutdown()).toBe(shutdown);
    expectLoggingError(() => {
      logger.info("logging.after.close.failure");
    }, "SHUTDOWN");
    await expectAsyncLoggingError(() => logger.flush(), "SHUTDOWN");
  });

  it("awaits a sink drain before closing records accepted under backpressure", async () => {
    const sink = new DeferredDrainSink();
    const logger = createLogger(sink);
    logger.critical("logging.critical");

    const shutdown = logger.shutdown({ timeoutMs: 1000 });
    expect(logger.shutdown({ timeoutMs: 1000 })).toBe(shutdown);
    await Promise.resolve();
    expect(sink.records.map((record) => record.event)).toEqual(["logging.critical"]);
    expect(sink.flushCount).toBe(0);
    expect(sink.closeCount).toBe(0);

    sink.completeDrain();
    await shutdown;
    expect(sink.closeCount).toBe(1);
  });

  it("waits for an accepted backpressured record before a public sink flush", async () => {
    const sink = new DeferredDrainSink();
    const logger = createLogger(sink);
    logger.info("logging.accepted.backpressure");

    const flush = logger.flush();
    await Promise.resolve();
    expect(sink.flushCount).toBe(0);

    sink.completeDrain();
    await flush;
    expect(sink.flushCount).toBe(1);
  });

  it("times out a stalled public flush and prevents later sink operations after a late drain", async () => {
    vi.useFakeTimers();
    try {
      const sink = new DeferredDrainSink();
      const logger = createLogger(sink);
      logger.info("logging.stalled.flush");

      const flush = logger.flush({ timeoutMs: 10 });
      const shutdown = logger.shutdown({ timeoutMs: 1000 });
      await Promise.resolve();
      await Promise.resolve();
      expect(sink.drainCount).toBe(1);
      expect(sink.flushCount).toBe(0);
      expect(sink.closeCount).toBe(0);

      vi.advanceTimersByTime(10);
      await expectAsyncLoggingError(() => flush, "SHUTDOWN");
      await expectAsyncLoggingError(() => shutdown, "SHUTDOWN");
      await expectAsyncLoggingError(() => logger.flush(), "SHUTDOWN");
      await expectAsyncLoggingError(() => logger.shutdown(), "SHUTDOWN");

      sink.completeDrain();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(sink.flushCount).toBe(0);
      expect(sink.closeCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("remains closed to lifecycle operations when a timed-out sink flush completes late", async () => {
    vi.useFakeTimers();
    try {
      const sink = new DeferredFlushSink();
      const logger = createLogger(sink);

      const flush = logger.flush({ timeoutMs: 10 });
      await Promise.resolve();
      expect(sink.flushCount).toBe(1);

      vi.advanceTimersByTime(10);
      await expectAsyncLoggingError(() => flush, "SHUTDOWN");
      await expectAsyncLoggingError(() => logger.shutdown(), "SHUTDOWN");

      sink.completeFlush();
      await Promise.resolve();
      await Promise.resolve();
      expect(sink.closeCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails shutdown on timeout without closing after a late drain", async () => {
    vi.useFakeTimers();
    try {
      const sink = new DeferredDrainSink();
      const logger = createLogger(sink);
      logger.critical("logging.critical");

      const shutdown = logger.shutdown({ timeoutMs: 10 });
      await Promise.resolve();
      await Promise.resolve();
      expect(sink.drainCount).toBe(1);
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      await expectAsyncLoggingError(() => shutdown, "SHUTDOWN");
      expect(sink.closeCount).toBe(0);

      sink.completeDrain();
      await Promise.resolve();
      expect(sink.closeCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps an awaited sink drain rejection to a typed sink failure", async () => {
    const sink: LogSink = {
      drain: (): Promise<void> => Promise.reject(new Error("drain failed")),
      write: (): LogSinkWriteResult => ({ acceptance: "backpressure", recordAccepted: false }),
    };
    const logger = createLogger(sink);
    logger.info("logging.buffered");

    await expectAsyncLoggingError(() => logger.flush(), "SINK_FAILURE");
  });

  it("does not close after timing out during the sink flush", async () => {
    vi.useFakeTimers();
    try {
      const sink = new DeferredFlushSink();
      const logger = createLogger(sink);
      logger.info("logging.flush");

      const shutdown = logger.shutdown({ timeoutMs: 10 });
      await Promise.resolve();
      await Promise.resolve();
      expect(sink.flushCount).toBe(1);
      vi.advanceTimersByTime(10);
      await expectAsyncLoggingError(() => shutdown, "SHUTDOWN");
      expect(sink.closeCount).toBe(0);

      sink.completeFlush();
      await Promise.resolve();
      await Promise.resolve();
      expect(sink.closeCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the logger closed to writes and concurrent shutdown while a timed-out close is still in flight", async () => {
    vi.useFakeTimers();
    try {
      const sink = new DeferredCloseSink();
      const logger = createLogger(sink);
      logger.info("logging.close");

      const shutdown = logger.shutdown({ timeoutMs: 10 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(sink.closeCount).toBe(1);
      expect(logger.shutdown({ timeoutMs: 10 })).toBe(shutdown);

      const shutdownFailure = expectAsyncLoggingError(() => shutdown, "SHUTDOWN");
      vi.advanceTimersByTime(10);
      await shutdownFailure;
      expectLoggingError(() => {
        logger.info("logging.after.close.timeout");
      }, "SHUTDOWN");
      expect(logger.shutdown({ timeoutMs: 10 })).toBe(shutdown);
      expect(sink.closeCount).toBe(1);

      sink.completeClose();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await expectAsyncLoggingError(() => logger.shutdown(), "SHUTDOWN");
      expect(sink.closeCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes an active public flush before shutdown closes the sink", async () => {
    const sink = new DeferredFlushSink();
    const logger = createLogger(sink);
    logger.info("logging.concurrent.flush.shutdown");

    const flush = logger.flush();
    const shutdown = logger.shutdown();
    await Promise.resolve();
    expect(sink.flushCount).toBe(1);
    expect(sink.closeCount).toBe(0);
    await expectAsyncLoggingError(() => logger.flush(), "SHUTDOWN");

    sink.completeFlush();
    await flush;
    await shutdown;
    expect(sink.flushCount).toBe(2);
    expect(sink.closeCount).toBe(1);
  });

  it("fails shutdown without closing when an active public flush exceeds its timeout", async () => {
    vi.useFakeTimers();
    try {
      const sink = new DeferredFlushSink();
      const logger = createLogger(sink);
      const flush = logger.flush();
      const shutdown = logger.shutdown({ timeoutMs: 10 });
      await Promise.resolve();
      expect(sink.flushCount).toBe(1);

      vi.advanceTimersByTime(10);
      await expectAsyncLoggingError(() => shutdown, "SHUTDOWN");
      sink.completeFlush();
      await flush;
      await Promise.resolve();
      expect(sink.closeCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects flush after a completed shutdown without calling the sink again", async () => {
    const sink = new RecordingSink();
    const logger = createLogger(sink);
    await logger.shutdown();
    const flushCountAfterShutdown = sink.flushCount;

    await expectAsyncLoggingError(() => logger.flush(), "SHUTDOWN");
    expect(sink.flushCount).toBe(flushCountAfterShutdown);
  });

  it("rejects invalid shutdown timeout bounds", async () => {
    const logger = createLogger();

    await expectAsyncLoggingError(() => logger.shutdown({ timeoutMs: 0.5 }), "INVALID_CONTEXT");
    await expectAsyncLoggingError(() => logger.shutdown({ timeoutMs: 0 }), "INVALID_CONTEXT");
    await expectAsyncLoggingError(() => logger.shutdown({ timeoutMs: 60_001 }), "INVALID_CONTEXT");
  });

  it("rejects invalid public flush timeout bounds", async () => {
    const logger = createLogger();

    await expectAsyncLoggingError(() => logger.flush({ timeoutMs: 0.5 }), "INVALID_CONTEXT");
    await expectAsyncLoggingError(() => logger.flush({ timeoutMs: 0 }), "INVALID_CONTEXT");
    await expectAsyncLoggingError(() => logger.flush({ timeoutMs: 60_001 }), "INVALID_CONTEXT");
  });
});
