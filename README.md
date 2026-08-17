# `mm-crypto-bot`

> Multi-timeframe trend-konfluencia kompozit kripto kereskedő bot, Bun + Turborepo + TypeScript ultra-strict monorepo architektúrában. bybit.eu SPOT-margin venue, paper + live mód.

## Install

```bash
bun install
cp .env.example .env
```

The install step does not create command wrappers, Git hooks, or user-level symlinks.

## Start

A bot egyetlen processzben fut.

### Choose your config

| Config                                            | Purpose                                                                                                  | When to use                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `run-bot/config/default.toml`                     | FAILSAFE — `min_consensus = 2`                                                                           | direct Bun entry point without a `--config` flag                          |
| **`run-bot/config/paper-backtest-verified.toml`** | **BACKTEST-VERIFIED — `min_consensus = 1`, BTC 2024-01 → 2026-07: 11048 trades, 64.74% win, +34.41%/mo** | **ha a backtest-tel azonos viselkedést akarod paper módban** ← AJÁNLOTT   |
| `run-bot/config/live-eu.toml`                     | LIVE template (bybit.eu SPOT, `mode = "live"`)                                                           | live deploy előtt (lásd [`docs/LIVE-TRADING.md`](./docs/LIVE-TRADING.md)) |
| `run-bot/config/live-eu.example.toml`             | LIVE template example                                                                                    | user config init (soha ne editáld közvetlenül)                            |

### The bot

**AJÁNLOTT — backtest-verified paper mode:**

```bash
bun run apps/bot/src/index.ts start --config=run-bot/config/paper-backtest-verified.toml
```

Vagy a default failsafe config:

```bash
bun run apps/bot/src/index.ts start
```

Run the direct Bun entry point from the repository root; no generated wrapper is required.

## További dokumentáció

| Dokumentum                                                     | Leírás                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`docs/CHANGELOG.md`](./docs/CHANGELOG.md)                     | Release history (keep-a-changelog formátum, aktuális: `0.81.0`)                                                                |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)               | Rendszer architektúra: bot engine és kereskedési komponensek                                                                   |
| [`docs/STRUCTURE.md`](./docs/STRUCTURE.md)                     | Projekt struktúra (monorepo fa)                                                                                                |
| [`docs/STACK.md`](./docs/STACK.md)                             | Verzió-pin-ek + indoklás                                                                                                       |
| [`docs/TESTING.md`](./docs/TESTING.md)                         | Unit/integrációs tesztelés + per-package OWN 100%                                                                              |
| [`docs/CI.md`](./docs/CI.md)                                   | 6 CI job (`.github/workflows/ci.yml`)                                                                                          |
| [`docs/COMMANDS.md`](./docs/COMMANDS.md)                       | Root `package.json` scriptek                                                                                                   |
| [`docs/CLI.md`](./docs/CLI.md)                                 | CLI subcommands                                                                                                                |
| [`docs/LIVE-TRADING.md`](./docs/LIVE-TRADING.md)               | Live mód workflow (config + bybit.eu key + paper-test)                                                                         |
| [`apps/bot/README.md`](./apps/bot/README.md)                   | **Operator-facing** doksi (10 fejezet): quick start, config, CLI ref, stratégiák, 1:10 leverage védelem, live testing workflow |
| [`docs/research/`](./docs/research/)                           | Stack kutatás: verzió-pin-ek indoklása, stack alternatívák                                                                     |
| [`docs/production-strategies/`](./docs/production-strategies/) | 5 stratégia reference (HTML vizualizációk)                                                                                     |
| [`docs/audits/`](./docs/audits/)                               | Audit doksik (coverage döntés, scope, ...)                                                                                     |

## License

Private project — all rights reserved.
