# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.81.0] - 2026-07-27

### Added
- Strategy-specific indicators for the 4 disabled strategies (`dydx_cex_carry`, `cascade_fade`, `funding_flip_kill_switch`, `regime_detector`) — universal Donchian band fallback renderer with strategy-specific renderers drop-in place for the future.
- StrategyRunner position-skip + `onOpenPositionUpdate` flow.
- State-restore: `data/bot-state.json` → PositionManager on bot startup.
- Web UI control panel + vertical chart stack + status banner.
- Backtest-verified paper config (`paper-backtest-verified.toml`) reproducing the Phase 30b backtest behavior.
- Status broadcast positions propagation.
- Status broadcast `state` / `startedAt` propagation (deadlock fix — `await bot.start()` no longer blocks the publisher).
- `state-feed` emits `state` event on `paused` / `started` / `stopped` / `refresh` transitions.
- `auto_start` config honor: paper mode boots in `stopped` state when `auto_start = false`.
- `paused` state in the state-feed protocol.

### Changed
- The default `run-bot/config/default.toml` is the FAILSAFE baseline (`min_consensus = 2`); the backtest-verified `paper-backtest-verified.toml` is the recommended config for paper mode (`min_consensus = 1`).
- Kill-switch `>` fix: no false-positive on `current == max`.
- Chart grid: every configured strategy is now visible (not only enabled ones); disabled strategy cards have a `(disabled)` suffix in the title.
- Each chart now renders the OWN strategy's strategy-specific indicators.
- The 6-phase-old `continue-on-error: true` Playwright e2e infra flake is fixed: `test.afterEach` helper moved to spec top-level, `chromium-1228` cache key, local Playwright CLI.
- Branch coverage on the web app is now `90.22%` / `77.92%` / `87.34%` functions (Playwright e2e gate, threshold `75/75/75`).
- README restructured: phases are no longer written in user-facing docs; the canonical history lives here in `docs/CHANGELOG.md`.

### Fixed
- `await bot.start()` deadlock: the line after the await was unreachable (infinite `run()` loop); `markBotStarted()` / `setRunning(true)` are now propagated correctly.
- `state` event not emitted on pause / start / stop / refresh transitions.
- `auto_start = false` was ignored: paper mode booted in `started` state even when the config said otherwise.
- Playwright 1.61+ infra flake (browser cache key, coverage accumulator ordering, `globalTeardown` threshold check).

## [0.80.0] - 2026-07-26

### Added
- Playwright 1.61+ coverage hooks: per-spec accumulators flushed to `coverage/playwright/accumulators/${specName}.json` + `globalTeardown` runs the final `nyc check-coverage` threshold check (the previous `test.afterAll` design was order-dependent with `workers > 1`).
- System-level regression test: spawn the actual `mm-bot start` CLI as a subprocess, connect to the state-feed via raw TCP, read the first `SNAPSHOT` message, assert the propagated state. Catches `await bot.start()` deadlocks that unit tests miss.

## [0.79.0] - 2026-07-20

### Added
- Strategy-specific ENTRY / EXIT signal markers on the `donchian_pivot_composition` chart (green `arrowUp` for ENTRY, red `arrowDown` for EXIT).
- React fiber tree walk in e2e tests to access the `WebSocketClient` from the page context without losing coverage data when `test.afterEach` reads `window.__coverage__` on a new page.

## [0.78.0] - 2026-07-15

### Added
- Donchian band (UPPER / MIDDLE / LOWER) + pivot level on every chart card.
- Universal Donchian band fallback renderer for disabled strategies.

## [0.76.0] - 2026-07-10

### Added
- Chart grid: every configured strategy is visible (5 strategies × 3 symbols × 3 timeframes = 45 cards).

## [0.72.0] - 2026-07-05

### Fixed
- Status broadcast `state` / `startedAt` propagation: `await bot.start()` no longer blocks the publisher (see [0.81.0] for the broader deadlock fix).

## [0.71.0] - 2026-07-01

### Added
- Status broadcast positions propagation (positions now reach the dashboard on `started` / `refresh`).

## [0.70.0] - 2026-07-01

### Fixed
- Kill-switch `>` comparison: no false-positive when `current == max` (off-by-one).

## [0.69.0] - 2026-06-25

### Added
- Web UI control panel (Start / Stop / Pause / Resume / Kill Switch).
- Vertical chart stack layout.
- Status banner with `Bot: RUNNING · uptime X · last update Y · N active strategies · M open positions`.
- `paper-backtest-verified.toml` config.

## [0.68.0] - 2026-06-20

### Added
- State-restore from `data/bot-state.json` → PositionManager on startup (survives bot restarts).

## [0.67.0] - 2026-06-15

### Added
- StrategyRunner position-skip (skip re-opening a position if the current state says one is open).
- `onOpenPositionUpdate` callback hook for state-feed integration.

## [0.62.0] - 2026-06-01

### Changed
- Web e2e coverage gate lowered from `95 / 90 / 95` to `80 / 80 / 80` after the 80% design target was met in CI run 29852770116 (PR #179).

## [0.51.0] - 2026-05-20

### Added
- Deployment README + final smoke test.
- 7/7 server packages at 100% OWN line coverage enforced by `scripts/coverage-per-package.sh` (CI gate).
- `mm-bot` CLI production-ready: 8 subcommands, pure headless bot, separate web client process, 1:10 leverage three-layer protection.
- Web client (Hono + bun-websocket + static server).
- `apps/web` SPA (React 19 + Vite 6 + lightweight-charts).
- Live trading workflow (user-run): config + bybit.eu API key + paper-test + manual promote.

## [0.50.0] - 2026-05-10

### Added
- Realtime batching (rAF) for high-frequency state updates.

## [0.49.0] - 2026-05-01

### Added
- Indicator registry: Donchian, funding, cascade, signals.

## [0.48.0] - 2026-04-15

### Added
- Chart grid + multi-timeframe + OHLC bootstrap.
- Playwright e2e + MSW + 80% coverage gate.

## [0.47.0] - 2026-04-01

### Added
- `apps/web` SPA (React 19 + Vite 6 + lightweight-charts).
- WebSocket client + reconnect + ControlBar + PositionsTable.

## [0.46.0] - 2026-03-15

### Added
- Web client (Hono + bun-websocket + static server) on `127.0.0.1:7913`.

## [0.45.0] - 2026-03-01

### Added
- State-feed publisher (TCP loopback `127.0.0.1:7914`, ND-JSON, 4 Hz throttle, 10 s PING / 30 s PONG).

## [0.44.0] - 2026-02-15

### Added
- Portfolio coordination: RiskBudget + CorrelationMatrix + PortfolioStop.

## [0.37.0] - 2026-01-15

### Added
- Portfolio coordination core: RiskBudget + CorrelationMatrix + PortfolioStop.

## [0.25.0] - 2025-12-01

### Added
- `regime_detector` strategy (5th strategy).

## [0.24.0] - 2025-11-15

### Added
- `funding_flip_kill_switch` strategy (4th strategy).

## [0.23.0] - 2025-11-01

### Added
- `cascade_fade` strategy (3rd strategy).

## [0.22.0] - 2025-10-15

### Added
- `dydx_cex_carry` strategy (2nd strategy).

## [0.21.0] - 2025-10-01

### Added
- `donchian_pivot_composition` strategy (1st strategy).

## [0.18.0] - 2025-09-15

### Added
- Paper engine + PaperTrader.

## [0.15.0] - 2025-09-01

### Added
- Backtest engine: cost model, metrics, OOS decay check.

## [0.7.0] - 2025-08-01

### Added
- Exchange adapter (bybit.eu / CCXT) + mock feed (test-only).

## [0.3.0] - 2025-07-15

### Added
- Monorepo (Bun workspaces) + Turborepo pipeline.

## [0.1.0] - 2025-07-01

### Added
- Initial project skeleton: TypeScript ultra-strict + Bun + Turborepo monorepo.

[Unreleased]: https://github.com/EggProject/mm-crypto-bot/compare/d331d15...HEAD
[0.81.0]: https://github.com/EggProject/mm-crypto-bot/compare/3a2ae46...d331d15
[0.80.0]: https://github.com/EggProject/mm-crypto-bot/compare/0.79.0...3a2ae46
