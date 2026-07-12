---
description: Phase 35 scope plan — 100% coverage on the ENTIRE codebase + single merged coverage report. Updated 2026-07-12 03:18 Budapest.
---

# Phase 35 — FULL-CODEBASE 100% COVERAGE + MERGED REPORT (scope plan)

## User mandate (2026-07-12 03:16 Budapest)

Two related directives, captured verbatim:

1. **"100% coverage testet mondtam, de a kodbazis nagy resze nincs is tesztelve!"** — The 100% coverage mandate applies to the ENTIRE codebase, not just new files. Most of the codebase is untested.
2. **"a testeket ugy futtassuk hogy egyben fusson az osszes es csak a legvegen legyen egy teljes coverage report! (nezzetek utana webseach -vel hogyan kell beallitani hogy merged report legyen!)"** — All tests must run as a SINGLE run, producing ONE merged coverage report at the end. Team must websearch how to configure this.

## State of coverage today (2026-07-12 03:18 Budapest, main HEAD ce3fdd9)

Per-package line coverage on main (from lcov.info parsing, bun test default):

| Package | src files | src LOC | line cov | branch cov | function cov | Notes |
|---------|-----------|---------|----------|------------|--------------|-------|
| packages/backtest | 8 | 1,395 | **100%** in-pkg | 0% (bun lcov) | 100% in-pkg | The 13158 LF in lcov includes upstream code pulled in by tests — actual in-package files all at 100% |
| packages/backtest-tools | 16 | 5,037 | 74.38% | 0% (bun lcov) | 76.64% | 8 untested CLI scripts + 5 data feeds at 60-90% |
| packages/core | 50 | 28,896 | **98.31%** | 0% (bun lcov) | 95.52% | 6-7 files at 95-99% line + 7 untested files |
| packages/exchange | 9 | 2,186 | 73.16% | 0% (bun lcov) | 85.05% | bybitEuFeed.ts at 35% + 1 untested adapter |
| packages/paper | 2 | 282 | **5.88%** | 0% (bun lcov) | 9.09% | paper-trader.ts at 5.4% — the main paper-trading engine |
| packages/shared | 9 | 774 | 35.26% | 0% (bun lcov) | 7.69% | config.ts, logger.ts, types.ts, utils.ts all at 8-82% |
| packages/tui | 11 | 1,141 | **NO lcov** | — | — | TUI never had coverage run; only scaffold.test.ts (1 smoke test) |
| apps/bot | 26 | 6,604 | 24.73% (mixed) | 0% (bun lcov) | 25.12% | bot.ts 100/100/90; 11 untested CLI command files; live-bot-state-provider.ts 89.87% (Track A miss) |

**Total monorepo: 131 source files / 46,336 LOC / ~70% weighted line coverage / NO branch coverage data (bun lcov doesn't emit branches) / 5+ packages below 50% line coverage.**

### Three structural problems blocking 100% enforcement

1. **No branch coverage data** — `bun test --coverage --coverage-reporter=lcov` writes `BRF:0 BRH:0` for all files. Bun's lcov reporter doesn't emit branch info. Can't enforce 100% branches.
2. **No merged report** — Each package writes its own `coverage/lcov.info`. Root script `turbo run coverage` runs them sequentially but does not concatenate. No aggregate.
3. **No global threshold check** — Only `packages/exchange/vitest.config.ts` has `thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 }`. No root-level check.

### Websearch verdict (2026-07-12 03:17 Budapest)

Two viable architectures for "merged coverage across the monorepo":

**Option A — `lcov-result-merger`** (npm: `lcov-result-merger`)
- Pro: Drop-in tool, ~5 lines of shell to invoke, well-maintained, monorepo-aware (`--prepend-source-files` + `--prepend-path-fix` flags for path normalization)
- Pro: No test-runner changes — keep `bun test --coverage` per package
- Con: Doesn't solve branch coverage (still depends on lcov source)
- Con: No built-in threshold enforcement — need a custom post-merge checker
- Verdict: **Quick win for merged report, but doesn't address branch gap**

**Option B — Vitest workspaces with `projects` config**
- Pro: Native branch coverage via v8 provider; `--coverage.thresholds.100` enforces 100% on lines/functions/branches/statements
- Pro: Vitest's `projects` config runs all packages from one root command, merges coverage automatically
- Pro: `--merge-reports` with `blob` reporter for sharded runs
- Con: Requires migrating bun test → vitest for some packages; bun:test API differences (`describe`/`it` vs `test`/`expect`)
- Con: Need a vitest.config.ts per package (or a shared `vitest-shared.ts`)
- Verdict: **Solves branches + merging + thresholds in one move, but more invasive**

**Recommended approach: HYBRID (Track A)**
- Keep `bun test` for fast dev iteration (no coverage)
- Add `vitest.config.ts` to each package that needs branch coverage
- Use vitest's `--coverage.thresholds.100` per package for hard gate
- Use vitest's `projects` workspace config at root for merged run
- Add `lcov-result-merger` as a fallback / cross-check (combine vitest lcov + any remaining bun lcov)
- Add root `bun run coverage:check` that fails on any file < 100% line/branch/function

**Why hybrid over pure vitest:** bun test is what the team already knows; bun:test's mocking (`mock()`) works; vitest migration is non-trivial for `packages/core/src/signal-center/plugins/*` which use `mock.module()` patterns. Hybrid minimizes churn while still hitting the mandate.

**Why hybrid over pure lcov-result-merger:** Mandate is 100% line+branch+function. Bun lcov has 0/0 branch data — cannot enforce branches. Must switch to a runner that emits branch data (vitest/v8 or istanbul).

## Phase 35 scope

### Track A — Coverage infrastructure + merged report (BLOCKING, ~1-2h)

**Goal:** root-level "run all tests, get one merged coverage report, fail on <100% per file" works.

**Deliverable:**

| Sub-task | File(s) | Acceptance |
|----------|---------|-----------|
| A.1 Decide: vitest workspace + bun test hybrid | `vitest.workspace.ts` at root, `vitest.config.ts` per package | One `bun run coverage` from root runs all packages, produces merged lcov, fails on <100% |
| A.2 Add `vitest.config.ts` to packages/paper, shared, tui, backtest-tools, backtest, core, apps/bot | 7 new vitest.config.ts files | `thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 }` set, `provider: 'v8'`, `reporter: ['text', 'lcov']` |
| A.3 Add `vitest` script to each package.json (alongside existing `bun test`) | 7 package.json files | `vitest run --coverage` works per package |
| A.4 Root `vitest.workspace.ts` with `projects: [apps/*, packages/*]` | `vitest.workspace.ts` at root | `bunx vitest run --coverage` from root runs all packages, single merged lcov |
| A.5 Root `coverage:check` script — post-merge per-file threshold check | `scripts/coverage-check.ts` (or `coverage-check.mjs`) | Reads merged lcov, fails process if any file < 100% on any of line/branch/function |
| A.6 Root `coverage:merged` script — run all + merge + check | `package.json` | `bun run coverage:merged` does all 3 in sequence, exits 0/1 |
| A.7 Wire `coverage:check` into the existing `coverage` turbo task | `turbo.json` | `turbo run coverage:check` runs after `coverage` |
| A.8 Keep `bun test --coverage` for fast dev iteration (no merge) | 7 package.json `test` scripts | No regression — `bun test` still works per package for red/green cycle |
| A.9 CI / docs note — how to add a new file to a package | `apps/bot/README.md` (or new `docs/coverage.md`) | One-pager: vitest will fail loudly if a new file has no tests |

**Acceptance gate (Track A's exit criterion):**
- `bun run coverage:merged` from root runs all packages, produces `coverage/lcov.info` (merged) + text summary, exits 0
- If ANY file is < 100% line/branch/function, exits 1
- Test files: the existing test files must still pass under vitest; we are NOT requiring them to be at 100% (only the src/ files are)
- lcov path is `coverage/lcov.info` at root; package-level lcovs still exist but are intermediates

**Decision authority:** Track A decides the bun↔vitest split per package based on test pattern compatibility. The recommendation in A.1 is "vitest for all packages that currently have <100% line OR that have branch-able code" — but Track A may keep bun test for simple packages where vitest migration would be pure churn.

### Track B — apps/bot full coverage (depends on A, ~3-4h)

**Goal:** `apps/bot` at 100% line + branch + function on EVERY src file.

**Files to bring from <100% to 100%:**

| File | Current line% | What's missing |
|------|---------------|----------------|
| `apps/bot/src/tui/live-bot-state-provider.ts` | 89.87% (Track A miss) | mapPosition long/short/notional=0/pnl=0 + mapClosedTrade synthetic-id/leverage=1/openedAt-heuristic — 31 uncovered lines |
| `apps/bot/src/bot/bot.ts` | 100/100/90.91 | 3 untested functions (likely arrow helpers in runner chain — verify and add) |
| `apps/bot/src/bot/position-manager.ts` | 99.7% | 1-2 uncovered lines — close the gap |
| `apps/bot/src/cli/router.ts` | 100/100/88.89 | 11% function gap — identify uncovered functions and test them |
| `apps/bot/src/cli/commands/help.ts` | untested (only 31 LOC) | full coverage needed |
| `apps/bot/src/cli/commands/start.ts` | untested (299 LOC) | full coverage needed |
| `apps/bot/src/cli/commands/status.ts` | untested (179 LOC) | full coverage needed |
| `apps/bot/src/cli/commands/strategies.ts` | untested (99 LOC) | full coverage needed |
| `apps/bot/src/cli/commands/trades.ts` | untested (126 LOC) | full coverage needed |
| `apps/bot/src/cli/commands/kill-switches.ts` | untested (110 LOC) | full coverage needed |
| `apps/bot/src/cli/commands/tui.ts` | untested (191 LOC) | full coverage needed |
| (8 files above) | 0% | full coverage needed for all |

**Total:** ~1,800 LOC of new tests across 12 files.

**Acceptance gate:** `bun run coverage:merged` passes for `apps/bot` files (LH==LF, BRH==BRF, FNH==FNF per file).

### Track C — packages/paper + packages/shared (depends on A, ~2-3h)

**Goal:** both small packages at 100%.

**packages/paper — 1 file at 5.4%:**

| File | Current | Notes |
|------|---------|-------|
| `packages/paper/src/paper-trader.ts` | 5.4% line | 277 LOC of paper-trading engine — this is the real work. Constructor, onTick, executeMarket, executeLimit, reconciliation, sequence-gap detection, history tracking |

**packages/shared — 4 files at <82%:**

| File | Current | Notes |
|------|---------|-------|
| `packages/shared/src/config.ts` | 57.1% line | 186 LOC — config validation, Zod schemas, env loading |
| `packages/shared/src/logger.ts` | 19.4% line | 63 LOC — structured logger, multiple transports |
| `packages/shared/src/types.ts` | 81.8% line | 244 LOC — type definitions + runtime guards |
| `packages/shared/src/utils.ts` | 8.5% line | 110 LOC — utility functions (likely numeric helpers, string formatters) |

**Note:** packages/shared is imported by EVERY package. If `utils.ts` is at 8.5%, that drags down the aggregate of every other package. Closing shared first is leverage for the merge.

**Acceptance gate:** `bun run coverage:merged` passes for paper + shared.

### Track D — packages/exchange full coverage (depends on A, ~2h)

**Goal:** all 8 src files at 100%.

| File | Current | Notes |
|------|---------|-------|
| `packages/exchange/src/bybitEuFeed.ts` | 35.0% line | bybit.eu WS adapter — biggest gap. Need to mock the WS layer (ccxt.pro) and test the orderbook/seq-gap/reconciliation logic |
| `packages/exchange/src/bybit-eu-adapter.ts` | untested | new file from Phase 33 — needs full coverage |
| `packages/exchange/src/factory.ts` | 100% (lcov shows OK but verify after vitest migration) | already passing — just needs vitest parity |
| `packages/exchange/src/feed.ts` | 100% | passing |
| `packages/exchange/src/index.ts` | 100% (re-export) | excluded from threshold |
| `packages/exchange/src/latency-monitor.ts` | 100% | passing |
| `packages/exchange/src/mockFeed.ts` | 100% | passing |
| `packages/exchange/src/symbols.ts` | 100% | passing |

**Note:** `packages/exchange` already has `vitest.config.ts` with 100% thresholds. The track is mostly about bringing the 2 non-100% files up.

**Acceptance gate:** `bun run coverage:merged` passes for exchange.

### Track E — packages/tui full coverage (depends on A, ~2-3h)

**Goal:** all 6 TUI src files at 100%.

TUI testing is Ink-specific. The standard tooling is `ink-testing-library` (provides `render()` returning a `lastFrame()` getter and event injection). For providers (which emit events), the pattern is to call the provider methods directly and assert on listener calls — no React render needed.

| File | Current | LOC | Approach |
|------|---------|-----|----------|
| `packages/tui/src/providers/BotStateProvider.ts` | untested | 103 | Pure logic — subscribe/unsubscribe/dispatch. Easy 100%. |
| `packages/tui/src/providers/PaperProvider.ts` | untested | 215 | Needs `@mm/paper` mock + subscribe/unsubscribe/error-fallback tests |
| `packages/tui/src/providers/SimulatedProvider.ts` | untested | 521 | Deterministic state machine — easy 100% with seeded RNG |
| `packages/tui/src/hooks/useBotState.ts` | untested | 25 | React hook — `renderHook` from `@testing-library/react` |
| `packages/tui/src/utils/format.ts` | untested | 77 | Pure formatters — trivial |
| `packages/tui/src/types.ts` | untested | 129 | Type definitions + guard functions — type-narrowing tests |

**Note:** TUI testing requires `ink-testing-library` and `react`. These are devDeps only.

**Acceptance gate:** `bun run coverage:merged` passes for tui.

### Track F — packages/backtest-tools full coverage (depends on A, ~3-4h)

**Goal:** all 8 CLI scripts + 5 data feeds at 100%.

| File | Current | LOC | Notes |
|------|---------|-----|-------|
| `src/cli/download-ohlcv.ts` | untested | — | ccxt-based OHLCV download |
| `src/cli/download-funding-rates.ts` | untested | — | bybit + dydx funding download |
| `src/cli/generate-report.ts` | untested | — | markdown report generator |
| `src/cli/run-arb-latency.ts` | untested | — | arb-latency sweep |
| `src/cli/run-donchian-pivot-composition.ts` | untested | — | composition baseline |
| `src/cli/run-donchian-range-baseline.ts` | untested | — | donchian range baseline |
| `src/cli/run-dydx-vs-cex-funding-carry.ts` | 64.6% line | — | carry strategy run |
| `src/cli/run-pivot-grid-baseline.ts` | untested | — | pivot grid baseline |
| `src/data/bitquery-grpc.ts` | 89.1% line | — | gRPC Bitquery data source |
| `src/data/coinglass-liquidation-ws.ts` | 88.9% line | — | Coinglass WS data source |
| `src/data/csv-feed.ts` | 100% | — | passing |
| `src/data/dydx-indexer-feed.ts` | 76.5% line | — | dYdX v4 indexer data source |
| `src/data/dydx-live-funding-source.ts` | 81.0% line | — | dYdX v4 live funding |
| `src/data/live-latency-source.ts` | untested | — | live latency source |
| `src/data/tardis-dydx-funding.ts` | 62.3% line | — | Tardis funding historical |

**Note:** backtest-tools CLI scripts are run via `bun run <script>`. Testing pattern: spawn the process with sample inputs, assert on output (snapshot-style). For data feeds: mock the upstream gRPC/WS and test reconnection/retry logic.

**Acceptance gate:** `bun run coverage:merged` passes for backtest-tools.

### Track G — packages/core gaps to 100% (depends on A, ~3-4h)

**Goal:** all 50 src files at 100% line + branch + function.

**Files currently at 95-99% line OR <100% function (close the 1-2% gaps):**

| File | Current line% | Current function% | What to add |
|------|---------------|-------------------|-------------|
| `src/index.ts` | 98.9% | 0% | 1 uncovered branch in the re-export |
| `src/portfolio/portfolio-decision.ts` | 98.6% | 92.3% | 1-2 uncovered lines + 1 untested function |
| `src/portfolio/portfolio-orchestrator.ts` | 99.4% | 89.8% | edge case in main loop |
| `src/risk/adaptive-kelly-vol-hybrid.ts` | 99.7% | 100% | 1 uncovered line |
| `src/risk/kelly-adaptive.ts` | 96.3% | 100% | 3-4 uncovered lines |
| `src/risk/kelly-position-sizer.ts` | 97.1% | 100% | 2-3 uncovered lines |
| `src/risk/portfolio-risk-engine.ts` | 99.7% | 96.0% | 1 untested function |
| `src/risk/vol-targeted-sizer.ts` | 97.9% | 100% | 1-2 uncovered lines |
| `src/signal-center/monolith-wrappers/cross-venue-funding-divergence-plugin.ts` | 99.3% | 86.2% | edge case + 1 untested fn |
| `src/signal-center/plugins/cex-netflow-regime-plugin.ts` | 99.7% | 91.7% | 1 untested fn |
| `src/signal-center/plugins/dvol-regime-sizing-plugin.ts` | 88.1% | 75.0% | 12% line gap + 25% fn gap — this is real work, not just edge case |
| `src/signal-center/plugins/perpdex-liquidation-signals-plugin.ts` | 100% | 96.3% | 1 untested fn |
| `src/signal-center/plugins/vol-target-sizing-plugin.ts` | 96.0% | 90.0% | 1 untested fn + 4% line gap |
| `src/signal-center/strategy-registry.ts` | 100% | 93.8% | 1 untested fn |
| `src/strategy/cascade-fade.ts` | 92.3% | 95.2% | 8% line gap + 5% fn gap — needs focused work |
| `src/strategy/dydx-cex-carry.ts` | ? | ? | needs audit after vitest migration |
| `src/strategy/dydx-cex-carry.paper-trade.ts` | untested | untested | full coverage |
| `src/strategy/funding-flip-kill-switch.ts` | untested | untested | full coverage (276 LOC) |
| `src/strategy/funding-snapshot.ts` | untested | untested | 27 LOC type/state |
| `src/strategy/multi-class-ensemble.ts` | untested | untested | 107 LOC ensemble logic — this is real work |
| `src/strategy/pivot-point-grid.ts` | ? | ? | needs audit |
| `src/portfolio/portfolio-decision.ts` | (above) | — | — |
| `src/telemetry/strategy-telemetry.ts` | ? | ? | needs audit |

**Plus 7 untested files:**
- `src/types.ts` (types)
- `src/signal-center/types.ts` (types)
- `src/portfolio/portfolio-decision.ts` (above)
- `src/strategy/multi-class-ensemble.ts` (107 LOC — production strategy)
- `src/strategy/funding-snapshot.ts` (27 LOC)
- `src/strategy/funding-flip-kill-switch.ts` (276 LOC — kill-switch)
- `src/strategy/dydx-cex-carry.paper-trade.ts` (paper-trade logic)

**Acceptance gate:** `bun run coverage:merged` passes for core.

### Track H — packages/backtest verify (depends on A, ~30min)

**Goal:** confirm packages/backtest is at 100% under the new vitest config (currently at 100% in-pkg under bun, but the threshold has to hold under vitest).

**Files:** 8 src files, 1,395 LOC.

**Acceptance gate:** `bun run coverage:merged` passes for backtest.

## Phase 35 totals

| Bucket | Count |
|--------|-------|
| Source files at 100% (in-pkg, current bun) | 8 (backtest only) |
| Source files needing work | 123 (across 7 packages) |
| Source LOC to add tests for | ~25,000+ (most of the monorepo) |
| New test files expected | 50+ |
| New vitest.config.ts | 7 (one per package) |
| New root infra | 1 (vitest.workspace.ts) + 1 (coverage-check script) + 1 (package.json script) |

## Plan structure

- **Track A (infra, BLOCKING):** 1 producer, runs first. ~1-2h.
- **Tracks B, C, D, E, F, G, H (per-package work):** 7 producers, can run in parallel after A. ~2-4h each.
- **Total wall clock:** ~5-6h with parallel producers (A + 7 parallel), or ~15-20h sequential.

**Verifier:** the lcov-direct expert (mvs_6604d60eaf1240a5b5ef300a37b426c3 — the one who already proved the lcov-as-source-of-truth protocol) — verifies all tracks using the per-file lcov math. Per the user's mandate, "100%" is non-negotiable: any file < 100% line/branch/function is a hard fail.

## Ordering & dispatch

**Phase 35 dispatch precondition:** plan_36ba23c7 (Phase 34) must be closed. Phase 35 branches from `origin/main` at the SHA after Phase 34 lands. Branch: `feat/phase35-<track>-<slug>`.

**Dispatch sequence:**
1. Wait for plan_36ba23c7 → status `completed`
2. Plan_36ba23c7 owner (me) squashes Phase 34 PRs into main
3. Dispatch Phase 35 plan with Tracks A → (B, C, D, E, F, G, H) in dependency order
4. Track A: 1 producer (coder), 1 verifier (verifier)
5. Tracks B-H: 7 producers in parallel, 1 verifier (shared) who verifies each in order

## Out of scope (deliberately)

- **Switching test runner to vitest for ALL packages** — only packages that need it for branch coverage. Decision in Track A.
- **Coverage of generated files** (protobufs, build output) — excluded via `coverage.exclude`.
- **Coverage of test files themselves** — vitest convention is to exclude.
- **Performance testing** — this is about line/branch/function coverage, not timing.
- **Mutation testing** — Stryker/cosmic-ray would be a follow-up phase, not Phase 35.

## Risks

1. **TUI testing complexity** — Ink/React testing is finicky. Track E may need to fall back to logic-only tests (no React render) if ink-testing-library hits compatibility issues.
2. **dYdX/Tardis/Bitquery data feeds** — these talk to real external systems. Track F needs careful mocking. May need to introduce HTTP/WS mock infrastructure.
3. **CLI command testing** — Track B's 8 CLI files spawn the bot process; tests need to assert on stdout/stderr, not on the function return. May need a CLI testing harness.
4. **backtest-tools CLI scripts** — same as above but worse: they're `bun run <script>.ts` style. Pattern: spawn the process with fixture inputs, assert on output files.
5. **Threshold enforcement breaking main** — once Track A lands, `turbo run coverage:check` will fail until all tracks close. Must NOT merge Track A to main until B/C/D/E/F/G/H land. **Hold Track A as a separate branch that the orchestrator owns; do not auto-merge.**
