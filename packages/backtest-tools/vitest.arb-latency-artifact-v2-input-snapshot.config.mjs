import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: packageRoot,
  test: {
    environment: "node",
    include: ["src/cli/arb-latency-artifact-v2-input-snapshot.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/arb-latency-artifact-v2-input-snapshot",
      include: ["src/cli/arb-latency-artifact-v2-input-snapshot.ts"],
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
