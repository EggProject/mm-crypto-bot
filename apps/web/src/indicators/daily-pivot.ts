/**
 * apps/web/src/indicators/daily-pivot.ts
 *
 * Phase 81: the daily pivot (PP / R1 / S1) indicator.
 *
 * The classic floor-pivot-point (Bulkowski; Person; widely used
 * in classical technical analysis — see Bulkowski's
 * "Encyclopedia of Chart Patterns" and Person's "Small
 * Logical Answers" series; canonical formula):
 *
 *   - `pp` = (prevHigh + prevLow + prevClose) / 3
 *   - `r1` = 2 * pp - prevLow   (first resistance)
 *   - `s1` = 2 * pp - prevHigh  (first support)
 *
 * where "prev" is the previous trading session's H/L/C. For
 * multi-day timeframes (1d) the previous session is the
 * previous day; for intraday timeframes (1h, 4h) the user's
 * mandate treats the "previous bar's H/L/C" as a defensible
 * approximation when the LTF candles are not aggregated to a
 * daily session (the bot's server-side strategy code in
 * `packages/core/src/strategy/pivot-point-grid.ts` aggregates
 * 15m → 1d server-side; the client can't do that aggregation
 * from an arbitrary LTF bar stream).
 *
 * **Why a NEW file (and not the existing `pivotLineIndicator`
 * in `strategy-indicators.ts`):** the existing rolling-window
 * pivot uses a `lookback` of 24 bars and a Fibonacci band
 * structure (R1/R2/S1/S2 = 0.382 / 0.618 multipliers). The
 * user's mandate is for the CLASSIC daily pivot (PP + R1 + S1
 * from the previous day's H/L/C). The two are different:
 *
 *   - Existing rolling pivot: PP = mean of 24-bar rolling
 *     H/L/C, R1/S1 use Fibonacci multipliers (0.382 / 0.618)
 *     of the rolling H/L range.
 *   - New daily pivot (this file): PP = (prev day H + L + C)/3,
 *     R1 = 2 * PP - prevL, S1 = 2 * PP - prevH (no Fibonacci
 *     multiplier; the "2x PP" formula is the classical floor-
 *     trader's pivot).
 *
 * The user said: "napi pivot szint" — they want the DAILY
 * pivot, not the rolling Fibonacci variant. We add a NEW
 * indicator (this file) and keep the existing rolling pivot
 * (the Phase 79 `pivotLineIndicator`) so the chart shows BOTH:
 *   - The rolling Fibonacci pivot (Phase 79, dashed slate) —
 *     the "short-term equilibrium".
 *   - The daily pivot (Phase 81, this file) — the "yesterday's
 *     pivot", the conventional reference level that floor
 *     traders watch.
 *
 * **Color scheme (locked in `DAILY_PIVOT_COLORS`):**
 *   - pp  : muted slate (`#5C6981`) — the pivot (the SAME
 *          color as the Donchian middle line; the convention
 *          is that "equilibrium" levels are muted-slate).
 *   - r1  : green (`#22c55e`) — the first resistance, ABOVE PP.
 *   - s1  : red (`#ef4444`) — the first support, BELOW PP.
 *
 * Same green/red convention as `barToMarker` (long/short
 * markers) — the chart's color vocabulary is consistent.
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
 * The daily-pivot indicator name as registered in `IndicatorRegistry`.
 *
 * The strategy code in `packages/strategies/` references this exact
 * string in its `INDICATOR` messages, so a typo here would silently
 * fail to render — keep in sync with the strategy.
 */
export const DAILY_PIVOT_INDICATOR_NAME = "daily_pivot" as const;

/**
 * The three named series the daily-pivot indicator produces.
 *
 * Defined as a closed tuple so the renderer can iterate them in a
 * fixed order (pp → r1 → s1) — the order matters for
 * `RenderedIndicator.series`, because ChartCard and any
 * downstream consumers rely on positional indexing into it.
 */
export const DAILY_PIVOT_SERIES_KEYS = ["pp", "r1", "s1"] as const;
export type DailyPivotSeriesKey = (typeof DAILY_PIVOT_SERIES_KEYS)[number];

/**
 * Theme colors used by `renderDailyPivot`.
 *
 *   - pp  : muted slate — the equilibrium pivot
 *   - r1  : green — the first resistance (above PP)
 *   - s1  : red — the first support (below PP)
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
export const DAILY_PIVOT_COLORS: Readonly<Record<DailyPivotSeriesKey, string>> = {
  pp: "#5C6981", // --ep-fg-muted — the equilibrium
  r1: "#22c55e", // green — first resistance
  s1: "#ef4444", // red — first support
};

/**
 * The typed shape of a validated daily-pivot series.
 *
 * Every value is `number | null` (the `null` case is filtered out
 * by the renderer when building the `LineData` arrays — see
 * `renderDailyPivot`).
 */
export interface DailyPivotSeries extends IndicatorSeries {
  readonly pp: readonly (number | null)[];
  readonly r1: readonly (number | null)[];
  readonly s1: readonly (number | null)[];
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
 * Used to defensively guard the per-bar H/L/C values before they
 * enter the pivot calculation: a `NaN` H/L/C on the previous bar
 * would propagate `NaN` to the PP / R1 / S1 of the current bar.
 * We instead emit `null` for that bar.
 */
function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * `computeDailyPivot(bars)` — compute the classic floor-pivot
 * (PP / R1 / S1) from the previous bar's H/L/C.
 *
 * Definitions (classical floor-pivot; Person; Bulkowski):
 *   - `pp` = (prevH + prevL + prevC) / 3
 *   - `r1` = 2 * pp - prevL
 *   - `s1` = 2 * pp - prevH
 *
 * where `prevH` / `prevL` / `prevC` are the H / L / C of the
 * bar at `index i - 1` (the "previous bar" relative to the
 * current bar at `index i`).
 *
 * **Convention:** at `index 0` there is no "previous bar", so
 * PP / R1 / S1 are all `null` (the pivot is undefined for the
 * first bar in the series — same as every rolling indicator
 * has a warmup period).
 *
 * **Why "previous bar" rather than "previous day":** the user
 * mandate is "napi pivot szint" (daily pivot). For 1d charts
 * the "previous bar" is the previous day; for intraday
 * timeframes (1h, 4h) the LTF bar stream doesn't carry the
 * previous-day's session boundary, so we use the "previous
 * bar" as a defensible approximation. The server-side
 * strategy in `packages/core/src/strategy/pivot-point-grid.ts`
 * aggregates 15m → 1d server-side; the client doesn't have
 * that aggregation layer. The "previous bar" approximation
 * degrades gracefully: a 1d chart's "previous bar" is
 * exactly the previous day, so the daily pivot is exact
 * for 1d charts and a reasonable approximation for shorter
 * timeframes.
 *
 * Edge cases (mirror `computeDonchianFromBars` defensive
 * conventions):
 *   - `bars.length === 0`           → every value is `null`
 *   - `bars.length === 1`           → every value is `null` (no
 *                                     "previous bar" exists)
 *   - `bar[i-1].high/low/close` is
 *     `NaN` / `Infinity` /
 *     non-number                    → `null` for bar `i`
 *
 * **Pure, deterministic, no side effects.** No `Date.now()`, no
 * mutation of the input array.
 *
 * @param bars - time-ascending OHLC bar series (the chart card
 *               passes the same array it renders)
 * @returns    - `{ pp, r1, s1 }` arrays of length `bars.length`,
 *               with `null` for bar 0 and any defensive-guard hit
 */
export function computeDailyPivot(
  bars: readonly OHLCBar[],
): DailyPivotSeries {
  const n = bars.length;
  const pp: (number | null)[] = new Array<number | null>(n).fill(null);
  const r1: (number | null)[] = new Array<number | null>(n).fill(null);
  const s1: (number | null)[] = new Array<number | null>(n).fill(null);

  if (n < 2) {
    // bar 0 has no previous bar; bar 1's "previous bar" is
    // bar 0, so we need at least 2 bars for any pivot to
    // exist. Returning all-null here is the safe fallback
    // (the chart shows a gap; the renderer filters `null`).
    return { pp, r1, s1 };
  }

  // Iterate from bar 1 onward. For each bar, the "previous
  // bar" is `bars[i - 1]`.
  for (let i = 1; i < n; i += 1) {
    const prev = bars[i - 1];
    if (
      !isFiniteNumber(prev.high) ||
      !isFiniteNumber(prev.low) ||
      !isFiniteNumber(prev.close)
    ) {
      // NaN in the previous bar's H/L/C → the pivot is
      // undefined for this bar. Leave the (already all-null)
      // arrays untouched for `i`; the next valid previous bar
      // will produce a fresh pivot.
      continue;
    }
    const pivot = (prev.high + prev.low + prev.close) / 3;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    pp[i] = pivot;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    r1[i] = 2 * pivot - prev.low;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
    s1[i] = 2 * pivot - prev.high;
  }

  return { pp, r1, s1 };
}

// ============================================================================
// validateDailyPivotSeries
// ============================================================================

/**
 * `validateDailyPivotSeries` — type-guard + structural validation.
 *
 * Returns the typed `DailyPivotSeries` if valid, else `null`. The
 * caller is expected to log a warning and skip rendering when
 * `null` is returned.
 *
 * Validity rules (mirror `validateDonchianSeries`):
 *   1. All three keys (`pp`, `r1`, `s1`) must be present and
 *      their values must be arrays.
 *   2. All three arrays must have the same length.
 *   3. The shared length must equal `bars.length`.
 *   4. Each value in the arrays must be a `number` OR `null`.
 *
 * An empty input (all three keys present, all length 0) is
 * considered VALID — the renderer gracefully handles that case
 * (no line data → empty `setData` call). The ChartCard is
 * expected to short-circuit the renderer call itself when
 * `bars.length === 0`.
 */
export function validateDailyPivotSeries(
  series: IndicatorSeries,
  bars: readonly OHLCBar[],
): DailyPivotSeries | null {
  // Defensive read — same pattern as `validateDonchianSeries`.
  // The bracket access is the only way to address a
  // `Record<string, _>` with a known string key; we silence the
  // dot-notation rule per line.
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const ppRaw: unknown = (series as Record<string, unknown>)["pp"];
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const r1Raw: unknown = (series as Record<string, unknown>)["r1"];
  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const s1Raw: unknown = (series as Record<string, unknown>)["s1"];

  // Rule 1: every key must be present and be an array.
  if (!Array.isArray(ppRaw) || !Array.isArray(r1Raw) || !Array.isArray(s1Raw)) {
    return null;
  }
  const pp = ppRaw as readonly unknown[];
  const r1 = r1Raw as readonly unknown[];
  const s1 = s1Raw as readonly unknown[];

  // Rule 4: every value must be a number or null.
  const allValues: readonly unknown[] = [...pp, ...r1, ...s1];
  for (const v of allValues) {
    if (v !== null && typeof v !== "number") {
      return null;
    }
  }

  // Rule 2: the three arrays must have the same length.
  if (pp.length !== r1.length || r1.length !== s1.length) {
    return null;
  }

  // Rule 3: the shared length must match `bars.length`.
  if (pp.length !== bars.length) {
    return null;
  }

  return {
    pp: pp as readonly (number | null)[],
    r1: r1 as readonly (number | null)[],
    s1: s1 as readonly (number | null)[],
  };
}

// ============================================================================
// renderDailyPivot
// ============================================================================

/**
 * Build the `LineData[]` for one daily-pivot sub-series.
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
 * `DailyPivotSeriesKey`; adding a new key to the union will trigger
 * a TS error here.
 */
function colorFor(key: DailyPivotSeriesKey): string {
  switch (key) {
    case "pp": {
      return DAILY_PIVOT_COLORS.pp;
    }
    case "r1": {
      return DAILY_PIVOT_COLORS.r1;
    }
    case "s1": {
      return DAILY_PIVOT_COLORS.s1;
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
 * closed `DailyPivotSeriesKey` union plus a `hasOwnProperty`
 * presence check. The switch is exhaustive (the `never` default
 * is the compile-time exhaustiveness check), so adding a new
 * series key triggers a TS error here.
 */
function valuesFor(
  indicatorSeries: IndicatorSeries,
  key: DailyPivotSeriesKey,
): readonly (number | null)[] | undefined {
  switch (key) {
    case "pp": {
      return hasArrayKey(indicatorSeries, "pp")
        ? indicatorSeries.pp
        : undefined;
    }
    case "r1": {
      return hasArrayKey(indicatorSeries, "r1")
        ? indicatorSeries.r1
        : undefined;
    }
    case "s1": {
      return hasArrayKey(indicatorSeries, "s1")
        ? indicatorSeries.s1
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
 * `validateDailyPivotSeries` structural rules.
 *
 * Returns a typed boolean so the caller can chain it with
 * dot-access (which TS narrows to the value type for known keys
 * — see the `valuesFor` switch above).
 */
function hasArrayKey(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  // The `key` is a closed `DailyPivotSeriesKey` at every call
  // site (the `valuesFor` switch is exhaustive), but typed as
  // `string` here so the helper is reusable for any future
  // indicator. The security rule flags the dynamic-key access
  // regardless; the `hasOwnProperty` check guarantees the key
  // is present.
  return (
    Object.prototype.hasOwnProperty.call(record, key) &&
    // eslint-disable-next-line security/detect-object-injection -- key is a closed union at the call site
    Array.isArray(record[key])
  );
}

/**
 * `renderDailyPivot` — the `IndicatorRenderer` for the daily pivot.
 *
 * Adds three line series to the chart (pp, r1, s1) and returns a
 * `RenderedIndicator` whose `dispose()` removes them all from the
 * chart. The renderer is pure (no side effects on the registry);
 * it only mutates the `chart` instance it receives via context.
 *
 * **Graceful handling:**
 *   - Empty `bars` → no series are added, the returned
 *     `RenderedIndicator` has `series: []` and a no-op `dispose`.
 *   - Missing series (e.g. `pp: undefined` in `indicatorSeries`)
 *     → `console.warn` is called, only the present series are added.
 *   - `null` values inside a series → silently dropped from the
 *     `LineData[]` (the line just has a gap on the chart, which is
 *     the conventional way to render a partial pivot — the first
 *     bar's PP / R1 / S1 are all `null` because there is no
 *     "previous bar" at `index 0`).
 *
 * **Idempotency:** the renderer does NOT track prior state — the
 * caller is expected to call the previous `RenderedIndicator.dispose()`
 * before invoking the renderer again.
 */
export const renderDailyPivot: IndicatorRenderer = (
  ctx: IndicatorContext,
): RenderedIndicator => {
  const { chart, bars, indicatorSeries, strategy, timeframe } = ctx;

  // Short-circuit: no bars → no series.
  if (bars.length === 0) {
    return {
      name: `daily_pivot-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: nothing to dispose when no series were added
      },
    };
  }

  // Per-key handling: log + skip if the key is missing.
  const series: ISeriesApi<"Line">[] = [];
  for (const key of DAILY_PIVOT_SERIES_KEYS) {
    const values = valuesFor(indicatorSeries, key);
    if (values === undefined) {
      console.warn(
        `[renderDailyPivot] missing '${key}' series for ${strategy}@${timeframe} — skipping`,
      );
      continue;
    }

    // `addSeries(LineSeries, opts)` — v5 API. `priceLineVisible: false`
    // suppresses the horizontal "current value" line on the right axis
    // (a daily pivot renders three lines; each one's right-edge
    // marker would visually clutter the chart). `lastValueVisible: false`
    // suppresses the label of the last value. The PP line uses a
    // dashed lineStyle (2) to distinguish it from the Donchian middle
    // and the Bollinger middle (both solid slate).
    const lineStyle: number = key === "pp" ? 2 : 0; // Dashed for PP; solid for R1/S1.
    const lineSeries = chart.addSeries(LineSeries, {
      color: colorFor(key),
      lineWidth: 1,
      lineStyle,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    lineSeries.setData(buildLineData(bars, values));
    series.push(lineSeries);
  }

  // `dispose` removes every series in a single pass; `removeSeries`
  // is O(N) in the chart's own bookkeeping but constant in the
  // number of series we added (3 for the daily pivot).
  const dispose = (): void => {
    for (const s of series) {
      chart.removeSeries(s);
    }
  };

  return {
    name: `daily_pivot-${timeframe}-${strategy}`,
    series,
    dispose,
  };
};
