# `run-baseline.test.ts` hermetikus Phase-removal evidence

Recorded `2026-08-30` Europe/Budapest. This evidence is limited to the single
test candidate and does not claim a package, repository, mounted-data,
release, or live-trading PASS.

## Scope and routing

Routine evidence-only remediation: read/write, one new evidence file plus one
index line, zero runtime-package changes, low risk, non-review role. Requested
and effective route: `luna_worker`, `gpt-5.6-luna` / `low`, `workspace-write`.
Evidence-writer ownership was this evidence file and its index line only; it
owned no production, test, configuration, schema, mounted-data,
`openat`/descriptor, or config-reload path. The implementation candidate was
sequentially owned first by the Luna fallback for label cleanup, then by
`terra_worker` for data-integrity remediation.

The first-match `spark_worker` request was unavailable (exact error:
`agent_type 'spark_worker' is not available`). The eligible low-risk Spark
fallback was `luna_worker` / low. A missing-data result was reclassified,
not ignored: the original mounted-data preflight was `0/4` with `ENOENT`, so
the data-integrity read-only/implementation chain used `terra_reader` then
`terra_worker`, both `gpt-5.6-terra` / `high`, sequentially. There was no
ownership overlap.

## Baseline and candidate accounting

Clean historical `HEAD` was `6c2e93b16c0c85ed726a472493058c7ae0fd1876`.
The coordinator-captured scoped preflight before dispatch was
`git status --short -- packages/backtest-tools/src/cli/run-baseline.test.ts`
in `/tmp/mm-dirty-union-d02-integration` at that HEAD; output was empty and
exit 0. This receipt is historical and not independently replayable now; it
does not claim that the whole worktree was clean.
The command `git show HEAD:packages/backtest-tools/src/cli/run-baseline.test.ts | sha256sum`
returned `7c14a6210f6f0f87a72cb741fa35cf537a4cfc145424956694eb3aa13f43785d`;
the file had 67 LOC, 4 tests, and 8 static `expect(` calls. Its titles and
comments referenced Phase 1/Phase 15 and mounted `data/ohlcv`.

Current candidate hash is
`3541f620344f86fc5fd63c4bee0a75d335b69cf7501a26bdaf1ad05fe2260022`:
179 LOC, 4 tests, 13 static `expect(` calls, and 26 runtime assertions.
Target accounting is 4/4 tests and 13/13 static expectations; all four tests
passed and all 26 runtime assertions executed against the fixture.

RED was the mounted-data version: `0 pass, 4 fail`, each `ENOENT`. GREEN uses
a temporary directory, the complete 15-file (3 symbols × 5 timeframes) CSV
matrix, and a minimal manifest; it runs `CsvExchangeFeed` there and removes
the directory. It makes no mounted-data completeness claim.

R1 removed three lint suppressions using Bun I/O. The initial TECH review P2
required manifest integrity; R2 added exact matrix, filenames, and metadata
checks. TECH R2 was **PASS**. The first PROCESS review was **FAIL** for
evidence insufficiency; this is evidence-only remediation and needs fresh
independent process re-review.

## Exact validation record

The exact validation commands and receipts were:

- `bun test packages/backtest-tools/src/cli/run-baseline.test.ts` — `4 pass,
0 fail (26 runtime assertions)`, exit 0.
- `bunx eslint --max-warnings=0 packages/backtest-tools/src/cli/run-baseline.test.ts`
  — `0 errors, 0 warnings`, exit 0.
- `bunx prettier --check packages/backtest-tools/src/cli/run-baseline.test.ts plans/full-refactor/evidence/run-baseline-hermetic-phase-removal-2026-08-30.md plans/full-refactor/REVIEW-EVIDENCE.md` — pass, exit 0.
- `git diff HEAD --check -- packages/backtest-tools/src/cli/run-baseline.test.ts plans/full-refactor/evidence/run-baseline-hermetic-phase-removal-2026-08-30.md plans/full-refactor/REVIEW-EVIDENCE.md` — exit 0.
- `wc -l packages/backtest-tools/src/cli/run-baseline.test.ts plans/full-refactor/evidence/run-baseline-hermetic-phase-removal-2026-08-30.md` — `179` and the final evidence-file count recorded below.
- `if rg -n 'openat|openat2|/proc/self/fd|O_NOFOLLOW|config reload|config-reload|eslint-disable' packages/backtest-tools/src/cli/run-baseline.test.ts; then exit 1; else exit 0; fi` — no matches, wrapper exit 0.
- `if rg -n '(API_KEY|SECRET|PRIVATE_KEY|PASSWORD|TOKEN)=' packages/backtest-tools/src/cli/run-baseline.test.ts plans/full-refactor/evidence/run-baseline-hermetic-phase-removal-2026-08-30.md plans/full-refactor/REVIEW-EVIDENCE.md; then exit 1; else exit 0; fi` — no matches, wrapper exit 0.
- `git diff --cached --name-only -- packages/backtest-tools/src/cli/run-baseline.test.ts plans/full-refactor/evidence/run-baseline-hermetic-phase-removal-2026-08-30.md plans/full-refactor/REVIEW-EVIDENCE.md` — no paths, exit 0.

Package command: `tmpdir=$(mktemp -d /tmp/mm-run-baseline-coverage.XXXXXX) && (cd packages/backtest-tools && bun test src --coverage --coverage-reporter=lcov --coverage-dir "$tmpdir")`. Receipt: 345 tests total, 336 pass, 9 external failures, 886 expectations. This is not a package-wide PASS. Typecheck command `bun run --filter @mm-crypto-bot/backtest-tools typecheck` remains externally blocked at `packages/backtest-tools/src/data/live-latency-source.ts:68` (`number | null` versus `number | undefined`).

After final formatting, the evidence file is 77 LOC. Candidate `sha256sum` remains
`3541f620344f86fc5fd63c4bee0a75d335b69cf7501a26bdaf1ad05fe2260022`.

## Boundaries and rollback

The bounded claim is only hermetic symbol/timeframe mapping and fixture
compatibility. No production, schema, data, configuration, `openat`,
descriptor, or config-reload change occurred; nothing was staged or committed.
Rollback is restoring the candidate test to its HEAD object and removing this
evidence/index addition; no external state is involved.
