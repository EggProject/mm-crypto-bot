/* ============================================================
   EggProject — shared light/dark theme switch.

   Two ways to switch, one source of truth (localStorage 'eggTheme'):

   1. In-menu toggle (preferred) — place a button with the
      [data-ep-theme-toggle] attribute inside any menu (sidebar foot
      or top-bar actions). Use the .ep-theme-toggle markup from
      colors_and_type.css. This script wires every such button via
      event delegation (so React/Babel-mounted buttons work too) and
      will NOT inject the floating pill when one is present.

   2. Floating pill (fallback) — when a page has no in-menu toggle
      (e.g. a single-component preview card), this injects a tiny
      L/D pill, top-right, so the card is still toggleable.

   Either way the theme is applied to <html data-theme>, persisted to
   localStorage['eggTheme'], and synced live across open cards/tabs
   via the 'storage' event. window.epTheme exposes get/set/toggle.
   ============================================================ */
(function () {
  var KEY = 'eggTheme';

  function read() {
    try { return localStorage.getItem(KEY) || 'light'; }
    catch (_) { return 'light'; }
  }
  var current = read();

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  function persist(theme) {
    try { localStorage.setItem(KEY, theme); } catch (_) {}
  }

  function set(theme) {
    if (theme !== 'light' && theme !== 'dark') return;
    if (theme === current) { apply(theme); return; }
    current = theme;
    persist(theme);
    apply(theme);
    paintActive();
  }
  function toggle() { set(current === 'dark' ? 'light' : 'dark'); }

  // Expose a tiny API so framework surfaces (React ui kits, etc.) can
  // drive the exact same state without re-implementing persistence.
  window.epTheme = {
    get: function () { return current; },
    set: set,
    toggle: toggle
  };

  // 1) Apply persisted theme immediately (before paint when possible).
  apply(current);

  // 2) Live-sync — when any OTHER card/tab toggles, react here.
  window.addEventListener('storage', function (event) {
    if (event.key === KEY && event.newValue && event.newValue !== current) {
      current = event.newValue;
      apply(current);
      paintActive();
    }
  });

  // 3) In-menu toggles — event delegation so it covers buttons added
  //    after load (e.g. React-rendered menus).
  document.addEventListener('click', function (event) {
    var toggleButton = event.target.closest && event.target.closest('[data-ep-theme-toggle]');
    if (toggleButton) { event.preventDefault(); toggle(); }
  });

  var host = null;

  function paintActive() {
    // Floating pill segments.
    if (host) {
      host.querySelectorAll('button[data-theme]').forEach(function (button) {
        button.setAttribute('aria-pressed', button.dataset.theme === current ? 'true' : 'false');
      });
    }
    // In-menu toggles — icon swap is pure CSS via [data-theme]; we just
    // keep the accessible label honest about what the next tap does.
    document.querySelectorAll('[data-ep-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-label', current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      button.setAttribute('title', current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    });
  }

  function buildFloatingPill() {
    if (host) return;

    // Local <style> — colour the active pill segment with the design tokens.
    var styleElement = document.createElement('style');
    styleElement.textContent =
      '#__ep-theme-toggle{position:fixed;top:10px;right:10px;z-index:99999;' +
      'display:inline-flex;padding:2px;border-radius:999px;' +
      'background:var(--ep-bg-elevated);border:1px solid var(--ep-border);' +
      'box-shadow:var(--ep-shadow-sm);' +
      'font:500 9px var(--ep-font-mono);letter-spacing:0.14em;text-transform:uppercase;' +
      'user-select:none;opacity:0.85;transition:opacity .15s ease;}' +
      '#__ep-theme-toggle:hover{opacity:1;}' +
      '#__ep-theme-toggle button{appearance:none;border:0;background:transparent;' +
      'color:var(--ep-fg-subtle);cursor:pointer;padding:4px 9px;border-radius:999px;' +
      'font:inherit;letter-spacing:inherit;text-transform:inherit;line-height:1;' +
      'transition:background-color .15s ease,color .15s ease;}' +
      '#__ep-theme-toggle button:hover{color:var(--ep-fg);}' +
      '#__ep-theme-toggle button[aria-pressed="true"]{' +
      'background:var(--ep-accent);color:var(--ep-fg-on-blue);}';
    document.head.appendChild(styleElement);

    host = document.createElement('div');
    host.id = '__ep-theme-toggle';
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Theme');

    ['light', 'dark'].forEach(function (theme) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.theme = theme;
      button.title = theme === 'light' ? 'Light theme' : 'Dark theme';
      button.textContent = theme === 'light' ? 'L' : 'D';
      button.addEventListener('click', function () { set(theme); });
      host.appendChild(button);
    });

    document.body.appendChild(host);
  }

  function start() {
    // Prefer in-menu toggles; only fall back to the floating pill when
    // the page ships no menu-integrated control of its own.
    if (!document.querySelector('[data-ep-theme-toggle]')) {
      buildFloatingPill();
    }
    paintActive();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
