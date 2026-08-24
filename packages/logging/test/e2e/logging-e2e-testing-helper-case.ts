import { LoggingError } from "../../src/index.ts";
import { createNullLogger, RecordingLogger } from "../../test-support/index.ts";

function assertCondition(isConditionSatisfied: boolean, message: string): asserts isConditionSatisfied {
  if (!isConditionSatisfied) throw new Error(message);
}

export function runLoggingEndToEndTestingHelperContract(): void {
  const recordingLogger = new RecordingLogger();
  recordingLogger.debug("logging.testing.debug");
  recordingLogger.info("logging.testing.info", { symbol: "BTC/USDC" });
  recordingLogger.warn("logging.testing.warn");
  recordingLogger.error("logging.testing.error");
  recordingLogger.critical("logging.testing.critical");

  const calls = recordingLogger.getCalls();
  assertCondition(calls.length === 5, "RecordingLogger must have recorded exactly 5 calls.");
  assertCondition(Object.isFrozen(calls), "Returned calls array from RecordingLogger must be frozen.");

  const [debugCall, infoCall, warnCall, errorCall, criticalCall] = calls;
  assertCondition(
    debugCall?.level === "debug" &&
      debugCall.event === "logging.testing.debug" &&
      debugCall.fields === undefined,
    "First call must be debug without fields.",
  );
  assertCondition(
    infoCall?.level === "info" &&
      infoCall.event === "logging.testing.info" &&
      infoCall.fields?.["symbol"] === "BTC/USDC",
    "Second call must be info with symbol BTC/USDC.",
  );
  assertCondition(
    warnCall?.level === "warn" && warnCall.event === "logging.testing.warn" && warnCall.fields === undefined,
    "Third call must be warn without fields.",
  );
  assertCondition(
    errorCall?.level === "error" &&
      errorCall.event === "logging.testing.error" &&
      errorCall.fields === undefined,
    "Fourth call must be error without fields.",
  );
  assertCondition(
    criticalCall?.level === "critical" &&
      criticalCall.event === "logging.testing.critical" &&
      criticalCall.fields === undefined,
    "Fifth call must be critical without fields.",
  );

  const nullLogger = createNullLogger();
  assertCondition(Object.isFrozen(nullLogger), "createNullLogger result must be frozen.");
  nullLogger.debug("logging.null.debug");
  nullLogger.info("logging.null.info");
  nullLogger.warn("logging.null.warn");
  nullLogger.error("logging.null.error");

  let nullCriticalError: unknown;
  try {
    nullLogger.critical("logging.null.critical");
  } catch (error: unknown) {
    nullCriticalError = error;
  }
  assertCondition(
    nullCriticalError instanceof LoggingError && nullCriticalError.code === "CRITICAL_DELIVERY",
    "Calling critical on createNullLogger must synchronously throw LoggingError with code CRITICAL_DELIVERY.",
  );
}
