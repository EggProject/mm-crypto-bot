# Decision Register — DRAFT

All D-01 through D-12 below are **APPROVED** within their exact records in
`APPROVALS.md`. Approval does not bypass required implementation, compatibility,
validation, supply-chain, review, or live safety gates.

| ID   | Decision needed                                                   | Coordinator recommendation                                                                                                                                                                                                                                                                                                                                                                                                    | Why approval is required                                                                                                                                                                                  | Acceptance record                                                                                                                                            |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-01 | APPROVED: Lefthook policy                                         | Replace governing Husky+lint-staged with Lefthook preserving ESLint -> Prettier, allowlisted artifact cleanup, then worktree inspection.                                                                                                                                                                                                                                                                                      | Governing semantics and developer workflow change.                                                                                                                                                        | Actual approved standards patch and independent validation still required.                                                                                   |
| D-02 | APPROVED: external runtime root                                   | `MM_CRYPTO_BOT_RUNTIME_ROOT` is operator-supplied absolute root; retain only redacted schemas/examples in repo/release.                                                                                                                                                                                                                                                                                                       | Runtime location, secrets, data handling, deployment operation.                                                                                                                                           | External-path contract and offline smoke evidence.                                                                                                           |
| D-03 | APPROVED: Node release matrix                                     | The Phase 1 official compatibility audit selected Node.js **`24.19.0`** LTS full bundle for every initial app/target on `linux-x64`; add `linux-arm64` only after reproducible target proof. Bun `1.3.14` remains pinned workspace/build tooling.                                                                                                                                                                             | Runtime compatibility, support/cost/platform promise.                                                                                                                                                     | Recorded Node/Bun evidence, exact target matrix, deterministic dual-build/artifact tests.                                                                    |
| D-04 | APPROVED: CCXT Pro provider scope for research/backtest ingestion | An explicit operator may invoke a public-free/no-credential historical provider preflight/ingestion only when `fetchOHLCV`, `ResearchDataContract@1`, and endpoint/region/terms/rate/request/page/time/retry/cost dry-run budgets succeed. No silent fallback; every failure blocks ingest/backtest. Planning/CI/tests/automatic paths have no provider network authority; all backtests consume offline canonical manifests. | Bounded data scope; no provider gains credentials/account/order/borrow/margin/paper/live authority, no paid/material-cost endpoint is approved, and external data never proves Bybit EU live suitability. | Wrapper/AST negative tests, rate-cost contract tests, deterministic fake/provider-negative tests, provenance/manifest validation, offline network-guard E2E. |
| D-05 | APPROVED: paper/backtest margin semantics                         | Define separately named `SimulationMarginModel`, physically/type-separated from the global/session configured selected leverage. D-11 supersedes only the former fixed-ten-only `SelectedLeverage10x` label.                                                                                                                                                                                                                  | Trading/risk semantics.                                                                                                                                                                                   | Negative tests.                                                                                                                                              |
| D-06 | APPROVED: `workspace:*` semantics                                 | Use only internal Bun workspace linkage; every external dependency exact-pinned.                                                                                                                                                                                                                                                                                                                                              | Dependency semantics and release/publish policy.                                                                                                                                                          | Frozen-lock evidence.                                                                                                                                        |
| D-07 | APPROVED: zero-legacy final repository                            | Delete existing historical/current legacy docs/assets/references in the same atomic docs replacement change. Git history is the only history; do not create `docs/legacy` or compatibility markers.                                                                                                                                                                                                                           | User selected zero legacy. Protected formal reports under `data/reports/` remain governed by standards and are not this removal target.                                                                   | Full inventory/reference absence checks, `test ! -e docs/legacy`, docs/site validation, and protected-report inventory.                                      |
| D-08 | APPROVED: package names and target graph                          | Adopt the current `ARCHITECTURE.md` names/graph, including `market-data-ccxt`; no compatibility/legacy package.                                                                                                                                                                                                                                                                                                               | Public APIs and broad migration scope.                                                                                                                                                                    | Architecture package contracts.                                                                                                                              |
| D-09 | APPROVED: bilingual site generator                                | Deterministic Markdown -> offline multipage HTML with local assets/icons, HU/EN parity, no CDN.                                                                                                                                                                                                                                                                                                                               | Tool dependency, documentation build semantics and maintenance cost.                                                                                                                                      | Exact generator still requires official compatibility/supply-chain and reproducibility evidence.                                                             |
| D-11 | APPROVED: configurable global/session selected leverage           | Configure one exact canonical global/session selected leverage, default exactly 10x, immutable during the active session; activation and every order require current authenticated Bybit EU proof of venue support and equality with the configured value. No rounding, fallback, dynamic, per-strategy, per-symbol, or per-order selection; configuration reload is out of scope.                                            | Live trading/risk semantics.                                                                                                                                                                              | D-11 supersedes only fixed-ten-only portions; preserves default, immutability, equality, and fail-closed behavior.                                           |
| D-12 | APPROVED: commit-first actual-diff review sequence                | After scoped precommit gates, create an exactly staged atomic commit; TECH and PROCESS review the actual commit diff/range. Fix each valid finding in a follow-up commit and independently re-review the full range before completion, push, or PR.                                                                                                                                                                           | Review evidence, scope integrity, and release control.                                                                                                                                                    | D-12 supersedes review-before-commit ordering only; preserves staging, roles, and finding resolution.                                                        |

## Immutable constraints, not open alternatives

The following are binding target constraints and cannot be weakened by this
register: only `bybiteu`/`https://api.bybit.eu` for live execution; one exact
canonical global/session selected-leverage value that defaults exactly to 10x,
is immutable for an active session, and equals the current authenticated
venue-supported actual selected leverage at each activation and order; current
authenticated account-eligibility, margin, borrow, and selected-leverage
evidence; exact financial values; fail-closed behavior; and no secret in code,
fixtures, logs, docs, or artifacts.

## Decision process

Each accepted decision must name the chosen option, rationale, risks, migration
owner, validation, rollback trigger, and approval timestamp. Rejected proposals
must remain documented so later work does not silently reintroduce them.

## D-11 acceptance record

**Status:** APPROVED on 2026-08-31 (Europe/Budapest), approver: user.

**Exact approval.** `leverage -t is megbeszeltuk mar hogy default 10 de beallithato!`

**Chosen option.** One configurable global/session selected-leverage value is
an exact canonical value and defaults exactly to 10x. It is immutable for the
active session. At live activation and immediately before every live order, a
current authenticated Bybit EU response must prove that the venue supports the
configured value and that its actual selected leverage equals that value.
Missing, stale, ambiguous, invalid, unsupported, or unequal evidence fails
closed. Configuration reload and a change to the active-session setting are out
of scope.

**Supersession.** D-11 supersedes only fixed-ten-only portions of D-01 through
D-10, including the former `SelectedLeverage10x` name in D-05. It preserves the
exact default 10x, exact canonical representation, active-session immutability,
authenticated equality, and live fail-closed requirements. It neither changes
the USD `1000` equity baseline nor the USD `10000` initial gross-exposure
target.

**Rationale.** The user explicitly confirmed that 10x remains the default but
selected leverage is configurable. Separating that setting from actual and
effective leverage keeps the live evidence boundary auditable.

**Rejected alternatives.** Rounding, truncation, approximation, implicit
coercion, lossy serialization, fallback, range/cap behavior, automatic or
dynamic selection, and per-strategy, per-symbol, or per-order values are
rejected. Configuration reload is not approved in this scope.

**Risks.** A configuration value, authenticated response, or equality check can
be invalid, stale, ambiguous, unsupported, or mismatched. Any such condition
must block activation/order submission; local configuration, cache, CCXT
capabilities, and prior orders are not proof.

**Migration owner and scope.** A separately scoped live selected-leverage
configuration and order-boundary implementation owns the behavior. This
decision record changes no runtime code and grants no live activation or order
authority.

**Required validation.** Deterministic public-boundary tests must prove exact
canonical parsing, default exactly 10x, active-session immutability, current
authenticated venue support and equality at activation/order, no exchange
submission on each invalid evidence case, and independent technical/process
review. No result may claim implementation PASS or live readiness before those
gates pass.

**Rollback trigger.** Revert an affected implementation atomically if it cannot
prove the selected-value, authenticated-equality, or fail-closed contract. Do
not restore fixed-ten-only semantics or an unsafe alternative without new user
approval.

## D-12 acceptance record

**Status:** APPROVED on 2026-08-31 (Europe/Budapest), approver: user.

**Exact approval.** `commit az elso es annak a diff-je alapjan kell reviezni! ... commitoljatok!`

**Chosen option.** The coordinator first runs scoped precommit gates and then
creates an exactly staged atomic commit. Independent TECH and PROCESS reviews
inspect that actual commit diff or an explicit actual candidate range. Each
valid finding requires a follow-up commit. Before completion, push, or PR, the
reviewers independently re-review the full range containing the original and
follow-up commits.

**Supersession.** D-12 supersedes review-before-commit ordering only. It
preserves precommit gates, exact staging, independent reviewer roles, and the
requirement that every valid finding is fixed and re-reviewed.

**Rationale.** Reviewing an immutable commit diff/range makes the reviewed
object, scope, and follow-up sequence auditable despite unrelated dirty files.

**Rejected alternatives.** Treating a mutable working-tree diff or a
review-before-commit pass as the final review gate, mixing unrelated files into
the commit, omitting a follow-up commit, and completing, pushing, or opening a
PR before full-range re-review are rejected.

**Risks.** A first commit can require remediation. The range remains incomplete
until all valid findings are committed and independently re-reviewed; no open
finding may be waived as a delivery risk.

**Migration owner and scope.** The coordinator owns scoped precommit evidence,
exact staging, commits, range selection, and review orchestration. This does
not authorize a subagent to stage, commit, review its own work, push, or open a
PR.

**Required validation.** Record the precommit gates, exact staged paths,
commit hash/stat, review findings against the actual commit/range, each
follow-up commit, and independent full-range TECH/PROCESS re-review before
completion, push, or PR.

**Rollback trigger.** Revert a defective scoped commit atomically using exact
staging and rerun the applicable range review. Broad staging, review waiver,
and a mutable-worktree final review are not rollback alternatives.
