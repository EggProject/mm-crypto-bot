# Bot E2E driver split candidate

## Scope and routing

- Base: `ff8e66267c7738f8d8a392f034d06018119ee95e`.
- Current candidate: 20 code/documentation paths: delete the 3,497-line legacy driver, modify the E2E builder and `plans/full-refactor/SCRIPTS.md`, and add 17 runtime-driver files under `apps/bot/test/e2e/runtime-driver`.
- Excluded: production bot behavior, D-10 live activation, runtime-scope manifest, runner, lockfile, package dependency versions, and every dirty shared-worktree module outside this clean-base candidate.
- Design/audit: `terra_reader`, `gpt-5.6-terra`, high, read-only; multi-package test architecture and coverage-integrity Terra triggers.
- Foundation, case groups 2A/2B, and integration: four independent non-review write briefs using `terra_worker`, `gpt-5.6-terra`, high, workspace-write, one writer per path, no fallback.
- Current package count: 1 (`apps/bot`) plus root coverage tooling and documentation.
- Reasoning shape: clean-baseline characterization, dependency extraction, public test-boundary replacement, case-parity cutover, then exact coverage validation.
- No arbitrary time limit, staging, commit, self-review, network access, or mutable external resource.

## Baseline

Before the split, `bun run coverage:bot:e2e` exited 0 with 21/21 CLI tests, 45/45 total cases, and exact coverage S 1598/1598, B 866/866, F 280/280, L 1515/1515. The runtime manifest declared 16 runtime case IDs.

## Implementation

- The 16 declared case IDs are dispatched from `runtime-driver.ts` to 13 case modules plus three foundation modules.
- `build-bot-e2e.ts` now bundles the new entry as `runtime-driver.js`; its public build API is unchanged.
- The exchange test fixture is bot-owned in `runtime-driver-exchange-fixture.ts`; no `packages/exchange` test export is part of this candidate.
- The old direct `packages/*/src` import boundary and the 3,497-line driver are removed.
- Every remaining candidate file is at most 500 lines.
- Baseline D-10 behavior is intentionally preserved: three live credential variants still warn/start and return 0; the D-10 fail-closed change is a later commit.
- Current narrow line exceptions are enumerated below; the builder's pre-existing file-level disable remains. No new file/global/config disable, `any`, or type assertion was introduced.

## Validation

- `bun run coverage:bot:e2e`: exit 0; 21/21 CLI tests; 45/45 cases; exact S 1598/1598, B 866/866, F 280/280, L 1515/1515.
- `bun run typecheck:coverage-tools`: exit 0.
- `bun run coverage:scope`: exit 0; 20 owned runtime files.
- `bun run --filter @mm-crypto-bot/exchange typecheck`, `build`, and `test`: exit 0; exchange 379/379 tests and 756 assertions.
- `bun run --filter @mm-crypto-bot/bot typecheck`: exit 0.
- Scoped ESLint with zero warnings, Prettier, and `git diff --check`: exit 0.
- Direct public import/runtime probes and all 16 case exports: exit 0.
- Unknown runtime case: fails with the expected `unknown runtime driver case: unknown-case` error.
- `START_LIVE_ACTIVATION_UNAVAILABLE` is absent; the missing/empty/present-key exit-0 baseline assertions remain.

## Review gate

The candidate requires an independent `terra_reviewer` TECH result and an independent `luna_process_reviewer` PROCESS result. No commit is allowed while any valid finding remains.

## Immutable dispatch and rework ledger

Times and exit codes are recorded only where observed; unavailable values are `not observable`.

| Work item                 | Owner/route; class; mode; review role                                                                              | Ownership/package; Terra predicate; authority                                                                                                                                                                                    | Relation/status; rework/fallback; result                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery/design          | `/root/bot_e2e_driver_split_audit`; terra_reader; discovery; read-only; non-review                                 | apps/bot + packages/exchange + root tooling; 2 plus root; multi-package Terra trigger; isolated read-only                                                                                                                        | prerequisite; PASS; no retry/fallback; timing/exit not observable                                                                                                   |
| Foundation                | `/root/bot_e2e_split_foundation`; terra_worker; implementation; write; non-review                                  | exact 4 initial paths: exchange package.json, exchange/src/testing.ts, runtime-driver-core.ts, runtime-driver-portfolio-fixtures.ts; 2; public boundary Terra trigger; isolated workspace-write                                  | parallel with 2A/2B; implementation gates initially PASS; no fallback or scope growth                                                                               |
| 2A                        | `/root/bot_e2e_split_bot_cases`; terra_worker; implementation/tests; write; non-review                             | exact 7 paths: lifecycle-smoke.ts; bot-lifecycle-factory.ts; bot-subscriptions.ts; bot-state-and-telemetry.ts; bot-cleanup-and-order-risk.ts; config-store.ts; funding-source.ts; 1; test architecture; isolated workspace-write | parallel; PASS; no retry/fallback                                                                                                                                   |
| 2B                        | `/root/bot_e2e_split_cli_portfolio_cases`; terra_worker; implementation/tests; write; non-review                   | exact 6 paths: cli-boundaries.ts; risk-modules.ts; portfolio-primitives.ts; portfolio-manager-paper.ts; portfolio-manager-authoritative.ts; portfolio-manager-lifecycle.ts; 1; test architecture; isolated workspace-write       | parallel; lint 125, then 11, then PASS with narrow line disables; no escalation                                                                                     |
| Integration               | `/root/bot_e2e_split_integration`; terra_worker; integration; write; non-review                                    | runtime-driver.ts, build-bot-e2e.ts, deleted bot-runtime-driver.ts; 1 plus root tooling; test architecture; isolated workspace-write                                                                                             | after foundation/2A/2B; D-10 wording mismatch reported without scope expansion; PASS                                                                                |
| TECH review               | `/root/bot_e2e_split_tech_review`; terra_reviewer; independent technical review; read-only; technical review       | original 20 implementation paths including exchange package/testing seam, plus active SCRIPTS check; 2 plus root; mandatory reviewer route; read-only review authority                                                           | after integration; FAIL 2 findings; remediation required; no fallback                                                                                               |
| PROCESS review            | `/root/bot_e2e_split_process_review`; luna_process_reviewer; independent process review; read-only; process review | original candidate plus task-report; 2 plus root; mandatory reviewer route; read-only review authority                                                                                                                           | after integration; FAIL 3 findings; remediation required; no fallback                                                                                               |
| Foundation remediation    | `/root/bot_e2e_split_foundation`; terra_worker; narrow implementation; write; non-review                           | package.json, testing.ts deletion, core, new exchange fixture; dispatch-era package count 2; public boundary Terra trigger; isolated workspace-write                                                                             | later direct probe had missing preload/invalid harness command; stopped/reclassified to documented env+preload invocation, then PASS; no fallback or scope growth   |
| Documentation remediation | `/root/bot_e2e_split_docs_fix`; luna_worker; documentation; write; non-review                                      | `plans/full-refactor/SCRIPTS.md`; 1; none; worktree write                                                                                                                                                                        | after TECH P2; PASS scoped formatting/diff checks                                                                                                                   |
| Comment remediation       | `/root/bot_e2e_split_docs_fix`; luna_worker; documentation-only comment edit; write; non-review                    | exact five files: portfolio-primitives.ts, cli-boundaries.ts, risk-modules.ts, bot-lifecycle-factory.ts, config-store.ts; 1; none; worktree-write                                                                                | after TECH rereview FAIL 1; Spark unavailable, reclassified as documentation-only; six justification comments updated, code/directives unchanged; scoped gates PASS |
| Evidence follow-up        | `/root/bot_e2e_split_docs_fix`; luna_worker; process evidence; write; non-review                                   | this report and unique temp logs; 1; none; worktree-write                                                                                                                                                                        | after foundation stabilization; COMPLETED; no fallback                                                                                                              |

All workers used their pinned profile route and effort; exact effective model/effort attestation and process exit codes were not observable in the task relay unless captured below. No arbitrary wall-clock limit, staging, commit, or self-review was used.

### Explicit dispatch fields

Each work item has an explicit dependency, requested/effective profile, authority, retry, status, and result record. Effective means profile-enforced; provider-dispatch attestation was not observable.

| Work item                 | Dependency; requested/effective model and effort                                                                                                                           | Sandbox/write authority; retry/rework/fallback; status/result                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Discovery/design          | none; `gpt-5.6-terra/high` requested; profile-enforced `gpt-5.6-terra/high`, provider-dispatch attestation not observable                                                  | isolated read-only; no retry/fallback; PASS                                                 |
| Foundation                | discovery; `gpt-5.6-terra/high` requested; profile-enforced `gpt-5.6-terra/high`, provider-dispatch attestation not observable                                             | isolated workspace-write; initial implementation PASS, no fallback; PASS                    |
| 2A                        | discovery + foundation API contract, parallel with 2B; `gpt-5.6-terra/high` requested; profile-enforced `gpt-5.6-terra/high`, provider-dispatch attestation not observable | isolated workspace-write; no retry/fallback; PASS                                           |
| 2B                        | discovery + foundation API contract, parallel with 2A; `gpt-5.6-terra/high` requested; profile-enforced `gpt-5.6-terra/high`, provider-dispatch attestation not observable | isolated workspace-write; lint rework 125→11→PASS, no fallback; PASS                        |
| Integration               | foundation + 2A + 2B; `gpt-5.6-terra/high` requested; profile-enforced `gpt-5.6-terra/high`, provider-dispatch attestation not observable                                  | isolated workspace-write; no fallback; PASS, D-10 mismatch reported without scope expansion |
| TECH review               | integration candidate; `gpt-5.6-terra/high` requested; profile-enforced `gpt-5.6-terra/high`, provider-dispatch attestation not observable                                 | read-only review authority; no retry/fallback; FAIL 2, remediation required                 |
| PROCESS review            | integration candidate; `gpt-5.6-luna/medium` requested; profile-enforced `gpt-5.6-luna/medium`, provider-dispatch attestation not observable                               | read-only review authority; no retry/fallback; FAIL 3, remediation required                 |
| Foundation remediation    | TECH P1; `gpt-5.6-terra/high` requested; profile-enforced `gpt-5.6-terra/high`, provider-dispatch attestation not observable                                               | isolated workspace-write; direct-probe rework, no fallback; PASS                            |
| Documentation remediation | TECH P2; `gpt-5.6-luna/low` requested; profile-enforced `gpt-5.6-luna/low`, provider-dispatch attestation not observable                                                   | worktree-write, SCRIPTS only; no fallback; PASS                                             |
| Evidence follow-up        | PROCESS findings + stable remediations; `gpt-5.6-luna/low` requested; profile-enforced `gpt-5.6-luna/low`, provider-dispatch attestation not observable                    | worktree-write report plus unique temp logs; no fallback; COMPLETED                         |

Failure/rework ledger: 2B had lint 125→11→PASS. During `/root/bot_e2e_split_bot_cases`, `bun run typecheck:coverage-tools` failed on three concurrent 2B-owned diagnostics (cli-boundaries unused import; portfolio-manager-authoritative duplicate ExchangePosition imports twice); original timestamp, raw exit code, and failure-log hash were not observable. 2A made no cross-scope edit. After 2B finalized, the same command passed; final `tooling-gates.log` SHA is recorded below. The foundation direct probe had a missing preload/invalid harness command and was reclassified to the documented env+preload invocation, then passed. Integration reported a D-10 mismatch without scope expansion. TECH failed 2 findings, then its rereview failed 1 comment-only finding; Spark was unavailable and the remediation was reclassified to the luna_worker documentation-only route. PROCESS failed 3 findings before remediation.

## Evidence capture

Unique logs: `/tmp/mm-bot-e2e-split-evidence-20260825/`. The report records command outputs without repository-absolute paths. Log SHA-256: `coverage-bot-e2e.log` `9c4a148949c274221c879c0e9c144c9dc537c4e0791eabaf3616b8147baa1772`; `tooling-gates.log` `0df0a0f55228d5e5f10fdbdbccac9551455c6880951bb974a285029048b3fe20`; `exchange.log` `a1b186e2cd297ab6c87898e26b97a7828a4f94718ae4ff966ad482bf83a8cc14`; `bot.log` `fa50e4d8879ea4e8ce6316972354e983453524397c0e6a1ee0192494e1101108`; `style.log` `a27b7895b019994724f7287eaa1d5711a7b5f1db34dd0efd2ac46459385929bb`.

Observed gates: `coverage:bot:e2e` exit 0, 45/45 cases and S/B/F/L `1598/1598`, `866/866`, `280/280`, `1515/1515`; `typecheck:coverage-tools` and `coverage:scope` exit 0; exchange typecheck/build/test exit 0 (379/379 tests, 756 assertions); bot typecheck exit 0. Exact scoped commands captured in `style.log` were `bunx eslint --config eslint.config.js scripts/coverage-tools/build-bot-e2e.ts apps/bot/test/e2e/runtime-driver --max-warnings=0`, `bunx prettier --check scripts/coverage-tools/build-bot-e2e.ts apps/bot/test/e2e/runtime-driver plans/full-refactor/SCRIPTS.md .superpowers/sdd/bot-e2e-driver-split-plan/task-report.md`, and `git diff --check -- ...`; each exit 0 with start/end timestamps. These commands generated no coverage artifact; verified absence means no candidate-local `coverage/` or LCOV artifact was produced by the captured commands.

Exact current inventory (20 code/documentation paths): `scripts/coverage-tools/bot-runtime-driver.ts` (deleted); `scripts/coverage-tools/build-bot-e2e.ts`; `plans/full-refactor/SCRIPTS.md`; `apps/bot/test/e2e/runtime-driver/bot-cleanup-and-order-risk.ts`; `bot-lifecycle-factory.ts`; `bot-state-and-telemetry.ts`; `bot-subscriptions.ts`; `cli-boundaries.ts`; `config-store.ts`; `funding-source.ts`; `lifecycle-smoke.ts`; `portfolio-manager-authoritative.ts`; `portfolio-manager-lifecycle.ts`; `portfolio-manager-paper.ts`; `portfolio-primitives.ts`; `risk-modules.ts`; `runtime-driver-core.ts`; `runtime-driver-exchange-fixture.ts`; `runtime-driver-portfolio-fixtures.ts`; `runtime-driver.ts`. Including this report, the evidence candidate is 21 paths. Every candidate file is <=500 lines; maximum observed is 500. The report itself is intended as candidate evidence and is below 500 lines.

Disable inventory: pre-existing file-level `security/detect-non-literal-fs-filename` at `scripts/coverage-tools/build-bot-e2e.ts:1`; all other current disables are new narrow line-level exceptions: `bot-cleanup-and-order-risk.ts:118,162`; `bot-lifecycle-factory.ts:115`; `bot-state-and-telemetry.ts:72,95,110,136,162,181,187`; `cli-boundaries.ts:41,445`; `config-store.ts:62,108,115,119,124,132,135,148`; `lifecycle-smoke.ts:67`; `portfolio-primitives.ts:11,159`; `risk-modules.ts:96`. No new file/global/config disable was added.

D-10 parity: baseline live missing-key assertion is at `cli-boundaries.ts:369`, empty-key at `:373`, and present-key at `:376`; all assert exit 0. `START_LIVE_ACTIVATION_UNAVAILABLE` is absent from the candidate. D-10 fail-closed behavior remains a later scope and is not claimed PASS here.

The integration review reported a D-10 regex wording mismatch; it was recorded without scope expansion, not claimed as fixed in this report.
