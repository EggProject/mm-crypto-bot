import { describe, expect, it } from "vitest";

import type {
  LogRecord,
  LogSink,
  LogSinkAcceptance,
  LogSinkWriteResult,
  LogObject,
  LogValue,
  UtcClock,
} from "./contracts.js";
import { LoggingError } from "./contracts.js";
import { StructuredLogger } from "./structured-logger.js";

class FixedUtcClock implements UtcClock {
  public now(): Date {
    return new Date("2026-08-18T00:00:00.000Z");
  }
}

class RecordingSink implements LogSink {
  public readonly records: LogRecord[] = [];
  public flushCount = 0;
  public acceptance: LogSinkAcceptance = "accepted";
  public shouldFailWrites = false;

  public write(record: LogRecord): LogSinkWriteResult {
    if (this.shouldFailWrites) throw new Error("sink failed");
    if (this.acceptance === "accepted") this.records.push(record);
    return { acceptance: this.acceptance, recordAccepted: this.acceptance === "accepted" };
  }

  public flush(): void {
    this.flushCount += 1;
  }
}

class MinimalSink implements LogSink {
  public write(record: LogRecord): LogSinkWriteResult {
    void record;
    return { acceptance: "accepted", recordAccepted: true };
  }
}

class ReentrantSink implements LogSink {
  private hasReentered = false;
  public readonly records: LogRecord[] = [];
  public logger: StructuredLogger | undefined;

  public write(record: LogRecord): LogSinkWriteResult {
    this.records.push(record);
    if (!this.hasReentered && this.logger !== undefined) {
      this.hasReentered = true;
      this.logger.info("logging.reentrant");
    }
    return { acceptance: "accepted", recordAccepted: true };
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

function isLogArray(value: LogValue): value is readonly LogValue[] {
  return Array.isArray(value);
}

function isLogObject(value: LogValue): value is LogObject {
  return typeof value === "object" && value !== null && !isLogArray(value);
}

function getLogObject(value: LogValue): LogObject {
  if (!isLogObject(value)) {
    throw new TypeError("Expected a structured log object.");
  }
  return value;
}

function getLogArray(value: LogValue): readonly LogValue[] {
  if (!isLogArray(value)) throw new TypeError("Expected a structured log array.");
  return value;
}

function expectDeeplyFrozenLogValue(value: LogValue): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nestedValue of Object.values(value)) {
    expectDeeplyFrozenLogValue(nestedValue);
  }
}

describe("StructuredLogger", () => {
  it("delivers an immutable structured record immediately", async () => {
    const sink = new RecordingSink();
    const logger = new StructuredLogger({
      clock: new FixedUtcClock(),
      context: {
        component: "logging-test",
        correlationId: "correlation-1",
        datasetId: "dataset-1",
        orderId: "order-1",
        runId: "run-1",
        strategyId: "strategy-1",
        symbol: "BTC-USDC",
      },
      sink,
      threshold: "debug",
    });
    logger.info("logging.record", { amount: 12.5, symbol: "BTC/USDC" });
    expect(sink.records).toEqual([
      {
        component: "logging-test",
        correlationId: "correlation-1",
        datasetId: "dataset-1",
        event: "logging.record",
        fields: { amount: "12.5", symbol: "BTC/USDC" },
        level: "info",
        orderId: "order-1",
        runId: "run-1",
        strategyId: "strategy-1",
        symbol: "BTC-USDC",
        timestamp: "2026-08-18T00:00:00.000Z",
      },
    ]);
    await logger.flush();
    expect(sink.flushCount).toBe(1);
  });

  it("filters below-threshold records before buffering", async () => {
    const sink = new RecordingSink();
    const logger = new StructuredLogger({
      clock: new FixedUtcClock(),
      context: { component: "logging-test", correlationId: "correlation-1", runId: "run-1" },
      sink,
      threshold: "warn",
    });
    logger.debug("logging.filtered");
    logger.info("logging.filtered");
    logger.warn("logging.accepted");
    await logger.flush();
    expect(sink.records.map((record) => record.event)).toEqual(["logging.accepted"]);
  });

  it("uses the default threshold and tolerates sinks without optional lifecycle methods", async () => {
    const logger = new StructuredLogger({
      clock: new FixedUtcClock(),
      context: { component: "logging-test", correlationId: "correlation-1", runId: "run-1" },
      sink: new MinimalSink(),
    });
    logger.debug("logging.filtered");
    logger.info("logging.default");
    await logger.flush();
    await logger.shutdown();
  });

  it("drops bounded noncritical records and preserves critical records by flushing", async () => {
    const sink = new RecordingSink();
    const logger = createLogger(sink, 1);
    sink.acceptance = "backpressure";
    logger.info("logging.first");
    logger.warn("logging.dropped");
    expect(logger.getDroppedNoncriticalRecordCount()).toBe(1);
    sink.acceptance = "accepted";
    await logger.flush();
    logger.critical("logging.critical");
    await logger.flush();
    expect(sink.records.map((record) => record.event)).toEqual(["logging.first", "logging.critical"]);
  });

  it("fails closed when a critical audit event cannot drain the full queue", () => {
    const sink = new RecordingSink();
    const logger = createLogger(sink, 1);
    logger.info("logging.first");
    sink.shouldFailWrites = true;
    expectLoggingError(() => {
      logger.critical("logging.critical");
    }, "CRITICAL_DELIVERY");
  });

  it("fails closed while retaining a critical event when the sink is backpressured", async () => {
    const sink = new RecordingSink();
    sink.acceptance = "backpressure";
    const logger = createLogger(sink);
    expectLoggingError(() => {
      logger.critical("logging.critical");
    }, "CRITICAL_DELIVERY");
    sink.acceptance = "accepted";
    await logger.flush();
    expect(sink.records.map((record) => record.event)).toEqual(["logging.critical"]);
  });

  it("keeps the critical queue bounded under repeated backpressure", async () => {
    const sink = new RecordingSink();
    sink.acceptance = "backpressure";
    const logger = createLogger(sink, 1);
    expectLoggingError(() => {
      logger.critical("logging.first.critical");
    }, "CRITICAL_DELIVERY");
    expectLoggingError(() => {
      logger.critical("logging.second.critical");
    }, "CRITICAL_DELIVERY");
    sink.acceptance = "accepted";
    await logger.flush();
    expect(sink.records.map((record) => record.event)).toEqual(["logging.first.critical"]);
  });

  it("retains backpressured records until a later flush confirms delivery", async () => {
    const sink = new RecordingSink();
    const logger = createLogger(sink, 2);
    sink.acceptance = "backpressure";
    logger.info("logging.buffered");
    await expectAsyncLoggingError(() => logger.flush(), "BACKPRESSURE");
    sink.acceptance = "accepted";
    await logger.flush();
    expect(sink.records.map((record) => record.event)).toEqual(["logging.buffered"]);
  });

  it("retains an unchanged deeply frozen record when a backpressured sink attempts mutation", async () => {
    let firstRecord: LogRecord | undefined;
    let firstSerializedRecord: string | undefined;
    let writeAttempt = 0;
    const sink: LogSink = {
      write: (record): LogSinkWriteResult => {
        writeAttempt += 1;
        expect(Object.isFrozen(record)).toBe(true);
        expectDeeplyFrozenLogValue(record.fields);
        if (writeAttempt === 1) {
          firstRecord = record;
          firstSerializedRecord = JSON.stringify(record);
          const nestedField = record.fields["nested"];
          if (nestedField === undefined) throw new TypeError("Expected nested field to be present.");
          const nestedArray = getLogArray(nestedField);
          const nestedValue = nestedArray[0];
          if (nestedValue === undefined) throw new TypeError("Expected nested value to be present.");
          const nestedObject = getLogObject(nestedValue);
          const failureField = record.fields["failure"];
          if (failureField === undefined) throw new TypeError("Expected failure field to be present.");
          const errorObject = getLogObject(failureField);
          const causeField = errorObject["cause"];
          if (causeField === undefined) throw new TypeError("Expected error cause to be present.");
          const causeObject = getLogObject(causeField);
          const causeNestedField = causeObject["nested"];
          if (causeNestedField === undefined)
            throw new TypeError("Expected nested error cause to be present.");
          const causeArray = getLogArray(causeNestedField);
          expect(Reflect.set(record, "event", "logging.tampered")).toBe(false);
          expect(Reflect.set(record.fields, "injected", "tampered")).toBe(false);
          expect(Reflect.set(nestedArray, 0, "tampered")).toBe(false);
          expect(Reflect.set(nestedObject, "object", "tampered")).toBe(false);
          expect(Reflect.set(errorObject, "message", "tampered")).toBe(false);
          expect(Reflect.set(causeArray, 0, "tampered")).toBe(false);
          return { acceptance: "backpressure", recordAccepted: false };
        }
        if (firstRecord === undefined || firstSerializedRecord === undefined) {
          throw new Error("Expected a first delivery attempt.");
        }
        expect(record).toBe(firstRecord);
        expect(JSON.stringify(record)).toBe(firstSerializedRecord);
        return { acceptance: "accepted", recordAccepted: true };
      },
    };
    const logger = createLogger(sink);
    logger.info("logging.immutable.retry", {
      deep: {
        one: {
          two: {
            three: {
              four: {
                five: {
                  six: { seven: "original" },
                },
              },
            },
          },
        },
      },
      // eslint-disable-next-line unicorn/no-null -- Serialized log fields preserve explicit JSON null.
      explicitNull: null,
      failure: new Error("immutable failure", { cause: { nested: ["original"] } }),
      nested: [{ object: { leaf: "original" } }],
    });
    await logger.flush();
    expect(writeAttempt).toBe(2);
  });

  it("retains only records that have not been accepted after a partial sink failure", async () => {
    const records: LogRecord[] = [];
    let writeAttempt = 0;
    const sink: LogSink = {
      write: (record): LogSinkWriteResult => {
        writeAttempt += 1;
        if (writeAttempt === 2) throw new Error("second record failed");
        records.push(record);
        return { acceptance: "accepted", recordAccepted: true };
      },
    };
    const logger = createLogger(sink, 3);
    logger.info("logging.first");
    expectLoggingError(() => {
      logger.info("logging.second");
    }, "SINK_FAILURE");
    await logger.flush();
    expect(records.map((record) => record.event)).toEqual(["logging.first", "logging.second"]);
  });

  it("defers a record emitted by a reentrant sink until the next flush", async () => {
    const sink = new ReentrantSink();
    const logger = createLogger(sink);
    sink.logger = logger;
    logger.info("logging.outer");
    expect(sink.records.map((record) => record.event)).toEqual(["logging.outer"]);
    await logger.flush();
    expect(sink.records.map((record) => record.event)).toEqual(["logging.outer", "logging.reentrant"]);
  });

  it("preserves error causes on typed delivery failures", () => {
    const sink = new RecordingSink();
    sink.shouldFailWrites = true;
    const logger = createLogger(sink);
    expectLoggingError(() => {
      logger.info("logging.failure");
    }, "SINK_FAILURE");
  });
});
