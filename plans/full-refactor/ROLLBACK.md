# Rollback Plan — DRAFT

**Status:** DRAFT. Rollback execution remains controlled by the approved phase
contract and fail-closed emergency procedure; no rollback action is performed by
this plan.

## General rules

- Each phase is committed only after its entry/exit evidence; no mixed broad
  migration commit. Retain commit SHA, lockfile hash, validation output, and
  artifact manifest for every phase.
- C4b numeric rollback is atomic: remove `@mm-crypto-bot/numeric` and its exact
  `fraction.js` lock resolution together, restoring the preceding audited lock
  state. Do not substitute numeric libraries, introduce a compatibility alias,
  or add number conversion, truncation, or rounding during rollback.
- Do not reintroduce a legacy production implementation or compatibility shim
  as a rollback. Roll back to the previously approved atomic state instead.
- Do not restore a documentation archive or `docs/legacy` as a rollback. The
  user-approved zero-legacy requirement applies to code, docs, assets and
  references; formal reports protected under `data/reports/` are not a removal
  target and remain subject to the governing standard.
- Never delete user runtime data, logs, reports, secrets, or unknown untracked
  files. `clean:artifacts` is allowlisted and excludes those locations.
- A live safety uncertainty means fail closed: block new risk-increasing orders,
  reconcile authenticated exchange state, preserve audit evidence, and use the
  separately tested reduce-only/emergency path only where valid.

## Trigger-to-action matrix

| Trigger                                                    | Immediate containment                                                                                                              | Recovery evidence                                                                        | Resume condition                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Lint/type/build/unit failure                               | Stop phase merge.                                                                                                                  | Targeted diagnosis and reverted/repair diff.                                             | Relevant phase gates pass.                                                                            |
| E2E/coverage scope failure                                 | Stop completion claim.                                                                                                             | Separate unit/E2E reports identify missed runtime owner.                                 | Both reports show 100%.                                                                               |
| Dependency/audit/license failure                           | Freeze lockfile change; do not release.                                                                                            | Official advisory/license disposition.                                                   | Approved replacement and clean audit.                                                                 |
| Guarded fraction/Zod/CCXT migration failure                | Revert only that dependency's atomic phase change; do not advance to its dependent phase or substitute a fallback library/version. | Preserved phase-entry arithmetic/DTO or P3/P4 adapter safety evidence and lockfile diff. | The same scoped phase evidence and frozen audit pass under the replacement candidate.                 |
| Artifact offline smoke failure                             | Do not copy/publish ZIP.                                                                                                           | Rebuilt manifest/hash and clean extraction run.                                          | Every approved target smokes cleanly.                                                                 |
| Non-identical clean artifact builds or Node-patch mismatch | Do not copy/publish ZIP.                                                                                                           | Preserved paired build manifests, hashes and launcher output.                            | Identical bytes/hash and exact runtime check pass.                                                    |
| Docs link/site failure                                     | Do not designate docs authoritative.                                                                                               | Link/interaction report.                                                                 | Both language trees and site pass.                                                                    |
| Icon licence/accessibility evidence failure                | Do not designate site authoritative.                                                                                               | Local source/license inventory and accessibility output.                                 | No CDN, complete inventory and parity pass.                                                           |
| Live verification failure                                  | Fail closed; no new order submission.                                                                                              | Authenticated Bybit EU reconciliation/audit diff.                                        | All exact-10x/eligibility/borrow evidence current and complete.                                       |
| Baseline/RiskGate/config lifecycle failure                 | Fail closed; no new risk-increasing action.                                                                                        | Exact valuation/accounting audit, gate decision and immutable config snapshot evidence.  | Required positive/negative activation and zero-adapter-call tests pass.                               |
| Research provider/preflight/provenance/authority failure   | Block ingestion and dependent backtest; do not fallback, escape the wrapper, or contact private/paid endpoints.                    | Preserve contract/preflight/manifest error and partial data quarantine.                  | Public wrapper `fetchOHLCV`, rate-cost/authority/finality/gap/duplicate/provenance validation passes. |
| Suspected secret/data leak                                 | Quarantine artifact/log; stop sharing.                                                                                             | Secret removal/rotation coordinated by owner; evidence redacted.                         | Security review passes.                                                                               |

## Release rollback contract

Each ZIP manifest identifies app, semantic version, commit, lockfile hash,
Bun/build version, selected Node runtime, target OS/architecture, SHA-256s,
SBOM reference, external config schema version, and smoke result. A rollout may
only move back to the most recent manifest whose target smoke and verification
evidence are PASS. The external runtime root and user data stay untouched.
