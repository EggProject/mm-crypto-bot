# Task3 exchange-current-boundary receipt — 2026-08-30

## Purpose, authority, and snapshot

- Historical snapshot timestamp: `2026-08-30T22:39:58+02:00`
  Europe/Budapest (local, no network or live action).
- Historical snapshot worktree: `/tmp/mm-dirty-union-d02-integration`;
  branch `codex/dirty-union-d02-integration`; snapshot HEAD
  `d45dedb9ee8fbc3ea4b9ab79e72ca7596acb768a`.
- Classification: live-exchange current-boundary evidence implementation;
  non-review; non-local dependency/provenance reasoning. Terra triggers are
  live order/leverage, public API, data provenance, and a mixed dirty union.
- Requested/effective route: `terra_worker` / `gpt-5.6-terra` / `high`;
  `workspace-write`. The effective route is recorded by the assigned brief.
  There is no fallback. Agy is not applicable: this is Terra-triggered work,
  not a bounded mechanical implementation.
- Exact write ownership: this new receipt only. Read-only scope:
  `packages/exchange/**`, its Git state/history, D10 evidence, and Task3
  ledgers/reports. No source, test, config, index, stage, or commit mutation
  was authorized or made.
- This is a receipt, not an architecture, order, leverage, or business-behavior
  decision. It does **not** claim a live, review, coverage, or repository PASS.

`git diff --cached --quiet` exited `0`; the index was empty. At the historical
snapshot, `packages/exchange/**` had 43 changed/deleted/untracked paths,
exactly as listed below. After creation, the only intended additional untracked
path is this receipt.

### R1 historical-snapshot correction

This manifest is explicitly historical at snapshot HEAD `d45dedb9ee8fbc3ea4b9ab79e72ca7596acb768a`,
not a claim that it is the repository's current HEAD. At correction time
`2026-08-30T22:39:58+02:00`, the later HEAD was
`a45b6d762eb94ab801a4238ef3a8aa88f7dfb22a`
(`test(shared): remove phase scaffold comment`). Its only changed path is
`packages/shared/src/scaffold.test.ts`; the exchange-only diff from the
historical snapshot is zero paths. `git status --short -- packages/exchange |
wc -l` was `43`, and a 43-row status/SHA-256 re-hash comparison against this
manifest had zero mismatches. Thus the manifest remained unchanged at this
correction; the later commit is outside exchange scope.

## Current exchange manifest

`LOC` is physical lines. `SHA-256` is the current working-tree content; for a
deleted path it is the SHA-256 of `git show <snapshot-HEAD>:<path>`. `HEAD
blob` is the Git object ID used to recover a deleted path.

| Status |  LOC | SHA-256 / HEAD blob when deleted                                                                                    | Path                                                |
| ------ | ---: | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| ` M`   |   30 | `a98ad330c1a673cad37b99fbb1ffe63f2293447973b2e7fa355b300378121806`                                                  | `package.json`                                      |
| ` M`   |  629 | `be96a67039314db4b2984c578d088c5b66825385a76e5518b506e04741f7d59e`                                                  | `src/__testing__/mockFeed.test.ts`                  |
| ` M`   |  446 | `a91ba0548f2115edd57a9de773e05f85623837b444b0d7c984a32555ab4d6cce`                                                  | `src/bybit-eu-adapter.test.ts`                      |
| ` M`   |  126 | `3e539021bf237fdd4e29c27a915cac1733856d57d1d75d171f9cdbe602b8748a`                                                  | `src/bybit-eu-adapter.ts`                           |
| ` D`   | 1764 | `e0a1baa2ba5a0445a57d0214138ea09a4949711d9c4c2c05b51ec2d4c3b50a37`; blob `040e52c4ac30d0cd1839df1852a06ed760500860` | `src/bybitEuFeed.test.ts`                           |
| ` D`   | 1142 | `414ba77f0763657dbc9e3e98420a8739af44f7816c75ebdb220a64af17f84d49`; blob `f9c633dcbecc86e3592da21f55d168aa13d4033d` | `src/bybitEuFeed.ts`                                |
| ` M`   |  275 | `5d26e0cc88c66e83427532637b587f16f258a77ec317e5ab78deef41d42a3c81`                                                  | `src/factory.test.ts`                               |
| ` M`   |   97 | `a360da523156c96b923fd8bc5d5e568c249c1b55b6493c06fd31f0aedf72b677`                                                  | `src/factory.ts`                                    |
| ` M`   |  127 | `08bd9b7010a77b678e199286ff0e7ae6f59758cd50b92ccc12be91c034b899f5`                                                  | `src/index.ts`                                      |
| ` M`   |  153 | `a33f6f4421bbfe1153890781617c073ecd9cd6ee00c87885e4ddd1b72e0910fc`                                                  | `src/symbols.test.ts`                               |
| ` M`   |  287 | `d12e093c3fd1f04f1fa89c38f6086fbe2cbeb17e06dbc629fbf2c898e97d8cef`                                                  | `src/types.ts`                                      |
| ` D`   |  543 | `2e26fd15295f1006e5ad84c4367d858244031e176d474c743d556663537cb967`; blob `dd3ba60553c57f6ce2542d6ed2cd12536ba97cdb` | `tests/bybitEuFeed-watch.test.ts`                   |
| ` D`   |  434 | `9cbf1d1454278f630fac29f7c66401724809f64e819576926a06d5f323fdc35b`; blob `947d0478eb7a338e3d05899333fa43e46578e38e` | `tests/bybitEuFeed.test.ts`                         |
| ` M`   |  149 | `689061340f64cd95b7603213c345f2f63daecb199262bf8a29006b476fbc8cde`                                                  | `tests/factory.test.ts`                             |
| ` M`   |  403 | `bcd3b4b4cec9f00995391509291c5db3ebe6067bc982525c36920cc01192c788`                                                  | `tests/mockFeed.test.ts`                            |
| `??`   |  105 | `43fa21c56a9596ce59cdb041a38182d551a4c1f8cefdb2c10c4faac02f03c516`                                                  | `src/bybit-eu-adapter.test-support.ts`              |
| `??`   |  277 | `2b2e7dbd3b591802fe6a1941d4091d37fb4303e51b4652f16a721ace55dd41ca`                                                  | `src/bybit-eu-client.operations.test.ts`            |
| `??`   |  449 | `c8bdea3eb5338a48ac89f7e4106a7974988d1077e0f36226136d383443a8de9c`                                                  | `src/bybit-eu-client.ts`                            |
| `??`   |  219 | `aeb36567041e355a08d506ba29e7c170a708127dc3addaf8c13e4fd46c69c1a5`                                                  | `src/bybit-eu-feed.fetch.test.ts`                   |
| `??`   |  389 | `78d0df0017d78ea09361c9d9150c8a727ab073f75472de3e1c50c5c459025a9a`                                                  | `src/bybit-eu-feed.lifecycle.test.ts`               |
| `??`   |  405 | `5b02e0da5479239bc391c79dff487d75dbb093c6ffe19a640b857158974bef61`                                                  | `src/bybit-eu-feed.orders.test.ts`                  |
| `??`   |  182 | `68f88a1037bbe7c88339f109aaa327ee9353957c8aa9e01be7e2bbb67ebc31ca`                                                  | `src/bybit-eu-feed.subscription-base.test.ts`       |
| `??`   |  403 | `fc586ce6355d349086c0c815d1126d6485a91007a62e94518c5bd1e97ead190e`                                                  | `src/bybit-eu-feed.subscription-resilience.test.ts` |
| `??`   |  223 | `2c47d41b9134aab564dfa7190e2ad5ff7d607c1b03ba39b9ffb851a3c653d30c`                                                  | `src/bybit-eu-feed.test-support.ts`                 |
| `??`   |  406 | `151e884c73a61931a92ccc671ed51cbd3fcdedaea742551b99a21c14a42ca47a`                                                  | `src/bybit-eu-feed.test.ts`                         |
| `??`   |  379 | `2eb25a0080317dd0905a26f871d3c878213b6d88a12b1f4dce004a2deb803c93`                                                  | `src/bybit-eu-feed.ts`                              |
| `??`   |  154 | `56946a067c2cb8dbf9164b0a5503c4459b0a8e73036c12b27e122b3c38a5d4fe`                                                  | `src/bybit-eu-normalizers.ts`                       |
| `??`   |  250 | `23e014f11a03ce597022dcc721065af800317ff7f190a2a03c1121cb8efc8946`                                                  | `src/bybit-eu-order-service.lifecycle.test.ts`      |
| `??`   |  381 | `c9fc5c2a0009c6a94cee189d965103d82117996b20b4485112cd7acce1dd7acf`                                                  | `src/bybit-eu-order-service.ts`                     |
| `??`   |  106 | `6e0258683577e825a842ac4ccf23c25a778e829ca141aa8b5308627438e25f74`                                                  | `src/bybit-eu-raw-payloads.ts`                      |
| `??`   |   48 | `45c1536bd4f17f5dc09cf56daa59bbdb9dfbd48bc7b18782217b8741d7fdc611`                                                  | `src/bybit-eu-spot-margin-client.ts`                |
| `??`   |  500 | `38d3cf2a8066010b870ab4c4ad7f095811da115ca51449cd476ab803644d0fe7`                                                  | `src/bybit-eu-spot-margin-order.test.ts`            |
| `??`   |  378 | `6d224337e5a69e88bc31683a9dbeb0c077f8f00c5bcedb2c46be160371084305`                                                  | `src/bybit-eu-subscription-manager.ts`              |
| `??`   |   38 | `a47e4af054622a5598e2db1ea098bcf23d05c7f2c0a7e591ec44155503fa3f2f`                                                  | `src/client-order-id.ts`                            |
| `??`   |  438 | `94469cf642cda9adb729cea3389a8fc0c61d56923f14c1b436b07b902e19d9cc`                                                  | `src/spot-margin-authorization.boundary.test.ts`    |
| `??`   |  397 | `638271267c0af19a18fb3f2f38e1d449bde4f74c7c6acf14660c9baac74695de`                                                  | `src/spot-margin-authorization.test.ts`             |
| `??`   |  496 | `3e8812942a263ccb1a3761ddf159e1df3336a2100ce8d305e7d6fb3e7efbfab4`                                                  | `src/spot-margin-authorization.ts`                  |
| `??`   |  448 | `0f97fa7e578e05c26bfc1f754f970546c146e4dea7f8eb45b92cff80dedf70d3`                                                  | `tests/bybit-eu-feed-normalizers.test.ts`           |
| `??`   |  198 | `b228f89d771b361fea0f5a9e96618e3de6c5131942d99efe209a6cad12b8cf7a`                                                  | `tests/bybit-eu-feed-watch-lifecycle.test.ts`       |
| `??`   |  166 | `d98ef10a6b0ecf8defdff3db775ad7a2d1491dfae780ac36e44708fbe6c63b46`                                                  | `tests/bybit-eu-feed-watch-operations.test.ts`      |
| `??`   |  361 | `c11c997dc41f05584148380b26707df442477cf4a085a6a5b48c74d11c7f7844`                                                  | `tests/bybit-eu-feed-watch.test-support.ts`         |
| `??`   |   10 | `89a1d2a2cad5e0d77335a361b21ca7658e7b40162be738a1351d050581793656`                                                  | `tsconfig.tests.json`                               |
| `??`   |   31 | `af065345d39e784d585f9d15fca25f4cbfade3518016cbc08349a79aaedc71fa`                                                  | `vitest.bybit-eu-adapter.config.mjs`                |

## Feed and Spot Margin import closure

The public consumer path is `apps/bot` -> `@mm-crypto-bot/exchange` ->
`src/index.ts`. The current source closure is:

```text
factory.createExchangeClient -> BybitEuFeed
index (public barrel) -------> BybitEuFeed and public DTO/authorization seams
BybitEuFeed -----------------> BybitEuClient (CCXT adapter), normalizers,
                                BybitEuOrderService, subscription manager
BybitEuOrderService ---------> client-order-id, raw DTOs, normalizers,
                                CcxtBybitEuSpotMarginClient, SpotMarginAuthorizer
CcxtBybitEuSpotMarginClient -> BybitEuClient V5 Spot Margin methods
SpotMarginAuthorizer --------> symbol/types + exact numeric selected leverage
```

Focused source tests import the feed directly; lifecycle, fetch, orders,
subscription-base/resilience, Spot Margin order, order-service lifecycle,
client operations, and authorization boundary tests exercise the listed local
seams. `factory.ts` is the consumer creation seam and `index.ts` is the
declared package export (`package.json` exports only `./src/index.ts`). This
is an import graph observation, not proof that the resulting live behavior
meets the target-state requirements.

## Task3 logical 12-file set and D10 relation

The Task3 brief plus approved addendum defines this logical, cross-boundary
12-file set (not an ownership transfer):

1. `apps/bot/src/config/loader.ts`
2. `apps/bot/test/e2e/runtime-driver/bot-cleanup-and-order-risk.ts`
3. `apps/bot/test/e2e/runtime-driver/portfolio-manager-paper.ts`
4. `apps/bot/test/e2e/runtime-driver/kill-switch-commands.ts`
5. `apps/bot/src/bot/order-manager.types.ts`
6. `apps/bot/src/bot/order-manager-placement.ts`
7. `apps/bot/src/bot/order-manager.ts`
8. `apps/bot/src/bot/bot.ts`
9. `apps/bot/src/bot/bot-runtime-assembly.ts`
10. `apps/bot/src/bot/bot-exchange-initializer.ts`
11. `apps/bot/src/bot/order-manager.placement.test.ts`
12. `apps/bot/test/e2e/runtime-driver/bot-lifecycle-factory.ts`

The bot paths consume exchange public types, `ExchangeFeed`, and
`createExchangeClient`; they are not exchange ownership. The Task3 report
requires fresh technical/process review and a coordinator-owned governed E2E
coverage run, so it is a current closure prerequisite rather than a PASS.

D10's latest exact inventory is a prior, path-and-SHA baseline. Of the 43
current exchange paths: 15 are `D10-known unchanged`, 11 are
`D10-known diverged`, and 17 are `unmapped`. No D10-known exchange path is
absent from the current filesystem. The classifications are SHA comparisons,
not an approval of the changes:

- Unchanged: adapter source; factory source/test; feed fetch/lifecycle/test,
  subscription-base/resilience, normalizers, raw payloads, subscription
  manager, normalizer test, watch-lifecycle/test-support, adapter Vitest config.
- Diverged: adapter test/support; client; feed source/order test/test support;
  order service; Spot Margin client/order test; index; watch-operations test.
- Unmapped: package manifest; mock/symbol/factory/mock tests; legacy camelCase
  deletions; client-operations and order-service-lifecycle tests; client-order
  ID; authorization source/tests; test tsconfig. An unmapped path is a commit
  blocker until a scoped owner maps it or removes it under a separate brief.

## Mixed-hunk mapping / blockers

Every hunk in the three mixed files is classified below. “Mapped” records the
only evidenced intended concern; it is not authorization to stage it.

| File and hunk                                                                                       | Classification                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`: add `coverage:bybit-eu-adapter`                                                     | Mapped to D10-D09 adapter validation seam.                                                                                                                       |
| `package.json`: add `@mm-crypto-bot/numeric`                                                        | Mapped to the exact selected-leverage/Spot Margin type dependency used by the D10 order boundary.                                                                |
| `package.json`: `ccxt` `4.5.64` -> `4.5.75`                                                         | **UNMAPPED / BLOCKER**: the ignored unused-file ledger records a CCXT 4.5.75 provenance/version concern; no current ownership or validation receipt resolves it. |
| `index.ts`: replace historical header comments                                                      | **UNMAPPED / BLOCKER**: no specific ownership evidence maps this documentation-only deletion.                                                                    |
| `index.ts`: export Spot Margin types, client ID, feed/client/raw DTO/normalizer/authorization seams | Mapped to D10-D10 raw API and D10-D11 origin/TOCTOU/unwatch/Spot Margin boundary surface; current SHA divergence still needs owner confirmation.                 |
| `index.ts`: `bybitEuFeed` -> `bybit-eu-normalizers` export target                                   | Mapped to D10-D10/D10-D11 kebab-case feed split; confirm the removed camelCase files and all new split files as one atomic replacement.                          |
| `index.ts`: `detectExchangeEnv` -> `detectExchangeEnvironment`                                      | **UNMAPPED / BLOCKER**: a public export rename requires explicit consumer/migration ownership.                                                                   |
| `index.ts`: remove latency/OHLC historical comments                                                 | **UNMAPPED / BLOCKER**: no evidenced concern owns these unrelated comments.                                                                                      |
| `types.ts`: numeric import plus Spot Margin intent/capacity/order-request fields                    | Mapped to D10-D10/D10-D11 exact selected-leverage and authorization boundary.                                                                                    |
| `types.ts`: comment reflows at symbol/ID/protective/order/market declarations                       | **UNMAPPED / BLOCKER**: formatting/content-only hunks are mixed with safety fields; they need a separate owner or removal from this slice.                       |

## Current prerequisite proposal (not executed)

Before a safe sequential exchange commit, obtain one explicit owner receipt
that (1) resolves every `UNMAPPED / BLOCKER` hunk/path, especially the CCXT
version and public export rename; (2) confirms the old camelCase deletions and
new kebab-case split as one replacement set; (3) reconciles the 12 D10-diverged
hashes against their intended follow-up changes; and (4) records the required
Task3 technical/process review plus its governed coverage result. Only then
can a separate owner select an atomic exchange path set, rerun scoped gates,
and request independent reviews. This proposal makes no source or product
decision and does not authorize staging or committing.

## Commands actually run

| Command / inspection                                                                                              | Exit and observed output                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git status --short --branch`; `git rev-parse HEAD`; `git branch --show-current`                                  | `0`; branch/HEAD recorded above; dirty union observed.                                                                                           |
| `git status --porcelain=v1 --untracked-files=all -- packages/exchange`; `git diff --numstat -- packages/exchange` | `0`; 43 manifest paths, including four deletions and the current untracked split.                                                                |
| `sha256sum`, `wc -l`, `git show HEAD:<path>`, `git rev-parse HEAD:<path>` for each manifest path                  | `0`; values recorded in the manifest.                                                                                                            |
| `rg` and `sed` over D10 evidence, Task3 brief/report, ignored ledger, package contract, imports, and consumers    | `0`; closure, 12-file set, D10 baseline, and blockers recorded above.                                                                            |
| `git diff --unified=0 -- package.json src/index.ts src/types.ts`                                                  | `0`; every mixed hunk mapped or blocked above.                                                                                                   |
| `bun run --filter @mm-crypto-bot/exchange typecheck`                                                              | `0`; package typecheck passed.                                                                                                                   |
| `bun run --filter @mm-crypto-bot/exchange test`                                                                   | `0`; `454 pass`, `0 fail`, `1192 expect()` calls, `25` files. Tests were local deterministic package tests; no live/network command was invoked. |
| R1: `git rev-parse HEAD`; `git show -s`; `git diff-tree`; exchange-only `git diff --name-only`                    | `0`; later HEAD `a45b6d…`, one shared test path, zero exchange paths.                                                                            |
| R1: exchange status count plus 43-row status/SHA-256 comparison against this manifest                             | `0`; count `43`, zero status or hash mismatches.                                                                                                 |
| Package coverage                                                                                                  | Not run: the configured coverage script writes generated artifacts, outside this receipt's exclusive write scope. No coverage PASS is claimed.   |

## Recovery and final integrity gates

- Recovery is non-destructive: recover a deleted legacy path with
  `git show <recorded-blob>:<path>` into an inspected separate worktree, or
  discard this receipt alone. Do not reset, checkout, stage, or overwrite the
  shared dirty union under this task.
- Rollback of a later approved exchange commit must be an inspected new revert
  commit owned by that later task; it must not restore compatibility paths or
  silently change live order/leverage behavior.
- Final receipt gates to run after this file exists: Prettier check, untracked
  whitespace check, `git diff --check`, trailing-whitespace scan, bounded
  literal-secret scan, LOC <= 500, and exact status/index capture. Their
  actual results belong to the post-write validation below; no other scope is
  implied.

### Post-write receipt validation

All commands below were local and exited as stated. `bunx prettier --write`
was used only to format this owned receipt after its first check reported a
style mismatch; it touched no other path.

| Gate                                                | Result                                                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --check <receipt>` after formatting  | Exit `0`.                                                                                                                                                            |
| `git diff --check`                                  | Exit `0`.                                                                                                                                                            |
| `git diff --no-index --check /dev/null <receipt>`   | Expected exit `1` for an untracked difference; diagnostic output `0` bytes.                                                                                          |
| `rg -n '[[:blank:]]+$' <receipt>`                   | Exit `1`, zero trailing-whitespace matches.                                                                                                                          |
| bounded literal secret-signature `rg`               | Exit `1`, zero private-key/token-literal matches.                                                                                                                    |
| `wc -l <receipt>`                                   | `219`, within the <=500 limit.                                                                                                                                       |
| `git diff --cached --quiet`                         | Exit `0`, empty index.                                                                                                                                               |
| `git status --short -- <receipt> packages/exchange` | The 43 exchange entries remain as manifested and the only owned additional entry is `?? plans/full-refactor/evidence/task3-exchange-current-boundary-2026-08-30.md`. |

The historical final capture had 429 full-worktree porcelain entries. This is
not a current-worktree assertion. This receipt neither stages them nor claims
ownership of any entry outside its single evidence path.

### R1 correction validation

At the later HEAD, revalidation was local only: Prettier check and
`git diff --check` exited `0`; untracked `git diff --no-index --check` had its
expected exit `1` with zero diagnostic bytes; trailing-whitespace and bounded
literal-secret scans returned zero matches (exit `1`); the index remained empty
(exit `0`); and the receipt was 246 lines, within the <=500 gate. The exchange
status count remained 43 and this receipt remained its sole owned untracked
path. No coverage run, live call, network operation, stage, or commit occurred.
