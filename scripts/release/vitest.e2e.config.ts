import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["release-smoke.e2e.test.ts"],
    coverage: {
      provider: "v8",
      include: ["release-smoke.ts"],
      exclude: ["*.test.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/release/e2e",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100, perFile: true },
    },
  },
});
