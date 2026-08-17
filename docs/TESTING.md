# Testing

The monorepo has unit/integration tests and fail-closed coverage gates.

## 1. Server unit / integration tests (Bun test runner)

Every server package (`apps/bot`, `packages/*`) has its own `*.test.ts` files co-located with the source. Run individually per package or all at once:

```bash
bun run test                # minden csomag, Bun test runner
```

## 2. Coverage gates

The owned, selected bot runtime scope is explicit in
`scripts/coverage-tools/bot-runtime-scope.json`. A verifier hard-fails if a
changed, non-test `apps/bot/src` runtime file is missing from that manifest. In
CI the comparison base is explicit and resolved through `git merge-base`; local
runs include tracked worktree changes and untracked runtime files.

The bot has two independent 100% statement/branch/function/line gates:

- Unit: Vitest V8 coverage runs the selected `bun:test` suites under native
  Node through a compatibility shim. Output is
  `apps/bot/coverage/unit/coverage-summary.json` and `lcov.info`.
- E2E: Istanbul instruments the owned sources before Bun bundles them. The
  canonical CLI and a separately spawned lifecycle driver run as real Bun
  child processes. PID envelopes are merged into
  `apps/bot/coverage/e2e/summary.json`. This report is never merged with unit.

The remaining workspace packages keep their Bun LCOV line gate. Bun LCOV is
not used as proof of bot branch/function/statement completeness.

```bash
bun run test:coverage-infra  # manifest/raw/gate regression tests
bun run coverage:scope       # modified runtime completeness
bun run coverage:bot:unit    # strict independent Vitest unit gate
bun run coverage:bot:e2e     # strict independent Bun subprocess gate
bun run coverage             # full fresh pipeline; same as coverage:full
bun run coverage:per-package # workspace OWN line gate
bun run coverage:merge       # egyesített lcov (informational)
bun run coverage:report      # egyesített summary
bun run coverage:html        # HTML riport (coverage/merged/html/)
bun run coverage:enforce     # = coverage:per-package
bun run coverage:full        # tests + infra + both bot gates + package LCOV
```

### Current bot coverage artifacts

Both strict gates currently pass:

| Gate | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Unit (23 files, 482 tests) | 1599/1599 (100%) | 866/866 (100%) | 278/278 (100%) | 1495/1495 (100%) |
| Bun subprocess E2E (45/45 required cases) | 1597/1597 (100%) | 866/866 (100%) | 279/279 (100%) | 1492/1492 (100%) |

The unit and subprocess reports remain separate. Neither gate ignores owned
files, branches or counters. The full repository pipeline still fails closed on
the separate workspace OWN-line gate because only 4/7 packages currently reach
100%.
