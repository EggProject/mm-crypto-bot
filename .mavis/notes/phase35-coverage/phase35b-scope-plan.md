---
description: Phase 35b scope plan — 100% coverage enforcement infrastructure + close remaining gaps via parallel sub-agents. Updated 2026-07-12 16:50 Budapest.
---

# Phase 35b — COVERAGE THRESHOLD ENFORCEMENT + CLOSE REMAINING GAPS

## User mandate (2026-07-12 16:45 Budapest)

Two related directives, captured verbatim:

1. **"agentek dolgozzanak, elfelejtetted hogy te csak kordinator vagy!"** — The orchestrator (me) is a COORDINATOR, not the worker. The actual gap fixing should be delegated to sub-agents working in parallel.
2. **"vitest configban is allitsuk be a kotelezo coverag 100% -t, igy jelezni fog mindig"** — Set the 100% coverage mandate in the vitest config so it always reports. The threshold must be permanently enforced, not just a one-time claim.

## State at the start of Phase 35b (2026-07-12 16:45 Budapest)

After Phase 35 closed (5 PRs merged, "100% coverage" claimed), the per-file analysis revealed the truth:

- 6/8 packages at 100% line coverage on OWN files (backtest, exchange, paper, shared, tui, apps/bot)
- packages/core: 99.76% line (8 files below 100% — defensive branches, dead code, throw bodies)
- packages/backtest-tools: 75.08% line (5 CLI scripts with `main()` untested + 3 data feed files)
- Merged coverage: 87.16% (the `bun run coverage:merge` script exists, the report is generated, but per-file gaps are hidden in the aggregate)

The previous "fully closed" claim was based on per-package AGGREGATE text reports — per-FILE analysis shows the gaps.

## What Phase 35b does

### Part 1 — Threshold enforcement infrastructure (DONE, commit c907d57)

- **`scripts/enforce-coverage-threshold.mjs`** — reads every per-package `lcov.info` and FAILS (exit 1) if any OWN src/ file is below 100% on line OR function coverage. Prints a per-package pass/fail summary and a detailed gap list.
- **`vitest.config.ts`** — added to all 8 packages (apps/bot + 7 packages/*) with 100% thresholds for lines/functions/branches/statements. The bun test runner is still the primary test runner (matches the rest of the project), but the vitest config documents the mandate + is wired so any future migration to `vitest run --coverage` would surface threshold violations immediately.
- **Root `package.json`** — new scripts:
  - `coverage:enforce` — runs the threshold check standalone (re-readable by CI)
  - `coverage:full` — turbo coverage + merge + enforce (the "all in one" command)

### Part 2 — Close remaining gaps via parallel sub-agents (IN PROGRESS)

Three sub-agents launched in parallel, one per package group. Each agent:
- Creates a fresh worktree on a new branch off `fix/phase35b-coverage-gaps` (the latest with the threshold infra).
- Writes tests to cover the gaps — REAL tests, no `// @ts-ignore` or `/* c8 ignore */` skips.
- Verifies with `bun run coverage:full` (or equivalent) and captures the exact exit code.
- Opens a PR with a clean body explaining what was added.
- Reports back with PR URL + test count delta + threshold check status.

**Agent 1 (backtest-tools)** — `bg_3ef4bb77-6a95-48a3-bba0-247475767c8d`
- Scope: 8 files in `packages/backtest-tools/src/`
- 5 CLI scripts (generate-report, run-donchian-pivot-composition, run-donchian-range-baseline, run-dydx-vs-cex-funding-carry, run-pivot-grid-baseline) — `main()` not exported, needs subprocess tests
- 3 data feed files (dydx-indexer-feed, dydx-live-funding-source, tardis-dydx-funding) — function coverage gaps only
- Pattern reference: `run-dydx-vs-cex-funding-carry.cli.test.ts` (existing subprocess test)

**Agent 2 (packages/core)** — `bg_16c9ca69-2f7e-4b7c-bdf0-79acc6832777`
- Scope: 7 files in `packages/core/src/`
- 6 function coverage gaps: portfolio-orchestrator, cex-netflow-regime-plugin, dvol-regime-sizing-plugin, perpdex-liquidation-signals-plugin, strategy-registry, dydx-cex-carry.paper-trade
- 1 line coverage gap: `kelly-adaptive.ts:777-779` (throw body — bun quirk, refactor to `__testing_throwNoNonEmptyWindowsError` helper)

**Agent 3 (apps/bot)** — `bg_ffc9be63-49bc-4b03-85ea-301407a6580e`
- Scope: 3 files in `apps/bot/src/`
- bot.ts, router.ts, live-bot-state-provider.ts — function coverage gaps only (line coverage already 100%)

### Part 3 — Verify and merge (PENDING)

Once all 3 agents report back, the orchestrator will:
1. Re-run `bun run coverage:full --force` from the main project root
2. Verify: `bun run coverage:enforce` exits 0
3. Verify: every per-package test still passes under `--coverage`
4. Merge all 3 PRs (sequentially, after each one's CI passes)
5. Report the final state to the user

## Hard rules (all agents)

- DO NOT add coverage-skip directives (`// @ts-ignore`, `/* c8 ignore */`, etc.)
- DO NOT use `mock.module("ccxt", ...)` — that polluted the global ccxt module in Phase 35 H track. Use dependency injection.
- DO NOT use `__testing_*` exports to silently bypass coverage — only for private helpers that the public API doesn't reach.
- Real tests only. If a branch is unreachable, refactor or document why.
- Test code can be in Hungarian (project convention). Commit messages in English.

## Verification protocol (mandatory, applies to all agents)

After writing tests, BEFORE reporting "done":
1. `cd /Users/kiscsicska/projects/mm-crypto-bot && bunx turbo run coverage --force` — must end with `Tasks: N successful, N total`
2. `cd /Users/kiscsicska/projects/mm-crypto-bot && node scripts/merge-coverage.mjs` — must generate the merged report
3. `cd /Users/kiscsicska/projects/mm-crypto-bot && node scripts/enforce-coverage-threshold.mjs` — must end with exit code 0
4. Report the exact exit codes in the report-back. If any != 0, NOT done.
