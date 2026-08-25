# Script Inventory and Disposition — DRAFT

**Status:** DRAFT. Dispositions follow approved plan direction, but every change
still requires consumer search, subprocess characterization, target replacement,
validation, and phase review before deletion.

## Principles

Scripts remain only when they are small, deterministic repository automation
that cannot be a package task, have one owner, no unbounded/destructive behavior,
and a test where behavior is non-trivial. Scripts never install a global alias,
embed runtime secrets/configuration, reach live exchanges in tests, or delete
outside an explicit allowlist. Generated data belongs below `data/`, not beside
scripts.

## Root shell/Node scripts — exhaustive current inventory

| Current path                      | Observed purpose                    | Candidate disposition                                                                     | Evidence required before action                                |
| --------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `scripts/install-mm-bot.sh`       | Root `postinstall` alias installer. | **DELETE** with alias chain.                                                              | `rg -n "install-mm-bot                                         | mm-bot" .`; clean install without postinstall. |
| `scripts/install-no-warnings.sh`  | Install warning test helper.        | **REPLACE** with frozen-install CI gate or **DELETE** if redundant.                       | Inspect callers and reproducible clean-install test.           |
| `scripts/dev.sh`                  | Development launcher.               | **REPLACE** with an app-owned `dev` task if justified.                                    | CLI consumer inventory and dev subprocess contract.            |
| `scripts/coverage-full.sh`        | Aggregates coverage.                | **MOVE/REPLACE** as root verification task.                                               | Compare separate unit/E2E scope outputs.                       |
| `scripts/coverage-per-package.sh` | Per-package coverage gate.          | **MOVE/REPLACE** as deterministic coverage task.                                          | Verify every target package/app and 100% metrics.              |
| `scripts/coverage-gates.test.sh`  | Shell coverage regression checks.   | **REPLACE** with typed test/task where possible.                                          | Characterization test and no shell-only hidden state.          |
| `scripts/lcov-tools.mjs`          | Repository-owned LCOV utilities.    | **KEEP** only if needed by merged reports; otherwise replace with maintained pinned tool. | Call graph, deterministic fixture tests, license/audit review. |

## `scripts/coverage-tools/` — exhaustive current inventory

| Current path                              | Candidate disposition                                                                           | Required evidence                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `build-bot-e2e.ts`                        | **MOVE/REPLACE** under test infrastructure.                                                     | Bot artifact build characterization.                   |
| `bot-e2e-preload.ts`                      | **MOVE/REPLACE** under E2E harness.                                                             | E2E preload contract.                                  |
| `bot-e2e-gate.ts`                         | **MOVE/REPLACE** as E2E coverage validator.                                                     | Negative/positive LCOV fixtures.                       |
| `bot-e2e-gate.test.ts`                    | **MOVE** with its implementation.                                                               | Test stays behavior-named.                             |
| `bot-e2e-child-environment.ts`            | **MOVE/REPLACE** under E2E harness.                                                             | Environment isolation test.                            |
| `bot-e2e-child-environment.test.ts`       | **MOVE** with its implementation.                                                               | Test stays behavior-named.                             |
| `bot-runtime-driver.ts`                   | **SPLIT/MOVE** completed under `apps/bot/test/e2e/runtime-driver/`; the legacy file is deleted. | Cohesive harness decomposition and output equivalence. |
| `bot-runtime-network-guard.ts`            | **MOVE/KEEP** as deterministic no-network E2E guard.                                            | Positive/negative subprocess proof.                    |
| `bot-runtime-network-guard.test.ts`       | **MOVE** with implementation.                                                                   | Existing/migrated contract passes.                     |
| `bot-runtime-network-negative-fixture.ts` | **MOVE** to deterministic test fixtures.                                                        | No production import.                                  |
| `bot-runtime-scope.ts`                    | **MOVE/REPLACE** under coverage architecture tooling.                                           | Scope definition review.                               |
| `bot-runtime-scope.test.ts`               | **MOVE** with implementation.                                                                   | Scope negative fixture.                                |
| `bot-runtime-scope.json`                  | **MOVE** to declared coverage-scope data.                                                       | Schema validation and ownership.                       |
| `verify-bot-runtime-scope.ts`             | **MOVE/REPLACE** as generic app runtime-scope validator.                                        | Handles all deployable apps.                           |
| `run-bot-unit-coverage.ts`                | **REPLACE** with normalized unit coverage task.                                                 | Separateness and 100% report.                          |
| `run-bot-e2e-coverage.ts`                 | **REPLACE** with normalized E2E coverage task.                                                  | Separateness and 100% report.                          |
| `istanbul-libraries.d.ts`                 | **KEEP/MOVE** only if instrumentation API needs it.                                             | Typecheck after tool selection.                        |

## Package/root command candidates

The root `postinstall`, `mm-bot`, `mm-bot:built`, `start`, `headless`, and
`bot:*` commands and `apps/bot` package `bin` are **DELETE** candidates because
they implement the requested alias chain. Replace with explicit workspace app
tasks, for example `bun --filter @mm-crypto-bot/bot run start`, only after the
approved CLI contract exists. Existing backtest command aliases move to
`apps/config-search` or a purpose-specific app task after its boundary is
approved. The unsafe broad `clean` using `rm -rf node_modules .turbo coverage`
is a **REPLACE** candidate; a pre-commit clean must be allowlisted and cannot
remove `node_modules`, reports, state, data, or unknown files.

## Verification command set

Before finalizing any row: `rg -n "<script-or-command>" --glob '!bun.lock' .`;
inspect package scripts and Turbo task callers; run the current script only in a
safe temporary/test context; add a replacement contract test; then re-run the
reference search after the replacement. No candidate may be deleted based only
on filename inference.
