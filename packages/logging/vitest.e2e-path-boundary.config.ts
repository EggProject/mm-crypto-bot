import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: packageRoot,
  test: {
    environment: "node",
    include: [
      "test/e2e/logging-e2e-path-boundary.test.ts",
      "test/e2e/logging-e2e-artifact-run*.test.ts",
      "test/e2e/logging-e2e-secure-directory-writer*.test.ts",
      "test/e2e/logging-e2e-secure-file-reader.test.ts",
      "test/e2e/logging-e2e-raw-artifact-ingestion.test.ts",
      "test/e2e/logging-e2e-gate.raw-artifact.test.ts",
      "test/e2e/logging-e2e-gate.envelope.test.ts",
      "test/e2e/logging-e2e-gate.istanbul-schema.test.ts",
      "test/e2e/logging-e2e-gate.collection.test.ts",
      "test/e2e/logging-e2e-preload-case.test.ts",
      "test/e2e/logging-e2e-preload.lifecycle.test.ts",
      "test/e2e/logging-e2e-runner.preload-artifact.test.ts",
      "test/e2e/logging-e2e-runner.coverage.test.ts",
      "test/e2e/run-logging-e2e-coverage.coverage.test.ts",
      "test/e2e/run-logging-e2e-coverage-cli.test.ts",
      "test/e2e/logging-e2e-summary-publisher*.test.ts",
      "test/e2e/build-instrumented-logging-e2e.*.test.ts",
      "test/e2e/logging-e2e-scope.schema.test.ts",
      "test/e2e/logging-e2e-scope.discovery.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "test/e2e/logging-e2e-case-contract.ts",
        "test/e2e/logging-e2e-path-boundary.ts",
        "test/e2e/logging-e2e-artifact-run.ts",
        "test/e2e/logging-e2e-artifact-run-construction-rollback.ts",
        "test/e2e/logging-e2e-secure-directory-writer.ts",
        "test/e2e/logging-e2e-secure-file-reader.ts",
        "test/e2e/logging-e2e-raw-artifact-ingestion.ts",
        "test/e2e/logging-e2e-summary-publisher.ts",
        "test/e2e/build-instrumented-logging-e2e.ts",
        "test/e2e/logging-e2e-scope.ts",
        "test/e2e/logging-e2e-gate.ts",
        "test/e2e/logging-e2e-preload.ts",
        "test/e2e/logging-e2e-runner.ts",
        "test/e2e/run-logging-e2e-coverage.ts",
        "test/e2e/run-logging-e2e-coverage-cli.ts",
      ],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage/e2e-path-boundary",
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
