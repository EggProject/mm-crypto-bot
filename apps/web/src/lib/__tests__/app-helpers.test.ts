/**
 * apps/web/src/lib/__tests__/app-helpers.test.ts
 *
 * Phase 56B: unit tests for the pure helpers extracted from
 * `App.tsx` into `app-helpers.ts`.
 *
 * Each helper has 100% line + branch coverage from this file.
 * The e2e suite (56B-app-helpers.spec.ts) drives the React flow
 * through the same branches via the App component; the two
 * coverage dimensions (unit + e2e) are intentionally separate.
 *
 * Branch coverage intent:
 *   - `mapFeedState`: 4 statuses × 1 branch each (4 tests)
 *   - `extractBarsByKey`: 5 shapes (null, primitive, empty object,
 *     object with empty ohlcBootstrap, object with real bars)
 *   - `buildStatusLabel`: 4 statuses × 1-2 branches each (6 tests)
 *   - `buildFeedMeta`: 3 ?? chain branches (3 tests)
 *   - `buildFetchErrorMessage`: 4 error shapes (AbortError, generic
 *     Error, non-Error object, undefined)
 *   - `applyParsedStrategies`: 2 result shapes (ok, not-ok)
 */

import { describe, expect, it } from "bun:test";

import {
  applyParsedStrategies,
  buildFetchErrorMessage,
  buildFeedMeta,
  buildStatusLabel,
  extractBarsByKey,
  mapFeedState,
} from "../app-helpers.js";

// =============================================================================
// mapFeedState
// =============================================================================

describe("mapFeedState", () => {
  it("maps 'connected' to 'live'", () => {
    expect(mapFeedState("connected")).toBe("live");
  });

  it("maps 'crashed' to 'crashed' (the originally-uncovered branch)", () => {
    // The "crashed" branch in App.tsx's inline `mapFeedState` was
    // uncovered by the e2e suite before 56B because no test sent
    // a non-recoverable error to App's WS. The 56B-02 e2e test
    // exercises this branch; the unit test pins the behavior.
    expect(mapFeedState("crashed")).toBe("crashed");
  });

  it("maps 'disconnected' to 'disconnected'", () => {
    expect(mapFeedState("disconnected")).toBe("disconnected");
  });

  it("maps 'connecting' to 'stale' (the default fallthrough)", () => {
    expect(mapFeedState("connecting")).toBe("stale");
  });
});

// =============================================================================
// extractBarsByKey
// =============================================================================

describe("extractBarsByKey", () => {
  it("returns {} for null input", () => {
    expect(extractBarsByKey(null)).toEqual({});
  });

  it("returns {} for primitive input (string)", () => {
    expect(extractBarsByKey("not-an-object")).toEqual({});
  });

  it("returns {} for primitive input (number)", () => {
    expect(extractBarsByKey(42)).toEqual({});
  });

  it("returns {} when snapshot is an object but ohlcBootstrap is missing", () => {
    expect(extractBarsByKey({})).toEqual({});
    expect(extractBarsByKey({ strategies: [] })).toEqual({});
  });

  it("returns {} when ohlcBootstrap is null", () => {
    expect(extractBarsByKey({ ohlcBootstrap: null })).toEqual({});
  });

  it("returns {} when ohlcBootstrap is a primitive", () => {
    expect(extractBarsByKey({ ohlcBootstrap: "not-an-object" })).toEqual({});
  });

  it("returns {} when ohlcBootstrap is an empty object (the existing 53C/55-2 path)", () => {
    expect(extractBarsByKey({ ohlcBootstrap: {} })).toEqual({});
  });

  it("extracts bars for a (symbol, tf) pair (the originally-uncovered branches)", () => {
    // The 56B-01 e2e test sends a snapshot with real bars; this
    // unit test pins the expected mapping. The key format is
    // `${symbol}|${timeframe}` (see `chartKeyToString` in
    // `lib/subscription.ts`). OHLCBar requires a `volume` field,
    // so we include one in each bar.
    const bars = [
      { time: 1, open: 100, high: 105, low: 95, close: 102, volume: 10 },
    ];
    const result = extractBarsByKey({
      ohlcBootstrap: {
        BTCUSDT: { "1h": bars },
      },
    });
    expect(result).toEqual({ "BTCUSDT|1h": bars });
  });

  it("extracts bars for multiple (symbol, tf) pairs", () => {
    const bars1h = [
      { time: 1, open: 100, high: 105, low: 95, close: 102, volume: 10 },
    ];
    const bars4h = [
      { time: 2, open: 200, high: 205, low: 195, close: 202, volume: 20 },
    ];
    const result = extractBarsByKey({
      ohlcBootstrap: {
        BTCUSDT: { "1h": bars1h, "4h": bars4h },
        ETHUSDT: { "1h": bars1h },
      },
    });
    expect(result).toEqual({
      "BTCUSDT|1h": bars1h,
      "BTCUSDT|4h": bars4h,
      "ETHUSDT|1h": bars1h,
    });
  });

  it("skips non-array bar values (perTf entry with non-array)", () => {
    const validBars = [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    const result = extractBarsByKey({
      ohlcBootstrap: {
        BTCUSDT: {
          "1h": "not-an-array",
          "4h": validBars,
        },
      },
    });
    expect(result).toEqual({ "BTCUSDT|4h": validBars });
  });

  it("skips perTf entries that are not objects (null, primitive)", () => {
    const validBars = [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    const result = extractBarsByKey({
      ohlcBootstrap: {
        BTCUSDT: null,
        ETHUSDT: "not-an-object",
        SOLUSDT: { "1h": validBars },
      },
    });
    expect(result).toEqual({ "SOLUSDT|1h": validBars });
  });
});

// =============================================================================
// buildStatusLabel
// =============================================================================

describe("buildStatusLabel", () => {
  it("returns 'disconnected' label for status='disconnected'", () => {
    expect(buildStatusLabel("disconnected", null, null)).toBe(
      "WebSocket: disconnected",
    );
  });

  it("returns 'connecting' label for status='connecting'", () => {
    expect(buildStatusLabel("connecting", null, null)).toBe(
      "WebSocket: connecting…",
    );
  });

  it("returns 'connected' label WITHOUT snapshot count when snapshot is null", () => {
    // The `snapshot !== null ? ... : ""` branch — FALSE branch
    // (snapshot is null) was uncovered before 56B because the
    // existing 53C/55-2 tests always send a snapshot before
    // asserting. The 56B-01 test asserts the "connected (N
    // strategies)" suffix appears AFTER a snapshot arrives,
    // which is the TRUE branch; the FALSE branch is hit on
    // initial mount before the first snapshot.
    expect(buildStatusLabel("connected", null, null)).toBe(
      "WebSocket: connected",
    );
  });

  it("returns 'connected' label WITH snapshot count when snapshot is present", () => {
    expect(
      buildStatusLabel(
        "connected",
        { strategies: [{}, {}, {}] },
        null,
      ),
    ).toBe("WebSocket: connected (3 strategies)");
  });

  it("returns 'connected' label with 0 strategies when snapshot has empty list", () => {
    expect(buildStatusLabel("connected", { strategies: [] }, null)).toBe(
      "WebSocket: connected (0 strategies)",
    );
  });

  it("returns 'crashed' label with lastError.message when present", () => {
    // The `lastError?.message ?? "unknown"` branch — TRUE branch
    // (lastError.message is present) was uncovered before 56B
    // because the existing 55-2-04 test sends a non-recoverable
    // error ONLY to ControlBar's WS, not App's. The 56B-02 test
    // exercises this branch.
    expect(
      buildStatusLabel("crashed", null, new Error("engine exploded")),
    ).toBe("WebSocket: crashed — engine exploded");
  });

  it("returns 'crashed' label with 'unknown' when lastError is null", () => {
    // The FALSE branch (lastError undefined / null) was covered
    // indirectly via the switch fallthrough, but this test pins
    // the "unknown" fallback explicitly.
    expect(buildStatusLabel("crashed", null, null)).toBe(
      "WebSocket: crashed — unknown",
    );
  });
});

// =============================================================================
// buildFeedMeta
// =============================================================================

describe("buildFeedMeta", () => {
  it("returns lastError.message when lastError is present (priority 1)", () => {
    expect(buildFeedMeta(new Error("ws error"), "strategies error")).toBe(
      "ws error",
    );
  });

  it("returns strategiesError when lastError is null (priority 2, the originally-uncovered branch)", () => {
    // The 53C-06/07/08/09/10/11 tests trigger a strategies error
    // BUT they don't send any WS error message, so `lastError`
    // remains null. This is the `??` chain's middle branch.
    // The 56B-03 e2e test exercises this branch.
    expect(buildFeedMeta(null, "HTTP 500")).toBe("HTTP 500");
    expect(buildFeedMeta(undefined, "null body")).toBe("null body");
  });

  it("returns empty string when both are null (priority 3)", () => {
    expect(buildFeedMeta(null, null)).toBe("");
    expect(buildFeedMeta(undefined, undefined)).toBe("");
    expect(buildFeedMeta(null, undefined)).toBe("");
  });
});

// =============================================================================
// buildFetchErrorMessage
// =============================================================================

describe("buildFetchErrorMessage", () => {
  it("returns null for an AbortError (the fetch was cancelled, no error to surface)", () => {
    // The AbortError branch was uncovered before 56B — the 53C-08
    // test uses `route.abort('failed')` which produces a generic
    // network failure, NOT an AbortError. The 56B-04 test triggers
    // this branch by closing App's WS while a fetch is in flight.
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(buildFetchErrorMessage(err)).toBeNull();
  });

  it("returns the error message for a generic Error", () => {
    expect(buildFetchErrorMessage(new Error("Failed to fetch"))).toBe(
      "Failed to fetch",
    );
  });

  it("returns 'fetch failed' for a non-Error thrown value (string)", () => {
    // The `e instanceof Error` FALSE branch. Was uncovered
    // because the 53C-08 test produces a TypeError, not a string.
    // (The TypeError IS an Error, so it hits the TRUE branch.)
    expect(buildFetchErrorMessage("connection refused")).toBe("fetch failed");
  });

  it("returns 'fetch failed' for a non-Error thrown value (object)", () => {
    expect(buildFetchErrorMessage({ code: "ECONNREFUSED" })).toBe(
      "fetch failed",
    );
  });

  it("returns 'fetch failed' for undefined", () => {
    expect(buildFetchErrorMessage(undefined)).toBe("fetch failed");
  });

  it("returns 'fetch failed' for null", () => {
    expect(buildFetchErrorMessage(null)).toBe("fetch failed");
  });
});

// =============================================================================
// applyParsedStrategies
// =============================================================================

describe("applyParsedStrategies", () => {
  it("returns {strategies, error: null} when parsed.ok is true", () => {
    const result = applyParsedStrategies({
      ok: true,
      strategies: [
        {
          name: "donchian_pivot_composition",
          enabled: true,
          symbols: ["BTCUSDT"],
          timeframes: ["1h", "4h"],
        },
      ],
    });
    expect(result.strategies).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it("returns {strategies: null, error} when parsed.ok is false", () => {
    // The else branch (parsed.ok is false) was the only
    // originally-uncovered branch — the 53C-07/09/10/11 e2e
    // tests already exercise this via the React flow, so the
    // 56B suite inherits the coverage.
    const result = applyParsedStrategies({
      ok: false,
      error: "null body",
    });
    expect(result.strategies).toBeNull();
    expect(result.error).toBe("null body");
  });
});
