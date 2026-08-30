# Operator-documentation candidate evidence — 2026-08-30

## Scope and predecessor

The original implementation task was classified as a Terra-triggered operator-documentation change: read/write, five root documentation files and the `apps/bot` command surface, one package/runtime consumer boundary, non-review; requested route `terra_worker` (`gpt-5.6-terra`, `high`), with workspace-write authority. Ownership was limited to `docs/ARCHITECTURE.md`, `docs/CLI.md`, `docs/COMMANDS.md`, `docs/STRUCTURE.md`, and `docs/how-to-backtest.md`, on a clean baseline for those paths; no overlap with other workers was permitted.

The read-only predecessor was `terra_reader`. Its RED inventory found stale `mm-bot` and postinstall references, nonexistent root commands, and installer/tree claims. The candidate GREEN contract uses the direct entry point `bun run apps/bot/src/index.ts` for the nine registered subcommands: `start`, `status`, `config`, `strategies`, `trades`, `kill-switches`, `kill-switch-dry-run`, `backtest`, and `help`.

## Source contract and exclusions

The source of truth is `apps/bot/src/index.ts` and `apps/bot/src/cli/index.ts`; `apps/bot/package.json` exposes `src/index.ts` as `main` and supplies build, dev, typecheck, lint, and test scripts. The retained `run-bot/config/` path exists and is used by documented config examples.

The candidate explicitly retains valid headless operation. `run-bot` configurations are retained and deferred for their own scope. Config reload/watch is a separate future goal and is untouched. This change does not claim live readiness, alter exact-10x behavior, change trading/risk semantics, or edit `CHANGELOG.md`.

## Review and replay receipt

The implementation received an independent Terra technical review: **PASS**. The first independent Luna process review was **FAIL (evidence-only)** because this durable candidate record was missing; this record is the remediation handoff for the required Luna R1 process re-review.

Replay of the exact candidate was name-only and bounded to the five docs plus this evidence/link addendum. The replay included a stale-term scan, source-contract check, Prettier check over all five docs, `git diff --check`, per-file LOC check (all <=500), secret scan, and verification that the cached index was empty. No staging or commit was performed.

The direct runtime probe `bun run apps/bot/src/index.ts help` is recorded as external RED: the current union worktree lacks the `assertLeverageInvariant` export expected by the core consumer. Therefore this candidate has no runtime PASS claim; the failure is outside the documentation-only ownership and was not repaired here. The root `bun run format:check` result is likewise recorded only as a dirty-union limitation: it reports unrelated formatting failures in other changed paths. No unrelated path was changed and no whole-repository format PASS is claimed.

## Rollback and bounded claim

Rollback is the exact five documentation files plus removal of this evidence file and its one ledger link. The bounded claim is limited to correcting operator-facing command/path references and recording their process evidence; it creates no product, trading, live-readiness, config-reload, or repository-wide quality claim.

## Retrospective Agy eligibility assessment

This evidence-writer dispatch is corrected retrospectively: the current rules did not make an Agy write route eligible because the authoritative worktree was shared and dirty, direct Agy writes were forbidden, and no dedicated isolated workspace or effective allow/deny boundary was used or authorized for this slice. The Luna mechanical documentation-only route therefore remained the current disposition. No evaluated Agy route or observable attestation is claimed.

## Commit provenance correction

The historical pre-commit/preflight statements above apply to the review-before-commit snapshot only. The implementation was subsequently committed as `0677fa7`. `git show --stat --oneline 0677fa7` identifies the implementation slice, and after that commit the exact implementation paths docs/ARCHITECTURE.md, docs/CLI.md, docs/COMMANDS.md, docs/STRUCTURE.md, docs/how-to-backtest.md were clean.
