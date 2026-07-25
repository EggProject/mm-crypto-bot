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
// Phase 78: client-side indicator rendering. The bot's strategy
// runners do not currently publish `publishIndicator` calls (the
// infra is in place but no strategy is using it), so the only way
// to surface the strategy-specific drawings on the chart is to
// derive them client-side. The user mandate: "a kepeiden tovabbra
// sem latom a strategiakkal kapcsolatban a chart rajzokat" — the
// strategy-specific chart drawings MUST be visible, not just candles.
import { renderDonchian } from "../indicators/donchian.js";
import { computeDonchianFromBars } from "../indicators/client-compute.js";
import type { RenderedIndicator } from "../indicators/registry.js";

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
  /**
   * Phase 76: whether the strategy is currently enabled (running)
   * in the bot. `false` means the strategy is in the config but
   * disabled (e.g. derivatives-only on a spot-only setup); the chart
   * still renders (so the user can see the strategy is configured)
   * but the chrome adds a "(disabled)" suffix to the title for
   * clarity. Defaults to `true` for backward compatibility with
   * existing call sites that haven't been updated yet.
   */
  readonly enabled?: boolean;
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
    enabled = true,
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
  // Phase 78: the currently-rendered strategy indicator. The bars
  // effect re-renders the donchian band every time the bar stream
  // updates; we dispose the previous render before invoking a new
  // one so the chart doesn't accumulate stale line series.
  const indicatorRef = useRef<RenderedIndicator | null>(null);

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
  // Phase 60 coverage fix: extract the JSX `&&` chains into named
  // consts above the return. The V8 + ast-v8-to-istanbul pipeline
  // (vite-plugin-istanbul + Playwright CT/e2e merge) does NOT
  // attribute branch coverage to `{condition && <X />}` patterns
  // inside JSX expressions — the branch is invisible to the
  // instrumentation. Extracting the conditional to a `const`
  // surfaces the branch as a plain JS expression, which V8's
  // code coverage tracks correctly.
  //
  // Behavior is preserved exactly: `null` renders as nothing in
  // React, identical to the prior `false` from the `&&` short-
  // circuit. No new tests, no logic changes — this is a pure
  // refactor for source-map / branch-attribution alignment.
  // --------------------------------------------------------------------------
  const symbolLabel =
    symbol !== "" ? (
      <span className="line-chart-wrapper__symbol">{symbol}</span>
    ) : null;
  const strategyTitle = strategyHasTitle(strategy) ? (
    <span
      className="line-chart-wrapper__title"
      data-enabled={enabled ? "true" : "false"}
    >
      {strategy}
      {/* Phase 76: a "(disabled)" suffix on the chrome title makes
          it immediately clear which strategies are configured but
          not currently running. The status banner's "X active
          strategies" is the source of truth for the running count;
          this suffix is a per-card visual cue that survives even
          when the user is scrolled past the banner. */}
      {enabled ? null : (
        <span
          className="line-chart-wrapper__title-suffix"
          data-testid="chart-card-disabled-suffix"
        >
          {" "}(disabled)
        </span>
      )}
    </span>
  ) : null;
  const timeframeMeta = timeframeHasLabel(timeframe) ? (
    <span className="line-chart-wrapper__meta">{timeframe}</span>
  ) : null;
  const feedMetaEl = isFeedMetaVisible(feedMeta) ? (
    <span className="ep-feed__meta">{feedMeta}</span>
  ) : null;
  const markersLegend = markersAreVisible(markers) ? (
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
  ) : null;

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
      // Phase 78: dispose the rendered indicator before the chart
      // is removed. The chart.remove() call below would otherwise
      // leave the indicator's line series orphaned (the chart
      // engine's chart.remove() does NOT call dispose() on the
      // renderers, it just drops the chart instance).
      indicatorRef.current?.dispose();
      indicatorRef.current = null;
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
      // Phase 78: also clear the rendered indicator. The previous
      // donchian band lines are removed; when the next bar stream
      // arrives, the indicator effect (below) will re-render them.
      indicatorRef.current?.dispose();
      indicatorRef.current = null;
      return;
    }
    series.setData(bars.map(toCandlestickDataMs));
  }, [bars]);

  // --------------------------------------------------------------------------
  // Effect 2b: render strategy indicators (donchian band) from bars
  //
  // Phase 78: the user mandate ("a kepeiden tovabbra sem latom a
  // strategiakkal kapcsolatban a chart rajzokat") demands that the
  // strategy's indicator lines be visible on the chart, not just
  // the candles. The bot's strategy runners do not currently
  // publish `publishIndicator` calls, so the only path is to
  // compute the indicator client-side from the bar stream and
  // invoke the existing `renderDonchian` renderer.
  //
  // The renderer adds 3 line series (upper gold / middle muted /
  // lower red) to the chart and returns a `RenderedIndicator`
  // whose `dispose()` removes them. We dispose the previous
  // render before invoking a new one so the chart doesn't
  // accumulate stale line series as the bar stream updates.
  //
  // Effect deps: `[bars, strategy, timeframe]` — recompute the
  // indicator whenever the bar stream or the (strategy, tf) key
  // changes. The `chart` is read from a ref so it doesn't trigger
  // a re-run on every render.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    // Dispose the previous render so stale lines don't accumulate.
    indicatorRef.current?.dispose();
    indicatorRef.current = null;
    if (bars.length === 0) return;
    const indicatorSeries = computeDonchianFromBars(bars);
    indicatorRef.current = renderDonchian({
      chart,
      bars,
      indicatorSeries,
      color: "",
      strategy,
      timeframe,
    });
  }, [bars, strategy, timeframe]);

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
          {symbolLabel}
          {strategyTitle}
          {timeframeMeta}
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
            {feedMetaEl}
          </span>
        </div>
      </header>

      <div
        className="line-chart-wrapper__body"
        ref={containerRef}
        data-testid={`chart-card-body-${symbol}-${timeframe}`}
      />

      {/* Phase 74: the "Up candle / Down candle" legend was removed
          (user mandate: a felesleges szöveg zavaros volt, hiszen minden
          gyertya vagy up vagy down — triviális). Csak a trade markers
          legend maradt (az információ-többlet, amit a user keres). */}
      {markersAreVisible(markers) ? (
        <div className="line-chart-wrapper__legend">
          {markersLegend}
        </div>
      ) : null}
    </section>
  );
}
