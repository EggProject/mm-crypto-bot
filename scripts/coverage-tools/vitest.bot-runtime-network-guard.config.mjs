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
  test: {
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    include: ["scripts/coverage-tools/bot-runtime-network-guard.test.ts"],
    coverage: {
      provider: "v8",
      include: ["scripts/coverage-tools/bot-runtime-network-guard.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: path.resolve("/tmp", "mm-crypto-bot-bot-runtime-network-guard-coverage"),
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  root: repoRoot,
});
