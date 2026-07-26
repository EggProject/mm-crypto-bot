/**
 * apps/web/playwright.config.local.ts
 *
 * A LOCAL-ONLY Playwright config that runs e2e tests against the
 * REAL `mm-bot web` server (not the Vite preview server). The
 * production config (`playwright.config.ts`) starts a Vite preview
 * + Vite-built bundle, which serves the SPA but has NO backend
 * (the API + WS calls are routed to mocks).
 *
 * This config is used by the Phase 81 screenshot test to verify
 * the real backend + dashboard integration. The `webServer: false`
 * skips Playwright's automatic server start; the test connects to
 * the existing `mm-bot web` on `127.0.0.1:7913`.
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 7913 as const;
const ORIGIN = `http://127.0.0.1:${PORT}` as const;

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "**/p81-screenshots.spec.ts",
    "**/p81-real-screenshots.spec.ts",
    "**/p81-debug.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: ORIGIN,
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // The local mm-bot web server is started manually (outside
  // Playwright). Tell Playwright not to start its own webServer.
  webServer: undefined,
});
