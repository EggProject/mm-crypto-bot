/**
 * apps/web/src/components/TradeHistoryTable.tsx
 *
 * ============================================================================
 * PHASE 82 (item 4 — user mandate 2026-07-27 12:17) + PHASE 83.5 (Bug 2)
 * ============================================================================
 *
 * `TradeHistoryTable` — a dashboard table that shows the bot's past
 * trades (and current open positions) in a single sortable view.
 *
 * **Phase 82** built this as a self-polling component that fetched
 * `GET /api/trades` every 5 seconds. The user mandate for Phase 83.5
 * (Bug 2) is to use the WebSocket for ALL real-time data — NO polling.
 * The WS `state` event already carries the bot's `positions` (open) +
 * `history` (closed) on every state notification; the `/api/trades`
 * endpoint just aggregates those same two arrays.
 *
 * **Phase 83.5 changes:**
 *   - The component is now CONTROLLED (prop-driven) — `App.tsx` passes
 *     `lastState` (the WS `state` event) + `status` (the WS
 *     connection status) as props. The component no longer subscribes
 *     to the WS directly (the 3-WS architecture rule — only App,
 *     ControlBar, and PositionsTable are allowed to call
 *     `useWebSocket()`; see `e2e/55-2-3ws-architecture.spec.ts`).
 *   - The 5s `setInterval` + `fetchOnce` are DELETED. The pure
 *     `tradesFromState(lastState)` helper in
 *     `apps/web/src/lib/trades-from-state.ts` derives the rows.
 *   - On `status !== "connected"`, the table shows a "Waiting for
 *     WebSocket…" placeholder (NO fallback poll, matching the
 *     `useBotStatus` hook's WS-first + 30s-slow-poll-only-on-disconnect
 *     pattern from `lib/use-bot-status.ts`).
 *
 * **HTTP endpoint retained** — the `GET /api/trades` HTTP endpoint
 * (apps/bot/src/web-client/http-server.ts:364-398) STAYS for the
 * `mm-bot trades` CLI command and external scripts. The endpoint is
 * also exercised by `http-server.test.ts:692-1060` (15+ tests). The
 * dashboard simply doesn't poll it from the browser anymore.
 *
 * ============================================================================
 * OSZLOPOK (a user kérésnek megfelelően)
 * ============================================================================
 *
 *   - strategy
 *   - symbol
 *   - side
 *   - entry price
 *   - entry time
 *   - exit price
 *   - exit time
 *   - PnL (USD)
 *   - PnL (%)
 *   - duration
 *   - status
 *
 * Az open pozíciók `exit price` / `exit time` cellái `—` (a user
 * számára egyértelmű, hogy a pozíció még nyitva van — a `status: open`
 * oszlop is jelzi).
 *
 * ============================================================================
 * ÜRES ÁLLAPOT
 * ============================================================================
 *
 * Ha a `trades` lista üres (a bot még nem zárt le egyetlen trade-et
 * sem, ÉS nincs nyitott pozíció), a tábla helyett egy
 * "No closed trades yet" üzenet jelenik meg — a user kérés
 * "ha voltak" (if any) feltétele szerint.
 *
 * Ha a WS nincs csatlakoztatva (`status !== "connected"`), a
 * tábla egy "Waiting for WebSocket…" placeholdert mutat — sem
 * a 5s-os poll, sem a fallback HTTP fetch nem indul el.
 */

import React, { useMemo } from "react";
import type { WebSocketStatus } from "../ws-client.js";
import { tradesFromState } from "../lib/trades-from-state.js";

/**
 * A backend `TradeHistoryItem` shape-jének mirror-ja. A
 * `tradesFromState` helper runtime validációt végez (a shape-re
 * a TS-típus mellett is), hogy a tesztek / mock adatok ellen is
 * védjen.
 */
export interface TradeHistoryItem {
  readonly id: string;
  readonly strategy: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly entryPrice: number;
  readonly entryTime: number;
  readonly exitPrice: number | null;
  readonly exitTime: number | null;
  readonly quantity: number;
  readonly leverage: number;
  readonly pnl: number;
  readonly pnlPct: number;
  readonly duration: number;
  readonly status: "open" | "closed";
}

/**
 * `TradeHistoryTableProps` — Phase 83.5 (Bug 2): the component is
 * now prop-driven (no internal `useWebSocket` / `setInterval` / fetch).
 * The parent (`App.tsx`) owns the WS connection and passes the
 * relevant slices down.
 *
 * - `lastState` — the `Extract<ServerMessage, {type:"state"}>` from
 *   the WS client, or `null` if no state event has arrived yet. The
 *   component derives the trade rows from this via the pure
 *   `tradesFromState(lastState)` helper.
 * - `status`    — the current WS connection status. The component
 *   shows a "Waiting for WebSocket…" placeholder when the WS is
 *   not `connected` (no fallback poll, matching the user's
 *   "WS for all real-time data" mandate).
 */
export interface TradeHistoryTableProps {
  readonly lastState: unknown;
  readonly status: WebSocketStatus;
}

/**
 * `TradeHistoryTable` — Phase 83.5 (Bug 2): controlled, prop-driven
 * component. Receives `lastState` + `status` from `App.tsx` and
 * derives the `TradeHistoryItem[]` rows via the pure `tradesFromState`
 * helper. The previous self-polling / self-fetching behavior is
 * DELETED.
 */
export function TradeHistoryTable(props: TradeHistoryTableProps): React.JSX.Element {
  const { lastState, status } = props;

  // Phase 83.5 (Bug 2): derive the trade rows from the WS `state`
  // event via the pure helper. NO polling, NO setInterval, NO fetch.
  // The `useMemo` ensures stable identity across re-renders that
  // don't change `lastState` (the chart grid + positions table use
  // the same `lastState` ref so the trade rows re-render in sync
  // with the rest of the dashboard).
  const sortedTrades = useMemo<readonly TradeHistoryItem[]>(
    () => tradesFromState(lastState),
    [lastState],
  );

  // ----- Render -----
  // Phase 83.5 (Bug 2): the WS-first pattern from `useBotStatus` —
  // when the WS is not connected, show a "Waiting for WebSocket…"
  // placeholder. NO fallback HTTP poll. The user's mandate is
  // unambiguous: "use WS for ALL real-time data, no polling".
  if (status !== "connected") {
    return (
      <div
        className="ep-trades ep-trades--waiting"
        data-testid="trades-waiting"
      >
        <p>Waiting for WebSocket…</p>
      </div>
    );
  }

  if (sortedTrades.length === 0) {
    // A user kérés "ha voltak" (if any) feltételéhez igazodva: ha nincs
    // trade, ne mutassunk üres táblát — egy explicit "No closed trades
    // yet" üzenet jobb UX.
    return (
      <div
        className="ep-trades ep-trades--empty"
        data-testid="trades-empty"
      >
        <p>No closed trades yet.</p>
      </div>
    );
  }

  return (
    <table className="ep-trades" data-testid="trades-table">
      <thead>
        <tr>
          <th>Strategy</th>
          <th>Symbol</th>
          <th>Side</th>
          <th>Entry</th>
          <th>Entry time</th>
          <th>Exit</th>
          <th>Exit time</th>
          <th>P&amp;L (USD)</th>
          <th>P&amp;L (%)</th>
          <th>Duration</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {sortedTrades.map((t) => {
          const pnlClass =
            t.pnl >= 0 ? "ep-trades__pnl--pos" : "ep-trades__pnl--neg";
          return (
            <tr key={t.id} data-testid="trades-row" data-status={t.status}>
              <td>{t.strategy}</td>
              <td>{t.symbol}</td>
              <td>{t.side}</td>
              <td>{t.entryPrice.toFixed(2)}</td>
              <td>{formatTimestamp(t.entryTime)}</td>
              <td>{t.exitPrice === null ? "—" : t.exitPrice.toFixed(2)}</td>
              <td>{formatTimestamp(t.exitTime)}</td>
              <td className={pnlClass}>{t.pnl.toFixed(2)}</td>
              <td className={pnlClass}>{t.pnlPct.toFixed(2)}%</td>
              <td>{formatDuration(t.duration)}</td>
              <td>{t.status}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ============================================================================
// Helpers (kept local — these are formatting utilities, not data
// mappers; the data mapping now lives in `lib/trades-from-state.ts`)
// ============================================================================

/**
 * `formatTimestamp` — egy ms-timestamp emberi olvasható formátumra
 * alakítása (HH:MM:SS, ha ma; rövid dátum + idő, ha régebbi).
 */
function formatTimestamp(ts: number | null): string {
  if (ts === null) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString();
}

/**
 * `formatDuration` — a duration ms-ből "Xh Ym" / "Ym Zs" formátumra.
 * A user számára a `PnL` USD-vel és %-ban van kiírva, a duration
 * a trade / pozíció hossza — a legfontosabb a "hány perc / óra".
 */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) {
    const sec = totalSec % 60;
    return sec > 0 ? `${totalMin}m ${sec}s` : `${totalMin}m`;
  }
  const totalHour = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min > 0 ? `${totalHour}h ${min}m` : `${totalHour}h`;
}
