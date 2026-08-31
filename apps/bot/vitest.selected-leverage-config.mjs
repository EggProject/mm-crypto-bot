import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appRoot,
  resolve: {
    alias: [{ find: "bun:test", replacement: path.join(appRoot, "test/bun-test-vitest.ts") }],
  },
  test: {
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    reporters: ["dot"],
    setupFiles: [path.join(appRoot, "test/vitest.setup.ts")],
    include: [
      "src/config/{config*,loader-environment,selected-leverage*,store*}.test.ts",
      "src/cli/commands/config*.test.ts",
    ],
    coverage: {
      provider: "v8",
      enabled: true,
      include: [
        "src/config/schema.ts",
        "src/config/loader.ts",
        "src/config/store-contracts.ts",
        "src/config/store.ts",
        "src/config/selected-leverage-config.ts",
        "src/cli/commands/config.ts",
      ],
      reportsDirectory: path.join(appRoot, "coverage/selected-leverage-config"),
      reporter: ["text", "json-summary", "lcov"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
