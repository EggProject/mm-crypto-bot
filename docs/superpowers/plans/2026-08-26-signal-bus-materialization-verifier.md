# SignalBus Materialization Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` task by task. The integrated candidate is now based at
> `98894a16f0337b1aa319778ae22babe100683a1a`; all prior SignalBus final reviews are historical for a different identity.
> The exact-identity TECH follow-up passed with zero findings; the PROCESS follow-up found one Medium stale-status finding,
> remediated in this snapshot. The next exact-identity TECH confirmation and PROCESS re-review are pending; if both pass,
> the coordinator may commit without another documentation mutation.

**Goal:** Build a fail-closed local Git verifier for a versioned SignalBus materialization manifest, candidate state,
and governed history.

**Architecture:** The contract module parses manifest/path/digest data. The Git port performs NUL-only local Git and
file access. The verifier orchestrates baseline, candidate, and history modes through injected operations. The CLI
validates arguments, writes deterministic JSON, and maps typed results to exit status.

**Stack:** Bun 1.3.14; TypeScript 6.0.3 strict; Node crypto/filesystem APIs; local Git; Vitest 4.1.10 V8;
ESLint 10.8.1; Prettier 3.9.6.

**Specification:** `docs/superpowers/specs/2026-08-26-signal-bus-materialization-verifier.md`

## Global constraints

- No hook/CI integration, package-manifest change, runtime/trading dependency, network access, staging, or commit.
- The eleven owned tooling paths below each remain at most 500 physical lines. Untrusted input begins as `unknown`; no
  `any`, unsafe assertion, implicit repair, or lossy parsing is permitted.
- Path-bearing Git output uses `-z`; raw and name-status output explicitly detect R/C before normalization; mode-only
  changes with equal blobs fail. Every parsed present identity is lower-case 40 hexadecimal characters and every
  path/blob-bearing diff has `--no-abbrev`.
- Candidate mode reduces committed-since-base, staged, unstaged, and untracked state to one final record per path.
  A baseline pass is digest-less; only candidate and history passes return a real canonical digest.
- The cooperative local threat model assumes the sole writer has stopped. Observed ordinary symlinks/path traversal and
  malformed Git state fail closed. Hostile concurrent filesystem mutation, `openat2`, a native addon, immutable handoff,
  and equivalent descriptor protocols are out of scope. Runtime configuration reload is a separate later design.
- Use no-symlink components observed at inspection time, actual `import.meta.url` binding, and one nofollow read-time
  identity check per read. Direct execution compares `fileURLToPath(import.meta.url)` with
  `path.resolve(process.argv[1])`; a built artifact in a path containing a space must still emit the exact malformed
  invocation diagnostic and exit two.
- Enforce governed strict UTF-8 C0/NUL policy, regular history-tree files, 500/501 limits, terminal trailer parsing,
  NUL porcelain status, topology, and exact full-manifest history closure.
- `--brief` only selects a requested terminal brief and its latest valid materialization digest. History always validates
  every manifest path, first materialization, prerequisite, and dependency closure; a later different brief cannot
  replace the returned digest, and a missing requested materialization or first materialization is `history-incomplete`.
- Before traversing history, validate every manifest path present in the supplied base tree as strict governed UTF-8
  without forbidden C0 bytes and at most 500 physical lines; an absent `create` path at base remains permitted.
- History examines all direct parents. A final state is `absent` or `git:<40hex>` and is novel only when it differs
  from every direct-parent state. If it equals any parent, it creates no record. A touched nonmaterializing governed
  merge has no reserved SignalBus trailer or fails `history-nonmaterialized-trailer`; a novel merge requires full
  trailers and a digest over novel records. At completion each manifest path's exact base-to-HEAD canonical record
  equals its declared operation or fails `history-final-state`. Rename/copy policy is pairwise for every parent diff.
- Coverage instruments exactly contract, Git, verifier, and CLI at 100% statements, branches, functions, and lines.
  No worker stages, commits, self-reviews, or expands scope.

## Owned paths

| Path                                                               | Responsibility                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `scripts/tooling/signal-bus-materialization-contract.ts`           | Strict manifest, safe values, canonical digest, diagnostics.  |
| `scripts/tooling/signal-bus-materialization-git.ts`                | NUL-only Git, snapshots, parent-aware commit materialization. |
| `scripts/tooling/signal-bus-materialization-verifier.ts`           | Baseline/candidate/history orchestration.                     |
| `scripts/tooling/verify-signal-bus-materialization.ts`             | CLI contract and exit mapping.                                |
| `scripts/tooling/signal-bus-materialization-test-support.ts`       | Manifest test support.                                        |
| `scripts/tooling/signal-bus-materialization-repo-test-support.ts`  | Isolated real-local-Git fixture and merge support.            |
| `scripts/tooling/signal-bus-materialization-contract.test.ts`      | Contract and line-limit tests.                                |
| `scripts/tooling/signal-bus-materialization-candidate.test.ts`     | Baseline/candidate/CLI tests.                                 |
| `scripts/tooling/signal-bus-materialization-history.test.ts`       | Linear history and trailer tests.                             |
| `scripts/tooling/signal-bus-materialization-history-merge.test.ts` | Multi-parent history regressions.                             |
| `scripts/tooling/vitest.signal-bus-materialization.config.mjs`     | Exact test discovery and coverage scope.                      |

## Task 1: Strict contract and canonical digest

**Files:** contract module and contract test.

- [x] Write failing contract tests for safe paths, strict duplicate-key JSON, manifest bijection/role/owner/brief/
      prerequisites, immutable output, canonical record order/digest, blob grammar, and 500/501 boundaries.
- [x] Run RED: `node node_modules/vitest/vitest.mjs run scripts/tooling/signal-bus-materialization-contract.test.ts`.
- [x] Implement strict parsing, typed failures, frozen values, bytewise path order, and SHA-256 lines exactly
      `operation + "\\t" + path + "\\t" + blobIdentity + "\\n"`; reject empty, duplicate, invalid, and lossy records.
- [x] Run GREEN with the same focused contract command.

## Task 2: NUL-delimited Git port and isolated repository support

**Files:** Git port; both fixture supports; candidate/history/merge tests.

- [x] Write failing local-only Git/fixture tests for NUL decoding, temporary repositories, hostile global Git config,
      `core.abbrev=7`, SHA-256 repository identity rejection, unsafe paths, final blobs, mode-only changes, and R/C.
- [x] Run RED: `node node_modules/vitest/vitest.mjs run scripts/tooling/signal-bus-materialization-candidate.test.ts scripts/tooling/signal-bus-materialization-history.test.ts`.
- [x] Implement `--raw -z --no-abbrev --find-renames --find-copies --find-copies-harder` and matching
      `--name-status` calls for base/HEAD, staged, unstaged, each direct parent/commit pair, plus NUL untracked files.
      Reject R/C before normalization and malformed NUL arity/status/blob; use local fixed-author temporary fixtures with
      `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, and no remotes.
- [x] Run GREEN with the focused Git command.

## Task 3: Baseline and candidate orchestration

**Files:** verifier and candidate test.

- [x] Write failing tests for committed/staged/unstaged/untracked union; baseline create-absent and
      modify/delete-present rules; candidate final presence/absence; ancestor/root/manifest/line-limit failure; and exact
      digest-less baseline output.
- [x] Run RED: `node node_modules/vitest/vitest.mjs run scripts/tooling/signal-bus-materialization-candidate.test.ts`.
- [x] Implement root binding, inspection-time guards, base checks, strict files, final A/M/D candidate union, expected
      path/operation bijection, canonical digest, and typed failure result.
- [x] Run GREEN with the focused candidate command.

## Task 4: Governed linear and multi-parent history

**Files:** Git port, verifier, linear history test, merge history test, repository support.

- [x] Write failing history tests for exact trailers/digest, ownership, dependencies, predecessor/successor constraints,
      partial terminal brief, invalid approval, unrelated commits, branch order, and pairwise R/C rejection.
- [x] Run RED: `node node_modules/vitest/vitest.mjs run scripts/tooling/signal-bus-materialization-history.test.ts`.
- [x] Implement topological traversal, terminal `git interpret-trailers --parse`, whole-manifest closure,
      `history-incomplete`, tree text/line checks, and final base-to-HEAD declared-operation check.
- [x] A TECH merge finding then required a read-only design audit and a real-Git TDD implementation. Obtain all parents
      with `git rev-list --parents -n 1 <commit>`; union only pairwise-valid paths; classify a record as novel iff final
      state differs from all parent states; reject a reserved trailer on a touched nonmaterializing governed merge; and
      validate novel merge digest/trailers. The fixture split is structural, not a weakened test boundary.
- [x] Run GREEN: `node node_modules/vitest/vitest.mjs run scripts/tooling/signal-bus-materialization-history.test.ts scripts/tooling/signal-bus-materialization-history-merge.test.ts`.
- [x] Cover unchanged second-parent merge; nonmaterializing reserved trailer; unique conflict-resolution M with trailer;
      discarded feature `history-final-state`; malformed direct-parent data; and octopus parents.
- [x] A later TECH High required real-Git RED regressions for a base-present governed deletion containing a binary/C0
      byte and one containing 501 physical lines. Before `approval..HEAD` traversal, validate every base-present manifest
      file as governed strict UTF-8/C0-safe text within the 500-line limit; an absent `create` base file remains valid.
      Both regressions are GREEN; the resulting formatting finding is fixed.
- [x] A fresh integrated TECH finding showed that full-manifest history validation discarded the selected `--brief` and
      returned a later different brief's digest. First reproduce a real-local-Git two-brief ABC/DEF RED and a multi-file
      ABC intermediate RED. Then keep complete-manifest validation, pass the selected brief separately, and return its
      latest materializing digest only. The focused history suite is GREEN at 22/22; a nonmaterialized requested brief
      and any partial complete manifest remain `history-incomplete`.

## Task 5: CLI, coverage, validation, and review handoff

**Files:** CLI, Vitest config, candidate test, documentation/evidence.

- [x] Write failing CLI tests for duplicate/unknown/mode-incompatible/non-absolute input, deterministic JSON, failure
      exit one, and source/built direct entry (including a space in the artifact directory).
- [x] Run RED: `node node_modules/vitest/vitest.mjs run --config scripts/tooling/vitest.signal-bus-materialization.config.mjs --coverage`.
- [x] Implement strict `--name=value` parsing, no filesystem access before argument validation, stderr invocation error/
      exit two, exported execution, four-test-file discovery, four-runtime-module V8 scope, and all 100 thresholds.
- [x] Reproduce ES2022 `Array.toSorted` and percent-encoded direct-entry defects RED; remediate with copied arrays plus
      narrow ES2022 sort suppressions and `fileURLToPath`; retain both regressions.
- [x] Run the current gates:

```bash
node node_modules/vitest/vitest.mjs run --config scripts/tooling/vitest.signal-bus-materialization.config.mjs --coverage
bun run typecheck:coverage-tools
./node_modules/.bin/eslint scripts/tooling/signal-bus-materialization*.ts scripts/tooling/verify-signal-bus-materialization.ts --max-warnings=0
./node_modules/.bin/prettier --check scripts/tooling/signal-bus-materialization* scripts/tooling/verify-signal-bus-materialization.ts docs/superpowers/specs/2026-08-26-signal-bus-materialization-verifier.md docs/superpowers/plans/2026-08-26-signal-bus-materialization-verifier.md plans/full-refactor/evidence/signal-bus-materialization-verifier-2026-08-26.md
SIGNAL_BUS_MATERIALIZATION_OUTPUT="$(mktemp -d)"
bun build scripts/tooling/verify-signal-bus-materialization.ts --target=bun --outfile="${SIGNAL_BUS_MATERIALIZATION_OUTPUT}/verify.mjs"
git diff --check -- scripts/tooling docs/superpowers plans/full-refactor/evidence
```

Post-requested-digest-remediation integrated evidence: 179/179 PASS; V8 638/638 statements, 466/466 branches, 109/109
functions, and 526/526 lines. Focused history is 22/22 GREEN. Owned ES2022 strict TypeScript, ESLint with zero warnings,
Prettier, root build (12/12), built spaced-path malformed CLI, whitespace/scope/secret/TODO scans, and global
`typecheck:coverage-tools` pass. The prior ten-diagnostic result in
`scripts/tooling/eslint-bot-typed-project.test.ts` belongs only to the historical 5a5 candidate: base
`98894a16f0337b1aa319778ae22babe100683a1a` repaired it. Post-documentation Prettier, CLI, diff, scan, and line-limit
gates pass. The exact-identity TECH follow-up passed with zero findings; the PROCESS follow-up found one Medium stale-status
finding, remediated in this snapshot. The next exact-identity TECH confirmation and PROCESS re-review are pending.

- [x] Historical only: obtain a fresh independent TECH PASS from `signal_bus_history_base_rereview` on 2026-08-27. It is the mandatory,
      read-only requested `terra_reviewer` route with profile-pinned `gpt-5.6-terra` / high. Effective runtime route,
      model, and effort are not observable. Its retained receipt covers the exact fourteen-path candidate and records zero
      findings; the independently reproducible focused suite is 178/178 PASS with V8 632/632 statements, 464/464 branches,
      109/109 functions, and 523/523 lines. The current evidence and SDD ledger retain the task identity, result, exact
      focused command, and the inspected scoped ES2022, lint, format, build, spaced-CLI, base C0/501, multi-parent, diff,
      and scope checks. `signal_bus_tech_pass_evidence` was a documentation-only requested/profile-pinned `terra_worker`,
      `gpt-5.6-terra` / high recording action; its effective runtime route, model, and effort are not observable, and it
      did not self-review.
- [x] Historical only: the independent PROCESS review `signal_bus_final_process_pass` is FAIL on 2026-08-27. It is the mandatory,
      read-only requested `luna_process_reviewer` route with profile-pinned `gpt-5.6-luna` / medium; effective runtime route,
      model, and effort are not observable. Its four valid findings are dispatch-ledger completeness, TECH-receipt
      reproducibility, chronology precision, and the stale tooling count. The subsequent `signal_bus_process_rereview` is also
      FAIL on 2026-08-27 with one Medium finding: requested/profile-pinned values were represented as effective runtime values.
      Remediate the evidence, rerun the affected documentary checks, then obtain a new independent PROCESS review without
      staging or committing. Its remediation history is not approval for the integrated candidate; the coordinator alone
      stages exact scope and creates a Conventional Commit after the new reviews pass.

- [x] Historical only: the prior independent TECH+PROCESS review gate completed for then-current blobs.
      `signal_bus_process_rereview_final` passed on 2026-08-27 with zero findings; its receipt cannot approve the
      integrated candidate.
- [x] Complete the integrated final TECH+PROCESS review gate for the current fourteen-file candidate based at
      `98894a16f0337b1aa319778ae22babe100683a1a`. The earlier `signal_bus_final_identity_tech` inspected the former
      5a5 candidate and is historical only. The new requested-digest TECH finding was remediated. The fresh independent
      `signal_bus_integrated_final_tech` and `signal_bus_integrated_final_process` reviews passed with zero findings after
      the required gates. A final exact-identity re-review remains required after this receipt-only documentation mutation;
      the coordinator must not claim closure before it.

## Execution handoff

After fresh final identity TECH and PROCESS PASS, the coordinator must rerun final verification, stage only exact scope,
and create the Conventional Commit. Do not integrate hook/CI or expand scope.
