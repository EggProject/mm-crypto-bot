import type {
  LogContext,
  LogFields,
  LogLevel,
  Logger,
  LogRecord,
  LogSink,
  LogSinkAcceptance,
  LogSinkWriteResult,
  LogValue,
  UtcClock,
} from "./contracts.js";
import { LoggingError } from "./contracts.js";
import { isSensitiveLogIdentifier, sanitizeLogRecord } from "./serialization.js";

const MAXIMUM_BUFFERED_RECORDS = 1024;
const MAXIMUM_SANITIZED_LOG_VALUE_DEPTH = 7;

function freezeSanitizedLogValue(value: LogValue, depth = 0): void {
  if (typeof value !== "object" || value === null) return;
  if (depth >= MAXIMUM_SANITIZED_LOG_VALUE_DEPTH) {
    Object.freeze(value);
    return;
  }
  for (const nestedValue of Object.values(value)) {
    freezeSanitizedLogValue(nestedValue, depth + 1);
  }
  Object.freeze(value);
}

function freezeLogRecord(record: unknown): LogRecord {
  const sanitizedRecord = sanitizeLogRecord(record);
  freezeSanitizedLogValue(sanitizedRecord.fields);
  return Object.freeze(sanitizedRecord);
}

function readContext(context: LogContext): LogContext | undefined {
  try {
    const component = context.component;
    const runId = context.runId;
    const correlationId = context.correlationId;
    const strategyId = context.strategyId;
    const symbol = context.symbol;
    const datasetId = context.datasetId;
    const orderId = context.orderId;
    if (
      !isBoundedIdentifier(component) ||
      !isBoundedIdentifier(runId) ||
      !isBoundedIdentifier(correlationId) ||
      (strategyId !== undefined && !isBoundedIdentifier(strategyId)) ||
      (symbol !== undefined && !isBoundedIdentifier(symbol)) ||
      (datasetId !== undefined && !isBoundedIdentifier(datasetId)) ||
      (orderId !== undefined && !isBoundedIdentifier(orderId))
    ) {
      return undefined;
    }
    return Object.freeze({
      component,
      correlationId,
      ...(datasetId !== undefined && { datasetId }),
      ...(orderId !== undefined && { orderId }),
      runId,
      ...(strategyId !== undefined && { strategyId }),
      ...(symbol !== undefined && { symbol }),
    });
  } catch {
    return undefined;
  }
}

function isBoundedIdentifier(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    isSensitiveLogIdentifier(value)
  ) {
    return false;
  }
  for (const character of value) {
    const code = Number(character.codePointAt(0));
    const isLowercaseLetter = code >= 97 && code <= 122;
    const isUppercaseLetter = code >= 65 && code <= 90;
    const isDigit = code >= 48 && code <= 57;
    if (
      !isLowercaseLetter &&
      !isUppercaseLetter &&
      !isDigit &&
      character !== "." &&
      character !== "-" &&
      character !== "_"
    ) {
      return false;
    }
  }
  return true;
}

const LOG_LEVEL_WEIGHTS: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function levelWeight(level: LogLevel): number {
  return Reflect.get(LOG_LEVEL_WEIGHTS, level);
}

function isValidEventPart(part: string): boolean {
  if (part.length === 0) return false;
  for (const character of part) {
    const code = Number(character.codePointAt(0));
    const isLowercaseLetter = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (!isLowercaseLetter && !isDigit) return false;
  }
  return true;
}

function isValidEvent(event: string): boolean {
  if (event.length > 160) return false;
  const parts = event.split(".");
  return parts.length >= 2 && parts.every((part) => isValidEventPart(part));
}

function isLogLevel(value: unknown): value is LogLevel {
  const levels: readonly unknown[] = ["debug", "info", "warn", "error"];
  return levels.includes(value);
}

function isSinkAcceptance(value: unknown): value is LogSinkAcceptance {
  return value === "accepted" || value === "backpressure";
}

function isSinkWriteResult(value: unknown): value is LogSinkWriteResult {
  if (typeof value !== "object" || value === null) return false;
  try {
    return (
      "acceptance" in value &&
      isSinkAcceptance(value.acceptance) &&
      "recordAccepted" in value &&
      typeof value.recordAccepted === "boolean" &&
      (value.acceptance === "accepted" ? value.recordAccepted : true)
    );
  } catch {
    return false;
  }
}

function isClock(clock: UtcClock): boolean {
  try {
    return typeof clock.now === "function";
  } catch {
    return false;
  }
}

function isSink(sink: LogSink): boolean {
  try {
    return typeof sink.write === "function";
  } catch {
    return false;
  }
}

export type LoggerShutdownOptions = Readonly<{
  readonly timeoutMs?: number;
}>;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1000;
const MAXIMUM_SHUTDOWN_TIMEOUT_MS = 60_000;

export interface StructuredLoggerOptions {
  readonly context: LogContext;
  readonly sink: LogSink;
  readonly clock: UtcClock;
  readonly threshold?: LogLevel;
  readonly maximumBufferedRecords?: number;
}

export class StructuredLogger implements Logger {
  private readonly context: LogContext;
  private readonly sink: LogSink;
  private readonly clock: UtcClock;
  private readonly threshold: LogLevel;
  private readonly maximumBufferedRecords: number;
  private readonly pendingRecords: LogRecord[] = [];
  private lifecycleState: "open" | "shutting-down" | "closed" | "failed" = "open";
  private isDraining = false;
  private isSinkDrainPending = false;
  private droppedNoncriticalRecords = 0;
  private flushPromise: Promise<void> | undefined;
  private shutdownPromise: Promise<void> | undefined;

  public constructor(options: StructuredLoggerOptions) {
    let context: LogContext;
    let clock: UtcClock;
    let sink: LogSink;
    let threshold: LogLevel | undefined;
    let maximumBufferedRecords: number | undefined;
    try {
      context = options.context;
      clock = options.clock;
      sink = options.sink;
      threshold = options.threshold;
      maximumBufferedRecords = options.maximumBufferedRecords;
    } catch (error) {
      throw new LoggingError("INVALID_CONTEXT", "Logger options are unreadable.", { cause: error });
    }
    const validatedContext = readContext(context);
    if (
      validatedContext === undefined ||
      !isClock(clock) ||
      !isSink(sink) ||
      (threshold !== undefined && !isLogLevel(threshold))
    ) {
      throw new LoggingError("INVALID_CONTEXT", "Logger options are incomplete or unreadable.");
    }
    this.context = validatedContext;
    this.sink = sink;
    this.clock = clock;
    this.threshold = threshold ?? "info";
    this.maximumBufferedRecords = maximumBufferedRecords ?? 256;
    if (
      !Number.isSafeInteger(this.maximumBufferedRecords) ||
      this.maximumBufferedRecords < 1 ||
      this.maximumBufferedRecords > MAXIMUM_BUFFERED_RECORDS
    ) {
      throw new LoggingError(
        "INVALID_CONTEXT",
        `Logger maximumBufferedRecords must be an integer from 1 through ${String(MAXIMUM_BUFFERED_RECORDS)}.`,
      );
    }
  }

  private send(record: LogRecord): LogSinkWriteResult {
    try {
      const acceptance: unknown = this.sink.write(record);
      if (!isSinkWriteResult(acceptance)) {
        throw new LoggingError("SINK_FAILURE", "Logger sink returned an invalid acceptance result.");
      }
      return acceptance;
    } catch (error) {
      if (error instanceof LoggingError) throw error;
      throw new LoggingError("SINK_FAILURE", "Logger sink write failed.", { cause: error });
    }
  }

  private drain(): boolean {
    if (this.isDraining) return false;
    this.isDraining = true;
    try {
      const pendingSnapshot = [...this.pendingRecords];
      for (const record of pendingSnapshot) {
        const writeResult = this.send(record);
        if (writeResult.recordAccepted) this.pendingRecords.shift();
        if (writeResult.acceptance === "backpressure") {
          this.isSinkDrainPending ||= writeResult.recordAccepted;
          return false;
        }
      }
      return this.pendingRecords.length === 0;
    } finally {
      this.isDraining = false;
    }
  }

  private write(level: LogLevel, event: string, fields: LogFields | undefined, isCritical: boolean): void {
    if (this.lifecycleState !== "open") {
      throw new LoggingError("SHUTDOWN", "Logger is shutting down or has shut down.");
    }
    if (typeof event !== "string" || !isValidEvent(event)) {
      throw new LoggingError("INVALID_EVENT", "Logging event is invalid or exceeds its bound.");
    }
    if (!isCritical && levelWeight(level) < levelWeight(this.threshold)) return;
    if (this.pendingRecords.length >= this.maximumBufferedRecords) {
      if (isCritical) {
        throw new LoggingError(
          "CRITICAL_DELIVERY",
          "Critical audit event cannot enter a full logging queue.",
        );
      }
      this.droppedNoncriticalRecords += 1;
      return;
    }
    let timestamp: string;
    try {
      const currentTime = this.clock.now();
      if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
        throw new TypeError("Clock returned an invalid UTC date.");
      }
      timestamp = currentTime.toISOString();
    } catch (error) {
      throw new LoggingError("INVALID_CONTEXT", "Logger clock failed to provide a valid UTC timestamp.", {
        cause: error,
      });
    }
    const record = freezeLogRecord({
      timestamp,
      level,
      event,
      ...this.context,
      fields: fields ?? {},
    });
    this.pendingRecords.push(record);
    try {
      const isDrained = this.drain();
      if (isCritical && !isDrained && this.pendingRecords.length > 0) {
        throw new LoggingError("CRITICAL_DELIVERY", "Critical audit event remains backpressured.");
      }
    } catch (error) {
      if (isCritical) {
        throw new LoggingError("CRITICAL_DELIVERY", "Critical audit event could not be delivered.", {
          cause: error,
        });
      }
      throw error;
    }
  }

  private async waitForDrain(): Promise<void> {
    if (this.sink.drain === undefined) {
      throw new LoggingError("BACKPRESSURE", "Logger sink cannot await backpressure.");
    }
    try {
      await this.sink.drain();
    } catch (error) {
      throw new LoggingError("SINK_FAILURE", "Logger sink drain failed.", { cause: error });
    }
  }

  private async drainCompletely(): Promise<void> {
    for (;;) {
      const isRecordQueueDrained = this.drain();
      if (isRecordQueueDrained && !this.isSinkDrainPending) return;
      await this.waitForDrain();
      this.isSinkDrainPending = false;
    }
  }

  private async awaitWithinTimeout(
    operation: Promise<void>,
    timeoutMs: number,
    onTimeout: () => void,
    timeoutMessage: string,
  ): Promise<void> {
    const timeout = Promise.withResolvers<never>();
    const timeoutHandle = setTimeout(() => {
      onTimeout();
      timeout.reject(new LoggingError("SHUTDOWN", timeoutMessage));
    }, timeoutMs);
    try {
      await Promise.race([operation, timeout.promise]);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async flushInternal(isActive: () => boolean): Promise<void> {
    await this.drainCompletely();
    if (!isActive()) {
      throw new LoggingError("SHUTDOWN", "Logger flush timed out before records drained.");
    }
    try {
      await this.sink.flush?.();
      if (!isActive()) {
        throw new LoggingError("SHUTDOWN", "Logger flush timed out before the sink flush completed.");
      }
    } catch (error) {
      if (error instanceof LoggingError) throw error;
      throw new LoggingError("SINK_FAILURE", "Logger sink flush failed.", { cause: error });
    }
  }

  private async shutdownInternal(
    isActive: () => boolean,
    activeFlush: Promise<void> | undefined,
  ): Promise<void> {
    await activeFlush;
    if (!isActive()) {
      throw new LoggingError("SHUTDOWN", "Logger shutdown timed out before records drained.");
    }
    await this.drainCompletely();
    if (!isActive()) {
      throw new LoggingError("SHUTDOWN", "Logger shutdown timed out before records drained.");
    }
    try {
      await this.sink.flush?.();
      if (!isActive()) {
        throw new LoggingError("SHUTDOWN", "Logger shutdown timed out before the sink closed.");
      }
      await this.sink.close?.();
    } catch (error) {
      if (error instanceof LoggingError) throw error;
      throw new LoggingError("SINK_FAILURE", "Logger sink close failed.", { cause: error });
    }
  }

  public debug(event: string, fields?: LogFields): void {
    this.write("debug", event, fields, false);
  }

  public info(event: string, fields?: LogFields): void {
    this.write("info", event, fields, false);
  }

  public warn(event: string, fields?: LogFields): void {
    this.write("warn", event, fields, false);
  }

  public error(event: string, fields?: LogFields): void {
    this.write("error", event, fields, false);
  }

  public critical(event: string, fields?: LogFields): void {
    this.write("error", event, fields, true);
  }

  public getDroppedNoncriticalRecordCount(): number {
    return this.droppedNoncriticalRecords;
  }

  public flush(options: LoggerShutdownOptions = {}): Promise<void> {
    if (this.lifecycleState !== "open") {
      return Promise.reject(new LoggingError("SHUTDOWN", "Logger is shutting down or has shut down."));
    }
    if (this.flushPromise !== undefined) return this.flushPromise;
    const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAXIMUM_SHUTDOWN_TIMEOUT_MS) {
      return Promise.reject(
        new LoggingError(
          "INVALID_CONTEXT",
          `Logger flush timeout must be an integer from 1 through ${String(MAXIMUM_SHUTDOWN_TIMEOUT_MS)}.`,
        ),
      );
    }
    const flushCompletion = Promise.withResolvers<undefined>();
    this.flushPromise = flushCompletion.promise;
    let hasTimedOut = false;
    const flushOperation = this.flushInternal(() => !hasTimedOut);
    void this.awaitWithinTimeout(
      flushOperation,
      timeoutMs,
      () => {
        hasTimedOut = true;
        this.lifecycleState = "failed";
      },
      "Logger flush timed out before records drained.",
    )
      .then(() => {
        flushCompletion.resolve(undefined);
      })
      .catch((error: unknown) => {
        flushCompletion.reject(error);
      })
      .finally(() => {
        this.flushPromise = undefined;
      });
    return this.flushPromise;
  }

  public shutdown(options: LoggerShutdownOptions = {}): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    if (this.lifecycleState !== "open") {
      return Promise.reject(new LoggingError("SHUTDOWN", "Logger is shutting down or has shut down."));
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAXIMUM_SHUTDOWN_TIMEOUT_MS) {
      return Promise.reject(
        new LoggingError(
          "INVALID_CONTEXT",
          `Logger shutdown timeout must be an integer from 1 through ${String(MAXIMUM_SHUTDOWN_TIMEOUT_MS)}.`,
        ),
      );
    }
    this.lifecycleState = "shutting-down";
    const shutdownCompletion = Promise.withResolvers<undefined>();
    this.shutdownPromise = shutdownCompletion.promise;
    let hasTimedOut = false;
    const shutdownOperation = this.shutdownInternal(() => !hasTimedOut, this.flushPromise);
    void this.awaitWithinTimeout(
      shutdownOperation,
      timeoutMs,
      () => {
        hasTimedOut = true;
      },
      "Logger shutdown timed out before records drained.",
    )
      .then(() => {
        this.lifecycleState = "closed";
        shutdownCompletion.resolve(undefined);
      })
      .catch((error: unknown) => {
        this.lifecycleState = "failed";
        shutdownCompletion.reject(error);
      });
    return this.shutdownPromise;
  }
}
