# mm-bot

The production runtime of the [mm-crypto-bot](../../) project — a single-binary
crypto trading bot for the **bybit.eu** SPOT-margin venue (paper-mode via the
in-tree paper-trade simulator, live-mode via CCXT).

This README is the **operator-facing** documentation: quick start, configuration,
CLI reference, manual live-testing workflow, and architectural overview. The
self-documenting [`config/default.toml`](./config/default.toml) carries the
canonical schema reference (every section + every field + Zod constraints).

> **Phase 33 status:** ✅ MERGED to `main` on 2026-07-12. Production runtime
> is feature-complete on the code side. **Live trading is gated on the user
> manually running the workflow in §7.**

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
9. [Limitations](#9-limitations)

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
# Send SIGINT (Ctrl-C) for graceful shutdown — closes positions, flushes state.
mm-bot start
```

That's it. With the default config the bot runs in **paper mode** on the mock
feed (no network calls). For real bybit.eu paper/live testing see §7.

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

The `mm-bot` binary has 7 subcommands (hand-rolled argv parser — no external
CLI deps). All subcommands accept `--config=<path>` (default: built-in
defaults) and `--help` / `-h`.

| Subcommand | Purpose | Example |
|------------|---------|---------|
| `start` | Start the bot (SIGINT = graceful shutdown) | `mm-bot start --config=config/prod.toml` |
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
BYBIT_EU_API_KEY=your_paper_or_test_key
BYBIT_EU_SECRET=your_paper_or_test_secret
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

## 9. Limitations

- **No real bybit.eu sandbox.** bybit.eu does not expose a public testnet
  for SPOT-margin (see `docs/research/stack-findings.md` §1.4). Paper mode
  uses the in-tree `paper-trader` simulator; it does NOT talk to bybit.eu.
  Live mode talks to bybit.eu directly with real funds.

- **Live testing is manual.** No automated live-trade harness, no shadow
  live-runs, no paper-trade gate auto-promotion. The user runs
  `mm-bot start --config=prod.toml` themselves, observes, and decides when
  to flip `mode = "live"`. This is by user mandate, not a TODO.

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

---

## See also

- [`config/default.toml`](./config/default.toml) — canonical config (every field documented)
- [`docs/production-strategies/bot.md`](../../docs/production-strategies/bot.md) — how the production strategies wire into the bot
- [`.mavis/notes/phase33-scope-plan.md`](../../.mavis/notes/phase33-scope-plan.md) — Phase 33 design + scope
- [`.mavis/notes/board.md`](../../.mavis/notes/board.md) — project board (Phase 33 closure section)
- [Project `README.md`](../../README.md) — top-level project docs
- [`.env.example`](../../.env.example) — environment variable reference
