/**
 * apps/web/src/indicators/strategy-indicators.test.ts
 *
 * Phase 79 + 81: bun:test unit tests for the per-strategy
 * indicator registry. The 100% line + branch coverage target
 * applies to `strategy-indicators.ts`; the chart-card
 * integration is covered by the existing e2e suite.
 *
 * The tests are pure: no React, no DOM, no lightweight-charts.
 * The function under test takes a strategy name and returns the
 * per-strategy indicator set; the focus is the dispatch logic,
 * not the renderers (which are tested in their own files).
 *
 * Phase 81 changes: the 4 disabled strategies now have
 * strategy-specific indicators in addition to the universal
 * Donchian band. The new tests assert the ≥1 line + ≥1 marker
 * contract per disabled strategy.
 *
 * Phase 81 (Phase 82 coverage push): the unit tests now also
 * exercise the line + marker indicator renderers' INTERNAL
 * branches (pivotLineIndicator.render's empty-lineData short
 * circuit, makeSingleLineIndicator's missing-key + empty-lineData
 * branches, fundingPaidMarkerIndicator's `i % cadence !== 0`
 * continue, breakoutMarkerIndicator's `donchian === undefined`
 * defensive branch, the markersPlugin.setMarkers round-trip in
 * makeSimpleMarkerIndicator). These branches are otherwise
 * covered by e2e only when the chart-card exercises them, and
 * the e2e gap in the priority-5 files is exactly these renderer
 * branches — pushing the unit-test coverage to 100% on
 * strategy-indicators.ts is a Phase 82 mandate.
 */

import { describe, expect, it } from "bun:test";

import {
  STRATEGY_INDICATOR_SETS,
  UNIVERSAL_FALLBACK_SET,
  getStrategyIndicatorSet,
  type MarkerIndicator,
} from "./strategy-indicators.js";
import type { OHLCBar, ChartMarker } from "../lib/ohlc-bridge.js";
import type {
  IndicatorSeries,
  RenderedIndicator,
} from "./registry.js";
import type { IChartApi } from "lightweight-charts";

// ============================================================================
// Test fixtures
// ============================================================================

/** Build a 30-bar OHLC sequence at 1-minute spacing. */
function makeBars(count = 30): readonly OHLCBar[] {
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

// ============================================================================
// Mock chart (mirrors the pattern in donchian.test.ts)
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

interface MockMarkersPlugin {
  readonly setMarkersCalls: readonly unknown[][];
  setMarkers: (markers: readonly unknown[]) => void;
}

function makeMockMarkersPlugin(): MockMarkersPlugin {
  const setMarkersCalls: unknown[][] = [];
  return {
    setMarkersCalls,
    setMarkers: (markers: readonly unknown[]): void => {
      setMarkersCalls.push([...markers]);
    },
  };
}

// ============================================================================
// STRATEGY_INDICATOR_SETS registry tests
// ============================================================================

describe("STRATEGY_INDICATOR_SETS", () => {
  it("registers all 5 strategies from the bot config", () => {
    const names = Object.keys(STRATEGY_INDICATOR_SETS);
    expect(names).toContain("donchian_pivot_composition");
    expect(names).toContain("dydx_cex_carry");
    expect(names).toContain("cascade_fade");
    expect(names).toContain("funding_flip_kill_switch");
    expect(names).toContain("regime_detector");
  });

  it("the ENABLED strategy (donchian_pivot_composition) has 4 line indicators + 1 marker indicator (Phase 81: +Bollinger, +daily_pivot)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    expect(set).toBeDefined();
    // Phase 79 had 2 lines (donchian + pivot). Phase 81 added 2
    // more (bollinger + daily_pivot) for a total of 4.
    expect(set?.lines.length).toBe(4);
    expect(set?.markers.length).toBe(1);
    // The four lines are: Donchian band + rolling pivot + Bollinger
    // band + daily pivot.
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).toContain("donchian");
    expect(lineNames).toContain("pivot");
    expect(lineNames).toContain("bollinger");
    expect(lineNames).toContain("daily_pivot");
    // The marker is the breakout signal.
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("breakout_signals");
  });

  // -------------------------------------------------------------------------
  // Phase 81: the 4 disabled strategies now have strategy-specific
  // indicators in addition to the universal Donchian band. Each
  // disabled strategy MUST have at least 1 line OR at least 1 marker
  // that is strategy-specific (not the universal Donchian).
  // -------------------------------------------------------------------------

  it("dydx_cex_carry has the funding rate + funding spread + funding-paid markers (Phase 82: dropped Donchian — irrelevant to a carry strategy)", () => {
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    expect(set).toBeDefined();
    // Phase 82: the Donchian band is DROPPED — a carry strategy
    // doesn't trade channel breakouts, so the channel envelope
    // is visual noise. 2 lines: funding_rate, funding_spread.
    expect(set?.lines.length).toBe(2);
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).not.toContain("donchian");
    expect(lineNames).toContain("funding_rate");
    expect(lineNames).toContain("funding_spread");
    // 1 marker: funding_paid
    expect(set?.markers.length).toBe(1);
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("funding_paid");
  });

  it("cascade_fade has the Donchian band + cascade event markers", () => {
    const set = STRATEGY_INDICATOR_SETS["cascade_fade"];
    expect(set).toBeDefined();
    // 1 line: donchian
    expect(set?.lines.length).toBe(1);
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).toEqual(["donchian"]);
    // 1 marker: cascade_events
    expect(set?.markers.length).toBe(1);
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("cascade_events");
  });

  it("funding_flip_kill_switch has the funding rate + funding-flip markers (Phase 82: dropped Donchian — irrelevant to a flip strategy)", () => {
    const set = STRATEGY_INDICATOR_SETS["funding_flip_kill_switch"];
    expect(set).toBeDefined();
    // Phase 82: the Donchian band is DROPPED — a funding-flip
    // strategy doesn't trade channel breakouts, so the channel
    // envelope is visual noise. 1 line: funding_rate.
    expect(set?.lines.length).toBe(1);
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).not.toContain("donchian");
    expect(lineNames).toContain("funding_rate");
    // 1 marker: funding_flips
    expect(set?.markers.length).toBe(1);
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("funding_flips");
  });

  it("regime_detector has the Donchian band + regime-change markers", () => {
    const set = STRATEGY_INDICATOR_SETS["regime_detector"];
    expect(set).toBeDefined();
    // 1 line: donchian
    expect(set?.lines.length).toBe(1);
    const lineNames = set?.lines.map((l) => l.name) ?? [];
    expect(lineNames).toEqual(["donchian"]);
    // 1 marker: regime_changes
    expect(set?.markers.length).toBe(1);
    const markerNames = set?.markers.map((m) => m.name) ?? [];
    expect(markerNames).toContain("regime_changes");
  });

  it("every disabled strategy has ≥1 line AND ≥1 marker (the Phase 81 mandate)", () => {
    for (const name of [
      "dydx_cex_carry",
      "cascade_fade",
      "funding_flip_kill_switch",
      "regime_detector",
    ] as const) {
      // eslint-disable-next-line security/detect-object-injection -- `name` is from a const-tuple literal above
      const set = STRATEGY_INDICATOR_SETS[name];
      expect(set).toBeDefined();
      // The user mandate: each disabled strategy must show its
      // SPECIFIC drawings. Lines alone (universal Donchian band)
      // are not enough; markers alone are not enough. The
      // strategy must have at least one line AND at least one
      // marker.
      expect(set?.lines.length).toBeGreaterThanOrEqual(1);
      expect(set?.markers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("each registered StrategyIndicatorSet has a non-empty description", () => {
    for (const name of Object.keys(STRATEGY_INDICATOR_SETS)) {
      // eslint-disable-next-line security/detect-object-injection -- name is a key from the registry
      const set = STRATEGY_INDICATOR_SETS[name];
      expect(set).toBeDefined();
      expect(typeof set?.description).toBe("string");
      expect((set?.description ?? "").length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// getStrategyIndicatorSet
// ============================================================================

describe("getStrategyIndicatorSet", () => {
  it("returns the registered set for a known strategy", () => {
    const set = getStrategyIndicatorSet("donchian_pivot_composition");
    expect(set.strategy).toBe("donchian_pivot_composition");
    expect(set.lines.length).toBe(4);
    expect(set.markers.length).toBe(1);
  });

  it("returns the universal fallback for an unknown strategy", () => {
    const set = getStrategyIndicatorSet("not_a_real_strategy_xyz");
    // The fallback is a SHARED object — same reference across
    // calls — so a misuse (mutating it) would corrupt every
    // unknown-strategy chart. The test asserts identity to make
    // the contract explicit.
    expect(set).toBe(UNIVERSAL_FALLBACK_SET);
    expect(set.strategy).toBe("unknown");
    expect(set.lines.length).toBe(1);
    expect(set.markers.length).toBe(0);
  });

  it("returns the universal fallback for an empty string (defensive)", () => {
    const set = getStrategyIndicatorSet("");
    expect(set).toBe(UNIVERSAL_FALLBACK_SET);
  });

  it("returns the registered set for each of the 5 strategies (no mismatches)", () => {
    for (const name of Object.keys(STRATEGY_INDICATOR_SETS)) {
      const set = getStrategyIndicatorSet(name);
      expect(set.strategy).toBe(name);
    }
  });
});

// ============================================================================
// Line indicator .compute methods
// ============================================================================

describe("line indicators — compute() round-trips", () => {
  it("donchianLineIndicator.compute returns upper/middle/lower arrays of length bars.length", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const donchian = set?.lines.find((l) => l.name === "donchian");
    expect(donchian).toBeDefined();
    if (donchian === undefined) return;
    const bars = makeBars(10);
    const result = donchian.compute(bars);
    expect(result.upper).toBeDefined();
    expect(result.middle).toBeDefined();
    expect(result.lower).toBeDefined();
    expect(result.upper.length).toBe(10);
    expect(result.middle.length).toBe(10);
    expect(result.lower.length).toBe(10);
  });

  it("pivotLineIndicator.compute returns pp/r1/r2/s1/s2 (5 keys)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const pivot = set?.lines.find((l) => l.name === "pivot");
    expect(pivot).toBeDefined();
    if (pivot === undefined) return;
    const bars = makeBars(5);
    const result = pivot.compute(bars);
    expect(result.pp).toBeDefined();
    expect(result.r1).toBeDefined();
    expect(result.r2).toBeDefined();
    expect(result.s1).toBeDefined();
    expect(result.s2).toBeDefined();
  });

  it("bollingerLineIndicator.compute returns upper/middle/lower of length bars.length", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const bollinger = set?.lines.find((l) => l.name === "bollinger");
    expect(bollinger).toBeDefined();
    if (bollinger === undefined) return;
    const bars = makeBars(30);
    const result = bollinger.compute(bars);
    expect(result.upper.length).toBe(30);
    expect(result.middle.length).toBe(30);
    expect(result.lower.length).toBe(30);
  });

  it("dailyPivotLineIndicator.compute returns pp/r1/s1 of length bars.length", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const dailyPivot = set?.lines.find((l) => l.name === "daily_pivot");
    expect(dailyPivot).toBeDefined();
    if (dailyPivot === undefined) return;
    const bars = makeBars(5);
    const result = dailyPivot.compute(bars);
    expect(result.pp.length).toBe(5);
    expect(result.r1.length).toBe(5);
    expect(result.s1.length).toBe(5);
  });
});

// ============================================================================
// Line indicator .render methods
// ============================================================================

describe("line indicators — render() happy path", () => {
  it("donchianLineIndicator.render delegates to renderDonchian (3 line series + name + dispose)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const donchian = set?.lines.find((l) => l.name === "donchian");
    if (donchian === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(5);
    const series = donchian.compute(bars);
    const out: RenderedIndicator = donchian.render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock chart is structurally compatible at the call site
      chart as any,
      bars,
      series,
      "donchian_pivot_composition",
      "1h",
    );
    expect(out.series).toHaveLength(3);
    expect(out.name).toBe("donchian-1h-donchian_pivot_composition");
    out.dispose();
    const removeCalls = chart.calls.filter((c) => c.method === "removeSeries");
    expect(removeCalls).toHaveLength(3);
  });

  it("bollingerLineIndicator.render delegates to renderBollinger (3 line series + name + dispose)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const bollinger = set?.lines.find((l) => l.name === "bollinger");
    if (bollinger === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(30);
    const series = bollinger.compute(bars);
    const out = bollinger.render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock chart is structurally compatible at the call site
      chart as any,
      bars,
      series,
      "donchian_pivot_composition",
      "1h",
    );
    expect(out.series).toHaveLength(3);
    expect(out.name).toBe("bollinger-1h-donchian_pivot_composition");
    out.dispose();
  });

  it("dailyPivotLineIndicator.render delegates to renderDailyPivot (Phase 82: 0 line series — 3 price lines on candle series + name + dispose)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const dailyPivot = set?.lines.find((l) => l.name === "daily_pivot");
    if (dailyPivot === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(5);
    const series = dailyPivot.compute(bars);
    // Phase 82: the renderer now needs a candle series to
    // create price lines. We mock it as a no-op placeholder
    // for this test (the unit-test suite for `renderDailyPivot`
    // itself in `daily-pivot.test.ts` has a richer mock).
    const out = dailyPivot.render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock chart is structurally compatible at the call site
      chart as any,
      bars,
      series,
      "donchian_pivot_composition",
      "1h",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no candle series in this minimal unit test
      undefined as any,
    );
    // No line series are added (price lines live on the candle
    // series, which is not present in this minimal test).
    expect(out.series).toHaveLength(0);
    expect(out.name).toBe("daily_pivot-1h-donchian_pivot_composition");
    // Dispose must not throw.
    expect(() => out.dispose()).not.toThrow();
  });
});

// ============================================================================
// pivotLineIndicator.render — internal branches
// ============================================================================

describe("pivotLineIndicator.render — internal branches", () => {
  it("adds 1 line series when pp values are present (the happy path)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const pivot = set?.lines.find((l) => l.name === "pivot");
    if (pivot === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(5);
    // Build a minimal IndicatorSeries with a pp key of finite numbers.
    const series: IndicatorSeries = {
      pp: [10, 11, 12, 13, 14],
      r1: [],
      r2: [],
      s1: [],
      s2: [],
    };
    const out = pivot.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "donchian_pivot_composition",
      "1h",
    );
    expect(out.series).toHaveLength(1);
    expect(out.name).toBe("pivot-1h-donchian_pivot_composition");
    // The line series should have the dashed-slate style.
    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    expect(addSeriesCalls[0]?.args[1]).toMatchObject({
      color: "#5C6981",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    out.dispose();
  });

  it("returns a no-op empty RenderedIndicator when pp is present but all values are null (the lineData short-circuit)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const pivot = set?.lines.find((l) => l.name === "pivot");
    if (pivot === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(5);
    // pp is present but ALL values are null → the for-loop's
    // `v === null` continue fires for every i → lineData is
    // empty → the short-circuit at `if (lineData.length === 0)`
    // fires (line 210). This covers the empty-RenderedIndicator
    // branch without relying on the series-shortness bug.
    const series: IndicatorSeries = {
      pp: [null, null, null, null, null],
    };
    const out = pivot.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "donchian_pivot_composition",
      "1h",
    );
    expect(out.series).toHaveLength(0);
    expect(out.name).toBe("pivot-1h-donchian_pivot_composition");
    // No addSeries call was made (the short-circuit fired).
    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    expect(addSeriesCalls).toHaveLength(0);
    // The dispose is a no-op (no series to remove).
    expect(() => out.dispose()).not.toThrow();
  });

  it("returns empty series when pp is undefined in the series and bars is empty (the ?? [] fallback short-circuit)", () => {
    // With an empty bars array, the for-loop doesn't run, so
    // lineData stays empty regardless of the series content.
    // The `series["pp"] ?? []` fallback is exercised AND the
    // `lineData.length === 0` short-circuit fires.
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const pivot = set?.lines.find((l) => l.name === "pivot");
    if (pivot === undefined) return;
    const chart = makeMockChart();
    const bars: readonly OHLCBar[] = [];
    // Empty object (no pp key) → `series["pp"] ?? []` → [] → empty.
    const series: IndicatorSeries = {};
    const out = pivot.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "donchian_pivot_composition",
      "1h",
    );
    expect(out.series).toHaveLength(0);
  });

  it("filters null values out of the line data (the `v === null` continue branch)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const pivot = set?.lines.find((l) => l.name === "pivot");
    if (pivot === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(4);
    // pp has 1 null in the middle → only 3 points reach the chart.
    const series: IndicatorSeries = {
      pp: [10, null, 12, 13],
    };
    pivot.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "donchian_pivot_composition",
      "1h",
    );
    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    const data = setDataCalls[0]?.args[2] as readonly { time: number; value: number }[];
    expect(data).toHaveLength(3);
    expect(data[0]?.value).toBe(10);
    expect(data[1]?.value).toBe(12);
    expect(data[2]?.value).toBe(13);
  });

  it("converts bar.time from ms to seconds (UNIX seconds for the lightweight-charts v5 contract)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const pivot = set?.lines.find((l) => l.name === "pivot");
    if (pivot === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(2);
    const series: IndicatorSeries = {
      pp: [100, 101],
    };
    pivot.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "donchian_pivot_composition",
      "1h",
    );
    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    const data = setDataCalls[0]?.args[2] as readonly { time: number; value: number }[];
    // bar[0].time = 1_700_000_000_000 ms → 1_700_000_000 s.
    expect(data[0]?.time).toBe(1_700_000_000);
    expect(data[1]?.time).toBe(1_700_000_060);
  });
});

// ============================================================================
// makeSingleLineIndicator — fundingRate, fundingSpread factories
// ============================================================================

describe("makeSingleLineIndicator — the factory used by fundingRate + fundingSpread", () => {
  it("adds 1 line series with the configured color + line style + line width", () => {
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingRate = set?.lines.find((l) => l.name === "funding_rate");
    if (fundingRate === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(5);
    // computeFundingRateFromBars returns an IndicatorSeries with a
    // "funding" key. We mock it with a hand-built series.
    const series: IndicatorSeries = {
      funding: [0.01, 0.02, 0.015, 0.012, 0.018],
    };
    const out = fundingRate.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "dydx_cex_carry",
      "1h",
    );
    expect(out.series).toHaveLength(1);
    expect(out.name).toBe("funding_rate-1h-dydx_cex_carry");
    // The sapphire color + solid line (lineStyle=0).
    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    expect(addSeriesCalls[0]?.args[1]).toMatchObject({
      color: "#4F7BEE",
      lineWidth: 1,
      lineStyle: 0,
    });
    out.dispose();
  });

  it("adds 1 line series with the funding-spread gold color", () => {
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingSpread = set?.lines.find((l) => l.name === "funding_spread");
    if (fundingSpread === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(5);
    const series: IndicatorSeries = {
      spread: [0.001, 0.002, 0.0015, 0.0012, 0.0018],
    };
    const out = fundingSpread.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "dydx_cex_carry",
      "1h",
    );
    expect(out.series).toHaveLength(1);
    expect(out.name).toBe("funding_spread-1h-dydx_cex_carry");
    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    expect(addSeriesCalls[0]?.args[1]).toMatchObject({
      color: "#E3B563",
    });
  });

  it("returns an empty RenderedIndicator when the series is missing the expected key (defensive fallback, all-null values)", () => {
    // The factory's `Object.prototype.hasOwnProperty.call(rec, seriesKey)`
    // check returns false when the key is absent; the `?? []` then yields
    // an empty array → the lineData.length === 0 short-circuit fires
    // (provided the bars are also all-null so the loop pushes nothing).
    // We use empty bars to guarantee the short-circuit.
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingRate = set?.lines.find((l) => l.name === "funding_rate");
    if (fundingRate === undefined) return;
    const chart = makeMockChart();
    const bars: readonly OHLCBar[] = [];
    // No "funding" key — only "garbage".
    const series: IndicatorSeries = { garbage: [1, 2, 3] };
    const out = fundingRate.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "dydx_cex_carry",
      "1h",
    );
    expect(out.series).toHaveLength(0);
    // No addSeries call was made.
    const addSeriesCalls = chart.calls.filter((c) => c.method === "addSeries");
    expect(addSeriesCalls).toHaveLength(0);
  });

  it("returns an empty RenderedIndicator when the funding key is present but all values are null (the lineData short-circuit)", () => {
    // When `values` is `[null, null, null]` and bars is non-empty,
    // the for-loop's `v === null` continue fires for every i →
    // lineData is empty → the short-circuit fires.
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingRate = set?.lines.find((l) => l.name === "funding_rate");
    if (fundingRate === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      funding: [null, null, null],
    };
    const out = fundingRate.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "dydx_cex_carry",
      "1h",
    );
    expect(out.series).toHaveLength(0);
  });

  it("returns an empty RenderedIndicator when all values are null (no lineData points)", () => {
    // The `lineData.length === 0` branch fires when every value is null
    // — same short-circuit as the missing-key case.
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingRate = set?.lines.find((l) => l.name === "funding_rate");
    if (fundingRate === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      funding: [null, null, null],
    };
    const out = fundingRate.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "dydx_cex_carry",
      "1h",
    );
    expect(out.series).toHaveLength(0);
  });

  it("filters null values out of the lineData (the `v === null` continue branch)", () => {
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingRate = set?.lines.find((l) => l.name === "funding_rate");
    if (fundingRate === undefined) return;
    const chart = makeMockChart();
    const bars = makeBars(4);
    const series: IndicatorSeries = {
      funding: [0.01, null, 0.02, 0.03],
    };
    fundingRate.render(
      chart as unknown as IChartApi,
      bars,
      series,
      "dydx_cex_carry",
      "1h",
    );
    const setDataCalls = chart.calls.filter((c) => c.method === "setData");
    const data = setDataCalls[0]?.args[2] as readonly { time: number; value: number }[];
    expect(data).toHaveLength(3);
    expect(data[0]?.value).toBe(0.01);
    expect(data[1]?.value).toBe(0.02);
    expect(data[2]?.value).toBe(0.03);
  });
});

// ============================================================================
// breakoutMarkerIndicator — compute + apply
// ============================================================================

describe("breakoutMarkerIndicator — compute() + apply()", () => {
  it("compute returns empty when prior['donchian'] is undefined (defensive)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const breakout = set?.markers.find((m) => m.name === "breakout_signals");
    if (breakout === undefined) return;
    const bars = makeBars(5);
    // Empty prior — the `donchian === undefined` branch fires.
    const result = breakout.compute(bars, {});
    expect(result).toEqual([]);
  });

  it("compute returns the breakout signals when prior['donchian'] is present", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const breakout = set?.markers.find((m) => m.name === "breakout_signals");
    if (breakout === undefined) return;
    const bars = makeBars(5);
    // Minimal IndicatorSeries with upper/middle/lower keys. The
    // breakout-signal logic just needs the upper/lower to detect
    // the cross.
    const prior: Readonly<Record<string, IndicatorSeries>> = {
      "donchian": {
        upper: [110, 110, 110, 110, 110],
        middle: [100, 100, 100, 100, 100],
        lower: [90, 90, 90, 90, 90],
      } as IndicatorSeries,
    };
    const result = breakout.compute(bars, prior);
    // The exact count depends on the breakout logic — we just
    // assert it's a readonly array.
    expect(Array.isArray(result)).toBe(true);
  });

  it("apply calls markersPlugin.setMarkers with the toSeriesMarkerMs-converted markers", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const breakout = set?.markers.find((m) => m.name === "breakout_signals");
    if (breakout === undefined) return;
    const plugin = makeMockMarkersPlugin();
    const markers: readonly ChartMarker[] = [
      {
        time: 1_700_000_000_000,
        position: "belowBar",
        color: "#22c55e",
        shape: "arrowUp",
        text: "L",
      },
    ];
    const dispose = breakout.apply(
      plugin as unknown as Parameters<MarkerIndicator["apply"]>[0],
      markers,
    );
    // The apply must have called setMarkers with 1 entry.
    expect(plugin.setMarkersCalls).toHaveLength(1);
    expect(plugin.setMarkersCalls[0]).toHaveLength(1);
    // The dispose clears the markers.
    dispose();
    expect(plugin.setMarkersCalls).toHaveLength(2);
    expect(plugin.setMarkersCalls[1]).toEqual([]);
  });

  it("apply works correctly with an empty markers array (no setMarkers items)", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const breakout = set?.markers.find((m) => m.name === "breakout_signals");
    if (breakout === undefined) return;
    const plugin = makeMockMarkersPlugin();
    const dispose = breakout.apply(
      plugin as unknown as Parameters<MarkerIndicator["apply"]>[0],
      [],
    );
    expect(plugin.setMarkersCalls).toHaveLength(1);
    expect(plugin.setMarkersCalls[0]).toEqual([]);
    dispose();
  });
});

// ============================================================================
// makeSimpleMarkerIndicator — the factory used by all 4 disabled strategies
// ============================================================================

describe("makeSimpleMarkerIndicator — the factory used by funding_paid, cascade_events, funding_flips, regime_changes", () => {
  it("apply calls setMarkers and dispose clears them (cascade_events)", () => {
    const set = STRATEGY_INDICATOR_SETS["cascade_fade"];
    const cascade = set?.markers.find((m) => m.name === "cascade_events");
    if (cascade === undefined) return;
    const plugin = makeMockMarkersPlugin();
    const markers: readonly ChartMarker[] = [
      {
        time: 1_700_000_000_000,
        position: "aboveBar",
        color: "#ef4444",
        shape: "arrowDown",
        text: "C",
      },
    ];
    const dispose = cascade.apply(
      plugin as unknown as Parameters<MarkerIndicator["apply"]>[0],
      markers,
    );
    expect(plugin.setMarkersCalls).toHaveLength(1);
    expect(plugin.setMarkersCalls[0]).toHaveLength(1);
    dispose();
    expect(plugin.setMarkersCalls).toHaveLength(2);
    expect(plugin.setMarkersCalls[1]).toEqual([]);
  });
});

// ============================================================================
// fundingPaidMarkerIndicator — the `i % cadence !== 0` continue branch
// ============================================================================

describe("fundingPaidMarkerIndicator — compute() funding-paid markers", () => {
  it("emits one marker every `cadence` bars (the i % cadence === 0 branch)", () => {
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingPaid = set?.markers.find((m) => m.name === "funding_paid");
    if (fundingPaid === undefined) return;
    const bars = makeBars(24);
    // prior with a funding_rate line (so the prior-branch is taken).
    const prior: Readonly<Record<string, IndicatorSeries>> = {
      "funding_rate": {
        funding: [0.01, 0.02, -0.01, 0.015, 0.012, 0.018, -0.005, 0.01,
                  0.02, -0.01, 0.015, 0.012, 0.018, -0.005, 0.01, 0.02,
                  -0.01, 0.015, 0.012, 0.018, -0.005, 0.01, 0.02, -0.01],
      } as IndicatorSeries,
    };
    const result = fundingPaid.compute(bars, prior);
    // Cadence is 8; bars 8, 16 emit (indices 8 and 16, since the loop
    // starts at i = 8 and only proceeds when i % 8 === 0).
    expect(result.length).toBe(2);
    expect(result[0]?.time).toBe(1_700_000_000_000 + 8 * 60_000);
    expect(result[1]?.time).toBe(1_700_000_000_000 + 16 * 60_000);
  });

  it("uses 'belowBar' + green when funding > 0 (the 'v > 0' branch)", () => {
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingPaid = set?.markers.find((m) => m.name === "funding_paid");
    if (fundingPaid === undefined) return;
    const bars = makeBars(9);
    const prior: Readonly<Record<string, IndicatorSeries>> = {
      "funding_rate": {
        funding: [0, 0, 0, 0, 0, 0, 0, 0, 0.05],
      } as IndicatorSeries,
    };
    const result = fundingPaid.compute(bars, prior);
    expect(result).toHaveLength(1);
    expect(result[0]?.position).toBe("belowBar");
    expect(result[0]?.color).toBe("#22c55e");
    expect(result[0]?.shape).toBe("circle");
    expect(result[0]?.text).toBe("");
  });

  it("uses 'aboveBar' + red when funding < 0 (the 'v > 0' false branch)", () => {
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingPaid = set?.markers.find((m) => m.name === "funding_paid");
    if (fundingPaid === undefined) return;
    // The fundingPaidMarkerIndicator looks up `prior["funding_rate"]`
    // (the LINE INDICATOR's output) and then reads its `funding` key.
    // We construct a prior with the correct structure so the test
    // exercises the prior-based branch (not the fallback compute).
    const bars = makeBars(9);
    const fundingLineSeries: IndicatorSeries = {
      funding: [0, 0, 0, 0, 0, 0, 0, 0, -0.05],
    };
    const prior: Record<string, IndicatorSeries> = {
      funding_rate: fundingLineSeries,
    };
    const result = fundingPaid.compute(
      bars,
      prior as Readonly<Record<string, IndicatorSeries>>,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.position).toBe("aboveBar");
    expect(result[0]?.color).toBe("#ef4444");
  });

  it("emits no markers when the bar count is below the cadence", () => {
    // The loop is `for (let i = cadence; i < bars.length; i += 1)` — with
    // cadence=8 and only 5 bars, the loop never runs.
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingPaid = set?.markers.find((m) => m.name === "funding_paid");
    if (fundingPaid === undefined) return;
    const bars = makeBars(5);
    const prior: Readonly<Record<string, IndicatorSeries>> = {
      "funding_rate": {
        funding: [0.01, 0.02, 0.03, 0.04, 0.05],
      } as IndicatorSeries,
    };
    const result = fundingPaid.compute(bars, prior);
    expect(result).toHaveLength(0);
  });

  it("falls back to computing the funding rate on the fly when prior is empty", () => {
    // The `prior["funding_rate"] ?? computeFundingRateFromBars(bars)` path
    // is taken when the prior doesn't have a funding_rate line. The result
    // is still a markers array (possibly empty if the computed funding is
    // all-null or the bars are too few).
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingPaid = set?.markers.find((m) => m.name === "funding_paid");
    if (fundingPaid === undefined) return;
    const bars = makeBars(20);
    const result = fundingPaid.compute(bars, {});
    expect(Array.isArray(result)).toBe(true);
  });

  it("filters null values out of the funding array (the `v === null` continue branch)", () => {
    // bar 8 is null → the corresponding marker is dropped. We use
    // the prior-based branch by constructing `prior["funding_rate"]`
    // with the funding line series.
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"];
    const fundingPaid = set?.markers.find((m) => m.name === "funding_paid");
    if (fundingPaid === undefined) return;
    const bars = makeBars(20);
    const funding: (number | null)[] = new Array(20).fill(0.01) as (number | null)[];
    funding[8] = null;
    const fundingLineSeries: IndicatorSeries = { funding };
    const prior: Record<string, IndicatorSeries> = {
      funding_rate: fundingLineSeries,
    };
    const result = fundingPaid.compute(
      bars,
      prior as Readonly<Record<string, IndicatorSeries>>,
    );
    // bar 8 is null → no marker for bar 8; bar 16 is 0.01 → marker for bar 16.
    expect(result).toHaveLength(1);
    expect(result[0]?.time).toBe(1_700_000_000_000 + 16 * 60_000);
  });
});

// ============================================================================
// cascadeMarkerIndicator — the cascade-events marker
// ============================================================================

describe("cascadeMarkerIndicator — compute() returns the cascade events", () => {
  it("returns a (possibly empty) markers array from the bar stream", () => {
    const set = STRATEGY_INDICATOR_SETS["cascade_fade"];
    const cascade = set?.markers.find((m) => m.name === "cascade_events");
    if (cascade === undefined) return;
    const bars = makeBars(30);
    const result = cascade.compute(bars, {});
    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================================================
// fundingFlipsMarkerIndicator — the funding-flips marker
// ============================================================================

describe("fundingFlipsMarkerIndicator — compute() returns the funding flips", () => {
  it("returns a (possibly empty) markers array from the bar stream + prior", () => {
    const set = STRATEGY_INDICATOR_SETS["funding_flip_kill_switch"];
    const flips = set?.markers.find((m) => m.name === "funding_flips");
    if (flips === undefined) return;
    const bars = makeBars(30);
    const prior: Readonly<Record<string, IndicatorSeries>> = {
      "funding_rate": {
        funding: new Array(30).fill(0.01) as (number | null)[],
      } as IndicatorSeries,
    };
    const result = flips.compute(bars, prior);
    expect(Array.isArray(result)).toBe(true);
  });

  it("falls back to computing the funding rate on the fly when prior is empty", () => {
    const set = STRATEGY_INDICATOR_SETS["funding_flip_kill_switch"];
    const flips = set?.markers.find((m) => m.name === "funding_flips");
    if (flips === undefined) return;
    const bars = makeBars(30);
    const result = flips.compute(bars, {});
    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================================================
// regimeChangeMarkerIndicator — the regime-changes marker
// ============================================================================

describe("regimeChangeMarkerIndicator — compute() returns the regime changes", () => {
  it("returns a (possibly empty) markers array from the bar stream", () => {
    const set = STRATEGY_INDICATOR_SETS["regime_detector"];
    const regime = set?.markers.find((m) => m.name === "regime_changes");
    if (regime === undefined) return;
    const bars = makeBars(30);
    const result = regime.compute(bars, {});
    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================================================
// UNIVERSAL_FALLBACK_SET — the default for unknown strategies
// ============================================================================

describe("UNIVERSAL_FALLBACK_SET", () => {
  it("has strategy === 'unknown' and 1 line + 0 markers", () => {
    expect(UNIVERSAL_FALLBACK_SET.strategy).toBe("unknown");
    expect(UNIVERSAL_FALLBACK_SET.lines).toHaveLength(1);
    expect(UNIVERSAL_FALLBACK_SET.markers).toHaveLength(0);
  });

  it("its single line is the Donchian band (the universal baseline)", () => {
    expect(UNIVERSAL_FALLBACK_SET.lines[0]?.name).toBe("donchian");
  });

  it("is the same reference across getStrategyIndicatorSet calls (shared object)", () => {
    const a = getStrategyIndicatorSet("__no_such_strategy__");
    const b = getStrategyIndicatorSet("__another_unknown__");
    expect(a).toBe(b);
    expect(a).toBe(UNIVERSAL_FALLBACK_SET);
  });
});

// ============================================================================
// Round-trip: register + render + dispose
// ============================================================================

describe("indicator lifecycle — compute → render → dispose", () => {
  it("the donchian_pivot_composition line indicators can be computed + rendered + disposed without throwing", () => {
    const set = STRATEGY_INDICATOR_SETS["donchian_pivot_composition"];
    const chart = makeMockChart();
    const bars = makeBars(30);
    for (const line of set.lines) {
      const series = line.compute(bars);
      const out = line.render(
        chart as unknown as IChartApi,
        bars,
        series,
        "donchian_pivot_composition",
        "1h",
      );
      // Every line indicator must produce a name with the format
      // `<name>-<timeframe>-<strategy>`.
      expect(out.name).toBe(`${line.name}-1h-donchian_pivot_composition`);
      // The dispose must not throw.
      expect(() => out.dispose()).not.toThrow();
    }
  });

  it("the disabled-strategy line indicators can be computed + rendered + disposed without throwing", () => {
    // 30 bars of input + 30 bars of bars; each disabled strategy's
    // line set must produce a valid RenderedIndicator.
    for (const name of [
      "dydx_cex_carry",
      "cascade_fade",
      "funding_flip_kill_switch",
      "regime_detector",
    ] as const) {
      // eslint-disable-next-line security/detect-object-injection -- name is a const-tuple literal
      const set = STRATEGY_INDICATOR_SETS[name];
      const chart = makeMockChart();
      const bars = makeBars(30);
      for (const line of set.lines) {
        const series = line.compute(bars);
        const out = line.render(
          chart as unknown as IChartApi,
          bars,
          series,
          name,
          "1h",
        );
        expect(out.name).toBe(`${line.name}-1h-${name}`);
        expect(() => out.dispose()).not.toThrow();
      }
    }
  });
});

// ============================================================================
// makeSingleLineIndicator — the no-op `dispose` closure (line 428)
// ============================================================================
//
// The factory's `makeSingleLineIndicator` returns one of TWO `dispose`
// closures depending on whether the line was actually added to the chart:
//   1. The post-addSeries `dispose` (line 448) → `chart.removeSeries(...)`
//   2. The no-op `dispose` (line 428) → no series was added, so nothing
//      to remove
// The post-add dispose is exercised by the lifecycle tests + the happy-path
// `fundingRate.render`/`fundingSpread.render` tests (when the series has
// non-null values, the for-loop pushes data points → post-add path).
// The no-op dispose is exercised here — when `lineData.length === 0`,
// the render returns the empty-RenderedIndicator branch and its `dispose`
// must be callable without throwing and without calling
// `chart.removeSeries`. The previous 50-test suite left this function
// uncovered (the three "empty" tests at lines 624, 650, 672 never called
// `out.dispose()` on the no-op closure).
describe("makeSingleLineIndicator — the no-op `dispose` closure (line 428)", () => {
  it("fundingRate.render returns the no-op `dispose` when the series is empty (no `funding` key + empty bars) — calling it does not throw and does not call removeSeries", () => {
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"]!;
    const fundingRate = set.lines.find((l) => l.name === "funding_rate")!;
    const chart = makeMockChart();
    // Empty bars + no `funding` key → `lineData` stays empty → the
    // `lineData.length === 0` short-circuit at line 424 returns the
    // no-op dispose (line 428).
    const out = fundingRate.render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock chart is structurally compatible at the call site
      chart as any,
      [],
      {} as IndicatorSeries,
      "dydx_cex_carry",
      "1h",
    );
    expect(out.series).toHaveLength(0);
    // Snapshot the removeSeries call count BEFORE the no-op dispose.
    const removeBefore = chart.calls.filter(
      (c) => c.method === "removeSeries",
    ).length;
    // The no-op dispose must run without throwing.
    expect(() => out.dispose()).not.toThrow();
    // The no-op dispose must NOT call `chart.removeSeries` (no series
    // was added → nothing to remove).
    const removeAfter = chart.calls.filter(
      (c) => c.method === "removeSeries",
    ).length;
    expect(removeAfter).toBe(removeBefore);
  });

  it("fundingSpread.render returns the no-op `dispose` when the series is present but all-null — calling it does not throw", () => {
    // Same branch as above but with a non-empty bars array — exercises
    // the `v === null` continue-skip path in the for-loop and confirms
    // the no-op dispose is the one returned.
    const set = STRATEGY_INDICATOR_SETS["dydx_cex_carry"]!;
    const fundingSpread = set.lines.find((l) => l.name === "funding_spread")!;
    const chart = makeMockChart();
    const bars = makeBars(3);
    const series: IndicatorSeries = {
      spread: [null, null, null],
    };
    const out = fundingSpread.render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock chart is structurally compatible at the call site
      chart as any,
      bars,
      series,
      "dydx_cex_carry",
      "1h",
    );
    expect(out.series).toHaveLength(0);
    const removeBefore = chart.calls.filter(
      (c) => c.method === "removeSeries",
    ).length;
    expect(() => out.dispose()).not.toThrow();
    const removeAfter = chart.calls.filter(
      (c) => c.method === "removeSeries",
    ).length;
    expect(removeAfter).toBe(removeBefore);
  });
});
