# CI (7 jobs)

GitHub Actions runs the following jobs in parallel on every PR (`.github/workflows/ci.yml`):

| # | Job | What it checks |
|---|---|---|
| 1 | `install-no-warnings` | `bun install` finishes with zero peer-dep warnings |
| 2 | `typecheck` | `tsc --noEmit` across all 8 packages with ultra-strict settings |
| 3 | `lint` | ESLint flat config (strict-type-checked + security plugin) — zero warnings |
| 4 | `build` | `turbo run build` (cache: false) — every package compiles |
| 5 | `coverage` | `bun run coverage:per-package` — 7/7 server packages at 100% OWN |
| 6 | `test` | `bun run test` — every Vitest suite passes |
| 7 | `e2e:playwright` | `cd apps/web && bun run e2e` — Playwright + MSW + 80% coverage gate (20-min suite timeout) |

A PR is mergeable only when all 7 jobs are green.
