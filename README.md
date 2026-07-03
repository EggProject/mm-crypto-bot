# mm-crypto-bot — bybit.eu spot + spot margin multi-strategy crypto bot

Monorepo a Bun + Turborepo + TypeScript ultra-strict stack-en. Elsődlegesen
a bybit.eu platformra (MiCAR-kompatibilis, max 10× spot margin).

A részletes stack-döntések: [`docs/research/stack-findings.md`](docs/research/stack-findings.md)
A kiválasztott stratégia: a `feat/research-strategy` branch-en lévő kutatás
alapján (MTF-Trend-Konfluencia Kompozit v1.0).

## Monorepo struktúra

```
mm-crypto-bot/
├── apps/
│   ├── bot/           # A fő CLI bot bináris (Bun runtime)
│   └── tui/           # Ink alapú TUI frontend
├── packages/
│   ├── core/          # Trading engine core, signal pipeline
│   ├── exchange/      # CCXT Pro bybit.eu adapter (és később binance/okx)
│   ├── backtest/      # Backtest engine fee + borrow_rate modellel
│   ├── paper/         # Generikus paper-trading emulátor CCXT feedre
│   └── shared/        # Közös típusok, util-ok, config
├── docs/
│   └── research/      # Stack + stratégia kutatási anyagok
├── turbo.json
├── bunfig.toml
├── tsconfig.base.json
└── eslint.config.js
```

## Gyors indítás

```bash
# 1. Bun telepítése (ha még nincs)
curl -fsSL https://bun.sh/install | bash

# 2. Függőségek telepítése
bun install

# 3. Type-check + lint
bun run typecheck
bun run lint

# 4. Tesztek
bun run test

# 5. Bot indítása (paper módban, sandbox adatokkal)
bun run dev --workspace=apps/bot -- --mode=paper
```

## Verzió-pin-ek

Lásd [`docs/research/version-pins.md`](docs/research/version-pins.md).

| Csomag | Verzió |
|---|---|
| Bun | 1.3.14 |
| Turborepo | 2.10.2 |
| TypeScript | 6.0.3 |
| CCXT | 4.5.64 |
| Ink | 7.1.0 |
| ESLint | 10.6.0 |
| @typescript-eslint | 8.62.1 |
| eslint-plugin-security | 4.0.1 |

## Jogi / kockázati disclaimer

Ez a szoftver kizárólag oktatási és kutatási célokra készül. A
kriptovaluta-kereskedés jelentős pénzügyi kockázattal jár. A szerzők
és a közreműködők nem vállalnak felelősséget a szoftver használatából
eredő pénzügyi veszteségekért.

A bybit.eu egy MiCAR-engedéllyel rendelkező platform, de a kereskedés
kockázata a felhasználót terheli. Mindig kis tétekkel kezdj, és csak
olyan összeget kockáztass, amelyet megengedhetsz magadnak elveszíteni.