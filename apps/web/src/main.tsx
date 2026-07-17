import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { applyInitialTheme, mountThemeToggle } from "./theme.js";
import "./styles/app.css";

// Apply the initial theme from localStorage (or the html attribute default).
applyInitialTheme();

// Phase 48D: e2e tests (apps/web/e2e/dashboard.spec.ts) flip
// `window.MSW_STARTED = true` via `page.addInitScript` BEFORE the
// page loads, then dynamically import the MSW worker so the SW
// patches `fetch` and `WebSocket` before the React app boots. In
// production this branch is a no-op (window.MSW_STARTED is unset).
if ((window as unknown as { MSW_STARTED?: boolean }).MSW_STARTED === true) {
  void import("../e2e/mocks/browser.js").then((m) => m.worker.start());
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

// Mount the theme toggle (the eggproject-design `.ep-theme-toggle` control).
// It listens for click events and toggles `data-theme` on <html>.
mountThemeToggle();
