/**
 * apps/web/e2e/mocks/node.ts
 *
 * MSW v2 node server — set up `setupServer` with the shared
 * handlers (REST + WebSocket). Used by bun:test unit tests of the
 * handlers themselves (e.g. `e2e/mocks/handlers.test.ts`, not
 * included in this phase's 5-file budget but the import is here
 * for forward-compat).
 *
 * **Why both browser and node:** the handlers are designed to be
 * importable from BOTH the browser (Playwright) and Node (bun:test).
 * The same handler array works in both environments because MSW
 * v2 has a unified API; the only difference is the runtime wrapper
 * (worker vs server).
 *
 * **WebSocket in node:** the WS handlers run via the same
 * `ws.link()` API in both transports. In node, the server
 * intercepts the `ws` package's WebSocket client (used by
 * `apps/web/src/ws-client.ts` in the bun:test harness) and routes
 * it to the handler's `client` object. The `WebSocketLike` factory
 * in `WebSocketClient` makes this swap easy (see
 * `apps/web/src/__tests__/ws-client.test.ts` for the pattern).
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";

export const server = setupServer(...handlers);
