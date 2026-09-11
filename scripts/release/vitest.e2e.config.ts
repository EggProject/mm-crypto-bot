import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: [
      "release-assembler.e2e.test.ts",
      "release-smoke.e2e.test.ts",
      "release-private-candidate-reproducibility.e2e.test.ts",
      "release-set.e2e.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "release-assembler.ts",
        "release-smoke.ts",
        "release-private-candidate-reproducibility.ts",
        "release-set-contract.ts",
        "release-set-zip.ts",
        "release-set-assembler.ts",
        "release-set-verifier.ts",
        "release-set-publication.ts",
        "release-set-reproducibility.ts",
        "release-ports.ts",
        "release-coverage.ts",
        "release-artifact-verifier.ts",
        "verify.ts",
      ],
      exclude: ["*.test.ts", "*.e2e.test.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "../../coverage/release/e2e",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100, perFile: true },
    },
  },
});
