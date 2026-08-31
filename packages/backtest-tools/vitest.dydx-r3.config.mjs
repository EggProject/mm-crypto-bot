import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "bun:test": "vitest" } },
  test: {
    environment: "node",
    setupFiles: ["src/cli/dydx-vs-cex-carry-vitest-shim.mjs"],
    include: [
      "src/cli/run-dydx-vs-cex-funding-carry*.test.ts",
      "src/data/dydx-indexer-feed*.test.{ts,mjs}",
      "src/data/dydx-live-funding-source*.test.ts",
      "src/data/tardis-dydx-funding*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/cli/dydx-vs-cex-carry-data.ts",
        "src/cli/dydx-vs-cex-carry-simulation.ts",
        "src/data/dydx-indexer-feed.ts",
        "src/data/dydx-indexer-funding.ts",
        "src/data/dydx-live-funding-source.ts",
        "src/data/tardis-dydx-funding.ts",
        "src/data/tardis-dydx-funding-cache.ts",
        "src/data/tardis-dydx-funding-csv.ts",
      ],
      reporter: ["text", "lcov"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
