export const LOGGING_E2E_CASE_IDS = [
  "public-schema-redaction",
  "public-critical-audit",
  "controlled-sink-backpressure-recovery",
  "controlled-sink-drain-failure",
  "controlled-critical-full-queue",
  "threshold-validation-and-contract",
  "shutdown-and-timeout",
  "serialization-boundaries",
  "testing-helper-contract",
  "public-stderr-idle-lifecycle",
  "controlled-stderr-backpressure-drain",
  "controlled-stderr-backpressure-error",
  "structured-boundary-validation-and-freeze",
  "structured-delivery-reentrancy-and-critical-backpressure",
  "structured-flush-late-timeout-and-failures",
  "structured-shutdown-late-timeout-and-failures",
  "public-require-logger-contract",
  "public-serialization-adversarial-values",
  "public-stderr-untrusted-record-boundary",
] as const;

export type LoggingEndToEndCaseId = (typeof LOGGING_E2E_CASE_IDS)[number];
