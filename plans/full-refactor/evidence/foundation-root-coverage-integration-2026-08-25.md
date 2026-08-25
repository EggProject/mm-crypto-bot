# Foundation root coverage integration candidate evidence

## Candidate identity and authority

- Base: `bf7f6f23516795eb4f8a9694791d36477ce1d973`
- Isolated branch: `codex/foundation-coverage-integration`
- Worktree: `/tmp/mm-foundation-coverage.Yx2zoA/worktree`
- Final candidate paths: `package.json`, `scripts/coverage-full.sh`,
  `scripts/coverage-per-package.sh`, `scripts/coverage-gates.test.sh`,
  `scripts/tooling/clean-artifacts.ts`, `scripts/tooling/clean-artifacts.test.ts`,
  and this evidence record.
- User approval: `milyen valaszra varsz? van egy goal feladatotok csinaljatok! mondtam mar jovahagyok mindent!`

## Routing and provenance

The implementation was a non-review write spanning root tooling and four
foundation packages. Multi-package coverage and data-integrity requirements
were the Terra trigger.

- Requested route: `terra_worker`. Observable effective route identity:
  `/root/foundation_coverage_integration` under the profile-pinned route.
  Actual lower-level provider model and effort: `NOT OBSERVABLE`; they are not
  inferred from the configured `gpt-5.6-terra/high` profile.
- Requested sandbox/write authority: workspace-write in the isolated worktree
  with exact owned paths. Effective low-level sandbox permission metadata:
  `NOT OBSERVABLE`. Observable behavior remained within exact ownership.
- There was no fallback or escalation. The initial dependency blocker was
  resolved by the coordinator's frozen install, not by scope or model
  escalation. This evidence follow-up owns only this record.
- Implementation canonical task/result identifier:
  `/root/foundation_coverage_integration` (implementation result returned).
  Technical reviewer canonical task/result identifier:
  `/root/foundation_coverage_final_tech` (PASS, zero candidate findings).
  Process reviewer canonical task/result identifier:
  `/root/foundation_coverage_final_process` (FAIL, two evidence findings).

The initial technical reviewer used mandatory read-only `terra_reviewer` with
the profile-pinned `gpt-5.6-terra/high`. The initial process reviewer used
mandatory read-only `luna_process_reviewer` with the profile-pinned
`gpt-5.6-luna/medium`. This record does not misstate the initial process review
as PASS.

## Preflight and reconstruction

A new worktree was created directly at the exact base. The baseline cleaner
was 4/4 and the existing shell regression passed before edits. The original
pre-dispatch raw transcript was not retained; this is a limitation of the
reconstructed evidence.

The current candidate-diff-only secret scan searched for
`api-key|secret|password|private-key|authorization|bearer`. It exited 1, which
means zero matches; its log is empty and has the SHA-256 recorded below. A
frozen install replay exited 0 with no changes.

The following are reconstructed replay logs, not original RED transcripts. RED
replay used the exact base archive plus the current tests. The second replay
used candidate files with only the root infrastructure script restored to its
base value. This permits reproduction of failed contracts without claiming the
unavailable original raw transcript.

## Immutable RED provenance bundle

The immutable bundle is
`/tmp/mm-foundation-coverage.Yx2zoA/foundation-red-evidence-bundle.tar` with
SHA-256 `8caca6ed06defb2946c07399d6423ce5a22b0ca6620a08f6e9af062fb574d8b6`.
Its external, non-self-referential manifest is
`/tmp/mm-foundation-coverage.Yx2zoA/foundation-red-evidence-bundle.manifest`
with SHA-256 `976b3834cbf41a47ed5e302bc29d3026ae55179214b9b6c2ccf1476f8b36a6d5`.
The manifest records base `bf7f6f23516795eb4f8a9694791d36477ce1d973`, exact
current/replay source and test snapshot hashes, four ordered RED commands with
available UTC timestamps and exit codes, and Bun, Node, Git, and kernel values.

The archive is built from the manifest's 21 payloads only, using sorted names,
numeric owner/group zero, and `1970-01-01T00:00:00Z` mtime. It excludes
`node_modules`, Git internals, secrets, generated coverage, and unrelated
repository files. The manifest is intentionally outside the archive so it can
hash every bundled file without a self-referential checksum. A reconstructed
replay proves current reproducibility only; it cannot manufacture the
unavailable original pre-dispatch terminal transcript.

The archive now includes
`/tmp/mm-foundation-coverage.Yx2zoA/foundation-red-evidence-bundle-ledger.md`
as `ledger/failure-and-rework-ledger.md`, SHA-256
`c584cd29c03142f8891a060775b412f326cc964fb91f698b5b6fcf4c9e6d856b`, and
the frozen-install remediation log as `logs/frozen-install.log`, SHA-256
`ee26eba795843ecfd6b170b81de1a6bc1353b9577c798acc718aa9a5a484c329`.
The immutable ledger records every known failure, retry/rework, owner, command,
exit, timestamp, route/model/sandbox state, and resolution; unavailable
historical fields are explicitly `NOT OBSERVABLE`.

| Immutable RED log                                                   | Exit | Expected failure                                          | SHA-256                                                            |
| ------------------------------------------------------------------- | ---: | --------------------------------------------------------- | ------------------------------------------------------------------ |
| `/tmp/mm-foundation-coverage.Yx2zoA/red-initial-coverage-gates.log` |    1 | `Total: 12/12...`                                         | `e9dd36f510f82bd84eb3899ee728f2cb37678f19cdfd5b1ab263aac501fc7287` |
| `/tmp/mm-foundation-coverage.Yx2zoA/red-initial-cleaner.log`        |    1 | `would-remove packages/typing/coverage`                   | `b46462051f10e1bcc24bde18ce674c535b4ffb4166d24474ce0c5e927fd38d78` |
| `/tmp/mm-foundation-coverage.Yx2zoA/red-round1-infra-contract.log`  |    1 | root script missing `bash scripts/coverage-gates.test.sh` | `23a8b677f5a769c9049bd5053a335c6da9a9e6ff258f7a000a1c30f6835c4f55` |

Round-2 stale-cleanup sensitivity RED ran the updated shell test against a
controlled temporary copy of `coverage-full.sh` with only
`packages/typing/coverage` removed from its cleanup list. The pre-seeded valid
typing LCOV then masked the missing producer, so the synthetic pipeline exited
0 where the test expected 1. The replay log is
`/tmp/mm-foundation-coverage.Yx2zoA/red-round2-stale-cleanup.log`, exit 1,
SHA-256 `875306381c881f46b1d6b7f38ef30f2352732304092bfbd79d1dae8be23a5701`.

## GREEN evidence

| Evidence                     | Result                                   | SHA-256                                                            |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Shell regression             | PASS                                     | `fc00dccabcac53c7313847045a51d546140b8231cf580e76da35ac10d087370e` |
| Cleaner                      | PASS: 5/5, 49 expectations               | `a8cab5d15192ca133bdbaea48bab595e520dd9f7447b267e671a49529fc2e989` |
| Root coverage infrastructure | PASS: 20 Bun tests plus shell regression | `57c176881fab147ddac492478f57045a01d3aa36d9bc130d9da3c984213861ca` |
| Foundation producer set      | PASS                                     | `5ea523d6ff71b8f47e2277f705396ace6cba18d6002f6d0cd3f3c008a80a2f5f` |
| Foundation metrics           | all covered/total equal                  | `a915e9ffa477245bd6dd49d388115c75bbd19b1ad337ce7642b2cdf05bbd855e` |
| Frozen install replay        | PASS: exit 0, no changes                 | `ee26eba795843ecfd6b170b81de1a6bc1353b9577c798acc718aa9a5a484c329` |
| Scoped ESLint                | PASS: empty log                          | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Scoped Prettier              | PASS                                     | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |
| Candidate diff check         | PASS: empty log                          | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Candidate secret scan        | exit 1: zero matches, empty log          | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

The candidate GREEN replay is
`/tmp/mm-foundation-coverage.Yx2zoA/green-round2-coverage-gates.log`, exit 0,
with `coverage gate synthetic regressions: PASS` and SHA-256
`fc00dccabcac53c7313847045a51d546140b8231cf580e76da35ac10d087370e`. It
pre-seeds stale valid LCOV for each missing foundation producer, proves the
candidate cleanup removes it, and proves the missing producer still fails the
gate. It also parses all `coverage:merge` inputs, rejects any `/coverage/e2e`
input, and exercises a deterministic `apps/bot/coverage/e2e/lcov.info` negative
fixture.

Foundation metrics are exact: typing S1/B0/F1/L1; typeguard S26/B23/F11/L23;
assert S14/B10/F7/L9; numeric S201/B158/F41/L200. In every listed metric, the
covered count equals the total count.

## Honest non-PASS evidence

- Per-package coverage exited 1 at 10/12. Core is 11,419/11,438 (99.8%), and
  backtest-tools is 2,878/3,834 (75.1%). SHA-256:
  `b2f9b6e9fd4ed6144cbf151bdb1261324a4c728e057185eeb62756d7500724d8`.
- Merge exited 0. SHA-256:
  `1178a443432cdbbedfcb45685a93cc814d6edadd5d2f4217402b59c51faa2d3d`.
- Report exited 0 with merged line coverage 19,148/21,756 (88.0%). SHA-256:
  `d2ce326a3bf66dbf482627f6399008db4e67e6ff36842bf6397a653df098dd73`.
- The backtest-tools producer had 12 existing data-fixture-dependent test
  failures. Root `coverage:full` is not PASS and is not claimed as PASS.
- `bun run typecheck:coverage-tools` exited 2. Its log is
  `/tmp/mm-foundation-coverage.Yx2zoA/current-coverage-tools-typecheck.log`,
  SHA-256 `fc3321edcbe53d26d605080c37ae1d81153bf9b4f331beddb3282f11e29d7e85`.
  These seven pre-existing, out-of-scope diagnostics are in unchanged tooling
  tests: `eslint-logging-preload-entrypoint.test.ts:26` (TS18048);
  `eslint-logging-test-support-boundary.test.ts:15` (TS18048) and :28
  (TS2345); `toolchain-contract.test.ts:119`, :121, and :123 (TS4111); and
  `verify-foundation.test.ts:17` (TS2769). Core and backtest-tools are recorded
  evidence, not an exhaustive statement of all repository blockers.

## Status

The pre-status-update review package produced fresh independent `TECH PASS` by
`/root/foundation_coverage_tech_final` and `PROCESS PASS` by
`/root/foundation_coverage_process_final`, with zero open valid findings.

Pre-status-update review package SHA-256:
`aa67b74de0d22e61ef95d48eba7c5c91febcc1895f5c061bae2cda8bd1df282f`

The final status-addendum review package and verdict are external review-ledger
evidence. They are deliberately not self-hashed inside this file: adding a
current package hash here would change that package.

Immutable bundle SHA-256:
`8caca6ed06defb2946c07399d6423ce5a22b0ca6620a08f6e9af062fb574d8b6`

`PENDING FINAL SCOPED TECH AND PROCESS RE-REVIEW`

The corrected current Status requires final scoped reviewer passes before commit
authorization. This record does not claim a commit hash, repository-wide PASS,
or Phase-2 PASS. The honest non-PASS limitations above remain in force.
