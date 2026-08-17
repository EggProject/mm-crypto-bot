# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.81.0] - 2026-07-27

### Added
- StrategyRunner position-skip + `onOpenPositionUpdate` flow.
- State-restore: `data/bot-state.json` → PositionManager on bot startup.
- Backtest-verified paper config (`paper-backtest-verified.toml`) reproducing the Phase 30b backtest behavior.

### Changed
- The default `run-bot/config/default.toml` is the FAILSAFE baseline (`min_consensus = 2`); the backtest-verified `paper-backtest-verified.toml` is the recommended config for paper mode (`min_consensus = 1`).
- Kill-switch `>` fix: no false-positive on `current == max`.
- README restructured: phases are no longer written in user-facing docs; the canonical history lives here in `docs/CHANGELOG.md`.

## [0.70.0] - 2026-07-01

### Fixed
- Kill-switch `>` comparison: no false-positive when `current == max` (off-by-one).

## [0.68.0] - 2026-06-20

### Added
- State-restore from `data/bot-state.json` → PositionManager on startup (survives bot restarts).

## [0.67.0] - 2026-06-15

### Added
- StrategyRunner position-skip (skip re-opening a position if the current state says one is open).

## [0.51.0] - 2026-05-20

### Added
- Deployment README + final smoke test.
- 7/7 server packages at 100% OWN line coverage enforced by `scripts/coverage-per-package.sh` (CI gate).
- `mm-bot` CLI production-ready with 1:10 leverage three-layer protection.
- Live trading workflow (user-run): config + bybit.eu API key + paper-test + manual promote.

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
