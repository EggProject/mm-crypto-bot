# LCOV path identity and counter validation

## Scope and ownership

- Objective: preserve evidence that the current two-file LCOV tooling slice keeps source-path identity intact and preserves/recomputes current and legacy LCOV counters correctly.
- Source paths: `scripts/lcov-tools.mjs` and `scripts/coverage-gates.test.sh`.
- Classification: routine documentation-only write, non-review; no Terra trigger for this evidence-file task.
- Code implementation route: requested/effective `terra_worker / gpt-5.6-terra / high` (profile-attested). Evidence-file route: requested/effective `luna_worker / gpt-5.6-luna / low`.
- Ownership: this new evidence file only; one root-tooling package; no external or mutable resources.
- The worktree was shared and dirty before this change. No unrelated files were edited, staged, or committed.

## Evidence

The regression fixtures exercise source-file identity and LCOV counter integrity. They verify duplicate `SF` records are merged without changing the path, line counters (`LF`/`LH`) are recomputed from `DA`, function counters (`FNF`/`FNH`) and `FNDA` totals are retained, and branch counters (`BRF`/`BRH`/`BRDA`) preserve numeric and unknown (`-`) semantics. Legacy `FN` records with an optional end field and their `FNDA` counters are also checked.

The format reference used for this interpretation is the official [LCOV project documentation](https://github.com/linux-test-project/lcov).

## Validation record

- Technical review command provenance: shell syntax; `bash scripts/coverage-gates.test.sh`; Prettier; `git diff HEAD --check`; targeted ESLint baseline current `16e/3w` vs HEAD `18e/3w`.
- `bash -n scripts/coverage-full.sh scripts/coverage-per-package.sh scripts/coverage-gates.test.sh` — PASS.
- `bash scripts/coverage-gates.test.sh` — PASS.
- Prettier on `scripts/lcov-tools.mjs` — PASS.
- `git diff --check` — PASS.
- ESLint comparison: HEAD `18e/3w`; current `16e/3w`. This is a non-regression comparison, not a lint PASS.
- The new Markdown file was formatted with Prettier and included in the diff-check scope — PASS.

## Routing and review history

An isolated provisional Antigravity attempt requested `gemini-3.7-flash-medium` with `medium` effort. Its provider-effective model/effort were not independently attested; the attempt failed with exit 1 because a bash command was denied. Pre/post hashes were recorded and identical: `coverage-gates.test.sh` `78239b3d...` and `lcov-tools.mjs` `dbc3fb71...`. Its `touchedFiles` reflected the seeded two-file baseline, not a delta, so there is no Agy edit evidence and it does not count toward the Agy bootstrap gate. The task was reclassified to the required Terra route for the surrounding review process.

All review iterations and findings were recorded by the coordinator. Final technical reviewer identity: `/root/lcov_identity_tech_review_short`, requested/effective `terra_reviewer / gpt-5.6-terra / high`, receipt completion `2026-08-24T03:33:54+02:00`; review PASS. Process reviewer identity: `/root/lcov_identity_process_review_short`, requested/effective `luna_process_reviewer / gpt-5.6-luna / medium`, receipt `2026-08-24T03:34:50+02:00`; PROCESS PASS after verifying current evidence, scoped diff checks, regression PASS, and the exact path-only commit plan with no remaining finding. Effective route/model/effort are attested by configured custom-agent profiles, not provider telemetry; Agy remains not independently attested. The path-only commit itself remains pending until coordinator execution.

The current index already contains 24 unrelated pre-existing staged paths, including CCXT upgrade/provenance work. This slice must not rewrite or unstage those entries. The safe atomic landing plan is the exact path-only command below, after reviewing `git diff HEAD --` for the three owned paths and running a scoped diff-check:

```text
git commit --only -- scripts/lcov-tools.mjs scripts/coverage-gates.test.sh plans/full-refactor/evidence/lcov-path-identity-validation.md
```

The path-only commit and final process re-review remain pending.

## Non-applicable checks

Call-graph, license, and audit checks are not applicable: this change documents an existing two-file tooling slice and changes no dependency, public API, runtime callsite, or product behavior.
