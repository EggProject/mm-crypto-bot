# Validation and Evidence Plan — DRAFT

**Status:** DRAFT. The target-refactor gates below are not claimed to have
passed. Observed Phase 1 Slice A command evidence is recorded separately below;
it does not complete the target architecture, coverage, release, or review
gates.

## Required gate matrix

### C4c observed implementation evidence — pending review

ER-065 and [the C4c command ledger](evidence/c4c-command-ledger.md) bind the
current C4c scope to logging-package lint/typecheck/build, 27 passing V8 tests
with 220/220 statements, 160/160 branches, 49/49 functions, and 202/202
lines; bot typecheck and 733 passing tests; shared 102 passing tests; and root
Turbo typecheck/build. Generated logging coverage remains ignored and unstaged
with the hashes in the ledger. `bun audit` is **NOT EVIDENCED** because the
request returned `ConnectionRefused`; scoped app ESLint, root format, and
coverage-tool typecheck remain **NOT PASS** exactly as recorded. C4c awaits
independent technical and process review.

| Gate                  | Required evidence                                                                                                                                                                                                                                                                              | Current status                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting            | `bun run format:check`, exact Prettier config, no changes.                                                                                                                                                                                                                                     | Current Slice B working tree: PASS, recorded below. Final target-architecture/full-verify formatting evidence remains NOT YET IMPLEMENTED/EVIDENCED and must be rerun after future changes.          |
| Linting               | Flat ESLint strict/stylistic/security/unicorn config, `--max-warnings=0`.                                                                                                                                                                                                                      | NOT YET EVIDENCED; current root ESLint exists but target compliance is unproven.                                                                                                                     |
| Type safety           | Strict TS 6 project/package typechecks with compile-time tests.                                                                                                                                                                                                                                | NOT YET EVIDENCED for target architecture.                                                                                                                                                           |
| Build                 | Deterministic package/app builds with declared outputs.                                                                                                                                                                                                                                        | NOT YET EVIDENCED; current packages report ts-only placeholder builds.                                                                                                                               |
| Unit coverage         | Separate per-runtime-scope report: 100% statements/branches/functions/lines.                                                                                                                                                                                                                   | NOT YET EVIDENCED.                                                                                                                                                                                   |
| E2E coverage          | Separate per-runtime-scope report: 100% statements/branches/functions/lines.                                                                                                                                                                                                                   | NOT YET EVIDENCED.                                                                                                                                                                                   |
| Architecture          | Workspace-package plus external dependency import allowlists, consumer-owned ports, no cycles/deep imports/test-support production imports, manifest/lockfile/import-graph agreement, negative fixtures, file limit.                                                                           | NOT YET IMPLEMENTED/EVIDENCED.                                                                                                                                                                       |
| Data integrity        | DTO guard, canonical numeric/OHLCV/provenance negative tests, D-04 `ResearchDataContract@1` public `fetchOHLCV` wrapper fakes, own-catalog/provider-ID/raw-escape/reflection/private-method rejection, rate-cost contract, bounded pagination/finality/atomic-write and offline network guard. | NOT YET EVIDENCED.                                                                                                                                                                                   |
| Live safety           | Exact 10x, exact baseline/valuation/exposure accounting, central RiskGate, immutable guarded config startup, and authenticated Bybit EU negative tests.                                                                                                                                        | NOT YET EVIDENCED; current semantics conflict with target.                                                                                                                                           |
| Security/supply chain | Frozen install, audit, trusted dependency allowlist, secret scan, SBOM/license, machine-readable audit evidence with tool/version/timestamp/lockfile hash/result.                                                                                                                              | Slice A frozen-install and local lifecycle inspection are observed; `bun audit` baseline exited 1 with `ConnectionRefused`, so vulnerability, license, SBOM, and release proof remain NOT EVIDENCED. |
| Release               | Exact Node `24.19.0` launcher gate for initial `linux-x64`, two clean byte-identical builds, per app/target manifest/hash/SBOM/license/audit and offline smoke.                                                                                                                                | NOT YET IMPLEMENTED/EVIDENCED.                                                                                                                                                                       |
| Documentation         | HU/EN Markdown parity, link checks, local licence-verified icon inventory, local-asset HTML interaction/accessibility checks.                                                                                                                                                                  | NOT YET IMPLEMENTED/EVIDENCED.                                                                                                                                                                       |
| Reviews               | Independent Terra technical + Luna process review, fixes, independent re-reviews.                                                                                                                                                                                                              | NOT YET EVIDENCED for final refactor.                                                                                                                                                                |

## Proposed root verification order

The future complete `bun run verify` must execute and report, in order: frozen/install integrity
precondition; format check; lint; typecheck; architecture/file-length checks;
build; unit coverage; E2E coverage; data/live safety integration tests;
dependency/security/license checks; docs checks; release assembly; per-target
offline artifact smoke. It must fail on the first blocking gate while retaining
enough structured output to identify scope. That full command is
**NOT YET IMPLEMENTED/EVIDENCED** and must not be named or advertised as
available. The current `bun run verify:foundation` is an explicitly incomplete
foundation runner only.

The implementation gate must reject a non-exact external dependency, a Node or
Bun engine range, `bunfig.toml` `install.exact = false`, or external use of
`workspace:*`. It must compare manifest, lockfile, import graph, recorded
version matrix, and SBOM. It also must re-inspect Lefthook's exact-install
binary/lifecycle/platform metadata and prove Lefthook is absent from
`trustedDependencies`; the recorded Bun default-trust baseline is not a
substitute. After that frozen-install gate, an isolated
temporary Git clone/repository alone runs `lefthook install`; validation
inspects its generated hook path/content/launcher and proves a real pre-commit
subprocess runs `ESLint -> Prettier -> clean:artifacts -> worktree inspection`
with fail-fast/exit propagation. It must prove absent/untrusted binary rejection
and no main-worktree `.git/hooks` mutation. CI validates configuration and the
pipeline contract without installing hooks. Separately, bootstrap docs and a
bootstrap smoke contract require a human/operator, only after a successful
frozen install and only in their own clone, to run the exact repo-local
`./node_modules/.bin/lefthook install` command, inspect
the hook, and prove deterministic uninstall/reinstall. This is not automatic
postinstall, CI, or agent evidence without separate authority.

The Phase 1 matrix rejects the invalid `@eslint/js` `10.8.1` and Unicorn
`72.0.0` values. It requires registry-evidenced `@eslint/js` `10.0.1` peer
`eslint ^10.0.0` with exact `eslint` `10.8.1`, and Unicorn `73.0.0`.

It must also enforce guarded dependency sequencing: `fraction.js` only after
Phase 2 exact-arithmetic/property/public-API evidence; Zod only after Phase 3
DTO/guard consumer and boundary evidence; CCXT only after Phase 3
`PublicHistoricalClient` fail-closed/no-network contract and Phase 4 Bybit EU
exact-10x/eligibility/borrow safety evidence, as a distinct pre-Phase-5 change.
The current baseline `bun audit` result is **NOT EVIDENCED** because its
2026-08-17 re-run exited 1 with `ConnectionRefused`; `bun pm untrusted` 0 is
not a substitute for the required frozen-install audit/license/SBOM proof.

## Coverage interpretation

Coverage is accepted only when it names the exact runtime owners and exclusions;
declarations/static data may be excluded only when they contain no owned runtime
behavior and the reason is documented. Unit and E2E runs are isolated, not
merged to mask a gap. Every package/app scope must report four independent
100% measures at both levels. No ignore directive or threshold workaround is
acceptable.

## Live invariant test catalog

The target test suite must prove all of the following before any live claim:

- construction accepts one exact canonical global/session selected-leverage value, defaults exactly to `"10"`, freezes it for the active session, and rejects invalid values plus rounding, coercion, fallback, range, cap, dynamic, per-strategy, per-symbol, and per-order alternatives;
- each activation and pre-submit authenticated response is required and fresh: EU account, UTA Spot Margin, supported assets/symbol, allowed margin mode, venue support for the configured value, equality with actual selected leverage, borrowing capacity, and unambiguous account state;
- invalid, missing, stale, ambiguous, unsupported, ineligible, or unequal verification results in a typed rejection and zero exchange submit calls;
- configured selected leverage, actual borrowed amount, and effective leverage are distinct immutable audit values and reconciliation detects mismatch;
- canonical exact `"1000"` starting equity and `"10000"` initial gross
  exposure carry authoritative valuation UTC timestamp/source; gross exposure
  equals absolute position notionals plus worst-case executable active orders;
  positive and negative activation/reconciliation cases cover every mismatch;
- a single typed/audited consumer-owned RiskGate executes before every exchange
  action in live, paper and backtest modes, validates leverage/exposure/
  concentration/drawdown/price/quantity/balance/kill-switch state, and negative
  architecture/E2E fixtures prove an invalid action makes zero adapter calls;
- live startup accepts only unknown versioned DTO input, fully guards it once,
  stores an immutable snapshot, reads environment once, has no defaults or
  automatic repair, and fails closed without credentials/operator confirmation;
- D-04 data ingestion accepts only public provider discovery/metadata and actual
  `fetchOHLCV` preflight under `ResearchDataContract@1`; missing capability,
  invalid range, silent fallback, private/account/credential/order/cancel/
  borrow/margin/paper/live access, JS-number canonical loss, pagination/retry
  overflow, gap/duplicate/finality failure, or atomic-write failure blocks
  ingestion/backtest; and deterministic offline E2E makes zero provider calls;
- D-04 wrapper/authority tests reject non-primitive/confusable/prototype provider
  IDs, inherited/unknown catalog lookup, raw CCXT escape, dynamic/bracket method
  calls outside the audited factory, `Reflect`/`Proxy`/`eval`/`Function`, private
  property access, generic forwarding, and private/order/cancel paths;
- D-04 rate/cost tests require endpoint/region/terms/rate/request/page/time/
  retry/cost dry-run fields, reject paid/material-cost or credential paths and
  unbounded/automatic/background calls, and prove CI/test paths have no network;
- stable client order IDs remain identical across retries and uncertain state
  reconciles before further operation; and
- reduce-only/emergency exit retains the immutable active-session configured leverage and cannot bypass unrelated guard checks.

## Review closure procedure

After the final full gate, a `terra_reviewer` independently examines objective,
diff, target architecture, tests/coverage, exact-numeric/data/live boundaries,
security/dependencies, release artifacts, and evidence. A
`luna_process_reviewer` independently examines routing, brief accuracy, scope,
ownership, approvals, failures/retries, and required reviews. Every valid
finding is fixed by a non-review implementer and both reviews are independently
rerun. Final status is PASS only with zero open valid findings.

## Active validation records

The active detailed validation record is split without deletion to keep each ledger file within the 500-line limit.

- [Validation records, part 1](validation-records/part-01.md)
- [Validation records, part 2](validation-records/part-02.md)
