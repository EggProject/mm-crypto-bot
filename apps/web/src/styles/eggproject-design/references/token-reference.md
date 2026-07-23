# Token reference — `colors_and_type.css`

The complete catalog of EggProject design tokens. All are CSS custom properties
prefixed `--ep-`, defined **only** in `colors_and_type.css`. Read this when you
need the exact token name or value; for the principles behind them, see
`SKILL.md`.

## Contents
- [The three-scope model](#the-three-scope-model)
- [Brand color scales (fixed)](#brand-color-scales-fixed)
- [Semantic color roles (theme-mapped)](#semantic-color-roles-theme-mapped)
- [Typography](#typography)
- [Spacing & layout](#spacing--layout)
- [Breakpoints & layout (2026)](#breakpoints--layout-2026)
- [Radius](#radius)
- [Shadow & focus](#shadow--focus)
- [Motion](#motion)
- [Reusable classes](#reusable-classes)

## The three-scope model

The same token names are redefined under three selectors. 137 logical tokens →
~237 definitions across the scopes.

| Scope | Selector | When it applies |
|---|---|---|
| Light (default) | `:root` | No `data-theme`, or `data-theme="light"`. |
| Dark | `[data-theme="dark"]` | Explicit opt-in on `<html>` or any ancestor. |
| Auto | `[data-theme="auto"]` inside `@media (prefers-color-scheme: dark)` | Follows the OS; light otherwise. |

Brand scales are defined once (in `:root`) and are **not** re-declared per theme —
only semantic roles remap. So `--ep-blue-600` is the same hex everywhere; what
changes is that `--ep-second` points at `--ep-blue-600` in light and
`--ep-blue-500` in dark.

## Brand color scales (fixed)

Identical hex in both themes.

**Ink (midnight)** — primary text on cream, dark feature panels.
`--ep-ink-950 #060B1F` · `--ep-ink-900 #0A1230` · `--ep-ink-800 #131C44` · `--ep-ink-700 #1E2A5C`

**Sapphire (signature blue)** — brand hue / second voice.
`--ep-blue-900 #16245E` · `-800 #1F378E` · `-700 #2949B8` · `-600 #2E5BE0` (brand) · `-500 #4F7BEE` · `-400 #7E9EF5` · `-300 #A8BFFA` · `-200 #CDDBFD` · `-100 #E4ECFE` · `-50 #F2F5FF`

**Paper (warm cream)** — public/editorial backgrounds.
`--ep-paper-50 #FBF9F4` · `-100 #F6F3EB` · `-200 #ECE7DA` · `-300 #DCD5C3` · `-400 #B8AE94`

**Slate (cool neutrals)** — app/dashboard surfaces.
`--ep-slate-50 #F5F7FB` · `-100 #E9EDF5` · `-200 #D6DCE8` · `-300 #B3BCCC` · `-400 #8390A8` · `-500 #5C6981` · `-600 #3E4A60` · `-700 #2A3447` · `-800 #19202E`

**Gold (egg-yolk)** — the primary action color.
`--ep-yolk-700 #9A6F26` · `-600 #B98A2E` · `-500 #E3B563` (GOLD, primary) · `-400 #EFCB85` (hover) · `-300 #F4D9A0` · `-100 #FBEFD6`

## Semantic color roles (theme-mapped)

**Build components on these**, not the raw scales.

| Role | Light | Dark |
|---|---|---|
| `--ep-bg` | paper-50 | graphite `#0C0D11` + gold tint |
| `--ep-bg-elevated` | `#FFFFFF` | graphite `#131720` + tint |
| `--ep-bg-raised` | = elevated | graphite `#181D29` + tint |
| `--ep-bg-sunken` | paper-100 | graphite `#080A10` + tint |
| `--ep-bg-inverse` | ink-900 | paper-50 |
| `--ep-fg` | ink-900 | cream `#ECE7DA` (~14:1 AAA) |
| `--ep-fg-muted` | slate-600 | `#C7C0AF` (~9.8:1 AAA) |
| `--ep-fg-subtle` | slate-500 | `#A49D8C` (~6.6:1 AA) |
| `--ep-fg-faint` | slate-400 | `#7C766A` |
| `--ep-fg-on-ink` | paper-100 | cream |
| `--ep-border` | paper-300 (warm) | `#2A2E38` |
| `--ep-border-subtle` | paper-200 | `#20242D` |
| `--ep-border-strong` | ink-900 | white @22% |
| `--ep-control-border` | = border | white @34% (brighter for form controls) |
| `--ep-divider` | ink @8% | white @7% |

**Interaction surfaces** (use instead of raw stops for hover/press):
`--ep-bg-hover`, `--ep-bg-pressed`, `--ep-bg-control`.

**Primary action = gold** (both themes):
`--ep-accent #E3B563` · `--ep-accent-hover #EFCB85` · `--ep-accent-press #D9A845` ·
`--ep-accent-on #16130C` (ink on solid gold — never white) ·
`--ep-accent-bg` (gold tint, soft fills) · `--ep-accent-fg` (gold text on the tint).

**Second voice = sapphire:**
`--ep-second` (blue-600 / blue-500) · `--ep-second-hover` · `--ep-second-press` ·
`--ep-second-bg` · `--ep-second-fg` · `--ep-flourish` (headline em color).

**Semantic status** (each has a paired `*-bg` tint):
`--ep-success`, `--ep-warning` (unifies with gold in dark), `--ep-danger`,
`--ep-info`.

**Back-compat aliases** (kept so older surfaces don't break; new work should use
the names above): `--ep-accent-warm*` fold into the gold primary;
`--ep-fg-on-blue` = `--ep-accent-on`.

**Dark surface tint seed:** `--ep-tint #E3B563` — the gold mixed into each dark
surface via `color-mix(in oklab, <graphite>, var(--ep-tint))`.

## Typography

**Families:** `--ep-font-display` & `--ep-font-sans` = Roboto (+ system
fallbacks); `--ep-font-mono` = JetBrains Mono. Self-hosted (see
`assets/fonts/fonts.css`).

**Scale** (each is a complete `font:` shorthand):
`--ep-text-display-lg` (700, clamp 56→96px) · `--ep-text-display` (400, clamp 44→72px) ·
`--ep-text-h1` (400 48px) · `--ep-text-h2` (400 36px) · `--ep-text-h3` (600 24px) ·
`--ep-text-h4` (600 18px) · `--ep-text-lead` (400 20px) · `--ep-text-body` (400 16px) ·
`--ep-text-small` (400 14px) · `--ep-text-meta` (500 12px) · `--ep-text-overline` (500 12px) ·
`--ep-text-code` (500 14px mono).

**Tracking:** `--ep-track-tight -0.02em` · `--ep-track-normal 0` ·
`--ep-track-wide 0.08em` · `--ep-track-overline 0.14em`.

## Spacing & layout

**4px base scale:** `--ep-space-0` 0 · `-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 ·
`-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 · `-12` 48 · `-16` 64 · `-20` 80 ·
`-24` 96 · `-32` 128 (px).

**Layout maxima:** `--ep-layout-max-app` 1240 · `--ep-layout-max-marketing` 1240 ·
`--ep-layout-max-prose` 720 · `--ep-layout-max-narrow` 480 ·
`--ep-layout-gutter` 24 (px).

## Breakpoints & layout (2026)

Defined in `tokens/breakpoints.css` — the additive 2026 modernization layer.
Loaded after `spacing.css`; does NOT redefine the four layout maxima above.

**Viewport breakpoints** (use in `@media (min-width: …)`; px on purpose — breakpoints compare against the unscaled viewport):

| Token | Value | Label |
|---|---|---|
| `--ep-screen-sm` | `640px` | large phone / small tablet |
| `--ep-screen-md` | `768px` | tablet |
| `--ep-screen-lg` | `1024px` | small laptop |
| `--ep-screen-xl` | `1280px` | desktop |
| `--ep-screen-2xl` | `1536px` | large desktop (Tailwind 2xl) |
| `--ep-screen-3xl` | `1920px` | FHD / large monitor |
| `--ep-screen-4xl` | `2560px` | QHD / ultrawide (2560×1080 or 2560×1440) |

Note: 4K (3840px) is NOT a separate breakpoint — it is handled via the max-width cap and full-bleed sentinel below.

**Large-display container caps** (pin content; let gutters absorb excess on ultrawide / 4K):

| Token | Value | Purpose |
|---|---|---|
| `--ep-layout-max-wide` | `1440px` | data-dense dashboards / wide tables |
| `--ep-layout-max-fhd` | `1920px` | hard cap on FHD/ultrawide: no over-stretch |
| `--ep-layout-measure` | `65ch` | typographic reading measure (50–75 ch sweet spot) |
| `--ep-layout-max-full` | `none` | sentinel: full-bleed / no max-width cap |

**Fluid spacing** (viewport-fluid companions to the fixed 4px scale):

| Token | Value | Range |
|---|---|---|
| `--ep-layout-gutter-fluid` | `clamp(1rem, 2.5vw + 0.5rem, 2rem)` | ~16 → 32px |
| `--ep-layout-section-fluid` | `clamp(3rem, 6vw + 1rem, 6rem)` | ~48 → 96px |

**Full-height:**
`--ep-layout-full-height: 100dvh` — dynamic viewport height; tracks mobile browser chrome. Prefer over `100vh` for heroes, modals, and app shells.

## Radius

`--ep-radius-sm` 6 · `md` 12 (cards/buttons) · `lg` 18 · `xl` 26 · `2xl` 36
(editorial) · `pill` 999px.

## Shadow & focus

Five warm-blend steps (never pure black, never offset > 32px), remapped deeper
& more transparent in dark:
`--ep-shadow-xs` (flat) · `sm` (rest) · `md` (hover) · `lg` (popover/floating) ·
`xl` (modal/hero) · `--ep-shadow-inset`.

**Focus rings are separate tokens:** `--ep-shadow-focus` = 3px **gold** ring (the
default, primary controls); `--ep-shadow-focus-second` = sapphire ring (for
second-voice controls). `--ep-shadow-focus-warm` is a gold alias kept for
back-compat.

## Motion

Easings: `--ep-ease-out` (default) · `--ep-ease-in-out` (page-level) ·
`--ep-ease-spring` (tactile). Durations: `--ep-dur-fast` 140ms ·
`--ep-dur-base` 220ms · `--ep-dur-slow` 360ms.

## Reusable classes

`colors_and_type.css` also ships ready-to-use type classes so you rarely set raw
`font`: `.ep-display-lg`, `.ep-display`, `.ep-h1`…`.ep-h4`, `.ep-lead`,
`.ep-body`, `.ep-small`, `.ep-meta`, `.ep-overline`, `.ep-code`. The flourish
hook (`h1 em … .ep-display em`, `.ep-display-bold`) recolors a display headline's
`<em>` to **bold sapphire** automatically. Plus the `.ep-theme-toggle` control
(see `references/theming-and-consumption.md`).
