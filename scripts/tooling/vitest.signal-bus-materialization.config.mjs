import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/tooling/signal-bus-materialization-contract.test.ts",
      "scripts/tooling/signal-bus-materialization-candidate.test.ts",
      "scripts/tooling/signal-bus-materialization-history.test.ts",
      "scripts/tooling/signal-bus-materialization-history-merge.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "scripts/tooling/signal-bus-materialization-contract.ts",
        "scripts/tooling/signal-bus-materialization-git.ts",
        "scripts/tooling/signal-bus-materialization-verifier.ts",
        "scripts/tooling/verify-signal-bus-materialization.ts",
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
