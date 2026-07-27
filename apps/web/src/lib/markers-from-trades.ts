/**
 * apps/web/src/lib/markers-from-trades.ts
 *
 * Phase 82 (3 dashboard UI bugs — item 5): helper to derive
 * `markersByKey` (the per-chart marker map passed to
 * `ChartGrid` → `ChartCard`) from the bot's ACTUAL trades.
 *
 * **Why this exists:** previously `App.tsx` passed
 * `markersByKey={{}}` to the chart grid. The `ChartCard` then
 * rendered the strategy-specific indicators' client-computed
 * markers (e.g. `breakoutMarkerIndicator` derives entry/exit
 * arrows from the Donchian band on the bar stream — these are
 * HYPOTHETICAL signals, not the bot's actual executions). The
 * user complaint: "chartokon csak olyan trade-t rajzoljunk ki
 * amit a robot csinalt" (only draw trades that the bot actually
 * did). The fix: build a markers map from the WS `state` event's
 * `positions` (open positions → ENTRY markers) and
 * `closedTrades` (closed trades → ENTRY + EXIT markers), keyed
 * by the same `symbol` as the bar stream.
 *
 * **The `markersByKey` key format:** `chartKeyToString({symbol, timeframe})`
 * — the same format `ChartGrid` uses for `barsByKey`. The
 * markers are produced for ALL configured timeframes of a
 * given symbol (the trade has only one `openedAt`/`closedAt`
 * timestamp; we replicate the marker on every tf so the user
 * sees the trade on every chart that covers the symbol —
 * matches the existing convention of the OHLC stream itself).
 *
 * **Defensive parsing:** the WS `state` message's `positions`
 * and `closedTrades` are typed as `readonly object[]` in the
 * web client's `ws-client.ts` (the state-feed protocol types
 * are strict on the server side, but the web client keeps the
 * shape loose for forward-compat). This helper defensively
 * walks the shape and returns `[]` for any malformed element
 * — same pattern as `parsePosition` in `bot-status.ts`.
 *
 * **No React, no DOM, no I/O.** Pure function, easy to unit
 * test.
 */

import type { ChartMarker } from "./ohlc-bridge.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * The `markersByKey` shape that `ChartGrid` expects. The key is
 * `chartKeyToString({symbol, timeframe})` (the same format as
 * `barsByKey`).
 */
export type MarkersByKey = Readonly<Record<string, readonly ChartMarker[]>>;

// ============================================================================
// Public API
// ============================================================================

/**
 * `buildMarkersByKey(lastState, timeframesBySymbol)` — convert
 * the WS `state` event's `positions` + `closedTrades` arrays
 * into a `markersByKey` map keyed by `chartKeyToString` for
 * every (symbol, timeframe) combination the chart grid renders.
 *
 * The function is defensive: a `null` `lastState`, missing
 * `positions` / `closedTrades` fields, or malformed individual
 * trade objects are silently dropped (the chart still renders
 * the empty markers list, which the chart-card legend already
 * handles).
 *
 * The function does NOT depend on `barsByKey` — it only depends
 * on the WS `state` event and the set of timeframes per symbol
 * (passed in by the caller from the strategy descriptors).
 *
 * @param lastState  - the `Extract<ServerMessage, {type:"state"}>`
 *                     from the WS client, or `null` if no state
 *                     event has arrived yet. The shape is loose
 *                     (`positions: readonly object[]`) so we walk
 *                     it defensively.
 * @param symbolsAndTimeframes - the union of every
 *                     `(symbol, timeframe)` pair the chart grid
 *                     renders (extracted from
 *                     `StrategyDescriptor[]`). Each trade marker
 *                     is replicated for every (symbol, tf) pair
 *                     so the trade appears on all of the user's
 *                     charts for that symbol.
 * @returns `markersByKey` map. Empty `{}` when no trades exist
 *          or the input is `null`.
 */
export function buildMarkersByKey(
  lastState: unknown,
  symbolsAndTimeframes: Readonly<Record<string, readonly string[]>>,
): MarkersByKey {
  if (lastState === null || typeof lastState !== "object") return {};
  const state = lastState as {
    positions?: unknown;
    closedTrades?: unknown;
  };
  const positionsRaw = state.positions;
  const closedTradesRaw = state.closedTrades;
  const out: Record<string, ChartMarker[]> = {};

  // Open positions → ENTRY marker (belowBar/aboveBar + arrowUp/Down
  // by side). The open position's `openedAt` is the entry time.
  if (Array.isArray(positionsRaw)) {
    for (const p of positionsRaw) {
      const parsed = parseOpenPositionMarker(p);
      if (parsed === null) continue;
      // Defensive: skip trades for symbols not in the chart grid
      // (the WS `state` event may carry positions for symbols
      // that aren't enabled in the current config — e.g. after
      // a config reload). The `=== undefined` check is
      // technically unnecessary under the current tsconfig
      // (no `noUncheckedIndexedAccess`) but is preserved for
      // runtime safety in production.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (symbolsAndTimeframes[parsed.symbol] === undefined) continue;
      const tfs = symbolsAndTimeframes[parsed.symbol];
      for (const tf of tfs) {
        const list: ChartMarker[] = out[`${parsed.symbol}|${tf}`] ?? [];
        list.push(parsed.marker);
        out[`${parsed.symbol}|${tf}`] = list;
      }
    }
  }

  // Closed trades → ENTRY marker (at `openedAt`) + EXIT marker
  // (at `closedAt`). The ENTRY side comes from `side` (buy/sell);
  // the EXIT side is the inverse (closing a long = sell = aboveBar
  // arrowDown red; closing a short = buy = belowBar arrowUp green).
  if (Array.isArray(closedTradesRaw)) {
    for (const t of closedTradesRaw) {
      const parsed = parseClosedTradeMarkers(t);
      if (parsed === null) continue;
      // Same defensive skip as the open-positions branch.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (symbolsAndTimeframes[parsed.symbol] === undefined) continue;
      const tfs = symbolsAndTimeframes[parsed.symbol];
      for (const tf of tfs) {
        const list: ChartMarker[] = out[`${parsed.symbol}|${tf}`] ?? [];
        list.push(parsed.entry);
        list.push(parsed.exit);
        out[`${parsed.symbol}|${tf}`] = list;
      }
    }
  }

  // Freeze every value to a `readonly ChartMarker[]` so the
  // returned `MarkersByKey` is `readonly` end-to-end.
  const result: Record<string, readonly ChartMarker[]> = {};
  for (const [key, list] of Object.entries(out)) {
    // `key` is derived from `Object.entries`, not user input —
    // the security lint false-positive is acceptable to suppress.
    // eslint-disable-next-line security/detect-object-injection
    result[key] = list;
  }
  return result;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * `parseOpenPositionMarker(p)` — defensively extract a single
 * ENTRY `ChartMarker` from an open position object. Returns
 * `null` when the shape is malformed (the chart simply doesn't
 * render the marker, same pattern as `parsePosition` in
 * `bot-status.ts`).
 *
 * The marker color/shape follows the `barToMarker` convention
 * in `ohlc-bridge.ts`:
 *   - "buy"  → belowBar + arrowUp + green (#22c55e)
 *   - "sell" → aboveBar + arrowDown + red   (#ef4444)
 */
function parseOpenPositionMarker(
  p: unknown,
): { readonly symbol: string; readonly marker: ChartMarker } | null {
  if (typeof p !== "object" || p === null) return null;
  const pos = p as Record<string, unknown>;
  if (typeof pos.symbol !== "string") return null;
  if (typeof pos.openedAt !== "number") return null;
  if (pos.side !== "buy" && pos.side !== "sell") return null;
  const marker: ChartMarker =
    pos.side === "buy"
      ? {
          time: pos.openedAt,
          position: "belowBar",
          color: "#22c55e",
          shape: "arrowUp",
          text: "LONG",
        }
      : {
          time: pos.openedAt,
          position: "aboveBar",
          color: "#ef4444",
          shape: "arrowDown",
          text: "SHORT",
        };
  return { symbol: pos.symbol, marker };
}

/**
 * `parseClosedTradeMarkers(t)` — defensively extract ENTRY +
 * EXIT `ChartMarker`s from a closed-trade object. Returns
 * `null` when the shape is malformed.
 *
 * The ENTRY marker color/shape follows the trade's `side`
 * (the direction the bot entered). The EXIT marker is the
 * inverse: closing a long = sell, closing a short = buy. The
 * exit uses the same color convention as the entry
 * (green=long, red=short) so the user can see "the trade
 * that was entered" vs "the trade that was closed" at a
 * glance — a green ENTRY + green EXIT is a closed long, a
 * red ENTRY + red EXIT is a closed short.
 */
function parseClosedTradeMarkers(
  t: unknown,
): {
  readonly symbol: string;
  readonly entry: ChartMarker;
  readonly exit: ChartMarker;
} | null {
  if (typeof t !== "object" || t === null) return null;
  const tr = t as Record<string, unknown>;
  if (typeof tr.symbol !== "string") return null;
  if (typeof tr.openedAt !== "number") return null;
  if (typeof tr.closedAt !== "number") return null;
  if (tr.side !== "buy" && tr.side !== "sell") return null;
  const isLong = tr.side === "buy";
  const entry: ChartMarker = isLong
    ? {
        time: tr.openedAt,
        position: "belowBar",
        color: "#22c55e",
        shape: "arrowUp",
        text: "LONG",
      }
    : {
        time: tr.openedAt,
        position: "aboveBar",
        color: "#ef4444",
        shape: "arrowDown",
        text: "SHORT",
      };
  // The EXIT marker uses the same color as the entry (so a
  // closed long = green/green, a closed short = red/red) and
  // a hollow `circle` shape (visually distinct from the
  // solid arrow entries, with no "LONG/SHORT" text — the
  // `text: "EXIT"` is sufficient).
  const exit: ChartMarker = isLong
    ? {
        time: tr.closedAt,
        position: "aboveBar",
        color: "#22c55e",
        shape: "circle",
        text: "EXIT",
      }
    : {
        time: tr.closedAt,
        position: "belowBar",
        color: "#ef4444",
        shape: "circle",
        text: "EXIT",
      };
  return { symbol: tr.symbol, entry, exit };
}
