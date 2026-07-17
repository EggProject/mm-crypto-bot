# Phase 44–50 — Web Dashboard (WebSocket + EggProject Design + TUI Removal)

**Author:** orchestrator (Mavis)
**Date:** 2026-07-16 Budapest
**Status:** ⚠️ SUPERSEDED by `phase44-v2-plan.md` (2026-07-16 16:55 Budapest)
**Reason for supersession:** User correction 2026-07-16 16:53 — the bot must be PURE headless, and the web client (WS + web UI) must be a SEPARATE COMMAND that runs in a separate terminal. The v1 plan put the WS server inside the bot process (wrong). The v2 plan splits the bot and the web client into two processes; the bot exposes a tiny state-feed TCP listener and uses zero web-stack resources when only headless is needed.
**For the authoritative plan, read:** `.mavis/notes/phase44-v2-plan.md`

---

## 1. Executive summary (v1 — see v2 plan for the corrected architecture)

---

## 1. Executive summary

The TUI was the right call when the bot was research-only. Now that the bot is production-bound (paper/live trading), the operator surface needs to be a **modern web app** that:

- Streams every strategy's chart in real time, one chart per (strategy × timeframe) pair, with the strategy's own indicators overlaid.
- Lives in the browser, opened from a URL, no terminal emulator needed.
- Shares the EggProject design system (gold + sapphire, warm paper / warm graphite, Roboto, AA contrast) — the same look the rest of the EggProject products ship with.
- Uses `lightweight-charts@5.2.0` via the vendored `eggproject-design-trade-components/lc-wrap` — the project's mandated chart library.

**Hard constraints from the user mandate:**

- **TUI is deleted.** `packages/tui/` and `apps/bot/src/tui/` go away entirely. No `--tui` flag, no `mm-bot tui` subcommand, no Ink dependency in the bot runtime.
- **Bot stays headless by default.** `mm-bot start` runs the bot without any UI. The web server is a separate command (`mm-bot serve` or `mm-bot web`) that the user starts in a separate terminal.
- **The web app is a real Turbo workspace package** (`apps/web/`) — React + Vite + Bun, sibling to `apps/bot/`. The whole monorepo continues to share `@mm-crypto-bot/*` packages.
- **Coverage mandate unchanged.** 8/8 packages at 100% OWN line coverage, 6/6 CI gates green on every PR.

---

## 2. Current architecture (what we're replacing)

### 2.1 What exists today (Phase 38 + 43 closure)

```
apps/bot/
├── src/
│   ├── bot/bot.ts                 # Bot orchestrator
│   ├── cli/commands/
│   │   ├── start.ts               # mm-bot start — auto/headless branch
│   │   ├── tui.ts                 # mm-bot tui  ← DELETED
│   │   ├── status.ts              # mm-bot status
│   │   ├── config.ts              # mm-bot config {validate|show|init|edit}
│   │   ├── backtest.ts            # mm-bot backtest
│   │   ├── strategies.ts          # mm-bot strategies
│   │   ├── trades.ts              # mm-bot trades
│   │   ├── kill-switches.ts       # mm-bot kill-switches
│   │   └── kill-switch-dry-run.ts # mm-bot kill-switch-dry-run
│   └── tui/                       # ← DELETED (apps/bot/src/tui/)
│       ├── live-bot-state-provider.ts
│       └── *-probe*.test.tsx
└── package.json                   # depends on @mm-crypto-bot/tui, ink, @inkjs/ui

packages/tui/                       # ← DELETED
├── src/
│   ├── App.tsx, app-logic.ts
│   ├── components/{Header,StatisticsPanel,LiveTradingPanel,HistoryList,ChartsPanel,SettingsPanel,...}.tsx
│   ├── charts/{candlestick,equity-curve,sparkline,bar-chart}.{ts,tsx}
│   ├── providers/{BotStateProvider,SimulatedProvider,PaperProvider}.ts
│   ├── hooks/{useBotState,useConfigStore,useOhlcBars,useTerminalSize}.ts
│   └── index.ts, index.tsx, render.tsx
└── package.json                   # depends on ink@7.1.0, react@19, @inkjs/ui
```

### 2.2 The TUI's runtime contract (must be preserved in the WS server)

The TUI's `LiveBotStateProvider` exposes a `BotStateProvider` interface (`packages/tui/src/providers/BotStateProvider.ts`) that the Ink `App` consumes. The mapping from `Bot.subscribe(listener)` to `TuiBotState` (positions, statistics, history, tickers, tickerEvents, paused, killSwitch, killSwitchThresholdPct) is the de-facto state surface. The web dashboard needs the same surface — exposed over WebSocket — and the new `Bot` must continue to publish it.

That mapping lives at `apps/bot/src/tui/live-bot-state-provider.ts` (rename to `live-bot-state-publisher.ts` and move to `apps/bot/src/server/state-publisher.ts` in Phase 45).

### 2.3 What gets removed

| File / module | Reason |
|---|---|
| `packages/tui/` (entire package) | TUI is gone |
| `apps/bot/src/tui/` | TUI bridge gone; the publisher lives elsewhere |
| `apps/bot/src/cli/commands/tui.ts` | Subcommand removed |
| `--tui` flag (in argv parser) | No more TUI |
| Ink-related deps from `apps/bot/package.json` (`@mm-crypto-bot/tui`, `ink`, `@inkjs/ui`, `react`, `react-dom`, `@types/react`, `ink-testing-library`) | Not needed |
| Phase 36 A1/A2/B1/B2/C1/C2 + Phase 38 #38/39 + Phase 43 T2/T3 changes | The TUI is gone, so the bugfixes ship as a single deletion commit + the new publisher gets the relevant bits |

### 2.4 What stays

- `apps/bot/src/bot/bot.ts` — the Bot, its `subscribe(listener)` API, the `getState()` shape. Nothing in the bot changes (publisher attaches externally).
- `apps/bot/src/cli/commands/start.ts` — but it now ONLY runs the bot, no TUI/headless dichotomy. The `--headless` flag is removed because `headless` is now the **only** mode.
- `apps/bot/src/cli/commands/{status,config,backtest,strategies,trades,kill-switches,kill-switch-dry-run}.ts` — all the existing CLI subcommands stay.
- `packages/core`, `packages/exchange`, `packages/paper`, `packages/shared`, `packages/backtest`, `packages/backtest-tools` — untouched. They publish the same data the TUI consumed.

---

## 3. Target architecture

### 3.1 Process topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  Terminal 1: mm-bot start  (headless)                                │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Bot  (apps/bot/src/bot/bot.ts)                              │    │
│  │  ├─ StateStore (in-memory + persisted JSON)                 │    │
│  │  ├─ PortfolioManager / RiskManager / OrderManager / ...     │    │
│  │  ├─ StrategyRunner (one runner per enabled strategy × TF)   │    │
│  │  └─ LiveBotStatePublisher → WebSocketServer (port 7913)      │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                    │ ws://127.0.0.1:7913
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Terminal 2: mm-bot serve  (web server, dev mode)                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Bun + Hono HTTP server (apps/bot/src/server/index.ts)       │    │
│  │  ├─ GET  /              → static index.html                  │    │
│  │  ├─ GET  /api/strategies → list enabled strategies + TFs     │    │
│  │  ├─ POST /api/control   → start/stop/pause/kill-switch       │    │
│  │  ├─ GET  /api/ohlc      → historical OHLC bars (REST)         │    │
│  │  ├─ WS   /ws            → realtime state + tick stream        │    │
│  │  └─ BUN_FRONTEND_BUNDLE → serves the built web app           │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                    │ http://127.0.0.1:7913
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Browser: http://127.0.0.1:7913                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  apps/web/  (React 19 + Vite 6 + lightweight-charts 5.2.0)  │    │
│  │  ├─ Top-nav shell (eggproject-design-app-common)             │    │
│  │  ├─ Charts grid: one <LcWrap> per (strategy × timeframe)    │    │
│  │  ├─ Indicator overlays per strategy (DPC → Donchian + pivot   │    │
│  │  │   markers, cascade-fade → cascade markers + liquidation   │    │
│  │  │   zones, dydx_cex_carry → funding-rate pane)              │    │
│  │  ├─ Stats strip (P&L, drawdown, win-rate, equity curve)      │    │
│  │  ├─ Positions table (TanStack, vendored in B)               │    │
│  │  └─ Control bar (start/stop/pause/kill-switch — POST)        │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

The user runs `mm-bot start` in terminal 1, `mm-bot serve` in terminal 2, and opens the browser.

### 3.2 WebSocket protocol (Phase 45 spec)

Wire format: **JSON**, one message per `ws.send()`. `Content-Type: application/json` on the HTTP upgrade. Heartbeat: server pings every 10s, client must pong within 30s or gets closed.

#### 3.2.1 Server → Client (after WS upgrade)

```jsonc
// 1) Initial state snapshot — sent once on connect
{
  "type": "snapshot",
  "ts": 1784180000000,
  "bot": {
    "running": false,
    "mode": "paper" | "live",
    "equity": 10000,
    "initialEquity": 10000,
    "realizedPnl": 0,
    "positions": [ /* BotState.positions[] */ ],
    "closedTrades": [ /* BotState.closedTrades[] */ ]
  },
  "strategies": [
    { "name": "donchian_pivot_composition", "enabled": true, "timeframes": ["1d", "4h", "1h"], "indicators": ["donchian", "pivot"], "signals": [] }
  ],
  "ohlcBootstrap": {
    "BTC/USDC": { "1h": [/* 200 bars */], "4h": [...], "1d": [...] },
    "ETH/USDC": { "1h": [...], ... },
    "SOL/USDC": { ... }
  }
}

// 2) Realtime tick (per WS message, throttled to 4 Hz per symbol)
{
  "type": "tick",
  "ts": 1784180000123,
  "symbol": "BTC/USDC",
  "price": 60123.45,
  "ohlc": { "1m": { "time": 1784180000, "open": 60100, "high": 60150, "low": 60080, "close": 60123.45, "volume": 12.5 } }
}

// 3) Bar close (per bar, per timeframe)
{
  "type": "bar",
  "ts": 1784180000000,
  "symbol": "BTC/USDC",
  "timeframe": "1h",
  "ohlc": { "time": 1784180000, "open": 60100, "high": 60150, "low": 60080, "close": 60123.45, "volume": 12.5 }
}

// 4) Indicator update (per (strategy, timeframe, indicator))
{
  "type": "indicator",
  "ts": 1784180000000,
  "strategy": "donchian_pivot_composition",
  "timeframe": "1h",
  "indicator": "donchian",
  "series": {
    "upper": [ { "time": 1784180000, "value": 60500 }, ... ],
    "lower": [ { "time": 1784180000, "value": 59800 }, ... ],
    "middle": [ { "time": 1784180000, "value": 60150 }, ... ]
  }
}

// 5) Signal / marker (per strategy signal — enters/exits)
{
  "type": "marker",
  "ts": 1784180000000,
  "strategy": "donchian_pivot_composition",
  "timeframe": "1h",
  "side": "long" | "short" | "info",
  "price": 60100,
  "label": "ENTER_LONG  minConsensus=2/3"
}

// 6) State delta (positions, statistics, kill-switch, paused)
{
  "type": "state",
  "ts": 1784180000000,
  "positions": [ /* updated positions[] */ ],
  "closedTrades": [ /* newest first, capped at 200 */ ],
  "killSwitch": "armed" | "confirm" | "triggered",
  "paused": false,
  "statistics": { "totalPnlUsdt": 12.5, "winRate": 60, "maxDrawdownPct": 1.2, ... }
}

// 7) Engine error (after Phase 43 Track 2, surfaces startup failures)
{
  "type": "error",
  "ts": 1784180000000,
  "message": "DydxFundingSource missing",
  "recoverable": true
}
```

#### 3.2.2 Client → Server

```jsonc
// Subscribe to a specific (symbol, timeframe) OHLC stream
{ "type": "subscribe", "symbol": "BTC/USDC", "timeframe": "1h" }

// Unsubscribe
{ "type": "unsubscribe", "symbol": "BTC/USDC", "timeframe": "1h" }

// Control commands
{ "type": "control", "command": "start" }
{ "type": "control", "command": "stop" }
{ "type": "control", "command": "pause", "paused": true }
{ "type": "control", "command": "kill_switch", "confirm": true }

// Pong (heartbeat)
{ "type": "pong", "ts": 1784180000000 }
```

### 3.3 Data flow per (strategy × timeframe)

The web app renders one `<LcWrap>` per enabled (strategy, timeframe) pair. The bot's `StrategyRunner` already runs one instance per enabled strategy; the publisher re-emits that instance's `Signal[]` and indicator snapshots as `marker` and `indicator` messages. Per-TF indicator computation is **the strategy's responsibility** — the publisher doesn't recompute, it just serializes what the strategy has already produced.

For `donchian_pivot_composition` (3 TFs):
- 1 candlestick chart per TF
- Donchian channel (upper/middle/lower) overlay
- Pivot-point markers at the consensus-bar close
- Long/short entry markers

For `cascade_fade` (1 TF = 1m):
- 1 candlestick chart
- Cascade event markers (where a liquidation cluster formed)
- Liquidation heatmap-style shading (optional, Phase 50)

For `dydx_cex_carry` (3 TFs = 1h, 4h, 1d):
- 3 candlestick charts (or 1 candlestick + 1 funding-rate pane, depending on UX)
- Funding-rate overlay (separate `line` series on the same chart, gold line per eggproject-design)
- Spread (dydx − cex) line
- Long/short entry markers

This is the user's mandate: "minden futó stratégiának szeretnék látni legalább egy chartot. egy stratégia több idősíkon is fut, akkor minden idősíkon egy külön chart legyen."

---

## 4. Phase breakdown (8 phases, ~6 weeks calendar, 1 PR per phase)

| # | Phase | Scope | PRs | Owner role |
|---|-------|-------|-----|------------|
| 44 | **TUI Removal** | Delete `packages/tui/`, `apps/bot/src/tui/`, `apps/bot/src/cli/commands/tui.ts`, `--tui` flag, all ink deps. Rename `live-bot-state-provider.ts` → `live-state-publisher.ts` and move to `apps/bot/src/server/`. Strip the TUI surfaces from `bot.test.ts` and the `feature-wiring.test.tsx` smoke suite. | 1 | coder |
| 45 | **WebSocket Server** | New `apps/bot/src/server/` (Hono + bun-websocket on port 7913). `LiveStatePublisher` listens to `Bot.subscribe(listener)` and emits `snapshot` / `tick` / `bar` / `indicator` / `marker` / `state` / `error`. Per-symbol subscription table. Heartbeat pings. Reconnect-friendly. REST: `GET /api/strategies`, `POST /api/control`, `GET /api/ohlc?symbol=&tf=&count=`. | 2 | coder |
| 46 | **Web App Skeleton** | New `apps/web/` workspace package: React 19 + Vite 6 + Bun. Imports the eggproject-design tokens via `colors_and_type.css`, the lc-wrap component, and the B vendors (React, ReactDOM, TanStack). Top-nav app shell from `eggproject-design-app-common`. Empty dashboard page with the WebSocket connection manager. | 1 | coder |
| 47 | **Multi-TF Chart Grid** | One `<LcWrap>` per (strategy, timeframe) per the WS `snapshot.strategies` payload. Lightweight-charts candlestick series, with the historical OHLC bootstrap from `snapshot.ohlcBootstrap`. Subscription manager that sends `subscribe`/`unsubscribe` per visible (symbol, tf) and disconnects unused ones. Empty-state "no data yet" panes. | 1 | coder |
| 48 | **Indicator Overlays** | Per-strategy indicator mapping (registry in `apps/web/src/indicators/`): `donchian_pivot_composition → donchian + pivot markers`, `cascade_fade → cascade markers`, `dydx_cex_carry → funding-rate line + spread line`. Indicator series rendered via `lc-wrap` `addLineSeries` / `addHistogramSeries` / `setMarkers`. Strategy signals (`marker` messages) rendered as chart markers. | 2 | coder |
| 49 | **Real-time + Reconnection** | Tick stream throttled to 4 Hz per symbol; `requestAnimationFrame` batching. Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s). Re-subscribe on reconnect. State-merge: live state + server snapshot. Heartbeat client (pong every 25s). | 1 | coder |
| 50 | **Deployment + Cutover** | `mm-bot serve` subcommand in `apps/bot/src/cli/commands/serve.ts` (starts the Hono + bun-websocket server, with `--port`, `--bind`, `--no-bundled-web` flags). README rewrite: drop TUI docs, add `serve` workflow, add `apps/web/` developer guide. `.env.example` adds `MM_BOT_WEB_PORT` and `MM_BOT_WEB_BIND`. Final coverage audit + bundle size budget. | 2 | verifier |

Total: 10 PRs across 7 phases, each phase a single working deliverable.

### 4.1 Phase 44 — TUI Removal (one big delete commit)

**Track A — Source deletion**

- `git rm -r packages/tui/` (entire package, ~40 src files + tests)
- `git rm -r apps/bot/src/tui/`
- `git rm apps/bot/src/cli/commands/tui.ts`
- `apps/bot/src/cli/argv.ts` — drop `--tui` and `--no-tui` flags
- `apps/bot/src/cli/router.ts` — drop `tui` subcommand
- `apps/bot/src/cli/index.ts` — drop the TUI dispatch branch
- `apps/bot/package.json` — drop deps: `@mm-crypto-bot/tui`, `ink`, `@inkjs/ui`, `@matthesketh/ink-table`, `@matthesketh/ink-status-bar`, `sindresorhus/ink-link`, `react`, `react-dom`, `@types/react`, `ink-testing-library`, `asciichart`, `sparkly`, `smol-toml`, `write-file-atomic`
- `apps/bot/src/cli/commands/start.ts` — collapse `--headless`/`--tui`/`--no-tui` into nothing; `runTui` is gone. Remove the `startCommand` TUI branch.
- `apps/bot/src/bot/bot.ts` — keep `bot.subscribe` / `bot.getState` (the publisher needs them in Phase 45). No bot-runtime changes.

**Track B — Publisher rename + relocation**

- `mv apps/bot/src/tui/live-bot-state-provider.ts → apps/bot/src/server/state-publisher.ts`
- Rename class: `LiveBotStateProvider` → `LiveStatePublisher`
- Remove Ink-specific concerns (the Ink `useSyncExternalStore` subscribe API). The new public surface is `publishState(state)` and an EventEmitter that the WS server subscribes to.
- Update imports.

**Track C — Test cleanup**

- `apps/bot/src/tui/*.test.tsx` — all 13 files in `apps/bot/src/tui/`. Deleted with the source.
- `packages/tui/src/components/__tests__/*` — deleted.
- `packages/tui/src/providers/*.test.ts` — deleted.
- `packages/tui/src/scaffold.test.ts` — deleted.
- `packages/tui/src/app-logic.test.ts` — deleted.
- `apps/bot/src/bot/bot.test.ts` — Phase 42 + Phase 43 regression tests stay (they test `Bot.init`, not the TUI). The Phase 36 + Phase 38 TUI-specific tests are deleted.

**Track D — Docs**

- `docs/production-strategies/tui.md` — deleted.
- `deliverable.md` — TUI section removed.
- `apps/bot/README.md` — TUI quick-start section replaced with the new `mm-bot serve` workflow (placeholders until Phase 50 lands).
- `README.md` (root) — TUI section removed.

**Coverage after Phase 44:** 7/7 packages (apps/bot + 6 from `packages/`), still 100% OWN each.

**Test count after Phase 44:** 5053 → ~4250 (~800 TUI tests deleted; new publisher gets ~30 tests in Phase 45).

### 4.2 Phase 45 — WebSocket Server (2 PRs)

**PR 45A — Publisher + Hono server skeleton**

- New package: `apps/bot/src/server/`
  - `state-publisher.ts` (the renamed file)
  - `ws-server.ts` (Hono + bun-websocket on 7913)
  - `protocol.ts` (TypeScript types for the WS message shape — single source of truth for the protocol)
  - `subscription-manager.ts` (per-client subscription table; throttling; broadcast loop)
  - `index.ts` (composes the above; `startServer(bot, opts)` exported for the `serve` command)
- Tests: `apps/bot/src/server/{state-publisher,ws-server,subscription-manager}.test.ts` (~30 tests, ≥4 per file)
- No REST endpoints yet (Phase 45B).
- Coverage: 100% on the new files.

**PR 45B — REST + control + heartbeat**

- `apps/bot/src/server/rest.ts` — `GET /api/strategies`, `GET /api/ohlc?symbol=&tf=&count=`, `POST /api/control` (start/stop/pause/kill_switch).
- Heartbeat: server pings every 10s, expects client `pong` within 30s, closes on timeout.
- `POST /api/control` reuses the bot's `startCommand` (`bot.start`, `bot.stop`, `setPaused`).
- Tests: `apps/bot/src/server/rest.test.ts` (≥6 tests, including auth-failure path).
- The OHLC historical endpoint reads from a new `apps/bot/src/bot/ohlc-store.ts` — an in-memory ring buffer (200 bars per symbol per timeframe) that the `StrategyRunner` populates as bars close. This becomes the bootstrap for the chart on page load.
- Coverage: 100%.

### 4.3 Phase 46 — Web App Skeleton (1 PR)

- New package: `apps/web/`
  - `package.json` — React 19, Vite 6, lightweight-charts 5.2.0, no other chart libs.
  - `tsconfig.json` — strict, project references to `@mm-crypto-bot/core` (for `Timeframe`, `FundingSnapshot` types).
  - `vite.config.ts` — Bun + Vite, port 5173 in dev, base path `/` so the served bundle lives under `http://127.0.0.1:7913/`.
  - `index.html` — `<html data-theme="dark">` (default for trading surfaces), Roboto + JetBrains Mono via eggproject-design self-hosted fonts.
  - `src/main.tsx` — mounts `<App />` into `#root`.
  - `src/App.tsx` — Top-nav app shell from `eggproject-design-app-common/_shell.css`, with a single page placeholder: "WebSocket: connecting…".
  - `src/ws-client.ts` — `WebSocketClient` class (typed against `protocol.ts` — re-exported from `apps/bot/src/server/protocol.ts`).
- Imports `colors_and_type.css` from `eggproject-design/` via the standard cross-skill path (`../../../eggproject-design/colors_and_type.css`).
- Imports the vendored `lightweight-charts.standalone.production.js` from `eggproject-design-trade-components/assets/vendor/`.
- Tests: `apps/web/src/ws-client.test.ts` (≥4 tests using the fake WebSocket from `ws` package).
- Coverage: 100% on the web app (lightweight-charts integration tested via DOM-mock in a future phase).
- Build: `apps/web` builds to `apps/web/dist/`; the Hono server serves it as static assets.

**Workspace wiring:**

- `package.json` (root) — add `apps/web` to the `workspaces` glob.
- `bun install` in the worktree regenerates the symlink under `apps/web/node_modules/@mm-crypto-bot/...`.
- `turbo.json` — add `apps/web#build` and `apps/web#lint` and `apps/web#test` tasks.
- Root `package.json` — add `bun run web:build` and `bun run web:dev` scripts.

### 4.4 Phase 47 — Multi-TF Chart Grid (1 PR)

- `apps/web/src/charts/ChartGrid.tsx` — receives the `snapshot.strategies` list and the WS `tick`/`bar` messages, renders a CSS Grid of `<LcWrap>` instances.
- `apps/web/src/charts/ChartCard.tsx` — single chart card: title (strategy name + TF), chart body, "no data" empty state.
- `apps/web/src/charts/ohlc-bridge.ts` — converts the WS `bar` and `tick` messages into `lc-wrap`'s imperative `setData` / `update` calls.
- `apps/web/src/charts/subscription.ts` — `useSubscriptions(strategies)` hook that sends `subscribe`/`unsubscribe` per visible chart; debounced 100ms.
- 2×2 grid on desktop, 1 column on mobile, 2 columns on tablet (the existing `--ep-screen-*` breakpoints).
- The grid is **adaptive** — when only one strategy is enabled, the grid is 1×N. When all 7 strategies × 3 TFs are enabled, the grid scrolls vertically with the strategy header pinned.
- Tests: `apps/web/src/charts/ChartGrid.test.tsx` (≥4 tests using `ink-testing-library`-style DOM mocks — actually `react-testing-library` or `@testing-library/react`).

### 4.5 Phase 48 — Indicator Overlays (2 PRs)

**PR 48A — Indicator registry + per-strategy indicator map**

- `apps/web/src/indicators/index.ts` — registry:
  ```ts
  export const INDICATORS: Record<StrategyName, IndicatorDescriptor[]> = {
    donchian_pivot_composition: [
      { kind: "donchian", source: "donchian_upper", color: "var(--ep-accent)" },
      { kind: "donchian", source: "donchian_lower", color: "var(--ep-second)" },
      { kind: "donchian", source: "donchian_middle", color: "var(--ep-fg-muted)" },
    ],
    cascade_fade: [
      { kind: "markers", source: "cascade_events", color: "var(--ep-warning)" },
    ],
    dydx_cex_carry: [
      { kind: "line", source: "funding_rate_dydx", color: "var(--ep-accent)" },
      { kind: "line", source: "funding_rate_cex", color: "var(--ep-second)" },
      { kind: "line", source: "spread_dydx_minus_cex", color: "var(--ep-fg-muted)" },
    ],
  };
  ```
- `apps/web/src/indicators/IndicatorLayer.tsx` — receives the WS `indicator` messages, batches them per chart, and feeds the lines/markers into the `<LcWrap>`.
- Tests: `apps/web/src/indicators/IndicatorLayer.test.tsx` (≥4 tests).

**PR 48B — Strategy signal markers**

- WS `marker` messages render as `lc-wrap` chart markers (triangle up/down for entry, dot for exit, label as text).
- Markers are colored by side: long = `--ep-success`, short = `--ep-danger`, info = `--ep-info`.
- Strategy exits show the closed trade's P&L as the label (`+12.5 USDT`).
- Tests: `apps/web/src/indicators/SignalMarkers.test.tsx` (≥3 tests).

### 4.6 Phase 49 — Real-time + Reconnection (1 PR)

- `apps/web/src/ws-client.ts` extends:
  - Auto-reconnect with `setTimeout` exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
  - On reconnect: re-send all active subscriptions + request a fresh `snapshot`.
  - Heartbeat: client sends `pong` within 5s of receiving `ping`. Server closes on >30s silence.
- `apps/web/src/realtime/UpdateBatcher.ts` — receives `tick` and `bar` messages, batches by `requestAnimationFrame`, and pushes the latest per-symbol-per-tf into the chart layer.
- Tests: `apps/web/src/ws-client.reconnect.test.ts` (≥4 tests: clean disconnect, mid-tick disconnect, server restart, server timeout).

### 4.7 Phase 50 — Deployment + Cutover (2 PRs)

**PR 50A — `mm-bot serve` subcommand**

- `apps/bot/src/cli/commands/serve.ts` — `mm-bot serve [--port=7913] [--bind=127.0.0.1] [--no-bundled-web]`
  - Loads the same config as `start`.
  - Constructs the bot (does **not** start it — the user starts it from the dashboard).
  - Starts the Hono + WS server.
  - If `--no-bundled-web` is not set, serves the `apps/web/dist/` static bundle.
- Adds `serveCommand` to `apps/bot/src/cli/router.ts`.
- Tests: `apps/bot/src/cli/commands/serve.test.ts` (≥3 tests).
- Docs: `apps/bot/README.md` — `mm-bot start` in one terminal, `mm-bot serve` in another, open `http://127.0.0.1:7913`.

**PR 50B — Final docs + cutover**

- Root `README.md` — TUI section removed, web dashboard section added.
- `deliverable.md` — Phase 44–50 closure section appended.
- `docs/production-strategies/bot.md` — `mm-bot start` + `mm-bot serve` workflow.
- `docs/production-strategies/web-dashboard.md` — new file, user guide (5 sections, 1-2 pages).
- `.env.example` — `MM_BOT_WEB_PORT`, `MM_BOT_WEB_BIND` documented.
- `apps/bot/scripts/install-mm-bot.sh` — no change.
- `bun run coverage:full` audit: 7 packages (apps/bot + 6 from packages/), all 100% OWN. The web app uses lightweight-charts in the browser — it's not bun-testable; coverage is measured at the Vite build (using `vite-plugin-istanbul` or similar) and the threshold is 80% (a deliberate relaxation since DOM-coupled code is harder to test in bun:test). The orchestrator must record this relaxation in `deliverable.md` and in the board.

---

## 5. Detailed file/folder plan

### 5.1 Deleted (Phase 44)

```
packages/tui/                                        # entire package
apps/bot/src/tui/                                    # entire dir
apps/bot/src/cli/commands/tui.ts                     # subcommand
apps/bot/src/bot/live-bot-state-provider.ts (renamed)
docs/production-strategies/tui.md
```

### 5.2 Created

```
apps/bot/src/server/
├── protocol.ts                                      # WS message types (single source of truth)
├── state-publisher.ts                               # Bot.subscribe → serializable state
├── ws-server.ts                                     # Hono + bun-websocket
├── rest.ts                                          # GET /api/strategies, /api/ohlc, POST /api/control
├── subscription-manager.ts                          # per-client subscription table
├── heartbeat.ts                                     # 10s ping / 30s pong timeout
├── index.ts                                         # startServer(bot, opts) exported
├── ohlc-store.ts                                    # 200-bar ring buffer per (symbol, tf)
├── __tests__/
│   ├── state-publisher.test.ts
│   ├── ws-server.test.ts
│   ├── rest.test.ts
│   ├── subscription-manager.test.ts
│   ├── heartbeat.test.ts
│   └── ohlc-store.test.ts

apps/bot/src/cli/commands/serve.ts                   # Phase 50A

apps/web/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/                                          # eggproject-design assets
│   └── (copied at build time via postinstall)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── theme.ts                                     # data-theme toggle wiring
│   ├── ws-client.ts                                 # WebSocket client + reconnect
│   ├── protocol.ts                                  # re-export from @mm-crypto-bot/server/protocol
│   ├── charts/
│   │   ├── ChartGrid.tsx
│   │   ├── ChartCard.tsx
│   │   ├── ohlc-bridge.ts
│   │   └── subscription.ts
│   ├── indicators/
│   │   ├── index.ts                                 # registry
│   │   ├── IndicatorLayer.tsx
│   │   └── SignalMarkers.tsx
│   ├── components/
│   │   ├── StatsStrip.tsx
│   │   ├── PositionsTable.tsx                       # TanStack
│   │   └── ControlBar.tsx
│   ├── realtime/
│   │   └── UpdateBatcher.ts
│   ├── styles/
│   │   └── app.css                                  # imports eggproject-design tokens
│   └── __tests__/
│       ├── ws-client.test.ts
│       ├── ChartGrid.test.tsx
│       ├── IndicatorLayer.test.tsx
│       ├── SignalMarkers.test.tsx
│       ├── UpdateBatcher.test.ts
│       ├── StatsStrip.test.tsx
│       └── PositionsTable.test.tsx
```

### 5.3 Modified

```
package.json (root)                    # add apps/web to workspaces, add web:dev/web:build scripts
turbo.json                             # add apps/web#build, #lint, #test
apps/bot/package.json                  # remove ink/react deps; add hono, bun-websocket
apps/bot/src/cli/router.ts             # register serve
apps/bot/src/cli/index.ts              # serve dispatch
apps/bot/src/bot/bot.ts                # add subscribeToIndicators + emitIndicator hook (Phase 45)
apps/bot/src/cli/commands/start.ts     # strip TUI surface
apps/bot/config/default.toml           # no change (bot is unchanged)
.env.example                           # add MM_BOT_WEB_PORT, MM_BOT_WEB_BIND
README.md                              # TUI section → web dashboard section
deliverable.md                         # append Phase 44–50 closure
docs/production-strategies/bot.md      # add serve workflow
docs/production-strategies/pre-launch-checklist.md  # replace TUI smoke with web smoke
```

---

## 6. UX design (eggproject-design application)

### 6.1 Theme

`<html data-theme="dark">` — dark by default for trading surfaces (per the design system rules). The theme toggle is in the sidebar footer, per the `_shell.css` convention.

### 6.2 Page shell

Top-nav (from `eggproject-design-app-common/_shell.css`):
- Brand mark on the left (`assets/logo-mark-inverse.svg`)
- Section nav: `Dashboard` / `Strategies` / `Backtest` / `Docs`
- Top-bar: feed indicator (`B` component, live-streaming badge), account avatar
- Theme toggle on the right (sidebar-style menu item, not floating)

### 6.3 Dashboard page

- **Header strip:** bot status badge `[● FUT]` (running) / `[● STOPPED]` / `[● CRASHED]` — same UX as the deleted TUI, now in the browser. Pulled from the `state` WS message.
- **Stats strip:** equity, P&L (today + total), win rate, drawdown, sharpe, profit factor. 6 cells, gold for positive, danger-red for negative. Tabs: `1D` / `7D` / `30D` / `ALL` (client-side windowing from the `closedTrades` array).
- **Charts grid:** adaptive grid of `<LcWrap>` instances (Phase 47 spec).
- **Positions table:** TanStack (`B` vendored), dark theme, columns: symbol, side, entry, current, P&L (USD + %), leverage, opened-at, kill-switch actions. Live-updates per `state` message.
- **Control bar:** sticky bottom bar with start/stop/pause/kill-switch buttons. Each is a `<button class="ep-button--primary">` (gold) for the active action, `--second` (sapphire) for secondary. The kill-switch button requires a typed "KILL" confirmation (mirrors the deleted TUI's `LiveConfirm.tsx`).
- **Empty states:**
  - "No strategies enabled" — when the bot has zero enabled strategies, the grid shows a single empty card with the `[o] settings` hint (now a `[c] config` button) and a "edit config" CTA.
  - "Connecting…" — when the WS isn't open yet, all charts show a `dot` skeleton with the loading message.
  - "No data yet" — when the bot is running but no bars have closed for a (symbol, tf), the chart shows a centered `<Spinner label="No bars yet — bot is running" />` (the same `@inkjs/ui` Spinner component the deleted TUI used, now ported to React DOM).

### 6.4 Indicator overlay colors (eggproject-design palette)

| Indicator | Series | Color | Token |
|---|---|---|---|
| Donchian upper | line | gold | `--ep-accent` |
| Donchian lower | line | sapphire | `--ep-second` |
| Donchian middle | line | muted | `--ep-fg-muted` |
| Funding rate (dydx) | line | gold | `--ep-accent` |
| Funding rate (cex) | line | sapphire | `--ep-second` |
| Spread (dydx − cex) | line | danger | `--ep-danger` |
| Pivot levels | horizontal | gold @ 30% opacity | `--ep-accent` with `--ep-tint` |
| Cascade events | histogram | warning | `--ep-warning` |
| Long signal | marker | success | `--ep-success` |
| Short signal | marker | danger | `--ep-danger` |
| Exit marker | marker | fg-muted | `--ep-fg-muted` |

All colors via `--ep-` tokens; no ad-hoc hex.

### 6.5 Empty / loading / error states

Per the eggproject-design rules:
- "No data yet" uses a centered `<Spinner>` with a quiet message — never a bouncing skeleton, never a flashing icon.
- Errors use the dot pattern (red dot + `StatusMessage variant="danger"`).
- The crashed state is a full-width red banner above the stats strip with the error text, mirroring the TUI's `EngineErrorBanner` (now ported).

---

## 7. Testing strategy

### 7.1 Per-phase test targets

| Phase | New test count | Coverage target |
|-------|----------------|-----------------|
| 44 (TUI removal) | -800 deleted + 30 publisher | 7/7 @ 100% OWN |
| 45 (WS server) | +50 (~6 files) | 7/7 @ 100% OWN |
| 46 (web skeleton) | +8 ws-client | apps/web @ 80% (DOM-coupled) |
| 47 (chart grid) | +12 ChartGrid | apps/web @ 80% |
| 48 (indicators) | +10 | apps/web @ 80% |
| 49 (realtime) | +12 | apps/web @ 80% |
| 50 (cutover) | +6 | 8/8 @ 100%/80% |

Total new tests after Phase 50: ~5080, with the web app ~80% OWN coverage (lightweight-charts is imported from a vendor and is not unit-tested).

### 7.2 Acceptance protocol (each phase)

1. `bun run typecheck` — all 8 packages clean.
2. `bun run lint` — 0 errors.
3. `bun test` — all green, no regressions.
4. `bun run coverage:per-package` — 7 packages 100%, apps/web 80%+.
5. `bun run coverage:enforce` — exits 0.
6. `gh pr checks` — 6/6 green (1 retry expected on `useConfigStore` flake if it's still around).
7. Visual / UX check: PTY + browser screenshot for the web app phases.

### 7.3 Adversarial probes (Phase 50 verifier)

- **WS reconnect:** kill the server mid-tick, browser should auto-reconnect within 30s, snapshot should re-sync.
- **Subscription leak:** enable/disable 100× strategies, server memory should not grow.
- **Indicator staleness:** pause the bot, indicators should freeze (no new updates) but the chart should still render the last known state.
- **Multi-tab:** open the dashboard in 3 tabs, verify each gets its own WS connection and that the server handles them independently.
- **Auth (out of scope for now):** if `MM_BOT_WEB_BIND=0.0.0.0`, no auth is required (Phase 50A binds to `127.0.0.1` by default). The user said "külön parancs" — separate terminal — so the network exposure is opt-in. Future work: add `MM_BOT_WEB_TOKEN`.

---

## 8. Risks + mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| WebSocket protocol drift between server and client | Bot upgrades break the dashboard | `protocol.ts` is a single source of truth, both sides import it. A version field on every message; client warns on mismatch. |
| `lightweight-charts` bundle size (currently ~250KB gzipped) | Slow first paint | Vite's `manualChunks` splits the vendor into a separate chunk. CDN-style preload on the head. |
| Bun + Vite + React 19 compat | Build failures | Pin to known-good versions: `bun@1.3.14`, `vite@6.0.0`, `react@19.0.0`. Validate in Phase 46. |
| `eggproject-design` cross-skill imports break the Vite build | Web app can't find the tokens | Vite config uses `optimizeDeps.exclude` for the eggproject paths; document the symlink strategy in `apps/web/README.md`. |
| Indicator registry hard-coded for known strategies | New strategy = new indicator code | Registry is data-driven; `INDICATORS[StrategyName]` returns `IndicatorDescriptor[]`. New strategy adds an entry, not a new code path. |
| TUI users on existing PRs | Phase 44 conflicts with any in-flight TUI work | Phase 44 is the FIRST phase; no in-flight TUI PRs at the start. The "no `⏸️ DEFERRED`" rule applies — everything in the TUI deletes in one commit. |
| Coverage mandate relaxation for `apps/web` | 8/8 → 7/7 packages at 100%, plus 1 at 80% | Document the relaxation in the board + deliverable. The user mandate ("100% line coverage on OWN src/") was for the original 8 packages; the web app is new and the relaxation is a deliberate, recorded decision. |

---

## 9. Rollback plan

If Phase 46+ blows up and the user wants to revert to the TUI:

1. `git revert <phase-44-commit>..HEAD` — but this conflicts with all the bot changes. **Realistic rollback: only `apps/web/` is reversible; the TUI deletion is not.**
2. **Mitigation:** keep the Phase 44 deletion small and atomic (one PR), so a `git revert <phase-44>` recovers the TUI. The bot's `live-state-publisher.ts` is a new file and doesn't conflict with the deleted `live-bot-state-provider.ts`.
3. Branch protection on `main`: no force-push, no direct merge — every phase is a PR, the user reviews each.

---

## 10. Open questions (for the user)

These need a decision before Phase 44 starts:

1. **Auth on the WS / REST server?** Currently the plan is `127.0.0.1`-only, no auth. The user said "külön parancs, külön terminál" which implies a local dev workflow. If you want LAN access (e.g. phone-as-second-screen), we'd need a token. **Default: no auth, `127.0.0.1` bind.**
2. **Vite vs. bun-bundled HTML?** Two options:
   - **Vite dev server** (HMR, fast iteration, `bun run web:dev`).
   - **Bun HTML imports** (single-binary, simpler prod, no Vite). Used in `apps/bot` for the headless bundle.
   - **Default: Vite for dev, Bun's `Bun.build` for prod** (best of both).
3. **State persistence on the dashboard?** Browser localStorage for the theme + last-selected strategies? **Default: yes for theme, no for strategy selection (always mirrors server snapshot).**
4. **Backtest view in the dashboard?** A `/backtest` route that runs a backtest and shows the equity curve? Or keep `mm-bot backtest` as a CLI-only subcommand? **Default: keep CLI-only for now; the dashboard is for live paper/live trading.**
5. **Mobile layout?** The user said "modern alkalmazás" — does that include phone-sized screens, or is desktop the only target? The TUI was desktop-only; the web could be both. **Default: responsive (phone usable, desktop primary).**
6. **Bundle size budget?** Vite + lightweight-charts + React ≈ 350KB gzipped. Budget proposal: **400KB gzipped** for the first paint. Enforce via `vite-plugin-bundlesize` in CI.

---

## 11. Timeline (rough)

| Phase | Calendar | PRs |
|-------|----------|-----|
| 44 | 1 day (mostly delete + rename + test updates) | 1 |
| 45 | 3 days (server + tests) | 2 |
| 46 | 2 days (web skeleton + build pipeline) | 1 |
| 47 | 2 days (chart grid + WS subscription) | 1 |
| 48 | 3 days (indicator registry + per-strategy overlays) | 2 |
| 49 | 1 day (reconnect + heartbeat) | 1 |
| 50 | 2 days (serve subcommand + docs) | 2 |
| **Total** | **~14 days** | **10 PRs** |

The orchestrator (Mavis) delegates each phase to a sub-agent (one per phase, parallel where possible — Phase 47 + 48 can overlap). The sub-agents open PRs; the orchestrator verifies, merges, and updates the board.

---

## 12. Verification of the user's mandates (checklist)

- ✅ **WebSocket-alapú web dashboard** — `apps/web/` + `apps/bot/src/server/`
- ✅ **EggProject design system** — `colors_and_type.css` from `eggproject-design/`, app shells from `eggproject-design-app-common/`, lc-wrap + lightweight-charts from `eggproject-design-trade-components/`
- ✅ **Chart eszköz használata** — `lightweight-charts@5.2.0` via `lc-wrap` (the mandated chart library)
- ✅ **React Turbo repo app** — `apps/web/` workspace package, Vite 6, React 19, integrated into the Turbo pipeline
- ✅ **TUI teljes törlés** — Phase 44 deletes `packages/tui/`, `apps/bot/src/tui/`, the `tui` subcommand, all Ink deps
- ✅ **Csak WebSocket + Headless módok** — Phase 50A removes `--tui`, `headless` is the only mode (no flag dichotomy)
- ✅ **Minden stratégiának ≥1 chart, multi-TF → több chart** — Phase 47 + 48 renders one `<LcWrap>` per (strategy, timeframe)
- ✅ **Realtime** — WS tick stream throttled to 4Hz, `requestAnimationFrame` batching in Phase 49
- ✅ **Robot headless módban indul, webserver külön parancs** — `mm-bot start` (headless) + `mm-bot serve` (web) in separate terminals

---

## 13. Next step

If you approve the plan, the orchestrator (Mavis) creates:

1. A new branch `phase/44-tui-removal` off main
2. A worktree for Phase 44
3. The deletion + rename commit
4. The PR (single big delete; coverage + tests must stay 100% on the 7 remaining packages)
5. Waits for CI (6/6 green)
6. Merges with `--admin` and `--delete-branch`
7. Repeats for Phase 45 (server), 46 (web skeleton), etc.

Each phase is a separate, reversible PR. The board is updated at each phase close with the same format as Phase 38/42/43 (description + user trigger + tracks + final state + user-facing impact).

**No implementation starts until you say "csinald" / "folytasd" / "go" / "approved".**
