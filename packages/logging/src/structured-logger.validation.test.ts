import { describe, expect, it } from "vitest";

import type { LogSink, LogSinkWriteResult, UtcClock } from "./contracts.js";
import { LoggingError, requireLogger } from "./contracts.js";
import { StructuredLogger } from "./structured-logger.js";

class FixedUtcClock implements UtcClock {
  public now(): Date {
    return new Date("2026-08-18T00:00:00.000Z");
  }
}

class RecordingSink implements LogSink {
  public write(): LogSinkWriteResult {
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

describe("StructuredLogger", () => {
  it("fails closed for unreadable clock or sink options and invalid sink acceptance", () => {
    const clock: UtcClock = new FixedUtcClock();
    Object.defineProperty(clock, "now", {
      get: () => {
        throw new Error("clock blocked");
      },
    });
    expectLoggingError(() => {
      new StructuredLogger({
        clock,
        context: { component: "logging-test", correlationId: "correlation-1", runId: "run-1" },
        sink: new RecordingSink(),
      });
    }, "INVALID_CONTEXT");

    const sink: LogSink = new RecordingSink();
    Object.defineProperty(sink, "write", {
      get: () => {
        throw new Error("sink blocked");
      },
    });
    expectLoggingError(() => {
      new StructuredLogger({
        clock: new FixedUtcClock(),
        context: { component: "logging-test", correlationId: "correlation-1", runId: "run-1" },
        sink,
      });
    }, "INVALID_CONTEXT");

    const invalidSink: LogSink = new RecordingSink();
    Object.defineProperty(invalidSink, "write", { value: () => "invalid" });
    const logger = createLogger(invalidSink);
    expectLoggingError(() => {
      logger.error("logging.invalid.acceptance");
    }, "SINK_FAILURE");

    const unreadableWriteResult: LogSinkWriteResult = {
      acceptance: "accepted",
      recordAccepted: true,
    };
    Object.defineProperty(unreadableWriteResult, "acceptance", {
      get: (): never => {
        throw new Error("sink result blocked");
      },
    });
    const unreadableResultSink: LogSink = {
      write: (): LogSinkWriteResult => unreadableWriteResult,
    };
    expectLoggingError(() => {
      createLogger(unreadableResultSink).error("logging.unreadable.acceptance");
    }, "SINK_FAILURE");
  });

  it("rejects incomplete context, invalid queue bounds, and invalid event names", () => {
    const sink = new RecordingSink();
    expectLoggingError(
      () =>
        new StructuredLogger({
          clock: new FixedUtcClock(),
          context: { component: "", correlationId: "correlation-1", runId: "run-1" },
          sink,
        }),
      "INVALID_CONTEXT",
    );
    expectLoggingError(
      () =>
        new StructuredLogger({
          clock: new FixedUtcClock(),
          context: { component: "bad component", correlationId: "correlation-1", runId: "run-1" },
          sink,
        }),
      "INVALID_CONTEXT",
    );
    expectLoggingError(() => {
      createLogger(sink, 0);
    }, "INVALID_CONTEXT");
    expectLoggingError(() => {
      createLogger(sink, 0.5);
    }, "INVALID_CONTEXT");
    expectLoggingError(() => {
      createLogger(sink, 1025);
    }, "INVALID_CONTEXT");
    expectLoggingError(() => {
      createLogger(sink).info("not an event");
    }, "INVALID_EVENT");
    expectLoggingError(() => {
      createLogger(sink).info(".logging");
    }, "INVALID_EVENT");
    expectLoggingError(() => {
      createLogger(sink).info("logging.");
    }, "INVALID_EVENT");
    expectLoggingError(() => {
      createLogger(sink).info("logging.Évent");
    }, "INVALID_EVENT");
    expectLoggingError(() => {
      createLogger(sink).info("logging.".repeat(81));
    }, "INVALID_EVENT");
    expectLoggingError(() => {
      new StructuredLogger({
        clock: { now: () => new Date("invalid") },
        context: { component: "logging-test", correlationId: "correlation-1", runId: "run-1" },
        sink,
      }).info("logging.invalid.clock");
    }, "INVALID_CONTEXT");
    for (const context of [
      { component: "logging-test", correlationId: "correlation-1", runId: "JSESSIONID-secret" },
      { component: "logging-test", correlationId: "access-token-secret", runId: "run-1" },
      { component: "session-manager", correlationId: "correlation-1", runId: "run-1" },
    ]) {
      expectLoggingError(() => {
        new StructuredLogger({ clock: new FixedUtcClock(), context, sink });
      }, "INVALID_CONTEXT");
    }
    const options = {
      clock: new FixedUtcClock(),
      context: { component: "logging-test", correlationId: "correlation-1", runId: "run-1" },
      sink,
      threshold: "error" as const,
    };
    Object.defineProperty(options, "threshold", { value: "invalid" });
    expectLoggingError(() => {
      new StructuredLogger(options);
    }, "INVALID_CONTEXT");
    expectLoggingError(() => {
      requireLogger(undefined, "logging-test");
    }, "INVALID_CONTEXT");
    expect(requireLogger(createLogger(sink), "logging-test")).toBeInstanceOf(StructuredLogger);
  });

  it("maps unreadable context and option getters to typed context failures", () => {
    const context = { component: "logging-test", correlationId: "correlation-1", runId: "run-1" };
    Object.defineProperty(context, "component", {
      get: (): never => {
        throw new Error("context blocked");
      },
    });
    expectLoggingError(
      () =>
        new StructuredLogger({
          clock: new FixedUtcClock(),
          context,
          sink: new RecordingSink(),
        }),
      "INVALID_CONTEXT",
    );

    const options = {
      clock: new FixedUtcClock(),
      context: { component: "logging-test", correlationId: "correlation-1", runId: "run-1" },
      sink: new RecordingSink(),
    };
    Object.defineProperty(options, "sink", {
      get: (): never => {
        throw new Error("sink option blocked");
      },
    });
    expectLoggingError(() => {
      new StructuredLogger(options);
    }, "INVALID_CONTEXT");

    const unreadableContext = new Proxy(
      { component: "logging-test", correlationId: "correlation-1", runId: "run-1" },
      {
        get: (_target, property): unknown => {
          if (property === "runId") throw new Error("context proxy blocked");
          return property === "component"
            ? "logging-test"
            : property === "correlationId"
              ? "correlation-1"
              : undefined;
        },
      },
    );
    expectLoggingError(
      () =>
        new StructuredLogger({
          clock: new FixedUtcClock(),
          context: unreadableContext,
          sink: new RecordingSink(),
        }),
      "INVALID_CONTEXT",
    );
  });
});
