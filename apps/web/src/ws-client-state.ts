/**
 * apps/web/src/ws-client-state.ts
 *
 * Phase 58: pure-function state machine for the apps/web/ WebSocket client.
 *
 * The state machine is extracted from the imperative `WebSocketClient` class
 * into a pure reducer: `reduce(state, event) → { state, effects }`. Every
 * branch transition is now expressed as a branch in a pure function that
 * can be unit-tested WITHOUT a WebSocket / Playwright / React renderer.
 *
 * **Architecture:**
 *   - `WsState` — the pure data state of the client
 *     (status, reconnect attempt counter, closedByCaller flag, socketOpen
 *     flag). The socket object itself, the scheduler handle, and the
 *     listener sets are NOT part of the state — those are owned by the
 *     class.
 *   - `WsEvent` — every event that can change the state. The lifecycle
 *     events (`SOCKET_OPEN` / `SOCKET_CLOSE` / `SOCKET_ERROR`) come from
 *     the underlying `WebSocketLike`. The user events (`START` /
 *     `CLOSE_USER` / `SEND`) come from the public API. `RAW_MESSAGE`
 *     carries a `data: string | undefined` and the reducer parses +
 *     dispatches internally.
 *   - `WsEffect` — commands the reducer returns. The class executes them
 *     in order. The set of effects is: `SET_STATUS` (fire status
 *     listeners), `DISPATCH` (fire a typed message listener set),
 *     `SEND_PONG` (auto-response to a server ping), `SEND_RAW` (user-sent
 *     text), `SCHEDULE_RECONNECT` (start the backoff timer),
 *     `CANCEL_RECONNECT` (cancel a pending reconnect),
 *     `CLOSE_SOCKET` (close the underlying socket), `CONNECT` (create
 *     a new socket and register listeners).
 *
 * **Pure vs. imperative split:**
 *   - The reducer never touches `globalThis.WebSocket`, `setTimeout`,
 *     `JSON.stringify`, or the listener sets. All those are the class's
 *     job.
 *   - The class never decides whether to schedule a reconnect, whether
 *     to crash on a non-recoverable error, or what the next backoff
 *     delay should be. Those are the reducer's job.
 *   - The boundary is `dispatch(event)`: the class calls the reducer
 *     with the current state + the event, then sets `this.state =
 *     nextState` and runs the returned effects.
 *
 * **Phase 59.5 source map note:** a previous attempt to shorten this
 * docstring to fix the Vite dev-server source-map misalignment CAUSED
 * a merge mismatch with the e2e production build (CT and e2e produced
 * different instrumentation for the modified file). The original
 * docstring was restored. The ws-client-state.ts branches remain at
 * 31% in CI; the structural ceiling is real and the only path to
 * improvement is via e2e (not CT) for this file.
 */

// =============================================================================
// Types re-exported from ws-client.ts (kept here for the reducer's signatures)
// =============================================================================

import type {
  ClientMessage,
  ServerMessage,
  WebSocketStatus,
} from "./ws-client.js";

export type {
  ServerMessage,
  ClientMessage,
  WebSocketStatus,
  TickMessage,
  BarMessage,
} from "./ws-client.js";

// =============================================================================
// Pure state
// =============================================================================

/**
 * `WsState` — the pure data state of the WebSocket client.
 *
 * Fields:
 *   - `status` — the React-visible status (`disconnected` / `connecting`
 *     / `connected` / `crashed`)
 *   - `attempt` — the reconnect attempt counter; incremented each time
 *     the close handler schedules a reconnect
 *   - `closedByCaller` — `true` once the user calls `close()`; gates
 *     `shouldScheduleReconnect`
 *   - `socketOpen` — `true` between the `open` and `close` events on
 *     the underlying socket; gates the `SEND` and `SEND_PONG` decisions
 *     (we can only send when the socket is in OPEN state)
 *
 * NOT in the state (owned by the class):
 *   - the `WebSocketLike` object itself (imperative handle)
 *   - the scheduler's `reconnectHandle` (imperative handle)
 *   - the listener sets (imperative side-effect sinks)
 */
export interface WsState {
  readonly status: WebSocketStatus;
  readonly attempt: number;
  readonly closedByCaller: boolean;
  readonly socketOpen: boolean;
}

/** `INITIAL_WS_STATE` — the state before `start()` is called. */
export const INITIAL_WS_STATE: WsState = {
  status: "disconnected",
  attempt: 0,
  closedByCaller: false,
  socketOpen: false,
};

// =============================================================================
// Events
// =============================================================================

/**
 * `WsEvent` — every event that can drive a state transition.
 *
 * Lifecycle events (from the underlying socket):
 *   - `SOCKET_OPEN` — the `open` event fired
 *   - `SOCKET_CLOSE` — the `close` event fired
 *   - `SOCKET_ERROR` — the `error` event fired (no-op; the close
 *     event is the authoritative one for reconnect logic)
 *   - `RAW_MESSAGE` — a `message` event with the raw `data: string |
 *     undefined` payload
 *
 * User events (from the public API):
 *   - `START` — user calls `start()`
 *   - `CLOSE_USER` — user calls `close()`
 *   - `SEND` — user calls `send(msg)`
 */
export type WsEvent =
  | { readonly type: "START" }
  | { readonly type: "CLOSE_USER" }
  | { readonly type: "SOCKET_OPEN" }
  | { readonly type: "SOCKET_CLOSE" }
  | { readonly type: "SOCKET_ERROR" }
  | { readonly type: "RAW_MESSAGE"; readonly data: string | undefined }
  | { readonly type: "SEND"; readonly msg: ClientMessage };

// =============================================================================
// Effects
// =============================================================================

/**
 * `WsEffect` — commands the class executes after `reduce()` returns.
 *
 * The reducer is pure: it never touches the socket, the scheduler, or
 * the listeners. The class reads the effects and performs the imperative
 * side effects. The order of effects in the returned array is the order
 * the class executes them.
 */
export type WsEffect =
  | { readonly type: "SET_STATUS"; readonly status: WebSocketStatus }
  | {
      readonly type: "DISPATCH";
      readonly kind: "snapshot" | "state" | "error" | "tick" | "bar";
      readonly msg: ServerMessage;
    }
  | { readonly type: "SEND_PONG"; readonly ts: number }
  | { readonly type: "SEND_RAW"; readonly text: string }
  | { readonly type: "SCHEDULE_RECONNECT"; readonly delayMs: number }
  | { readonly type: "CANCEL_RECONNECT" }
  | { readonly type: "CLOSE_SOCKET" }
  | { readonly type: "CONNECT" };

/** `WsReduceResult` — the reducer's return type. */
export interface WsReduceResult {
  readonly state: WsState;
  readonly effects: readonly WsEffect[];
}

// =============================================================================
// Backoff schedule (pure constant)
// =============================================================================

/**
 * `DEFAULT_BACKOFF_SEQUENCE_MS` — the default exponential backoff
 * schedule: 1s, 2s, 4s, 8s, 16s, 30s. After the cap, the last
 * element (30s) is reused.
 */
export const DEFAULT_BACKOFF_SEQUENCE_MS: readonly number[] = [
  1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
];

// =============================================================================
// The pure helpers (Phase 53C / 54B / 56A) — moved here from ws-client.ts
// =============================================================================
//
// These were extracted from the `WebSocketClient` class in earlier
// phases (53C / 54B / 56A) and are now the reducer's building blocks.
// They live here (instead of `ws-client.ts`) so the reducer can be
// a single self-contained module. `ws-client.ts` re-exports them
// for backward compatibility with the existing test file.

const DEFAULT_URL_FOR_HELPERS = "ws://127.0.0.1:7913/ws";

/**
 * `nextBackoffMs(attempt, schedule)` — pure function: given a
 * reconnect attempt counter and a backoff schedule, return the
 * delay (in ms) before the next reconnect attempt.
 *
 * Semantics:
 *   - `attempt < schedule.length` → `schedule[attempt]`
 *   - `attempt >= schedule.length` → the LAST element of `schedule`
 *     (the schedule is a CAP, not a hard error — once we've blown
 *     past the last value, we keep retrying at the cap interval)
 *   - empty `schedule` → `30_000` (the well-known fallback; matches
 *     the prior inline `?? 30_000` behavior in the close handler)
 *
 * Pure: no side effects, no I/O, no `this`. Extracted in
 * Phase 53C for unit-testability.
 */
export function nextBackoffMs(
  attempt: number,
  schedule: readonly number[],
): number {
  if (schedule.length === 0) return 30_000;
  const idx = Math.min(attempt, schedule.length - 1);
  // eslint-disable-next-line security/detect-object-injection
  return schedule[idx] ?? 30_000;
}

/**
 * `shouldQueueSend(socket)` — pure predicate: is the socket
 * in the `OPEN` state (`readyState === 1`) and therefore ready
 * to accept a `send()` call? Extracted in Phase 54B.
 */
export function shouldQueueSend(
  socket: { readonly readyState: number } | null,
): boolean {
  return socket !== null && socket.readyState === 1;
}

/**
 * `shouldScheduleReconnect(currentStatus, closedByCaller)` —
 * pure predicate: should the close handler schedule a reconnect
 * attempt? Extracted in Phase 54B.
 */
export function shouldScheduleReconnect(
  currentStatus: WebSocketStatus,
  closedByCaller: boolean,
): boolean {
  if (currentStatus === "crashed") return false;
  if (closedByCaller) return false;
  return true;
}

/**
 * `parseServerMessage(data)` — pure function: parse the raw
 * `data` payload of a WebSocket message event into a typed
 * `ServerMessage` (or report why parsing failed). Extracted
 * in Phase 56A.
 */
export type ServerMessageParseResult =
  | { readonly ok: true; readonly msg: ServerMessage }
  | { readonly ok: false; readonly reason: "no-data" | "invalid-json" };

export function parseServerMessage(
  data: string | undefined,
): ServerMessageParseResult {
  if (data === undefined) {
    return { ok: false, reason: "no-data" };
  }
  try {
    const msg = JSON.parse(data) as ServerMessage;
    return { ok: true, msg };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}

/**
 * `shouldCrashOnError(msg)` — pure predicate: does this error
 * message represent a non-recoverable failure? Extracted in
 * Phase 56A.
 */
export function shouldCrashOnError(msg: {
  readonly recoverable: boolean;
}): boolean {
  return !msg.recoverable;
}

/**
 * `buildPongPayload(pingTs)` — pure function: build the JSON
 * payload for the auto-pong response. Extracted in Phase 56A.
 */
export function buildPongPayload(pingTs: number): {
  readonly type: "pong";
  readonly ts: number;
} {
  return { type: "pong", ts: pingTs };
}

// =============================================================================
// The reducer
// =============================================================================

/**
 * `reduce(state, event)` — pure function: given the current state and
 * an event, return the next state and the list of effects to execute.
 *
 * The reducer never touches the socket, the scheduler, or the
 * listeners. It is a pure data transformation: `WsState × WsEvent →
 * WsState × WsEffect[]`. The class wraps this with imperative
 * side-effect execution.
 *
 * **Branches covered (every arm of the state machine):**
 *
 *   START:
 *     - closedByCaller=true → no-op (return state as-is, no effects)
 *     - closedByCaller=false → status="connecting", effect CONNECT, SET_STATUS
 *
 *   CLOSE_USER:
 *     - always: closedByCaller=true, status="disconnected", socketOpen=false
 *       effects: CANCEL_RECONNECT, SET_STATUS(disconnected), CLOSE_SOCKET
 *
 *   SOCKET_OPEN:
 *     - always: attempt=0, status="connected", socketOpen=true
 *       effect: SET_STATUS(connected)
 *
 *   SOCKET_CLOSE:
 *     - shouldScheduleReconnect=false → no-op (state unchanged, no effects)
 *     - shouldScheduleReconnect=true → status="disconnected", attempt+=1,
 *       socketOpen=false; effects: SET_STATUS(disconnected), SCHEDULE_RECONNECT
 *
 *   SOCKET_ERROR:
 *     - no-op (the close event is the authoritative one)
 *
 *   RAW_MESSAGE:
 *     - data=undefined → no-op (parse failure: no-data)
 *     - invalid JSON → no-op (parse failure: invalid-json)
 *     - snapshot → effect DISPATCH(snapshot)
 *     - state → effect DISPATCH(state)
 *     - error (recoverable) → effect DISPATCH(error)
 *     - error (non-recoverable) → effects DISPATCH(error), SET_STATUS(crashed),
 *       CLOSE_SOCKET; state: closedByCaller=true, status="crashed", socketOpen=false
 *     - ping + socketOpen=true → effect SEND_PONG
 *     - ping + socketOpen=false → no-op
 *     - tick → effect DISPATCH(tick)
 *     - bar → effect DISPATCH(bar)
 *     - default (hello, indicator, marker) → no-op
 *
 *   SEND:
 *     - socketOpen=true → effect SEND_RAW(JSON.stringify(msg))
 *     - socketOpen=false → no-op
 *
 * @param state - the current `WsState`
 * @param event - the `WsEvent` to process
 * @param backoffMs - the backoff schedule (default: the standard
 *   1s/2s/4s/8s/16s/30s sequence). Passed in (not closed over) so
 *   tests can drive the reducer with a custom schedule without
 *   instantiating a `WebSocketClient`.
 * @returns the next state and the list of effects to execute
 */
export function reduce(
  state: WsState,
  event: WsEvent,
  backoffMs: readonly number[] = DEFAULT_BACKOFF_SEQUENCE_MS,
): WsReduceResult {
  switch (event.type) {
    case "START": {
      // Defensive: if the user previously called close() and then
      // re-calls start(), we ignore the re-start. (This is rare in
      // practice; the class's API doesn't re-expose start() after
      // close() in the React hook's lifecycle.)
      if (state.closedByCaller) {
        return { state, effects: [] };
      }
      return {
        state: { ...state, status: "connecting" },
        effects: [
          { type: "SET_STATUS", status: "connecting" },
          { type: "CONNECT" },
        ],
      };
    }

    case "CLOSE_USER": {
      return {
        state: {
          ...state,
          closedByCaller: true,
          status: "disconnected",
          socketOpen: false,
        },
        effects: [
          { type: "CANCEL_RECONNECT" },
          { type: "SET_STATUS", status: "disconnected" },
          { type: "CLOSE_SOCKET" },
        ],
      };
    }

    case "SOCKET_OPEN": {
      return {
        state: {
          ...state,
          attempt: 0,
          status: "connected",
          socketOpen: true,
        },
        effects: [{ type: "SET_STATUS", status: "connected" }],
      };
    }

    case "SOCKET_CLOSE": {
      // The two early-exit guards ("crashed" status + caller-initiated
      // close) are encapsulated in `shouldScheduleReconnect` for
      // unit-testability (Phase 54B).
      if (!shouldScheduleReconnect(state.status, state.closedByCaller)) {
        // No-op. The status was already set to "disconnected" by
        // CLOSE_USER (in the user-initiated case) or by the previous
        // non-recoverable-error transition (in the crash case).
        return { state, effects: [] };
      }
      // Schedule reconnect with exponential backoff. `nextBackoffMs`
      // is a pure function exported for unit-testability (Phase 53C).
      const delay = nextBackoffMs(state.attempt, backoffMs);
      return {
        state: {
          ...state,
          status: "disconnected",
          attempt: state.attempt + 1,
          socketOpen: false,
        },
        effects: [
          { type: "SET_STATUS", status: "disconnected" },
          { type: "SCHEDULE_RECONNECT", delayMs: delay },
        ],
      };
    }

    case "SOCKET_ERROR": {
      // The "close" event fires after "error" — the reconnect logic
      // lives in the close handler. This is a no-op.
      return { state, effects: [] };
    }

    case "RAW_MESSAGE": {
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        // parse failure: no-data (undefined data) or invalid-json.
        return { state, effects: [] };
      }
      return reduceForParsedMessage(state, parsed.msg);
    }

    case "SEND": {
      if (!state.socketOpen) {
        return { state, effects: [] };
      }
      return {
        state,
        effects: [
          { type: "SEND_RAW", text: JSON.stringify(event.msg) },
        ],
      };
    }
  }
}

/**
 * `reduceForParsedMessage` — internal helper: dispatch a successfully
 * parsed `ServerMessage` through the state machine. Extracted from
 * `reduce` to keep the `RAW_MESSAGE` arm readable.
 */
function reduceForParsedMessage(
  state: WsState,
  msg: ServerMessage,
): WsReduceResult {
  switch (msg.type) {
    case "snapshot": {
      return {
        state,
        effects: [{ type: "DISPATCH", kind: "snapshot", msg }],
      };
    }
    case "state": {
      return {
        state,
        effects: [{ type: "DISPATCH", kind: "state", msg }],
      };
    }
    case "error": {
      if (shouldCrashOnError(msg)) {
        return {
          state: {
            ...state,
            closedByCaller: true,
            status: "crashed",
            socketOpen: false,
          },
          effects: [
            // Dispatch the error message first so listeners observe
            // the error before the status change to "crashed".
            { type: "DISPATCH", kind: "error", msg },
            { type: "SET_STATUS", status: "crashed" },
            { type: "CLOSE_SOCKET" },
          ],
        };
      }
      return {
        state,
        effects: [{ type: "DISPATCH", kind: "error", msg }],
      };
    }
    case "ping": {
      if (!state.socketOpen) {
        return { state, effects: [] };
      }
      return {
        state,
        effects: [{ type: "SEND_PONG", ts: msg.ts }],
      };
    }
    case "tick": {
      return {
        state,
        effects: [{ type: "DISPATCH", kind: "tick", msg }],
      };
    }
    case "bar": {
      return {
        state,
        effects: [{ type: "DISPATCH", kind: "bar", msg }],
      };
    }
    // hello, indicator, marker — not yet wired (Phase 49+).
    // Falls through to default; the explicit arms above cover the
    // wired message types.
    default: {
      return { state, effects: [] };
    }
  }
}

// Keep the no-unused-vars lint happy in case the helper is ever
// dropped in a future refactor.
void DEFAULT_URL_FOR_HELPERS;
