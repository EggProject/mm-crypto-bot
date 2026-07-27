/**
 * apps/web/src/indicators/strategy-indicators.ts
 *
 * Phase 79: the per-strategy indicator registry.
 *
 * The user mandate: "minden charton adott strategiahoz szukseges
 * inditactorok es egyeb jelolesek, rajzok stb van?" — each
 * strategy's chart must show its SPECIFIC indicators + signals +
 * markers, not just the universal Donchian band. Phase 78 added
 * the Donchian band universally to every chart; Phase 79
 * dispatches to a strategy-specific set of renderers based on
 * the strategy name.
 *
 * **Architecture:**
 *   - The `StrategyIndicatorSet` is a list of named `StrategyIndicator`s
 *     (line indicators that produce series on the chart + signal
 *     markers that overlay on the candle series).
 *   - The registry maps `strategy_name → StrategyIndicatorSet` via
 *     `getStrategyIndicatorSet(strategyName)`.
 *   - The `ChartCard` component looks up the set and renders every
 *     indicator in the list (disposing the previous set on re-render).
 *   - For strategies with no specific indicators registered
 *     (`unknown` strategy), the registry falls back to the universal
 *     Donchian band (the Phase 78 baseline) so the chart isn't empty.
 *
 * **Computation strategy:** all indicators are computed CLIENT-SIDE
 * from the OHLC bar stream (the bot's strategy runners do not
 * currently publish `publishIndicator` or `publishMarker` calls —
 * the user mandate is "NE nyulj a strategy kodhoz" / "don't touch
 * strategy code", so we derive everything from the bar stream).
 *
 * **Determinism:** `getStrategyIndicatorSet` is a pure function
 * (same input → same output). The `StrategyIndicatorSet.compute`
 * and `StrategyIndicatorSet.render` are also pure (they don't
 * mutate any closure state; they take a `(bars, chart)` and
 * return a `RenderedIndicator` with a `dispose()`).
 *
 * **No React, no DOM, no I/O.** The file is the canonical test
 * target — bun:test can exercise the lookup logic directly.
 */

import type { OHLCBar } from "../lib/ohlc-bridge.js";
import {
  computeBreakoutSignalsFromBars,
  computeCascadeEventsFromBars,
  computeDonchianFromBars,
  computeFundingFlipsFromBars,
  computeFundingRateFromBars,
  computeFundingSpreadFromBars,
  computePivotFromBars,
  computeRegimeChangeMarkersFromBars,
  computeRegimeFromBars,
} from "./client-compute.js";
import { renderDonchian } from "./donchian.js";
import {
  computeBollingerBand,
  renderBollinger,
} from "./bollinger.js";
import { computeDailyPivot, renderDailyPivot } from "./daily-pivot.js";
import {
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ChartMarker } from "../lib/ohlc-bridge.js";
import type { IndicatorSeries, RenderedIndicator } from "./registry.js";
import { toSeriesMarkerMs } from "../lib/chart-card-helpers.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `LineIndicator` — a strategy-specific line indicator that
 * computes a series from the bar stream and adds line series to
 * the chart. Mirrors the `IndicatorRegistry` shape (a name +
 * a compute + a render) so the ChartCard can iterate the same
 * pattern.
 *
 * - `name` is a short identifier (e.g. `"donchian"`, `"pivot"`).
 *   Used in the `RenderedIndicator.name` for debug logs only.
 * - `compute(bars)` returns the per-bar `IndicatorSeries` for
 *   the line series. Pure.
 * - `render(chart, bars, series)` adds the line series to the
 *   chart and returns a `RenderedIndicator` whose `dispose()`
 *   removes them. The chart is read+mutated; the `bars` and
 *   `series` are read-only.
 */
export interface LineIndicator {
  readonly name: string;
  readonly compute: (bars: readonly OHLCBar[]) => IndicatorSeries;
  readonly render: (
    chart: IChartApi,
    bars: readonly OHLCBar[],
    series: IndicatorSeries,
    strategy: string,
    timeframe: string,
    /**
     * Phase 82: optional candle series. The daily-pivot
     * renderer creates price lines on the candle series (NOT
     * on a separate line series). Other renderers ignore
     * this parameter. The `ChartCard` passes the candle
     * series it created in the mount effect; the
     * `IndicatorContext` type already has `candleSeries` as
     * optional (for backward compatibility with the older
     * `IndicatorRenderer` contract that didn't need it).
     */
    candleSeries?: ISeriesApi<"Candlestick">,
  ) => RenderedIndicator;
}

/**
 * `MarkerIndicator` — a strategy-specific signal marker
 * indicator that derives entry/exit markers from the bar stream
 * and overlays them on the candle series.
 *
 * - `name` is a short identifier (e.g. `"breakout_signals"`).
 * - `compute(bars, priorIndicators)` returns a `ChartMarker[]`
 *   in the state-feed time convention (UNIX ms). The function
 *   has access to the prior line indicators' `IndicatorSeries`
 *   so it can derive entries that depend on them (e.g. a
 *   breakout signal that uses the Donchian band).
 * - `apply(markersPlugin, markers)` is the lightweight-charts v5
 *   integration: it sets the markers on the candle series' markers
 *   plugin. The `markersPlugin` is typed loosely (the v5 plugin
 *   type is `ISeriesMarkersPluginApi<Time>`) — the structural
 *   `{ setMarkers: (m) => void }` shape is all we need. Returns
 *   a `dispose` callback that clears them.
 */
export interface MarkerIndicator {
  readonly name: string;
  readonly compute: (
    bars: readonly OHLCBar[],
    priorIndicators: Readonly<Record<string, IndicatorSeries>>,
  ) => readonly ChartMarker[];
  readonly apply: (
    markersPlugin: ISeriesMarkersPluginApi<Time>,
    markers: readonly ChartMarker[],
  ) => () => void;
}

/**
 * `StrategyIndicatorSet` — the per-strategy set of indicators to
 * render. Lines are added in array order (earlier = "behind"
 * in the chart's z-order; later = "in front"). Markers are
 * applied after all lines.
 */
export interface StrategyIndicatorSet {
  /** The strategy's strategy_id (e.g. "donchian_pivot_composition"). */
  readonly strategy: string;
  /**
   * Phase 82: a short human-readable display name for the
   * chart-card header (e.g. "Donchian + Bollinger + Breakouts").
   * The `ChartCard` renders this next to the strategy id so the
   * user can see at a glance WHAT this chart shows. The full
   * `description` (below) is the longer form for tooltips / docs.
   */
  readonly displayName: string;
  /**
   * A longer human-readable description (e.g. for tooltips or
   * doc strings). The chart-card header uses `displayName` for
   * the visible label; this is the rich form.
   */
  readonly description: string;
  /** Line indicators (each adds 1+ line series to the chart). */
  readonly lines: readonly LineIndicator[];
  /** Signal markers (overlay on the candle series, in z-order). */
  readonly markers: readonly MarkerIndicator[];
}

// ============================================================================
// Standard renderers
// ============================================================================

/**
 * `donchianLineIndicator` — the standard Donchian channel
 * (upper/middle/lower), wrapped in the `LineIndicator` interface
 * so the strategy-specific dispatcher can invoke it like any
 * other line indicator. The renderer is `renderDonchian` (Phase
 * 78); the compute is `computeDonchianFromBars`.
 */
const donchianLineIndicator: LineIndicator = {
  name: "donchian",
  compute: (bars) => computeDonchianFromBars(bars),
  render: (chart, bars, series, strategy, timeframe, _candleSeries) =>
    renderDonchian({
      chart,
      bars,
      indicatorSeries: series,
      color: "",
      strategy,
      timeframe,
    }),
};

/**
 * `pivotLineIndicator` — the pivot point (PP) line, computed
 * from a rolling window. The renderer is a thin wrapper that
 * adds a single `LineSeries` to the chart with the PP values.
 *
 * The Fibonacci R1/R2/S1/S2 bands are NOT rendered (we only
 * have 1 line series budget per indicator to keep the chart
 * readable; the PP itself is the most informative single line).
 * A future phase can add the bands as a separate
 * `pivotBandsLineIndicator` if the user requests them.
 *
 * The PP color (`#5C6981`, muted slate) matches the convention
 * from the donchian band middle line — the "equilibrium"
 * aesthetic that the design system already uses.
 */
const pivotLineIndicator: LineIndicator = {
  name: "pivot",
  compute: (bars) => {
    // The pivot renderer only needs the `pp` key; we return the
    // full series (5 keys) for future-compat — the renderer's
    // `null`-filter drops the unused keys.
    return computePivotFromBars(bars);
  },
  render: (chart, bars, series, strategy, timeframe, _candleSeries) => {
    // eslint-disable-next-line @typescript-eslint/dot-notation -- "pp" is a dynamic IndicatorSeries key
    const pp: readonly (number | null)[] = series["pp"] ?? [];
    const lineData: { time: number; value: number }[] = [];
    for (let i = 0; i < bars.length; i += 1) {
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const v = pp[i];
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const bar = bars[i];
      if (v === null) continue;
      lineData.push({ time: Math.floor(bar.time / 1000), value: v });
    }
    if (lineData.length === 0) {
      return {
        name: `pivot-${timeframe}-${strategy}`,
        series: [],
        dispose: (): void => {
          // no-op
        },
      };
    }
    const lineSeries = chart.addSeries(LineSeries, {
      color: "#5C6981",
      lineWidth: 1,
      lineStyle: 2, // Dashed — distinguishes the PP from the Donchian middle line.
      priceLineVisible: false,
      lastValueVisible: false,
    });
    // The setData call needs UTCTimestamp values; the array is
    // already pre-converted (ms → s) in the loop above.
    lineSeries.setData(lineData as unknown as { time: UTCTimestamp; value: number }[]);
    return {
      name: `pivot-${timeframe}-${strategy}`,
      series: [lineSeries],
      dispose: (): void => {
        chart.removeSeries(lineSeries);
      },
    };
  },
};

/**
 * `bollingerLineIndicator` — the proper Bollinger band
 * (upper / middle / lower), wrapped in the `LineIndicator`
 * interface. The compute is `computeBollingerBand` (the pure
 * function in `bollinger.ts`); the renderer is `renderBollinger`.
 *
 * Phase 81: the user mandate is "boilenger szallagot" (Bollinger
 * band) — the existing Donchian band is a separate indicator
 * (max-high / min-low over a window); the Bollinger band is
 * SMA ± k·σ over a window. Adding the Bollinger band as a
 * SECOND line indicator on the `donchian_pivot_composition`
 * chart lets the user visually compare the two envelopes on
 * the same time axis.
 *
 * The Bollinger band's color palette (gold / slate / red) is
 * identical to the Donchian band's (Phase 78 convention) so
 * the chart's "overbought / equilibrium / oversold" envelope
 * reads consistently across the two indicators. The visual
 * differentiator is the line SHAPE: a Donchian band is a flat
 * rectangle (constant upper / lower until the rolling window
 * shifts); a Bollinger band is a smooth wave (the SMA tracks
 * the close; the bands breathe around the SMA).
 */
const bollingerLineIndicator: LineIndicator = {
  name: "bollinger",
  compute: (bars) => computeBollingerBand(bars),
  render: (chart, bars, series, strategy, timeframe, _candleSeries) =>
    renderBollinger({
      chart,
      bars,
      indicatorSeries: series,
      color: "",
      strategy,
      timeframe,
    }),
};

/**
 * `dailyPivotLineIndicator` — the classic daily pivot (PP /
 * R1 / S1), computed from the PREVIOUS bar's H/L/C. The
 * compute is `computeDailyPivot` (the pure function in
 * `daily-pivot.ts`); the renderer is `renderDailyPivot`.
 *
 * Phase 81: the user mandate is "napi pivot szint" (daily
 * pivot level). The existing `pivotLineIndicator` (Phase 79)
 * is a ROLLING Fibonacci pivot (24-bar rolling H/L/C with
 * 0.382 / 0.618 multipliers). The new `dailyPivotLineIndicator`
 * is the CLASSIC daily pivot (previous bar's H/L/C; 2x PP
 * for R1/S1). The two are intentionally different — the
 * chart shows BOTH, distinguished by line color (the rolling
 * pivot is the dashed slate from Phase 79; the daily pivot
 * is the dashed-slate PP + green R1 + red S1 from this
 * phase).
 */
const dailyPivotLineIndicator: LineIndicator = {
  name: "daily_pivot",
  compute: (bars) => computeDailyPivot(bars),
  render: (chart, bars, series, strategy, timeframe, candleSeries) =>
    renderDailyPivot({
      chart,
      bars,
      indicatorSeries: series,
      color: "",
      strategy,
      timeframe,
      candleSeries,
    }),
};

/**
 * `breakoutMarkerIndicator` — the Donchian-breakout entry/exit
 * signal markers, computed from the bar stream + the prior
 * `donchian` line indicator. The `apply` is a thin wrapper
 * around the lightweight-charts v5 `setMarkers` API.
 */
const breakoutMarkerIndicator: MarkerIndicator = {
  name: "breakout_signals",
  compute: (bars, prior) => {
    // eslint-disable-next-line @typescript-eslint/dot-notation -- "donchian" is a dynamic key from a known set
    const donchian = prior["donchian"];
    // The `IndicatorSeries` is statically typed as never
    // undefined by the index signature, but a partial
    // `prior` (from a test fixture that didn't run the line
    // indicators first) is a runtime concern.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (donchian === undefined) return [];
    return computeBreakoutSignalsFromBars(bars, donchian);
  },
  apply: (markersPlugin, markers) => {
    // The `markers` is `readonly ChartMarker[]` (the ChartMarker
    // type from `ohlc-bridge.ts`), but the markers plugin's
    // `setMarkers` accepts `SeriesMarker<Time>[]` (the v5
    // lightweight-charts shape, which is structurally identical
    // except for the `text` field — see `toSeriesMarkerMs` for
    // the conversion). The `.map(toSeriesMarkerMs)` produces a
    // fresh mutable array, satisfying the plugin's `Array<T>`
    // type. The shape is structurally identical so the cast is
    // safe (and TypeScript narrows it to the same type — hence
    // the unnecessary-assertion lint error we accept here for
    // documentation purposes).
    markersPlugin.setMarkers(markers.map(toSeriesMarkerMs));
    return (): void => {
      markersPlugin.setMarkers([]);
    };
  },
};

// ============================================================================
// Phase 81: strategy-specific indicators for the 4 DISABLED strategies
// ============================================================================
//
// The user mandate "a tobbi strategianal is biztos hogy jopar dolgot
// lehetne meg jelolni akar chart rajzol vagy indicator formajaban"
// (Phase 81) — every strategy's chart must show its SPECIFIC drawings.
//
// For the 4 disabled strategies (dydx_cex_carry, cascade_fade,
// funding_flip_kill_switch, regime_detector), Phase 78 + 79 used the
// universal Donchian band as a fallback. Phase 81 replaces that
// fallback with strategy-specific indicators that derive from the
// bar stream (the user mandate is to NOT touch strategy code, so
// server-side per-strategy `INDICATOR` messages are out of scope).
//
// The new indicators are CLIENT-SIDE approximations of the strategy's
// internal logic. They are NOT bit-exact equivalents — the visual
// goal is to give each chart a recognizable, strategy-specific
// marker / line so the user can see at a glance which strategy the
// chart belongs to. A future phase that wires per-strategy
// `INDICATOR` messages can swap these for server-supplied data
// without changing the registry shape.
//
// **Reuse pattern:** every new `LineIndicator` and `MarkerIndicator`
// below follows the same `(compute, render)` contract as the
// existing `donchianLineIndicator` / `breakoutMarkerIndicator`. The
// renderers in this file are thin wrappers that add a line series
// to the chart (for line indicators) or call `setMarkers` on the
// candle series' markers plugin (for marker indicators). No
// additional rendering infrastructure is needed — the chart-card
// dispatch loop in `ChartCard.tsx` already iterates both shapes
// (see Effect 2b in `ChartCard.tsx:564-604`).

/**
 * `fundingRateLineIndicator` — a single-line indicator that
 * renders the synthesized funding rate as a sapphire blue
 * line on the chart. Used by `dydx_cex_carry` and
 * `funding_flip_kill_switch`.
 *
 * The renderer mirrors `pivotLineIndicator`: it adds a single
 * `LineSeries` with the `pp`-key value of the indicator series.
 * The color (`#4F7BEE`, sapphire) matches the dYdX convention
 * in `funding.ts` — visually consistent with the funding
 * renderer's dydx-line color.
 */
function makeSingleLineIndicator(
  name: string,
  compute: (bars: readonly OHLCBar[]) => IndicatorSeries,
  seriesKey: string,
  color: string,
  lineWidth: 1 | 2 | 3 | 4 = 1,
  lineStyle: 0 | 1 | 2 | 3 | 4 = 0,
): LineIndicator {
  return {
    name,
    compute,
    render: (chart, bars, series, strategy, timeframe, _candleSeries) => {
      // Defensive: use Object.prototype.hasOwnProperty.call so the
      // security linter's dynamic-key warning is satisfied AND a
      // missing key returns `undefined` (which the `?? []` then
      // converts to an empty array). The `seriesKey` is from a
      // closed call site (always "funding" / "spread" / "pp")
      // so the dynamic-key access is safe.
      const rec = series as Readonly<Record<string, unknown>>;
      const values: readonly (number | null)[] =
         
        Object.prototype.hasOwnProperty.call(rec, seriesKey)
          ? // eslint-disable-next-line security/detect-object-injection -- seriesKey is a known string from a closed call site
            ((rec[seriesKey] ?? []) as readonly (number | null)[])
          : [];
      const lineData: { time: number; value: number }[] = [];
      for (let i = 0; i < bars.length; i += 1) {
        // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
        const v = values[i];
        // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
        const bar = bars[i];
        if (v === null) continue;
        lineData.push({ time: Math.floor(bar.time / 1000), value: v });
      }
      if (lineData.length === 0) {
        return {
          name: `${name}-${timeframe}-${strategy}`,
          series: [],
          dispose: (): void => {
            // no-op
          },
        };
      }
      const lineSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth,
        lineStyle,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // The setData call needs UTCTimestamp values; the array is
      // already pre-converted (ms → s) in the loop above.
      lineSeries.setData(
        lineData as unknown as { time: UTCTimestamp; value: number }[],
      );
      return {
        name: `${name}-${timeframe}-${strategy}`,
        series: [lineSeries],
        dispose: (): void => {
          chart.removeSeries(lineSeries);
        },
      };
    },
  };
}

/**
 * `fundingRateLineIndicator` — the per-bar funding rate,
 * computed via `computeFundingRateFromBars` (smoothed log
 * return). Used by `dydx_cex_carry` and
 * `funding_flip_kill_switch` — the funding rate is the
 * primary signal for both strategies.
 *
 * The `name` is `"funding_rate"` so the `prior` map is
 * key-stable; the marker indicators (funding_paid,
 * funding_flips) read it via `prior["funding_rate"]`.
 */
const fundingRateLineIndicator: LineIndicator = makeSingleLineIndicator(
  "funding_rate",
  (bars) => computeFundingRateFromBars(bars),
  "funding",
  "#4F7BEE", // sapphire — matches the dydx-line convention
  1,
  0, // solid
);

/**
 * `fundingSpreadLineIndicator` — the dYdX - CEX funding
 * spread, computed via `computeFundingSpreadFromBars`
 * (fast-EMA - slow-EMA of log returns). Used by
 * `dydx_cex_carry` — the spread is the carry the strategy
 * harvests.
 */
const fundingSpreadLineIndicator: LineIndicator = makeSingleLineIndicator(
  "funding_spread",
  (bars) => computeFundingSpreadFromBars(bars),
  "spread",
  "#E3B563", // yolk gold — matches the cex-line convention
  1,
  0,
);

/**
 * `makeSimpleMarkerIndicator` — a factory for marker
 * indicators that derive `ChartMarker[]` from the bar
 * stream (and optionally the `prior` line-indicator map).
 *
 * The `apply` is the same as `breakoutMarkerIndicator`'s:
 * call `setMarkers` with the markers converted to the
 * lightweight-charts v5 shape, and return a dispose that
 * clears them.
 */
function makeSimpleMarkerIndicator(
  name: string,
  compute: (
    bars: readonly OHLCBar[],
    prior: Readonly<Record<string, IndicatorSeries>>,
  ) => readonly ChartMarker[],
): MarkerIndicator {
  return {
    name,
    compute,
    apply: (markersPlugin, markers) => {
      markersPlugin.setMarkers(markers.map(toSeriesMarkerMs));
      return (): void => {
        markersPlugin.setMarkers([]);
      };
    },
  };
}

/**
 * `fundingPaidMarkerIndicator` — small markers on the
 * chart every 8 bars (the conventional funding-payment
 * cadence on a 1h chart). The marker is green when the
 * synthesized funding rate is positive (the position is
 * receiving the carry), red when negative (the position
 * is paying the carry). A `circle` shape with no text
 * (the markers are dense — labels would clutter the
 * chart).
 *
 * The computation reads the `funding_rate` prior line
 * indicator; if it's missing, the function falls back to
 * computing it on the fly.
 */
const fundingPaidMarkerIndicator: MarkerIndicator = makeSimpleMarkerIndicator(
  "funding_paid",
  (bars, prior) => {
    // Defensive: read the `funding_rate` prior via a typed
    // bracket access. The `prior` map is keyed by line-indicator
    // name (e.g. "funding_rate"); we look it up by name and fall
    // back to computing on the fly.
    const priorRec = prior as Readonly<Record<string, IndicatorSeries | undefined>>;
    // The bracket access is required because the index
    // signature is `string`, not a known key — the linter
    // prefers dot access for known keys, but the key
    // "funding_rate" is a dynamic map lookup. The disable
    // covers the dot-notation preference.
    // eslint-disable-next-line @typescript-eslint/dot-notation -- "funding_rate" is a dynamic key from the prior map
    const fromPrior = priorRec["funding_rate"];
    const funding: IndicatorSeries = fromPrior ?? computeFundingRateFromBars(bars);
    const fundingRec = funding as Readonly<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/dot-notation -- "funding" is a dynamic key on IndicatorSeries
    const fundingArrRaw: unknown = fundingRec["funding"];
    const fundingArr: readonly (number | null)[] = Array.isArray(fundingArrRaw)
      ? (fundingArrRaw as readonly (number | null)[])
      : [];
    const out: ChartMarker[] = [];
    // The funding-payment cadence is conventionally 8 bars on
    // a 1h chart (every 8h). We honor that convention here.
    // A future phase can vary the cadence per the chart's
    // timeframe (1h → 8 bars, 4h → 2 bars, 1d → 1 bar).
    const cadence = 8;
    for (let i = cadence; i < bars.length; i += 1) {
      if (i % cadence !== 0) continue;
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const v = fundingArr[i];
      if (v === null) continue;
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const bar = bars[i];
      out.push({
        time: bar.time,
        position: v > 0 ? "belowBar" : "aboveBar",
        color: v > 0 ? "#22c55e" : "#ef4444",
        shape: "circle",
        text: "",
      });
    }
    return out;
  },
);

/**
 * `cascadeMarkerIndicator` — markers on the chart at every
 * detected cascade event (large bar-to-bar move). The
 * computation reads the bar stream directly and uses
 * `computeCascadeEventsFromBars` (the 2% bar-to-bar
 * threshold; see `DEFAULT_CASCADE_THRESHOLD_PCT`).
 *
 * The marker shape follows the cascade convention (red
 * above / green below) — see `cascade.ts` for the rationale.
 */
const cascadeMarkerIndicator: MarkerIndicator = makeSimpleMarkerIndicator(
  "cascade_events",
  (bars) => computeCascadeEventsFromBars(bars),
);

/**
 * `fundingFlipsMarkerIndicator` — arrows at every bar
 * where the funding rate's sign changes. The computation
 * reads the `funding_rate` prior line indicator (or falls
 * back to computing it on the fly).
 */
const fundingFlipsMarkerIndicator: MarkerIndicator = makeSimpleMarkerIndicator(
  "funding_flips",
  (bars, prior) => {
    // eslint-disable-next-line @typescript-eslint/dot-notation -- "funding_rate" is a known line-indicator name
    const funding = prior["funding_rate"] ?? computeFundingRateFromBars(bars);
    return computeFundingFlipsFromBars(bars, funding);
  },
);

/**
 * `regimeChangeMarkerIndicator` — markers at every bar
 * where the regime classification changes (trending ↔
 * ranging ↔ volatile). The computation reads the bar
 * stream and uses `computeRegimeFromBars` (rolling
 * 20-bar mean + std classifier; see `DEFAULT_REGIME_LOOKBACK`).
 */
const regimeChangeMarkerIndicator: MarkerIndicator = makeSimpleMarkerIndicator(
  "regime_changes",
  (bars) => {
    const regimes = computeRegimeFromBars(bars);
    return computeRegimeChangeMarkersFromBars(bars, regimes);
  },
);

// ============================================================================
// Per-strategy indicator sets
// ============================================================================

/**
 * `STRATEGY_INDICATOR_SETS` — the per-strategy indicator registry.
 *
 * The 5 strategy IDs are the 5 strategies in the bot's config
 * (see `run-bot/config/paper-backtest-verified.toml`):
 *   - `donchian_pivot_composition` (enabled)  → Donchian + Bollinger + rolling pivot + most-recent-day daily pivot (price lines with date labels) + breakout signals
 *   - `dydx_cex_carry`             (disabled) → funding rate + funding spread + funding-paid markers (no Donchian — irrelevant to a carry strategy)
 *   - `cascade_fade`               (disabled) → Donchian + cascade event markers
 *   - `funding_flip_kill_switch`   (disabled) → funding rate + funding-flip arrows (no Donchian — irrelevant to a flip strategy)
 *   - `regime_detector`            (disabled) → Donchian + regime change markers
 *
 * Phase 82 chart redesign: each strategy's chart now tells a
 * clear visual story. The Donchian band is used only for
 * strategies where a channel envelope is meaningful (channel
 * breakouts, cascade detection, regime classification) — NOT
 * for the funding-rate strategies (dydx_cex_carry,
 * funding_flip_kill_switch) where the band would just be
 * visual noise.
 *
 * Phase 81: each disabled strategy has a STRATEGY-SPECIFIC
 * indicator set in addition to the universal Donchian band. The
 * strategy-specific data is DERIVED CLIENT-SIDE from the bar
 * stream (the bot's strategy runners do not currently publish
 * per-strategy `INDICATOR` messages for the disabled strategies,
 * and the user mandate is to NOT touch strategy code).
 *
 * The visual goal is to give each chart a recognizable,
 * strategy-specific marker / line so the user can see at a
 * glance which strategy the chart belongs to — not to
 * reproduce the strategy's internal logic bit-exact.
 */
export const STRATEGY_INDICATOR_SETS: Readonly<
  Record<string, StrategyIndicatorSet>
> = {
  // ---- 1. The ENABLED strategy (donchian_pivot_composition) ----
  // Phase 82 chart redesign: the chart now tells a clear visual
  // story with 3 envelopes + 1 rolling pivot + 1 most-recent-day
  // daily pivot (with date labels) + breakout signals.
  //   - Donchian band (3 lines, with titles "Donchian UPPER /
  //     MIDDLE / LOWER" so they appear in the chart legend)
  //   - Bollinger band (3 lines, with titles "BB UPPER / MIDDLE
  //     / LOWER" — distinguished from the Donchian titles)
  //   - Rolling pivot level (1 dashed slate line — the
  //     short-term equilibrium)
  //   - Daily pivot: NOW rendered as 3 horizontal price lines on
  //     the candle series (one per level: PP / R1 / S1) with
  //     date labels like "PP 2026-07-26". The per-bar stair-step
  //     history is DROPPED (the "ribbon indicator" clutter the
  //     user complained about).
  //   - Breakout signals (entry/exit arrows) — the strategy's
  //     actual entries and exits, derived from the Donchian band.
  donchian_pivot_composition: {
    strategy: "donchian_pivot_composition",
    displayName: "Donchian + Bollinger + Breakouts",
    description:
      "Donchian band (UPPER/MIDDLE/LOWER) + Bollinger band (BB UPPER/MIDDLE/LOWER) + rolling pivot (dashed) + most-recent-day daily pivot (PP/R1/S1 with date labels) + breakout entry/exit markers",
    lines: [
      donchianLineIndicator,
      pivotLineIndicator,
      bollingerLineIndicator,
      dailyPivotLineIndicator,
    ],
    markers: [breakoutMarkerIndicator],
  },

  // ---- 2. dydx_cex_carry (disabled) — funding-rate carry strategy ----
  // Phase 82 chart redesign: the user mandate is to drop the
  // Donchian band (it's irrelevant to a carry strategy — the
  // band is a channel indicator, the strategy is a funding-rate
  // carry). The chart now shows ONLY:
  //   - The synthesized funding rate (sapphire line, labeled
  //     "Funding")
  //   - The synthesized funding spread (gold line, labeled
  //     "Spread") — the carry being harvested
  //   - Small funding-paid markers every 8 bars (green=received,
  //     red=paid) on the candle series
  dydx_cex_carry: {
    strategy: "dydx_cex_carry",
    displayName: "Funding + Spread + Payments",
    description:
      "Synthesized funding rate (sapphire, labeled 'Funding') + funding spread (gold, labeled 'Spread') + funding-paid markers (green=received, red=paid) every 8 bars",
    lines: [fundingRateLineIndicator, fundingSpreadLineIndicator],
    markers: [fundingPaidMarkerIndicator],
  },

  // ---- 3. cascade_fade (disabled) — liquidation cascade strategy ----
  // Phase 82 chart redesign: minimal — Donchian band (3 lines
  // with labels) + cascade event markers. The Donchian band is
  // relevant here (the strategy fades cascades that break the
  // channel).
  cascade_fade: {
    strategy: "cascade_fade",
    displayName: "Donchian + Cascade Events",
    description:
      "Donchian band (UPPER/MIDDLE/LOWER) + cascade-event markers (red above for up-cascades / green below for down-cascades) at every bar with >2% bar-to-bar move",
    lines: [donchianLineIndicator],
    markers: [cascadeMarkerIndicator],
  },

  // ---- 4. funding_flip_kill_switch (disabled) — funding-flip strategy ----
  // Phase 82 chart redesign: drop the Donchian band (the
  // strategy is about funding-rate sign flips, not channel
  // breakouts). The chart now shows ONLY:
  //   - The synthesized funding rate (sapphire line, labeled
  //     "Funding")
  //   - Funding flip arrows (green up for -→+, red down for +→-)
  //     at every sign-change point
  funding_flip_kill_switch: {
    strategy: "funding_flip_kill_switch",
    displayName: "Funding + Flip Arrows",
    description:
      "Funding rate line (sapphire, labeled 'Funding') + funding-flip arrows (green up for -→+, red down for +→-) at every sign-change point",
    lines: [fundingRateLineIndicator],
    markers: [fundingFlipsMarkerIndicator],
  },

  // ---- 5. regime_detector (disabled) — market regime classifier ----
  // Phase 82 chart redesign: Donchian band (3 lines with
  // labels) + regime change markers (color-coded by regime).
  // The Donchian band is relevant here (regime detection
  // classifies channel behavior).
  regime_detector: {
    strategy: "regime_detector",
    displayName: "Donchian + Regime Markers",
    description:
      "Donchian band (UPPER/MIDDLE/LOWER) + regime-change markers (sapphire=trending / slate=ranging / yolk=volatile) at every bar where the classification changes",
    lines: [donchianLineIndicator],
    markers: [regimeChangeMarkerIndicator],
  },
};

/**
 * `UNIVERSAL_FALLBACK_SET` — the indicator set for an unknown
 * strategy. Same as the disabled-strategy sets (universal
 * Donchian band only). The user mandate "minden charton adott
 * strategiahoz" applies to KNOWN strategies; an unknown
 * strategy is a config-error case and the chart should still
 * render SOMETHING.
 */
export const UNIVERSAL_FALLBACK_SET: StrategyIndicatorSet = {
  strategy: "unknown",
  displayName: "Donchian (fallback)",
  description: "Donchian band baseline (unknown strategy — falling back to universal set)",
  lines: [donchianLineIndicator],
  markers: [],
};

/**
 * `getStrategyIndicatorSet(strategyName)` — look up the
 * per-strategy indicator set. Returns `UNIVERSAL_FALLBACK_SET`
 * for unknown strategies (the chart still renders the
 * universal Donchian band).
 *
 * Pure, deterministic, no I/O. The canonical test target for
 * the strategy-specific dispatch logic.
 */
export function getStrategyIndicatorSet(
  strategyName: string,
): StrategyIndicatorSet {
  // The `Record<string, StrategyIndicatorSet>` index returns
  // `StrategyIndicatorSet` (not `... | undefined`) because
  // `apps/web`'s tsconfig does NOT enable
  // `noUncheckedIndexedAccess`. The runtime check below is
  // defensive — the registry is a finite map; an unknown key
  // falls back to the universal set.
  // eslint-disable-next-line security/detect-object-injection -- strategyName is a known strategy id from the config
  const set: StrategyIndicatorSet | undefined = STRATEGY_INDICATOR_SETS[strategyName];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (set !== undefined) return set;
  return UNIVERSAL_FALLBACK_SET;
}
