# Logging package validation

## Scope and index boundary

The isolated review-candidate snapshot before this self-recording evidence
addendum contains 98 allowed paths: 79 package
paths plus root coverage/CI/alias/lint-boundary tooling, logging-only
manifest/lock hunks, two additive consumer manifest dependencies, and the
logging evidence/ledger records. It retains HEAD's CCXT 4.5.64 and excludes
staged CCXT 4.5.75 plus all unrelated bot, exchange, shared, and other-ledger
changes. The only consumer exceptions are the additive logging dependency lines
in the bot and backtest-tools manifests.

The temporary index, not the shared real index, is the review-snapshot source.
Its portable snapshot is `/tmp/mmcb-logging-stage.jrsjNQ`:

- sorted 98-path list SHA-256:
  `2e8ad511ca16eb29b21ef1db88114cf1a0751e41b49d098a52b43a848818faf5`;
- binary patch SHA-256:
  `ae7d456df677f3a5b2d4d81c5b5bd53c49e592e46de0696fd55780c9b32d782a`;
- review-snapshot tree object:
  `2009143100d9df5f7983731dfc4e3c49999f262e`;
- change size: 16,661 insertions and 21 deletions; zero unmerged entries;
  allow-list check: zero unexpected paths; `git diff --cached --check`: PASS.

The pre-existing combined staged index is preserved and must not be used as a
commit source (backup index SHA-256
`910231928ad33247d30fd18474342c9083cbdb3db57e37918160be42c03150a0`; backup
patch SHA-256
`54a45b647024ed005a399d1fe2238d470be709457442e7e17b4c6aaad6f6c0df`).
After the initial candidate exposed a hard-coded repository-root path in a
publisher `fstat` test, the only portability repair replaced it with
`REPOSITORY_ROOT`; the exact review-snapshot scan has zero absolute repository
root literals.

## Direct package validation

- In the exact review snapshot, frozen install with `--ignore-scripts`:
  **PASS** (496 packages); lint, typecheck, `typecheck:e2e`, and build:
  **PASS**.
- Unit: **57/57 PASS**; S452/B371/F85/L411, exact 100%.
- Genuine subprocess E2E: **19/19 PASS**; S450/B371/F85/L409, exact 100%.
- Full logging infrastructure Vitest: **318/318 PASS**;
  S1220/B642/F234/L1120, exact 100%. Its first sandbox run failed solely with
  `spawnSync bun EPERM`; the identical targeted elevated run passed.
- Tooling-boundary tests: **6/6 PASS**.
- All logging TypeScript files are at most 500 lines.

Coverage boundaries are explicit: unit covers `packages/logging/src` production
and test-support tests; subprocess E2E covers only the public runtime contracts
for `contracts`, `index`, `serialization`, `sinks`, and `structured-logger` in
19 cases; infrastructure covers case-contract, path-boundary, artifact-run,
rollback, secure reader/writer, raw ingestion, summary publisher, build, scope,
gate, preload, runner, orchestrator, and CLI contracts.

The repaired implementation snapshot received a fresh independent
`terra_reviewer` **TECH PASS** with zero valid findings. The final independent
`luna_process_reviewer` then returned **PROCESS PASS** with zero open valid
findings for the isolated temporary-index candidate tree
`84f4d781dff662ed8cfa245cb68c7d67162e56cf`, after Agy quarantine. The failed
Agy build/test-split attempt remains PROCESS NONCOMPLIANT / REJECTED and has no
acceptance, routing-quality, implementation, or commit-authority role.

Commit is authorized **only** from that reviewed temporary logging-only index;
the shared real combined index and every unrelated staged path are forbidden as
a commit source and must be preserved. The review tree predates this status
addendum; the eventual commit tree differs only in this final evidence status,
not in reviewed implementation, test, config, package, or lock content. Root
`coverage:full` is not claimed as a PASS because known unrelated package
failures remain.

Links: [execution record](../EXECUTION-RECORD.md),
[review evidence](../REVIEW-EVIDENCE.md).
