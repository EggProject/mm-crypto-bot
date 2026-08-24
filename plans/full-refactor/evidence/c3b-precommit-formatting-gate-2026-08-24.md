# C3B pre-commit formatting-gate candidate evidence

Date: 2026-08-24 (Europe/Budapest)
Status: **CANDIDATE-SPECIFIC GATES PASS; PENDING INDEPENDENT TECHNICAL AND PROCESS REVIEW AND COMMIT AUTHORIZATION**

## Scope and routing

| Field                         | Record                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Dispatch class                | Non-review documentation/evidence write                                                                                          |
| Terra predicate               | Governing verification semantics: the precise Prettier ignore controls what the pre-commit hook validates.                       |
| Requested route               | `terra_worker`, `gpt-5.6-terra`, `high`                                                                                          |
| Effective route               | Coordinator-recorded `terra_worker`, `gpt-5.6-terra`, `high`; independent runtime attestation was not observable in this record. |
| Write authority               | This evidence file only: `plans/full-refactor/evidence/c3b-precommit-formatting-gate-2026-08-24.md`                              |
| Candidate files inspected     | `.prettierignore`; `packages/logging/test/e2e/logging-e2e-preload.lifecycle.test.ts`                                             |
| External or mutable resources | None; the detached local worktree and local Bun cache were used.                                                                 |
| Stage/commit authority        | None. No candidate path was staged or committed.                                                                                 |

The candidate was materialized in the detached worktree
`/tmp/mm-c3b-precommit.uGHBrS/worktree` at
`a9935d5d2bbf8ad52298a3fe91a591397dc9da32` (`a9935d5`). Its frozen install
used CCXT 4.5.64 as supplied by the candidate lockfile.

## Candidate delta and content identity

| Path                                                              | SHA-256                                                            | Observed change                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `.prettierignore`                                                 | `772ab6f67564db4b7ec745e46e78570e4c5a27ef6f8e5067789a5829616a6fb4` | One exact ignore entry: `plans/full-refactor/evidence/c3b-invalid-engine-export.fixture.ts`. |
| `packages/logging/test/e2e/logging-e2e-preload.lifecycle.test.ts` | `f70c4ebfe449af41be8ec73b80dc652ccbdc090ad80db22e708af53f76bc0708` | Prettier-only ternary line wrapping at the invalid-identity test.                            |

`git diff --word-diff=porcelain` was captured at
`/tmp/mm-c3b-replay.V9FgYb/candidate-word-diff.log`
(`77c461079e9becfe6a273ad4ddac1b5f36bc67dbf004971ab355269de220e2a7`).
It shows the added exact ignore line and only layout whitespace in the logging
test; no identifiers, expressions, assertions, or literals changed. The
focused lifecycle behaviour check below passed 9/9.

## Replay ledger

All timestamps are Europe/Budapest. Logs are durable local artifacts under
`/tmp/mm-c3b-replay.V9FgYb`; each command was run by this evidence dispatch.

| Start–end                             | CWD                | Command                                                                                                                                                   | Exit/result                                                          | Log SHA-256                                                                                          |
| ------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 23:10:04.428526994–23:10:04.598035639 | detached candidate | `bun install --frozen-lockfile --ignore-scripts`                                                                                                          | 0; 271 installs / 295 packages, no changes                           | `frozen-install.log` `e0e23c389b8bcdd151f2188ca802445ec60111f8f62faf5e2a69382b7f26286a`              |
| 23:13:43.966641188–23:15:18.574911878 | detached candidate | `bun run hook:pre-commit`                                                                                                                                 | 0; ESLint, Prettier, clean-artifacts, and worktree inspection passed | `pre-commit-final.log` `91aade29a28889ea8f0530495621667ba223fdc5f557ecf3ac189fa4bd882f66`            |
| 23:16:48.265829578–23:16:48.947399338 | detached candidate | `bunx vitest run --config packages/logging/vitest.e2e-path-boundary.config.ts packages/logging/test/e2e/logging-e2e-preload.lifecycle.test.ts`            | 0; 1 file, 9/9 tests                                                 | `focused-lifecycle.log` `a329a2e93531ab5462cecf18aeef5eea2f83611dca1bd196a0eacf7a1108f0c3`           |
| 23:16:47.727667359–23:16:49.775490663 | detached candidate | `bun run --filter @mm-crypto-bot/logging typecheck:e2e`                                                                                                   | 0                                                                    | `logging-typecheck-e2e.log` `84b91def8f53635f5c84fe6f7673192c3fd49bfbd0c8be815fea2dc8eb9440dc`       |
| 23:16:48.073251331–23:16:50.891442810 | detached candidate | `bunx eslint --max-warnings=0 packages/logging/test/e2e/logging-e2e-preload.lifecycle.test.ts`                                                            | 0                                                                    | `logging-eslint.log` `7467ac357f87f5638a62217eecc53f02ace84b0b5e18bec29049d4497f13206c`              |
| 23:17:01.780485883–23:17:02.130898230 | shared root        | `bunx prettier --check plans/full-refactor/evidence/c3b-invalid-engine-export.fixture.ts packages/logging/test/e2e/logging-e2e-preload.lifecycle.test.ts` | 0; the fixture was ignored and the logging test matched              | `candidate-prettier-targeted.log` `090e6bf006eacc4b927a8c8f289f8de417fdaaeadf7e6213df3e69d0ffc243ee` |
| 23:16:47.895346861–23:16:48.086843424 | detached candidate | `git diff --check -- .prettierignore packages/logging/test/e2e/logging-e2e-preload.lifecycle.test.ts`                                                     | 0                                                                    | `candidate-diff-check.log` `812fd3dde378a4b515c46d1c7224930bca9fb013ebb2d479152adac64da8981c`        |
| 23:17:30.439763883–23:17:30.606845906 | detached candidate | `git diff --cached --quiet -- .prettierignore packages/logging/test/e2e/logging-e2e-preload.lifecycle.test.ts && echo candidate_paths_not_staged`         | 0; neither candidate path staged                                     | `candidate-stage-check.log` `9dfd699a182eac3b24a4ce4567b23e7068dbbb861665ab71d7ebee64a74631f2`       |

The full hook’s worktree inspection listed exactly the two candidate paths as
unstaged modifications. This is candidate validation, not an authorization to
stage or commit either file.

## Earlier failures and recovery limits

The coordinator reported an initial Prettier failure in an isolated numeric
candidate because `c3b-invalid-engine-export.fixture.ts` is intentionally
syntactically invalid. The original command, timestamp, exit code, transcript,
and artifact hash are not observable in this dispatch, so this record does not
reconstruct or overstate them. The single exact ignore entry is the narrow
remediation; the target check above proves it is effective without broadening
the ignore scope.

Two worktree-environment attempts preceded the fresh frozen install: an initial
`bun run hook:pre-commit` could not locate `eslint` because the candidate had
no `node_modules/.bin`; a retry borrowing the shared root `node_modules` failed
with ESLint 10.8.1 `ResolveMessage {}`. Their exact timestamps, exit codes, and
durable artifacts are unavailable. They are environment failures, not source
or candidate-gate results. A scripted hook attempt beginning 23:10:09 was
interrupted by the command runner before an exit; its empty log is not used as
gate evidence. The post-install final hook in the replay ledger is authoritative.

## Shared-index preservation

Before and after this evidence work, the shared root retained 24 cached paths.
The current stable content observations at 23:17:11.947943230–23:17:11.974599553
are:

| Cached observation                        | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `git diff --cached --name-only -z`        | `37e1c8643f28f3418782c42987dedb904d5eadffd9e6b3039edc15ff7b57289d` |
| `git diff --cached --name-status -z`      | `111e68ee18decc0e09c65d34f0f49050184d948d847a18945ac617c2dd648a48` |
| `git ls-files --stage -z`                 | `ab25fdf3119f3c100bfc7d617bafac1d03585e6be6060ec5131057aa0e120353` |
| `git diff --cached --binary --full-index` | `625916c3f042505c769297fd7065ee725dd103ba4013bfaffd1843e335871380` |

The raw `.git/index` SHA-256 was
`b36154912dc3f251160b061f623ba327cab6936ee95282e66ba065f2cd3d89ff`.
Raw index bytes include mutable stat/cache metadata; the stable cached-content
hashes above are the preservation evidence. The index snapshot log is
`shared-index-after.log` with SHA-256
`5741cb69a496ad935e376b9da19c3785010776e7ca511d8fc5b61bef9f1f79d9`.

No external action, source behaviour change, stage operation, or commit was
performed by this evidence dispatch. This record does not self-review the
candidate.

## Independent review closure

Fresh independent review results supplied to this evidence dispatch:

| Review    | Role and route                                                                | Authority                                              | Result                                |
| --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| Technical | Independent final technical review; `terra_reviewer`, `gpt-5.6-terra`, `high` | Read-only review of the C3B candidate                  | **TECH PASS**; zero open findings.    |
| Process   | Independent process review; `luna_process_reviewer`                           | Read-only review of the C3B candidate and its evidence | **PROCESS PASS**; zero open findings. |

The reviewed C3B candidate is exactly these three paths:

- `.prettierignore`
- `packages/logging/test/e2e/logging-e2e-preload.lifecycle.test.ts`
- `plans/full-refactor/evidence/c3b-precommit-formatting-gate-2026-08-24.md`

Commit is now coordinator-authorized, but has not been executed by this
evidence dispatch. This closure changes neither the preceding command/failure
ledger nor the candidate-specific scope: it is not a repository-wide quality,
release, or deployment PASS claim.
