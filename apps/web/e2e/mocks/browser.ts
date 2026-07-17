/**
 * apps/web/e2e/mocks/browser.ts
 *
 * MSW v2 browser worker — set up the `setupWorker` with the shared
 * handlers (REST + WebSocket). The worker is started from
 * `apps/web/src/main.tsx` when `window.MSW_STARTED === true` (set
 * by the Playwright test via `page.addInitScript`).
 *
 * **Why dynamic import in main.tsx:** the `msw` package is a
 * devDependency of `apps/web` (for the e2e suite only). Importing
 * it statically at the top of `main.tsx` would force every
 * production bundle to include MSW. The dynamic import is
 * tree-shaken by Vite when the conditional is false (i.e. in
 * production where `window.MSW_STARTED` is undefined).
 *
 * **MSW v2 service worker:** the browser worker uses a service
 * worker (registered from `public/mockServiceWorker.js`) to
 * intercept fetch() calls. WebSocket interception does NOT use
 * the service worker — MSW patches the global `WebSocket`
 * constructor via @mswjs/interceptors. The same `handlers` array
 * covers both transports.
 *
 * **onUnhandledRequest:** we set `bypass` (the MSW default is
 * `warn`) so the e2e tests can make unrelated fetches (e.g. to
 * dev tools) without MSW complaining. Any unhandled request is
 * passed through to the network, which fails fast in the test
 * environment (127.0.0.1:7913 isn't bound to a real server).
 */

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers.js";

export const worker = setupWorker(...handlers);
