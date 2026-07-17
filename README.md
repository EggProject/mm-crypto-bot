# `mm-crypto-bot`

> Multi-timeframe trend-konfluencia kompozit kripto kereskedő bot, Bun + Turborepo + TypeScript ultra-strict monorepo architektúrában. bybit.eu SPOT-margin venue, paper + live mód.

## Quick start (web dashboard)

The bot runs in two separate processes, each in its own terminal. The web client is the user-facing UI; the bot is the headless engine that publishes state to it.

**Terminal 1 — the bot (headless, pure engine + state-feed publisher):**

```bash
bun run start --config=run-bot/config/default.toml
# VAGY (ha a node_modules/.bin/ a PATH-ban van):
mm-bot start --config=run-bot/config/default.toml
```

The bot starts and prints a single status line to stderr:

```
[start] state-feed listening on 127.0.0.1:7914
```

**Terminal 2 — the web client (HTTP + WebSocket + REST + SPA):**

```bash
mm-bot web
```

The web client connects to the bot's state-feed, then starts an HTTP server and prints:

```
[web] state-feed reachable — starting web client
[web] web client listening on http://127.0.0.1:7913
```

**Browser — open the dashboard:**

```
http://127.0.0.1:7913
```

The dashboard loads with:

- **Top-nav** — `mm-crypto-bot` brand mark on the left, `[● connected]` status pill on the right
- **Chart grid** — one `ChartCard` per `(symbol, timeframe)` pair from the active strategy
- **Positions table** — open positions with `qty`, `entry`, `mark`, `uPnl` columns
- **Sticky control bar** — `Start` / `Stop` / `Pause` / `Resume` / `Kill Switch` buttons at the bottom of the viewport

If the `mm-bot` command is not found after `bun install`, regenerate the wrapper (the postinstall hook normally handles this):

```bash
bash scripts/install-mm-bot.sh
# VAGY használd a `bun run` wrapper-t (mindig működik):
bun run mm-bot start
bun run mm-bot web
```

## Státusz

**Phase 51** — web dashboard fully shipped (Phases 44-51). 7/7 server packages at 100% line coverage on OWN `src/` files (standard `lcov` C tool, gate in CI). The `mm-bot` CLI is production-ready: 8 subcommands, pure headless bot, separate web client process, 1:10 leverage three-layer protection. **Live trading** is gated on a user-run workflow (config + bybit.eu key + paper-test) — see [`apps/bot/README.md` §7](./apps/bot/README.md#7-live-testing-workflow-manual).

| Artifact | Státusz |
|---|---|
| Monorepo + turbo pipeline | ✅ Phase 0-3 |
| Exchange adapter (bybit.eu / CCXT) + mock feed | ✅ Phase 4-7 |
| Backtest engine (cost model, metrics, OOS) | ✅ Phase 8-15 |
| Paper engine + PaperTrader | ✅ Phase 16-18 |
| Stratégiák (5 db: donchian, dydx-carry, cascade-fade, funding-flip, regime-detector) | ✅ Phase 19-25 |
| State-feed publisher (TCP, ND-JSON, 4Hz throttle) | ✅ Phase 45 |
| Web client (Hono + bun-websocket + static server) | ✅ Phase 46 |
| `apps/web` SPA skeleton (React 19 + Vite 6 + lightweight-charts) | ✅ Phase 47 |
| WS client + reconnect + ControlBar + PositionsTable | ✅ Phase 47 |
| Chart grid + multi-TF + OHLC bootstrap | ✅ Phase 48 |
| Indicator registry (Donchian, funding, cascade, signals) | ✅ Phase 49 |
| Realtime batching (rAF) | ✅ Phase 50 |
| Playwright e2e + MSW + CI gate | ✅ Phase 48D |
| **Deployment README + final smoke test** | ✅ Phase 51 |
| **Live deploy** | ⏸️ user workflow (config + bybit.eu key + paper-test) |

## Stack (verzió-pin-ek)

| Komponens | Verzió | Forrás |
|---|---|---|
| Runtime | Bun `1.3.14` | [registry.npmjs.org/bun](https://registry.npmjs.org/bun) |
| Monorepo / pipeline | Turborepo `2.10.2` | [registry.npmjs.org/turbo](https://registry.npmjs.org/turbo) |
| Nyelv | TypeScript `6.0.3` (ultra-strict) | [registry.npmjs.org/typescript](https://registry.npmjs.org/typescript) |
| Exchange | CCXT `4.5.64` (`bybiteu` ID) | [registry.npmjs.org/ccxt](https://registry.npmjs.org/ccxt) |
| Web SPA | React `>=19.2.0` + Vite `^6.0.0` | [registry.npmjs.org/vite](https://registry.npmjs.org/vite) |
| Charts | `lightweight-charts` `^5.2.0` | [github.com/tradingview/lightweight-charts](https://github.com/tradingview/lightweight-charts) |
| Web client (apps/bot) | Hono (HTTP) + `bun-websocket` (WS relay) | [hono.dev](https://hono.dev) |
| State-feed protocol | TCP loopback, ND-JSON, 4Hz throttle, 10s PING / 30s PONG | `apps/bot/src/state-feed/protocol.ts` |
| Linter | ESLint `10.6.0` + typescript-eslint `8.62.1` strict-type-checked + eslint-plugin-security `4.0.1` | [typescript-eslint.io](https://typescript-eslint.io/users/configs/) |
| Teszt (server) | Vitest `^4.1.9` + `@vitest/coverage-v8` | [vitest.dev](https://vitest.dev) |
| Teszt (web e2e) | Playwright `^1.49.0` + MSW `^2.15.0` | [playwright.dev](https://playwright.dev) |
| Coverage tool | `lcov` (apt/brew) — standard C tool, NEM custom | [github.com/linux-test-project/lcov](https://github.com/linux-test-project/lcov) |

A teljes indoklás: [`docs/research/version-pins.md`](./docs/research/version-pins.md) és
[`docs/research/stack-findings.md`](./docs/research/stack-findings.md).

## Architecture (Phase 51 final)

```
   Terminal 1                           Terminal 2                          Browser
  ┌──────────────────┐                ┌──────────────────┐               ┌──────────────┐
  │   mm-bot start   │  TCP 7914      │    mm-bot web    │  HTTP+WS 7913 │  Dashboard   │
  │                  │  ND-JSON       │                  │  + REST       │              │
  │  • Bot engine    │ ─────────────► │  • Hono server   │ ────────────► │  • React 19  │
  │  • 5 strategies  │                │  • WS relay      │               │  • Vite 6    │
  │  • State-feed    │                │  • Static server │               │  • lw-charts │
  │    publisher     │                │  • REST proxy    │               │  • EggProject│
  └──────────────────┘                └──────────────────┘               └──────────────┘
       (pure headless)              (separate process)                  (apps/web/dist)
```

- The **bot** (Terminal 1) is pure headless — no UI, no TUI, no Ink. It publishes its full state over a TCP loopback to `127.0.0.1:7914` as newline-delimited JSON (`HELLO` / `SNAPSHOT` / `TICK` / `BAR` / `PING` / `PONG` messages).
- The **web client** (Terminal 2) is a thin relay: it consumes the state-feed and re-publishes it to browsers over WebSocket, plus proxies REST calls (`/api/strategies`, `/api/positions`, etc.). It also serves the built `apps/web/dist/` SPA.
- The **dashboard** (Browser) is a React 19 + Vite 6 SPA. The state-feed protocol is wrapped in a `useWebSocket()` hook with auto-reconnect (1s → 30s exponential backoff) and a `RealtimeBatcher` (rAF-driven) for high-frequency updates.

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
├─ .github/workflows/ci.yml   # CI: 7 jobs (lásd lent)
├─ scripts/                   # postinstall + coverage tooling
│  ├─ install-mm-bot.sh       # a `mm-bot` wrapper-t írja a node_modules/.bin/-be
│  ├─ coverage-full.sh        # tesztek + lefedettség + EGY nagy táblázat
│  └─ coverage-per-package.sh # per-csomag OWN 100% threshold check
├─ docs/
│  ├─ research/               # stack kutatás (verzió-pin-ek, indoklások)
│  └─ production-strategies/  # 5 stratégia reference doksik
│     ├─ bot.md
│     └─ *.html               # stratégia-vizualizációk
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

## Design system (apps/web)

The dashboard uses the **EggProject design system** — a dark-mode-first token set (colors, typography, spacing) with components (buttons, cards, badges, indicators) and a `lc-wrap` chart chrome (price scale, time scale, range tabs, symbol/strategy badges).

The CSS is **vendored locally** under `apps/web/src/styles/` (per the "skills are documentation, not code dependencies" project rule — the build is self-contained, no symlink required). The `chart-card.css` file is a hand-curated subset of the design tokens + the `lc-wrap` rules needed for the chart cards. Reference doksi for the design system: [`.mavis/notes/design-system.md`](./.mavis/notes/design-system.md).

A `data-theme="dark"` (or `"light"`) attribute on `<html>` switches the entire token set at once; the theme is persisted to `localStorage` and read on page load.

## Testing

The monorepo has three test layers:

### 1. Server unit / integration tests (Vitest)

Every server package (`apps/bot`, `packages/*`) has its own `*.test.ts` files co-located with the source. Run individually per package or all at once:

```bash
bun run test                # minden csomag, Vitest
```

### 2. Server coverage (100% per-package OWN gate)

The user mandate is **7/7 server packages at 100% line coverage on their OWN `src/` files**. The CI gate is enforced by `scripts/coverage-per-package.sh`:

```bash
bun run coverage             # lcov-ot generál minden csomagra
bun run coverage:per-package # 7/7 OWN 100% threshold check (CI gate)
bun run coverage:merge       # egyesített lcov (informational)
bun run coverage:report      # egyesített summary
bun run coverage:html        # HTML riport (coverage/merged/html/)
bun run coverage:enforce     # = coverage:per-package
bun run coverage:full        # MINDEN: tesztek (no cache) + lcov + EGY nagy táblázat
```

The `apps/web` package is **intentionally exempt** from the 100% per-package gate — its test surface is the Playwright e2e suite (see below), not Vitest.

### 3. Web e2e tests (Playwright + MSW)

`apps/web/e2e/dashboard.spec.ts` runs against a coverage-instrumented production build served via `vite preview` on `127.0.0.1:7913` (the same loopback port the production web-client uses). MSW intercepts fetch and WebSocket in the browser so the test exercises the real app code with deterministic mock data.

```bash
cd apps/web
bun run e2e                 # Playwright + MSW (fast path)
bun run e2e:full            # Playwright + MSW + nyc coverage report (30-min cap)
bun run e2e:headed          # headed mode (debug)
```

The e2e suite enforces **95% lines / 90% branches / 95% functions** on `apps/web/src/**` via `nyc check-coverage`. The CI uploads the coverage report and the Playwright HTML report as artifacts.

## CI (7 jobs)

GitHub Actions runs the following jobs in parallel on every PR (`.github/workflows/ci.yml`):

| # | Job | What it checks |
|---|---|---|
| 1 | `install-no-warnings` | `bun install` finishes with zero peer-dep warnings |
| 2 | `typecheck` | `tsc --noEmit` across all 8 packages with ultra-strict settings |
| 3 | `lint` | ESLint flat config (strict-type-checked + security plugin) — zero warnings |
| 4 | `build` | `turbo run build` (cache: false) — every package compiles |
| 5 | `coverage` | `bun run coverage:per-package` — 7/7 server packages at 100% OWN |
| 6 | `test` | `bun run test` — every Vitest suite passes |
| 7 | `e2e:playwright` | `cd apps/web && bun run e2e` — Playwright + MSW + 95% coverage gate (20-min suite timeout) |

A PR is mergeable only when all 7 jobs are green.

## CLI reference (`mm-bot`)

A `mm-bot` CLI 8 subcommand-ot ismer. Mindegyik elérhető `mm-bot <subcommand>` és `bun run bot:<subcommand>` formában is.

| Subcommand | Leírás | Példa |
|---|---|---|
| `start` | Bot indítása (PURE HEADLESS) | `mm-bot start --config=run-bot/config/default.toml` |
| `web` | Web client indítása (külön process) | `mm-bot web` |
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

### Bot + web vezérlés

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

### Backtest tooling

```bash
bun run backtest             # baseline backtest futtatás
bun run sweep                # paraméter-sweep (multi-config)
bun run oos                  # out-of-sample decay check
bun run report               # HTML riport generálás
bun run ohlcv                # OHLCV adat letöltés (CCXT)
```

### Coverage (100% per-package OWN gate)

Lásd fent (Testing §2).

### Egyéb

```bash
bun run clean                # minden build/test artifact (node_modules, .turbo, coverage)
```

## Coverage garancia

A user mandátuma: **7/7 server packages 100% line coverage a saját `src/` fájljaira** (per-package OWN). A CI ezt gate-ként futtatja:

```
$ bun run coverage:per-package
======================================================================
  Per-package OWN coverage (standard lcov --remove + 100% line check)
======================================================================

  ✓ apps/bot                       100.0%  (own src/)
  ✓ packages/paper                 100.0%  (own src/)
  ✓ packages/exchange              100.0%  (own src/)
  ✓ packages/core                  100.0%  (own src/)
  ✓ packages/shared                100.0%  (own src/)
  ✓ packages/backtest              100.0%  (own src/)
  ✓ packages/backtest-tools        100.0%  (own src/)

Result: 7/7 PASS
```

Az egyesített (cross-package importokat is tartalmazó) lefedettség jelenleg **51.2%** — ez a 100%-hoz 50+ új tesztfájlt igényelne (multi-week scope, nem része ennek a mandátumnak).

A `apps/web` package saját lefedettsége a **Playwright e2e suite-ből** jön (`apps/web/coverage/playwright/`), nem a Vitest-ből. A 95/90/95% gate a CI `e2e:playwright` job-ban fut, és a `nyc check-coverage` enforce-eli.

## Live trading

A bot **alapértelmezetten paper módban** fut (mock feed, nincs valódi pénz). A live módba váltás operator workflow-t igényel (config + bybit.eu API key + paper-test időszak + manuális promote). A teljes 5 lépéses workflow: [`apps/bot/README.md` §7](./apps/bot/README.md#7-live-testing-workflow-manual).

A `BYBIT_API_KEY` / `BYBIT_API_SECRET` env var-ok a `.env` fájlból töltődnek (`.env.example` a séma). A bot `mode = "live"` esetén figyelmeztet, ha a key hiányzik.

## Project status

Aktuális project státusz, fázis roadmap, és a Phase 44-51 lezárása: [`.mavis/notes/board.md`](./.mavis/notes/board.md).

## Dokumentáció

| Dokumentum | Leírás |
|---|---|
| [`apps/bot/README.md`](./apps/bot/README.md) | **Operator-facing** doksi (10 fejezet): quick start, config, CLI ref, stratégiák, 1:10 leverage védelem, live testing workflow, architektúra, coverage, korlátok |
| [`apps/web/README.md`](./apps/web/README.md) | **Web dashboard** doksi: dev server, production build, e2e suite, komponens struktúra, state-feed protokoll, MSW setup |
| [`docs/research/`](./docs/research/) | Stack kutatás: verzió-pin-ek indoklása, stack alternatívák |
| [`docs/production-strategies/`](./docs/production-strategies/) | Stratégia-vizualizációk (HTML) + 5 stratégia reference (bot.md, dydx-cex-carry.html, cascade-fade.html, donchian-*.html, ...) |
| [`docs/audits/`](./docs/audits/) | Audit doksik (coverage döntés, scope, ...) |
| [`.mavis/notes/board.md`](./.mavis/notes/board.md) | Project board — fázis roadmap + státusz |

## License

Private project — all rights reserved.
