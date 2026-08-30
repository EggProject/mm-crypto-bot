# CI (7 jobs)

GitHub Actions declares the following seven jobs for pushes and pull requests
targeting `main` (`.github/workflows/ci.yml`):

| #   | Job                 | Command and scope                                                                                                                                                                                  |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `typecheck`         | `bun run typecheck`                                                                                                                                                                                |
| 2   | `lint`              | `bun run lint`                                                                                                                                                                                     |
| 3   | `format`            | `bun run format:check`                                                                                                                                                                             |
| 4   | `verify-foundation` | `bun run verify:foundation`; this verification remains explicitly incomplete                                                                                                                       |
| 5   | `test`              | `bunx turbo run test -- --reporter=junit --reporter-outfile=./junit.xml`; JUnit reports are uploaded as artifacts and published to pull requests                                                   |
| 6   | `build`             | `bun run build`                                                                                                                                                                                    |
| 7   | `coverage`          | Selects a valid event base and fails closed when unavailable, runs coverage-infrastructure tests, then `bun run coverage:full`; separate unit and subprocess E2E reports are uploaded as artifacts |

The workflow declares these jobs; whether a pull request is mergeable, and any
branch-protection requirements, are external repository settings and are not
asserted here.

The coverage job checks out full Git history. Pull requests compare against the
explicit base commit and pushes compare against the event's `before` commit;
the verifier resolves their merge base and fails closed when the base is absent
or unavailable. Local runs have no implicit remote base and instead inspect the
tracked worktree diff plus untracked `apps/bot/src` runtime files.
