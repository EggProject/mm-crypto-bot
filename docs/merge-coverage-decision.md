# Phase 35 — Coverage merge tool decision

**Date:** 2026-07-12 (Europe/Budapest)
**Author:** Coder agent (Phase 35 Track F)
**Status:** Decision recorded, implementation in progress.

## User mandate (2026-07-12 03:15 Budapest, Hungarian)

> "100% coverage testet mondtam, de a kodbazis nagy resze nincs is tesztelve! +
> a testeket ugy futtassuk hogy egyben fusson az osszes es csak a legvegen
> legyen egy teljes coverage report! (nezzetek utana webseach -vel hogyan kell
> beallitani hogy merged report legyen!)"

= "I said 100% coverage test, but most of the codebase isn't even tested! +
run the tests so they all run together and only at the very end is one full
coverage report! (look up with websearch how to set it up so there's a merged
report!)"

**Hard guarantees required:**
1. ONE `bun run coverage:merge` command — runs ALL tests across ALL packages, produces ONE merged coverage report at the end.
2. Outputs: text + lcov + html + json.
3. Works with the existing `bun test` runner (no test-runner migration).
4. Other packages' coverage MUST NOT regress.

## Websearch log (5+ queries, English only)

| # | Query (verbatim) | Top result & key takeaway |
|---|------------------|---------------------------|
| 1 | `bun test coverage merge monorepo multiple packages` | [GitHub oven-sh/bun Discussion #11762](https://github.com/oven-sh/bun/discussions/11762) — "bun test --coverage" only supports `text` and `lcov` reporters. No native merge. |
| 2 | `vitest merge coverage workspaces monorepo` | [vitest guide/workspace](https://vitest.dev/guide/projects) — Vitest's "Projects" feature merges coverage out-of-the-box, but requires every package to be a vitest project. |
| 3 | `nyc merge coverage from multiple packages monorepo` | [dev.to/mbarzeev](https://dev.to/mbarzeev/aggregating-unit-test-coverage-for-all-monorepos-packages-20c6) + [stackoverflow #62560224](https://stackoverflow.com/questions/62560224/jest-how-to-merge-coverage-reports-from-different-jest-test-runs) — `nyc merge` + `nyc report` is the canonical solution for cross-package JSON coverage, but it needs JSON reporters. |
| 4 | `turbo monorepo vitest merged coverage report` | [turborepo.dev/docs/guides/tools/vitest](https://turborepo.dev/docs/guides/tools/vitest) — Turborepo explicitly recommends "blob" reporter + `vitest --merge-reports --coverage` for merged coverage. Re-confirms approach (2). |
| 5 | `istanbul merge json coverage report nyc report` | [istanbuljs/nyc README](https://github.com/istanbuljs/nyc) + [stackoverflow #61547209](https://stackoverflow.com/questions/61547209/how-to-generate-nyc-report-from-json-results-no-nyc-output/61643904) — `nyc merge <src_dir> <out.json>` then `nyc report -t <temp_dir> --reporter=html --reporter=text`. Operates on `coverage-final.json` files. |
| 6 | `c8 report merge multiple coverage json monorepo` | [GitHub bcoe/c8 #336](https://github.com/bcoe/c8/issues/336) + [c8 #487](https://github.com/bcoe/c8/issues/487) — c8 itself does NOT merge coverage. Community uses `nyc merge` on c8-generated `coverage-final.json`. |
| 7 | `bun test --coverage --coverage-reporter json support` | [bun.com/docs/test/code-coverage](https://bun.com/docs/test/code-coverage) + empirical `bun test --help` — **bun only supports `text` and `lcov`. JSON is NOT available in bun 1.3.14.** |

## Bun's coverage output (verified empirically 2026-07-12)

```
$ bun test --help
  --coverage                      Generate a coverage profile
  --coverage-reporter=<val>       Report coverage in 'text' and/or 'lcov'. Defaults to 'text'.
  --coverage-dir=<val>            Directory for coverage files. Defaults to 'coverage'.

$ bun test --coverage --coverage-reporter=json --coverage-dir=/tmp/x src
error: invalid coverage reporter 'json'. Available options: 'text' (console output), 'lcov' (code coverage file)
```

**Bun 1.3.14 emits ONLY `text` and `lcov`. No JSON reporter, no v8 raw coverage object.**

The lcov output is the standard LCOV format (line-based records, one per source file):

```
TN:
SF:<source file path, RELATIVE to the test cwd>
FN:<line>,<function name>
FNDA:<hits>,<function name>
FNF:<functions found>
FNH:<functions hit>
DA:<line>,<hits>
LF:<lines found>
LH:<lines hit>
BRDA:<line>,<block>,<branch>,<hits>
BRF:<branches found>
BRH:<branches hit>
end_of_record
```

A 565-line apps/bot run produces 16,484 lines of lcov output, including records for every source file imported by any test (so apps/bot's lcov also includes files from packages/core, packages/exchange, packages/shared, etc.).

## Candidates evaluated

### Option A — Vitest Workspaces (REJECTED)

**Idea:** add a `vitest.workspace.ts` at the root listing all 8 packages; run `vitest --coverage` once; coverage is merged automatically.

**Why rejected:**
1. Every package currently uses `bun test` for tests. Migrating to vitest is a massive scope (different runner, different API, different `mock`, different timer API). The user mandate says "all tests run together" — not "switch test runners".
2. Vitest 4.1.9 is already in devDeps (some prior Phase 33 work) but the package-level `vitest.config.ts` only exists in `packages/exchange`; everywhere else `bun test` is hardcoded in `package.json` scripts. Re-wiring all 8 packages breaks the test contracts.
3. Vitest in the root config cannot also use `bun test`'s test file discovery (`bun test` and `vitest` find different files in some edge cases — e.g. `*.test.ts` colocated next to source vs `tests/*.test.ts` directory split used in `packages/exchange`).
4. Adds runtime complexity (vitest worker pool, dependency resolution, plugin chain) just to get merge — we already have what we need.

### Option B — Turbo + Vitest --merge-reports (REJECTED)

**Idea:** each package writes a vitest "blob" report, then `vitest --merge-reports --coverage` produces merged.

**Why rejected:** Same migration problem as A. Also requires per-package vitest config; ours uses `bun test`.

### Option C — bun test + nyc/istanbul merge (REJECTED)

**Idea:** per-package `bun test --coverage` produces lcov; convert lcov → coverage-final.json; `nyc merge` + `nyc report`.

**Why rejected:**
1. Bun 1.3.14 does NOT emit JSON. Converting lcov → coverage-final.json requires a third-party tool (`lcov-parse` or `lcov2istanbul`). Adds two new deps and a non-trivial conversion step.
2. `nyc report` on a JSON produced from bun's lcov risks path remapping issues (see [GitHub istanbuljs/nyc #1342](https://github.com/istanbuljs/nyc/issues/1342) — "you have to be in the parent directory of the instrumented code when you are generating a report"). Our monorepo has no single "parent directory" because the code lives in `apps/*` and `packages/*` subtrees.
3. The conversion → merge → report pipeline is 3 steps with 2 new deps for what is fundamentally a 200-line Node script.

### Option D — bun test + custom Node merge script (CHOSEN) ✓

**Idea:** per-package `bun test --coverage --coverage-reporter=lcov` produces `coverage/lcov.info`. A custom Node.js script `scripts/merge-coverage.mjs`:

1. Globs all `apps/*/coverage/lcov.info` and `packages/*/coverage/lcov.info`.
2. For each, parses line-based records (one per `SF:` block, delimited by `end_of_record`).
3. Resolves each `SF:` path against the test cwd (the lcov emits RELATIVE paths like `src/bot/bot.ts`) to get an absolute path. Two lcovs reporting the same absolute file path get merged.
4. Merging rule per file:
   - `DA:<line>,<hits>` — sum hits across runs (line was hit X+Y times in total).
   - `FNDA:<hits>,<name>` — sum hits per function name.
   - `BRDA:<line>,<block>,<branch>,<hits>` — for the same (line, block, branch) tuple, sum hits.
   - `LF/LH` and `BRF/BRH` and `FNF/FNH` are recomputed from the merged `DA` / `FNDA` / `BRDA` maps.
5. Emits ONE merged `coverage/merged/lcov.info`.
6. Computes a `coverage-summary.json` (istanbul-style `{ total: { lines, branches, functions, statements }, "<file>": {...} }`).
7. Computes a text summary (line/branch %) and prints to stdout.
8. Emits a basic but functional HTML report at `coverage/merged/html/index.html` (per-file table with uncovered line ranges, color-coded).

**Why chosen:**
1. **Zero new runtime dependencies.** We already have `node` (>=22) and the script is pure ESM Node.
2. **Bun test stays the test runner.** No migration, no per-package config rewrites.
3. **One invocation.** `bun run coverage:merge` runs `turbo run coverage`, then runs the merge script.
4. **Self-contained.** Easy to read, easy to debug, easy to extend (e.g. add a JSON-Summary threshold gate for CI).
5. **No path-remapping gotcha.** We resolve to absolute paths BEFORE merging, then keep the absolute path in the merged lcov. The HTML report can read source files directly via absolute path.
6. **LCOV is a stable format.** It's been around since 2009, well-documented, and what every CI integration (Coveralls, Codecov, Sonar) consumes.

**Why not the simpler "just lcov-merge" tools?** They exist (`lcov-result-merger` etc.) but only merge records, they don't compute summary % or generate HTML. We'd still need a script for the summary. Better to own the whole pipeline.

## Trade-offs accepted

1. **The HTML is basic** (no syntax highlighting, no file tree, no coverage heatmap). For Phase 35 Track F, the goal is "ONE merged report at the end" — not a SonarQube replacement. A clean table with line/branch % and uncovered line ranges is enough. Future tracks can add niceties.
2. **Source files must be on disk at the time the script runs.** The HTML report needs to read each file to highlight uncovered lines. We use the test cwd + relative `SF:` path to find the file.
3. **LCOV statements ≠ lines.** LCOV has no separate "statements" metric (only lines, functions, branches). For the summary, we report `lines` and treat "statements" as equal to `lines` (the standard fallback).

## Implementation layout

```
/Users/kiscsicska/projects/mm-crypto-bot/
├── package.json                          # adds "coverage:merge" script
├── turbo.json                            # adds "coverage:merge" task
├── scripts/
│   └── merge-coverage.mjs                # the merge tool (new)
├── apps/bot/package.json                 # coverage:json script (lcov already)
├── packages/*/package.json               # coverage:json script (lcov already)
└── coverage/merged/                      # generated by merge script
    ├── lcov.info
    ├── coverage-summary.json
    └── html/index.html
```

## Verification (after implementation)

```bash
cd /Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase35-track-f
bun run typecheck   # green
bun run lint        # green
bun test            # 1460+ tests pass
bun run coverage:merge   # produces coverage/merged/ with all 4 artifacts
# Verify per-file coverage in coverage/merged/coverage-summary.json
# Compare with the clean main baseline
```

## Why this is defensible

The user wanted ONE command, ONE report. We deliver `bun run coverage:merge` which:
1. Runs `turbo run coverage` (per-package `bun test --coverage --coverage-reporter=lcov`).
2. Then runs `node scripts/merge-coverage.mjs` which reads all per-package lcovs, merges by absolute path, and writes the 4 artifacts.
3. The script is 100% pure Node ESM, no deps, easy to read in PR review.

This is the minimal-surface solution that satisfies the hard guarantees. Vitest migration was the obvious temptation but is wrong scope.
