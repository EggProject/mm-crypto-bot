# Phase 66 — paper mode = REAL bybit.eu, no mock feed, bar flow fix

**Status:** 🔴 IN PROGRESS
**Started:** 2026-07-23 07:59 Budapest
**User mandate:** paper mode MUST use real bybit.eu (no mock feed); backtest = downloaded OHLCV; no mock feed EVER for paper.

## Why this phase exists

The Phase 38 Fix #42 deliberately routed paper mode through `MockExchangeFeed` for deterministic backtesting. **That decision was wrong for live paper use.** The user is explicit: paper mode = real bybit.eu market data + simulated orders. Mock feed only for backtest's `exchange.id = "mock"` mode.

## Goals (binary, testable)

1. **Bot feed** in paper mode = real bybit.eu (`exchangeId: "bybiteu"` in log). NOT `mock`.
2. **No real orders** sent in paper mode — `OrderManager.placeOrder` synthesizes a filled order locally, skips `feed.placeOrder`.
3. **OHLCV bars** reach the web client dashboard — `stateFeed.publisher.publishBar()` must fire for every bar; `barsByKey` must be non-empty.
4. **WebSocket: connected** + real BTC/ETH/SOL price chart visible in the browser.

## File-by-file plan

| File | Change | Status |
|---|---|---|
| `apps/bot/src/bot/bot.ts` | (1) Drop `mock` from paper mode branch — only `exchange.id == "mock"` uses MockExchangeFeed. (2) Paper mode without `BYBIT_API_KEY` → empty-cred override + skip `fetchBalances`. (3) Add OHLCV subscription per timeframe (1h/4h/1d). (4) Add `stateFeed.publisher.publishBar` hook in the ohlcv callback. (5) Add `attachStateFeed` public method + `stateFeed` field. (6) Pass `paperMode: true` to `OrderManager` constructor. | DONE |
| `packages/exchange/src/bybitEuFeed.ts` | Add polling fallback in `runTickerLoop` and `runOhlcvLoop` — CCXT 4.5.64 bybit.eu throws `NotSupported` for `watchTicker`/`watchOHLCV`. | DONE |
| `apps/web/src/ws-client.ts` | Support `VITE_WS_URL` env (for non-default ports). | DONE |
| `apps/bot/package.json` | Remove `--external protobufjs` from build script (CCXT bybit.eu needs protobufjs/minimal.js). | DONE |
| `package.json` + `bun.lock` | Add `protobufjs` to deps. | DONE |
| `apps/web/src/main.tsx` | Import `control-bar.css` (EggProject design system). | DONE |
| `apps/web/src/styles/control-bar.css` | NEW — EggProject token-based styling for ControlBar (gold Start, outlined secondary, red Kill Switch). | DONE |
| `apps/web/src/styles/eggproject-design/` | NEW — vendored design system source (colors_and_type.css + tokens). | DONE |
| `apps/bot/src/cli/commands/start.ts` | Call `bot.attachStateFeed(stateFeed)` after `attachStateFeed` returns, before `bot.start()`. | DONE (NOT YET VERIFIED) |
| `apps/bot/src/bot/order-manager.ts` | Add `paperMode?: boolean` option. When true, `placeOrder` synthesizes a filled `Order` locally, skips `feed.placeOrder` (which requires API key on bybit.eu). | DONE |

## Verification (must pass before declaring done)

1. `bun run build` from root → 8/8 turbo tasks succeed.
2. `bun run start --config=run-bot/config/default.toml` → log shows `"feed opened","exchangeId":"bybiteu"`, NOT `mock`. Log shows `paper-mode order simulated` for every order (no `bybiteu requires apiKey` errors). Log shows `published bar` for every OHLCV tick.
3. `bun run mm-bot web` in a second terminal → `[web] web client listening on http://127.0.0.1:7913`.
4. Browser at `http://127.0.0.1:7913` (or vite preview 7923 for the test environment) → screenshot shows real OHLCV charts, not "No charts configured". `WebSocket: connected` green dot.
5. The `apps/web` `vite build` was done with `VITE_WS_URL="ws://127.0.0.1:7925/ws"` to point at the test web client port (not the default 7913).

## Known unknowns / risks

- The `runTickerLoop` polling fallback in `bybitEuFeed.ts` was added without a real-network test from this session — the bybit.eu `fetchTicker` public endpoint behaviour under CCXT 4.5.64 is assumed-correct.
- The paper-mode `OrderManager.placeOrder` synthesizes a `fee` field at 10bps — not a realistic market simulation. The `PaperTrader` from `packages/paper` was bypassed in favor of this thin wrapper because PaperTrader has a different interface (takes `TradingSignal`, not `OrderIntent`). Future work: rewrite the bridge.
- The position-accumulation behaviour in the `donchian_pivot_composition` strategy (every tick opens a new position without closing) will trip the L2 leverage cap after a few minutes. This is a strategy issue, not a Phase 66 issue — but it will spam the log. Don't conflate it with Phase 66.
- `VITE_WS_URL` requires a rebuild of `apps/web` whenever the port changes. The CI default build assumes port 7913 (the `mm-bot web` default).

## Out of scope for Phase 66 (separate PR if needed)

- Re-enable the `PaperTrader` for full mark-to-market PnL tracking in paper mode.
- The `L2 leverage breach` error storm from `donchian_pivot_composition` accumulating positions — needs a strategy-level cap or close-on-opposite logic.
- `VITE_WS_URL` baked at build time vs runtime — for multi-instance web clients a different solution is needed.
- Migrate `bybitEuFeed` away from CCXT (custom WS implementation) to remove the `protobufjs` dep.
