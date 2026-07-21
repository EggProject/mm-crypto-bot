/**
 * playwright/index.ts — the Playwright CT harness entry.
 *
 * Playwright Component Tests (CT) use `mount(<Component />)` to
 * inject a component into the test page defined by
 * `playwright/index.html`. The test page is loaded fresh per spec
 * by Playwright's internal Vite dev server, and the components
 * are mounted into the `#root` div.
 *
 * We do NOT import `../src/main.tsx` here (the full app). Doing so
 * would cause the full dashboard — including the live WebSocket
 * connect, the MSW-gated REST fetch, and the heavyweight
 * lightweight-charts mount — to start in the background on every
 * CT test page load. The CT only needs the bare React + the
 * components under test.
 *
 * Coverage instrumentation is added by the `ctViteConfig.plugins`
 * (istanbul) in `playwright-ct.config.ts`. The base fixtures
 * (`e2e-ct/_helpers/coverage.ts`) collect `window.__coverage__`
 * on `beforeunload` via `exposeFunction`, writing to
 * `.nyc_output/playwright_ct_*.json`. The e2e `afterAll` then
 * reads those JSONs and merges them into the final coverage map.
 */
export {};
