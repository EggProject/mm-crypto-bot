/**
 * apps/web/src/indicators/registry.ts
 *
 * Phase 49A: the indicator registry — a name → renderer map.
 *
 * The state-feed sends `INDICATOR` messages carrying per-(symbol,
 * timeframe) computed series (e.g. Donchian upper/middle/lower).
 * The web client renders those series on top of the OHLC chart.
 *
 * Each indicator is implemented as a pure function:
 *   `(IndicatorContext) → RenderedIndicator`
 * The function adds lightweight-charts line series to a shared
 * `IChartApi` and returns a `dispose` callback that removes them.
 *
 * The registry is the indirection that lets the future `ChartCard`
 * resolve which renderer to use for a given `(strategy, indicator)`
 * pair, without `ChartCard` having to import every indicator file.
 *
 * No React imports, no DOM access, no I/O. The class is plain
 * TypeScript — it can be unit-tested with bun:test directly and
 * reused in any other context (e.g. server-side rendering of a
 * static chart snapshot).
 *
 * **Deviation from the spec:** the spec refers to the v4 API
 * `chart.addLineSeries({ color, ... })`. Lightweight-charts v5
 * (the version pinned in `apps/web/package.json`) deprecated that
 * alias — the supported call is `chart.addSeries(LineSeries, opts)`.
 * The renderers in this directory use the v5 API; the public type
 * `ISeriesApi<"Line">` in this file is the v5 series type
 * (`ISeriesApi<"Line", Time, LineData<Time>, ...>` with default
 * generics), which `RenderedIndicator.series: readonly ISeriesApi<"Line">[]`
 * exposes cleanly.
 */

import type { OHLCBar } from "../lib/ohlc-bridge.js";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

// ============================================================================
// Public types
// ============================================================================

/**
 * Indicator series data delivered by the state-feed `INDICATOR`
 * message.
 *
 * Keys are indicator series names (e.g. `"upper"`, `"middle"`,
 * `"lower"`); values are arrays of `(number | null)` — `null` for
 * periods where the indicator is undefined (e.g. a Donchian channel
 * has no upper bound for the first N bars in the lookback window).
 *
 * **Length invariant:** every value array has the same length as
 * the OHLC bar array the indicator was computed against. The
 * renderers do not need to defend against length mismatches here —
 * the per-indicator `validateXxxSeries` helper is the gate that
 * the ChartCard is expected to call before invoking the renderer.
 */
export type IndicatorSeries = Readonly<Record<string, readonly (number | null)[]>>;

/**
 * The chart context passed to an indicator renderer.
 *
 * The renderer uses:
 *   - `bars` to align the series to the chart's time axis
 *   - `chart` to add new line series to the same `IChartApi`
 *   - `candleSeries` to overlay markers on the existing OHLC
 *     candles (used by the cascade indicator; see
 *     `cascade.ts`). **Optional** — indicators that only add
 *     their own series (Donchian, funding) do not need it.
 *     The renderers that DO need it must defensively check
 *     for absence (e.g. `renderCascade` logs a `console.warn`
 *     and skips when `candleSeries` is undefined).
 *   - `color` as the theme accent (the indicator-specific palette
 *     is encoded in the renderer, not in this context — the
 *     context's `color` is a theme-wide fallback only)
 *   - `strategy` + `timeframe` to compose a unique `RenderedIndicator.name`
 *     so multiple `(symbol × timeframe)` instances can coexist
 *     on the same chart without collision
 *
 * **Why `candleSeries` is optional:** the Donchian and funding
 * indicators add their own series; they have no business with
 * the candle series. Forcing the field to be present would
 * require those renderers' callers (e.g. ChartCard) to plumb
 * a candle series they don't need, and would break the existing
 * donchian.test.ts fixtures. Marking it optional keeps the
 * contract honest: it's there for indicators that need it,
 * absent for the rest.
 */
export interface IndicatorContext {
  readonly chart: IChartApi;
  readonly bars: readonly OHLCBar[];
  readonly indicatorSeries: IndicatorSeries;
  readonly color: string;
  readonly strategy: string;
  readonly timeframe: string;
  /**
   * The chart's candle (OHLC) series. Optional — only the
   * cascade indicator uses it. The lightweight-charts v5
   * API exposes `setMarkers()` on the markers-plugin wrapper
   * (`createSeriesMarkers(series, ...)`), NOT on the bare
   * `ISeriesApi<"Candlestick">`. Renderers that need to set
   * markers must type-assert to a structural type with
   * `setMarkers`; see `cascade.ts` for the canonical cast.
   */
  readonly candleSeries?: ISeriesApi<"Candlestick">;
}

/**
 * A rendered indicator is a set of line series added to the chart.
 *
 * The `ChartCard` component owns the chart lifecycle; the indicator
 * renderer adds series on render, and the parent removes them on
 * re-render (typically by calling `dispose()`).
 *
 * `name` must be unique per `(chart, indicator)` pair so that the
 * ChartCard can map a `RenderedIndicator` back to its origin in
 * its internal bookkeeping. The convention is
 * `<indicator>-<timeframe>-<symbol>` (e.g. `donchian-1h-BTCUSDT`).
 */
export interface RenderedIndicator {
  readonly name: string;
  readonly series: readonly ISeriesApi<"Line">[];
  readonly dispose: () => void;
}

/**
 * `IndicatorRenderer` — pure function: `(context) → RenderedIndicator`.
 *
 * Called by `ChartCard` whenever the bars or indicator series change.
 * **MUST be idempotent in the side-effect on the chart**: calling
 * twice with the same context must leave the chart in the same
 * state. (The convention is that each call adds its own series and
 * the previous call's series are explicitly removed first by the
 * caller; the renderer itself does not need to track prior state.)
 *
 * **MUST NOT mutate the registry.** The renderer only touches the
 * `chart` instance it receives via context. The registry is the
 * application-level configuration; the renderer is per-call
 * computation.
 */
export type IndicatorRenderer = (ctx: IndicatorContext) => RenderedIndicator;

// ============================================================================
// IndicatorRegistry
// ============================================================================

/**
 * `IndicatorRegistry` — maps indicator name → renderer function.
 *
 * Usage:
 *
 *   const registry = new IndicatorRegistry();
 *   registry.register("donchian", renderDonchian);
 *   const renderer = registry.get("donchian");
 *   if (renderer !== undefined) {
 *     const rendered = renderer({ chart, bars, ... });
 *     // ... later: rendered.dispose();
 *   }
 *
 * `register` is idempotent (re-registering the same name overwrites).
 * `get` returns `undefined` for unknown names (caller handles the
 * "no renderer for this indicator" case).
 * `list()` returns the registered names in lexicographic order, so
 * the test snapshots and debug dumps are stable.
 * `has()` is a quick membership check that does not allocate.
 */
export class IndicatorRegistry {
  private readonly renderers: Map<string, IndicatorRenderer> = new Map<
    string,
    IndicatorRenderer
  >();

  /**
   * Register `fn` as the renderer for `name`.
   *
   * Re-registering the same `name` overwrites the previous entry.
   * No warning is emitted — a follow-up PR may want to add
   * `console.warn` here, but the current ChartCard bootstraps the
   * registry exactly once at module load, so an overwrite is
   * almost certainly a bug-in-progress the developer wants to see
   * loudly. Keeping the API silent for now to leave the option open
   * for the warning without breaking the test assertions on
   * "register round-trip".
   */
  register(name: string, fn: IndicatorRenderer): void {
    this.renderers.set(name, fn);
  }

  /**
   * Look up the renderer for `name`. Returns `undefined` if the
   * name is not registered — the caller is expected to handle
   * the unknown-indicator case (skip rendering, log, etc.).
   */
  get(name: string): IndicatorRenderer | undefined {
    return this.renderers.get(name);
  }

  /**
   * Return all registered names in sorted (lexicographic) order.
   *
   * The output is a snapshot: the underlying `Map` is not exposed
   * and the returned array is a fresh `string[]` on every call,
   * so the caller can mutate it without affecting the registry.
   */
  list(): readonly string[] {
    return [...this.renderers.keys()].sort();
  }

  /**
   * Quick membership check — equivalent to `get(name) !== undefined`
   * but does not allocate a closure result.
   */
  has(name: string): boolean {
    return this.renderers.has(name);
  }
}
