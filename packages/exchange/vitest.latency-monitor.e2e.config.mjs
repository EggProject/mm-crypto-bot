import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const runtimeSources = [
  "src/latency-monitor.contract.ts",
  "src/latency-monitor-statistics.ts",
  "src/latency-monitor.ts",
];

export default defineConfig({
  root: packageRoot,
  test: {
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    include: ["src/latency-monitor.e2e.test.ts"],
    coverage: {
      provider: "v8",
      include: runtimeSources,
      reportsDirectory: "/tmp/mm-latency-monitor-e2e-coverage",
      reporter: ["text", "lcov"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
