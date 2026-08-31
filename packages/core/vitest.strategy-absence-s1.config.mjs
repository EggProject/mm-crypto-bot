import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "bun:test": "vitest" } },
  test: {
    environment: "node",
    include: [
      "src/strategy/cascade-fade-config-layer1.test.ts",
      "src/strategy/cascade-fade-layer2-execution.test.ts",
      "src/strategy/cascade-fade-lifecycle.test.ts",
      "src/strategy/cascade-fade-risk-capacity.test.ts",
      "src/strategy/composite.test.ts",
      "src/strategy/donchian-pivot-composition.test.ts",
      "src/strategy/donchian-range-channel.test.ts",
      "src/strategy/pivot-point-grid.test.ts",
      "src/strategy/pivot-point-grid-entry-signals.test.ts",
      "src/strategy/pivot-point-grid-surface-cap.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/strategy/cascade-fade.ts",
        "src/strategy/cascade-fade-types.ts",
        "src/strategy/cascade-fade-detector-core.ts",
        "src/strategy/cascade-fade-detector.ts",
        "src/strategy/cascade-fade-paper.ts",
        "src/strategy/composite.ts",
        "src/strategy/donchian-pivot-composition.ts",
        "src/strategy/donchian-range-channel.ts",
        "src/strategy/pivot-point-grid.ts",
      ],
      exclude: ["src/strategy/*.test.ts", "src/strategy/*.test-support.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/strategy-absence-s1",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
