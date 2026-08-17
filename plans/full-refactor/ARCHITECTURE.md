# Target Architecture — DRAFT

**Status:** DRAFT. The target tree, package names, and dependency boundaries are
approved by D-08; implementation evidence is **NOT YET EVIDENCED**.

## Design rules

- Dependencies point inward: application composition -> adapters -> use cases
  -> domain -> shared foundations. Domain code never imports Bun, CCXT, files,
  transports, React, or environment variables.
- Cross-package imports use only declared package exports. No consumer reaches
  another package's `src/` tree; public APIs are minimal and have contract tests.
- Untrusted input is `unknown`, guarded by named type guards at a versioned DTO
  boundary, converted into immutable domain values, and never serialized from a
  domain object directly.
- A class owns a bounded mutable resource or explicit lifecycle (for example a
  session, queue, adapter, clock-backed service, or state machine). Pure domain
  policies, transforms, numeric operations, guards, and selectors are functions.
  This is a criterion, not a class quota.
- No owned source or test file exceeds 500 physical lines. A change that would
  cross the limit is split by cohesive responsibility before merge.

## Proposed target tree

```text
apps/
  bot/                     # deployable command application; composition only
  config-search/           # deployable configuration-search application
packages/
  assert/                  # internal invariant assertions built on guards
  typeguard/               # reusable runtime guards
  typing/                  # compile-time and pure type-relation utilities
  numeric/                 # exact Fraction + BigInt rational domain values
  logging/                 # injected structured logging port and sinks
  trading-domain/          # strategy, portfolio, risk, orders, lifecycle ports
  market-data/             # canonical OHLCV/data/provenance domain and ports
  market-data-ccxt/        # public CCXT Pro research/ingestion adapter only
  backtest-domain/         # deterministic backtest use cases and ports
  execution-paper/         # paper adapter only
  exchange-bybiteu/        # Bybit EU/CCXT adapter only
  test-support/            # non-production fixtures/builders, never runtime API
scripts/                   # small, owned repository automation only
docs/
  en/ hu/                  # authoritative Markdown, parallel navigation
  site/                    # deterministic HTML-site source and local assets
data/                      # schema-defined external/generated data only
releases/                  # ignored assembly output only
```

The external runtime root is deliberately outside this repository and is not a
target-tree entry. Its approved name/path, mounts and permissions are D-02 in
[APPROVALS.md](APPROVALS.md); this draft neither creates nor assumes a location.

## Proposed dependency graph

```text
apps/bot, apps/config-search
          │
          ├── execution-paper / exchange-bybiteu / backtest-domain
          │                 │            │
          │                 └──────┬─────┘
          │                        │
          ├────────── trading-domain ────────── market-data
          │                 │                     │
          └── numeric / logging / assert / typeguard / typing
```

`exchange-bybiteu` is the only live order adapter. It accepts domain order
intents through a port and has no authority to choose leverage or repair
eligibility. `execution-paper` must use the same strategy/risk/domain decision
code and differs only at the execution adapter boundary.

## Package-by-package import allowlist

This is an **APPROVED TARGET**, enforced by a machine gate with
positive graph fixtures and forbidden-import negative fixtures.

| Consumer                                                  | May import                                   | Must not import                                                                      |
| --------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `assert`                                                  | `typeguard`, `typing`                        | every domain, adapter, app, I/O package                                              |
| `typeguard`, `typing`, `numeric`                          | approved direct foundations only             | apps, domains, adapters, `test-support`                                              |
| `logging`                                                 | `typing`, `typeguard`                        | domains, apps, adapters, `test-support`                                              |
| `trading-domain`, `market-data`                           | foundations only                             | adapters, apps, `test-support`                                                       |
| `backtest-domain`                                         | `trading-domain`, `market-data`, foundations | live/paper adapters, apps, `test-support`                                            |
| `execution-paper`, `exchange-bybiteu`, `market-data-ccxt` | domains, foundations, logging                | apps, `test-support`, each other unless an approved port requires it                 |
| `apps/*`                                                  | declared package public exports              | package `src`, undeclared packages, `test-support` in production code                |
| `test-support`                                            | public exports needed to construct tests     | production runtime importers; it is non-transitive and never a production dependency |

Ports are owned by their consumer: a domain use case defines the interface it
needs; an adapter implements that interface. The architecture gate rejects
cycles, deep imports, inverted dependencies, any `test-support` production
import, and direct infrastructure imports from domains.

## Workspace-package external dependency allowlist

This is an **APPROVED TARGET**. The previous directed table is
a workspace-package import allowlist only; this table separately governs direct
external runtime imports. Each allowed dependency must appear as an exact direct
entry in that package manifest, resolve to the approved lockfile version, and
be observed by package import scans. No undeclared external direct import is
permitted.

| Workspace package/application     | Allowed direct external runtime dependency                                                | Prohibition                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `@mm-crypto-bot/numeric`          | exact-pinned `fraction.js` only, behind its public exact-value API                        | no direct financial dependency in consumer packages                                    |
| `@mm-crypto-bot/exchange-bybiteu` | exact-pinned `ccxt` only, behind Bybit EU adapter ports                                   | no other live-exchange client; no CCXT import outside approved adapter/research scope  |
| `@mm-crypto-bot/market-data-ccxt` | exact-pinned `ccxt` only, behind public research/ingestion ports                          | no credentials/private/account/order/cancel/borrow/margin/paper/live import or call    |
| foundations/domain packages       | none unless a separately approved exact entry is added here                               | no undeclared package, no I/O/framework/exchange dependency                            |
| `apps/bot`, `apps/config-search`  | only exact direct dependencies required for composition/CLI and listed in their manifests | no transitive-dependency imports, package `src` imports, or unapproved runtime tooling |
| root tooling                      | exact development/build dependencies declared at root only                                | no production package may import root tooling dependency implicitly                    |

The architecture/dependency machine gate validates package manifests, `bun.lock`,
static import scans and resolved dependency graphs together. Negative fixtures
cover an undeclared external import, a wrong package owner for `fraction.js` or
`ccxt`, a transitive-only import, and a domain import of infrastructure. See
[DEPENDENCIES.md](DEPENDENCIES.md) for supply-chain evidence and
[VALIDATION.md](VALIDATION.md) for the blocking gate.

## Required fixed-10x live boundary

The `trading-domain` target defines an opaque immutable `SelectedLeverage10x`
created only by a constructor that represents exactly `"10"`. A live operation
and every order intent carries it; no maximum, range, default, strategy/symbol
override, dynamic selector, or fallback type exists. Immediately before a
submission, `exchange-bybiteu` must obtain current authenticated evidence of:

- account and Unified Trading Account Spot Margin eligibility;
- permitted `bybiteu`, `https://api.bybit.eu`, supported symbol/assets and
  margin mode;
- successful exactly-10x selection and borrowing capacity; and
- non-stale, unambiguous account state.

The adapter records selected leverage, actual borrow, and effective leverage as
different immutable audit values and reconciles them against authenticated
responses. Missing or contradictory evidence prevents submission. Reduce-only
and emergency exit preserve selected 10x while taking a risk-reducing path;
they cannot bypass unrelated validation.

## Required account, exposure, and RiskGate boundary

The domain must define immutable exact canonical-string value objects for
`StartingEquityUsdEquivalent("1000")` and
`InitialGrossExposureUsdEquivalent("10000")`. Each retains its authoritative
valuation UTC timestamp and source; a different timestamp/source for gross
exposure is permitted only when explicitly recorded as its authority. `Equity`,
`AvailableBalance`, `WalletBalance`, `GrossExposure`, signed `NetExposure`,
`SelectedLeverage10x`, `VenueMaximumLeverage`, `ActualBorrowedAmount`, and
`EffectiveLeverage` are distinct non-interchangeable values.

`GrossExposure` is exactly the sum of absolute notionals of all positions plus
worst-case executable notionals of every active order. Activation and
reconciliation tests must include positive and negative valuation, balance,
position/order, and mismatch cases.

One consumer-owned central `RiskGate` is the only exchange-action call path in
live, paper, and backtest composition. It returns a typed decision and immutable
audit event before every exchange action and validates selected leverage,
exposure, concentration, drawdown, price, quantity, balance, and kill-switch
state. An architecture-negative fixture proves no adapter bypass exists; E2E
tests prove invalid decisions make zero adapter calls. Reduce-only/emergency
operations may bypass only constraints whose application would increase risk;
they retain exactly 10x and all unrelated checks.

## Exact numeric and data boundaries

`numeric` wraps an audited exact-pinned `fraction.js` and BigInt rational
implementation. Financial/quantity input begins as a canonical string or bigint;
JavaScript `number`, implicit conversion, `valueOf`, and lossy JSON are excluded
from decision paths. Venue tick/lot validators reject non-exact multiples.

`market-data` owns `ohlcv-bars@1`, manifests, provenance IDs, canonical hashes,
and atomic ingestion boundaries. A backtest accepts only validated manifest IDs
and hashes and records strategy/config/input IDs. Raw data is immutable; derived
data has distinct IDs and parent lineage.

## Approved D-04 CCXT Pro research-data boundary

`market-data-ccxt` is an approved D-08 package name. D-04 approves its bounded responsibility: a
dynamic provider factory may choose any provider exposed by the exact-pinned
CCXT Pro-supported provider catalog for public market-data discovery/ingestion.
The current repository declaration is CCXT `4.5.64`; any version update remains
a separate dependency phase and is not approved here. Official evidence was
reviewed on 2026-08-17: [CCXT Pro](https://docs.ccxt.com/docs/pro),
[CCXT Pro manual](https://docs.ccxt.com/docs/pro-manual),
[CCXT manual](https://docs.ccxt.com/docs/manual), and the
[CCXT source repository](https://github.com/ccxt/ccxt). No provider history
was live-verified by this plan update.

The provider factory accepts a primitive canonical string provider ID and a
complete `ResearchDataContract@1`: provider, market/instrument type, symbol,
timeframe, and UTC `[start,end)` range. It rejects non-string, empty,
confusable/non-canonical, unknown, `__proto__`, `prototype`, and `constructor`
IDs before lookup. It validates against the pinned CCXT Pro own provider catalog
with safe own-property lookup, never inherited lookup. If one audited dynamic
constructor lookup is unavoidable to support the catalog, it is isolated to one
exactly allowlisted factory source location and proves it returns only the
wrapper below, never the raw instance.

The raw CCXT instance is internal and non-exported. A narrow
`PublicHistoricalClient` wrapper exposes only typed public `loadMarkets`, exact
market metadata/capability lookup, and `fetchOHLCV` ingestion results. No raw
client escape, bracket/dynamic method invocation outside the audited factory,
reflection (`Reflect`, `Proxy`, `eval`, `Function`), private-property access, or
generic method forwarding is allowed. Static AST/import/export gates and runtime
negative tests reject prototype keys, dynamic private/`createOrder`/`cancelOrder`
calls, reflection, generic forwarding, and raw escape. `watchOHLCV`, cached
data, or capability metadata alone remain insufficient.

An explicit operator invocation must include a dry-run action plan: public-free/
no-credential endpoint, region, terms, rate limit, request/page/time/retry
budget, and expected cost. Planning, CI, deterministic tests and automatic/
background paths have no network authority. A historical preflight then uses
the wrapper's actual `fetchOHLCV`; unavailable provider, missing capability,
invalid contract/budget, paid/material-cost path, rate-limit exhaustion, or
incomplete range blocks ingestion/backtest with no silent provider fallback.

The adapter public-method allowlist is only the wrapper operations above. It has
zero credential, account, order, borrow, margin, paper, or live authority.
`exchange-bybiteu` remains the sole live execution adapter and Bybit EU the sole
live venue. External-provider data never proves Bybit EU live suitability.

Ingestion uses bounded pagination, approved retry/rate-limit policy, exact raw
string preservation before canonical conversion, finality checks, gap/duplicate
validation, temporary-write/full-validate/atomic-rename, and immutable SHA-256
provenance output below `data/`. Normalized JavaScript `number` is insufficient
for canonical values. A provenance manifest records contract ID, provider,
CCXT version, method, market/instrument, symbol, timeframe, UTC range, download
time, pagination/retry result, finality, count, gap/duplicate status, canonical
file hashes, tool version, and source commit. Backtests are offline manifest
consumers only.

Required proof is deterministic fake-provider and negative-provider tests for
capability/preflight/range/fallback/private-method rejection, exact raw-to-
canonical conversion, rate-limit/retry bounds, gap/finality/atomic-write, and
provenance. Rate/cost contract tests reject absent endpoint/region/terms/budgets,
non-public/non-free credentials/cost, automatic/background calls and unbounded
requests. Offline network-guard E2E proves no real provider preflight occurs in
deterministic CI; a real preflight is an explicit operator action, not a CI
validator.

## Approved D-07 semantic zero-legacy scanner

This is a **REQUIRED TARGET** driven by D-07. A machine scanner evaluates only
declared terminal target areas: `apps/**`, `packages/**`, `scripts/**`, `bin`,
`run-bot`, `search-best-config`, current docs/site/assets, active configuration,
package manifests, and CI. It rejects legacy files/directories, imports, exports,
routes, commands, runtime/config/current-doc references, served assets, and
compatibility shims. Terminal checks include `test ! -e docs/legacy`,
`test ! -e bin`, `test ! -e run-bot`, and `test ! -e search-best-config`.

The scanner is semantic, not a global word scan. Its versioned config declares
the target roots and a minimal exact-path allowlist: `plans/full-refactor/**`
for evidence only, `AGENTS.md` and `.codex/ENGINEERING-STANDARDS.md` for
governing evidence only, and protected `data/reports/**` for formal reports
only. These exclusions can never be imported, executed, configured, routed, or
served. Negative fixtures prove that the allowlist cannot broaden into an
executable/imported/served path. Git history is the external historical record;
protected formal reports and runtime user data are non-delete targets.

## Current gap evidence

`OBSERVED`: current packages are `shared`, `core`, `exchange`, `paper`,
`backtest`, and `backtest-tools`; `shared` mixes broad concerns and the required
foundation packages do not yet exist. Current financial paths contain `number`
types and current configuration includes `max_leverage`. The target architecture
is therefore **NOT YET IMPLEMENTED**.

`TO VERIFY` before implementation: use a dedicated architecture validator over
declared imports; it must reject package `src` reaches and relative cross-package
imports. The architecture-test command introduced in the toolchain phase must
show no prohibited package imports or cycles.
