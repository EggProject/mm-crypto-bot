# Goal and Scope — DRAFT

**Status:** DRAFT. D-01 through D-09 are **APPROVED** within their exact
records in `APPROVALS.md`. Approval unblocks sequencing only; no phase, runtime,
provider, dependency, governing patch, release, or live safety gate is complete.

## Measurable objective

Transform the repository in approved stages into a Bun/Turbo monorepo with:

- intentional domain package and application boundaries;
- no legacy production code, compatibility shims, `bin/`, or `mm-bot` alias
  assets;
- strict TypeScript 6.x, exact numeric handling, fail-closed live execution,
  focused class-based design where stateful lifecycle ownership benefits from a
  class, and pure functions where that is clearer;
- files no longer than 500 lines for owned source and tests;
- linting, formatting, commit hooks, reproducible verification, and current
  mutually compatible exact-pinned dependencies;
- a rebuilt bilingual Markdown documentation set plus an offline, local-asset,
  multipage interactive HTML documentation site;
- one reproducible, target-specific ZIP release per deployable app, including
  deterministic bytes/hash across two clean builds, manifest, hashes, SBOM,
  license and machine-readable audit evidence, and a clean offline smoke test;
  and
- 100% statements, branches, functions, and lines for each owned runtime scope
  at both unit and E2E levels, with successful independent Terra technical and
  Luna process reviews and re-reviews.

## Scope

The planned migration includes the root workspace/toolchain, `apps/`,
`packages/`, `search-best-config/`, `scripts/`, `docs/`, versioned runtime
configuration, deployment instructions, testing organization, Turbo tasks, and
release assembly. D-04 also approves public CCXT Pro market-data provider
selection for explicit operator-invoked research/backtest ingestion under the
bounded contract in `ARCHITECTURE.md`. Planning, CI, and deterministic tests
never perform a provider network call. All package relationships and commands
will be migrated only after characterization tests protect observed behavior.

## Approved D-04 external-action boundary

Only an explicit operator-invoked public historical provider preflight/ingestion
may use D-04. It requires `ResearchDataContract@1`, all evidence gates, a
public-free/no-credential endpoint, and a recorded dry-run plan specifying
provider endpoint/region/terms, rate limit, request/page/time/retry budgets and
expected cost. Automatic/background calls, credentials/private endpoints, paid
endpoints or material cost, unbounded requests, and every live/paper/account/
order/borrow/margin action require new explicit approval. A provider/range
failure blocks ingestion/backtest; no fallback is permitted.

## Explicit non-scope without new approval

- Activating live trading, submitting orders, accessing a real exchange,
  changing account credentials, downloading external data, or publishing a
  release, except the already-approved D-04 explicit operator-invoked
  public-free/no-credential historical provider preflight/ingestion under its
  complete `ResearchDataContract@1`, dry-run-budget, wrapper, provenance, and
  fail-closed contract. Every other data download requires new explicit approval.
- Altering the permitted live venue/product: Bybit EU Spot Margin via CCXT
  `bybiteu` against `https://api.bybit.eu`.
- Changing the immutable live selected-leverage invariant from exactly 10x, the
  exact USD-equivalent starting-equity target `"1000"`, or the initial
  gross-exposure target `"10000"`.
- Implementing the already-approved release runtime/platform, external runtime
  root, simulation-margin model, Lefthook governing-rule replacement, or
  internal workspace-pin semantics without their phase-specific evidence and
  review gates.
- Adding a live or paper provider authority, provider fallback, credential or
  account access, order/cancel/borrow/margin call, or treating external-provider
  history as proof of Bybit EU live suitability.
- Triggering provider network activity from planning, CI, deterministic tests,
  automatic/background jobs, or any preflight that lacks the approved endpoint,
  region, terms, rate, request/page/time/retry budget and dry-run plan.

## Completion evidence

Completion requires the evidence matrix in [VALIDATION.md](VALIDATION.md), not
intent or a plausible repository structure. At minimum it must prove:

1. Every package and app meets the architecture boundary checks and declared
   public API contract tests.
2. Live safety tests reject every invalid/non-10x, stale, ambiguous, ineligible,
   unsupported, failed-borrow, and failed-authentication case before submission.
   They also prove canonical "1000" starting equity and "10000" initial
   gross exposure are bound to authoritative valuation UTC timestamp/source;
   gross exposure equals absolute position notionals plus worst-case executable
   active-order notionals; and each account/leverage value remains distinct.
3. One consumer-owned typed/audited RiskGate is proven unbypassable before every
   exchange action in live, paper, and backtest paths, including zero adapter
   calls from architecture-negative and E2E invalid cases.
4. Both unit and E2E coverage reports independently show 100% for statements,
   branches, functions, and lines for every in-scope runtime owner.
5. `bun run verify` reproduces CI format, lint, typecheck, build, coverage, and
   E2E gates from a clean frozen installation.
6. Each app's release artifact passes an offline smoke test with no source,
   `node_modules`, package manager, secret, config, state, or mounted data
   embedded.
7. A Terra final technical reviewer and Luna process reviewer independently
   inspect the final evidence. All valid findings are fixed and independently
   re-reviewed to PASS, with ledger entries in `REVIEW-EVIDENCE.md`.
8. The final repository has zero legacy code, documentation, assets, markers,
   compatibility shims, or references; `docs/legacy` is absent. This does not
   authorize deletion of protected formal reports under `data/reports/`.

## Stop-and-ask conditions

Implementation must stop before an action that changes product goals, live
trading/risk behavior, security/credentials, data semantics/provenance, cost,
external effects, governing policy, or release/runtime compatibility. It must
also stop if official-current compatibility evidence is unavailable, a required
invariant has no testable acceptance criterion, a file has competing writers,
or preserving behavior would need a legacy compatibility layer. D-04 provider
selection itself is no longer a blocker, but every provider must satisfy the
approved preflight. D-07 zero-legacy removal is likewise approved, but it remains sequenced behind the Phase 6
replacement and protected-formal-report inventory checks.
