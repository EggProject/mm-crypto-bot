# Bot runtime network guard partial-install remediation evidence

## Scope and durable brief

- **Objective:** provide a deterministic regression replay for the candidate
  restoration fix. When a required outbound-network boundary is unavailable
  during installation, every boundary patched before that failure must be
  restored; the guard must not publish partial global state. The candidate also
  keeps the `WebSocket` blocker constructable for capability detection while
  blocking outbound use.
- **Task class:** documentation/evidence write for security and runtime-network
  guard provenance. The security boundary and its partial-mutation failure are
  the recorded Terra trigger. This is bounded replay/evidence reasoning, not a
  product, trading, risk, or network-behaviour decision.
- **Read/write mode and ownership:** workspace-write. The sole repository file
  owned by this evidence task is this document. The candidate source, test and
  Vitest configuration were copied only into `/tmp` for replay; they were not
  edited, staged, or committed in the shared worktree. Other dirty files remain
  owned by their existing agents/users.
- **Package count and boundary:** one root-tooling area,
  `scripts/coverage-tools`, plus this evidence file. No external or mutable
  resource was used; the test's deliberate network attempts were intercepted
  before I/O.
- **Requested route:** `terra_worker`, `gpt-5.6-terra`, high reasoning effort;
  non-review. Effective model/effort are not observable in the local execution
  record. The applicable sandbox was workspace-write with `/tmp` available.
- **Invariants and prohibitions:** all outbound boundaries fail closed; no
  partial patches survive a required-boundary failure; restoration is
  idempotent; the pre-existing valid global state is preserved; no actual
  network, secret, source/test/config edit in the shared worktree, staging, or
  commit is permitted.
- **Acceptance gates:** a clean-base RED replay with candidate test/config and
  base production source; a GREEN replay with all three candidate files;
  targeted V8 100% statements/branches/functions/lines; root coverage-tools
  typecheck; scoped ESLint with zero warnings; Prettier check; `git diff
--check`; documented hashes and line counts; then fresh independent technical
  and process review. This task does not self-review.
- **Output/report contract:** record commands, UTC timestamps, exits, durable
  log hashes, relevant failures, candidate path hashes, ownership, and the
  explicit chronology limitation for the next process reviewer.

## Exact candidate paths

1. `scripts/coverage-tools/bot-runtime-network-guard.ts` — production guard.
2. `scripts/coverage-tools/bot-runtime-network-guard.test.ts` — targeted test.
3. `scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs` —
   targeted Vitest/V8 configuration.
4. `plans/full-refactor/evidence/bot-runtime-network-guard-partial-install-remediation-2026-08-26.md`
   — this evidence record.

The detached replay base was clean commit
`abd5a2625fc84955b27c9900a2c4db1157ce1049` (`abd5a26`). Its production guard
SHA-256 was `105de6c6a50c2d66abb6e6f9e45474b98267dccca99dd2c9129004da72af0cef`.
The replay worktree was `/tmp/mm-network-guard-evidence-20260826` and was
detached at that commit.

## Post-hoc deterministic RED replay

This is a post-hoc deterministic RED replay. It proves the candidate tests fail
against the clean-base production source; it is **not** evidence that the tests
were written chronologically before the original implementation. The original
TDD chronology is not independently observable.

Only candidate test and Vitest configuration were materialized in the clean
worktree. Production remained at the base SHA above. The candidate test/config
SHA-256 values were respectively
`b435a995eb6d1a611145bbf2f1c57e373ce90cfbfabaf14bacb1a2d6b55e76cb` and
`4b2122cd2ba936b21fbb7817bb9d023fc4eecba2ea6892ec92a76130434baf05`.

| UTC time                       | Command                                                                                                                                                                     | Vitest exit | Result and durable log                                                                                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26T09:15:11.429003143Z | `bunx vitest run --config scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs`                                                                               | 1           | Sandbox run: 6/9 passed, 3 failed. In addition to the two source-regression failures, the spawned child could not start: `spawnSync bun EPERM`. `/tmp/mm-network-guard-red-20260826.log`, SHA-256 `70a56a5a1bd9b5cbe43b02f4a2155084576d4c54f499308a8e3a5d6535e0d43b`. |
| 2026-08-26T09:15:27.520056316Z | `set -o pipefail; bunx vitest run --config scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs 2>&1 \| tee /tmp/mm-network-guard-red-escalated-20260826.log` | 1           | Approved/escalated replay: 7/9 passed, 2 failed; no `EPERM`. `/tmp/mm-network-guard-red-escalated-20260826.log`, SHA-256 `45e7dd17ea58b2ac4dc355a54fd122a644f8cb12011f1e21db14414a937736c1`.                                                                          |

The precise required regression is the second escalated failure:
`fails closed for a missing required boundary without retaining partial patches`.
After the test deletes `node:http.request`, clean-base installation throws the
expected unavailable-boundary error but leaves `globalThis.fetch` replaced by a
`blocker` function. The expected original `fetch` descriptor is therefore not
restored. The other source failure proves that clean-base replaces `WebSocket`
with a non-constructable arrow function, violating capability detection.

## GREEN replay and gates

The candidate production guard was then materialized in the same detached
worktree. Its SHA-256 was
`f2b5c8677bce24c5a6d55594a8e011b49193800d7ed41e02751d3568e6371b5b`. The
candidate line counts are 174 (source), 325 (test), and 34 (Vitest config), all
below the 500-line limit.

| UTC time                       | Command                                                                                                                                                                                 | Exit | Result and durable log                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26T09:15:48.085123510Z | `set -o pipefail; bunx vitest run --config scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs 2>&1 \| tee /tmp/mm-network-guard-green-20260826.log`                     | 0    | Approved/escalated child-process replay: 9/9 passed. SHA-256 `618b2b327eca17a964a8c6e29983b08655a6fd91c56f986c4efd445b579418ab`.                              |
| 2026-08-26T09:15:56.632151194Z | `set -o pipefail; bunx vitest run --coverage --config scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs 2>&1 \| tee /tmp/mm-network-guard-green-coverage-20260826.log` | 0    | Approved/escalated: 9/9 passed; V8 S 61/61, B 40/40, F 13/13, L 56/56 (all 100%). SHA-256 `28b16c9d9f36a5e9b2db4467fea2ccefab3eeacbf36220604602ae202308d836`. |

The first attempted root typecheck in the detached worktree had no local
workspace installation, so it could not resolve workspace packages. After
`bun install --frozen-lockfile --ignore-scripts` (no lifecycle scripts), the
following gates all exited 0 in that same clean-base candidate replay:

```text
bun run typecheck:coverage-tools
bunx eslint --config eslint.config.js --max-warnings=0 \
  scripts/coverage-tools/bot-runtime-network-guard.ts \
  scripts/coverage-tools/bot-runtime-network-guard.test.ts
bunx prettier --check \
  scripts/coverage-tools/bot-runtime-network-guard.ts \
  scripts/coverage-tools/bot-runtime-network-guard.test.ts \
  scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs
git diff --check
```

`git diff --check` reported no whitespace errors. Replay worktree status had
exactly the three candidate files changed/untracked; `node_modules` was ignored.
The shared worktree had no staged changes from this evidence task, and no commit
was made.

## Review hand-off

The next independent technical reviewer should verify the three candidate diffs
against the stated atomic-install and constructability invariants, including
whether rollback preserves descriptors in reverse installation order. The next
independent process reviewer should verify this is truthful post-hoc evidence,
that the `EPERM` retry is accurately classified as sandbox-only, and that the
candidate remains uncommitted until both reviews pass with no valid findings.
