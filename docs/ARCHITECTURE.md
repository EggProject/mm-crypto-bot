# Architecture

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

## State-feed protocol

The state-feed publisher (in `apps/bot/src/state-feed/`) emits the following ND-JSON message types over TCP loopback `127.0.0.1:7914`:

| Type | Direction | Purpose |
|---|---|---|
| `HELLO` | bot → web | Sent on connect: protocol version, bot version, run config summary |
| `SNAPSHOT` | bot → web | Full state on connect + on `refresh` |
| `TICK` | bot → web | Incremental update (rAF-batched in the web client) |
| `BAR` | bot → web | New OHLC bar (chart append) |
| `PING` | bot → web | Every 10s — keep-alive |
| `PONG` | web → bot | Reply within 30s or reconnect |

The web client re-emits `TICK` / `BAR` to browsers over WebSocket, and the SPA's `useWebSocket()` hook feeds them into a `RealtimeBatcher` (rAF-driven) to coalesce high-frequency updates into one React render per frame.

## Bot engine

`apps/bot/src/bot/` contains the headless engine:

- `Bot` — orchestrator, lifecycle (init / run / stop), signal-center integration
- `StrategyRunner` — one per strategy, runs the bar-driven signal loop
- `OrderManager` — order routing through the exchange adapter
- `PositionManager` — open positions, state-restore from `data/bot-state.json`
- `RiskBudget` / `CorrelationMatrix` / `PortfolioStop` — portfolio-level coordination
- `KillSwitch` — three-layer protection (max-DD, max-positions, latency-gate)

## Web client

`apps/bot/src/web-client/` is a Hono-based thin relay:

- HTTP server on `127.0.0.1:7913`
- WebSocket relay (browser-facing)
- Static server for the built `apps/web/dist/`
- REST proxy for `/api/*` calls into the bot engine

## Dashboard SPA

`apps/web/src/` is a React 19 + Vite 6 SPA:

- `App.tsx` — root, theme provider, route shell
- `components/ChartGrid` — vertical flex stack of `ChartCard` (one per `(strategy, symbol, timeframe)` triple: 5 strategies × 3 symbols × 3 timeframes = 45 cards)
- `components/ControlBar` — sticky Start / Stop / Pause / Resume / Kill Switch
- `components/PositionsTable` — open positions with `qty`, `entry`, `mark`, `uPnl`
- `components/StatusBanner` — `Bot: RUNNING · uptime X · last update Y · N active strategies · M open positions`
- `lib/useWebSocket` — auto-reconnect, rAF-batched updates
- `lib/RealtimeBatcher` — coalesces high-frequency updates into one render per frame
