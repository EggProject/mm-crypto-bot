# Commands (root `package.json`)

## Fejlesztés

```bash
bun install --frozen-lockfile # install pinned workspace dependencies
bun run dev                  # watch-mód (minden csomag párhuzamosan)
bun run build                # build (minden csomag, topológiai sorrendben, turbo cache: false)
bun run lint                 # eslint flat config, ultra-strict
bun run typecheck            # tsc --noEmit, minden strict flaggel
bun run test                 # Bun test runner, minden csomag
```

## Bot vezérlés

```bash
bun run apps/bot/src/index.ts start                # start headless bot
bun run apps/bot/src/index.ts status               # show persisted state
bun run apps/bot/src/index.ts config validate      # validate configuration
bun run apps/bot/src/index.ts strategies           # list strategies
bun run apps/bot/src/index.ts trades --limit=20    # show recent trades
bun run apps/bot/src/index.ts kill-switches        # show kill-switch state
bun run apps/bot/src/index.ts kill-switch-dry-run  # test emergency path without orders
bun run apps/bot/src/index.ts backtest ohlc-trend  # run deterministic fixture backtest
bun run apps/bot/src/index.ts help                 # show CLI help
```

## Backtest tooling

```bash
bun run backtest             # baseline backtest futtatás
bun run sweep                # paraméter-sweep (multi-config)
bun run oos                  # out-of-sample decay check
bun run report               # HTML riport generálás
bun run ohlcv                # OHLCV adat letöltés (CCXT)
```

## Coverage (100% per-package OWN gate)

Lásd [`docs/TESTING.md`](./TESTING.md) §2.

## Egyéb

```bash
bun run clean                # minden build/test artifact (node_modules, .turbo, coverage)
```
