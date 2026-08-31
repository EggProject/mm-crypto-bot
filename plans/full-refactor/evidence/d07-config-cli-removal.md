# D-07 config CLI removal evidence

Recorded 2026-08-23 Europe/Budapest from `/home/eggp/projects/mm-crypto-bot`.
This is evidence-only remediation. No source, test, manifest, or runtime file
was changed by this turn; no file was staged or committed.

## Classification and authority

The implementation slice was a public API removal with multiple consumers,
including an E2E driver. Its required route was `terra_worker`, model
`gpt-5.6-terra`, reasoning `high`, non-review, one app package, write mode,
and the exact owned paths `apps/bot/src/cli/commands/config.ts`,
`apps/bot/src/cli/commands/config.test.ts`, and
`apps/bot/test/e2e/runtime-driver/cli-boundaries.ts`. The workspace sandbox
was the effective authority and no fallback or external resource was used.
The current evidence writer was a `luna_worker` documentation/evidence
fallback: the eligible Agy bootstrap is failed/unattested and shared dirty
repository writes are not eligible for Agy isolation. Requested/effective
Luna model and effort are recorded by the custom profile; no staging or commit
was authorized for this evidence turn.

## Reproducible accounting

The following commands use the same literal extractor and fail-closed shell
status (`set -e` is used by the positive replay; each count command exits 0):

```sh
git show HEAD:apps/bot/src/cli/commands/config.test.ts \
  | rg -o 'it\\("[^" ]+' | sort > /tmp/d07-unit-head.txt
rg -o 'it\\("[^" ]+' apps/bot/src/cli/commands/config.test.ts \
  | sort > /tmp/d07-unit-current.txt
wc -l /tmp/d07-unit-head.txt /tmp/d07-unit-current.txt
comm -23 /tmp/d07-unit-head.txt /tmp/d07-unit-current.txt
git show HEAD:apps/bot/src/cli/commands/config.test.ts \
  | rg -o '\\bexpect\\(' | wc -l
rg -o '\\bexpect\\(' apps/bot/src/cli/commands/config.test.ts | wc -l
```

Observed baseline/current unit test-name counts were **27 / 23**. Three helper
tests were removed: valid config returns 0, Zod-rejected config returns 2, and
missing config returns 2. The fourth removed name in the raw multiset is the
quoted fixture fragment `it("unused.toml`, not a test declaration; it is a
known limitation of the intentionally simple literal extractor. Baseline and
current `expect(` counts were **72 / 68**: exactly four helper-test
assertions were removed. The focused current run independently passed **23/23
tests and 68 expectations**.

The E2E driver did not exist at `HEAD` (`git show HEAD:apps/bot/test/e2e/runtime-driver/cli-boundaries.ts`
exits 128), so a HEAD baseline cannot be truthfully reconstructed from Git.
The current, reproducible callsite count is:

```sh
rg -o '\\bassertCondition\\(' \
  apps/bot/test/e2e/runtime-driver/cli-boundaries.ts | wc -l
```

It returned **37**. The driver also contains the helper definition and
`expectFailure`/`expectAsyncFailure` calls; those are not `assertCondition`
callsites. The previously reported **40** and reviewer-reported **39** cannot
be reproduced from the current file or a HEAD file, respectively, and are
therefore not asserted here. The discrepancy is explicitly unresolved rather
than filled with an invented baseline. Direct execution was reproducible:
`bun apps/bot/test/e2e/runtime-driver/cli-boundaries.ts` exited 0.

## Diff categorization

The tracked D-07 diff is limited to `config.ts` and `config.test.ts`: it
contains the intended removal of the exported `validateConfigForEdit` helper
and its three tests. The current untracked E2E driver contains zero
`validateConfigForEdit` references, but historical/baseline E2E removal is not
Git-provable because that file has no `HEAD` version. It also contains:

- `formatToml` decomposition into typed strategy-field helpers;
- naming/import and error-handling cleanup (`path`, `error`, and explicit
  non-Error handling);
- test fixture temporary-directory/path naming cleanup;
- removal of stale Phase/backward-compatibility comments.

The decomposition is directly bounded by the existing <=500-line and strict
lint requirements: `config.ts` is 417 lines and `config.test.ts` is 490 lines.
The naming/import/error-handling and fixture changes are mechanical and
behavior-preserving within the same two owned files. Phase-comment removal is
scope-compliant cleanup of stale historical terminology. No unbounded design
change is evidenced. The active `run-bot` and `mm-bot` deployment/config names
remain separate Terra-owned migration dependencies; D-07 is not a zero-legacy
or overall refactor PASS.

## Gates and results

| Gate                                                              | Result                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Scoped ESLint (`config.ts`, `config.test.ts`, `--max-warnings=0`) | PASS, exit 0                                                                                                                           |
| Scoped Prettier check (three owned paths)                         | PASS, exit 0                                                                                                                           |
| Focused unit test                                                 | PASS, 23/23, 68 expectations                                                                                                           |
| Bot typecheck                                                     | NOT PASS, exit 2; unrelated current `packages/exchange` strictness errors in `bybit-eu-normalizers.ts` and `bybit-eu-order-service.ts` |
| E2E typecheck                                                     | NOT PASS, same unrelated exchange errors, exit 2                                                                                       |
| Bot build                                                         | NOT PASS, exit 2; same exchange errors                                                                                                 |
| CLI boundary direct execution                                     | PASS, exit 0                                                                                                                           |
| `git diff --check`                                                | PASS, exit 0                                                                                                                           |
| File-size check                                                   | PASS: 417/490/373 lines; all <=500                                                                                                     |
| Old symbol scan (`validateConfigForEdit`)                         | PASS, zero current matches                                                                                                             |
| History scan                                                      | NOT a zero-legacy proof; historical Git content remains by design                                                                      |

The independent technical review is recorded as **TECH PASS** for the
bounded D-07 implementation slice. The process review previously reported
**FAIL** for the missing accounting/evidence addressed here; its remediation
is **PENDING process re-review**. No implementation, package, repository,
release, or live-trading PASS is claimed.

## Closure status

This evidence closes neither the process finding nor D-07 overall until the
process reviewer replays this file and resolves the explicitly documented
E2E-baseline limitation. The active `run-bot`/`mm-bot` deployment-config
dependency remains a separate Terra migration blocker. No staging or commit
was performed.
