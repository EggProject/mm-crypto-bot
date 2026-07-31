/**
 * apps/web/src/lib/bars-from-tick.ts
 *
 * ============================================================================
 * PHASE 83.6 — TICK-BY-TICK OHLCV UPDATES
 * ============================================================================
 *
 * The bot's subscribeTicker callback now publishes a `tick` event to the
 * state-feed every time a new price arrives (see
 * `apps/bot/src/bot/bot.ts:704-728` — Phase 83.6 wire-up). The browser
 * receives the tick via the existing `useWebSocket()` hook's `lastTick`
 * field (batched through `RealtimeBatcher` for rAF coalescing, see
 * `ws-client.ts:572-587`). This module is the pure helper that consumes
 * the tick and updates the `barsByKey` map that the chart grid renders.
 *
 * Background: the `bar` event (handled by `bars-from-bar.ts`) only fires
 * at bar BOUNDARIES (1h / 4h / 1d close). For bybit.eu, the exchange's
 * `fetchOHLCV` returns COMPLETED bars only, so the `bar` event
 * surfaces the closed bar but never the in-progress one. Between
 * boundaries, the dashboard's chart stays frozen on the last closed
 * bar — the user sees a stale price even though the live ticker is
 * moving. Phase 83.6 fixes this by ALSO consuming `tick` events and
 * updating the in-progress bar's `close`, `high`, `low` on every price
 * tick.
 *
 * --------------------------------------------------------------------------
 * Why a SEPARATE helper (not inline in App.tsx)?
 * --------------------------------------------------------------------------
 * 1. **Unit-testability** — the 3 branches (new time → APPEND / same
 *    time → REPLACE / stale time → noop) are exercised in
 *    `bars-from-tick.test.ts` without spinning up React or DOM.
 * 2. **Defensive parsing** — the `lastTick` arrives as a `TickMessage`
 *    union variant; the WS `tick` event has `{type, ts, symbol,
 *    price}` and the dashboard's `useWebSocket` exposes it loosely.
 *    The helper defensive-validates the shape and returns the prev
 *    `barsByKey` unchanged on a malformed input.
 * 3. **No volume** — the tick payload has no `volume` field (volume
 *    comes from the trades feed / candle accumulation, not from a
 *    price tick). For new in-progress bars, `volume` is initialised
 *    to 0; the next `bar` event will overwrite it with the real
 *    accumulated volume. The in-progress bar's `volume: 0` is a
 *    documented limitation of the tick path.
 *
 * --------------------------------------------------------------------------
 * Bar-time computation
 * --------------------------------------------------------------------------
 * The in-progress bar's `time` is the START of the period that
 * `nowMs` falls in. For "1h" the formula is
 *   `Math.floor(nowMs / 1000 / 3600) * 3600 * 1000`
 * i.e. quantize the current UNIX timestamp to the nearest hour
 * boundary. The lightweight-charts v5 `series.setData` invariant
 * (strictly time-ascending, unique `time` values — see
 * `apps/web/src/state-feed/ohlc-store.ts` and the memory note from
 * Phase 77) is preserved because every (symbol, timeframe) bar in
 * the `barsByKey` array has its `time` aligned to the same boundary.
 *
 * --------------------------------------------------------------------------
 * NO React, NO DOM, NO I/O. Pure functional core for the App.tsx
 * `useState`/`useEffect` orchestrator.
 */

import { chartKeyToString } from "./subscription.js";
import type { OHLCBar } from "./ohlc-bridge.js";

/**
 * `BarsByKey` — the `barsByKey` map shape that `ChartGrid` /
 * `ChartCard` consume. The key is `chartKeyToString({symbol, timeframe})`
 * (the same format `extractBarsByKey(snapshot)` produces in
 * `lib/app-helpers.ts`).
 */
export type BarsByKey = Readonly<Record<string, readonly OHLCBar[]>>;

/**
 * `InProgressTick` — the input shape the helper consumes. The shape
 * is a SUBSET of the WS `tick` event (`TickMessage`):
 *   - `symbol` — the exchange symbol (e.g. "BTC/USDC" for bybit.eu)
 *   - `price` — the latest trade price (becomes the bar's `close`
 *     and updates `high`/`low` via max/min)
 *   - `ts` — the server-side emit timestamp in UNIX milliseconds
 *
 * The `lastTick` from `useWebSocket()` is a `TickMessage` (a stricter
 * type), so `lastTick` is structurally assignable to `InProgressTick`.
 */
export interface InProgressTick {
  readonly symbol: string;
  readonly price: number;
  readonly ts: number;
}

/**
 * `SymbolsAndTimeframes` — the `(symbol → timeframes[])` map that
 * `App.tsx` builds via `useMemo` from the strategy descriptors (see
 * `App.tsx:315-334`). Mirrors the shape that the `markersByKey` and
 * `chartSend` machinery already consume.
 */
export type SymbolsAndTimeframes = Readonly<Record<string, readonly string[]>>;

/**
 * `TIMEFRAME_TO_PERIOD_SEC` — the period (in seconds) for each
 * supported timeframe. The helper quantizes the current UNIX time
 * to the period boundary using this table.
 *
 * The set covers the timeframes the bot currently subscribes to
 * (`apps/bot/src/bot/bot.ts:700`: `["1h", "4h", "1d"]`) plus common
 * CCXT-supported timeframes (`1m`/`5m`/`15m`/`30m`/`2h`/`12h`) for
 * forward-compat. An unknown timeframe returns `null` from
 * `periodSecFor` and the helper skips that key (no-op).
 *
 * Implemented as a `Map` (not a plain object) so `Map.get()` returns
 * `T | undefined` (meaningful nullish coalescing) and avoids the
 * `security/detect-object-injection` eslint rule's false-positive on
 * property access.
 */
const TIMEFRAME_TO_PERIOD_SEC = new Map<string, number>([
  ["1m", 60],
  ["5m", 300],
  ["15m", 900],
  ["30m", 1800],
  ["1h", 3600],
  ["2h", 7200],
  ["4h", 14_400],
  ["12h", 43_200],
  ["1d", 86_400],
]);

/**
 * `periodSecFor` — return the period in seconds for a timeframe
 * label, or `null` if the timeframe is not in the table.
 */
function periodSecFor(timeframe: string): number | null {
  return TIMEFRAME_TO_PERIOD_SEC.get(timeframe) ?? null;
}

/**
 * `applyTickToBars` — apply a single WS `tick` event to the
 * `barsByKey` map, mutating the in-progress bar's `close`, `high`,
 * `low` in place (REPLACE) or appending a fresh bar (APPEND).
 *
 * Branches (in order of evaluation):
 *  1. `tick` is `null` / `undefined` / not a well-formed object →
 *     return the prev `barsByKey` unchanged.
 *  2. `tick.price` is non-finite, `<= 0`, or non-numeric → return
 *     the prev `barsByKey` unchanged (a tick with a bogus price
 *     would break the chart's OHLC invariants).
 *  3. `tick.symbol` is not in `symbolsAndTimeframes` → return the
 *     prev `barsByKey` unchanged (the strategy doesn't cover this
 *     symbol; the tick is irrelevant for any chart the dashboard
 *     is rendering).
 *  4. For each timeframe of `tick.symbol`:
 *     - Unknown timeframe (not in `TIMEFRAME_TO_PERIOD_SEC`) → skip.
 *     - The (symbol, timeframe) key is missing or empty in
 *       `barsByKey` → skip (the snapshot hasn't seeded this key
 *       yet; the first `bar` event for this key will set the
 *       baseline, and subsequent ticks will append on top).
 *     - Last bar's `time === computed bar time` → REPLACE the last
 *       bar in place: `close = price`, `high = max(high, price)`,
 *       `low = min(low, price)`, `open` and `volume` unchanged.
 *     - Last bar's `time < computed bar time` → APPEND a new bar
 *       `{ time, open: price, high: price, low: price, close: price,
 *       volume: 0 }`. (The next `bar` event — at the actual
 *       boundary — will reconcile `volume` and may overwrite the
 *       OHLC with the closed values.)
 *     - Last bar's `time > computed bar time` → no-op (stale tick
 *       after a bar close; clock skew can also cause this. The
 *       next `bar` event will reconcile.)
 *
 * **Defensive parsing** — `tick` is validated to be a well-formed
 * `InProgressTick`. A malformed payload returns the prev
 * `barsByKey` unchanged.
 *
 * **Immutable output** — the returned `barsByKey` is a new object
 * (no in-place mutation of the input); React's `setBarsByKey`
 * relies on reference identity to detect the change.
 *
 * @param barsByKey - the current bars map (read-only).
 * @param tick - the WS `tick` event (or `null` on first render).
 * @param symbolsAndTimeframes - the `(symbol → timeframes[])` map
 *   from `App.tsx`'s `useMemo`. The helper uses it to know which
 *   (symbol, timeframe) pairs the dashboard is rendering.
 * @param nowMs - the current UNIX timestamp in ms; exposed as a
 *   parameter for deterministic unit testing. Defaults to
 *   `Date.now()`.
 * @returns the next `barsByKey` (a new object reference on
 *   mutation, or the same reference on no-op).
 */
export function applyTickToBars(
  barsByKey: BarsByKey,
  // The `tick` parameter is typed as `unknown` (not the
  // narrower `InProgressTick | TickMessage | null`) so the
  // defensive branches (null / undefined / primitive inputs
  // like "tick" / 42 / true) can be unit-tested without
  // `// @ts-expect-error` escape hatches. The runtime guards
  // (Branch 1: defensive null + shape check) handle the
  // unknown types safely.
  tick: unknown,
  symbolsAndTimeframes: SymbolsAndTimeframes,
  nowMs: number = Date.now(),
): BarsByKey {
  // Branch 1: defensive null + shape check.
  if (tick === null || tick === undefined || typeof tick !== "object") {
    return barsByKey;
  }
  const t = tick as Partial<InProgressTick>;
  if (typeof t.symbol !== "string" || t.symbol.length === 0) {
    return barsByKey;
  }
  // Branch 2: defensive price check.
  if (
    typeof t.price !== "number" ||
    !Number.isFinite(t.price) ||
    t.price <= 0
  ) {
    return barsByKey;
  }
  // Branch 3: symbol not in the dashboard's render set.
  // `t.symbol` is server-provided (the WS `tick` event's symbol
  // field, originated from the exchange feed), not user input.
  // The `in` check below gates the access; the `length === 0`
  // check covers the case where the symbol is enabled but has
  // no timeframes (the strategy only covers a different
  // timeframe).
  if (!(t.symbol in symbolsAndTimeframes)) {
    return barsByKey;
  }
  const timeframes = symbolsAndTimeframes[t.symbol];
  // No enabled timeframes for this symbol → no-op. The
  // `timeframes === undefined` branch is unreachable here:
  // the `in` check above already proved the key exists, and
  // `Readonly<Record<string, readonly string[]>>` (no
  // `noUncheckedIndexedAccess`) narrows the indexed access to
  // `readonly string[]`.
  if (timeframes.length === 0) {
    return barsByKey;
  }

  let next: Record<string, readonly OHLCBar[]> | null = null;

  for (const tf of timeframes) {
    const periodSec = periodSecFor(tf);
    if (periodSec === null) continue;
    // Quantize the current UNIX time (ms) to the period boundary.
    // `Math.floor(nowMs / 1000 / periodSec) * periodSec` is the
    // boundary in SECONDS since epoch; multiply by 1000 to align
    // with the `barsByKey` (which stores time in ms, per
    // `apps/web/src/lib/ohlc-bridge.ts:30`).
    const barTimeMs = Math.floor(nowMs / 1000 / periodSec) * periodSec * 1000;

    const key = chartKeyToString({ symbol: t.symbol, timeframe: tf });
    // Branch 4a: missing key OR empty key — drop the tick (the
    // `bar` event at the next boundary will seed the key, and
    // subsequent ticks will append on top of the in-progress bar).
    if (!(key in barsByKey)) continue;
    // eslint-disable-next-line security/detect-object-injection -- key is derived from chartKeyToString, not user input
    const existing: readonly OHLCBar[] = barsByKey[key];
    if (existing.length === 0) continue;
    const last = existing[existing.length - 1];

    if (last.time === barTimeMs) {
      // Branch 4b: same time → REPLACE the last bar in place.
      // Update close, high (max), low (min); open + volume
      // preserved from the existing bar.
      const updated: OHLCBar = {
        time: last.time,
        open: last.open,
        high: Math.max(last.high, t.price),
        low: Math.min(last.low, t.price),
        close: t.price,
        volume: last.volume,
      };
      // Lazily allocate the new map on the first mutation so the
      // no-op cases (branches 1-3, 4a) return the same reference.
      next ??= { ...barsByKey };
      // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString, not user input
      next[key] = existing.slice(0, existing.length - 1).concat(updated);
    } else if (last.time < barTimeMs) {
      // Branch 4c: new time → APPEND a fresh in-progress bar.
      // Volume starts at 0; the next `bar` event reconciles it.
      const fresh: OHLCBar = {
        time: barTimeMs,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: 0,
      };
      next ??= { ...barsByKey };
      // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString, not user input
      next[key] = existing.concat(fresh);
    }
    // Branch 4d: stale tick (last.time > barTimeMs) → no-op.
    // Implicit continue (the for-loop body finishes without
    // touching `next`).
  }

  return next ?? barsByKey;
}
