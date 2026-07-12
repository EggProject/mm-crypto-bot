# Production strategies — TUI reference

> **Phase 34 deliverable.** Operator-facing reference for the
> **Ink-based TUI** that is the default UI of `mm-bot start` (per user
> mandate 2026-07-12 02:00 Budapest — original spec §4.3 "Modern TUI
> felület, kötelező"). The TUI is a pure read-only dashboard over
> `BotState`; it never writes to position management or to the order
> pipeline. The 3-layer 1:10 leverage defense-in-depth is
> unchanged.

---

## Table of contents

1. [Quick start](#1-quick-start)
2. [Operating modes](#2-operating-modes)
3. [Layout overview](#3-layout-overview)
4. [Panel reference](#4-panel-reference)
   - [4.1 Header](#41-header)
   - [4.2 Statistics panel](#42-statistics-panel)
   - [4.3 Live trading panel](#43-live-trading-panel)
   - [4.4 History list](#44-history-list)
   - [4.5 Status bar](#45-status-bar)
   - [4.6 Help overlay](#46-help-overlay)
5. [Keybinding reference](#5-keybinding-reference)
6. [Color & TTY handling](#6-color--tty-handling)
7. [TUI-only mode (`mm-bot tui`)](#7-tui-only-mode-mm-bot-tui)
8. [Bundle guarantees](#8-bundle-guarantees)
9. [Limitations](#9-limitations)
10. [See also](#10-see-also)

---

## 1. Quick start

The TUI is the **default** when you run `mm-bot start`. Press `[q]`
or `Ctrl-C` inside the TUI for a graceful shutdown (the bot will
flush state and close all open positions per the configured
shutdown handler).

```bash
# from the repo root
bun install
bun run build

# Start the bot with the default TUI (paper mode by default)
mm-bot start

# Start with a custom config
mm-bot start --config=config/prod.toml

# For non-interactive environments (CI, scripts, piped logs)
mm-bot start --headless

# Launch the TUI without starting the bot (UI/UX demo)
mm-bot tui

# Launch the TUI with synthetic data (reproducible)
mm-bot tui --seed=42
```

That's it. The TUI shows everything you need: positions, P&L,
kill-switch state, ticker feed, and a closed-trade history. All
updates are realtime — no polling, no refresh button required.

---

## 2. Operating modes

The `mm-bot` binary exposes two TUI-related entry points:

| Mode | Command | Bot runs? | Use when |
|------|---------|-----------|----------|
| **TUI + bot (default)** | `mm-bot start` | ✅ yes | Interactive operator session; full observability + control |
| **TUI + bot, no color** | `mm-bot start --no-color` | ✅ yes | Piped / logged TUI; ANSI stripped, layout preserved |
| **Headless + bot** | `mm-bot start --headless` | ✅ yes | CI, scripts, non-interactive shells, log aggregation |
| **Headless + bot, no color** | `mm-bot start --headless --no-color` | ✅ yes | `nohup`-style background, clean text logs |
| **TUI only, simulated** | `mm-bot tui` | ❌ no | UI/UX demo; TUI-only dev; reproducible with `--seed` |
| **TUI only, paper** | `mm-bot tui --data-source=paper` | ❌ no | Paper-trading engine behind the TUI; demo of full pipeline |
| **TUI only, with seed** | `mm-bot tui --seed=42` | ❌ no | Deterministic simulation (replay a specific run) |

**Mode badge in the header:** the `[LIVE]` (green) badge indicates
the TUI is wired to a real bot; the `[TUI-ONLY]` (red) badge
indicates the TUI is showing a synthetic / paper provider with
no real bot behind it.

### Flag reference

| Flag | Applies to | Effect |
|------|-----------|--------|
| `--config=<path>` | `start`, all subcommands | TOML config file (default: built-in defaults) |
| `--headless` / `--no-tui` | `start` | Disable TUI; plain text logs only. Bundle excludes `ink`/`react`. |
| `--no-color` / `--color=false` | all subcommands | Disable ANSI color codes (also: `NO_COLOR=1` env var) |
| `--data-source=<simulated\|paper>` | `tui` | Provider: `simulated` (default, PRNG-driven) or `paper` (real paper engine) |
| `--seed=<n>` | `tui` (simulated only) | PRNG seed for reproducible simulation |
| `--help` / `-h` | all subcommands | Show command-specific help |

---

## 3. Layout overview

The TUI uses a single-window layout — no split panes, no mouse
support (yet). The vertical stack is:

```
+----------------------------------------------------------+
|  HEADER (mode badge, running state, kill-switch, clock)  |
+----------------------------------------------------------+
|  STATISTICS PANEL (PnL, win rate, DD, Sharpe, etc.)      |
+----------------------------------------------------------+
|  LIVE TRADING PANEL (tickers, positions, ticker events)  |
+----------------------------------------------------------+
|  HISTORY LIST (last 20 closed trades, sortable)          |
+----------------------------------------------------------+
|  STATUS BAR (keybinding hints + version)                 |
+----------------------------------------------------------+
```

The focused panel is highlighted with a brighter border. Use
`[Tab]` / `[←]` / `[→]` to cycle focus.

---

## 4. Panel reference

### 4.1 Header

The topmost row. Always visible. Shows the bot's state at a
glance.

```
+-- mm-crypto-bot TUI -----------------------  FUT  CSATLAKOZVA -+
|  mm-crypto-bot TUI  ·  [LIVE]                            FUT  ·  CSATLAKOZVA  |
|  KILL-SWITCH: ÉLES                          Frissítve: 12:34:56              |
+------------------------------------------------------------------------+
```

Fields:

| Field | Values | Meaning |
|-------|--------|---------|
| Mode badge | `[LIVE]` (green) / `[TUI-ONLY]` (red) | `LIVE` = real bot behind the TUI; `TUI-ONLY` = synthetic provider, no trading |
| Pause badge | `[PAUSED]` (yellow) | Only shown when the bot is paused |
| Run state | `FUT` (green) / `LEÁLLÍTVA` (red) | Whether the bot is running or stopped |
| Connection | `CSATLAKOZVA` (green) / `NINCS KAPCSOLAT` (yellow) | Whether the exchange feed is connected |
| Kill-switch | `KILL-SWITCH: ÉLES` (gray) / `: MEGERŐSÍTÉS` (yellow) / `: AKTIVÁLVA` (red) | Kill-switch state |
| Last update | `Frissítve: HH:MM:SS` | Timestamp of the most recent state tick |
| Engine error | `⚠ Motor hiba: <message>` (yellow) | Shown only if the engine reports an error |

### 4.2 Statistics panel

Real metrics from the closed-trade list. Computed by the
provider (not in the panel) — the panel is pure render.

```
+-- 📊  STATISZTIKA --------------------------------------------+
|  Összesített PnL:        Win rate:        Trade-szám:       |
|  +1,234.56 USDT  +12.34%  73.16%         2660 db            |
|  Max drawdown:           Aktuális DD:     Profit factor:    |
|  4.64%                   0.12%            10.44             |
|  Átlagos nyereség:       Átlagos veszteség:  Sharpe ratio:  |
|  +120.50 USDT            -45.20 USDT         20.51          |
|  Equity (jelenlegi):     Kezdő equity:     Nyert / Vesztett:|
|  11,234.56 USDT          10,000.00 USDT     1947 / 713      |
+----------------------------------------------------------------+
```

Fields:

| Field | Source | Notes |
|-------|--------|-------|
| Összesített PnL | `Σ closed.pnlUsdt` | USDT + % of initial equity |
| Win rate | `winningTrades / totalTrades` | Rounded to 0.1% |
| Trade-szám | `totalTrades` | Total closed trades |
| Max drawdown | Peak-to-trough of equity curve | The worst historical drawdown |
| Aktuális DD | Equity vs equity peak | Live indicator; color: <5% gray, 5-10% yellow, >10% red |
| Profit factor | `Σ wins / Σ |losses|` | ∞ if no losses |
| Átlagos nyereség / veszteség | Mean of winning / losing trades | Per-trade average |
| Sharpe ratio | Mean / stddev of trade returns | Annualized |
| Equity (jelenlegi) | Current `BotState.equityUsdt` | Live |
| Kezdő equity | `initialEquityUsdt` (default 10,000 USDT) | From config |
| Nyert / Vesztett | Counts | Green / red |

**Empty state:** when no trades have closed yet, all numbers are
0.00 / 0% and the panel still renders (the bot has just started).

### 4.3 Live trading panel

The biggest panel. Three sub-sections:

1. **TICKEREK** — top-of-book for each enabled symbol
2. **NYITOTT POZÍCIÓK** — all open positions, with kill-switch
   flash if a position breaches the threshold
3. **UTOLSÓ TICKER-EVENT-EK** — the last 5 ticker events in
   reverse-chronological order

```
+-- 📈  ÉLŐ KERESKEDÉS -----------------------------------------+
|  TICKEREK                                                    |
|  BTC  65,432.10  +2.34%   ETH  3,512.40  +1.20%  SOL  142.5  -0.5%
|                                                                |
|  NYITOTT POZÍCIÓK (2 db)                                      |
|  ⚠  Kill-switch küszöb átlépve (PnL% < -10.0%)              |
|  +--- LONG  BTC  x10  qty: 0.015  Élettartam: 4m ---+         |
|  |  Belépő: 65,000.00  Jelenlegi: 64,500.00  PnL: -12.34 (-1.90%) |
|  |  SL: 64,000.00     TP: 66,000.00                          |
|  +--------------------------------------------------------+    |
|  ... (more positions)                                       |
|                                                                |
|  UTOLSÓ TICKER-EVENT-EK (42 db a bufferben, legfrissebb 5)   |
|  SORSZÁM  SYMBOL  LAST PRICE  VOLUME      ÉLETKOR             |
|  #0042   BTC     65,432.10   1,234,567   2s                  |
|  #0041   ETH     3,512.40    567,890     8s                  |
|  ...                                                          |
+----------------------------------------------------------------+
```

**Kill-switch flash:** if any open position's
`unrealizedPnlPct` falls below the configured threshold
(default -10%), that position's row turns red and shows the
`⚠ KILL-SWITCH KÜSZÖB!` warning. The panel header also shows
the global warning. Press `[k]` to trigger the kill-switch
(confirm with `[i]` / `[n]`).

**Empty state:** when there are no open positions, the panel
shows "Jelenleg nincs nyitott pozíció." in italic gray.

**Ticker-event stream:** the bot emits a `TickerEvent` on every
exchange tick. The panel keeps the last N events in a buffer
(default 100) and displays the 5 most recent. Each row shows
the sequence number (monotonically increasing), symbol, last
price, volume, and age since the event was emitted.

### 4.4 History list

The last 20 closed trades, sortable by three keys (cycled with
`[t]`):

```
+-- 📜  HISTORY (LEZÁRT TRADE-EK) ----------------- Rendezve: IDŐ -+
|  ID     OLDAL  SYMBOL  BELÉPŐ       KILÉPŐ       PNL                OK      ZÁRVA   |
|  #1234  LONG   BTC     65,000.00    65,500.00    +45.20 (+0.69%)   TP       2m      |
|  #1233  SHORT  SOL     142.50       141.20       +12.10 (+0.85%)   STOP     5m      |
|  ...                                                              |
+--------------------------------------------------------------------+
```

Fields:

| Field | Source | Notes |
|-------|--------|-------|
| ID | Last 4 chars of `trade.id` | Truncated for display; full ID in the state file |
| OLDAL | `LONG` (green) / `SHORT` (red) | Trade direction |
| SYMBOL | `trade.symbol` (USDT stripped) | E.g. `BTC`, not `BTC/USDT` |
| BELÉPŐ | `trade.entryPrice` | Entry price |
| KILÉPŐ | `trade.exitPrice` | Exit price |
| PNL | `trade.pnlUsdt` + `trade.pnlPct` | USDT and % of position size |
| OK | `trade.reason` | `STOP` / `TP` / `TIMEOUT` / `KILL-SWITCH` / `SIGNAL` |
| ZÁRVA | `now - trade.closedAt` | How long ago the trade closed |

**Sort keys:**

- `IDŐ` (default) — most recent first, by `closedAt` descending
- `PNL` — biggest winners first, by `pnlUsdt` descending
- `SYMBOL` — alphabetical by symbol; within a symbol, by time

**Truncation:** only the 20 most recent (per current sort) are
shown; if there are more, a footer line shows "... és még N
korábbi trade (a teljes listát lásd a log-ban).". The full
history is always available via `mm-bot trades --limit=N`.

### 4.5 Status bar

The bottom row. Always visible. Shows the available
keybindings and the bot version.

```
+-- [s] start/stop  ·  [p] pause  ·  [k] kill  ·  [Tab] panel  ·  [t] rendezés  ·  [r] frissít  ·  [?] help  ·  [q] kilép --- mm-crypto-bot · v0.1.0 -+
```

In TUI-only mode (no bot behind the TUI), the `[s]`, `[p]`,
and `[k]` hints are hidden — there is no bot to control.

**Kill-switch confirm state:** when the user presses `[k]`, the
status bar is replaced with a red-bordered confirmation
prompt:

```
+-- ⚠  VÉSZLEÁLLÍTÁS — Biztosan leállítod az összes nyitott pozíciót? -- [i] igen  ·  [n] nem -+
```

### 4.6 Help overlay

Toggled with `[?]`. Renders as a centered overlay on top of all
panels. Lists every keybinding with a short description in
Hungarian. Press `[?]`, `[Esc]`, or `[q]` to close.

```
+-- ❓  HELP (TUI-ONLY MÓD) ----------------------------------------+
|  [q] / Ctrl-C    Kilépés (graceful)                              |
|  [Tab] / [←→]    Panel fókusz váltása                            |
|  [t]             History rendezési kulcs váltása (IDŐ/PNL/SYMBOL) |
|  [r]             Manuális frissítés                               |
|  [?]             Help overlay megjelenítése / elrejtése           |
|  [Esc]           Help overlay bezárása                            |
+-----------------------------------------------------------------+
```

The header changes between "TUI-ONLY MÓD" and "MMBOT MÓD"
depending on whether a real bot is wired in.

---

## 5. Keybinding reference

Master keybinding table. Mode-specific behavior is noted in
the "TUI-only?" column.

| Key | Action | TUI-only? | Notes |
|-----|--------|-----------|-------|
| `[q]` | Quit TUI (graceful: stops bot if running) | ✅ | Equivalent to pressing the close button |
| `Ctrl-C` | Same as `[q]` | ✅ | Caught at the process level too |
| `[s]` | Start / stop the bot | ❌ | Toggles the bot's running state |
| `[p]` | Pause / resume the bot | ❌ | Toggles the paused flag (no order cancellation) |
| `[k]` | Open kill-switch confirm prompt | ❌ | Only when running + kill-switch `armed` |
| `[i]` / `[y]` | Confirm kill-switch (in confirm state) | ❌ | Closes all open positions immediately |
| `[n]` / `[q]` / `[Esc]` | Cancel kill-switch (in confirm state) | ❌ | Returns to `armed` state |
| `[Tab]` | Cycle focused panel forward | ✅ | statistics → live → history → statistics |
| `[→]` | Same as `[Tab]` | ✅ | |
| `[←]` | Cycle focused panel backward | ✅ | statistics → history → live → statistics |
| `[t]` | Cycle history sort key | ✅ | time → pnl → symbol → time |
| `[r]` | Manual refresh (re-render now) | ✅ | Useful if the renderer stalled (shouldn't happen) |
| `[?]` | Toggle help overlay | ✅ | |
| `[Esc]` | Close help overlay (if open) | ✅ | Does nothing if overlay is closed |

**Mode detection:** the TUI detects its mode by inspecting
`BotState.status.mode`:
- `"with-bot"` — `mm-bot start`; all keys available
- `"tui-only"` — `mm-bot tui`; only display + sort + help keys

The mode is also visible in the header badge.

---

## 6. Color & TTY handling

The TUI is designed to work in three environments: a real
terminal (color ON, TUI fully interactive), a piped / logged
shell (color OFF, layout preserved), and a CI / non-TTY
environment (color OFF, prefer `--headless` mode).

### 6.1 Color sources (priority high → low)

1. **CLI flag** — `--no-color` (or `--color=false`) on the
   command line. Always wins. Implemented in
   `apps/bot/src/cli/index.ts` and `commands/start.ts`,
   `commands/tui.ts`. Sets `process.env.NO_COLOR = "1"` before
   any TUI import.
2. **Environment variable** — `NO_COLOR=1` (the de-facto
   standard, https://no-color.org). Ink respects this
   natively.
3. **TTY auto-detect** — when stdout is NOT a TTY (piped,
   redirected, or spawned with `Bun.spawn({ stdout: "pipe" })`),
   `picocolors`'s `isColorSupported` is `false` and ANSI codes
   are not emitted. This handles the common case automatically.

### 6.2 Per-environment matrix

| Environment | TTY? | NO_COLOR set? | Flag? | Result |
|-------------|------|---------------|-------|--------|
| Interactive terminal | ✅ | ❌ | ❌ | **Color ON** |
| Interactive terminal | ✅ | ❌ | `--no-color` | Color OFF |
| Interactive terminal | ✅ | `NO_COLOR=1` | ❌ | Color OFF |
| `mm-bot start \| tee log.txt` | ❌ | ❌ | ❌ | Color OFF (auto) |
| `mm-bot start \| tee log.txt` | ❌ | ❌ | `--color` | Color ON (force) |
| `bun script.ts` (Bun.spawn pipe) | ❌ (undefined) | ❌ | ❌ | Color OFF (auto) |
| CI runner (GitHub Actions etc.) | ❌ | ❌ | `--no-color` | Color OFF (defense-in-depth) |

**Note:** the `--no-color` flag is **defense-in-depth**. In the
common case (piped / redirected output), `picocolors` already
disables color. The flag exists for explicit user intent and
for environments where `isTTY` returns `true` but the user
still wants clean text (e.g. a terminal that records sessions
and you want the log file to be parseable).

### 6.3 Bundle guarantee (headless mode)

When you run `mm-bot start --headless`, the `@mm-crypto-bot/tui`
package is **dynamically imported** only in the TUI branch.
This is verified by `apps/bot/src/cli/headless-no-ink.test.ts`:

1. **Static source check:** `grep "from '@mm-crypto-bot/tui'"
   apps/bot/src/cli/commands/start.ts` returns the import ONLY
   inside a `await import(...)` call, never at top level.
2. **`bun build --external` check:** the headless build output
   does not include `ink` or `react` in its bundle.
3. **Subprocess check:** spawning `mm-bot start --headless` and
   inspecting the loaded modules confirms neither `ink` nor
   `react` are loaded.

The result: `--headless` ships ~30% smaller binaries and has
zero TUI overhead at runtime.

---

## 7. TUI-only mode (`mm-bot tui`)

The TUI can be launched without starting the bot. This is
useful for:

- **UI/UX demo:** show the TUI to a stakeholder without needing
  a real bot running.
- **TUI-only development:** iterate on the TUI code without
  paying the cost of bot startup / feed connection.
- **Paper-trading preview:** `mm-bot tui --data-source=paper`
  boots the paper-trading engine behind the TUI — full state
  updates from the paper engine, no real bot lifecycle.

### 7.1 Two providers

| `--data-source` | Provider | Description |
|-----------------|----------|-------------|
| `simulated` (default) | `SimulatedProvider` | PRNG-driven synthetic tick stream (1 Hz). No network, no real market data. Useful for visual demos. |
| `paper` | `PaperProvider` | The real paper-trading engine. Boots the in-tree paper-trade simulator. Falls back to simulated on construction failure (with a warning). |

### 7.2 Reproducible simulation

`mm-bot tui --seed=42` (simulated only) sets the PRNG seed so
the synthetic price-walk is deterministic. Same seed → same
price evolution. Useful for:

- **Visual regression testing:** snapshot the TUI frame at
  tick N for two seed values and assert they match.
- **Demoing a specific scenario:** run with a seed that
  produced an interesting price-walk in the past.

### 7.3 What the TUI shows in TUI-only mode

- `[TUI-ONLY]` badge in the header (red) instead of `[LIVE]`
- `[s]` / `[p]` / `[k]` keys are disabled (no bot to control)
- All other keys work as in with-bot mode (Tab, t, r, ?, q)
- The `Live trading panel` shows synthetic positions / tickers
  driven by the provider's PRNG

### 7.4 Exit

Press `[q]` or `Ctrl-C`. The TUI unmounts, the provider
disposes, and the process exits with code 0.

---

## 8. Bundle guarantees

The TUI is implemented in `packages/tui/` (a workspace package)
and is consumed by `apps/bot/` via the workspace dependency
`@mm-crypto-bot/tui`. The bundle has the following
guarantees:

| Guarantee | Where verified | What it means |
|-----------|---------------|---------------|
| TUI is dynamic-imported in headless mode | `apps/bot/src/cli/commands/start.ts:212` (inside `runTui()`) | `--headless` does NOT pull in `ink` / `react` |
| TUI is dynamic-imported in TUI-only mode | `apps/bot/src/cli/commands/tui.ts:117` | `mm-bot tui` only needs TUI code, not bot code |
| `Bot.subscribe()` is a thin pub/sub | `apps/bot/src/bot/bot.ts` | TUI never mutates bot state; the bridge (`LiveBotStateProvider`) only reads |
| 3-layer leverage defense unchanged | `apps/bot/src/bot/{order-manager,position-manager}.ts` | TUI integration does not touch position management |
| State file unchanged | `apps/bot/src/bot/state-store.ts` | TUI uses the same persistence layer as headless mode |

The TUI consumes ~1500 LOC across 7 source files
(`packages/tui/src/{App.tsx,components/*,providers/*,hooks/*,utils/*}`)
plus the dynamic-import bridge in `apps/bot/src/tui/`. None of
this code modifies position management or order placement.

---

## 9. Limitations

- **No mouse support.** The TUI is keyboard-only. The spec did
  not require mouse support; Ink supports it but it is not
  wired up. (Future work.)
- **No split panes / multi-window.** Single-window vertical
  stack. The spec did not require multi-window layouts.
- **No persistent layout.** Terminal resize re-flows the
  layout; the layout is not saved between sessions.
- **No plugin system for panels.** Adding a new panel requires
  editing `App.tsx`. (Future work if/when more panels are
  needed.)
- **Ink TUI only.** The headless / plain-text mode is not
  interactive. Operators who need both an interactive UI and
  log-file persistence should run `mm-bot start` in one shell
  and `tee` the logs to a file (color is auto-stripped on
  non-TTY stdout).
- **No concurrent multi-symbol PnL breakdown.** The Statistics
  panel shows portfolio-aggregate numbers. Per-symbol PnL is
  available via `mm-bot trades --symbol=BTC/USDC`.
- **TUI does not respect `--log-level`.** All TUI updates are
  rendered regardless of `log_level` config. The log level
  only affects the headless-mode logger.

---

## 10. See also

- [`apps/bot/README.md`](../../apps/bot/README.md) — operator
  guide (quick start, full CLI reference, live testing
  workflow)
- [`apps/bot/config/default.toml`](../../apps/bot/config/default.toml) —
  self-documenting config (every field has an inline comment)
- [`docs/production-strategies/bot.md`](../../docs/production-strategies/bot.md) —
  how the 5 production strategies wire into the bot
- [`.mavis/notes/phase34-tui-scope-plan.md`](../../.mavis/notes/phase34-tui-scope-plan.md) —
  Phase 34 design + scope
- [`.mavis/notes/board.md`](../../.mavis/notes/board.md) —
  project board (Phase 34 closure section)
- [Project `README.md`](../../README.md) — top-level project
  docs
