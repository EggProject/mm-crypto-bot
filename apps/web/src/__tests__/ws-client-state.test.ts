/**
 * apps/web/src/__tests__/ws-client-state.test.ts
 *
 * Phase 58: bun:test unit tests for the pure-function state machine in
 * `ws-client-state.ts`.
 *
 * **Coverage target:** 100% line + branch + function coverage on
 * `ws-client-state.ts`. The reducer is pure (no React, no DOM, no I/O),
 * so a single bun:test file with focused describe/it blocks per event
 * type is enough.
 *
 * The reducer takes a `WsState` + `WsEvent` and returns a new `WsState`
 * + `WsEffect[]`. Every arm of the state machine is tested by
 * constructing the input state + event and asserting on the output
 * state + effect list.
 *
 * **Test groups mirror the event types:**
 *   - `START` — closedByCaller=true (no-op) vs closedByCaller=false (connect)
 *   - `CLOSE_USER` — always: cancel + close + status=disconnected
 *   - `SOCKET_OPEN` — always: status=connected, attempt=0, socketOpen=true
 *   - `SOCKET_CLOSE` — shouldScheduleReconnect=true (schedule) vs
 *     false (no-op)
 *   - `SOCKET_ERROR` — no-op
 *   - `RAW_MESSAGE` — every server message type + parse failures
 *   - `SEND` — socketOpen=true vs false
 *
 * Plus tests for the pure helpers (`nextBackoffMs`, `shouldQueueSend`,
 * `shouldScheduleReconnect`, `parseServerMessage`, `shouldCrashOnError`,
 * `buildPongPayload`) that live in the same file.
 */

import { describe, expect, it } from "bun:test";

import {
  buildPongPayload,
  DEFAULT_BACKOFF_SEQUENCE_MS,
  INITIAL_WS_STATE,
  parseServerMessage,
  shouldCrashOnError,
  shouldQueueSend,
  shouldScheduleReconnect,
  nextBackoffMs,
  reduce,
  type WsEffect,
  type WsEvent,
  type WsState,
} from "../ws-client-state.js";

// =============================================================================
// Test fixtures
// =============================================================================

const SNAPSHOT_MSG = {
  type: "snapshot" as const,
  ts: 1,
  snapshot: { positions: [], closedTrades: [] },
  strategies: [],
  ohlcBootstrap: {},
};

const STATE_MSG = {
  type: "state" as const,
  ts: 2,
  snapshot: {},
  positions: [],
  closedTrades: [],
  killSwitch: "armed",
  paused: false,
  statistics: {},
};

const TICK_MSG = { type: "tick" as const, ts: 3, symbol: "BTC/USDC", price: 100 };

const BAR_MSG = {
  type: "bar" as const,
  ts: 4,
  symbol: "BTC/USDC",
  timeframe: "1h",
  ohlc: { open: 1, high: 2, low: 0.5, close: 1.5 },
};

const PING_MSG = { type: "ping" as const, ts: 5 };

const HELLO_MSG = {
  type: "hello" as const,
  ts: 6,
  serverVersion: "1.0.0",
  protocolVersion: 1,
};

const INDICATOR_MSG = {
  type: "indicator" as const,
  ts: 7,
  strategy: "s1",
  timeframe: "1h",
  indicator: "rsi",
  series: {},
};

const MARKER_MSG = {
  type: "marker" as const,
  ts: 8,
  strategy: "s1",
  timeframe: "1h",
  side: "buy",
  price: 100,
  label: "entry",
};

const RECOVERABLE_ERROR_MSG = {
  type: "error" as const,
  ts: 9,
  message: "transient",
  recoverable: true,
};

const NON_RECOVERABLE_ERROR_MSG = {
  type: "error" as const,
  ts: 10,
  message: "fatal",
  recoverable: false,
};

// =============================================================================
// INITIAL_WS_STATE
// =============================================================================

describe("INITIAL_WS_STATE", () => {
  it("starts as disconnected, attempt=0, closedByCaller=false, socketOpen=false", () => {
    expect(INITIAL_WS_STATE).toEqual({
      status: "disconnected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    });
  });

  it("is frozen (immutable at the type level — readonly fields)", () => {
    // Just a sanity check: the type is `Readonly<...>`. The runtime
    // object is NOT frozen, but assigning to a readonly field would
    // be a TS error. We assert the field values directly.
    expect(INITIAL_WS_STATE.status).toBe("disconnected");
    expect(INITIAL_WS_STATE.attempt).toBe(0);
    expect(INITIAL_WS_STATE.closedByCaller).toBe(false);
    expect(INITIAL_WS_STATE.socketOpen).toBe(false);
  });
});

// =============================================================================
// `reduce` — START
// =============================================================================

describe("reduce — START", () => {
  it("START with closedByCaller=false → status=connecting, effect CONNECT + SET_STATUS", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, { type: "START" });
    expect(result.state).toEqual({
      status: "connecting",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    });
    expect(result.effects).toContainEqual({
      type: "SET_STATUS",
      status: "connecting",
    });
    expect(result.effects).toContainEqual({ type: "CONNECT" });
    expect(result.effects.length).toBe(2);
  });

  it("START with closedByCaller=true → no-op (state unchanged, no effects)", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 5,
      closedByCaller: true,
      socketOpen: false,
    };
    const result = reduce(before, { type: "START" });
    expect(result.state).toBe(before); // same object
    expect(result.effects).toEqual([]);
  });

  it("START with closedByCaller=true and status=crashed → no-op", () => {
    const before: WsState = {
      status: "crashed",
      attempt: 0,
      closedByCaller: true,
      socketOpen: false,
    };
    const result = reduce(before, { type: "START" });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });

  it("START preserves attempt counter when transitioning to connecting", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 3,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, { type: "START" });
    expect(result.state.attempt).toBe(3); // attempt NOT reset on start
  });
});

// =============================================================================
// `reduce` — CLOSE_USER
// =============================================================================

describe("reduce — CLOSE_USER", () => {
  it("CLOSE_USER from connected → status=disconnected, closedByCaller=true, socketOpen=false", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, { type: "CLOSE_USER" });
    expect(result.state).toEqual({
      status: "disconnected",
      attempt: 0,
      closedByCaller: true,
      socketOpen: false,
    });
  });

  it("CLOSE_USER always emits CANCEL_RECONNECT, SET_STATUS, CLOSE_SOCKET (in that order)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, { type: "CLOSE_USER" });
    expect(result.effects).toEqual([
      { type: "CANCEL_RECONNECT" },
      { type: "SET_STATUS", status: "disconnected" },
      { type: "CLOSE_SOCKET" },
    ]);
  });

  it("CLOSE_USER from connecting → also works (idempotent semantics)", () => {
    const before: WsState = {
      status: "connecting",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, { type: "CLOSE_USER" });
    expect(result.state.status).toBe("disconnected");
    expect(result.state.closedByCaller).toBe(true);
  });

  it("CLOSE_USER from crashed → also works (already closedByCaller)", () => {
    const before: WsState = {
      status: "crashed",
      attempt: 0,
      closedByCaller: true,
      socketOpen: false,
    };
    const result = reduce(before, { type: "CLOSE_USER" });
    expect(result.state.status).toBe("disconnected");
    expect(result.state.closedByCaller).toBe(true);
  });
});

// =============================================================================
// `reduce` — SOCKET_OPEN
// =============================================================================

describe("reduce — SOCKET_OPEN", () => {
  it("SOCKET_OPEN from connecting → status=connected, attempt=0, socketOpen=true", () => {
    const before: WsState = {
      status: "connecting",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, { type: "SOCKET_OPEN" });
    expect(result.state).toEqual({
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    });
    expect(result.effects).toEqual([
      { type: "SET_STATUS", status: "connected" },
    ]);
  });

  it("SOCKET_OPEN resets attempt to 0 (even if it was non-zero)", () => {
    const before: WsState = {
      status: "connecting",
      attempt: 7,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, { type: "SOCKET_OPEN" });
    expect(result.state.attempt).toBe(0);
  });
});

// =============================================================================
// `reduce` — SOCKET_CLOSE
// =============================================================================

describe("reduce — SOCKET_CLOSE", () => {
  it("SOCKET_CLOSE with shouldScheduleReconnect=true (server-side) → status=disconnected, attempt++, SCHEDULE_RECONNECT", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, { type: "SOCKET_CLOSE" });
    expect(result.state).toEqual({
      status: "disconnected",
      attempt: 1,
      closedByCaller: false,
      socketOpen: false,
    });
    expect(result.effects).toEqual([
      { type: "SET_STATUS", status: "disconnected" },
      { type: "SCHEDULE_RECONNECT", delayMs: 1_000 },
    ]);
  });

  it("SOCKET_CLOSE walks the backoff schedule (attempt=2 → 4s)", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 2,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, { type: "SOCKET_CLOSE" });
    expect(result.effects).toContainEqual({
      type: "SCHEDULE_RECONNECT",
      delayMs: 4_000,
    });
  });

  it("SOCKET_CLOSE uses a custom backoff schedule when provided", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const customSchedule = [500, 1_500];
    const result = reduce(before, { type: "SOCKET_CLOSE" }, customSchedule);
    expect(result.effects).toContainEqual({
      type: "SCHEDULE_RECONNECT",
      delayMs: 500,
    });
  });

  it("SOCKET_CLOSE with closedByCaller=true (user-initiated) → no-op", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 0,
      closedByCaller: true,
      socketOpen: false,
    };
    const result = reduce(before, { type: "SOCKET_CLOSE" });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });

  it("SOCKET_CLOSE with status=crashed → no-op", () => {
    const before: WsState = {
      status: "crashed",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, { type: "SOCKET_CLOSE" });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });

  it("SOCKET_CLOSE preserves attempt counter increment (attempt=5 → 6, delay=30s cap)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 5,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, { type: "SOCKET_CLOSE" });
    expect(result.state.attempt).toBe(6);
    expect(result.effects).toContainEqual({
      type: "SCHEDULE_RECONNECT",
      delayMs: 30_000,
    });
  });
});

// =============================================================================
// `reduce` — SOCKET_ERROR
// =============================================================================

describe("reduce — SOCKET_ERROR", () => {
  it("SOCKET_ERROR is always a no-op (close event is authoritative)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, { type: "SOCKET_ERROR" });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });

  it("SOCKET_ERROR from crashed → still no-op", () => {
    const before: WsState = {
      status: "crashed",
      attempt: 0,
      closedByCaller: true,
      socketOpen: false,
    };
    const result = reduce(before, { type: "SOCKET_ERROR" });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });
});

// =============================================================================
// `reduce` — RAW_MESSAGE
// =============================================================================

describe("reduce — RAW_MESSAGE (parse failures)", () => {
  it("data=undefined → no-op (parse failure: no-data)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, { type: "RAW_MESSAGE", data: undefined });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });

  it("invalid JSON → no-op (parse failure: invalid-json)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: "{ not valid json",
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });
});

describe("reduce — RAW_MESSAGE (snapshot)", () => {
  it("snapshot message → DISPATCH(snapshot), state unchanged", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(SNAPSHOT_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([
      { type: "DISPATCH", kind: "snapshot", msg: SNAPSHOT_MSG },
    ]);
  });
});

describe("reduce — RAW_MESSAGE (state)", () => {
  it("state message → DISPATCH(state), state unchanged", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(STATE_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([
      { type: "DISPATCH", kind: "state", msg: STATE_MSG },
    ]);
  });
});

describe("reduce — RAW_MESSAGE (error)", () => {
  it("recoverable error → DISPATCH(error), no state change, no CLOSE_SOCKET", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(RECOVERABLE_ERROR_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([
      { type: "DISPATCH", kind: "error", msg: RECOVERABLE_ERROR_MSG },
    ]);
  });

  it("non-recoverable error → status=crashed, closedByCaller=true, socketOpen=false; effects: DISPATCH, SET_STATUS(crashed), CLOSE_SOCKET", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(NON_RECOVERABLE_ERROR_MSG),
    });
    expect(result.state).toEqual({
      status: "crashed",
      attempt: 0,
      closedByCaller: true,
      socketOpen: false,
    });
    expect(result.effects).toEqual([
      { type: "DISPATCH", kind: "error", msg: NON_RECOVERABLE_ERROR_MSG },
      { type: "SET_STATUS", status: "crashed" },
      { type: "CLOSE_SOCKET" },
    ]);
  });
});

describe("reduce — RAW_MESSAGE (ping)", () => {
  it("ping with socketOpen=true → SEND_PONG(ts)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(PING_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([{ type: "SEND_PONG", ts: 5 }]);
  });

  it("ping with socketOpen=false → no-op (cannot send)", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(PING_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });
});

describe("reduce — RAW_MESSAGE (tick / bar / hello / indicator / marker)", () => {
  it("tick → DISPATCH(tick)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(TICK_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([
      { type: "DISPATCH", kind: "tick", msg: TICK_MSG },
    ]);
  });

  it("bar → DISPATCH(bar)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(BAR_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([
      { type: "DISPATCH", kind: "bar", msg: BAR_MSG },
    ]);
  });

  it("hello → no-op (not yet wired)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(HELLO_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });

  it("indicator → no-op (not yet wired)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(INDICATOR_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });

  it("marker → no-op (not yet wired)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const result = reduce(before, {
      type: "RAW_MESSAGE",
      data: JSON.stringify(MARKER_MSG),
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });
});

// =============================================================================
// `reduce` — SEND
// =============================================================================

describe("reduce — SEND", () => {
  it("SEND with socketOpen=true → SEND_RAW(JSON.stringify(msg))", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const clientMsg = {
      type: "subscribe" as const,
      symbol: "BTC/USDC",
      timeframe: "1h",
    };
    const result = reduce(before, { type: "SEND", msg: clientMsg });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([
      { type: "SEND_RAW", text: JSON.stringify(clientMsg) },
    ]);
  });

  it("SEND with socketOpen=false → no-op", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, {
      type: "SEND",
      msg: { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
    });
    expect(result.state).toBe(before);
    expect(result.effects).toEqual([]);
  });

  it("SEND with control message → SEND_RAW preserves the message structure", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const clientMsg = { type: "control" as const, command: "kill", confirm: true };
    const result = reduce(before, { type: "SEND", msg: clientMsg });
    expect(result.effects).toEqual([
      { type: "SEND_RAW", text: JSON.stringify(clientMsg) },
    ]);
  });

  it("SEND with pong message → SEND_RAW preserves the ts", () => {
    const before: WsState = {
      status: "connected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: true,
    };
    const clientMsg = { type: "pong" as const, ts: 42 };
    const result = reduce(before, { type: "SEND", msg: clientMsg });
    expect(result.effects).toEqual([
      { type: "SEND_RAW", text: JSON.stringify(clientMsg) },
    ]);
  });
});

// =============================================================================
// Pure helpers (Phase 53C / 54B / 56A — moved here from ws-client.ts)
// =============================================================================

describe("nextBackoffMs", () => {
  it("returns schedule[0] for attempt=0", () => {
    expect(nextBackoffMs(0, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(1_000);
  });

  it("walks the schedule: 1s, 2s, 4s, 8s, 16s, 30s", () => {
    expect(nextBackoffMs(0, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(1_000);
    expect(nextBackoffMs(1, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(2_000);
    expect(nextBackoffMs(2, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(4_000);
    expect(nextBackoffMs(3, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(8_000);
    expect(nextBackoffMs(4, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(16_000);
    expect(nextBackoffMs(5, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(30_000);
  });

  it("caps at the last element for attempt >= length", () => {
    expect(nextBackoffMs(6, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(30_000);
    expect(nextBackoffMs(7, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(30_000);
    expect(nextBackoffMs(100, DEFAULT_BACKOFF_SEQUENCE_MS)).toBe(30_000);
  });

  it("returns 30_000 for an empty schedule", () => {
    expect(nextBackoffMs(0, [])).toBe(30_000);
    expect(nextBackoffMs(5, [])).toBe(30_000);
  });

  it("handles a single-element schedule (everything is the cap)", () => {
    expect(nextBackoffMs(0, [10_000])).toBe(10_000);
    expect(nextBackoffMs(50, [10_000])).toBe(10_000);
  });

  it("does not mutate the input schedule", () => {
    const schedule = [1_000, 2_000, 4_000];
    const snapshot = [...schedule];
    nextBackoffMs(0, schedule);
    nextBackoffMs(5, schedule);
    nextBackoffMs(99, schedule);
    expect(schedule).toEqual(snapshot);
  });
});

describe("shouldQueueSend", () => {
  it("returns false for null socket", () => {
    expect(shouldQueueSend(null)).toBe(false);
  });

  it("returns false when readyState is 0 (CONNECTING)", () => {
    expect(shouldQueueSend({ readyState: 0 })).toBe(false);
  });

  it("returns true when readyState is 1 (OPEN)", () => {
    expect(shouldQueueSend({ readyState: 1 })).toBe(true);
  });

  it("returns false when readyState is 2 (CLOSING)", () => {
    expect(shouldQueueSend({ readyState: 2 })).toBe(false);
  });

  it("returns false when readyState is 3 (CLOSED)", () => {
    expect(shouldQueueSend({ readyState: 3 })).toBe(false);
  });
});

describe("shouldScheduleReconnect", () => {
  it("returns false when status is 'crashed'", () => {
    expect(shouldScheduleReconnect("crashed", false)).toBe(false);
  });

  it("returns false when closedByCaller is true", () => {
    expect(shouldScheduleReconnect("disconnected", true)).toBe(false);
    expect(shouldScheduleReconnect("connected", true)).toBe(false);
  });

  it("returns true when status is 'disconnected' and closedByCaller is false", () => {
    expect(shouldScheduleReconnect("disconnected", false)).toBe(true);
  });

  it("returns true when status is 'connecting' and closedByCaller is false", () => {
    expect(shouldScheduleReconnect("connecting", false)).toBe(true);
  });

  it("returns true when status is 'connected' and closedByCaller is false", () => {
    expect(shouldScheduleReconnect("connected", false)).toBe(true);
  });
});

describe("parseServerMessage", () => {
  it("returns ok=false with reason='no-data' for undefined input", () => {
    expect(parseServerMessage(undefined)).toEqual({
      ok: false,
      reason: "no-data",
    });
  });

  it("returns ok=true for valid JSON", () => {
    const result = parseServerMessage(JSON.stringify(SNAPSHOT_MSG));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.msg).toEqual(SNAPSHOT_MSG);
  });

  it("returns ok=false with reason='invalid-json' for malformed JSON", () => {
    expect(parseServerMessage("{ not valid json")).toEqual({
      ok: false,
      reason: "invalid-json",
    });
  });

  it("returns ok=false for empty string (invalid JSON)", () => {
    expect(parseServerMessage("")).toEqual({
      ok: false,
      reason: "invalid-json",
    });
  });
});

describe("shouldCrashOnError", () => {
  it("returns true when recoverable is false", () => {
    expect(shouldCrashOnError({ recoverable: false })).toBe(true);
  });

  it("returns false when recoverable is true", () => {
    expect(shouldCrashOnError({ recoverable: true })).toBe(false);
  });
});

describe("buildPongPayload", () => {
  it("builds a pong payload with the given ts", () => {
    expect(buildPongPayload(42)).toEqual({ type: "pong", ts: 42 });
  });

  it("builds a pong payload with ts=0", () => {
    expect(buildPongPayload(0)).toEqual({ type: "pong", ts: 0 });
  });
});

// =============================================================================
// Reducer purity / immutability
// =============================================================================

describe("reduce — purity", () => {
  it("does not mutate the input state object (START case)", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    };
    const snapshot: WsState = { ...before };
    reduce(before, { type: "START" });
    expect(before).toEqual(snapshot);
  });

  it("does not mutate the input state object (SOCKET_CLOSE case)", () => {
    const before: WsState = {
      status: "connected",
      attempt: 3,
      closedByCaller: false,
      socketOpen: true,
    };
    const snapshot: WsState = { ...before };
    reduce(before, { type: "SOCKET_CLOSE" });
    expect(before).toEqual(snapshot);
  });

  it("returns a NEW state object (not the same reference) when state changes", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    };
    const result = reduce(before, { type: "START" });
    expect(result.state).not.toBe(before);
    expect(result.state.status).toBe("connecting");
  });

  it("returns the SAME state object (same reference) when state is unchanged", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 0,
      closedByCaller: true,
      socketOpen: false,
    };
    const result = reduce(before, { type: "START" });
    expect(result.state).toBe(before); // no-op case
  });

  it("effects array is a fresh array on each call (no shared references)", () => {
    const before: WsState = {
      status: "disconnected",
      attempt: 0,
      closedByCaller: false,
      socketOpen: false,
    };
    const a = reduce(before, { type: "START" }).effects;
    const b = reduce(before, { type: "START" }).effects;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// =============================================================================
// Type-level sanity checks (compile-only — would fail at compile time if wrong)
// =============================================================================

// These checks verify that the exported types are what we expect. They
// do not assert at runtime; they're here so that future refactors that
// accidentally change a type break the test file at compile time.
const _typeChecks: {
  readonly eventIsWsEvent: WsEvent;
  readonly effectIsWsEffect: WsEffect;
  readonly stateIsWsState: WsState;
} = {
  eventIsWsEvent: { type: "START" },
  effectIsWsEffect: { type: "CONNECT" },
  stateIsWsState: INITIAL_WS_STATE,
};
void _typeChecks;
