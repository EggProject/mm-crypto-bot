import { afterEach, describe, expect, it, vi } from "vitest";

import { LoggingError, type LogRecord } from "./contracts.js";
import { StderrJsonSink, type StderrJsonWritable } from "./sinks.js";

const record: LogRecord = {
  component: "logging-test",
  correlationId: "correlation-1",
  event: "logging.sink",
  fields: { amount: "1000" },
  level: "info",
  runId: "run-1",
  timestamp: "2026-08-18T00:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

class ControlledStderrJsonWriter implements StderrJsonWritable {
  private readonly drainListeners = new Set<(cause?: unknown) => void>();
  private readonly errorListeners = new Set<(cause?: unknown) => void>();

  public readonly serializedRecords: string[] = [];
  public writeResult = true;

  public write(serializedRecord: string): boolean {
    this.serializedRecords.push(serializedRecord);
    return this.writeResult;
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

  public emitDrain(): void {
    for (const listener of this.drainListeners) {
      listener();
    }
  }

  public emitError(cause: unknown): void {
    for (const listener of this.errorListeners) {
      listener(cause);
    }
  }

  public listenerCounts(): { readonly drain: number; readonly error: number } {
    return { drain: this.drainListeners.size, error: this.errorListeners.size };
  }
}

describe("logging sinks", () => {
  it("writes JSON records to stderr without touching stdout", () => {
    const stderrEntries: string[] = [];
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrEntries.push(String(chunk));
      return true;
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    new StderrJsonSink().write(record);
    expect(stderrEntries).toEqual([`${JSON.stringify(record)}\n`]);
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it("redacts direct public-sink field input before JSON reaches stderr", () => {
    const cookieSentinel = "cookie-sentinel";
    const sessionSentinel = "session-sentinel";
    const stderrEntries: string[] = [];
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrEntries.push(String(chunk));
      return true;
    });
    const externalRecord: LogRecord = {
      ...record,
      fields: {
        headers: {
          cookie: cookieSentinel,
          sessionId: sessionSentinel,
        },
        payload: `Set-Cookie: session=${sessionSentinel}`,
      },
    };

    new StderrJsonSink().write(externalRecord);

    expect(stderrWrite).toHaveBeenCalledOnce();
    expect(stderrEntries).toEqual([
      `${JSON.stringify({
        ...externalRecord,
        fields: {
          headers: { cookie: "[REDACTED]", sessionId: "[REDACTED]" },
          payload: "[REDACTED]",
        },
      })}\n`,
    ]);
    const serializedRecord = stderrEntries[0] ?? "";
    expect(serializedRecord).not.toContain(cookieSentinel);
    expect(serializedRecord).not.toContain(sessionSentinel);
  });

  it("redacts username-only URL userinfo at the public stderr boundary", () => {
    const literalUserinfoSentinel = "stderr-literal-userinfo-sentinel";
    const encodedUserinfoSentinel = "stderr-encoded-userinfo-sentinel";
    const stderrEntries: string[] = [];
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrEntries.push(String(chunk));
      return true;
    });
    const externalRecord: LogRecord = {
      ...record,
      fields: {
        encodedEndpoint: `HTTPS%3A%2F%2F${encodedUserinfoSentinel}%40example.invalid%2Forders`,
        literalEndpoint: `https://${literalUserinfoSentinel}@example.invalid/orders`,
        safeEmailText: "Contact alice@example.invalid for assistance.",
        safeEndpoint: "https://example.invalid/orders",
      },
    };

    new StderrJsonSink().write(externalRecord);

    expect(stderrWrite).toHaveBeenCalledOnce();
    const serializedRecord = stderrEntries[0] ?? "";
    expect(serializedRecord).not.toContain(literalUserinfoSentinel);
    expect(serializedRecord).not.toContain(encodedUserinfoSentinel);
    expect(JSON.parse(serializedRecord)).toMatchObject({
      fields: {
        encodedEndpoint: "[REDACTED]",
        literalEndpoint: "[REDACTED]",
        safeEmailText: "Contact alice@example.invalid for assistance.",
        safeEndpoint: "https://example.invalid/orders",
      },
    });
  });

  it("sanitizes malformed external root values and never serializes unexpected properties", () => {
    const accessTokenSentinel = "external-access-token-sentinel";
    const sessionSentinel = "external-session-sentinel";
    const stderrEntries: string[] = [];
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrEntries.push(String(chunk));
      return true;
    });
    const externalRecord = { ...record };
    Object.defineProperties(externalRecord, {
      component: {
        get: (): never => {
          throw new Error("external component getter must not run");
        },
      },
      fields: {
        value: {
          url: `https://example.invalid/?access_token%3D${accessTokenSentinel}`,
          cookie: `JSESSIONID=${sessionSentinel}`,
        },
      },
      level: { value: "invalid-level" },
      timestamp: { value: `https://example.invalid/?access_token=${accessTokenSentinel}` },
      unexpected: { enumerable: true, value: `Cookie: ${sessionSentinel}` },
    });

    expect(() => {
      new StderrJsonSink().write(externalRecord);
    }).not.toThrow();
    expect(stderrWrite).toHaveBeenCalledOnce();
    const serializedRecord = stderrEntries[0] ?? "";
    expect(serializedRecord).not.toContain(accessTokenSentinel);
    expect(serializedRecord).not.toContain(sessionSentinel);
    expect(JSON.parse(serializedRecord)).toEqual({
      component: "invalid",
      correlationId: "correlation-1",
      event: "logging.sink",
      fields: { cookie: "[REDACTED]", url: "[REDACTED]" },
      level: "error",
      runId: "run-1",
      timestamp: "1970-01-01T00:00:00.000Z",
    });
  });

  it("delegates default-adapter lifecycle operations to process stderr", async () => {
    const _stderrWrite = vi.spyOn(process.stderr, "write").mockReturnValue(false);
    const sink = new StderrJsonSink();

    expect(sink.write(record)).toEqual({ acceptance: "backpressure", recordAccepted: true });
    expect(_stderrWrite).toHaveBeenCalledTimes(1);
    process.stderr.emit("drain");
    await expect(sink.drain()).resolves.toBeUndefined();
  });

  it("reports backpressure, settles on drain, and resolves while idle", async () => {
    const stderr = new ControlledStderrJsonWriter();
    stderr.writeResult = false;
    const sink = new StderrJsonSink(stderr);

    expect(sink.write(record)).toEqual({ acceptance: "backpressure", recordAccepted: true });
    expect(sink.write(record)).toEqual({ acceptance: "backpressure", recordAccepted: false });
    expect(stderr.serializedRecords).toHaveLength(1);
    expect(stderr.listenerCounts()).toEqual({ drain: 1, error: 1 });

    const pendingDrain = sink.drain();
    stderr.emitDrain();

    await expect(pendingDrain).resolves.toBeUndefined();
    expect(stderr.listenerCounts()).toEqual({ drain: 0, error: 0 });
    await expect(sink.drain()).resolves.toBeUndefined();
  });

  it("rejects drain waiters with the original cause and removes both listeners", async () => {
    const stderr = new ControlledStderrJsonWriter();
    stderr.writeResult = false;
    const sink = new StderrJsonSink(stderr);

    sink.write(record);
    const firstDrain = sink.drain();
    const secondDrain = sink.drain();
    expect(secondDrain).toBe(firstDrain);
    expect(stderr.listenerCounts()).toEqual({ drain: 1, error: 1 });

    const stderrFailure = new Error("stderr failed");
    stderr.emitError(stderrFailure);

    await expect(firstDrain).rejects.toBeInstanceOf(LoggingError);
    await expect(secondDrain).rejects.toMatchObject({ cause: stderrFailure, code: "SINK_FAILURE" });
    expect(stderr.listenerCounts()).toEqual({ drain: 0, error: 0 });
  });

  it("does not detach a pending drain listener during close", async () => {
    const stderr = new ControlledStderrJsonWriter();
    stderr.writeResult = false;
    const sink = new StderrJsonSink(stderr);

    sink.write(record);
    sink.close();

    expect(stderr.listenerCounts()).toEqual({ drain: 1, error: 1 });
    stderr.emitDrain();
    await expect(sink.drain()).resolves.toBeUndefined();
    expect(stderr.listenerCounts()).toEqual({ drain: 0, error: 0 });
  });

  it("allows a no-op close before the first record", () => {
    const sink = new StderrJsonSink();
    expect(() => {
      sink.close();
    }).not.toThrow();
  });
});
