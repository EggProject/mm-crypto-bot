# Commands (root `package.json`)

## Fejlesztés

```bash
bun install                  # telepítés (Bun workspaces + postinstall wrapper)
bun run dev                  # watch-mód (minden csomag párhuzamosan)
bun run build                # build (minden csomag, topológiai sorrendben, turbo cache: false)
bun run lint                 # eslint flat config, ultra-strict
bun run typecheck            # tsc --noEmit, minden strict flaggel
bun run test                 # vitest, minden csomag
```

## Bot + web vezérlés

```bash
bun run start                # mm-bot start (headless, default config)
bun run web                  # mm-bot web (web client, külön process)
bun run bot:status           # state kiírása
bun run bot:config           # config validate / show / init
bun run bot:strategies       # stratégiák listája
bun run bot:trades           # utolsó N trade
bun run bot:kill-switches    # kill-switch állapot
bun run bot:help             # help
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
