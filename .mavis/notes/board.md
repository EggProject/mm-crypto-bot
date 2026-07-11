---
description: Project board — mm-crypto-bot. Updated 2026-07-12 01:15 Budapest — Phase 33 CLOSED. Production bot + config + CLI shipped in 5 tracks. Live testing is the user's manual call.
---

# Project board — mm-crypto-bot (updated 2026-07-12 01:15 Budapest, Phase 33 CLOSED)

## User mandate (2026-07-11 23:42 Budapest) — PHASE 33 SCOPE

User explicit 4-point directive (Hungarian → English):

1. **"minden live test dolgot torolj, azt majd en vegzem!"** — Remove all automated live-test scaffolding (7-day paper-trade gates, 30-day live-test runs, historical cascade replay, auto-promote logic). User will run live tests themselves, manually, after the code is complete.
2. **"csinald meg ami meg hianyzik a kodbol!"** — Build out what's still missing: the actual production bot runtime in `apps/bot/`, strategy orchestration, order management, position management, state persistence, telemetry.
3. **"ugy csinald meg a rendszert hogy egy config alapjan induljon a bot ahol minden strategiat be tudok allitani, es ha ki lehessen kapcsolni strategiakat egyesevel is"** — One config file drives the bot. Per-strategy enable/disable flags. Per-strategy settings (cap, leverage, symbols, timeframes, etc.) configurable.
4. **"cli app-t se felejtsd el"** — CLI app with subcommands: `start`, `status`, `config validate|show`, `strategies`, `trades` (history), and any others needed for ops.

## Phase 33 — PRODUCTION BOT + CONFIG + CLI (CLOSED 2026-07-12)

### Merge status

| Track | Commit | PR | Status |
|-------|--------|----|----|
| A — Cleanup | `24e0870` | [#66](https://github.com/EggProject/mm-crypto-bot/pull/66) | ✅ MERGED |
| B — Config system | `ba4325a` | [#67](https://github.com/EggProject/mm-crypto-bot/pull/67) | ✅ MERGED |
| C — Bot runtime | `aac8002` | [#68](https://github.com/EggProject/mm-crypto-bot/pull/68) | ✅ MERGED |
| D — CLI app | TBD | [#69](https://github.com/EggProject/mm-crypto-bot/pull/69) | ⏳ squash-merge pending |
| E — Docs closure | TBD | TBD | ⏳ PR open |
| **Squash SHA** | TBD | — | Final commit on main |

### File summary (cumulative across 5 tracks)

**NEW (29 files):**

| Bucket | Count | Files |
|--------|-------|-------|
| Config system | 7 | schema, loader, defaults, strategy-registry, default.toml, 2 test files |
| Bot runtime | 14 | bot, strategy-runner, order-manager, position-manager, state-store, telemetry, kill-switches + 6 tests + wire-up-probe |
| CLI app | 10 | argv, router, 6 commands (start/status/config/strategies/trades/kill-switches/help), e2e test, index dispatch |
| Docs (Track E) | 2 | `apps/bot/README.md`, `docs/production-strategies/bot.md` |

**DELETED (2 files, Track A):**

- `packages/backtest-tools/src/cli/run-paper-trade-gate.ts` (266 LOC) — 7-day paper-trade gate automation
- `packages/backtest-tools/src/cli/run-cascade-replay-2025-10-10.ts` (416 LOC) — historical event replay

**REFACTORED (4 files, Track A):**

- `packages/core/src/strategy/dydx-cex-carry.ts` — removed `liveOrdersEnabled`, `paperTradeDayCount`, `incrementPaperTradeDay`, `gateOpened`
- `packages/core/src/strategy/dydx-cex-carry.paper-trade.ts` — removed `gateResult.gateOpened` branch
- `packages/core/src/index.ts` — removed `liveOrdersEnabled` from `DydxCexCarryState` type
- `packages/core/src/strategy/dydx-cex-carry.test.ts` — updated to match

**UPDATED (Track E):**

- `.env.example` — replaced with bot-focused 4-var version (`BOT_CONFIG`, `BYBIT_EU_API_KEY`/`BYBIT_EU_SECRET`, `CCXT_RATE_LIMIT_MS`, `LOG_LEVEL`)
- `deliverable.md` — Phase 33 closure section appended
- `.mavis/notes/board.md` — this closure section (SCOPED → CLOSED)
- `apps/bot/README.md` — already existed (Track D stub); Track E rewrites to 9 sections

### Quality gates (final)

| Gate | Result |
|------|--------|
| `bun run typecheck` | ✅ clean (13/13, 0 errors) |
| `bun run lint` | ✅ clean (8/8, 0 errors) |
| `bun test` | ✅ all green (no regressions; total ≥ pre-Phase-33 baseline) |
| Wire-up probe (60s mock feed run) | ✅ state file produced deterministically |

### 1:10 leverage mandate — 3-layer defense (verified)

| Layer | Where | When |
|-------|-------|------|
| L1 schema | `apps/bot/src/config/schema.ts:117` | Config load — Zod `.max(10)` |
| L2 pre-place | `apps/bot/src/bot/order-manager.ts:234` | Every `placeOrder` — `assertLeverageInvariant()` |
| L3 post-fill | `apps/bot/src/bot/position-manager.ts:309,654` | Every `recordFill` — `assertLeverageInvariant()` |

### User manual workflow (live testing)

Per user mandate (2026-07-11): **user does live tests manually** — no automated
harness, no auto-promote gates, no shadow live-runs. The full workflow is in
`apps/bot/README.md` §7. Summary:

```bash
# 1) Scaffold a production config
cp config/default.toml config/prod.toml
# Edit config/prod.toml. Set [bot] mode = "paper".
# Set .env: BYBIT_EU_API_KEY + BYBIT_EU_SECRET (test keys, withdraw disabled).

# 2) Paper-test for N days (suggest: ≥ 7 days for funding-cycle + vol-spike coverage)
mm-bot start --config=config/prod.toml
# In another shell, observe:
mm-bot status
mm-bot strategies
mm-bot trades --limit=20
mm-bot kill-switches

# 3) When satisfied, flip to live
# In config/prod.toml: [bot] mode = "live"
# In .env: real API keys (withdraw disabled, IP whitelisted).

# 4) Real-money run
mm-bot start --config=config/prod.toml
```

### New pre-launch checklist (post-Phase 33)

1. ✅ Unit + integration tests green (`bun test`)
2. ✅ Typecheck + Lint clean (`bun run typecheck && bun run lint`)
3. ✅ Wire-up probe: `mm-bot start --config=tests/fixtures/minimal.toml` produces expected state
4. ⏳ User reviews `apps/bot/README.md` + `config/default.toml`
5. ⏳ User sign-off on production envelope (+41.99%/mo @ ≤7.70% DD, Phase 31 audit)
6. ⏳ User runs `mm-bot start --config=prod.toml` (paper mode) and observes
7. ⏳ User decides when to flip `mode = "live"` in config

### Out of scope (user does)

- **Live exchange test runs** — user does this manually per workflow above.
- **Real-money deploy** — user signs off on envelope, deploys manually.
- **Per-symbol 1:10 leverage invariant runtime check verification** — code
  includes the check (3-layer defense), user verifies during live testing.
- **LatencyGate live feed validation on bybit.eu + dYdX v4** — LatencyGate
  infra is wired, user validates during live testing.

### Lessons applied (Phase 33)

- **Phase 21 #1 (wire-up integrity):** per-strategy `enabled = false` is
  enforced at strategy-registry instantiation (no silent no-op). The
  `mm-bot strategies` subcommand proves the wire-up by printing the
  on/off state.
- **Phase 14B mandate (1:10 leverage):** 3-layer defense (schema + pre-place
  + post-fill) — one layer always leaks, three is the project standard.
- **Self-documenting config:** `config/default.toml` is the canonical
  schema reference. Every field has an inline comment.
- **User mandate (2026-07-11):** no auto-promote, no shadow live-runs,
  no paper-trade gate automation. User runs live tests manually.

## Active cron

None active. `phase32-pr64-monitor` deleted (PR #64 merged). `pr-65-monitor`
deleted (PR #65 merged). `phase33-track-d-ci-watch` deleted (CI green +
PR MERGEABLE confirmed, orchestrator to handle merge).

## Open user decisions needed

None on the Phase 33 code. Live testing (paper → live flip) is the user's call.

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
| **33** | **PRODUCTION BOT + CONFIG + CLI (CLOSED)** | TBD (squash) |

**Codebase at Phase 33 closure: 5 configurable production strategies
(donchian_pivot_composition, dydx_cex_carry, cascade_fade + 2 opt-in
plugins), 1 CLI binary (`mm-bot`, 7 subcommands), 0 strategy dead code,
1:10 leverage mandate enforced at 3 layers.**

**Next phase candidates (parked per user preference):**
- Tokyo co-loc latency optimization
- Trailing-stop overlay on 1-of-2 cap=0.20 (potential DD relief toward 5-6%)
- Adaptive Kelly sizing on the 1-of-2 envelope (potential +5pp lift if Phase 20 architecture is fixed)
- Cross-asset regime filter (potential +3-5pp lift on 2-of-2 envelope)
- LatencyGate live feed validation (user does during live testing)
