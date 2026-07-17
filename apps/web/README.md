# `apps/web` — mm-crypto-bot dashboard

> React 19 + Vite 6 + lightweight-charts 5 SPA. Connects to the running `mm-bot web` server (Hono + bun-websocket on `127.0.0.1:7913`) and renders the chart grid, positions table, and sticky control bar.

## Quick start

The dashboard is a pure client — it needs a running `mm-bot web` server to talk to. From the repo root:

```bash
# Terminal 1: start the bot (headless, default config)
bun run start

# Terminal 2: start the web client (separate process)
bun run web

# Browser: open the dashboard
open http://127.0.0.1:7913
```

See the [root README](../README.md#quick-start-web-dashboard) for the full workflow.

## Local development (dev server)

The dev server uses Vite's HMR + MSW to mock the state-feed so you don't need a running bot:

```bash
# From apps/web/
bun run dev
# → http://127.0.0.1:5173 (Vite default)
```

> The dev server runs MSW in worker mode (`window.MSW_STARTED = true` is NOT set by the dev script — Vite proxies the SPA, and the real `mm-bot web` server is what serves the data). For pure-frontend iteration without a running bot, see the [MSW setup](#msw-mock-setup) section.

## Production build

```bash
# From apps/web/
bun run build
# → dist/  (the static bundle the `mm-bot web` static server picks up)

# Or preview the built bundle locally (matches what `mm-bot web` serves):
bun run preview --port 7913 --strictPort --host 127.0.0.1
# → http://127.0.0.1:7913
```

The `vite build` output goes to `apps/web/dist/`. The `mm-bot web` static server reads this directory and falls back to a placeholder HTML if it's missing.

## End-to-end tests (Playwright + MSW)

```bash
# From apps/web/
bun run e2e                 # Fast path (CI default) — 20-min cap
bun run e2e:full            # Full path — 30-min cap, +coverage report
bun run e2e:headed          # Headed mode (local debugging)
```

The e2e suite is in `apps/web/e2e/dashboard.spec.ts`. It runs against a coverage-instrumented production build (`VITE_COVERAGE=true vite build`) served by `vite preview` on `127.0.0.1:7913` (the same loopback port the real `mm-bot web` server uses). MSW intercepts `fetch` and `WebSocket` in the browser via a service worker.

### Coverage gate

The e2e suite enforces **95% lines / 90% branches / 95% functions** on `apps/web/src/**` via `nyc check-coverage`. The full report lands in `apps/web/coverage/playwright/`:

```
apps/web/coverage/playwright/
├─ coverage-final.json       # Raw istanbul coverage map
├─ screenshots/              # Visual smoke artifacts
│  └─ dashboard.png          # Phase 51 deployment smoke (test 22)
├─ report/                   # nyc report output
│  ├─ lcov.info              # standard lcov
│  ├─ coverage-summary.json  # summary for CI
│  └─ html/                  # browse-able report
└─ html-report/              # Playwright's HTML test report
```

## Component structure

```
App
├─ <TopNav>                  # brand mark + status pill
│  └─ ep-app__status-dot (data-status="connected|connecting|disconnected|crashed")
├─ <main>
│  ├─ <ChartGrid>            # 1 CardGrid × N ChartCards
│  │  └─ <ChartCard> × N     # one per (symbol, timeframe) pair
│  │     └─ <LcWrap>         # lightweight-charts 5.2.0 wrapper (canvas-based)
│  │        └─ <RangeTabs>   # 1h / 4h / 1d range buttons
│  └─ <PositionsTable>       # open positions: qty, entry, mark, uPnl
└─ <ControlBar>              # sticky bottom — Start / Stop / Pause / Resume / Kill
   └─ ep-control-bar__btn × 5
```

Each component lives in `apps/web/src/components/` and is co-tested (where unit tests make sense) in `apps/web/src/__tests__/`. The chart-specific logic (subscription management, OHLC ring buffer, indicator registry) is in `apps/web/src/lib/`.

## State-feed protocol

The dashboard speaks two transports to `mm-bot web`:

### 1. REST (fetch, request/response)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/strategies` | List of enabled strategy descriptors (id, symbols, timeframes) |
| `GET` | `/api/ohlc?symbol=X&timeframe=Y` | OHLC bootstrap (last 200 bars) for a (symbol, tf) pair |
| `GET` | `/api/positions` | Open positions |
| `POST` | `/api/control` | Send a CONTROL command (start / stop / pause / resume / kill) |

The REST client is a thin `fetch` wrapper in `apps/web/src/lib/api.ts`. CORS is configured server-side (`apps/bot/src/web-client/http-server.ts`).

### 2. WebSocket (`ws://127.0.0.1:7913/ws`, server-push)

A single WS connection that streams state from the bot:

| Server → Client | When |
|---|---|
| `HELLO` | On connect (server-broadcast) |
| `SNAPSHOT` | On connect (initial full state) |
| `TICK` | On every price tick (4Hz throttled server-side) |
| `BAR` | On every closed bar |
| `INDICATOR` | On every indicator computation |
| `MARKER` | On every signal marker (entry, exit, stop, target) |
| `STATE` | On every strategy state change |
| `ERROR` | On bot / engine error |
| `PING` | Every 10s (client auto-PONGs) |

| Client → Server | When |
|---|---|
| `SUBSCRIBE` (symbol, timeframe) | On chart card mount |
| `UNSUBSCRIBE` (symbol, timeframe) | On chart card unmount |
| `CONTROL` (command, params) | On control bar button click |
| `PONG` | On `PING` receipt |

The protocol types live in `apps/bot/src/state-feed/protocol.ts`. The client wrapper is in `apps/web/src/ws-client.ts` (the `useWebSocket()` React hook + a pure `WebSocketClient` class).

### Reconnect

The browser-side WS reconnects on close with exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (cap). The status pill cycles through `connecting` → `connected` (or `crashed` after 3 failed reconnects).

## MSW mock setup

The e2e suite uses [MSW v2](https://mswjs.io) to mock both `fetch` and `WebSocket` in the browser. The MSW worker patches the global `WebSocket` and registers a service worker for `fetch` interception.

**Activation** — `apps/web/src/main.tsx` checks `window.MSW_STARTED` on boot:

```ts
if (window.MSW_STARTED === true) {
  void import("../e2e/mocks/browser.js").then((m) => m.worker.start());
}
```

The e2e spec sets `window.MSW_STARTED = true` via `page.addInitScript` BEFORE the page loads, so the dynamic import fires and the worker starts before React mounts.

**Handlers** — `apps/web/e2e/mocks/handlers.ts` mirrors the production state-feed protocol:

- `http.get('*/api/strategies')` → returns a fixed strategy descriptor list (1 strategy × 1 symbol × 2 timeframes = 2 chart cards)
- `http.get('*/api/ohlc')` → returns 200 deterministic OHLC bars
- `http.get('*/api/positions')` → returns 1 open position
- `ws.link('ws://127.0.0.1:7913/ws')` → echoes the SUBSCRIBE/UNSUBSCRIBE messages, fakes TICK/BAR/STATE updates at 4Hz

The handlers list is shared between `e2e/mocks/browser.ts` (service worker) and `e2e/mocks/node.ts` (Node interceptor for in-process testing).

**Worker file** — `apps/web/public/mockServiceWorker.js` is the MSW service worker bundle, generated by `npx msw init public/`. It is checked into the repo (it has no build step).

## File map

```
apps/web/
├─ index.html                # Vite entry HTML
├─ package.json              # @mm-crypto-bot/web workspace package
├─ tsconfig.json             # strict + react-jsx (no `noUncheckedIndexedAccess`)
├─ vite.config.ts            # Vite 6 + React + vite-plugin-istanbul (coverage)
├─ playwright.config.ts      # Playwright + MSW + 95% coverage gate
├─ public/
│  └─ mockServiceWorker.js   # MSW service worker (generated, checked-in)
├─ src/
│  ├─ main.tsx               # React 19 entry point
│  ├─ App.tsx                # Top-nav app shell + state orchestration
│  ├─ ws-client.ts           # useWebSocket() hook + WebSocketClient class
│  ├─ theme.ts               # data-theme attribute + toggle
│  ├─ components/
│  │  ├─ ChartCard.tsx       # One card: symbol + strategy + LcWrap
│  │  ├─ ChartGrid.tsx       # Multi-card grid with subscribe lifecycle
│  │  ├─ ControlBar.tsx      # Sticky bottom: Start/Stop/Pause/Resume/Kill
│  │  └─ PositionsTable.tsx  # Open positions table
│  ├─ indicators/            # Indicator registry (Donchian, funding, cascade, signals)
│  ├─ lib/                   # subscription, ohlc-bridge, realtime-batcher
│  ├─ styles/                # Vendored CSS (chart-card.css, app.css) — no symlink
│  └─ __tests__/             # Component / lib unit tests (bun:test)
├─ e2e/
│  ├─ dashboard.spec.ts      # 22 Playwright tests (1 file)
│  ├─ mocks/                 # MSW handlers (browser + node transports)
│  └─ screenshots/           # Manual screenshot drop zone
└─ coverage/                 # Per-suite coverage output (gitignored, .gitkeep'd)
   └─ playwright/            # e2e: coverage-final.json, report/, screenshots/, html-report/
```

## Conventions

- **No skills/ symlink** — the project's `apps/web/src/styles/` are vendored copies of the EggProject design tokens. The build is self-contained; you do NOT need to symlink or clone any external repo.
- **TypeScript** — `apps/web/tsconfig.json` uses `strict: true` (no `noUncheckedIndexedAccess`; use `?? default` patterns instead). Components are `.tsx`; lib + e2e are `.ts`.
- **Tests** — `apps/web/src/__tests__/*.test.ts(x)` for unit tests (run with `bun test`); `apps/web/e2e/*.spec.ts` for e2e (run with `bun run e2e`). Bun's test discovery is used; the e2e suite is intentionally separate (Playwright runner).
- **Coverage** — `apps/web` is exempt from the per-package 100% OWN gate (which is server-only). The 95/90/95% gate comes from the Playwright e2e suite via `nyc check-coverage`.

## License

Private project — all rights reserved.
