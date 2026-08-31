import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  test: {
    environment: "node",
    include: ["src/cli/arb-latency-calculations.test.ts", "src/cli/ccxt-package-provenance.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/cli/ccxt-package-provenance.ts", "src/cli/arb-latency-calculations.ts"],
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
