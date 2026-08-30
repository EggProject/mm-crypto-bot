# `tsconfig.base.json` test-alias comment evidence

Recorded `2026-08-30` Europe/Budapest. This is a bounded, low-risk internal
maintenance change implemented by the assigned `luna_worker`
(`gpt-5.6-luna`, low, workspace-write). Candidate ownership is
`tsconfig.base.json`; evidence ownership is this file and its one index link.
No source, test, compiler option, alias target, package, or runtime behavior
is in scope. No staging or commit was performed.

## Classification and boundary

| Field                     | Record                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Task class                | Routine documentation/comment-only maintenance                                                     |
| Requested/effective route | `luna_worker` / `gpt-5.6-luna` / low                                                               |
| Mode and authority        | Read/write; workspace-write                                                                        |
| Candidate owner           | `tsconfig.base.json`                                                                               |
| Evidence owner            | This evidence file and one index link                                                              |
| Packages                  | 0 runtime packages                                                                                 |
| Risk/reasoning            | Low risk, linear, no design trade-off                                                              |
| Review role               | Non-review implementation; independent Terra technical review recorded as PASS                     |
| Overlap                   | None with concurrent baseline evidence work                                                        |
| Rollback                  | Restore the original comment in `tsconfig.base.json`, remove this evidence file and its index link |

The current diff is exactly two added and six removed comment lines. It
replaces stale phase/history wording with timeless English wording describing
the existing test-only alias intent. The effective TypeScript configuration is
unchanged.

## Validation ledger

| Check                                                       | Result                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| JSONC parse and deep equality of HEAD/current semantic JSON | PASS; no semantic difference                                                                                             |
| Effective compiler options and file list comparison         | PASS; byte/element-equivalent outputs                                                                                    |
| Representative `@exchange-testing/mockFeed.js` resolution   | PASS; both resolve to `packages/exchange/src/__testing__/mockFeed.ts`                                                    |
| `tsc --showConfig -p apps/bot/tsconfig.json`                | PASS                                                                                                                     |
| Prettier on owned evidence paths                            | PASS                                                                                                                     |
| `git diff --check`                                          | PASS                                                                                                                     |
| File-size/LOC gate                                          | PASS; 53 lines                                                                                                           |
| Secret/sensitive-data scan                                  | PASS; zero matches                                                                                                       |
| Cached-index inspection                                     | PASS; no staged changes                                                                                                  |
| `tsc --noEmit -p apps/bot/tsconfig.json`                    | RED; 11 unrelated dirty-union errors across existing files; not attributed to this comment and no global pass is claimed |

Reproducible commands for the checks above:

```sh
git show HEAD:tsconfig.base.json > /tmp/tsconfig.base.head.jsonc
bun --eval 'const strip=(s)=>s.replace(/\/\*[^]*?\*\//g, "").replace(/(^|\\s)\/\/.*$/gm, ""); const a=JSON.parse(strip(await Bun.file("/tmp/tsconfig.base.head.jsonc").text())); const b=JSON.parse(strip(await Bun.file("tsconfig.base.json").text())); if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error("semantic drift")'
bunx tsc --showConfig -p apps/bot/tsconfig.json
bunx prettier --check tsconfig.base.json plans/full-refactor/evidence/tsconfig-test-alias-comment-2026-08-30.md plans/full-refactor/REVIEW-EVIDENCE.md
git diff --check -- tsconfig.base.json plans/full-refactor/evidence/tsconfig-test-alias-comment-2026-08-30.md plans/full-refactor/REVIEW-EVIDENCE.md
wc -l tsconfig.base.json plans/full-refactor/evidence/tsconfig-test-alias-comment-2026-08-30.md
git diff --cached --quiet
git diff --numstat -- tsconfig.base.json
bunx tsc --noEmit -p apps/bot/tsconfig.json
```

The representative `@exchange-testing/mockFeed.js` import resolves to
`packages/exchange/src/__testing__/mockFeed.ts` in both configurations. The
negative typecheck reports 11 pre-existing dirty-union errors and is not a
candidate regression.

## Review and process status

Independent `terra_reviewer` / `gpt-5.6-terra` / high returned **TECH PASS**
with no valid findings for this comment-only candidate. The first
`luna_process_reviewer` pass returned **PROCESS FAIL** because the evidence
record was not yet durable; this file and the index link are the remediation.
Fresh independent process re-review is required before closure. This slice
does not claim repository-wide typecheck, build, or refactor completion.

## Retrospective Agy eligibility assessment

This evidence-writer dispatch is corrected retrospectively: the current rules did not make an Agy write route eligible because the authoritative worktree was shared and dirty, direct Agy writes were forbidden, and no dedicated isolated workspace or effective allow/deny boundary was used or authorized for this slice. The Luna mechanical documentation-only route therefore remained the current disposition. No evaluated Agy route or observable attestation is claimed.

## Commit provenance correction

The historical pre-commit/preflight statements above apply to the review-before-commit snapshot only. The implementation was subsequently committed as `d9546b8`. `git show --stat --oneline d9546b8` identifies the implementation slice, and after that commit the exact implementation paths tsconfig.base.json were clean.
