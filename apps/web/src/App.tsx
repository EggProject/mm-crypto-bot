import React from "react";
import { useWebSocket, type WebSocketStatus } from "./ws-client.js";

/**
 * `App` — the Top-nav app shell for the mm-crypto-bot web dashboard.
 *
 * Phase 47B: skeleton. The Top-nav bar shows the brand mark on the left,
 * the page heading in the center, and the theme toggle on the right.
 *
 * Phase 47C: the `useWebSocket()` hook drives the connection status pill
 * in the topbar and the snapshot / state summary in the main panel.
 *
 * Phase 48: the multi-TF chart grid replaces the summary panel.
 */
export function App(): React.JSX.Element {
  const { status, snapshot, lastState, lastError } = useWebSocket();

  // Map WS status → human-readable label.
  const statusLabel: Record<WebSocketStatus, string> = {
    disconnected: "WebSocket: disconnected",
    connecting: "WebSocket: connecting…",
    connected: `WebSocket: connected${
      snapshot !== null
        ? ` (${snapshot.strategies.length} strategies)`
        : ""
    }`,
    crashed: `WebSocket: crashed — ${lastError?.message ?? "unknown"}`,
  };

  return (
    <div className="ep-app">
      <header className="ep-app__topbar">
        <div className="ep-app__brand">
          <span className="ep-app__brand-mark">mm-crypto-bot</span>
          <span className="ep-app__brand-suffix"> · web</span>
        </div>
        <div className="ep-app__status">
          <span className="ep-app__status-dot" data-status={status} />
          {/* eslint-disable-next-line security/detect-object-injection */}
          <span className="ep-app__status-text">{statusLabel[status]}</span>
        </div>
      </header>
      <main className="ep-app__main">
        <div className="ep-app__placeholder">
          {status === "connected" && lastState !== null ? (
            <div>
              <p>
                Connected. {lastState.positions.length} open position(s),{" "}
                {lastState.closedTrades.length} closed trade(s).
              </p>
              <p>
                Kill-switch: {lastState.killSwitch} · paused:{" "}
                {String(lastState.paused)}
              </p>
            </div>
          ) : status === "crashed" ? (
            <p>Engine crashed: {lastError?.message ?? "unknown error"}</p>
          ) : (
            // eslint-disable-next-line security/detect-object-injection
            <p>{statusLabel[status]}</p>
          )}
        </div>
      </main>
    </div>
  );
}
