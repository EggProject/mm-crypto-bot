# C4c Command Ledger — DRAFT

Recorded `2026-08-18T06:25:15+0200` Europe/Budapest from CWD
`/home/eggp/projects/mm-crypto-bot`. This is scope-bound implementation
evidence, not a repository or release PASS.

| Command                                                                 | Exit | Observed result                                                                                                                 |
| ----------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------- |
| `bunx eslint packages/logging --max-warnings=0`                         |    0 | Strict logging package lint passed.                                                                                             |
| `bunx tsc -p packages/logging/tsconfig.json --noEmit`                   |    0 | Logging package typecheck passed.                                                                                               |
| `bun run --filter @mm-crypto-bot/logging build`                         |    0 | Logging package build contract passed.                                                                                          |
| `bunx vitest run --config packages/logging/vitest.config.ts --coverage` |    0 | 27 tests; 220/220 statements, 160/160 branches, 49/49 functions, 202/202 lines.                                                 |
| `bun test apps/bot/src`                                                 |    0 | 733 passed, 0 failed, 1753 expectations.                                                                                        |
| `bunx tsc -p apps/bot/tsconfig.json --noEmit`                           |    0 | Bot typecheck passed.                                                                                                           |
| `bun run --filter @mm-crypto-bot/shared test`                           |    0 | 102 tests passed.                                                                                                               |
| `bun run --filter @mm-crypto-bot/shared typecheck`                      |    0 | Shared typecheck passed.                                                                                                        |
| `bun run --filter @mm-crypto-bot/shared build`                          |    0 | Shared build contract passed.                                                                                                   |
| `bun test scripts/coverage-tools/*.test.ts`                             |    0 | 20 tests passed.                                                                                                                |
| `bun run typecheck`                                                     |    0 | Turbo ran 20 successful tasks.                                                                                                  |
| `bun run build`                                                         |    0 | Turbo ran 12 successful tasks; ignored build outputs were not staged.                                                           |
| `bun install --frozen-lockfile --ignore-scripts`                        |    0 | 266 installs across 290 packages; no changes; no lifecycle execution.                                                           |
| `bun pm untrusted`                                                      |    0 | Only Lefthook postinstall remained blocked.                                                                                     |
| `bun audit`                                                             |    1 | `ConnectionRefused`; vulnerability evidence is NOT EVIDENCED.                                                                   |
| `bun run typecheck:coverage-tools`                                      |    2 | C4c driver import resolves; pre-existing tooling errors remain in `toolchain-contract.test.ts` and `verify-foundation.test.ts`. |
| Scoped changed-app ESLint with `--max-warnings=0`                       |    1 | 722 errors and 10 warnings; existing strict-style/test-project-service debt; no config weakening.                               |
| `bun run format:check`                                                  |    1 | Existing intentionally invalid C3b fixture cannot be parsed by Prettier.                                                        |
| `git diff --check`                                                      |    0 | No tracked whitespace diagnostics.                                                                                              |

Generated logging coverage is ignored and not staged: summary SHA-256
`67d5444ac401f1b62a8bdc60c2f673ec90750fb22082866ea07bb257225b3aab`;
LCOV SHA-256
`bd94d39c69edc18cdc201e84d54253e44e8e86a59a1b7f66c3571803b979721f`.

The current `bun.lock` SHA-256 is
`af330da1eaba4dc6f0f79e3de3f6caaa8897149ad16f45973d1af2503ae206b6`.
The main-worktree `.git/hooks` file-inventory hash observed after validation is
`2cbf26be4cfe5e6c621a2b2759cf5913880abcbb018617a5f4e4a7e27ccf62d9`;
no hook-install command was run.
