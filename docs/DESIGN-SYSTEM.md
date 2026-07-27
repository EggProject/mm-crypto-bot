# Design system (apps/web)

The dashboard uses the **EggProject design system** — a dark-mode-first token set (colors, typography, spacing) with components (buttons, cards, badges, indicators) and a `lc-wrap` chart chrome (price scale, time scale, range tabs, symbol/strategy badges).

The CSS is **vendored locally** under `apps/web/src/styles/` (per the "skills are documentation, not code dependencies" project rule — the build is self-contained, no symlink required). The `chart-card.css` file is a hand-curated subset of the design tokens + the `lc-wrap` rules needed for the chart cards. Reference doksi for the design system: [`.mavis/notes/design-system.md`](../.mavis/notes/design-system.md).

A `data-theme="dark"` (or `"light"`) attribute on `<html>` switches the entire token set at once; the theme is persisted to `localStorage` and read on page load.
