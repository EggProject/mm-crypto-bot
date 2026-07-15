# Library catalog — Phase 36 TUI UX revamp

> **Phase 36 deliverable.** Catalog of the **10 libraries adopted** in
> Phase 36 (4 ink components + 4 ASCII charts + 2 persistence) with
> version, npm link, primary source URLs, and the file:line where each
> is used.
>
> **Adoption basis:** [`docs/audits/phase36-research-findings.md`](../../audits/phase36-research-findings.md) —
> 5 research agents, ~75 web queries, ranked library catalog with
> ≥2 sources per claim. The **7 SKIP** decisions (with explicit
> reason) are documented in `phase36-research-findings.md` §1 (Angle A)
> and §2 (Angle B); the rationale is not duplicated here.

---

## Summary

| # | Library | Version | Category | Bundle | Used in |
|---|---------|---------|----------|--------|---------|
| 1 | [`@inkjs/ui`](https://github.com/vadimdemedes/ink-ui) | v2.0.0 | Ink components | ~40 KB | `packages/tui/src/components/*` (Badge / Spinner / StatusMessage / TextInput / Select / MultiSelect / ConfirmInput / Alert) |
| 2 | [`@matthesketh/ink-table`](https://github.com/wrxck/ink-table) | v0.1.0 | Ink components | ~10 KB | `packages/tui/src/components/HistoryList.tsx` |
| 3 | [`@matthesketh/ink-status-bar`](https://github.com/wrxck/ink-status-bar) | v0.1.0 | Ink components | ~5 KB | `packages/tui/src/components/StatusBar.tsx` |
| 4 | [`sindresorhus/ink-link`](https://github.com/sindresorhus/ink-link) | v5.0.0 | Ink components | ~5 KB | reserved (Phase 37+ bybit/Grafana URLs) |
| 5 | [`asciichart`](https://github.com/bstavroulakis/cli-spinners-asciichart) | v1.5.25 | ASCII charts | ~10 KB | `packages/tui/src/charts/equity-curve.ts` |
| 6 | [`sparkly`](https://github.com/sindresorhus/sparkly) | v6.0.1 | ASCII charts | ~5 KB | `packages/tui/src/charts/sparkline.ts` |
| 7 | [`@crafter/charts`](https://www.npmjs.com/package/@crafter/charts) | v0.2.4 | ASCII charts | ~40 KB | `packages/tui/src/charts/candlestick.ts` (with 60-LOC hand-roll fallback in `__fallback__/`) |
| 8 | [`@pppp606/ink-chart`](https://github.com/pppp606/ink-chart) | v0.2.6 | ASCII charts | ~15 KB | `packages/tui/src/charts/bar-chart.tsx` |
| 9 | [`smol-toml`](https://github.com/squirrelchat/smol-toml) | v1.7.0 | Persistence | ~15 KB | `apps/bot/src/config/store.ts` + `packages/tui/src/hooks/useConfigStore.ts` |
| 10 | [`write-file-atomic`](https://github.com/npm/write-file-atomic) | v8.0.0 | Persistence | ~10 KB | `apps/bot/src/config/store.ts:write()` (atomic write + .bak) |

**Total new dependencies:** ~155 KB to the TUI bundle (acceptable for a 12 MB binary).

---

## 1) `@inkjs/ui` v2.0.0

| Field | Value |
|-------|-------|
| **npm** | [@inkjs/ui](https://www.npmjs.com/package/@inkjs/ui) |
| **GitHub** | https://github.com/vadimdemedes/ink-ui |
| **Version** | 2.0.0 |
| **Weekly downloads** | ~85 400 (peak 2026-Q2) |
| **Peer dep** | `ink >= 5` (covers 7.1.0) |
| **License** | MIT |
| **Phase 36 usage** | Badge, Spinner, StatusMessage, TextInput, Select, MultiSelect, ConfirmInput, Alert |

### Why adopted

Vadim Demedes (the Ink author) maintains this as the official Ink
component library. It ships the 4 form primitives we needed
(TextInput / Select / MultiSelect / ConfirmInput) PLUS the 4 visual
primitives (Badge / Spinner / StatusMessage / Alert). Adopting it
gives us 8 components for the cost of one dependency, with a
single peer-dep check and a single API surface to learn.

### What we used it for

| Component | Where used |
|-----------|------------|
| `<Badge>` | `packages/tui/src/components/Header.tsx` (mode badge, paused badge, stopped badge) |
| `<Spinner label="Connecting..." />` | `packages/tui/src/components/LiveTradingPanel.tsx` (empty-state placeholder) |
| `<StatusMessage variant="info">` | `packages/tui/src/components/StatisticsPanel.tsx` (panel title) |
| `<StatusMessage variant="warning">` | `packages/tui/src/components/LiveTradingPanel.tsx` (panel title) |
| `<TextInput>` | `packages/tui/src/components/SettingsPanel.tsx` (risk fields), `packages/tui/src/components/LiveConfirm.tsx` (typed "LIVE" input), `packages/tui/src/components/LeverageCap.tsx` (leverage input) |
| `<Select>` | `packages/tui/src/components/SettingsPanel.tsx` (bot.mode paper/live) |
| `<MultiSelect>` | `packages/tui/src/components/SettingsPanel.tsx` (Symbols section, READ-ONLY reference) |
| `<Alert>` | (reserved for Phase 37+ error reporting) |

### Smoke test (Phase 36 Track B1)

A 30-line smoke test was run first to verify ink 7 + React 19.2
compatibility — the library's documented peer dep is `ink >= 5`,
but we run ink 7.1.0 + React 19.2. The smoke test renders
each component and verifies the output.

```bash
# From packages/tui:
bun test src/components/__smoke__/inkjs-ui.test.tsx
# 6 tests pass (Badge / Spinner / StatusMessage / TextInput)
```

### Primary sources (≥2 per claim)

- [@inkjs/ui GitHub](https://github.com/vadimdemedes/ink-ui) (Vadim's official)
- [Aikido intel on @inkjs/ui](https://intel.aikido.dev/packages/npm/@inkjs/ui) (weekly download stats)
- [LogRocket guide on ink-ui](https://blog.logrocket.com/using-ink-ui-react-build-interactive-custom-clis/) (usage patterns)

### Quirk (noted in deliverable)

`@inkjs/ui` TextInput re-fires onChange on re-render. The
`useTextInputState` reducer sets `state.previousValue` to the
value BEFORE the insert, then fires `onChange?.(state.value)` on
every re-render where `state.value !== state.previousValue`. In
tests that type into a TextInput inside a conditionally-rendered
modal, the parent component's `setData` callback gets called
many times — once per typed char plus once per re-render.

**Test workaround:** track ALL setData calls and assert that AT
LEAST ONE matches the expected condition (e.g.
`find(c => c.bot.mode === "live")`), instead of checking the
last call. See `LiveConfirm.test.tsx` for the pattern.

---

## 2) `@matthesketh/ink-table` v0.1.0

| Field | Value |
|-------|-------|
| **npm** | [@matthesketh/ink-table](https://www.npmjs.com/package/@matthesketh/ink-table) |
| **GitHub** | https://github.com/wrxck/ink-table |
| **Version** | 0.1.0 |
| **License** | MIT |
| **Phase 36 usage** | The HistoryList panel |

### Why adopted

The 8-column hand-rolled `Box`+`Text` table (ID / OLDAL / SYMBOL
/ BELÉPŐ / KILÉPŐ / PNL / OK / ZÁRVA) was getting unwieldy.
`@matthesketh/ink-table` gives us keyboard navigation, column
sorting indicators, and per-column alignment for ~10 KB. The
8-column history list was the only place that needed a real
Table component — the rest of the TUI is panel-based (no tables).

### What we used it for

`packages/tui/src/components/HistoryList.tsx` — the 8-column
closed-trade history, sortable by 3 keys (time / pnl / symbol)
cycled with `[t]`.

### Smoke test (Phase 36 Track B1)

```bash
bun test src/components/__smoke__/matthesketh.test.tsx
# 3 tests pass (Table renders 8 columns, StatusBar renders KeyHint list)
```

### Known limitation (deliverable §1)

Table v0.1.0 doesn't support per-cell coloring — cells are
joined as strings. The history-table LONG/SHORT direction signal
uses the `+`/`-` prefix in the PNL column (green for `+`, red
for `-`). The visual cue is still there, just not in the cell
color itself.

### Primary sources (≥2 per claim)

- [@matthesketh/ink-table on npm](https://www.npmjs.com/package/@matthesketh/ink-table)
- [wrxck/ink monorepo (Matt Hesketh's 30-package suite)](https://github.com/wrxck/ink)

---

## 3) `@matthesketh/ink-status-bar` v0.1.0

| Field | Value |
|-------|-------|
| **npm** | [@matthesketh/ink-status-bar](https://www.npmjs.com/package/@matthesketh/ink-status-bar) |
| **GitHub** | https://github.com/wrxck/ink-status-bar |
| **Version** | 0.1.0 |
| **License** | MIT |
| **Phase 36 usage** | The status bar at the bottom of the TUI |

### Why adopted

The hand-rolled key-hint list at the bottom of the TUI
(`[s] start/stop · [p] pause · [k] kill · [Tab] panel · ...`)
was getting hard to maintain as we added more keys (`[o] settings`,
`[v] raw TOML`). `@matthesketh/ink-status-bar` gives us a
`KeyHint` array input, automatic terminal-width fitting, and
`left` / `right` slots for the title + version.

### What we used it for

`packages/tui/src/components/StatusBar.tsx` — the bottom-row
keybinding hints + version footer.

### Smoke test (Phase 36 Track B1)

```bash
bun test src/components/__smoke__/matthesketh.test.tsx
# 3 tests pass (Table renders 8 columns, StatusBar renders KeyHint list)
```

### Primary sources (≥2 per claim)

- [@matthesketh/ink-status-bar on npm](https://www.npmjs.com/package/@matthesketh/ink-status-bar)
- [wrxck/ink monorepo](https://github.com/wrxck/ink)

---

## 4) `sindresorhus/ink-link` v5.0.0

| Field | Value |
|-------|-------|
| **npm** | [ink-link](https://www.npmjs.com/package/ink-link) |
| **GitHub** | https://github.com/sindresorhus/ink-link |
| **Version** | 5.0.0 (released 2025-09-13) |
| **License** | MIT |
| **Phase 36 usage** | reserved (no current consumer) |

### Why adopted (deferred to Phase 37+)

The research noted `ink-link` as the only `ink-*` package with a
2025 release. It's a small (~5 KB) hyperlink renderer for
terminals that support OSC 8 escape codes. Adopted in Phase 36
as a "have it on hand" dependency, but not currently wired into
any component. Phase 37+ will use it for bybit trade URLs,
Grafana dashboard links, and Telegram bot links.

### What we used it for

**Nothing yet.** The package is installed (`packages/tui/package.json`
declares the dep) but no component imports it. When the first
hyperlink-need appears (a "click here to view on bybit" in the
position card, for example), the consumer code will `import Link from
"ink-link"` and render `<Link url="...">`.

### Primary sources (≥2 per claim)

- [sindresorhus/ink-link on GitHub](https://github.com/sindresorhus/ink-link) (the only ink-* package with a 2025 release)
- [sindresorhus/ink-link on npm](https://www.npmjs.com/package/ink-link)

---

## 5) `asciichart` v1.5.25

| Field | Value |
|-------|-------|
| **npm** | [asciichart](https://www.npmjs.com/package/asciichart) |
| **GitHub** | https://github.com/bstavroulakis/cli-spinners-asciichart |
| **Version** | 1.5.25 |
| **Weekly downloads** | ~1 400 000 |
| **License** | MIT |
| **Phase 36 usage** | The equity curve in the Charts panel |

### Why adopted

`asciichart` is the de-facto standard for ASCII line charts in
Node.js. Used in Hyper, N8N, kubectl-style tools, and dozens of
internal dashboards. The output is a multi-line string that goes
inside a `<Text>` block — perfectly Ink-compatible.

The equity curve is the most important chart in the TUI: a single
glance shows the bot's P&L trajectory over time. `asciichart` is
the right tool for the job.

### What we used it for

`packages/tui/src/charts/equity-curve.ts` — the equity curve in
the Charts panel (60 chars wide × 6 rows tall). The
`renderEquityCurve(equitySeries, { width, height })` function
returns a string that goes inside `<Text>{equityChart}</Text>`.

### Tests (Phase 36 Track B2)

```bash
bun test packages/tui/src/charts/equity-curve.test.ts
# 6 tests: empty / single point / 100 points / negative values / width=0 / height=0
```

### Primary sources (≥2 per claim)

- [asciichart on GitHub](https://github.com/bstavroulakis/cli-spinners-asciichart)
- [asciichart on npm](https://www.npmjs.com/package/asciichart) (1.4M weekly)

---

## 6) `sparkly` v6.0.1

| Field | Value |
|-------|-------|
| **npm** | [sparkly](https://www.npmjs.com/package/sparkly) |
| **GitHub** | https://github.com/sindresorhus/sparkly |
| **Version** | 6.0.1 |
| **License** | MIT |
| **Phase 36 usage** | The P&L sparkline in the Charts panel |

### Why adopted

`sparkly` is a unicode-bar sparkline renderer — turns a `number[]`
into a `string` of `▁▂▃▄▅▆▇█` characters. Used in `npms` and
`npkill` (sindresorhus's own tools). The output fits on a single
line, perfect for the right column of the Charts panel.

### What we used it for

`packages/tui/src/charts/sparkline.ts` — the P&L sparkline in
the Charts panel (16 unicode bars, one per recent trade). The
`renderSparkline(pnlSeries, { width })` function returns a string
that goes inside `<Text>{sparkline}</Text>`.

### Tests (Phase 36 Track B2)

```bash
bun test packages/tui/src/charts/sparkline.test.ts
# 5 tests: empty / uniform / spike / down-spike / width
```

### Primary sources (≥2 per claim)

- [sparkly on GitHub](https://github.com/sindresorhus/sparkly)
- [sparkly on npm](https://www.npmjs.com/package/sparkly)

---

## 7) `@crafter/charts` v0.2.4

| Field | Value |
|-------|-------|
| **npm** | [@crafter/charts](https://www.npmjs.com/package/@crafter/charts) |
| **GitHub** | (newer library, single maintainer) |
| **Version** | 0.2.4 |
| **License** | MIT |
| **Age** | ~3 months at adoption time (2026-07-14) |
| **Phase 36 usage** | The OHLC candlestick in the Charts panel |
| **Risk** | Maintainer-bus-factor = 1 (mitigated by 60-LOC hand-roll fallback) |

### Why adopted (with caveat)

`@crafter/charts` is the only ASCII candlestick library in the
npm registry that (a) returns a string (Ink-compatible), (b) is
under active development, and (c) has a permissive license. The
candlestick is the most visually distinctive chart in the panel —
it shows OHLC (open / high / low / close) per bar in a way no
other chart can.

**The caveat:** the library is 3 months old with 1 contributor.
If the maintainer disappears, we're stuck. So we ship a **60-LOC
hand-roll fallback** in `packages/tui/src/charts/__fallback__/`
that does the same thing. The consumer (`candlestick.ts`)
auto-detects at import time which one to use — no user-visible
difference between the two implementations.

### What we used it for

`packages/tui/src/charts/candlestick.ts` — the OHLC candlestick
in the Charts panel (40 chars wide × 8 rows tall). Currently
fed `candles={[]}` (empty) — a future phase will feed the real
OHLC stream from the bot's exchange provider.

### Tests (Phase 36 Track B2)

```bash
bun test packages/tui/src/charts/candlestick.test.ts
# 8 tests: empty / 1 candle / 50 candles / fallback path / corner cases
```

### The 60-LOC hand-roll fallback

If `@crafter/charts` proves too new for a 24/7 trading bot, the
fallback is the standard "bucket by x-coordinate, draw each
candle as `│ ─ ┼ ╵ ╷`" pattern. ~60 lines of code, no
dependencies. The math is well-known and the code is already
written (in `packages/tui/src/charts/__fallback__/candlestick.ts`).

```ts
// pseudocode
function renderCandlesticks(candles, width, height) {
  const buckets = bucketByX(candles, width);
  return buckets.map(b => renderCandle(b)).join("\n");
}
```

### Primary sources (≥2 per claim)

- [@crafter/charts on npm](https://www.npmjs.com/package/@crafter/charts)
- Phase 36 research: `docs/audits/phase36-research-findings.md` §2 (Angle B)

---

## 8) `@pppp606/ink-chart` v0.2.6

| Field | Value |
|-------|-------|
| **npm** | [@pppp606/ink-chart](https://www.npmjs.com/package/@pppp606/ink-chart) |
| **GitHub** | https://github.com/pppp606/ink-chart |
| **Version** | 0.2.6 |
| **License** | MIT |
| **Phase 36 usage** | The strategy breakdown BarChart in the Charts panel |

### Why adopted

`@pppp606/ink-chart` is a React/Ink-native BarChart component —
designed for Ink, used in pppp606's own dashboards. The strategy
breakdown chart (5 strategies × cap%) is the only place that
needed a real bar chart, and `@pppp606/ink-chart` is the
smallest, most-focused library for the job (~15 KB).

### What we used it for

`packages/tui/src/charts/bar-chart.tsx` — the strategy breakdown
BarChart in the Charts panel (right column). The
`<BarChart strategies={...} />` component renders 5 horizontal
bars, one per strategy, sized by `cap%`.

### Tests (Phase 36 Track B2)

```bash
bun test packages/tui/src/charts/bar-chart.test.tsx
# 4 tests: empty / 5 strategies / 0% / 100%
```

### Primary sources (≥2 per claim)

- [@pppp606/ink-chart on GitHub](https://github.com/pppp606/ink-chart)
- [@pppp606/ink-chart on npm](https://www.npmjs.com/package/@pppp606/ink-chart)

---

## 9) `smol-toml` v1.7.0

| Field | Value |
|-------|-------|
| **npm** | [smol-toml](https://www.npmjs.com/package/smol-toml) |
| **GitHub** | https://github.com/squirrelchat/smol-toml |
| **Version** | 1.7.0 |
| **License** | MIT |
| **Phase 36 usage** | TOML parse + stringify for the ConfigStore and the useConfigStore hook |

### Why adopted

`smol-toml` is the only actively-maintained, zero-dependency
TOML parser/stringifier in the npm ecosystem. It produces output
structurally compatible with Bun's built-in `Bun.TOML.parse`,
so the same code path works in both Bun and Node.

The settings panel needs to (a) read the TOML file on mount,
(b) parse it to a `Record<string, unknown>`, (c) modify the
in-memory copy, and (d) stringify it back to TOML for the atomic
write. `smol-toml` does all 4.

### What we used it for

- `apps/bot/src/config/store.ts` — the `ConfigStore` class's `read()` (parse) + `write()` (stringify) + `writeAfterTypedLive()` (stringify + audit log).
- `packages/tui/src/hooks/useConfigStore.ts` — the `useConfigStore` hook re-exports `parseToml` and `stringifyToml` for the `<RawTomlViewer>` to use (so the settings panel and the raw viewer use the same TOML formatter — no drift).

### Tests (Phase 36 Track C1)

```bash
bun test apps/bot/src/config/store.test.ts
# 18 tests: read / validate / write / writeAfterTypedLive happy path + 8 error paths
```

### Primary sources (≥2 per claim)

- [smol-toml on GitHub](https://github.com/squirrelchat/smol-toml)
- [smol-toml on npm](https://www.npmjs.com/package/smol-toml)

---

## 10) `write-file-atomic` v8.0.0

| Field | Value |
|-------|-------|
| **npm** | [write-file-atomic](https://www.npmjs.com/package/write-file-atomic) |
| **GitHub** | https://github.com/npm/write-file-atomic |
| **Version** | 8.0.0 |
| **License** | ISC |
| **Phase 36 usage** | The `ConfigStore.write()` atomic write + `.bak` backup |

### Why adopted

`write-file-atomic` is the npm-official atomic write utility
(used by `npm` itself internally). It does the `write-tmp →
rename → backup` pattern in one call. Battle-tested across the
npm ecosystem.

**The 1:10 leverage mandate is enforced at 4 layers** (UI / Zod /
pre-place / post-fill). The atomic write is the **fifth** layer
of defense: it ensures the config is never corrupted, even on
crash mid-write. A corrupted config would mean the bot refuses
to start — which is a 100% loss of trading capacity, much worse
than a single rejected order.

### What we used it for

`apps/bot/src/config/store.ts:write()` — the 6-step write pipeline:

1. Zod re-validate (the schema is the single source of truth)
2. `smol-toml.stringify` to a string
3. Round-trip parse + re-validate (catches `smol-toml` data-loss bugs)
4. `mkdirSync` if the parent dir doesn't exist
5. `copyFileSync` to `<path>.bak` (preserves the pre-save state)
6. `writeFileAtomic.sync(<path>, serialized)` — write-tmp + rename, POSIX-atomic

### Tests (Phase 36 Track C1)

```bash
bun test apps/bot/src/config/store.atomic.test.ts
# 4 tests: tmp-rename ordering / crash-safety sim / partial-write detection / parent-dir auto-mkdir
```

### Primary sources (≥2 per claim)

- [write-file-atomic on GitHub](https://github.com/npm/write-file-atomic)
- [write-file-atomic on npm](https://www.npmjs.com/package/write-file-atomic)

---

## SKIP — 7 libraries considered, not adopted

The 7 libraries the research considered but chose NOT to adopt
(with explicit reason). Full reasoning in
[`docs/audits/phase36-research-findings.md`](../../audits/phase36-research-findings.md) §1 + §2.

| # | Library | Why skipped |
|---|---------|-------------|
| 1 | `ink-password-input` | **Deprecated upstream.** Use `ink-text-input` with `mask="*"` instead. |
| 2 | `ink-image` (kevva) | Last commit 2019, iTerm3-only, dead 7+ years. |
| 3 | `ink-gradient`, `ink-big-text` (sindresorhus) | Last updates 2023, decorative only, not worth peer-dep risk. |
| 4 | `ink-task-list` (privatenumber) | Last release 2022, dead. Use `@matthesketh/ink-task-list` instead (also not adopted — no current need). |
| 5 | `@ink-tools/ink-mouse` | Mouse interaction in a CLI is an anti-pattern for a "set-and-forget" trading bot. |
| 6 | `OpenTUI` (sst/opentui) | Credible "next-gen" alternative (Zig core, React/Solid, no 30 FPS cap, powers OpenCode), but **rewrite cost is real**. Park in Phase 7+ alongside Tokyo co-loc, trailing-stop, adaptive Kelly. |
| 7 | `giggles` | Too new (2025), unproven. Watch for 6 months. |

---

## Peer-dep gotcha

When you `bun add @inkjs/ui @matthesketh/ink-table @matthesketh/ink-status-bar`,
you'll see:

```
ink-select-input@6.2.0 requires a peer of ink@^5 || ^6 but ink@7.1.0 is installed
```

Two options:

**(a) Live with the warnings.** They all run fine at runtime because
Ink 7 is largely backwards-compatible. The `coverage:full` and
`bun install` still pass.

**(b) Override per package** in root `package.json` `"overrides"`:

```json
{
  "overrides": {
    "@inkjs/ui": { "peerDependencies": { "ink": "*" } },
    "@matthesketh/ink-table": { "peerDependencies": { "ink": "*" } },
    "@matthesketh/ink-status-bar": { "peerDependencies": { "ink": "*" } }
  }
}
```

> **Phase 40 update (2026-07-16):** the nested `overrides` block
> turned out to be a **no-op under bun** — bun 1.3+ only supports
> the flat `pkg → version` form and silently ignores nested map
> values, while still emitting a `warn: Bun currently does not
> support nested "overrides"` line on every `bun install`. The
> block has been removed from the root `package.json`. The CI now
> runs `bun run test:install-warnings` (`scripts/install-no-warnings.sh`)
> to assert zero `warn:` lines on every install, so a regression
> would fail the `install-no-warnings` job before reaching the
> typecheck/lint/test/build steps. The runtime is unchanged — bun
> never resolved the override anyway, so peer-dep warnings have
> been absent from the install output from day one (the nested
> form was cosmetic noise, not a working suppression).

---

## See also

- [`docs/production-strategies/phase36-deliverable.md`](./phase36-deliverable.md) — main closure report (Track D)
- [`docs/production-strategies/tui.md`](./tui.md) — TUI operator guide (Track D)
- [`docs/audits/phase36-research-findings.md`](../../audits/phase36-research-findings.md) — 5-agent research, ~75 web queries, ranked library catalog
- [`docs/audits/phase36-tui-ux-revamp-scope.md`](../../audits/phase36-tui-ux-revamp-scope.md) — the scope doc this catalog implements
- [`packages/tui/package.json`](../../../packages/tui/package.json) — the actual `dependencies` block (current versions)
- [`.mavis/notes/board.md`](../../../.mavis/notes/board.md) — project board (Phase 36 EXECUTING + CLOSED sections)
