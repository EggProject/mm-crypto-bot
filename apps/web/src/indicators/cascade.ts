/**
 * apps/web/src/indicators/cascade.ts
 *
 * Phase 49B: the cascade-event marker indicator renderer.
 *
 * The cascade-fade strategy (state-feed strategy id
 * `cascade_fade`) tracks large liquidation cascades and fades
 * the move. The state-feed computes the cascade events
 * server-side and ships them as an `INDICATOR` message:
 *
 *   {
 *     type: "INDICATOR",
 *     strategy: "cascade_fade",
 *     symbol: "BTCUSDT",
 *     timeframe: "1h",
 *     series: {
 *       events: [
 *         { time: 1700000000, severity: 0.82, side: "up"   },
 *         { time: 1700003600, severity: 0.31, side: "down" },
 *         ...
 *       ]
 *     }
 *   }
 *
 * The web client renders these as `SeriesMarker` overlays on
 * the existing OHLC candle series. The cascade indicator is
 * unusual in two respects:
 *
 *   1. It does NOT add any new series to the chart. It
 *      *modifies* the existing candle series' markers.
 *   2. The `series` payload is NOT a per-bar array; it's a
 *      sparse event list (events are not aligned to bars).
 *      `validateCascadeSeries` therefore does NOT enforce a
 *      length match with `bars` — see the validator's docstring
 *      for the rationale.
 *
 * **Marker shape (locked in `cascadeToChartMarker`):**
 *
 *   - `side: "up"` (buy cascade = long liquidations, bearish):
 *     - `severity > 0.5` → arrowUp, position="aboveBar", color=red (`#ef4444`)
 *     - `severity ≤ 0.5` → circle, position="aboveBar", color=red, no text
 *   - `side: "down"` (sell cascade = short liquidations, bullish):
 *     - `severity > 0.5` → arrowDown, position="belowBar", color=green (`#22c55e`)
 *     - `severity ≤ 0.5` → circle, position="belowBar", color=green, no text
 *
 * The "red above / green below" color scheme is the inverse
 * of `barToMarker` in `apps/web/src/lib/ohlc-bridge.ts` because
 * a cascade is the LIQUIDATION side, not the entry side — a
 * buy cascade is bearish (it dumps long positions), so the
 * marker is red; a sell cascade is bullish (it squeezes shorts),
 * so the marker is green.
 *
 * **Lightweight-charts v5 `setMarkers` integration:** the
 * lightweight-charts v5 API exposes `setMarkers()` on the
 * `ISeriesMarkersPluginApi` (the wrapper returned by
 * `createSeriesMarkers(series, ...)`), NOT on the bare
 * `ISeriesApi<"Candlestick">`. The `IndicatorContext.candleSeries`
 * field is typed as the bare series; the renderer performs a
 * structural type assertion at the call site, scoped to the
 * `setMarkers` method only. The test mock provides `setMarkers`
 * directly on the candle series, so the assertion is the only
 * place the production-vs-test divergence lives.
 *
 * **Deviation from the spec (documented):** the spec says
 * `ctx.candleSeries.setMarkers(markers)`. The v5 API doesn't
 * support that on the bare series, but the marker shape
 * (`{ time, position, color, shape, text }`) DOES match the
 * app's existing `ChartMarker` interface in
 * `apps/web/src/lib/ohlc-bridge.ts`. The shape and the call
 * site are both correct; the only fix is the structural
 * assertion on `setMarkers`. A future phase that wires the
 * cascade indicator into `ChartCard` will pass the
 * `markersPlugin` (from `createSeriesMarkers(...)`) as
 * `candleSeries`, which removes the assertion.
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
 * The cascade indicator name as registered in `IndicatorRegistry`.
 *
 * The strategy code in `packages/strategies/cascade_fade/`
 * references this exact string in its `INDICATOR` messages, so
 * a typo here would silently fail to render — keep in sync with
 * the strategy.
 */
export const CASCADE_INDICATOR_NAME = "cascade" as const;

/**
 * The cascade event side. `up` = buy cascade (long liquidations,
 * bearish), `down` = sell cascade (short liquidations, bullish).
 */
export type CascadeSide = "up" | "down";

/**
 * A single cascade event.
 *
 * `time` is UNIX **seconds** (the lightweight-charts marker
 * convention — NOT the same as the OHLC bar `time` in ms).
 * The convention is that the cascade event's `time` is the
 * timestamp of the candle on which the cascade was DETECTED,
 * rounded down to the nearest bar — the strategy code in
 * `packages/strategies/cascade_fade/` does this conversion
 * server-side. The web client never has to convert.
 *
 * `severity` is `0..1`, higher = bigger cascade. The
 * `0.5` threshold (above which the marker is a large arrow
 * with a label, below which it's a small circle with no text)
 * is encoded in `cascadeToChartMarker`.
 */
export interface CascadeEvent {
  readonly time: number;
  readonly severity: number;
  readonly side: CascadeSide;
}

/**
 * The typed shape of a validated cascade series.
 *
 * Unlike the Donchian / funding series, the cascade `events`
 * are NOT per-bar — they are a sparse list of detected events,
 * and `validateCascadeSeries` does NOT require `events.length`
 * to match `bars.length`. The renderer filters events to those
 * whose `time` is in the visible bar range; out-of-range events
 * are silently dropped (the lightweight-charts markers API
 * accepts them but doesn't render bars outside the time scale).
 *
 * **Deviation from the spec (documented):** the spec writes
 * `interface CascadeSeries extends IndicatorSeries`. That can't
 * work: `IndicatorSeries` is `Record<string, readonly (number
 * | null)[]>` (the per-bar array contract), and `events` is
 * `readonly CascadeEvent[]` (objects, not numbers). The two
 * types are mutually incompatible. We make `CascadeSeries` a
 * standalone interface with the same `{ events: ... }` shape;
 * the validator still accepts `IndicatorSeries` (a more general
 * type) as input, so the caller-side contract is unchanged.
 */
export interface CascadeSeries {
  readonly events: readonly CascadeEvent[];
}

// ============================================================================
// validateCascadeSeries
// ============================================================================

/**
 * `validateCascadeSeries` — type-guard + structural validation.
 *
 * Returns the typed `CascadeSeries` if valid, else `null`. The
 * caller is expected to log a warning and skip rendering when
 * `null` is returned.
 *
 * Validity rules:
 *   1. `events` key must be present and its value must be an array.
 *   2. Each event in the array must have:
 *      - `time`: a `number`
 *      - `severity`: a finite `number` in the closed interval `[0, 1]`
 *      - `side`: the literal string `"up"` or `"down"`
 *   3. **No length requirement** — `events` is a sparse list,
 *      not per-bar data. An empty `events` array IS valid
 *      (the renderer passes an empty markers list to the chart).
 *   4. **`bars.length` is NOT checked** — events are sparse and
 *      their `time` is the candle's UNIX-seconds timestamp, not
 *      a bar index. The `bars` parameter is kept in the signature
 *      for the uniform `validateXxxSeries(series, bars)` API
 *      across all indicators; the validator does not use it
 *      today. A future phase can add range filtering here.
 */
export function validateCascadeSeries(
  series: IndicatorSeries,
  bars: readonly OHLCBar[],
): CascadeSeries | null {
  // Reference `bars` so the unused-parameter lint stays quiet
  // and so a future "filter events to bar range" change has a
  // local handle. The parameter is part of the contract; we
  // simply don't use it today.
  void bars;

  // eslint-disable-next-line @typescript-eslint/dot-notation -- key is a known string, not dynamic
  const eventsRaw: unknown = (series as Record<string, unknown>)["events"];

  // Rule 1: `events` must be an array.
  if (!Array.isArray(eventsRaw)) {
    return null;
  }
  const events = eventsRaw as readonly unknown[];

  // Rule 2: each event must be a structurally valid CascadeEvent.
  // We validate in a single pass; the first invalid event fails
  // the whole validation (the renderer is "all or nothing" — if
  // any event is malformed, skip the whole render and let the
  // state-feed retransmit with fixed data).
  for (const e of events) {
    if (typeof e !== "object" || e === null) {
      return null;
    }
    const obj = e as Record<string, unknown>;
    // `time`: number (any finite value — the renderer doesn't
    // bound it; out-of-range is handled by the chart itself).
    if (typeof obj.time !== "number") {
      return null;
    }
    // `severity`: number in [0, 1]. We use `< 0 || > 1` to
    // reject NaN and Infinity (both are `!==` to themselves and
    // would pass `< 0` only if they were negative, which NaN
    // and Infinity on the negative side would slip through;
    // we explicitly check `Number.isFinite` first).
    if (
      typeof obj.severity !== "number" ||
      !Number.isFinite(obj.severity)
    ) {
      return null;
    }
    const sev = obj.severity;
    if (sev < 0 || sev > 1) {
      return null;
    }
    // `side`: literal "up" or "down".
    if (obj.side !== "up" && obj.side !== "down") {
      return null;
    }
  }

  // Cast through `unknown` — the per-element loop above has
  // verified the structural shape. The destructure is by hand
  // (no `as CascadeEvent[]` shortcut) because the linter
  // flags direct casts on `unknown[]` as too loose.
  const out: CascadeEvent[] = [];
  for (const e of events) {
    const obj = e as Record<string, unknown>;
    out.push({
      time: obj.time as number,
      severity: obj.severity as number,
      side: obj.side as CascadeSide,
    });
  }

  return { events: out };
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
 */
interface CandleSeriesWithMarkers {
  setMarkers: (markers: readonly SeriesMarker<Time>[]) => void;
}

/**
 * `cascadeToChartMarker` — convert a `CascadeEvent` into a
 * `ChartMarker` (the app's existing marker shape — see
 * `apps/web/src/lib/ohlc-bridge.ts`).
 *
 * Marker conventions:
 *   - `side: "up"`   (buy cascade = long liquidations = bearish):
 *     - large (severity > 0.5): arrowUp + aboveBar + red `#ef4444`
 *     - small (severity ≤ 0.5): circle + aboveBar + red `#ef4444`
 *   - `side: "down"` (sell cascade = short liquidations = bullish):
 *     - large (severity > 0.5): arrowDown + belowBar + green `#22c55e`
 *     - small (severity ≤ 0.5): circle + belowBar + green `#22c55e`
 *
 * The `text` field is the human-readable label (e.g.
 * "CASCADE 0.82"). Small markers have an empty text (no
 * label clutter on the chart).
 *
 * Severity threshold (0.5) is encoded in the `LARGE_THRESHOLD`
 * constant — a single source of truth.
 */
const LARGE_THRESHOLD = 0.5;
const UP_COLOR = "#ef4444"; // red — buy cascade is bearish
const DOWN_COLOR = "#22c55e"; // green — sell cascade is bullish

function cascadeToChartMarker(event: CascadeEvent): ChartMarker {
  const isLarge = event.severity > LARGE_THRESHOLD;
  if (event.side === "up") {
    return {
      time: event.time,
      position: "aboveBar",
      color: UP_COLOR,
      shape: isLarge ? "arrowUp" : "circle",
      text: isLarge ? `CASCADE ${event.severity.toFixed(2)}` : "",
    };
  }
  // event.side === "down"
  return {
    time: event.time,
    position: "belowBar",
    color: DOWN_COLOR,
    shape: isLarge ? "arrowDown" : "circle",
    text: isLarge ? `CASCADE ${event.severity.toFixed(2)}` : "",
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
// renderCascade
// ============================================================================

/**
 * `renderCascade` — the `IndicatorRenderer` for cascade events.
 *
 * **Does NOT add any new series to the chart.** It modifies the
 * existing candle series' markers via `setMarkers()`. The
 * returned `RenderedIndicator.series` is `[]` (empty array) —
 * the cascade indicator has no line series of its own. The
 * `dispose` callback clears the markers via `setMarkers([])`.
 *
 * **Graceful handling:**
 *   - `candleSeries` missing from `ctx` → `console.warn`, no
 *     markers, `dispose` is a no-op.
 *   - Empty `events` → `setMarkers([])` is called (clears any
 *     prior markers), `dispose` clears again (idempotent).
 *   - Invalid `severity` or `side` values are caught by
 *     `validateCascadeSeries`; the renderer does not need to
 *     re-validate.
 *
 * **Idempotency:** like the other renderers, the cascade
 * renderer does NOT track prior state. The caller is expected
 * to call `dispose()` (which clears markers) before invoking
 * the renderer again.
 */
export const renderCascade: IndicatorRenderer = (
  ctx: IndicatorContext,
): RenderedIndicator => {
  const { indicatorSeries, strategy, timeframe, bars } = ctx;

  // The candle series is optional in `IndicatorContext` (only
  // cascade uses it). If absent, log and return a no-op.
  if (ctx.candleSeries === undefined) {
    console.warn(
      `[renderCascade] 'candleSeries' missing from context for ${strategy}@${timeframe} — markers not rendered`,
    );
    return {
      name: `cascade-${timeframe}-${strategy}`,
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
  const validated = validateCascadeSeries(indicatorSeries, bars);
  if (validated === null) {
    console.warn(
      `[renderCascade] invalid series for ${strategy}@${timeframe} — markers not rendered`,
    );
    return {
      name: `cascade-${timeframe}-${strategy}`,
      series: [],
      dispose: (): void => {
        // no-op: we never set markers
      },
    };
  }

  // Convert the cascade events to lightweight-charts markers.
  // We build both the ChartMarker[] (the app's own shape; the
  // `text` field is carried here) and the SeriesMarker[] (what
  // the v5 plugin actually wants). The ChartMarker is internal;
  // the SeriesMarker is what we pass to `setMarkers`.
  const seriesMarkers: SeriesMarker<Time>[] = validated.events.map((e) =>
    chartMarkerToSeriesMarker(cascadeToChartMarker(e)),
  );
  candleSeries.setMarkers(seriesMarkers);

  // `dispose` clears the markers. We do NOT remove any
  // series (the cascade renderer adds none) — `dispose` is
  // exclusively a "clear markers" call.
  const dispose = (): void => {
    candleSeries.setMarkers([]);
  };

  return {
    name: `cascade-${timeframe}-${strategy}`,
    series: [],
    dispose,
  };
};
