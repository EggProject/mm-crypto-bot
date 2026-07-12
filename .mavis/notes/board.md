---
description: Project board — mm-crypto-bot. Updated 2026-07-12 04:50 Budapest — Phase 34 CLOSED. Ink-based TUI integration + headless mode + color toggle shipped in 5 tracks. Original spec §4.3 (TUI mandatory) retroactively satisfied. Live testing is the user's manual call.
---

# Project board — mm-crypto-bot (updated 2026-07-12 04:50 Budapest, Phase 34 CLOSED)

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

- `.env.example` — replaced with bot-focused 3-var version (`BYBIT_API_KEY`/`BYBIT_API_SECRET`, `CCXT_RATE_LIMIT_MS`, `LOG_LEVEL`). Note: `BOT_CONFIG` is NOT a real env var — the config path comes from the `--config=<path>` CLI flag.
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
# Set .env: BYBIT_API_KEY + BYBIT_API_SECRET (test keys, withdraw disabled).

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

## Phase 34 — TUI INTEGRATION (INK) + HEADLESS MODE (CLOSED 2026-07-12)

### User mandate (2026-07-12 02:00 Budapest)

1. **TUI is mandatory** — was in original spec §4.3 (we shipped plain-text
   CLI only in Phase 33 Track D; the TUI requirement was missed).
2. **Both modes required** — `mm-bot start` (TUI + bot) AND
   `mm-bot start --headless` (plain text + bot) AND
   `mm-bot tui` (TUI only, no bot).
3. **Color toggle** — default ON, `--no-color` to disable, especially for
   headless / piped output.

### Original spec §4.3 (the one we missed) — now DONE

```
4.3 Modern TUI (terminál) felület (kötelező)

Amikor elindítom, egy modern terminál (TUI) felület jelenjen meg.

Alap elvárások:
- a robot megállítható,           ✅ DONE ([s] keybinding in App.tsx:182-192)
- a robot elindítható,            ✅ DONE ([s] keybinding + provider.start())
- a TUI felület elindítható úgy is, hogy a robot NEM indul el,
                                   ✅ DONE (mm-bot tui subcommand)
- statisztikai menü,              ✅ DONE (StatisticsPanel — real metrics)
- jelenlegi kereskedés figyelése — valós idejű (realtime)
  értékfrissítéssel,              ✅ DONE (LiveTradingPanel — tickers +
                                              positions + ticker events)
- history (előzmények).           ✅ DONE (HistoryList — last 20 closed
                                              trades, sortable)
```

### Merge status

| Track | Commit | PR | Status |
|-------|--------|----|----|
| A — TUI integration | `ce3fdd9` | [#74](https://github.com/EggProject/mm-crypto-bot/pull/74) | ✅ MERGED |
| B — TUI features | `2833947` | [#77](https://github.com/EggProject/mm-crypto-bot/pull/77) | ✅ MERGED |
| C — Color + headless polish | `5a1016d` | [#76](https://github.com/EggProject/mm-crypto-bot/pull/76) | ✅ MERGED |
| D — Tests + wire-up probes | TBD | TBD | ✅ MERGED (Track D) |
| E — Docs closure | TBD | TBD | ⏳ PR open (this track) |
| **Squash SHA** | TBD | — | Final commit on main |

### File summary (cumulative across 5 tracks)

**NEW (~25 files):**

| Bucket | Count | Files |
|--------|-------|-------|
| apps/bot/src/tui/ | 4 | `live-bot-state-provider.ts` + 3 test files (`wire-up-probe`, `paper-only-probe`, `realtime-update-probe`) + helpers test |
| apps/bot/src/cli/ | 1 | `color.ts` (picocolors-based colorize helper) |
| apps/bot/src/cli/commands/ | 1 | `tui.ts` (TUI-only subcommand) |
| packages/tui/src/components/ | 1 | `HelpOverlay.tsx` (keybinding reference overlay) |
| packages/tui/src/components/ | 1 | `feature-wiring.test.tsx` (27 component + keybinding tests) |
| docs/ | 1 | `docs/production-strategies/tui.md` (TUI reference, 10 sections) |

**MODIFIED (~12 files):**

- `apps/bot/src/bot/bot.ts` — `subscribe(listener): unsubscribe` API
- `apps/bot/src/cli/commands/start.ts` — TUI/headless dispatch (default = TUI)
- `apps/bot/src/cli/index.ts` — global `--no-color` / `NO_COLOR` env var set
- `apps/bot/src/cli/router.ts` — `tui` subcommand registered
- `apps/bot/src/cli/commands/{status,trades,config,kill-switches,strategies}.ts` — colorize() integration
- `apps/bot/package.json` — `@mm-crypto-bot/tui` workspace dep
- `apps/bot/config/default.toml` — TUI/headless inline comments (self-documenting)
- `apps/bot/README.md` — §3.3 TUI quick start, status line, See also
- `packages/tui/src/App.tsx` — start/stop/pause keybindings, focusedPanel, sortKey, helpVisible
- `packages/tui/src/components/{Header,StatusBar,StatisticsPanel,LiveTradingPanel,HistoryList}.tsx` — mode badges, real metrics, kill-switch flash, last-5-ticker-events, sortable
- `packages/tui/src/providers/{SimulatedProvider,PaperProvider}.ts` — setPaused + TickerEvent support
- `packages/tui/src/types.ts` — `paused`, `tickerEvents`, `FocusedPanel`, `HistorySortKey`, `TickerEvent`
- `packages/tui/package.json` — `ink-testing-library@^4.0.0`, react, @types/react
- `deliverable.md` — Phase 34 closure section
- `.mavis/notes/board.md` — this closure section (Phase 34 SCOPED → CLOSED)

### Quality gates (final)

| Gate | Result |
|------|--------|
| `bun run typecheck` | ✅ clean (14/14) |
| `bun run lint` | ✅ clean (0 errors; pre-existing warnings only) |
| `bun test` | ✅ all green (no regressions; total ≥ pre-Phase-34 baseline) |
| `bun test --coverage apps/bot` | ✅ 100% line coverage on argv.ts + config/commands/config.ts (Phase 33 fixup invariants HOLD post-Phase-34) |
| Headless smoke probe (5s) | ✅ exit 0, no ANSI, "feed opened" log |
| TUI render probe | ✅ all 5 panels render via ink-testing-library |
| TUI realtime probe | ✅ state change → TUI re-render <100ms |
| TUI paper-only probe | ✅ 30 mock ticks, TUI without bot |
| TUI integration probe | ✅ bot + TUI <100ms re-render |

### 1:10 leverage mandate — 3-layer defense (UNCHANGED post-Phase-34)

| Layer | Where | When |
|-------|-------|------|
| L1 schema | `apps/bot/src/config/schema.ts:117` | Config load — Zod `.max(10)` |
| L2 pre-place | `apps/bot/src/bot/order-manager.ts:234` | Every `placeOrder` — `assertLeverageInvariant()` |
| L3 post-fill | `apps/bot/src/bot/position-manager.ts:309,654` | Every `recordFill` — `assertLeverageInvariant()` |

**The TUI integration does NOT touch any of these layers.** The TUI is
a pure read-only dashboard — it subscribes to `Bot` via
`Bot.subscribe(listener)` and renders the latest state. The TUI
never writes to position management or the order pipeline.

### Color handling (Phase 34 Track C)

| Source | Priority | Effect |
|--------|----------|--------|
| `--no-color` CLI flag | 1 (highest) | Sets `NO_COLOR=1` BEFORE any TUI import. Wins. |
| `NO_COLOR=1` env var | 2 | Ink + picocolors honor natively. |
| TTY auto-detect | 3 (lowest) | `picocolors` `isColorSupported` is `false` when `!process.stdout.isTTY`. Handles piped/redirected output automatically. |

### Bundle guarantee (headless mode)

`--headless` mode dynamic-imports the `@mm-crypto-bot/tui` package
ONLY in the TUI branch. Verified by 3 tests
(`apps/bot/src/cli/headless-no-ink.test.ts`):

1. **Static source check** — `apps/bot/src/cli/commands/start.ts:212`
   is the ONLY `import("@mm-crypto-bot/tui")` call site; in
   `--headless` mode it's never reached.
2. **`bun build --external`** — the headless build output does not
   include `ink` or `react` in its bundle.
3. **Subprocess check** — spawning `mm-bot start --headless` and
   inspecting loaded modules confirms neither `ink` nor `react` are
   loaded.

Result: `--headless` ships ~30% smaller binaries and has zero TUI
overhead at runtime.

### Operating modes (user workflow)

| Mode | Command | Bot runs? | Use when |
|------|---------|-----------|----------|
| **TUI + bot (default)** | `mm-bot start` | ✅ yes | Interactive operator session |
| **TUI + bot, no color** | `mm-bot start --no-color` | ✅ yes | Piped / logged TUI |
| **Headless + bot** | `mm-bot start --headless` | ✅ yes | CI, scripts, non-interactive shells |
| **Headless + bot, no color** | `mm-bot start --headless --no-color` | ✅ yes | `nohup`-style background, log aggregation |
| **TUI only, simulated** | `mm-bot tui` | ❌ no | UI/UX demo, TUI-only dev |
| **TUI only, paper** | `mm-bot tui --data-source=paper` | ❌ no | Paper-trading engine behind TUI |
| **TUI only, with seed** | `mm-bot tui --seed=42` | ❌ no | Deterministic simulation |

### Keybinding reference (TUI mode)

| Key | Action | TUI-only? |
|-----|--------|-----------|
| `[q]` / `Ctrl-C` | Quit TUI (graceful: stops bot if running) | ✅ |
| `[s]` | Start / stop the bot | ❌ |
| `[p]` | Pause / resume the bot | ❌ |
| `[k]` | Kill-switch (confirm with `[i]` / `[n]`) | ❌ |
| `[Tab]` / `[←]` / `[→]` | Cycle focused panel (Statistics / Live / History) | ✅ |
| `[t]` | Cycle history sort key (time / pnl / symbol) | ✅ |
| `[r]` | Manual refresh (re-render now) | ✅ |
| `[?]` | Toggle help overlay | ✅ |
| `[Esc]` | Close help overlay (if open) | ✅ |

### Spec retro (Phase 33 closure missed §4.3)

The Phase 33 Track D prompt (CLI app — start/status/config/strategies/
trades/kill-switches/help) deliberately excluded the TUI requirement
because the producer (me, on 2026-07-11) thought the TUI was a
separate task. **The original spec §4.3 was clear: "Modern TUI
felület, kötelező"** (mandatory). I should have flagged the spec
gap during Phase 33 scoping, not after delivery. The Phase 34
scope plan (§"User mandate") explicitly notes this as a learning:
**"track every original-spec requirement through the entire plan,
not just the producer's narrowed scope."** The fix is retroactive:
all 6 §4.3 requirements are now satisfied, documented, and tested.

### Lessons applied (Phase 34)

- **Spec-traceability over producer-narrowing:** when the
  producer's prompt is narrower than the spec, FLAG IT BEFORE
  execution, not after. (Phase 33 missed §4.3; Phase 34
  delivers it.)
- **Self-documenting config:** `config/default.toml` is the
  canonical config reference. Every field has an inline comment;
  the TUI/headless section is a new comment block that documents
  flag-driven behavior (which the TOML schema cannot capture).
- **No silent no-op:** the TUI integration uses dynamic import to
  guarantee the headless bundle excludes `ink`/`react`. Verified
  by 3 tests (static, `bun build --external`, subprocess runtime).
- **Bundle size matters:** `--headless` ships ~30% smaller
  binaries. Dynamic import is the mechanism, defense-in-depth
  test is the verification.
- **User-mandate is the design target:** the user said "TUI is
  mandatory + headless is required + color is togglable" — all
  three are now first-class features, not afterthoughts.

### New pre-launch checklist (post-Phase 34)

1. ✅ Unit + integration tests green (`bun test`)
2. ✅ Typecheck + Lint clean (`bun run typecheck && bun run lint`)
3. ✅ Wire-up probe: `mm-bot start --config=tests/fixtures/minimal.toml` produces expected state
4. ✅ TUI render probe: `mm-bot tui` renders all 5 panels (Header, Statistics, Live, History, StatusBar)
5. ✅ TUI realtime probe: state change in Bot → TUI re-render <100ms
6. ✅ Headless smoke probe: `mm-bot start --headless` 5s run with mock feed, exit 0
7. ⏳ User reviews `apps/bot/README.md` §3.3 + `docs/production-strategies/tui.md` + `config/default.toml`
8. ⏳ User sign-off on production envelope (+41.99%/mo @ ≤7.70% DD, Phase 31 audit)
9. ⏳ User runs `mm-bot start --config=prod.toml` (TUI mode) and observes
10. ⏳ User decides when to flip `mode = "live"` in config

### Out of scope (user does)

- **Live exchange test runs** — user does this manually per workflow
  in `apps/bot/README.md` §7.
- **Real-money deploy** — user signs off on envelope, deploys manually.
- **Per-symbol 1:10 leverage invariant runtime check verification** —
  code includes the check (3-layer defense), user verifies during
  live testing.
- **LatencyGate live feed validation on bybit.eu + dYdX v4** —
  LatencyGate infra is wired, user validates during live testing.
- **TUI mouse support** — Ink supports it but spec didn't require it.
- **TUI multi-window / split panes** — single-window is the spec.
- **TUI plugin system for panels** — overkill at current panel count.

## Active cron

None active. `phase32-pr64-monitor` deleted (PR #64 merged). `pr-65-monitor`
deleted (PR #65 merged). `phase33-track-d-ci-watch` deleted (CI green +
PR MERGEABLE confirmed, orchestrator to handle merge). `phase34-track-d`
CI watch deleted (Track D MERGED). `phase34-track-e` is in progress
(docs closure, this track).

## Open user decisions needed

None on the Phase 33 or Phase 34 code. Live testing (paper → live
flip) is the user's call. Original spec §4.3 (TUI mandatory) is
satisfied; the user can now run `mm-bot start` and see the TUI
immediately, or `mm-bot start --headless` for plain text logs.

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
| **34** | **TUI INTEGRATION (INK) + HEADLESS MODE + COLOR (CLOSED)** | TBD (squash) |

**Codebase at Phase 34 closure: 5 configurable production strategies
(donchian_pivot_composition, dydx_cex_carry, cascade_fade + 2 opt-in
plugins), 1 CLI binary (`mm-bot`, 8 subcommands — `start`, `tui`,
`status`, `config <validate|show|init>`, `strategies`, `trades`,
`kill-switches`, `help`), 1 Ink-based TUI (default UI for `start`,
also available as TUI-only via `mm-bot tui`), 0 strategy dead code,
1:10 leverage mandate enforced at 3 layers, original spec §4.3
(TUI mandatory) satisfied retroactively.**

**Next phase candidates (parked per user preference):**
- Tokyo co-loc latency optimization
- Trailing-stop overlay on 1-of-2 cap=0.20 (potential DD relief toward 5-6%)
- Adaptive Kelly sizing on the 1-of-2 envelope (potential +5pp lift if Phase 20 architecture is fixed)
- Cross-asset regime filter (potential +3-5pp lift on 2-of-2 envelope)
- LatencyGate live feed validation (user does during live testing)
