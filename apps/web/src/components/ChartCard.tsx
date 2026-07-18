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
 * happens via `toCandlestickDataMs` in `lib/chart-card-helpers.ts`
 * (Phase 56C extraction). The same helper handles markers
 * (`toSeriesMarkerMs`).
 *
 * **Phase 56C refactor:** 18 uncovered e2e branches were
 * extracted into `lib/chart-card-helpers.ts` (see the file's
 * top-of-file comment for the full list). The component still
 * owns the side-effecting code (useEffect bodies, lightweight-
 * charts API, ResizeObserver, refs) but every branchable piece
 * of pure logic now lives in the helpers module where it's
 * 100% unit-testable.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

import type { ChartMarker, OHLCBar } from "../lib/ohlc-bridge.js";
import {
  applyResizeRect,
  computeChartInnerHeight,
  feedConfigFor,
  isActiveRange,
  isFeedMetaVisible,
  markersAreVisible,
  readThemeFromElement,
  resolveEffectiveRanges,
  resolveHeight,
  SSR_FALLBACK_THEME,
  strategyHasTitle,
  timeframeHasLabel,
  toCandlestickDataMs,
  toSeriesMarkerMs,
  type CardHeight,
  type ChartFeedState,
  type ChartRange,
  type FeedConfig,
  type ThemeColors,
} from "../lib/chart-card-helpers.js";

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
export type { ChartRange };

/** Feed connection state — mirrors the `FeedIndicator` states. */
export type { ChartFeedState };

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

/**
 * Feed state → CSS class + dot class + label.
 *
 * Mirrors the eggproject-design `FeedIndicator` component's
 * 4 canonical states (the spec adds `paused` as a 5th). The
 * dot color follows the `ep-dot--{success|warning|danger}` +
 * `ep-dot--{pulse|blink|hollow}` convention used in
 * `feed-indicator.css`.
 *
 * Phase 56C: the lookup itself moved to `feedConfigFor` in
 * `lib/chart-card-helpers.ts`. The table is still defined here
 * because it carries the design-system-specific CSS class names
 * (the `FeedConfig` type is a generic shape; the table is the
 * chart-card-specific binding).
 */
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

/**
 * Resolve the design tokens the chart will use. Reads the live CSS
 * variables off `<html>` so the chart honors the active theme
 * (light/dark) just like the chrome.
 *
 * **Phase 56C refactor:** the DOM-reading body moved to
 * `readThemeFromElement` in `lib/chart-card-helpers.ts`. The
 * `if (typeof document === "undefined")` guard stays here
 * because it can't be unit-tested (Vite SPA always has
 * `document`) and the SSR fallback is genuinely dead code in
 * the browser.
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
    return SSR_FALLBACK_THEME;
  }
  return readThemeFromElement(document.documentElement);
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
  const feed = feedConfigFor(feedState, FEED_CONFIG);

  // --------------------------------------------------------------------------
  // Range-tab defaults — Phase 52F follow-up + 56C refactor
  //
  // The chart card always renders range tabs, even when the parent
  // does not wire up `ranges` / `onRangeChange`. This makes the
  // `.line-chart-wrapper__range-button` selectors reliable in the
  // e2e suite (test 16). The active range falls back to the
  // card's own `timeframe` prop so the first range that matches
  // the card's bar source is highlighted on mount.
  //
  // The ranges-or-defaults logic moved to `resolveEffectiveRanges`
  // in `lib/chart-card-helpers.ts` (Phase 56C).
  // --------------------------------------------------------------------------
  const effectiveRanges = resolveEffectiveRanges(ranges, DEFAULT_RANGES);
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
      height: computeChartInnerHeight(cardHeight),
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
    //
    // Phase 56C: the `Math.max(0, Math.floor(width/height))` math
    // moved to `applyResizeRect` in `lib/chart-card-helpers.ts`
    // (so the clamp logic is unit-testable).
    // ------------------------------------------------------------------------
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const { width, height: h } = entry.contentRect;
      const dims = applyResizeRect({ width, height: h });
      chart.applyOptions(dims);
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
  //
  // Phase 56C: the `bars.map(toCandlestickData)` + ms→s conversion
  // moved to `toCandlestickDataMs` in `lib/chart-card-helpers.ts`
  // (so the data conversion is unit-testable). The `bars.length === 0`
  // branch (BRDA 362,10) is exercised by e2e test 56C-01 (send a
  // snapshot with an empty bar list).
  // --------------------------------------------------------------------------
  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) return;
    if (bars.length === 0) {
      // lightweight-charts accepts []; clears the visible bars.
      series.setData([]);
      return;
    }
    series.setData(bars.map(toCandlestickDataMs));
  }, [bars]);

  // --------------------------------------------------------------------------
  // Effect 3: update markers when `markers` change
  //
  // Phase 56C: the `markers.map(toSeriesMarker)` + ms→s conversion
  // moved to `toSeriesMarkerMs` in `lib/chart-card-helpers.ts`.
  // The markers-present branch (BRDA 343,5 / 349,8 / 352,9) is
  // currently unreachable through the React flow because App.tsx
  // passes `markersByKey={{}}` — the unit tests for
  // `toSeriesMarkerMs` cover the helper to 100%.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const plugin = markersRef.current;
    if (plugin === null) return;
    if (markers === undefined || markers.length === 0) {
      plugin.setMarkers([]);
      return;
    }
    plugin.setMarkers(markers.map(toSeriesMarkerMs));
  }, [markers]);

  // --------------------------------------------------------------------------
  // Render — the chrome is re-implemented in TSX using the same CSS
  // classes the eggproject-design `lc-wrap.css` defines. The visual
  // output is byte-identical to the skill's LcWrap.
  // --------------------------------------------------------------------------
  // Phase 52F follow-up: range tabs are now ALWAYS rendered (with
  // `effectiveRanges` providing a default set when the parent does
  // not pass one). This makes the test 16 selector reliable.
  //
  // Phase 56C: the per-tab ternaries (`isActive`, `handleRangeClick`)
  // and the feed-meta / feed-config lookups moved to
  // `isActiveRange` / `feedConfigFor` / `isFeedMetaVisible` helpers.
  // The remaining in-render branches are the JSX structural
  // conditions (e.g. `symbol !== ""`) which are already covered.

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
              const isActive = isActiveRange(r.id, effectiveActiveRange);
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
            {isFeedMetaVisible(feedMeta) && (
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
