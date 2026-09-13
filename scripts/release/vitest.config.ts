import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    exclude: ["*.e2e.test.ts"],
    include: ["*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "release-contract.ts",
        "zip-store.ts",
        "zip-store-encoder.ts",
        "release-assembler.ts",
        "release-verifier.ts",
        "release-artifact-verifier.ts",
        "release-smoke.ts",
        "release-private-candidate-reproducibility.ts",
        "verify.ts",
        "release-coverage.ts",
        "release-set-contract.ts",
        "release-set-zip.ts",
        "release-set-assembler.ts",
        "release-set-verifier.ts",
        "release-set-publication.ts",
        "release-set-reproducibility.ts",
        "release-ports.ts",
        "release-coverage-node-gate.ts",
      ],
      exclude: ["*.test.ts", "*.e2e.test.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "../../coverage/release/unit",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100, perFile: true },
    },
  },
});
