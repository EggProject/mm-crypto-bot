import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "bun:test": "vitest" } },
  test: {
    environment: "node",
    include: ["src/index.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/index.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
