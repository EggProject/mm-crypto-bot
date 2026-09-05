import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: packageRoot,
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  test: {
    environment: "node",
    include: [
      "src/testing/mock-feed.test.ts",
      "src/testing/mock-feed-orders.test.ts",
      "tests/mock-feed.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/testing/mock-feed.ts"],
      reportsDirectory: "coverage/mock-feed",
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
