# Phase 33 — Production Bot + Config + CLI

**Status:** SCOPED (2026-07-11 23:42 Budapest). Not yet started.
**Branch:** TBD (will be `feat/phase33-production-bot` or sub-branches per track).
**Estimated complexity:** ~3000-5000 LOC across config + bot + CLI + tests + docs.

## User mandate (verbatim, 2026-07-11 23:42 Budapest)

1. **"minden live test dolgot torolj, azt majd en vegzem!"** — Remove automated live-test scaffolding. User runs live tests manually.
2. **"csinald meg ami meg hianyzik a kodbol!"** — Complete the missing code (bot runtime).
3. **"ugy csinald meg a rendszert hogy egy config alapjan induljon a bot ahol minden strategiat be tudok allitani, es ha ki lehessen kapcsolni strategiakat egyesevel is"** — Config-driven, per-strategy enable/disable.
4. **"cli app-t se felejtsd el"** — CLI app with subcommands.

## Architecture decision

**Config format:** TOML (bun built-in TOML parser, no new dep). Single file at `apps/bot/config/default.toml`, override path via `--config=path` flag. Zod-validated schema at load time.

**Bot runtime:** Event-driven, single process, lifecycle:
```
init (load config, validate, init state) → run (subscribe feeds, dispatch to strategies, place orders) → shutdown (close positions, persist state, close feed)
```

**Strategy wiring:** Existing `packages/core/src/strategy/*` are unchanged. New `apps/bot/src/config/strategy-registry.ts` wraps them in a per-instance config. Bot's `strategy-runner.ts` calls `strategy.onCandle(ctx)` for each LTF bar.

**Order management:** Direct calls to `ExchangeFeed.placeOrder()` (existing). New `OrderManager` class handles in-flight order state + cancellation. No order queue (the project's strategies emit discrete signals, not continuous streams).

**Position management:** New `PositionManager` class tracks open positions per (strategy, symbol) tuple. 1:10 leverage invariant enforced on every size decision (3-layer defense: config validate, pre-place assertion, post-place check).

**State persistence:** JSON file at `data/bot-state.json`. Snapshot on every position change + every 60s. On startup, load if exists, validate, resume.

**Telemetry:** Structured JSON logger (existing `packages/shared/logger`). Per-event log: signal emitted, order placed, order filled, position opened, position closed, kill-switch triggered, error.

**Kill-switches:** Central registry in `apps/bot/src/bot/kill-switches.ts`. Wraps existing per-strategy kill-switches (dYdX-CEX 4 kill-switches, etc.) + global ones (max-DD, max-positions). Bot checks all kill-switches before every order placement.

**CLI:** Hand-rolled argv parser in `apps/bot/src/cli/argv.ts`. Subcommand router in `apps/bot/src/cli/router.ts`. Each subcommand is a function `(args, ctx) => Promise<number>` returning exit code.

## Track breakdown (suggested for team plan)

### Track A: Cleanup (foundation, do first)
- Delete `packages/backtest-tools/src/cli/run-paper-trade-gate.ts`
- Delete `packages/backtest-tools/src/cli/run-cascade-replay-2025-10-10.ts`
- Refactor `dydx-cex-carry.ts` — remove `liveOrdersEnabled`, `paperTradeDayCount`, `incrementPaperTradeDay`, `gateOpened` fields/methods
- Refactor `dydx-cex-carry.paper-trade.ts` — remove `gateResult.gateOpened` branch
- Update `dydx-cex-carry.test.ts` to match
- Update `packages/core/src/index.ts` to remove `liveOrdersEnabled` from `DydxCexCarryState` type
- Run `bun test` → all green
- Run `bun run typecheck && bun run lint` → clean

**Out:** funding-tracker core (`accrueFunding`, `recordFundingTick`, `recordChainHeartbeat`, `recordBybitEuLiquidity`, `runForDays`) — KEEP.

**Estimated LOC:** -300 (deletions) + 50 (refactor) = net -250
**Owner:** cleanup producer
**Verifier:** typecheck + test + lint, all green

### Track B: Config system
- New: `apps/bot/src/config/schema.ts` — Zod schema
- New: `apps/bot/src/config/loader.ts` — `loadBotConfig(path?)` with merge logic
- New: `apps/bot/src/config/strategy-registry.ts` — per-config strategy instantiation
- New: `apps/bot/src/config/defaults.ts` — default values
- New: `apps/bot/config/default.toml` — self-documenting default config
- New: `apps/bot/src/config/*.test.ts` — full coverage
- Update: `apps/bot/package.json` — add `config` and `zod` deps (zod is in shared already)

**Out:** runtime code (Track C handles).

**Estimated LOC:** ~500
**Owner:** config producer
**Verifier:** schema tests, config roundtrip tests, strategy enable/disable behavior

### Track C: Bot runtime
- New: `apps/bot/src/bot/bot.ts` — main `Bot` class
- New: `apps/bot/src/bot/strategy-runner.ts` — per-strategy event loop
- New: `apps/bot/src/bot/order-manager.ts` — order placement + tracking
- New: `apps/bot/src/bot/position-manager.ts` — positions + leverage invariant
- New: `apps/bot/src/bot/state-store.ts` — JSON persistence
- New: `apps/bot/src/bot/telemetry.ts` — logger wiring + metrics
- New: `apps/bot/src/bot/kill-switches.ts` — central registry
- New: `apps/bot/src/bot/*.test.ts` — full coverage including wire-up probe
- Update: `apps/bot/src/index.ts` — keep CLI dispatch (or delegate to `cli/index.ts`)

**Depends on:** Track A (cleanup complete) + Track B (config schema final).
**Estimated LOC:** ~1500
**Owner:** bot-runtime producer
**Verifier:** lifecycle test, signal → order flow test, leverage invariant test, state persistence test

### Track D: CLI app
- New: `apps/bot/src/cli/argv.ts` — argv parser
- New: `apps/bot/src/cli/router.ts` — subcommand router
- New: `apps/bot/src/cli/commands/start.ts` — start the bot
- New: `apps/bot/src/cli/commands/status.ts` — show state
- New: `apps/bot/src/cli/commands/config.ts` — validate, show, init
- New: `apps/bot/src/cli/commands/strategies.ts` — list + state
- New: `apps/bot/src/cli/commands/trades.ts` — show history
- New: `apps/bot/src/cli/commands/kill-switches.ts` — show kill-switch state
- New: `apps/bot/src/cli/*.test.ts` — dispatch + arg parse tests
- Update: `apps/bot/package.json` — `bin.mm-bot` already set
- Update: `apps/bot/src/index.ts` — replace placeholder with `cli/router.ts` dispatch

**Depends on:** Track B (config loader) + Track C (Bot class).
**Estimated LOC:** ~800
**Owner:** cli producer
**Verifier:** subcommand dispatch tests, end-to-end test (`mm-bot config validate` on a fixture config returns 0)

### Track E: Docs + final wiring
- New: `apps/bot/README.md` — quick start, config reference, CLI reference
- Update: `.env.example` — remove obsolete env vars, document new ones
- Update: `deliverable.md` — link to new README, list new CLIs
- Update: `docs/production-strategies/bot.md` — how production strategies wire into the bot
- Update: `.mavis/notes/board.md` — Phase 33 closure
- Final: `bun test && bun run typecheck && bun run lint` → all green, single PR

**Depends on:** Tracks A-D all merged.
**Estimated LOC:** ~300 (mostly markdown)
**Owner:** docs producer
**Verifier:** docs completeness check, final CI green

## Wire-up integrity (Phase 21 #1 lesson — applied to all tracks)

For any new feature that could be a "silent no-op" (config flag, CLI subcommand, strategy enable/disable), verify via:
- **Bit-identical behavior** when the feature is enabled vs disabled on identical inputs (where applicable)
- **Concrete output change** when the feature IS the system (e.g., `mm-bot strategies` should change output when a strategy is enabled/disabled in config)

## 1:10 leverage mandate (project-wide)

- Every `placeOrder` call MUST have `assertLeverageInvariant(notional, capital)` pre-call
- Config `risk.max_leverage` MUST be ≤ 10 (Zod schema enforces)
- Test: placing an order with `notional / capital > 10` throws `LeverageBreachError`

## Open questions (orchestrator-decide, no user re-ask)

1. **Strategy on/off semantic:** When a strategy is disabled in config, does it:
   (a) Stop emitting signals entirely (engine ignores the strategy instance)
   (b) Emit signals but bot ignores them
   → (a) — cleaner, less state.

2. **State persistence format:** JSON vs SQLite?
   → JSON for now. SQLite is overkill at 12 max positions.

3. **Config file location default:** `apps/bot/config/default.toml` or `~/.mm-crypto-bot/config.toml`?
   → `apps/bot/config/default.toml` (per-project, follows repo convention).

4. **CLI exit codes:** 0 = success, 1 = error, 2 = config validation fail. Standard.

5. **Wire-up probe:** `mm-bot start --config=tests/fixtures/minimal.toml` with mock feed. Run for 60s. Verify state file produced.

## Success criteria

- [ ] `bun test` → all green (including new apps/bot tests, total ~2000 tests)
- [ ] `bun run typecheck && bun run lint` → clean
- [ ] `mm-bot config validate --config=default.toml` → exit 0
- [ ] `mm-bot strategies` → lists all 8 production + 2 infra strategies
- [ ] `mm-bot start --config=tests/fixtures/minimal.toml` (mock feed) → runs, produces `data/bot-state.json`, exits cleanly on SIGINT
- [ ] All 4 live-test files removed (`run-paper-trade-gate`, `run-cascade-replay-2025-10-10`, `run-multi-class-baseline-v2` was already removed in Phase 32)
- [ ] `dydx-cex-carry` strategy no longer has `liveOrdersEnabled` / `paperTradeDayCount` / `gateOpened` logic
- [ ] `apps/bot/README.md` + `config/default.toml` are self-documenting
- [ ] No `liveOrdersEnabled` references in the codebase (grep clean)

## Out of scope (user does)

- Live exchange test runs
- Real-money deploy
- Per-symbol 1:10 leverage invariant runtime check verification
- LatencyGate live feed validation
- Production envelope re-validation (Phase 31 audit still holds: +41.99%/mo @ ≤7.70% DD)
