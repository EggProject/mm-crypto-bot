# mm-bot

The `mm-bot` CLI for the [mm-crypto-bot](../..) project.

This package is the **runtime entry point** for the trading bot. It is built
on top of:

- `@mm-crypto-bot/core` — strategy + plugin runtime
- `@mm-crypto-bot/exchange` — exchange feed abstraction (bybit.eu, mock)
- `@mm-crypto-bot/paper` — paper-trade execution simulator
- `@mm-crypto-bot/shared` — shared types + logger
- `@mm-crypto-bot/backtest` — historical replay

The CLI is **non-interactive** and **CI-friendly** — no prompts, no TUI.
Every subcommand supports `--config=<path>` (default: built-in defaults)
and `--help` / `-h`.

## Install

```bash
bun install
```

## Build

```bash
bun run build
# → apps/bot/dist/index.js
```

## Usage

```bash
# Show help
bun run src/index.ts --help
# or, after `bun run build`:
mm-bot --help

# Subcommands:
mm-bot start                  # start the bot (SIGINT = graceful shutdown)
mm-bot status                 # show the persisted state
mm-bot config validate        # validate the config (default or --config=PATH)
mm-bot config show            # print the effective config as TOML
mm-bot config init --out=./my.toml  # scaffold a new config
mm-bot strategies             # list registered strategies + on/off state
mm-bot trades --limit=20      # show the most recent N closed trades
mm-bot kill-switches          # show kill-switch state
mm-bot help                   # explicit help
```

## Config

See `config/default.toml` for the full schema (Zod-validated). The 6 sections:

1. `[bot]` — mode (paper/live), log_level, state_file
2. `[exchange]` — id (bybiteu/mock), rate_limit_ms, sandbox
3. `[risk]` — risk_per_trade, kelly_fraction, max_drawdown_pct, max_positions, max_leverage (1:10 MANDATE)
4. `[symbols]` — enabled list (CCXT unified format)
5. `[strategies.<name>]` — per-strategy enable/disable + overrides (cap, leverage, symbols, ...)
6. `[telemetry]` — log_dir, metrics_interval_sec

## Exit codes

| Code | Meaning                                  |
|------|------------------------------------------|
| 0    | Success                                  |
| 1    | Runtime error (or unknown subcommand)    |
| 2    | Config validation failure                |

## Development

```bash
# Type-check
bun run typecheck

# Lint
bun run lint

# Run unit + e2e tests
bun test
```

## Architecture

```
apps/bot/src/
├── cli/                  ← Phase 33 Track D — CLI app
│   ├── argv.ts             hand-rolled argv parser
│   ├── router.ts           subcommand router
│   ├── commands/           one file per subcommand
│   │   ├── start.ts
│   │   ├── status.ts
│   │   ├── config.ts        (validate | show | init)
│   │   ├── strategies.ts
│   │   ├── trades.ts
│   │   ├── kill-switches.ts
│   │   └── help.ts
│   └── cli-e2e.test.ts   ← end-to-end tests (spawn `mm-bot ...`)
├── bot/                  ← Phase 33 Track C — Bot runtime
│   ├── bot.ts              Bot class
│   ├── order-manager.ts    L2 leverage defense
│   ├── position-manager.ts L3 leverage defense
│   ├── state-store.ts      atomic-write JSON state
│   ├── telemetry.ts        metrics + log
│   ├── kill-switches.ts    4-source aggregate
│   └── strategy-runner.ts  onFeedEvent dispatch
├── config/               ← Phase 33 Track B — Config system
│   ├── schema.ts           Zod schema (6 sections)
│   ├── loader.ts           TOML → BotConfig
│   ├── defaults.ts         Zod-derived defaults
│   └── strategy-registry.ts  per-strategy factories
├── config/default.toml   ← canonical config
└── index.ts              ← CLI dispatch
```

See the [Phase 33 scope plan](../../.mavis/notes/phase33-scope-plan.md) for
the full design.
