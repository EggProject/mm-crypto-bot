# CLI reference

Run each CLI command as `bun run apps/bot/src/index.ts <subcommand>`.

| Subcommand            | Leírás                                                         | Példa                                                                      |
| --------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `start`               | Bot indítása (PURE HEADLESS)                                   | `bun run apps/bot/src/index.ts start --config=run-bot/config/default.toml` |
| `status`              | Perzisztens state kiírása (equity, P&L, positions, history)    | `bun run apps/bot/src/index.ts status`                                     |
| `config`              | Config validate / show / init                                  | `bun run apps/bot/src/index.ts config show`                                |
| `strategies`          | Regisztrált stratégiák listája (ON / OFF)                      | `bun run apps/bot/src/index.ts strategies`                                 |
| `trades`              | Utolsó N lezárt trade kiírása                                  | `bun run apps/bot/src/index.ts trades --limit=20`                          |
| `kill-switches`       | Kill-switch állapot (max-DD, max-positions, latency-gate, ...) | `bun run apps/bot/src/index.ts kill-switches`                              |
| `kill-switch-dry-run` | Vészleállítási útvonal tesztje order nélkül                    | `bun run apps/bot/src/index.ts kill-switch-dry-run`                        |
| `backtest`            | Determinisztikus gyors backtest                                | `bun run apps/bot/src/index.ts backtest ohlc-trend`                        |
| `help`                | Help (vagy `bun run apps/bot/src/index.ts --help`)             | `bun run apps/bot/src/index.ts help`                                       |

Részletes CLI doksi: [`apps/bot/README.md` §3](../apps/bot/README.md#3-cli-reference) (exit codes, flag-ek, example invocations).
