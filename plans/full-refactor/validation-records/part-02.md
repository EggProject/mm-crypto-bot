# Active validation records — part 2

This is an active continuation of [VALIDATION.md](../VALIDATION.md) and [part 1](part-01.md).

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

### C4a typing foundation migration

The C4a source tree is absent (`test ! -e temp/ts/typing` exited 0). Its
baseline at `9add1e445841b67b8f36cf035590026ff2198000` had 46 files, 23 test
files, and 235 literal test names; durable evidence is linked from [the C4a
inventory](../evidence/c4a-typing-source-inventory.md). The private workspace
package exports only `.`. Its public-barrel positive import and physical
internal-subpath negative import tests both passed.

Package Prettier, strict ESLint, typecheck, deterministic build, four Bun tests,
root-filter typecheck discovery, and V8 coverage passed. V8 counts are 1/1
statements, 0/0 branches, 1/1 functions, and 1/1 lines. Coverage JSON-summary
and LCOV SHA-256 values are recorded in ER-047 and remain ignored/generated/not
staged. Lifecycle-disabled lock generation and frozen install passed without
package changes; Bun reported untrusted Lefthook lifecycle metadata as blocked.
Turbo build discovery found the root generic output declaration
`[".turbo/build/**","dist/**"]` while this package intentionally emits no
build artifact; direct package build is a real `tsc --noEmit` check. The root
Turbo output contract is outside C4a ownership and is not claimed as validated.

Active source/config/manifests have zero old-path and `@streamnet` matches. The
full-repository brand scan has 19 matches: 16 in out-of-scope
`temp/ts/{typeguard,assert,rxjs}` source and three necessary C4a evidence rows.
The full old-path scan has 287 evidence/plan matches, including the durable
baseline manifests. These are **NOT PASS** global-absence results; C4a cannot
edit the out-of-scope source, and the evidence must remain for review. Their
closure awaits separately owned migrations.

### C4a expanded foundation migration

ER-048 expands the pending C4a implementation evidence to the private internal
`@mm-crypto-bot/typing`, `@mm-crypto-bot/typeguard`, and
`@mm-crypto-bot/assert` packages. The directed package graph is
`typing <- typeguard <- assert`; each package exposes only `.` and has a
public-barrel positive and physical deep-subpath negative import contract.
The source inventories and keep/drop manifests are [typing](../evidence/c4a-typing-source-inventory.md),
[typeguard](../evidence/c4a-typeguard-source-inventory.md), and
[assert](../evidence/c4a-assert-source-inventory.md).

All three source trees are absent and `temp/ts/rxjs` remains outside this
slice. Each package passed Prettier, ESLint with zero warnings, `tsc --noEmit`
typecheck/build, its Vitest suite (typing 4/4, typeguard 3/3, assert 4/4), and
threshold-enforced V8 coverage:

| Package     | Statements | Branches | Functions | Lines |
| ----------- | ---------- | -------- | --------- | ----- |
| `typing`    | 1/1        | 0/0      | 1/1       | 1/1   |
| `typeguard` | 16/16      | 15/15    | 11/11     | 15/15 |
| `assert`    | 14/14      | 10/10    | 7/7       | 9/9   |

The lifecycle-disabled `bun install --ignore-scripts` lock update and the
repository-CWD `bun install --frozen-lockfile --ignore-scripts` both completed
without lifecycle execution. The frozen command checked 262 installs across
287 packages and preserved the main `.git/hooks` inventory hash
`2cbf26be4cfe5e6c621a2b2759cf5913880abcbb018617a5f4e4a7e27ccf62d9`.
Generated coverage remains ignored/not staged. The bounded active
source/configuration/manifest scan found zero removed-path or removed-brand
references after excluding plan evidence and out-of-scope `temp/ts/rxjs`; the
full removed-path evidence scan has 364 matches and is not a global-absence
claim. This evidence is **PENDING TECHNICAL AND PROCESS RE-REVIEW**.

### C4a runtime-boundary and evidence remediation

ER-049 supersedes the current runtime-boundary and provenance portions of the
earlier C4a evidence. `isRecord` now admits only plain or null-prototype
objects, reads the prototype once, and catches an adversarial prototype trap.
`isDate` proves Date identity from the internal `getTime` slot instead of a
realm-dependent prototype check; valid cross-realm Date values pass, while an
invalid Date, a Date-prototype-only object, ordinary object, nil/primitive, and
proxy inputs fail closed without escaping an exception.

The exact package gate sequence from repository CWD exited 0:

```sh
bunx prettier --check packages/typing packages/typeguard packages/assert
bunx eslint packages/typing packages/typeguard packages/assert --max-warnings=0
bun run --filter @mm-crypto-bot/typing typecheck
bun run --filter @mm-crypto-bot/typeguard typecheck
bun run --filter @mm-crypto-bot/assert typecheck
bun run --filter @mm-crypto-bot/typing build
bun run --filter @mm-crypto-bot/typeguard build
bun run --filter @mm-crypto-bot/assert build
bunx vitest run --config packages/typing/vitest.config.ts --coverage
bunx vitest run --config packages/typeguard/vitest.config.ts --coverage
bunx vitest run --config packages/assert/vitest.config.ts --coverage
```

The final V8 numerator/denominator evidence is typing **1/1, 0/0, 1/1, 1/1**;
typeguard **26/26, 23/23, 11/11, 23/23**; assert **14/14, 10/10, 7/7, 9/9**.
The exact coverage hashes are in ER-049; coverage remains generated, ignored,
and unstaged.

The checked [baseline inventory helper](../evidence/c4a-source-inventory.mjs)
uses the fixed baseline ref, accepts exactly one selector, and only writes its
result to stdout. Positive replays for all three durable hash manifests exited
0 and matched byte-for-byte; zero/extra/invalid selectors exited 64/65/66, and
temporary missing-ref/missing-path controls exited 67/68. The exact temporary
fixtures were removed after each replay.

The manifest [c4a-untracked-first-party-paths.txt](../evidence/c4a-untracked-first-party-paths.txt)
has 31 current first-party untracked paths, excluding ignored generated coverage
and dependency directories. Its [whitespace checker](../evidence/c4a-check-untracked-whitespace.mjs)
requires one `--manifest` argument, validates regular non-symbolic-link files,
limits every path to the C4a roots, requires the expected no-index exit 1 with
no diagnostics, and then requires tracked `git diff --check` exit 0. The
positive replay exited 0; an exact temporary manifest containing one nonexistent
allowed path exited 71 and was removed. This is **PENDING TECHNICAL AND PROCESS
RE-REVIEW**, not a broader implementation PASS.

### C4a evidence-helper hardening

ER-050 is the current helper-evidence record. The inventory helper parses
NUL-delimited Git tree records and permits only `100644`/`100755` blobs before
reading content. Current baseline replays remain byte-identical at 47/41/33
lines; a committed exact symbolic-link fixture exited 71 and was removed.
The whitespace helper canonicalizes the repository, manifest, allowed roots,
and targets, rejects traversal at 71 and an exact temporary parent-symlink
probe at 74, and retains the current 31-path positive exit 0.

At CWD `/home/eggp/projects/mm-crypto-bot`, `bun install --ignore-scripts`
exited 0, checked 262 installs across 287 packages, and produced lock SHA-256
`e90148f0f1dd804f5a1c3d0ecbc7bb87a3db31e941acc33a116c701ad86b8f38`.
The isolated frozen-install hashes are fixture-before/after
`8d21ef45c5f51fd4784cd3ca14ca5f2e90b39ed2985abf88a46cd4fc7f3ff6c8` and
main-before/after `2cbf26be4cfe5e6c621a2b2759cf5913880abcbb018617a5f4e4a7e27ccf62d9`.
Root trust remains only `ccxt`; Lefthook postinstall is blocked by Bun. This
evidence is **PENDING TECHNICAL AND PROCESS RE-REVIEW**.

### C4b exact numeric foundation

ER-056 is the sole current C4b implementation/evidence record. ER-052 through
ER-055 are historical only; ER-056 supersedes their implementation, magnitude
precheck, test, metric, coverage-hash, and scoped-spy limitation statements. The private
`@mm-crypto-bot/numeric` package exposes only its package barrel and retains
the audited Fraction implementation only behind immutable BigInt-backed exact
values. The bounded canonical decimal grammar rejects numbers, whitespace,
plus signs, exponent notation, noncanonical zeros, slash notation, and invalid
snapshot content. Snapshot parsing also rejects over-bound integers, accessors,
symbol/non-enumerable/extra keys, and adversarial proxy traps with typed errors.

Final package evidence is: Prettier and strict ESLint 0/0; typecheck and build
exit 0; 34 deterministic unit/contract/property tests pass; and V8 thresholds
are statements **157/157**, branches **114/114**, functions **38/38**, and
lines **156/156**. Generated coverage is ignored and unstaged; its summary
SHA-256 is `5979190b9a0720f289b8f81b7234c87ea8ae013ac350fb1dcd296a3d2e2351e1`
and LCOV SHA-256 is
`e84ff69980beca4a1e64f10b3190618bbd7c096b1b296d6c7dc4a9da5df7334c`.
The root-filter Turbo typecheck discovery exits 0. No current repository
consumer imports the package, so no consumer migration is claimed.

The exact package-command, dependency, audit, and isolated frozen-install
evidence is recorded in [the C4b command ledger](../evidence/c4b-command-ledger.md),
ER-056, and `DEPENDENCIES.md`. This C4b scope remains **PENDING TECHNICAL AND
PROCESS RE-REVIEW**; it is not a repository/full-verify/release/live-safety
PASS.

## D-07 semantic scanner implementation slice — current non-terminal evidence

The current scanner implementation evidence is
[D-07 scanner slice](../evidence/d07-zero-legacy-scanner-slice.md). At
`2026-08-24T14:13:00+02:00` Europe/Budapest, the scoped 9-file Vitest run
passed `64/64` with V8 statements `783/783`, branches `650/650`, functions
`165/165`, and lines `771/771`, across one explicit 10-source include. The
Bun-compatible subset passed `63` tests and `239` expectations. Scoped strict
TypeScript over the exact ten sources, ESLint with zero warnings,
Prettier, and no-index diff checks passed. `--skipLibCheck` in that TypeScript
command is limited to host declaration checking.

The actual CLI negative control exited `2`: its result is `fail`, its catalog
is incomplete for two explicit catalog reasons, and it has 90 findings. The
terminal probes are intentionally mixed: `docs/legacy` and `bin` are absent,
but `run-bot` and `search-best-config` are present. Therefore this is
**D-07 semantic scanner implementation slice — NOT TERMINAL / NOT PASS**.
No D-07 overall, repository-wide, package, CI, release, or scanner-integration
PASS is claimed. The initial TECH FAIL has five categories, its first re-review
has two additional fail-open categories, and its second re-review has the
command-substitution-tail and authoritative-coverage findings. The second
PROCESS re-review has one ownership-matrix finding. Fresh independent
technical/process re-reviews are now narrowly TECH PASS / PROCESS PASS with
zero open valid findings for this implementation/evidence/process scope only.
They do not alter the scanner's NOT TERMINAL / NOT PASS result. No candidate
tree/index construction or commit eligibility is created: a coordinator-built
exact scanner-only candidate and final-tree TECH/PROCESS verification remain
required, with the real 24-path index excluded and preserved.
