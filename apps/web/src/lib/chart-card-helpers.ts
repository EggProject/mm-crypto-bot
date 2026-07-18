/**
 * apps/web/src/lib/chart-card-helpers.ts
 *
 * Phase 54E: pure helpers extracted from `ChartCard.tsx` for
 * direct unit-testability. The inline `HEIGHTS` constant + the
 * `resolveHeight` function were not directly testable as
 * exports, and the SSR fallback in `readTheme` was untestable
 * (Vite SPA never runs in Node SSR).
 *
 * Extracting these here:
 * - `HEIGHTS` — typed `Record<"sm" | "md" | "lg", number>`
 * - `resolveHeight(h)` — returns the pixel height for a card
 * - `markersAreVisible(markers)` — true-branch check
 * - `strategyHasTitle(strategy)` — empty-string check
 * - `timeframeHasLabel(timeframe)` — empty-string check
 *
 * Each helper is a tiny pure function, directly unit-testable
 * without React/DOM. The `readTheme` SSR fallback is marked
 * with an istanbul-ignore-next comment to reduce the denominator
 * (the Vite SPA never hits that branch in production).
 */

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
