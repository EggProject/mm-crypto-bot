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
 *
 * Phase 58: the state machine is extracted into a pure reducer
 * (`reduce(state, event) → { state, effects }`) in
 * `apps/web/src/ws-client-state.ts`. The class is now a thin
 * shell: it holds the imperative bits (the socket, the scheduler
 * handle, the listener sets), the State, and forwards every
 * event to the reducer. The reducer's branches are unit-testable
 * WITHOUT a WebSocket / Playwright / React renderer.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { RealtimeBatcher } from "./lib/realtime-batcher.js";
import {
  buildPongPayload,
  DEFAULT_BACKOFF_SEQUENCE_MS,
  INITIAL_WS_STATE,
  type WsEffect,
  type WsEvent,
  type WsState,
  reduce,
} from "./ws-client-state.js";

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
  readonly send: (msg: ClientMessage) => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_URL =
  typeof import.meta.env.VITE_WS_URL === "string" && import.meta.env.VITE_WS_URL.length > 0
    ? import.meta.env.VITE_WS_URL
    : "ws://127.0.0.1:7913/ws";

// =============================================================================
// Re-exports of the pure helpers + reducer (Phase 53C / 54B / 56A / 58)
//
// The actual implementations live in `ws-client-state.ts`. The class
// (and the existing test file) imports them through this module for
// backward compatibility.
// =============================================================================

export {
  nextBackoffMs,
  shouldQueueSend,
  shouldScheduleReconnect,
  parseServerMessage,
  shouldCrashOnError,
  buildPongPayload,
  reduce,
  INITIAL_WS_STATE,
  DEFAULT_BACKOFF_SEQUENCE_MS,
  type WsState,
  type WsEvent,
  type WsEffect,
  type WsReduceResult,
  type ServerMessageParseResult,
} from "./ws-client-state.js";

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
// `WebSocketClient` — the testable core (Phase 58: thin shell over reducer)
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
 * `WebSocketClient` — thin shell that holds the imperative bits
 * (the socket, the scheduler handle, the listener sets) and the
 * pure `WsState`. Every event flows through `dispatch(event)` →
 * `reduce(state, event) → { state, effects }` → the class executes
 * the effects. The reducer is the source of truth for the state
 * machine; the class is the source of truth for the imperative
 * side effects.
 */
export class WebSocketClient {
  private readonly url: string;
  private readonly createSocket: WebSocketFactory;
  private readonly backoffMs: readonly number[];
  private readonly scheduler: {
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };

  // The pure state machine. Mutated only via `dispatch()` (which
  // calls the reducer and replaces `this.state` with the new state).
  private state: WsState = INITIAL_WS_STATE;

  // Imperative bits (NOT in the state):
  private socket: WebSocketLike | null = null;
  private reconnectHandle: unknown = null;

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

  constructor(options: WebSocketClientOptions = {}) {
    this.url = options.url ?? DEFAULT_URL;
    this.createSocket =
      options.createSocket ?? ((u: string): WebSocketLike => new WebSocket(u));
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_SEQUENCE_MS;
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
    return this.state.status;
  }

  /** Starts the connect loop. Idempotent. */
  start(): void {
    this.dispatch({ type: "START" });
  }

  /** Closes the socket permanently and cancels any pending reconnect. */
  close(): void {
    this.dispatch({ type: "CLOSE_USER" });
  }

  /** Sends a message; no-op if the socket is not open. */
  send(msg: ClientMessage): void {
    this.dispatch({ type: "SEND", msg });
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

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * `dispatch(event)` — the bridge between the imperative class and
   * the pure reducer. Calls `reduce(state, event)`, replaces
   * `this.state` with the new state, and executes the returned
   * effects in order. Every event source (user API, socket
   * lifecycle) goes through this single function.
   */
  private dispatch(event: WsEvent): void {
    const { state: nextState, effects } = reduce(
      this.state,
      event,
      this.backoffMs,
    );
    this.state = nextState;
    for (const effect of effects) {
      this.executeEffect(effect);
    }
  }

  /**
   * `executeEffect(effect)` — perform the imperative side effect
   * corresponding to the reducer's command. The reducer is the
   * source of truth for the state machine; this method is the
   * source of truth for the imperative actions.
   */
  private executeEffect(effect: WsEffect): void {
    switch (effect.type) {
      case "SET_STATUS": {
        for (const listener of this.statusListeners) {
          try {
            listener(effect.status);
          } catch {
            // best-effort
          }
        }
        return;
      }
      case "DISPATCH": {
        switch (effect.kind) {
          case "snapshot":
            for (const listener of this.snapshotListeners) {
              try {
                listener(
                  effect.msg as Extract<ServerMessage, { type: "snapshot" }>,
                );
              } catch {
                // best-effort
              }
            }
            return;
          case "state":
            for (const listener of this.stateListeners) {
              try {
                listener(
                  effect.msg as Extract<ServerMessage, { type: "state" }>,
                );
              } catch {
                // best-effort
              }
            }
            return;
          case "error":
            for (const listener of this.errorListeners) {
              try {
                listener(
                  effect.msg as Extract<ServerMessage, { type: "error" }>,
                );
              } catch {
                // best-effort
              }
            }
            return;
          case "tick":
            for (const listener of this.tickListeners) {
              try {
                listener(effect.msg as TickMessage);
              } catch {
                // best-effort
              }
            }
            return;
          case "bar":
            for (const listener of this.barListeners) {
              try {
                listener(effect.msg as BarMessage);
              } catch {
                // best-effort
              }
            }
            return;
        }
        return;
      }
      case "SEND_PONG": {
        if (this.socket !== null) {
          try {
            this.socket.send(JSON.stringify(buildPongPayload(effect.ts)));
          } catch {
            // best-effort
          }
        }
        return;
      }
      case "SEND_RAW": {
        if (this.socket !== null) {
          try {
            this.socket.send(effect.text);
          } catch {
            // best-effort
          }
        }
        return;
      }
      case "SCHEDULE_RECONNECT": {
        this.reconnectHandle = this.scheduler.setTimeout(() => {
          this.reconnectHandle = null;
          // The reconnect "fires" by emitting a START event, which
          // the reducer will turn into a new CONNECT effect (creating
          // a fresh socket). The status is already "disconnected" at
          // this point, so the reducer's START → "connecting"
          // transition will be observed.
          this.dispatch({ type: "START" });
        }, effect.delayMs);
        return;
      }
      case "CANCEL_RECONNECT": {
        if (this.reconnectHandle !== null) {
          this.scheduler.clearTimeout(this.reconnectHandle);
          this.reconnectHandle = null;
        }
        return;
      }
      case "CLOSE_SOCKET": {
        if (this.socket !== null) {
          try {
            this.socket.close();
          } catch {
            // best-effort
          }
          this.socket = null;
        }
        return;
      }
      case "CONNECT": {
        this.createSocketAndWire();
        return;
      }
    }
  }

  /**
   * `createSocketAndWire()` — imperative side of the CONNECT
   * effect. Creates a new socket via the factory and wires its
   * lifecycle events to `dispatch()`. This is the only place
   * where the class creates a new socket.
   */
  private createSocketAndWire(): void {
    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.dispatch({ type: "SOCKET_OPEN" });
    });
    socket.addEventListener("message", (event) => {
      const data = (event as { data?: string }).data;
      this.dispatch({ type: "RAW_MESSAGE", data });
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      this.dispatch({ type: "SOCKET_CLOSE" });
    });
    socket.addEventListener("error", () => {
      // The "close" event fires after "error" — the reconnect logic
      // lives in the close handler. This is a no-op.
      this.dispatch({ type: "SOCKET_ERROR" });
    });
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

  // The client lives in a ref so the `send` callback (and other handlers)
  // can access it without re-creating on every render.
  const clientRef = useRef<WebSocketClient | null>(null);
  // The batcher lives in a ref so it survives across renders
  // without being recreated (recreation would lose queued items).
  const tickBatcherRef = useRef<RealtimeBatcher<TickMessage> | null>(null);
  const barBatcherRef = useRef<RealtimeBatcher<BarMessage> | null>(null);

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
    tickBatcherRef.current = tickBatcher;
    barBatcherRef.current = barBatcher;

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
    client.start();
    return (): void => {
      offStatus();
      offSnapshot();
      offState();
      offError();
      offTick();
      offBar();
      // Phase 50: drain any remaining queued items on unmount
      // so the React state is consistent with the last batch
      // the page received. Without this, ticks queued in the
      // last frame before unmount would be silently dropped.
      tickBatcher.flushNow();
      barBatcher.flushNow();
      tickBatcherRef.current = null;
      barBatcherRef.current = null;
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
    send,
  };
}
