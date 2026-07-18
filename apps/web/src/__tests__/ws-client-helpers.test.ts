/**
 * apps/web/src/__tests__/ws-client-helpers.test.ts
 *
 * Phase 56A unit tests for the 3 NEW pure helpers extracted
 * from `ws-client.ts`:
 *
 *   - `parseServerMessage(data)` — message parsing (no-data / invalid-json)
 *   - `shouldCrashOnError(msg)` — error-classification predicate
 *   - `buildPongPayload(pingTs)` — pong response construction
 *
 * Each helper is 100% unit-tested in isolation (no WebSocket
 * mock, no React, no DOM). The existing `ws-client.test.ts`
 * tests the 3 pre-existing helpers (`nextBackoffMs`,
 * `shouldQueueSend`, `shouldScheduleReconnect`) — those are
 * NOT re-tested here to avoid duplication.
 *
 * The refactor moves the 4-branches-in-1-inline-block
 * patterns (no-data/valid-JSON/invalid-JSON/dispatch) out of
 * the `WebSocketClient` class into pure module-level
 * functions. The call sites in the class are still e2e-covered
 * via the existing 53C-* / 55-2-* / 54-helper-coverage tests.
 */

/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";

import {
  buildPongPayload,
  parseServerMessage,
  shouldCrashOnError,
} from "../ws-client.js";

// ============================================================================
// `parseServerMessage` — pure parser (Phase 56A)
// ============================================================================

describe("parseServerMessage", () => {
  it("returns ok:true for a valid snapshot JSON payload", () => {
    const data = JSON.stringify({
      type: "snapshot",
      ts: 1,
      snapshot: { positions: [] },
      strategies: [],
      ohlcBootstrap: {},
    });
    const result = parseServerMessage(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.msg.type).toBe("snapshot");
    } else {
      throw new Error("expected ok:true");
    }
  });

  it("returns ok:true for a valid state JSON payload", () => {
    const data = JSON.stringify({
      type: "state",
      ts: 2,
      snapshot: {},
      positions: [],
      closedTrades: [],
      killSwitch: "off",
      paused: false,
      statistics: {},
    });
    const result = parseServerMessage(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.msg.type).toBe("state");
    } else {
      throw new Error("expected ok:true");
    }
  });

  it("returns ok:true for a valid error JSON payload", () => {
    const data = JSON.stringify({
      type: "error",
      ts: 3,
      message: "transient",
      recoverable: true,
    });
    const result = parseServerMessage(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.msg.type).toBe("error");
    } else {
      throw new Error("expected ok:true");
    }
  });

  it("returns ok:true for a valid ping JSON payload", () => {
    const data = JSON.stringify({ type: "ping", ts: 99 });
    const result = parseServerMessage(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.msg.type).toBe("ping");
      if (result.msg.type === "ping") {
        expect(result.msg.ts).toBe(99);
      }
    } else {
      throw new Error("expected ok:true");
    }
  });

  it("returns ok:false with reason 'no-data' for undefined input", () => {
    const result = parseServerMessage(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-data");
    } else {
      throw new Error("expected ok:false");
    }
  });

  it("returns ok:false with reason 'invalid-json' for malformed JSON", () => {
    const result = parseServerMessage("{ this is not valid json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-json");
    } else {
      throw new Error("expected ok:false");
    }
  });

  it("returns ok:false with reason 'invalid-json' for empty string", () => {
    // Empty string is technically valid JSON-parse-wise (parses
    // to undefined) but the `as ServerMessage` cast + the lack
    // of any data field makes it unusable. JSON.parse("") throws
    // SyntaxError, so this should hit the catch branch.
    const result = parseServerMessage("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-json");
    } else {
      throw new Error("expected ok:false");
    }
  });

  it("returns ok:false with reason 'invalid-json' for partial JSON (truncated)", () => {
    // Truncated array — common server-bug failure mode.
    const result = parseServerMessage('{"type":"state","ts":1,"sna');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-json");
    } else {
      throw new Error("expected ok:false");
    }
  });
});

// ============================================================================
// `shouldCrashOnError` — pure predicate (Phase 56A)
// ============================================================================

describe("shouldCrashOnError", () => {
  it("returns false for a recoverable error message", () => {
    expect(
      shouldCrashOnError({ type: "error", recoverable: true } as never),
    ).toBe(false);
  });

  it("returns true for a non-recoverable error message", () => {
    expect(
      shouldCrashOnError({ type: "error", recoverable: false } as never),
    ).toBe(true);
  });

  it("accepts the minimal shape `{ recoverable: boolean }` (not just full ErrorMessage)", () => {
    // The function is intentionally typed as `{ recoverable: boolean }`
    // (a structural subtype of `Extract<ServerMessage, { type: "error" }>`)
    // so it can be unit-tested with a minimal mock object.
    expect(shouldCrashOnError({ recoverable: true })).toBe(false);
    expect(shouldCrashOnError({ recoverable: false })).toBe(true);
  });

  it("is pure: does not mutate the input", () => {
    const msg = { recoverable: true, message: "transient" };
    const snapshot = { ...msg };
    shouldCrashOnError(msg);
    shouldCrashOnError(msg);
    expect(msg).toEqual(snapshot);
  });
});

// ============================================================================
// `buildPongPayload` — pure function (Phase 56A)
// ============================================================================

describe("buildPongPayload", () => {
  it("returns an object with type='pong' and the given ts", () => {
    const payload = buildPongPayload(12345);
    expect(payload.type).toBe("pong");
    expect(payload.ts).toBe(12345);
  });

  it("preserves a unique ts verbatim (the round-trip contract)", () => {
    // The 55-2-05 e2e test uses a distinctive ts (9_999_999_999) to
    // verify the pong round-trips. The unit test confirms the
    // payload preserves the ts exactly.
    const uniqueTs = 9_999_999_999;
    const payload = buildPongPayload(uniqueTs);
    expect(payload.ts).toBe(uniqueTs);
  });

  it("returns a JSON-serializable object with exactly 2 keys", () => {
    // The payload is sent via `socket.send(JSON.stringify(payload))`,
    // so it must serialize cleanly. We also assert the shape is
    // minimal (no extra fields) so a future refactor doesn't
    // accidentally leak internal state.
    const payload = buildPongPayload(0);
    const keys = Object.keys(payload).sort();
    expect(keys).toEqual(["ts", "type"]);
    const json = JSON.stringify(payload);
    expect(JSON.parse(json)).toEqual({ type: "pong", ts: 0 });
  });

  it("handles ts=0 (the synthetic-ping test fixture)", () => {
    // `Date.now()` can theoretically return 0 (only on the
    // 1970-01-01 epoch, but the synthetic-ping ts in the e2e
    // tests is `0` for the "no-ping-yet" state). The helper
    // must preserve the literal value.
    const payload = buildPongPayload(0);
    expect(payload.ts).toBe(0);
    expect(payload.type).toBe("pong");
  });
});
