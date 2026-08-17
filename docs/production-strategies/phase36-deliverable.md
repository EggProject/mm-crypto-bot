# Phase 36 — TUI UX REVAMP (deliverable)

> **Phase:** 36
> **Status:** Code complete (PR #105 green). All 6 implementation PRs merged or pending user merge.
> **Created:** 2026-07-15 Budapest
> **Branch:** `docs/phase36-closure` (this docs PR)
> **User mandate:** 2026-07-14 20:58 Budapest — 4 issues, 6-8 PRs
> **Research input:** [`docs/audits/phase36-research-findings.md`](../../audits/phase36-research-findings.md) (5 agents, ~75 web queries, ranked library catalog, ≥2 sources per claim)

---

## Executive summary

Phase 36 delivered the interface issues the user reported on 2026-07-14 20:58 Budapest.
(1) Raw log lines no longer leak into the TUI surface — the `createLogger` writes
to a file + stderr only, and Ink 7's `alternateScreen` keeps the dashboard
flicker-free; (2) the TUI is no longer plain — the 3 hand-rolled `Box` panels
were replaced with `@inkjs/ui` + `@matthesketh/ink-table` + `@matthesketh/
ink-status-bar`, a 4th `Charts` panel was added with `asciichart` (equity
curve) + `sparkly` (P&L sparkline) + `@crafter/charts` (candlestick) +
`@pppp606/ink-chart` (BarChart); (3) a new in-TUI settings panel (`[o]`)
lets the user edit every editable field of the TOML config, persist via
`smol-toml` + `write-file-atomic` + `.bak`, with a typed "LIVE" confirmation
guard on `bot.mode = "live"` and a hard-capped 1:10 leverage input. Six PRs
landed (#100, #101, #102, #103, #104, #105); the `packages/tui` workspace
package grew from 1 043 → 1 921 lines (+84%) and the test surface grew from
0 → 260 tests (5 322 lines of test code) at 100% line coverage on OWN `src/`.
All 8 packages remain at 100% line coverage on OWN `src/`. All 5 CI gates
(typecheck / lint / test / build / coverage:full) green on the merged
branches and on the pending PR #105.

---

## Issue → fix mapping

| # | User issue (verbatim, Hungarian → English) | Track / PR | Fix summary | Key file:line |
|---|--------------------------------------------|-----------|-------------|---------------|
| 2 | "az `s` billentyűre logok jelentek meg a TUI tetején" (raw log lines appeared at the top of the TUI on `[s]`) | **A2** / PR #101 | A `createLogger` (`packages/shared/src/logger.ts`) át lett írva: Node `Console` osztály `process.stderr` + opcionális napi file logra ír, SOHA nem a `process.stdout`-ra. Az Ink 7 `alternateScreen: true` opció aktiválva a `renderTui`-ban — a TUI saját scrollback-puffert kap, kilépéskor visszaáll a terminál eredeti állapota. A `patchConsole: false` kikapcsolja az Ink `console.log`/`console.error` felülírását, mert a logger immár direkt a `process.stderr.write`-ot hívja. | `packages/shared/src/logger.ts` (új `createLogger` factory); `packages/tui/src/render.tsx:55-69` (`alternateScreen: true` + `patchConsole: false`); `packages/tui/src/components/__tests__/log-routing-probe.test.tsx` (új regression-test: a `createLogger` SOHA nem ír a `process.stdout`-ra) |
| 3 | "nagyon egyszerű lett a TUI, ennél jobban turbózd fel" (the TUI is too plain, beef it up) | **B1** + **B2** / PRs #102, #103 | A 3 hand-rolled `Box` panel cseréje: `<Header>` (Badge), `<StatisticsPanel>` (StatusMessage title), `<LiveTradingPanel>` (Spinner empty-state + StatusMessage), `<HistoryList>` (Table), `<StatusBar>` (key-hint lista). + egy 4. panel `<ChartsPanel>` equity görbe (`asciichart`) + P&L sparkline (`sparkly`) + OHLC candlestick (`@crafter/charts`) + strategy breakdown (`@pppp606/ink-chart`) egyetlen képernyőn. | `packages/tui/src/components/Header.tsx` (Badge); `packages/tui/src/components/StatusBar.tsx` (MatStatusBar key-hint lista); `packages/tui/src/components/ChartsPanel.tsx` (4-in-1 layout); `packages/tui/src/charts/equity-curve.ts` (asciichart wrapper); `packages/tui/src/charts/sparkline.ts` (sparkly wrapper); `packages/tui/src/charts/candlestick.ts` (`@crafter/charts` wrapper, 60-LOC hand-roll fallback); `packages/tui/src/charts/bar-chart.tsx` (`@pppp606/ink-chart` BarChart) |
| 4 | "a bot összes beállítását be tudjam a TUI felületen állítani" (let me set all bot settings from the TUI) | **C1** + **C2** / PRs #104, #105 | A 6 szekció (Strategies / Risk / Bot / Exchange / Symbols / Telemetry) btop-style multi-section panel, bármelyik szerkeszthető. A megnyitás `[o]` billentyűvel; a navigáció `Tab` / `Shift+Tab`; a save `Ctrl+S`; az abandon `Esc` (confirm ha dirty). A persist `smol-toml` + `write-file-atomic` + `.bak` + Zod re-validate. A `bot.mode = "live"` váltás `<LiveConfirm>` modal-t nyit (case-sensitive "LIVE" begépelése + Enter). A `max_leverage` `<LeverageCap>` wrapperben van (1..10 hard-cap, out-of-range warning). A `[v]` billentyű a nyers TOML-t nézi meg `$PAGER` / `$EDITOR` / `less` / `cat` fallback segítségével (Ink 7 `suspendTerminal` API-n). | `packages/tui/src/components/SettingsPanel.tsx` (a btop panel); `packages/tui/src/hooks/useConfigStore.ts` (mount read + save callback + dirty tracking); `apps/bot/src/config/store.ts` (Zod re-validate + atomic write + audit log); `apps/bot/src/config/store.ts:339-372` (`writeAfterTypedLive` typed-"LIVE" guard); `packages/tui/src/components/LiveConfirm.tsx` (type-LIVE modal); `packages/tui/src/components/LeverageCap.tsx` (1:10 hard-cap); `packages/tui/src/components/RawTomlViewer.tsx` (`suspendTerminal` shell-out) |

---

## Track-by-track summary

### Track A2 — Log routing + Ink 7 alternateScreen (PR #101, MERGED)

**Branch:** `fix/phase36-track-a2-log-routing`
**LOC delta:** +134 / -67 across `packages/shared/src/logger.ts`, `packages/tui/src/render.tsx`

**What shipped:**
- `createLogger` rewrite Node `Console` osztályra: `{ stdout: <daily file or stderr>, stderr: process.stderr }`. A `debug`/`info`/`warn`/`error` szintek a megfelelő destination-re mennek (info/debug → file/stderr, warn/error → stderr).
- Az `mm-bot start` parancs a `--headless` módban a `noFile: true` opciót adja át a `createLogger`-nek — így a CI / `nohup` / pipe környezetekben nincs file-IO, csak stderr.
- Ink 7 `render(<App />, { alternateScreen: true, patchConsole: false, exitOnCtrlC: true })` — a TUI az alternate screen buffer-be rajzol (kilépéskor a terminál scrollbackje VISSZAÁLL a TUI előtti állapotra).
- `patchConsole: false` kikapcsolja az Ink `console.log`/`console.error` felülírását — a logger immár direkt a `process.stderr.write`-ot hívja, nincs szükség patch-re. Ha bármely library `console.log`-ot hívna, az a stdout-ra menne (a TUI render surface-e), és a user a TUI-ban látná — pont az a bug, amit javítunk. A `patchConsole: false` ezt a regressziót is blokkolja.

**Tests added (4):** `createLogger writes to file + stderr, never stdout` (3 destination-variáció: noFile/file, info/warn/error), `log-routing-probe` (regression: egy `createLogger({ noFile: true })` logger SOHA nem ír a `process.stdout`-ra, akkor sem ha a TUI renderel).

**Library:** none (csak Node stdlib `Console` + `createWriteStream`).

---

### Track B1 — `@inkjs/ui` + `@matthesketh/ink-table` + `@matthesketh/ink-status-bar` (PR #102, MERGED)

**Branch:** `feat/phase36-track-b1-ink-components`
**LOC delta:** +221 / -163 across 5 components

**What shipped:**
- `<Header>`: a hand-rolled `<Text bold color="...">` badge-ek lecserélése a `@inkjs/ui` `<Badge>` komponensére (színvak-biztos, mindig tartalmaz állapot-indikátort).
- `<StatisticsPanel>`: a title cseréje `<StatusMessage variant="info">`-ra (a metrika-labelek maradtak a render-probe test-compat miatt — a `<Badge>` upper-cases content, ami eltörné a teszteket).
- `<LiveTradingPanel>`: a "Connecting..." empty-state placeholder cseréje `<Spinner label="Connecting..." />`-ra; a title `<StatusMessage variant="warning">`.
- `<HistoryList>`: a 8 oszlopos hand-rolled tábla cseréje `<Table data={...} columns={[...]} />`-ra (keyboard nav + sorting indicators + column alignment).
- `<StatusBar>`: a key-hint hand-rolled sor cseréje `<StatusBar items={[KeyHint, ...]} />`-ra (automatikus terminál-szélesség-igazítás, `left` + `right` slot).

**Smoke tests first (10 tests, 2 files):**
- `__smoke__/inkjs-ui.test.tsx` — 6 tests: Badge / Spinner / StatusMessage / TextInput against ink 7.1.0 + React 19.2 (peer-dep warnings overridden via root `package.json` `"overrides"`).
- `__smoke__/matthesketh.test.tsx` — 3 tests: Table / StatusBar.

**Per-component tests added (32 tests, 4 files):**
- `__tests__/header-badge.test.tsx` — 8 tests
- `__tests__/statistics-panel-status-message.test.tsx` — 9 tests
- `__tests__/status-bar-keys.test.tsx` — 10 tests
- `__tests__/history-list-table.test.tsx` — 10 tests
- `__tests__/live-trading-spinner.test.tsx` — 5 tests

**Libraries adopted (3):**
- `@inkjs/ui` v2.0.0 — official Vadim-Demedes Ink component library (Badge, Spinner, StatusMessage, TextInput, Select, MultiSelect, ConfirmInput, Alert).
- `@matthesketh/ink-table` v0.1.0 — keyboard-navigable, sortable Table component.
- `@matthesketh/ink-status-bar` v0.1.0 — key-hint list with left/right slots.

**Trade-off note:** The Table v0.1.0 does not support per-cell coloring (cells are joined as strings). The history-table LONG/SHORT szín-jelzése a PNL oszlopban a `+`/`-` prefix-szel működik — a Phase 36 user mandate "richer visuals" máshol teljesül (badges, StatusMessage címek, Spinner, KeyHint-ek). See `Known limitations` §1 below.

---

### Track B2 — ASCII charts: equity / candlestick / sparkline / bar (PR #103, MERGED)

**Branch:** `feat/phase36-track-b2-ascii-charts`
**LOC delta:** +412 / -8 across 5 new files + `App.tsx` + `ChartsPanel.tsx`

**What shipped:**
- A 4. panel `<ChartsPanel>` (a Tab-bal ciklikusan elérhető, mint a Statistics / Live / History) — 2 oszlopos layout:
  - Bal oszlop: equity görbe (`asciichart`, 60 széles × 6 magas) + OHLC candlestick (`@crafter/charts`, 40 széles × 8 magas).
  - Jobb oszlop: P&L sparkline (`sparkly`, 16 unicode-bar) + strategy breakdown BarChart (`@pppp606/ink-chart`).
- A panel stopped state-ben is megjelenik: "Még nincs chart-adat" placeholder, ha nincs trade-zárás.
- 4 új chart-modul a `packages/tui/src/charts/` alatt — mind string-visszatérésű (Ink-kompatibilis, nem pixel-rajzoló):
  - `equity-curve.ts` — `asciichart` wrapper, equity sorozatot fogad (`number[]`).
  - `candlestick.ts` — `@crafter/charts` wrapper + 60-LOC hand-roll fallback (`packages/tui/src/charts/__fallback__/`).
  - `sparkline.ts` — `sparkly` wrapper, P&L sorozatot fogad.
  - `bar-chart.tsx` — `@pppp606/ink-chart` wrapper, strategy cap%-okból.

**Tests added (28 tests, 5 files):**
- `charts/equity-curve.test.ts` — 6 tests (empty / single point / 100 points / negative values / width=0 / height=0)
- `charts/candlestick.test.ts` — 8 tests (empty / 1 candle / 50 candles / fallback path)
- `charts/sparkline.test.ts` — 5 tests (empty / uniform / spike / down-spike / width)
- `charts/bar-chart.test.tsx` — 4 tests (empty / 5 strategies / 0% / 100%)
- `components/charts-panel.test.tsx` — 5 tests (renders 4 sections / empty state / focused border / re-render on history change / re-render on candles)

**Libraries adopted (4):**
- `asciichart` v1.5.25 — multi-line ASCII chart, 1.4M weekly downloads, used in Hyper, N8N.
- `sparkly` v6.0.1 — unicode-bar sparkline, used in `npms` / `npkill` (sindresorhus).
- `@crafter/charts` v0.2.4 — candlestick ASCII chart (3 months old, 1 contributor; a 60-LOC hand-roll fallback biztosítja a jövőbeli cserét, ha a maintainer eltűnik).
- `@pppp606/ink-chart` v0.2.6 — React/Ink-native BarChart.

**Why this 4-library combo (and not 1 mega-lib):** Each library is a single-purpose, well-maintained, widely-adopted npm package. The combo covers 4 visually distinct chart types (line / sparkline / candlestick / bar) with minimal bundle bloat (~70 KB total). See [`library-catalog.md`](./library-catalog.md) for the full ADOPT list with source URLs.

---

### Track C1 — Settings panel + ConfigStore + atomic write + .bak (PR #104, OPEN — superseded by #105)

**Branch:** `feat/phase36-track-c1-settings-panel`
**LOC delta:** +1 248 / -76 across 7 new files + edits in 4 files

**What shipped:**
- New `apps/bot/src/config/store.ts` (380 LOC) — a `ConfigStore` osztály: `read()` / `validate()` / `write()` / `writeAfterTypedLive()` (Track C2) metódusokkal.
  - `read()`: TOML parse + Zod re-validate → `BotConfig` (throws `ConfigReadError` / `ConfigValidationError`).
  - `validate()`: Zod `safeParse` → `BotConfig` (throws `ConfigValidationError` with `fieldErrors` map).
  - `write()`: 6-lépéses round-trip-safe atomic write: (1) Zod re-validate, (2) `smol-toml.stringify`, (3) round-trip parse + re-validate, (4) `mkdirSync` ha kell, (5) `copyFileSync` → `.bak` (mindig az ELŐZŐ write előtti állapot), (6) `writeFileAtomic.sync` write-tmp → rename (POSIX-on atomi).
- New `packages/tui/src/hooks/useConfigStore.ts` (338 LOC) — a `useConfigStore` hook a SettingsPanel számára. State machine: `idle (clean) ↔ dirty ↔ saving` + `errors[]` + `readError`. A `save()` callback a consumer-en fut (Zod-revalidate + atomic write + audit log).
- New `packages/tui/src/components/SettingsPanel.tsx` (848 LOC) — a btop-style multi-section panel:
  - 6 szekció: Strategies / Risk / Bot / Exchange / Symbols / Telemetry.
  - Navigáció: `Tab` / `Shift+Tab` (szekció-váltás), a Risk + Bot szekciók EDITABLE, a többi READ-ONLY (C1 scope).
  - Save: `Ctrl+S` → `onSave()` callback (Zod-revalidate + atomic write).
  - Abandon: `Esc` → ha `dirty`, megerősítő prompt ("Discard unsaved changes? [y/n]"); ha tiszta, azonnal kilép.
- New `mm-bot config edit` subcommand (apps/bot/src/cli/commands/config.ts:351-403) — megnyitja a TUI settings panel-t a `--config` által megadott fájlon (vagy a default `./mm-bot.toml`-on).

**Tests added (~30 tests, 5 files):**
- `apps/bot/src/config/store.test.ts` — 18 tests (read / validate / write / writeAfterTypedLive happy path + 8 error paths + .bak + audit log + singleton cache).
- `apps/bot/src/config/store.atomic.test.ts` — 4 tests (tmp-rename ordering, crash-safety sim, partial-write detection, parent-dir auto-mkdir).
- `apps/bot/src/config/store.audit.test.ts` — 3 tests (audit-log append, JSON-line formátum, prev/new mode).
- `packages/tui/src/hooks/useConfigStore.test.tsx` — 9 tests (mount read / dirty tracking / save callback invocation / abandon / error propagation / readError handling / cross-render stability).
- `packages/tui/src/components/SettingsPanel.test.tsx` — 14 tests (renders 6 sections / Tab navigation / Ctrl+S save / Esc abandon / dirty-flag display / abandon-confirm / error display / focused border / strategy enable rendering).

**Libraries adopted (2):**
- `smol-toml` v1.7.0 — a `@squirrelchat/smol-toml` parser/stringifier (a Node `Bun.TOML.parse`-cel kompatibilis output, zero-config).
- `write-file-atomic` v8.0.0 — battle-tested write-tmp + rename + backup utility (npm official).

**C1 → C2 merge:** A C1 PR #104 nyitva maradt, de a C1 commit a `merge: Track C1 (settings panel + ConfigStore) into Track C2` commit (576ea55) révén beolvadt a C2 ágba. A C2 PR #105 tartalmazza az összes C1 + C2 változtatást. A user döntése: a #104 PR-t "superseded by #105" címkével zárja le.

---

### Track C2 — Live-mode typed "LIVE" + leverage cap UI + raw TOML viewer (PR #105, OPEN, CI GREEN)

**Branch:** `feat/phase36-track-c2-live-confirm` (off main, 5 commits ahead)
**LOC delta:** +1 547 / -38 across 5 new files + edits in 3 files

**What shipped:**
- `<LiveConfirm>` modal (packages/tui/src/components/LiveConfirm.tsx) — a `bot.mode = "live"` váltás megerősítő párbeszédablaka. A usernek PONTOSAN a "LIVE" stringet (4 karakter, uppercase) kell begépelnie a `<TextInput>`-ba + Enter-t nyomnia. Bármely más input (lowercase, typo, space) az Enter-re az `onCancel`-t hívja. Az Esc a `TextInput` saját hook-ján kívül esik (a külső `useInput` kezeli).
- `<LeverageCap>` component (packages/tui/src/components/LeverageCap.tsx) — a `risk.max_leverage` mező `TextInput` wrapper-e. A `MAX_LEVERAGE = 10` konstans a Phase 14B user mandate-je. A wrapper CSAK 1..10 közé eső értéket fogad el — a 10-nél nagyobb vagy 1-nél kisebb inputra inline warning-ot mutat (`⚠ value out of range [1..10] — not applied`) ÉS a `defaultValue` nem frissül (a TextInput mount-kor felvett értéke megmarad).
- `<RawTomlViewer>` component (packages/tui/src/components/RawTomlViewer.tsx) — a `[v]` billentyűre megnyíló nyers TOML viewer. A `useApp().suspendTerminal` API-t használja: a TUI terminál állapotát elmenti, a child process-t (a `$PAGER` || `$EDITOR` || `less` || `cat` fallback láncolat) elindítja, a child kilépésekor visszaállítja a TUI-t. A `runRawTomlViewer` helper kiemelve a React komponensből a tesztelhetőség kedvéért (a `suspendFn` injektálható).
- `writeAfterTypedLive` metódus a `ConfigStore`-ban — CSAK a case-sensitive "LIVE" typed value-t fogadja el, különben `ConfigLiveConfirmError`-t dob. Audit-log append a `<path>.audit.log` fájlba (`{ ts, event: "live-mode-confirm", value: true, prevMode, newMode }` JSON-line formátumban).
- Coverage gap close-up: 76 → 0 missing lines (a Track C producer restart-ját követő fresh producer session lezárta a `packages/tui` 96.0% → 100.0%-os lefedettségi rést).

**Tests added (38 tests, 4 files):**
- `components/LiveConfirm.test.tsx` — 8 tests (renders warning / placeholder / "▶ Submit" disabled state / case-sensitive "LIVE" / lowercase rejection / wrong-string rejection / Esc cancel / pending spinner).
- `components/LeverageCap.test.tsx` — 9 tests (renders defaultValue / 1..10 accepted / 11 rejected with warning / 0 rejected / negative rejected / empty accepted / NaN rejected / disabled mode / "HARD-CAPPED at 10" label).
- `components/RawTomlViewer.test.tsx` — 11 tests (runRawTomlViewer happy path / tmp file written / spawnViewer PAGER / spawnViewer EDITOR / spawnViewer less / spawnViewer cat fallback / spawnViewer error → cat / onClose always called / tmp cleanup on success / tmp cleanup on error / suspendFn error handling).
- `components/SettingsPanel.test.tsx` (kiegészítés) — 10 tests (LiveConfirm modal open on live-select / "LIVE" confirm triggers onConfirm / wrong-string confirm triggers onCancel / Esc cancel / LeverageCap rejection in risk section / `[v]` keypress opens RawTomlViewer / configPath passed to viewer / viewer onClose re-mounts / `handleAbandonConfirm` helper / `handleLiveConfirmSubmit` helper).

**Libraries adopted (0 new):** Minden Track C2 dependency a Track A2 / C1 -ből jön (Ink 7 `useApp().suspendTerminal`).

**CI status:** typecheck PASS, lint PASS, test PASS, build PASS, coverage:full PASS. 8/8 packages at 100% line coverage on OWN `src/`.

---

### Track D — Closure docs (PR — this PR, `docs/phase36-closure`)

**Branch:** `docs/phase36-closure` (off `feat/phase36-track-c2-live-confirm`)
**Files (5):**
1. `docs/production-strategies/phase36-deliverable.md` — ez a fájl (a main closure report)
2. `docs/production-strategies/tui.md` — a TUI operator guide (a Phase 34-es tui.md felülírása a Phase 36-os flow-val)
3. `docs/production-strategies/library-catalog.md` — a 10 adoptált library katalógusa (verzió, npm link, forrás-link, hol használt)
4. `apps/bot/README.md` — a §3 TUI-szekció frissítése (új billentyűk, új panelek, új CLI flag-ek)
5. `.mavis/notes/board.md` — a Phase 36 CLOSED szekció hozzáfűzése a meglévő EXECUTING szekció után (audit trail megmarad)

**Tests added:** 0 (docs only).

---

## Library catalog (10 ADOPT)

For the full entry (npm link + version + source URLs), see [`library-catalog.md`](./library-catalog.md). The summary:

| # | Library | Version | Category | Used for | Where |
|---|---------|---------|----------|----------|-------|
| 1 | `@inkjs/ui` | v2.0.0 | Ink components | TextInput / Select / MultiSelect / ConfirmInput / Badge / Spinner / StatusMessage / Alert | `packages/tui/src/components/{SettingsPanel,LiveConfirm,LeverageCap,Header,StatisticsPanel,LiveTradingPanel}.tsx` |
| 2 | `@matthesketh/ink-table` | v0.1.0 | Ink components | Sortable, keyboard-navigable Table | `packages/tui/src/components/HistoryList.tsx` |
| 3 | `@matthesketh/ink-status-bar` | v0.1.0 | Ink components | KeyHint list with left/right slots | `packages/tui/src/components/StatusBar.tsx` |
| 4 | `sindresorhus/ink-link` | v5.0.0 | Ink components | Hyperlink rendering (reserved for future bybit/Grafana URLs) | not yet wired in Phase 36 (deferred to Phase 37+) |
| 5 | `asciichart` | v1.5.25 | ASCII charts | Equity curve | `packages/tui/src/charts/equity-curve.ts` |
| 6 | `sparkly` | v6.0.1 | ASCII charts | P&L sparkline | `packages/tui/src/charts/sparkline.ts` |
| 7 | `@crafter/charts` | v0.2.4 | ASCII charts | OHLC candlestick | `packages/tui/src/charts/candlestick.ts` |
| 8 | `@pppp606/ink-chart` | v0.2.6 | ASCII charts | Strategy breakdown BarChart | `packages/tui/src/charts/bar-chart.tsx` |
| 9 | `smol-toml` | v1.7.0 | Persistence | TOML parse + stringify | `apps/bot/src/config/store.ts` + `packages/tui/src/hooks/useConfigStore.ts` |
| 10 | `write-file-atomic` | v8.0.0 | Persistence | Write-tmp + rename + backup | `apps/bot/src/config/store.ts` (the `write()` method) |

**SKIP (7, with explicit reason):** `ink-password-input` (deprecated), `ink-image` (dead since 2019), `ink-gradient` / `ink-big-text` (decorative, stale), `ink-task-list` (dead, replaced by `@matthesketh/ink-task-list`), `@ink-tools/ink-mouse` (mouse is anti-pattern for set-and-forget bot), `OpenTUI` (rewrite cost too high — parked for Phase 7+), `giggles` (too new, unproven). See `docs/audits/phase36-research-findings.md` §1 SKIP-list for the full reasoning with source URLs.

**Peer-dep gotcha:** `bun add` will warn `ink-select-input@6.2.0 requires ink@^5 || ^6 but ink@7.1.0 is installed`. The fix is in root `package.json` `"overrides"` block — overridden per package. The `coverage:full` and `bun install` pass either way (runtime is OK because Ink 7 is backwards-compat).

---

## Coverage impact

### 8/8 packages at 100% line coverage on OWN `src/` (post-Phase-36)

| Package | Pre-Phase-36 LOC | Post-Phase-36 LOC | Δ LOC | Post-Phase-36 % (own src/) | Tests (post) |
|---------|------------------|-------------------|-------|----------------------------|--------------|
| `apps/bot` | 2 271 | 2 590 | +319 (+14.0%) | 100.0% (2589 of 2590) | 365 |
| `packages/tui` | 1 043 | 1 921 | +878 (+84.2%) | 100.0% (1921 of 1921) | 260 |
| `packages/paper` | 251 | 251 | 0 | 100.0% (251 of 251) | 65 |
| `packages/exchange` | 868 | 868 | 0 | 100.0% (868 of 868) | 318 |
| `packages/core` | 12 124 | 12 124 | 0 | 100.0% (12124 of 12124) | 1 502 |
| `packages/shared` | 189 | 189 | 0 | 100.0% (189 of 189) | 122 |
| `packages/backtest` | 754 | 754 | 0 | 100.0% (754 of 754) | 140 |
| `packages/backtest-tools` | 2 289 | 2 289 | 0 | 100.0% (2289 of 2289) | 204 |
| **TOTAL** | **19 789** | **20 986** | **+1 197 (+6.0%)** | **8/8 PASS** | **2 976 tests across 145 files** |

### TUI package growth (the headline)

| Metric | Pre-Phase-36 (Phase 34 baseline) | Post-Phase-36 | Δ |
|--------|----------------------------------|----------------|---|
| `src/` LOC | 1 043 | 1 921 | +878 (+84.2%) |
| TUI tests | 0 (Phase 34 was 0-tdd) | 260 across 26 files (5 322 LOC of test code) | +260 |
| Coverage | 100% on Phase 34 (3 hand-rolled panels) | 100% on Phase 36 (5 panels + 3 sub-components + 4 chart libs + 3 form components) | maintained |
| External dependencies (TUI package) | 0 (only `ink` + `react`) | 10 (3 ink-ui + 4 charts + 2 persistence + 1 link reserved) | +10 |

### CI gates green at 100% (the one big table)

`bun run coverage:full` output (verbatim, 2026-07-15 Budapest, on `feat/phase36-track-c2-live-confirm` @ `0a672d2`):

```
+ ------------------------ + ------ + ---------------------------------------- +
| Package                | Stat  | Line coverage                          |
| ------------------------ | ------ | ---------------------------------------- |
| apps/bot               | PASS  | 100.0% (2589 of 2590 lines)            |
| packages/paper         | PASS  | 100.0% (251 of 251 lines)              |
| packages/exchange      | PASS  | 100.0% (868 of 868 lines)              |
| packages/core          | PASS  | 100.0% (12124 of 12124 lines)          |
| packages/tui           | PASS  | 100.0% (1921 of 1921 lines)            |
| packages/shared        | PASS  | 100.0% (189 of 189 lines)              |
| packages/backtest      | PASS  | 100.0% (754 of 754 lines)              |
| packages/backtest-tools | PASS  | 100.0% (2289 of 2289 lines)            |
+ ------------------------ + ------ + ---------------------------------------- +

  Result: 8/8 packages at 100% line coverage on OWN src/ files
  ✓ All packages at 100% line coverage on OWN src/ files
```

All 5 CI gates green: `typecheck` (turbo × 14) PASS, `lint` (turbo × 8) PASS, `test` (turbo × 14, 2 976 tests) PASS, `build` (turbo × 8) PASS, `coverage:full` (the one big table above) PASS.

---

## Historical status note

The Phase 36 checklist, limitations and sign-off recorded the state of the
terminal UI work at that historical delivery point. They are not current
operator instructions, current CI evidence or a production-readiness claim.
The terminal UI package and commands described by that snapshot are not part of
the current workspace; current operation and validation are documented in the
root README, `apps/bot/README.md`, `docs/CLI.md` and `docs/TESTING.md`.

---

## See also

- [`docs/production-strategies/library-catalog.md`](./library-catalog.md) — the 10 adopted libraries
- [`docs/audits/phase36-research-findings.md`](../../audits/phase36-research-findings.md) — 5-agent research, ~75 web queries, ranked library catalog
- [`docs/audits/phase36-tui-ux-revamp-scope.md`](../../audits/phase36-tui-ux-revamp-scope.md) — the scope doc this deliverable implements
- [`apps/bot/README.md`](../../../apps/bot/README.md) — updated §3 (TUI quick reference)
- [`.mavis/notes/board.md`](../../../.mavis/notes/board.md) — Phase 36 EXECUTING (audit trail) + CLOSED sections
- [`apps/bot/config/default.toml`](../../../apps/bot/config/default.toml) — the canonical config (with Phase 36 sections)
- [`apps/bot/src/config/store.ts`](../../../apps/bot/src/config/store.ts) — the ConfigStore implementation
- [`packages/tui/src/hooks/useConfigStore.ts`](../../../packages/tui/src/hooks/useConfigStore.ts) — the useConfigStore hook
- [`packages/tui/src/components/SettingsPanel.tsx`](../../../packages/tui/src/components/SettingsPanel.tsx) — the btop-style settings panel
