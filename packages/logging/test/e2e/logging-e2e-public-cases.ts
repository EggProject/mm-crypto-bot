import { StderrJsonSink, StructuredLogger, type LogContext } from "../../src/index.ts";

const FIXED_TIMESTAMP = "2026-08-24T00:00:00.000Z";
const REDACTION_SENTINEL = "logging-e2e-secret-sentinel";

const EXACT_CONTEXT: LogContext = Object.freeze({
  component: "logging-e2e",
  correlationId: "correlation-e2e-1",
  runId: "run-e2e-1",
});

function createLogger(): StructuredLogger {
  return new StructuredLogger({
    clock: { now: () => new Date(FIXED_TIMESTAMP) },
    context: EXACT_CONTEXT,
    sink: new StderrJsonSink(),
  });
}

export async function runPublicSchemaRedaction(): Promise<void> {
  const logger = createLogger();
  logger.info("logging.e2e.schema", { token: REDACTION_SENTINEL });
  await logger.flush();
}

export async function runPublicCriticalAudit(): Promise<void> {
  const logger = createLogger();
  logger.critical("logging.e2e.critical.audit", { audit: "preserved" });
  await logger.flush();
}
