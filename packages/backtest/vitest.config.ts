// vitest.config.ts — @mm-crypto-bot/backtest teszt konfiguráció
//
// Phase 35b — mandatory 100% line + function + branch + statement coverage
// on every OWN src/ file. The threshold check is enforced by
// `scripts/enforce-coverage-threshold.mjs` (run via `bun run coverage:full`).
// This vitest config documents the same intent and is wired so any future
// migration to `vitest run --coverage` would surface the threshold
// violation immediately (vitest's own `coverage.thresholds` check).
//
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/index.ts"],
      reporter: ["text", "html", "lcov"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
