# CI (6 jobs)

GitHub Actions runs the following jobs in parallel on every PR (`.github/workflows/ci.yml`):

| #   | Job                   | What it checks                                                                                                                                                                                                                                            |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `install-no-warnings` | `bun install` finishes with zero peer-dep warnings                                                                                                                                                                                                        |
| 2   | `typecheck`           | `tsc --noEmit` across all 7 workspaces with ultra-strict settings                                                                                                                                                                                         |
| 3   | `lint`                | ESLint flat config (strict-type-checked + security plugin) — zero errors                                                                                                                                                                                  |
| 4   | `build`               | `turbo run build` (cache: false) — every package compiles                                                                                                                                                                                                 |
| 5   | `coverage`            | Resolves an explicit PR base SHA or push-before SHA, verifies the merge-base scope, typechecks/tests the coverage tooling, then runs `bun run coverage:full`; bot unit and true Bun-subprocess E2E are separate 100% statement/branch/function/line gates |
| 6   | `test`                | `bun run test` — every workspace test suite passes                                                                                                                                                                                                        |

A PR is mergeable only when all 6 jobs are green.

The coverage job checks out full Git history. Pull requests compare against the
explicit base commit and pushes compare against the event's `before` commit;
the verifier resolves their merge base and fails closed when the base is absent
or unavailable. Local runs have no implicit remote base and instead inspect the
tracked worktree diff plus untracked `apps/bot/src` runtime files.
