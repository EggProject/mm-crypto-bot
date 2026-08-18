# Dependency and Toolchain Plan — DRAFT

**Status:** DRAFT. The Phase 1 official compatibility audit was recorded on
2026-08-17. D-01/D-03/D-06/D-09 are approved. This records a dependency
baseline and approved target versions; it does **not** install, update, trust,
or validate any dependency in the repository.

## Observed state

The root currently pins Bun through `packageManager: bun@1.3.14` and lists
TypeScript `6.0.3`, Turbo `2.10.2`, ESLint `10.6.0`, and CCXT `4.5.64`.
Several dependencies use caret ranges, including `@eslint/js`, `@types/node`,
`picocolors`, and `write-file-atomic`; that conflicts with the exact-pin target.
The root declares range-valued Bun/Node engines (`>=1.3.14`, `>=22`) and
`bunfig.toml` sets `install.exact = false`; both conflict with the approved
exact-runtime/external-pin target. `workspace:*` is permitted only for internal
Bun workspace links, never for an external package. The root lockfile and
current resolved tree remain implementation-time evidence, not an inference
from manifests.

## Proposed dependency policy

1. Use only the repository-pinned Bun and `bun.lock`; npm, pnpm, and Yarn are
   not used.
2. Pin every external production/dev dependency to an exact version. An update
   is a separate audited change; lockfiles are never edited manually.
3. Approve a minimum direct dependency list. A candidate must document purpose,
   package owner, official source, version, license, install/native/WASM impact,
   trusted-dependency impact, replacement considered, and removal plan.
4. Keep `trustedDependencies` minimal and validate each entry. Prohibit runtime
   downloads of unpinned code.
5. Generate and verify a dependency inventory, vulnerability report, SBOM and
   license report in clean CI. High/critical findings block delivery.

The package-owner/external-import rule is defined in
[ARCHITECTURE.md](ARCHITECTURE.md). Manifest, lockfile, static-import and
resolved-graph evidence must agree before an exact direct dependency is accepted;
the final blocking command is part of [VALIDATION.md](VALIDATION.md).

## Recorded official compatibility baseline — 2026-08-17

The completed audit records the following exact values as compatible targets;
they are **not installed or lockfile-resolved by this plan update**. The
official-source links are evidence pointers, not an assertion that the current
worktree already satisfies every peer, lifecycle, or release condition.

| Area                         | Recorded baseline / approved target                                                                                                                                                                                                                                                       | Official primary-source evidence and limitation                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun                          | `1.3.14` remains the exact current stable workspace/build tool.                                                                                                                                                                                                                           | [Bun releases](https://bun.com/docs/runtime/releases) and [Bun trusted dependencies](https://bun.com/docs/install/trusted). Re-inspect install/lifecycle behavior at the exact frozen install.                                                                                                                                                |
| TypeScript                   | `6.0.3` remains the exact latest approved/supported 6.x target; TypeScript 7 is excluded.                                                                                                                                                                                                 | [TypeScript npm registry](https://www.npmjs.com/package/typescript) and [TypeScript release notes](https://www.typescriptlang.org/docs/). Target support must be rechecked with the selected runner.                                                                                                                                          |
| Node release runtime         | **D-03 selected exact Node `24.19.0`**, current latest v24 LTS patch in the audit, initially `linux-x64` only.                                                                                                                                                                            | [Node v24 archive](https://nodejs.org/en/download/archive/), [Node releases/lifecycle](https://nodejs.org/en/about/previous-releases/), and [Node release index](https://nodejs.org/dist/index.json). `linux-arm64` remains blocked until reproducible-target proof.                                                                          |
| ESLint/TypeScript lint stack | `@eslint/js` `10.0.1`; `@tsconfig/bases` `1.0.27`; `@types/node` `24.13.3` (not the overall 26 line); `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, and `typescript-eslint` `8.67.0`; `eslint` `10.8.1`; `globals` `17.11.0`; retain `eslint-plugin-security` `4.0.1`. | [`@eslint/js` registry metadata](https://registry.npmjs.org/@eslint%2fjs/10.0.1) records peer `eslint ^10.0.0`, which supports `eslint` `10.8.1`; [typescript-eslint dependency versions](https://typescript-eslint.io/users/dependency-versions/) remains required. Peer compatibility still requires frozen-install and lint-fixture proof. |
| Formatting/hooks             | Add exact `prettier` `3.9.6`, `eslint-config-prettier` `10.1.8`, `eslint-plugin-unicorn` `73.0.0`, and `lefthook` `2.1.10`.                                                                                                                                                               | [Prettier](https://prettier.io/docs/), [`eslint-plugin-unicorn` registry metadata](https://registry.npmjs.org/eslint-plugin-unicorn/73.0.0), and [Lefthook installation](https://lefthook.dev/installation/index.html). Lefthook lifecycle/platform metadata must be re-inspected at exact install despite Bun default-trust evidence.        |
| Build/test runner            | `turbo` `2.10.10`; retain `vitest` and `@vitest/coverage-v8` `4.1.10`, `bun-types` and `@types/bun` `1.3.14`, plus `istanbul-lib-coverage` `3.2.2` and `istanbul-lib-instrument` `6.0.3`.                                                                                                 | [Turbo documentation](https://turborepo.com/docs), [Vitest](https://vitest.dev/), and [Istanbul](https://github.com/istanbuljs/istanbuljs). Actual Turbo task/cache behavior remains unproven.                                                                                                                                                |
| Pure minor updates           | `protobufjs` `8.7.2`, `smol-toml` `1.8.0`; exact-only retain `write-file-atomic` `8.0.0` and `picocolors` `1.1.1`.                                                                                                                                                                        | [protobufjs](https://github.com/protobufjs/protobuf.js), [smol-toml](https://github.com/squirrelchat/smol-toml), [write-file-atomic](https://github.com/npm/write-file-atomic), and [picocolors](https://github.com/alexeyraspopov/picocolors). Consumer and license evidence remains required.                                               |
| Deferred boundaries          | Current CCXT is `4.5.64`; audited available target is `4.5.70`. Zod is `3.25.76`; possible `4.4.3` migration is breaking. `fraction.js` `5.3.4` belongs only to the numeric-package phase.                                                                                                | [CCXT](https://github.com/ccxt/ccxt), [Zod](https://zod.dev/), and [fraction.js](https://github.com/rawify/Fraction.js). These are deliberately not part of a generic sweep.                                                                                                                                                                  |

### Corrected Phase 1 package evidence — 2026-08-17T21:11–21:13+02:00

The official registry query window above corrected two invalid planning values:
`@eslint/js` **`10.0.1`** exists and declares peer `eslint ^10.0.0`, so the
approved toolchain keeps exact `eslint` `10.8.1`; `@eslint/js` `10.8.1` does
not exist. `eslint-plugin-unicorn` **`73.0.0`** replaces the invalid `72.0.0`
plan value. Primary records are [`@eslint/js@10.0.1`](https://registry.npmjs.org/@eslint%2fjs/10.0.1),
[`eslint-plugin-unicorn@73.0.0`](https://registry.npmjs.org/eslint-plugin-unicorn/73.0.0),
and [`lefthook@2.1.10`](https://registry.npmjs.org/lefthook/2.1.10).

`lefthook@2.1.10` declares `postinstall: node postinstall.js` and
platform-specific optional binaries. Exact inspection did **not** justify
trusting Lefthook: `trustedDependencies` contains only `ccxt`. Automated
evidence and non-isolated validation must not run `lefthook install` or mutate
the main worktree `.git/hooks`.

At 2026-08-17T21:11–21:13+02:00, a no-script exact install attempt including
the nonexistent `@eslint/js@10.8.1` failed resolution before changing
`package.json` or `bun.lock`. It is no-change evidence, not an installation or
audit success.

**Historical, superseded installation proposal.** The command below was the
pre-implementation plan. It was superseded by the observed lifecycle-disabled
lock update and normal frozen-install record in
[`Phase 1 Slice A implementation evidence`](#phase-1-slice-a-implementation-evidence--2026-08-17t2155110200).

```sh
bun add --dev --exact --ignore-scripts @eslint/js@10.0.1 @tsconfig/bases@1.0.27 @types/node@24.13.3 @typescript-eslint/eslint-plugin@8.67.0 @typescript-eslint/parser@8.67.0 eslint@10.8.1 globals@17.11.0 turbo@2.10.10 typescript-eslint@8.67.0 prettier@3.9.6 eslint-config-prettier@10.1.8 eslint-plugin-unicorn@73.0.0 lefthook@2.1.10
```

Neither D-03 nor this compatibility audit authorizes a blanket dependency
update. CCXT, Zod, and `fraction.js` are explicitly excluded from Phase 1.

## Cross-phase guarded dependency migrations

| Dependency                            | Single allowed phase / atomic boundary                                       | Entry evidence (no circular dependency)                                                                  | Blocking evidence before the change                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fraction.js` `5.3.4`                 | Phase 2, only in `@mm-crypto-bot/numeric`.                                   | Phase 2 foundation ownership exists; no later phase is required.                                         | Exact arithmetic, property, and numeric public-API evidence.                                                                                              |
| Zod `3.25.76 -> 4.4.3` update/removal | Phase 3, separate DTO/guard boundary migration.                              | DTO/guard consumers migrate in Phase 3; no Phase 4/5 dependency.                                         | Consumer inventory, DTO boundary negative tests, and public contract evidence.                                                                            |
| CCXT `4.5.64 -> 4.5.70`               | A separate atomic dependency change after Phase 4 and before Phase 5 wiring. | Completed Phase 3 D-04 `PublicHistoricalClient` contract and completed Phase 4 Bybit EU safety evidence. | Fail-closed/no-network wrapper tests, provider authority/AST negatives, exact-10x/eligibility/borrow safety tests, frozen-install/audit/license evidence. |

The CCXT migration is blocked by either missing P3 or P4 evidence, not by
Phase 5; if it is not needed, Phase 5 does not wait for an update. The Zod and
numeric migrations likewise do not depend on later application wiring.

## Historical read-only baseline evidence — 2026-08-17

Recorded from `/home/eggp/projects/mm-crypto-bot` at
`2026-08-17T21:01:32+0200` Europe/Budapest. The baseline commit is
`1fe8687e9438388adf23e41016ece6cd0acf5456`; `bun.lock` SHA-256 is
`e7baaccff49d2b0ef7f22fb4edfab879d3f892c5255f388b070af9b3879c0500`; Bun is
`1.3.14`.

| Command                                                                    | Exit | Concise result                                                                        |
| -------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------- |
| `date '+%Y-%m-%dT%H:%M:%S%z %Z'`                                           |    0 | `2026-08-17T21:01:32+0200 CEST`                                                       |
| `git rev-parse HEAD`                                                       |    0 | `1fe8687e9438388adf23e41016ece6cd0acf5456`                                            |
| `sha256sum bun.lock`                                                       |    0 | `e7baaccff49d2b0ef7f22fb4edfab879d3f892c5255f388b070af9b3879c0500`                    |
| `bun --version`                                                            |    0 | `1.3.14`                                                                              |
| `bun audit`                                                                |    1 | `ConnectionRefused: audit request failed`; vulnerability status is **NOT EVIDENCED**. |
| `bun pm untrusted`                                                         |    0 | `Found 0 untrusted dependencies with scripts.`                                        |
| `git status --short plans/full-refactor`                                   |    0 | `?? plans/full-refactor/` (plan-only directory untracked).                            |
| `git diff --quiet -- package.json bun.lock apps/bot/package.json packages` |    0 | No tracked manifest or lockfile diff observed.                                        |

This is historical pre-implementation evidence only. The earlier supplied audit
summary remains not-current after the failed audit re-run. `bun pm untrusted`
reports package-script trust state, not a license, native-binary, or lifecycle
safety approval. The later observed exact-install records supersede its frozen
install/lifecycle status; audit, license, SBOM, and release evidence remain
**NOT EVIDENCED**.

## Phase 1 Slice A implementation evidence — 2026-08-17T21:55:11+0200

**DRAFT evidence; PENDING RE-REVIEW.** The current implementation is based on
the approved version matrix, not a replacement for the required release audit,
SBOM, license, or offline-artifact evidence. CWD was
`/home/eggp/projects/mm-crypto-bot`; commit was
`1fe8687e9438388adf23e41016ece6cd0acf5456`; final `bun.lock` SHA-256 is
`c30d17cb3a697d6a6981ec65a7f70b557dba722ad8532b85c10451bdc7d3979b`.

| Evidence                         | Result                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest policy                  | All root and current workspace external declarations are exact; internal dependencies remain `workspace:*`. Applied approved targets: `@tsconfig/bases` `1.0.27`, `@types/node` `24.13.3`, Turbo `2.10.10`, `protobufjs` `8.7.2`, `smol-toml` `1.8.0`, `write-file-atomic` `8.0.0`, and `picocolors` `1.1.1`. CCXT remains `4.5.64`; Zod remains exact `3.25.76`; fraction.js was not introduced. |
| Lifecycle-disabled lock update   | `bun install --ignore-scripts` exit 0; lockfile saved. No package lifecycle ran during this update.                                                                                                                                                                                                                                                                                               |
| Lifecycle inspection             | `ccxt@4.5.64` and `lefthook@2.1.10` were inspected locally. Both declare `postinstall`; Lefthook declares platform optional binaries. The former `ccxt`, `lefthook` trust claim is superseded: `trustedDependencies` is exactly `ccxt`; Lefthook is intentionally untrusted.                                                                                                                      |
| Historical normal frozen install | The prior root-worktree record (`Checked 257 installs across 284 packages`) is superseded for lifecycle/trust evidence by the isolated clean-install record below. It remains historical only.                                                                                                                                                                                                    |
| Remaining supply-chain evidence  | `bun audit` remains **NOT EVIDENCED** from the earlier `ConnectionRefused` result. This slice does not claim audit, license, SBOM, release ZIP, or implementation-review PASS.                                                                                                                                                                                                                    |

### Current isolated clean-install evidence — 2026-08-17T22:10:26+0200

**DRAFT evidence; PENDING RE-REVIEW.** This is the authoritative current
trust/lifecycle record for Slice A. CWD was
`/home/eggp/projects/mm-crypto-bot`; the controlled isolated Git repository was
`/tmp/mm-crypto-bot-clean-install.fNVvfJ`. It was populated with the exact root
manifest, `bun.lock`, `bunfig.toml`, `apps/`, and `packages/`, and had no
`node_modules` before the command. The main worktree did not run a normal
install and no `lefthook install` command ran.

| Command / observation                                                                                                                     | Exit / result                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile --cwd /tmp/mm-crypto-bot-clean-install.fNVvfJ` (escalated after the sandbox returned `ReadOnlyFileSystem`) | 0; Bun `1.3.14`; `484 packages installed [1074.00ms]`.                                                                                                                                                                                                                            |
| Temp Git-hook inventory before and after the normal install                                                                               | Both SHA-256 aggregate values were `d505fb550fbecb523dfd616ed39d40ea50d1efc68e19183c35066fefafd475d7`; no hook file changed.                                                                                                                                                      |
| Main worktree                                                                                                                             | `.git/hooks` was not targeted; `lefthook install` was not invoked. The current observed main inventory aggregate is `fa945fdd50a6bc7475ffd126dd9ec24c86274284e59e9eab99ba5d5326ba5e79`; no before/after pair was taken in this remediation, so equality is **NOT ASSERTED** here. |
| Trust and script metadata                                                                                                                 | Root `trustedDependencies` is exactly `ccxt`; Lefthook is absent. `bun pm untrusted` exited 0 and printed `Found 0 untrusted dependencies with scripts.` This is an observed Bun result, not proof that Lefthook is trusted, lifecycle-safe, audited, or activated.               |
| Lock/manifest identity                                                                                                                    | Commit `1fe8687e9438388adf23e41016ece6cd0acf5456`; `bun.lock` SHA-256 `c30d17cb3a697d6a6981ec65a7f70b557dba722ad8532b85c10451bdc7d3979b`; the trust-list-only edit did not alter that lock hash.                                                                                  |

This isolated result supersedes the earlier current `ccxt`, `lefthook` trust
claim and root normal-install lifecycle claim. It does not close the required
audit, license, SBOM, release, isolated activation E2E, or independent review
gates.

### Current representative clean-install evidence — 2026-08-17T22:10:26+0200

**DRAFT evidence; PENDING RE-REVIEW.** This record supersedes the prior
temporary fixture and is the authoritative current install/trust evidence. A
new `mktemp -d` fixture at `/tmp/mm-crypto-bot-slice-a.bZvvlF` received root
`package.json`, exact `bun.lock`, `bunfig.toml`, `lefthook.yml`, and all
`apps/` and `packages/` install-relevant workspace inputs; it had no
`node_modules` before installation. It was a Git repository solely for hook
inventory. Both this 426 MB fixture and the prior 426 MB
`/tmp/mm-crypto-bot-clean-install.fNVvfJ` fixture were path-validated under
`/tmp` and removed after evidence capture.

| Command / observation                                                   | Exit / result                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main hook aggregate before/after the validation                         | Both `2cbf26be4cfe5e6c621a2b2759cf5913880abcbb018617a5f4e4a7e27ccf62d9`; no main `.git/hooks` mutation.                                                                                                        |
| `bun install --frozen-lockfile --cwd /tmp/mm-crypto-bot-slice-a.bZvvlF` | 0; Bun `1.3.14`; `484 packages installed [531.00ms]`; no `--ignore-scripts`.                                                                                                                                   |
| Temp hook aggregate before/after the normal install                     | Both `45b0aef8748325a76a11fa9f578c28e9da10fa401273959b86eb9a555dbbd83a`; no generated Lefthook hook.                                                                                                           |
| `bun pm untrusted --cwd /tmp/mm-crypto-bot-slice-a.bZvvlF`              | 0; reports `./node_modules/lefthook @2.1.10` and `postinstall` lifecycle **blocked during install**. Lefthook is intentionally untrusted.                                                                      |
| Lefthook binary/config availability                                     | `/tmp/mm-crypto-bot-slice-a.bZvvlF/node_modules/.bin/lefthook validate` exited 0; validation did not install a hook.                                                                                           |
| Lock/manifest trust identity                                            | `package.json` and regenerated `bun.lock` both serialize only `ccxt` under `trustedDependencies`; no Lefthook entry. Current lock SHA-256: `442b050e7922a89ecba1ca262d5a8c869de771af068ffd19e94d0a10a8407b40`. |

The old `c30d…` lock identity and fixture claims are historical/superseded.
The successful install is not audit, license, SBOM, release, or activation-E2E
evidence, and it does not authorize a main-worktree hook installation.

### D-01 exact governing sentence replacement

The later, separately reviewed governing patch must replace the current sentence
`Husky and lint-staged MUST run ESLint before Prettier at pre-commit.` with this
exact approved sentence:

> `Lefthook MUST run ESLint before Prettier at pre-commit, then run only the allowlisted clean:artifacts command and worktree inspection.`

The current implementation diff applies this exact replacement. Exact
package/lifecycle inspection, targeted hook tests, and frozen-install evidence
are recorded above; independent implementation review remains pending.

### Controlled Lefthook activation contract

After a clean frozen install with Lefthook intentionally untrusted, activation
evidence must create an isolated temporary Git clone or repository. It may run
and verify `lefthook install`
**only in that isolated repository**, then inspect the generated hook path,
content, and launcher. A real pre-commit subprocess E2E there must prove the
ordered `ESLint -> Prettier -> clean:artifacts -> worktree inspection` stages,
fail-fast behavior, and exit propagation. The main worktree `.git/hooks` stays
untouched throughout installation, validation, and E2E evidence.

The implementation includes two separate contracts. The automated/evidence path
uses only the isolated temporary repository above. The explicit developer
bootstrap path begins only after a successful frozen install: a human/operator
in their own clone runs the documented exact repo-local
`./node_modules/.bin/lefthook install` command (or the documented exact repo-local
equivalent), verifies the generated hook, and may deterministically run the
matching uninstall/reinstall sequence. It is not automatic `postinstall`, CI,
or agent evidence without separate authority. CI validates Lefthook
configuration and hook-pipeline contracts only; CI does not install Git hooks.
Bootstrap documentation and smoke tests prove the human procedure; negative
tests reject an absent or untrusted binary and prove that automated evidence
never created or changed a main-worktree Git-hook path.

## Approved direction; implementation not complete

| Candidate                                                                                                      | Proposal                                                                                                  | Reason                                                              | Approval/evidence required                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fraction.js`                                                                                                  | Add only to `@mm-crypto-bot/numeric` at `5.3.4` in guarded Phase 2.                                       | Required exact rational wrapper target.                             | Exact arithmetic/property/public-API, official package/release, license/audit evidence.                                                                                                                                                                                                                           |
| `@eslint/js`, `typescript-eslint`, `eslint-plugin-security`, `eslint-plugin-unicorn`, `eslint-config-prettier` | Exact-pin `@eslint/js` `10.0.1`, Unicorn `73.0.0`, and the remaining recorded 2026-08-17 targets at root. | Binding strict flat lint target.                                    | Frozen install, official compatibility matrix, lint fixture/zero-warning tests.                                                                                                                                                                                                                                   |
| `prettier`                                                                                                     | Add exact-pinned `3.9.6` root formatter.                                                                  | Binding format and CI requirement.                                  | Deterministic format checks.                                                                                                                                                                                                                                                                                      |
| Lefthook                                                                                                       | Add exact-pinned `2.1.10` as D-01 governing replacement target.                                           | Ordered hook policy.                                                | Exact-install package/lifecycle/platform-binary inspection; Lefthook remains absent from `trustedDependencies`; isolated automated activation E2E, documented human bootstrap/uninstall/reinstall smoke, actual standards patch, hook tests and review; never mutate the main worktree during automated evidence. |
| Husky + lint-staged                                                                                            | Remove/replace under D-01.                                                                                | Rejected policy.                                                    | Validate no obsolete hook path remains.                                                                                                                                                                                                                                                                           |
| Existing `zod`                                                                                                 | Keep `3.25.76` pending guarded Phase 3 update/removal at `4.4.3`.                                         | Target requires named guards, not necessarily a validation library. | DTO/guard consumer, boundary, and negative guard tests.                                                                                                                                                                                                                                                           |
| Existing CCXT                                                                                                  | Retain exact-pinned `4.5.64`; consider `4.5.70` only in the separate post-P4/pre-P5 atomic change.        | Sole live adapter plus D-04 public research adapter.                | P3 `PublicHistoricalClient` plus P4 Bybit EU fail-closed/no-network/safety evidence.                                                                                                                                                                                                                              |

## C4b exact numeric dependency evidence — 2026-08-18T03:49:26+0200

**DRAFT implementation evidence; PENDING RE-REVIEW.** `@mm-crypto-bot/numeric`
is now the sole declared owner of exact-pinned `fraction.js` `5.3.4`. Its
package metadata reports MIT, bundled TypeScript declarations, zero dependency
entries, and only upstream build/test scripts; no lifecycle script is declared.
The resolved lock record is `fraction.js@5.3.4` with integrity
`sha512-1X1NTtiJphryn/uLQz3whtY6jK3fTqoE3ohKs0tT+Ujr1W59oopxmoEh7Lu5p6vBaPbgoM0bzveAW4Qi5RyWDQ==`.

The lifecycle-disabled exact install changed `bun.lock` from
`e90148f0f1dd804f5a1c3d0ecbc7bb87a3db31e941acc33a116c701ad86b8f38` to
`98d327ba77248ed8e514f27991a4f43582380742ac3dc2fd87ffea8d04636c1e`.
Escalated `bun audit` at `2026-08-18T03:34:40+0200` exited 0 with “No
vulnerabilities found”. `bun pm untrusted` reports only blocked Lefthook
postinstall; `trustedDependencies` remains exactly `ccxt`. The isolated
frozen, lifecycle-disabled install and hook invariants are in ER-052. This is
package/dependency evidence only, not release or repository verification.

The version-specific authoritative registry reference is
[fraction.js 5.3.4](https://www.npmjs.com/package/fraction.js/v/5.3.4); the
upstream project is [Fraction.js](https://github.com/rawify/Fraction.js).
Coordinator-supplied official metadata was verified as the latest stable target
on `2026-08-18`: version `5.3.4`, MIT license, built-in TypeScript declaration
entry, and zero dependency entries. The exact observed lock record above is the
resolution basis, not a version-range inference.

At repository CWD `/home/eggp/projects/mm-crypto-bot`, the sandbox audit
attempt encountered `ConnectionRefused`; its completion timestamp is **NOT
OBSERVED** and it is **NOT EVIDENCED**. A controlled escalation was then authorized solely because
registry network access is necessary for the user-approved dependency audit;
it made no repository, hook, provider, or other external-state change. The
exact command `bun audit` ran with Bun `1.3.14`, exited `0`, and found zero
vulnerabilities against lock SHA-256
`98d327ba77248ed8e514f27991a4f43582380742ac3dc2fd87ffea8d04636c1e`. Its
normalized non-sensitive output is
[recorded evidence](evidence/c4b-bun-audit-2026-08-18.txt), SHA-256
`632baba77d06bc1d76bc81a2e40e7fdaaf504af73f5197b382aa21583890a6a9`.
| `protobufjs`, `smol-toml`, `write-file-atomic`, `picocolors` | Isolate pure minor updates (`8.7.2`, `1.8.0`) from exact-only retains (`8.0.0`, `1.1.1`). | Avoid a blanket update and preserve a consumer-level rollback. | `rg` consumer evidence, frozen install, audit/license tests. |

## Compatibility evidence protocol

Before any change, collect direct official sources for Bun workspace/version
behavior, TypeScript 6 release/migration, Turbo task schema, ESLint flat config
and plugin peer requirements, Prettier integration, chosen hook mechanism,
Node supported releases, CCXT Bybit EU behavior, CCXT Pro provider/method scope,
and every new package's release and security status. Third-party blog pages are
not compatibility evidence. D-04 official-current evidence was reviewed on
2026-08-17: [CCXT Pro](https://docs.ccxt.com/docs/pro),
[CCXT Pro manual](https://docs.ccxt.com/docs/pro-manual),
[CCXT manual](https://docs.ccxt.com/docs/manual), and the
[CCXT source repository](https://github.com/ccxt/ccxt). This plan did not
live-verify any provider history.

Run, record, and review: `bun --version`; `bun pm ls --all`; `bun outdated`;
`bun audit`; `bun pm untrusted`; frozen `bun install --frozen-lockfile`;
dependency license/SBOM generator; and a no-network verification run. A failed
network lookup is `NOT YET EVIDENCED`, never a clean audit result.

The release evidence is machine-readable and records the audit tool name and
exact version, Europe/Budapest timestamp, lockfile SHA-256, command/exit result,
and report SHA-256. `ARTIFACTS.md` requires that evidence to be included in, or
integrity-addressably referenced by, every ZIP manifest; smoke validation rejects
its absence or hash mismatch.

## TypeScript 6 plan

`OBSERVED`: TypeScript `6.0.3` is already declared. `APPROVED TARGET`: retain
exact `6.0.3` as the supported 6.x version; TypeScript 7 is excluded.
`REQUIRED TARGET`: strict
TypeScript remains enabled; unsafe assertions, `any`, `@ts-ignore`, and
`@ts-nocheck` remain forbidden. `PROPOSAL`: remove transitional deprecated
option suppressions only after a project-reference/typecheck migration proves
the replacement configuration. Define package-level composite/project references
only if their clean build and public declaration contract are compatible with
Bun/Turbo. The direction is approved, while implementation still requires
official compatibility and supply-chain evidence.

## Turbo plan

`OBSERVED`: `turbo.json` currently has global `.env`, cache-disabled lint/test
tasks, and task inputs that omit several proposed configuration/docs/release
inputs. `NOT YET EVIDENCED`: whether its current cache/output declarations are
correct for every package/app.

`PROPOSAL`: define explicit root tasks for `format`, `format:check`, `lint`,
`typecheck`, `build`, `test:unit:coverage`, `test:e2e:coverage`, `architecture`,
`dependency:check`, `release`, `artifact:smoke`, and `verify`; specify true
inputs/outputs/environment variables and keep credential-bearing variables out
of cache keys/logs. The exact task schema and cache policy require official
Turbo evidence and user approval where behavior changes.
