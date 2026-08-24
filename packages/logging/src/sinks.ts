import { LoggingError, type LogRecord, type LogSink, type LogSinkWriteResult } from "./contracts.js";
import { sanitizeLogRecord } from "./serialization.js";

export interface StderrJsonWritable {
  write(serializedRecord: string): boolean;
  once(event: "drain" | "error", listener: (cause?: unknown) => void): void;
  off(event: "drain" | "error", listener: (cause?: unknown) => void): void;
}

const processStderrJsonWritable: StderrJsonWritable = process.stderr;

function serializeRecord(record: unknown): string {
  return JSON.stringify(sanitizeLogRecord(record));
}

export class StderrJsonSink implements LogSink {
  private isDrainPending = false;
  private drainPromise: Promise<void> | undefined;

  public constructor(private readonly stderr: StderrJsonWritable = processStderrJsonWritable) {}

  public write(record: LogRecord): LogSinkWriteResult {
    if (this.isDrainPending) {
      return { acceptance: "backpressure", recordAccepted: false };
    }
    const wasAcceptedWithoutBackpressure = this.stderr.write(`${serializeRecord(record)}\n`);
    if (!wasAcceptedWithoutBackpressure) {
      this.isDrainPending = true;
      this.drainPromise = new Promise<void>((resolve, reject) => {
        const settle = (outcome: "drained" | "failed", cause?: unknown): void => {
          this.stderr.off("drain", onDrain);
          this.stderr.off("error", onError);
          this.isDrainPending = false;
          this.drainPromise = undefined;
          if (outcome === "drained") {
            resolve();
            return;
          }
          reject(new LoggingError("SINK_FAILURE", "Stderr drain failed.", { cause }));
        };
        const onDrain = (): void => {
          settle("drained");
        };
        const onError = (cause?: unknown): void => {
          settle("failed", cause);
        };
        this.stderr.once("drain", onDrain);
        this.stderr.once("error", onError);
      });
      return { acceptance: "backpressure", recordAccepted: true };
    }
    return { acceptance: "accepted", recordAccepted: true };
  }

  public drain(): Promise<void> {
    return this.drainPromise ?? Promise.resolve();
  }

  public close(): void {
    // stderr is process-owned. A pending drain listener must remain attached so
    // an accepted record can complete before the process exits.
  }
}
