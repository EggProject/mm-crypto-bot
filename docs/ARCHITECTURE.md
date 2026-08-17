# Architecture

`mm-bot start` validates configuration, constructs the trading components,
subscribes to the market-data timeframes required by active strategies, and
runs until graceful shutdown or a fail-closed runtime error.

## Bot engine

`apps/bot/src/bot/` contains the headless engine:

- `Bot` — orchestrator, lifecycle (init / run / stop), signal-center integration
- `StrategyRunner` — one per strategy, runs the bar-driven signal loop
- `OrderManager` — order routing through the exchange adapter
- `PositionManager` — open positions, state-restore from `data/bot-state.json`
- `RiskBudget` / `CorrelationMatrix` / `PortfolioStop` — portfolio-level coordination
- `KillSwitch` — three-layer protection (max-DD, max-positions, latency-gate)
