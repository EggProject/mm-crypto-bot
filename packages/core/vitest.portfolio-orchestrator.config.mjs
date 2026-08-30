import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: packageRoot,
  resolve: { alias: { "bun:test": "vitest" } },
  test: {
    environment: "node",
    include: [
      "src/portfolio/portfolio-decision.test.ts",
      "src/portfolio/portfolio-orchestrator*.test.ts",
      "src/public-api-portfolio-decision.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/portfolio/portfolio-orchestrator.ts",
        "src/portfolio/portfolio-orchestrator-analytics.ts",
        "src/portfolio/portfolio-orchestrator-market-data.ts",
        "src/portfolio/portfolio-orchestrator-contracts.ts",
        "src/portfolio/portfolio-approximate-analytics.ts",
        "src/portfolio/portfolio-decision.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/portfolio-orchestrator",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
