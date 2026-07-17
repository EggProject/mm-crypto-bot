/**
 * apps/web/src/indicators/donchian.test.ts
 *
 * Phase 49A: bun:test unit tests for the Donchian channel
 * indicator + the IndicatorRegistry.
 *
 * Coverage target: 100% line + branch coverage on
 *   - `donchian.ts`
 *   - `registry.ts`
 *
 * Lightweight-charts needs a DOM canvas, so the renderer tests
 * use a hand-rolled `IChartApi` mock that records every
 * `addSeries` and `removeSeries` call. The mock is intentionally
 * NOT typed as `IChartApi` (only the methods the renderer uses
 * are present) — it is `unknown`/loose-typed at the boundary
 * and cast to `IChartApi` at the use site. The test code
 * asserts on the recorded call log, not on the mock object's
 * shape.
 */

import { describe, expect, it } from "bun:test";

import {
  DONCHIAN_COLORS,
  DONCHIAN_INDICATOR_NAME,
  DONCHIAN_SERIES_KEYS,
  renderDonchian,
  validateDonchianSeries,
} from "./donchian.js";
import {
  IndicatorRegistry,
  type IndicatorContext,
  type IndicatorRenderer,
  type IndicatorSeries,
} from "./registry.js";
import type { OHLCBar } from "../lib/ohlc-bridge.js";
import type { IChartApi } from "lightweight-charts";

// ============================================================================
// Test fixtures
// ============================================================================

/** Build a 3-bar OHLC sequence at 1-minute spacing. */
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
 * Build a valid Donchian series for `count` bars.
 * `valueOf(i)` lets each test customize the per-bar value (or pass
 * `null` to mark "no value at this bar").
 */
function makeDonchianSeries(
  count: number,
  valueOf: (i: number) => number | null = (i) => 100 + i,
): IndicatorSeries {
  const arr = (n: number): (number | null)[] => {
    const out: (number | null)[] = [];
    for (let i = 0; i < n; i += 1) out.push(valueOf(i));
    return out;
  };
  return {
    upper: arr(count),
    middle: arr(count),
    lower: arr(count),
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
 * `MockChart` is intentionally NOT typed as `IChartApi` — only
 * the methods the renderer touches are present. The `as unknown
 * as IChartApi` cast happens at the boundary in `makeContext`,
 * so the test assertions can use the loose `MockChart` shape
 * (which has the `calls` log) without `IChartApi`'s dozen other
 * methods getting in the way.
 */
interface MockChart {
  readonly calls: MockCall[];
  /** Series created by `addSeries`, in creation order. */
  readonly createdSeries: readonly MockSeries[];
  addSeries: (definition: unknown, opts: unknown) => MockSeries;
  removeSeries: (s: unknown) => void;
}

/**
 * Build a minimal `IChartApi` mock that records the calls the
 * renderer makes. Only `addSeries` and `removeSeries` are
 * implemented — the renderer does not touch the other methods.
 */
function makeMockChart(): MockChart {
  const calls: MockCall[] = [];
  const createdSeries: MockSeries[] = [];

  // The mock series has a `setData` method that records what the
  // renderer feeds it. We also expose an `id` so the test can
  // assert "the series the renderer created are the ones that get
  // removed in dispose()".
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

/**
 * `captureConsoleWarn` — replace `console.warn` with a recorder
 * for the duration of one test, then restore.
 *
 * bun:test's `spyOn(console, "warn")` accumulates `.mock.calls`
 * across `it` blocks when called on the same object/method, so
 * a clean per-test capture (with try/finally restore) is the
 * reliable way to assert "this test produced N warnings". The
 * recorder stringifies the first argument (the renderer only
 * passes a single string message).
 */
function captureConsoleWarn(): {
  readonly calls: string[];
  readonly restore: () => void;
} {
  const calls: string[] = [];
  const orig = console.warn;
  // The renderer passes a single string; some lint rules want
  // `unknown` here, so accept any args and stringify defensively.
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

// ============================================================================
// validateDonchianSeries
// ============================================================================

describe("validateDonchianSeries", () => {
  it("returns the typed DonchianSeries for valid input", () => {
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const out = validateDonchianSeries(series, bars);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.upper).toEqual(series.upper);
    expect(out.middle).toEqual(series.middle);
    expect(out.lower).toEqual(series.lower);
  });

  it("returns the typed DonchianSeries when all values are null", () => {
    // An all-null series is a valid "no values yet" state — the
    // renderer will filter the nulls out and produce an empty
    // LineData array.
    const bars = makeBars(3);
    const series = makeDonchianSeries(3, () => null);
    const out = validateDonchianSeries(series, bars);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.upper).toEqual([null, null, null]);
    expect(out.middle).toEqual([null, null, null]);
    expect(out.lower).toEqual([null, null, null]);
  });

  it("returns the typed DonchianSeries for empty (length 0) valid input", () => {
    // `bars` empty AND every series empty → lengths match → valid.
    // The renderer is the one that short-circuits on empty bars;
    // validation is a structural check, not a "data must be
    // non-empty" check.
    const bars = makeBars(0);
    const series = makeDonchianSeries(0);
    const out = validateDonchianSeries(series, bars);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.upper).toEqual([]);
    expect(out.middle).toEqual([]);
    expect(out.lower).toEqual([]);
  });

  it("returns null when 'upper' is missing", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      middle: [1, 2, 3],
      lower: [1, 2, 3],
      // no `upper`
    };
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("returns null when 'middle' is missing", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      upper: [1, 2, 3],
      lower: [1, 2, 3],
      // no `middle`
    };
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("returns null when 'lower' is missing", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      upper: [1, 2, 3],
      middle: [1, 2, 3],
      // no `lower`
    };
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("returns null when all three keys are missing (empty IndicatorSeries)", () => {
    const bars = makeBars(3);
    expect(validateDonchianSeries({}, bars)).toBeNull();
  });

  it("returns null when upper.length !== middle.length", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      upper: [1, 2],
      middle: [1, 2, 3],
      lower: [1, 2, 3],
    };
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("returns null when middle.length !== lower.length", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      upper: [1, 2, 3],
      middle: [1, 2, 3, 4],
      lower: [1, 2, 3],
    };
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("returns null when the shared length does not match bars.length", () => {
    const bars = makeBars(3);
    // series length = 2, bars length = 3
    const series: IndicatorSeries = {
      upper: [1, 2],
      middle: [1, 2],
      lower: [1, 2],
    };
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("returns null when a value is a string (not number or null)", () => {
    const bars = makeBars(3);
    // The runtime type-guard must catch the bad value even though
    // the static type allows only `number | null`; a stale
    // serialization layer could pass a string. The `as unknown as`
    // cast bypasses the static type to reach the runtime check.
    const series = {
      upper: [1, "bad", 3],
      middle: [1, 2, 3],
      lower: [1, 2, 3],
    } as unknown as IndicatorSeries;
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("returns null when a value is undefined (not number or null)", () => {
    const bars = makeBars(3);
    const series = {
      upper: [1, 2, 3],
      middle: [1, undefined, 3],
      lower: [1, 2, 3],
    } as unknown as IndicatorSeries;
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("returns null when a value is a boolean", () => {
    const bars = makeBars(3);
    const series = {
      upper: [1, 2, 3],
      middle: [1, 2, 3],
      lower: [1, 2, false],
    } as unknown as IndicatorSeries;
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("accepts mixed number + null values (the conventional case)", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      upper: [1, null, 3],
      middle: [1, 2, 3],
      lower: [1, 2, null],
    };
    const out = validateDonchianSeries(series, bars);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.upper).toEqual([1, null, 3]);
    expect(out.middle).toEqual([1, 2, 3]);
    expect(out.lower).toEqual([1, 2, null]);
  });

  it("returns null when a key is present but not an array (number)", () => {
    // Rule 1: a key can be "present" but its value can be a non-array
    // (e.g. a string or number). Array.isArray must reject these.
    const bars = makeBars(3);
    const series = { upper: 42, middle: [1, 2, 3], lower: [1, 2, 3] } as unknown as IndicatorSeries;
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });

  it("returns null when a key is present but not an array (object)", () => {
    const bars = makeBars(3);
    const series = {
      upper: { 0: 1, 1: 2, 2: 3 },
      middle: [1, 2, 3],
      lower: [1, 2, 3],
    } as unknown as IndicatorSeries;
    expect(validateDonchianSeries(series, bars)).toBeNull();
  });
});

// ============================================================================
// renderDonchian — chart mock + context helper
// ============================================================================

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

describe("renderDonchian", () => {
  it("returns an empty RenderedIndicator when bars is empty", () => {
    const chart = makeMockChart();
    const series = makeDonchianSeries(0);
    const ctx = makeContext(chart, [], series);

    const out = renderDonchian(ctx);

    expect(out.series).toEqual([]);
    expect(out.name).toBe("donchian-1h-donchian_pivot_composition");
    // No chart calls were made — the renderer is a no-op for empty bars.
    expect(chart.calls).toEqual([]);
  });

  it("empty-bars dispose is a safe no-op (does not throw)", () => {
    const chart = makeMockChart();
    const out = renderDonchian(makeContext(chart, [], makeDonchianSeries(0)));
    expect(() => out.dispose()).not.toThrow();
  });

  it("adds 3 line series for valid bars + valid series", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const ctx = makeContext(chart, bars, series);

    const out = renderDonchian(ctx);

    expect(out.series).toHaveLength(3);
    // 3 addSeries calls + 3 setData calls = 6 chart calls.
    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    expect(addSeriesCalls).toHaveLength(3);
    expect(setDataCalls).toHaveLength(3);
  });

  it("uses the DONCHIAN_COLORS palette for the 3 series (upper/middle/lower order)", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const ctx = makeContext(chart, bars, series);

    renderDonchian(ctx);

    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    // The renderer iterates DONCHIAN_SERIES_KEYS in order, so the
    // first addSeries is `upper`, second `middle`, third `lower`.
    // The color is the second positional arg to addSeries.
    expect(addSeriesCalls[0]?.args[1]).toMatchObject({ color: DONCHIAN_COLORS.upper });
    expect(addSeriesCalls[1]?.args[1]).toMatchObject({ color: DONCHIAN_COLORS.middle });
    expect(addSeriesCalls[2]?.args[1]).toMatchObject({ color: DONCHIAN_COLORS.lower });
  });

  it("uses lineWidth: 1 and disables priceLineVisible + lastValueVisible on every series", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const ctx = makeContext(chart, bars, series);

    renderDonchian(ctx);

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
    // bar[0].time = 1_700_000_000_000 ms = 1_700_000_000 s
    // bar[1].time = 1_700_000_060_000 ms = 1_700_000_060 s
    // bar[2].time = 1_700_000_120_000 ms = 1_700_000_120 s
    const series = makeDonchianSeries(3, (i) => 100 + i);
    const ctx = makeContext(chart, bars, series);

    renderDonchian(ctx);

    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    // Upper series setData — its 3 points must be { time: 1_700_000_000, value: 100 }, etc.
    const upperData = setDataCalls[0]?.args[2] as readonly { time: number; value: number }[];
    expect(upperData).toHaveLength(3);
    expect(upperData[0]?.time).toBe(1_700_000_000);
    expect(upperData[0]?.value).toBe(100);
    expect(upperData[1]?.time).toBe(1_700_000_060);
    expect(upperData[1]?.value).toBe(101);
    expect(upperData[2]?.time).toBe(1_700_000_120);
    expect(upperData[2]?.value).toBe(102);
  });

  it("filters null values out of the LineData arrays (upper has 1 null → 2 points)", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      upper: [100, null, 102],
      middle: [99, 100, 101],
      lower: [98, 99, 100],
    };
    const ctx = makeContext(chart, bars, series);

    renderDonchian(ctx);

    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    const upperData = setDataCalls[0]?.args[2] as readonly { time: number; value: number }[];
    const middleData = setDataCalls[1]?.args[2] as readonly { time: number; value: number }[];
    const lowerData = setDataCalls[2]?.args[2] as readonly { time: number; value: number }[];

    expect(upperData).toHaveLength(2);
    expect(upperData[0]?.value).toBe(100);
    expect(upperData[1]?.value).toBe(102);
    expect(middleData).toHaveLength(3);
    expect(lowerData).toHaveLength(3);
  });

  it("calls console.warn and only adds 2 series when 'upper' is missing", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      middle: [99, 100, 101],
      lower: [98, 99, 100],
      // no `upper`
    };
    const ctx = makeContext(chart, bars, series);

    // Capture the warn — `captureConsoleWarn` replaces `console.warn`
    // for the duration of this `it` block, then restores.
    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDonchian(ctx);

      expect(out.series).toHaveLength(2);
      const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
      expect(addSeriesCalls).toHaveLength(2);
      // The warn mentions the missing key + the strategy/timeframe
      // so a developer can locate the source feed.
      expect(warnCapture.calls).toHaveLength(1);
      const warnMsg = warnCapture.calls[0] ?? "";
      expect(warnMsg).toContain("upper");
      expect(warnMsg).toContain("donchian_pivot_composition");
      expect(warnMsg).toContain("1h");
    } finally {
      warnCapture.restore();
    }
  });

  it("calls console.warn and only adds 1 series when only 'lower' is present", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      lower: [98, 99, 100],
    };
    const ctx = makeContext(chart, bars, series);

    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDonchian(ctx);

      expect(out.series).toHaveLength(1);
      const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
      expect(addSeriesCalls).toHaveLength(1);
      // Two keys are missing → two warns.
      expect(warnCapture.calls).toHaveLength(2);
    } finally {
      warnCapture.restore();
    }
  });

  it("warns once per missing key (3 warns when 0 keys are present)", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const ctx = makeContext(chart, bars, {});

    const warnCapture = captureConsoleWarn();
    try {
      const out = renderDonchian(ctx);

      expect(out.series).toHaveLength(0);
      expect(warnCapture.calls).toHaveLength(DONCHIAN_SERIES_KEYS.length);
    } finally {
      warnCapture.restore();
    }
  });

  it("does not call console.warn when all 3 keys are present", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const ctx = makeContext(chart, bars, series);

    const warnCapture = captureConsoleWarn();
    try {
      renderDonchian(ctx);

      expect(warnCapture.calls).toHaveLength(0);
    } finally {
      warnCapture.restore();
    }
  });

  it("feeds lightweight-charts an empty array when all values are null", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3, () => null);
    const ctx = makeContext(chart, bars, series);

    renderDonchian(ctx);

    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    expect(setDataCalls).toHaveLength(3);
    for (const call of setDataCalls) {
      const data = call.args[2] as readonly unknown[];
      expect(data).toEqual([]);
    }
  });

  it("composes the RenderedIndicator.name as donchian-<timeframe>-<strategy>", () => {
    const chart = makeMockChart();
    const bars = makeBars(2);
    const series = makeDonchianSeries(2);
    const ctx: IndicatorContext = {
      chart: chart as unknown as IChartApi,
      bars,
      indicatorSeries: series,
      color: "#000000",
      strategy: "alt_strategy",
      timeframe: "4h",
    };
    const out = renderDonchian(ctx);
    expect(out.name).toBe("donchian-4h-alt_strategy");
  });

  it("uses the timeframe field directly (no special encoding)", () => {
    const chart = makeMockChart();
    const bars = makeBars(2);
    const series = makeDonchianSeries(2);
    const ctx: IndicatorContext = {
      chart: chart as unknown as IChartApi,
      bars,
      indicatorSeries: series,
      color: "#000000",
      strategy: "donchian_pivot_composition",
      timeframe: "15m",
    };
    const out = renderDonchian(ctx);
    expect(out.name).toBe("donchian-15m-donchian_pivot_composition");
  });

  it("dispose() removes all 3 series from the chart", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const ctx = makeContext(chart, bars, series);

    const out = renderDonchian(ctx);
    out.dispose();

    const removeCalls = chart.calls.filter((c) => c.method === "removeSeries");
    expect(removeCalls).toHaveLength(3);
    // The 3 series created by `addSeries` (in creation order) are
    // the same instances that get passed to `removeSeries`. The
    // mock's `createdSeries` array gives us the canonical list;
    // `removeSeries` was called with them in the same order.
    const createdSeries = chart.createdSeries;
    expect(createdSeries).toHaveLength(3);
    const removedSeries: readonly unknown[] = removeCalls.map((c) => c.args[0]);
    expect(removedSeries).toEqual(createdSeries);
  });

  it("dispose() is idempotent in the sense that calling twice makes 6 removeSeries calls (the caller decides)", () => {
    // The renderer does NOT track prior dispose state — calling
    // dispose twice produces 2x removeSeries. The caller is
    // expected to not call dispose twice. We document that
    // behavior here so a future change that adds idempotency
    // is a deliberate decision, not a silent behavior change.
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const ctx = makeContext(chart, bars, series);

    const out = renderDonchian(ctx);
    out.dispose();
    out.dispose();

    const removeCalls = chart.calls.filter((c) => c.method === "removeSeries");
    expect(removeCalls).toHaveLength(6);
  });

  it("handles 1-bar input (the smallest non-empty case)", () => {
    const chart = makeMockChart();
    const bars = makeBars(1);
    const series = makeDonchianSeries(1);
    const ctx = makeContext(chart, bars, series);

    const out = renderDonchian(ctx);

    expect(out.series).toHaveLength(3);
    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    for (const call of setDataCalls) {
      const data = call.args[2] as readonly unknown[];
      expect(data).toHaveLength(1);
    }
  });

  it("preserves the input bars array (does not mutate)", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const before = JSON.stringify(bars);
    renderDonchian(makeContext(chart, bars, series));
    expect(JSON.stringify(bars)).toBe(before);
  });

  it("preserves the input indicatorSeries (does not mutate)", () => {
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const before = JSON.stringify(series);
    renderDonchian(makeContext(chart, bars, series));
    expect(JSON.stringify(series)).toBe(before);
  });
});

// ============================================================================
// DONCHIAN_INDICATOR_NAME + DONCHIAN_COLORS public constants
// ============================================================================

describe("DONCHIAN_INDICATOR_NAME", () => {
  it("is the literal 'donchian' (the strategy-code contract)", () => {
    expect(DONCHIAN_INDICATOR_NAME).toBe("donchian");
  });
});

describe("DONCHIAN_COLORS", () => {
  it("defines a color for every key in DONCHIAN_SERIES_KEYS", () => {
    for (const key of DONCHIAN_SERIES_KEYS) {
      // The `as Record<string, string>` cast is for the test only
      // — `DONCHIAN_COLORS[key]` is statically known to return
      // `string`, but the linter flags dynamic-key access on the
      // typed `Readonly<Record<DonchianSeriesKey, string>>`. The
      // `?? ""` defensive default is for the (impossible) case
      // where the type is `undefined` despite the static guarantee;
      // it lets the test be self-consistent without a type cast.
      // eslint-disable-next-line security/detect-object-injection -- key is a closed union from DONCHIAN_SERIES_KEYS
      const color = (DONCHIAN_COLORS as Record<string, string>)[key] ?? "";
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });

  it("uses the yolk-gold for upper", () => {
    expect(DONCHIAN_COLORS.upper).toBe("#E3B563");
  });

  it("uses a muted slate for middle", () => {
    expect(DONCHIAN_COLORS.middle).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(DONCHIAN_COLORS.middle).not.toBe(DONCHIAN_COLORS.upper);
    expect(DONCHIAN_COLORS.middle).not.toBe(DONCHIAN_COLORS.lower);
  });

  it("uses a red for lower", () => {
    expect(DONCHIAN_COLORS.lower).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(DONCHIAN_COLORS.lower).not.toBe(DONCHIAN_COLORS.upper);
  });

  it("all three colors are distinct hex strings", () => {
    expect(new Set(Object.values(DONCHIAN_COLORS)).size).toBe(3);
  });
});

// ============================================================================
// IndicatorRegistry
// ============================================================================

describe("IndicatorRegistry", () => {
  it("register + get round-trips a renderer", () => {
    const registry = new IndicatorRegistry();
    const fn: IndicatorRenderer = () => ({
      name: "test",
      series: [],
      dispose: (): void => { /* test fixture — no-op */ },
    });
    registry.register("test", fn);
    expect(registry.get("test")).toBe(fn);
  });

  it("register overwrites an existing entry (no throw, no duplicate)", () => {
    const registry = new IndicatorRegistry();
    const fn1: IndicatorRenderer = () => ({
      name: "test-v1",
      series: [],
      dispose: (): void => { /* test fixture — no-op */ },
    });
    const fn2: IndicatorRenderer = () => ({
      name: "test-v2",
      series: [],
      dispose: (): void => { /* test fixture — no-op */ },
    });
    registry.register("test", fn1);
    registry.register("test", fn2);
    // The second register wins.
    expect(registry.get("test")).toBe(fn2);
    // And the registry has exactly one entry under that name.
    expect(registry.list()).toEqual(["test"]);
  });

  it("get returns undefined for an unknown name", () => {
    const registry = new IndicatorRegistry();
    expect(registry.get("nope")).toBeUndefined();
  });

  it("list() returns the registered names in sorted order", () => {
    const registry = new IndicatorRegistry();
    const fn: IndicatorRenderer = () => ({
      name: "x",
      series: [],
      dispose: (): void => { /* test fixture — no-op */ },
    });
    registry.register("zebra", fn);
    registry.register("alpha", fn);
    registry.register("mike", fn);
    expect(registry.list()).toEqual(["alpha", "mike", "zebra"]);
  });

  it("list() returns an empty array for a fresh registry", () => {
    const registry = new IndicatorRegistry();
    expect(registry.list()).toEqual([]);
  });

  it("list() returns a snapshot that can be mutated without affecting the registry", () => {
    const registry = new IndicatorRegistry();
    const fn: IndicatorRenderer = () => ({
      name: "x",
      series: [],
      dispose: (): void => { /* test fixture — no-op */ },
    });
    registry.register("a", fn);
    const snapshot = registry.list() as string[];
    snapshot.push("b");
    snapshot[0] = "mutated";
    // The registry's list is unchanged.
    expect(registry.list()).toEqual(["a"]);
  });

  it("has() returns true for registered names, false for unknown names", () => {
    const registry = new IndicatorRegistry();
    const fn: IndicatorRenderer = () => ({
      name: "x",
      series: [],
      dispose: (): void => { /* test fixture — no-op */ },
    });
    registry.register("donchian", fn);
    expect(registry.has("donchian")).toBe(true);
    expect(registry.has("unknown")).toBe(false);
  });

  it("has() returns false on a fresh registry", () => {
    const registry = new IndicatorRegistry();
    expect(registry.has("anything")).toBe(false);
  });

  it("the returned get() can be invoked as a renderer (full integration)", () => {
    const registry = new IndicatorRegistry();
    registry.register("donchian", renderDonchian);
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series = makeDonchianSeries(3);
    const ctx: IndicatorContext = {
      chart: chart as unknown as IChartApi,
      bars,
      indicatorSeries: series,
      color: "#000000",
      strategy: "donchian_pivot_composition",
      timeframe: "1h",
    };
    const renderer = registry.get("donchian");
    expect(renderer).not.toBeUndefined();
    if (renderer === undefined) return;
    const out = renderer(ctx);
    expect(out.series).toHaveLength(3);
    out.dispose();
    const removeCalls = chart.calls.filter((c) => c.method === "removeSeries");
    expect(removeCalls).toHaveLength(3);
  });

  it("multiple registries are independent (no shared state)", () => {
    const a = new IndicatorRegistry();
    const b = new IndicatorRegistry();
    const fn: IndicatorRenderer = () => ({
      name: "x",
      series: [],
      dispose: (): void => { /* test fixture — no-op */ },
    });
    a.register("a-only", fn);
    expect(a.has("a-only")).toBe(true);
    expect(b.has("a-only")).toBe(false);
  });
});
