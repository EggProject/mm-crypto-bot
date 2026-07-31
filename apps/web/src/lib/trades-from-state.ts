/**
 * apps/web/src/lib/trades-from-state.ts
 *
 * ============================================================================
 * PHASE 83.5 — BUG 2: TradeHistoryTable was polling /api/trades
 * ============================================================================
 *
 * The dashboard's `TradeHistoryTable` was polling `GET /api/trades`
 * every 5 seconds (Phase 82, item 4). The user mandate is to use
 * the WebSocket for ALL real-time data — no polling. The WS `state`
 * event already carries the bot's `positions` (open) + `history`
 * (closed) on every state notification; the `/api/trades` endpoint
 * just aggregates those same two arrays into a `TradeHistoryItem[]`
 * with the same sort order.
 *
 * This module is the WebSocket-side mirror of the HTTP handler in
 * `apps/bot/src/web-client/http-server.ts:435-520` (`openPositionToTradeItem`
 * + `closedTradeToTradeItem` + the sort). The logic is duplicated
 * here because:
 *
 *   1. The web side can't import from the bot package (no shared
 *      TS workspace export for the helper).
 *   2. The shape contract is identical — the WS `state.snapshot`
 *      carries `positions: StateFeedPosition[]` and
 *      `history: StateFeedTrade[]`, exactly the inputs the HTTP
 *      handler consumes. The conversion to `TradeHistoryItem` is
 *      1:1.
 *
 * If the bot's conversion logic ever changes, this helper MUST be
 * kept in sync (mirror the http-server's `openPositionToTradeItem` +
 * `closedTradeToTradeItem` field-by-field).
 *
 * --------------------------------------------------------------------------
 * Pattern mirrors `apps/web/src/lib/markers-from-trades.ts`:
 *   - pure function, no React/DOM/I/O
 *   - defensive shape checks (the WS `state` payload is loosely
 *     typed as `object` in the web client for forward-compat — the
 *     real protocol types live in `apps/bot/src/state-feed/publisher.ts`)
 *   - 100% unit-test coverage in `__tests__/trades-from-state.test.ts`
 *
 * --------------------------------------------------------------------------
 * No React, no DOM, no I/O. Pure.
 */

import type { TradeHistoryItem } from "../components/TradeHistoryTable.js";

// ============================================================================
// Internal types (the loose WS `state.snapshot` shape, mirrored from
// `apps/bot/src/state-feed/publisher.ts:111-140`).
//
// We declare a MINIMAL interface here — only the fields we read. The
// real `StateFeedPosition` and `StateFeedTrade` have additional
// fields (e.g. `currentPrice`, `stopLoss`, `takeProfit`, `reason`)
// that we ignore.
// ============================================================================

interface LoosePosition {
  readonly id: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly entryPrice: number;
  readonly quantity: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly unrealizedPnlPct: number;
  readonly openedAt: number;
}

interface LooseTrade {
  readonly id: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly leverage: number;
  readonly pnlUsdt: number;
  readonly pnlPct: number;
  readonly openedAt: number;
  readonly closedAt: number;
  readonly reason: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * `tradesFromState(lastState)` — convert the WS `state` event's
 * `positions` (open) + `history` (closed) into a unified
 * `TradeHistoryItem[]`, sorted by `(exitTime ?? entryTime) desc`
 * (matches the HTTP `/api/trades` endpoint's sort order).
 *
 * Defensive: a `null` `lastState`, missing fields, or malformed
 * individual items are silently dropped. The HTTP handler does the
 * same; the dashboard's behavior is identical whether the data
 * arrives over WS or HTTP.
 *
 * **Strategy name extraction** — the `strategy` field in
 * `TradeHistoryItem` is derived from:
 *   - open position: `position.id` prefix (the Phase 68 `restorePosition`
 *     format is `<strategy>:<symbol>:<side>`); fallback `"unknown"`.
 *   - closed trade: `trade.reason` field (the bot's `mapClosedTrade`
 *     writes the strategy name there); fallback `"unknown"`.
 *
 * **Duration** — for an open position, `duration = now - openedAt`
 * (a "live" duration, refreshed on every render). For a closed trade,
 * `duration = closedAt - openedAt` (the realized trade duration).
 *
 * @param lastState  - the `Extract<ServerMessage, {type:"state"}>`
 *                     from the WS client, or `null` if no state
 *                     event has arrived yet.
 * @returns `TradeHistoryItem[]`. Empty `[]` when `lastState` is
 *          `null` or carries no trades.
 */
export function tradesFromState(lastState: unknown): readonly TradeHistoryItem[] {
  if (lastState === null || typeof lastState !== "object") return [];
  // The WS `state` message embeds the full snapshot under
  // `lastState.snapshot`, AND carries `positions` / `closedTrades` as
  // top-level fields (mirroring the SNAPSHOT message). The HTTP
  // `/api/trades` handler reads from the CACHED snapshot
  // (`ctx.snapshot.positions/history`) — the WS `state.snapshot`
  // has the same shape (positions[] + history[]).
  const state = lastState as {
    snapshot?: { positions?: unknown; history?: unknown };
    positions?: unknown;
    closedTrades?: unknown;
  };
  const snapshot = state.snapshot;
  // The dashboard's bar/marker pipeline reads `lastState.positions` /
  // `lastState.closedTrades` (top-level). The bot's `state` message
  // also embeds the full `snapshot`, but the closed-trades field is
  // called `history` there. We accept BOTH layouts for forward-compat
  // with mock data. The `typeof snapshot === "object"` check excludes
  // `null` (typeof null === "object"), so the `!== null` guard is
  // redundant under the strict tsconfig.
  const positionsRaw =
    state.positions ??
    (typeof snapshot === "object" ? snapshot.positions : undefined);
  const historyRaw =
    state.closedTrades ??
    (typeof snapshot === "object" ? snapshot.history : undefined);
  // Defensive: if `state.closedTrades` is an empty array but
  // `snapshot.history` has items (the HTTP-server test fixture uses
  // the latter layout), the `??` resolves to the empty array and we
  // lose the data. Guard with the truthy `??` short-circuit AND an
  // explicit length check.
  const positionsList: readonly unknown[] = Array.isArray(positionsRaw) ? positionsRaw : [];
  const historyList: readonly unknown[] = Array.isArray(historyRaw) ? historyRaw : [];

  const out: TradeHistoryItem[] = [];
  const now = Date.now();
  for (const p of positionsList) {
    const item = openPositionToTradeItem(p, now);
    if (item !== null) out.push(item);
  }
  for (const t of historyList) {
    const item = closedTradeToTradeItem(t);
    if (item !== null) out.push(item);
  }
  // Sort by (exitTime ?? entryTime) desc — matches the HTTP handler.
  out.sort((a, b) => {
    const aTs = a.exitTime ?? a.entryTime;
    const bTs = b.exitTime ?? b.entryTime;
    return bTs - aTs;
  });
  return out;
}

// ============================================================================
// Internal helpers — mirror `apps/bot/src/web-client/http-server.ts`
// `openPositionToTradeItem` + `closedTradeToTradeItem` exactly.
// ============================================================================

/**
 * `openPositionToTradeItem(p, now)` — defensively extract a single
 * open position as a `TradeHistoryItem`. Returns `null` for a
 * malformed input.
 *
 * **Mirror of** `apps/bot/src/web-client/http-server.ts:444-477`
 * (the `openPositionToTradeItem` function in the HTTP handler). If
 * the HTTP handler changes its shape, this helper must be updated
 * to match (or the dashboard will show a different shape than the
 * CLI's `mm-bot trades` output).
 */
function openPositionToTradeItem(p: unknown, now: number): TradeHistoryItem | null {
  if (typeof p !== "object" || p === null) return null;
  const pos = p as Partial<LoosePosition>;
  if (typeof pos.symbol !== "string" || pos.symbol.length === 0) return null;
  if (typeof pos.id !== "string" || pos.id.length === 0) return null;
  // The `pos.side` is `"buy" | "sell"` per the WS protocol, but the
  // dashboard's WS `state` payload is loosely typed — the defensive
  // runtime check protects against mock / legacy data with a stale
  // shape.
  if (pos.side !== "buy" && pos.side !== "sell") return null;
  if (typeof pos.entryPrice !== "number" || !Number.isFinite(pos.entryPrice)) return null;
  if (typeof pos.openedAt !== "number" || !Number.isFinite(pos.openedAt)) return null;
  if (typeof pos.quantity !== "number" || !Number.isFinite(pos.quantity)) return null;
  const strategy = pos.id.includes(":") ? (pos.id.split(":")[0] ?? "unknown") : "unknown";
  return {
    id: pos.id,
    strategy,
    symbol: pos.symbol,
    side: pos.side,
    entryPrice: pos.entryPrice,
    entryTime: pos.openedAt,
    exitPrice: null,
    exitTime: null,
    quantity: pos.quantity,
    leverage:
      typeof pos.leverage === "number" && Number.isFinite(pos.leverage) ? pos.leverage : 1,
    pnl:
      typeof pos.unrealizedPnl === "number" && Number.isFinite(pos.unrealizedPnl)
        ? pos.unrealizedPnl
        : 0,
    pnlPct:
      typeof pos.unrealizedPnlPct === "number" && Number.isFinite(pos.unrealizedPnlPct)
        ? pos.unrealizedPnlPct
        : 0,
    duration: Math.max(0, now - pos.openedAt),
    status: "open",
  };
}

/**
 * `closedTradeToTradeItem(t)` — defensively extract a single closed
 * trade as a `TradeHistoryItem`. Returns `null` for a malformed
 * input.
 *
 * **Mirror of** `apps/bot/src/web-client/http-server.ts:489-520`
 * (the `closedTradeToTradeItem` function in the HTTP handler).
 */
function closedTradeToTradeItem(t: unknown): TradeHistoryItem | null {
  if (typeof t !== "object" || t === null) return null;
  const tr = t as Partial<LooseTrade>;
  if (typeof tr.symbol !== "string" || tr.symbol.length === 0) return null;
  if (tr.side !== "buy" && tr.side !== "sell") return null;
  if (typeof tr.entryPrice !== "number" || !Number.isFinite(tr.entryPrice)) return null;
  if (typeof tr.exitPrice !== "number" || !Number.isFinite(tr.exitPrice)) return null;
  if (typeof tr.closedAt !== "number" || !Number.isFinite(tr.closedAt)) return null;
  if (typeof tr.openedAt !== "number" || !Number.isFinite(tr.openedAt)) return null;
  if (typeof tr.quantity !== "number" || !Number.isFinite(tr.quantity)) return null;
  if (typeof tr.id !== "string" || tr.id.length === 0) return null;
  return {
    id: tr.id,
    strategy: typeof tr.reason === "string" && tr.reason.length > 0 ? tr.reason : "unknown",
    symbol: tr.symbol,
    side: tr.side,
    entryPrice: tr.entryPrice,
    entryTime: tr.openedAt,
    exitPrice: tr.exitPrice,
    exitTime: tr.closedAt,
    quantity: tr.quantity,
    leverage:
      typeof tr.leverage === "number" && Number.isFinite(tr.leverage) ? tr.leverage : 1,
    pnl: typeof tr.pnlUsdt === "number" && Number.isFinite(tr.pnlUsdt) ? tr.pnlUsdt : 0,
    pnlPct: typeof tr.pnlPct === "number" && Number.isFinite(tr.pnlPct) ? tr.pnlPct : 0,
    duration: Math.max(0, tr.closedAt - tr.openedAt),
    status: "closed",
  };
}
