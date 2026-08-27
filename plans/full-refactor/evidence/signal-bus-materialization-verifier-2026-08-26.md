# SignalBus Materialization Verifier Evidence

## Scope and authority

- Approved slice: a separate root `scripts/tooling` verifier prerequisite for the SignalBus draft. It adds no hook/CI,
  package-manifest, runtime/trading, network, staging, or commit change.
- Cooperative local build/process threat model: the sole materialization writer has stopped; no malicious or concurrent
  actor mutates toolchain root, manifest, or candidate tree during one invocation. Unsafe paths, ordinary symlinks, and
  malformed/unexpected Git state observed at inspection time fail closed.
- Explicit user decision: no kernel-enforced hostile-concurrent-filesystem-mutation guarantee is required. `openat2`, a
  native addon, immutable producer handoff, and descriptor protocols are out of scope. Runtime configuration changes
  need a separate validated reload design.
- Current base/HEAD: `98894a16f0337b1aa319778ae22babe100683a1a`; worktree: `<isolated-integrated-worktree>`; branch:
  `codex/signal-bus-materialization-integrated`.
- Current evidence update classification: `signal_bus_integrated_digest_evidence`; documentation/governing evidence;
  write; governing-semantics trigger; non-review; requested `terra_worker` route with profile-pinned
  `gpt-5.6-terra` / high; effective runtime route, model, and effort are not observable. It has workspace-write authority,
  no external or mutable resource, no fallback/escalation, staging, commit, or self-review. Its exclusive authority is
  exactly the three documentation/evidence files.

## Integrated prerequisite and chronology

- The former SignalBus candidate was based at `5a5c10bd12bef01ba756549fd61a93921438cb33`; every SignalBus review and
  gate record tied to that identity is historical only. Its nonzero ten-diagnostic global typecheck result is likewise
  historical and must not be used as current evidence.
- The current base `98894a16f0337b1aa319778ae22babe100683a1a` is `fix(tooling): repair bot typed lint test`. It changed only
  `scripts/tooling/eslint-bot-typed-project.test.ts`, repairing the former TypeScript 6 typed-lint diagnostics with
  `isRecord`, `ParseConfigFileHost`, and bracket access. The prerequisite received TECH PASS and PROCESS PASS after its
  SHA-256-versus-Git-SHA-1 evidence correction. It does not modify the SignalBus tooling behavior.
- A fresh integrated TECH finding proved that a history request for ABC returned the digest of a later DEF
  materialization: the full manifest was correctly validated, but the requested brief was discarded for the result. The
  TDD remediation keeps full-manifest validation and closure, returns only the requested brief's latest valid
  materialization digest, and keeps a nonmaterialized requested brief and every partial complete-manifest traversal as
  `history-incomplete`. Its RED included both the two-brief ABC/DEF result and a multi-file ABC intermediate sequence;
  the focused history suite is GREEN at 22/22.
- After that remediation, the integrated SignalBus candidate passed its Node V8 focused suite (4 files, 179/179;
  statements 638/638, branches 466/466, functions 109/109, lines 526/526), global `bun run typecheck:coverage-tools`,
  owned strict ES2022 TypeScript, scoped zero-warning ESLint, Prettier, root `bun run build` (12/12), the built
  spaced-path malformed CLI regression, and whitespace/scope/secret/TODO scans. The current global typecheck is PASS
  with no baseline exception.
- The current documentation writer dispatch is recorded above. Its requested profile is a dispatch requirement, not proof
  of runtime selection; effective route/model/effort are `not observable`. Fresh final post-update Prettier, CLI,
  whitespace, scope, scan, and line-limit gates pass. The exact-identity TECH follow-up passed with zero findings; the
  PROCESS follow-up found one Medium stale-status finding, remediated in this snapshot. The next exact-identity TECH
  confirmation and PROCESS re-review are pending; if both pass, the coordinator may commit without another doc mutation.

## Exact scope and ownership ledger

Implementation scope (eleven paths):

```text
scripts/tooling/signal-bus-materialization-contract.ts
scripts/tooling/signal-bus-materialization-git.ts
scripts/tooling/signal-bus-materialization-verifier.ts
scripts/tooling/verify-signal-bus-materialization.ts
scripts/tooling/signal-bus-materialization-test-support.ts
scripts/tooling/signal-bus-materialization-repo-test-support.ts
scripts/tooling/signal-bus-materialization-contract.test.ts
scripts/tooling/signal-bus-materialization-candidate.test.ts
scripts/tooling/signal-bus-materialization-history.test.ts
scripts/tooling/signal-bus-materialization-history-merge.test.ts
scripts/tooling/vitest.signal-bus-materialization.config.mjs
```

Documentation/evidence scope:

```text
docs/superpowers/specs/2026-08-26-signal-bus-materialization-verifier.md
docs/superpowers/plans/2026-08-26-signal-bus-materialization-verifier.md
plans/full-refactor/evidence/signal-bus-materialization-verifier-2026-08-26.md
```

1. `signal_bus_verifier_plan` owned specification and plan.
2. `signal_bus_verifier_implementation` owned the original implementation set.
3. `signal_bus_verifier_coverage` and `signal_bus_verifier_format` owned transferred validation/format work.
4. `signal_bus_multi_parent_history_fix` owned the all-direct-parent implementation, the repository test-support split,
   and the dedicated merge test.
5. `signal_bus_verifier_tech_review` and `signal_bus_verifier_process_review` were historical independent reviews.
6. `signal_bus_history_base_rereview`, `signal_bus_final_identity_tech`, `signal_bus_final_process_pass`,
   `signal_bus_process_rereview`, and `signal_bus_process_rereview_final` are historical review receipts for the former
   candidate identity.
7. `signal_bus_integrated_tech_review` found the requested-brief digest defect; it is a valid integrated TECH finding,
   not a final TECH PASS.
8. `signal_bus_requested_brief_digest_fix` owned only the verifier and linear-history test TDD remediation.
9. This evidence update owns only the three documentation/evidence paths. Ownership is ordered; no worker self-reviewed
   or committed.

## Current artifact receipt

The following SHA-256 and physical-line receipt was measured in the integrated worktree after the requested-digest TDD
remediation and this evidence update. It covers the complete fourteen-file candidate; every file remains at or below 500
lines.

| Path                                                                             | Lines | SHA-256                                                            |
| -------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `scripts/tooling/signal-bus-materialization-contract.ts`                         |   307 | `fe067b842827db07f54544a234bd28ac90fc412af6a76057354cf95e6b1eb1e4` |
| `scripts/tooling/signal-bus-materialization-git.ts`                              |   474 | `53393588c221f749c758eb081582a5119cec1d318a65f7ba82d99432692dca78` |
| `scripts/tooling/signal-bus-materialization-verifier.ts`                         |   407 | `c40a5b3adf7fd664fbbf6a3cda496f03511b6588988112b9c988d329655198bc` |
| `scripts/tooling/verify-signal-bus-materialization.ts`                           |    95 | `552e6d1c2ad573cd948753344725eebd0e881ef074f60fec7bf6b9a23af58f3a` |
| `scripts/tooling/signal-bus-materialization-test-support.ts`                     |   319 | `39956d30f4ca7d6dbb6da0aa23905369a04a2f4ab6c49670c244f52fdc79a4c1` |
| `scripts/tooling/signal-bus-materialization-repo-test-support.ts`                |   260 | `3c95232d1e96bd66920db7e04cc4b08d2cd3e6bdaa245c68541ee6050fcde1a5` |
| `scripts/tooling/signal-bus-materialization-contract.test.ts`                    |   500 | `ff64a2c88f1c2d18b7297ae798a95067bdcd6ca931b5f9ea6a78715ff9cb8b45` |
| `scripts/tooling/signal-bus-materialization-candidate.test.ts`                   |   490 | `6a57aace32479a41498c8deb1d6efd50ee9ac98a9513d552f422a0dc28e8d4b7` |
| `scripts/tooling/signal-bus-materialization-history.test.ts`                     |   454 | `039d86ce48659023839515a115b9b3219894c9f6edd4804201b9fbc3b2b671f6` |
| `scripts/tooling/signal-bus-materialization-history-merge.test.ts`               |   486 | `dcb3c7718edb2c95efa7704d90ece4b736f3ded5aeb79065170ffabb3b22dce4` |
| `scripts/tooling/vitest.signal-bus-materialization.config.mjs`                   |    22 | `844dfdb99cbbc47e1254dfa902fb0a069f8207f839727d18e8e5860517e33168` |
| `docs/superpowers/specs/2026-08-26-signal-bus-materialization-verifier.md`       |   307 | `b6f18b3d7c4b5526a317a81741b558dfe6c855b6a21be00ea7e034c4cb5cd745` |
| `docs/superpowers/plans/2026-08-26-signal-bus-materialization-verifier.md`       |   195 | `0bba0f5d2d04c64df7186e867f58b8a711451a8767b2df6dbc8af3f2044c4a71` |
| `plans/full-refactor/evidence/signal-bus-materialization-verifier-2026-08-26.md` |   259 | Self-referential; reported in the handoff receipt.                 |

## Dispatch receipt ledger and closure boundary

The following records correct the process-review finding. A requested route/profile/model/effort is the dispatch request
and configured profile pin only. An effective runtime route/model/effort is a separately attested tool/provider result;
without that attestation it is exactly `not observable` and is never inferred from the request. `UNAVAILABLE/UNVERIFIED`
means no original dispatch receipt or provider/runtime observation is retained. Historical entries with that marker are
context only and are explicitly excluded from closure evidence. The former current TECH/PROCESS PASS receipts exist for
the integrated candidate before the receipt-only mutation. The subsequent exact-identity TECH review found one Medium
evidence-identity defect, so those PASS receipts do not close the mutated identity. No external or mutable resource was
used by a retained review.

### Historical unretained dispatches

- `signal_bus_verifier_implementation`: implementation/write; the original tooling ownership is later recorded, but exact
  paths, package count, domain risk, reasoning/resources, requested route/profile/model/effort, effective runtime
  route/model/effort, sandbox/write authority, fallback/escalation, validation, retries, and result receipt are
  UNAVAILABLE/UNVERIFIED. It was non-review and is
  excluded from closure.
- `signal_bus_verifier_coverage`: coverage/write; ownership, package count, domain risk, reasoning/resources,
  requested route/profile/model/effort, effective runtime route/model/effort, sandbox/write authority,
  fallback/escalation, validation, retries, and result receipt are UNAVAILABLE/UNVERIFIED. It was non-review and is
  excluded from closure.
- `signal_bus_verifier_format`: formatting/write; ownership, package count, domain risk, reasoning/resources,
  requested route/profile/model/effort, effective runtime route/model/effort, sandbox/write authority,
  fallback/escalation, validation, retries, and result receipt are UNAVAILABLE/UNVERIFIED. It was non-review and is
  excluded from closure.
- `signal_bus_multi_parent_history_fix`: multi-parent implementation/write; later ownership identifies the Git port,
  verifier, repository support, and merge suite, but its original package count, reasoning/resources,
  requested route/profile/model/effort, effective runtime route/model/effort, sandbox/write authority,
  fallback/escalation, validation, retries, and result receipt are UNAVAILABLE/UNVERIFIED. It was non-review and is
  excluded from closure.
- `signal_bus_verifier_tech_review`: historical technical review/read-only; scope, package count, domain risk,
  reasoning/resources, requested route/profile/model/effort, effective runtime route/model/effort, sandbox authority,
  fallback/escalation, independence, validation, and result receipt are UNAVAILABLE/UNVERIFIED. Its historical outcome is
  not a closure receipt.

### Historical dispatches and review receipts for the former 5a candidate

- `signal_bus_tech_pass_evidence`: historical documentation recording/write; exactly the three former-candidate documents, 0 packages,
  governing/process-evidence risk, no external or mutable resource. Requested route/profile/model/effort is
  `terra_worker`, `gpt-5.6-terra` / high; effective runtime route/model/effort is `not observable`. It had isolated
  workspace-write authority, no fallback/escalation, staging, or commit, and was non-review. It recorded
  `signal_bus_history_base_rereview` without self-review; document formatting and scope checks passed.
- `signal_bus_history_base_rereview`: historical final TECH review/read-only; exact 14 former-candidate paths, 0 packages,
  governing/evidence and history-integrity reasoning using retained local results only. Mandatory requested
  route/profile/model/effort is `terra_reviewer`, `gpt-5.6-terra` / high; effective runtime route/model/effort is
  `not observable`. It had read-only isolated-worktree authority and no fallback/escalation. It was independent, dated
  2026-08-27, validated the then-current evidence, and returned zero findings.
- `signal_bus_final_process_pass`: historical final PROCESS review/read-only; exact 14 former-candidate paths plus the non-candidate SDD
  ledger, 0 packages, governing/process-evidence reasoning using retained local records only. Mandatory requested
  route/profile/model/effort is `luna_process_reviewer`, `gpt-5.6-luna` / medium; effective runtime route/model/effort
  is `not observable`. It had read-only isolated-worktree authority and no fallback/escalation. It was independent, dated
  2026-08-27, and returned FAIL with four valid findings: dispatch records, TECH reproducibility, chronology, and
  tooling-count cardinality.
- `signal_bus_process_rereview`: historical final PROCESS re-review/read-only; exactly the three former-candidate documentation/evidence
  paths and the non-candidate SDD ledger, 0 packages, governing/process-evidence reasoning using retained local records
  only. Requested
  route/profile/model/effort is `luna_process_reviewer`, `gpt-5.6-luna` / medium; effective runtime route/model/effort is
  `not observable`. It had read-only isolated-worktree authority and no fallback/escalation. It was independent, dated
  2026-08-27, and returned FAIL with one Medium finding: requested/profile-pinned values were claimed as effective runtime
  values.
- `signal_bus_process_rereview_final`: historical final PROCESS re-review/read-only; exact 14 untracked former-candidate paths (11 tooling
  plus 3 documentation/evidence paths) and the evidence-only SDD ledger, 0 packages, from base
  `5a5c10bd12bef01ba756549fd61a93921438cb33`. Requested route/profile/model/effort is `luna_process_reviewer`,
  `gpt-5.6-luna` / medium; effective runtime route/model/effort is `not observable`. It had read-only isolated-worktree
  authority and no fallback/escalation. It was independent, dated 2026-08-27, checked scope/cardinality, finding closure,
  requested/effective separation, chronology, cooperative threat model, rollback, metrics, global baseline, stage/commit
  state, and self-review absence; it returned PASS with zero findings.
- `signal_bus_final_identity_tech`: historical final TECH identity review/read-only; exact 14 candidate paths from base
  `5a5c10bd12bef01ba756549fd61a93921438cb33`, 0 packages, using retained local results only. Requested
  route/profile/model/effort is `terra_reviewer`, `gpt-5.6-terra` / high; effective runtime route/model/effort is
  `not observable`. It had read-only isolated-worktree authority and no fallback/escalation. It was independent, dated
  2026-08-27. The Node V8 run passed 178/178 with 632/632 statements, 464/464 branches, 109/109 functions, and 523/523
  lines because Bun's V8 provider is unsupported; ESLint, Prettier, source, no-index, and build checks passed; its
  former-candidate global `typecheck:coverage-tools` had ten unchanged out-of-scope diagnostics. It returned TECH FAIL with one Medium
  finding: the plan prologue contradicted the then-current review status.

## Multi-parent history contract

- For every traversed commit, the verifier obtains all direct parents and computes pairwise NUL-delimited diffs. The
  rename/copy policy remains pairwise.
- A path's exact final state and each parent state are `absent` or `git:<40hex>`. Its record is novel only when final
  differs from every parent. If final equals any parent, it has no materialization record.
- A touched governed merge with only nonmaterializing paths must have no reserved SignalBus trailer; otherwise it fails
  `history-nonmaterialized-trailer`. A novel merge must have the full brief/owner/digest trailers; its digest covers the
  novel A/M/D records only.
- At history completion every manifest path must have a first materialization or fail `history-incomplete`, and its
  canonical exact base-to-HEAD final record must equal the declared operation or fail `history-final-state`.
- Before history traversal, every manifest path present in the supplied base tree is read as strict governed UTF-8 text,
  rejects forbidden C0 bytes including NUL, and remains within 500 physical lines. An absent `create` path at base is
  allowed.
- Real local-Git regressions cover a second-parent feature whose unchanged merge passes without a merge trailer; the
  forbidden reserved trailer; a unique conflict-resolution M with full trailer/digest; a discarded feature final state;
  malformed parent data; and octopus parents.

## RED-to-GREEN chronology

Historical events are dated 2026-08-26 and former-candidate review receipts are dated 2026-08-27. Exact wall-clock time,
original dispatch receipts, retry counts, and some stdout were not retained; they are UNAVAILABLE/UNVERIFIED and no later
output is reconstructed as earlier evidence. The table is historical context only, not closure evidence for the integrated
candidate.

| Seq | Owner                                   | RED / finding                                                                                                                                           | GREEN / retained result                                                                                                                                                                                                             |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | `signal_bus_verifier_plan`              | Modules and config absent                                                                                                                               | Contract, Git, verifier, CLI, and focused tests added.                                                                                                                                                                              |
| 02  | `signal_bus_verifier_implementation`    | Manifest/Git baseline, `core.abbrev`, fixture env, JSON EOF/escape, baseline/history closure, trailer, symlink/NUL/501, root hash, and topology defects | Strict parser, NUL port, local-Git isolation, digest-less baseline, full history closure, terminal trailers, and inspection-time guards retained.                                                                                   |
| 03  | `signal_bus_verifier_tech_review`       | ES2022 `Array.toSorted` incompatibility                                                                                                                 | Copied arrays plus narrow ES2022 rationale suppressions; scoped strict TypeScript/lint/build checks pass.                                                                                                                           |
| 04  | `signal_bus_verifier_tech_review`       | Encoded `import.meta.url.pathname` skipped malformed built-artifact input                                                                               | TDD RED then `fileURLToPath(import.meta.url)` comparison; malformed entry exits two with exact stderr.                                                                                                                              |
| 05  | `signal_bus_verifier_tech_review`       | Original single-parent history could misclassify merged branches                                                                                        | Finding classified valid; fresh TECH review remains pending.                                                                                                                                                                        |
| 06  | read-only design audit                  | Required parent-state and final-state semantics                                                                                                         | All-direct-parent rule, nonmaterializing trailer rule, and final-state rule specified before writing code.                                                                                                                          |
| 07  | `signal_bus_multi_parent_history_fix`   | Real local-Git merge regressions RED                                                                                                                    | TDD implementation reads all parents, classifies novelty, and adds `history-nonmaterialized-trailer` / `history-final-state`.                                                                                                       |
| 08  | `signal_bus_multi_parent_history_fix`   | Merge fixture entangled with prior support                                                                                                              | Structural split to `signal-bus-materialization-repo-test-support.ts` and dedicated merge suite.                                                                                                                                    |
| 09  | coverage closure                        | New branches/modules uncovered                                                                                                                          | 176/176 focused PASS with exact V8 100%; metrics below.                                                                                                                                                                             |
| 10  | `signal_bus_verifier_tech_review`       | High: a base-present governed delete could conceal binary/C0 text or 501 physical lines before history traversal                                        | Real-Git C0/binary base-delete and 501-line base-delete tests were RED then GREEN after base-tree validation; the formatting finding was fixed.                                                                                     |
| 11  | `signal_bus_history_base_rereview`      | Fresh final TECH assessment of the all-direct-parent and base-tree remediation                                                                          | Independent TECH PASS with zero findings; its retained 2026-08-27 receipt is historical only.                                                                                                                                       |
| 12  | `signal_bus_final_process_pass`         | Fresh final PROCESS assessment                                                                                                                          | FAIL with four valid evidence/process findings; remediation and a fresh PROCESS re-review are required.                                                                                                                             |
| 13  | `signal_bus_process_rereview`           | PROCESS re-review of the evidence remediation                                                                                                           | FAIL with one Medium finding: requested/profile values were represented as effective runtime values.                                                                                                                                |
| 14  | `signal_bus_process_rereview_final`     | Final PROCESS re-review of corrected evidence                                                                                                           | PASS with zero findings after scope, closure, separation, chronology, threat-model, rollback, metric, baseline, stage/commit, and self-review checks.                                                                               |
| 15  | `signal_bus_final_identity_tech`        | Final TECH identity review                                                                                                                              | TECH FAIL with one Medium stale-prologue evidence contradiction; fresh final identity TECH and PROCESS re-reviews are required.                                                                                                     |
| 16  | `signal_bus_integrated_tech_review`     | Integrated TECH finding: ABC history request returned later DEF digest                                                                                  | Valid finding remediated by TDD; this is not a final TECH PASS and fresh TECH/PROCESS remain pending.                                                                                                                               |
| 17  | `signal_bus_requested_brief_digest_fix` | Two-brief ABC/DEF result and multi-file ABC intermediate history RED                                                                                    | Full history stays validated; requested brief's latest digest is returned; focused history GREEN 22/22.                                                                                                                             |
| 18  | `signal_bus_integrated_final_tech`      | Fresh independent final TECH review of exact fourteen-file candidate                                                                                    | PASS, zero findings; 179/179, V8 638/466/109/526, adversarial history 3/3, and all required scoped/global gates pass.                                                                                                               |
| 19  | `signal_bus_integrated_final_process`   | Fresh independent final PROCESS review of exact branch/base/scope and evidence                                                                          | PASS, zero findings; ownership, TDD chronology, metrics, threat model, rollback, external effects, and no-commit state consistent.                                                                                                  |
| 20  | `signal_bus_exact_identity_tech`        | Exact-identity TECH re-review after the receipt-only mutation                                                                                           | TECH FAIL with one Medium finding: stale specification/plan line counts and hashes and contradictory current review-status statements. The receipt was corrected; fresh exact-identity TECH and PROCESS re-reviews remain required. |
| 21  | `signal_bus_exact_identity_tech`        | Fresh follow-up TECH review after receipt-identity correction                                                                                           | PASS, zero findings; exact 14, 179/179, V8 638/466/109/526, hashes/LOC and evidence self-reference verified.                                                                                                                        |
| 22  | `signal_bus_integrated_final_process`   | Exact-identity PROCESS follow-up after TECH PASS                                                                                                        | FAIL, one Medium finding: documents still marked the completed TECH re-review as pending. This snapshot remediates the finding; next TECH confirmation and PROCESS re-review are pending.                                           |

## Current integrated validation and review status

- After the requested-digest remediation, the focused command
  `node node_modules/vitest/vitest.mjs run --config scripts/tooling/vitest.signal-bus-materialization.config.mjs --coverage`
  passed: 4 test files, 179/179; V8 statements 638/638, branches 466/466, functions 109/109, lines 526/526. Focused
  history is 22/22 GREEN. Current `bun run typecheck:coverage-tools` is PASS, as are owned strict ES2022 TypeScript,
  scoped zero-warning ESLint, Prettier, root `bun run build` (12/12), the built spaced-path malformed CLI regression,
  and whitespace/scope/secret/TODO scans.
- The sole historical nonzero global typecheck result belongs to the former base `5a5c10bd12bef01ba756549fd61a93921438cb33`.
  It is not a current baseline exception or an open diagnostic.
- The candidate remains exactly eleven tooling plus three documentation/evidence paths, each at most 500 physical lines.
  Staged files and delivery commits remain zero. Tests use temporary local Git repositories only; no live venue, trading,
  network, credential, or persistent external service effect occurred.
- All former SignalBus TECH and PROCESS receipts are historical for former blobs. The integrated requested-brief finding was
  remediated and the pre-mutation independent final TECH and PROCESS reviews passed with zero findings. The subsequent
  exact-identity TECH follow-up passed with zero findings; the PROCESS follow-up found one Medium stale-status finding.
  This snapshot remediates it. The next exact-identity TECH confirmation and PROCESS re-review are pending; if both pass,
  the coordinator may commit without another documentation mutation. Coordinator exact-scope staging, commit, and
  integration remain pending.
- The intermediate-component symlink time-of-check/time-of-use condition remains explicitly user-approved out of scope for
  this cooperative tool; it is not represented as fixed. Rollback is removal of the three documentation/evidence files and
  the eleven uncommitted tooling files from the isolated worktree. No external state requires rollback.
