/**
 * playwright-ct.config.ts
 *
 * Playwright Component Test (CT) config for mm-crypto-bot.
 *
 * Per the "여기어때" (Korean) Playwright coverage case study AND the
 * official `mxschmitt/playwright-test-coverage` `ct-react-vite` branch,
 * the way to achieve 80%+ coverage on a React + Vite + Playwright
 * stack is to combine:
 *   - E2E tests — user journey, happy path (production build with
 *     `vite-plugin-istanbul`)
 *   - Component Tests (CT) — individual component branches (Playwright
 *     CT's internal Vite bundler with `vite-plugin-istanbul` injected
 *     via `ctViteConfig.plugins`)
 *   - Merge both coverage reports → total coverage
 *
 * **Critical config (the fix that made 80% reachable):**
 * The `ctViteConfig.plugins` MUST include `vite-plugin-istanbul` with
 * `forceBuildInstrument: true`. This tells Playwright's internal
 * Vite-based bundler to instrument the source code at serve time,
 * so `window.__coverage__` is populated when components mount.
 *
 * Without this, the CT tests pass (components render + assertions
 * pass) but `window.__coverage__` is never set, the accumulator
 * stays `{}`, and the merge produces no CT coverage. This is the
 * exact "Phase 58 known coverage gap" we had pre-Phase 58.5.
 *
 * Reference:
 *   - https://github.com/mxschmitt/playwright-test-coverage/tree/ct-react-vite
 *   - https://playwright.dev/docs/test-components
 *   - https://github.com/iFaxity/vite-plugin-istanbul
 *
 * Phase 58.5: replaced the previous `webServer: vite preview` setup
 * (which served the production bundle, but the CT's `mount()` API
 * uses its OWN Vite bundler and ignores `webServer`) with the
 * `ctViteConfig` approach that Playwright's CT runner natively
 * supports. Coverage now flows from the mounted components into
 * `window.__coverage__` → `beforeunload` → `exposeFunction` →
 * `.nyc_output/*.json` → merged by the e2e `afterAll`.
 */
import { defineConfig, devices } from "@playwright/experimental-ct-react";
import react from "@vitejs/plugin-react";
import istanbul from "vite-plugin-istanbul";

const PORT = 3100; // Playwright CT's internal dev server port

export default defineConfig({
  testDir: "./e2e-ct",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "line",
  use: {
    trace: "on-first-retry",
    // Playwright CT runs an INTERNAL Vite dev server (separate from
    // the e2e `webServer` of `vite preview`). The `ctPort` is the
    // port Playwright uses for that internal dev server.
    ctPort: PORT,
    // The `ctViteConfig.plugins` are added to Playwright's internal
    // Vite config when bundling the CT entry + the component under
    // test. This is where the coverage instrumentation must live.
    ctViteConfig: {
      // Alias `../ws-client.js` (relative imports from
      // `src/components/*`) and `./ws-client.js` (from `src/*`)
      // to the mock module. The mock is ONLY active during CT —
      // production builds use the real `useWebSocket`. The mock
      // is the linchpin for covering ControlBar's `disabled`
      // branch (status=disconnected → buttons disabled) which
      // the real hook could never reach in a CT environment.
      resolve: {
        alias: {
          "../ws-client.js": new URL(
            "./e2e-ct/__mocks__/ws-client-mock.ts",
            import.meta.url,
          ).pathname,
          "./ws-client.js": new URL(
            "./e2e-ct/__mocks__/ws-client-mock.ts",
            import.meta.url,
          ).pathname,
        },
      },
      plugins: [
        // Phase 60: `retainLines: true` is the fix for
        // https://github.com/vitejs/vite-plugin-react/issues/235.
        // Babel re-arranges JSX across multiple lines by default,
        // which makes the `__source` line numbers that
        // `vite-plugin-istanbul` reads WRONG, so coverage
        // attribution points to a different line than the source
        // line the test actually executed. `retainLines: true`
        // keeps each generated babel output on the same line as
        // the source. Mirrored in `vite.config.ts` so the CT
        // dev-server and the e2e production build have matching
        // source-map line numbers — required for the
        // `map.merge()` in the e2e `afterAll` to correctly
        // union the two coverage maps at the source-line level.
        react({
          babel: {
            retainLines: true,
          },
        }),
        // CRITICAL: the CT uses the SAME `vite-plugin-istanbul`
        // configuration as the e2e production build. This is the
        // key to consistent source-map alignment between the CT
        // dev-server build and the e2e prod build — so the
        // `map.merge()` in the e2e `afterAll` correctly unions
        // the two coverage maps at the source-line level.
        //
        // The `ctViteConfig` is loaded by Playwright's internal
        // Vite bundler when serving the CT page. The istanbul
        // plugin's `transform` hook instruments the source at
        // serve time (so the dev server code is instrumented).
        istanbul({
          // Match all .ts/.tsx under `src/`. The plugin's `include`
          // is a path glob; `src/**/*` is the safe glob for our
          // app structure (App.tsx, components/, lib/, hooks/, etc).
          include: ["src/**/*"],
          exclude: [
            "node_modules",
            "**/__tests__/**",
            "**/__mocks__/**",
            "**/*.test.*",
            "**/*.spec.*",
            "**/*.d.ts",
            "e2e/**",
            "e2e-ct/**",
            "e2e/mocks/**",
          ],
          extension: [".ts", ".tsx"],
          // `forceBuildInstrument: true` tells `vite-plugin-istanbul`
          // to instrument code at SERVE time (not just build time).
          // Without this, the dev server Playwright CT uses would
          // NOT emit `__cov_*` calls and `window.__coverage__` would
          // be undefined.
          forceBuildInstrument: true,
        }),
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
