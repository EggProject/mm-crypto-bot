/**
 * apps/web/src/lib/__tests__/bars-from-bar.test.ts
 *
 * Phase 83.5 (Bug 1 — OHLCV not refreshing): unit tests for the
 * `appendOrReplaceBar` helper that drives the `useEffect([lastBar])`
 * bar-append logic in `App.tsx`.
 *
 * The helper is PURE (no React, no DOM, no I/O) and is exercised
 * here across all 5 branches:
 *   1. `lastBar` is null (defensive no-op)
 *   2. `lastBar` is not a well-formed object (defensive no-op)
 *   3. `barsByKey` has no entry for the key → no-op (the bar is
 *      dropped; next SNAPSHOT will re-seed)
 *   4. Same `time` as the last bar → REPLACE the last bar in place
 *   5. STRICTLY greater `time` → APPEND
 *   6. STRICTLY lesser `time` (out-of-order) → no-op (stale; next
 *      SNAPSHOT will reconcile)
 *
 * Branch coverage intent mirrors `markers-from-trades.test.ts`.
 */

import { describe, expect, it } from "bun:test";

import { appendOrReplaceBar } from "../bars-from-bar.js";
import type { OHLCBar } from "../ohlc-bridge.js";

// =============================================================================
// Test fixtures
// =============================================================================

const KEY = "BTC/USDC|1h";

/** A 3-bar bootstrap, time-ascending. */
const BOOTSTRAP_3_BARS: Readonly<Record<string, readonly OHLCBar[]>> = {
  [KEY]: [
    { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    { time: 2000, open: 105, high: 115, low: 95, close: 110, volume: 2 },
    { time: 3000, open: 110, high: 120, low: 100, close: 115, volume: 3 },
  ],
};

/** A 1-bar bootstrap for the "missing key" branch. */
const BOOTSTRAP_1_BAR: Readonly<Record<string, readonly OHLCBar[]>> = {
  [KEY]: [
    { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
  ],
};

// =============================================================================
// appendOrReplaceBar
// =============================================================================

describe("appendOrReplaceBar", () => {
  it("returns noop when lastBar is null", () => {
    const result = appendOrReplaceBar(BOOTSTRAP_3_BARS, null);
    expect(result.kind).toBe("noop");
    expect(result.next).toBe(BOOTSTRAP_3_BARS);
  });

  it("returns noop when lastBar is a primitive (defensive)", () => {
    const result1 = appendOrReplaceBar(BOOTSTRAP_3_BARS, "bar");
    const result2 = appendOrReplaceBar(BOOTSTRAP_3_BARS, 42);
    const result3 = appendOrReplaceBar(BOOTSTRAP_3_BARS, true);
    expect(result1.kind).toBe("noop");
    expect(result2.kind).toBe("noop");
    expect(result3.kind).toBe("noop");
  });

  it("returns noop when lastBar is missing required string fields (symbol/timeframe)", () => {
    const r1 = appendOrReplaceBar(BOOTSTRAP_3_BARS, { timeframe: "1h", ohlc: { time: 4000, open: 1, high: 2, low: 0, close: 1, volume: 1 } });
    const r2 = appendOrReplaceBar(BOOTSTRAP_3_BARS, { symbol: "BTC/USDC", ohlc: { time: 4000, open: 1, high: 2, low: 0, close: 1, volume: 1 } });
    expect(r1.kind).toBe("noop");
    expect(r2.kind).toBe("noop");
  });

  it("returns noop when ohlc is missing or non-object", () => {
    const r1 = appendOrReplaceBar(BOOTSTRAP_3_BARS, { symbol: "BTC/USDC", timeframe: "1h", ohlc: null });
    const r2 = appendOrReplaceBar(BOOTSTRAP_3_BARS, { symbol: "BTC/USDC", timeframe: "1h" });
    expect(r1.kind).toBe("noop");
    expect(r2.kind).toBe("noop");
  });

  it("returns noop when ohlc has non-finite numeric fields", () => {
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: NaN, open: 1, high: 2, low: 0, close: 1, volume: 1 },
    });
    expect(r.kind).toBe("noop");
  });

  it("returns noop when the (symbol, timeframe) key is not in barsByKey (bar arrived before snapshot)", () => {
    const r = appendOrReplaceBar({}, {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    });
    expect(r.kind).toBe("noop");
    expect(r.next).toEqual({});
  });

  it("returns noop when the (symbol, timeframe) key has an empty bar array", () => {
    const r = appendOrReplaceBar({ [KEY]: [] }, {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    });
    expect(r.kind).toBe("noop");
  });

  it("appends a new bar when its time is strictly greater than the last bar's time", () => {
    const newBar = {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 4000, open: 115, high: 125, low: 105, close: 120, volume: 4 },
    };
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, newBar);
    expect(r.kind).toBe("append");
    // eslint-disable-next-line security/detect-object-injection
    const next = r.next[KEY];
    expect(next).toHaveLength(4);
    expect(next?.[3]).toEqual({
      time: 4000,
      open: 115,
      high: 125,
      low: 105,
      close: 120,
      volume: 4,
    });
    // The previous bars are preserved.
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[0]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[0]);
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[1]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[1]);
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[2]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[2]);
  });

  it("replaces the last bar in place when the new bar shares the same time (live OHLCV update)", () => {
    const updatedBar = {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 3000, open: 200, high: 210, low: 190, close: 205, volume: 99 },
    };
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, updatedBar);
    expect(r.kind).toBe("replace");
    // eslint-disable-next-line security/detect-object-injection
    const next = r.next[KEY];
    // The length MUST stay at 3 (no new bar appended; the same-time bar
    // is an in-place OHLCV update for the in-progress bar).
    expect(next).toHaveLength(3);
    expect(next?.[2]).toEqual({
      time: 3000,
      open: 200,
      high: 210,
      low: 190,
      close: 205,
      volume: 99,
    });
    // The previous bars are unchanged.
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[0]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[0]);
    // eslint-disable-next-line security/detect-object-injection
    expect(next?.[1]).toEqual(BOOTSTRAP_3_BARS[KEY]?.[1]);
  });

  it("returns noop for an out-of-order bar (time LESS than the last bar — stale WS delivery)", () => {
    const staleBar = {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 2000, open: 99, high: 99, low: 99, close: 99, volume: 0 },
    };
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, staleBar);
    expect(r.kind).toBe("noop");
    // The previous barsByKey is returned unchanged (reference identity).
    expect(r.next).toBe(BOOTSTRAP_3_BARS);
  });

  it("preserves reference inequality between input and output (React setState identity gate)", () => {
    // The "append" branch produces a new barsByKey object (immutable
    // update) so React's `setBarsByKey` triggers a re-render.
    const r = appendOrReplaceBar(BOOTSTRAP_3_BARS, {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 4000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    });
    expect(r.next).not.toBe(BOOTSTRAP_3_BARS);
    // The replaced key is a new array (not the same reference).
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY]).not.toBe(BOOTSTRAP_3_BARS[KEY]);
  });

  it("handles a 1-bar bootstrap (the first live bar should append or replace without crashing)", () => {
    const sameTimeBar = {
      symbol: "BTC/USDC",
      timeframe: "1h",
      ohlc: { time: 1000, open: 200, high: 210, low: 190, close: 205, volume: 99 },
    };
    const r = appendOrReplaceBar(BOOTSTRAP_1_BAR, sameTimeBar);
    expect(r.kind).toBe("replace");
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY]).toHaveLength(1);
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY]?.[0]?.close).toBe(205);
  });
});

// =============================================================================
// Phase 83.6.1 — mergeSnapshotBars
// =============================================================================
//
// Unit tests for the `mergeSnapshotBars` helper that drives the
// `useEffect([snapshot])` MERGE logic in `App.tsx`. The previous
// (Phase 83.5) effect REPLACED the entire `barsByKey` map on every
// snapshot message; the publisher's `ohlcBootstrap` is replayed on
// every periodic refresh (every ~1-2s), so the REPLACE clobbered
// any tick / bar updates applied between snapshots.
//
// The merge helper is a per-key "only add NEWER bars" operation.
// Branches (in order of evaluation):
//   1. Snapshot is null / undefined / primitive / missing
//      `ohlcBootstrap` → no-op (return prev unchanged).
//   2. Per-key:
//      a. Key missing in prev → add all bars from snapshot
//         (new-subscription case).
//      b. Key exists in prev with empty array → add all bars
//         (defensive empty-existing case).
//      c. Key exists in prev with non-empty array → find the
//         first bar in `newBars` whose `time` is STRICTLY greater
//         than `prev[last].time`; if no such bar exists (the
//         common replay case), no-op for this key; otherwise
//         APPEND the strictly-newer tail.
//   3. Keys that exist in prev but are NOT in the snapshot are
//      preserved unchanged (additive merge).
//
// The all-no-op case (the Phase 83.6.1 bug scenario — the snapshot
// replays the same `ohlcBootstrap` and the merge sees no newer
// bars) MUST return the same `barsByKey` reference so React's
// `setBarsByKey` doesn't trigger a re-render.

import { mergeSnapshotBars } from "../bars-from-bar.js";

/**
 * `barsOf(map, key)` — return the bar list for the given key, or
 * `[]` if the key is missing. Wraps the
 * `security/detect-object-injection` eslint false-positive on
 * `map[key]` access (the `key` is a chart key string from
 * `chartKeyToString`, not user input).
 */
function barsOf(
  map: Readonly<Record<string, readonly OHLCBar[]>>,
  key: string,
): readonly OHLCBar[] {
  // eslint-disable-next-line security/detect-object-injection
  return map[key] ?? [];
}

const KEY_A = "BTC/USDC|1h" as const;
const KEY_B = "ETH/USDC|1h" as const;

/** A 5-bar bootstrap for KEY_A, time-ascending. */
const BOOTSTRAP_A_5: Readonly<Record<string, readonly OHLCBar[]>> = {
  [KEY_A]: [
    { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    { time: 2000, open: 105, high: 115, low: 95, close: 110, volume: 2 },
    { time: 3000, open: 110, high: 120, low: 100, close: 115, volume: 3 },
    { time: 4000, open: 115, high: 125, low: 105, close: 120, volume: 4 },
    { time: 5000, open: 120, high: 130, low: 110, close: 125, volume: 5 },
  ],
};

/** A 3-bar bootstrap for KEY_B (a different key — multi-key tests). */
const BOOTSTRAP_B_3: Readonly<Record<string, readonly OHLCBar[]>> = {
  [KEY_B]: [
    { time: 1000, open: 10, high: 11, low: 9, close: 10.5, volume: 1 },
    { time: 2000, open: 10.5, high: 11.5, low: 9.5, close: 11, volume: 2 },
    { time: 3000, open: 11, high: 12, low: 10, close: 11.5, volume: 3 },
  ],
};

describe("mergeSnapshotBars", () => {
  // ---------------------------------------------------------------------------
  // Branch 1: defensive no-op cases
  // ---------------------------------------------------------------------------

  it("returns the prev reference unchanged for a null snapshot", () => {
    const r = mergeSnapshotBars(BOOTSTRAP_A_5, null);
    expect(r.kind).toBe("noop");
    expect(r.next).toBe(BOOTSTRAP_A_5);
    expect(r.newKeys).toBe(0);
    expect(r.appendedBars).toBe(0);
  });

  it("returns the prev reference unchanged for an undefined snapshot", () => {
    const r = mergeSnapshotBars(BOOTSTRAP_A_5, undefined);
    expect(r.kind).toBe("noop");
    expect(r.next).toBe(BOOTSTRAP_A_5);
  });

  it("returns the prev reference unchanged for a primitive snapshot", () => {
    const r1 = mergeSnapshotBars(BOOTSTRAP_A_5, "snapshot");
    const r2 = mergeSnapshotBars(BOOTSTRAP_A_5, 42);
    const r3 = mergeSnapshotBars(BOOTSTRAP_A_5, true);
    expect(r1.next).toBe(BOOTSTRAP_A_5);
    expect(r2.next).toBe(BOOTSTRAP_A_5);
    expect(r3.next).toBe(BOOTSTRAP_A_5);
  });

  it("returns the prev reference unchanged for a snapshot missing ohlcBootstrap", () => {
    const r = mergeSnapshotBars(BOOTSTRAP_A_5, { type: "snapshot", ts: 1 });
    expect(r.kind).toBe("noop");
    expect(r.next).toBe(BOOTSTRAP_A_5);
  });

  it("returns the prev reference unchanged for an empty ohlcBootstrap", () => {
    const r = mergeSnapshotBars(BOOTSTRAP_A_5, { ohlcBootstrap: {} });
    expect(r.kind).toBe("noop");
    expect(r.next).toBe(BOOTSTRAP_A_5);
  });

  it("returns the prev reference unchanged for a null ohlcBootstrap", () => {
    const r = mergeSnapshotBars(BOOTSTRAP_A_5, { ohlcBootstrap: null });
    expect(r.kind).toBe("noop");
    expect(r.next).toBe(BOOTSTRAP_A_5);
  });

  // ---------------------------------------------------------------------------
  // Branch 2a: empty prev + N bars in snapshot → prev = N bars
  // ---------------------------------------------------------------------------

  it("adds all snapshot bars when prev is empty (new subscription case)", () => {
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": {
          "1h": [
            { time: 1000, open: 1, high: 2, low: 0, close: 1, volume: 1 },
            { time: 2000, open: 1, high: 2, low: 0, close: 1, volume: 1 },
            { time: 3000, open: 1, high: 2, low: 0, close: 1, volume: 1 },
            { time: 4000, open: 1, high: 2, low: 0, close: 1, volume: 1 },
            { time: 5000, open: 1, high: 2, low: 0, close: 1, volume: 1 },
          ],
        },
      },
    };
    const r = mergeSnapshotBars({}, snapshot);
    expect(r.kind).toBe("merged");
    expect(r.newKeys).toBe(1);
    expect(r.appendedBars).toBe(5);
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY_A]).toHaveLength(5);
  });

  it("adds a new key when prev has a different key (mixed-key case)", () => {
    // prev has KEY_B; snapshot has KEY_A → KEY_A is added; KEY_B is preserved.
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": { "1h": [{ time: 1000, open: 1, high: 2, low: 0, close: 1, volume: 1 }] },
      },
    };
    const r = mergeSnapshotBars(BOOTSTRAP_B_3, snapshot);
    expect(r.kind).toBe("merged");
    expect(r.newKeys).toBe(1);
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY_A]).toHaveLength(1);
    // KEY_B preserved (additive merge).
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY_B]).toBe(BOOTSTRAP_B_3[KEY_B]);
  });

  it("adds all snapshot bars when prev has an empty array for the key", () => {
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": {
          "1h": [
            { time: 1000, open: 1, high: 2, low: 0, close: 1, volume: 1 },
            { time: 2000, open: 1, high: 2, low: 0, close: 1, volume: 1 },
          ],
        },
      },
    };
    const r = mergeSnapshotBars({ [KEY_A]: [] }, snapshot);
    expect(r.kind).toBe("merged");
    // eslint-disable-next-line security/detect-object-injection
    expect(r.next[KEY_A]).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Branch 2b: prev has 3 bars, snapshot has 5 bars (all newer) → prev = 5 bars
  // (the snapshot's 5 — prev is REPLACED, not APPENDED)
  // ---------------------------------------------------------------------------

  it("replaces prev with the snapshot bars when ALL snapshot bars are newer", () => {
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": {
          "1h": [
            { time: 6000, open: 130, high: 140, low: 120, close: 135, volume: 6 },
            { time: 7000, open: 135, high: 145, low: 125, close: 140, volume: 7 },
            { time: 8000, open: 140, high: 150, low: 130, close: 145, volume: 8 },
            { time: 9000, open: 145, high: 155, low: 135, close: 150, volume: 9 },
            { time: 10000, open: 150, high: 160, low: 140, close: 155, volume: 10 },
          ],
        },
      },
    };
    // prev has 3 bars; snapshot's 5 bars are all newer than prev's last (time=3000).
    const prev3: Readonly<Record<string, readonly OHLCBar[]>> = {
      [KEY_A]: [
        { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 2000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 3000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      ],
    };
    const r = mergeSnapshotBars(prev3, snapshot);
    expect(r.kind).toBe("merged");
    // All 5 snapshot bars are appended; the existing 3 are preserved.
    expect(barsOf(r.next, KEY_A)).toHaveLength(8);
    expect(r.appendedBars).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // Branch 2c: prev has 5 bars, snapshot has 3 bars (all OLDER) → prev unchanged
  // (this is the Phase 83.6.1 BUG case — the snapshot replays the original
  // bootstrap, all of whose bars are at or before prev's last bar)
  // ---------------------------------------------------------------------------

  it("returns the prev reference unchanged when ALL snapshot bars are at or before the last prev bar (replay case — the Phase 83.6.1 bug)", () => {
    // The snapshot is the same 5-bar bootstrap that prev already has.
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": { "1h": [...barsOf(BOOTSTRAP_A_5, KEY_A)] },
      },
    };
    // Pretend prev was mutated by tick updates (the last bar's close is
    // different from the snapshot's last bar's close — this is the
    // symptom of the bug: the tick update would be wiped on snapshot
    // replay unless the merge preserves prev).
    const prevWithTickUpdate: Readonly<Record<string, readonly OHLCBar[]>> = {
      [KEY_A]: [
        ...barsOf(BOOTSTRAP_A_5, KEY_A).slice(0, 4),
        { time: 5000, open: 120, high: 130, low: 110, close: 999, volume: 5 }, // tick-updated close
      ],
    };
    const r = mergeSnapshotBars(prevWithTickUpdate, snapshot);
    // The snapshot's 5 bars are at times 1000-5000; prev's last bar is
    // at time 5000. No bar in the snapshot is STRICTLY newer than
    // 5000 → all no-op → prev reference returned.
    expect(r.kind).toBe("noop");
    expect(r.next).toBe(prevWithTickUpdate);
    // The tick update is preserved.
    expect(barsOf(r.next, KEY_A)[4]?.close).toBe(999);
  });

  it("returns the prev reference unchanged when ALL snapshot bars are STRICTLY older than the last prev bar (delayed replay)", () => {
    // prev has 5 bars (times 1000-5000); snapshot's bars are all from
    // times 1000-3000 (stale replay, e.g. an old replay of a partial
    // bootstrap).
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": {
          "1h": [
            { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
            { time: 2000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
            { time: 3000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
          ],
        },
      },
    };
    const r = mergeSnapshotBars(BOOTSTRAP_A_5, snapshot);
    // All 3 snapshot bars are at or before prev's last (time=5000).
    expect(r.kind).toBe("noop");
    expect(r.next).toBe(BOOTSTRAP_A_5);
  });

  // ---------------------------------------------------------------------------
  // Branch 2d: prev has 5 bars, snapshot has 7 bars (2 newer, 5 same) →
  // prev = 7 bars (5 prev + 2 newer from snapshot)
  // ---------------------------------------------------------------------------

  it("appends only the STRICTLY-NEWER tail when snapshot has a mix of old and new bars", () => {
    // prev has 5 bars (times 1000-5000). The snapshot has 7 bars: the
    // first 5 are the same as prev (overlap), the last 2 are newer.
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": {
          "1h": [
            ...barsOf(BOOTSTRAP_A_5, KEY_A),
            { time: 6000, open: 130, high: 140, low: 120, close: 135, volume: 6 },
            { time: 7000, open: 135, high: 145, low: 125, close: 140, volume: 7 },
          ],
        },
      },
    };
    const r = mergeSnapshotBars(BOOTSTRAP_A_5, snapshot);
    expect(r.kind).toBe("merged");
    // 5 prev + 2 newer = 7 bars total.
    expect(barsOf(r.next, KEY_A)).toHaveLength(7);
    expect(r.appendedBars).toBe(2);
    expect(barsOf(r.next, KEY_A)[5]).toEqual({
      time: 6000,
      open: 130,
      high: 140,
      low: 120,
      close: 135,
      volume: 6,
    });
    expect(barsOf(r.next, KEY_A)[6]).toEqual({
      time: 7000,
      open: 135,
      high: 145,
      low: 125,
      close: 140,
      volume: 7,
    });
  });

  // ---------------------------------------------------------------------------
  // Branch 2e: mixed keys — some new, some same, some with newer bars
  // ---------------------------------------------------------------------------

  it("merges per-key independently (some keys new, some unchanged, some with newer bars)", () => {
    const snapshot = {
      ohlcBootstrap: {
        // KEY_A: same as prev (5 bars at times 1000-5000) — no-op
        "BTC/USDC": { "1h": [...barsOf(BOOTSTRAP_A_5, KEY_A)] },
        // KEY_B: 2 newer bars than prev's last (time=3000) — append
        "ETH/USDC": {
          "1h": [
            ...barsOf(BOOTSTRAP_B_3, KEY_B),
            { time: 4000, open: 12, high: 13, low: 11, close: 12.5, volume: 4 },
            { time: 5000, open: 12.5, high: 13.5, low: 11.5, close: 13, volume: 5 },
          ],
        },
        // KEY_C: brand new key (not in prev) — add
        SOL: { "1h": [{ time: 1000, open: 5, high: 6, low: 4, close: 5.5, volume: 1 }] },
      },
    };
    const prev = {
      ...BOOTSTRAP_A_5,
      ...BOOTSTRAP_B_3,
    };
    const r = mergeSnapshotBars(prev, snapshot);
    expect(r.kind).toBe("merged");
    // KEY_A: same → unchanged (preserved by reference)
    expect(barsOf(r.next, KEY_A)).toBe(barsOf(BOOTSTRAP_A_5, KEY_A));
    // KEY_B: 2 newer bars appended (5 total)
    expect(barsOf(r.next, KEY_B)).toHaveLength(5);
    expect(barsOf(r.next, KEY_B)[3]?.time).toBe(4000);
    expect(barsOf(r.next, KEY_B)[4]?.time).toBe(5000);
    // KEY_C: brand new key — added
    expect(barsOf(r.next, "SOL|1h")).toHaveLength(1);
    // Counters
    expect(r.newKeys).toBe(1); // SOL|1h is the only new key
    expect(r.appendedBars).toBe(3); // 2 from KEY_B + 1 from SOL|1h
  });

  // ---------------------------------------------------------------------------
  // Branch 2f: prev has 1 bar (no prior bootstrap) and snapshot has 5 bars
  // — all 5 are "newer" than the 1 prev bar, so all 5 get appended.
  // ---------------------------------------------------------------------------

  it("appends all snapshot bars when prev has 1 bar and snapshot has 5 (all newer)", () => {
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": {
          "1h": [
            { time: 2000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
            { time: 3000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
            { time: 4000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
            { time: 5000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
            { time: 6000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
          ],
        },
      },
    };
    const prev: Readonly<Record<string, readonly OHLCBar[]>> = {
      [KEY_A]: [{ time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
    };
    const r = mergeSnapshotBars(prev, snapshot);
    expect(r.kind).toBe("merged");
    expect(barsOf(r.next, KEY_A)).toHaveLength(6);
    expect(r.appendedBars).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // React setState identity gate
  // ---------------------------------------------------------------------------

  it("returns a NEW barsByKey reference when at least one key was merged", () => {
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": {
          "1h": [
            ...barsOf(BOOTSTRAP_A_5, KEY_A),
            { time: 6000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
          ],
        },
      },
    };
    const r = mergeSnapshotBars(BOOTSTRAP_A_5, snapshot);
    expect(r.next).not.toBe(BOOTSTRAP_A_5);
  });

  it("returns the SAME barsByKey reference when every key was a no-op (replay case — the Phase 83.6.1 bug)", () => {
    // The same snapshot replayed twice should be a no-op the second time.
    const snapshot = {
      ohlcBootstrap: {
        "BTC/USDC": { "1h": [...barsOf(BOOTSTRAP_A_5, KEY_A)] },
      },
    };
    // First apply: prev is BOOTSTRAP_A_5; the snapshot is the same
    // 5 bars (all at or before prev's last). Should be all no-op.
    const r1 = mergeSnapshotBars(BOOTSTRAP_A_5, snapshot);
    expect(r1.next).toBe(BOOTSTRAP_A_5);
  });
});
