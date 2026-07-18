/**
 * apps/web/src/lib/__tests__/indicator-bridge.test.ts
 *
 * Phase 55-5: bun:test unit tests for the pure helper in
 * `lib/indicator-bridge.ts`. The three public functions:
 *   - `chartIndicatorKey(strategy, timeframe)` — key composer
 *   - `extractIndicatorFromMessage(msg)` — type-guard + validator
 *   - `mergeIndicatorsByKey(prev, msg)` — append/overwrite into the map
 *
 * The tests cover:
 *   - The happy path (valid message → extracted entry)
 *   - Each validation rule in `extractIndicatorFromMessage`
 *   - The upsert semantics of `mergeIndicatorsByKey` (new keys
 *     are added; existing keys are replaced; invalid messages
 *     leave the map unchanged)
 *   - Pure-function invariants (no mutation of inputs)
 */

import { describe, expect, it } from "bun:test";

import {
  chartIndicatorKey,
  extractIndicatorFromMessage,
  mergeIndicatorsByKey,
  type IndicatorEntry,
} from "../indicator-bridge.js";

// ============================================================================
// Test fixtures
// ============================================================================

/** Build a valid INDICATOR message for the given strategy/timeframe. */
function makeValidMessage(
  strategy = "donchian_pivot_composition",
  timeframe = "1h",
  indicator = "donchian",
  ts = 1_700_000_000_000,
): Record<string, unknown> {
  return {
    type: "indicator",
    ts,
    strategy,
    timeframe,
    indicator,
    series: { upper: [100, 101, 102], middle: [99, 100, 101], lower: [98, 99, 100] },
  };
}

// ============================================================================
// chartIndicatorKey
// ============================================================================

describe("chartIndicatorKey", () => {
  it("composes a strategy|timeframe key with a pipe separator", () => {
    expect(chartIndicatorKey("donchian_pivot_composition", "1h")).toBe(
      "donchian_pivot_composition|1h",
    );
  });

  it("handles an empty strategy (leading pipe)", () => {
    expect(chartIndicatorKey("", "1h")).toBe("|1h");
  });

  it("handles an empty timeframe (trailing pipe)", () => {
    expect(chartIndicatorKey("donchian_pivot_composition", "")).toBe(
      "donchian_pivot_composition|",
    );
  });

  it("round-trips with itself (key is unique per (strategy, timeframe))", () => {
    const a = chartIndicatorKey("strat_a", "1h");
    const b = chartIndicatorKey("strat_a", "4h");
    const c = chartIndicatorKey("strat_b", "1h");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});

// ============================================================================
// extractIndicatorFromMessage
// ============================================================================

describe("extractIndicatorFromMessage", () => {
  it("returns a typed entry for a valid message", () => {
    const msg = makeValidMessage();
    const out = extractIndicatorFromMessage(msg);
    expect(out).not.toBeNull();
    expect(out?.name).toBe("donchian");
    expect(out?.strategy).toBe("donchian_pivot_composition");
    expect(out?.timeframe).toBe("1h");
    expect(out?.ts).toBe(1_700_000_000_000);
    expect(typeof out?.series).toBe("object");
  });

  it("returns null for non-object input (the originally-uncovered branch)", () => {
    expect(extractIndicatorFromMessage(null)).toBeNull();
    expect(extractIndicatorFromMessage(undefined)).toBeNull();
    expect(extractIndicatorFromMessage(42)).toBeNull();
    expect(extractIndicatorFromMessage("hello")).toBeNull();
    expect(extractIndicatorFromMessage(true)).toBeNull();
  });

  it("returns null when type is not 'indicator'", () => {
    const msg = { ...makeValidMessage(), type: "tick" };
    expect(extractIndicatorFromMessage(msg)).toBeNull();
  });

  it("returns null when strategy is missing or empty", () => {
    const msg = { ...makeValidMessage(), strategy: "" };
    expect(extractIndicatorFromMessage(msg)).toBeNull();
    const m2 = makeValidMessage();
     
    delete (m2 as Record<string, unknown>).strategy;
    expect(extractIndicatorFromMessage(m2)).toBeNull();
  });

  it("returns null when timeframe is missing or empty", () => {
    const msg = { ...makeValidMessage(), timeframe: "" };
    expect(extractIndicatorFromMessage(msg)).toBeNull();
    const m2 = makeValidMessage();
     
    delete (m2 as Record<string, unknown>).timeframe;
    expect(extractIndicatorFromMessage(m2)).toBeNull();
  });

  it("returns null when indicator name is missing or empty", () => {
    const msg = { ...makeValidMessage(), indicator: "" };
    expect(extractIndicatorFromMessage(msg)).toBeNull();
    const m2 = makeValidMessage();
     
    delete (m2 as Record<string, unknown>).indicator;
    expect(extractIndicatorFromMessage(m2)).toBeNull();
  });

  it("returns null when ts is not a number", () => {
    const msg = { ...makeValidMessage(), ts: "1700000000000" };
    expect(extractIndicatorFromMessage(msg)).toBeNull();
  });

  it("returns null when series is not an object (e.g. a number)", () => {
    const msg = { ...makeValidMessage(), series: 42 };
    expect(extractIndicatorFromMessage(msg)).toBeNull();
  });

  it("returns null when series is null (the typeof check covers this)", () => {
    const msg = { ...makeValidMessage(), series: null };
    expect(extractIndicatorFromMessage(msg)).toBeNull();
  });
});

// ============================================================================
// mergeIndicatorsByKey
// ============================================================================

describe("mergeIndicatorsByKey", () => {
  it("adds a new entry for a previously-absent key", () => {
    const prev: Readonly<Record<string, IndicatorEntry>> = {};
    const msg = makeValidMessage("strat_a", "1h");
    const next = mergeIndicatorsByKey(prev, msg);
    expect(Object.keys(next)).toHaveLength(1);
    expect(next["strat_a|1h"]?.name).toBe("donchian");
  });

  it("replaces an existing entry for the same key (latest wins)", () => {
    const prev: Readonly<Record<string, IndicatorEntry>> = {
      "strat_a|1h": {
        name: "donchian",
        strategy: "strat_a",
        timeframe: "1h",
        series: { upper: [1, 2, 3] },
        ts: 100,
      },
    };
    const msg = makeValidMessage("strat_a", "1h", "funding", 200);
    const next = mergeIndicatorsByKey(prev, msg);
    expect(Object.keys(next)).toHaveLength(1);
    expect(next["strat_a|1h"]?.name).toBe("funding");
    expect(next["strat_a|1h"]?.ts).toBe(200);
  });

  it("preserves other entries when adding a new key", () => {
    const prev: Readonly<Record<string, IndicatorEntry>> = {
      "strat_a|1h": {
        name: "donchian",
        strategy: "strat_a",
        timeframe: "1h",
        series: {},
        ts: 100,
      },
    };
    const msg = makeValidMessage("strat_b", "4h");
    const next = mergeIndicatorsByKey(prev, msg);
    expect(Object.keys(next).sort()).toEqual(["strat_a|1h", "strat_b|4h"]);
    expect(next["strat_a|1h"]?.name).toBe("donchian");
    expect(next["strat_b|4h"]?.name).toBe("donchian");
  });

  it("returns the previous map unchanged for an invalid message", () => {
    const prev: Readonly<Record<string, IndicatorEntry>> = {
      "strat_a|1h": {
        name: "donchian",
        strategy: "strat_a",
        timeframe: "1h",
        series: {},
        ts: 100,
      },
    };
    const next = mergeIndicatorsByKey(prev, { type: "tick" });
    expect(next).toBe(prev); // identity check — same ref returned
  });

  it("returns the previous map unchanged for a non-object message", () => {
    const prev: Readonly<Record<string, IndicatorEntry>> = {};
    const next = mergeIndicatorsByKey(prev, "not an object");
    expect(next).toBe(prev);
    const next2 = mergeIndicatorsByKey(prev, null);
    expect(next2).toBe(prev);
  });

  it("does not mutate the input map (pure function)", () => {
    const prev: Readonly<Record<string, IndicatorEntry>> = {};
    const msg = makeValidMessage("strat_a", "1h");
    const before = JSON.stringify(prev);
    const next = mergeIndicatorsByKey(prev, msg);
    expect(JSON.stringify(prev)).toBe(before);
    // The returned object is a fresh object (not the same ref).
    expect(next).not.toBe(prev);
  });
});
