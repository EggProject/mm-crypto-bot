# mm-bot

The production runtime of the [mm-crypto-bot](../../) project — a single-binary
crypto trading bot for the **bybit.eu** SPOT-margin venue (paper-mode via the
in-tree paper-trade simulator, live-mode via CCXT).

This README is the **operator-facing** documentation: quick start, configuration,
CLI reference, manual live-testing workflow, and architectural overview. The
self-documenting [`config/default.toml`](../../run-bot/config/default.toml) carries the
canonical schema reference (every section + every field + Zod constraints).

> **Phase 52D:** the canonical config was relocated from `apps/bot/config/`
> to `run-bot/config/` (Phase 52B relocation; 52D finalized). The
> `mm-bot start` default is now the Phase 37 Track 5 production-template
> with `mode = "paper"` failsafe. See `run-bot/config/live-eu.example.toml`
> for the live deployment template.

> **Phase 37 status (2026-07-15):** ✅ Portfolio coordination layer landed
> in `apps/bot/src/portfolio/` (4 new modules: `RiskBudgetAllocator` +
> `CorrelationMatrix` + `PortfolioStop` + `PortfolioManager`). The
> `Bot` constructs the `PortfolioManager` in `init()` and passes it to
> the `StrategyRunner`; the runner consults the budget cap before every
> signal and skips when the circuit breaker is tripped. Dedicated tests cover
> the portfolio coordination behavior. See
> [§11 Portfolio coordination](#11-portfolio-coordination-phase-37-track-4)
> for the operator guide.

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
11. [Portfolio coordination (Phase 37 Track 4)](#11-portfolio-coordination-phase-37-track-4)

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
mm-bot start

# Run with an explicit config and plain output.
mm-bot start --config=run-bot/config/default.toml --no-color
```

`mm-bot start` is always headless and starts the engine immediately after
configuration and runtime safety checks. The built-in defaults use paper mode
with public bybit.eu market data; order execution remains simulated. See §7
for the controlled paper/live workflow.

### What `mm-bot start` does

1. Loads + strictly Zod-validates the config (built-in defaults unless
   `--config=<path>` is supplied).
2. Instantiates the enabled strategies (via `createStrategyInstances`).
3. Constructs `OrderManager`, `PositionManager`, `StateStore`,
   `Telemetry`, and `KillSwitchRegistry`.
4. Subscribes to the configured exchange feed.
5. Dispatches each LTF bar to every active strategy's `onCandle(ctx)`, calls
   enabled plugins' `onBar`, then drains their shared `SignalBus`; the regime
   detector receives its close-history input specifically from closed `1d`
   bars.
6. Pipes emitted `StrategySignal`s through the order pipeline
   (sizing → leverage-invariant check → `feed.placeOrder`).
7. On SIGINT / SIGTERM: gracefully shuts down, finalizes state file.

State is persisted to `data/bot-state.json` (path is configurable). Restart
the bot and it resumes from the last snapshot.

---

## 2. Configuration

**One TOML file drives the whole bot.** Defaults live in
[`config/default.toml`](../../run-bot/config/default.toml). The file is **self-documenting**
— every section + every field has an inline comment explaining the units, the
constraints, and the rationale.

### 2.1 Merge order

When `loadBotConfig(path?)` runs, the effective config is built in three layers
(later wins):

```
  ┌──────────────────────────────────────────────────────────────┐
  │  1. Zod-derived defaults        (apps/bot/src/config/defaults.ts)
  │  2. TOML file (if --config=PATH)  (run-bot/config/default.toml)
  │  3. Environment overrides        (BUN_ENV, LOG_LEVEL, BYBIT_*)
  └──────────────────────────────────────────────────────────────┘
```

This means: copy the default file, edit the fields you want to change, point
the bot at it with `--config=`. The Zod schema rejects any field outside
`[0.001, 0.05]` etc. — invalid configs are refused at startup with a clear
error list.

### 2.2 Schema (7 sections)

| Section | Purpose |
|---------|---------|
| `[bot]` | `mode` (paper\|live), `log_level`, `state_file` |
| `[exchange]` | `id` (bybiteu\|mock), `rate_limit_ms`, `sandbox` |
| `[risk]` | `risk_per_trade`, `kelly_fraction`, `max_drawdown_pct`, `max_positions`, **`max_leverage` (1:10 MANDATE)** |
| `[symbols]` | `enabled` — CCXT unified format, e.g. `"BTC/USDC"` |
| `[strategies.<name>]` | `enabled` + per-strategy overrides (cap, leverage, symbols, timeframes, ...) |
| `[telemetry]` | `log_dir`, `metrics_interval_sec` |
| `[portfolio]` | **Phase 37 Track 4** — `total_risk_per_cycle_usd`, `correlation_penalty_threshold`, `correlation_window_size`, `max_dd_pct` (portfolio-level circuit breaker) |

The full annotated schema is in `run-bot/config/default.toml`. **Read that file as
the canonical reference** — the comments there are kept in sync with the Zod
schema in `apps/bot/src/config/schema.ts`.

### 2.3 Forward compatibility

The `StrategySectionSchema` uses Zod `.passthrough()`, so new
strategy-specific fields can be added (in a future phase) without breaking
existing TOML files. The strategy-registry factory reads the `.passthrough()`
fields verbatim and applies them at construction time.

---

## 3. CLI reference

The `mm-bot` binary has 9 subcommands (hand-rolled argv parser — no external
CLI dependency). Each command validates its own supported options; run
`mm-bot <subcommand> --help` for its exact contract.

| Subcommand | Purpose | Example |
|------------|---------|---------|
| `start` | Start the headless bot until signal or runtime failure | `mm-bot start --config=run-bot/config/prod.toml` |
| `status` | Show persisted state (positions, P&L, counters) | `mm-bot status` |
| `config validate` | Load + validate config; print OK or errors | `mm-bot config validate --config=run-bot/config/prod.toml` |
| `config show` | Print effective config (defaults + file + env) | `mm-bot config show` |
| `config init` | Scaffold a new config file | `mm-bot config init --out=run-bot/config/prod.toml` |
| `strategies` | List configured strategies + on/off state | `mm-bot strategies` |
| `trades` | Show recent closed trades (filterable by symbol) | `mm-bot trades --limit=20 --symbol=BTC/USDC` |
| `kill-switches` | Show kill-switch registry state | `mm-bot kill-switches` |
| `kill-switch-dry-run` | Simulate the kill-switch report without sending orders | `mm-bot kill-switch-dry-run` |
| `backtest` | Run the deterministic OHLC fixture backtest | `mm-bot backtest ohlc-trend` |
| `help` | Show help | `mm-bot help` |

### 3.1 Exit codes

All subcommands return POSIX-style exit codes:

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Runtime error (unknown subcommand, state file not found, etc.) |
| `2` | Config validation failure |

CI-friendly commands have no prompts and deterministic output.

### 3.2 Example invocations

```bash
# Validate a custom config before launching the bot with it
mm-bot config validate --config=run-bot/config/prod.toml

# Show what the bot will actually load (after defaults + file + env merge)
mm-bot config show --config=run-bot/config/prod.toml

# Scaffold a fresh config (writes the canonical default.toml to a new path)
mm-bot config init --out=run-bot/config/prod.toml

# Run the bot with that config
mm-bot start --config=run-bot/config/prod.toml

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

### 3.3 Headless lifecycle

`mm-bot start` validates its option allowlist and the complete config before
constructing the runtime. Unknown options and unknown `[bot]` fields fail
closed. After the normal runtime safety checks, the engine starts immediately
and remains active until shutdown or a runtime failure.

SIGINT and SIGTERM share one idempotent shutdown operation. Repeated signals
cannot duplicate `Bot.stop()`, and the command waits for shutdown, pending log
writes, and log-file closure before returning. Console logs are appended to
`<state_file>.log`. `--no-color` or `NO_COLOR=1` disables ANSI output.

---

## 4. Strategy enable / disable

Each strategy has an `enabled` flag in the `[strategies.<name>]` section.
**`enabled = false` means the bot does NOT instantiate that strategy** —
it's a wire-up-integrity guarantee (Phase 21 #1 lesson): a disabled strategy
is invisible to the runtime, not a no-op shadow of the enabled version.

### 4.1 The 5 configurable strategies

| Name | Default | Runtime input / behaviour |
|------|---------|---------------------------|
| `donchian_pivot_composition` | ✅ enabled | M15 OHLCV baseline — Donchian + Pivot 2-component composition |
| `dydx_cex_carry` | ❌ disabled | Requires both a funding source and a production precondition re-verifier; startup fails loudly if explicitly enabled before the verifier is wired |
| `cascade_fade` | ❌ disabled | Requires a live liquidation + OI + ELR event bridge; startup fails loudly if enabled while that bridge is absent |
| `funding_flip_kill_switch` | ❌ disabled | Requires an explicit SOL funding-rate producer; startup fails loudly if enabled without one |
| `regime_detector` | ❌ disabled | Closed `1d` OHLCV feeds it; its latest per-symbol sizing multiplier is applied by the runtime (default 1.0 before any signal) |

### 4.2 Per-strategy overrides

Each section accepts forward-compatible overrides (cap, leverage, symbols,
timeframes, ...). Example — turn Donchian+Pivot off and opt in to the wired
daily-close regime detector:

```toml
[strategies.donchian_pivot_composition]
enabled = false       # do not instantiate

[strategies.regime_detector]
enabled = true
symbols = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]
```

Do not enable `cascade_fade` until the production process provides its
liquidation/OI/ELR event bridge, or `funding_flip_kill_switch` until it
provides an explicit SOL funding-rate producer. Both configurations fail at
startup instead of silently creating inert safety components.

### 4.3 Verifying the change

After editing the config, confirm the new state without starting the bot:

```bash
mm-bot config validate --config=path/to/your.toml
mm-bot strategies --config=path/to/your.toml
```

`mm-bot strategies` prints the requested on/off state and all per-strategy
overrides. Startup additionally enforces external-data dependencies and aborts
if an enabled component cannot be made operational.

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
cp run-bot/config/default.toml run-bot/config/prod.toml
```

Edit `run-bot/config/prod.toml` to taste (cap, leverage, enabled strategies, etc.).
The default is a sensible starting point for bybit.eu SPOT-margin.

### Step 2 — Set paper mode + API keys (paper phase)

In `run-bot/config/prod.toml`:

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
mm-bot start --config=run-bot/config/prod.toml
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

When you're satisfied, edit `run-bot/config/prod.toml`:

```toml
[bot]
mode = "live"      # flip to live
```

And switch the `.env` API keys from paper to **real read+trade keys**
(withdraw still disabled). IP-whitelist the bot's host on the bybit.eu
account side.

### Step 5 — Real-money run

```bash
mm-bot start --config=run-bot/config/prod.toml
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
  │   │   ├─ dydx_cex_carry              ❌ (verifier required)      │
  │   │   └─ cascade_fade                ❌ (bridge required)        │
  │   │                                                              │
  │   └─ kind: "plugin" → StrategyPlugin (SignalBus)                │
  │       ├─ funding_flip_kill_switch    ❌ (producer required)      │
  │       └─ regime_detector             ❌ (opt-in; 1d feed wired)  │
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
│   ├── portfolio/             ← Phase 37 Track 4
│   │   ├── risk-budget.ts     ← RiskBudgetAllocator (weight × penalty)
│   │   ├── correlation.ts     ← CorrelationMatrix (rolling N)
│   │   ├── portfolio-stop.ts  ← circuit breaker (DD% → close-all)
│   │   ├── portfolio-manager.ts ← orchestrator (single source of truth)
│   │   └── index.ts           ← barrel
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
│       ├── schema.ts          ← Zod schema (7 sections, incl. portfolio)
│       ├── loader.ts          ← merge logic + ConfigError
│       ├── defaults.ts        ← Zod-derived defaults
│       └── strategy-registry.ts ← per-config factory
└── tests/fixtures/            ← minimal.toml + mock-feed fixtures
```

---

## 9. Coverage

The owned, selected bot runtime scope is listed explicitly in
`scripts/coverage-tools/bot-runtime-scope.json`. Run the two independent strict
four-metric gates from the repository root:

```bash
bun run coverage:bot:unit
bun run coverage:bot:e2e
bun run test:coverage-infra
```

Unit coverage uses Vitest's V8 provider under native Node; the compatibility
layer exists only for the selected Bun-authored tests. Subprocess coverage is
collected by source-instrumented Bun children: 29 canonical CLI cases plus 16
separately spawned runtime-driver cases. Outputs are respectively
`coverage/unit/coverage-summary.json` + `lcov.info` and
`coverage/e2e/summary.json` + PID raw envelopes. They are never merged.

The current unit artifact covers 1599/1599 statements, 866/866 branches,
278/278 functions and 1495/1495 lines. The current subprocess E2E artifact
covers 1597/1597 statements, 866/866 branches, 279/279 functions and 1492/1492
lines. Both independent gates pass only when every owned runtime counter is
exactly 100%.

---

## 10. Limitations

- **No real bybit.eu sandbox.** bybit.eu does not expose a public testnet
  for SPOT-margin (see `docs/research/stack-findings.md` §1.4). Paper mode
  uses the in-tree `paper-trader` simulator; it does NOT talk to bybit.eu.
  Live mode talks to bybit.eu directly with real funds.

- **Live testing is manual.** No automated live-trade harness, no shadow
  live-runs, no paper-trade gate auto-promotion. The user runs
  `mm-bot start --config=prod.toml` themselves, observes, and decides when
  to change `mode = "live"` in the TOML file, validate it, and launch the
  bot. This is by user mandate, not a TODO.

- **Plugin data dependencies remain explicit.** Enabled plugins subscribe to
  the shared `SignalBus`, and the regime detector receives closed `1d` prices.
  Its current regime sizing output is informational/telemetry-only until the
  portfolio sizing path consumes `sizeModifier`. The SOL funding-flip plugin
  cannot be derived from OHLCV: enabling it without an explicit SOL
  funding-rate producer fails loudly at startup. Likewise, Cascade Fade stays
  off unless a liquidation/OI/ELR event bridge is provided; enabling it without
  that bridge fails instead of running an inert strategy.

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

- [`config/default.toml`](../../run-bot/config/default.toml) — canonical config (every field documented)
- [`docs/production-strategies/bot.md`](../../docs/production-strategies/bot.md) — how the production strategies wire into the bot
- [`.mavis/notes/phase33-scope-plan.md`](../../.mavis/notes/phase33-scope-plan.md) — Phase 33 design + scope
- [Project `README.md`](../../README.md) — top-level project docs
- [`.env.example`](../../.env.example) — environment variable reference

---

## 11. Portfolio coordination (Phase 37 Track 4)

The multi-strategy runtime needs a **portfolio-level coordination layer**
on top of the per-strategy risk management (1:10 leverage + max positions +
per-strategy kill-switches). Without portfolio coordination, two carry
strategies trading the same pair would each size as if they were the only
position — the combined drawdown can then exceed the per-strategy
`max_drawdown_pct` because the funding-rate factor is shared.

The portfolio layer sits between the `StrategyRunner` and the
`PositionManager` / `OrderManager`, and has three components:

### 11.1 Risk budget allocation

```toml
[portfolio]
total_risk_per_cycle_usd = 100          # max new risk per cycle, USD (1..10_000)
correlation_penalty_threshold = 0.7      # corr ≥ this → penalty applied
correlation_window_size = 30            # rolling N trade returns
max_dd_pct = 0.10                       # circuit breaker DD threshold (0.01..0.30)
```

The `RiskBudgetAllocator` splits `total_risk_per_cycle_usd` between enabled
strategies by weight (the per-strategy `cap` value from `[strategies.X]`)
and applies a correlation penalty when two strategies are highly correlated
(e.g. both are carry trades on the same pair). The per-strategy budget is:

```
budget = total_risk × normalized_weight × (1 − penalty)
penalty = max(0, (max_corr − threshold) / (1 − threshold))
```

The `StrategyRunner` consults this budget BEFORE sizing every order. If
the requested notional exceeds the budget, the order is scaled down to
fit (or skipped if the budget is 0).

### 11.2 Correlation matrix

`CorrelationMatrix` computes the rolling Pearson correlation between every
pair of strategies from the last N (default 30) trade returns. Returns
are recorded via `PortfolioManager.recordFill({ strategyId, returnPct })`
on every closed trade. The matrix is read by the `RiskBudgetAllocator`
to compute the penalty on every budget re-compute.

The matrix is symmetric (`corr(a, b) === corr(b, a)`), diagonal 1.0, and
uses the absolute value of correlation (so negatively correlated strategies
are also penalised — the magnitude is what matters, not the sign).

For the carry strategies the correlation is typically 0.6–0.9 (shared
funding-rate factor). For a new ohlc-trend strategy the correlation with
carry is typically 0.1–0.3 (different signal source). At the default
`correlation_penalty_threshold = 0.7`, a 0.9 carry pair gets
`penalty = 0.667` and the shared budget drops to one third.

### 11.3 Circuit breaker (portfolio-level stop)

`PortfolioStop` tracks the portfolio equity (sum of open positions' P&L +
cash) and the high-water mark. If the drawdown ≥ `max_dd_pct`, the
circuit breaker **trips**:

1. **Close ALL open positions** via market orders (never limit) — the
   `PortfolioManager.executeCloseAll()` iterates `positionManager.getPositions()`
   and places opposite-side market orders through the `OrderManager`.
2. **Stop all strategy-runners** — the `StrategyRunner` checks
   `portfolioManager.isTripped()` before every signal and skips if true.
3. **Stop the bot** — the `Bot.run` heartbeat detects the trip and calls
   `bot.stop()`. The user must run `mm-bot start` again to resume.
4. **Log a CRITICAL error** with the timestamp, drawdown %, and the
   per-strategy contribution to the loss.

The circuit breaker is **LATCHED** — once tripped, it stays tripped until
`PortfolioStop.reset()` is called (which only happens on bot restart). The
peak equity is preserved across the trip (it only resets on
`reset({ clearPeak: true })`).

### 11.4 Files and tests

| File | Lines | Coverage |
|------|-------|----------|
| `apps/bot/src/portfolio/risk-budget.ts` | ~330 | 100% line |
| `apps/bot/src/portfolio/correlation.ts` | ~290 | 100% line |
| `apps/bot/src/portfolio/portfolio-stop.ts` | ~300 | 100% line |
| `apps/bot/src/portfolio/portfolio-manager.ts` | ~440 | 100% line |
| `apps/bot/src/portfolio/*.test.ts` (4 files) | ~1650 | — |

The portfolio layer ships with 4 dedicated test files (105 tests total,
all green):

- `risk-budget.test.ts` — weight allocation, correlation penalty math, edge cases
- `correlation.test.ts` — rolling window FIFO, Pearson correctness, single fill update
- `portfolio-stop.test.ts` — DD computation, trip-on-DD, latch, reset, force-trip
- `portfolio-manager.test.ts` — integration, close-all proves market orders placed

The close-all test is SAFETY-CRITICAL: it uses a real `MockExchangeFeed`
+ `OrderManager` + `PositionManager` stack, opens 2 positions, trips
the breaker, and asserts that exactly 2 market orders (with the
opposite sides) were placed on the feed. The test cannot pass without
the close-all action actually placing real orders — it proves the
behavior, not just the docstring.

### 11.5 When the circuit breaker fires

The `PortfolioStop` is checked every Bot heartbeat (default 60s in
production, configurable via `BotOptions.heartbeatIntervalMs`). For
testing, set it to 10ms. The sequence:

1. `Bot.run` heartbeat → `portfolioManager.recordEquity(currentEquity)`
2. `recordEquity` updates the high-water mark + per-strategy contribution
3. If `drawdown ≥ max_dd_pct`, the `PortfolioStop` trips
4. The trip action (wired in the `PortfolioManager` constructor) fires
   `executeCloseAll()` — async, market orders, no exception can stop it
5. `isTripped()` returns `true` — `StrategyRunner` skips subsequent signals
6. The Bot's heartbeat detects the trip and calls `bot.stop()`
7. User sees a CRITICAL log line and must run `mm-bot start` to resume

### 11.6 What the portfolio layer does NOT do

- **It does NOT replace the per-strategy risk section.** Per-strategy
  `risk_per_trade`, `max_leverage`, `max_positions`, and `max_drawdown_pct`
  stay in `[risk]` and are enforced by the existing `OrderManager` and
  `PositionManager`. The portfolio layer is one level above.
- **It does NOT modify the 1:10 leverage invariant.** The 3-layer defense
  (L1 schema, L2 pre-place, L3 post-fill) is unchanged.
- **It does NOT auto-restart.** The trip is LATCHED. The user must
  restart manually to verify the situation and clear the latch.
- **It does NOT bypass the user's intent.** The portfolio config defaults
  are conservative (10% DD, $100 cycle, 0.7 threshold). Override them in
  the TOML to match your risk tolerance.
