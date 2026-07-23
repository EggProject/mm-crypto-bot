---
name: eggproject-design
description: The EggProject design-system foundation — design PRINCIPLES plus the single source-of-truth theme token CSS (colors_and_type.css) and self-hosted fonts. Use this whenever you are styling ANY EggProject surface, building or theming an EggProject component, page, dashboard, demo, or UI kit, or whenever a task touches EggProject colors, typography, dark mode, spacing, radii, shadows, or brand voice. Read this BEFORE writing CSS for EggProject so you import the shared tokens instead of inventing colors. Every other eggproject-design-* skill (components, web-app/admin-app examples, app shells, trade components) depends on this one. Trigger even when the user does not say "design system" — phrases like "make it match the EggProject look", "use our gold buttons", "EggProject dark theme", or "style this like our brand" all point here.
---

# EggProject — Design (foundation)

The dependency root of the EggProject design family. It owns the **one** token
file (`colors_and_type.css`), the **self-hosted fonts**, the brand assets, and
the light/dark **theme runtime**. It defines design *principles* — it ships **no
concrete components**. Every other `eggproject-design-*` skill imports the tokens
from here; nothing copies them.

> EggProject is an independent software-development studio (Budapest, HU). The
> brand reads **calm · senior · precise · quietly elegant**. Gold marks where you
> act, sapphire is the brand's voice, set on warm paper (light) or warm graphite
> (dark). Plainspoken copy, no hype, no emoji. The system is bilingual
> (English + Hungarian) — the type stack carries the Hungarian accents.

## What's in this skill

| File | Purpose |
|---|---|
| `colors_and_type.css` | **THE cross-skill entry point.** A thin `@import` barrel — it defines **no tokens inline**. It chains the modules under `tokens/` in cascade order and imports the local fonts. Every other skill links *this* file; the modular split is an internal detail. |
| `tokens/` | The actual token definitions, split into focused modules (see the cascade list below). The same role names are redefined across the three theme scopes (`:root` light, `[data-theme="dark"]`, `[data-theme="auto"]`); 151 unique `--ep-` token names in all, plus the reusable `.ep-*` type classes and the `.ep-theme-toggle` control. |
| `assets/fonts/` | Self-hosted **Roboto + JetBrains Mono** `.woff2` (latin + latin-ext) + `fonts.css`. No Google Fonts CDN. |
| `assets/*.svg` | Brand marks: `logo-mark`, `logo-mark-inverse`, `logo-wordmark`, `pattern-grid`. |
| `preview/` | The **17 design showcase cards** — brand (3), type (4), color (5), spacing (5) — plus `index.html` (the gallery), two theme demos (`theme-tweaks.html`, `demo-new-theme-v2.html`), and the shared `_base.css` / `_theme.js`. |
| `theme-tokens.html` | Self-contained demo of the palette + typography in light & dark (lives at the skill root, not in `preview/`). |
| `references/` | Level-3 detail (read on demand) — see the pointers below. |

**When you need more than the principles here, read:**
- `references/token-reference.md` — the full token catalog (every family, every name, the 3-scope model) and which token to reach for. (It documents the tokens by family; the family↔module mapping is the cascade list below.)
- `references/theming-and-consumption.md` — exactly how another skill imports these tokens (the cross-skill path math), the `_theme.js` wiring, and the rule for deciding shared-token vs component-local.

## The token system (read this first)

Everything visual is a CSS custom property prefixed `--ep-`, owned by this skill
alone. `colors_and_type.css` is a thin `@import` barrel that chains the modules
under `tokens/`; the tokens live in those modules, but the **public entry point
is always `colors_and_type.css`** — that single path is what every other skill
links, and the modular split behind it is an internal detail you can ignore as a
consumer. The reason for one source is correctness: light and dark must stay in
lockstep and contrast-verified, and 90+ surfaces must never drift. Author against
the **semantic** tokens (roles), not raw scale stops, and you get both themes and
AA/AAA contrast for free.

**The cascade order matters.** The barrel imports the modules in this exact
sequence (each later file may reference values from earlier ones):

```
fonts → tokens/colors → typography → spacing → breakpoints → radius →
elevation → motion → theme-light → theme-dark → theme-auto → theme-toggle
```

So the theme-neutral primitives (color scales, type scale, spacing, breakpoints,
radii, shadows, motion) load first; then the three theme scopes remap the
semantic roles; then the `.ep-theme-toggle` control closes it out.

**Three scopes.** The same token names are redefined under three
selectors so a surface opts into a theme by one attribute on `<html>` (or any
ancestor):

```html
<html data-theme="dark">      <!-- whole app, deliberate dark -->
<section data-theme="dark">   <!-- one section only -->
<html data-theme="auto">      <!-- follow prefers-color-scheme -->
```

Default (no attribute) = light via `:root`. Prefer explicit `dark` for product
surfaces; reserve `auto` for read-only chrome (docs, status).

**Two layers of color:**
- **Brand scales** — `--ep-blue-*` (sapphire), `--ep-yolk-*` (gold), `--ep-paper-*`, `--ep-slate-*`, `--ep-ink-*`. Fixed hex; identical in both themes.
- **Semantic roles** — `--ep-bg`, `--ep-bg-elevated`, `--ep-bg-sunken`, `--ep-fg`, `--ep-fg-muted`, `--ep-border`, `--ep-accent`, `--ep-second`, `--ep-success/warning/danger/info`, … These point at *different* scale stops per theme. **Build components on these.** Reaching for a raw scale stop in component CSS is the usual cause of a surface that looks wrong in dark mode.

## Color usage — the two-color rule

The brand runs on a deliberate split, in **both** themes:

- **Gold is the primary action** (`--ep-accent` = `--ep-yolk-500` `#E3B563`).
  Every primary button, focus ring, selected state, progress fill and active
  toggle is gold. „Az arany a fényé” — gold marks where you can act. A **solid
  gold fill always carries dark ink text** (`--ep-accent-on` `#16130C`),
  **never white** — gold is light-valued, so white-on-gold fails contrast.
  Soft gold uses are `--ep-accent-bg` (tint) + `--ep-accent-fg` (gold text).
- **Sapphire is the second voice** (`--ep-second` = `--ep-blue-600` light /
  `--ep-blue-500` dark) and the headline flourish (`--ep-flourish`):
  explanatory highlights, info chrome, brand links. „A kék a márkáé.” It is
  **not** the primary button.
- **Surface temperature is a brand cue.** Public/editorial surfaces sit on warm
  **paper** (`--ep-paper-50`), product/app surfaces on cool **slate**
  (`--ep-slate-50`). Warm-vs-cool tells the user "brochure vs. tool". In dark,
  the same cue survives as a tint-density gradient, not a hue swap.
- **Semantic colors** (`--ep-success` green, `--ep-warning`, `--ep-danger`,
  `--ep-info`) come with paired `*-bg` tints. In dark, `--ep-warning` unifies
  with the gold.

Status is communicated with the canonical **colored-dot pattern** (a pill with a
leading dot), never with emoji.

## Dark theme — „Éjszakai műszak"

Dark is **warm graphite, not cold black**. Surfaces are a graphite base
(`#080A10` · `#0C0D11` · `#131720` · `#181D29`) with a trace of **gold** mixed in
as elevation rises (Material Design 3 tonal-elevation overlay via `--ep-tint`).
Text is cream (`#ECE7DA`). The gold primary glows against graphite; sapphire
brightens one step to stay legible.

- **Never hand-pick a dark hex.** Pick the semantic surface token
  (`--ep-bg`, `--ep-bg-sunken`, `--ep-bg-elevated`, `--ep-bg-raised`) and you
  inherit the gold tint and the verified contrast automatically.
- **Lean on borders + tint contrast** to separate surfaces; deep shadows barely
  register on graphite, so reserve `--ep-shadow-lg/xl` for floating chrome.
- Use `assets/logo-mark-inverse.svg` on dark surfaces.

All foreground/background pairs are **WCAG 2.1 AA at minimum, most AAA** — the
ratios are commented next to each token in the CSS. Don't introduce ad-hoc dark
text/surface colors; they will likely fall below threshold.

## Typography

**One sans family — Roboto — carries the whole hierarchy**, large with tight
tracking for headlines (weights to 900), 300–500 for body and UI. Hierarchy
comes from **size, weight and tracking**, not a serif/sans contrast.
**JetBrains Mono** is for code, tokens, timestamps and numeric/mono meta only —
never body copy.

- Use the **semantic type tokens** / classes, never ad-hoc `font-size`:
  `--ep-text-display-lg|display|h1|h2|h3|h4|lead|body|small|meta|overline|code`,
  surfaced as `.ep-display-lg`, `.ep-h1` … `.ep-overline`, `.ep-code`.
- **The flourish.** Wrap the second word/phrase of a display headline in
  `<em>` — `<h1>Crafted code, <em>shipped on time.</em></h1>` — and the canonical
  `em` rule recolors it **bold sapphire** (`--ep-flourish`) automatically. `<em>`
  here is a brand hook, not semantic emphasis. Decorative *italics* (ornaments,
  pull-quotes, the 404 digit) keep `font-style: italic` and are separate.
- Casing: **sentence case** for headings, buttons, labels. TitleCase only for
  proper nouns. ALL CAPS only for `.ep-overline` (wide tracking).
- **Fonts are self-hosted** (`assets/fonts/`, latin + latin-ext for Hungarian).
  Do **not** add a Google Fonts `<link>` or `@import` anywhere.

## Spacing, radius, elevation, motion

All are tokens — never hard-code a pixel value where a token exists.

- **Spacing** — 4px base scale `--ep-space-0..32`. Layout maxima
  `--ep-layout-max-app|marketing` (1240px), `--ep-layout-max-prose` (720px),
  `--ep-layout-max-narrow` (480px); page gutter `--ep-layout-gutter` (24px).
- **Breakpoints & large displays (2026 layer, `tokens/breakpoints.css`)** —
  viewport breakpoints `--ep-screen-sm..2xl` (640→1536px, mirroring Tailwind v4)
  plus additive large-display tiers `--ep-screen-3xl` (1920px, FHD) and
  `--ep-screen-4xl` (2560px, QHD/ultrawide). For ultrawide/4K the pattern is a
  **max-width cap, not a new breakpoint**: `--ep-layout-max-wide` (1440px,
  data-dense dashboards), `--ep-layout-max-fhd` (1920px hard cap),
  `--ep-layout-measure` (65ch reading measure), and `--ep-layout-max-full`
  (`none` — the full-bleed sentinel for an uncapped, edge-to-edge surface).
  Fluid companions to the fixed scale: `--ep-layout-gutter-fluid` and
  `--ep-layout-section-fluid` (viewport `clamp()`), and `--ep-layout-full-height`
  (`100dvh` — prefer over `100vh` for heroes / modals / app shells so mobile
  browser chrome doesn't cause overflow).
- **Radius** — `--ep-radius-sm` 6 / `md` 12 (cards, buttons) / `lg` 18 / `xl` 26 /
  `2xl` 36 (editorial) / `pill`. Sharp corners stay valid in editorial layouts —
  don't round everything by reflex.
- **Elevation** — five warm shadow steps `--ep-shadow-xs..xl` (never pure black,
  never offset > 32px) + `--ep-shadow-inset`. Focus rings are their own tokens:
  `--ep-shadow-focus` (3px **gold**, the default) and `--ep-shadow-focus-second`
  (sapphire, for second-voice controls).
- **Motion** — restrained. Default `--ep-dur-base` 220ms `--ep-ease-out`; `slow`
  360ms for page-level; `--ep-ease-spring` for tactile micro-interactions (press,
  toggle). Never bounce, shake, spin, parallax or particles. Optional ambient
  "atmosphere" (a faint corner glow, gentle scroll-reveal) is allowed **only** on
  hero/editorial surfaces, gated on `prefers-reduced-motion` — never on
  data-dense product chrome.

## Backgrounds, borders, iconography (brief)

- Backgrounds are **flat colors** (paper, slate, ink). No photographic
  backgrounds, no repeating textures by default (`pattern-grid.svg` is an opt-in
  4% scaffold for technical surfaces only).
- Borders: `1px solid var(--ep-border)` on paper; `--ep-border-subtle` on slate;
  in-panel dividers use `--ep-divider`.
- Icons: Lucide-style **stroke** icons, 1.75 stroke width, 24×24, inline SVG with
  `stroke="currentColor"`. No emoji, no filled variants unless representing
  "active". The logo mark is a brand asset, not an icon.

## The theme toggle

The barrel ships `.ep-theme-toggle` (defined in `tokens/theme-toggle.css`) — a
34px icon button that shows the theme you'll switch **to** (moon in light, sun in
dark), driven purely by the `[data-theme]` attribute, so no per-instance JS paints
the icon. It belongs
**inside a menu** (sidebar foot or top-bar actions), not floating. Wire it with
`preview/_theme.js` on static HTML; framework surfaces flip
`document.documentElement` `data-theme` and persist to the same
`localStorage['eggTheme']` key. Markup:

```html
<button class="ep-theme-toggle" type="button" data-ep-theme-toggle aria-label="Switch theme">
  <svg class="ep-theme-toggle__moon" …moon path…></svg>
  <svg class="ep-theme-toggle__sun"  …sun path…></svg>
</button>
```

## How other skills consume these tokens (import, never copy)

There is **no formal cross-skill dependency API** — consuming the tokens is a
plain filesystem reference. The iron rule: **import `colors_and_type.css` from
this skill's folder; never copy it.** One source keeps light/dark and contrast
correct everywhere.

Skills install as **siblings** under `.../skills/`, so a consumer reaches this
skill with a relative path that climbs to the `skills/` parent and descends into
`eggproject-design/`. The hop count = (depth of the consuming file below its own
skill root) + 1:

| Consumer file (depth below its skill root) | Path to the tokens |
|---|---|
| `eggproject-design-components/styles.css` (1) | `../eggproject-design/colors_and_type.css` |
| `…/components/<name>/<name>.css` (3) | `../../../eggproject-design/colors_and_type.css` |
| `…/demos/<page>.html` (2) | `../../eggproject-design/colors_and_type.css` |

Serve the **`skills/` parent as the HTTP docroot** when testing, so every
`eggproject-<skill>/…` path resolves deterministically. The fonts ride along
automatically: `colors_and_type.css` imports `assets/fonts/fonts.css` relative to
*itself*, so however deep the consumer is, the fonts resolve. Full detail and the
`_theme.js` wiring are in `references/theming-and-consumption.md`.

## Shared-token vs component-local — how to decide

When you need a new value while building a component elsewhere:

- **Is it a global design decision** (a brand color, a type step, a spacing/radius
  rung, a breakpoint, a shadow, a motion duration)? It belongs **here**, in the
  matching `tokens/` module (reached through the `colors_and_type.css` barrel), so
  every surface shares it. Propose it as a new `--ep-` token rather than a one-off.
- **Is it styling specific to one component** (this card's internal grid, that
  menu's max-height)? Keep it **local** to that component's CSS, expressed *in
  terms of* the shared tokens (`var(--ep-space-4)`, `var(--ep-fg)`), not raw
  literals.

The test: if a second component would plausibly want the same value, it's a
token and lives here. If it only makes sense inside one component, it stays
local. Never redefine an `--ep-` token outside this skill.
