---
description: Project board — mm-crypto-bot. Updated 2026-07-11 23:42 Budapest — Phase 32 MERGED (f201674 from PR #65). Phase 33 SCOPED: 4 user mandates (remove live-test code, complete the bot, config-driven strategy enable/disable, CLI app).
---

# Project board — mm-crypto-bot (updated 2026-07-11 23:42 Budapest, Phase 33 SCOPED)

## User mandate (2026-07-11 23:42 Budapest) — PHASE 33 SCOPE

User explicit 4-point directive (Hungarian → English):

1. **"minden live test dolgot torolj, azt majd en vegzem!"** — Remove all automated live-test scaffolding (7-day paper-trade gates, 30-day live-test runs, historical cascade replay, auto-promote logic). User will run live tests themselves, manually, after the code is complete.
2. **"csinald meg ami meg hianyzik a kodbol!"** — Build out what's still missing: the actual production bot runtime in `apps/bot/`, strategy orchestration, order management, position management, state persistence, telemetry.
3. **"ugy csinald meg a rendszert hogy egy config alapjan induljon a bot ahol minden strategiat be tudok allitani, es ha ki lehessen kapcsolni strategiakat egyesevel is"** — One config file drives the bot. Per-strategy enable/disable flags. Per-strategy settings (cap, leverage, symbols, timeframes, etc.) configurable.
4. **"cli app-t se felejtsd el"** — CLI app with subcommands: `start`, `status`, `config validate|show`, `strategies`, `trades` (history), and any others needed for ops.

## Phase 33 — PRODUCTION BOT + CONFIG + CLI (SCOPED, not yet started)

### Cleanup — REMOVE (live-test scaffolding, user does live tests manually)

| File | Why remove |
|---|---|
| `packages/backtest-tools/src/cli/run-paper-trade-gate.ts` | 7-day paper-trade gate automation — user runs live tests manually |
| `packages/backtest-tools/src/cli/run-cascade-replay-2025-10-10.ts` | Historical event replay (synthetic) — test scaffolding, not runtime |
| `liveOrdersEnabled` / `paperTradeDayCount` / `incrementPaperTradeDay` / `gateOpened` API in `dydx-cex-carry.ts` | Auto-promote 7-day gate logic — user does the gate manually |
| The `gateResult.gateOpened` branch in `dydx-cex-carry.paper-trade.ts` (line ~363) | Auto-promote side effect — same reason |
| Pre-live checklist items #1, #2, #3, #4 (board.md Phase 32 closure) | Replaced by user manual workflow + new config system |

**KEEP (runtime, not test scaffolding):**
- `dydx-cex-carry.paper-trade.ts` core funding tracker (`accrueFunding`, `recordFundingTick`, `recordChainHeartbeat`, `recordBybitEuLiquidity`, `runForDays`) — these power the dYdX-CEX carry strategy in paper mode
- `packages/paper/src/paper-trader.ts` — generic paper-trade simulator, runtime
- All 4 kill-switches in `dydx-cex-carry.ts` — runtime risk management, not test scaffolding
- All 3 pre-conditions in `dydx-cex-carry.ts` — runtime pre-condition verdicts, not test scaffolding
- `LatencyGate` integration in `dydx-cex-carry.ts` (Phase 30) — runtime latency-aware funding
- All strategies (`donchian-pivot-composition`, `dydx-cex-carry`, `cascade-fade`, etc.) — production strategies

### Build — NEW (Phase 33 deliverables)

**1. Config system (`apps/bot/src/config/`)**
- Single config file: `config/default.toml` (TOML, bun built-in parser)
- Zod-validated schema (`BotConfigSchema`) with per-section defaults
- **Per-strategy enable/disable** — `[strategies.donchian_pivot_composition] enabled = true|false` + per-strategy settings (cap, leverage, symbols, timeframes, consensus, etc.)
- **Section breakdown:**
  - `[bot]` — `mode` (paper|live), `log_level`, `state_file`
  - `[exchange]` — `id` (bybiteu), `rate_limit_ms`, `sandbox`
  - `[risk]` — `risk_per_trade`, `kelly_fraction`, `max_drawdown_pct`, `max_positions`, `max_leverage` (1:10 mandate)
  - `[symbols]` — `enabled` list (default BTC/USDC, ETH/USDC, SOL/USDC)
  - `[strategies.<name>]` — `enabled`, plus strategy-specific overrides
  - `[telemetry]` — `log_dir`, `metrics_interval_sec`
- Loader: `loadBotConfig(path?: string): BotConfig` with merge order (defaults → file → env)
- **Strategy registry** — `apps/bot/src/config/strategy-registry.ts` — given a BotConfig, returns the list of instantiated strategies (enabled ones, with their settings applied). Plugs into existing `createStrategy()` factory in `packages/core`.

**2. Bot runtime (`apps/bot/src/bot/`)**
- `bot.ts` — main `Bot` class: lifecycle (init → run → shutdown)
- `strategy-runner.ts` — per-strategy event loop, calls `onCandle(ctx)` on each LTF bar
- `order-manager.ts` — order placement (`placeOrder`), cancellation, status tracking via `ExchangeFeed`
- `position-manager.ts` — open positions state, leverage-invariant check (1:10 ceiling, 3-layer defense), `closePosition` 
- `state-store.ts` — JSON state persistence (`data/bot-state.json`) — survives restart
- `telemetry.ts` — structured JSON logger wiring + periodic metrics emit
- `kill-switches.ts` — central registry of kill-switches (max-DD, latency, etc.), re-uses `evaluateKillSwitches` from dydx-cex-carry strategy

**3. CLI app (`apps/bot/src/cli/`)**
- `mm-bot` binary (bun), command router
- Subcommands:
  - `mm-bot start [--config=path]` — start the bot (paper|live per config)
  - `mm-bot status` — show current state (positions, P&L, last error, uptime)
  - `mm-bot config validate [--config=path]` — Zod-validate, print errors, exit 0/1
  - `mm-bot config show [--config=path]` — print effective config (defaults + file + env merged)
  - `mm-bot config init [--config=path]` — write default config.toml to path
  - `mm-bot strategies` — list registered strategies + their on/off state
  - `mm-bot trades [--limit=N] [--symbol=...]` — show recent fills (read from state file or trade log)
  - `mm-bot kill-switches` — show kill-switch state + last trigger
- Argv parser: hand-rolled (no deps), supports `--flag=value` and `--flag value`

**4. Tests (mandatory, no shortcuts)**
- `apps/bot/src/config/config.test.ts` — Zod schema tests, per-section defaults, invalid input rejection
- `apps/bot/src/config/strategy-registry.test.ts` — enable/disable behavior, per-strategy config injection
- `apps/bot/src/bot/bot.test.ts` — lifecycle, signal → order flow, kill-switch trigger
- `apps/bot/src/bot/order-manager.test.ts` — place/cancel/fetch with mock feed
- `apps/bot/src/bot/position-manager.test.ts` — leverage invariant (1:10 ceiling), max-positions cap
- `apps/bot/src/bot/state-store.test.ts` — persistence round-trip
- `apps/bot/src/cli/cli.test.ts` — subcommand dispatch, arg parsing
- Wire-up probe: `mm-bot start --config=tests/fixtures/minimal.toml` (mock feed) produces deterministic state.json

**5. Docs (concise, English-only)**
- `apps/bot/README.md` — quick start, config schema reference, CLI reference
- `apps/bot/config/default.toml` (self-documenting with comments)
- `docs/production-strategies/bot.md` — how the production strategies wire into the bot

### Out of scope (user does manually, not code)

- **Live exchange test runs** — user does this themselves (manually runs `mm-bot start --config=prod.toml` in paper mode, observes, then flips to live)
- **Real-money deploy** — user signs off on envelope, deploys manually
- **Per-symbol 1:10 leverage invariant runtime check** — code includes the check (3-layer defense in `position-manager.ts`), but user verifies the invariant holds during live testing
- **LatencyGate live feed on bybit.eu + dYdX v4** — LatencyGate infra is wired in code; user validates during live testing

### New pre-launch checklist (post-Phase 33)

1. ⏳ Unit + integration tests green (`bun test`)
2. ⏳ Typecheck + Lint clean (`bun run typecheck && bun run lint`)
3. ⏳ Wire-up probe: `mm-bot start --config=tests/fixtures/minimal.toml` produces expected state
4. ⏳ User reviews `apps/bot/README.md` + `config/default.toml`
5. ⏳ User sign-off on production envelope (+41.99%/mo @ ≤7.70% DD)
6. ⏳ User runs `mm-bot start --config=prod.toml` (paper mode) and observes
7. ⏳ User decides when to flip `mode = "live"` in config

## Active cron

None active. `phase32-pr64-monitor` deleted (PR #64 merged). `pr-65-monitor` deleted (PR #65 merged). Will add `phase33-monitor` once team plan launches.

## Open user decisions needed

None. Phase 33 scope is locked. The 4 mandates are unambiguous and self-contained.

## Phase retrospective (Phase 25 #1 → Phase 33)

| Phase | Output | Commit |
|-------|--------|--------|
| 25 #1 | Perp-DEX funding microstructure research fleet (5 tracks) | `76998ec` |
| 25 #2 | Perp-DEX implementation (T1+T3+T4 → PR #58, T2 superseded by Phase 30) | `3b6c65f` |
| 26 | Strategy portfolio audit (PRODUCTION/SUB-COMP/RESEARCH-KEEP/HALT tiers) | (historical) |
| 27 | V2 promotion brief + OOS validation FAILED (V2 NOT promoted) | `9f019ff` |
| 28 | V2 OOS validation FAILED + 7-day paper-trade gate CLI | `5137207` |
| 29 | Cross-correlation DP vs V2 (V2 stays unpromoted) | `710392b` |
| 30 | LatencyGate live wiring + per-symbol DP multi-symbol CLI | `344cecf` |
| 31 | Fresh-start production audit (cleanup + M3 + backtest) | `bb656a1` |
| 32 | Deprecated-strategies cleanup (27 files removed, archive created) | `98c8f7e` |
| 32.5 | docs(production-strategies): interactive HTML report (10 strategies) | `f201674` |
| **33** | **PRODUCTION BOT + CONFIG + CLI (SCOPED, in-flight)** | TBD |

**Codebase at Phase 32 closure: 8 production + 2 infrastructure strategy files, 11 production backtest CLIs, 13 production HTML reports, 0 strategy dead code.**
