import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "release-contract.ts",
        "release-ports.ts",
        "zip-store.ts",
        "zip-store-encoder.ts",
        "release-assembler.ts",
        "release-verifier.ts",
        "release-artifact-verifier.ts",
        "release-smoke.ts",
        "verify.ts",
      ],
      exclude: ["*.test.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/release/unit",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100, perFile: true },
    },
  },
});
