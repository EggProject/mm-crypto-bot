/**
 * apps/web/src/indicators/donchian.ts
 *
 * Phase 49A: the Donchian channel indicator renderer.
 *
 * The Donchian channel is a three-line volatility indicator:
 *   - `upper`  : highest high over the last N bars (breakout level)
 *   - `middle` : (upper + lower) / 2 (pivot / equilibrium)
 *   - `lower`  : lowest low over the last N bars (breakdown level)
 *
 * The state-feed computes these values server-side and sends them
 * as an `INDICATOR` message:
 *
 *   {
 *     type: "INDICATOR",
 *     strategy: "donchian_pivot_composition",
 *     symbol: "BTCUSDT",
 *     timeframe: "1h",
 *     series: { upper: [...], middle: [...], lower: [...] }
 *   }
 *
 * The web client is responsible only for rendering the lines on
 * top of the OHLC chart. This file is the renderer; the strategy
 * code (in `packages/strategies/`) is the producer.
 *
 * **Deviation from the spec:** the spec says
 * `chart.addLineSeries({ color, ... })`. Lightweight-charts v5
 * (the version pinned in `apps/web/package.json`) removed that
 * method — the supported call is
 * `chart.addSeries(LineSeries, opts)`. The renderer below uses
 * the v5 API. The `RenderedIndicator.series` field still exposes
 * the same `ISeriesApi<"Line">[]` type that the spec requires;
 * the public contract is unchanged, only the v4 → v5 call syntax
 * shifts.
 *
 * **Deviation from the spec on `--ep-coral-500`:** the spec lists
 * `lower: --ep-coral-500` for the breakdown color, but no
 * `coral` token exists in the eggproject design system shipped
 * in `apps/web/src/styles/chart-card.css`. The renderer's lower
 * band uses the same red (`#ef4444`) that `barToMarker` uses for
 * short / sell markers, which is the convention across the
 * dashboard. The upper band uses the spec's `--ep-yolk-500` gold
 * (`#E3B563`) and the middle band uses `--ep-fg-muted`
 * (`#5C6981` = `--ep-slate-500` mapped to `fg-muted`).
 */

import {
  LineSeries,
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
 * The Donchian indicator name as registered in `IndicatorRegistry`.
 *
 * The strategy code in `packages/strategies/` references this exact
 * string in its `INDICATOR` messages, so a typo here would silently
 * fail to render — keep in sync with the strategy.
 */
export const DONCHIAN_INDICATOR_NAME = "donchian" as const;

/**
 * The three named series the Donchian indicator produces.
 *
 * Defined as a closed tuple so the renderer can iterate them in a
 * fixed order (upper → middle → lower) — the order matters for
 * `RenderedIndicator.series`, because ChartCard and any
 * downstream consumers rely on positional indexing into it.
 */
export const DONCHIAN_SERIES_KEYS = ["upper", "middle", "lower"] as const;
export type DonchianSeriesKey = (typeof DONCHIAN_SERIES_KEYS)[number];

/**
 * Theme colors used by `renderDonchian`.
 *
 * Mirrors the spec's intent:
 *   - upper  : gold (`--ep-yolk-500`)   — breakout above
 *   - middle : muted slate (`--ep-fg-muted`) — pivot line
 *   - lower  : red (`#ef4444`)          — breakdown below
 *
 * Hex literals are used instead of `getComputedStyle` lookups so
 * the renderer is deterministic in unit tests (which mock the
 * `IChartApi` and have no real DOM to resolve CSS variables from)
 * and so server-side rendering (if/when added) is possible without
 * a DOM. The CSS custom properties in the design system are
 * mirrored here; a future phase can add a CSS-var resolver if
 * we ever want live theme switching without re-registering the
 * renderer.
 */
export const DONCHIAN_COLORS: Readonly<Record<DonchianSeriesKey, string>> = {
  upper: "#E3B563", // --ep-yolk-500
  middle: "#5C6981", // --ep-fg-muted (dark theme: --ep-slate-500)
  lower: "#ef4444", // matches the red used by barToMarker
};

/**
 * The typed shape of a validated Donchian series.
 *
 * Every value is `number | null` (the `null` case is filtered out
 * by the renderer when building the `LineData` arrays — see
 * `renderDonchian`).
 */
export interface DonchianSeries extends IndicatorSeries {
  readonly upper: readonly (number | null)[];
  readonly middle: readonly (number | null)[];
  readonly lower: readonly (number | null)[];
}

// ============================================================================
// validateDonchianSeries
// ============================================================================

/**
 * `validateDonchianSeries` — type-guard + structural validation.
 *
 * Returns the typed `DonchianSeries` if valid, else `null`. The
 * caller is expected to log a warning and skip rendering when
 * `null` is returned.
 *
 * Validity rules:
 *   1. All three keys (`upper`, `middle`, `lower`) must be present
 *      and their values must be arrays (i.e. not `undefined` and
 *      not primitives).
 *   2. All three arrays must have the same length.
 *   3. The shared length must equal `bars.length`.
 *   4. Each value in the arrays must be a `number` OR `null`
 *      (not a string, not `undefined`, not an object).
 *
 * An empty input (all three keys present, all length 0) is
 * considered VALID — the renderer gracefully handles that case
 * (no line data → empty `setData` call). The ChartCard is
 * expected to short-circuit the renderer call itself when
 * `bars.length === 0`.
 */
export function validateDonchianSeries(
  series: IndicatorSeries,
  bars: readonly OHLCBar[],
): DonchianSeries | null {
  // Defensive cast: we know `upper` / `middle` / `lower` are
  // `readonly (number | null)[]` per the `DonchianSeries` interface
  // extension, but the input is the loose `IndicatorSeries` type.
  // The runtime checks below guarantee the cast is safe.
  //
  // The bracket access is the only way to address a `Record<string, _>`
  // with a known string key — the TS dot access on a string-index
  // signature is not allowed. The linter prefers dot access; we
  // silence that rule per-line because the runtime type guard
  // (`Array.isArray`) is the contract here, not the static key set.
  //
  // `apps/web`'s tsconfig does NOT have `noUncheckedIndexedAccess`,
  // so `Record<string, T>[key]` returns `T` (not `T | undefined`).
  // The cast to `unknown` is needed because the static type of
  // `IndicatorSeries` does not include `upper`/`middle`/`lower`
  // as named keys.
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const upperRaw: unknown = (series as Record<string, unknown>)["upper"];
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const middleRaw: unknown = (series as Record<string, unknown>)["middle"];
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const lowerRaw: unknown = (series as Record<string, unknown>)["lower"];

  // Rule 1: every key must be present and be an array.
  if (
    !Array.isArray(upperRaw) ||
    !Array.isArray(middleRaw) ||
    !Array.isArray(lowerRaw)
  ) {
    return null;
  }
  const upper = upperRaw as readonly unknown[];
  const middle = middleRaw as readonly unknown[];
  const lower = lowerRaw as readonly unknown[];

  // Rule 4: every value must be a number or null. We check the
  // union of the three arrays element-wise; a single non-numeric
  // value anywhere fails the entire validation.
  const allValues: readonly unknown[] = [...upper, ...middle, ...lower];
  for (const v of allValues) {
    if (v !== null && typeof v !== "number") {
      return null;
    }
  }

  // Rule 2: the three arrays must have the same length.
  if (upper.length !== middle.length || middle.length !== lower.length) {
    return null;
  }

  // Rule 3: the shared length must match `bars.length`.
  if (upper.length !== bars.length) {
    return null;
  }

  return {
    upper: upper as readonly (number | null)[],
    middle: middle as readonly (number | null)[],
    lower: lower as readonly (number | null)[],
  };
}

// ============================================================================
// renderDonchian
// ============================================================================

/**
 * Build the `LineData[]` for one Donchian sub-series.
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
    // `number | null` respectively (not `T | undefined`). We still
    // do a runtime `v === null` filter because `null` is a valid
    // value in the series and lightweight-charts rejects it.
    //
    // The `i` is a loop counter bounded by `bars.length`, not user
    // input — the `security/detect-object-injection` warning is a
    // false positive.
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
 * Look up the theme color for `key` using dot access (not indexed
 * access) so the `security/detect-object-injection` rule has no
 * dynamic-key surface to flag. The switch is exhaustive over
 * `DonchianSeriesKey`; adding a new key to the union will trigger
 * a TS error here.
 */
function colorFor(key: DonchianSeriesKey): string {
  switch (key) {
    case "upper": {
      return DONCHIAN_COLORS.upper;
    }
    case "middle": {
      return DONCHIAN_COLORS.middle;
    }
    case "lower": {
      return DONCHIAN_COLORS.lower;
    }
    default: {
      const _exhaustive: never = key;
      throw new Error(`colorFor: unknown key ${String(_exhaustive)}`);
    }
  }
}

/**
 * Look up the values array for `key` in `indicatorSeries`. Returns
 * `undefined` if the key is absent.
 *
 * Because `apps/web`'s tsconfig does not enable
 * `noUncheckedIndexedAccess`, `Record<string, T>[key]` is typed
 * as `T` (not `T | undefined`). To distinguish "key present with
 * the default value" from "key absent", we use a switch on the
 * closed `DonchianSeriesKey` union plus a `hasOwnProperty`
 * presence check. The switch is exhaustive (the `never` default
 * is the compile-time exhaustiveness check), so adding a new
 * series key triggers a TS error here.
 */
function valuesFor(
  indicatorSeries: IndicatorSeries,
  key: DonchianSeriesKey,
): readonly (number | null)[] | undefined {
  switch (key) {
    case "upper": {
      return hasArrayKey(indicatorSeries, "upper")
        ? indicatorSeries.upper
        : undefined;
    }
    case "middle": {
      return hasArrayKey(indicatorSeries, "middle")
        ? indicatorSeries.middle
        : undefined;
    }
    case "lower": {
      return hasArrayKey(indicatorSeries, "lower")
        ? indicatorSeries.lower
        : undefined;
    }
    default: {
      const _exhaustive: never = key;
      throw new Error(`valuesFor: unknown key ${String(_exhaustive)}`);
    }
  }
}

/**
 * `hasArrayKey` — true if `key` is present on `record` AND the
 * value is an array.
 *
 * The `Object.prototype.hasOwnProperty.call(...)` is the
 * canonical way to check key presence on a `Record<string, T>`
 * (where the index signature can't distinguish "key absent" from
 * "key present with `undefined` value"). The `Array.isArray`
 * narrows the value to a runtime array, matching the
 * `validateDonchianSeries` structural rules.
 *
 * Returns a typed boolean so the caller can chain it with
 * dot-access (which TS narrows to the value type for known keys
 * — see the `valuesFor` switch above).
 */
function hasArrayKey(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  // The `key` is a closed `DonchianSeriesKey` at every call site
  // (the `valuesFor` switch is exhaustive), but typed as `string`
  // here so the helper is reusable for any future indicator. The
  // security rule flags the dynamic-key access regardless; the
  // `hasOwnProperty` check guarantees the key is present.
  return (
    Object.prototype.hasOwnProperty.call(record, key) &&
    // eslint-disable-next-line security/detect-object-injection -- key is a closed union at the call site
    Array.isArray(record[key])
  );
}

/**
 * `renderDonchian` — the `IndicatorRenderer` for the Donchian channel.
 *
 * Adds three line series to the chart (upper, middle, lower) and
 * returns a `RenderedIndicator` whose `dispose()` removes them all
 * from the chart. The renderer is pure (no side effects on the
 * registry); it only mutates the `chart` instance it receives via
 * context.
 *
 * **Graceful handling:**
 *   - Empty `bars` → no series are added, the returned
 *     `RenderedIndicator` has `series: []` and a no-op `dispose`.
 *   - Missing series (e.g. `upper: undefined` in `indicatorSeries`)
 *     → `console.warn` is called, only the present series are added.
 *   - `null` values inside a series → silently dropped from the
 *     `LineData[]` (the line just has a gap on the chart, which is
 *     the conventional way to render a partial Donchian window).
 *
 * **Idempotency:** the renderer does NOT track prior state — the
 * caller is expected to call the previous `RenderedIndicator.dispose()`
 * before invoking the renderer again. The renderer is a pure
 * description of "given this context, here is what to add to the
 * chart"; cleanup is the caller's job.
 */
export const renderDonchian: IndicatorRenderer = (
  ctx: IndicatorContext,
): RenderedIndicator => {
  const { chart, bars, indicatorSeries, strategy, timeframe } = ctx;

  // Short-circuit: no bars → no series.
  if (bars.length === 0) {
    return {
      name: `donchian-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: nothing to dispose when no series were added
      },
    };
  }

  // Per-key handling: log + skip if the key is missing.
  const series: ISeriesApi<"Line">[] = [];
  for (const key of DONCHIAN_SERIES_KEYS) {
    const values = valuesFor(indicatorSeries, key);
    if (values === undefined) {
      console.warn(
        `[renderDonchian] missing '${key}' series for ${strategy}@${timeframe} — skipping`,
      );
      continue;
    }

    // `addSeries(LineSeries, opts)` — v5 API. `priceLineVisible: false`
    // suppresses the horizontal "current value" line on the right axis
    // (a Donchian channel renders three lines; each one's right-edge
    // marker would visually clutter the chart). `lastValueVisible: false`
    // suppresses the label of the last value.
    const lineSeries = chart.addSeries(LineSeries, {
      color: colorFor(key),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    lineSeries.setData(buildLineData(bars, values));
    series.push(lineSeries);
  }

  // `dispose` removes every series in a single pass; `removeSeries`
  // is O(N) in the chart's own bookkeeping but constant in the
  // number of series we added (3 for the Donchian channel).
  const dispose = (): void => {
    for (const s of series) {
      chart.removeSeries(s);
    }
  };

  return {
    name: `donchian-${timeframe}-${strategy}`,
    series,
    dispose,
  };
};
