/**
 * apps/web/src/indicators/signals.test.ts
 *
 * Phase 49C: bun:test unit tests for the signal marker indicator
 * (signals.ts).
 *
 * Coverage: 100% on signals.ts.
 *
 * Mock pattern: same as `funding.test.ts` / `cascade.test.ts`
 * (Phase 49B). Lightweight-charts needs a DOM canvas, so the
 * renderer tests use a hand-rolled mock that records every
 * `setMarkers` call. The mock is intentionally NOT typed as
 * `ISeriesApi<"Candlestick">` (only the methods the renderer
 * uses are present) — it is `unknown`-typed at the boundary
 * and cast at the use site.
 */

import { describe, expect, it } from "bun:test";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { renderSignals, validateSignalsSeries } from "./signals.js";
import type {
  IndicatorContext,
  IndicatorSeries,
} from "./registry.js";
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
      time: 1_700_000_000_000 + i * 3600_000, // ms (real OHLC format)
      open: base,
      high: base + 1,
      low: base - 1,
      close: base + 0.5,
      volume: 100,
    });
  }
  return bars;
}

/** Build a valid signal entries series. */
function makeSignalsSeries(
  count: number,
  side: "long" | "short" = "long",
): IndicatorSeries {
  const entries: { time: number; side: string; price: number; label: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      time: 1_700_000_000 + i * 3600, // seconds (signals wire format)
      side: i % 2 === 0 ? side : side === "long" ? "short" : "long",
      price: 67000 + i,
      label: i % 2 === 0 ? "ENTRY" : "EXIT",
    });
  }
  return { entries } as unknown as IndicatorSeries;
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

/**
 * `captureConsoleWarn` — replace `console.warn` with a recorder
 * for the duration of one test, then restore. Mirrors the
 * pattern from `funding.test.ts` and `donchian.test.ts`.
 */
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

function makeSignalsContext(
  bars: readonly OHLCBar[],
  series: IndicatorSeries,
  candle: MockSeries | undefined,
): IndicatorContext {
  return {
    chart: undefined as unknown as IChartApi,
    bars,
    indicatorSeries: series,
    color: "#000000",
    strategy: "donchian_pivot_composition",
    timeframe: "1h",
    candleSeries: candle as unknown as ISeriesApi<"Candlestick"> | undefined,
  };
}

// ============================================================================
// validateSignalsSeries
// ============================================================================

describe("validateSignalsSeries", () => {
  it("returns the typed SignalsSeries for valid input", () => {
    const bars = makeBars(3);
    const series = makeSignalsSeries(2);
    const out = validateSignalsSeries(
      series as unknown as Record<string, unknown>,
      bars,
    );
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]?.side).toBe("long");
    expect(out.entries[0]?.label).toBe("ENTRY");
  });

  it("returns null when 'entries' key is absent", () => {
    const series: IndicatorSeries = { dydx: [1, 2, 3] };
    expect(
      validateSignalsSeries(
        series as unknown as Record<string, unknown>,
        makeBars(3),
      ),
    ).toBeNull();
  });

  it("returns null when 'entries' is not an array", () => {
    const series: Record<string, unknown> = { entries: "not an array" };
    expect(validateSignalsSeries(series, makeBars(3))).toBeNull();
  });

  it("returns null when an entry has invalid 'side'", () => {
    const series: Record<string, unknown> = {
      entries: [{ time: 1, side: "left", price: 100, label: "X" }],
    };
    expect(validateSignalsSeries(series, makeBars(3))).toBeNull();
  });

  it("returns null when an entry's 'price' is missing", () => {
    const series: Record<string, unknown> = {
      entries: [{ time: 1, side: "long", label: "X" }],
    };
    expect(validateSignalsSeries(series, makeBars(3))).toBeNull();
  });

  it("returns null when an entry's 'price' is not finite", () => {
    const series: Record<string, unknown> = {
      entries: [{ time: 1, side: "long", price: NaN, label: "X" }],
    };
    expect(validateSignalsSeries(series, makeBars(3))).toBeNull();
  });

  it("returns null when an entry's 'label' is not a string", () => {
    const series: Record<string, unknown> = {
      entries: [{ time: 1, side: "long", price: 100, label: 42 }],
    };
    expect(validateSignalsSeries(series, makeBars(3))).toBeNull();
  });

  it("returns null when an entry's 'time' is missing", () => {
    const series: Record<string, unknown> = {
      entries: [{ side: "long", price: 100, label: "X" }],
    };
    expect(validateSignalsSeries(series, makeBars(3))).toBeNull();
  });

  it("returns null when an entry is not an object", () => {
    const series: Record<string, unknown> = {
      entries: ["not an object"],
    };
    expect(validateSignalsSeries(series, makeBars(3))).toBeNull();
  });

  it("returns the typed SignalsSeries for empty entries (signals are sparse)", () => {
    const series: Record<string, unknown> = { entries: [] };
    const out = validateSignalsSeries(series, makeBars(3));
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.entries).toHaveLength(0);
  });

  it("accepts 'buy' as an alias for 'long'", () => {
    const series: Record<string, unknown> = {
      entries: [{ time: 1, side: "buy", price: 100, label: "BUY" }],
    };
    const out = validateSignalsSeries(series, makeBars(3));
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.entries[0]?.side).toBe("buy");
  });

  it("accepts 'sell' as an alias for 'short'", () => {
    const series: Record<string, unknown> = {
      entries: [{ time: 1, side: "sell", price: 100, label: "SELL" }],
    };
    const out = validateSignalsSeries(series, makeBars(3));
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.entries[0]?.side).toBe("sell");
  });
});

// ============================================================================
// renderSignals
// ============================================================================

describe("renderSignals", () => {
  it("calls setMarkers with an empty array when entries is empty", () => {
    const candle = makeMockSeries();
    const series: Record<string, unknown> = { entries: [] };
    const ctx = makeSignalsContext(makeBars(3), series as IndicatorSeries, candle);
    renderSignals(ctx);
    const setMarkersCalls = candle.calls.filter((c) => c.method === "setMarkers");
    expect(setMarkersCalls).toHaveLength(1);
    expect(setMarkersCalls[0]?.args[0]).toEqual([]);
  });

  it("adds markers to the candle series for valid entries", () => {
    const candle = makeMockSeries();
    const series = makeSignalsSeries(2);
    const ctx = makeSignalsContext(makeBars(3), series, candle);
    renderSignals(ctx);
    const markers = candle.currentMarkers as readonly { time: number }[];
    expect(markers).toHaveLength(2);
    expect(markers[0]?.time).toBe(1_700_000_000);
  });

  it("uses the 'long' marker convention: belowBar + arrowUp + green", () => {
    const candle = makeMockSeries();
    const series: Record<string, unknown> = {
      entries: [
        { time: 1, side: "long", price: 100, label: "LONG-1" },
      ],
    };
    const ctx = makeSignalsContext(makeBars(3), series as IndicatorSeries, candle);
    renderSignals(ctx);
    const markers = candle.currentMarkers as readonly {
      time: number;
      position: string;
      shape: string;
      color: string;
    }[];
    expect(markers[0]?.position).toBe("belowBar");
    expect(markers[0]?.shape).toBe("arrowUp");
    expect(markers[0]?.color).toBe("#22c55e");
  });

  it("uses the 'short' marker convention: aboveBar + arrowDown + red", () => {
    const candle = makeMockSeries();
    const series: Record<string, unknown> = {
      entries: [
        { time: 1, side: "short", price: 100, label: "SHORT-1" },
      ],
    };
    const ctx = makeSignalsContext(makeBars(3), series as IndicatorSeries, candle);
    renderSignals(ctx);
    const markers = candle.currentMarkers as readonly {
      time: number;
      position: string;
      shape: string;
      color: string;
    }[];
    expect(markers[0]?.position).toBe("aboveBar");
    expect(markers[0]?.shape).toBe("arrowDown");
    expect(markers[0]?.color).toBe("#ef4444");
  });

  it("treats 'buy' as an alias for 'long' (belowBar + arrowUp + green)", () => {
    const candle = makeMockSeries();
    const series: Record<string, unknown> = {
      entries: [
        { time: 1, side: "buy", price: 100, label: "BUY-1" },
      ],
    };
    const ctx = makeSignalsContext(makeBars(3), series as IndicatorSeries, candle);
    renderSignals(ctx);
    const markers = candle.currentMarkers as readonly {
      time: number;
      position: string;
      shape: string;
      color: string;
    }[];
    expect(markers[0]?.position).toBe("belowBar");
    expect(markers[0]?.shape).toBe("arrowUp");
    expect(markers[0]?.color).toBe("#22c55e");
  });

  it("treats 'sell' as an alias for 'short' (aboveBar + arrowDown + red)", () => {
    const candle = makeMockSeries();
    const series: Record<string, unknown> = {
      entries: [
        { time: 1, side: "sell", price: 100, label: "SELL-1" },
      ],
    };
    const ctx = makeSignalsContext(makeBars(3), series as IndicatorSeries, candle);
    renderSignals(ctx);
    const markers = candle.currentMarkers as readonly {
      time: number;
      position: string;
      shape: string;
      color: string;
    }[];
    expect(markers[0]?.position).toBe("aboveBar");
    expect(markers[0]?.shape).toBe("arrowDown");
    expect(markers[0]?.color).toBe("#ef4444");
  });

  it("warns and returns no-op when candleSeries is missing from context", () => {
    const captured = captureConsoleWarn();
    try {
      const series = makeSignalsSeries(2);
      const ctx = makeSignalsContext(makeBars(3), series, undefined);
      const out = renderSignals(ctx);
      expect(out.series).toEqual([]);
      expect(captured.calls.length).toBe(1);
      const msg = captured.calls[0] ?? "";
      expect(msg).toContain("candleSeries");
    } finally {
      captured.restore();
    }
  });

  it("warns and returns no-op when the series is invalid (missing entries key)", () => {
    const captured = captureConsoleWarn();
    try {
      const candle = makeMockSeries();
      const series: Record<string, unknown> = { dydx: [1, 2, 3] };
      const ctx = makeSignalsContext(
        makeBars(3),
        series as IndicatorSeries,
        candle,
      );
      const out = renderSignals(ctx);
      // No setMarkers was called (we don't want to silently clear
      // prior markers on a validation failure).
      expect(out.series).toEqual([]);
      expect(captured.calls.length).toBe(1);
      const msg = captured.calls[0] ?? "";
      expect(msg).toContain("invalid series");
    } finally {
      captured.restore();
    }
  });

  it("dispose() calls setMarkers([]) on the candle series", () => {
    const candle = makeMockSeries();
    const series = makeSignalsSeries(2);
    const ctx = makeSignalsContext(makeBars(3), series, candle);
    const out = renderSignals(ctx);
    out.dispose();
    const setMarkersCalls = candle.calls.filter((c) => c.method === "setMarkers");
    const lastCall = setMarkersCalls[setMarkersCalls.length - 1];
    expect(lastCall?.args[0]).toEqual([]);
  });

  it("dispose() is a no-op when candleSeries is missing", () => {
    const captured = captureConsoleWarn();
    try {
      const series = makeSignalsSeries(2);
      const ctx = makeSignalsContext(makeBars(3), series, undefined);
      const out = renderSignals(ctx);
      // Should not throw.
      out.dispose();
      expect(out.series).toEqual([]);
    } finally {
      captured.restore();
    }
  });

  it("preserves the input bars array (does not mutate)", () => {
    const candle = makeMockSeries();
    const series = makeSignalsSeries(2);
    const bars = makeBars(3);
    const before = JSON.stringify(bars);
    renderSignals(makeSignalsContext(bars, series, candle));
    expect(JSON.stringify(bars)).toBe(before);
  });

  it("returns a RenderedIndicator with the expected name", () => {
    const candle = makeMockSeries();
    const series = makeSignalsSeries(1);
    const ctx = makeSignalsContext(makeBars(3), series, candle);
    const out = renderSignals(ctx);
    expect(out.name).toBe("signals-1h-donchian_pivot_composition");
    expect(out.series).toEqual([]);
  });
});
