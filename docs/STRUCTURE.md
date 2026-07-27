# Project structure

```
mm-crypto-bot/
├─ package.json               # gyökér: Bun workspaces + turbo scriptek
│                             # + postinstall wrapper (scripts/install-mm-bot.sh)
├─ turbo.json                 # pipeline: build függ a ^build-től; cache: false
├─ tsconfig.base.json         # ultra-strict preset (@tsconfig/strictest alapján)
├─ eslint.config.js           # flat config: ts-eslint strict + security
├─ bunfig.toml                # Bun runtime beállítások
├─ .env.example               # környezeti változók dokumentációja
├─ .github/workflows/ci.yml   # CI: 7 jobs (lásd lent)
├─ scripts/                   # postinstall + coverage tooling
│  ├─ install-mm-bot.sh       # a `mm-bot` wrapper-t írja a node_modules/.bin/-be
│  ├─ coverage-full.sh        # tesztek + lefedettség + EGY nagy táblázat
│  └─ coverage-per-package.sh # per-csomag OWN 100% threshold check
├─ docs/
│  ├─ research/               # stack kutatás (verzió-pin-ek, indoklások)
│  ├─ production-strategies/  # 5 stratégia reference doksik
│  │  ├─ bot.md
│  │  └─ *.html               # stratégia-vizualizációk
│  ├─ CHANGELOG.md            # keep-a-changelog formátumú release history
│  ├─ ARCHITECTURE.md         # rendszer architektúra
│  ├─ STRUCTURE.md            # ez a fájl
│  ├─ STACK.md                # verzió-pin-ek + indoklás
│  ├─ TESTING.md              # tesztelési stratégia (3 réteg)
│  ├─ CI.md                   # 7 CI job
│  ├─ COMMANDS.md             # root package.json scriptek
│  ├─ CLI.md                  # mm-bot subcommand-ok
│  ├─ LIVE-TRADING.md         # live mód workflow
│  └─ DESIGN-SYSTEM.md        # EggProject design system
├─ apps/
│  ├─ bot/                    # @mm-crypto-bot/bot — a `mm-bot` CLI
│  │  ├─ src/
│  │  │  ├─ index.ts          # CLI belépési pont (shebang: #!/usr/bin/env bun)
│  │  │  ├─ cli/              # 8 subcommand implementáció (start, web, status, ...)
│  │  │  ├─ bot/              # futtató engine (Bot, StrategyRunner, OrderManager, ...)
│  │  │  ├─ config/           # TOML loader + Zod validáció
│  │  │  ├─ state-feed/       # TCP publisher (apps/bot → 127.0.0.1:7914)
│  │  │  └─ web-client/       # Hono + bun-websocket relay (127.0.0.1:7913)
│  │  └─ README.md            # OPERATOR-FACING DOKS (10 fejezet)
│  └─ web/                    # @mm-crypto-bot/web — a React dashboard
│     ├─ src/                 # App, components (ChartGrid, ControlBar, ...), lib, styles
│     ├─ e2e/                 # Playwright e2e suite + MSW mocks
│     ├─ playwright.config.ts
│     └─ vite.config.ts
└─ packages/
   ├─ shared/                 # típusok, util-ok, közös log-olás
   ├─ core/                   # stratégia-motor + signal-center
   ├─ exchange/               # CCXT adapter (bybit.eu) + mock + latency monitor
   ├─ backtest/               # backtest engine (cost model, metrics, OOS decay check)
   ├─ backtest-tools/         # baseline / sweep / OOS / report CLI eszközök
   └─ paper/                  # paper-trade engine (a `mm-bot` használja)
```
