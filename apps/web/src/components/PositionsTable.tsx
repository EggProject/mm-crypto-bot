import React from "react";
import { useWebSocket } from "../ws-client.js";

/**
 * `PositionsTable` — the bot's open positions, refreshed on every `state`
 * WS message.
 *
 * Phase 47D: plain <table>. Phase 49 will replace with TanStack for
 * sort + multi-select + live stats toolbar.
 *
 * Each row: symbol, side, entry price, current price, qty, leverage,
 * P&L (USDT + %), opened-at, kill-switch action.
 *
 * The position shape is loosely typed here — Phase 49 will introduce a
 * proper `Position` type from `protocol.ts` (currently the WS client
 * only knows that `lastState.positions` is `readonly object[]`).
 */
export function PositionsTable(): React.JSX.Element {
  const { lastState, send } = useWebSocket();
  const positions = lastState?.positions ?? [];

  if (positions.length === 0) {
    return (
      <div className="ep-positions ep-positions--empty">
        <p>No open positions.</p>
      </div>
    );
  }

  const onKillPosition = (_positionId: string): void => {
    // The kill-switch for a single position is the same as the global one.
    // Phase 49 will add a per-position control.
    send({ type: "control", command: "kill_switch" });
  };

  return (
    <table className="ep-positions">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Side</th>
          <th>Entry</th>
          <th>Current</th>
          <th>Qty</th>
          <th>Leverage</th>
          <th>P&amp;L (USDT)</th>
          <th>P&amp;L (%)</th>
          <th>Opened</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          // The position shape is loosely typed here — Phase 49 will
          // introduce a proper Position type from protocol.ts.
          const pos = p as unknown as {
            symbol: string;
            side: string;
            entryPrice: number;
            currentPrice: number;
            quantity: number;
            leverage: number;
            unrealizedPnl: number;
            unrealizedPnlPct: number;
            openedAt: number;
            id: string;
          };
          const pnlClass =
            pos.unrealizedPnl >= 0
              ? "ep-positions__pnl--pos"
              : "ep-positions__pnl--neg";
          return (
            <tr key={pos.id}>
              <td>{pos.symbol}</td>
              <td>{pos.side}</td>
              <td>{pos.entryPrice.toFixed(2)}</td>
              <td>{pos.currentPrice.toFixed(2)}</td>
              <td>{pos.quantity.toFixed(4)}</td>
              <td>{pos.leverage}×</td>
              <td className={pnlClass}>{pos.unrealizedPnl.toFixed(2)}</td>
              <td className={pnlClass}>{pos.unrealizedPnlPct.toFixed(2)}%</td>
              <td>{new Date(pos.openedAt).toLocaleTimeString()}</td>
              <td>
                <button
                  className="ep-positions__btn ep-positions__btn--danger"
                  onClick={() => {
                    onKillPosition(pos.id);
                  }}
                  type="button"
                >
                  Kill
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
