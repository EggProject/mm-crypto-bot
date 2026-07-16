import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { applyInitialTheme, mountThemeToggle } from "./theme.js";
import "./styles/app.css";

// Apply the initial theme from localStorage (or the html attribute default).
applyInitialTheme();

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
