import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { applyInitialTheme, mountThemeToggle } from "./theme.js";
import "./styles/app.css";

// Apply the initial theme from localStorage (or the html attribute default).
applyInitialTheme();

// Phase 48D + Phase 52F (REVISED 2026-07-17 23:00 Budapest): e2e tests
// (apps/web/e2e/dashboard.spec.ts) flip `window.MSW_STARTED = true` via
// `page.addInitScript` BEFORE the page loads. The original
// implementation used `void import(...).then(worker.start())` — a
// fire-and-forget pattern that caused a RACE CONDITION: the React app
// mounted immediately and the `useWebSocket()` hook called `new WebSocket()`
// BEFORE the MSW worker had patched the global `WebSocket` constructor.
// The WebSocket bypassed the mock and connected to the real port 7913
// (no server in test env), so the status pill showed "disconnected"
// and the first 3-4 e2e tests (05, 15, 16) failed with
// `unexpected value "disconnected"`.
//
// The fix: wrap the React mount in an async IIFE that AWAITS the MSW
// worker.start() promise before rendering. In production this branch is
// a no-op (`window.MSW_STARTED` is undefined, so we just `resolve()`).
async function bootstrap(): Promise<void> {
  if ((window as unknown as { MSW_STARTED?: boolean }).MSW_STARTED === true) {
    const { worker } = await import("../e2e/mocks/browser.js");
    await worker.start({
      // Suppress MSW's "[MSW] Mocking enabled" console message —
      // it's noise for the e2e suite. Errors are still surfaced.
      quiet: true,
    });
  }
  // Mount the React app.
  const rootEl = document.getElementById("root");
  if (rootEl === null) {
    throw new Error("Phase 47B: #root element missing from index.html");
  }
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  // Mount the theme toggle (the eggproject-design `.ep-theme-toggle`
  // control). It listens for click events and toggles `data-theme` on
  // <html>.
  mountThemeToggle();
}

void bootstrap();
