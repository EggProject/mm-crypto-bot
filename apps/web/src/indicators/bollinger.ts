/**
 * apps/web/src/indicators/bollinger.ts
 *
 * Phase 81: the Bollinger Band indicator.
 *
 * The Bollinger band is a three-line volatility indicator
 * (John Bollinger, 1980s; widely used in classical technical
 * analysis — Bollinger 2001, "Bollinger on Bollinger Bands",
 * McGraw-Hill; the canonical 20-period, 2-σ defaults are
 * universally adopted in retail charting):
 *
 *   - `middle` = simple moving average (SMA) of `bar.close` over
 *     the last `period` bars — the "equilibrium" / trend baseline.
 *   - `upper`  = middle + stdDevMultiplier * sample standard deviation
 *     of `bar.close` over the last `period` bars — the "overbought"
 *     envelope.
 *   - `lower`  = middle - stdDevMultiplier * sample standard deviation
 *     of `bar.close` over the last `period` bars — the "oversold"
 *     envelope.
 *
 * The web client computes the band client-side from the OHLC bar
 * stream (the bot's strategy runners do not currently publish
 * `publishIndicator` calls for the Bollinger — same pattern as
 * `donchian.ts`, which also computes client-side from the bar
 * stream; see `apps/web/src/indicators/client-compute.ts`).
 *
 * **Why a NEW file rather than extending `donchian.ts`:** the
 * Donchian channel and the Bollinger band have different
 * mathematical definitions, different per-bar lookback windows
 * (Donchian = max(high) / min(low); Bollinger = SMA / stddev of
 * close), and the Phase 79 `IndicatorRegistry` dispatches per
 * indicator name. The cleanest factoring is one file per
 * indicator. The renderer here mirrors `renderDonchian`'s
 * pattern (3 line series, fixed order, dispose removes them
 * all) so the two indicators look identical at the chart level.
 *
 * **Color scheme (locked in `BOLLINGER_COLORS`):**
 *   - upper  : gold (`#E3B563`, --ep-yolk-500) — overbought
 *   - middle : muted slate (`#5C6981`, --ep-fg-muted) — the SMA
 *   - lower  : red (`#ef4444`) — oversold
 *
 * Same palette as `renderDonchian` (Phase 78) so the chart's
 * "overbought / equilibrium / oversold" envelope reads the same
 * regardless of which channel indicator is active.
 *
 * **Deviation from the spec (documented):** the spec lists
 * `--ep-coral-500` for the lower band but no `coral` token
 * exists in the eggproject design system shipped in
 * `apps/web/src/styles/chart-card.css`. The renderer's lower
 * band uses `#ef4444` (the same red used by `barToMarker` for
 * sell / short markers, and by the Donchian lower band).
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
 * The Bollinger indicator name as registered in `IndicatorRegistry`.
 *
 * The strategy code in `packages/strategies/` references this exact
 * string in its `INDICATOR` messages, so a typo here would silently
 * fail to render — keep in sync with the strategy.
 */
export const BOLLINGER_INDICATOR_NAME = "bollinger" as const;

/**
 * The three named series the Bollinger indicator produces.
 *
 * Defined as a closed tuple so the renderer can iterate them in a
 * fixed order (upper → middle → lower) — the order matters for
 * `RenderedIndicator.series`, because ChartCard and any
 * downstream consumers rely on positional indexing into it.
 */
export const BOLLINGER_SERIES_KEYS = ["upper", "middle", "lower"] as const;
export type BollingerSeriesKey = (typeof BOLLINGER_SERIES_KEYS)[number];

/**
 * `DEFAULT_BOLLINGER_PERIOD` — the canonical Bollinger band period
 * (20 bars — Bollinger's original default; universally adopted in
 * retail charting). The 20-period default matches the 20-bar
 * lookback of the Donchian band (Phase 78), so a chart with both
 * bands renders two overlapping envelopes that the user can
 * visually compare on the same time axis.
 */
export const DEFAULT_BOLLINGER_PERIOD = 20 as const;

/**
 * `DEFAULT_BOLLINGER_STDDEV_MULTIPLIER` — the canonical 2-σ
 * multiplier (Bollinger's original default). At 2-σ, the bands
 * cover roughly 95% of normally-distributed close prices; that
 * is the standard convention in Bollinger band literature.
 */
export const DEFAULT_BOLLINGER_STDDEV_MULTIPLIER = 2 as const;

/**
 * Theme colors used by `renderBollinger`.
 *
 * Mirrors the spec's intent (matches the Donchian palette):
 *   - upper  : gold (`--ep-yolk-500`)   — overbought
 *   - middle : muted slate (`--ep-fg-muted`) — the SMA
 *   - lower  : red (`#ef4444`)          — oversold
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
export const BOLLINGER_COLORS: Readonly<Record<BollingerSeriesKey, string>> = {
  upper: "#E3B563", // --ep-yolk-500
  middle: "#5C6981", // --ep-fg-muted (dark theme: --ep-slate-500)
  lower: "#ef4444", // matches the red used by barToMarker / Donchian lower
};

/**
 * `BOLLINGER_TITLES` — the per-line `title` option set on each
 * `addSeries(LineSeries, ...)` call. The title appears in the
 * lightweight-charts built-in legend so the user can identify
 * each line at a glance.
 *
 * Phase 82 (chart redesign): the chart shows the Bollinger band
 * ALONGSIDE the Donchian channel (both indicators are on the
 * same chart for `donchian_pivot_composition`). The Bollinger
 * titles are prefixed with "BB " to distinguish them from the
 * Donchian UPPER/MIDDLE/LOWER titles — same vertical position
 * visually, different label.
 */
export const BOLLINGER_TITLES: Readonly<Record<BollingerSeriesKey, string>> = {
  upper: "BB UPPER",
  middle: "BB MIDDLE",
  lower: "BB LOWER",
};

/**
 * The typed shape of a validated Bollinger series.
 *
 * Every value is `number | null` (the `null` case is filtered out
 * by the renderer when building the `LineData` arrays — see
 * `renderBollinger`).
 */
export interface BollingerSeries extends IndicatorSeries {
  readonly upper: readonly (number | null)[];
  readonly middle: readonly (number | null)[];
  readonly lower: readonly (number | null)[];
}

// ============================================================================
// Pure compute — the math
// ============================================================================

/**
 * `isFiniteNumber(x)` — strict "usable for arithmetic" check.
 *
 * Returns `true` only for finite numbers (rejects `NaN`, `Infinity`,
 * `-Infinity`, `null`, `undefined`, strings, booleans, objects).
 *
 * Used to defensively guard the per-bar close value before it
 * enters the SMA / stddev accumulator: a `NaN` close would
 * propagate to every later bar's mean and stdev (the running
 * mean is `NaN` once any input is `NaN`), silently corrupting
 * the entire band from that bar onward. We instead emit `null`
 * for that bar and re-seed the window on the next valid bar.
 */
function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * `computeBollingerBand(bars, period, stdDevMultiplier)` —
 * compute the Bollinger band (upper / middle / lower) from a
 * bar series.
 *
 * Definitions (Bollinger 2001, "Bollinger on Bollinger Bands"):
 *   - `middle` = SMA(`bar.close`, period)        — arithmetic mean
 *   - `upper`  = middle + k * σ(close, period)   — overbought
 *   - `lower`  = middle - k * σ(close, period)   — oversold
 *   where σ is the SAMPLE standard deviation
 *   (denominator `n - 1`; the `n - 1` Bessel correction makes
 *   the sample stddev an unbiased estimator of the population
 *   stddev when the window is a sample of a larger series).
 *
 * Edge cases (mirror `computeDonchianFromBars` conventions):
 *   - `bars.length === 0`           → every value is `null` (no bars)
 *   - `bars.length < period`        → first `period - bars.length`
 *     values are `null` (warmup period); if `bars.length` is
 *     strictly less than `period` the band is undefined for
 *     every bar (a partial window produces a biased mean and
 *     a downward-biased stdev; we don't try to estimate it).
 *   - `period <= 0`                 → every value is `null`
 *     (defensive — a 0-period band is meaningless)
 *   - `stdDevMultiplier <= 0`       → every value is `null`
 *     (defensive — a 0-σ band degenerates to the SMA)
 *   - `bar.close` is `NaN` /
 *     `Infinity` / non-number       → `null` for that bar AND
 *     every subsequent bar (the running mean is contaminated).
 *     The `null` for the bad bar itself; for every LATER bar
 *     the running mean is corrupted, so the band is `null`
 *     from the bad bar onward. A future enhancement could
 *     re-seed the accumulator on the next valid bar, but the
 *     current behavior is the safe fallback (a chart with
 *     `NaN` closes is misconfigured; the conservative response
 *     is to stop rendering the band).
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`, no
 * mutation of the input array.
 *
 * @param bars             - time-ascending OHLC bar series (the
 *                           chart card passes the same array it
 *                           renders)
 * @param period           - the SMA / stdev lookback; defaults to 20
 * @param stdDevMultiplier - the band-width multiplier; defaults to 2
 * @returns                - `{ upper, middle, lower }` arrays of
 *                           length `bars.length`, with `null` for
 *                           the warmup period and any defensive-
 *                           guard hit
 */
export function computeBollingerBand(
  bars: readonly OHLCBar[],
  period: number = DEFAULT_BOLLINGER_PERIOD,
  stdDevMultiplier: number = DEFAULT_BOLLINGER_STDDEV_MULTIPLIER,
): BollingerSeries {
  const n = bars.length;
  const upper: (number | null)[] = new Array<number | null>(n).fill(null);
  const middle: (number | null)[] = new Array<number | null>(n).fill(null);
  const lower: (number | null)[] = new Array<number | null>(n).fill(null);

  // Defensive guards — return all-null on invalid inputs. We do
  // NOT throw (the convention in the rest of the indicators
  // directory is to return all-null and let the renderer / chart
  // gracefully handle the empty series).
  if (period <= 0 || !Number.isFinite(period)) {
    return { upper, middle, lower };
  }
  if (stdDevMultiplier <= 0 || !Number.isFinite(stdDevMultiplier)) {
    return { upper, middle, lower };
  }
  if (n === 0) {
    return { upper, middle, lower };
  }
  // Warmup period: not enough bars to fill the window. With a
  // partial window, the sample-stdev denominator (`n - 1`) would
  // be 0, and a partial mean is a biased estimator — we decline
  // to compute it. The renderer filters the `null` values, so
  // the chart shows a gap on the warmup range.
  if (n < period) {
    return { upper, middle, lower };
  }

  // Initial window: bars[0..period-1]. We pre-compute the mean
  // and the running sum of squared differences (the textbook
  // streaming variance algorithm — Welford 1962; numerically
  // stable; O(1) per step). The first window is O(period), and
  // every subsequent window is O(1) (just drop the leaving bar
  // and add the entering bar to the running stats).
  let mean = 0;
  for (let i = 0; i < period; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const close = bars[i].close;
    if (!isFiniteNumber(close)) {
      // NaN in the initial window: we can't seed a valid running
      // mean. Mark this bar AND every later bar as `null` (a
      // NaN-contaminated mean is meaningless). The renderer
      // short-circuits on the first all-null bar, but the
      // explicit `null` writes document the contamination.
      return { upper, middle, lower };
    }
    mean += close;
  }
  mean /= period;
  let sumSqDiff = 0;
  for (let i = 0; i < period; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const diff = bars[i].close - mean;
    sumSqDiff += diff * diff;
  }
  // Sample standard deviation: denominator `period - 1` (Bessel
  // correction). `period >= 1` here (we already returned for
  // `period <= 0` and `n < period`).
  let sampleStd = Math.sqrt(sumSqDiff / (period - 1));
  middle[period - 1] = mean;
  upper[period - 1] = mean + stdDevMultiplier * sampleStd;
  lower[period - 1] = mean - stdDevMultiplier * sampleStd;

  // Rolling window: drop bars[i - period], add bars[i]. We use
  // the Welford 1962 online-update formula (Chan's algorithm —
  // Chan 1979, "Updating Formulae and a Pairwise Algorithm for
  // Computing Sample Variances", Stanford CS technical report):
  //
  //   mean' = mean + (x_new - x_old) / period
  //   M2'   = M2 + (x_new - mean_old) * (x_new - mean_new)
  //                - (x_old - mean_old) * (x_old - mean_new)
  //
  // where M2 = sum((x - mean)^2). The two cross-product terms
  // each use ONE OLD and ONE NEW mean (NOT both old or both
  // new) — that is the textbook formula. A common bug is to
  // use `(x_new - mean_new)² - (x_old - mean_old)²`, which
  // silently agrees with the correct formula when the variance
  // is constant across the rolling step but DIVERGES by
  // `2 * mean_old * (x_new - x_old)` when the variance
  // changes. We use the correct Chan's algorithm here.
  //
  // The formula is O(1) per step and avoids the
  // catastrophic-cancellation risk of the naive
  // "sum of squares minus square of sum" formula on long
  // windows (the textbook reference: Welford 1962, "Note on a
  // method for calculating corrected sums of squares and
  // products", Technometrics 4(3):419-420).
  for (let i = period; i < n; i += 1) {
    const outClose = bars[i - period].close;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    const inClose = bars[i].close;

    if (!isFiniteNumber(outClose) || !isFiniteNumber(inClose)) {
      // NaN entering or leaving the window: the running mean is
      // corrupted. Mark this bar AND every later bar as `null`.
      // (The arrays are already all-null above the warmup; we
      // exit the loop to skip the rest of the updates.)
      break;
    }

    const newMean = mean + (inClose - outClose) / period;
    // Chan's algorithm cross-products: each uses ONE OLD mean
    // and ONE NEW mean. (The naive `(x - mean)²` would use the
    // same mean twice — wrong unless variance is constant.)
    const sumSqDiffOut = (outClose - mean) * (outClose - newMean);
    const sumSqDiffIn = (inClose - mean) * (inClose - newMean);
    let newSumSqDiff = sumSqDiff + sumSqDiffIn - sumSqDiffOut;
    if (newSumSqDiff < 0) {
      // Numerical floor: floating-point rounding can push M2 a
      // tiny negative amount below zero. Clamp to 0; the
      // resulting stddev is 0 and the band degenerates to a
      // horizontal line at the mean, which is the correct
      // behavior for a window where every close is identical.
      newSumSqDiff = 0;
    }
    sampleStd = Math.sqrt(newSumSqDiff / (period - 1));
    mean = newMean;
    sumSqDiff = newSumSqDiff;

    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    middle[i] = mean;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    upper[i] = mean + stdDevMultiplier * sampleStd;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    lower[i] = mean - stdDevMultiplier * sampleStd;
  }

  return { upper, middle, lower };
}

// ============================================================================
// validateBollingerSeries
// ============================================================================

/**
 * `validateBollingerSeries` — type-guard + structural validation.
 *
 * Returns the typed `BollingerSeries` if valid, else `null`. The
 * caller is expected to log a warning and skip rendering when
 * `null` is returned.
 *
 * Validity rules (mirror `validateDonchianSeries`):
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
export function validateBollingerSeries(
  series: IndicatorSeries,
  bars: readonly OHLCBar[],
): BollingerSeries | null {
  // Defensive read — same pattern as `validateDonchianSeries`.
  // The bracket access is the only way to address a
  // `Record<string, _>` with a known string key; we silence the
  // dot-notation rule per line.
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

  // Rule 4: every value must be a number or null.
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
// renderBollinger
// ============================================================================

/**
 * Build the `LineData[]` for one Bollinger sub-series.
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
 * `BollingerSeriesKey`; adding a new key to the union will trigger
 * a TS error here.
 */
function colorFor(key: BollingerSeriesKey): string {
  if (key === "upper") return BOLLINGER_COLORS.upper;
  if (key === "middle") return BOLLINGER_COLORS.middle;
  // The final equality is "unnecessary" at the type level
  // (TypeScript has narrowed `key` to `"lower"`), but the
  // runtime check is required so the exhaustiveness cast
  // below fires if the type system is bypassed.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (key === "lower") return BOLLINGER_COLORS.lower;
  // Exhaustiveness check: if a new key is added to
  // BollingerSeriesKey without a branch above, this assignment
  // fails to compile (TypeScript proves `key` is not `never`).
  const _exhaustive: never = key;
  throw new Error(`colorFor: unknown key ${String(_exhaustive)}`);
}

/**
 * Look up the legend title for `key`. Mirrors `colorFor` but
 * returns the human-readable label for the lightweight-charts
 * built-in legend. The values come from `BOLLINGER_TITLES`.
 */
function titleFor(key: BollingerSeriesKey): string {
  if (key === "upper") return BOLLINGER_TITLES.upper;
  if (key === "middle") return BOLLINGER_TITLES.middle;
  // Same runtime-vs-type reasoning as `colorFor` above.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (key === "lower") return BOLLINGER_TITLES.lower;
  const _exhaustive: never = key;
  throw new Error(`titleFor: unknown key ${String(_exhaustive)}`);
}

/**
 * Look up the values array for `key` in `indicatorSeries`. Returns
 * `undefined` if the key is absent.
 *
 * Because `apps/web`'s tsconfig does not enable
 * `noUncheckedIndexedAccess`, `Record<string, T>[key]` is typed
 * as `T` (not `T | undefined`). To distinguish "key present with
 * the default value" from "key absent", we use a switch on the
 * closed `BollingerSeriesKey` union plus a `hasOwnProperty`
 * presence check. The switch is exhaustive (the `never` default
 * is the compile-time exhaustiveness check), so adding a new
 * series key triggers a TS error here.
 */
function valuesFor(
  indicatorSeries: IndicatorSeries,
  key: BollingerSeriesKey,
): readonly (number | null)[] | undefined {
  if (key === "upper") {
    return hasArrayKey(indicatorSeries, "upper")
      ? indicatorSeries.upper
      : undefined;
  }
  if (key === "middle") {
    return hasArrayKey(indicatorSeries, "middle")
      ? indicatorSeries.middle
      : undefined;
  }
  // Same runtime-vs-type reasoning as `colorFor` above.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (key === "lower") {
    return hasArrayKey(indicatorSeries, "lower")
      ? indicatorSeries.lower
      : undefined;
  }
  // Same exhaustiveness pattern as `colorFor` above.
  const _exhaustive: never = key;
  throw new Error(`valuesFor: unknown key ${String(_exhaustive)}`);
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
 * `validateBollingerSeries` structural rules.
 *
 * Returns a typed boolean so the caller can chain it with
 * dot-access (which TS narrows to the value type for known keys
 * — see the `valuesFor` switch above).
 */
function hasArrayKey(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  // The `key` is a closed `BollingerSeriesKey` at every call site
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
 * `renderBollinger` — the `IndicatorRenderer` for the Bollinger band.
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
 *     the conventional way to render a partial Bollinger band
 *     during warmup).
 *
 * **Idempotency:** the renderer does NOT track prior state — the
 * caller is expected to call the previous `RenderedIndicator.dispose()`
 * before invoking the renderer again. The renderer is a pure
 * description of "given this context, here is what to add to the
 * chart"; cleanup is the caller's job.
 */
export const renderBollinger: IndicatorRenderer = (
  ctx: IndicatorContext,
): RenderedIndicator => {
  const { chart, bars, indicatorSeries, strategy, timeframe } = ctx;

  // Short-circuit: no bars → no series.
  if (bars.length === 0) {
    return {
      name: `bollinger-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: nothing to dispose when no series were added
      },
    };
  }

  // Per-key handling: log + skip if the key is missing.
  const series: ISeriesApi<"Line">[] = [];
  for (const key of BOLLINGER_SERIES_KEYS) {
    const values = valuesFor(indicatorSeries, key);
    if (values === undefined) {
      console.warn(
        `[renderBollinger] missing '${key}' series for ${strategy}@${timeframe} — skipping`,
      );
      continue;
    }

    // `addSeries(LineSeries, opts)` — v5 API. Phase 82: the `title`
    // option sets the line's legend label so the user can see
    // "BB UPPER" / "BB MIDDLE" / "BB LOWER" in the chart's
    // built-in legend — distinguishes the Bollinger band from
    // the Donchian band (both are on the same chart for
    // `donchian_pivot_composition`). `priceLineVisible: false`
    // suppresses the right-edge price-line marker (the chart
    // has a price scale already; 3 Bollinger + 3 Donchian + 1
    // pivot + 1 daily-pivot = 8 right-edge markers would
    // visually clutter the chart). `lastValueVisible: true`
    // enables the right-edge last-value label — required so
    // the title appears in the chart's built-in legend.
    const lineSeries = chart.addSeries(LineSeries, {
      color: colorFor(key),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      title: titleFor(key),
    });

    lineSeries.setData(buildLineData(bars, values));
    series.push(lineSeries);
  }

  // `dispose` removes every series in a single pass; `removeSeries`
  // is O(N) in the chart's own bookkeeping but constant in the
  // number of series we added (3 for the Bollinger band).
  const dispose = (): void => {
    for (const s of series) {
      chart.removeSeries(s);
    }
  };

  return {
    name: `bollinger-${timeframe}-${strategy}`,
    series,
    dispose,
  };
};

/**
 * `@internal` test-only re-exports. Production code uses
 * `colorFor` / `valuesFor` indirectly through `renderBollinger`.
 * The `__testing` export exists ONLY so unit tests can exercise
 * the TypeScript `never`-typed default branches with invalid
 * keys (cast through `unknown`). Do NOT import `__testing` from
 * production code.
 */
export const __testing = { colorFor, valuesFor, titleFor } as const;
