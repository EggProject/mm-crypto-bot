# D-07 unparseable-source diagnostic

Current evidence recorded `2026-08-25` from the isolated candidate worktree
`/tmp/mm-d07-unparseable-commit.jpVHXx/worktree` at HEAD
`5ab6c030c1f57795e77239de9d532ad9a2777f93`. This narrowly scoped record
documents the distinction between a source that cannot be read and a source
whose already-read content cannot be parsed. It supersedes the prior
dirty-worktree negative-control count and former candidate-index assertions.
It does not claim a D-07, repository-wide, CI, release, package, or
live-trading PASS.

## Scope and invariant

The scanner treats an I/O failure as `unreadable-target` and an extractor
failure after successful secure I/O as `unparseable-source`. Both outcomes are
fail closed. Neither exposes raw failure detail. This work preserves the
schema/envelope version, declared catalog, inventory roots, evidence/legacy
policy, and CLI exit semantics, while intentionally extending the
finding-category vocabulary with `unparseable-source`. It does not change
live-trading behavior.

The candidate contains exactly these five paths:

1. `scripts/tooling/zero-legacy-contract.ts`
2. `scripts/tooling/zero-legacy-contract.test.ts`
3. `scripts/tooling/zero-legacy-scanner.ts`
4. `scripts/tooling/zero-legacy-scanner.test.ts`
5. `plans/full-refactor/evidence/d07-unparseable-source-diagnostic-2026-08-24.md`

No final candidate tree, candidate-index checksum, or evidence-file self-hash
is asserted. Those values would become invalid when this fifth candidate path
changes and must be captured externally if a later commit operation needs them.

## Implementation and review record

The two implementation briefs were deliberately decomposed and dispatched
sequentially, with no overlapping writer ownership. Each was a non-review,
workspace-write D-07 governing/data-integrity provenance task, a Terra trigger,
and requested `terra_worker` / `gpt-5.6-terra` / `high`. The sandbox was
workspace-write; there were no external or mutable resources, no fallback or
escalation, and provider-attested effective model/effort were not observable.
No implementation task staged, committed, or performed external I/O.

| Sequence | Task ID                          | Exclusive ownership                                                                                                                                             | Historical implementation validation                                                                                                     | Result                                                 |
| -------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| First    | `/root/d07_unparseable_contract` | `scripts/tooling/zero-legacy-contract.ts`, `scripts/tooling/zero-legacy-contract.test.ts`                                                                       | Contract tests `14/14`; then scoped suite `68/68`, V8 `785/785` statements, `652/652` branches, `165/165` functions, `773/773` lines     | Completed; ownership released before the scanner task. |
| Second   | `/root/d07_unparseable_scanner`  | `scripts/tooling/zero-legacy-scanner.ts`, `scripts/tooling/zero-legacy-scanner.test.ts`, plus `zero-legacy-coverage-delta.test.ts` only if coverage required it | Scanner tests `11/11`; historical final suite `70/70`, V8 `790/790` statements, `650/650` branches, `165/165` functions, `777/777` lines | Completed. The coverage-delta file was not modified.   |

### Independent review outcomes and remediation

The scoped independent technical review recorded **TECH FAIL**: an
`unparseable-source` finding could carry raw `entry.target`. The correction was
test-driven in the contract source and test only: the RED focused contract run
was `13/14` because `parser-detail-unexpected-token` leaked; the GREEN focused
run was `14/14` after the contract omitted `target`. The corrected finding
contains no raw detail.

Earlier TECH and PROCESS passes are historical only. They do not validate the
corrected five-path candidate. The fresh independent PROCESS review recorded
**PROCESS FAIL** with two findings: the negative-control count was dirty and
non-immutable, and the evidence omitted exact commands, manifests, and log
hashes. The immutable tree/output-hash evidence and exact gate ledger below
remediate both findings.

The closure reviewers independently inspected the final pre-status-addendum
staged tree `79e15bd52f3703731f4bf65677dd58c335a0bfc8` and patch SHA-256
`c88710e25f9489885c01044c81bd4cec2a34cf6b9ece0ca0e605e487a545b9b3`.

| Review    | Task and mandatory route                                                                             | Outcome                                                                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Technical | `/root/d07_unparseable_final_tech`; read-only `terra_reviewer` / `gpt-5.6-terra` / `high`            | **TECH PASS**. The prior raw-target leak is addressed; zero open valid findings. The reviewer independently reran the contract test (`14/14`) and integrity checks.                                    |
| Process   | `/root/d07_unparseable_final_process`; read-only `luna_process_reviewer` / `gpt-5.6-luna` / `medium` | **PROCESS PASS**. Both prior evidence findings are addressed; zero open findings. The reviewer verified the immutable tree, output/log hashes, exact gates, five-path scope, and shared staged hashes. |

The effective route, model, and effort above derive from the configured
custom-agent profiles, not provider telemetry.

The current implementation source/test identities are below. The evidence file
is intentionally excluded because it is the mutable fifth candidate path.

| Path                                           | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/tooling/zero-legacy-contract.ts`      | `47f0a4f211c8d89a1013ae4457dfc23336ab9c7a44173699e65e6e93e39891b9` |
| `scripts/tooling/zero-legacy-contract.test.ts` | `4c99859a21d790ce76770d9067091d960c6bdbf81660b8520fb28965d8e060f8` |
| `scripts/tooling/zero-legacy-scanner.ts`       | `6b4bbf31334cb48b4279394dd1af7f1c4c996bda6dec95cd7b4fd7e8fb8e393f` |
| `scripts/tooling/zero-legacy-scanner.test.ts`  | `b5f5c0f151133b7792edc16de791a57881538cfda0050d940ef7295dc87705e4` |

## Isolated negative control

The candidate-CWD negative control was:

```sh
bun scripts/tooling/zero-legacy-cli.ts --repository-root /tmp/mm-d07-unparseable-commit.jpVHXx/worktree
```

It exited `2`. Its stdout JSON is
`/tmp/mm-d07-unparseable-commit.jpVHXx/negative-control.json`, `13,803` bytes,
SHA-256 `13d722560c3f67ecd5b9e0308e1a1182608aee9b812821288cfe4d7b80b31185`.
Its stderr is `/tmp/mm-d07-unparseable-commit.jpVHXx/negative-control.stderr`,
`46` bytes, SHA-256
`44474c9cd3e123d4acdac8298a0eeff6edcea8b7f1fa41ca67edfe1a07ff2f12`, with
the exact stable message `zero-legacy scanner could not safely complete`.

The JSON reports schema `zero-legacy-scan-result@1`, scanner schema
`zero-legacy-scanner@1`, `status: "fail"`, and
`catalogCompleteness: "incomplete"`. Its `88` findings are:

| Category                       | Count |
| ------------------------------ | ----: |
| `legacy-command`               |     2 |
| `legacy-config-reference`      |     5 |
| `legacy-current-doc-reference` |    10 |
| `legacy-directory`             |     2 |
| `legacy-file`                  |    21 |
| `legacy-import`                |    11 |
| `unparseable-source`           |    29 |
| `unsafe-path`                  |     8 |
| `unreadable-target`            |     0 |

This isolated result supersedes the dirty-worktree `90`-finding count. It is
expected fail-closed behavior and is not a D-07 completion claim.

## Immutable validation snapshot and fresh gates

Before this evidence addendum, the staged Git tree was
`396955a92b749adb30eda13a758d04f027480422` with `727` tracked paths. The
SHA-256 of `git ls-tree -r -z 396955a92b749adb30eda13a758d04f027480422` was
`c3735a63ca5eff0991ef86486205658020dc6b6be90927416c13a5cfa3cc4c4f`.

The following final gates are authoritative. Their logs and coverage artifacts
are durable `/tmp` evidence only, not repository-permanent artifacts.

| Gate              | Exact command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result and durable evidence                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest coverage   | `bunx --no-install vitest run --config scripts/tooling/vitest.zero-legacy.config.mjs --coverage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `70/70`; `S790/790 B650/650 F165/165 L777/777`; `/tmp/mm-d07-unparseable-commit.jpVHXx/gate-vitest.log` SHA-256 `86bcb7654cfd912278ec70fd4171115a81529df758a0b42587de1772f65a5a32`; `/tmp/mm-crypto-bot-zero-legacy-coverage/coverage-summary.json` SHA-256 `3fbfd0d86539f23a0abc923b2ac386f3cc52530904a1ba5b181469dedfed6c1a`; `/tmp/mm-crypto-bot-zero-legacy-coverage/lcov.info` SHA-256 `a802875694b84a896f838806d0443534da3cf61fd0f55c25a23ad2f187c2e4a1` |
| Bun aggregate     | `bun test scripts/tooling/zero-legacy-contract.test.ts scripts/tooling/zero-legacy-extractors.test.ts scripts/tooling/zero-legacy-scanner.test.ts scripts/tooling/zero-legacy-node-port.test.ts scripts/tooling/zero-legacy-coverage-delta.test.ts scripts/tooling/zero-legacy-secure-io.test.ts scripts/tooling/zero-legacy-secure-io-race.test.ts scripts/tooling/zero-legacy-syntax-extractors.test.ts`                                                                                                                                                                                                                                    | `69/69`, `253 expects`; `/tmp/mm-d07-unparseable-commit.jpVHXx/gate-bun-test.log` SHA-256 `cb233050e7e48833f2e34e0a5ec97aafaa3f3c9a7c4474c2ed9647667d4f41da`                                                                                                                                                                                                                                                                                                   |
| Strict tsc        | `bunx tsc --ignoreConfig --strict --skipLibCheck --noEmit --target es2024 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --esModuleInterop --types bun-types,node scripts/tooling/zero-legacy-cli.ts scripts/tooling/zero-legacy-command-parser.ts scripts/tooling/zero-legacy-config.ts scripts/tooling/zero-legacy-contract.ts scripts/tooling/zero-legacy-document-extractors.ts scripts/tooling/zero-legacy-extractors.ts scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-secure-io.ts scripts/tooling/zero-legacy-shell-yaml-extractors.ts scripts/tooling/zero-legacy-syntax-targets.ts` | Exit `0`; empty `/tmp/mm-d07-unparseable-commit.jpVHXx/gate-tsc.log`, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`                                                                                                                                                                                                                                                                                                               |
| Scoped ESLint     | `bunx eslint --max-warnings=0 scripts/tooling/zero-legacy-contract.ts scripts/tooling/zero-legacy-contract.test.ts scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-scanner.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                        | Exit `0`; empty `/tmp/mm-d07-unparseable-commit.jpVHXx/gate-eslint.log`, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`                                                                                                                                                                                                                                                                                                            |
| Scoped Prettier   | `bunx prettier --check scripts/tooling/zero-legacy-contract.ts scripts/tooling/zero-legacy-contract.test.ts scripts/tooling/zero-legacy-scanner.ts scripts/tooling/zero-legacy-scanner.test.ts plans/full-refactor/evidence/d07-unparseable-source-diagnostic-2026-08-24.md`                                                                                                                                                                                                                                                                                                                                                                  | `/tmp/mm-d07-unparseable-commit.jpVHXx/gate-prettier.log` SHA-256 `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20`                                                                                                                                                                                                                                                                                                                           |
| Staged diff-check | `git diff --cached --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Exit `0`; empty `/tmp/mm-d07-unparseable-commit.jpVHXx/gate-diff-check.log`, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`                                                                                                                                                                                                                                                                                                        |

The first isolated coverage attempt reported missing Vitest, and a later
frozen-lock installation was reported by a worker. Timestamp and log evidence
for both are **NOT OBSERVABLE**; neither is authoritative. The final gates
above are authoritative.

## Candidate and shared staged-content integrity

Before this addendum, the five-path candidate's NUL-delimited path-list SHA-256
was `32c47190924b5a05c77fb1889c7eeb014b8210da63acae5f1233a1ea578a8ca4` and
its NUL-delimited name-status SHA-256 was
`80fdff7a1359a4fb4b8c1c4a3fa848f896c94573a7d2a5891685b6952f947600`. The
recorded pre-addendum patch SHA-256 was
`8ac4c74e9ef327fd77ef39cad29c03260e6c08024d4836a69e3c989b9c810027`.
These are immutable pre-addendum snapshots, not assertions about the final
candidate after this evidence-file change.

The shared staged CCXT content remains exactly `24` paths. This record asserts
only content-derived snapshots, not raw `.git/index` identity:

| Content snapshot                      | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| NUL-delimited staged name-only list   | `37e1c8643f28f3418782c42987dedb904d5eadffd9e6b3039edc15ff7b57289d` |
| NUL-delimited staged name-status list | `111e68ee18decc0e09c65d34f0f49050184d948d847a18945ac617c2dd648a48` |
| Full-index binary diff                | `625916c3f042505c769297fd7065ee725dd103ba4013bfaffd1843e335871380` |

## Current status

The current status is candidate-specific **TECH PASS / PROCESS PASS** with zero
open findings. The coordinator has authorization under the user's ongoing
continuous scoped-commit instruction to commit only this five-path D-07 slice.
This is not an overall D-07, repository-wide, CI, release, package, or
live-trading PASS.

The eventual commit candidate differs from the reviewed tree only by this
review-status evidence addendum. Scoped evidence-status rechecks are pending
for that difference; their result is not claimed here. No final commit tree or
evidence-file self-hash is asserted.
