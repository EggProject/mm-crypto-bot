/**
 * playwright-ct.config.ts
 *
 * Playwright Component Test (CT) config for mm-crypto-bot.
 *
 * Per the "여기어때" (Korean) Playwright coverage case study, the way
 * to achieve 80%+ coverage on a React + Vite + Playwright stack is
 * to combine Component Tests (CT) + E2E Tests, then merge the two
 * coverage reports. The mm-crypto-bot project currently uses ONLY
 * E2E coverage, which leaves the component-level branches uncovered
 * (since the E2E flow only exercises the happy path).
 *
 * This config:
 *   - Uses `@playwright/experimental-ct-react` to mount individual
 *     React components in a real browser
 *   - Uses `vite-plugin-istanbul` to instrument the source code
 *     (so coverage is collected on each mount)
 *   - Writes per-spec coverage to `.nyc_output/ct-*.json`
 *   - The CI script merges CT + E2E coverage via the `merge-e2e-coverage.mjs`
 *     script (see `apps/web/e2e/_helpers/coverage.ts` for the merge logic)
 */
import { defineConfig } from "@playwright/experimental-ct-react";
import istanbul from "vite-plugin-istanbul";

const PORT = 7913; // same port as e2e for consistency
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e-ct",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "line",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // CT uses the same Vite dev server config as e2e, with
    // vite-plugin-istanbul enabled via VITE_COVERAGE=true.
    ctViteConfig: {
      plugins: [
        istanbul({
          cwd: "..", // repo root (for `include: src/**/*`)
          include: ["src/**/*"],
          exclude: [
            "node_modules",
            "**/__tests__/**",
            "**/*.test.*",
            "**/*.spec.*",
            "e2e/**",
            "e2e-ct/**",
            "playwright/**",
          ],
          extension: [".ts", ".tsx"],
          requireEnv: false,
          forceBuildInstrument: true,
        }),
      ],
    },
  },
  webServer: {
    command: "vite --port 7913 --host 127.0.0.1",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
