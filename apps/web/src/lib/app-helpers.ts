/**
 * apps/web/src/lib/app-helpers.ts
 *
 * Phase 56B: pure helpers extracted from `App.tsx` for direct
 * unit-testability and e2e coverage of the 19 uncovered branches
 * in the React flow.
 *
 * The 6 helpers here are all PURE — no React, no DOM, no I/O:
 *   1. `mapFeedState(status)` — map WS status to ChartGrid's
 *      `feedState` union (covers the "crashed" branch).
 *   2. `extractBarsByKey(snapshot)` — defensively walk the
 *      snapshot's `ohlcBootstrap` (covers the perTf/bar branches
 *      that the empty-bootstrap test never hit).
 *   3. `buildStatusLabel(status, snapshot, lastError)` — the
 *      inline `statusLabel` map in App.tsx, as a function (covers
 *      the `snapshot === null` ternary and the
 *      `lastError?.message ?? "unknown"` coalesce).
 *   4. `buildFeedMeta(lastError, strategiesError)` — the `??`
 *      chain that produces the chart-grid `feedMeta` string.
 *   5. `buildFetchErrorMessage(e)` — the catch-block error
 *      handling (covers the AbortError / non-Error branches).
 *   6. `applyParsedStrategies(parsed)` — the `parsed.ok` ternary
 *      dispatcher (turns the if-else into a single helper call).
 *
 * **No behavior change**: each helper produces the same value
 * the inline code would have produced, with the same control
 * flow. The e2e suite still drives the React flow through every
 * branch; the new e2e tests (56B-01..04) cover the branches the
 * existing 53C/55-2 tests missed.
 */

import { chartKeyToString } from "./subscription.js";
import type { StrategyDescriptor } from "../components/ChartGrid.js";
import type { OHLCBar } from "./ohlc-bridge.js";
import type { WebSocketStatus } from "../ws-client.js";

/**
 * `FeedState` — the ChartGrid `feedState` prop is a strict 5-value
 * union. `mapFeedState` produces 4 of them ("paused" is never
 * reached — pause is handled inside the engine, not the WS status).
 *
 * The full union is exported so `App.tsx`'s `feedState` prop type
 * stays identical to the pre-56B version (no behavior change).
 */
export type FeedState =
  | "live"
  | "stale"
  | "paused"
  | "crashed"
  | "disconnected";

/**
 * `mapFeedState(status)` — map the WS status to the ChartGrid's
 * `feedState` prop union.
 *
 * "connecting" → "stale" (we haven't received a snapshot yet, so
 * the data is not live but the connection isn't declared failed
 * either).
 *
 * The "crashed" branch was uncovered by the e2e suite before 56B
 * because no test sent a non-recoverable error to App's WS. The
 * 56B-02 e2e test sends a `{"type":"error","recoverable":false}`
 * message to App's WS, flipping status to "crashed", and asserts
 * the `.ep-app__error` banner is visible.
 */
export function mapFeedState(status: WebSocketStatus): FeedState {
  if (status === "connected") return "live";
  if (status === "crashed") return "crashed";
  if (status === "disconnected") return "disconnected";
  return "stale";
}

/**
 * `extractBarsByKey(snapshot)` — defensively walk the snapshot's
 * `ohlcBootstrap` and produce a flat `Record<"symbol|tf", readonly OHLCBar[]>`
 * keyed by `chartKeyToString`.
 *
 * The ws-client types `ohlcBootstrap` as `object` (loose), so we
 * validate at runtime. Malformed inputs (non-objects, non-array
 * bar lists) are silently dropped — the ChartGrid will simply not
 * have data for those keys and will show the "Loading…" placeholder
 * until the next valid snapshot arrives.
 *
 * The 56B-01 e2e test sends a snapshot with REAL `ohlcBootstrap`
 * data (the 53C/55-2 tests send `{ ohlcBootstrap: { BTCUSDT: { "1h": [] } } }`
 * which has the structure but no bars — this hits the early-return
 * branch at line 86, not the perTf/bar loop). With real bars, the
 * function traverses the inner `for (tf, bars)` loop and exercises
 * the `Array.isArray(bars)` branch.
 */
export function extractBarsByKey(
  snapshot: unknown,
): Readonly<Record<string, readonly OHLCBar[]>> {
  if (typeof snapshot !== "object" || snapshot === null) return {};
  const raw = (snapshot as { ohlcBootstrap?: unknown }).ohlcBootstrap;
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, readonly OHLCBar[]> = {};
  for (const [symbol, perTf] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (typeof perTf !== "object" || perTf === null) continue;
    for (const [tf, bars] of Object.entries(perTf as Record<string, unknown>)) {
      // The bar shape is verified at the state-feed publisher; if
      // the publisher is honest, every array here is a valid
      // OHLCBar[]. We cast rather than re-validate to keep the hot
      // path cheap (this runs on every snapshot).
      if (Array.isArray(bars)) {
        out[chartKeyToString({ symbol, timeframe: tf })] =
          bars as readonly OHLCBar[];
      }
    }
  }
  return out;
}

/**
 * `StatusLabelSnapshot` — minimal snapshot shape needed by
 * `buildStatusLabel`. Avoids importing the full WS protocol type
 * — we only read `strategies.length` for the connected-status
 * label.
 */
export interface StatusLabelSnapshot {
  readonly strategies: readonly unknown[];
}

/**
 * `ErrorLike` — anything with a `message: string` field. The WS
 * protocol's `error` message shape is `{ type: "error", ts, message,
 * recoverable }`; a thrown `Error` also has a `message`. We use
 * this shared interface so `buildStatusLabel` and `buildFeedMeta`
 * accept both without a cast.
 */
export interface ErrorLike {
  readonly message: string;
}

/**
 * `buildStatusLabel(status, snapshot, lastError)` — produce the
 * human-readable WS status label that the topbar shows.
 *
 * The label is a function of three pieces of state:
 *   - `status` (the WS state)
 *   - `snapshot` (the most recent snapshot, or null)
 *   - `lastError` (the most recent WS error, or null)
 *
 * Pure: no I/O, no React, no side effects. Unit-testable.
 */
export function buildStatusLabel(
  status: WebSocketStatus,
  snapshot: StatusLabelSnapshot | null,
  lastError: ErrorLike | null | undefined,
): string {
  switch (status) {
    case "disconnected":
      return "WebSocket: disconnected";
    case "connecting":
      return "WebSocket: connecting…";
    case "connected":
      return `WebSocket: connected${
        snapshot !== null
          ? ` (${snapshot.strategies.length} strategies)`
          : ""
      }`;
    case "crashed":
      return `WebSocket: crashed — ${lastError?.message ?? "unknown"}`;
  }
}

/**
 * `buildFeedMeta(lastError, strategiesError)` — produce the
 * `feedMeta` string that the chart grid shows as the right-tail
 * of the feed indicator.
 *
 * Priority: WS error → strategies fetch error → empty string.
 *
 * The 3-way `??` chain has 3 branches:
 *   1. `lastError?.message` is a non-empty string (WS error wins)
 *   2. `lastError` is null/undefined AND `strategiesError` is a string
 *   3. both are null/undefined (empty string)
 *
 * Branch 2 was the only one uncovered before 56B (the existing
 * tests trigger either a WS error OR a strategies error, not
 * just a strategies error with no WS error). The 56B-03 test
 * covers branch 2 by triggering a strategies fetch error
 * WITHOUT sending any WS error message.
 */
export function buildFeedMeta(
  lastError: ErrorLike | null | undefined,
  strategiesError: string | null | undefined,
): string {
  return lastError?.message ?? strategiesError ?? "";
}

/**
 * `buildFetchErrorMessage(e)` — turn a caught fetch error into
 * either:
 *   - `null` — the fetch was aborted (no error to surface)
 *   - a string — the human-readable error message
 *
 * Extracted from the inline `catch (e) { ... }` block in App.tsx
 * to make the 4 branches (instanceof Error, name==="AbortError",
 * ternary true/false) directly unit-testable.
 *
 * The 56B-04 e2e test triggers the AbortError path by closing
 * App's WS while a fetch is in flight; the controller aborts the
 * fetch, the catch block sees an `AbortError`, and the helper
 * returns `null` (no error to surface — the WS is gone anyway).
 */
export function buildFetchErrorMessage(e: unknown): string | null {
  if (e instanceof Error && e.name === "AbortError") return null;
  return e instanceof Error ? e.message : "fetch failed";
}

/**
 * `StrategiesResultLike` — minimal shape of `parseStrategiesResponse`'s
 * return value. Defined here to avoid a circular import (we don't
 * want this file to import from `strategies-parser.ts`, just to
 * accept the same shape).
 */
export type StrategiesResultLike =
  | { readonly ok: true; readonly strategies: readonly StrategyDescriptor[] }
  | { readonly ok: false; readonly error: string };

/**
 * `FetchNextState` — the next-state shape the App component applies
 * to its `useState` setters.
 *
 *   - `{ strategies, error: null }` when the parse was ok
 *   - `{ strategies: null, error }` when the parse was not ok
 *
 * The "no update" path is encoded as `strategies: null` so the
 * component can use a single ternary `if (next.strategies !== null)`
 * instead of an `if (parsed.ok)` outer + 2 inner setters.
 */
export type FetchNextState =
  | {
      readonly strategies: readonly StrategyDescriptor[];
      readonly error: null;
    }
  | { readonly strategies: null; readonly error: string };

/**
 * `applyParsedStrategies(parsed)` — convert a `StrategiesResult`
 * from `parseStrategiesResponse` into a plain next-state shape
 * the component applies to its `useState` setters.
 *
 * This makes the `parsed.ok` ternary in App.tsx a single function
 * call instead of an inline if-else with two sub-branches. The
 * helper is unit-testable; the call site is a 2-line dispatch
 * (if-else on the next state) that is trivially covered by the
 * existing 53C-07/09/10/11 e2e tests.
 */
export function applyParsedStrategies(
  parsed: StrategiesResultLike,
): FetchNextState {
  if (parsed.ok) {
    return { strategies: parsed.strategies, error: null };
  }
  return { strategies: null, error: parsed.error };
}
