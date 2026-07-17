/**
 * apps/web/src/indicators/signals.ts
 *
 * Phase 49C: the signal marker indicator renderer.
 *
 * All three strategies in the bot (donchian_pivot_composition,
 * cascade_fade, dydx_cex_carry) emit per-trade signal markers —
 * long/short entries and exits. The state-feed ships them as
 * `INDICATOR` messages carrying an `entries` array:
 *
 *   {
 *     type: "INDICATOR",
 *     strategy: "donchian_pivot_composition",
 *     symbol: "BTCUSDT",
 *     timeframe: "1h",
 *     series: {
 *       entries: [
 *         { time: 1700000000, side: "long",  price: 67000, label: "ENTRY" },
 *         { time: 1700003600, side: "short", price: 67200, label: "EXIT"  },
 *         ...
 *       ]
 *     }
 *   }
 *
 * Like the cascade indicator, the signal indicator does NOT add
 * new line series — it MODIFIES the existing candle series'
 * markers via `setMarkers()`. The shape is similar to
 * `apps/web/src/lib/ohlc-bridge.ts`'s `ChartMarker`, but
 * signals come from a different source (the INDICATOR payload
 * keyed by `entries`) so a dedicated renderer is appropriate.
 *
 * **Marker conventions (locked in `signalToChartMarker`):**
 *
 *   - `side: "long"` or `"buy"` (alias):
 *     - `position: "belowBar"`, `shape: "arrowUp"`,
 *       `color: "#22c55e"` (green), `text: label`
 *   - `side: "short"` or `"sell"` (alias):
 *     - `position: "aboveBar"`, `shape: "arrowDown"`,
 *       `color: "#ef4444"` (red), `text: label`
 *
 * "belowBar + green" for long is the conventional chart signal
 * color (the marker is below the bar pointing up = bullish);
 * "aboveBar + red" for short is the inverse. The cascade
 * indicator inverts this convention (a "buy cascade" is
 * bearish — see `cascade.ts` for the rationale); the signal
 * indicator does NOT, because signals are the ENTRY side, not
 * the liquidation side.
 *
 * **Lightweight-charts v5 `setMarkers` integration:** same
 * pattern as `cascade.ts` — the `setMarkers` method lives on
 * the markers-plugin wrapper (`createSeriesMarkers(series, ...)`)
 * in v5, NOT on the bare `ISeriesApi<"Candlestick">`. The
 * structural cast at the call site is the only place the
 * production-vs-test divergence lives.
 *
 * **Deviation from the spec (documented):** the spec says the
 * signals shape is `{ time, side, price, label }` and the
 * renderer is called with `ctx.candleSeries.setMarkers(...)`.
 * The `price` field is part of the wire format but is NOT used
 * by the renderer (lightweight-charts markers are anchored to
 * the bar's `time` only; a per-marker price would require the
 * v5 "price markers" plugin, which is not in scope for 49C).
 * The `price` field is accepted by `validateSignalsSeries` for
 * forward-compat — a future phase can use it for a tooltip
 * overlay without re-validating the wire format.
 */

import type { SeriesMarker, Time } from "lightweight-charts";

import type { OHLCBar, ChartMarker } from "../lib/ohlc-bridge.js";
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
 * The signal indicator name as registered in `IndicatorRegistry`.
 *
 * The strategy code in `packages/strategies/` references this
 * exact string in its `INDICATOR` messages, so a typo here
 * would silently fail to render — keep in sync with the strategy.
 */
export const SIGNALS_INDICATOR_NAME = "signals" as const;

/**
 * The signal side. `long` / `short` are the canonical names;
 * `buy` / `sell` are accepted as aliases (the state-feed
 * protocol allows both — the strategy code may emit either,
 * and the renderer's job is to make them visually identical).
 */
export type SignalSide = "long" | "short" | "buy" | "sell";

/**
 * A single signal entry — one trade event (entry, exit, stop, etc.)
 * with the bar's UNIX-seconds timestamp, the side, the price the
 * trade was filled at, and a human-readable label (e.g. "ENTRY",
 * "EXIT", "STOP", "TP1").
 *
 * The `price` field is part of the wire format but is NOT
 * rendered (lightweight-charts markers are anchored to the
 * bar's `time` only). It is validated by `validateSignalsSeries`
 * for forward-compat — a future phase may use it for a tooltip
 * overlay.
 */
export interface SignalEntry {
  readonly time: number;
  readonly side: SignalSide;
  readonly price: number;
  readonly label: string;
}

/**
 * The typed shape of a validated signal series.
 *
 * Like the cascade series, the signals are a sparse list of
 * detected events (not per-bar data), so
 * `validateSignalsSeries` does NOT require `entries.length` to
 * match `bars.length`. The renderer filters entries to those
 * whose `time` is in the visible bar range; out-of-range
 * entries are silently dropped (the lightweight-charts markers
 * API accepts them but doesn't render bars outside the time
 * scale).
 *
 * **Deviation from the spec (documented):** the spec writes
 * `interface SignalsSeries extends IndicatorSeries`. That can't
 * work: `IndicatorSeries` is `Record<string, readonly (number |
 * null)[]>` (the per-bar array contract), and `entries` is
 * `readonly SignalEntry[]` (objects, not numbers). The two
 * types are mutually incompatible. We make `SignalsSeries` a
 * standalone interface with the same `{ entries: ... }` shape;
 * the validator still accepts `IndicatorSeries` (a more general
 * type) as input, so the caller-side contract is unchanged.
 */
export interface SignalsSeries {
  readonly entries: readonly SignalEntry[];
}

// ============================================================================
// validateSignalsSeries
// ============================================================================

/**
 * `validateSignalsSeries` — type-guard + structural validation.
 *
 * Returns the typed `SignalsSeries` if valid, else `null`. The
 * caller is expected to log a warning and skip rendering when
 * `null` is returned.
 *
 * Validity rules:
 *   1. `entries` key must be present and its value must be an array.
 *   2. Each entry in the array must have:
 *      - `time`: a `number`
 *      - `side`: one of the 4 closed literals (`"long"`, `"short"`,
 *        `"buy"`, `"sell"`)
 *      - `price`: a finite `number` (the wire-format field; not
 *        rendered but must be present and well-formed)
 *      - `label`: a `string` (the human-readable text; may be
 *        empty `""` for unlabeled signals)
 *   3. **No length requirement** — `entries` is a sparse list,
 *      not per-bar data. An empty `entries` array IS valid
 *      (the renderer passes an empty markers list to the chart).
 *   4. **`bars.length` is NOT checked** — entries are sparse and
 *      their `time` is the candle's UNIX-seconds timestamp, not
 *      a bar index. The `bars` parameter is kept in the signature
 *      for the uniform `validateXxxSeries(series, bars)` API
 *      across all indicators; the validator does not use it
 *      today. A future phase can add range filtering here.
 */
export function validateSignalsSeries(
  series: Record<string, unknown>,
  bars: readonly OHLCBar[],
): SignalsSeries | null {
  // Reference `bars` so the unused-parameter lint stays quiet
  // and so a future "filter entries to bar range" change has a
  // local handle. The parameter is part of the contract; we
  // simply don't use it today.
  void bars;

  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const entriesRaw: unknown = (series)["entries"];

  // Rule 1: `entries` must be an array.
  if (!Array.isArray(entriesRaw)) {
    return null;
  }
  const entries = entriesRaw as readonly unknown[];

  // Rule 2: each entry must be a structurally valid SignalEntry.
  // We validate in a single pass; the first invalid entry fails
  // the whole validation (the renderer is "all or nothing" — if
  // any entry is malformed, skip the whole render and let the
  // state-feed retransmit with fixed data).
  for (const e of entries) {
    if (typeof e !== "object" || e === null) {
      return null;
    }
    const obj = e as Record<string, unknown>;
    // `time`: a number (any finite value — the renderer doesn't
    // bound it; out-of-range is handled by the chart itself).
    if (typeof obj.time !== "number") {
      return null;
    }
    // `side`: one of the 4 closed literals.
    if (
      obj.side !== "long" &&
      obj.side !== "short" &&
      obj.side !== "buy" &&
      obj.side !== "sell"
    ) {
      return null;
    }
    // `price`: a finite number (not NaN / Infinity). The wire
    // format REQUIRES this field (the strategy emits it even
    // though the renderer doesn't display it).
    if (
      typeof obj.price !== "number" ||
      !Number.isFinite(obj.price)
    ) {
      return null;
    }
    // `label`: a string. The empty string `""` IS valid (the
    // marker will have an empty `text` field, which lightweight-
    // charts renders as "no text"). We do NOT require a non-
    // empty label.
    if (typeof obj.label !== "string") {
      return null;
    }
  }

  // Cast through `unknown` — the per-element loop above has
  // verified the structural shape. The destructure is by hand
  // (no `as SignalEntry[]` shortcut) because the linter
  // flags direct casts on `unknown[]` as too loose.
  const out: SignalEntry[] = [];
  for (const e of entries) {
    const obj = e as Record<string, unknown>;
    out.push({
      time: obj.time as number,
      side: obj.side as SignalSide,
      price: obj.price as number,
      label: obj.label as string,
    });
  }

  return { entries: out };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Structural type for the candle series (or markers plugin)
 * that exposes `setMarkers()`. In lightweight-charts v5 the
 * method lives on `ISeriesMarkersPluginApi`, not on
 * `ISeriesApi<"Candlestick">`. The cast at the call site
 * scopes the type divergence to one line; the production
 * integration in `ChartCard` (a future phase) will pass the
 * markers plugin as `candleSeries`, removing the cast.
 *
 * Mirrors the same pattern in `cascade.ts`.
 */
interface CandleSeriesWithMarkers {
  setMarkers: (markers: readonly SeriesMarker<Time>[]) => void;
}

/**
 * `signalToChartMarker` — convert a `SignalEntry` into a
 * `ChartMarker` (the app's existing marker shape — see
 * `apps/web/src/lib/ohlc-bridge.ts`).
 *
 * Marker conventions:
 *   - `side: "long"` or `"buy"` (alias) — bullish entry:
 *     `position: "belowBar"`, `shape: "arrowUp"`, `color: green`
 *   - `side: "short"` or `"sell"` (alias) — bearish entry:
 *     `position: "aboveBar"`, `shape: "arrowDown"`, `color: red`
 *
 * The `text` field carries the human-readable label (e.g.
 * "ENTRY", "EXIT"). The empty label `""` is a no-op (the
 * marker is rendered with no text — same as the cascade
 * indicator's small markers).
 */
const LONG_COLOR = "#22c55e"; // green — bullish entry
const SHORT_COLOR = "#ef4444"; // red — bearish entry

function signalToChartMarker(entry: SignalEntry): ChartMarker {
  if (entry.side === "long" || entry.side === "buy") {
    return {
      time: entry.time,
      position: "belowBar",
      color: LONG_COLOR,
      shape: "arrowUp",
      text: entry.label,
    };
  }
  // entry.side === "short" || entry.side === "sell"
  return {
    time: entry.time,
    position: "aboveBar",
    color: SHORT_COLOR,
    shape: "arrowDown",
    text: entry.label,
  };
}

/**
 * `chartMarkerToSeriesMarker` — convert a `ChartMarker` to the
 * lightweight-charts v5 `SeriesMarker<Time>`. The shapes are
 * identical except that `SeriesMarker` does NOT have a `text`
 * field — the `text` is silently dropped (the v5 marker is
 * icon-only by default; the app's `ChartMarker.text` is a
 * forward-compat field for a future tooltip overlay).
 *
 * The cast is safe because the per-field types are identical
 * (`time: Time` ≡ `number` once `Time` is `UTCTimestamp`; the
 * `position` union is a subset of `SeriesMarkerBarPosition`;
 * the `shape` union is identical; `color: string` is
 * identical).
 */
function chartMarkerToSeriesMarker(m: ChartMarker): SeriesMarker<Time> {
  return {
    time: m.time as Time,
    position: m.position,
    color: m.color,
    shape: m.shape,
  };
}

// ============================================================================
// renderSignals
// ============================================================================

/**
 * `renderSignals` — the `IndicatorRenderer` for signal markers.
 *
 * **Does NOT add any new series to the chart.** It modifies the
 * existing candle series' markers via `setMarkers()`. The
 * returned `RenderedIndicator.series` is `[]` (empty array) —
 * the signal indicator has no line series of its own. The
 * `dispose` callback clears the markers via `setMarkers([])`.
 *
 * **Graceful handling:**
 *   - `candleSeries` missing from `ctx` → `console.warn`, no
 *     markers, `dispose` is a no-op.
 *   - Empty `entries` → `setMarkers([])` is called (clears any
 *     prior markers), `dispose` clears again (idempotent).
 *   - Invalid `side` / `price` / `label` values are caught by
 *     `validateSignalsSeries`; the renderer does not need to
 *     re-validate.
 *
 * **Idempotency:** like the other renderers, the signal
 * renderer does NOT track prior state. The caller is expected
 * to call `dispose()` (which clears markers) before invoking
 * the renderer again.
 */
export const renderSignals: IndicatorRenderer = (
  ctx: IndicatorContext,
): RenderedIndicator => {
  const { indicatorSeries, strategy, timeframe, bars } = ctx;

  // The candle series is optional in `IndicatorContext` (only
  // cascade + signals use it). If absent, log and return a no-op.
  if (ctx.candleSeries === undefined) {
    console.warn(
      `[renderSignals] 'candleSeries' missing from context for ${strategy}@${timeframe} — markers not rendered`,
    );
    return {
      name: `signals-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: nothing to clear when we never set markers
      },
    };
  }

  // Cast the candle series to the structural type that has
  // `setMarkers`. In production, the caller should pass the
  // `ISeriesMarkersPluginApi` (the result of
  // `createSeriesMarkers(...)`) as `candleSeries`; the cast
  // here is the future-compat seam.
  const candleSeries = ctx.candleSeries as unknown as CandleSeriesWithMarkers;

  // Validate the series. If invalid, log and return a no-op
  // (no `setMarkers` call is made — we don't want to silently
  // clear prior markers on a validation failure).
  const validated = validateSignalsSeries(indicatorSeries, bars);
  if (validated === null) {
    console.warn(
      `[renderSignals] invalid series for ${strategy}@${timeframe} — markers not rendered`,
    );
    return {
      name: `signals-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: we never set markers
      },
    };
  }

  // Convert the signal entries to lightweight-charts markers.
  // We build both the ChartMarker[] (the app's own shape; the
  // `text` field is carried here) and the SeriesMarker[] (what
  // the v5 plugin actually wants). The ChartMarker is internal;
  // the SeriesMarker is what we pass to `setMarkers`.
  const seriesMarkers: SeriesMarker<Time>[] = validated.entries.map((e) =>
    chartMarkerToSeriesMarker(signalToChartMarker(e)),
  );
  candleSeries.setMarkers(seriesMarkers);

  // `dispose` clears the markers. We do NOT remove any
  // series (the signals renderer adds none) — `dispose` is
  // exclusively a "clear markers" call.
  const dispose = (): void => {
    candleSeries.setMarkers([]);
  };

  return {
    name: `signals-${timeframe}-${strategy}`,
    series: [],
    dispose,
  };
};

/**
 * Re-export the `IndicatorSeries` type for callers that want
 * to import a single, complete type from `signals.ts`. The
 * type is a structural alias of the registry's `IndicatorSeries`
 * (it would not compile to extend the registry's `IndicatorSeries`
 * because the entries shape is non-numeric — see the
 * `SignalsSeries` deviation note above).
 */
export type { IndicatorSeries };
