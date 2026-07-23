# Theming & cross-skill consumption

How another skill (or any external surface) consumes the EggProject tokens, and
how the light/dark runtime works. For the token catalog see
`token-reference.md`; for principles see `SKILL.md`.

## Contents
- [Import, never copy](#import-never-copy)
- [The cross-skill path math](#the-cross-skill-path-math)
- [How fonts ride along](#how-fonts-ride-along)
- [The theme runtime (`_theme.js`)](#the-theme-runtime-_themejs)
- [Framework surfaces (React, etc.)](#framework-surfaces-react-etc)
- [Shared-token vs component-local](#shared-token-vs-component-local)

## Import, never copy

There is **no formal cross-skill dependency / `depends_on` mechanism** for skills
— consuming the tokens is just a filesystem reference along a relative path. The
iron rule of this family: **import `colors_and_type.css` from this skill's
folder; never copy it into another skill.**

Why one source matters: the light/dark scopes and the WCAG contrast tuning are
co-dependent and were verified together. A copy silently goes stale the moment a
token is retuned here, and then a component that looked fine in light fails in
dark. One file = one place to fix, everywhere correct.

So consuming CSS does:

```css
/* in a consumer component's own CSS */
@import url('<relative-path>/eggproject-design/colors_and_type.css');
```

…or a consuming HTML page links it:

```html
<link rel="stylesheet" href="<relative-path>/eggproject-design/colors_and_type.css">
```

## The cross-skill path math

Skills install as **siblings** under a common `skills/` directory:

```
skills/
├── eggproject-design/                ← this skill (the tokens live here)
│   └── colors_and_type.css
├── eggproject-design-components/
│   ├── styles.css                    (1 level below its skill root)
│   └── components/button/button.css  (3 levels below)
└── eggproject-design-web-app-examples/
    └── demos/signin.html             (2 levels below)
```

To reach the tokens, a consumer climbs to the `skills/` parent and descends into
`eggproject-design/`. **Hop count up = (depth of the consuming file below its own
skill root) + 1**, then `eggproject-design/colors_and_type.css`.

| Consumer file | Depth | Relative path to tokens |
|---|---|---|
| `eggproject-design-components/styles.css` | 1 | `../eggproject-design/colors_and_type.css` |
| `…-components/components/<name>/<name>.css` | 3 | `../../../eggproject-design/colors_and_type.css` |
| `…-web-app-examples/demos/<page>.html` | 2 | `../../eggproject-design/colors_and_type.css` |
| `…/<kit>/index.html` | 2 | `../../eggproject-design/colors_and_type.css` |

**Verified in this environment** (smoke test): a consumer at
`skills/_smoketest/demo.html` (depth 1) linking
`../eggproject-design/colors_and_type.css` resolved over HTTP and the gold
`--ep-accent` computed to `rgb(227,181,99)` = `#E3B563`, with no failed requests.
Relative sibling-dir resolution works.

**Testing tip:** run the HTTP server with **docroot = the `skills/` parent**, so
every `eggproject-<skill>/…` path is deterministic from one root:

```bash
cd <skills-parent> && python3 -m http.server 8000
# then open http://localhost:8000/skills/<consumer-skill>/<page>.html
```

**In SKILL.md prose** (Level-3 "read this file" instructions for the model), a
repo-root-anchored absolute path is more robust against cwd than a relative one:
`"$(git rev-parse --show-toplevel)/.claude/skills/eggproject-design/colors_and_type.css"`.
Use the relative sibling paths above only in actual `<link>` / `@import`.

## How fonts ride along

`colors_and_type.css` self-imports the fonts with a path relative to **itself**:

```css
@import url('assets/fonts/fonts.css');
```

CSS `@import` resolves relative to the stylesheet that contains it, **not** the
document. So no matter how deep the consumer is, once it has loaded
`colors_and_type.css` the browser fetches `assets/fonts/fonts.css` (and the
`.woff2`) from **this** skill's folder automatically. Consumers never link the
fonts themselves, and there is no Google Fonts CDN anywhere.

## The theme runtime (`_theme.js`)

`preview/_theme.js` is a tiny, dependency-free script for **static HTML**
surfaces. Include it once per page (typically last in `<body>`):

```html
<script src="<relative-path>/eggproject-design/preview/_theme.js"></script>
```

What it does:
- Applies the persisted theme to `<html data-theme>` on load (from
  `localStorage['eggTheme']`, default light).
- Wires every `[data-ep-theme-toggle]` button via **event delegation**, so even
  React/Babel-mounted toggles work without re-binding.
- Keeps each toggle's `aria-label`/`title` honest about the next action; the icon
  swap itself is pure CSS driven by `[data-theme]`.
- Live-syncs across open tabs/cards via the `storage` event.
- Exposes `window.epTheme` = `{ get, set, toggle }`.
- Injects a small floating L/D pill **only** if the page ships no in-menu toggle
  (e.g. a single-component preview card) — otherwise it stays out of the way.

The canonical toggle markup (`.ep-theme-toggle`, defined in the token CSS):

```html
<button class="ep-theme-toggle" type="button" data-ep-theme-toggle aria-label="Switch theme">
  <svg class="ep-theme-toggle__moon" …moon path…></svg>
  <svg class="ep-theme-toggle__sun"  …sun path…></svg>
</button>
```

Place it inside the surface's primary menu (sidebar foot or top-bar actions),
not floating.

## Framework surfaces (React, etc.)

Don't re-implement persistence. Flip `document.documentElement`'s `data-theme`
and read/write the **same** `localStorage['eggTheme']` key from your own state
(a `useTheme` hook). Sharing the key means a theme chosen on one surface carries
across the whole system, and `_theme.js`-driven pages stay in sync via the
`storage` event.

## Shared-token vs component-local

When building a component in another skill and you need a value:

- **Global design decision** (brand color, type step, spacing/radius rung,
  shadow, motion duration) → it belongs **here** in `colors_and_type.css` as a
  new `--ep-` token. Propose it here so every surface shares it; do not bake it
  into one component.
- **Component-specific styling** (an internal grid, a specific max-height) → keep
  it **local** to that component's CSS, but express it with the shared tokens
  (`var(--ep-space-4)`, `var(--ep-fg)`), not raw literals.

The test: if a second component would plausibly want the same value, it's a token
and lives here. Never redefine an `--ep-` token outside this file — that's the
one thing that breaks the single-source guarantee.
