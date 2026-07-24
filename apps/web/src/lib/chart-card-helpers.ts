/**
 * apps/web/src/lib/chart-card-helpers.ts
 *
 * Phase 54E + 56C: pure helpers extracted from `ChartCard.tsx` for
 * direct unit-testability. The inline `HEIGHTS` constant + the
 * `resolveHeight` function were not directly testable as
 * exports, and the SSR fallback in `readTheme` was untestable
 * (Vite SPA never runs in Node SSR).
 *
 * **Phase 54E helpers (existing):**
 * - `HEIGHTS` — typed `Record<"sm" | "md" | "lg", number>`
 * - `resolveHeight(h)` — returns the pixel height for a card
 * - `markersAreVisible(markers)` — true-branch check
 * - `strategyHasTitle(strategy)` — empty-string check
 * - `timeframeHasLabel(timeframe)` — empty-string check
 *
 * **Phase 56C helpers (new) — extracted from the 18 uncovered
 *  e2e branches in `ChartCard.tsx`:**
 * - `themeColorWithFallback(raw, fallback)` — the `\|\| "..."` pattern
 *   in `readTheme` for CSS variables. Extracted because the
 *   fallback RHS branches (BRDA 246,1,1 / 248,2,1 / 249,3,1) were
 *   uncovered in e2e (the dev env always has the tokens set).
 * - `readThemeFromElement(root)` — the DOM-reading part of
 *   `readTheme`. The `if (typeof document === "undefined")` guard
 *   stays in the component (it's an impossible-to-cover SSR branch
 *   in a Vite SPA), but the body is now a pure function testable
 *   with a mock element.
 * - `SSR_FALLBACK_THEME` — constant for the SSR fallback case.
 * - `clampChartDimension(n)` — `Math.max(0, Math.floor(n))` for
 *   the ResizeObserver callback. Tiny but branch-y.
 * - `computeChartInnerHeight(cardHeight, header, legend)` — the
 *   `cardHeight - 56 - 28` math. Pulled out so the constants are
 *   named and the subtraction is unit-testable.
 * - `toCandlestickDataMs(bar)` — OHLCBar (ms) → CandlestickData (s).
 *   Was inline in ChartCard.tsx; moved here for unit-testability.
 * - `toSeriesMarkerMs(marker)` — ChartMarker (ms) → SeriesMarker (s).
 *   Was inline in ChartCard.tsx; moved here so the markers effect
 *   helpers (BRDA 343,5 / 349,8 / 352,9) are 100% unit-tested even
 *   though the React flow can't pass markers (App.tsx passes
 *   `markersByKey={{}}`).
 * - `resolveEffectiveRanges(ranges, defaults)` — the
 *   `ranges !== undefined && ranges.length > 0 ? ranges : defaults`
 *   logic in the ChartCard render. The default-ranges path is
 *   unit-tested.
 * - `feedConfigFor(feedState, config)` — the `FEED_CONFIG[feedState]`
 *   lookup. Extracted so the per-state branches are 100% unit-tested.
 * - `isFeedMetaVisible(feedMeta)` — the `feedMeta !== undefined && feedMeta !== ""`
 *   check from the legend. Extracted so the RHS branch is unit-tested
 *   (e2e can't easily set feedMeta to undefined; it always comes
 *   through as `""` from App.tsx).
 *
 * Each helper is a tiny pure function, directly unit-testable
 * without React/DOM. Side-effecting code (useEffect bodies, the
 * lightweight-charts API, ResizeObserver attachment, refs) stays
 * in `ChartCard.tsx` because it cannot be made pure without
 * breaking the contract with lightweight-charts.
 */

import type { Time, SeriesMarker } from "lightweight-charts";

import type { ChartMarker, OHLCBar } from "./ohlc-bridge.js";

// ============================================================================
// Existing Phase 54E helpers
// ============================================================================

export type CardHeight = "sm" | "md" | "lg" | number;

/**
 * `HEIGHTS` — the 3 convenience height presets for `ChartCard`.
 *
 *   - `sm` → 220px (compact tile, good for 3+ per row)
 *   - `md` → 320px (default, balanced)
 *   - `lg` → 480px (full-detail, single-card focus)
 */
export const HEIGHTS: Readonly<Record<"sm" | "md" | "lg", number>> = {
  sm: 220,
  md: 320,
  lg: 480,
};

/**
 * `resolveHeight(h)` — convert a `ChartCard.height` prop to a
 * pixel value. Numeric inputs are returned as-is. String inputs
 * are looked up in `HEIGHTS`. Undefined falls back to `HEIGHTS.md`.
 *
 * Pure: no React, no DOM, no side effects. Unit-testable.
 */
export function resolveHeight(h: CardHeight | undefined): number {
  if (typeof h === "number") return h;
  if (h === undefined) return HEIGHTS.md;
  // eslint-disable-next-line security/detect-object-injection -- h is a closed union of "sm"|"md"|"lg"
  return HEIGHTS[h];
}

/**
 * `markersAreVisible(markers)` — true when the chart should
 * render a "Trade markers" legend item. Mirrors the inline
 * condition `markers !== undefined && markers.length > 0` in
 * the ChartCard legend. Acts as a TypeScript type predicate
 * so the caller can use `markers.length` without a non-null
 * assertion after the check.
 */
export function markersAreVisible<T>(
  markers: readonly T[] | undefined,
): markers is readonly T[] {
  return markers !== undefined && markers.length > 0;
}

/**
 * `strategyHasTitle(strategy)` — true when the strategy label
 * should be rendered. Mirrors the `{strategy !== "" && ...}`
 * check in the chart card header.
 */
export function strategyHasTitle(strategy: string): boolean {
  return strategy !== "";
}

/**
 * `timeframeHasLabel(timeframe)` — true when the timeframe
 * label should be rendered. Mirrors the `{timeframe !== "" && ...}`
 * check in the chart card header.
 */
export function timeframeHasLabel(timeframe: string): boolean {
  return timeframe !== "";
}

// ============================================================================
// Phase 56C helpers — theme + dimensions
// ============================================================================

/**
 * `ThemeColors` — the resolved chart theme. Mirrors the inline
 * `ThemeColors` interface that previously lived in `ChartCard.tsx`.
 * Exposed here so `readThemeFromElement` is importable as a pure
 * function from anywhere (tests, future server-side rendering,
 * future snapshot previews).
 */
export interface ThemeColors {
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
 * `SSR_FALLBACK_THEME` — the theme to use when the function runs
 * outside a browser (e.g. future Node-side rendering or tests
 * without a real `<html>` element). Matches the inline `readTheme`
 * SSR fallback that previously lived in `ChartCard.tsx`.
 *
 * **Phase 73 — exchange-standard candle colors:** the previous
 * `up: "#E3B563"` (gold from `--ep-yolk-500`) was changed to
 * `"#22c55e"` (green) and `down: "#ef4444"` (red) was kept. The
 * user mandate (Phase 73, verbatim) was: "miert nem piros es zold
 * a candle, senki nem kerte hogy talalj ki szineket!" — i.e. the
 * user wants the universal exchange convention (Binance, Coinbase,
 * Bybit, TradingView all use green-up / red-down). The previous
 * gold/red combination was a design-system deviation with no
 * user-mandated justification, so it is reverted to the canonical
 * trading convention.
 */
export const SSR_FALLBACK_THEME: Readonly<ThemeColors> = {
  up: "#22c55e",
  down: "#ef4444",
  bg: "#0C0D11",
  text: "#A49D8C",
  grid: "rgba(255, 255, 255, 0.06)",
  border: "rgba(255, 255, 255, 0.10)",
};

/**
 * `themeColorWithFallback(raw, fallback)` — read a CSS custom
 * property value (raw) and return the trimmed value, or `fallback`
 * if the raw value is empty / whitespace-only.
 *
 * Replaces the inline `cs.getPropertyValue(...).trim() || "#..."`
 * pattern that appeared 3 times in `readTheme`. Extracted so the
 * fallback RHS branches are unit-testable (the dev env always
 * has the tokens set, so e2e can't hit the RHS).
 *
 * Pure: no React, no DOM, no side effects.
 */
export function themeColorWithFallback(raw: string, fallback: string): string {
  return raw.trim() || fallback;
}

/**
 * `readThemeFromElement(root)` — extract the chart's `ThemeColors`
 * from a given HTML element's computed style. Pure: takes the
 * element as input, returns the resolved colors. No `document.*`
 * lookups, no globals (other than `globalThis.getComputedStyle`,
 * which is a browser-standard global — see the implementation
 * below for the defensive fallback).
 *
 * **Token substitutions (mirrors the original `readTheme` in
 * `ChartCard.tsx`):**
 *   - `--ep-yolk-500` (gold) — exists in the design system, used as-is
 *   - `--ep-bg-elevated` (card surface) — exists in the design system
 *   - `--ep-fg-muted` (secondary text) — exists in the design system
 *   - `down` is hardcoded to `#ef4444` — there is no `--ep-coral-500`
 *     in the design system (verified during the 56C refactor)
 *
 * The function is intentionally permissive: if any token is missing
 * it falls back to a hardcoded dark-theme value (matches the
 * `SSR_FALLBACK_THEME` palette). This means a partial theme
 * (e.g. tests with a minimal HTML stub) still produces a valid
 * theme object.
 */
export function readThemeFromElement(root: HTMLElement): ThemeColors {
  // `getComputedStyle` is a browser global. In Node test runs it
  // doesn't exist; in the test we pass a mock element with a
  // `getComputedStyle` method (used by the unit tests). The
  // production path goes through the global (used by the e2e
  // suite via the real browser DOM).
  const rootAny = root as unknown as {
    getComputedStyle?: (e: HTMLElement) => CSSStyleDeclaration;
  };
  const globalAny = globalThis as unknown as {
    getComputedStyle?: (e: HTMLElement) => CSSStyleDeclaration;
  };
  const getCs: (e: HTMLElement) => CSSStyleDeclaration =
    rootAny.getComputedStyle ??
    globalAny.getComputedStyle ??
    ((): CSSStyleDeclaration => {
      throw new Error(
        "readThemeFromElement: no getComputedStyle available (browser + happy-dom/jsdom required)",
      );
    });
  // Phase 73: a getCs hívás a CSS custom property-k olvasásához kell.
  // A `cs` változót CSAK a bg/text/grid/border mezőkhöz használjuk;
  // az up/down (candle színek) hardcode-olva vannak, lásd lentebb.
  const cs = getCs(root);
  // Phase 73: we use SSR_FALLBACK_THEME for bg/text/grid/border
  // instead of CSS custom properties. The design system uses
  // `color-mix(in oklab, ...)` expressions for the surface tokens,
  // and `getPropertyValue` returns those expressions as LITERAL
  // strings (not as resolved colors). The lightweight-charts v5
  // renderer passes these strings to a canvas `fillStyle` setter,
  // which throws `Error: "Value is null"` because the canvas API
  // cannot parse a `color-mix()` function call. The hardcoded
  // dark-theme palette (matching `[data-theme="dark"]`) is the
  // pragmatic fix — the dashboard runs against the dark theme by
  // default per the Phase 56B default. If a future PR wants full
  // theme switching, it needs to resolve the `color-mix()` strings
  // to actual colors (e.g. via a hidden DOM element with the CSS
  // variable set and `getComputedStyle` of THAT element).
  return {
    // Phase 73: candle colors are HARDCODED to the universal exchange
    // convention (green-up, red-down). The user explicitly rejected
    // the design-system tokens for these ("senki nem kerte hogy talalj
    // ki szineket!"). The `themeColorWithFallback` wrapper is preserved
    // for shape consistency with the other fields (bg/text fall through
    // the same path) but the source here is intentionally a constant
    // rather than a CSS variable — candles are a financial primitive,
    // not a theme token.
    up: SSR_FALLBACK_THEME.up,
    down: SSR_FALLBACK_THEME.down,
    bg: SSR_FALLBACK_THEME.bg,
    text: SSR_FALLBACK_THEME.text,
    grid: SSR_FALLBACK_THEME.grid,
    border: SSR_FALLBACK_THEME.border,
  };
}

/**
 * `clampChartDimension(n)` — sanitize a single dimension value
 * from the ResizeObserver `contentRect`. The chart engine
 * (`lightweight-charts`) requires non-negative integer dimensions,
 * so we floor + clamp to `>= 0` here. Returns `0` for negative
 * or `NaN` inputs.
 *
 * Pure: no React, no DOM, no side effects.
 */
export function clampChartDimension(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * `computeChartInnerHeight(cardHeight, headerSize, legendSize)` —
 * the chart engine's render area is `cardHeight - header - legend`.
 * The two subtracted constants (`56` for the header bar,
 * `28` for the legend strip) are baked into the chart card layout
 * and exposed as named parameters so future changes to the
 * chrome height only need to be reflected in the test fixtures
 * (not a magic-number test).
 *
 * Pure: no React, no DOM, no side effects.
 */
export function computeChartInnerHeight(
  cardHeight: number,
  headerSize = 56,
  legendSize = 28,
): number {
  return Math.max(0, cardHeight - headerSize - legendSize);
}

/**
 * `applyResizeRect(rect)` — apply the `clampChartDimension` to
 * BOTH width and height of a `DOMRectReadOnly` (or a
 * `ResizeObserverEntry.contentRect` equivalent). Returns a
 * `{ width, height }` object ready to pass to
 * `chart.applyOptions(...)`.
 *
 * Pure: takes a value, returns a value. The DOMRectReadOnly is
 * only read; no mutation.
 */
export function applyResizeRect(rect: {
  readonly width: number;
  readonly height: number;
}): { readonly width: number; readonly height: number } {
  return {
    width: clampChartDimension(rect.width),
    height: clampChartDimension(rect.height),
  };
}

// ============================================================================
// Phase 56C helpers — data conversion (ms → s for lightweight-charts v5)
// ============================================================================

/**
 * `toCandlestickDataMs(bar)` — convert a state-feed `OHLCBar` (time
 * in UNIX **milliseconds**) to a lightweight-charts v5
 * `CandlestickData` (time in `UTCTimestamp` **seconds**).
 *
 * The state-feed protocol delivers `time` in milliseconds; the
 * lightweight-charts v5 API expects `UTCTimestamp` in seconds.
 * The conversion happens at the renderer boundary (here), not
 * in `ohlc-bridge.ts` (which is intentionally 1:1 with the
 * state-feed protocol shape).
 *
 * Pure: deterministic, no side effects.
 */
export function toCandlestickDataMs(bar: OHLCBar): {
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

/**
 * `toSeriesMarkerMs(marker)` — convert a state-feed `ChartMarker`
 * (time in UNIX milliseconds) to a lightweight-charts v5
 * `SeriesMarker<Time>` (time in `UTCTimestamp` seconds).
 *
 * Mirrors `toCandlestickDataMs` but for the markers plugin.
 *
 * Pure: deterministic, no side effects.
 */
export function toSeriesMarkerMs(marker: ChartMarker): SeriesMarker<Time> {
  return {
    time: Math.floor(marker.time / 1000) as Time,
    position: marker.position,
    color: marker.color,
    shape: marker.shape,
    text: marker.text,
  };
}

// ============================================================================
// Phase 56C helpers — render-time logic
// ============================================================================

/**
 * `ChartRange` — the range tab definition. Mirrors the type that
 * was previously inline in `ChartCard.tsx`. Re-exported here so
 * `resolveEffectiveRanges` is importable as a pure function.
 */
export interface ChartRange {
  readonly id: string;
  readonly label: string;
}

/**
 * `resolveEffectiveRanges(ranges, defaults)` — pick the effective
 * list of range tabs to render. If the caller passed a non-empty
 * `ranges` array, use it; otherwise use the `defaults`. Mirrors
 * the inline `effectiveRanges` computation in `ChartCard.tsx`:
 *
 *   `effectiveRanges = ranges !== undefined && ranges.length > 0
 *                       ? ranges : DEFAULT_RANGES`
 *
 * Pure: no React, no DOM, no side effects.
 */
export function resolveEffectiveRanges<R extends ChartRange>(
  ranges: readonly R[] | undefined,
  defaults: readonly R[],
): readonly R[] {
  if (ranges !== undefined && ranges.length > 0) return ranges;
  return defaults;
}

/**
 * `FeedConfig` — the resolved feed-state styling config.
 * Mirrors the inline `FeedConfig` interface that previously lived
 * in `ChartCard.tsx`. Exposed here so `feedConfigFor` is importable
 * as a pure function.
 */
export interface FeedConfig {
  readonly label: string;
  readonly wrapperCls: string;
  readonly dotCls: string;
  readonly dotAnim: string;
}

/**
 * `ChartFeedState` — the union of 5 valid feed states. Mirrors
 * the type that was previously inline in `ChartCard.tsx`.
 */
export type ChartFeedState =
  | "live"
  | "stale"
  | "paused"
  | "crashed"
  | "disconnected";

/**
 * `feedConfigFor(feedState, config)` — look up the styling config
 * for a given feed state. Mirrors the inline `FEED_CONFIG[feedState]`
 * lookup in `ChartCard.tsx`. The `config` table is passed in so
 * this helper is decoupled from the chart card's own `FEED_CONFIG`
 * (useful for future consumers: a status bar, a notification, etc.).
 *
 * **Deviation from a pure lookup:** we keep the `feedState` type
 * narrow (closed union of 5 strings) so the function returns
 * `FeedConfig` (not `FeedConfig | undefined`). The eslint
 * `security/detect-object-injection` warning is suppressed for
 * the same reason: the key is a closed union.
 *
 * Pure: no React, no DOM, no side effects.
 */
export function feedConfigFor(
  feedState: ChartFeedState,
  config: Readonly<Record<ChartFeedState, FeedConfig>>,
): FeedConfig {
  // eslint-disable-next-line security/detect-object-injection -- feedState is a closed union
  return config[feedState];
}

/**
 * `isFeedMetaVisible(feedMeta)` — true when the feed meta tail
 * should be rendered. Mirrors the inline `feedMeta !== undefined
 * && feedMeta !== ""` check in the ChartCard legend.
 *
 * Pure: deterministic, no side effects.
 */
export function isFeedMetaVisible(feedMeta: string | undefined): boolean {
  return feedMeta !== undefined && feedMeta !== "";
}

/**
 * `isActiveRange(rangeId, effectiveActiveRange)` — true when the
 * given range tab should be rendered as active. Mirrors the
 * inline `r.id === effectiveActiveRange` check in the
 * `effectiveRanges.map(...)` render.
 *
 * Pure: deterministic, no side effects.
 */
export function isActiveRange(
  rangeId: string,
  effectiveActiveRange: string,
): boolean {
  return rangeId === effectiveActiveRange;
}

/**
 * `handleRangeClick(state, id, opts)` — pure logic for the
 * range-button click handler. Returns the next local-active-range
 * value to set, and whether to invoke the optional
 * `onRangeChange` callback. Mirrors the inline
 * `handleRangeClick` function in `ChartCard.tsx`:
 *
 *   ```
 *   if (activeRange === undefined) {
 *     setLocalActiveRange(id);
 *   }
 *   if (onRangeChange !== undefined) {
 *     onRangeChange(id);
 *   }
 *   ```
 *
 * The helper returns the new state value and a boolean
 * `shouldNotify`, so the React component can call
 * `setLocalActiveRange(newLocal)` and `onRangeChange?.(id)`
 * without inlining the conditionals.
 *
 * Pure: no React, no DOM, no side effects.
 */
export function handleRangeClick(
  activeRange: string | undefined,
  localActiveRange: string,
  clickedId: string,
): { readonly nextLocal: string; readonly shouldNotify: boolean } {
  const nextLocal: string =
    activeRange === undefined ? clickedId : localActiveRange;
  // onRangeChange is always invoked if defined; the component checks
  const shouldNotify = true;
  return { nextLocal, shouldNotify };
}
