import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  test: {
    environment: "node",
    include: ["src/risk/leverage-invariant.test.ts", "src/risk/session-selected-leverage.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/risk/leverage-invariant.ts", "src/risk/session-selected-leverage.ts"],
      reporter: ["text"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
