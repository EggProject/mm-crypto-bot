/**
 * apps/web/src/ws-client.ts
 *
 * Phase 47C: WebSocket client for the apps/web/ frontend. Connects to the
 * `mm-bot web` server on ws://127.0.0.1:7913/ws. Handles JSON messages
 * from the server (snapshot / tick / bar / indicator / marker / state /
 * error / ping) and exposes a useWebSocket() hook for React.
 *
 * Reconnect logic: exponential backoff (1s, 2s, 4s, 8s, 16s, 30s, 30s, ...)
 * triggered on socket close OR explicit error. Server-side ping (every
 * 10s) is auto-responded with pong.
 *
 * The hook returns:
 *   - status: "disconnected" | "connecting" | "connected" | "crashed"
 *   - snapshot: SnapshotMessage | null   (initial state on first connect)
 *   - state: StateMessage | null         (latest state update)
 *   - error: string | null               (latest error message)
 *   - lastTick: TickMessage | null       (latest tick, batched via rAF)
 *   - lastBar: BarMessage | null         (latest bar, batched via rAF)
 *   - markers: readonly MarkerMessage[]  (cumulative, batched via rAF)
 *   - send(msg: ClientMessage): void     (send SUBSCRIBE/UNSUBSCRIBE/CONTROL/PONG)
 *
 * Architecture: the `WebSocketClient` class is the testable unit (no
 * React renderer needed). The `useWebSocket` hook is a thin
 * `useEffect` wrapper that mounts the class and reads its state.
 *
 * Phase 50: tick + bar messages are routed to subscribers via the
 * `onTick` / `onBar` listener API. The `useWebSocket` hook wraps
 * these in a `RealtimeBatcher` (requestAnimationFrame coalescing)
 * so a burst of 60Hz ticks only triggers ONE `setState` call per
 * frame, not 60. The batcher lives in a `useRef` and is flushed
 * on unmount so no items are lost.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { RealtimeBatcher } from "./lib/realtime-batcher.js";

// =============================================================================
// Message types — mirror the apps/bot/src/state-feed/protocol.ts protocol
// =============================================================================

export type ServerMessage =
  | { type: "hello"; ts: number; serverVersion: string; protocolVersion: number }
  | {
      type: "snapshot";
      ts: number;
      snapshot: object;
      strategies: readonly object[];
      ohlcBootstrap: object;
    }
  | { type: "tick"; ts: number; symbol: string; price: number }
  | { type: "bar"; ts: number; symbol: string; timeframe: string; ohlc: object }
  | {
      type: "indicator";
      ts: number;
      strategy: string;
      timeframe: string;
      indicator: string;
      series: object;
    }
  | {
      type: "marker";
      ts: number;
      strategy: string;
      timeframe: string;
      side: string;
      price: number;
      label: string;
    }
  | {
      type: "state";
      ts: number;
      snapshot: object;
      positions: readonly object[];
      closedTrades: readonly object[];
      killSwitch: string;
      paused: boolean;
      statistics: object;
    }
  | { type: "error"; ts: number; message: string; recoverable: boolean }
  | { type: "ping"; ts: number };

/** `TickMessage` — alias for the `tick` arm of the `ServerMessage` union. */
export type TickMessage = Extract<ServerMessage, { type: "tick" }>;

/** `BarMessage` — alias for the `bar` arm of the `ServerMessage` union. */
export type BarMessage = Extract<ServerMessage, { type: "bar" }>;

/** `MarkerMessage` — alias for the `marker` arm of the
 *  `ServerMessage` union. Phase 55-3. */
export type MarkerMessage = Extract<ServerMessage, { type: "marker" }>;

export type ClientMessage =
  | { type: "subscribe"; symbol: string; timeframe: string }
  | { type: "unsubscribe"; symbol: string; timeframe: string }
  | {
      type: "control";
      command: string;
      paused?: boolean;
      confirm?: boolean;
    }
  | { type: "pong"; ts: number };

export type WebSocketStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "crashed";

export interface WebSocketState {
  readonly status: WebSocketStatus;
  readonly snapshot: Extract<ServerMessage, { type: "snapshot" }> | null;
  readonly lastState: Extract<ServerMessage, { type: "state" }> | null;
  readonly lastError: Extract<ServerMessage, { type: "error" }> | null;
  /** Latest tick received, batched via `requestAnimationFrame`.
   *  Phase 50: previously ticks were dropped on the floor; now
   *  the hook exposes the last tick so the dashboard can show a
   *  live price readout. */
  readonly lastTick: TickMessage | null;
  /** Latest bar received, batched via `requestAnimationFrame`. */
  readonly lastBar: BarMessage | null;
  /** Cumulative list of all `marker` messages received since mount,
   *  appended in arrival order, batched via `requestAnimationFrame`.
   *  Phase 55-3. */
  readonly markers: readonly MarkerMessage[];
  readonly send: (msg: ClientMessage) => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_URL = "ws://127.0.0.1:7913/ws";
const BACKOFF_SEQUENCE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

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
 * Phase 53C for unit-testability — the inline `Math.min(...) ?? 30_000`
 * expression in the close handler was not directly testable without
 * driving a full WebSocket lifecycle, but the math itself is the
 * actual unit of interest.
 */
export function nextBackoffMs(
  attempt: number,
  schedule: readonly number[],
): number {
  if (schedule.length === 0) return 30_000;
  // `Math.min(attempt, schedule.length - 1)` clamps `attempt` to
  // the last valid index. For an empty schedule the early-return
  // above avoids `schedule.length - 1 === -1` selecting
  // `schedule[-1] === undefined`.
  const idx = Math.min(attempt, schedule.length - 1);
  // The index is clamped via `Math.min` above; the only way `idx`
  // could be out-of-bounds is if the schedule is a `readonly`
  // array with `Object.prototype` pollution. Production callers
  // pass the default `BACKOFF_SEQUENCE_MS` or a test-supplied
  // array — both safe.
  // eslint-disable-next-line security/detect-object-injection
  return schedule[idx] ?? 30_000;
}

/**
 * `shouldQueueSend(socket)` — pure predicate: is the socket
 * in the `OPEN` state (`readyState === 1`) and therefore ready
 * to accept a `send()` call? Mirrors the `WebSocket.OPEN`
 * constant but uses the literal `1` for the same reason
 * `send()` does: the test suite replaces `globalThis.WebSocket`
 * with a `FakeWebSocket` whose `readyState` is tracked as a
 * raw number, not via the `WebSocket.OPEN` static.
 *
 * Extracted in Phase 54B for unit-testability — the inline
 * `this.socket !== null && this.socket.readyState === 1`
 * expression in `send()` was not directly testable without
 * driving a full WebSocketClient lifecycle, but the predicate
 * itself is the actual unit of interest.
 */
export function shouldQueueSend(
  socket: WebSocketLike | null,
): socket is WebSocketLike {
  return socket !== null && socket.readyState === 1;
}

/**
 * `shouldScheduleReconnect(currentStatus, closedByCaller)` —
 * pure predicate: should the close handler schedule a reconnect
 * attempt? Two early-exit cases:
 *
 *   1. `currentStatus === "crashed"` — a non-recoverable error
 *      has already put the client in the terminal `crashed`
 *      state; reconnecting would mask the failure.
 *   2. `closedByCaller === true` — the user called `close()`;
 *      we must NOT reconnect.
 *
 * Otherwise the close was an unexpected socket-level close
 * (network drop, server restart, idle timeout) and we should
 * schedule a reconnect with exponential backoff.
 *
 * Extracted in Phase 54B for unit-testability — the inline
 * guards in the close handler were not directly testable
 * without driving a full close-event sequence, but the
 * decision logic is the actual unit of interest.
 */
export function shouldScheduleReconnect(
  currentStatus: WebSocketStatus,
  closedByCaller: boolean,
): boolean {
  if (currentStatus === "crashed") return false;
  if (closedByCaller) return false;
  return true;
}

/** Minimal WebSocket interface — the global `WebSocket` is the production
 *  impl, the test fakes it via this interface. */
export interface WebSocketLike {
  readyState: number;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: { data?: string } | Event) => void,
  ): void;
  send(data: string): void;
  close(): void;
}

/** A factory for the WebSocket — overridable in tests to inject a fake. */
export type WebSocketFactory = (url: string) => WebSocketLike;

// =============================================================================
// `WebSocketClient` — the testable core
// =============================================================================

export interface WebSocketClientOptions {
  readonly url?: string;
  readonly createSocket?: WebSocketFactory;
  /** Override the backoff schedule (test-friendly). */
  readonly backoffMs?: readonly number[];
  /** Override `setTimeout` / `clearTimeout` (test-friendly). */
  readonly scheduler?: {
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

type Unsubscribe = () => void;

/**
 * `WebSocketClient` — pure class that maintains a single WebSocket
 * connection to the bot's web-client /ws endpoint. Auto-reconnects with
 * exponential backoff on close. Exposes a subscribe-based event surface
 * for the React hook (and for tests).
 */
export class WebSocketClient {
  private readonly url: string;
  private readonly createSocket: WebSocketFactory;
  private readonly backoffMs: readonly number[];
  private readonly scheduler: {
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };

  private socket: WebSocketLike | null = null;
  private attempt = 0;
  private closedByCaller = false;
  private reconnectHandle: unknown = null;
  private currentStatus: WebSocketStatus = "disconnected";

  // Subscribers — the hook subscribes to these to mirror the state.
  private readonly statusListeners = new Set<(s: WebSocketStatus) => void>();
  private readonly snapshotListeners = new Set<
    (m: Extract<ServerMessage, { type: "snapshot" }>) => void
  >();
  private readonly stateListeners = new Set<
    (m: Extract<ServerMessage, { type: "state" }>) => void
  >();
  private readonly errorListeners = new Set<
    (m: Extract<ServerMessage, { type: "error" }>) => void
  >();
  // Phase 50: tick + bar listeners. The `useWebSocket` hook
  // wraps these in a `RealtimeBatcher` so a 60Hz tick stream
  // produces ONE React setState per frame, not 60.
  private readonly tickListeners = new Set<(m: TickMessage) => void>();
  private readonly barListeners = new Set<(m: BarMessage) => void>();
  // Phase 55-3: marker listeners — markers are accumulated
  // (not replaced with the latest), so the hook maintains a
  // cumulative `markers` array.
  private readonly markerListeners = new Set<(m: MarkerMessage) => void>();

  constructor(options: WebSocketClientOptions = {}) {
    this.url = options.url ?? DEFAULT_URL;
    this.createSocket =
      options.createSocket ?? ((u: string): WebSocketLike => new WebSocket(u));
    this.backoffMs = options.backoffMs ?? BACKOFF_SEQUENCE_MS;
    this.scheduler = options.scheduler ?? {
      setTimeout: (cb, ms): ReturnType<typeof setTimeout> => {
        return setTimeout(cb, ms);
      },
      clearTimeout: (h): void => {
        clearTimeout(h as ReturnType<typeof setTimeout>);
      },
    };
  }

  /** Returns the current status. */
  getStatus(): WebSocketStatus {
    return this.currentStatus;
  }

  /** Starts the connect loop. Idempotent. */
  start(): void {
    this.closedByCaller = false;
    this.connect();
  }

  /** Closes the socket permanently and cancels any pending reconnect. */
  close(): void {
    this.closedByCaller = true;
    if (this.reconnectHandle !== null) {
      this.scheduler.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.socket !== null) {
      // Set the status FIRST so the close event (which fires
      // synchronously inside `socket.close()`) sees the right state
      // and does not emit a duplicate "disconnected" transition.
      this.setStatus("disconnected");
      try {
        this.socket.close();
      } catch {
        // best-effort
      }
      this.socket = null;
    } else {
      this.setStatus("disconnected");
    }
  }

  /** Sends a message; no-op if the socket is not open. */
  send(msg: ClientMessage): void {
    if (shouldQueueSend(this.socket)) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  // Subscriptions — used by the hook and the tests.
  onStatus(listener: (s: WebSocketStatus) => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onSnapshot(
    listener: (m: Extract<ServerMessage, { type: "snapshot" }>) => void,
  ): Unsubscribe {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  onState(
    listener: (m: Extract<ServerMessage, { type: "state" }>) => void,
  ): Unsubscribe {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onError(
    listener: (m: Extract<ServerMessage, { type: "error" }>) => void,
  ): Unsubscribe {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /**
   * `onTick(listener)` — Phase 50: subscribe to `tick` messages.
   * The listener is invoked once per `tick` frame (not batched —
   * the caller is expected to wrap this with `RealtimeBatcher`
   * if they want rAF coalescing). Returns an unsubscribe
   * function.
   */
  onTick(listener: (m: TickMessage) => void): Unsubscribe {
    this.tickListeners.add(listener);
    return () => {
      this.tickListeners.delete(listener);
    };
  }

  /**
   * `onBar(listener)` — Phase 50: subscribe to `bar` messages.
   * The listener is invoked once per `bar` frame. Returns an
   * unsubscribe function.
   */
  onBar(listener: (m: BarMessage) => void): Unsubscribe {
    this.barListeners.add(listener);
    return () => {
      this.barListeners.delete(listener);
    };
  }

  /**
   * `onMarker(listener)` — Phase 55-3: subscribe to `marker`
   * messages. Each marker is delivered to every registered
   * listener; the `useWebSocket` hook accumulates them into
   * the `markers` state array (append, not replace).
   */
  onMarker(listener: (m: MarkerMessage) => void): Unsubscribe {
    this.markerListeners.add(listener);
    return () => {
      this.markerListeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private setStatus(s: WebSocketStatus): void {
    this.currentStatus = s;
    for (const listener of this.statusListeners) {
      try {
        listener(s);
      } catch {
        // best-effort
      }
    }
  }

  private connect(): void {
    if (this.closedByCaller) return;
    this.setStatus("connecting");
    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.attempt = 0;
      this.setStatus("connected");
    });

    socket.addEventListener("message", (event) => {
      const data = (event as { data?: string }).data;
      if (data === undefined) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data) as ServerMessage;
      } catch {
        // Invalid JSON — ignore (matches the server-side tolerance).
        return;
      }
      this.handleMessage(msg);
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      // The two early-exit guards ("crashed" status + caller-initiated
      // close) are encapsulated in `shouldScheduleReconnect` for
      // unit-testability (Phase 54B). If the predicate says no, the
      // close event was either a terminal crash (already handled by
      // the `error` message branch) or a user-initiated shutdown
      // (already handled by `close()`).
      if (!shouldScheduleReconnect(this.currentStatus, this.closedByCaller)) {
        return;
      }
      // Schedule reconnect with exponential backoff. `nextBackoffMs`
      // is a pure function exported for unit-testability (Phase 53C).
      const delay = nextBackoffMs(this.attempt, this.backoffMs);
      this.attempt += 1;
      this.setStatus("disconnected");
      this.reconnectHandle = this.scheduler.setTimeout(() => {
        this.reconnectHandle = null;
        this.connect();
      }, delay);
    });

    socket.addEventListener("error", () => {
      // The "close" event fires after "error" — the reconnect logic
      // lives in the close handler.
    });
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "snapshot":
        for (const listener of this.snapshotListeners) {
          try {
            listener(msg);
          } catch {
            // best-effort
          }
        }
        return;
      case "state":
        for (const listener of this.stateListeners) {
          try {
            listener(msg);
          } catch {
            // best-effort
          }
        }
        return;
      case "error":
        for (const listener of this.errorListeners) {
          try {
            listener(msg);
          } catch {
            // best-effort
          }
        }
        if (!msg.recoverable) {
          this.closedByCaller = true;
          this.setStatus("crashed");
          if (this.socket !== null) {
            try {
              this.socket.close();
            } catch {
              // best-effort
            }
            this.socket = null;
          }
        }
        return;
      case "ping":
        // Auto-respond with pong. The literal `1` matches the
        // WebSocket.OPEN constant (see `send` for rationale).
        if (this.socket !== null && this.socket.readyState === 1) {
          try {
            this.socket.send(JSON.stringify({ type: "pong", ts: msg.ts }));
          } catch {
            // best-effort
          }
        }
        return;
      case "tick":
        for (const listener of this.tickListeners) {
          try {
            listener(msg);
          } catch {
            // best-effort
          }
        }
        return;
      case "bar":
        for (const listener of this.barListeners) {
          try {
            listener(msg);
          } catch {
            // best-effort
          }
        }
        return;
      case "marker":
        // Phase 55-3: marker messages are routed to subscribers.
        for (const listener of this.markerListeners) {
          try {
            listener(msg);
          } catch {
            // best-effort
          }
        }
        return;
      // hello, indicator — not yet wired (Phase 49+).
      default:
        return;
    }
  }
}

// =============================================================================
// `useWebSocket` — React hook (thin wrapper over `WebSocketClient`)
// =============================================================================

/**
 * `useWebSocket` — React hook that maintains a single WebSocket connection
 * to the bot's web-client /ws endpoint. Returns the current state and a
 * `send` function for SUBSCRIBE/UNSUBSCRIBE/CONTROL/PONG.
 *
 * The hook creates the connection on mount, closes it on unmount, and
 * auto-reconnects with exponential backoff (1s → 30s cap) on close.
 *
 * The returned `send` is a stable callback (same identity across renders)
 * that forwards to the underlying client's `send()`. If the socket is not
 * open, the call is a silent no-op (matches the production resilience
 * contract — the client is expected to auto-reconnect).
 *
 * **Phase 50:** `lastTick` + `lastBar` are the latest tick / bar
 * messages, batched via `requestAnimationFrame` (via `RealtimeBatcher`).
 * A 60Hz tick stream produces ONE `setState` per frame, not 60. The
 * batcher is created once per mount and `flushNow()`-drained on
 * unmount so no items are lost.
 */
export function useWebSocket(url: string = DEFAULT_URL): WebSocketState {
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [snapshot, setSnapshot] = useState<
    Extract<ServerMessage, { type: "snapshot" }> | null
  >(null);
  const [lastState, setLastState] = useState<
    Extract<ServerMessage, { type: "state" }> | null
  >(null);
  const [lastError, setLastError] = useState<
    Extract<ServerMessage, { type: "error" }> | null
  >(null);
  // Phase 50: the latest tick + bar. The batcher's callback
  // writes the most recent item from each frame to these
  // useState setters — a single setState per frame coalesces
  // 60Hz ticks into 60fps React renders.
  const [lastTick, setLastTick] = useState<TickMessage | null>(null);
  const [lastBar, setLastBar] = useState<BarMessage | null>(null);
  // Phase 55-3: cumulative list of marker messages. Unlike
  // tick/bar, markers are NOT a "latest wins" stream — the
  // dashboard shows the full marker history per chart key, so
  // the batcher appends each frame's batch to the running
  // `readonly MarkerMessage[]` array.
  const [markers, setMarkers] = useState<readonly MarkerMessage[]>([]);

  // The client lives in a ref so the `send` callback (and other handlers)
  // can access it without re-creating on every render.
  const clientRef = useRef<WebSocketClient | null>(null);
  // The batcher lives in a ref so it survives across renders
  // without being recreated (recreation would lose queued items).
  const tickBatcherRef = useRef<RealtimeBatcher<TickMessage> | null>(null);
  const barBatcherRef = useRef<RealtimeBatcher<BarMessage> | null>(null);
  // The marker batcher is parallel to the tick/bar batchers; its
  // callback APPENDS to the cumulative `markers` array.
  const markerBatcherRef = useRef<RealtimeBatcher<MarkerMessage> | null>(null);

  useEffect(() => {
    const client = new WebSocketClient({ url });
    clientRef.current = client;

    // Phase 50: build the batchers. The callback takes the
    // items from a single frame; the latest item wins (the
    // dashboard only shows the current price, not a tick
    // history). For more complex use cases the consumer
    // could push each item into a useRef'd ring buffer.
    const tickBatcher = new RealtimeBatcher<TickMessage>((items) => {
      const last = items[items.length - 1];
      setLastTick(last);
    });
    const barBatcher = new RealtimeBatcher<BarMessage>((items) => {
      const last = items[items.length - 1];
      setLastBar(last);
    });
    // Phase 55-3: marker batcher. The callback appends each
    // frame's batch to the cumulative `markers` array.
    const markerBatcher = new RealtimeBatcher<MarkerMessage>((items) => {
      if (items.length === 0) return;
      setMarkers((prev) => [...prev, ...items]);
    });
    tickBatcherRef.current = tickBatcher;
    barBatcherRef.current = barBatcher;
    markerBatcherRef.current = markerBatcher;

    const offStatus = client.onStatus(setStatus);
    const offSnapshot = client.onSnapshot(setSnapshot);
    const offState = client.onState(setLastState);
    const offError = client.onError(setLastError);
    // Phase 50: wire the client → batcher → state pipeline.
    // The client emits every tick; the batcher coalesces them
    // into one setState per frame.
    const offTick = client.onTick((m) => {
      tickBatcher.push(m);
    });
    const offBar = client.onBar((m) => {
      barBatcher.push(m);
    });
    // Phase 55-3: marker subscription.
    const offMarker = client.onMarker((m) => {
      markerBatcher.push(m);
    });
    client.start();
    return (): void => {
      offStatus();
      offSnapshot();
      offState();
      offError();
      offTick();
      offBar();
      offMarker();
      // Phase 50: drain any remaining queued items on unmount
      // so the React state is consistent with the last batch
      // the page received. Without this, ticks queued in the
      // last frame before unmount would be silently dropped.
      tickBatcher.flushNow();
      barBatcher.flushNow();
      // Phase 55-3: drain marker queue on unmount too.
      markerBatcher.flushNow();
      tickBatcherRef.current = null;
      barBatcherRef.current = null;
      markerBatcherRef.current = null;
      client.close();
      clientRef.current = null;
    };
  }, [url]);

  const send = useCallback((msg: ClientMessage): void => {
    clientRef.current?.send(msg);
  }, []);

  return {
    status,
    snapshot,
    lastState,
    lastError,
    lastTick,
    lastBar,
    markers,
    send,
  };
}
