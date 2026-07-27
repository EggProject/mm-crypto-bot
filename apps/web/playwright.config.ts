/**
 * apps/web/playwright.config.ts
 *
 * Playwright + Istanbul coverage configuration for the apps/web
 * e2e suite. Runs the e2e tests against a coverage-instrumented
 * production build of the SPA, served via `vite preview` on
 * 127.0.0.1:7913 (the same loopback port the production
 * web-client uses, so the dashboard's real fetch + WebSocket
 * URLs work unmodified).
 *
 * **Suite timeout:** 30 minutes (raised from 20 min per the
 * 2026-07-27 CI-fix mandate, to match the GitHub Actions
 * `timeout-minutes: 30` on the e2e:playwright job after the
 * 16 new `82-coverage-boost-markers.spec.ts` tests pushed
 * the suite past the 20-min cap).
 *
 * **Per-test timeout:** 30 seconds. Each of the 10 dashboard
 * tests should finish in <5s on local Chromium; the 30s cap
 * gives headroom for the lightweight-charts canvas mount, the
 * WS connect, and the ChartGrid render.
 *
 * **Coverage strategy:**
 *   1. `vite build` runs with `VITE_COVERAGE=true` — the
 *      `vite-plugin-istanbul` plugin in `vite.config.ts` instruments
 *      every `src/**` `.ts(x)` file and exposes a `__coverage__`
 *      global on `window` at runtime.
 *   2. The dashboard's `main.tsx` (Phase 48D 1-line addition) sees
 *      `window.MSW_STARTED === true` (set by `page.addInitScript`),
 *      starts the MSW worker (which intercepts fetch + WebSocket),
 *      and then renders the React app. The instrumented code runs
 *      under the MSW mocks.
 *   3. The test fixture (`e2e/_helpers/coverage.ts`) reads
 *      `window.__coverage__` after each test and accumulates it in
 *      a per-suite map. After the suite, it merges the map via
 *      `istanbul-lib-coverage.createCoverageMap()` and writes
 *      `coverage/playwright/coverage-final.json`.
 *   4. A post-suite step runs `nyc report --reporter=lcov
 *      --reporter=json-summary --reporter=html --reporter=text-summary`
 *      to produce the lcov + json + html reports.
 *
 * **Thresholds:** 95% lines / 90% branches / 95% functions. The
 * `check-thresholds` step runs `nyc check-coverage --lines 95
 * --branches 90 --functions 95` AFTER the report step. The check
 * is in a `globalTeardown` so it runs on the runner process after
 * the suite completes (the report files persist via
 * `process.cwd()`-relative paths).
 */

import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e suite is small (10 tests) and we want fast feedback
 * in CI. Use a single worker on CI (`workers: 1` is implied by
 * no `workers:` setting) but allow 2 locally for development.
 * Locally: `workers: undefined` → Playwright defaults to half
 * the CPU count, capped at 4.
 */
const PORT = 7913 as const;
const ORIGIN = `http://127.0.0.1:${PORT}` as const;
const SUITE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const TEST_TIMEOUT_MS = 30 * 1000; // 30 seconds

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  // Phase 80: skip the `phase75-p2-*` spec files in CI — they
  // require a real bot backend running on port 7913/7914 (the
  // `mm-bot start` + `mm-bot web` processes), and the CI runner
  // only has the e2e mocks (no real bot). The local user can
  // still run them with `bunx playwright test phase75-p2-*` when
  // the bot is up — Playwright's `testIgnore` is a hard skip, so
  // the local "no bot" case will report "0 tests ran" rather
  // than a confusing 30-second timeout. The user's mandate:
  // "phase75-p2-*-t ne futtasd CI-ban, mert nem mukodik" (skip
  // phase75-p2 in CI because it doesn't work).
  testIgnore: ["**/phase75-p2-*"],
  // The 30-min suite timeout is enforced via `globalTimeout`
  // below (matching the GH Actions `timeout-minutes: 30`).
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: 5_000 },
  fullyParallel: false, // serial — the WS heartbeat timer + port sharing make parallelism flaky
  workers: 1, // CI: 1 worker for deterministic port + WS state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ["list"],
        ["html", { outputFolder: "coverage/playwright/html-report", open: "never" }],
        ["junit", { outputFile: "coverage/playwright/junit.xml" }],
      ]
    : "list",

  // The e2e tests are in TypeScript — let Playwright's transpiler
  // handle the import. We use Vite for the app build, but the
  // tests themselves are loaded directly.
  use: {
    baseURL: ORIGIN,
    headless: true,
    trace: process.env.CI ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // `viewport` — desktop layout; the dashboard's Top-nav + chart
    // grid assume ≥1024px wide. Playwright's default `1280×720`
    // is fine.
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /**
   * `webServer` — the test orchestrator. We do NOT use
   * `vite preview` directly because the build needs to run with
   * `VITE_COVERAGE=true` BEFORE the preview starts. The command
   * is a single shell line:
   *
   *   1. `vite build` with coverage instrumentation
   *   2. `vite preview --port 7913 --strictPort` to serve the dist
   *
   * The `--single-run` is implicit (preview doesn't watch the dist).
   * The `reuseExistingServer` is `true` locally (so a `bun run dev`
   * or prior `bun run preview` doesn't get killed) but `false` on CI
   * (deterministic).
   */
  webServer: {
    command: "VITE_COVERAGE=true bun run build && bun run preview --port 7913 --strictPort --host 127.0.0.1",
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000, // 2 min for the build + preview start
    stdout: "pipe",
    stderr: "pipe",
  },

  // The 30-min suite timeout (raised from 20 min on 2026-07-27
  // to match the GitHub Actions `timeout-minutes: 30` on the
  // e2e:playwright job after the 16 new markers tests pushed
  // the suite past the 20-min cap). Playwright enforces this
  // per-test-run, not per-test; if the entire suite doesn't
  // finish in 30 min, the run is killed. (Note: the `timeout:`
  // field above is the per-test timeout; there is no built-in
  // "suite timeout" — we enforce it via `globalTimeout` if
  // available, else via the GitHub Actions job timeout. As of
  // Playwright 1.49, the test runner respects the deadline
  // passed in via the `--deadline` CLI flag or `globalTimeout`
  // config; we use the latter.)
  globalTimeout: SUITE_TIMEOUT_MS,

  // Phase 80: the coverage threshold check moved from
  // `dashboard.spec.ts`'s `afterAll` to a `globalTeardown`. The
  // previous design was order-dependent: with `workers > 1`, the
  // dashboard worker could complete before the `80-coverage-boost`
  // worker, dropping the new tests' branch hits from the report
  // and failing the threshold check. With `globalTeardown`, the
  // threshold check runs ONCE on the runner process after every
  // spec's `afterAll` has written its accumulator to disk —
  // regardless of which worker completed first.
  globalTeardown: "./e2e/_helpers/coverage-teardown.ts",

  // Output directories — all under `apps/web/coverage/playwright/`
  // per the user mandate. The lcov + json + html reports all live
  // here. The Playwright HTML report (separate from the coverage
  // HTML) goes to `playwright-report/` at the project root.
  outputDir: "./coverage/playwright/test-output",
  preserveOutput: process.env.CI ? "always" : "never",
});
