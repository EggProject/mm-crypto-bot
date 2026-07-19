/**
 * playwright-ct.config.ts
 *
 * Playwright Component Test (CT) config for mm-crypto-bot.
 *
 * Per the "여기어때" (Korean) Playwright coverage case study, the
 * way to achieve 80%+ coverage on a React + Vite + Playwright
 * stack is to combine Component Tests (CT) + E2E Tests, then
 * merge the two coverage reports.
 *
 * This config:
 *   - Uses `@playwright/experimental-ct-react` to mount individual
 *     React components in a real browser
 *   - Uses the PRODUCTION BUNDLE (built with VITE_COVERAGE=true)
 *     so `window.__coverage__` is exposed by vite-plugin-istanbul
 *   - The Vite dev server doesn't set `window.__coverage__` in dev
 *     mode — the production build is required for coverage collection
 *   - Writes per-spec coverage to `coverage/ct/accumulators/*.json`
 *   - The CI script merges CT + E2E coverage via the `merge-ct-coverage.mjs`
 *     script (see `apps/web/e2e-ct/merge-ct-coverage.mjs`)
 */
import { defineConfig } from "@playwright/experimental-ct-react";

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
  },
  // CT uses the PRODUCTION build (with VITE_COVERAGE=true) served
  // by `vite preview`. The build is run by the CI script before
  // invoking the CT runner. This is necessary because vite-plugin-
  // istanbul only instruments the production build, not the dev
  // server.
  webServer: {
    command: "vite preview --port 7913 --strictPort --host 127.0.0.1",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // The build is expected to be done by the CI script before
    // running CT. In local dev, run `bun run build` first.
    stdout: "pipe",
    stderr: "pipe",
  },
});
