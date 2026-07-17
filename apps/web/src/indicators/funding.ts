/**
 * apps/web/src/indicators/funding.ts
 *
 * Phase 49B: the funding-rate carry indicator renderer.
 *
 * The dYdX-CEX carry strategy (state-feed strategy id
 * `dydx_cex_carry`) tracks the funding-rate spread between
 * a dYdX perpetual and a CEX (e.g. bybit) perpetual. The
 * state-feed computes the per-8h funding rates server-side
 * and ships them as an `INDICATOR` message:
 *
 *   {
 *     type: "INDICATOR",
 *     strategy: "dydx_cex_carry",
 *     symbol: "BTCUSDT",
 *     timeframe: "1h",
 *     series: {
 *       dydx:   [0.0001, 0.00012, 0.00011, ...],   // per 8h
 *       cex:    [0.00008, 0.00009, 0.0001, ...],   // per 8h
 *       spread: [0.00002, 0.00003, 0.00001, ...],  // dydx - cex
 *     }
 *   }
 *
 * The web client renders these as:
 *   - Two LINE series (dydx + cex), one per exchange
 *   - One HISTOGRAM series (the spread), color-coded by sign
 *     (green when dYdX is more expensive to hold, red when
 *     cheaper)
 *
 * **Color scheme (locked in `FUNDING_COLORS`):**
 *   - dydx line:        `#4F7BEE`  (sapphire)
 *   - cex line:         `#E3B563`  (yolk gold)
 *   - spread (+):       `#22c55e`  (green — dYdX is "expensive")
 *   - spread (-):       `#ef4444`  (red — dYdX is "cheap")
 *
 * The hex literals are inlined (not resolved from CSS variables)
 * so the renderer is deterministic in unit tests (which mock
 * `IChartApi` and have no real DOM) and so server-side rendering
 * (if/when added) is possible without a DOM. The CSS custom
 * properties `--ep-sapphire-500` / `--ep-yolk-500` etc. are
 * mirrored here; a future phase can add a CSS-var resolver for
 * live theme switching.
 *
 * **Deviation from the spec (documented):** the spec says the
 * "dydx line color" is `#4F7BEE` (sapphire). The eggproject
 * design system does ship `--ep-sapphire-500 = #4F7BEE` (the
 * design-token palette in `apps/web/src/styles/colors_and_type.css`),
 * so this is the first indicator in this directory whose primary
 * color IS in the design-token palette — no fallback substitution
 * needed. The cex gold `#E3B563` matches `--ep-yolk-500`, used
 * elsewhere by the Donchian upper band.
 */

import {
  HistogramSeries,
  LineSeries,
  type HistogramData,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";

import type { OHLCBar } from "../lib/ohlc-bridge.js";
import type {
  IndicatorContext,
  IndicatorRenderer,
  IndicatorSeries,
  RenderedIndicator,
} from "./registry.js";

// ============================================================================
// Public constants
// ============================================================================

/**
 * The funding indicator name as registered in `IndicatorRegistry`.
 *
 * The strategy code in `packages/strategies/dydx_cex_carry/`
 * references this exact string in its `INDICATOR` messages, so a
 * typo here would silently fail to render — keep in sync with
 * the strategy.
 */
export const FUNDING_INDICATOR_NAME = "funding" as const;

/**
 * The three named series the funding indicator produces.
 *
 * `dydx` + `cex` are line series (the absolute per-8h funding
 * rates on each exchange); `spread` is a histogram (the carry
 * — `dydx - cex`). Defined as a closed tuple so the renderer
 * can iterate them in a fixed order (dydx → cex → spread) — the
 * order matters for `RenderedIndicator.series` positional
 * indexing.
 */
export const FUNDING_SERIES_KEYS = ["dydx", "cex", "spread"] as const;
export type FundingSeriesKey = (typeof FUNDING_SERIES_KEYS)[number];

/**
 * Theme colors used by `renderFunding`.
 *
 * `dydx` and `cex` are the line series colors (one per exchange).
 * `spreadPositive` and `spreadNegative` are the histogram colors
 * — the renderer picks one per bar based on the spread's sign.
 * The renderer does NOT use a single histogram color and let
 * the histogram fade; the per-bar color is the convention
 * across the dashboard (matches `barToMarker` in
 * `apps/web/src/lib/ohlc-bridge.ts`).
 */
export const FUNDING_COLORS: Readonly<{
  readonly dydx: string;
  readonly cex: string;
  readonly spreadPositive: string;
  readonly spreadNegative: string;
}> = {
  dydx: "#4F7BEE", // sapphire — dYdX line
  cex: "#E3B563", // yolk gold — CEX line
  spreadPositive: "#22c55e", // green — dYdX more expensive
  spreadNegative: "#ef4444", // red — dYdX cheaper
} as const;

/**
 * The typed shape of a validated funding series.
 *
 * Every value is `number | null` (the `null` case is filtered
 * out by the renderer when building the `LineData[]` /
 * `HistogramData[]` arrays — see `renderFunding`).
 */
export interface FundingSeries extends IndicatorSeries {
  readonly dydx: readonly (number | null)[];
  readonly cex: readonly (number | null)[];
  readonly spread: readonly (number | null)[];
}

// ============================================================================
// validateFundingSeries
// ============================================================================

/**
 * `validateFundingSeries` — type-guard + structural validation.
 *
 * Returns the typed `FundingSeries` if valid, else `null`. The
 * caller is expected to log a warning and skip rendering when
 * `null` is returned.
 *
 * Validity rules:
 *   1. All three keys (`dydx`, `cex`, `spread`) must be present
 *      and their values must be arrays.
 *   2. All three arrays must have the same length.
 *   3. The shared length must equal `bars.length`.
 *   4. Each value in the arrays must be a `number` OR `null`.
 *
 * An empty input (all three keys present, all length 0) is
 * considered VALID — the renderer gracefully handles that case
 * (no data → empty `setData` call). The ChartCard is expected
 * to short-circuit the renderer call itself when
 * `bars.length === 0`.
 */
export function validateFundingSeries(
  series: IndicatorSeries,
  bars: readonly OHLCBar[],
): FundingSeries | null {
  // Defensive read — same pattern as `validateDonchianSeries`.
  // The bracket access is the only way to address a
  // `Record<string, _>` with a known string key; we silence the
  // dot-notation rule per line.
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const dydxRaw: unknown = (series as Record<string, unknown>)["dydx"];
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const cexRaw: unknown = (series as Record<string, unknown>)["cex"];
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const spreadRaw: unknown = (series as Record<string, unknown>)["spread"];

  // Rule 1: every key must be present and be an array.
  if (
    !Array.isArray(dydxRaw) ||
    !Array.isArray(cexRaw) ||
    !Array.isArray(spreadRaw)
  ) {
    return null;
  }
  const dydx = dydxRaw as readonly unknown[];
  const cex = cexRaw as readonly unknown[];
  const spread = spreadRaw as readonly unknown[];

  // Rule 4: every value must be a number or null.
  const allValues: readonly unknown[] = [...dydx, ...cex, ...spread];
  for (const v of allValues) {
    if (v !== null && typeof v !== "number") {
      return null;
    }
  }

  // Rule 2: the three arrays must have the same length.
  if (dydx.length !== cex.length || cex.length !== spread.length) {
    return null;
  }

  // Rule 3: the shared length must match `bars.length`.
  if (dydx.length !== bars.length) {
    return null;
  }

  return {
    dydx: dydx as readonly (number | null)[],
    cex: cex as readonly (number | null)[],
    spread: spread as readonly (number | null)[],
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Build the `LineData[]` for one of the line series (dydx or cex).
 *
 * The bar `time` is in UNIX milliseconds (the state-feed protocol);
 * lightweight-charts v5 wants `UTCTimestamp` (UNIX seconds). The
 * `/ 1000` conversion happens here, in the renderer, so the
 * indicator layer is the single source of truth for "indicators
 * speak ms, charts speak seconds" — the same conversion
 * `ChartCard.tsx` applies to the OHLC bars themselves.
 *
 * `null` values are dropped from the output array — lightweight-
 * charts rejects `null` in `LineData[].value` and would log a
 * warning, so the filter is defensive as well as correct.
 */
function buildLineData(
  bars: readonly OHLCBar[],
  values: readonly (number | null)[],
): LineData<UTCTimestamp>[] {
  const out: LineData<UTCTimestamp>[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    // `apps/web` does NOT enable `noUncheckedIndexedAccess`, so
    // `bars[i]` and `values[i]` are typed as `OHLCBar` and
    // `number | null` respectively (not `T | undefined`). The
    // `i` is a loop counter bounded by `bars.length`, not user
    // input — the `security/detect-object-injection` warning is
    // a false positive.
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bar = bars[i];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const v = values[i];
    if (v === null) continue;
    out.push({
      time: (bar.time / 1000) as UTCTimestamp,
      value: v,
    });
  }
  return out;
}

/**
 * Build the `HistogramData[]` for the spread series. The spread
 * is dydx - cex; the color depends on the sign:
 *   - `> 0` → `FUNDING_COLORS.spreadPositive` (green)
 *   - `< 0` → `FUNDING_COLORS.spreadNegative` (red)
 *   - `=== 0` → still emitted, with the negative color (a
 *     neutral fallback — the convention is that any non-positive
 *     value gets the "dYdX is cheap" color; the value is small
 *     and the visual emphasis is on the "moving" bars, not the
 *     zero crossing).
 *   - `null` → skipped.
 *
 * Each histogram bar gets a per-bar `color` so the renderer
 * doesn't need a "split histogram" lightweight-charts plugin;
 * the per-bar color is the v5-recommended way.
 */
function buildHistogramData(
  bars: readonly OHLCBar[],
  values: readonly (number | null)[],
): HistogramData<UTCTimestamp>[] {
  const out: HistogramData<UTCTimestamp>[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const bar = bars[i];
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const v = values[i];
    if (v === null) continue;
    out.push({
      time: (bar.time / 1000) as UTCTimestamp,
      value: v,
      color: v > 0 ? FUNDING_COLORS.spreadPositive : FUNDING_COLORS.spreadNegative,
    });
  }
  return out;
}

// ============================================================================
// renderFunding
// ============================================================================

/**
 * `renderFunding` — the `IndicatorRenderer` for the funding-rate carry.
 *
 * Adds 2 line series (dydx + cex) + 1 histogram (spread) to the
 * chart and returns a `RenderedIndicator` whose `dispose()`
 * removes them all from the chart. The renderer is pure (no
 * side effects on the registry); it only mutates the `chart`
 * instance it receives via context.
 *
 * **Graceful handling:**
 *   - Empty `bars` → no series are added, the returned
 *     `RenderedIndicator` has `series: []` and a no-op `dispose`.
 *   - Missing series (e.g. `dydx: undefined` in `indicatorSeries`)
 *     → `console.warn` is called, only the present series are added.
 *     The histogram requires `spread`; if `spread` is missing, the
 *     histogram is skipped (the two lines render without it).
 *   - `null` values inside a series → silently dropped from the
 *     `LineData[]` / `HistogramData[]` (the line/histogram just
 *     has a gap on the chart, which is the conventional way to
 *     render a partial funding series during a server restart).
 *
 * **Idempotency:** the renderer does NOT track prior state — the
 * caller is expected to call the previous `RenderedIndicator.dispose()`
 * before invoking the renderer again.
 */
export const renderFunding: IndicatorRenderer = (
  ctx: IndicatorContext,
): RenderedIndicator => {
  const { chart, bars, indicatorSeries, strategy, timeframe } = ctx;

  // Short-circuit: no bars → no series.
  if (bars.length === 0) {
    return {
      name: `funding-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: nothing to dispose when no series were added
      },
    };
  }

  // We build a heterogeneous list — the 2 line series (typed
  // `ISeriesApi<"Line">`) and the 1 histogram (typed
  // `ISeriesApi<"Histogram">`). The public
  // `RenderedIndicator.series` is `ISeriesApi<"Line">[]`, so the
  // histogram is held separately and disposed via the captured
  // local var, NOT exposed in the public array. The return value
  // exposes only the line series (the convention the
  // IndicatorRegistry documents; the chart card's primary
  // indicator-rendering path is line-series centric, the
  // histogram is a secondary "decorator" with its own lifecycle).
  const lines: ISeriesApi<"Line">[] = [];
  let histogram: ISeriesApi<"Histogram"> | undefined;

  // --- dydx line ---
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string from closed union
  const dydxRaw: unknown = (indicatorSeries as Record<string, unknown>)["dydx"];
  if (Array.isArray(dydxRaw)) {
    const dydxLine = chart.addSeries(LineSeries, {
      color: FUNDING_COLORS.dydx,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    dydxLine.setData(
      buildLineData(bars, dydxRaw as readonly (number | null)[]),
    );
    lines.push(dydxLine);
  } else {
    console.warn(
      `[renderFunding] missing 'dydx' series for ${strategy}@${timeframe} — skipping`,
    );
  }

  // --- cex line ---
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string from closed union
  const cexRaw: unknown = (indicatorSeries as Record<string, unknown>)["cex"];
  if (Array.isArray(cexRaw)) {
    const cexLine = chart.addSeries(LineSeries, {
      color: FUNDING_COLORS.cex,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    cexLine.setData(
      buildLineData(bars, cexRaw as readonly (number | null)[]),
    );
    lines.push(cexLine);
  } else {
    console.warn(
      `[renderFunding] missing 'cex' series for ${strategy}@${timeframe} — skipping`,
    );
  }

  // --- spread histogram ---
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string from closed union
  const spreadRaw: unknown = (indicatorSeries as Record<string, unknown>)["spread"];
  if (Array.isArray(spreadRaw)) {
    histogram = chart.addSeries(HistogramSeries, {
      // Default color (used when a bar doesn't override via per-bar
      // `color`). The per-bar `color` in `buildHistogramData`
      // overrides this for non-zero values; the default applies
      // for any "no data" rendering the chart engine might do.
      color: FUNDING_COLORS.spreadNegative,
      priceFormat: { type: "percent" },
    });
    histogram.setData(
      buildHistogramData(bars, spreadRaw as readonly (number | null)[]),
    );
  } else {
    console.warn(
      `[renderFunding] missing 'spread' series for ${strategy}@${timeframe} — histogram skipped`,
    );
  }

  // Capture the histogram in a closure for dispose. The `histogram`
  // var is mutated by the block above; the closure captures the
  // final value (either the ISeriesApi or `undefined`).
  const histogramForDispose = histogram;

  // `dispose` removes every series in a single pass. The histogram
  // is `removeSeries`'d via the local var, NOT via the public
  // `series` array (which is `ISeriesApi<"Line">[]`).
  const dispose = (): void => {
    for (const s of lines) {
      chart.removeSeries(s);
    }
    if (histogramForDispose !== undefined) {
      chart.removeSeries(histogramForDispose);
    }
  };

  return {
    name: `funding-${timeframe}-${strategy}`,
    series: lines,
    dispose,
  };
};
