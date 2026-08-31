# Configurable leverage and commit-first review evidence — 2026-08-31

**Status:** historical implementation and review record; this file does not
claim PASS, full verification, implementation completion, or live readiness.

## Approved decisions

- **D-11, user, 2026-08-31 Europe/Budapest:**
  `leverage -t is megbeszeltuk mar hogy default 10 de beallithato!`
  approves one configurable global/session selected-leverage value: exact
  canonical representation, default exactly 10x, immutable active session, and
  current authenticated venue-supported equality at every activation and order.
  It fails closed on invalid evidence. No rounding, fallback, dynamic,
  per-strategy, per-symbol, or per-order selection is approved; configuration
  reload is out of scope.
- **D-12, user, 2026-08-31 Europe/Budapest:**
  `commit az elso es annak a diff-je alapjan kell reviezni! ... commitoljatok!`
  approves commit-first review: scoped precommit gates, exact staging, TECH and
  PROCESS review of the actual commit diff/range, a follow-up commit for every
  valid finding, and full-range re-review before completion, push, or PR.

## Original implementation commit

- **Classification:** non-review Terra governing/live-risk implementation.
- **Original implementation scope:** exactly
  `.codex/ENGINEERING-STANDARDS.md` and `AGENTS.md`.
- **Requested route:** `terra_worker`, `gpt-5.6-terra`, high reasoning effort.
- **Effective route/model/effort:** not observable in the available runtime
  record; no mismatch is asserted.
- **Write authority:** workspace-write.
- **Preflight record:** the two exact original paths were clean, the index was
  empty, and the scoped secret scan reported 0 before implementation.
- **Implementation paths:** exactly the two original paths above.
- **Recorded precommit evidence:** scoped Prettier, diff-check, stale-wording,
  secret, and forbidden-pattern scans plus per-file LOC checks were run; no
  retry occurred before commit. This historical record is not a claim that the
  checks were rerun by this follow-up.
- **Exact staging:** only `.codex/ENGINEERING-STANDARDS.md` and `AGENTS.md`.
- **Commit:** `5c7d629309bb96cce89798f10a7d72e2c95429e0`
  (`docs(governance): record leverage and review decisions`), parent
  `72c6885d5f516dbc793c45b80e1a274be81a738f`; stat: 2 files changed,
  24 insertions, 93 deletions.
- **Postcommit record:** index empty; the two owned paths clean; 432 unrelated
  dirty paths remained unstaged.

## Actual-commit review findings and follow-up scope

- **TECH finding:** the selected-leverage test requirement did not explicitly
  cover missing, stale, or ambiguous **account-eligibility** evidence alongside
  selected-leverage evidence and the remaining negative cases.
- **PROCESS finding:** the repository approval/decision/goal records had not
  yet recorded the user-approved configurable selected-leverage semantics or
  the commit-first actual-diff/range review sequence.
- **Follow-up candidate scope:**
  `.codex/ENGINEERING-STANDARDS.md`,
  `plans/full-refactor/APPROVALS.md`,
  `plans/full-refactor/DECISIONS.md`,
  `plans/full-refactor/GOAL.md`, and this evidence file. It adds the explicit
  account-eligibility coverage, D-11/D-12 ledgers and acceptance records, and
  D-11/D-12 goal reconciliation. It does not stage, commit, review, push, or
  claim verification completion.
- **Required next review:** after the follow-up is committed, independent TECH
  and PROCESS review must inspect `72c6885..FOLLOWUP`; no completion, push, or
  PR is authorized before that full range is re-reviewed.

## Follow-up commit `5712ca7` execution evidence

<p>Classification: non-review Terra governing/live-leverage implementation; ownership: `.codex/ENGINEERING-STANDARDS.md`, `plans/full-refactor/APPROVALS.md`, `DECISIONS.md`, `GOAL.md`, and this evidence file; workspace-write authority. Preflight recorded the exact owned paths, a zero-result scoped secret scan, and an empty index. The method preserved the shared dirty worktree by preparing the patch against a clean HEAD snapshot and applying only the owned additions to the authoritative worktree; retained unrelated dirty hunks were not staged. Requested route: `terra_worker` / `gpt-5.6-terra` / high; effective runtime/provider attestation is not observable. No fallback applies. Retries: none recorded.</p>

<p>Patch SHA-256: `54516c81...f55b88`. Exact staging was `.codex/ENGINEERING-STANDARDS.md`, `plans/full-refactor/APPROVALS.md`, `DECISIONS.md`, `GOAL.md`, and this evidence file. Commit: `5712ca763e57315a2b601d6f686fe5bdac6d21ac` (`docs(governance): reconcile leverage approvals`), stat 5 files changed, 196 insertions, 21 deletions; postcommit index empty. Standards, GOAL, and this evidence path were clean; APPROVALS and DECISIONS retained unrelated dirty changes; 432 unrelated records remained unstaged.</p>

<p>Actual re-review reported TECH+PROCESS findings against `72c6885..5712ca7`: restore D-10, correct D-11/D-12 session/time metadata without fabricated wall-clock, remove active fixed-ten-only wording, complete D-12 range-review procedure, and complete execution/review evidence. This R2 scope remediates those findings only. It does not claim PASS, full verification, implementation completion, push, PR, or live readiness.</p>

## R3 lossless split and commit `9879fd1` execution record

- **Classification and authority:** non-review governing-semantics and audit-evidence
  implementation; writer route requested `terra_worker` / `gpt-5.6-terra` /
  high; effective provider attestation not observable; workspace-write. The
  coordinator alone performed exact staging and commit.
- **R2 rejection:** the unsafe `/tmp/governance-range-r2.patch` would have
  deleted more than 700 documentation lines. Its `sha256sum`, cached
  `git apply --check`, `git apply --numstat`, `git apply --stat`, scoped
  `git diff --check` on eight owned paths, and scoped Prettier check each
  exited 0; `git apply --cached` was approval-rejected before index mutation.
  R2 was abandoned without workaround.
- **R3 fallback:** the lossless three-segment ledger split used
  `/tmp/governance-range-r3.patch`, SHA-256
  `afe5f6489ebf5323d97f411180ca4ec86959221571c8fde13e97381ce4d122e7`.
  Cached apply preflight, numstat, stat, `git diff --check`, Prettier, and
  `wc -l` on the exact 11 owned paths each exited 0; the maximum was 412
  lines. Inventory comparison retained all old review IDs/headings, found
  review IDs `78`/`87`, validation headings `28`/`30`, preserved segment
  links, and found no secret-assignment hit.
- **Exact ownership and staging:** `APPROVALS.md`, `ARCHITECTURE.md`,
  `DECISIONS.md`, `MIGRATION.md`, `README.md`, `REVIEW-EVIDENCE.md`,
  `VALIDATION.md`, this evidence file, `review-evidence/part-01.md`, and
  `validation-records/part-01.md` and `part-02.md`. Cached patch application,
  path inventory, diff check, and stat each exited 0. The sorted expected 11 paths compared
  byte-for-byte with `git diff --cached --name-only | sort`; the staged
  D-10/D-11/D-12, selected-leverage, commit-first, actual-commit, follow-up,
  full-range, and session-reference scan exited 0.
- **Commit and postcommit:** the recorded commit command created
  `9879fd19d1b5472099134578fc8647ccdbb2f1c0` (11 files, 1,180 insertions,
  856 deletions by authoritative no-renames stat). The postcommit stat and
  `git diff --check HEAD^..HEAD` exited 0; `git diff --cached --name-only` was
  empty. Only unrelated direct dirty hunks remained in `ARCHITECTURE.md` and
  `DECISIONS.md`; `git log --oneline -5` confirmed HEAD. Roll back only with
  `git revert 9879fd1` after isolating and preserving unrelated worktree hunks.
- **Cited evidence targets:** direct inspection retained the current untracked
  `ccxt-4.5.75-upgrade-validation.md` (387 lines) and `c4c-command-ledger.md`
  (38 lines). Both are coherent scope-bound evidence, below 500 lines, contain
  no credential marker, and make no repository, release, or live-readiness
  PASS; they remain required cited targets.

### Authoritative R2/R3 command outcomes

Every R2 precheck command below exited 0; the final cached apply was rejected
before any index mutation:

```text
sha256sum /tmp/governance-range-r2.patch
git apply --check --cached /tmp/governance-range-r2.patch
git apply --numstat /tmp/governance-range-r2.patch
git apply --stat /tmp/governance-range-r2.patch
git diff --check -- plans/full-refactor/REVIEW-EVIDENCE.md plans/full-refactor/VALIDATION.md plans/full-refactor/evidence/configurable-leverage-commit-first-2026-08-31.md plans/full-refactor/review-evidence/part-01.md plans/full-refactor/validation-records/part-01.md plans/full-refactor/validation-records/part-02.md plans/full-refactor/evidence/ccxt-4.5.75-upgrade-validation.md plans/full-refactor/evidence/c4c-command-ledger.md
bunx --no-install prettier --check plans/full-refactor/REVIEW-EVIDENCE.md plans/full-refactor/VALIDATION.md plans/full-refactor/evidence/configurable-leverage-commit-first-2026-08-31.md plans/full-refactor/review-evidence/part-01.md plans/full-refactor/validation-records/part-01.md plans/full-refactor/validation-records/part-02.md plans/full-refactor/evidence/ccxt-4.5.75-upgrade-validation.md plans/full-refactor/evidence/c4c-command-ledger.md
git apply --cached /tmp/governance-range-r2.patch  # approval-rejected
```

Every R3 precheck command below exited 0. The `wc -l` result was at most 412;
the final command created `9879fd1`:

```text
sha256sum /tmp/governance-range-r3.patch
git apply --check --cached /tmp/governance-range-r3.patch
git apply --numstat /tmp/governance-range-r3.patch
git apply --stat /tmp/governance-range-r3.patch
git diff --check -- plans/full-refactor/APPROVALS.md plans/full-refactor/ARCHITECTURE.md plans/full-refactor/DECISIONS.md plans/full-refactor/MIGRATION.md plans/full-refactor/README.md plans/full-refactor/REVIEW-EVIDENCE.md plans/full-refactor/VALIDATION.md plans/full-refactor/evidence/configurable-leverage-commit-first-2026-08-31.md plans/full-refactor/review-evidence/part-01.md plans/full-refactor/validation-records/part-01.md plans/full-refactor/validation-records/part-02.md
bunx --no-install prettier --check plans/full-refactor/APPROVALS.md plans/full-refactor/ARCHITECTURE.md plans/full-refactor/DECISIONS.md plans/full-refactor/MIGRATION.md plans/full-refactor/README.md plans/full-refactor/REVIEW-EVIDENCE.md plans/full-refactor/VALIDATION.md plans/full-refactor/evidence/configurable-leverage-commit-first-2026-08-31.md plans/full-refactor/review-evidence/part-01.md plans/full-refactor/validation-records/part-01.md plans/full-refactor/validation-records/part-02.md
wc -l plans/full-refactor/APPROVALS.md plans/full-refactor/ARCHITECTURE.md plans/full-refactor/DECISIONS.md plans/full-refactor/MIGRATION.md plans/full-refactor/README.md plans/full-refactor/REVIEW-EVIDENCE.md plans/full-refactor/VALIDATION.md plans/full-refactor/evidence/configurable-leverage-commit-first-2026-08-31.md plans/full-refactor/review-evidence/part-01.md plans/full-refactor/validation-records/part-01.md plans/full-refactor/validation-records/part-02.md
git apply --cached /tmp/governance-range-r3.patch
git diff --cached --name-only
git diff --cached --check
git diff --cached --stat
git commit -m "docs(governance): propagate leverage decisions"
```

The pre-stage inventory compared `git show HEAD:<owned path> | rg ... | sort
-u` with the three current segments and `comm -23`; it found no missing old
review ID or heading. The postcommit commands `git show --stat --oneline
--decorate --no-renames HEAD`, `git diff --cached --name-only`, `git diff
--check HEAD^..HEAD`, `git status --short -- <11 owned paths>`, and `git log
--oneline -5` produced the results recorded above.

## Hash-specific execution records

- `ede8dbb` (parent `f50fae9`): coordinator staged exactly 18 paths and
  committed them. Commit stat was 73 insertions and 167 deletions. Precommit
  evidence: strategy V8 10 files/110 tests, S507/B353/F74/L461 all 100%; core
  typecheck on the current dirty union exit 0; scoped ESLint, Prettier, diff,
  and secret scan passed; maximum runtime/test file length 470 LOC. Actual
  technical review by `terra_reviewer` failed on inherited dYdX/composite
  undefined-callback mismatch, portfolio aggregate/type/lastVaR blockers, and
  a candidate exact-name contract-test gap. Actual process review by
  `luna_process_reviewer` failed only because hash-specific evidence was
  absent; scope and mechanics passed.
- `4395065` (parent `ede8dbb`): coordinator staged exactly four numeric paths
  and committed them; stat was 136 insertions. Numeric validation covered 7
  files/117 tests, S283/B188/F57/L282 all 100%; numeric typecheck, scoped
  ESLint, Prettier, diff, forbidden rounding/coercion/openat/secret scans
  passed; maximum LOC was 324. Process review failed only because this
  hash-specific record was absent. The subsequent technical rereview passed.
- `1bc1f6c` (parent `4395065`): coordinator staged exactly two documentation
  paths and committed them; stat was 50 insertions and 49 deletions. Main
  report is 490 LOC and appendix 48 LOC. Prettier, diff, link, and content
  preservation checks passed. Independent technical rereview passed; process
  review is pending.

Strategy remediation was delegated; final six-path stale cleanup and report
split used `luna_worker`; numeric implementation used the existing
`terra_worker` artifact. The coordinator integrated, staged exact paths, and
committed. Actual technical review is `terra_reviewer`; process review is
`luna_process_reviewer`. Provider telemetry was not independently observable;
profile settings are the routing evidence. No fallback was used. The
surrounding dirty union was never staged.

`85dd602` passed technical rereview. `c5e8d40` (parent `85dd602`) staged
exactly three test paths, stat 18 insertions and 1 deletion, and passed the
exact-name technical review. The focused Bun run was 41/41 with 101 expects;
exact V8 coverage was 10 files/112 tests with S507/B353/F74/L461 all 100%.
Current-union core typecheck, scoped ESLint/Prettier/diff, and maximum LOC 478
passed; cached scope and check passed. Its commit command was
`git commit -m "test(core): lock canonical strategy names"`. Technical review
passed and closed the exact-name finding.

The actual technical status is PASS for `4395065`, `1bc1f6c`, `85dd602`, and
`c5e8d40`. The full `f50fae9..c5e8d40` range still has two open technical
findings: the candidate dYdX and CompositePlugin null-vs-undefined corridor,
and the unapproved public `CascadeEvent` null-to-undefined migration.
Portfolio/lastVaR findings are inherited at the parent and are not newly
attributed to these commits. Next actions are to resolve those semantic
corridors, obtain fresh full-range TECH/PROCESS rereviews, and retain the
no-full-range-PASS/no-live-readiness status.

### Replayable command ledger

The `<... paths>` placeholders are deterministic: use
`git show --format= --name-only <hash>` and omit non-applicable Markdown paths
for ESLint. They are not unknown or omitted scopes.

```text
ede8dbb:
bun x vitest run --config packages/core/vitest.strategy-absence-s1.config.mjs --coverage
bun run --filter @mm-crypto-bot/core typecheck
bun x eslint --max-warnings=0 <18 commit code paths>
bun x prettier --check <18 commit paths>
git diff --check -- <18 commit paths>
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git add <18 exact paths>
git commit -m "refactor(core): remove strategy delivery labels"

4395065:
bun run --filter @mm-crypto-bot/numeric coverage
bun run --filter @mm-crypto-bot/numeric typecheck
bun x eslint --max-warnings=0 <4 numeric paths>
bun x prettier --check <4 numeric paths>
git diff --check -- <4 numeric paths>
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git add <4 exact paths>
git commit -m "feat(numeric): serialize exact terminating decimals"

1bc1f6c:
bun x prettier --check <2 documentation paths>
git diff --check -- <2 documentation paths>
wc -l <2 documentation paths>
test -f docs/research/phase25/REPORT-phase25-2-appendix.md
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git add docs/research/phase25/REPORT-phase25-2.md docs/research/phase25/REPORT-phase25-2-appendix.md
git commit -m "docs(research): correct strategy absence evidence"

c5e8d40:
bun test <41 focused tests>
bun x vitest run --config packages/core/vitest.strategy-absence-s1.config.mjs --coverage
bun run --filter @mm-crypto-bot/core typecheck
bun x eslint --max-warnings=0 <3 test paths>
bun x prettier --check <3 test paths>
git diff --check -- <3 test paths>
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git add <3 exact test paths>
git commit -m "test(core): lock canonical strategy names"
```

## Security scanner sequence record

- `6dbe487`: original deletion commit; actual TECH review failed on TS6133
  and absence of pre/post stability evidence.
- `ad856ef` (parent `6dbe487`): exact four paths, 193 insertions and 22
  deletions. RED made observable-identity/canonical changes and exposed TS6133;
  GREEN coverage was V8: 66, S666/B586/F136/L653 all 100%. Strict typecheck,
  ESLint, Prettier, diff, and LOC gates passed; exact staging and empty index
  were recorded. Actual TECH review failed only on numeric dev/ino precision;
  PROCESS review failed only because hash-specific evidence was missing.
- `078a946` (parent `ad856ef`): exact two paths, 64 insertions and 6
  deletions. RED exposed the >2^53 BigInt device-collision test; GREEN was
  V8: 67, S668/B586/F138/L655 all 100%. Strict typecheck, ESLint, Prettier,
  diff, and LOC (419/149) passed; exact staging and empty index were recorded.
  Patch SHA was `184b9767bcfd5253c4cccc40bf8c43ad760c9f89c11be90c685e4142de6b5928`; commit message was
  `fix(tooling): preserve exact scanner identity`. The preceding patch SHA
  for `ad856ef` was `effcad284beebb2a386a60d239352fc5fd2d1850c4b3d93231ea1e17f8735127`; its commit message was
  `fix(tooling): verify scanner path stability`.

The scanner follows exactly three narrow adjacent security directives and
uses direct ordinary I/O. It uses no openat, descriptor, proc, or dev-fd
mechanism. The non-atomic ABA limitation remains honestly documented. Routing
requested `terra_worker` with high reasoning for security tooling, using
isolated `/tmp` artifacts; effective provider telemetry was not independently
observable and no fallback was used. Fresh TECH/PROCESS range rereviews remain
pending; no full, live, or repository PASS is claimed.

Replay commands:

```text
git show --stat --oneline 6dbe487
git show --stat --oneline ad856ef
git show --stat --oneline 078a946
bun x vitest run --config scripts/tooling/vitest.zero-legacy.config.mjs --coverage
bun test scripts/tooling/zero-legacy-coverage-delta.test.ts scripts/tooling/zero-legacy-node-port.test.ts scripts/tooling/zero-legacy-scanner.test.ts scripts/tooling/zero-legacy-contract.test.ts scripts/tooling/zero-legacy-extractors.test.ts scripts/tooling/zero-legacy-cli.test.ts scripts/tooling/zero-legacy-cli.vitest.ts
bun x tsc --ignoreConfig --noEmit --strict --noUnusedLocals --noUnusedParameters --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitOverride --noPropertyAccessFromIndexSignature --module ESNext --moduleResolution bundler --target ES2022 --lib ES2022,DOM --types bun-types,node --skipLibCheck --allowImportingTsExtensions scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-scanner.test.ts scripts/tooling/zero-legacy-node-port.test.ts scripts/tooling/zero-legacy-coverage-delta.test.ts
# ad856ef exact four paths
bun x eslint --max-warnings=0 scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-scanner.test.ts scripts/tooling/zero-legacy-node-port.test.ts scripts/tooling/zero-legacy-coverage-delta.test.ts
bun x prettier --check scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-scanner.test.ts scripts/tooling/zero-legacy-node-port.test.ts scripts/tooling/zero-legacy-coverage-delta.test.ts
git diff --check -- scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-scanner.test.ts scripts/tooling/zero-legacy-node-port.test.ts scripts/tooling/zero-legacy-coverage-delta.test.ts
git add scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-scanner.test.ts scripts/tooling/zero-legacy-node-port.test.ts scripts/tooling/zero-legacy-coverage-delta.test.ts
# 078a946 exact two paths
git add scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-node-port.test.ts
git diff --cached --name-status
git diff --cached --check
git status --short
```

### R5 review and historical staging evidence

The `6dbe487..078a946` technical rereview is PASS. The PROCESS rereview has a
Medium finding only for missing command-level evidence; that finding is
addressed here. No historical precommit secret scan is claimed.

```text
# ad856ef exact staging and postcommit evidence
git diff --cached --name-status
# four M paths: scripts/tooling/zero-legacy-scanner.ts
# scripts/tooling/zero-legacy-scanner.test.ts
# scripts/tooling/zero-legacy-node-port.test.ts
# scripts/tooling/zero-legacy-coverage-delta.test.ts
git diff --cached --stat
# 4 files changed, 193 insertions(+), 22 deletions(-)
git diff --cached --check
# exit 0
git diff --cached --name-only
# empty after commit
wc -l scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-scanner.test.ts scripts/tooling/zero-legacy-node-port.test.ts scripts/tooling/zero-legacy-coverage-delta.test.ts
# 401 484 109 267
git diff-tree --check ad856ef^ ad856ef
# exit 0
git diff-tree --no-commit-id --name-only -r ad856ef^ ad856ef
# the exact four paths listed above
# retrospective secret revalidation (not precommit)
git show --format= --no-ext-diff ad856ef | rg -n -i '(api[_-]?key|client[_-]?secret|private[_-]?key|access[_-]?token|password)\s*[:=]'
# no output, exit 1 expected
```

The PROCESS rereview remains pending after this evidence update. No full
range PASS or live readiness is claimed.
