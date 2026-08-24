import { defineConfig } from "vitest/config";

const bunMatcherCompatibilityPlugin = {
  name: "zero-legacy-bun-matcher-compatibility",
  transform(sourceText, filePath) {
    if (!filePath.includes("/scripts/tooling/zero-legacy-") || !filePath.endsWith(".test.ts")) {
      return;
    }
    return sourceText.replaceAll(".toBeTrue()", ".toBe(true)").replaceAll(".toBeFalse()", ".toBe(false)");
  },
};

export default defineConfig({
  plugins: [bunMatcherCompatibilityPlugin],
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  test: {
    environment: "node",
    include: [
      "scripts/tooling/zero-legacy-contract.test.ts",
      "scripts/tooling/zero-legacy-extractors.test.ts",
      "scripts/tooling/zero-legacy-scanner.test.ts",
      "scripts/tooling/zero-legacy-node-port.test.ts",
      "scripts/tooling/zero-legacy-coverage-delta.test.ts",
      "scripts/tooling/zero-legacy-secure-io.test.ts",
      "scripts/tooling/zero-legacy-secure-io-race.test.ts",
      "scripts/tooling/zero-legacy-syntax-extractors.test.ts",
      "scripts/tooling/zero-legacy-cli.vitest.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "scripts/tooling/zero-legacy-config.ts",
        "scripts/tooling/zero-legacy-contract.ts",
        "scripts/tooling/zero-legacy-command-parser.ts",
        "scripts/tooling/zero-legacy-document-extractors.ts",
        "scripts/tooling/zero-legacy-shell-yaml-extractors.ts",
        "scripts/tooling/zero-legacy-syntax-targets.ts",
        "scripts/tooling/zero-legacy-extractors.ts",
        "scripts/tooling/zero-legacy-secure-io.ts",
        "scripts/tooling/zero-legacy-scanner.ts",
        "scripts/tooling/zero-legacy-cli.ts",
      ],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "/tmp/mm-crypto-bot-zero-legacy-coverage",
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
