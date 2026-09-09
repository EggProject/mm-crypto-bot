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
      "scripts/tooling/clean-artifacts.test.ts",
      "scripts/tooling/staged-file-validation.test.ts",
      "scripts/tooling/pre-commit-pipeline.test.ts",
    ],
    maxWorkers: 1,
    pool: "forks",
    coverage: {
      include: [
        "scripts/tooling/clean-artifacts.ts",
        "scripts/tooling/staged-file-validation.ts",
        "scripts/tooling/pre-commit-pipeline.ts",
      ],
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: path.join(repoRoot, "coverage", "pre-commit-v8"),
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
