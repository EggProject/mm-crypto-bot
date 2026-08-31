# Dirty-union actual commit and review record

Date: 2026-08-31

This is a factual, hash-specific record of the commit-first sequence. It does
not grant readiness or claim a global pass. Concurrent work may dirty the
current tree and is outside the post-commit snapshots recorded here.

## Classification, authority, and routing

| Work item                         | Classification and ownership                                                                                                  | Route, model, effort                            | Sandbox/write authority                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Integration commit and provenance | Routine documentation-only mechanical provenance; coordinator-owned integration; this file exclusively owned by `luna_worker` | `luna_worker`; `gpt-5.6-luna`; low              | `workspace-write`; one evidence file; no product or governing semantics |
| Technical review                  | Independent final technical review                                                                                            | `terra_reviewer`; `gpt-5.6-terra`; high         | Read-only                                                               |
| Process review                    | Independent process review                                                                                                    | `luna_process_reviewer`; `gpt-5.6-luna`; medium | Read-only                                                               |
| Runtime/test commits below        | Explicit implementation ownership as stated in each commit brief                                                              | `terra_worker`; `gpt-5.6-terra`; high           | `workspace-write`; exact paths stated in the brief                      |

The documentation task has no Terra trigger and no eligible evaluated Agy route
was applicable; therefore its required route is `luna_worker`.

## Actual commit-first chronology

### Integration

`7cca4e37449215e00ffe138fd9bc0a9471e77aa4` (parent
`fb1bb07a4bd31105e322344e369465993cda7cba`, subject `chore(integration):
consolidate current workspace changes`) contains 397 paths. Preflight recorded
397 status records: 202 tracked diff paths and 195 untracked paths. High-
confidence secret/key scans found zero matches; no changed or untracked file
exceeded 5 MB. Initial diff-check found exactly trailing whitespace at
`plans/full-refactor/evidence/d10-bybiteu-connection-config-execution-2026-08-24.md:363`;
it was fixed and the rerun passed. Initial `git add -A` hit a sandbox
index.lock read-only failure; the escalated retry succeeded. The staged state
was 397 staged and 0 unstaged paths; cached diff-check passed, the commit was
created, and post-commit status was clean (0 records).

Path-inventory SHA256:
`e7e41f6a3380d70b429c2db2d4687e58b3ba87befcfe9fea6bf0ce5c535cde67`.
Binary commit-diff SHA256:
`44fdbbba189aa00d035dd4d8f10c45919f70455f3ab1e3609b41f3ef6718b021`.

Afterward, frozen-install reconciliation changed only the stale ignored root
`ccxt` symlink from 4.5.64 to locked 4.5.75; no source or lock files changed.
Paper typecheck passed. Full root typecheck exposed
`packages/backtest-tools/src/data/live-latency-source.ts` TS2416 (null versus
undefined).

Actual independent technical review (`terra_reviewer`, read-only) failed:
critical configured leverage/authorization unwired; critical numeric live-order
transport; critical emergency `Math.floor`/`EPSILON`; high touched LOC >500;
medium bot unit coverage 1/982; inherited `console.warn` logger blockers; low
rate-limit prefix coercion. Actual process review
(`luna_process_reviewer`, read-only) failed because there was no final 397-path
reconciliation and no hash-specific provenance record. There is no readiness
PASS.

### Subsequent exact commits

1. `c94259d05f5141ab98325d30a111d5f62a1454dd` (parent `7cca4e3`,
   `test(bot): split oversized runtime tests`, exact 3 paths). Implementer:
   `terra_worker`, `gpt-5.6-terra/high`, workspace-write, explicit scope.
   Fourteen focused tests passed; inventory changed from 14 titles/57 expects
   to 9+5 titles/37+20 expects. Bot main typecheck, scoped ESLint (0),
   Prettier, diff-check, and worker LOC counts 359/187/499 passed. Staged 3,
   unstaged 0, cached check passed, commit and post-commit were clean. Technical
   review failed on inherited E2E TS2540 readonly `killSwitchVerdicts`;
   process review failed for missing hash record.
2. `cc33b9c11fe3c746de5ab31b607bd9c2ad14a84a` (parent `c94259d`,
   `fix(backtest-tools): align latency absence contract`, exact 2 paths).
   Implementer: `terra_worker`, `gpt-5.6-terra/high`, workspace-write. TDD RED
   observed undefined assertion versus null; GREEN Bun 4/10, package typecheck,
   ESLint 0, Prettier, diff-check, and V8 coverage S27/27 B18/18 F5/5 L25/25;
   LOC 84/64. Staged 2, unstaged 0, cached check and post-commit clean.
   Technical review passed with no findings; process review failed only for the
   missing hash record.
3. `e958700df382a6a6f739bbf0f6da4141bd8af1a8` (parent `cc33b9c`,
   `test(bot): exercise public stale-funding path`, exact 1 path). Implementer:
   `terra_worker`, `gpt-5.6-terra/high`, workspace-write. RED E2E tsc exposed
   TS2540; GREEN E2E/main typecheck, focused lifecycle 8/28, ESLint 0,
   Prettier, diff-check, and LOC 500 passed; staged 1, unstaged 0, cached check
   and post-commit clean. Technical review failed: public
   `StaleFundingSource` still exits early without valid Bybit liquidity, so the
   kill switch did not exit. The earlier TS2540 is closed. Process review failed
   for missing hash record.

## Scope reconciliation and unresolved findings

The count 301 belongs to an earlier frozen snapshot. The actual authorized
all-worktree integration commit contains 397 paths, and this record supersedes
the earlier scope count for this commit only. It does not alter later scopes.

Unresolved ledger: integration critical leverage/authorization wiring, numeric
live-order transport, emergency rounding, coverage, logger, and rate-limit
findings; public stale-funding runtime failure; and process evidence findings on
the recorded commits. The TS2416 latency absence mismatch was fixed by
`cc33b9c`; the E2E TS2540 compiler mismatch was fixed by `e958700`, while its
replacement runtime scenario remains failing. No readiness PASS is implied.

## Rollback

Rollback is `git revert <hash>` for each commit, in reverse dependency order as
approved by the coordinator: `e958700df382a6a6f739bbf0f6da4141bd8af1a8`,
`cc33b9c11fe3c746de5ab31b607bd9c2ad14a84a`,
`c94259d05f5141ab98325d30a111d5f62a1454dd`, then
`7cca4e37449215e00ffe138fd9bc0a9471e77aa4`.

## File-scoped validation contract

This record is validated only with Prettier, a no-index diff check, line count,
and a high-confidence secret scan. No self-review is performed.
