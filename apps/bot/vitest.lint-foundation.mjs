import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appDirectory,
  resolve: {
    alias: {
      "bun:test": path.join(appDirectory, "test", "bun-test-vitest.ts"),
    },
  },
  test: {
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    include: ["src/config/{config*,loader-environment,schema-lint-foundation}.test.ts"],
    setupFiles: [path.join(appDirectory, "test", "vitest.setup.ts")],
    coverage: {
      provider: "v8",
      include: ["src/config/schema.ts", "src/config/schema-builders.ts", "src/config/loader.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage/lint-foundation",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
