/**
 * apps/web/src/indicators/__mocks__/lightweight-charts.ts
 *
 * Mock implementation of the lightweight-charts v5 chart API used
 * by the indicator renderers (`renderDonchian`, `renderBollinger`,
 * `renderDailyPivot`, `renderStrategyIndicators`). The renderers
 * receive an `IndicatorContext` with a `chart` field; in production
 * this is a real `IChartApi` from `lightweight-charts`, but in
 * unit tests we substitute a `MockChart` so the renderer can be
 * driven without a real browser canvas + WebGL context.
 *
 * The mock records every method call (`addSeries`, `setData`,
 * `removeSeries`, `remove`, `applyOptions`, etc.) so unit tests can
 * assert:
 *   - the renderer created the expected number of series
 *   - each series was fed the expected `setData` payload
 *   - the renderer's `dispose` callback removes every series
 *
 * **Why we mock this:** lightweight-charts is a browser-only
 * library (depends on canvas + WebGL). The renderers take a
 * `chart` as a parameter; passing a `MockChart` instance lets us
 * drive the renderer in `bun test` (a Node-only environment)
 * WITHOUT pulling in a real chart library. **The 100% unit
 * coverage target on the render functions was impossible without
 * this mock** — the renderers' only public side effect is calling
 * `chart.addSeries` / `series.setData` / `chart.removeSeries`,
 * and these are exactly the methods the mock records.
 *
 * **Test file pattern:**
 * ```ts
 * import { MockChart } from "./__mocks__/lightweight-charts.js";
 *
 * it("renders 3 Donchian lines", () => {
 *   const chart = new MockChart();
 *   const result = renderDonchian({
 *     chart,
 *     bars: makeBars(20),
 *     indicatorSeries: makeDonchianSeries(20),
 *     strategy: "donchian_pivot_composition",
 *     timeframe: "1h",
 *   });
 *   expect(chart.series.length).toBe(3);
 *   expect(chart.series[0].data.length).toBe(20);
 * });
 * ```
 */

import type { ISeriesApi, LineData } from "lightweight-charts";

/**
 * `MockLineSeries` — a stub for the `ISeriesApi<"Line">` returned
 * by `chart.addSeries(LineSeries, opts)`. Records `setData` /
 * `update` calls so unit tests can assert on the data that was
 * actually passed to the chart.
 */
export class MockLineSeries {
  /** The cumulative `setData` calls; the LAST one is the
   *  effective data (lightweight-charts's `setData` is a full
   *  replacement, not a merge). */
  public readonly setDataCalls: readonly LineData[][] = [];
  /** The cumulative `update` calls. */
  public readonly updateCalls: readonly LineData[] = [];
  /** Mock-only: the most recent `setData` payload. */
  public data: LineData[] = [];

  /** Mirror of `ISeriesApi<"Line">.setData(data)`. */
  setData(data: LineData[]): void {
    this.data = data;
    // We append to the array so tests can verify all calls (the
    // renderer may call `setData` more than once if it re-renders).
    (this.setDataCalls as LineData[][]).push(data);
  }

  /** Mirror of `ISeriesApi<"Line">.update(bar)`. */
  update(bar: LineData): void {
    this.data.push(bar);
    (this.updateCalls as LineData[]).push(bar);
  }

  /**
   * Mock-only: pretend to apply per-series options. The real
   * `ISeriesApi<"Line">.applyOptions(opts)` mutates the chart's
   * rendering, but we have no canvas to mutate — we just record
   * the call for assertion.
   */
  applyOptions(_opts: object): void {
    // no-op: the mock doesn't render
  }
}

/**
 * `MockChart` — a stub for the `IChartApi` injected into the
 * renderers via `IndicatorContext.chart`. Records `addSeries` /
 * `removeSeries` / `remove` calls so unit tests can assert on
 * the series that were created / destroyed.
 */
export class MockChart {
  /** The currently-attached series (in creation order). */
  public series: MockLineSeries[] = [];
  /** The series that were removed (in removal order). */
  public readonly removedSeries: MockLineSeries[] = [];
  /** Mock-only: the cumulative `addSeries` calls. */
  public readonly addSeriesCalls: readonly {
    lineSeries: unknown;
    opts: object;
  }[] = [];
  /** Mock-only: the cumulative `applyOptions` calls. */
  public readonly applyOptionsCalls: readonly object[] = [];
  /** Mock-only: `true` once `chart.remove()` was called. */
  public removed = false;

  /** Mirror of `IChartApi.addSeries(LineSeries, opts)`. The real
   *  v5 API returns the created series; we do the same. */
  addSeries(_lineSeries: unknown, opts: object): MockLineSeries {
    const series = new MockLineSeries();
    this.series.push(series);
    (this.addSeriesCalls as { lineSeries: unknown; opts: object }[]).push({
      lineSeries: _lineSeries,
      opts,
    });
    return series;
  }

  /** Mirror of `IChartApi.removeSeries(series)`. */
  removeSeries(series: MockLineSeries): void {
    const idx = this.series.indexOf(series);
    if (idx >= 0) {
      this.series.splice(idx, 1);
      this.removedSeries.push(series);
    }
  }

  /** Mirror of `IChartApi.remove()` — disposes the whole chart. */
  remove(): void {
    this.series = [];
    this.removed = true;
  }

  /** Mock-only: pretend to apply chart-wide options. */
  applyOptions(opts: object): void {
    (this.applyOptionsCalls as object[]).push(opts);
  }
}
