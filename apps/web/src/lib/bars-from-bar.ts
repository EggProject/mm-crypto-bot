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
import { extractBarsByKey } from "./app-helpers.js";

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

// ===========================================================================
// Phase 83.6.1 — SNAPSHOT replay no longer clobbers tick updates
// ===========================================================================
//
// The state-feed broadcasts `snapshot` messages every ~1-2 seconds (the
// `LiveStatePublisher.periodicRefreshMs` defaults to 1000ms — see
// `apps/bot/src/state-feed/publisher.ts:704, 912-921`). Each `snapshot`
// message carries the same `ohlcBootstrap` field as the initial snapshot
// (the publisher fetches it fresh from `OhlcStore.getAll()` on every
// emission, so the historical CSV is the same on every replay; the live
// ring buffer only changes at bar boundaries).
//
// The dashboard's previous `useEffect([snapshot])` REPLACED the entire
// `barsByKey` map with `extractBarsByKey(snapshot)` on every snapshot
// message, which clobbered any tick / bar updates applied between
// snapshots. The browser verification showed: the last bar's `close`
// price updated briefly (e.g. 63641.8 → 63680.1 on a tick) then
// REVERTED to the bootstrap value (63680.1 → 63641.8) on the next
// snapshot, because the snapshot re-seeded the map with the original
// (un-updated) bar.
//
// Fix: replace the REPLACE with a MERGE. For each (symbol, tf) key in
// the incoming `ohlcBootstrap`:
//   - If the key doesn't exist in `prev` (or is empty), add all bars
//     from the snapshot (new-subscription case).
//   - If the key exists, only add bars whose `time` is STRICTLY greater
//     than the last bar in `prev` (replay case = no-op, new-bar case =
//     append the new tail).
//
// This is IDEMPOTENT — applying the same snapshot twice gives the same
// result. The replay case (the bug) is a no-op (no bars in the snapshot
// are newer than the last bar in `prev`), so the tick updates from the
// `bars-from-tick.ts` helper are preserved.

/**
 * `MergeSnapshotResult` — the 3 return shapes of the per-key merge
 * helper. The `noop` and `append`/`new-key` distinction is exposed
 * primarily for the unit test's `it()` labels; the dashboard's
 * `useEffect` only reads `next`.
 */
export interface MergeSnapshotResult {
  readonly kind: "noop" | "merged";
  /** The number of new (symbol, tf) keys added (0 in the common replay case). */
  readonly newKeys: number;
  /** The total number of bars appended across all keys. */
  readonly appendedBars: number;
  readonly next: BarsByKey;
}

/**
 * `mergeSnapshotBars(prev, snapshot)` — merge a SNAPSHOT message's
 * `ohlcBootstrap` into the existing `barsByKey` map. The merge is a
 * per-key "only add NEWER bars" operation:
 *
 *  1. The snapshot is `null` / undefined / a primitive / has no
 *     `ohlcBootstrap` field → return the prev `barsByKey` unchanged.
 *  2. For each (symbol, tf) key in the incoming `ohlcBootstrap`:
 *     a. If the key DOESN'T exist in `prev` (or exists but is empty)
 *        → add all bars from the snapshot (a new strategy subscription
 *        that wasn't enabled at startup).
 *     b. If the key EXISTS in `prev` → find the first bar in the
 *        incoming list whose `time` is STRICTLY greater than the last
 *        bar in `prev`. If no such bar exists (the common SNAPSHOT
 *        replay case), the key is unchanged. If such bars exist,
 *        APPEND them to the existing list.
 *  3. Keys that exist in `prev` but are NOT in the snapshot are
 *     preserved unchanged (the snapshot is an ADDITIVE merge, not a
 *     strict replacement — the dashboard may have already received
 *     bars for a key via WS `bar` events that haven't been emitted
 *     in a `snapshot` yet).
 *
 * **Defensive parsing** — the `snapshot` is validated to be an
 * object with a well-formed `ohlcBootstrap` field via
 * `extractBarsByKey(snapshot)` (which handles the `null` /
 * primitive / `ohlcBootstrap === null` / perTf non-object / bars
 * non-array branches). A malformed snapshot returns the prev
 * `barsByKey` unchanged.
 *
 * **Immutable output** — the returned `barsByKey` is a new object
 * reference on mutation (any new bars added or new keys seeded),
 * or the SAME reference on the all-no-op case (so React's
 * `setBarsByKey` only triggers a re-render when something actually
 * changed).
 *
 * **No volume merging** — the helper treats each bar as a single
 * time-series point. The lightweight-charts v5 `series.setData`
 * invariant (strictly time-ascending, unique `time` — see the
 * memory note from Phase 77) is preserved because the incoming
 * bars are already time-ascending (the `OhlcStore.getAll()` sort
 * + dedup gate runs server-side) and we only APPEND bars that are
 * strictly newer than the existing tail.
 *
 * @param prev - the current `barsByKey` map (read-only).
 * @param snapshot - the WS `snapshot` message (or `null` on first render).
 * @returns the merged `barsByKey` (a new object reference on
 *   mutation, or the same reference on no-op).
 */
export function mergeSnapshotBars(
  prev: BarsByKey,
  snapshot: unknown,
): MergeSnapshotResult {
  const incoming = extractBarsByKey(snapshot);
  const incomingKeys = Object.keys(incoming);
  // Branch 1: malformed / empty snapshot → no-op. The
  // `extractBarsByKey` helper already returns `{}` for any
  // defensive branch (null, primitive, missing ohlcBootstrap,
  // etc.), so an empty object is the all-malformed signal.
  if (incomingKeys.length === 0) {
    return { kind: "noop", newKeys: 0, appendedBars: 0, next: prev };
  }

  let next: Record<string, readonly OHLCBar[]> | null = null;
  let newKeys = 0;
  let appendedBars = 0;

  for (const [key, newBars] of Object.entries(incoming)) {
    // Branch 2a: key missing in prev → add all bars. This covers
    // the "new (symbol, tf) pair appears in a later snapshot" case
    // (e.g. a strategy enabled dynamically after the initial
    // bootstrap). The `key` is derived from
    // `chartKeyToString({ symbol, timeframe })` (NOT user input) —
    // the eslint security rule's object-injection false-positive
    // is acceptable to suppress.
    if (!(key in prev)) {
      next ??= { ...prev };
      // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString
      next[key] = newBars;
      newKeys++;
      appendedBars += newBars.length;
      continue;
    }
    // After the `in` check, the index access is type-safe; the
    // `length === 0` check is the runtime guard for the
    // `barsByKey[key] === []` edge case (a snapshot that
    // includes a key but no bars).
    // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString
    const existing = prev[key] ?? [];
    if (existing.length === 0) {
      next ??= { ...prev };
      // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString
      next[key] = newBars;
      newKeys++;
      appendedBars += newBars.length;
      continue;
    }
    // Branch 2b: key exists. Find the first bar in `newBars`
    // whose `time` is STRICTLY greater than the last bar in
    // `existing`. Linear scan (the snapshot's per-key bar list
    // is bounded by the OhlcStore's `historical.length + live
    // ring buffer capacity (200)`, so the scan is O(200) per
    // key — negligible).
    const lastExisting = existing[existing.length - 1];
    let firstNewerIdx = -1;
    for (let i = 0; i < newBars.length; i++) {
      // eslint-disable-next-line security/detect-object-injection -- newBars is from extractBarsByKey, not user input
      if (newBars[i].time > lastExisting.time) {
        firstNewerIdx = i;
        break;
      }
    }
    if (firstNewerIdx === -1) {
      // All incoming bars are at or before the last existing bar
      // (the SNAPSHOT replay case in the Phase 83.6.1 bug — the
      // publisher re-broadcasts the same ohlcBootstrap on every
      // periodic refresh). No-op for this key.
      continue;
    }
    // Append the strictly-newer tail. The `newBars` is already
    // time-ascending (the `OhlcStore.getAll()` runs a sort + dedup
    // gate server-side), so `slice(firstNewerIdx)` preserves the
    // lightweight-charts v5 setData invariant.
    const tail = newBars.slice(firstNewerIdx);
    next ??= { ...prev };
    // eslint-disable-next-line security/detect-object-injection -- key derived from chartKeyToString
    next[key] = existing.concat(tail);
    appendedBars += tail.length;
  }

  if (next === null) {
    // All keys no-op'd (the common replay case in the bug) —
    // return the same reference so React's `setBarsByKey`
    // doesn't trigger a re-render.
    return { kind: "noop", newKeys: 0, appendedBars: 0, next: prev };
  }
  return {
    kind: "merged",
    newKeys,
    appendedBars,
    next,
  };
}
