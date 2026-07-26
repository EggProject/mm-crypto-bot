/**
 * apps/web/src/indicators/daily-pivot.test.ts
 *
 * Phase 81: bun:test unit tests for the daily pivot (PP / R1 / S1)
 * indicator + the IndicatorRegistry integration.
 *
 * Coverage target: 100% line + branch coverage on
 *   - `daily-pivot.ts` (computeDailyPivot, validateDailyPivotSeries,
 *     renderDailyPivot, DAILY_PIVOT_INDICATOR_NAME, DAILY_PIVOT_COLORS)
 *
 * The math-correctness tests use a hand-computed example:
 *   - bars: [{high:12, low:10, close:11}, {high:14, low:12, close:13}]
 *   - bar 0: no previous bar → all null
 *   - bar 1: prevH=12, prevL=10, prevC=11
 *     pp = (12+10+11)/3 = 11
 *     r1 = 2*11 - 10 = 12
 *     s1 = 2*11 - 12 = 10
 */

import { describe, expect, it } from "bun:test";

import {
  DAILY_PIVOT_COLORS,
  DAILY_PIVOT_INDICATOR_NAME,
  DAILY_PIVOT_SERIES_KEYS,
  __testing,
  computeDailyPivot,
  renderDailyPivot,
  validateDailyPivotSeries,
} from "./daily-pivot.js";
import {
  IndicatorRegistry,
  type IndicatorContext,
  type IndicatorSeries,
} from "./registry.js";
import type { OHLCBar } from "../lib/ohlc-bridge.js";
import type { IChartApi } from "lightweight-charts";

// ============================================================================
// Test fixtures
// ============================================================================

/** Build a `count`-bar OHLC sequence at 1-minute spacing. */
function makeBars(count = 3): readonly OHLCBar[] {
  const out: OHLCBar[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      time: 1_700_000_000_000 + i * 60_000,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1,
    });
  }
  return out;
}

/**
 * Build a bar with the given H/L/C at index `i`. Defaults give
 * a unit envelope around the close.
 */
function makeBarWithHLC(
  high: number,
  low: number,
  close: number,
  i: number,
): OHLCBar {
  return {
    time: 1_700_000_000_000 + i * 60_000,
    open: close,
    high,
    low,
    close,
    volume: 1,
  };
}

/**
 * Build a valid daily-pivot series for `count` bars.
 * `valueOf(i)` lets each test customize the per-bar value.
 */
function makeDailyPivotSeries(
  count: number,
  valueOf: (i: number) => number | null = (i) => 100 + i,
): IndicatorSeries {
  const arr = (n: number): (number | null)[] => {
    const out: (number | null)[] = [];
    for (let i = 0; i < n; i += 1) out.push(valueOf(i));
    return out;
  };
  return {
    pp: arr(count),
    r1: arr(count),
    s1: arr(count),
  };
}

// ============================================================================
// Mock chart
// ============================================================================

interface MockCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

interface MockSeries {
  readonly id: number;
  readonly opts: unknown;
  setData: (data: readonly unknown[]) => void;
}

interface MockChart {
  readonly calls: MockCall[];
  readonly createdSeries: readonly MockSeries[];
  addSeries: (definition: unknown, opts: unknown) => MockSeries;
  removeSeries: (s: unknown) => void;
}

function makeMockChart(): MockChart {
  const calls: MockCall[] = [];
  const createdSeries: MockSeries[] = [];

  const makeSeries = (opts: unknown): MockSeries => {
    const id = createdSeries.length;
    const series: MockSeries = {
      id,
      opts,
      setData: (data: readonly unknown[]): void => {
        calls.push({ method: "setData", args: [id, opts, data] });
      },
    };
    createdSeries.push(series);
    return series;
  };

  return {
    calls,
    createdSeries,
    addSeries: (definition: unknown, opts: unknown): MockSeries => {
      calls.push({ method: "addSeries", args: [definition, opts] });
      return makeSeries(opts);
    },
    removeSeries: (s: unknown): void => {
      calls.push({ method: "removeSeries", args: [s] });
    },
  };
}

function captureConsoleWarn(): {
  readonly calls: string[];
  readonly restore: () => void;
} {
  const calls: string[] = [];
  const orig = console.warn;
  console.warn = ((msg: unknown, ...rest: readonly unknown[]): void => {
    if (rest.length === 0) {
      calls.push(String(msg));
    } else {
      calls.push(`${String(msg)} ${rest.map((r) => String(r)).join(" ")}`);
    }
  }) as typeof console.warn;
  return {
    calls,
    restore: (): void => {
      console.warn = orig;
    },
  };
}

function makeContext(
  chart: MockChart,
  bars: readonly OHLCBar[],
  series: IndicatorSeries,
): IndicatorContext {
  return {
    chart: chart as unknown as IChartApi,
    bars,
    indicatorSeries: series,
    color: "#000000",
    strategy: "donchian_pivot_composition",
    timeframe: "1h",
  };
}

// ============================================================================
// Public constants
// ============================================================================

describe("DAILY_PIVOT_INDICATOR_NAME", () => {
  it("is the literal 'daily_pivot' (the strategy-code contract)", () => {
    expect(DAILY_PIVOT_INDICATOR_NAME).toBe("daily_pivot");
  });
});

describe("DAILY_PIVOT_COLORS", () => {
  it("defines a color for every key in DAILY_PIVOT_SERIES_KEYS", () => {
    for (const key of DAILY_PIVOT_SERIES_KEYS) {
      // eslint-disable-next-line security/detect-object-injection -- key is a closed union from DAILY_PIVOT_SERIES_KEYS
      const color = (DAILY_PIVOT_COLORS as Record<string, string>)[key] ?? "";
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });

  it("uses muted slate for pp (the equilibrium)", () => {
    expect(DAILY_PIVOT_COLORS.pp).toBe("#5C6981");
  });

  it("uses green for r1 (the first resistance, above PP)", () => {
    expect(DAILY_PIVOT_COLORS.r1).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(DAILY_PIVOT_COLORS.r1).not.toBe(DAILY_PIVOT_COLORS.pp);
    expect(DAILY_PIVOT_COLORS.r1).not.toBe(DAILY_PIVOT_COLORS.s1);
  });

  it("uses red for s1 (the first support, below PP)", () => {
    expect(DAILY_PIVOT_COLORS.s1).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(DAILY_PIVOT_COLORS.s1).not.toBe(DAILY_PIVOT_COLORS.pp);
    expect(DAILY_PIVOT_COLORS.s1).not.toBe(DAILY_PIVOT_COLORS.r1);
  });

  it("all three colors are distinct hex strings", () => {
    expect(new Set(Object.values(DAILY_PIVOT_COLORS)).size).toBe(3);
  });
});

// ============================================================================
// computeDailyPivot
// ============================================================================

describe("computeDailyPivot", () => {
  it("returns all-null for an empty bar series", () => {
    const result = computeDailyPivot([]);
    expect(result.pp).toEqual([]);
    expect(result.r1).toEqual([]);
    expect(result.s1).toEqual([]);
  });

  it("returns all-null for a 1-bar series (no previous bar exists)", () => {
    const bars = makeBars(1);
    const result = computeDailyPivot(bars);
    expect(result.pp).toEqual([null]);
    expect(result.r1).toEqual([null]);
    expect(result.s1).toEqual([null]);
  });

  it("returns all-null at index 0 even for a long series (no previous bar at index 0)", () => {
    const bars = makeBars(5);
    const result = computeDailyPivot(bars);
    expect(result.pp[0]).toBeNull();
    expect(result.r1[0]).toBeNull();
    expect(result.s1[0]).toBeNull();
  });

  it("produces correct PP/R1/S1 for the hand-computed example", () => {
    // 2 bars: bar 0 = {H:12, L:10, C:11}, bar 1 = {H:14, L:12, C:13}.
    // Bar 0: no previous bar → null.
    // Bar 1: prevH=12, prevL=10, prevC=11.
    //   pp = (12+10+11)/3 = 11
    //   r1 = 2*11 - 10 = 12
    //   s1 = 2*11 - 12 = 10
    const bars: OHLCBar[] = [
      makeBarWithHLC(12, 10, 11, 0),
      makeBarWithHLC(14, 12, 13, 1),
    ];
    const result = computeDailyPivot(bars);
    // Bar 0: all null.
    expect(result.pp[0]).toBeNull();
    expect(result.r1[0]).toBeNull();
    expect(result.s1[0]).toBeNull();
    // Bar 1: hand-computed.
    expect(result.pp[1]).toBeCloseTo(11, 6);
    expect(result.r1[1]).toBeCloseTo(12, 6);
    expect(result.s1[1]).toBeCloseTo(10, 6);
  });

  it("uses the previous bar's H/L/C, not the current bar's", () => {
    // 3 bars: bar 0 = {H:12, L:10, C:11}, bar 1 = {H:14, L:12, C:13},
    //                  bar 2 = {H:20, L:5,  C:7}.
    // The pivot at bar 2 must use bar 1's H/L/C (not bar 2's).
    //   pp = (14+12+13)/3 = 13
    //   r1 = 2*13 - 12 = 14
    //   s1 = 2*13 - 14 = 12
    const bars: OHLCBar[] = [
      makeBarWithHLC(12, 10, 11, 0),
      makeBarWithHLC(14, 12, 13, 1),
      makeBarWithHLC(20, 5, 7, 2),
    ];
    const result = computeDailyPivot(bars);
    expect(result.pp[2]).toBeCloseTo(13, 6);
    expect(result.r1[2]).toBeCloseTo(14, 6);
    expect(result.s1[2]).toBeCloseTo(12, 6);
  });

  it("returns null for bar i when bar i-1's H is NaN", () => {
    // 3 bars: bar 1 has NaN high. Bar 2's pivot must use bar 1's
    // H/L/C → the NaN high poisons the pivot. We expect bar 2
    // to be null. (Bar 1 itself is fine because it uses bar 0's
    // H/L/C, which is clean.)
    const bars: OHLCBar[] = [
      makeBarWithHLC(10, 5, 8, 0),
      { ...makeBarWithHLC(Number.NaN, 5, 8, 1) },
      makeBarWithHLC(12, 6, 10, 2),
    ];
    const result = computeDailyPivot(bars);
    // Bar 1: prev (bar 0) is clean → pivot is defined.
    expect(result.pp[1]).toBeCloseTo((10 + 5 + 8) / 3, 6);
    // Bar 2: prev (bar 1) has NaN high → pivot is null.
    expect(result.pp[2]).toBeNull();
    expect(result.r1[2]).toBeNull();
    expect(result.s1[2]).toBeNull();
  });

  it("returns null for bar i when bar i-1's L is NaN", () => {
    const bars: OHLCBar[] = [
      makeBarWithHLC(10, 5, 8, 0),
      { ...makeBarWithHLC(10, Number.NaN, 8, 1) },
      makeBarWithHLC(12, 6, 10, 2),
    ];
    const result = computeDailyPivot(bars);
    expect(result.pp[2]).toBeNull();
  });

  it("returns null for bar i when bar i-1's C is NaN", () => {
    const bars: OHLCBar[] = [
      makeBarWithHLC(10, 5, 8, 0),
      { ...makeBarWithHLC(10, 5, Number.NaN, 1) },
      makeBarWithHLC(12, 6, 10, 2),
    ];
    const result = computeDailyPivot(bars);
    expect(result.pp[2]).toBeNull();
  });

  it("returns null for bar i when bar i-1's H is +Infinity", () => {
    const bars: OHLCBar[] = [
      makeBarWithHLC(10, 5, 8, 0),
      { ...makeBarWithHLC(Number.POSITIVE_INFINITY, 5, 8, 1) },
      makeBarWithHLC(12, 6, 10, 2),
    ];
    const result = computeDailyPivot(bars);
    expect(result.pp[2]).toBeNull();
  });

  it("recovers after a NaN: the next bar (with a clean previous) gets a fresh pivot", () => {
    // 4 bars: bar 0 clean, bar 1 has NaN H, bar 2 clean, bar 3 clean.
    // Bar 1: uses bar 0 (clean) → pivot defined.
    // Bar 2: uses bar 1 (NaN) → null.
    // Bar 3: uses bar 2 (clean) → pivot defined.
    const bars: OHLCBar[] = [
      makeBarWithHLC(10, 5, 8, 0),
      { ...makeBarWithHLC(Number.NaN, 5, 8, 1) },
      makeBarWithHLC(20, 10, 15, 2),
      makeBarWithHLC(30, 15, 20, 3),
    ];
    const result = computeDailyPivot(bars);
    expect(result.pp[1]).toBeCloseTo((10 + 5 + 8) / 3, 6);
    expect(result.pp[2]).toBeNull();
    expect(result.pp[3]).toBeCloseTo((20 + 10 + 15) / 3, 6);
  });

  it("preserves the input bars array (does not mutate)", () => {
    const bars = makeBars(5);
    const before = JSON.stringify(bars);
    computeDailyPivot(bars);
    expect(JSON.stringify(bars)).toBe(before);
  });
});

// ============================================================================
// validateDailyPivotSeries
// ============================================================================

describe("validateDailyPivotSeries", () => {
  it("returns the typed DailyPivotSeries for valid input", () => {
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const out = validateDailyPivotSeries(series, bars);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.pp).toEqual(series.pp);
    expect(out.r1).toEqual(series.r1);
    expect(out.s1).toEqual(series.s1);
  });

  it("returns the typed DailyPivotSeries when all values are null", () => {
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3, () => null);
    const out = validateDailyPivotSeries(series, bars);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.pp).toEqual([null, null, null]);
    expect(out.r1).toEqual([null, null, null]);
    expect(out.s1).toEqual([null, null, null]);
  });

  it("returns the typed DailyPivotSeries for empty (length 0) valid input", () => {
    const bars = makeBars(0);
    const series = makeDailyPivotSeries(0);
    const out = validateDailyPivotSeries(series, bars);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.pp).toEqual([]);
    expect(out.r1).toEqual([]);
    expect(out.s1).toEqual([]);
  });

  it("returns null when 'pp' is missing", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      r1: [1, 2, 3],
      s1: [1, 2, 3],
    };
    expect(validateDailyPivotSeries(series, bars)).toBeNull();
  });

  it("returns null when 'r1' is missing", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [1, 2, 3],
      s1: [1, 2, 3],
    };
    expect(validateDailyPivotSeries(series, bars)).toBeNull();
  });

  it("returns null when 's1' is missing", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [1, 2, 3],
      r1: [1, 2, 3],
    };
    expect(validateDailyPivotSeries(series, bars)).toBeNull();
  });

  it("returns null when all three keys are missing", () => {
    const bars = makeBars(3);
    expect(validateDailyPivotSeries({}, bars)).toBeNull();
  });

  it("returns null when pp.length !== r1.length", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [1, 2],
      r1: [1, 2, 3],
      s1: [1, 2, 3],
    };
    expect(validateDailyPivotSeries(series, bars)).toBeNull();
  });

  it("returns null when the shared length does not match bars.length", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [1, 2],
      r1: [1, 2],
      s1: [1, 2],
    };
    expect(validateDailyPivotSeries(series, bars)).toBeNull();
  });

  it("returns null when a value is a string", () => {
    const bars = makeBars(3);
    const series = {
      pp: [1, "bad", 3],
      r1: [1, 2, 3],
      s1: [1, 2, 3],
    } as unknown as IndicatorSeries;
    expect(validateDailyPivotSeries(series, bars)).toBeNull();
  });

  it("returns null when a value is undefined", () => {
    const bars = makeBars(3);
    const series = {
      pp: [1, 2, 3],
      r1: [1, undefined, 3],
      s1: [1, 2, 3],
    } as unknown as IndicatorSeries;
    expect(validateDailyPivotSeries(series, bars)).toBeNull();
  });

  it("returns null when a key is present but not an array", () => {
    const bars = makeBars(3);
    const series = {
      pp: 42,
      r1: [1, 2, 3],
      s1: [1, 2, 3],
    } as unknown as IndicatorSeries;
    expect(validateDailyPivotSeries(series, bars)).toBeNull();
  });
});

// ============================================================================
// renderDailyPivot
// ============================================================================

describe("renderDailyPivot", () => {
  it("returns an empty RenderedIndicator when bars is empty", () => {
    const chart = makeMockChart();
    const series = makeDailyPivotSeries(0);
    const ctx = makeContext(chart, [], series);

    const out = renderDailyPivot(ctx);

    expect(out.series).toEqual([]);
    expect(out.name).toBe("daily_pivot-1h-donchian_pivot_composition");
    expect(chart.calls).toEqual([]);
  });

  it("empty-bars dispose is a safe no-op (does not throw)", () => {
    const chart = makeMockChart();
    const out = renderDailyPivot(makeContext(chart, [], makeDailyPivotSeries(0)));
    expect(() => out.dispose()).not.toThrow();
  });

  it("adds 3 line series for valid bars + valid series", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series);

    const out = renderDailyPivot(ctx);

    expect(out.series).toHaveLength(3);
    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    expect(addSeriesCalls).toHaveLength(3);
    expect(setDataCalls).toHaveLength(3);
  });

  it("uses the DAILY_PIVOT_COLORS palette for the 3 series (pp/r1/s1 order)", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series);

    renderDailyPivot(ctx);

    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    expect(addSeriesCalls[0]?.args[1]).toMatchObject({ color: DAILY_PIVOT_COLORS.pp });
    expect(addSeriesCalls[1]?.args[1]).toMatchObject({ color: DAILY_PIVOT_COLORS.r1 });
    expect(addSeriesCalls[2]?.args[1]).toMatchObject({ color: DAILY_PIVOT_COLORS.s1 });
  });

  it("uses dashed lineStyle (2) for the PP line, solid for R1/S1", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series);

    renderDailyPivot(ctx);

    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    // PP (index 0) is dashed.
    expect(addSeriesCalls[0]?.args[1]).toMatchObject({ lineStyle: 2 });
    // R1 (index 1) is solid (0).
    expect(addSeriesCalls[1]?.args[1]).toMatchObject({ lineStyle: 0 });
    // S1 (index 2) is solid (0).
    expect(addSeriesCalls[2]?.args[1]).toMatchObject({ lineStyle: 0 });
  });

  it("uses lineWidth: 1 and disables priceLineVisible + lastValueVisible on every series", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series);

    renderDailyPivot(ctx);

    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    for (const call of addSeriesCalls) {
      expect(call.args[1]).toMatchObject({
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }
  });

  it("converts bar time from milliseconds to seconds (UTCTimestamp) in setData", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3, (i) => 100 + i);
    const ctx = makeContext(chart, bars, series);

    renderDailyPivot(ctx);

    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    const ppData = setDataCalls[0]?.args[2] as readonly {
      time: number;
      value: number;
    }[];
    expect(ppData[0]?.time).toBe(1_700_000_000);
    expect(ppData[0]?.value).toBe(100);
  });

  it("filters null values out of the LineData arrays", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [100, null, 102],
      r1: [101, 102, 103],
      s1: [99, 100, 101],
    };
    const ctx = makeContext(chart, bars, series);

    renderDailyPivot(ctx);

    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    const ppData = setDataCalls[0]?.args[2] as readonly unknown[];
    expect(ppData).toHaveLength(2);
  });

  it("calls console.warn and only adds 2 series when 'pp' is missing", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      r1: [101, 102, 103],
      s1: [99, 100, 101],
    };
    const ctx = makeContext(chart, bars, series);

    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDailyPivot(ctx);

      expect(out.series).toHaveLength(2);
      const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
      expect(addSeriesCalls).toHaveLength(2);
      expect(warnCapture.calls).toHaveLength(1);
      const warnMsg = warnCapture.calls[0] ?? "";
      expect(warnMsg).toContain("pp");
      expect(warnMsg).toContain("donchian_pivot_composition");
      expect(warnMsg).toContain("1h");
    } finally {
      warnCapture.restore();
    }
  });

  it("calls console.warn and only adds 2 series when 'r1' is missing (the valuesFor r1 FALSE branch)", () => {
    // The valuesFor function's `r1` case has a `hasArrayKey(..., "r1")
    // ? indicatorSeries.r1 : undefined` ternary. The FALSE branch (the
    // `undefined` half) fires when the r1 key is absent.
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [100, 101, 102],
      // no r1
      s1: [99, 100, 101],
    };
    const ctx = makeContext(chart, bars, series);

    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDailyPivot(ctx);
      expect(out.series).toHaveLength(2);
      const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
      expect(addSeriesCalls).toHaveLength(2);
      expect(warnCapture.calls).toHaveLength(1);
      expect(warnCapture.calls[0] ?? "").toContain("r1");
    } finally {
      warnCapture.restore();
    }
  });

  it("calls console.warn and only adds 2 series when 's1' is missing (the valuesFor s1 FALSE branch)", () => {
    // Same pattern as the r1 test — the valuesFor `s1` case's FALSE
    // branch fires when the s1 key is absent.
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [100, 101, 102],
      r1: [101, 102, 103],
      // no s1
    };
    const ctx = makeContext(chart, bars, series);

    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDailyPivot(ctx);
      expect(out.series).toHaveLength(2);
      const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
      expect(addSeriesCalls).toHaveLength(2);
      expect(warnCapture.calls).toHaveLength(1);
      expect(warnCapture.calls[0] ?? "").toContain("s1");
    } finally {
      warnCapture.restore();
    }
  });

  it("dispose() removes all 3 series from the chart", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series);

    const out = renderDailyPivot(ctx);
    out.dispose();

    const removeCalls = chart.calls.filter((c) => c.method === "removeSeries");
    expect(removeCalls).toHaveLength(3);
    const createdSeries = chart.createdSeries;
    const removedSeries: readonly unknown[] = removeCalls.map((c) => c.args[0]);
    expect(removedSeries).toEqual(createdSeries);
  });

  it("composes the RenderedIndicator.name as daily_pivot-<timeframe>-<strategy>", () => {
    const chart = makeMockChart();
    const bars = makeBars(2);
    const series = makeDailyPivotSeries(2);
    const ctx: IndicatorContext = {
      chart: chart as unknown as IChartApi,
      bars,
      indicatorSeries: series,
      color: "#000000",
      strategy: "alt_strategy",
      timeframe: "4h",
    };
    const out = renderDailyPivot(ctx);
    expect(out.name).toBe("daily_pivot-4h-alt_strategy");
  });

  it("preserves the input bars array (does not mutate)", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const before = JSON.stringify(bars);
    renderDailyPivot(makeContext(chart, bars, series));
    expect(JSON.stringify(bars)).toBe(before);
  });
});

// ============================================================================
// IndicatorRegistry integration
// ============================================================================

describe("IndicatorRegistry with daily_pivot", () => {
  it("the daily_pivot renderer can be registered + retrieved", () => {
    const registry = new IndicatorRegistry();
    registry.register("daily_pivot", renderDailyPivot);
    expect(registry.get("daily_pivot")).toBe(renderDailyPivot);
    expect(registry.has("daily_pivot")).toBe(true);
    expect(registry.list()).toEqual(["daily_pivot"]);
  });

  it("the full register + render + dispose round-trip works", () => {
    const registry = new IndicatorRegistry();
    registry.register("daily_pivot", renderDailyPivot);
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series);
    const renderer = registry.get("daily_pivot");
    expect(renderer).not.toBeUndefined();
    if (renderer === undefined) return;
    const out = renderer(ctx);
    expect(out.series).toHaveLength(3);
    out.dispose();
    const removeCalls = chart.calls.filter((c) => c.method === "removeSeries");
    expect(removeCalls).toHaveLength(3);
  });
});

// ============================================================================
// Contract: PP/R1/S1 invariants
// ============================================================================

describe("PP/R1/S1 invariants", () => {
  it("R1 > PP for the hand-computed example (resistance is above the pivot)", () => {
    const bars: OHLCBar[] = [
      makeBarWithHLC(12, 10, 11, 0),
      makeBarWithHLC(14, 12, 13, 1),
    ];
    const result = computeDailyPivot(bars);
    expect(result.r1[1]).not.toBeNull();
    expect(result.pp[1]).not.toBeNull();
    if (result.r1[1] === null || result.pp[1] === null) return;
    expect(result.r1[1]).toBeGreaterThan(result.pp[1]);
  });

  it("S1 < PP for the hand-computed example (support is below the pivot)", () => {
    const bars: OHLCBar[] = [
      makeBarWithHLC(12, 10, 11, 0),
      makeBarWithHLC(14, 12, 13, 1),
    ];
    const result = computeDailyPivot(bars);
    expect(result.s1[1]).not.toBeNull();
    expect(result.pp[1]).not.toBeNull();
    if (result.s1[1] === null || result.pp[1] === null) return;
    expect(result.s1[1]).toBeLessThan(result.pp[1]);
  });
});

// ============================================================================
// __testing re-exports — exercise the TypeScript `never`-typed default
// branches in `colorFor` / `valuesFor` so coverage is 100% on every line.
// ============================================================================

describe("__testing.colorFor — the default-throw (exhaustiveness) branch", () => {
  it("throws when given an unknown key (TypeScript bypass via `as never`)", () => {
    expect(() =>
      (__testing.colorFor as (k: unknown) => string)("invalid-key"),
    ).toThrow("colorFor: unknown key invalid-key");
  });

  it("throws even for an empty string (defensive: empty string is not a valid DailyPivotSeriesKey)", () => {
    expect(() =>
      (__testing.colorFor as (k: unknown) => string)(""),
    ).toThrow("colorFor: unknown key ");
  });

  it("throws for a numeric key (defensive: only string keys are valid)", () => {
    expect(() =>
      (__testing.colorFor as (k: unknown) => string)(42),
    ).toThrow("colorFor: unknown key 42");
  });
});

describe("__testing.valuesFor — the default-throw (exhaustiveness) branch", () => {
  it("throws when given an unknown key (TypeScript bypass via `as never`)", () => {
    const series: IndicatorSeries = {
      pp: [1, 2, 3],
      r1: [1, 2, 3],
      s1: [1, 2, 3],
    };
    expect(() =>
      (__testing.valuesFor as (
        s: IndicatorSeries,
        k: unknown,
      ) => readonly (number | null)[] | undefined)(series, "bogus"),
    ).toThrow("valuesFor: unknown key bogus");
  });

  it("throws for an empty string (defensive: empty string is not a valid DailyPivotSeriesKey)", () => {
    const series: IndicatorSeries = {
      pp: [1, 2, 3],
      r1: [1, 2, 3],
      s1: [1, 2, 3],
    };
    expect(() =>
      (__testing.valuesFor as (
        s: IndicatorSeries,
        k: unknown,
      ) => readonly (number | null)[] | undefined)(series, ""),
    ).toThrow("valuesFor: unknown key ");
  });

  it("throws for a numeric key (defensive: only string keys are valid)", () => {
    const series: IndicatorSeries = {
      pp: [1, 2, 3],
      r1: [1, 2, 3],
      s1: [1, 2, 3],
    };
    expect(() =>
      (__testing.valuesFor as (
        s: IndicatorSeries,
        k: unknown,
      ) => readonly (number | null)[] | undefined)(series, 99),
    ).toThrow("valuesFor: unknown key 99");
  });

  it("returns the values array when the key IS present (the happy path)", () => {
    const series: IndicatorSeries = {
      pp: [10, 20, 30],
      r1: [11, 21, 31],
      s1: [12, 22, 32],
    };
    expect(
      (__testing.valuesFor as (
        s: IndicatorSeries,
        k: unknown,
      ) => readonly (number | null)[] | undefined)(series, "pp"),
    ).toEqual([10, 20, 30]);
    expect(
      (__testing.valuesFor as (
        s: IndicatorSeries,
        k: unknown,
      ) => readonly (number | null)[] | undefined)(series, "r1"),
    ).toEqual([11, 21, 31]);
    expect(
      (__testing.valuesFor as (
        s: IndicatorSeries,
        k: unknown,
      ) => readonly (number | null)[] | undefined)(series, "s1"),
    ).toEqual([12, 22, 32]);
  });

  it("returns undefined when 'r1' is absent (the r1 false branch)", () => {
    // The series is missing the "r1" key — exercises the
    // `hasOwnProperty` false branch on the R1 case.
    const series = {
      pp: [1, 2, 3],
      s1: [4, 5, 6],
    } as IndicatorSeries;
    expect(
      (__testing.valuesFor as (
        s: IndicatorSeries,
        k: unknown,
      ) => readonly (number | null)[] | undefined)(series, "r1"),
    ).toBeUndefined();
  });

  it("returns undefined when 's1' is absent (the s1 false branch)", () => {
    // The series is missing the "s1" key — exercises the
    // `hasOwnProperty` false branch on the S1 case.
    const series = {
      pp: [1, 2, 3],
      r1: [4, 5, 6],
    } as IndicatorSeries;
    expect(
      (__testing.valuesFor as (
        s: IndicatorSeries,
        k: unknown,
      ) => readonly (number | null)[] | undefined)(series, "s1"),
    ).toBeUndefined();
  });
});
