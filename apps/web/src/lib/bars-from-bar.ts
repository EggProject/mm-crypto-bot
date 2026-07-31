/**
 * apps/web/src/lib/bars-from-bar.ts
 *
 * ============================================================================
 * PHASE 83.5 — BUG 1: OHLCV candles don't refresh in real-time
 * ============================================================================
 *
 * The bot publishes per-bar `bar` events over the state-feed WebSocket
 * (see `apps/bot/src/state-feed/publisher.ts:1137-1143` and
 * `apps/web/src/ws-client-state.ts:519-524` for the routing). The
 * browser's `useWebSocket()` hook already batches the events into a
 * `lastBar: BarMessage | null` via `ws-client.ts:565, 588-591`, but
 * `App.tsx` was never updated to consume it — the previous (Phase 66)
 * implementation used a `useMemo([snapshot])` whose dependency
 * `snapshot` is set ONCE on mount (the initial SNAPSHOT message), so
 * `barsByKey` never refreshed after the bootstrap.
 *
 * This module provides the pure `appendOrReplaceBar(barsByKey, lastBar)`
 * helper that `App.tsx` invokes in a `useEffect([lastBar])` to keep
 * the chart's bar stream in sync with the WS push.
 *
 * --------------------------------------------------------------------------
 * Why a SEPARATE helper (not inline in App.tsx)?
 * --------------------------------------------------------------------------
 * 1. **Unit-testability** — the 3 branches (new key / same-time replace
 *    / new-time append / missing key no-op) are exercised in
 *    `bars-from-bar.test.ts` without spinning up React or DOM.
 * 2. **Defensive parsing** — the `lastBar` arrives as a `BarMessage`
 *    union variant but the dashboard's `useWebSocket` exposes it
 *    loosely (the WS `bar` event has `ohlc: { time, open, high, low,
 *    close, volume }`); the helper defensive-validates the shape and
 *    returns the prev `barsByKey` unchanged on a malformed input.
 * 3. **Same-key replacement vs. append** — lightweight-charts v5
 *    `series.setData()` requires strictly time-ascending, unique data
 *    (see `apps/web/src/state-feed/ohlc-store.ts` for the analogous
 *    sort+dedup gate). A "live" bar (the in-progress bar) shares the
 *    `time` of the previously-closed bar, and the bot emits a fresh
 *    message every time OHLCV updates — that is a REPLACE, not an
 *    append. The helper detects the same-`time` case and mutates the
 *    last entry in place.
 *
 * --------------------------------------------------------------------------
 * NO React, NO DOM, NO I/O. Pure functional core for the App.tsx
 * `useState`/`useEffect` orchestrator.
 */

import { chartKeyToString } from "./subscription.js";
import type { OHLCBar } from "./ohlc-bridge.js";
import type { BarMessage } from "../ws-client.js";

/**
 * `BarsByKey` — the `barsByKey` map shape that `ChartGrid` /
 * `ChartCard` consume. The key is `chartKeyToString({symbol, timeframe})`
 * (the same format `extractBarsByKey(snapshot)` produces in
 * `lib/app-helpers.ts`).
 */
export type BarsByKey = Readonly<Record<string, readonly OHLCBar[]>>;

/**
 * The 3 return shapes of the in-place "append or replace" helper.
 * Exposed for the unit test's `it()` labels — `append` for a new
 * `time`, `replace` for the same-`time` update path, `noop` for the
 * "first bar before snapshot, no key yet" branch.
 */
export interface AppendOrReplaceResult {
  readonly kind: "append" | "replace" | "noop";
  readonly next: BarsByKey;
}

/**
 * `appendOrReplaceBar(barsByKey, lastBar)` — apply a single WS `bar`
 * event to the `barsByKey` map.
 *
 * Branches:
 *  1. `lastBar` is `null` (or not a well-formed object) → return the
 *     prev `barsByKey` unchanged (`kind: "noop"`).
 *  2. `barsByKey` has no entry for the (symbol, timeframe) key — the
 *     `bar` event arrived before the SNAPSHOT, OR the strategy
 *     was never enabled for this (symbol, tf). The bar is dropped
 *     silently (`kind: "noop"`) — the next SNAPSHOT will re-seed
 *     the bootstrap.
 *  3. The new `ohlc.time` is STRICTLY greater than the last bar's
 *     `time` → APPEND (`kind: "append"`).
 *  4. The new `ohlc.time` is EQUAL to the last bar's `time` →
 *     REPLACE the last bar in place (`kind: "replace"`). The bot
 *     emits a fresh `bar` event every OHLCV tick for the in-progress
 *     bar (same `time`, updated `open/high/low/close`); lightweight-
 *     charts `series.setData()` requires unique `time` values, so
 *     the in-place mutation is the correct behavior.
 *  5. The new `ohlc.time` is LESS than the last bar's `time` → a
 *     "stale" bar (out-of-order WS delivery, e.g. after a reconnect).
 *     This branch is treated as a no-op (`kind: "noop"`) — the next
 *     SNAPSHOT will reconcile. Lightweight-charts v5's `setData`
 *     requires strict time-ascending; an out-of-order APPEND would
 *     throw "Value is null" (see memory note from Phase 77).
 *
 * **Defensive parsing** — `lastBar.ohlc` is validated to be a
 * well-formed `OHLCBar` (6 numeric fields, finite). A malformed
 * payload returns the prev `barsByKey` unchanged.
 *
 * **Immutable output** — the returned `barsByKey` is a new object
 * (no in-place mutation of the input); React's `setBarsByKey` relies
 * on reference identity to detect the change.
 */
export function appendOrReplaceBar(
  barsByKey: BarsByKey,
  lastBar: unknown,
): AppendOrReplaceResult {
  // Branch 1: defensive null + shape check.
  if (lastBar === null || typeof lastBar !== "object") {
    return { kind: "noop", next: barsByKey };
  }
  const msg = lastBar as Partial<BarMessage>;
  if (typeof msg.symbol !== "string" || msg.symbol.length === 0) {
    return { kind: "noop", next: barsByKey };
  }
  if (typeof msg.timeframe !== "string" || msg.timeframe.length === 0) {
    return { kind: "noop", next: barsByKey };
  }
  // The TS type of `msg.ohlc` is `unknown` here (the WS payload is
  // loosely typed). `typeof null === "object"` in JS, so the
  // explicit `=== null` guard is required at runtime even though
  // the lint sees the type as already non-null.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof msg.ohlc !== "object" || msg.ohlc === null) {
    return { kind: "noop", next: barsByKey };
  }
  const o = msg.ohlc as Partial<OHLCBar>;
  if (
    typeof o.time !== "number" ||
    typeof o.open !== "number" ||
    typeof o.high !== "number" ||
    typeof o.low !== "number" ||
    typeof o.close !== "number" ||
    typeof o.volume !== "number" ||
    !Number.isFinite(o.time) ||
    !Number.isFinite(o.open) ||
    !Number.isFinite(o.high) ||
    !Number.isFinite(o.low) ||
    !Number.isFinite(o.close) ||
    !Number.isFinite(o.volume)
  ) {
    return { kind: "noop", next: barsByKey };
  }
  const bar: OHLCBar = {
    time: o.time,
    open: o.open,
    high: o.high,
    low: o.low,
    close: o.close,
    volume: o.volume,
  };

  const key = chartKeyToString({ symbol: msg.symbol, timeframe: msg.timeframe });

  // Branch 2: missing key OR empty key — drop the bar (next
  // SNAPSHOT will re-seed). The `key` is derived from
  // `chartKeyToString({ symbol, timeframe })` (NOT user input) —
  // the eslint security rule's object-injection false-positive is
  // acceptable to suppress. The `in` check is the runtime
  // guard for the strict tsconfig (no `noUncheckedIndexedAccess`
  // here, so the index access type is `readonly OHLCBar[]` not
  // `... | undefined` — but JS still returns `undefined` for a
  // missing key).
  if (!(key in barsByKey)) {
    return { kind: "noop", next: barsByKey };
  }
  // eslint-disable-next-line security/detect-object-injection
  const existing = barsByKey[key];
  if (existing.length === 0) {
    return { kind: "noop", next: barsByKey };
  }

  // After the `existing.length === 0` guard, the last element is
  // guaranteed defined.
  const last = existing[existing.length - 1];

  // Branch 3: same time → REPLACE the last bar in place.
  if (bar.time === last.time) {
    // Same-timestamp live update (the in-progress bar). The new OHLC
    // supersedes the previous one; we mutate only the last slot.
    const next: Record<string, readonly OHLCBar[]> = { ...barsByKey };
    const updated = existing.slice(0, existing.length - 1).concat(bar);
    // `key` is derived from the `chartKeyToString` helper (NOT
    // user input), so the eslint security rule's
    // object-injection false-positive is acceptable to suppress.
    // eslint-disable-next-line security/detect-object-injection
    next[key] = updated;
    return { kind: "replace", next };
  }

  // Branch 4: new time → APPEND.
  if (bar.time > last.time) {
    const next: Record<string, readonly OHLCBar[]> = { ...barsByKey };
    const appended = existing.concat(bar);
    // eslint-disable-next-line security/detect-object-injection
    next[key] = appended;
    return { kind: "append", next };
  }

  // Branch 5: stale (out-of-order) bar → no-op.
  return { kind: "noop", next: barsByKey };
}
