# `mm-crypto-bot`

> Multi-timeframe trend-konfluencia kompozit kripto kereskedő bot, Bun + Turborepo + TypeScript ultra-strict monorepo architektúrában.

## Státusz

Scaffold fázis — a monorepo váz és a CI pipeline készen áll. A stratégia,
az exchange adapter, a backtest és a TUI implementáció a későbbi fázisokban
készül el (lásd `docs/research/`).

## Stack (verzió-pin-ek)

| Komponens | Verzió | Forrás |
|---|---|---|
| Runtime | Bun `1.3.14` | [registry.npmjs.org/bun](https://registry.npmjs.org/bun) |
| Monorepo / pipeline | Turborepo `2.10.2` | [registry.npmjs.org/turbo](https://registry.npmjs.org/turbo) |
| Nyelv | TypeScript `6.0.3` (ultra-strict) | [registry.npmjs.org/typescript](https://registry.npmjs.org/typescript) |
| Exchange | CCXT `4.5.64` (`bybiteu` ID) | [registry.npmjs.org/ccxt](https://registry.npmjs.org/ccxt) |
| TUI | ink `7.1.0` + React `>=19.2.0` | [registry.npmjs.org/ink](https://registry.npmjs.org/ink) |
| Linter | ESLint `10.6.0` + typescript-eslint `8.62.1` strict-type-checked + eslint-plugin-security `4.0.1` | [typescript-eslint.io](https://typescript-eslint.io/users/configs/) |
| Teszt | Vitest `^4.1.9` + `@vitest/coverage-v8` | [vitest.dev](https://vitest.dev) |

A teljes indoklás: [`docs/research/version-pins.md`](./docs/research/version-pins.md),
[`docs/research/stack-findings.md`](./docs/research/stack-findings.md) és
[`docs/research/tui-decision.md`](./docs/research/tui-decision.md).

## Struktúra

```
mm-crypto-bot/
├─ package.json               # gyökér: Bun workspaces + turbo scriptek
├─ turbo.json                 # pipeline: build függ a ^build-től; lint/typecheck/test párhuzamos
├─ tsconfig.base.json         # ultra-strict preset (a `@tsconfig/strictest` alapján)
├─ eslint.config.js           # flat config: ts-eslint strict + security
├─ bunfig.toml                # Bun runtime beállítások
├─ .env.example               # környezeti változók dokumentációja
├─ .github/workflows/ci.yml   # CI: lint/typecheck/test+coverage/build, párhuzamosan
├─ docs/research/             # kutatási anyagok (stratégia + stack)
├─ apps/
│  └─ bot/                    # futtatható bináris (paper/live indító)
└─ packages/
   ├─ shared/                 # típusok, util-ok, konfiguráció, közös log-olás
   ├─ core/                   # stratégia-motor váz
   ├─ exchange/               # CCXT Pro adapter váz (bybit.eu)
   ├─ backtest/               # backtest motor váz
   ├─ paper/                  # paper engine váz
   └─ tui/                    # ink-alapú TUI váz
```

## Parancsok

```bash
# Telepítés (Bun workspaces)
bun install

# Fejlesztői watch-mód (minden csomag párhuzamosan)
bun run dev

# Build (minden csomag, topológiai sorrendben)
bun run build

# Lint (eslint flat config, ultra-strict)
bun run lint

# Type-check (a `tsconfig.base.json` összes strict flagjével)
bun run typecheck

# Tesztek (Vitest)
bun run test

# Lefedettség (100% threshold a nem-TUI csomagokra a későbbi fázisokban)
bun run coverage

# Specifikus binárisok (későbbi fázisokban lesznek implementálva)
bun run backtest    # @mm/backtest
bun run paper       # @mm/paper
bun run tui         # @mm/tui
bun start           # @mm/bot (paper/live indító)
```

## License

Private project — all rights reserved.
