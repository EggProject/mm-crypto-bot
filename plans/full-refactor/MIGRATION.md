# Phased Migration Plan — DRAFT

**Status:** DRAFT. All decision gates are approved; execution remains sequential
and blocked by each phase's implementation, validation, and review evidence.

## Coordination and ownership rules

Each implementation phase has one writer for each file/package. Parallel work
is permitted only for independent, non-overlapping owned paths; moves and their
consumer updates have a single coordinator-controlled owner. The writer records
the task class, model route, write authority, changed paths, validation, and
rollback point. A review agent never edits its own reviewed change.

No phase may preserve legacy production code or create a compatibility shim to
avoid a migration. Characterization tests may remain only until their covered
behavior has been replaced by approved target behavior and then must be removed.

## Phase 0 — Decision and inventory gate

**Entry:** this draft exists; no approved implementation yet.

**Work:** record the approved D-01 through D-09 decision ledger; generate a machine-readable
inventory of packages, imports, scripts, runtime/config/data paths, docs,
generated outputs, tests, package licenses, file lengths, and public CLI/API
contracts. Record the exact Bun, Node, OS, architecture, lockfile, and commit.

**Exit:** approved target package graph, hook policy, release targets, and
external runtime contract. Every removal candidate has a consumer search and
behavioral characterization plan. `APPROVALS.md` contains an exact approval
quote/reference, Budapest timestamp, approver, scope, selected/rejected options,
governing-patch state, validation, and rollback for every required decision.

**Validation:** `git status --short`; `rg --files`; `bun --version`; `node
--version`; `git rev-parse HEAD`; `bun pm ls --all`; `rg -n "mm-bot|bin/|run-bot|workspace:\*"`.

**Rollback:** no repository change beyond approved planning artifacts.

## Phase 1 — Guardrails and reproducible toolchain

**Entry:** D-01, D-03, and D-06 are approved. The Phase 1 official
compatibility audit has recorded Bun `1.3.14`, TypeScript `6.0.3`, and initial
Node `24.19.0`/`linux-x64` target evidence; exact frozen-install, lifecycle,
peer, and runner evidence still must be produced before changing manifests or
the governing hook rule.

**Work:** execute only this safe atomic sequence: (1) exact runtime metadata;
(2) lint/format/Lefthook plus the separately reviewed D-01 governing patch;
(3) compatible toolchain-runner patch versions, including verified
`@eslint/js` `10.0.1`/`eslint` `10.8.1` peer compatibility and Unicorn `73.0.0`;
and (4) separately tested pure
`protobufjs`/`smol-toml` minor updates. Do not perform a blanket update. CCXT,
Zod, and `fraction.js` are excluded from Phase 1 and use the guarded
cross-phase migrations below.
Establish pinned Bun, frozen lockfile, flat strict ESLint,
`--max-warnings=0`, Prettier, `format`/`format:check`, approved hook mechanism,
safe allowlisted `clean:artifacts`, architecture/file-length checks, and a
clearly incomplete `verify:foundation` task. Establish CI that runs the
foundation task (clean install, format, lint,
typecheck, build, separate unit/E2E coverage, dependency/license/security
checks, and artifact smoke checks.

**Tests:** tool configuration tests, hook subprocess tests, lint/format fixture
fixtures, and a negative artifact-clean test that proves data/state/unknown
untracked files survive. Do not run destructive cleaning against uninspected
paths.

After the exact trust decision and frozen install, run `lefthook install` only
inside a temporary isolated Git clone/repository. Inspect its generated hook
path/content/launcher and execute a real pre-commit subprocess E2E proving
`ESLint -> Prettier -> clean:artifacts -> worktree inspection`, fail-fast, and
exit propagation. This is the automated/evidence path; it never mutates the
main worktree. Separately, developer bootstrap documentation instructs a human
in their own clone, after a successful frozen install, to run
`./node_modules/.bin/lefthook install` (the documented exact repo-local
equivalent), inspect the generated hook, and deterministically uninstall then
reinstall it when needed. Bootstrap is not automatic postinstall, CI, or agent
evidence without separate authority. CI performs configuration/pipeline
validation only and never installs Git hooks. Bootstrap smoke plus negative
tests cover absent/untrusted binary and no automated mutation of the main
worktree `.git/hooks`.

**Exit:** toolchain checks are deterministic, have no network requirement in
test execution, `verify:foundation` is explicitly limited to implemented
foundation gates, and the future complete `bun run verify` remains pending until
all planned gates exist. The frozen install re-inspects Lefthook
lifecycle/binary metadata and records the minimal trust decision: only `ccxt`;
Lefthook is intentionally untrusted. `lefthook install` activation succeeds only in the
isolated temporary repository for automated evidence; the main worktree
`.git/hooks` has zero automated-evidence mutation. The separately documented
human bootstrap contract is required before a developer activates hooks in
their own clone.

**Rollback:** revert only this phase's tool/config commit; keep a known-good
lockfile and exact command output.

## Phase 2 — Foundations and exact boundary contracts

**Entry:** Phase 1 passes; D-08 is approved.

**Work:** move the approved reusable material from `temp/ts/typeguard`,
`temp/ts/typing`, and `temp/ts/assert` into dedicated packages; create
`numeric` and `logging`; remove/reject `temp/ts/rxjs`; define immutable DTO,
guard, error/result, UTC-clock, audit-event, canonical-string, and provenance
contracts. Decompose files greater than 500 lines by responsibility while
migrating their tests.

Only after exact arithmetic/property and numeric public-API evidence passes,
make `fraction.js` `5.3.4` a separate atomic Phase 2 dependency change owned by
`@mm-crypto-bot/numeric`. It must not be added merely to enable a later phase.

**Terminal migration checks:** after consumer migration, package-public-export
and reference searches must show no consumer of `temp/ts/assert`,
`temp/ts/typeguard`, or `temp/ts/typing`; `temp/ts/rxjs` has zero allowed
runtime consumers. Run an exact `rg -n` reference inventory before removal and
again after removal, retaining only the relocation manifest as evidence. The
phase exit includes `test ! -e temp/ts/assert`,
`test ! -e temp/ts/typeguard`, `test ! -e temp/ts/typing`, and
`test ! -e temp/ts/rxjs` only after an approved atomic removal, plus a manifest
of moved source/test paths and data-related assets.

**Tests:** compile-time type tests; guard/property tests with seeded generators;
exact arithmetic/tick/lot canonicalization tests; logger redaction,
backpressure, schema, and critical-event tests; public export contract tests.

**Exit:** foundation package coverage is 100% at required unit/E2E scopes and
no runtime consumer imports removed path aliases or `temp/` code.

**Rollback:** restore old package ownership only by reverting the atomic phase
commit; no dual paths or re-export compatibility layer.

## Phase 3 — Trading and data domain migration

**Entry:** Phase 2 passes; D-04 and D-05 are approved.

**Work:** split `core`, `backtest`, and `shared` into approved domain packages.
Migrate exact financial values, order/risk/lifecycle state machines, ports,
OHLCV schema, manifests, provenance, injected data root/clock/logger, and
backtest input recording. Rename test files by feature/behavior, not `phaseXY`.

Only after DTO/guard boundary consumers have migrated and their negative/public
contract tests pass, update or remove Zod as a separate atomic Phase 3 breaking
boundary change (`3.25.76 -> 4.4.3` if retained). This has no dependency on
Phase 4 or Phase 5 wiring.

Implement D-04's research-only CCXT Pro adapter through the provider factory
and `ResearchDataContract@1` preflight. It allows only public discovery/market
metadata and `fetchOHLCV` against an approved provider/range; watch/cache-only
evidence is insufficient, silent fallback is forbidden, and provider/range
failure blocks ingestion/backtest. Preserve raw exact strings before canonical
conversion; validate bounded pagination/retry/rate-limit, gap/duplicate/finality
status, provenance and atomic writes. No network provider preflight runs in CI.

**Required accounting and gate tests:** construct canonical exact
`StartingEquityUsdEquivalent("1000")` and
`InitialGrossExposureUsdEquivalent("10000")` only with authoritative valuation
UTC timestamp/source; test positive activation and negative missing/mismatched
valuation cases. Verify gross exposure equals absolute position notionals plus
worst-case executable active-order notionals, while equity, balances, signed net
exposure, selected/venue maximum leverage, actual borrow, and effective leverage
remain non-interchangeable. Define and test one typed/audited consumer-owned
RiskGate before every live, paper, and backtest exchange action, with negative
architecture fixtures and E2E zero-adapter-call proof.

**Required safety tests:** all non-10x/range/default/dynamic values reject;
stale/ambiguous/unsupported account and data reject; invalid tick/lot reject;
market-data gap/out-of-order/stale values block a symbol; no-lookahead and
deterministic seeded property tests pass.
Provider tests use deterministic fakes and negative fixtures for unavailable
provider, missing `fetchOHLCV`, invalid range, silent fallback, private/account/
credential/order/cancel/borrow/margin/paper/live method prohibition, and
raw-to-canonical JS-number loss. Offline network-guard E2E proves that backtests
consume manifests and do not call a provider.
Rate/cost contract tests reject a missing public-free/no-credential declaration,
missing endpoint/region/terms/rate/request/page/time/retry budget, paid/material
cost indication, automatic/background invocation, and an unbounded request.

**Exit:** shared strategy/risk/domain code is used by live, paper, and backtest
composition; each remains adapter-specific only at I/O boundaries. The D-04
`PublicHistoricalClient` has fail-closed, no-network deterministic contract,
provider-authority, and raw-escape negative evidence ready for the independent
post-Phase-4 CCXT decision; no dependency update is made by this exit itself.

**Rollback:** revert the approved atomic domain migration commit. Never retain
both legacy and target decision paths.

## Phase 4 — Bybit EU and paper execution adapters

**Entry:** Phase 3 passes; live acceptance specification is approved.

**Work:** replace `exchange` with `exchange-bybiteu`; replace paper behavior
with `execution-paper`; prohibit any other live venue/endpoint/product prior to
submission. Implement the `SelectedLeverage10x` construction and authenticated
pre-submit validation/reconciliation boundary. Separate selected leverage,
actual borrowed amount, and effective leverage in audit events.

Live configuration begins as an unknown versioned DTO, is fully guarded once at
startup, becomes an immutable snapshot, and is never repaired/defaulted or
reread from environment during live operation. Explicit credentials and operator
confirmation are mandatory. Startup fails closed on every missing/invalid value.

**Tests:** deterministic fake authenticated Bybit EU adapter tests for account,
UTA Spot Margin, asset/symbol, margin mode, successful 10x selection,
borrowing capacity, stale evidence, ambiguity, retries/stable client order IDs,
reconciliation, reduce-only and emergency exit. Property, integration, and E2E
tests must prove `submitOrder` was never called for every invalid condition.
Unit, integration, and startup E2E tests cover unknown DTOs, unknown fields,
failed guards, environment-read-once behavior, immutable snapshots, absent
credentials/operator confirmation, and no live default/auto-repair.

**Post-exit dependency guard before Phase 5:** after this phase's Bybit EU
safety evidence and the Phase 3 `PublicHistoricalClient` fail-closed,
no-network D-04 contract evidence both pass, CCXT `4.5.70` may be considered
only as one separate atomic dependency change. Its entry evidence is solely
those completed P3/P4 proofs; it must complete before Phase 5 wiring and has no
dependency on Phase 5.

**Exit:** no code/config semantics exposes a max/range/default/dynamic selected
leverage for live execution; live adapter supports only required EU endpoint.

**Rollback:** disable live composition by fail-closed configuration and revert
the single phase change. Never deploy a partial live adapter.

## Phase 5 — Applications, CLI and configuration relocation

**Entry:** Phase 4 passes; the separate guarded CCXT migration is either not
needed or has passed before wiring; D-02, D-04, D-07, and D-08 are approved.

**Work:** make `search-best-config` an approved `apps/config-search` workspace
application and make `apps/bot` a thin composition/CLI application. Remove
`bin/mm-bot`, package `bin`, root alias scripts, `postinstall`, and all alias
documentation. Move `run-bot` inputs to the approved external runtime layout;
track only safe, redacted examples and schemas. Replace all `phaseXY` tests
with feature/layer names.

**Terminal migration checks:** after an approved move/removal, run `test ! -e
run-bot`, `test ! -e search-best-config`, and `test ! -e bin`. Search code,
configuration, operational documentation, scripts, package manifests, tests and
root commands for `run-bot`, `search-best-config`, `bin/mm-bot`, `mm-bot`, and
the `bin` alias field. No textual, executable, configuration, operational, or
documentation reference remains. The final reference check is an exact `rg -n`
inventory with no legacy exception. The absence checks prevent `bin/` being
left empty or repopulated. The approved external-path contract has dedicated
absence/presence tests.
Record a manifest for relocated config/data/search outputs and verify config
search output remains under `data/backtests/config-search/<run-id>/`.

**Tests:** CLI contract/golden tests, config rejection tests, application
composition tests, configuration-mount absence/presence tests, and negative
search tests proving result PnL/DD null semantics are retained rather than
fabricated. Every migrated behavior receives a fails-before/passes-after
regression test where a defect is repaired.

**Exit:** workspace discovery includes both applications; no remaining alias or
in-repo operational config consumer; search outputs go only below
`data/backtests/config-search/<run-id>/`.

**Rollback:** restore only from the approved phase commit; users retain an
explicit migration guide, not a compatibility executable.

## Phase 6 — Scripts, release, documentation, and hygiene

**Entry:** Phases 1–5 pass; D-03, D-07, and D-09 are approved.

**Work:** execute the approved script disposition; build reproducible release
ZIPs and offline smoke tests; rebuild docs in English and Hungarian Markdown;
delete existing legacy documentation/assets/references in the same atomic docs
replacement change; build the local-asset HTML site from Markdown source; add
navigation, accessibility, language switching, search index, and link checks.
Git history is the only historical record. Do not create an archive, filter,
compatibility marker, or committed intermediate legacy path. This removal does
not include standards-protected formal reports below `data/reports/`.

The site icon policy permits only local assets with a source/license inventory;
no CDN is allowed. Every meaningful icon has localized alt/ARIA text, decorative
icons are marked decorative, HU/EN navigation/content parity is tested, and
HTML interaction/accessibility evidence is retained.

**Tests:** script contract tests; release metadata/hash/SBOM/license/audit
tests; two clean-build identical-byte/hash tests; clean temporary offline
extraction/run tests; docs language-pair,
navigation, no-external-asset, and link-check tests; visual/interaction E2E
and accessibility tests for the HTML site. Add semantic zero-legacy scanner
configuration/allowlist tests and negative fixtures proving evidence-only
`plans/full-refactor/**`, governing files, and protected formal reports cannot
be imported, executed, configured, routed, or served.

**Exit:** every deployable app releases a documented, runnable ZIP for each
approved target; documentation is current; `test ! -e docs/legacy` passes; and
inventory/reference checks show zero legacy code/docs/assets/references while
separately proving protected `data/reports/` were not removed. The semantic
scanner reports no legacy files/directories/imports/exports/routes/commands/
runtime/config/current-doc references/served assets/compatibility shims within
its declared terminal target roots.

**Rollback:** do not publish. Remove only generated ignored artifacts; revert
the atomic docs replacement change if smoke/links fail. Do not restore a legacy
archive or compatibility layer; formal reports remain protected.

## Phase 7 — Closure

**Entry:** all preceding phase evidence is complete; D-07 is approved; Phase 6
semantic zero-legacy scanner evidence is current; and the protected
`data/reports/` inventory/non-deletion evidence is current.

**Work:** run full clean verification, inspect exact coverage scopes, perform
independent Terra technical and Luna process reviews, fix every valid finding,
and obtain independent re-reviews.

**Exit:** zero open valid findings, all evidence current to final commit, D-07
semantic zero-legacy proof is current, and no requested acceptance item is
merely inferred.

**Rollback:** retain final release/validation manifests; if a release issue is
found, stop deployment, use the artifact rollback procedure, and reopen review.
