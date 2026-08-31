# CCXT 4.5.75 dependency upgrade validation

## Scope and authority

- Classification: non-review implementation; live exchange dependency, public API,
  four package manifests, lockfile, and supply-chain update.
- Route: `terra_worker` (`gpt-5.6-terra`, high); workspace-write.
- Owned files: root `package.json`, `packages/exchange/package.json`,
  `packages/shared/package.json`, `packages/backtest-tools/package.json`, and
  `bun.lock`. No source, test, staging, or commit change was made by this task.
- Unrelated dirty-worktree changes were preserved. The lockfile already had
  concurrent logging-workspace entries before this update; `bun install` retained
  those entries while regenerating the lockfile.

## Official release evidence

- The official npm registry `latest` document reported `4.5.75`, tarball
  `https://registry.npmjs.org/ccxt/-/ccxt-4.5.75.tgz`, and integrity
  `sha512-d9wuZ/Fq8yMNiMPZok3kBdUfRdcKshBWHAHDjUsar7SYREDX4qhMim07l6ynvDJ/KVDmg6/HwW2kkFX3ZC2y/A==`.
- The official CCXT GitHub release is stable (not prerelease), tag `v4.5.75`,
  published `2026-08-21T11:05:23Z`. Its annotated tag resolves to commit
  `4abd957deff17b6777ada3c5482648c020bd6c8c`.
- Primary links: https://www.npmjs.com/package/ccxt and
  https://github.com/ccxt/ccxt/releases/tag/v4.5.75.

## Change audit, 4.5.64 through 4.5.75

The official release notes do not list a `bybiteu`-specific breaking change.
Relevant shared Bybit/Pro changes that required compatibility validation are:

- `v4.5.72`: Bybit flexible-available-inventory implicit API addition and a fix
  for spot-market-buy amount parsing; shared Pro/WebSocket changes are also
  present.
- `v4.5.71`: Bybit private WebSocket authentication error handling, OHLCV start
  alignment, wallet-margin balance parsing, and WS trade-operation auth-error
  handling.
- `v4.5.74`: breaking removal of Bybit classic-account `fetchOrders`, plus a
  Bybit `fetchCrossBorrowRate` fix and several shared Pro cache changes.
- `v4.5.75`: shared Pro `ArrayCache` performance and authentication refactors;
  no Bybit or `bybiteu` release-note entry.

The repository uses only the explicit `bybiteu` feed port and its Raw DTO
adapter. It does not call the removed classic `fetchOrders` API.

## Exact manifest and lock update

All active exact pins were changed from `4.5.64` to `4.5.75` without ranges:

- `package.json`
- `packages/exchange/package.json`
- `packages/shared/package.json`
- `packages/backtest-tools/package.json`
- `bun.lock`

`bun install` with Bun `1.3.14` regenerated `bun.lock`; it introduced CCXT 4.5.75
transitives `undici@7.29.0` and optional `fflate@0.8.3`, and removed the former
CCXT-only `@scure/bip32` and `@scure/bip39` entries. The lock integrity is the
official registry integrity above.

## Bybit EU compatibility observations

- `ccxt.pro.bybiteu` and REST `ccxt.bybiteu` both construct successfully; the
  Pro instance has `id === "bybiteu"`.
- Fresh repo-root ESM probe of `new ccxt.pro.bybiteu({ enableRateLimit: true })`
  reported `id: "bybiteu"` and functions for
  `privateGetV5SpotMarginTradeState`,
  `privateGetV5OrderSpotBorrowCheck`, and
  `privatePostV5SpotMarginTradeSetLeverage`. The same three functions are
  declared in the installed `bybiteu` abstract TypeScript declaration and are
  present through CommonJS as well.
- An earlier probe used the wrong names
  (`privatePostV5SpotMarginTradeState` and
  `privatePostV5SpotMarginTradeBorrow`) and was therefore false. It was
  corrected before this evidence was handed off.
- Method availability proves only that CCXT generated the local endpoint
  methods. It does not prove successful authenticated Bybit EU responses,
  account eligibility, Spot Margin mode, exact selected leverage, borrow
  capacity, authorization freshness, or live readiness. No request was sent,
  no endpoint name was substituted, and no business, leverage, or order
  behavior was changed.
- The npm package metadata and CommonJS bundle identify themselves as `4.5.75`,
  but its ESM `js/ccxt.js` and `js/ccxt.d.ts` report `4.5.74`. Since the
  repository uses ESM imports, this upstream package-content inconsistency is
  recorded as a release-quality concern. The manifest and resolved artifact are
  still exactly `4.5.75`; no local distribution rewrite was made.

## Commands and gates

| Command                                                                                                                     | Result                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install`                                                                                                               | PASS; resolved `ccxt@4.5.75` and saved lockfile.                                                                                                                                                                                               |
| `bun install --frozen-lockfile`                                                                                             | PASS; 266 installs across 290 packages, no changes.                                                                                                                                                                                            |
| `bun pm ls --all`                                                                                                           | PASS; resolved `ccxt@4.5.75`.                                                                                                                                                                                                                  |
| `bun audit`                                                                                                                 | PASS; no vulnerabilities found.                                                                                                                                                                                                                |
| Fresh `new ccxt.pro.bybiteu({ enableRateLimit: true })` probes, ESM and CommonJS                                            | PASS: `privateGetV5SpotMarginTradeState`, `privateGetV5OrderSpotBorrowCheck`, and `privatePostV5SpotMarginTradeSetLeverage` are functions; no network request was sent.                                                                        |
| `bunx prettier --check` on touched exchange production/tests                                                                | PASS.                                                                                                                                                                                                                                          |
| `bunx eslint` on touched exchange production files                                                                          | PASS, 0 errors and 0 warnings.                                                                                                                                                                                                                 |
| `bunx eslint` on the two new exchange test files                                                                            | BLOCKED by existing ESLint project-service test exclusion, not a lint violation.                                                                                                                                                               |
| `bunx tsc -p packages/exchange/tsconfig.json --noEmit`                                                                      | FAIL: concurrent `bybit-eu-adapter.test-support.ts` lacks newly required `OrderBook.copy`; unrelated to CCXT 4.5.75.                                                                                                                           |
| `bunx tsc -p packages/exchange/tsconfig.tests.json --noEmit`                                                                | FAIL: the same `OrderBook.copy` fixture error plus old test fakes assigning CCXT `Exchange` directly to the new `BybitEuClient` port and watch-test fake typing errors. These are test-modernization debt, not a CCXT version incompatibility. |
| `bun run --filter @mm-crypto-bot/exchange build`                                                                            | PASS.                                                                                                                                                                                                                                          |
| `bun test packages/exchange/src/spot-margin-authorization.test.ts packages/exchange/src/bybit-eu-spot-margin-order.test.ts` | PASS: 16 tests, 20 expectations.                                                                                                                                                                                                               |
| `bun test --only-failures packages/exchange/src packages/exchange/tests`                                                    | FAIL: 393 pass, 2 failures, both stale private-state tests (`tests/bybit-eu-feed-normalizers.test.ts` references removed `subs`; `src/bybitEuFeed.test.ts` expects private `client` instead of public `raw`).                                  |
| `bun run --filter @mm-crypto-bot/shared typecheck build test`                                                               | PASS: 102 tests.                                                                                                                                                                                                                               |
| `bun run --filter @mm-crypto-bot/backtest-tools typecheck build`                                                            | PASS.                                                                                                                                                                                                                                          |
| `bun test --only-failures packages/backtest-tools/src`                                                                      | FAIL: 235 pass, 12 failures, all absent repository `data/funding` or `data/ohlcv` fixtures; no CCXT assertion failed.                                                                                                                          |
| `bun run --filter @mm-crypto-bot/bot typecheck build`                                                                       | PASS.                                                                                                                                                                                                                                          |
| `git diff --check` for the owned dependency files                                                                           | PASS.                                                                                                                                                                                                                                          |

The full exchange and backtest test gates are intentionally recorded as failing,
with exact attribution. They must be repaired and independently reviewed before
any coherent commit that claims those gates are green.

## Process-review remediation and closure status

### Dispatch contract

- Task class/review role: non-review write/implementation.
- Terra trigger: live exchange dependency + public API + multi-package
  lockfile/supply-chain change => terra_worker.
- Requested/effective route: `terra_worker` / `gpt-5.6-terra` / high. The route
  assignment is observable from the coordinator task record; no separate
  provider attestation is available.
- Write authority: workspace-write. Effective sandbox is observed only as the
  agent runtime's `workspace-write` declaration; lower-level policy is not
  independently attested.
- Ownership: root plus three workspace package manifests (four dependency
  declarations), `bun.lock`, and this evidence file. Domain risk is live
  exchange/public API and supply chain. Reasoning requires primary-source
  release audit, generated API inspection, and a fail-closed reading of
  non-authenticated evidence.
- External mutable resources: npm registry, CCXT GitHub releases/tags, and Bun
  resolution. No exchange endpoint or authenticated request was sent.
- Required independence: `terra_reviewer` technical and
  `luna_process_reviewer` process review. The process review found this evidence
  insufficient; technical closure remains pending.
- Fallback/escalation: none; no Agy route was eligible or used.

### Shared-worktree contamination and commit-scope inventory

No task-time file-by-file pre-dispatch snapshot was preserved. The temporal
ownership of the shared hunks below is therefore **NOT EVIDENCED**. They are
excluded from a future CCXT-only staged patch/commit scope; their occurrence in
the current `HEAD..worktree` diff does not prove that they pre-dated this task.

| File                                   | Shared hunk in current diff                                                                                        | CCXT-only scope treatment                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                         | `@mm-crypto-bot/logging: workspace:*` addition                                                                     | Exclude as concurrent logging hunk; retain the exact pin substitution and the intentional `trustedDependencies` removal as CCXT security/lifecycle remediation. |
| `package.json`                         | `trustedDependencies` removal                                                                                      | Retain. This is intentional CCXT security/lifecycle remediation, not a concurrent logging hunk.                                                                 |
| `packages/exchange/package.json`       | `./testing` export addition                                                                                        | Exclude; retain only the exact pin substitution.                                                                                                                |
| `packages/shared/package.json`         | `./logger` export removal                                                                                          | Exclude; retain only the exact pin substitution.                                                                                                                |
| `packages/backtest-tools/package.json` | No non-CCXT hunk observed                                                                                          | Retain only the exact pin substitution; this does not prove isolation.                                                                                          |
| `bun.lock`                             | Root/app logging references and `packages/logging` workspace entry                                                 | Exclude from CCXT-only staged patch.                                                                                                                            |
| `bun.lock`                             | CCXT resolution, removal of `@scure/bip32`/`@scure/bip39`, and addition of `undici@7.29.0`/optional `fflate@0.8.3` | Required Bun-generated CCXT resolution/transitive portion.                                                                                                      |

These hashes describe only the current worktree, not a task-time baseline:

| File                                   | `HEAD` SHA-256                                                     | Current SHA-256                                                    |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `package.json`                         | `de5ad48dd19d2eafa7e95766573022451c5731ea81ca7e9ab73ec84eb87a807e` | `bf8bbe2618e214b5eb3d03d4ae2a3a16dbc3133c57010f40778d1dc3cc9656ab` |
| `packages/exchange/package.json`       | `39a3258f5fa0d351df0c937c3d52074bfd96635e7e20ffe312ae927dda4f5b83` | `08413ce5acd5be67b97b184e32ccf3bbc857ce84d041ab416568e5da4c9fea03` |
| `packages/shared/package.json`         | `0aa9aae88ddd3344d9240927cebf227838c3dfa231e311b45bc7a80f3b89f1f6` | `e5e1e6c9aba2510d13a74ce17c1205a06723497df799ae52aa5bdb6372c74c58` |
| `packages/backtest-tools/package.json` | `905c2f7fc26c8779d445419a3d263e328b34758c96cb50112ac3a5d0563e1407` | `48ec715b92dab187bd72abc77ca3f3c3e32c2ad858c11797bbf03f5935eca95b` |
| `bun.lock`                             | `98d327ba77248ed8e514f27991a4f43582380742ac3dc2fd87ffea8d04636c1e` | `bc714dbe0ef5a5998986f88dc6d5f725663ba1f3dc05e847f44d095ff930b5dc` |

The intended CCXT delta is four exact pin substitutions, Bun-generated CCXT
resolution, and intentional CCXT `trustedDependencies` security/lifecycle removal.
Exclusive task-time ownership remains **NOT EVIDENCED**, so
closure/commit is blocked until reviewed staging proves this separation.

### Endpoint-probe lineage

The initial probe used incorrect names
`privatePostV5SpotMarginTradeState` and
`privatePostV5SpotMarginTradeBorrow`, rather than
`privateGetV5SpotMarginTradeState` and
`privateGetV5OrderSpotBorrowCheck`. Its command text is recoverable from the
session transcript, but timestamp, durable output artifact/hash, and
independently auditable exit record are **NOT EVIDENCED**. It is not used as
compatibility proof.

Fresh revalidation has these durable in-record payloads; both exited 0 and made
no network request:

- ESM at `2026-08-23T21:45:01.905Z`, SHA-256
  `b82f7db1243cb6d9c09a05752b317d154623e0c919ad27fac57dc084f8ae2b24`:
  `{"observedAtUtc":"2026-08-23T21:45:01.905Z","moduleSystem":"esm","packageVersion":"4.5.75","ccxtVersion":"4.5.74","id":"bybiteu","state":"function","borrowCheck":"function","setLeverage":"function"}`.
- CommonJS at `2026-08-23T21:45:02.006Z`, SHA-256
  `884122b120a443f4988625173d03458b3ce8101d32d7f3c5ecf7bfae2078a028`:
  `{"observedAtUtc":"2026-08-23T21:45:02.006Z","moduleSystem":"commonjs","packageVersion":"4.5.75","ccxtVersion":"4.5.75","id":"bybiteu","state":"function","borrowCheck":"function","setLeverage":"function"}`.

Availability proves only locally generated methods. It does not prove an
authenticated Bybit EU response, eligibility, margin mode, exact leverage,
borrow capacity, freshness, or live readiness.

### HIGH upstream release-integrity blocker

The package metadata, lock resolution, and CommonJS entry identify `4.5.75`,
but installed ESM `js/ccxt.js` and `js/ccxt.d.ts` identify `4.5.74`. Because
this repository uses ESM, this is a **HIGH upstream release-integrity blocker**
owned by upstream CCXT and this dependency slice.

The user-required exact pin remains `4.5.75`: no downgrade, range, local
artifact patch, or alternate venue is authorized. This slice is **NOT PASS**
for final dependency acceptance, live readiness, or commit. It needs an
upstream corrected artifact or official clarification, then fresh exact-latest
resolution, integrity, ESM/CJS, Bybit EU port/consumer, and independent review
validation.

## Technical-review remediation update — 2026-08-24

The following remediations are implementation evidence only and remain
**PENDING independent technical and process re-review**. They do not clear the
HIGH upstream ESM release-integrity blocker or authorize live readiness.

### Remediated compatibility and test seams

- `packages/exchange/src/bybit-eu-adapter.test-support.ts` now implements the
  CCXT 4.5.71-required `OrderBook.copy()` fixture method with a deterministic,
  independent copy of every level and scalar. There is no assertion, `any`, or
  production behavior change.
- The stale close test now uses only `open`, `subscribeTicker`,
  `waitForSubscription`, and `close`. The C1 test verifies the native Pro
  instance through public `feed.raw`; neither test accesses a private field,
  uses a cast, or adds a disable.
- The full exchange suite now passes: `bun run --filter
@mm-crypto-bot/exchange test` exited 0 with **395 pass, 0 fail, 783
  expectations**. Exchange source typecheck and build also exit 0.
- Test-inclusive exchange typecheck remains **FAIL / not this slice's source
  failure**: source fixture copy is repaired, but the current test suite still
  has direct `ccxt.Exchange` to `BybitEuClient` fake assignments (including
  `src/bybit-eu-spot-margin-order.test.ts` and many concurrent
  `src/bybitEuFeed.test.ts` sites) plus existing `tests/bybit-eu-feed-watch.test.ts`
  fake typing errors. This is separate test-modernization work; no pass is
  claimed.

### Resolved-package provenance and bounded runner extraction

`run-arb-latency.ts` no longer reads ESM `ccxt.version`. It calls
`resolveCcxtPackageVersion`, which resolves the installed `ccxt` entry and
validates the neighbouring artifact's `package.json` against the active
`packages/backtest-tools/package.json` exact dependency pin. The installed
package name must be `ccxt`; both installed and expected versions must be
canonical semantic-version text; and the two versions must match exactly.
Read/parse, wrong-package, malformed/missing/ranged expected dependency, and
version-mismatch input fail closed with a typed error. The focused test suite
also covers both dependency-read failures, a non-file resolver URL, structural
metadata/manifest errors, invalid prerelease/build identifiers, invalid
identifier characters, and leading-zero versions.

The runner is now 437 lines. Its pure latency estimate, opportunity summary,
readiness, and JSON-safe rounding functions were mechanically moved to
`arb-latency-calculations.ts` (125 lines), without changing the formula. The
targeted parity test asserts exact summary values, PASS/PARTIAL/FAIL readiness
boundaries, and JSON-safe finite/non-finite rounding. Focused commands all
exit 0:

| Command                                                                                                                                                                                                                                                                                                                                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bunx eslint --config eslint.config.js --max-warnings=0 packages/backtest-tools/src/cli/run-arb-latency.ts packages/backtest-tools/src/cli/arb-latency-calculations.ts packages/backtest-tools/src/cli/arb-latency-calculations.test.ts packages/backtest-tools/src/cli/ccxt-package-provenance.ts packages/backtest-tools/src/cli/ccxt-package-provenance.test.ts packages/backtest-tools/vitest.ccxt-provenance.config.mjs` | PASS, 0 errors, 0 warnings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `bun run --filter @mm-crypto-bot/backtest-tools typecheck`                                                                                                                                                                                                                                                                                                                                                                    | PASS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `bun run --filter @mm-crypto-bot/backtest-tools build`                                                                                                                                                                                                                                                                                                                                                                        | PASS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `bun test packages/backtest-tools/src/cli/arb-latency-calculations.test.ts packages/backtest-tools/src/cli/ccxt-package-provenance.test.ts`                                                                                                                                                                                                                                                                                   | PASS, 19 tests, 54 expectations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `bunx vitest run --config vitest.ccxt-provenance.config.mjs --coverage.enabled true --coverage.reportsDirectory /tmp/mm-ccxt-v8-coverage-durable` (from `packages/backtest-tools`)                                                                                                                                                                                                                                            | PASS. Repo-owned focused configuration aliases existing `bun:test` imports to Vitest only for this two-test, two-runtime-file V8 measurement; configuration SHA-256 is `bb379759084c306385b861c7555578193f2d2f5a77768cdd6f64014dc28635f5`. The fail-closed configured thresholds are 100% for statements, branches, functions, and lines. Result: statements **122/122**, branches **110/110**, functions **30/30**, lines **112/112**; LCOV SHA-256 `857f27f83472060a60b7fe9573cc5f1f2cd1c72b98f306fa183245405d0b80f4`. |

The coordinator independently re-ran the same exact durable command from
`packages/backtest-tools`; it also passed two files/19 tests with the same four
100% metrics. This is current validation evidence, not an independent review.

The complete backtest-tools suite remains **FAIL / unrelated fixture debt**:
239 pass, 12 fail, 251 tests. The failures require absent real
`data/funding`/`data/ohlcv` CSV inputs (including DPC overlay, OHLC trend, and
SOL funding replay CLI tests); the focused provenance tests pass and no CCXT
assertion failure was observed.

### Trust and lifecycle observations

The root `trustedDependencies` property is absent, as is the corresponding
lock entry. The toolchain contract test now requires both CCXT and Lefthook to
be absent from explicit trust and requires no root `postinstall` script.

An owned fresh isolated workspace `/tmp/mm-ccxt-trust.JUdri0` was created with
`mktemp`; no shared temporary directory was removed. Its
`CI=1 bun install --cwd <workspace> --frozen-lockfile --ignore-scripts` and
ordinary `CI=1 bun install --cwd <workspace> --frozen-lockfile` both exited 0.
`bun pm untrusted --cwd <workspace>` reported `ccxt@4.5.75` postinstall as
blocked. It did **not** list Lefthook despite Lefthook's package metadata
declaring postinstall; this is observed Bun behavior, not evidence that
Lefthook is explicitly trusted, safe, or blocked. The CCXT postinstall source
contains GitHub `fetch` calls, so CCXT's untrusted/blocking status is material.
No claim that both packages were reported blocked is made.

`bun install --ignore-scripts` and `bun install --frozen-lockfile
--ignore-scripts` both pass at repository root (266 installs across 290
packages). `bun pm ls --all` resolves `ccxt@4.5.75`. The coordinator supplied a
fresh repository-root `bun audit` result on 2026-08-24: exit 0, `No
vulnerabilities found`; this worker did not independently reproduce that audit
after its own earlier `ConnectionRefused`, so the source is explicitly
coordinator-supplied current evidence.

### Current dirty-worktree inventory and disposition

Current SHA-256 values are `package.json`
`2bb3bc0a955af1a7ff3e25ad99dc66e5d10ab3fd9061d73b8b660bf50aadc71d`,
`packages/exchange/package.json`
`08413ce5acd5be67b97b184e32ccf3bbc857ce84d041ab416568e5da4c9fea03`,
`packages/shared/package.json`
`e5e1e6c9aba2510d13a74ce17c1205a06723497df799ae52aa5bdb6372c74c58`,
`packages/backtest-tools/package.json`
`48ec715b92dab187bd72abc77ca3f3c3e32c2ad858c11797bbf03f5935eca95b`,
and `bun.lock`
`cfd0bb13be1e4c0e01799e0562ee448768e870ce958eeb4fd9fd4098d04b38de`.
They remain current-worktree evidence only, not a pre-dispatch baseline.
Concurrent logging/export/lock hunks remain excluded from a future CCXT-only
staged patch. Current `git diff --check` passes. A focused credential-marker
scan over the owned manifests, exchange/backtest/tooling paths, CCXT evidence,
and current docs found no `AKIA`, private-key header, or GitHub-token marker.
Those checks must be rerun by the independent reviewers against their observed
final shared worktree. No stage or commit was made.

## Staged-scope commit-preparation addendum — 2026-08-24

At `2026-08-24T00:40:44+02:00` Europe/Budapest,
`git diff --cached --name-status` reports a 24-path intended CCXT subset:

- `bun.lock`
- `docs/STACK.md`
- `docs/research/sources-stack.md`
- `docs/research/stack-findings.md`
- `docs/research/tui-decision.md`
- `docs/research/version-pins.md`
- `package.json`
- `packages/backtest-tools/package.json`
- `packages/backtest-tools/src/cli/arb-latency-calculations.test.ts`
- `packages/backtest-tools/src/cli/arb-latency-calculations.ts`
- `packages/backtest-tools/src/cli/ccxt-package-provenance.test.ts`
- `packages/backtest-tools/src/cli/ccxt-package-provenance.ts`
- `packages/backtest-tools/src/cli/run-arb-latency.ts`
- `packages/backtest-tools/vitest.ccxt-provenance.config.mjs`
- `packages/exchange/package.json`
- `packages/exchange/src/bybitEuFeed.ts`
- `packages/exchange/tests/bybit-eu-feed-normalizers.test.ts`
- `packages/shared/package.json`
- `plans/full-refactor/ARCHITECTURE.md`
- `plans/full-refactor/DEPENDENCIES.md`
- `plans/full-refactor/EXECUTION-RECORD.md`
- `plans/full-refactor/REVIEW-EVIDENCE.md`
- `plans/full-refactor/evidence/ccxt-4.5.75-upgrade-validation.md`
- `scripts/tooling/toolchain-contract.test.ts`

Its intended content is the four exact `4.5.75` pins; the CCXT-only Bun lock
resolution/transitives and root `trustedDependencies` removal; backtest
provenance and latency-calculation refactor with tests and focused V8 config;
toolchain trust contract; the one-line fail-closed
`BybitEuFeed` compatibility remediation `isSpot: raw.spot ?? false`; its
paired index-only `expect(m.isSpot).toBe(false)` regression assertion for a raw
market without `spot`; and CCXT documentation/evidence/ER/RE. Concurrent
logging and export hunks remain excluded.

The subset deliberately excludes
`packages/exchange/src/bybit-eu-adapter.test-support.ts`,
and `packages/exchange/src/bybitEuFeed.test.ts`, plus every other exact-10 /
`BybitEuClient` port-refactor hunk. Those are not independently reproducible
from `HEAD`. The staged test-file hunk is only the missing-`spot` regression
assertion described above, isolated in the index from the current worktree
refactor. Therefore exchange **395/395** and exact-10/spot margin **16/16**
are shared-worktree results only, not clean-tree proof for the staged subset.
`git diff --cached --check` passed at record time.

The clean staged snapshot ran `bun install --frozen-lockfile --ignore-scripts`
successfully for 486 packages. Its first exchange typecheck failed TS2375:
CCXT 4.5.75 makes `raw.spot` optional while the `HEAD`-based old
`BybitEuFeed.ts` returned it as required `boolean`. The staged single-line
fallback above normalizes an unknown spot flag to `false`, then backtest and
exchange typecheck/build passed. Before the later assertion hunk, the clean
staged-snapshot exchange suite passed **379/379** with **756 expectations**.
The new targeted clean-snapshot test passes **32/32** with **65 expectations**.
The full current clean staged snapshot command `bun run --filter
@mm-crypto-bot/exchange test` exited 0 with **379 pass, 0 fail, 757
expectations**. The whole-file legacy ESLint baseline remains **NOT PASS** at 58
pre-existing errors; the corrected line introduces no new error, and this
evidence does not claim scoped whole-file lint PASS.

Status is **PENDING STAGED TECHNICAL AND PROCESS RE-REVIEW**; no commit,
live-readiness, or full-dependency PASS is claimed. The HIGH upstream ESM
`4.5.74` self-report blocker remains open. This is an addendum only: it does
not revise the historical records above.
