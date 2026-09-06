import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: packageRoot,
  test: {
    environment: "node",
    include: [
      "src/cli/arb-latency-artifact-v2.test.ts",
      "src/cli/arb-latency-artifact-v2-validation.test.ts",
      "src/cli/arb-latency-artifact-v2-consistency.test.ts",
      "src/cli/arb-latency-artifact-v2-snapshot-primitives.test.ts",
      "src/cli/arb-latency-artifact-v2-market-snapshot.test.ts",
      "src/cli/arb-latency-artifact-v2-input-snapshot.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/cli/arb-latency-artifact-v2.ts",
        "src/cli/arb-latency-artifact-v2-validation.ts",
        "src/cli/arb-latency-artifact-v2-consistency.ts",
        "src/cli/arb-latency-artifact-v2-snapshot-primitives.ts",
        "src/cli/arb-latency-artifact-v2-market-snapshot.ts",
        "src/cli/arb-latency-artifact-v2-input-snapshot.ts",
      ],
      reportsDirectory: "coverage/arb-latency-artifact-v2",
      reporter: ["text", "lcov"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
