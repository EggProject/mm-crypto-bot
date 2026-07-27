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
 * Every value is `number | null` (the `null` case is filtered
 * by the renderer when extracting the most recent non-null
 * level — see `renderDailyPivot`).
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
 * Look up the theme color for `key` using dot access (not indexed
 * access) so the `security/detect-object-injection` rule has no
 * dynamic-key surface to flag. The switch is exhaustive over
 * `DailyPivotSeriesKey`; adding a new key to the union will trigger
 * a TS error here.
 */
function colorFor(key: DailyPivotSeriesKey): string {
  if (key === "pp") return DAILY_PIVOT_COLORS.pp;
  if (key === "r1") return DAILY_PIVOT_COLORS.r1;
  // The final equality is "unnecessary" at the type level
  // (TypeScript has narrowed `key` to `"s1"`), but the runtime
  // check is required so the exhaustiveness cast below fires if
  // the type system is bypassed.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (key === "s1") return DAILY_PIVOT_COLORS.s1;
  // Exhaustiveness check: if a new key is added to
  // DailyPivotSeriesKey without a branch above, this assignment
  // fails to compile (TypeScript proves `key` is not `never`).
  const _exhaustive: never = key;
  throw new Error(`colorFor: unknown key ${String(_exhaustive)}`);
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
  if (key === "pp") {
    return hasArrayKey(indicatorSeries, "pp")
      ? indicatorSeries.pp
      : undefined;
  }
  if (key === "r1") {
    return hasArrayKey(indicatorSeries, "r1")
      ? indicatorSeries.r1
      : undefined;
  }
  // Same runtime-vs-type reasoning as `colorFor` above.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (key === "s1") {
    return hasArrayKey(indicatorSeries, "s1")
      ? indicatorSeries.s1
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
 * `extractMostRecentPivot` — read the last non-null values of
 * `pp` / `r1` / `s1` from a `DailyPivotSeries`. Returns `null`
 * when the array is empty or every value is `null` (the
 * renderer's defensive short-circuit).
 *
 * Phase 82: the redesign uses ONLY the most recent day's
 * pivot levels (the "yesterday's pivot" reference level that
 * floor traders watch). Older pivot values are dropped — the
 * chart's per-bar stair-step history of pivot levels is the
 * "ribbon indicator" clutter the user complained about.
 */
function extractMostRecentPivot(
  pp: readonly (number | null)[] | undefined,
  r1: readonly (number | null)[] | undefined,
  s1: readonly (number | null)[] | undefined,
): { pp: number; r1: number; s1: number } | null {
  const lastNonNull = (
    arr: readonly (number | null)[] | undefined,
  ): number | null => {
    if (arr === undefined) return null;
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      // eslint-disable-next-line security/detect-object-injection -- i is a loop counter
      const v = arr[i];
      if (v !== null) return v;
    }
    return null;
  };
  const ppV = lastNonNull(pp);
  const r1V = lastNonNull(r1);
  const s1V = lastNonNull(s1);
  if (ppV === null || r1V === null || s1V === null) return null;
  return { pp: ppV, r1: r1V, s1: s1V };
}

/**
 * `formatPivotDate` — format the most-recent bar's UNIX-ms
 * `time` as a `YYYY-MM-DD` UTC date string for the price-line
 * title (e.g. "PP 2026-07-26"). The date is the "previous
 * session" date (the bar that the pivot was computed from,
 * NOT the current bar — see `computeDailyPivot`'s `bars[i-1]`
 * convention).
 *
 * UTC is used (not local) because the user mandate example
 * is "PP 2026-07-26" — a stable, locale-independent label
 * that any trader can read.
 */
function formatPivotDate(prevBarTimeMs: number): string {
  // Date.UTC returns a ms-since-epoch timestamp; the `getUTC*`
  // methods then extract the UTC date components. We assemble
  // the YYYY-MM-DD string from the components (NOT via
  // `toISOString().slice(0, 10)` because `toISOString` adds
  // a `T` and a Z; the slice is fine but the explicit format
  // documents the intent).
  const d = new Date(prevBarTimeMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * `renderDailyPivot` — the `IndicatorRenderer` for the daily pivot.
 *
 * Phase 82 (chart redesign): instead of three line series drawing
 * the per-bar stair-step history of pivot levels, the renderer
 * creates THREE PRICE LINES on the candle series — one for each
 * of the most recent day's PP / R1 / S1. Each price line has a
 * `title` of the form "PP 2026-07-26" / "R1 2026-07-26" /
 * "S1 2026-07-26" so the user can see what each level is
 * AND what day it applies to. The user mandate is that the
 * pivot should be labeled with days ("pivotnal szinteket kene
 * jelolni napokon") — `createPriceLine` is the lightweight-charts
 * API that gives us labeled horizontal levels.
 *
 * **Why price lines, not line series:**
 *   - A line series would draw the per-bar stair-step history
 *     (the "ribbon" the user complained about).
 *   - A price line is a single horizontal level that extends
 *     across the visible chart — perfect for "yesterday's PP
 *     at $X" which is the same value across the whole day.
 *   - The price line's `title` is a lightweight-charts built-in
 *     feature: it shows next to the line on the chart AND on
 *     the right axis (the user mandate: "pivotnal szinteket
 *     kene jelolni napokon").
 *
 * **Output shape:**
 *   - `series` is `[]` (no line series are added — the
 *     contract allows this; the dispose handles the price
 *     lines).
 *   - `dispose` removes the 3 price lines.
 *
 * **Graceful handling:**
 *   - Empty `bars` → no price lines, no-op dispose.
 *   - Missing series / all-null values → no price lines (the
 *     most recent pivot is undefined).
 *   - Missing `candleSeries` (defensive) → console.warn, no-op.
 *
 * **Idempotency:** the renderer does NOT track prior state — the
 * caller is expected to call the previous `RenderedIndicator.dispose()`
 * before invoking the renderer again.
 */
export const renderDailyPivot: IndicatorRenderer = (
  ctx: IndicatorContext,
): RenderedIndicator => {
  const { bars, indicatorSeries, strategy, timeframe, candleSeries } = ctx;

  // Short-circuit: no bars → no price lines.
  if (bars.length === 0) {
    return {
      name: `daily_pivot-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: nothing to dispose when no price lines were added
      },
    };
  }

  // Defensive: price lines need a candle series to attach to.
  if (candleSeries === undefined) {
    console.warn(
      `[renderDailyPivot] candleSeries is undefined for ${strategy}@${timeframe} — skipping price lines`,
    );
    return {
      name: `daily_pivot-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: no price lines were created
      },
    };
  }

  // Defensive: missing series → log + skip. The renderer only
  // requires pp/r1/s1 keys; if any is missing, skip with a
  // warning (matches the existing `renderDonchian` /
  // `renderBollinger` convention of "missing series → skip").
  const ppValues = valuesFor(indicatorSeries, "pp");
  const r1Values = valuesFor(indicatorSeries, "r1");
  const s1Values = valuesFor(indicatorSeries, "s1");
  if (ppValues === undefined || r1Values === undefined || s1Values === undefined) {
    console.warn(
      `[renderDailyPivot] missing pp/r1/s1 series for ${strategy}@${timeframe} — skipping`,
    );
    return {
      name: `daily_pivot-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op
      },
    };
  }

  // Extract the most recent day's PP/R1/S1.
  const mostRecent = extractMostRecentPivot(ppValues, r1Values, s1Values);
  if (mostRecent === null) {
    return {
      name: `daily_pivot-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: every value was null
      },
    };
  }

  // The "previous bar" date for the pivot title. The pivot
  // uses `bars[i-1]` (the previous bar's H/L/C) — for the
  // most recent bar, the "previous bar" is `bars[bars.length
  // - 2]`. If the bar stream has only 1 bar, the pivot is
  // undefined (we already returned above for `bars.length < 2`).
  const prevBar = bars[bars.length - 2];
  const dateStr = formatPivotDate(prevBar.time);

  // The PP / R1 / S1 price lines. The PP line is dashed
  // (lineStyle=2) per the convention; R1 (green, resistance)
  // and S1 (red, support) are solid. The `axisLabelVisible:
  // true` puts the title on the right axis (the conventional
  // "price line label" position in trading platforms).
  const ppLine = candleSeries.createPriceLine({
    price: mostRecent.pp,
    color: colorFor("pp"),
    lineWidth: 1,
    lineStyle: 2, // Dashed
    axisLabelVisible: true,
    title: `PP ${dateStr}`,
  });
  const r1Line = candleSeries.createPriceLine({
    price: mostRecent.r1,
    color: colorFor("r1"),
    lineWidth: 1,
    lineStyle: 0, // Solid
    axisLabelVisible: true,
    title: `R1 ${dateStr}`,
  });
  const s1Line = candleSeries.createPriceLine({
    price: mostRecent.s1,
    color: colorFor("s1"),
    lineWidth: 1,
    lineStyle: 0, // Solid
    axisLabelVisible: true,
    title: `S1 ${dateStr}`,
  });

  // `dispose` removes every price line in a single pass.
  const dispose = (): void => {
    candleSeries.removePriceLine(ppLine);
    candleSeries.removePriceLine(r1Line);
    candleSeries.removePriceLine(s1Line);
  };

  return {
    name: `daily_pivot-${timeframe}-${strategy}`,
    series: [],
    dispose,
  };
};

/**
 * `@internal` test-only re-exports. Production code uses
 * `colorFor` / `valuesFor` indirectly through `renderDailyPivot`.
 * The `__testing` export exists ONLY so unit tests can exercise
 * the TypeScript `never`-typed default branches with invalid
 * keys (cast through `unknown`) and the new
 * `extractMostRecentPivot` / `formatPivotDate` helpers.
 * Do NOT import `__testing` from production code.
 */
export const __testing = {
  colorFor,
  valuesFor,
  extractMostRecentPivot,
  formatPivotDate,
} as const;
