import { runPublicCriticalAudit, runPublicSchemaRedaction } from "./logging-e2e-public-cases.ts";
import {
  runPublicRequireLoggerContract,
  runPublicSerializationAdversarialValues,
} from "./logging-e2e-contract-serialization-cases.ts";
import { runPublicStderrUntrustedRecordBoundary } from "./logging-e2e-contract-stderr-cases.ts";
import {
  runControlledCriticalFullQueue,
  runControlledSinkBackpressureRecovery,
  runControlledSinkDrainFailure,
} from "./logging-e2e-delivery-cases.ts";
import { runShutdownAndTimeout, runThresholdValidationAndContract } from "./logging-e2e-lifecycle-cases.ts";
import { runSerializationBoundaries } from "./logging-e2e-serialization-cases.ts";
import { runStructuredBoundaryValidationAndFreeze } from "./logging-e2e-structured-boundary-cases.ts";
import { runStructuredDeliveryReentrancyAndCriticalBackpressure } from "./logging-e2e-structured-delivery-case.ts";
import {
  runStructuredFlushLateTimeoutAndFailures,
  runStructuredShutdownLateTimeoutAndFailures,
} from "./logging-e2e-structured-lifecycle-cases.ts";
import {
  runControlledStderrBackpressureDrain,
  runControlledStderrBackpressureError,
  runPublicStderrIdleLifecycle,
} from "./logging-e2e-stderr-cases.ts";
import { runLoggingEndToEndTestingHelperContract } from "./logging-e2e-testing-helper-case.ts";

type Scenario =
  | "public-schema-redaction"
  | "public-critical-audit"
  | "controlled-sink-backpressure-recovery"
  | "controlled-sink-drain-failure"
  | "controlled-critical-full-queue"
  | "threshold-validation-and-contract"
  | "shutdown-and-timeout"
  | "serialization-boundaries"
  | "testing-helper-contract"
  | "public-stderr-idle-lifecycle"
  | "controlled-stderr-backpressure-drain"
  | "controlled-stderr-backpressure-error"
  | "structured-boundary-validation-and-freeze"
  | "structured-delivery-reentrancy-and-critical-backpressure"
  | "structured-flush-late-timeout-and-failures"
  | "structured-shutdown-late-timeout-and-failures"
  | "public-require-logger-contract"
  | "public-serialization-adversarial-values"
  | "public-stderr-untrusted-record-boundary";

function readScenario(value: string | undefined): Scenario | undefined {
  switch (value) {
    case "public-schema-redaction":
    case "public-critical-audit":
    case "controlled-sink-backpressure-recovery":
    case "controlled-sink-drain-failure":
    case "controlled-critical-full-queue":
    case "threshold-validation-and-contract":
    case "shutdown-and-timeout":
    case "serialization-boundaries":
    case "testing-helper-contract":
    case "public-stderr-idle-lifecycle":
    case "controlled-stderr-backpressure-drain":
    case "controlled-stderr-backpressure-error":
    case "structured-boundary-validation-and-freeze":
    case "structured-delivery-reentrancy-and-critical-backpressure":
    case "structured-flush-late-timeout-and-failures":
    case "structured-shutdown-late-timeout-and-failures":
    case "public-require-logger-contract":
    case "public-serialization-adversarial-values":
    case "public-stderr-untrusted-record-boundary": {
      return value;
    }
    default: {
      return undefined;
    }
  }
}

async function runScenario(scenario: Scenario): Promise<void> {
  switch (scenario) {
    case "public-schema-redaction": {
      await runPublicSchemaRedaction();
      return;
    }
    case "public-critical-audit": {
      await runPublicCriticalAudit();
      return;
    }
    case "controlled-sink-backpressure-recovery": {
      await runControlledSinkBackpressureRecovery();
      return;
    }
    case "controlled-sink-drain-failure": {
      await runControlledSinkDrainFailure();
      return;
    }
    case "controlled-critical-full-queue": {
      await runControlledCriticalFullQueue();
      return;
    }
    case "threshold-validation-and-contract": {
      await runThresholdValidationAndContract();
      return;
    }
    case "shutdown-and-timeout": {
      await runShutdownAndTimeout();
      return;
    }
    case "serialization-boundaries": {
      await runSerializationBoundaries();
      return;
    }
    case "testing-helper-contract": {
      runLoggingEndToEndTestingHelperContract();
      return;
    }
    case "public-stderr-idle-lifecycle": {
      await runPublicStderrIdleLifecycle();
      return;
    }
    case "controlled-stderr-backpressure-drain": {
      await runControlledStderrBackpressureDrain();
      return;
    }
    case "controlled-stderr-backpressure-error": {
      await runControlledStderrBackpressureError();
      return;
    }
    case "structured-boundary-validation-and-freeze": {
      await runStructuredBoundaryValidationAndFreeze();
      return;
    }
    case "structured-delivery-reentrancy-and-critical-backpressure": {
      await runStructuredDeliveryReentrancyAndCriticalBackpressure();
      return;
    }
    case "structured-flush-late-timeout-and-failures": {
      await runStructuredFlushLateTimeoutAndFailures();
      return;
    }
    case "structured-shutdown-late-timeout-and-failures": {
      await runStructuredShutdownLateTimeoutAndFailures();
      return;
    }
    case "public-require-logger-contract": {
      await runPublicRequireLoggerContract();
      return;
    }
    case "public-serialization-adversarial-values": {
      await runPublicSerializationAdversarialValues();
      return;
    }
    case "public-stderr-untrusted-record-boundary": {
      await runPublicStderrUntrustedRecordBoundary();
      return;
    }
  }
}

const scenario = readScenario(process.argv[2]);
if (scenario === undefined) {
  process.exitCode = 64;
} else {
  try {
    await runScenario(scenario);
  } catch {
    process.exitCode = 1;
  }
}
