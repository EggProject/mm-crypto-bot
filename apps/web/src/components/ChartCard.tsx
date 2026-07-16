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

import React, { useEffect, useRef } from "react";
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

// The eggproject-design skill's LcWrap CSS — provides the chrome
// (`.line-chart-wrapper`, `.line-chart-wrapper__header`, etc.).
// The `.jsx` source of the skill's `LcWrap` component is a window-
// globals script and cannot be ESM-imported; we re-implement the
// JSX in React below and reuse the CSS unchanged.
//
// The `lc-wrap.css` file transitively imports `colors_and_type.css`
// and `feed-indicator.css`, so the design tokens (`--ep-yolk-500`,
// `--ep-bg-elevated`, `--ep-fg-muted`, ...) are also available
// here.
import "../../../skills/eggproject-design-trade-components/components/lc-wrap/lc-wrap.css";

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
  readonly height?: "sm" | "md" | "lg" | number;
}

// ============================================================================
// Internal: height + theme + feed mappings
// ============================================================================

/** Convenience heights for the `height` prop. */
const HEIGHTS: Readonly<Record<"sm" | "md" | "lg", number>> = {
  sm: 220,
  md: 320,
  lg: 480,
};

function resolveHeight(h: ChartCardProps["height"]): number {
  if (typeof h === "number") return h;
  if (h === undefined) return HEIGHTS.md;
  // eslint-disable-next-line security/detect-object-injection -- h is a closed union
  return HEIGHTS[h];
}

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
 * (Phase 48B chart grid). The parent passes `bars` and `markers`
 * down, and the component mounts/updates a lightweight-charts
 * instance to match.
 *
 * Mount lifecycle:
 *   1. `useEffect` on first render: read theme, create chart,
 *      add a candlestick series, attach a series-markers plugin.
 *   2. `useEffect` on `bars` change: `series.setData(...)`.
 *   3. `useEffect` on `markers` change: `markersPlugin.setMarkers(...)`.
 *   4. `ResizeObserver` on the container: `chart.applyOptions({width, height})`.
 *   5. Cleanup on unmount: `chart.remove()`.
 */
export function ChartCard(props: ChartCardProps): React.JSX.Element {
  const {
    symbol,
    strategy,
    timeframe,
    bars,
    markers,
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

  const cardHeight = resolveHeight(height);
  // eslint-disable-next-line security/detect-object-injection -- feedState is a closed union
  const feed = FEED_CONFIG[feedState];

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
  // Render — the chrome is re-implemented in TSX using the same CSS
  // classes the eggproject-design `lc-wrap.css` defines. The visual
  // output is byte-identical to the skill's LcWrap.
  // --------------------------------------------------------------------------
  const showRanges =
    ranges !== undefined && ranges.length > 0 && onRangeChange !== undefined;

  return (
    <section
      className="line-chart-wrapper"
      style={{ height: cardHeight }}
      data-symbol={symbol}
      data-strategy={strategy}
      data-timeframe={timeframe}
    >
      <header className="line-chart-wrapper__header">
        <div className="line-chart-wrapper__title-group">
          {symbol !== "" && (
            <span className="line-chart-wrapper__symbol">{symbol}</span>
          )}
          {strategy !== "" && (
            <span className="line-chart-wrapper__title">{strategy}</span>
          )}
          {timeframe !== "" && (
            <span className="line-chart-wrapper__meta">{timeframe}</span>
          )}
        </div>
        <div className="line-chart-wrapper__actions">
          {showRanges && (
            <div
              className="line-chart-wrapper__ranges"
              role="radiogroup"
              aria-label={`Time range — ${symbol}`}
            >
              {ranges.map((r) => {
                const isActive = r.id === activeRange;
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    className="line-chart-wrapper__range-button"
                    onClick={() => {
                      onRangeChange(r.id);
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          )}
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
        {markers !== undefined && markers.length > 0 && (
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
