# Validation and Evidence Plan — DRAFT

**Status:** DRAFT. The target-refactor gates below are not claimed to have
passed. Observed Phase 1 Slice A command evidence is recorded separately below;
it does not complete the target architecture, coverage, release, or review
gates.

## Required gate matrix

| Gate                  | Required evidence                                                                                                                                                                                                                                                                              | Current status                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting            | `bun run format:check`, exact Prettier config, no changes.                                                                                                                                                                                                                                     | Current Slice B working tree: PASS, recorded below. Final target-architecture/full-verify formatting evidence remains NOT YET IMPLEMENTED/EVIDENCED and must be rerun after future changes.          |
| Linting               | Flat ESLint strict/stylistic/security/unicorn config, `--max-warnings=0`.                                                                                                                                                                                                                      | NOT YET EVIDENCED; current root ESLint exists but target compliance is unproven.                                                                                                                     |
| Type safety           | Strict TS 6 project/package typechecks with compile-time tests.                                                                                                                                                                                                                                | NOT YET EVIDENCED for target architecture.                                                                                                                                                           |
| Build                 | Deterministic package/app builds with declared outputs.                                                                                                                                                                                                                                        | NOT YET EVIDENCED; current packages report ts-only placeholder builds.                                                                                                                               |
| Unit coverage         | Separate per-runtime-scope report: 100% statements/branches/functions/lines.                                                                                                                                                                                                                   | NOT YET EVIDENCED.                                                                                                                                                                                   |
| E2E coverage          | Separate per-runtime-scope report: 100% statements/branches/functions/lines.                                                                                                                                                                                                                   | NOT YET EVIDENCED.                                                                                                                                                                                   |
| Architecture          | Workspace-package plus external dependency import allowlists, consumer-owned ports, no cycles/deep imports/test-support production imports, manifest/lockfile/import-graph agreement, negative fixtures, file limit.                                                                           | NOT YET IMPLEMENTED/EVIDENCED.                                                                                                                                                                       |
| Data integrity        | DTO guard, canonical numeric/OHLCV/provenance negative tests, D-04 `ResearchDataContract@1` public `fetchOHLCV` wrapper fakes, own-catalog/provider-ID/raw-escape/reflection/private-method rejection, rate-cost contract, bounded pagination/finality/atomic-write and offline network guard. | NOT YET EVIDENCED.                                                                                                                                                                                   |
| Live safety           | Exact 10x, exact baseline/valuation/exposure accounting, central RiskGate, immutable guarded config startup, and authenticated Bybit EU negative tests.                                                                                                                                        | NOT YET EVIDENCED; current semantics conflict with target.                                                                                                                                           |
| Security/supply chain | Frozen install, audit, trusted dependency allowlist, secret scan, SBOM/license, machine-readable audit evidence with tool/version/timestamp/lockfile hash/result.                                                                                                                              | Slice A frozen-install and local lifecycle inspection are observed; `bun audit` baseline exited 1 with `ConnectionRefused`, so vulnerability, license, SBOM, and release proof remain NOT EVIDENCED. |
| Release               | Exact Node `24.19.0` launcher gate for initial `linux-x64`, two clean byte-identical builds, per app/target manifest/hash/SBOM/license/audit and offline smoke.                                                                                                                                | NOT YET IMPLEMENTED/EVIDENCED.                                                                                                                                                                       |
| Documentation         | HU/EN Markdown parity, link checks, local licence-verified icon inventory, local-asset HTML interaction/accessibility checks.                                                                                                                                                                  | NOT YET IMPLEMENTED/EVIDENCED.                                                                                                                                                                       |
| Reviews               | Independent Terra technical + Luna process review, fixes, independent re-reviews.                                                                                                                                                                                                              | NOT YET EVIDENCED for final refactor.                                                                                                                                                                |

## Proposed root verification order

The future complete `bun run verify` must execute and report, in order: frozen/install integrity
precondition; format check; lint; typecheck; architecture/file-length checks;
build; unit coverage; E2E coverage; data/live safety integration tests;
dependency/security/license checks; docs checks; release assembly; per-target
offline artifact smoke. It must fail on the first blocking gate while retaining
enough structured output to identify scope. That full command is
**NOT YET IMPLEMENTED/EVIDENCED** and must not be named or advertised as
available. The current `bun run verify:foundation` is an explicitly incomplete
foundation runner only.

The implementation gate must reject a non-exact external dependency, a Node or
Bun engine range, `bunfig.toml` `install.exact = false`, or external use of
`workspace:*`. It must compare manifest, lockfile, import graph, recorded
version matrix, and SBOM. It also must re-inspect Lefthook's exact-install
binary/lifecycle/platform metadata and prove Lefthook is absent from
`trustedDependencies`; the recorded Bun default-trust baseline is not a
substitute. After that frozen-install gate, an isolated
temporary Git clone/repository alone runs `lefthook install`; validation
inspects its generated hook path/content/launcher and proves a real pre-commit
subprocess runs `ESLint -> Prettier -> clean:artifacts -> worktree inspection`
with fail-fast/exit propagation. It must prove absent/untrusted binary rejection
and no main-worktree `.git/hooks` mutation. CI validates configuration and the
pipeline contract without installing hooks. Separately, bootstrap docs and a
bootstrap smoke contract require a human/operator, only after a successful
frozen install and only in their own clone, to run the exact repo-local
`./node_modules/.bin/lefthook install` command, inspect
the hook, and prove deterministic uninstall/reinstall. This is not automatic
postinstall, CI, or agent evidence without separate authority.

The Phase 1 matrix rejects the invalid `@eslint/js` `10.8.1` and Unicorn
`72.0.0` values. It requires registry-evidenced `@eslint/js` `10.0.1` peer
`eslint ^10.0.0` with exact `eslint` `10.8.1`, and Unicorn `73.0.0`.

It must also enforce guarded dependency sequencing: `fraction.js` only after
Phase 2 exact-arithmetic/property/public-API evidence; Zod only after Phase 3
DTO/guard consumer and boundary evidence; CCXT only after Phase 3
`PublicHistoricalClient` fail-closed/no-network contract and Phase 4 Bybit EU
exact-10x/eligibility/borrow safety evidence, as a distinct pre-Phase-5 change.
The current baseline `bun audit` result is **NOT EVIDENCED** because its
2026-08-17 re-run exited 1 with `ConnectionRefused`; `bun pm untrusted` 0 is
not a substitute for the required frozen-install audit/license/SBOM proof.

## Coverage interpretation

Coverage is accepted only when it names the exact runtime owners and exclusions;
declarations/static data may be excluded only when they contain no owned runtime
behavior and the reason is documented. Unit and E2E runs are isolated, not
merged to mask a gap. Every package/app scope must report four independent
100% measures at both levels. No ignore directive or threshold workaround is
acceptable.

## Live invariant test catalog

The target test suite must prove all of the following before any live claim:

- construction rejects every selected leverage except exactly `"10"`, including
  numeric, range, maximum, default, fallback, dynamic and per-symbol/strategy
  alternatives;
- each pre-submit authenticated response is required and fresh: EU account,
  UTA Spot Margin, supported assets/symbol, allowed margin mode, successful 10x
  selection, borrowing capacity and unambiguous account state;
- any absent/stale/ambiguous/unsupported/ineligible/failed verification results
  in a typed rejection and zero exchange submit calls;
- selected 10x, actual borrowed amount, and effective leverage are distinct,
  immutable audit values and reconciliation detects mismatch;
- canonical exact `"1000"` starting equity and `"10000"` initial gross
  exposure carry authoritative valuation UTC timestamp/source; gross exposure
  equals absolute position notionals plus worst-case executable active orders;
  positive and negative activation/reconciliation cases cover every mismatch;
- a single typed/audited consumer-owned RiskGate executes before every exchange
  action in live, paper and backtest modes, validates leverage/exposure/
  concentration/drawdown/price/quantity/balance/kill-switch state, and negative
  architecture/E2E fixtures prove an invalid action makes zero adapter calls;
- live startup accepts only unknown versioned DTO input, fully guards it once,
  stores an immutable snapshot, reads environment once, has no defaults or
  automatic repair, and fails closed without credentials/operator confirmation;
- D-04 data ingestion accepts only public provider discovery/metadata and actual
  `fetchOHLCV` preflight under `ResearchDataContract@1`; missing capability,
  invalid range, silent fallback, private/account/credential/order/cancel/
  borrow/margin/paper/live access, JS-number canonical loss, pagination/retry
  overflow, gap/duplicate/finality failure, or atomic-write failure blocks
  ingestion/backtest; and deterministic offline E2E makes zero provider calls;
- D-04 wrapper/authority tests reject non-primitive/confusable/prototype provider
  IDs, inherited/unknown catalog lookup, raw CCXT escape, dynamic/bracket method
  calls outside the audited factory, `Reflect`/`Proxy`/`eval`/`Function`, private
  property access, generic forwarding, and private/order/cancel paths;
- D-04 rate/cost tests require endpoint/region/terms/rate/request/page/time/
  retry/cost dry-run fields, reject paid/material-cost or credential paths and
  unbounded/automatic/background calls, and prove CI/test paths have no network;
- stable client order IDs remain identical across retries and uncertain state
  reconciles before further operation; and
- reduce-only/emergency exit stays exactly 10x and cannot bypass unrelated
  guard checks.

## Review closure procedure

After the final full gate, a `terra_reviewer` independently examines objective,
diff, target architecture, tests/coverage, exact-numeric/data/live boundaries,
security/dependencies, release artifacts, and evidence. A
`luna_process_reviewer` independently examines routing, brief accuracy, scope,
ownership, approvals, failures/retries, and required reviews. Every valid
finding is fixed by a non-review implementer and both reviews are independently
rerun. Final status is PASS only with zero open valid findings.

## Plan-package self-validation

Before handing this draft to implementation, run:

```sh
for file in plans/full-refactor/*.md; do git diff --no-index --check /dev/null "$file" >/dev/null; check_exit=$?; test "$check_exit" -le 1 || exit "$check_exit"; done
for name in README GOAL ARCHITECTURE MIGRATION DECISIONS APPROVALS RISKS ROLLBACK DEPENDENCIES SCRIPTS ARTIFACTS VALIDATION EXECUTION-RECORD FAILURE-RETRY REVIEW-EVIDENCE; do test -f "plans/full-refactor/$name.md" || exit 1; rg -q "^# .*DRAFT" "plans/full-refactor/$name.md" || exit 1; done
git diff --check -- plans/full-refactor
for decision in D-01 D-02 D-03 D-04 D-05 D-06 D-07 D-08 D-09; do rg -Fq "| $decision | APPROVED |" plans/full-refactor/APPROVALS.md || exit 1; done
if rg -Fn '| D-' plans/full-refactor/APPROVALS.md | rg -F '| PENDING |'; then exit 1; fi
rg -n "exactly 10x|Bybit EU|100%|offline|zero-legacy|Lefthook|Node|RiskGate|1000|10000|run-bot|icon|ResearchDataContract|fetchOHLCV|CCXT Pro|private-method" plans/full-refactor
```

These checks prove presence and draft consistency only; they do not prove the
repository refactor, safety, compatibility, or deployment target.

## Slice C1 package evidence status

Current C1 evidence is closed by the independent, slice-scoped RE-040 TECH PASS
and RE-041 PROCESS PASS, not a repository PASS. The reproducible package maximum-line command is
`wc -l packages/paper/src/paper-trader.test.ts`, run from the repository root;
at `2026-08-17T23:35:27+0200` it exited 0 with
`440 packages/paper/src/paper-trader.test.ts`. The current maximum is therefore
440, within the 500-line limit. ER-029 and RE-038 supersede the earlier
inaccurate maximum statement.

For future slices, the user requires continuous commits only after the slice
has independently closed both required reviews. ER-031 records that the first
authorized commit aggregates the already reviewed Slice A–C1 work because
commit authority arrived only now; future independently closed slices commit
separately.

## Phase-terminal zero-legacy scanner gate

This is not a current plan-package self-check. After the approved P5/P6
migration, the scanner defined in `ARCHITECTURE.md` must execute its versioned
target-root configuration and exact evidence-only allowlist, then run:

```sh
test ! -e docs/legacy
test ! -e bin
test ! -e run-bot
test ! -e search-best-config
```

It must additionally prove that no legacy file/directory/import/export/route/
command/runtime/config/current-doc reference/served asset/compatibility shim
exists within the declared terminal roots. This is semantic scanning, not a
global word scan; negative fixtures prevent excluded evidence paths from being
imported, executed, configured, routed, or served.

## Superseded local implementation observation — 2026-08-17T21:55:11+0200

**Historical, superseded by reviewer-reproduced results below.** These local
command results cover only Slice A ownership and do not close Phase 1, coverage,
release, or repository verification gates.

| Command or evidence                                                                                         | Result                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun test scripts/tooling/*.test.ts`                                                                        | PASS: 9 tests, 63 assertions; includes order/fail-fast, exact-pin/lifecycle contract, non-Git/nested-root, final/intermediate symlink, dry-run, allowlist, and idempotency fixtures. |
| `bun run typecheck:coverage-tools`; `bunx eslint scripts/tooling eslint.config.js --max-warnings=0`         | PASS. Exact-line security rationales are covered by the corresponding path-safety fixtures; no broad tooling disable remains.                                                        |
| `bun run clean:artifacts:dry-run`; `bun run hook:validate`; `node_modules/.bin/lefthook validate`           | PASS. Dry-run listed only allowlisted artifact paths; no deletion and no Git-hook installation occurred.                                                                             |
| `bun install --ignore-scripts`; `bun install --frozen-lockfile`                                             | PASS as recorded in `DEPENDENCIES.md`; the first updated the lock without lifecycle execution, the second checked 257 installs/284 packages with no changes.                         |
| `bun run typecheck`; `bun run build`                                                                        | PASS: 12/12 typecheck tasks and 7/7 build tasks. Turbo emitted existing no-output task warnings.                                                                                     |
| `bun run format:check`; `bun run lint`                                                                      | Historical local counts are superseded; use the reviewer-reproduced authoritative failure record below.                                                                              |
| Historical `bun run verify`                                                                                 | **SUPERSEDED / NOT PASS**: replaced by explicitly incomplete `verify:foundation`; future complete `verify` remains unavailable.                                                      |
| `git diff --check`; untracked-safe whitespace loops; `test ! -e bin`; `test ! -e scripts/install-mm-bot.sh` | PASS at recording time.                                                                                                                                                              |

## Authoritative reviewer-reproduced full-gate failure record

**DRAFT; PENDING PROCESS RE-REVIEW.** This is the single source of truth for
current full-gate failure counts. It supersedes the local counts above without
asserting a repository implementation PASS.

| Command                     | Exit | Result                                                                                                        |
| --------------------------- | ---: | ------------------------------------------------------------------------------------------------------------- |
| `bun run format:check`      |    1 | **375 files** require formatting.                                                                             |
| `bun run lint`              |    1 | **8,289 problems**: **7,762 errors** and **527 warnings**.                                                    |
| Historical `bun run verify` |    1 | **SUPERSEDED / NOT PASS**; the root verification gate remains incomplete and is now deliberately unavailable. |

## Current Slice A second-remediation observation — 2026-08-17T22:10:26+0200

**DRAFT; PENDING TECHNICAL AND PROCESS RE-REVIEW.** The reviewer-reproduced
full-gate record above remains historical comparison evidence. This local
second-remediation run produced the following additional observations and does
not claim an implementation PASS:

| Command / evidence                                                                             |                                                                                                                                                                                                                                                          Exit / result |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| `bun test scripts/tooling/*.test.ts`                                                           |                                                                            0; **14 tests**, **77 assertions**. Covers exact pins, Lefthook-not-trusted/no-auto-activation, ordered/fail-fast/all-green verify runner, direct CLI surface, and cleaner safety fixtures. |
| `bun test apps/bot/src/cli/router.test.ts apps/bot/src/cli/commands/start-log-routing.test.ts` |                                                                                                                                                                                  0; **31 tests**, **95 assertions**. Help output uses `bun run apps/bot/src/index.ts`. |
| Targeted Prettier check                                                                        |                                                                                                                                                                                                                                       0 for all changed Slice A files. |
| Targeted tooling ESLint                                                                        |                                                                                                                                                                         0 with `--max-warnings=0` for `verify.ts`, `verify.test.ts`, and `toolchain-contract.test.ts`. |
| Touched app ESLint                                                                             |                                                           1; 38 errors. `router.test.ts` and `start-log-routing.test.ts` are outside the configured project service; `router.ts` and `start.ts` retain strict-Unicorn backlog. No ignore or rule relaxation was added. |
| `bun run hook:validate`; `bun run clean:artifacts:dry-run`                                     |                                                                                                                                                                 0; config contract valid; dry-run enumerated only explicit artifact targets and performed no deletion. |
| `bun run typecheck`; `bun run build`                                                           |                                                                                                                                                                               0; typecheck 12/12 tasks and build 7/7 tasks; Turbo emitted existing no-output warnings. |
| Historical `bun run verify`                                                                    | 1; superseded by the explicitly incomplete foundation runner. This local run reported **370 files** needing formatting, after formatting five changed files; it is not a full-repository PASS and does not silently replace the reviewer-reproduced historical record. |
| Isolated normal frozen install                                                                 |                                                                                                      0 as recorded in [`DEPENDENCIES.md`](DEPENDENCIES.md#current-isolated-clean-install-evidence--2026-08-17t2210260200); temp hooks unchanged; main hooks untouched. |

## Current third-remediation foundation observation — 2026-08-17T22:10:26+0200

**DRAFT; PENDING TECHNICAL AND PROCESS RE-REVIEW.** `verify:foundation` is
not the complete required verification contract and CI invokes it under that
explicitly limited name only. It runs currently implemented foundation gates in
order and fails at the first failure; the complete `bun run verify` remains
unavailable until frozen/install integrity, architecture/file-length, data/live
safety, dependency/security/license, docs, release, and artifact-smoke gates
exist and are independently reviewed.

| Command / evidence                         |                                                                                                                                                                                                                Exit / result |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| `bun install --ignore-scripts`             |                                                0; Bun regenerated `bun.lock` so `trustedDependencies` exactly serializes only `ccxt`; current SHA-256 is `442b050e7922a89ecba1ca262d5a8c869de771af068ffd19e94d0a10a8407b40`. |
| New representative normal frozen install   | 0 as recorded in [`DEPENDENCIES.md`](DEPENDENCIES.md#current-representative-clean-install-evidence--2026-08-17t2210260200); Lefthook lifecycle was blocked/untrusted and temp/main hook inventories were equal before/after. |
| `bun run verify:foundation`                |                                                                                 1; correctly fails fast at `format:check`, which reported **358 files** requiring formatting. It cannot establish full verification success. |
| Historical touched active CLI ESLint rerun |                                                                                                      **SUPERSEDED**: the unexplained narrower **166 problems** result is replaced by the explicit recursive CLI scope below. |

## Current explicit active-CLI lint evidence — 2026-08-17T22:28:38+0200

**DRAFT; FAIL / NOT PASS; PENDING TECHNICAL AND PROCESS RE-REVIEW.** From
`/home/eggp/projects/mm-crypto-bot`, the exact command
`bunx eslint apps/bot/src/cli --max-warnings=0` recursively checked active CLI
source and test files under that directory. It exited 1 with **221 problems**:
**215 errors** and **6 warnings**. The output includes project-service parsing
errors for CLI test files and the existing strict-Unicorn/security backlog. No
rule disable, ignore, generated exclusion, or trading-logic change was made.

## Current Slice B evidence remediation — 2026-08-17T22:49:06+02:00

**DRAFT; FAIL / NOT PASS; PENDING TECHNICAL AND PROCESS RE-REVIEW.** The
current Slice B working tree is formatted, but that is not evidence that the
final target architecture or the future complete `bun run verify` formatting
gate will remain formatted after later migration phases. It must be rerun at
each material change and at final release evidence collection.

| Evidence                                                     | Current result                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Working-tree formatting                                      | `bun run format:check` exited 0 for the current Slice B worktree.                                                                                                                                                                                                   |
| Final target-architecture / complete verification formatting | **PENDING / NOT PASS**. The complete verification contract is unavailable and later architecture, data, documentation, and release changes will require a fresh format check.                                                                                       |
| Broad test observation                                       | `bun run test` exited 1; its observed summary was 235 pass and 12 fail in `@mm-crypto-bot/backtest-tools`. The failures are **UNCLASSIFIED / NOT PASS**. The output's references to real CSV fixtures are context only and do not certify a cause or pre-existence. |
| Root lint observation                                        | One current `bun run lint` execution exited 1 with 8,812 problems: 8,227 errors and 585 warnings. This remains **FAIL / NOT PASS**.                                                                                                                                 |

### Full Slice B 500-line structural backlog

At `2026-08-17T22:49:06+02:00` Europe/Budapest, from
`/home/eggp/projects/mm-crypto-bot`, the pre-write Slice B selection contained
358 first-party text/source/docs/config files and is persisted at
[`evidence/slice-b-selected-files.txt`](evidence/slice-b-selected-files.txt).
The existing Prettier exclusions
were preserved: generated/vendor/cache (`node_modules`, `dist`, `build`,
`coverage`, `.turbo`), `data/`, `temp/`, and
`search-best-config/results/`; the selection contained zero excluded paths.

The exact replay command used that recorded pre-write selection (one path per
line) and emits sorted `path<TAB>lines` records:

```sh
set -o pipefail; while IFS= read -r scoped_file; do if [[ ! -f "$scoped_file" ]]; then printf 'MISSING_SELECTED_FILE\t%s\n' "$scoped_file" >&2; exit 41; fi; line_count=$(wc -l < "$scoped_file"); if (( line_count > 500 )); then printf '%s\t%s\n' "$scoped_file" "$line_count"; fi; done < plans/full-refactor/evidence/slice-b-selected-files.txt | LC_ALL=C sort
```

It exited 0 and found **100** files over 500 lines. The full sorted output is
[`evidence/slice-b-over-500-files.tsv`](evidence/slice-b-over-500-files.tsv).
This is a structural **FAIL / deferred backlog**, not a Slice B resolution.
Under zsh, `pipefail` prevents the final `sort` from masking a failed left
side; missing selected files write the marker to stderr and exit **41**.
The reported 104-entry expectation is not reproduced by this exact 358-file
selection: the current 375-file shared changed-text set yields 103, including
three >500-line active CLI files that were already changed by Slice A and were
not in the pre-write Slice B list. No scope was narrowed to obtain the 100.

### Bounded secret-material scan

At `2026-08-17T22:50:31+02:00` Europe/Budapest, from the same CWD, the scan
selected 375 existing current changed first-party text files using
`git diff --name-only`, excluding `data/`, `temp/`,
`search-best-config/results/`, vendor/generated/cache paths, and
`plans/full-refactor/evidence/`. It scanned only these categories and printed
only `category<TAB>filename<TAB>count`, never matched values: AWS access-key
shape, private-key header, GitHub-token shape, and Slack-token shape.

```sh
git diff --name-only -- . | awk '/^(data|temp|search-best-config\/results|plans\/full-refactor\/evidence)\// {next} /(^|\/)(node_modules|dist|build|coverage|\.turbo)\// {next} /\.(ts|tsx|js|mjs|cjs|mts|cts|md|html|css|json|toml|ya?ml)$/ {print}' | LC_ALL=C sort
```

The full scanner consumes that selection on standard input; it prints only
`category<TAB>filename<TAB>count` and never the matching value:

```sh
node -e 'const fs=require("fs"); const files=fs.readFileSync(0,"utf8").split("\n").filter(Boolean).filter(fs.existsSync); const rules=[["aws-access-key",/\bAKIA[0-9A-Z]{16}\b/g],["private-key-header",/-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/g],["github-token",/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],["slack-token",/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g]]; let matches=0; for (const file of files) { const value=fs.readFileSync(file,"utf8"); for (const [category, expression] of rules) { const count=(value.match(expression)||[]).length; if (count) { console.log(`${category}\t${file}\t${count}`); matches+=count; } } } process.exitCode=matches ? 2 : 0;'
```

The selection command exited 0; the scanner exited 0 with **0 category rows**.
Exit 0 means no selected-file category match; exit 2 means one or more matches
and is a blocker requiring redacted handling; any other non-zero exit means
the scan is NOT EVIDENCED. This is not a comprehensive repository secret audit,
and it does not replace the required final security and supply-chain gates.

## DRAFT: Slice C3a durable engine-test-name preservation evidence

At `2026-08-18T00:34:30+02:00` Europe/Budapest, from
`/home/eggp/projects/mm-crypto-bot`, the durable proof compared the declared
baseline scope at commit `2c4e6f3fc103c9c2f2a49fe9bdaf9cac84e02f8a` (four
engine test modules) with the seven current C3a engine test modules. The
replayable extractor is
[`evidence/c3a-extract-engine-test-names.mjs`](evidence/c3a-extract-engine-test-names.mjs).
It accepts only same-line literal double-quoted `it(...)` or `test(...)` calls;
any dynamic or unsupported matching call, unreadable baseline path, missing
current path, empty declared-scope module, or invalid selector throws and makes
the pipeline fail. It requires exactly one selector: `--baseline` or
`--current`; zero arguments exit **64**, an extra argument exits **65**, and an
invalid selector exits **66**. These negative paths only write diagnostics and
cannot mutate an evidence artifact. It preserves duplicate names before the
C-locale sort.

```sh
set -o pipefail
LC_ALL=C bun plans/full-refactor/evidence/c3a-extract-engine-test-names.mjs --baseline | LC_ALL=C sort | cmp -s - plans/full-refactor/evidence/c3a-engine-test-names.before.txt
LC_ALL=C bun plans/full-refactor/evidence/c3a-extract-engine-test-names.mjs --current | LC_ALL=C sort | cmp -s - plans/full-refactor/evidence/c3a-engine-test-names.after.txt
wc -l plans/full-refactor/evidence/c3a-engine-test-names.before.txt plans/full-refactor/evidence/c3a-engine-test-names.after.txt
sha256sum plans/full-refactor/evidence/c3a-engine-test-names.before.txt plans/full-refactor/evidence/c3a-engine-test-names.after.txt
cmp -s plans/full-refactor/evidence/c3a-engine-test-names.before.txt plans/full-refactor/evidence/c3a-engine-test-names.after.txt
```

Both replay pipelines exited 0; `wc -l` is **62 / 62**; the final `cmp` exited 0. Both evidence files have SHA-256
`fb966418a57ba105d6e13bb9edacb56a5d475c67c90e5d8558e6653a93a3227e` and are
[`before`](evidence/c3a-engine-test-names.before.txt) and
[`after`](evidence/c3a-engine-test-names.after.txt). This establishes only the
test-name multiset preservation for C3a; it is not an implementation or
coverage PASS.

The four new C3a files were separately checked with the untracked-safe form
below. For each file, `git diff --no-index --check /dev/null <file>` returned
exit **1** (the expected content-difference status) with **0 diagnostic bytes**:
`engine-confidence.test.ts`, `engine-execution-outcomes.test.ts`,
`engine-scenarios.test-support.ts`, and `engine-strategy-callbacks.test.ts`.

```sh
diagnostic=$(git diff --no-index --check /dev/null "$file" 2>&1)
rc=$?
test "$rc" -eq 1 && test -z "$diagnostic"
```

At `2026-08-18T00:40:02+02:00`, selector-negative replays confirmed the
fail-closed contract: no selector exited **64**, `--unsupported` exited **66**,
and `--current unexpected` exited **65**. The latter is the explicit
extra-argument regression replay. The existing baseline/current positive
replays stayed at exit 0, produced the same 62/62 lists, and retained the
same evidence-file hashes above.

At `2026-08-18T00:41:02+02:00`, untracked-safe whitespace checks for the
extractor and both durable list files each produced the expected exit **1**
with zero diagnostics. The zsh plan-package self-check and `git diff --check`
also exited **0**.

This evidence delta is **PENDING PROCESS RE-REVIEW**. It does not replace the
independent technical/process reviews required for C3a.

At `2026-08-18T00:36:34+02:00`, the documented plan-package self-check was
rerun under zsh with explicit expected-exit handling for untracked files and
exited **0**. A local Markdown file-link check also found **0 broken links**,
and `git diff --check` exited **0**. These are plan/evidence consistency checks
only and do not create an implementation PASS.

## DRAFT: Slice C3b fail-closed production and evidence validation

At `2026-08-18T01:10:30+02:00`, C3b used the repository CWD
`/home/eggp/projects/mm-crypto-bot`. The public engine export comparison is
implemented by the checked TypeScript-AST helper
[`evidence/c3b-verify-engine-exports.mjs`](evidence/c3b-verify-engine-exports.mjs),
not a regex. It accepts only the documented selector and arity, parses the
baseline engine through `git show`, resolves named local façade re-exports,
compares value/type kind, name, and generic arity, and fails closed for
unsupported exports, paths, or syntax. Its durable snapshots are
[`before`](evidence/c3b-engine-exports.before.tsv) and
[`after`](evidence/c3b-engine-exports.after.tsv).

```sh
bun plans/full-refactor/evidence/c3b-verify-engine-exports.mjs \
  --baseline fc2d602c1aef0798e29fd7df46861855ba7a0205 \
  > plans/full-refactor/evidence/c3b-engine-exports.before.tsv
bun plans/full-refactor/evidence/c3b-verify-engine-exports.mjs \
  --current packages/backtest/src/engine.ts \
  > plans/full-refactor/evidence/c3b-engine-exports.after.tsv
cmp -s plans/full-refactor/evidence/c3b-engine-exports.before.tsv \
  plans/full-refactor/evidence/c3b-engine-exports.after.tsv
bun plans/full-refactor/evidence/c3b-verify-engine-exports.mjs \
  --compare fc2d602c1aef0798e29fd7df46861855ba7a0205 \
  packages/backtest/src/engine.ts
```

Each command exited **0**; both snapshots have SHA-256
`3f1039d86a13c2c8c0de704ba8924fe28cfa16abeb443fc3698b140a548d5720`.
Negative controls exited nonzero without artifact mutation: no selector **64**,
extra argument **65**, unavailable baseline **67**, unavailable current path
**68**, and the intentional invalid parser fixture
[`c3b-invalid-engine-export.fixture.ts`](evidence/c3b-invalid-engine-export.fixture.ts)
**69**.

The checked manifest scanner
[`evidence/c3b-integrity-scan.mjs`](evidence/c3b-integrity-scan.mjs) consumes
the explicit regular-file-only manifest
[`evidence/c3b-integrity-paths.txt`](evidence/c3b-integrity-paths.txt). It
rejects missing, duplicate, outside-root, symlink, and non-file entries;
performs `git diff --no-index --check /dev/null <path>` for each tracked or
untracked entry, then `git diff --check -- <manifest paths>`; and records only
category/path/count if a bounded secret signature matches. It never emits a
matched secret value. Its scope is exactly the 17 current C3b production/test,
ledger, and evidence files in that manifest; it is not a repository-wide
secret audit.

```sh
bun plans/full-refactor/evidence/c3b-integrity-scan.mjs \
  --manifest plans/full-refactor/evidence/c3b-integrity-paths.txt \
  > /tmp/c3b-integrity-17.tsv
cmp -s /tmp/c3b-integrity-17.tsv \
  plans/full-refactor/evidence/c3b-integrity-scan.tsv
```

The positive replay exited **0** and the temporary output compared equal to the
durable output [`c3b-integrity-scan.tsv`](evidence/c3b-integrity-scan.tsv): 17 manifest files
and zero skip/only, forbidden-source-pattern, generated/binary, bounded-secret,
and tracked/untracked-whitespace findings. Negative selector/missing-manifest
controls exited **64/64/65/67/66/66** for no arguments, extra arguments, an absent
manifest, an invalid manifest, an in-repository directory manifest, and an
in-repository temporary symbolic-link manifest respectively. The scanner performs
an `lstat` regular-file/non-symbolic-link guard before every manifest or listed-file
read, mapping unavailable reads to deterministic nonzero exits instead of its
unexpected-failure exit. Because the manifest includes the scanner, manifest, and
durable output themselves, replay writes to a temporary file and compares it rather
than truncating the output artifact during its own validation. The scanner originally rejected
a false positive in test prose; its final forbidden-pattern scope is exactly
non-test `packages/backtest/src/**` manifest entries, while skip/only and the
bounded secret/generated checks retain the full manifest scope.

Owned validation then exited **0** for Prettier, strict ESLint, package
TypeScript check, and package build. The C3a declared suite remained **62/62**
with **1083** expectations; the explicit C3b contract suite passed **4/4** with
**9** expectations; and `bun test packages/backtest/src` passed **159/159**
with **1227** expectations. A C3b file-length scan found no
`packages/backtest/**/*.ts` file above 500 lines. This is **PENDING TECHNICAL
AND PROCESS RE-REVIEW**: full package lint and four-metric coverage remain
**NOT PASS** and no repository, release, full-verify, or live-safety PASS is
claimed.

## DRAFT: Slice C3c full backtest-package quality validation

At `2026-08-18T01:42:59+02:00`, the C3c scope was only
`packages/backtest/**` plus its pending evidence rows. The exact full-package
lint baseline was `169 errors / 1 warning`; the current command
`bunx eslint packages/backtest --max-warnings=0` exited **0**. No broad rule
disable or package-level exclusion was added.

The package-owned `vitest.config.ts` uses the exact root-pinned Vitest V8
toolchain, package-root resolution, `src/**/*.ts` coverage inclusion, and only
test/test-support exclusions. Its thresholds are 100 for statements, branches,
functions, and lines. The following commands exited **0**:

```sh
bun run --filter @mm-crypto-bot/backtest coverage
(cd packages/backtest && bun run coverage)
bun run --filter @mm-crypto-bot/backtest test
bun run --filter @mm-crypto-bot/backtest build
bunx prettier --check packages/backtest
bunx eslint packages/backtest --max-warnings=0
bunx tsc -p packages/backtest/tsconfig.json --noEmit
```

Both Bun and Vitest executed **166/166** tests. The direct package-CWD Vitest
V8 report was statements **473/473**, branches **266/266**, functions
**101/101**, and lines **456/456**. The root-filter command emitted the stable
`Running @mm-crypto-bot/backtest V8 coverage` banner and exited 0; its child
reporter does not forward the full table through Bun's filter wrapper, so the
package-CWD command is the detailed metric evidence.

The C3b façade SHA-256 remained
`8805833ec40e350168a4f75775603d59d2a7b5b86e65d5066228e6baee9a143b` against
`ce0fac61223904c4b7dc1b740a8363aeedb8eb07`, and the checked TypeScript-AST
export comparison exited 0. A complete package `.ts` line scan found a maximum
of **412** lines (`src/engine-runner.ts`), with 0 files above 500. Bounded
`packages/backtest` scans found 0 skip/only calls, 0 forbidden historical-term
matches, and 0 filename-only secret-signature matches. `git diff --check`
exited 0. Ignored generated coverage, `.turbo`, and package-local dependency
paths were observed but are not part of the diff.

This implementation evidence is **PENDING TECHNICAL AND PROCESS RE-REVIEW**.
It is not a repository-wide lint/test/verify/release/live-safety PASS and does
not authorize a commit until the required independent reviews close it.

### C3c review-remediation replay details

After the final report-test change, `bun test packages/backtest/src/report.test.ts`
exited 0 with **7/7** tests. The contract parses the JSON string as `unknown`,
uses a record/field guard, and checks deserialized `summary` plus
`result.totalReturn`; a substring is not the only proof.

The final `bun run coverage` package-CWD replay created these ignored generated
files, neither staged nor tracked:

| Path                                               | SHA-256                                                            | Ignore/status evidence                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `packages/backtest/coverage/coverage-summary.json` | `af63eb656f2052163e6d2aa832b2d9e4c4d3e96939972255014c35a017a8200e` | `.gitignore:19:coverage/`; `git status --short --ignored` reports `!! packages/backtest/coverage/`. |
| `packages/backtest/coverage/lcov.info`             | `c45dcde8cd1993762b278d9aa0ab9a0387d3d9f7eff1968bee78c2da7c720ce1` | `.gitignore:19:coverage/`; `git status --short --ignored` reports `!! packages/backtest/coverage/`. |

The replay still reports **166/166** tests and statements **473/473**,
branches **266/266**, functions **101/101**, and lines **456/456**. The
root-filter invocation exits 0 with the deterministic coverage banner; the
package-CWD command is the evidence that emits the metrics and artifacts.

The D-07-approved public API migration changes
`historicalIndicatorMode` from the old literal `legacy` to
`baseline-compatible`; no compatibility alias is permitted. Exact repository
scans found 0 old-literal consumers and three new-literal occurrences, all
inside `packages/backtest`. The two internal manifest dependents are
`apps/bot` and `packages/backtest-tools`: bot typecheck/test and backtest-tools
typecheck exited 0. Backtest-tools full test exited 1 with **235 pass / 12
fail**, therefore it remains **NOT PASS** with no C3c causal assertion. The
backtest package is version `0.1.0` and lacks `private: true`, so unknown
external consumers are not enumerable; a release migration note is required.

This evidence remains **PENDING TECHNICAL AND PROCESS RE-REVIEW** and does not
authorize a commit or a broader implementation PASS.

### C3c exact bot-dependent replay

At `2026-08-18T01:57:40+02:00`, from
`/home/eggp/projects/mm-crypto-bot`, the direct command `bun test apps/bot/src`
exited **0** with **737 passed / 0 failed / 1778 expectations** across 36 files.
This is bounded dependent validation of the D-07-approved public option
migration only; it is not an `apps/bot` scope PASS, global PASS, or a substitute
for the two required independent C3c reviews. No production, test,
configuration, dependency, or generated-artifact diff changed in this
evidence-only turn.

### C3c closure audit

The current C3c diff contains exactly 25 paths: 22 under `packages/backtest/**`,
three C3c evidence ledgers, and no other path. Fresh package checks passed:
Prettier, strict ESLint, TypeScript check, and build; Bun test passed **166/166**
with 1237 expectations. Package-CWD V8 coverage passed every enforced metric:
473/473 statements, 266/266 branches, 101/101 functions, and 456/456 lines.
The generated ignored/not-staged coverage artifacts retain SHA-256
`af63eb656f2052163e6d2aa832b2d9e4c4d3e96939972255014c35a017a8200e`
(`coverage-summary.json`) and
`c45dcde8cd1993762b278d9aa0ab9a0387d3d9f7eff1968bee78c2da7c720ce1`
(`lcov.info`). The removed public option value has zero active
`packages/backtest` matches; `baseline-compatible` has three, with no alias.

The closure audit found no skip/only or coverage-ignore pattern, no non-text
changed file, no tracked/untracked whitespace diagnostic, and no diff-check
diagnostic. The bounded secret-signature scan matched only the three C3c
ledgers, not a package path; it records filenames/categories only and is not a
comprehensive secret audit. The maximum TypeScript length is 412 lines in
`packages/backtest/src/engine-runner.ts`. The known `backtest-tools` test result
remains **NOT PASS** (235 pass / 12 fail), unclassified and not attributed to
this diff. Independent TECH and PROCESS closure results are recorded in
RE-059 and RE-060; their PASS scope is C3c only.
