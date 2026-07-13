# `mm-crypto-bot`

> Multi-timeframe trend-konfluencia kompozit kripto kereskedő bot, Bun + Turborepo + TypeScript ultra-strict monorepo architektúrában. bybit.eu SPOT-margin venue, paper + live mód.

## Státusz

**Phase 35+** — minden csomag implementálva, **8/8 package 100% line coverage** a saját `src/` fájljaira (standard `lcov` C tool, gate a CI-ban). A bot CLI (`mm-bot`) production-ready: 8 subcommand, Ink-alapú TUI, headless mód, color/NO_COLOR támogatás, 1:10 leverage három-rétegű védelem. **Live trading** egyelőre csak a user által manuálisan végrehajtandó workflow után (lásd [`apps/bot/README.md` §7](./apps/bot/README.md#7-live-testing-workflow-manual)).

| Artifact | Státusz |
|---|---|
| Monorepo + turbo pipeline | ✅ Phase 0-3 |
| Exchange adapter (bybit.eu / CCXT) + mock feed | ✅ Phase 4-7 |
| Backtest engine (cost model, metrics, OOS) | ✅ Phase 8-15 |
| Paper engine + PaperTrader | ✅ Phase 16-18 |
| Stratégiák (5 db: donchian, dydx-carry, cascade-fade, funding-flip, regime-detector) | ✅ Phase 19-25 |
| TUI (Ink + React, 6 panel, realtime < 100ms) | ✅ Phase 33-34 |
| `mm-bot` CLI (8 subcommand) | ✅ Phase 33-34 |
| Coverage gate (8/8 OWN 100%, standard lcov) | ✅ Phase 35c-d |
| **Live deploy** | ⏸️ user workflow (config + bybit.eu key + paper-test) |

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
| Coverage tool | `lcov` (apt/brew) — standard C tool, NEM custom | [github.com/linux-test-project/lcov](https://github.com/linux-test-project/lcov) |

A teljes indoklás: [`docs/research/version-pins.md`](./docs/research/version-pins.md),
[`docs/research/stack-findings.md`](./docs/research/stack-findings.md) és
[`docs/research/tui-decision.md`](./docs/research/tui-decision.md).

## Struktúra

```
mm-crypto-bot/
├─ package.json               # gyökér: Bun workspaces + turbo scriptek
│                             # + postinstall wrapper (scripts/install-mm-bot.sh)
├─ turbo.json                 # pipeline: build függ a ^build-től; cache: false
├─ tsconfig.base.json         # ultra-strict preset (@tsconfig/strictest alapján)
├─ eslint.config.js           # flat config: ts-eslint strict + security
├─ bunfig.toml                # Bun runtime beállítások
├─ .env.example               # környezeti változók dokumentációja
├─ .github/workflows/ci.yml   # CI: lint/typecheck/test+coverage/build, párhuzamosan
├─ scripts/                   # postinstall + coverage tooling
│  ├─ install-mm-bot.sh       # a `mm-bot` wrapper-t írja a node_modules/.bin/-be
│  ├─ coverage-full.sh        # tesztek + lefedettség + EGY nagy táblázat
│  └─ coverage-per-package.sh # per-csomag OWN 100% threshold check
├─ docs/
│  ├─ research/               # stack kutatás (verzió-pin-ek, indoklások)
│  └─ production-strategies/  # TUI + 5 stratégia reference doksik
│     ├─ tui.md               # TUI referencia (514 sor, 10 fejezet)
│     ├─ bot.md
│     └─ *.html               # stratégia-vizualizációk
├─ apps/
│  └─ bot/                    # @mm-crypto-bot/bot — a `mm-bot` CLI
│     ├─ src/
│     │  ├─ index.ts          # CLI belépési pont (shebang: #!/usr/bin/env bun)
│     │  ├─ cli/              # 8 subcommand implementáció
│     │  ├─ bot/              # futtató engine (Bot, StrategyRunner, OrderManager, ...)
│     │  ├─ config/           # TOML loader + Zod validáció
│     │  └─ bin/mm-bot        # (NEM kell külön — a postinstall generalja)
│     └─ README.md            # OPERATOR-FACING DOKS (630 sor, 10 fejezet)
└─ packages/
   ├─ shared/                 # típusok, util-ok, közös log-olás
   ├─ core/                   # stratégia-motor + signal-center
   ├─ exchange/               # CCXT adapter (bybit.eu) + mock + latency monitor
   ├─ backtest/               # backtest engine (cost model, metrics, OOS decay check)
   ├─ backtest-tools/         # baseline / sweep / OOS / report CLI eszközök
   ├─ paper/                  # paper-trade engine (a `mm-bot` használja)
   └─ tui/                    # ink-alapú TUI (6 panel, realtime < 100ms)
```

## TUI indítás

A TUI a `mm-bot` CLI **alapértelmezett** UI-ja (Phase 34 user mandate, eredeti spec §4.3 "Modern TUI felület, kötelező"). Három indítási mód van, mindegyikhez van `bun run <név>` wrapper és `mm-bot` közvetlen parancs is.

### 1. Teljes bot TUI-val (alapértelmezett, ajánlott fejlesztéshez)

```bash
# A botot indítja, TUI-val a fedélzeten. A TUI a state-ből olvas,
# a bot a feed-ből kapja a tickeket, a két fél a useSyncExternalStore-
# on keresztül van összekötve (realtime frissítés < 100ms).
bun run start
# VAGY (ha a node_modules/.bin/ a PATH-ban van):
mm-bot start
# VAGY (mindig működik, abszolút path):
./node_modules/.bin/mm-bot start
```

A TUI-ban a bot állapota látható (positions, equity, P&L, ticker, history), és a billentyűkkel lehet vezérelni (lásd lent). A bot addig fut, amíg ki nem lépsz.

### 2. TUI only — bot nélkül (UI demó, papír trading, reproducibilis szimuláció)

```bash
# Bot NÉLKÜL indítja a TUI-t. A TUI egy SimulatedProvider-ből
# vagy PaperProvider-ből kapja az adatokat, nincs valódi feed,
# nincs order placement — TISZTA UI/UX demó.
bun run tui
# VAGY:
mm-bot tui

# Specifikus adatforrás:
mm-bot tui --data-source=paper              # paper-trade engine
mm-bot tui --data-source=simulated --seed=42 # reproducibilis szimuláció
mm-bot tui --no-color                        # NO_COLOR=1
```

TUI-only módban a `[s]` és `[p]` billentyűk nem elérhetők (nincs bot, amit indítani kellene), a `[q]`, `[?]`, `[Tab]`, `[Ctrl+C]` igen.

### 3. Headless — plain text log (CI, scriptek, pipe-olt logok)

```bash
# A botot indítja TUI nélkül. Csak plain text log megy a stdout-ra,
# a @mm-crypto-bot/tui csomag NEM töltődik be (kisebb memóriafogyasztás).
bun run headless
# VAGY:
mm-bot start --headless
# VAGY szín nélkül:
mm-bot start --headless --no-color
```

### TUI billentyűk (keybinding reference)

| Billentyű | Mód | Funkció |
|---|---|---|
| `[s]` | TUI + bot | Bot indítása / leállítása (graceful) |
| `[p]` | TUI + bot | Szünet / folytatás (pause / resume) |
| `[k]` | TUI + bot | Kill-switch aktiválása (azonnali leállás) |
| `[q]` | minden | Kilépés (graceful shutdown + state flush) |
| `[Tab]` | TUI | Panel váltás (Statistics ↔ Live ↔ History ↔ ...) |
| `[?]` | TUI | Help overlay (megjeleníti a billentyűket) |
| `[Ctrl+C]` | minden | Azonnali kilépés (graceful is, ha van idő) |

### TUI panelek

- **Header** — mód (paper/live), uptime, equity, realized P&L (zöld/piros)
- **Statistics panel** — 11+ metrika: totalPnl, winRate, totalTrades, maxDrawdown, currentDrawdown, profitFactor, avgWin, avgLoss, equity, sharpe, ...
- **Live trading panel** — BTC/ETH/SOL ticker (ár + 24h change) + utolsó 5 ticker event
- **History list** — utolsó 100 lezárt trade, sortable (time / pnl / symbol)
- **Status bar** — kill-switch állapot, last error, futó stratégiák
- **Help overlay** — `[?]` megnyomására jelenik meg

A teljes TUI referencia: [`docs/production-strategies/tui.md`](./docs/production-strategies/tui.md) (514 sor, 10 fejezet, panelenkénti leírás + bundle guarantees + korlátok).

### Ha a `mm-bot` parancs nem található

A `bun install` egy postinstall hookkal `bash scripts/install-mm-bot.sh` bash wrapper-t ír a `node_modules/.bin/mm-bot`-ba (kikerüli a [bun ismert bug-ját](https://github.com/oven-sh/bun/issues/19782), hogy a workspace `bin` mező nem symlink-elődik). Ha valamiért mégis hiányzik:

```bash
# Ellenőrizd:
ls -la node_modules/.bin/mm-bot

# Ha nincs, generáld újra:
bash scripts/install-mm-bot.sh

# Vagy használd a `bun run` wrapper-t (mindig működik):
bun run mm-bot start
bun run mm-bot tui
```

## CLI reference (`mm-bot`)

A `mm-bot` CLI 8 subcommand-ot ismer. Mindegyik elérhető `mm-bot <subcommand>` és `bun run bot:<subcommand>` formában is.

| Subcommand | Leírás | Példa |
|---|---|---|
| `start` | Bot indítása (alapért. TUI; `--headless` flag-gel plain text) | `mm-bot start` |
| `tui` | TUI indítása bot nélkül (simulated / paper) | `mm-bot tui --seed=42` |
| `status` | Perzisztens state kiírása (equity, P&L, positions, history) | `mm-bot status` |
| `config` | Config validate / show / init | `mm-bot config show` |
| `strategies` | Regisztrált stratégiák listája (ON / OFF) | `mm-bot strategies` |
| `trades` | Utolsó N lezárt trade kiírása | `mm-bot trades --limit=20` |
| `kill-switches` | Kill-switch állapot (max-DD, max-positions, latency-gate, ...) | `mm-bot kill-switches` |
| `help` | Help (vagy `mm-bot --help`) | `mm-bot help` |

Részletes CLI doksi: [`apps/bot/README.md` §3](./apps/bot/README.md#3-cli-reference) (exit codes, flag-ek, example invocations).

## Parancsok (root `package.json`)

### Fejlesztés

```bash
bun install                  # telepítés (Bun workspaces + postinstall wrapper)
bun run dev                  # watch-mód (minden csomag párhuzamosan)
bun run build                # build (minden csomag, topológiai sorrendben, turbo cache: false)
bun run lint                 # eslint flat config, ultra-strict
bun run typecheck            # tsc --noEmit, minden strict flaggel
bun run test                 # vitest, minden csomag
```

### Bot vezérlés

```bash
bun run start                # TUI + bot (alapért.)
bun run headless             # bot, plain text log, TUI nélkül
bun run tui                  # TUI only, bot nélkül
bun run bot:status           # state kiírása
bun run bot:config           # config validate / show / init
bun run bot:strategies       # stratégiák listája
bun run bot:trades           # utolsó N trade
bun run bot:kill-switches    # kill-switch állapot
bun run bot:help             # help
```

### Backtest tooling

```bash
bun run backtest             # baseline backtest futtatás
bun run sweep                # paraméter-sweep (multi-config)
bun run oos                  # out-of-sample decay check
bun run report               # HTML riport generálás
bun run ohlcv                # OHLCV adat letöltés (CCXT)
```

### Coverage (100% per-package OWN gate)

```bash
bun run coverage             # lcov-ot generál minden csomagra
bun run coverage:per-package # 8/8 OWN 100% threshold check (CI gate)
bun run coverage:merge       # egyesített lcov (informational)
bun run coverage:report      # egyesített summary
bun run coverage:html        # HTML riport (coverage/merged/html/)
bun run coverage:enforce     # = coverage:per-package
bun run coverage:full        # MINDEN: tesztek (no cache) + lcov + EGY nagy táblázat
```

A `coverage:full` a CI-ban is fut (informational): tesztek láthatóan futnak (no turbo cache), lcov generálódik, **egyetlen ASCII táblázat** a végén (8/8 PASS + 51.2% merged informational). A standard `lcov` C tool-t használja (apt: `apt-get install lcov`, brew: `brew install lcov`), NEM custom kódot.

### Egyéb

```bash
bun run clean                # minden build/test artifact (node_modules, .turbo, coverage)
```

## Coverage garancia

A user mandátuma: **8/8 package 100% line coverage a saját `src/` fájljaira** (per-package OWN). A CI ezt gate-ként futtatja:

```
$ bun run coverage:per-package
+ ------------------------ + ------ + ---------------------------------------- +
| Package                | Stat  | Line coverage                          |
| ------------------------ | ------ | ---------------------------------------- |
| apps/bot               | PASS  | 100.0% (2410 of 2410 lines)            |
| packages/paper         | PASS  | 100.0% (251 of 251 lines)              |
| packages/exchange      | PASS  | 100.0% (868 of 868 lines)              |
| packages/core          | PASS  | 100.0% (12124 of 12124 lines)          |
| packages/tui           | PASS  | 100.0% (1043 of 1043 lines)            |
| packages/shared        | PASS  | 100.0% (161 of 161 lines)              |
| packages/backtest      | PASS  | 100.0% (754 of 754 lines)              |
| packages/backtest-tools | PASS  | 100.0% (2289 of 2289 lines)            |
+ ------------------------ + ------ + ---------------------------------------- +

Result: 8/8 PASS
```

Az egyesített (cross-package importokat is tartalmazó) lefedettség jelenleg **51.2%** — ez a 100%-hoz 50+ új tesztfájlt igényelne (multi-week scope, nem része ennek a mandátumnak).

## Live trading

A bot **alapértelmezetten paper módban** fut (mock feed, nincs valódi pénz). A live módba váltás operator workflow-t igényel (config + bybit.eu API key + paper-test időszak + manuális promote). A teljes 5 lépéses workflow: [`apps/bot/README.md` §7](./apps/bot/README.md#7-live-testing-workflow-manual).

A `BYBIT_API_KEY` / `BYBIT_API_SECRET` env var-ok a `.env` fájlból töltődnek (`.env.example` a séma). A bot `mode = "live"` esetén figyelmeztet, ha a key hiányzik.

## Dokumentáció

| Dokumentum | Leírás |
|---|---|
| [`apps/bot/README.md`](./apps/bot/README.md) | **Operator-facing** doksi (630 sor, 10 fejezet): quick start, config, CLI ref, stratégiák, 1:10 leverage védelem, live testing workflow, architektúra, coverage, korlátok |
| [`docs/production-strategies/tui.md`](./docs/production-strategies/tui.md) | **TUI referencia** (514 sor, 10 fejezet): quick start, módok, layout, panelenkénti leírás, keybindings, color/TTY, TUI-only mód, bundle guarantees, korlátok |
| [`docs/research/`](./docs/research/) | Stack kutatás: verzió-pin-ek indoklása, stack alternatívák, TUI framework döntés |
| [`docs/production-strategies/`](./docs/production-strategies/) | Stratégia-vizualizációk (HTML) + 5 stratégia reference (bot.md, dydx-cex-carry.html, cascade-fade.html, donchian-*.html, ...) |
| [`docs/audits/`](./docs/audits/) | Audit doksik (coverage döntés, Phase 35d scope, ...) |

## License

Private project — all rights reserved.
