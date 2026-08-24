export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSinkAcceptance = "accepted" | "backpressure";

export interface LogSinkWriteResult {
  readonly acceptance: LogSinkAcceptance;
  /**
   * Whether the sink now owns the record even though it is flow-controlled.
   */
  readonly recordAccepted: boolean;
}

export type LogFields = Readonly<Record<string, unknown>>;

export interface LogContext {
  readonly component: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly strategyId?: string;
  readonly symbol?: string;
  readonly datasetId?: string;
  readonly orderId?: string;
}

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly component: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly strategyId?: string;
  readonly symbol?: string;
  readonly datasetId?: string;
  readonly orderId?: string;
  readonly fields: Readonly<Record<string, LogValue>>;
}

export interface LogObject {
  readonly [key: string]: LogValue;
}

export type LogValue = string | boolean | null | readonly LogValue[] | LogObject;

export interface Logger {
  readonly debug: (event: string, fields?: LogFields) => void;
  readonly info: (event: string, fields?: LogFields) => void;
  readonly warn: (event: string, fields?: LogFields) => void;
  readonly error: (event: string, fields?: LogFields) => void;
  readonly critical: (event: string, fields?: LogFields) => void;
}

export interface UtcClock {
  readonly now: () => Date;
}

export interface LogSink {
  readonly write: (record: LogRecord) => LogSinkWriteResult;
  readonly drain?: () => Promise<void>;
  readonly flush?: () => void | Promise<void>;
  readonly close?: () => void | Promise<void>;
}

export class LoggingError extends Error {
  public constructor(
    readonly code:
      | "BACKPRESSURE"
      | "CRITICAL_DELIVERY"
      | "INVALID_CONTEXT"
      | "INVALID_EVENT"
      | "SINK_FAILURE"
      | "SHUTDOWN",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LoggingError";
  }
}

export function requireLogger(logger: Logger | undefined, component: string): Logger {
  if (logger === undefined) {
    throw new LoggingError("INVALID_CONTEXT", `Logger must be injected into ${component}.`);
  }
  return logger;
}
