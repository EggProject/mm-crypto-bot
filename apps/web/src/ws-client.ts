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
 *   - send(msg: ClientMessage): void     (send SUBSCRIBE/UNSUBSCRIBE/CONTROL/PONG)
 *
 * Architecture: the `WebSocketClient` class is the testable unit (no
 * React renderer needed). The `useWebSocket` hook is a thin
 * `useEffect` wrapper that mounts the class and reads its state.
 */
import { useCallback, useEffect, useRef, useState } from "react";

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
  readonly send: (msg: ClientMessage) => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_URL = "ws://127.0.0.1:7913/ws";
const BACKOFF_SEQUENCE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

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
    // The literal `1` matches the WebSocket.OPEN constant. We use the
    // literal (not `WebSocket.OPEN`) so the test suite can replace
    // `globalThis.WebSocket` without breaking the readyState check.
    if (this.socket !== null && this.socket.readyState === 1) {
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
      // If the close was caused by a non-recoverable error, the
      // `handleMessage("error")` already set the status to "crashed"
      // and marked `closedByCaller = true` to prevent reconnect. We
      // must NOT overwrite "crashed" with "disconnected" here.
      if (this.currentStatus === "crashed") return;
      // If the caller called `close()`, they already set the status to
      // "disconnected" synchronously before triggering this event. Do
      // not emit a duplicate transition.
      if (this.closedByCaller) return;
      // Schedule reconnect with exponential backoff.
      const idx = Math.min(this.attempt, this.backoffMs.length - 1);
      // eslint-disable-next-line security/detect-object-injection
      const delay = this.backoffMs[idx] ?? 30_000;
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
      // tick, bar, indicator, marker, hello — Phase 48+ will handle.
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

  // The client lives in a ref so the `send` callback (and other handlers)
  // can access it without re-creating on every render.
  const clientRef = useRef<WebSocketClient | null>(null);

  useEffect(() => {
    const client = new WebSocketClient({ url });
    clientRef.current = client;
    const offStatus = client.onStatus(setStatus);
    const offSnapshot = client.onSnapshot(setSnapshot);
    const offState = client.onState(setLastState);
    const offError = client.onError(setLastError);
    client.start();
    return (): void => {
      offStatus();
      offSnapshot();
      offState();
      offError();
      client.close();
      clientRef.current = null;
    };
  }, [url]);

  const send = useCallback((msg: ClientMessage): void => {
    clientRef.current?.send(msg);
  }, []);

  return { status, snapshot, lastState, lastError, send };
}
