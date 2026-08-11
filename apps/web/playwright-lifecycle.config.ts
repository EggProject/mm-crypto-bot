import { defineConfig } from "@playwright/test";

const ORIGIN = "http://127.0.0.1:7913";

/** Focused config used only to verify Playwright's owned-server lifecycle. */
export default defineConfig({
  testDir: "./scripts/lifecycle",
  testMatch: "preview-lifecycle.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "line",
  globalTimeout: 60_000,
  use: { baseURL: ORIGIN, headless: true },
  webServer: {
    command: "bun run preview --port 7913 --strictPort --host 127.0.0.1",
    url: ORIGIN,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
