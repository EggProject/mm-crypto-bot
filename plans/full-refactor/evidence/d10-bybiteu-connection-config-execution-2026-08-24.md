# D-10 Bybit EU connection-contract execution evidence

**Captured:** 2026-08-24T21:09:37+0200 (Europe/Budapest)
**Status:** `PENDING FRESH TECH AND PROCESS RE-REVIEW`
**Scope:** D-10 P4 configuration/factory/feed migration only. This is not an
implementation, live-readiness, release, global-coverage, or commit PASS.

## Approved contract

The user approved D-10 at `2026-08-24T19:29:14+0200`:

> `oke, jogos vedd ki oket viszont a beepitett emulalt kereskedesi mode maradjon meg de a bybit testnet/sandbox nem kell mert nehezen hasznalhato`

The immediately preceding instruction was:

> `ccxt websocket alapu kapcsolatot kell hasznalni ahol lehet`

The selected contract retains the built-in paper/emulated execution mode; it may
consume public Bybit EU market data but must never submit an exchange order. It
rejects Bybit testnet/sandbox and manual REST/WebSocket endpoint overrides. Live
connection construction is limited to `ccxt.pro.bybiteu` with fixed official
Bybit EU origins and is WebSocket-first where a supported capability and
fail-closed contract permit it. Current order creation remains REST through
`ccxt.createOrder()`; authoritative REST preflight and order/account
reconciliation remain permitted. A WebSocket order/action transport is a later,
separately scoped migration, not a claim made by this candidate.

## Coordination and recovery record

The coordinator classified D-10 as a high-risk, multi-package transport,
configuration, paper-mode, and public-API change. Work was decomposed before
dispatch into one-writer briefs for connection/configuration, paper/live
boundary, strict configuration, serializer coverage, exchange adapter/client
surface, network guard, E2E migration, documentation, and evidence. Briefs had
exclusive ownership and directly coupled validation; no arbitrary wall-clock
countdown was imposed. Terra owned implementation/review work triggered by live
transport, data integrity, and public APIs; process review is independent Luna
work. No Agy task was used for this candidate.

An early documentation/template operation transiently exceeded its intended
whole-file scope. It was caught and restored with `apply_patch` before this
candidate record. The transient incorrect tree was not hashed or retained, so
that recovery is not replayable from a content hash; this is an explicit
historical-evidence limitation, not a claim that it was independently reproduced.

## Initial independent-review failures and remediations

The initial independent technical review failed with four findings:

1. A live injected `feed` or custom `exchangeFeedFactory` could bypass the fixed
   production factory.
2. Root, nested, and strategy configuration accepted unknown fields through
   non-strict/passthrough validation.
3. The legacy adapter still exposed sandbox activation and a REST-client surface.
4. The latency documentation incorrectly claimed implemented WebSocket order
   submission.

The initial independent process review failed with two findings:

1. No durable D-10 execution/evidence record existed.
2. The transient scope-breach recovery was not replayable.

Remediation closed the live dependency-injection bypass before any feed opens or
factory invocation; paper injection/factories remain available. Configuration is
strict at root and every fixed nested boundary, including strategy fields; the
CLI serializer writes only schema-approved fields and has a real round-trip
test. The adapter default is `ccxt.pro.bybiteu`, with sandbox control removed.
The subsequent raw-client review also removed `BybitEuClient.setSandboxMode`,
`BybitEuFeed.raw`, and `BybitEuAdapter.ccxtExchange`; constructor-capture and
public-type proofs cover the absence of those bypasses. Documentation now states
the actual REST order path and future WS-order scope. E2E reconciliation tests
use runtime assembly/controller seams rather than a live `Bot({ feed })` path.

## Current validation evidence

| Gate                             | Result                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full bot suite                   | `814/814` passed; `2018` expectations                                                                                                                                     |
| Full exchange suite              | `408/408` passed; `840` expectations                                                                                                                                      |
| Bot and exchange typecheck/build | PASS; bot `typecheck:e2e` PASS                                                                                                                                            |
| Config isolated coverage         | `23/23`; S `113/113`, B `66/66`, F `19/19`, L `112/112`                                                                                                                   |
| Adapter isolated coverage        | `36/36`; S `21/21`, B `16/16`, F `17/17`, L `21/21`                                                                                                                       |
| Runtime network guard            | Sandbox initially blocked Node Vitest with `spawnSync bun EPERM`; escalated run `9/9`; S `61/61`, B `40/40`, F `13/13`, L `56/56`                                         |
| Integrated bot E2E               | `62/62` cases; initializer S `32/32`, B `26/26`, F `5/5`, L `29/29`; config S `113/113`, B `66/66`, F `19/19`, L `112/112`; schema S `18/18`, B `0/0`, F `2/2`, L `18/18` |
| Configuration examples           | All five D-10 TOMLs validate                                                                                                                                              |

Global coverage does **not** pass and must not be represented as passing:

| Gate                        |  Statements |    Branches | Functions |                 Lines |
| --------------------------- | ----------: | ----------: | --------: | --------------------: |
| Bot unit (`805/805` tests)  | `3208/3271` | `1752/1956` | `623/626` |           `3016/3058` |
| Bot E2E (`62/62` cases)     | `3090/3258` | `1639/1958` | `614/627` |           `2920/3045` |
| Exchange package (exit `0`) |           — |           — |         — | `2469/2711` (`91.1%`) |

`apps/bot/src/bot/bot.ts` is also not whole-file exact: unit S `132/134`, B
`47/49`, F `29/29`, L `127/129`; E2E S `131/134`, B `46/49`, F `29/29`, L
`126/129`. The exact D-10 seams listed above are covered; the global requirement
remains NON-PASS.

CCXT remains a release-integrity blocker: npm/CJS reports `4.5.75`, while the
ESM and declaration surfaces self-report `4.5.74`. This candidate does not
establish live or release permission.

## Shared-index preservation

At capture time, the shared dirty worktree had a preserved staged-path NUL hash
of `37e1c8643f28f3418782c42987dedb904d5eadffd9e6b3039edc15ff7b57289d`
and `.git/index` SHA-256 `b800e2bbe3397034f720c7fcf61842eafd4b8af45445ecd3870f0a9cce11c259`. No D-10
path was staged or committed by this work. The source hash table below is a
pre-evidence snapshot; candidate sources must not change after this capture.

## Pre-evidence candidate SHA-256 snapshot

The table is sorted by path, excludes this self-referential evidence file and
`EXECUTION-RECORD.md`, and includes the D-10 implementation, tests, config,
documentation, and decision/approval records only (43 paths).

| SHA-256                                                            | Path                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `95d4b74d11c231897247f990da7d148376f70285f838ad68e1a03f0637aaed40` | `apps/bot/src/bot/bot-exchange-initializer.ts`                           |
| `67bff54e7b88cd766956a34ce80bdf31c4571dc79aac979a4d8b8c3ae7643caf` | `apps/bot/src/bot/bot-public-boundaries.live-equity-persistence.test.ts` |
| `5618e3972a69cd5d53c4db7adf804c8f136cc087dce5cd6e12f77b7b2f66726e` | `apps/bot/src/bot/bot-public-boundaries.test-support.ts`                 |
| `47b78ea5330f6b944c5681aa4c714ec2861d1bf13a1e75a6d517c0a50904ad3a` | `apps/bot/src/bot/bot-public-boundaries.test.ts`                         |
| `be46ed6c04121ab75fe7c70b28fc0715e888389773796bb8c66d5e5b36c68e59` | `apps/bot/src/bot/bot.lifecycle.test.ts`                                 |
| `5bb4b1fd471cce8259d8b82cb2bc149b50097961f324bf41be4efac0214c3c52` | `apps/bot/src/bot/bot.ts`                                                |
| `5777a5a96d46ebe04073d1d36138b2f488938e2b294432b665d80aee6ae8ba14` | `apps/bot/src/cli/cli-e2e.test.ts`                                       |
| `2722818403ef926c3071643c16d8901e2f3af81946bb1fdb4435d24d4e1dd7a6` | `apps/bot/src/cli/commands/config.test.ts`                               |
| `e8ad93e75ca5b563a764cfbf6b5c89c85bc66444c1d4d5f834939ce5108c2d3c` | `apps/bot/src/cli/commands/config.ts`                                    |
| `ea1e48e4fac7d401197eaaedfdcb70781ba2f7bb79991406479545aed5ee3440` | `apps/bot/src/config/config-exchange-boundary.test.ts`                   |
| `e21c325107ab852634551f12ac983b8e6834c84742a24365401b2b6139fc3b9d` | `apps/bot/src/config/config.test.ts`                                     |
| `c7aaaa9a51a534a9e131ccba63431a3f37ba759113e1f41a040448f7c63f5788` | `apps/bot/src/config/schema.ts`                                          |
| `e9a6f0f0ac6977b60a6bff4de295d568aa0277e30d0ab88c05598eec47905127` | `apps/bot/src/config/store-live-confirm.test.ts`                         |
| `0d69dda716aeafee4fbb24dc0b6ce84da2b79e142de6074c91d912af98a0b8b2` | `apps/bot/test/e2e/runtime-driver/bot-cleanup-and-order-risk.ts`         |
| `83bfa4d5fdbb5a2e78689b5b8486fdc1ab8b64bdb3c6ad4d7f207459215cd217` | `apps/bot/test/e2e/runtime-driver/bot-lifecycle-factory.ts`              |
| `3c7564206242ede7886dc3ee505c4845cfc21bea279258fe0e97e55bba04325e` | `apps/bot/test/e2e/runtime-driver/bot-state-and-telemetry.ts`            |
| `c83bd67899e5ed6e6368628f923befed720651035bccc673b4f6ef1fe0bf5148` | `apps/bot/vitest.config-command.config.mjs`                              |
| `0e5d1570b5367bf87b3465fbd8d81f36ffba968afe9d4603d854f031427c419d` | `docs/production-strategies/latency-budget.md`                           |
| `11b74a2cbb6a43e7d80f45fa52e03718949523d8ad1ddbd9bece7b7c4ca9e406` | `docs/production-strategies/pre-launch-checklist.md`                     |
| `f30ed900f84b94c893d7361af9fe387c1fcf43fa3ee22d94e4aa3d34aac56820` | `packages/exchange/src/bybit-eu-adapter.test-support.ts`                 |
| `efee5dc5f9110604c3ccef284a6ff8664cd10a1ba82db13c5e0e1ee6a0645fa4` | `packages/exchange/src/bybit-eu-adapter.test.ts`                         |
| `3e539021bf237fdd4e29c27a915cac1733856d57d1d75d171f9cdbe602b8748a` | `packages/exchange/src/bybit-eu-adapter.ts`                              |
| `3e36100be5c811efa1ce6c1f210199780c8529c5df82b1014022bb1c8c8265c7` | `packages/exchange/src/bybit-eu-client.ts`                               |
| `cfd3d0e0383395e15d94301f18fa5a37721ee2b9fca0ed2fc28f423f0de71246` | `packages/exchange/src/bybit-eu-feed.lifecycle.test.ts`                  |
| `e4e1744c9fe9a36e8d3b23ac0c1242de38782957ae122679edfb788d603e867e` | `packages/exchange/src/bybit-eu-feed.test-support.ts`                    |
| `151e884c73a61931a92ccc671ed51cbd3fcdedaea742551b99a21c14a42ca47a` | `packages/exchange/src/bybit-eu-feed.test.ts`                            |
| `3acb8a80a1bdcb6d8c0874c1a7cc99333cdbd02452ba19ffffd300a13fab1838` | `packages/exchange/src/bybit-eu-feed.ts`                                 |
| `e19d391e3e529b232b5ccb77369b5a793ea99381777f4fc2232004f7a66d3b57` | `packages/exchange/src/bybit-eu-spot-margin-order.test.ts`               |
| `5d26e0cc88c66e83427532637b587f16f258a77ec317e5ab78deef41d42a3c81` | `packages/exchange/src/factory.test.ts`                                  |
| `c2be41a9594b4382d7809a181bb5cc5e99aa4d43fec28a9a34fb76d735678371` | `packages/exchange/src/index.ts`                                         |
| `0f97fa7e578e05c26bfc1f754f970546c146e4dea7f8eb45b92cff80dedf70d3` | `packages/exchange/tests/bybit-eu-feed-normalizers.test.ts`              |
| `c11c997dc41f05584148380b26707df442477cf4a085a6a5b48c74d11c7f7844` | `packages/exchange/tests/bybit-eu-feed-watch.test-support.ts`            |
| `af065345d39e784d585f9d15fca25f4cbfade3518016cbc08349a79aaedc71fa` | `packages/exchange/vitest.bybit-eu-adapter.config.mjs`                   |
| `4efdd99e39ae8adbdb4799ea93113865e970590e07fe891131cb526288a6f326` | `plans/full-refactor/APPROVALS.md`                                       |
| `7ecc40caa82bae59722aa946a23da1a200079ea00f3b0e77e8ae2000feb1efa5` | `plans/full-refactor/DECISIONS.md`                                       |
| `51447321d4b97db0408beb55e761b493550e629618ca4ee045688bdd28075c35` | `run-bot/config/default.toml`                                            |
| `ed71bb63e36fedf1cb356210da3e164dc5acb64efa875dfb9cb10ac6c7facee9` | `run-bot/config/live-eu.example.toml`                                    |
| `8a42fa7a1326568893d725c1e45a0c94670775ae30f6fa8ae6a32f18d98b8feb` | `run-bot/config/live-eu.toml`                                            |
| `915e9bf09bdde54937b1cd14435bb1b136c79f5c31d8a87080a47ea3ae24a497` | `run-bot/config/paper-backtest-optimized.toml`                           |
| `683508ea60dcfac3c54358089cbdbcf8daa5969228e71ebc2eed7786cf059e07` | `run-bot/config/paper-backtest-verified.toml`                            |
| `b435a995eb6d1a611145bbf2f1c57e373ce90cfbfabaf14bacb1a2d6b55e76cb` | `scripts/coverage-tools/bot-runtime-network-guard.test.ts`               |
| `f2b5c8677bce24c5a6d55594a8e011b49193800d7ed41e02751d3568e6371b5b` | `scripts/coverage-tools/bot-runtime-network-guard.ts`                    |
| `4b2122cd2ba936b21fbb7817bb9d023fc4eecba2ea6892ec92a76130434baf05` | `scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs`     |

Fresh independent technical and process re-reviews must verify this snapshot,
the stated recovery limitation, the remediation scope, and the unresolved global
and CCXT blockers before any completion or commit decision.

## Current candidate superseding record

**Captured:** 2026-08-24T21:44:13+0200 (Europe/Budapest)
**Status:** `PENDING FRESH TECH AND PROCESS RE-REVIEW`

This section supersedes the earlier 43-path snapshot, historical focused-suite
counts, and raw-index observation. Those records remain historical; this is the
current final-review baseline. It is not implementation, live, release,
global-coverage, or commit PASS.

### Closure and transport facts

`BybitEuClient` and `BybitEuFeed` hold native CCXT in private fields. Internal
and injected clients have exact-origin admission before all I/O. Reflection from
the public graph cannot reach native client or sandbox control; captured native
`setSandboxMode` drift rejects before `loadMarkets`. Earlier same-owner work
removed `BybitEuClient.setSandboxMode`, `BybitEuFeed.raw`, and
`BybitEuAdapter.ccxtExchange`; lifecycle/constructor-capture tests prove the
public absence. Focused origin suite: `9/9`; full exchange: `410/410`, `852`
expectations; exchange typecheck/build PASS.

The complete `BotConfig` serializer is explicit and has
`config-roundtrip.test.ts`. Bun `1.3.14` reverses short TOML `\\t` and `\\f`, so
the serializer emits canonical Unicode control escapes. U+0000, U+0001, and
U+001F fail closed. Round-trip: `2/2`; isolated serializer: `25/25`, exact S
`129/129`, B `64/64`, F `21/21`, L `128/128`; full bot: `816/816`, `2026`
expectations; bot typecheck, `typecheck:e2e`, build PASS.

The pre-launch checklist blocks live/release activation and every non-exact-10x
live value. Paper/emulated trading remains. Public market data is WebSocket-first
where supported; current order submission is REST `createOrder()` and
authoritative REST reconciliation; WS order/action transport is future work.
Adapter isolated gate: `36/36`, exact S `21/21`, B `16/16`, F `17/17`, L
`21/21`.

### Coordinator replay evidence

All results below are coordinator-recorded runs in
`/home/eggp/projects/mm-crypto-bot` on 2026-08-24, Europe/Budapest. They do not
claim global PASS.

| Command / gate                                                | Result                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `bun test apps/bot/src/cli/commands/config-roundtrip.test.ts` | `2/2` PASS                                                                                                                     |
| `bun run --filter @mm-crypto-bot/bot test`                    | `816/816`; `2026` expectations PASS                                                                                            |
| Bot typecheck, `typecheck:e2e`, build                         | PASS                                                                                                                           |
| Isolated config Vitest                                        | `25/25`; S `129/129`, B `64/64`, F `21/21`, L `128/128`                                                                        |
| Bot E2E coverage                                              | Functional `62/62`; exit `1` global S `3101/3274`, B `1632/1956`, F `616/629`, L `2931/3061`                                   |
| Bot unit coverage                                             | Tests `805/805`; exit `1` global S `3219/3287`, B `1745/1954`, F `625/628`, L `3027/3074`                                      |
| Exchange typecheck/build/test                                 | PASS; `410/410`; `852` expectations                                                                                            |
| Exchange coverage                                             | Exit `0`; `410/410`; lcov lines `2472/2714` (`91.1%`)                                                                          |
| Network guard                                                 | Sandbox FAIL `spawnSync bun EPERM`; escalated rerun `9/9`, exact S `61/61`, B `40/40`, F `13/13`, L `56/56`                    |
| TOML validation                                               | `default` paper/10, `live-eu` paper/10, example paper/10, optimized paper/1, verified paper/10; all validate                   |
| Lint                                                          | Bot package FAIL (existing broad 281-line output); exchange FAIL (`257`: `254` errors, `3` warnings); scoped owned lint passed |
| Diff checks                                                   | Cached and working `git diff --check` PASS                                                                                     |

The exact coverage invocations were
`bunx vitest run --config apps/bot/vitest.config-command.config.mjs --coverage`,
`bun run --filter @mm-crypto-bot/bot coverage:e2e`, and
`bun run --filter @mm-crypto-bot/bot coverage:unit`, respectively.

Bot unit/E2E global gates and exchange line coverage are **NON-PASS**. CCXT is
still a release blocker: npm/CJS is `4.5.75`; ESM and `.d.ts` self-report
`4.5.74`. No live/release permission follows.

### Final-review finding and interruption trail

The final-review cycle's initial TECH FAIL had three findings: public/native
client graph allowed origin/sandbox drift; serializer was not a complete,
reversible TOML boundary; and activation documentation did not precisely state
the operating boundary. They map respectively to the private-origin/captured-
drift closure, explicit control-safe serializer/round-trip tests, and checklist
rewrite above. The initial PROCESS FAIL had three findings: missing current
evidence after interrupted writer; stale or overclaimed hash/index facts; and
incomplete dispatch provenance. They map to evidence recovery, the preservation
baseline below, and the complete matrix below. All are remediated in the
candidate but await independent fresh re-review.

The raw-client implementation was not interrupted: it removed sandbox control,
then same-owner scope removed `feed.raw` and `adapter.ccxtExchange`. A separate
private-origin remediation closed reflectability/origin drift.
`/root/d10_process_evidence_record` was interrupted, has zero closure credit,
waited for raw-client completion, and did not land a final record.
`/root/d10_evidence_recovery` restored this file and ER append. An experimental
exchange exact-Vitest run failed due Bun-only `spyOn` incompatibility; its temp
config was deleted and it made no final artifact. Bun suites/package coverage
are the final exchange evidence.

### Dispatch provenance matrix

All dispatches: external/mutable resource `none`; no arbitrary countdown;
effective model/effort `not observable`. `EW` is exclusive workspace-write;
`RO` is read-only. Terra requests were `gpt-5.6-terra/high`; Luna's request was
the pinned `luna_process_reviewer` profile. Each ownership cell is the exact
exclusive path group in the 44-path inventory below, except evidence rows,
which own only the named plans files. No unlisted fallback occurred.

| Dispatch                    | Class / R/W / ownership (packages)                      | Predicate, review, route / result                                                          |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Initial config schema       | implementation / EW / schema + tests (1)                | config/origin integrity; non-review; `terra_worker`; completed                             |
| Config surfaces             | implementation / EW / TOMLs + boundary tests (1)        | live config semantics; non-review; `terra_worker`; completed                               |
| Initializer                 | implementation / EW / initializer + boundary tests (1)  | live factory safety; non-review; `terra_worker`; completed                                 |
| Decision record             | evidence / EW / decision + approval (plans)             | governing semantics; non-review; `terra_worker`; completed                                 |
| Network guard               | tooling/tests / EW / guard (scripts)                    | network safety; non-review; `terra_worker`; test escalation after sandbox EPERM; completed |
| Strict config               | implementation / EW / schema/config tests (1)           | config integrity; non-review; `terra_worker`; completed                                    |
| Live factory boundary       | implementation / EW / bot source/tests (1)              | live path safety; non-review; `terra_worker`; completed                                    |
| Live test migrations        | tests / EW / lifecycle/public tests (1)                 | live seam; non-review; `terra_worker`; completed                                           |
| Serializer + TOML follow-up | implementation/tests / EW / serializer + round-trip (1) | serialization integrity; non-review; `terra_worker`; completed                             |
| E2E migrations              | tests / EW / three runtime drivers (1)                  | live boundary coverage; non-review; `terra_worker`; completed                              |
| Client/raw removal          | implementation/tests / EW / client/feed/adapter (1)     | public API safety; non-review; `terra_worker`; same-owner extension; completed             |
| Private-origin fix          | implementation/tests / EW / client/feed/lifecycle (1)   | origin integrity; non-review; `terra_worker`; completed                                    |
| Pre-launch doc fix          | docs / EW / checklist + latency docs (2)                | activation semantics; non-review; `terra_worker`; completed                                |
| Initial evidence task       | evidence / EW / D-10 evidence + ER (plans)              | process integrity; non-review; `terra_worker`; interrupted, zero credit                    |
| Evidence recovery           | evidence / EW / D-10 evidence then ER (plans)           | process integrity; non-review; `terra_worker`; completed                                   |
| Initial TECH review         | final technical review / RO / candidate (2)             | mandatory review; `terra_reviewer`; TECH FAIL, mapped above                                |
| Initial PROCESS review      | final process review / RO / candidate (2)               | mandatory review; `luna_process_reviewer`; PROCESS FAIL, mapped above                      |
| Final evidence update       | evidence / EW / this evidence + ER append (plans)       | governing/process integrity; non-review; `terra_worker`; pending fresh reviews             |

### Preservation baseline

No `git add`, staging, commit, or index mutation occurred in this continuation.
Old raw `.git/index` SHA-256
`b800e2bbe3397034f720c7fcf61842eafd4b8af45445ecd3870f0a9cce11c259` is
superseded as a raw-byte observation. Current raw SHA-256 is
`b36154912dc3f251160b061f623ba327cab6936ee95282e66ba065f2cd3d89ff`.
Its mtime/ctime was `2026-08-24 21:36:17.881202302 +0200`, matching a read-only
`git status --short` inventory. Raw index bytes include mutable stat/cache
metadata, so this timing supports but does not prove metadata refresh rather
than staged-content change. No prior staged-entry/binary-patch hash exists, so
byte-exact staged equality to the old raw snapshot is not reconstructable.

The new preservation baseline is 24 cached paths; cached name-only NUL SHA-256
`37e1c8643f28f3418782c42987dedb904d5eadffd9e6b3039edc15ff7b57289d`;
name-status NUL SHA-256
`111e68ee18decc0e09c65d34f0f49050184d948d847a18945ac617c2dd648a48`;
`git ls-files --stage -z` SHA-256
`ab25fdf3119f3c100bfc7d617bafac1d03585e6be6060ec5131057aa0e120353`;
and cached binary/full-index SHA-256
`625916c3f042505c769297fd7065ee725dd103ba4013bfaffd1843e335871380`.

The following 44 D-10 paths are the current pre-evidence source snapshot. It
excludes this evidence file and `EXECUTION-RECORD.md`.

| SHA-256                                                            | Path                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `95d4b74d11c231897247f990da7d148376f70285f838ad68e1a03f0637aaed40` | `apps/bot/src/bot/bot-exchange-initializer.ts`                           |
| `67bff54e7b88cd766956a34ce80bdf31c4571dc79aac979a4d8b8c3ae7643caf` | `apps/bot/src/bot/bot-public-boundaries.live-equity-persistence.test.ts` |
| `5618e3972a69cd5d53c4db7adf804c8f136cc087dce5cd6e12f77b7b2f66726e` | `apps/bot/src/bot/bot-public-boundaries.test-support.ts`                 |
| `47b78ea5330f6b944c5681aa4c714ec2861d1bf13a1e75a6d517c0a50904ad3a` | `apps/bot/src/bot/bot-public-boundaries.test.ts`                         |
| `be46ed6c04121ab75fe7c70b28fc0715e888389773796bb8c66d5e5b36c68e59` | `apps/bot/src/bot/bot.lifecycle.test.ts`                                 |
| `5bb4b1fd471cce8259d8b82cb2bc149b50097961f324bf41be4efac0214c3c52` | `apps/bot/src/bot/bot.ts`                                                |
| `5777a5a96d46ebe04073d1d36138b2f488938e2b294432b665d80aee6ae8ba14` | `apps/bot/src/cli/cli-e2e.test.ts`                                       |
| `59f7b846f8e139bbb7e96f2823a83df21f2a3ba6570e1b1ea8fbc45bdb8f7ac5` | `apps/bot/src/cli/commands/config-roundtrip.test.ts`                     |
| `2722818403ef926c3071643c16d8901e2f3af81946bb1fdb4435d24d4e1dd7a6` | `apps/bot/src/cli/commands/config.test.ts`                               |
| `5eabc77574c12a5bb8f102fd8011005ba35549087f91adda8e4e9e1b06973dd8` | `apps/bot/src/cli/commands/config.ts`                                    |
| `ea1e48e4fac7d401197eaaedfdcb70781ba2f7bb79991406479545aed5ee3440` | `apps/bot/src/config/config-exchange-boundary.test.ts`                   |
| `e21c325107ab852634551f12ac983b8e6834c84742a24365401b2b6139fc3b9d` | `apps/bot/src/config/config.test.ts`                                     |
| `c7aaaa9a51a534a9e131ccba63431a3f37ba759113e1f41a040448f7c63f5788` | `apps/bot/src/config/schema.ts`                                          |
| `e9a6f0f0ac6977b60a6bff4de295d568aa0277e30d0ab88c05598eec47905127` | `apps/bot/src/config/store-live-confirm.test.ts`                         |
| `0d69dda716aeafee4fbb24dc0b6ce84da2b79e142de6074c91d912af98a0b8b2` | `apps/bot/test/e2e/runtime-driver/bot-cleanup-and-order-risk.ts`         |
| `83bfa4d5fdbb5a2e78689b5b8486fdc1ab8b64bdb3c6ad4d7f207459215cd217` | `apps/bot/test/e2e/runtime-driver/bot-lifecycle-factory.ts`              |
| `3c7564206242ede7886dc3ee505c4845cfc21bea279258fe0e97e55bba04325e` | `apps/bot/test/e2e/runtime-driver/bot-state-and-telemetry.ts`            |
| `294cce3516e24b8d528afa936f9f82f898519ffad6fab1f6b736042729ef0ae1` | `apps/bot/vitest.config-command.config.mjs`                              |
| `0e5d1570b5367bf87b3465fbd8d81f36ffba968afe9d4603d854f031427c419d` | `docs/production-strategies/latency-budget.md`                           |
| `9e078d77a23b132b883f70b3e98531f1b0896b07c18e7bad9fab57d7441d80f9` | `docs/production-strategies/pre-launch-checklist.md`                     |
| `f30ed900f84b94c893d7361af9fe387c1fcf43fa3ee22d94e4aa3d34aac56820` | `packages/exchange/src/bybit-eu-adapter.test-support.ts`                 |
| `efee5dc5f9110604c3ccef284a6ff8664cd10a1ba82db13c5e0e1ee6a0645fa4` | `packages/exchange/src/bybit-eu-adapter.test.ts`                         |
| `3e539021bf237fdd4e29c27a915cac1733856d57d1d75d171f9cdbe602b8748a` | `packages/exchange/src/bybit-eu-adapter.ts`                              |
| `59fbca91197699e611651df2587fc9dd8ca0d456dd98f09eeb8dd5b0895273c2` | `packages/exchange/src/bybit-eu-client.ts`                               |
| `3450483c8ac237ce3e3cc2afbdc05fc0e3b3f8679ab022da1b5672f9a5634099` | `packages/exchange/src/bybit-eu-feed.lifecycle.test.ts`                  |
| `e4e1744c9fe9a36e8d3b23ac0c1242de38782957ae122679edfb788d603e867e` | `packages/exchange/src/bybit-eu-feed.test-support.ts`                    |
| `151e884c73a61931a92ccc671ed51cbd3fcdedaea742551b99a21c14a42ca47a` | `packages/exchange/src/bybit-eu-feed.test.ts`                            |
| `809c7e2e2b4009c5cd36bdc2cd29e5fd49c21a53a14be963143b9f0aa10bb7d8` | `packages/exchange/src/bybit-eu-feed.ts`                                 |
| `e19d391e3e529b232b5ccb77369b5a793ea99381777f4fc2232004f7a66d3b57` | `packages/exchange/src/bybit-eu-spot-margin-order.test.ts`               |
| `5d26e0cc88c66e83427532637b587f16f258a77ec317e5ab78deef41d42a3c81` | `packages/exchange/src/factory.test.ts`                                  |
| `c2be41a9594b4382d7809a181bb5cc5e99aa4d43fec28a9a34fb76d735678371` | `packages/exchange/src/index.ts`                                         |
| `0f97fa7e578e05c26bfc1f754f970546c146e4dea7f8eb45b92cff80dedf70d3` | `packages/exchange/tests/bybit-eu-feed-normalizers.test.ts`              |
| `c11c997dc41f05584148380b26707df442477cf4a085a6a5b48c74d11c7f7844` | `packages/exchange/tests/bybit-eu-feed-watch.test-support.ts`            |
| `af065345d39e784d585f9d15fca25f4cbfade3518016cbc08349a79aaedc71fa` | `packages/exchange/vitest.bybit-eu-adapter.config.mjs`                   |
| `4efdd99e39ae8adbdb4799ea93113865e970590e07fe891131cb526288a6f326` | `plans/full-refactor/APPROVALS.md`                                       |
| `7ecc40caa82bae59722aa946a23da1a200079ea00f3b0e77e8ae2000feb1efa5` | `plans/full-refactor/DECISIONS.md`                                       |
| `51447321d4b97db0408beb55e761b493550e629618ca4ee045688bdd28075c35` | `run-bot/config/default.toml`                                            |
| `ed71bb63e36fedf1cb356210da3e164dc5acb64efa875dfb9cb10ac6c7facee9` | `run-bot/config/live-eu.example.toml`                                    |
| `8a42fa7a1326568893d725c1e45a0c94670775ae30f6fa8ae6a32f18d98b8feb` | `run-bot/config/live-eu.toml`                                            |
| `915e9bf09bdde54937b1cd14435bb1b136c79f5c31d8a87080a47ea3ae24a497` | `run-bot/config/paper-backtest-optimized.toml`                           |
| `683508ea60dcfac3c54358089cbdbcf8daa5969228e71ebc2eed7786cf059e07` | `run-bot/config/paper-backtest-verified.toml`                            |
| `b435a995eb6d1a611145bbf2f1c57e373ce90cfbfabaf14bacb1a2d6b55e76cb` | `scripts/coverage-tools/bot-runtime-network-guard.test.ts`               |
| `f2b5c8677bce24c5a6d55594a8e011b49193800d7ed41e02751d3568e6371b5b` | `scripts/coverage-tools/bot-runtime-network-guard.ts`                    |
| `4b2122cd2ba936b21fbb7817bb9d023fc4eecba2ea6892ec92a76130434baf05` | `scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs`     |

Fresh independent technical and process re-reviews must inspect this baseline.
No self-review, staging, or commit occurred in this workstream.

## Current source candidate and replay ledger

**Captured:** 2026-08-24T22:40:43+0200 (Europe/Budapest)
**Status:** `PENDING FRESH TECH AND PROCESS RE-REVIEW`

This section supersedes the preceding 44-path snapshot and its current-gate
implications. User-approved semantics block every live start: `BUN_ENV=live` is
a typed `ConfigError`, and explicit `mode = "live"` returns
`START_LIVE_ACTIVATION_UNAVAILABLE` / exit 3 before credentials, logger, Bot,
runtime, factory, or network. Paper remains operable. Templates, `default`,
latency documentation, and `LIVE-TRADING.md` are paper-only and nonauthorizing.
The origin guard runs before every native call; unwatch rethrows admission error.
Current suites: bot `817/817`, `2033` expects; exchange `415/415`, `867` expects.
Package-wide lint, global coverage, and CCXT npm/CJS `4.5.75` versus
ESM/declarations `4.5.74` remain **NON-PASS**.

### Exact command ledger

| ID   | Command, CWD, executor                                                                                   | Observed time / exit / durable artifact                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | `bun run --filter @mm-crypto-bot/bot test`; root; `/root/d10_evidence_recovery`                          | start `2026-08-24T22:40:01.579922233+0200`, end `2026-08-24T22:40:22.616238302+0200`, exit 0; `/tmp/mm-d10-replay.2uVP18/bot-test-20260824T.log` SHA-256 `26068760fc75c937d7a0f6758c70a2d07ad1068ac26d76ae2273a7b3a1504d4f`      |
| R-02 | `bun run --filter @mm-crypto-bot/exchange test`; root; `/root/d10_evidence_recovery`                     | start `2026-08-24T22:40:27.954080673+0200`, end `2026-08-24T22:40:43.881457889+0200`, exit 0; `/tmp/mm-d10-replay.2uVP18/exchange-test-20260824T.log` SHA-256 `c1ab2114088704230b9654b2675e13268b6ac0eacd0bdccaf214663f7648adc0` |
| R-03 | `bunx vitest run --config apps/bot/vitest.config-command.config.mjs --coverage`; root; historical worker | completion `2026-08-24T21:36:54.515649228+0200`, exit 0, `apps/bot/coverage/config-command/coverage-summary.json` SHA-256 `eb012293e2ff587014d75471fc005a0fa39199ece65ad08b489439b6a8e3d52a`; stale after later runtime changes  |
| R-04 | bot E2E/unit and exchange package coverage; root; historical workers                                     | artifacts are stale after runtime changes; no current global PASS and no long rerun                                                                                                                                              |
| R-05 | start.ts/loader.ts exact coverage; worker                                                                | reported 39 tests, S/B/F/L 100%; command, time, config, artifact, hash not observable; not replayable proof                                                                                                                      |
| R-06 | typecheck/build, five-TOML validation, scoped lint, format/diff scans                                    | exact transcript/timestamp/artifact unavailable; reported results are historical only                                                                                                                                            |

### Failed/rework ledger

- Sandbox guard: `2026-08-24T21:39:26+0200`, exit 1, line 125 `Error: spawnSync bun EPERM`, 8 pass/1 fail; escalated guard rerun at `21:39:38.639/642` passed 9/9 with prior summary/lcov hashes.
- Initial TOML tab/formfeed focused failure was fixed by canonical Unicode escapes.
- Private-origin command `bunx vitest run --config packages/exchange/vitest.bybit-eu-feed-origin.config.mjs` (root, time unavailable) exited 1: three `spyOn is not a function` failures at `subscription-resilience.test.ts:150:22,237:30,365:30`; 106 pass, 3 fail. Reproduction `2026-08-24T21:53:57+02:00` exited 1; config SHA-256 `848981c0270382ceda469323ddc8b3ee5990f1a798ad56e3b52b99d7cc6c12c8`; `/tmp/d10-vitest-bybit-eu-feed-origin-reproduction-v2.log` (55 lines) SHA-256 `ce54b984914ed63401a890dc7ae049bc1edc89fb5823fd77ac042e6c788c336f`. The `21:53:43` `/tmp` attempt failed module resolution; neither proves compatibility.
- Intermediate origin Proxy-brand failure caused three normalizer failures, then target-receiver correction and full pass. Unwatch swallowed admission failure; it now rethrows and is tested. `/root/d10_process_evidence_record` was interrupted with zero credit; evidence recovery was separate. The earlier docs scope breach has no command/timestamp/artifact/hash and is unrecoverable.

### Unique dispatch ownership

All non-review writes used requested `terra_worker` / `gpt-5.6-terra` / high and
workspace-write; effective model/effort is not observable. Reviews were
read-only (`terra_reviewer` TECH, `luna_process_reviewer` PROCESS). External/
mutable resources were none; no countdown. Historical writer identity is
unavailable unless named; exact final path ownership follows.

- `D10-D01` strict config: `apps/bot/src/config/schema.ts`, `config.test.ts`, `config-exchange-boundary.test.ts`, `config-test-fixtures.test-support.ts`, `store-live-confirm.test.ts` (1 package).
- `D10-D02` serializer: `apps/bot/src/cli/commands/config.ts`, `config.test.ts`, `config-roundtrip.test.ts`, `apps/bot/vitest.config-command.config.mjs` (1 package).
- `D10-D03` live factory: `apps/bot/src/bot/bot.ts`, `bot-exchange-initializer.ts`, `bot-public-boundaries.test.ts`, `bot-public-boundaries.test-support.ts`, `bot-public-boundaries.live-equity-persistence.test.ts`, `bot.lifecycle.test.ts` (1 package).
- `D10-D04` E2E reconciliation: `apps/bot/test/e2e/runtime-driver/bot-state-and-telemetry.ts` (1 package).
- `D10-D05` E2E cleanup/risk: `apps/bot/test/e2e/runtime-driver/bot-cleanup-and-order-risk.ts` (1 package).
- `D10-D06` initializer/CLI E2E: `apps/bot/test/e2e/runtime-driver/bot-lifecycle-factory.ts`, `apps/bot/src/cli/cli-e2e.test.ts` (1 package).
- `D10-D07` guard implementation: `scripts/coverage-tools/bot-runtime-network-guard.ts` (1 tooling area).
- `D10-D08` guard coverage: `scripts/coverage-tools/bot-runtime-network-guard.test.ts`, `vitest.bot-runtime-network-guard.config.mjs` (1 tooling area).
- `D10-D09` adapter: `packages/exchange/src/bybit-eu-adapter.ts`, `bybit-eu-adapter.test.ts`, `bybit-eu-adapter.test-support.ts`, `packages/exchange/vitest.bybit-eu-adapter.config.mjs` (1 package).
- `D10-D10` raw API: `packages/exchange/src/bybit-eu-client.ts`, `bybit-eu-feed.ts`, `index.ts`, `factory.ts`, `factory.test.ts` (1 package).
- `D10-D11` origin/TOCTOU/unwatch: `packages/exchange/src/bybit-eu-feed.fetch.test.ts`, `bybit-eu-feed.lifecycle.test.ts`, `bybit-eu-feed.orders.test.ts`, `bybit-eu-feed.subscription-base.test.ts`, `bybit-eu-feed.subscription-resilience.test.ts`, `bybit-eu-feed.test.ts`, `bybit-eu-feed.test-support.ts`, `bybit-eu-normalizers.ts`, `bybit-eu-order-service.ts`, `bybit-eu-raw-payloads.ts`, `bybit-eu-spot-margin-client.ts`, `bybit-eu-spot-margin-order.test.ts`, `bybit-eu-subscription-manager.ts`, `packages/exchange/tests/bybit-eu-feed-normalizers.test.ts`, `bybit-eu-feed-watch-lifecycle.test.ts`, `bybit-eu-feed-watch-operations.test.ts`, `bybit-eu-feed-watch.test-support.ts` (1 package); sequential overlap with D10-D10.
- `D10-D12` docs: `docs/LIVE-TRADING.md`, `docs/production-strategies/latency-budget.md`, `pre-launch-checklist.md` (1 docs area).
- `D10-D13` live activation: `apps/bot/src/config/loader.ts`, `apps/bot/src/cli/commands/start.ts`, `start-command.test-support.ts`, `start-live-activation.test.ts`, `start-log-routing.test.ts` (1 package); sequential overlap D10-D01/D10-D03.
- `D10-D14` templates: `run-bot/config/default.toml`, `live-eu.toml`, `live-eu.example.toml`, `paper-backtest-optimized.toml`, `paper-backtest-verified.toml` (1 config area).
- `D10-D15` decision: `plans/full-refactor/DECISIONS.md`, `APPROVALS.md` (1 plans area).
- `D10-D16` initial TECH review: all D-10 paths; `terra_reviewer`; remediated, fresh review pending.
- `D10-D17` initial PROCESS review: dispatch/evidence; `luna_process_reviewer`; remediated, fresh review pending.
- `D10-D18` initial evidence writer: evidence + ER only; `/root/d10_process_evidence_record`; interrupted, zero credit.
- `D10-D19` recovery: evidence + append-only ER only; `/root/d10_evidence_recovery`; completed.
- `D10-D20` final evidence: evidence + append-only ER only; `/root/d10_evidence_recovery`; no stage/commit.

### Current exact source inventory

Sorted SHA-256 snapshot of 63 current D-10 paths; prior 44-path data is stale.
No D-10 path is staged. Excludes this evidence and `EXECUTION-RECORD.md`.

| SHA-256                                                            | Path                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `95d4b74d11c231897247f990da7d148376f70285f838ad68e1a03f0637aaed40` | `apps/bot/src/bot/bot-exchange-initializer.ts`                           |
| `67bff54e7b88cd766956a34ce80bdf31c4571dc79aac979a4d8b8c3ae7643caf` | `apps/bot/src/bot/bot-public-boundaries.live-equity-persistence.test.ts` |
| `5618e3972a69cd5d53c4db7adf804c8f136cc087dce5cd6e12f77b7b2f66726e` | `apps/bot/src/bot/bot-public-boundaries.test-support.ts`                 |
| `47b78ea5330f6b944c5681aa4c714ec2861d1bf13a1e75a6d517c0a50904ad3a` | `apps/bot/src/bot/bot-public-boundaries.test.ts`                         |
| `be46ed6c04121ab75fe7c70b28fc0715e888389773796bb8c66d5e5b36c68e59` | `apps/bot/src/bot/bot.lifecycle.test.ts`                                 |
| `5bb4b1fd471cce8259d8b82cb2bc149b50097961f324bf41be4efac0214c3c52` | `apps/bot/src/bot/bot.ts`                                                |
| `5777a5a96d46ebe04073d1d36138b2f488938e2b294432b665d80aee6ae8ba14` | `apps/bot/src/cli/cli-e2e.test.ts`                                       |
| `59f7b846f8e139bbb7e96f2823a83df21f2a3ba6570e1b1ea8fbc45bdb8f7ac5` | `apps/bot/src/cli/commands/config-roundtrip.test.ts`                     |
| `2722818403ef926c3071643c16d8901e2f3af81946bb1fdb4435d24d4e1dd7a6` | `apps/bot/src/cli/commands/config.test.ts`                               |
| `5eabc77574c12a5bb8f102fd8011005ba35549087f91adda8e4e9e1b06973dd8` | `apps/bot/src/cli/commands/config.ts`                                    |
| `f7ceb95bc63c037e3f869168113b57cefcc5aeacb813609fca54439c24526040` | `apps/bot/src/cli/commands/start-command.test-support.ts`                |
| `06beb62a39786c84eb672a3733bef32ad1198ff606cb9bc322aa43f1e7f4f4d4` | `apps/bot/src/cli/commands/start-live-activation.test.ts`                |
| `0a67d93bc12cc756597b7b92616c3aaea342b2f93a9689c6362cffc647894826` | `apps/bot/src/cli/commands/start-log-routing.test.ts`                    |
| `9c2a91623d0e4f5f120c2af55f14a44a3e9ff4cc46e630b9c6a2dee716da4c6e` | `apps/bot/src/cli/commands/start.ts`                                     |
| `ea1e48e4fac7d401197eaaedfdcb70781ba2f7bb79991406479545aed5ee3440` | `apps/bot/src/config/config-exchange-boundary.test.ts`                   |
| `b7ce4026f81fafbf0c626e6c6648de6a4014a0792e93894e4f7dfef3d0cc18c8` | `apps/bot/src/config/config-test-fixtures.test-support.ts`               |
| `ee7090895b8a82b80366689432668349eb66b7f9f95227c3c3bd7279a95008df` | `apps/bot/src/config/config.test.ts`                                     |
| `fbf4be7c3d6fc39e13dceae26b71441cd80e158a1c4bca306c8cb84c460ea046` | `apps/bot/src/config/loader.ts`                                          |
| `c7aaaa9a51a534a9e131ccba63431a3f37ba759113e1f41a040448f7c63f5788` | `apps/bot/src/config/schema.ts`                                          |
| `e9a6f0f0ac6977b60a6bff4de295d568aa0277e30d0ab88c05598eec47905127` | `apps/bot/src/config/store-live-confirm.test.ts`                         |
| `0d69dda716aeafee4fbb24dc0b6ce84da2b79e142de6074c91d912af98a0b8b2` | `apps/bot/test/e2e/runtime-driver/bot-cleanup-and-order-risk.ts`         |
| `83bfa4d5fdbb5a2e78689b5b8486fdc1ab8b64bdb3c6ad4d7f207459215cd217` | `apps/bot/test/e2e/runtime-driver/bot-lifecycle-factory.ts`              |
| `3c7564206242ede7886dc3ee505c4845cfc21bea279258fe0e97e55bba04325e` | `apps/bot/test/e2e/runtime-driver/bot-state-and-telemetry.ts`            |
| `294cce3516e24b8d528afa936f9f82f898519ffad6fab1f6b736042729ef0ae1` | `apps/bot/vitest.config-command.config.mjs`                              |
| `14a83e02b181b156839fb4978bf243edc95105b36922af3e96d7d2a0b87915f2` | `docs/LIVE-TRADING.md`                                                   |
| `83343c3c9b571fdc68a27b6be7ac4ad59b380b1b4fed0942b9227bff7135c1f8` | `docs/production-strategies/latency-budget.md`                           |
| `9e078d77a23b132b883f70b3e98531f1b0896b07c18e7bad9fab57d7441d80f9` | `docs/production-strategies/pre-launch-checklist.md`                     |
| `f30ed900f84b94c893d7361af9fe387c1fcf43fa3ee22d94e4aa3d34aac56820` | `packages/exchange/src/bybit-eu-adapter.test-support.ts`                 |
| `efee5dc5f9110604c3ccef284a6ff8664cd10a1ba82db13c5e0e1ee6a0645fa4` | `packages/exchange/src/bybit-eu-adapter.test.ts`                         |
| `3e539021bf237fdd4e29c27a915cac1733856d57d1d75d171f9cdbe602b8748a` | `packages/exchange/src/bybit-eu-adapter.ts`                              |
| `bebf84b9cd23b66f17bf8481fbbef079beccb802a50a40745025c9b132c71cbc` | `packages/exchange/src/bybit-eu-client.ts`                               |
| `aeb36567041e355a08d506ba29e7c170a708127dc3addaf8c13e4fd46c69c1a5` | `packages/exchange/src/bybit-eu-feed.fetch.test.ts`                      |
| `78d0df0017d78ea09361c9d9150c8a727ab073f75472de3e1c50c5c459025a9a` | `packages/exchange/src/bybit-eu-feed.lifecycle.test.ts`                  |
| `981f1f9ce56347e9688b8440e6ed0c1302668d2ba3d02f385ec99d77c4f5a060` | `packages/exchange/src/bybit-eu-feed.orders.test.ts`                     |
| `68f88a1037bbe7c88339f109aaa327ee9353957c8aa9e01be7e2bbb67ebc31ca` | `packages/exchange/src/bybit-eu-feed.subscription-base.test.ts`          |
| `fc586ce6355d349086c0c815d1126d6485a91007a62e94518c5bd1e97ead190e` | `packages/exchange/src/bybit-eu-feed.subscription-resilience.test.ts`    |
| `e4e1744c9fe9a36e8d3b23ac0c1242de38782957ae122679edfb788d603e867e` | `packages/exchange/src/bybit-eu-feed.test-support.ts`                    |
| `151e884c73a61931a92ccc671ed51cbd3fcdedaea742551b99a21c14a42ca47a` | `packages/exchange/src/bybit-eu-feed.test.ts`                            |
| `625efccc19bca57ceb507fb1d0d545ccad293bfafece05a2ea2ae315801dfd82` | `packages/exchange/src/bybit-eu-feed.ts`                                 |
| `56946a067c2cb8dbf9164b0a5503c4459b0a8e73036c12b27e122b3c38a5d4fe` | `packages/exchange/src/bybit-eu-normalizers.ts`                          |
| `ba51ca9a7c4b90cef97c07809677b957644c6947775e423a63e6e2f04f806289` | `packages/exchange/src/bybit-eu-order-service.ts`                        |
| `6e0258683577e825a842ac4ccf23c25a778e829ca141aa8b5308627438e25f74` | `packages/exchange/src/bybit-eu-raw-payloads.ts`                         |
| `d3d3326b09ade95f4819ffbd243a3780309ed6acb5a5713a61f9f3317b4eb8f9` | `packages/exchange/src/bybit-eu-spot-margin-client.ts`                   |
| `2a181c0b9fa8be086681600d9dc45cf0f5b537d1b9defabdf6424c23dc86e340` | `packages/exchange/src/bybit-eu-spot-margin-order.test.ts`               |
| `6d224337e5a69e88bc31683a9dbeb0c077f8f00c5bcedb2c46be160371084305` | `packages/exchange/src/bybit-eu-subscription-manager.ts`                 |
| `5d26e0cc88c66e83427532637b587f16f258a77ec317e5ab78deef41d42a3c81` | `packages/exchange/src/factory.test.ts`                                  |
| `a360da523156c96b923fd8bc5d5e568c249c1b55b6493c06fd31f0aedf72b677` | `packages/exchange/src/factory.ts`                                       |
| `c2be41a9594b4382d7809a181bb5cc5e99aa4d43fec28a9a34fb76d735678371` | `packages/exchange/src/index.ts`                                         |
| `0f97fa7e578e05c26bfc1f754f970546c146e4dea7f8eb45b92cff80dedf70d3` | `packages/exchange/tests/bybit-eu-feed-normalizers.test.ts`              |
| `b228f89d771b361fea0f5a9e96618e3de6c5131942d99efe209a6cad12b8cf7a` | `packages/exchange/tests/bybit-eu-feed-watch-lifecycle.test.ts`          |
| `f8e57bf1990352b322f6d4b9607f7354c88df9340bf7afa6d7f348d6d3da0bd3` | `packages/exchange/tests/bybit-eu-feed-watch-operations.test.ts`         |
| `c11c997dc41f05584148380b26707df442477cf4a085a6a5b48c74d11c7f7844` | `packages/exchange/tests/bybit-eu-feed-watch.test-support.ts`            |
| `af065345d39e784d585f9d15fca25f4cbfade3518016cbc08349a79aaedc71fa` | `packages/exchange/vitest.bybit-eu-adapter.config.mjs`                   |
| `4efdd99e39ae8adbdb4799ea93113865e970590e07fe891131cb526288a6f326` | `plans/full-refactor/APPROVALS.md`                                       |
| `7ecc40caa82bae59722aa946a23da1a200079ea00f3b0e77e8ae2000feb1efa5` | `plans/full-refactor/DECISIONS.md`                                       |
| `c217a22a362025df761e3a3279dd954abdc36976269bbb036d39521e63469bfb` | `run-bot/config/default.toml`                                            |
| `b2d6aa0bfbfd588b1b3a7d8ec0d0d68297b0dae411cf532e7d059b2b571e3cff` | `run-bot/config/live-eu.example.toml`                                    |
| `4a1386f5ceebdf1245930a0a1e1dffc02890c60f87a7e7ec309c752955897d70` | `run-bot/config/live-eu.toml`                                            |
| `915e9bf09bdde54937b1cd14435bb1b136c79f5c31d8a87080a47ea3ae24a497` | `run-bot/config/paper-backtest-optimized.toml`                           |
| `683508ea60dcfac3c54358089cbdbcf8daa5969228e71ebc2eed7786cf059e07` | `run-bot/config/paper-backtest-verified.toml`                            |
| `b435a995eb6d1a611145bbf2f1c57e373ce90cfbfabaf14bacb1a2d6b55e76cb` | `scripts/coverage-tools/bot-runtime-network-guard.test.ts`               |
| `f2b5c8677bce24c5a6d55594a8e011b49193800d7ed41e02751d3568e6371b5b` | `scripts/coverage-tools/bot-runtime-network-guard.ts`                    |
| `4b2122cd2ba936b21fbb7817bb9d023fc4eecba2ea6892ec92a76130434baf05` | `scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs`     |
