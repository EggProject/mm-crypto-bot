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
  computeDonchianFromBars,
  computePivotFromBars,
} from "./client-compute.js";
import { renderDonchian } from "./donchian.js";
import {
  LineSeries,
  type IChartApi,
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
  /** A short human-readable description for the legend. */
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
  render: (chart, bars, series, strategy, timeframe) =>
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
  render: (chart, bars, series, strategy, timeframe) => {
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
// Per-strategy indicator sets
// ============================================================================

/**
 * `STRATEGY_INDICATOR_SETS` — the per-strategy indicator registry.
 *
 * The 5 strategy IDs are the 5 strategies in the bot's config
 * (see `run-bot/config/paper-backtest-verified.toml`):
 *   - `donchian_pivot_composition` (enabled) → 3 line/marker indicators
 *   - `dydx_cex_carry`             (disabled) → just the Donchian band
 *   - `cascade_fade`               (disabled) → just the Donchian band
 *   - `funding_flip_kill_switch`   (disabled) → just the Donchian band
 *   - `regime_detector`            (disabled) → just the Donchian band
 *
 * For the disabled strategies, the user mandate is to keep them
 * visible on the chart with the "(disabled)" chrome suffix (Phase
 * 76). The chart's indicator set for those is the universal
 * Donchian band (Phase 78) — the strategy-specific renderers
 * would need external data (perpetual funding rates, liquidation
 * cascades, multi-TF regime classifications) that the client
 * doesn't have access to without additional server-side work
 * (out of scope for Phase 79).
 *
 * The user can always re-define the indicator set for a disabled
 * strategy in a future phase by adding a new entry here.
 */
export const STRATEGY_INDICATOR_SETS: Readonly<
  Record<string, StrategyIndicatorSet>
> = {
  // ---- 1. The ENABLED strategy (donchian_pivot_composition) ----
  // The user mandate: "minden charton adott strategiahoz szukseges
  // inditactorok es egyeb jelolesek, rajzok stb van?" — this is
  // the strategy we MUST show the SPECIFIC drawings for. The set:
  //   - Donchian band (3 lines, gold/slate/red) — the channel
  //   - Pivot level (1 line, dashed slate) — the equilibrium
  //   - Breakout signals (entry/exit arrows) — the strategy's
  //     actual entries and exits, derived from the same band.
  donchian_pivot_composition: {
    strategy: "donchian_pivot_composition",
    description:
      "Donchian channel (3 lines) + rolling pivot level (dashed) + breakout entry/exit markers",
    lines: [donchianLineIndicator, pivotLineIndicator],
    markers: [breakoutMarkerIndicator],
  },

  // ---- 2-5. The DISABLED strategies ----
  // For each of the 4 disabled strategies, we render the universal
  // Donchian band (the Phase 78 baseline) so the chart isn't
  // empty. The strategy-specific indicator sets would need
  // external data the client doesn't have (perpetual funding,
  // liquidation cascades, multi-TF regime classifications).
  // The strategy-specific dispatch is wired up (the set is
  // registered), so a future phase can drop in a richer
  // computation by adding new entries to `STRATEGY_INDICATOR_SETS`.
  dydx_cex_carry: {
    strategy: "dydx_cex_carry",
    description:
      "Donchian band baseline (strategy-specific funding-rate carry indicators require server-side funding data, not yet wired)",
    lines: [donchianLineIndicator],
    markers: [],
  },
  cascade_fade: {
    strategy: "cascade_fade",
    description:
      "Donchian band baseline (strategy-specific cascade markers require server-side liquidation data, not yet wired)",
    lines: [donchianLineIndicator],
    markers: [],
  },
  funding_flip_kill_switch: {
    strategy: "funding_flip_kill_switch",
    description:
      "Donchian band baseline (strategy-specific funding-flip signals require server-side funding data, not yet wired)",
    lines: [donchianLineIndicator],
    markers: [],
  },
  regime_detector: {
    strategy: "regime_detector",
    description:
      "Donchian band baseline (strategy-specific regime markers require multi-TF aggregation, not yet wired)",
    lines: [donchianLineIndicator],
    markers: [],
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
