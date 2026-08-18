# C4b Numeric Command Ledger — DRAFT

**Recorded:** `2026-08-18T04:11:45+0200` Europe/Budapest

**CWD:** `/home/eggp/projects/mm-crypto-bot`

**Scope:** `packages/numeric/**`, exact `bun.lock` dependency record, and C4b
evidence only. Package gates and wrappers listed below exited `0`; raw `rg`
no-match probes intentionally exit `1` and are never treated as direct PASS.
This is implementation evidence, not review closure.

## Package gates

```sh
bunx prettier --check packages/numeric
bunx eslint packages/numeric --max-warnings=0
bun run --filter @mm-crypto-bot/numeric typecheck
bun run --filter @mm-crypto-bot/numeric build
bun test packages/numeric/src
bunx vitest run --config packages/numeric/vitest.config.ts --coverage
bun run --filter @mm-crypto-bot/numeric coverage
```

These prove Prettier, 0-error/0-warning strict lint, typecheck, the package's
`tsc --noEmit` build contract, 34 Bun tests with 569 expectations, and direct
and root-filter threshold-enforced V8 coverage: 157/157 statements, 114/114
branches, 38/38 functions, and 156/156 lines.

## Workspace and public API contracts

```sh
bunx turbo run typecheck --filter=@mm-crypto-bot/numeric --dry-run=json > /tmp/c4b-turbo-dry-run-final.json
rg -q '"@mm-crypto-bot/numeric#typecheck"' /tmp/c4b-turbo-dry-run-final.json
bun test packages/numeric/src/public-api.test.ts
rg -l 'from "fraction\.js"' packages/numeric/src --glob '!*.test.ts'
```

Turbo discovery and the public/deep-import test passed. The raw dependency scan
has exactly one production match, the internal normalizer; the package barrel
exports no raw `Fraction` value.

## Boundary and integrity scans

The following fail-closed wrapper was replayed for every no-match scan. It
distinguishes the expected raw `rg` exit `1` from raw match exit `0` and all
tool failures (`>=2`); only the expected no-match branch returns wrapper exit
`0`.

```sh
require_zero_match() {
  local scan_name=$1
  shift
  local scan_output
  scan_output=$("$@" 2>&1)
  local scan_exit=$?
  case "$scan_exit" in
    1) print -r -- "$scan_name raw_exit=1 match_count=0 wrapper_exit=0"; return 0 ;;
    0) print -r -- "$scan_name raw_exit=0 wrapper_exit=70"; return 70 ;;
    *) print -r -- "$scan_name raw_exit=$scan_exit wrapper_exit=$scan_exit"; return "$scan_exit" ;;
  esac
}
require_zero_match numeric_boundary rg -n '\bNumber\(|\.valueOf\(|\b(round|ceil|floor)\(' packages/numeric/src --glob '!*.test.ts'
require_zero_match numeric_consumers rg -l '@mm-crypto-bot/numeric|packages/numeric' --glob '!packages/numeric/**' --glob '!plans/**' --glob '!bun.lock' --glob '!node_modules/**' .
require_zero_match skip_only rg -n '\.(skip|only)\(' packages/numeric --glob '*.ts'
require_zero_match coverage_ignore rg -n 'coverage ignore|istanbul ignore' packages/numeric --glob '*.ts'
require_zero_match secret_signatures rg -l -i '(api[_-]?key|secret|token|password|private[_-]?key)[[:space:]]*[:=]' packages/numeric --glob '*.ts' --glob 'package.json' --glob 'tsconfig.json' --glob 'vitest.config.ts'
```

The replay results are `numeric_boundary`, `numeric_consumers`, `skip_only`,
`coverage_ignore`, and `secret_signatures`: raw exit **1**, 0 matches, wrapper
exit **0** each. The secret scan never emits values and is not a comprehensive
secret audit. Per-file `wc -l` over every non-generated TypeScript path found
zero files over 500 lines. `git status --short --ignored` reports only ignored
`packages/numeric/coverage/` and `packages/numeric/node_modules/`
generated/local paths; neither is staged.

## Diff and coverage evidence

`git diff --check` passed. Every current untracked regular C4b first-party path
uses `git diff --no-index --check /dev/null <path>` with expected exit 1 and
zero diagnostics; the replay's 14 paths include 12 package files and the two
C4b evidence artifacts.

The generated, ignored, unstaged coverage files are
`packages/numeric/coverage/coverage-summary.json` SHA-256
`5979190b9a0720f289b8f81b7234c87ea8ae013ac350fb1dcd296a3d2e2351e1` and
`packages/numeric/coverage/lcov.info` SHA-256
`e84ff69980beca4a1e64f10b3190618bbd7c096b1b296d6c7dc4a9da5df7334c`.

The oversized-input regression scopes a `BigInt.prototype.toString` spy to one
test and restores it in `finally`; its typed `MAGNITUDE_LIMIT` path observed
zero serialization calls. The production control flow invokes the central bound
before the sole `new Fraction(...)` statement. A constructor mock is not used:
the Bun test runner does not provide a reliable hoisted mock facility, so this
ledger makes no separate mock-based constructor-call claim.

The exact lock SHA-256 is
`98d327ba77248ed8e514f27991a4f43582380742ac3dc2fd87ffea8d04636c1e`.
`bun pm untrusted` exited 0 and reports only blocked Lefthook postinstall;
`trustedDependencies` remains exactly `ccxt`. `bun pm ls fraction.js` exited 0
and includes `@mm-crypto-bot/numeric@workspace:packages/numeric`.

The normalized audit output is
[c4b-bun-audit-2026-08-18.txt](c4b-bun-audit-2026-08-18.txt), SHA-256
`632baba77d06bc1d76bc81a2e40e7fdaaf504af73f5197b382aa21583890a6a9`.
