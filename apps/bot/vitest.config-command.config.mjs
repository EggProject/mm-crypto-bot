import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const applicationRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: applicationRoot,
  resolve: {
    alias: [{ find: "bun:test", replacement: path.join(applicationRoot, "test/bun-test-vitest.ts") }],
  },
  test: {
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    reporters: ["dot"],
    setupFiles: [path.join(applicationRoot, "test/vitest.setup.ts")],
    include: ["src/cli/commands/config*.test.ts"],
    coverage: {
      provider: "v8",
      enabled: true,
      include: ["src/cli/commands/config.ts"],
      reportsDirectory: path.join(applicationRoot, "coverage/config-command"),
      reporter: ["text-summary", "json-summary"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
