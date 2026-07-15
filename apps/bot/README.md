# mm-bot

The production runtime of the [mm-crypto-bot](../../) project — a single-binary
crypto trading bot for the **bybit.eu** SPOT-margin venue (paper-mode via the
in-tree paper-trade simulator, live-mode via CCXT).

This README is the **operator-facing** documentation: quick start, configuration,
CLI reference, manual live-testing workflow, and architectural overview. The
self-documenting [`config/default.toml`](./config/default.toml) carries the
canonical schema reference (every section + every field + Zod constraints).

> **Phase 36 status (2026-07-15):** ✅ TUI UX revamp landed via 6 PRs
> (#100, #101, #102, #103, #104, #105). The Ink-based **TUI is the
> default UI** for `mm-bot start` (Phase 34 baseline, 2026-07-12) +
> Phase 36 additions: **bot in `stopped` state on launch** (user
> presses `[s]` to start), **no log lines in the TUI surface**
> (logger rewired to file+stderr, Ink 7 `alternateScreen`),
> **richer visuals** (`@inkjs/ui` + `@matthesketh/ink-table` +
> `@matthesketh/ink-status-bar` + 4 ASCII chart libraries + 4th
> `Charts` panel), **interactive settings panel** (`[o]` opens
> btop-style multi-section config editor, `[Ctrl+S]` saves with
> Zod re-validate + atomic write + `.bak`, `[Esc]` abandons,
> `[v]` opens raw TOML viewer via `suspendTerminal` shell-out).
> See [`docs/production-strategies/phase36-deliverable.md`](../../docs/production-strategies/phase36-deliverable.md)
> for the full Track D closure report, and
> [`docs/production-strategies/tui.md`](../../docs/production-strategies/tui.md)
> for the post-Phase-36 TUI operator guide. **Live trading is still
> gated on the user manually running the workflow in §7.**

---

## Table of contents

1. [Quick start](#1-quick-start)
2. [Configuration](#2-configuration)
3. [CLI reference](#3-cli-reference)
4. [Strategy enable / disable](#4-strategy-enable--disable)
5. [1:10 leverage mandate](#5-110-leverage-mandate)
6. [Live testing](#6-live-testing)
7. [Live testing workflow (manual)](#7-live-testing-workflow-manual)
8. [Architecture](#8-architecture)
9. [Coverage](#9-coverage)
10. [Limitations](#10-limitations)
11. [Phase 36 pre-launch checklist](#11-phase-36-pre-launch-checklist)

---

## 1. Quick start

```bash
# from the repo root
bun install
bun run build           # builds apps/bot/dist/index.js (the `mm-bot` binary)

# Smoke test: load + validate the default config (no exchange call)
mm-bot config validate

# Inspect the effective config (defaults + file + env merged)
mm-bot config show

# Run the bot in PAPER mode (no real money, uses internal paper-trade sim).
# **Default mode is the Ink TUI** (per Phase 34 user mandate 2026-07-12).
# **Default state: bot STOPPED** (per Phase 36 user mandate 2026-07-14,
# issue #1) — the TUI opens with a yellow "● bot is idle" banner, and
# the user presses [s] to start the bot. Press [q] or Ctrl-C inside
# the TUI for graceful shutdown.
mm-bot start

# Or, opt into the pre-Phase 36 behavior (bot auto-starts with the TUI):
mm-bot start --auto-start

# Or, for non-interactive environments (CI, scripts, piped logs).
# NOTE: --headless IMPLIES --auto-start (no TUI to keep the bot paused).
mm-bot start --headless

# Open the TUI settings panel directly (one-shot, no bot startup):
mm-bot config edit --config=./mm-bot.toml
```

That's it. With the default config the bot runs in **paper mode** on the mock
feed (no network calls). The TUI is the default operator experience; see
§3.3 for TUI-specific quick start, `docs/production-strategies/tui.md` for
the full TUI reference, and §7 for real bybit.eu paper/live testing.

### What `mm-bot start` does

1. Loads + Zod-validates the config (`config/default.toml` by default).
2. Instantiates the enabled strategies (via `createStrategyInstances`).
3. Constructs `OrderManager`, `PositionManager`, `StateStore`,
   `Telemetry`, and `KillSwitchRegistry`.
4. Subscribes to the configured exchange feed.
5. Dispatches each LTF bar to every active strategy's `onCandle(ctx)`.
6. Pipes emitted `StrategySignal`s through the order pipeline
   (sizing → leverage-invariant check → `feed.placeOrder`).
7. On SIGINT / SIGTERM: gracefully shuts down, finalizes state file.

State is persisted to `data/bot-state.json` (path is configurable). Restart
the bot and it resumes from the last snapshot.

---

## 2. Configuration

**One TOML file drives the whole bot.** Defaults live in
[`config/default.toml`](./config/default.toml). The file is **self-documenting**
— every section + every field has an inline comment explaining the units, the
constraints, and the rationale.

### 2.1 Merge order

When `loadBotConfig(path?)` runs, the effective config is built in three layers
(later wins):

```
  ┌──────────────────────────────────────────────────────────────┐
  │  1. Zod-derived defaults        (apps/bot/src/config/defaults.ts)
  │  2. TOML file (if --config=PATH)  (config/default.toml)
  │  3. Environment overrides        (BUN_ENV, LOG_LEVEL, BYBIT_*)
  └──────────────────────────────────────────────────────────────┘
```

This means: copy the default file, edit the fields you want to change, point
the bot at it with `--config=`. The Zod schema rejects any field outside
`[0.001, 0.05]` etc. — invalid configs are refused at startup with a clear
error list.

### 2.2 Schema (6 sections)

| Section | Purpose |
|---------|---------|
| `[bot]` | `mode` (paper\|live), `log_level`, `state_file` |
| `[exchange]` | `id` (bybiteu\|mock), `rate_limit_ms`, `sandbox` |
| `[risk]` | `risk_per_trade`, `kelly_fraction`, `max_drawdown_pct`, `max_positions`, **`max_leverage` (1:10 MANDATE)** |
| `[symbols]` | `enabled` — CCXT unified format, e.g. `"BTC/USDC"` |
| `[strategies.<name>]` | `enabled` + per-strategy overrides (cap, leverage, symbols, timeframes, ...) |
| `[telemetry]` | `log_dir`, `metrics_interval_sec` |

The full annotated schema is in `config/default.toml`. **Read that file as
the canonical reference** — the comments there are kept in sync with the Zod
schema in `apps/bot/src/config/schema.ts`.

### 2.3 Forward compatibility

The `StrategySectionSchema` uses Zod `.passthrough()`, so new
strategy-specific fields can be added (in a future phase) without breaking
existing TOML files. The strategy-registry factory reads the `.passthrough()`
fields verbatim and applies them at construction time.

---

## 3. CLI reference

The `mm-bot` binary has 8 subcommands (hand-rolled argv parser — no external
CLI deps). All subcommands accept `--config=<path>` (default: built-in
defaults) and `--help` / `-h`.

| Subcommand | Purpose | Example |
|------------|---------|---------|
| `start` | Start the bot + render the **Ink TUI** (default; see §3.3) | `mm-bot start --config=config/prod.toml` |
| `tui` | Render the TUI **without** starting the bot (UI/UX demo, TUI-only dev) | `mm-bot tui --data-source=simulated` |
| `status` | Show persisted state (positions, P&L, counters) | `mm-bot status` |
| `config validate` | Load + validate config; print OK or errors | `mm-bot config validate --config=config/prod.toml` |
| `config show` | Print effective config (defaults + file + env) | `mm-bot config show` |
| `config init` | Scaffold a new config file | `mm-bot config init --out=config/prod.toml` |
| `strategies` | List configured strategies + on/off state | `mm-bot strategies` |
| `trades` | Show recent closed trades (filterable by symbol) | `mm-bot trades --limit=20 --symbol=BTC/USDC` |
| `kill-switches` | Show kill-switch registry state | `mm-bot kill-switches` |
| `help` | Show help | `mm-bot help` |

### 3.1 Exit codes

All subcommands return POSIX-style exit codes:

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Runtime error (unknown subcommand, state file not found, etc.) |
| `2` | Config validation failure |

CI-friendly: no prompts, no TUI, deterministic output.

### 3.2 Example invocations

```bash
# Validate a custom config before launching the bot with it
mm-bot config validate --config=config/prod.toml

# Show what the bot will actually load (after defaults + file + env merge)
mm-bot config show --config=config/prod.toml

# Scaffold a fresh config (writes the canonical default.toml to a new path)
mm-bot config init --out=config/prod.toml

# Run the bot with that config
mm-bot start --config=config/prod.toml

# Observe while the bot is running (in a separate shell)
mm-bot status
mm-bot strategies
mm-bot trades --limit=10
mm-bot kill-switches

# On shutdown (SIGINT to the start process), the state file is flushed.
# You can re-inspect it any time:
mm-bot status
mm-bot trades --limit=50
```

### 3.3 The TUI (Phase 34 + Phase 36) — `mm-bot start` default UI

`mm-bot start` runs the **Ink TUI** by default (per user mandate
2026-07-12 02:00 Budapest — original spec §4.3 "Modern TUI felület,
kötelező"). **Per Phase 36 (2026-07-14)**, the bot is in `stopped`
state when the TUI opens — the user presses `[s]` to start it.
The TUI is the operator dashboard: it shows positions, P&L,
kill-switch state, live ticker feed, closed-trade history, AND
(Phase 36 Track B2) a 4th `Charts` panel with equity curve,
P&L sparkline, OHLC candlestick, and strategy breakdown BarChart.
See [`docs/production-strategies/tui.md`](../../docs/production-strategies/tui.md)
for the full post-Phase-36 keybinding + panel reference.

**Quick reference:**

| Invocation | Mode | Use when |
|------------|------|----------|
| `mm-bot start` | **TUI + bot STOPPED** (default) | Interactive operator session; press `[s]` to start |
| `mm-bot start --auto-start` | **TUI + bot running** | Opt-in to pre-Phase 36 behavior; bot auto-starts |
| `mm-bot start --no-auto-start` | **TUI + bot STOPPED** (forced) | Force stopped state even if `[bot] auto_start = true` |
| `mm-bot start --headless` | **Plain text logs + bot running** | CI, scripts, non-interactive shells (implies `--auto-start`) |
| `mm-bot start --no-color` | **TUI + bot, no ANSI** | Piped / logged TUI; `NO_COLOR=1` also works |
| `mm-bot start --headless --no-color` | **Clean text logs** | `nohup`-style background, log aggregation |
| `mm-bot tui` | **TUI, no bot** | UI/UX demo, TUI-only dev, no real trading |
| `mm-bot tui --data-source=paper` | **TUI + paper engine, no bot** | Paper-trading UI demo |
| `mm-bot config edit` | **TUI settings panel, no bot** | Edit `mm-bot.toml` in-TUI without starting the bot |

**Keybindings (TUI mode, post-Phase 36):**

| Key | Action |
|-----|--------|
| `[q]` / `Ctrl-C` | Quit the TUI (graceful: stops the bot if running) |
| `[s]` | Start / stop the bot (TUI-only mode: N/A; shows `▶ Start` hint in stopped state) |
| `[p]` | Pause / resume the bot (TUI-only mode: N/A) |
| `[k]` | Kill-switch (confirm with `[i]` / `[n]`) |
| `[o]` | **Open settings panel** (Phase 36 Track C1; replaces the dashboard; `[Tab]` sections, `[Ctrl+S]` save, `[Esc]` abandon) |
| `[v]` | **Open raw TOML viewer** (Phase 36 Track C2; only in settings panel; uses Ink 7 `suspendTerminal` to shell out to `$PAGER` / `$EDITOR` / `less` / `cat`) |
| `[Tab]` / `[←]` / `[→]` | Cycle focused panel (Statistics ↔ Live ↔ History ↔ Charts) |
| `[c]` | Jump to Charts panel (direct shortcut) |
| `[t]` | Cycle history sort key (time / pnl / symbol) |
| `[r]` | Manual refresh (re-render now) |
| `[?]` | Toggle help overlay |

**Settings panel (Phase 36 Track C1 + C2):**

The `[o]` key opens a btop-style multi-section config editor
(replaces the dashboard; Header + StatusBar remain visible). The
6 sections are: Strategies (READ-ONLY), Risk (EDITABLE), Bot
(EDITABLE — `mode` requires typed "LIVE" confirm), Exchange
(READ-ONLY), Symbols (READ-ONLY), Telemetry (READ-ONLY). Save
with `Ctrl+S` (Zod re-validate + atomic write + `.bak`); abandon
with `Esc` (confirm if dirty). The `risk.max_leverage` field has
a hard cap at 10 (1:10 leverage mandate, 4-layer defense in depth).
The `bot.mode = "live"` switch opens a `<LiveConfirm>` modal that
requires typing the exact string "LIVE" (case-sensitive, 4 chars)
+ Enter to confirm; the audit log entry is written to
`<mm-bot.toml path>.audit.log`. See
[`docs/production-strategies/tui.md` §5-8](../../docs/production-strategies/tui.md)
for the full settings panel walkthrough.

**Bundle guarantee:** in `--headless` mode the `@mm-crypto-bot/tui`
package (and its `ink` / `react` dependencies) is **not loaded** —
verified by `apps/bot/src/cli/headless-no-ink.test.ts` (3 tests:
static source check, `bun build --external`, subprocess runtime
check). The TUI is only required for the TUI and the TUI-with-bot
modes.

**Color policy:** ANSI codes are emitted by default in both TUI
and headless modes. Disable via `--no-color` (CLI flag) or
`NO_COLOR=1` (env var, Ink-native). TTY auto-detect: when stdout
is not a TTY (e.g. `Bun.spawn({ stdout: "pipe" })`, redirected
to a file, piped to `less` / `grep`), color is automatically
disabled by `picocolors` + the `colorize()` helper.

---

## 4. Strategy enable / disable

Each strategy has an `enabled` flag in the `[strategies.<name>]` section.
**`enabled = false` means the bot does NOT instantiate that strategy** —
it's a wire-up-integrity guarantee (Phase 21 #1 lesson): a disabled strategy
is invisible to the runtime, not a no-op shadow of the enabled version.

### 4.1 The 5 configurable strategies

| Name | Default | Purpose |
|------|---------|---------|
| `donchian_pivot_composition` | ✅ enabled | M15 baseline — Donchian + Pivot 2-component composition |
| `dydx_cex_carry` | ✅ enabled | BTC-USD cross-venue funding carry (dYdX v4 vs CEX) |
| `cascade_fade` | ✅ enabled | Liquidation-cascade "fade-the-cascade" detector |
| `funding_flip_kill_switch` | ❌ disabled | SOL funding-flip defensive opt-in |
| `regime_detector` | ❌ disabled | HMM 3-state regime meta-plugin (sizing modifier) |

### 4.2 Per-strategy overrides

Each section accepts forward-compatible overrides (cap, leverage, symbols,
timeframes, ...). Example — turn Donchian+Pivot off and bump the cascade-fade
event cap:

```toml
[strategies.donchian_pivot_composition]
enabled = false       # do not instantiate

[strategies.cascade_fade]
enabled = true
max_notional_per_event_usd = 500_000   # tighter than the 1M default
cooldown_hours = 48                    # 2-day cooldown
```

### 4.3 Verifying the change

After editing the config, confirm the new state without starting the bot:

```bash
mm-bot config validate --config=path/to/your.toml
mm-bot strategies --config=path/to/your.toml
```

`mm-bot strategies` prints the on/off state and all per-strategy overrides —
that's the ground truth of what the bot will instantiate at startup.

---

## 5. 1:10 leverage mandate

The 1:10 leverage cap is enforced at **three independent layers**
(defense-in-depth). A single layer can be bypassed by a refactor, a config
typo, or a runtime bug — three layers mean a single bug is caught by the
other two.

### 5.1 The three layers

| Layer | Where | When | What it rejects |
|-------|-------|------|-----------------|
| **L1** Schema | `apps/bot/src/config/schema.ts:117` | Config load | `risk.max_leverage > 10` (Zod `.max(10)`) |
| **L2** Pre-place | `apps/bot/src/bot/order-manager.ts:234` | Every `placeOrder` | Total notional > equity × maxLeverage at the moment of dispatch |
| **L3** Post-fill | `apps/bot/src/bot/position-manager.ts:309,654` | Every `recordFill` | Total notional > equity × maxLeverage after the position is recorded |

The L2 and L3 layers use the project's central `assertLeverageInvariant()`
helper. A breach throws `LeverageBreachError` (L3) or `OrderManagerError`
wrapping it (L2); the bot logs the breach with full context and refuses the
order.

### 5.2 How to verify

1. **Compile-time:** the L1 constraint is in the Zod schema. Try setting
   `max_leverage = 11` in your config and run `mm-bot config validate` —
   you'll see "max_leverage: must be ≤ 10".
2. **Unit tests:** `apps/bot/src/bot/order-manager.test.ts` and
   `position-manager.test.ts` cover both L2 and L3 with breach fixtures.
3. **Runtime:** while the bot is running, the Telemetry log will emit
   `[order-manager] L2 leverage breach ...` (or `[position-manager] L3 ...`)
   if anything tries to push past the cap. The state file
   (`data/bot-state.json`) tracks `counters.rejected` for breach incidents.

---

## 6. Live testing

**Live testing is the user's responsibility.** Per the project owner's
mandate (2026-07-11 23:42 Budapest):

> "minden live test dolgot torolj, azt majd en vegzem! csak a kod keszuljon
> el eloszor teljesen" — "Remove all live-test scaffolding. I'll do the live
> tests myself. First the code must be complete."

The code is complete. The pre-launch checklist (board.md §"Phase 33
closure") is a guide — each item is something the **user** confirms
manually.

---

## 7. Live testing workflow (manual)

This is the step-by-step procedure for going from a clean config to real-money
live trading. **All steps are user-driven; nothing in this workflow is
automated by the bot.**

### Step 1 — Scaffold a production config

```bash
cp config/default.toml config/prod.toml
```

Edit `config/prod.toml` to taste (cap, leverage, enabled strategies, etc.).
The default is a sensible starting point for bybit.eu SPOT-margin.

### Step 2 — Set paper mode + API keys (paper phase)

In `config/prod.toml`:

```toml
[bot]
mode = "paper"     # MUST be "paper" for the paper-testing phase
```

In `.env` (NEVER commit):

```bash
# Env var names MUST match the code (apps/bot/src/cli/commands/start.ts:61
# and packages/exchange/src/factory.ts:39-40). The prefix is `BYBIT_API_*`
# (not `BYBIT_EU_*` — the exchange is bybit.eu but the env var convention
# follows the existing exchange factory).
BYBIT_API_KEY=your_paper_or_test_key
BYBIT_API_SECRET=your_paper_or_test_secret
```

Use bybit.eu's paper/test API keys during this phase. **Withdraw must be
disabled on the key** — that's a bybit.eu account setting, not a bot config.

### Step 3 — Paper-test for N days

```bash
mm-bot start --config=config/prod.toml
```

In a separate shell, observe:

```bash
mm-bot status                 # equity, positions, realized PnL
mm-bot strategies             # confirm on/off state matches config
mm-bot trades --limit=20      # closed trades
mm-bot kill-switches          # kill-switch state + last trigger
```

The state file (`data/bot-state.json`) is updated on every position change +
every 60s. Inspect it directly for forensic detail.

Let the bot run for N days (suggest: at least 7, to cover a funding-cycle +
vol-spike pair). Watch for:

- Unexpected kill-switch triggers (check `logs/bot/` for the cause)
- Position sizes matching the configured cap
- Leverage never exceeding 1:10 (verify in the state file)
- Realized PnL drift vs. the backtest envelope (Phase 31 audit anchor:
  +41.99%/mo @ ≤7.70% DD — actual may differ in either direction)

### Step 4 — Promote to live

When you're satisfied, edit `config/prod.toml`:

```toml
[bot]
mode = "live"      # flip to live
```

And switch the `.env` API keys from paper to **real read+trade keys**
(withdraw still disabled). IP-whitelist the bot's host on the bybit.eu
account side.

### Step 5 — Real-money run

```bash
mm-bot start --config=config/prod.toml
```

Same observation toolkit (status / strategies / trades / kill-switches).
The state file is the source of truth for the live position book.

### Rollback

If anything looks wrong, `Ctrl-C` the `mm-bot start` process — the bot
performs a graceful shutdown (close positions per config, flush state,
close feed). To roll back from live to paper: set `mode = "paper"` and
restart. The state file is preserved.

---

## 8. Architecture

```
                     ┌─────────────────────────────────────────────┐
                     │              mm-bot (CLI entry)             │
                     │              apps/bot/src/index.ts          │
                     └─────────────────────┬───────────────────────┘
                                           │  loadBotConfig() + Bot.start()
                                           ▼
                     ┌─────────────────────────────────────────────┐
                     │                  Bot                         │
                     │           apps/bot/src/bot/bot.ts            │
                     │                                             │
                     │   init() → run() → stop() lifecycle         │
                     └──────┬──────────┬──────────┬───────────────┘
                            │          │          │
            ┌───────────────┘          │          └──────────────────┐
            ▼                          ▼                             ▼
  ┌──────────────────┐    ┌──────────────────────┐    ┌────────────────────┐
  │ StrategyRunner   │    │    OrderManager      │    │  PositionManager   │
  │ strategy-runner  │    │    order-manager.ts  │    │  position-manager  │
  │                  │    │                      │    │                    │
  │ onCandle(ctx)    │───▶│ L2 leverage check    │───▶│ L3 leverage check  │
  │ onFeedEvent      │    │ placeOrder           │    │ recordFill         │
  │                  │    │ cancellation         │    │ updateMarketPrice  │
  │                  │    │                      │    │ closePosition      │
  └────────┬─────────┘    └──────────┬───────────┘    └─────────┬──────────┘
           │                         │                          │
           │                         ▼                          ▼
           │              ┌──────────────────────┐    ┌────────────────────┐
           │              │   ExchangeFeed       │    │   StateStore       │
           │              │   (CCXT bybiteu)     │    │   state-store.ts   │
           │              │   or MockExchange    │    │                    │
           │              └──────────────────────┘    │ atomic JSON write  │
           │                                          │ data/bot-state.json│
           │                                          └────────────────────┘
           │
           ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                     Per-strategy instances                       │
  │  createStrategyInstances(config) → Map<Name, BotStrategyInstance> │
  │                                                                  │
  │   ├─ kind: "strategy" → Strategy (onCandle dispatch)             │
  │   │   ├─ donchian_pivot_composition  ✅                          │
  │   │   ├─ dydx_cex_carry              ✅                          │
  │   │   └─ cascade_fade                ✅                          │
  │   │                                                              │
  │   └─ kind: "plugin" → StrategyPlugin (SignalBus)                │
  │       ├─ funding_flip_kill_switch    ❌ (opt-in)                 │
  │       └─ regime_detector             ❌ (opt-in)                 │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │                   Cross-cutting components                       │
  │                                                                  │
  │   KillSwitchRegistry    4-source aggregate:                      │
  │     ├─ max-drawdown         (config.risk.max_drawdown_pct)       │
  │     ├─ max-positions        (config.risk.max_positions @ 90%     │
  │     │                        soft-warn)                          │
  │     ├─ latency-gate         (disarmed in paper mode)             │
  │     └─ per-strategy         (delegated to strategy instance)     │
  │                                                                  │
  │   Telemetry              structured JSON log → logs/bot/         │
  │                          periodic metrics (60s default)         │
  └──────────────────────────────────────────────────────────────────┘
```

### 8.1 File layout

```
apps/bot/
├── README.md                  ← this file
├── package.json               ← `mm-bot` bin entry
├── config/
│   └── default.toml           ← canonical, self-documenting config
├── src/
│   ├── index.ts               ← CLI dispatch (router entry)
│   ├── bot/
│   │   ├── bot.ts             ← Bot lifecycle
│   │   ├── strategy-runner.ts ← per-strategy event loop
│   │   ├── order-manager.ts   ← L2 leverage defense
│   │   ├── position-manager.ts← L3 leverage defense
│   │   ├── state-store.ts     ← atomic JSON persistence
│   │   ├── telemetry.ts       ← logger + metrics
│   │   └── kill-switches.ts   ← 4-source aggregate
│   ├── cli/
│   │   ├── argv.ts            ← hand-rolled parser
│   │   ├── router.ts          ← subcommand dispatcher
│   │   ├── commands/          ← one file per subcommand
│   │   │   ├── start.ts
│   │   │   ├── status.ts
│   │   │   ├── config.ts
│   │   │   ├── strategies.ts
│   │   │   ├── trades.ts
│   │   │   ├── kill-switches.ts
│   │   │   └── help.ts
│   │   └── cli-e2e.test.ts    ← end-to-end tests
│   └── config/
│       ├── schema.ts          ← Zod schema (6 sections)
│       ├── loader.ts          ← merge logic + ConfigError
│       ├── defaults.ts        ← Zod-derived defaults
│       └── strategy-registry.ts ← per-config factory
└── tests/fixtures/            ← minimal.toml + mock-feed fixtures
```

---

## 9. Coverage

This package participates in the monorepo-wide merged coverage report.

**Per-package coverage** (run from the repo root):

```bash
bun test --coverage --coverage-reporter=text
```

**Merged monorepo coverage** (all packages, one report):

```bash
bun run coverage:merge
```

This runs `turbo run coverage` across all 8 packages (apps/bot + 7 packages/*),
then invokes `scripts/merge-coverage.mjs` to merge the per-package lcov files
into:

- `coverage/merged/lcov.info` — standard LCOV format (Sonar, Codecov, Coveralls
  all consume this)
- `coverage/merged/coverage-summary.json` — istanbul-style machine-readable
  summary (total + per-file lines/funcs/branches)
- `coverage/merged/html/index.html` — basic HTML report (per-file table +
  line-by-line source view, color-coded)
- A text summary printed to stdout (line %, funcs %, file count)

**Tool choice** (full reasoning in
[`docs/merge-coverage-decision.md`](../../docs/merge-coverage-decision.md)):
custom Node.js merge script (Option D). Bun 1.3.14's test coverage only
emits `text` and `lcov` reporters — no JSON, no v8 raw. Vitest migration
was out of scope; `nyc`/`c8` need a JSON reporter that bun does not
provide. The script is pure Node ESM, zero runtime dependencies, parses
LCOV directly and merges by absolute file path.

**Known bun limitation**: bun's `--coverage-reporter=lcov` does NOT emit
`BRDA` / `BRF` / `BRH` records (verified empirically 2026-07-12 — see
[agent memory](../../.mavis/notes/) and the bun docs). The merged report
shows 100% lines + 100% functions from LCOV; branch % is reported by bun's
text reporter per-package but not propagated into the merged JSON/HTML.
Branch coverage in the monorepo is verified via the per-package
`bun test --coverage --coverage-reporter=text` output.

**`bot.ts` invariants** (Phase 33-35 mandate): `bot.ts`,
`position-manager.ts`, `router.ts`, and `tui/live-bot-state-provider.ts`
are all held at 100% line + 100% branch — see
[`docs/merge-coverage-decision.md`](../../docs/merge-coverage-decision.md)
and the Phase 34 fixup PR for the test additions.

---

## 10. Limitations

- **No real bybit.eu sandbox.** bybit.eu does not expose a public testnet
  for SPOT-margin (see `docs/research/stack-findings.md` §1.4). Paper mode
  uses the in-tree `paper-trader` simulator; it does NOT talk to bybit.eu.
  Live mode talks to bybit.eu directly with real funds.

- **Live testing is manual.** No automated live-trade harness, no shadow
  live-runs, no paper-trade gate auto-promotion. The user runs
  `mm-bot start --config=prod.toml` themselves, observes, and decides when
  to flip `mode = "live"` (via the typed "LIVE" guard in the
  Phase 36 settings panel). This is by user mandate, not a TODO.

- **Signal-center plugins not wired at runtime.** `funding_flip_kill_switch`
  and `regime_detector` are registered in the strategy-registry
  (as `kind: "plugin"` instances) but are opt-in. The current StrategyRunner
  only dispatches `kind: "strategy"` instances to the feed. Enabling the
  plugins via `enabled = true` in the config is a no-op in this build;
  wire-up of the SignalBus is a future-track item.

- **LatencyGate is disarmed in paper mode.** The bybit.eu SPOT paper-mode
  doesn't have a real feed to measure latency against. The kill-switch
  registry reports `latency-gate: DISARMED` in paper mode; it auto-arms in
  live mode (when the real WS feed is connected).

- **State file is JSON, not SQLite.** Chosen for simplicity at the
  12-max-positions scale (Phase 33 scope plan §"Open questions" Q2). If
  the position book grows, migrate to SQLite.

- **One process, one config.** No multi-bot orchestration, no
  per-strategy-instance config, no hot-reload. Restart the bot to pick
  up a config change.

- **Phase 36 settings panel scope.** The interactive settings panel
  (`[o]` in the TUI, or `mm-bot config edit`) is EDITABLE for the
  `Risk` and `Bot` sections only. The `Strategies` (enable/disable +
  per-strategy overrides), `Exchange`, `Symbols`, and `Telemetry`
  sections are READ-ONLY in this build — editing them requires
  opening `mm-bot.toml` in an external editor. Per-strategy
  enable/disable + exchange sandbox toggle are reserved for Phase 37+.

- **Table v0.1.0 doesn't support per-cell coloring.** The history-table
  LONG/SHORT direction signal uses the `+`/`-` prefix in the PNL
  column (Phase 36 Track B1 trade-off — see
  [`docs/production-strategies/phase36-deliverable.md` §"Known limitations"](../../docs/production-strategies/phase36-deliverable.md)
  for the full list).

- **Charts panel OHLC data is currently empty.** The candlestick chart
  is wired and tested, but the OHLC feed from the bot's exchange
  provider is a Phase 37+ deliverable. The equity curve + P&L
  sparkline + strategy breakdown BarChart ARE driven by real data
  (from `state.history`).

---

## See also

- [`config/default.toml`](./config/default.toml) — canonical config (every field documented)
- [`docs/production-strategies/bot.md`](../../docs/production-strategies/bot.md) — how the production strategies wire into the bot
- [`docs/production-strategies/tui.md`](../../docs/production-strategies/tui.md) — TUI keybindings + panel reference (**Phase 36 update**: 4 panels, settings panel, leverage cap, typed "LIVE" guard, raw TOML viewer)
- [`docs/production-strategies/phase36-deliverable.md`](../../docs/production-strategies/phase36-deliverable.md) — **Phase 36 closure report** (Track D — this phase's deliverable)
- [`docs/production-strategies/library-catalog.md`](../../docs/production-strategies/library-catalog.md) — the 10 libraries adopted in Phase 36 (4 ink components + 4 ASCII charts + 2 persistence)
- [`docs/audits/phase36-research-findings.md`](../../docs/audits/phase36-research-findings.md) — 5-agent research, ~75 web queries, ranked library catalog
- [`docs/audits/phase36-tui-ux-revamp-scope.md`](../../docs/audits/phase36-tui-ux-revamp-scope.md) — the scope doc Phase 36 implements
- [`.mavis/notes/phase33-scope-plan.md`](../../.mavis/notes/phase33-scope-plan.md) — Phase 33 design + scope
- [`.mavis/notes/phase34-tui-scope-plan.md`](../../.mavis/notes/phase34-tui-scope-plan.md) — Phase 34 TUI scope plan
- [`.mavis/notes/board.md`](../../.mavis/notes/board.md) — project board (Phase 36 EXECUTING + CLOSED sections)
- [Project `README.md`](../../README.md) — top-level project docs
- [`.env.example`](../../.env.example) — environment variable reference

---

## 11. Phase 36 pre-launch checklist

The Phase 36 TUI UX revamp shipped in 6 PRs (#100, #101, #102, #103, #104, #105).
Before going live with the new TUI, the user should verify each item below.
Each item is one concrete action. The full per-track walkthrough is in
[`docs/production-strategies/phase36-deliverable.md` §"Pre-launch checklist"](../../docs/production-strategies/phase36-deliverable.md).

1. **Review PR #105 in browser** — confirm the 3 new components (LiveConfirm / LeverageCap / RawTomlViewer) + the 1 new hook (useConfigStore) match the Phase 36 spec.
2. **Squash-merge PR #105 + close PR #104 as superseded** — the C1 work landed in #105 via `merge: Track C1 into Track C2` (576ea55).
3. **Run `mm-bot start` (default: bot stopped)** — TUI should open with a yellow `● bot is idle — press [s] to start` banner. Press `[s]` to start; banner disappears, panels populate.
4. **Run `mm-bot start --headless`** — CI/nohup path. Should auto-start (implied by `--headless`), plain text logs to stderr, exit 0 on SIGINT.
5. **Open settings panel `[o]` → edit a value → `[Ctrl+S]` to save** — verify `.bak` is the pre-save state and the in-place write is atomic.
6. **Try to set leverage > 10** — UI rejects, inline warning appears, `defaultValue` unchanged.
7. **Try to switch `bot.mode = "live"`** — `<LiveConfirm>` modal opens, lowercase / typo rejected, exact "LIVE" confirm writes audit log entry.
8. **Press `[v]` to view raw TOML** — Ink 7 `suspendTerminal` shell-out works; on child exit, TUI is restored.
9. **Validate config: `mm-bot config validate`** — verify `OK` (green) + brief summary line.
10. **Once user signs off, flip `bot.mode = "live"` in the new TUI** — the typed "LIVE" guard is the only thing standing between paper and real-money; per the project policy, the user is the one who runs this final step.
