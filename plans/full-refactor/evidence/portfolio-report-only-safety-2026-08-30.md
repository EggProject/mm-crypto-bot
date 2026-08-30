# Portfolio report-only safety — R3 evidence

Recorded 2026-08-30 Europe/Budapest. Non-review documentation-only `luna_worker`; workspace-write; no external resource, fallback, stage, commit, or self-review.

Administrative ownership is exactly this file, `portfolio-report-only-terra-review-2026-08-30.md`, and the link in `REVIEW-EVIDENCE.md`. Reviewed production/test/config ownership is exactly the 15 `packages/core` paths enumerated in the Terra receipt; no `apps/bot` or risk paths belong to this slice. All other dirty/untracked/ignored paths are excluded. The root `.gitignore` change is separate dYdX/process maintenance.

Historical worker checkpoints: RED 0 pass/9 fail; initial GREEN 16; portfolio 141; core 1697. R1 reported 161 V8 tests and S673/B385/F125/L619. These are historical, not newly inferred.

The initial Terra FAIL findings were: double-read synthesize, missing coverage sidecar/residuals, stale titles, and unsafe test casts. R1 fixed all four. Fresh independent Terra PASS has zero findings; receipt: [Terra review](portfolio-report-only-terra-review-2026-08-30.md).

Fresh commands: `bun x vitest run --config packages/core/vitest.portfolio-orchestrator.config.mjs --coverage` exited 0 (7 files, 161 tests, 466 expects, S673/B385/F125/L619); config SHA-256 `2e6697c87e9bc7d47e6a088d3978a16105f5daad86f02c5ccbdd5e77f811e1e4`; actual `packages/core/coverage/portfolio-orchestrator/lcov.info` SHA-256 `358f83b7a798066e1c4483278b3439f0ea2d569ecd303fc6ce2160b3c2988507`. Correct direct Bun command `bun test packages/core/src/portfolio/*.test.ts packages/core/src/public-api-portfolio-decision.test.ts` exited 0: 161 pass, 0 fail, 466 expects. Core tsc, scoped ESLint, and Prettier passed. No full-root verify/lint claim.

Title preservation is limited to R1's four old→new mappings, including the long lifecycle mapping; old names are absent from the 15-path test scope. Current `it/test/describe` and `expect(` inventory is bounded to those paths. HEAD is not a slice baseline and no exact pre-slice count is invented.

Approximate VaR/correlation uses JavaScript `number`/`Math.sqrt` and is report-only. Exact-domain migration, full portfolio completion, and live/trading readiness remain OPEN. No filesystem adapter, `openat`, descriptor, or config-reload work occurred.

For each untracked report, `git diff --no-index --check -- /dev/null <report>` returned expected exit 1 with zero whitespace-error output; `rg -n '[[:blank:]]+$' <reports>` returned exit 1/no matches. Reports are not ignored and normally addable; links exist; index is empty. Recovery is removal/restoration of these evidence documents and their link only.

## Commit provenance and retrospective Agy assessment

The historical no-stage/no-commit statements above describe the review snapshot only. The reviewed 15-path candidate subsequently landed in 3216e87; `git show --stat --oneline` matches the exact scope, and the implementation paths were clean with an empty index after commit. Retrospectively, Agy write was ineligible: the authoritative worktree was shared and dirty, direct Agy writes were forbidden, and no dedicated isolation or effective allow/deny boundary was used or authorized. Luna docs-only therefore remained the disposition. No broader repository, release, or live-trading PASS is claimed.
