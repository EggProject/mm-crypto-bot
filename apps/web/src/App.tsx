import React from "react";

/**
 * `App` — the Top-nav app shell for the mm-crypto-bot web dashboard.
 *
 * Phase 47B: skeleton. The Top-nav bar shows the brand mark on the left,
 * the page heading in the center, and the theme toggle on the right. The
 * page body is a single placeholder "WebSocket: connecting…" card.
 *
 * Phase 47C: the WS connection status is fed by `apps/web/src/ws-client.ts`.
 * Phase 48: the multi-TF chart grid replaces the placeholder.
 */
export function App(): React.JSX.Element {
  return (
    <div className="ep-app">
      <header className="ep-app__topbar">
        <div className="ep-app__brand">
          <span className="ep-app__brand-mark">mm-crypto-bot</span>
          <span className="ep-app__brand-suffix"> · web</span>
        </div>
        <div className="ep-app__status">
          <span className="ep-app__status-dot" data-status="disconnected" />
          <span className="ep-app__status-text">WebSocket: disconnected</span>
        </div>
      </header>
      <main className="ep-app__main">
        <div className="ep-app__placeholder">
          <p>WebSocket: connecting…</p>
        </div>
      </main>
    </div>
  );
}
