/**
 * apps/web/src/components/TradeHistoryTable.tsx
 *
 * ============================================================================
 * PHASE 82 (item 4 — user mandate 2026-07-27 12:17)
 * ============================================================================
 *
 * `TradeHistoryTable` — a dashboard table that shows the bot's past
 * trades (and current open positions) in a single sortable view.
 *
 * A user kérésére ("legyen egy tablazat az eddigi tradekrol ha voltak"
 * = "there should be a table of past trades if any") a Phase 82-es
 * dashboard bővítés a `/api/trades` HTTP endpoint-ot használja,
 * ami a state-feed SNAPSHOT `history[]` (zárt trade-ek) +
 * `positions[]` (nyitott pozíciók) mezőit egyesíti egységes
 * `TradeHistoryItem` formátumban.
 *
 * Az endpoint URL-je a `/api/trades`; a válasz formátuma:
 *   {
 *     trades: TradeHistoryItem[],
 *     count: number
 *   }
 *
 * A komponens poll-ozza az endpoint-ot mount + 5s-onként (a WS
 * `state` message-ben is jönnek a pozíciók, de a history-t a
 * `SNAPSHOT` message-ből kapjuk — a 5s-os poll biztosítja, hogy a
 * history frissüljön a dashboard bezárása nélkül is).
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
 */

import React, { useEffect, useMemo, useState } from "react";

/**
 * A backend `TradeHistoryItem` shape-jének mirror-ja. A `parseTrades`
 * helper runtime validációt végez (a shape-re a TS-típus mellett is),
 * hogy a tesztek / mock adatok ellen is védjen.
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

/** A `/api/trades` válasz formátuma. */
interface TradesResponse {
  readonly trades: readonly TradeHistoryItem[];
  readonly count: number;
}

/**
 * A `TRADES_URL` — a bot HTTP szervere által kiszolgált endpoint. A
 * többi dashboard endpoint-pal (lásd `App.tsx`) konzisztens: 127.0.0.1:7913
 * (loopback), nincs Vite proxy.
 */
const TRADES_URL = "http://127.0.0.1:7913/api/trades" as const;

/**
 * `POLL_INTERVAL_MS` — a history frissítési gyakorisága. A WS `state`
 * message a pozíciókat real-time szállítja, de a history-t a
 * `SNAPSHOT` (5s-onkénti publisher frissítés) tartja karban — a
 * 5s-os poll összhangban van a publisher ütemezésével.
 */
const POLL_INTERVAL_MS = 5_000;

/**
 * `TradeHistoryTable` — a fő komponens. State: `trades`, `error`,
 * `loading`. Az üres állapotot akkor mutatja, ha a `trades` lista
 * üres (és nincs hiba).
 */
export function TradeHistoryTable(): React.JSX.Element {
  const [trades, setTrades] = useState<readonly TradeHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * A backend (`/api/trades` handler) a trade-eket exitTime desc
   * rendezve adja vissza. Defensive sort itt is — ha a backend
   * sorrendje bármiért változna (legacy adat, mock), a UI akkor is
   * a legfrissebb trade-et mutatja elöl. A `useMemo` a `trades`
   * referencia-változásaira fut (a fetch + setState triggereli).
   */
  const sortedTrades = useMemo<readonly TradeHistoryItem[]>(() => {
    if (trades.length === 0) return trades;
    return [...trades].sort((a, b) => {
      const aTs = a.exitTime ?? a.entryTime;
      const bTs = b.exitTime ?? b.entryTime;
      return bTs - aTs;
    });
  }, [trades]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const fetchOnce = async (): Promise<void> => {
      try {
        const res = await fetch(TRADES_URL, { signal: controller.signal });
        if (!res.ok) {
          // A 503 (snapshot not yet received) NEM hiba — a dashboard
          // "Bot: stopped" fallback állapotában elfogadjuk az üres
          // listát. Csak a nem-503 hibákat surface-eljük.
          if (res.status === 503) {
            if (!cancelled) {
              setTrades([]);
              setError(null);
            }
            return;
          }
          if (!cancelled) {
            setError(`HTTP ${res.status}`);
          }
          return;
        }
        const body: unknown = await res.json();
        if (cancelled) return;
        const parsed = parseTrades(body);
        if (parsed === null) {
          setError("Invalid response shape");
        } else {
          setTrades(parsed.trades);
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        // Az AbortError a normál unmount — nem surface-eljük.
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "unknown error");
      }
    };
    void fetchOnce();
    const timer = setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);
    return (): void => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  // ----- Render -----
  if (error !== null) {
    return (
      <div className="ep-trades ep-trades--error" data-testid="trades-error">
        <p>Failed to load trades: {error}</p>
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
// Helpers (extracted for testability)
// ============================================================================

/**
 * `parseTrades` — a `/api/trades` válasz runtime shape-checkje. A
 * `TradeHistoryItem` TS-típustól függetlenül ellenőrzi, hogy a JSON
 * válasz a várt struktúrájú-e (külső / mock adatok elleni védelem).
 *
 * @returns A parse-elt válasz (`TradesResponse`), vagy `null` ha a
 *          shape érvénytelen.
 */
export function parseTrades(body: unknown): TradesResponse | null {
  if (body === null) return null;
  if (typeof body !== "object") return null;
  if (Array.isArray(body)) return null;
  const obj = body as { trades?: unknown; count?: unknown };
  if (!Array.isArray(obj.trades)) return null;
  const items: TradeHistoryItem[] = [];
  for (const raw of obj.trades as readonly unknown[]) {
    const item = parseTradeItem(raw);
    if (item !== null) items.push(item);
  }
  const count = typeof obj.count === "number" ? obj.count : items.length;
  return { trades: items, count };
}

function parseTradeItem(raw: unknown): TradeHistoryItem | null {
  if (raw === null) return null;
  if (typeof raw !== "object") return null;
  if (Array.isArray(raw)) return null;
  const r = raw as {
    id?: unknown;
    strategy?: unknown;
    symbol?: unknown;
    side?: unknown;
    entryPrice?: unknown;
    entryTime?: unknown;
    exitPrice?: unknown;
    exitTime?: unknown;
    quantity?: unknown;
    leverage?: unknown;
    pnl?: unknown;
    pnlPct?: unknown;
    duration?: unknown;
    status?: unknown;
  };
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.strategy !== "string") return null;
  if (typeof r.symbol !== "string" || r.symbol.length === 0) return null;
  if (r.side !== "buy" && r.side !== "sell") return null;
  if (typeof r.entryPrice !== "number" || !Number.isFinite(r.entryPrice)) return null;
  if (typeof r.entryTime !== "number" || !Number.isFinite(r.entryTime)) return null;
  if (r.exitPrice !== null && typeof r.exitPrice !== "number") return null;
  if (r.exitTime !== null && typeof r.exitTime !== "number") return null;
  if (typeof r.quantity !== "number" || !Number.isFinite(r.quantity)) return null;
  if (typeof r.leverage !== "number" || !Number.isFinite(r.leverage)) return null;
  if (typeof r.pnl !== "number" || !Number.isFinite(r.pnl)) return null;
  if (typeof r.pnlPct !== "number" || !Number.isFinite(r.pnlPct)) return null;
  if (typeof r.duration !== "number" || !Number.isFinite(r.duration)) return null;
  if (r.status !== "open" && r.status !== "closed") return null;
  return {
    id: r.id,
    strategy: r.strategy,
    symbol: r.symbol,
    side: r.side,
    entryPrice: r.entryPrice,
    entryTime: r.entryTime,
    exitPrice: r.exitPrice,
    exitTime: r.exitTime,
    quantity: r.quantity,
    leverage: r.leverage,
    pnl: r.pnl,
    pnlPct: r.pnlPct,
    duration: r.duration,
    status: r.status,
  };
}

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
