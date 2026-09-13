import path from "node:path";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  root: repoRoot,
  test: {
    include: [
      "scripts/tooling/node-executable-protocol.test.ts",
      "scripts/tooling/staged-file-validation.test.ts",
    ],
    pool: "forks",
    minWorkers: 1,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: [
        "scripts/tooling/node-executable-protocol-contract.ts",
        "scripts/tooling/staged-file-validation-contract.ts",
      ],
      exclude: [],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "/tmp/mm-node-protocol-unit",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100, perFile: true },
    },
  },
});
