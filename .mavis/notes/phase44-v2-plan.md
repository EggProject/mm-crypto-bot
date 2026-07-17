# Phase 44–50 (v2) — Web Dashboard (user-revised architecture)

**Author:** orchestrator (Mavis)
**Date:** 2026-07-16 Budapest
**Status:** PLAN v2 — supersedes `phase44-web-dashboard-plan.md` (v1 was wrong on the bot launch model)
**Superseded by:** this file
**User correction (verbatim):** *"a bot inditasi terv nem jo, mondtam hogy a bot parancs headles induljon es masik parancs inditsa el a websocket es minden egyeb dolgot. Igy a bot nem pazarol eroforrast ha csak headless akarom futtatni, de barmikor ra tudok csatlakozni ezzel a kulon webes kliens elinditasaval"*

---

## 1. Executive summary

The v1 plan put the WS server **inside the bot process** (`mm-bot start` would start both the bot and the WS/Hono server). The user is correcting that: the bot must be a **pure headless process** that uses **zero resources** for the web stack. The web client is a **separate process** that connects to a running bot's state-feed and serves the browser UI.

**Revised hard constraints:**

- **`mm-bot start` is pure headless.** No WS server, no Hono, no static-file serving, no port binding beyond the state-feed. The bot's footprint is the same as the deleted TUI's was — just the trading engine, plus a tiny state-feed TCP listener (~80 bytes per connected client when idle).
- **`mm-bot web` is a separate command** that runs in a **separate terminal**. It connects to the running bot via a local TCP loopback (state-feed), starts the Hono + bun-websocket server, and serves the web bundle. The web client can be stopped without affecting the bot.
- **Multiple web clients can attach to the same bot.** The operator runs the web client for the dashboard; an observer (e.g. a phone) could run another instance. Each gets its own WS connection to the browser but reads from the same bot.
- **TUI is deleted** (unchanged from v1).
- **Coverage mandate unchanged** for the 7 server-side packages. The web client app (Vite-bundled, DOM-coupled) gets the documented 80% relaxation.

---

## 2. Revised process topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  Terminal 1: mm-bot start  (PURE HEADLESS — zero web resources)     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Bot  (apps/bot/src/bot/bot.ts)                              │    │
│  │  ├─ StateStore (in-memory + persisted JSON)                 │    │
│  │  ├─ PortfolioManager / RiskManager / OrderManager / ...     │    │
│  │  └─ StrategyRunner (one runner per enabled strategy × TF)   │    │
│  │  └─ StateFeedServer  →  TCP listener on 127.0.0.1:7914       │    │
│  │        (NEWLINE-DELIMITED JSON, ~80 bytes per connection    │    │
│  │         when idle, 0 bytes when no client attached)          │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                    │ tcp://127.0.0.1:7914
                                    │ (state-feed, one or more clients)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Terminal 2: mm-bot web  (the web client — fully separate process)  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  WebClient  (apps/bot/src/web-client/index.ts)               │    │
│  │  ├─ StateFeedClient  →  connects to bot at 127.0.0.1:7914    │    │
│  │  ├─ Hono HTTP server on 127.0.0.1:7913                      │    │
│  │  │     ├─ GET  /              → static index.html (built web)│    │
│  │  │     ├─ GET  /api/strategies → proxied via state-feed      │    │
│  │  │     ├─ POST /api/control   → proxied via state-feed      │    │
│  │  │     └─ GET  /api/ohlc      → proxied via state-feed      │    │
│  │  ├─ bun-websocket /ws      → forwards state-feed messages   │    │
│  │  │                            to the browser                 │    │
│  │  └─ BUN_FRONTEND_BUNDLE     → serves the built web app      │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                    │ ws://127.0.0.1:7913
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Browser: http://127.0.0.1:7913                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  apps/web/  (React 19 + Vite 6 + lightweight-charts 5.2.0)  │    │
│  │  (identical to v1 — this layer is unchanged)                │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this is better than v1:**

| Aspect | v1 (wrong) | v2 (correct) |
|---|---|---|
| Bot resource cost when only headless is needed | WS server + Hono + bun-websocket always running (≈30MB heap, 1 extra thread) | Just the trading engine + a listening socket (≈0 extra cost) |
| Web client lifecycle | Tied to the bot process | Independent — can start/stop without affecting the bot |
| Multi-user scenario | One WS server, one browser per bot | One bot, N web clients, N browsers per bot |
| Failure isolation | Bot crash takes down the WS server | Bot crash takes down the bot, but the web client detects and exits gracefully |
| Phase structure | Server + state-publisher + REST in `apps/bot/src/server/` | State-feed in `apps/bot/`, web client in `apps/bot/src/web-client/` (still in `apps/bot/`, not a separate package — single binary distribution) |

---

## 3. Revised protocol

Two protocols now, not one:

### 3.1 State-feed protocol (bot ↔ web client, TCP loopback)

Wire: **newline-delimited JSON** over plain TCP on `127.0.0.1:7914`. The bot is the server (it `bind()`s and `accept()`s); the web client is the client. Multiple clients can connect concurrently — each gets a copy of every message (broadcast loop in the bot).

Connection lifecycle:
1. Web client connects via TCP.
2. Bot sends `HELLO` message (server version + supported protocol version).
3. Bot sends `SNAPSHOT` (initial full state).
4. Bot streams `TICK`, `BAR`, `INDICATOR`, `MARKER`, `STATE`, `ERROR`, `PING` messages.
5. Web client sends `PONG` every 25s in response to `PING`.
6. Web client sends `SUBSCRIBE` / `UNSUBSCRIBE` / `CONTROL` to filter or control.
7. Disconnect: TCP close; bot cleans up the client's subscription table.

Message shape (JSON object per line, `\n`-terminated):

```jsonc
// 1) HELLO — sent once on connect (server → client)
{ "type": "hello", "ts": 1784180000000, "serverVersion": "0.43.0", "protocolVersion": 1 }

// 2) SNAPSHOT — sent once after HELLO (server → client)
{
  "type": "snapshot",
  "ts": 1784180000000,
  "bot": {
    "running": false,
    "mode": "paper",
    "equity": 10000,
    "initialEquity": 10000,
    "realizedPnl": 0,
    "positions": [ /* ... */ ],
    "closedTrades": [ /* ... */ ]
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

// 3) TICK — per WS message, throttled to 4 Hz per symbol on the server side
{ "type": "tick", "ts": 1784180000123, "symbol": "BTC/USDC", "price": 60123.45 }

// 4) BAR — per bar close, per (symbol, timeframe)
{ "type": "bar", "ts": 1784180000000, "symbol": "BTC/USDC", "timeframe": "1h",
  "ohlc": { "time": 1784180000, "open": 60100, "high": 60150, "low": 60080, "close": 60123.45, "volume": 12.5 } }

// 5) INDICATOR — per (strategy, timeframe, indicator) update
{ "type": "indicator", "ts": 1784180000000, "strategy": "donchian_pivot_composition",
  "timeframe": "1h", "indicator": "donchian",
  "series": { "upper": [...], "lower": [...], "middle": [...] } }

// 6) MARKER — strategy signal (entry/exit)
{ "type": "marker", "ts": 1784180000000, "strategy": "donchian_pivot_composition",
  "timeframe": "1h", "side": "long", "price": 60100, "label": "ENTER_LONG minConsensus=2/3" }

// 7) STATE — positions / statistics / kill-switch / paused
{ "type": "state", "ts": 1784180000000,
  "positions": [/* */], "closedTrades": [/* */],
  "killSwitch": "armed", "paused": false,
  "statistics": { "totalPnlUsdt": 12.5, "winRate": 60, "maxDrawdownPct": 1.2 } }

// 8) ERROR — engine failure (mirrors the deleted TUI's EngineErrorBanner)
{ "type": "error", "ts": 1784180000000, "message": "DydxFundingSource missing", "recoverable": true }

// 9) PING / PONG — heartbeat (server pings every 10s, client pongs within 5s)
{ "type": "ping", "ts": 1784180000000 }
```

Client → server (filtering + control):

```jsonc
// SUBSCRIBE / UNSUBSCRIBE — filter the tick/bar/indicator/marker stream
{ "type": "subscribe", "symbol": "BTC/USDC", "timeframe": "1h" }
{ "type": "unsubscribe", "symbol": "BTC/USDC", "timeframe": "1h" }

// CONTROL — start/stop/pause/kill_switch
{ "type": "control", "command": "start" }
{ "type": "control", "command": "stop" }
{ "type": "control", "command": "pause", "paused": true }
{ "type": "control", "command": "kill_switch", "confirm": true }

// PONG — heartbeat response
{ "type": "pong", "ts": 1784180000000 }
```

### 3.2 Browser WebSocket protocol (web client ↔ browser, port 7913)

This is a **transparent relay**: the web client forwards every state-feed message to the browser, and every browser command message to the state-feed client (with appropriate origin tagging). The protocol is the same as 3.1 minus the connection management (HELLO, PING/PONG, SUBSCRIBE) which the web client handles internally.

The browser never talks directly to the bot's state-feed. The web client is the broker. This is by design — the browser's security model forbids opening raw TCP sockets.

REST endpoints (also proxied via state-feed):

- `GET /api/strategies` — returns the strategies list (from SNAPSHOT)
- `GET /api/ohlc?symbol=BTC/USDC&tf=1h&count=200` — returns OHLC bars (from ohlcBootstrap + recent)
- `POST /api/control` — body `{ "command": "start" | "stop" | "pause" | "kill_switch", ... }`

---

## 4. Revised file/folder plan

### 4.1 Deleted (Phase 44 — unchanged from v1)

```
packages/tui/                                    # entire package
apps/bot/src/tui/                                # entire dir
apps/bot/src/cli/commands/tui.ts                 # subcommand
```

### 4.2 Created (Phase 45 + 46 + 47 + 48 + 49 + 50)

```
apps/bot/src/state-feed/                         # NEW — bot-side state-feed
├── protocol.ts                                  # JSON message types (shared with browser)
├── feed-server.ts                               # TCP server on 127.0.0.1:7914
├── publisher.ts                                 # Bot.subscribe → state-feed messages
├── broadcast.ts                                 # per-client subscription table, 4Hz tick throttle
├── heartbeat.ts                                 # 10s PING / 30s PONG timeout
├── ohlc-store.ts                                # 200-bar ring buffer per (symbol, tf)
├── index.ts                                     # attachStateFeed(bot, opts) exported
└── __tests__/
    ├── feed-server.test.ts
    ├── publisher.test.ts
    ├── broadcast.test.ts
    ├── heartbeat.test.ts
    └── ohlc-store.test.ts

apps/bot/src/web-client/                         # NEW — separate web client
├── client.ts                                    # state-feed TCP client (auto-reconnect)
├── http-server.ts                               # Hono on 127.0.0.1:7913
├── ws-relay.ts                                  # bun-websocket /ws → forward to state-feed client
├── rest-proxy.ts                                # GET /api/*, POST /api/control → state-feed
├── static-server.ts                             # serves apps/web/dist/*
├── index.ts                                     # startWebClient(bot?, opts) — the `mm-bot web` entry
└── __tests__/
    ├── client.test.ts
    ├── http-server.test.ts
    ├── ws-relay.test.ts
    └── rest-proxy.test.ts

apps/bot/src/cli/commands/
├── web.ts                                       # NEW — `mm-bot web` subcommand (Phase 50A)
├── serve.ts                                     # DELETED — replaced by web.ts
└── start.ts                                     # MODIFIED — pure headless, no TUI/WS branch

apps/web/                                        # NEW — workspace package (Phase 46+)
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx                                  # Top-nav shell (eggproject-design-app-common)
│   ├── theme.ts                                 # data-theme toggle
│   ├── ws-client.ts                             # WebSocket → App state
│   ├── protocol.ts                              # re-export from @mm-crypto-bot/server
│   ├── charts/
│   │   ├── ChartGrid.tsx                        # adaptive grid of <LcWrap>
│   │   ├── ChartCard.tsx                        # single chart card
│   │   ├── ohlc-bridge.ts                       # WS messages → lc-wrap calls
│   │   └── subscription.ts                      # visible-charts → SUBSCRIBE messages
│   ├── indicators/
│   │   ├── index.ts                             # registry: STRATEGY → IndicatorDescriptor[]
│   │   ├── IndicatorLayer.tsx                  # indicator lines/markers
│   │   └── SignalMarkers.tsx                   # entry/exit markers
│   ├── components/
│   │   ├── StatsStrip.tsx                       # P&L, drawdown, win rate, sharpe
│   │   ├── PositionsTable.tsx                   # TanStack (vendored in B)
│   │   └── ControlBar.tsx                       # start/stop/pause/kill_switch buttons
│   ├── realtime/
│   │   └── UpdateBatcher.ts                     # rAF batching for tick/bar messages
│   ├── styles/
│   │   └── app.css                              # imports eggproject-design tokens
│   └── __tests__/
│       ├── ws-client.test.ts
│       ├── ChartGrid.test.tsx
│       ├── IndicatorLayer.test.tsx
│       ├── SignalMarkers.test.tsx
│       ├── UpdateBatcher.test.ts
│       ├── StatsStrip.test.tsx
│       └── PositionsTable.test.tsx
```

### 4.3 Modified

```
package.json (root)                    # add apps/web to workspaces, add web:dev/web:build scripts
turbo.json                             # add apps/web#build, #lint, #test
apps/bot/package.json                  # drop ink/react deps; add Hono + bun-websocket for web-client only
apps/bot/src/cli/router.ts             # register `web` subcommand (replaces `tui`)
apps/bot/src/cli/index.ts              # `web` dispatch
apps/bot/src/bot/bot.ts                # add subscribeToIndicators + emitIndicator hook (Phase 45)
apps/bot/src/cli/commands/start.ts     # pure headless — strip TUI surface
.env.example                           # add MM_BOT_WEB_PORT, MM_BOT_WEB_BIND, MM_BOT_FEED_PORT
README.md                              # TUI section → web dashboard section
deliverable.md                         # append Phase 44–50 closure
docs/production-strategies/bot.md      # add serve workflow
docs/production-strategies/pre-launch-checklist.md  # replace TUI smoke with web smoke
```

---

## 5. Revised phase breakdown (8 phases, 10 PRs, ~14 days)

| # | Phase | PRs | Scope | Net new files |
|---|-------|-----|-------|---------------|
| 44 | **TUI Removal** | 1 | Delete `packages/tui/`, `apps/bot/src/tui/`, the `tui` subcommand, all Ink deps. `start.ts` becomes pure-headless. | 0 (+0, -800 tests) |
| 45 | **State-Feed in Bot** | 2 | New `apps/bot/src/state-feed/` (publisher, feed-server, broadcast, heartbeat, ohlc-store). Bot exposes TCP listener on `127.0.0.1:7914`. **NO WS server, NO Hono** in this phase — the bot is still pure. | +5 src + 5 tests |
| 46 | **Web Client** | 1 | New `apps/bot/src/web-client/` (TCP client + Hono + bun-websocket + REST proxy). `mm-bot web` subcommand. Static file serving from `apps/web/dist/`. | +6 src + 4 tests |
| 47 | **Web App Skeleton** | 1 | New `apps/web/` workspace package. React 19 + Vite 6. Top-nav shell. WS client + reconnect. `data-theme="dark"` default. | +30 src + 7 tests |
| 48 | **Multi-TF Chart Grid** | 1 | `<LcWrap>` per (strategy × timeframe). Adaptive grid. OHLC bootstrap. Subscribe/unsubscribe per visible chart. | +4 src + 1 test |
| 49 | **Indicator Overlays** | 2 | Indicator registry. Donchian + pivot + funding rate + cascade markers. Strategy signal markers. | +3 src + 2 tests |
| 50 | **Realtime + Reconnect** | 1 | rAF batching. Exponential backoff for state-feed AND browser-WS. | +1 src + 1 test |
| 51 | **Deployment + Cutover** | 2 | `mm-bot web` subcommand in `apps/bot/src/cli/commands/web.ts`. README + docs. `bun run coverage:full` audit. | +1 src + 1 test |

**Renumbering vs v1:** Phase 46 in v1 was "Web App Skeleton" (which becomes Phase 47 in v2); v1's Phase 50 (Deployment) becomes Phase 51 in v2; the Web Client is now Phase 46 in v2.

### 5.1 Phase 45 — State-Feed in Bot (2 PRs)

**The bot is STILL pure headless in this phase. NO WS server, NO Hono, NO static-file serving. The bot just exposes a tiny TCP listener for the state-feed. The web client is a separate later phase.**

**PR 45A — Publisher + feed-server skeleton**

- New package: `apps/bot/src/state-feed/`
  - `protocol.ts` — JSON message types (shared source of truth, later re-exported to `apps/web/`)
  - `publisher.ts` — the renamed `live-bot-state-provider.ts` minus the Ink surface; emits serializable events when `Bot.subscribe(listener)` fires
  - `feed-server.ts` — TCP server on `127.0.0.1:7914`. Newline-delimited JSON. Multi-client broadcast.
  - `broadcast.ts` — per-client subscription table, 4 Hz tick throttle, snapshot-on-connect
- `apps/bot/src/bot/bot.ts` — accept an `attachStateFeed(bot, { port: 7914 })` call from the CLI; this attaches the feed-server lifecycle to the bot.
- Tests: `apps/bot/src/state-feed/{publisher,feed-server,broadcast}.test.ts` (~30 tests, ≥4 per file)
- Coverage: 100% on the new files.

**PR 45B — Heartbeat + OHLC store + indicator emission**

- `heartbeat.ts` — 10s PING / 30s PONG timeout, closes idle clients.
- `ohlc-store.ts` — 200-bar ring buffer per (symbol, tf), populated by the bot's existing bar-close handlers.
- The publisher now also emits `INDICATOR` messages — the `StrategyRunner` is updated to publish indicator snapshots (currently they're internal to the strategy; we need to expose them).
- Tests: `apps/bot/src/state-feed/{heartbeat,ohlc-store}.test.ts` (~20 tests)
- Coverage: 100%.

### 5.2 Phase 46 — Web Client (`mm-bot web` subcommand)

**This is the first phase that has ANY web/Hono/WS code. The web client is a separate process that the user starts in a separate terminal. It connects to the running bot's state-feed.**

- `apps/bot/src/web-client/`
  - `client.ts` — TCP client to `127.0.0.1:7914`, auto-reconnect (1s/2s/4s/8s/30s), exponential backoff, snapshot re-sync on reconnect.
  - `http-server.ts` — Hono server on `127.0.0.1:7913`.
  - `ws-relay.ts` — `bun-websocket` `/ws` route; forwards every state-feed message to the browser; forwards browser SUBSCRIBE/CONTROL messages back to the state-feed client.
  - `rest-proxy.ts` — REST endpoints (proxies to the state-feed client; on disconnect returns 503).
  - `static-server.ts` — serves `apps/web/dist/` (the built web bundle).
  - `index.ts` — `startWebClient({ port: 7913, feedHost: "127.0.0.1", feedPort: 7914, webDistDir: "apps/web/dist" })`.
- `apps/bot/src/cli/commands/web.ts` — `mm-bot web [--port=7913] [--feed-host=127.0.0.1] [--feed-port=7914] [--no-static]`
  - Validates the bot is reachable (TCP connect probe to feed-port; if unreachable, exits with a clear error: "Bot not running. Start it first with: `mm-bot start`").
  - Starts the web client.
  - On Ctrl+C: graceful shutdown (close WS clients, close HTTP server, close state-feed TCP connection).
- Tests: `apps/bot/src/web-client/{client,http-server,ws-relay,rest-proxy}.test.ts` (~30 tests)
- Coverage: 100% on the new files.

### 5.3 Phases 47–51 (chart grid, indicators, realtime, deployment) — **unchanged from v1**

The web app, the chart grid, the indicator registry, the realtime layer, and the deployment docs are identical to v1. The only difference: the web app's WS client points at `http://127.0.0.1:7913/ws` (the web client's WS endpoint), not at a bot's WS endpoint.

---

## 6. Revised resource profile

| Scenario | Process count | Memory (approx) | CPU | Notes |
|---|---|---|---|---|
| Bot running, NO web client | 1 (bot only) | ~50MB heap | 1 thread | The TUI was ~30MB; pure headless is leaner. State-feed socket idle, ~80B per client when connected. |
| Bot + 1 web client | 2 (bot + web client) | ~80MB heap total | 2 threads | The web client is small (Hono + bun-websocket + Vite-bundled browser code in memory). |
| Bot + 1 web client + 1 browser tab | 3 processes | ~80MB bot+web + browser overhead | 3 threads | Browser does the rendering; bot+web just transport. |
| Bot + 3 web clients (operator + 2 observers) | 4 processes | ~110MB heap | 4 threads | Each web client is independent; the bot's broadcast loop copies each message N times. |
| Bot + 1 web client (browser closed) | 2 processes | ~80MB | 2 threads | Web client stays alive even with no browser; useful for "I'm away from the desk but the bot is running". |

**Comparison with v1:**

| Scenario | v1 (WS in bot) | v2 (WS in web client) | Delta |
|---|---|---|---|
| Bot alone (no web) | ~80MB (WS+Hono in bot) | ~50MB | **-30MB** |
| Bot + web | ~80MB (one process) | ~80MB (two processes) | 0 |
| Bot + 3 web | n/a (only 1 web) | ~110MB | 0 (but 3 webs are now possible) |

The user is right: **headless mode is the common case** (operator runs the bot, then decides whether to attach a web client). The v1 design made the common case pay 30MB extra for an unused feature. The v2 design has the common case pay 0 extra.

---

## 7. Test plan (revised)

Each phase's acceptance protocol is unchanged. Adversarial probes for Phase 51 verifier:

- **Resource profile:** start `mm-bot start` (no web), measure RSS after 5 min idle. Should be ~50MB, NOT ~80MB. This proves the v2 design wins.
- **Web client disconnect:** kill `mm-bot web` while the bot is running; the bot's `feed-server` should log the disconnect, clean up the subscription, and stay running. No resource leak.
- **Bot disconnect:** kill `mm-bot start` while `mm-bot web` is running; the web client should detect the TCP close, show a "Bot disconnected" overlay, and exit within 30s. (Optional: keep retrying with backoff; default is "exit cleanly" because the user said "külön parancs".)
- **Multi-client:** start 2 `mm-bot web` instances on different ports (7913 + 7914), each with a different browser tab. Both browsers should see the same state, independently. The bot's broadcast loop should be the only shared resource.
- **State-feed protocol drift:** if the web client and bot have different `protocolVersion` (HELLO message), the web client should print a clear error and refuse to start.
- **Coverage:** 7 server-side packages at 100% OWN, `apps/web` at ≥80% OWN.

---

## 8. Risks (revised)

| Risk | Impact | Mitigation |
|---|---|---|
| State-feed TCP server left as a stale listening socket | Bot restart leaves port 7914 in TIME_WAIT | The feed-server uses `SO_REUSEADDR`; on bot restart, the new instance re-binds immediately. |
| Multi-client broadcast loop CPU | O(N) per tick per client | N is realistically 1–3; even at 4 Hz × 100 ticks/sec = 400 messages/sec total, the broadcast loop is negligible. If N grows, add a per-client subscription filter so each client only gets the (symbol, tf) it subscribed to. (Phase 45 PR A) |
| Web client crashes mid-session | User has to restart the web client manually | The web client has its own auto-restart? No — let the user Ctrl+C and re-run. The bot is unaffected. |
| Static file path portability | `apps/web/dist/` relative to CWD | The web client resolves the path relative to the `mm-bot` binary's directory (NOT CWD). The `install-mm-bot.sh` postinstall already symlinks the binary, so the resolution is deterministic. |
| Web bundle not yet built | User runs `mm-bot web` before `bun run web:build` | The web client detects the missing bundle and prints a clear error: "Run `bun run web:build` first." (Phase 46) |
| Coverage mandate relaxation for `apps/web` | 8/8 → 7/7 packages at 100% (the original 8 minus tui) + 1 at 80% | Same as v1 — documented in the board + deliverable. |
| TUI users have no migration path | Phase 44 deletes the TUI entirely | Same as v1 — no in-flight TUI PRs at the start of Phase 44. |

---

## 9. Rollback plan (revised)

Identical to v1. The TUI deletion is one atomic commit (Phase 44), reversible via `git revert <phase-44-commit>`. The state-feed, web client, and `apps/web/` are new code with no legacy to roll back from.

---

## 10. Open questions (for the user)

1. **State-feed port: 7914 or configurable?** Default: `MM_BOT_FEED_PORT` env var, fallback 7914.
2. **Web client port: 7913 or configurable?** Default: `MM_BOT_WEB_PORT` env var, fallback 7913.
3. **Web client behavior on bot disconnect:** exit cleanly (default), or retry with backoff? **Default: exit cleanly.** The user said "külön parancs" — separate process — implying manual control.
4. **Auth on the state-feed (bot ↔ web client):** No auth (loopback-only). If you want the bot bindable to LAN, we'd add a token. **Default: 127.0.0.1 only, no auth.**
5. **Auth on the web server (web client ↔ browser):** No auth (loopback-only). Same as state-feed. **Default: 127.0.0.1 only.**
6. **Vite vs. bun-bundled HTML for `apps/web/`?** Same as v1: Vite dev + Bun build prod.
7. **Bundle size budget:** Same as v1: 400KB gzipped first paint.
8. **`mm-bot web` should auto-discover the bot?** Default: NO — the user must pass `--feed-host` + `--feed-port` (or use defaults `127.0.0.1:7914`). Auto-discovery via mDNS or filesystem hints is overkill.
9. **Multi-bot (run multiple bots + 1 web client)?** Out of scope. The state-feed binds to a single port (7914); a future feature could add `--feed-port=7915` to run a second bot, and the web client could multiplex.
10. **Web client's `--no-static` mode** (use the web client as a pure WS proxy to a remote Vite dev server): useful for dev. **Default: enabled (serve from `apps/web/dist/`).**

---

## 11. Timeline (revised, same as v1 but with a new Phase 46)

| Phase | Calendar | PRs |
|-------|----------|-----|
| 44 | 1 day | 1 |
| 45 | 3 days | 2 |
| 46 (web client) | 2 days | 1 |
| 47 (web skeleton) | 2 days | 1 |
| 48 (chart grid) | 2 days | 1 |
| 49 (indicators) | 3 days | 2 |
| 50 (realtime) | 1 day | 1 |
| 51 (cutover) | 2 days | 2 |
| **Total** | **~16 days** | **11 PRs** |

The orchestrator delegates each phase to a sub-agent (one per phase, parallel where possible — Phase 47 + 48 can overlap since they touch different parts of `apps/web/`).

---

## 12. Verification of the user's mandates (revised checklist)

- ✅ **WebSocket-alapú web dashboard** — `apps/web/` + `apps/bot/src/web-client/`
- ✅ **EggProject design system** — `colors_and_type.css` + `lc-wrap` + `lightweight-charts@5.2.0`
- ✅ **Chart eszköz használata** — `lightweight-charts@5.2.0` via `lc-wrap`
- ✅ **React Turbo repo app** — `apps/web/` workspace package, Vite 6, React 19
- ✅ **TUI teljes törlés** — Phase 44 deletes `packages/tui/`, `apps/bot/src/tui/`, all Ink deps
- ✅ **Bot MINDIG headless, MÁS parancs indítja a web/Ws-t** — `mm-bot start` (headless + state-feed) + `mm-bot web` (web client), separate processes, separate terminals
- ✅ **Nincs erőforrás pazarlás** — bot alone is 50MB, NOT 80MB; web client only starts when the user wants it
- ✅ **Bármikor rá tud csatlakozni** — `mm-bot web` can be started/stopped without affecting the bot; the state-feed accepts new clients at any time
- ✅ **Minden stratégiának ≥1 chart, multi-TF → több chart** — Phase 48 renders one `<LcWrap>` per (strategy, timeframe)
- ✅ **Realtime** — WS tick stream throttled to 4Hz, `requestAnimationFrame` batching

---

## 13. Next step

If you approve the v2 plan, the orchestrator creates:

1. A new branch `phase/44-tui-removal` off main
2. A worktree for Phase 44
3. The deletion + rename commit
4. The PR (single big delete; coverage + tests must stay 100% on the 7 remaining packages)
5. Waits for CI (6/6 green)
6. Merges with `--admin` and `--delete-branch`
7. Repeats for Phase 45 (state-feed in bot, NO web code), Phase 46 (web client as separate process), Phase 47 (web app skeleton), etc.

Each phase is a separate, reversible PR. The board is updated at each phase close.

**No implementation starts until you say `csinald` / `folytasd` / `go` / `approved`.**
