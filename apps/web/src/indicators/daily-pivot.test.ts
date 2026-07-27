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

/**
 * `MockPriceLine` — a stand-in for a lightweight-charts
 * `IPriceLine`. Phase 82: the daily-pivot renderer creates 3
 * price lines on the candle series (one per level: PP / R1 /
 * S1). The mock captures the `createPriceLine` arguments so
 * the test can assert on the price, color, and title.
 */
interface MockPriceLine {
  readonly id: number;
  readonly opts: unknown;
}

/**
 * `MockCandleSeries` — a stand-in for the candle series with
 * the `createPriceLine` / `removePriceLine` methods that
 * lightweight-charts v5 exposes on every series type.
 */
interface MockCandleSeries {
  readonly createdPriceLines: readonly MockPriceLine[];
  readonly calls: readonly MockCall[];
  createPriceLine: (opts: unknown) => MockPriceLine;
  removePriceLine: (line: unknown) => void;
}

interface MockChart {
  readonly calls: readonly MockCall[];
  readonly createdSeries: readonly MockSeries[];
  addSeries: (definition: unknown, opts: unknown) => MockSeries;
  removeSeries: (s: unknown) => void;
}

function makeMockCandleSeries(): MockCandleSeries {
  const createdPriceLines: MockPriceLine[] = [];
  const calls: MockCall[] = [];
  return {
    createdPriceLines,
    calls,
    createPriceLine: (opts: unknown): MockPriceLine => {
      const id = createdPriceLines.length;
      const line: MockPriceLine = { id, opts };
      createdPriceLines.push(line);
      calls.push({ method: "createPriceLine", args: [opts] });
      return line;
    },
    removePriceLine: (line: unknown): void => {
      calls.push({ method: "removePriceLine", args: [line] });
    },
  };
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
  candleSeries?: MockCandleSeries,
): IndicatorContext {
  return {
    chart: chart as unknown as IChartApi,
    bars,
    indicatorSeries: series,
    color: "#000000",
    strategy: "donchian_pivot_composition",
    timeframe: "1h",
    candleSeries: candleSeries as unknown as Parameters<
      typeof renderDailyPivot
    >[0]["candleSeries"],
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
    const candle = makeMockCandleSeries();
    const series = makeDailyPivotSeries(0);
    const ctx = makeContext(chart, [], series, candle);

    const out = renderDailyPivot(ctx);

    expect(out.series).toEqual([]);
    expect(out.name).toBe("daily_pivot-1h-donchian_pivot_composition");
    expect(chart.calls).toEqual([]);
    expect(candle.calls).toEqual([]);
  });

  it("empty-bars dispose is a safe no-op (does not throw)", () => {
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const out = renderDailyPivot(
      makeContext(chart, [], makeDailyPivotSeries(0), candle),
    );
    expect(() => out.dispose()).not.toThrow();
  });

  it("console.warns and returns an empty RenderedIndicator when candleSeries is undefined (defensive)", () => {
    // The renderer is called WITHOUT a candle series — the
    // defensive branch fires, console.warn is called, and no
    // series/price-lines are created.
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series); // no candle

    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDailyPivot(ctx);
      expect(out.series).toEqual([]);
      expect(out.name).toBe("daily_pivot-1h-donchian_pivot_composition");
      // console.warn called with the "candleSeries is undefined" message.
      expect(warnCapture.calls.length).toBeGreaterThanOrEqual(1);
      const candleWarn = warnCapture.calls.find((m) =>
        m.includes("candleSeries is undefined"),
      );
      expect(candleWarn).toBeDefined();
    } finally {
      warnCapture.restore();
    }
  });

  it("creates 3 price lines on the candle series (PP / R1 / S1) for the most recent day", () => {
    // Phase 82: the renderer is now price-line based, not
    // line-series based. The 3 line series are replaced by
    // 3 `createPriceLine` calls on the candle series.
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series, candle);

    const out = renderDailyPivot(ctx);

    // No line series are added.
    expect(out.series).toEqual([]);
    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    expect(addSeriesCalls).toHaveLength(0);
    // 3 price lines are created on the candle series.
    expect(candle.createdPriceLines).toHaveLength(3);
    expect(candle.calls.filter((c) => c.method === "createPriceLine")).toHaveLength(3);
  });

  it("uses the DAILY_PIVOT_COLORS palette for the 3 price lines (pp/r1/s1 order)", () => {
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series, candle);

    renderDailyPivot(ctx);

    // The 3 price lines are created in pp → r1 → s1 order with
    // the corresponding DAILY_PIVOT_COLORS palette.
    const createCalls = candle.calls.filter((c) => c.method === "createPriceLine");
    expect(createCalls[0]?.args[0]).toMatchObject({ color: DAILY_PIVOT_COLORS.pp });
    expect(createCalls[1]?.args[0]).toMatchObject({ color: DAILY_PIVOT_COLORS.r1 });
    expect(createCalls[2]?.args[0]).toMatchObject({ color: DAILY_PIVOT_COLORS.s1 });
  });

  it("uses dashed lineStyle (2) for the PP line, solid for R1/S1 (Phase 82: price-line lineStyle)", () => {
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series, candle);

    renderDailyPivot(ctx);

    const createCalls = candle.calls.filter((c) => c.method === "createPriceLine");
    // PP (index 0) is dashed.
    expect(createCalls[0]?.args[0]).toMatchObject({ lineStyle: 2 });
    // R1 (index 1) is solid (0).
    expect(createCalls[1]?.args[0]).toMatchObject({ lineStyle: 0 });
    // S1 (index 2) is solid (0).
    expect(createCalls[2]?.args[0]).toMatchObject({ lineStyle: 0 });
  });

  it("sets the price of each line to the most recent non-null pp/r1/s1 value", () => {
    // The 3 bar series have [10, 20, 30] for each level — the
    // most recent non-null is 30, so all 3 price lines are at
    // price 30.
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series, candle);

    renderDailyPivot(ctx);

    const createCalls = candle.calls.filter((c) => c.method === "createPriceLine");
    expect(createCalls[0]?.args[0]).toMatchObject({ price: 102 }); // pp[2] = 100+2 = 102
    expect(createCalls[1]?.args[0]).toMatchObject({ price: 102 });
    expect(createCalls[2]?.args[0]).toMatchObject({ price: 102 });
  });

  it("uses the most recent non-null value when later bars are null (the `lastNonNull` skip branch)", () => {
    // The last bar is null → the renderer should pick the
    // last non-null value (bar[1], not bar[2]).
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [10, 20, null],
      r1: [11, 21, null],
      s1: [9, 19, null],
    };
    const ctx = makeContext(chart, bars, series, candle);

    renderDailyPivot(ctx);

    const createCalls = candle.calls.filter((c) => c.method === "createPriceLine");
    expect(createCalls[0]?.args[0]).toMatchObject({ price: 20 });
    expect(createCalls[1]?.args[0]).toMatchObject({ price: 21 });
    expect(createCalls[2]?.args[0]).toMatchObject({ price: 19 });
  });

  it("returns an empty RenderedIndicator (no price lines) when the most recent value of any level is null (the all-null short-circuit)", () => {
    // Every value is null → the renderer should return early
    // without creating any price lines.
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [null, null, null],
      r1: [null, null, null],
      s1: [null, null, null],
    };
    const ctx = makeContext(chart, bars, series, candle);

    const out = renderDailyPivot(ctx);
    expect(out.series).toEqual([]);
    expect(candle.createdPriceLines).toHaveLength(0);
  });

  it("includes the previous bar's date in each price-line title (e.g. 'PP 2023-11-14')", () => {
    // The pivot uses `bars[i-1]` (the previous bar's H/L/C).
    // The date label on the price line is the UTC date of that
    // previous bar. For bars[0..2] = 1_700_000_000_000 (ms),
    // 1_700_000_060_000, 1_700_000_120_000, the most recent
    // bar is bars[2] and the previous bar is bars[1] =
    // 1_700_000_060_000 ms. The UTC date of 1_700_000_060_000
    // is 2023-11-14 (1700000060 sec ≈ 2023-11-14 22:14:20 UTC).
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series, candle);

    renderDailyPivot(ctx);

    const createCalls = candle.calls.filter((c) => c.method === "createPriceLine");
    expect(createCalls[0]?.args[0]).toMatchObject({ title: "PP 2023-11-14" });
    expect(createCalls[1]?.args[0]).toMatchObject({ title: "R1 2023-11-14" });
    expect(createCalls[2]?.args[0]).toMatchObject({ title: "S1 2023-11-14" });
  });

  it("uses lineWidth: 1 and axisLabelVisible: true on every price line", () => {
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series, candle);

    renderDailyPivot(ctx);

    const createCalls = candle.calls.filter((c) => c.method === "createPriceLine");
    for (const call of createCalls) {
      expect(call.args[0]).toMatchObject({
        lineWidth: 1,
        axisLabelVisible: true,
      });
    }
  });

  it("console.warns and returns empty when 'pp' is missing from the indicator series", () => {
    // Phase 82: the per-key defensive check. If pp is missing,
    // no price lines are created (we don't want a partial
    // pivot without the equilibrium).
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      r1: [101, 102, 103],
      s1: [99, 100, 101],
    };
    const ctx = makeContext(chart, bars, series, candle);

    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDailyPivot(ctx);
      expect(out.series).toEqual([]);
      expect(candle.createdPriceLines).toHaveLength(0);
      expect(warnCapture.calls.length).toBeGreaterThanOrEqual(1);
      const missingWarn = warnCapture.calls.find((m) =>
        m.includes("missing pp/r1/s1"),
      );
      expect(missingWarn).toBeDefined();
    } finally {
      warnCapture.restore();
    }
  });

  it("console.warns and returns empty when 'r1' is missing from the indicator series", () => {
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [100, 101, 102],
      s1: [99, 100, 101],
    };
    const ctx = makeContext(chart, bars, series, candle);

    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDailyPivot(ctx);
      expect(out.series).toEqual([]);
      expect(candle.createdPriceLines).toHaveLength(0);
      expect(warnCapture.calls.length).toBeGreaterThanOrEqual(1);
      const missingWarn = warnCapture.calls.find((m) =>
        m.includes("missing pp/r1/s1"),
      );
      expect(missingWarn).toBeDefined();
    } finally {
      warnCapture.restore();
    }
  });

  it("console.warns and returns empty when 's1' is missing from the indicator series", () => {
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      pp: [100, 101, 102],
      r1: [101, 102, 103],
    };
    const ctx = makeContext(chart, bars, series, candle);

    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDailyPivot(ctx);
      expect(out.series).toEqual([]);
      expect(candle.createdPriceLines).toHaveLength(0);
      expect(warnCapture.calls.length).toBeGreaterThanOrEqual(1);
      const missingWarn = warnCapture.calls.find((m) =>
        m.includes("missing pp/r1/s1"),
      );
      expect(missingWarn).toBeDefined();
    } finally {
      warnCapture.restore();
    }
  });

  it("dispose() removes all 3 price lines from the candle series", () => {
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series, candle);

    const out = renderDailyPivot(ctx);
    out.dispose();

    const removeCalls = candle.calls.filter((c) => c.method === "removePriceLine");
    expect(removeCalls).toHaveLength(3);
    const createdPriceLines = candle.createdPriceLines;
    const removedPriceLines: readonly unknown[] = removeCalls.map((c) => c.args[0]);
    expect(removedPriceLines).toEqual(createdPriceLines);
  });

  it("composes the RenderedIndicator.name as daily_pivot-<timeframe>-<strategy>", () => {
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(2);
    const series = makeDailyPivotSeries(2);
    const ctx: IndicatorContext = {
      chart: chart as unknown as IChartApi,
      bars,
      indicatorSeries: series,
      color: "#000000",
      strategy: "alt_strategy",
      timeframe: "4h",
      candleSeries: candle as unknown as Parameters<
        typeof renderDailyPivot
      >[0]["candleSeries"],
    };
    const out = renderDailyPivot(ctx);
    expect(out.name).toBe("daily_pivot-4h-alt_strategy");
  });

  it("preserves the input bars array (does not mutate)", () => {
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const before = JSON.stringify(bars);
    renderDailyPivot(makeContext(chart, bars, series, candle));
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

  it("the full register + render + dispose round-trip works (Phase 82: 3 price lines on candle series, not 3 line series)", () => {
    const registry = new IndicatorRegistry();
    registry.register("daily_pivot", renderDailyPivot);
    const chart = makeMockChart();
    const candle = makeMockCandleSeries();
    const bars = makeBars(3);
    const series = makeDailyPivotSeries(3);
    const ctx = makeContext(chart, bars, series, candle);
    const renderer = registry.get("daily_pivot");
    expect(renderer).not.toBeUndefined();
    if (renderer === undefined) return;
    const out = renderer(ctx);
    // Phase 82: 0 line series (they were dropped in favor of
    // price lines).
    expect(out.series).toHaveLength(0);
    out.dispose();
    const removeCalls = candle.calls.filter((c) => c.method === "removePriceLine");
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
