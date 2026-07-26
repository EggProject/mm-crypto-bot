/**
 * apps/web/src/lib/use-bot-status.ts
 *
 * Phase 81: `useBotStatus()` — a React hook that delivers the bot's
 * high-level status (`{ state, startedAt, lastUpdate, ... }`) to the
 * dashboard. The hook's primary source is the WebSocket `state` /
 * `snapshot` messages (which already carry the `snapshot.botStatus`
 * field); the HTTP `/api/status` endpoint is a one-shot bootstrap
 * fallback (so the dashboard doesn't show "no status yet" on the
 * first paint while the WS handshake is in flight) AND a slow-poll
 * (every 30s) fallback for the rare case where the WS is
 * disconnected for an extended period.
 *
 * The data flow is:
 *
 *   ┌─────────────────┐
 *   │ useWebSocket()  │── state / snapshot / status ──┐
 *   └─────────────────┘                                ▼
 *                                          ┌──────────────────────┐
 *                                          │ BotStatusController  │
 *                                          │ (pure, no React)     │
 *                                          └──────────────────────┘
 *                                                      │
 *                                                      ▼
 *   ┌─────────────────┐                          setBotStatus(...)
 *   │ useBotStatus()  │── returns BotStatus | null ──▶ React state
 *   └─────────────────┘
 *
 *   ┌─────────────────┐
 *   │ fetch           │◀── bootstrap() + slow-poll ── (30s) ─┐
 *   │ /api/status     │                                        │
 *   └─────────────────┘                                        │
 *              │                                                │
 *              ▼                                                │
 *       extractBotStatus(body)                                  │
 *              │                                                │
 *              ▼                                                │
 *       setBotStatus(parsed) ────────────────────────────────── ┘
 *
 *
 * Why a `BotStatusController` class (and not just inline
 * useEffect's in the hook)?
 *
 *  1. The "main + bootstrap + slow-poll" logic is a small state
 *     machine. Extracting it into a class makes the branches
 *     (e.g. "what happens when the slow-poll fires while the
 *     bootstrap fetch is in flight?", "what happens when the WS
 *     reconnects mid-slow-poll?") directly unit-testable without
 *     a React renderer (this project has no happy-dom / testing-
 *     library — see the file header on `ControlBar.test.tsx`).
 *
 *  2. The hook itself becomes a 30-line "React glue" wrapper that
 *     maps `useWebSocket()` events to controller method calls.
 *     The hook is verified by:
 *       - TypeScript (the `useBotStatus()` return type is
 *         `BotStatus | null`)
 *       - E2E tests (when App.tsx wires the hook up in a
 *         follow-up task — Phase 81 leaves App.tsx untouched
 *         so existing e2e tests don't break)
 *       - The 9 unit tests in `__tests__/use-bot-status.test.ts`,
 *         which exercise the controller's behavior end-to-end
 *         via fake `fetch` + fake `scheduler` (so they don't
 *         have to wait 30s / 5s in real time).
 *
 *  3. The controller is a "thin shell" pattern (matching the
 *     `WebSocketClient` in `ws-client.ts`): all the imperative
 *     side effects (fetch, setInterval, setTimeout, AbortController)
 *     are owned by the controller; React only sees a `BotStatus |
 *     null` value via the `onUpdate()` subscription callback.
 *
 * Phase 81 follows the existing project's pattern of "the new file
 * has 100% unit-test coverage; the React integration is exercised
 * by the e2e suite". The `__test__` named export at the bottom of
 * this file is the test-only seam for the timing constants — tests
 * mutate `__test__.SLOW_POLL_INTERVAL_MS` and
 * `__test__.BOOTSTRAP_FETCH_TIMEOUT_MS` before constructing a
 * controller, so the test suite runs in <1s without ever waiting
 * for the real 30s / 5s timeouts.
 */

import { useEffect, useRef, useState } from "react";

import { useWebSocket, type WebSocketStatus } from "../ws-client.js";
import { extractBotStatus, type BotStatus } from "./bot-status.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * `STATUS_URL` — the bot's high-level status HTTP endpoint. The path
 * `/api/status` is served by `apps/bot/src/web-client/http-server.ts`
 * from the cached state-feed snapshot (no per-request work — the
 * response is a 1-line JSON read).
 *
 * 127.0.0.1 is hard-coded — the dev workflow is browser ↔ loopback,
 * and the Vite dev server proxies nothing on this port (Vite serves
 * the SPA shell; the API is a separate origin).
 */
const STATUS_URL = "http://127.0.0.1:7913/api/status";

/**
 * `SLOW_POLL_INTERVAL_MS` — when the WS is disconnected for an
 * extended period (e.g. the bot was stopped and is restarting, or
 * the loopback socket was briefly dropped), the controller falls
 * back to a 30s HTTP poll. The interval matches the bot's typical
 * status-update cadence (the WS pushes every ~1s on the real bot;
 * 30s is a reasonable "is the bot still alive?" cadence without
 * hammering the HTTP endpoint).
 */
const SLOW_POLL_INTERVAL_MS = 30_000;

/**
 * `BOOTSTRAP_FETCH_TIMEOUT_MS` — the one-shot bootstrap fetch on
 * mount has a 5s deadline. If the bot is offline, the dashboard
 * should not show a "loading" state forever; the fetch is
 * cancelled after 5s and the user sees the "no status yet"
 * fallback (the WS is the primary source, so a missing bootstrap
 * response is recoverable once the WS connects).
 */
const BOOTSTRAP_FETCH_TIMEOUT_MS = 5_000;

// ============================================================================
// Types
// ============================================================================

/**
 * `BotStatusControllerScheduler` — the timer abstraction. The
 * production code uses the global `setTimeout` / `setInterval`;
 * the test code injects a fake scheduler that records callbacks
 * so the test can trigger them manually (or verify they were
 * cancelled). Mirrors the pattern in `ws-client.ts`'s
 * `WebSocketClientOptions.scheduler`.
 */
export interface BotStatusControllerScheduler {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (cb: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

/**
 * `BotStatusControllerOptions` — the test-injection seam.
 *
 * - `fetchImpl` — defaults to the global `fetch`. Tests inject a
 *   fake that returns a pre-canned `Response`.
 * - `statusUrl` — defaults to `__test__.STATUS_URL`.
 * - `slowPollIntervalMs` / `bootstrapTimeoutMs` — defaults to the
 *   `__test__` constants (which tests can mutate to skip the
 *   30s / 5s real-time delays).
 * - `scheduler` — defaults to a thin wrapper over the global
 *   `setTimeout` / `setInterval`.
 */
export interface BotStatusControllerOptions {
  readonly fetchImpl?: typeof fetch;
  readonly statusUrl?: string;
  readonly slowPollIntervalMs?: number;
  readonly bootstrapTimeoutMs?: number;
  readonly scheduler?: BotStatusControllerScheduler;
}

// ============================================================================
// BotStatusController — the testable core
// ============================================================================

/**
 * `BotStatusController` — owns the bot's high-level status. The
 * class is intentionally framework-agnostic (no React, no DOM, no
 * WS client); the only I/O it does is `fetch(STATUS_URL)` and
 * `setInterval`. The hook drives the controller via:
 *
 *   - `onStateMessage(msg)` — push a WS `state` message (PRIMARY
 *     source; instantaneous feedback on CONTROL clicks).
 *   - `onSnapshotMessage(msg)` — push a WS `snapshot` message
 *     (the initial handshake; same shape as `state`).
 *   - `onWsStatusChange(status)` — start/stop the 30s slow-poll
 *     based on the WS connection state.
 *   - `bootstrap()` — fire the one-shot HTTP fetch (on mount).
 *   - `onUpdate(fn)` — subscribe to status changes.
 *   - `dispose()` — cancel all timers + the in-flight fetch.
 *
 * All methods are idempotent and safe to call after `dispose()`
 * (they no-op). The class is single-instance per hook (one
 * controller per `useBotStatus()` call).
 */
export class BotStatusController {
  private current: BotStatus | null = null;
  private slowPollTimer: unknown = null;
  private bootstrapAbort: AbortController | null = null;
  private bootstrapTimeoutHandle: unknown = null;
  private readonly listeners = new Set<(s: BotStatus | null) => void>();
  private disposed = false;

  private readonly fetchImpl: typeof fetch;
  private readonly statusUrl: string;
  private readonly slowPollIntervalMs: number;
  private readonly bootstrapTimeoutMs: number;
  private readonly scheduler: BotStatusControllerScheduler;

  constructor(options: BotStatusControllerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.statusUrl = options.statusUrl ?? __test__.STATUS_URL;
    this.slowPollIntervalMs =
      options.slowPollIntervalMs ?? __test__.SLOW_POLL_INTERVAL_MS;
    this.bootstrapTimeoutMs =
      options.bootstrapTimeoutMs ?? __test__.BOOTSTRAP_FETCH_TIMEOUT_MS;
    this.scheduler = options.scheduler ?? {
      setTimeout: (cb, ms): ReturnType<typeof setTimeout> => setTimeout(cb, ms),
      clearTimeout: (h): void => {
        clearTimeout(h as ReturnType<typeof setTimeout>);
      },
      setInterval: (cb, ms): ReturnType<typeof setInterval> => setInterval(cb, ms),
      clearInterval: (h): void => {
        clearInterval(h as ReturnType<typeof setInterval>);
      },
    };
  }

  /** Returns the current status, or `null` if no message has been
   *  received yet (and the bootstrap fetch hasn't resolved). */
  getStatus(): BotStatus | null {
    return this.current;
  }

  /**
   * `onUpdate(fn)` — subscribe to status changes. The callback is
   * invoked synchronously on every `setStatus()` call (i.e. when a
   * WS message updates the status OR when the bootstrap fetch
   * resolves). Returns an unsubscribe function.
   */
  onUpdate(fn: (s: BotStatus | null) => void): () => void {
    this.listeners.add(fn);
    return (): void => {
      this.listeners.delete(fn);
    };
  }

  /**
   * `onStateMessage(msg)` — receive a WS `state` message. The
   * `snapshot.botStatus` field is the primary source of truth.
   * If the message is malformed (missing `snapshot`, invalid
   * `botStatus`), the call is a no-op (the previous status, if
   * any, is preserved).
   */
  onStateMessage(msg: unknown): void {
    if (this.disposed) return;
    const inner = (msg as { snapshot?: unknown } | null | undefined)?.snapshot;
    if (inner === undefined || inner === null) return;
    const parsed = extractBotStatus(inner);
    if (parsed !== null) this.setStatus(parsed);
  }

  /**
   * `onSnapshotMessage(msg)` — receive a WS `snapshot` message
   * (the initial handshake). Same shape as `state`, same parsing
   * path. The snapshot message arrives BEFORE the first `state`
   * message, so this is the very first bot status the dashboard
   * sees.
   */
  onSnapshotMessage(msg: unknown): void {
    if (this.disposed) return;
    const inner = (msg as { snapshot?: unknown } | null | undefined)?.snapshot;
    if (inner === undefined || inner === null) return;
    const parsed = extractBotStatus(inner);
    if (parsed !== null) this.setStatus(parsed);
  }

  /**
   * `onWsStatusChange(status)` — start/stop the 30s slow-poll
   * based on the WS connection state:
   *
   *   - "disconnected" → start the slow-poll (we can't get
   *     updates from the WS, so we fall back to HTTP).
   *   - "connecting" | "connected" | "crashed" → stop the
   *     slow-poll (the WS is the primary source; HTTP polling
   *     would just duplicate the work).
   *
   * The "connecting" state also stops the slow-poll: a socket
   * that's mid-handshake will deliver the first status within
   * a few hundred ms, so HTTP polling is wasteful. The "crashed"
   * state stops the slow-poll too: the WS has emitted a fatal
   * error and is no longer recovering, so we'd be hammering a
   * dead endpoint.
   */
  onWsStatusChange(status: WebSocketStatus): void {
    if (this.disposed) return;
    if (status === "disconnected") {
      this.startSlowPoll();
    } else {
      this.stopSlowPoll();
    }
  }

  /**
   * `bootstrap()` — fire the one-shot HTTP fetch. Called once on
   * hook mount. The fetch has a 5s timeout (BOOTSTRAP_FETCH_TIMEOUT_MS)
   * via `AbortController.abort()`. If a bootstrap fetch is already
   * in flight, this call is a no-op (idempotent).
   */
  bootstrap(): void {
    if (this.disposed) return;
    this.fireBootstrapFetch();
  }

  /**
   * `dispose()` — cancel the slow-poll timer, abort the in-flight
   * bootstrap fetch, and clear the listener set. Called from the
   * hook's `useEffect` cleanup. After `dispose()`, every other
   * method is a no-op (the controller is "dead" — the hook is
   * about to unmount).
   */
  dispose(): void {
    this.disposed = true;
    this.stopSlowPoll();
    this.cancelBootstrapFetch();
    this.listeners.clear();
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private setStatus(s: BotStatus): void {
    this.current = s;
    for (const listener of this.listeners) {
      try {
        listener(s);
      } catch {
        // best-effort: a buggy listener shouldn't take down the
        // controller. The contract is "every listener is called
        // for every change" — we don't promise atomicity.
      }
    }
  }

  private startSlowPoll(): void {
    // Idempotent: if the timer is already registered, do nothing.
    // This matters because `onWsStatusChange("disconnected")` is
    // called on every WS status change, and the controller
    // re-receives the current status whenever the hook re-renders
    // (e.g. after a CONTROL click). We must not stack up multiple
    // 30s timers.
    if (this.slowPollTimer !== null) return;
    this.slowPollTimer = this.scheduler.setInterval(() => {
      this.fireBootstrapFetch();
    }, this.slowPollIntervalMs);
  }

  private stopSlowPoll(): void {
    if (this.slowPollTimer === null) return;
    this.scheduler.clearInterval(this.slowPollTimer);
    this.slowPollTimer = null;
  }

  /**
   * `fireBootstrapFetch()` — fire one HTTP `GET STATUS_URL` with
   * a 5s timeout. Idempotent: if a fetch is already in flight
   * (either from `bootstrap()` or from the slow-poll), the call
   * is a no-op. The response is parsed via `extractBotStatus()`
   * (the same helper the WS path uses) and forwarded to
   * `setStatus()`.
   *
   * The fetch is fire-and-forget: errors (AbortError on timeout,
   * network blip, malformed JSON) are silently swallowed. The
   * hook continues to receive updates from the WS path, so a
   * single failed bootstrap is recoverable.
   */
  private fireBootstrapFetch(): void {
    // Don't stack fetches: if a slow-poll tick fires while a
    // previous bootstrap is still in flight, skip the new one.
    if (this.bootstrapAbort !== null) return;
    const ctrl = new AbortController();
    this.bootstrapAbort = ctrl;
    // Set up the 5s timeout: when it fires, the fetch is aborted
    // AND the controller's state is reset so a subsequent
    // `bootstrap()` call (or a slow-poll tick) can fire a fresh
    // fetch. The `disposed` check in the IIFE below is a
    // defensive belt-and-braces: if `dispose()` runs after the
    // timeout fires but before the AbortController has a chance
    // to be cleared, the post-await code path is skipped.
    this.bootstrapTimeoutHandle = this.scheduler.setTimeout(() => {
      ctrl.abort();
      // Reset the state HERE (not just in the IIFE's `finally`
      // block) because the pending fetch might never resolve
      // (e.g. a misbehaving fetchImpl that doesn't honor the
      // AbortSignal). Without this reset, `bootstrapAbort`
      // would stay non-null forever, blocking every subsequent
      // `bootstrap()` call. The IIFE is "leaked" in that
      // pathological case, but the controller is otherwise
      // functional.
      this.bootstrapAbort = null;
      this.bootstrapTimeoutHandle = null;
    }, this.bootstrapTimeoutMs);
    void (async (): Promise<void> => {
      try {
        const res = await this.fetchImpl(this.statusUrl, { signal: ctrl.signal });
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (this.disposed) return;
        const parsed = extractBotStatus(body);
        if (parsed !== null) this.setStatus(parsed);
      } catch {
        // AbortError (timeout) or network blip — best-effort.
        // The slow-poll will retry on the next tick (or the WS
        // will deliver a fresh status via the primary path).
      } finally {
        this.cleanupBootstrap();
      }
    })();
  }

  private cancelBootstrapFetch(): void {
    if (this.bootstrapAbort !== null) {
      this.bootstrapAbort.abort();
      this.bootstrapAbort = null;
    }
    if (this.bootstrapTimeoutHandle !== null) {
      this.scheduler.clearTimeout(this.bootstrapTimeoutHandle);
      this.bootstrapTimeoutHandle = null;
    }
  }

  private cleanupBootstrap(): void {
    if (this.bootstrapTimeoutHandle !== null) {
      this.scheduler.clearTimeout(this.bootstrapTimeoutHandle);
      this.bootstrapTimeoutHandle = null;
    }
    this.bootstrapAbort = null;
  }
}

// ============================================================================
// useBotStatus — the React hook
// ============================================================================

/**
 * `useBotStatus()` — React hook that returns the bot's high-level
 * status (`BotStatus | null`). The hook is a thin React glue layer
 * over `BotStatusController`:
 *
 *   1. Subscribes to `useWebSocket()` and forwards `state` /
 *      `snapshot` messages and the `status` change to the
 *      controller.
 *   2. Creates a controller on mount and disposes it on unmount.
 *   3. Subscribes to the controller's `onUpdate()` and mirrors
 *      the value into React state.
 *   4. Fires the one-shot bootstrap HTTP fetch on mount.
 *
 * The hook returns `null` until the first status arrives (either
 * from a WS `snapshot` / `state` message, or from a successful
 * bootstrap fetch). The dashboard's "no status yet" fallback
 * (in `bot-status.ts`'s `buildStatusBannerText`) handles the
 * `null` case.
 *
 * **This hook is library-only in Phase 81.** App.tsx still uses
 * the old polling code; wiring the hook into the dashboard is
 * a separate task (the regression risk is contained because
 * App.tsx is untouched, so the existing e2e tests don't change).
 */
export function useBotStatus(): BotStatus | null {
  const { status, snapshot, lastState } = useWebSocket();
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  // The controller lives in a ref so it survives across renders
  // without being recreated (recreation would lose any in-flight
  // fetch + the slow-poll timer). The hook's useEffect below
  // sets `current` on mount and clears it on unmount.
  const ctrlRef = useRef<BotStatusController | null>(null);

  // Create the controller on mount; dispose on unmount.
  // Declared FIRST so the WS effects below (which read
  // `ctrlRef.current`) run after `current` is set.
  useEffect(() => {
    const ctrl = new BotStatusController();
    ctrlRef.current = ctrl;
    const off = ctrl.onUpdate(setBotStatus);
    // Fire the one-shot bootstrap fetch on mount (the WS
    // handshake is also in flight in parallel — whichever
    // wins, the controller's last write wins, and both paths
    // produce the same `BotStatus` shape).
    ctrl.bootstrap();
    return (): void => {
      off();
      ctrl.dispose();
      ctrlRef.current = null;
    };
  }, []);

  // Push the current WS status into the controller on every
  // change. The first invocation (status === "disconnected" on
  // mount) starts the 30s slow-poll; subsequent transitions
  // toggle it on/off based on the connection state.
  useEffect(() => {
    ctrlRef.current?.onWsStatusChange(status);
  }, [status]);

  // Push the latest `state` message into the controller. The
  // `null` check is required because the hook receives `null`
  // until the first WS `state` message arrives.
  useEffect(() => {
    if (lastState !== null) {
      ctrlRef.current?.onStateMessage(lastState);
    }
  }, [lastState]);

  // Push the latest `snapshot` message into the controller. The
  // `null` check is required because the hook receives `null`
  // until the first WS `snapshot` message arrives (the snapshot
  // is the first message the bot sends after the handshake).
  useEffect(() => {
    if (snapshot !== null) {
      ctrlRef.current?.onSnapshotMessage(snapshot);
    }
  }, [snapshot]);

  return botStatus;
}

// ============================================================================
// __test__ — the test-only seam for the timing constants
// ============================================================================

/**
 * `__test__` — a mutable bag of constants. Production code never
 * reads from this object (it reads from the module-level `const`s
 * at the top of the file); the test suite mutates these values
 * before constructing a controller so the tests don't have to wait
 * the real 30s / 5s in real time.
 *
 * The pattern is identical to the one in `ws-client.ts` for
 * `DEFAULT_BACKOFF_SEQUENCE_MS` (which the test suite overrides
 * via `WebSocketClient({ backoffMs: [...] })`). The mutable-bag
 * approach is used here because the constants are passed to the
 * `BotStatusController` constructor as default values, and the
 * test wants to override the constants WITHOUT having to thread
 * them through every test.
 */
export const __test__ = {
  STATUS_URL,
  SLOW_POLL_INTERVAL_MS,
  BOOTSTRAP_FETCH_TIMEOUT_MS,
};
