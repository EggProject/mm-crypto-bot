/**
 * e2e-ct/__mocks__/ws-client-mock.ts
 *
 * Mock for the `useWebSocket` hook used by ControlBar (and other
 * components that consume the WebSocket state).
 *
 * The mock reads the test status from a global window variable
 * that the test sets BEFORE mounting the component. The default
 * is "connected" (matching the real useWebSocket's happy-path
 * status). Tests can override the status by setting
 * `window.__CT_STATUS__ = "disconnected"` etc. in a `page.addInitScript()`
 * call.
 *
 * **Why this exists:** the real `useWebSocket` opens a real
 * WebSocket. In the Playwright CT environment there's no
 * WebSocket server, so the real hook either errors or stays
 * in "disconnected" forever. To exercise the "connected"
 * branch (buttons enabled) AND the "disconnected" branch
 * (buttons disabled) of the ControlBar's `disabled` prop,
 * we need to mock the hook.
 *
 * **Pattern:** the `playwright-ct.config.ts` adds a Vite
 * `resolve.alias` that redirects `../ws-client.js` (relative
 * imports in component files) and `./ws-client.js` (in
 * top-level files) to this mock. The mock is ONLY active
 * during CT — production builds (vite preview) use the real
 * `useWebSocket`.
 */
import type { WebSocketState, WebSocketStatus } from "../../src/ws-client.js";

declare global {
  var __CT_STATUS__: WebSocketStatus | undefined;
  var __CT_SENT_MESSAGES__: unknown[] | undefined;
}

function getStatus(): WebSocketStatus {
  if (typeof window !== "undefined") {
    const w = window as unknown as { __CT_STATUS__?: WebSocketStatus };
    if (w.__CT_STATUS__ !== undefined) return w.__CT_STATUS__;
  }
  return "connected";
}

function recordSend(message: unknown): void {
  if (typeof window !== "undefined") {
    const w = window as unknown as { __CT_SENT_MESSAGES__?: unknown[] };
    w.__CT_SENT_MESSAGES__ ??= [];
    w.__CT_SENT_MESSAGES__.push(message);
  }
}

/**
 * Mock `useWebSocket` — returns a configurable state and a
 * no-op `send` that records the message in `window.__CT_SENT_MESSAGES__`.
 * The actual return value is what `useWebSocket` returns
 * (`WebSocketState`), so component code can call `.status`,
 * `.send`, etc. without modification.
 */
export function useWebSocket(_url?: string): WebSocketState {
  return {
    status: getStatus(),
    snapshot: null,
    lastState: null,
    lastError: null,
    lastTick: null,
    lastBar: null,
    send: (msg: unknown): void => {
      recordSend(msg);
    },
  };
}

// Re-export the types so the ControlBar import works.
export type { WebSocketState, WebSocketStatus };
