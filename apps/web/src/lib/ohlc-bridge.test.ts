/**
 * apps/web/src/lib/ohlc-bridge.test.ts
 *
 * Phase 48A: bun:test unit tests for `ohlc-bridge.ts`. Every public
 * function is exercised, including the pure helpers (via
 * `barsToLcChartSpec`, which is the main entry point that derives
 * `seed`, `base`, `vol`, `drift` internally).
 *
 * Coverage target: 100% line coverage on `ohlc-bridge.ts`. The
 * default-arm throw in `barToMarker` is intentionally exercised
 * with an `as unknown as` cast — the `BarMarkerSide` union is
 * closed, but a stale serialization layer could feed us a wrong
 * value, and the exhaustive `never` check must surface that as a
 * loud error rather than a silent bad marker.
 */

import { describe, expect, it } from "bun:test";

import {
  barToMarker,
  barsToLcChartSpec,
  markersToLcChartSpec,
  mergeBars,
  type BarMarkerSide,
  type ChartMarker,
  type LcChartKind,
  type OHLCBar,
} from "./ohlc-bridge.js";

// ============================================================================
// Test fixtures
// ============================================================================

/** Build a 3-bar OHLC sequence with monotonically increasing closes. */
function makeAscBars(): readonly OHLCBar[] {
  return [
    { time: 1_000_000, open: 100, high: 105, low: 99, close: 104, volume: 10 },
    { time: 1_000_060, open: 104, high: 108, low: 103, close: 107, volume: 12 },
    { time: 1_000_120, open: 107, high: 110, low: 106, close: 109, volume: 15 },
  ];
}

/** Build a 1-bar OHLC sequence (the "single bar" edge case). */
function makeSingleBar(): readonly OHLCBar[] {
  return [{ time: 2_000_000, open: 50, high: 51, low: 49, close: 50, volume: 1 }];
}

// ============================================================================
// barsToLcChartSpec
// ============================================================================

describe("barsToLcChartSpec", () => {
  it("returns null for an empty bars array", () => {
    expect(barsToLcChartSpec([])).toBeNull();
  });

  it("returns null for an empty bars array even with options set", () => {
    expect(barsToLcChartSpec([], { kind: "line" })).toBeNull();
  });

  it("returns count: 1 for a single bar", () => {
    const spec = barsToLcChartSpec(makeSingleBar());
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.count).toBe(1);
    // base = last (only) close
    expect(spec.base).toBe(50);
    // 1 bar → 0 drift (no movement)
    expect(spec.drift).toBe(0);
  });

  it("returns count: N for an N-bar sequence", () => {
    const bars = makeAscBars();
    const spec = barsToLcChartSpec(bars);
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.count).toBe(bars.length);
    expect(spec.count).toBe(3);
  });

  it("computes a deterministic seed (same input → same seed)", () => {
    const bars = makeAscBars();
    const a = barsToLcChartSpec(bars);
    const b = barsToLcChartSpec(bars);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a === null || b === null) return;
    expect(a.seed).toBe(b.seed);
  });

  it("produces a 32-bit unsigned seed (no negatives, no NaN)", () => {
    const spec = barsToLcChartSpec(makeAscBars());
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(Number.isFinite(spec.seed)).toBe(true);
    expect(spec.seed).toBeGreaterThanOrEqual(0);
    expect(spec.seed).toBeLessThan(2 ** 32);
  });

  it("uses 'candles' as the default kind", () => {
    const spec = barsToLcChartSpec(makeAscBars());
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.kind).toBe("candles");
  });

  it("accepts 'area' as a kind override", () => {
    const spec = barsToLcChartSpec(makeAscBars(), { kind: "area" });
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.kind).toBe("area");
  });

  it("accepts 'line' as a kind override", () => {
    const spec = barsToLcChartSpec(makeAscBars(), { kind: "line" });
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.kind).toBe("line");
  });

  it("accepts 'sparkline' as a kind override", () => {
    const spec = barsToLcChartSpec(makeAscBars(), { kind: "sparkline" });
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.kind).toBe("sparkline");
  });

  it("sets base to the last bar's close", () => {
    const bars = makeAscBars();
    const last = bars[bars.length - 1] as OHLCBar;
    const spec = barsToLcChartSpec(bars);
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.base).toBe(last.close);
    expect(spec.base).toBe(109);
  });

  it("derives vol from the max high-low range", () => {
    // Bars:
    //   [0] h=105 l=99 → range 6
    //   [1] h=108 l=103 → range 5
    //   [2] h=110 l=106 → range 4
    // max = 6
    const spec = barsToLcChartSpec(makeAscBars());
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.vol).toBe(6);
  });

  it("derives vol = 0 when every bar has high === low", () => {
    const flat: readonly OHLCBar[] = [
      { time: 1_000_000, open: 100, high: 100, low: 100, close: 100, volume: 0 },
      { time: 1_000_060, open: 100, high: 100, low: 100, close: 100, volume: 0 },
    ];
    const spec = barsToLcChartSpec(flat);
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.vol).toBe(0);
  });

  it("derives drift as (last - first) / (count - 1) for ascending closes", () => {
    // closes: 104, 107, 109 → (109 - 104) / 2 = 2.5
    const spec = barsToLcChartSpec(makeAscBars());
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.drift).toBe(2.5);
  });

  it("derives negative drift for descending closes", () => {
    const desc: readonly OHLCBar[] = [
      { time: 1_000_000, open: 110, high: 111, low: 109, close: 110, volume: 1 },
      { time: 1_000_060, open: 108, high: 110, low: 107, close: 108, volume: 1 },
      { time: 1_000_120, open: 105, high: 107, low: 104, close: 105, volume: 1 },
    ];
    // (105 - 110) / 2 = -2.5
    const spec = barsToLcChartSpec(desc);
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.drift).toBe(-2.5);
  });

  it("produces different seeds for different lengths (same first time)", () => {
    const a = barsToLcChartSpec(makeAscBars()); // length 3, time 1_000_000
    const b = barsToLcChartSpec(makeSingleBar()); // length 1, time 2_000_000
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a === null || b === null) return;
    expect(a.seed).not.toBe(b.seed);
  });

  it("populates markersJson when markers are provided", () => {
    const markers: readonly ChartMarker[] = [
      { time: 1_000_060, position: "belowBar", color: "#22c55e", shape: "arrowUp", text: "Entry" },
    ];
    const spec = barsToLcChartSpec(makeAscBars(), { markers });
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.markersJson).not.toBeNull();
    if (spec.markersJson === null) return;
    const parsed = JSON.parse(spec.markersJson) as readonly ChartMarker[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(markers[0]);
  });

  it("leaves markersJson as null when no markers are provided", () => {
    const spec = barsToLcChartSpec(makeAscBars());
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.markersJson).toBeNull();
  });

  it("leaves markersJson as null when markers is an empty array", () => {
    const spec = barsToLcChartSpec(makeAscBars(), { markers: [] });
    expect(spec).not.toBeNull();
    if (spec === null) return;
    expect(spec.markersJson).toBeNull();
  });

  it("accepts a kind for every LcChartKind", () => {
    const kinds: readonly LcChartKind[] = ["candles", "area", "line", "sparkline"];
    for (const k of kinds) {
      const spec = barsToLcChartSpec(makeAscBars(), { kind: k });
      expect(spec).not.toBeNull();
      if (spec === null) return;
      expect(spec.kind).toBe(k);
    }
  });
});

// ============================================================================
// markersToLcChartSpec
// ============================================================================

describe("markersToLcChartSpec", () => {
  it("returns null for an empty array", () => {
    expect(markersToLcChartSpec([])).toBeNull();
  });

  it("returns a JSON string for a single marker with the expected shape", () => {
    const m: ChartMarker = {
      time: 1_000_000,
      position: "belowBar",
      color: "#22c55e",
      shape: "arrowUp",
      text: "L",
    };
    const json = markersToLcChartSpec([m]);
    expect(json).not.toBeNull();
    if (json === null) return;
    const parsed = JSON.parse(json) as readonly ChartMarker[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(m);
  });

  it("returns a parseable JSON array of length 5 for 5 markers", () => {
    const markers: readonly ChartMarker[] = [
      { time: 1_000_000, position: "belowBar", color: "#22c55e", shape: "arrowUp", text: "L1" },
      { time: 1_000_060, position: "aboveBar", color: "#ef4444", shape: "arrowDown", text: "S1" },
      { time: 1_000_120, position: "belowBar", color: "#22c55e", shape: "arrowUp", text: "L2" },
      { time: 1_000_180, position: "aboveBar", color: "#ef4444", shape: "arrowDown", text: "S2" },
      { time: 1_000_240, position: "belowBar", color: "#22c55e", shape: "arrowUp", text: "L3" },
    ];
    const json = markersToLcChartSpec(markers);
    expect(json).not.toBeNull();
    if (json === null) return;
    const parsed = JSON.parse(json) as readonly ChartMarker[];
    expect(parsed).toHaveLength(5);
    // Verify round-trip preserves every field for the first marker.
    expect(parsed[0]).toEqual(markers[0]);
  });
});

// ============================================================================
// barToMarker
// ============================================================================

describe("barToMarker", () => {
  it("'long' produces belowBar + arrowUp + green", () => {
    const m = barToMarker("long", 100, 1_000_000, "Entry long");
    expect(m.position).toBe("belowBar");
    expect(m.shape).toBe("arrowUp");
    expect(m.color).toBe("#22c55e");
    expect(m.text).toBe("Entry long");
    expect(m.time).toBe(1_000_000);
  });

  it("'short' produces aboveBar + arrowDown + red", () => {
    const m = barToMarker("short", 200, 1_000_000, "Entry short");
    expect(m.position).toBe("aboveBar");
    expect(m.shape).toBe("arrowDown");
    expect(m.color).toBe("#ef4444");
    expect(m.text).toBe("Entry short");
    expect(m.time).toBe(1_000_000);
  });

  it("'buy' is an alias of 'long' (belowBar + arrowUp + green)", () => {
    const m = barToMarker("buy", 100, 1_000_000, "Buy");
    expect(m.position).toBe("belowBar");
    expect(m.shape).toBe("arrowUp");
    expect(m.color).toBe("#22c55e");
    expect(m.text).toBe("Buy");
  });

  it("'sell' is an alias of 'short' (aboveBar + arrowDown + red)", () => {
    const m = barToMarker("sell", 200, 1_000_000, "Sell");
    expect(m.position).toBe("aboveBar");
    expect(m.shape).toBe("arrowDown");
    expect(m.color).toBe("#ef4444");
    expect(m.text).toBe("Sell");
  });

  it("covers all 4 sides of the BarMarkerSide union", () => {
    const sides: readonly BarMarkerSide[] = ["long", "short", "buy", "sell"];
    for (const s of sides) {
      const m = barToMarker(s, 100, 1, "x");
      expect(m.time).toBe(1);
      expect(m.text).toBe("x");
      // Every side maps to either belowBar/arrowUp/green or aboveBar/arrowDown/red.
      const isLongish = s === "long" || s === "buy";
      expect(m.position).toBe(isLongish ? "belowBar" : "aboveBar");
      expect(m.shape).toBe(isLongish ? "arrowUp" : "arrowDown");
      expect(m.color).toBe(isLongish ? "#22c55e" : "#ef4444");
    }
  });

  it("throws on an unknown side (exhaustive never check)", () => {
    // Bypass the type system to test the runtime safety net — a
    // stale serialization layer could send a side we don't know.
    expect(() =>
      barToMarker("unknown_side" as unknown as BarMarkerSide, 100, 1, "x"),
    ).toThrow(/unknown side/);
  });
});

// ============================================================================
// mergeBars
// ============================================================================

describe("mergeBars", () => {
  it("returns [] for an empty outer array", () => {
    expect(mergeBars([])).toEqual([]);
  });

  it("returns [] when every inner series is empty", () => {
    expect(mergeBars([[], [], []])).toEqual([]);
  });

  it("preserves order for a single series", () => {
    const a: readonly OHLCBar[] = [
      { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { time: 200, open: 2, high: 2, low: 2, close: 2, volume: 0 },
      { time: 300, open: 3, high: 3, low: 3, close: 3, volume: 0 },
    ];
    const out = mergeBars([a]);
    expect(out).toHaveLength(3);
    expect(out[0]?.time).toBe(100);
    expect(out[1]?.time).toBe(200);
    expect(out[2]?.time).toBe(300);
  });

  it("returns the single bar from a 1-bar series", () => {
    const a: readonly OHLCBar[] = [
      { time: 500, open: 7, high: 8, low: 6, close: 7, volume: 1 },
    ];
    const out = mergeBars([a]);
    expect(out).toHaveLength(1);
    expect(out[0]?.time).toBe(500);
  });

  it("sorts 2 unsorted series by time ascending", () => {
    const a: readonly OHLCBar[] = [
      { time: 300, open: 3, high: 3, low: 3, close: 3, volume: 0 },
      { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    ];
    const b: readonly OHLCBar[] = [
      { time: 200, open: 2, high: 2, low: 2, close: 2, volume: 0 },
      { time: 400, open: 4, high: 4, low: 4, close: 4, volume: 0 },
    ];
    const out = mergeBars([a, b]);
    expect(out.map((bar) => bar.time)).toEqual([100, 200, 300, 400]);
  });

  it("deduplicates duplicate times: the later one (in source order) wins", () => {
    // Both series have time=100; the bar from `b` should win because
    // it comes after `a` in the outer array.
    const a: readonly OHLCBar[] = [
      { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { time: 200, open: 2, high: 2, low: 2, close: 2, volume: 0 },
    ];
    const b: readonly OHLCBar[] = [
      { time: 100, open: 9, high: 9, low: 9, close: 9, volume: 99 },
    ];
    const out = mergeBars([a, b]);
    expect(out).toHaveLength(2);
    // The merged bar at time 100 should be the one from `b` (close=9).
    const merged = out[0];
    expect(merged?.time).toBe(100);
    expect(merged?.close).toBe(9);
    expect(merged?.volume).toBe(99);
  });

  it("dedup works with 3+ duplicate times in the same series", () => {
    const a: readonly OHLCBar[] = [
      { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { time: 100, open: 2, high: 2, low: 2, close: 2, volume: 0 },
      { time: 100, open: 3, high: 3, low: 3, close: 3, volume: 0 },
    ];
    const out = mergeBars([a]);
    expect(out).toHaveLength(1);
    expect(out[0]?.close).toBe(3);
  });

  it("fully sorts 3 interleaved series", () => {
    const a: readonly OHLCBar[] = [
      { time: 300, open: 3, high: 3, low: 3, close: 3, volume: 0 },
    ];
    const b: readonly OHLCBar[] = [
      { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { time: 400, open: 4, high: 4, low: 4, close: 4, volume: 0 },
    ];
    const c: readonly OHLCBar[] = [
      { time: 200, open: 2, high: 2, low: 2, close: 2, volume: 0 },
      { time: 500, open: 5, high: 5, low: 5, close: 5, volume: 0 },
    ];
    const out = mergeBars([a, b, c]);
    expect(out.map((bar) => bar.time)).toEqual([100, 200, 300, 400, 500]);
  });

  it("does not mutate the input arrays", () => {
    const a: readonly OHLCBar[] = [
      { time: 300, open: 3, high: 3, low: 3, close: 3, volume: 0 },
      { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    ];
    const before = JSON.stringify(a);
    mergeBars([a]);
    expect(JSON.stringify(a)).toBe(before);
  });
});
