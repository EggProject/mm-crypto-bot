/**
 * apps/web/src/indicators/funding.test.ts
 *
 * Phase 49B: bun:test unit tests for the funding-rate carry
 * indicator (funding.ts) + the cascade-event marker indicator
 * (cascade.ts).
 *
 * Coverage: 100% on funding.ts and cascade.ts.
 */

import { describe, expect, it } from "bun:test";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { renderFunding, validateFundingSeries } from "./funding.js";
import { renderCascade, validateCascadeSeries } from "./cascade.js";
import type { IndicatorContext, IndicatorSeries } from "./registry.js";
import type { OHLCBar } from "../lib/ohlc-bridge.js";

// ============================================================================
// Test helpers
// ============================================================================

/** Build N OHLC bars with a deterministic price pattern. */
function makeBars(n: number): readonly OHLCBar[] {
  const bars: OHLCBar[] = [];
  for (let i = 0; i < n; i += 1) {
    const base = 100 + i * 2;
    bars.push({
      time: 1_700_000_000 + i * 3600,
      open: base,
      high: base + 1,
      low: base - 1,
      close: base + 0.5,
      volume: 100,
    });
  }
  return bars;
}

/** Build a valid funding series (dydx, cex, spread all matching bars.length). */
function makeFundingSeries(
  n: number,
  baseValue = 0.0001,
): IndicatorSeries {
  return {
    dydx: Array.from({ length: n }, (_, i) => baseValue + i * 0.00001),
    cex: Array.from({ length: n }, (_, i) => baseValue + i * 0.00002),
    spread: Array.from({ length: n }, () => 0),
  };
}

/** Build a valid cascade events series. */
function makeCascadeSeries(
  count: number,
): IndicatorSeries {
  const events: { time: number; severity: number; side: "up" | "down" }[] = [];
  for (let i = 0; i < count; i += 1) {
    events.push({
      time: 1_700_000_000 + i * 3600,
      severity: 0.8,
      side: i % 2 === 0 ? "up" : "down",
    });
  }
  return { events } as unknown as IndicatorSeries;
}

interface MockSeries {
  calls: { method: string; args: unknown[] }[];
  setData: (data: unknown) => void;
  setMarkers: (markers: unknown) => void;
  currentMarkers: unknown;
  currentData: unknown;
}

function makeMockSeries(): MockSeries {
  const series: MockSeries = {
    calls: [],
    currentMarkers: null,
    currentData: null,
    setData: function (data: unknown): void {
      series.currentData = data;
      series.calls.push({ method: "setData", args: [data] });
    },
    setMarkers: function (markers: unknown): void {
      series.currentMarkers = markers;
      series.calls.push({ method: "setMarkers", args: [markers] });
    },
  };
  return series;
}

interface MockChart {
  series: MockSeries[];
  addLineSeries: (opts: unknown) => MockSeries;
  addHistogramSeries: (opts: unknown) => MockSeries;
  addSeries: (ctor: unknown, opts: unknown) => MockSeries;
  removeSeries: (s: MockSeries) => void;
}

function makeMockChart(): MockChart {
  const series: MockSeries[] = [];
  return {
    series,
    addLineSeries: function (_opts: unknown): MockSeries {
      const s = makeMockSeries();
      series.push(s);
      return s;
    },
    addHistogramSeries: function (_opts: unknown): MockSeries {
      const s = makeMockSeries();
      series.push(s);
      return s;
    },
    addSeries: function (_ctor: unknown, _opts: unknown): MockSeries {
      const s = makeMockSeries();
      series.push(s);
      return s;
    },
    removeSeries: function (s: MockSeries): void {
      const idx = series.indexOf(s);
      if (idx >= 0) series.splice(idx, 1);
    },
  };
}

function makeFundingContext(
  bars: readonly OHLCBar[],
  series: IndicatorSeries,
): IndicatorContext {
  const chart = makeMockChart();
  return {
    chart: chart as unknown as IChartApi,
    bars,
    indicatorSeries: series,
    color: "#000000",
    strategy: "dydx_cex_carry",
    timeframe: "1h",
  };
}

function makeCascadeContext(
  bars: readonly OHLCBar[],
  series: IndicatorSeries,
  candle: MockSeries | undefined,
): IndicatorContext {
  return {
    chart: undefined as unknown as IChartApi,
    bars,
    indicatorSeries: series,
    color: "#000000",
    strategy: "cascade_fade",
    timeframe: "1h",
    candleSeries: candle as unknown as ISeriesApi<"Candlestick"> | undefined,
  };
}

// ============================================================================
// validateFundingSeries
// ============================================================================

describe("validateFundingSeries", () => {
  it("returns the typed FundingSeries for valid input", () => {
    const bars = makeBars(5);
    const series = makeFundingSeries(5);
    const out = validateFundingSeries(series, bars);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.dydx).toHaveLength(5);
    expect(out.cex).toHaveLength(5);
    expect(out.spread).toHaveLength(5);
  });

  it("returns null when 'dydx' key is absent", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = { cex: [1, 2, 3], spread: [0, 0, 0] };
    expect(validateFundingSeries(series, bars)).toBeNull();
  });

  it("returns null when 'cex' key is absent", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = { dydx: [1, 2, 3], spread: [0, 0, 0] };
    expect(validateFundingSeries(series, bars)).toBeNull();
  });

  it("returns null when 'spread' key is absent", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = { dydx: [1, 2, 3], cex: [1, 2, 3] };
    expect(validateFundingSeries(series, bars)).toBeNull();
  });

  it("returns null when array lengths differ", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      dydx: [1, 2, 3],
      cex: [1, 2], // length mismatch
      spread: [0, 0, 0],
    };
    expect(validateFundingSeries(series, bars)).toBeNull();
  });

  it("returns null when length doesn't match bars.length", () => {
    const bars = makeBars(5);
    const series: IndicatorSeries = {
      dydx: [1, 2, 3],
      cex: [1, 2, 3],
      spread: [0, 0, 0],
    };
    expect(validateFundingSeries(series, bars)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(validateFundingSeries({}, makeBars(0))).toBeNull();
  });
});

// ============================================================================
// renderFunding
// ============================================================================

describe("renderFunding", () => {
  it("returns no-op RenderedIndicator for empty bars", () => {
    const series = makeFundingSeries(0);
    const out = renderFunding(makeFundingContext(makeBars(0), series));
    expect(out.series).toHaveLength(0);
  });

  it("adds 2 line series + 1 histogram series for valid input", () => {
    const bars = makeBars(5);
    const series = makeFundingSeries(5);
    const ctx = makeFundingContext(bars, series);
    const out = renderFunding(ctx);
    // The public `series` is ISeriesApi<"Line">[] — only the 2 line
    // series. The histogram is held in a closure for dispose.
    expect(out.series).toHaveLength(2);
    // But the chart itself received 3 addSeries calls.
    const chart = ctx.chart as unknown as MockChart;
    expect(chart.series).toHaveLength(3);
    expect(out.name).toBe("funding-1h-dydx_cex_carry");
  });

  it("adds only 2 line series (no histogram) when 'spread' is missing", () => {
    const origWarn = console.warn;
    const captured: unknown[] = [];
    console.warn = (...args: unknown[]): void => {
      captured.push(args);
    };
    try {
      const bars = makeBars(3);
      const series: IndicatorSeries = { dydx: [1, 2, 3], cex: [1, 2, 3] };
      const out = renderFunding(makeFundingContext(bars, series));
      expect(out.series).toHaveLength(2);
      expect(captured.length).toBeGreaterThan(0);
    } finally {
      console.warn = origWarn;
    }
  });

  it("handles all-null values (empty line data)", () => {
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      dydx: [null, null, null],
      cex: [null, null, null],
      spread: [null, null, null],
    };
    const ctx = makeFundingContext(bars, series);
    const out = renderFunding(ctx);
    expect(out.series).toHaveLength(2);
  });

  it("dispose() removes all 3 series from the chart", () => {
    const bars = makeBars(3);
    const series = makeFundingSeries(3);
    const ctx = makeFundingContext(bars, series);
    const out = renderFunding(ctx);
    const chart = ctx.chart as unknown as MockChart;
    expect(chart.series).toHaveLength(3);
    out.dispose();
    expect(chart.series).toHaveLength(0);
  });

  it("preserves the input bars array (does not mutate)", () => {
    const bars = makeBars(3);
    const series = makeFundingSeries(3);
    const before = JSON.stringify(bars);
    renderFunding(makeFundingContext(bars, series));
    expect(JSON.stringify(bars)).toBe(before);
  });
});

// ============================================================================
// validateCascadeSeries
// ============================================================================

describe("validateCascadeSeries", () => {
  it("returns the typed CascadeSeries for valid input", () => {
    const bars = makeBars(3);
    const series = makeCascadeSeries(2);
    const out = validateCascadeSeries(series, bars);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.events).toHaveLength(2);
    expect(out.events[0]?.side).toBe("up");
  });

  it("returns null when 'events' key is absent", () => {
    const series: IndicatorSeries = { dydx: [1, 2, 3] };
    expect(validateCascadeSeries(series, makeBars(3))).toBeNull();
  });

  it("returns null when an event has invalid 'side'", () => {
    const series: IndicatorSeries = {
      events: [{ time: 1, severity: 0.5, side: "left" }],
    } as unknown as IndicatorSeries;
    expect(validateCascadeSeries(series, makeBars(3))).toBeNull();
  });

  it("returns null when an event's severity is out of [0, 1]", () => {
    const series: IndicatorSeries = {
      events: [{ time: 1, severity: 2, side: "up" }],
    } as unknown as IndicatorSeries;
    expect(validateCascadeSeries(series, makeBars(3))).toBeNull();
  });

  it("returns null when an event is not an object", () => {
    const series: IndicatorSeries = {
      events: ["not an object"],
    } as unknown as IndicatorSeries;
    expect(validateCascadeSeries(series, makeBars(3))).toBeNull();
  });

  it("returns the typed CascadeSeries for empty events (events are sparse)", () => {
    const series: IndicatorSeries = { events: [] } as unknown as IndicatorSeries;
    const out = validateCascadeSeries(series, makeBars(3));
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.events).toHaveLength(0);
  });
});

// ============================================================================
// renderCascade
// ============================================================================

describe("renderCascade", () => {
  it("calls setMarkers with an empty array when events is empty", () => {
    const candle = makeMockSeries();
    const series: IndicatorSeries = { events: [] } as unknown as IndicatorSeries;
    const ctx = makeCascadeContext(makeBars(3), series, candle);
    renderCascade(ctx);
    const setMarkersCalls = candle.calls.filter((c) => c.method === "setMarkers");
    expect(setMarkersCalls).toHaveLength(1);
    expect(setMarkersCalls[0]?.args[0]).toEqual([]);
  });

  it("adds markers to the candle series for valid events", () => {
    const candle = makeMockSeries();
    const series = makeCascadeSeries(2);
    const ctx = makeCascadeContext(makeBars(3), series, candle);
    renderCascade(ctx);
    const markers = candle.currentMarkers as readonly { time: number }[];
    expect(markers).toHaveLength(2);
    expect(markers[0]?.time).toBe(1_700_000_000);
  });

  it("uses the 'up' marker convention: arrowUp + aboveBar + red for large", () => {
    const candle = makeMockSeries();
    const series: IndicatorSeries = {
      events: [
        { time: 1, severity: 0.9, side: "up" },
        { time: 2, severity: 0.3, side: "up" },
      ],
    } as unknown as IndicatorSeries;
    const ctx = makeCascadeContext(makeBars(3), series, candle);
    renderCascade(ctx);
    const markers = candle.currentMarkers as readonly {
      time: number;
      position: string;
      shape: string;
      color: string;
    }[];
    expect(markers[0]?.position).toBe("aboveBar");
    expect(markers[0]?.shape).toBe("arrowUp");
    expect(markers[0]?.color).toBe("#ef4444");
    expect(markers[1]?.shape).toBe("circle");
  });

  it("uses the 'down' marker convention: arrowDown + belowBar + green for large", () => {
    const candle = makeMockSeries();
    const series: IndicatorSeries = {
      events: [
        { time: 1, severity: 0.9, side: "down" },
        { time: 2, severity: 0.3, side: "down" },
      ],
    } as unknown as IndicatorSeries;
    const ctx = makeCascadeContext(makeBars(3), series, candle);
    renderCascade(ctx);
    const markers = candle.currentMarkers as readonly {
      time: number;
      position: string;
      shape: string;
      color: string;
    }[];
    expect(markers[0]?.position).toBe("belowBar");
    expect(markers[0]?.shape).toBe("arrowDown");
    expect(markers[0]?.color).toBe("#22c55e");
    expect(markers[1]?.shape).toBe("circle");
  });

  it("warns and returns no-op when candleSeries is missing from context", () => {
    const origWarn = console.warn;
    const captured: unknown[] = [];
    console.warn = (...args: unknown[]): void => {
      captured.push(args);
    };
    try {
      const series = makeCascadeSeries(2);
      const ctx = makeCascadeContext(makeBars(3), series, undefined);
      const out = renderCascade(ctx);
      expect(out.series).toEqual([]);
      expect(captured.length).toBe(1);
      const msg = String(captured[0]);
      expect(msg).toContain("candleSeries");
    } finally {
      console.warn = origWarn;
    }
  });

  it("dispose() calls setMarkers([]) on the candle series", () => {
    const candle = makeMockSeries();
    const series = makeCascadeSeries(2);
    const ctx = makeCascadeContext(makeBars(3), series, candle);
    const out = renderCascade(ctx);
    out.dispose();
    const setMarkersCalls = candle.calls.filter((c) => c.method === "setMarkers");
    const lastCall = setMarkersCalls[setMarkersCalls.length - 1];
    expect(lastCall?.args[0]).toEqual([]);
  });

  it("preserves the input bars array (does not mutate)", () => {
    const candle = makeMockSeries();
    const series = makeCascadeSeries(2);
    const bars = makeBars(3);
    const before = JSON.stringify(bars);
    renderCascade(makeCascadeContext(bars, series, candle));
    expect(JSON.stringify(bars)).toBe(before);
  });
});
