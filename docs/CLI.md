# CLI reference (`mm-bot`)

A `mm-bot` CLI parancsai `mm-bot <subcommand>` formában érhetők el.

| Subcommand | Leírás | Példa |
|---|---|---|
| `start` | Bot indítása (PURE HEADLESS) | `mm-bot start --config=run-bot/config/default.toml` |
| `status` | Perzisztens state kiírása (equity, P&L, positions, history) | `mm-bot status` |
| `config` | Config validate / show / init | `mm-bot config show` |
| `strategies` | Regisztrált stratégiák listája (ON / OFF) | `mm-bot strategies` |
| `trades` | Utolsó N lezárt trade kiírása | `mm-bot trades --limit=20` |
| `kill-switches` | Kill-switch állapot (max-DD, max-positions, latency-gate, ...) | `mm-bot kill-switches` |
| `kill-switch-dry-run` | Vészleállítási útvonal tesztje order nélkül | `mm-bot kill-switch-dry-run` |
| `backtest` | Determinisztikus gyors backtest | `mm-bot backtest ohlc-trend` |
| `help` | Help (vagy `mm-bot --help`) | `mm-bot help` |

Részletes CLI doksi: [`apps/bot/README.md` §3](../apps/bot/README.md#3-cli-reference) (exit codes, flag-ek, example invocations).
