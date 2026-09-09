import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: [
      "release-assembler.e2e.test.ts",
      "release-smoke.e2e.test.ts",
      "release-private-candidate-reproducibility.e2e.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["release-assembler.ts", "release-smoke.ts", "release-private-candidate-reproducibility.ts"],
      exclude: ["*.test.ts", "*.e2e.test.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/release/e2e",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100, perFile: true },
    },
  },
});
