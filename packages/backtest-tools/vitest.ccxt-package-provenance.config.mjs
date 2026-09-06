import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: packageRoot,
  test: {
    environment: "node",
    include: ["src/cli/ccxt-package-provenance.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/ccxt-package-provenance",
      include: ["src/cli/ccxt-package-provenance.ts"],
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
