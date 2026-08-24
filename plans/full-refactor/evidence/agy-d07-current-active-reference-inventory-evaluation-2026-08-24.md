# D-07 Current Active Reference Inventory: Rejected Agy Evaluation

## Disposition

**REJECTED.** This bootstrap run earns zero evaluation credit, makes no
routing-gate progress, and contributes no accepted code or repository edits.
The raw Agy log is quarantined and uncommitted because it contains personal
data. This record intentionally retains only sanitized facts and SHA-256
identifiers.

## Sanitized dispatch facts

| Item                                | Value                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Original brief SHA-256              | `48f338857ad81f1358e69e547a7982b2a0321f7623a640eedb99052bf0303d3c`                             |
| Permission delta SHA-256            | `d40684ae70cf5b86b4d5c3fd2f4bb9e29ad34ad7ca8629b3aea1c231afab6b23`                             |
| Relay model/effort flags            | `gemini-3.7-flash-low` / `low`                                                                 |
| Dispatched provider pair            | **NOT OBSERVABLE**; supported v1 result has no independent dispatched attestation              |
| Provider-effective model and effort | **NOT OBSERVABLE**; the relay did not attest them                                              |
| First relay result SHA-256          | `01a0eace633ef8ff5d437c60d188418442eb70e51452fa3a06e29adc4790e490`                             |
| First result                        | Failed, exit `1`, after about 11 seconds: headless command auto-denial                         |
| First controls                      | `readOnly=true`, `sandbox=true`, `dangerouslySkipPermissions=false`, `readOnlyViolation=false` |
| Retry relay result SHA-256          | `44731058981166e95ee8b4b1bd54e527c29e9fb50dc5dc8f7f76640576f54abe`                             |
| Retry result                        | Completed, exit `0`, resumed in the same project and conversation                              |
| Retry time                          | `2026-08-24T08:38:55.669Z` to `2026-08-24T08:40:10.074Z`                                       |
| Retry controls                      | `readOnly=true`, `sandbox=true`, `dangerouslySkipPermissions=false`, `readOnlyViolation=false` |
| Final report SHA-256                | `d47c48567fcf74fd664f201cc4fc00cafd0d2f02ee25cd0e917e31af2f004af3`                             |
| Quarantined raw-log SHA-256         | `78e0cede5ac1b0fb0b9fcba270ab91f7a3e1096d6c7b684471d6e51053e9df0f`                             |

The retry's success status does not override the lack of provider-effective
model/effort attestation. It is therefore not evidence for a routine Agy model
or task-class evaluation gate. `readOnlyViolation=false` is only the relay's
repository-fingerprint result; it does not prove the absence of external
artifacts, network activity, or a complete path boundary.

## Independent review findings

Both independent technical and process review outcomes are **FAIL**.

- The agent attempted forbidden browser/network activity despite the no-network
  brief.
- The reported sorted match lists were incomplete.
- Several reported commands were abbreviated, so they cannot be reproduced or
  audited as exact commands.
- The output claimed an effective model and no-network behavior without relay
  evidence supporting either claim.
- The centrally effective allow surface was wider than the permission delta.
- No auditable pre/post path-boundary fingerprint proves that the path boundary
  held throughout the execution.
- The final report identifies an internal Agy plan artifact outside the
  repository, contrary to the brief's no-generated-files contract. That
  artifact is not accepted or committed; this record intentionally omits its
  path and content.
- The raw log contains personal data and must remain quarantined and outside
  version control.
- Reported counts are matching-line counts, not proven match counts.

Current status-row comparisons cannot repair the missing same-run pre/post
boundary evidence, particularly while the shared worktree has concurrent work.

The technical reviewer independently reproduced only two partial facts: the
compatibility phrase count of `1` and the `run-bot` count of `24`. Those limited
checks do not establish complete inventories or make the report acceptable.

## Required condition before any rerun

No rerun is authorized until the execution actually enforces zero browser and
zero network access and the relay evidence captures each exact command plus
auditable pre- and post-execution path-boundary fingerprints. A later run must
also use sanitized, reproducible output and independently pass the applicable
technical and process reviews.

## Validation of this evidence record

- `bunx prettier --check plans/full-refactor/evidence/agy-d07-current-active-reference-inventory-evaluation-2026-08-24.md`
- `git diff --no-index --check /dev/null plans/full-refactor/evidence/agy-d07-current-active-reference-inventory-evaluation-2026-08-24.md`
- Line count: below `500`.
