# Production strategies — TUI operator guide

> **Phase 36 deliverable.** Operator-facing reference for the
> **Ink-based TUI** that is the default UI of `mm-bot start`
> (per user mandate 2026-07-14 20:58 Budapest — Phase 36 user
> issue #1: "`mm-bot start` should NOT auto-start the bot. Default:
> TUI ready, bot in `stopped` state. User must press `[s]` to start.").
> Replaces the Phase 34 baseline (3 panels, no settings, auto-start) with
> the Phase 36 final (4 panels + btop-style settings panel, manual
> start, ASCII charts, 1:10 leverage cap, typed "LIVE" confirmation,
> alternate screen buffer, file+stderr logging).

The TUI is a pure read-only dashboard over `BotState`, EXCEPT in the
settings panel (opened with `[o]`), where the user can edit the TOML
config in-place. The 3-layer 1:10 leverage defense-in-depth is
unchanged.

---

## Table of contents

1. [Quick start](#1-quick-start)
2. [Operating modes](#2-operating-modes)
3. [Layout overview](#3-layout-overview)
4. [Panel reference](#4-panel-reference)
5. [Settings panel (`[o]`)](#5-settings-panel-o)
6. [Live-mode typed "LIVE" guard](#6-live-mode-typed-live-guard)
7. [Leverage cap (1:10 hard cap)](#7-leverage-cap-110-hard-cap)
8. [Raw TOML viewer (`[v]`)](#8-raw-toml-viewer-v)
9. [ASCII charts (4th panel)](#9-ascii-charts-4th-panel)
10. [Keybinding reference](#10-keybinding-reference)
11. [Color & TTY handling](#11-color--tty-handling)
12. [TUI-only mode (`mm-bot tui`)](#12-tui-only-mode-mm-bot-tui)
13. [Bundle guarantees](#13-bundle-guarantees)
14. [Troubleshooting](#14-troubleshooting)
15. [Pre-launch checklist](#15-pre-launch-checklist)
16. [See also](#16-see-also)

---

## 1. Quick start

The TUI is the **default** when you run `mm-bot start`. The bot is
**stopped** by default — press `[s]` to start it. Press `[q]` or `Ctrl-C`
for a graceful shutdown (the bot will flush state and close all open
positions per the configured shutdown handler).

```bash
# from the repo root
bun install
bun run build

# Start the TUI in stopped state (default, per Phase 36 user mandate)
mm-bot start

# Start the TUI in stopped state with a custom config
mm-bot start --config=config/prod.toml

# Start the TUI AND auto-start the bot (opt-in, pre-Phase 36 behavior)
mm-bot start --auto-start

# For non-interactive environments (CI, scripts, piped logs)
# NOTE: --headless IMPLIES --auto-start (no TUI to keep the bot paused)
mm-bot start --headless

# Open the TUI settings panel directly (one-shot, no bot startup)
mm-bot config edit --config=./mm-bot.toml

# Launch the TUI without starting the bot (UI/UX demo, TUI-only dev)
mm-bot tui
mm-bot tui --data-source=paper
mm-bot tui --seed=42
```

That's it. The TUI shows everything you need: positions, P&L,
kill-switch state, ticker feed, closed-trade history, AND a 4-panel
charts (equity curve, P&L sparkline, OHLC candlestick, strategy
breakdown BarChart). The settings panel lets you edit the TOML
config in-place with Zod re-validation, atomic write, and `.bak` backup.

---

## 2. Operating modes

The `mm-bot` binary exposes 5 TUI-related entry points (post-Phase 36):

| Mode | Command | Bot runs? | Use when |
|------|---------|-----------|----------|
| **TUI + bot (stopped default)** | `mm-bot start` | ❌ no (until `[s]`) | Interactive operator session; full observability + control |
| **TUI + bot, auto-start** | `mm-bot start --auto-start` | ✅ yes | Pre-Phase 36 behavior; opt-in for scripts that want full control |
| **Headless + bot** | `mm-bot start --headless` | ✅ yes (always) | CI, scripts, non-interactive shells, log aggregation. `--headless` implies `--auto-start` (no TUI to keep it paused) |
| **TUI only, no bot** | `mm-bot tui` | ❌ no | UI/UX demo, TUI-only dev, no real trading |
| **TUI + settings panel, no bot** | `mm-bot config edit` | ❌ no | Edit the TOML in-TUI without starting the bot |
| **TUI only, paper** | `mm-bot tui --data-source=paper` | ❌ no | Paper-trading engine behind the TUI; demo of full pipeline |

**Mode badge in the header:**
- `[LIVE]` (green) — `mm-bot start` mode, real bot behind the TUI
- `[● STOPPED]` (amber) — `mm-bot start` mode, bot in `stopped` state, waiting for `[s]`
- `[TUI-ONLY]` (red) — `mm-bot tui` mode, synthetic / paper provider, no trading
- `[PAUSED]` (yellow) — only shown when the bot is paused (mid-run)

### Flag reference

| Flag | Applies to | Effect |
|------|-----------|--------|
| `--config=<path>` | `start`, all subcommands | TOML config file (default: built-in defaults) |
| `--headless` / `--no-tui` | `start` | Disable TUI; plain text logs only. Implies `--auto-start`. |
| `--auto-start` | `start` (TUI mode) | Start the bot when the TUI opens (default: `false`) |
| `--no-auto-start` | `start` (TUI mode) | Force stopped state even if `[bot] auto_start = true` in config |
| `--no-color` / `--color=false` | all subcommands | Disable ANSI color codes (also: `NO_COLOR=1` env var) |
| `--data-source=<simulated\|paper>` | `tui` | Provider: `simulated` (default, PRNG-driven) or `paper` (real paper engine) |
| `--seed=<n>` | `tui` (simulated only) | PRNG seed for reproducible simulation |
| `--help` / `-h` | all subcommands | Show command-specific help |

### Precedence: `CLI > TOML > default (false)`

For `[bot] auto_start`:

1. CLI `--no-auto-start` flag → **false** (highest priority)
2. CLI `--auto-start` flag → **true** (second highest)
3. TOML `[bot] auto_start = true/false` → whatever the config says
4. Default → **false** (Phase 36 user mandate)

If both `--auto-start` and `--no-auto-start` are passed, the last one
wins (the parser's `Map.set` is last-write-wins).

---

## 3. Layout overview

The TUI uses a single-window layout — no split panes, no mouse support.
The vertical stack is:

```
+----------------------------------------------------------+
|  HEADER (mode badge, running state, kill-switch, clock)  |   ← always visible
+----------------------------------------------------------+
|  STATISTICS PANEL (PnL, win rate, DD, Sharpe, etc.)      |   ← panel 1 (Tab)
+----------------------------------------------------------+
|  LIVE TRADING PANEL (tickers, positions, ticker events)  |   ← panel 2 (Tab)
+----------------------------------------------------------+
|  HISTORY LIST (last 20 closed trades, sortable)          |   ← panel 3 (Tab)
+----------------------------------------------------------+
|  CHARTS PANEL (equity / candlestick / PnL / strategies)  |   ← panel 4 (Tab)
+----------------------------------------------------------+
|  STATUS BAR (keybinding hints + version)                 |   ← always visible
+----------------------------------------------------------+
```

The focused panel is highlighted with a brighter border. Use `Tab` /
`←` / `→` to cycle focus. The settings panel (`[o]`) REPLACES the
dashboard (Header + StatusBar remain visible).

When the bot is in `stopped` state (the Phase 36 default), a yellow
banner appears between the Header and the Statistics panel:

```
+----------------------------------------------------------+
|  ●  bot is idle — press [s] to start                    |   ← StoppedBanner
|  A bot jelenleg le van állítva. A `[s]` billentyűvel...  |
+----------------------------------------------------------+
```

---

## 4. Panel reference

### 4.1 Header

The topmost row. Always visible. Shows the bot's state at a glance.

```
+-- mm-crypto-bot TUI -- [LIVE] [● STOPPED] --- FUT  CSATLAKOZVA -- KILL-SWITCH: ÉLES -+
|  Frissítve: 12:34:56                                                                 |
+--------------------------------------------------------------------------------------+
```

**Phase 36 changes:**
- Mode badge uses `@inkjs/ui` `<Badge>` (color-coded, colorblind-safe)
- The `[● STOPPED]` badge is a Phase 36 Track A1 addition; visible only when `state.running === false` AND `mode === "with-bot"`
- All 4 badges (`[LIVE]`, `[● STOPPED]`, `[TUI-ONLY]`, `[PAUSED]`) are mutually exclusive

| Field | Values | Meaning |
|-------|--------|---------|
| Mode badge | `[LIVE]` (green) / `[TUI-ONLY]` (red) | `LIVE` = real bot behind the TUI; `TUI-ONLY` = synthetic provider, no trading |
| Stopped badge | `[● STOPPED]` (amber) | Only shown when `state.running === false` AND `mode === "with-bot"` |
| Pause badge | `[PAUSED]` (yellow) | Only shown when the bot is paused |
| Run state | `FUT` (green) / `LEÁLLÍTVA` (red) | Whether the bot is running or stopped |
| Connection | `CSATLAKOZVA` (green) / `NINCS KAPCSOLAT` (yellow) | Whether the exchange feed is connected |
| Kill-switch | `KILL-SWITCH: ÉLES` (gray) / `: MEGERŐSÍTÉS` (yellow) / `: AKTIVÁLVA` (red) | Kill-switch state |
| Last update | `Frissítve: HH:MM:SS` | Timestamp of the most recent state tick |

### 4.2 Statistics panel

Real metrics from the closed-trade list. Computed by the
provider (not in the panel) — the panel is pure render. **Phase 36
Track B1** replaced the title with `<StatusMessage variant="info">`.

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

**Empty state:** when no trades have closed yet, all numbers are
0.00 / 0% and the panel still renders.

### 4.3 Live trading panel

Three sub-sections: TICKEREK, NYITOTT POZÍCIÓK, UTOLSÓ TICKER-EVENT-EK.

**Phase 36 Track B1:** the "Connecting..." empty-state placeholder is
now `<Spinner label="Connecting..." />` from `@inkjs/ui`; the title
is `<StatusMessage variant="warning">`.

```
+-- 📈  ÉLŐ KERESKEDÉS -----------------------------------------+
|  TICKEREK                                                    |
|  BTC  65,432.10  +2.34%   ETH  3,512.40  +1.20%  SOL  142.5  -0.5%
|                                                                |
|  NYITOTT POZÍCIÓK (2 db)                                      |
|  ⚠  Kill-switch küszöb átlépve (PnL% < -10.0%)              |
|  +--- LONG  BTC  x10  qty: 0.015  Élettartam: 4m ---+         |
|  |  Belépő: 65,000.00  Jelenlegi: 64,500.00  PnL: -12.34 (-1.90%) |
|  +--------------------------------------------------------+    |
|  ... (more positions)                                       |
|                                                                |
|  UTOLSÓ TICKER-EVENT-EK (42 db a bufferben, legfrissebb 5)   |
+----------------------------------------------------------------+
```

### 4.4 History list

The last 20 closed trades, sortable by three keys (cycled with `[t]`).
**Phase 36 Track B1:** the hand-rolled table was replaced with
`<Table>` from `@matthesketh/ink-table` (8 columns, sortable, with
column alignment).

```
+-- 📜  HISTORY (LEZÁRT TRADE-EK) ----------------- Rendezve: IDŐ -+
|  ID     OLDAL  SYMBOL  BELÉPŐ       KILÉPŐ       PNL                OK      ZÁRVA   |
|  #1234  LONG   BTC     65,000.00    65,500.00    +45.20 (+0.69%)   TP       2m      |
|  #1233  SHORT  SOL     142.50       141.20       +12.10 (+0.85%)   STOP     5m      |
+--------------------------------------------------------------------+
```

**Note:** Table v0.1.0 doesn't support per-cell coloring. The LONG/SHORT
direction signal uses the `+`/`-` prefix in the PNL column (green for
`+`, red for `-`). See `Known limitations` §1.

### 4.5 Charts panel (4th panel — Phase 36 Track B2)

The 4th panel — added in Phase 36 Track B2. Contains 4 ASCII charts:

```
+-- 📊  CHARTS (EQUITY / CANDLESTICK / P&L / STRATEGIES) -----------+
|  EQUITY GÖRBE (utolsó 23 trade)                                   |
|  12.0k ┤                                       ╭─                |
|  11.5k ┤                              ╭───────╯                  |
|  11.0k ┤                  ╭───────────╯                          |
|  10.5k ┤       ╭──────────╯                                      |
|  10.0k ┤───────╯                                                 |
|        └────────────────────────────────────────────────────     |
|                                                                  |
|  OHLC CANDLESTICK (utolsó 1h)                                    |
|  ┌─┐ ╷ ┌─┐ ╵ ┌─┐  ...                                             |
|                                                                  |
|  P&L SPARKLINE (utolsó 16 trade)                                 |
|  ▁▂▃▅▆▇▆▅▃▂▁▂▃▅▇█                                             |
|                                                                  |
|  STRATÉGIA-BREAKDOWN (cap%)                                      |
|  donchian_pivot    ████████████░░░░  20%                        |
|  dydx_cex_carry    █░░░░░░░░░░░░░░  2.5%                        |
|  cascade_fade      █████░░░░░░░░░░  10%                        |
+------------------------------------------------------------------+
```

**Empty state:** when no trades have closed yet, "Még nincs chart-adat"
appears in each sub-section.

The 4 chart libraries are: `asciichart` (equity), `@crafter/charts`
(candlestick, 60-LOC hand-roll fallback), `sparkly` (P&L sparkline),
`@pppp606/ink-chart` (BarChart). See [§9](#9-ascii-charts-4th-panel)
for the detailed chart reference.

### 4.6 Status bar

The bottom row. Always visible. Shows the available keybindings and
the bot version. **Phase 36 Track B1:** the hand-rolled key-hint
list was replaced with `<StatusBar items={...} />` from
`@matthesketh/ink-status-bar`.

```
+-- [s] ▶ Start · [p] pause · [k] kill · [Tab] panel · [o] settings · [v] raw TOML · [t] rendezés · [r] frissít · [?] help · [q] kilép --- mm-crypto-bot · v0.1.0 -+
```

**Phase 36 changes:**
- The `[s] ▶ Start` hint (with the green ▶ arrow) is shown only in stopped state.
- `[o] settings` — open the btop-style settings panel (Phase 36 Track C1)
- `[v] raw TOML` — open the raw TOML viewer (Phase 36 Track C2)

---

## 5. Settings panel (`[o]`)

The Phase 36 Track C1 + C2 addition. A btop-style multi-section panel
where the user can edit the TOML config in-place.

### 5.1 Open / close

| Key | Action |
|-----|--------|
| `[o]` | Open the settings panel (replaces the dashboard) |
| `[Esc]` | Abandon changes (confirm if dirty) |
| `[Ctrl+S]` | Save the changes (Zod re-validate + atomic write + `.bak`) |
| `[Tab]` | Next section (cycles through 6) |
| `[Shift+Tab]` | Previous section |
| `[v]` | Open the raw TOML viewer (see [§8](#8-raw-toml-viewer-v)) |

### 5.2 Sections (6)

| # | Section | Editable? (Phase 36 scope) | Fields |
|---|---------|---------------------------|--------|
| 1 | **Strategies** | ❌ READ-ONLY (Phase 36 scope) | enabled / cap / leverage / symbols per strategy |
| 2 | **Risk** | ✅ EDITABLE | risk_per_trade, kelly_fraction, max_drawdown_pct, max_positions, **max_leverage** (hard-capped at 10) |
| 3 | **Bot** | ✅ EDITABLE | mode (paper/live — **typed "LIVE" confirm**), log_level, state_file |
| 4 | **Exchange** | ❌ READ-ONLY (Phase 36 scope) | id, rate_limit_ms, sandbox |
| 5 | **Symbols** | ❌ READ-ONLY (Phase 36 scope) | enabled list |
| 6 | **Telemetry** | ❌ READ-ONLY (Phase 36 scope) | log_dir, metrics_interval_sec |

**Phase 37+ scope:** per-strategy enable/disable toggle, exchange API key
fields, symbol list add/remove. Reserved for a future phase.

### 5.3 Save flow (atomic, audited)

When you press `Ctrl+S`:

1. The in-memory config object is serialized via `smol-toml.stringify`
2. Zod re-validates the serialized form (the Zod schema is the single source of truth — the form is just a UI binding)
3. Round-trip check: the serialized string is parsed again and re-validated (catches `smol-toml` data-loss bugs)
4. The previous config file is copied to `<path>.bak` (preserving the pre-save state)
5. The new config is written atomically via `write-file-atomic.sync` (write-tmp → rename, POSIX-atomic)
6. If `bot.mode = "live"` was set, an additional entry is appended to `<path>.audit.log` (JSON-line formátumban)

If step 2 or step 3 fails (Zod rejection), the save is aborted and
the field errors are displayed at the top of the panel. The user
fixes the field and retries.

### 5.4 Abandon flow

When you press `Esc` with `dirty` changes:

```
┌──────────────────────────────────────────────────────────┐
│  ⚠ Discard unsaved changes? [y]es / [n]o                 │
└──────────────────────────────────────────────────────────┘
```

- `y` — discard in-memory changes, return to the dashboard
- `n` or `Esc` — return to the settings panel with the changes intact

If NOT dirty (no changes were made), `Esc` immediately returns to the
dashboard without a confirm prompt.

### 5.5 What you can edit (and what you can't)

| Field | Editable? | Why |
|-------|-----------|-----|
| `[bot] mode` | ✅ (with typed "LIVE" guard) | The real-money toggle — guarded |
| `[bot] log_level` | ✅ | debug/info/warn/error, no real-world consequence |
| `[bot] state_file` | ❌ | Read-only (would require a bot restart) |
| `[bot] auto_start` | ✅ | Manual start preference |
| `[exchange] *` | ❌ | Read-only — API keys are in env vars (`BYBIT_API_KEY` / `BYBIT_API_SECRET`), not in TOML |
| `[risk] risk_per_trade` | ✅ | 0.001-0.05 Zod range |
| `[risk] kelly_fraction` | ✅ | 0-1 Zod range |
| `[risk] max_drawdown_pct` | ✅ | 0-1 Zod range |
| `[risk] max_positions` | ✅ | 1-12 Zod range |
| `[risk] max_leverage` | ✅ with **hard cap at 10** | The 1:10 leverage mandate — UI rejects > 10 |
| `[symbols] enabled` | ❌ | Read-only (would require a feed reconnect) |
| `[strategies.X] enabled` | ❌ | Read-only (Phase 36 scope) |
| `[strategies.X] cap/leverage/...` | ❌ | Read-only (Phase 36 scope) |
| `[telemetry] *` | ❌ | Read-only (logging behavior, requires restart) |

---

## 6. Live-mode typed "LIVE" guard

The `bot.mode = "live"` switch is **irreversible** (it places real
orders with real money). The `<LiveConfirm>` modal is the
`kubectl delete --all` style typed-confirmation (per Phase 36 research
§3).

### 6.1 Trigger

Navigate to the **Bot** section in the settings panel, then use the
`<Select>` to choose `live`:

```
  mode       (●) paper  ( ) live
```

Selecting `live` opens the `<LiveConfirm>` modal. The actual
`bot.mode = "live"` is NOT applied until the user types "LIVE" and
presses Enter.

### 6.2 The modal

```
┌─ ⚠ LIVE MODE ─────────────────────────────────────────────┐
│  Switching to LIVE will place REAL ORDERS with REAL MONEY. │
│                                                            │
│  This action is logged to: logs/bot/bot-audit.log          │
│                                                            │
│  Type LIVE (uppercase) below to confirm.                  │
│                                                            │
│  ▌ Type LIVE to confirm...                                │
│                                                            │
│  [Esc Cancel]                              [  Submit]    │
└────────────────────────────────────────────────────────────┘
```

### 6.3 What counts as a valid confirmation

| User types | Presses Enter | Result |
|------------|---------------|--------|
| `LIVE` (exactly, uppercase, 4 chars) | Enter | ✅ Confirm — `bot.mode = "live"` set, audit-log entry written |
| `live` (lowercase) | Enter | ❌ Cancel — modal closes, no change |
| `LIV` (typo / partial) | Enter | ❌ Cancel — modal closes, no change |
| ` LIVE` (leading space) | Enter | ❌ Cancel — modal closes, no change |
| `Live` (mixed case) | Enter | ❌ Cancel — modal closes, no change |
| (anything) | `Esc` | ❌ Cancel — modal closes, no change |

The validation is **case-sensitive, exact match**. No fuzzy matching,
no Levenshtein tolerance, no "did you mean". The user must type
exactly the 4 characters `LIVE` in uppercase.

### 6.4 Audit log

Every successful typed-"LIVE" confirm writes a JSON-line entry to
`<mm-bot.toml path>.audit.log`:

```json
{"ts":"2026-07-15T10:42:31.123Z","event":"live-mode-confirm","value":true,"prevMode":"paper","newMode":"live"}
```

The audit log is append-only. The user can inspect it with
`cat mm-bot.toml.audit.log | jq` (or any JSON-aware tool) to see
the full history of live-mode confirmations.

### 6.5 Why a typed confirmation (not y/N)?

Per the Phase 36 research (citing kubectl RFC + clig.dev UX
authority), a `y/N` prompt is too easy to misfire — an accidental
Enter on a default-highlighted `Y` is enough to flip to live mode.
A typed "LIVE" requires the user to think about what they're doing
before pressing Enter. The 4-character string is short enough to
type quickly but long enough to be deliberate.

---

## 7. Leverage cap (1:10 hard cap)

The 1:10 leverage mandate is enforced at **4 independent layers**
(defense-in-depth):

| Layer | Where | When | What it rejects |
|-------|-------|------|-----------------|
| **L0** UI | `<LeverageCap>` wrapper in `SettingsPanel.tsx` | User types in the `max_leverage` field | Any value outside `1..10`; the `defaultValue` is preserved (not overwritten) |
| **L1** Schema | `apps/bot/src/config/schema.ts:risk.max_leverage` | Config load | `risk.max_leverage > 10` (Zod `.max(10)`) |
| **L2** Pre-place | `apps/bot/src/bot/order-manager.ts` | Every `placeOrder` | Total notional > equity × maxLeverage at the moment of dispatch |
| **L3** Post-fill | `apps/bot/src/bot/position-manager.ts` | Every `recordFill` | Total notional > equity × maxLeverage after the position is recorded |

### 7.1 How the UI cap works

The `<LeverageCap>` component wraps a `<TextInput>`:

```tsx
<LeverageCap
  value={risk.max_leverage ?? MAX_LEVERAGE}    // MAX_LEVERAGE = 10
  max={MAX_LEVERAGE}                           // default 10
  onChange={(num) => setData({ ...risk, max_leverage: num })}
/>
```

When the user types a value:

| User types | Result |
|------------|--------|
| `1` to `10` | ✅ `onChange` is called with the parsed number |
| `0` (zero) | ❌ `onChange` is NOT called; inline warning `⚠ value out of range [1..10] — not applied` |
| `11` to `99` | ❌ same as above |
| `100` (or any 3-digit number > 10) | ❌ same as above |
| `-5` (negative) | ❌ same as above |
| `1.5` (non-integer) | ❌ `onChange` is NOT called (the wrapper uses `Number.parseInt`); the value is rejected |
| empty | The `defaultValue` (10) is preserved |
| non-numeric (e.g. `abc`) | ❌ `onChange` is NOT called; `defaultValue` preserved |

The wrapper uses `defaultValue` (not `value`) intentionally — once
the user enters an invalid value, the `defaultValue` doesn't update,
so the `<TextInput>` always shows the last VALID value. This is the
critical "no silent overwrite" property: invalid input is rejected
at the UI layer without changing the underlying state.

### 7.2 Defense-in-depth principle

A single layer can be bypassed by a refactor, a config typo, or a
runtime bug. Four layers mean a single bug is caught by the other
three. The L0 (UI) layer is the **first** line of defense — the
user can't even type a bad value into the form. The L1 (Zod)
layer is the **second** — even if L0 is bypassed (e.g. by editing
the TOML directly), the schema rejects the bad value. The L2 / L3
layers are the **last** line of defense — even if the config is
loaded with a bad value somehow, the order pipeline refuses to
place the order.

### 7.3 How to verify

1. **UI:** open settings, navigate to Risk section, try to type `15` in `max_leverage`. Verify the warning appears, the value is NOT saved.
2. **Zod:** edit `mm-bot.toml` directly to `max_leverage = 15`, run `mm-bot config validate`. Verify "max_leverage: must be ≤ 10" error.
3. **Order pipeline:** in a unit test, call `placeOrder` with a notional that exceeds 10× equity. Verify the `OrderManagerError` / `LeverageBreachError` is thrown.

---

## 8. Raw TOML viewer (`[v]`)

A "what does my TOML actually look like" viewer. Opens the TOML
file in your `$PAGER` (or `$EDITOR` or `less` or `cat` fallback)
via Ink 7's `suspendTerminal` API.

### 8.1 Open / close

| Key | Action |
|-----|--------|
| `[v]` (in settings panel) | Open the raw TOML viewer |
| Child process exit | Close the viewer (TUI re-renders) |

The viewer shell-out chain:

1. `$PAGER` (e.g. `less`, `more`) — if set
2. `$EDITOR` (e.g. `vim`, `nano`) — if `$PAGER` is not set
3. `less` — if neither is set (default on Linux/Mac)
4. `cat` — fallback if `less` is not installed

The child process is spawned with `stdio: "inherit"`, so the
terminal is fully released to the child. Ink's `suspendTerminal`
saves the TUI state, hands the terminal to the child, and restores
the TUI state when the child exits.

### 8.2 Read-only

The viewer is **read-only**. If you edit the file in the child
process, the changes are NOT picked up by the TUI — the in-memory
config is the source of truth for the settings panel. To apply
edits made in the viewer, exit the viewer, then `Ctrl+S` to save
the in-memory state.

If you DO want to edit the file, do it in the settings panel (the
`[o]` path), not in the viewer. The viewer is for "let me see the
raw TOML" — a debugging aid.

### 8.3 What if no pager / editor / less is installed?

The `cat` fallback always works. The TOML is printed to stdout.
This is non-interactive (you can't scroll, you can't search), but
the file content is visible. Press `Enter` to return to the TUI.

---

## 9. ASCII charts (4th panel)

The `<ChartsPanel>` (Phase 36 Track B2) is the 4th dashboard panel,
reachable via `Tab` cycling (or directly with `c`).

### 9.1 The 4 chart types

| Chart | Library | Width × Height | Empty state |
|-------|---------|----------------|-------------|
| **Equity curve** | `asciichart` v1.5.25 | 60 × 6 | "Még nincs equity-adat" |
| **OHLC candlestick** | `@crafter/charts` v0.2.4 (60-LOC hand-roll fallback) | 40 × 8 | "Még nincs candlestick-adat" |
| **P&L sparkline** | `sparkly` v6.0.1 | 16 unicode bars | "Még nincs P&L-adat" |
| **Strategy breakdown** | `@pppp606/ink-chart` v0.2.6 | Variable | "Még nincs strategy-adat" |

### 9.2 How the data flows

- **Equity curve:** `computeEquitySeries(history, initialEquityUsdt)` — starts at `initialEquityUsdt` (10 000 USDT default), adds the cumulative P&L of each closed trade in chronological order.
- **P&L sparkline:** `computePnlSeries(history)` — the per-trade P&L values, in chronological order.
- **OHLC candlestick:** currently `candles={[]}` (empty) — a future phase will feed the real OHLC stream from the bot's exchange provider. The chart code is ready; the data is the only piece waiting.
- **Strategy breakdown:** `strategies={[]}` (empty) — the `app/bot` side will populate this in a future phase with the per-strategy cap% + enabled state.

### 9.3 Why 4 different libraries?

Each library is a single-purpose, well-maintained npm package.
The combo covers 4 visually distinct chart types with minimal
bundle bloat (~70 KB total). See [`library-catalog.md`](./library-catalog.md)
for the full ADOPT list with source URLs.

The `@crafter/charts` (candlestick) library is 3 months old with
1 contributor — a 60-LOC hand-roll fallback is shipped in
`packages/tui/src/charts/__fallback__/` for emergency swap. The
consumer (`candlestick.ts`) auto-detects at import time which one
to use; no user-visible difference between the two implementations.

### 9.4 When to use the Charts panel

- After the bot has been running for a while, glance at the equity curve to see the trend
- Compare per-strategy P&L via the breakdown bar chart
- Watch the P&L sparkline for momentum (a series of green bars = good run, a series of red bars = bad run)
- The candlestick is a future feature (once the OHLC feed is wired)

---

## 10. Keybinding reference

Master keybinding table. Mode-specific behavior is noted in the
"Available in" column.

| Key | Action | Available in | Notes |
|-----|--------|--------------|-------|
| `[q]` | Quit TUI (graceful: stops bot if running) | All modes | Equivalent to pressing the close button |
| `Ctrl-C` | Same as `[q]` | All modes | Caught at the process level too |
| `[s]` | Start / stop the bot | `start` mode | Toggles the bot's running state. TUI-only mode: N/A. |
| `[p]` | Pause / resume the bot | `start` mode | Toggles the paused flag (no order cancellation) |
| `[k]` | Open kill-switch confirm prompt | `start` mode | Only when running + kill-switch `armed` |
| `[i]` / `[y]` | Confirm kill-switch (in confirm state) | `start` mode | Closes all open positions immediately |
| `[n]` / `[q]` / `[Esc]` | Cancel kill-switch (in confirm state) | `start` mode | Returns to `armed` state |
| `[o]` | Open settings panel | `start` mode (and `mm-bot config edit`) | REPLACES the dashboard. Header + StatusBar remain visible. |
| `[v]` | Open raw TOML viewer | `start` mode (in settings panel) | Uses `suspendTerminal` to shell out to `$PAGER` |
| `[Tab]` | Cycle focused panel forward | All modes | statistics → live → history → charts → statistics |
| `[→]` | Same as `[Tab]` | All modes | |
| `[←]` | Cycle focused panel backward | All modes | statistics → charts → history → live → statistics |
| `[c]` | Jump to Charts panel | All modes | Direct shortcut for the 4th panel |
| `[t]` | Cycle history sort key | All modes | time → pnl → symbol → time |
| `[r]` | Manual refresh (re-render now) | All modes | Useful if the renderer stalled (shouldn't happen) |
| `[?]` | Toggle help overlay | All modes | |
| `[Esc]` | Close help overlay (if open) / abandon settings | All modes | In settings panel: triggers abandon-confirm if dirty |
| `Ctrl+S` | Save settings | Settings panel | Zod re-validate + atomic write + `.bak` |
| `LIVE` + `Enter` | Confirm live-mode switch | `<LiveConfirm>` modal | Case-sensitive, exact match |
| `Esc` | Cancel `<LiveConfirm>` modal | `<LiveConfirm>` modal | Closes the modal, no change |

**Mode detection:** the TUI detects its mode by inspecting
`BotState.status.mode`:
- `"with-bot"` — `mm-bot start`; all keys available
- `"tui-only"` — `mm-bot tui`; only display + sort + help keys

The mode is also visible in the header badge.

---

## 11. Color & TTY handling

The TUI is designed to work in three environments: a real terminal
(color ON, TUI fully interactive), a piped / logged shell
(color OFF, layout preserved), and a CI / non-TTY environment
(color OFF, prefer `--headless` mode).

### 11.1 Color sources (priority high → low)

1. **CLI flag** — `--no-color` (or `--color=false`) on the command line. Always wins. Implemented in `apps/bot/src/index.ts` and `commands/start.ts`, `commands/tui.ts`. Sets `process.env.NO_COLOR = "1"` before any TUI import.
2. **Environment variable** — `NO_COLOR=1` (the de-facto standard, https://no-color.org). Ink respects this natively.
3. **TTY auto-detect** — when stdout is NOT a TTY (piped, redirected, or spawned with `Bun.spawn({ stdout: "pipe" })`), `picocolors`'s `isColorSupported` is `false` and ANSI codes are not emitted. This handles the common case automatically.

### 11.2 Per-environment matrix

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
disables color. The flag exists for explicit user intent and for
environments where `isTTY` returns `true` but the user still wants
clean text (e.g. a terminal that records sessions and you want the
log file to be parseable).

### 11.3 Alternate screen buffer

The TUI uses Ink 7's `alternateScreen: true` option — the TUI
draws into the alternate screen buffer, NOT the main scrollback.
This is the standard TUI behavior (vim, less, htop, btop, lazygit,
k9s all use it). The effect:

- **While the TUI is running:** the terminal's main scrollback
  shows whatever was there before the TUI started. The TUI's
  output is in the alternate buffer, which is invisible until
  the TUI exits.
- **On TUI exit:** the alternate buffer is discarded, and the
  main scrollback is restored. The user sees the prompt / log
  output that was there before the TUI started.

This means: you can scroll up in your terminal AFTER the TUI
exits and see what you were doing before. The TUI does not pollute
your scrollback. The TUI is also flicker-free — the log lines
that used to appear on the TUI surface (the Phase 36 user
issue #2) are gone, because the logs go to stderr (or to a file),
NOT to stdout (where the TUI draws).

### 11.4 `patchConsole: false`

The Ink `render` is called with `patchConsole: false`. This
disables Ink's `console.log` / `console.error` override. Why?
The `createLogger` (Phase 36 Track A2) is now designed to write
directly to `process.stderr` (or to a file) — it does NOT use
`console.log`. If `patchConsole` were enabled and a library
called `console.log`, the patch would re-route the output to
stdout (the TUI render surface) — which is exactly the bug
Phase 36 fixed. `patchConsole: false` is a defense-in-depth
against regressions: if any library slips a `console.log` past
us, the output goes to stdout (not the TUI), and the user can
see it in their terminal scrollback (not in the TUI dashboard).

---

## 12. TUI-only mode (`mm-bot tui`)

The TUI can be launched without starting the bot. This is useful
for:

- **UI/UX demo:** show the TUI to a stakeholder without needing
  a real bot running.
- **TUI-only development:** iterate on the TUI code without
  paying the cost of bot startup / feed connection.
- **Paper-trading preview:** `mm-bot tui --data-source=paper`
  boots the paper-trading engine behind the TUI — full state
  updates from the paper engine, no real bot lifecycle.

### 12.1 Two providers

| `--data-source` | Provider | Description |
|-----------------|----------|-------------|
| `simulated` (default) | `SimulatedProvider` | PRNG-driven synthetic tick stream (1 Hz). No network, no real market data. Useful for visual demos. |
| `paper` | `PaperProvider` | The real paper-trading engine. Boots the in-tree paper-trade simulator. Falls back to simulated on construction failure (with a warning). |

### 12.2 Reproducible simulation

`mm-bot tui --seed=42` (simulated only) sets the PRNG seed so
the synthetic price-walk is deterministic. Same seed → same
price evolution. Useful for visual regression testing or for
demoing a specific scenario.

### 12.3 What the TUI shows in TUI-only mode

- `[TUI-ONLY]` badge in the header (red) instead of `[LIVE]`
- No `[● STOPPED]` badge (no bot to be stopped)
- `[s]` / `[p]` / `[k]` keys are disabled (no bot to control)
- All other keys work as in with-bot mode (Tab, t, r, ?, q, o is N/A — settings panel requires a config path)
- The Live trading panel shows synthetic positions / tickers
  driven by the provider's PRNG

### 12.4 Exit

Press `[q]` or `Ctrl-C`. The TUI unmounts, the provider disposes,
and the process exits with code 0.

---

## 13. Bundle guarantees

The TUI is implemented in `packages/tui/` (a workspace package)
and is consumed by `apps/bot/` via the workspace dependency
`@mm-crypto-bot/tui`. The bundle has the following guarantees:

| Guarantee | Where verified | What it means |
|-----------|---------------|---------------|
| TUI is dynamic-imported in headless mode | `apps/bot/src/cli/commands/start.ts:runTui()` | `--headless` does NOT pull in `ink` / `react` |
| TUI is dynamic-imported in TUI-only mode | `apps/bot/src/cli/commands/tui.ts` | `mm-bot tui` only needs TUI code, not bot code |
| `Bot.subscribe()` is a thin pub/sub | `apps/bot/src/bot/bot.ts` | TUI never mutates bot state; the bridge (`LiveBotStateProvider`) only reads |
| 3-layer leverage defense unchanged | `apps/bot/src/bot/{order-manager,position-manager}.ts` | TUI integration does not touch position management |
| State file unchanged | `apps/bot/src/bot/state-store.ts` | TUI uses the same persistence layer as headless mode |
| Settings panel goes through ConfigStore | `apps/bot/src/config/store.ts` | The settings panel NEVER writes to the TOML directly — only via the Zod-validated + atomic-write ConfigStore |
| 1:10 leverage UI cap (`<LeverageCap>`) | `packages/tui/src/components/LeverageCap.tsx` | The settings panel UI rejects leverage > 10 before the value reaches the config |

The TUI consumes ~1 921 LOC across ~30 source files
(`packages/tui/src/{App.tsx,components/*,providers/*,hooks/*,utils/*,charts/*}`)
plus the dynamic-import bridge in `apps/bot/src/tui/`. None of
this code modifies position management or order placement (the
only write path is the settings panel → ConfigStore, which is
Zod-validated + atomic).

---

## 14. Troubleshooting

### 14.1 TUI is stuck at "● STOPPED"

**Symptom:** The TUI is open, the yellow "bot is idle — press `[s]`
to start" banner is showing, but `[s]` does nothing.

**Causes:**
- TUI-only mode (`mm-bot tui`) — there is no bot to start, the
  `[s]` key is disabled. The header shows `[TUI-ONLY]` (red).
- The Ink `useInput` hook is not receiving the keypress. Try
  focusing the terminal window and re-pressing.

**Fix:** verify the header badge. If it says `[TUI-ONLY]`, you
need `mm-bot start` (not `mm-bot tui`). If it says `[LIVE]`,
focus the terminal and try again.

### 14.2 "Mm-bot.toml not found"

**Symptom:** The settings panel shows `⚠ I/O error: Failed to read
config file at "./mm-bot.toml": ENOENT...`

**Fix:** the file is missing. Run `mm-bot config init --out=./mm-bot.toml`
to scaffold a starter config (it copies `apps/bot/config/default.toml`).
Then open the settings panel again.

### 14.3 "Invalid TOML" / "Zod validation failed"

**Symptom:** `mm-bot config validate` returns 2 with a "Config
validation FAILED" error.

**Fix:** the TOML has a syntax error or a value outside the Zod
range. The error message lists the offending field(s):

```
Config validation FAILED:
  • risk.max_leverage: Number must be less than or equal to 10
  • bot.mode: Invalid enum value. Expected 'paper' | 'live', received 'PROD'
```

Edit the file, re-run `mm-bot config validate`, repeat until OK.

### 14.4 `[v]` opens an empty `$PAGER` / child exits immediately

**Symptom:** Pressing `[v]` in the settings panel opens the raw
TOML viewer, but the child process exits immediately without
showing the file.

**Causes:**
- Your `$PAGER` / `$EDITOR` is set to a non-interactive command
  (e.g. `cat`, `true`, `head`).
- The child is `less` and the terminal is not interactive (e.g.
  you're running the bot via `nohup`).

**Fix:** unset `$PAGER` / `$EDITOR` and let the TUI fall back
to `less` / `cat`. Or set `$PAGER` to a known-good value
(e.g. `less -SR` for syntax-highlighted scrollable view).

### 14.5 The leverage input rejects everything I type

**Symptom:** The `max_leverage` field in the Risk section
shows "⚠ value out of range [1..10] — not applied" no matter
what I type.

**Fix:** the `<LeverageCap>` wrapper only accepts integers in
`[1, 10]`. Type a single-digit integer (e.g. `5`), not a float
(e.g. `1.5`), not a percentage (e.g. `5%`), not a string (e.g.
`five`). The wrapper uses `Number.parseInt` — anything else is
rejected.

### 14.6 The "LIVE" guard rejects my input

**Symptom:** I type `live` (lowercase) + Enter in the
`<LiveConfirm>` modal, the modal closes, but `bot.mode` is
still "paper".

**Fix:** the typed confirmation is **case-sensitive, exact
match**. Type `LIVE` (uppercase, 4 characters, no leading /
trailing whitespace). The submit button only enables when the
typed value is exactly `LIVE` — any other value, even `Live`
or `LIVE ` (trailing space), closes the modal without changing
the config.

### 14.7 The settings panel won't save (`Ctrl+S` does nothing)

**Symptom:** Pressing `Ctrl+S` in the settings panel triggers
no save — no error, no progress indicator.

**Causes:**
- The settings panel was opened from `mm-bot tui` (TUI-only
  mode) — there's no consumer save callback registered.
- The TUI's `useInput` hook is not receiving the `Ctrl+S`
  keypress (rare; try focusing the terminal).

**Fix:** the settings panel only saves when opened from
`mm-bot start` (or `mm-bot config edit`), not from `mm-bot tui`.
If you opened it from `mm-bot tui`, exit (`[q]`) and re-open
from `mm-bot start` or `mm-bot config edit`.

---

## 15. Pre-launch checklist

For the user to verify before going live. Each item is one concrete
action. (Copy of the deliverable's pre-launch checklist — kept
here for the operator guide's self-contained nature.)

1. **Review PR #105 in browser** — open `https://github.com/<owner>/mm-crypto-bot/pull/105`, scroll through the file diffs, confirm the 3 new components (LiveConfirm / LeverageCap / RawTomlViewer) and the 1 new hook (useConfigStore) match the Phase 36 spec.
2. **Squash-merge PR #105 + close PR #104 as superseded** — the C1 work landed in #105 via `merge: Track C1 (settings panel + ConfigStore) into Track C2` (576ea55), so #104 is now redundant.
3. **Run `mm-bot start` (default: bot stopped)** — the TUI should open with a yellow `● bot is idle — press [s] to start` banner. Press `[s]` to start the bot; the banner disappears and the panels populate.
4. **Run `mm-bot start --headless` (auto-starts via `--headless`)** — this is the CI/nohup path. Should auto-start, plain text logs to stderr, exit 0 on SIGINT.
5. **Open settings panel `[o]` → edit a value → `[Ctrl+S]` to save → verify `.bak` + tmp handling** — e.g. change `risk.risk_per_trade` from 0.01 to 0.02, save, then `cat mm-bot.toml.bak` and verify the previous value is preserved.
6. **Try to set leverage > 10** — open settings, navigate to Risk section, type `15` in the `max_leverage` field. Verify the input does NOT propagate, the inline warning `⚠ value out of range [1..10] — not applied` appears, and the `defaultValue` remains the previous valid value.
7. **Try to switch `bot.mode = "live"`** — open settings, navigate to Bot section, select `live` from the `<Select>`. Verify the `<LiveConfirm>` modal opens with the warning header. Type `live` (lowercase) + Enter → verify the modal closes without changing mode. Re-open, type `LIV` (typo) + Enter → same. Re-open, type `LIVE` (uppercase) + Enter → verify the `bot.mode = "live"` is set and `mm-bot.toml.audit.log` has a new JSON-line entry.
8. **Press `[v]` to view raw TOML** — verify the suspendTerminal shell-out works (the terminal is released, your `$PAGER` / `$EDITOR` / `less` / `cat` takes over; on exit, the TUI is restored). If no `$PAGER` / `$EDITOR` / `less` is installed, the `cat` fallback prints the file to stdout.
9. **Validate config: `mm-bot config validate`** — verify the `OK` (green) output and the brief summary line (`mode: paper, exchange: bybiteu, max_leverage: 10`).
10. **Once user signs off, flip `bot.mode = "live"` in the new TUI** — the typed "LIVE" guard is the only thing standing between paper and real-money; per the project policy, the user is the one who runs this. Confirm `mm-bot start --config=config/prod.toml` boots, the audit log entry is written, and the kill-switches are armed.

---

## 16. See also

- [`docs/production-strategies/phase36-deliverable.md`](./phase36-deliverable.md) — the main Phase 36 closure report
- [`docs/production-strategies/library-catalog.md`](./library-catalog.md) — the 10 adopted libraries
- [`docs/production-strategies/bot.md`](./bot.md) — how the production strategies wire into the bot
- [`docs/audits/phase36-research-findings.md`](../../audits/phase36-research-findings.md) — 5-agent research, ~75 web queries, ranked library catalog
- [`docs/audits/phase36-tui-ux-revamp-scope.md`](../../audits/phase36-tui-ux-revamp-scope.md) — the scope doc this operator guide implements
- [`apps/bot/README.md`](../../../apps/bot/README.md) — operator guide (quick start, full CLI reference, live testing workflow)
- [`apps/bot/config/default.toml`](../../../apps/bot/config/default.toml) — self-documenting config (every field has an inline comment)
- [`apps/bot/src/config/store.ts`](../../../apps/bot/src/config/store.ts) — the ConfigStore implementation
- [`packages/tui/src/components/SettingsPanel.tsx`](../../../packages/tui/src/components/SettingsPanel.tsx) — the btop-style settings panel
- [`packages/tui/src/components/LiveConfirm.tsx`](../../../packages/tui/src/components/LiveConfirm.tsx) — the typed "LIVE" modal
- [`packages/tui/src/components/LeverageCap.tsx`](../../../packages/tui/src/components/LeverageCap.tsx) — the 1:10 leverage UI cap
- [`packages/tui/src/components/RawTomlViewer.tsx`](../../../packages/tui/src/components/RawTomlViewer.tsx) — the suspendTerminal shell-out
- [`.mavis/notes/phase36-research-doctrine.md`](../../../.mavis/notes/) — research methodology (per the project memory doctrine)
- [`.mavis/notes/board.md`](../../../.mavis/notes/board.md) — project board (Phase 36 EXECUTING + CLOSED sections)
