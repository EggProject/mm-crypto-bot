import React from "react";
import { useWebSocket, type WebSocketStatus } from "./ws-client.js";
import { ControlBar } from "./components/ControlBar.js";
import { PositionsTable } from "./components/PositionsTable.js";

/**
 * `App` — the Top-nav app shell for the mm-crypto-bot web dashboard.
 *
 * Phase 47B: skeleton. The Top-nav bar shows the brand mark on the left
 * and the connection status pill on the right.
 *
 * Phase 47C: the `useWebSocket()` hook drives the connection status pill
 * in the topbar and the snapshot / state summary in the main panel.
 *
 * Phase 47D: integrates the ControlBar (sticky bottom) and the
 * PositionsTable (in the main panel, replacing the placeholder).
 * Phase 48 will add the multi-TF chart grid alongside the positions
 * table; Phase 50 will add @testing-library/react for behavioral
 * tests of the new components.
 */
export function App(): React.JSX.Element {
  const { status, snapshot, lastError } = useWebSocket();

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
        <div className="ep-app__positions">
          <h2>Open positions</h2>
          <PositionsTable />
        </div>
        {status === "crashed" && (
          <div className="ep-app__error">
            <p>Engine crashed: {lastError?.message ?? "unknown error"}</p>
          </div>
        )}
      </main>
      <ControlBar />
    </div>
  );
}
