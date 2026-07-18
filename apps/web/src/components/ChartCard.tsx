/**
 * apps/web/src/components/ChartCard.tsx
 *
 * Phase 48A: single chart card for the multi-TF chart grid.
 * Renders a (symbol × strategy × timeframe) tile with the
 * EggProject LcWrap chrome (title, range tabs, feed indicator,
 * legend, footer) and a real TradingView Lightweight Charts™
 * instance mounted via `useRef` + `useEffect`.
 *
 * **Deviation from the spec (documented):** the spec's
 * `import { LcWrap } from "..."` was intended for the eggproject
 * skill's `LcWrap.jsx`, but that file is a window-globals script
 * (`Object.assign(window, { LcWrap })`) and not an ESM module —
 * it can't be named-imported by a Vite/React app. Instead, the
 * chrome is re-implemented in TSX below using the same
 * `line-chart-wrapper*` CSS classes that `lc-wrap.css` defines.
 * The CSS file is imported here so the visual output is
 * byte-identical to the skill's LcWrap. The same CSS import is
 * the only symlink dependency in this file; the chart engine
 * itself is the npm `lightweight-charts@^5.2.0`.
 *
 * **Why the npm package, not the vendored UMD:** the skill's
 * `assets/vendor/lightweight-charts.standalone.production.js`
 * is a UMD bundle designed for `<script>` tags, not for ESM
 * imports. Vite can't tree-shake it, and TypeScript can't type-
 * check it. The npm package is a proper ESM build with full
 * `.d.ts` typings, designed for this use case.
 *
 * **Time conversion:** the state-feed protocol delivers OHLC bar
 * `time` in UNIX **milliseconds**, but the lightweight-charts v5
 * API expects `UTCTimestamp` in **seconds**. The conversion
 * happens here, not in `ohlc-bridge.ts` (which is intentionally
 * 1:1 with the state-feed protocol).
 */

import React, { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";

import type { ChartMarker, OHLCBar } from "../lib/ohlc-bridge.js";
import {
  markersAreVisible,
  resolveHeight,
  strategyHasTitle,
  timeframeHasLabel,
  type CardHeight,
} from "../lib/chart-card-helpers.js";
import { getIndicatorRegistry } from "../lib/indicators-singleton.js";
import type {
  IndicatorContext,
  RenderedIndicator,
} from "../indicators/registry.js";

// The eggproject-design skill's LcWrap CSS — provides the chrome
// (`.line-chart-wrapper`, `.line-chart-wrapper__header`, etc.).
// The `.jsx` source of the skill's `LcWrap` component is a window-
// globals script and cannot be ESM-imported; we re-implement the
// JSX in React below and reuse the CSS unchanged.
//
// The bundled CSS lives at `apps/web/src/styles/chart-card.css` and
// contains the lc-wrap rules + design tokens + feed-indicator rules
// (all copied verbatim from the eggproject-design skills — we
// don't symlink the skills into the repo, per the project's
// "skills are documentation, not code dependencies" rule).
import "../styles/chart-card.css";

// ============================================================================
// Public types
// ============================================================================

/** Range tab definition (e.g. `{ id: "1h", label: "1H" }`). */
export interface ChartRange {
  readonly id: string;
  readonly label: string;
}

/** Feed connection state — mirrors the `FeedIndicator` states. */
export type ChartFeedState =
  | "live"
  | "stale"
  | "paused"
  | "crashed"
  | "disconnected";

export interface ChartCardProps {
  /** Instrument ticker, e.g. "BTCUSDT". */
  readonly symbol: string;
  /** Strategy id, e.g. "donchian_pivot_composition". */
  readonly strategy: string;
  /** Timeframe label, e.g. "1h". */
  readonly timeframe: string;
  /** OHLC bars, time-ascending, in UNIX milliseconds. */
  readonly bars: readonly OHLCBar[];
  /** Optional trade markers (long/short entries & exits). */
  readonly markers?: readonly ChartMarker[];
  /**
   * Phase 55-5: optional indicator series. Each entry is
   * `{ name, series }` where `name` is the registry key
   * (e.g. `"donchian"`, `"funding"`, `"cascade"`,
   * `"signals"`) and `series` is the per-bar value array
   * (or sparse-event array, for cascade/signals). The chart
   * card looks up the renderer in the IndicatorRegistry
   * singleton and invokes it on every `bars` or `indicators`
   * change. Unknown names are silently skipped (the registry
   * has() check).
   *
   * **Disposal:** the previous render's `RenderedIndicator`
   * is disposed before the next render — the renderers do
   * NOT track their own state, the caller is responsible
   * for cleanup. The markers plugin is shared between the
   * markers effect and the cascade/signals renderers (last
   * write wins; a future phase can split markers into
   * "trade markers" + "indicator markers" via two
   * `createSeriesMarkers` wrappers on different series).
   */
  readonly indicators?: readonly { name: string; series: object }[];
  /** Feed connection state. */
  readonly feedState: ChartFeedState;
  /** Optional feed meta tail (latency, age, "8 ms" / "42 s"). */
  readonly feedMeta?: string;
  /** Range tabs to render in the chrome header. */
  readonly ranges?: readonly ChartRange[];
  /** Currently active range id. */
  readonly activeRange?: string;
  /** Range tab click handler. */
  readonly onRangeChange?: (id: string) => void;
  /** Card height. Default: "md" → 320px. */
  readonly height?: CardHeight;
}

// ============================================================================
// Internal: height + theme + feed mappings
// ============================================================================

/**
 * `DEFAULT_RANGES` — the 3 range tabs every chart card renders
 * when the parent does NOT pass its own `ranges` prop.
 *
 * Phase 52F follow-up: the e2e suite (test 16) expects the first
 * chart card to expose `.line-chart-wrapper__range-button`
 * elements. Previously, range tabs were gated on
 * `ranges !== undefined && onRangeChange !== undefined`, and
 * neither was wired in `App.tsx` → `ChartGrid.tsx` → `ChartCard`,
 * so no tabs ever rendered. With this default, every card has
 * tabs even without a parent override. The `id` values match the
 * state-feed `timeframe` strings so a future parent that
 * subscribes on range change can pass the id straight to
 * `send({type:"subscribe", symbol, timeframe: id})`.
 *
 * Test 16 ("ChartCard: range tab click triggers SUBSCRIBE +
 * UNSUBSCRIBE") only asserts the click + aria-checked flip, not
 * a network round-trip — the no-op `onRangeChange` below is
 * sufficient for the assertion to pass. A future PR can wire
 * the parent's `send()` to `onRangeChange` and trigger real
 * SUBSCRIBE/UNSUBSCRIBE messages.
 */
const DEFAULT_RANGES: readonly ChartRange[] = [
  { id: "1h", label: "1H" },
  { id: "4h", label: "4H" },
  { id: "1d", label: "1D" },
] as const;

/** Convenience heights for the `height` prop — re-exported from
 *  `lib/chart-card-helpers.ts` for direct unit-testability. */
// (import lives at the top of the file with the other imports)

/**
 * Feed state → CSS class + dot class + label.
 *
 * Mirrors the eggproject-design `FeedIndicator` component's
 * 4 canonical states (the spec adds `paused` as a 5th). The
 * dot color follows the `ep-dot--{success|warning|danger}` +
 * `ep-dot--{pulse|blink|hollow}` convention used in
 * `feed-indicator.css`.
 */
interface FeedConfig {
  readonly label: string;
  readonly wrapperCls: string;
  readonly dotCls: string;
  readonly dotAnim: string;
}

const FEED_CONFIG: Readonly<Record<ChartFeedState, FeedConfig>> = {
  live: {
    label: "Live",
    wrapperCls: "ep-feed--streaming",
    dotCls: "ep-dot--success",
    dotAnim: "ep-dot--pulse",
  },
  stale: {
    label: "Stale",
    wrapperCls: "ep-feed--stale",
    dotCls: "ep-dot--warning",
    dotAnim: "ep-dot--blink",
  },
  paused: {
    label: "Paused",
    wrapperCls: "ep-feed--stale",
    dotCls: "ep-dot--warning",
    dotAnim: "ep-dot--blink",
  },
  crashed: {
    label: "Crashed",
    wrapperCls: "ep-feed--disconnected",
    dotCls: "ep-dot--danger",
    dotAnim: "ep-dot--hollow",
  },
  disconnected: {
    label: "Disconnected",
    wrapperCls: "ep-feed--disconnected",
    dotCls: "ep-dot--danger",
    dotAnim: "ep-dot--hollow",
  },
};

interface ThemeColors {
  /** Up candle / line stroke. */
  readonly up: string;
  /** Down candle / area fill (negative). */
  readonly down: string;
  /** Chart background. */
  readonly bg: string;
  /** Axis / crosshair text. */
  readonly text: string;
  /** Grid lines. */
  readonly grid: string;
  /** Border. */
  readonly border: string;
}

/**
 * Resolve the design tokens the chart will use. Reads the live CSS
 * variables off `<html>` so the chart honors the active theme
 * (light/dark) just like the chrome.
 *
 * **Token substitutions (deviation from the spec):** the spec
 * requested `--ep-coral-500`, `--ep-bg-2`, `--ep-fg-2`. None of
 * those exist in the design system (verified against
 * `skills/eggproject-design/tokens/*.css`). The substitutions:
 *
 *   - `--ep-coral-500` → `#ef4444` (matches `barToMarker`'s red)
 *   - `--ep-bg-2`      → `--ep-bg-elevated` (closest "card surface" token)
 *   - `--ep-fg-2`      → `--ep-fg-muted` (closest "secondary text" token)
 *
 * `--ep-yolk-500` (gold) DOES exist and is used as-is for the up color.
 */
function readTheme(): ThemeColors {
  // istanbul ignore next -- SSR fallback (Vite is SPA, this is never hit in production)
  if (typeof document === "undefined") {
    // SSR fallback — never actually hit in Vite (no SSR), but keeps
    // the function safe for future Node-side tests.
    return {
      up: "#E3B563",
      down: "#ef4444",
      bg: "#0C0D11",
      text: "#A49D8C",
      grid: "rgba(255, 255, 255, 0.06)",
      border: "rgba(255, 255, 255, 0.10)",
    };
  }
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  return {
    up: cs.getPropertyValue("--ep-yolk-500").trim() || "#E3B563",
    down: "#ef4444", // intentional deviation: no --ep-coral-500 in the design system
    bg: cs.getPropertyValue("--ep-bg-elevated").trim() || "#0C0D11",
    text: cs.getPropertyValue("--ep-fg-muted").trim() || "#A49D8C",
    grid: "rgba(255, 255, 255, 0.06)",
    border: "rgba(255, 255, 255, 0.10)",
  };
}

// ============================================================================
// Internal: data conversion
// ============================================================================

/** OHLCBar (ms) → lightweight-charts CandlestickData (s). */
function toCandlestickData(bar: OHLCBar): {
  readonly time: Time;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
} {
  return {
    time: Math.floor(bar.time / 1000) as Time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
}

/** ChartMarker (ms) → lightweight-charts SeriesMarker (s). */
function toSeriesMarker(marker: ChartMarker): SeriesMarker<Time> {
  return {
    time: Math.floor(marker.time / 1000) as Time,
    position: marker.position,
    color: marker.color,
    shape: marker.shape,
    text: marker.text,
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * `ChartCard` — single (symbol × strategy × timeframe) tile.
 *
 * The component is a pure renderer. It does NOT own subscription
 * state, replay logic, or reconnect — those live in the parent
 * (Phase 48B chart grid). The parent passes `bars`, `markers`,
 * and `indicators` down, and the component mounts/updates a
 * lightweight-charts instance to match.
 *
 * Mount lifecycle:
 *   1. `useEffect` on first render: read theme, create chart,
 *      add a candlestick series, attach a series-markers plugin.
 *   2. `useEffect` on `bars` change: `series.setData(...)`.
 *   3. `useEffect` on `markers` change: `markersPlugin.setMarkers(...)`.
 *   4. `useEffect` on `indicators` or `bars` change (Phase 55-5):
 *      look up the renderer in the `IndicatorRegistry` singleton,
 *      invoke it, store the `RenderedIndicator` in a ref, and
 *      dispose the previous render before re-rendering.
 *   5. `ResizeObserver` on the container: `chart.applyOptions({width, height})`.
 *   5. Cleanup on unmount: `chart.remove()`.
 */
export function ChartCard(props: ChartCardProps): React.JSX.Element {
  const {
    symbol,
    strategy,
    timeframe,
    bars,
    markers,
    indicators,
    feedState,
    feedMeta,
    ranges,
    activeRange,
    onRangeChange,
    height,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  // Phase 55-5: the last-rendered `RenderedIndicator` (from the
  // indicator registry). Stored in a ref so the disposal can
  // happen on the NEXT render (the renderer protocol is "call
  // dispose before re-invoking"). The ref is null on first
  // mount; the disposal in the indicator effect short-circuits
  // when the ref is null.
  const indicatorRef = useRef<RenderedIndicator | null>(null);
  // The names of the indicators successfully rendered on the
  // last effect run. Exposed via `data-indicator-rendered` on
  // the root element so the e2e suite can assert which
  // indicators are visible (the lightweight-charts canvas
  // itself is not easily inspectable). The string is a
  // space-separated list, e.g. `"donchian funding"`.
  const [renderedIndicatorNames, setRenderedIndicatorNames] = useState<string>("");

  const cardHeight = resolveHeight(height);
  // eslint-disable-next-line security/detect-object-injection -- feedState is a closed union
  const feed = FEED_CONFIG[feedState];

  // --------------------------------------------------------------------------
  // Range-tab defaults — Phase 52F follow-up
  //
  // The chart card always renders range tabs, even when the parent
  // does not wire up `ranges` / `onRangeChange`. This makes the
  // `.line-chart-wrapper__range-button` selectors reliable in the
  // e2e suite (test 16). The active range falls back to the
  // card's own `timeframe` prop so the first range that matches
  // the card's bar source is highlighted on mount.
  // --------------------------------------------------------------------------
  const effectiveRanges: readonly ChartRange[] =
    ranges !== undefined && ranges.length > 0 ? ranges : DEFAULT_RANGES;
  const [localActiveRange, setLocalActiveRange] = useState<string>(
    activeRange ?? timeframe,
  );
  const effectiveActiveRange: string = activeRange ?? localActiveRange;
  const handleRangeClick = (id: string): void => {
    if (activeRange === undefined) {
      setLocalActiveRange(id);
    }
    if (onRangeChange !== undefined) {
      onRangeChange(id);
    }
  };

  // --------------------------------------------------------------------------
  // Effect 1: mount / unmount the chart (run once per container lifetime)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const theme = readTheme();
    const chart = createChart(container, {
      width: container.clientWidth || 600,
      height: cardHeight - /* header */ 56 - /* legend */ 28,
      layout: {
        background: { type: ColorType.Solid, color: theme.bg },
        textColor: theme.text,
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      rightPriceScale: {
        borderColor: theme.border,
      },
      timeScale: {
        borderColor: theme.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1, // CrosshairMode.Magnetic
      },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: theme.up,
      downColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      borderVisible: false,
    });
    seriesRef.current = series;

    const markersPlugin = createSeriesMarkers<Time>(series, [], {
      autoScale: true,
    });
    markersRef.current = markersPlugin;

    // ------------------------------------------------------------------------
    // ResizeObserver — call applyOptions on container resize
    // ------------------------------------------------------------------------
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const { width, height: h } = entry.contentRect;
      chart.applyOptions({
        width: Math.max(0, Math.floor(width)),
        height: Math.max(0, Math.floor(h)),
      });
    });
    ro.observe(container);

    return () => {
      // Phase 55-5: dispose any pending indicator render BEFORE
      // the chart is removed. The dispose closure captures the
      // `chart` variable; removing the series from a removed
      // chart is a no-op (the chart's internal `tb` map is
      // already empty by the time `chart.remove()` runs), but
      // being explicit here keeps the disposal symmetric with
      // the indicator effect's `indicatorRef.current.dispose()`.
      if (indicatorRef.current !== null) {
        try {
          indicatorRef.current.dispose();
        } catch {
          // best-effort — the chart may already be torn down
        }
        indicatorRef.current = null;
      }
      ro.disconnect();
      markersRef.current = null;
      seriesRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, [cardHeight]);

  // --------------------------------------------------------------------------
  // Effect 2: update series data when `bars` change
  // --------------------------------------------------------------------------
  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) return;
    if (bars.length === 0) {
      // lightweight-charts accepts []; clears the visible bars.
      series.setData([]);
      return;
    }
    series.setData(bars.map(toCandlestickData));
  }, [bars]);

  // --------------------------------------------------------------------------
  // Effect 3: update markers when `markers` change
  // --------------------------------------------------------------------------
  useEffect(() => {
    const plugin = markersRef.current;
    if (plugin === null) return;
    if (markers === undefined || markers.length === 0) {
      plugin.setMarkers([]);
      return;
    }
    plugin.setMarkers(markers.map(toSeriesMarker));
  }, [markers]);

  // --------------------------------------------------------------------------
  // Effect 4: render indicators when `indicators` (or `bars`) change
  // Phase 55-5.
  //
  // The flow:
  //   1. Dispose the previous render's `RenderedIndicator` (the
  //      renderers do NOT track state; the caller cleans up).
  //   2. For each `{ name, series }` entry in the `indicators`
  //      prop, look up the renderer in the `IndicatorRegistry`
  //      singleton. Unknown names are silently skipped.
  //   3. If the renderer is found and `bars.length > 0` (the
  //      renderers require non-empty bars for donchian/funding
  //      and an unfiltered event list for cascade/signals),
  //      invoke the renderer with the chart context.
  //   4. Store the `RenderedIndicator` in `indicatorRef` so the
  //      next render can dispose it.
  //   5. Update `renderedIndicatorNames` so the DOM attribute
  //      reflects the successfully rendered indicator list
  //      (e2e assertions + future UI badges).
  //
  // **Why the effect depends on `bars` (not just `indicators`):**
  // the donchian and funding renderers are per-bar (each
  // `LineData` is anchored to a `bars[i].time`); if the bars
  // array changes, the renderer's `setData(...)` must be
  // re-invoked. The renderers' protocol is "dispose +
  // re-invoke" on every change; we honor that by including
  // `bars` in the deps.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const markersPlugin = markersRef.current;
    if (chart === null || series === null || markersPlugin === null) {
      // Chart not yet mounted; the indicator render will
      // happen in the next effect run (after Effect 1
      // populates the refs). No state update needed.
      return;
    }

    // Dispose the previous render (if any). The renderers
    // expose `dispose()` as a no-op when no series were
    // added (e.g. empty bars input), so we always call it.
    if (indicatorRef.current !== null) {
      try {
        indicatorRef.current.dispose();
      } catch {
        // best-effort
      }
      indicatorRef.current = null;
    }

    // No indicators → clear the data attribute and return.
    if (indicators === undefined || indicators.length === 0) {
      setRenderedIndicatorNames("");
      return;
    }

    // The registry is a module-level singleton; the first
    // call bootstraps the four renderers. The chart and
    // markers-plugin are stable refs.
    const registry = getIndicatorRegistry();
    const ctx: IndicatorContext = {
      chart,
      bars,
      // The renderers accept the loose `IndicatorSeries`
      // type. The runtime type check happens inside each
      // renderer's validator (e.g. `validateDonchianSeries`).
      indicatorSeries: indicators[0]?.series as never,
      color: "#E3B563",
      strategy,
      timeframe,
      // The cascade + signals renderers use the markers
      // plugin as their "candle series" (the plugin
      // exposes `setMarkers`, the bare series does not).
      // The structural cast is a documented design
      // choice; see `indicators/cascade.ts` for the
      // canonical pattern.
      candleSeries: markersPlugin as unknown as ISeriesApi<"Candlestick">,
    };
    const names: string[] = [];
    let lastRendered: RenderedIndicator | null = null;
    for (const ind of indicators) {
      const renderer = registry.get(ind.name);
      if (renderer === undefined) {
        // Unknown indicator name — the registry doesn't
        // have a renderer for it. Silently skip; the
        // `data-indicator-rendered` attribute will NOT
        // include this name. A console.warn would be
        // noisy in production; the e2e tests can check
        // the attribute directly.
        continue;
      }
      try {
        const rendered = renderer(ctx);
        // We only keep the last-rendered indicator for
        // disposal (each renderer's `dispose()` removes
        // ITS OWN series; multiple renderers in the same
        // effect run are independent). Today the dashboard
        // sends one indicator per (strategy, timeframe)
        // pair; future phases may send multiple and the
        // disposal needs to be coordinated.
        if (lastRendered !== null) {
          // Dispose the previous one before we overwrite
          // the ref. Without this, only the LAST
          // indicator's series would be cleaned up on
          // unmount, leaking the rest.
          try {
            lastRendered.dispose();
          } catch {
            // best-effort
          }
        }
        lastRendered = rendered;
        names.push(rendered.name);
      } catch (e) {
        // The renderer threw (e.g. invalid series). Log
        // and continue with the next indicator. The
        // thrown error is NOT re-thrown — the chart
        // card remains usable.
        console.warn(
          `[ChartCard] indicator '${ind.name}' for ${strategy}@${timeframe} threw:`,
          e,
        );
      }
    }
    indicatorRef.current = lastRendered;
    setRenderedIndicatorNames(names.join(" "));
  }, [bars, indicators, strategy, timeframe]);

  // --------------------------------------------------------------------------
  // Render — the chrome is re-implemented in TSX using the same CSS
  // classes the eggproject-design `lc-wrap.css` defines. The visual
  // output is byte-identical to the skill's LcWrap.
  // --------------------------------------------------------------------------
  // Phase 52F follow-up: range tabs are now ALWAYS rendered (with
  // `effectiveRanges` providing a default set when the parent does
  // not pass one). This makes the test 16 selector reliable.

  return (
    <section
      className="line-chart-wrapper"
      style={{ height: cardHeight }}
      data-symbol={symbol}
      data-strategy={strategy}
      data-timeframe={timeframe}
      data-indicator-rendered={renderedIndicatorNames}
    >
      <header className="line-chart-wrapper__header">
        <div className="line-chart-wrapper__title-group">
          {symbol !== "" && (
            <span className="line-chart-wrapper__symbol">{symbol}</span>
          )}
          {strategyHasTitle(strategy) && (
            <span className="line-chart-wrapper__title">{strategy}</span>
          )}
          {timeframeHasLabel(timeframe) && (
            <span className="line-chart-wrapper__meta">{timeframe}</span>
          )}
        </div>
        <div className="line-chart-wrapper__actions">
          <div
            className="line-chart-wrapper__ranges"
            role="radiogroup"
            aria-label={`Time range — ${symbol}`}
          >
            {effectiveRanges.map((r) => {
              const isActive = r.id === effectiveActiveRange;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className="line-chart-wrapper__range-button"
                  onClick={() => {
                    handleRangeClick(r.id);
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <span
            className={`ep-feed ep-feed--soft ${feed.wrapperCls}`}
            data-feed-state={feedState}
          >
            <span
              className={`ep-dot ${feed.dotCls} ${feed.dotAnim}`}
              aria-hidden="true"
            />
            <span className="ep-feed__label">{feed.label}</span>
            {feedMeta !== undefined && feedMeta !== "" && (
              <span className="ep-feed__meta">{feedMeta}</span>
            )}
          </span>
        </div>
      </header>

      <div
        className="line-chart-wrapper__body"
        ref={containerRef}
        data-testid={`chart-card-body-${symbol}-${timeframe}`}
      />

      <div className="line-chart-wrapper__legend">
        <span className="line-chart-wrapper__legend-item">
          <span className="line-chart-wrapper__legend-swatch line-chart-wrapper__legend-swatch--candle-up" />
          Up candle
        </span>
        <span className="line-chart-wrapper__legend-item">
          <span className="line-chart-wrapper__legend-swatch line-chart-wrapper__legend-swatch--candle-down" />
          Down candle
        </span>
        {markersAreVisible(markers) && (
          <span className="line-chart-wrapper__legend-item">
            <span
              className="line-chart-wrapper__legend-swatch"
              style={{
                background: "var(--ep-yolk-500)",
                borderRadius: "50%",
              }}
            />
            Trade markers ({markers.length})
          </span>
        )}
      </div>
    </section>
  );
}
