import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  root: repoRoot,
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "scripts/coverage-tools/bot-e2e-child-environment.test.ts",
      "scripts/coverage-tools/bot-e2e-gate.test.ts",
    ],
    maxWorkers: 1,
    pool: "forks",
    coverage: {
      include: [
        "scripts/coverage-tools/bot-e2e-child-environment.ts",
        "scripts/coverage-tools/bot-e2e-gate.ts",
      ],
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: path.resolve(repoRoot, "coverage", "bot-e2e-boundaries"),
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
