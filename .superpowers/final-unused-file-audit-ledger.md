# Final unused-file audit ledger

## Read-only inventory dispatch

- Task class: graph-backed read-only inventory of unnecessary-file candidates in the current 301-path dirty union.
- Mode: read-only, non-review; no deletion or mutation.
- Target: `/home/eggp/projects/mm-crypto-bot` current dirty worktree at source HEAD `5a5c10bd12bef01ba756549fd61a93921438cb33`.
- Ownership: none; inspect all 301 dirty paths and the tracked entrypoint/config/build/test/documentation references needed to classify them.
- Package count: multi-package/root repository inventory.
- Domain risk: repository-wide architecture/data/evidence integrity; Terra trigger. No trading/risk/live behavior change.
- Reasoning shape: build import/export, package exports, scripts, Vitest/tsconfig/coverage, CLI, documentation, data/catalog and generated-artifact reference evidence; identify duplicates, dead files, stale legacy, temporary reports and obsolete replacements.
- External/mutable resources: local read-only filesystem/Git only; no network, tests that mutate state, external writes, stage, commit, or deletion.
- Review role: non-review preparatory audit; later deletion implementations and final TECH/PROCESS are separate.
- Route: mandatory `terra_reader`, `gpt-5.6-terra` / high, read-only; effective model/effort not observable; no fallback.
- Required output: exact path-level groups `required`, `removal-candidate`, `replacement-pair`, `generated-or-scratch`, and `not-yet-provable`, each with concrete graph/reference evidence; highlight files that should never enter a commit. Do not infer that a currently unreferenced public/runtime file is removable if future approved specs require it.
- Validation: source status/index unchanged; commands recorded; no final clean claim. The eventual terminal gate remains zero unnecessary/duplicate/dead/scratch/legacy files after implementations and independent reviews.

## Inventory result

- Source/index remained unchanged: 301 dirty paths (126 tracked, 175 untracked), porcelain SHA-256 `903109209d0acc64f6a626713efbf6d966ffdc1945542acee913e3653af26a76`, empty index, diff-check clean.
- Required active graph: governed bot coverage/tooling, 33 E2E driver modules, imported bot splits, kebab-case exchange split and tests, referenced runtime configs.
- Proven replacement pairs: bot/config/exchange test and source splits; shared logger removal replaced by the logging package.
- Hard never-commit scratch: `.superpowers/sdd/d10-live-activation-plan/task-report.md`, root `deliverable.md`.
- Orphan removal candidates: 13 unreferenced targeted Vitest configs; the likely duplicate `kill-switch-dry-run.test.ts` wrapper requires one execution-registration proof.
- Blocked replacement set: the current CCXT 4.5.75 manifests/lock/docs/plans/evidence cannot be committed as-is because published ESM/d.ts identify 4.5.74.
- Not-yet-provable: disconnected arb-latency artifact/exact/output graph; premature `/releases/` ignore; top-level ledgers/evidence with stale candidate state.
- Additional cleanup blockers: six exchange tests retain legacy `bybitEuFeed` wording; several touched test/evidence files exceed 500 and require compliant splits or explicit generated-lock treatment for `bun.lock`.

Status: READ-ONLY INVENTORY COMPLETE. No removal is authorized by this record alone; exact cleanup implementation/review briefs must follow after current writers finish.

## Orphan/disconnected-graph decision audit dispatch

- Task class: bounded read-only necessity/removal design audit.
- Mode: read-only, non-review.
- Scope: the 13 orphan Vitest configs, `kill-switch-dry-run.test.ts` wrapper and four split tests, the disconnected `arb-latency-artifact-v2`/`arb-latency-exact`/CLI/output writer source-test graph, its package/root scripts/exports, and binding full-refactor specs/approvals only.
- Package count: `apps/bot`, `packages/exchange`, `packages/backtest-tools`, root plan/script references; Terra multi-package trigger.
- Domain risk: backtest data/tooling architecture; no live/trading/risk runtime change and no deletion in this phase.
- Reasoning shape: prove exact duplicate execution, intended product entrypoint/spec obligation, graph reachability, and smallest terminal action for each path: wire, retain, or remove.
- External/mutable resources: local read-only filesystem/Git and non-mutating test listing only; no network/external writes.
- Review role: non-review; later write + TECH/PROCESS separate.
- Route: mandatory `terra_reader`, `gpt-5.6-terra` / high, read-only; effective model/effort not observable; no fallback.
- Required output: exact path list and one executable cleanup brief with ownership, deletion/wiring sequence, tests/gates and rollback; no arbitrary product/API decision. If approved specs genuinely require the disconnected graph, state the exact entrypoint it must wire to; otherwise prove removal is goal-preserving. Source/index unchanged.

## Orphan decision result

- Retain and wire: `apps/bot/vitest.config-command.config.mjs`, `packages/exchange/vitest.bybit-eu-adapter.config.mjs`; each is the necessary exact four-metric gate for an active implementation slice.
- Retain but defer wiring: `packages/backtest-tools/vitest.ccxt-provenance.config.mjs`, because its current test is pinned to the blocked CCXT 4.5.75 candidate.
- Remove: `apps/bot/src/cli/commands/kill-switch-dry-run.test.ts`; it only imports four independently discovered and manifest-selected split tests.
- Remove: the exact 27-file disconnected arb-latency artifact-v2/exact/CLI/output source-test graph and its ten exclusive Vitest configs. It has no package export, CLI/root/package script, active documentation, or D-01…D-10 approval/architecture entrypoint.
- Cleanup implementation must wire the two retained exact configs through package scripts and the root coverage pipeline with isolated reports; it must not touch CCXT versions or the deferred provenance config.
- Required deletion/reference scans, exact coverage, bot/exchange/type/build gates, rollback, and independent reviews are defined by the reader handoff.

Status: ORPHAN DECISION AUDIT COMPLETE. Cleanup write dispatch waits until current union writers no longer overlap.

## Proven cleanup implementation dispatch

- Task class: repository hygiene and exact coverage wiring from the approved read-only graph decision.
- Mode: write, non-review.
- Exact ownership:
  - delete `apps/bot/src/cli/commands/kill-switch-dry-run.test.ts`;
  - delete the exact 27 `packages/backtest-tools/src/cli/arb-latency-{artifact-v2*,cli-arguments*,exact-*,output-contract*,secure-output-writer*}` paths enumerated in the preceding audit result;
  - delete the exact ten `packages/backtest-tools/vitest.arb-latency-*.config.mjs` files enumerated there;
  - delete `.superpowers/sdd/d10-live-activation-plan/task-report.md` and root `deliverable.md` as proven scratch/stale deliverables;
  - retain and modify only `apps/bot/vitest.config-command.config.mjs`, `packages/exchange/vitest.bybit-eu-adapter.config.mjs`, `apps/bot/package.json`, `packages/exchange/package.json`, and `scripts/coverage-full.sh` to wire the two necessary exact four-metric gates.
- Explicit exclusions: do not touch `packages/backtest-tools/vitest.ccxt-provenance.config.mjs`, any CCXT/dependency/lock/documentation file, `.gitignore`, runtime/business/API behavior, or any other dirty path.
- Package count: root scripts plus bot, exchange, and backtest-tools cleanup; multi-package architecture Terra trigger.
- Domain risk: tooling/repository hygiene only; no live/trading/risk semantics. Deletions are recovery-safe in the isolated frozen union and source main remains untouched.
- Reasoning shape: remove proven disconnected/duplicate/scratch graph, then connect both retained configs through named package scripts and root coverage orchestration with isolated reports.
- External/mutable resources: isolated local worktree/test outputs only; no network/live/external writes/dependency change.
- Review role: non-review; independent final TECH and PROCESS required.
- Route: mandatory `terra_worker`, `gpt-5.6-terra` / high, workspace-write; effective model/effort not observable; no fallback.
- Validation: pre/post exact path/reference inventory; four split kill-switch tests; bot manifest contract and governed unit; both new named exact S/B/F/L=100 package gates; exchange tests/typecheck; coverage-tools typecheck; root coverage orchestration characterization; lint0/Prettier/diff/LOC/secret/legacy/unused-file scans; frozen non-owned equality and clean index. No new file, threshold/ignore weakening, stage, commit, self-review, or delegation.

Cleanup implementation attempt 1: BLOCKED before deletion. The retained exchange gate is already exact 100% S/B/F/L (36 tests). The retained bot config gate runs 47/47 but has one uncovered branch (68/69 = 98.55%); cleanup ownership cannot edit `config*.test.ts`. All temporary wiring edits were reverted, and no deletion/stage/commit remained. The existing D-02 coverage writer owns the config tests and must close this public branch first; then cleanup may be redispatched unchanged.

Status: CLEANUP WAITING FOR BOT CONFIG EXACT BRANCH CLOSURE.

Cleanup implementation attempt 2 result: OWNED CHANGES COMPLETE, review pending. Deleted the duplicate wrapper, exact 27-file disconnected arb graph, ten exclusive configs, and two proven scratch files. Added the two named package coverage scripts and root coverage wiring. Bot config gate 48/48 and exchange gate 36/36 are exact 100% S/B/F/L; four split kill-switch suites total 45 tests; formatting, diff, deletion/reference, index, secret/TODO and LOC checks pass.

Two cross-owner typecheck blockers remain and were not modified by cleanup: the active D-02 E2E start driver imports removed logging-redirection exports/old arity; exchange adapter test support adds unknown `copy` to `OrderBook`. Exact correction briefs and gates are required before cleanup TECH/PROCESS review; no cleanup commit/staging yet.

Status: CLEANUP OWNED GREEN, CROSS-OWNER TYPE INTEGRATION PENDING.

## Cross-owner type integration audit dispatch

- Task class: read-only diagnosis/design for two exact TypeScript integration failures exposed by cleanup gates.
- Mode: read-only, non-review.
- Exact scope: `apps/bot/test/e2e/runtime-driver/cli-boundaries-d02-start.ts` and its current start/logging public seams/tests; `packages/exchange/src/bybit-eu-adapter.test-support.ts`, the canonical `OrderBook` type/factories and adapter tests; current typecheck configs only.
- Package count/domain: bot E2E plus exchange test support, multi-package/public-boundary Terra trigger; test/support only, no live/order behavior.
- Reasoning shape: map removed exports/arity to current structured logger seam without compatibility resurrection; map obsolete `copy` fixture field to exact current `OrderBook` contract or prove it should be removed. Produce exact minimal write ownership, TDD and gates.
- External/mutable resources: local read-only inspection/typecheck only; no network/live/write/stage/commit.
- Review role/route: non-review, mandatory `terra_reader` high, no fallback.
- Required output: exact code-level target and behavior-preservation proof, no new file/cast/disable/legacy alias, every touched file <=500, then implementation/review brief.

Cross-owner type audit result: COMPLETE. Both failures are test/support drift only. The bot driver still imports three removed console-redirection exports, calls `runHeadless` with the obsolete two-argument shape, and leaves a callback parameter implicit; the current seam is explicit `RuntimeLogger` injection. The exchange fixture adds a non-contract `copy` member to `ccxt.OrderBook`; its sole consumer test must assert only the six canonical fields. No production, live, logging, adapter, compatibility, dependency, or public API change is needed.

## Cross-owner type integration implementation dispatch

- Task class: bounded test/E2E-support integration repair; write, non-review.
- Exact ownership: `apps/bot/test/e2e/runtime-driver/cli-boundaries-d02-start.ts`; `packages/exchange/src/bybit-eu-adapter.test-support.ts`; `packages/exchange/src/bybit-eu-adapter.test.ts` only.
- Package count/domain risk: bot E2E plus exchange test support, two packages and current public seams; Terra multi-package trigger. No trading/order/live behavior or dependency change.
- Reasoning shape: remove obsolete test-only compatibility assumptions and use the already-public structured logger and canonical CCXT `OrderBook` contract; no new behavior or file.
- External/mutable resources: isolated D02 union worktree and local test outputs only; no network, live system, external write, dependency install, stage, or commit.
- Review role: non-review; independent final TECH and PROCESS follow the complete cleanup/D02 union.
- Route: mandatory `terra_worker`, configured `gpt-5.6-terra` / high, workspace-write; effective model/effort profile-pinned but not observable; no fallback.
- Required implementation: inject a typed shutdown-capable `RuntimeLogger`, supply it to `createStartCommand` and both `runHeadless` crash calls, remove the three obsolete export imports and their file/console-redirection assertions while retaining public exit-code assertions; remove the test fixture `copy` field/helpers/calls and assert the exact canonical six-field order book value.
- Validation: reproduce the recorded 5 bot and 3 exchange TypeScript errors, then run bot E2E typecheck/runtime driver, exchange typecheck and exact adapter coverage, cleanup exact config gate, scoped lint0/Prettier/diff/LOC/reference/legacy scans, clean index. No cast, disable, compatibility alias, production edit, new file, stage, commit, self-review, or delegation.

Cross-owner type integration implementation result: DONE within the exact three files. Bot coverage-tools typecheck and exchange package typecheck pass. The retained exact bot config gate is 48/48 with S138/B67/F22/L137; exchange adapter is 36/36 with S21/B16/F17/L21. Scoped ESLint0, Prettier, diff check, clean index, obsolete console/copy reference scans and LOC 154/102/446 pass. The only remaining independent blocker is the governed bot E2E runtime-inclusion drift described below; it is not a failure in these three files.

## D02 E2E runtime inclusion audit dispatch

- Task class: read-only diagnosis of governed E2E runtime/build inclusion drift after the test-support integration repair.
- Mode: read-only, non-review.
- Exact scope: the three reported dry-run runtime modules, `scripts/coverage-tools/bot-runtime-scope.json`, its contract/test and build/E2E coverage scripts, current E2E driver import graph and canonical case manifest; no writes.
- Package count/domain risk: bot package plus root coverage tooling; multi-package architecture/evidence integrity Terra trigger. No live/trading/risk behavior change.
- Reasoning shape: trace why the modules are declared yet absent from the instrumented E2E graph, distinguish a missing scope-manifest row from a missing public driver execution/import, and produce the smallest exact ownership/TDD/gate brief without false coverage or duplicate entrypoints.
- External/mutable resources: local read-only files and non-mutating coverage/listing commands only; no network, external writes, stage, commit, dependency install.
- Review role/route: non-review, mandatory `terra_reader`, configured `gpt-5.6-terra` / high, read-only; no fallback.
- Required output: reproduced failing command, exact root cause/data flow, exact files and change needed, public behavior/canonical IDs to execute, validation and LOC/no-extra-file proof. No threshold/scope weakening, compatibility alias, generated/scratch file, or production semantic change.

D02 E2E runtime inclusion audit result: COMPLETE. The three dry-run runtimes are already governed in `bot-runtime-scope.json`; the hard failure proves that the E2E bundle does not reach them. `runtime-driver.ts` still routes canonical case `runtime-driver:cli-command-boundaries` through the legacy aggregate in `cli-boundaries.ts`, while the D02 split `cli-boundaries-config.ts` is unimported and is the only graph path to the three modules. No manifest, scope, builder, runtime source, case ID, or new entrypoint change is needed.

## D02 E2E split-driver import repair dispatch

- Task class/mode/route: one-file E2E import-graph integration fix; write, non-review; one bot package but governed coverage integrity, mandatory `terra_worker` high route.
- Exact ownership: `apps/bot/test/e2e/runtime-driver/runtime-driver.ts` only.
- Predetermined change: retain `runCliBoundaries` from `./cli-boundaries.js`, import `runCliCommandBoundaries` from `./cli-boundaries-config.js`, and leave the canonical case ID/switch behavior unchanged. Do not modify the manifest, build/run tooling, dry-run production, drivers, case IDs, or add a file/test.
- TDD: recorded RED is the current `coverage:bot:e2e` missing-owned-files hard failure. GREEN must pass that build-inclusion check and execute the existing canonical boundary case; the builder itself is the regression contract.
- Validation: bot E2E typecheck, governed E2E exact 100% S/B/F/L, coverage scope, scoped lint0/Prettier/diff/LOC/reference/legacy scans and clean index. No threshold/scope weakening, alias, stage, commit, self-review, or delegation.

D02 E2E split-driver import repair result: DONE in the exact one file. The static bundle now includes the three governed dry-run runtimes and begins canonical case execution. Coverage-tools typecheck, coverage scope, scoped lint0, Prettier, diff, clean index, reference/legacy scans and LOC 189 pass. The full E2E run exposes a later independent fixture failure described below.

## D02 lifecycle-smoke strict-config audit dispatch

- Task class: read-only diagnosis of a canonical E2E fixture rejected by strict current config schema.
- Mode: read-only, non-review.
- Exact scope: the failing `lifecycle-smoke` driver and its fixture builders, current `BotConfig`/strategy section schema, the D02 CLI/config boundary drivers, canonical case manifest and error output; no writes.
- Package count/domain risk: one bot package but config/runtime E2E contract, Terra data-integrity trigger. No live/exchange/order behavior change.
- Reproduced symptom: `coverage:bot:e2e` reaches runtime execution, then Zod rejects unknown `strategies.dydx_cex_carry` keys `custom_string`, `custom_number`, `custom_boolean`, `custom_array`, `custom_object`, `custom_undefined`, and `custom_null`.
- Reasoning shape: trace the stale fixture source and intended assertion, decide whether those values belong to a read-only config-rendering boundary rather than runtime lifecycle input, and produce the smallest exact test/driver-only repair that uses a schema-valid config without weakening strict validation or deleting meaningful coverage.
- External/mutable resources: local read-only inspection and non-mutating test commands only; no network/live/external write/stage/commit.
- Review role/route: non-review, mandatory `terra_reader`, configured `gpt-5.6-terra` / high, read-only; no fallback.
- Required output: exact root cause, exact owned file(s), retained behavior/case IDs, TDD/gates/LOC/no-unused proof. No schema/runtime change, passthrough widening, invalid cast, threshold/scope weakening, compatibility path, new file, or duplicated case.

D02 lifecycle-smoke strict-config audit result: COMPLETE. The lifecycle fixture itself is valid. Static evaluation reaches top-level fake configs in `cli-boundaries-d02-readonly.ts` before the selected case; seven `custom_*` fields violate the intentionally strict strategy schema. Two other active CLI drivers carry the same stale passthrough assumption. Generic passthrough was never valid current behavior; schema/runtime/manifest/tool changes are unnecessary.

## D02 strict fake-config repair dispatch

- Task class/mode/route: three-file E2E fixture repair; write, non-review; one bot package with strict configuration/data-integrity seam, mandatory `terra_worker` high route.
- Exact ownership: `apps/bot/test/e2e/runtime-driver/cli-boundaries-d02-readonly.ts`, `cli-boundaries-d02-config-command.ts`, and `cli-boundaries.ts` only.
- Predetermined change: construct every rich fake config through `BotConfigSchema.parse` and only strict allowed fields. D02 readonly uses enabled/cap/leverage/symbols plus htf/mtf/ltf on `dydx_cex_carry`; config-command imports the schema and applies the same legal override over its default; legacy boundary imports the schema and replaces its rich section with legal `donchian_pivot_composition` enabled/cap/leverage/symbols/timeframes. Delete all `custom_*` fields and no equivalent passthrough assertion. Preserve canonical case IDs, lifecycle/start/state/config show/validate behavior and expected legal field rendering.
- TDD: existing governed E2E unknown-key failure is RED. GREEN must load the bundle, execute canonical `lifecycle-smoke`, `cli-command-boundaries`, and `cli-boundaries`, and reach exact E2E coverage without schema widening.
- Validation: bot E2E typecheck, governed E2E and unit exact 100% S/B/F/L, coverage scope, scoped lint0/Prettier/diff/LOC/reference/custom-key/unused scans, clean index.
- Prohibitions: no schema/runtime/manifest/tool/production change, cast, invalid config, threshold/scope weakening, compatibility output, new file, stage, commit, self-review, or delegation.

D02 strict fake-config repair result: DONE in the exact three drivers. All rich fakes are now constructed through `BotConfigSchema.parse` with only allowed fields; `custom_*` is absent. Bot E2E typecheck passes and all 63 canonical E2E cases pass. The prior import-time Zod failure is closed. The governed gate now reaches its next genuine failure: E2E coverage S 3544/3715 (95.39%), B 1813/2125 (85.31%), F 694/708 (98.02%), L 3345/3477 (96.20%). No schema/runtime/manifest/tool change occurred.

Status: CLEANUP IMPLEMENTATION FUNCTIONALLY INTEGRATED; D02 EXACT E2E COVERAGE STILL PENDING.
