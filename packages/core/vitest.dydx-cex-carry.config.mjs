import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  test: {
    environment: "node",
    include: ["src/strategy/dydx-cex-carry*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/strategy/dydx-cex-carry*.ts", "src/strategy/funding-snapshot.ts"],
      exclude: ["src/strategy/dydx-cex-carry*.test.ts", "src/strategy/dydx-cex-carry.test-support.ts"],
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
