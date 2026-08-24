import { LoggingError, type LogFields, type Logger } from "../src/contracts.js";

export interface RecordedLogCall {
  readonly level: "debug" | "info" | "warn" | "error" | "critical";
  readonly event: string;
  readonly fields: LogFields | undefined;
}

export class RecordingLogger implements Logger {
  private readonly calls: RecordedLogCall[] = [];

  private record(call: RecordedLogCall): void {
    this.calls.push(Object.freeze({ ...call }));
  }

  public debug(event: string, fields?: LogFields): void {
    this.record({ level: "debug", event, fields });
  }

  public info(event: string, fields?: LogFields): void {
    this.record({ level: "info", event, fields });
  }

  public warn(event: string, fields?: LogFields): void {
    this.record({ level: "warn", event, fields });
  }

  public error(event: string, fields?: LogFields): void {
    this.record({ level: "error", event, fields });
  }

  public critical(event: string, fields?: LogFields): void {
    this.record({ level: "critical", event, fields });
  }

  public getCalls(): readonly RecordedLogCall[] {
    return Object.freeze([...this.calls]);
  }
}

/**
 * Test-only helper. It rejects critical audit events instead of discarding them.
 */
export function createNullLogger(): Logger {
  return Object.freeze({
    debug: (): void => undefined,
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
    critical: (): never => {
      throw new LoggingError("CRITICAL_DELIVERY", "A test null logger cannot accept a critical audit event.");
    },
  });
}
