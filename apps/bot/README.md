# Bot Application

Run the bot operator interface from the repository root with one supported command:

```sh
bun run apps/bot/src/index.ts <subcommand> [options]
```

Examples:

```sh
bun run apps/bot/src/index.ts help
bun run apps/bot/src/index.ts config validate --config=./config.toml
bun run apps/bot/src/index.ts start --config=./config.toml
```

Use `bun run apps/bot/src/index.ts <subcommand> --help` for the command-specific options.
Live execution remains fail-closed when its configuration or exchange eligibility checks fail.
