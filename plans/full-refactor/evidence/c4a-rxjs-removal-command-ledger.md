# C4a RxJS prototype removal command ledger

**Recorded:** `2026-08-18` (Spark worker scope)
**CWD:** `/home/eggp/projects/mm-crypto-bot`
**Scope:** `temp/ts/rxjs/**` tree delete, lint-script cleanup, fail-closed lint-contract
guard, no dependency/lock mutation.

## Source inventory and zero-reference checks

```sh
git ls-tree -r --name-only 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- temp/ts/rxjs
git ls-tree -r --name-only 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- temp/ts/rxjs | wc -l
git diff --name-status 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- temp/ts/rxjs
git diff --name-status 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- temp/ts/rxjs | wc -l
test ! -e temp/ts/rxjs
test ! -e temp/ts
git grep -n "@streamnet/ts-rxjs" 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- .
git grep -n "@streamnet/ts-rxjs" 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- . ':(exclude)temp/ts/rxjs/**'
git grep -n "deepDistinctUntilChanged" 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- .
git grep -n "deepDistinctUntilChanged" 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- . ':(exclude)temp/ts/rxjs/**'
git grep -n "from 'rxjs'" 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- .
git grep -n "from 'rxjs'" 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- . ':(exclude)temp/ts/rxjs/**'
git grep -n "from \"rxjs\"" 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- .
git grep -n "from \"rxjs\"" 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- . ':(exclude)temp/ts/rxjs/**'
git grep -n "temp/ts/rxjs" -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'
git grep -n "@streamnet/ts-rxjs" -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'
git grep -n "deepDistinctUntilChanged" -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'
git grep -n "from 'rxjs'" -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'
git grep -n "from \"rxjs\"" -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'
```

Result summary:

- `git ls-tree -r --name-only 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- temp/ts/rxjs` exited `0` and listed **11** tracked prototype files:
  - `temp/ts/rxjs/README.md`
  - `temp/ts/rxjs/eslint.config.mjs`
  - `temp/ts/rxjs/package.json`
  - `temp/ts/rxjs/project.json`
  - `temp/ts/rxjs/src/index.ts`
  - `temp/ts/rxjs/src/lib/operator/deep-distinct-until-changed.spec.ts`
  - `temp/ts/rxjs/src/lib/operator/deep-distinct-until-changed.ts`
  - `temp/ts/rxjs/tsconfig.json`
  - `temp/ts/rxjs/tsconfig.lib.json`
  - `temp/ts/rxjs/tsconfig.spec.json`
  - `temp/ts/rxjs/vitest.config.mts`
- `git ls-tree -r --name-only 246d... -- temp/ts/rxjs | wc -l` exited `0` and printed `11`.
- `git diff --name-status 246d... -- temp/ts/rxjs` exited `0` and printed 11 staged/unstaged deletions (current working-tree slice is absent).
- `git diff --name-status 246d... -- temp/ts/rxjs | wc -l` exited `0` and printed `11`.
- `test ! -e temp/ts/rxjs` exited `0` (path absent).
- `test ! -e temp/ts` exited `0` (path absent).
- `git grep -n "@streamnet/ts-rxjs" 246d... -- .` exited `0` and found one match at
  `temp/ts/rxjs/package.json`.
- `git grep -n "@streamnet/ts-rxjs" 246d... -- . ':(exclude)temp/ts/rxjs/**'` exited `1` (no out-of-tree baseline consumer).
- `git grep -n "deepDistinctUntilChanged" 246d... -- .` exited `0` and found only matches in `temp/ts/rxjs` sources.
- `git grep -n "deepDistinctUntilChanged" 246d... -- . ':(exclude)temp/ts/rxjs/**'` exited `1` (no out-of-tree baseline consumer).
- `git grep -n "from 'rxjs'" 246d... -- .` exited `0` and found only the two test imports in `temp/ts/rxjs`.
- `git grep -n "from 'rxjs'" 246d... -- . ':(exclude)temp/ts/rxjs/**'` exited `1` (no out-of-tree baseline consumer).
- `git grep -n 'from "rxjs"' 246d... -- .` exited `1`.
- `git grep -n 'from "rxjs"' 246d... -- . ':(exclude)temp/ts/rxjs/**'` exited `1`.
- `git grep -n "temp/ts/rxjs" -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'` exited `1`.
- `git grep -n "@streamnet/ts-rxjs" -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'` exited `1`.
- `git grep -n "deepDistinctUntilChanged" -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'` exited `1`.
- `git grep -n "from 'rxjs'" -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'` exited `1`.
- `git grep -n 'from "rxjs"' -- . ':(exclude)temp/ts/rxjs/**' ':!plans/**' ':!.codex/ENGINEERING-STANDARDS.md' ':!plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md' ':!plans/full-refactor/EXECUTION-RECORD.md' ':!scripts/tooling/toolchain-contract.test.ts'` exited `1`.

```sh
git diff --name-only 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- bun.lock
git diff --name-only 246d772ad965723fd31040e7c9d62f6d094dd7d2 -- temp/ts/rxjs
git grep -n "temp/ts/rxjs" package.json scripts/tooling/toolchain-contract.test.ts .github/workflows/ci.yml apps packages scripts
bun test scripts/tooling/toolchain-contract.test.ts
```

Result summary:

- `git diff --name-only 246d... -- bun.lock` exited `0` with no changes (lockfile unchanged across baseline slice boundary).
- `git diff --name-only 246d... -- temp/ts/rxjs` exited `0` and printed 11 deleted entries (current working tree deletion of the temp prototype tree).
- `git grep -n "temp/ts/rxjs" package.json scripts/tooling/toolchain-contract.test.ts .github/workflows/ci.yml apps packages scripts`
  exited `0` and printed expected guard assertions in `scripts/tooling/toolchain-contract.test.ts`.

`bun test scripts/tooling/toolchain-contract.test.ts` exited `0` (9 pass), including in-memory “present path” assertion through injected `() => Promise.resolve(undefined)`.

## Script and tooling contracts

```sh
bun run lint
bunx eslint scripts/tooling/toolchain-contract.test.ts
bun test scripts/tooling/toolchain-contract.test.ts
echo "FORMAT_FAILURE_PATH=plans/full-refactor/evidence/c3b-invalid-engine-export.fixture.ts"
bunx prettier --check plans/full-refactor/evidence/c3b-invalid-engine-export.fixture.ts
bunx prettier --check package.json scripts/tooling/toolchain-contract.test.ts plans/full-refactor/EXECUTION-RECORD.md plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md
bun run typecheck
bun run build
git diff --check
```

Result summary:

- `bun run lint` exited `1` (pre-existing repository-wide lint findings, unrelated
  to this edit).
- `bunx eslint scripts/tooling/toolchain-contract.test.ts` exited `0`.
- `bun test scripts/tooling/toolchain-contract.test.ts` exited `0` (9 pass),
  including new `lint`/`lint:hook` string and path-absence fail-closed tests.
- `bunx prettier --check plans/full-refactor/evidence/c3b-invalid-engine-export.fixture.ts` exited `2` (format failure path is exact fixture path above).
- `bunx prettier --check package.json scripts/tooling/toolchain-contract.test.ts plans/full-refactor/EXECUTION-RECORD.md plans/full-refactor/evidence/c4a-rxjs-removal-command-ledger.md` exited `0`.
- `bun run typecheck` exited `0`.
- `bun run build` exited `0`.
- `git diff --check` exited `0`.

## Reference/path/whitespace/secret checks

```sh
rg -nP "[\\t ]+$" package.json scripts/tooling/toolchain-contract.test.ts
rg -n -i "(api[_-]?key|secret|token|password|private[_-]?key)" package.json scripts/tooling/toolchain-contract.test.ts
```

Result summary:

- Both commands produced zero matches and exit code `1` on no-match paths.
- No lockfile/dependency files were edited (unchanged `bun.lock`).
